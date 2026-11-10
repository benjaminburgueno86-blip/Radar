const {randomUUID}=require('node:crypto');
const {accounts,emailOf,fail}=require('./platform-accounts.cjs');
const {tradeStore,roles,text,key,stamp,amount,date,identity,visitData}=require('./trade-store.cjs');
const {analyzeTrade}=require('./trade-analysis.cjs');
const files=require('./trade-files.cjs');
const {subscriptionOf}=require('./platform-push.cjs');

const validAlerts=[
  "JOIN trade_prices p ON p.id=a.price AND p.status='validado' AND p.version=a.version",
  "JOIN trade_prices prev ON prev.id=a.previous AND prev.status='validado' AND prev.version=a.previous_version",
].join(' ');
function tradeApi(platform,{origin,hosted=false,clock=Date.now,recentHours=48,push=null,sendEmail=null}={}) {
  const {db,transaction}=platform;
  const store=tradeStore(platform,{clock,hosted});
  const auth=accounts(platform,{origin,enterprise:true,localAccess:!hosted,clock});
  let pushing=false;
  const access=(req,allowed=roles)=>{
    const user=auth.current(req)?.user;
    if(!user)throw fail('Iniciá sesión con una cuenta empresarial.',401);
    const company=text(req.headers['x-radar-company'],80);
    const member=store.membership.get(company,user.id);
    if(!member||!allowed.includes(member.role))throw fail('No tenés permiso para esta operación.',403);
    return member;
  };
  const authRoutes=new Set(['/login','/logout','/invite/accept','/session','/signup','/signup/confirm']);
  function authorizeRequest(path,req){
    if(!authRoutes.has(path))access(req);
  }
  const visible=(m,id)=>{
    const row=store.rowById(m.company,id);
    if(!row||m.role==='relevador'&&row.user!==m.user)throw fail('Registro no disponible.',404);
    return row;
  };
  function analysis(m,params){
    const filters=Object.fromEntries(['name','category','brand','store','branch','product','from','to'].map(k=>[k,text(params.get(k),160)]));
    const all=store.rows(m,{confirmed:true,limit:5001});
    const data=analyzeTrade(all.slice(0,5000),platform.observations(),store.ownRows(m.company),filters,clock(),recentHours);
    return {...data,truncated:all.length>5000,recentHours};
  }
  function send(res,content,type,filename=''){
    if(filename)res.setHeader('Content-Disposition','attachment; filename="'+filename+'"');
    res.setHeader('Content-Type',type);
    res.end(content);
  }
  async function dispatch() {
    if(!push||pushing)return;
    pushing=true;
    try{
      const cutoff=stamp(clock()-86400000);
      const pending=db.prepare([
        'SELECT a.id,a.company,s.user,s.endpoint,s.subscription FROM trade_alerts a',validAlerts,
        'JOIN trade_push s ON s.company=a.company',
        'JOIN trade_members m ON m.company=s.company AND m.user=s.user AND m.active=1',
        'LEFT JOIN trade_push_delivery d ON d.alert=a.id AND d.user=s.user AND d.endpoint=s.endpoint',
        'WHERE a.created>=? AND d.alert IS NULL ORDER BY a.created LIMIT 40',
      ].join(' ')).all(cutoff);
      for(const row of pending){
        try{
          await push.send(JSON.parse(row.subscription),{title:'Radar Trade Marketing',body:'Hay una alerta en tu espacio empresarial.',
            url:'/trade#alertas',tag:'radar-trade-'+row.id});
          db.prepare('INSERT OR IGNORE INTO trade_push_delivery VALUES(?,?,?,?)').run(row.id,row.user,row.endpoint,stamp(clock()));
        }catch(error){
          if(error.statusCode===404||error.statusCode===410)
            db.prepare('DELETE FROM trade_push WHERE company=? AND user=? AND endpoint=?').run(row.company,row.user,row.endpoint);
        }
      }
    }finally{pushing=false;}
  }

  async function handle(path,req,res,input,params=new URLSearchParams()){
    const method=req.method;
    if(path==='/login'&&method==='POST')return auth.handle('login',input,req,res);
    if(path==='/logout'&&method==='POST')return auth.handle('logout',input,req,res);
    if(path==='/signup'&&method==='POST'){
      const email=emailOf(input.email),address=req.socket.remoteAddress||'local';
      auth.limit('trade-signup|ip|'+address,30,15*60000);
      if(!email)throw fail('Ingresá un correo válido.');
      auth.limit('trade-signup|email|'+email,4,3600000);
      if(hosted&&!sendEmail)throw fail('El registro por correo todavía no está configurado en este servidor.',503);
      const token=store.beginSignup(input,email);
      const link=new URL('/trade',origin);
      link.hash='alta='+token;
      if(!hosted&&!sendEmail)return {activation:'/trade'+link.hash};
      try{await sendEmail({to:email,kind:'trade-signup',url:link.href});}
      catch{store.discardSignup(token);throw fail('No se pudo enviar el correo de activación. Volvé a intentar.',503);}
      return {message:'Te enviamos un enlace para activar tu espacio. Revisá tu correo y la carpeta de correo no deseado.'};
    }
    if(path==='/signup/confirm'&&method==='POST'){
      auth.limit('trade-signup-confirm|'+(req.socket.remoteAddress||'local'),30,15*60000);
      const {company,user}=await store.signup(input);
      auth.openSession(user,res);
      return {company};
    }
    if(path==='/invite/accept'&&method==='POST'){
      auth.limit('trade-invite|'+(req.socket.remoteAddress||'local'),20,15*60000);
      return store.accept(input);
    }
    if(path==='/session'&&method==='GET'){
      const user=auth.current(req)?.user;
      return {memberships:user?store.listMemberships.all(user.id):[],email:user?.login_email||null,pushKey:push?.publicKey||null};
    }
    const m=access(req), reviewer=m.role!=='relevador';
    if(path==='/members'&&method==='GET'){
      access(req,['admin']);
      return {members:db.prepare('SELECT m.user,m.name,m.role,m.active,COALESCE(t.email,u.email) email FROM trade_members m JOIN users u ON u.id=m.user LEFT JOIN trade_identities t ON t.user=u.id WHERE m.company=? ORDER BY m.name').all(m.company)};
    }
    if(path==='/members/invite'&&method==='POST'){
      access(req,['admin']);
      const invitation=store.newInvite(m.company,input);
      const link=new URL('/trade',origin);
      link.hash='invite='+invitation.token;
      return {link:link.href,expires:invitation.expires};
    }
    if(path==='/members'&&method==='PATCH'){
      access(req,['admin']);
      if(input.user===m.user||!roles.includes(input.role)||typeof input.active!=='boolean')throw fail('No podés cambiar tu propio acceso. Revisá el rol.');
      transaction(()=>{
        const result=db.prepare('UPDATE trade_members SET role=?,active=? WHERE company=? AND user=?')
          .run(input.role,Number(input.active),m.company,text(input.user,80));
        if(!result.changes)throw fail('Empleado no disponible.',404);
        if(!input.active)db.prepare('DELETE FROM trade_push WHERE company=? AND user=?').run(m.company,input.user);
      });
      return {ok:true};
    }
    if(path==='/visits'&&method==='POST')return store.addVisit(m,input);
    if(path==='/visits'&&method==='GET')return {visits:reviewer?
      db.prepare('SELECT * FROM trade_visits WHERE company=? ORDER BY checked DESC LIMIT 200').all(m.company):
      db.prepare('SELECT * FROM trade_visits WHERE company=? AND user=? ORDER BY checked DESC LIMIT 200').all(m.company,m.user)};
    if(path==='/products'&&method==='GET'){
      const search=key(text(params.get('q'),120));
      const found=new Map();
      for(const r of [...store.rows(m,{limit:2000}),...store.rows(m,{confirmed:true,limit:2000})]){
        if(key([r.name,r.code,r.brand,r.presentation].join(' ')).includes(search)&&!found.has(r.product))
          found.set(r.product,{product:r.product,name:r.name,brand:r.brand,category:r.category,presentation:r.presentation,code:r.code});
      }
      return {products:[...found.values()].slice(0,50)};
    }
    if(path==='/records'&&method==='POST')return transaction(()=>store.writePrice(m,input));
    if(path==='/records'&&method==='GET'){
      const requested=text(params.get('status'),30);
      return {rows:store.rows(m,{limit:5000}).filter(r=>!requested||r.status===requested).slice(0,500)
        .map(r=>({...r,flags:r.status==='pendiente'?store.checks(r):[]}))};
    }
    const record=path.match(/^\/records\/([a-f0-9-]{36})(?:\/(review|audit|photo))?$/);
    if(record){
      const [,id,action]=record;
      visible(m,id);
      if(!action&&method==='PATCH')return transaction(()=>store.writePrice(m,input,id));
      if(action==='review'&&method==='POST'){
        access(req,['admin','supervisor']);
        return transaction(()=>store.review(m,id,input));
      }
      if(action==='audit'&&method==='GET')return {events:db.prepare('SELECT a.at,a.action,a.note,a.snapshot,m.name actor FROM trade_audit a JOIN trade_members m ON m.company=a.company AND m.user=a.actor WHERE a.company=? AND a.price=? ORDER BY a.seq').all(m.company,id)
        .map(event=>({...event,snapshot:JSON.parse(event.snapshot)}))};
      if(action==='photo'&&method==='GET'){
        const row=db.prepare('SELECT photo,mime FROM trade_prices WHERE company=? AND id=?').get(m.company,id);
        if(!row?.photo)throw fail('Foto no disponible.',404);
        return send(res,Buffer.from(row.photo),row.mime);
      }
    }
    if(path==='/own'&&method==='POST'){
      access(req,['admin','supervisor']);
      const {product}=identity(input),checked=date(input.checked,clock()),price=amount(input.price);
      const scope=text(input.scope,20);
      if(!['presencial','digital'].includes(scope))throw fail('Seleccioná el canal del precio propio.');
      db.prepare('INSERT INTO trade_own VALUES(?,?,?,?,?) ON CONFLICT(company,product,scope,checked) DO UPDATE SET price=excluded.price')
        .run(m.company,product,scope,checked,price);
      return {ok:true};
    }
    if(path==='/own'&&method==='GET'){
      access(req,['admin','supervisor']);
      return {rows:store.ownRows(m.company).slice(0,200)};
    }
    if(path==='/rules'&&method==='GET')return {rules:store.rules(m.company)};
    if(path==='/rules'&&method==='POST'){
      access(req,['admin','supervisor']);
      const threshold=Number(input.threshold);
      if(!text(String(input.threshold??''),30)||!Number.isFinite(threshold)||threshold<=0||threshold>1000)
        throw fail('Ingresá un umbral mayor que 0 y de hasta 1000 %.');
      if(store.rules(m.company).length>=50)throw fail('Alcanzaste el máximo de reglas.',409);
      const rule=Object.fromEntries(['product','store','branch','zone','category'].map(k=>[k,text(input[k],160)]));
      db.prepare('INSERT INTO trade_rules VALUES(?,?,?)').run(randomUUID(),m.company,JSON.stringify({...rule,threshold}));
      return {ok:true};
    }
    if(path.startsWith('/rules/')&&method==='DELETE'){
      access(req,['admin','supervisor']);
      db.prepare('DELETE FROM trade_rules WHERE company=? AND id=?').run(m.company,path.slice(7));
      return {ok:true};
    }
    if(path==='/alerts'&&method==='GET')return {alerts:db.prepare('SELECT a.id,a.created,a.payload FROM trade_alerts a '+validAlerts+
      ' WHERE a.company=? ORDER BY a.created DESC LIMIT 200').all(m.company).map(a=>({...a,payload:JSON.parse(a.payload)}))};
    if(path==='/push'&&method==='POST'){
      if(!push)throw fail('El servidor no tiene avisos del navegador configurados.',503);
      const s=subscriptionOf(input);
      if(!s)throw fail('Suscripción inválida.');
      const prior=db.prepare('SELECT user FROM trade_push WHERE endpoint=? AND user<>? LIMIT 1').get(s.endpoint,m.user);
      if(prior)throw fail('El dispositivo está vinculado con otra cuenta.',409);
      if(db.prepare('SELECT count(*) n FROM trade_push WHERE company=? AND user=? AND endpoint<>?').get(m.company,m.user,s.endpoint).n>=10)
        throw fail('Alcanzaste el límite de dispositivos.',409);
      db.prepare('INSERT INTO trade_push VALUES(?,?,?,?) ON CONFLICT(company,user,endpoint) DO UPDATE SET subscription=excluded.subscription')
        .run(m.company,m.user,s.endpoint,JSON.stringify(s));
      return {ok:true};
    }
    if(path==='/push'&&method==='DELETE'){
      db.prepare('DELETE FROM trade_push WHERE company=? AND user=? AND endpoint=?').run(m.company,m.user,text(input.endpoint,2000));
      return {ok:true};
    }
    if(path==='/import/preview'&&method==='POST'){
      const preview=await files.preview(input);
      access(req);
      return preview;
    }
    if((path==='/import'||path==='/import/check')&&method==='POST'){
      const rows=await files.spreadsheet(input);
      const current=access(req);
      const checking=path==='/import/check';
      return transaction(()=>{
        const selected=input.visit?store.visit(current,text(input.visit,80)):null;
        const visits=new Map();
        const issues=[];
        if(checking)db.exec('SAVEPOINT trade_import_check');
        for(const row of rows){
          try{
            let visit=selected?.id;
            if(!visit){
              const v=visitData(row,clock()),k=JSON.stringify(v);
              if(!visits.has(k))visits.set(k,store.addVisit(current,row).id);
              visit=visits.get(k);
            }
            store.writePrice(current,{...row,visit});
          }catch(error){
            if(!error.status)throw error;
            if(!checking)throw fail('Fila '+row.line+'. '+error.message,error.status);
            issues.push({line:row.line,field:error.field??null,message:error.message,product:row.name.slice(0,160),
              value:String(row[error.field]??'').slice(0,1000)});
          }
        }
        if(checking){
          db.exec('ROLLBACK TO trade_import_check; RELEASE trade_import_check');
          return {records:rows.length-issues.length,issues};
        }
        return {records:rows.length,visits:selected?1:visits.size};
      });
    }
    if(path==='/analysis'&&method==='GET')return analysis(m,params);
    if(path==='/export/template'&&method==='GET')return send(res,files.template(),'text/csv; charset=utf-8','radar-trade-plantilla.csv');
    if(path==='/export/records'&&method==='GET')return send(res,files.observations(store.rows(m,{limit:5000})),'text/csv; charset=utf-8','radar-trade-relevamientos.csv');
    if(path==='/export/recommendations'&&method==='GET')
      return send(res,files.recommendations(analysis(m,params).recommendations),'text/csv; charset=utf-8','radar-trade-oportunidades.csv');
    throw fail('Operación empresarial no disponible.',404);
  }
  return {handle,dispatch,store,authorizeRequest};
}
module.exports={tradeApi};
