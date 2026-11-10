const specs=[{id:'tata',url:'https://www.tata.com.uy/lp/preguntas-frecuentes'},{id:'eldorado',url:'https://www.eldorado.com.uy/institucional/envios'}];let cache,pending;
export function parseDelivery(id,html,now=new Date()){
 const text=html.replace(/<script\b[\s\S]*?<\/script>/gi,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ');const base={storeId:id,checkedAt:now.toISOString(),verified:true,url:specs.find(s=>s.id===id).url,conditions:'Confirmar zona, cupo, modalidad y productos elegibles en el comercio. No incluye traslado personal.'};
 if(id==='tata'&&/Montevideo, Las Piedras, La Paz y Ciudad de la costa/.test(text)&&/Costo \$239/.test(text)&&/superiores a \$3\.490/.test(text)&&/SERVICIO SIN COSTO/.test(text))return {...base,deliveryFee:239,freeAbove:3490,minimum:null,pickupFee:0};
 if(id==='eldorado'&&/mínimo de compra es \$500/.test(text)&&/superiores a \$4\.000/.test(text)&&/retiro en sucursal es sin cargo/i.test(text))return {...base,deliveryFee:null,freeAbove:4000,minimum:500,pickupFee:0,conditions:'Solo productos de supermercado y zonas habilitadas. Retiro con mínimo $500. Confirmar cupo y elegibilidad; no incluye traslado personal.'};return null;
}
export async function deliveryPolicies(){if(cache&&Date.now()-Date.parse(cache.checkedAt)<86400000)return cache;if(pending)return pending;pending=(async()=>{const outcomes=await Promise.all(specs.map(async s=>{try{const r=await fetch(s.url,{signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error();const policy=parseDelivery(s.id,await r.text());return policy?{policy}:{error:s.id};}catch{return {error:s.id};}}));return cache={checkedAt:new Date().toISOString(),policies:outcomes.flatMap(o=>o.policy?[o.policy]:[]),unavailable:outcomes.flatMap(o=>o.error?[o.error]:[])};})();try{return await pending;}finally{pending=null;}}
export function publishedCost(rule,subtotal,mode,confirmed,now=Date.now()){
 if(!rule?.verified||!confirmed||now-Date.parse(rule.checkedAt)>86400000||now<Date.parse(rule.checkedAt))return null;
 return {fee:mode==='delivery'?(subtotal>rule.freeAbove?0:rule.deliveryFee):rule.pickupFee,minimum:rule.minimum,source:rule.url,checkedAt:rule.checkedAt};
}
