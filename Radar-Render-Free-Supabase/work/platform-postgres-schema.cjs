const fs=require('node:fs');
const path=require('node:path');
const {diagnostic}=require('./platform-diagnostics.cjs');

const ddl=fs.readFileSync(path.join(__dirname,'platform-postgres.sql'),'utf8');
const identifier=name=>'"'+name.replaceAll('"','""')+'"';
const tables=[...ddl.matchAll(/CREATE TABLE (\w+)\s*\(/g)].map(match=>match[1]);
const appTables=tables.filter(table=>table!=='platform_meta');
const defaults=new Set(['users.local_only','users.trade_only']);

function clauses(text){
  let depth=0,start=0;
  const result=[];
  for(let i=0;i<text.length;i++){
    if(text[i]==='(')depth++;
    if(text[i]===')')depth--;
    if(text[i]===','&&!depth){result.push(text.slice(start,i).trim());start=i+1;}
  }
  result.push(text.slice(start).trim());
  return result;
}
const fields=list=>list.split(',').map(value=>value.trim().replaceAll('"',''));
function contracts(){
  const result=new Map();
  for(const statement of ddl.split(';').map(value=>value.trim())){
    const create=statement.match(/^CREATE TABLE (\w+)\s*\(([\s\S]+)\)$/);
    const alter=statement.match(/^ALTER TABLE (\w+) ADD COLUMN (.+)$/);
    if(!create&&!alter)continue;
    const table=create?.[1]||alter[1];
    const spec=result.get(table)||{columns:[],unique:[],foreign:[]};
    for(const clause of create?clauses(create[2]):[alter[2]]){
      const column=clause.match(/^"?(\w+)"?\s+(TEXT|INTEGER|BIGINT|DOUBLE PRECISION|BYTEA)\b/);
      if(column){
        const [,name,type]=column;
        spec.columns.push({name,type,required:/NOT NULL|PRIMARY KEY/.test(clause),identity:/GENERATED/.test(clause)});
        if(/PRIMARY KEY|\bUNIQUE\b/.test(clause))spec.unique.push([name]);
        const reference=clause.match(/REFERENCES (\w+)\(([^)]+)\)(?: ON DELETE (CASCADE))?/);
        if(reference)spec.foreign.push({columns:[name],table:reference[1],target:fields(reference[2]),cascade:!!reference[3]});
      }else{
        const unique=clause.match(/^(?:PRIMARY KEY|UNIQUE)\(([^)]+)\)/);
        if(unique)spec.unique.push(fields(unique[1]));
        const foreign=clause.match(/^FOREIGN KEY\(([^)]+)\) REFERENCES (\w+)\(([^)]+)\)/);
        if(foreign)spec.foreign.push({columns:fields(foreign[1]),table:foreign[2],target:fields(foreign[3]),cascade:false});
      }
    }
    result.set(table,spec);
  }
  return result;
}

