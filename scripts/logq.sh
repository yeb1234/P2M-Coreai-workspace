#!/usr/bin/env bash
# 日志查询的薄封装：帮你找到 node，然后把参数原样传过去。
#
#   bash scripts/logq.sh errors --since 1h
#   bash scripts/logq.sh req 8f3a2c1d
#   bash scripts/logq.sh stats --since 24h
#   bash scripts/logq.sh files
#
# 详细用法见 scripts/logq.mjs 顶部注释。

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

if command -v node >/dev/null 2>&1; then
    exec node scripts/logq.mjs "$@"
fi

echo "找不到 node。前端构建也需要它，先确认 node 是否在 PATH 里。" >&2
echo "  临时办法：用 grep 直接查 JSONL，例如：" >&2
echo "  grep '\"level\":\"ERROR\"' logs/backend.jsonl | tail -20" >&2
exit 127
