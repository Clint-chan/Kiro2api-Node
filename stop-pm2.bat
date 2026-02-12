@echo off
chcp 65001 >nul
echo ========================================
echo   Kiro2API-Node PM2 停止脚本
echo ========================================
echo.

pm2 stop kiro2api-node
pm2 delete kiro2api-node

echo.
echo [完成] 服务已停止并删除
pause
