(() => {
  "use strict";
  const FEATURES = ["Tense","Mood","Voice","Person","Number","Gender","Case"];
  const UD = {
    pos: {v:"VERB",n:"NOUN",a:"ADJ",p:"PRON",l:"DET",d:"ADV",r:"ADP",c:"CCONJ",g:"PART",m:"NUM",i:"INTJ"},
    Tense: {p:"Pres",i:"Imp",f:"Fut",a:"Aor",r:"Perf",l:"Pqp"},
    Mood: {i:"Ind",s:"Sub",o:"Opt",m:"Imp"},
    Voice: {a:"Act",m:"Mid",p:"Pass",e:"Mid"},
    Number: {s:"Sing",p:"Plur",d:"Dual"},
    Gender: {m:"Masc",f:"Fem",n:"Neut"},
    Case: {n:"Nom",g:"Gen",d:"Dat",a:"Acc",v:"Voc"},
    Person: {1:"1",2:"2",3:"3"}
  };
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmt = value => Number(value || 0).toLocaleString();
  let DATA;
  const WORK_ALIASES = new Map([
    ['ach','tlg0019.tlg001'],['arach','tlg0019.tlg001'],['acharnians','tlg0019.tlg001'],
    ['eq','tlg0019.tlg002'],['areq','tlg0019.tlg002'],['equ','tlg0019.tlg002'],['knights','tlg0019.tlg002'],
    ['nub','tlg0019.tlg003'],['arnub','tlg0019.tlg003'],['clouds','tlg0019.tlg003'],
    ['vesp','tlg0019.tlg004'],['arvesp','tlg0019.tlg004'],['wasps','tlg0019.tlg004'],
    ['pax','tlg0019.tlg005'],['arpax','tlg0019.tlg005'],['peace','tlg0019.tlg005'],
    ['av','tlg0019.tlg006'],['arav','tlg0019.tlg006'],['birds','tlg0019.tlg006'],
    ['lys','tlg0019.tlg007'],['arlys','tlg0019.tlg007'],['lysistrata','tlg0019.tlg007'],
    ['thesm','tlg0019.tlg008'],['arthesm','tlg0019.tlg008'],['thesmophoriazusae','tlg0019.tlg008'],
    ['ran','tlg0019.tlg009'],['arran','tlg0019.tlg009'],['frogs','tlg0019.tlg009'],
    ['eccl','tlg0019.tlg010'],['areccl','tlg0019.tlg010'],['ecclesiazusae','tlg0019.tlg010'],
    ['plut','tlg0019.tlg011'],['arplut','tlg0019.tlg011'],['wealth','tlg0019.tlg011']
  ]);
  function resolveWork(value) { const original=String(value||'').trim();return WORK_ALIASES.get(original.toLowerCase().replace(/[^a-z0-9]+/g,''))||original; }
  const ARISTOPHANES_ABBREVIATIONS = {
    'tlg0019.tlg001':'Ar. Ach.','tlg0019.tlg002':'Ar. Eq.','tlg0019.tlg003':'Ar. Nub.',
    'tlg0019.tlg004':'Ar. Vesp.','tlg0019.tlg005':'Ar. Pax','tlg0019.tlg006':'Ar. Av.',
    'tlg0019.tlg007':'Ar. Lys.','tlg0019.tlg008':'Ar. Thesm.','tlg0019.tlg009':'Ar. Ran.',
    'tlg0019.tlg010':'Ar. Eccl.','tlg0019.tlg011':'Ar. Plut.'
  };

  function option(value, label) { return `<option value="${esc(value)}">${esc(label)}</option>`; }
  function populate(id, values, labels) {
    $(id).innerHTML = option("", "Any") + values.map(value => option(value, labels?.[value] || value)).join("");
  }
  function selectedWorks() {
    return new Set($("works").value.split(",").map(resolveWork).filter(Boolean));
  }
  function description(filters) {
    const words = [];
    if (filters.Tense) words.push(DATA.labels.Tense[filters.Tense]);
    if (filters.Mood) words.push(DATA.labels.Mood[filters.Mood]);
    if (filters.Voice) words.push(DATA.labels.Voice[filters.Voice]);
    if (filters.Person) words.push(DATA.labels.Person[filters.Person] + " person");
    if (filters.Number) words.push(DATA.labels.Number[filters.Number]);
    words.push(filters.pos ? DATA.labels.pos[filters.pos] : "tokens");
    if (filters.stemtype) words.push(`with Morpheus stemtype ${filters.stemtype}`);
    return words.join(" ");
  }
  function filtersFromForm() {
    const result = {stemtype: $("stemtype").value, pos: $("pos").value};
    for (const key of FEATURES) result[key] = $(key).value;
    return result;
  }
  function syncUrl(filters, works) {
    const params = new URLSearchParams();
    for (const [key,value] of Object.entries(filters)) if (value) params.set(key.toLowerCase(), value);
    if (works.size) params.set("works", [...works].join(","));
    history.replaceState(null,"",`${location.pathname}?${params}`);
  }
  function searchLink(filters, works) {
    const params = new URLSearchParams({mode:"either"});
    if (works.size) params.set("works", [...works].join(","));
    if (filters.pos && UD.pos[filters.pos]) params.set("upos", UD.pos[filters.pos]);
    for (const key of FEATURES) if (filters[key] && UD[key]?.[filters[key]]) params.set(`feat_${key}`,UD[key][filters[key]]);
    return `./search/index.html?${params}`;
  }
  function run() {
    const filters = filtersFromForm();
    const works = selectedWorks();
    const unknown = [...works].filter(work => !DATA.works.some(item => item.id === work));
    const totals = new Map();
    for (const row of DATA.rows) {
      const [work, stemtypes, pos, Tense, Mood, Voice, Person, Number, Gender, Case, count] = row;
      if (works.size && !works.has(work)) continue;
      if (filters.stemtype && !stemtypes.includes(filters.stemtype)) continue;
      if (filters.pos && pos !== filters.pos) continue;
      const rowFeatures = {Tense,Mood,Voice,Person,Number,Gender,Case};
      if (FEATURES.some(key => filters[key] && rowFeatures[key] !== filters[key])) continue;
      totals.set(work, (totals.get(work) || 0) + count);
    }
    const workMeta = new Map(DATA.works.map(item => [item.id,item]));
    const rows = [...totals].map(([work,count]) => ({...workMeta.get(work), count})).sort((a,b) => b.count-a.count);
    const count = rows.reduce((sum,row) => sum+row.count,0);
    const denominator = DATA.works.filter(item => !works.size || works.has(item.id)).reduce((sum,item) => sum+item.tokens,0);
    const rate = denominator ? count / denominator * 10000 : 0;
    $("result").innerHTML = `
      <h2>Result</h2><p class="query-sentence">${esc(description(filters))}</p>
      ${unknown.length ? `<p class="warning">Unknown or unavailable work keys: ${unknown.map(esc).join(", ")}</p>` : ""}
      <div class="stats"><div class="stat"><strong>${fmt(count)}</strong><span>matching tokens</span></div>
      <div class="stat"><strong>${fmt(rows.length)}</strong><span>works with matches</span></div>
      <div class="stat"><strong>${rate.toFixed(2)}</strong><span>per 10,000 joined tokens</span></div></div>
      <table><thead><tr><th>Work</th><th>CTS work key</th><th>Count</th><th>Per 10k</th></tr></thead><tbody>
      ${rows.map(row => `<tr><td>${esc(row.title)}${ARISTOPHANES_ABBREVIATIONS[row.id]?` <span class="work-abbr">(${esc(ARISTOPHANES_ABBREVIATIONS[row.id])})</span>`:''}</td><td class="work-id">${esc(row.id)}</td><td>${fmt(row.count)}</td><td>${(row.count/row.tokens*10000).toFixed(2)}</td></tr>`).join("")}
      </tbody></table>`;
    $("occurrences").href = searchLink(filters,works);
    const paradigm = new URLSearchParams();
    if (filters.stemtype) paradigm.set("stemtype", filters.stemtype);
    for (const key of ["Tense","Mood","Voice"]) if (filters[key]) paradigm.set(key.toLowerCase(), filters[key]);
    if (works.size) paradigm.set("works", [...works].join(","));
    $("paradigm").href = `./paradigm-viewer.html?${paradigm}`;
    $("occurrence-note").textContent = filters.stemtype
      ? "The occurrence search carries the work and morphology filters. PMV search does not yet index Morpheus stemtypes, so it may include additional morphological candidates."
      : "The occurrence search carries the selected work and morphology filters.";
    syncUrl(filters,works);
  }
  function initialize(data) {
    DATA = data;
    populate("stemtype",data.values.stemtype);
    populate("pos",data.values.pos,data.labels.pos);
    for (const key of FEATURES) populate(key,data.values[key],data.labels[key]);
    const params = new URLSearchParams(location.search);
    const defaults = {stemtype:"w_stem",pos:"v",Tense:"i",Mood:"i",Voice:"a"};
    for (const id of ["stemtype","pos",...FEATURES]) $(id).value = params.get(id.toLowerCase()) ?? defaults[id] ?? "";
    $("works").value = params.get("works") || "";
    $("method").textContent = data.method + ` The current cube contains ${fmt(data.joined_tokens)} joined tokens from ${fmt(data.works.length)} PMV works.`;
    $("run").addEventListener("click",run);
    document.querySelectorAll("select,input").forEach(control => control.addEventListener("keydown",event => { if(event.key === "Enter") run(); }));
    run();
  }
  fetch("grammar-query-data.json",{cache:"no-store"})
    .then(response => { if(!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
    .then(initialize)
    .catch(error => { $("result").innerHTML = `<h2>Data unavailable</h2><p>${esc(error.message)}</p>`; });
})();
