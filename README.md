# Kiro2API-Node

<p align="center">
  <strong>多用户 SaaS 架构的 Kiro AWS Claude API 代理服务</strong>
</p>

<p align="center">
  将 Kiro AWS Claude API 转换为标准 Anthropic API 格式，支持多用户、计费管理、订阅系统
</p>

---

## ✨ 特性

- 🔄 **Anthropic API 兼容** - 完整支持标准 Claude API 格式
- 👥 **多用户 SaaS** - 用户管理、API Key、余额计费
- 💰 **计费系统** - 按 Token 计费、充值记录、消费统计
- 📅 **订阅管理** - 日订阅、月订阅、配额管理
- 🔐 **账号池** - 多 Kiro 账号轮询、自动刷新 Token
- 🛡️ **高可用** - 三道防线，99%+ 成功率，自动故障转移
- 📊 **Web 管理面板** - 用户端和管理端界面
- 🐳 **Docker 支持** - 一键部署

---

## 🚀 快速开始

### 1. 配置环境变量

```bash
# 复制配置模板
cp .env.example .env

# 编辑 .env，配置必填项
# - API_KEY: 用户 API 密钥
# - ADMIN_KEY: 管理员密钥
```

### 2. 选择部署方式

#### Docker 部署（推荐）

```bash
docker-compose up -d
```

#### PM2 部署

```bash
npm install
npm run pm2:start
```

#### 直接运行

```bash
npm install
npm start
```

### 3. 访问服务

- **服务地址**: http://localhost:19864
- **登录页面**: http://localhost:19864/login
- **健康检查**: http://localhost:19864/health

---

## 📖 文档

- [高可用架构](./docs/HIGH-AVAILABILITY.md) - 三道防线设计，99%+ 成功率
- [部署指南](./docs/DEPLOYMENT.md) - 详细的部署说明
- [API 文档](./docs/API.md) - API 接口文档
- [管理指南](./docs/ADMIN.md) - 管理面板使用说明

---

## 🔧 配置说明

### 必填配置

| 配置项 | 说明 |
|--------|------|
| `API_KEY` | 用户 API 密钥 |
| `ADMIN_KEY` | 管理员密钥 |

### 可选配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | `19864` | 服务端口 |
| `DATA_DIR` | `./data` | 数据目录 |
| `REGION` | `us-east-1` | AWS 区域 |
| `PROXY_URL` | - | 代理地址（可选） |

详细配置请查看 [.env.example](./.env.example)

---

## 📦 项目结构

```
kiro2api-node/
├── src/                  # 源代码
│   ├── index-new.js     # 主入口
│   ├── database.js      # 数据库管理
│   ├── kiro-client.js   # Kiro API 客户端
│   ├── billing.js       # 计费管理
│   ├── subscription.js  # 订阅管理
│   └── public/          # Web 界面
├── data/                # 数据存储
├── logs/                # 日志文件
├── docs/                # 文档
├── .env.example         # 配置模板
├── ecosystem.config.cjs # PM2 配置
├── docker-compose.yml   # Docker 配置
└── deploy.sh/bat        # 部署脚本
```

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

## 📄 License

MIT

---

## 🙏 致谢

基于 [kiro2api-rs](https://github.com/vagmr/kiro2api-rs) 使用 Node.js 重构并扩展为多用户 SaaS 架构
