        let token = localStorage.getItem('kiro_token');
        let adminKey = token || '';
        let machineTooltipTimer = null;

        function showMachineIdTooltip(event, machineId, source, title, desc) {
            const tooltip = document.getElementById('global-machine-tooltip');
            if (machineTooltipTimer) clearTimeout(machineTooltipTimer);

            if (!tooltip) return;

            // Content update
            const contentHtml = `
                <div class="flex items-start justify-between mb-3">
                    <div>
                        <div class="text-xs font-bold text-gray-800 mb-0.5">Machine ID</div>
                        <div class="text-[10px] font-medium text-gray-500 uppercase tracking-wide">${title} (${source})</div>
                    </div>
                    <button onclick="copyText('${machineId}', event)" class="text-gray-400 hover:text-blue-600 transition p-1" title="复制">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                    </button>
                </div>
                <div class="bg-gray-50 rounded-lg px-3 py-2 mb-3 font-mono text-[10px] leading-relaxed text-gray-600 break-all border border-gray-100 select-all">
                    ${machineId}
                </div>
                <div class="text-[10px] text-gray-500 leading-relaxed border-t border-gray-100 pt-2">
                    ${desc}
                </div>
            `;
            tooltip.innerHTML = contentHtml;

            // Positioning
            const rect = event.currentTarget.getBoundingClientRect();
            tooltip.style.left = rect.left + 'px';
            tooltip.style.top = (rect.bottom + 8) + 'px';
            tooltip.classList.remove('hidden', 'opacity-0', 'invisible');

            // Adjust if off-screen
            const tooltipRect = tooltip.getBoundingClientRect();
            if (tooltipRect.right > window.innerWidth - 20) {
                tooltip.style.left = (window.innerWidth - tooltipRect.width - 20) + 'px';
            }
        }

        function hideMachineIdTooltip() {
            const tooltip = document.getElementById('global-machine-tooltip');
            if (tooltip) {
                machineTooltipTimer = setTimeout(() => {
                    tooltip.classList.add('opacity-0', 'invisible');
                    setTimeout(() => tooltip.classList.add('hidden'), 200);
                }, 300);
            }
        }

        function keepTooltipOpen() {
            if (machineTooltipTimer) clearTimeout(machineTooltipTimer);
        }

        let selectedAccounts = new Set();
        let autoRefreshInterval = null;
        let serverStartTime = null;
        let uptimeInterval = null;
        let currentRechargeUserId = null;
        let currentPage = 1;
        let pageSize = 15;
        let allAccounts = [];
        let weeklyChart = null;
        let usersCurrentPage = 1;
        let usersPageSize = 15;
        let allUsers = [];
        let logsCurrentPage = 1;
        let logsPageSize = 20;
        let allLogs = [];

        function showToast(message, type = 'info') {
            const container = document.getElementById('toast-container');
            const colors = { success: 'bg-green-500', error: 'bg-red-500', info: 'bg-blue-500', warning: 'bg-yellow-500' };
            const toast = document.createElement('div');
            toast.className = `${colors[type]} text-white px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slideIn`;
            toast.textContent = message;
            container.appendChild(toast);
            setTimeout(() => { toast.classList.add('animate-slideOut'); setTimeout(() => toast.remove(), 300); }, 3000);
        }

        function toggleAutoRefresh() {
            const toggle = document.getElementById('autoRefreshToggle');
            if (toggle.checked) {
                autoRefreshInterval = setInterval(() => {
                    loadLogs();
                }, 5000);
                showToast('已开启自动刷新', 'success');
            } else {
                if (autoRefreshInterval) {
                    clearInterval(autoRefreshInterval);
                    autoRefreshInterval = null;
                }
                showToast('已关闭自动刷新', 'info');
            }
        }

        function startUptimeCounter() {
            if (uptimeInterval) {
                clearInterval(uptimeInterval);
            }
            uptimeInterval = setInterval(() => {
                if (serverStartTime) {
                    const uptime = Math.floor((Date.now() - serverStartTime) / 1000);
                    const uptimeEl = document.getElementById('stat-uptime');
                    if (uptimeEl) {
                        uptimeEl.textContent = formatUptime(uptime);
                    }
                }
            }, 1000);
        }

        async function fetchApi(url, options = {}) {
            const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey, ...options.headers } });
            if (res.status === 401) { logout(); throw new Error('认证失败'); }
            if (!res.ok && res.status !== 204) {
                const error = await res.json().catch(() => ({}));
                const err = new Error(error.error?.message || res.statusText);
                err.status = res.status;
                err.payload = error;
                throw err;
            }
            return res.status === 204 ? null : res.json();
        }

        function logout() {
            if (autoRefreshInterval) clearInterval(autoRefreshInterval);
            if (uptimeInterval) clearInterval(uptimeInterval);
            localStorage.removeItem('kiro_token');
            localStorage.removeItem('kiro_user');
            window.location.href = '/login.html';
        }

        function showMainPanel() {
            document.getElementById('loginPage').classList.add('hidden');
            document.getElementById('mainPanel').classList.remove('hidden');
            refresh();
        }

        function formatUptime(secs) {
            const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
            return h > 0 ? `${h}h ${m}m` : `${m}m ${secs % 60}s`;
        }

        function formatNumber(n) {
            if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
            if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
            return n.toString();
        }

        async function loadStatus() {
            try {
                const data = await fetchApi('/api/admin/stats/overview');
                const stats = data.data;

                // Kiro accounts stats
                document.getElementById('stat-active').textContent = stats.kiroAccounts?.active || 0;
                document.getElementById('stat-cooldown').textContent = stats.kiroAccounts?.cooldown || 0;
                const invalidCount = (stats.kiroAccounts?.error || 0) + (stats.kiroAccounts?.depleted || 0) + (stats.kiroAccounts?.disabled || 0) + (stats.kiroAccounts?.inactive || 0);
                document.getElementById('stat-invalid').textContent = invalidCount;

                // Request stats
                document.getElementById('stat-requests').textContent = formatNumber(stats.allTime?.requests || 0);
                document.getElementById('stat-input').textContent = formatNumber(stats.allTime?.inputTokens || 0);
                document.getElementById('stat-output').textContent = formatNumber(stats.allTime?.outputTokens || 0);

                // 今日统计
                document.getElementById('today-requests').textContent = formatNumber(stats.today?.requests || 0);
                document.getElementById('today-revenue').textContent = '$' + (stats.today?.revenue || 0).toFixed(2);
                document.getElementById('today-input').textContent = formatNumber(stats.today?.inputTokens || 0);
                document.getElementById('today-output').textContent = formatNumber(stats.today?.outputTokens || 0);

                // 计算账号池总额度
                await loadQuotaStats();

                // 加载7天趋势图
                await loadWeeklyChart();

                // Uptime - 启动自动更新
                if (!serverStartTime) {
                    serverStartTime = Date.now();
                }
                startUptimeCounter();
            } catch (e) {
                console.error('Load status error:', e);
            }
        }

        async function loadQuotaStats() {
            try {
                const data = await fetchApi('/api/admin/accounts');
                const accounts = data.data || [];

                let totalQuota = 0;
                let totalUsed = 0;
                let totalAvailable = 0;

                accounts.forEach(acc => {
                    if (acc.usage_limit && acc.status === 'active') {
                        totalQuota += acc.usage_limit || 0;
                        totalUsed += acc.current_usage || 0;
                        totalAvailable += acc.available || 0;
                    }
                });

                const usedPercent = totalQuota > 0 ? Math.round((totalUsed / totalQuota) * 100) : 0;

                document.getElementById('stat-total-quota').textContent = totalQuota.toFixed(1);
                document.getElementById('stat-available-quota').textContent = totalAvailable.toFixed(1);
                document.getElementById('stat-used-percent').textContent = usedPercent + '%';
                document.getElementById('quota-progress').style.width = usedPercent + '%';
            } catch (e) {
                console.error('Load quota stats error:', e);
            }
        }

        async function loadWeeklyChart() {
            try {
                // 获取最近7天的数据
                const endDate = new Date();
                const startDate = new Date();
                startDate.setDate(startDate.getDate() - 6);

                const labels = [];
                const requestData = [];

                // 按日期分组统计
                const dailyStats = {};
                for (let i = 0; i < 7; i++) {
                    const date = new Date(startDate);
                    date.setDate(date.getDate() + i);
                    const dateStr = date.toISOString().split('T')[0];
                    labels.push((date.getMonth() + 1) + '/' + date.getDate());
                    dailyStats[dateStr] = 0;
                }

                // Get aggregated daily statistics from backend
                const startDateStr = startDate.toISOString().split('T')[0];
                const endDateStr = endDate.toISOString().split('T')[0];
                const statsData = await fetchApi(`/api/admin/stats/daily?startDate=${startDateStr}&endDate=${endDateStr}`);
                const stats = statsData.data || [];

                // Fill daily stats with backend aggregated data
                stats.forEach(stat => {
                    if (dailyStats.hasOwnProperty(stat.date)) {
                        dailyStats[stat.date] = stat.count;
                    }
                });

                // 转换为数组
                Object.keys(dailyStats).sort().forEach(date => {
                    requestData.push(dailyStats[date]);
                });

                // 如果图表已存在，只更新数据，不重新创建
                if (weeklyChart) {
                    weeklyChart.data.labels = labels;
                    weeklyChart.data.datasets[0].data = requestData;
                    weeklyChart.update('none'); // 'none' 模式不使用动画，避免卡顿
                } else {
                    // 首次创建图表
                    const ctx = document.getElementById('weeklyChart').getContext('2d');
                    weeklyChart = new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: labels,
                            datasets: [{
                                label: '请求数',
                                data: requestData,
                                borderColor: 'rgb(59, 130, 246)',
                                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                                tension: 0.4,
                                fill: true
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            animation: false, // 禁用动画，提升性能
                            plugins: {
                                legend: { display: false }
                            },
                            scales: {
                                y: {
                                    beginAtZero: true,
                                    ticks: {
                                        precision: 0
                                    }
                                },
                                x: {
                                    ticks: {
                                        maxRotation: 0,
                                        autoSkip: false
                                    }
                                }
                            },
                            layout: {
                                padding: 0
                            }
                        }
                    });
                }
            } catch (e) {
                console.error('Load weekly chart error:', e);
            }
        }

        async function loadAccounts() {
            try {
                const data = await fetchApi('/api/admin/accounts');
                allAccounts = data.data || [];
                renderAccountsPage();
            } catch (e) { console.error(e); }
        }

        async function loadAgtAccounts() {
            if (typeof loadCliProxyAccounts === 'function') {
                await loadCliProxyAccounts();
            }
        }

        function loadAntigravityTemplate() {
            const template = JSON.stringify({
                type: 'antigravity',
                email: 'user@example.com',
                project_id: 'your-project-id',
                access_token: 'ya29.xxxxx',
                refresh_token: '1//0gxxxxx',
                expires_in: 3599,
                expired: new Date(Date.now() + 3600 * 1000).toISOString(),
                timestamp: Date.now()
            }, null, 2);
            document.getElementById('antigravity-import-json').value = template;
        }

        async function importAntigravityAccounts() {
            const jsonContent = document.getElementById('antigravity-import-json').value.trim();
            if (!jsonContent) {
                showToast('请输入 Antigravity JSON 内容', 'warning');
                return;
            }
            try {
                JSON.parse(jsonContent);
            } catch {
                showToast('JSON 格式错误', 'error');
                return;
            }

            try {
                const result = await fetchApi('/api/admin/antigravity-accounts/import', {
                    method: 'POST',
                    body: JSON.stringify({ raw_json: jsonContent })
                });
                await loadAgtAccounts();
                hideModal('antigravityImportModal');
                showToast(`Antigravity 导入完成：成功 ${result.success}，失败 ${result.failed}`, result.failed > 0 ? 'warning' : 'success');
            } catch (e) {
                showToast('Antigravity 导入失败: ' + e.message, 'error');
            }
        }

        function renderAccountsPage() {
            const container = document.getElementById('accounts-table');
            selectedAccounts.clear();
            updateBatchDeleteBtn();

            if (allAccounts.length === 0) {
                container.innerHTML = '<div class="text-center py-12 text-gray-500">暂无账号，点击上方按钮添加</div>';
                document.getElementById('accounts-pagination').classList.add('hidden');
                return;
            }

            document.getElementById('accounts-pagination').classList.remove('hidden');

            // 分页计算
            const totalPages = Math.ceil(allAccounts.length / pageSize);
            const startIdx = (currentPage - 1) * pageSize;
            const endIdx = Math.min(startIdx + pageSize, allAccounts.length);
            const pageAccounts = allAccounts.slice(startIdx, endIdx);

            // 更新分页信息
            document.getElementById('page-start').textContent = startIdx + 1;
            document.getElementById('page-end').textContent = endIdx;
            document.getElementById('total-accounts').textContent = allAccounts.length;
            document.getElementById('prev-btn').disabled = currentPage === 1;
            document.getElementById('next-btn').disabled = currentPage === totalPages;

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
                        ${pageAccounts.map((a, i) => `
                            <tr class="hover:bg-gray-50 transition group ${i % 2 === 1 ? 'bg-gray-50/50' : ''}">
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
                                        ${a.user_email ? `<div class="text-xs text-gray-400 mt-0.5 flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>${a.user_email}</div>` : ''}
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
                                        <div class="flex items-center gap-1"><span class="text-gray-500 w-8 text-right">Err:</span> <span class="${(a.error_count || 0) > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}">${a.error_count || 0}</span></div>
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
                                        ${a.status === 'active'
                    ? `<button onclick="disableAccount('${a.id}', this)" class="p-1 text-orange-600 hover:bg-orange-50 rounded transition" title="禁用"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg></button>`
                    : `<button onclick="enableAccount('${a.id}', this)" class="p-1 text-green-600 hover:bg-green-50 rounded transition" title="启用"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></button>`}
                                        <button onclick="removeAccount('${a.id}', ${a.request_log_count || 0})" class="p-1 rounded transition ${a.has_dependencies ? 'text-orange-600 hover:bg-orange-50' : 'text-red-600 hover:bg-red-50'}" title="${a.has_dependencies ? `强制删除：将同时删除${a.request_log_count || 0}条请求日志` : '删除'}">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>`;
        }

        function renderPageNumbers(totalPages) {
            const container = document.getElementById('page-numbers');
            const maxVisible = 5;
            let pages = [];

            if (totalPages <= maxVisible) {
                pages = Array.from({ length: totalPages }, (_, i) => i + 1);
            } else {
                if (currentPage <= 3) {
                    pages = [1, 2, 3, 4, '...', totalPages];
                } else if (currentPage >= totalPages - 2) {
                    pages = [1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
                } else {
                    pages = [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
                }
            }

            container.innerHTML = pages.map(p => {
                if (p === '...') {
                    return '<span class="px-3 py-1 text-gray-400">...</span>';
                }
                const isActive = p === currentPage;
                return `<button onclick="goToPage(${p})" class="px-3 py-1 rounded ${isActive ? 'bg-blue-500 text-white' : 'border border-gray-300 hover:bg-gray-50'} text-sm">${p}</button>`;
            }).join('');
        }

        function changePage(direction) {
            if (direction === 'prev' && currentPage > 1) {
                currentPage--;
                renderAccountsPage();
            } else if (direction === 'next') {
                const totalPages = Math.ceil(allAccounts.length / pageSize);
                if (currentPage < totalPages) {
                    currentPage++;
                    renderAccountsPage();
                }
            }
        }

        function goToPage(page) {
            currentPage = page;
            renderAccountsPage();
        }

        function toggleSelect(id, checked) {
            if (checked) selectedAccounts.add(id);
            else selectedAccounts.delete(id);
            updateBatchDeleteBtn();
        }

        function toggleSelectAll(checked) {
            document.querySelectorAll('.account-checkbox').forEach(cb => {
                cb.checked = checked;
                if (checked) selectedAccounts.add(cb.dataset.id);
                else selectedAccounts.delete(cb.dataset.id);
            });
            updateBatchDeleteBtn();
        }

        function updateBatchDeleteBtn() {
            const btn = document.getElementById('batchDeleteBtn');
            document.getElementById('selectedCount').textContent = selectedAccounts.size;
            btn.classList.toggle('hidden', selectedAccounts.size === 0);
        }

        async function batchDeleteAccounts() {
            if (selectedAccounts.size === 0) return;
            if (!confirm(`确定删除选中的 ${selectedAccounts.size} 个账号？`)) return;
            try {
                const result = await fetchApi('/api/accounts/batch', { method: 'DELETE', body: JSON.stringify({ ids: Array.from(selectedAccounts) }) });
                showToast(`成功删除 ${result.removed} 个账号`, 'success');
                refresh();
            } catch (e) { showToast('批量删除失败: ' + e.message, 'error'); }
        }

        async function clearLogs() {
            if (!confirm('确定清空所有请求记录？')) return;
            try {
                await fetchApi('/api/logs', { method: 'DELETE' });
                loadLogs();
                loadStatus();
                showToast('记录已清空', 'success');
            } catch (e) { showToast('清空失败: ' + e.message, 'error'); }
        }

        function formatStatus(status) {
            const styles = { active: 'bg-green-100 text-green-700', cooldown: 'bg-yellow-100 text-yellow-700', error: 'bg-red-100 text-red-700', depleted: 'bg-orange-100 text-orange-700', inactive: 'bg-gray-100 text-gray-700', disabled: 'bg-gray-100 text-gray-700' };
            return `<span class="px-2 py-1 rounded-full text-xs font-medium ${styles[status] || styles.disabled}">${status}</span>`;
        }

        function formatUserChannelBadges(channels) {
            const list = Array.isArray(channels) && channels.length > 0 ? channels : ['kiro'];
            return list.map((channel) => {
                let label, color;
                if (channel === 'kiro') {
                    label = 'Kiro';
                    color = 'bg-blue-50 text-blue-700 border-blue-200';
                } else if (channel === 'antigravity' || channel === 'agt') {
                    label = 'Antigravity';
                    color = 'bg-purple-50 text-purple-700 border-purple-200';
                } else if (channel === 'codex') {
                    label = 'Codex';
                    color = 'bg-green-50 text-green-700 border-green-200';
                } else {
                    label = channel;
                    color = 'bg-gray-50 text-gray-700 border-gray-200';
                }
                return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${color}">${label}</span>`;
            }).join('');
        }

        function formatUsage(account) {
            if (!account) return '<span class="text-gray-400 text-sm">未知</span>';

            const used = account.current_usage || 0;
            const limit = account.usage_limit || 0;
            const available = account.available || 0;

            if (limit === 0) return '<span class="text-gray-400 text-sm">未知</span>';

            const percent = Math.round((used / limit) * 100);
            const barColor = percent > 90 ? 'bg-red-500' : percent > 70 ? 'bg-yellow-500' : 'bg-green-500';
            const textColor = percent > 90 ? 'text-red-600' : percent > 70 ? 'text-yellow-600' : 'text-green-600';

            // 订阅类型标签（放在名称旁边，不在这里显示）

            // 格式化重置时间
            let resetInfo = '';
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
            const source = account.machine_id_source || 'unavailable';
            const machineId = account.machine_id || 'N/A';

            // 徽章配置
            const badges = {
                explicit: {
                    label: 'ID: Expl',
                    color: 'bg-emerald-50 text-emerald-600 border-emerald-200',
                    dot: 'bg-emerald-400',
                    title: '显式指定',
                    desc: '凭据中直接提供的 machineId'
                },
                config: {
                    label: 'ID: Conf',
                    color: 'bg-sky-50 text-sky-600 border-sky-200',
                    dot: 'bg-sky-400',
                    title: '配置指定',
                    desc: '从配置文件读取的 machineId'
                },
                derived: {
                    label: 'ID: Auto',
                    color: 'bg-amber-50 text-amber-600 border-amber-200',
                    dot: 'bg-amber-400',
                    title: '自动派生',
                    desc: '从 refreshToken SHA256 派生'
                },
                unavailable: {
                    label: 'ID: None',
                    color: 'bg-slate-50 text-slate-500 border-slate-200',
                    dot: 'bg-slate-300',
                    title: '缺失',
                    desc: '无法获取或生成 machineId'
                }
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
            const method = (authMethod || 'social').toLowerCase();

            const badges = {
                social: {
                    label: 'Google',
                    icon: '<svg class="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>',
                    color: 'bg-white text-gray-600 border-gray-200'
                },
                idc: {
                    label: 'BuilderID',
                    icon: '<svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>',
                    color: 'bg-violet-50 text-violet-600 border-violet-200'
                }
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
            if (!nextReset) return '';

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
                label = '已过期';
                color = 'bg-red-50 text-red-700 border-red-200';
            } else if (diffDays === 0) {
                label = `${Math.max(1, Math.ceil(diffMs / hourMs))}小时后`;
                color = 'bg-orange-50 text-orange-700 border-orange-200';
            } else if (diffDays < 3) {
                label = `${diffDays}天 ${diffHours}小时`;
                color = 'bg-yellow-50 text-yellow-700 border-yellow-200';
            } else {
                label = `${diffDays}天 ${diffHours}小时`;
                color = 'bg-green-50 text-green-700 border-green-200';
            }

            return `
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${color}" title="重置时间: ${resetDate.toLocaleString('zh-CN')}">
                    <span>${label}</span>
                </span>
            `;
        }

        function copyMachineId(machineId, event) {
            event.stopPropagation();
            navigator.clipboard.writeText(machineId).then(() => {
                showToast('Machine ID 已复制', 'success');
            }).catch(() => {
                showToast('复制失败', 'error');
            });
        }

        function formatSubscriptionBadge(subscriptionType) {
            if (!subscriptionType) {
                return '<span class="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium leading-none bg-gray-100 text-gray-500 border border-gray-200">Free</span>';
            }

            const tier = subscriptionType.toLowerCase().replace(/[_\s]/g, '');

            const badges = {
                free: {
                    label: 'Free',
                    color: 'bg-gray-100 text-gray-600 border-gray-200'
                },
                pro: {
                    label: 'Pro',
                    color: 'bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 border-blue-200'
                },
                'pro+': {
                    label: 'Pro+',
                    color: 'bg-gradient-to-r from-purple-50 to-pink-50 text-purple-700 border-purple-200'
                },
                proplus: {
                    label: 'Pro+',
                    color: 'bg-gradient-to-r from-purple-50 to-pink-50 text-purple-700 border-purple-200'
                },
                power: {
                    label: 'Power',
                    color: 'bg-gradient-to-r from-amber-50 to-orange-50 text-amber-700 border-amber-200'
                }
            };

            const badge = badges[tier] || badges.free;

            return `
                <span class="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium leading-none border ${badge.color}">${badge.label}</span>
            `;
        }

        async function refreshUsage(id) {
            try {
                const response = await fetchApi(`/api/admin/accounts/${id}/refresh-usage`, { method: 'POST' });

                if (response.data) {
                    const { usage, status } = response.data;
                    const available = usage?.available || 0;
                    const usageLimit = usage?.usageLimit || 0;

                    let message = '刷新成功';
                    let type = 'success';

                    if (status === 'depleted') {
                        message = `余额不足 (${available}/${usageLimit})，账号已标记为 depleted`;
                        type = 'warning';
                    } else if (status === 'error') {
                        message = `账号异常，已标记为 error`;
                        type = 'error';
                    } else if (available >= 5) {
                        message = `余额充足 (${available}/${usageLimit})`;
                    }

                    showToast(message, type);
                    await loadAccounts();
                    await loadStatus();
                }
            } catch (e) {
                showToast('刷新失败: ' + e.message, 'error');
            }
        }

        async function refreshAllUsage() {
            try {
                showToast('正在刷新所有账号，请稍候...', 'info');

                // 设置较长的超时时间（2分钟）
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 120000);

                const response = await fetch('/api/admin/accounts/refresh-all-usage', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': token
                    },
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error?.message || response.statusText);
                }

                const data = await response.json();
                loadAccounts();

                // 统计成功和失败的数量
                const successCount = data.data.filter(r => r.usage && !r.usage.error).length;
                const failCount = data.data.filter(r => r.usage && r.usage.error).length;

                showToast(`刷新完成！成功: ${successCount}, 失败: ${failCount}`, 'success');
            } catch (e) {
                if (e.name === 'AbortError') {
                    showToast('刷新超时，请稍后重试', 'error');
                } else {
                    showToast('刷新失败: ' + e.message, 'error');
                }
            }
        }

        async function loadLogs() {
            try {
                const data = await fetchApi('/api/admin/logs?limit=1000');
                allLogs = data.data || [];
                renderLogsPage();
            } catch (e) { console.error(e); }
        }

        function renderLogsPage() {
            const container = document.getElementById('logs-table');

            if (!allLogs || allLogs.length === 0) {
                container.innerHTML = '<div class="text-center py-12 text-gray-500">暂无请求记录</div>';
                document.getElementById('logs-pagination').classList.add('hidden');
                return;
            }

            document.getElementById('logs-pagination').classList.remove('hidden');

            // 分页计算
            const totalPages = Math.ceil(allLogs.length / logsPageSize);
            const startIdx = (logsCurrentPage - 1) * logsPageSize;
            const endIdx = Math.min(startIdx + logsPageSize, allLogs.length);
            const pageLogs = allLogs.slice(startIdx, endIdx);

            // 更新分页信息
            document.getElementById('logs-page-start').textContent = startIdx + 1;
            document.getElementById('logs-page-end').textContent = endIdx;
            document.getElementById('total-logs').textContent = allLogs.length;
            document.getElementById('logs-prev-btn').disabled = logsCurrentPage === 1;
            document.getElementById('logs-next-btn').disabled = logsCurrentPage === totalPages;

            // 渲染页码
            renderLogsPageNumbers(totalPages);

            // 渲染表格
            container.innerHTML = `
                <table class="w-full">
                    <thead><tr class="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        <th class="px-4 py-3 rounded-tl-lg">时间</th><th class="px-4 py-3">账号</th><th class="px-4 py-3">模型</th><th class="px-4 py-3">输入</th><th class="px-4 py-3">输出</th><th class="px-4 py-3">耗时</th><th class="px-4 py-3 rounded-tr-lg">状态</th>
                    </tr></thead>
                    <tbody class="divide-y divide-gray-100">
                        ${pageLogs.map((l, i) => `<tr class="hover:bg-gray-50 transition ${i % 2 === 1 ? 'bg-gray-50/50' : ''}">
                            <td class="px-4 py-3 text-sm text-gray-600">${new Date(l.timestamp).toLocaleString()}</td>
                            <td class="px-4 py-3 text-sm text-gray-900">${l.kiro_account_name || l.accountName}</td>
                            <td class="px-4 py-3 text-xs text-gray-500">${l.model || '-'}</td>
                            <td class="px-4 py-3 text-sm text-gray-600">${l.input_tokens || l.inputTokens || 0}</td>
                            <td class="px-4 py-3 text-sm text-gray-600">${l.output_tokens || l.outputTokens || 0}</td>
                            <td class="px-4 py-3 text-sm text-gray-600">${l.duration_ms || l.durationMs}ms</td>
                            <td class="px-4 py-3">${l.success ? '<span class="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">成功</span>' : '<span class="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">失败</span>'}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>`;
        }

        function renderLogsPageNumbers(totalPages) {
            const container = document.getElementById('logs-page-numbers');
            const maxVisible = 5;
            let pages = [];

            if (totalPages <= maxVisible) {
                pages = Array.from({ length: totalPages }, (_, i) => i + 1);
            } else {
                if (logsCurrentPage <= 3) {
                    pages = [1, 2, 3, 4, '...', totalPages];
                } else if (logsCurrentPage >= totalPages - 2) {
                    pages = [1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
                } else {
                    pages = [1, '...', logsCurrentPage - 1, logsCurrentPage, logsCurrentPage + 1, '...', totalPages];
                }
            }

            container.innerHTML = pages.map(p => {
                if (p === '...') {
                    return '<span class="px-3 py-1 text-gray-400">...</span>';
                }
                const isActive = p === logsCurrentPage;
                return `<button onclick="goToLogsPage(${p})" class="px-3 py-1 rounded ${isActive ? 'bg-blue-500 text-white' : 'border border-gray-300 hover:bg-gray-50'} text-sm">${p}</button>`;
            }).join('');
        }

        function changeLogsPage(direction) {
            if (direction === 'prev' && logsCurrentPage > 1) {
                logsCurrentPage--;
                renderLogsPage();
            } else if (direction === 'next') {
                const totalPages = Math.ceil(allLogs.length / logsPageSize);
                if (logsCurrentPage < totalPages) {
                    logsCurrentPage++;
                    renderLogsPage();
                }
            }
        }

        function goToLogsPage(page) {
            logsCurrentPage = page;
            renderLogsPage();
        }

        async function loadStrategy() {
            try { const data = await fetchApi('/api/strategy'); document.getElementById('strategy').value = data.strategy; }
            catch (e) { console.error(e); }
        }

        async function setStrategy(value) {
            try { await fetchApi('/api/strategy', { method: 'POST', body: JSON.stringify({ strategy: value }) }); showToast('策略已更新', 'success'); }
            catch (e) { showToast('设置失败: ' + e.message, 'error'); }
        }

        function switchTab(tab) {
            document.querySelectorAll('.tab-btn').forEach(t => { t.classList.remove('border-blue-500', 'text-blue-600'); t.classList.add('border-transparent', 'text-gray-500'); });
            document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.remove('border-transparent', 'text-gray-500');
            document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('border-blue-500', 'text-blue-600');
            document.querySelectorAll('.tab-content').forEach((c) => {
                c.classList.add('hidden');
            });
            document.getElementById('tab-' + tab).classList.remove('hidden');
            if (tab === 'users') loadUsers();
            if (tab === 'accounts') loadAccounts();
            if (tab === 'antigravity-accounts') {
                // 只在没有缓存数据时才加载
                if (cliproxyAntigravityAccounts.length === 0) {
                    loadCliProxyAccounts();
                } else {
                    renderCliProxyAccounts();
                }
            }
            if (tab === 'logs') {
                loadLogs();
                const toggle = document.getElementById('autoRefreshToggle');
                if (toggle && toggle.checked && !autoRefreshInterval) {
                    autoRefreshInterval = setInterval(() => { loadLogs(); }, 5000);
                }
            } else {
                if (autoRefreshInterval) {
                    clearInterval(autoRefreshInterval);
                    autoRefreshInterval = null;
                }
            }
            if (tab === 'settings') { document.getElementById('baseUrl').textContent = location.origin; }
        }

        async function loadUsers() {
            try {
                const data = await fetchApi('/api/admin/users');
                allUsers = data.data || [];
                renderUsersPage();
            } catch (e) {
                console.error(e);
                showToast('加载用户列表失败: ' + e.message, 'error');
            }
        }

        function renderUsersPage() {
            const container = document.getElementById('users-table');

            if (allUsers.length === 0) {
                container.innerHTML = '<div class="text-center py-12 text-gray-500">暂无用户</div>';
                document.getElementById('users-pagination').classList.add('hidden');
                return;
            }

            document.getElementById('users-pagination').classList.remove('hidden');

            // 分页计算
            const totalPages = Math.ceil(allUsers.length / usersPageSize);
            const startIdx = (usersCurrentPage - 1) * usersPageSize;
            const endIdx = Math.min(startIdx + usersPageSize, allUsers.length);
            const pageUsers = allUsers.slice(startIdx, endIdx);

            // 更新分页信息
            document.getElementById('users-page-start').textContent = startIdx + 1;
            document.getElementById('users-page-end').textContent = endIdx;
            document.getElementById('total-users').textContent = allUsers.length;
            document.getElementById('users-prev-btn').disabled = usersCurrentPage === 1;
            document.getElementById('users-next-btn').disabled = usersCurrentPage === totalPages;

            // 渲染页码
            renderUsersPageNumbers(totalPages);

            // 渲染表格
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
                        ${pageUsers.map((u, i) => `
                            <tr class="hover:bg-gray-50 transition ${i % 2 === 1 ? 'bg-gray-50/50' : ''}">
                                <td class="px-4 py-4">
                                    <div class="font-medium text-gray-900">${u.username}</div>
                                    <div class="text-xs text-gray-500">${u.role === 'admin' ? '管理员' : '普通用户'}</div>
                                    <div class="mt-1 flex items-center gap-1.5 flex-wrap">${formatUserChannelBadges(u.allowed_channels)}</div>
                                    ${u.subscription_type && u.subscription_type !== 'none'
                    ? `<div class="mt-1"><span class="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">${u.subscription_type === 'daily' ? '每日套餐' : '每月套餐'}</span></div>`
                    : ''}
                                </td>
                                <td class="px-4 py-4">
                                    <div class="flex items-center gap-2">
                                        <code class="text-xs bg-gray-100 px-2 py-1 rounded font-mono select-all">${u.api_key}</code>
                                        <button onclick="copyText(\`${u.api_key}\`)" class="text-blue-500 hover:text-blue-700 text-xs" title="复制API Key">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                                            </svg>
                                        </button>
                                    </div>
                                </td>
                                <td class="px-4 py-4">
                                    <span class="font-medium ${u.balance > 0 ? 'text-green-600' : 'text-red-600'}">$${u.balance.toFixed(4)}</span>
                                </td>
                                <td class="px-4 py-4 text-gray-600">${u.total_requests || 0}</td>
                                <td class="px-4 py-4 text-gray-900">$${(u.total_cost || 0).toFixed(4)}</td>
                                <td class="px-4 py-4">
                                    ${u.status === 'active'
                    ? '<span class="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">活跃</span>'
                    : '<span class="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">停用</span>'}
                                </td>
                                <td class="px-4 py-4">
                                    <div class="flex items-center gap-2">
                                        <button
                                            data-user-id="${u.id}"
                                            data-username="${escapeHtml(u.username)}"
                                            onclick="showSubscriptionModalFromButton(this)"
                                            class="p-1.5 text-purple-600 hover:bg-purple-50 rounded transition" title="订阅管理">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                                            </svg>
                                        </button>
                                        <button
                                            data-user-id="${u.id}"
                                            data-username="${escapeHtml(u.username)}"
                                            data-balance="${Number(u.balance) || 0}"
                                            onclick="showRechargeModalFromButton(this)"
                                            class="p-1.5 text-green-600 hover:bg-green-50 rounded transition" title="修改额度">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
                                            </svg>
                                        </button>
                                        <button
                                            data-user-id="${u.id}"
                                            data-username="${escapeHtml(u.username)}"
                                            onclick="showPermissionModalFromButton(this)"
                                            class="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded transition" title="权限管理">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l9-5-9-5-9 5 9 5z"/>
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l6.16-3.422A12.083 12.083 0 0112 20.055a12.083 12.083 0 01-6.16-9.477L12 14z"/>
                                            </svg>
                                        </button>
                                        <button onclick="refreshUserStats('${u.id}')" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition" title="刷新统计">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                                            </svg>
                                        </button>
                                        ${u.status === 'active'
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
                        `).join('')}
                    </tbody>
                </table>
            `;
        }

        function renderUsersPageNumbers(totalPages) {
            const container = document.getElementById('users-page-numbers');
            const maxVisible = 5;
            let pages = [];

            if (totalPages <= maxVisible) {
                pages = Array.from({ length: totalPages }, (_, i) => i + 1);
            } else {
                if (usersCurrentPage <= 3) {
                    pages = [1, 2, 3, 4, '...', totalPages];
                } else if (usersCurrentPage >= totalPages - 2) {
                    pages = [1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
                } else {
                    pages = [1, '...', usersCurrentPage - 1, usersCurrentPage, usersCurrentPage + 1, '...', totalPages];
                }
            }

            container.innerHTML = pages.map(p => {
                if (p === '...') {
                    return '<span class="px-3 py-1 text-gray-400">...</span>';
                }
                const isActive = p === usersCurrentPage;
                return `<button onclick="goToUsersPage(${p})" class="px-3 py-1 rounded ${isActive ? 'bg-blue-500 text-white' : 'border border-gray-300 hover:bg-gray-50'} text-sm">${p}</button>`;
            }).join('');
        }

        function changeUsersPage(direction) {
            if (direction === 'prev' && usersCurrentPage > 1) {
                usersCurrentPage--;
                renderUsersPage();
            } else if (direction === 'next') {
                const totalPages = Math.ceil(allUsers.length / usersPageSize);
                if (usersCurrentPage < totalPages) {
                    usersCurrentPage++;
                    renderUsersPage();
                }
            }
        }

        function goToUsersPage(page) {
            usersCurrentPage = page;
            renderUsersPage();
        }

        function updateUsernamePreview() {
            const username = document.getElementById('new-username').value.trim();
            const count = parseInt(document.getElementById('new-count').value) || 1;
            const preview = document.getElementById('username-preview');

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

        function setSubQuota(amount) {
            document.getElementById('new-subscription-quota').value = amount;

            // 高亮选中的按钮
            document.querySelectorAll('.sub-quota-btn').forEach(btn => {
                btn.classList.remove('border-purple-500', 'bg-purple-50', 'text-purple-600');
                btn.classList.add('border-gray-200');
            });
            event.target.classList.remove('border-gray-200');
            event.target.classList.add('border-purple-500', 'bg-purple-50', 'text-purple-600');
        }

        function setSubDuration(months) {
            document.getElementById('new-subscription-duration').value = months;

            // 高亮选中的按钮
            document.querySelectorAll('.sub-duration-btn').forEach(btn => {
                btn.classList.remove('border-purple-500', 'bg-purple-50', 'text-purple-600');
                btn.classList.add('border-gray-200');
            });
            event.target.classList.remove('border-gray-200');
            event.target.classList.add('border-purple-500', 'bg-purple-50', 'text-purple-600');
        }

        function toggleSubscriptionOptions() {
            const checkbox = document.getElementById('new-with-subscription');
            const options = document.getElementById('subscription-options');
            if (checkbox.checked) {
                options.classList.remove('hidden');
            } else {
                options.classList.add('hidden');
            }
        }

        async function createUser() {
            let username = document.getElementById('new-username').value.trim();
            const count = parseInt(document.getElementById('new-count').value) || 1;
            const balance = parseFloat(document.getElementById('new-balance').value) || 0;
            const withSubscription = document.getElementById('new-with-subscription').checked;

            // 获取渠道权限
            const allowedChannels = [];
            if (document.getElementById('new-channel-kiro').checked) allowedChannels.push('kiro');
            if (document.getElementById('new-channel-antigravity').checked) allowedChannels.push('antigravity');
            if (document.getElementById('new-channel-codex').checked) allowedChannels.push('codex');

            if (allowedChannels.length === 0) {
                showToast('请至少选择一个渠道', 'warning');
                return;
            }

            // 获取订阅配置
            let subType, subQuota, subDuration;
            if (withSubscription) {
                subType = document.querySelector('input[name="sub-type"]:checked').value;
                subQuota = parseFloat(document.getElementById('new-subscription-quota').value);
                subDuration = parseInt(document.getElementById('new-subscription-duration').value);

                if (!subQuota || subQuota <= 0) {
                    showToast('请输入有效的充值额度', 'warning');
                    return;
                }
                if (!subDuration || subDuration <= 0) {
                    showToast('请输入有效的开通时长', 'warning');
                    return;
                }
            }

            try {
                const createdUsers = [];
                const failedUsers = [];

                // 显示进度提示
                if (count > 1) {
                    showToast(`开始创建 ${count} 个用户...`, 'info');
                }

                for (let i = 0; i < count; i++) {
                    try {
                        // 生成唯一用户名
                        let finalUsername = username;
                        if (!finalUsername || count > 1) {
                            // 使用时间戳+随机数确保唯一性
                            const timestamp = Date.now().toString(36);
                            const randomStr = Math.random().toString(36).substring(2, 6);
                            finalUsername = `user_${timestamp}${randomStr}`;
                        }

                        // 创建用户
                        const userResult = await fetchApi('/api/admin/users', {
                            method: 'POST',
                            body: JSON.stringify({
                                username: finalUsername,
                                balance,
                                allowed_channels: allowedChannels
                            })
                        });

                        createdUsers.push(finalUsername);

                        // 如果需要开通订阅
                        if (withSubscription && userResult.data && userResult.data.id) {
                            await fetchApi(`/api/admin/users/${userResult.data.id}/subscription`, {
                                method: 'POST',
                                body: JSON.stringify({
                                    type: subType,
                                    quota: subQuota,
                                    duration: subDuration
                                })
                            });
                        }
                    } catch (e) {
                        console.error(`创建用户失败 (${i + 1}/${count}):`, e);
                        failedUsers.push(i + 1);
                    }
                }

                hideModal('createUserModal');
                document.getElementById('new-username').value = '';
                document.getElementById('new-count').value = '1';
                document.getElementById('new-balance').value = '0';
                document.getElementById('new-channel-kiro').checked = true;
                document.getElementById('new-channel-antigravity').checked = false;
                document.getElementById('new-channel-codex').checked = false;
                document.getElementById('new-with-subscription').checked = true;
                document.getElementById('new-subscription-quota').value = '1800';
                document.getElementById('new-subscription-duration').value = '12';
                toggleSubscriptionOptions();
                updateUsernamePreview();
                loadUsers();

                // 显示结果
                if (failedUsers.length === 0) {
                    if (count === 1) {
                        showToast(`用户 ${createdUsers[0]} 创建成功${withSubscription ? '，订阅已开通' : ''}`, 'success');
                    } else {
                        showToast(`成功创建 ${count} 个用户${withSubscription ? '，订阅已开通' : ''}`, 'success');
                    }
                } else {
                    showToast(`创建完成：成功 ${createdUsers.length} 个，失败 ${failedUsers.length} 个`, 'warning');
                }
            } catch (e) {
                showToast('创建失败: ' + e.message, 'error');
            }
        }

        function showRechargeModal(userId, username, balance) {
            currentRechargeUserId = userId;
            document.getElementById('recharge-username').textContent = username;
            document.getElementById('recharge-balance').textContent = '$' + balance.toFixed(4);
            document.getElementById('recharge-amount').value = '';
            document.getElementById('recharge-notes').value = '';
            showModal('rechargeModal');
        }

        async function doRecharge() {
            const amount = parseFloat(document.getElementById('recharge-amount').value);
            const notes = document.getElementById('recharge-notes').value.trim();

            if (!Number.isFinite(amount) || amount === 0) {
                showToast('请输入有效的调整金额（不能为 0）', 'warning');
                return;
            }

            try {
                await fetchApi(`/api/admin/users/${currentRechargeUserId}/recharge`, {
                    method: 'POST',
                    body: JSON.stringify({ amount, notes })
                });
                hideModal('rechargeModal');
                loadUsers();
                showToast(amount > 0 ? '额度增加成功' : '额度扣减成功', 'success');
            } catch (e) {
                showToast('额度调整失败: ' + e.message, 'error');
            }
        }

        async function deleteUser(userId) {
            if (!confirm('确定删除此用户？此操作不可恢复！')) return;
            try {
                await fetchApi(`/api/admin/users/${userId}`, { method: 'DELETE' });
                loadUsers();
                showToast('用户已删除', 'error');
            } catch (e) {
                showToast('删除失败: ' + e.message, 'error');
            }
        }

        async function refreshUserStats(userId) {
            try {
                showToast('正在刷新统计...', 'info');
                await fetchApi(`/api/admin/users/${userId}`);
                loadUsers();
                showToast('统计已刷新', 'success');
            } catch (e) {
                showToast('刷新失败: ' + e.message, 'error');
            }
        }

        async function toggleUserStatus(userId, newStatus) {
            const action = newStatus === 'active' ? '启用' : '禁用';
            if (newStatus === 'suspended' && !confirm(`确定禁用此用户？`)) return;
            try {
                await fetchApi(`/api/admin/users/${userId}`, {
                    method: 'PUT',
                    body: JSON.stringify({ status: newStatus })
                });
                loadUsers();
                showToast(`用户已${action}`, newStatus === 'active' ? 'success' : 'warning');
            } catch (e) {
                showToast(`${action}失败: ` + e.message, 'error');
            }
        }

        function showModal(id) {
            if (id === 'importModal') resetImportResultView(false);
            document.getElementById(id).classList.remove('hidden');
        }

        function hideModal(id) {
            document.getElementById(id).classList.add('hidden');
            if (id === 'importModal') resetImportResultView(true);
        }
        function toggleIdcFields() { document.getElementById('idc-fields').classList.toggle('hidden', document.getElementById('acc-auth').value !== 'idc'); }

        async function addAccount() {
            const data = { name: document.getElementById('acc-name').value || '未命名账号', auth_method: document.getElementById('acc-auth').value, refresh_token: document.getElementById('acc-refresh').value, client_id: document.getElementById('acc-client-id').value || null, client_secret: document.getElementById('acc-client-secret').value || null };
            if (!data.refresh_token) { showToast('请填写 Refresh Token', 'warning'); return; }
            try { await fetchApi('/api/accounts', { method: 'POST', body: JSON.stringify(data) }); hideModal('addModal'); refresh(); showToast('添加成功', 'success'); }
            catch (e) { showToast('添加失败: ' + e.message, 'error'); }
        }

        function escapeHtml(value) {
            return String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function showSubscriptionModalFromButton(button) {
            showSubscriptionModal(button.dataset.userId, button.dataset.username || '');
        }

        function showRechargeModalFromButton(button) {
            const balance = Number.parseFloat(button.dataset.balance);
            showRechargeModal(
                button.dataset.userId,
                button.dataset.username || '',
                Number.isFinite(balance) ? balance : 0
            );
        }

        function showPermissionModalFromButton(button) {
            showPermissionModal(button.dataset.userId, button.dataset.username || '');
        }

        function renderImportTypeBadge(type) {
            if (type === 'IdC/BuilderId/Enterprise') {
                return '<span class="px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">IdC/BuilderId/Enterprise</span>';
            }
            return '<span class="px-2.5 py-1 rounded-full text-xs font-medium bg-sky-100 text-sky-700">Social</span>';
        }

        function resetImportResultView(clearInput) {
            const inputSection = document.getElementById('import-input-section');
            const resultSection = document.getElementById('import-result-section');
            const submitBtn = document.getElementById('import-submit-btn');
            const resetBtn = document.getElementById('import-reset-btn');
            const failedBlock = document.getElementById('import-failed-block');

            if (inputSection) inputSection.classList.remove('hidden');
            if (resultSection) resultSection.classList.add('hidden');
            if (failedBlock) failedBlock.classList.add('hidden');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>开始导入';
            }
            if (resetBtn) resetBtn.classList.add('hidden');

            if (clearInput) {
                const input = document.getElementById('import-json');
                const fileName = document.getElementById('file-name');
                if (input) input.value = '';
                if (fileName) fileName.textContent = '';
            }
        }

        function renderImportResult(result) {
            const rows = Array.isArray(result.results) ? result.results : [];
            const successRows = rows.filter(item => item.success);
            const failedRows = rows.filter(item => !item.success);

            const idcCount = successRows.filter(item => item.type === 'IdC/BuilderId/Enterprise').length;
            const socialCount = successRows.filter(item => item.type === 'Social').length;

            document.getElementById('import-total-count').textContent = result.total || rows.length;
            document.getElementById('import-success-count').textContent = result.success || successRows.length;
            document.getElementById('import-failed-count').textContent = result.failed || failedRows.length;
            document.getElementById('import-idc-count').textContent = idcCount;
            document.getElementById('import-social-count').textContent = socialCount;

            const statusBadge = document.getElementById('import-result-status');
            if ((result.failed || failedRows.length) > 0) {
                statusBadge.className = 'px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700';
                statusBadge.textContent = '部分失败';
            } else {
                statusBadge.className = 'px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700';
                statusBadge.textContent = '全部成功';
            }

            const successList = document.getElementById('import-success-list');
            if (successRows.length === 0) {
                successList.innerHTML = '<div class="text-sm text-gray-500">没有成功导入的账号</div>';
            } else {
                successList.innerHTML = successRows.map(item => {
                    const name = escapeHtml(item.name || '未命名账号');
                    const type = item.type === 'IdC/BuilderId/Enterprise' ? 'IdC/BuilderId/Enterprise' : 'Social';
                    return `<div class="flex items-center justify-between gap-3 border border-gray-100 rounded-lg px-3 py-2"><span class="text-gray-800 break-all">${name}</span>${renderImportTypeBadge(type)}</div>`;
                }).join('');
            }

            const failedBlock = document.getElementById('import-failed-block');
            const failedList = document.getElementById('import-failed-list');
            if (failedRows.length > 0) {
                failedBlock.classList.remove('hidden');
                failedList.innerHTML = failedRows.map(item => {
                    const name = escapeHtml(item.name || '未命名账号');
                    const error = escapeHtml(item.error || '未知错误');
                    return `<div class="bg-white border border-red-100 rounded-lg px-3 py-2"><div class="font-medium text-red-700 break-all">${name}</div><div class="text-xs text-red-500 mt-1 break-all">${error}</div></div>`;
                }).join('');
            } else {
                failedBlock.classList.add('hidden');
                failedList.innerHTML = '';
            }

            document.getElementById('import-input-section').classList.add('hidden');
            document.getElementById('import-result-section').classList.remove('hidden');
            document.getElementById('import-reset-btn').classList.remove('hidden');
        }

        async function importAccounts() {
            let jsonContent = document.getElementById('import-json').value.trim();
            if (!jsonContent) { showToast('请选择文件或粘贴 JSON 内容', 'warning'); return; }
            try { JSON.parse(jsonContent); } catch { showToast('JSON 格式错误', 'error'); return; }

            const submitBtn = document.getElementById('import-submit-btn');
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>导入中...';

            try {
                const result = await fetchApi('/api/admin/accounts/import', { method: 'POST', body: JSON.stringify({ raw_json: jsonContent }) });
                await loadAccounts();
                await loadStatus();
                renderImportResult(result);
                showToast(`导入完成！成功: ${result.success} 个，失败: ${result.failed} 个`, result.failed > 0 ? 'warning' : 'success');
            } catch (e) { showToast('导入失败: ' + e.message, 'error'); }
            finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>开始导入';
            }
        }

        function handleFileSelect(event) {
            const file = event.target.files[0];
            if (!file) return;
            document.getElementById('file-name').textContent = `已选择: ${file.name}`;
            const reader = new FileReader();
            reader.onload = (e) => { document.getElementById('import-json').value = e.target.result; };
            reader.readAsText(file);
        }

        function loadTemplate(type) {
            let template;
            if (type === 'social') {
                template = JSON.stringify([{
                    name: "Google账号示例",
                    refreshToken: "aor_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
                    authMethod: "social",
                    provider: "Google"
                }], null, 2);
            } else if (type === 'builderid') {
                template = JSON.stringify([{
                    name: "BuilderId账号示例",
                    refreshToken: "aor_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
                    authMethod: "idc",
                    clientId: "your-client-id",
                    clientSecret: "your-client-secret",
                    region: "us-east-1",
                    provider: "BuilderId"
                }], null, 2);
            } else if (type === 'enterprise') {
                template = JSON.stringify([{
                    name: "Enterprise账号示例",
                    refreshToken: "aor_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
                    authMethod: "idc",
                    clientId: "your-client-id",
                    clientSecret: "your-client-secret",
                    region: "us-east-1",
                    provider: "Enterprise"
                }], null, 2);
            }
            document.getElementById('import-json').value = template;
            showToast('模板已加载，请替换示例数据', 'info');
        }

        async function removeAccount(id, dependencyCount = 0) {
            let force = false;
            if (dependencyCount > 0) {
                const confirmed = confirm(`该账号存在 ${dependencyCount} 条请求日志。\n\n强制删除将同时删除这些日志，且不可恢复。\n\n确认强制删除？`);
                if (!confirmed) return;
                force = true;
            } else {
                if (!confirm('确定删除此账号？')) return;
            }

            try {
                const url = force ? `/api/admin/accounts/${id}?force=true` : `/api/admin/accounts/${id}`;
                const result = await fetchApi(url, { method: 'DELETE' });
                refresh();
                if (force) {
                    const deletedLogs = result?.data?.deletedLogs ?? dependencyCount;
                    showToast(`账号已强制删除，并清理 ${deletedLogs} 条请求日志`, 'warning');
                } else {
                    showToast('账号已删除', 'success');
                }
            }
            catch (e) {
                if (e.status === 409) {
                    const depCount = e.payload?.error?.dependencyCount;
                    if (depCount !== undefined) {
                        showToast(`无法删除：存在 ${depCount} 条请求日志，请改用“禁用”`, 'warning');
                    } else {
                        showToast('无法删除：账号存在关联数据，请改用“禁用”', 'warning');
                    }
                    return;
                }
                showToast('删除失败: ' + e.message, 'error');
            }
        }

        async function enableAccount(id, buttonEl = null) {
            const originalHtml = buttonEl ? buttonEl.innerHTML : '';
            try {
                if (buttonEl) {
                    buttonEl.disabled = true;
                    buttonEl.classList.add('opacity-60', 'cursor-wait');
                    buttonEl.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"></path></svg>';
                }
                await fetchApi(`/api/admin/accounts/${id}/enable`, { method: 'POST' });
                const target = allAccounts.find(a => a.id === id);
                if (target) {
                    target.status = 'active';
                    renderAccountsPage();
                }
                loadStatus();
                showToast('账号已启用', 'success');
            }
            catch (e) { showToast('启用失败: ' + e.message, 'error'); }
            finally {
                if (buttonEl) {
                    buttonEl.disabled = false;
                    buttonEl.classList.remove('opacity-60', 'cursor-wait');
                    buttonEl.innerHTML = originalHtml;
                }
            }
        }

        async function disableAccount(id, buttonEl = null) {
            if (!confirm('确定禁用此账号？')) return;
            const originalHtml = buttonEl ? buttonEl.innerHTML : '';
            try {
                if (buttonEl) {
                    buttonEl.disabled = true;
                    buttonEl.classList.add('opacity-60', 'cursor-wait');
                    buttonEl.innerHTML = '<svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"></path></svg>';
                }
                await fetchApi(`/api/admin/accounts/${id}/disable`, { method: 'POST' });
                const target = allAccounts.find(a => a.id === id);
                if (target) {
                    target.status = 'disabled';
                    renderAccountsPage();
                }
                loadStatus();
                showToast('账号已禁用', 'warning');
            }
            catch (e) { showToast('禁用失败: ' + e.message, 'error'); }
            finally {
                if (buttonEl) {
                    buttonEl.disabled = false;
                    buttonEl.classList.remove('opacity-60', 'cursor-wait');
                    buttonEl.innerHTML = originalHtml;
                }
            }
        }

        function exportAccountJson(id) {
            const account = allAccounts.find(a => a.id === id);
            if (!account) {
                showToast('账号不存在', 'error');
                return;
            }

            // 构建导出的 JSON 对象（与导入格式一致）
            const exportData = {
                name: account.name,
                refreshToken: account.refresh_token,
                authMethod: account.auth_method
            };

            // 如果是 IdC 账号，添加额外字段
            if (account.auth_method === 'idc') {
                exportData.clientId = account.client_id;
                exportData.clientSecret = account.client_secret;
                exportData.region = account.region || 'us-east-1';
            }

            // 添加 provider 字段（必需）
            // 根据 authMethod 推断 provider
            if (account.auth_method === 'social') {
                // Social 账号默认为 Google，可以根据 user_email 判断
                exportData.provider = 'Google';
            } else {
                // IdC 账号默认为 BuilderId
                exportData.provider = 'BuilderId';
            }

            // 复制到剪贴板
            const jsonStr = JSON.stringify(exportData, null, 2);
            navigator.clipboard.writeText(jsonStr).then(() => {
                showToast('账号 JSON 已复制到剪贴板', 'success');
            }).catch(() => {
                showToast('复制失败', 'error');
            });
        }

        async function changeAdminKey() {
            const newKey = document.getElementById('new-admin-key').value.trim();
            if (!newKey) { showToast('请输入新的管理密钥', 'warning'); return; }
            if (newKey.length < 6) { showToast('密钥长度至少 6 位', 'warning'); return; }
            if (!confirm('确定修改管理密钥？修改后需要重新登录。')) return;
            try {
                await fetchApi('/api/admin/settings/admin-key', {
                    method: 'PUT',
                    body: JSON.stringify({ newKey: newKey })
                });
                showToast('修改成功！请重新登录', 'success');
                setTimeout(() => logout(), 1500);
            }
            catch (e) { showToast('修改失败: ' + e.message, 'error'); }
        }

        async function loadApiKeys() {
            try {
                const keys = await fetchApi('/api/settings/api-keys');
                const container = document.getElementById('api-keys-list');
                if (!keys || keys.length === 0) { container.innerHTML = '<div class="text-gray-500">暂无 API 密钥</div>'; return; }
                container.innerHTML = `<table class="w-full"><thead><tr class="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"><th class="px-4 py-3 rounded-tl-lg">密钥</th><th class="px-4 py-3 rounded-tr-lg">操作</th></tr></thead><tbody class="divide-y divide-gray-100">${keys.map(k => `<tr class="hover:bg-gray-50 transition"><td class="px-4 py-3 font-mono text-sm text-gray-900">${k.key}</td><td class="px-4 py-3"><button onclick="copyText('${k.key}')" class="text-blue-500 hover:text-blue-700 text-sm font-medium mr-3">复制</button><button onclick="removeApiKey('${k.key}')" class="text-red-500 hover:text-red-700 text-sm font-medium">删除</button></td></tr>`).join('')}</tbody></table>`;
            } catch (e) { console.error(e); }
        }

        async function addApiKey() {
            const newKey = document.getElementById('new-api-key').value.trim();
            if (!newKey) { showToast('请输入 API 密钥', 'warning'); return; }
            if (newKey.length < 6) { showToast('密钥长度至少 6 位', 'warning'); return; }
            try { await fetchApi('/api/settings/api-keys', { method: 'POST', body: JSON.stringify({ key: newKey }) }); document.getElementById('new-api-key').value = ''; loadApiKeys(); showToast('添加成功', 'success'); }
            catch (e) { showToast('添加失败: ' + e.message, 'error'); }
        }

        async function removeApiKey(key) {
            if (!confirm('确定删除此 API 密钥？')) return;
            try { await fetchApi('/api/settings/api-keys', { method: 'DELETE', body: JSON.stringify({ key }) }); loadApiKeys(); showToast('删除成功', 'success'); }
            catch (e) { showToast('删除失败: ' + e.message, 'error'); }
        }

        function copyText(text) {
            // Check if Clipboard API is available (requires HTTPS)
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => {
                    showToast('已复制到剪贴板', 'success');
                }).catch(() => {
                    fallbackCopy(text);
                });
            } else {
                // Fallback for HTTP or older browsers
                fallbackCopy(text);
            }
        }

        function fallbackCopy(text) {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                showToast('已复制到剪贴板', 'success');
            } catch (err) {
                showToast('复制失败，请手动复制', 'error');
            }
            document.body.removeChild(textarea);
        }

        // ==================== Subscription Management ====================

        let currentSubscriptionUserId = null;
        let currentPermissionUserId = null;

        function normalizeModelListText(value) {
            return String(value || '')
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean);
        }

        const ALL_MODELS = {
            kiro: [
                { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' },
                { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5' },
                { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
                { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
                { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' }
            ],
            antigravity: [
                { id: 'gemini-3-pro-high', name: 'Gemini 3 Pro High' },
                { id: 'gemini-3-flash', name: 'Gemini 3 Flash' },
                { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
                { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
                { id: 'claude-sonnet-4-5-thinking', name: 'Claude Sonnet 4.5 (Thinking)' },
                { id: 'claude-opus-4-5-thinking', name: 'Claude Opus 4.5 (Thinking)' },
                { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)' }
            ],
            codex: [
                { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex' },
                { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex' },
                { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max' },
                { id: 'gpt-5.2', name: 'GPT-5.2' },
                { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini' }
            ]
        };

        async function showPermissionModal(userId, username) {
            currentPermissionUserId = userId;
            document.getElementById('permission-username').textContent = `用户：${username}`;

            // 重置复选框
            document.querySelectorAll('.channel-checkbox').forEach(cb => {
                cb.checked = false;
            });

            try {
                const response = await fetchApi(`/api/admin/users/${userId}`);
                const user = response?.data || {};
                const channels = Array.isArray(user.allowed_channels) && user.allowed_channels.length > 0
                    ? user.allowed_channels
                    : ['kiro'];

                // 勾选用户拥有的渠道
                channels.forEach(ch => {
                    const cb = document.getElementById(`perm-channel-${ch}`);
                    if (cb) cb.checked = true;
                });

                // 如果没有任何渠道被勾选（异常情况），默认勾选 Kiro
                if (document.querySelectorAll('.channel-checkbox:checked').length === 0) {
                    const kiroCb = document.getElementById('perm-channel-kiro');
                    if (kiroCb) kiroCb.checked = true;
                }

                window.currentUserModels = Array.isArray(user.allowed_models) ? user.allowed_models : [];
                updateModelCheckboxes();

                // 绑定事件
                document.querySelectorAll('.channel-checkbox').forEach(cb => {
                    cb.removeEventListener('change', updateModelCheckboxes); // 防止重复绑定
                    cb.addEventListener('change', updateModelCheckboxes);
                });
            } catch (e) {
                showToast('加载权限失败: ' + e.message, 'error');
            }

            showModal('permissionModal');
        }

        function updateModelCheckboxes() {
            const container = document.getElementById('perm-models-container');
            container.innerHTML = '';

            const selectedChannels = Array.from(document.querySelectorAll('.channel-checkbox:checked')).map(cb => cb.value);
            const userModels = window.currentUserModels || [];

            if (selectedChannels.length === 0) {
                container.innerHTML = '<div class="text-sm text-gray-500 text-center py-8">请先勾选上方渠道</div>';
                return;
            }

            // 使用字符串拼接构建所有 HTML，一次性插入 DOM
            let containerHTML = '';

            selectedChannels.forEach(channel => {
                const models = ALL_MODELS[channel] || [];
                if (models.length === 0) return;

                const channelNames = {
                    'kiro': 'Kiro',
                    'antigravity': 'Antigravity',
                    'codex': 'Codex'
                };
                const channelColors = {
                    'kiro': 'text-blue-600 bg-blue-50',
                    'antigravity': 'text-purple-600 bg-purple-50',
                    'codex': 'text-blue-600 bg-blue-50'
                };
                const borderColors = {
                    'kiro': 'border-blue-100',
                    'antigravity': 'border-purple-100',
                    'codex': 'border-blue-100'
                };
                
                const channelName = channelNames[channel] || channel;
                const channelColor = channelColors[channel] || 'text-gray-600 bg-gray-50';
                const borderColor = borderColors[channel] || 'border-gray-100';

                // 构建模型复选框 HTML
                const modelsHTML = models.map(m => {
                    const isChecked = userModels.includes(m.id);
                    return `
                        <label class="flex items-center gap-2 text-sm text-gray-700 hover:bg-gray-50 p-1.5 rounded cursor-pointer transition">
                            <input type="checkbox" value="${m.id}" ${isChecked ? 'checked' : ''} class="rounded border-gray-300 text-indigo-500 focus:ring-indigo-500 model-checkbox model-checkbox-${channel}">
                            <span class="truncate" title="${m.name}">${m.name}</span>
                        </label>
                    `;
                }).join('');

                // 构建完整的渠道分组 HTML
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

            // 一次性插入所有 HTML，只触发一次 DOM 重排
            container.innerHTML = containerHTML;
        }

        function batchSelectModels(channel, selectAll) {
            document.querySelectorAll(`.model-checkbox-${channel}`).forEach(cb => {
                cb.checked = selectAll;
            });
        }

        async function saveUserPermissions() {
            if (!currentPermissionUserId) return;

            const selectedChannels = Array.from(document.querySelectorAll('.channel-checkbox:checked')).map(cb => cb.value);

            if (selectedChannels.length === 0) {
                showToast('请至少选择一个渠道', 'warning');
                return;
            }

            const modelCheckboxes = document.querySelectorAll('.model-checkbox:checked');
            const models = Array.from(modelCheckboxes).map(cb => cb.value);

            try {
                await fetchApi(`/api/admin/users/${currentPermissionUserId}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        allowed_channels: selectedChannels,
                        allowed_models: models
                    })
                });

                hideModal('permissionModal');
                await loadUsers();
                showToast('权限已更新', 'success');
            } catch (e) {
                showToast('保存权限失败: ' + e.message, 'error');
            }
        }

        function showSubscriptionModal(userId, username) {
            currentSubscriptionUserId = userId;
            document.getElementById('sub-username').textContent = username;

            // 重置表单
            document.getElementById('sub-type').value = '';
            document.getElementById('sub-quota').value = '';
            document.getElementById('sub-duration').value = '';
            document.querySelectorAll('input[name="sub-type-radio"]').forEach((r) => {
                r.checked = false;
            });
            document.getElementById('subscription-preview').classList.add('hidden');

            // Load current subscription info
            fetchApi(`/api/admin/users/${userId}/subscription`)
                .then(data => {
                    const sub = data.data;
                    if (sub.subscription_type && sub.subscription_type !== 'none') {
                        document.getElementById('sub-type').value = sub.subscription_type;
                        document.getElementById('sub-quota').value = sub.subscription_quota || '';

                        // 选中对应的 radio
                        const radio = document.querySelector(`input[name="sub-type-radio"][value="${sub.subscription_type}"]`);
                        if (radio) radio.checked = true;

                        updatePreview();
                    }
                })
                .catch(e => {
                    console.error('Load subscription error:', e);
                });

            showModal('subscriptionModal');
        }

        function updateSubscriptionType(type) {
            document.getElementById('sub-type').value = type;
            updatePreview();
        }

        function applyTemplate(type, quota, duration) {
            // 设置类型
            document.getElementById('sub-type').value = type;
            const radio = document.querySelector(`input[name="sub-type-radio"][value="${type}"]`);
            if (radio) radio.checked = true;

            // 设置额度和时长
            document.getElementById('sub-quota').value = quota;
            document.getElementById('sub-duration').value = duration;

            // 高亮选中的按钮
            document.querySelectorAll('.duration-btn').forEach(btn => {
                btn.classList.remove('border-purple-500', 'bg-purple-50', 'text-purple-600');
            });

            updatePreview();
            showToast('已应用套餐模板', 'success');
        }

        function setDuration(months) {
            document.getElementById('sub-duration').value = months;

            // 高亮选中的按钮
            document.querySelectorAll('.duration-btn').forEach(btn => {
                btn.classList.remove('border-purple-500', 'bg-purple-50');
            });
            event.target.closest('.duration-btn').classList.add('border-purple-500', 'bg-purple-50');

            updatePreview();
        }

        function updatePreview() {
            const type = document.getElementById('sub-type').value;
            const quota = parseFloat(document.getElementById('sub-quota').value);
            const months = parseInt(document.getElementById('sub-duration').value);

            const preview = document.getElementById('subscription-preview');

            if (!type || !quota || !months) {
                preview.classList.add('hidden');
                return;
            }

            preview.classList.remove('hidden');

            // 更新预览信息
            const typeName = type === 'daily' ? '每日重置' : '每月重置';
            document.getElementById('preview-type').textContent = typeName;
            document.getElementById('preview-quota').textContent = '$' + quota.toFixed(2);
            document.getElementById('preview-duration').textContent = months + ' 个月';

            // 计算到期日期（使用自然月）
            const now = new Date();
            const expiresDate = new Date(now);
            expiresDate.setMonth(expiresDate.getMonth() + months);

            // 格式化日期，显示星期几
            const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
            const expiresStr = expiresDate.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }) + ' ' + weekdays[expiresDate.getDay()];

            document.getElementById('preview-expires').textContent = expiresStr;

            // 计算预计总充值
            let totalResets = 0;
            let resetFrequency = '';

            if (type === 'daily') {
                // 每日重置：计算这几个月总共有多少天
                let totalDays = 0;
                const tempDate = new Date(now);
                for (let i = 0; i < months; i++) {
                    const daysInMonth = new Date(tempDate.getFullYear(), tempDate.getMonth() + 1, 0).getDate();
                    totalDays += daysInMonth;
                    tempDate.setMonth(tempDate.getMonth() + 1);
                }
                totalResets = totalDays;
                resetFrequency = '每天充值一次';
            } else if (type === 'monthly') {
                // 每月重置：就是月数
                totalResets = months;
                resetFrequency = '每月充值一次';
            }

            const totalAmount = quota * totalResets;
            document.getElementById('preview-total').textContent =
                '$' + totalAmount.toFixed(2) + ' (' + totalResets + ' 次 · ' + resetFrequency + ')';
        }

        async function setSubscription() {
            const type = document.getElementById('sub-type').value;
            const quota = parseFloat(document.getElementById('sub-quota').value);
            const months = parseInt(document.getElementById('sub-duration').value);

            if (!type) {
                showToast('请选择订阅类型', 'warning');
                return;
            }

            if (!quota || quota <= 0) {
                showToast('请输入有效的充值额度', 'warning');
                return;
            }

            if (!months || months <= 0) {
                showToast('请输入有效的订阅时长', 'warning');
                return;
            }

            try {
                await fetchApi(`/api/admin/users/${currentSubscriptionUserId}/subscription`, {
                    method: 'POST',
                    body: JSON.stringify({ type, quota, duration: months })
                });
                hideModal('subscriptionModal');
                loadUsers();
                showToast('订阅设置成功', 'success');
            } catch (e) {
                showToast('设置失败: ' + e.message, 'error');
            }
        }

        async function cancelSubscription() {
            if (!confirm('确定取消此用户的订阅？\n\n取消后将停止自动充值，但不会扣除已充值的余额。')) return;

            try {
                await fetchApi(`/api/admin/users/${currentSubscriptionUserId}/subscription`, {
                    method: 'DELETE'
                });
                hideModal('subscriptionModal');
                loadUsers();
                showToast('订阅已取消', 'success');
            } catch (e) {
                showToast('取消失败: ' + e.message, 'error');
            }
        }

        async function refresh() { loadStatus(); loadUsers(); loadAccounts(); }

