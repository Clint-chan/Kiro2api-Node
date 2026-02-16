import { logger } from "./logger.js";

/**
 * 通用模型冷却管理器
 * 支持多模型配置，可通过数据库动态配置冷却策略
 */
class ModelCooldownManager {
	constructor(db) {
		this.db = db;
		this.cooldowns = new Map(); // key: "channel:model", value: cooldownUntil timestamp
		this.failureCounts = new Map(); // key: "channel:model", value: failure count
	}

	/**
	 * 获取模型冷却配置
	 * @returns {Object} 配置对象，格式: { "model-id": { enabled, threshold, duration } }
	 */
	getConfig() {
		try {
			const configJson = this.db.getSetting("model_cooldown_config") || "{}";
			return JSON.parse(configJson);
		} catch (error) {
			logger.error("Failed to load model cooldown config", { error });
			return {};
		}
	}

	/**
	 * 记录模型失败
	 * @param {string} channel - 渠道名称（如 'kiro'）
	 * @param {string} model - 模型名称
	 */
	recordFailure(channel, model) {
		// 只对 kiro 渠道启用冷却
		if (channel !== "kiro") return;

		const config = this.getConfig();
		const modelConfig = config[model];

		// 如果模型未配置或未启用冷却，则跳过
		if (!modelConfig || !modelConfig.enabled) return;

		const key = `${channel}:${model}`;
		const currentCount = (this.failureCounts.get(key) || 0) + 1;
		this.failureCounts.set(key, currentCount);

		logger.debug("Model failure recorded", {
			channel,
			model,
			count: currentCount,
			threshold: modelConfig.threshold,
		});

		// 达到阈值，触发冷却
		if (currentCount >= modelConfig.threshold) {
			this.markCooldown(channel, model, modelConfig.duration);
			this.failureCounts.delete(key);
		}
	}

	/**
	 * 标记模型进入冷却期
	 * @param {string} channel - 渠道名称
	 * @param {string} model - 模型名称
	 * @param {number} durationMinutes - 冷却时长（分钟）
	 */
	markCooldown(channel, model, durationMinutes) {
		const key = `${channel}:${model}`;
		const cooldownUntil = Date.now() + durationMinutes * 60 * 1000;
		this.cooldowns.set(key, cooldownUntil);

		logger.warn("Model entered cooldown", {
			channel,
			model,
			cooldownUntil: new Date(cooldownUntil).toISOString(),
			durationMinutes,
		});
	}

	/**
	 * 检查模型是否在冷却期
	 * @param {string} channel - 渠道名称
	 * @param {string} model - 模型名称
	 * @returns {boolean} 是否在冷却期
	 */
	isInCooldown(channel, model) {
		const key = `${channel}:${model}`;
		const cooldownUntil = this.cooldowns.get(key);

		if (!cooldownUntil) return false;

		const now = Date.now();
		if (now < cooldownUntil) {
			return true;
		}

		// 冷却期已过，清理状态
		this.cooldowns.delete(key);
		this.failureCounts.delete(key);
		logger.info("Model cooldown expired", { channel, model });
		return false;
	}

	/**
	 * 获取剩余冷却时间（秒）
	 * @param {string} channel - 渠道名称
	 * @param {string} model - 模型名称
	 * @returns {number} 剩余秒数
	 */
	getRemainingCooldown(channel, model) {
		const key = `${channel}:${model}`;
		const cooldownUntil = this.cooldowns.get(key);

		if (!cooldownUntil || Date.now() >= cooldownUntil) return 0;
		return Math.ceil((cooldownUntil - Date.now()) / 1000);
	}

	/**
	 * 手动清除模型冷却
	 * @param {string} channel - 渠道名称
	 * @param {string} model - 模型名称
	 */
	clearCooldown(channel, model) {
		const key = `${channel}:${model}`;
		this.cooldowns.delete(key);
		this.failureCounts.delete(key);
		logger.info("Model cooldown cleared manually", { channel, model });
	}

	/**
	 * 获取所有冷却状态
	 * @returns {Array} 冷却状态列表
	 */
	getStatus() {
		const status = [];
		for (const [key, cooldownUntil] of this.cooldowns.entries()) {
			const [channel, model] = key.split(":");
			status.push({
				channel,
				model,
				cooldownUntil: new Date(cooldownUntil).toISOString(),
				remainingSeconds: this.getRemainingCooldown(channel, model),
			});
		}
		return status;
	}
}

let instance = null;

/**
 * 初始化模型冷却管理器
 * @param {Object} db - 数据库实例
 * @returns {ModelCooldownManager} 冷却管理器实例
 */
export function initModelCooldown(db) {
	instance = new ModelCooldownManager(db);
	return instance;
}

/**
 * 获取模型冷却管理器实例
 * @returns {ModelCooldownManager} 冷却管理器实例
 */
export function getModelCooldown() {
	if (!instance) {
		throw new Error("ModelCooldownManager not initialized");
	}
	return instance;
}
