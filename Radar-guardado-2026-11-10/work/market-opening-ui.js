const sipcPilot=MarketOpening.reference(SIPC_PILOT);
const marketZones=[...new Set(sipcPilot.places.map(place=>place.neighborhood))].sort((a,b)=>a.localeCompare(b,'es'));
let marketZone='',marketReference='catalog';

function marketPlaceName(store) {
  const name=marketNames[store.store]||store.store;
  return store.branch===name||store.branch.toLowerCase().includes(name.toLowerCase())?store.branch:name+' · '+store.branch;
}
function selectMarketZone(zone) {
  marketZone=marketZones.includes(zone)?zone:'';
  marketReference=marketZone?'sipc':'catalog';
  $('#mapChain').value='';
  renderMarket();
  renderBenchMap(true);
}
function marketProductButton(p) {
  return '<button type="button" class="text-action" data-market-product="'+esc(p.code)+'">Ver precios y fuentes</button>';
}
function renderOpening(report,products,{keepInputs=false}={}) {
  const {price,percent}=MarketStrategy;
  const allItems=MarketOpening.normalize(study.marketBasket);
  const items=allItems.filter(item=>item.code.startsWith('sipc:')===(marketReference==='sipc'));
  const target=study.marketBasketTarget??25;
  const basket=MarketOpening.compare(report,items,target);
  const name=line=>line.product?.name||'Código '+line.code;
  const {gap,trial,missing,confirm}=MarketOpening.actions(products,basket);
  const step=(number,title,body,product)=>'<article><span class="eyebrow">'+number+'</span><h3>'+title+'</h3><p>'+body+'</p>'+(product?marketProductButton(product):'')+'</article>';
  const low=gap?.quotes[0],high=gap?.quotes.at(-1);
  const trialLow=trial?.quotes[0];
  const known=basket.lines.find(line=>line.product===gap);
  const floor=known?.floor??gap?.floor??null;
  $('#marketActions').innerHTML=gap?'<div class="market-action-grid">'+
    step('01','Qué precio revisar','<b>'+esc(gap.name)+'</b>. '+(low.price===high.price?'Se observó el mismo precio de <b>'+price(low.price)+'</b> en '+esc(marketPlaceName(low))+' y '+esc(marketPlaceName(high))+'. ':'Se observó a <b>'+price(low.price)+'</b> en '+esc(marketPlaceName(low))+' y a <b>'+price(high.price)+'</b> en '+esc(marketPlaceName(high))+'. ')+
      (floor===null?'Comprobá tu costo antes de igualar un precio.':floor>low.price?'Tu piso es '+price(floor)+'. Evaluá un precio por encima del mínimo.':'Podés evaluar igualar el mínimo con un piso de '+price(floor)+'.'),gap)+
    step('02','Qué producto probar',esc(trial.name)+' tiene referencia en <b>'+trial.quotes.length+' sucursales</b>. En '+esc(marketPlaceName(trialLow))+' se observó a '+price(trialLow.price)+'. Probá un lote chico y medí cuánto vendés.',trial)+
    step('03','Qué confirmar',confirm&&missing?.missing.includes(confirm)?'Verificá '+esc(name(confirm))+' en '+esc(marketPlaceName(missing))+'. Falta ese precio para cerrar su total de canasta.':
      confirm?'Pedí el costo unitario de '+esc(name(confirm))+' para calcular tu precio mínimo.':'Confirmá el precio y el stock de '+esc(trial.name)+' en '+esc(marketPlaceName(trialLow))+' antes de decidir el pedido.',confirm?.product||trial)+'</div>':
    '<p class="notice amber">Para recomendar una acción hacen falta precios comparables. Probá otra referencia o elegí otro barrio.</p>';
  const available=products.filter(p=>!items.some(item=>item.code===p.code));
  if(!keepInputs)$('#marketBasketProduct').innerHTML='<option value="">Elegí un producto</option>'+available.map(p=>'<option value="'+esc(p.code)+'">'+esc(p.name)+'</option>').join('');
  $('#marketBasketAdd').disabled=!available.length||allItems.length>=24;
  $('#marketBasketSuggested').disabled=!available.length||allItems.length>=24;
  $('#marketBasketSuggested').hidden=!!items.length;
  $('#marketBasketTarget').value=String(target);
  $('#marketMarginSettings').hidden=!basket.lines.length;
  const totals=rows=>'<ul class="market-totals">'+rows.map(s=>'<li><span>'+esc(marketPlaceName(s))+'</span><strong>'+price(s.total)+'</strong></li>').join('')+'</ul>';
  if(!keepInputs)$('#marketBasket').innerHTML='<ul class="market-basket-lines">'+basket.lines.map(line=>'<li><span>'+esc(name(line))+'</span><label>Cant. <input type="number" min="1" max="99" value="'+line.qty+'" data-market-qty="'+esc(line.code)+'" aria-label="Cantidad de '+esc(name(line))+'"></label><button type="button" class="quiet" data-market-remove="'+esc(line.code)+'">Quitar</button></li>').join('')+'</ul><div id="marketBasketResults"></div>';
  $('#marketBasketResults').innerHTML=!items.length?'<p class="mini">Agregá productos o elegí una selección sugerida para empezar.</p>':
    (basket.complete.length?'<p class="mini">'+basket.complete.length+' '+(basket.complete.length===1?'sucursal tiene':'sucursales tienen')+' todos los precios.</p>'+totals(basket.complete.slice(0,3))+
      (basket.complete.length>3?'<details class="market-detail"><summary>Ver más totales</summary>'+totals(basket.complete.slice(3))+'</details>':''):
      '<p class="mini">No hay una sucursal con todos los precios de esta canasta.</p>')+
    (basket.spread.length?'<p>La diferencia entre el total mayor y el menor es <b>'+price(basket.complete.at(-1).total-basket.complete[0].total)+'</b>. El mayor aporte a la diferencia es '+esc(name(basket.spread[0].line))+' ('+price(basket.spread[0].difference)+').</p>':'')+
    (basket.incomplete.length?'<details class="market-detail"><summary>Qué productos faltan por sucursal</summary><ul>'+basket.incomplete.map(s=>'<li><b>'+esc(marketPlaceName(s))+'</b> · '+s.missing.map(line=>esc(name(line))).join(', ')+'</li>').join('')+'</ul></details>':'');
  if(!keepInputs)$('#marketBasketMargins').innerHTML=basket.lines.map(line=>'<div class="market-margin-row"><label>'+esc(name(line))+'<input type="number" min="0" max="10000000" step="0.01" data-market-cost="'+esc(line.code)+'" value="'+(line.cost??'')+'" placeholder="Costo unitario (UYU)"></label><p></p></div>').join('');
  [...$('#marketBasketMargins').querySelectorAll('.market-margin-row p')].forEach((status,index)=>{
    const line=basket.lines[index];
    status.textContent=line.floor===null?'Agregá el costo para calcular tu piso.':'Piso '+price(line.floor)+' · '+(line.canMatch===null?'Falta un precio comparable.':line.canMatch?'Podés igualar '+price(line.product.min)+' con un margen de '+percent((line.product.min-line.cost)/line.product.min*100)+'.':'Igualar '+price(line.product.min)+' queda por debajo de tu objetivo.');
  });
}

