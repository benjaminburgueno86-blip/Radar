const {DatabaseSync}=require('node:sqlite');
const {createHash}=require('node:crypto');
const {statSync}=require('node:fs');
const {openPlatform}=require('./platform-db.cjs');
const {databaseOptions}=require('./platform-runtime.cjs');

// Foreign-key order. Preserve alert and audit IDs; public price IDs have no foreign keys.
const tables=['users','sessions','account_links','limits','prices','source_runs','follows','changes','inbox','subscriptions',
  'saved_reports','projects','trade_companies','trade_identities','trade_members','trade_invites','trade_visits','trade_prices',
  'trade_audit','trade_own','trade_rules','trade_alerts','trade_push','trade_push_delivery','trade_signups'];
const sequences={source_runs:'id',changes:'id',trade_audit:'seq'};
function identifier(value){
  if(!/^[a-z_][a-z0-9_]*$/.test(value))throw Error('La copia SQLite contiene una columna desconocida.');
  return '"'+value+'"';
}

async function migrateSQLite(filename,target){
  if(!statSync(filename).isFile())throw Error('Indicá el archivo SQLite a migrar.');
  if(!target||typeof target.databaseUrl!=='string')throw Error('Configurá DATABASE_URL con el destino PostgreSQL.');
  const source=new DatabaseSync(filename,{readOnly:true});
  let destination;
  try{
    source.exec('PRAGMA busy_timeout=5000; BEGIN');
    const names=new Set(source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
    const legacy=!names.has('users')&&names.has('observations');
    if(!legacy&&(!names.has('users')||!names.has('prices')))throw Error('El archivo no es una base SQLite de Radar.');
    const present=legacy?['observations']:tables.filter(name=>names.has(name));
    const read=name=>source.prepare('SELECT * FROM '+identifier(name)+' ORDER BY rowid');
    const hash=createHash('sha256');
    for(const name of present){
      hash.update(name+'\n');
      for(const row of read(name).iterate())hash.update(JSON.stringify(Object.values(row).map(value=>value instanceof Uint8Array?{bytes:Buffer.from(value).toString('base64')}:value))+'\n');
    }
    const snapshot=hash.digest('hex'),marker=legacy?'sqlite-legado:'+snapshot:'sqlite-migracion-v1';
    destination=await openPlatform(target);
    const {db,transaction}=destination;
    return await transaction(async()=>{
      const prior=await db.prepare('SELECT value FROM platform_meta WHERE key=?').get(marker);
      if(prior?.value===snapshot)return {alreadyImported:true};
      if(prior)throw Error('El destino ya recibió otra copia de SQLite. Usá una base nueva para migrar un archivo distinto.');
      if(legacy){
        const observations=read('observations').all().map(row=>({...row,currency:row.currency||'UYU'}));
        const result=await destination.ingest(observations,{source:'archivo SQLite legado',alerts:false});
        if(result.rejected)throw Error('El archivo histórico contiene '+result.rejected+' observaciones incompatibles.');
        await db.prepare('INSERT INTO platform_meta VALUES(?,?)').run(marker,snapshot);
        return {prices:result.inserted,alreadyImported:false};
      }
      for(const name of tables){
        const filter=name==='prices'?" WHERE source NOT IN ('archivo histórico Gondolupa','archivo SQLite legado')":'';
        if(await db.prepare('SELECT 1 FROM '+identifier(name)+filter+' LIMIT 1').get())
          throw Error('El destino ya contiene datos de Radar en '+name+'. Migrá a una base nueva para conservar ambas copias.');
      }
      const counts={};
      for(const name of present){
        const rows=read(name).iterate();
        const columns=source.prepare('PRAGMA table_info('+identifier(name)+')').all().map(row=>row.name)
          .filter(column=>name!=='prices'||column!=='id');
        const sql='INSERT INTO '+identifier(name)+' ('+columns.map(identifier).join(',')+') VALUES ';
        const values='('+columns.map(()=>'?').join(',')+')';
        const conflict=name==='prices'?' ON CONFLICT(fingerprint) DO NOTHING':'';
        let batch=[],size=0,count=0;
        async function flush(){
          if(!batch.length)return;
          const insert=db.prepare(sql+Array(batch.length).fill(values).join(',')+conflict);
          count+=(await insert.run(...batch.flat())).changes;
          batch=[];size=0;
        }
        for(const row of rows){
          if(name==='prices'){
            const old=await db.prepare('SELECT price,available FROM prices WHERE fingerprint=?').get(row.fingerprint);
            if(old&&(old.price!==row.price||old.available!==row.available))throw Error('Un precio histórico en PostgreSQL difiere de la copia SQLite. Migrá a una base nueva.');
          }
          const rowValues=columns.map(column=>row[column] instanceof Uint8Array?Buffer.from(row[column]):row[column]);
          size+=rowValues.reduce((sum,value)=>sum+(typeof value==='string'?Buffer.byteLength(value):value?.byteLength||8),0);
          batch.push(rowValues);
          if(batch.length>=200||size>=4_000_000)await flush();
        }
        await flush();counts[name]=count;
        if(sequences[name]){
          const column=identifier(sequences[name]);
          const {maximum}=await db.prepare('SELECT COALESCE(max('+column+'),0) maximum FROM '+identifier(name)).get();
          if(!Number.isSafeInteger(maximum+1))throw Error('Identificador fuera de rango en '+name+'.');
          await db.exec('ALTER TABLE '+identifier(name)+' ALTER COLUMN '+column+' RESTART WITH '+(maximum+1));
        }
      }
      if(names.has('platform_meta')&&source.prepare('SELECT 1 FROM platform_meta WHERE key=?').get('historico-gondolupa-v1'))
        await db.prepare('INSERT INTO platform_meta VALUES(?,?) ON CONFLICT(key) DO NOTHING').run('historico-gondolupa-v1','aplicado');
      await db.prepare('INSERT INTO platform_meta VALUES(?,?)').run(marker,snapshot);
      return {counts,alreadyImported:false};
    });
  }finally{source.close();if(destination)await destination.close();}
}

module.exports={migrateSQLite};
if(require.main===module){
  const filename=process.argv[2];
  (async()=>{
    if(!filename)throw Error('Uso: npm run db:migrate-sqlite -- ruta-al-archivo.sqlite');
    console.log(JSON.stringify(await migrateSQLite(filename,databaseOptions(process.env,true)),null,2));
  })().catch(error=>{console.error(error.code?'Falló la migración. Código '+error.code+'.':error.message);process.exitCode=1;});
}
