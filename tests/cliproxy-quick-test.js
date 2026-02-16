import { CLIProxyClient } from "../src/cliproxy-client.js";

const client = new CLIProxyClient(
	process.env.CLIPROXY_MANAGEMENT_URL || "http://localhost:8317",
	process.env.CLIPROXY_MANAGEMENT_KEY,
);

console.log("Testing CLIProxy Management API...\n");

try {
	const result = await client.listAuthFiles();
	console.log("✓ Connection successful");
	console.log(`✓ Found ${result.files.length} accounts\n`);

	const antigravityAccounts = result.files.filter(
		(f) => f.provider === "antigravity",
	);
	console.log(`Antigravity accounts: ${antigravityAccounts.length}`);

	if (antigravityAccounts.length > 0) {
		const account = antigravityAccounts[0];
		console.log("\nSample account structure:");
		console.log(JSON.stringify(account, null, 2));

		if (account.model_quotas) {
			const quotas =
				typeof account.model_quotas === "string"
					? JSON.parse(account.model_quotas)
					: account.model_quotas;
			console.log("\nModel quotas:");
			console.log(JSON.stringify(quotas, null, 2));
		}
	}
} catch (error) {
	console.error("✗ Error:", error.message);
	process.exit(1);
}
