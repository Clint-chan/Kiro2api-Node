# PM2 部署指南

## Windows 用户快速启动

### 方法一：使用启动脚本（推荐）

1. 双击 `start-pm2.bat` 文件
2. 脚本会自动：
   - 检查并安装 Node.js 和 PM2
   - 安装项目依赖
   - 启动服务
   - 显示服务状态

### 方法二：命令行启动

```bash
# 安装 PM2（首次运行）
npm install -g pm2

# 安装项目依赖
npm install

# 启动服务
npm run pm2:start
```

## 常用命令

```bash
# 查看服务状态
pm2 status

# 查看实时日志
npm run pm2:logs
# 或
pm2 logs kiro2api-node

# 重启服务
npm run pm2:restart

# 停止服务
npm run pm2:stop

# 删除服务
npm run pm2:delete

# 查看监控面板
npm run pm2:monit
```

## 配置说明

PM2 配置文件：`ecosystem.config.cjs`

```javascript
module.exports = {
  apps: [{
    name: 'kiro2api-node',           // 应用名称
    script: './src/index.js',        // 启动脚本
    instances: 1,                    // 实例数量
    exec_mode: 'fork',               // 执行模式
    autorestart: true,               // 自动重启
    watch: false,                    // 文件监听
    max_memory_restart: '1G',        // 内存限制
    env: {
      NODE_ENV: 'production',
      PORT: 8080
    },
    error_file: './logs/error.log',  // 错误日志
    out_file: './logs/out.log',      // 输出日志
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
```

## 日志管理

日志文件位置：
- 错误日志：`logs/error.log`
- 输出日志：`logs/out.log`

查看日志：
```bash
# 实时查看所有日志
pm2 logs kiro2api-node

# 只看错误日志
pm2 logs kiro2api-node --err

# 只看输出日志
pm2 logs kiro2api-node --out

# 清空日志
pm2 flush
```

## 开机自启动

### Windows

```bash
# 保存当前 PM2 进程列表
pm2 save

# 生成启动脚本
pm2 startup

# 按照提示执行命令
```

### Linux/Mac

```bash
# 保存当前 PM2 进程列表
pm2 save

# 设置开机自启动
pm2 startup

# 按照提示执行命令（可能需要 sudo）
```

## 性能监控

```bash
# 查看实时监控
pm2 monit

# 查看详细信息
pm2 show kiro2api-node

# 查看进程列表
pm2 list
```

## 故障排查

### 服务无法启动

1. 检查端口是否被占用：
   ```bash
   # Windows
   netstat -ano | findstr :8080
   
   # Linux/Mac
   lsof -i:8080
   ```

2. 查看错误日志：
   ```bash
   pm2 logs kiro2api-node --err
   ```

3. 检查依赖是否安装：
   ```bash
   npm install
   ```

### 服务频繁重启

1. 查看日志找出错误原因：
   ```bash
   pm2 logs kiro2api-node
   ```

2. 检查内存使用：
   ```bash
   pm2 monit
   ```

3. 调整内存限制（在 ecosystem.config.cjs 中）

### 日志文件过大

```bash
# 清空日志
pm2 flush

# 或手动删除日志文件
rm -rf logs/*.log
```

## 更新部署

```bash
# 1. 拉取最新代码
git pull

# 2. 安装依赖
npm install

# 3. 重启服务
npm run pm2:restart

# 或使用 PM2 的无停机重启
pm2 reload kiro2api-node
```

## 卸载

```bash
# 停止并删除服务
npm run pm2:delete

# 卸载 PM2（可选）
npm uninstall -g pm2
```

## 高级配置

### 多实例负载均衡

修改 `ecosystem.config.cjs`：

```javascript
{
  instances: 4,              // 启动 4 个实例
  exec_mode: 'cluster'       // 集群模式
}
```

### 环境变量配置

```javascript
{
  env: {
    NODE_ENV: 'production',
    PORT: 8080,
    API_KEY: 'your-api-key',
    ADMIN_KEY: 'your-admin-key'
  },
  env_development: {
    NODE_ENV: 'development',
    PORT: 3000
  }
}
```

启动时指定环境：
```bash
pm2 start ecosystem.config.cjs --env development
```

## 参考资源

- [PM2 官方文档](https://pm2.keymetrics.io/)
- [PM2 进程管理](https://pm2.keymetrics.io/docs/usage/process-management/)
- [PM2 日志管理](https://pm2.keymetrics.io/docs/usage/log-management/)
