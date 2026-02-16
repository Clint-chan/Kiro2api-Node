import { describe, expect, it } from "vitest";
import {
	canAccessModel,
	filterModelsByPermission,
	getAllowedChannels,
	getAllowedModels,
	isChannelAllowed,
	isModelAllowed,
} from "../user-permissions.js";

describe("user-permissions", () => {
	describe("getAllowedChannels", () => {
		it("应该返回默认渠道 kiro", () => {
			const user = { allowed_channels: null };
			expect(getAllowedChannels(user)).toEqual(["kiro"]);
		});

		it("应该解析 JSON 数组字符串", () => {
			const user = { allowed_channels: '["kiro", "cliproxy"]' };
			expect(getAllowedChannels(user)).toEqual(["kiro", "cliproxy"]);
		});

		it("应该处理已经是数组的情况", () => {
			const user = { allowed_channels: ["kiro", "cliproxy"] };
			expect(getAllowedChannels(user)).toEqual(["kiro", "cliproxy"]);
		});

		it("应该去重", () => {
			const user = { allowed_channels: ["kiro", "kiro", "cliproxy"] };
			expect(getAllowedChannels(user)).toEqual(["kiro", "cliproxy"]);
		});

		it("应该过滤空字符串", () => {
			const user = { allowed_channels: ["kiro", "", "cliproxy", "  "] };
			expect(getAllowedChannels(user)).toEqual(["kiro", "cliproxy"]);
		});

		it("应该处理无效 JSON", () => {
			const user = { allowed_channels: "invalid json" };
			expect(getAllowedChannels(user)).toEqual(["kiro"]);
		});

		it("应该处理空字符串", () => {
			const user = { allowed_channels: "" };
			expect(getAllowedChannels(user)).toEqual(["kiro"]);
		});
	});

	describe("getAllowedModels", () => {
		it("应该返回空数组当没有限制时", () => {
			const user = { allowed_models: null };
			expect(getAllowedModels(user)).toEqual([]);
		});

		it("应该解析 JSON 数组字符串", () => {
			const user = {
				allowed_models: '["claude-sonnet-4.5", "claude-opus-4.5"]',
			};
			expect(getAllowedModels(user)).toEqual([
				"claude-sonnet-4.5",
				"claude-opus-4.5",
			]);
		});

		it("应该处理已经是数组的情况", () => {
			const user = { allowed_models: ["claude-sonnet-4.5", "claude-opus-4.5"] };
			expect(getAllowedModels(user)).toEqual([
				"claude-sonnet-4.5",
				"claude-opus-4.5",
			]);
		});

		it("应该去重", () => {
			const user = {
				allowed_models: ["claude-sonnet-4.5", "claude-sonnet-4.5"],
			};
			expect(getAllowedModels(user)).toEqual(["claude-sonnet-4.5"]);
		});
	});

	describe("isChannelAllowed", () => {
		it("应该允许默认渠道", () => {
			const user = { allowed_channels: null };
			expect(isChannelAllowed(user, "kiro")).toBe(true);
		});

		it("应该允许配置的渠道", () => {
			const user = { allowed_channels: ["kiro", "cliproxy"] };
			expect(isChannelAllowed(user, "kiro")).toBe(true);
			expect(isChannelAllowed(user, "cliproxy")).toBe(true);
		});

		it("应该拒绝未配置的渠道", () => {
			const user = { allowed_channels: ["kiro"] };
			expect(isChannelAllowed(user, "cliproxy")).toBe(false);
		});

		it("应该拒绝空渠道名", () => {
			const user = { allowed_channels: ["kiro"] };
			expect(isChannelAllowed(user, "")).toBe(false);
			expect(isChannelAllowed(user, null)).toBe(false);
			expect(isChannelAllowed(user, undefined)).toBe(false);
		});

		it("应该处理空格", () => {
			const user = { allowed_channels: ["kiro"] };
			expect(isChannelAllowed(user, "  kiro  ")).toBe(true);
		});
	});

	describe("isModelAllowed", () => {
		it("应该允许所有模型当没有限制时", () => {
			const user = { allowed_models: null };
			expect(isModelAllowed(user, "claude-sonnet-4.5")).toBe(true);
			expect(isModelAllowed(user, "any-model")).toBe(true);
		});

		it("应该允许配置的模型", () => {
			const user = { allowed_models: ["claude-sonnet-4.5"] };
			expect(isModelAllowed(user, "claude-sonnet-4.5")).toBe(true);
		});

		it("应该拒绝未配置的模型", () => {
			const user = { allowed_models: ["claude-sonnet-4.5"] };
			expect(isModelAllowed(user, "claude-opus-4.5")).toBe(false);
		});

		it("应该拒绝空模型名", () => {
			const user = { allowed_models: ["claude-sonnet-4.5"] };
			expect(isModelAllowed(user, "")).toBe(false);
			expect(isModelAllowed(user, null)).toBe(false);
			expect(isModelAllowed(user, undefined)).toBe(false);
		});
	});

	describe("canAccessModel", () => {
		it("应该允许有权限的访问", () => {
			const user = {
				allowed_channels: ["kiro"],
				allowed_models: null,
			};
			const result = canAccessModel(user, "claude-sonnet-4.5", "kiro");
			expect(result.allowed).toBe(true);
		});

		it("应该拒绝无渠道权限的访问", () => {
			const user = {
				allowed_channels: ["kiro"],
				allowed_models: null,
			};
			const result = canAccessModel(user, "claude-sonnet-4.5", "cliproxy");
			expect(result.allowed).toBe(false);
			expect(result.error.type).toBe("permission_error");
			expect(result.error.message).toContain("Channel");
		});

		it("应该拒绝无模型权限的访问", () => {
			const user = {
				allowed_channels: ["kiro"],
				allowed_models: ["claude-opus-4.5"],
			};
			const result = canAccessModel(user, "claude-sonnet-4.5", "kiro");
			expect(result.allowed).toBe(false);
			expect(result.error.type).toBe("permission_error");
			expect(result.error.message).toContain("Model");
		});
	});

	describe("filterModelsByPermission", () => {
		it("应该过滤出有权限的模型", () => {
			const user = {
				allowed_channels: ["kiro"],
				allowed_models: ["claude-sonnet-4.5"],
			};
			const models = [
				{ id: "claude-sonnet-4.5" },
				{ id: "claude-opus-4.5" },
				{ id: "claude-haiku-4.5" },
			];
			const resolveChannel = () => "kiro";

			const filtered = filterModelsByPermission(user, models, resolveChannel);
			expect(filtered).toHaveLength(1);
			expect(filtered[0].id).toBe("claude-sonnet-4.5");
		});

		it("应该处理字符串数组", () => {
			const user = {
				allowed_channels: ["kiro"],
				allowed_models: null,
			};
			const models = ["claude-sonnet-4.5", "claude-opus-4.5"];
			const resolveChannel = () => "kiro";

			const filtered = filterModelsByPermission(user, models, resolveChannel);
			expect(filtered).toHaveLength(2);
		});

		it("应该过滤掉无效的模型", () => {
			const user = {
				allowed_channels: ["kiro"],
				allowed_models: null,
			};
			const models = [{ id: "claude-sonnet-4.5" }, { id: null }, null];
			const resolveChannel = () => "kiro";

			const filtered = filterModelsByPermission(user, models, resolveChannel);
			expect(filtered).toHaveLength(1);
		});

		it("应该根据渠道权限过滤", () => {
			const user = {
				allowed_channels: ["kiro"],
				allowed_models: null,
			};
			const models = [{ id: "claude-sonnet-4.5" }, { id: "gemini-pro" }];
			const resolveChannel = (id) =>
				id.includes("gemini") ? "cliproxy" : "kiro";

			const filtered = filterModelsByPermission(user, models, resolveChannel);
			expect(filtered).toHaveLength(1);
			expect(filtered[0].id).toBe("claude-sonnet-4.5");
		});
	});
});
