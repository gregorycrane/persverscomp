// ── Sharded corpus loader ─────────────────────────────────────────────────
// Replaces the single-monolith fetch. Each work lives in its own small SQLite
// shard; we fetch the whole shard (it's small), open it with sql.js, and cache
// it. No httpvfs / Range requests -> runs on any static server, incl. file-less
// local `python -m http.server`, with no header tuning.

let CATALOG = null;
const SHARD_CACHE = new Map();   // workKey -> sql.js Database
const SHARD_INFLIGHT = new Map(); // workKey -> Promise (dedupe concurrent loads)

const DATA_DIR = "site/data";

// ── Author-level lexica (Cunliffe, Dindorf, ...) ───────────────────────────
// Separate from the work-shard cache above: lexica are keyed by shard FILE
// (a shard can bundle several lexicon_ids, e.g. Cunliffe words + names),
// not by work, and are loaded lazily on first token click rather than
// eagerly with the work.
let LEXICA_CATALOG = null;
const LEXICON_SHARD_CACHE = new Map();    // shardFile -> sql.js Database
const LEXICON_SHARD_INFLIGHT = new Map(); // shardFile -> Promise

// Top-level copy of escHtml -- the lexicon functions below live at module
// scope, but the existing escHtml() is nested inside renderTreebankColumn()
// and isn't reachable from here. Same implementation, kept in sync.
function escHtmlTopLevel(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function loadLexicaCatalog() {
    if (LEXICA_CATALOG) return LEXICA_CATALOG;
    try {
        const r = await fetch(`./site/lexica.json?v=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) throw new Error("lexica.json not found");
        LEXICA_CATALOG = await r.json();
    } catch (e) {
        console.warn("[lexica] no lexica.json (no lexica configured for this build):", e.message);
        LEXICA_CATALOG = { lexica: {}, textgroups: {} };
    }
    return LEXICA_CATALOG;
}

// Which lexicon_ids apply to a textgroup, each with its shard file + display meta.
async function lexiconsForTextgroup(textgroup) {
    const catalog = await loadLexicaCatalog();
    const ids = catalog.textgroups[textgroup] || [];
    return ids.map(id => ({ lexicon_id: id, ...catalog.lexica[id] }));
}

async function getLexiconShard(shardFile) {
    if (LEXICON_SHARD_CACHE.has(shardFile)) return LEXICON_SHARD_CACHE.get(shardFile);
    if (LEXICON_SHARD_INFLIGHT.has(shardFile)) return LEXICON_SHARD_INFLIGHT.get(shardFile);

    const p = (async () => {
        const resp = await fetch(`./site/data/lexica/${shardFile}`);
        if (!resp.ok) throw new Error(`Lexicon shard not found: ${shardFile}`);
        const buf = new Uint8Array(await resp.arrayBuffer());
        const db = new window.SQL_WASM_ENGINE.Database(buf);
        LEXICON_SHARD_CACHE.set(shardFile, db);
        LEXICON_SHARD_INFLIGHT.delete(shardFile);
        return db;
    })();
    LEXICON_SHARD_INFLIGHT.set(shardFile, p);
    return p;
}

// Same accent/case-folding logic as the notebook's norm_key() (Cell 1b/1c) --
// MUST be kept in sync so a token's lemma and a lexicon's headword_key are
// directly comparable. Strips Greek polytonic diacritics (combining marks),
// folds final sigma, lowercases.
function normalizeHeadwordKey(s) {
    if (!s) return null;
    let t = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    t = t.normalize('NFC').toLowerCase();
    t = t.replace(/\u03c2/g, '\u03c3'); // final sigma -> medial sigma
    return t;
}

// Looks up one lexicon's entries for a normalized headword key, resolving
// through lexicon_aliases first (covers "see X" pointer entries) so a hit
// on an alias returns the fuller target entry instead of a stub.
function lookupLexiconEntries(db, lexiconId, headwordKey) {
    if (!headwordKey) return [];
    const direct = queryAll(db,
        "SELECT entry_id, headword_display, headword_translit, entry_html FROM lexicon_entries " +
        "WHERE lexicon_id=? AND headword_key=?", [lexiconId, headwordKey]);
    if (direct.length) return direct;
    const aliasHit = queryAll(db,
        "SELECT entry_id FROM lexicon_aliases WHERE lexicon_id=? AND alias_key=?",
        [lexiconId, headwordKey]);
    if (aliasHit.length) {
        const ids = aliasHit.map(r => r.entry_id);
        const placeholders = ids.map(() => "?").join(",");
        return queryAll(db,
            `SELECT entry_id, headword_display, headword_translit, entry_html FROM lexicon_entries ` +
            `WHERE lexicon_id=? AND entry_id IN (${placeholders})`, [lexiconId, ...ids]);
    }
    return [];
}

function lookupLexiconEntryById(db, lexiconId, entryId) {
    const rows = queryAll(db,
        "SELECT entry_id, headword_display, headword_translit, entry_html FROM lexicon_entries " +
        "WHERE lexicon_id=? AND entry_id=?", [lexiconId, entryId]);
    return rows[0] || null;
}

function _tbHeadwordScriptClass(s) {
    // Arabic/Persian script range -- gets RTL + Perso-Arabic font styling
    // instead of the Greek serif used for Cunliffe/Dindorf headwords.
    return /[\u0600-\u06FF]/.test(s || '') ? 'tb-lex-fa' : 'tb-greek';
}

function renderLexiconBlock(lexMeta, entryRows) {
    if (!entryRows.length) {
        return `<div class="tb-lex-empty">No entry in ${escHtmlTopLevel(lexMeta.title)}</div>`;
    }
    const body = entryRows.map(row => {
        const scriptCls = _tbHeadwordScriptClass(row.headword_display);
        const translit = row.headword_translit
            ? ` <span class="tb-lex-headword-translit">${escHtmlTopLevel(row.headword_translit)}</span>`
            : '';
        return `
        <div class="tb-lex-headword ${scriptCls}">${escHtmlTopLevel(row.headword_display)}${translit}</div>
        <div class="tb-lex-body">${row.entry_html}</div>
    `;
    }).join('<div class="tb-lex-divider"></div>');

    // Some lexica (e.g. Bétant's Lexicon Thucydideum) give definitions in
    // Latin with an added English translation alongside; most don't. Rather
    // than a permanent global toolbar toggle that's meaningless for every
    // other lexicon, show "Hide Latin" only on the entries where it applies,
    // right next to the source label it affects. The preference itself is
    // still global (see toggleLexiconLatin), so flipping it here also
    // updates any other Latin-bearing lexicon block currently on screen.
    const hasLatin = entryRows.some(row => row.entry_html && row.entry_html.includes('tb-lex-lat'));
    const latinToggle = hasLatin
        ? `<label class="tb-lex-latin-toggle-label" title="Bétant's Lexicon Thucydideum gives definitions in Latin with an added English translation alongside">
             <input type="checkbox" class="tb-lex-latin-toggle" ${localStorage.getItem(LEXICON_LATIN_PREF_KEY) === '1' ? 'checked' : ''} onchange="toggleLexiconLatin(this.checked)">
             Hide Latin
           </label>`
        : '';

    return `
        <div class="tb-lex-entry">
            <div class="tb-lex-source">${escHtmlTopLevel(lexMeta.title)}${latinToggle}</div>
            ${body}
        </div>`;
}

// Called after the base detail panel (gloss/lemma/morph) is already shown,
// so the dictionary lookup never blocks the synchronous part of the panel.
// `slot` is an empty <div> already in the DOM; this fills it in place once
// the relevant shard(s) have loaded, tolerating a work with no configured
// lexica (slot just stays empty, nothing printed).
async function populateLexiconSlot(slot, tok, textgroup) {
    const lexica = await lexiconsForTextgroup(textgroup);
    if (!lexica.length) return;

    const key = normalizeHeadwordKey(tok.lemma && tok.lemma !== '_' ? tok.lemma : tok.form);
    if (!key) return;

    // Proper-name tokens check the names lexicon (if any) first, so a
    // homograph between a common word and a name resolves to the more
    // relevant one when both exist.
    const ordered = tok.upos === 'PROPN'
        ? [...lexica].sort((a, b) => (a.entry_kind === 'name' ? -1 : 1))
        : lexica;

    let html = '';
    for (const lex of ordered) {
        try {
            const db = await getLexiconShard(lex.shard);
            const rows = lookupLexiconEntries(db, lex.lexicon_id, key);
            if (rows.length) html += renderLexiconBlock(lex, rows);
        } catch (e) {
            console.warn(`[lexica] lookup failed for ${lex.lexicon_id}:`, e);
        }
    }
    if (html) slot.innerHTML = html;
    // If nothing at all was found across every configured lexicon, the slot
    // is left empty rather than printing an empty-state per lexicon --
    // quieter for the common case of function words with no dictionary entry.
}

// Global so it can be called from onclick="" attributes baked into
// entry_html at build time (see notebook Cell 1c's _lex_inline_html).
async function openLexiconEntry(lexiconId, entryId) {
    const catalog = await loadLexicaCatalog();
    const lexMeta = catalog.lexica[lexiconId];
    if (!lexMeta) { console.warn(`[lexica] unknown lexicon_id: ${lexiconId}`); return; }
    try {
        const db = await getLexiconShard(lexMeta.shard);
        const row = lookupLexiconEntryById(db, lexiconId, entryId);
        if (!row) { console.warn(`[lexica] entry not found: ${lexiconId}/${entryId}`); return; }
        const panel = document.querySelector('.tb-detail-panel.tb-detail-visible .tb-lex-slot')
                   || document.querySelector('.tb-detail-panel.tb-detail-visible');
        if (panel) {
            panel.innerHTML = renderLexiconBlock(lexMeta, [row]);
            panel.scrollIntoView({ block: "nearest" });
        }
    } catch (e) {
        console.warn(`[lexica] openLexiconEntry failed:`, e);
    }
}
window.openLexiconEntry = openLexiconEntry;

// ── Lexicon language display toggle (e.g. Bétant's Latin defs + added ───
// English translations) ─────────────────────────────────────────────────
// A global reader preference, not per-panel: entries render both
// <gloss xml:lang="lat"> and <gloss xml:lang="eng"> every time (tagged
// with tb-lex-lat / tb-lex-eng classes by the notebook's _lex_inline_html),
// and this just flips a body-level class that CSS uses to hide one side.
// Persisted across sessions the same way column count / layout mode would
// be if this app tracked those in storage.
const LEXICON_LATIN_PREF_KEY = 'persvers_hideLexiconLatin';

function applyLexiconLatinPref() {
    const hidden = localStorage.getItem(LEXICON_LATIN_PREF_KEY) === '1';
    document.body.classList.toggle('lexicon-hide-latin', hidden);
    document.querySelectorAll('.tb-lex-latin-toggle').forEach(cb => { cb.checked = hidden; });
}

function toggleLexiconLatin(hidden) {
    localStorage.setItem(LEXICON_LATIN_PREF_KEY, hidden ? '1' : '0');
    document.body.classList.toggle('lexicon-hide-latin', hidden);
    document.querySelectorAll('.tb-lex-latin-toggle').forEach(cb => { cb.checked = hidden; });
}
window.toggleLexiconLatin = toggleLexiconLatin;

// urn:cts:greekLit:tlg0012.tlg001.perseus-grc2:1.10  ->  parts
function parseCtsUrn(urn) {
    const m = /^urn:cts:([^:]+):([^.]+)\.([^.:]+)(?:\.([^:]+))?(?::(.*))?$/.exec(urn || "");
    if (!m) return null;
    const passage = m[5] || null;
    // Passage may be a range ("1.4-1.7") rather than a single ref ("1.4").
    // startRef/endRef are equal when there's no range, so callers that want
    // a single passage can just always use startRef.
    const [startRef, endRefRaw] = passage ? passage.split('-') : [null, null];
    return { textClass: m[1], textgroup: m[2], work: m[3],
             version: m[4] || null, passage,
             startRef, endRef: endRefRaw || startRef,
             workKey: `${m[2]}.${m[3]}` };
}

// FLAT layout: data/<textgroup>/<work>/<tg>.<wk>.part1.db. This is now only a
// last-resort GUESS used if catalog.json can't be reached at all — the real
// source of truth for which file(s) make up a work is catalog.json's
// per-work `parts` list (see shardPartPathsForWorkKey below), since a large
// work may be split into several book-range parts to stay under GitHub's
// 100MB per-file limit.
function shardPathFor(textgroup, work) {
    return `${DATA_DIR}/${textgroup}/${work}/${textgroup}.${work}.part1.db`;
}
function shardPathForWorkKey(workKey) {
    const [tg, wk] = workKey.split(".");
    return shardPathFor(tg, wk);
}

async function loadCatalog() {
    if (CATALOG) return CATALOG;
    const r = await fetch(`./site/catalog.json?v=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error("catalog.json not found");
    CATALOG = await r.json();
    return CATALOG;
}

// Every work's shard files, in order, from catalog.json's `parts` list.
// Falls back to a single guessed path if the catalog can't be read at all
// or doesn't have this work's parts recorded (e.g. a stale catalog.json).
async function shardPartPathsForWorkKey(workKey, shardPathHint) {
    try {
        const catalog = await loadCatalog();
        const meta = catalog.works && catalog.works[workKey];
        if (meta && Array.isArray(meta.parts) && meta.parts.length) {
            const [tg, wk] = workKey.split(".");
            return meta.parts.map(p => `${DATA_DIR}/${tg}/${wk}/${p.file}`);
        }
    } catch (e) {
        console.warn(`Could not read catalog.json parts for ${workKey}, falling back to a guessed path:`, e);
    }
    return [shardPathHint || shardPathForWorkKey(workKey)];
}

// Fetch + open a shard for a work; cached and de-duplicated. If the work is
// split into multiple book-range parts, every part is fetched and merged
// into a single in-memory database before being cached/returned, so the
// rest of the app (treebankForChapter, alignmentsForPair, etc.) keeps
// working against one `db` handle exactly as it did before any work was
// ever split into multiple files on disk — the split is invisible past
// this point.
async function getDbForWork(workKey, shardPathHint) {
    if (SHARD_CACHE.has(workKey)) return SHARD_CACHE.get(workKey);
    if (SHARD_INFLIGHT.has(workKey)) return SHARD_INFLIGHT.get(workKey);

    const p = (async () => {
        const partPaths = await shardPartPathsForWorkKey(workKey, shardPathHint);
        const db = await loadAndMergeParts(partPaths);
        SHARD_CACHE.set(workKey, db);
        SHARD_INFLIGHT.delete(workKey);
        return db;
    })();
    SHARD_INFLIGHT.set(workKey, p);
    return p;
}

// Fetches every part file's bytes and merges them into one in-memory
// sql.js Database (the first part becomes the primary connection; the rest
// are merged into it, then closed). A single-part work just opens normally.
async function loadAndMergeParts(partPaths) {
    const buffers = await Promise.all(partPaths.map(async path => {
        const resp = await fetch(`./${path}`);
        if (!resp.ok) throw new Error(`Shard part not found: ${path}`);
        return new Uint8Array(await resp.arrayBuffer());
    }));

    const primary = new window.SQL_WASM_ENGINE.Database(buffers[0]);
    if (buffers.length > 1) {
        primary.exec("BEGIN TRANSACTION");
        try {
            for (let i = 1; i < buffers.length; i++) {
                const part = new window.SQL_WASM_ENGINE.Database(buffers[i]);
                mergePartInto(primary, part);
                part.close();
            }
            primary.exec("COMMIT");
        } catch (e) {
            primary.exec("ROLLBACK");
            throw e;
        }
    }
    return primary;
}

// Copies every row of every table in `part` into `primary`, keeping each
// row's ORIGINAL id. The notebook's sharder always inserts the full column
// list (id included) when writing a part, so autoincrement never
// reassigns a value there — every row's id is inherited straight from the
// shared monolith, never reassigned per part. That makes a single
// INSERT OR IGNORE correct and sufficient for every table:
//  - Partitioned tables (alignment_grid, text_segments, treebank_sentences,
//    treebank_tokens, metrical_lines) have disjoint ids between parts
//    (each part only holds its own book range's rows), so every row from
//    `part` just gets added.
//  - Wholesale tables (text_units, treebank_speakers, token_alignments,
//    edition_line_alignments) are byte-identical copies of the same source
//    rows in every part, WITH THE SAME ids — so INSERT OR IGNORE correctly
//    dedupes them instead of creating duplicates.
// (Verified against real generated part files before shipping this.)
function mergePartInto(primary, part) {
    const tables = queryAll(part, "SELECT name FROM sqlite_master WHERE type='table'").map(r => r.name);
    for (const table of tables) {
        const rows = queryAll(part, `SELECT * FROM ${table}`);
        if (rows.length === 0) continue;
        const cols = Object.keys(rows[0]);
        const stmt = primary.prepare(
            `INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`);
        for (const row of rows) stmt.run(cols.map(c => row[c]));
        stmt.free();
    }
}


// Optional memory hygiene for long sessions / "own machine" use.
function evictWorkExcept(keepWorkKey) {
    for (const [k, db] of SHARD_CACHE) {
        if (k !== keepWorkKey) { try { db.close(); } catch (e) {} SHARD_CACHE.delete(k); }
    }
}

// ── Per-work data access (replaces the inlined *_REPLACE globals) ──────────
// These read from the loaded shard instead of giant in-HTML JSON blobs.
function queryAll(db, sql, params = []) {
    const out = []; const st = db.prepare(sql); st.bind(params);
    while (st.step()) out.push(st.getAsObject());
    st.free(); return out;
}
function registryForWork(db) {
    return queryAll(db, "SELECT short_id, urn, label, doc_type, text_class FROM text_units ORDER BY doc_type, short_id");
}
function treebankForChapter(db, version, chapter) {
    return queryAll(db,
        "SELECT subdoc, chapter, section, sentence_json, prose_translation, literal_translation, transliteration " +
        "FROM treebank_sentences WHERE version_short_id=? AND chapter=? ORDER BY id",
        [version, chapter]);
}
function alignmentsForPair(db, pairId, segment) {
    return queryAll(db,
        "SELECT src_indices, tgt_indices, src_tokens, tgt_tokens, score " +
        "FROM token_alignments WHERE pair_id=? AND segment=?", [pairId, segment]);
}
function metricalForChapter(db, version, chapter) {
    return queryAll(db,
        "SELECT line_ref, line_json FROM metrical_lines WHERE version_short_id=? AND chapter=?",
        [version, chapter]);
}
// Places attested in a given chapter, sourced from ToposText's place-mention
// index (see the place_references ingestion cell). Unlike treebank/metrical
// data, this isn't per-edition -- a work has one place index regardless of
// which translation/edition column is showing -- so there's no version_id
// filter, just chapter. Returns one row per (mention, place) pair; the same
// place can legitimately appear more than once if it's mentioned more than
// once in the same chapter (e.g. "Athens" named twice in one paragraph) --
// callers that want one pin per place should de-duplicate by place_id.
function placesForChapter(db, chapter) {
    return queryAll(db,
        "SELECT mention_type, mention_name, place_id, place_name, lat, lon, feature_type, chapter " +
        "FROM place_references WHERE chapter=?",
        [chapter]);
}
// All places attested anywhere in a given book, for multi-book works
// whose chapter column is the folded "book.chapter" string (e.g.
// Thucydides' "3.5", "3.100"). A book is every row whose chapter is
// either exactly the book number alone (rare, but possible for a
// book-level-only citation) or starts with "<book>." -- the LIKE
// pattern is anchored at the start of the string, so book "3" can
// never accidentally match "13.5" or similar.
function placesForBook(db, book) {
    return queryAll(db,
        "SELECT mention_type, mention_name, place_id, place_name, lat, lon, feature_type, chapter " +
        "FROM place_references WHERE chapter=? OR chapter LIKE ?",
        [book, `${book}.%`]);
}
// Every place attested anywhere in the work, for bookless works (e.g.
// Agamemnon) where there's no book to scope to -- the natural "show
// everything" equivalent of placesForBook for a flat-structured text.
function placesForWork(db) {
    return queryAll(db,
        "SELECT mention_type, mention_name, place_id, place_name, lat, lon, feature_type, chapter " +
        "FROM place_references");
}

// ── Entry point: deep-link routing ─────────────────────────────────────────
async function routeToUrn(urn) {
    const parsed = parseCtsUrn(urn);
    if (!parsed) throw new Error("Unparseable CTS URN: " + urn);
    const path = shardPathFor(parsed.textgroup, parsed.work);
    const db = await getDbForWork(parsed.workKey, path);
    window.dbInstance = db;          // existing text_segments / grid queries now hit the shard
    return { parsed, db };
}


    // ── End shard_loader ──────────────────────────────────────────
