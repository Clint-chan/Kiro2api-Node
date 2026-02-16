// CLIProxyAPI Antigravity Management Functions

let cliproxyAntigravityAccounts = [];
const cliproxyQuotaCache = {};
let isLoadingQuota = false;
let lastCacheUpdate = null;

function escapeInlineJsString(value) {
	return String(value ?? "")
		.replace(/\\/g, "\\\\")
		.replace(/'/g, "\\'")
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r");
}

async function loadCliProxyAccounts() {
	try {
		const result = await fetchApi("/api/admin/cliproxy/auth-files");
		cliproxyAntigravityAccounts = result.files || [];
		lastCacheUpdate = new Date();
		renderCliProxyAccounts();

		await refreshAllQuotas();
	} catch (e) {
		showToast(`加载 CLIProxy 账号失败: ${e.message}`, "error");
	}
}

async function _forceRefreshCliProxyAccounts() {
	try {
		const result = await fetchApi(
			"/api/admin/cliproxy/auth-files?refresh=true",
		);
		cliproxyAntigravityAccounts = result.files || [];
		lastCacheUpdate = new Date();
		renderCliProxyAccounts();

		await refreshAllQuotas();
		showToast("账号列表已刷新", "success");
	} catch (e) {
		showToast(`刷新账号列表失败: ${e.message}`, "error");
	}
}

// Backward compatibility
async function loadCliProxyAgtAccounts() {
	await loadCliProxyAccounts();
}

async function refreshAllQuotas() {
	if (isLoadingQuota) return;

	const agtAccounts = cliproxyAntigravityAccounts.filter(
		(f) => f.provider === "antigravity" && !f.disabled,
	);
	const codexAccounts = cliproxyAntigravityAccounts.filter(
		(f) => f.provider === "codex" && !f.disabled,
	);
	const claudeAccounts = cliproxyAntigravityAccounts.filter(
		(f) => f.provider === "claude" && !f.disabled,
	);

	if (
		agtAccounts.length === 0 &&
		codexAccounts.length === 0 &&
		claudeAccounts.length === 0
	)
		return;

	isLoadingQuota = true;

	[...agtAccounts, ...codexAccounts, ...claudeAccounts].forEach((account) => {
		cliproxyQuotaCache[account.name] = { status: "loading" };
	});
	renderCliProxyAccounts();

	const agtResults = await Promise.all(
		agtAccounts.map(async (account) => {
			const authIndex = account.auth_index || account.authIndex;
			if (!authIndex)
				return {
					name: account.name,
					provider: "antigravity",
					status: "error",
					error: "缺少 auth_index",
				};

			const projectId = "bamboo-precept-lgxtn";
			try {
				const quota = await fetchAgtQuota(authIndex, projectId);
				return {
					name: account.name,
					provider: "antigravity",
					status: "success",
					data: quota,
				};
			} catch (e) {
				return {
					name: account.name,
					provider: "antigravity",
					status: "error",
					error: e.message,
				};
			}
		}),
	);

	const codexResults = await Promise.all(
		codexAccounts.map(async (account) => {
			const authIndex = account.auth_index || account.authIndex;
			if (!authIndex)
				return {
					name: account.name,
					provider: "codex",
					status: "error",
					error: "缺少 auth_index",
				};

			const accountId = account.id_token?.chatgpt_account_id;
			if (!accountId)
				return {
					name: account.name,
					provider: "codex",
					status: "error",
					error: "缺少 chatgpt_account_id",
				};

			try {
				const quota = await fetchCodexQuota(authIndex, accountId);
				return {
					name: account.name,
					provider: "codex",
					status: "success",
					data: quota,
				};
			} catch (e) {
				return {
					name: account.name,
					provider: "codex",
					status: "error",
					error: e.message,
				};
			}
		}),
	);

	const claudeResults = await Promise.all(
		claudeAccounts.map(async (account) => {
			const authIndex = account.auth_index || account.authIndex;
			if (!authIndex)
				return {
					name: account.name,
					provider: "claude",
					status: "error",
					error: "缺少 auth_index",
				};

			try {
				const quota = await fetchClaudeQuota(authIndex);
				return {
					name: account.name,
					provider: "claude",
					status: "success",
					data: quota,
				};
			} catch (e) {
				return {
					name: account.name,
					provider: "claude",
					status: "error",
					error: e.message,
				};
			}
		}),
	);

	[...agtResults, ...codexResults, ...claudeResults].forEach((result) => {
		if (result.status === "success") {
			console.log(
				`[${result.provider === "antigravity" ? "Antigravity" : result.provider === "codex" ? "Codex" : "ClaudeCode"} Quota] Cache update (batch)`,
				{
					account: result.name,
					status: "success",
					dataKeys: Object.keys(result.data || {}).length,
				},
			);
			cliproxyQuotaCache[result.name] = {
				status: "success",
				data: result.data,
				provider: result.provider,
			};
		} else {
			console.log(
				`[${result.provider === "antigravity" ? "Antigravity" : result.provider === "codex" ? "Codex" : "ClaudeCode"} Quota] Cache update (batch)`,
				{
					account: result.name,
					status: "error",
					error: result.error,
				},
			);
			cliproxyQuotaCache[result.name] = {
				status: "error",
				error: result.error,
				provider: result.provider,
			};
		}
	});

	isLoadingQuota = false;
	renderCliProxyAccounts();
}

// Backward compatibility
async function _refreshAllAgtQuotas() {
	await refreshAllQuotas();
}

function renderCliProxyAccounts() {
	const container = document.getElementById(
		"cliproxy-antigravity-accounts-table",
	);
	if (!container) return;

	if (!cliproxyAntigravityAccounts.length) {
		container.innerHTML =
			'<div class="text-center py-10 text-gray-500">暂无 CLIProxy 账号，点击上方按钮上传凭证</div>';
		return;
	}

	const allAccounts = cliproxyAntigravityAccounts;

	const cacheStatus = lastCacheUpdate
		? `<div class="text-xs text-gray-500 mb-4">缓存更新时间: ${lastCacheUpdate.toLocaleString("zh-CN")}</div>`
		: "";

	container.innerHTML = `
        ${cacheStatus}
        <table class="w-full">
            <thead>
                <tr class="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th class="px-4 py-3 text-left rounded-tl-lg" style="width: 30%">账号信息</th>
                    <th class="px-4 py-3 text-center" style="width: 35%">额度使用</th>
                    <th class="px-4 py-3 text-center" style="width: 15%">状态</th>
                    <th class="px-4 py-3 text-center rounded-tr-lg" style="width: 20%">操作</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
                ${allAccounts
									.map(
										(a, i) => `
                    <tr class="hover:bg-gray-50 transition ${i % 2 === 1 ? "bg-gray-50/50" : ""}">
                        <td class="px-4 py-4 align-middle">
                            <div class="flex flex-col gap-1">
                                <div class="font-semibold text-gray-900 text-sm">
                                    ${a.email || a.id}
                                </div>
                                <div class="flex items-center gap-2 flex-wrap">
                                    <span class="px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${a.provider === "codex" ? "bg-blue-100 text-blue-700" : a.provider === "claude" ? "bg-indigo-100 text-indigo-700" : "bg-purple-100 text-purple-700"}">
                                        ${a.provider === "codex" ? "Codex" : a.provider === "claude" ? "ClaudeCode" : "Antigravity"}
                                    </span>
                                    ${a.provider === "codex" && a.plan_type ? `<span class="px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap bg-green-100 text-green-700">${a.plan_type}</span>` : ""}
                                    <span class="px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap bg-amber-100 text-amber-700" id="threshold-badge-${a.name}">
                                        <span class="threshold-loading">检查中...</span>
                                    </span>
                                </div>
                            </div>
                        </td>
                        <td class="px-4 py-4 align-middle">
                            <div class="w-full">${a.provider === "codex" ? formatCodexQuota(a) : a.provider === "claude" ? formatClaudeQuota(a) : formatAgtQuota(a)}</div>
                        </td>
                        <td class="px-4 py-4 align-middle">
                            <div class="flex justify-center whitespace-nowrap">${formatCliProxyStatus(a)}</div>
                        </td>
                        <td class="px-4 py-4 align-middle">
                            <div class="flex items-center justify-center gap-1">
                                <button onclick="refreshSingleQuota(${JSON.stringify(a).replace(/"/g, "&quot;")})" class="p-1 text-blue-600 hover:bg-blue-50 rounded transition" title="刷新额度">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                                </button>
								<button onclick="viewModels('${escapeInlineJsString(a.name)}')" class="p-1 text-purple-600 hover:bg-purple-50 rounded transition" title="查看模型">
									<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>
								</button>
								<button onclick="showThresholdConfig(${JSON.stringify(a).replace(/"/g, "&quot;")})" class="p-1 text-indigo-600 hover:bg-indigo-50 rounded transition" title="设置阈值">
									<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
								</button>
                                ${
																	a.disabled
																		? `<button onclick="toggleCliProxyAccount('${a.name}', false)" class="p-1 text-green-600 hover:bg-green-50 rounded transition" title="启用">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                                    </button>`
																		: `<button onclick="toggleCliProxyAccount('${a.name}', true)" class="p-1 text-orange-600 hover:bg-orange-50 rounded transition" title="禁用">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg>
                                    </button>`
																}
                                <button onclick="deleteCliProxyAccount('${a.name}')" class="p-1 text-red-600 hover:bg-red-50 rounded transition" title="删除">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                </button>
                            </div>
                        </td>
                    </tr>
                `,
									)
									.join("")}
            </tbody>
        </table>`;

	allAccounts.forEach((account) => {
		loadThresholdBadge(account.name);
	});
}

