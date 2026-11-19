"""只读扫描字幕质量，输出严重错误清单，不改数据库。

运行位置：backend 容器内（已有 psycopg 与 /app 代码）：
    python /tmp/subtitle_quality_scan.py
可选：
    SCAN_LIMIT=100        只扫前 100 个视频
    OUTPUT_PREFIX=/tmp/...  输出文件前缀
"""

from __future__ import annotations

import csv
import os
import re
import sys
from collections import Counter, defaultdict

import psycopg

sys.path.insert(0, "/app")
from app.services.subtitle_cleaner import (  # noqa: E402
    detect_text_issues,
    detect_video_issues,
    filler_ratio,
)

OUTPUT_PREFIX = os.getenv("OUTPUT_PREFIX", "/tmp/subtitle_quality")
SCAN_LIMIT = int(os.getenv("SCAN_LIMIT", "0"))

CRITICAL_FLAGS = {
    "segments_missing",
    "transcript_missing",
    "garbled_segments",
    "invalid_timestamps",
    "repeat_loop",
    "empty_segments_high",
    "coverage_low",
}
WARNING_FLAGS = {
    "timestamps_overlap",
    "filler_high",
    "duration_missing",
}


def db_url() -> str:
    url = os.environ.get("DATABASE_URL", "")
    return url.replace("postgresql+psycopg://", "postgresql://", 1)


def load_videos(conn) -> dict[int, dict]:
    sql = "SELECT id, title, duration, char_length(coalesce(transcription,'')) AS transcript_chars FROM videos"
    if SCAN_LIMIT > 0:
        sql += f" ORDER BY id LIMIT {SCAN_LIMIT}"
    with conn.cursor() as cur:
        cur.execute(sql)
        return {
            int(row[0]): {
                "id": int(row[0]),
                "title": row[1] or "",
                "duration": float(row[2]) if row[2] is not None else None,
                "transcript_chars": int(row[3] or 0),
            }
            for row in cur.fetchall()
        }


def scan_segments(conn, videos: dict[int, dict]) -> list[dict]:
    """流式扫 segment，按 video 聚合，避免把 359 万行全部读进内存。"""
    results: list[dict] = []
    seen_ids: set[int] = set()
    current_id: int | None = None
    segs: list[tuple[float, float, str]] = []
    seg_indices: list[int] = []
    bad_samples: list[str] = []
    last_norm = ""
    repeat_run = 0
    max_repeat_run = 0
    repeat_sample = ""

    def flush() -> None:
        nonlocal current_id, segs, seg_indices, bad_samples, max_repeat_run, repeat_sample
        nonlocal last_norm, repeat_run
        if current_id is None:
            return
        meta = videos.get(current_id)
        if meta is None:
            current_id = None
            segs = []
            return
        seen_ids.add(current_id)
        flags, metrics = detect_video_issues(
            duration=meta["duration"],
            transcript="x" if meta["transcript_chars"] > 0 else "",
            segments=segs,
        )
        # detect_video_issues 不读整段 transcript，字符数用元数据修正
        metrics["char_count"] = meta["transcript_chars"]
        # filler_ratio 需要真实文本；这里用 segments 重新算
        transcript_text = "".join(seg[2] for seg in segs)
        if transcript_text:
            metrics["filler_ratio"] = round(filler_ratio(transcript_text), 4)
            if metrics["filler_ratio"] > 0.08 and len(transcript_text) >= 100:
                if "filler_high" not in flags:
                    flags.append("filler_high")
        severity = "critical" if any(flag in CRITICAL_FLAGS for flag in flags) else (
            "warning" if any(flag in WARNING_FLAGS for flag in flags) else "ok"
        )
        if severity != "ok":
            results.append(
                {
                    **meta,
                    **metrics,
                    "flags": "|".join(sorted(flags)),
                    "severity": severity,
                    "sample": bad_samples[0] if bad_samples else (repeat_sample or ""),
                }
            )
        current_id = None
        segs = []
        seg_indices = []
        bad_samples = []
        max_repeat_run = 0
        repeat_sample = ""
        last_norm = ""
        repeat_run = 0

    with conn.cursor(name="subtitle_segments_scan") as cur:
        where = ""
        if SCAN_LIMIT > 0:
            where = f"WHERE video_id IN (SELECT id FROM videos ORDER BY id LIMIT {SCAN_LIMIT})"
        cur.execute(
            "SELECT video_id, segment_index, start_sec, end_sec, text "
            f"FROM subtitle_segments {where} ORDER BY video_id, segment_index"
        )
        while True:
            rows = cur.fetchmany(5000)
            if not rows:
                break
            for video_id, segment_index, start, end, text in rows:
                video_id = int(video_id)
                if current_id is None:
                    current_id = video_id
                elif video_id != current_id:
                    flush()
                    current_id = video_id
                raw = text or ""
                segs.append((float(start), float(end), raw))
                seg_indices.append(int(segment_index))

                norm = re.sub(r"\s", "", raw)
                if norm and norm == last_norm:
                    repeat_run += 1
                else:
                    repeat_run = 1
                    last_norm = norm
                if repeat_run >= 5 and len(norm) >= 4:
                    max_repeat_run = max(max_repeat_run, repeat_run)
                    if not repeat_sample:
                        repeat_sample = raw[:120]

                issues = detect_text_issues(raw, duration=float(end) - float(start))
                if (
                    "empty" in issues
                    or "garbled" in issues
                    or "degenerate" in issues
                    or "density_high" in issues
                ):
                    bad_samples.append(f"seg={segment_index} {','.join(issues)}: {raw[:100]}")

        # 扫完最后一条
        flush()

    # transcript 有内容但完全没有 segment 的视频：单独标记
    for vid, meta in videos.items():
        if vid in seen_ids or meta["transcript_chars"] <= 0:
            continue
        metrics = {
            "segment_count": 0,
            "char_count": meta["transcript_chars"],
            "empty_segments": 0,
            "garbled_segments": 0,
            "invalid_timestamps": 0,
            "overlap_segments": 0,
            "filler_segments": 0,
            "repeat_run_max": 0,
            "coverage_ratio": 0.0,
            "filler_ratio": 0.0,
        }
        results.append(
            {
                **meta,
                **metrics,
                "flags": "segments_missing",
                "severity": "critical",
                "sample": "transcript exists but subtitle_segments is empty",
            }
        )
    return results


