"""demo 视频批处理：转写 → 落库。

只处理 demo/manifest.json 里那 50 个，全部用 large-v3 + CUDA。

为什么单独写而不是走 ai_jobs 队列
--------------------------------
队列是给「用户在界面上点单个视频」设计的，带 job 状态机、进度推送、取消信号。
批量跑 50 个不需要这些，反而要处理 job 冲突。这里直接调服务层，配断点续传。

断点续传
--------
按 `videos.transcription IS NULL` 判断，中断了重跑会跳过已完成的。
字幕片段由 replace_subtitle_segments 整段替换，幂等。

用法：
    python scripts/transcribe_demo_batch.py --dry-run
    python scripts/transcribe_demo_batch.py
    python scripts/transcribe_demo_batch.py --limit 3    # 先跑 3 个验证
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from app.database import SessionLocal, settings  # noqa: E402
from app.models import Video  # noqa: E402
from app.services.ai_jobs import replace_subtitle_segments  # noqa: E402
from app.services.transcribe_whisper import transcribe_wav  # noqa: E402


def to_container_path(raw: str) -> str:
    """把 Windows 路径转成容器内路径。

    videos.filepath 里两种格式混存：
      /videos/xxx.mp4      -> 入库时容器扫描的，直接可用
      D:////ITJC////xxx.mp4   -> 早期入库或手工导入的，Linux 下会被当成 URL scheme "D"，
                              报 ProtocolNotFoundError
    实测 50 个 demo 里有 16 个踩到这个。
    """
    for prefix in ("D:\\ITJC\\", "D:/ITJC/"):
        if raw.startswith(prefix):
            rest = raw[len(prefix):].replace("\\", "/")
            return "/videos/" + rest
    return raw


def main() -> int:
    ap = argparse.ArgumentParser(description="demo 视频批量转写")
    ap.add_argument("--manifest", default="/app/demo/manifest.json")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    # 容器内跑时 manifest 通过挂载访问；宿主机跑时用项目内路径
    candidates = [
        Path(args.manifest),
        Path(__file__).resolve().parents[2] / "demo" / "manifest.json",
    ]
    manifest_path = next((p for p in candidates if p.is_file()), None)
    if not manifest_path:
        print("找不到 demo/manifest.json，先跑 build_demo_library.py")
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    videos_meta = manifest["videos"]
    if args.limit:
        videos_meta = videos_meta[: args.limit]

    print(f"清单 {len(videos_meta)} 个视频")
    print(f"模型 {settings.default_whisper_model} / device={settings.device_type} / compute={settings.whisper_compute_type}")
    print()

    db = SessionLocal()
    done = 0
    skipped = 0
    failed: list[str] = []
    total_audio = 0.0
    started_all = time.perf_counter()

    try:
        for i, meta in enumerate(videos_meta, 1):
            video = db.get(Video, meta["video_id"])
            if not video:
                failed.append(f"{meta['video_id']} 库里不存在")
                continue
            if video.transcription:
                skipped += 1
                continue

            label = (video.title or "")[:34]
            print(f"[{i}/{len(videos_meta)}] {label}", flush=True)

            if args.dry_run:
                print(f"    {meta['duration']}s  {video.filepath}", flush=True)
                continue

            t0 = time.perf_counter()
            try:
                result = transcribe_wav(
                    Path(to_container_path(video.filepath)),
                    engine="faster-whisper",
                    model_size=settings.default_whisper_model,
                    language="zh",
                )
                # transcribe_wav 返回 {"text": ..., "segments": [{start,end,text}]}
                segments = result.get("segments") or []
                full_text = result.get("text") or ""
            except Exception as exc:
                print(f"    转写失败: {type(exc).__name__}: {str(exc)[:120]}", flush=True)
                failed.append(f"{video.id} {label}")
                continue

            if not segments:
                print("    没有识别出内容，跳过", flush=True)
                failed.append(f"{video.id} 空结果")
                continue

            replace_subtitle_segments(db, video, segments)
            video.transcription = full_text
            db.commit()

            cost = time.perf_counter() - t0
            dur = float(video.duration or 0)
            total_audio += dur
            done += 1
            speed = dur / cost if cost else 0
            print(
                f"    {len(segments)} 段 / {len(video.transcription)} 字 / "
                f"{cost:.1f}s ({speed:.1f}x)",
                flush=True,
            )

        elapsed = time.perf_counter() - started_all
        print()
        print(f"完成 {done} 个，跳过 {skipped} 个（已有字幕），失败 {len(failed)} 个")
        if total_audio:
            print(f"音频 {total_audio/60:.0f} 分钟，总耗时 {elapsed/60:.1f} 分钟，"
                  f"整体 {total_audio/elapsed:.1f}x 实时")
        if failed:
            print("失败清单：")
            for line in failed[:8]:
                print("  - " + line)
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
