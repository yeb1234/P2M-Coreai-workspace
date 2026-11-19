"""构建 demo 视频库：按主题归档 + 生成清单。

为什么单独做一份
----------------
主库有 28,654 个视频、1.57TB，转写完整需要 23 天 GPU。
demo 只需要 50 个能覆盖各主题的样本，物理归档到项目内，方便演示时直接指着文件夹讲。

数据库里的记录不动 —— 这些视频本来就在 videos 表里（只是没有字幕），
处理它们等于给真实数据补字幕，不是造一套假数据。

用法：
    python scripts/build_demo_library.py --dry-run        # 只看选中哪些
    python scripts/build_demo_library.py                   # 归档 50 个
    python scripts/build_demo_library.py --per-theme 5     # 每个主题 5 个
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

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _local_database_url() -> str | None:
    """宿主机跑时把容器内主机名换成本地回环，否则 DNS 解析会卡几十秒。"""
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

from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402

# 主题配额：面试相关度高的多给几个
THEMES = [
    ("1_agent", 12, ["langgraph", "langchain", "agent", "智能体"]),
    ("2_rag", 12, ["rag", "检索", "向量", "milvus", "embedding"]),
    ("3_backend", 10, ["fastapi", "接口", "后端", "api"]),
    ("4_python", 8, ["python", "语法", "函数", "装饰器"]),
    ("5_llm", 5, ["大模型", "微调", "训练", "prompt"]),
    ("6_frontend", 3, ["vue", "javascript", "前端", "react"]),
]

# 选片条件：宁可短一点，演示时打开就能看完
MIN_SEC, MAX_SEC = 300, 1800      # 5~30 分钟
MIN_MB = 5


def to_host_path(raw: str) -> Path:
    """把数据库里的路径翻译成宿主机路径。

    videos.filepath 存的是**容器内路径**（/videos/xxx.mp4），
    因为入库时是后端容器扫描的。在宿主机跑这个脚本时直接拿它去 open 必然失败 ——
    之前 50 个里 34 个报「源不存在」就是这个原因，不是文件丢了。
    """
    if raw.startswith("/videos/"):
        configured = os.environ.get("VIDEO_HOST_PATH", "").strip()
        base = Path(configured) if configured else PROJECT_ROOT / "video-library"
        if not base.is_absolute():
            base = PROJECT_ROOT / base
        return base / raw[len("/videos/"):].replace("/", os.sep)
    return Path(raw)


def build_where(patterns: list[str]) -> tuple[str, dict]:
    clauses = []
    params: dict = {}
    for i, p in enumerate(patterns):
        key = f"p{i}"
        clauses.append(f"v.title ILIKE :{key}")
        params[key] = f"%{p}%"
    return "(" + " OR ".join(clauses) + ")", params


def pick(conn, patterns, limit, exclude: set[int]):
    where, params = build_where(patterns)
    exclude_sql = ""
    if exclude:
        exclude_sql = " AND v.id <> ALL(:excl)"
        params["excl"] = list(exclude)
    params["lim"] = limit
    return conn.execute(
        text(
            f"""
            SELECT v.id, v.title, v.filepath, v.duration, v.file_size
            FROM videos v
            WHERE v.transcription IS NULL
              AND v.duration BETWEEN {MIN_SEC} AND {MAX_SEC}
              AND v.file_size > {MIN_MB * 1024 * 1024}
              AND v.filepath IS NOT NULL
              AND {where}{exclude_sql}
            ORDER BY v.duration ASC
            LIMIT :lim
            """
        ),
        params,
    ).fetchall()


def main() -> int:
    ap = argparse.ArgumentParser(description="构建 demo 视频库")
    ap.add_argument("--out", default="demo", help="输出目录（相对项目根）")
    ap.add_argument("--per-theme", type=int, default=0, help="每个主题固定数量（覆盖默认配额）")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    root = Path(__file__).resolve().parents[2]
    out_dir = root / args.out

    picked: list[dict] = []
    used_ids: set[int] = set()

    with engine.connect() as conn:
        for name, quota, patterns in THEMES:
            want = args.per_theme or quota
            rows = pick(conn, patterns, want, used_ids)
            for r in rows:
                used_ids.add(r.id)
                picked.append(
                    {
                        "video_id": r.id,
                        "theme": name,
                        "title": r.title,
                        "src": r.filepath,
                        "duration": round(float(r.duration or 0)),
                        "size_mb": round((r.file_size or 0) / 1048576, 1),
                    }
                )
            print(f"  {name:12s} 选中 {len(rows):2d}/{want}")

    total_mb = sum(p["size_mb"] for p in picked)
    print(f"\n合计 {len(picked)} 个 / {total_mb:.0f} MB / {sum(p['duration'] for p in picked)/60:.0f} 分钟")

    if args.dry_run:
        for p in picked[:8]:
            print(f"  [{p['video_id']}] {p['theme']:10s} {p['duration']//60:2d}分 {p['title'][:44]}")
        print(f"  ...（共 {len(picked)} 个）")
        return 0

    copied = 0
    failed: list[str] = []
    for p in picked:
        theme_dir = out_dir / p["theme"]
        theme_dir.mkdir(parents=True, exist_ok=True)
        src = to_host_path(p["src"])
        if not src.is_file():
            failed.append(f"{p['video_id']} 源不存在")
            continue
        # 文件名加 id 前缀，避免不同课程下同名
        dst = theme_dir / f"{p['video_id']}_{src.name}"
        if not dst.exists():
            try:
                shutil.copy2(src, dst)
                copied += 1
            except Exception as exc:
                failed.append(f"{p['video_id']} 复制失败: {exc}")
                continue

    manifest = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "note": "数据库记录未改动，这些视频仍在 videos 表里，处理它们等于给真实数据补字幕",
        "count": len(picked),
        "total_mb": round(total_mb, 1),
        "themes": {name: sum(1 for p in picked if p["theme"] == name) for name, _, _ in THEMES},
        "videos": picked,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"\n复制完成 {copied} 个，清单写入 {out_dir/'manifest.json'}")
    if failed:
        print(f"失败 {len(failed)} 个：")
        for line in failed[:5]:
            print("  - " + line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
