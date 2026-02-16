import { CLIProxyClient } from "../src/cliproxy-client.js";

console.log("=".repeat(60));
console.log("测试阈值检查器 - Antigravity 配额获取");
console.log("=".repeat(60));

const client = new CLIProxyClient("http://80.251.222.107:8317", "zxc123");

console.log("\n✓ 步骤 1: 获取账号列表");
const authFiles = await client.getCachedAuthFiles(true);
const antigravityAccounts = authFiles.files.filter(
	(f) => f.provider === "antigravity",
);
console.log(`  找到 ${antigravityAccounts.length} 个 Antigravity 账号`);

if (antigravityAccounts.length === 0) {
	console.log("  ⚠ 没有 Antigravity 账号");
	process.exit(0);
}

const account = antigravityAccounts[0];
console.log(`  测试账号: ${account.name}`);
console.log(`  auth_index: ${account.auth_index}`);
console.log(`  project_id: ${account.project_id || "N/A"}`);

console.log("\n✓ 步骤 2: 调用 fetchAvailableModels API");
try {
	const result = await client.apiCall(
		account.auth_index,
		"POST",
		"https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
		{
			Authorization: "Bearer $TOKEN$",
			"Content-Type": "application/json",
			"User-Agent": "antigravity/1.11.5 windows/amd64",
		},
		JSON.stringify({ project: account.project_id || "bamboo-precept-lgxtn" }),
	);

	console.log(`  状态码: ${result.status_code || result.statusCode}`);

	const parseJsonSafe = (value) => {
		if (typeof value !== "string") return value;
		try {
			return JSON.parse(value);
		} catch {
			return null;
		}
	};

	const body = parseJsonSafe(result?.body);
	const models = body?.models || {};

	console.log(`  返回模型数: ${Object.keys(models).length}`);

	console.log("\n✓ 步骤 3: 提取配额信息");
	const quota = {};
	for (const [modelId, modelInfo] of Object.entries(models)) {
		if (modelInfo?.quotaInfo) {
			quota[modelId] = {
				remaining_fraction: modelInfo.quotaInfo.remainingFraction,
				reset_time: modelInfo.quotaInfo.resetTime,
			};
		}
	}

	console.log(`  有配额信息的模型数: ${Object.keys(quota).length}`);

	console.log("\n✓ 步骤 4: 检查 Claude/GPT 模型配额");
	const claudeGptModels = Object.entries(quota).filter(
		([modelId]) =>
			/^claude-/.test(modelId) || /^gpt-/.test(modelId) || /^o\d/.test(modelId),
	);

	console.log(`  Claude/GPT 模型数: ${claudeGptModels.length}`);

	for (const [modelId, info] of claudeGptModels.slice(0, 5)) {
		const remaining =
			info.remaining_fraction === null || info.remaining_fraction === undefined
				? 0
				: info.remaining_fraction;
		const percent = (remaining * 100).toFixed(1);
		console.log(
			`    ${modelId}: ${percent}% (原始值: ${info.remaining_fraction})`,
		);
	}

	console.log("\n✓ 步骤 5: 模拟阈值检查");
	const threshold = 0.2;
	console.log(`  阈值: ${(threshold * 100).toFixed(1)}%`);

	let shouldDisable = false;
	let triggerModel = null;

	for (const [modelId, info] of claudeGptModels) {
		const remaining =
			info.remaining_fraction === null || info.remaining_fraction === undefined
				? 0
				: info.remaining_fraction;

		if (remaining < threshold) {
			shouldDisable = true;
			triggerModel = { modelId, remaining };
			break;
		}
	}

	if (shouldDisable) {
		console.log(`  ✅ 应该禁用 claude_gpt 组`);
		console.log(`  触发模型: ${triggerModel.modelId}`);
		console.log(`  配额: ${(triggerModel.remaining * 100).toFixed(1)}%`);
	} else {
		console.log(
			`  ❌ 不应该禁用（所有模型配额 >= ${(threshold * 100).toFixed(1)}%）`,
		);
	}
} catch (error) {
	console.log(`  ✗ 错误: ${error.message}`);
	console.log(`  堆栈: ${error.stack}`);
}

console.log("\n" + "=".repeat(60));
console.log("测试完成");
console.log("=".repeat(60));
