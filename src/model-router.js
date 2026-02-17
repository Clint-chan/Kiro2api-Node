import { isAntigravityModel } from "./antigravity.js";
import { isCodexModel } from "./codex.js";
import { logger } from "./logger.js";
import { getModelCooldown } from "./model-cooldown.js";

/**
 * Opus 模型需要 Pro 或更高级别的 Kiro 账号
 */
const OPUS_MODELS = new Set([
	"claude-opus-4-5",
	"claude-opus-4-5-20251101",
	"claude-opus-4-6",
	"claude-opus-4-6-20251220",
	"claude-opus-4.5",
	"claude-opus-4.6",
]);

/**
 * 模型到 Antigravity 的映射（fallback）
 * 注：Claude Opus 4.5 已不可用，已升级至 Opus 4.6
 */
const KIRO_TO_ANTIGRAVITY_FALLBACK = {
	"claude-opus-4-5": "claude-opus-4-6-thinking",
	"claude-opus-4-5-20251101": "claude-opus-4-6-thinking",
	"claude-opus-4-6": "claude-opus-4-6-thinking",
	"claude-opus-4.6": "claude-opus-4-6-thinking",
};

function parseAllowedChannels(user) {
	if (!user || !user.allowed_channels) {
		logger.debug("hasAntigravityPermission check", {
			hasUser: !!user,
			allowedChannels: user?.allowed_channels,
		});
		return [];
	}

	let channels;
	if (Array.isArray(user.allowed_channels)) {
		channels = user.allowed_channels;
	} else if (typeof user.allowed_channels === "string") {
		try {
			const parsed = JSON.parse(user.allowed_channels);
			channels = Array.isArray(parsed) ? parsed : [user.allowed_channels];
		} catch {
			channels = String(user.allowed_channels)
				.split(",")
				.map((c) => c.trim());
		}
	} else {
		return [];
	}

	return channels;
}

function hasChannelPermission(user, channel) {
	const channels = parseAllowedChannels(user);
	if (channels.length === 0) return false;

	const hasPermission = channels.includes(channel);
	logger.debug("hasChannelPermission result", {
		channel,
		channels,
		hasPermission,
	});
	return hasPermission;
}

/**
 * 检查模型是否需要 Pro 级别账号
 */
export function requiresProAccount(model) {
	const normalized = String(model || "").toLowerCase();
	return OPUS_MODELS.has(model) || normalized.includes("opus");
}

/**
 * 检查 Kiro 账号池是否有支持该模型的账号
 */
export function hasKiroAccountForModel(accountPool, model) {
	if (!requiresProAccount(model)) {
		// Sonnet/Haiku 模型，free 账号即可
		return true;
	}

	// Opus 模型需要检查是否有 Pro/Team 账号
	const accounts = Array.from(accountPool.accounts.values());
	const eligibleAccounts = accounts.filter((account) => {
		if (account.status !== "active") return false;

		const subscriptionType = account.usage?.subscriptionType;
		if (!subscriptionType) return false;

		const tier = subscriptionType.toUpperCase();
		return tier.includes("PRO") || tier.includes("TEAM");
	});

	return eligibleAccounts.length > 0;
}

/**
 * 检查 Antigravity 账号池中是否有高配额账号（>20%）
 * @param {object} db - 数据库实例
 * @param {string} modelId - 模型 ID（如 claude-opus-4-6-thinking）
 * @returns {boolean}
 */
