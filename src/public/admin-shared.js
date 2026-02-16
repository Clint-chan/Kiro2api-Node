const token = localStorage.getItem("kiro_token");
const adminKey = token || "";
let adminLogoutHandler = null;

function _setAdminLogoutHandler(handler) {
	adminLogoutHandler = typeof handler === "function" ? handler : null;
}

function showToast(message, type = "info") {
	const container = document.getElementById("toast-container");
	const colors = {
		success: "bg-green-500",
		error: "bg-red-500",
		info: "bg-blue-500",
		warning: "bg-yellow-500",
	};
	const toast = document.createElement("div");
	toast.className = `${colors[type]} text-white px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slideIn`;
	toast.textContent = message;
	container.appendChild(toast);
	setTimeout(() => {
		toast.classList.add("animate-slideOut");
		setTimeout(() => toast.remove(), 300);
	}, 3000);
}

async function _fetchApi(url, options = {}) {
	const res = await fetch(url, {
		...options,
		headers: {
			"Content-Type": "application/json",
			"x-admin-key": adminKey,
			...options.headers,
		},
	});

	if (res.status === 401) {
		if (adminLogoutHandler) {
			adminLogoutHandler();
		}
		throw new Error("认证失败");
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

function _escapeHtml(value) {
	return String(value || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function _copyText(text) {
	// 尝试使用现代 Clipboard API
	if (navigator.clipboard?.writeText) {
		navigator.clipboard
			.writeText(text)
			.then(() => {
				showToast("已复制到剪贴板", "success");
			})
			.catch(() => {
				fallbackCopy(text);
			});
	} else {
		// 降级到 textarea fallback
		fallbackCopy(text);
	}
}

function fallbackCopy(text) {
	try {
		// 创建临时 textarea
		const textarea = document.createElement("textarea");
		textarea.value = String(text ?? "");
		textarea.style.position = "fixed";
		textarea.style.opacity = "0";
		textarea.style.pointerEvents = "none";
		document.body.appendChild(textarea);

		// 选中并复制
		textarea.select();
		textarea.setSelectionRange(0, textarea.value.length);
		const success = document.execCommand("copy");

		// 清理
		document.body.removeChild(textarea);

		if (success) {
			showToast("已复制到剪贴板", "success");
		} else {
			throw new Error("execCommand failed");
		}
	} catch (err) {
		console.error("Fallback copy failed:", err);
		window.prompt("复制失败，请手动复制:", String(text ?? ""));
		showToast("复制失败，请手动复制", "error");
	}
}

function _getPaginationPages(currentPage, totalPages, maxVisible = 5) {
	if (totalPages <= 0) {
		return [];
	}
	if (totalPages <= maxVisible) {
		return Array.from({ length: totalPages }, (_, i) => i + 1);
	}
	if (currentPage <= 3) {
		return [1, 2, 3, 4, "...", totalPages];
	}
	if (currentPage >= totalPages - 2) {
		return [
			1,
			"...",
			totalPages - 3,
			totalPages - 2,
			totalPages - 1,
			totalPages,
		];
	}
	return [
		1,
		"...",
		currentPage - 1,
		currentPage,
		currentPage + 1,
		"...",
		totalPages,
	];
}

// 导出到全局作用域
window.setAdminLogoutHandler = _setAdminLogoutHandler;
window.fetchApi = _fetchApi;
window.escapeHtml = _escapeHtml;
window.copyText = _copyText;
window.getPaginationPages = _getPaginationPages;
