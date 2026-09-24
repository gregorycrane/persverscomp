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
  const EXPANDED = new Set();
  function options(values, labels, any=true) { return (any?'<option value="">Any</option>':'') + values.map(v=>`<option value="${esc(v)}">${esc(labels?.[v]||v)}</option>`).join(''); }
  function query() { return {layout:$("layout").value,family:$("family").value,stemtype:$("stemtype").value,scope:$("scope").value,lemma:$("scope").value==='lemma'?$("lemma").value.trim():'',tense:$("tense").value,mood:$("mood").value,voice:$("voice").value,works:$("works").value.split(',').map(v=>v.trim()).filter(Boolean),limit:Number($("limit").value)}; }
  function slot(r) {
    const mood=r[6], person=r[8], number=r[9], gender=r[10], cas=r[11];
    if(r[4]==='n'||r[4]==='a') return `${LABELS.number[number]||'?'} ${LABELS.case[cas]||'?'} ${LABELS.gender[gender]||'?'}`;
    if(mood==='n') return 'INF';
    if(mood==='p') return `PART ${LABELS.number[number]||'?'} ${LABELS.case[cas]||'?'} ${LABELS.gender[gender]||'?'}`;
    if(person && number) return `${person}${LABELS.number[number]||number}`;
    if(number||gender||cas) return `${LABELS.number[number]||number} ${LABELS.case[cas]||cas} ${LABELS.gender[gender]||gender}`.trim();
    return 'OTHER';
  }
  function column(r,q) { return q.layout==='compare'?r[13]:[r[5],r[6],r[7]].join('|'); }
  function columnLabel(key,q) { if(q.layout==='compare')return key; const [t,m,v]=key.split('|'); return [LABELS.tense[t]||t,LABELS.mood[m]||m,LABELS.voice[v]||v].filter(Boolean).join(' '); }
  function paradigmLabel(q) { if(q.family==='noun')return 'Noun declension';if(q.family==='adjective')return 'Adjective declension';return [LABELS.tense[q.tense]||q.tense,LABELS.mood[q.mood]||q.mood,LABELS.voice[q.voice]||q.voice].filter(Boolean).join(' '); }
  function nominalRank(value) { const [num,cas,gen]=value.replace(/^PART /,'').split(' '),at=(values,item)=>{const i=values.indexOf(item);return i<0?9:i;};return at(["SG","DU","PL"],num)*100+at(["NOM","GEN","DAT","ACC","VOC"],cas)*10+at(["M","F","N","C"],gen); }
  function formLink(form, works) { const p=new URLSearchParams({q:form,mode:'form'}); if(works.length)p.set('works',works.join(',')); return `./search/index.html?${p}`; }
  function gloss(lemma) { return (DATA.glosses?.[lemma] || []).join('; '); }
  function lemmaLabel(lemma) { const text=gloss(lemma); return `<a class="lemma" href="./paradigm-viewer.html?${viewerParams(query(),lemma)}">${esc(lemma)}</a>${text?`<span class="lemma-gloss">${esc(text)}</span>`:''}`; }
  function viewerParams(q, lemma='') { const p=new URLSearchParams({stemtype:q.stemtype});if(q.layout==='compare'){p.set('layout','compare');if(q.family!=='verb')p.set('family',q.family);}for(const k of ['tense','mood','voice'])if(q[k]&&(q.layout!=='compare'||q.family==='verb'))p.set(k,q[k]);if(q.works.length)p.set('works',q.works.join(','));if(q.limit!==3)p.set('limit',String(q.limit));if(lemma)p.set('lemma',lemma);return p; }
  function populateLemmas(rows) { const counts=new Map(); for(const r of rows)counts.set(r[3],(counts.get(r[3])||0)+r[12]); $("lemma-options").innerHTML=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([lemma,count])=>`<option value="${esc(lemma)}">${fmt(count)} tokens</option>`).join(''); return counts; }
  function render() {
    const q=query(), works=new Set(q.works);
    const useVerbFilters=q.layout!=='compare'||q.family==='verb';
    const classRows=DATA.rows.filter(r=>(!works.size||works.has(r[0]))&&(!useVerbFilters||!q.tense||r[5]===q.tense)&&(!useVerbFilters||!q.mood||r[6]===q.mood)&&(!useVerbFilters||!q.voice||r[7]===q.voice));
    const lemmaCounts=populateLemmas(classRows);
    const rows=q.lemma?classRows.filter(r=>r[3]===q.lemma):classRows;
    const columnTotals=new Map(); for(const r of rows){const key=column(r,q);columnTotals.set(key,(columnTotals.get(key)||0)+r[12]);}
    const columns=[...columnTotals.keys()].sort((a,b)=>q.layout==='compare'?(columnTotals.get(b)-columnTotals.get(a)||a.localeCompare(b)):columnLabel(a,q).localeCompare(columnLabel(b,q)));
    const cells=new Map();
    for(const r of rows){ const key=`${slot(r)}\t${column(r,q)}`; if(!cells.has(key))cells.set(key,{total:0,forms:new Map()}); const c=cells.get(key); c.total+=r[12]; const fk=`${r[2]}\t${r[3]}`; c.forms.set(fk,(c.forms.get(fk)||0)+r[12]); }
    let slots=[...new Set(rows.map(slot))]; slots.sort((a,b)=>{const ai=ORDER.indexOf(a.split(' ')[0]),bi=ORDER.indexOf(b.split(' ')[0]);if(ai===ORDER.indexOf('PART')&&bi===ai)return nominalRank(a)-nominalRank(b)||a.localeCompare(b);if(ai>=0||bi>=0)return (ai<0?99:ai)-(bi<0?99:bi)||a.localeCompare(b);return nominalRank(a)-nominalRank(b)||a.localeCompare(b)});
    const total=rows.reduce((sum,r)=>sum+r[12],0), forms=new Set(rows.map(r=>r[2])).size, lemmas=new Set(rows.map(r=>r[3])).size;
    const selectedGloss=q.lemma?gloss(q.lemma):'';
    const scopeText=q.lemma?`lemma <span class="summary-lemma">${esc(q.lemma)}</span>${selectedGloss?` <span class="summary-gloss">${esc(selectedGloss)}</span>`:''}`:(q.layout==='compare'?`all stemtypes · ${esc(paradigmLabel(q))}`:`stemtype ${esc(q.stemtype)}`);
    const back=q.lemma?`<a class="scope-link" href="./paradigm-viewer.html?${viewerParams(q)}">← Back to ${q.layout==='compare'?'all lemmas':esc(q.stemtype)+' overview'}</a>`:'';
    const unit=q.layout==='compare'?'stemtype assignments':'tokens';
    $("summary").innerHTML=`<strong>${fmt(total)} ${unit}</strong> · <span>${scopeText}: ${fmt(forms)} surface forms from ${fmt(lemmas)} lemma${lemmas===1?'':'s'} across ${fmt(columns.length)} column${columns.length===1?'':'s'} in ${works.size?fmt(works.size):'all available'} work${works.size===1?'':'s'}</span>${back}`;
    let h=`<thead><tr><th class="slot">Slot</th>${columns.map(c=>`<th>${esc(columnLabel(c,q))}<small>${fmt(columnTotals.get(c))}</small></th>`).join('')}</tr></thead><tbody>`;
    for(const s of slots){ h+=`<tr><th class="slot">${esc(s)}</th>`; for(const col of columns){const cellKey=`${s}\t${col}`,c=cells.get(cellKey); if(!c){h+='<td class="empty">—</td>';continue;} const ranked=[...c.forms].map(([k,count])=>{const [form,lemma]=k.split('\t');return{form,lemma,count}}).sort((a,b)=>b.count-a.count||a.form.localeCompare(b.form)); const expanded=EXPANDED.has(cellKey),visible=q.limit&&!expanded?ranked.slice(0,q.limit):ranked; h+=`<td><div class="cell-head"><span>${fmt(ranked.length)} form${ranked.length===1?'':'s'}</span><span class="cell-total">${fmt(c.total)}</span></div><div class="forms">${visible.map(x=>`<div class="form-row"><span><a href="${formLink(x.form,q.works)}" target="_blank" rel="noopener">${esc(x.form)}</a>${lemmaLabel(x.lemma)}</span><b>${fmt(x.count)}</b></div>`).join('')}</div>${q.limit&&!expanded&&ranked.length>q.limit?`<button class="more" data-key="${esc(cellKey)}">+ ${fmt(ranked.length-q.limit)} more</button>`:''}</td>`;} h+='</tr>'; }
    $("grid").innerHTML=h+'</tbody>';
    document.querySelectorAll('.more').forEach(button=>button.addEventListener('click',()=>{ EXPANDED.add(button.dataset.key); render(); }));
    history.replaceState(null,'',`${location.pathname}?${viewerParams(q,q.lemma)}`);
  }
  async function loadData() {
    const q=query(); EXPANDED.clear(); $("summary").textContent='Loading attested forms…'; $("grid").innerHTML='';
    if(q.layout==='compare'){
      if(q.family==='verb'&&(!q.tense||!q.mood||!q.voice)){$("summary").textContent='Choose one tense, mood, and voice to compare verbal stemtypes.';return;}
      const key=q.family==='verb'?[q.tense,q.mood,q.voice].join('|'):q.family,entry=PARADIGM_INDEX.paradigms.find(x=>x.paradigm===key);
      if(!entry){$("summary").textContent=`No forms are available for ${paradigmLabel(q)}.`;return;}
      DATA=await fetch(`paradigm-forms/${entry.file}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()});
    }else{
      const entry=INDEX.stemtypes.find(x=>x.stemtype===q.stemtype); if(!entry)return;
      DATA=await fetch(`stemtype-forms/${entry.file}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()});
    }
    render();
  }
  async function initialize() {
    [INDEX,PARADIGM_INDEX]=await Promise.all([fetch('stemtype-forms/index.json',{cache:'no-store'}).then(r=>r.json()),fetch('paradigm-forms/index.json',{cache:'no-store'}).then(r=>r.json())]); const p=new URLSearchParams(location.search);
    $("layout").value=p.get('layout')==='compare'?'compare':'stemtype';
    $("family").value=['noun','adjective'].includes(p.get('family'))?p.get('family'):'verb';
    $("stemtype").innerHTML=options(INDEX.stemtypes.map(x=>x.stemtype),null,false); $("stemtype").value=p.get('stemtype')||'w_stem';
    $("tense").innerHTML=options(Object.keys(LABELS.tense),LABELS.tense); $("mood").innerHTML=options(Object.keys(LABELS.mood),LABELS.mood); $("voice").innerHTML=options(Object.keys(LABELS.voice).filter(Boolean),LABELS.voice);
    $("tense").value=p.get('tense')||''; $("mood").value=p.get('mood')||''; $("voice").value=p.get('voice')||''; $("works").value=p.get('works')||''; $("limit").value=p.get('limit')||'3'; $("lemma").value=p.get('lemma')||''; $("scope").value=p.has('lemma')?'lemma':'class';
    const setScope=()=>{$("lemma-field").classList.toggle('inactive',$("scope").value!=='lemma');$("lemma").disabled=$("scope").value!=='lemma';};
    const setLayout=()=>{const compare=$("layout").value==='compare',nominal=compare&&$("family").value!=='verb';$("family").disabled=!compare;$("family-field").classList.toggle('inactive',!compare);$("stemtype").disabled=compare;$("stemtype").closest('label').classList.toggle('inactive',compare);for(const id of ['tense','mood','voice']){$(id).disabled=nominal;$(id).closest('label').classList.toggle('inactive',nominal);}}; setScope();setLayout();
    $("scope").addEventListener('change',()=>{setScope();if($("scope").value==='lemma'&&!$("lemma").value){const first=$("lemma-options").querySelector('option');if(first)$("lemma").value=first.value;}render();});
    $("lemma").addEventListener('change',()=>{$("scope").value='lemma';setScope();render();});
    $("layout").addEventListener('change',()=>{if($("layout").value==='compare'&&$("family").value==='verb'){if(!$("tense").value)$("tense").value='a';if(!$("mood").value)$("mood").value='s';if(!$("voice").value)$("voice").value='a';}setLayout();loadData();});
    $("family").addEventListener('change',()=>{setLayout();loadData();});
    $("show").addEventListener('click',loadData); $("stemtype").addEventListener('change',loadData); await loadData();
  }
  initialize().catch(error=>{$("summary").textContent=`Paradigm data unavailable: ${error.message}`});
})();
