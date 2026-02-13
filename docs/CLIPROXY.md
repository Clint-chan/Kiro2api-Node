# CLIProxy 渠道说明

## 概述

CLIProxy 是一个支持多协议转换的代理服务，为本项目提供 Antigravity 和 Codex 两个渠道的模型访问能力。

### CLIProxy 的作用

1. **协议转换**：自动在 Anthropic、OpenAI、Gemini 格式之间转换
2. **账号管理**：统一管理 Antigravity 和 Codex 账号池
3. **额度监控**：实时获取账号使用额度和限制信息
4. **负载均衡**：自动选择可用账号处理请求

## 支持的渠道

### Antigravity 渠道

**支持的模型**：
- `gemini-3-pro-high` - Gemini 3 Pro 高性能版本
- `gemini-3-flash` - Gemini 3 Flash 快速版本
- `gemini-2.5-flash` - Gemini 2.5 Flash
- `claude-sonnet-4-5-thinking` - Claude Sonnet 4.5 思维模式
- `claude-opus-4-5-thinking` - Claude Opus 4.5 思维模式
- `claude-opus-4-6-thinking` - Claude Opus 4.6 思维模式

**支持的 API 格式**：
- Anthropic 格式：`POST /v1/messages`
- OpenAI 格式：`POST /v1/chat/completions`
- Gemini 格式：`POST /v1internal:generateContent`

### Codex 渠道

**支持的模型**：
- `gpt-5.3-codex` - 最新前沿代码模型
- `gpt-5.2-codex` - 前沿代码模型
- `gpt-5.1-codex-max` - Codex 优化旗舰版，深度推理
- `gpt-5.2` - 最新前沿模型，改进知识、推理和编码
- `gpt-5.1-codex-mini` - Codex 优化版，更快更便宜

**支持的 API 格式**：
- OpenAI 格式：`POST /v1/chat/completions`

## 配置

### 环境变量

```bash
# CLIProxy 服务地址
CLIPROXY_URL=http://80.251.222.107:8317

# CLIProxy API 密钥
CLIPROXY_API_KEY=zxc123

# CLIProxy Management API 地址
CLIPROXY_MANAGEMENT_URL=http://80.251.222.107:8317

# CLIProxy Management API 密钥
CLIPROXY_MANAGEMENT_KEY=zxc123
```

## 测试新模型

当需要添加新的模型 ID 时，使用以下方法测试可用性：

### 1. 测试 Antigravity 模型

#### 通过 OpenAI 格式测试

```bash
API_KEY="your-api-key"
MODEL="model-id-to-test"

curl -s http://localhost:19864/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [{\"role\": \"user\", \"content\": \"Say hi\"}],
    \"max_tokens\": 10
  }" | jq
```

#### 通过 Anthropic 格式测试

```bash
API_KEY="your-api-key"
MODEL="model-id-to-test"

curl -s http://localhost:19864/v1/messages \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [{\"role\": \"user\", \"content\": \"hi\"}],
    \"max_tokens\": 5
  }" | jq
```

### 2. 测试 Codex 模型

```bash
API_KEY="your-api-key"
MODEL="model-id-to-test"

curl -s http://localhost:19864/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [{\"role\": \"user\", \"content\": \"Say hi\"}],
    \"max_tokens\": 10
  }" | jq
```

### 3. 批量测试脚本

```bash
#!/bin/bash

API_KEY=$(grep '^API_KEY=' .env | cut -d= -f2)

echo "=== Testing Antigravity Models ==="
for model in "gemini-3-pro-high" "gemini-3-flash" "claude-sonnet-4-5-thinking"; do
  echo -n "Testing $model: "
  result=$(curl -s http://localhost:19864/v1/chat/completions \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":5}" \
    | jq -r '.error.message // .choices[0].message.content // "Success"')
  
  if [[ -n "$result" ]] && [[ "$result" != "null" ]]; then
    echo "✅ Works"
  else
    echo "❌ Failed"
  fi
done

echo ""
echo "=== Testing Codex Models ==="
for model in "gpt-5.3-codex" "gpt-5.2-codex" "gpt-5.1-codex-max"; do
  echo -n "Testing $model: "
  result=$(curl -s http://localhost:19864/v1/chat/completions \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":5}" \
    | jq -r '.error.message // .choices[0].message.content // "Success"')
  
  if [[ -n "$result" ]] && [[ "$result" != "null" ]]; then
    echo "✅ Works"
  else
    echo "❌ Failed"
  fi
done
```

### 4. 直接测试 CLIProxy

如果需要绕过我们的服务器直接测试 CLIProxy：

```bash
# 测试 Antigravity 模型
curl -s http://80.251.222.107:8317/v1/chat/completions \
  -H "Authorization: Bearer zxc123" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-3-pro-high","messages":[{"role":"user","content":"hi"}],"max_tokens":5}' \
  | jq

# 测试 Codex 模型
curl -s http://80.251.222.107:8317/v1/chat/completions \
  -H "Authorization: Bearer zxc123" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.3-codex","messages":[{"role":"user","content":"hi"}],"max_tokens":5}' \
  | jq
```

## 添加新模型的步骤

1. **测试模型可用性**：使用上述测试方法验证模型是否可用
2. **更新系统设置页面**：在 `src/public/admin.html` 中添加模型 ID 胶囊
3. **更新权限管理**：在 `src/public/admin.html` 的 `ALL_MODELS` 中添加模型定义
4. **更新 Antigravity 配置**（如果是 Antigravity 模型）：
   - 在 `src/antigravity.js` 的 `AGT_EXCLUSIVE_MODELS` 中添加
   - 在 `MODEL_ALIAS` 中添加别名映射（如果需要）
   - 在 `AGT_STATIC_MODELS` 中添加模型元数据

## 账号管理

### 查看账号列表

通过管理面板的 "CLIProxy" 标签页查看：
- Antigravity 账号及其额度
- Codex 账号及其额度
- 账号状态（启用/禁用）

### 添加新账号

1. **Antigravity 账号**：
   - 点击 "添加 AGT 账号" 按钮
   - 完成 OAuth 授权流程

2. **Codex 账号**：
   - 通过 CLIProxy Management API 添加
   - 参考：https://help.router-for.me/cn/management/api.html

### 额度监控

系统自动显示：
- **Antigravity**：各模型的可用额度
- **Codex**：
  - 5 小时限额
  - 周限额
  - 代码审查周限额

## 故障排查

### 模型调用失败

1. **检查 CLIProxy 服务状态**：
   ```bash
   curl http://80.251.222.107:8317/health
   ```

2. **检查账号可用性**：
   - 访问管理面板 CLIProxy 标签页
   - 查看账号状态和额度

3. **查看日志**：
   ```bash
   pm2 logs kiro2api-node
   ```

### 额度显示异常

1. **刷新账号列表**：点击 "刷新账号" 按钮
2. **检查 Management API 配置**：确认 `CLIPROXY_MANAGEMENT_URL` 和 `CLIPROXY_MANAGEMENT_KEY` 正确
3. **查看浏览器控制台**：检查是否有 API 调用错误

## 参考资料

- [CLIProxy Management API 文档](https://help.router-for.me/cn/management/api.html)
- [CLIProxy 官方网站](https://router-for.me)
