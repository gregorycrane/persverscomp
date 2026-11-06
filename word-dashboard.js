import {openSearchIndex} from "./word-dashboard-db.js";
import {looseKey, matchKey} from "./word-dashboard-normalize.js";

const $ = id => document.getElementById(id);
const fmt = value => Number(value || 0).toLocaleString();
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const FEATURE_ORDER = ["VerbForm", "Tense", "Aspect", "Mood", "Voice", "Person", "Number", "Gender", "Case", "Degree"];
const TENSE_ORDER = ["Pres", "Imp", "Fut", "Past", "Aor", "Perf", "Pqp", "FutPerf"];
const PERSON_COLUMNS = [["1", "Sing"], ["2", "Sing"], ["3", "Sing"], ["1", "Plur"], ["2", "Plur"], ["3", "Plur"]];
// A remote SQLite lookup may otherwise require one range request per rare
// surface form.  The most frequent groups provide the interactive paradigm;
// the summary counts above still describe every group in the index.
const MORPHOLOGY_GROUP_LIMIT = 120;
const LABELS = {
  Ind: "indicative", Sub: "subjunctive", Opt: "optative",
  Act: "active", Mid: "middle", Pass: "passive", Med: "middle",
  Pres: "present", Imp: "imperfective", Fut: "future", Past: "past", Aor: "aorist",
  Perf: "perfect", Pqp: "pluperfect", Inf: "infinitive", Part: "participle",
  Conv: "converb", Ger: "gerund", Fin: "finite",
};

let db;
let taxonomy = {works: {}, method: "No work taxonomy was loaded."};
let principalParts = {};
let currentResult;
const documentsByLang = new Map();
let optionalTables;

function label(value) { return LABELS[value] || value || "unspecified"; }
function moodLabel(value) { return ({Ind: "indicative", Sub: "subjunctive", Opt: "optative", Imp: "imperative"})[value] || label(value); }
function parseFeatures(text) {
  const features = {};
  for (const part of String(text || "").split("|")) {
    const at = part.indexOf("=");
    if (at > 0) features[part.slice(0, at)] = part.slice(at + 1);
  }
  return features;
}
function featureLabel(features) {
  const seen = new Set();
  const values = [];
  for (const key of FEATURE_ORDER) if (features[key]) {
    values.push(`${key}=${features[key]}`); seen.add(key);
  }
  for (const [key, value] of Object.entries(features)) if (!seen.has(key)) values.push(`${key}=${value}`);
  return values.join(" · ") || "no features";
}
function analysisLabel(row) {
  return [row.upos || "unlabelled", featureLabel(row.features)].join(" · ");
}
function principalPartIndex(features) {
  const tense = features.Tense;
  const aspect = features.Aspect;
  const voice = features.Voice;
  const passive = voice === "Pass";
  const perfectSystem = ["Perf", "Pqp"].includes(tense) || aspect === "Res";
  const aoristSystem = tense === "Aor" || (tense === "Past" && aspect === "Perf");
  if (perfectSystem) return voice === "Act" ? 3 : 4;
  if (passive && (aoristSystem || tense === "Fut")) return 5;
  if (tense === "Fut") return 1;
  if (aoristSystem) return 2;
  if (tense === "Pres" || (tense === "Past" && aspect === "Imp")) return 0;
  return -1;
}
function workKey(urn) {
  const body = String(urn || "").split(":").pop() || "";
  return body.split(".").slice(0, 2).join(".");
}
function workClass(urn) {
  const item = taxonomy.works[workKey(urn)] || {};
  return {register: item.register || "unclassified", genre: item.genre || "", source: item.source || ""};
}
function placeholders(values) { return values.map(() => "?").join(","); }

async function documents(lang) {
  if (!documentsByLang.has(lang)) {
    documentsByLang.set(lang, db.all(
      "SELECT doc_id, base_urn, title, author, corpus, n_words FROM documents WHERE lang = ? ORDER BY doc_id",
      [lang],
    ));
  }
  return documentsByLang.get(lang);
}

