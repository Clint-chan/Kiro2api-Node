/**
 * Kiro Direct Channel Support
 * Handles kiro- prefixed models to force routing through Kiro channel
 */

// Model alias mapping: kiro-prefixed model -> actual Kiro model ID
const KIRO_MODEL_ALIAS = {
	"kiro-claude-opus-4-6": "claude-opus-4-6-20251220",
	"kiro-claude-opus-4-6-20251220": "claude-opus-4-6-20251220",
	"kiro-claude-opus-4-5": "claude-opus-4-5",
	"kiro-claude-opus-4-5-20251101": "claude-opus-4-5-20251101",
	"kiro-claude-sonnet-4-6": "claude-sonnet-4-6",
	"kiro-claude-sonnet-4-5": "claude-sonnet-4-5-20250929",
	"kiro-claude-sonnet-4-5-20250929": "claude-sonnet-4-5-20250929",
	"kiro-claude-haiku-4-5": "claude-haiku-4-5-20251001",
	"kiro-claude-haiku-4-5-20251001": "claude-haiku-4-5-20251001",
};

// Static model list for /v1/models endpoint
export const KIRO_STATIC_MODELS = [
	{
		id: "kiro-claude-sonnet-4-6",
		upstream: "claude-sonnet-4-6",
		owned_by: "anthropic",
		display_name: "Claude Sonnet 4.6",
	},
	{
		id: "kiro-claude-opus-4-6-20251220",
		upstream: "claude-opus-4-6-20251220",
		owned_by: "anthropic",
		display_name: "Claude Opus 4.6",
	},
	{
		id: "kiro-claude-opus-4-5",
		upstream: "claude-opus-4-5",
		owned_by: "anthropic",
		display_name: "Claude Opus 4.5",
	},
	{
		id: "kiro-claude-sonnet-4-5-20250929",
		upstream: "claude-sonnet-4-5-20250929",
		owned_by: "anthropic",
		display_name: "Claude Sonnet 4.5",
	},
	{
		id: "kiro-claude-haiku-4-5-20251001",
		upstream: "claude-haiku-4-5-20251001",
		owned_by: "anthropic",
		display_name: "Claude Haiku 4.5",
	},
];

/**
 * Check if a model ID is a Kiro direct model (with kiro- prefix)
 * @param {string} model - Model ID to check
 * @returns {boolean}
 */
export function isKiroDirectModel(model) {
	const m = String(model || "").trim();
	if (!m) return false;

	// Check if it has kiro- prefix
	if (m.startsWith("kiro-")) return true;

	return false;
}

/**
 * Resolve kiro- prefixed model to actual Kiro model ID
 * @param {string} model - Model ID (may have kiro- prefix)
 * @returns {string} - Actual Kiro model ID
 */
export function resolveKiroDirectModel(model) {
	const m = String(model || "").trim();
	if (!m) return "";

	// Check alias mapping first
	if (KIRO_MODEL_ALIAS[m]) return KIRO_MODEL_ALIAS[m];

	// Strip kiro- prefix
	if (m.startsWith("kiro-")) return m.replace(/^kiro-/, "");

	return m;
}
