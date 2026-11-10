const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const { mkdirSync } = require('node:fs');
const { dirname } = require('node:path');
const M = require('./market-intelligence.cjs');

const migrations = [[
  "CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,password TEXT NOT NULL,verified INTEGER NOT NULL DEFAULT 0,profile TEXT NOT NULL DEFAULT '{}');",
  'CREATE TABLE sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);',
  'CREATE TABLE account_links(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,expires INTEGER NOT NULL);',
  'CREATE TABLE limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset INTEGER NOT NULL);',
  'CREATE TABLE prices(id INTEGER PRIMARY KEY,product TEXT NOT NULL,store TEXT NOT NULL,scope TEXT NOT NULL,branch TEXT NOT NULL,name TEXT NOT NULL,brand TEXT NOT NULL,category TEXT NOT NULL,price REAL NOT NULL CHECK(price>0),currency TEXT NOT NULL,available INTEGER,url TEXT NOT NULL,checked TEXT NOT NULL,promotion TEXT NOT NULL,source TEXT NOT NULL,fingerprint TEXT NOT NULL UNIQUE);',
  'CREATE INDEX price_series ON prices(product,store,scope,branch,currency,promotion,checked);',
  'CREATE INDEX prices_time ON prices(checked);',
  'CREATE TABLE source_runs(id INTEGER PRIMARY KEY,source TEXT NOT NULL,started TEXT NOT NULL,status TEXT NOT NULL,count INTEGER NOT NULL,error TEXT NOT NULL);',
  'CREATE INDEX source_run_time ON source_runs(source,started);',
  'CREATE TABLE follows(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,preferences TEXT NOT NULL);',
  'CREATE TABLE changes(id INTEGER PRIMARY KEY,signature TEXT NOT NULL UNIQUE,event TEXT NOT NULL,detected INTEGER NOT NULL);',
  'CREATE TABLE inbox(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,change_id INTEGER NOT NULL REFERENCES changes(id),seen INTEGER,pushed INTEGER,PRIMARY KEY(user_id,change_id));',
  'CREATE INDEX inbox_pending ON inbox(user_id,pushed,change_id);',
  'CREATE TABLE subscriptions(endpoint TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,subscription TEXT NOT NULL);',
  'CREATE TABLE saved_reports(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,payload TEXT NOT NULL,created TEXT NOT NULL);',
  'CREATE INDEX report_owner ON saved_reports(user_id,created);',
].join('\n'), 'CREATE TABLE projects(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, payload TEXT NOT NULL);',
  'ALTER TABLE users ADD COLUMN local_only INTEGER NOT NULL DEFAULT 0;', require('./trade-schema.cjs'),
  'CREATE TABLE trade_signups (token TEXT PRIMARY KEY, email TEXT NOT NULL, company TEXT NOT NULL, name TEXT NOT NULL, expires INTEGER NOT NULL); CREATE INDEX trade_signup_email ON trade_signups(email);'];
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

