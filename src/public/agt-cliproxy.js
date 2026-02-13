// CLIProxyAPI AGT Management Functions

let cliproxyAgtAccounts = [];
let agtQuotaCache = {};
let isLoadingQuota = false;

async function loadCliProxyAgtAccounts() {
    try {
        const result = await fetchApi('/api/admin/cliproxy/auth-files');
        cliproxyAgtAccounts = result.files || [];
        renderCliProxyAgtAccounts();
        
        await refreshAllAgtQuotas();
    } catch (e) {
        showToast('加载 AGT 账号失败: ' + e.message, 'error');
    }
}

async function refreshAllAgtQuotas() {
    if (isLoadingQuota) return;
    
    const agtAccounts = cliproxyAgtAccounts.filter(f => f.provider === 'antigravity' && !f.disabled);
    if (agtAccounts.length === 0) return;
    
    isLoadingQuota = true;
    
    agtAccounts.forEach(account => {
        agtQuotaCache[account.name] = { status: 'loading' };
    });
    renderCliProxyAgtAccounts();
    
    const results = await Promise.all(
        agtAccounts.map(async (account) => {
            const authIndex = account.auth_index || account.authIndex;
            if (!authIndex) return { name: account.name, status: 'error', error: '缺少 auth_index' };
            
            const projectId = 'bamboo-precept-lgxtn';
            try {
                const quota = await fetchAgtQuota(authIndex, projectId);
                return { name: account.name, status: 'success', data: quota };
            } catch (e) {
                return { name: account.name, status: 'error', error: e.message };
            }
        })
    );
    
    results.forEach(result => {
        if (result.status === 'success') {
            console.log('[AGT Quota] Cache update (batch)', {
                account: result.name,
                status: 'success',
                modelCount: Object.keys(result.data || {}).length
            });
            agtQuotaCache[result.name] = { status: 'success', data: result.data };
        } else {
            console.log('[AGT Quota] Cache update (batch)', {
                account: result.name,
                status: 'error',
                error: result.error
            });
            agtQuotaCache[result.name] = { status: 'error', error: result.error };
        }
    });
    
    isLoadingQuota = false;
    renderCliProxyAgtAccounts();
}

function renderCliProxyAgtAccounts() {
    const container = document.getElementById('cliproxy-agt-accounts-table');
    if (!container) return;

    if (!cliproxyAgtAccounts.length) {
        container.innerHTML = '<div class="text-center py-10 text-gray-500">暂无 AGT 账号，点击上方按钮上传凭证</div>';
        return;
    }

    const agtAccounts = cliproxyAgtAccounts.filter(f => f.provider === 'antigravity');

    container.innerHTML = `
        <table class="w-full">
            <thead>
                <tr class="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th class="px-4 py-3 rounded-tl-lg">邮箱</th>
                    <th class="px-4 py-3">状态</th>
                    <th class="px-4 py-3">模型额度</th>
                    <th class="px-4 py-3">创建时间</th>
                    <th class="px-4 py-3">最后刷新</th>
                    <th class="px-4 py-3 rounded-tr-lg">操作</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
                ${agtAccounts.map((a, i) => `
                    <tr class="hover:bg-gray-50 transition ${i % 2 === 1 ? 'bg-gray-50/50' : ''}">
                        <td class="px-4 py-4">
                            <div class="font-medium text-gray-900">${a.email || a.id}</div>
                            <div class="text-xs text-gray-500">${a.name}</div>
                        </td>
                        <td class="px-4 py-4">${formatCliProxyStatus(a)}</td>
                        <td class="px-4 py-4">${formatAgtQuota(a)}</td>
                        <td class="px-4 py-4 text-sm text-gray-600">${formatDateTime(a.created_at)}</td>
                        <td class="px-4 py-4 text-sm text-gray-600">${formatDateTime(a.last_refresh)}</td>
                        <td class="px-4 py-4">
                            <div class="flex items-center gap-2">
                                <button onclick="refreshSingleAgtQuota(${JSON.stringify(a).replace(/"/g, '&quot;')})" class="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition" title="刷新额度">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                                </button>
                                ${a.disabled
                                    ? `<button onclick="toggleCliProxyAgtAccount('${a.name}', false)" class="p-1.5 text-green-600 hover:bg-green-50 rounded transition" title="启用">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                                    </button>`
                                    : `<button onclick="toggleCliProxyAgtAccount('${a.name}', true)" class="p-1.5 text-orange-600 hover:bg-orange-50 rounded transition" title="禁用">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg>
                                    </button>`}
                                <button onclick="deleteCliProxyAgtAccount('${a.name}')" class="p-1.5 text-red-600 hover:bg-red-50 rounded transition" title="删除">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                </button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
}

