const M=require('./market-intelligence.cjs');
const {key,localDay,sameMeasure}=require('./trade-store.cjs');
const groups=(rows,f)=>{
  const result=new Map();
  for(const row of rows){
    const k=f(row);
    if(!result.has(k))result.set(k,[]);
    result.get(k).push(row);
  }
  return [...result.values()];
};
const day=r=>localDay.format(new Date(r.checked));
const seriesKey=r=>JSON.stringify([r.product,r.source,r.place]);
const newest=rows=>[...rows].sort((a,b)=>b.checked.localeCompare(a.checked)||String(a.id).localeCompare(String(b.id)))[0];
const pct=(a,b)=>(a-b)/b*100;
const itemLabel=r=>r.name+(r.presentation&&!M.measure(r.name)?' '+r.presentation:'');
const sameItem=(a,b)=>M.compatible([{name:itemLabel(a)},{name:itemLabel(b)}])&&
  (!a.brand||!b.brand||key(a.brand)===key(b.brand))&&
  (!a.presentation||!b.presentation||key(a.presentation)===key(b.presentation)||sameMeasure(a.presentation,b.presentation));
const locationKey=r=>JSON.stringify([r.store,r.branch].map(key));
const stores={disco:'Disco',devoto:'Devoto',frog:'Frog',tata:'Ta-Ta',eldorado:'El Dorado',tiendainglesa:'Tienda Inglesa'};
const fieldMatch=(r,f)=>['name','category','brand','store','branch'].every(k=>!f[k]||key(r[k]||'').includes(key(f[k])))&&
  (!f.product||r.product===f.product)&&(!f.from||day(r)>=f.from)&&(!f.to||day(r)<=f.to);

function analyzeTrade(observations,digital,own,filters={},now=Date.now(),recentHours=48) {
  const physical=observations.filter(r=>r.status==='validado'&&Date.parse(r.checked)<=now)
    .map(r=>({...r,source:'presencial'}));
  const lookup=new Map(groups(physical.filter(r=>r.code),r=>r.code).map(rows=>[rows[0].code,rows]));
  const online=digital.flatMap(r=>{
    const code=M.gtin(r.product);
    const candidates=lookup.get(code);
    if(!candidates?.length||r.available!==1||r.promotion||!Number.isFinite(r.price)||r.price<=0||
       !Number.isFinite(Date.parse(r.checked))||Date.parse(r.checked)>now)return [];
    const quote={...r,product:code,code,source:'digital',store:stores[r.store]||r.store,
      branch:r.branch,price:Math.round(r.price*100),presentation:'',address:'',zone:''};
    if(!candidates.every(row=>sameItem(row,quote)))return [];
    return [{...quote,place:locationKey(quote)}];
  });
  const matched=[...physical,...online].filter(r=>fieldMatch(r,filters));
  const visible=physical.filter(r=>fieldMatch(r,filters));
  const fresh=r=>Date.parse(r.checked)<=now&&now-Date.parse(r.checked)<=recentHours*3600000;
  const comparisons=groups(matched,r=>JSON.stringify([r.product,r.source,day(r)])).flatMap(rows=>{
    const quotes=groups(rows,r=>r.place).map(newest).sort((a,b)=>a.price-b.price);
    if(quotes.length<2||!quotes.every(q=>sameItem(q,quotes[0])))return [];
    const first=quotes[0],last=quotes.at(-1);
    return [{product:first.product,name:first.name,source:first.source,date:day(first),quotes,
      min:first.price,max:last.price,gap:pct(last.price,first.price),recent:quotes.every(fresh)}];
  }).sort((a,b)=>b.date.localeCompare(a.date)||b.gap-a.gap);
  const channels=groups(matched,r=>JSON.stringify([r.product,locationKey(r),day(r)])).flatMap(rows=>{
    const inStore=groups(rows.filter(r=>r.source==='presencial'),r=>r.place);
    const web=newest(rows.filter(r=>r.source==='digital'));
    if(inStore.length!==1||!web)return [];
    const local=newest(inStore[0]);
    return [{local,web,delta:local.price-web.price,percent:pct(local.price,web.price)}];
  }).sort((a,b)=>b.local.checked.localeCompare(a.local.checked));
  const series=groups(matched,seriesKey).map(rows=>{
    const ordered=rows.sort((a,b)=>a.checked.localeCompare(b.checked)),first=ordered[0],last=ordered.at(-1);
    return {product:last.product,name:last.name,store:last.store,branch:last.branch,source:last.source,
      delta:last.price-first.price,percent:pct(last.price,first.price),
      points:ordered.map(r=>({checked:r.checked,price:r.price,id:r.id,promo:r.promo??null}))};
  });
  const history=new Map(groups([...physical,...online],seriesKey).map(r=>[seriesKey(r[0]),r]));
  const recommendations=groups(matched,seriesKey).map(newest).flatMap(row=>{
    if(!fresh(row))return [];
    const prev=newest((history.get(seriesKey(row))||[]).filter(r=>r.checked<row.checked));
    const ours=newest(own.filter(o=>o.product===row.product&&o.scope===row.source&&day(o)===day(row)&&fresh(o)));
    if(!prev||!ours||row.price===prev.price)return [];
    const movement=pct(row.price,prev.price);
    const gap=row.price-ours.price;
    const kind=movement>0&&gap>0?'Oportunidad':movement<=-10&&gap<0?'Amenaza':'';
    if(!kind)return [];
    return [{kind,row,previous:prev,own:ours.price,ownChecked:ours.checked,delta:gap,percent:pct(row.price,ours.price),movement,
      action:kind==='Oportunidad'?'Evaluá comunicar el ahorro de este producto en la zona. Verificá stock y condiciones antes de anunciarlo.':
        'Revisá el margen de este producto y evaluá una promoción acotada o una oferta alternativa en esta zona.'}];
  }).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));
  const points=groups(visible,r=>r.place).map(rows=>{
    const latest=newest(rows);
    return {id:latest.place,store:latest.store,branch:latest.branch,address:latest.address,zone:latest.zone,
      lat:latest.lat,lng:latest.lng,checked:latest.checked,products:new Set(rows.map(r=>r.product)).size,
      differences:comparisons.filter(c=>c.source==='presencial'&&c.date===day(latest)&&c.quotes.some(q=>q.place===latest.place)).slice(0,5),
      recommendations:recommendations.filter(r=>r.row.place===latest.place).slice(0,5)};
  });
  return {
    stats:{products:new Set(visible.map(r=>r.product)).size,stores:new Set(visible.map(r=>key(r.store))).size,
      branches:points.length,last:newest(visible)?.checked||null,recent:visible.filter(fresh).length},
    activity:groups(visible,r=>r.user).map(rows=>({employee:rows[0].employee,observations:rows.length,visits:new Set(rows.map(r=>r.visit)).size})),
    comparisons,channels,series,recommendations,points,
    promotions:visible.filter(r=>r.promo!=null),
  };
}
module.exports={analyzeTrade};
