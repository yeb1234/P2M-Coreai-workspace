#!/usr/bin/env bash
# 演示环境一键自查，输出 Markdown 报告
#
# 用法：
#   bash scripts/self-check-demo.sh                          # 检查本机
#   bash scripts/self-check-demo.sh https://your-domain      # 检查线上
#   bash scripts/self-check-demo.sh http://localhost out.md  # 指定报告路径
#
# 用途：面试前跑一遍，确认「打开就有内容、问一句能答、搜索能搜到」。
# 输出是 Markdown，可以直接贴进度汇报或面试材料里。

set -uo pipefail

BASE="${1:-http://localhost}"
REPORT="${2:-demo-selfcheck.md}"
DEMO_USER="${DEMO_USER:-demo}"
DEMO_PASS="${DEMO_PASS:-Demo2026}"

PASS=0
FAIL=0
WARN=0
LINES=()

pass() { PASS=$((PASS+1)); LINES+=("| ✅ | $1 | $2 |"); }
fail() { FAIL=$((FAIL+1)); LINES+=("| ❌ | $1 | $2 |"); }
warn() { WARN=$((WARN+1)); LINES+=("| ⚠️ | $1 | $2 |"); }

json() { python -c "import sys,json;d=json.load(sys.stdin);$1" 2>/dev/null; }
code() { curl -s -o /dev/null -w '%{http_code}' -m 20 "$@" 2>/dev/null; }

echo "检查 $BASE ..."

# ── 1. 服务可用性 ──────────────────────────────────────────
for path in / /health; do
  c=$(code "$BASE$path")
  [ "$c" = "200" ] && pass "服务 $path" "HTTP 200" || fail "服务 $path" "HTTP $c"
done

# ── 2. 登录 ────────────────────────────────────────────────
LOGIN=$(curl -s -m 25 -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$DEMO_USER\",\"password\":\"$DEMO_PASS\"}" 2>/dev/null)
TOKEN=$(echo "$LOGIN" | json "print(d.get('access_token',''))")
ROLE=$(echo "$LOGIN" | json "print(d.get('user',{}).get('role',''))")

if [ -n "$TOKEN" ]; then
  pass "演示账号登录" "角色 $ROLE"
else
  fail "演示账号登录" "拿不到令牌，检查 $DEMO_USER 账号是否存在"
  echo "登录失败，后续检查跳过"
  TOKEN=""
fi

AUTH=(-H "Authorization: Bearer $TOKEN")

# ── 3. 画像有内容 ──────────────────────────────────────────
if [ -n "$TOKEN" ]; then
  # 注意：profile 接口返回的是扁平结构，没有 {profile: {...}} 外层
  P=$(curl -s -m 20 "$BASE/api/learning/profile" "${AUTH[@]}" 2>/dev/null)
  read -r MINS VIDS DAYS <<<"$(echo "$P" | python -c "
import sys, json
d = json.load(sys.stdin)
p = d.get('profile') or d
print(p.get('total_watch_minutes', 0), p.get('videos_started', 0), p.get('streak_days', 0))
" 2>/dev/null || echo "0 0 0")"
  if [ "${MINS:-0}" -gt 100 ]; then
    pass "学习画像" "累计 ${MINS} 分钟 / ${VIDS} 个视频 / 连续 ${DAYS} 天"
  else
    fail "学习画像" "只有 ${MINS} 分钟，演示时会显示空白画像"
  fi
fi

