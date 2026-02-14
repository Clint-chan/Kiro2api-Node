        let token = localStorage.getItem('kiro_token');
        let adminKey = token || '';
        let adminLogoutHandler = null;

        function setAdminLogoutHandler(handler) {
            adminLogoutHandler = typeof handler === 'function' ? handler : null;
        }

        function showToast(message, type = 'info') {
            const container = document.getElementById('toast-container');
            const colors = { success: 'bg-green-500', error: 'bg-red-500', info: 'bg-blue-500', warning: 'bg-yellow-500' };
            const toast = document.createElement('div');
            toast.className = `${colors[type]} text-white px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slideIn`;
            toast.textContent = message;
            container.appendChild(toast);
            setTimeout(() => { toast.classList.add('animate-slideOut'); setTimeout(() => toast.remove(), 300); }, 3000);
        }

        async function fetchApi(url, options = {}) {
            const res = await fetch(url, {
                ...options,
                headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey, ...options.headers }
            });

            if (res.status === 401) {
                if (adminLogoutHandler) {
                    adminLogoutHandler();
                }
                throw new Error('认证失败');
            }

            if (!res.ok && res.status !== 204) {
                const error = await res.json().catch(() => ({}));
                const err = new Error(error.error?.message || res.statusText);
                err.status = res.status;
                err.payload = error;
                throw err;
            }

            return res.status === 204 ? null : res.json();
        }

        function escapeHtml(value) {
            return String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function copyText(text) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => {
                    showToast('已复制到剪贴板', 'success');
                }).catch(() => {
                    fallbackCopy(text);
                });
            } else {
                fallbackCopy(text);
            }
        }

        function fallbackCopy(text) {
            window.prompt('复制失败，请手动复制:', String(text ?? ''));
            showToast('复制失败，请手动复制', 'error');
        }

        function getPaginationPages(currentPage, totalPages, maxVisible = 5) {
            if (totalPages <= 0) {
                return [];
            }
            if (totalPages <= maxVisible) {
                return Array.from({ length: totalPages }, (_, i) => i + 1);
            }
            if (currentPage <= 3) {
                return [1, 2, 3, 4, '...', totalPages];
            }
            if (currentPage >= totalPages - 2) {
                return [1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
            }
            return [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
        }
