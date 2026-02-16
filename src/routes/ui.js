import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createUiRouter(state) {
	const router = Router();

	// 登录页面
	router.get("/login", (_req, res) => {
		res.sendFile(path.join(__dirname, "../public/index.html"));
	});

	// 健康检查端点
	router.get("/health", (_req, res) => {
		res.json({ status: "ok", uptime: Date.now() - state.startTime });
	});

	return router;
}
