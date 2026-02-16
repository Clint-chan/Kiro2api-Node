import { Router } from "express";
import {
	callAntigravity,
	callAntigravityStream,
	resolveAntigravityUpstreamModel,
} from "../antigravity.js";
import { getModelGroupName } from "../antigravity-model-groups.js";
import { userAuthMiddleware } from "../middleware/auth.js";
import { isChannelAllowed } from "../user-permissions.js";

export function createAntigravityNativeRouter(state) {
	const router = Router();

	router.use(
		[
			"/v1internal:generateContent",
			"/v1internal:countTokens",
			"/v1internal:fetchAvailableModels",
			"/v1internal:streamGenerateContent",
		],
		userAuthMiddleware(state.db),
	);

	function parseJsonSafe(value) {
		if (typeof value !== "string") return null;
		try {
			return JSON.parse(value);
		} catch {
			return null;
		}
	}

	function hasQuotaForModel(account, modelId) {
		const quotas = parseJsonSafe(account?.model_quotas);
		if (!quotas || typeof quotas !== "object") return true;
		const info = quotas[modelId];
		if (!info || typeof info !== "object") return true;
		const remaining = Number(info.remaining_fraction);
		if (!Number.isFinite(remaining)) return true;
		if (remaining <= 0) return false;

		const groupsJson =
			state.db.getSetting(`cliproxy_auto_disabled_groups_${account.name}`) ||
			"{}";
		let disabledGroups = {};
		try {
			const parsed = JSON.parse(groupsJson);
			disabledGroups = parsed.groups || {};
		} catch {
			return true;
		}

		if (Object.keys(disabledGroups).length === 0) return true;

		const groupName = getModelGroupName(modelId);
		if (!groupName) return true;

		return !disabledGroups[groupName];
	}

	function getEligibleAntigravityAccounts(modelId, excludedIds = new Set()) {
		const accounts = state.db.getAllAntigravityAccounts("active") || [];
		const upstreamModel = resolveAntigravityUpstreamModel(modelId);

		const filtered = accounts.filter((account) => {
			if (excludedIds.has(account.id)) return false;
			if (!upstreamModel) return true;
			return hasQuotaForModel(account, upstreamModel);
		});

		filtered.sort((a, b) => {
			const scoreA = (a.error_count || 0) * 5 + (a.request_count || 0);
			const scoreB = (b.error_count || 0) * 5 + (b.request_count || 0);
			return scoreA - scoreB;
		});

		return filtered;
	}

	function isAntigravityRateLimit(error) {
		if (error?.status === 429) return true;
		const msg = String(error?.message || "").toLowerCase();
		return (
			msg.includes("resource has been exhausted") ||
			msg.includes("rate limit") ||
			msg.includes("rate_limit")
		);
	}

	async function executeWithFailover(modelId, executor) {
		const excluded = new Set();
		let lastError = null;

		while (true) {
			const accounts = getEligibleAntigravityAccounts(modelId, excluded);
			if (accounts.length === 0) break;

			const account = accounts[0];
			try {
				const result = await executor(account);
				state.db.updateAntigravityAccountStats(account.id, false);
				return result;
			} catch (error) {
				lastError = error;
				state.db.updateAntigravityAccountStats(account.id, true);
				if (isAntigravityRateLimit(error)) {
					excluded.add(account.id);
					continue;
				}
				throw error;
			}
		}

		if (lastError) throw lastError;
		throw new Error("No active Antigravity accounts available");
	}

	async function executeNative(path, req, res) {
		if (!isChannelAllowed(req.user, "antigravity")) {
			return res.status(403).json({
				error: {
					type: "permission_error",
					message: "Channel 'antigravity' is not enabled for this API key.",
				},
			});
		}

		const response = await executeWithFailover(
			req.body?.model,
			async (account) => {
				return callAntigravity(state.db, account, path, req.body || {});
			},
		);
		return res.json(response);
	}

	router.post("/v1internal:generateContent", async (req, res) => {
		try {
			return await executeNative("/v1internal:generateContent", req, res);
		} catch (error) {
			return res
				.status(500)
				.json({ error: error.message || "Antigravity generateContent failed" });
		}
	});

	router.post("/v1internal:countTokens", async (req, res) => {
		try {
			return await executeNative("/v1internal:countTokens", req, res);
		} catch (error) {
			return res
				.status(500)
				.json({ error: error.message || "Antigravity countTokens failed" });
		}
	});

	router.post("/v1internal:fetchAvailableModels", async (req, res) => {
		try {
			return await executeNative("/v1internal:fetchAvailableModels", req, res);
		} catch (error) {
			return res.status(500).json({
				error: error.message || "Antigravity fetchAvailableModels failed",
			});
		}
	});

	router.post("/v1internal:streamGenerateContent", async (req, res) => {
		let _selectedAccount = null;
		try {
			if (!isChannelAllowed(req.user, "antigravity")) {
				return res.status(403).json({
					error: {
						type: "permission_error",
						message: "Channel 'antigravity' is not enabled for this API key.",
					},
				});
			}

			const upstream = await executeWithFailover(
				req.body?.model,
				async (account) => {
					_selectedAccount = account;
					const response = await callAntigravityStream(
						state.db,
						account,
						"/v1internal:streamGenerateContent",
						req.body || {},
					);
					if (!response.body) {
						throw new Error("Antigravity stream body unavailable");
					}
					return response;
				},
			);

			res.status(200);
			res.setHeader(
				"Content-Type",
				upstream.headers.get("content-type") || "text/event-stream",
			);
			res.setHeader("Cache-Control", "no-cache");
			res.setHeader("Connection", "keep-alive");

			for await (const chunk of upstream.body) {
				res.write(chunk);
			}

			return res.end();
		} catch (error) {
			return res.status(500).json({
				error: error.message || "Antigravity streamGenerateContent failed",
			});
		}
	});

	router.post("/v1/models/:model\\:generateContent", async (req, res) => {
		try {
			const modelFromUrl = req.params.model;
			req.body = req.body || {};
			req.body.model = modelFromUrl;
			return await executeNative("/v1internal:generateContent", req, res);
		} catch (error) {
			return res
				.status(500)
				.json({ error: error.message || "Antigravity generateContent failed" });
		}
	});

	router.post("/v1/models/:model\\:streamGenerateContent", async (req, res) => {
		let _selectedAccount = null;
		try {
			const modelFromUrl = req.params.model;
			req.body = req.body || {};
			req.body.model = modelFromUrl;

			if (!isChannelAllowed(req.user, "antigravity")) {
				return res.status(403).json({
					error: {
						type: "permission_error",
						message: "Channel 'antigravity' is not enabled for this API key.",
					},
				});
			}

			const upstream = await executeWithFailover(
				req.body.model,
				async (account) => {
					_selectedAccount = account;
					const response = await callAntigravityStream(
						state.db,
						account,
						"/v1internal:streamGenerateContent",
						req.body,
					);
					if (!response.body) {
						throw new Error("Antigravity stream body unavailable");
					}
					return response;
				},
			);

			res.status(200);
			res.setHeader(
				"Content-Type",
				upstream.headers.get("content-type") || "text/event-stream",
			);
			res.setHeader("Cache-Control", "no-cache");
			res.setHeader("Connection", "keep-alive");

			for await (const chunk of upstream.body) {
				res.write(chunk);
			}

			return res.end();
		} catch (error) {
			return res.status(500).json({
				error: error.message || "Antigravity streamGenerateContent failed",
			});
		}
	});

	router.post("/v1/models/:model\\:countTokens", async (req, res) => {
		try {
			const modelFromUrl = req.params.model;
			req.body = req.body || {};
			req.body.model = modelFromUrl;
			return await executeNative("/v1internal:countTokens", req, res);
		} catch (error) {
			return res
				.status(500)
				.json({ error: error.message || "Antigravity countTokens failed" });
		}
	});

	return router;
}
