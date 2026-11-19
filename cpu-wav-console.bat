@echo off
setlocal
cd /d "%~dp0"
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0cpu-wav-console.ps1"
exit /b
