"""Build the interview book reader data from the three source PDFs.

Outputs are static assets under public/interview-books so the frontend can
fetch a single book on demand instead of shipping 600 pages in the main bundle.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "interview-books"
OUT = ROOT / "public" / "interview-books"

BOOKS = [
    {
        "id": "B",
        "file": "B-AI-Agent应用开发宝典-解析分册.pdf",
        "title": "AI Agent 应用开发宝典",
        "subtitle": "解析分册 · 26 章 / 34 道题 / 10 张清单",
        "kind": "question",
    },
    {
        "id": "C",
        "file": "C-AI-Agent后端九件套-学习教辅.pdf",
        "title": "AI Agent 后端九件套",
        "subtitle": "学习教辅 · 20 章 / 151 问 / 64 份代码",
        "kind": "backend",
    },
    {
        "id": "D",
        "file": "D-后端工程学习宝典.pdf",
        "title": "后端工程学习宝典",
        "subtitle": "12 篇 / 53 节 / 3 附录 · 面向 AI Agent 应用开发",
        "kind": "backend",
    },
]


def clean_page(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\x00", "")
    # Drop repeated running headers/footers that only add noise in a reader.
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            lines.append("")
            continue
        if re.fullmatch(r"\d{1,3}", stripped):
            continue
        if re.match(r"^AI AGENT (APPLICATION|BACKEND) HANDBOOK", stripped):
            continue
        if re.match(r"^后端工程学习宝典\s*[｜|]\s*第\s*\d+\s*页", stripped):
            continue
        if re.match(r"^\s*\d{1,3}\s+[·・]\s*(总览|FastAPI|PostgreSQL|pgvector|Milvus|MongoDB|Redis|Celery|RabbitMQ|Kafka|LLM|MCP)", stripped):
            continue
        lines.append(line.rstrip())
    return "\n".join(lines).strip()


def norm(text: str) -> str:
    return re.sub(r"\s+", "", text)


def parse_toc(text: str) -> list[dict]:
    """Parse the numbered contents block at the beginning of B/C."""
    out = []
    for line in text[:5000].splitlines():
        m = re.match(r"^\s*(\d{2})\s+(.+?)\s+(\d+)\s*$", line)
        if not m:
            continue
        num, raw_title, page = m.groups()
        title = re.split(r"\s{2,}", raw_title.strip())[0].strip()
        # Strip a trailing count/notes token if it is separated by a single space.
        title = re.sub(r"\s+(?:\d+\s*(?:题|节|个项目|例|张清单)|速成|全景|治理|基线).*$", "", title).strip()
        out.append({"id": num, "title": title, "printed_page": int(page)})
    return out


def locate_toc_pages(pages: list[dict], toc: list[dict]) -> list[dict]:
    """Use the printed page first, then verify by searching the page text."""
    result = []
    for item in toc:
        title = item["title"]
        wanted = item["printed_page"]
        found = None
        for page in pages:
            if page["n"] < wanted:
                continue
            needle = norm(title)[:10]
            if needle and needle in norm(page["text"]):
                found = page["n"]
                break
        page_no = found or wanted
        result.append({**item, "page": page_no})
    return result


def parse_d_toc(raw_text: str) -> list[dict]:
    """D is a section-based handbook; its contents page is two-column and noisy.

    The body headings are regular (``D13 关系型数据库与事务（ACID） P0``), so use
    those as the authoritative table of contents and keep the page where each
    heading first appears in the body.
    """
    matches = list(re.finditer(r"(?m)^\s*(D\d{2})\s+(.*)$", raw_text))
    body_start = next(
        (
            m.start()
            for m in matches
            if m.group(1) == "D00"
            and "后端工程全景" in m.group(2)
            and raw_text[: m.start()].count("\f") + 1 >= 5
        ),
        None,
    )
    if body_start is None:
        return []
    body = [m for m in matches if m.start() >= body_start]
    out = []
    seen = set()
    for match in body:
        code = match.group(1)
        if code in seen:
            continue
        seen.add(code)
        raw_title = re.sub(r"^P[01]\s+", "", match.group(2).strip())
        title = re.split(r"\s{2,}", raw_title)[0].strip()
        title = re.sub(r"\s+P[01]\s*$", "", title).strip()
        if not title:
            continue
        page = raw_text[: match.start()].count("\f") + 1
        out.append({"id": code, "title": title, "page": page})
        if code == "D52":
            break
    return out


def build_book(spec: dict) -> dict:
    pdf_path = SRC / spec["file"]
    raw_pages = []
    with pymupdf.open(pdf_path) as doc:
        pages = []
        for number, page in enumerate(doc, start=1):
            text = clean_page(page.get_text("text", sort=True))
            pages.append({"n": number, "text": text})
            raw_pages.append(page.get_text("text", sort=True))
    raw_text = "\f\n".join(raw_pages)
    if spec["id"] == "D":
        toc = parse_d_toc(raw_text)
    else:
        toc = parse_toc("\n".join(page["text"] for page in pages[:8]))
        toc = locate_toc_pages(pages, toc)
    return {
        "id": spec["id"],
        "title": spec["title"],
        "subtitle": spec["subtitle"],
        "kind": spec["kind"],
        "page_count": len(pages),
        "toc": toc,
        "pages": pages,
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    for spec in BOOKS:
        book = build_book(spec)
        path = OUT / f"{spec['id']}.json"
        path.write_text(json.dumps(book, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        index.append(
            {
                "id": spec["id"],
                "title": spec["title"],
                "subtitle": spec["subtitle"],
                "kind": spec["kind"],
                "page_count": book["page_count"],
                "toc_count": len(book["toc"]),
                "file": f"/interview-books/{spec['id']}.json",
            }
        )
        print(f"{spec['id']}: {book['page_count']} pages, {len(book['toc'])} toc entries -> {path}")
    (OUT / "index.json").write_text(
        json.dumps({"books": index}, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
