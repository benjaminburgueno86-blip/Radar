const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {setup}=require('./platform-runtime.cjs');
const {openPlatform}=require('./platform-db.cjs');
const M=require('./market-intelligence.cjs');

async function main(databaseOverride){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'gondolupa-test-'));
  const localFile=path.join(folder,'test.sqlite');
  const database=databaseOverride||localFile;
  const sent=[],notifications=[];
  const origin='https://gondolupa.example';
  let now=Date.parse('2026-11-09T14:00:00Z'),current=80,fetches=0;
  const code='07622300841461';
  const obs=(price,checked,extra={})=>({product:code,store:'tienda-prueba',scope:'online',branch:'Canal de prueba',
    name:'Galletitas Mini Oreo 50 g',price,currency:'UYU',available:1,url:'https://precios.example/producto',checked,...extra});
  const runtime=await setup({origin,database,schedule:false,seedData:false,clock:()=>now,env:{
    PRICE_FEEDS_JSON:JSON.stringify([{id:'fuente-prueba',store:'tienda-prueba',url:'https://precios.example/feed',authorized:true,terms:'Fixture de prueba'}]),
  },sendEmail:async message=>sent.push(message),push:{publicKey:'fixture',send:async (device,message)=>notifications.push({device,message})},
  fetchFn:async ()=>{
    fetches++;
    return new Response(JSON.stringify({observations:[obs(current,new Date(now).toISOString())]}));
  }});
  const {api,platform,collector}=runtime;
  const headers={};
  const call=(route,method='GET',input={},cookie='')=>api.handle(route,{method,headers:{cookie},socket:{remoteAddress:'127.0.0.1'}},
    {setHeader:(name,value)=>{headers[name]=value}},input);
  const password='password prueba 123';
  async function signup(email){
    await call('/account/register','POST',{email,password});
    await assert.rejects(call('/account/login','POST',{email,password}),error=>error.status===401);
    const url=new URL(sent.find(message=>message.to===email&&message.kind==='verify').url);
    const token=url.searchParams.get('verify');
    await call('/account/verify','POST',{token});
    await assert.rejects(call('/account/verify','POST',{token}),/vencido/);
    await call('/account/login','POST',{email,password});
    assert.match(headers['Set-Cookie'],/HttpOnly.*SameSite=Lax.*Secure/);
    return headers['Set-Cookie'].split(';')[0];
  }
  try{
    const a=await signup('a@example.com'),b=await signup('b@example.com');
    const owner=(await call('/session','GET',{},a)).account.id;
    const project={version:2,competitors:[{},{},{}],evidence:[],project:{name:'Proyecto privado de A'}};
    await call('/project','PUT',{owner,project},a);
    await assert.rejects(call('/project','PUT',{owner,project},b),error=>error.status===403);
    assert.equal((await call('/session','GET',{},a)).account.project.project.name,'Proyecto privado de A');
    assert.equal((await call('/session','GET',{},b)).account.project,null);
    assert(!(await platform.db.prepare('SELECT password FROM users WHERE email=?').get('a@example.com')).password.includes(password));
    await assert.rejects(call('/dashboard'),error=>error.status===401);
    await call('/preferences','PUT',{products:[code],threshold:5,channel:'push'},a);
    await call('/preferences','PUT',{products:[code],threshold:20},b);
    const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',
      keys:{p256dh:Buffer.alloc(65).toString('base64url'),auth:Buffer.alloc(16).toString('base64url')}};
    await call('/push','POST',subscription,a);
    await assert.rejects(call('/push','POST',subscription,b),error=>error.status===409);
    const saved=await call('/reports','POST',{name:'Corte de prueba',payload:{observations:[]}},a);
    assert.equal((await call('/dashboard','GET',{},b)).reports.length,0);
    await assert.rejects(call('/reports/'+saved.id,'GET',{},b),error=>error.status===404);
    assert.equal((await call('/reports/'+saved.id,'GET',{},a)).name,'Corte de prueba');
    assert.equal((await collector.collect()).results[0].inserted,1);
    assert.deepEqual((await collector.collect()).results,[]);
    assert.equal(fetches,1);
    now+=86400000;current=72;
    assert.equal((await collector.collect()).results[0].changes,1);
    assert.equal((await platform.observations()).length,2);
    assert.equal(notifications.length,1);
    assert.match(notifications[0].message.url,/\?producto=/);
    let data=await call('/dashboard','GET',{},a);
    assert.equal(data.alerts.length,1);
    assert.equal(data.alerts[0].percent,-10);
    assert.equal((await call('/dashboard','GET',{},b)).alerts.length,0);
    const id=data.alerts[0].id;
    await assert.rejects(call('/alerts/read','POST',{id},b),error=>error.status===404);
    await call('/alerts/read','POST',{id},a);
    assert((await call('/dashboard','GET',{},a)).alerts[0].seen);
    assert.equal((await collector.collect({manual:true})).results[0].inserted,0);
    assert((await collector.collect({manual:true})).cooldown);
    assert.equal(notifications.length,1);
    const checked=new Date(now).toISOString();
    assert.equal((await platform.ingest([obs(60,new Date(now+60000).toISOString())],{source:'fixture',now})).rejected,1);
    assert.equal((await platform.ingest([obs(60,checked)],{source:'fixture',now})).rejected,1);
    assert.equal((await platform.ingest([obs(65,checked,{promotion:'Cupón de prueba'})],{source:'fixture',now})).changes,0);
    const history=M.history(await platform.observations(),code,{now});
    assert.equal(history.length,2);
    assert.equal(history.find(s=>!s.promotion).change,-8);
    assert.equal(history.find(s=>!s.promotion).decreases,1);
    assert.equal(history.find(s=>!s.promotion).min,72);
    await call('/account/recover','POST',{email:'a@example.com'});
    const reset=new URL(sent.at(-1).url).searchParams.get('reset');
    await call('/account/reset','POST',{token:reset,password:'otra contraseña segura'});
    await assert.rejects(call('/dashboard','GET',{},a),error=>error.status===401);
    await call('/account/login','POST',{email:'a@example.com',password:'otra contraseña segura'});
    const replacement=headers['Set-Cookie'].split(';')[0];
    await call('/account/logout','POST',{},replacement);
    await assert.rejects(call('/dashboard','GET',{},replacement),error=>error.status===401);
    assert.equal((await call('/dashboard','GET',{},b)).email,'b@example.com');
  }finally{
    await runtime.close();
    try{
      const reopened=await openPlatform(database);
      try{
        assert((await reopened.observations()).length>=2);
        assert.equal((await reopened.db.prepare('SELECT count(*) n FROM users').get()).n,2);
      }finally{await reopened.close();}
    }finally{
      for(const file of [localFile,localFile+'-shm',localFile+'-wal'])if(fs.existsSync(file))fs.unlinkSync(file);
      fs.rmdirSync(folder);
    }
  }
  console.log('OK: cuentas, sesión, aislamiento, persistencia, actualización diaria, historial, umbral, duplicados y envío push con transporte de prueba.');
}
module.exports=main;
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
