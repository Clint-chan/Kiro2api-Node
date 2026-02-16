import express from "express";
import { logger } from "../../logger.js";

export function createSubscriptionsAdminRouter(db, subscription) {
	const router = express.Router();

	/**
	 * POST /users/:id/subscription
	 * Set user subscription (daily/monthly)
	 */
	router.post("/users/:id/subscription", async (req, res) => {
		try {
			const { type, quota, duration } = req.body;

			if (!type || !["daily", "monthly"].includes(type)) {
				return res.status(400).json({
					error: {
						type: "validation_error",
						message: "订阅类型必须是 daily 或 monthly",
					},
				});
			}

			if (!quota || quota <= 0) {
				return res.status(400).json({
					error: {
						type: "validation_error",
						message: "订阅额度必须大于 0",
					},
				});
			}

			if (!duration || duration <= 0) {
				return res.status(400).json({
					error: {
						type: "validation_error",
						message: "订阅时长必须大于 0",
					},
				});
			}

			const result = subscription.setSubscription(
				req.params.id,
				type,
				quota,
				duration,
			);

			res.json({
				success: true,
				data: result,
			});
		} catch (error) {
			logger.error("Set subscription error", { error });
			res.status(500).json({
				error: {
					type: "internal_error",
					message: error.message || "Failed to set subscription.",
				},
			});
		}
	});

	/**
	 * DELETE /users/:id/subscription
	 * Cancel user subscription
	 */
	router.delete("/users/:id/subscription", async (req, res) => {
		try {
			subscription.cancelSubscription(req.params.id);

			res.json({
				success: true,
				message: "订阅已取消",
			});
		} catch (error) {
			logger.error("Cancel subscription error", { error });
			res.status(500).json({
				error: {
					type: "internal_error",
					message: error.message || "Failed to cancel subscription.",
				},
			});
		}
	});

	/**
	 * POST /users/:id/subscription/renew
	 * Renew user subscription
	 */
	router.post("/users/:id/subscription/renew", async (req, res) => {
		try {
			const { duration } = req.body;

			if (!duration || duration <= 0) {
				return res.status(400).json({
					error: {
						type: "validation_error",
						message: "续费时长必须大于 0",
					},
				});
			}

			const result = subscription.renewSubscription(req.params.id, duration);

			res.json({
				success: true,
				data: result,
			});
		} catch (error) {
			logger.error("Renew subscription error", { error });
			res.status(500).json({
				error: {
					type: "internal_error",
					message: error.message || "Failed to renew subscription.",
				},
			});
		}
	});

	/**
	 * GET /users/:id/subscription
	 * Get user subscription info
	 */
	router.get("/users/:id/subscription", async (req, res) => {
		try {
			const user = db.getUserById(req.params.id);

			if (!user) {
				return res.status(404).json({
					error: {
						type: "not_found",
						message: "User not found.",
					},
				});
			}

			res.json({
				success: true,
				data: {
					subscription_type: user.subscription_type,
					subscription_quota: user.subscription_quota,
					subscription_expires_at: user.subscription_expires_at,
					last_reset_at: user.last_reset_at,
					period_used: user.period_used,
				},
			});
		} catch (error) {
			logger.error("Get subscription error", { error });
			res.status(500).json({
				error: {
					type: "internal_error",
					message: "Failed to retrieve subscription.",
				},
			});
		}
	});

	/**
	 * GET /users/:id/subscription/history
	 * Get user subscription history
	 */
	router.get("/users/:id/subscription/history", async (req, res) => {
		try {
			const history = db.db
				.prepare(`
        SELECT * FROM subscription_history
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 50
      `)
				.all(req.params.id);

			res.json({
				success: true,
				data: history,
			});
		} catch (error) {
			logger.error("Get subscription history error", { error });
			res.status(500).json({
				error: {
					type: "internal_error",
					message: "Failed to retrieve subscription history.",
				},
			});
		}
	});

	return router;
}
