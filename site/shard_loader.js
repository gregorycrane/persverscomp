
// ── Sharded corpus loader ─────────────────────────────────────────────────
// Replaces the single-monolith fetch. Each work lives in its own small SQLite
// shard; we fetch the whole shard (it's small), open it with sql.js, and cache
// it. No httpvfs / Range requests -> runs on any static server, incl. file-less
// local `python -m http.server`, with no header tuning.

let CATALOG = null;
const SHARD_CACHE = new Map();   // workKey -> sql.js Database
const SHARD_INFLIGHT = new Map(); // workKey -> Promise (dedupe concurrent loads)

const DATA_DIR = "data";

// urn:cts:greekLit:tlg0012.tlg001.perseus-grc2:1.10  ->  parts
function parseCtsUrn(urn) {
    const m = /^urn:cts:([^:]+):([^.]+)\.([^.:]+)(?:\.([^:]+))?(?::(.*))?$/.exec(urn || "");
    if (!m) return null;
    return { textClass: m[1], textgroup: m[2], work: m[3],
             version: m[4] || null, passage: m[5] || null,
             workKey: `${m[2]}.${m[3]}` };
}

// FLAT layout: data/<textgroup>/<work>/<tg>.<wk>.db. The path is fully
// determined by the work key alone — no namespace tier, no catalog lookup.
function shardPathFor(textgroup, work) {
    return `${DATA_DIR}/${textgroup}/${work}/${textgroup}.${work}.db`;
}
function shardPathForWorkKey(workKey) {
    const [tg, wk] = workKey.split(".");
    return shardPathFor(tg, wk);
}

async function loadCatalog() {
    if (CATALOG) return CATALOG;
    // catalog.json is tiny and must always be fresh: bypass the HTTP cache so a
    // rebuild's new sizes/versions show up without a manual hard-refresh.
    const r = await fetch(`./${DATA_DIR}/../catalog.json?v=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error("catalog.json not found");
    CATALOG = await r.json();
    return CATALOG;
}

// Fetch + open a shard for a work; cached and de-duplicated.
async function getDbForWork(workKey, shardPathHint) {
    if (SHARD_CACHE.has(workKey)) return SHARD_CACHE.get(workKey);
    if (SHARD_INFLIGHT.has(workKey)) return SHARD_INFLIGHT.get(workKey);

    const path = shardPathHint || shardPathForWorkKey(workKey);

    const p = (async () => {
        const resp = await fetch(`./${path}`);
        if (!resp.ok) throw new Error(`Shard not found: ${path}`);
        const buf = new Uint8Array(await resp.arrayBuffer());
        const db = new window.SQL_WASM_ENGINE.Database(buf);
        SHARD_CACHE.set(workKey, db);
        SHARD_INFLIGHT.delete(workKey);
        return db;
    })();
    SHARD_INFLIGHT.set(workKey, p);
    return p;
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
        "SELECT subdoc, chapter, section, sentence_json, prose_translation, literal_translation " +
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

// ── Entry point: deep-link routing ─────────────────────────────────────────
async function routeToUrn(urn) {
    const parsed = parseCtsUrn(urn);
    if (!parsed) throw new Error("Unparseable CTS URN: " + urn);
    const path = shardPathFor(parsed.textgroup, parsed.work);
    const db = await getDbForWork(parsed.workKey, path);
    window.dbInstance = db;          // existing text_segments / grid queries now hit the shard
    return { parsed, db };
}

