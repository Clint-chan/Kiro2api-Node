import { get_encoding } from "tiktoken";

const encoderCache = {};

function getEncoderForModel(model) {
	if (!model) {
		return getEncoder("cl100k_base");
	}

	const modelLower = model.toLowerCase();

	if (modelLower.startsWith("gpt-5")) {
		return getEncoder("o200k_base");
	}
	if (modelLower.startsWith("gpt-4o")) {
		return getEncoder("o200k_base");
	}
	if (modelLower.startsWith("gpt-4")) {
		return getEncoder("cl100k_base");
	}
	if (modelLower.startsWith("gpt-3.5") || modelLower.startsWith("gpt-3")) {
		return getEncoder("cl100k_base");
	}
	if (modelLower.includes("gemini")) {
		return getEncoder("cl100k_base");
	}
	if (modelLower.includes("claude")) {
		return getEncoder("cl100k_base");
	}

	return getEncoder("o200k_base");
}

function getEncoder(encoding) {
	if (!encoderCache[encoding]) {
		encoderCache[encoding] = get_encoding(encoding);
	}
	return encoderCache[encoding];
}

export function countTokens(text, model = null) {
	if (!text) return 0;
	try {
		const enc = getEncoderForModel(model);
		return enc.encode(text).length;
	} catch (_e) {
		return Math.ceil(text.length / 2);
	}
}

export function countMessagesTokens(messages, model = null) {
	if (!messages || !Array.isArray(messages)) return 0;

	let total = 0;
	const enc = getEncoderForModel(model);

	for (const msg of messages) {
		total += countTokens(msg.role || "", model);
		total += countTokens(msg.name || "", model);

		if (typeof msg.content === "string") {
			total += countTokens(msg.content, model);
		} else if (Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === "text") {
					total += countTokens(block.text || "", model);
				} else if (block.type === "image_url") {
					total += countTokens(block.image_url?.url || "", model);
				} else if (block.type === "tool_result") {
					total += countTokens(block.name || "", model);
					total += countTokens(
						typeof block.content === "string"
							? block.content
							: JSON.stringify(block.content),
						model,
					);
				} else if (block.type === "tool_use") {
					total += countTokens(block.name || "", model);
					total += countTokens(JSON.stringify(block.input || {}), model);
				}
			}
		}

		if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
			for (const call of msg.tool_calls) {
				total += countTokens(call.id || "", model);
				total += countTokens(call.type || "", model);
				if (call.function) {
					total += countTokens(call.function.name || "", model);
					total += countTokens(call.function.arguments || "", model);
				}
			}
		}

		if (msg.function_call) {
			total += countTokens(msg.function_call.name || "", model);
			total += countTokens(msg.function_call.arguments || "", model);
		}

		total += 4;
	}

	return total;
}

export function countToolUseTokens(toolUseBuffers, model = null) {
	let total = 0;
	for (const toolUse of toolUseBuffers.values()) {
		total += countTokens(toolUse.name || "", model);
		total += countTokens(toolUse.input || "", model);
	}
	return total;
}

export function countRequestTokens(requestBody, model = null) {
	let total = 0;

	if (requestBody.messages) {
		total += countMessagesTokens(requestBody.messages, model);
	}

	if (requestBody.tools && Array.isArray(requestBody.tools)) {
		for (const tool of requestBody.tools) {
			total += countTokens(tool.type || "", model);
			if (tool.function) {
				total += countTokens(tool.function.name || "", model);
				total += countTokens(tool.function.description || "", model);
				if (tool.function.parameters) {
					total += countTokens(JSON.stringify(tool.function.parameters), model);
				}
			}
		}
	}

	if (requestBody.functions && Array.isArray(requestBody.functions)) {
		for (const func of requestBody.functions) {
			total += countTokens(func.name || "", model);
			total += countTokens(func.description || "", model);
			if (func.parameters) {
				total += countTokens(JSON.stringify(func.parameters), model);
			}
		}
	}

	if (requestBody.tool_choice) {
		if (typeof requestBody.tool_choice === "string") {
			total += countTokens(requestBody.tool_choice, model);
		} else {
			total += countTokens(JSON.stringify(requestBody.tool_choice), model);
		}
	}

	if (requestBody.response_format) {
		total += countTokens(requestBody.response_format.type || "", model);
		if (requestBody.response_format.json_schema) {
			total += countTokens(
				JSON.stringify(requestBody.response_format.json_schema),
				model,
			);
		}
	}

	if (requestBody.system) {
		total += countTokens(requestBody.system, model);
	}

	return total;
}
