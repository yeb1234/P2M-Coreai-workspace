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


def update_vtt_segment_text(vtt_path: Path, segment_index: int, new_text: str) -> None:
    """Update the text of a specific segment (0-based index) in an existing VTT file."""
    if not vtt_path.exists():
        return

    content = vtt_path.read_text(encoding="utf-8")
    lines = content.splitlines()

    # VTT cue index starts at 1, so target_index = segment_index + 1
    target_cue = str(segment_index + 1)
    found = False
    cue_line_idx = -1

    # Find the line that is exactly the target cue index (as a standalone number)
    for i, line in enumerate(lines):
        if line.strip() == target_cue:
            # Make sure the next line looks like a timestamp line
            if i + 1 < len(lines) and " --> " in lines[i + 1]:
                cue_line_idx = i
                found = True
                break

    if not found or cue_line_idx < 0:
        return

    # The text line(s) are after the timestamp line (cue_line_idx + 1)
    # We need to replace the text block.
    # VTT text can be multi-line, but typically we store single-line text per segment.
    # The text block ends at the next empty line or next cue.
    text_start = cue_line_idx + 2  # after cue number and timestamp
    text_end = text_start

    for j in range(text_start, len(lines)):
        stripped = lines[j].strip()
        if stripped == "":
            text_end = j
            break
        # If next line is a cue number followed by timestamp, text block ended
        if stripped.isdigit() and j + 1 < len(lines) and " --> " in lines[j + 1]:
            text_end = j
            break
        text_end = j + 1

    # Replace text lines with new_text
    new_lines = lines[:text_start] + [new_text] + lines[text_end:]
    vtt_path.write_text("\n".join(new_lines), encoding="utf-8")
