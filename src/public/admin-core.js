const selectedAccounts = new Set();
let autoRefreshInterval = null;
let serverStartTime = null;
let uptimeInterval = null;
let currentPage = 1;
const pageSize = 15;
let allAccounts = [];
let weeklyChart = null;
const _weeklyTokenChart = null;

function startUptimeCounter() {
	if (uptimeInterval) {
		clearInterval(uptimeInterval);
	}
	uptimeInterval = setInterval(() => {
		if (serverStartTime) {
			const uptime = Math.floor((Date.now() - serverStartTime) / 1000);
			const uptimeEl = document.getElementById("stat-uptime");
			if (uptimeEl) {
				uptimeEl.textContent = formatUptime(uptime);
			}
		}
	}, 1000);
}

function logout() {
	if (autoRefreshInterval) clearInterval(autoRefreshInterval);
	if (uptimeInterval) clearInterval(uptimeInterval);
	localStorage.removeItem("kiro_token");
	localStorage.removeItem("kiro_user");
	window.location.href = "/login.html";
}

setAdminLogoutHandler(logout);

function _showMainPanel() {
	const loginPage = document.getElementById("loginPage");
	if (loginPage) {
		loginPage.classList.add("hidden");
	}
	const mainPanel = document.getElementById("mainPanel");
	if (mainPanel) {
		mainPanel.classList.remove("hidden");
	}
	refresh();
}

function setElementText(id, value) {
	const elements = document.querySelectorAll(`#${id}`);
	elements.forEach((el) => {
		el.textContent = value;
	});
}

function setElementWidth(id, widthValue) {
	const el = document.getElementById(id);
	if (el) {
		el.style.width = widthValue;
	}
}

function formatUptime(secs) {
	const h = Math.floor(secs / 3600),
		m = Math.floor((secs % 3600) / 60);
	return h > 0 ? `${h}h ${m}m` : `${m}m ${secs % 60}s`;
}

function formatNumber(n) {
	if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
	return n.toString();
}

function formatPercent(value) {
	const num = Number(value);
	if (!Number.isFinite(num)) return "0.0%";
	return `${num.toFixed(1)}%`;
}

async function loadStatus() {
	try {
		const data = await fetchApi("/api/admin/stats/overview");
		const stats = data.data;

		// Kiro accounts stats
		setElementText("stat-active", String(stats.kiroAccounts?.active || 0));
		setElementText("stat-cooldown", String(stats.kiroAccounts?.cooldown || 0));
		const invalidCount =
			(stats.kiroAccounts?.error || 0) +
			(stats.kiroAccounts?.depleted || 0) +
			(stats.kiroAccounts?.disabled || 0) +
			(stats.kiroAccounts?.inactive || 0);
		setElementText("stat-invalid", String(invalidCount));

		// Request stats
		setElementText("stat-requests", formatNumber(stats.allTime?.requests || 0));
		setElementText("stat-input", formatNumber(stats.allTime?.inputTokens || 0));
		setElementText(
			"stat-output",
			formatNumber(stats.allTime?.outputTokens || 0),
		);
		setElementText(
			"stat-total-tokens",
			formatNumber(stats.allTime?.totalTokens || 0),
		);
		setElementText(
			"stat-success-rate",
			formatPercent(stats.allTime?.successRate || 0),
		);

		setElementText(
			"stat-cliproxy-active",
			String(stats.cliproxyAccounts?.active || 0),
		);
		setElementText(
			"stat-cliproxy-error",
			String(
				(stats.cliproxyAccounts?.error || 0) +
					(stats.cliproxyAccounts?.inactive || 0),
			),
		);
		setElementText(
			"stat-cliproxy-requests",
			formatNumber(stats.cliproxyAccounts?.requests || 0),
		);

		// 今日统计
		setElementText("today-requests", formatNumber(stats.today?.requests || 0));
		setElementText(
			"today-revenue",
			`$${(stats.today?.revenue || 0).toFixed(2)}`,
		);
		setElementText("today-input", formatNumber(stats.today?.inputTokens || 0));
		setElementText(
			"today-output",
			formatNumber(stats.today?.outputTokens || 0),
		);
		setElementText(
			"today-total-tokens",
			formatNumber(stats.today?.totalTokens || 0),
		);

		const kiroAccounts = stats.kiroAccounts || {};
		setElementText("kiro-total-accounts", String(kiroAccounts.total || 0));
		setElementText("kiro-active-accounts", String(kiroAccounts.active || 0));
		setElementText(
			"kiro-depleted-accounts",
			String(kiroAccounts.depleted || 0),
		);
		setElementText("kiro-error-accounts", String(kiroAccounts.error || 0));
		setElementText("kiro-cooldown", String(kiroAccounts.cooldown || 0));
		setElementText("kiro-disabled", String(kiroAccounts.disabled || 0));
		setElementText("kiro-inactive", String(kiroAccounts.inactive || 0));
		setElementText("kiro-total-accounts", String(kiroAccounts.total || 0));
		setElementText("kiro-active-accounts", String(kiroAccounts.active || 0));
		setElementText(
			"kiro-depleted-accounts",
			String(kiroAccounts.depleted || 0),
		);

		const cliproxyAccounts = stats.cliproxyAccounts || {};
		setElementText(
			"cliproxy-total-accounts",
			String(cliproxyAccounts.total || 0),
		);
		setElementText(
			"cliproxy-active-accounts",
			String(cliproxyAccounts.active || 0),
		);
		setElementText(
			"cliproxy-error-accounts",
			String((cliproxyAccounts.error || 0) + (cliproxyAccounts.inactive || 0)),
		);

		setElementText(
			"cliproxy-antigravity-count",
			String(cliproxyAccounts.antigravity || 0),
		);
		setElementText("cliproxy-codex-count", String(cliproxyAccounts.codex || 0));
		setElementText(
			"cliproxy-claude-count",
			String(cliproxyAccounts.claude || 0),
		);
		setElementText(
			"cliproxy-total-models",
			String(cliproxyAccounts.totalModels || 0),
		);

		await Promise.all([
			loadQuotaStats(),
			loadMiniCharts(),
			loadUserRanking(),
			loadModelStats(),
			loadModelTypeStats(),
		]);

		// Uptime - 启动自动更新
		if (!serverStartTime) {
			serverStartTime = Date.now();
		}
		startUptimeCounter();
	} catch (e) {
		console.error("Load status error:", e);
	}
}

async function loadQuotaStats() {
	try {
		const data = await fetchApi("/api/admin/accounts");
		const accounts = data.data || [];

		let totalQuota = 0;
		let totalUsed = 0;
		let totalAvailable = 0;

		accounts.forEach((acc) => {
			if (acc.usage_limit && acc.status === "active") {
				totalQuota += acc.usage_limit || 0;
				totalUsed += acc.current_usage || 0;
				totalAvailable += acc.available || 0;
			}
		});

		const usedPercent =
			totalQuota > 0 ? Math.round((totalUsed / totalQuota) * 100) : 0;

		setElementText("stat-total-quota", totalQuota.toFixed(1));
		setElementText("stat-available-quota", totalAvailable.toFixed(1));
		setElementText("stat-used-percent", `${usedPercent}%`);
		setElementWidth("quota-progress", `${usedPercent}%`);
	} catch (e) {
		console.error("Load quota stats error:", e);
	}
}

async function loadMiniCharts() {
	try {
		const endDate = new Date();
		const startDate = new Date();
		startDate.setDate(startDate.getDate() - 6);

		const labels = [];
		const requestData = [];
		const totalTokenData = [];

		const dailyStats = {};
		for (let i = 0; i < 7; i++) {
			const date = new Date(startDate);
			date.setDate(date.getDate() + i);
			const dateStr = date.toISOString().split("T")[0];
			labels.push(`${date.getMonth() + 1}/${date.getDate()}`);
			dailyStats[dateStr] = {
				count: 0,
				total_tokens: 0,
			};
		}

		const startDateStr = startDate.toISOString().split("T")[0];
		const endDateStr = endDate.toISOString().split("T")[0];
		const statsData = await fetchApi(
			`/api/admin/stats/daily?startDate=${startDateStr}&endDate=${endDateStr}`,
		);
		const stats = statsData.data || [];

		stats.forEach((stat) => {
			if (Object.hasOwn(dailyStats, stat.date)) {
				dailyStats[stat.date] = {
					count: stat.count || 0,
					total_tokens: stat.total_tokens || 0,
				};
			}
		});

		Object.keys(dailyStats)
			.sort()
			.forEach((date) => {
				requestData.push(dailyStats[date].count);
				totalTokenData.push(dailyStats[date].total_tokens);
			});

		const totalRequests = requestData.reduce((a, b) => a + b, 0);
		const totalTokens = totalTokenData.reduce((a, b) => a + b, 0);
		const avgChange =
			requestData.length > 1
				? (
						((requestData[requestData.length - 1] - requestData[0]) /
							Math.max(requestData[0], 1)) *
						100
					).toFixed(1)
				: 0;
		const tokenChange =
			totalTokenData.length > 1
				? (
						((totalTokenData[totalTokenData.length - 1] - totalTokenData[0]) /
							Math.max(totalTokenData[0], 1)) *
						100
					).toFixed(1)
				: 0;

		setElementText("trend-total", formatNumber(totalRequests));
		setElementText(
			"trend-change",
			`${(avgChange > 0 ? "+" : "") + avgChange}%`,
		);
		setElementText("token-total", formatNumber(totalTokens));
		setElementText(
			"token-change",
			`${(tokenChange > 0 ? "+" : "") + tokenChange}%`,
		);

		createMiniChart(
			"miniTrendChart",
			requestData,
			"rgba(59, 130, 246, 0.8)",
			"rgb(59, 130, 246)",
		);
		createMiniChart(
			"miniTokenChart",
			totalTokenData,
			"rgba(16, 185, 129, 0.8)",
			"rgb(16, 185, 129)",
		);
	} catch (e) {
		console.error("Load mini charts error:", e);
	}
}

