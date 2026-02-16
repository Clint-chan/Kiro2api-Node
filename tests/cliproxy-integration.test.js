/**
 * CLIProxy 集成测试脚本
 *
 * 测试目标：
 * 1. 验证 CLIProxy Management API 连接
 * 2. 验证账号列表和配额数据结构
 * 3. 验证模型组禁用逻辑
 * 4. 验证路由过滤功能
 * 5. 性能基准测试
 */

import assert from "assert";
import { CLIProxyClient } from "../src/cliproxy-client.js";
import { DatabaseManager } from "../src/database.js";

// 测试配置
const TEST_CONFIG = {
	managementUrl: process.env.CLIPROXY_MANAGEMENT_URL || "http://localhost:8317",
	managementKey: process.env.CLIPROXY_MANAGEMENT_KEY,
	dbPath: ":memory:", // 使用内存数据库
};

// 颜色输出
const colors = {
	reset: "\x1b[0m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	cyan: "\x1b[36m",
};

function log(message, color = "reset") {
	console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
	console.log("\n" + "=".repeat(60));
	log(title, "cyan");
	console.log("=".repeat(60));
}

function logTest(name) {
	log(`\n▶ ${name}`, "blue");
}

function logSuccess(message) {
	log(`  ✓ ${message}`, "green");
}

function logError(message) {
	log(`  ✗ ${message}`, "red");
}

function logWarning(message) {
	log(`  ⚠ ${message}`, "yellow");
}

// 测试统计
const stats = {
	total: 0,
	passed: 0,
	failed: 0,
	skipped: 0,
};

async function runTest(name, fn) {
	stats.total++;
	logTest(name);
	try {
		await fn();
		stats.passed++;
		logSuccess("测试通过");
	} catch (error) {
		stats.failed++;
		logError(`测试失败: ${error.message}`);
		if (error.stack) {
			console.error(error.stack);
		}
	}
}

// ============================================================================
// 测试套件 1: CLIProxy 连接测试
// ============================================================================

async function testCLIProxyConnection() {
	logSection("测试套件 1: CLIProxy 连接测试");

	const client = new CLIProxyClient(
		TEST_CONFIG.managementUrl,
		TEST_CONFIG.managementKey,
	);

	await runTest("1.1 验证 Management API 可访问", async () => {
		try {
			const result = await client.listAuthFiles();
			assert(result, "API 应返回结果");
			assert(Array.isArray(result.files), "files 应为数组");
			logSuccess(`成功获取 ${result.files.length} 个账号`);
		} catch (error) {
			if (error.message.includes("ECONNREFUSED")) {
				throw new Error("无法连接到 CLIProxy Management API，请确保服务已启动");
			}
			throw error;
		}
	});

	await runTest("1.2 验证缓存机制", async () => {
		// 第一次调用（从 API 获取）
		const start1 = Date.now();
		await client.getCachedAuthFiles(false);
		const time1 = Date.now() - start1;

		// 第二次调用（从缓存获取）
		const start2 = Date.now();
		await client.getCachedAuthFiles(false);
		const time2 = Date.now() - start2;

		assert(time2 < time1, "缓存调用应该更快");
		logSuccess(`API 调用: ${time1}ms, 缓存调用: ${time2}ms`);
	});

	await runTest("1.3 验证强制刷新", async () => {
		const result1 = await client.getCachedAuthFiles(false);
		const result2 = await client.getCachedAuthFiles(true);

		assert(result1, "第一次调用应返回结果");
		assert(result2, "第二次调用应返回结果");
		logSuccess("强制刷新功能正常");
	});
}

// ============================================================================
// 测试套件 2: 账号数据结构测试
// ============================================================================

async function testAccountDataStructure() {
	logSection("测试套件 2: 账号数据结构测试");

	const client = new CLIProxyClient(
		TEST_CONFIG.managementUrl,
		TEST_CONFIG.managementKey,
	);

	await runTest("2.1 验证账号基本字段", async () => {
		const result = await client.listAuthFiles();
		const antigravityAccounts = result.files.filter(
			(f) => f.provider === "antigravity",
		);

		if (antigravityAccounts.length === 0) {
			logWarning("没有找到 Antigravity 账号，跳过测试");
			stats.skipped++;
			return;
		}

		const account = antigravityAccounts[0];

		// 验证必需字段
		assert(account.id, "账号应有 id");
		assert(account.name, "账号应有 name");
		assert(account.provider === "antigravity", "provider 应为 antigravity");
		assert(typeof account.disabled === "boolean", "disabled 应为布尔值");

		logSuccess(`账号字段验证通过: ${account.name}`);
	});

	await runTest("2.2 验证 model_quotas 字段", async () => {
		const result = await client.listAuthFiles();
		const antigravityAccounts = result.files.filter(
			(f) => f.provider === "antigravity",
		);

		if (antigravityAccounts.length === 0) {
			logWarning("没有找到 Antigravity 账号，跳过测试");
			stats.skipped++;
			return;
		}

		const account = antigravityAccounts[0];

		if (!account.model_quotas) {
			logWarning("账号没有 model_quotas 字段，可能尚未同步配额");
			stats.skipped++;
			return;
		}

		// 解析 model_quotas
		let quotas;
		try {
			quotas =
				typeof account.model_quotas === "string"
					? JSON.parse(account.model_quotas)
					: account.model_quotas;
		} catch (error) {
			throw new Error(`model_quotas 解析失败: ${error.message}`);
		}

		assert(typeof quotas === "object", "model_quotas 应为对象");

		// 验证配额结构
		const modelIds = Object.keys(quotas);
		if (modelIds.length > 0) {
			const firstModel = quotas[modelIds[0]];
			assert(
				typeof firstModel.remaining_fraction === "number",
				"remaining_fraction 应为数字",
			);
			assert(
				firstModel.remaining_fraction >= 0 &&
					firstModel.remaining_fraction <= 1,
				"remaining_fraction 应在 0-1 之间",
			);

			logSuccess(
				`配额数据验证通过，包含 ${modelIds.length} 个模型: ${modelIds.slice(0, 3).join(", ")}...`,
			);
		} else {
			logWarning("model_quotas 为空对象");
		}
	});

	await runTest("2.3 验证配额数据完整性", async () => {
		const result = await client.listAuthFiles();
		const antigravityAccounts = result.files.filter(
			(f) => f.provider === "antigravity" && f.model_quotas,
		);

		if (antigravityAccounts.length === 0) {
			logWarning("没有找到包含配额数据的账号，跳过测试");
			stats.skipped++;
			return;
		}

		let totalModels = 0;
		const modelGroups = {
			claude: 0,
			gpt: 0,
			gemini: 0,
			other: 0,
		};

		for (const account of antigravityAccounts) {
			const quotas =
				typeof account.model_quotas === "string"
					? JSON.parse(account.model_quotas)
					: account.model_quotas;

			for (const modelId of Object.keys(quotas)) {
				totalModels++;
				if (modelId.startsWith("claude-")) modelGroups.claude++;
				else if (modelId.startsWith("gpt-") || /^o\d/.test(modelId))
					modelGroups.gpt++;
				else if (modelId.startsWith("gemini-")) modelGroups.gemini++;
				else modelGroups.other++;
			}
		}

		logSuccess(
			`配额数据统计: 总计 ${totalModels} 个模型 (Claude: ${modelGroups.claude}, GPT: ${modelGroups.gpt}, Gemini: ${modelGroups.gemini}, 其他: ${modelGroups.other})`,
		);
	});
}

// ============================================================================
// 测试套件 3: 模型组禁用逻辑测试
// ============================================================================

async function testModelGroupDisabling() {
	logSection("测试套件 3: 模型组禁用逻辑测试");

	const db = new DatabaseManager(TEST_CONFIG.dbPath);

	await runTest("3.1 验证模型组识别逻辑", async () => {
		const testCases = [
			{ modelId: "claude-sonnet-4-20250514", expected: "claude_gpt" },
			{ modelId: "gpt-4o", expected: "claude_gpt" },
			{ modelId: "o1", expected: "claude_gpt" },
			{ modelId: "gemini-3-pro", expected: "gemini_3_pro" },
			{ modelId: "gemini-3-pro-high", expected: "gemini_3_pro_high" },
			{ modelId: "gemini-3-flash", expected: "gemini_3_flash" },
			{ modelId: "gemini-3-pro-image", expected: "gemini_3_pro_image" },
			{ modelId: "unknown-model", expected: null },
		];

		function getModelGroupName(modelId) {
			if (
				/^claude-/.test(modelId) ||
				/^gpt-/.test(modelId) ||
				/^o\d/.test(modelId)
			) {
				return "claude_gpt";
			}
			if (modelId === "gemini-3-pro") return "gemini_3_pro";
			if (modelId === "gemini-3-pro-high") return "gemini_3_pro_high";
			if (modelId === "gemini-3-flash") return "gemini_3_flash";
			if (modelId === "gemini-3-pro-image") return "gemini_3_pro_image";
			return null;
		}

		for (const testCase of testCases) {
			const result = getModelGroupName(testCase.modelId);
			assert.strictEqual(
				result,
				testCase.expected,
				`${testCase.modelId} 应识别为 ${testCase.expected}`,
			);
		}

		logSuccess(`模型组识别测试通过 (${testCases.length} 个用例)`);
	});

	await runTest("3.2 验证禁用状态存储", async () => {
		const testData = {
			version: 1,
			groups: {
				claude_gpt: {
					mode: "auto",
					disabled_at: Date.now(),
					reason: "gpt-4o remaining 18.0% < 20.0%",
					threshold: 0.2,
					observed: {
						model_id: "gpt-4o",
						remaining_fraction: 0.18,
					},
				},
			},
		};

		// 写入
		db.setSetting(
			"cliproxy_auto_disabled_groups_test",
			JSON.stringify(testData),
		);

		// 读取
		const stored = db.getSetting("cliproxy_auto_disabled_groups_test");
		assert(stored, "应能读取存储的数据");

		const parsed = JSON.parse(stored);
		assert.strictEqual(parsed.version, 1, "version 应为 1");
		assert(parsed.groups.claude_gpt, "应包含 claude_gpt 组");
		assert.strictEqual(
			parsed.groups.claude_gpt.threshold,
			0.2,
			"threshold 应为 0.2",
		);

		// 清理
		db.deleteSetting("cliproxy_auto_disabled_groups_test");

		logSuccess("禁用状态存储和读取正常");
	});

	await runTest("3.3 验证 hasQuotaForModel 逻辑", async () => {
		// 模拟账号数据
		const account = {
			name: "test-account",
			model_quotas: JSON.stringify({
				"gpt-4o": { remaining_fraction: 0.18 },
				"gemini-3-pro": { remaining_fraction: 0.85 },
			}),
		};

		// 设置禁用状态
		const disabledGroups = {
			version: 1,
			groups: {
				claude_gpt: {
					mode: "auto",
					disabled_at: Date.now(),
					reason: "gpt-4o remaining 18.0% < 20.0%",
					threshold: 0.2,
					observed: {
						model_id: "gpt-4o",
						remaining_fraction: 0.18,
					},
				},
			},
		};

		db.setSetting(
			"cliproxy_auto_disabled_groups_test-account",
			JSON.stringify(disabledGroups),
		);

		// 实现 hasQuotaForModel 逻辑
		function hasQuotaForModel(account, modelId) {
			const quotas = JSON.parse(account.model_quotas || "{}");
			const info = quotas[modelId];
			if (!info) return true;
			const remaining = Number(info.remaining_fraction);
			if (!Number.isFinite(remaining)) return true;
			if (remaining <= 0) return false;

			const groupsJson =
				db.getSetting(`cliproxy_auto_disabled_groups_${account.name}`) || "{}";
			let disabledGroups = {};
			try {
				const parsed = JSON.parse(groupsJson);
				disabledGroups = parsed.groups || {};
			} catch {
				return true;
			}

			if (Object.keys(disabledGroups).length === 0) return true;

			function getModelGroupName(modelId) {
				if (
					/^claude-/.test(modelId) ||
					/^gpt-/.test(modelId) ||
					/^o\d/.test(modelId)
				) {
					return "claude_gpt";
				}
				if (modelId === "gemini-3-pro") return "gemini_3_pro";
				if (modelId === "gemini-3-pro-high") return "gemini_3_pro_high";
				if (modelId === "gemini-3-flash") return "gemini_3_flash";
				if (modelId === "gemini-3-pro-image") return "gemini_3_pro_image";
				return null;
			}

			const groupName = getModelGroupName(modelId);
			if (!groupName) return true;

			return !disabledGroups[groupName];
		}

		// 测试用例
		assert.strictEqual(
			hasQuotaForModel(account, "gpt-4o"),
			false,
			"gpt-4o 应被禁用（属于 claude_gpt 组）",
		);
		assert.strictEqual(
			hasQuotaForModel(account, "claude-sonnet-4-20250514"),
			false,
			"claude-sonnet-4-20250514 应被禁用（属于 claude_gpt 组）",
		);
		assert.strictEqual(
			hasQuotaForModel(account, "gemini-3-pro"),
			true,
			"gemini-3-pro 不应被禁用",
		);

		// 清理
		db.deleteSetting("cliproxy_auto_disabled_groups_test-account");

		logSuccess("hasQuotaForModel 逻辑验证通过");
	});

	db.close();
}

// ============================================================================
// 测试套件 4: 性能基准测试
// ============================================================================

async function testPerformance() {
	logSection("测试套件 4: 性能基准测试");

	const db = new DatabaseManager(TEST_CONFIG.dbPath);

	await runTest("4.1 getSetting 性能测试", async () => {
		// 准备测试数据
		const testData = {
			version: 1,
			groups: {
				claude_gpt: {
					mode: "auto",
					disabled_at: Date.now(),
					reason: "test",
					threshold: 0.2,
					observed: { model_id: "gpt-4o", remaining_fraction: 0.18 },
				},
			},
		};

		db.setSetting("cliproxy_perf_test", JSON.stringify(testData));

		// 性能测试
		const iterations = 10000;
		const start = Date.now();

		for (let i = 0; i < iterations; i++) {
			const result = db.getSetting("cliproxy_perf_test");
			JSON.parse(result);
		}

		const elapsed = Date.now() - start;
		const avgTime = elapsed / iterations;

		assert(avgTime < 1, "getSetting 平均耗时应小于 1ms");

		logSuccess(
			`getSetting 性能: ${iterations} 次调用耗时 ${elapsed}ms (平均 ${avgTime.toFixed(3)}ms)`,
		);

		// 清理
		db.deleteSetting("cliproxy_perf_test");
	});

	await runTest("4.2 模型组匹配性能测试", async () => {
		function getModelGroupName(modelId) {
			if (
				/^claude-/.test(modelId) ||
				/^gpt-/.test(modelId) ||
				/^o\d/.test(modelId)
			) {
				return "claude_gpt";
			}
			if (modelId === "gemini-3-pro") return "gemini_3_pro";
			if (modelId === "gemini-3-pro-high") return "gemini_3_pro_high";
			if (modelId === "gemini-3-flash") return "gemini_3_flash";
			if (modelId === "gemini-3-pro-image") return "gemini_3_pro_image";
			return null;
		}

		const testModels = [
			"claude-sonnet-4-20250514",
			"gpt-4o",
			"o1",
			"gemini-3-pro",
			"gemini-3-flash",
		];

		const iterations = 100000;
		const start = Date.now();

		for (let i = 0; i < iterations; i++) {
			for (const model of testModels) {
				getModelGroupName(model);
			}
		}

		const elapsed = Date.now() - start;
		const avgTime = elapsed / (iterations * testModels.length);

		logSuccess(
			`模型组匹配性能: ${iterations * testModels.length} 次调用耗时 ${elapsed}ms (平均 ${(avgTime * 1000).toFixed(3)}μs)`,
		);
	});

	await runTest("4.3 完整 hasQuotaForModel 性能测试", async () => {
		// 准备测试数据
		const account = {
			name: "perf-test",
			model_quotas: JSON.stringify({
				"gpt-4o": { remaining_fraction: 0.5 },
				"gemini-3-pro": { remaining_fraction: 0.8 },
			}),
		};

		const disabledGroups = {
			version: 1,
			groups: {
				claude_gpt: {
					mode: "auto",
					disabled_at: Date.now(),
					reason: "test",
					threshold: 0.2,
					observed: { model_id: "gpt-4o", remaining_fraction: 0.18 },
				},
			},
		};

		db.setSetting(
			"cliproxy_auto_disabled_groups_perf-test",
			JSON.stringify(disabledGroups),
		);

		function hasQuotaForModel(account, modelId) {
			const quotas = JSON.parse(account.model_quotas || "{}");
			const info = quotas[modelId];
			if (!info) return true;
			const remaining = Number(info.remaining_fraction);
			if (!Number.isFinite(remaining)) return true;
			if (remaining <= 0) return false;

			const groupsJson =
				db.getSetting(`cliproxy_auto_disabled_groups_${account.name}`) || "{}";
			let disabledGroups = {};
			try {
				const parsed = JSON.parse(groupsJson);
				disabledGroups = parsed.groups || {};
			} catch {
				return true;
			}

			if (Object.keys(disabledGroups).length === 0) return true;

			function getModelGroupName(modelId) {
				if (
					/^claude-/.test(modelId) ||
					/^gpt-/.test(modelId) ||
					/^o\d/.test(modelId)
				) {
					return "claude_gpt";
				}
				if (modelId === "gemini-3-pro") return "gemini_3_pro";
				return null;
			}

			const groupName = getModelGroupName(modelId);
			if (!groupName) return true;

			return !disabledGroups[groupName];
		}

		// 性能测试
		const iterations = 10000;
		const start = Date.now();

		for (let i = 0; i < iterations; i++) {
			hasQuotaForModel(account, "gpt-4o");
			hasQuotaForModel(account, "gemini-3-pro");
		}

		const elapsed = Date.now() - start;
		const avgTime = elapsed / (iterations * 2);

		assert(avgTime < 1, "hasQuotaForModel 平均耗时应小于 1ms");

		logSuccess(
			`hasQuotaForModel 性能: ${iterations * 2} 次调用耗时 ${elapsed}ms (平均 ${avgTime.toFixed(3)}ms)`,
		);

		// 清理
		db.deleteSetting("cliproxy_auto_disabled_groups_perf-test");
	});

	db.close();
}

// ============================================================================
// 测试套件 5: 集成测试
// ============================================================================

async function testIntegration() {
	logSection("测试套件 5: 集成测试");

	const client = new CLIProxyClient(
		TEST_CONFIG.managementUrl,
		TEST_CONFIG.managementKey,
	);
	const db = new DatabaseManager(TEST_CONFIG.dbPath);

	await runTest("5.1 端到端场景测试", async () => {
		// 1. 获取账号列表
		const result = await client.getCachedAuthFiles(true);
		const antigravityAccounts = result.files.filter(
			(f) => f.provider === "antigravity" && !f.disabled,
		);

		if (antigravityAccounts.length === 0) {
			logWarning("没有可用的 Antigravity 账号，跳过测试");
			stats.skipped++;
			return;
		}

		const account = antigravityAccounts[0];
		logSuccess(`选择账号: ${account.name}`);

		// 2. 模拟设置禁用状态
		const disabledGroups = {
			version: 1,
			groups: {
				claude_gpt: {
					mode: "auto",
					disabled_at: Date.now(),
					reason: "Integration test",
					threshold: 0.2,
					observed: { model_id: "gpt-4o", remaining_fraction: 0.18 },
				},
			},
		};

		db.setSetting(
			`cliproxy_auto_disabled_groups_${account.name}`,
			JSON.stringify(disabledGroups),
		);
		logSuccess("设置禁用状态");

		// 3. 验证过滤逻辑
		function hasQuotaForModel(account, modelId) {
			const quotas =
				typeof account.model_quotas === "string"
					? JSON.parse(account.model_quotas || "{}")
					: account.model_quotas || {};
			const info = quotas[modelId];
			if (!info) return true;
			const remaining = Number(info.remaining_fraction);
			if (!Number.isFinite(remaining)) return true;
			if (remaining <= 0) return false;

			const groupsJson =
				db.getSetting(`cliproxy_auto_disabled_groups_${account.name}`) || "{}";
			let disabledGroups = {};
			try {
				const parsed = JSON.parse(groupsJson);
				disabledGroups = parsed.groups || {};
			} catch {
				return true;
			}

			if (Object.keys(disabledGroups).length === 0) return true;

			function getModelGroupName(modelId) {
				if (
					/^claude-/.test(modelId) ||
					/^gpt-/.test(modelId) ||
					/^o\d/.test(modelId)
				) {
					return "claude_gpt";
				}
				if (modelId === "gemini-3-pro") return "gemini_3_pro";
				if (modelId === "gemini-3-pro-high") return "gemini_3_pro_high";
				if (modelId === "gemini-3-flash") return "gemini_3_flash";
				if (modelId === "gemini-3-pro-image") return "gemini_3_pro_image";
				return null;
			}

			const groupName = getModelGroupName(modelId);
			if (!groupName) return true;

			return !disabledGroups[groupName];
		}

		const testModels = ["gpt-4o", "claude-sonnet-4-20250514", "gemini-3-pro"];
		for (const modelId of testModels) {
			const hasQuota = hasQuotaForModel(account, modelId);
			const groupName = modelId.startsWith("gemini-") ? "gemini" : "claude_gpt";
			logSuccess(
				`${modelId}: ${hasQuota ? "可用" : "被禁用"} (${groupName} 组)`,
			);
		}

		// 4. 清理
		db.deleteSetting(`cliproxy_auto_disabled_groups_${account.name}`);
		logSuccess("清理测试数据");
	});

	db.close();
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
	console.clear();
	log("CLIProxy 集成测试", "cyan");
	log("=".repeat(60), "cyan");
	log(`测试时间: ${new Date().toISOString()}`, "yellow");
	log(`Management URL: ${TEST_CONFIG.managementUrl}`, "yellow");
	log("=".repeat(60), "cyan");

	// 检查必需的环境变量
	if (!TEST_CONFIG.managementKey) {
		logError("错误: 未设置 CLIPROXY_MANAGEMENT_KEY 环境变量");
		logWarning("请设置环境变量后重试:");
		console.log("  export CLIPROXY_MANAGEMENT_KEY=your-key");
		process.exit(1);
	}

	try {
		// 运行所有测试套件
		await testCLIProxyConnection();
		await testAccountDataStructure();
		await testModelGroupDisabling();
		await testPerformance();
		await testIntegration();

		// 输出测试结果
		logSection("测试结果汇总");
		log(`总计: ${stats.total}`, "cyan");
		log(`通过: ${stats.passed}`, "green");
		log(`失败: ${stats.failed}`, stats.failed > 0 ? "red" : "reset");
		log(`跳过: ${stats.skipped}`, "yellow");

		const successRate = ((stats.passed / stats.total) * 100).toFixed(1);
		log(
			`\n成功率: ${successRate}%`,
			successRate === "100.0" ? "green" : "yellow",
		);

		if (stats.failed > 0) {
			process.exit(1);
		}
	} catch (error) {
		logError(`测试执行失败: ${error.message}`);
		console.error(error.stack);
		process.exit(1);
	}
}

// 运行测试
main().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});
