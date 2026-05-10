@echo off
echo ========================================
echo   SiteYeb / P2M CoreAI Workspace
echo ========================================
echo.
echo Starting backend (port 80)...
start "SiteYeb Backend" cmd /c "cd backend && .venv311\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 80 --reload"
timeout /t 2 /nobreak >nul
echo Starting frontend dev server (port 8000)...
start "SiteYeb Frontend" cmd /c "npm run dev"
echo.
echo Services starting:
echo   App / Backend: http://localhost
echo   Frontend dev: http://localhost:8000
echo.
echo Close this window to stop (services run in separate windows).
pause
