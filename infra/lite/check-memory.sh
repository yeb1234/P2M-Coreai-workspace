#!/usr/bin/env bash
# P2 7.2 Lite 内存验收：打印容器 RSS、上限和合计。
#
# 用法（仓库根目录）：
#   bash infra/lite/check-memory.sh            # 单次
#   bash infra/lite/check-memory.sh --watch 5  # 每 5 秒刷新，Ctrl-C 结束
#   bash infra/lite/check-memory.sh --json     # 给自动化留口
#
# 口径：MemUsage 的第一段是容器 RSS（含 page cache），不是宿主进程 RSS；
# 对 demo 验收足够，能看出是否接近 mem_limit。PG 的 shared_buffers 包含在内。

set -Eeuo pipefail

CONTAINERS=(
  "p2lite-backend-1"
  "p2lite-frontend-1"
  "shared-postgres"
  "shared-redis"
)
WATCH=0
JSON=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --watch)
      WATCH="${2:-5}"
      shift 2
      ;;
    --json)
      JSON=1
      shift
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

to_mib() {
  # "123.4MiB" / "1.2GiB" / "0B" -> MiB
  awk '
    {
      v=$1
      unit=v
      sub(/[0-9.]+/, "", unit)
      n=v
      sub(/[A-Za-z]+/, "", n)
      if (unit == "GiB") n*=1024
      else if (unit == "KiB") n/=1024
      else if (unit == "B") n/=1024/1024
      printf "%.1f", n
    }
  ' <<<"$1"
}

collect() {
  local rows total=0
  rows="$(
    docker stats --no-stream --format \
      '{{.Name}}|{{.MemUsage}}|{{.MemPerc}}|{{.CPUPerc}}' "${CONTAINERS[@]}" 2>/dev/null || true
  )"
  if [[ -z "$rows" ]]; then
    echo "没有找到 Lite/共享库容器。先确认 compose 已启动。" >&2
    return 1
  fi

  if [[ "$JSON" -eq 1 ]]; then
    printf '['
    local first=1
    while IFS='|' read -r name usage pct cpu; do
      [[ -z "$name" ]] && continue
      local used="${usage%% / *}"
      local limit="${usage##* / }"
      local used_mib
      used_mib="$(to_mib "$used")"
      total="$(awk -v a="$total" -v b="$used_mib" 'BEGIN{printf "%.1f", a+b}')"
      [[ "$first" -eq 0 ]] && printf ','
      first=0
      printf '{"name":"%s","used_mib":%s,"limit":"%s","mem_pct":"%s","cpu_pct":"%s"}' \
        "$name" "$used_mib" "$limit" "$pct" "$cpu"
    done <<<"$rows"
    printf ',"total_mib":%s}\n' "$total"
    return 0
  fi

  printf '%-24s %14s %10s %10s %10s\n' "CONTAINER" "MEM USAGE" "LIMIT" "MEM%" "CPU%"
  printf '%-24s %14s %10s %10s %10s\n' "------------------------" "--------------" "----------" "----------" "----------"
  while IFS='|' read -r name usage pct cpu; do
    [[ -z "$name" ]] && continue
    local used="${usage%% / *}"
    local limit="${usage##* / }"
    local used_mib
    used_mib="$(to_mib "$used")"
    total="$(awk -v a="$total" -v b="$used_mib" 'BEGIN{printf "%.1f", a+b}')"
    printf '%-24s %14s %10s %10s %10s\n' "$name" "$used" "$limit" "$pct" "$cpu"
  done <<<"$rows"
  echo
  printf '合计（4 个容器）：%.1f MiB\n' "$total"
  echo "P2 Lite 应用两容器 = backend + frontend；共享 PG/Redis 另算。"
}

if [[ "$WATCH" -gt 0 ]]; then
  while true; do
    date '+%F %T'
    collect || exit 1
    echo
    sleep "$WATCH"
  done
else
  collect
fi
