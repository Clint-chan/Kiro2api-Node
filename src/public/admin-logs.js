        let logsCurrentPage = 1;
        let logsPageSize = 20;
        let allLogs = [];

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

            const totalPages = Math.ceil(allLogs.length / logsPageSize);
            const startIdx = (logsCurrentPage - 1) * logsPageSize;
            const endIdx = Math.min(startIdx + logsPageSize, allLogs.length);
            const pageLogs = allLogs.slice(startIdx, endIdx);

            document.getElementById('logs-page-start').textContent = startIdx + 1;
            document.getElementById('logs-page-end').textContent = endIdx;
            document.getElementById('total-logs').textContent = allLogs.length;
            document.getElementById('logs-prev-btn').disabled = logsCurrentPage === 1;
            document.getElementById('logs-next-btn').disabled = logsCurrentPage === totalPages;

            renderLogsPageNumbers(totalPages);

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