function initOpening() {
  for(const id of ['marketZone','mapZone']){
    const select=$('#'+id);
    select.innerHTML+=marketZones.map(zone=>'<option value="'+esc(zone)+'">'+esc(zone)+'</option>').join('');
    select.onchange=()=>selectMarketZone(select.value);
  }
  $('#marketReference').onchange=event=>{
    marketReference=event.target.value;
    if(marketReference==='catalog')marketZone='';
    renderMarket();renderBenchMap(true);
  };
  $('#marketShowMap').onclick=()=>navigate('mapa');
  const refreshPrices=()=>{
    const category=$('#marketCategory').value;
    renderOpening(marketReportState,marketReportState.products.filter(p=>!category||p.category===category),{keepInputs:true});
  };
  const save=(items,editing=false)=>{
    study.marketBasket=MarketOpening.normalize(items);persist();
    if(editing)refreshPrices();else renderMarket();
  };
  const add=codes=>{
    const items=MarketOpening.normalize(study.marketBasket),existing=new Set(items.map(item=>item.code));
    save([...items,...codes.filter(code=>code&&!existing.has(code)).map(code=>({code,qty:1,cost:null}))]);
  };
  $('#marketBasketForm').onsubmit=event=>{event.preventDefault();add([$('#marketBasketProduct').value]);};
  $('#marketBasketSuggested').onclick=()=>{
    const choices=new Set([...$('#marketBasketProduct').querySelectorAll('option')].map(option=>option.value));
    const candidates=marketReportState.products.filter(p=>choices.has(p.code)).sort((a,b)=>b.quotes.length-a.quotes.length);
    add(MarketOpening.suggested(candidates));
  };
  $('#marketBasket').onclick=event=>{
    const code=event.target.dataset.marketRemove;
    if(code)save(MarketOpening.normalize(study.marketBasket).filter(item=>item.code!==code));
  };
  const edit=(event,attribute,field)=>{
    const input=event.target,code=input.dataset[attribute];
    if(!code)return;
    if(!input.checkValidity()||field==='qty'&&!input.value){input.reportValidity();return;}
    save(MarketOpening.normalize(study.marketBasket).map(item=>item.code===code?{...item,[field]:input.value===''?null:Number(input.value)}:item),true);
  };
  $('#marketBasket').onchange=event=>edit(event,'marketQty','qty');
  $('#marketBasketMargins').onchange=event=>edit(event,'marketCost','cost');
  $('#marketBasketTarget').onchange=event=>{
    const input=event.target;
    if(!input.value||!input.checkValidity()){input.reportValidity();return;}
    study.marketBasketTarget=Number(input.value);persist();refreshPrices();
  };
}
