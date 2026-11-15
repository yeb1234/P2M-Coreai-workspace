"""字幕 → 语义块的分块逻辑。

从 scripts/build_content_chunks.py 提出来：脚本和后台索引管线都要用，
放在脚本里会让 worker 反向依赖 scripts（那些脚本带 sys.path 注入，
import 会有副作用）。

分块的目标是「检索单位」：一条字幕平均 9 个字，单独拿出来没有信息量；
一个语义块 400-600 字，是一段完整的讲解。60:1 左右的压缩比。
"""

from __future__ import annotations

# 目标与边界
TARGET_CHARS = 400
MAX_CHARS = 600
MIN_CHARS = 150
OVERLAP_CHARS = 60

# 句子结束标记。中文标点优先，顿号不算（它连的是并列词不是句）
SENTENCE_END = set("。？！?!；;")


def split_into_chunks(segments: list[tuple[float, float, str]]) -> list[dict]:
    """把按时间排序的字幕片段合并成语义块。

    合并规则：
    - 累加到 TARGET_CHARS 且当前句已结束 → 切
    - 超过 MAX_CHARS → 强制切（防止一段没标点的口播变成巨型块）
    - 新块从上一块最后 OVERLAP_CHARS 的内容开始，保证跨块语义连贯
    """
    chunks: list[dict] = []
    if not segments:
        return chunks

    buf: list[str] = []
    buf_chars = 0
    start_sec = segments[0][0]
    end_sec = segments[0][1]
    seg_count = 0

    for seg_start, seg_end, raw in segments:
        piece = (raw or "").strip()
        if not piece:
            continue

        buf.append(piece)
        buf_chars += len(piece)
        end_sec = seg_end
        seg_count += 1

        ends_sentence = piece[-1] in SENTENCE_END
        reached_target = buf_chars >= TARGET_CHARS
        over_max = buf_chars >= MAX_CHARS

        if (reached_target and ends_sentence) or over_max:
            text_out = "".join(buf)
            if len(text_out) >= MIN_CHARS or over_max:
                chunks.append(
                    {
                        "start_sec": start_sec,
                        "end_sec": end_sec,
                        "text": text_out,
                        "char_count": len(text_out),
                        "segment_count": seg_count,
                    }
                )
                # 用尾部做下一块的开头，保证跨块连续
                tail = text_out[-OVERLAP_CHARS:]
                buf = [tail] if tail else []
                buf_chars = len(tail)
                start_sec = seg_end
                seg_count = 0
            else:
                # 没到最小长度就继续累积，不切
                continue

    # 收尾
    if buf:
        text_out = "".join(buf)
        if len(text_out.strip()) >= 30:
            chunks.append(
                {
                    "start_sec": start_sec,
                    "end_sec": end_sec,
                    "text": text_out,
                    "char_count": len(text_out),
                    "segment_count": seg_count,
                }
            )
    return chunks
