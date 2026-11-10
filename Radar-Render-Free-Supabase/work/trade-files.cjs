const { inflateRawSync }=require('node:zlib');
const { fail }=require('./platform-accounts.cjs');
const {unknownPresentation}=require('./trade-store.cjs');
const Market=require('./market-intelligence.cjs');

const columns={
  comercio:'store',sucursal:'branch',direccion:'address',zona:'zone',fecha_hora:'checked',latitud:'lat',longitud:'lng',
  producto:'name',marca:'brand',categoria:'category',presentacion:'presentation',gtin:'code',precio:'price',
  promocional:'promo',condiciones:'conditions',observaciones:'notes',
};
const heading=value=>String(value??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const aliases={
  store:['supermercado','cadena','tienda','comercio','establecimiento','local comercial','store','retailer'],
  branch:['local','localidad','sucursal','punto de venta','branch','store location'],
  address:['domicilio','ubicacion','direccion','address'],zone:['barrio','zona','area','neighborhood'],
  checked:['fecha','fecha y hora','fecha de relevamiento','fecha relevamiento','fecha de observacion','dia','date','timestamp'],
  lat:['lat','latitude'],lng:['lng','lon','longitude'],
  name:['articulo','descripcion','descripcion producto','descripcion del producto','nombre','nombre del producto','nombre producto','item','product','product name','description','sku descripcion'],
  brand:['fabricante','brand'],category:['rubro','familia','segmento','seccion','category'],
  presentation:['formato','contenido','contenido neto','tamano','peso','volumen','presentacion tamano','size','package'],
  code:['codigo de barras','codigo barra','codigo de producto ean','ean','ean 13','ean13','upc','barcode'],
  price:['precio regular','precio de gondola','precio de venta','precio venta','precio unitario','precio contado','precio final','pvp','importe unitario','precio uy','precio uyu','price','unit price','retail price','precio pesos'],
  promo:['precio oferta','precio de oferta','precio promocional','sale price'],conditions:['condicion','condiciones de la promocion'],notes:['notas','comentarios','remarks'],
};
const fieldByHeading=new Map(Object.entries(columns).flatMap(([label,field])=>[label,field,...aliases[field]].map(word=>[heading(word),field])));

function validateArchive(data) {
  // Validate every central-directory entry and cap actual decompression before the Excel reader opens it.
  const end=data.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  if(end<0||end+22>data.length||end+22+data.readUInt16LE(end+20)!==data.length)throw Error();
  const count=data.readUInt16LE(end+10);
  let offset=data.readUInt32LE(end+16),total=0;
  if(!count||count>100||data.readUInt32LE(end+4)||offset+data.readUInt32LE(end+12)!==end)throw Error();
  const files=new Set();
  for(let i=0;i<count;i++){
    if(offset+46>end||data.readUInt32LE(offset)!==0x02014b50)throw Error();
    const compressed=data.readUInt32LE(offset+20),size=data.readUInt32LE(offset+24);
    const nameLength=data.readUInt16LE(offset+28),extra=data.readUInt16LE(offset+30),comment=data.readUInt16LE(offset+32);
    const local=data.readUInt32LE(offset+42),method=data.readUInt16LE(offset+10);
    const name=data.toString('utf8',offset+46,offset+46+nameLength);
    offset+=46+nameLength+extra+comment;
    if(offset>end||files.has(name)||local+30>end||data.readUInt32LE(local)!==0x04034b50||![0,8].includes(method)||
      data.readUInt16LE(local+8)!==method||data.readUInt16LE(local+6)&1||size>8_000_000||(total+=size)>12_000_000)
      throw Error();
    files.add(name);
    const start=local+30+data.readUInt16LE(local+26)+data.readUInt16LE(local+28);
    if(start+compressed>end)throw Error();
    const slice=data.subarray(start,start+compressed);
    const output=method===8?inflateRawSync(slice,{maxOutputLength:Math.max(1,size)}):slice;
    if(output.length!==size)throw Error();
    if(name.endsWith('.xml')){
      const xml=output.toString('utf8');
      if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))throw Error();
      if(name.startsWith('xl/worksheets/')&&/<(?:\w+:)?(?:row|c)\b[^>]*\br=["'](?:[A-Z]{3,}\d+|[A-Z]*\d{5,})["']/.test(xml))throw Error();
    }
  }
  if(offset!==end||!files.has('xl/workbook.xml'))throw Error();
}

function csvRows(data) {
  const {parse}=require('csv-parse/sync');
  let input;
  try{input=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{input=new TextDecoder('windows-1252').decode(data);}
  const candidates=[',',';','\t'].flatMap(delimiter=>{
    try{
      const rows=parse(input,{delimiter,relax_column_count:true,trim:true,max_record_size:10000});
      const widths=new Map();
      for(const row of rows.slice(0,100))if(row.length>1)widths.set(row.length,(widths.get(row.length)||0)+1);
      return [{rows,score:Math.max(0,...widths.values())}];
    }catch{return [];}
  });
  if(!candidates.length)throw Error();
  return candidates.sort((a,b)=>b.score-a.score)[0].rows;
}

async function workbook(input) {
  const name=typeof input.filename==='string'?input.filename.toLowerCase():'';
  if(!/\.(csv|xlsx)$/.test(name)||typeof input.content!=='string'||input.content.length>2_800_000)
    throw fail('Elegí una planilla CSV o Excel .xlsx de hasta 2 MB.');
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(input.content))throw fail('Archivo inválido.');
  const data=Buffer.from(input.content,'base64');
  if(data.length>2_000_000)throw fail('La planilla supera 2 MB.');
  let sheets;
  try{
    if(name.endsWith('.csv'))sheets=[{sheet:'CSV',data:csvRows(data)}];
    else{
      validateArchive(data);
      const excel=await import('read-excel-file/node');
      sheets=await excel.default(data);
    }
  }catch(error){
    if(error.code==='MODULE_NOT_FOUND'||error.code==='ERR_MODULE_NOT_FOUND')
      throw fail('Faltan las dependencias de importación. Ejecutá npm install en el servidor.',503);
    throw fail('No se pudo leer la planilla. Revisá que sea un CSV o XLSX válido y que no esté protegido.');
  }
  if(!sheets.length||sheets.some(({data})=>data.length>10000||data.some(row=>row.length>256)))throw fail('La planilla tiene demasiadas filas o columnas.');
  return sheets;
}

const present=value=>value!=null&&String(value).trim()!=='';
const asText=value=>value instanceof Date?value.toISOString().slice(0,19).replace('T',' '):String(value??'').trim();
function infer(row) {
  const found=new Map();
  row.forEach((cell,index)=>{
    const label=heading(cell);
    const field=fieldByHeading.get(label)||fieldByHeading.get(label.replace(/ (?:uyu|pesos(?: uruguayos)?)$/,''));
    if(field)found.set(field,found.has(field)?null:index);
  });
  return Object.fromEntries([...found].filter(([,index])=>index!==null));
}
function scan(sheets,input){
  const candidates=sheets.map(({data})=>{
    let header=0,score=0;
    for(const [i,row] of data.slice(0,80).entries()){
      const found=infer(row),rank=Object.keys(found).length+Number('name' in found)*20+Number('price' in found)*20;
      if(rank>score){score=rank;header=i+1;}
    }
    return {score,header};
  });
  const first=candidates.reduce((best,item,i)=>item.score>candidates[best].score?i:best,0);
  const sheet=input.sheet??first, data=sheets[sheet]?.data;
  if(!Number.isInteger(sheet)||!data)throw fail('Elegí una hoja válida.');
  if(!data.length)throw fail('La hoja está vacía.');
  const header=input.header??candidates[sheet].header;
  if(!Number.isInteger(header)||header<0||header>data.length)throw fail('Indicá una fila de encabezados válida.');
  const width=Math.max(0,...data.map(row=>row.length));
  return {sheet,data,header,width,mapping:header?infer(data[header-1]):{}};
}

async function preview(input) {
  const sheets=await workbook(input), selected=scan(sheets,input);
  const {sheet,data,header,width,mapping}=selected;
  const samples=data.slice(header).filter(row=>row.some(present)).slice(0,3);
  return {sheet,header,mapping,total:data.length,sheets:sheets.map(({sheet})=>sheet),columns:Array.from({length:width},(_,i)=>({
    label:header?asText(data[header-1][i]).slice(0,100):'',samples:samples.map(row=>asText(row[i]).slice(0,100)),
  }))};
}

function checked(value) {
  if(value instanceof Date)return value.toISOString().slice(0,19)+'-03:00';
  const raw=asText(value);
  const regional=raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(.*)$/);
  const iso=regional?regional[3]+'-'+regional[2].padStart(2,'0')+'-'+regional[1].padStart(2,'0')+regional[4]:raw;
  if(/^(?:\d{4}-\d\d-\d\d)$/.test(iso))return iso+'T00:00:00-03:00';
  const local=iso.match(/^(\d{4}-\d\d-\d\d)[ T](\d{1,2})(:\d\d(?::\d\d)?)$/);
  return local?local[1]+'T'+local[2].padStart(2,'0')+local[3]+'-03:00':iso;
}
function price(value) {
  if(typeof value==='number'){
    const rounded=Math.round(value*100)/100;
    return Math.abs(value-rounded)<1e-8?rounded:value;
  }
  let raw=asText(value).replace(/^(?:UYU\s*\$?|UY\$|\$U|\$)\s*|\s*UYU$/gi,'').trim();
  if(/^\d{1,3}(?:[\s\u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?$/.test(raw))raw=raw.replace(/\s/g,'');
  if(/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(raw))return raw.replaceAll('.','').replace(',','.');
  if(/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(raw))return raw.replaceAll(',','');
  return raw;
}
const noValue=value=>/^(?:[-–—]|n\/?a|s\/d|sin dato)$/i.test(asText(value));
function barcode(value){
  const raw=asText(value);
  if(noValue(raw))return '';
  if(!/^\d+(?:[.,]\d+)?(?:e[+]?\d+)?$/i.test(raw)||/^\d{8}$|^\d{12,14}$/.test(raw))return raw;
  const n=Number(raw.replace(',','.'));
  if(!Number.isSafeInteger(n)||n<=0||n>=1e14)return raw;
  const digits=String(n);
  return Market.gtin(digits)||raw;
}
function inferredPresentation(name) {
  const measure=Market.measure(name);
  if(!measure)return unknownPresentation;
  return (measure.count>1?measure.count+' × ':'')+measure.amount+' '+measure.unit;
}
async function spreadsheet(input) {
  const {data,header,width,mapping:inferred}=scan(await workbook(input),input);
  const mapping=input.mapping??inferred;
  if(!mapping||typeof mapping!=='object'||Array.isArray(mapping)||Object.entries(mapping).some(([field,index])=>
    !Object.values(columns).includes(field)||!Number.isInteger(index)||index<0||index>=width)||
    new Set(Object.values(mapping)).size!==Object.keys(mapping).length)throw fail('Revisá la asignación de columnas.');
  if(!Object.hasOwn(mapping,'name')||!Object.hasOwn(mapping,'price'))throw fail('Elegí las columnas de producto y precio.');
  if(header&&['price','promo'].some(field=>/\b(?:usd|eur|ars|brl|dolares|euros|u s)\b/.test(heading(data[header-1][mapping[field]]))))
    throw fail('Radar importa precios en pesos uruguayos. Elegí una columna en UYU.');
  const last=input.last??data.length;
  if(!Number.isInteger(last)||last<=header||last>data.length)throw fail('Indicá una última fila de datos válida.');
  const defaults=input.defaults??{};
  const excluded=new Set(Array.isArray(input.exclude)?input.exclude:[]), corrections=input.corrections??{};
  if(excluded.size>500||[...excluded].some(line=>!Number.isInteger(line)||line<=header||line>last)||
    !corrections||typeof corrections!=='object'||Array.isArray(corrections)||Object.keys(corrections).length>500||
    Object.entries(corrections).some(([line,values])=>!/^[1-9]\d*$/.test(line)||Number(line)<=header||Number(line)>last||
      !values||typeof values!=='object'||Array.isArray(values)||Object.entries(values).some(([field,value])=>!Object.values(columns).includes(field)||typeof value!=='string'||value.length>1000)))
    throw fail('Revisá las correcciones y las filas que elegiste omitir.');
  const rows=data.slice(header,last).flatMap((source,i)=>{
    const line=header+i+1;
    if(excluded.has(line)||!source.some(present))return [];
    const changes=corrections[line]||{};
    const value=field=>Object.hasOwn(changes,field)?changes[field]:present(source[mapping[field]])?source[mapping[field]]:defaults[field];
    const row=Object.fromEntries(Object.values(columns).map(field=>[field,asText(value(field))]));
    row.price=price(value('price'));row.promo=noValue(value('promo'))?'':price(value('promo'));row.checked=checked(value('checked'));
    row.code=barcode(value('code'));
    for(const field of ['lat','lng'])if(noValue(row[field]))row[field]='';
    row.category||=Market.category(row.name);
    row.presentation||=inferredPresentation(row.name);
    return [{...row,line}];
  });
  if(!rows.length||rows.length>500)throw fail('Elegí un rango con entre 1 y 500 filas de datos.');
  return rows;
}

function cell(v) {
  let s=String(v??'');
  if(typeof v!=='number'&&/^[\s\uFEFF]*[=+\-@]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
const csv=(headers,rows)=>'\uFEFF'+[headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n');
const template=()=>csv(Object.keys(columns),[]);
const observations=rows=>csv([...Object.keys(columns),'empleado','estado','version'],rows.map(r=>[
  r.store,r.branch,r.address,r.zone,r.checked,r.lat,r.lng,r.name,r.brand,r.category,r.presentation,r.code,
  r.price/100,r.promo==null?'':r.promo/100,r.conditions,r.notes,r.employee,r.status,r.version,
]));
const recommendations=rows=>csv(['tipo','producto','gtin','comercio','sucursal','fecha','precio_anterior','fecha_anterior','competidor','propio','fecha_precio_propio','diferencia','porcentaje','accion'],
  rows.map(r=>[r.kind,r.row.name,r.row.code,r.row.store,r.row.branch,r.row.checked,r.previous.price/100,r.previous.checked,
    r.row.price/100,r.own/100,r.ownChecked,r.delta/100,r.percent,r.action]));
module.exports={spreadsheet,preview,template,observations,recommendations};
