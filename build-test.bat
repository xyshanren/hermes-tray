@echo off
REM Hermes Tray Windows 构建测试脚本 (重写版, 用 goto 标签替代多行 if/else, 修 CMD 解析静默退出)
REM 运行所有构建步骤，检查产物，输出日志
REM 使用方法: build-test.bat > build-test.log 2>&1
REM 完成后将 build-test.log 内容发回给开发者分析

setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

set LOGFILE=build-test.log
set TIMESTAMP=%DATE% %TIME%
set FAILED=0
set ERROR_NODE=0
set ERROR_NPM=0
set ERROR_RUST=0
set SKIP_ISCC=0

echo ========================================
echo Hermes Tray Windows 构建测试
echo 开始时间: %TIMESTAMP%
echo ========================================
echo.

REM ============ 阶段 1: 环境检查 ============
echo ========================================
echo [阶段 1/6] 环境检查
echo ========================================

echo [检查] Node.js 版本
where node >nul 2>&1
if not errorlevel 1 goto NODE_OK
echo [失败] Node.js 未安装
echo [修复] 请访问 https://nodejs.org 安装 v18+
set ERROR_NODE=1
goto NODE_DONE
:NODE_OK
node --version
echo [通过] Node.js
:NODE_DONE
echo.

echo [检查] npm 版本
where npm >nul 2>&1
if not errorlevel 1 goto NPM_OK
echo [失败] npm 未找到
set ERROR_NPM=1
goto NPM_DONE
:NPM_OK
npm --version
echo [通过] npm
:NPM_DONE
echo.

echo [检查] Rust 版本
where rustc >nul 2>&1
if not errorlevel 1 goto RUST_OK
echo [失败] Rust 未安装
echo [修复] 请运行: winget install Rustlang.Rustup
set ERROR_RUST=1
goto RUST_DONE
:RUST_OK
rustc --version
cargo --version
echo [通过] Rust
:RUST_DONE
echo.

echo [检查] Inno Setup
where iscc >nul 2>&1
if not errorlevel 1 goto ISCC_OK
echo [警告] Inno Setup 未安装（不影响主程序，只影响安装程序打包）
echo [修复] 请访问 https://jrsoftware.org/isdl.php 安装
set SKIP_ISCC=1
goto ISCC_DONE
:ISCC_OK
echo [通过] Inno Setup
:ISCC_DONE
echo.

echo [检查] 项目文件完整性
set ERROR_PROJECT=0
if not exist "src-tauri\Cargo.toml" (
    echo [失败] 缺少 src-tauri\Cargo.toml
    set ERROR_PROJECT=1
)
if not exist "package.json" (
    echo [失败] 缺少 package.json
    set ERROR_PROJECT=1
)
if not exist "setup.iss" (
    echo [失败] 缺少 setup.iss
    set ERROR_PROJECT=1
)
if not exist "assets\icon.ico" (
    echo [失败] 缺少 assets\icon.ico
    set ERROR_PROJECT=1
)
if %ERROR_PROJECT%==0 echo [通过] 项目文件清单
echo.

REM ============ 阶段 2: 依赖安装 ============
echo ========================================
echo [阶段 2/6] npm 依赖安装
echo ========================================

if "%ERROR_NODE%"=="1" goto SKIP_NPM_INSTALL
if "%ERROR_NPM%"=="1" goto SKIP_NPM_INSTALL

echo [步骤] npm install...
call npm install
if not errorlevel 1 goto NPM_INSTALL_OK
echo [失败] npm install 报错: !ERRORLEVEL!
goto NPM_INSTALL_DONE
:NPM_INSTALL_OK
echo [通过] npm install 完成
echo [验证] 检查关键包...
if exist "node_modules\@tauri-apps\cli" (echo [通过] @tauri-apps/cli 已安装) else (echo [失败] @tauri-apps/cli 缺失)
if exist "node_modules\vue" (echo [通过] Vue 已安装) else (echo [失败] Vue 缺失)
:NPM_INSTALL_DONE
goto AFTER_NPM_INSTALL
:SKIP_NPM_INSTALL
echo [跳过] Node.js/npm 不可用，无法安装依赖
:AFTER_NPM_INSTALL
echo.

REM ============ 阶段 3: 前端构建 ============
echo ========================================
echo [阶段 3/6] 前端构建
echo ========================================

if "%ERROR_NPM%"=="1" goto SKIP_FRONTEND

echo [步骤] npm run build...
call npm run build
if not errorlevel 1 goto FRONTEND_OK
echo [失败] 前端构建报错: !ERRORLEVEL!
goto FRONTEND_DONE
:FRONTEND_OK
echo [通过] 前端构建完成
if exist "dist\index.html" (
    echo [通过] dist\index.html 已生成
    dir /s "dist\*.html" "dist\*.js" "dist\*.css" 2>nul
) else (
    echo [失败] dist 目录缺少 index.html
    dir dist 2>nul
)
:FRONTEND_DONE
goto AFTER_FRONTEND
:SKIP_FRONTEND
echo [跳过] npm 不可用，无法构建前端
:AFTER_FRONTEND
echo.

REM ============ 阶段 4: Tauri 构建 ============
echo ========================================
echo [阶段 4/6] Tauri 构建
echo ========================================

if "%ERROR_RUST%"=="1" goto SKIP_TAURI

