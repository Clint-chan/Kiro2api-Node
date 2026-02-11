# 可观测性功能更新日志

## 新增功能

### 1. Prometheus 指标监控 (`/metrics`)

- 提供标准 Prometheus 格式的指标端点
- 支持 Grafana 可视化集成
- 包含请求、Token、账号、系统等多维度指标

**指标示例**:
- `kiro_api_requests_total` - 总请求数
- `kiro_api_request_duration_ms` - 请求延迟分布
- `kiro_tokens_input_total` / `kiro_tokens_output_total` - Token 使用量
- `kiro_accounts_active` - 活跃账号数
- `kiro_balance_total` - 总余额

### 2. 健康检查端点

- `GET /health` - 综合健康检查（数据库、账号池、余额）
- `GET /health/live` - Kubernetes liveness probe
- `GET /health/ready` - Kubernetes readiness probe

支持容器编排和负载均衡器的健康检查需求。

### 3. 结构化日志

- 支持 JSON 格式日志输出
- 可配置日志级别（DEBUG, INFO, WARN, ERROR）
- 便于日志聚合工具（ELK, Loki）解析

**配置**:
```bash
LOG_LEVEL=INFO
LOG_FORMAT=json
```

### 4. 配置热更新

- 支持运行时修改配置，无需重启服务
- 可更新：负载均衡策略、并发数、余额阈值、监控间隔等
- 提供管理 API：`GET/PATCH /api/config`

**示例**:
```bash
# 切换负载均衡策略
curl -X PATCH -H "Authorization: Bearer ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"accountPool": {"strategy": "round-robin"}}' \
  http://localhost:19864/api/config
```

## 新增文件

- `src/logger.js` - 结构化日志模块
- `src/metrics.js` - Prometheus 指标收集器
- `src/routes/observability.js` - 可观测性路由（/metrics, /health）
- `src/routes/config.js` - 配置热更新路由
- `src/routes/api-new-metrics.js` - API 指标记录辅助函数
- `docs/OBSERVABILITY.md` - 可观测性完整文档
- `test-observability.js` - 功能测试脚本

## 使用方法

### 查看指标

```bash
curl http://localhost:19864/metrics
```

### 检查健康状态

```bash
curl http://localhost:19864/health | jq
```

### 查看当前配置

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_KEY" \
  http://localhost:19864/api/config | jq
```

### 运行测试

```bash
# 设置环境变量
export ADMIN_KEY=your-admin-key-here

# 运行测试
node test-observability.js
```

## 集成建议

### Prometheus 配置

```yaml
scrape_configs:
  - job_name: 'kiro-api'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:19864']
```

### Kubernetes 部署

```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: kiro-api
    image: kiro-api:latest
    livenessProbe:
      httpGet:
        path: /health/live
        port: 19864
      initialDelaySeconds: 30
      periodSeconds: 10
    readinessProbe:
      httpGet:
        path: /health/ready
        port: 19864
      initialDelaySeconds: 10
      periodSeconds: 5
```

### Docker Compose

```yaml
services:
  kiro-api:
    image: kiro-api:latest
    environment:
      - LOG_FORMAT=json
      - LOG_LEVEL=INFO
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:19864/health/live"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## 性能影响

- 指标收集：几乎无性能影响（内存操作）
- 日志输出：JSON 格式略慢于文本格式（<1%）
- 健康检查：轻量级查询，响应时间 <10ms

## 向后兼容性

- 所有新功能均为可选，不影响现有 API
- 原有 `/health` 端点保持兼容，增强了返回信息
- 日志默认为 JSON 格式，可通过 `LOG_FORMAT=text` 切换回文本格式

## 下一步计划

- [ ] 添加更多业务指标（用户维度、模型维度）
- [ ] 支持自定义告警规则
- [ ] 集成 OpenTelemetry 链路追踪
- [ ] 提供 Grafana Dashboard 模板

## 参考文档

- [完整可观测性文档](./OBSERVABILITY.md)
- [API 文档](./API.md)
- [高可用架构文档](./HIGH-AVAILABILITY.md)