async function findLemmas(query, lang) {
  let rows = await db.all(
    "SELECT lemma_id, lemma, n FROM lemmas WHERE key = ? AND lang = ? ORDER BY n DESC, lemma LIMIT 30",
    [matchKey(query, lang), lang],
  );
  if (!rows.length) rows = await db.all(
    "SELECT lemma_id, lemma, n FROM lemmas WHERE loose = ? AND lang = ? ORDER BY n DESC, lemma LIMIT 30",
    [looseKey(query, lang), lang],
  );
  return rows;
}

async function loadLemma(query, lang) {
  const lemmas = await findLemmas(query, lang);
  if (!lemmas.length) return null;
  $("message").textContent = `Matched ${lemmas.map(row => row.lemma).join(" / ")}; loading occurrence counts…`;
  const ids = lemmas.map(row => row.lemma_id);
  const slots = placeholders(ids);
  // Keep the range reads clustered on the posting-table primary keys.  Joining
  // the 2.7M-row forms table inside the aggregate lets SQLite choose a much
  // more expensive remote plan on some builds.
  const [postingGroups, docCounts, docs] = await Promise.all([
    db.all(
      `SELECT form_id, feat_id, COUNT(*) AS n
       FROM lemma_postings WHERE lemma_id IN (${slots})
       GROUP BY form_id, feat_id ORDER BY n DESC`, ids,
    ),
    db.all(
      `SELECT doc_id, SUM(n) AS hits FROM lemma_doc_counts
       WHERE lemma_id IN (${slots}) GROUP BY doc_id ORDER BY hits DESC`, ids,
    ),
    documents(lang),
  ]);
  $("message").textContent = `Loaded ${fmt(docCounts.length)} document counts; resolving ${fmt(postingGroups.length)} form/analysis groups…`;
  const displayedGroups = postingGroups.slice(0, MORPHOLOGY_GROUP_LIMIT);
  const formIds = [...new Set(displayedGroups.map(row => row.form_id))];
  const featIds = [...new Set(postingGroups.map(row => row.feat_id).filter(value => value !== null))];
  const [forms, feats] = await Promise.all([
    formIds.length ? db.all(`SELECT form_id, form FROM forms WHERE form_id IN (${placeholders(formIds)})`, formIds) : [],
    featIds.length ? db.all(`SELECT feat_id, upos, feats FROM feats WHERE feat_id IN (${placeholders(featIds)})`, featIds) : [],
  ]);
  $("message").textContent = "Rendering prose/poetry rates and paradigms…";
  const formMap = new Map(forms.map(row => [row.form_id, row.form]));
  const featMap = new Map(feats.map(row => [row.feat_id, row]));
  const docMap = new Map(docs.map(row => [row.doc_id, row]));
  const morphology = displayedGroups.map(row => {
    const feat = featMap.get(row.feat_id) || {};
    return {form: formMap.get(row.form_id) || "", upos: feat.upos || null, feats: feat.feats || null, n: Number(row.n)};
  }).sort((a, b) => b.n - a.n || a.form.localeCompare(b.form));
  const principalFormSets = Array.from({length: 6}, () => new Set());
  for (const row of postingGroups) {
    const feat = featMap.get(row.feat_id) || {};
    const part = principalPartIndex(parseFeatures(feat.feats));
    if (part >= 0) principalFormSets[part].add(row.form_id);
  }
  const workHits = docCounts.map(row => ({...docMap.get(row.doc_id), hits: Number(row.hits)})).filter(row => row.doc_id);
  return {
    lemmas,
    lemmaIds: ids,
    lemma: lemmas[0].lemma,
    totalHits: docCounts.reduce((sum, row) => sum + Number(row.hits), 0),
    formCount: new Set(postingGroups.map(row => row.form_id)).size,
    analysisCount: postingGroups.length,
    morphologyCoverage: displayedGroups.reduce((sum, row) => sum + Number(row.n), 0),
    principalFormCounts: principalFormSets.map(forms => forms.size),
    morphology: morphology.map(row => ({...row, features: parseFeatures(row.feats)})),
    workHits: workHits.map(row => ({...row, n_words: Number(row.n_words)})),
    docs,
  };
}

