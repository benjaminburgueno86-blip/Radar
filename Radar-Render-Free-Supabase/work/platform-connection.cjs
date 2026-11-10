const {AsyncLocalStorage}=require('node:async_hooks');
const fs=require('node:fs');
const path=require('node:path');

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

async function postgres({databaseUrl,ca,allowInsecureLocal=false}) {
  const {Pool,types}=require('pg');
  let url;
  try{url=new URL(databaseUrl);}catch{throw Error('DATABASE_URL debe ser una URL PostgreSQL válida.');}
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname)throw Error('DATABASE_URL debe ser una URL PostgreSQL válida.');
  const local=allowInsecureLocal&&['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if(url.searchParams.has('sslmode')&&url.searchParams.get('sslmode')!=='verify-full'&&!local)
    throw Error('Usá DATABASE_URL sin sslmode o con sslmode=verify-full.');
  for(const key of [...url.searchParams.keys()])url.searchParams.delete(key);
  const pool=new Pool({connectionString:url.href,ssl:local?false:{rejectUnauthorized:true,...(ca?{ca}:{} )},
    max:4,connectionTimeoutMillis:10000,idleTimeoutMillis:15000,statement_timeout:45000,
    types:{getTypeParser:(oid,format)=>oid===20&&format!=='binary'?value=>{
      const number=Number(value);
      if(!Number.isSafeInteger(number))throw Error('Entero de PostgreSQL fuera del rango seguro.');
      return number;
    }:types.getTypeParser(oid,format)}});
  pool.on('error',error=>console.error('Radar: conexión PostgreSQL interrumpida',error.code||error.name));
  const scope=new AsyncLocalStorage(),configured=new WeakSet();
  async function withClient(action){
    const client=await pool.connect();
    try{
      if(!configured.has(client)){
        await client.query('SET search_path TO radar');
        configured.add(client);
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
    await transaction(async()=>{
      await db.exec('CREATE SCHEMA IF NOT EXISTS radar; REVOKE ALL ON SCHEMA radar FROM PUBLIC');
      await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)');
      if(!await db.prepare('SELECT 1 FROM schema_migrations WHERE version=1').get()){
        await db.exec(fs.readFileSync(path.join(__dirname,'platform-postgres.sql'),'utf8'));
        await db.prepare('INSERT INTO schema_migrations VALUES(1)').run();
      }
    });
  }catch(error){await pool.end();throw error;}
  return {db,transaction,close:()=>pool.end()};
}

async function connect(options) {
  return typeof options==='string'?sqlite(options):postgres(options);
}
module.exports={connect};
