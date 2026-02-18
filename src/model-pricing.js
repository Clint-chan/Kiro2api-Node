/**
 * Model Pricing Configuration
 * Prices are in USD per million tokens ($/MTok)
 */

export const MODEL_PRICING = {
	// Claude Sonnet 4.6
	"claude-sonnet-4-6": {
		input: 3.0, // $3 per MTok
		output: 15.0, // $15 per MTok
	},
	"claude-sonnet-4.6": {
		input: 3.0,
		output: 15.0,
	},

	// Claude Sonnet 4.5
	"claude-sonnet-4-5-20250929": {
		input: 3.0, // $3 per MTok
		output: 15.0, // $15 per MTok
	},
	"claude-sonnet-4.5": {
		input: 3.0,
		output: 15.0,
	},

	// Claude Opus 4.6
	"claude-opus-4-6": {
		input: 5.0, // $5 per MTok
		output: 15.0, // $15 per MTok
	},
	"claude-opus-4-6-20251220": {
		input: 5.0,
		output: 15.0,
	},
	"claude-opus-4.6": {
		input: 5.0,
		output: 15.0,
	},

	// Claude Opus 4.5
	"claude-opus-4-5-20251101": {
		input: 5.0, // $5 per MTok
		output: 15.0, // $15 per MTok
	},
	"claude-opus-4.5": {
		input: 5.0,
		output: 15.0,
	},

	// Claude Haiku 4.5
	"claude-haiku-4-5-20251001": {
		input: 1.0, // $1 per MTok
		output: 5.0, // $5 per MTok
	},
	"claude-haiku-4.5": {
		input: 1.0,
		output: 5.0,
	},
};

// Default pricing (fallback to Sonnet)
export const DEFAULT_PRICING = {
	input: 3.0,
	output: 15.0,
};

/**
 * Get pricing for a specific model
 * @param {string} model - Model identifier
 * @returns {object} Pricing object with input and output prices
 */
export function getModelPricing(model) {
	if (!model) {
		return DEFAULT_PRICING;
	}

	const modelLower = model.toLowerCase();

	// Try exact match first
	if (MODEL_PRICING[model]) {
		return MODEL_PRICING[model];
	}

	// Try case-insensitive match
	for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
		if (key.toLowerCase() === modelLower) {
			return pricing;
		}
	}

	// Try partial match
	if (modelLower.includes("haiku")) {
		return MODEL_PRICING["claude-haiku-4.5"];
	}
	if (modelLower.includes("opus")) {
		return MODEL_PRICING["claude-opus-4.5"];
	}
	if (modelLower.includes("sonnet")) {
		return MODEL_PRICING["claude-sonnet-4.5"];
	}

	// Fallback to default
	return DEFAULT_PRICING;
}

/**
 * Get all available models with their pricing
 * @returns {array} Array of model objects with pricing info
 */
export function getAllModelPricing() {
	return [
		{
			id: "claude-sonnet-4-6",
			name: "Claude Sonnet 4.6",
			pricing: MODEL_PRICING["claude-sonnet-4-6"],
		},
		{
			id: "claude-sonnet-4-5-20250929",
			name: "Claude Sonnet 4.5",
			pricing: MODEL_PRICING["claude-sonnet-4-5-20250929"],
		},
		{
			id: "claude-opus-4-6-20251220",
			name: "Claude Opus 4.6",
			pricing: MODEL_PRICING["claude-opus-4-6-20251220"],
		},
		{
			id: "claude-opus-4-5-20251101",
			name: "Claude Opus 4.5",
			pricing: MODEL_PRICING["claude-opus-4-5-20251101"],
		},
		{
			id: "claude-haiku-4-5-20251001",
			name: "Claude Haiku 4.5",
			pricing: MODEL_PRICING["claude-haiku-4-5-20251001"],
		},
	];
}
