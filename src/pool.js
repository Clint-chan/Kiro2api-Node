import fs from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { logger } from "./logger.js";
import { TokenManager } from "./token.js";
import { checkUsageLimits } from "./usage.js";

const ACCOUNTS_FILE = "accounts.json";
const LOGS_FILE = "request_logs.json";

export class AccountPool {
	constructor(config, db = null) {
		this.config = config;
		this.db = db;
		this.accounts = new Map();
		this.tokenManagers = new Map();
		this.strategy = "round-robin";
		this.roundRobinIndex = 0;
		this.logs = [];
		this.maxLogs = 1000;
	}

	async load() {
		try {
			await fs.mkdir(this.config.dataDir, { recursive: true });

			// 从数据库加载账号
			if (this.db) {
				try {
					const accounts = this.db.getAllKiroAccounts();
					for (const acc of accounts) {
						// 验证必需字段
						if (!acc.refresh_token) {
							logger.warn("跳过账号：refresh_token为空", {
								accountName: acc.name,
							});
							continue;
						}

						// 转换数据库格式到内存格式
						const account = {
							id: acc.id,
							name: acc.name,
							credentials: {
								refreshToken: acc.refresh_token,
								authMethod: acc.auth_method,
								clientId: acc.client_id || null,
								clientSecret: acc.client_secret || null,
								region: acc.region || null,
								machineId: TokenManager.resolveMachineId(
									{
										machineId: acc.machine_id || null,
										refreshToken: acc.refresh_token,
									},
									this.config,
								),
								profileArn: acc.profile_arn || null,
							},
							status: acc.status,
							requestCount: acc.request_count || 0,
							errorCount: acc.error_count || 0,
							createdAt: acc.created_at,
							lastUsedAt: acc.last_used_at,
							usage: acc.usage_limit
								? {
										usageLimit: acc.usage_limit,
										currentUsage: acc.current_usage,
										available: acc.available,
										userEmail: acc.user_email,
										subscriptionType: acc.subscription_type,
										nextReset: acc.next_reset,
										updatedAt: acc.usage_updated_at,
									}
								: null,
						};

						this.accounts.set(account.id, account);

						if (!acc.machine_id && account.credentials.machineId) {
							this.db.updateKiroAccountMachineId(
								account.id,
								account.credentials.machineId,
							);
						}

						try {
							this.tokenManagers.set(
								account.id,
								new TokenManager(this.config, account.credentials),
							);
						} catch (e) {
							logger.warn("无法创建TokenManager", {
								accountName: acc.name,
								error: e.message,
							});
						}
					}
					logger.info("加载账号完成", { count: accounts.length });
				} catch (e) {
					logger.error("从数据库加载账号失败", { error: e });
				}
			} else {
				// 兼容旧的 JSON 文件方式
				const accountsPath = path.join(this.config.dataDir, ACCOUNTS_FILE);
				try {
					const content = await fs.readFile(accountsPath, "utf-8");
					const accounts = JSON.parse(content);
					let changed = false;
					for (const acc of accounts) {
						acc.credentials = acc.credentials || {};
						const resolvedMachineId = TokenManager.resolveMachineId(
							acc.credentials,
							this.config,
						);
						if (
							resolvedMachineId &&
							acc.credentials.machineId !== resolvedMachineId
						) {
							acc.credentials.machineId = resolvedMachineId;
							changed = true;
						}
						this.accounts.set(acc.id, acc);
						this.tokenManagers.set(
							acc.id,
							new TokenManager(this.config, acc.credentials),
						);
					}
					if (changed) {
						await fs.writeFile(accountsPath, JSON.stringify(accounts, null, 2));
					}
					logger.info("加载账号完成", { count: accounts.length });
				} catch {}
			}

			// 加载日志（暂时保留，未来可以从数据库读取）
			const logsPath = path.join(this.config.dataDir, LOGS_FILE);
			try {
				const content = await fs.readFile(logsPath, "utf-8");
				this.logs = JSON.parse(content).slice(-this.maxLogs);
			} catch {}
		} catch (e) {
			logger.error("加载账号池失败", { error: e });
		}
	}

	async save() {
		const accountsPath = path.join(this.config.dataDir, ACCOUNTS_FILE);
		const accounts = Array.from(this.accounts.values());
		await fs.writeFile(accountsPath, JSON.stringify(accounts, null, 2));
	}

	async saveLogs() {
		const logsPath = path.join(this.config.dataDir, LOGS_FILE);
		await fs.writeFile(
			logsPath,
			JSON.stringify(this.logs.slice(-this.maxLogs)),
		);
	}

