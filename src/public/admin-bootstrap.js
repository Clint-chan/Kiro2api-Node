        (async () => {
            if (!token) {
                window.location.href = '/login.html';
                return;
            }

            document.getElementById('loadingPage').classList.add('hidden');
            document.getElementById('mainPanel').classList.remove('hidden');
            updateUsernamePreview();
            refresh();
        })();

        setInterval(() => {
            if (token && !document.getElementById('mainPanel').classList.contains('hidden')) {
                loadStatus();
            }
        }, 30000);

        // Expose functions to global scope for onclick handlers
        window.setSubscription = setSubscription;
        window.cancelSubscription = cancelSubscription;
        window.hideModal = hideModal;
        window.showModal = showModal;
        window.updateSubscriptionType = updateSubscriptionType;
        window.applyTemplate = applyTemplate;
        window.setDuration = setDuration;
        window.updatePreview = updatePreview;
        window.doRecharge = doRecharge;
        window.showRechargeModal = showRechargeModal;
        window.showSubscriptionModal = showSubscriptionModal;
        window.showPermissionModal = showPermissionModal;
        window.saveUserPermissions = saveUserPermissions;
        window.createUser = createUser;
        window.deleteUser = deleteUser;
        window.editUser = editUser;
        window.loadUsers = loadUsers;
        window.copyText = copyText;
        window.showToast = showToast;
        window.refresh = refresh;
