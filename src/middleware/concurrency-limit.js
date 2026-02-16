import { logger } from "../logger.js";

let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 100;

export function concurrencyLimiter(req, res, next) {
	if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
		logger.warn("Concurrency limit reached", {
			activeRequests,
			maxConcurrent: MAX_CONCURRENT_REQUESTS,
			path: req.path,
		});

		return res.status(503).json({
			error: {
				type: "rate_limit_error",
				message: "服务器繁忙，请稍后重试",
			},
		});
	}

	activeRequests++;

	res.on("finish", () => {
		activeRequests--;
	});

	res.on("close", () => {
		activeRequests--;
	});

	next();
}

export function getConcurrencyStats() {
	return {
		active: activeRequests,
		max: MAX_CONCURRENT_REQUESTS,
		available: MAX_CONCURRENT_REQUESTS - activeRequests,
	};
}