function createMiniChart(canvasId, data, bgColor, borderColor) {
	const canvas = document.getElementById(canvasId);
	if (!canvas) return;

	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	new Chart(ctx, {
		type: "line",
		data: {
			labels: data.map((_, i) => i + 1),
			datasets: [
				{
					data: data,
					borderColor: borderColor,
					backgroundColor: bgColor,
					borderWidth: 2,
					tension: 0.4,
					pointRadius: 0,
					pointHoverRadius: 4,
					fill: true,
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			animation: false,
			plugins: {
				legend: { display: false },
				tooltip: {
					enabled: true,
					mode: "index",
					intersect: false,
					backgroundColor: "rgba(0, 0, 0, 0.8)",
					padding: 8,
					cornerRadius: 6,
					titleFont: { size: 11 },
					bodyFont: { size: 11 },
					callbacks: {
						title: (context) => `第 ${context[0].label} 天`,
						label: (context) => {
							const value = context.parsed.y;
							if (value >= 1000000) {
								return `${(value / 1000000).toFixed(1)}M`;
							} else if (value >= 1000) {
								return `${(value / 1000).toFixed(1)}K`;
							}
							return value.toLocaleString();
						},
					},
				},
			},
			scales: {
				x: { display: false },
				y: { display: false, beginAtZero: true },
			},
			interaction: { mode: "index", intersect: false },
		},
	});
}

async function _loadWeeklyChart() {
	try {
		const endDate = new Date();
		const startDate = new Date();
		startDate.setDate(startDate.getDate() - 6);

		const labels = [];
		const requestData = [];
		const inputTokenData = [];
		const outputTokenData = [];
		const totalTokenData = [];

		const dailyStats = {};
		for (let i = 0; i < 7; i++) {
			const date = new Date(startDate);
			date.setDate(date.getDate() + i);
			const dateStr = date.toISOString().split("T")[0];
			labels.push(`${date.getMonth() + 1}/${date.getDate()}`);
			dailyStats[dateStr] = {
				count: 0,
				input_tokens: 0,
				output_tokens: 0,
				total_tokens: 0,
			};
		}

		const startDateStr = startDate.toISOString().split("T")[0];
		const endDateStr = endDate.toISOString().split("T")[0];
		const statsData = await fetchApi(
			`/api/admin/stats/daily?startDate=${startDateStr}&endDate=${endDateStr}`,
		);
		const stats = statsData.data || [];

		stats.forEach((stat) => {
			if (Object.hasOwn(dailyStats, stat.date)) {
				dailyStats[stat.date] = {
					count: stat.count || 0,
					input_tokens: stat.input_tokens || 0,
					output_tokens: stat.output_tokens || 0,
					total_tokens: stat.total_tokens || 0,
				};
			}
		});

		Object.keys(dailyStats)
			.sort()
			.forEach((date) => {
				requestData.push(dailyStats[date].count);
				inputTokenData.push(dailyStats[date].input_tokens);
				outputTokenData.push(dailyStats[date].output_tokens);
				totalTokenData.push(dailyStats[date].total_tokens);
			});

		if (weeklyChart) {
			weeklyChart.data.labels = labels;
			weeklyChart.data.datasets[0].data = requestData;
			weeklyChart.data.datasets[1].data = totalTokenData;
			weeklyChart.update("none");
		} else {
			const weeklyChartElement = document.getElementById("weeklyChart");
			if (!weeklyChartElement) {
				return;
			}
			const ctx = weeklyChartElement.getContext("2d");
			if (!ctx) {
				return;
			}
			weeklyChart = new Chart(ctx, {
				type: "bar",
				data: {
					labels: labels,
					datasets: [
						{
							label: "请求数",
							data: requestData,
							type: "bar",
							backgroundColor: "rgba(59, 130, 246, 0.75)",
							borderColor: "rgb(59, 130, 246)",
							borderWidth: 0,
							borderRadius: 6,
							barPercentage: 0.7,
							yAxisID: "y",
							order: 2,
						},
						{
							label: "总Tokens",
							data: totalTokenData,
							type: "line",
							borderColor: "rgb(16, 185, 129)",
							backgroundColor: "rgba(16, 185, 129, 0.08)",
							borderWidth: 2.5,
							tension: 0.4,
							pointBackgroundColor: "#fff",
							pointBorderColor: "rgb(16, 185, 129)",
							pointBorderWidth: 2,
							pointRadius: 3.5,
							pointHoverRadius: 5,
							fill: true,
							yAxisID: "y1",
							order: 1,
						},
					],
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					animation: false,
					interaction: {
						mode: "index",
						intersect: false,
					},
					plugins: {
						legend: {
							display: false,
						},
						tooltip: {
							backgroundColor: "rgba(255, 255, 255, 0.98)",
							titleColor: "#111827",
							bodyColor: "#374151",
							borderColor: "#e5e7eb",
							borderWidth: 1,
							padding: 12,
							displayColors: true,
							boxWidth: 8,
							boxHeight: 8,
							usePointStyle: true,
							titleFont: { size: 12, weight: "600" },
							bodyFont: { size: 11 },
							callbacks: {
								label: (context) => {
									let label = context.dataset.label || "";
									if (label) {
										label += ": ";
									}
									if (context.parsed.y !== null) {
										label += formatNumber(context.parsed.y);
									}
									return label;
								},
							},
						},
					},
					scales: {
						x: {
							grid: {
								display: false,
							},
							border: {
								display: false,
							},
							ticks: {
								color: "#9ca3af",
								font: { size: 10, weight: "500" },
								padding: 8,
							},
						},
						y: {
							type: "linear",
							display: true,
							position: "left",
							beginAtZero: true,
							grid: {
								color: "#f3f4f6",
								drawBorder: false,
							},
							border: {
								display: false,
							},
							ticks: {
								color: "#9ca3af",
								font: { size: 10 },
								maxTicksLimit: 5,
								padding: 8,
							},
						},
						y1: {
							type: "linear",
							display: true,
							position: "right",
							beginAtZero: true,
							grid: {
								display: false,
							},
							border: {
								display: false,
							},
							ticks: {
								color: "#9ca3af",
								font: { size: 10 },
								callback: (value) => formatNumber(value),
								maxTicksLimit: 5,
								padding: 8,
							},
						},
					},
					layout: {
						padding: {
							top: 5,
							bottom: 5,
							left: 5,
							right: 5,
						},
					},
				},
			});
		}
	} catch (e) {
		console.error("Load weekly chart error:", e);
	}
}

// ---------------------------------------------------------------------
// Charts & Analytics: User & Model Rankings (Mini-Chart Style)
// ---------------------------------------------------------------------

async function loadUserRanking() {
	try {
		const data = await fetchApi(
			"/api/admin/stats/users?sortBy=requests&limit=8",
		);
		const users = data.data || [];
		const container = document.getElementById("user-ranking");
		if (!container) return;

		if (users.length === 0) {
			container.innerHTML =
				'<div class="text-xs text-gray-400 py-6 text-center">暂无数据</div>';
			return;
		}

		const maxRequests = Math.max(...users.map((u) => u.total_requests || 0), 1);

		container.innerHTML = `
            <div class="space-y-1">
                ${users
									.map((user, index) => {
										const requests = user.total_requests || 0;
										const _totalTokens =
											(user.total_input_tokens || 0) +
											(user.total_output_tokens || 0);
										const percent = Math.round((requests / maxRequests) * 100);

										const rankColor =
											index === 0
												? "text-blue-600"
												: index === 1
													? "text-blue-500"
													: index === 2
														? "text-blue-400"
														: "text-gray-400";

										return `
                    <div class="group relative flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-gray-50/80 transition cursor-default" title="Total Cost: $${(user.total_cost || 0).toFixed(4)}">
                        <span class="font-mono text-[10px] ${rankColor} w-4 text-center font-semibold">${index + 1}</span>
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center justify-between mb-0.5">
                                <span class="text-xs text-gray-700 font-medium truncate">${escapeHtml(user.username || "unknown")}</span>
                                <span class="text-[10px] font-mono text-gray-500 ml-2">${formatNumber(requests)}</span>
                            </div>
                            <div class="h-1 bg-gray-100 rounded-full overflow-hidden">
                                <div class="h-full bg-gradient-to-r from-blue-400 to-blue-500 rounded-full transition-all duration-500" style="width: ${percent}%"></div>
                            </div>
                        </div>
                    </div>
                    `;
									})
									.join("")}
            </div>
        `;
	} catch (e) {
		console.error("Load user ranking error:", e);
	}
}

async function loadModelTypeStats() {
	try {
		const data = await fetchApi("/v1/models");
		const models = data.data || [];

		const claudeCount = models.filter((m) =>
			m.id?.toLowerCase().includes("claude"),
		).length;
		const geminiCount = models.filter((m) =>
			m.id?.toLowerCase().includes("gemini"),
		).length;
		const gptCount = models.filter(
			(m) =>
				m.id &&
				(m.id.toLowerCase().includes("gpt") ||
					m.id.toLowerCase().includes("codex")),
		).length;

		setElementText("model-claude-count", String(claudeCount));
		setElementText("model-gemini-count", String(geminiCount));
		setElementText("model-gpt-count", String(gptCount));
	} catch (e) {
		console.error("Load model type stats error:", e);
	}
}

async function loadModelStats() {
	try {
		const data = await fetchApi("/api/admin/stats/models");
		const models = (data.data || []).slice(0, 8);
		const container = document.getElementById("model-stats");
		if (!container) return;

		if (models.length === 0) {
			container.innerHTML =
				'<div class="text-xs text-gray-400 py-6 text-center">暂无数据</div>';
			return;
		}

		const maxRequests = Math.max(...models.map((m) => m.request_count || 0), 1);

		container.innerHTML = `
            <div class="space-y-1">
                ${models
									.map((model, index) => {
										const requests = model.request_count || 0;
										const _totalTokens =
											model.total_tokens ||
											(model.total_input_tokens || 0) +
												(model.total_output_tokens || 0);
										const successRate = Number(model.success_rate || 0);
										const percent = Math.round((requests / maxRequests) * 100);

										const successClass =
											successRate >= 95
												? "text-emerald-600"
												: successRate >= 80
													? "text-amber-500"
													: "text-red-500";
										const rankColor =
											index === 0
												? "text-indigo-600"
												: index === 1
													? "text-indigo-500"
													: index === 2
														? "text-indigo-400"
														: "text-gray-400";

										return `
                    <div class="group relative flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-gray-50/80 transition cursor-default">
                        <span class="font-mono text-[10px] ${rankColor} w-4 text-center font-semibold">${index + 1}</span>
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center justify-between mb-0.5">
                                <span class="text-xs text-gray-700 font-medium truncate" title="${model.model}">${model.model || "unknown"}</span>
                                <div class="flex items-center gap-2 ml-2">
                                    <span class="${successClass} text-[10px] font-semibold">${formatPercent(successRate)}</span>
                                    <span class="text-[10px] font-mono text-gray-500">${formatNumber(requests)}</span>
                                </div>
                            </div>
                            <div class="h-1 bg-gray-100 rounded-full overflow-hidden">
                                <div class="h-full bg-gradient-to-r from-indigo-400 to-indigo-500 rounded-full transition-all duration-500" style="width: ${percent}%"></div>
                            </div>
                        </div>
                    </div>
                    `;
									})
									.join("")}
            </div>
        `;
	} catch (e) {
		console.error("Load model stats error:", e);
	}
}

async function loadAccounts() {
	try {
		const data = await fetchApi("/api/admin/accounts");
		allAccounts = data.data || [];
		renderAccountsPage();
	} catch (e) {
		console.error(e);
	}
}

async function loadAgtAccounts() {
	if (typeof loadCliProxyAccounts === "function") {
		await loadCliProxyAccounts();
	}
}

function _loadAntigravityTemplate() {
	const template = JSON.stringify(
		{
			type: "antigravity",
			email: "user@example.com",
			project_id: "your-project-id",
			access_token: "ya29.xxxxx",
			refresh_token: "1//0gxxxxx",
			expires_in: 3599,
			expired: new Date(Date.now() + 3600 * 1000).toISOString(),
			timestamp: Date.now(),
		},
		null,
		2,
	);
	document.getElementById("antigravity-import-json").value = template;
}

async function _importAntigravityAccounts() {
	const jsonContent = document
		.getElementById("antigravity-import-json")
		.value.trim();
	if (!jsonContent) {
		showToast("请输入 Antigravity JSON 内容", "warning");
		return;
	}
	try {
		JSON.parse(jsonContent);
	} catch {
		showToast("JSON 格式错误", "error");
		return;
	}

	try {
		const result = await fetchApi("/api/admin/antigravity-accounts/import", {
			method: "POST",
			body: JSON.stringify({ raw_json: jsonContent }),
		});
		await loadAgtAccounts();
		hideModal("antigravityImportModal");
		showToast(
			`Antigravity 导入完成：成功 ${result.success}，失败 ${result.failed}`,
			result.failed > 0 ? "warning" : "success",
		);
	} catch (e) {
		showToast(`Antigravity 导入失败: ${e.message}`, "error");
	}
}

function renderAccountsPage() {
	const container = document.getElementById("accounts-table");
	selectedAccounts.clear();
	updateBatchDeleteBtn();

	if (allAccounts.length === 0) {
		container.innerHTML =
			'<div class="text-center py-12 text-gray-500">暂无账号，点击上方按钮添加</div>';
		document.getElementById("accounts-pagination").classList.add("hidden");
		return;
	}

	document.getElementById("accounts-pagination").classList.remove("hidden");

	// 分页计算
	const totalPages = Math.ceil(allAccounts.length / pageSize);
	const startIdx = (currentPage - 1) * pageSize;
	const endIdx = Math.min(startIdx + pageSize, allAccounts.length);
	const pageAccounts = allAccounts.slice(startIdx, endIdx);

	// 更新分页信息
	document.getElementById("page-start").textContent = startIdx + 1;
	document.getElementById("page-end").textContent = endIdx;
	document.getElementById("total-accounts").textContent = allAccounts.length;
	document.getElementById("prev-btn").disabled = currentPage === 1;
	document.getElementById("next-btn").disabled = currentPage === totalPages;

	// 渲染页码
	renderPageNumbers(totalPages);

	// 渲染表格
	container.innerHTML = `
                <table class="w-full">
                    <thead>
                        <tr class="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wider">
                            <th class="px-4 py-3 text-left rounded-tl-lg w-10"><input type="checkbox" id="selectAll" onchange="toggleSelectAll(this.checked)" class="rounded border-gray-300 text-blue-500 focus:ring-blue-500"></th>
                            <th class="px-4 py-3 text-left">账号信息</th>
                            <th class="px-4 py-3 text-center">状态</th>
                            <th class="px-4 py-3 text-center">额度使用</th>
                            <th class="px-4 py-3 text-center">统计 (Req/Err)</th>
                            <th class="px-4 py-3 text-center rounded-tr-lg">操作</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
                        ${pageAccounts
													.map(
														(a, i) => `
                            <tr class="hover:bg-gray-50 transition group ${i % 2 === 1 ? "bg-gray-50/50" : ""}">
                                <td class="px-4 py-4 align-middle"><input type="checkbox" data-id="${a.id}" onchange="toggleSelect('${a.id}', this.checked)" class="account-checkbox rounded border-gray-300 text-blue-500 focus:ring-blue-500"></td>
                                <td class="px-4 py-4 align-middle">
                                    <div class="flex flex-col gap-1">
                                        <div class="font-semibold text-gray-900 text-sm flex items-center gap-2">
                                            <span>${a.name}</span>
                                            ${formatSubscriptionBadge(a.subscription_type)}
                                        </div>
                                        <div class="flex items-center gap-2 flex-wrap text-xs">
                                            ${formatAuthMethodBadge(a.auth_method)}
                                            ${formatMachineIdBadge(a)}
                                            ${formatResetTimeBadge(a.next_reset)}
                                        </div>
                                        ${a.user_email ? `<div class="text-xs text-gray-400 mt-0.5 flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>${a.user_email}</div>` : ""}
                                    </div>
                                </td>
                                <td class="px-4 py-4 align-middle">
                                    <div class="flex justify-center">${formatStatus(a.status)}</div>
                                </td>
                                <td class="px-4 py-4 align-middle">
                                    <div class="flex justify-center">${formatUsage(a)}</div>
                                </td>
                                <td class="px-4 py-4 align-middle">
                                    <div class="flex flex-col items-center gap-1 text-xs">
                                        <div class="flex items-center gap-1"><span class="text-gray-500 w-8 text-right">Req:</span> <span class="font-medium text-gray-700">${a.request_count || 0}</span></div>
                                        <div class="flex items-center gap-1"><span class="text-gray-500 w-8 text-right">Err:</span> <span class="${(a.error_count || 0) > 0 ? "text-red-600 font-medium" : "text-gray-400"}">${a.error_count || 0}</span></div>
                                    </div>
                                </td>
                                <td class="px-4 py-4 align-middle">
                                    <div class="flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                                        <button onclick="refreshUsage('${a.id}')" class="p-1 text-blue-600 hover:bg-blue-50 rounded transition" title="刷新额度">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                                        </button>
                                        <button onclick="exportAccountJson('${a.id}')" class="p-1 text-purple-600 hover:bg-purple-50 rounded transition" title="导出JSON">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                                        </button>
                                        ${
																					a.status === "active"
																						? `<button onclick="disableAccount('${a.id}', this)" class="p-1 text-orange-600 hover:bg-orange-50 rounded transition" title="禁用"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg></button>`
																						: `<button onclick="enableAccount('${a.id}', this)" class="p-1 text-green-600 hover:bg-green-50 rounded transition" title="启用"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></button>`
																				}
                                        <button onclick="removeAccount('${a.id}', ${a.request_log_count || 0})" class="p-1 rounded transition ${a.has_dependencies ? "text-orange-600 hover:bg-orange-50" : "text-red-600 hover:bg-red-50"}" title="${a.has_dependencies ? `强制删除：将同时删除${a.request_log_count || 0}条请求日志` : "删除"}">
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
}

function renderPageNumbers(totalPages) {
	const container = document.getElementById("page-numbers");
	const pages = getPaginationPages(currentPage, totalPages);

	container.innerHTML = pages
		.map((p) => {
			if (p === "...") {
				return '<span class="px-3 py-1 text-gray-400">...</span>';
			}
			const isActive = p === currentPage;
			return `<button onclick="goToPage(${p})" class="px-3 py-1 rounded ${isActive ? "bg-blue-500 text-white" : "border border-gray-300 hover:bg-gray-50"} text-sm">${p}</button>`;
		})
		.join("");
}

function _changePage(direction) {
	if (direction === "prev" && currentPage > 1) {
		currentPage--;
		renderAccountsPage();
	} else if (direction === "next") {
		const totalPages = Math.ceil(allAccounts.length / pageSize);
		if (currentPage < totalPages) {
			currentPage++;
			renderAccountsPage();
		}
	}
}

function _goToPage(page) {
	currentPage = page;
	renderAccountsPage();
}

function _toggleSelect(id, checked) {
	if (checked) selectedAccounts.add(id);
	else selectedAccounts.delete(id);
	updateBatchDeleteBtn();
}

function _toggleSelectAll(checked) {
	document.querySelectorAll(".account-checkbox").forEach((cb) => {
		cb.checked = checked;
		if (checked) selectedAccounts.add(cb.dataset.id);
		else selectedAccounts.delete(cb.dataset.id);
	});
	updateBatchDeleteBtn();
}

function updateBatchDeleteBtn() {
	const btn = document.getElementById("batchDeleteBtn");
	document.getElementById("selectedCount").textContent = selectedAccounts.size;
	btn.classList.toggle("hidden", selectedAccounts.size === 0);
}

async function _batchDeleteAccounts() {
	if (selectedAccounts.size === 0) return;
	if (!confirm(`确定删除选中的 ${selectedAccounts.size} 个账号？`)) return;
	try {
		const result = await fetchApi("/api/accounts/batch", {
			method: "DELETE",
			body: JSON.stringify({ ids: Array.from(selectedAccounts) }),
		});
		showToast(`成功删除 ${result.removed} 个账号`, "success");
		refresh();
	} catch (e) {
		showToast(`批量删除失败: ${e.message}`, "error");
	}
}

async function _clearLogs() {
	if (!confirm("确定清空所有请求记录？此操作不可恢复。")) return;
	try {
		const result = await fetchApi("/api/admin/logs", { method: "DELETE" });
		loadLogs();
		loadStatus();
		showToast(result.message || "记录已清空", "success");
	} catch (e) {
		showToast(`清空失败: ${e.message}`, "error");
	}
}

function formatStatus(status) {
	const styles = {
		active: "bg-green-100 text-green-700",
		cooldown: "bg-yellow-100 text-yellow-700",
		error: "bg-red-100 text-red-700",
		depleted: "bg-orange-100 text-orange-700",
		inactive: "bg-gray-100 text-gray-700",
		disabled: "bg-gray-100 text-gray-700",
	};
	return `<span class="px-2 py-1 rounded-full text-xs font-medium ${styles[status] || styles.disabled}">${status}</span>`;
}

function _formatUserChannelBadges(channels) {
	const list =
		Array.isArray(channels) && channels.length > 0 ? channels : ["kiro"];
	return list
		.map((channel) => {
			let label, color;
			if (channel === "kiro") {
				label = "Kiro";
				color = "bg-blue-50 text-blue-700 border-blue-200";
			} else if (channel === "antigravity" || channel === "agt") {
				label = "Antigravity";
				color = "bg-purple-50 text-purple-700 border-purple-200";
			} else if (channel === "codex") {
				label = "Codex";
				color = "bg-green-50 text-green-700 border-green-200";
			} else {
				label = channel;
				color = "bg-gray-50 text-gray-700 border-gray-200";
			}
			return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${color}">${label}</span>`;
		})
		.join("");
}

function formatUsage(account) {
	if (!account) return '<span class="text-gray-400 text-sm">未知</span>';

	const used = account.current_usage || 0;
	const limit = account.usage_limit || 0;
	const available = account.available || 0;

	if (limit === 0) return '<span class="text-gray-400 text-sm">未知</span>';

	const percent = Math.round((used / limit) * 100);
	const barColor =
		percent > 90
			? "bg-red-500"
			: percent > 70
				? "bg-yellow-500"
				: "bg-green-500";
	const textColor =
		percent > 90
			? "text-red-600"
			: percent > 70
				? "text-yellow-600"
				: "text-green-600";

	// 订阅类型标签（放在名称旁边，不在这里显示）

	// 格式化重置时间
	let resetInfo = "";
	if (account.next_reset) {
		const resetDate = new Date(account.next_reset);
		const now = new Date();
		const diffDays = Math.ceil((resetDate - now) / (1000 * 60 * 60 * 24));
		if (diffDays > 0) {
			resetInfo = `<div class="text-xs text-gray-400 mt-1.5">重置: ${diffDays}天后</div>`;
		} else if (diffDays === 0) {
			resetInfo = `<div class="text-xs text-gray-400 mt-1.5">重置: 今天</div>`;
		} else {
			resetInfo = `<div class="text-xs text-red-400 mt-1.5">已过期</div>`;
		}
	}

	return `<div class="w-36">
                <div class="flex justify-between text-xs mb-1.5">
                    <span class="${textColor} font-medium">${available.toFixed(1)}</span>
                    <span class="text-gray-400">/ ${limit.toFixed(0)}</span>
                </div>
                <div class="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div class="${barColor} h-full rounded-full transition-all" style="width: ${percent}%"></div>
                </div>
                <div class="text-xs text-gray-400 mt-1">${percent}% 已用</div>
                ${resetInfo}
            </div>`;
}

function formatMachineIdBadge(account) {
	const source = account.machine_id_source || "unavailable";
	const machineId = account.machine_id || "N/A";

	// 徽章配置
	const badges = {
		explicit: {
			label: "ID: Expl",
			color: "bg-emerald-50 text-emerald-600 border-emerald-200",
			dot: "bg-emerald-400",
			title: "显式指定",
			desc: "凭据中直接提供的 machineId",
		},
		config: {
			label: "ID: Conf",
			color: "bg-sky-50 text-sky-600 border-sky-200",
			dot: "bg-sky-400",
			title: "配置指定",
			desc: "从配置文件读取的 machineId",
		},
		derived: {
			label: "ID: Auto",
			color: "bg-amber-50 text-amber-600 border-amber-200",
			dot: "bg-amber-400",
			title: "自动派生",
			desc: "从 refreshToken SHA256 派生",
		},
		unavailable: {
			label: "ID: None",
			color: "bg-slate-50 text-slate-500 border-slate-200",
			dot: "bg-slate-300",
			title: "缺失",
			desc: "无法获取或生成 machineId",
		},
	};

	const badge = badges[source] || badges.unavailable;

	return `
                <div class="relative inline-block" onmouseleave="hideMachineIdTooltip()">
                    <span 
                        onmouseenter="showMachineIdTooltip(event, '${machineId}', '${source}', '${badge.title}', '${badge.desc}')"
                        class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${badge.color} cursor-help transition hover:shadow-sm">
                        <span class="w-1.5 h-1.5 rounded-full ${badge.dot}"></span>
                        ${badge.label}
                    </span>
                </div>
            `;
}

function formatAuthMethodBadge(authMethod) {
	const method = (authMethod || "social").toLowerCase();

	const badges = {
		social: {
			label: "Google",
			icon: '<svg class="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>',
			color: "bg-white text-gray-600 border-gray-200",
		},
		idc: {
			label: "BuilderID",
			icon: '<svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>',
			color: "bg-violet-50 text-violet-600 border-violet-200",
		},
	};

	const badge = badges[method] || badges.social;

	return `
                <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${badge.color}" title="${badge.label} 认证">
                    ${badge.icon}
                    <span>${badge.label}</span>
                </span>
            `;
}

function formatResetTimeBadge(nextReset) {
	if (!nextReset) return "";

	const resetDate = new Date(nextReset);
	const now = new Date();
	const diffMs = resetDate - now;

	// Calculate days and hours
	const dayMs = 1000 * 60 * 60 * 24;
	const hourMs = 1000 * 60 * 60;

	const diffDays = Math.floor(diffMs / dayMs);
	const diffHours = Math.ceil((diffMs % dayMs) / hourMs);

	let label, color;

	if (diffMs < 0) {
		label = "已过期";
		color = "bg-red-50 text-red-700 border-red-200";
	} else if (diffDays === 0) {
		label = `${Math.max(1, Math.ceil(diffMs / hourMs))}小时后`;
		color = "bg-orange-50 text-orange-700 border-orange-200";
	} else if (diffDays < 3) {
		label = `${diffDays}天 ${diffHours}小时`;
		color = "bg-yellow-50 text-yellow-700 border-yellow-200";
	} else {
		label = `${diffDays}天 ${diffHours}小时`;
		color = "bg-green-50 text-green-700 border-green-200";
	}

	return `
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${color}" title="重置时间: ${resetDate.toLocaleString("zh-CN")}">
                    <span>${label}</span>
                </span>
            `;
}

function _copyMachineId(machineId, event) {
	event.stopPropagation();
	navigator.clipboard
		.writeText(machineId)
		.then(() => {
			showToast("Machine ID 已复制", "success");
		})
		.catch(() => {
			showToast("复制失败", "error");
		});
}

function formatSubscriptionBadge(subscriptionType) {
	if (!subscriptionType) {
		return '<span class="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium leading-none bg-gray-100 text-gray-500 border border-gray-200">Free</span>';
	}

	const tier = subscriptionType.toLowerCase();

	const badges = {
		free: {
			label: "Free",
			color: "bg-gray-100 text-gray-600 border-gray-200",
		},
		pro: {
			label: "Pro",
			color:
				"bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 border-blue-200",
		},
		proplus: {
			label: "Pro+",
			color:
				"bg-gradient-to-r from-purple-50 to-pink-50 text-purple-700 border-purple-200",
		},
		power: {
			label: "Power",
			color:
				"bg-gradient-to-r from-amber-50 to-orange-50 text-amber-700 border-amber-200",
		},
	};

	if (tier.includes("pro_plus") || tier.includes("proplus")) {
		return `<span class="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium leading-none border ${badges.proplus.color}">${badges.proplus.label}</span>`;
	}
	if (tier.includes("pro")) {
		return `<span class="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium leading-none border ${badges.pro.color}">${badges.pro.label}</span>`;
	}
	if (tier.includes("free")) {
		return `<span class="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium leading-none border ${badges.free.color}">${badges.free.label}</span>`;
	}

	return `<span class="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium leading-none border ${badges.free.color}">${badges.free.label}</span>`;
}

async function _refreshUsage(id) {
	try {
		const response = await fetchApi(`/api/admin/accounts/${id}/refresh-usage`, {
			method: "POST",
		});

		if (response.data) {
			const { usage, status } = response.data;
			const available = usage?.available || 0;
			const usageLimit = usage?.usageLimit || 0;

			let message = "刷新成功";
			let type = "success";

			if (status === "depleted") {
				message = `余额不足 (${available}/${usageLimit})，账号已标记为 depleted`;
				type = "warning";
			} else if (status === "error") {
				message = `账号异常，已标记为 error`;
				type = "error";
			} else if (available >= 5) {
				message = `余额充足 (${available}/${usageLimit})`;
			}

			showToast(message, type);
			await loadAccounts();
			await loadStatus();
		}
	} catch (e) {
		showToast(`刷新失败: ${e.message}`, "error");
	}
}

async function _refreshAllUsage() {
	try {
		showToast("正在刷新所有账号，请稍候...", "info");

		// 设置较长的超时时间（2分钟）
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 120000);

		const response = await fetch("/api/admin/accounts/refresh-all-usage", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": token,
			},
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error?.message || response.statusText);
		}

		const data = await response.json();
		loadAccounts();

		// 统计成功和失败的数量
		const successCount = data.data.filter(
			(r) => r.usage && !r.usage.error,
		).length;
		const failCount = data.data.filter((r) => r.usage?.error).length;

		showToast(`刷新完成！成功: ${successCount}, 失败: ${failCount}`, "success");
	} catch (e) {
		if (e.name === "AbortError") {
			showToast("刷新超时，请稍后重试", "error");
		} else {
			showToast(`刷新失败: ${e.message}`, "error");
		}
	}
}

