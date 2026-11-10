import {createHash} from 'node:crypto';
import {productImage,validGtin} from './providers.mjs';
export const stores=[{id:'disco',name:'Disco',host:'www.disco.com.uy',provider:'gdu',prices:true},{id:'devoto',name:'Devoto',host:'www.devoto.com.uy',provider:'gdu',prices:true},{id:'eldorado',name:'El Dorado',host:'www.eldorado.com.uy',provider:'vtex',prices:true},{id:'frog',name:'Frog',host:'frog.uy',provider:'frog',prices:true},{id:'tata',name:'Ta-Ta',host:'www.tata.com.uy',provider:'tata',prices:true},{id:'tiendainglesa',name:'Tienda Inglesa',host:'www.tiendainglesa.com.uy',provider:'directory',prices:false}];
const plain=s=>s.replace(/<[^>]*>/g,'').replace(/&#x([\da-f]+);/gi,(_,x)=>String.fromCodePoint(parseInt(x,16))).replace(/&amp;/g,'&').trim();
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
