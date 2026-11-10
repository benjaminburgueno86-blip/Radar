import {deliveryPolicies} from './delivery.mjs';

import {geocode} from './geocode.mjs';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {openLedger} from './ledger.mjs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {searchVtex,searchFrog,searchTata,productImage,validGtin} from './providers.mjs';
import {getPromotions,getCampaigns} from './promotions.mjs';
import {recommend} from './prediction.mjs';
import {getMarketHistory} from './market-data.mjs';
const root=new URL('./',import.meta.url);
export const stores=[{id:'disco',name:'Disco',host:'www.disco.com.uy',provider:'gdu',prices:true},{id:'devoto',name:'Devoto',host:'www.devoto.com.uy',provider:'gdu',prices:true},{id:'eldorado',name:'El Dorado',host:'www.eldorado.com.uy',provider:'vtex',prices:true},{id:'frog',name:'Frog',host:'frog.uy',provider:'frog',prices:true},{id:'tata',name:'Ta-Ta',host:'www.tata.com.uy',provider:'tata',prices:true},{id:'tiendainglesa',name:'Tienda Inglesa',host:'www.tiendainglesa.com.uy',provider:'directory',prices:false}];
export async function getDirectory(){return {...JSON.parse(await readFile(new URL('branches.json',root),'utf8')),stores:stores.map(({id,name,prices,host})=>({id,name,prices,url:'https://'+host}))};}
const cache=new Map(), indexes=new Map();

let ledger;function getLedger(){return ledger ||= openLedger(process.env.DATA_DIR||fileURLToPath(new URL('data/',root)));}
const rateLimits=new Map();function permit(req,kind,maximum){const key=kind+':'+req.socket.remoteAddress;const now=Date.now();let r=rateLimits.get(key);if(!r||now-r.time>60000){r={time:now,count:0};rateLimits.set(key,r);}if(rateLimits.size>5000)for(const [key,value]of rateLimits)if(now-value.time>60000)rateLimits.delete(key);return ++r.count<=maximum;}