async function _loadStrategy() {
	try {
		const data = await fetchApi("/api/strategy");
		document.getElementById("strategy").value = data.strategy;
	} catch (e) {
		console.error(e);
	}
}

async function _setStrategy(value) {
	try {
		await fetchApi("/api/strategy", {
			method: "POST",
			body: JSON.stringify({ strategy: value }),
		});
		showToast("策略已更新", "success");
	} catch (e) {
		showToast(`设置失败: ${e.message}`, "error");
	}
}

function _switchTab(tab) {
	document.querySelectorAll(".tab-btn").forEach((t) => {
		t.classList.remove("border-blue-500", "text-blue-600");
		t.classList.add("border-transparent", "text-gray-500");
	});
	document
		.querySelector(`.tab-btn[data-tab="${tab}"]`)
		.classList.remove("border-transparent", "text-gray-500");
	document
		.querySelector(`.tab-btn[data-tab="${tab}"]`)
		.classList.add("border-blue-500", "text-blue-600");
	document.querySelectorAll(".tab-content").forEach((c) => {
		c.classList.add("hidden");
	});
	document.getElementById(`tab-${tab}`).classList.remove("hidden");
	if (tab === "users") loadUsers();
	if (tab === "accounts") loadAccounts();
	if (tab === "antigravity-accounts") {
		// 只在没有缓存数据时才加载
		if (cliproxyAntigravityAccounts.length === 0) {
			loadCliProxyAccounts();
		} else {
			renderCliProxyAccounts();
		}
	}
	if (tab === "logs") {
		if (typeof initLogFilterEvents === "function") {
			initLogFilterEvents();
		}
		loadLogs();
		const toggle = document.getElementById("autoRefreshToggle");
		if (toggle?.checked && !autoRefreshInterval) {
			autoRefreshInterval = setInterval(() => {
				loadLogs();
			}, 10000);
		}
	} else {
		if (autoRefreshInterval) {
			clearInterval(autoRefreshInterval);
			autoRefreshInterval = null;
		}
	}
	if (tab === "settings") {
		document.getElementById("baseUrl").textContent = location.origin;
	}
}

