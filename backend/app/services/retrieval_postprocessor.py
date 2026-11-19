"""Retrieval Post-Processor: 检索结果的过滤和压缩。

包含：
- RelevanceFilter: 基于相关性阈值过滤低质量结果
- ContextCompressor: 合并相邻片段 + 控制总 token 量
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class RelevanceFilter:
    """基于相关性阈值过滤低质量检索结果。"""

    def __init__(self, min_score: float = 0.15):
        self.min_score = min_score

    def filter(self, documents: list[dict]) -> list[dict]:
        """过滤掉 score_hint 低于阈值的结果。

        Args:
            documents: 检索结果列表，每个 dict 需有 "score_hint" 或 "rerank_score" 字段

        Returns:
            过滤后的结果列表
        """
        if not documents:
            return []

        filtered = []
        for doc in documents:
            # 优先用 rerank_score，其次 score_hint
            score = doc.get("rerank_score", doc.get("score_hint", 0.0))
            if score >= self.min_score:
                filtered.append(doc)

        if len(filtered) < len(documents):
            logger.debug(
                "RelevanceFilter: %d -> %d (threshold=%.2f)",
                len(documents), len(filtered), self.min_score,
            )

        # 如果全部被过滤掉，保留得分最高的一个（避免空结果）
        if not filtered and documents:
            best = max(documents, key=lambda d: d.get("rerank_score", d.get("score_hint", 0.0)))
            filtered = [best]
            logger.debug("RelevanceFilter: all filtered, keeping best result")

        return filtered


class ContextCompressor:
    """压缩检索结果，减少送入 LLM 的 token 量。

    功能：
    1. merge_adjacent: 合并同视频的相邻字幕片段
    2. compress: 控制总字符数，优先保留高分结果
    """

    def __init__(self, max_chars: int = 6000, merge_gap_sec: float = 3.0):
        """
        Args:
            max_chars: 最大总字符数
            merge_gap_sec: 相邻片段合并的最大间隔秒数
        """
        self.max_chars = max_chars
        self.merge_gap_sec = merge_gap_sec

    def merge_adjacent(self, documents: list[dict]) -> list[dict]:
        """合并同视频的相邻字幕片段，减少碎片化。

        判断逻辑：同一 video_id，且前一个片段的 end_sec 与后一个片段的
        start_sec 间隔 <= merge_gap_sec 秒，则合并为一个片段。
        """
        if not documents:
            return []

        # 按 video_id + start_sec 排序
        sorted_docs = sorted(
            documents,
            key=lambda d: (d.get("video_id", 0), d.get("start_sec", 0)),
        )

        merged: list[dict] = []
        for doc in sorted_docs:
            if not merged:
                merged.append(doc.copy())
                continue

            last = merged[-1]
            same_video = last.get("video_id") == doc.get("video_id")
            gap = doc.get("start_sec", 0) - last.get("end_sec", 0)

            if same_video and 0 <= gap <= self.merge_gap_sec:
                # 合并：扩展 end_sec，拼接 text
                last["end_sec"] = max(last.get("end_sec", 0), doc.get("end_sec", 0))
                # 避免重复文本
                new_text = doc.get("text", "")
                if new_text and not last["text"].endswith(new_text):
                    last["text"] = last["text"] + new_text
                # 保留较高的分数
                last_score = last.get("rerank_score", last.get("score_hint", 0))
                doc_score = doc.get("rerank_score", doc.get("score_hint", 0))
                if doc_score > last_score:
                    if "rerank_score" in doc:
                        last["rerank_score"] = doc["rerank_score"]
                    if "score_hint" in doc:
                        last["score_hint"] = doc["score_hint"]
            else:
                merged.append(doc.copy())

        if len(merged) < len(documents):
            logger.debug(
                "ContextCompressor merge: %d -> %d segments",
                len(documents), len(merged),
            )

        return merged

    def compress(
        self,
        query: str,
        documents: list[dict],
        max_chars: int | None = None,
    ) -> list[dict]:
        """控制总字符数，优先保留高分结果。

        Args:
            query: 用户查询（当前未使用，预留用于 LLM-based 压缩）
            documents: 检索结果列表
            max_chars: 覆盖默认最大字符数

        Returns:
            压缩后的结果列表
        """
        limit = max_chars or self.max_chars
        if not documents:
            return []

        # 按分数降序排列（优先保留高分结果）
        sorted_docs = sorted(
            documents,
            key=lambda d: d.get("rerank_score", d.get("score_hint", 0)),
            reverse=True,
        )

        result: list[dict] = []
        total_chars = 0

        for doc in sorted_docs:
            text = doc.get("text", "")
            text_len = len(text)

            if total_chars + text_len <= limit:
                result.append(doc)
                total_chars += text_len
            else:
                # 尝试截断当前文档以适应剩余空间
                remaining = limit - total_chars
                if remaining > 100:  # 至少保留 100 字符才有意义
                    truncated = doc.copy()
                    truncated["text"] = text[:remaining] + "..."
                    truncated["_truncated"] = True
                    result.append(truncated)
                    total_chars += remaining
                break

        if len(result) < len(documents):
            logger.debug(
                "ContextCompressor compress: %d -> %d docs (%d chars)",
                len(documents), len(result), total_chars,
            )

        # 恢复原始顺序（按 start_sec）
        result.sort(key=lambda d: (d.get("video_id", 0), d.get("start_sec", 0)))
        return result
