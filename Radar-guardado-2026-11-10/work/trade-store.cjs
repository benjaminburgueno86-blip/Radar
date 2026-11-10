const { randomBytes, randomUUID } = require('node:crypto');
const { hash } = require('./platform-db.cjs');
const { fail, emailOf, validPassword, protect, verifyPassword } = require('./platform-accounts.cjs');
const M = require('./market-intelligence.cjs');

const roles = ['admin', 'supervisor', 'relevador'];
const statuses = ['pendiente', 'validado', 'rechazado'];
const unknownPresentation='Sin especificar';
const text = (v, max=160) => typeof v === 'string' ? v.trim().slice(0,max) : '';
const key = v => v.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const stamp = now => new Date(now).toISOString();
const localDay = new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Montevideo'});
const sameMeasure=(a,b)=>{
  const left=M.measure(a),right=M.measure(b);
  return !!left&&!!right&&left.unit===right.unit&&left.amount===right.amount&&left.count===right.count;
};
const columnError=(message,field,status=400)=>Object.assign(fail(message,status),{field});
function required(v,name,max,field) {
  const t=text(v,max);
  if(!t)throw columnError('Completá '+name+'.',field);
  return t;
}
function date(v, now) {
  const m=typeof v==='string'?v.match(/^(\d{4}-\d\d-\d\d)T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/):null;
  const n=m?Date.parse(v):NaN;
  if(!Number.isFinite(n)||n>now+60000||new Date(m[1]+'T00:00:00Z').toISOString().slice(0,10)!==m[1])
    throw columnError('Ingresá una fecha y hora válida del relevamiento.','checked');
  return stamp(n);
}
function amount(v,field='price') {
  const s=typeof v==='number'?String(v):text(v,40).replace(',','.');
  if(!/^\d+(?:\.\d{1,2})?$/.test(s)||Number(s)<=0||Number(s)>10000000)throw columnError('Ingresá un precio positivo en pesos, con hasta dos decimales.',field);
  return Math.round(Number(s)*100);
}
function identity(row) {
  const name=required(row.name,'el producto',160,'name'), brand=text(row.brand,100), category=required(row.category,'la categoría',100,'category');
  const presentation=required(row.presentation,'la presentación',120,'presentation'), supplied=text(String(row.code??''),32), code=M.gtin(supplied);
  if(supplied&&!code)throw columnError('El código de barras no es un GTIN válido. Podés dejarlo vacío.','code');
  if(!key(name)||!key(presentation))throw columnError('Ingresá nombre y presentación identificables.',key(name)?'presentation':'name');
  if(M.measure(name)&&M.measure(presentation)&&!sameMeasure(name,presentation))
    throw columnError('El contenido del nombre y el de la presentación no coinciden.','presentation');
  return { name,brand,category,presentation,code,product:code||'manual:'+hash(JSON.stringify([name,brand,category,presentation].map(key))) };
}
function photo(value) {
  if(value===undefined)return undefined;
  if(value===null||value==='')return {data:null,mime:null};
  if(typeof value!=='string'||value.length>2000100)throw fail('La foto debe pesar hasta 1,5 MB.');
  const match=value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match)throw fail('Adjuntá una imagen JPEG, PNG o WebP.');
  const data=Buffer.from(match[2],'base64'), type=match[1];
  const valid=type==='jpeg'?data.subarray(0,3).toString('hex')==='ffd8ff':
    type==='png'?data.subarray(0,8).toString('hex')==='89504e470d0a1a0a':
    data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP';
  if(!valid||data.length>1500000)throw fail('La imagen no corresponde al formato indicado o es demasiado grande.');
  return {data,mime:'image/'+type};
}
function visitData(row,now) {
  const store=required(row.store,'el comercio',150,'store'), branch=required(row.branch,'la sucursal',160,'branch');
  const address=required(row.address,'la dirección',240,'address'), zone=text(row.zone,120), checked=date(row.checked,now);
  const coord=v=>v===''||v==null?null:Number(String(v).replace(',','.'));
  const lat=coord(row.lat),lng=coord(row.lng);
  if((lat===null)!==(lng===null)||lat!==null&&(!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lng)||Math.abs(lng)>180))
    throw columnError('Ingresá coordenadas válidas o dejá ambas en blanco.',lat===null||!Number.isFinite(lat)||Math.abs(lat)>90?'lat':'lng');
  return {store,branch,address,zone,checked,lat,lng,place:JSON.stringify([store,branch,address].map(key))};
}
const matchesRule=(rule,row,percent)=>
  (!rule.product||rule.product===row.product)&&Math.abs(percent)>=rule.threshold&&
  ['store','branch','zone','category'].every(k=>!rule[k]||key(rule[k])===key(row[k]));