function formatCliProxyStatus(account) {
    if (account.disabled) {
        return '<span class="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">已禁用</span>';
    }
    if (account.status === 'active') {
        return '<span class="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">正常</span>';
    }
    if (account.status === 'error') {
        return '<span class="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">错误</span>';
    }
    return '<span class="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">未知</span>';
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function toggleCliProxyAgtAccount(name, disabled) {
    try {
        await fetchApi('/api/admin/cliproxy/auth-files/status', {
            method: 'PATCH',
            body: JSON.stringify({ name, disabled })
        });
        showToast(disabled ? 'AGT 账号已禁用' : 'AGT 账号已启用', disabled ? 'warning' : 'success');
        await loadCliProxyAgtAccounts();
    } catch (e) {
        showToast((disabled ? '禁用' : '启用') + '失败: ' + e.message, 'error');
    }
}

async function deleteCliProxyAgtAccount(name) {
    if (!confirm(`确定删除 AGT 账号 ${name}？`)) return;
    try {
        await fetchApi(`/api/admin/cliproxy/auth-files?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
        showToast('AGT 账号已删除', 'success');
        await loadCliProxyAgtAccounts();
    } catch (e) {
        showToast('删除失败: ' + e.message, 'error');
    }
}

async function fetchAgtQuota(authIndex, projectId) {
    console.log('[AGT Quota] Start fetch quota', { authIndex, projectId });

    const result = await fetchApi('/api/admin/cliproxy/api-call', {
        method: 'POST',
        body: JSON.stringify({
            authIndex,
            method: 'POST',
            url: 'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
            header: {
                'Authorization': 'Bearer $TOKEN$',
                'Content-Type': 'application/json',
                'User-Agent': 'antigravity/1.11.5 windows/amd64'
            },
            data: JSON.stringify({ project: projectId })
        })
    });

    console.log('[AGT Quota] Raw API call result', {
        statusCode: result?.status_code || result?.statusCode,
        bodyType: typeof result?.body
    });

    const parseJsonSafe = (value, label) => {
        if (typeof value !== 'string') return value;
        try {
            return JSON.parse(value);
        } catch (error) {
            console.log('[AGT Quota] JSON parse failed', { label, error: error.message, valueSnippet: value.slice(0, 240) });
            throw new Error(`解析额度数据失败: ${label}`);
        }
    };

    const normalizeModels = (models) => {
        if (!models) return {};
        if (Array.isArray(models)) {
            return models.reduce((acc, item, index) => {
                const key = item?.modelId || item?.model_id || item?.displayName || item?.display_name || `model_${index}`;
                acc[key] = item;
                return acc;
            }, {});
        }
        if (typeof models === 'object') {
            return models;
        }
        return {};
    };

    const extractModelsFromPayload = (payload) => {
        const parsedPayload = parseJsonSafe(payload, 'outer-body');
        if (!parsedPayload || typeof parsedPayload !== 'object') {
            return {};
        }

        const nestedCandidates = [
            parsedPayload,
            parsedPayload.body,
            parsedPayload.data,
            parsedPayload.response,
            parsedPayload.body?.body
        ];

        for (const candidate of nestedCandidates) {
            const parsedCandidate = parseJsonSafe(candidate, 'nested-body');
            if (!parsedCandidate || typeof parsedCandidate !== 'object') continue;

            const normalizedModels = normalizeModels(parsedCandidate.models);
            if (Object.keys(normalizedModels).length > 0) {
                return normalizedModels;
            }
        }

        return {};
    };
    
    if ((result.status_code || result.statusCode) >= 200 && (result.status_code || result.statusCode) < 300) {
        const models = extractModelsFromPayload(result.body);
        console.log('[AGT Quota] Parsed models', {
            authIndex,
            modelCount: Object.keys(models).length,
            modelKeys: Object.keys(models).slice(0, 10)
        });
        return models;
    }

    console.log('[AGT Quota] API call failed', {
        authIndex,
        projectId,
        statusCode: result?.status_code || result?.statusCode,
        body: result?.body
    });
    throw new Error(`HTTP ${result.status_code || result.statusCode}`);
}

function loadAgtAccounts() {
    loadCliProxyAgtAccounts();
}

async function refreshSingleAgtQuota(account) {
    const authIndex = account.auth_index || account.authIndex;
    if (!authIndex) return;
    
    agtQuotaCache[account.name] = { status: 'loading' };
    renderCliProxyAgtAccounts();
    
    const projectId = 'bamboo-precept-lgxtn';
    try {
        const quota = await fetchAgtQuota(authIndex, projectId);
        console.log('[AGT Quota] Cache update (single)', {
            account: account.name,
            status: 'success',
            modelCount: Object.keys(quota || {}).length
        });
        agtQuotaCache[account.name] = { status: 'success', data: quota };
    } catch (e) {
        console.log('[AGT Quota] Cache update (single)', {
            account: account.name,
            status: 'error',
            error: e.message
        });
        agtQuotaCache[account.name] = { status: 'error', error: e.message };
    }
    renderCliProxyAgtAccounts();
}

function formatAgtQuota(account) {
    const cache = agtQuotaCache[account.name];
    
    if (!cache) {
        return '<span class="text-xs text-gray-400">-</span>';
    }
    
    if (cache.status === 'loading') {
        return '<span class="text-xs text-blue-600">加载中...</span>';
    }
    
    if (cache.status === 'error') {
        return `<span class="text-xs text-red-600" title="${cache.error || '加载失败'}">加载失败</span>`;
    }
    
    const models = Object.entries(cache.data || {});
    if (models.length === 0) {
        return '<span class="text-xs text-gray-400">无数据</span>';
    }
    
    const formatResetTime = (resetTime) => {
        if (!resetTime) return '';
        const date = new Date(resetTime);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');
        const minute = String(date.getMinutes()).padStart(2, '0');
        return `${month}/${day} ${hour}:${minute}`;
    };
    
    // Priority models list - only display these important models
    const priorityModels = [
        'claude-sonnet-4-5',
        'claude-opus-4', 
        'claude-haiku-4',
        'gpt-4',
        'gpt-4-turbo',
        'gpt-3.5-turbo',
        'gemini-3-pro',
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-3-flash',
        'gemini-3-pro-image'
    ];
    
    // Filter to only priority models and sort by priority order
    const filteredModels = models.filter(([name]) => priorityModels.includes(name));
    const sortedModels = filteredModels.sort(([keyA], [keyB]) => {
        const indexA = priorityModels.indexOf(keyA);
        const indexB = priorityModels.indexOf(keyB);
        return indexA - indexB;
    });
    
    const items = sortedModels.map(([name, info]) => {
        const modelName = info?.displayName || info?.display_name || info?.modelId || info?.model_id || name;
        const remainingRaw = info?.quotaInfo?.remainingFraction ?? info?.quota_info?.remaining_fraction ?? 0;
        const remaining = Number(remainingRaw);
        const safeRemaining = Number.isFinite(remaining) ? remaining : 0;
        console.log('[AGT Quota] Format model item', {
            account: account.name,
            modelKey: name,
            displayName: modelName,
            remainingFraction: remainingRaw,
            normalizedRemainingFraction: safeRemaining
        });
        const percent = Math.round(safeRemaining * 100);
        const resetTime = info?.quotaInfo?.resetTime || info?.quota_info?.reset_time;
        const resetDate = formatResetTime(resetTime);
        const bgColor = percent > 60 ? 'bg-green-500' : percent > 20 ? 'bg-yellow-500' : 'bg-red-500';
        
        return `
<div class="mb-3 last:mb-0">
    <div class="flex justify-between items-center mb-1">
        <span class="text-sm font-medium text-gray-700">${modelName}</span>
        <span class="text-xs text-gray-500">${percent}%${resetDate ? ' · ' + resetDate : ''}</span>
    </div>
    <div class="w-full bg-gray-200 rounded-full h-2">
        <div class="${bgColor} h-2 rounded-full transition-all" style="width: ${percent}%"></div>
    </div>
</div>
`;
    }).join('');
    
    return items;
}
