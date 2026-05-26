#!/usr/bin/env python3
"""Parse the two source .md files into data.js for the SPA."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
QUESTIONS_MD = ROOT / "Ответы_на_вопросы_сессия_МО_СППР.md"
THEORY_MD = ROOT / "Конспект_методичка_безусловная_оптимизация.md"
OUTPUT = ROOT / "data.js"


def normalize_math(text: str) -> str:
    """The source has two flavours of double-wrapped inline math:
       (a) $\\(...\\)$  — dollars OUTSIDE backslash-parens
       (b) \\($...$\\)  — backslash-parens OUTSIDE dollars
    Both collapse to plain $...$ so KaTeX gets a single layer of delimiters."""
    # (a) strip inner \( and \) when they're inside $...$
    text = re.sub(r"\$\\\(", "$", text)
    text = re.sub(r"\\\)\$", "$", text)
    # (b) strip outer \( and \) when they wrap $...$
    text = re.sub(r"\\\(\$", "$", text)
    text = re.sub(r"\$\\\)", "$", text)
    return text


def parse_questions(content: str):
    """Split the answers file by ## N. headings."""
    lines = content.split("\n")
    questions = []
    current = None
    header_re = re.compile(r"^##\s+(\d+)\.\s*(.+?)\s*$")

    for line in lines:
        m = header_re.match(line)
        if m:
            if current:
                current["content"] = current["content"].strip()
                questions.append(current)
            current = {
                "id": int(m.group(1)),
                "title": m.group(2).strip(),
                "content": "",
            }
        elif current is not None:
            current["content"] += line + "\n"

    if current:
        current["content"] = current["content"].strip()
        questions.append(current)

    return questions


def extract_keywords(q):
    """Tiny keyword set per question for search (title words)."""
    words = re.findall(r"[А-Яа-яA-Za-z]{4,}", q["title"].lower())
    return list(dict.fromkeys(words))


def main():
    questions_raw = QUESTIONS_MD.read_text(encoding="utf-8")
    theory_raw = THEORY_MD.read_text(encoding="utf-8")

    questions_norm = normalize_math(questions_raw)
    theory_norm = normalize_math(theory_raw)

    questions = parse_questions(questions_norm)
    for q in questions:
        q["keywords"] = extract_keywords(q)

    data = {
        "questions": questions,
        "theory": theory_norm,
        "meta": {
            "course": "Математическое обеспечение СППР",
            "total": len(questions),
        },
    }

    OUTPUT.write_text(
        "window.APP_DATA = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT} with {len(questions)} questions, theory {len(theory_norm)} chars")


if __name__ == "__main__":
    main()
