const {openPlatform}=require('./platform-db.cjs');
const {databaseOptions}=require('./platform-runtime.cjs');
const {tradeStore}=require('./trade-store.cjs');

const [company,email,name]=process.argv.slice(2);
if(!company||!email||!name){
  console.error('Uso: node work/trade-provision.cjs "Empresa" "correo@empresa.uy" "Nombre administrador"');
  process.exit(1);
}
const publicOrigin=process.env.PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL;
const origin=publicOrigin||'http://localhost:'+(process.env.RADAR_PORT||'8903');
const link=new URL('/trade',origin);
if(publicOrigin&&link.protocol!=='https:')throw Error('Configurá el origen HTTPS.');
async function main(){
  const platform=await openPlatform(databaseOptions(process.env,!!publicOrigin));
  try{
    const invite=await tradeStore(platform).provision(company,{email,name});
    link.hash='invite='+invite.token;
    console.log('Invitación privada de un uso, válida hasta '+invite.expires);
    console.log(link.href);
  }finally{await platform.close();}
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
