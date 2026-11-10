const marketTime=value=>new Intl.DateTimeFormat('es-UY',{dateStyle:'short',timeStyle:'short',timeZone:'America/Montevideo'})
  .format(new Date(value));
let detailProduct='';
function productHistoryRows(){
  if(!detailProduct.startsWith('sipc:'))return marketRows;
  const stores=new Set(sipcPilot.places.filter(place=>!marketZone||place.neighborhood===marketZone).map(place=>place.id));
  return sipcPilot.observations.filter(row=>stores.has(row.store));
}

function openMarketProduct(code){
  detailProduct=MarketOpening.key(code);
  if(!detailProduct)return;
  const product=marketReportState?.products.find(p=>p.code===detailProduct);
  const sipc=detailProduct.startsWith('sipc:');
  const series=MarketIntelligence.history(productHistoryRows(),detailProduct);
  const last=series.flatMap(s=>s.points).sort((a,b)=>b.timestamp-a.timestamp)[0];
  $('#marketProductTitle').textContent=product?.name||last?.name||detailProduct;
  const {price,percent,opportunity}=MarketStrategy;
  const confidence=product
    ? (product.quotes.length>=3&&product.explicitSize===product.quotes.length&&product.quotes.every(q=>q.freshness==='reciente')?'Alta para el corte':'Moderada para el corte')
    : 'Sin comparación válida en el corte seleccionado';
  const o=product?opportunity(product):null;
  const m=product?.measurement;
  const pack=m?m.count+' × '+m.amount+' '+m.unit:'Sin contenido explícito en la ficha';
  $('#marketProductFacts').innerHTML='<p><b>'+(sipc?'Presentación SIPC':'GTIN')+'</b> '+esc(sipc?detailProduct.slice(5):detailProduct)+' · <b>Marca</b> '+esc(product?.brand||last?.brand||'Sin confirmar')+
    ' · <b>Presentación</b> '+esc(pack)+' · <b>Categoría</b> '+esc(product?.category||last?.category||'Sin clasificar')+'</p>'+
    '<p><b>Confianza</b> '+esc(confidence)+'</p>'+
    (product?'<p>Mínimo '+price(product.min)+' · máximo '+price(product.max)+' · promedio '+price(product.average)+' · mediana '+
      price(product.median)+' · brecha '+price(product.max-product.min)+' ('+percent(product.gap)+')</p><ul>'+
      product.quotes.map(q=>'<li>'+esc(marketNames[q.store]||q.store)+' · '+safeLink(q.url,price(q.price))+' · '+
        esc(q.branch)+' · '+(sipc?esc(q.checked.slice(0,10)):marketTime(q.checked))+'</li>').join('')+'</ul><p><b>Decisión</b> '+
      esc(o.action)+' '+esc(o.risk)+'</p>':'');
  if(sipc&&last){$('#marketHistoryRange').value='';$('#marketHistoryFrom').value='';$('#marketHistoryTo').value='';}
  else $('#marketHistoryRange').value='7';
  renderMarketHistory();
  if(!$('#marketProductDialog').open)$('#marketProductDialog').showModal();
}

function renderMarketHistory(){
  const days=Number($('#marketHistoryRange').value);
  const from=days?new Date(Date.now()-(days-1)*86400000).toISOString().slice(0,10):$('#marketHistoryFrom').value;
  const to=days?'':$('#marketHistoryTo').value;
  $('#marketHistoryCustom').hidden=!!days;
  const series=MarketIntelligence.history(productHistoryRows(),detailProduct,{from,to});
  const {price,percent}=MarketStrategy;
  const all=series.flatMap(s=>s.points);
  const min=Math.min(...all.map(p=>p.price)),max=Math.max(...all.map(p=>p.price));
  const earliest=Math.min(...all.map(p=>p.timestamp)),latest=Math.max(...all.map(p=>p.timestamp));
  const plot=series.map(s=>{
    const coords=s.points.map(p=>[6+(p.timestamp-earliest)/Math.max(latest-earliest,1)*308,
      80-(p.price-min)/Math.max(max-min,1)*66]);
    return '<svg class="market-spark" viewBox="0 0 320 86" role="img" aria-label="Evolución de precios">'+
      '<polyline fill="none" stroke="#337458" stroke-width="2" points="'+coords.map(p=>p.join(',')).join(' ')+'"></polyline>'+
      coords.map(([x,y])=>'<circle cx="'+x+'" cy="'+y+'" r="2.5" fill="#337458"></circle>').join('')+'</svg>';
  });
  $('#marketHistorySeries').innerHTML=series.length?series.map((s,i)=>'<article class="market-opportunity"><b>'+
    esc(marketPlaceName(s))+'</b><small>'+esc((s.scope==='sipc'?'Histórico del MEF':s.scope==='online'?'Catálogo online':'Sucursal')+(s.promotion?' · '+s.promotion:''))+'</small>'+
    plot[i]+'<p>'+s.points.length+' observaciones · '+(s.points.length<2?'Sin tendencia calculable':
      (s.change>0?'Sube':s.change<0?'Baja':'Estable')+' '+price(s.change)+' ('+percent(s.percent)+')')+
    '</p><p>Mín. '+price(s.min)+' · máx. '+price(s.max)+' · '+s.increases+' aumentos · '+s.decreases+' reducciones</p>'+
    '<details><summary>Ver fechas y fuentes</summary><ul>'+s.points.map(p=>'<li>'+(s.scope==='sipc'?esc(p.day):marketTime(p.checked))+' · '+safeLink(p.url,price(p.price))+'</li>').join('')+
    '</ul></details></article>').join(''):'<p>No hay observaciones válidas en el rango elegido.</p>';
}

function initMarketProduct(){
  $('#marketProductClose').onclick=()=>$('#marketProductDialog').close();
  const showProduct=event=>{
    const button=event.target.closest('[data-market-product]');
    if(button)openMarketProduct(button.dataset.marketProduct);
  };
  $('#marketReport').onclick=showProduct;
  $('#marketActions').onclick=showProduct;
  for(const id of ['marketHistoryRange','marketHistoryFrom','marketHistoryTo'])$('#'+id).onchange=renderMarketHistory;
}