function _showModal(id) {
	if (id === "importModal") resetImportResultView(false);
	document.getElementById(id).classList.remove("hidden");
}

function hideModal(id) {
	document.getElementById(id).classList.add("hidden");
	if (id === "importModal") resetImportResultView(true);
}
function _toggleIdcFields() {
	document
		.getElementById("idc-fields")
		.classList.toggle(
			"hidden",
			document.getElementById("acc-auth").value !== "idc",
		);
}

async function _addAccount() {
	const data = {
		name: document.getElementById("acc-name").value || "未命名账号",
		auth_method: document.getElementById("acc-auth").value,
		refresh_token: document.getElementById("acc-refresh").value,
		client_id: document.getElementById("acc-client-id").value || null,
		client_secret: document.getElementById("acc-client-secret").value || null,
	};
	if (!data.refresh_token) {
		showToast("请填写 Refresh Token", "warning");
		return;
	}
	try {
		await fetchApi("/api/accounts", {
			method: "POST",
			body: JSON.stringify(data),
		});
		hideModal("addModal");
		refresh();
		showToast("添加成功", "success");
	} catch (e) {
		showToast(`添加失败: ${e.message}`, "error");
	}
}

function renderImportTypeBadge(type) {
	if (type === "IdC/BuilderId/Enterprise") {
		return '<span class="px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">IdC/BuilderId/Enterprise</span>';
	}
	return '<span class="px-2.5 py-1 rounded-full text-xs font-medium bg-sky-100 text-sky-700">Social</span>';
}

