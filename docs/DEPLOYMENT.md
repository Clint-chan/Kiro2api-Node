# Kiro2API-Node 部署指南

## 快速开始

### 1. 配置环境变量

```bash
# 复制配置模板
cp .env.example .env

# 编辑 .env 文件，配置必填项
# - API_KEY: 用户访问 API 的密钥
# - ADMIN_KEY: 管理员访问管理接口的密钥
```

### 2. 选择部署方式

#### 方式 1: 使用部署脚本（推荐）

**Linux/Mac:**
```bash
chmod +x deploy.sh
./deploy.sh
```

**Windows:**
```bash
deploy.bat
```

#### 方式 2: Docker 部署

```bash
# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

#### 方式 3: PM2 部署

```bash
# 安装依赖
npm install

# 启动服务
npm run pm2:start

# 查看日志
npm run pm2:logs

# 停止服务
npm run pm2:stop
```

#### 方式 4: 直接运行

```bash
# 安装依赖
npm install

# 启动服务
npm start
```

## 配置说明

### 必填配置

| 配置项 | 说明 | 示例 |
|--------|------|------|
| `API_KEY` | 用户 API 密钥 | `sk-your-secret-key` |
| `ADMIN_KEY` | 管理员密钥 | `admin-secret-key` |

### 可选配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `PORT` | 服务端口 | `19864` |
| `NODE_ENV` | 运行环境 | `production` |
| `DATA_DIR` | 数据目录 | `./data` |
| `REGION` | AWS 区域 | `us-east-1` |
| `KIRO_VERSION` | Kiro 版本 | `0.8.0` |
| `PROXY_URL` | 代理地址 | 无 |
| `MAX_HISTORY_TURNS` | 最大对话轮数 | 无限制 |
| `MAX_TOOL_RESULT_LENGTH` | 工具结果最大长度 | `50000` |

### 代理配置

如果需要通过代理访问 AWS 服务，在 `.env` 中配置：

```bash
PROXY_URL=http://127.0.0.1:7890
```

## 访问服务

部署完成后，可以通过以下地址访问：

- **服务地址**: `http://localhost:19864`
- **登录页面**: `http://localhost:19864/login`
- **健康检查**: `http://localhost:19864/health`
- **API 端点**: `http://localhost:19864/v1/messages`

## Docker 部署详细说明

### 构建镜像

```bash
docker build -t kiro2api-node .
```

### 运行容器

```bash
docker run -d \
  --name kiro2api-node \
  -p 19864:19864 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  --env-file .env \
  kiro2api-node
```

### 查看日志

```bash
docker logs -f kiro2api-node
```

### 进入容器

```bash
docker exec -it kiro2api-node sh
```

## PM2 部署详细说明

### 启动服务

```bash
pm2 start ecosystem.config.cjs
```

### 查看状态

```bash
pm2 status
pm2 show kiro2api-node
```

### 查看日志

```bash
pm2 logs kiro2api-node
pm2 logs kiro2api-node --lines 100
```

### 重启服务

```bash
pm2 restart kiro2api-node
```

### 停止服务

```bash
pm2 stop kiro2api-node
pm2 delete kiro2api-node
```

### 开机自启

```bash
pm2 startup
pm2 save
```

## 数据持久化

### 数据目录结构

```
data/
├── database.db          # SQLite 数据库
└── kiro-accounts.json   # Kiro 账号配置

logs/
├── combined.log         # 综合日志
├── error.log           # 错误日志
└── out.log             # 输出日志
```

### 备份数据

```bash
# 备份数据库
cp data/database.db data/database.db.backup

# 备份账号配置
cp data/kiro-accounts.json data/kiro-accounts.json.backup
```

## 故障排查

### 服务无法启动

1. 检查 `.env` 配置是否正确
2. 检查端口是否被占用：`netstat -ano | findstr 19864`
3. 查看错误日志：`pm2 logs kiro2api-node --err`

### 数据库错误

```bash
# 重新初始化数据库
rm data/database.db
# 重启服务，会自动创建新数据库
```

### 代理连接失败

1. 检查代理服务是否运行
2. 验证 `PROXY_URL` 配置是否正确
3. 如果不需要代理，注释掉 `.env` 中的 `PROXY_URL`

### Docker 容器无法启动

```bash
# 查看容器日志
docker logs kiro2api-node

# 重新构建镜像
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

## 性能优化

### PM2 集群模式

编辑 `ecosystem.config.cjs`：

```javascript
instances: 4,  // 改为 CPU 核心数
exec_mode: 'cluster'
```

### 内存限制

```javascript
max_memory_restart: '1G'  // 超过 1GB 自动重启
```

## 安全建议

1. **修改默认密钥**: 务必修改 `API_KEY` 和 `ADMIN_KEY`
2. **使用 HTTPS**: 生产环境建议使用 Nginx 反向代理并配置 SSL
3. **限制访问**: 配置防火墙规则，只允许必要的 IP 访问
4. **定期备份**: 定期备份数据库和配置文件
5. **日志轮转**: 配置日志轮转避免磁盘占满

## 更新升级

```bash
# 拉取最新代码
git pull

# 重新安装依赖
npm install

# 重启服务
pm2 restart kiro2api-node
# 或
docker-compose up -d --build
```

## 技术支持

如有问题，请查看：
- [GitHub Issues](https://github.com/your-repo/issues)
- [项目文档](./README.md)