export async function getAdvice(items,benefits=[]){return recommend(items,await getMarketHistory(),(await getCampaigns()).campaigns,{benefits});}
const plain=s=>s.replace(/<[^>]*>/g,'').replace(/&#x([\da-f]+);/gi,(_,x)=>String.fromCodePoint(parseInt(x,16))).replace(/&amp;/g,'&').trim();
export const normalize=s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/(\d)([a-z])/g,'$1 $2').replace(/[^a-z0-9]+/g,' ').replace(/\bgr\b/g,'g').trim();
export function relevance(name,q){
 const n=normalize(name), terms=normalize(q).split(' ').filter(Boolean);
 const words=n.split(' ');if(!terms.every(t=>/^(clasicas?|clasicos?|regular|original)$/.test(t)?/\b(regular|clasicas?|clasicos?|original|chantilly)\b/.test(n):words.includes(t)))return -Infinity;
 let score=0;
 // La intención por marca favorece el producto principal, sin mezclar variantes.
 if(terms.includes('oreo')){
  if(/\bgalletitas?\b|\bgalletas?\b|\bchantilly\b/.test(n))score+=100;
  if(/\bregular\b|\bchantilly\b|\bclasicas?\b|\boriginal\b/.test(n))score+=100;
  if(/\b(mini|petit|golden|banadas|mani|milkshake|tacc|chocolate|tripack)\b/.test(n)&&terms.length===1)score-=35;
  if(/\b118 g\b/.test(n)&&/\bregular\b|\bchantilly\b/.test(n))score+=10;
 }
 score-=words.length/100;return score;
}
export function parsePromotions(html,url,basePrice,validUntil){
 const section=html.match(/class="det-precios"[\s\S]*?(?=<div class="det-add"|<div class="det-desc")/)?.[0]||'';
 const promos=[];
 for(const block of section.split(/(?=<div class="price dcto\b)/).slice(1)){
  const price=Number(block.match(/class="val">\s*([\d.,]+)/)?.[1]?.replace(',','.'));
  const santander=/class="price dcto[^\"]*santander/.test(block)&&/alt="Santander"/.test(block)&&/alt="Hiper M/.test(block);
  if(!santander||!Number.isFinite(price)||price<=0||price>=basePrice)continue;
  if(validUntil&&Date.parse(validUntil+'T23:59:59-03:00')<Date.now())continue;
  promos.push({kind:'hiper-santander',label:plain(block.match(/<span>([^<]*OFF[^<]*)<\/span>/i)?.[1]||'Beneficio Hiper Más Santander'),price,conditions:'Requiere Hiper Más Santander. Confirmá tarjetas elegibles, topes y vigencia en la tienda.',validUntil:validUntil||null,url});
 }
 return promos;
}
export function parseProduct(html,url,store){
 const scripts=[...html.matchAll(/<script\b[^>]*type="application\/ld(?:\+|&#x2B;)json"[^>]*>([\s\S]*?)<\/script>/gi)];
 const objects=scripts.flatMap(m=>{try{const j=JSON.parse(m[1]);return Array.isArray(j)?j:j['@graph']||[j]}catch{return []}});
 const p=objects.find(p=>p['@type']==='Product'); if(!p)throw Error('La tienda no devolvió una ficha de producto reconocible.');
 const o=Array.isArray(p.offers)?p.offers[0]:p.offers;
 if(!o||o.price===null||o.price===undefined||!Number.isFinite(Number(o.price))||Number(o.price)<=0||o.priceCurrency!=='UYU')throw Error('Precio en pesos uruguayos no disponible.');
 const rawGtin=String(p.gtin||p.gtin13||p.gtin14||'');
 const gtin=validGtin(rawGtin);
 const branch=html.match(/delivery-branch-button[\s\S]*?<strong class="val">([\s\S]*?)<\/strong>/)?.[1];
 return {key:gtin||store.id+':'+(p.sku||createHash('sha256').update(url).digest('hex').slice(0,24)),gtin,name:p.name,imageUrl:productImage(p.image),brand:typeof p.brand==='string'?p.brand:p.brand?.name||'',presentation:p.name.match(/\d+(?:[.,]\d+)?\s*(?:kg|ml|gr|g|l|un\.?)(?:\s*x\s*\d+\s*un)?\b/i)?.[0]||'Presentación indicada en el nombre',category:p.category||'',promotions:parsePromotions(html,url,Number(o.price),o.priceValidUntil),store:store.name,storeId:store.id,price:Number(o.price),currency:'UYU',available:o.availability?.endsWith('/InStock')?true:o.availability?.endsWith('/OutOfStock')?false:null,url,branch:branch?plain(branch):'Sucursal no informada',checkedAt:new Date().toISOString()};
}
async function download(url){
 const r=await fetch(url,{signal:AbortSignal.timeout(22000)});if(!r.ok)throw Error('HTTP '+r.status);return r.text();
}
async function index(store){
 const previous=indexes.get(store.id);if(previous&&Date.now()-previous.time<86400000)return previous.urls;
 const first=await download('https://'+store.host+'/sitemap.xml');
 const locations=xml=>[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1].replace(/&amp;/g,'&'));
 const maps=locations(first).filter(u=>new URL(u).host===store.host&&u.endsWith('.xml')).slice(0,8);
 const docs=maps.length?await Promise.all(maps.map(download)):[first];
 const urls=[...new Set(docs.flatMap(locations))].filter(u=>{try{const x=new URL(u);return x.protocol==='https:'&&x.host===store.host&&/^\/product\/[^/]+\/\d+$/.test(x.pathname)}catch{return false}});
 if(!urls.length)throw Error('El catálogo no está disponible.');indexes.set(store.id,{time:Date.now(),urls});return urls;
}
async function offer(url,store){
 const entry=cache.get(url);if(entry&&Date.now()-entry.time<300000)return entry.data;
 const data=parseProduct(await download(url),url,store);cache.set(url,{time:Date.now(),data});if(cache.size>1500)cache.delete(cache.keys().next().value);return data;
}
export async function search(q,options={}){
 const tokens=q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[a-z0-9]+/g)||[];
 if(!tokens.length)throw Error('Escribí un producto.');
 const directory=options.branchId?await getDirectory():null;
 const selected=directory?.branches.find(b=>b.id===options.branchId);
 if(options.branchId&&!selected)throw Error('Sucursal no reconocida.');
 const chosen=options.storeIds?.length?stores.filter(s=>options.storeIds.includes(s.id)):stores;
 const results=await Promise.all(chosen.map(async store=>{
  if(!store.prices)return {store:store.name,storeId:store.id,status:'directory',offers:[],message:'Consulta automática no disponible: la fuente rechazó el acceso. Podés consultar el comercio directamente.',url:'https://'+store.host};
  if(['vtex','frog','tata'].includes(store.provider)){
   try{const data=store.provider==='tata'?{offers:await searchTata(store,q,relevance)}:store.provider==='vtex'?{offers:await searchVtex(store,q,relevance)}:await searchFrog(store,q,relevance,parseProduct,selected?.storeId==='frog'?selected:null);return {store:store.name,storeId:store.id,status:data.partial?'partial':'ok',offers:data.offers,message:'Precios consultados en la tienda. La sucursal se indica en cada oferta.'};}
   catch(error){console.error(store.name+': '+error.message);return {store:store.name,storeId:store.id,status:'error',offers:[],message:'No se pudo confirmar el catálogo o la sucursal. Intentá nuevamente.'};}
  }
  try{const urls=await index(store);const matches=urls.map(u=>({url:u,score:relevance(new URL(u).pathname.split('/')[2],q)})).filter(x=>Number.isFinite(x.score)).sort((a,b)=>b.score-a.score||a.url.localeCompare(b.url)).slice(0,8).map(x=>x.url);
   const settled=await Promise.allSettled(matches.map(u=>offer(u,store)));const offers=settled.filter(x=>x.status==='fulfilled').map(x=>({...x.value,relevance:relevance(x.value.name,q)})).sort((a,b)=>b.relevance-a.relevance);
   return {store:store.name,storeId:store.id,status:settled.some(x=>x.status==='rejected')?'partial':'ok',offers:offers.map(o=>({...o,scope:'source-branch'})),message:matches.length?'Se consultan hasta ocho coincidencias por tienda, ordenadas por relevancia.':'Sin coincidencias en el catálogo.'};
  }catch(error){console.error(store.name+': '+error.message);return {store:store.name,status:'error',offers:[],message:'No se pudo consultar esta tienda. Intentá nuevamente.'}}
 }));try{getLedger().record(results,options.branchId);}catch(e){console.error('Historial: '+e.message);}return {results,area:'Montevideo',priceCacheMinutes:5,selectedBranch:selected||null};
}
export function publicHistory(key){return getLedger().history(key)}
