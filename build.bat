@echo off
REM Hermes Tray 打包脚本
REM 使用 PyInstaller 打包成 standalone exe

echo ========================================
echo Hermes Tray 打包脚本
echo ========================================

REM 检查 Python 环境
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Python，请先安装 Python
    exit /b 1
)

REM 检查依赖
echo [1/4] 检查依赖...
pip show pystray >nul 2>&1
if errorlevel 1 (
    echo [安装] 安装依赖...
    pip install -r requirements.txt
    pip install pyinstaller
)

REM 清理旧的构建文件
echo [2/4] 清理旧构建...
if exist "build" rmdir /s /q "build"
if exist "dist" rmdir /s /q "dist"
if exist "*.spec" del /q "*.spec"

REM 打包
echo [3/4] 打包中...
pyinstaller --onefile --windowed ^
    --icon=assets\icon.ico ^
    --add-data "assets;assets" ^
    --name "Hermes Tray" ^
    --hidden-import "PIL._tkinter_finder" ^
    --collect-all "pystray" ^
    --collect-all "PIL" ^
    tray_app.py

if errorlevel 1 (
    echo [错误] 打包失败
    exit /b 1
)

echo [4/4] 打包完成!
echo.
echo 产物: dist\Hermes Tray.exe
echo 大小:
for %%A in ("dist\Hermes Tray.exe") do echo   %%~zA bytes
echo.
echo 下一步: 运行 build-setup.bat 生成安装程序
