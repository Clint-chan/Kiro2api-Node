import express from "express";
import { logger } from "../../logger.js";

export function createSettingsAdminRouter(db) {
	const router = express.Router();

	/**
	 * GET /api/admin/settings
	 * Get all system settings
	 */
	router.get("/settings", (_, res) => {
		try {
			const settings = db.db.prepare("SELECT * FROM system_settings").all();

			const settingsObj = {};
			for (const setting of settings) {
				settingsObj[setting.key] = setting.value;
			}

			res.json({
				success: true,
				data: settingsObj,
			});
		} catch (error) {
			logger.error("Get settings error", { error });
			res.status(500).json({
				error: {
					type: "internal_error",
					message: "Failed to retrieve settings.",
				},
			});
		}
	});

	/**
	 * PUT /api/admin/settings
	 * Update system settings
	 */
	router.put("/settings", (req, res) => {
		try {
			const updates = req.body;

			for (const [key, value] of Object.entries(updates)) {
				db.setSetting(key, value);
			}

			res.json({
				success: true,
				message: "Settings updated successfully.",
			});
		} catch (error) {
			logger.error("Update settings error", { error });
			res.status(500).json({
				error: {
					type: "internal_error",
					message: "Failed to update settings.",
				},
			});
		}
	});

	/**
	 * GET /api/admin/settings/model-cooldown-config
	 * Get model cooldown configuration
	 */
	router.get("/settings/model-cooldown-config", (_req, res) => {
		try {
			const configJson = db.getSetting("model_cooldown_config") || "{}";
			const config = JSON.parse(configJson);
			res.json({ config });
		} catch (error) {
			logger.error("Get model cooldown config error", { error });
			res.status(500).json({ error: error.message });
		}
	});

	/**
	 * POST /api/admin/settings/model-cooldown-config
	 * Save model cooldown configuration
	 */
	router.post("/settings/model-cooldown-config", (req, res) => {
		try {
			const { config } = req.body;
			if (!config || typeof config !== "object") {
				return res.status(400).json({ error: "Invalid config format" });
			}

			db.setSetting("model_cooldown_config", JSON.stringify(config));
			res.json({ success: true });
		} catch (error) {
			logger.error("Save model cooldown config error", { error });
			res.status(500).json({ error: error.message });
		}
	});

	router.get("/settings/fetch-models", async (req, res) => {
		try {
			const { channel, provider } = req.query;

			// CLIProxy 渠道
			if (channel === "cliproxy") {
				const client = new (
					await import("../../cliproxy-client.js")
				).CLIProxyClient(
					process.env.CLIPROXY_MANAGEMENT_URL,
					process.env.CLIPROXY_MANAGEMENT_KEY,
				);

				// 尝试获取账号列表
				const result = await client.getCachedAuthFiles(false);
				const files = result.files || [];

				// 过滤 provider (antigravity 或 codex)
				const targetProvider = provider || "antigravity";

				// 优先寻找 Pro/Pro+ 账号，然后是 active 账号
				let targetAccount = files.find(
					(f) =>
						f.provider === targetProvider &&
						!f.disabled &&
						(f.subscription_type === "Pro+" || f.plan_type === "pro"),
				);

				if (!targetAccount) {
					targetAccount = files.find(
						(f) => f.provider === targetProvider && !f.disabled,
					);
				}

				if (!targetAccount) {
					return res.json({ models: [] });
				}

				const modelsResult = await client.getAuthFileModels(targetAccount.name);
				const models = modelsResult.models || [];

				// Persist models to settings
				const settingKey = `models_cliproxy_${targetProvider}`;
				db.setSetting(settingKey, JSON.stringify(models));

				return res.json({ models });
			}

			// Kiro 渠道 (模拟)
			if (channel === "kiro") {
				const models = [
					"claude-sonnet-4-5-20250929",
					"claude-opus-4-5-20251101",
					"claude-opus-4-6-20251220",
					"claude-haiku-4-5-20251001",
				];

				db.setSetting("models_kiro", JSON.stringify(models));

				return res.json({ models });
			}

			return res.json({ models: [] });
		} catch (error) {
			logger.error("Fetch models error", { error });
			res.status(500).json({ error: error.message });
		}
	});

	return router;
}
