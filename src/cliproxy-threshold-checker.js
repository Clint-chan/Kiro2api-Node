import { logger } from "./logger.js";

export class CLIProxyThresholdChecker {
	constructor(db, cliproxyClient) {
		this.db = db;
		this.cliproxyClient = cliproxyClient;
		this.checkInterval = 15 * 60 * 1000;
		this.intervalId = null;
		this.isRunning = false;
		this.isChecking = false;
	}

	normalizeThresholdConfig(config) {
		if (!config || typeof config !== "object" || Array.isArray(config)) {
			return {};
		}

		const normalized = {};
		for (const [key, value] of Object.entries(config)) {
			const num = Number(value);
			if (Number.isFinite(num) && num > 0 && num <= 1) {
				normalized[key] = num;
			}
		}
		return normalized;
	}

	start() {
		if (this.isRunning) {
			logger.warn("CLIProxy 阈值检查器已在运行");
			return;
		}

		this.isRunning = true;
		logger.info("CLIProxy 阈值检查器已启动", {
			interval: `${this.checkInterval / 1000}秒`,
		});

		this.checkAllAccounts().catch((error) => {
			logger.error("CLIProxy 阈值检查失败", { error: error.message });
		});

		this.intervalId = setInterval(() => {
			this.checkAllAccounts().catch((error) => {
				logger.error("CLIProxy 阈值检查失败", { error: error.message });
			});
		}, this.checkInterval);
	}

	stop() {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
		this.isRunning = false;
		logger.info("CLIProxy 阈值检查器已停止");
	}

	async checkAllAccounts() {
		if (this.isChecking) {
			logger.warn("上次检查尚未完成，跳过本次");
			return;
		}

		this.isChecking = true;
		try {
			const authFiles = await this.cliproxyClient.getCachedAuthFiles(true);
			const files = authFiles.files || [];

			logger.info("开始检查 CLIProxy 账号阈值", { count: files.length });

			for (const account of files) {
				try {
					if (account.disabled) {
						const autoDisabledKey = `cliproxy_auto_disabled_${account.name}`;
						const autoDisabled = this.db.getSetting(autoDisabledKey);
						if (autoDisabled) {
							await this.checkAutoRecover(account);
						}
						continue;
					}

					await this.checkAccount(account);
				} catch (error) {
					logger.error("检查账号失败", {
						name: account.name,
						error: error.message,
					});
				}
			}

			logger.info("CLIProxy 账号阈值检查完成");
		} catch (error) {
			logger.error("获取账号列表失败", { error: error.message });
		} finally {
			this.isChecking = false;
		}
	}

	async checkAccount(account) {
		const configJson =
			this.db.getSetting(`cliproxy_threshold_${account.name}`) || "{}";

		let rawConfig = {};
		try {
			rawConfig = JSON.parse(configJson);
		} catch {
			rawConfig = {};
		}

		const config = this.normalizeThresholdConfig(rawConfig);

		if (Object.keys(config).length === 0) {
			return;
		}

		let shouldDisable = false;
		let reason = "";

		if (account.provider === "claude") {
			const result = await this.checkClaudeCodeThreshold(account, config);
			shouldDisable = result.shouldDisable;
			reason = result.reason;
		} else if (account.provider === "codex") {
			const result = await this.checkCodexThreshold(account, config);
			shouldDisable = result.shouldDisable;
			reason = result.reason;
		} else if (account.provider === "antigravity") {
			const result = await this.checkAntigravityThreshold(account, config);
			shouldDisable = result.shouldDisable;
			reason = result.reason;
		}

		if (shouldDisable) {
			logger.warn("账号额度低于阈值，自动禁用", {
				name: account.name,
				provider: account.provider,
				reason,
			});

			await this.cliproxyClient.patchAuthFileStatus(account.name, true);
			this.db.setSetting(`cliproxy_auto_disabled_${account.name}`, "1");

			logger.info("账号已自动禁用", { name: account.name });
		}
	}

