let currentRechargeUserId = null;
let currentSubscriptionUserId = null;
let currentPermissionUserId = null;

function updateUsernamePreview() {
	const username = document.getElementById("new-username").value.trim();
	const count = parseInt(document.getElementById("new-count").value, 10) || 1;
	const preview = document.getElementById("username-preview");

	if (username && count === 1) {
		preview.textContent = username;
	} else if (count === 1) {
		const randomStr = Math.random().toString(36).substring(2, 8);
		preview.textContent = `user_${randomStr}`;
	} else {
		const randomStr = Math.random().toString(36).substring(2, 8);
		preview.textContent = `user_${randomStr}, user_${Math.random().toString(36).substring(2, 8)}, ... (共${count}个)`;
	}
}

function _selectPackage(value) {
	const pkgOptions = document.getElementById("package-options");
	const customRow = document.getElementById("custom-amount-row");
	const amountInput = document.getElementById("new-package-amount");

	if (value === "none") {
		if (pkgOptions) pkgOptions.classList.add("hidden");
	} else {
		if (pkgOptions) pkgOptions.classList.remove("hidden");
		if (value === "custom") {
			if (customRow) customRow.classList.remove("hidden");
			if (amountInput) amountInput.focus();
		} else {
			if (customRow) customRow.classList.add("hidden");
		}
		_updatePackagePreview();
	}
}

function _setNewPackageMonths(months, evt) {
	document.getElementById("new-package-months").value = months;

	document.querySelectorAll(".new-pkg-month-btn").forEach((btn) => {
		btn.classList.remove("border-blue-500", "bg-blue-50", "text-blue-700");
		btn.classList.add("border-gray-200");
	});
	const target = evt?.target ? evt.target : null;
	if (target) {
		target.classList.remove("border-gray-200");
		target.classList.add("border-blue-500", "bg-blue-50", "text-blue-700");
	}
	_updatePackagePreview();
}

function _updatePackagePreview() {
	const pkgValue = document.querySelector(
		'input[name="new-package"]:checked',
	)?.value;
	if (!pkgValue || pkgValue === "none") {
		const amountEl = document.getElementById("preview-pkg-amount");
		const monthsEl = document.getElementById("preview-pkg-months");
		const expiresEl = document.getElementById("preview-pkg-expires");
		if (amountEl) amountEl.textContent = "-";
		if (monthsEl) monthsEl.textContent = "-";
		if (expiresEl) expiresEl.textContent = "-";
		return;
	}

	let amount = 0;
	if (pkgValue === "custom") {
		amount =
			parseFloat(document.getElementById("new-package-amount")?.value) || 0;
	} else {
		amount = parseFloat(pkgValue);
	}

	const months =
		parseInt(document.getElementById("new-package-months")?.value, 10) || 1;

	const amountEl = document.getElementById("preview-pkg-amount");
	const monthsEl = document.getElementById("preview-pkg-months");
	const expiresEl = document.getElementById("preview-pkg-expires");

	if (amountEl)
		amountEl.textContent = amount > 0 ? `$${amount.toLocaleString()}` : "-";
	if (monthsEl) monthsEl.textContent = `${months} 个月`;

	if (expiresEl) {
		const now = new Date();
		const expires = new Date(now);
		expires.setMonth(expires.getMonth() + months);
		const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
		expiresEl.textContent =
			expires.toLocaleDateString("zh-CN", {
				year: "numeric",
				month: "long",
				day: "numeric",
			}) +
			" " +
			weekdays[expires.getDay()];
	}
}

