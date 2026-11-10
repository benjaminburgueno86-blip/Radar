const path=require('node:path');
const fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
const {openPlatform}=require('./platform-db.cjs');
const {configuredFeeds,createCollector}=require('./platform-feeds.cjs');
const {pilotCatalogs}=require('./platform-catalog.cjs');
const {platformApi}=require('./platform-api.cjs');
const {emailTransport}=require('./platform-accounts.cjs');
const {configurePush,pushDispatcher}=require('./platform-push.cjs');
const {tradeApi}=require('./trade-api.cjs');

const defaultPath=path.join(__dirname,'runtime-platform','gondolupa.sqlite');

function seed(platform) {
  const legacy=path.join(__dirname,'gondolupa.sqlite');
  let observations;
  if(fs.existsSync(legacy)){
    const db=new DatabaseSync(legacy,{readOnly:true});
    try{observations=db.prepare('SELECT product,store,scope,branch,name,price,available,url,checked FROM observations').all();}
    finally{db.close();}
  }else{
    observations=JSON.parse(fs.readFileSync(path.join(__dirname,'../outputs/datos-gondolupa.json'),'utf8')).observations;
  }
  return platform.ingest(observations.map(r=>({...r,currency:'UYU'})),{source:'archivo histórico Gondolupa',alerts:false});
}

function setup({env=process.env,origin,hosted=false,database=env.GONDOLUPA_DB||defaultPath,
  schedule=true,clock=Date.now,sendEmail=emailTransport(env),push=configurePush(env),fetchFn=fetch,seedData=true}={}) {
  if(hosted&&!env.GONDOLUPA_DB&&database===defaultPath)throw Error('Configurá GONDOLUPA_DB sobre un disco persistente.');
  const feeds=configuredFeeds(env.PRICE_FEEDS_JSON);
  if(env.GONDOLUPA_CATALOG_PILOT==='1'){
    if(hosted&&!env.GONDOLUPA_CATALOG_PERMISSION?.trim())throw Error('Configurá la autorización del catálogo en GONDOLUPA_CATALOG_PERMISSION.');
    feeds.push(...pilotCatalogs());
    if(new Set(feeds.map(feed=>feed.id)).size!==feeds.length)throw Error('Hay identificadores de fuente repetidos.');
  }
  const recentHours=Number(env.PRICE_RECENT_HOURS||24),staleHours=Number(env.PRICE_STALE_HOURS||48);
  if(!Number.isFinite(recentHours)||!Number.isFinite(staleHours)||recentHours<1||staleHours<recentHours||staleHours>720)
    throw Error('Los umbrales de vigencia deben ser horas entre 1 y 720, en orden ascendente.');
  const platform=openPlatform(database);
  if(seedData)seed(platform);
  const dispatch=pushDispatcher(platform,push,clock);
  const collector=createCollector(platform,{feeds,clock,fetchFn,onCollected:dispatch});
  const adminEmail=String(env.GONDOLUPA_ADMIN_EMAIL||'').trim().toLowerCase();
  const api=platformApi(platform,{origin,hosted,sendEmail,push,dispatch,collector,clock,recentHours,staleHours,adminEmail});
  const trade=tradeApi(platform,{origin,hosted,clock,recentHours:staleHours,push,sendEmail});
  let task=null;
  function tick(){
    if(task)return;
    task=collector.collect().then(dispatch).then(trade.dispatch).catch(error=>console.error('Gondolupa: fallo de actualización',error.name))
      .finally(()=>{task=null;});
  }
  const timer=schedule?setInterval(tick,60000):null;
  timer?.unref();
  if(schedule)tick();
  return {api,trade,platform,collector,close:async()=>{if(timer)clearInterval(timer);await task;platform.close();}};
}

module.exports={setup,seed,defaultPath};
