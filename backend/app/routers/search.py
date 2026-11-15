"""混合检索 API。

控制器只做参数校验与响应组装，检索逻辑全部在 services.hybrid_search。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from app.schemas import HybridSearchHit, HybridSearchOut, VectorStatsOut
from app.services.hybrid_search import hybrid_search
from app.services.vector_store import VectorStoreError, stats as vector_stats

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/search", tags=["search"])


def _parse_ids(raw: str) -> list[int]:
    if not raw:
        return []
    values: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            values.append(int(part))
        except ValueError:
            raise HTTPException(status_code=422, detail=f"无效的 id: {part}")
    return values


@router.get("/hybrid", response_model=HybridSearchOut)
def search_hybrid(
    q: str = Query(..., min_length=1, max_length=300, description="查询词或自然语言问题"),
    top_k: int = Query(8, ge=1, le=30),
    candidate_k: int = Query(30, ge=5, le=100, description="每路召回的候选数"),
    category_ids: str = Query("", description="逗号分隔的分类 id，含子分类需前端自行展开"),
    video_ids: str = Query("", description="逗号分隔的视频 id，限定在某个视频内检索"),
    rerank: bool = Query(True, description="是否用 LLM 精排；关闭可省 0.6-2.8s"),
):
    """词法 + 语义混合检索，返回带相关度与来源标记的片段。"""
    result = hybrid_search(
        q,
        top_k=top_k,
        candidate_k=candidate_k,
        category_ids=_parse_ids(category_ids) or None,
        video_ids=_parse_ids(video_ids) or None,
        use_rerank=rerank,
    )
    return HybridSearchOut(
        query=q,
        hits=[HybridSearchHit(**hit.to_dict()) for hit in result["hits"]],
        timings=result["timings"],
        degraded=result["degraded"],
        rerank_used=rerank and "rerank_ms" in result["timings"],
        rerank_mode=result.get("rerank_mode"),
    )


@router.get("/stats", response_model=VectorStatsOut)
def search_stats():
    """向量覆盖率，用于判断检索能力是否已经建好。"""
    try:
        data = vector_stats()
    except VectorStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return VectorStatsOut(**data)
