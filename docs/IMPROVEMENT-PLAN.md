# 改进方案（精简版）

本文档聚焦两件事：
1) 修复账号删除接口报错；
2) 收敛状态与观测口径，减少前后端不一致。

不做大重构，不引入新依赖。

## 进度看板

- [x] 后端：删除前依赖检查（409 + 明确提示）
- [x] 后端：删除路径避免 DB 双删（accountPool 优先）
- [x] 后端：`/api/admin/stats/overview` 补全六类状态统计
- [x] 前端：删除失败 409 显示依赖数量与“改用禁用”提示
- [x] 前端：账号列表删除按钮支持“有依赖提示 + 强制删除二次确认”
- [x] 前端：状态卡 `cooldown` 与 `invalid` 统计口径修正
- [x] 文档：补充 `/metrics`（内存）与 `/stats/overview`（DB）口径差异说明
- [x] 后端：删除接口支持 `force=true`（事务删除请求日志+账号）

## 一、已定位问题

### 1. 删除账号失败（你反馈的 bug）

- 现象：`DELETE /api/admin/accounts/:id` 返回 `internal_error`。
- 根因：该账号在 `request_logs` 存在外键引用，SQLite 外键开启时会拒绝删除父行。
- 证据：`schema.sql` 中 `request_logs.kiro_account_id -> kiro_accounts.id` 外键；`src/database.js` 初始化开启 `foreign_keys = ON`。

### 2. 删除时 DB/内存双写顺序不稳

- 原逻辑在路由里先删 DB，再调用 `accountPool.removeAccount()`；
- 而 `removeAccount()` 本身也会删 DB，存在重复删除。

### 3. 管理统计信息不完整

- `/api/admin/stats/overview` 原先只有 `total/active`，不利于排查 `cooldown/error/depleted`。

### 4. 状态口径仍有分裂风险

- `/metrics` 主要看内存池状态；
- 管理统计主要看数据库；
- 在高频变更时可能出现短时不一致。

## 二、已实施改动（本轮）

### A. 删除接口增强（低风险）

文件：`src/routes/admin-new.js`

- 删除前先查账号是否存在（不存在返回 404）。
- 删除前统计 `request_logs` 依赖数。
- 有依赖时返回 409（`conflict`），并给出可操作建议：先禁用账号。
- 删除成功路径改为：
  - 有 `accountPool` 时只调用 `accountPool.removeAccount(id)`（由其统一做内存+DB同步）；
  - 无 `accountPool` 时直接 `db.deleteKiroAccount(id)`。

### B. 统计接口补全状态分布

文件：`src/routes/admin-new.js`

`/api/admin/stats/overview` 现返回：
- `active`
- `cooldown`
- `error`
- `depleted`
- `disabled`
- `inactive`

便于前端直接展示状态看板。

### C. 账号列表返回依赖信息（用于前端禁删）

文件：`src/routes/admin-new.js`

`GET /api/admin/accounts` 增加字段：
- `request_log_count`
- `has_dependencies`

前端据此给出“强制删除将同步删除日志”的提示，并增加二次确认，降低误操作率。

### D. 删除接口支持强制删除（force）

文件：`src/routes/admin-new.js`

`DELETE /api/admin/accounts/:id?force=true`：
- 在事务中先删 `request_logs` 再删 `kiro_accounts`
- 返回 `deletedLogs/deletedAccounts`
- 若存在 `accountPool`，同步清理内存（避免重启前脏状态）

## 三、为什么不做过度设计

这次不采用：
- 级联删除迁移（`ON DELETE CASCADE`）
- 事件总线/实时推送
- 大规模拆文件重构

理由：当前目标是“稳定修复 + 清晰提示 + 最小改动”。

## 四、参考结论（外部调研摘要）

结合 SQLite 官方文档与 Node 实践，针对“父表被子表引用时删除”最稳妥策略是：

1. 先做依赖检查并返回可读错误（当前已做）。
2. 管理端提供“禁用替代删除”操作（当前已有 `disable` 路由）。
3. 后续若要真删历史，可再引入事务化清理策略（单独评估）。

## 四点五、指标口径说明（已补充）

当前两个核心统计端点的口径不同，这是设计上的取舍，不是 bug：

1. `GET /metrics`
   - 主要来源：`accountPool` 内存态
   - 特点：实时性高，适合监控告警
   - 风险：在状态刚更新但尚未完全落库/重载时，可能与后台统计短时不一致

2. `GET /api/admin/stats/overview`
   - 主要来源：数据库聚合
   - 特点：管理视角稳定，适合报表与后台总览
   - 风险：相比内存态有轻微延迟

### 使用建议

- 告警/运行态判断优先看 `/metrics`。
- 管理后台总览优先看 `/api/admin/stats/overview`。
- 若出现短时差异，以“刷新后收敛”作为正常预期；持续不收敛才视为异常。

## 五、下一步（按优先级）

### P0（建议立即）

1. [x] 前端删除弹窗里直接提示：若有历史请求日志将无法硬删除，请改用“禁用”。
2. [x] 删除失败（409）时 toast 显示后端返回的依赖数量。

### P1（短期）

1. 统一状态口径说明（文档中明确哪些页面读内存、哪些读 DB）。
2. 管理页状态卡展示完整六类状态，避免“invalid=total-active”这类折叠统计。

### P2（可选）

1. 若将来确实需要“硬删除且清理历史”，再做事务化清理/归档设计。

## 六、验收清单

- 删除不存在账号 -> 404
- 删除有日志依赖账号 -> 409 + 可操作提示
- 删除无依赖账号 -> 200，且不再出现内存/DB重复删除问题
- `/api/admin/stats/overview` 返回六类状态字段
