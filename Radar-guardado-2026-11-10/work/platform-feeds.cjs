const zone='America/Montevideo';
const localDay=new Intl.DateTimeFormat('sv-SE',{timeZone:zone});
const localHour=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',hourCycle:'h23'});
const {readCatalog}=require('./platform-catalog.cjs');

function configuredFeeds(value) {
  if(!value)return [];
  const configs=JSON.parse(value);
  if(!Array.isArray(configs)||configs.length>20)throw Error('PRICE_FEEDS_JSON admite hasta 20 fuentes.');
  const seen=new Set();
  return configs.map(config=>{
    const url=new URL(config.url);
    if(config.authorized!==true||typeof config.terms!=='string'||!config.terms.trim()||
       !/^[a-z0-9_-]{1,50}$/.test(config.id)||seen.has(config.id)||
       !/^[a-z0-9_-]{1,50}$/.test(config.store)||url.protocol!=='https:'||url.username||url.password)
      throw Error('Fuente inválida: se requiere HTTPS, identificador, comercio y autorización documentada.');
    seen.add(config.id);
    return {id:config.id,store:config.store,url:url.href};
  });
}

function createCollector(platform,{feeds=[],fetchFn=fetch,clock=Date.now,onCollected=()=>{}}={}) {
  let running=null,lastManual=0;
  const findLast=platform.db.prepare('SELECT started FROM source_runs WHERE source=? ORDER BY id DESC LIMIT 1');
  const record=platform.db.prepare('INSERT INTO source_runs(source,started,status,count,error) VALUES(?,?,?,?,?)');
  async function runSource(feed) {
    const now=clock(), started=new Date(now).toISOString();
    try{
      if(feed.products){
        const {observations,issues}=await readCatalog(feed,{fetchFn,clock});
        const result=platform.ingest(observations,{source:feed.id,now:clock()});
        if(result.rejected)issues.push(result.rejected+' registros rechazados');
        const status=issues.length?(observations.length>result.rejected?'parcial':'error'):result.inserted?'actualizada':'sin datos nuevos';
        const error=issues.join(' · ');
        record.run(feed.id,started,status,result.inserted,error);
        return {source:feed.id,status,...result,...(error?{error}:{})};
      }
      const response=await fetchFn(feed.url,{redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(18000)});
      if(!response.ok)throw Error('La fuente respondió HTTP '+response.status);
      const decoder=new TextDecoder();
      let text='',size=0;
      for await(const part of response.body){
        size+=part.length;
        if(size>5*1024*1024)throw Error('La fuente excedió el límite de 5 MB.');
        text+=decoder.decode(part,{stream:true});
      }
      const payload=JSON.parse(text+decoder.decode());
      if(!Array.isArray(payload.observations)||payload.observations.length>10000)throw Error('Formato inválido o más de 10.000 observaciones.');
      const result=platform.ingest(payload.observations.map(r=>({...r,store:feed.store})),{source:feed.id,now});
      const status=result.rejected ? 'parcial' : result.inserted ? 'actualizada' : 'sin datos nuevos';
      record.run(feed.id,started,status,result.inserted,result.rejected?result.rejected+' registros rechazados':'');
      return {source:feed.id,status,...result};
    }catch(error){
      const reason=/^(La fuente|Formato inválido)/.test(error.message)?error.message:'No se pudo leer o validar la fuente.';
      record.run(feed.id,started,'error',0,reason);
      return {source:feed.id,status:'error',error:reason};
    }
  }
  function collect({manual=false}={}) {
    if(running)return running;
    const now=clock(),day=localDay.format(now);
    if(manual&&lastManual&&now-lastManual<15*60000)return Promise.resolve({cooldown:true,results:[]});
    const due=manual?feeds:localHour.format(now)>='08'?feeds.filter(feed=>{
      const last=findLast.get(feed.id)?.started;
      return !last||localDay.format(Date.parse(last))!==day;
    }):[];
    if(!due.length)return Promise.resolve({configured:feeds.length>0,results:[]});
    if(manual)lastManual=now;
    running=(async()=>{
      const results=[];
      for(const feed of due)results.push(await runSource(feed));
      await onCollected();
      return {configured:true,results};
    })().finally(()=>{running=null});
    return running;
  }
  return {collect,feeds:feeds.map(({id,store})=>({id,store}))};
}

module.exports={configuredFeeds,createCollector};
