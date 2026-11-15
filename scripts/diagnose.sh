#!/usr/bin/env bash
# 站点异常时的第一条命令。
#
#   bash scripts/diagnose.sh
#
# 纯只读：不重启、不删、不改任何状态。
#
# 为什么需要它：2026-11-16 遇到过整站 502，而 /health 自己也是 502 ——
# 应用层的探针在最需要它的时候是死的。真正能定位的是
# 「容器状态 + 探针最后输出 + PG 锁等待 + Redis worker 注册」这四样，
# 但它们分散在四个地方，出问题时现查很慌。这里一次打出来。

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

# 读取 .env 里的库名/用户（找不到就用默认值）
if [ -f .env ]; then
    # shellcheck disable=SC1091
    PG_USER=$(grep -E '^POSTGRES_USER=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
    PG_DB=$(grep -E '^POSTGRES_DB=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
fi
PG_USER="${PG_USER:-p2user}"
PG_DB="${PG_DB:-p2learning}"

BE=siteyeb-backend
PG=siteyeb-pg
RD=siteyeb-redis
WK=siteyeb-worker

hr() { printf '\n\033[1m%s\033[0m\n' "── $1 ──"; }
run() { "$@" 2>&1; }

hr "1. 容器状态"
run docker ps -a --filter "name=siteyeb" --format 'table {{.Names}}\t{{.Status}}'

hr "2. 健康探针的最后输出"
# docker 会把探针输出存下来 —— 这是容器 unhealthy 时唯一还活着的诊断信息。
# /health 的 body 里带 transactions 指标，正常情况下这里就能看到有没有长事务。
for c in $BE; do
    echo "[$c]"
    # 每条探针一行：exit code + 截断的响应体。
    # 后端 unhealthy 时，这里往往就是唯一还活着的诊断信息
    # （应用日志里可能一个字都没有）。
    out=$(docker inspect -f '{{range .State.Health.Log}}  exit={{.ExitCode}} {{printf "%.260s" .Output}}{{"\n"}}{{end}}' "$c" 2>/dev/null)
    if [ -z "$out" ]; then
        echo "  （没有 healthcheck 记录）"
    else
        # 只看最后 3 条，避免刷屏
        echo "$out" | tail -3
    fi
done

hr "3. 数据库：长事务 / 锁等待"
# 这一节是整个脚本的重点。
# 长事务会持有表的 ACCESS SHARE 锁，让 ALTER TABLE / CREATE INDEX 无限排队
# —— 而迁移就卡在 DDL 上，后端会在「初始化 schema」停住，healthcheck 永远失败。
# 这种故障在应用日志里一个字都没有，只能从这里看。
run docker exec "$PG" psql -U "$PG_USER" -d "$PG_DB" -c "
SELECT pid, state, wait_event_type AS wait,
       round(EXTRACT(EPOCH FROM now() - state_change)) AS age_s,
       left(regexp_replace(query, '\s+', ' ', 'g'), 60) AS query
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid()
  AND (state = 'idle in transaction' OR wait_event_type = 'Lock')
ORDER BY age_s DESC NULLS LAST
LIMIT 10;"

echo "  提示：state=idle in transaction 且 age_s > 60，基本就是"
echo "        「把网络请求 / 子进程 / 文件 IO 夹在 SELECT 和 commit 之间」。"
echo "        修代码，不要 kill 会话了事 —— 下一轮还会长出来。"

hr "4. 队列：worker 注册与积压"
regs=$(docker exec "$RD" redis-cli SMEMBERS rq:workers:ai_jobs 2>/dev/null | grep -c . || echo 0)
echo "  worker 注册数: $regs （正常应为 1；0 = 没有 worker 在消费，2+ = 重复 worker）"
run docker exec "$RD" redis-cli SMEMBERS rq:workers:ai_jobs
for q in ai_jobs background; do
    printf '  队列 %-12s 积压: %s\n' "$q" "$(run docker exec "$RD" redis-cli LLEN "rq:queue:$q")"
done

hr "5. 后端最近的错误"
run docker logs --tail 400 "$BE" 2>&1 | grep -iE "error|traceback|exception|失败" | tail -8
if [ -z "$(docker logs --tail 400 "$BE" 2>&1 | grep -iE 'error|traceback|exception|失败')" ]; then
    echo "  （近 400 行没有 error）"
fi

hr "6. worker 最近日志"
run docker logs --tail 15 "$WK"

hr "怎么读这份输出"
cat <<'TIP'
  · 站点 502 且 backend 不是 healthy
      → 看第 3 节。有 idle in transaction + 有查询在等 Lock，
        说明迁移卡在 DDL 上，后端根本没监听端口。
        临时解法：kill 掉持锁会话让迁移过去；
        根治：找那段「事务跨越耗时操作」的代码。

  · backend healthy 但仍 502
      → 看第 1 节 frontend 状态。nginx 对 backend 的解析问题
        （历史坑：upstream 只在启动时解析一次 IP）。

  · 转写一直排队
      → 看第 4 节。worker 注册数 0 = 没有消费者；
        2 个以上 = 内嵌 worker 和独立 worker 撞了
        （AI_WORKER_EMBEDDED 应为 false）。

  · 检索搜不到新视频
      → 第 5 节里找 index 相关错误；再查
        curl localhost/api/admin/embeddings/status
TIP
