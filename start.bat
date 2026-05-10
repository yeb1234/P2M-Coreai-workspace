@echo off
echo ========================================
echo   SiteYeb / P2M CoreAI Workspace
echo ========================================
echo.
echo Starting backend (port 5200)...
start "SiteYeb Backend" cmd /c "cd backend && .venv311\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 5200 --reload"
timeout /t 2 /nobreak >nul
echo Starting frontend (port 5173)...
start "SiteYeb Frontend" cmd /c "npm run dev"
echo.
echo Services starting:
echo   Frontend: http://localhost:5173
echo   Backend:  http://127.0.0.1:5200
echo.
echo Close this window to stop (services run in separate windows).
pause
