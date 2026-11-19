@echo off
REM ===========================================================================
REM  P2 Learning OS - launcher
REM
REM  Everything runs in Docker now (this is the part that changed).
REM  The old start.bat ran  uvicorn + npm run dev  directly on Windows.
REM  That no longer works: the app needs pgvector (PostgreSQL extension),
REM  Redis, and ffmpeg, all of which the compose stack provides.
REM
REM  Keep this file ASCII-only. cmd.exe reads .bat with the OEM codepage
REM  (GBK/936 on Chinese Windows); UTF-8 Chinese here shows up as garbage.
REM ===========================================================================

setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "COMPOSE=docker compose"

REM ---- sanity checks -------------------------------------------------------
docker info >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Docker is not running.
    echo         Start Docker Desktop and run this again.
    echo.
    pause
    exit /b 1
)

if not exist "docker-compose.yml" (
    echo [ERROR] docker-compose.yml not found next to this script.
    pause
    exit /b 1
)

if not exist ".env" (
    echo [WARN] .env not found. Copy .env.example to .env and fill it in.
    echo.
    pause
)

:menu
cls
echo ============================================================
echo   P2 Learning OS   ^|   Docker launcher
echo ============================================================
echo.
echo   [1] Full stack      db + redis + backend + worker + web
echo                       ^(needed for AI transcription/indexing^)
echo.
echo   [2] Web only        db + redis + backend + web
echo                       ^(no worker: no AI jobs, everything else works^)
echo.
echo   [3] Restart backend only
echo   [4] Restart frontend only
echo   [5] Status
echo   [6] Follow backend log
echo   [7] Stop everything
echo   [0] Exit
echo.
set "PICK="
set /p "PICK=Select: "

if "%PICK%"=="1" goto full
if "%PICK%"=="2" goto webonly
if "%PICK%"=="3" goto restart_backend
if "%PICK%"=="4" goto restart_frontend
if "%PICK%"=="5" goto status
if "%PICK%"=="6" goto logs
if "%PICK%"=="7" goto stop_all
if "%PICK%"=="0" goto bye
goto menu

REM ---- actions -------------------------------------------------------------
:full
echo.
echo Starting full stack ^(with AI worker^)...
%COMPOSE% up -d
call :wait_healthy
goto done

:webonly
echo.
echo Starting web-only stack ^(no AI worker^)...
REM redis is still started: backend declares depends_on: redis healthy.
REM It costs a few MB and keeps the compose file unchanged.
REM Worker is deliberately excluded - nothing will consume AI jobs.
%COMPOSE% up -d postgres redis backend frontend
call :wait_healthy
goto done

:restart_backend
echo.
echo Rebuilding and restarting backend + worker...
%COMPOSE% up -d --build backend worker
call :wait_healthy
goto done

:restart_frontend
echo.
echo Rebuilding and restarting frontend...
%COMPOSE% up -d --build frontend
call :wait_healthy
goto done

:status
echo.
%COMPOSE% ps
echo.
echo --- probe ---------------------------------------------------
curl -s -o nul -m 5 -w "  /health   HTTP %%{http_code}\n" http://localhost/health 2>nul
curl -s -o nul -m 5 -w "  /ready    HTTP %%{http_code}\n" http://localhost/ready 2>nul
echo.
echo   /ready 503 usually means the embedding server is down
echo   (LM Studio on the host, see EMBEDDING_BASE_URL in .env).
echo   The site still works; semantic search degrades to lexical.
echo.
pause
goto menu

:logs
echo.
echo Following backend log. Ctrl+C to stop following.
echo.
docker logs -f --tail 60 p2-siteyeb-backend-1
goto menu

:stop_all
echo.
%COMPOSE% down
echo.
echo Stopped. Data volumes are kept ^(siteyeb-pgdata / siteyeb-redis^).
pause
goto menu

REM ---- helpers -------------------------------------------------------------
:wait_healthy
echo.
echo   waiting for backend to become healthy...
set "READY=0"
for /l %%i in (1,1,30) do (
    if "!READY!"=="0" (
        for /f "delims=" %%s in ('docker inspect -f "{{.State.Health.Status}}" p2-siteyeb-backend-1 2^>nul') do (
            if "%%s"=="healthy" set "READY=1"
        )
        if "!READY!"=="0" (
            <nul set /p "=."
            timeout /t 4 /nobreak >nul
        )
    )
)
echo.
if "!READY!"=="1" (
    echo   backend healthy.
) else (
    echo   [WARN] backend not healthy after ~2 minutes.
    echo          Run option [6] to see the log.
)
exit /b

:done
echo.
echo   Opening http://localhost
start "" http://localhost
echo.
pause
goto menu

:bye
endlocal
exit /b 0