function resetImportResultView(clearInput) {
	const inputSection = document.getElementById("import-input-section");
	const resultSection = document.getElementById("import-result-section");
	const submitBtn = document.getElementById("import-submit-btn");
	const resetBtn = document.getElementById("import-reset-btn");
	const failedBlock = document.getElementById("import-failed-block");

	if (inputSection) inputSection.classList.remove("hidden");
	if (resultSection) resultSection.classList.add("hidden");
	if (failedBlock) failedBlock.classList.add("hidden");
	if (submitBtn) {
		submitBtn.disabled = false;
		submitBtn.innerHTML =
			'<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>开始导入';
	}
	if (resetBtn) resetBtn.classList.add("hidden");

	if (clearInput) {
		const input = document.getElementById("import-json");
		const fileName = document.getElementById("file-name");
		if (input) input.value = "";
		if (fileName) fileName.textContent = "";
	}
}

function renderImportResult(result) {
	const rows = Array.isArray(result.results) ? result.results : [];
	const successRows = rows.filter((item) => item.success);
	const failedRows = rows.filter((item) => !item.success);

	const idcCount = successRows.filter(
		(item) => item.type === "IdC/BuilderId/Enterprise",
	).length;
	const socialCount = successRows.filter(
		(item) => item.type === "Social",
	).length;

	document.getElementById("import-total-count").textContent =
		result.total || rows.length;
	document.getElementById("import-success-count").textContent =
		result.success || successRows.length;
	document.getElementById("import-failed-count").textContent =
		result.failed || failedRows.length;
	document.getElementById("import-idc-count").textContent = idcCount;
	document.getElementById("import-social-count").textContent = socialCount;

	const statusBadge = document.getElementById("import-result-status");
	if ((result.failed || failedRows.length) > 0) {
		statusBadge.className =
			"px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700";
		statusBadge.textContent = "部分失败";
	} else {
		statusBadge.className =
			"px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700";
		statusBadge.textContent = "全部成功";
	}

	const successList = document.getElementById("import-success-list");
	if (successRows.length === 0) {
		successList.innerHTML =
			'<div class="text-sm text-gray-500">没有成功导入的账号</div>';
	} else {
		successList.innerHTML = successRows
			.map((item) => {
				const name = escapeHtml(item.name || "未命名账号");
				const type =
					item.type === "IdC/BuilderId/Enterprise"
						? "IdC/BuilderId/Enterprise"
						: "Social";
				return `<div class="flex items-center justify-between gap-3 border border-gray-100 rounded-lg px-3 py-2"><span class="text-gray-800 break-all">${name}</span>${renderImportTypeBadge(type)}</div>`;
			})
			.join("");
	}

	const failedBlock = document.getElementById("import-failed-block");
	const failedList = document.getElementById("import-failed-list");
	if (failedRows.length > 0) {
		failedBlock.classList.remove("hidden");
		failedList.innerHTML = failedRows
			.map((item) => {
				const name = escapeHtml(item.name || "未命名账号");
				const error = escapeHtml(item.error || "未知错误");
				return `<div class="bg-white border border-red-100 rounded-lg px-3 py-2"><div class="font-medium text-red-700 break-all">${name}</div><div class="text-xs text-red-500 mt-1 break-all">${error}</div></div>`;
			})
			.join("");
	} else {
		failedBlock.classList.add("hidden");
		failedList.innerHTML = "";
	}

	document.getElementById("import-input-section").classList.add("hidden");
	document.getElementById("import-result-section").classList.remove("hidden");
	document.getElementById("import-result-section").classList.remove("hidden");
	document.getElementById("import-reset-btn").classList.remove("hidden");
}

