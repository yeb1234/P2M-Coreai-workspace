"""检索链路的缓存与降级回归。"""

from __future__ import annotations


class _FakeEmbeddingClient:
    model = "fake-embedding"
    dim = 3

    def __init__(self):
        self.calls = 0

    def embed(self, texts):
        self.calls += 1
        return [[1.0, 2.0, 3.0] for _ in texts]


def test_query_embedding_cache_reuses_vector():
    import app.services.hybrid_search as hs

    fake = _FakeEmbeddingClient()
    original = hs.get_embedding_client
    hs.get_embedding_client = lambda: fake
    hs._QUERY_EMBED_CACHE.clear()
    try:
        first, first_status = hs._query_embedding_cached("依赖注入 DI")
        second, second_status = hs._query_embedding_cached("依赖注入 DI")
        assert first_status == "miss"
        assert second_status == "hit"
        assert fake.calls == 1
        assert first.tolist() == second.tolist()
    finally:
        hs.get_embedding_client = original
        hs._QUERY_EMBED_CACHE.clear()
