@echo off
REM 构建安装程序（Tauri 版本）
REM 需要先运行 npm run tauri build 生成主程序
REM 需要安装 Inno Setup (https://jrsoftware.org/isdl.php)

echo ========================================
echo Hermes Tray 安装程序构建
echo ========================================

REM 检查 Inno Setup
where iscc >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Inno Setup 编译器
    echo 请安装 Inno Setup: https://jrsoftware.org/isdl.php
    echo 或使用 "Inno Setup Compiler" 图标手动编译 setup.iss
    exit /b 1
)

REM 检查 Tauri 构建产物
if not exist "src-tauri\target\release\hermes-tray-tauri.exe" (
    echo [错误] 未找到主程序
    echo 请先运行: npm run tauri build
    echo 产物应位于: src-tauri\target\release\hermes-tray-tauri.exe
    exit /b 1
)

REM 创建输出目录
if not exist "installer" mkdir "installer"

REM 编译
echo [编译] 正在生成安装程序...
iscc setup.iss

if errorlevel 1 (
    echo [错误] 编译失败
    exit /b 1
)

echo.
echo ========================================
echo 安装程序生成成功!
echo ========================================
echo.
for /f "tokens=*" %%i in ('dir /b installer\*.exe 2^>nul') do (
    echo 文件: installer\%%i
)
echo.
