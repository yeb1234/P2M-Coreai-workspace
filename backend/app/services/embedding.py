"""Embedding service: generate text embeddings via LM Studio (OpenAI-compatible API).

Uses requests directly instead of LangChain OpenAIEmbeddings due to LM Studio
compatibility issue with httpx (used by OpenAI SDK).
"""

from __future__ import annotations

import json
import logging
import os

import requests

from app.database import settings

logger = logging.getLogger(__name__)

DEFAULT_EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL") or "text-embedding-bge-m3"
DEFAULT_EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM") or "1024")


def _get_embedding_base_url() -> str:
    """获取 embedding API 的 base_url（确保以 /v1 结尾）。

    3.0 的 .env 已经有独立的 EMBEDDING_BASE_URL / EMBEDDING_MODEL；
    2.94 这里仍只看 OPENAI_BASE_URL 且把模型名写死，导致设置页/环境变量
    对 embedding 完全不生效。优先读独立的 embedding 配置，再回退到 LLM 配置。
    """
    base = (os.getenv("EMBEDDING_BASE_URL") or settings.openai_base_url).strip().rstrip("/")
    if base.endswith("/v1"):
        return base
    if "/v1/" in base:
        return base
    return base + "/v1"


def _get_embedding_api_key() -> str:
    return os.getenv("EMBEDDING_API_KEY") or settings.openai_api_key or "lm-studio"


def get_embedding_config() -> dict:
    """返回当前 embedding 配置。"""
    return {
        "base_url": _get_embedding_base_url(),
        "api_key": _get_embedding_api_key(),
        "model": os.getenv("EMBEDDING_MODEL") or DEFAULT_EMBEDDING_MODEL,
        "dim": int(os.getenv("EMBEDDING_DIM") or DEFAULT_EMBEDDING_DIM),
    }


def generate_embedding(
    text: str,
    model: str | None = None,
    base_url: str | None = None,
    api_key: str | None = None,
    timeout_s: int = 30,
) -> list[float]:
    """生成单个文本的 embedding。"""
    config = get_embedding_config()
    url = (base_url or config["base_url"]) + "/embeddings"
    key = api_key or config["api_key"]
    model = model or config["model"]

    response = requests.post(
        url,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        },
        json={"model": model, "input": text},
        timeout=timeout_s,
    )
    if response.status_code != 200:
        raise RuntimeError(f"Embedding API HTTP {response.status_code}: {response.text[:500]}")

    data = response.json()
    embeddings = data.get("data")
    if not isinstance(embeddings, list) or not embeddings:
        raise RuntimeError(f"Unexpected embedding response: {json.dumps(data, ensure_ascii=False)[:500]}")

    emb = embeddings[0].get("embedding")
    if not isinstance(emb, list):
        raise RuntimeError("Embedding response missing embedding array")
    return [float(v) for v in emb]


def generate_embeddings_batch(
    texts: list[str],
    model: str | None = None,
    base_url: str | None = None,
    api_key: str | None = None,
    timeout_s: int = 300,
) -> list[list[float]]:
    """批量生成 embeddings。"""
    if not texts:
        return []

    config = get_embedding_config()
    url = (base_url or config["base_url"]) + "/embeddings"
    key = api_key or config["api_key"]
    model = model or config["model"]

    response = requests.post(
        url,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        },
        json={"model": model, "input": texts},
        timeout=timeout_s,
    )
    if response.status_code != 200:
        raise RuntimeError(f"Embedding API HTTP {response.status_code}: {response.text[:500]}")

    data = response.json()
    embeddings = data.get("data")
    if not isinstance(embeddings, list) or len(embeddings) != len(texts):
        raise RuntimeError(f"Unexpected batch embedding response: {json.dumps(data, ensure_ascii=False)[:500]}")

    results: list[list[float]] = []
    for item in embeddings:
        emb = item.get("embedding")
        if not isinstance(emb, list):
            raise RuntimeError("Embedding response missing embedding array")
        results.append([float(v) for v in emb])
    return results