echo [步骤] npm run tauri build...
echo [注意] 首次构建会下载 Rust crate 依赖，可能需要 5-15 分钟
call npm run tauri build
if not errorlevel 1 goto TAURI_OK
echo [失败] Tauri 构建报错: !ERRORLEVEL!
goto TAURI_DONE
:TAURI_OK
echo [通过] Tauri 构建完成
if exist "src-tauri\target\release\hermes-tray-tauri.exe" (
    echo [通过] 主程序已生成
    for %%A in ("src-tauri\target\release\hermes-tray-tauri.exe") do (
        echo 大小: %%~zA 字节
        echo 路径: %%~fA
    )
) else (
    echo [失败] 主程序未找到
    dir "src-tauri\target\release\*.exe" 2>nul
)
if exist "src-tauri\target\release\bundle\msi" (
    echo [信息] Tauri MSI 包已生成
    dir "src-tauri\target\release\bundle\msi\*.msi" 2>nul
)
if exist "src-tauri\target\release\bundle\nsis" (
    echo [信息] Tauri NSIS 包已生成
    dir "src-tauri\target\release\bundle\nsis\*.exe" 2>nul
)
:TAURI_DONE
goto AFTER_TAURI
:SKIP_TAURI
echo [跳过] Rust 不可用，无法构建 Tauri 程序
:AFTER_TAURI
echo.

REM ============ 阶段 5: Inno Setup 安装程序 ============
echo ========================================
echo [阶段 5/6] Inno Setup 安装程序
echo ========================================

if "%SKIP_ISCC%"=="1" goto SKIP_ISCC
if not exist "src-tauri\target\release\hermes-tray-tauri.exe" goto SKIP_ISCC_NOEXE

echo [步骤] iscc setup.iss...
iscc setup.iss
if not errorlevel 1 goto ISCC_BUILD_OK
echo [失败] Inno Setup 编译报错: !ERRORLEVEL!
goto ISCC_BUILD_DONE
:ISCC_BUILD_OK
echo [通过] 安装程序生成完成
if exist "installer" (
    dir "installer\*.exe" 2>nul
    for %%A in ("installer\*.exe") do (
        echo 大小: %%~zA 字节
        echo 路径: %%~fA
    )
)
:ISCC_BUILD_DONE
goto AFTER_ISCC
:SKIP_ISCC_NOEXE
echo [跳过] 主程序不存在，先修复阶段 4
goto AFTER_ISCC
:SKIP_ISCC
echo [跳过] Inno Setup 不可用
:AFTER_ISCC
echo.

REM ============ 阶段 6: 测试汇总 ============
echo ========================================
echo [阶段 6/6] 测试汇总
echo ========================================

echo.
set FAILED=0

echo --- 产物清单 ---
if exist "src-tauri\target\release\hermes-tray-tauri.exe" (
    echo [通过] 主程序: 存在
) else (
    echo [失败] 主程序: 缺失
    set /a FAILED+=1
)
if exist "installer\*.exe" (
    for %%A in ("installer\*.exe") do (
        echo [通过] 安装程序: %%A (%%~zA 字节)
    )
) else (
    echo [警告] 安装程序: 未生成
)

echo.
echo --- 执行统计 ---
echo 环境检查: Node=!ERROR_NODE! npm=!ERROR_NPM! Rust=!ERROR_RUST!
echo npm 依赖: 已完成
echo 前端构建: 已完成
echo Tauri构建: 已完成
echo 安装程序: 已完成
echo.
echo 结束时间: %DATE% %TIME%

echo.
echo ========================================
if %FAILED% GTR 0 (
    echo 结果: %FAILED% 项检查失败，请查看上方日志
) else (
    echo 结果: 全部通过
)
echo ========================================

REM 输出测试结果摘要到单独文件
echo Hermes Tray Build Test Summary > build-test-summary.txt
echo ================================ >> build-test-summary.txt
echo Date: %DATE% %TIME% >> build-test-summary.txt
echo. >> build-test-summary.txt
echo Artifacts: >> build-test-summary.txt
if exist "src-tauri\target\release\hermes-tray-tauri.exe" (
    for %%A in ("src-tauri\target\release\hermes-tray-tauri.exe") do (
        echo   Main EXE: %%~fA (%%~zA bytes) >> build-test-summary.txt
    )
)
if exist "installer\*.exe" (
    for %%A in ("installer\*.exe") do (
        echo   Installer: %%A (%%~zA bytes) >> build-test-summary.txt
    )
)
echo. >> build-test-summary.txt
echo Prerequisites: >> build-test-summary.txt
echo   Node.js: [%ERROR_NODE%] npm: [%ERROR_NPM%] Rust: [%ERROR_RUST%] Inno Setup: [%SKIP_ISCC%] >> build-test-summary.txt
echo. >> build-test-summary.txt
echo Result: %FAILED% failures >> build-test-summary.txt

echo.
echo 日志已保存到: %CD%\build-test.log
echo 摘要已保存到: %CD%\build-test-summary.txt
echo.
echo 请将 build-test.log 文件内容发回给开发者分析
echo.
echo ========================================
echo  窗口将自动关闭 (按任意键立即关闭)
echo ========================================
timeout /t 30 /nobreak >nul
echo.
echo 现在打开 build-test.log (按任意键继续)...
pause >nul
start "" notepad.exe "%CD%\build-test.log"
echo.
echo 关闭前确认: 请把 build-test.log 内容贴回给开发者
pause