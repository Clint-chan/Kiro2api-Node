/**
 * Authentication Middleware
 * Handles user and admin authentication
 */

import { logger } from "../logger.js";
import { recordLoginFailure } from "./rate-limit.js";

function resolveSystemAdminKey(db) {
	const dbAdminKey = db.getSetting("admin_key");
	if (typeof dbAdminKey === "string" && dbAdminKey.trim()) {
		return dbAdminKey;
	}

	const envAdminKey = process.env.ADMIN_KEY;
	if (typeof envAdminKey === "string" && envAdminKey.trim()) {
		return envAdminKey;
	}

	return null;
}

/**
 * User authentication middleware
 * Validates API key and attaches user to request
 */
export function userAuthMiddleware(db) {
	return (req, res, next) => {
		try {
			// Extract API key from header
			let apiKey = req.headers["x-api-key"];

			// Also check Authorization header (Bearer token)
			if (!apiKey && req.headers.authorization) {
				const authHeader = req.headers.authorization;
				if (authHeader.startsWith("Bearer ")) {
					apiKey = authHeader.substring(7);
				}
			}

			if (!apiKey) {
				return res.status(401).json({
					error: {
						type: "authentication_error",
						message:
							"API key is required. Provide it via x-api-key header or Authorization: Bearer header.",
					},
				});
			}

			// Get user from database
			const user = db.getUserByApiKey(apiKey, "active");

			if (!user) {
				return res.status(401).json({
					error: {
						type: "authentication_error",
						message: "Invalid API key or user is not active.",
					},
				});
			}

			// Attach user to request
			req.user = user;
			next();
		} catch (error) {
			logger.error("User authentication failed", { error });
			return res.status(500).json({
				error: {
					type: "internal_error",
					message: "Authentication failed.",
				},
			});
		}
	};
}

/**
 * Admin-only authentication middleware
 * Only accepts system admin key, rejects user API keys
 */
export function adminAuthMiddleware(db) {
	return (req, res, next) => {
		try {
			const credential =
				req.body.credential ||
				req.headers["x-admin-key"] ||
				req.headers["x-api-key"] ||
				req.headers.authorization?.replace("Bearer ", "");

			if (!credential) {
				return res.status(401).json({
					error: {
						type: "authentication_error",
						message: "Admin credentials required.",
					},
				});
			}

			const systemAdminKey = resolveSystemAdminKey(db);

			if (systemAdminKey && credential === systemAdminKey) {
				const adminPath = db.getSetting("admin_path") || "/admin.html";
				req.authUser = {
					id: "system",
					username: "system_admin",
					role: "admin",
					balance: 0,
					isSystemAdmin: true,
					adminPath: adminPath,
				};
				logger.info("adminAuthMiddleware: system admin authenticated");
				return next();
			}

			logger.warn("adminAuthMiddleware: authentication failed", {
				credentialLength: credential.length,
			});

			return res.status(401).json({
				error: {
					type: "authentication_error",
					message: "Invalid admin credentials.",
				},
			});
		} catch (error) {
			logger.error("Admin authentication failed", { error });
			return res.status(500).json({
				error: {
					type: "internal_error",
					message: "Authentication failed.",
				},
			});
		}
	};
}

/**
 * Dual authentication middleware (for login)
 * Accepts both user API keys and admin credentials
 */
export function dualAuthMiddleware(db) {
	return (req, res, next) => {
		try {
			const credential =
				req.body.credential ||
				req.headers["x-api-key"] ||
				req.headers.authorization?.replace("Bearer ", "");

			if (!credential) {
				return res.status(401).json({
					error: {
						type: "authentication_error",
						message: "Credential required.",
					},
				});
			}

			const systemAdminKey = resolveSystemAdminKey(db);
			logger.debug("dualAuthMiddleware: checking system admin key", {
				hasSystemAdminKey: !!systemAdminKey,
				credentialLength: credential.length,
				matches: systemAdminKey === credential,
			});

			if (systemAdminKey && credential === systemAdminKey) {
				const adminPath = db.getSetting("admin_path") || "/admin.html";
				req.authUser = {
					id: "system",
					username: "system_admin",
					role: "admin",
					balance: 0,
					isSystemAdmin: true,
					adminPath: adminPath,
				};
				logger.info("dualAuthMiddleware: system admin authenticated");
				return next();
			}

			const user = db.getUserByApiKey(credential, "active");
			logger.debug("dualAuthMiddleware: checking user API key", {
				userFound: !!user,
				userRole: user?.role,
				userStatus: user?.status,
			});

			if (user) {
				req.authUser = {
					id: user.id,
					username: user.username,
					role: user.role,
					api_key: user.api_key,
					balance: user.balance,
					isSystemAdmin: false,
				};
				logger.info("dualAuthMiddleware: user authenticated", {
					userId: user.id,
					role: user.role,
				});
				return next();
			}

			logger.warn("dualAuthMiddleware: authentication failed", {
				credentialLength: credential.length,
				credentialPrefix: credential.substring(0, 3),
				systemAdminKeyPrefix: systemAdminKey
					? systemAdminKey.substring(0, 3)
					: null,
			});

			recordLoginFailure(req);

			return res.status(401).json({
				error: {
					type: "authentication_error",
					message: "Invalid credentials.",
				},
			});
		} catch (error) {
			logger.error("Dual authentication failed", { error });
			return res.status(500).json({
				error: {
					type: "internal_error",
					message: "Authentication failed.",
				},
			});
		}
	};
}

/**
 * Optional authentication middleware
 * Attaches user if valid API key is provided, but doesn't require it
 */
export function optionalAuthMiddleware(db) {
	return (req, res, next) => {
		try {
			let apiKey = req.headers["x-api-key"];

			if (!apiKey && req.headers.authorization) {
				const authHeader = req.headers.authorization;
				if (authHeader.startsWith("Bearer ")) {
					apiKey = authHeader.substring(7);
				}
			}

			if (apiKey) {
				const user = db.getUserByApiKey(apiKey, "active");
				if (user) {
					req.user = user;
				}
			}

			next();
		} catch (error) {
			logger.error("Optional authentication failed", { error });
			next();
		}
	};
}
