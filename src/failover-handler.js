/**
 * 故障转移处理器
 *
 * 核心理念：用户永远不应该看到 insufficient_balance_error
 *
 * 三道防线：
 * 1. 无感换号重试 (Transparent Failover) - 最关键
 * 2. 永久性错误判定 (Permanent Error Detection)
 * 3. 本地软限流 (Soft Limit Prediction)
 */

import { logger } from "./logger.js";

export class FailoverHandler {
	constructor(accountPool, options = {}) {
		this.accountPool = accountPool;
		this.maxRetries = options.maxRetries || 3; // 最多重试 3 次
		this.retryDelay = options.retryDelay || 100; // 重试延迟 100ms

		// 错误分类
		this.permanentErrors = new Set([
			"insufficient_balance_error",
			"authentication_error",
			"invalid_request_error",
		]);

		this.temporaryErrors = new Set([
			"rate_limit_error",
			"overloaded_error",
			"api_error",
		]);
	}

	/**
	 * 第一道防线：无感换号重试
	 *
	 * 当请求失败时，自动切换到其他账号重试，用户完全无感知
	 *
	 * 注意：流式请求一旦开始就不能重试（避免重复内容和重复计费）
	 */
	async executeWithFailover(fn, context = {}) {
		const usedAccounts = new Set();
		let lastError = null;
		let hasStartedStreaming = false;
		let currentAccount = null;

		for (let attempt = 0; attempt < this.maxRetries; attempt++) {
			try {
				// 选择账号（排除已使用的）
				const account = await this.accountPool.selectAccount({
					excludeIds: usedAccounts,
				});
				currentAccount = account;

				if (!account) {
					throw new Error("没有可用的账号");
				}

				// 记录已使用的账号
				usedAccounts.add(account.id);

				// 执行请求
				const result = await fn(account);

				// 如果是流式请求，标记已开始
				if (context.isStream) {
					hasStartedStreaming = true;
				}

				// 成功，返回结果
				if (attempt > 0) {
					logger.info("故障转移成功", {
						attempt: attempt + 1,
						maxRetries: this.maxRetries,
					});
				}

				return result;
			} catch (error) {
				lastError = error;

				// 流式请求已开始，不能重试（避免重复内容）
				if (hasStartedStreaming) {
					logger.error("流式请求已开始输出，无法重试");
					throw error;
				}

				// 判断错误类型
				const errorType = this.classifyError(error);

				if (errorType === "PERMANENT") {
					// 第二道防线：永久性错误，判"死刑"
					logger.warn("检测到永久性错误", { error: error.message });
					await this.handlePermanentError(
						error,
						currentAccount?.id || context.accountId,
					);

					// 继续尝试其他账号
					if (attempt < this.maxRetries - 1) {
						logger.info("切换到其他账号重试", {
							attempt: attempt + 1,
							maxRetries: this.maxRetries,
						});
						// 指数退避 + 抖动
						const delay = this.calculateBackoff(attempt);
						await this.sleep(delay);
					}
				} else if (errorType === "TEMPORARY") {
					// 临时性错误，短暂延迟后重试
					logger.warn("检测到临时性错误", { error: error.message });
					await this.handleTemporaryError(
						error,
						currentAccount?.id || context.accountId,
					);

					if (attempt < this.maxRetries - 1) {
						logger.info("延迟后重试", {
							attempt: attempt + 1,
							maxRetries: this.maxRetries,
						});
						// 指数退避 + 抖动
						const delay = this.calculateBackoff(attempt);
						await this.sleep(delay);
					}
				} else {
					// 未知错误，不重试
					logger.error("未知错误", { error: error.message });
					break;
				}
			}
		}

		// 所有重试都失败了
		logger.error("故障转移失败", { maxRetries: this.maxRetries });
		throw lastError;
	}

	/**
	 * 计算退避延迟（指数退避 + 抖动）
	 * 避免重试风暴
	 */
	calculateBackoff(attempt) {
		// 指数退避：100ms, 200ms, 400ms, 800ms...
		const exponentialDelay = this.retryDelay * 2 ** attempt;

		// 限制最大延迟为 5 秒
		const cappedDelay = Math.min(exponentialDelay, 5000);

		// 添加随机抖动（50%-100%）
		const jitter = cappedDelay * (0.5 + Math.random() * 0.5);

		return Math.floor(jitter);
	}

	/**
	 * 第二道防线：错误分类
	 *
	 * PERMANENT: 永久性错误（余额不足、认证失败）
	 * TEMPORARY: 临时性错误（限流、超时）
	 * UNKNOWN: 未知错误
	 */
	classifyError(error) {
		// 检查错误类型
		if (error.type && this.permanentErrors.has(error.type)) {
			return "PERMANENT";
		}

		if (error.type && this.temporaryErrors.has(error.type)) {
			return "TEMPORARY";
		}

		// 检查错误消息
		const message = error.message?.toLowerCase() || "";

		// 永久性错误关键词
		if (
			message.includes("insufficient_balance") ||
			message.includes("reached the limit") ||
			message.includes("authentication") ||
			message.includes("invalid")
		) {
			return "PERMANENT";
		}

		// 临时性错误关键词
		if (
			message.includes("rate limit") ||
			message.includes("timeout") ||
			message.includes("overloaded") ||
			message.includes("503") ||
			message.includes("502")
		) {
			return "TEMPORARY";
		}

		return "UNKNOWN";
	}

	/**
	 * 处理永久性错误
	 *
	 * 策略：判"死刑"，永久移出轮询列表，并立即更新缓存
	 */
	async handlePermanentError(error, accountId) {
		if (!accountId) return;

		try {
			// 标记为 DEPLETED（耗尽）状态
			await this.accountPool.markDepleted(accountId);

			// ✅ 立即更新内存缓存（被动刷新）
			const account = this.accountPool.accounts.get(accountId);
			if (account && account.usage) {
				account.usage.available = 0;
				account.usage.updatedAt = new Date().toISOString();
			}

			// 异步刷新余额（不阻塞）
			this.accountPool.refreshAccountUsage(accountId).catch((err) => {
				logger.error("刷新账号余额失败", { accountId, error: err.message });
			});

			logger.warn("账号已标记为DEPLETED，缓存已更新", { accountId });
		} catch (err) {
			logger.error("处理永久性错误失败", { error: err });
		}
	}

	/**
	 * 处理临时性错误
	 *
	 * 策略：短暂冷却，不移出轮询列表
	 */
	async handleTemporaryError(error, accountId) {
		if (!accountId) return;

		try {
			const isRateLimit =
				error.message?.includes("rate") || error.message?.includes("limit");
			await this.accountPool.recordError(accountId, isRateLimit);

			logger.info("账号进入冷却期", { accountId });
		} catch (err) {
			logger.error("处理临时性错误失败", { error: err });
		}
	}

	/**
	 * 延迟函数
	 */
	sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

/**
 * 创建故障转移处理器
 */
export function createFailoverHandler(accountPool, config = {}) {
	const options = {
		maxRetries: parseInt(process.env.FAILOVER_MAX_RETRIES) || 3,
		retryDelay: parseInt(process.env.FAILOVER_RETRY_DELAY) || 100,
		...config,
	};

	return new FailoverHandler(accountPool, options);
}