// ---------------------------------------------------------------------
// Utility: Universal Clipboard Copy
// ---------------------------------------------------------------------
function copyToClipboard(text, successMessage = "已复制") {
	if (!text) return;

	// Fallback first approach for better compatibility in mixed contexts
	const textArea = document.createElement("textarea");
	textArea.value = text;
	textArea.style.position = "fixed";
	textArea.style.left = "-9999px";
	textArea.style.top = "0";
	document.body.appendChild(textArea);
	textArea.focus();
	textArea.select();

	try {
		const successful = document.execCommand("copy");
		if (successful) {
			showToast(successMessage, "success");
		} else {
			// Try navigator if execCommand fails
			if (navigator.clipboard) {
				navigator.clipboard
					.writeText(text)
					.then(() => showToast(successMessage, "success"))
					.catch(() => showToast("复制失败，请手动复制", "error"));
			} else {
				showToast("复制失败，请手动复制", "error");
			}
		}
	} catch (err) {
		console.error("Fallback copy failed:", err);
		showToast("复制失败，请手动复制", "error");
	}

	document.body.removeChild(textArea);
}

function escapeJsString(value) {
	return String(value ?? "")
		.replace(/\\/g, "\\\\")
		.replace(/'/g, "\\'")
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r");
}

// Backward compatibility wrapper
function copyText(text) {
	copyToClipboard(text);
}

// ---------------------------------------------------------------------
// Model Management: Fetch & Refresh
// ---------------------------------------------------------------------

async function _fetchKiroModels() {
	const btn = event.currentTarget;
	const originalHtml = btn.innerHTML;

	try {
		btn.disabled = true;
		btn.innerHTML =
			'<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> 获取中...';

		const result = await fetchApi(
			"/api/admin/settings/fetch-models?channel=kiro",
		);

		if (result.models && result.models.length > 0) {
			renderModelList(
				"kiro-models-list",
				result.models,
				"bg-blue-50/60 text-blue-700 hover:bg-blue-100 hover:text-blue-800 border border-blue-200/50 hover:border-blue-300 rounded-md shadow-sm hover:shadow transition-all",
			);
			showToast(`成功获取 ${result.models.length} 个 Kiro 模型`, "success");
		} else {
			showToast("未找到 Kiro 模型", "info");
		}
	} catch (e) {
		showToast(`获取 Kiro 模型失败: ${e.message}`, "error");
	} finally {
		btn.disabled = false;
		btn.innerHTML = originalHtml;
	}
}

async function _fetchCliProxyModels(provider) {
	const btn = event.currentTarget;
	const originalHtml = btn.innerHTML;
	const colorConfig =
		provider === "codex"
			? {
					bg: "bg-green-50/60",
					text: "text-green-700",
					hoverBg: "hover:bg-green-100",
					hoverText: "hover:text-green-800",
					border: "border-green-200/50",
					hoverBorder: "hover:border-green-300",
				}
			: {
					bg: "bg-purple-50/60",
					text: "text-purple-700",
					hoverBg: "hover:bg-purple-100",
					hoverText: "hover:text-purple-800",
					border: "border-purple-200/50",
					hoverBorder: "hover:border-purple-300",
				};
	const bgClass = `${colorConfig.bg} ${colorConfig.text} ${colorConfig.hoverBg} ${colorConfig.hoverText} ${colorConfig.border} ${colorConfig.hoverBorder} rounded-md shadow-sm hover:shadow transition-all`;
	const listId =
		provider === "codex" ? "codex-models-list" : "antigravity-models-list";

	try {
		btn.disabled = true;
		btn.innerHTML = `<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> 获取中...`;

		const result = await fetchApi(
			`/api/admin/settings/fetch-models?channel=cliproxy&provider=${provider}`,
		);

		if (result.models && result.models.length > 0) {
			renderModelList(listId, result.models, bgClass);
			showToast(
				`成功获取 ${result.models.length} 个 ${provider} 模型`,
				"success",
			);
		} else {
			showToast(`未找到 ${provider} 模型`, "info");
		}
	} catch (e) {
		showToast(`获取 ${provider} 模型失败: ${e.message}`, "error");
	} finally {
		btn.disabled = false;
		btn.innerHTML = originalHtml;
	}
}

function renderModelList(containerId, models, styleClass) {
	const container = document.getElementById(containerId);
	if (!container) return;

	const html = models
		.map((m) => {
			const id = typeof m === "string" ? m : m.id || m.name;
			const safeId = escapeJsString(id);
			return `<span onclick="copyToClipboard('${safeId}', '模型ID已复制')" class="inline-flex items-center px-2.5 py-1 text-[11px] font-medium font-mono cursor-pointer transition ${styleClass}">${id}</span>`;
		})
		.join("");

	container.innerHTML = html;
}

async function loadSettings() {
	try {
		const result = await fetchApi("/api/admin/settings");
		const settings = result?.data || {};

		const parsedKiroModels = JSON.parse(settings.models_kiro || "[]");
		if (Array.isArray(parsedKiroModels) && parsedKiroModels.length > 0) {
			renderModelList(
				"kiro-models-list",
				parsedKiroModels,
				"bg-blue-50/60 text-blue-700 hover:bg-blue-100 hover:text-blue-800 border border-blue-200/50 hover:border-blue-300 rounded-md shadow-sm hover:shadow transition-all",
			);
		}

		const parsedAntigravityModels = JSON.parse(
			settings.models_cliproxy_antigravity || "[]",
		);
		if (
			Array.isArray(parsedAntigravityModels) &&
			parsedAntigravityModels.length > 0
		) {
			renderModelList(
				"antigravity-models-list",
				parsedAntigravityModels,
				"bg-purple-50/60 text-purple-700 hover:bg-purple-100 hover:text-purple-800 border border-purple-200/50 hover:border-purple-300 rounded-md shadow-sm hover:shadow transition-all",
			);
		}

		const parsedCodexModels = JSON.parse(
			settings.models_cliproxy_codex || "[]",
		);
		if (Array.isArray(parsedCodexModels) && parsedCodexModels.length > 0) {
			renderModelList(
				"codex-models-list",
				parsedCodexModels,
				"bg-green-50/60 text-green-700 hover:bg-green-100 hover:text-green-800 border border-green-200/50 hover:border-green-300 rounded-md shadow-sm hover:shadow transition-all",
			);
		}
	} catch (e) {
		console.error("Load settings error:", e);
	}
}

async function _importAccounts() {
	const jsonContent = document.getElementById("import-json").value.trim();
	if (!jsonContent) {
		showToast("请选择文件或粘贴 JSON 内容", "warning");
		return;
	}
	try {
		JSON.parse(jsonContent);
	} catch {
		showToast("JSON 格式错误", "error");
		return;
	}

	const submitBtn = document.getElementById("import-submit-btn");
	submitBtn.disabled = true;
	submitBtn.innerHTML =
		'<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>导入中...';

	try {
		const result = await fetchApi("/api/admin/accounts/import", {
			method: "POST",
			body: JSON.stringify({ raw_json: jsonContent }),
		});
		await loadAccounts();
		await loadStatus();
		renderImportResult(result);
		showToast(
			`导入完成！成功: ${result.success} 个，失败: ${result.failed} 个`,
			result.failed > 0 ? "warning" : "success",
		);
	} catch (e) {
		showToast(`导入失败: ${e.message}`, "error");
	} finally {
		submitBtn.disabled = false;
		submitBtn.innerHTML =
			'<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>开始导入';
	}
}

function _handleFileSelect(event) {
	const file = event.target.files[0];
	if (!file) return;
	document.getElementById("file-name").textContent = `已选择: ${file.name}`;
	const reader = new FileReader();
	reader.onload = (e) => {
		document.getElementById("import-json").value = e.target.result;
	};
	reader.readAsText(file);
}

function _loadTemplate(type) {
	let template;
	if (type === "social") {
		template = JSON.stringify(
			[
				{
					name: "Google账号示例",
					refreshToken: "aor_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
					authMethod: "social",
					provider: "Google",
				},
			],
			null,
			2,
		);
	} else if (type === "builderid") {
		template = JSON.stringify(
			[
				{
					name: "BuilderId账号示例",
					refreshToken: "aor_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
					authMethod: "idc",
					clientId: "your-client-id",
					clientSecret: "your-client-secret",
					region: "us-east-1",
					provider: "BuilderId",
				},
			],
			null,
			2,
		);
	} else if (type === "enterprise") {
		template = JSON.stringify(
			[
				{
					name: "Enterprise账号示例",
					refreshToken: "aor_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
					authMethod: "idc",
					clientId: "your-client-id",
					clientSecret: "your-client-secret",
					region: "us-east-1",
					provider: "Enterprise",
				},
			],
			null,
			2,
		);
	}
	document.getElementById("import-json").value = template;
	showToast("模板已加载，请替换示例数据", "info");
}

async function _removeAccount(id, dependencyCount = 0) {
	let force = false;
	if (dependencyCount > 0) {
		const confirmed = confirm(
			`该账号存在 ${dependencyCount} 条请求日志。\n\n强制删除将同时删除这些日志，且不可恢复。\n\n确认强制删除？`,
		);
		if (!confirmed) return;
		force = true;
	} else {
		if (!confirm("确定删除此账号？")) return;
	}

	try {
		const url = force
			? `/api/admin/accounts/${id}?force=true`
			: `/api/admin/accounts/${id}`;
		const result = await fetchApi(url, { method: "DELETE" });
		refresh();
		if (force) {
			const deletedLogs = result?.data?.deletedLogs ?? dependencyCount;
			showToast(`账号已强制删除，并清理 ${deletedLogs} 条请求日志`, "warning");
		} else {
			showToast("账号已删除", "success");
		}
	} catch (e) {
		if (e.status === 409) {
			const depCount = e.payload?.error?.dependencyCount;
			if (depCount !== undefined) {
				showToast(
					`无法删除：存在 ${depCount} 条请求日志，请改用“禁用”`,
					"warning",
				);
			} else {
				showToast("无法删除：账号存在关联数据，请改用“禁用”", "warning");
			}
			return;
		}
		showToast(`删除失败: ${e.message}`, "error");
	}
}

async function _enableAccount(id, buttonEl = null) {
	const originalHtml = buttonEl ? buttonEl.innerHTML : "";
	try {
		if (buttonEl) {
			buttonEl.disabled = true;
			buttonEl.classList.add("opacity-60", "cursor-wait");
			buttonEl.innerHTML =
				'<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"></path></svg>';
		}
		await fetchApi(`/api/admin/accounts/${id}/enable`, { method: "POST" });
		const target = allAccounts.find((a) => a.id === id);
		if (target) {
			target.status = "active";
			renderAccountsPage();
		}
		loadStatus();
		showToast("账号已启用", "success");
	} catch (e) {
		showToast(`启用失败: ${e.message}`, "error");
	} finally {
		if (buttonEl) {
			buttonEl.disabled = false;
			buttonEl.classList.remove("opacity-60", "cursor-wait");
			buttonEl.innerHTML = originalHtml;
		}
	}
}

async function _disableAccount(id, buttonEl = null) {
	if (!confirm("确定禁用此账号？")) return;
	const originalHtml = buttonEl ? buttonEl.innerHTML : "";
	try {
		if (buttonEl) {
			buttonEl.disabled = true;
			buttonEl.classList.add("opacity-60", "cursor-wait");
			buttonEl.innerHTML =
				'<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"></path></svg>';
		}
		await fetchApi(`/api/admin/accounts/${id}/disable`, { method: "POST" });
		const target = allAccounts.find((a) => a.id === id);
		if (target) {
			target.status = "disabled";
			renderAccountsPage();
		}
		loadStatus();
		showToast("账号已禁用", "warning");
	} catch (e) {
		showToast(`禁用失败: ${e.message}`, "error");
	} finally {
		if (buttonEl) {
			buttonEl.disabled = false;
			buttonEl.classList.remove("opacity-60", "cursor-wait");
			buttonEl.innerHTML = originalHtml;
		}
	}
}

function _exportAccountJson(id) {
	const account = allAccounts.find((a) => a.id === id);
	if (!account) {
		showToast("账号不存在", "error");
		return;
	}

	// 构建导出的 JSON 对象（与导入格式一致）
	const exportData = {
		name: account.name,
		refreshToken: account.refresh_token,
		authMethod: account.auth_method,
	};

	// 如果是 IdC 账号，添加额外字段
	if (account.auth_method === "idc") {
		exportData.clientId = account.client_id;
		exportData.clientSecret = account.client_secret;
		exportData.region = account.region || "us-east-1";
	}

	// 添加 provider 字段（必需）
	// 根据 authMethod 推断 provider
	if (account.auth_method === "social") {
		// Social 账号默认为 Google，可以根据 user_email 判断
		exportData.provider = "Google";
	} else {
		// IdC 账号默认为 BuilderId
		exportData.provider = "BuilderId";
	}

	const jsonStr = JSON.stringify(exportData, null, 2);
	copyText(jsonStr);
}

async function loadApiKeys() {
	try {
		const keys = await fetchApi("/api/settings/api-keys");
		const container = document.getElementById("api-keys-list");
		if (!keys || keys.length === 0) {
			container.innerHTML = '<div class="text-gray-500">暂无 API 密钥</div>';
			return;
		}
		container.innerHTML = `<table class="w-full"><thead><tr class="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"><th class="px-4 py-3 rounded-tl-lg">密钥</th><th class="px-4 py-3 rounded-tr-lg">操作</th></tr></thead><tbody class="divide-y divide-gray-100">${keys.map((k) => `<tr class="hover:bg-gray-50 transition"><td class="px-4 py-3 font-mono text-sm text-gray-900">${escapeHtml(k.key)}</td><td class="px-4 py-3"><button onclick="copyText('${escapeHtml(k.key)}')" class="text-blue-500 hover:text-blue-700 text-sm font-medium mr-3">复制</button><button onclick="removeApiKey('${escapeHtml(k.key)}')" class="text-red-500 hover:text-red-700 text-sm font-medium">删除</button></td></tr>`).join("")}</tbody></table>`;
	} catch (e) {
		console.error(e);
	}
}

async function _addApiKey() {
	const newKey = document.getElementById("new-api-key").value.trim();
	if (!newKey) {
		showToast("请输入 API 密钥", "warning");
		return;
	}
	if (newKey.length < 6) {
		showToast("密钥长度至少 6 位", "warning");
		return;
	}
	try {
		await fetchApi("/api/settings/api-keys", {
			method: "POST",
			body: JSON.stringify({ key: newKey }),
		});
		document.getElementById("new-api-key").value = "";
		loadApiKeys();
		showToast("添加成功", "success");
	} catch (e) {
		showToast(`添加失败: ${e.message}`, "error");
	}
}

async function _removeApiKey(key) {
	if (!confirm("确定删除此 API 密钥？")) return;
	try {
		await fetchApi("/api/settings/api-keys", {
			method: "DELETE",
			body: JSON.stringify({ key }),
		});
		loadApiKeys();
		showToast("删除成功", "success");
	} catch (e) {
		showToast(`删除失败: ${e.message}`, "error");
	}
}

async function _showModelCooldownConfig() {
	try {
		const [modelsResponse, configResponse] = await Promise.all([
			fetchApi("/api/admin/accounts/models"),
			fetchApi("/api/admin/settings/model-cooldown-config"),
		]);

		const models = modelsResponse.models || [];
		const config = configResponse.config || {};

		if (models.length === 0) {
			showToast("未找到支持的模型", "warning");
			return;
		}

		const modal = document.createElement("div");
		modal.id = "modelCooldownModal";
		modal.className =
			"fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn";

		const selectedModels = new Set(
			Object.entries(config)
				.filter(([, cfg]) => cfg.enabled)
				.map(([id]) => id),
		);

		const _defaultThreshold = 3;
		const _defaultDuration = 15;

		modal.innerHTML = `
			<div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl mx-4 max-h-[90vh] flex flex-col animate-scaleIn">
				<!-- Header -->
				<div class="flex items-center justify-between p-6 border-b border-gray-100">
					<div>
						<h3 class="text-xl font-semibold text-gray-900">模型冷却配置</h3>
						<p class="text-sm text-gray-500 mt-1">选中模型后，当连续失败达到阈值时将自动进入冷却期</p>
					</div>
					<button onclick="document.getElementById('modelCooldownModal').remove()" 
						class="text-gray-400 hover:text-gray-600 transition p-2 hover:bg-gray-100 rounded-lg">
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				<!-- Content -->
				<div class="flex-1 overflow-hidden flex">
					<!-- Left: Model Selection -->
					<div class="w-1/2 border-r border-gray-100 overflow-y-auto p-6">
						<div class="flex items-center justify-between mb-4">
							<h4 class="text-sm font-semibold text-gray-700 uppercase tracking-wide">选择模型</h4>
							<span class="text-xs text-gray-500" id="selected-count">${selectedModels.size} 个已选</span>
						</div>
						<div class="space-y-2" id="model-list">
							${models
								.map((model) => {
									const isSelected = selectedModels.has(model.id);
									return `
									<label class="flex items-center p-3 rounded-lg border-2 transition cursor-pointer hover:bg-blue-50 ${isSelected ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-300"}">
										<input type="checkbox" 
											class="model-checkbox w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 focus:ring-offset-0" 
											data-model-id="${model.id}"
											data-model-name="${model.display_name || model.id}"
											${isSelected ? "checked" : ""}
											onchange="updateCooldownConfigPreview()">
										<div class="ml-3 flex-1">
											<div class="text-sm font-medium text-gray-900">${model.display_name || model.id}</div>
											<div class="text-xs text-gray-500">${model.id}</div>
										</div>
									</label>
								`;
								})
								.join("")}
						</div>
					</div>

					<!-- Right: Configuration Panel -->
					<div class="w-1/2 overflow-y-auto p-6 bg-gray-50">
						<div id="config-panel">
							<!-- Will be populated by updateCooldownConfigPreview() -->
						</div>
					</div>
				</div>

				<!-- Footer -->
				<div class="flex items-center justify-end gap-3 p-6 border-t border-gray-100 bg-gray-50">
					<button onclick="document.getElementById('modelCooldownModal').remove()" 
						class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition font-medium">
						取消
					</button>
					<button onclick="saveModelCooldownConfigFromModal()" 
						class="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium shadow-lg shadow-blue-500/30">
						保存配置
					</button>
				</div>
			</div>
		`;

		document.body.appendChild(modal);
		updateCooldownConfigPreview();
	} catch (e) {
		console.warn("Failed to load model cooldown config:", e);
	}
}

