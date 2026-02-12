@echo off
chcp 65001 >nul
echo ========================================
echo   Kiro2API-Node PM2 启动脚本
echo ========================================
echo.

REM 检查 Node.js 是否安装
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js
    pause
    exit /b 1
)

REM 检查 PM2 是否安装
where pm2 >nul 2>nul
if %errorlevel% neq 0 (
    echo [提示] 未检测到 PM2，正在安装...
    npm install -g pm2
    if %errorlevel% neq 0 (
        echo [错误] PM2 安装失败
        pause
        exit /b 1
    )
    echo [成功] PM2 安装完成
    echo.
)

REM 检查依赖是否安装
if not exist "node_modules" (
    echo [提示] 正在安装项目依赖...
    npm install
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
    echo [成功] 依赖安装完成
    echo.
)

REM 创建日志目录
if not exist "logs" mkdir logs

REM 启动 PM2
echo [启动] 正在启动服务...
pm2 start ecosystem.config.cjs

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo   服务启动成功！
    echo ========================================
    echo.
    echo 服务地址: http://localhost:19864
    echo 管理面板: http://localhost:19864/login
    echo.
    echo 常用命令:
    echo   查看日志: npm run pm2:logs
    echo   查看状态: pm2 status
    echo   重启服务: npm run pm2:restart
    echo   停止服务: npm run pm2:stop
    echo.
    timeout /t 3 /nobreak
) else (
    echo [错误] 服务启动失败
    pause
    exit /b 1
)
