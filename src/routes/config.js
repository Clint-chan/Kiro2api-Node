/**
 * 配置热更新路由
 * 支持运行时修改配置，无需重启
 */

import { Router } from "express";
import { adminAuthMiddleware } from "../middleware/auth.js";

export function createConfigRouter(state) {
	const router = Router();

	// 需要管理员权限
	router.use(adminAuthMiddleware(state.db));

	/**
	 * GET /api/config - 获取当前配置
	 */
	router.get("/", (req, res) => {
		const config = getRuntimeConfig(state);
		res.json({ success: true, data: config });
	});

	/**
	 * PATCH /api/config - 更新配置
	 */
	router.patch("/", (req, res) => {
		const updates = req.body;
		const result = updateRuntimeConfig(state, updates);

		if (result.success) {
			res.json(result);
		} else {
			res.status(400).json(result);
		}
	});

	/**
	 * POST /api/config/reset - 重置为默认配置
	 */
	router.post("/reset", (req, res) => {
		resetToDefaults(state);
		res.json({ success: true, message: "Configuration reset to defaults" });
	});

	return router;
}

/**
 * 获取运行时配置
 */
function getRuntimeConfig(state) {
	return {
		// 账号池配置
		accountPool: {
			strategy: state.accountPool.strategy || "least-inflight",
			maxConcurrentPerAccount: state.accountPool.maxConcurrentPerAccount || 5,
			balanceThreshold: state.accountPool.balanceThreshold || 0.1,
		},

		// 余额监控配置
		balanceMonitor: {
			enabled: state.balanceMonitor?.enabled ?? true,
			refreshInterval: state.balanceMonitor?.refreshInterval || 300000,
			batchSize: state.balanceMonitor?.batchSize || 5,
		},

		// 重试配置
		retry: {
			maxRetries: state.config.maxRetries || 3,
			initialDelay: state.config.initialRetryDelay || 1000,
			maxDelay: state.config.maxRetryDelay || 10000,
		},

		// 日志配置
		logging: {
			level: process.env.LOG_LEVEL || "INFO",
			format: process.env.LOG_FORMAT || "json",
		},
	};
}

/**
 * 更新运行时配置
 */
function updateRuntimeConfig(state, updates) {
	const errors = [];

	try {
		// 更新账号池配置
		if (updates.accountPool) {
			const { strategy, maxConcurrentPerAccount, balanceThreshold } =
				updates.accountPool;

			if (strategy) {
				const validStrategies = [
					"round-robin",
					"random",
					"least-used",
					"least-inflight",
				];
				if (!validStrategies.includes(strategy)) {
					errors.push(
						`Invalid strategy: ${strategy}. Must be one of: ${validStrategies.join(", ")}`,
					);
				} else {
					state.accountPool.setStrategy(strategy);
					state.db.setSetting("load_balance_strategy", strategy);
				}
			}

			if (maxConcurrentPerAccount !== undefined) {
				const value = parseInt(maxConcurrentPerAccount);
				if (value < 1 || value > 100) {
					errors.push("maxConcurrentPerAccount must be between 1 and 100");
				} else {
					state.accountPool.maxConcurrentPerAccount = value;
				}
			}

			if (balanceThreshold !== undefined) {
				const value = parseFloat(balanceThreshold);
				if (value < 0 || value > 10) {
					errors.push("balanceThreshold must be between 0 and 10");
				} else {
					state.accountPool.balanceThreshold = value;
				}
			}
		}

		// 更新余额监控配置
		if (updates.balanceMonitor && state.balanceMonitor) {
			const { enabled, refreshInterval, batchSize } = updates.balanceMonitor;

			if (enabled !== undefined) {
				state.balanceMonitor.enabled = Boolean(enabled);
				if (enabled && !state.balanceMonitor.timer) {
					state.balanceMonitor.start();
				} else if (!enabled && state.balanceMonitor.timer) {
					state.balanceMonitor.stop();
				}
			}

			if (refreshInterval !== undefined) {
				const value = parseInt(refreshInterval);
				if (value < 10000 || value > 3600000) {
					errors.push(
						"refreshInterval must be between 10000 (10s) and 3600000 (1h)",
					);
				} else {
					state.balanceMonitor.refreshInterval = value;
					// 重启定时器
					if (state.balanceMonitor.timer) {
						state.balanceMonitor.stop();
						state.balanceMonitor.start();
					}
				}
			}

			if (batchSize !== undefined) {
				const value = parseInt(batchSize);
				if (value < 1 || value > 20) {
					errors.push("batchSize must be between 1 and 20");
				} else {
					state.balanceMonitor.batchSize = value;
				}
			}
		}

		// 更新重试配置
		if (updates.retry) {
			const { maxRetries, initialDelay, maxDelay } = updates.retry;

			if (maxRetries !== undefined) {
				const value = parseInt(maxRetries);
				if (value < 0 || value > 10) {
					errors.push("maxRetries must be between 0 and 10");
				} else {
					state.config.maxRetries = value;
				}
			}

			if (initialDelay !== undefined) {
				const value = parseInt(initialDelay);
				if (value < 100 || value > 10000) {
					errors.push("initialDelay must be between 100 and 10000");
				} else {
					state.config.initialRetryDelay = value;
				}
			}

			if (maxDelay !== undefined) {
				const value = parseInt(maxDelay);
				if (value < 1000 || value > 60000) {
					errors.push("maxDelay must be between 1000 and 60000");
				} else {
					state.config.maxRetryDelay = value;
				}
			}
		}

		if (errors.length > 0) {
			return {
				success: false,
				errors,
			};
		}

		return {
			success: true,
			message: "Configuration updated successfully",
			data: getRuntimeConfig(state),
		};
	} catch (error) {
		return {
			success: false,
			errors: [error.message],
		};
	}
}

/**
 * 重置为默认配置
 */
function resetToDefaults(state) {
	// 账号池
	state.accountPool.setStrategy("least-inflight");
	state.db.setSetting("load_balance_strategy", "least-inflight");
	state.accountPool.maxConcurrentPerAccount = 5;
	state.accountPool.balanceThreshold = 0.1;

	// 余额监控
	if (state.balanceMonitor) {
		state.balanceMonitor.enabled = true;
		state.balanceMonitor.refreshInterval = 300000;
		state.balanceMonitor.batchSize = 5;

		if (state.balanceMonitor.timer) {
			state.balanceMonitor.stop();
			state.balanceMonitor.start();
		}
	}

	// 重试
	state.config.maxRetries = 3;
	state.config.initialRetryDelay = 1000;
	state.config.maxRetryDelay = 10000;
}