async function _createUser() {
	const username = document.getElementById("new-username").value.trim();
	const count = parseInt(document.getElementById("new-count").value, 10) || 1;
	const balance = parseFloat(document.getElementById("new-balance").value) || 0;

	const pkgValue = document.querySelector(
		'input[name="new-package"]:checked',
	)?.value;
	const withPackage = pkgValue && pkgValue !== "none";

	const allowedChannels = [];
	if (document.getElementById("new-channel-kiro")?.checked)
		allowedChannels.push("kiro");
	if (document.getElementById("new-channel-antigravity")?.checked)
		allowedChannels.push("antigravity");
	if (document.getElementById("new-channel-codex")?.checked)
		allowedChannels.push("codex");

	if (allowedChannels.length === 0) {
		showToast("请至少选择一个渠道", "warning");
		return;
	}

	// Validate balance
	if (balance < 0) {
		showToast("初始余额不能为负数", "warning");
		return;
	}

	let subQuota = 0;
	let subDuration = 0;
	if (withPackage) {
		if (pkgValue === "custom") {
			subQuota =
				parseFloat(document.getElementById("new-package-amount")?.value) || 0;
		} else {
			subQuota = parseFloat(pkgValue);
		}
		subDuration =
			parseInt(document.getElementById("new-package-months")?.value, 10) || 1; // Default 1 if missing

		if (!subQuota || subQuota <= 0) {
			showToast("请输入有效的每月额度", "warning");
			return;
		}
		if (!subDuration || subDuration <= 0) {
			showToast("请输入有效的开通月数", "warning");
			return;
		}
	}

	// Show loading state
	const submitBtn = document.querySelector('button[onclick="createUser()"]');
	if (submitBtn) {
		submitBtn.disabled = true;
		const spinner = submitBtn.querySelector(".button-spinner");
		if (spinner) spinner.classList.remove("hidden");
		const textSpan = submitBtn.querySelector(".button-text");
		if (textSpan) textSpan.textContent = "创建中...";
	}

	try {
		const createdUsers = [];
		const failedUsers = [];

		if (count > 1) {
			showToast(`开始创建 ${count} 个用户...`, "info");
		}

		for (let i = 0; i < count; i++) {
			try {
				let finalUsername = username;
				if (!finalUsername || count > 1) {
					const timestamp = Date.now().toString(36);
					const randomStr = Math.random().toString(36).substring(2, 6);
					finalUsername = `user_${timestamp}${randomStr}`;
				}

				const userResult = await fetchApi("/api/admin/users", {
					method: "POST",
					body: JSON.stringify({
						username: finalUsername,
						balance,
						allowed_channels: allowedChannels,
						password: "password", // Default password per UI hint
					}),
				});

				createdUsers.push(finalUsername);

				if (withPackage && userResult.data && userResult.data.id) {
					await fetchApi(
						`/api/admin/users/${userResult.data.id}/subscription`,
						{
							method: "POST",
							body: JSON.stringify({
								type: "monthly",
								quota: subQuota,
								duration: subDuration,
							}),
						},
					);
				}
			} catch (e) {
				console.error(`创建用户失败 (${i + 1}/${count}):`, e);
				failedUsers.push(i + 1);
			}
		}

		hideModal("createUserModal");
		_resetCreateUserForm();
		loadUsers();

		if (failedUsers.length === 0) {
			if (count === 1) {
				showToast(
					`用户 ${createdUsers[0]} 创建成功${withPackage ? "，套餐已开通" : ""}`,
					"success",
				);
			} else {
				showToast(
					`成功创建 ${count} 个用户${withPackage ? "，套餐已开通" : ""}`,
					"success",
				);
			}
		} else {
			showToast(
				`创建完成：成功 ${createdUsers.length} 个，失败 ${failedUsers.length} 个`,
				"warning",
			);
		}
	} catch (e) {
		showToast(`创建失败: ${e.message}`, "error");
	} finally {
		// Reset button state
		if (submitBtn) {
			submitBtn.disabled = false;
			const spinner = submitBtn.querySelector(".button-spinner");
			if (spinner) spinner.classList.add("hidden");
			const textSpan = submitBtn.querySelector(".button-text");
			if (textSpan) textSpan.textContent = "确认创建";
		}
	}
}