function tradeStore({db,transaction},{clock=Date.now,hosted=false}={}) {
  const membership=db.prepare('SELECT m.*,c.name companyName FROM trade_members m JOIN trade_companies c ON c.id=m.company WHERE m.company=? AND m.user=? AND m.active=1');
  const listMemberships=db.prepare('SELECT m.company,m.user,m.name,m.role,c.name companyName FROM trade_members m JOIN trade_companies c ON c.id=m.company WHERE m.user=? AND m.active=1 ORDER BY c.name,m.company');
  const baseRows='SELECT p.id,p.company,p.visit,p.user,p.product,p.place,p.checked,p.payload,p.status,p.version,p.photo IS NOT NULL hasPhoto,v.store,v.branch,v.address,v.zone,v.lat,v.lng,m.name employee FROM trade_prices p JOIN trade_visits v ON v.company=p.company AND v.id=p.visit JOIN trade_members m ON m.company=p.company AND m.user=p.user';
  const asRow=row=>{
    if(!row)return null;
    const {payload,...other}=row;
    return {...other,...JSON.parse(payload)};
  };
  const rowById=(company,id)=>asRow(db.prepare(baseRows+' WHERE p.company=? AND p.id=?').get(company,id));
  const loginUser=db.prepare('SELECT u.* FROM users u LEFT JOIN trade_identities t ON t.user=u.id WHERE t.email=?1 OR u.email=?1 ORDER BY u.trade_only DESC LIMIT 1');
  function rows(member,{confirmed=false,product='',limit=5000}={}) {
    const fields=['p.company=?'],args=[member.company];
    if(confirmed)fields.push("p.status='validado'");
    else if(member.role==='relevador'){fields.push('p.user=?');args.push(member.user);}
    if(product){fields.push('p.product=?');args.push(product);}
    return db.prepare(baseRows+' WHERE '+fields.join(' AND ')+' ORDER BY p.checked DESC,p.id LIMIT ?').all(...args,limit).map(asRow);
  }
  function ownRows(company) {
    return db.prepare('SELECT product,scope,checked,price FROM trade_own WHERE company=? ORDER BY checked DESC').all(company);
  }
  function newInvite(company,input) {
    const email=emailOf(input.email),name=required(input.name,'el nombre del empleado',120);
    if(!email||!roles.includes(input.role))throw fail('Ingresá un correo válido y elegí un rol.');
    const candidate=loginUser.get(email);
    const existing=candidate&&db.prepare('SELECT active FROM trade_members WHERE company=? AND user=?').get(company,candidate.id);
    if(existing?.active)throw fail('La persona ya pertenece a este espacio.',409);
    const token=randomBytes(32).toString('base64url'),expires=clock()+7*86400000;
    db.prepare('INSERT INTO trade_invites VALUES(?,?,?,?,?,?) ON CONFLICT(company,email) DO UPDATE SET token=excluded.token,name=excluded.name,role=excluded.role,expires=excluded.expires')
      .run(hash(token),company,email,name,input.role,expires);
    return {token,expires:stamp(expires)};
  }
  function provision(companyName,input) {
    return transaction(()=>{
      const id=randomUUID();
      db.prepare('INSERT INTO trade_companies VALUES(?,?,?)').run(id,required(companyName,'la empresa',150),stamp(clock()));
      return {company:id,...newInvite(id,{...input,role:'admin'})};
    });
  }
  function beginSignup(input,email) {
    const company=required(input.company,'la empresa',150),name=required(input.name,'tu nombre',120);
    const token=randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM trade_signups WHERE expires<=?').run(clock());
    db.prepare('INSERT INTO trade_signups VALUES(?,?,?,?,?)').run(hash(token),email,company,name,clock()+86400000);
    return token;
  }
  function discardSignup(token) {
    db.prepare('DELETE FROM trade_signups WHERE token=?').run(hash(token));
  }
  async function signup(input) {
    const raw=text(input.token,80),email=emailOf(input.email),password=input.password;
    if(!/^[\w-]{43}$/.test(raw)||!email||!validPassword(password))throw fail('Ingresá el correo del registro y una contraseña de al menos 12 caracteres.');
    const pending=db.prepare('SELECT * FROM trade_signups WHERE token=? AND email=? AND expires>?');
    const token=hash(raw);
    if(!pending.get(token,email,clock()))throw fail('Enlace inválido o vencido. Volvé a iniciar el registro.',403);
    const original=loginUser.get(email);
    if(original&&!await verifyPassword(password,original.password))throw fail('Usá la contraseña de tu cuenta existente.',401);
    if(original&&!original.trade_only&&!original.verified&&(hosted||!original.local_only))
      throw fail('Verificá el correo de tu cuenta existente de Radar antes de continuar.',403);
    const protectedPassword=original?null:await protect(password);
    return transaction(()=>{
      const row=pending.get(token,email,clock());
      if(!row)throw fail('Enlace inválido o vencido. Volvé a iniciar el registro.',403);
      const current=loginUser.get(email);
      if(current?.id!==original?.id||current?.password!==original?.password)throw fail('La cuenta cambió. Volvé a intentar.',409);
      const user=current?.id||createTradeUser(email,protectedPassword);
      const existing=listMemberships.all(user).find(member=>member.role==='admin'&&key(member.companyName)===key(row.company));
      const company=existing?.company||randomUUID();
      if(!existing){
        db.prepare('INSERT INTO trade_companies VALUES(?,?,?)').run(company,row.company,stamp(clock()));
        db.prepare("INSERT INTO trade_members VALUES(?,?,?,'admin',1)").run(company,user,row.name);
      }
      db.prepare('DELETE FROM trade_signups WHERE email=?').run(email);
      return {company,user};
    });
  }
  function createTradeUser(email,password) {
    const id=randomUUID();
    db.prepare('INSERT INTO users(id,email,password,trade_only) VALUES(?,?,?,1)').run(id,id+'@trade.invalid',password);
    db.prepare('INSERT INTO trade_identities VALUES(?,?)').run(id,email);
    return id;
  }
  async function accept(input) {
    const raw=text(input.token,80),email=emailOf(input.email),password=input.password;
    if(!/^[\w-]{43}$/.test(raw)||!email||!validPassword(password))throw fail('Ingresá el correo invitado y una contraseña de al menos 12 caracteres.');
    const token=hash(raw);
    const invite=db.prepare('SELECT * FROM trade_invites WHERE token=? AND email=? AND expires>?');
    if(!invite.get(token,email,clock()))throw fail('Invitación inválida o vencida.',403);
    const original=loginUser.get(email);
    if(original&&!await verifyPassword(password,original.password))throw fail('Usá la contraseña de tu cuenta existente.',401);
    const protectedPassword=original?null:await protect(password);
    return transaction(()=>{
      const row=invite.get(token,email,clock());
      if(!row)throw fail('Invitación inválida o vencida.',403);
      const current=loginUser.get(email);
      if(current?.password!==original?.password)throw fail('La cuenta cambió. Volvé a intentar.',409);
      if(current&&!current.verified&&!current.local_only&&!current.trade_only)
        throw fail('Verificá el correo de tu cuenta de Radar antes de aceptar la invitación.',403);
      const id=current?.id||createTradeUser(email,protectedPassword);
      db.prepare('INSERT INTO trade_members VALUES(?,?,?,?,1) ON CONFLICT(company,user) DO UPDATE SET name=excluded.name,role=excluded.role,active=1 WHERE active=0')
        .run(row.company,id,row.name,row.role);
      db.prepare('DELETE FROM trade_invites WHERE token=?').run(token);
      return {company:row.company};
    });
  }
  function addVisit(member,input) {
    const v=visitData(input,clock()),id=randomUUID();
    db.prepare('INSERT INTO trade_visits VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(member.company,id,member.user,v.store,v.branch,v.address,v.zone,v.checked,v.lat,v.lng);
    return {id,...v};
  }
  function visit(member,id) {
    const v=db.prepare('SELECT * FROM trade_visits WHERE company=? AND id=?').get(member.company,id);
    if(!v||member.role==='relevador'&&v.user!==member.user)throw fail('Visita no disponible.',404);
    return {...v,place:JSON.stringify([v.store,v.branch,v.address].map(key))};
  }
  function prior(row) {
    return asRow(db.prepare(baseRows+" WHERE p.company=? AND p.product=? AND p.place=? AND p.status='validado' AND p.checked<? ORDER BY p.checked DESC LIMIT 1")
      .get(row.company,row.product,row.place,row.checked));
  }
  function checks(row) {
    const result=[];
    if(row.presentation===unknownPresentation)result.push('presentación sin especificar');
    const other=db.prepare("SELECT id,payload,status FROM trade_prices WHERE company=? AND product=? AND place=? AND checked=? AND id<>? AND status<>'rechazado'")
      .all(row.company,row.product,row.place,row.checked,row.id);
    for(const item of other){
      const p=JSON.parse(item.payload);
      if(p.price===row.price&&p.promo===row.promo&&p.conditions===row.conditions)result.push('duplicado');
      else result.push('conflicto');
      if(item.status==='validado')result.push('ya validado');
    }
    if(row.code) {
      const sameCode=rows({company:row.company},{confirmed:true,product:row.product,limit:1000});
      const a=key(row.brand);
      if(sameCode.some(other=>a&&key(other.brand)&&a!==key(other.brand)||
        !M.compatible([{name:row.name+' '+row.presentation},{name:other.name+' '+other.presentation}])||
        key(row.presentation)!==key(other.presentation)&&!sameMeasure(row.presentation,other.presentation)))
        result.push('identidad contradictoria');
    }
    const baseline=prior(row);
    if(baseline&&Math.abs(row.price/baseline.price-1)>=0.30)result.push('variación inusual');
    return [...new Set(result)];
  }
  function audit(row,actor,action,note) {
    db.prepare('INSERT INTO trade_audit(company,price,actor,at,action,note,snapshot) VALUES(?,?,?,?,?,?,?)')
      .run(row.company,row.id,actor,stamp(clock()),action,note,JSON.stringify(row));
  }
  function writePrice(member,input,id) {
    const previous=id?rowById(member.company,id):null;
    if(id&&(!previous||member.role==='relevador'&&previous.user!==member.user))throw fail('Registro no disponible.',404);
    if(previous&&(previous.version!==input.version||member.role==='relevador'&&previous.status==='validado'))
      throw fail('El registro cambió o ya fue validado. Actualizá la lista.',409);
    if(previous&&!text(input.reason,500))throw fail('Indicá el motivo de la corrección.');
    const v=visit(member,previous?.visit||input.visit);
    const {product,...item}=identity(input);
    const price=amount(input.price);
    const promo=input.promo===''||input.promo==null?null:amount(input.promo,'promo');
    const conditions=text(input.conditions,500);
    if(promo!==null&&(promo>=price||!conditions))throw columnError('La promoción debe ser inferior al precio de góndola e indicar sus condiciones.',promo>=price?'promo':'conditions');
    const picture=photo(input.photo);
    const payload={...item,price,promo,conditions,notes:text(input.notes,900)};
    const row={...payload,id:id||randomUUID(),company:member.company,visit:v.id,user:previous?.user||member.user,
      product,place:v.place,checked:v.checked,status:'pendiente',version:(previous?.version||0)+1};
    const flags=checks(row);
    if(flags.includes('duplicado'))throw fail('Ya existe un registro con ese producto, sucursal, fecha y precio.',409);
    if(previous){
      audit(previous,member.user,'antes de corregir',text(input.reason,500));
      db.prepare("UPDATE trade_prices SET product=?,payload=?,status='pendiente',version=? WHERE company=? AND id=?")
        .run(product,JSON.stringify(payload),row.version,member.company,id);
      if(picture!==undefined)db.prepare('UPDATE trade_prices SET photo=?,mime=? WHERE company=? AND id=?').run(picture.data,picture.mime,member.company,id);
    }else db.prepare('INSERT INTO trade_prices VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(row.id,row.company,row.visit,row.user,product,row.place,row.checked,JSON.stringify(payload),picture?.data??null,picture?.mime??null,row.status,row.version);
    audit({...row,hasPhoto:picture===undefined?!!previous?.hasPhoto:!!picture.data},member.user,previous?'corregido':'registrado','');
    return {...row,flags};
  }
  function rules(company) {
    return db.prepare('SELECT id,payload FROM trade_rules WHERE company=? ORDER BY id').all(company).map(x=>({id:x.id,...JSON.parse(x.payload)}));
  }
  function review(member,id,input) {
    const row=rowById(member.company,id);
    if(!row)throw fail('Registro no disponible.',404);
    if(row.version!==input.version||row.status!=='pendiente')throw fail('El registro cambió. Actualizá la lista.',409);
    const status=input.status;
    if(!statuses.slice(1).includes(status))throw fail('Elegí validar o rechazar.');
    const flags=checks(row),note=text(input.reason,500);
    if(status==='validado'&&flags.includes('presentación sin especificar'))
      throw fail('Completá la presentación del producto antes de validarlo.',409);
    if(status==='validado'&&flags.some(f=>['duplicado','ya validado','identidad contradictoria'].includes(f)))
      throw fail('Corregí la identidad o resolvé el registro duplicado antes de validar.',409);
    if((status==='rechazado'||flags.length)&&!note)throw fail('Justificá la decisión de revisión.');
    db.prepare('UPDATE trade_prices SET status=?,version=version+1 WHERE id=? AND company=?').run(status,id,member.company);
    const changed={...row,status,version:row.version+1};
    audit(changed,member.user,status,note);
    if(status==='validado') {
      const previous=prior(changed);
      if(previous&&changed.price!==previous.price){
        const percent=(changed.price-previous.price)/previous.price*100;
        if(rules(member.company).some(rule=>matchesRule(rule,changed,percent))){
          const event={product:row.product,name:row.name,store:row.store,branch:row.branch,zone:row.zone,checked:row.checked,
            previousChecked:previous.checked,price:row.price,previous:previous.price,percent,
            impact:percent<0?'Revisá la diferencia frente a tu precio presencial antes de aplicar una promoción.':'Comprobá si tu precio presencial quedó por debajo y evaluá comunicar la diferencia.'};
          db.prepare('INSERT OR IGNORE INTO trade_alerts VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),member.company,id,changed.version,
            previous.id,previous.version,stamp(clock()),JSON.stringify(event));
        }
      }
    }
    return changed;
  }
  return {membership,listMemberships,provision,newInvite,accept,beginSignup,discardSignup,signup,addVisit,visit,rows,ownRows,rowById,checks,writePrice,review,rules};
}
module.exports={tradeStore,roles,text,key,stamp,localDay,amount,date,identity,visitData,sameMeasure,unknownPresentation};
