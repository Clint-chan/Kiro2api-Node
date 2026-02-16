import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionManager } from "../subscription.js";

describe("SubscriptionManager", () => {
	let subscriptionManager;
	let mockDb;

	beforeEach(() => {
		mockDb = {
			getUserById: vi.fn(),
			db: {
				prepare: vi.fn(() => ({
					run: vi.fn(),
				})),
			},
		};
		subscriptionManager = new SubscriptionManager(mockDb);
	});

	describe("shouldResetQuota", () => {
		it("应该在从未重置过时返回 true", () => {
			const user = {
				subscription_type: "daily",
				last_reset_at: null,
			};
			const now = new Date();

			expect(subscriptionManager.shouldResetQuota(user, now)).toBe(true);
		});

		it("应该在日订阅超过 24 小时后返回 true", () => {
			const lastReset = new Date("2024-01-01T00:00:00Z");
			const now = new Date("2024-01-02T01:00:00Z");
			const user = {
				subscription_type: "daily",
				last_reset_at: lastReset.toISOString(),
			};

			expect(subscriptionManager.shouldResetQuota(user, now)).toBe(true);
		});

		it("应该在日订阅未满 24 小时时返回 false", () => {
			const lastReset = new Date("2024-01-01T00:00:00Z");
			const now = new Date("2024-01-01T23:00:00Z");
			const user = {
				subscription_type: "daily",
				last_reset_at: lastReset.toISOString(),
			};

			expect(subscriptionManager.shouldResetQuota(user, now)).toBe(false);
		});

		it("应该在月订阅跨月时返回 true", () => {
			const lastReset = new Date(2024, 0, 31, 23, 59, 59);
			const now = new Date(2024, 1, 1, 0, 0, 0);
			const user = {
				subscription_type: "monthly",
				last_reset_at: lastReset.toISOString(),
			};

			expect(subscriptionManager.shouldResetQuota(user, now)).toBe(true);
		});

		it("应该在月订阅同月时返回 false", () => {
			const lastReset = new Date(2024, 0, 1, 0, 0, 0);
			const now = new Date(2024, 0, 31, 23, 59, 59);
			const user = {
				subscription_type: "monthly",
				last_reset_at: lastReset.toISOString(),
			};

			expect(subscriptionManager.shouldResetQuota(user, now)).toBe(false);
		});

		it("应该在月订阅跨年时返回 true", () => {
			const lastReset = new Date(2023, 11, 31, 23, 59, 59);
			const now = new Date(2024, 0, 1, 0, 0, 0);
			const user = {
				subscription_type: "monthly",
				last_reset_at: lastReset.toISOString(),
			};

			expect(subscriptionManager.shouldResetQuota(user, now)).toBe(true);
		});

		it("应该对无订阅类型返回 false", () => {
			const user = {
				subscription_type: "none",
				last_reset_at: new Date("2024-01-01T00:00:00Z").toISOString(),
			};
			const now = new Date("2024-02-01T00:00:00Z");

			expect(subscriptionManager.shouldResetQuota(user, now)).toBe(false);
		});
	});

	describe("setSubscription - 参数验证", () => {
		beforeEach(() => {
			mockDb.getUserById.mockReturnValue({
				id: 1,
				username: "test",
				balance: 100,
				subscription_type: "none",
			});
		});

		it("应该拒绝不存在的用户", () => {
			mockDb.getUserById.mockReturnValue(null);

			expect(() => {
				subscriptionManager.setSubscription(999, "daily", 100, 1);
			}).toThrow("用户不存在");
		});

		it("应该拒绝无效的订阅类型", () => {
			expect(() => {
				subscriptionManager.setSubscription(1, "invalid", 100, 1);
			}).toThrow("订阅类型必须是 daily 或 monthly");
		});

		it("应该拒绝零或负数额度", () => {
			expect(() => {
				subscriptionManager.setSubscription(1, "daily", 0, 1);
			}).toThrow("订阅额度必须大于 0");

			expect(() => {
				subscriptionManager.setSubscription(1, "daily", -100, 1);
			}).toThrow("订阅额度必须大于 0");
		});

		it("应该拒绝零或负数时长", () => {
			expect(() => {
				subscriptionManager.setSubscription(1, "daily", 100, 0);
			}).toThrow("订阅时长必须大于 0");

			expect(() => {
				subscriptionManager.setSubscription(1, "daily", 100, -1);
			}).toThrow("订阅时长必须大于 0");
		});
	});

	describe("cancelSubscription", () => {
		it("应该拒绝不存在的用户", () => {
			mockDb.getUserById.mockReturnValue(null);

			expect(() => {
				subscriptionManager.cancelSubscription(999);
			}).toThrow("用户不存在");
		});

		it("应该调用数据库更新", () => {
			mockDb.getUserById.mockReturnValue({
				id: 1,
				username: "test",
				subscription_type: "daily",
			});

			subscriptionManager.cancelSubscription(1);

			expect(mockDb.db.prepare).toHaveBeenCalled();
		});
	});
});
