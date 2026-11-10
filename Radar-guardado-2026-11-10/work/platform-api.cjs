const { randomUUID }=require('node:crypto');
const { accounts,fail }=require('./platform-accounts.cjs');
const { subscriptionOf }=require('./platform-push.cjs');
const { gtin }=require('./market-intelligence.cjs');

const array=(value,normalize)=>Array.isArray(value)?[...new Set(value.slice(0,100).map(normalize).filter(Boolean))]:[];
const label=value=>typeof value==='string'?value.trim().slice(0,100):'';
const formats=['minimercado','almacén','supermercado','conveniencia'];
const defaults={products:[],categories:[],stores:[],threshold:0,frequency:'immediate',channel:'inbox'};

function platformApi(platform,{origin,sendEmail,push,dispatch,collector,adminEmail='',hosted=false,clock=Date.now,recentHours=24,staleHours=48}) {
  const {db}=platform;
  const localAccess=!hosted&&/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin||'');
  const localRegistration=localAccess&&!sendEmail;
  const auth=accounts(platform,{origin,sendEmail,localAccess,localRegistration,clock});
  function session(req){
    const user=auth.current(req)?.user;
    if(!user)throw fail('Iniciá sesión para acceder a tu espacio.',401);
    return user;
  }
  const preferences=id=>JSON.parse(db.prepare('SELECT preferences FROM follows WHERE user_id=?').get(id)?.preferences||JSON.stringify(defaults));
  const reports=id=>db.prepare('SELECT id,name,created FROM saved_reports WHERE user_id=? ORDER BY created DESC').all(id);
  const canImport=user=>!!user.verified&&user.email===adminEmail;
  const profile=user=>({id:user.id,email:user.email,profile:JSON.parse(user.profile),preferences:preferences(user.id),canImport:canImport(user)});
  function notifications(user){
    const own=JSON.parse(user.profile).prices||[];
    return db.prepare('SELECT c.id,c.event,i.seen FROM inbox i JOIN changes c ON c.id=i.change_id WHERE i.user_id=? ORDER BY c.id DESC LIMIT 200').all(user.id)
      .map(row=>{
        const event=JSON.parse(row.event), product=own.find(item=>item.code===event.product);
        let recommendation='Confirmá sucursal y vigencia antes de ajustar el precio de este producto.';
        if(product?.price>event.price){
          recommendation='Tu precio registrado supera esta referencia. Evaluá la diferencia y el margen antes de ajustarlo.';
          if(product.cost!==null&&product.cost>=event.price)recommendation='Igualar esta referencia dejaría un margen bruto nulo o negativo al costo ingresado.';
        }
        const lostPosition=product?.price<=event.previous&&product.price>event.price;
        return {...event,id:row.id,seen:!!row.seen,recommendation,lostPosition};
      });
  }
  function info(){
    return {observations:platform.observations(),sourceStatus:platform.sourceStatus(),feeds:collector.feeds,
      recentHours,staleHours,generatedAt:new Date(clock()).toISOString()};
  }
  async function handle(path,req,res,input){
    const method=req.method;
    if(path==='/market-data'&&method==='GET')return info();
    if(path==='/refresh'&&method==='POST'){
      if(hosted)session(req);
      const result=await collector.collect({manual:true});
      if(result.cooldown)throw fail('Esperá 15 minutos entre actualizaciones manuales.',429);
      return {...result,market:info()};
    }
    if(path==='/session'&&method==='GET'){
      const user=auth.current(req)?.user;
      const project=user?db.prepare('SELECT payload FROM projects WHERE user_id=?').get(user.id):null;
      return {account:user?{...profile(user),project:project?JSON.parse(project.payload):null}:null,emailConfigured:!!sendEmail,localRegistration,pushKey:push?.publicKey||null};
    }
    if(path.startsWith('/account/')&&method==='POST')return auth.handle(path.slice('/account/'.length),input,req,res);
    const user=session(req);
    if(path==='/import'&&method==='POST'){
      if(!canImport(user))throw fail('La importación requiere permiso de administrador.',403);
      const source=label(input.source);
      if(!source||input.authorized!==true||!Array.isArray(input.observations)||input.observations.length>10000)
        throw fail('El archivo requiere una fuente autorizada y hasta 10.000 observaciones.');
      const result=platform.ingest(input.observations,{source,now:clock()});
      await dispatch();
      return {...result,market:info()};
    }
    if(path==='/project'&&method==='PUT'){
      if(input.owner!==user.id)throw fail('El proyecto pertenece a otra sesión.',403);
      const project=input.project;
      const payload=JSON.stringify(project??null);
      if(project?.version!==2||!Array.isArray(project.competitors)||project.competitors.length!==3||
         !Array.isArray(project.evidence)||payload.length>5000000)throw fail('Proyecto inválido o demasiado grande.');
      db.prepare('INSERT INTO projects VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload').run(user.id,payload);
      return {ok:true};
    }
    if(path==='/profile'&&method==='PUT'){
      const prices=[];
      for(const item of Array.isArray(input.prices)?input.prices.slice(0,100):[]){
        const code=gtin(item.code);
        const price=Number.isFinite(item.price)&&item.price>0&&item.price<10000000?item.price:null;
        const cost=Number.isFinite(item.cost)&&item.cost>=0&&item.cost<10000000?item.cost:null;
        if(code&&!prices.some(p=>p.code===code))prices.push({code,price,cost});
      }
      const value={name:label(input.name),format:formats.includes(input.format)?input.format:formats[0],prices};
      db.prepare('UPDATE users SET profile=? WHERE id=?').run(JSON.stringify(value),user.id);
      return value;
    }
    if(path==='/preferences'&&method==='PUT'){
      const value={
        products:array(input.products,gtin),categories:array(input.categories,label),stores:array(input.stores,label),
        threshold:typeof input.threshold==='number'&&input.threshold>=0&&input.threshold<=100?input.threshold:0,
        frequency:input.frequency==='daily'?'daily':'immediate',channel:input.channel==='push'&&push?'push':'inbox',
      };
      db.prepare('INSERT INTO follows VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET preferences=excluded.preferences').run(user.id,JSON.stringify(value));
      return value;
    }
    if(path==='/dashboard'&&method==='GET')return {...profile(user),alerts:notifications(user),reports:reports(user.id)};
    if(path==='/alerts/read'&&method==='POST'){
      if(!Number.isSafeInteger(input.id))throw fail('Alerta inválida.');
      const result=db.prepare('UPDATE inbox SET seen=? WHERE user_id=? AND change_id=?').run(clock(),user.id,input.id);
      if(!result.changes)throw fail('Alerta no disponible.',404);
      return {ok:true};
    }
    if(path==='/push'&&method==='POST'){
      if(!push)throw fail('Las notificaciones del navegador requieren configuración del servidor.',503);
      const subscription=subscriptionOf(input);
      if(!subscription)throw fail('Suscripción inválida.');
      const owned=db.prepare('SELECT user_id FROM subscriptions WHERE endpoint=?').get(subscription.endpoint);
      if(owned&&owned.user_id!==user.id)throw fail('La suscripción pertenece a otra cuenta en este navegador.',409);
      const count=db.prepare('SELECT count(*) n FROM subscriptions WHERE user_id=?').get(user.id).n;
      if(!owned&&count>=10)throw fail('Alcanzaste el límite de dispositivos.',409);
      db.prepare('INSERT INTO subscriptions VALUES(?,?,?) ON CONFLICT(endpoint) DO UPDATE SET subscription=excluded.subscription').run(subscription.endpoint,user.id,JSON.stringify(subscription));
      await dispatch();
      return {ok:true};
    }
    if(path==='/push'&&method==='DELETE'){
      db.prepare('DELETE FROM subscriptions WHERE endpoint=? AND user_id=?').run(String(input.endpoint||''),user.id);
      return {ok:true};
    }
    if(path==='/reports'&&method==='POST'){
      const name=label(input.name);
      const payload=JSON.stringify(input.payload??null);
      if(!name||payload==='null'||payload.length>1500000)throw fail('Informe inválido o demasiado grande.');
      if(reports(user.id).length>=50)throw fail('Alcanzaste el límite de 50 informes.',409);
      const id=randomUUID(),created=new Date(clock()).toISOString();
      db.prepare('INSERT INTO saved_reports VALUES(?,?,?,?,?)').run(id,user.id,name,payload,created);
      return {id,name,created};
    }
    if(/^\/reports\/[a-f0-9-]{36}$/.test(path)){
      const id=path.slice('/reports/'.length);
      if(method==='GET'){
        const report=db.prepare('SELECT id,name,payload,created FROM saved_reports WHERE id=? AND user_id=?').get(id,user.id);
        if(!report)throw fail('Informe no disponible.',404);
        return {...report,payload:JSON.parse(report.payload)};
      }
      if(method==='DELETE'){
        db.prepare('DELETE FROM saved_reports WHERE id=? AND user_id=?').run(id,user.id);
        return {ok:true};
      }
    }
    throw fail('Operación no disponible.',404);
  }
  return {handle,info};
}

module.exports={platformApi};
