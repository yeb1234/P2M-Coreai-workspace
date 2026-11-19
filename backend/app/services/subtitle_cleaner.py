"""轻量、可回溯的字幕文本清洗。

设计原则：
- 只做确定性规则，不调用 LLM，不改写事实。
- 原始 transcription / subtitle_segments 不改；清洗文本只用于总结与向量。
- 术语、代码、数字、否定词、逻辑连接词一律保留。
- 只清掉明确的纯口头语、重复字词、重复标点和无意义填充。

清洗不是"纠错"：ASR 的严重错误由 detect_* 标记出来，不做静默修补。
"""

from __future__ import annotations

import re

CLEAN_VERSION = "light-v1"
# 向量库使用更保守的清洗：不删相邻重复词，不删句末口头反问。
# 这些规则留给总结/展示；向量只去掉确定性噪声。
VECTOR_CLEAN_MODE = "vector_safe"

# 只处理这些明确的语气/口头填充字，避免误伤正常词语。
# 不把“哈”放进通用集合，否则“哈工大”会被误删；只单独清连续“哈哈”。
_FILLER_CHARS = "嗯啊哦呃唉诶呀喂"
_FILLER_CLASS = f"[{_FILLER_CHARS}]"

# 连续“哈哈”是明确的笑声填充，但不碰单个“哈”（哈工大等专有名词）
_REPEATED_HA = re.compile(r"哈{2,}")

# 连续重复的纯语气词，如“哦哦”“啊啊啊”“嗯嗯”
_REPEATED_FILLER = re.compile(rf"{_FILLER_CLASS}{{2,}}")

# 段首/段尾的纯语气词。保留句末问号/句号，避免破坏句子边界
_LEADING_FILLER = re.compile(rf"^[\s，。！？!?、；;：:]*{_FILLER_CLASS}+[\s，。！？!?、；;：:]*")
_TRAILING_FILLER = re.compile(rf"[\s，。！？!?、；;：:]*{_FILLER_CLASS}+[。！？!?]*$")

# 被标点/空白夹住的独立语气词，如“，嗯，”“。啊。”
_ISOLATED_FILLER = re.compile(
    rf"(?<=[，。！？!?、；;：:\s]){_FILLER_CLASS}+(?=[，。！？!?、；;：:\s]|$)"
)

# 只合并相邻的重复词，不做泛化的叠词处理
_DUP_WORD = re.compile(r"(这个|那个|就是|然后|我们|你们|他们|我|你|他|她|它|这里|那里)\1+")

# 重复标点
_REPEAT_PUNCT = re.compile(r"([，。！？!?、；;：:])\1+")

# 结尾的纯口头反问，只用于总结/向量，显示文本默认保留
_TRAILING_TAG = re.compile(
    r"(?:[，,、\s]*)(?:是吧|对吧|对不对|是不是|好不好|行不行|可以吧|懂了吧)[。！？!?]*$"
)

# 明显乱码/替换字符
_GARBLED_RE = re.compile(r"\ufffd|锟斤拷|烫烫烫|屯屯屯|Ã|Â|â€|â€™")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")

# 单独成句的填充词（清洗后变空）
_STANDALONE_FILLER = re.compile(rf"^[\s，。！？!?、；;：:]*{_FILLER_CLASS}+[\s，。！？!?、；;：:]*$")

# 高频 ASR 口头语/口头禅，只作为“噪声提示”，不自动删
_FILLER_PHRASES = (
    "就是说",
    "然后呢",
    "那个",
    "这个",
    "是吧",
    "对不对",
    "是不是",
    "好不好",
    "你知道吧",
    "我跟你讲",
    "怎么说呢",
)


def clean_text(text: str, *, mode: str = "derived") -> str:
    """返回清洗后的文本。

    mode:
      - "display": 只删语气词和重复，保留结尾反问
      - "derived": 用于总结，额外去掉结尾口头反问
      - "vector_safe": 用于向量，只删确定性噪声；保留相邻重复词和结尾反问
    """
    if not text:
        return ""

    value = text.replace("\u3000", " ").replace("\u200b", "")
    value = _CONTROL_RE.sub("", value)
    value = _REPEATED_FILLER.sub("", value)
    value = _REPEATED_HA.sub("", value)
    value = _LEADING_FILLER.sub("", value)
    value = _TRAILING_FILLER.sub("", value)
    value = _ISOLATED_FILLER.sub("", value)
    if mode != VECTOR_CLEAN_MODE:
        # 向量模式不碰“这个这个/然后然后”，保留可能带语义的重复
        value = _DUP_WORD.sub(r"\1", value)
    value = _REPEAT_PUNCT.sub(r"\1", value)

    if mode == "derived":
        value = _TRAILING_TAG.sub("", value)

    # 统一空白，去掉标点两侧多余空格；不改变中英文标点种类
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"\s*([，。！？!?、；;：:])\s*", r"\1", value)
    value = value.strip(" \t\r\n，,、；;：:")

    # 清洗后只剩标点，视为空
    if not re.search(r"[\w\u4e00-\u9fff]", value):
        return ""
    return value.strip()