def write_outputs(results: list[dict], videos: dict[int, dict]) -> None:
    csv_path = f"{OUTPUT_PREFIX}.csv"
    md_path = f"{OUTPUT_PREFIX}.md"
    fields = [
        "severity", "id", "title", "duration", "segment_count", "char_count",
        "transcript_chars", "empty_segments", "garbled_segments",
        "invalid_timestamps", "overlap_segments", "repeat_run_max",
        "coverage_ratio", "filler_segments", "filler_ratio", "flags", "sample",
    ]
    with open(csv_path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for item in sorted(results, key=lambda row: (row["severity"] != "critical", -row["char_count"])):
            writer.writerow(item)

    critical = [item for item in results if item["severity"] == "critical"]
    warnings = [item for item in results if item["severity"] == "warning"]
    flag_counts = Counter(
        flag for item in results for flag in (item["flags"].split("|") if item["flags"] else [])
    )
    total_chars = sum(meta["transcript_chars"] for meta in videos.values())
    severe_samples = critical[:20]

    lines = [
        "# 字幕质量扫描报告",
        "",
        f"- 扫描视频：{len(videos)}",
        f"- 有问题记录：{len(results)}（严重 {len(critical)} / 警告 {len(warnings)}）",
        f"- 问题记录覆盖字幕字符：{total_chars:,}",
        "",
        "## 问题分布",
        "",
        "| 问题代码 | 数量 |",
        "|---|---:|",
    ]
    for flag, count in flag_counts.most_common():
        lines.append(f"| `{flag}` | {count} |")

    lines += [
        "",
        "## 严重问题样例",
        "",
        "| video_id | 标题 | 段数 | 字符 | 问题 | 样例 |",
        "|---:|---|---:|---:|---|---|",
    ]
    for item in severe_samples:
        title = (item["title"] or "").replace("|", "/")[:36]
        sample = (item["sample"] or "").replace("|", "/").replace("\n", " ")[:80]
        lines.append(
            f"| {item['id']} | {title} | {item['segment_count']} | {item['char_count']} | "
            f"`{item['flags']}` | {sample} |"
        )

    lines += [
        "",
        "## 处理建议",
        "",
        "- `garbled_segments` / `repeat_loop` / `invalid_timestamps`：优先人工确认后重转写，不要只靠清洗修补。",
        "- `coverage_low` / `segments_missing`：先核对源视频是否截断、音频是否缺轨、转写是否提前结束。",
        "- `filler_high`：可直接走轻量清洗，删除独立语气词与重复片段，保留术语、数字、否定词和逻辑连接词。",
        "- 本报告只读，不改数据库、不重嵌、不重转写。",
    ]

    with open(md_path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")

    print(f"csv={csv_path}")
    print(f"md={md_path}")
    print(f"videos={len(videos)} flagged={len(results)} critical={len(critical)} warning={len(warnings)}")
    print("flags=" + ",".join(f"{k}:{v}" for k, v in flag_counts.most_common()))


def main() -> None:
    with psycopg.connect(db_url()) as conn:
        videos = load_videos(conn)
        print(f"videos={len(videos)}")
        results = scan_segments(conn, videos)
    write_outputs(results, videos)


if __name__ == "__main__":
    main()
