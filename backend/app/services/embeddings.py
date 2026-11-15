"""文本向量化客户端（OpenAI 兼容 /v1/embeddings）。

默认走本地 LM Studio 的 bge-m3（1024 维，中文强、支持 8k 长文本、无需 instruction 前缀）。
外部商用 embedding 只需改 EMBEDDING_BASE_URL / MODEL 即可切换，接口形状一致。
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

import requests

from app.database import settings

logger = logging.getLogger(__name__)


class EmbeddingError(RuntimeError):
    """向量化失败的统一异常，调用方据此降级到纯词法检索。"""


@dataclass
class EmbeddingClient:
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    dim: int = 0
    batch_size: int = 0
    timeout_s: int = 0
    max_retries: int = 3
    _session: requests.Session = field(default_factory=requests.Session, repr=False)

    def __post_init__(self) -> None:
        self.base_url = (self.base_url or settings.embedding_base_url).rstrip("/")
        self.api_key = self.api_key or settings.embedding_api_key
        self.model = self.model or settings.embedding_model
        self.dim = self.dim or settings.embedding_dim
        self.batch_size = self.batch_size or settings.embedding_batch_size
        self.timeout_s = self.timeout_s or settings.embedding_timeout_s

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def embed(self, texts: list[str]) -> list[list[float]]:
        """批量向量化，返回与输入等长的向量列表。

        失败重试 3 次（指数退避）；仍失败抛 EmbeddingError 由调用方降级，
        绝不返回零向量——零向量会让相似度检索返回完全无关的结果。
        """
        if not texts:
            return []

        vectors: list[list[float]] = []
        for start in range(0, len(texts), self.batch_size):
            chunk = texts[start : start + self.batch_size]
            vectors.extend(self._embed_chunk(chunk))
        return vectors

    def _embed_chunk(self, chunk: list[str]) -> list[list[float]]:
        payload = {"model": self.model, "input": chunk}
        last_error: Exception | None = None

        for attempt in range(self.max_retries):
            try:
                response = self._session.post(
                    f"{self.base_url}/embeddings",
                    json=payload,
                    headers=self._headers(),
                    timeout=self.timeout_s,
                )
                if response.status_code == 429:
                    raise EmbeddingError("embedding 限流 429")
                if response.status_code >= 500:
                    raise EmbeddingError(f"embedding 服务错误 {response.status_code}")
                if response.status_code != 200:
                    raise EmbeddingError(
                        f"embedding HTTP {response.status_code}: {response.text[:200]}"
                    )

                data = response.json()
                items = data.get("data")
                if not isinstance(items, list) or len(items) != len(chunk):
                    raise EmbeddingError(
                        f"embedding 返回数量不匹配: 期望 {len(chunk)}, 实际 {len(items or [])}"
                    )

                items = sorted(items, key=lambda item: item.get("index", 0))
                result: list[list[float]] = []
                for item in items:
                    vector = item.get("embedding")
                    if not isinstance(vector, list) or len(vector) != self.dim:
                        raise EmbeddingError(
                            f"向量维度异常: {len(vector) if isinstance(vector, list) else 'N/A'} != {self.dim}"
                        )
                    result.append(vector)
                return result
            except (requests.RequestException, EmbeddingError) as exc:
                last_error = exc
                if attempt < self.max_retries - 1:
                    backoff = 0.5 * (2**attempt)
                    logger.warning("embedding 第 %s 次失败，%.1fs 后重试: %s", attempt + 1, backoff, exc)
                    time.sleep(backoff)

        raise EmbeddingError(f"embedding 连续失败: {last_error}")

    def health(self) -> dict:
        started = time.perf_counter()
        try:
            self.embed(["健康检查"])
            return {
                "ok": True,
                "model": self.model,
                "dim": self.dim,
                "latency_ms": round((time.perf_counter() - started) * 1000),
            }
        except Exception as exc:
            return {"ok": False, "model": self.model, "error": str(exc)[:200]}


_default_client: EmbeddingClient | None = None


def get_embedding_client() -> EmbeddingClient:
    global _default_client
    if _default_client is None:
        _default_client = EmbeddingClient()
    return _default_client


def reset_embedding_client() -> None:
    """设置变更后重建客户端（模型/维度可能已改）。"""
    global _default_client
    _default_client = None
