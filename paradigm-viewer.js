(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmt = value => Number(value||0).toLocaleString();
  const LABELS = {
    tense:{p:"Present",i:"Imperfect",f:"Future",a:"Aorist",r:"Perfect",l:"Pluperfect",t:"Future perfect"},
    mood:{i:"Indicative",s:"Subjunctive",o:"Optative",m:"Imperative",n:"Infinitive",p:"Participle"},
    voice:{a:"Active",m:"Middle",p:"Passive",e:"Middle/Passive","":"Unspecified"},
    number:{s:"SG",p:"PL",d:"DU"}, gender:{m:"M",f:"F",n:"N",c:"C"}, case:{n:"NOM",g:"GEN",d:"DAT",a:"ACC",v:"VOC"}
  };
  const ORDER = ["INF","1SG","2SG","3SG","1DU","2DU","3DU","1PL","2PL","3PL","PART"];
  let INDEX, PARADIGM_INDEX, DATA;
  let COLUMN_STEMTYPES = [], INITIAL_STEMTYPES = [], AVAILABLE_STEMTYPES = [], LOADED_PARADIGM = '';
  const EXPANDED = new Set();
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
  function options(values, labels, any=true) { return (any?'<option value="">Any</option>':'') + values.map(v=>`<option value="${esc(v)}">${esc(labels?.[v]||v)}</option>`).join(''); }
  function query() { return {layout:$("layout").value,family:$("family").value,stemtype:$("stemtype").value,stemtypes:[...COLUMN_STEMTYPES],scope:$("scope").value,lemma:$("scope").value==='lemma'?$("lemma").value.trim():'',tense:$("tense").value,mood:$("mood").value,voice:$("voice").value,works:$("works").value.split(',').map(resolveWork).filter(Boolean),limit:Number($("limit").value)}; }
  function slot(r) {
    const mood=r[6], person=r[8], number=r[9], gender=r[10], cas=r[11];
    if(r[4]==='n'||r[4]==='a') return `${LABELS.number[number]||'?'} ${LABELS.case[cas]||'?'} ${LABELS.gender[gender]||'?'}`;
    if(mood==='n') return 'INF';
    if(mood==='p') return `PART ${LABELS.number[number]||'?'} ${LABELS.case[cas]||'?'} ${LABELS.gender[gender]||'?'}`;
    if(person && number) return `${person}${LABELS.number[number]||number}`;
    if(number||gender||cas) return `${LABELS.number[number]||number} ${LABELS.case[cas]||cas} ${LABELS.gender[gender]||gender}`.trim();
    return 'OTHER';
  }
  function column(r,q) { if(q.layout==='compare')return r[13];if(q.family!=='verb')return q.family;return [r[5],r[6],r[7]].join('|'); }
  function columnLabel(key,q) { if(q.layout==='compare')return key;if(q.family!=='verb')return familyLabel(q.family);const [t,m,v]=key.split('|'); return [LABELS.tense[t]||t,LABELS.mood[m]||m,LABELS.voice[v]||v].filter(Boolean).join(' '); }
  function paradigmLabel(q) { if(q.family==='noun')return 'Noun declension';if(q.family==='adjective')return 'Adjective declension';return [LABELS.tense[q.tense]||q.tense,LABELS.mood[q.mood]||q.mood,LABELS.voice[q.voice]||q.voice].filter(Boolean).join(' '); }
  function familyLabel(family) { return ({verb:'Verb paradigm',noun:'Noun declension',adjective:'Adjective declension',other:'Other morphology'})[family]||'Morphology'; }
  function rowFamily(r) { return r[4]==='v'?'verb':r[4]==='n'?'noun':r[4]==='a'?'adjective':'other'; }
  function recognizeFamily(rows) { const totals={verb:0,noun:0,adjective:0,other:0};for(const r of rows)totals[rowFamily(r)]+=r[12];return Object.entries(totals).sort((a,b)=>b[1]-a[1])[0][0]; }
  function stemtypeFamily(stemtype) { return INDEX.stemtypes.find(x=>x.stemtype===stemtype)?.family; }
  function groupedStemtypeOptions(selected=[]) { const chosen=new Set(selected),labels={noun:'Nouns',adjective:'Adjectives',verb:'Verbs',other:'Other morphology'};return ['noun','adjective','verb','other'].map(family=>`<optgroup label="${labels[family]}">${INDEX.stemtypes.filter(x=>x.family===family).sort((a,b)=>a.stemtype.localeCompare(b.stemtype)).map(x=>`<option value="${esc(x.stemtype)}"${chosen.has(x.stemtype)?' selected':''}>${esc(x.stemtype)} (${fmt(x.count)})</option>`).join('')}</optgroup>`).join(''); }
  function nominalRank(value) { const [num,cas,gen]=value.replace(/^PART /,'').split(' '),at=(values,item)=>{const i=values.indexOf(item);return i<0?9:i;};return at(["SG","DU","PL"],num)*100+at(["NOM","GEN","DAT","ACC","VOC"],cas)*10+at(["M","F","N","C"],gen); }
  function formLink(form, works) { const p=new URLSearchParams({q:form,mode:'form'}); if(works.length)p.set('works',works.join(',')); return `./search/index.html?${p}`; }
  function gloss(lemma) { return (DATA.glosses?.[lemma] || []).join('; '); }
  function lemmaLabel(lemma) { const text=gloss(lemma); return `<a class="lemma" href="./paradigm-viewer.html?${viewerParams(query(),lemma)}">${esc(lemma)}</a>${text?`<span class="lemma-gloss">${esc(text)}</span>`:''}`; }
  function viewerParams(q, lemma='') { const p=new URLSearchParams();if(q.layout==='stemtype')p.set('stemtype',q.stemtype);else{p.set('layout','compare');p.set('family',q.family);if(q.stemtypes.length)p.set('stemtypes',q.stemtypes.join(','));}for(const k of ['tense','mood','voice'])if(q[k]&&q.family==='verb')p.set(k,q[k]);if(q.works.length)p.set('works',q.works.join(','));if(q.limit!==3)p.set('limit',String(q.limit));if(lemma)p.set('lemma',lemma);return p; }
  function populateLemmas(rows) { const counts=new Map(); for(const r of rows)counts.set(r[3],(counts.get(r[3])||0)+r[12]); $("lemma-options").innerHTML=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([lemma,count])=>`<option value="${esc(lemma)}">${fmt(count)} tokens</option>`).join(''); return counts; }
  function setLayoutControls() { const compare=$("layout").value==='compare',nonverbal=$("family").value!=='verb';$("family").disabled=!compare;$("family-field").classList.toggle('recognized',!compare);$("stemtype").disabled=compare;$("stemtype-field").classList.toggle('inactive',compare);$("column-bar").classList.toggle('hidden',!compare);for(const id of ['tense','mood','voice']){$(id).disabled=nonverbal;$(id).closest('label').classList.toggle('inactive',nonverbal);} }
  function rankedStemtypes(rows) { const counts=new Map();for(const r of rows)counts.set(r[13],(counts.get(r[13])||0)+r[12]);return [...counts].map(([stemtype,count])=>({stemtype,count})).sort((a,b)=>b.count-a.count||a.stemtype.localeCompare(b.stemtype)); }
  function reconcileColumns(rows, reset=false) { AVAILABLE_STEMTYPES=rankedStemtypes(rows);const allowed=new Set(AVAILABLE_STEMTYPES.map(x=>x.stemtype));let chosen=reset?INITIAL_STEMTYPES:COLUMN_STEMTYPES;chosen=[...new Set(chosen.filter(x=>allowed.has(x)))].slice(0,6);for(const item of AVAILABLE_STEMTYPES){if(chosen.length>=3)break;if(!chosen.includes(item.stemtype))chosen.push(item.stemtype);}COLUMN_STEMTYPES=chosen;INITIAL_STEMTYPES=[]; }
  function columnSelectHtml(stemtype,index) { const selectedElsewhere=new Set(COLUMN_STEMTYPES.filter((_,i)=>i!==index));const opts=AVAILABLE_STEMTYPES.map(item=>`<option value="${esc(item.stemtype)}"${item.stemtype===stemtype?' selected':''}${selectedElsewhere.has(item.stemtype)?' disabled':''}>${esc(item.stemtype)} · ${fmt(item.count)}</option>`).join('');return `<div class="column-heading"><select class="column-stemtype" data-column="${index}" aria-label="Stemtype for column ${index+1}">${opts}</select>${COLUMN_STEMTYPES.length>1?`<button class="remove-column" data-column="${index}" type="button" title="Remove this column" aria-label="Remove column ${index+1}">×</button>`:''}</div>`; }
  function updateColumnBar() { const compare=$("layout").value==='compare';$("column-count").textContent=compare?`${COLUMN_STEMTYPES.length} of 6 columns`:'';$("add-column").disabled=!compare||COLUMN_STEMTYPES.length>=6||COLUMN_STEMTYPES.length>=AVAILABLE_STEMTYPES.length; }
  function render() {
    const q=query(), works=new Set(q.works);
    const useVerbFilters=q.family==='verb';
    const classRows=DATA.rows.filter(r=>rowFamily(r)===q.family&&(!works.size||works.has(r[0]))&&(!useVerbFilters||!q.tense||r[5]===q.tense)&&(!useVerbFilters||!q.mood||r[6]===q.mood)&&(!useVerbFilters||!q.voice||r[7]===q.voice));
    if(q.layout==='compare'&&!COLUMN_STEMTYPES.length)reconcileColumns(classRows,true);
    const lemmaCounts=populateLemmas(classRows);
    const selectedRows=q.layout==='compare'?classRows.filter(r=>COLUMN_STEMTYPES.includes(r[13])):classRows;
    const rows=q.lemma?selectedRows.filter(r=>r[3]===q.lemma):selectedRows;
    const columnTotals=new Map(); for(const r of rows){const key=column(r,q);columnTotals.set(key,(columnTotals.get(key)||0)+r[12]);}
    const columns=q.layout==='compare'?[...COLUMN_STEMTYPES]:[...columnTotals.keys()].sort((a,b)=>columnLabel(a,q).localeCompare(columnLabel(b,q)));
    const cells=new Map();
    for(const r of rows){ const key=`${slot(r)}\t${column(r,q)}`; if(!cells.has(key))cells.set(key,{total:0,forms:new Map()}); const c=cells.get(key); c.total+=r[12]; const fk=`${r[2]}\t${r[3]}`; c.forms.set(fk,(c.forms.get(fk)||0)+r[12]); }
    let slots=[...new Set(rows.map(slot))]; slots.sort((a,b)=>{const ai=ORDER.indexOf(a.split(' ')[0]),bi=ORDER.indexOf(b.split(' ')[0]);if(ai===ORDER.indexOf('PART')&&bi===ai)return nominalRank(a)-nominalRank(b)||a.localeCompare(b);if(ai>=0||bi>=0)return (ai<0?99:ai)-(bi<0?99:bi)||a.localeCompare(b);return nominalRank(a)-nominalRank(b)||a.localeCompare(b)});
    const total=rows.reduce((sum,r)=>sum+r[12],0), forms=new Set(rows.map(r=>r[2])).size, lemmas=new Set(rows.map(r=>r[3])).size;
    const selectedGloss=q.lemma?gloss(q.lemma):'';
    const scopeText=q.lemma?`lemma <span class="summary-lemma">${esc(q.lemma)}</span>${selectedGloss?` <span class="summary-gloss">${esc(selectedGloss)}</span>`:''}`:(q.layout==='compare'?`${esc(paradigmLabel(q))} · ${q.stemtypes.map(esc).join(', ')}`:`stemtype ${esc(q.stemtype)} · ${esc(familyLabel(q.family))}`);
    const back=q.lemma?`<a class="scope-link" href="./paradigm-viewer.html?${viewerParams(q)}">← Back to ${q.layout==='compare'?'all lemmas':esc(q.stemtype)+' overview'}</a>`:'';
    const unit=q.layout==='stemtype'?'tokens':'stemtype assignments';
    $("summary").innerHTML=`<strong>${fmt(total)} ${unit}</strong> · <span>${scopeText}: ${fmt(forms)} surface forms from ${fmt(lemmas)} lemma${lemmas===1?'':'s'} across ${fmt(columns.length)} column${columns.length===1?'':'s'} in ${works.size?fmt(works.size):'all available'} work${works.size===1?'':'s'}</span>${back}`;
    let h=`<thead><tr><th class="slot">Slot</th>${columns.map((c,i)=>`<th>${q.layout==='compare'?columnSelectHtml(c,i):esc(columnLabel(c,q))}<small>${fmt(columnTotals.get(c)||0)} tokens</small></th>`).join('')}</tr></thead><tbody>`;
    for(const s of slots){ h+=`<tr><th class="slot">${esc(s)}</th>`; for(const col of columns){const cellKey=`${s}\t${col}`,c=cells.get(cellKey); if(!c){h+='<td class="empty">—</td>';continue;} const ranked=[...c.forms].map(([k,count])=>{const [form,lemma]=k.split('\t');return{form,lemma,count}}).sort((a,b)=>b.count-a.count||a.form.localeCompare(b.form)); const expanded=EXPANDED.has(cellKey),visible=q.limit&&!expanded?ranked.slice(0,q.limit):ranked; h+=`<td><div class="cell-head"><span>${fmt(ranked.length)} form${ranked.length===1?'':'s'}</span><span class="cell-total">${fmt(c.total)}</span></div><div class="forms">${visible.map(x=>`<div class="form-row"><span><a href="${formLink(x.form,q.works)}" target="_blank" rel="noopener">${esc(x.form)}</a>${lemmaLabel(x.lemma)}</span><b>${fmt(x.count)}</b></div>`).join('')}</div>${q.limit&&!expanded&&ranked.length>q.limit?`<button class="more" data-key="${esc(cellKey)}">+ ${fmt(ranked.length-q.limit)} more</button>`:''}</td>`;} h+='</tr>'; }
    $("grid").innerHTML=h+'</tbody>';
    document.querySelectorAll('.more').forEach(button=>button.addEventListener('click',()=>{ EXPANDED.add(button.dataset.key); render(); }));
    document.querySelectorAll('.column-stemtype').forEach(select=>select.addEventListener('change',()=>{COLUMN_STEMTYPES[Number(select.dataset.column)]=select.value;EXPANDED.clear();render();}));
    document.querySelectorAll('.remove-column').forEach(button=>button.addEventListener('click',()=>{COLUMN_STEMTYPES.splice(Number(button.dataset.column),1);EXPANDED.clear();render();}));
    updateColumnBar();
    history.replaceState(null,'',`${location.pathname}?${viewerParams(q,q.lemma)}`);
  }
  async function loadData() {
    const q=query(); EXPANDED.clear(); $("summary").textContent='Loading attested forms…'; $("grid").innerHTML='';
    if(q.layout==='compare'){
      if(q.family==='verb'&&(!q.tense||!q.mood||!q.voice)){$("summary").textContent='Choose one tense, mood, and voice to compare verbal stemtypes.';return;}
      const key=q.family==='verb'?[q.tense,q.mood,q.voice].join('|'):q.family==='other'?'||':q.family,entry=PARADIGM_INDEX.paradigms.find(x=>x.paradigm===key);
      if(!entry){$("summary").textContent=`No forms are available for ${paradigmLabel(q)}.`;return;}
      DATA=await fetch(`paradigm-forms/${entry.file}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()});
      const works=new Set(q.works),eligibleRows=DATA.rows.filter(r=>rowFamily(r)===q.family&&(!works.size||works.has(r[0])));
      reconcileColumns(eligibleRows,key!==LOADED_PARADIGM);LOADED_PARADIGM=key;
    }else{
      const entry=INDEX.stemtypes.find(x=>x.stemtype===q.stemtype); if(!entry)return;
      DATA=await fetch(`stemtype-forms/${entry.file}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()});
      const family=recognizeFamily(DATA.rows);$("family").value=family;
      if(family!=='verb')for(const id of ['tense','mood','voice'])$(id).value='';
      LOADED_PARADIGM='';COLUMN_STEMTYPES=[];AVAILABLE_STEMTYPES=[];
      setLayoutControls();
    }
    render();
  }
  async function initialize() {
    [INDEX,PARADIGM_INDEX]=await Promise.all([fetch('stemtype-forms/index.json',{cache:'no-store'}).then(r=>r.json()),fetch('paradigm-forms/index.json',{cache:'no-store'}).then(r=>r.json())]); const p=new URLSearchParams(location.search);
    const legacySelected=p.get('layout')==='selected',explicitStemtype=p.has('stemtype')&&!p.has('layout');
    $("layout").value=explicitStemtype?'stemtype':'compare';
    $("stemtype").innerHTML=groupedStemtypeOptions(); $("stemtype").value=p.get('stemtype')||'w_stem';
    INITIAL_STEMTYPES=(p.get('stemtypes')||'').split(',').filter(Boolean).slice(0,6);
    const inferredFamily=INITIAL_STEMTYPES.length?stemtypeFamily(INITIAL_STEMTYPES[0]):'';
    $("family").value=['noun','adjective','other'].includes(p.get('family'))?p.get('family'):(legacySelected&&inferredFamily?inferredFamily:'verb');
    $("tense").innerHTML=options(Object.keys(LABELS.tense),LABELS.tense); $("mood").innerHTML=options(Object.keys(LABELS.mood),LABELS.mood); $("voice").innerHTML=options(Object.keys(LABELS.voice).filter(Boolean),LABELS.voice);
    $("tense").value=p.get('tense')||''; $("mood").value=p.get('mood')||''; $("voice").value=p.get('voice')||''; $("works").value=p.get('works')||''; $("limit").value=p.get('limit')||'3'; $("lemma").value=p.get('lemma')||''; $("scope").value=p.has('lemma')?'lemma':'class';
    if($("layout").value==='compare'&&$("family").value==='verb'){if(!$("tense").value)$("tense").value='a';if(!$("mood").value)$("mood").value='s';if(!$("voice").value)$("voice").value='a';}
    const setScope=()=>{$("lemma-field").classList.toggle('inactive',$("scope").value!=='lemma');$("lemma").disabled=$("scope").value!=='lemma';};
    setScope();setLayoutControls();
    $("scope").addEventListener('change',()=>{setScope();if($("scope").value==='lemma'&&!$("lemma").value){const first=$("lemma-options").querySelector('option');if(first)$("lemma").value=first.value;}render();});
    $("lemma").addEventListener('change',()=>{$("scope").value='lemma';setScope();render();});
    $("layout").addEventListener('change',()=>{COLUMN_STEMTYPES=[];INITIAL_STEMTYPES=[];if($("layout").value==='compare'&&$("family").value==='verb'){if(!$("tense").value)$("tense").value='a';if(!$("mood").value)$("mood").value='s';if(!$("voice").value)$("voice").value='a';}setLayoutControls();loadData();});
    $("family").addEventListener('change',()=>{COLUMN_STEMTYPES=[];INITIAL_STEMTYPES=[];LOADED_PARADIGM='';if($("family").value==='verb'){if(!$("tense").value)$("tense").value='a';if(!$("mood").value)$("mood").value='s';if(!$("voice").value)$("voice").value='a';}else for(const id of ['tense','mood','voice'])$(id).value='';setLayoutControls();loadData();});
    $("add-column").addEventListener('click',()=>{const next=AVAILABLE_STEMTYPES.find(item=>!COLUMN_STEMTYPES.includes(item.stemtype));if(next&&COLUMN_STEMTYPES.length<6){COLUMN_STEMTYPES.push(next.stemtype);EXPANDED.clear();render();}});
    $("show").addEventListener('click',loadData); $("stemtype").addEventListener('change',loadData); await loadData();
  }
  initialize().catch(error=>{$("summary").textContent=`Paradigm data unavailable: ${error.message}`});
})();
