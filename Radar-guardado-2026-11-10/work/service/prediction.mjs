const normalize=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/(\d)([a-z])/g,'$1 $2').replace(/[^a-z0-9.,]+/g,' ').trim();
export const monthIndex=s=>Number(s.slice(0,4))*12+Number(s.slice(5,7))-1;
export function todayUY(now=new Date()){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Montevideo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));return parts.year+'-'+parts.month+'-'+parts.day;}
export function nextMonth(today){const date=new Date(today.slice(0,7)+'-01T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+1);return date.toISOString().slice(0,7);}
export function measure(s){const m=normalize(s).match(/(\d+(?:[.,]\d+)?)\s*(kg|grs|gr|g|ml|cc|lt|l)\b/);if(!m)return null;const amount=Number(m[1].replace(',','.')),unit=m[2];return {amount:amount*(unit==='kg'||unit==='l'||unit==='lt'?1000:1),unit:/kg|gr|g/.test(unit)?'g':'ml'};}
export function matchSeries(item,series){
 const name=normalize(item.name),unit=measure(item.name);if(!unit||/\b(pack|tripack|combo|x\s*\d+)\b/.test(name))return null;
 const variants=['serena','suave','light','sin azucar','sin gluten','sin gas','con gas','sin huevo','fresco','frescos','tricolor','integral','descremada','semidescremada','premium','organico','compuesta','menta','frutilla','chocolate','golden','mini'];
 const stop=new Set(['de','para','en','al','con','comun','mate','mesa','secos','tipo','envase','paquete','bolsa','caja','unidad','sin']);const candidates=[];
 for(const s of series){const sourceName=normalize(s.product+' '+s.brand+' '+s.presentation),sourceUnit=measure(s.presentation);if(!sourceUnit||sourceUnit.unit!==unit.unit||Math.abs(sourceUnit.amount-unit.amount)>.01)continue;
  const brand=normalize(s.brand).split(' ').filter(Boolean);if(!brand.length||!brand.every(w=>new RegExp('(?:^| )'+w+'(?: |$)').test(name)))continue;
  if(item.brand&&normalize(item.brand)!=='-'&&!normalize(item.brand).split(' ').every(w=>brand.includes(w)))continue;
  if(variants.some(v=>name.includes(v)!==sourceName.includes(v)))continue;
  const terms=normalize(s.product).split(' ').filter(w=>!stop.has(w));if(!terms.length||!terms.every(w=>name.split(' ').includes(w)))continue;
  const known=new Set(sourceName.split(' ')),generic=new Set(['tradicional','regular','original','clasica','clasico','en','con','al','de','del','la','las','los','el','y','envase','paquete','bolsa','botella','caja','lata','contenido','neto','g','gr','grs','kg','ml','cc','l','lt']);
  if(name.split(' ').some(w=>!known.has(w)&&!generic.has(w)&&!/^\d+(?:[.,]\d+)?$/.test(w)))continue;
  candidates.push(s);
 }
 return candidates.length===1?candidates[0]:null;
}
function estimate(rows,target,kind){const last=rows.at(-1);if(kind==='baseline')return last.price;const tail=rows.slice(-12),xs=tail.map(r=>monthIndex(r.month)),ys=tail.map(r=>Math.log(r.price));const mx=xs.reduce((a,b)=>a+b)/xs.length,my=ys.reduce((a,b)=>a+b)/ys.length;const denom=xs.reduce((sum,x)=>sum+(x-mx)**2,0);if(!denom)return last.price;const slope=xs.reduce((sum,x,i)=>sum+(x-mx)*(ys[i]-my),0)/denom;return Math.exp(my+slope*(monthIndex(target)-mx));}
function quantile(values,q){const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(q*sorted.length))];}
export function forecast(series,target){
 const observations=series.observations.filter(o=>Number.isFinite(o.price)&&o.price>0&&o.month<target).sort((a,b)=>a.month.localeCompare(b.month));
 if(observations.length<18)return {status:'insufficient',reason:'Se necesitan al menos 18 meses comparables.'};const last=observations.at(-1),horizon=monthIndex(target)-monthIndex(last.month);
 if(horizon<1||horizon>3)return {status:'stale',reason:'El historial no está lo suficientemente actualizado para ese mes.'};
 const errors={baseline:[],trend:[]};
 for(let i=11;i<observations.length;i++){const actual=observations.find(r=>monthIndex(r.month)===monthIndex(observations[i].month)+horizon);if(!actual)continue;for(const kind of ['baseline','trend'])errors[kind].push(Math.abs(estimate(observations.slice(0,i+1),actual.month,kind)-actual.price)/actual.price);}
 for(const k of Object.keys(errors))errors[k]=errors[k].slice(-8);if(errors.baseline.length<4)return {status:'insufficient',reason:'Faltan meses para evaluar el modelo con datos que no usó al entrenar.'};
 const mean=a=>a.reduce((s,v)=>s+v,0)/a.length,kind=mean(errors.trend)<mean(errors.baseline)?'trend':'baseline',mape=mean(errors[kind]);
 const expected=estimate(observations,target,kind),uncertainty=Math.max(.03,quantile(errors[kind],.8));
 if(!Number.isFinite(expected)||expected<=0)return {status:'insufficient',reason:'El modelo no produjo una estimación válida.'};
 return {status:'estimated',model:kind==='trend'?'Regresión de tendencia logarítmica':'Último promedio observado',targetMonth:target,expected:Math.round(expected*100)/100,low:Math.round(expected*(1-uncertainty)*100)/100,high:Math.round(expected*(1+uncertainty)*100)/100,lastObserved:last.price,lastMonth:last.month,observations:observations.length,backtestCases:errors[kind].length,backtestErrorPercent:Math.round(mape*1000)/10,confidence:mape<=.08?'media':'baja',source:last.report,scope:'Promedio de mercado de Uruguay. No es un precio anunciado por tu tienda.'};
}
export function scheduledDates(campaign,from,until){
 if(!Array.isArray(campaign.weekdays)||!campaign.validUntil)return [];
 const start=new Date(from+'T12:00:00Z'),end=new Date(until+'T12:00:00Z');const dates=[];
 for(let d=start;d<=end;d.setUTCDate(d.getUTCDate()+1)){const s=d.toISOString().slice(0,10);if(s>=(campaign.validFrom||'0000-01-01')&&s<=campaign.validUntil&&campaign.weekdays.includes(d.getUTCDay()))dates.push(s);}
 return dates;
}
export function campaignEligible(item,campaign){
 if(campaign.id!=='eldorado-midinero')return false;const n=normalize(item.name);
 if(/\b(vino|cerveza|whisky|vodka|ron|licor|limpieza|jabon|shampoo|champu|detergente|perfume|carne|pollo|pescado)\b/.test(n))return false;
 return /\b(arroz|yerba|galletitas|galletita|galletas|galleta|oreo|fideos|pasta|harina|azucar|aceite|leche|yogur|yogurt|queso|manteca|pan|coca|agua|jugo|gaseosa)\b/.test(n);
}
export function recommend(items,history,campaigns,{today=todayUY(),benefits=[]}={}){
 const target=nextMonth(today),first=target+'-01',end=new Date(Date.UTC(Number(target.slice(0,4)),Number(target.slice(5,7)),0)).toISOString().slice(0,10);
 const results=items.map(item=>{const match=matchSeries(item,history.series),prediction=match?forecast(match,target):{status:'unmatched',reason:'No hay una serie histórica suficientemente precisa para esta marca, variedad y presentación.'};
  const waiting=prediction.status==='estimated'&&prediction.confidence==='media'&&prediction.high<item.currentPrice*.95&&prediction.expected<prediction.lastObserved*.97;
  return {key:item.key,name:item.name,currentPrice:item.currentPrice,quantity:item.quantity,match:match?{product:match.product,brand:match.brand,presentation:match.presentation,method:'Denominación, marca y tamaño; el SIPC no publica GTIN en esta serie.'}:null,prediction,decision:waiting?'consider-waiting':prediction.status==='estimated'&&item.currentPrice<=prediction.low?'competitive-now':'no-evidence-to-wait',message:waiting?'Podría convenirte revisar la compra el mes próximo si podés esperar. Es una señal del promedio de mercado, no una baja confirmada en tu tienda.':prediction.status==='estimated'&&item.currentPrice<=prediction.low?'Tu oferta actual está por debajo del rango de mercado estimado para el próximo mes. No hay motivo en este modelo para esperar.':'No hay evidencia suficiente para recomendar esperar al mes próximo.'};
 });
 const future=campaigns.filter(c=>c.verified&&benefits.includes(c.benefit)&&c.weekdays).map(c=>{const dates=scheduledDates(c,first,end);const eligible=items.filter(i=>campaignEligible(i,c));return {campaignId:c.id,title:c.title,store:c.store,dates,eligibleProducts:eligible.map(i=>i.name),source:c.url,conditions:c.conditions,alreadyAppliesToday:scheduledDates(c,today,today).length>0,message:'Fechas publicadas dentro de la vigencia de la promoción. El precio base de ese día aún puede cambiar; no se garantiza una rebaja adicional por esperar al mes próximo.'};}).filter(c=>c.dates.length&&c.eligibleProducts.length);
 return {generatedAt:new Date().toISOString(),today,targetMonth:target,history:{provider:history.provider,latestMonth:history.latestMonth,months:history.sources.length,importedAt:history.importedAt},method:'Modelo estadístico local, con selección por error en meses de prueba. No usa un modelo generativo ni garantiza precios futuros.',results,futurePromotions:future};
}
