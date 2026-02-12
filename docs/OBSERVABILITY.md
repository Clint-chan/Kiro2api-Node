# 可观测性指南

本文档介绍 Kiro2API-Node 的可观测性功能，包括指标监控、健康检查、结构化日志和配置热更新。

## 功能概览

### 1. Prometheus 指标 (`/metrics`)

提供 Prometheus 格式的指标，可集成到 Grafana 进行可视化监控。

**端点**: `GET /metrics`

**指标类型**:

- **请求指标**
  - `kiro_api_requests_total` - 总请求数（按模型和流式类型分类）
  - `kiro_api_requests_success_total` - 成功请求数
  - `kiro_api_requests_failed_total` - 失败请求数（按错误类型分类）
  - `kiro_api_request_duration_ms` - 请求延迟分布（直方图）

- **Token 指标**
  - `kiro_tokens_input_total` - 输入 token 总数
  - `kiro_tokens_output_total` - 输出 token 总数

- **账号指标**
  - `kiro_accounts_total` - 账号总数
  - `kiro_accounts_active` - 活跃账号数
  - `kiro_accounts_depleted` - 余额耗尽账号数
  - `kiro_accounts_disabled` - 禁用账号数
  - `kiro_balance_total` - 总余额
  - `kiro_requests_inflight` - 当前并发请求数

- **系统指标**
  - `kiro_uptime_seconds` - 运行时间
  - `kiro_memory_usage_bytes` - 内存使用量

**使用示例**:

```bash
# 查看指标
curl http://localhost:19864/metrics

# Prometheus 配置
scrape_configs:
  - job_name: 'kiro-api'
    static_configs:
      - targets: ['localhost:19864']
```

### 2. 健康检查

提供多个健康检查端点，适用于 Kubernetes 和负载均衡器。

#### 综合健康检查

**端点**: `GET /health`

**响应示例**:

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

**健康判断标准**:
- 至少有一个活跃账号
- 总余额 > 0
- 数据库可用

#### Liveness Probe

**端点**: `GET /health/live`

检查进程是否存活（用于 Kubernetes liveness probe）。

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 19864
  initialDelaySeconds: 30
  periodSeconds: 10
```

#### Readiness Probe

**端点**: `GET /health/ready`

检查服务是否就绪接收流量（用于 Kubernetes readiness probe）。

```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: 19864
  initialDelaySeconds: 10
  periodSeconds: 5
```

### 3. 结构化日志

支持 JSON 格式日志输出，便于日志聚合和分析。

**配置**:

```bash
# .env
LOG_LEVEL=INFO          # DEBUG, INFO, WARN, ERROR
LOG_FORMAT=json         # json 或 text
```

**日志示例**:

```json
{
  "timestamp": "2025-02-11T10:30:00.000Z",
  "level": "INFO",
  "service": "kiro-api",
  "message": "API request completed",
  "userId": 123,
  "model": "claude-sonnet-4-5-20250929",
  "inputTokens": 1500,
  "outputTokens": 800,
  "duration": 2500,
  "cost": 0.012
}
```

**日志级别**:
- `ERROR` - 错误信息（始终记录）
- `WARN` - 警告信息
- `INFO` - 一般信息（默认）
- `DEBUG` - 调试信息（详细）

### 4. 配置热更新

支持运行时修改配置，无需重启服务。

**端点**: `PATCH /api/config` (需要管理员权限)

**可更新配置**:

```json
{
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
  }
}
```

**使用示例**:

```bash
# 查看当前配置
curl -H "Authorization: Bearer YOUR_ADMIN_KEY" \
  http://localhost:19864/api/config

# 更新负载均衡策略
curl -X PATCH \
  -H "Authorization: Bearer YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"accountPool": {"strategy": "round-robin"}}' \
  http://localhost:19864/api/config

# 调整余额监控间隔（改为 10 分钟）
curl -X PATCH \
  -H "Authorization: Bearer YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"balanceMonitor": {"refreshInterval": 600000}}' \
  http://localhost:19864/api/config

# 重置为默认配置
curl -X POST \
  -H "Authorization: Bearer YOUR_ADMIN_KEY" \
  http://localhost:19864/api/config/reset
```

## 集成示例

### Grafana Dashboard

1. 添加 Prometheus 数据源
2. 导入以下查询：

```promql
# QPS
rate(kiro_api_requests_total[1m])

# 成功率
rate(kiro_api_requests_success_total[5m]) / rate(kiro_api_requests_total[5m])

# P95 延迟
histogram_quantile(0.95, rate(kiro_api_request_duration_ms_bucket[5m]))

# 活跃账号数
kiro_accounts_active

# Token 使用率
rate(kiro_tokens_output_total[1m])
```

### Docker Compose 示例

```yaml
version: '3.8'
services:
  kiro-api:
    image: kiro-api:latest
    ports:
      - "19864:19864"
    environment:
      - LOG_FORMAT=json
      - LOG_LEVEL=INFO
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:19864/health/live"]
      interval: 30s
      timeout: 10s
      retries: 3

  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana
    ports:
      - "3000:3000"
```

## 告警规则示例

```yaml
# prometheus-alerts.yml
groups:
  - name: kiro-api
    rules:
      - alert: HighErrorRate
        expr: rate(kiro_api_requests_failed_total[5m]) > 0.1
        for: 5m
        annotations:
          summary: "API 错误率过高"

      - alert: NoActiveAccounts
        expr: kiro_accounts_active == 0
        for: 1m
        annotations:
          summary: "没有可用的活跃账号"

      - alert: LowBalance
        expr: kiro_balance_total < 10
        for: 5m
        annotations:
          summary: "总余额不足"
```

## 最佳实践

1. **生产环境使用 JSON 日志**: 便于日志聚合工具（如 ELK、Loki）解析
2. **设置合理的日志级别**: 生产环境使用 INFO，调试时使用 DEBUG
3. **监控关键指标**: 成功率、延迟、活跃账号数、余额
4. **配置告警**: 错误率、账号可用性、余额不足
5. **定期检查健康状态**: 使用 `/health` 端点监控服务状态
6. **谨慎使用配置热更新**: 在低峰期进行配置调整，并监控影响

## 故障排查

### 指标不更新

检查 `/metrics` 端点是否可访问：

```bash
curl http://localhost:19864/metrics
```

### 健康检查失败

查看详细健康状态：

```bash
curl http://localhost:19864/health | jq
```

### 日志格式错误

确认环境变量设置：

```bash
echo $LOG_FORMAT
echo $LOG_LEVEL
```

### 配置更新失败

检查管理员权限和请求格式：

```bash
curl -v -H "Authorization: Bearer YOUR_ADMIN_KEY" \
  http://localhost:19864/api/config
```
