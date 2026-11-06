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

## Work taxonomy sidecar

The core search index does not currently store genre.  The dashboard therefore
loads `word-dashboard-works.json` and joins it to `documents.base_urn` at the
CTS work level (`textgroup.work`).  Rebuild the sidecar with:

```sh
python3 tools/build_word_dashboard_metadata.py
```

The builder gives priority to the existing `Poetry/Prose` and `Genre` columns
in `treebankstats/allauthors.csv`.  For works absent there, it assigns only the
coarse prose/poetry class from TEI body structure: sustained `<l>`/`<lg>` markup
is poetry and paragraph-only markup is prose.  The sidecar retains the source of
each assignment, so a later controlled vocabulary (epic, drama, history,
oratory, and so on) can replace the fallback without changing dashboard query
code.

Rates use `documents.n_words` as their denominators and `lemma_doc_counts.n` as
their numerators.  Multiple indexed editions remain separate documents; this is
a frequency in the published index, not a deduplicated author corpus.

## Paradigms and principal parts

The paradigm is computed from `lemma_postings` joined to `forms` and `feats`.
Cells preserve the tagger's UPOS and UD feature bundles.  This is why one
surface form can appear under several analyses: the display reports corpus
assignments rather than treating an analyzer's possible parses as observed.

`word-dashboard-principal-parts.json` is a small, source-attributed dictionary
layer.  Principal parts must not be inferred by selecting frequent corpus
forms: they are canonical first-person head-forms, and suppletive verbs require
lexical evidence.  The dashboard combines those curated forms with the number
of distinct tagged surface forms assigned to each principal part's tense/voice
system.  This measures the attested paradigm supplied by the principal part,
not occurrences of the dictionary head-form.  New entries can be added without
changing JavaScript.

For responsive HTTP-range queries the interactive paradigm resolves the 120
most frequent form/feature groups.  Exact total counts and distinct-group
counts still cover the complete lemma.  A future index can remove this display
cap by adding a clustered `lemma_morphology` aggregate keyed by `lemma_id`.

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
