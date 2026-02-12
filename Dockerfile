FROM node:20-alpine

# 安装必要的构建工具（用于编译 better-sqlite3）
RUN apk add --no-cache python3 make g++

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装依赖（包括 better-sqlite3）
RUN npm ci --only=production

# 复制源代码和配置文件
COPY src ./src
COPY schema.sql ./

# 创建必要的目录
RUN mkdir -p /app/data /app/logs

# 设置环境变量默认值
ENV NODE_ENV=production
ENV PORT=19864
ENV DATA_DIR=/app/data

# 暴露端口
EXPOSE 19864

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:${PORT}/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 启动应用
CMD ["node", "src/index-new.js"]
