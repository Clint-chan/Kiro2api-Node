import { DatabaseManager } from "../src/database.js";

console.log("=".repeat(60));
console.log("实际环境测试 - 模型组过滤功能");
console.log("=".repeat(60));

const db = new DatabaseManager("./data/kiro2api.db");
db.init();

// 1. 获取活跃账号
console.log("\n✓ 测试 1: 获取活跃账号");
const accounts = db.getAllAntigravityAccounts("active");
console.log(`  找到 ${accounts.length} 个活跃账号`);

if (accounts.length === 0) {
	console.log("\n⚠ 没有活跃账号，无法继续测试");
	process.exit(0);
}

const testAccount = accounts[0];
console.log(`  测试账号: ${testAccount.name}`);

// 2. 检查配额信息
console.log("\n✓ 测试 2: 检查配额信息");
let quotas = {};
try {
	quotas = JSON.parse(testAccount.model_quotas || "{}");
	const modelCount = Object.keys(quotas).length;
	console.log(`  配额模型数: ${modelCount}`);

	if (modelCount > 0) {
		const samples = Object.entries(quotas).slice(0, 3);
		for (const [model, info] of samples) {
			console.log(
				`    ${model}: ${(info.remaining_fraction * 100).toFixed(1)}% 剩余`,
			);
		}
	}
} catch (e) {
	console.log(`  ⚠ 配额解析失败: ${e.message}`);
}

// 3. 检查禁用状态
console.log("\n✓ 测试 3: 检查模型组禁用状态");
const disabledGroupsJson =
	db.getSetting(`cliproxy_auto_disabled_groups_${testAccount.name}`) || "{}";
console.log(`  原始数据: ${disabledGroupsJson}`);

let disabledGroups = {};
try {
	const parsed = JSON.parse(disabledGroupsJson);
	disabledGroups = parsed.groups || {};
	const disabledCount = Object.keys(disabledGroups).length;
	console.log(`  禁用组数: ${disabledCount}`);

	if (disabledCount > 0) {
		for (const [group, info] of Object.entries(disabledGroups)) {
			console.log(`    ${group}: ${info.reason}`);
		}
	} else {
		console.log("    无禁用组");
	}
} catch (e) {
	console.log(`  ⚠ 禁用状态解析失败: ${e.message}`);
}

// 4. 测试过滤逻辑
console.log("\n✓ 测试 4: 测试过滤逻辑");

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

function hasQuotaForModel(account, modelId, disabledGroupsData) {
	const quotas =
		typeof account.model_quotas === "string"
			? JSON.parse(account.model_quotas || "{}")
			: account.model_quotas || {};

	const info = quotas[modelId];
	if (!info) return true;
	const remaining = Number(info.remaining_fraction);
	if (!Number.isFinite(remaining)) return true;
	if (remaining <= 0) return false;

	const groups = disabledGroupsData?.groups || {};
	if (Object.keys(groups).length === 0) return true;

	const groupName = getModelGroupName(modelId);
	if (!groupName) return true;

	return !groups[groupName];
}

const testModels = [
	"gpt-4o",
	"claude-sonnet-4-20250514",
	"gemini-3-pro",
	"gemini-3-flash",
];
const disabledData = { groups: disabledGroups };

for (const model of testModels) {
	const hasQuota = hasQuotaForModel(testAccount, model, disabledData);
	const group = getModelGroupName(model);
	const quotaInfo = quotas[model];
	const remaining = quotaInfo
		? (quotaInfo.remaining_fraction * 100).toFixed(1)
		: "N/A";

	console.log(`  ${model}:`);
	console.log(`    组: ${group || "unknown"}`);
	console.log(`    配额: ${remaining}%`);
	console.log(`    状态: ${hasQuota ? "✓ 可用" : "✗ 被过滤"}`);
}

// 5. 性能测试
console.log("\n✓ 测试 5: 性能测试");
const iterations = 10000;
const start = Date.now();

for (let i = 0; i < iterations; i++) {
	hasQuotaForModel(testAccount, "gpt-4o", disabledData);
}

const elapsed = Date.now() - start;
const avgTime = elapsed / iterations;

console.log(`  ${iterations} 次调用耗时 ${elapsed}ms`);
console.log(`  平均耗时: ${avgTime.toFixed(4)}ms`);
console.log(`  每秒可处理: ${Math.floor(iterations / (elapsed / 1000))} 次`);
console.log(
	`  性能评估: ${avgTime < 0.1 ? "✓ 优秀 (< 0.1ms)" : avgTime < 1 ? "✓ 良好 (< 1ms)" : "⚠ 需优化"}`,
);

console.log("\n" + "=".repeat(60));
console.log("实际环境测试完成！");
console.log("=".repeat(60));