function hasAntigravityHighQuota(db, modelId) {
	try {
		const accounts = db.getAllAntigravityAccounts("active");
		if (!accounts || accounts.length === 0) return false;

		for (const account of accounts) {
			if (!account.model_quotas) continue;

			let quotas;
			try {
				quotas =
					typeof account.model_quotas === "string"
						? JSON.parse(account.model_quotas)
						: account.model_quotas;
			} catch {
				continue;
			}

			if (!quotas || typeof quotas !== "object") continue;

			const modelQuota = quotas[modelId];
			if (!modelQuota || typeof modelQuota !== "object") continue;

			const remainingFraction = Number(modelQuota.remaining_fraction);
			if (Number.isFinite(remainingFraction) && remainingFraction > 0.2) {
				logger.debug("Found Antigravity account with high quota", {
					accountId: account.id,
					accountName: account.name,
					modelId,
					remainingFraction,
				});
				return true;
			}
		}

		return false;
	} catch (error) {
		logger.error("Error checking Antigravity quota", { error });
		return false;
	}
}

/**
 * 智能路由：决定使用哪个渠道
 * @param {string} model - 模型名称
 * @param {object} accountPool - 账号池对象
 * @param {object} user - 用户对象（用于权限检查）
 * @returns {object} { channel: 'kiro'|'antigravity'|'codex'|'claudecode', model: string, reason: string }
 */
export function routeModel(model, accountPool, user = null) {
	// 1. 如果已经是 Antigravity 专属模型，直接使用 Antigravity
	if (isAntigravityModel(model)) {
		return {
			channel: "antigravity",
			model: model,
			reason: "antigravity_exclusive",
		};
	}

	// 1.5. Codex 模型直接使用 codex channel
	if (isCodexModel(model)) {
		return {
			channel: "codex",
			model: model,
			reason: "codex_model",
		};
	}

	if (!requiresProAccount(model)) {
		return {
			channel: "kiro",
			model: model,
			reason: "kiro_free_supported",
		};
	}

	let kiroInCooldown = false;
	try {
		const cooldown = getModelCooldown();
		kiroInCooldown = cooldown.isInCooldown("kiro", model);

		if (kiroInCooldown) {
			logger.info("Kiro model in cooldown, skipping Kiro channel", {
				model,
				remainingSeconds: cooldown.getRemainingCooldown("kiro", model),
			});
		} else {
			if (hasKiroAccountForModel(accountPool, model)) {
				return {
					channel: "kiro",
					model: model,
					reason: "kiro_pro_available",
				};
			}
		}
	} catch (error) {
		logger.error("Cooldown check failed", { error });
		if (hasKiroAccountForModel(accountPool, model)) {
			return {
				channel: "kiro",
				model: model,
				reason: "kiro_pro_available",
			};
		}
	}

	const hasAntigravityPermission = hasChannelPermission(user, "antigravity");
	const hasClaudeCodePermission = hasChannelPermission(user, "claudecode");
	const antigravityModel =
		KIRO_TO_ANTIGRAVITY_FALLBACK[model] || `${model}-thinking`;

	if (hasAntigravityPermission && accountPool.db) {
		const hasHighQuota = hasAntigravityHighQuota(
			accountPool.db,
			antigravityModel,
		);

		if (hasHighQuota) {
			return {
				channel: "antigravity",
				model: antigravityModel,
				reason: kiroInCooldown
					? "kiro_cooldown_antigravity_fallback"
					: "antigravity_high_quota",
			};
		}
	}

	if (hasClaudeCodePermission) {
		return {
			channel: "claudecode",
			model: "claude-opus-4-6-20251220",
			reason: kiroInCooldown
				? "kiro_cooldown_claudecode_fallback"
				: "antigravity_low_quota_fallback",
		};
	}

	if (hasAntigravityPermission) {
		return {
			channel: "antigravity",
			model: antigravityModel,
			reason: kiroInCooldown
				? "kiro_cooldown_antigravity_fallback"
				: "antigravity_low_quota_fallback",
		};
	}

	return {
		channel: null,
		model: model,
		reason: "no_available_channel",
		error: `Model '${model}' requires Pro account. No available channel found.`,
	};
}

/**
 * 获取模型的渠道（兼容旧接口）
 */
export function resolveModelChannel(model, accountPool) {
	const route = routeModel(model, accountPool);
	return route.channel;
}
