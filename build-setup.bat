@echo off
REM 构建安装程序
REM 需要先安装 Inno Setup (https://jrsoftware.org/isdl.php)

echo ========================================
echo Hermes Tray 安装程序构建
echo ========================================

REM 检查 Inno Setup
where iscc >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Inno Setup 编译器
    echo 请安装 Inno Setup: https://jrsoftware.org/isdl.php
    echo 或使用开始菜单中的 "Inno Setup Compiler" 图标手动编译 setup.iss
    exit /b 1
)

REM 检查 exe 文件
if not exist "dist\Hermes Tray.exe" (
    echo [错误] 未找到 dist\Hermes Tray.exe
    echo 请先运行 build.bat
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
echo 文件位置: installer\hermesTray-Setup-0.1.0.exe
echo.
