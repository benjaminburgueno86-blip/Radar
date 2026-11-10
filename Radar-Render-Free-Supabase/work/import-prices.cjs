const fs=require('node:fs');
const {openPlatform}=require('./platform-db.cjs');
const {databaseOptions}=require('./platform-runtime.cjs');

const file=process.argv[2];
if(!file)throw Error('Uso: node work/import-prices.cjs archivo.json');
if(fs.statSync(file).size>20*1024*1024)throw Error('El archivo supera el límite de 20 MB.');
const data=JSON.parse(fs.readFileSync(file,'utf8'));
if(data.authorized!==true||typeof data.source!=='string'||!data.source.trim()||!Array.isArray(data.observations))
  throw Error('El archivo requiere source, authorized: true y observations.');
async function main(){
  const platform=await openPlatform(databaseOptions());
  try{
    const result=await platform.ingest(data.observations,{source:data.source.trim().slice(0,150)});
    console.log(JSON.stringify(result));
    if(result.rejected)process.exitCode=2;
  }finally{await platform.close();}
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
