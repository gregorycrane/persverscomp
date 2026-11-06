#!/usr/bin/env python3
"""Build the small work taxonomy used by the Word Explorer.

The search database deliberately contains linguistic search data only.  This
sidecar joins its CTS work identifiers to the prose/poetry and genre metadata
already maintained in treebankstats.  For works not represented there, TEI
structure supplies a conservative prose/poetry fallback: verse lines imply
poetry and paragraph-only bodies imply prose.
"""

from __future__ import annotations

import csv
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


HERE = Path(__file__).resolve().parent
OUTPUT = HERE.parent / "word-dashboard-works.json"
TREEBANK_CSV = Path("/Users/gcrane/github/treebankstats/allauthors.csv")
CORPUS_ROOTS = (
    Path("/Users/gcrane/github/canonical-greekLit/data"),
    Path("/Users/gcrane/github/First1KGreek/data"),
    Path("/Users/gcrane/github/grcnewxml/data"),
    Path("/Users/gcrane/github/NewOpenGreekandLatin/data"),
)

WORK_FILE = re.compile(r"^(?P<textgroup>[^.]+)\.(?P<work>[^.]+)\..+\.xml$")
BODY = re.compile(r"<body\b[\s\S]*?</body\s*>", re.IGNORECASE)
LINE = re.compile(r"<(?:l|lg)\b", re.IGNORECASE)
PARAGRAPH = re.compile(r"<p\b", re.IGNORECASE)


def dominant(values: Counter[str]) -> str | None:
    return values.most_common(1)[0][0] if values else None


def from_treebanks() -> dict[str, dict]:
    if not TREEBANK_CSV.exists():
        return {}
    works: dict[str, dict] = {}
    with TREEBANK_CSV.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.reader(handle)
        header = next(reader)
        positions = {name: header.index(name) for name in ("AuthorTLG", "WorkTLG", "Poetry/Prose", "Genre")}
        for row in reader:
            textgroup = row[positions["AuthorTLG"]].strip()
            work = row[positions["WorkTLG"]].strip()
            if not textgroup or not work or work == "-":
                continue
            key = f"{textgroup}.{work}"
            if key in works:
                continue
            register = row[positions["Poetry/Prose"]].strip().lower()
            genre = row[positions["Genre"]].strip().lower()
            works[key] = {
                "register": register if register in {"poetry", "prose"} else None,
                "genre": genre if genre not in {"", "-", "na"} else None,
                "source": "treebankstats",
            }
    return works


def classify_tei(path: Path) -> str | None:
    try:
        # A structural decision does not require reading a multi-megabyte text.
        with path.open(encoding="utf-8", errors="ignore") as handle:
            text = handle.read(2_000_000)
    except OSError:
        return None
    match = BODY.search(text)
    body = match.group(0) if match else text
    lines = len(LINE.findall(body))
    paragraphs = len(PARAGRAPH.findall(body))
    # Verse quoted inside a prose treatise must not turn the whole work into
    # poetry.  Require verse containers to dominate the body structure.
    if lines and lines >= paragraphs:
        return "poetry"
    if paragraphs:
        return "prose"
    return None


def add_tei_fallback(works: dict[str, dict]) -> None:
    candidates: dict[str, Path] = {}
    for root in CORPUS_ROOTS:
        if not root.exists():
            continue
        for path in root.rglob("*.xml"):
            match = WORK_FILE.match(path.name)
            if match:
                key = f"{match['textgroup']}.{match['work']}"
                # One edition is enough for this coarse structural fallback.
                candidates.setdefault(key, path)
    for key, path in candidates.items():
        if works.get(key, {}).get("register"):
            continue
        register = classify_tei(path)
        if register:
            works.setdefault(key, {}).update(
                register=register,
                genre=works.get(key, {}).get("genre"),
                source="tei-structure",
            )


def main() -> None:
    works = from_treebanks()
    add_tei_fallback(works)
    payload = {
        "schema_version": 1,
        "generated": datetime.now(timezone.utc).isoformat(),
        "method": (
            "Poetry/prose and genre labels come from treebankstats when available; "
            "otherwise TEI verse-line versus paragraph structure supplies only the "
            "coarse poetry/prose label."
        ),
        "works": works,
    }
    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    counts = Counter(item.get("register") or "unknown" for item in works.values())
    print(f"Wrote {OUTPUT}: {len(works):,} works ({dict(counts)})")


if __name__ == "__main__":
    main()
