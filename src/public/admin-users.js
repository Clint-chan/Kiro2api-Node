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
                                        <div class="relative inline-block">
                                            <button
                                                type="button"
                                                onclick="toggleUserActionsMenu(event, '${u.id}')"
                                                class="p-1.5 text-gray-600 hover:bg-gray-100 rounded transition" title="更多操作">
                                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"/>
                                                </svg>
                                            </button>
                                            <div id="user-actions-menu-${u.id}" class="hidden opacity-0 scale-95 absolute right-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 transition-all duration-150 ease-out origin-top-right">
                                                <button
                                                    type="button"
                                                    data-user-action="view-stats"
                                                    data-user-id="${u.id}"
                                                    data-username="${escapeHtml(u.username)}"
                                                    class="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                                                    <svg class="w-4 h-4 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
                                                    </svg>
                                                    查看统计
                                                </button>
                                                <button
                                                    onclick="refreshUserStats('${u.id}')"
                                                    class="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                                                    <svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                                                    </svg>
                                                    刷新统计
                                                </button>
                                                <div class="border-t border-gray-100 my-1"></div>
                                                ${
																									u.status === "active"
																										? `<button onclick="toggleUserStatus('${u.id}', 'suspended')" class="w-full px-4 py-2 text-left text-sm text-orange-600 hover:bg-orange-50 flex items-center gap-2">
                                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/>
                                                    </svg>
                                                    禁用用户
                                                </button>`
																										: `<button onclick="toggleUserStatus('${u.id}', 'active')" class="w-full px-4 py-2 text-left text-sm text-green-600 hover:bg-green-50 flex items-center gap-2">
                                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                                                    </svg>
                                                    启用用户
                                                </button>`
																								}
                                                <button onclick="deleteUser('${u.id}')" class="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                                                    </svg>
                                                    删除用户
                                                </button>
                                            </div>
                                        </div>
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

window.toggleUserActionsMenu = (event, userId) => {
	event.stopPropagation();
	const menu = document.getElementById(`user-actions-menu-${userId}`);
	const allMenus = document.querySelectorAll('[id^="user-actions-menu-"]');

	allMenus.forEach((m) => {
		if (m.id !== `user-actions-menu-${userId}`) {
			m.classList.remove("opacity-100", "scale-100");
			m.classList.add("opacity-0", "scale-95");
			setTimeout(() => m.classList.add("hidden"), 150);
		}
	});

	if (menu.classList.contains("hidden")) {
		menu.classList.remove("hidden");
		setTimeout(() => {
			menu.classList.remove("opacity-0", "scale-95");
			menu.classList.add("opacity-100", "scale-100");
		}, 10);
	} else {
		menu.classList.remove("opacity-100", "scale-100");
		menu.classList.add("opacity-0", "scale-95");
		setTimeout(() => menu.classList.add("hidden"), 150);
	}
};

document.addEventListener("click", () => {
	const allMenus = document.querySelectorAll('[id^="user-actions-menu-"]');
	allMenus.forEach((m) => {
		if (!m.classList.contains("hidden")) {
			m.classList.remove("opacity-100", "scale-100");
			m.classList.add("opacity-0", "scale-95");
			setTimeout(() => m.classList.add("hidden"), 150);
		}
	});
});

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
