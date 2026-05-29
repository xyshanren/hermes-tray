@echo off
REM Hermes Tray Tauri 构建脚本
REM 在 Windows 上运行：构建 Tauri 程序 + 生成安装程序
setlocal enabledelayedexpansion

echo ========================================
echo Hermes Tray Tauri 构建脚本
echo ========================================

REM 检查 Node.js
echo [检查] Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Node.js，请先安装
    exit /b 1
)
echo [OK] Node.js

REM 检查 Rust
echo [检查] Rust...
where rustc >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Rust，请先安装: https://rustup.rs
    exit /b 1
)
echo [OK] Rust

REM 检查 Inno Setup
echo [检查] Inno Setup...
where iscc >nul 2>&1
if errorlevel 1 (
    echo [警告] 未找到 Inno Setup 编译器
    echo        将跳过安装程序生成
    echo        手动编译: iscc setup.iss
    set SKIP_INSTALLER=1
) else (
    echo [OK] Inno Setup
)

REM 安装 npm 依赖
echo.
echo [1/4] 安装 npm 依赖...
call npm install
if errorlevel 1 (
    echo [错误] npm install 失败
    exit /b 1
)

REM 构建前端
echo.
echo [2/4] 构建前端...
call npm run build
if errorlevel 1 (
    echo [错误] 前端构建失败
    exit /b 1
)

REM Tauri 构建
echo.
echo [3/4] Tauri 构建...
call npm run tauri build
if errorlevel 1 (
    echo [错误] Tauri 构建失败
    exit /b 1
)

REM 生成安装程序
if "%SKIP_INSTALLER%"=="1" (
    echo.
    echo [跳过后] 未找到 Inno Setup，跳过安装程序生成
    echo 产物: src-tauri\target\release\hermes-tray-tauri.exe
) else (
    echo.
    echo [4/4] 生成安装程序...
    iscc setup.iss
    if errorlevel 1 (
        echo [错误] 安装程序编译失败
        exit /b 1
    )
    echo [OK] 安装程序生成成功
)

REM 输出构建结果
echo.
echo ========================================
echo 构建完成!
echo ========================================
echo.
echo 主程序: src-tauri\target\release\hermes-tray-tauri.exe
if not "%SKIP_INSTALLER%"=="1" (
    for /f "tokens=*" %%i in ('dir /b installer\*.exe 2^>nul') do (
        echo 安装程序: installer\%%i
    )
)
echo.
echo 打开: src-tauri\target\release\hermes-tray-tauri.exe 直接运行
echo.
echo 提示: 可通过 set APP_VERSION=0.1.1 指定版本号
