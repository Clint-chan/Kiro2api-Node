/**
 * 账号余额监控器
 *
 * 设计理念：
 * 1. 内存缓存 - selectAccount() 只读内存，毫秒级响应
 * 2. 异步刷新 - 后台定期刷新余额，不阻塞请求
 * 3. 智能调度 - 根据使用频率动态调整刷新间隔
 * 4. 错误驱动 - 遇到余额不足时立即刷新
 *
 * 参考：Netflix Hystrix、AWS CloudWatch、Google SRE
 */

import { logger } from "./logger.js";

export class BalanceMonitor {
	constructor(accountPool, options = {}) {
		this.accountPool = accountPool;

		// 配置
		this.refreshInterval = options.refreshInterval || 5 * 60 * 1000; // 5 分钟
		this.batchSize = options.batchSize || 5;
		this.enabled = options.enabled !== false;

		// 状态
		this.timer = null;
		this.isRefreshing = false;
		this.lastRefreshTime = new Map();

		// 统计
		this.stats = {
			totalRefreshes: 0,
			successfulRefreshes: 0,
			failedRefreshes: 0,
			lastRefreshDuration: 0,
		};
	}

	/**
	 * 启动监控器
	 */
	start() {
		if (!this.enabled) {
			logger.warn("余额监控器已禁用");
			return;
		}

		logger.info("余额监控器已启动", {
			refreshIntervalSeconds: this.refreshInterval / 1000,
		});

		// 立即执行一次刷新
		this.refresh().catch((err) => {
			logger.error("初始余额刷新失败", { error: err });
		});

		// 定期刷新
		this.timer = setInterval(() => {
			this.refresh().catch((err) => {
				logger.error("定期余额刷新失败", { error: err });
			});
		}, this.refreshInterval);
	}

	/**
	 * 停止监控器
	 */
	stop() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
			logger.info("余额监控器已停止");
		}
	}

	/**
	 * 刷新所有账号余额（简单批次刷新）
	 */
	async refresh() {
		if (this.isRefreshing) {
			logger.warn("余额刷新正在进行中，跳过");
			return;
		}

		this.isRefreshing = true;
		const startTime = Date.now();

		try {
			const accounts = this.accountPool
				.listAccounts()
				.filter((a) => a.status !== "disabled"); // 跳过已禁用的

			// 简单分批刷新
			const results = [];
			for (let i = 0; i < accounts.length; i += this.batchSize) {
				const batch = accounts.slice(i, i + this.batchSize);

				const batchResults = await Promise.allSettled(
					batch.map((account) => this.refreshAccount(account.id)),
				);

				results.push(...batchResults);

				// 批次间延迟
				if (i + this.batchSize < accounts.length) {
					await this.sleep(1000);
				}
			}

			// 统计结果
			const successful = results.filter(
				(r) => r.status === "fulfilled" && r.value,
			).length;

			this.stats.totalRefreshes++;
			this.stats.successfulRefreshes += successful;
			this.stats.failedRefreshes += results.length - successful;
			this.stats.lastRefreshDuration = Date.now() - startTime;

			logger.info("余额刷新完成", {
				successful,
				total: results.length,
				durationMs: this.stats.lastRefreshDuration,
			});
		} catch (error) {
			logger.error("余额刷新失败", { error });
		} finally {
			this.isRefreshing = false;
		}
	}

	/**
	 * 刷新单个账号余额
	 */
	async refreshAccount(accountId) {
		try {
			const usage = await this.accountPool.refreshAccountUsage(accountId);
			this.lastRefreshTime.set(accountId, Date.now());
			return !usage?.error;
		} catch (error) {
			logger.error("刷新账号失败", { accountId, error: error.message });
			return false;
		}
	}

	/**
	 * 手动触发刷新
	 */
	async forceRefresh(accountId) {
		logger.info("强制刷新账号", { accountId });
		return this.refreshAccount(accountId);
	}

	/**
	 * 获取监控统计
	 */
	getStats() {
		return {
			...this.stats,
			isRefreshing: this.isRefreshing,
			accountsTracked: this.lastRefreshTime.size,
			enabled: this.enabled,
		};
	}

	/**
	 * 延迟函数
	 */
	sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

export function createBalanceMonitor(accountPool, config = {}) {
	const options = {
		refreshInterval:
			parseInt(process.env.BALANCE_REFRESH_INTERVAL) || 5 * 60 * 1000,
		batchSize: 5,
		enabled: process.env.BALANCE_MONITOR_ENABLED !== "false",
		...config,
	};

	return new BalanceMonitor(accountPool, options);
}
