"""打包媒体子集，供云端演示部署上传。

为什么需要它
------------
视频库实测 21,136 个文件、**1.57 TB**。家庭宽带上行 30Mbps 传完要 5 天，
云硬盘按 1.5TB 计费也不划算。而演示/面试根本不需要整库。

这个脚本按视频 id 挑一批，把视频、字幕、缩略图、封面拷到一个目录，
并生成 manifest.json 记录原始元数据。云端解包后跑 import_media_manifest.py
把标题、时长、字幕路径、转写文本回填到数据库。

用法
----
    # 挑 50 个有字幕的视频（自动选体积小的，传得快）
    python scripts/pack_media_subset.py --limit 50 --out D:/export/subset

    # 指定 id
    python scripts/pack_media_subset.py --videos 31976,31975,12619 --out D:/export/subset

    # 只导出清单不拷文件（先估算体积）
    python scripts/pack_media_subset.py --limit 50 --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _local_database_url() -> str | None:
    """把 .env 里的容器内地址换成本地回环。

    这个脚本在宿主机上跑（打包阶段），而 .env 里的 DATABASE_URL 用的是
    Docker 内部主机名 postgres —— 宿主机解析不了会卡住几十秒再超时。
    云上导入时用 import_media_manifest.py，那边在容器里跑，不需要这层转换。
    """
    explicit = os.environ.get("PACK_DATABASE_URL", "").strip()
    if explicit:
        return explicit
    env_path = Path(__file__).resolve().parents[2] / ".env"
    if not env_path.is_file():
        return None
    for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        if line.startswith("DATABASE_URL="):
            url = line.split("=", 1)[1].strip()
            return url.replace("@postgres:", "@127.0.0.1:").replace("@postgres/", "@127.0.0.1/")
    return None


_db_url = _local_database_url()
if _db_url:
    os.environ["DATABASE_URL"] = _db_url

from app.database import SessionLocal  # noqa: E402
from app.models import Category, Video  # noqa: E402

# 单个文件超过这个大小就跳过：演示没必要带 2GB 的大课
DEFAULT_MAX_FILE_MB = 500


def human(size_bytes: float) -> str:
    value = float(size_bytes or 0)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.1f}{unit}"
        value /= 1024
    return f"{value:.1f}GB"


def pick_videos(db, *, limit: int, ids: list[int] | None, max_file_mb: int) -> list[Video]:
    query = db.query(Video).filter(Video.filepath.isnot(None))
    if ids:
        query = query.filter(Video.id.in_(ids))
    else:
        # 挑「完整的一课」而不是「最小的文件」。
        # 按体积升序会挑出一堆 300KB 的章节片头，演示时打开就是一句标题，毫无价值。
        # 改成按时长降序（内容最厚），再用体积上限兜住传输成本。
        query = query.filter(
            Video.transcription.isnot(None),
            Video.duration.isnot(None),
            Video.duration >= 300,                     # 至少 5 分钟，排除片段
            Video.file_size >= 5 * 1024 * 1024,        # 至少 5MB，排除占位文件
            Video.file_size <= max_file_mb * 1024 * 1024,
        ).order_by(Video.duration.desc())
    return query.limit(limit).all()


def copy_one(src: Path, dst_dir: Path, prefix: str) -> tuple[Path | None, int]:
    """拷贝单个文件，返回 (目标路径, 字节数)。文件不存在时返回 (None, 0)。"""
    if not src.is_file():
        return None, 0
    dst_dir.mkdir(parents=True, exist_ok=True)
    target = dst_dir / f"{prefix}_{src.name}"
    # 同名但内容不同的情况极少见，加 id 前缀已经足够区分
    shutil.copy2(src, target)
    return target, target.stat().st_size


def main() -> int:
    parser = argparse.ArgumentParser(description="打包媒体子集供云端部署")
    parser.add_argument("--out", default="export/subset", help="输出目录")
    parser.add_argument("--limit", type=int, default=50, help="最多挑多少个视频")
    parser.add_argument("--videos", default="", help="指定视频 id，逗号分隔（优先于 --limit 的自动挑选）")
    parser.add_argument("--max-file-mb", type=int, default=DEFAULT_MAX_FILE_MB, help="单个视频体积上限")
    parser.add_argument("--dry-run", action="store_true", help="只统计体积，不拷文件")
    args = parser.parse_args()

    ids = [int(x) for x in args.videos.split(",") if x.strip().isdigit()] if args.videos else None
    out_dir = Path(args.out).expanduser().resolve()

    db = SessionLocal()
    try:
        videos = pick_videos(db, limit=args.limit, ids=ids, max_file_mb=args.max_file_mb)
        if not videos:
            print("没有符合条件的视频。放宽 --max-file-mb 或直接指定 --videos。")
            return 1

        categories = {
            row[0]: row[1] for row in db.query(Category.id, Category.name).all()
        }

        print(f"选中 {len(videos)} 个视频" + ("（仅统计，不拷贝）" if args.dry_run else ""))
        entries: list[dict] = []
        total_bytes = 0
        skipped: list[str] = []

        for video in videos:
            src = Path(video.filepath)
            size = int(video.file_size or 0)
            total_bytes += size

            entry = {
                "video_id": video.id,
                "title": video.title,
                "filename": src.name,
                "duration": video.duration,
                "category_id": video.category_id,
                "category_name": categories.get(video.category_id),
                "file_size": size,
                "original_filepath": str(src),
                "has_transcription": bool(video.transcription),
                "transcription": video.transcription or "",
                "subtitle_path": None,
                "thumbnail_path": None,
                "markdown_path": None,
            }

            if not args.dry_run:
                if not src.is_file():
                    skipped.append(f"{video.id} 源文件不存在: {src}")
                    entries.append(entry)
                    continue

                media_path, media_size = copy_one(src, out_dir / "media", str(video.id))
                entry["packed_media"] = str(media_path.relative_to(out_dir)) if media_path else None
                if media_path:
                    entry["file_size"] = media_size

                if video.subtitle_path:
                    sub_src = Path(video.subtitle_path)
                    packed, _ = copy_one(sub_src, out_dir / "subtitles", str(video.id))
                    entry["subtitle_path"] = str(packed.relative_to(out_dir)) if packed else None
                    entry["subtitle_filename"] = sub_src.name

                if video.thumbnail and Path(video.thumbnail).is_file():
                    packed, _ = copy_one(Path(video.thumbnail), out_dir / "thumbnails", str(video.id))
                    entry["thumbnail_path"] = str(packed.relative_to(out_dir)) if packed else None

                if video.markdown_path and Path(video.markdown_path).is_file():
                    packed, _ = copy_one(Path(video.markdown_path), out_dir / "notes", str(video.id))
                    entry["markdown_path"] = str(packed.relative_to(out_dir)) if packed else None

            entries.append(entry)
            mark = "·" if args.dry_run else "✓"
            print(f"  {mark} [{video.id}] {(video.title or '')[:44]:46s} {human(size)}")

        manifest = {
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "source_database": "postgresql",
            "video_count": len(videos),
            "total_bytes": total_bytes,
            "total_human": human(total_bytes),
            "videos": entries,
        }

        if not args.dry_run:
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / "manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
            )

        print()
        print(f"合计 {human(total_bytes)}，{len(videos)} 个视频")
        if skipped:
            print(f"跳过 {len(skipped)} 个：")
            for line in skipped[:5]:
                print("  - " + line)
        if not args.dry_run:
            print(f"输出目录：{out_dir}")
            print("下一步：把整个目录传到云服务器，然后跑 scripts/import_media_manifest.py")
        else:
            print("（dry-run：没有写入任何文件）")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
