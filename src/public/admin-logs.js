let logsCurrentPage = 1;
const logsPageSize = 50;
let totalLogs = 0;
let currentFilters = {
	timeRange: "24h",
	userId: "",
	model: "",
	success: "",
};

function formatDuration(ms) {
	if (!ms) return "0s";
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60000);
	const seconds = Math.floor((ms % 60000) / 1000);
	return `${minutes}m ${seconds}s`;
}

function _toggleAutoRefresh() {
	const toggle = document.getElementById("autoRefreshToggle");
	if (toggle.checked) {
		autoRefreshInterval = setInterval(() => {
			loadLogs();
		}, 10000);
		showToast("已开启自动刷新", "success");
	} else {
		if (autoRefreshInterval) {
			clearInterval(autoRefreshInterval);
			autoRefreshInterval = null;
		}
		showToast("已关闭自动刷新", "info");
	}
}

function _applyLogFilters() {
	const timeRange = document.getElementById("log-time-range").value;
	const userFilter = document.getElementById("log-user-filter").value.trim();
	const modelFilter = document.getElementById("log-model-filter").value.trim();
	const statusFilter = document.getElementById("log-status-filter").value;

	currentFilters = {
		timeRange,
		userId: userFilter,
		model: modelFilter,
		success: statusFilter,
	};

	logsCurrentPage = 1;
	loadLogs();
}

function _clearLogFilters() {
	document.getElementById("log-time-range").value = "24h";
	document.getElementById("log-user-filter").value = "";
	document.getElementById("log-model-filter").value = "";
	document.getElementById("log-status-filter").value = "";

	currentFilters = {
		timeRange: "24h",
		userId: "",
		model: "",
		success: "",
	};

	logsCurrentPage = 1;
	loadLogs();
	showToast("已清空筛选条件", "info");
}

async function loadLogs() {
	try {
		const offset = (logsCurrentPage - 1) * logsPageSize;
		let url = `/api/admin/logs?limit=${logsPageSize}&offset=${offset}`;

		if (currentFilters.userId) {
			url += `&userId=${encodeURIComponent(currentFilters.userId)}`;
		}
		if (currentFilters.model) {
			url += `&model=${encodeURIComponent(currentFilters.model)}`;
		}
		if (currentFilters.success) {
			url += `&success=${currentFilters.success}`;
		}

		if (currentFilters.timeRange !== "all") {
			const now = new Date();
			let startDate;
			switch (currentFilters.timeRange) {
				case "1h":
					startDate = new Date(now.getTime() - 60 * 60 * 1000);
					break;
				case "24h":
					startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
					break;
				case "7d":
					startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
					break;
				case "30d":
					startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
					break;
			}
			if (startDate) {
				url += `&startDate=${startDate.toISOString()}`;
			}
		}

		const data = await fetchApi(url);
		const logs = data.data || [];
		totalLogs = data.pagination?.total || 0;

		renderLogsPage(logs);
		updateLogsSummary(logs);
	} catch (e) {
		console.error(e);
		showToast("加载日志失败", "error");
	}
}

function updateLogsSummary(logs) {
	if (logs.length === 0) {
		document.getElementById("logs-summary").classList.add("hidden");
		return;
	}

	document.getElementById("logs-summary").classList.remove("hidden");

	const successCount = logs.filter((l) => l.success).length;
	const failureCount = logs.length - successCount;
	const successRate =
		logs.length > 0 ? ((successCount / logs.length) * 100).toFixed(1) : 0;

	const totalDuration = logs.reduce((sum, l) => sum + (l.duration_ms || 0), 0);
	const avgDuration =
		logs.length > 0 ? Math.round(totalDuration / logs.length) : 0;

	const totalCost = logs.reduce((sum, l) => sum + (l.total_cost || 0), 0);

	document.getElementById("summary-total").textContent =
		totalLogs.toLocaleString();
	document.getElementById("summary-success-rate").textContent =
		`${successRate}%`;
	document.getElementById("summary-failures").textContent =
		failureCount.toLocaleString();
	document.getElementById("summary-avg-duration").textContent =
		`${avgDuration}ms`;
	document.getElementById("summary-total-cost").textContent =
		`$${totalCost.toFixed(4)}`;
}

