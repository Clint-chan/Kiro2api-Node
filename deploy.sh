#!/bin/bash

# Kiro2API-Node 快速部署脚本

set -e

echo "========================================="
echo "  Kiro2API-Node 快速部署"
echo "========================================="
echo ""

# 检查 .env 文件
if [ ! -f .env ]; then
    echo "⚠️  未找到 .env 文件，正在从模板创建..."
    cp .env.example .env
    echo "✓ 已创建 .env 文件"
    echo ""
    echo "⚠️  请编辑 .env 文件，配置以下必填项："
    echo "   - API_KEY: 用户 API 密钥"
    echo "   - ADMIN_KEY: 管理员密钥"
    echo ""
    echo "配置完成后，重新运行此脚本"
    exit 1
fi

# 检查必填配置
source .env
if [ -z "$API_KEY" ] || [ "$API_KEY" = "your-api-key-here" ]; then
    echo "❌ 错误: 请在 .env 文件中配置 API_KEY"
    exit 1
fi

if [ -z "$ADMIN_KEY" ] || [ "$ADMIN_KEY" = "your-admin-key-here" ]; then
    echo "❌ 错误: 请在 .env 文件中配置 ADMIN_KEY"
    exit 1
fi

echo "✓ 配置文件检查通过"
echo ""

# 创建必要的目录
mkdir -p data logs
echo "✓ 创建数据目录"
echo ""

# 检查部署方式
echo "请选择部署方式："
echo "1) Docker (推荐)"
echo "2) PM2"
echo "3) 直接运行"
read -p "请输入选项 (1-3): " choice

case $choice in
    1)
        echo ""
        echo "使用 Docker 部署..."
        if ! command -v docker &> /dev/null; then
            echo "❌ 错误: 未安装 Docker"
            exit 1
        fi
        
        docker-compose down
        docker-compose up -d --build
        echo ""
        echo "✓ Docker 容器已启动"
        echo ""
        echo "查看日志: docker-compose logs -f"
        echo "停止服务: docker-compose down"
        ;;
    2)
        echo ""
        echo "使用 PM2 部署..."
        if ! command -v pm2 &> /dev/null; then
            echo "正在安装 PM2..."
            npm install -g pm2
        fi
        
        if [ ! -d node_modules ]; then
            echo "正在安装依赖..."
            npm install
        fi
        
        pm2 delete kiro2api-node 2>/dev/null || true
        pm2 start ecosystem.config.cjs
        pm2 save
        echo ""
        echo "✓ PM2 服务已启动"
        echo ""
        echo "查看日志: pm2 logs kiro2api-node"
        echo "查看状态: pm2 status"
        echo "停止服务: pm2 stop kiro2api-node"
        ;;
    3)
        echo ""
        echo "直接运行..."
        if [ ! -d node_modules ]; then
            echo "正在安装依赖..."
            npm install
        fi
        
        echo ""
        echo "✓ 准备完成，启动服务..."
        node src/index-new.js
        ;;
    *)
        echo "❌ 无效选项"
        exit 1
        ;;
esac

echo ""
echo "========================================="
echo "  部署完成！"
echo "========================================="
echo ""
echo "服务地址: http://localhost:${PORT:-19864}"
echo "登录页面: http://localhost:${PORT:-19864}/login"
echo "健康检查: http://localhost:${PORT:-19864}/health"
echo ""