async function renderOptionalEvidence(result) {
  if (!optionalTables) {
    const rows = await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('lemma_syntax','lemma_glosses')");
    optionalTables = new Set(rows.map(row => row.name));
  }
  const slots = placeholders(result.lemmaIds);
  if (optionalTables.has("lemma_syntax")) {
    const rows = await db.all(
      `SELECT relation, head_lemma, dependent_lemma, SUM(n) AS n FROM lemma_syntax
       WHERE lemma_id IN (${slots}) GROUP BY relation, head_lemma, dependent_lemma ORDER BY n DESC LIMIT 80`,
      result.lemmaIds,
    );
    $("syntax-panel").hidden = !rows.length;
    if (rows.length) $("syntax-evidence").innerHTML = [
      ["Relations", "relation"], ["Governing lemmas", "head_lemma"], ["Dependents", "dependent_lemma"],
    ].map(([title, key]) => {
      const counts = new Map(); for (const row of rows) if (row[key]) counts.set(row[key], (counts.get(row[key]) || 0) + Number(row.n));
      return `<div class="analysis-card"><strong>${esc(title)}</strong>${[...counts].sort((a,b)=>b[1]-a[1]).slice(0,12).map(([value,n]) => `<span><i>${esc(value)}</i><b>${fmt(n)}</b></span>`).join("")}</div>`;
    }).join("");
  } else $("syntax-panel").hidden = true;
  if (optionalTables.has("lemma_glosses")) {
    const rows = await db.all(
      `SELECT gloss, source, SUM(n) AS n FROM lemma_glosses
       WHERE lemma_id IN (${slots}) GROUP BY gloss, source ORDER BY n DESC LIMIT 80`,
      result.lemmaIds,
    );
    $("gloss-panel").hidden = !rows.length;
    if (rows.length) $("gloss-evidence").innerHTML = rows.map(row => `<div class="gloss"><span>${esc(row.gloss)}<small>${esc(row.source)}</small></span><b>${fmt(row.n)}</b></div>`).join("");
  } else $("gloss-panel").hidden = true;
}

function renderRegisters(result) {
  const totals = new Map([['poetry', {tokens: 0, hits: 0}], ['prose', {tokens: 0, hits: 0}], ['unclassified', {tokens: 0, hits: 0}]]);
  for (const doc of result.docs) totals.get(workClass(doc.base_urn).register).tokens += Number(doc.n_words);
  for (const doc of result.workHits) totals.get(workClass(doc.base_urn).register).hits += doc.hits;
  const rows = ["poetry", "prose", "unclassified"].map(register => {
    const item = totals.get(register);
    return {...item, register, rate: item.tokens ? item.hits * 10000 / item.tokens : 0};
  });
  const max = Math.max(1, ...rows.slice(0, 2).map(row => row.rate));
  $("register-bars").innerHTML = rows.map(row => `<div class="bar-row ${row.register === 'unclassified' ? 'muted-row' : ''}">
    <div class="bar-label"><strong>${esc(row.register[0].toUpperCase() + row.register.slice(1))}</strong><small>${fmt(row.hits)} hits · ${fmt(row.tokens)} tokens</small></div>
    <div class="bar-track"><div class="bar-fill ${row.register}" style="width:${row.rate ? Math.max(1.2, row.rate / max * 100) : 0}%"></div></div>
    <div class="bar-value">${row.rate.toFixed(2)}</div>
  </div>`).join("");
  const classified = rows[0].tokens + rows[1].tokens;
  const all = classified + rows[2].tokens;
  $("register-note").textContent = `${all ? (100 * classified / all).toFixed(1) : "0.0"}% of indexed ${$("lang").value === "grc" ? "Greek" : "Latin"} tokens have a prose/poetry label. ${taxonomy.method}`;
}

