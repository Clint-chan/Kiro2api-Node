import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillingManager } from "../billing.js";

describe("BillingManager", () => {
	let billingManager;
	let mockDb;

	beforeEach(() => {
		mockDb = {
			getUserByApiKey: vi.fn(),
			updateUserBalance: vi.fn(),
			recordUsage: vi.fn(),
		};
		billingManager = new BillingManager(mockDb);
	});

	describe("calculateCost", () => {
		it("应该正确计算费用", () => {
			const result = billingManager.calculateCost(
				1000000, // 1M input tokens
				500000, // 0.5M output tokens
				3.0, // $3/MTok input
				15.0, // $15/MTok output
			);

			expect(result.inputCost).toBe(3.0); // 1M * $3/MTok = $3
			expect(result.outputCost).toBe(7.5); // 0.5M * $15/MTok = $7.5
			expect(result.totalCost).toBe(10.5); // $3 + $7.5 = $10.5
		});

		it("应该处理 0 token", () => {
			const result = billingManager.calculateCost(0, 0, 3.0, 15.0);

			expect(result.inputCost).toBe(0);
			expect(result.outputCost).toBe(0);
			expect(result.totalCost).toBe(0);
		});

		it("应该正确处理小数 token", () => {
			const result = billingManager.calculateCost(
				1500, // 1.5K tokens
				2500, // 2.5K tokens
				3.0,
				15.0,
			);

			expect(result.inputCost).toBe(0.0045); // 1500/1M * $3 = $0.0045
			expect(result.outputCost).toBe(0.0375); // 2500/1M * $15 = $0.0375
			expect(result.totalCost).toBe(0.042); // $0.0045 + $0.0375 = $0.042
		});

		it("应该保留 6 位小数精度", () => {
			const result = billingManager.calculateCost(1, 1, 3.0, 15.0);

			expect(result.inputCost).toBe(0.000003); // 1/1M * $3
			expect(result.outputCost).toBe(0.000015); // 1/1M * $15
			expect(result.totalCost).toBe(0.000018);
		});
	});

	describe("calculateCostByModel", () => {
		it("应该使用模型定价计算费用", () => {
			const result = billingManager.calculateCostByModel(
				1000000,
				500000,
				"claude-sonnet-4-5-20250929",
			);

			// Claude Sonnet 4.5: $3/MTok input, $15/MTok output
			expect(result.inputCost).toBe(3.0);
			expect(result.outputCost).toBe(7.5);
			expect(result.totalCost).toBe(10.5);
		});

		it("应该处理未知模型（使用默认定价）", () => {
			const result = billingManager.calculateCostByModel(
				1000000,
				500000,
				"unknown-model",
			);

			// 默认定价: $3/MTok input, $15/MTok output
			expect(result.inputCost).toBe(3.0);
			expect(result.outputCost).toBe(7.5);
			expect(result.totalCost).toBe(10.5);
		});
	});
});