function openPlatform(path) {
  if (path!==':memory:') mkdirSync(dirname(path),{recursive:true});
  const db=new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const version=db.prepare('PRAGMA user_version').get().user_version;
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {const result=fn();db.exec('COMMIT');return result;}
    catch(error){db.exec('ROLLBACK');throw error;}
  }
  for(let i=version;i<migrations.length;i++)transaction(()=>{
    db.exec(migrations[i]);
    db.exec('PRAGMA user_version='+(i+1));
  });
  const latest=db.prepare('SELECT * FROM prices WHERE product=? AND store=? AND scope=? AND branch=? AND currency=? AND promotion=? AND available=1 ORDER BY checked DESC,id DESC LIMIT 1');
  const insert=db.prepare('INSERT OR IGNORE INTO prices(product,store,scope,branch,name,brand,category,price,currency,available,url,checked,promotion,source,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const addChange=db.prepare('INSERT OR IGNORE INTO changes(signature,event,detected) VALUES(?,?,?)');
  const addInbox=db.prepare('INSERT OR IGNORE INTO inbox(user_id,change_id) VALUES(?,?)');
  const findFingerprint=db.prepare('SELECT price,available FROM prices WHERE fingerprint=?');
  const compareCode=db.prepare("SELECT * FROM prices WHERE product=? AND scope=? AND promotion='' AND checked>=? AND checked<=?");
  const matched=(rule,e)=>(!rule.stores.length||rule.stores.includes(e.store)) &&
    (rule.products.includes(e.product)||rule.categories.some(value=>value.toLowerCase()===e.category.toLowerCase())) && Math.abs(e.percent)>=rule.threshold;
  const scopeKey=r=>[r.product,r.store,r.scope,r.branch,r.currency,r.promotion];
  function ingest(input,{source,now=Date.now(),alerts=true}={}) {
    const rows=input.map(r=>normalize(r,source,now)).filter(Boolean).sort((a,b)=>a.checked.localeCompare(b.checked));
    const at=new Date(now).toISOString();
    return transaction(()=>{
      const followers=alerts?db.prepare('SELECT user_id,preferences FROM follows').all().map(r=>[r.user_id,JSON.parse(r.preferences)]):[];
      let inserted=0,changes=0,conflicts=0;
      const groups=new Map();
      for(const r of rows){
        const signature=hash(JSON.stringify([...scopeKey(r),r.checked]));
        const group=groups.get(signature)||[];
        group.push(r);
        groups.set(signature,group);
      }
      function recordChange(signature,event){
        const added=addChange.run(signature,JSON.stringify(event),now);
        if(!added.changes)return;
        changes++;
        for(const [user,rule] of followers)if(matched(rule,event))addInbox.run(user,added.lastInsertRowid);
      }
      for(const [signature,duplicates] of groups){
        const r=duplicates[0];
        const found=findFingerprint.get(signature);
        if(duplicates.some(d=>d.price!==r.price||d.available!==r.available)||
           (found&&(found.price!==r.price||found.available!==r.available))){conflicts+=duplicates.length;continue;}
        if(found)continue;
        const key=scopeKey(r);
        const prior=latest.get(...key);
        const canCompare=alerts&&prior&&M.gtin(r.product)&&r.available===1&&!r.promotion&&prior.checked<r.checked&&prior.price!==r.price&&
          now-Date.parse(r.checked)<=48*3600000&&M.analyze([{...prior,store:'anterior',checked:r.checked},{...r,store:'nuevo'}],{now}).products.length;
        const recent=canCompare?compareCode.all(r.product,r.scope,new Date(now-72*3600000).toISOString(),r.checked):[];
        if(!insert.run(...Object.values(r),signature).changes)continue;
        inserted++;
        if(!canCompare)continue;
        const delta=Math.round((r.price-prior.price)*100)/100;
        const event={...r,kind:delta>0?'aumento':'reducción',previous:prior.price,previousChecked:prior.checked,
          delta,percent:delta/prior.price*100,detected:at};
        recordChange(signature,event);
        const before=M.analyze(recent,{now}).products[0];
        const after=M.analyze([...recent,r],{now}).products[0];
        const cohort=p=>p.quotes.map(q=>q.store+'|'+q.branch).sort().join(';');
        if(!before||!after||cohort(before)!==cohort(after))continue;
        const leaders=p=>p.quotes.filter(q=>q.price===p.min).map(q=>q.store).sort();
        const newLeaders=leaders(after).filter(store=>!leaders(before).includes(store));
        if(newLeaders.length){
          recordChange(hash(signature+'|lider'),{...event,kind:'nuevo mínimo',benchmark:after.min,leaders:newLeaders});
        }
        if(before.gap<10&&after.gap>=10){
          recordChange(hash(signature+'|oportunidad'),{...event,kind:'nueva oportunidad',benchmark:after.min,gap:after.gap});
        }
      }
      return {inserted,rejected:input.length-rows.length+conflicts,changes};
    });
  }
  const observations=()=>db.prepare('SELECT id,product,store,scope,branch,name,brand,category,price,currency,available,url,checked,promotion,source FROM prices ORDER BY checked,id').all();
  const sourceStatus=()=>db.prepare('SELECT source,started,status,count,error FROM source_runs r WHERE id=(SELECT max(id) FROM source_runs WHERE source=r.source) ORDER BY source').all();
  return {db,transaction,ingest,observations,sourceStatus,close:()=>db.close()};
}

module.exports={openPlatform,hash,url};