function updateCooldownConfigPreview() {
	const checkboxes = document.querySelectorAll(".model-checkbox:checked");
	const count = checkboxes.length;
	const countEl = document.getElementById("selected-count");
	const panel = document.getElementById("config-panel");

	if (countEl) {
		countEl.textContent = `${count} 个已选`;
	}

	if (count === 0) {
		panel.innerHTML = `
			<div class="flex flex-col items-center justify-center h-full text-center py-12">
				<svg class="w-16 h-16 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
				</svg>
				<p class="text-gray-500 text-sm">请先选择要配置的模型</p>
			</div>
		`;
	} else {
		const _modelNames = Array.from(checkboxes)
			.map((cb) => cb.dataset.modelName)
			.join("、");
		panel.innerHTML = `
			<div class="space-y-6">
				<div class="bg-white rounded-lg p-4 border border-gray-200">
					<h4 class="text-sm font-semibold text-gray-700 mb-3">已选择的模型</h4>
					<div class="flex flex-wrap gap-2">
						${Array.from(checkboxes)
							.map(
								(cb) => `
							<span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
								${cb.dataset.modelName}
							</span>
						`,
							)
							.join("")}
					</div>
				</div>

				<div class="bg-white rounded-lg p-4 border border-gray-200">
					<h4 class="text-sm font-semibold text-gray-700 mb-4">冷却配置</h4>
					
					<div class="space-y-4">
						<div>
							<label class="block text-sm font-medium text-gray-700 mb-2">
								失败阈值
								<span class="text-gray-400 font-normal ml-1">(连续失败次数)</span>
							</label>
							<div class="flex items-center gap-3">
								<input type="range" id="threshold-slider" min="1" max="10" value="3" 
									class="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
									oninput="document.getElementById('threshold-value').textContent = this.value">
								<span id="threshold-value" class="text-2xl font-bold text-blue-600 w-12 text-center">3</span>
								<span class="text-sm text-gray-500">次</span>
							</div>
							<p class="text-xs text-gray-500 mt-2">当模型连续失败达到此次数时，将进入冷却期</p>
						</div>

						<div>
							<label class="block text-sm font-medium text-gray-700 mb-2">
								冷却时长
								<span class="text-gray-400 font-normal ml-1">(分钟)</span>
							</label>
							<div class="flex items-center gap-3">
								<input type="range" id="duration-slider" min="5" max="60" step="5" value="15" 
									class="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
									oninput="document.getElementById('duration-value').textContent = this.value">
								<span id="duration-value" class="text-2xl font-bold text-blue-600 w-12 text-center">15</span>
								<span class="text-sm text-gray-500">分钟</span>
							</div>
							<p class="text-xs text-gray-500 mt-2">冷却期内，请求将自动 fallback 到其他渠道</p>
						</div>
					</div>
				</div>

				<div class="bg-amber-50 border border-amber-200 rounded-lg p-4">
					<div class="flex gap-3">
						<svg class="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						<div class="text-sm text-amber-800">
							<p class="font-medium mb-1">配置说明</p>
							<p>以上配置将应用到所有选中的 ${count} 个模型。如需为不同模型设置不同参数，请分批配置。</p>
						</div>
					</div>
				</div>
			</div>
		`;
	}
}

