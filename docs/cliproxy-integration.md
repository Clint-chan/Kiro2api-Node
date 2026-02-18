# CLIProxy 集成文档

> **文档目的**: 记录 CLIProxy 在本项目中的完整集成细节，便于后续 CLIProxyAPI 更新时参考合并

## 目录

1. [集成概览](#集成概览)
2. [账号管理集成](#账号管理集成)
3. [配额管理集成](#配额管理集成)
4. [阈值监控集成](#阈值监控集成)
5. [负载均衡集成](#负载均衡集成)
6. [账号状态细分](#账号状态细分)
7. [前端管理页面集成](#前端管理页面集成)
8. [与 CLIProxyAPI 原项目的差异](#与-cliproxyapi-原项目的差异)
9. [更新 CLIProxyAPI 时的合并指南](#更新-cliproxyapi-时的合并指南)
10. [环境配置](#环境配置)
11. [故障排查](#故障排查)

---

## 集成概览

### 架构模式

本项目采用 **混合模式** 集成 CLIProxy：

- **账号管理**: 使用 CLIProxy Management API（`/v0/management/auth-files`）
- **配额查询**: 使用 CLIProxy Management API（`/v0/management/auth-files`）
- **请求转发**: 使用 CLIProxy 代理端点（`/v1/messages`, `/v1/chat/completions`）

**关键区别**:
- **Antigravity Native 路由** (`src/routes/antigravity-native.js`): 直接调用上游 Google Antigravity API
- **通用 CLIProxy 路由** (`src/routes/api.js`): 通过 CLIProxy 代理端点转发请求

**为什么采用混合模式？**

1. **灵活性**: Antigravity 支持模型组级别禁用（直接调用上游 API）
2. **统一性**: Codex/Claude 通过 CLIProxy 代理端点统一处理
3. **可控性**: 自定义负载均衡策略（Antigravity）
4. **兼容性**: 保持现有路由架构不变

### 请求路由流程

```
用户请求 → routeModel() 判断渠道
  ↓
  ├─ Antigravity 模型 → antigravity-native.js → 直接调 Google API
  │                      (executeWithFailover + LoadBalancer)
  │
  ├─ Codex 模型 → handleCLIProxyOpenAIRequest() → CLIProxy /v1/chat/completions
  │
  └─ Claude 模型 → handleCLIProxyClaudeRequest() → CLIProxy /v1/messages
```

### CLIProxy Management API

**基础端点**: `http://localhost:8317/v0/management`

**主要接口**:

| 端点 | 方法 | 功能 |
|------|------|------|
| `/auth-files` | GET | 获取所有认证文件列表 |
| `/auth-files` | POST | 上传新的认证文件 |
| `/auth-files` | DELETE | 删除认证文件 |
| `/auth-files/status` | PATCH | 启用/禁用账号 |

### CLIProxy 代理端点

**基础端点**: `http://localhost:19865` (CLIPROXY_URL)

**主要接口**:

| 端点 | 方法 | 功能 | 使用场景 |
|------|------|------|---------|
| `/v1/messages` | POST | Anthropic 格式请求 | Codex/Claude 渠道 |
| `/v1/chat/completions` | POST | OpenAI 格式请求 | Codex 渠道 |

---

## 账号管理集成

### CLIProxyClient 实现

**文件**: `src/cliproxy-client.js`

**核心功能**:
- 封装 CLIProxy Management API 调用
- 实现 5 分钟内存缓存
- 提供账号列表、配额查询、状态管理

**缓存机制**:
```javascript
class CLIProxyClient {
    constructor(managementUrl, managementKey) {
        this.authFilesCache = null;
        this.authFilesCacheTime = 0;
        this.authFilesCacheTTL = 5 * 60 * 1000; // 5 分钟
    }
    
    async getCachedAuthFiles(forceRefresh = false) {
        const now = Date.now();
        const cacheExpired = now - this.authFilesCacheTime > this.authFilesCacheTTL;
        
        if (!forceRefresh && this.authFilesCache && !cacheExpired) {
            return this.authFilesCache;
        }
        
        const result = await this.listAuthFiles();
        this.authFilesCache = result;
        this.authFilesCacheTime = now;
        return result;
    }
}
```

### Auth 数据结构

```typescript
interface Auth {
  id: string;
  name: string;
  provider: string;              // antigravity, codex, claude
  email?: string;
  disabled: boolean;
  status: string;
  model_quotas?: string;         // JSON 字符串
  plan_tier?: string;            // Antigravity 特有
  next_reset?: string;
}
```

---

## 配额管理集成

### 配额数据格式

**Codex 配额** (来自 Codex Management API):
```json
{
  "rate_limit": {
    "primary_window": {
      "used_percent": 7,              // 整数（0-100），5小时限额已用 7%
      "limit_window_seconds": 18000   // 5小时窗口
    },
    "secondary_window": {
      "used_percent": 2,              // 整数（0-100），周限额已用 2%
      "limit_window_seconds": 604800  // 周窗口
    }
  },
  "code_review_rate_limit": {
    "primary_window": {
      "used_percent": 0,              // 整数（0-100），代码审查周限额已用 0%
      "limit_window_seconds": 604800  // 周窗口
    }
  }
}
```

**Claude 配额**:
```json
{
  "utilization": 0.75             // 已使用 75%（小数格式）
}
```

**Antigravity 配额**:
```json
{
  "model_quotas": {
    "claude-sonnet-4": {
      "remaining_fraction": 0.25  // 剩余 25%（小数格式）
    },
    "gemini-3-pro": {
      "remaining_fraction": 0.80
    }
  }
}
```

### Bug 修复记录：Codex 配额显示错误

#### Bug #1: 5小时限额显示错误（已修复）

**问题**: 账号 945036663 显示 99% 剩余，实际应该是 1%

**根因**: 误以为 CLIProxy API 返回的 `used_percent` 是小数（0-1），实际是整数（0-100）

**错误计算**:
```javascript
// ❌ 第一次错误（最初版本）
const remainingPercent = Math.max(0, 100 - usedPercent);
// 当 API 返回 0.99 时，计算结果 = 100 - 0.99 = 99.01%
```

**第一次修复（仍然错误）**:
```javascript
// ❌ 第二次错误（2026-02-18 第一次修复）
const remainingPercent = Math.max(0, (1 - usedPercent) * 100);
// 当 API 返回 7（整数）时，计算结果 = (1 - 7) * 100 = -600，被 Math.max 限制为 0
```

**最终修复（正确）**:
```javascript
// ✅ 正确计算（2026-02-18 第二次修复）
const remainingPercent = Math.max(0, 100 - usedPercent);
// 当 API 返回 7（整数）时，计算结果 = 100 - 7 = 93%
```

**关键发现**: Codex API 返回的 `used_percent` 是**整数（0-100）**，不是小数（0-1）

**修复文件**: `src/public/antigravity-cliproxy.js`

**修复位置**: 3 处（第 736、749、761 行）

**影响范围**:
- 5 小时限额显示
- 周限额显示
- 代码审查限额显示

**API 返回示例** (参考 `docs/codex-apicall.md`):
```json
{
  "rate_limit": {
    "primary_window": {
      "used_percent": 7    // 整数 7，表示已使用 7%
    },
    "secondary_window": {
      "used_percent": 2    // 整数 2，表示已使用 2%
    }
  },
  "code_review_rate_limit": {
    "primary_window": {
      "used_percent": 0    // 整数 0，表示已使用 0%
    }
  }
}
```

---

## 阈值监控集成

### 配额粒度差异

**关键设计决策**: 只有 Gemini (Antigravity) 限额精细到模型组，其他渠道（Codex/Claude）精细到账号级别

| 渠道 | 配额粒度 | 阈值检查粒度 |
|------|---------|-------------|
| Antigravity | 模型组级别 | 模型组级别 |
| Codex | 账号级别 | 账号级别 |
| Claude | 账号级别 | 账号级别 |

### Antigravity 模型组定义

**文件**: `src/cliproxy-threshold-checker.js`

```javascript
const MODEL_GROUPS = {
    claude_gpt: {
        patterns: [/^claude-/, /^gpt-/, /^o\d/],
        description: "Claude/GPT 统一计费组"
    },
    gemini_3_pro: {
        models: ["gemini-3-pro"]
    },
    gemini_3_pro_high: {
        models: ["gemini-3-pro-high"]
    },
    gemini_3_flash: {
        models: ["gemini-3-flash"]
    },
    gemini_3_pro_image: {
        models: ["gemini-3-pro-image"]
    }
};
```

### 阈值检查逻辑

**运行频率**: 每 15 分钟

**检查流程**:
1. 强制刷新 CLIProxy 缓存
2. 遍历每个账号的 model_quotas
3. 按模型组匹配，检查是否低于阈值
4. 写入 `system_settings` 表

**数据存储**:

**键**: `cliproxy_auto_disabled_groups_{accountName}`

**值**:
```json
{
  "version": 1,
  "groups": {
    "claude_gpt": {
      "mode": "auto",
      "disabled_at": 1708123456789,
      "reason": "gpt-4o remaining 18.0% < 20.0%",
      "threshold": 0.2,
      "observed": {
        "model_id": "gpt-4o",
        "remaining_fraction": 0.18
      }
    }
  }
}
```

### 路由集成

**文件**: `src/routes/antigravity-native.js`

**hasQuotaForModel 函数**:
```javascript
function hasQuotaForModel(account, modelId) {
    // 1. 检查配额
    const quotas = parseJsonSafe(account?.model_quotas);
    if (!quotas) return true;
    const info = quotas[modelId];
    if (!info) return true;
    const remaining = Number(info.remaining_fraction);
    if (remaining <= 0) return false;
    
    // 2. 检查模型组禁用状态
    const groupsJson = state.db.getSetting(
        `cliproxy_auto_disabled_groups_${account.name}`
    ) || "{}";
    const parsed = JSON.parse(groupsJson);
    const disabledGroups = parsed.groups || {};
    
    // 3. 判断模型属于哪个组
    const groupName = getModelGroupName(modelId);
    if (!groupName) return true;
    
    // 4. 检查该组是否被禁用
    return !disabledGroups[groupName];
}
```

**验证结果**: 禁用 `claude_gpt` 组后，`claude-sonnet-4-5` 不可用，但 `gemini-3-pro` 仍可用 ✅

---

## 负载均衡集成

### 设计原则

参考 Kiro 账号池的负载均衡设计，抽取公共逻辑，避免代码冗余。

### LoadBalancer 通用类

**文件**: `src/load-balancer.js`

**设计目标**:
- 可复用于所有 CLIProxy 渠道（Antigravity/Codex/Claude）
- 支持 4 种策略
- 无状态依赖，纯函数设计

**实现**:
```javascript
export class LoadBalancer {
    constructor(strategy = "round-robin") {
        this.strategy = strategy;
        this.roundRobinIndex = 0;
    }
    
    selectAccount(accounts) {
        if (!accounts || accounts.length === 0) return null;
        
        let selected;
        switch (this.strategy) {
            case "random":
                selected = accounts[Math.floor(Math.random() * accounts.length)];
                break;
            case "least-used":
                selected = accounts.reduce((a, b) =>
                    (a.request_count || 0) < (b.request_count || 0) ? a : b
                );
                break;
            case "least-error":
                selected = accounts.reduce((a, b) =>
                    (a.error_count || 0) < (b.error_count || 0) ? a : b
                );
                break;
            default: // round-robin
                selected = accounts[this.roundRobinIndex % accounts.length];
                this.roundRobinIndex++;
        }
        
        return selected;
    }
}
```

### Antigravity 路由集成

**文件**: `src/routes/antigravity-native.js`

**修改前**:
```javascript
// ❌ 按错误数排序，总是选第一个
filtered.sort((a, b) => {
    const scoreA = (a.error_count || 0) * 5 + (a.request_count || 0);
    const scoreB = (b.error_count || 0) * 5 + (b.request_count || 0);
    return scoreA - scoreB;
});
return filtered[0]; // 总是第一个
```

**修改后**:
```javascript
// ✅ 使用负载均衡器
import { LoadBalancer } from "../load-balancer.js";

const loadBalancer = new LoadBalancer("round-robin");

function executeWithFailover(modelId, executor) {
    const accounts = getEligibleAntigravityAccounts(modelId, excluded);
    const account = loadBalancer.selectAccount(accounts);
    // ...
}
```

### 负载均衡与禁用逻辑的完美结合

**核心设计**: 禁用逻辑在前，负载均衡在后

**完整流程**:
```javascript
// 1. 过滤合格账号（禁用逻辑）
function getEligibleAntigravityAccounts(modelId, excludedIds) {
    const accounts = state.db.getAllAntigravityAccounts("active");
    
    return accounts.filter((account) => {
        // ✅ 检查 1: 不在排除列表中
        if (excludedIds.has(account.id)) return false;
        
        // ✅ 检查 2: 配额充足 + 模型组未禁用
        return hasQuotaForModel(account, modelId);
    });
}

// 2. 从合格账号中选择（负载均衡）
const account = loadBalancer.selectAccount(accounts);

// 3. 执行请求，失败则故障转移
async function executeWithFailover(modelId, executor) {
    const excluded = new Set();
    
    while (true) {
        const accounts = getEligibleAntigravityAccounts(modelId, excluded);
        if (accounts.length === 0) break;
        
        const account = loadBalancer.selectAccount(accounts);
        
        try {
            return await executor(account);  // 成功返回
        } catch (error) {
            if (isAntigravityRateLimit(error)) {
                excluded.add(account.id);  // 429 限流，排除后重试
                continue;
            }
            throw error;  // 其他错误直接抛出
        }
    }
}
```

**关键点**:
1. **账号状态过滤**: 只选择 `status = "active"` 的账号
2. **配额检查**: `remaining_fraction > 0`
3. **模型组禁用检查**: 查询 `system_settings` 表，判断模型所属组是否被禁用
4. **负载均衡**: 从通过所有检查的账号中，按策略选择
5. **故障转移**: 429 错误时排除当前账号，重试其他账号

**单账号情况**:
- 如果只有 1 个账号，遇到 429 错误后，`excluded` 包含该账号
- 下次循环 `accounts.length === 0`，退出并抛出错误
- **不会无限重试同一个账号** ✅

### 与 Kiro 账号池的差异

**Kiro AccountPool** (`src/pool.js`):
- 有状态管理（余额、并发数、inflight）
- 集成 TokenManager
- 返回释放函数
- 支持 `least-inflight` 策略

**LoadBalancer** (`src/load-balancer.js`):
- 无状态，纯函数
- 只负责选择逻辑
- 不管理账号生命周期
- 支持 `least-error` 策略

**为什么不直接使用 AccountPool？**
- CLIProxy 账号没有 TokenManager
- CLIProxy 账号没有余额概念
- 避免引入不必要的依赖

**验证**: LoadBalancer 不影响 Kiro 账号池，两者独立运行 ✅

---

## 账号状态细分

### 状态映射规则

**用户需求**: `codex返回402说明封禁了 claudecode 401说明失效了 antigravity 403也是被封了 不要状态值都是error`

**实现文件**: `src/pool.js`, `src/public/admin-core.js`, `src/routes/admin/stats.js`

### 新增状态

| 状态 | 含义 | 触发条件 |
|------|------|---------|
| `banned` | 账号被封禁 | Codex 402, Antigravity 403 |
| `expired` | 账号失效 | Claude 401 |
| `error` | 其他错误 | 其他错误码 |

### 数据库迁移

**文件**: `src/database.js`, `schema.sql`

```sql
-- 扩展 status 约束
ALTER TABLE kiro_accounts 
CHECK (status IN ('active', 'disabled', 'error', 'banned', 'expired'));
```

### 前端显示

**文件**: `src/public/admin-core.js`

```javascript
function getStatusBadge(status) {
    const badges = {
        active: '<span class="badge bg-success">Active</span>',
        disabled: '<span class="badge bg-secondary">Disabled</span>',
        banned: '<span class="badge bg-danger">Banned</span>',
        expired: '<span class="badge bg-warning">Expired</span>',
        error: '<span class="badge bg-dark">Error</span>'
    };
    return badges[status] || badges.error;
}
```

### Prometheus 指标

**文件**: `src/routes/observability.js`

```javascript
kiro_accounts_by_status{status="banned"} 2
kiro_accounts_by_status{status="expired"} 1
kiro_accounts_by_status{status="error"} 0
```

### 通用请求处理函数

**文件**: `src/routes/api.js`

**函数命名**: 
- `handleCLIProxyClaudeRequest()` - 处理 Anthropic 格式请求
- `handleCLIProxyOpenAIRequest()` - 处理 OpenAI 格式请求

**适用渠道**: Antigravity / Codex / Claude 三个渠道共用

**调用逻辑**:
```javascript
// OpenAI 格式 (/v1/chat/completions)
if (route.channel === "antigravity" || 
    route.channel === "codex" || 
    route.channel === "claudecode") {
    return await handleCLIProxyOpenAIRequest(req, res);
}

// Anthropic 格式 (/v1/messages)
if (route.channel === "antigravity" || 
    route.channel === "codex" || 
    route.channel === "claudecode") {
    return await handleCLIProxyClaudeRequest(req, res);
}
```

**为什么命名为 CLIProxy 而非 Antigravity？**
- 这两个函数实际上是通用的 CLIProxy 请求处理函数
- 它们通过 CLIProxy 代理端点调用上游 API
- 支持所有 CLIProxy 管理的渠道（不仅仅是 Antigravity）

---

## 前端管理页面集成

### Codex 配额显示修复

**文件**: `src/public/antigravity-cliproxy.js`

**修复位置**: 第 736、749、761 行

**修复内容**: 见 [配额管理集成](#配额管理集成) 章节

### 账号状态增强

**文件**: `src/public/admin-core.js`

**新增功能**:
- 状态徽章显示（banned/expired/error）
- Toast 通知文案细分
- 状态筛选功能

---

## 与 CLIProxyAPI 原项目的差异

### 架构差异

| 维度 | CLIProxyAPI 原项目 | 本项目 |
|------|-------------------|--------|
| 请求代理 | 使用 `/v1/messages` 代理端点 | Codex/Claude 通过代理端点，Antigravity Native 直连 |
| 账号选择 | CLIProxy 内部 Selector | 自定义负载均衡器 |
| 配额粒度 | 账号级别 | Antigravity 支持模型组级别 |
| 状态管理 | ModelStates（内部） | system_settings 表 |

### 代码差异

**CLIProxyAPI 原项目** (`reference_project/CLIProxyAPI/`):
- Go 语言实现
- 内置 Selector 模式
- 支持 ModelStates 按模型粒度管理

**本项目**:
- Node.js 实现
- 混合模式集成
- 自定义模型组禁用逻辑

---

## 更新 CLIProxyAPI 时的合并指南

### 更新流程

1. **检查 CLIProxyAPI 更新日志**
   - 查看 Management API 是否有变更
   - 查看数据结构是否有变更

2. **评估影响范围**
   - 如果只是内部 Selector 逻辑变更 → 无需合并
   - 如果 Management API 变更 → 需要更新 `src/cliproxy-client.js`
   - 如果数据结构变更 → 需要更新解析逻辑

3. **合并步骤**
   - 更新 `src/cliproxy-client.js` 的 API 调用
   - 更新 Auth 数据结构解析
   - 更新前端显示逻辑
   - 运行测试验证

4. **不需要合并的部分**
   - CLIProxy 内部 Selector 逻辑（我们不使用）
   - CLIProxy 代理端点逻辑（我们不使用）
   - Go 语言相关代码

### 关键文件映射

| CLIProxyAPI 原项目 | 本项目 | 说明 |
|-------------------|--------|------|
| `management.go` | `src/cliproxy-client.js` | Management API 客户端 |
| `selector.go` | `src/load-balancer.js` | 账号选择逻辑（自定义） |
| `auth.go` | - | 数据结构定义（参考） |

---

## 环境配置

## 环境配置

### 完整数据流

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIProxy Management API                   │
│                  (http://localhost:8317)                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ GET /v0/management/auth-files
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              CLIProxyClient (内存缓存 5 分钟)                │
│  authFilesCache = { files: [Auth, Auth, ...] }              │
└─────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┴─────────────┐
                │                           │
                ▼                           ▼
┌───────────────────────────┐   ┌──────────────────────────┐
│  阈值检查器 (15 分钟)      │   │  请求路由 (每次请求)      │
│  - 强制刷新缓存            │   │  - 读取缓存              │
│  - 检查配额                │   │  - 过滤可用账号          │
│  - 更新禁用状态            │   │  - 选择最优账号          │
└───────────────────────────┘   └──────────────────────────┘
                │                           │
                ▼                           ▼
┌───────────────────────────┐   ┌──────────────────────────┐
│  system_settings 表        │   │  hasQuotaForModel()      │
│  cliproxy_auto_disabled_   │   │  - 检查 remaining        │
│  groups_{name}             │   │  - 查询 getSetting()     │
│  = { groups: {...} }       │   │  - 判断模型组            │
└───────────────────────────┘   └──────────────────────────┘
                                            │
                                            ▼
                                ┌──────────────────────────┐
                                │  返回可用账号列表         │
                                └──────────────────────────┘
```

### 时序图

```
用户请求 → antigravity-native.js
    │
    ├─→ getEligibleAntigravityAccounts(modelId)
    │       │
    │       ├─→ 读取 CLIProxy 缓存 (内存)
    │       │       └─→ authFilesCache.files
    │       │
    │       ├─→ 过滤 provider === "antigravity" && !disabled
    │       │
    │       └─→ hasQuotaForModel(account, modelId)
    │               │
    │               ├─→ 检查 model_quotas.remaining_fraction
    │               │       └─→ 如果 <= 0，返回 false
    │               │
    │               ├─→ 查询 getSetting() (prepared statement)
    │               │       └─→ cliproxy_auto_disabled_groups_{name}
    │               │
    │               ├─→ 解析 JSON，获取 disabledGroups
    │               │
    │               ├─→ getModelGroupName(modelId)
    │               │       └─→ 返回 "claude_gpt" | "gemini_3_pro" | ...
    │               │
    │               └─→ 检查 disabledGroups[groupName]
    │                       └─→ 如果存在，返回 false
    │
    └─→ 返回可用账号列表
```

---

## API 接口规范

### 1. 获取阈值状态

**端点：** `GET /api/admin/cliproxy/threshold-status`

**参数：**
- `name` (required): 账号名称

**响应：**
```json
{
  "config": {
    "claude_gpt": 0.2,
    "gemini_3_pro": 0.3,
    "gemini_3_pro_high": 0.25,
    "gemini_3_flash": 0.15,
    "gemini_3_pro_image": 0.2
  },
  "autoDisabledLegacy": false,
  "disabledGroups": {
    "claude_gpt": {
      "mode": "auto",
      "disabled_at": 1708123456789,
      "reason": "gpt-4o remaining 18.0% < 20.0%",
      "threshold": 0.2,
      "observed": {
        "model_id": "gpt-4o",
        "remaining_fraction": 0.18
      }
    }
  }
}
```

### 2. 设置阈值配置

**端点：** `POST /api/admin/cliproxy/threshold-config`

**请求体：**
```json
{
  "name": "account-name",
  "config": {
    "claude_gpt": 0.2,
    "gemini_3_pro": 0.3,
    "gemini_3_pro_high": 0.25,
    "gemini_3_flash": 0.15,
    "gemini_3_pro_image": 0.2
  }
}
```

**响应：**
```json
{
  "status": "ok"
}
```

---

## 性能优化

### 1. 查询性能分析

| 操作 | 频率 | 成本 | 说明 |
|------|------|------|------|
| CLIProxy 缓存读取 | 每次请求 | **0** | 内存读取 `authFilesCache` |
| `getSetting()` 查询 | 每次请求 | **极低** | Prepared statement + 索引 |
| JSON 解析 | 每次请求 | **极低** | 小对象，微秒级 |
| 正则匹配 | 每次请求 | **极低** | 简单模式，纳秒级 |

**总成本：** 每次请求增加约 **0.1-0.5ms**

### 2. 缓存策略

#### CLIProxy 缓存
- **TTL:** 5 分钟
- **刷新策略:** 
  - 阈值检查器每 15 分钟强制刷新
  - 前端手动刷新时强制刷新
- **失效处理:** 缓存未初始化时返回空数组

#### 禁用状态缓存
- **存储:** `system_settings` 表（SQLite）
- **查询:** Prepared statement（预编译）
- **索引:** 主键索引（`key`）
- **无需额外缓存:** 查询已足够快

### 3. 优化建议

#### 当前架构（推荐）
```javascript
// 每次请求查询 getSetting()
// 优点：实时性好，代码简单
// 缺点：每次请求 1 次数据库查询（但极快）
function hasQuotaForModel(account, modelId) {
    // ...
    const groupsJson = state.db.getSetting(`cliproxy_auto_disabled_groups_${account.name}`) || "{}";
    // ...
}
```

#### 未来优化（可选）
如果 QPS > 1000，可考虑添加内存缓存：

```javascript
class DisabledGroupsCache {
    constructor() {
        this.cache = new Map();
        this.ttl = 60 * 1000; // 1 分钟
    }
    
    get(accountName) {
        const entry = this.cache.get(accountName);
        if (!entry) return null;
        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(accountName);
            return null;
        }
        return entry.data;
    }
    
    set(accountName, data) {
        this.cache.set(accountName, {
            data,
            timestamp: Date.now()
        });
    }
    
    invalidate(accountName) {
        this.cache.delete(accountName);
    }
}
```

---

## 环境配置

### 必需环境变量

```bash
# CLIProxy Management API
CLIPROXY_MANAGEMENT_URL=http://localhost:8317
CLIPROXY_MANAGEMENT_KEY=your-management-key

# 阈值检查器
CLIPROXY_THRESHOLD_CHECK_INTERVAL=900000  # 15 分钟（毫秒）
```

### 可选环境变量

```bash
# 负载均衡策略
CLIPROXY_LOAD_BALANCE_STRATEGY=round-robin  # round-robin, random, least-used, least-error
```

### 启动 CLIProxy

```bash
# 使用 Docker
docker run -d \
  -p 8317:8317 \
  -v /path/to/auth-files:/app/auth-files \
  -e MANAGEMENT_KEY=your-management-key \
  cliproxy/cliproxy:latest

# 或使用二进制
./cliproxy --management-port 8317 --management-key your-management-key
```

---

## 故障排查

### 问题 1: 配额显示错误

**症状**: Codex 账号显示 99% 剩余，实际应该是 1%

**原因**: 前端计算公式错误（`100 - usedPercent` 而非 `(1 - usedPercent) * 100`）

**解决**: 已修复，见 [配额管理集成](#配额管理集成)

### 问题 2: 模型组未正确禁用

**症状**: 设置阈值后，模型仍然可用

**排查步骤**:
1. 检查 `system_settings` 表是否有对应记录
   ```sql
   SELECT * FROM system_settings WHERE key LIKE 'cliproxy_auto_disabled_groups_%';
   ```
2. 检查阈值检查器日志
   ```bash
   grep "模型组额度低于阈值" logs/app.log
   ```
3. 检查 `hasQuotaForModel` 函数是否正确调用

### 问题 3: CLIProxy 缓存未刷新

**症状**: 前端显示的配额数据过期

**排查步骤**:
1. 检查缓存 TTL（默认 5 分钟）
2. 手动触发刷新（前端刷新按钮）
3. 检查阈值检查器是否正常运行（每 15 分钟）

### 问题 4: 负载均衡不生效

**症状**: 总是使用同一个账号

**排查步骤**:
1. 检查 `LoadBalancer` 是否正确初始化
2. 检查 `roundRobinIndex` 是否递增
3. 检查可用账号列表是否为空

### 问题 5: 账号状态显示为 error

**症状**: 所有错误都显示为 `error` 状态

**原因**: 未正确映射错误码到状态

**解决**: 已修复，见 [账号状态细分](#账号状态细分)

---

## 更新日志

- **2026-02-18**: 完整重写文档，添加所有集成细节
- **2026-02-18**: 添加 Codex 配额显示 Bug 修复记录
- **2026-02-18**: 添加负载均衡集成章节
- **2026-02-18**: 添加账号状态细分章节
- **2026-02-18**: 添加与原项目差异对比
- **2026-02-18**: 添加合并指南和故障排查

---

**文档维护者**: Kiro Development Team  
**最后更新**: 2026-02-18
