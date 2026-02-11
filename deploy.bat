@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM Kiro2API-Node 快速部署脚本 (Windows)

echo =========================================
echo   Kiro2API-Node 快速部署
echo =========================================
echo.

REM 检查 .env 文件
if not exist .env (
    echo ⚠️  未找到 .env 文件，正在从模板创建...
    copy .env.example .env >nul
    echo ✓ 已创建 .env 文件
    echo.
    echo ⚠️  请编辑 .env 文件，配置以下必填项：
    echo    - API_KEY: 用户 API 密钥
    echo    - ADMIN_KEY: 管理员密钥
    echo.
    echo 配置完成后，重新运行此脚本
    pause
    exit /b 1
)

REM 读取 .env 文件检查必填项
set API_KEY_SET=0
set ADMIN_KEY_SET=0

for /f "usebackq tokens=1,2 delims==" %%a in (.env) do (
    if "%%a"=="API_KEY" (
        if not "%%b"=="" if not "%%b"=="your-api-key-here" set API_KEY_SET=1
    )
    if "%%a"=="ADMIN_KEY" (
        if not "%%b"=="" if not "%%b"=="your-admin-key-here" set ADMIN_KEY_SET=1
    )
)

if !API_KEY_SET!==0 (
    echo ❌ 错误: 请在 .env 文件中配置 API_KEY
    pause
    exit /b 1
)

if !ADMIN_KEY_SET!==0 (
    echo ❌ 错误: 请在 .env 文件中配置 ADMIN_KEY
    pause
    exit /b 1
)

echo ✓ 配置文件检查通过
echo.

REM 创建必要的目录
if not exist data mkdir data
if not exist logs mkdir logs
echo ✓ 创建数据目录
echo.

REM 检查部署方式
echo 请选择部署方式：
echo 1) Docker (推荐)
echo 2) PM2
echo 3) 直接运行
set /p choice="请输入选项 (1-3): "

if "%choice%"=="1" goto docker
if "%choice%"=="2" goto pm2
if "%choice%"=="3" goto direct
echo ❌ 无效选项
pause
exit /b 1

:docker
echo.
echo 使用 Docker 部署...
where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ 错误: 未安装 Docker
    pause
    exit /b 1
)

docker-compose down
docker-compose up -d --build
echo.
echo ✓ Docker 容器已启动
echo.
echo 查看日志: docker-compose logs -f
echo 停止服务: docker-compose down
goto end

:pm2
echo.
echo 使用 PM2 部署...
where pm2 >nul 2>nul
if %errorlevel% neq 0 (
    echo 正在安装 PM2...
    npm install -g pm2
)

if not exist node_modules (
    echo 正在安装依赖...
    npm install
)

pm2 delete kiro2api-node 2>nul
pm2 start ecosystem.config.cjs
pm2 save
echo.
echo ✓ PM2 服务已启动
echo.
echo 查看日志: pm2 logs kiro2api-node
echo 查看状态: pm2 status
echo 停止服务: pm2 stop kiro2api-node
goto end

:direct
echo.
echo 直接运行...
if not exist node_modules (
    echo 正在安装依赖...
    npm install
)

echo.
echo ✓ 准备完成，启动服务...
node src/index-new.js
goto end

:end
echo.
echo =========================================
echo   部署完成！
echo =========================================
echo.

REM 读取端口
set PORT=19864
for /f "usebackq tokens=1,2 delims==" %%a in (.env) do (
    if "%%a"=="PORT" set PORT=%%b
)

echo 服务地址: http://localhost:!PORT!
echo 登录页面: http://localhost:!PORT!/login
echo 健康检查: http://localhost:!PORT!/health
echo.
if not "%choice%"=="3" pause
