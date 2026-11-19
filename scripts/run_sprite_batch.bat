@echo off
setlocal
cd /d "%~dp0.."

echo === P2 雪碧图批量生成（可重复执行，已有图会跳过） ===
echo 默认生成 1000 张；可覆盖参数，例如：
echo   scripts\run_sprite_batch.bat --limit 300
echo   scripts\run_sprite_batch.bat --dry-run --limit 50
echo.

docker compose cp backend\scripts\generate_sprites_batch.py backend:/app/scripts/generate_sprites_batch.py >nul
if errorlevel 1 (
  echo [FAIL] backend 容器没在运行，先执行 docker compose up -d
  pause
  exit /b 1
)

docker compose exec -T backend python scripts/generate_sprites_batch.py --limit 1000 %*
echo.
echo 单张 5–20 秒；不要在 Whisper 转写同时跑，避免抢 CPU。
pause
