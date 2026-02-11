/**
 * 可观测性路由
 * 提供 /metrics 和 /health 端点
 */

import { Router } from 'express';
import { metrics } from '../metrics.js';

export function createObservabilityRouter(state) {
  const router = Router();

  /**
   * GET /metrics - Prometheus 格式指标
   */
  router.get('/metrics', (req, res) => {
    // 更新实时指标
    updateMetrics(state);

    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(metrics.toPrometheusFormat());
  });

  /**
   * GET /health - 健康检查
   * Kubernetes liveness + readiness
   */
  router.get('/health', (req, res) => {
    const health = checkHealth(state);
    
    const status = health.status === 'healthy' ? 200 : 503;
    res.status(status).json(health);
  });

  /**
   * GET /health/live - Liveness probe
   * 检查进程是否存活
   */
  router.get('/health/live', (req, res) => {
    res.json({ status: 'ok' });
  });

  /**
   * GET /health/ready - Readiness probe
   * 检查服务是否就绪
   */
  router.get('/health/ready', (req, res) => {
    const ready = isReady(state);
    
    if (ready) {
      res.json({ status: 'ready' });
    } else {
      res.status(503).json({ status: 'not_ready' });
    }
  });

  return router;
}

/**
 * 更新实时指标
 */
function updateMetrics(state) {
  const accounts = state.accountPool.listAccounts();
  
  // 账号状态分布
  const statusCounts = { active: 0, depleted: 0, disabled: 0, error: 0 };
  let totalBalance = 0;
  let totalRequests = 0;
  let totalInflight = 0;

  for (const account of accounts) {
    statusCounts[account.status] = (statusCounts[account.status] || 0) + 1;
    totalBalance += account.balance || 0;
    totalRequests += account.requestCount || 0;
    totalInflight += account.inflight || 0;
  }

  // 设置 gauge 指标
  metrics.setGauge('kiro_accounts_total', {}, accounts.length);
  metrics.setGauge('kiro_accounts_active', {}, statusCounts.active || 0);
  metrics.setGauge('kiro_accounts_depleted', {}, statusCounts.depleted || 0);
  metrics.setGauge('kiro_accounts_disabled', {}, statusCounts.disabled || 0);
  metrics.setGauge('kiro_accounts_error', {}, statusCounts.error || 0);
  metrics.setGauge('kiro_balance_total', {}, totalBalance);
  metrics.setGauge('kiro_requests_inflight', {}, totalInflight);

  // 余额监控器统计
  if (state.balanceMonitor) {
    const monitorStats = state.balanceMonitor.getStats();
    metrics.setGauge('kiro_balance_monitor_refreshes_total', {}, monitorStats.totalRefreshes);
    metrics.setGauge('kiro_balance_monitor_refreshes_success', {}, monitorStats.successfulRefreshes);
    metrics.setGauge('kiro_balance_monitor_refreshes_failed', {}, monitorStats.failedRefreshes);
    metrics.setGauge('kiro_balance_monitor_last_duration_ms', {}, monitorStats.lastRefreshDuration);
  }

  // 系统指标
  const uptime = Math.floor((Date.now() - state.startTime) / 1000);
  metrics.setGauge('kiro_uptime_seconds', {}, uptime);
  metrics.setGauge('kiro_memory_usage_bytes', {}, process.memoryUsage().heapUsed);
}

/**
 * 检查服务健康状态
 */
function checkHealth(state) {
  const accounts = state.accountPool.listAccounts();
  const activeAccounts = accounts.filter(a => a.status === 'active');
  const totalBalance = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);
  
  const uptime = Math.floor((Date.now() - state.startTime) / 1000);
  
  // 健康判断：至少有一个活跃账号且总余额 > 0
  const isHealthy = activeAccounts.length > 0 && totalBalance > 0;

  return {
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime,
    checks: {
      database: state.db ? 'ok' : 'error',
      accountPool: activeAccounts.length > 0 ? 'ok' : 'no_active_accounts',
      balance: totalBalance > 0 ? 'ok' : 'insufficient_balance'
    },
    metrics: {
      accounts: {
        total: accounts.length,
        active: activeAccounts.length
      },
      balance: totalBalance.toFixed(2)
    }
  };
}

/**
 * 检查服务是否就绪
 */
function isReady(state) {
  const accounts = state.accountPool.listAccounts();
  const activeAccounts = accounts.filter(a => a.status === 'active');
  
  // 就绪条件：数据库可用 + 至少一个活跃账号
  return state.db && activeAccounts.length > 0;
}
