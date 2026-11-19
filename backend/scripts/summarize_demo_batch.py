"""demo 视频批处理：LLM 总结。

接在 transcribe_demo_batch.py 后面跑，只处理 demo 清单里那 50 个。

注意显存：qwen3-4b 要 2.5GB。跑这个之前确认 whisper 的进程已经退出
（容器里的模型随脚本进程释放，脚本结束就空了），否则 8GB 会不够。

注意 Qwen3 的思考开销：它是 thinking 模型，每次请求先吐 340~420 字 reasoning。
LM Studio 不支持关闭（thinking / enable_thinking / chat_template_kwargs 三种都试过无效），
所以 token 预算必须留够，否则 content 会是空字符串。

用法：
    python scripts/summarize_demo_batch.py --limit 2
    python scripts/summarize_demo_batch.py
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import SessionLocal, settings  # noqa: E402
from app.models import Video  # noqa: E402
from app.services.ollama_summarize import summarize_with_openai  # noqa: E402

WORD_LIMIT = 400


def main() -> int:
    ap = argparse.ArgumentParser(description="demo 视频批量总结")
    ap.add_argument("--manifest", default="/app/demo/manifest.json")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    candidates = [
        Path(args.manifest),
        Path(__file__).resolve().parents[2] / "demo" / "manifest.json",
    ]
    manifest_path = next((p for p in candidates if p.is_file()), None)
    if not manifest_path:
        print("找不到 demo/manifest.json")
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    metas = manifest["videos"]
    if args.limit:
        metas = metas[: args.limit]

    base_url = settings.openai_base_url
    model = settings.openai_model
    print(f"清单 {len(metas)} 个")
    print(f"LLM {model} @ {base_url}")
    print()

    db = SessionLocal()
    done = 0
    skipped = 0
    failed: list[str] = []
    started = time.perf_counter()

    try:
        for i, meta in enumerate(metas, 1):
            video = db.get(Video, meta["video_id"])
            if not video or not video.transcription:
                skipped += 1
                continue
            if video.summary:
                skipped += 1
                continue

            label = (video.title or "")[:34]
            print(f"[{i}/{len(metas)}] {label}", flush=True)

            if args.dry_run:
                print(f"    {len(video.transcription)} 字待总结", flush=True)
                continue

            t0 = time.perf_counter()
            try:
                summary = summarize_with_openai(
                    video.transcription,
                    word_limit=WORD_LIMIT,
                    model=model,
                    base_url=base_url,
                )
            except Exception as exc:
                print(f"    失败: {type(exc).__name__}: {str(exc)[:120]}", flush=True)
                failed.append(f"{video.id} {label}")
                continue

            if not summary or not summary.strip():
                # 空结果多半是 token 预算被思考过程吃光了
                print("    空结果（可能 token 预算不足），跳过", flush=True)
                failed.append(f"{video.id} 空总结")
                continue

            video.summary = summary
            db.commit()
            done += 1
            print(f"    {len(summary)} 字 / {time.perf_counter()-t0:.1f}s", flush=True)

        elapsed = time.perf_counter() - started
        print()
        print(f"完成 {done} 个，跳过 {skipped} 个，失败 {len(failed)} 个，用时 {elapsed/60:.1f} 分钟")
        if failed:
            for line in failed[:8]:
                print("  - " + line)
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
