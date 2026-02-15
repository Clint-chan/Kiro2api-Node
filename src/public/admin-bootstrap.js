document.addEventListener("DOMContentLoaded", async () => {
	if (!token) {
		window.location.href = "/login.html";
		return;
	}

	try {
		await fetchApi("/api/admin/settings");
	} catch (error) {
		console.error("Admin bootstrap auth check failed:", error);
		window.location.href = "/login.html";
		return;
	}

	const loadingPage = document.getElementById("loadingPage");
	if (loadingPage) {
		loadingPage.classList.add("hidden");
	}

	showMainPanel();
	if (typeof updateUsernamePreview === "function") {
		updateUsernamePreview();
	}
	switchTab("users");
});

setInterval(() => {
	const mainPanel = document.getElementById("mainPanel");
	if (token && mainPanel && !mainPanel.classList.contains("hidden")) {
		loadStatus();
	}
}, 30000);
