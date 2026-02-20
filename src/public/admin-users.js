let usersCurrentPage = 1;
const usersPageSize = 15;
let allUsers = [];

function bindUserActionButtons(container) {
	container.querySelectorAll("button[data-user-action]").forEach((button) => {
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();

			const action = button.dataset.userAction;
			if (action === "manage-account") {
				showRechargeModalFromButton(button);
				return;
			}

			if (action === "permission") {
				showPermissionModalFromButton(button);
				return;
			}

			if (action === "view-stats") {
				showUserStatsModal(button.dataset.userId, button.dataset.username);
			}
		});
	});

	container.querySelectorAll("button.copy-btn").forEach((button) => {
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			const text = button.dataset.copyText;
			if (text) {
				copyText(text, event);
			}
		});
	});
}

async function _loadUsers() {
	try {
		const data = await fetchApi("/api/admin/users");
		allUsers = data.data || [];
		renderUsersPage();
	} catch (e) {
		console.error(e);
		showToast(`加载用户列表失败: ${e.message}`, "error");
	}
}

function renderUsersPage() {
	const container = document.getElementById("users-table");

	if (allUsers.length === 0) {
		container.innerHTML =
			'<div class="text-center py-12 text-gray-500">暂无用户</div>';
		document.getElementById("users-pagination").classList.add("hidden");
		return;
	}

	document.getElementById("users-pagination").classList.remove("hidden");

	const totalPages = Math.ceil(allUsers.length / usersPageSize);
	const startIdx = (usersCurrentPage - 1) * usersPageSize;
	const endIdx = Math.min(startIdx + usersPageSize, allUsers.length);
	const pageUsers = allUsers.slice(startIdx, endIdx);

	document.getElementById("users-page-start").textContent = startIdx + 1;
	document.getElementById("users-page-end").textContent = endIdx;
	document.getElementById("total-users").textContent = allUsers.length;
	document.getElementById("users-prev-btn").disabled = usersCurrentPage === 1;
	document.getElementById("users-next-btn").disabled =
		usersCurrentPage === totalPages;

	renderUsersPageNumbers(totalPages);

	container.innerHTML = `
                <table class="w-full">
                    <thead>
                        <tr class="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            <th class="px-4 py-3 rounded-tl-lg">用户名</th>
                            <th class="px-4 py-3">API Key</th>
                            <th class="px-4 py-3">余额</th>
                            <th class="px-4 py-3">请求数</th>
                            <th class="px-4 py-3">总消费</th>
                            <th class="px-4 py-3">状态</th>
                            <th class="px-4 py-3 rounded-tr-lg">操作</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
                        ${pageUsers
													.map(
														(u, i) => `
                            <tr class="hover:bg-gray-50 transition ${i % 2 === 1 ? "bg-gray-50/50" : ""}">
                                <td class="px-4 py-4">
                                    <div class="font-medium text-gray-900">${escapeHtml(u.username)}</div>
                                    <div class="text-xs text-gray-500">${u.role === "admin" ? "管理员" : "普通用户"}</div>
                                    <div class="mt-1 flex items-center gap-1.5 flex-wrap">${formatUserChannelBadges(u.allowed_channels)}</div>
                                    ${
																			u.subscription_type &&
																			u.subscription_type !== "none"
																				? `<div class="mt-1"><span class="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">${u.subscription_type === "daily" ? "每日套餐" : "每月套餐"}</span></div>`
																				: ""
																		}
                                </td>
                                <td class="px-4 py-4">
                                    <div class="flex items-center gap-2">
                                        <code class="text-xs bg-gray-100 px-2 py-1 rounded font-mono select-all">${escapeHtml(u.api_key)}</code>
                                        <button type="button" data-copy-text="${escapeHtml(u.api_key)}" class="copy-btn text-blue-500 hover:text-blue-700 text-xs" title="复制API Key">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                                            </svg>
                                        </button>
                                    </div>
                                </td>
                                <td class="px-4 py-4">
                                    <span class="font-medium ${u.balance > 0 ? "text-green-600" : "text-red-600"}">$${u.balance.toFixed(4)}</span>
                                </td>
                                <td class="px-4 py-4 text-gray-600">${u.total_requests || 0}</td>
                                <td class="px-4 py-4 text-gray-900">$${(u.total_cost || 0).toFixed(4)}</td>
                                <td class="px-4 py-4">
                                    ${
																			u.status === "active"
																				? '<span class="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">活跃</span>'
																				: '<span class="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">停用</span>'
																		}
                                </td>
                                <td class="px-4 py-4">
                                    <div class="flex items-center gap-2">
                                        <button
                                            type="button"
                                            data-user-action="manage-account"
                                            data-user-id="${u.id}"
                                            data-username="${escapeHtml(u.username)}"
                                            data-balance="${Number(u.balance) || 0}"
                                            class="p-1.5 text-purple-600 hover:bg-purple-50 rounded transition" title="账户管理">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                                            </svg>
                                        </button>
                                        <button
                                            type="button"
                                            data-user-action="permission"
                                            data-user-id="${u.id}"
                                            data-username="${escapeHtml(u.username)}"
                                            class="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded transition" title="权限管理">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l9-5-9-5-9 5 9 5z"/>
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l6.16-3.422A12.083 12.083 0 0112 20.055a12.083 12.083 0 01-6.16-9.477L12 14z"/>
                                            </svg>
                                        </button>
                                        <button
                                            type="button"
                                            data-user-action="view-stats"
                                            data-user-id="${u.id}"
                                            data-username="${escapeHtml(u.username)}"
                                            class="p-1.5 text-cyan-600 hover:bg-cyan-50 rounded transition" title="查看统计">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
                                            </svg>
                                        </button>
                                        <button onclick="refreshUserStats('${u.id}')" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition" title="刷新统计">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                                            </svg>
                                        </button>
                                        ${
																					u.status === "active"
																						? `<button onclick="toggleUserStatus('${u.id}', 'suspended')" class="p-1.5 text-orange-600 hover:bg-orange-50 rounded transition" title="禁用">
                                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/>
                                                </svg>
                                            </button>`
																						: `<button onclick="toggleUserStatus('${u.id}', 'active')" class="p-1.5 text-green-600 hover:bg-green-50 rounded transition" title="启用">
                                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                                                </svg>
                                            </button>`
																				}
                                        <button onclick="deleteUser('${u.id}')" class="p-1.5 text-red-600 hover:bg-red-50 rounded transition" title="删除">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                                            </svg>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        `,
													)
													.join("")}
                    </tbody>
                </table>
            `;

	bindUserActionButtons(container);
}

function renderUsersPageNumbers(totalPages) {
	const container = document.getElementById("users-page-numbers");
	const pages = getPaginationPages(usersCurrentPage, totalPages);

	container.innerHTML = pages
		.map((p) => {
			if (p === "...") {
				return '<span class="px-3 py-1 text-gray-400">...</span>';
			}
			const isActive = p === usersCurrentPage;
			return `<button onclick="goToUsersPage(${p})" class="px-3 py-1 rounded ${isActive ? "bg-blue-500 text-white" : "border border-gray-300 hover:bg-gray-50"} text-sm">${p}</button>`;
		})
		.join("");
}

function _changeUsersPage(direction) {
	if (direction === "prev" && usersCurrentPage > 1) {
		usersCurrentPage--;
		renderUsersPage();
	} else if (direction === "next") {
		const totalPages = Math.ceil(allUsers.length / usersPageSize);
		if (usersCurrentPage < totalPages) {
			usersCurrentPage++;
			renderUsersPage();
		}
	}
}

function _goToUsersPage(page) {
	usersCurrentPage = page;
	renderUsersPage();
}

// 导出到全局作用域
window.loadUsers = _loadUsers;
window.changeUsersPage = _changeUsersPage;
window.goToUsersPage = _goToUsersPage;
