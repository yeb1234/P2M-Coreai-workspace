#!/usr/bin/env bash
# 下载 faster-whisper 模型（走 ModelScope 国内镜像）
#
# 为什么不用 HuggingFace 官方源
# ----------------------------
# hf-mirror.com 对这个仓库的大文件会 302 重定向到 cas-bridge.xethub.hf.co，
# 那个域名国内不可达 —— 表现为「json 配置下下来了，model.bin 下不来」，
# 而且 huggingface_hub 会静默失败，只留一个 .locks 目录，很难查。
#
# ModelScope 上有同步的镜像，实测 9+ MB/s，3GB 约 5 分钟。
#
# 用法：
#   bash scripts/fetch-whisper-model.sh                 # 下载 large-v3（默认）
#   bash scripts/fetch-whisper-model.sh medium          # 下载 medium
#   REPO_NS=gpustack bash scripts/fetch-whisper-model.sh # 换镜像源

set -euo pipefail

MODEL="${1:-large-v3}"
REPO_NS="${REPO_NS:-pengzhendong}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${ROOT}/data/hf/faster-whisper-${MODEL}"
BASE="https://modelscope.cn/api/v1/models/${REPO_NS}/faster-whisper-${MODEL}/repo"

echo "模型: faster-whisper-${MODEL}"
echo "来源: ${REPO_NS} @ ModelScope"
echo "目录: ${DEST}"
echo

mkdir -p "$DEST"

# 小文件先下，失败能立刻发现
for f in config.json tokenizer.json vocabulary.json preprocessor_config.json; do
  printf "  %-28s " "$f"
  if curl -sfL -m 120 -o "${DEST}/${f}" "${BASE}?Revision=master&FilePath=${f}"; then
    echo "OK ($(du -h "${DEST}/${f}" | cut -f1))"
  else
    echo "失败"
    exit 1
  fi
done

# 大文件支持断点续传，中断了重跑这个脚本即可
BIN="${DEST}/model.bin"
if [ -f "$BIN" ] && [ "$(stat -c%s "$BIN" 2>/dev/null || echo 0)" -gt 1000000 ]; then
  echo "  model.bin 已存在（$(du -h "$BIN" | cut -f1)），尝试续传"
fi

echo "  model.bin 下载中（3GB，支持断点续传）..."
curl -L -C - --retry 3 --retry-delay 3 -# \
  -o "$BIN" "${BASE}?Revision=master&FilePath=model.bin"

SIZE=$(stat -c%s "$BIN" 2>/dev/null || stat -f%z "$BIN" 2>/dev/null || echo 0)
if [ "$SIZE" -lt 2000000000 ]; then
  echo "下载不完整（${SIZE} 字节），重跑本脚本可续传" >&2
  exit 2
fi

echo
echo "完成：$(du -sh "$DEST" | cut -f1)"
echo
echo "接下来在 .env 里指向本地目录（避免走不通的 HF 下载）："
echo "  DEFAULT_WHISPER_MODEL=/data/hf/faster-whisper-${MODEL}"
echo "  DEVICE_TYPE=cuda"
echo "  WHISPER_COMPUTE_TYPE=float16"
