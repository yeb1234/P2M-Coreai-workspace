#!/usr/bin/env bash
# 检索质量评估：跑固定查询集，输出 top3 便于人工判断
# 用法：bash scripts/eval-retrieval.sh [输出文件]
OUT="${1:-/tmp/retrieval-eval.txt}"
: > "$OUT"

QUERIES=(
  "闭包是什么|概念"
  "useEffect 的依赖数组|术语"
  "FastAPI 依赖注入怎么实现|术语+概念"
  "函数返回另一个函数有什么用|跨表述"
  "RAG 召回和重排哪个更影响效果|意图"
  "Python 列表推导式|基础"
  "向量数据库怎么选型|概念"
  "红烧肉怎么做|应无结果"
)

for item in "${QUERIES[@]}"; do
  q="${item%%|*}"; tag="${item##*|}"
  echo "### [$tag] $q" | tee -a "$OUT"
  curl -s -m 90 -G "http://localhost/api/search/hybrid" \
    --data-urlencode "q=$q" --data-urlencode "top_k=3" --data-urlencode "rerank=true" \
  | python -c "
import sys, json
d = json.load(sys.stdin)
hits = d.get('hits', [])
if not hits: print('  (无结果)')
for i, h in enumerate(hits[:3], 1):
    t = (h.get('text') or '').replace('\n',' ')
    print(f'  {i}. {len(t):4d}字 [{(h.get(\"video_title\") or \"\")[:24]}] {t[:64]}')
" | tee -a "$OUT"
  echo "" | tee -a "$OUT"
done
echo "已写入 $OUT"
