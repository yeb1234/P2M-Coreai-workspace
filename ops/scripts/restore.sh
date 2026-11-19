#!/usr/bin/env bash
# 数据库恢复
#
# 用法：
#   ./scripts/restore.sh backups/p2learning-20261115-031500.dump           # 交互确认
#   ./scripts/restore.sh backups/xxx.dump --yes                            # 跳过确认
#
# 这是破坏性操作：--clean 会先删掉同名对象再重建。
# 恢复前建议先跑一次 backup.sh，把当前状态留个副本。
set -euo pipefail

FILE="${1:-}"
CONFIRM="${2:-}"

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "用法: $0 <备份文件.dump> [--yes]" >&2
  exit 1
fi

CONTAINER="${PG_CONTAINER:-p2-siteyeb-postgres-1}"
DB_USER="${POSTGRES_USER:-p2user}"
DB_NAME="${POSTGRES_DB:-p2learning}"

if ! head -c 5 "$FILE" | grep -q "PGDMP"; then
  echo "[restore] $FILE 不是 pg_dump 自定义格式，拒绝执行" >&2
  exit 2
fi

if [ "$CONFIRM" != "--yes" ]; then
  echo "即将用 $FILE 覆盖数据库 ${DB_NAME}。"
  echo "现有数据会先被删除（--clean），这是不可逆操作。"
  read -r -p "确认请输入 yes: " answer
  [ "$answer" = "yes" ] || { echo "已取消"; exit 1; }
fi

echo "[restore] 备份当前状态作为回滚点..."
"$(dirname "${BASH_SOURCE[0]}")/backup.sh" || {
  echo "[restore] 回滚点创建失败，中止" >&2
  exit 3
}

echo "[restore] 上传备份到容器"
docker cp "$FILE" "${CONTAINER}:/tmp/p2m-restore.dump"

echo "[restore] 执行 pg_restore"
# 先断开其它连接，否则 --clean 的 DROP 会被会话锁住
docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" \
  > /dev/null

set +e
docker exec "$CONTAINER" pg_restore -U "$DB_USER" -d "$DB_NAME" \
  --clean --if-exists --no-owner --single-transaction /tmp/p2m-restore.dump
CODE=$?
set -e

docker exec "$CONTAINER" rm -f /tmp/p2m-restore.dump

if [ $CODE -ne 0 ]; then
  echo "[restore] pg_restore 返回 $CODE（部分警告是正常的，例如已存在的扩展）" >&2
  echo "[restore] 请检查后端 /health 与关键表行数后再决定是否重试" >&2
  exit 4
fi

echo "[restore] 完成。建议重启后端：docker compose restart backend"
