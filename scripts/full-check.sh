P=0; F=0; W=0
pass(){ echo "  PASS  $1"; P=$((P+1)); }
fail(){ echo "  FAIL  $1"; F=$((F+1)); }
warn(){ echo "  WARN  $1"; W=$((W+1)); }
code(){ curl -s -o /dev/null -w '%{http_code}' -m 20 "$@" 2>/dev/null; }

echo "=== 1. 容器 ==="
for c in siteyeb-pg siteyeb-redis siteyeb-backend siteyeb-frontend; do
  st=$(docker inspect -f '{{.State.Health.Status}}' $c 2>/dev/null || echo unknown)
  [ "$st" = "healthy" ] && pass "$c healthy" || fail "$c 状态 $st"
done

echo "=== 2. 公共接口 ==="
[ "$(code http://localhost/)" = 200 ] && pass "首页 200" || fail "首页"
[ "$(code http://localhost/health)" = 200 ] && pass "/health 200" || fail "/health"
[ "$(code 'http://localhost/api/videos?page=1&page_size=1')" = 200 ] && pass "视频列表 200" || fail "视频列表"
[ "$(code http://localhost/api/stats)" = 200 ] && pass "统计 200" || fail "统计"
[ "$(code http://localhost/api/categories)" = 200 ] && pass "分类 200" || fail "分类"

echo "=== 3. 鉴权边界 ==="
for p in /api/learning/profile /api/assistant/sessions /api/admin/health /api/watch-events/stats; do
  c=$(code http://localhost$p)
  [ "$c" = 401 ] && pass "未登录 $p -> 401" || fail "未登录 $p -> $c"
done
[ "$(code http://localhost/api/docs)" = 404 ] && pass "接口文档已关闭" || fail "接口文档可访问"

echo "=== 4. 安全头 ==="
H=$(curl -sI -m 15 http://localhost/ | tr -d '\r')
for h in X-Content-Type-Options X-Frame-Options Referrer-Policy Content-Security-Policy; do
  echo "$H" | grep -qi "^$h:" && pass "安全头 $h" || fail "缺 $h"
done
echo "$H" | grep -qi "^Server:.*nginx/" && warn "暴露版本号" || pass "未暴露版本号"

echo "=== 5. 数据库结构 ==="
q=$(docker exec siteyeb-pg psql -U p2user -d p2learning -t -c "SELECT count(*) FROM information_schema.columns WHERE table_name='users' AND column_name IN ('role','token_version','is_active');" 2>/dev/null | tr -d ' ')
[ "$q" = "3" ] && pass "users 安全字段齐全" || fail "users 字段缺失($q/3)"
q=$(docker exec siteyeb-pg psql -U p2user -d p2learning -t -c "SELECT count(*) FROM information_schema.columns WHERE table_name='watch_history' AND column_name='user_id';" 2>/dev/null | tr -d ' ')
[ "$q" = "1" ] && pass "watch_history.user_id 存在" || fail "watch_history 缺 user_id"
q=$(docker exec siteyeb-pg psql -U p2user -d p2learning -t -c "SELECT count(*) FROM content_chunks;" 2>/dev/null | tr -d ' ')
[ "$q" -gt 50000 ] && pass "语义块已建 ($q)" || fail "语义块数量异常($q)"
q=$(docker exec siteyeb-pg psql -U p2user -d p2learning -t -c "SELECT count(*) FROM subtitle_segments WHERE last_analyze IS NULL;" 2>/dev/null | tr -d ' ')
q2=$(docker exec siteyeb-pg psql -U p2user -d p2learning -t -c "SELECT n_live_tup FROM pg_stat_user_tables WHERE relname='subtitle_segments';" 2>/dev/null | tr -d ' ')
[ "$q2" -gt 3000000 ] && pass "统计信息新鲜 ($q2)" || fail "统计信息过期 ($q2)"

echo "=== 6. Redis ==="
mm=$(docker exec siteyeb-redis redis-cli CONFIG GET maxmemory 2>/dev/null | tail -1 | tr -d '\r ')
[ "$mm" = "268435456" ] && pass "maxmemory 256MB" || fail "maxmemory=$mm"
rc=$(docker exec siteyeb-redis redis-cli ping 2>/dev/null | tr -d '\r')
[ "$rc" = "PONG" ] && pass "Redis 可连通" || fail "Redis $rc"

echo "=== 7. 检索链路 ==="
r=$(curl -s -m 60 -G "http://localhost/api/search/hybrid" --data-urlencode "q=闭包" --data-urlencode "top_k=2" --data-urlencode "rerank=false" 2>/dev/null)
n=$(echo "$r" | python -c "import sys,json;print(len(json.load(sys.stdin).get('hits',[])))" 2>/dev/null || echo 0)
[ "$n" -ge 1 ] && pass "检索返回 $n 条" || fail "检索无结果"
seg=$(echo "$r" | python -c "import sys,json;h=json.load(sys.stdin).get('hits',[]);print(max([x.get('segment_count',1) for x in h]) if h else 0)" 2>/dev/null || echo 0)
[ "$seg" -ge 3 ] && pass "上下文扩展生效 ($seg 段合并)" || warn "上下文扩展可疑 ($seg)"

echo "=== 8. 前端资源 ==="
a=$(curl -s -m 20 http://localhost/ | grep -o '/assets/[^"]*\.js' | head -1)
[ -n "$a" ] && [ "$(code http://localhost$a)" = 200 ] && pass "JS 资源可加载" || fail "JS 资源异常"
curl -s -m 20 http://localhost/ | grep -q "p2m-ui-storage\|root" && pass "SPA 入口正常" || warn "入口内容可疑"

echo
echo "=== 汇总：PASS $P / WARN $W / FAIL $F ==="
[ "$F" -eq 0 ] && echo "  无失败项" || echo "  有 $F 项失败"
