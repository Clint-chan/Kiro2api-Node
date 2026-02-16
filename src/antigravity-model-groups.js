/**
 * Antigravity 模型组映射
 * 统一定义模型组，避免在多处重复定义导致不一致
 */

export const MODEL_GROUPS = {
	claude_gpt: {
		patterns: [/^claude-/, /^gpt-/, /^o\d/],
		displayName: "Claude/GPT 共享",
	},
	gemini_3_pro: {
		models: ["gemini-3-pro"],
		displayName: "Gemini 3 Pro",
	},
	gemini_3_pro_high: {
		models: ["gemini-3-pro-high"],
		displayName: "Gemini 3 Pro (High)",
	},
	gemini_3_flash: {
		models: ["gemini-3-flash"],
		displayName: "Gemini 3 Flash",
	},
	gemini_3_pro_image: {
		models: ["gemini-3-pro-image"],
		displayName: "Gemini 3 Pro Image",
	},
};

/**
 * 根据模型 ID 获取所属的模型组名称
 * @param {string} modelId - 模型 ID
 * @returns {string|null} 模型组名称，如果不属于任何组则返回 null
 */
export function getModelGroupName(modelId) {
	for (const [groupName, groupConfig] of Object.entries(MODEL_GROUPS)) {
		if (groupConfig.patterns) {
			if (groupConfig.patterns.some((pattern) => pattern.test(modelId))) {
				return groupName;
			}
		} else if (groupConfig.models) {
			if (groupConfig.models.includes(modelId)) {
				return groupName;
			}
		}
	}
	return null;
}

/**
 * 检查模型是否匹配指定的模型组
 * @param {string} modelId - 模型 ID
 * @param {string} groupName - 模型组名称
 * @returns {boolean} 是否匹配
 */
export function isModelInGroup(modelId, groupName) {
	const groupConfig = MODEL_GROUPS[groupName];
	if (!groupConfig) return false;

	if (groupConfig.patterns) {
		return groupConfig.patterns.some((pattern) => pattern.test(modelId));
	}
	if (groupConfig.models) {
		return groupConfig.models.includes(modelId);
	}
	return false;
}

/**
 * 获取所有模型组的配置（用于阈值检查器）
 * @param {object} thresholdConfig - 阈值配置对象
 * @returns {object} 带阈值的模型组配置
 */
export function getModelGroupsWithThresholds(thresholdConfig) {
	const result = {};
	for (const [groupName, groupConfig] of Object.entries(MODEL_GROUPS)) {
		if (thresholdConfig[groupName] !== undefined) {
			result[groupName] = {
				...groupConfig,
				threshold: thresholdConfig[groupName],
			};
		}
	}
	return result;
}
