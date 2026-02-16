# CLIProxy 集成架构文档

## 目录

1. [CLIProxy 架构分析](#cliproxy-架构分析)
2. [当前集成状态](#当前集成状态)
3. [模型组级别禁用方案](#模型组级别禁用方案)
4. [数据流设计](#数据流设计)
5. [API 接口规范](#api-接口规范)
6. [性能优化](#性能优化)
7. [测试验证](#测试验证)

---

## CLIProxy 架构分析

### 核心组件

#### 1. Management API

CLIProxy 提供 Management API 用于管理认证文件和配置：

**基础端点：** `http://localhost:8317/v0/management`

**主要接口：**

| 端点 | 方法 | 功能 | 响应格式 |
|------|------|------|----------|
| `/auth-files` | GET | 获取所有认证文件列表 | `{ files: [...] }` |
| `/auth-files` | POST | 上传新的认证文件 | `{ status: "ok" }` |
| `/auth-files` | DELETE | 删除认证文件 | `{ status: "ok" }` |
| `/auth-files/status` | PATCH | 启用/禁用账号 | `{ status: "ok", disabled: bool }` |
| `/auth-files/models` | GET | 获取账号支持的模型 | `{ models: [...] }` |

#### 2. Auth 数据结构

```typescript
interface Auth {
  id: string;                    // 唯一标识
  auth_index: string;            // 运行时索引（用于 API 调用）
  name: string;                  // 文件名
  provider: string;              // 提供商：antigravity, codex, claude
  email?: string;                // 账号邮箱
  disabled: boolean;             // 是否禁用
  unavailable: boolean;          // 是否不可用（临时）
  status: string;                // 状态：active, disabled
  status_message?: string;       // 状态消息
  
  // Antigravity 特有字段
  plan_tier?: string;            // 订阅等级
  paid_tier?: string;            // 付费等级
  next_reset?: string;           // 下次重置时间
  
  // 配额信息（JSON 字符串）
  model_quotas?: string;         // 模型配额详情
  
  // 时间戳
  created_at?: string;
  updated_at?: string;
  last_refresh?: string;
}
```

#### 3. Model Quotas 结构

```typescript
interface ModelQuotas {
  [modelId: string]: {
    remaining_fraction: number;  // 剩余比例 (0-1)
    total?: number;              // 总额度
    used?: number;               // 已使用
    reset_at?: string;           // 重置时间
  }
}
```

**示例：**
```json
{
  "claude-sonnet-4-20250514": {
    "remaining_fraction": 0.75,
    "total": 1000,
    "used": 250
  },
  "gpt-4o": {
    "remaining_fraction": 0.20,
    "total": 500,
    "used": 400
  },
  "gemini-3-pro": {
    "remaining_fraction": 0.85,
    "total": 2000,
    "used": 300
  }
}
```

#### 4. 账号选择逻辑（CLIProxy 内部）

CLIProxy 使用 `Selector` 模式选择账号：

```go
// selector.go
func isAuthBlockedForModel(auth *Auth, model string, now time.Time) (bool, blockReason, time.Time) {
    // 1. 检查账号级别禁用
    if auth.Disabled || auth.Status == StatusDisabled {
        return true, blockReasonDisabled, time.Time{}
    }
    
    // 2. 检查模型级别状态（ModelStates）
    if model != "" && len(auth.ModelStates) > 0 {
        if state, ok := auth.ModelStates[model]; ok && state != nil {
            if state.Status == StatusDisabled {
                return true, blockReasonDisabled, time.Time{}
            }
            if state.Unavailable && state.NextRetryAfter.After(now) {
                if state.Quota.Exceeded {
                    return true, blockReasonCooldown, next
                }
            }
        }
    }
    
    // 3. 检查账号级别配额
    if auth.Unavailable && auth.NextRetryAfter.After(now) {
        if auth.Quota.Exceeded {
            return true, blockReasonCooldown, next
        }
    }
    
    return false, blockReasonNone, time.Time{}
}
```

**关键发现：**
- CLIProxy 支持 `ModelStates` 按模型粒度管理状态
- 但 Management API **不提供**更新 `ModelStates` 的接口
- 只能通过 `PATCH /auth-files/status` 禁用整个账号

---

## 当前集成状态

### 1. CLIProxyClient 实现

**文件：** `src/cliproxy-client.js`

**核心功能：**
- 封装 CLIProxy Management API 调用
- 实现 5 分钟内存缓存（`authFilesCache`）
- 提供账号列表、配额查询、状态管理

**缓存机制：**
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
            return this.authFilesCache; // 返回缓存
        }
        
        const result = await this.listAuthFiles();
        this.authFilesCache = result;
        this.authFilesCacheTime = now;
        return result;
    }
}
```

### 2. Antigravity 路由实现

**文件：** `src/routes/antigravity-native.js`

**当前问题：**
```javascript
function getEligibleAntigravityAccounts(modelId, excludedIds = new Set()) {
    // ❌ 问题：查询数据库，而不是使用 CLIProxy 缓存
    const accounts = state.db.getAllAntigravityAccounts("active") || [];
    
    const upstreamModel = resolveAntigravityUpstreamModel(modelId);
    
    const filtered = accounts.filter((account) => {
        if (excludedIds.has(account.id)) return false;
        if (!upstreamModel) return true;
        return hasQuotaForModel(account, upstreamModel);
    });
    
    // 排序逻辑...
    return filtered;
}
```

**hasQuotaForModel 当前实现：**
```javascript
function hasQuotaForModel(account, modelId) {
    const quotas = parseJsonSafe(account?.model_quotas);
    if (!quotas || typeof quotas !== "object") return true;
    const info = quotas[modelId];
    if (!info || typeof info !== "object") return true;
    const remaining = Number(info.remaining_fraction);
    if (!Number.isFinite(remaining)) return true;
    return remaining > 0; // ❌ 只检查配额，不检查模型组禁用状态
}
```

### 3. 阈值检查器

**文件：** `src/cliproxy-threshold-checker.js`

**工作流程：**
1. 每 15 分钟运行一次
2. 调用 `cliproxyClient.getCachedAuthFiles(true)` 强制刷新
3. 检查每个账号的配额
4. 如果低于阈值，写入 `system_settings` 表

**当前实现（已完成）：**
```javascript
async checkAntigravityThreshold(account, config) {
    const quota = account.quota || {};
    const disableGroups = {};
    
    // 按模型组检查
    const modelGroups = {
        claude_gpt: {
            patterns: [/^claude-/, /^gpt-/, /^o\d/],
            threshold: config.claude_gpt,
        },
        gemini_3_pro: {
            models: ["gemini-3-pro"],
            threshold: config.gemini_3_pro,
        },
        // ... 其他组
    };
    
    for (const [groupName, groupConfig] of Object.entries(modelGroups)) {
        if (groupConfig.threshold === undefined) continue;
        
        for (const [modelId, modelQuota] of Object.entries(quota)) {
            if (!modelQuota || modelQuota.remaining_fraction === undefined) continue;
            
            let matches = false;
            if (groupConfig.patterns) {
                matches = groupConfig.patterns.some((pattern) => pattern.test(modelId));
            } else if (groupConfig.models) {
                matches = groupConfig.models.includes(modelId);
            }
            
            if (matches && modelQuota.remaining_fraction < groupConfig.threshold) {
                disableGroups[groupName] = {
                    mode: "auto",
                    disabled_at: Date.now(),
                    reason: `${modelId} remaining ${(modelQuota.remaining_fraction * 100).toFixed(1)}% < ${(groupConfig.threshold * 100).toFixed(1)}%`,
                    threshold: groupConfig.threshold,
                    observed: {
                        model_id: modelId,
                        remaining_fraction: modelQuota.remaining_fraction,
                    },
                };
                break;
            }
        }
    }
    
    return { disableGroups };
}
```

**持久化：**
```javascript
// 写入数据库
const groupsData = { version: 1, groups: disableGroups };
this.db.setSetting(
    `cliproxy_auto_disabled_groups_${account.name}`,
    JSON.stringify(groupsData)
);
```

---

## 模型组级别禁用方案

### 设计目标

1. ✅ 当某个模型组低于阈值时，只禁用该模型组
2. ✅ 不影响其他模型组的使用
3. ✅ 前端清晰显示禁用状态
4. ✅ 自动恢复机制
5. ✅ 高性能，不增加显著查询负担

### 架构设计

#### 数据存储

**表：** `system_settings`

**键格式：** `cliproxy_auto_disabled_groups_{accountName}`

**值格式：**
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
    },
    "gemini_3_flash": {
      "mode": "auto",
      "disabled_at": 1708123456789,
      "reason": "gemini-3-flash remaining 12.5% < 15.0%",
      "threshold": 0.15,
      "observed": {
        "model_id": "gemini-3-flash",
        "remaining_fraction": 0.125
      }
    }
  }
}
```

#### 模型组定义

```javascript
const MODEL_GROUPS = {
    claude_gpt: {
        patterns: [/^claude-/, /^gpt-/, /^o\d/],
        description: "Claude/GPT 统一计费组"
    },
    gemini_3_pro: {
        models: ["gemini-3-pro"],
        description: "Gemini 3 Pro"
    },
    gemini_3_pro_high: {
        models: ["gemini-3-pro-high"],
        description: "Gemini 3 Pro High"
    },
    gemini_3_flash: {
        models: ["gemini-3-flash"],
        description: "Gemini 3 Flash"
    },
    gemini_3_pro_image: {
        models: ["gemini-3-pro-image"],
        description: "Gemini 3 Pro Image"
    }
};
```

#### 核心逻辑修改

**修改文件：** `src/routes/antigravity-native.js`

**修改点 1：使用 CLIProxy 缓存**
```javascript
function getEligibleAntigravityAccounts(modelId, excludedIds = new Set()) {
    // ✅ 修改：使用 CLIProxy 缓存
    const authFiles = state.cliproxyClient.authFilesCache;
    if (!authFiles || !authFiles.files) {
        return []; // 缓存未初始化
    }
    
    const accounts = authFiles.files.filter(
        f => f.provider === "antigravity" && !f.disabled
    );
    
    const upstreamModel = resolveAntigravityUpstreamModel(modelId);
    
    const filtered = accounts.filter((account) => {
        if (excludedIds.has(account.id)) return false;
        if (!upstreamModel) return true;
        return hasQuotaForModel(account, upstreamModel);
    });
    
    filtered.sort((a, b) => {
        const scoreA = (a.error_count || 0) * 5 + (a.request_count || 0);
        const scoreB = (b.error_count || 0) * 5 + (b.request_count || 0);
        return scoreA - scoreB;
    });
    
    return filtered;
}
```

**修改点 2：增强 hasQuotaForModel**
```javascript
function getModelGroupName(modelId) {
    // Claude/GPT 组
    if (/^claude-/.test(modelId) || /^gpt-/.test(modelId) || /^o\d/.test(modelId)) {
        return "claude_gpt";
    }
    
    // Gemini 组
    if (modelId === "gemini-3-pro") return "gemini_3_pro";
    if (modelId === "gemini-3-pro-high") return "gemini_3_pro_high";
    if (modelId === "gemini-3-flash") return "gemini_3_flash";
    if (modelId === "gemini-3-pro-image") return "gemini_3_pro_image";
    
    return null;
}

function hasQuotaForModel(account, modelId) {
    // 1. 检查配额（现有逻辑）
    const quotas = parseJsonSafe(account?.model_quotas);
    if (!quotas || typeof quotas !== "object") return true;
    const info = quotas[modelId];
    if (!info || typeof info !== "object") return true;
    const remaining = Number(info.remaining_fraction);
    if (!Number.isFinite(remaining)) return true;
    if (remaining <= 0) return false;
    
    // 2. 检查模型组禁用状态（新增）
    const groupsJson = state.db.getSetting(`cliproxy_auto_disabled_groups_${account.name}`) || "{}";
    let disabledGroups = {};
    try {
        const parsed = JSON.parse(groupsJson);
        disabledGroups = parsed.groups || {};
    } catch {
        return true;
    }
    
    if (Object.keys(disabledGroups).length === 0) return true;
    
    // 3. 判断模型属于哪个组
    const groupName = getModelGroupName(modelId);
    if (!groupName) return true;
    
    // 4. 检查该组是否被禁用
    return !disabledGroups[groupName];
}
```

---

## 数据流设计

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

## 测试验证

### 测试脚本

详见 `tests/cliproxy-integration.test.js`

### 测试场景

1. **CLIProxy 连接测试**
   - 验证 Management API 可访问
   - 验证认证密钥有效

2. **账号列表测试**
   - 获取账号列表
   - 验证数据结构
   - 验证 model_quotas 字段

3. **配额检查测试**
   - 模拟低配额场景
   - 验证阈值检查逻辑
   - 验证禁用状态写入

4. **路由过滤测试**
   - 模拟请求路由
   - 验证模型组过滤
   - 验证账号选择逻辑

5. **恢复机制测试**
   - 模拟配额恢复
   - 验证自动恢复逻辑
   - 验证状态清除

### 性能测试

```bash
# 压力测试
npm run test:performance

# 预期结果：
# - QPS: > 500
# - P99 延迟: < 50ms
# - 内存增长: < 10MB/hour
```

---

## 附录

### A. 数据库 Schema

```sql
-- system_settings 表
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 示例数据
INSERT INTO system_settings (key, value, updated_at) VALUES (
    'cliproxy_auto_disabled_groups_account1',
    '{"version":1,"groups":{"claude_gpt":{"mode":"auto","disabled_at":1708123456789,"reason":"gpt-4o remaining 18.0% < 20.0%","threshold":0.2,"observed":{"model_id":"gpt-4o","remaining_fraction":0.18}}}}',
    '2024-02-17T10:30:00.000Z'
);
```

### B. 环境变量

```bash
# CLIProxy 配置
CLIPROXY_MANAGEMENT_URL=http://localhost:8317
CLIPROXY_MANAGEMENT_KEY=your-management-key

# 阈值检查器配置
CLIPROXY_THRESHOLD_CHECK_INTERVAL=900000  # 15 分钟
```

### C. 日志格式

```javascript
// 阈值检查日志
logger.warn("模型组额度低于阈值，已记录禁用状态", {
    name: "account1",
    provider: "antigravity",
    groups: "claude_gpt, gemini_3_flash"
});

// 恢复日志
logger.info("Antigravity 模型组恢复", {
    name: "account1",
    reason: "模型组 claude_gpt 已恢复"
});
```

---

## 更新日志

- **2024-02-17:** 初始版本
- **2024-02-17:** 添加模型组级别禁用方案
- **2024-02-17:** 完善性能优化建议

---

**文档维护者：** Kiro Development Team  
**最后更新：** 2024-02-17
