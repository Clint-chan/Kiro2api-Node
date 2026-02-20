import express from "express";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../../logger.js";
import { normalizeUserPermissions, serializeUser } from "./helpers.js";

export function createUserAdminRouter(db, billing) {
	const router = express.Router();

	/**
	 * GET /api/admin/users
	 * List all users with optional filtering
	 */
	router.get("/users", (req, res) => {
		try {
			const { status, role, search } = req.query;

			let users = db.getAllUsers(status);

			if (role) {
				users = users.filter((u) => u.role === role);
			}

			if (search) {
				const searchLower = search.toLowerCase();
				users = users.filter(
					(u) =>
						u.username?.toLowerCase().includes(searchLower) ||
						u.id?.toLowerCase().includes(searchLower),
				);
			}

			// Remove sensitive data
			const sanitizedUsers = users.map((user) =>
				serializeUser({
					id: user.id,
					username: user.username,
					api_key: user.api_key,
					role: user.role,
					balance: user.balance,
					status: user.status,
					price_input: user.price_input,
					price_output: user.price_output,
					total_requests: user.total_requests,
					total_input_tokens: user.total_input_tokens,
					total_output_tokens: user.total_output_tokens,
					total_cost: user.total_cost,
					created_at: user.created_at,
					updated_at: user.updated_at,
					last_used_at: user.last_used_at,
					notes: user.notes,
					allowed_channels: user.allowed_channels,
					allowed_models: user.allowed_models,
				}),
			);

			res.json({
				success: true,
				data: sanitizedUsers,
				count: sanitizedUsers.length,
			});
		} catch (error) {
			logger.error("Get users error", { error });
			res.status(500).json({
				error: {
					type: "internal_error",
					message: "Failed to retrieve users.",
				},
			});
		}
	});

	/**
	 * POST /api/admin/users
	 * Create new user
	 */
	router.post("/users", (req, res) => {
		try {
			let {
				username,
				api_key,
				role,
				balance,
				price_input,
				price_output,
				notes,
			} = req.body;
			logger.debug("Request body allowed_channels", {
				allowedChannels: req.body.allowed_channels,
			});
			const permissions = normalizeUserPermissions(
				req.body.allowed_channels,
				req.body.allowed_models,
			);
			logger.debug("Normalized permissions", { permissions });

			// 如果没有提供用户名，自动生成
			if (!username) {
				const randomStr = Math.random().toString(36).substring(2, 8);
				username = `user_${randomStr}`;
			}

			// Generate API key if not provided
			const userApiKey = api_key || `sk-${uuidv4()}`;

			// Check if API key already exists
			const existingUser = db.getUserByApiKey(userApiKey);
			if (existingUser) {
				return res.status(400).json({
					error: {
						type: "validation_error",
						message: "API key already exists.",
					},
				});
			}

			const userId = uuidv4();
			const userData = {
				id: userId,
				username,
				api_key: userApiKey,
				role: role || "user",
				balance: balance || 0.0,
				status: "active",
				price_input: price_input || 3.0,
				price_output: price_output || 15.0,
				notes: notes || null,
				allowed_channels: permissions.allowed_channels,
				allowed_models: permissions.allowed_models,
			};

			db.createUser(userData);

			const user = db.getUserById(userId);

			res.status(201).json({
				success: true,
				data: serializeUser({
					id: user.id,
					username: user.username,
					api_key: user.api_key,
					role: user.role,
					balance: user.balance,
					status: user.status,
					price_input: user.price_input,
					price_output: user.price_output,
					allowed_channels: user.allowed_channels,
					allowed_models: user.allowed_models,
					created_at: user.created_at,
				}),
			});
		} catch (error) {
			logger.error("Create user error", { error });
			res.status(500).json({
				error: {
					type: "internal_error",
					message: "Failed to create user.",
				},
			});
		}
	});

	/**
	 * GET /api/admin/users/:id
	 * Get user details
	 */
	router.get("/users/:id", (req, res) => {
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
				data: serializeUser({
					id: user.id,
					username: user.username,
					api_key: user.api_key,
					role: user.role,
					balance: user.balance,
					status: user.status,
					price_input: user.price_input,
					price_output: user.price_output,
					total_requests: user.total_requests,
					total_input_tokens: user.total_input_tokens,
					total_output_tokens: user.total_output_tokens,
					total_cost: user.total_cost,
					created_at: user.created_at,
					updated_at: user.updated_at,
					last_used_at: user.last_used_at,
					notes: user.notes,
					allowed_channels: user.allowed_channels,
					allowed_models: user.allowed_models,
				}),
			});
		} catch (error) {
			logger.error("Get user error", { error });
			res.status(500).json({
				error: {
					type: "internal_error",
					message: "Failed to retrieve user.",
				},
			});
		}
	});

	/**
	 * GET /api/admin/users/:id/stats
	 * Get user statistics (aggregated)
	 */
	router.get("/users/:id/stats", (req, res) => {
		try {
			const { startDate, endDate } = req.query;
			const stats = db.getUserStats(req.params.id, startDate, endDate);

			res.json({
				success: true,
				data: stats,
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
	 * GET /api/admin/users/:id/stats/daily
	 * Get user daily statistics
	 */
	router.get("/users/:id/stats/daily", (req, res) => {
		try {
			const { startDate, endDate } = req.query;
			const stats = db.getDailyStats(req.params.id, startDate, endDate);

			res.json({
				success: true,
				data: stats,
			});
		} catch (error) {
			logger.error("Get user daily stats error", { error });
			res.status(500).json({
				error: {
					type: "internal_error",
					message: "Failed to retrieve daily statistics.",
				},
			});
		}
	});

	/**
	 * GET /api/admin/users/:id/stats/models
	 * Get user model statistics
	 */
	router.get("/users/:id/stats/models", (req, res) => {
		try {
			const { startDate, endDate } = req.query;
			const stats = db.getModelStats(req.params.id, startDate, endDate);

			res.json({
				success: true,
				data: stats,
			});
		} catch (error) {
			logger.error("Get user model stats error", { error });
			res.status(500).json({
				error: {
					type: "internal_error",
					message: "Failed to retrieve model statistics.",
				},
			});
		}
	});

	/**
	 * PUT /api/admin/users/:id
	 * Update user
	 */
	router.put("/users/:id", (req, res) => {
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

			const allowedUpdates = {
				username: req.body.username,
				balance: req.body.balance,
				status: req.body.status,
				role: req.body.role,
				price_input: req.body.price_input,
				price_output: req.body.price_output,
				notes: req.body.notes,
			};

			if (
				req.body.allowed_channels !== undefined ||
				req.body.allowed_models !== undefined
			) {
				const permissions = normalizeUserPermissions(
					req.body.allowed_channels,
					req.body.allowed_models,
				);
				allowedUpdates.allowed_channels = JSON.stringify(
					permissions.allowed_channels,
				);
				allowedUpdates.allowed_models =
					permissions.allowed_models.length > 0
						? JSON.stringify(permissions.allowed_models)
						: null;
			}

			// Remove undefined values
			const updates = {};
			for (const [key, value] of Object.entries(allowedUpdates)) {
				if (value !== undefined) {
					updates[key] = value;
				}
			}

			if (Object.keys(updates).length === 0) {
				return res.status(400).json({
					error: {
						type: "validation_error",
						message: "No valid fields to update.",
					},
				});
			}

			db.updateUser(req.params.id, updates);

			const updatedUser = db.getUserById(req.params.id);

			res.json({
				success: true,
				data: serializeUser({
					id: updatedUser.id,
					username: updatedUser.username,
					api_key: updatedUser.api_key,
					role: updatedUser.role,
					balance: updatedUser.balance,
					status: updatedUser.status,
					price_input: updatedUser.price_input,
					price_output: updatedUser.price_output,
					allowed_channels: updatedUser.allowed_channels,
					allowed_models: updatedUser.allowed_models,
					updated_at: updatedUser.updated_at,
				}),
			});
		} catch (error) {
			logger.error("Update user error", { error });
			res.status(500).json({
				error: {
					type: "internal_error",
					message: "Failed to update user.",
				},
			});
		}
	});

	/**
	 * DELETE /api/admin/users/:id
	 * Delete user
	 */
	router.delete("/users/:id", (req, res) => {
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

			db.deleteUser(req.params.id);

			res.json({
				success: true,
				message: "User deleted successfully.",
			});
		} catch (error) {
			logger.error("Delete user error", { error });
			res.status(500).json({
				error: {
					type: "internal_error",
					message: "Failed to delete user.",
				},
			});
		}
	});

	/**
	 * POST /api/admin/users/:id/recharge
	 * Adjust user balance (increase or decrease)
	 */
	router.post("/users/:id/recharge", (req, res) => {
		try {
			const { amount, notes } = req.body;
			const numericAmount = Number(amount);

			if (!Number.isFinite(numericAmount) || numericAmount === 0) {
				return res.status(400).json({
					error: {
						type: "validation_error",
						message: "Valid non-zero amount is required.",
					},
				});
			}

			const user = db.getUserById(req.params.id);
			if (!user) {
				return res.status(404).json({
					error: {
						type: "not_found",
						message: "User not found.",
					},
				});
			}

			const result = billing.recharge(
				req.params.id,
				numericAmount,
				req.authUser?.id || "system",
				notes,
			);

			res.json({
				success: true,
				data: {
					amount: result.amount,
					balanceBefore: result.balanceBefore,
					balanceAfter: result.balanceAfter,
				},
			});
		} catch (error) {
			if (error.message === "Adjustment would make balance negative") {
				return res.status(400).json({
					error: {
						type: "validation_error",
						message: "调整后余额不能小于 0",
					},
				});
			}

			logger.error("Recharge error", { error });
			res.status(500).json({
				error: {
					type: "internal_error",
					message: error.message || "Failed to recharge.",
				},
			});
		}
	});

	return router;
}