	async checkAutoRecover(account) {
		const configJson =
			this.db.getSetting(`cliproxy_threshold_${account.name}`) || "{}";

		let rawConfig = {};
		try {
			rawConfig = JSON.parse(configJson);
		} catch {
			rawConfig = {};
		}

		const config = this.normalizeThresholdConfig(rawConfig);

		if (Object.keys(config).length === 0) {
			return;
		}

		let shouldEnable = false;
		let reason = "";

		if (account.provider === "claude") {
			const result = await this.checkClaudeCodeRecovery(account, config);
			shouldEnable = result.shouldEnable;
			reason = result.reason;
		} else if (account.provider === "codex") {
			const result = await this.checkCodexRecovery(account, config);
			shouldEnable = result.shouldEnable;
			reason = result.reason;
		} else if (account.provider === "antigravity") {
			const result = await this.checkAntigravityRecovery(account, config);
			shouldEnable = result.shouldEnable;
			reason = result.reason;
		}

		if (shouldEnable) {
			logger.info("账号额度已恢复，自动启用", {
				name: account.name,
				provider: account.provider,
				reason,
			});

			await this.cliproxyClient.patchAuthFileStatus(account.name, false);
			this.db.deleteSetting(`cliproxy_auto_disabled_${account.name}`);

			logger.info("账号已自动启用", { name: account.name });
		}
	}

	async checkClaudeCodeThreshold(account, config) {
		const quota = account.quota || {};

		if (
			config.five_hour !== undefined &&
			quota.five_hour &&
			quota.five_hour.utilization !== undefined
		) {
			const remaining = 1 - quota.five_hour.utilization;
			if (remaining < config.five_hour) {
				return {
					shouldDisable: true,
					reason: `5小时额度剩余 ${(remaining * 100).toFixed(1)}% < ${(config.five_hour * 100).toFixed(1)}%`,
				};
			}
		}

		if (
			config.seven_day !== undefined &&
			quota.seven_day &&
			quota.seven_day.utilization !== undefined
		) {
			const remaining = 1 - quota.seven_day.utilization;
			if (remaining < config.seven_day) {
				return {
					shouldDisable: true,
					reason: `7天额度剩余 ${(remaining * 100).toFixed(1)}% < ${(config.seven_day * 100).toFixed(1)}%`,
				};
			}
		}

		if (
			config.seven_day_sonnet !== undefined &&
			quota.seven_day_sonnet &&
			quota.seven_day_sonnet.utilization !== undefined
		) {
			const remaining = 1 - quota.seven_day_sonnet.utilization;
			if (remaining < config.seven_day_sonnet) {
				return {
					shouldDisable: true,
					reason: `7天Sonnet额度剩余 ${(remaining * 100).toFixed(1)}% < ${(config.seven_day_sonnet * 100).toFixed(1)}%`,
				};
			}
		}

		return { shouldDisable: false, reason: "" };
	}

	async checkClaudeCodeRecovery(account, config) {
		const quota = account.quota || {};
		const hysteresis = 0.05;

		const checks = [
			{
				name: "5小时",
				quota: quota.five_hour,
				threshold: config.five_hour,
			},
			{
				name: "7天",
				quota: quota.seven_day,
				threshold: config.seven_day,
			},
			{
				name: "7天Sonnet",
				quota: quota.seven_day_sonnet,
				threshold: config.seven_day_sonnet,
			},
		];

		for (const check of checks) {
			if (
				check.threshold !== undefined &&
				check.quota &&
				check.quota.utilization !== undefined
			) {
				const remaining = 1 - check.quota.utilization;
				if (remaining < check.threshold + hysteresis) {
					return { shouldEnable: false, reason: "" };
				}
			}
		}

		return {
			shouldEnable: true,
			reason: "所有配额已恢复到阈值以上",
		};
	}

	async checkCodexThreshold(account, config) {
		const quota = account.quota || {};

		if (config.five_hour !== undefined && quota.five_hour !== undefined) {
			const remaining = 1 - quota.five_hour;
			if (remaining < config.five_hour) {
				return {
					shouldDisable: true,
					reason: `5小时额度剩余 ${(remaining * 100).toFixed(1)}% < ${(config.five_hour * 100).toFixed(1)}%`,
				};
			}
		}

		if (config.weekly !== undefined && quota.weekly !== undefined) {
			const remaining = 1 - quota.weekly;
			if (remaining < config.weekly) {
				return {
					shouldDisable: true,
					reason: `周限额剩余 ${(remaining * 100).toFixed(1)}% < ${(config.weekly * 100).toFixed(1)}%`,
				};
			}
		}

		if (config.code_review !== undefined && quota.code_review !== undefined) {
			const remaining = 1 - quota.code_review;
			if (remaining < config.code_review) {
				return {
					shouldDisable: true,
					reason: `代码审查周限额剩余 ${(remaining * 100).toFixed(1)}% < ${(config.code_review * 100).toFixed(1)}%`,
				};
			}
		}

		return { shouldDisable: false, reason: "" };
	}

