const { createHash,randomUUID } = require('node:crypto');
const M = require('./market-intelligence.cjs');

const text = (v,n) => typeof v === 'string' ? v.trim().slice(0,n) : '';
const hash = v => createHash('sha256').update(v).digest('hex');
function url(value) {
  try {
    const u=new URL(value);
    if (u.protocol==='https:' && !u.username && !u.password) return u.href;
  }catch{}
  return '';
}

function normalize(row,source,now) {
  if (!row || typeof row!=='object') return null;
  const rawCode=text(row.product,100);
  const product=M.gtin(rawCode)||rawCode;
  const store=text(row.store,50).toLowerCase(),scope=text(row.scope,30),branch=text(row.branch,220);
  const name=text(row.name,250),currency=text(row.currency,3).toUpperCase();
  const timestamp=typeof row.checked==='string' && /(?:Z|[+-]\d\d:\d\d)$/.test(row.checked) ? Date.parse(row.checked) : NaN;
  const price=typeof row.price==='number' && row.price>0 && row.price<=10000000 ? Math.round(row.price*100)/100 : 0;
  const link=url(row.url);
  if (!product || !/^[a-z0-9_-]+$/.test(store) || !['online','source-branch'].includes(scope) ||
      !branch || !name || currency!=='UYU' || !timestamp || timestamp>now || !price || !link) return null;
  const available=row.available===true||row.available===1?1:row.available===false||row.available===0?0:null;
  return {product,store,scope,branch,name,brand:text(row.brand,100),category:text(row.category,100)||M.category(name),
    price,currency,available,url:link,checked:new Date(timestamp).toISOString(),promotion:text(row.promotion,200),source};
}

async function openPlatform(options) {
  const {db,transaction,close}=await require('./platform-connection.cjs').connect(options);
  const latest=db.prepare('SELECT * FROM prices WHERE product=? AND store=? AND scope=? AND branch=? AND currency=? AND promotion=? AND available=1 ORDER BY checked DESC,id DESC LIMIT 1');
  const insert=db.prepare('INSERT INTO prices(product,store,scope,branch,name,brand,category,price,currency,available,url,checked,promotion,source,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(fingerprint) DO NOTHING');
  const addChange=db.prepare('INSERT INTO changes(signature,event,detected) VALUES(?,?,?) ON CONFLICT(signature) DO NOTHING RETURNING id');
  const addInbox=db.prepare('INSERT INTO inbox(user_id,change_id) VALUES(?,?) ON CONFLICT(user_id,change_id) DO NOTHING');
  const findFingerprint=db.prepare('SELECT price,available FROM prices WHERE fingerprint=?');
  const compareCode=db.prepare("SELECT * FROM prices WHERE product=? AND scope=? AND promotion='' AND checked>=? AND checked<=?");
  const matched=(rule,e)=>(!rule.stores.length||rule.stores.includes(e.store)) &&
    (rule.products.includes(e.product)||rule.categories.some(value=>value.toLowerCase()===e.category.toLowerCase())) && Math.abs(e.percent)>=rule.threshold;
  const scopeKey=r=>[r.product,r.store,r.scope,r.branch,r.currency,r.promotion];
  function ingest(input,{source,now=Date.now(),alerts=true}={}) {
    const rows=input.map(r=>normalize(r,source,now)).filter(Boolean).sort((a,b)=>a.checked.localeCompare(b.checked));
    const at=new Date(now).toISOString();
    return transaction(async()=>{
      const followers=alerts?(await db.prepare('SELECT user_id,preferences FROM follows').all()).map(r=>[r.user_id,JSON.parse(r.preferences)]):[];
      let inserted=0,changes=0,conflicts=0;
      const groups=new Map();
      for(const r of rows){
        const signature=hash(JSON.stringify([...scopeKey(r),r.checked]));
        const group=groups.get(signature)||[];
        group.push(r);
        groups.set(signature,group);
      }
      async function recordChange(signature,event){
        const added=await addChange.get(signature,JSON.stringify(event),now);
        if(!added)return;
        changes++;
        for(const [user,rule] of followers)if(matched(rule,event))await addInbox.run(user,added.id);
      }
      for(const [signature,duplicates] of groups){
        const r=duplicates[0];
        const found=await findFingerprint.get(signature);
        if(duplicates.some(d=>d.price!==r.price||d.available!==r.available)||
           (found&&(found.price!==r.price||found.available!==r.available))){conflicts+=duplicates.length;continue;}
        if(found)continue;
        const key=scopeKey(r);
        const prior=alerts?await latest.get(...key):null;
        const canCompare=alerts&&prior&&M.gtin(r.product)&&r.available===1&&!r.promotion&&prior.checked<r.checked&&prior.price!==r.price&&
          now-Date.parse(r.checked)<=48*3600000&&M.analyze([{...prior,store:'anterior',checked:r.checked},{...r,store:'nuevo'}],{now}).products.length;
        const recent=canCompare?await compareCode.all(r.product,r.scope,new Date(now-72*3600000).toISOString(),r.checked):[];
        if(!(await insert.run(...Object.values(r),signature)).changes)continue;
        inserted++;
        if(!canCompare)continue;
        const delta=Math.round((r.price-prior.price)*100)/100;
        const event={...r,kind:delta>0?'aumento':'reducción',previous:prior.price,previousChecked:prior.checked,
          delta,percent:delta/prior.price*100,detected:at};
        await recordChange(signature,event);
        const before=M.analyze(recent,{now}).products[0];
        const after=M.analyze([...recent,r],{now}).products[0];
        const cohort=p=>p.quotes.map(q=>q.store+'|'+q.branch).sort().join(';');
        if(!before||!after||cohort(before)!==cohort(after))continue;
        const leaders=p=>p.quotes.filter(q=>q.price===p.min).map(q=>q.store).sort();
        const newLeaders=leaders(after).filter(store=>!leaders(before).includes(store));
        if(newLeaders.length){
          await recordChange(hash(signature+'|lider'),{...event,kind:'nuevo mínimo',benchmark:after.min,leaders:newLeaders});
        }
        if(before.gap<10&&after.gap>=10){
          await recordChange(hash(signature+'|oportunidad'),{...event,kind:'nueva oportunidad',benchmark:after.min,gap:after.gap});
        }
      }
      return {inserted,rejected:input.length-rows.length+conflicts,changes};
    });
  }
  const observations=()=>db.prepare('SELECT id,product,store,scope,branch,name,brand,category,price,currency,available,url,checked,promotion,source FROM prices ORDER BY checked,id').all();
  const sourceStatus=()=>db.prepare('SELECT source,started,status,count,error FROM source_runs r WHERE id=(SELECT max(id) FROM source_runs WHERE source=r.source) ORDER BY source').all();
  async function withLease(name,action){
    const key='lease:'+name,now=Date.now(),value=(now+15*60000)+':'+randomUUID();
    const claimed=await transaction(async()=>{
      const current=await db.prepare('SELECT value FROM platform_meta WHERE key=?').get(key);
      if(current&&Number(current.value.split(':')[0])>now)return false;
      await db.prepare('INSERT INTO platform_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
      return true;
    });
    if(!claimed)return null;
    try{return await action();}
    finally{await db.prepare('DELETE FROM platform_meta WHERE key=? AND value=?').run(key,value);}
  }
  return {db,transaction,ingest,observations,sourceStatus,withLease,close};
}

module.exports={openPlatform,hash,url};
