/**
 * HTML 转义工具函数
 * 防止 XSS 攻击
 */
function escapeHtml(unsafe) {
	if (unsafe === null || unsafe === undefined) {
		return "";
	}
	return String(unsafe)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

window.escapeHtml = escapeHtml;
