const B=Bench,KEY='radar-benchmark-v2',$=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notify(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('#toast').hidden=true,4500)}
function safeLink(url,label='Abrir fuente ↗'){try{return'<a href="'+esc(B.url(url))+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>'}catch{return'<span>Enlace no disponible</span>'}}
function loadStudy(raw){if(!raw||raw.version!==2||!Array.isArray(raw.competitors)||raw.competitors.length!==3||!Array.isArray(raw.evidence)||raw.evidence.length>120)throw Error('Este archivo no es un proyecto de benchmarking válido.');const s={version:2,project:B.project(raw.project),competitors:raw.competitors.map((c,i)=>B.competitor(c,B.IDS[i])),evidence:raw.evidence.map(B.evidence),report:null,example:false};s.fieldBenchmark=FieldBenchmark.normalize(raw.fieldBenchmark,s.competitors);s.marketFormat=B.str(raw.marketFormat,30);s.marketBasket=MarketOpening.normalize(raw.marketBasket);if(Number.isInteger(raw.marketBasketTarget)&&raw.marketBasketTarget>=0&&raw.marketBasketTarget<=99)s.marketBasketTarget=raw.marketBasketTarget;if(new Set(s.evidence.map(e=>e.id)).size!==s.evidence.length)throw Error('Evidencias duplicadas.');if(raw.report){const context=raw.reportContext?B.snapshot(raw.reportContext):B.snapshot(s);const validated=B.validateReport(raw.report,context);s.report=validated.report;s.reportContext=raw.reportContext||context;s.provenance=raw.provenance?.kind==='local'?{kind:'local',label:B.str(raw.provenance.label,200)}:raw.provenance?.kind==='api'?{kind:'importado',label:'Proyecto importado; origen API declarado en el archivo'}:{kind:'importado',label:'Herramienta declarada en un archivo importado; navegación no comprobada por la web'};}return s}
let study=B.blank(),benchMap=null,heatLayer=null,pointLayer=null;
try{const saved=localStorage.getItem(KEY);if(saved)study=loadStudy(JSON.parse(saved))}catch(e){$('#globalStatus').textContent='No se pudo restaurar el guardado: '+e.message+' Usá una copia del proyecto si la tenés.'}
function persist(){
 try{localStorage.setItem(KEY,JSON.stringify(study));$('#storageLabel').textContent='Guardado en este navegador · '+new Date().toLocaleTimeString('es-UY',{hour:'2-digit',minute:'2-digit'});$('#globalStatus').textContent='';return true}catch{$('#globalStatus').textContent='No se pudo guardar: puede faltar espacio para las capturas. Guardá una copia antes de cerrar.';return false}}
function navigate(view){document.querySelectorAll('[data-panel]').forEach(el=>el.hidden=el.dataset.panel!==view);document.querySelectorAll('nav [data-view]').forEach(el=>{el.classList.toggle('active',el.dataset.view===view);el.setAttribute('aria-current',el.dataset.view===view?'page':'false')});document.body.dataset.view=view;if(view==='informe'){renderField();renderMarket();void loadMarket()}if(view==='mapa')requestAnimationFrame(initBenchMap);window.scrollTo({top:0,behavior:'instant'})}
function fillProject(){const f=$('#projectForm');for(const k of Object.keys(study.project))f.elements[k].value=study.project[k]||'';$('#competitorFields').innerHTML=study.competitors.map((c,i)=>'<article class="card competitor-card"><div class="competitor-number">0'+(i+1)+'</div><span class="eyebrow">COMPETIDOR '+(i+1)+'</span><h2>'+esc(c.name||'Elegí una referencia')+'</h2><label>Referencia del directorio (opcional)<select data-directory="'+i+'"><option value="">Escribir mi propio competidor</option>'+DATA.competitors.map(d=>'<option value="'+esc(d.id)+'">'+esc(d.name)+'</option>').join('')+'</select></label><label>Nombre<input data-c="'+i+'" name="name'+i+'" data-key="name" value="'+esc(c.name)+'" required maxlength="120"></label><label>Web oficial<input data-c="'+i+'" name="website'+i+'" data-key="website" type="url" value="'+esc(c.website)+'" required maxlength="2000" placeholder="https://…"></label><label>¿Por qué compite con nosotros en esta zona?<textarea data-c="'+i+'" name="localReason'+i+'" data-key="localReason" required maxlength="600" placeholder="Ubicación, público o necesidad que compartimos">'+esc(c.localReason)+'</textarea></label><div class="competitor-links">'+(c.website?safeLink(c.website,'Web ↗'):'')+'</div></article>').join('');document.querySelectorAll('[data-directory]').forEach(sel=>sel.onchange=()=>{const item=DATA.competitors.find(c=>c.id===sel.value);if(!item)return;const i=Number(sel.dataset.directory);document.querySelector('[name="name'+i+'"]').value=item.name;document.querySelector('[name="website'+i+'"]').value=item.url;});}
function download(name,content,mime='text/plain;charset=utf-8'){const url=URL.createObjectURL(new Blob([content],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}

function initBenchMap(){
  if(!window.L)return;
  if(!benchMap){
    benchMap=L.map('map',{scrollWheelZoom:false}).setView([-34.89,-56.17],12);
    addRadarBasemap(benchMap);benchMap.createPane('radarHeatPane');
    benchMap.getPane('radarHeatPane').style.zIndex=350;
    benchMap.getPane('radarHeatPane').style.pointerEvents='none';
    heatLayer=createSmoothHeat().addTo(benchMap);pointLayer=L.layerGroup().addTo(benchMap);
  }
  benchMap.invalidateSize();renderBenchMap(true);
}
function renderBenchMap(fit=false){
  const pilot=marketReference==='sipc';
  const pool=(pilot?sipcPilot.places:DATA.directory.branches).filter(b=>(!marketZone||b.neighborhood===marketZone)&&Number.isFinite(b.lat)&&Number.isFinite(b.lon));
  const chainKey=b=>pilot?b.store:b.storeId;
  const chain=$('#mapChain'),selected=chain.value;
  const chains=new Map(pool.map(b=>[chainKey(b),b.store]));
  chain.innerHTML='<option value="">Todas las cadenas</option>'+[...chains].sort((a,b)=>a[1].localeCompare(b[1],'es')).map(([id,name])=>'<option value="'+esc(id)+'">'+esc(name)+'</option>').join('');
  chain.value=chains.has(selected)?selected:'';
  const branches=pool.filter(b=>!chain.value||chainKey(b)===chain.value);
  const counts=new Map((marketReportState?.stores||[]).map(store=>[store.store,store.comparable]));
  const count=branch=>pilot?(counts.get(branch.id)||0):0;
  const ranked=pilot?[...branches].sort((a,b)=>count(b)-count(a)||a.name.localeCompare(b.name,'es')):[];
  const listed=ranked.filter(branch=>count(branch)>0);
  $('#marketMapSummary').innerHTML=pilot?
    '<article class="card market-map-list"><div class="market-heading"><div><h2>Sucursales para visitar</h2><p class="mini">'+listed.length+' de '+branches.length+' sucursales de esta vista tienen productos comparables en la muestra del MEF.</p></div><button class="quiet" type="button" data-view="informe">Ver comparación de precios</button></div>'+
    (listed.length?'<p>Empezá por las sucursales con más referencias para verificar surtido, stock y precio en góndola.</p><ul>'+listed.slice(0,3).map(b=>'<li><strong>'+esc(b.name)+'</strong> · '+esc(b.address)+' · '+count(b)+' comparables</li>').join('')+'</ul>':'<p>Elegí otra cadena o barrio para encontrar referencias comparables.</p>')+
    (ranked.length>3?'<details class="market-detail"><summary>Ver todas las sucursales de la vista</summary><ul>'+ranked.map(b=>'<li>'+esc(b.name)+' · '+esc(b.address)+' · '+count(b)+' comparables</li>').join('')+'</ul></details>':'')+'</article>':
    '<p class="caption">Elegí un barrio para cruzar el mapa con las declaraciones del MEF.</p>';
  if(!benchMap)return;
  pointLayer.clearLayers();heatLayer.setData(branches,Number($('#mapRadius').value));
  if($('#showHeat').checked){if(!benchMap.hasLayer(heatLayer))heatLayer.addTo(benchMap);}
  else if(benchMap.hasLayer(heatLayer))heatLayer.removeFrom(benchMap);
  if($('#showPoints').checked)for(const b of branches)L.circleMarker([b.lat,b.lon],{radius:count(b)?6:4,weight:1,color:'#fff',fillColor:count(b)?'#22694e':'#557e6a',fillOpacity:.85})
    .bindPopup('<strong>'+esc(b.name)+'</strong><br>'+esc(b.address)+(pilot?'<br>'+count(b)+' productos comparables':'')+'<br>'+safeLink(b.source)).addTo(pointLayer);
  if(fit&&marketZone&&branches.length)benchMap.fitBounds(branches.map(b=>[b.lat,b.lon]),{maxZoom:15,padding:[30,30]});
  else if(fit&&!marketZone)benchMap.setView([-34.89,-56.17],12);
}

function saveCompetitors(){
  const next=study.competitors.map((competitor,i)=>{
    const value=key=>$('#competitorForm').elements[key+i].value;
    const name=value('name'),website=value('website');
    const social=name.trim()===competitor.name && B.url(website,true)===competitor.website?competitor.social:'';
    return B.competitor({name,website,localReason:value('localReason'),social},competitor.id);
  });
  if(next.some(c=>!c.name||!c.localReason))throw Error('Completá el nombre y el motivo de comparación de cada competidor.');
  if(new Set(next.map(c=>c.name.toLowerCase())).size!==3)throw Error('Elegí tres competidores distintos.');
  study.competitors=next;
  persist();
}

function init(){
  fillProject();
  if(location.protocol==='file:')for(const id of ['tradeEntry','tradeHeroEntry'])$('#'+id).hidden=true;
  $('#toast').hidden=true;
  document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>navigate(el.dataset.view));
  $('.brand').onclick=event=>{event.preventDefault();navigate('inicio')};
  $('#startStudy').onclick=()=>$('#projectStart').scrollIntoView({behavior:'smooth',block:'start'});
  $('#showExample').onclick=()=>navigate('informe');
  $('#projectForm').onsubmit=event=>{
    event.preventDefault();
    if(!event.target.reportValidity())return;
    study.project=B.project(Object.fromEntries(Object.keys(study.project).map(key=>[key,event.target.elements[key].value])));
    persist();
    navigate('competidores');
  };
  $('#competitorForm').onsubmit=event=>{
    event.preventDefault();
    try{
      if(!event.target.reportValidity())return;
      saveCompetitors();
      fillProject();
      navigate('informe');
    }catch(error){notify(error.message)}
  };
  $('#exportProject').onclick=()=>download('radar-proyecto-benchmarking.json',JSON.stringify(study,null,2),'application/json');
  $('#projectFile').onchange=async event=>{
    try{
      const file=event.target.files[0];
      if(!file)return;
      if(file.size>7000000)throw Error('La copia debe pesar menos de 7 MB.');
      const next=loadStudy(JSON.parse(await file.text()));
      try{localStorage.setItem(KEY+'-anterior',JSON.stringify(study))}catch{}
      study=next;
      persist();
      fillProject();
      navigate('informe');
      notify('Proyecto abierto.');
    }catch(error){notify(error.message)}
    finally{event.target.value=''}
  };
  $('#helpOpen').onclick=()=>$('#helpDialog').showModal();
  $('#helpClose').onclick=()=>$('#helpDialog').close();
  
  for(const id of ['mapChain','mapRadius','showHeat','showPoints'])$('#'+id).onchange=()=>renderBenchMap();
  $('#marketMapSummary').onclick=event=>{if(event.target.dataset.view==='informe')navigate('informe');};
}

init();
initField();
initMarket();
initMarketProduct();
