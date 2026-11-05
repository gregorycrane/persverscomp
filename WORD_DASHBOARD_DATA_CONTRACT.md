# Word Explorer data contract

The Word Explorer reads the content-addressed `search-*.db` and `manifest.json`
produced by `PerseusDLCode/tokenization_pipeline` (`mvp-index`). It uses the core
schema directly: `documents`, `chunks`, `chunk_context`, `forms`, `lemmas`,
`feats`, `lemma_postings`, and `lemma_doc_counts`.

The static site expects the index at `./search-index/` by default. A deployment
can set `window.PMV_WORD_INDEX_URL` before `word-dashboard.js` loads, or use an
`?index=https://example.org/search-index/` query parameter. The index host must
allow byte-range requests and, for a different origin, CORS.

The production beta index is deliberately not hard-coded as the fallback: at
the time of this integration it serves byte ranges but no
`Access-Control-Allow-Origin` header. A GitHub Pages or localhost dashboard
must therefore use a same-origin mount/reverse proxy, or the beta nginx
configuration must first enable CORS for `/search-index/`.

For local PMV development, run `python3 serve_local.py` from this repository.
It exposes a range-preserving search-index proxy on port 8001. A viewer served
at `localhost:8000` detects that companion automatically. The helper also
serves the viewer itself at `localhost:8001`, so either address can be used.
Only the small portions of the production database needed by each query are
transferred.

## Optional syntax capability

The syntax panel remains hidden unless the database contains this aggregate
table:

```sql
CREATE TABLE lemma_syntax (
  lemma_id INTEGER NOT NULL,
  corpus TEXT,                    -- NULL means corpus-independent
  relation TEXT,
  head_lemma TEXT,
  dependent_lemma TEXT,
  n INTEGER NOT NULL
);
CREATE INDEX lemma_syntax_lemma ON lemma_syntax (lemma_id);
```

Each row contributes `n` observations. A row can populate any combination of
relation, governing lemma, and dependent lemma. This deliberately keeps the
current non-parsed release from implying that morphology is syntax.

## Optional gloss capability

The gloss panel remains hidden unless the database contains:

```sql
CREATE TABLE lemma_glosses (
  lemma_id INTEGER NOT NULL,
  corpus TEXT,                    -- NULL means corpus-independent
  gloss TEXT NOT NULL,
  source TEXT NOT NULL,
  n INTEGER NOT NULL
);
CREATE INDEX lemma_glosses_lemma ON lemma_glosses (lemma_id);
```

Glosses are displayed with source attribution and described as evidence, not
as asserted one-to-one senses. Adding either optional table to a future index
is sufficient to reveal its panel; no HTML change is required.
