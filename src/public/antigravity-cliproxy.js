// CLIProxyAPI Antigravity Management Functions

let cliproxyAntigravityAccounts = [];
const cliproxyQuotaCache = {};
const cliproxyThresholdStatusCache = {};
let isLoadingQuota = false;
let _lastCacheUpdate = null;
let _cliproxyViewMode = localStorage.getItem("cliproxy_view_mode") || "card";
const _thresholdConfigCache = {};
const THRESHOLD_CACHE_TTL = 30000;

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
		_lastCacheUpdate = new Date();
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
		_lastCacheUpdate = new Date();
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

	// 并发控制：每批最多 3 个请求，批次间延迟 800ms
	const BATCH_SIZE = 3;
	const BATCH_DELAY = 800;

	const processBatch = async (accounts, fetchFn) => {
		const results = [];
		for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
			const batch = accounts.slice(i, i + BATCH_SIZE);
			const batchResults = await Promise.all(batch.map(fetchFn));
			results.push(...batchResults);

			// 批次间延迟，避免 API 限流
			if (i + BATCH_SIZE < accounts.length) {
				await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
			}
		}
		return results;
	};

	const agtResults = await processBatch(agtAccounts, async (account) => {
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
	});

	const codexResults = await processBatch(codexAccounts, async (account) => {
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
	});

	const claudeResults = await processBatch(claudeAccounts, async (account) => {
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
	});

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

	// 视图切换按钮
	const viewSwitcherHtml = `
		<div class="flex items-center justify-end mb-2">
			<div class="inline-flex rounded-lg bg-gray-100 p-0.5 border border-gray-200/80">
				<button onclick="switchCliProxyView('list')" 
					class="${_cliproxyViewMode === "list" ? "bg-white shadow-sm text-gray-900 ring-1 ring-gray-200/50" : "text-gray-500 hover:text-gray-700"} px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 flex items-center gap-1.5"
					title="列表视图">
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"/>
					</svg>
					列表
				</button>
				<button onclick="switchCliProxyView('card')" 
					class="${_cliproxyViewMode === "card" ? "bg-white shadow-sm text-gray-900 ring-1 ring-gray-200/50" : "text-gray-500 hover:text-gray-700"} px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 flex items-center gap-1.5"
					title="卡片视图">
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"/>
					</svg>
					卡片
				</button>
			</div>
		</div>
	`;

	const contentHtml =
		_cliproxyViewMode === "card"
			? renderCardView(allAccounts)
			: renderListView(allAccounts);

	container.innerHTML = viewSwitcherHtml + contentHtml;

	allAccounts.forEach((account) => {
		loadThresholdBadge(account.name);
	});
}

