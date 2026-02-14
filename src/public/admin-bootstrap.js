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
