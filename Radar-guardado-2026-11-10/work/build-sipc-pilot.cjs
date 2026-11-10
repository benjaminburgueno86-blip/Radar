const fs=require('node:fs');
const path=require('node:path');
const {parse}=require('csv-parse/sync');
const folder=process.argv[2];
if(!folder)throw Error('Indicá la carpeta con locales.csv, productos.csv y precios-parcial.csv del SIPC.');
const source='https://catalogodatos.gub.uy/dataset/defensa-del-consumidor-sistema-de-informacion-de-precios-al-consumidor-2026';
const zones=new Set(['Centro','Cordón','Pocitos','Buceo','Unión']);
const branches=new Set([48,89,218,225,342,6,19,36,45,104,210,16,37,46,52,152,167,216,32,63,164,176,233,731,5,31,80,154,279,326]);
const products=new Set([1,2,3,15,16,17,18,20,24,25,45,46,47,52,53,54,55,56,57,61,62,72,74,75,76,77,88,89,90,125,140,149,150,151]);
function reference(file) {
  const bytes=fs.readFileSync(path.join(folder,file));
  let input;
  try{input=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{input=new TextDecoder('windows-1252').decode(bytes);}
  return parse(input,{columns:true,delimiter:';',skip_empty_lines:true,relax_column_count:true});
}
const isMontevideo=(lat,lon)=>lat>=-35.1&&lat<=-34.6&&lon>=-56.5&&lon<=-55.9;
const place=Object.fromEntries(reference('locales.csv').flatMap(row=>{
  const id=Number(row['id.establecimientos']),zone=row.barrio.trim();
  let lat=Number(row.lat.replace(',','.')),lon=Number(row.long.replace(',','.'));
  if(!branches.has(id)||!zones.has(zone)||row.depto!=='Montevideo')return [];
  // Some SIPC records carry longitude in the latitude column and vice versa.
  if(isMontevideo(lon,lat))[lat,lon]=[lon,lat];
  if(!isMontevideo(lat,lon))return [];
  return [[id,[row['nombre.sucursal'].trim(),row.cadena.trim(),row.direccion.trim(),zone,lat,lon]]];
}));
const catalog=Object.fromEntries(reference('productos.csv').flatMap(row=>{
  const id=Number(row['id.producto']);
  return products.has(id)?[[id,[row.nombre.trim(),row.marca.trim()]]]:[];
}));
const prices=fs.readFileSync(path.join(folder,'precios-parcial.csv'),'utf8');
const lines=prices.split(/\r?\n/).filter(line=>/^\d+,\d{4}-\d\d-\d\d /.test(line));
const readings=lines.flatMap(line=>{
  const [,declared,day,,offer,price,,,branch,,product]=line.split(',');
  if(!place[branch]||!catalog[product]||offer!=='0'||!/^\d+(?:\.\d{1,2})?$/.test(price)||Number(price)<=0)return [];
  return [[day,declared.replace(' ','T')+'-03:00',Number(branch),Number(product),Number(price)]];
});
const latest=readings.reduce((day,row)=>row[0]>day?row[0]:day,'');
const from=new Date(Date.parse(latest+'T00:00:00Z')-2*86400000).toISOString().slice(0,10);
const recent=readings.filter(([day])=>day>=from);
const selected=new Map();
for(const [day,declared,branch,product,price] of recent){
  const key=JSON.stringify([day,branch,product]),previous=selected.get(key);
  if(!previous||declared>previous.declared)selected.set(key,{declared,prices:new Set([price])});
  else if(declared===previous.declared)previous.prices.add(price);
}
const observations=[...selected].flatMap(([key,{prices}])=>prices.size===1?[[...JSON.parse(key),[...prices][0]]]:[]);
if(!observations.length)throw Error('No se encontraron observaciones en la muestra.');
fs.writeFileSync(path.join(__dirname,'sipc-pilot.json'),JSON.stringify({source,place,catalog,observations})+'\n');
console.log(`${observations.length} precios declarados, ${new Set(observations.map(row=>row[1])).size} sucursales, ${new Set(observations.map(row=>row[2])).size} presentaciones.`);
