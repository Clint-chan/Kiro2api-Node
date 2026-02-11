# API 文档

## 端点列表

### 公开端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/health` | 健康检查（综合） |
| `GET` | `/health/live` | Liveness probe |
| `GET` | `/health/ready` | Readiness probe |
| `GET` | `/metrics` | Prometheus 指标 |
| `POST` | `/api/auth/login` | 用户登录 |

### Claude API 端点

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| `GET` | `/v1/models` | 获取可用模型列表 | API Key |
| `POST` | `/v1/messages` | 发送消息 | API Key |

### 用户端点

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| `GET` | `/api/user/info` | 获取用户信息 | Token |
| `GET` | `/api/user/stats` | 获取使用统计 | Token |
| `GET` | `/api/user/logs` | 获取请求日志 | Token |
| `GET` | `/api/user/recharge-records` | 获取充值记录 | Token |

### 管理端点

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| `GET` | `/api/admin/users` | 获取用户列表 | Admin Key |
| `POST` | `/api/admin/users` | 创建用户 | Admin Key |
| `PUT` | `/api/admin/users/:id` | 更新用户 | Admin Key |
| `DELETE` | `/api/admin/users/:id` | 删除用户 | Admin Key |
| `POST` | `/api/admin/users/:id/recharge` | 用户充值 | Admin Key |
| `GET` | `/api/admin/kiro-accounts` | 获取 Kiro 账号列表 | Admin Key |
| `POST` | `/api/admin/kiro-accounts` | 添加 Kiro 账号 | Admin Key |
| `DELETE` | `/api/admin/kiro-accounts/:id` | 删除 Kiro 账号 | Admin Key |
| `POST` | `/api/admin/kiro-accounts/:id/refresh` | 刷新账号额度 | Admin Key |
| `GET` | `/api/config` | 获取运行时配置 | Admin Key |
| `PATCH` | `/api/config` | 更新运行时配置 | Admin Key |
| `POST` | `/api/config/reset` | 重置为默认配置 | Admin Key |

---

## 认证方式

### API Key 认证

用于 Claude API 调用：

```bash
curl -H "x-api-key: your-api-key" http://localhost:19864/v1/messages
```

### Token 认证

用于用户端接口，通过登录获取：

```bash
curl -H "Authorization: Bearer your-token" http://localhost:19864/api/user/info
```

### Admin Key 认证

用于管理端接口：

```bash
curl -H "x-admin-key: your-admin-key" http://localhost:19864/api/admin/users
```

---

## Claude API 使用示例

### 基础请求

```bash
curl -X POST http://localhost:19864/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

### 流式响应

```bash
curl -X POST http://localhost:19864/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 1024,
    "stream": true,
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

### Thinking 模式

```bash
curl -X POST http://localhost:19864/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 16000,
    "thinking": {
      "type": "enabled",
      "budget_tokens": 10000
    },
    "messages": [
      {"role": "user", "content": "分析这个问题..."}
    ]
  }'
```

### 工具调用

```bash
curl -X POST http://localhost:19864/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 1024,
    "tools": [
      {
        "name": "get_weather",
        "description": "获取天气信息",
        "input_schema": {
          "type": "object",
          "properties": {
            "location": {"type": "string"}
          }
        }
      }
    ],
    "messages": [
      {"role": "user", "content": "北京天气怎么样？"}
    ]
  }'
```

---

## 支持的模型

| 模型 ID | 说明 |
|---------|------|
| `claude-sonnet-4-5-20250929` | Claude Sonnet 4.5 |
| `claude-opus-4-5-20251101` | Claude Opus 4.5 |
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 |

---

## 错误码

| 状态码 | 说明 |
|--------|------|
| `400` | 请求参数错误 |
| `401` | 认证失败 |
| `402` | 余额不足 |
| `403` | 权限不足 |
| `404` | 资源不存在 |
| `429` | 请求过于频繁 |
| `500` | 服务器内部错误 |
| `503` | 服务暂时不可用 |

---

## 响应格式

### 成功响应

```json
{
  "id": "msg_xxx",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Hello! How can I help you?"
    }
  ],
  "model": "claude-sonnet-4-5-20250929",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 20
  }
}
```

### 错误响应

```json
{
  "error": {
    "type": "invalid_request_error",
    "message": "余额不足"
  }
}
```

---

## 计费说明

### 价格配置

每个用户可以配置独立的价格（每百万 Token）：

- `price_input`: 输入 Token 价格（默认 3.0 元）
- `price_output`: 输出 Token 价格（默认 15.0 元）

### 计费公式

```
总费用 = (输入 Token 数 / 1,000,000 × 输入价格) + (输出 Token 数 / 1,000,000 × 输出价格)
```

### 示例

假设用户配置：
- 输入价格：3.0 元/百万 Token
- 输出价格：15.0 元/百万 Token

请求使用：
- 输入：1000 Token
- 输出：500 Token

计费：
```
费用 = (1000 / 1,000,000 × 3.0) + (500 / 1,000,000 × 15.0)
     = 0.003 + 0.0075
     = 0.0105 元
```
