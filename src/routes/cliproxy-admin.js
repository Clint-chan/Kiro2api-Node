import express from "express";
import { CLIProxyClient } from "../cliproxy-client.js";

export function createCLIProxyAdminRouter() {
	const router = express.Router();

	const client = new CLIProxyClient(
		process.env.CLIPROXY_MANAGEMENT_URL,
		process.env.CLIPROXY_MANAGEMENT_KEY,
	);

	router.get("/auth-files", async (req, res) => {
		try {
			const forceRefresh = req.query.refresh === "true";
			const result = await client.getCachedAuthFiles(forceRefresh);
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.delete("/auth-files", async (req, res) => {
		try {
			const { name } = req.query;
			const result = await client.deleteAuthFile(name);
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.get("/auth-files/models", async (req, res) => {
		try {
			const { name } = req.query;
			const result = await client.getAuthFileModels(name);
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.patch("/auth-files/status", async (req, res) => {
		try {
			const { name, disabled } = req.body;
			const result = await client.patchAuthFileStatus(name, disabled);
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	// OAuth 流程
	router.get("/antigravity-auth-url", async (_req, res) => {
		try {
			const result = await client.getAntigravityAuthUrl();
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.get("/auth-status", async (req, res) => {
		try {
			const { state } = req.query;
			const result = await client.getAuthStatus(state);
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	// 使用统计
	router.get("/usage", async (_req, res) => {
		try {
			const result = await client.getUsage();
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.get("/usage/export", async (_req, res) => {
		try {
			const result = await client.exportUsage();
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.post("/usage/import", async (req, res) => {
		try {
			const result = await client.importUsage(req.body);
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	// 日志
	router.get("/logs", async (req, res) => {
		try {
			const { after } = req.query;
			const result = await client.getLogs(after);
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.delete("/logs", async (_req, res) => {
		try {
			const result = await client.deleteLogs();
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.get("/request-error-logs", async (_req, res) => {
		try {
			const result = await client.getRequestErrorLogs();
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.get("/request-error-logs/:name", async (req, res) => {
		try {
			const { name } = req.params;
			const content = await client.downloadRequestErrorLog(name);
			res.type("text/plain").send(content);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	// 配置
	router.get("/config", async (_req, res) => {
		try {
			const result = await client.getConfig();
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.get("/debug", async (_req, res) => {
		try {
			const result = await client.getDebug();
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.put("/debug", async (req, res) => {
		try {
			const { value } = req.body;
			const result = await client.putDebug(value);
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.get("/proxy-url", async (_req, res) => {
		try {
			const result = await client.getProxyUrl();
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.put("/proxy-url", async (req, res) => {
		try {
			const { value } = req.body;
			const result = await client.putProxyUrl(value);
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.delete("/proxy-url", async (_req, res) => {
		try {
			const result = await client.deleteProxyUrl();
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.post("/api-call", async (req, res) => {
		try {
			const { authIndex, method, url, header, data } = req.body;

			if (!method || !url) {
				return res.status(400).json({ error: "method and url are required" });
			}

			const allowedMethods = ["GET", "POST"];
			if (!allowedMethods.includes(method.toUpperCase())) {
				return res.status(400).json({
					error: `Method ${method} not allowed. Only GET and POST are supported.`,
				});
			}

			let parsedUrl;
			try {
				parsedUrl = new URL(url);
			} catch (_e) {
				return res.status(400).json({ error: "Invalid URL format" });
			}

			const allowedDomains = [
				"daily-cloudcode-pa.googleapis.com",
				"api.anthropic.com",
				"api.openai.com",
				"chatgpt.com",
			];

			if (!allowedDomains.includes(parsedUrl.hostname)) {
				return res.status(403).json({
					error: `Domain ${parsedUrl.hostname} not allowed. Only whitelisted domains are permitted.`,
				});
			}

			const blockedIPs = [
				"127.0.0.1",
				"localhost",
				"0.0.0.0",
				"::1",
				"169.254.169.254",
			];
			if (blockedIPs.includes(parsedUrl.hostname)) {
				return res.status(403).json({
					error: "Access to local/private addresses is forbidden",
				});
			}

			if (
				parsedUrl.hostname.match(
					/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/,
				)
			) {
				return res.status(403).json({
					error: "Access to private network ranges is forbidden",
				});
			}

			const allowedHeaders = [
				"content-type",
				"authorization",
				"anthropic-version",
				"anthropic-beta",
				"user-agent",
				"chatgpt-account-id",
			];
			if (header && typeof header === "object") {
				const headerKeys = Object.keys(header).map((k) => k.toLowerCase());
				const invalidHeaders = headerKeys.filter(
					(k) => !allowedHeaders.includes(k),
				);
				if (invalidHeaders.length > 0) {
					return res.status(400).json({
						error: `Headers not allowed: ${invalidHeaders.join(", ")}`,
					});
				}
			}

			const result = await client.apiCall(authIndex, method, url, header, data);
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.get("/request-retry", async (_req, res) => {
		try {
			const result = await client.getRequestRetry();
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.put("/request-retry", async (req, res) => {
		try {
			const { value } = req.body;
			const result = await client.putRequestRetry(value);
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.get("/quota-exceeded", async (_req, res) => {
		try {
			const result = await client.getQuotaExceeded();
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.put("/quota-exceeded/switch-project", async (req, res) => {
		try {
			const { value } = req.body;
			const result = await client.putQuotaExceededSwitchProject(value);
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.put("/quota-exceeded/switch-preview-model", async (req, res) => {
		try {
			const { value } = req.body;
			const result = await client.putQuotaExceededSwitchPreviewModel(value);
			res.json(result);
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	return router;
}

export function createCLIProxyThresholdRouter(db) {
	const router = express.Router();

	const allowedKeys = new Set([
		"five_hour",
		"seven_day",
		"seven_day_sonnet",
		"weekly",
		"code_review",
		"claude_gpt",
		"gemini",
	]);

	const normalizeThresholdConfig = (input) => {
		if (!input || typeof input !== "object" || Array.isArray(input)) {
			return {};
		}

		const normalized = {};
		for (const [key, value] of Object.entries(input)) {
			if (!allowedKeys.has(key)) continue;
			const num = Number(value);
			if (Number.isFinite(num) && num > 0 && num <= 1) {
				normalized[key] = num;
			}
		}
		return normalized;
	};

	router.get("/threshold-config", (req, res) => {
		try {
			const { name } = req.query;
			if (!name) {
				return res.status(400).json({ error: "Account name required" });
			}

			const configJson = db.getSetting(`cliproxy_threshold_${name}`) || "{}";
			let rawConfig = {};
			try {
				rawConfig = JSON.parse(configJson);
			} catch {
				rawConfig = {};
			}

			const config = normalizeThresholdConfig(rawConfig);
			res.json({ config });
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	router.post("/threshold-config", (req, res) => {
		try {
			const { name, config } = req.body;
			if (
				!name ||
				!config ||
				typeof config !== "object" ||
				Array.isArray(config)
			) {
				return res.status(400).json({ error: "Name and config required" });
			}

			const normalizedConfig = normalizeThresholdConfig(config);

			db.setSetting(
				`cliproxy_threshold_${name}`,
				JSON.stringify(normalizedConfig),
			);

			res.json({ success: true });
		} catch (error) {
			res.status(500).json({ error: error.message });
		}
	});

	return router;
}
