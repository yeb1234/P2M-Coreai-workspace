#!/usr/bin/env bash
# 检索质量评估 v2：覆盖新旧内容 + 记录 rerank 分数与来源
#
# 用法：
#   bash scripts/eval-retrieval-v2.sh                    # 默认输出到终端
#   bash scripts/eval-retrieval-v2.sh report.md          # 写入文件
#
# 与 v1 的区别：
# - 加入 demo 新增视频的主题查询（MCP / Agent 跳转 / Playwright），验证增量内容能被搜到
# - 记录 rerank_score，cross-encoder 的分数可以判断「这条到底相不相关」
# - 统计来源分布（词法 / 向量 / 两者都有）

set -uo pipefail
BASE="${1:-http://localhost}"
OUT="${2:-}"
: > /tmp/eval-v2-raw.txt

QUERIES=(
  # --- 原有内容（应有结果）---
  "闭包是什么|概念"
  "useEffect 的依赖数组|英文术语"
  "FastAPI 依赖注入怎么实现|术语+概念"
  "RAG 召回和重排哪个更影响效果|意图"
  "Python 列表推导式|基础"
  # --- demo 新增内容（验证增量）---
  "Agent 怎么跳转网页|新增-1_agent"
  "MCP 工具怎么注册和调用|新增-1_agent"
  "Playwright 和 BrowserUse 有什么区别|新增-1_agent"
  "向量检索的相似度怎么算|新增-2_rag"
  # --- 负例 ---
  "红烧肉怎么做|应无结果"
  "今天天气怎么样|应无结果"
)

emit() { echo "$1" | tee -a /tmp/eval-v2-raw.txt; }

emit "# 检索评估 v2"
emit ""
emit "| 查询 | 类型 | 命中 | 首条 rerank 分 | 来源 | 首条内容 |"
emit "|---|---|---|---|---|---|"

ok=0; total=0
for item in "${QUERIES[@]}"; do
  q="${item%%|*}"; tag="${item##*|}"
  total=$((total+1))
  resp=$(curl -s -m 90 -G "$BASE/api/search/hybrid" \
    --data-urlencode "q=$q" --data-urlencode "top_k=3" --data-urlencode "rerank=true" 2>/dev/null)
  line=$(echo "$resp" | python -c "
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print('0|ERR|ERR|解析失败'); raise SystemExit
h = d.get('hits', [])
if not h:
    print('0|—|—|（无结果）'); raise SystemExit
top = h[0]
score = top.get('rerank_score')
score_s = f'{score:.4f}' if isinstance(score, (int, float)) else '—'
src = '+'.join(top.get('sources') or [])
text = (top.get('text') or '').replace('\n', '').replace('|', '/')[:34]
print(f'{len(h)}|{score_s}|{src}|{text}')
" 2>/dev/null || echo "0|ERR|ERR|调用失败")
  hits=$(echo "$line" | cut -d'|' -f1)
  score=$(echo "$line" | cut -d'|' -f2)
  src=$(echo "$line" | cut -d'|' -f3)
  text=$(echo "$line" | cut -d'|' -f4)

  emit "| $q | $tag | $hits | $score | $src | $text |"
  case "$tag" in
    应无结果) [ "$hits" = "0" ] && ok=$((ok+1)) ;;
    *) [ "$hits" != "0" ] && [ "$hits" != "ERR" ] && ok=$((ok+1)) ;;
  esac
done

emit ""
emit "**有结果 $ok / $total**"
emit ""
emit "> rerank 分是 cross-encoder 的相关性，不是余弦相似度。"
emit "> 实测相关内容 0.9+、无关内容 0.0001 量级，可以直接当阈值看。"

if [ -n "$OUT" ]; then
  cp /tmp/eval-v2-raw.txt "$OUT"
  echo "已写入 $OUT"
fi
