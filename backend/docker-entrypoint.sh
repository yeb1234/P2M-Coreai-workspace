#!/usr/bin/env bash
# 容器入口：等库 → 建表 → 可选迁移/回填 → 启服务
#
# 为什么需要等库：compose 的 depends_on 只保证容器启动顺序，
# 不保证 PostgreSQL 已经能接受连接。直接连会 Connection refused。
set -euo pipefail

DB_WAIT_RETRIES="${DB_WAIT_RETRIES:-60}"

echo "[entrypoint] 等待数据库可连接..."
python - "$DB_WAIT_RETRIES" <<'PY'
import os
import sys
import time

import psycopg

retries = int(sys.argv[1]) if len(sys.argv) > 1 else 60
dsn = os.environ.get("DATABASE_URL", "").replace("postgresql+psycopg://", "postgresql://")
if not dsn:
    print("[entrypoint] 未设置 DATABASE_URL，无法启动", file=sys.stderr)
    sys.exit(1)

last_error = None
for attempt in range(1, retries + 1):
    try:
        with psycopg.connect(dsn, connect_timeout=3) as conn:
            conn.execute("SELECT 1")
        print(f"[entrypoint] 数据库就绪（第 {attempt} 次尝试）")
        break
    except Exception as exc:  # noqa: BLE001
        last_error = exc
        print(f"[entrypoint] 等待中 {attempt}/{retries}: {str(exc)[:120]}")
        time.sleep(2)
else:
    print(f"[entrypoint] 数据库连接超时: {last_error}", file=sys.stderr)
    sys.exit(1)
PY

echo "[entrypoint] 初始化 schema（幂等）..."
python -c "from app.database import ensure_runtime_schema; ensure_runtime_schema()"

# 首次从 SQLite 迁移时打开（源库需挂载到 /data/source 并只读）
if [ "${MIGRATE_SQLITE:-false}" = "true" ]; then
    SOURCE="${SQLITE_SOURCE_PATH:-/data/source/learning_os.db}"
    if [ -f "$SOURCE" ]; then
        echo "[entrypoint] 从 $SOURCE 迁移业务数据..."
        python scripts/migrate_sqlite_to_pg.py --sqlite "$SOURCE" || \
            echo "[entrypoint] 迁移失败，继续启动（可稍后手动重跑）"
    else
        echo "[entrypoint] 未找到 $SOURCE，跳迁迁移"
    fi
fi

echo "[entrypoint] 启动服务: $*"
exec "$@"