function _resetCreateUserForm() {
	const el = (id) => document.getElementById(id);
	if (el("new-username")) el("new-username").value = "";
	if (el("new-count")) el("new-count").value = "1";
	if (el("new-balance")) el("new-balance").value = "0";
	if (el("new-channel-kiro")) el("new-channel-kiro").checked = true;
	if (el("new-channel-antigravity"))
		el("new-channel-antigravity").checked = false;
	if (el("new-channel-codex")) el("new-channel-codex").checked = false;

	// Reset package selection
	const noneRadio = document.querySelector(
		'input[name="new-package"][value="none"]',
	);
	if (noneRadio) noneRadio.checked = true;

	// Reset custom inputs
	if (el("package-options")) el("package-options").classList.add("hidden");
	if (el("custom-amount-row")) el("custom-amount-row").classList.add("hidden");

	if (el("new-package-amount")) el("new-package-amount").value = "";
	if (el("new-package-months")) el("new-package-months").value = "1";

	document.querySelectorAll(".new-pkg-month-btn").forEach((btn) => {
		btn.classList.remove("border-blue-500", "bg-blue-50", "text-blue-700");
		btn.classList.add("border-gray-200");
	});
	if (window.updateUsernamePreview) window.updateUsernamePreview();
	if (window.updatePackagePreview) window.updatePackagePreview();
}

async function _doRecharge() {
	const amount = parseFloat(document.getElementById("recharge-amount").value);
	const notes = document.getElementById("recharge-notes").value.trim();

	if (!Number.isFinite(amount) || amount === 0) {
		showToast("请输入有效的调整金额（不能为 0）", "warning");
		return;
	}

	try {
		await fetchApi(`/api/admin/users/${currentRechargeUserId}/recharge`, {
			method: "POST",
			body: JSON.stringify({ amount, notes }),
		});
		hideModal("userManageModal");
		loadUsers();
		showToast(amount > 0 ? "额度增加成功" : "额度扣减成功", "success");
	} catch (e) {
		showToast(`额度调整失败: ${e.message}`, "error");
	}
}

async function _deleteUser(userId) {
	if (!confirm("确定删除此用户？此操作不可恢复！")) return;
	try {
		await fetchApi(`/api/admin/users/${userId}`, { method: "DELETE" });
		loadUsers();
		showToast("用户已删除", "error");
	} catch (e) {
		showToast(`删除失败: ${e.message}`, "error");
	}
}

async function _refreshUserStats(userId) {
	try {
		showToast("正在刷新统计...", "info");
		await fetchApi(`/api/admin/users/${userId}`);
		loadUsers();
		showToast("统计已刷新", "success");
	} catch (e) {
		showToast(`刷新失败: ${e.message}`, "error");
	}
}

async function _toggleUserStatus(userId, newStatus) {
	const action = newStatus === "active" ? "启用" : "禁用";
	if (newStatus === "suspended" && !confirm(`确定禁用此用户？`)) return;
	try {
		await fetchApi(`/api/admin/users/${userId}`, {
			method: "PUT",
			body: JSON.stringify({ status: newStatus }),
		});
		loadUsers();
		showToast(
			`用户已${action}`,
			newStatus === "active" ? "success" : "warning",
		);
	} catch (e) {
		showToast(`${action}失败: ${e.message}`, "error");
	}
}

function _showSubscriptionModalFromButton(button) {
	showSubscriptionModal(button.dataset.userId, button.dataset.username || "");
}

function _showRechargeModalFromButton(button) {
	const balance = Number.parseFloat(button.dataset.balance);
	showRechargeModal(
		button.dataset.userId,
		button.dataset.username || "",
		Number.isFinite(balance) ? balance : 0,
	);
}

function _showPermissionModalFromButton(button) {
	showPermissionModal(button.dataset.userId, button.dataset.username || "");
}