function renderPrincipalParts(result, lang) {
  const entry = principalParts[result.lemma] || principalParts[matchKey(result.lemma, lang)];
  $("principal-panel").hidden = !entry;
  if (!entry) return;
  $("principal-parts").innerHTML = entry.parts.map((part, index) => {
    const variants = Array.isArray(part.forms) ? part.forms : [part.forms];
    const count = result.principalFormCounts[index] || 0;
    return `<div class="principal-part"><span>${index + 1}. ${esc(part.label)}</span><strong lang="grc">${variants.map(esc).join(" / ")}</strong><small>${fmt(count)} distinct tagged form${count === 1 ? "" : "s"} in this system</small></div>`;
  }).join("");
  $("principal-note").textContent = `${entry.source}. The displayed forms are dictionary principal parts; the number below each is the distinct corpus forms assigned to the tense/voice system that principal part supplies.`;
}

function cellHtml(rows) {
  if (!rows.length) return '<td class="empty">—</td>';
  const byForm = new Map();
  for (const row of rows) byForm.set(row.form, (byForm.get(row.form) || 0) + row.n);
  const ranked = [...byForm].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4);
  return `<td>${ranked.map(([form, count]) => `<div class="cell-form"><span lang="grc">${esc(form)}</span><b>${fmt(count)}</b></div>`).join("")}</td>`;
}

function paradigmHeading(key) {
  const [mood, voice] = key.split("|");
  return `${moodLabel(mood)} · ${label(voice)}`;
}

function traditionalParadigmRank(key) {
  const [mood, voice] = key.split("|");
  const voiceOrder = ["Act", "Mid", "Med", "Pass", "unspecified"];
  const moodOrder = ["Ind", "Sub", "Opt", "Imp", "Fin"];
  const at = (values, value) => {
    const index = values.indexOf(value);
    return index < 0 ? values.length : index;
  };
  return at(voiceOrder, voice) * 100 + at(moodOrder, mood);
}

function orderedParadigms(groups) {
  const order = $("paradigm-order").value;
  return [...groups].sort((a, b) => {
    if (order === "frequency") {
      const aTotal = a[1].reduce((sum, row) => sum + row.n, 0);
      const bTotal = b[1].reduce((sum, row) => sum + row.n, 0);
      return bTotal - aTotal || traditionalParadigmRank(a[0]) - traditionalParadigmRank(b[0]);
    }
    if (order === "alphabetical") return paradigmHeading(a[0]).localeCompare(paradigmHeading(b[0]));
    return traditionalParadigmRank(a[0]) - traditionalParadigmRank(b[0]) || paradigmHeading(a[0]).localeCompare(paradigmHeading(b[0]));
  });
}

