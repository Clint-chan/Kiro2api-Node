import { describe, expect, it } from "vitest";
import {
	DEFAULT_PRICING,
	getAllModelPricing,
	getModelPricing,
	MODEL_PRICING,
} from "../model-pricing.js";

describe("model-pricing", () => {
	describe("getModelPricing", () => {
		it("应该返回 Sonnet 4.5 的定价", () => {
			const pricing = getModelPricing("claude-sonnet-4-5-20250929");
			expect(pricing.input).toBe(3.0);
			expect(pricing.output).toBe(15.0);
		});

		it("应该返回 Opus 4.5 的定价", () => {
			const pricing = getModelPricing("claude-opus-4-5-20251101");
			expect(pricing.input).toBe(15.0);
			expect(pricing.output).toBe(75.0);
		});

		it("应该返回 Haiku 4.5 的定价", () => {
			const pricing = getModelPricing("claude-haiku-4-5-20251001");
			expect(pricing.input).toBe(1.0);
			expect(pricing.output).toBe(5.0);
		});

		it("应该支持简短的模型名称", () => {
			expect(getModelPricing("claude-sonnet-4.5")).toEqual({
				input: 3.0,
				output: 15.0,
			});
			expect(getModelPricing("claude-opus-4.5")).toEqual({
				input: 15.0,
				output: 75.0,
			});
			expect(getModelPricing("claude-haiku-4.5")).toEqual({
				input: 1.0,
				output: 5.0,
			});
		});

		it("应该支持大小写不敏感匹配", () => {
			const pricing = getModelPricing("CLAUDE-SONNET-4-5-20250929");
			expect(pricing.input).toBe(3.0);
			expect(pricing.output).toBe(15.0);
		});

		it("应该支持部分匹配 - haiku", () => {
			const pricing = getModelPricing("some-haiku-model");
			expect(pricing.input).toBe(1.0);
			expect(pricing.output).toBe(5.0);
		});

		it("应该支持部分匹配 - opus", () => {
			const pricing = getModelPricing("some-opus-model");
			expect(pricing.input).toBe(15.0);
			expect(pricing.output).toBe(75.0);
		});

		it("应该支持部分匹配 - sonnet", () => {
			const pricing = getModelPricing("some-sonnet-model");
			expect(pricing.input).toBe(3.0);
			expect(pricing.output).toBe(15.0);
		});

		it("应该对未知模型返回默认定价", () => {
			const pricing = getModelPricing("unknown-model");
			expect(pricing).toEqual(DEFAULT_PRICING);
		});

		it("应该对空模型名返回默认定价", () => {
			expect(getModelPricing("")).toEqual(DEFAULT_PRICING);
			expect(getModelPricing(null)).toEqual(DEFAULT_PRICING);
			expect(getModelPricing(undefined)).toEqual(DEFAULT_PRICING);
		});
	});

	describe("getAllModelPricing", () => {
		it("应该返回所有模型的定价信息", () => {
			const allPricing = getAllModelPricing();
			expect(allPricing).toHaveLength(3);
			expect(allPricing[0].id).toBe("claude-sonnet-4-5-20250929");
			expect(allPricing[1].id).toBe("claude-opus-4-5-20251101");
			expect(allPricing[2].id).toBe("claude-haiku-4-5-20251001");
		});

		it("每个模型应该包含 id, name, pricing", () => {
			const allPricing = getAllModelPricing();
			allPricing.forEach((model) => {
				expect(model).toHaveProperty("id");
				expect(model).toHaveProperty("name");
				expect(model).toHaveProperty("pricing");
				expect(model.pricing).toHaveProperty("input");
				expect(model.pricing).toHaveProperty("output");
			});
		});
	});

	describe("MODEL_PRICING", () => {
		it("应该包含所有主要模型", () => {
			expect(MODEL_PRICING).toHaveProperty("claude-sonnet-4-5-20250929");
			expect(MODEL_PRICING).toHaveProperty("claude-opus-4-5-20251101");
			expect(MODEL_PRICING).toHaveProperty("claude-haiku-4-5-20251001");
		});

		it("所有定价应该是正数", () => {
			Object.values(MODEL_PRICING).forEach((pricing) => {
				expect(pricing.input).toBeGreaterThan(0);
				expect(pricing.output).toBeGreaterThan(0);
			});
		});

		it("output 价格应该高于 input 价格", () => {
			Object.values(MODEL_PRICING).forEach((pricing) => {
				expect(pricing.output).toBeGreaterThan(pricing.input);
			});
		});
	});
});
