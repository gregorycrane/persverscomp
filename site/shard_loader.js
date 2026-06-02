
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

// Deterministic: the CTS namespace IS the routing. No catalog lookup needed.
function shardPathFor(textClass, textgroup, work) {
    return `${DATA_DIR}/${textClass}/${textgroup}/${work}/${textgroup}.${work}.db`;
}
function shardPathForWorkKey(workKey) {
    // text_class isn't in the workKey, so use the catalog when available,
    // else fall back to probing greekLit/latinLit.
    const entry = CATALOG && CATALOG.works[workKey];
    const [tg, wk] = workKey.split(".");
    if (entry) return shardPathFor(entry.text_class, tg, wk);
    return null; // caller should resolve via URN (which carries text_class)
}

async function loadCatalog() {
    if (CATALOG) return CATALOG;
    const r = await fetch(`./${DATA_DIR}/../catalog.json`);
    if (!r.ok) throw new Error("catalog.json not found");
    CATALOG = await r.json();
    return CATALOG;
}

// Fetch + open a shard for a work; cached and de-duplicated.
async function getDbForWork(workKey, shardPathHint) {
    if (SHARD_CACHE.has(workKey)) return SHARD_CACHE.get(workKey);
    if (SHARD_INFLIGHT.has(workKey)) return SHARD_INFLIGHT.get(workKey);

    const path = shardPathHint || shardPathForWorkKey(workKey);
    if (!path) throw new Error(`No shard path for ${workKey} (load catalog or pass a URN)`);

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
    const path = shardPathFor(parsed.textClass, parsed.textgroup, parsed.work);
    const db = await getDbForWork(parsed.workKey, path);
    window.dbInstance = db;          // existing text_segments / grid queries now hit the shard
    return { parsed, db };
}

