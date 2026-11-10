let marketRows = MARKET_SNAPSHOT;
let marketLoadedAt=0;
let marketRequest=null;
let marketBranches = {};
let marketReportState;
let marketFreshness = {};
const marketNames = Object.fromEntries(DATA.competitors.map(c => [c.id, c.name]));
marketNames.tiendainglesa = 'Tienda Inglesa';
for(const place of sipcPilot.places)marketNames[place.id]=place.store;

function renderMarket() {
  const own = FieldBenchmark.normalize(study.fieldBenchmark, study.competitors);
  const sipc=marketReference==='sipc';
  const storeIds=new Set(sipcPilot.places.filter(place=>!marketZone||place.neighborhood===marketZone).map(place=>place.id));
  const rows=sipc?sipcPilot.observations.filter(row=>storeIds.has(row.store)):marketRows;
  const report = MarketIntelligence.analyze(rows, {
    ...marketFreshness, branches: marketBranches, ownItems: own.items, target: own.target,
  });
  marketReportState=report;
  $('#marketZone').value=marketZone;
  $('#mapZone').value=marketZone;
  $('#marketReference').value=marketReference;
  $('#marketContext').textContent=(marketZone?marketZone+' · ':'')+(sipc?'Precios declarados al MEF · Referencia histórica, stock sin confirmar.':
    'Precios de Radar · Comparación de la misma fecha y canal.');
  const category = $('#marketCategory');
  const selection = category.value;
  category.innerHTML = '<option value="">Todas</option>' + report.categories.map(c =>
    '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>').join('');
  category.value = report.categories.some(c => c.name === selection) ? selection : '';
  renderOpening(report,report.products.filter(p=>!category.value||p.category===category.value));
  $('#marketOrigin').hidden=sipc;
  $('#marketRefresh').hidden=sipc||location.protocol==='file:';
  $('#marketBranches').innerHTML = report.stores.filter(s => s.options.length > 1).map(s => '<label>Sucursal · ' +
    esc(marketNames[s.store] || s.store) + '<select data-market-store="' + esc(s.store) + '">' +
    s.options.map(b => '<option value="' + esc(b.name) + '"' + (b.name === s.branch ? ' selected' : '') + '>' +
      esc(b.name) + ' · ' + b.codes + ' precios elegibles</option>').join('') + '</select></label>').join('');
  $('#marketType').value = ['almacén', 'minimercado', 'supermercado', 'conveniencia'].includes(study.marketFormat)
    ? study.marketFormat : 'minimercado';
  $('#marketReport').innerHTML = MarketReport.render(report, marketNames, {
    format: $('#marketType').value, sort: $('#marketSort').value, category: category.value, interactive:true,
  });
  $('#marketPdf').disabled = !report.products.length;
}

function applyMarket(data){
  if(!Array.isArray(data.observations))throw Error('Respuesta sin observaciones.');
  marketRows=data.observations;
  marketFreshness={recentHours:data.recentHours,staleHours:data.staleHours};
  $('#marketOrigin').textContent='Fuente · Historial de Gondolupa';
  renderMarket();
  const last=new Map(marketReportState.latestByStore.map(row=>[row.store,row]));
  const sources=new Map((data.sourceStatus||[]).map(row=>[row.source,row]));
  const stores=new Set([...Object.keys(marketNames).filter(id=>!id.startsWith('sipc-')),...last.keys(),...(data.feeds||[]).map(f=>f.store)]);
  $('#marketSources').innerHTML=[...stores].map(store=>{
    const feeds=(data.feeds||[]).filter(f=>f.store===store),recent=last.get(store);
    const history=recent?'':' · sin precios registrados';
    const statuses=feeds.length?feeds.map(f=>{
      const status=sources.get(f.id);
      return status?status.status+' ('+status.count+') · consulta '+marketTime(status.started)+(status.error?' · '+status.error:''):'programada';
    }).join(', '):'sin fuente automática configurada';
    return '<li><strong>'+esc(marketNames[store]||store)+'</strong> · '+esc(statuses+history)+'</li>';
  }).join('');
}

function loadMarket() {
  if(marketRequest)return marketRequest;
  if(location.protocol==='file:'||Date.now()-marketLoadedAt<60000)return Promise.resolve();
  marketRequest=(async()=>{
    try{
      const response=await fetch('/api/benchmark/market-data',{signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw Error('La base no respondió.');
      applyMarket(await response.json());
      marketLoadedAt=Date.now();
    }catch{
      $('#marketOrigin').textContent=marketLoadedAt?'Fuente · Última consulta guardada en esta pestaña.':'Fuente · Copia incluida. No se pudo consultar la base.';
      renderMarket();
    }
  })().finally(()=>{marketRequest=null;});
  return marketRequest;
}

async function updateMarket(){
  const button=$('#marketRefresh'),message=$('#marketUpdateStatus');
  button.disabled=true;
  message.textContent='Consultando las fuentes configuradas…';
  try{
    const response=await fetch('/api/gondolupa/refresh',{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(400000),
    });
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'No se pudieron actualizar los precios.');
    applyMarket(result.market);
    message.textContent=!result.configured?'El administrador todavía no configuró fuentes automáticas.':
      result.results.reduce((n,r)=>n+(r.inserted||0),0)+' observaciones nuevas · '+result.results.filter(r=>r.status==='error').length+' fuentes con error.';
  }catch(error){message.textContent=error.message;}
  finally{button.disabled=false;}
}

function printMarket() {
  document.body.classList.add('market-print');
  const restore = () => document.body.classList.remove('market-print');
  window.addEventListener('afterprint', restore, { once: true });
  try { window.print(); } catch (error) { restore(); throw error; }
}

function initMarket() {
  initOpening();
  renderMarket();
  $('#marketBranches').onchange = event => {
    const store = event.target.dataset.marketStore;
    if (!store) return;
    marketBranches = { ...marketBranches, [store]: event.target.value };
    renderMarket();
  };
  $('#marketType').onchange = event => {
    study.marketFormat = event.target.value;
    persist();
    renderMarket();
  };
  for (const id of ['marketSort', 'marketCategory']) $('#' + id).onchange = renderMarket;
  $('#marketPdf').onclick = printMarket;
  $('#marketEdit').onclick = () => {
    $('#marketManual').open = true;
    $('#fieldEdit').open = true;
    $('#fieldHeading').scrollIntoView({ block: 'start' });
  };
  $('#marketRefresh').onclick=updateMarket;
  if (location.protocol === 'file:') $('#marketRefresh').hidden = true;
  else window.addEventListener('focus',()=>{if(document.body.dataset.view==='informe')void loadMarket();});
}