	async addAccount(account, skipValidation = false) {
		const id = account.id || uuidv4();
		const credentials = {
			...account.credentials,
			machineId: TokenManager.resolveMachineId(
				account.credentials || {},
				this.config,
			),
		};

		if (!credentials.machineId) {
			throw new Error(
				"无法生成 machineId，请检查 refreshToken 或 machineId 配置",
			);
		}

		const newAccount = {
			id,
			name: account.name || "未命名账号",
			credentials,
			status: "active",
			requestCount: 0,
			errorCount: 0,
			createdAt: new Date().toISOString(),
			lastUsedAt: null,
		};

		// 验证凭证（可跳过）
		if (!skipValidation) {
			const tm = new TokenManager(this.config, newAccount.credentials);
			await tm.ensureValidToken(); // 会抛出错误如果无效
		}

		this.accounts.set(id, newAccount);
		this.tokenManagers.set(
			id,
			new TokenManager(this.config, newAccount.credentials),
		);
		await this.save();

		// 同步到数据库
		if (this.db) {
			this.db.insertKiroAccount(newAccount);
			logger.info("账号已添加到数据库", {
				accountName: newAccount.name,
				accountId: id,
			});
		}

		return id;
	}

	async removeAccount(id, options = {}) {
		const { skipDbDelete = false } = options;
		const removed = this.accounts.delete(id);
		this.tokenManagers.delete(id);
		if (removed) {
			await this.save();

			// 同步到数据库
			if (this.db && !skipDbDelete) {
				this.db.deleteKiroAccount(id);
				logger.info("账号已从数据库删除", { accountId: id });
			}
		}
		return removed;
	}

	listAccounts() {
		return Array.from(this.accounts.values()).map((a) => ({
			id: a.id,
			name: a.name,
			status: a.status,
			requestCount: a.requestCount,
			errorCount: a.errorCount,
			createdAt: a.createdAt,
			lastUsedAt: a.lastUsedAt,
			usage: a.usage || null,
		}));
	}

	async refreshAccountUsage(id) {
		const account = this.accounts.get(id);
		if (!account) return null;

		try {
			const tm = this.tokenManagers.get(id);

			// 先刷新token获取新的access_token
			const token = await tm.ensureValidToken();

			// 如果refreshToken被更新了，同步到account和数据库
			if (tm.credentials.refreshToken !== account.credentials.refreshToken) {
				account.credentials.refreshToken = tm.credentials.refreshToken;
				if (this.db) {
					this.db.db
						.prepare("UPDATE kiro_accounts SET refresh_token = ? WHERE id = ?")
						.run(tm.credentials.refreshToken, id);
				}
			}

			// 用新的access_token获取usage
			const usage = await checkUsageLimits(token, this.config);

			account.usage = {
				usageLimit: usage.usageLimit,
				currentUsage: usage.currentUsage,
				available: usage.available,
				userEmail: usage.userEmail,
				subscriptionType: usage.subscriptionType,
				nextReset: usage.nextReset,
				updatedAt: new Date().toISOString(),
			};

			const minBalance = parseFloat(process.env.MIN_BALANCE_THRESHOLD) || 5;
			const available = usage.available || 0;

			if (available < minBalance) {
				if (account.status === "active" || account.status === "cooldown") {
					account.status = "depleted";
					logger.warn("账号余额不足，标记为depleted", {
						accountName: account.name,
						available,
						minBalance,
					});
				}
			} else {
				if (account.status === "depleted") {
					const nextReset = usage.nextReset ? new Date(usage.nextReset) : null;
					const now = new Date();
					const canRecover = !nextReset || now >= nextReset;

					if (canRecover) {
						account.status = "active";
						logger.info("账号余额充足，恢复为active", {
							accountName: account.name,
							available,
							minBalance,
						});
					}
				} else if (
					account.status === "error" ||
					account.status === "cooldown"
				) {
					account.status = "active";
					logger.info("账号状态恢复为active", {
						accountName: account.name,
						previousStatus: "error_or_cooldown",
					});
				}
			}

			await this.save();

			// 同步到数据库
			if (this.db) {
				this.db.updateKiroAccountUsage(id, account.usage);
				this.db.updateKiroAccountStatus(id, account.status);
			}

			return account.usage;
		} catch (e) {
			logger.error("刷新账号额度失败", { accountId: id, error: e.message });

			if (e.message.startsWith("BANNED:")) {
				await this.markBanned(id);
				return { error: `账号已被封禁: ${e.message.substring(7)}` };
			}

			if (e.message.startsWith("TOKEN_INVALID:")) {
				await this.markExpired(id);
				return { error: `Token已失效: ${e.message.substring(14)}` };
			}

			if (
				e.message.includes("401") ||
				e.message.includes("403") ||
				e.message.includes("过期") ||
				e.message.includes("无效") ||
				e.message.includes("刷新失败")
			) {
				await this.markExpired(id);
				return { error: "Token已过期或无效" };
			}

			return { error: e.message };
		}
	}

