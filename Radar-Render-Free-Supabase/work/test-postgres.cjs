const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {PGLiteSocketServer}=require('@electric-sql/pglite-socket');
const {openPlatform}=require('./platform-db.cjs');
const {seed,setup}=require('./platform-runtime.cjs');
const {migrateSQLite}=require('./migrate-sqlite-to-postgres.cjs');
const {start}=require('./benchmark-server.cjs');
const {once}=require('node:events');
const http=require('node:http');

async function isolated(test){
  const pg=await PGlite.create();
  const server=new PGLiteSocketServer({db:pg,port:0,host:'127.0.0.1',maxConnections:4});
  try{
    await server.start();
    const databaseUrl='postgresql://postgres@'+server.getServerConn()+'/postgres';
    await test({databaseUrl,allowInsecureLocal:true});
  }finally{await server.stop();await pg.close();}
}

async function migration(target){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'radar-sqlite-migration-'));
  const filename=path.join(folder,'copy.sqlite');
  const source=await openPlatform(filename);
  const checked='2026-10-20T15:00:00.000Z';
  const photo=Buffer.from([255,216,255,0,1,2]);
  try{
    const {db}=source;
    await seed(source);
    await db.prepare('INSERT INTO users(id,email,password,verified) VALUES(?,?,?,1)').run('persona','test@fixture.invalid','hash-de-prueba');
    await db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('hash-token','persona',2_000_000_000_000);
    await db.prepare('INSERT INTO projects VALUES(?,?)').run('persona','{"privado":true}');
    await db.prepare('INSERT INTO changes VALUES(?,?,?,?)').run(42,'evento','{}',1_800_000_000_000);
    await db.prepare('INSERT INTO inbox VALUES(?,?,?,?)').run('persona',42,null,null);
    await db.prepare('INSERT INTO trade_companies VALUES(?,?,?)').run('empresa','Prueba',checked);
    await db.prepare('INSERT INTO trade_members VALUES(?,?,?,?,1)').run('empresa','persona','Prueba','admin');
    await db.prepare('INSERT INTO trade_visits VALUES(?,?,?,?,?,?,?,?,?,?)').run('empresa','visita','persona','Disco','Centro','Dirección','Centro',checked,-34.9,-56.2);
    await db.prepare('INSERT INTO trade_prices VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('precio','empresa','visita','persona','producto','lugar',checked,'{}',photo,'image/jpeg','validado',1);
    await db.prepare('INSERT INTO trade_audit VALUES(?,?,?,?,?,?,?,?)').run(30,'empresa','precio','persona',checked,'validado','','{}');
  }finally{await source.close();}
  try{
    const alreadySeeded=await openPlatform(target);
    try{await seed(alreadySeeded);}finally{await alreadySeeded.close();}
    const first=await migrateSQLite(filename,target);
    assert.equal(first.counts.users,1);
    assert.equal(first.counts.prices,0);
    assert.equal(first.counts.trade_prices,1);
    assert.deepEqual(await migrateSQLite(filename,target),{alreadyImported:true});
    const reopened=await openPlatform(target);
    try{
      const {db}=reopened;
      const before=(await reopened.observations()).length;
      await seed(reopened);
      assert.equal((await reopened.observations()).length,before);
      assert.equal((await db.prepare('SELECT expires FROM sessions WHERE token=?').get('hash-token')).expires,2_000_000_000_000);
      assert.equal((await db.prepare('SELECT payload FROM projects WHERE user_id=?').get('persona')).payload,'{"privado":true}');
      assert.equal((await db.prepare('SELECT change_id FROM inbox WHERE user_id=?').get('persona')).change_id,42);
      assert.deepEqual((await db.prepare('SELECT photo FROM trade_prices WHERE id=?').get('precio')).photo,photo);
      assert.equal((await db.prepare('INSERT INTO changes(signature,event,detected) VALUES(?,?,?) RETURNING id').get('siguiente','{}',1)).id,43);
      assert.equal((await db.prepare('INSERT INTO trade_audit(company,price,actor,at,action,note,snapshot) VALUES(?,?,?,?,?,?,?) RETURNING seq')
        .get('empresa','precio','persona',checked,'prueba','','{}')).seq,31);
      await assert.rejects(reopened.transaction(async()=>{
        await db.prepare('INSERT INTO projects VALUES(?,?)').run('cuenta-inexistente','{}');
      }),error=>error.code==='23503');
      assert.equal((await db.prepare('SELECT count(*) n FROM projects').get()).n,1);
    }finally{await reopened.close();}
  }finally{
    for(const file of [filename,filename+'-wal',filename+'-shm'])if(fs.existsSync(file))fs.unlinkSync(file);
    fs.rmdirSync(folder);
  }
}

async function hostedHttp(database){
  const host='radar.fixture.invalid', token='t'.repeat(40);
  const app=start(0,{publicOrigin:'https://'+host,platform:{database,schedule:false,seedData:false,env:{RADAR_REFRESH_TOKEN:token}}});
  try{
    await once(app,'listening');
    const request=(route,method='GET',headers={})=>new Promise((resolve,reject)=>{
      const req=http.request({host:'127.0.0.1',port:app.address().port,path:route,method,headers:{Host:host,...headers}},res=>{
        res.resume();res.on('end',()=>resolve(res.statusCode));
      });
      req.on('error',reject);req.end();
    });
    for(const route of ['/','/trade','/healthz','/api/benchmark/market-data'])assert.equal(await request(route),200);
    assert.equal(await request('/trade-api/analysis'),401);
    assert.equal(await request('/api/internal/refresh','POST'),401);
    assert.equal(await request('/api/internal/refresh','POST',{Authorization:'Bearer '+token}),200);
  }finally{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}
}

(async()=>{
  await assert.rejects(setup({env:{},hosted:true,seedData:false}),/DATABASE_URL/);
  await isolated(require('./test-platform.cjs'));
  await isolated(require('./test-trade.cjs'));
  await isolated(migration);
  await isolated(hostedHttp);
  console.log('OK: integración con motor PostgreSQL vía TCP, migración SQLite idempotente, archivos binarios, secuencias y rollback.');
})().catch(error=>{console.error(error);process.exitCode=1;});