function renderCardView(allAccounts) {
	return `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            ${allAccounts
							.map((a) => {
								let themeColor = "";
								let themeBg = "";
								let themeText = "";
								let iconSvg = "";
								let providerLabel = "";

								if (a.provider === "codex") {
									themeColor = "emerald";
									themeBg = "bg-emerald-100";
									themeText = "text-emerald-600";
									providerLabel = "Codex";
									iconSvg =
										'<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>';
								} else if (a.provider === "claude") {
									themeColor = "indigo";
									themeBg = "bg-indigo-100";
									themeText = "text-indigo-600";
									providerLabel = "Claude";
									iconSvg =
										'<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>';
								} else {
									themeColor = "violet";
									themeBg = "bg-violet-100";
									themeText = "text-violet-600";
									providerLabel = "Antigravity";
									iconSvg =
										'<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>';
								}

								const email = a.email || a.id || "Unknown";
								const accountJson = JSON.stringify(a).replace(/"/g, "&quot;");
								const safeName = escapeInlineJsString(a.name);

								return `
                <div class="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300/80 transition-all duration-200 relative overflow-hidden group">
                    <div class="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-${themeColor}-400 to-${themeColor}-600"></div>
                    
                    <div class="p-5">
                        <div class="flex items-start justify-between gap-4 mb-4">
                            <div class="flex items-center gap-3 min-w-0 flex-1">
                                <div class="w-9 h-9 rounded-xl ${themeBg} ${themeText} flex items-center justify-center shrink-0">
                                    ${iconSvg}
                                </div>
                                <div class="min-w-0 flex-1">
                                    <div class="flex items-center gap-2 mb-1">
                                        <div class="text-sm font-semibold text-gray-900 truncate" title="${email}">
                                            ${email}
                                        </div>
                                    </div>
                                    <div class="flex flex-wrap items-center gap-2">
                                        <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${themeBg} ${themeText} border border-${themeColor}-200/50">
                                            ${providerLabel}
                                        </span>
                                        ${
																					a.provider === "codex" && a.plan_type
																						? `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 border border-green-200/50">${a.plan_type}</span>`
																						: ""
																				}
                                        <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer hover:bg-amber-50 border border-amber-200/50 text-gray-500" 
                                              id="threshold-badge-${a.name}"
                                              onclick="showThresholdConfig(${accountJson})">
                                            <span class="threshold-loading">检查...</span>
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div class="flex flex-col items-end gap-2 shrink-0">
                                <div class="scale-90 origin-right">${formatCliProxyStatus(a)}</div>
                                <div class="flex items-center gap-1 pt-1">
                                    <button onclick="refreshSingleQuota(${accountJson})" 
                                        class="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" 
                                        title="刷新额度">
                                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                                    </button>
                                    <button onclick="viewModels('${safeName}')" 
                                        class="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-all" 
                                        title="查看模型">
                                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
                                    </button>
                                    <button onclick="showThresholdConfig(${accountJson})" 
                                        class="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all" 
                                        title="设置阈值">
                                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                                    </button>
                                    ${
																			a.disabled
																				? `<button onclick="toggleCliProxyAccount('${safeName}', false)" class="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-all" title="启用账号">
                                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                                    </button>`
																				: `<button onclick="toggleCliProxyAccount('${safeName}', true)" class="p-1.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-all" title="禁用账号">
                                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                                    </button>`
																		}
                                    <button onclick="deleteCliProxyAccount('${safeName}')" class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all" title="删除账号">
                                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div class="bg-gray-50/80 rounded-xl border border-gray-100 p-3.5 ${
													a.disabled ? "opacity-60 grayscale" : ""
												}">
                            ${
															a.provider === "codex"
																? formatCodexQuota(a)
																: a.provider === "claude"
																	? formatClaudeQuota(a)
																	: formatAgtQuota(a)
														}
                        </div>
                    </div>
                </div>
                `;
							})
							.join("")}
        </div>`;
}

