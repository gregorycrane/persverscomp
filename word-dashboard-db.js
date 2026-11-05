const VENDOR = new URL("./vendor/sql-httpvfs/", import.meta.url);
const PAGE_SIZE = 4096;
const MAX_BYTES_TO_READ = 64 * 1024 * 1024;

function toObjects(results) {
  if (!results.length) return [];
  const {columns, values} = results[0];
  return values.map(row => Object.fromEntries(columns.map((column, i) => [column, row[i]])));
}

export function indexBaseUrl() {
  const query = new URLSearchParams(location.search).get("index");
  const localCompanion = ["localhost", "127.0.0.1"].includes(location.hostname) && location.port === "8000"
    ? "http://127.0.0.1:8001/search-index/"
    : "./search-index/";
  const configured = query || window.PMV_WORD_INDEX_URL || localCompanion;
  return new URL(configured.endsWith("/") ? configured : `${configured}/`, location.href);
}

export async function openSearchIndex() {
  if (typeof window.createDbWorker !== "function") throw new Error("The range-query database loader did not start.");
  const base = indexBaseUrl();
  const response = await fetch(new URL("manifest.json", base), {cache: "no-cache"});
  if (!response.ok) {
    if (response.status === 404) throw new Error(`No corpus index was found at ${base.pathname}manifest.json.`);
    throw new Error(`Corpus index manifest: HTTP ${response.status}`);
  }
  const manifest = await response.json();
  if (Number(manifest.page_size || PAGE_SIZE) !== PAGE_SIZE) throw new Error(`Unsupported database page size: ${manifest.page_size}`);
  const worker = await window.createDbWorker(
    [{from: "inline", config: {serverMode: "full", requestChunkSize: PAGE_SIZE, url: new URL(manifest.db, base).toString()}}],
    new URL("sqlite.worker.js", VENDOR).toString(),
    new URL("sql-wasm.wasm", VENDOR).toString(),
    MAX_BYTES_TO_READ,
  );
  return {
    manifest,
    base,
    async all(sql, params = []) { return toObjects(await worker.db.exec(sql, params)); },
    async bytesRead() { const stats = await worker.worker.getStats(); return stats?.totalFetchedBytes || 0; },
  };
}