async function loadThresholdBadge(accountName) {
	try {
		const response = await fetchApi(
			`/api/admin/cliproxy/threshold-config?name=${encodeURIComponent(accountName)}`,
		);
		const config = response.config || {};
		const badge = document.getElementById(`threshold-badge-${accountName}`);

		if (!badge) return;

		const thresholdLabels = {
			five_hour: "5小时",
			seven_day: "7天",
			seven_day_sonnet: "7天Sonnet",
			weekly: "每周",
			code_review: "代码审查",
			claude_gpt: "Claude/GPT",
			gemini: "Gemini",
		};

		const activeThresholds = Object.entries(config)
			.map(([key, value]) => ({
				key,
				label: thresholdLabels[key] || key,
				value: Number(value),
			}))
			.filter((t) => Number.isFinite(t.value) && t.value > 0);

		if (activeThresholds.length === 0) {
			badge.innerHTML = "未设置";
			badge.className =
				"px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap bg-gray-100 text-gray-600";
			badge.title = "点击设置阈值";
		} else {
			const thresholds = activeThresholds.map((t) => ({
				...t,
				value: Math.round(t.value * 100),
			}));

			const minThreshold = Math.min(...thresholds.map((t) => t.value));
			const tooltipLines = thresholds
				.map((t) => `${t.label}: ${t.value}%`)
				.join("\n");

			badge.innerHTML = `阈值 ${minThreshold}%`;
			badge.className =
				"px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap bg-green-100 text-green-700 cursor-help";
			badge.title = tooltipLines;
		}
	} catch (e) {
		const badge = document.getElementById(`threshold-badge-${accountName}`);
		if (badge) {
			badge.innerHTML = "加载失败";
			badge.className =
				"px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap bg-red-100 text-red-600";
			badge.title = e.message;
		}
	}
}

