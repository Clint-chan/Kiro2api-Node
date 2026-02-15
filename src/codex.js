// Codex model detection and static model list
// Following the pattern of src/antigravity.js

const CODEX_MODELS = new Set([
	"gpt-5.3-codex",
	"gpt-5.2-codex",
	"gpt-5.1-codex-max",
	"gpt-5.2",
	"gpt-5.1-codex-mini",
]);

export function isCodexModel(model) {
	const m = String(model || "").trim();
	if (!m) return false;
	return CODEX_MODELS.has(m);
}

export const CODEX_STATIC_MODELS = [
	{
		id: "gpt-5.3-codex",
		upstream: "gpt-5.3-codex",
		owned_by: "codex",
		display_name: "GPT 5.3 Codex",
	},
	{
		id: "gpt-5.2-codex",
		upstream: "gpt-5.2-codex",
		owned_by: "codex",
		display_name: "GPT 5.2 Codex",
	},
	{
		id: "gpt-5.1-codex-max",
		upstream: "gpt-5.1-codex-max",
		owned_by: "codex",
		display_name: "GPT 5.1 Codex Max",
	},
	{
		id: "gpt-5.2",
		upstream: "gpt-5.2",
		owned_by: "codex",
		display_name: "GPT 5.2",
	},
	{
		id: "gpt-5.1-codex-mini",
		upstream: "gpt-5.1-codex-mini",
		owned_by: "codex",
		display_name: "GPT 5.1 Codex Mini",
	},
];
