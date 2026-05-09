from pathlib import Path


def seconds_to_vtt(value: float) -> str:
    total_ms = int(round(value * 1000))
    hours = total_ms // 3600000
    minutes = (total_ms % 3600000) // 60000
    seconds = (total_ms % 60000) // 1000
    milliseconds = total_ms % 1000
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{milliseconds:03d}"


def write_vtt_output(vtt_path: Path, segments: list[dict]) -> None:
    vtt_path.parent.mkdir(parents=True, exist_ok=True)

    lines = ["WEBVTT", ""]
    for index, segment in enumerate(segments, start=1):
        lines.append(str(index))
        lines.append(f"{seconds_to_vtt(segment['start'])} --> {seconds_to_vtt(segment['end'])}")
        lines.append(segment["text"])
        lines.append("")

    vtt_path.write_text("\n".join(lines), encoding="utf-8")