const ALL_MODELS = {
	kiro: [
		{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
		{ id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5" },
		{ id: "claude-opus-4-6-20251220", name: "Claude Opus 4.6" },
		{ id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5" },
		{ id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
		{ id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
		{ id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
	],
	antigravity: [
		{ id: "gemini-3-pro-high", name: "Gemini 3 Pro High" },
		{ id: "gemini-3-flash", name: "Gemini 3 Flash" },
		{ id: "claude-sonnet-4-5-thinking", name: "Claude Sonnet 4.5 (Thinking)" },
		{ id: "claude-opus-4-5-thinking", name: "Claude Opus 4.5 (Thinking)" },
		{ id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
	],
	codex: [
		{ id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
		{ id: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
		{ id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max" },
		{ id: "gpt-5.2", name: "GPT-5.2" },
		{ id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini" },
	],
};

async function showPermissionModal(userId, username) {
	currentPermissionUserId = userId;
	document.getElementById("manage-username").textContent = username;

	switchManageTab("permission");
	showModal("userManageModal");

	document.querySelectorAll(".channel-checkbox").forEach((cb) => {
		cb.checked = false;
	});

	try {
		const response = await fetchApi(`/api/admin/users/${userId}`);
		const user = response?.data || {};
		const channels =
			Array.isArray(user.allowed_channels) && user.allowed_channels.length > 0
				? user.allowed_channels
				: ["kiro"];

		channels.forEach((ch) => {
			const cb = document.getElementById(`perm-channel-${ch}`);
			if (cb) cb.checked = true;
		});

		if (document.querySelectorAll(".channel-checkbox:checked").length === 0) {
			const kiroCb = document.getElementById("perm-channel-kiro");
			if (kiroCb) kiroCb.checked = true;
		}

		window.currentUserModels = Array.isArray(user.allowed_models)
			? user.allowed_models
			: [];
		updateModelCheckboxes();

		document.querySelectorAll(".channel-checkbox").forEach((cb) => {
			cb.removeEventListener("change", updateModelCheckboxes);
			cb.addEventListener("change", updateModelCheckboxes);
		});
	} catch (e) {
		showToast(`加载权限失败: ${e.message}`, "error");
	}
}

function updateModelCheckboxes() {
	const container = document.getElementById("perm-models-container");
	container.innerHTML = "";

	const selectedChannels = Array.from(
		document.querySelectorAll(".channel-checkbox:checked"),
	).map((cb) => cb.value);
	const userModels = window.currentUserModels || [];

	if (selectedChannels.length === 0) {
		container.innerHTML =
			'<div class="text-sm text-gray-500 text-center py-8">请先勾选上方渠道</div>';
		return;
	}

	let containerHTML = "";

	selectedChannels.forEach((channel) => {
		const models = ALL_MODELS[channel] || [];
		if (models.length === 0) return;

		const channelNames = {
			kiro: "Kiro",
			antigravity: "Antigravity",
			codex: "Codex",
		};
		const channelColors = {
			kiro: "text-blue-600 bg-blue-50",
			antigravity: "text-purple-600 bg-purple-50",
			codex: "text-blue-600 bg-blue-50",
		};
		const borderColors = {
			kiro: "border-blue-100",
			antigravity: "border-purple-100",
			codex: "border-blue-100",
		};

		const channelName = channelNames[channel] || channel;
		const channelColor = channelColors[channel] || "text-gray-600 bg-gray-50";
		const borderColor = borderColors[channel] || "border-gray-100";

		const modelsHTML = models
			.map((m) => {
				const isChecked = userModels.includes(m.id);
				return `
                        <label class="flex items-center gap-2 text-sm text-gray-700 hover:bg-gray-50 p-1.5 rounded cursor-pointer transition">
                            <input type="checkbox" value="${m.id}" ${isChecked ? "checked" : ""} class="rounded border-gray-300 text-indigo-500 focus:ring-indigo-500 model-checkbox model-checkbox-${channel}">
                            <span class="truncate" title="${m.name}">${m.name}</span>
                        </label>
                    `;
			})
			.join("");

		containerHTML += `
                    <div class="bg-white rounded-lg border border-gray-100 overflow-hidden">
                        <div class="px-3 py-2 ${channelColor} border-b ${borderColor} flex justify-between items-center">
                            <span class="font-semibold text-sm">${channelName} 模型</span>
                            <div class="flex gap-2">
                                <button type="button" onclick="batchSelectModels('${channel}', true)" class="text-xs hover:underline opacity-80 hover:opacity-100">全选</button>
                                <button type="button" onclick="batchSelectModels('${channel}', false)" class="text-xs hover:underline opacity-80 hover:opacity-100">清空</button>
                            </div>
                        </div>
                        <div class="p-3 grid grid-cols-3 gap-2">
                            ${modelsHTML}
                        </div>
                    </div>
                `;
	});

	container.innerHTML = containerHTML;
}

function _batchSelectModels(channel, selectAll) {
	document.querySelectorAll(`.model-checkbox-${channel}`).forEach((cb) => {
		cb.checked = selectAll;
	});
}

async function _saveUserPermissions() {
	if (!currentPermissionUserId) return;

	const selectedChannels = Array.from(
		document.querySelectorAll(".channel-checkbox:checked"),
	).map((cb) => cb.value);

	if (selectedChannels.length === 0) {
		showToast("请至少选择一个渠道", "warning");
		return;
	}

	const modelCheckboxes = document.querySelectorAll(".model-checkbox:checked");
	const models = Array.from(modelCheckboxes).map((cb) => cb.value);

	try {
		await fetchApi(`/api/admin/users/${currentPermissionUserId}`, {
			method: "PUT",
			body: JSON.stringify({
				allowed_channels: selectedChannels,
				allowed_models: models,
			}),
		});

		hideModal("userManageModal");
		await loadUsers();
		showToast("权限已更新", "success");
	} catch (e) {
		showToast(`保存权限失败: ${e.message}`, "error");
	}
}

function _updateSubscriptionType(type) {
	document.getElementById("sub-type").value = type;
	updatePreview();
}

function _setDuration(months, evt) {
	document.getElementById("sub-duration").value = months;

	document.querySelectorAll(".duration-btn").forEach((btn) => {
		btn.classList.remove(
			"border-purple-500",
			"bg-purple-50",
			"text-purple-600",
			"border-blue-500",
			"bg-blue-50",
			"text-blue-600",
		);
	});
	const target = evt?.target ? evt.target : null;
	const button = target ? target.closest(".duration-btn") : null;
	if (button) {
		button.classList.add("border-blue-500", "bg-blue-50", "text-blue-600");
	}

	updatePreview();
}

function updatePreview() {
	const type = document.getElementById("sub-type").value;
	const quota = parseFloat(document.getElementById("sub-quota").value);
	const months = parseInt(document.getElementById("sub-duration").value, 10);

	const preview = document.getElementById("subscription-preview");

	if (!type || !quota || !months) {
		preview.classList.add("hidden");
		document
			.getElementById("subscription-preview-empty")
			?.classList.remove("hidden");
		return;
	}

	preview.classList.remove("hidden");
	document
		.getElementById("subscription-preview-empty")
		?.classList.add("hidden");

	const typeName = type === "daily" ? "每日重置" : "每月重置";
	document.getElementById("preview-type").textContent = typeName;
	document.getElementById("preview-quota").textContent = `$${quota.toFixed(2)}`;
	document.getElementById("preview-duration").textContent = `${months} 个月`;

	const now = new Date();
	const expiresDate = new Date(now);
	expiresDate.setMonth(expiresDate.getMonth() + months);

	const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
	const expiresStr =
		expiresDate.toLocaleDateString("zh-CN", {
			year: "numeric",
			month: "long",
			day: "numeric",
		}) +
		" " +
		weekdays[expiresDate.getDay()];

	document.getElementById("preview-expires").textContent = expiresStr;

	let totalResets = 0;
	let resetFrequency = "";

	if (type === "daily") {
		let totalDays = 0;
		const tempDate = new Date(now);
		for (let i = 0; i < months; i++) {
			const daysInMonth = new Date(
				tempDate.getFullYear(),
				tempDate.getMonth() + 1,
				0,
			).getDate();
			totalDays += daysInMonth;
			tempDate.setMonth(tempDate.getMonth() + 1);
		}
		totalResets = totalDays;
		resetFrequency = "每天充值一次";
	} else if (type === "monthly") {
		totalResets = months;
		resetFrequency = "每月充值一次";
	}

	const totalAmount = quota * totalResets;
	document.getElementById("preview-total").textContent =
		"$" +
		totalAmount.toFixed(2) +
		" (" +
		totalResets +
		" 次 · " +
		resetFrequency +
		")";
}

async function _setSubscription() {
	const type = document.getElementById("sub-type").value;
	const quota = parseFloat(document.getElementById("sub-quota").value);
	const months = parseInt(document.getElementById("sub-duration").value, 10);

	if (!type) {
		showToast("请选择订阅类型", "warning");
		return;
	}

	if (!quota || quota <= 0) {
		showToast("请输入有效的充值额度", "warning");
		return;
	}

	if (!months || months <= 0) {
		showToast("请输入有效的订阅时长", "warning");
		return;
	}

	try {
		await fetchApi(
			`/api/admin/users/${currentSubscriptionUserId}/subscription`,
			{
				method: "POST",
				body: JSON.stringify({ type, quota, duration: months }),
			},
		);
		hideModal("userManageModal");
		loadUsers();
		showToast("订阅设置成功", "success");
	} catch (e) {
		showToast(`设置失败: ${e.message}`, "error");
	}
}

async function _cancelSubscription() {
	if (
		!confirm(
			"确定取消此用户的订阅？\n\n取消后将停止自动充值，但不会扣除已充值的余额。",
		)
	)
		return;

	try {
		await fetchApi(
			`/api/admin/users/${currentSubscriptionUserId}/subscription`,
			{
				method: "DELETE",
			},
		);
		hideModal("userManageModal");
		loadUsers();
		showToast("订阅已取消", "success");
	} catch (e) {
		showToast(`取消失败: ${e.message}`, "error");
	}
}

// 导出到全局作用域
window.updateUsernamePreview = updateUsernamePreview;
window.selectPackage = _selectPackage;
window.setNewPackageMonths = _setNewPackageMonths;
window.updatePackagePreview = _updatePackagePreview;
window.createUser = _createUser;
window.doRecharge = _doRecharge;
window.deleteUser = _deleteUser;
window.refreshUserStats = _refreshUserStats;
window.toggleUserStatus = _toggleUserStatus;
window.showSubscriptionModalFromButton = _showSubscriptionModalFromButton;
window.showRechargeModalFromButton = _showRechargeModalFromButton;
window.showPermissionModalFromButton = _showPermissionModalFromButton;
window.batchSelectModels = _batchSelectModels;
window.saveUserPermissions = _saveUserPermissions;
window.updateSubscriptionType = _updateSubscriptionType;
window.setDuration = _setDuration;
window.setSubscription = _setSubscription;
window.cancelSubscription = _cancelSubscription;

const userStatsCharts = { request: null, cost: null };
let currentStatsUserId = null;

window.userStatsCharts = userStatsCharts;

async function _showUserStatsModal(userId, username) {
	currentStatsUserId = userId;

	// 清空旧数据
	document.getElementById("user-stats-username").textContent = username;
	document.getElementById("user-stat-total-requests").textContent = "-";
	document.getElementById("user-stat-total-cost").textContent = "-";
	document.getElementById("user-stat-success-rate").textContent = "-";
	document.getElementById("user-stat-avg-tokens").textContent = "-";
	document.getElementById("userStatsModelTable").innerHTML =
		'<div class="text-center py-8 text-gray-500">加载中...</div>';

	showModal("userStatsModal");

	if (userStatsCharts.request) userStatsCharts.request.destroy();
	if (userStatsCharts.cost) userStatsCharts.cost.destroy();

	try {
		const endDate = new Date();
		const startDate = new Date();
		startDate.setDate(startDate.getDate() - 30);

		const startStr = startDate.toISOString().split("T")[0];
		const endStr = endDate.toISOString().split("T")[0] + "T23:59:59.999Z";

		const [statsRes, dailyRes, modelRes] = await Promise.all([
			fetchApi(
				`/api/admin/users/${userId}/stats?startDate=${startStr}&endDate=${endStr}`,
			),
			fetchApi(
				`/api/admin/users/${userId}/stats/daily?startDate=${startStr}&endDate=${endStr}`,
			),
			fetchApi(
				`/api/admin/users/${userId}/stats/models?startDate=${startStr}&endDate=${endStr}`,
			),
		]);

		if (currentStatsUserId !== userId) {
			return;
		}

		const stats = statsRes.data;
		document.getElementById("user-stat-total-requests").textContent =
			stats.total_requests || 0;
		document.getElementById("user-stat-total-cost").textContent =
			`$${(stats.total_cost || 0).toFixed(4)}`;
		const successRate =
			stats.total_requests > 0
				? ((stats.successful_requests / stats.total_requests) * 100).toFixed(1)
				: 0;
		document.getElementById("user-stat-success-rate").textContent =
			`${successRate}%`;
		const avgTokens =
			stats.total_requests > 0
				? Math.round(
						(stats.total_input_tokens + stats.total_output_tokens) /
							stats.total_requests,
					)
				: 0;
		document.getElementById("user-stat-avg-tokens").textContent = avgTokens;

		const dailyStats = dailyRes.data || [];
		const labels = dailyStats.map((d) => d.date.substring(5));
		const requests = dailyStats.map((d) => d.request_count);
		const costs = dailyStats.map((d) => d.total_cost);

		const ctx1 = document
			.getElementById("userStatsRequestChart")
			.getContext("2d");
		userStatsCharts.request = new Chart(ctx1, {
			type: "line",
			data: {
				labels: labels,
				datasets: [
					{
						label: "请求数",
						data: requests,
						borderColor: "rgb(59, 130, 246)",
						backgroundColor: "rgba(59, 130, 246, 0.1)",
						tension: 0.4,
						fill: true,
					},
				],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: { legend: { display: false } },
				scales: { y: { beginAtZero: true } },
			},
		});

		const ctx2 = document.getElementById("userStatsCostChart").getContext("2d");
		userStatsCharts.cost = new Chart(ctx2, {
			type: "line",
			data: {
				labels: labels,
				datasets: [
					{
						label: "消费 ($)",
						data: costs,
						borderColor: "rgb(168, 85, 247)",
						backgroundColor: "rgba(168, 85, 247, 0.1)",
						tension: 0.4,
						fill: true,
					},
				],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: { legend: { display: false } },
				scales: {
					y: {
						beginAtZero: true,
						ticks: { callback: (value) => `$${value.toFixed(2)}` },
					},
				},
			},
		});

		const models = modelRes.data || [];
		const tableHtml =
			models.length > 0
				? `
            <table class="w-full text-sm">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">模型</th>
                        <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">请求数</th>
                        <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">总Token</th>
                        <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">总消费</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                    ${models
											.map(
												(m) => `
                        <tr class="hover:bg-gray-50">
                            <td class="px-4 py-2 text-gray-900">${escapeHtml(m.model)}</td>
                            <td class="px-4 py-2 text-right text-gray-600">${m.request_count || 0}</td>
                            <td class="px-4 py-2 text-right text-gray-600">${((m.total_input_tokens || 0) + (m.total_output_tokens || 0)).toLocaleString()}</td>
                            <td class="px-4 py-2 text-right text-gray-900 font-medium">$${(m.total_cost || 0).toFixed(4)}</td>
                        </tr>
                    `,
											)
											.join("")}
                </tbody>
            </table>
        `
				: '<div class="text-center py-8 text-gray-500">暂无模型使用数据</div>';
		document.getElementById("userStatsModelTable").innerHTML = tableHtml;
	} catch (error) {
		console.error("Load user stats error:", error);
		showToast(`加载统计失败: ${error.message}`, "error");
	}
}

window.showUserStatsModal = _showUserStatsModal;

function switchManageTab(tab) {
	const tabs = ["recharge", "subscription", "permission"];
	tabs.forEach((t) => {
		const btn = document.getElementById(`tab-btn-${t}`);
		const content = document.getElementById(`tab-content-${t}`);

		if (t === tab) {
			btn.classList.add("border-blue-500", "text-blue-600");
			btn.classList.remove("border-transparent", "text-gray-600");
			content.classList.remove("hidden");
		} else {
			btn.classList.remove("border-blue-500", "text-blue-600");
			btn.classList.add("border-transparent", "text-gray-600");
			content.classList.add("hidden");
		}
	});

	document.getElementById("recharge-submit-btn").classList.add("hidden");
	document.getElementById("subscription-submit-btn").classList.add("hidden");
	document.getElementById("permission-submit-btn").classList.add("hidden");
	document.getElementById("cancel-subscription-btn").classList.add("hidden");

	if (tab === "recharge") {
		document.getElementById("recharge-submit-btn").classList.remove("hidden");
	} else if (tab === "subscription") {
		document
			.getElementById("subscription-submit-btn")
			.classList.remove("hidden");
		document
			.getElementById("cancel-subscription-btn")
			.classList.remove("hidden");
	} else if (tab === "permission") {
		document.getElementById("permission-submit-btn").classList.remove("hidden");
	}
}

function showRechargeModal(userId, username, balance) {
	currentRechargeUserId = userId;
	currentSubscriptionUserId = userId;
	currentPermissionUserId = userId;
	document.getElementById("manage-username").textContent = username;
	document.getElementById("recharge-balance").textContent =
		`$${balance.toFixed(4)}`;
	document.getElementById("recharge-amount").value = "";
	document.getElementById("recharge-notes").value = "";
	switchManageTab("recharge");
	showModal("userManageModal");
}

function showSubscriptionModal(userId, username) {
	currentSubscriptionUserId = userId;
	document.getElementById("manage-username").textContent = username;

	document.getElementById("sub-type").value = "";
	document.getElementById("sub-quota").value = "";
	document.getElementById("sub-duration").value = "";
	document.querySelectorAll('input[name="sub-type-radio"]').forEach((r) => {
		r.checked = false;
	});
	document.querySelectorAll(".duration-btn").forEach((btn) => {
		btn.classList.remove(
			"border-purple-500",
			"bg-purple-50",
			"text-purple-600",
			"border-blue-500",
			"bg-blue-50",
			"text-blue-600",
		);
	});
	document.getElementById("subscription-preview").classList.add("hidden");
	document
		.getElementById("subscription-preview-empty")
		?.classList.remove("hidden");

	fetchApi(`/api/admin/users/${userId}/subscription`)
		.then((data) => {
			const sub = data.data;
			if (sub.subscription_type && sub.subscription_type !== "none") {
				document.getElementById("sub-type").value = sub.subscription_type;
				document.getElementById("sub-quota").value =
					sub.subscription_quota || "";

				const radio = document.querySelector(
					`input[name="sub-type-radio"][value="${sub.subscription_type}"]`,
				);
				if (radio) radio.checked = true;

				updatePreview();
			}
		})
		.catch((e) => {
			console.error("Load subscription error:", e);
		});

	switchManageTab("subscription");
	showModal("userManageModal");
}

window.switchManageTab = switchManageTab;
