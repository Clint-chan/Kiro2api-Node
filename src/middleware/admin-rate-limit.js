import { logger } from "../logger.js";

const adminAttempts = new Map();

const ADMIN_RATE_LIMIT_CONFIG = {
	maxRequests: 100,
	windowMs: 60 * 1000,
};

function getClientIp(req) {
	return (
		req.socket.remoteAddress ||
		req.connection.remoteAddress ||
		req.ip ||
		"unknown"
	);
}

function cleanupExpiredEntries() {
	const now = Date.now();
	for (const [ip, data] of adminAttempts.entries()) {
		if (now - data.firstRequestAt > ADMIN_RATE_LIMIT_CONFIG.windowMs) {
			adminAttempts.delete(ip);
		}
	}
}

setInterval(cleanupExpiredEntries, 60 * 1000);

export function adminRateLimiter(req, res, next) {
	// Skip rate limiting for CLIProxy endpoints (used for quota fetching and threshold checking)
	const skipPaths = ["/api-call", "/threshold-config", "/threshold-status"];

	if (
		skipPaths.some((path) => req.path.includes(path) || req.url.includes(path))
	) {
		return next();
	}

	const ip = getClientIp(req);
	const now = Date.now();

	let record = adminAttempts.get(ip);

	if (!record) {
		record = {
			count: 0,
			firstRequestAt: now,
		};
		adminAttempts.set(ip, record);
	}

	if (now - record.firstRequestAt > ADMIN_RATE_LIMIT_CONFIG.windowMs) {
		record.count = 0;
		record.firstRequestAt = now;
	}

	record.count++;

	if (record.count > ADMIN_RATE_LIMIT_CONFIG.maxRequests) {
		const remainingSeconds = Math.ceil(
			(ADMIN_RATE_LIMIT_CONFIG.windowMs - (now - record.firstRequestAt)) / 1000,
		);

		logger.warn("Admin rate limit exceeded", {
			ip,
			count: record.count,
			maxRequests: ADMIN_RATE_LIMIT_CONFIG.maxRequests,
			remainingSeconds,
		});

		return res.status(429).json({
			error: {
				type: "rate_limit_error",
				message: `请求过于频繁，请在 ${remainingSeconds} 秒后重试`,
			},
		});
	}

	next();
}
