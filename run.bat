@echo off
chcp 65001 >nul 2>&1
echo Starting Hermes Tray...
python "%~dp0tray_app.py"
pause
