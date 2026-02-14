        let currentRechargeUserId = null;
        let currentSubscriptionUserId = null;
        let currentPermissionUserId = null;

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

        function setSubQuota(amount, evt) {
            document.getElementById('new-subscription-quota').value = amount;

            document.querySelectorAll('.sub-quota-btn').forEach(btn => {
                btn.classList.remove('border-purple-500', 'bg-purple-50', 'text-purple-600');
                btn.classList.add('border-gray-200');
            });
            const target = evt && evt.target ? evt.target : null;
            if (target) {
                target.classList.remove('border-gray-200');
                target.classList.add('border-purple-500', 'bg-purple-50', 'text-purple-600');
            }
        }

        function setSubDuration(months, evt) {
            document.getElementById('new-subscription-duration').value = months;

            document.querySelectorAll('.sub-duration-btn').forEach(btn => {
                btn.classList.remove('border-purple-500', 'bg-purple-50', 'text-purple-600');
                btn.classList.add('border-gray-200');
            });
            const target = evt && evt.target ? evt.target : null;
            if (target) {
                target.classList.remove('border-gray-200');
                target.classList.add('border-purple-500', 'bg-purple-50', 'text-purple-600');
            }
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

            const allowedChannels = [];
            if (document.getElementById('new-channel-kiro').checked) allowedChannels.push('kiro');
            if (document.getElementById('new-channel-antigravity').checked) allowedChannels.push('antigravity');
            if (document.getElementById('new-channel-codex').checked) allowedChannels.push('codex');

            if (allowedChannels.length === 0) {
                showToast('请至少选择一个渠道', 'warning');
                return;
            }

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

                if (count > 1) {
                    showToast(`开始创建 ${count} 个用户...`, 'info');
                }

                for (let i = 0; i < count; i++) {
                    try {
                        let finalUsername = username;
                        if (!finalUsername || count > 1) {
                            const timestamp = Date.now().toString(36);
                            const randomStr = Math.random().toString(36).substring(2, 6);
                            finalUsername = `user_${timestamp}${randomStr}`;
                        }

                        const userResult = await fetchApi('/api/admin/users', {
                            method: 'POST',
                            body: JSON.stringify({
                                username: finalUsername,
                                balance,
                                allowed_channels: allowedChannels
                            })
                        });

                        createdUsers.push(finalUsername);

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

            document.querySelectorAll('.channel-checkbox').forEach(cb => {
                cb.checked = false;
            });

            try {
                const response = await fetchApi(`/api/admin/users/${userId}`);
                const user = response?.data || {};
                const channels = Array.isArray(user.allowed_channels) && user.allowed_channels.length > 0
                    ? user.allowed_channels
                    : ['kiro'];

                channels.forEach(ch => {
                    const cb = document.getElementById(`perm-channel-${ch}`);
                    if (cb) cb.checked = true;
                });

                if (document.querySelectorAll('.channel-checkbox:checked').length === 0) {
                    const kiroCb = document.getElementById('perm-channel-kiro');
                    if (kiroCb) kiroCb.checked = true;
                }

                window.currentUserModels = Array.isArray(user.allowed_models) ? user.allowed_models : [];
                updateModelCheckboxes();

                document.querySelectorAll('.channel-checkbox').forEach(cb => {
                    cb.removeEventListener('change', updateModelCheckboxes);
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

                const modelsHTML = models.map(m => {
                    const isChecked = userModels.includes(m.id);
                    return `
                        <label class="flex items-center gap-2 text-sm text-gray-700 hover:bg-gray-50 p-1.5 rounded cursor-pointer transition">
                            <input type="checkbox" value="${m.id}" ${isChecked ? 'checked' : ''} class="rounded border-gray-300 text-indigo-500 focus:ring-indigo-500 model-checkbox model-checkbox-${channel}">
                            <span class="truncate" title="${m.name}">${m.name}</span>
                        </label>
                    `;
                }).join('');

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

            document.getElementById('sub-type').value = '';
            document.getElementById('sub-quota').value = '';
            document.getElementById('sub-duration').value = '';
            document.querySelectorAll('input[name="sub-type-radio"]').forEach((r) => {
                r.checked = false;
            });
            document.getElementById('subscription-preview').classList.add('hidden');

            fetchApi(`/api/admin/users/${userId}/subscription`)
                .then(data => {
                    const sub = data.data;
                    if (sub.subscription_type && sub.subscription_type !== 'none') {
                        document.getElementById('sub-type').value = sub.subscription_type;
                        document.getElementById('sub-quota').value = sub.subscription_quota || '';

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
            document.getElementById('sub-type').value = type;
            const radio = document.querySelector(`input[name="sub-type-radio"][value="${type}"]`);
            if (radio) radio.checked = true;

            document.getElementById('sub-quota').value = quota;
            document.getElementById('sub-duration').value = duration;

            document.querySelectorAll('.duration-btn').forEach(btn => {
                btn.classList.remove('border-purple-500', 'bg-purple-50', 'text-purple-600');
            });

            updatePreview();
            showToast('已应用套餐模板', 'success');
        }

        function setDuration(months, evt) {
            document.getElementById('sub-duration').value = months;

            document.querySelectorAll('.duration-btn').forEach(btn => {
                btn.classList.remove('border-purple-500', 'bg-purple-50');
            });
            const target = evt && evt.target ? evt.target : null;
            const button = target ? target.closest('.duration-btn') : null;
            if (button) {
                button.classList.add('border-purple-500', 'bg-purple-50');
            }

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

            const typeName = type === 'daily' ? '每日重置' : '每月重置';
            document.getElementById('preview-type').textContent = typeName;
            document.getElementById('preview-quota').textContent = '$' + quota.toFixed(2);
            document.getElementById('preview-duration').textContent = months + ' 个月';

            const now = new Date();
            const expiresDate = new Date(now);
            expiresDate.setMonth(expiresDate.getMonth() + months);

            const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
            const expiresStr = expiresDate.toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }) + ' ' + weekdays[expiresDate.getDay()];

            document.getElementById('preview-expires').textContent = expiresStr;

            let totalResets = 0;
            let resetFrequency = '';

            if (type === 'daily') {
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
