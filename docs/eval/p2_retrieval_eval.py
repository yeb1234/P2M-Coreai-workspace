import json
import os
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, r"C:\SiteYeb\backend")

from app.services.hybrid_retriever import create_hybrid_retriever
from app.services.rag_chain import RAGChain

CASES_PATH = Path(r"C:\SiteYeb\docs\eval\p2_retrieval_cases.json")
OUT_PATH = Path(r"C:\SiteYeb\docs\eval\p2_retrieval_results.json")


def load_cases():
    payload = json.loads(CASES_PATH.read_text(encoding="utf-8"))
    return payload["cases"]


def title_matches(title: str, patterns: list[str]) -> bool:
    return any(pattern.lower() in title.lower() for pattern in patterns)


def evaluate(mode: str, cases: list[dict]) -> dict:
    rerank_min_score = float(os.getenv("EVAL_MIN_SCORE", "0.10"))
    chain = RAGChain(
        retriever=create_hybrid_retriever(default_limit=6),
        enable_reranker=(mode == "rerank"),
        min_score=(rerank_min_score if mode == "rerank" else 0.0),
    )

    rows = []
    for case in cases:
        started = time.perf_counter()
        docs = chain.search(case["query"], limit=6, intent="search")
        elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        titles = [doc["video_title"] for doc in docs]
        ranks = [index + 1 for index, title in enumerate(titles) if title_matches(title, case["gold_titles"])]
        hit = bool(ranks)
        rank = ranks[0] if ranks else None
        row = {
            "id": case["id"],
            "query": case["query"],
            "hit_at_6": hit,
            "gold_rank": rank,
            "n_refs": len(docs),
            "latency_ms": elapsed_ms,
            "titles": titles,
            "scores": [
                {
                    "title": doc["video_title"],
                    "start_sec": round(float(doc["start_sec"]), 2),
                    "rerank_score": doc.get("rerank_score"),
                    "score_hint": doc.get("score_hint"),
                    "text": doc["text"][:120],
                }
                for doc in docs
            ],
        }
        rows.append(row)
        print(
            f"{case['id']} {mode:7s} hit={str(hit):5s} rank={rank} n={len(docs)} "
            f"{elapsed_ms:7.1f}ms  top1={(titles[0] if titles else '-')[:70]}"
        )

    hit_count = sum(1 for row in rows if row["hit_at_6"])
    mrr = sum((1.0 / row["gold_rank"]) for row in rows if row["gold_rank"]) / len(rows)
    latencies = [row["latency_ms"] for row in rows]
    empty = sum(1 for row in rows if row["n_refs"] == 0)
    summary = {
        "mode": mode,
        "n": len(rows),
        "hit_at_6": hit_count,
        "hit_rate": round(hit_count / len(rows), 4),
        "mrr": round(mrr, 4),
        "empty_refs": empty,
        "latency_ms": {
            "mean": round(statistics.mean(latencies), 1),
            "p50": round(statistics.median(latencies), 1),
            "p95": round(sorted(latencies)[max(0, int(len(latencies) * 0.95) - 1)], 1),
            "min": round(min(latencies), 1),
            "max": round(max(latencies), 1),
        },
        "cases": rows,
    }
    return summary


def main():
    cases = load_cases()
    result = {
        "dataset": str(CASES_PATH),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "config": {
            "top_k": 6,
            "candidate_k": 30,
            "rerank_enabled": True,
            "rerank_min_score": 0.10,
            "vector_coverage": 0.0,
        },
        "lexical": evaluate("lexical", cases),
        "rerank": evaluate("rerank", cases),
    }
    OUT_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\nSUMMARY")
    for mode in ("lexical", "rerank"):
        s = result[mode]
        print(
            f"{mode}: hit@6 {s['hit_at_6']}/{s['n']} ({s['hit_rate']:.1%}), "
            f"MRR {s['mrr']:.3f}, empty {s['empty_refs']}, "
            f"p50 {s['latency_ms']['p50']}ms, p95 {s['latency_ms']['p95']}ms"
        )
    print("written", OUT_PATH)


if __name__ == "__main__":
    main()
