import "dotenv/config";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import { createBalanceMonitor } from "./balance-monitor.js";
import { BillingManager } from "./billing.js";
import { CLIProxyClient } from "./cliproxy-client.js";
import { CLIProxyThresholdChecker } from "./cliproxy-threshold-checker.js";
import { DatabaseManager } from "./database.js";
import { logger } from "./logger.js";
import { metrics } from "./metrics.js";
import { adminRateLimiter } from "./middleware/admin-rate-limit.js";
import {
	adminAuthMiddleware,
	dualAuthMiddleware,
	userAuthMiddleware,
} from "./middleware/auth.js";
import { concurrencyLimiter } from "./middleware/concurrency-limit.js";
import {
	loginRateLimiter,
	recordLoginFailure,
} from "./middleware/rate-limit.js";
import { initModelCooldown } from "./model-cooldown.js";
import { AccountPool } from "./pool.js";
import { createAdminRouter } from "./routes/admin/index.js";
import { createAntigravityNativeRouter } from "./routes/antigravity-native.js";
import { createApiRouter } from "./routes/api-new.js";
import {
	createCLIProxyAdminRouter,
	createCLIProxyThresholdRouter,
} from "./routes/cliproxy-admin.js";
import { createConfigRouter } from "./routes/config.js";
import { createObservabilityRouter } from "./routes/observability.js";
import { createUiRouter } from "./routes/ui.js";
import { createUserRouter } from "./routes/user.js";
import { SubscriptionManager } from "./subscription.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
	try {
		console.log("========== 启动诊断信息 ==========");
		console.log("Node 版本:", process.version);
		console.log("工作目录:", process.cwd());
		console.log("环境变量 PORT:", process.env.PORT);
		console.log("环境变量 NODE_ENV:", process.env.NODE_ENV);

		const app = express();

		app.use(
			helmet({
				contentSecurityPolicy: false,
				crossOriginEmbedderPolicy: false,
			}),
		);

		const corsOptions = {
			origin:
				process.env.NODE_ENV === "production"
					? process.env.CORS_ORIGIN?.split(",") || false
					: "*",
			credentials: process.env.NODE_ENV === "production" ? false : true,
			methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
			allowedHeaders: [
				"Content-Type",
				"Authorization",
				"x-api-key",
				"x-admin-key",
			],
		};
		app.use(cors(corsOptions));

		app.use(express.json({ limit: "5mb" }));

		// 配置
		const config = {
			port: parseInt(process.env.PORT) || 8080,
			dataDir: process.env.DATA_DIR || "./data",
			dbPath: process.env.DB_PATH || "./data/database.db",
			region: process.env.REGION || "us-east-1",
			kiroVersion: process.env.KIRO_VERSION || "0.8.0",
			proxyUrl: process.env.PROXY_URL || null,
		};

		console.log("配置端口:", config.port);
		console.log("数据库路径:", config.dbPath);
		console.log("正在初始化服务...");

		// 初始化数据库
		const db = new DatabaseManager(config.dbPath);
		db.init();
		console.log("✓ 数据库初始化完成");

		// 初始化计费管理器
		const billing = new BillingManager(db);
		console.log("✓ 计费管理器初始化完成");

		// 初始化订阅管理器
		const subscription = new SubscriptionManager(db);
		console.log("✓ 订阅管理器初始化完成");

		// 初始化账号池 (for Kiro account selection)
		const accountPool = new AccountPool(config, db);
		await accountPool.load();

		const persistedStrategy = db.getSetting("load_balance_strategy");
		if (persistedStrategy) {
			const validStrategies = [
				"round-robin",
				"random",
				"least-used",
				"least-inflight",
			];
			if (validStrategies.includes(persistedStrategy)) {
				accountPool.setStrategy(persistedStrategy);
			}
		}

		logger.info("账号池初始化完成");

		const modelCooldown = initModelCooldown(db);
		logger.info("模型冷却管理器初始化完成");

		let cliproxyClient = null;
		let thresholdChecker = null;
		if (
			process.env.CLIPROXY_MANAGEMENT_URL &&
			process.env.CLIPROXY_MANAGEMENT_KEY
		) {
			try {
				cliproxyClient = new CLIProxyClient(
					process.env.CLIPROXY_MANAGEMENT_URL,
					process.env.CLIPROXY_MANAGEMENT_KEY,
				);

				const authFiles = await cliproxyClient.getCachedAuthFiles(true);
				const files = authFiles.files || [];

				const antigravityCount = files.filter(
					(f) => f.provider === "antigravity",
				).length;
				const codexCount = files.filter((f) => f.provider === "codex").length;

				logger.info("CLIProxy 渠道检测完成");
				logger.info("CLIProxy Antigravity账号数", { count: antigravityCount });
				logger.info("CLIProxy Codex账号数", { count: codexCount });

				thresholdChecker = new CLIProxyThresholdChecker(db, cliproxyClient);
				thresholdChecker.start();
				logger.info("CLIProxy 阈值检查器已启动");
			} catch (error) {
				logger.warn("CLIProxy 渠道检测失败", { error: error.message });
			}
		}

		const balanceMonitor = createBalanceMonitor(accountPool, config);
		console.log("✓ 余额监控器初始化完成");

		// 启动时间
		const startTime = Date.now();

		// 共享状态
		const state = {
			config,
			db,
			billing,
			subscription,
			accountPool,
			balanceMonitor,
			startTime,
		};

		// 静态文件
		const publicPath = path.join(__dirname, "public");
		console.log("静态文件目录:", publicPath);

		// Root redirect to login
		app.get("/", (req, res) => res.redirect("/login.html"));

		// Custom admin path (configurable)
		const adminPath =
			process.env.ADMIN_PATH || db.getSetting("admin_path") || "/admin.html";

		// Serve admin page only at custom path
		app.get(adminPath, (req, res) => {
			res.sendFile(path.join(publicPath, "admin.html"));
		});

		// Block direct access to admin.html
		app.get("/admin.html", (req, res) => {
			res.status(404).send("Not Found");
		});

		app.use(express.static(publicPath));

		// ==================== Authentication Routes ====================

		/**
		 * POST /api/auth/login
		 * Dual-mode login (accepts both user API keys and admin credentials)
		 */
		app.post(
			"/api/auth/login",
			loginRateLimiter,
			dualAuthMiddleware(db),
			(req, res) => {
				const user = req.authUser;

				res.json({
					success: true,
					data: {
						id: user.id,
						username: user.username,
						role: user.role,
						balance: user.balance,
						isSystemAdmin: user.isSystemAdmin,
					},
				});
			},
		);

		app.get("/api/strategy", adminAuthMiddleware(db), (req, res) => {
			res.json({ strategy: accountPool.getStrategy() });
		});

		app.post("/api/strategy", adminAuthMiddleware(db), (req, res) => {
			const { strategy } = req.body || {};
			const validStrategies = [
				"round-robin",
				"random",
				"least-used",
				"least-inflight",
			];
			if (!validStrategies.includes(strategy)) {
				return res.status(400).json({
					error: {
						type: "validation_error",
						message: `Invalid strategy: ${strategy}`,
					},
				});
			}

			accountPool.setStrategy(strategy);
			db.setSetting("load_balance_strategy", strategy);
			return res.json({ success: true, strategy });
		});

		// ==================== API Routes ====================

		// User API routes (requires user authentication)
		app.use(
			"/api/user",
			userAuthMiddleware(db),
			createUserRouter(db, billing, subscription),
		);

		// Admin API routes (requires admin authentication + rate limiting)
		app.use(
			"/api/admin",
			adminAuthMiddleware(db),
			adminRateLimiter,
			createAdminRouter(db, billing, subscription, accountPool),
		);

		// CLIProxy Admin API routes (requires admin authentication + rate limiting)
		app.use(
			"/api/admin/cliproxy",
			adminAuthMiddleware(db),
			adminRateLimiter,
			createCLIProxyAdminRouter(),
		);
		app.use(
			"/api/admin/cliproxy",
			adminAuthMiddleware(db),
			adminRateLimiter,
			createCLIProxyThresholdRouter(db),
		);

		// Config API routes (requires admin authentication)
		app.use("/api/config", createConfigRouter(state));

		// Claude API routes (requires user authentication with billing + concurrency limit)
		app.use("/v1", concurrencyLimiter, createApiRouter(state));

		app.use("/", createAntigravityNativeRouter(state));

		// UI routes - redirect root to login
		app.get("/", (req, res) => res.redirect("/login.html"));

		// ==================== Observability ====================

		// Metrics and health endpoints
		app.use("/", createObservabilityRouter(state));

		// ==================== Error Handler ====================

		app.use((err, req, res, next) => {
			console.error("Unhandled error:", err);
			res.status(500).json({
				error: {
					type: "internal_error",
					message: "An unexpected error occurred.",
				},
			});
		});

		// ==================== Start Server ====================

		const server = app.listen(config.port, "0.0.0.0", () => {
			console.log("========================================");
			console.log(`🚀 ClaudeAPI (Multi-User SaaS) 已启动`);
			console.log(`   端口: ${config.port}`);
			console.log(`   监听: 0.0.0.0:${config.port}`);
			console.log(`   数据库: ${config.dbPath}`);
			console.log(`   登录页面: http://localhost:${config.port}/login`);
			console.log(`   API 端点:`);
			console.log(`     POST /api/auth/login - 登录`);
			console.log(`     GET  /api/user/* - 用户 API`);
			console.log(`     GET  /api/admin/* - 管理员 API`);
			console.log(`     POST /v1/messages - Claude API`);
			console.log(`     GET  /health - 健康检查`);
			console.log("========================================");

			// 启动余额监控器
			balanceMonitor.start();

			// 启动订阅检查定时任务（每小时检查一次）
			setInterval(
				async () => {
					try {
						await subscription.checkAndResetQuotas();
						await subscription.checkExpiredSubscriptions();
					} catch (error) {
						console.error("订阅检查任务失败:", error);
					}
				},
				60 * 60 * 1000,
			); // 每小时

			// 启动时立即执行一次
			setTimeout(async () => {
				try {
					await subscription.checkAndResetQuotas();
					await subscription.checkExpiredSubscriptions();
					console.log("✓ 订阅检查任务已执行");
				} catch (error) {
					console.error("订阅检查任务失败:", error);
				}
			}, 5000); // 5秒后执行

			// 自动清理超过30天的日志（每天凌晨3点执行）
			function scheduleLogCleanup() {
				const now = new Date();
				const next3AM = new Date(now);
				next3AM.setHours(3, 0, 0, 0);

				if (next3AM <= now) {
					next3AM.setDate(next3AM.getDate() + 1);
				}

				const msUntil3AM = next3AM - now;

				setTimeout(() => {
					cleanupOldLogs();
					setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000); // 每24小时执行一次
				}, msUntil3AM);
			}

			function cleanupOldLogs() {
				try {
					const thirtyDaysAgo = new Date();
					thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
					const cutoffDate = thirtyDaysAgo.toISOString();

					const result = db.db
						.prepare("DELETE FROM request_logs WHERE timestamp < ?")
						.run(cutoffDate);
					logger.info("日志清理完成", { deletedCount: result.changes });
				} catch (error) {
					logger.error("日志清理错误", { error });
				}
			}

			// 启动日志清理调度
			scheduleLogCleanup();
		});

		server.on("error", (error) => {
			logger.error("服务器错误", { error });
			process.exit(1);
		});

		// Graceful shutdown
		process.on("SIGTERM", () => {
			console.log("收到 SIGTERM 信号，正在关闭服务器...");

			// 停止余额监控器
			balanceMonitor.stop();

			server.close(() => {
				console.log("✓ 服务器已关闭");
				db.close();
				process.exit(0);
			});
		});

		process.on("SIGINT", () => {
			console.log("\n收到 SIGINT 信号，正在关闭服务器...");

			// 停止余额监控器
			balanceMonitor.stop();

			server.close(() => {
				console.log("✓ 服务器已关闭");
				db.close();
				process.exit(0);
			});
		});
	} catch (error) {
		console.error("❌ 服务启动失败:", error);
		console.error("错误堆栈:", error.stack);
		process.exit(1);
	}
}

startServer();