def clean_transcript(text: str, *, mode: str = "derived") -> str:
    """按行清洗整段 transcript，保留原有行结构。"""
    if not text:
        return ""
    lines = [clean_text(line, mode=mode) for line in text.replace("\r\n", "\n").split("\n")]
    return "\n".join(line for line in lines if line).strip()


def clean_segments(segments: list[tuple[float, float, str]], *, mode: str = "derived") -> list[tuple[float, float, str]]:
    """清洗 segment 文本，但保留每段时间轴不变。"""
    out: list[tuple[float, float, str]] = []
    for start, end, text in segments:
        cleaned = clean_text(text, mode=mode)
        if cleaned:
            out.append((start, end, cleaned))
    return out


def filler_ratio(text: str) -> float:
    """估算纯语气词占有效字符的比例，用于质量报告。"""
    if not text:
        return 0.0
    chars = [ch for ch in text if ch.strip() and ch not in "，。！？!?、；;：:"]
    if not chars:
        return 0.0
    filler = sum(1 for ch in chars if ch in _FILLER_CHARS)
    return filler / len(chars)


def detect_text_issues(text: str, *, duration: float | None = None) -> list[str]:
    """返回单段文本的问题代码；不负责修复。"""
    issues: list[str] = []
    raw = (text or "").strip()
    if not raw:
        return ["empty"]
    if _CONTROL_RE.search(raw) or _GARBLED_RE.search(raw):
        issues.append("garbled")
    if len(raw) >= 6 and len(set(raw)) <= 2:
        issues.append("degenerate")
    if re.search(r"(.)\1{4,}", raw):
        issues.append("repeat_char")
    if _STANDALONE_FILLER.match(raw):
        issues.append("only_filler")
    if duration and duration > 0:
        cps = len(re.sub(r"\s", "", raw)) / duration
        if cps > 15:
            issues.append("density_high")
        elif cps < 0.2 and len(raw) >= 4:
            issues.append("density_low")
    return issues


def detect_video_issues(
    *,
    duration: float | None,
    transcript: str,
    segments: list[tuple[float, float, str]],
) -> tuple[list[str], dict]:
    """视频级质量检查，返回 (问题代码, 指标)。

    只标记需要人工确认的严重问题，不自动改字幕。
    """
    flags: list[str] = []
    metrics: dict = {
        "segment_count": len(segments),
        "char_count": len(transcript or ""),
        "empty_segments": 0,
        "garbled_segments": 0,
        "invalid_timestamps": 0,
        "overlap_segments": 0,
        "filler_segments": 0,
        "repeat_run_max": 0,
        "coverage_ratio": 0.0,
    }

    if transcript and not segments:
        flags.append("segments_missing")
    if segments and not transcript:
        flags.append("transcript_missing")

    max_end = 0.0
    prev_end: float | None = None
    current_run = 0
    last_norm = ""

    for start, end, text in segments:
        raw = text or ""
        if not raw.strip():
            metrics["empty_segments"] += 1
        if _CONTROL_RE.search(raw) or _GARBLED_RE.search(raw):
            metrics["garbled_segments"] += 1

        if start < 0 or end <= start:
            metrics["invalid_timestamps"] += 1
        if duration and duration > 0 and end > duration + 5:
            metrics["invalid_timestamps"] += 1
        if prev_end is not None and start < prev_end - 0.5:
            metrics["overlap_segments"] += 1

        cleaned = clean_text(raw, mode="display")
        if cleaned and cleaned != raw.strip():
            metrics["filler_segments"] += 1

        norm = re.sub(r"\s", "", cleaned or raw)
        if norm and norm == last_norm:
            current_run += 1
        else:
            current_run = 1
            last_norm = norm
        metrics["repeat_run_max"] = max(metrics["repeat_run_max"], current_run)

        max_end = max(max_end, end)
        prev_end = end if prev_end is None else max(prev_end, end)

    if duration and duration > 0:
        metrics["coverage_ratio"] = min(1.0, max_end / duration)

    if metrics["empty_segments"] >= max(2, len(segments) * 0.2):
        flags.append("empty_segments_high")
    if metrics["garbled_segments"]:
        flags.append("garbled_segments")
    if metrics["invalid_timestamps"] >= 2:
        flags.append("invalid_timestamps")
    if metrics["overlap_segments"] >= max(3, len(segments) * 0.05):
        flags.append("timestamps_overlap")
    if metrics["repeat_run_max"] >= 5:
        flags.append("repeat_loop")
    if duration and duration > 0 and metrics["coverage_ratio"] < 0.5 and len(segments) > 1:
        flags.append("coverage_low")
    if duration is None:
        flags.append("duration_missing")

    # 被清洗规则改动过的 segment 占比。注意这不是“纯语气词字占比”：
    # 一句正常讲解末尾带“啊”也会计入。超过 5% 才提示，避免误报。
    if len(segments) >= 20:
        changed_ratio = metrics["filler_segments"] / len(segments)
        metrics["filler_segment_ratio"] = round(changed_ratio, 4)
        if changed_ratio > 0.05:
            flags.append("filler_high")

    # 高频口头禅占有效文本比例过高，只给 warning，不删原文
    if transcript:
        filler = filler_ratio(transcript)
        metrics["filler_ratio"] = round(filler, 4)
        if filler > 0.08 and len(transcript) >= 100:
            flags.append("filler_high")

    return flags, metrics