function renderListView(allAccounts) {
	// NOTE: "CLIProxy System" in Kiro tab is a data issue — needs DB cleanup, not UI fix
	return `
    <div class="overflow-hidden border border-gray-200/80 rounded-2xl shadow-sm bg-white">
        <table class="w-full text-sm">
            <thead class="bg-gray-50/80 text-gray-500 uppercase tracking-wider text-[11px] font-medium border-b border-gray-200/80">
                <tr>
                    <th class="px-6 py-3 text-left w-[28%]">账号信息</th>
                    <th class="px-6 py-3 text-left w-[42%]">额度使用</th>
                    <th class="px-6 py-3 text-center w-[12%]">状态</th>
                    <th class="px-6 py-3 text-center w-[18%]">操作</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 bg-white">
                ${allAccounts
									.map((a) => {
										let themeColor = "";
										let themeText = "";
										let themeBg = "";
										let providerLabel = "";

										if (a.provider === "codex") {
											themeColor = "emerald";
											themeText = "text-emerald-600";
											themeBg = "bg-emerald-100";
											providerLabel = "Codex";
										} else if (a.provider === "claude") {
											themeColor = "indigo";
											themeText = "text-indigo-600";
											themeBg = "bg-indigo-100";
											providerLabel = "Claude";
										} else {
											themeColor = "violet";
											themeText = "text-violet-600";
											themeBg = "bg-violet-100";
											providerLabel = "Antigravity";
										}

										const email = a.email || a.id || "Unknown";
										const displayEmail =
											email.length > 28
												? email.substring(0, 28) + "..."
												: email;
										const accountJson = JSON.stringify(a).replace(
											/"/g,
											"&quot;",
										);
										const safeName = escapeInlineJsString(a.name);

										return `
                    <tr class="hover:bg-gray-50/50 transition-colors group">
                        <td class="px-6 py-4 align-middle">
                            <div class="flex flex-col gap-1.5">
                                <div class="font-medium text-gray-900 truncate" title="${email}">
                                    ${displayEmail}
                                </div>
                                <div class="flex items-center gap-2">
                                    <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${themeBg} ${themeText} border border-${themeColor}-200/50">
                                        ${providerLabel}
                                    </span>
                                    ${
																			a.provider === "codex" && a.plan_type
																				? `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 border border-green-200/50">${a.plan_type}</span>`
																				: ""
																		}
                                    <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer hover:bg-amber-50 border border-amber-200/50 text-gray-500" 
                                            id="threshold-badge-${a.name}"
                                            onclick="showThresholdConfig(${accountJson})">
                                        <span class="threshold-loading">...</span>
                                    </span>
                                </div>
                            </div>
                        </td>
                        <td class="px-6 py-4 align-middle">
                            <div class="${
															a.disabled ? "opacity-60 grayscale" : ""
														} text-xs scale-95 origin-left w-full">
                                ${
																	a.provider === "codex"
																		? formatCodexQuota(a)
																		: a.provider === "claude"
																			? formatClaudeQuota(a)
																			: formatAgtQuota(a)
																}
                            </div>
                        </td>
                        <td class="px-6 py-4 align-middle text-center">
                            <div class="inline-block">
                                ${formatCliProxyStatus(a)}
                            </div>
                        </td>
                        <td class="px-6 py-4 align-middle text-center">
                            <div class="flex items-center justify-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                                <button onclick="refreshSingleQuota(${accountJson})" 
                                    class="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" 
                                    title="刷新额度">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                                </button>
                                <button onclick="viewModels('${safeName}')" 
                                    class="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-all" 
                                    title="查看模型">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
                                </button>
                                <button onclick="showThresholdConfig(${accountJson})" 
                                    class="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all" 
                                    title="设置阈值">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                                </button>
                                ${
																	a.disabled
																		? `<button onclick="toggleCliProxyAccount('${safeName}', false)" class="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-all" title="启用账号">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                                </button>`
																		: `<button onclick="toggleCliProxyAccount('${safeName}', true)" class="p-1.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-all" title="禁用账号">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                                </button>`
																}
                                <button onclick="deleteCliProxyAccount('${safeName}')" class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all" title="删除账号">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                </button>
                            </div>
                        </td>
                    </tr>
                    `;
									})
									.join("")}
            </tbody>
        </table>
    </div>`;
}

function switchCliProxyView(mode) {
	_cliproxyViewMode = mode;
	localStorage.setItem("cliproxy_view_mode", mode);
	renderCliProxyAccounts();
}

