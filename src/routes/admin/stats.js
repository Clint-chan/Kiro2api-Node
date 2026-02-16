import express from "express";
import { CLIProxyClient } from "../../cliproxy-client.js";
import { logger } from "../../logger.js";

export function createStatsAdminRouter(db) {
	const router = express.Router();

	/**
	 * GET /api/admin/stats/overview
	 * Get system overview statistics
	 */
	router.get("/stats/overview", async (_req, res) => {
		try {
			const users = db.getAllUsers();
			const activeUsers = users.filter((u) => u.status === "active");
			const kiroAccounts = db.getAllKiroAccounts();

			const today = new Date().toISOString().split("T")[0];
			const todayStart = `${today}T00:00:00.000Z`;
			const todayEnd = `${today}T23:59:59.999Z`;

			const todayStats = db.db
				.prepare(`
        SELECT
          COUNT(*) as request_count,
          SUM(total_cost) as total_revenue,
          SUM(input_tokens) as total_input_tokens,
          SUM(output_tokens) as total_output_tokens
        FROM request_logs
        WHERE timestamp >= ? AND timestamp <= ?
      `)
				.get(todayStart, todayEnd);

			const allTimeStats = db.db
				.prepare(`
        SELECT
          COUNT(*) as request_count,
          SUM(total_cost) as total_revenue,
          SUM(input_tokens) as total_input_tokens,
          SUM(output_tokens) as total_output_tokens,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_requests,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_requests
        FROM request_logs
      `)
				.get();

			const cliproxyStats = {
				total: 0,
				active: 0,
				disabled: 0,
				error: 0,
				inactive: 0,
				requests: 0,
				errors: 0,
				antigravity: 0,
				codex: 0,
				claude: 0,
				totalModels: 0,
			};

			try {
				const cliproxyUrl =
					process.env.CLIPROXY_MANAGEMENT_URL || process.env.CLIPROXY_URL;
				const cliproxyKey =
					process.env.CLIPROXY_MANAGEMENT_KEY || process.env.CLIPROXY_API_KEY;

				if (cliproxyUrl && cliproxyKey) {
					const client = new CLIProxyClient(cliproxyUrl, cliproxyKey);
					const authFiles = await client.listAuthFiles();
					const files = authFiles.files || [];

					cliproxyStats.total = files.length;
					cliproxyStats.active = files.filter(
						(f) => f.status === "active",
					).length;
					cliproxyStats.disabled = files.filter(
						(f) => f.disabled === true,
					).length;
					cliproxyStats.antigravity = files.filter(
						(f) => f.type === "antigravity" || f.provider === "antigravity",
					).length;
					cliproxyStats.codex = files.filter(
						(f) => f.type === "codex" || f.provider === "codex",
					).length;
					cliproxyStats.claude = files.filter(
						(f) => f.type === "claude" || f.provider === "claude",
					).length;

					for (const file of files) {
						try {
							const models = await client.getAuthFileModels(file.name);
							cliproxyStats.totalModels += (models.models || []).length;
						} catch (e) {
							logger.warn("Failed to get models for auth file", {
								name: file.name,
								error: e.message,
							});
						}
					}
				}
			} catch (error) {
				logger.warn("Failed to fetch CLIProxy stats", { error: error.message });
			}

			const successfulRequests = allTimeStats.successful_requests || 0;
			const failedRequests = allTimeStats.failed_requests || 0;
			const totalRequests = allTimeStats.request_count || 0;
			const successRate =
				totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0;

			const totalBalance = users.reduce((sum, u) => sum + u.balance, 0);

			const accountStatusCounts = {
				active: kiroAccounts.filter((a) => a.status === "active").length,
				cooldown: kiroAccounts.filter((a) => a.status === "cooldown").length,
				error: kiroAccounts.filter((a) => a.status === "error").length,
				depleted: kiroAccounts.filter((a) => a.status === "depleted").length,
				disabled: kiroAccounts.filter((a) => a.status === "disabled").length,
				inactive: kiroAccounts.filter((a) => a.status === "inactive").length,
			};

			res.json({
				success: true,
				data: {
					users: {
						total: users.length,
						active: activeUsers.length,
						suspended: users.filter((u) => u.status === "suspended").length,
					},
					kiroAccounts: {
						total: kiroAccounts.length,
						active: accountStatusCounts.active,
						cooldown: accountStatusCounts.cooldown,
						error: accountStatusCounts.error,
						depleted: accountStatusCounts.depleted,
						disabled: accountStatusCounts.disabled,
						inactive: accountStatusCounts.inactive,
					},
					today: {
						requests: todayStats.request_count || 0,
						revenue: todayStats.total_revenue || 0,
						inputTokens: todayStats.total_input_tokens || 0,
						outputTokens: todayStats.total_output_tokens || 0,
						totalTokens:
							(todayStats.total_input_tokens || 0) +
							(todayStats.total_output_tokens || 0),
					},
					allTime: {
						requests: totalRequests,
						revenue: allTimeStats.total_revenue || 0,
						inputTokens: allTimeStats.total_input_tokens || 0,
						outputTokens: allTimeStats.total_output_tokens || 0,
						totalTokens:
							(allTimeStats.total_input_tokens || 0) +
							(allTimeStats.total_output_tokens || 0),
						successfulRequests,
						failedRequests,
						successRate,
					},
					cliproxyAccounts: cliproxyStats,
					totalBalance,
				},
			});
		} catch (error) {
			logger.error("Get overview stats error", { error });
			res.status(500).json({
				error: {
					type: "internal_error",
					message: "Failed to retrieve statistics.",
				},
			});
		}
	});

	/**
	 * GET /api/admin/stats/users
	 * Get user statistics ranking
	 */
	router.get("/stats/users", (req, res) => {
		try {
			const { sortBy = "cost", limit = 20 } = req.query;

			const validSortFields = {
				cost: "total_cost",
				requests: "total_requests",
				balance: "balance",
			};

			const sortField = validSortFields[sortBy] || "total_cost";

			const users = db.db
				.prepare(`
        SELECT
          id, username, api_key, role, balance, status,
          total_requests, total_input_tokens, total_output_tokens, total_cost,
          last_used_at
        FROM users
        ORDER BY ${sortField} DESC
        LIMIT ?
      `)
				.all(parseInt(limit, 10));

			res.json({
				success: true,
				data: users,
			});
		} catch (error) {
			logger.error("Get user stats error", { error });
			res.status(500).json({
				error: {
					type: "internal_error",
					message: "Failed to retrieve user statistics.",
				},
			});
		}
	});

	/**
	 * GET /api/admin/stats/models
	 * Get model statistics
	 */
	router.get("/stats/models", (req, res) => {
		try {
			const { startDate, endDate } = req.query;

			let query = `
        SELECT
          model,
          COUNT(*) as request_count,
          SUM(input_tokens) as total_input_tokens,
          SUM(output_tokens) as total_output_tokens,
          SUM(input_tokens + output_tokens) as total_tokens,
          SUM(total_cost) as total_cost,
          AVG(duration_ms) as avg_duration_ms,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_requests,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_requests
        FROM request_logs
      `;

			const params = [];

			if (startDate || endDate) {
				const conditions = [];
				if (startDate) {
					conditions.push("timestamp >= ?");
					params.push(startDate);
				}
				if (endDate) {
					conditions.push("timestamp <= ?");
					params.push(endDate);
				}
				query += ` WHERE ${conditions.join(" AND ")}`;
			}

			query += " GROUP BY model ORDER BY total_cost DESC";

			const stats = db.db
				.prepare(query)
				.all(...params)
				.map((item) => {
					const requestCount = item.request_count || 0;
					const successfulRequests = item.successful_requests || 0;
					return {
						...item,
						success_rate:
							requestCount > 0 ? (successfulRequests / requestCount) * 100 : 0,
					};
				});

			res.json({
				success: true,
				data: stats,
			});
		} catch (error) {
			logger.error("Get model stats error", { error });
			res.status(500).json({
				error: {
					type: "internal_error",
					message: "Failed to retrieve model statistics.",
				},
			});
		}
	});

	/**
	 * GET /api/admin/stats/accounts
	 * Get Kiro account statistics
	 */
	router.get("/stats/accounts", (_req, res) => {
		try {
			const accounts = db.getAllKiroAccounts();

			const accountStats = accounts.map((acc) => ({
				id: acc.id,
				name: acc.name,
				status: acc.status,
				request_count: acc.request_count,
				error_count: acc.error_count,
				usage_limit: acc.usage_limit,
				current_usage: acc.current_usage,
				available: acc.available,
				user_email: acc.user_email,
				subscription_type: acc.subscription_type,
				last_used_at: acc.last_used_at,
			}));

			res.json({
				success: true,
				data: accountStats,
			});
		} catch (error) {
			logger.error("Get account stats error", { error });
			res.status(500).json({
				error: {
					type: "internal_error",
					message: "Failed to retrieve account statistics.",
				},
			});
		}
	});

	/**
	 * GET /api/admin/stats/daily
	 * Get daily request statistics
	 */
	router.get("/stats/daily", (req, res) => {
		try {
			const { startDate, endDate } = req.query;

			if (!startDate || !endDate) {
				return res.status(400).json({
					error: {
						type: "validation_error",
						message: "startDate and endDate are required",
					},
				});
			}

			// Use SQL aggregation to group by date
			const query = `
        SELECT 
          DATE(timestamp) as date,
          COUNT(*) as count,
          SUM(input_tokens) as input_tokens,
          SUM(output_tokens) as output_tokens,
          SUM(input_tokens + output_tokens) as total_tokens,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_requests,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_requests
        FROM request_logs
        WHERE DATE(timestamp) >= DATE(?) AND DATE(timestamp) <= DATE(?)
        GROUP BY DATE(timestamp)
        ORDER BY date ASC
      `;

			const stats = db.db.prepare(query).all(startDate, endDate);

			res.json({
				success: true,
				data: stats,
			});
		} catch (error) {
			logger.error("Get daily stats error", { error });
			res.status(500).json({
				error: {
					type: "internal_error",
					message: "Failed to retrieve daily stats.",
				},
			});
		}
	});

	return router;
}
