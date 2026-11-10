const {openPlatform}=require('./platform-db.cjs');
const {defaultPath}=require('./platform-runtime.cjs');
const {tradeStore}=require('./trade-store.cjs');

const [company,email,name]=process.argv.slice(2);
if(!company||!email||!name){
  console.error('Uso: node work/trade-provision.cjs "Empresa" "correo@empresa.uy" "Nombre administrador"');
  process.exit(1);
}
const publicOrigin=process.env.PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL;
const origin=publicOrigin||'http://localhost:'+(process.env.RADAR_PORT||'8903');
const link=new URL('/trade',origin);
if(publicOrigin&&(!process.env.GONDOLUPA_DB||link.protocol!=='https:'))throw Error('Configurá el disco persistente y el origen HTTPS.');
const platform=openPlatform(process.env.GONDOLUPA_DB||defaultPath);
try{
  const invite=tradeStore(platform).provision(company,{email,name});
  link.hash='invite='+invite.token;
  console.log('Invitación privada de un uso, válida hasta '+invite.expires);
  console.log(link.href);
}finally{platform.close();}