function _renderProgressBarItem(label, percent, resetTime, options = {}) {
	const { disabled, disabledReason, disabledAt } = options;

	let colorClass = "bg-green-500";
	let textClass = "text-green-600";
	let statusIcon = "";
	let containerClass = "opacity-100";
	let labelClass = "text-gray-600";

	if (disabled) {
		colorClass = "bg-gray-400";
		textClass = "text-gray-500 line-through decoration-gray-400";
		containerClass = "opacity-75 grayscale";
		labelClass = "text-gray-500";

		const dateStr = disabledAt
			? new Date(disabledAt).toLocaleString("zh-CN", {
					month: "2-digit",
					day: "2-digit",
					hour: "2-digit",
					minute: "2-digit",
				})
			: "";
		const title = `已禁用: ${disabledReason || "未知原因"}${dateStr ? ` (${dateStr})` : ""}`;

		statusIcon = `
            <span class="cursor-help text-red-500 hover:text-red-600 transition-colors ml-1" title="${title}">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
            </span>
        `;
	} else if (percent < 20) {
		colorClass = "bg-red-500";
		textClass = "text-red-600";
	} else if (percent < 60) {
		colorClass = "bg-amber-400";
		textClass = "text-amber-600";
	}

	return `
    <div class="flex flex-col gap-1.5 w-full ${containerClass}">
        <div class="flex justify-between items-end leading-none gap-2">
            <div class="flex items-center">
                <span class="text-xs font-medium ${labelClass} truncate max-w-[140px]" title="${label}">${label}</span>
                ${statusIcon}
            </div>
            <div class="flex items-center gap-2">
                ${resetTime ? `<span class="text-[10px] text-gray-400 font-mono hidden sm:inline-block">${resetTime}</span>` : ""}
                <span class="text-xs font-bold ${textClass} tabular-nums">${percent}%</span>
            </div>
        </div>
        <div class="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden ring-1 ring-gray-50">
            <div class="${colorClass} h-full rounded-full transition-all duration-500 ease-out" style="width: ${percent}%"></div>
        </div>
    </div>
    `;
}