	async checkCodexRecovery(account, config) {
		const quota = account.quota || {};
		const hysteresis = 0.05;

		const checks = [
			{ name: "5小时", value: quota.five_hour, threshold: config.five_hour },
			{ name: "周限额", value: quota.weekly, threshold: config.weekly },
			{
				name: "代码审查",
				value: quota.code_review,
				threshold: config.code_review,
			},
		];

		for (const check of checks) {
			if (check.threshold !== undefined && check.value !== undefined) {
				const remaining = 1 - check.value;
				if (remaining < check.threshold + hysteresis) {
					return { shouldEnable: false, reason: "" };
				}
			}
		}

		return {
			shouldEnable: true,
			reason: "所有配额已恢复到阈值以上",
		};
	}

	async checkAntigravityThreshold(account, config) {
		const quota = account.quota || {};

		const claudeGptModels = [
			"claude-opus-4-6-thinking",
			"claude-opus-4-20250514",
			"claude-sonnet-4-20250514",
			"claude-3-5-sonnet-20241022",
			"claude-3-5-sonnet-20240620",
			"claude-3-5-haiku-20241022",
			"gpt-4o",
			"gpt-4o-mini",
			"o1",
			"o1-mini",
		];

		const geminiModels = [
			"gemini-2.0-flash-exp",
			"gemini-2.0-flash-thinking-exp-01-21",
			"gemini-exp-1206",
		];

		if (config.claude_gpt !== undefined) {
			for (const modelId of claudeGptModels) {
				const modelQuota = quota[modelId];
				if (
					modelQuota &&
					modelQuota.remaining_fraction !== undefined &&
					modelQuota.remaining_fraction < config.claude_gpt
				) {
					return {
						shouldDisable: true,
						reason: `Claude/GPT组模型 ${modelId} 剩余 ${(modelQuota.remaining_fraction * 100).toFixed(1)}% < ${(config.claude_gpt * 100).toFixed(1)}%`,
					};
				}
			}
		}

		if (config.gemini !== undefined) {
			for (const modelId of geminiModels) {
				const modelQuota = quota[modelId];
				if (
					modelQuota &&
					modelQuota.remaining_fraction !== undefined &&
					modelQuota.remaining_fraction < config.gemini
				) {
					return {
						shouldDisable: true,
						reason: `Gemini组模型 ${modelId} 剩余 ${(modelQuota.remaining_fraction * 100).toFixed(1)}% < ${(config.gemini * 100).toFixed(1)}%`,
					};
				}
			}
		}

		return { shouldDisable: false, reason: "" };
	}

	async checkAntigravityRecovery(account, config) {
		const quota = account.quota || {};
		const hysteresis = 0.05;

		const claudeGptModels = [
			"claude-opus-4-6-thinking",
			"claude-opus-4-20250514",
			"claude-sonnet-4-20250514",
			"claude-3-5-sonnet-20241022",
			"claude-3-5-sonnet-20240620",
			"claude-3-5-haiku-20241022",
			"gpt-4o",
			"gpt-4o-mini",
			"o1",
			"o1-mini",
		];

		const geminiModels = [
			"gemini-2.0-flash-exp",
			"gemini-2.0-flash-thinking-exp-01-21",
			"gemini-exp-1206",
		];

		if (config.claude_gpt !== undefined) {
			for (const modelId of claudeGptModels) {
				const modelQuota = quota[modelId];
				if (
					modelQuota &&
					modelQuota.remaining_fraction !== undefined &&
					modelQuota.remaining_fraction < config.claude_gpt + hysteresis
				) {
					return { shouldEnable: false, reason: "" };
				}
			}
		}

		if (config.gemini !== undefined) {
			for (const modelId of geminiModels) {
				const modelQuota = quota[modelId];
				if (
					modelQuota &&
					modelQuota.remaining_fraction !== undefined &&
					modelQuota.remaining_fraction < config.gemini + hysteresis
				) {
					return { shouldEnable: false, reason: "" };
				}
			}
		}

		return {
			shouldEnable: true,
			reason: "所有模型配额已恢复到阈值以上",
		};
	}
}