async function inspect(db,schema){
  return db.prepare('SELECT table_name,column_name,data_type,is_nullable,column_default,is_identity FROM information_schema.columns WHERE table_schema=?').all(schema);
}
function checkColumns(schema,existing,specs){
  const byTable=new Map();
  for(const row of existing){
    if(!byTable.has(row.table_name))byTable.set(row.table_name,new Map());
    byTable.get(row.table_name).set(row.column_name,row);
  }
  const types={TEXT:['text','character varying'],INTEGER:['smallint','integer','bigint'],BIGINT:['bigint'],
    'DOUBLE PRECISION':['real','double precision'],BYTEA:['bytea']};
  for(const [table,spec] of specs){
    const actual=byTable.get(table);
    if(!actual)continue;
    for(const column of spec.columns){
      const found=actual.get(column.name);
      if(!found&&defaults.has(table+'.'+column.name))continue;
      if(!found)throw diagnostic('DB_SCHEMA_COLUMN','Falta la columna '+schema+'.'+table+'.'+column.name+'. Revisá la estructura existente antes de iniciar Radar.');
      if(!types[column.type].includes(found.data_type))
        throw diagnostic('DB_SCHEMA_TYPE','La columna '+schema+'.'+table+'.'+column.name+' requiere '+column.type+'. La estructura existente debe coincidir con platform-postgres.sql.');
      if(column.required&&found.is_nullable==='YES')
        throw diagnostic('DB_SCHEMA_NULLABLE','La columna '+schema+'.'+table+'.'+column.name+' necesita la restricción NOT NULL. Revisá sus datos y su definición.');
      if(column.identity&&found.is_identity!=='YES'&&!/^nextval\(/.test(found.column_default||''))
        throw diagnostic('DB_SCHEMA_IDENTITY','La columna '+schema+'.'+table+'.'+column.name+' necesita una secuencia o identidad automática.');
    }
  }
}

async function checkKeys(db,schema,specs){
  const indexes=await db.prepare(`
    SELECT t.relname table_name,i.indisunique,i.indisvalid,pg_catalog.pg_get_expr(i.indpred,i.indrelid) predicate,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(num,ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num ORDER BY k.ord) columns
    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class t ON t.oid=i.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=?`).all(schema);
  const constraints=await db.prepare(`
    SELECT t.relname table_name,c.contype,c.confdeltype,n2.nspname target_schema,t2.relname target_table,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num,ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.ord) columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(num,ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num ORDER BY k.ord) target_columns
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid=c.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    LEFT JOIN pg_catalog.pg_class t2 ON t2.oid=c.confrelid LEFT JOIN pg_catalog.pg_namespace n2 ON n2.oid=t2.relnamespace
    WHERE n.nspname=? AND c.contype IN ('p','u','f')`).all(schema);
  const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
  for(const [table,spec] of specs){
    const keys=constraints.filter(key=>key.table_name===table);
    for(const columns of spec.unique)if(!indexes.some(index=>index.table_name===table&&index.indisvalid&&index.indisunique&&!index.predicate&&same(index.columns,columns)))
      throw diagnostic('DB_SCHEMA_KEY','Falta una clave primaria o única en '+schema+'.'+table+' ('+columns.join(', ')+'). Revisá platform-postgres.sql.');
    for(const reference of spec.foreign)if(!keys.some(key=>key.contype==='f'&&same(key.columns,reference.columns)&&
      key.target_schema===schema&&key.target_table===reference.table&&same(key.target_columns,reference.target)&&
      (reference.cascade?key.confdeltype==='c':['a','r'].includes(key.confdeltype))))
      throw diagnostic('DB_SCHEMA_FOREIGN_KEY','Revisá la relación de '+schema+'.'+table+' con '+schema+'.'+reference.table+'. Las tablas deben compartir esquema y conservar sus claves foráneas.');
  }
  const predicate=value=>(value||'').replace(/::text\b/g,'').replace(/[\s()"]/g,'');
  for(const match of ddl.matchAll(/CREATE UNIQUE INDEX (\w+) ON (\w+)\(([^)]+)\)(?: WHERE ([^;]+))?;/g)){
    const [,name,table,columns,where]=match;
    if(!indexes.some(index=>index.table_name===table&&index.indisvalid&&index.indisunique&&same(index.columns,fields(columns))&&predicate(index.predicate)===predicate(where)))
      throw diagnostic('DB_SCHEMA_INDEX','Revisá el índice único '+schema+'.'+name+'. Su definición debe coincidir con platform-postgres.sql.');
  }
}

async function initializeSchema(db,{schema,setSchema}){
  if(schema&&!['public','radar'].includes(schema))
    throw diagnostic('DB_SCHEMA_SETTING','DATABASE_SCHEMA admite public o radar.');
  const existing=await db.prepare("SELECT table_schema,table_name FROM information_schema.tables WHERE table_schema IN ('public','radar') AND table_type='BASE TABLE'").all();
  const candidates=['public','radar'].filter(name=>existing.some(row=>row.table_schema===name&&appTables.includes(row.table_name)));
  if(!schema&&candidates.length>1)
    throw diagnostic('DB_SCHEMA_AMBIGUOUS','Hay tablas de Radar en public y radar. Configurá DATABASE_SCHEMA con el esquema que contiene tus datos.');
  schema||=candidates[0]||'radar';
  const oldTables=existing.filter(row=>row.table_schema===schema&&appTables.includes(row.table_name));
  const specs=contracts();
  checkColumns(schema,await inspect(db,schema),specs);
  if(schema==='radar')await db.exec('CREATE SCHEMA IF NOT EXISTS radar; REVOKE ALL ON SCHEMA radar FROM PUBLIC');
  await setSchema(schema);
  const compatibleDDL=ddl.replace(/CREATE TABLE /g,'CREATE TABLE IF NOT EXISTS ')
    .replace(/CREATE (UNIQUE )?INDEX /g,(_,unique)=>'CREATE '+(unique||'')+'INDEX IF NOT EXISTS ')
    .replace(/ADD COLUMN /g,'ADD COLUMN IF NOT EXISTS ');
  await db.exec(compatibleDDL);
  checkColumns(schema,await inspect(db,schema),specs);
  await checkKeys(db,schema,specs);
  // Protect enterprise data even if the operator created the tables in public.
  const roles=await db.prepare("SELECT rolname FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated')").all();
  const grantees=['PUBLIC',...roles.map(role=>identifier(role.rolname))].join(',');
  for(const table of tables){
    await db.exec('ALTER TABLE '+identifier(schema)+'.'+identifier(table)+' ENABLE ROW LEVEL SECURITY');
    await db.exec('REVOKE ALL ON TABLE '+identifier(schema)+'.'+identifier(table)+' FROM '+grantees);
  }
  for(const [table,spec] of specs)for(const column of spec.columns.filter(column=>column.identity)){
    const sequence=await db.prepare(`SELECT n.nspname schema_name,c.relname sequence_name
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE c.oid=pg_catalog.pg_get_serial_sequence(?,?)::regclass`).get(identifier(schema)+'.'+identifier(table),column.name);
    if(sequence)await db.exec('REVOKE ALL ON SEQUENCE '+identifier(sequence.schema_name)+'.'+identifier(sequence.sequence_name)+' FROM '+grantees);
  }
  await db.exec('CREATE TABLE IF NOT EXISTS radar_schema_migrations (version INTEGER PRIMARY KEY)');
  await db.exec('ALTER TABLE radar_schema_migrations ENABLE ROW LEVEL SECURITY; REVOKE ALL ON TABLE radar_schema_migrations FROM '+grantees);
  await db.prepare('INSERT INTO radar_schema_migrations VALUES(1) ON CONFLICT(version) DO NOTHING').run();
  return {schema,adopted:oldTables.length>0};
}

module.exports={initializeSchema};
