"""只读查看向量版本分布。不会重建、不会改库。

用法：
    python scripts/vector_version_report.py
    python scripts/vector_version_report.py --json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402
from app.services.embedding_pipeline import status  # noqa: E402
from app.services.vector_version import (  # noqa: E402
    VECTOR_VERSION,
    version_components_text,
    version_manifest,
)


def _version_distribution() -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT vector_version,
                       count(*) AS chunks,
                       count(*) FILTER (WHERE embedding IS NULL) AS missing_vectors
                FROM content_chunks
                GROUP BY vector_version
                ORDER BY chunks DESC
                """
            )
        ).fetchall()
    return [
        {
            "vector_version": r[0],
            "chunks": int(r[1] or 0),
            "missing_vectors": int(r[2] or 0),
        }
        for r in rows
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="查看向量版本分布")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    report = {
        "current_version": VECTOR_VERSION,
        "definition": version_components_text(),
        "manifest": version_manifest(),
        "status": status(),
        "distributions": _version_distribution(),
    }
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0

    print(f"当前版本: {report['definition']}")
    print(f"版本清单: {json.dumps(report['manifest'], ensure_ascii=False)}")
    print(f"总块数: {report['status']['chunks']:,} | "
          f"当前版本: {report['status']['chunks_current_version']:,} | "
          f"旧版本: {report['status']['chunks_stale_version']:,} | "
          f"缺向量: {report['status']['chunks_missing_vectors']:,}")
    print("版本分布:")
    for item in report["distributions"]:
        print(
            f"  {item['vector_version']}: {item['chunks']:,} 块，"
            f"缺向量 {item['missing_vectors']:,}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
