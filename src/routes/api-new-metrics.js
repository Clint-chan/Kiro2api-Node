/**
 * API 指标记录辅助函数
 * 从 api-new.js 中提取，避免重复代码
 */

import { logger } from "../logger.js";
import { metrics } from "../metrics.js";

/**
 * 记录 API 请求成功指标
 */
export function recordApiSuccess(params) {
	const { userId, model, inputTokens, outputTokens, duration, cost, stream } =
		params;

	metrics.incrementCounter("kiro_api_requests_success_total", { model });
	metrics.recordHistogram(
		"kiro_api_request_duration_ms",
		{ model, status: "success" },
		duration,
	);
	metrics.incrementCounter("kiro_tokens_input_total", { model }, inputTokens);
	metrics.incrementCounter("kiro_tokens_output_total", { model }, outputTokens);

	logger.info("API request completed", {
		userId,
		model,
		inputTokens,
		outputTokens,
		duration,
		cost,
		stream: stream || false,
	});
}

/**
 * 记录 API 请求失败指标
 */
export function recordApiFailure(params) {
	const { userId, model, error, status, duration } = params;

	metrics.incrementCounter("kiro_api_requests_failed_total", {
		model,
		error_type: status || "unknown",
	});
	metrics.recordHistogram(
		"kiro_api_request_duration_ms",
		{
			model,
			status: "error",
		},
		duration,
	);

	logger.error("API request failed", {
		userId,
		model,
		error,
		status,
		duration,
	});
}

/**
 * 记录 API 请求开始
 */
export function recordApiStart(params) {
	const { userId, username, model, stream } = params;

	logger.info("API request received", {
		userId,
		username,
		model,
		stream,
	});

	metrics.incrementCounter("kiro_api_requests_total", {
		model,
		stream: stream ? "true" : "false",
	});
}
