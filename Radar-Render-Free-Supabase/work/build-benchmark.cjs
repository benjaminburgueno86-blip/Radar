const fs=require('node:fs');
const Market=require('./market-intelligence.cjs'),MarketReport=require('./market-report.cjs');
const read=p=>fs.readFileSync(p,'utf8');
const raw=JSON.parse(read('outputs/datos-gondolupa.json')),coverage=JSON.parse(read('outputs/competidores-ampliados.json')),directory=structuredClone(raw.directory);
for(const b of coverage.branches)if(!directory.branches.some(x=>x.id===b.id))directory.branches.push(b);
const data={directory,competitors:coverage.competitors};
const referenceDay='2026-10-20';
const referenceCut=Market.analyze(raw.observations.filter(o=>['disco','devoto','frog'].includes(o.store)),{period:referenceDay+'|source-branch'});
const reference={
  day:referenceCut.day,
  stores:referenceCut.stores.map(s=>({name:coverage.competitors.find(c=>c.id===s.store)?.name||s.store,branch:s.branch})),
  items:referenceCut.products.filter(p=>p.quotes.length===referenceCut.stores.length).map(p=>({
    code:p.code,name:p.name,quotes:referenceCut.stores.map(s=>p.quotes.find(q=>q.store===s.store)),
  })),
};
const js=read('work/benchmark-app.js');new Function(js);new Function(read('work/benchmark-core.cjs'));
let html=read('work/benchmark-shell.html');
const put=(mark,value)=>{if(!html.includes(mark))throw Error('Falta '+mark);html=html.replace(mark,()=>value)};
const marketStyles=read('work/market-report.css');
put('/*CSS*/',[read('work/benchmark.css'),read('work/benchmark-field.css'),marketStyles].join('\n'));html=html.replace('<style>','<style id="appStyles">');
put('/*LEAFLET_CSS*/',read('work/vendor/leaflet.css'));
const embed=(name,value)=>'const '+name+'='+JSON.stringify(value).replaceAll('<','\\u003c')+';';
put('/*DATA*/',embed('DATA',data)+embed('FIELD_REFERENCE',reference)+embed('MARKET_SNAPSHOT',raw.observations)+embed('SIPC_PILOT',JSON.parse(read('work/sipc-pilot.json'))));
put('/*CORE*/',['benchmark-core.cjs','benchmark-field.cjs','market-intelligence.cjs','market-strategy.cjs','market-report.cjs','market-opening.cjs'].map(f=>read('work/'+f)).join('\n'));
put('/*LEAFLET_JS*/',read('work/vendor/leaflet.js').replace(/\/\/# sourceMappingURL=.*$/m,''));
put('/*MAP*/',read('work/smooth-heat.js')+'\n'+read('work/map-basemap.js'));put('/*APP*/',[read('work/benchmark-field-ui.js'),read('work/market-opening-ui.js'),read('work/market-ui.js'),read('work/market-product-ui.js'),js].join('\n'));
for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Function(m[1]);
fs.writeFileSync('outputs/monitor-competencia.html',html);console.log('Benchmarking guardado: '+html.length+' caracteres; '+directory.branches.length+' locales conservados.');
const tradeJs=read('work/trade-ui.js');
new Function(tradeJs);
const trade=read('work/trade-shell.html')
  .replace('/*CSS*/',()=>['benchmark.css','vendor/leaflet.css','trade.css'].map(file=>read('work/'+file)).join('\n'))
  .replace('/*LEAFLET*/',()=>read('work/vendor/leaflet.js').replace(/\/\/# sourceMappingURL=.*$/m,''))
  .replace('/*MAP*/',()=>read('work/smooth-heat.js')+'\n'+read('work/map-basemap.js'))
  .replace('/*APP*/',()=>tradeJs);
fs.writeFileSync('outputs/radar-trade.html',trade);
const names={...Object.fromEntries(coverage.competitors.map(c=>[c.id,c.name])),tiendainglesa:'Tienda Inglesa'};
const exampleMarket=MarketReport.render(Market.analyze(raw.observations),names,{format:'minimercado'});
const sampleCss='body{font:15px/1.45 system-ui,sans-serif;background:#f3f5ef;color:#173a2e;padding:1rem}main{max-width:1100px;margin:auto;background:#fff;padding:clamp(.8rem,3vw,2rem);border-radius:1rem}a{color:#285f4b}small{display:block}.tablewrap{overflow:auto}table{border-collapse:collapse}th,td{border-bottom:1px solid #d9e2d6;text-align:left}summary{margin-bottom:.55rem}button{padding:.55rem .75rem;cursor:pointer}@media print{body,main{background:#fff;margin:0;padding:0}button{display:none}}';
fs.writeFileSync('outputs/ejemplo-inteligencia-gondolupa.html',
  '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gondolupa · Informe de ejemplo</title><style>'+sampleCss+'\n'+marketStyles+'</style><body><main class="market-report"><h1>Gondolupa · Informe de ejemplo</h1><p>Tipo de comercio · Minimercado. Fuente · Copia de las observaciones de Gondolupa.</p><button type="button" onclick="window.print()">Guardar en PDF</button>'+
  exampleMarket.replaceAll('<details class="market-detail">','<details class="market-detail" open>')+'</main></body></html>');
