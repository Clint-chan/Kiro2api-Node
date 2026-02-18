import { getModelGroupsWithThresholds } from "./antigravity-model-groups.js";
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
			const disableGroups = result.disableGroups || {};

			if (Object.keys(disableGroups).length > 0) {
				const groupsData = { version: 1, groups: disableGroups };
				this.db.setSetting(
					`cliproxy_auto_disabled_groups_${account.name}`,
					JSON.stringify(groupsData),
				);

				const groupNames = Object.keys(disableGroups).join(", ");
				logger.warn("模型组额度低于阈值，已记录禁用状态", {
					name: account.name,
					provider: account.provider,
					groups: groupNames,
				});
			}
			return;
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
			if (result.reason) {
				logger.info("Antigravity 模型组恢复", {
					name: account.name,
					reason: result.reason,
				});
			}
			return;
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
		const quota = {};

		const authIndex = account.auth_index || account.authIndex;
		const accountId = account.id_token?.chatgpt_account_id;

		if (authIndex && accountId) {
			try {
				const result = await this.cliproxyClient.apiCall(
					authIndex,
					"GET",
					"https://chatgpt.com/backend-api/wham/usage",
					{
						Authorization: "Bearer $TOKEN$",
						"User-Agent":
							"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
						"Chatgpt-Account-Id": accountId,
					},
				);

				const statusCode = result?.status_code || result?.statusCode;
				if (statusCode >= 200 && statusCode < 300) {
					const parseJsonSafe = (value) => {
						if (typeof value !== "string") return value;
						try {
							return JSON.parse(value);
						} catch {
							return null;
						}
					};

					const parsedBody = parseJsonSafe(result.body);
					const quotaData = parsedBody?.body || parsedBody;

					if (quotaData) {
						const secondaryWindow = quotaData.rate_limit?.secondary_window;
						const codeReviewWindow =
							quotaData.code_review_rate_limit?.primary_window;

						if (secondaryWindow) {
							quota.weekly = secondaryWindow.used_percent || 0;
						}

						if (codeReviewWindow) {
							quota.code_review = codeReviewWindow.used_percent || 0;
						}
					}
				}
			} catch (error) {
				logger.warn("获取 Codex 配额失败", {
					name: account.name,
					error: error.message,
				});
			}
		}

		if (config.weekly !== undefined && quota.weekly !== undefined) {
			// Codex API 返回的 used_percent 是整数（0-100），需要转换为小数（0-1）
			const remaining = 1 - quota.weekly / 100;
			if (remaining < config.weekly) {
				return {
					shouldDisable: true,
					reason: `周限额剩余 ${(remaining * 100).toFixed(1)}% < ${(config.weekly * 100).toFixed(1)}%`,
				};
			}
		}

		if (config.code_review !== undefined && quota.code_review !== undefined) {
			// Codex API 返回的 used_percent 是整数（0-100），需要转换为小数（0-1）
			const remaining = 1 - quota.code_review / 100;
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
		const quota = {};
		const hysteresis = 0.05;

		const authIndex = account.auth_index || account.authIndex;
		const accountId = account.id_token?.chatgpt_account_id;

		if (authIndex && accountId) {
			try {
				const result = await this.cliproxyClient.apiCall(
					authIndex,
					"GET",
					"https://chatgpt.com/backend-api/wham/usage",
					{
						Authorization: "Bearer $TOKEN$",
						"User-Agent":
							"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
						"Chatgpt-Account-Id": accountId,
					},
				);

				const statusCode = result?.status_code || result?.statusCode;
				if (statusCode >= 200 && statusCode < 300) {
					const parseJsonSafe = (value) => {
						if (typeof value !== "string") return value;
						try {
							return JSON.parse(value);
						} catch {
							return null;
						}
					};

					const parsedBody = parseJsonSafe(result.body);
					const quotaData = parsedBody?.body || parsedBody;

					if (quotaData) {
						const secondaryWindow = quotaData.rate_limit?.secondary_window;
						const codeReviewWindow =
							quotaData.code_review_rate_limit?.primary_window;

						if (secondaryWindow) {
							quota.weekly = secondaryWindow.used_percent || 0;
						}

						if (codeReviewWindow) {
							quota.code_review = codeReviewWindow.used_percent || 0;
						}
					}
				}
			} catch (error) {
				logger.warn("获取 Codex 配额失败（恢复检查）", {
					name: account.name,
					error: error.message,
				});
			}
		}

		const checks = [
			{ name: "周限额", value: quota.weekly, threshold: config.weekly },
			{
				name: "代码审查",
				value: quota.code_review,
				threshold: config.code_review,
			},
		];

		for (const check of checks) {
			if (check.threshold !== undefined && check.value !== undefined) {
				const remaining = 1 - check.value / 100;
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
		const quota = {};

		const authIndex = account.auth_index || account.authIndex;
		if (!authIndex) {
			logger.warn("Antigravity 账号缺少 authIndex", { name: account.name });
			return { disableGroups: {} };
		}

		try {
			const result = await this.cliproxyClient.apiCall(
				authIndex,
				"POST",
				"https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
				{
					Authorization: "Bearer $TOKEN$",
					"Content-Type": "application/json",
					"User-Agent": "antigravity/1.11.5 windows/amd64",
				},
				JSON.stringify({
					project: account.project_id || "bamboo-precept-lgxtn",
				}),
			);

			const statusCode = result?.status_code || result?.statusCode;
			if (!statusCode || statusCode < 200 || statusCode >= 300) {
				logger.warn("Antigravity API 返回非成功状态", {
					name: account.name,
					statusCode,
				});
				return { disableGroups: {} };
			}

			const parseJsonSafe = (value) => {
				if (typeof value !== "string") return value;
				try {
					return JSON.parse(value);
				} catch {
					return null;
				}
			};

			const body = parseJsonSafe(result?.body);
			if (!body || !body.models) {
				logger.warn("Antigravity API 响应格式异常", {
					name: account.name,
					hasBody: !!body,
					hasModels: !!body?.models,
				});
				return { disableGroups: {} };
			}

			const models = body.models;

			logger.info("Antigravity 配额检查", {
				name: account.name,
				modelCount: Object.keys(models).length,
				authIndex: authIndex ? "存在" : "缺失",
			});

			for (const [modelId, modelInfo] of Object.entries(models)) {
				if (modelInfo?.quotaInfo) {
					quota[modelId] = {
						remaining_fraction: modelInfo.quotaInfo.remainingFraction,
						reset_time: modelInfo.quotaInfo.resetTime,
					};
				}
			}
		} catch (error) {
			logger.warn("获取 Antigravity 配额失败", {
				name: account.name,
				error: error.message,
			});
			return { disableGroups: {} };
		}

		const disableGroups = {};
		const recoveredGroups = [];

		const groupsJson =
			this.db.getSetting(`cliproxy_auto_disabled_groups_${account.name}`) ||
			"{}";
		let currentDisabledGroups = {};
		try {
			const parsed = JSON.parse(groupsJson);
			currentDisabledGroups = parsed.groups || {};
		} catch {
			currentDisabledGroups = {};
		}

		const modelGroups = getModelGroupsWithThresholds(config);

		for (const [groupName, groupConfig] of Object.entries(modelGroups)) {
			if (groupConfig.threshold === undefined) continue;

			const hysteresis = 0.05;
			const isCurrentlyDisabled = !!currentDisabledGroups[groupName];
			let shouldDisable = false;
			let triggerModel = null;

			for (const [modelId, modelQuota] of Object.entries(quota)) {
				if (!modelQuota) continue;

				const remaining =
					modelQuota.remaining_fraction === null ||
					modelQuota.remaining_fraction === undefined
						? 0
						: modelQuota.remaining_fraction;

				let matches = false;
				if (groupConfig.patterns) {
					matches = groupConfig.patterns.some((pattern) =>
						pattern.test(modelId),
					);
				} else if (groupConfig.models) {
					matches = groupConfig.models.includes(modelId);
				}

				if (!matches) continue;

				if (isCurrentlyDisabled) {
					if (remaining < groupConfig.threshold + hysteresis) {
						shouldDisable = true;
						triggerModel = { modelId, remaining };
						break;
					}
				} else {
					if (remaining < groupConfig.threshold) {
						shouldDisable = true;
						triggerModel = { modelId, remaining };
						logger.info("Antigravity 阈值触发", {
							name: account.name,
							group: groupName,
							modelId,
							remaining: `${(remaining * 100).toFixed(1)}%`,
							threshold: `${(groupConfig.threshold * 100).toFixed(1)}%`,
						});
						break;
					}
				}
			}

			if (shouldDisable && triggerModel) {
				disableGroups[groupName] = {
					mode: "auto",
					disabled_at:
						currentDisabledGroups[groupName]?.disabled_at || Date.now(),
					reason: `${triggerModel.modelId} remaining ${(triggerModel.remaining * 100).toFixed(1)}% < ${(groupConfig.threshold * 100).toFixed(1)}%`,
					threshold: groupConfig.threshold,
					observed: {
						model_id: triggerModel.modelId,
						remaining_fraction: triggerModel.remaining,
					},
				};
			} else if (isCurrentlyDisabled && !shouldDisable) {
				recoveredGroups.push(groupName);
			}
		}

		if (Object.keys(disableGroups).length > 0 || recoveredGroups.length > 0) {
			const groupsData = { version: 1, groups: disableGroups };
			this.db.setSetting(
				`cliproxy_auto_disabled_groups_${account.name}`,
				JSON.stringify(groupsData),
			);

			if (Object.keys(disableGroups).length > 0) {
				const groupNames = Object.keys(disableGroups).join(", ");
				logger.warn("模型组额度低于阈值，已记录禁用状态", {
					name: account.name,
					provider: account.provider,
					groups: groupNames,
				});
			}

			if (recoveredGroups.length > 0) {
				logger.info("模型组额度已恢复", {
					name: account.name,
					provider: account.provider,
					groups: recoveredGroups.join(", "),
				});
			}
		}

		return { disableGroups };
	}

	async checkAntigravityRecovery(account, config) {
		const quota = account.quota || {};
		const hysteresis = 0.05;

		const groupsJson =
			this.db.getSetting(`cliproxy_auto_disabled_groups_${account.name}`) ||
			"{}";
		let disabledGroups = {};
		try {
			const parsed = JSON.parse(groupsJson);
			disabledGroups = parsed.groups || {};
		} catch {
			disabledGroups = {};
		}

		if (Object.keys(disabledGroups).length === 0) {
			return { shouldEnable: false, reason: "" };
		}

		const modelGroups = {
			claude_gpt: {
				patterns: [/^claude-/, /^gpt-/, /^o\d/],
				threshold: config.claude_gpt,
			},
			gemini_3_pro: {
				models: ["gemini-3-pro"],
				threshold: config.gemini_3_pro,
			},
			gemini_3_pro_high: {
				models: ["gemini-3-pro-high"],
				threshold: config.gemini_3_pro_high,
			},
			gemini_3_flash: {
				models: ["gemini-3-flash"],
				threshold: config.gemini_3_flash,
			},
			gemini_3_pro_image: {
				models: ["gemini-3-pro-image"],
				threshold: config.gemini_3_pro_image,
			},
		};

		const recoveredGroups = [];

		for (const [groupName, groupInfo] of Object.entries(disabledGroups)) {
			const groupConfig = modelGroups[groupName];
			if (!groupConfig || groupConfig.threshold === undefined) continue;

			let canRecover = true;

			for (const [modelId, modelQuota] of Object.entries(quota)) {
				if (!modelQuota || modelQuota.remaining_fraction === undefined)
					continue;

				let matches = false;
				if (groupConfig.patterns) {
					matches = groupConfig.patterns.some((pattern) =>
						pattern.test(modelId),
					);
				} else if (groupConfig.models) {
					matches = groupConfig.models.includes(modelId);
				}

				if (
					matches &&
					modelQuota.remaining_fraction < groupConfig.threshold + hysteresis
				) {
					canRecover = false;
					break;
				}
			}

			if (canRecover) {
				recoveredGroups.push(groupName);
			}
		}

		if (recoveredGroups.length > 0) {
			for (const groupName of recoveredGroups) {
				delete disabledGroups[groupName];
			}

			if (Object.keys(disabledGroups).length === 0) {
				this.db.deleteSetting(`cliproxy_auto_disabled_groups_${account.name}`);
			} else {
				this.db.setSetting(
					`cliproxy_auto_disabled_groups_${account.name}`,
					JSON.stringify({ version: 1, groups: disabledGroups }),
				);
			}

			return {
				shouldEnable: false,
				reason: `模型组 ${recoveredGroups.join(", ")} 已恢复`,
			};
		}

		return { shouldEnable: false, reason: "" };
	}
}
