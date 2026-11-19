@echo off
setlocal
cd /d "%~dp0.."

echo === P2 字幕元数据回填（subtitle_segments -> transcription/transcript_segments） ===
echo.

docker compose cp backend\scripts\backfill_subtitle_metadata.py backend:/app/scripts/backfill_subtitle_metadata.py >nul
if errorlevel 1 (
  echo [FAIL] backend 容器没在运行，先执行 docker compose up -d
  pause
  exit /b 1
)

docker compose exec -T backend python scripts/backfill_subtitle_metadata.py %*
echo.
echo 不加 --apply 是 dry-run；确认后执行 run_backfill_subtitles.bat --apply
pause
