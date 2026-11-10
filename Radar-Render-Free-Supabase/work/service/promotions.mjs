import {readFile,writeFile} from 'node:fs/promises';
import {parseVtex,productImage,uyPrice} from './providers.mjs';
import {todayUY,scheduledDates} from './prediction.mjs';
const root=new URL('./',import.meta.url);let campaignsCache=null,promoCache=null,pending=null;
const midinero='https://www.midinero.com.uy/bases-y-condiciones-beneficio-lunes-que-rinden-supermercados-el-dorado/';
const anda='https://anda.com.uy/dias-de-descuentos/el-dorado-montevideo/';
const decode=s=>String(s||'').replace(/&#x([\da-f]+);/gi,(_,v)=>String.fromCodePoint(parseInt(v,16))).replace(/&#(\d+);/g,(_,v)=>String.fromCodePoint(Number(v))).replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
async function fetchDoc(url){const r=await fetch(url,{signal:AbortSignal.timeout(18000)});if(!r.ok)throw Error('HTTP '+r.status);return r.text();}
export function parseCampaign(id,html,now=new Date()){
 const text=decode(html.replace(/<script\b[\s\S]*?<\/script>/gi,''));const checkedAt=now.toISOString();
 if(id==='eldorado-midinero'&&/30 de noviembre de 2026/i.test(text)&&/07 de setiembre de 2026/i.test(text)&&/20%/.test(text)&&/\$\s*500/.test(text)&&/lunes/i.test(text)&&/no acumulable/i.test(text))return {id,storeId:'eldorado',store:'El Dorado',title:'Lunes que rinden · 20% con Midinero',percent:20,cap:500,benefit:'midinero',validFrom:'2026-09-07',validUntil:'2026-11-30',weekdays:[1],verified:true,checkedAt,url:midinero,conditions:'Tarjeta Midinero, Midinero Más o Cintepa. Lunes, una compra por usuario y por día. Tope $500 por compra. Almacén, lácteos, elaboración propia de panadería y rotisería y bebidas sin alcohol. Locales físicos y web. No acumulable con otras promociones.'};
 if(id==='eldorado-anda'){
  const sentence=text.match(/Promoci[oó]n v[aá]lida[^.]+(?:\.[^.]+){0,2}/i)?.[0]||'';const date=sentence.match(/hasta el (\d{2})\/(\d{2})\/(\d{4})/);if(date&&/10\s*%\s*de descuento/i.test(text)&&/tarjeta de cr[eé]dito ANDA/i.test(sentence))return {id,storeId:'eldorado',store:'El Dorado',title:'10% con crédito ANDA · compra presencial',percent:10,benefit:'anda',validUntil:date[3]+'-'+date[2]+'-'+date[1],weekdays:null,verified:true,checkedAt,url:anda,conditions:'Tarjeta de crédito ANDA. Compras presenciales en Montevideo, en los artículos indicados por las bases. No acumulable. El texto consultado no precisa los días: confirmalos antes de comprar.'};
 }
 return null;
}
export async function refreshCampaigns(){
 const specs=[['eldorado-midinero',midinero],['eldorado-anda',anda]];const results=await Promise.all(specs.map(async([id,url])=>{try{const c=parseCampaign(id,await fetchDoc(url));return c?{campaign:c}:{error:{id,url,message:'Las condiciones publicadas cambiaron y requieren revisión.'}};}catch{return {error:{id,url,message:'No se pudo verificar la fuente.'}};}}));
 campaignsCache={checkedAt:new Date().toISOString(),campaigns:results.flatMap(r=>r.campaign?[r.campaign]:[]),errors:results.flatMap(r=>r.error?[r.error]:[])};
 await writeFile(new URL('campaigns.json',root),JSON.stringify(campaignsCache,null,2));return campaignsCache;
}
export async function getCampaigns(){
 if(!campaignsCache)try{campaignsCache=JSON.parse(await readFile(new URL('campaigns.json',root),'utf8'));}catch{}
 if(!campaignsCache||Date.now()-Date.parse(campaignsCache.checkedAt)>86400000)return refreshCampaigns();return campaignsCache;
}
export function parseGduDeals(html,store){
 const deals=[];
 for(const block of html.split('<div class="product-item">').slice(1)){
  const m=block.match(/<h3><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/),values=[...block.matchAll(/class="val">\s*([\d.,]+)<\/span>/g)].map(m=>uyPrice(m[1]));
  if(!m||values.length<2||!values.every(Number.isFinite)||values[1]>=values[0]||/U\$S/.test(block))continue;
  const conditional=/price dcto santander/.test(block);deals.push({id:store.id+':'+m[1],storeId:store.id,store:store.name,name:decode(m[2]),price:values[1],originalPrice:values[0],label:conditional?'Hiper Más Santander · productos seleccionados':'Oferta publicada',conditional,conditions:conditional?'Requiere Hiper Más Santander. Confirmá tarjetas, días y condiciones en la tienda.':'Oferta publicada en la web. Confirmá stock, sucursal y vigencia.',url:new URL(m[1],'https://'+store.host).href,imageUrl:productImage(block.match(/<figure>[\s\S]*?<img[^>]+src="([^"]+)"/)?.[1]),checkedAt:new Date().toISOString()});
 }
 return deals.slice(0,6);
}
export function parseFrogDeals(html){
 const deals=[];for(const block of html.split(/<div class="product-item"[^>]*>/).slice(1)){const m=block.match(/<h2 class="product-title"><a href="([^"]+)">([^<]+)<\/a>/),old=uyPrice(block.match(/class="price old-price">\s*\$\s*([\d.,]+)/)?.[1]),price=uyPrice(block.match(/class="price actual-price">\s*\$\s*([\d.,]+)/)?.[1]);if(!m||!price||!(old>price))continue;deals.push({id:'frog:'+m[1],storeId:'frog',store:'Frog',name:decode(m[2]),price,originalPrice:old,label:'Oferta online',conditions:'Precio de la sucursal predeterminada de Frog. Confirmá el local y la vigencia.',conditional:false,url:new URL(m[1],'https://frog.uy').href,imageUrl:productImage(block.match(/data-lazyloadsrc="([^"]+)"/)?.[1]),checkedAt:new Date().toISOString()});}return deals.slice(0,6);
}
export async function getPromotions(){
 if(promoCache&&Date.now()-Date.parse(promoCache.checkedAt)<900000)return promoCache;if(pending)return pending;
 pending=(async()=>{const sources=[['disco','Disco','https://www.disco.com.uy/hipermassantander'],['devoto','Devoto','https://www.devoto.com.uy/hipermassantander'],['frog','Frog','https://frog.uy/ofertas-almacen'],['eldorado','El Dorado','https://www.eldorado.com.uy/api/catalog_system/pub/products/search?O=OrderByBestDiscountDESC&_from=0&_to=7']];
 const results=await Promise.all(sources.map(async([id,name,url])=>{try{const doc=await fetchDoc(url);const offers=id==='frog'?parseFrogDeals(doc):id==='eldorado'?parseVtex(JSON.parse(doc),{id,name,host:'www.eldorado.com.uy'},()=>0,'').filter(o=>o.originalPrice>o.price).slice(0,6).map(o=>({...o,id:id+':'+o.key,label:'Oferta online',conditions:'Precio del catálogo online. Confirmá el precio del local y la vigencia.',conditional:false})):parseGduDeals(doc,{id,name,host:'www.'+id+'.com.uy'});return {storeId:id,store:name,status:offers.length?'ok':'empty',offers};}catch{return {storeId:id,store:name,status:'error',offers:[]};}}));
 const feed=await getCampaigns(),today=todayUY(),end=new Date(Date.now()+60*86400000).toISOString().slice(0,10);const campaigns=feed.campaigns.filter(c=>c.validUntil>=today).map(c=>({...c,nextDates:scheduledDates(c,today,end)}));
 return promoCache={checkedAt:new Date().toISOString(),today,offers:results.flatMap(r=>r.offers),campaigns,sources:results.map(({offers,...source})=>source),campaignErrors:feed.errors};})();try{return await pending;}finally{pending=null;}
}