function formatCodexQuota(account) {
	const cache = cliproxyQuotaCache[account.name];

	if (!cache) {
		return '<div class="flex items-center justify-center h-full text-xs text-gray-400 italic">等待数据...</div>';
	}

	if (cache.status === "loading") {
		return `
        <div class="flex items-center justify-center gap-2 py-2">
            <div class="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <span class="text-xs text-blue-600 font-medium">加载配额中...</span>
        </div>`;
	}

	if (cache.status === "error") {
		return `<div class="bg-red-50 text-red-600 text-xs px-3 py-2 rounded-lg border border-red-100 flex items-start gap-2">
            <svg class="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <span class="break-all" title="${cache.error || "加载失败"}">加载失败</span>
        </div>`;
	}

	const data = cache.data;
	if (!data) {
		return '<div class="text-xs text-gray-400 text-center py-2">无可用数据</div>';
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

	const items = [];

	if (data.rate_limit?.primary_window) {
		const usedPercent = data.rate_limit.primary_window.used_percent || 0;
		const remainingPercent = Math.max(0, 100 - usedPercent);
		const resetTime = formatResetTime(data.rate_limit.primary_window.reset_at);
		items.push(
			_renderProgressBarItem(
				"5小时限额",
				Math.round(remainingPercent),
				resetTime,
			),
		);
	}

	if (data.rate_limit?.secondary_window) {
		const usedPercent = data.rate_limit.secondary_window.used_percent || 0;
		const remainingPercent = Math.max(0, 100 - usedPercent);
		const resetTime = formatResetTime(
			data.rate_limit.secondary_window.reset_at,
		);
		items.push(
			_renderProgressBarItem("周限额", Math.round(remainingPercent), resetTime),
		);
	}

	if (data.code_review_rate_limit?.primary_window) {
		const usedPercent =
			data.code_review_rate_limit.primary_window.used_percent || 0;
		const remainingPercent = Math.max(0, 100 - usedPercent);
		const resetTime = formatResetTime(
			data.code_review_rate_limit.primary_window.reset_at,
		);
		items.push(
			_renderProgressBarItem(
				"代码审查",
				Math.round(remainingPercent),
				resetTime,
			),
		);
	}

	if (items.length === 0)
		return '<div class="text-xs text-gray-400 text-center py-2">无配额数据</div>';

	return `<div class="grid grid-cols-1 gap-3">${items.join("")}</div>`;
}

function formatClaudeQuota(account) {
	const cache = cliproxyQuotaCache[account.name];

	if (!cache) {
		return '<div class="flex items-center justify-center h-full text-xs text-gray-400 italic">等待数据...</div>';
	}

	if (cache.status === "loading") {
		return `
        <div class="flex items-center justify-center gap-2 py-2">
            <div class="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            <span class="text-xs text-indigo-600 font-medium">加载配额中...</span>
        </div>`;
	}

	if (cache.status === "error") {
		return `<div class="bg-red-50 text-red-600 text-xs px-3 py-2 rounded-lg border border-red-100 flex items-start gap-2">
            <svg class="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <span class="break-all" title="${cache.error || "加载失败"}">加载失败</span>
        </div>`;
	}

	const data = cache.data;
	if (!data) {
		return '<div class="text-xs text-gray-400 text-center py-2">无可用数据</div>';
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
		const remainingPercent = Math.max(0, 100 - utilization);
		const resetTime = formatResetTime(data.five_hour.resets_at);
		items.push(
			_renderProgressBarItem(
				"5小时限额",
				Math.round(remainingPercent),
				resetTime,
			),
		);
	}

	if (data.seven_day) {
		const utilization = data.seven_day.utilization || 0;
		const remainingPercent = Math.max(0, 100 - utilization);
		const resetTime = formatResetTime(data.seven_day.resets_at);
		items.push(
			_renderProgressBarItem(
				"7天限额",
				Math.round(remainingPercent),
				resetTime,
			),
		);
	}

	if (data.seven_day_sonnet) {
		const utilization = data.seven_day_sonnet.utilization || 0;
		const remainingPercent = Math.max(0, 100 - utilization);
		const resetTime = formatResetTime(data.seven_day_sonnet.resets_at);
		items.push(
			_renderProgressBarItem(
				"7天Sonnet",
				Math.round(remainingPercent),
				resetTime,
			),
		);
	}

	if (items.length === 0) {
		return '<div class="text-xs text-gray-400 text-center py-2">无配额数据</div>';
	}

	return `<div class="grid grid-cols-1 gap-3">${items.join("")}</div>`;
}

function formatAgtQuota(account) {
	const cache = cliproxyQuotaCache[account.name];

	if (!cache) {
		return '<div class="flex items-center justify-center h-full text-xs text-gray-400 italic">等待数据...</div>';
	}

	if (cache.status === "loading") {
		return `
        <div class="flex items-center justify-center gap-2 py-2">
            <div class="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
            <span class="text-xs text-purple-600 font-medium">加载配额中...</span>
        </div>`;
	}

	if (cache.status === "error") {
		return `<div class="bg-red-50 text-red-600 text-xs px-3 py-2 rounded-lg border border-red-100 flex items-start gap-2">
            <svg class="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <span class="break-all" title="${cache.error || "加载失败"}">加载失败</span>
        </div>`;
	}

	const models = Object.entries(cache.data || {});
	if (models.length === 0) {
		return '<div class="text-xs text-gray-400 text-center py-2">无可用数据</div>';
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
		"claude-opus-4-6",
		"claude-haiku-4",
		"gpt-4",
		"gpt-4-turbo",
		"gpt-3.5-turbo",
		"gemini-3-pro",
		"gemini-3-pro-high",
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
					displayName: "Claude/GPT 共享",
					info: info,
					groupKey: "claude_gpt",
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
				groupKey: name.replace(/-/g, "_"),
			});
		}
	}

	// Add remaining Claude/GPT group if exists
	if (claudeGptGroup) {
		groupedModels.push(claudeGptGroup);
	}

	// Load threshold status if not exists
	if (
		!cliproxyThresholdStatusCache[account.name] &&
		!cliproxyThresholdStatusCache[`loading_${account.name}`]
	) {
		cliproxyThresholdStatusCache[`loading_${account.name}`] = true;
		loadGroupDisableStatus(account.name).finally(() => {
			delete cliproxyThresholdStatusCache[`loading_${account.name}`];
			// Only re-render if we are still on the page and the element exists (simple check)
			if (document.getElementById("cliproxy-antigravity-accounts-table")) {
				renderCliProxyAccounts();
			}
		});
	}

	const thresholdStatus = cliproxyThresholdStatusCache[account.name] || {};
	const disabledGroups = thresholdStatus.disabledGroups || {};

	const items = groupedModels.map(({ displayName, info, groupKey }) => {
		const remainingRaw =
			info?.quotaInfo?.remainingFraction ??
			info?.quota_info?.remaining_fraction ??
			0;
		const remaining = Number(remainingRaw);
		const safeRemaining = Number.isFinite(remaining) ? remaining : 0;

		const percent = Math.round(safeRemaining * 100);
		const resetTime =
			info?.quotaInfo?.resetTime || info?.quota_info?.reset_time;
		const resetDate = formatResetTime(resetTime);

		const disabledInfo = disabledGroups[groupKey];
		const isGroupDisabled = !!disabledInfo;

		return _renderProgressBarItem(displayName, percent, resetDate, {
			disabled: isGroupDisabled,
			disabledReason: disabledInfo?.reason,
			disabledAt: disabledInfo?.disabled_at,
		});
	});

	if (items.length === 0)
		return '<div class="text-xs text-gray-400 text-center py-2">无配额数据</div>';

	// Use grid layout for multiple items
	const gridClass =
		items.length > 2
			? "grid grid-cols-1 md:grid-cols-2 gap-3"
			: "grid grid-cols-1 gap-3";

	return `<div class="${gridClass}">${items.join("")}</div>`;
}