function renderFiniteParadigms(rows) {
  const finite = rows.filter(row => row.features.Person && row.features.Number && (row.features.Mood || row.features.VerbForm === "Fin"));
  if (!finite.length) return "";
  const groups = new Map();
  for (const row of finite) {
    const key = `${row.features.Mood || 'Fin'}|${row.features.Voice || 'unspecified'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return orderedParadigms(groups).map(([key, group]) => {
    const [mood, voice] = key.split("|");
    const tenses = [...new Set(group.map(row => row.features.Tense || row.features.Aspect || "unspecified"))]
      .sort((a, b) => (TENSE_ORDER.indexOf(a) < 0 ? 99 : TENSE_ORDER.indexOf(a)) - (TENSE_ORDER.indexOf(b) < 0 ? 99 : TENSE_ORDER.indexOf(b)) || a.localeCompare(b));
    return `<section class="paradigm-section"><h3>${esc(moodLabel(mood))} · ${esc(label(voice))}<small>${fmt(group.reduce((sum, row) => sum + row.n, 0))} tagged tokens</small></h3>
      <div class="table-scroll"><table class="paradigm-table"><thead><tr><th>Tense</th>${PERSON_COLUMNS.map(([person, number]) => `<th>${person}${number === 'Sing' ? 'sg' : 'pl'}</th>`).join("")}</tr></thead><tbody>
      ${tenses.map(tense => `<tr><th>${esc(label(tense))}</th>${PERSON_COLUMNS.map(([person, number]) => cellHtml(group.filter(row => (row.features.Tense || row.features.Aspect || "unspecified") === tense && row.features.Person === person && row.features.Number === number))).join("")}</tr>`).join("")}
      </tbody></table></div></section>`;
  }).join("");
}

function renderNonFinite(rows) {
  const nonfinite = rows.filter(row => ["Inf", "Part", "Conv", "Ger"].includes(row.features.VerbForm) || ["Inf", "Part"].includes(row.features.Mood));
  if (!nonfinite.length) return "";
  const groups = new Map();
  for (const row of nonfinite) {
    const type = row.features.VerbForm || row.features.Mood;
    const key = [type, row.features.Tense || row.features.Aspect || "", row.features.Voice || ""].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return `<section class="nonfinite"><h3>Non-finite forms</h3><div class="analysis-grid">${[...groups].sort().map(([key, group]) => {
    const [type, tense, voice] = key.split("|");
    const forms = new Map(); for (const row of group) forms.set(row.form, (forms.get(row.form) || 0) + row.n);
    return `<div class="analysis-card"><strong>${esc([label(type), label(tense), label(voice)].filter(v => v && v !== 'unspecified').join(" · "))}</strong>${[...forms].sort((a,b) => b[1]-a[1]).slice(0,8).map(([form,count]) => `<span><i lang="grc">${esc(form)}</i><b>${fmt(count)}</b></span>`).join("")}</div>`;
  }).join("")}</div></section>`;
}

function renderParadigm(result) {
  const verbs = result.morphology.filter(row => ["VERB", "AUX"].includes(String(row.upos || "").toUpperCase()));
  $("verb-status").textContent = verbs.length ? `${fmt(verbs.reduce((sum, row) => sum + row.n, 0))} shown · ${(100 * result.morphologyCoverage / result.totalHits).toFixed(1)}% coverage` : "no verb analysis";
  if (!verbs.length) {
    $("paradigm").innerHTML = '<p class="empty-copy">This lemma has no VERB/AUX analyses in the current index. The complete POS and feature distribution remains below.</p>';
    return;
  }
  const finite = renderFiniteParadigms(verbs);
  const nonfinite = renderNonFinite(verbs);
  $("paradigm").innerHTML = finite + nonfinite || '<p class="empty-copy">Verb tokens are present, but their feature bundles do not expose person/number or non-finite categories.</p>';
}

function renderAmbiguities(result) {
  const forms = new Map();
  for (const row of result.morphology) {
    if (!forms.has(row.form)) forms.set(row.form, []);
    forms.get(row.form).push(row);
  }
  const ambiguous = [...forms].filter(([, rows]) => new Set(rows.map(analysisLabel)).size > 1)
    .sort((a, b) => b[1].reduce((s,r)=>s+r.n,0) - a[1].reduce((s,r)=>s+r.n,0));
  if (!ambiguous.length) {
    $("ambiguities").innerHTML = '<p class="empty-copy">No surface form has more than one tagged analysis for this lemma.</p>';
    return;
  }
  $("ambiguities").innerHTML = ambiguous.map(([form, rows]) => {
    const total = rows.reduce((sum, row) => sum + row.n, 0);
    return `<section class="ambiguity"><h3 lang="grc">${esc(form)}<small>${fmt(total)} tokens · ${fmt(rows.length)} analyses</small></h3>${rows.map(row => `<div class="analysis-row"><span>${esc(analysisLabel(row))}</span><div class="mini-track"><i style="width:${100 * row.n / total}%"></i></div><b>${fmt(row.n)}</b><em>${(100 * row.n / total).toFixed(1)}%</em></div>`).join("")}</section>`;
  }).join("");
}

function renderForms(result) {
  const total = result.morphology.reduce((sum, row) => sum + row.n, 0);
  $("forms-table").innerHTML = result.morphology.slice(0, 500).map(row => `<tr>
    <td class="greek" lang="grc">${esc(row.form)}</td><td>${esc(row.upos || "—")}</td><td>${esc(featureLabel(row.features))}</td><td>${fmt(row.n)}</td><td>${(100 * row.n / total).toFixed(2)}%</td>
  </tr>`).join("");
}

function renderWorks(result) {
  const shown = result.workHits.slice(0, 100);
  $("works-table").innerHTML = shown.map(row => {
    const classification = workClass(row.base_urn);
    const rate = row.n_words ? 10000 * row.hits / row.n_words : 0;
    return `<tr><td><span class="work-title">${esc(row.title || workKey(row.base_urn))}<small>${esc(row.author || row.base_urn)}</small></span></td><td>${esc(classification.register)}${classification.genre ? `<small class="genre">${esc(classification.genre)}</small>` : ""}</td><td>${esc(row.corpus || "—")}</td><td>${fmt(row.n_words)}</td><td>${fmt(row.hits)}</td><td>${rate.toFixed(2)}</td></tr>`;
  }).join("") + (result.workHits.length > shown.length ? `<tr class="more-row"><td colspan="6">Showing the 100 documents with the most hits; ${fmt(result.workHits.length - shown.length)} more are available in the concordance.</td></tr>` : "");
}

async function runSearch() {
  const query = $("lemma").value.trim();
  const lang = $("lang").value;
  if (!query || !db) return;
  $("results").hidden = true;
  $("message").className = "message loading";
  $("message").textContent = `Loading ${query}…`;
  const params = new URLSearchParams(location.search);
  params.set("lemma", query); params.set("lang", lang);
  history.replaceState(null, "", `${location.pathname}?${params}`);
  try {
    const result = await loadLemma(query, lang);
    if (!result) {
      $("message").className = "message error";
      $("message").textContent = `No indexed lemma matched “${query}”.`;
      return;
    }
    currentResult = result;
    const total = result.totalHits;
    $("result-lemma").textContent = result.lemmas.map(row => row.lemma).join(" / ");
    $("stat-occurrences").textContent = fmt(total);
    $("stat-forms").textContent = fmt(result.formCount);
    $("stat-analyses").textContent = fmt(result.analysisCount);
    $("stat-works").textContent = fmt(new Set(result.workHits.map(row => workKey(row.base_urn))).size);
    $("concordance-link").href = `./search/index.html?q=${encodeURIComponent(result.lemma)}&mode=lemma`;
    renderRegisters(result);
    renderPrincipalParts(result, lang);
    renderParadigm(result);
    renderAmbiguities(result);
    renderForms(result);
    renderWorks(result);
    await renderOptionalEvidence(result);
    $("message").className = "message"; $("message").textContent = "";
    $("results").hidden = false;
    $("index-status").textContent = `${fmt(db.manifest.words)} tagged words · ${fmt(await db.bytesRead())} bytes fetched for this session`;
  } catch (error) {
    console.error(error);
    $("message").className = "message error";
    $("message").textContent = `Could not load this lemma: ${error.message}`;
  }
}

async function initialize() {
  const params = new URLSearchParams(location.search);
  $("lemma").value = params.get("lemma") || "φέρω";
  $("lang").value = params.get("lang") === "la" ? "la" : "grc";
  const requestedOrder = params.get("paradigm_order");
  $("paradigm-order").value = ["frequency", "alphabetical", "traditional"].includes(requestedOrder) ? requestedOrder : "frequency";
  $("search-form").addEventListener("submit", event => { event.preventDefault(); runSearch(); });
  $("paradigm-order").addEventListener("change", () => {
    const query = new URLSearchParams(location.search);
    query.set("paradigm_order", $("paradigm-order").value);
    history.replaceState(null, "", `${location.pathname}?${query}`);
    if (currentResult) renderParadigm(currentResult);
  });
  [db, taxonomy, principalParts] = await Promise.all([
    openSearchIndex(),
    fetch("./word-dashboard-works.json", {cache: "no-store"}).then(response => response.ok ? response.json() : taxonomy).catch(() => taxonomy),
    fetch("./word-dashboard-principal-parts.json", {cache: "no-store"}).then(response => response.ok ? response.json() : {}).catch(() => ({})),
  ]);
  $("index-status").textContent = `${fmt(db.manifest.words)} tagged words · index ${db.manifest.built_at?.slice(0, 10) || "loaded"}`;
  await runSearch();
}

initialize().catch(error => {
  console.error(error);
  $("index-status").textContent = "Corpus index unavailable";
  $("message").className = "message error";
  $("message").textContent = `${error.message} Start serve_local.py on port 8001 when the viewer runs on port 8000.`;
});
