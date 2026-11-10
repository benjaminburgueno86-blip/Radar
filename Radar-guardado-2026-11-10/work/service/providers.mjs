export function validGtin(value){const code=String(value||'');if(!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(code))return null;const digits=[...code].map(Number),check=digits.pop();return (10-digits.reverse().reduce((sum,n,i)=>sum+n*(i%2?1:3),0)%10)%10===check?code.padStart(14,'0'):null;}
const raw=async(url,options={})=>{const r=await fetch(url,{signal:AbortSignal.timeout(20000),...options});if(!r.ok)throw Error('La tienda respondió HTTP '+r.status);return r;};
export function uyPrice(value){if(value===undefined||value===null)return NaN;let s=String(value).replace(/[^\d.,-]/g,'');if(s.includes(','))s=s.replaceAll('.','').replace(',','.');else if(/^\d{1,3}(?:\.\d{3})+$/.test(s))s=s.replaceAll('.','');return s?Number(s):NaN;}
export function productImage(value){
 const candidate=Array.isArray(value)?value[0]:value;
 const rawUrl=typeof candidate==='string'?candidate:candidate?.url||candidate?.contentUrl;
 try{const url=new URL(rawUrl);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export function parseVtex(products,store,rank,q){
 const offers=[];
 for(const product of products)for(const item of product.items||[]){
  const seller=item.sellers?.find(s=>String(s.sellerId).toLowerCase()==='eldoradouy2099')||item.sellers?.find(s=>s.sellerDefault)||item.sellers?.[0];const o=seller?.commertialOffer;
  if(!o||!Number.isFinite(o.Price)||o.Price<=0)continue;
  const url=new URL(product.link);if(url.protocol!=='https:'||url.hostname!==store.host)continue;
  const gtin=validGtin(item.ean);
  const promotions=[];if(o.ListPrice>o.Price)promotions.push({kind:'public',label:'Oferta online',price:o.Price,originalPrice:o.ListPrice,conditions:'Precio publicado por la tienda online. Confirmá vigencia y disponibilidad al elegir tu entrega.',validUntil:null,url:url.href});
  offers.push({key:gtin||store.id+':'+item.itemId,gtin,name:item.nameComplete||product.productName,brand:product.brand,imageUrl:productImage(item.images?.[0]?.imageUrl),presentation:product.productName.match(/\d+(?:[.,]\d+)?\s*(?:kg|ml|gr|g|l)\b/i)?.[0]||'',promotions,store:store.name,storeId:store.id,price:o.Price,originalPrice:o.ListPrice>o.Price?o.ListPrice:null,currency:'UYU',available:Number.isFinite(o.AvailableQuantity)?o.AvailableQuantity>0:null,url:url.href,branch:'Tienda online · vendedor '+seller.sellerName,scope:'online',checkedAt:new Date().toISOString(),relevance:rank(product.productName,q)});
 }
 return offers.filter(o=>Number.isFinite(o.relevance)).sort((a,b)=>b.relevance-a.relevance).slice(0,8);
}
export async function searchVtex(store,q,rank){const u=new URL('https://'+store.host+'/api/catalog_system/pub/products/search');u.search=new URLSearchParams({ft:/\boreo\b/i.test(q)?'oreo':q,_from:'0',_to:'23'});return parseVtex(await(await raw(u)).json(),store,rank,q);}
export async function frogSession(remoteId){
 const jar=new Map();const take=r=>{for(const c of r.headers.getSetCookie()){const [name,value]=c.split(';')[0].split(/=(.*)/s);jar.set(name,value);}};
 const headers=()=>({Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')});
 const initial=await raw('https://frog.uy/SyncFrog/GetStoresWithRegions');take(initial);await initial.text();
 jar.set('nop.store',String(remoteId));const selected=await raw('https://frog.uy/Plugins/SyncFrog/ConfirmStoreSelection',{method:'POST',headers:{...headers(),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({storeSelectedId:String(remoteId)})});take(selected);await selected.text();return headers();
}
export async function searchFrog(store,q,rank,parser,selected){
 const headers=selected?await frogSession(selected.remoteId):{};
 // Se conserva la misma sesión anónima para búsqueda y fichas de la sucursal elegida.
 const response=await raw('https://frog.uy/search?'+new URLSearchParams({q:/\boreo\b/i.test(q)?'oreo':q}),{headers});
 const cookies=response.headers.getSetCookie().map(c=>c.split(';')[0]);if(!selected&&cookies.length)headers.Cookie=cookies.join('; ');
 const html=await response.text();const links=[...html.matchAll(/<h2 class="product-title"><a href="([^"]+)">([^<]+)<\/a>/g)].map(m=>({url:new URL(m[1],'https://frog.uy').href,name:m[2]})).filter(x=>Number.isFinite(rank(x.name,q))).sort((a,b)=>rank(b.name,q)-rank(a.name,q)).slice(0,8);
 const settled=await Promise.allSettled(links.map(async candidate=>{
  const doc=await(await raw(candidate.url,{headers})).text();const p=parser(doc,candidate.url,store);
  const branch=doc.match(/id="selectionContent">[\s\S]*?<span>([^<]+)/)?.[1]?.trim();
  if(selected&&!branch?.startsWith(selected.name+' '))throw Error('La tienda no confirmó la sucursal solicitada.');
  const oldBlock=doc.match(/class="old-product-price">([\s\S]*?)<\/div>/)?.[1]||'';
  const regular=oldBlock.match(/\$\s*([\d.,]+)/)?.[1];
  const publicOld=regular?uyPrice(regular):null;
  if(publicOld>p.price)p.promotions.push({kind:'public',label:'Oferta online',price:p.price,originalPrice:publicOld,conditions:'Precio publicado por Frog para la sucursal indicada. Confirmá vigencia al comprar.',validUntil:null,url:candidate.url});
  const bankPrice=uyPrice(doc.match(/class="smart-ribbon-bank-price">\s*\$\s*([\d.,]+)/)?.[1]);
  if(/class="smart-ribbon-bank-logo" title="Itaú"/.test(doc)&&bankPrice>0&&bankPrice<p.price)p.promotions.push({kind:'itau',label:'Beneficio Itaú',price:bankPrice,conditions:'Requiere tarjeta Itaú elegible. Confirmá días, topes y condiciones en Frog. No se aplica automáticamente al carrito.',validUntil:null,url:candidate.url});
  return {...p,branch:branch||'Sucursal no informada por Frog',scope:selected?'selected-branch':'source-branch',selectedBranchId:selected?.id||null,originalPrice:publicOld>p.price?publicOld:null,relevance:rank(p.name,q)};
 }));return {offers:settled.filter(x=>x.status==='fulfilled').map(x=>x.value).filter(x=>Number.isFinite(x.relevance)),partial:settled.some(x=>x.status==='rejected')};
}
export function parseTata(data,store,rank,q){
 if(data.errors||!Array.isArray(data.data?.search?.products?.edges))throw Error('El catálogo de Ta-Ta cambió su respuesta.');
 return data.data.search.products.edges.flatMap(({node:p})=>{const o=p.offers?.offers?.[0];if(!o||!Number.isFinite(o.price)||o.price<=0||p.hasMulticurrencyPrice||!p.slug||!/^[a-z0-9.,_-]+$/i.test(p.slug))return [];const url='https://www.tata.com.uy/'+p.slug+'/p',gtin=validGtin(p.gtin),score=rank(p.name,q);if(!Number.isFinite(score))return [];return [{key:gtin||'tata:'+p.sku,gtin,name:p.name,brand:p.brand?.name||'',presentation:p.name.match(/\d+(?:[.,]\d+)?\s*(?:kg|ml|gr|g|l)\b/i)?.[0]||'',imageUrl:productImage(p.image),price:o.price,originalPrice:o.listPrice>o.price?o.listPrice:null,currency:'UYU',available:o.availability==='https://schema.org/InStock'?true:o.availability==='https://schema.org/OutOfStock'?false:null,storeId:'tata',store:'Ta-Ta',branch:'Catálogo online · canal público 4 · confirmar entrega',scope:'online',url,checkedAt:new Date().toISOString(),relevance:score,promotions:o.listPrice>o.price?[{kind:'public',label:'Oferta online Ta-Ta',price:o.price,originalPrice:o.listPrice,conditions:'Oferta del catálogo público de Ta-Ta. Confirmá vigencia, zona y disponibilidad al comprar. No se suman beneficios de tarjeta.',validUntil:null,url}]:[]}];}).sort((a,b)=>b.relevance-a.relevance).slice(0,8);
}
export async function searchTata(store,q,rank){const variables={first:24,after:'0',sort:'score_desc',term:/\boreo\b/i.test(q)?'oreo':q,selectedFacets:[{key:'channel',value:JSON.stringify({salesChannel:'4',regionId:''})},{key:'locale',value:'es-uy'}]};const u='https://www.tata.com.uy/api/graphql?'+new URLSearchParams({operationName:'ProductsQuery',variables:JSON.stringify(variables)});return parseTata(await(await raw(u)).json(),store,rank,q);}