async function _saveModelCooldownConfigFromModal() {
	try {
		const checkboxes = document.querySelectorAll(".model-checkbox");
		const threshold = parseInt(
			document.getElementById("threshold-slider")?.value || 3,
			10,
		);
		const duration = parseInt(
			document.getElementById("duration-slider")?.value || 15,
			10,
		);

		const config = {};
		checkboxes.forEach((checkbox) => {
			const modelId = checkbox.dataset.modelId;
			config[modelId] = {
				enabled: checkbox.checked,
				threshold: checkbox.checked ? threshold : 3,
				duration: checkbox.checked ? duration : 15,
			};
		});

		await fetchApi("/api/admin/settings/model-cooldown-config", {
			method: "POST",
			body: JSON.stringify({ config }),
		});

		document.getElementById("modelCooldownModal").remove();
		showToast("配置保存成功", "success");
	} catch (e) {
		showToast(`保存配置失败: ${e.message}`, "error");
	}
}

async function refresh() {
	loadStatus();
	loadUsers();
	loadAccounts();
	loadSettings();
}

// 导出到全局作用域
window.showMainPanel = _showMainPanel;
window.loadWeeklyChart = _loadWeeklyChart;
window.loadAntigravityTemplate = _loadAntigravityTemplate;
window.importAntigravityAccounts = _importAntigravityAccounts;
window.changePage = _changePage;
window.goToPage = _goToPage;
window.toggleSelect = _toggleSelect;
window.toggleSelectAll = _toggleSelectAll;
window.batchDeleteAccounts = _batchDeleteAccounts;
window.clearLogs = _clearLogs;
window.saveModelCooldownConfigFromModal = _saveModelCooldownConfigFromModal;
window.switchTab = _switchTab;
window.showModal = _showModal;
window.hideModal = hideModal;
window.copyToClipboard = copyToClipboard;
window.fetchKiroModels = _fetchKiroModels;
window.fetchCliProxyModels = _fetchCliProxyModels;
window.showModelCooldownConfig = _showModelCooldownConfig;
window.formatUserChannelBadges = _formatUserChannelBadges;
window.refreshUsage = _refreshUsage;
window.disableAccount = _disableAccount;
window.enableAccount = _enableAccount;
window.removeAccount = _removeAccount;
window.exportAccountJson = _exportAccountJson;
