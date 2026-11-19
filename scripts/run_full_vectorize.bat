@echo off
setlocal
cd /d "%~dp0.."

echo === P2 全库向量补缺（只补 embedding IS NULL，不重建块） ===
echo.

docker compose cp backend\scripts\backfill_chunk_embeddings.py backend:/app/scripts/backfill_chunk_embeddings.py >nul
if errorlevel 1 (
  echo [FAIL] backend 容器没在运行，先执行 docker compose up -d
  pause
  exit /b 1
)

docker compose exec -T backend python scripts/backfill_chunk_embeddings.py %*
echo.
echo 说明：这个 bat 不会 TRUNCATE content_chunks，也不会重算已有向量。
echo 如果输出“没有待回填的块”，说明当前覆盖率已经是 100%%，不需要全库重建。
pause
