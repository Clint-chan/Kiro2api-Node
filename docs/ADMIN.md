# 管理指南

## 访问管理面板

访问 `http://localhost:19864/login` 使用 `ADMIN_KEY` 登录管理面板。

---

## 用户管理

### 创建用户

1. 进入"用户管理"页面
2. 点击"创建用户"
3. 填写用户信息：
   - 用户名（必填）
   - 初始余额
   - 输入价格（元/百万 Token）
   - 输出价格（元/百万 Token）
   - 角色（用户/管理员）
4. 系统自动生成 API Key

### 用户充值

1. 在用户列表中找到目标用户
2. 点击"充值"按钮
3. 输入充值金额（支持负数扣款）
4. 添加备注（可选）
5. 确认充值

### 修改用户

1. 点击用户的"编辑"按钮
2. 可修改：
   - 用户名
   - 余额
   - 价格配置
   - 状态（启用/禁用）
   - 角色
3. 保存修改

### 删除用户

1. 选择要删除的用户
2. 点击"删除"按钮
3. 确认删除（会同时删除相关记录）

---

## Kiro 账号管理

### 添加账号

支持两种认证方式：

#### Social 认证

```json
{
  "name": "账号名称",
  "refreshToken": "your_refresh_token",
  "authMethod": "social"
}
```

#### IdC / BuilderId 认证

```json
{
  "name": "账号名称",
  "refreshToken": "your_refresh_token",
  "authMethod": "idc",
  "clientId": "your_client_id",
  "clientSecret": "your_client_secret"
}
```

### 批量导入

1. 准备 JSON 文件：

```json
[
  {
    "name": "账号1",
    "refreshToken": "token1",
    "authMethod": "social"
  },
  {
    "name": "账号2",
    "refreshToken": "token2",
    "authMethod": "idc",
    "clientId": "client_id",
    "clientSecret": "client_secret"
  }
]
```

2. 点击"批量导入"
3. 选择 JSON 文件
4. 确认导入

### 刷新账号额度

- **单个刷新**: 点击账号的"刷新"按钮
- **批量刷新**: 点击"刷新所有账号"

### 账号状态

- **active**: 正常可用
- **inactive**: 已禁用
- **error**: 出现错误（Token 失效等）

---

## 订阅管理

### 创建订阅

1. 进入用户详情页
2. 点击"设置订阅"
3. 选择订阅类型：
   - **日订阅**: 每日重置配额
   - **月订阅**: 每月重置配额
4. 设置配额限制
5. 设置过期时间
6. 确认创建

### 订阅类型说明

#### 日订阅

- 每日 00:00 自动重置配额
- 适合高频使用场景
- 配额用完后当日无法继续使用

#### 月订阅

- 每月 1 日 00:00 自动重置配额
- 适合稳定使用场景
- 配额用完后当月无法继续使用

### 取消订阅

1. 进入用户详情页
2. 点击"取消订阅"
3. 确认取消

---

## 统计与监控

### 用户统计

查看每个用户的：
- 总请求数
- 总 Token 使用量
- 总消费金额
- 成功/失败请求数

### 请求日志

查看详细的请求记录：
- 请求时间
- 使用的模型
- Token 使用量
- 费用
- 成功/失败状态
- 错误信息

### Kiro 账号统计

监控每个 Kiro 账号的：
- 请求次数
- 错误次数
- 剩余配额
- 最后使用时间

---

## 系统设置

### 账号池策略

选择 Kiro 账号的使用策略：

- **轮询（Round Robin）**: 按顺序轮流使用
- **随机（Random）**: 随机选择账号
- **最少使用（Least Used）**: 优先使用请求次数最少的账号

### 价格配置

设置全局默认价格：
- 输入 Token 价格（元/百万）
- 输出 Token 价格（元/百万）

新创建的用户会使用这些默认价格。

---

## 数据备份

### 手动备份

```bash
# 备份数据库
cp data/database.db data/database.db.backup.$(date +%Y%m%d)

# 备份账号配置
cp data/kiro-accounts.json data/kiro-accounts.json.backup.$(date +%Y%m%d)
```

### 自动备份

建议使用 cron 定时备份：

```bash
# 每天凌晨 2 点备份
0 2 * * * cd /path/to/kiro2api-node && cp data/database.db data/database.db.backup.$(date +\%Y\%m\%d)
```

### 恢复数据

```bash
# 停止服务
pm2 stop kiro2api-node

# 恢复数据库
cp data/database.db.backup.20260211 data/database.db

# 启动服务
pm2 start kiro2api-node
```

---

## 故障处理

### 用户无法使用

1. 检查用户状态是否为"active"
2. 检查余额是否充足
3. 检查 API Key 是否正确
4. 查看错误日志

### Kiro 账号失效

1. 检查账号状态
2. 尝试刷新 Token
3. 如果持续失败，重新获取 refreshToken
4. 更新账号配置

### 服务异常

1. 查看日志：`pm2 logs kiro2api-node`
2. 检查数据库是否正常
3. 检查磁盘空间
4. 重启服务：`pm2 restart kiro2api-node`

---

## 安全建议

1. **修改默认密钥**: 务必修改 `API_KEY` 和 `ADMIN_KEY`
2. **定期备份**: 每天备份数据库
3. **监控日志**: 定期查看错误日志
4. **限制访问**: 使用防火墙限制管理面板访问
5. **HTTPS**: 生产环境使用 HTTPS
6. **定期更新**: 及时更新到最新版本

---

## 性能优化

### 数据库优化

```bash
# 定期清理旧日志（保留最近 30 天）
sqlite3 data/database.db "DELETE FROM request_logs WHERE timestamp < datetime('now', '-30 days')"

# 优化数据库
sqlite3 data/database.db "VACUUM"
```

### 日志轮转

PM2 会自动进行日志轮转，配置在 `ecosystem.config.cjs`：

```javascript
max_size: '10M',  // 单个日志文件最大 10MB
retain: 7,        // 保留最近 7 个日志文件
```

### 内存限制

```javascript
max_memory_restart: '1G'  // 超过 1GB 自动重启
```
