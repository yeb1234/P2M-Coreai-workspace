from datetime import datetime
from pathlib import Path
from typing import Optional


def format_hms(value: float) -> str:
    seconds = int(value)
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    remain = seconds % 60
    if hours:
        return f"{hours:02d}:{minutes:02d}:{remain:02d}"
    return f"{minutes:02d}:{remain:02d}"


def write_markdown_output(
    md_path: Path,
    source_filename: str,
    transcript: str,
    transcript_segments: list[dict],
    summary: Optional[str],
    word_limit: int,
    whisper_model: str,
    language: str,
    subtitle_filename: Optional[str] = None,
    summary_error: Optional[str] = None,
) -> None:
    md_path.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    lines = [
        "# 视频转录与学习总结",
        "",
        "## 元信息",
        "",
        f"- 时间：{now}",
        f"- 源文件：{source_filename}",
        f"- Whisper 模型：{whisper_model}",
        f"- 语言：{language}",
        f"- 总结字数上限：{word_limit}",
    ]
    if subtitle_filename:
        lines.append(f"- 字幕文件：{subtitle_filename}")

    lines.extend(
        [
            "",
            "## 总结",
            "",
        ]
    )

    if summary_error:
        lines.append(f"总结生成失败：{summary_error}")
        lines.append("")

    lines.append((summary or "").strip() or "（空）")
    lines.extend(["", "## 完整转录", "", transcript.strip() or "（空）", "", "## 时间轴转录", ""])

    if transcript_segments:
        for segment in transcript_segments:
            lines.append(f"- [{format_hms(segment['start'])} - {format_hms(segment['end'])}] {segment['text']}")
    else:
        lines.append("（空）")

    md_path.write_text("\n".join(lines), encoding="utf-8")