// Backward compatibility
function _renderCliProxyAgtAccounts() {
	renderCliProxyAccounts();
}

async function _viewModels(name) {
	try {
		const modal = document.createElement("div");
		modal.id = "modelsModal";
		modal.className =
			"fixed inset-0 bg-black/50 flex items-center justify-center z-50";
		modal.innerHTML = `
            <div class="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 animate-scaleIn flex flex-col max-h-[80vh]">
                <div class="flex items-center justify-between p-6 border-b border-gray-100">
                    <h3 class="text-lg font-semibold text-gray-900">模型列表 (${name})</h3>
                    <button onclick="document.getElementById('modelsModal').remove()" class="text-gray-400 hover:text-gray-600">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div class="p-6 overflow-y-auto flex-1">
                    <div id="models-list-loading" class="flex justify-center py-8">
                        <div class="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                    <div id="models-list-content" class="hidden space-y-2"></div>
                </div>
            </div>
        `;
		document.body.appendChild(modal);

		const result = await fetchApi(
			`/api/admin/cliproxy/auth-files/models?name=${encodeURIComponent(name)}`,
		);
		const models = result.models || [];

		const content = document.getElementById("models-list-content");
		const loading = document.getElementById("models-list-loading");

		loading.classList.add("hidden");
		content.classList.remove("hidden");

		if (models.length === 0) {
			content.innerHTML =
				'<div class="text-center text-gray-500 py-8">未找到可用模型</div>';
			return;
		}

		content.innerHTML = models
			.map((m) => {
				const safeModelId = escapeInlineJsString(m.id);
				return `
            <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition group">
                <div class="flex flex-col">
                    <span class="font-medium text-gray-900">${m.display_name || m.id}</span>
                    <span class="text-xs text-gray-500 font-mono">${m.id}</span>
                </div>
                <div class="flex items-center gap-3">
                    <span class="text-xs px-2 py-1 bg-gray-200 rounded-full text-gray-600">${m.type || "unknown"}</span>
                    <button onclick="copyToClipboard('${safeModelId}', '模型ID已复制')" class="text-blue-600 hover:text-blue-800 text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                        复制ID
                    </button>
                </div>
            </div>
			`;
			})
			.join("");
	} catch (e) {
		showToast(`获取模型列表失败: ${e.message}`, "error");
		const loading = document.getElementById("models-list-loading");
		if (loading) {
			loading.innerHTML = `<div class="text-red-500 text-center">加载失败: ${escapeHtml(e.message)}</div>`;
		}
	}
}

function formatCliProxyStatus(account) {
	if (account.disabled) {
		return '<span class="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">已禁用</span>';
	}

	const cache = cliproxyQuotaCache[account.name];
	if (cache) {
		if (cache.status === "loading") {
			return '<span class="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">检测中</span>';
		}
		if (cache.status === "success") {
			return '<span class="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">正常</span>';
		}
		if (cache.status === "error") {
			return '<span class="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">错误</span>';
		}
	}

	if (account.status === "active") {
		return '<span class="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">正常</span>';
	}
	if (account.status === "error") {
		return '<span class="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">待检测</span>';
	}
	return '<span class="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">未知</span>';
}

