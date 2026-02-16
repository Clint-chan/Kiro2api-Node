import { logger } from "../logger.js";

const loginAttempts = new Map();

const RATE_LIMIT_CONFIG = {
	maxAttempts: 5,
	windowMs: 5 * 60 * 1000,
	lockoutMs: 30 * 60 * 1000,
	maxEntries: 10000,
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

	if (loginAttempts.size > RATE_LIMIT_CONFIG.maxEntries) {
		const entriesToDelete = loginAttempts.size - RATE_LIMIT_CONFIG.maxEntries;
		let deleted = 0;
		for (const [ip] of loginAttempts.entries()) {
			if (deleted >= entriesToDelete) break;
			loginAttempts.delete(ip);
			deleted++;
		}
		logger.warn("Rate limit map exceeded max size, cleaned up oldest entries", {
			deleted,
			remaining: loginAttempts.size,
		});
	}

	for (const [ip, data] of loginAttempts.entries()) {
		if (data.lockedUntil && now > data.lockedUntil) {
			loginAttempts.delete(ip);
		}
	}
}

setInterval(cleanupExpiredEntries, 60 * 1000);

export function loginRateLimiter(req, res, next) {
	const ip = getClientIp(req);
	const now = Date.now();

	let record = loginAttempts.get(ip);

	if (!record) {
		record = {
			failures: 0,
			firstFailureAt: null,
			lockedUntil: null,
		};
		loginAttempts.set(ip, record);
	}

	if (record.lockedUntil && now < record.lockedUntil) {
		const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
		logger.warn("Login rate limit: IP locked", {
			ip,
			remainingSeconds,
			failures: record.failures,
		});

		return res.status(429).json({
			error: {
				type: "rate_limit_error",
				message: `登录失败次数过多，请在 ${remainingSeconds} 秒后重试`,
			},
		});
	}

	if (
		record.firstFailureAt &&
		now - record.firstFailureAt > RATE_LIMIT_CONFIG.windowMs
	) {
		record.failures = 0;
		record.firstFailureAt = null;
	}

	req.rateLimitRecord = record;
	req.rateLimitIp = ip;

	next();
}

export function recordLoginFailure(req) {
	const record = req.rateLimitRecord;
	const ip = req.rateLimitIp;
	const now = Date.now();

	if (!record) return;

	if (!record.firstFailureAt) {
		record.firstFailureAt = now;
	}

	record.failures += 1;

	logger.warn("Login failure recorded", {
		ip,
		failures: record.failures,
		maxAttempts: RATE_LIMIT_CONFIG.maxAttempts,
	});

	if (record.failures >= RATE_LIMIT_CONFIG.maxAttempts) {
		record.lockedUntil = now + RATE_LIMIT_CONFIG.lockoutMs;
		logger.error("IP locked due to excessive login failures", {
			ip,
			failures: record.failures,
			lockedUntilTimestamp: record.lockedUntil,
			lockoutMinutes: RATE_LIMIT_CONFIG.lockoutMs / 60000,
		});
	}
}
