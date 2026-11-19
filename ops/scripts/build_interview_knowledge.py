"""把 56 道 LLM 扩展题 + 10 道个人项目题合并进 questions.json，并生成 knowledge.json。

可重复执行：按 id 去重，已存在的同 id 题会被扩展数据覆盖。
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from interview_extension_data import (  # noqa: E402
    GROUP,
    GROUP_LABEL,
    QUESTIONS as EXT_QUESTIONS,
)
from interview_knowledge_data import ARTICLES  # noqa: E402
from interview_personal_project_data import (  # noqa: E402
    PERSONAL_ARTICLE,
    PERSONAL_QUESTIONS,
    PERSONAL_RESUME_GROUP,
    PERSONAL_RESUME_LABEL,
)


def main() -> None:
    questions_path = ROOT / "src" / "data" / "interview" / "questions.json"
    bank = json.loads(questions_path.read_text(encoding="utf-8"))

    # 保护原题库：只替换同 id 的扩展题/个人项目题，不碰 B/C/D/项目/补充题。
    ext_ids = {item["id"] for item in EXT_QUESTIONS}
    personal_ids = {item["id"] for item in PERSONAL_QUESTIONS}
    original = [
        item
        for item in bank["questions"]
        if item["id"] not in ext_ids and item["id"] not in personal_ids
    ]
    merged = original + EXT_QUESTIONS + PERSONAL_QUESTIONS

    bank["questions"] = merged
    bank["count"] = len(merged)
    bank.setdefault("groups", {})[GROUP] = GROUP_LABEL
    bank.setdefault("resumeGroups", {})[PERSONAL_RESUME_GROUP] = PERSONAL_RESUME_LABEL
    bank.setdefault("generated_from", [])
    if "interview_extension_data.py" not in bank["generated_from"]:
        bank["generated_from"].append("interview_extension_data.py")
    if "interview_personal_project_data.py" not in bank["generated_from"]:
        bank["generated_from"].append("interview_personal_project_data.py")

    questions_path.write_text(
        json.dumps(bank, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    knowledge_path = ROOT / "src" / "data" / "interview" / "knowledge.json"
    knowledge_articles = [*ARTICLES, PERSONAL_ARTICLE]
    knowledge = {
        "version": 1,
        "generated_from": ["interview_knowledge_data.py", "interview_personal_project_data.py"],
        "count": len(knowledge_articles),
        "articles": knowledge_articles,
    }
    knowledge_path.write_text(
        json.dumps(knowledge, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("questions:", len(merged))
    print("sources:", Counter(item["source"] for item in merged))
    print("groups:", Counter(item["group"] for item in merged))
    print("types:", Counter(item["type"] for item in merged))
    print("articles:", len(knowledge_articles))


if __name__ == "__main__":
    main()