async function loadGroupDisableStatus(accountName) {
	try {
		const response = await fetchApi(
			`/api/admin/cliproxy/threshold-status?name=${encodeURIComponent(accountName)}`,
		);
		cliproxyThresholdStatusCache[accountName] = response;
		return response;
	} catch (e) {
		console.error(`加载阈值状态失败 [${accountName}]:`, e);
		return null;
	}
}

async function loadThresholdBadge(accountName, forceRefresh = false) {
	try {
		let config;
		const cached = _thresholdConfigCache[accountName];
		if (
			!forceRefresh &&
			cached &&
			Date.now() - cached.timestamp < THRESHOLD_CACHE_TTL
		) {
			config = cached.data;
		} else {
			const response = await fetchApi(
				`/api/admin/cliproxy/threshold-config?name=${encodeURIComponent(accountName)}`,
			);
			config = response.config || {};
			_thresholdConfigCache[accountName] = {
				data: config,
				timestamp: Date.now(),
			};
		}
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
			gemini_3_pro: "Gemini-3-Pro",
			gemini_3_pro_high: "Gemini-3-Pro-High",
			gemini_3_flash: "Gemini-3-Flash",
			gemini_3_pro_image: "Gemini-3-Pro-Image",
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
				"px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap bg-gray-50 text-gray-400 border border-gray-200 border-dashed hover:border-gray-300 hover:text-gray-500 transition-colors";
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

			badge.innerHTML = `
				<span class="mr-1">⚡</span>${minThreshold}%
			`;
			badge.className =
				"px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap bg-emerald-50 text-emerald-600 border border-emerald-100 cursor-help hover:bg-emerald-100 hover:border-emerald-200 transition-all shadow-sm";
			badge.title = tooltipLines;
		}
	} catch (e) {
		const badge = document.getElementById(`threshold-badge-${accountName}`);
		if (badge) {
			badge.innerHTML = "加载失败";
			badge.className =
				"px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap bg-red-50 text-red-500 border border-red-100 hover:bg-red-100 transition-colors";
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
			"fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity duration-300";

		// Determine theme color and style based on provider
		let accentColor = "blue";
		let accentClass = "text-blue-600";
		let borderClass = "border-blue-500";
		let ringClass = "focus:ring-blue-500";
		let btnClass = "bg-blue-600 hover:bg-blue-700";
		let bgSoftClass = "bg-blue-50";

		if (account.provider === "claude") {
			accentColor = "indigo";
			accentClass = "text-indigo-600";
			borderClass = "border-indigo-500";
			ringClass = "focus:ring-indigo-500";
			btnClass = "bg-indigo-600 hover:bg-indigo-700";
			bgSoftClass = "bg-indigo-50";
		} else if (account.provider === "codex") {
			accentColor = "emerald";
			accentClass = "text-emerald-600";
			borderClass = "border-emerald-500";
			ringClass = "focus:ring-emerald-500";
			btnClass = "bg-emerald-600 hover:bg-emerald-700";
			bgSoftClass = "bg-emerald-50";
		} else if (account.provider === "antigravity") {
			accentColor = "violet";
			accentClass = "text-violet-600";
			borderClass = "border-violet-500";
			ringClass = "focus:ring-violet-500";
			btnClass = "bg-violet-600 hover:bg-violet-700";
			bgSoftClass = "bg-violet-50";
		}

		// Helper to render input fields with clean Apple-like design
		const renderInput = (id, label, value) => `
			<div class="group">
				<label for="${id}" class="block text-sm font-medium text-gray-700 mb-1.5 transition-colors group-focus-within:${accentClass}">${label}</label>
				<div class="relative rounded-lg shadow-sm">
					<input type="number" id="${id}" min="0" max="100" value="${value}" 
						class="block w-full rounded-lg border border-gray-300 pl-3 pr-10 ${ringClass} focus:border-${accentColor}-500 sm:text-sm transition-all py-2.5 hover:border-gray-400 placeholder:text-gray-300 shadow-sm" 
						placeholder="留空或0"
                        onfocus="this.placeholder=''"
                        onblur="this.placeholder='留空或0'">
					<div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
						<span class="text-gray-400 sm:text-sm font-medium">%</span>
					</div>
				</div>
			</div>
		`;

		let configHtml = "";

		if (account.provider === "claude") {
			configHtml = `
				<div class="space-y-5">
					${renderInput("threshold-five-hour", "5 小时限额阈值", toInputPercent(config.five_hour))}
					${renderInput("threshold-seven-day", "7 天限额阈值", toInputPercent(config.seven_day))}
					${renderInput("threshold-seven-day-sonnet", "7 天 Sonnet 限额阈值", toInputPercent(config.seven_day_sonnet))}
				</div>
			`;
		} else if (account.provider === "codex") {
			configHtml = `
				<div class="space-y-5">
					${renderInput("threshold-five-hour", "5 小时限额阈值", toInputPercent(config.five_hour))}
					${renderInput("threshold-weekly", "周限额阈值", toInputPercent(config.weekly))}
					${renderInput("threshold-code-review", "代码审查周限额阈值", toInputPercent(config.code_review))}
				</div>
			`;
		} else {
			configHtml = `
				<div class="space-y-6">
					<!-- Claude/GPT Section -->
					<div class="relative rounded-xl border border-gray-200 bg-gray-50/50 p-5">
						<div class="absolute -top-3 left-3 bg-white px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Claude / GPT</div>
						<div class="space-y-4 pt-1">
							${renderInput("threshold-claude-gpt", "最低阈值 (Claude/GPT 统一)", toInputPercent(config.claude_gpt))}
							<p class="text-xs text-gray-400">包含: claude-sonnet, gpt-4, gpt-4-turbo 等</p>
						</div>
					</div>

					<!-- Gemini Section -->
					<div class="relative rounded-xl border border-gray-200 bg-gray-50/50 p-5">
						<div class="absolute -top-3 left-3 bg-white px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Gemini</div>
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
							${renderInput("threshold-gemini-3-pro", "Gemini 3 Pro", toInputPercent(config.gemini_3_pro))}
							${renderInput("threshold-gemini-3-pro-high", "Gemini 3 Pro High", toInputPercent(config.gemini_3_pro_high))}
							${renderInput("threshold-gemini-3-flash", "Gemini 3 Flash", toInputPercent(config.gemini_3_flash))}
							${renderInput("threshold-gemini-3-pro-image", "Gemini 3 Pro Image", toInputPercent(config.gemini_3_pro_image))}
						</div>
					</div>
				</div>
			`;
		}

		modal.innerHTML = `
			<div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 animate-scaleIn flex flex-col overflow-hidden ring-1 ring-black/5">
				<!-- Header -->
				<div class="relative px-6 py-5 border-b border-gray-100 ${account.provider === "antigravity" ? "bg-gradient-to-r from-violet-50 to-white" : ""}">
					<div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-${accentColor}-500 to-transparent opacity-50"></div>
					<div class="flex items-center justify-between">
						<div>
							<h3 class="text-lg font-bold text-gray-900 tracking-tight">自动停用阈值</h3>
							<p class="text-sm text-gray-500 mt-0.5 font-medium">${account.email || account.name}</p>
						</div>
						<button onclick="document.getElementById('thresholdModal').remove()" 
							class="text-gray-400 hover:text-gray-600 p-2 rounded-full hover:bg-gray-100 transition-colors">
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
				</div>

				<!-- Content -->
				<div class="px-6 py-6 overflow-y-auto max-h-[60vh]">
					<div class="flex items-start gap-3 p-3 mb-6 rounded-lg ${bgSoftClass} border border-${accentColor}-100">
						<svg class="w-5 h-5 ${accentClass} shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
						</svg>
						<p class="text-sm text-gray-600 leading-relaxed">
							当任一限额的使用量 <span class="font-medium text-gray-900">低于</span> 设定百分比时，系统将自动禁用该账号以保护额度。
						</p>
					</div>
					
					${configHtml}
				</div>

				<!-- Footer -->
				<div class="px-6 py-5 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
					<button onclick="document.getElementById('thresholdModal').remove()" 
						class="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-200 transition-all shadow-sm">
						取消
					</button>
					<button onclick="saveThresholdConfig('${account.name}', '${account.provider}')" 
						class="px-5 py-2.5 text-sm font-medium text-white ${btnClass} rounded-xl shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 ${ringClass} transition-all transform hover:-translate-y-0.5">
						保存配置
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
			const gemini3ProValue = document.getElementById(
				"threshold-gemini-3-pro",
			).value;
			const gemini3ProHighValue = document.getElementById(
				"threshold-gemini-3-pro-high",
			).value;
			const gemini3FlashValue = document.getElementById(
				"threshold-gemini-3-flash",
			).value;
			const gemini3ProImageValue = document.getElementById(
				"threshold-gemini-3-pro-image",
			).value;

			config = compactConfig({
				claude_gpt: parseThreshold(claudeGptValue),
				gemini_3_pro: parseThreshold(gemini3ProValue),
				gemini_3_pro_high: parseThreshold(gemini3ProHighValue),
				gemini_3_flash: parseThreshold(gemini3FlashValue),
				gemini_3_pro_image: parseThreshold(gemini3ProImageValue),
			});
		}

		await fetchApi("/api/admin/cliproxy/threshold-config", {
			method: "POST",
			body: JSON.stringify({ name: accountName, config }),
		});

		document.getElementById("thresholdModal").remove();
		showToast("阈值配置保存成功", "success");

		delete _thresholdConfigCache[accountName];
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

// 导出到全局作用域
window.forceRefreshCliProxyAccounts = _forceRefreshCliProxyAccounts;
window.refreshAllAgtQuotas = _refreshAllAgtQuotas;
window.renderCliProxyAgtAccounts = _renderCliProxyAgtAccounts;
window.viewModels = _viewModels;
window.formatDateTime = _formatDateTime;
window.toggleCliProxyAgtAccount = _toggleCliProxyAgtAccount;
window.deleteCliProxyAgtAccount = _deleteCliProxyAgtAccount;
window.refreshSingleQuota = refreshSingleQuota;
window.refreshSingleAgtQuota = _refreshSingleAgtQuota;
window.showThresholdConfig = _showThresholdConfig;
window.switchCliProxyView = switchCliProxyView;
window.saveThresholdConfig = _saveThresholdConfig;
window.toggleCliProxyAccount = toggleCliProxyAccount;
window.deleteCliProxyAccount = deleteCliProxyAccount;
window.loadCliProxyAccounts = loadCliProxyAccounts;
window.loadCliProxyAgtAccounts = loadCliProxyAgtAccounts;
