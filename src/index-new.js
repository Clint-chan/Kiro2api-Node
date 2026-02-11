import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseManager } from './database.js';
import { BillingManager } from './billing.js';
import { AccountPool } from './pool.js';
import { SubscriptionManager } from './subscription.js';
import { createBalanceMonitor } from './balance-monitor.js';
import { userAuthMiddleware, adminAuthMiddleware, dualAuthMiddleware } from './middleware/auth.js';
import { createApiRouter } from './routes/api-new.js';
import { createAdminRouter } from './routes/admin-new.js';
import { createUserRouter } from './routes/user.js';
import { createUiRouter } from './routes/ui.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  try {
    console.log('========== 启动诊断信息 ==========');
    console.log('Node 版本:', process.version);
    console.log('工作目录:', process.cwd());
    console.log('环境变量 PORT:', process.env.PORT);
    console.log('环境变量 NODE_ENV:', process.env.NODE_ENV);

    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '50mb' }));

    // 配置
    const config = {
      port: parseInt(process.env.PORT) || 8080,
      dataDir: process.env.DATA_DIR || './data',
      dbPath: process.env.DB_PATH || './data/database.db',
      region: process.env.REGION || 'us-east-1',
      kiroVersion: process.env.KIRO_VERSION || '0.8.0',
      proxyUrl: process.env.PROXY_URL || null
    };

    console.log('配置端口:', config.port);
    console.log('数据库路径:', config.dbPath);
    console.log('正在初始化服务...');

    // 初始化数据库
    const db = new DatabaseManager(config.dbPath);
    db.init();
    console.log('✓ 数据库初始化完成');

    // 初始化计费管理器
    const billing = new BillingManager(db);
    console.log('✓ 计费管理器初始化完成');

    // 初始化订阅管理器
    const subscription = new SubscriptionManager(db);
    console.log('✓ 订阅管理器初始化完成');

    // 初始化账号池 (for Kiro account selection)
    const accountPool = new AccountPool(config, db);
    await accountPool.load();
    console.log('✓ 账号池初始化完成');

    // 初始化余额监控器
    const balanceMonitor = createBalanceMonitor(accountPool, config);
    console.log('✓ 余额监控器初始化完成');

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
      startTime
    };

    // 静态文件
    const publicPath = path.join(__dirname, 'public');
    console.log('静态文件目录:', publicPath);

    // Root redirect to login
    app.get('/', (req, res) => res.redirect('/login.html'));

    // Custom admin path (configurable)
    const adminPath = process.env.ADMIN_PATH || db.getSetting('admin_path') || '/admin.html';

    // Serve admin page only at custom path
    app.get(adminPath, (req, res) => {
      res.sendFile(path.join(publicPath, 'admin.html'));
    });

    // Block direct access to admin.html
    app.get('/admin.html', (req, res) => {
      res.status(404).send('Not Found');
    });

    app.use(express.static(publicPath));

    // ==================== Authentication Routes ====================

    /**
     * POST /api/auth/login
     * Dual-mode login (accepts both user API keys and admin credentials)
     */
    app.post('/api/auth/login', dualAuthMiddleware(db), (req, res) => {
      const user = req.authUser;

      res.json({
        success: true,
        data: {
          id: user.id,
          username: user.username,
          role: user.role,
          balance: user.balance,
          isSystemAdmin: user.isSystemAdmin
        }
      });
    });

    // ==================== API Routes ====================

    // User API routes (requires user authentication)
    app.use('/api/user', userAuthMiddleware(db), createUserRouter(db, billing, subscription));

    // Admin API routes (requires admin authentication)
    app.use('/api/admin', adminAuthMiddleware(db), createAdminRouter(db, billing, subscription, accountPool));

    // Claude API routes (requires user authentication with billing)
    app.use('/v1', createApiRouter(state));

    // UI routes - redirect root to login
    app.get('/', (req, res) => res.redirect('/login.html'));

    // ==================== Health Check ====================

    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - startTime) / 1000)
      });
    });

    // ==================== Error Handler ====================

    app.use((err, req, res, next) => {
      console.error('Unhandled error:', err);
      res.status(500).json({
        error: {
          type: 'internal_error',
          message: 'An unexpected error occurred.'
        }
      });
    });

    // ==================== Start Server ====================

    const server = app.listen(config.port, '0.0.0.0', () => {
      console.log('========================================');
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
      console.log('========================================');

      // 启动余额监控器
      balanceMonitor.start();

      // 启动订阅检查定时任务（每小时检查一次）
      setInterval(async () => {
        try {
          await subscription.checkAndResetQuotas();
          await subscription.checkExpiredSubscriptions();
        } catch (error) {
          console.error('订阅检查任务失败:', error);
        }
      }, 60 * 60 * 1000); // 每小时

      // 启动时立即执行一次
      setTimeout(async () => {
        try {
          await subscription.checkAndResetQuotas();
          await subscription.checkExpiredSubscriptions();
          console.log('✓ 订阅检查任务已执行');
        } catch (error) {
          console.error('订阅检查任务失败:', error);
        }
      }, 5000); // 5秒后执行
    });

    server.on('error', (error) => {
      console.error('❌ 服务器错误:', error);
      process.exit(1);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('收到 SIGTERM 信号，正在关闭服务器...');
      
      // 停止余额监控器
      balanceMonitor.stop();
      
      server.close(() => {
        console.log('✓ 服务器已关闭');
        db.close();
        process.exit(0);
      });
    });
      server.close(() => {
        console.log('服务器已关闭');
        db.close();
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('\n收到 SIGINT 信号，正在关闭服务器...');
      server.close(() => {
        console.log('服务器已关闭');
        db.close();
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('❌ 服务启动失败:', error);
    console.error('错误堆栈:', error.stack);
    process.exit(1);
  }
}

startServer();
