# 可观测性功能快速启动指南

## 5 分钟快速体验

### 1. 启动服务

```bash
# 确保已配置 .env 文件
npm start
```

### 2. 查看 Prometheus 指标

```bash
curl http://localhost:19864/metrics
```

**预期输出**:
```
# TYPE kiro_accounts_total gauge
kiro_accounts_total 5
# TYPE kiro_accounts_active gauge
kiro_accounts_active 4
# TYPE kiro_balance_total gauge
kiro_balance_total 125.50
...
```

### 3. 检查健康状态

```bash
curl http://localhost:19864/health | jq
```

**预期输出**:
```json
{
  "status": "healthy",
  "timestamp": "2025-02-11T10:30:00.000Z",
  "uptime": 3600,
  "checks": {
    "database": "ok",
    "accountPool": "ok",
    "balance": "ok"
  },
  "metrics": {
    "accounts": {
      "total": 5,
      "active": 4
    },
    "balance": "125.50"
  }
}
```

### 4. 查看当前配置

```bash
# 替换为你的管理员密钥
export ADMIN_KEY=your-admin-key-here

curl -H "Authorization: Bearer $ADMIN_KEY" \
  http://localhost:19864/api/config | jq
```

**预期输出**:
```json
{
  "success": true,
  "data": {
    "accountPool": {
      "strategy": "least-inflight",
      "maxConcurrentPerAccount": 5,
      "balanceThreshold": 0.1
    },
    "balanceMonitor": {
      "enabled": true,
      "refreshInterval": 300000,
      "batchSize": 5
    },
    "retry": {
      "maxRetries": 3,
      "initialDelay": 1000,
      "maxDelay": 10000
    },
    "logging": {
      "level": "INFO",
      "format": "json"
    }
  }
}
```

### 5. 测试配置热更新

```bash
# 切换负载均衡策略为轮询
curl -X PATCH \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"accountPool": {"strategy": "round-robin"}}' \
  http://localhost:19864/api/config | jq
```

**预期输出**:
```json
{
  "success": true,
  "message": "Configuration updated successfully",
  "data": {
    "accountPool": {
      "strategy": "round-robin",
      ...
    }
  }
}
```

**验证**: 再次查看配置，确认策略已更新，且服务无需重启。

---

## 常用命令

### 监控指标

```bash
# 持续监控指标变化
watch -n 5 'curl -s http://localhost:19864/metrics | grep kiro_accounts'

# 查看请求统计
curl -s http://localhost:19864/metrics | grep kiro_api_requests

# 查看 Token 使用量
curl -s http://localhost:19864/metrics | grep kiro_tokens
```

### 健康检查

```bash
# 综合健康检查
curl http://localhost:19864/health

# Liveness（进程存活）
curl http://localhost:19864/health/live

# Readiness（服务就绪）
curl http://localhost:19864/health/ready
```

### 配置管理

```bash
# 查看配置
curl -H "Authorization: Bearer $ADMIN_KEY" \
  http://localhost:19864/api/config | jq

# 更新配置
curl -X PATCH \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"accountPool": {"maxConcurrentPerAccount": 10}}' \
  http://localhost:19864/api/config | jq

# 重置配置
curl -X POST \
  -H "Authorization: Bearer $ADMIN_KEY" \
  http://localhost:19864/api/config/reset | jq
```

---

## 日志配置

### 切换到文本格式日志

```bash
# 编辑 .env
LOG_FORMAT=text
LOG_LEVEL=INFO

# 重启服务
npm start
```

### 切换到 JSON 格式日志

```bash
# 编辑 .env
LOG_FORMAT=json
LOG_LEVEL=INFO

# 重启服务
npm start
```

### 调整日志级别

```bash
# DEBUG - 最详细
LOG_LEVEL=DEBUG

# INFO - 一般信息（推荐）
LOG_LEVEL=INFO

# WARN - 仅警告
LOG_LEVEL=WARN

# ERROR - 仅错误
LOG_LEVEL=ERROR
```

---

## 集成 Prometheus

### 1. 创建 Prometheus 配置

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'kiro-api'
    static_configs:
      - targets: ['localhost:19864']
```

### 2. 启动 Prometheus

```bash
# Docker 方式
docker run -d \
  -p 9090:9090 \
  -v $(pwd)/prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus

# 访问 Prometheus UI
open http://localhost:9090
```

### 3. 查询示例

在 Prometheus UI 中执行以下查询：

```promql
# QPS
rate(kiro_api_requests_total[1m])

# 成功率
rate(kiro_api_requests_success_total[5m]) / rate(kiro_api_requests_total[5m])

# P95 延迟
histogram_quantile(0.95, rate(kiro_api_request_duration_ms_bucket[5m]))

# 活跃账号数
kiro_accounts_active

# 总余额
kiro_balance_total
```

---

## 集成 Grafana

### 1. 启动 Grafana

```bash
docker run -d \
  -p 3000:3000 \
  grafana/grafana

# 访问 Grafana
open http://localhost:3000
# 默认用户名/密码: admin/admin
```

### 2. 添加 Prometheus 数据源

1. 进入 Configuration > Data Sources
2. 添加 Prometheus
3. URL: `http://localhost:9090`
4. 保存并测试

### 3. 创建 Dashboard

添加以下面板：

**QPS 面板**:
```promql
rate(kiro_api_requests_total[1m])
```

**成功率面板**:
```promql
rate(kiro_api_requests_success_total[5m]) / rate(kiro_api_requests_total[5m]) * 100
```

**延迟分布面板**:
```promql
histogram_quantile(0.50, rate(kiro_api_request_duration_ms_bucket[5m]))
histogram_quantile(0.95, rate(kiro_api_request_duration_ms_bucket[5m]))
histogram_quantile(0.99, rate(kiro_api_request_duration_ms_bucket[5m]))
```

**账号状态面板**:
```promql
kiro_accounts_active
kiro_accounts_depleted
kiro_accounts_disabled
```

---

## 故障排查

### 指标端点无响应

```bash
# 检查服务是否运行
curl http://localhost:19864/health/live

# 检查端口是否监听
netstat -an | grep 19864

# 查看服务日志
npm start
```

### 健康检查失败

```bash
# 查看详细健康状态
curl http://localhost:19864/health | jq

# 检查数据库
ls -la data/database.db

# 检查账号池
curl -H "Authorization: Bearer $ADMIN_KEY" \
  http://localhost:19864/api/admin/kiro-accounts | jq
```

### 配置更新失败

```bash
# 检查管理员密钥
echo $ADMIN_KEY

# 查看错误信息
curl -v -X PATCH \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"accountPool": {"strategy": "invalid"}}' \
  http://localhost:19864/api/config
```

---

## 下一步

- 阅读完整文档: [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md)
- 查看 API 文档: [docs/API.md](docs/API.md)
- 运行完整测试: `node test-observability.js`
- 配置告警规则
- 集成到 CI/CD 流程

---

## 需要帮助？

- 查看日志: `npm start`
- 运行测试: `node test-observability.js`
- 查看文档: `docs/OBSERVABILITY.md`