function renderLogsPage(logs) {
	const container = document.getElementById("logs-table");

	if (!logs || logs.length === 0) {
		container.innerHTML =
			'<div class="text-center py-12 text-gray-500">暂无请求记录</div>';
		document.getElementById("logs-pagination").classList.add("hidden");
		return;
	}

	document.getElementById("logs-pagination").classList.remove("hidden");

	const totalPages = Math.ceil(totalLogs / logsPageSize);
	const startIdx = (logsCurrentPage - 1) * logsPageSize;
	const endIdx = Math.min(startIdx + logs.length, totalLogs);

	document.getElementById("logs-page-start").textContent = startIdx + 1;
	document.getElementById("logs-page-end").textContent = endIdx;
	document.getElementById("total-logs").textContent = totalLogs;
	document.getElementById("logs-prev-btn").disabled = logsCurrentPage === 1;
	document.getElementById("logs-next-btn").disabled =
		logsCurrentPage === totalPages;

	renderLogsPageNumbers(totalPages);

	container.innerHTML = `
                <table class="w-full">
                    <thead><tr class="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        <th class="px-4 py-3 rounded-tl-lg">时间</th>
                        <th class="px-4 py-3">用户</th>
                        <th class="px-4 py-3">Kiro账号</th>
                        <th class="px-4 py-3">模型</th>
                        <th class="px-4 py-3">Tokens</th>
                        <th class="px-4 py-3">耗时</th>
                        <th class="px-4 py-3">成本</th>
                        <th class="px-4 py-3 rounded-tr-lg">状态</th>
                    </tr></thead>
                    <tbody class="divide-y divide-gray-100">
                        ${logs
													.map((l, i) => {
														const isFailure = !l.success;
														const rowClass = isFailure
															? "hover:bg-red-50 transition border-l-4 border-red-500 bg-red-50/30"
															: `hover:bg-gray-50 transition ${i % 2 === 1 ? "bg-gray-50/50" : ""}`;
														const durationMs = l.duration_ms || 0;
														const durationColor =
															durationMs > 8000
																? "text-red-600 font-medium"
																: durationMs > 3000
																	? "text-amber-600"
																	: "text-gray-600";

														const errorPreview = l.error_message
															? escapeHtml(
																	l.error_message.substring(0, 100) +
																		(l.error_message.length > 100 ? "..." : ""),
																)
															: "";
														const statusBadge = l.success
															? '<span class="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">成功</span>'
															: `<span class="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 cursor-help" title="${errorPreview}">失败</span>`;

														return `<tr class="${rowClass} cursor-pointer" onclick="showLogDetail(${JSON.stringify(l).replace(/"/g, "&quot;")})">
                            <td class="px-4 py-3 text-sm text-gray-600">${new Date(l.timestamp).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                            <td class="px-4 py-3">
                                <div class="text-sm font-medium text-gray-900">${escapeHtml(l.username || "未知用户")}</div>
                                <div class="text-xs text-gray-400">${l.user_id?.substring(0, 8) || "-"}</div>
                            </td>
                            <td class="px-4 py-3 text-sm text-gray-700">${escapeHtml(l.kiro_account_name || "-")}</td>
                            <td class="px-4 py-3">
                                <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">${l.model || "-"}</span>
                            </td>
                            <td class="px-4 py-3 text-sm text-gray-600">
                                <div class="text-xs"><span class="text-gray-400">In:</span> ${l.input_tokens || 0}</div>
                                <div class="text-xs"><span class="text-gray-400">Out:</span> ${l.output_tokens || 0}</div>
                            </td>
                            <td class="px-4 py-3 text-sm ${durationColor}">${formatDuration(durationMs)}</td>
                            <td class="px-4 py-3 text-sm font-medium text-gray-900">$${(l.total_cost || 0).toFixed(4)}</td>
                            <td class="px-4 py-3">${statusBadge}</td>
                        </tr>`;
													})
													.join("")}
                    </tbody>
                </table>`;
}

function renderLogsPageNumbers(totalPages) {
	const container = document.getElementById("logs-page-numbers");
	const pages = getPaginationPages(logsCurrentPage, totalPages);

	container.innerHTML = pages
		.map((p) => {
			if (p === "...") {
				return '<span class="px-3 py-1 text-gray-400">...</span>';
			}
			const isActive = p === logsCurrentPage;
			return `<button onclick="goToLogsPage(${p})" class="px-3 py-1 rounded ${isActive ? "bg-blue-500 text-white" : "border border-gray-300 hover:bg-gray-50"} text-sm">${p}</button>`;
		})
		.join("");
}

function _changeLogsPage(direction) {
	if (direction === "prev" && logsCurrentPage > 1) {
		logsCurrentPage--;
		loadLogs();
	} else if (direction === "next") {
		const totalPages = Math.ceil(totalLogs / logsPageSize);
		if (logsCurrentPage < totalPages) {
			logsCurrentPage++;
			loadLogs();
		}
	}
}

