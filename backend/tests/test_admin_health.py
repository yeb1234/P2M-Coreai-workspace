"""管理面健康检查回归测试。

不依赖真实 LLM、Redis 或数据库；只验证最容易把管理页拖垮的
「LLM 探测必须并行且有总预算」以及超时项不能继续阻塞返回。
"""

from __future__ import annotations

import time

from app.services.admin_health import probe_llm_contexts


def test_llm_context_probes_are_bounded_and_parallel():
    def fast():
        return 8192, {"data": []}

    def slow():
        time.sleep(1.2)
        return 4096, {"data": []}

    started = time.perf_counter()
    result = probe_llm_contexts(
        budget_s=0.3,
        specs=[
            ("fast", "快速探针", fast),
            ("slow", "慢速探针", slow),
        ],
    )
    elapsed = time.perf_counter() - started

    assert elapsed < 0.8
    assert result["fast"]["context_length"] == 8192
    assert result["slow"]["context_length"] is None
    assert "超时" in result["slow"]["message"]
