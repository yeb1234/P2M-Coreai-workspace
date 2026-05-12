@echo off
setlocal
set "ROOT=%~dp0"

echo ========================================
echo   SiteYeb / P2M CoreAI Workspace
echo ========================================
echo.
echo Restarting backend and frontend...
echo.

call :stop_backend
call :stop_frontend
timeout /t 2 /nobreak >nul
call :start_backend
timeout /t 2 /nobreak >nul
call :start_frontend

echo.
echo Restart complete.
echo   App / Backend: http://localhost
echo   Frontend dev: http://localhost:8000
echo.
echo Service logs are shown in their own windows.
timeout /t 3 /nobreak >nul
exit /b

:start_backend
echo Starting backend (port 80)...
start "SiteYeb Backend" /D "%ROOT%backend" cmd /k ".venv311\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 80 --reload"
exit /b

:start_frontend
echo Starting frontend dev server (port 8000)...
start "SiteYeb Frontend" /D "%ROOT%" cmd /k "npm run dev"
exit /b

:stop_backend
echo Stopping backend if it is running...
taskkill /FI "WINDOWTITLE eq SiteYeb Backend*" /T /F >nul 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports=@(80); foreach($port in $ports){ Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }; $root=(Resolve-Path '%ROOT%backend').Path; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like '*uvicorn*app.main:app*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul
exit /b

:stop_frontend
echo Stopping frontend if it is running...
taskkill /FI "WINDOWTITLE eq SiteYeb Frontend*" /T /F >nul 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports=@(8000); foreach($port in $ports){ Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }; $root=(Resolve-Path '%ROOT%').Path.TrimEnd('\'); Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and (($_.CommandLine -like '*npm*run*dev*') -or ($_.CommandLine -like '*vite*')) -and $_.CommandLine -like ('*' + $root + '*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul
exit /b