function _goToLogsPage(page) {
	logsCurrentPage = page;
	loadLogs();
}

function _showLogDetail(log) {
	const modal = document.createElement("div");
	modal.id = "logDetailModal";
	modal.className =
		"fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4";
	modal.onclick = (e) => {
		if (e.target === modal) modal.remove();
	};

	const errorSection = log.error_message
		? `
		<div class="border-t border-gray-200 pt-4">
			<h4 class="text-sm font-semibold text-red-600 mb-2">错误信息</h4>
			<div class="bg-red-50 border border-red-200 rounded-lg p-3">
				<pre class="text-xs text-red-800 whitespace-pre-wrap break-words font-mono">${escapeHtml(log.error_message)}</pre>
			</div>
		</div>
	`
		: "";

	modal.innerHTML = `
		<div class="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
			<div class="flex items-center justify-between p-6 border-b border-gray-100">
				<h3 class="text-lg font-semibold text-gray-900">请求详情</h3>
				<button onclick="document.getElementById('logDetailModal').remove()" class="text-gray-400 hover:text-gray-600 transition">
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
			<div class="p-6 overflow-y-auto flex-1">
				<div class="space-y-4">
					<div class="grid grid-cols-2 gap-4">
						<div>
							<div class="text-xs text-gray-500 mb-1">请求时间</div>
							<div class="text-sm font-medium text-gray-900">${new Date(log.timestamp).toLocaleString("zh-CN")}</div>
						</div>
						<div>
							<div class="text-xs text-gray-500 mb-1">状态</div>
							<div>${log.success ? '<span class="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">成功</span>' : '<span class="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">失败</span>'}</div>
						</div>
					</div>

					<div class="grid grid-cols-2 gap-4">
						<div>
							<div class="text-xs text-gray-500 mb-1">用户</div>
							<div class="text-sm font-medium text-gray-900">${escapeHtml(log.username || "未知用户")}</div>
							<div class="text-xs text-gray-400 mt-0.5">${log.user_id || "-"}</div>
						</div>
						<div>
							<div class="text-xs text-gray-500 mb-1">Kiro 账号</div>
							<div class="text-sm font-medium text-gray-900">${escapeHtml(log.kiro_account_name || "-")}</div>
							<div class="text-xs text-gray-400 mt-0.5">${log.kiro_account_id || "-"}</div>
						</div>
					</div>

					<div>
						<div class="text-xs text-gray-500 mb-1">模型</div>
						<div class="text-sm font-medium text-gray-900">${log.model || "-"}</div>
					</div>

					<div class="grid grid-cols-3 gap-4">
						<div>
							<div class="text-xs text-gray-500 mb-1">输入 Tokens</div>
							<div class="text-sm font-medium text-gray-900">${(log.input_tokens || 0).toLocaleString()}</div>
						</div>
						<div>
							<div class="text-xs text-gray-500 mb-1">输出 Tokens</div>
							<div class="text-sm font-medium text-gray-900">${(log.output_tokens || 0).toLocaleString()}</div>
						</div>
						<div>
							<div class="text-xs text-gray-500 mb-1">总计 Tokens</div>
							<div class="text-sm font-medium text-gray-900">${((log.input_tokens || 0) + (log.output_tokens || 0)).toLocaleString()}</div>
						</div>
					</div>

					<div class="grid grid-cols-2 gap-4">
						<div>
							<div class="text-xs text-gray-500 mb-1">耗时</div>
							<div class="text-sm font-medium ${log.duration_ms > 8000 ? "text-red-600" : log.duration_ms > 3000 ? "text-amber-600" : "text-gray-900"}">${formatDuration(log.duration_ms || 0)}</div>
						</div>
						<div>
							<div class="text-xs text-gray-500 mb-1">成本</div>
							<div class="text-sm font-medium text-gray-900">$${(log.total_cost || 0).toFixed(6)}</div>
						</div>
					</div>

					${errorSection}
				</div>
			</div>
		</div>
	`;

	document.body.appendChild(modal);
}

// 导出到全局作用域
window.toggleAutoRefresh = _toggleAutoRefresh;
window.changeLogsPage = _changeLogsPage;
window.goToLogsPage = _goToLogsPage;
window.showLogDetail = _showLogDetail;
window.applyLogFilters = _applyLogFilters;
window.clearLogFilters = _clearLogFilters;
