#!/usr/bin/env python3
"""
Diagnostic: point this at one of the built Propertius shard .db files
(the actual file being served to the browser, under WORKSPACE_DIR/
persverscomp/.../phi0620/phi001/ or wherever the sharded output lands)
and it reports exactly what's in treebank_sentences -- schema, row
counts per book, and a couple of sample rows -- so we're debugging
against real output instead of guessing.

Usage:
    python3 diagnose_treebank.py /path/to/phi0620.phi001.<shard>.db
"""
import sqlite3, sys, json

def main(db_path):
    con = sqlite3.connect(db_path)
    cur = con.cursor()

    print(f"=== {db_path} ===\n")

    # 1) Does the table exist at all, and what's its schema?
    row = cur.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='treebank_sentences'"
    ).fetchone()
    if not row:
        print("✗ treebank_sentences table does NOT exist in this shard file.")
        con.close()
        return
    print("--- CREATE TABLE treebank_sentences ---")
    print(row[0])
    print()

    cols = [r[1] for r in cur.execute("PRAGMA table_info(treebank_sentences)")]
    print("Columns:", cols)
    has_book = "book" in cols
    print("Has 'book' column:", has_book)
    print()

    # 2) Total row count
    total = cur.execute("SELECT COUNT(*) FROM treebank_sentences").fetchone()[0]
    print(f"Total rows in treebank_sentences: {total}")
    if total == 0:
        print("✗ Table exists but is EMPTY -- the bug is upstream (ingestion/routing), not app.js.")
        con.close()
        return

    # 3) Row count by book (if the column exists)
    if has_book:
        print("\n--- Row count by book column ---")
        for bk, n in cur.execute(
            "SELECT book, COUNT(*) FROM treebank_sentences GROUP BY book ORDER BY book"
        ):
            print(f"  book={bk!r}: {n} rows")

    # 4) Row count by chapter (bare) regardless of book column
    print("\n--- Row count by chapter (bare), first 10 ---")
    for ch, n in cur.execute(
        "SELECT chapter, COUNT(*) FROM treebank_sentences GROUP BY chapter ORDER BY chapter LIMIT 10"
    ):
        print(f"  chapter={ch!r}: {n} rows")

    # 5) A few raw sample rows
    print("\n--- Sample rows (subdoc, chapter, section, book" +
          (")" if has_book else " -- NO BOOK COL)"))
    sel = "subdoc, chapter, section" + (", book" if has_book else "")
    for r in cur.execute(f"SELECT {sel} FROM treebank_sentences ORDER BY id LIMIT 8"):
        print(" ", r)

    # 6) Does version_short_id / textgroup / work look right?
    print("\n--- Distinct (textgroup, work, version_short_id) ---")
    for r in cur.execute(
        "SELECT DISTINCT textgroup, work, version_short_id FROM treebank_sentences"
    ):
        print(" ", r)

    con.close()

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1])