	async refreshAllUsage() {
		const accounts = Array.from(this.accounts.entries()).filter(
			([_id, account]) =>
				account.status !== "error" &&
				account.status !== "banned" &&
				account.status !== "expired" &&
				account.status !== "disabled",
		);

		const results = [];

		const batchSize = 50;
		for (let i = 0; i < accounts.length; i += batchSize) {
			const batch = accounts.slice(i, i + batchSize);
			const batchPromises = batch.map(async ([id, account]) => {
				try {
					const usage = await this.refreshAccountUsage(id);
					return { id, name: account.name, usage, success: !usage?.error };
				} catch (error) {
					return {
						id,
						name: account.name,
						usage: { error: error.message },
						success: false,
					};
				}
			});

			const batchResults = await Promise.allSettled(batchPromises);
			results.push(
				...batchResults.map((r) =>
					r.status === "fulfilled"
						? r.value
						: { success: false, error: r.reason },
				),
			);
		}

		return results;
	}

	async selectAccount(options = {}) {
		const excludedIds =
			options.excludeIds instanceof Set ? options.excludeIds : new Set();

		// 第三道防线：本地软限流 - 余额低于 5 时停止使用
		const minBalance = parseFloat(process.env.MIN_BALANCE_THRESHOLD) || 5;
		const maxInflight = parseInt(process.env.MAX_INFLIGHT_PER_ACCOUNT, 10) || 5;

		const available = Array.from(this.accounts.values()).filter((a) => {
			if (excludedIds.has(a.id)) return false;

			// 必须是 active 状态
			if (a.status !== "active") return false;

			// 检查余额
			if (a.usage) {
				const available = a.usage.available || 0;
				if (available < minBalance) {
					return false;
				}
			}

			// 检查并发数（并发闸门）
			const inflight = a.inflight || 0;
			if (inflight >= maxInflight) {
				return false;
			}

			return true;
		});

		if (available.length === 0) {
			logger.error("没有可用账号");
			return null;
		}

		let selected;
		switch (this.strategy) {
			case "random":
				selected = available[Math.floor(Math.random() * available.length)];
				break;
			case "least-used":
				selected = available.reduce((a, b) =>
					a.requestCount < b.requestCount ? a : b,
				);
				break;
			case "least-inflight":
				selected = available.reduce((a, b) =>
					(a.inflight || 0) < (b.inflight || 0) ? a : b,
				);
				break;
			default: // round-robin
				selected = available[this.roundRobinIndex % available.length];
				this.roundRobinIndex++;
		}

		// ✅ 原子操作：选择 + 占位一起完成，不让出事件循环
		selected.requestCount++;
		selected.lastUsedAt = new Date().toISOString();
		selected.inflight = (selected.inflight || 0) + 1; // 立即占位

		// 异步保存，不阻塞请求
		this.save().catch(() => {});

		return {
			id: selected.id,
			name: selected.name,
			tokenManager: this.tokenManagers.get(selected.id),
			// 返回释放函数
			release: () => {
				selected.inflight = Math.max(0, (selected.inflight || 0) - 1);
			},
		};
	}

	async recordError(id, isRateLimit) {
		const account = this.accounts.get(id);
		if (!account) return;

		account.errorCount++;
		if (isRateLimit) {
			account.status = "cooldown";
			setTimeout(
				() => {
					if (account.status === "cooldown") {
						account.status = "active";
						// 同步到数据库
						if (this.db) {
							this.db.updateKiroAccountStatus(id, "active");
						}
					}
				},
				5 * 60 * 1000,
			); // 5分钟冷却

			// 同步到数据库
			if (this.db) {
				this.db.updateKiroAccountStatus(id, "cooldown");
			}
		}
		await this.save();
	}

	async markInvalid(id) {
		const account = this.accounts.get(id);
		if (!account) {
			logger.error("账号不存在于accountPool", { accountId: id });
			// 即使内存中没有，也尝试更新数据库
			if (this.db) {
				this.db.updateKiroAccountStatus(id, "error");
				logger.info("已在数据库中标记账号为error", { accountId: id });
				return true;
			}
			return false;
		}

		account.status = "error";
		await this.save();

		// 同步到数据库
		if (this.db) {
			this.db.updateKiroAccountStatus(id, "error");
		}
		logger.info("已标记账号为error", {
			accountName: account.name,
			accountId: id,
		});
	}

	/**
	 * 标记账号为 BANNED（被封禁）
	 */
	async markBanned(id) {
		const account = this.accounts.get(id);
		if (!account) {
			logger.error("账号不存在于accountPool", { accountId: id });
			if (this.db) {
				this.db.updateKiroAccountStatus(id, "banned");
				logger.info("已在数据库中标记账号为banned", { accountId: id });
				return true;
			}
			return false;
		}

		account.status = "banned";
		await this.save();

		if (this.db) {
			this.db.updateKiroAccountStatus(id, "banned");
		}
		logger.warn("已标记账号为BANNED", {
			accountName: account.name,
			accountId: id,
		});
		return true;
	}

