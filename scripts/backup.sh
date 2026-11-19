#!/usr/bin/env bash
# 数据库备份
#
# 用法：
#   ./scripts/backup.sh                 # 备份到 backups/
#   KEEP_DAYS=30 ./scripts/backup.sh    # 保留 30 天
#
# 为什么用 pg_dump -Fc 而不是直接拷数据卷：
# 数据卷是运行中的文件，热拷可能拿到不一致的页；自定义格式还能选择性恢复
# 单张表，体积也小。
#
# 定时任务（Linux）：
#   0 3 * * * cd /path/to/project && ./scripts/backup.sh >> backups/backup.log 2>&1
set -euo pipefail

CONTAINER="${PG_CONTAINER:-p2-siteyeb-postgres-1}"
DB_USER="${POSTGRES_USER:-p2user}"
DB_NAME="${POSTGRES_DB:-p2learning}"
KEEP_DAYS="${KEEP_DAYS:-7}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${BACKUP_DIR:-${ROOT}/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="${OUT_DIR}/p2learning-${STAMP}.dump"

mkdir -p "$OUT_DIR"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "[backup] 容器 $CONTAINER 未运行，放弃备份" >&2
  exit 1
fi

echo "[backup] 开始 $STAMP"
# 先 dump 到容器内再 copy 出来：Windows 下 shell 重定向可能改写二进制流
docker exec "$CONTAINER" sh -c "pg_dump -U ${DB_USER} -d ${DB_NAME} -Fc -f /tmp/p2m-backup.dump"
docker cp "${CONTAINER}:/tmp/p2m-backup.dump" "$FILE"
docker exec "$CONTAINER" rm -f /tmp/p2m-backup.dump

SIZE="$(du -h "$FILE" | cut -f1)"
echo "[backup] 完成：$FILE ($SIZE)"

# 清理过期备份
DELETED="$(find "$OUT_DIR" -maxdepth 1 -name 'p2learning-*.dump' -mtime "+${KEEP_DAYS}" -print -delete | wc -l | tr -d ' ')"
echo "[backup] 清理 ${DELETED} 个超过 ${KEEP_DAYS} 天的旧备份"

# 顺手做一次真空检查：dump 文件头必须是 pg 自定义格式
if head -c 5 "$FILE" | grep -q "PGDMP"; then
  echo "[backup] 文件头校验通过"
else
  echo "[backup] 警告：文件头不是 PGDMP，备份可能损坏" >&2
  exit 2
fi
