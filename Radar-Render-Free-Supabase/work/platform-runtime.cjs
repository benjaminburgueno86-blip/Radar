const path=require('node:path');
const fs=require('node:fs');
const {openPlatform}=require('./platform-db.cjs');
const {configuredFeeds,createCollector}=require('./platform-feeds.cjs');
const {pilotCatalogs}=require('./platform-catalog.cjs');
const {platformApi}=require('./platform-api.cjs');
const {emailTransport}=require('./platform-accounts.cjs');
const {configurePush,pushDispatcher}=require('./platform-push.cjs');
const {tradeApi}=require('./trade-api.cjs');
const {diagnostic}=require('./platform-diagnostics.cjs');

const defaultPath=path.join(__dirname,'runtime-platform','gondolupa.sqlite');

function seed(platform) {
  const {db,transaction}=platform;
  return transaction(async()=>{
    const marker='historico-gondolupa-v1';
    if(await db.prepare('SELECT 1 FROM platform_meta WHERE key=?').get(marker))return;
    const {observations}=JSON.parse(fs.readFileSync(path.join(__dirname,'../outputs/datos-gondolupa.json'),'utf8'));
    await platform.ingest(observations.map(r=>({...r,currency:'UYU'})),{source:'archivo histórico Gondolupa',alerts:false});
    await db.prepare('INSERT INTO platform_meta VALUES(?,?)').run(marker,'aplicado');
  });
}

function databaseOptions(env=process.env,hosted=false){
  if(env.DATABASE_URL!==undefined){
    let ca=env.DATABASE_SSL_CA?.replace(/\\n/g,'\n');
    if(!ca&&env.DATABASE_SSL_CA_FILE){
      try{ca=fs.readFileSync(env.DATABASE_SSL_CA_FILE,'utf8');}
      catch{throw diagnostic('DB_SSL_CA_FILE','No se pudo leer DATABASE_SSL_CA_FILE. Revisá que el archivo secreto esté cargado en Render.');}
    }
    return {databaseUrl:env.DATABASE_URL,ca,schema:env.DATABASE_SCHEMA};
  }
  if(hosted||env.RENDER==='true')throw diagnostic('DB_URL_MISSING','Configurá DATABASE_URL con la conexión PostgreSQL de Supabase en Environment de Render.');
  return env.GONDOLUPA_DB||defaultPath;
}

async function setup({env=process.env,origin,hosted=false,database,
  schedule=true,clock=Date.now,sendEmail=emailTransport(env),push=configurePush(env),fetchFn=fetch,seedData=env.RADAR_SEED_HISTORY!=='0'}={}) {
  const feeds=configuredFeeds(env.PRICE_FEEDS_JSON);
  if(env.GONDOLUPA_CATALOG_PILOT==='1'){
    if(hosted&&!env.GONDOLUPA_CATALOG_PERMISSION?.trim())throw Error('Configurá la autorización del catálogo en GONDOLUPA_CATALOG_PERMISSION.');
    feeds.push(...pilotCatalogs());
    if(new Set(feeds.map(feed=>feed.id)).size!==feeds.length)throw Error('Hay identificadores de fuente repetidos.');
  }
  const recentHours=Number(env.PRICE_RECENT_HOURS||24),staleHours=Number(env.PRICE_STALE_HOURS||48);
  if(!Number.isFinite(recentHours)||!Number.isFinite(staleHours)||recentHours<1||staleHours<recentHours||staleHours>720)
    throw Error('Los umbrales de vigencia deben ser horas entre 1 y 720, en orden ascendente.');
  const platform=await openPlatform(database??databaseOptions(env,hosted));
  try{if(seedData)await seed(platform);}catch(error){await platform.close();throw error;}
  const dispatch=pushDispatcher(platform,push,clock);
  const collector=createCollector(platform,{feeds,clock,fetchFn,onCollected:dispatch});
  const adminEmail=String(env.GONDOLUPA_ADMIN_EMAIL||'').trim().toLowerCase();
  const api=platformApi(platform,{origin,hosted,sendEmail,push,dispatch,collector,clock,recentHours,staleHours,adminEmail});
  const trade=tradeApi(platform,{origin,hosted,clock,recentHours:staleHours,push,sendEmail});
  let task=null;
  function tick(){
    if(task)return task;
    task=platform.withLease('actualizacion',async()=>{
      const result=await collector.collect();await dispatch();await trade.dispatch();return result;
    }).then(result=>result||{configured:feeds.length>0,results:[],inProgress:true})
      .finally(()=>{task=null;});
    return task;
  }
  const tickInBackground=()=>void tick().catch(error=>console.error('Gondolupa: fallo de actualización',error.code||error.name));
  const timer=schedule?setInterval(tickInBackground,60000):null;
  timer?.unref();
  if(schedule)tickInBackground();
  return {api,trade,platform,collector,tick,close:async()=>{if(timer)clearInterval(timer);await task?.catch(()=>{});await platform.close();}};
}

module.exports={setup,seed,databaseOptions,defaultPath};