function _formatDateTime(dateStr) {
	if (!dateStr) return "-";
	const date = new Date(dateStr);
	return date.toLocaleString("zh-CN", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

async function toggleCliProxyAccount(name, disabled) {
	try {
		await fetchApi("/api/admin/cliproxy/auth-files/status", {
			method: "PATCH",
			body: JSON.stringify({ name, disabled }),
		});
		showToast(
			disabled ? "CLIProxy 账号已禁用" : "CLIProxy 账号已启用",
			disabled ? "warning" : "success",
		);
		await loadCliProxyAccounts();
	} catch (e) {
		showToast(`${disabled ? "禁用" : "启用"}失败: ${e.message}`, "error");
	}
}

// Backward compatibility
async function _toggleCliProxyAgtAccount(name, disabled) {
	await toggleCliProxyAccount(name, disabled);
}

async function deleteCliProxyAccount(name) {
	if (!confirm(`确定删除 CLIProxy 账号 ${name}？`)) return;
	try {
		await fetchApi(
			`/api/admin/cliproxy/auth-files?name=${encodeURIComponent(name)}`,
			{ method: "DELETE" },
		);
		showToast("CLIProxy 账号已删除", "success");
		await loadCliProxyAccounts();
	} catch (e) {
		showToast(`删除失败: ${e.message}`, "error");
	}
}

async function _showThresholdConfig(account) {
	try {
		const response = await fetchApi(
			`/api/admin/cliproxy/threshold-config?name=${encodeURIComponent(account.name)}`,
		);
		const config = response.config || {};

		const toInputPercent = (value) => {
			const num = Number(value);
			return Number.isFinite(num) && num > 0 ? Math.round(num * 100) : "";
		};

		const modal = document.createElement("div");
		modal.id = "thresholdModal";
		modal.className =
			"fixed inset-0 bg-black/50 flex items-center justify-center z-50";

		let configHtml = "";

		if (account.provider === "claude") {
			configHtml = `
				<div class="space-y-4">
					<div class="text-sm text-gray-600 mb-4">当任一限额低于设定阈值时，自动禁用该账号</div>
					<div>
						<label class="block text-sm font-medium text-gray-700 mb-2">5 小时限额阈值 (%)</label>
						<input type="number" id="threshold-five-hour" min="0" max="100" value="${toInputPercent(config.five_hour)}"
							placeholder="留空或0表示不限制"
							class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
					</div>
					<div>
						<label class="block text-sm font-medium text-gray-700 mb-2">7 天限额阈值 (%)</label>
						<input type="number" id="threshold-seven-day" min="0" max="100" value="${toInputPercent(config.seven_day)}"
							placeholder="留空或0表示不限制"
							class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
					</div>
					<div>
						<label class="block text-sm font-medium text-gray-700 mb-2">7 天 Sonnet 限额阈值 (%)</label>
						<input type="number" id="threshold-seven-day-sonnet" min="0" max="100" value="${toInputPercent(config.seven_day_sonnet)}"
							placeholder="留空或0表示不限制"
							class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
					</div>
				</div>
			`;
		} else if (account.provider === "codex") {
			configHtml = `
				<div class="space-y-4">
					<div class="text-sm text-gray-600 mb-4">当任一限额低于设定阈值时，自动禁用该账号</div>
					<div>
						<label class="block text-sm font-medium text-gray-700 mb-2">5 小时限额阈值 (%)</label>
						<input type="number" id="threshold-five-hour" min="0" max="100" value="${toInputPercent(config.five_hour)}"
							placeholder="留空或0表示不限制"
							class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
					</div>
					<div>
						<label class="block text-sm font-medium text-gray-700 mb-2">周限额阈值 (%)</label>
						<input type="number" id="threshold-weekly" min="0" max="100" value="${toInputPercent(config.weekly)}"
							placeholder="留空或0表示不限制"
							class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
					</div>
					<div>
						<label class="block text-sm font-medium text-gray-700 mb-2">代码审查周限额阈值 (%)</label>
						<input type="number" id="threshold-code-review" min="0" max="100" value="${toInputPercent(config.code_review)}"
							placeholder="留空或0表示不限制"
							class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
					</div>
				</div>
			`;
		} else {
			configHtml = `
				<div class="space-y-4">
					<div class="text-sm text-gray-600 mb-4">分模型组设置阈值，当模型组内任一模型低于阈值时，禁用该组</div>
					<div class="border border-gray-200 rounded-lg p-4">
						<h4 class="font-medium text-gray-900 mb-3">Claude/GPT 模型组</h4>
						<label class="block text-sm font-medium text-gray-700 mb-2">最低阈值 (%)</label>
						<input type="number" id="threshold-claude-gpt" min="0" max="100" value="${toInputPercent(config.claude_gpt)}"
							placeholder="留空或0表示不限制"
							class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
						<div class="text-xs text-gray-500 mt-2">包含: claude-sonnet-4-5, claude-opus-4-6 等</div>
					</div>
					<div class="border border-gray-200 rounded-lg p-4">
						<h4 class="font-medium text-gray-900 mb-3">Gemini 模型组</h4>
						<label class="block text-sm font-medium text-gray-700 mb-2">最低阈值 (%)</label>
						<input type="number" id="threshold-gemini" min="0" max="100" value="${toInputPercent(config.gemini)}"
							placeholder="留空或0表示不限制"
							class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
						<div class="text-xs text-gray-500 mt-2">包含: gemini-3-pro-high, gemini-3-flash 等</div>
					</div>
				</div>
			`;
		}

		modal.innerHTML = `
			<div class="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 animate-scaleIn">
				<div class="flex items-center justify-between p-6 border-b border-gray-100">
					<h3 class="text-lg font-semibold text-gray-900">设置阈值 - ${account.email || account.name}</h3>
					<button onclick="document.getElementById('thresholdModal').remove()" 
						class="text-gray-400 hover:text-gray-600">
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
				<div class="p-6">
					${configHtml}
				</div>
				<div class="flex justify-end gap-3 p-6 border-t border-gray-100">
					<button onclick="document.getElementById('thresholdModal').remove()" 
						class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">
						取消
					</button>
					<button onclick="saveThresholdConfig('${account.name}', '${account.provider}')" 
						class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition">
						保存
					</button>
				</div>
			</div>
		`;

		document.body.appendChild(modal);
	} catch (e) {
		showToast(`加载阈值配置失败: ${e.message}`, "error");
	}
}

async function _saveThresholdConfig(accountName, provider) {
	try {
		const parseThreshold = (raw) => {
			const text = String(raw ?? "").trim();
			if (text === "") return null;

			const num = Number(text);
			if (!Number.isFinite(num)) return null;

			const clamped = Math.max(0, Math.min(100, num));
			if (clamped <= 0) return null;

			return clamped / 100;
		};

		const compactConfig = (obj) =>
			Object.fromEntries(
				Object.entries(obj).filter(([, value]) => value !== null),
			);

		let config = {};

		if (provider === "claude") {
			const fiveHourValue = document.getElementById(
				"threshold-five-hour",
			).value;
			const sevenDayValue = document.getElementById(
				"threshold-seven-day",
			).value;
			const sevenDaySonnetValue = document.getElementById(
				"threshold-seven-day-sonnet",
			).value;

			config = compactConfig({
				five_hour: parseThreshold(fiveHourValue),
				seven_day: parseThreshold(sevenDayValue),
				seven_day_sonnet: parseThreshold(sevenDaySonnetValue),
			});
		} else if (provider === "codex") {
			const fiveHourValue = document.getElementById(
				"threshold-five-hour",
			).value;
			const weeklyValue = document.getElementById("threshold-weekly").value;
			const codeReviewValue = document.getElementById(
				"threshold-code-review",
			).value;

			config = compactConfig({
				five_hour: parseThreshold(fiveHourValue),
				weekly: parseThreshold(weeklyValue),
				code_review: parseThreshold(codeReviewValue),
			});
		} else {
			const claudeGptValue = document.getElementById(
				"threshold-claude-gpt",
			).value;
			const geminiValue = document.getElementById("threshold-gemini").value;

			config = compactConfig({
				claude_gpt: parseThreshold(claudeGptValue),
				gemini: parseThreshold(geminiValue),
			});
		}

		await fetchApi("/api/admin/cliproxy/threshold-config", {
			method: "POST",
			body: JSON.stringify({ name: accountName, config }),
		});

		document.getElementById("thresholdModal").remove();
		showToast("阈值配置保存成功", "success");

		await loadThresholdBadge(accountName);
	} catch (e) {
		showToast(`保存阈值配置失败: ${e.message}`, "error");
	}
}

// Backward compatibility
async function _deleteCliProxyAgtAccount(name) {
	await deleteCliProxyAccount(name);
}

async function refreshSingleQuota(account) {
	const authIndex = account.auth_index || account.authIndex;
	if (!authIndex) return;

	cliproxyQuotaCache[account.name] = { status: "loading" };
	renderCliProxyAccounts();

	try {
		if (account.provider === "codex") {
			const accountId = account.id_token?.chatgpt_account_id;
			const quota = await fetchCodexQuota(authIndex, accountId);
			console.log("[Codex Quota] Cache update (single)", {
				account: account.name,
				status: "success",
			});
			cliproxyQuotaCache[account.name] = {
				status: "success",
				data: quota,
				provider: "codex",
			};
		} else if (account.provider === "claude") {
			const quota = await fetchClaudeQuota(authIndex);
			console.log("[ClaudeCode Quota] Cache update (single)", {
				account: account.name,
				status: "success",
			});
			cliproxyQuotaCache[account.name] = {
				status: "success",
				data: quota,
				provider: "claude",
			};
		} else {
			const projectId = "bamboo-precept-lgxtn";
			const quota = await fetchAgtQuota(authIndex, projectId);
			console.log("[Antigravity Quota] Cache update (single)", {
				account: account.name,
				status: "success",
				modelCount: Object.keys(quota || {}).length,
			});
			cliproxyQuotaCache[account.name] = {
				status: "success",
				data: quota,
				provider: "antigravity",
			};
		}
	} catch (e) {
		console.log(
			`[${account.provider === "codex" ? "Codex" : account.provider === "claude" ? "ClaudeCode" : "Antigravity"} Quota] Cache update (single)`,
			{
				account: account.name,
				status: "error",
				error: e.message,
			},
		);
		cliproxyQuotaCache[account.name] = {
			status: "error",
			error: e.message,
			provider: account.provider,
		};
	}
	renderCliProxyAccounts();
}

// Backward compatibility
async function _refreshSingleAgtQuota(account) {
	await refreshSingleQuota(account);
}

async function fetchAgtQuota(authIndex, projectId) {
	console.log("[Antigravity Quota] Start fetch quota", {
		authIndex,
		projectId,
	});

	const result = await fetchApi("/api/admin/cliproxy/api-call", {
		method: "POST",
		body: JSON.stringify({
			authIndex,
			method: "POST",
			url: "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
			header: {
				Authorization: "Bearer $TOKEN$",
				"Content-Type": "application/json",
				"User-Agent": "antigravity/1.11.5 windows/amd64",
			},
			data: JSON.stringify({ project: projectId }),
		}),
	});

	console.log("[Antigravity Quota] Raw API call result", {
		statusCode: result?.status_code || result?.statusCode,
		bodyType: typeof result?.body,
	});

	const parseJsonSafe = (value, label) => {
		if (typeof value !== "string") return value;
		try {
			return JSON.parse(value);
		} catch (error) {
			console.log("[Antigravity Quota] JSON parse failed", {
				label,
				error: error.message,
				valueSnippet: value.slice(0, 240),
			});
			throw new Error(`解析额度数据失败: ${label}`);
		}
	};

	const normalizeModels = (models) => {
		if (!models) return {};
		if (Array.isArray(models)) {
			return models.reduce((acc, item, index) => {
				const key =
					item?.modelId ||
					item?.model_id ||
					item?.displayName ||
					item?.display_name ||
					`model_${index}`;
				acc[key] = item;
				return acc;
			}, {});
		}
		if (typeof models === "object") {
			return models;
		}
		return {};
	};

	const extractModelsFromPayload = (payload) => {
		const parsedPayload = parseJsonSafe(payload, "outer-body");
		if (!parsedPayload || typeof parsedPayload !== "object") {
			return {};
		}

		const nestedCandidates = [
			parsedPayload,
			parsedPayload.body,
			parsedPayload.data,
			parsedPayload.response,
			parsedPayload.body?.body,
		];

		for (const candidate of nestedCandidates) {
			const parsedCandidate = parseJsonSafe(candidate, "nested-body");
			if (!parsedCandidate || typeof parsedCandidate !== "object") continue;

			const normalizedModels = normalizeModels(parsedCandidate.models);
			if (Object.keys(normalizedModels).length > 0) {
				return normalizedModels;
			}
		}

		return {};
	};

	if (
		(result.status_code || result.statusCode) >= 200 &&
		(result.status_code || result.statusCode) < 300
	) {
		const models = extractModelsFromPayload(result.body);
		console.log("[Antigravity Quota] Parsed models", {
			authIndex,
			modelCount: Object.keys(models).length,
			modelKeys: Object.keys(models).slice(0, 10),
		});
		return models;
	}

	console.log("[Antigravity Quota] API call failed", {
		authIndex,
		projectId,
		statusCode: result?.status_code || result?.statusCode,
		body: result?.body,
	});
	throw new Error(`HTTP ${result.status_code || result.statusCode}`);
}

async function fetchCodexQuota(authIndex, accountId) {
	if (!accountId) {
		throw new Error("accountId is required for Codex quota fetch");
	}

	console.log("[Codex Quota] Start fetch quota", { authIndex, accountId });

	const result = await fetchApi("/api/admin/cliproxy/api-call", {
		method: "POST",
		body: JSON.stringify({
			authIndex,
			method: "GET",
			url: "https://chatgpt.com/backend-api/wham/usage",
			header: {
				Authorization: "Bearer $TOKEN$",
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
				"Chatgpt-Account-Id": accountId,
			},
		}),
	});

	console.log("[Codex Quota] Raw API call result", {
		statusCode: result?.status_code || result?.statusCode,
		bodyType: typeof result?.body,
	});

	const parseJsonSafe = (value, label) => {
		if (typeof value !== "string") return value;
		try {
			return JSON.parse(value);
		} catch (error) {
			console.log("[Codex Quota] JSON parse failed", {
				label,
				error: error.message,
				valueSnippet: value.slice(0, 240),
			});
			throw new Error(`解析配额数据失败: ${label}`);
		}
	};

	if (
		(result.status_code || result.statusCode) >= 200 &&
		(result.status_code || result.statusCode) < 300
	) {
		const parsedBody = parseJsonSafe(result.body, "response-body");
		const quotaData = parsedBody?.body || parsedBody;

		console.log("[Codex Quota] Parsed quota data", {
			authIndex,
			email: quotaData?.email,
			planType: quotaData?.plan_type,
			primaryWindow: quotaData?.rate_limit?.primary_window,
			secondaryWindow: quotaData?.rate_limit?.secondary_window,
			codeReviewWindow: quotaData?.code_review_rate_limit?.primary_window,
		});

		return quotaData;
	}

	console.log("[Codex Quota] API call failed", {
		authIndex,
		statusCode: result?.status_code || result?.statusCode,
		body: result?.body,
	});
	throw new Error(`HTTP ${result.status_code || result.statusCode}`);
}

async function fetchClaudeQuota(authIndex) {
	console.log("[ClaudeCode Quota] Start fetch quota", { authIndex });

	const result = await fetchApi("/api/admin/cliproxy/api-call", {
		method: "POST",
		body: JSON.stringify({
			authIndex,
			method: "GET",
			url: "https://api.anthropic.com/api/oauth/usage",
			header: {
				Authorization: "Bearer $TOKEN$",
				"Content-Type": "application/json",
				"anthropic-beta": "oauth-2025-04-20",
			},
		}),
	});

	console.log("[ClaudeCode Quota] Raw API call result", {
		statusCode: result?.status_code || result?.statusCode,
		bodyType: typeof result?.body,
	});

	const parseJsonSafe = (value, label) => {
		if (typeof value !== "string") return value;
		try {
			return JSON.parse(value);
		} catch (error) {
			console.log("[ClaudeCode Quota] JSON parse failed", {
				label,
				error: error.message,
				valueSnippet: value.slice(0, 240),
			});
			throw new Error(`解析配额数据失败: ${label}`);
		}
	};

	if (
		(result.status_code || result.statusCode) >= 200 &&
		(result.status_code || result.statusCode) < 300
	) {
		const parsedBody = parseJsonSafe(result.body, "response-body");

		console.log("[ClaudeCode Quota] Parsed quota data", {
			authIndex,
			fiveHour: parsedBody?.five_hour,
			sevenDay: parsedBody?.seven_day,
			sevenDaySonnet: parsedBody?.seven_day_sonnet,
		});

		return parsedBody;
	}

	console.log("[ClaudeCode Quota] API call failed", {
		authIndex,
		statusCode: result?.status_code || result?.statusCode,
		body: result?.body,
	});
	throw new Error(`HTTP ${result.status_code || result.statusCode}`);
}

function formatCodexQuota(account) {
	const cache = cliproxyQuotaCache[account.name];

	if (!cache) {
		return '<span class="text-xs text-gray-400">-</span>';
	}

	if (cache.status === "loading") {
		return '<span class="text-xs text-blue-600">加载中...</span>';
	}

	if (cache.status === "error") {
		return `<span class="text-xs text-red-600" title="${cache.error || "加载失败"}">加载失败</span>`;
	}

	const data = cache.data;
	if (!data) {
		return '<span class="text-xs text-gray-400">无数据</span>';
	}

	const formatResetTime = (timestamp) => {
		if (!timestamp) return "";
		const date = new Date(timestamp * 1000);
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		const hour = String(date.getHours()).padStart(2, "0");
		const minute = String(date.getMinutes()).padStart(2, "0");
		return `${month}/${day} ${hour}:${minute}`;
	};

	const _planTypeMap = {
		team: "Team",
		plus: "Plus",
		free: "Free",
		pro: "Pro",
	};

	const items = [];

	if (data.rate_limit?.primary_window) {
		const usedPercent = data.rate_limit.primary_window.used_percent || 0;
		const remainingPercent = 100 - usedPercent;
		const resetTime = formatResetTime(data.rate_limit.primary_window.reset_at);
		const bgColor =
			remainingPercent > 60
				? "bg-green-500"
				: remainingPercent > 20
					? "bg-yellow-500"
					: "bg-red-500";

		items.push(`
<div class="mb-3">
    <div class="flex justify-between items-center mb-1">
        <span class="text-sm font-medium text-gray-700">5 小时限额</span>
        <span class="text-xs text-gray-500">${remainingPercent}%${resetTime ? ` · ${resetTime}` : ""}</span>
    </div>
    <div class="w-full bg-gray-200 rounded-full h-2">
        <div class="${bgColor} h-2 rounded-full transition-all" style="width: ${remainingPercent}%"></div>
    </div>
</div>
`);
	}

	if (data.rate_limit?.secondary_window) {
		const usedPercent = data.rate_limit.secondary_window.used_percent || 0;
		const remainingPercent = 100 - usedPercent;
		const resetTime = formatResetTime(
			data.rate_limit.secondary_window.reset_at,
		);
		const bgColor =
			remainingPercent > 60
				? "bg-green-500"
				: remainingPercent > 20
					? "bg-yellow-500"
					: "bg-red-500";

		items.push(`
<div class="mb-3">
    <div class="flex justify-between items-center mb-1">
        <span class="text-sm font-medium text-gray-700">周限额</span>
        <span class="text-xs text-gray-500">${remainingPercent}%${resetTime ? ` · ${resetTime}` : ""}</span>
    </div>
    <div class="w-full bg-gray-200 rounded-full h-2">
        <div class="${bgColor} h-2 rounded-full transition-all" style="width: ${remainingPercent}%"></div>
    </div>
</div>
`);
	}

	if (data.code_review_rate_limit?.primary_window) {
		const usedPercent =
			data.code_review_rate_limit.primary_window.used_percent || 0;
		const remainingPercent = 100 - usedPercent;
		const resetTime = formatResetTime(
			data.code_review_rate_limit.primary_window.reset_at,
		);
		const bgColor =
			remainingPercent > 60
				? "bg-green-500"
				: remainingPercent > 20
					? "bg-yellow-500"
					: "bg-red-500";

		items.push(`
<div class="mb-3 last:mb-0">
    <div class="flex justify-between items-center mb-1">
        <span class="text-sm font-medium text-gray-700">代码审查周限额</span>
        <span class="text-xs text-gray-500">${remainingPercent}%${resetTime ? ` · ${resetTime}` : ""}</span>
    </div>
    <div class="w-full bg-gray-200 rounded-full h-2">
        <div class="${bgColor} h-2 rounded-full transition-all" style="width: ${remainingPercent}%"></div>
    </div>
</div>
`);
	}

	return items.join("");
}

function _loadAgtAccounts() {
	loadCliProxyAgtAccounts();
}

function formatClaudeQuota(account) {
	const cache = cliproxyQuotaCache[account.name];

	if (!cache) {
		return '<span class="text-xs text-gray-400">-</span>';
	}

	if (cache.status === "loading") {
		return '<span class="text-xs text-blue-600">加载中...</span>';
	}

	if (cache.status === "error") {
		return `<span class="text-xs text-red-600" title="${cache.error || "加载失败"}">加载失败</span>`;
	}

	const data = cache.data;
	if (!data) {
		return '<span class="text-xs text-gray-400">无数据</span>';
	}

	const formatResetTime = (isoString) => {
		if (!isoString) return "";
		const date = new Date(isoString);
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		const hour = String(date.getHours()).padStart(2, "0");
		const minute = String(date.getMinutes()).padStart(2, "0");
		return `${month}/${day} ${hour}:${minute}`;
	};

	const items = [];

	if (data.five_hour) {
		const utilization = data.five_hour.utilization || 0;
		const remainingPercent = 100 - utilization;
		const resetTime = formatResetTime(data.five_hour.resets_at);
		const bgColor =
			remainingPercent > 60
				? "bg-green-500"
				: remainingPercent > 20
					? "bg-yellow-500"
					: "bg-red-500";

		items.push(`
<div class="mb-3">
    <div class="flex justify-between items-center mb-1">
        <span class="text-sm font-medium text-gray-700">5 小时限额</span>
        <span class="text-xs text-gray-500">${remainingPercent.toFixed(0)}%${resetTime ? ` · ${resetTime}` : ""}</span>
    </div>
    <div class="w-full bg-gray-200 rounded-full h-2">
        <div class="${bgColor} h-2 rounded-full transition-all" style="width: ${remainingPercent}%"></div>
    </div>
</div>
`);
	}

	if (data.seven_day) {
		const utilization = data.seven_day.utilization || 0;
		const remainingPercent = 100 - utilization;
		const resetTime = formatResetTime(data.seven_day.resets_at);
		const bgColor =
			remainingPercent > 60
				? "bg-green-500"
				: remainingPercent > 20
					? "bg-yellow-500"
					: "bg-red-500";

		items.push(`
<div class="mb-3">
    <div class="flex justify-between items-center mb-1">
        <span class="text-sm font-medium text-gray-700">7 天限额</span>
        <span class="text-xs text-gray-500">${remainingPercent.toFixed(0)}%${resetTime ? ` · ${resetTime}` : ""}</span>
    </div>
    <div class="w-full bg-gray-200 rounded-full h-2">
        <div class="${bgColor} h-2 rounded-full transition-all" style="width: ${remainingPercent}%"></div>
    </div>
</div>
`);
	}

	if (data.seven_day_sonnet) {
		const utilization = data.seven_day_sonnet.utilization || 0;
		const remainingPercent = 100 - utilization;
		const resetTime = formatResetTime(data.seven_day_sonnet.resets_at);
		const bgColor =
			remainingPercent > 60
				? "bg-green-500"
				: remainingPercent > 20
					? "bg-yellow-500"
					: "bg-red-500";

		items.push(`
<div class="mb-3">
    <div class="flex justify-between items-center mb-1">
        <span class="text-sm font-medium text-gray-700">7 天 Sonnet</span>
        <span class="text-xs text-gray-500">${remainingPercent.toFixed(0)}%${resetTime ? ` · ${resetTime}` : ""}</span>
    </div>
    <div class="w-full bg-gray-200 rounded-full h-2">
        <div class="${bgColor} h-2 rounded-full transition-all" style="width: ${remainingPercent}%"></div>
    </div>
</div>
`);
	}

	if (items.length === 0) {
		return '<span class="text-xs text-gray-400">无配额数据</span>';
	}

	return items.join("");
}

function formatAgtQuota(account) {
	const cache = cliproxyQuotaCache[account.name];

	if (!cache) {
		return '<span class="text-xs text-gray-400">-</span>';
	}

	if (cache.status === "loading") {
		return '<span class="text-xs text-blue-600">加载中...</span>';
	}

	if (cache.status === "error") {
		return `<span class="text-xs text-red-600" title="${cache.error || "加载失败"}">加载失败</span>`;
	}

	const models = Object.entries(cache.data || {});
	if (models.length === 0) {
		return '<span class="text-xs text-gray-400">无数据</span>';
	}

	const formatResetTime = (resetTime) => {
		if (!resetTime) return "";
		const date = new Date(resetTime);
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		const hour = String(date.getHours()).padStart(2, "0");
		const minute = String(date.getMinutes()).padStart(2, "0");
		return `${month}/${day} ${hour}:${minute}`;
	};

	// Priority models list - only display these important models
	const priorityModels = [
		"claude-sonnet-4-5",
		"claude-opus-4",
		"claude-haiku-4",
		"gpt-4",
		"gpt-4-turbo",
		"gpt-3.5-turbo",
		"gemini-3-pro",
		"gemini-2.5-pro",
		"gemini-2.5-flash",
		"gemini-2.5-flash-lite",
		"gemini-3-flash",
		"gemini-3-pro-image",
	];

	// Filter to only priority models and sort by priority order
	const filteredModels = models.filter(([name]) =>
		priorityModels.includes(name),
	);
	const sortedModels = filteredModels.sort(([keyA], [keyB]) => {
		const indexA = priorityModels.indexOf(keyA);
		const indexB = priorityModels.indexOf(keyB);
		return indexA - indexB;
	});

	// Group models: Claude/GPT together, Gemini separate
	const groupedModels = [];
	let claudeGptGroup = null;

	for (const [name, info] of sortedModels) {
		if (name.startsWith("claude-") || name.startsWith("gpt-")) {
			// Add to Claude/GPT group (use first one's data)
			if (!claudeGptGroup) {
				claudeGptGroup = {
					displayName: "Claude/GPT",
					info: info,
				};
			}
		} else if (name.startsWith("gemini-")) {
			// Gemini models stay separate
			if (claudeGptGroup) {
				groupedModels.push(claudeGptGroup);
				claudeGptGroup = null;
			}
			groupedModels.push({
				displayName:
					info?.displayName ||
					info?.display_name ||
					info?.modelId ||
					info?.model_id ||
					name,
				info: info,
			});
		}
	}

	// Add remaining Claude/GPT group if exists
	if (claudeGptGroup) {
		groupedModels.push(claudeGptGroup);
	}

	const items = groupedModels
		.map(({ displayName, info }) => {
			const remainingRaw =
				info?.quotaInfo?.remainingFraction ??
				info?.quota_info?.remaining_fraction ??
				0;
			const remaining = Number(remainingRaw);
			const safeRemaining = Number.isFinite(remaining) ? remaining : 0;
			console.log("[Antigravity Quota] Format model item", {
				account: account.name,
				displayName: displayName,
				remainingFraction: remainingRaw,
				normalizedRemainingFraction: safeRemaining,
			});
			const percent = Math.round(safeRemaining * 100);
			const resetTime =
				info?.quotaInfo?.resetTime || info?.quota_info?.reset_time;
			const resetDate = formatResetTime(resetTime);
			const bgColor =
				percent > 60
					? "bg-green-500"
					: percent > 20
						? "bg-yellow-500"
						: "bg-red-500";

			return `
<div class="mb-3 last:mb-0">
    <div class="flex justify-between items-center mb-1">
        <span class="text-sm font-medium text-gray-700">${displayName}</span>
        <span class="text-xs text-gray-500">${percent}%${resetDate ? ` · ${resetDate}` : ""}</span>
    </div>
    <div class="w-full bg-gray-200 rounded-full h-2">
        <div class="${bgColor} h-2 rounded-full transition-all" style="width: ${percent}%"></div>
    </div>
</div>
`;
		})
		.join("");

	return items;
}
