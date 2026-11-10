const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {crc32}=require('node:zlib');
const {setup}=require('./platform-runtime.cjs');
const {openPlatform}=require('./platform-db.cjs');
const {spreadsheet}=require('./trade-files.cjs');
const {analyzeTrade}=require('./trade-analysis.cjs');

function zip(entries) {
  const locals=[],directory=[];
  let offset=0;
  for(const [filename,value] of Object.entries(entries)){
    const name=Buffer.from(filename),data=Buffer.from(value),crc=crc32(data);
    const h=Buffer.alloc(30),c=Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt32LE(crc,14);
    h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(name.length,26);
    c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);
    c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);
    locals.push(h,name,data);directory.push(c,name);
    offset+=h.length+name.length+data.length;
  }
  const central=Buffer.concat(directory),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(entries).length,8);end.writeUInt16LE(Object.keys(entries).length,10);
  end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,central,end]);
}
const header=['comercio','sucursal','direccion','fecha_hora','producto','categoria','presentacion','precio'];
const fixture=['Disco','CSV Centro','Calle Prueba 7','2026-11-10T09:15:00-03:00','Producto de prueba','Almacén','400 g','50'];
function excel(tables={Datos:[header,fixture]}) {
  const row=(values,n)=>'<row r="'+n+'">'+values.map((v,i)=>'<c r="'+String.fromCharCode(65+i)+n+'" t="inlineStr"><is><t>'+v+'</t></is></c>').join('')+'</row>';
  const tabs=Object.entries(tables).map(([name,rows],index)=>({name,rows,n:index+1}));
  const each=render=>tabs.map(render).join('');
  return zip({
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+each(({n})=>'<Override PartName="/xl/worksheets/sheet'+n+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')+'</Types>',
    'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+each(({name,n})=>'<sheet name="'+name+'" sheetId="'+n+'" r:id="rId'+n+'"/>')+'</sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+each(({n})=>'<Relationship Id="rId'+n+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+n+'.xml"/>')+'</Relationships>',
    ...Object.fromEntries(tabs.map(({n,rows})=>['xl/worksheets/sheet'+n+'.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+rows.map((cells,i)=>row(cells,i+1)).join('')+'</sheetData></worksheet>'])),
  });
}
async function main(databaseOverride){
  const now=Date.parse('2026-11-10T16:00:00Z');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'radar-trade-test-'));
  const localFile=path.join(folder,'trade.sqlite');
  const database=databaseOverride||localFile;
  const sent=[];
  const runtime=await setup({database,origin:'http://localhost:8903',schedule:false,seedData:false,env:{},clock:()=>now,
    push:{publicKey:'fixture',send:async(s,payload)=>sent.push(payload)}});
  const {trade,platform}=runtime;
  const secret='contraseña de prueba';
  const request=(actor,method,body)=>({method,headers:{cookie:actor?.cookie||'',...(actor?.company?{'x-radar-company':actor.company}:{})},
    socket:{remoteAddress:'127.0.0.1'},body});
  async function call(actor,route,method='GET',input={},params={},api=trade){
    const headers={},output={setHeader:(k,v)=>{headers[k]=v;},end:data=>{output.data=data;}};
    const data=await api.handle(route,request(actor,method,input),output,input,new URLSearchParams(params));
    return {data:data??output.data,headers};
  }
  async function accept(company,email,token){
    await call(null,'/invite/accept','POST',{email,token,password:secret});
    const login=await call(null,'/login','POST',{email,password:secret});
    return {company,cookie:login.headers['Set-Cookie'].split(';')[0]};
  }
  const code='07730430002680';
  const item={name:'Fideos al huevo EPIDOR Tirabuzones 400 g',brand:'Epidor',category:'Almacén',presentation:'400 g',code};
  try{
    const a=await trade.store.provision('Empresa ficticia A',{email:'a@fixture.test',name:'Administradora A'});
    const b=await trade.store.provision('Empresa ficticia B',{email:'b@fixture.test',name:'Administrador B'});
    const admin=await accept(a.company,'a@fixture.test',a.token);
    const other=await accept(b.company,'b@fixture.test',b.token);
    const received=[];
    const hosted=await setup({database:':memory:',origin:'https://radar.example.test',hosted:true,schedule:false,seedData:false,
      env:{},clock:()=>now,sendEmail:async mail=>received.push(mail)});
    try{
      const details={company:'Empresa propia',name:'Persona nueva',email:'nueva@fixture.test'};
      const start=await call(null,'/signup','POST',details,{},hosted.trade);
      assert.equal(start.data.activation,undefined);
      assert.equal((await hosted.platform.db.prepare('SELECT count(*) total FROM trade_companies').get()).total,0);
      assert.equal(received[0].to,details.email);
      const token=new URLSearchParams(new URL(received[0].url).hash.slice(1)).get('alta');
      await assert.rejects(call(null,'/signup/confirm','POST',{email:'otra@fixture.test',token,password:secret},{},hosted.trade),e=>e.status===403);
      const confirm={email:details.email,token,password:secret};
      const activated=await call(null,'/signup/confirm','POST',confirm,{},hosted.trade);
      assert.match(activated.headers['Set-Cookie'],/^__Host-radar-trade=.*; Secure$/);
      const account={cookie:activated.headers['Set-Cookie'].split(';')[0],company:activated.data.company};
      const session=await call(account,'/session','GET',{}, {},hosted.trade);
      assert.deepEqual(session.data.memberships.map(m=>[m.companyName,m.role]),[[details.company,'admin']]);
      const neighbor=await hosted.trade.store.provision(details.company,{email:'vecina@fixture.test',name:'Otra administradora'});
      await assert.rejects(call({...account,company:neighbor.company},'/members','GET',{}, {},hosted.trade),e=>e.status===403);
      await assert.rejects(call(null,'/signup/confirm','POST',confirm,{},hosted.trade),e=>e.status===403);
    }finally{await hosted.close();}
    const localSignup=await call(null,'/signup','POST',{company:'Empresa local',name:'Alta local',email:'local@fixture.test'});
    assert.match(localSignup.data.activation,/^\/trade#alta=[\w-]{43}$/);
    await assert.rejects(call(null,'/invite/accept','POST',{email:'a@fixture.test',token:a.token,password:secret}),e=>e.status===403);
    const employee=async(role,email)=>{
      const {data}=await call(admin,'/members/invite','POST',{email,name:role+' de prueba',role});
      return accept(a.company,email,new URLSearchParams(new URL(data.link).hash.slice(1)).get('invite'));
    };
    const reporter=await employee('relevador','r@fixture.test'),supervisor=await employee('supervisor','s@fixture.test');
    await runtime.api.handle('/account/register',request(null,'POST'),{setHeader(){}},{email:'general@fixture.test',password:secret});
    await assert.rejects(call(null,'/login','POST',{email:'general@fixture.test',password:secret}),e=>e.status===401);
    await assert.rejects(runtime.api.handle('/account/login',request(null,'POST'),{setHeader(){}},{email:'a@fixture.test',password:secret}),e=>e.status===401);
    await assert.rejects(call(null,'/analysis'),e=>e.status===401);
    await assert.rejects(call({...other,company:a.company},'/analysis'),e=>e.status===403);
    await assert.rejects(call(reporter,'/members'),e=>e.status===403);
    await assert.rejects(call(supervisor,'/members/invite','POST',{email:'x@fixture.test',name:'X',role:'admin'}),e=>e.status===403);

    const visit=(checked,store='Disco',branch='Sucursal Centro')=>call(reporter,'/visits','POST',{store,branch,address:'Calle de prueba 1',zone:'Centro',checked,lat:-34.9,lng:-56.2});
    const add=(visit,price,extra={})=>call(reporter,'/records','POST',{...item,visit,price,...extra});
    const review=(r,status='validado',reason='')=>call(supervisor,'/records/'+r.id+'/review','POST',{status,version:r.version,reason});
    const old=(await visit('2026-11-09T13:00:00Z')).data;
    const today=(await visit('2026-11-10T13:00:00Z')).data;
    const first=(await add(old.id,120)).data;
    await assert.rejects(call(reporter,'/records/'+first.id+'/review','POST',{status:'validado',version:1}),e=>e.status===403);
    await review(first);
    await assert.rejects(add(old.id,120),e=>e.status===409);
    await assert.rejects(add(today.id,'1e3'),e=>e.status===400);
    await assert.rejects(add(today.id,135,{promo:110}),e=>e.status===400);
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhxoAAAAASUVORK5CYII=';
    const second=(await add(today.id,135,{promo:129,conditions:'Precio de prueba',photo:png})).data;
    const conflict=(await add(today.id,155)).data;
    assert(conflict.flags.includes('conflicto'));
    await review(conflict,'rechazado','Etiqueta de prueba descartada');
    assert.equal((await call(admin,'/analysis')).data.stats.recent,1);
    assert.equal((await call(admin,'/analysis')).data.recommendations.length,0);
    await call(admin,'/own','POST',{...item,scope:'presencial',checked:'2026-11-10T12:00:00Z',price:100});
    await call(supervisor,'/rules','POST',{product:code,store:'Disco',threshold:10});
    await review(second);
    const third=(await visit('2026-11-10T14:00:00Z','Devoto','Sucursal Centro B')).data;
    await review((await add(third.id,110)).data);
    await platform.ingest([{product:code,name:item.name,brand:'Epidor',store:'disco',branch:'Sucursal Centro',scope:'online',price:115,currency:'UYU',
      checked:'2026-11-10T14:30:00Z',available:1,url:'https://fixture.test/precio'}],{source:'prueba',now});
    const report=(await call(admin,'/analysis')).data;
    assert.equal(report.stats.products,1);assert.equal(report.stats.branches,2);
    assert.equal(report.recommendations[0].kind,'Oportunidad');assert.equal(report.recommendations[0].delta,3500);
    assert.equal(report.channels[0].delta,2000);assert.equal(report.promotions[0].promo,12900);
    assert.equal(report.comparisons[0].min,11000);assert.equal(report.series.find(s=>s.delta>0).delta,1500);
    assert.equal(report.points.length,2);
    assert.equal((await call(admin,'/analysis','GET',{}, {brand:'inexistente'})).data.stats.products,0);
    const stale=analyzeTrade(await trade.store.rows(await trade.store.membership.get(a.company,(await call(admin,'/session')).data.memberships[0].user),{confirmed:true}),
      await platform.observations(),await trade.store.ownRows(a.company),{},now+8*86400000,48);
    assert.equal(stale.recommendations.length,0);assert.equal(stale.stats.recent,0);
    assert.equal((await runtime.api.info()).observations.length,1);
    assert.equal((await call(other,'/analysis')).data.stats.products,0);
    await assert.rejects(call(other,'/records/'+second.id+'/photo'),e=>e.status===404);
    assert(Buffer.isBuffer((await call(reporter,'/records/'+second.id+'/photo')).data));
    const alerts=(await call(admin,'/alerts')).data.alerts;
    assert.equal(alerts.length,1);assert.equal(alerts[0].payload.percent,12.5);
    assert.equal((await call(other,'/alerts')).data.alerts.length,0);
    const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/trade-fixture',keys:{p256dh:Buffer.alloc(65).toString('base64url'),auth:Buffer.alloc(16).toString('base64url')}};
    await call(admin,'/push','POST',subscription);
    await trade.dispatch();await trade.dispatch();
    assert.equal(sent.length,1);assert(!sent[0].body.includes(item.name));

    const correction=(await call(supervisor,'/records/'+second.id,'PATCH',{...item,price:95,version:2,reason:'Corrección de prueba'})).data;
    assert.equal((await call(admin,'/alerts')).data.alerts.length,0);
    await review(correction);
    assert.equal((await call(admin,'/analysis')).data.recommendations[0].kind,'Amenaza');
    const audit=(await call(supervisor,'/records/'+second.id+'/audit')).data.events;
    assert(audit.some(e=>e.action==='antes de corregir'&&e.snapshot.price===13500));
    const exported=(await call(admin,'/export/recommendations')).data;
    assert(exported.includes('Amenaza'));
    const csv=Buffer.from([header.join(';'),fixture.join(';')].join('\r\n')).toString('base64');
    assert.equal((await call(reporter,'/import','POST',{filename:'prueba.csv',content:csv})).data.records,1);
    const count=(await platform.db.prepare('SELECT count(*) n FROM trade_prices').get()).n;
    await assert.rejects(call(reporter,'/import','POST',{filename:'prueba.csv',content:csv}),e=>e.status===409);
    assert.equal((await platform.db.prepare('SELECT count(*) n FROM trade_prices').get()).n,count);
    const xlsx=excel().toString('base64');
    const excelRows=await spreadsheet({filename:'prueba.xlsx',content:xlsx});
    assert.equal(excelRows[0].name,'Producto de prueba');
    assert.equal((await call(other,'/import','POST',{filename:'prueba.xlsx',content:xlsx})).data.records,1);
    const flexible={filename:'lista.xlsx',content:excel({Portada:[['Tarifas']],Precios:[['Tarifas noviembre'],['Referencia interna','Artículo','PVP (UYU)'],['X45','Yerba 1 kg','$ 1.240,50'],['X47','Producto sin tamaño','60'],['TOTAL','','1300']]}).toString('base64')};
    const preview=(await call(reporter,'/import/preview','POST',flexible)).data;
    assert.deepEqual(preview.sheets,['Portada','Precios']);
    assert.deepEqual([preview.sheet,preview.header,preview.mapping.name,preview.mapping.price],[1,2,1,2]);
    assert.equal(preview.columns[1].samples[0],'Yerba 1 kg');
    assert.equal((await platform.db.prepare('SELECT count(*) n FROM trade_prices').get()).n,count+1);
    const knownVisit=(await visit('2026-11-10T10:00:00-03:00','Comercio del archivo','Sucursal propia')).data;
    const edited={...flexible,sheet:1,header:2,last:4,mapping:{name:1,price:2},visit:knownVisit.id};
    assert.deepEqual((await call(reporter,'/import','POST',edited)).data,{records:2,visits:1});
    const imported=(await trade.store.rows({company:a.company,role:'admin'})).filter(r=>r.visit===knownVisit.id);
    assert.equal(imported.find(r=>r.name==='Yerba 1 kg').price,124050);
    const pending=imported.find(r=>r.name==='Producto sin tamaño');
    assert.equal(pending.presentation,'Sin especificar');
    await assert.rejects(call(supervisor,'/records/'+pending.id+'/review','POST',{status:'validado',version:1}),/Completá la presentación/);
    await assert.rejects(call({...other,company:b.company},'/import','POST',edited),e=>e.status===404);
    const manual={filename:'sin-encabezados.csv',content:Buffer.from('Detergente 500 ml\t$ 55,50\nJabón 100 g\tUSD 3').toString('base64'),
      header:0,mapping:{name:0,price:1},defaults:{store:'Otro comercio',branch:'Otro local',address:'Calle de prueba 21',checked:'10/11/2026 9:15'}};
    const beforeInvalid=(await platform.db.prepare('SELECT count(*) n FROM trade_prices').get()).n;
    const check=(await call(reporter,'/import/check','POST',manual)).data;
    assert.equal(check.records,1);
    assert.deepEqual(check.issues.map(issue=>[issue.line,issue.field,issue.value]),[[2,'price','USD 3']]);
    assert.equal((await platform.db.prepare('SELECT count(*) n FROM trade_prices').get()).n,beforeInvalid);
    const corrected={...manual,corrections:{2:{price:'UY$ 1 234,50'}}};
    assert.deepEqual((await call(reporter,'/import/check','POST',corrected)).data,{records:2,issues:[]});
    await assert.rejects(call(reporter,'/import','POST',manual),/Fila 2/);
    assert.equal((await platform.db.prepare('SELECT count(*) n FROM trade_prices').get()).n,beforeInvalid);
    assert.equal((await call(reporter,'/import','POST',{...manual,exclude:[2]})).data.records,1);
    const user=(await call(reporter,'/session')).data.memberships[0].user;
    await call(admin,'/members','PATCH',{user,role:'relevador',active:false});
    await assert.rejects(call(reporter,'/records'),e=>e.status===401);
  }finally{
    await runtime.close();
    try{const reopened=await openPlatform(database);try{assert((await reopened.db.prepare('SELECT count(*) n FROM trade_prices').get()).n>=6);}finally{await reopened.close();}}
    finally{for(const f of [localFile,localFile+'-shm',localFile+'-wal'])if(fs.existsSync(f))fs.unlinkSync(f);fs.rmdirSync(folder);}
  }
  console.log('OK: aislamiento, roles, aprobación, historial, alertas, promociones, CSV/Excel, fotos privadas y persistencia.');
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports=main;
