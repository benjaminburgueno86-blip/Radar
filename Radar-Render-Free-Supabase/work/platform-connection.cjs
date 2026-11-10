const {AsyncLocalStorage}=require('node:async_hooks');
const fs=require('node:fs');
const path=require('node:path');
const {connectionSettings,safeDatabaseError}=require('./platform-diagnostics.cjs');
const {initializeSchema}=require('./platform-postgres-schema.cjs');

const advisoryKey=1462851975;

function postgresSql(sql) {
  let index=0;
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|\?(\d+)?/g,(match,number)=>{
    if(match[0]!=='?')return match;
    const position=number?Number(number):index+1;
    index=Math.max(index,position);
    return '$'+position;
  });
}

function adapter(execute) {
  return {
    prepare(sql){
      return {
        get:async(...values)=>(await execute(sql,values)).rows[0],
        all:async(...values)=>(await execute(sql,values)).rows,
        run:async(...values)=>({changes:(await execute(sql,values,true)).rowCount}),
      };
    },
    exec:sql=>execute(sql,[],false,true),
  };
}

function sqlite(file) {
  const {DatabaseSync}=require('node:sqlite');
  if(file!==':memory:')fs.mkdirSync(path.dirname(file),{recursive:true});
  const connection=new DatabaseSync(file);
  const scope=new AsyncLocalStorage();
  let tail=Promise.resolve();
  function serial(action) {
    const result=tail.then(action);
    tail=result.catch(()=>{});
    return result;
  }
  try{
    connection.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    const migrations=require('./platform-schema.cjs');
    connection.exec('BEGIN IMMEDIATE');
    const version=connection.prepare('PRAGMA user_version').get().user_version;
    for(let i=version;i<migrations.length;i++){
      connection.exec(migrations[i]);
      connection.exec('PRAGMA user_version='+(i+1));
    }
    connection.exec('COMMIT');
  }catch(error){connection.close();throw error;}
  const db=adapter((sql,values,write,exec)=>{
    const query=()=>{
      if(exec)return connection.exec(sql);
      const statement=connection.prepare(sql);
      const args=sql.includes('?1')?[{'?1':values[0]}]:values;
      return write?{rowCount:Number(statement.run(...args).changes)}:{rows:statement.all(...args)};
    };
    return scope.getStore()?.active?Promise.resolve().then(query):serial(query);
  });
  function transaction(action){
    if(scope.getStore()?.active)return action();
    return serial(async()=>{
      connection.exec('BEGIN IMMEDIATE');
      const context={active:true};
      try{
        const result=await scope.run(context,action);
        connection.exec('COMMIT');return result;
      }catch(error){connection.exec('ROLLBACK');throw error;}
      finally{context.active=false;}
    });
  }
  return {db,transaction,close:()=>serial(()=>connection.close())};
}

async function postgres({databaseUrl,ca,allowInsecureLocal=false,schema}) {
  const {Pool,types}=require('pg');
  const settings=connectionSettings(databaseUrl,{ca,allowInsecureLocal});
  const pool=new Pool({connectionString:settings.connectionString,ssl:settings.ssl,
    max:4,connectionTimeoutMillis:10000,idleTimeoutMillis:15000,statement_timeout:45000,
    types:{getTypeParser:(oid,format)=>oid===20&&format!=='binary'?value=>{
      const number=Number(value);
      if(!Number.isSafeInteger(number))throw Error('Entero de PostgreSQL fuera del rango seguro.');
      return number;
    }:types.getTypeParser(oid,format)}});
  pool.on('error',error=>{
    const safe=safeDatabaseError(error);
    console.error('Radar: '+safe.code+' '+safe.message);
  });
  const scope=new AsyncLocalStorage(),configured=new WeakMap();
  let selectedSchema='pg_catalog';
  async function withClient(action){
    let client;
    try{client=await pool.connect();}catch(error){throw safeDatabaseError(error);}
    try{
      if(configured.get(client)!==selectedSchema){
        await client.query("SELECT pg_catalog.set_config('search_path',$1,false)",['"'+selectedSchema+'"']);
        configured.set(client,selectedSchema);
      }
      return await action(client);
    }finally{client.release();}
  }
  const db=adapter((sql,values)=>{
    const run=client=>client.query(postgresSql(sql),values);
    const current=scope.getStore();
    return current?.active?run(current.client):withClient(run);
  });
  async function transaction(action){
    if(scope.getStore()?.active)return action();
    return withClient(async client=>{
      await client.query('BEGIN');
      const context={client,active:true};
      try{
        // Preserve SQLite's serial-write semantics for read/modify/write operations across instances.
        await client.query('SELECT pg_catalog.pg_advisory_xact_lock($1)',[advisoryKey]);
        const result=await scope.run(context,action);
        await client.query('COMMIT');return result;
      }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
      finally{context.active=false;}
    });
  }
  try{
    const initialized=await transaction(()=>initializeSchema(db,{schema,setSchema:async name=>{
      selectedSchema=name;
      await db.prepare("SELECT pg_catalog.set_config('search_path',?,false)").get('"'+name+'"');
      configured.set(scope.getStore().client,name);
    }}));
    console.info('Radar: PostgreSQL inicializado en '+initialized.schema+'. '+
      (initialized.adopted?'Tablas existentes verificadas.':'Tablas creadas.')+
      (settings.pooler?' Session Pooler de Supabase.':''));
  }catch(error){await pool.end().catch(()=>{});throw safeDatabaseError(error);}
  return {db,transaction,close:()=>pool.end()};
}

async function connect(options) {
  return typeof options==='string'?sqlite(options):postgres(options);
}
module.exports={connect};