# ── 4. 学习路径存在 ────────────────────────────────────────
if [ -n "$TOKEN" ]; then
  AP=$(curl -s -m 20 "$BASE/api/learning/paths/active" "${AUTH[@]}" 2>/dev/null)
  PTITLE=$(echo "$AP" | python -c "
import sys, json
d = json.load(sys.stdin)
p = d.get('path') or {}
print(p.get('title', ''))
" 2>/dev/null)
  PSTEP=$(echo "$AP" | python -c "
import sys, json
d = json.load(sys.stdin)
p = d.get('path') or {}
g = p.get('progress') or {}
print(str(g.get('done', 0)) + '/' + str(g.get('total', 0)))
" 2>/dev/null)
  if [ -n "$PTITLE" ]; then
    pass "学习路径" "「${PTITLE:0:24}」进度 $PSTEP"
  else
    fail "学习路径" "没有活动路径，Agent 回答「下一步」会退化成泛泛推荐"
  fi
fi

# ── 5. 检索：正常查询要命中 ────────────────────────────────
search_case() {
  local query="$1" expect="$2" label="$3"
  local raw
  raw=$(curl -s -m 90 -G "$BASE/api/search/hybrid" \
    --data-urlencode "q=$query" --data-urlencode "top_k=3" --data-urlencode "rerank=true" 2>/dev/null)
  local n title first_len
  n=$(echo "$raw" | json "print(len(d.get('hits',[])))")
  title=$(echo "$raw" | json "h=d.get('hits',[]);print((h[0].get('video_title') or '') if h else '')")
  first_len=$(echo "$raw" | json "h=d.get('hits',[]);print(len(h[0].get('text','')) if h else 0)")

  case "$expect" in
    hit)
      if [ "${n:-0}" -ge 1 ] && [ "${first_len:-0}" -ge 100 ]; then
        pass "检索「$query」" "命中 ${n} 条，首条 ${first_len} 字《${title:0:18}》"
      else
        fail "检索「$query」" "命中 ${n} 条，首条 ${first_len} 字（应 ≥100 字）"
      fi
      ;;
    empty)
      if [ "${n:-1}" -eq 0 ]; then
        pass "检索「$query」" "正确返回空（无关内容不硬凑）"
      else
        warn "检索「$query」" "返回 ${n} 条无关内容（rerank 负判断偶发失效，重试通常可恢复）"
      fi
      ;;
  esac
}

if [ -n "$TOKEN" ]; then
  search_case "闭包是什么" hit "概念查询"
  search_case "useEffect 的依赖数组" hit "英文术语"
  search_case "红烧肉怎么做" empty "应无结果"
fi

# ── 6. 管理端（demo 是管理员才通）─────────────────────────
if [ -n "$TOKEN" ]; then
  if [ "$ROLE" = "admin" ]; then
    c=$(code "$BASE/api/admin/users" "${AUTH[@]}")
    n=$(curl -s -m 20 "$BASE/api/admin/users" "${AUTH[@]}" 2>/dev/null | json "print(len(d) if isinstance(d,list) else 0)")
    [ "$c" = "200" ] && pass "用户管理" "$c，$n 个账号" || fail "用户管理" "HTTP $c"
  else
    warn "用户管理" "当前账号不是管理员，界面上不会出现该入口"
  fi
fi

# ── 7. 鉴权边界（不能为了演示把门开着）───────────────────
c=$(code "$BASE/api/learning/profile")
[ "$c" = "401" ] && pass "未登录拦截" "401" || fail "未登录拦截" "HTTP $c，接口没有鉴权"

c=$(code "$BASE/api/docs")
[ "$c" = "404" ] && pass "接口文档关闭" "404" || warn "接口文档关闭" "HTTP $c"

# ── 输出报告 ───────────────────────────────────────────────
{
  echo "# 演示环境自查报告"
  echo
  echo "- 目标：\`$BASE\`"
  echo "- 时间：$(date '+%Y-%m-%d %H:%M:%S')"
  echo "- 账号：\`$DEMO_USER\`"
  echo
  echo "| 结果 | 检查项 | 详情 |"
  echo "|:--:|---|---|"
  for line in "${LINES[@]}"; do echo "$line"; done
  echo
  echo "**通过 $PASS / 警告 $WARN / 失败 $FAIL**"
} | tee "$REPORT"

echo
echo "报告已写入 $REPORT"
[ "$FAIL" -eq 0 ] || exit 1
