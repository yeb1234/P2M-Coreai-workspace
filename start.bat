@echo off
setlocal
set "ROOT=%~dp0"
if /i "%~1"=="exit" goto exit_launcher

:menu
cls
echo ========================================
echo   SiteYeb / P2M CoreAI Workspace
echo ========================================
echo.
echo   1. Start / restart all services
echo   2. Restart backend only
echo   3. Restart frontend only
echo   4. Stop all services
echo   5. Exit launcher
echo.
choice /c 12345 /n /m "Select: "
if errorlevel 5 goto exit_launcher
if errorlevel 4 goto stop_all
if errorlevel 3 goto restart_frontend
if errorlevel 2 goto restart_backend
if errorlevel 1 goto restart_all

:restart_all
call :stop_backend
call :stop_frontend
call :start_backend
timeout /t 2 /nobreak >nul
call :start_frontend
goto after_action

:restart_backend
call :stop_backend
call :start_backend
goto after_action

:restart_frontend
call :stop_frontend
call :start_frontend
goto after_action

:stop_all
call :stop_backend
call :stop_frontend
goto after_action

:start_backend
echo Starting backend (port 80)...
start "SiteYeb Backend" /D "%ROOT%backend" cmd /k ".venv311\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 80 --reload"
exit /b

:start_worker
echo Starting AI RQ worker...
start "SiteYeb AI Worker" /D "%ROOT%backend" cmd /k ".venv311\Scripts\python -m app.worker"
exit /b

:start_frontend
echo Starting frontend dev server (port 5002)...
start "SiteYeb Frontend" /D "%ROOT%" cmd /k "npm run dev"
exit /b

:stop_backend
echo Stopping backend...
python "%~dp0stop.py" backend
exit /b

:stop_frontend
echo Stopping frontend...
python "%~dp0stop.py" frontend
exit /b

:after_action
echo.
echo Done. Service logs are shown in their own windows.
timeout /t 2 /nobreak >nul
goto menu

:exit_launcher
exit /b