	/**
	 * 标记账号为 EXPIRED（失效）
	 */
	async markExpired(id) {
		const account = this.accounts.get(id);
		if (!account) {
			logger.error("账号不存在于accountPool", { accountId: id });
			if (this.db) {
				this.db.updateKiroAccountStatus(id, "expired");
				logger.info("已在数据库中标记账号为expired", { accountId: id });
				return true;
			}
			return false;
		}

		account.status = "expired";
		await this.save();

		if (this.db) {
			this.db.updateKiroAccountStatus(id, "expired");
		}
		logger.warn("已标记账号为EXPIRED", {
			accountName: account.name,
			accountId: id,
		});
		return true;
	}

	/**
	 * 标记账号为 DEPLETED（余额耗尽）
	 * 这是永久性状态，直到外部信号（余额监控器）检测到余额恢复
	 */
	async markDepleted(id) {
		const account = this.accounts.get(id);
		if (!account) {
			logger.error("账号不存在于accountPool", { accountId: id });
			if (this.db) {
				this.db.updateKiroAccountStatus(id, "depleted");
				logger.info("已在数据库中标记账号为depleted", { accountId: id });
				return true;
			}
			return false;
		}

		account.status = "depleted";
		await this.save();

		// 同步到数据库
		if (this.db) {
			this.db.updateKiroAccountStatus(id, "depleted");
		}
		logger.warn("已标记账号为DEPLETED", {
			accountName: account.name,
			accountId: id,
		});
		return true;
	}

	async enableAccount(id) {
		const account = this.accounts.get(id);
		if (!account) {
			logger.error("账号不存在于accountPool", { accountId: id });
			// 即使内存中没有，也尝试更新数据库
			if (this.db) {
				this.db.updateKiroAccountStatus(id, "active");
				logger.info("已在数据库中启用账号", { accountId: id });
				return true;
			}
			return false;
		}

		account.status = "active";
		await this.save();

		// 同步到数据库
		if (this.db) {
			this.db.updateKiroAccountStatus(id, "active");
		}
		logger.info("已启用账号", { accountName: account.name, accountId: id });
		return true;
	}

	async disableAccount(id) {
		const account = this.accounts.get(id);
		if (!account) {
			logger.error("账号不存在于accountPool", { accountId: id });
			// 即使内存中没有，也尝试更新数据库
			if (this.db) {
				this.db.updateKiroAccountStatus(id, "disabled");
				logger.info("已在数据库中禁用账号", { accountId: id });
				return true;
			}
			return false;
		}

		account.status = "disabled";
		await this.save();

		// 同步到数据库
		if (this.db) {
			this.db.updateKiroAccountStatus(id, "disabled");
		}
		logger.info("已禁用账号", { accountName: account.name, accountId: id });
		return true;
	}

	setStrategy(strategy) {
		this.strategy = strategy;
	}

	getStrategy() {
		return this.strategy;
	}

	getStats() {
		const accounts = Array.from(this.accounts.values());
		return {
			total: accounts.length,
			active: accounts.filter((a) => a.status === "active").length,
			cooldown: accounts.filter((a) => a.status === "cooldown").length,
			error: accounts.filter((a) => a.status === "error").length,
			banned: accounts.filter((a) => a.status === "banned").length,
			expired: accounts.filter((a) => a.status === "expired").length,
			inactive: accounts.filter((a) => a.status === "inactive").length,
			disabled: accounts.filter((a) => a.status === "disabled").length,
			totalRequests: accounts.reduce((sum, a) => sum + a.requestCount, 0),
			totalErrors: accounts.reduce((sum, a) => sum + a.errorCount, 0),
		};
	}

	addLog(log) {
		this.logs.push({ ...log, timestamp: new Date().toISOString() });
		if (this.logs.length > this.maxLogs) {
			this.logs = this.logs.slice(-this.maxLogs);
		}
		this.saveLogs().catch(() => {});
	}

	getRecentLogs(n = 100) {
		return this.logs.slice(-n).reverse();
	}

	async clearLogs() {
		this.logs = [];
		await this.saveLogs();
	}

	async removeAccounts(ids) {
		let removed = 0;
		for (const id of ids) {
			if (this.accounts.delete(id)) {
				this.tokenManagers.delete(id);
				removed++;
			}
		}
		if (removed > 0) await this.save();
		return { total: ids.length, removed };
	}

	getLogStats() {
		return {
			totalInputTokens: this.logs.reduce(
				(sum, l) => sum + (l.inputTokens || 0),
				0,
			),
			totalOutputTokens: this.logs.reduce(
				(sum, l) => sum + (l.outputTokens || 0),
				0,
			),
		};
	}
}
