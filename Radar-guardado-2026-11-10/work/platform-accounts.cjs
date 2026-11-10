const { randomBytes, randomUUID, scrypt, timingSafeEqual }=require('node:crypto');
const { promisify }=require('node:util');
const { hash }=require('./platform-db.cjs');
const derive=promisify(scrypt);
const token=()=>randomBytes(32).toString('base64url');
const options={N:32768,r:8,p:1,maxmem:64*1024*1024};
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const emailOf=value=>typeof value==='string'&&value.length<=254&&/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim())?value.trim().toLowerCase():'';
const validPassword=value=>typeof value==='string'&&value.length>=12&&Buffer.byteLength(value)<=256;

async function protect(password) {
  const salt=randomBytes(16).toString('hex');
  const bytes=await derive(password,salt,64,options);
  return salt+':'+bytes.toString('hex');
}
async function verifyPassword(password,stored) {
  const [salt,value]=stored?stored.split(':'):['c1d12b1cd3815b4a6b4b2a8e31b7ac0f','0'.repeat(128)];
  const expected=Buffer.from(value,'hex'),actual=await derive(password,salt,64,options);
  return timingSafeEqual(expected,actual)&&!!stored;
}

function accounts({db,transaction}, { origin, sendEmail, localAccess=false, localRegistration=false, enterprise=false, clock=Date.now }={}) {
  const secure=origin?.startsWith('https:');
  const cookieName=enterprise?(secure?'__Host-radar-trade':'radar_trade_session'):(secure?'__Host-gondolupa':'gondolupa_session');
  const sessionKey=raw=>hash(enterprise?'trade:'+raw:raw);
  const member=enterprise?db.prepare('SELECT 1 FROM trade_members WHERE user=? AND active=1'):null;
  const eligible=user=>!!user&&(enterprise?!!member.get(user.id)&&(user.trade_only||user.verified||localAccess&&user.local_only):
    !user.trade_only&&(user.verified||localAccess&&user.local_only));
  const cookie=(value,maxAge)=>cookieName+'='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+maxAge+(secure?'; Secure':'');
  const byEmail=db.prepare(enterprise?
    'SELECT u.*,COALESCE(t.email,u.email) login_email FROM users u LEFT JOIN trade_identities t ON t.user=u.id WHERE t.email=?1 OR u.email=?1 ORDER BY u.trade_only DESC LIMIT 1':
    'SELECT * FROM users WHERE email=?');
  const bySession=db.prepare(enterprise?
    'SELECT u.*,COALESCE(t.email,u.email) login_email FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN trade_identities t ON t.user=u.id WHERE s.token=? AND s.expires>?':
    'SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?');
  const current=req=>{
    const entry=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='));
    const raw=entry?.slice(cookieName.length+1);
    const user=raw&&/^[\w-]{43}$/.test(raw)?bySession.get(sessionKey(raw),clock()):null;
    return eligible(user)?{user,raw}:null;
  };
  function limit(key,max,span) {
    const now=clock();
    db.prepare('DELETE FROM limits WHERE reset<=?').run(now);
    const row=db.prepare('INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').get(hash(key),now+span);
    if(row.count>max)throw fail('Demasiados intentos. Probá más tarde.',429);
  }
  async function link(user,kind) {
    if(!sendEmail||!origin)throw fail('El envío de correo requiere configuración del administrador.',503);
    const raw=token(),digest=hash(raw),hours=kind==='verify'?24:1;
    db.prepare('INSERT INTO account_links VALUES(?,?,?,?)').run(digest,user.id,kind,clock()+hours*3600000);
    try{
      const target=new URL(origin);
      target.searchParams.set(kind,raw);
      await sendEmail({to:user.email,kind,url:target.href});
    }catch{
      db.prepare('DELETE FROM account_links WHERE token=?').run(digest);
      throw fail('El servicio de correo no pudo entregar el enlace.',503);
    }
  }
  function consume(raw,kind,apply) {
    if(typeof raw!=='string'||!/^[\w-]{43}$/.test(raw))throw fail('Enlace inválido o vencido.');
    return transaction(()=>{
      const record=db.prepare('SELECT * FROM account_links WHERE token=? AND kind=? AND expires>?').get(hash(raw),kind,clock());
      if(!record)throw fail('Enlace inválido o vencido.');
      apply(record.user_id);
      db.prepare('DELETE FROM account_links WHERE user_id=? AND kind=?').run(record.user_id,kind);
    });
  }
  function openSession(userId,res) {
    const raw=token();
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(clock());
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sessionKey(raw),userId,clock()+7*86400000);
    res.setHeader('Set-Cookie',cookie(raw,7*86400));
  }
  async function handle(action,input,req,res) {
    const email=emailOf(input.email);
    const address=req.socket.remoteAddress||'local';
    if(['register','login','recover','resend','reset','verify'].includes(action)){
      limit(action+'|ip|'+address,action==='login'?45:30,15*60000);
      if(email)limit(action+'|email|'+email,action==='login'?8:4,15*60000);
    }
    if(enterprise&&!['login','logout'].includes(action))throw fail('Operación no disponible.',404);
    if(action==='register'){
      if(!email||!validPassword(input.password))throw fail('Ingresá un correo y una contraseña de al menos 12 caracteres.');
      if(localRegistration){
        const created=db.prepare('INSERT OR IGNORE INTO users(id,email,password,local_only) VALUES(?,?,?,1)')
          .run(randomUUID(),email,await protect(input.password));
        if(!created.changes)throw fail('Ya existe una cuenta con ese correo. Iniciá sesión.',409);
        return {message:'Cuenta local creada. Ya podés iniciar sesión con tu correo y contraseña.'};
      }
      if(!sendEmail||!origin)throw fail('El envío de correo requiere configuración del administrador.',503);
      if(!byEmail.get(email)){
        const id=randomUUID(),password=await protect(input.password);
        const created=db.prepare('INSERT OR IGNORE INTO users(id,email,password) VALUES(?,?,?)').run(id,email,password);
        if(created.changes){
          try{await link({id,email},'verify');}catch(error){db.prepare('DELETE FROM users WHERE id=? AND verified=0').run(id);throw error;}
        }
      }
      return {message:'Si el correo admite registro, te va a llegar un enlace de verificación.'};
    }
    if(action==='login'){
      const user=email?byEmail.get(email):null;
      if(!validPassword(input.password)||!await verifyPassword(input.password,user?.password)||
        !eligible(user))
        throw fail('Credenciales inválidas o correo sin verificar.',401);
      openSession(user.id,res);
      return {email:user.login_email||user.email,profile:JSON.parse(user.profile)};
    }
    if(action==='logout'){
      const session=current(req);
      if(session)db.prepare('DELETE FROM sessions WHERE token=?').run(sessionKey(session.raw));
      res.setHeader('Set-Cookie',cookie('',0));
      return {ok:true};
    }
    if(action==='recover'||action==='resend'){
      const user=email?byEmail.get(email):null;
      if(user&&!user.trade_only&&((action==='recover'&&user.verified)||(action==='resend'&&!user.verified)))
        await link(user,action==='recover'?'reset':'verify');
      return {message:'Si la cuenta corresponde a esta solicitud, te va a llegar un enlace.'};
    }
    if(action==='verify'){
      consume(input.token,'verify',id=>db.prepare('UPDATE users SET verified=1 WHERE id=?').run(id));
      return {message:'Correo verificado. Ya podés iniciar sesión.'};
    }
    if(action==='reset'){
      if(!validPassword(input.password))throw fail('Usá una contraseña de al menos 12 caracteres.');
      const password=await protect(input.password);
      consume(input.token,'reset',id=>{
        db.prepare('UPDATE users SET password=? WHERE id=?').run(password,id);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      });
      return {message:'Contraseña cambiada. Ya podés iniciar sesión.'};
    }
    throw fail('Operación no disponible.',404);
  }
  return {handle,current,limit,openSession};
}

function emailTransport(env) {
  if(!env.RESEND_API_KEY||!env.MAIL_FROM)return null;
  return async ({to,kind,url})=>{
    const [subject,text]=kind==='trade-signup'?
      ['Activá tu empresa en Radar Trade Marketing','Activá tu espacio empresarial con este enlace: ']:kind==='verify'?
      ['Verificá tu cuenta de Gondolupa','Verificá tu correo con este enlace: ']:
      ['Recuperá tu contraseña de Gondolupa','Cambiá tu contraseña con este enlace: '];
    const response=await fetch('https://api.resend.com/emails',{
      method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({from:env.MAIL_FROM,to:[to],subject,text:text+url}),
      signal:AbortSignal.timeout(12000),
    });
    if(!response.ok)throw Error('El proveedor de correo rechazó el envío.');
  };
}

module.exports={accounts,emailTransport,fail,protect,verifyPassword,emailOf,validPassword};
