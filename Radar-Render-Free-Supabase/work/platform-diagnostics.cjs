const {sslSettings}=require('./platform-tls.cjs');

function diagnostic(code,message){
  return Object.assign(new Error(message),{code,safeDatabase:true});
}

function connectionSettings(databaseUrl,{allowInsecureLocal=false,ca}={}){
  if(typeof databaseUrl!=='string'||!databaseUrl.trim())
    throw diagnostic('DB_URL_MISSING','Configurá DATABASE_URL en Environment de Render.');
  const value=databaseUrl.trim();
  if(/^(?:DATABASE_URL\s*=|export\s|psql\s)/i.test(value))
    throw diagnostic('DB_URL_ASSIGNMENT','En el valor de DATABASE_URL pegá solamente la URL, sin DATABASE_URL= ni comandos.');
  if(/^["'`]|["'`]$/.test(value))
    throw diagnostic('DB_URL_QUOTES','Quitá las comillas que envuelven el valor de DATABASE_URL en Render.');
  if(/[\s\u0000-\u001f]/.test(value))
    throw diagnostic('DB_URL_WHITESPACE','DATABASE_URL contiene espacios o saltos de línea. Codificá los caracteres especiales de la contraseña con encodeURIComponent.');
  if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(value))
    throw diagnostic('DB_URL_FORMAT','DATABASE_URL debe empezar con postgresql:// o postgres:// y tener usuario, host y base.');
  if(!/^postgres(?:ql)?:\/\//i.test(value))
    throw diagnostic('DB_URL_PROTOCOL','El protocolo de DATABASE_URL debe ser postgresql:// o postgres://.');
  let url;
  try{url=new URL(value);}catch{
    throw diagnostic('DB_URL_FORMAT','No se pudo interpretar DATABASE_URL. Revisá el host, el puerto y la codificación de la contraseña.');
  }
  if(url.hash)throw diagnostic('DB_URL_FRAGMENT','DATABASE_URL contiene un fragmento #. Si # pertenece a la contraseña, debe escribirse como %23.');
  let user,password;
  try{user=decodeURIComponent(url.username);password=decodeURIComponent(url.password);}
  catch{throw diagnostic('DB_URL_ENCODING','La contraseña o el usuario contienen una secuencia % inválida. Usá codificación URL.');}
  if(/(?:\[YOUR[-_ ]?PASSWORD\]|\[YOUR[-_ ]?PROJECT[^\]]*\]|\[PASSWORD\]|\[PROJECT[-_ ]?REF\]|<(?:YOUR[-_ ]?)?(?:PASSWORD|PROJECT[-_ ]?(?:REF|ID)|HOST|REGION)>)/i.test(user+' '+password+' '+url.hostname))
    throw diagnostic('DB_URL_PLACEHOLDER','Reemplazá los marcadores de ejemplo de la URL por los valores de tu proyecto de Supabase.');
  if(!url.hostname||!url.username||url.pathname.length<2)
    throw diagnostic('DB_URL_COMPONENTS','DATABASE_URL requiere usuario, host y nombre de base de datos. Copiá la URI de Connect → Session pooler.');
  const local=allowInsecureLocal&&['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if(!password&&!local)throw diagnostic('DB_URL_PASSWORD','Falta la contraseña de la base en DATABASE_URL.');
  const pooler=url.hostname.endsWith('.pooler.supabase.com');
  if(pooler&&url.port&&url.port!=='5432')
    throw diagnostic('DB_POOLER_PORT','Usá Session pooler de Supabase en el puerto 5432. El puerto 6543 corresponde al modo Transaction.');
  if(pooler&&!user.includes('.'))
    throw diagnostic('DB_POOLER_USER','El usuario del pooler debe incluir la referencia del proyecto. Copialo desde Connect → Session pooler.');
  const mode=url.searchParams.get('sslmode');
  if(mode&&!['require','verify-ca','verify-full'].includes(mode)&&!local)
    throw diagnostic('DB_SSL_MODE','El modo SSL solicitado no es seguro. Usá sslmode=verify-full.');
  for(const parameter of [...url.searchParams.keys()]){
    if(!['sslmode','sslrootcert','sslcert','sslkey','ssl','uselibpqcompat','pgbouncer'].includes(parameter))
      throw diagnostic('DB_URL_PARAMETER','DATABASE_URL contiene parámetros no admitidos. Copiá la URI del Session pooler y configurá el certificado por separado.');
    if(['sslrootcert','sslcert','sslkey'].includes(parameter))
      throw diagnostic('DB_SSL_CERT_CONFIG','Configurá el certificado con DATABASE_SSL_CA o DATABASE_SSL_CA_FILE, fuera de DATABASE_URL.');
    if(parameter==='ssl'&&!['true','1'].includes(url.searchParams.get(parameter))&&!local)
      throw diagnostic('DB_SSL_MODE','La configuración solicita desactivar SSL. Usá sslmode=verify-full.');
  }
  // node-postgres replaces an explicit SSL object if SSL parameters remain in the URI.
  // Apply all accepted modes with certificate and hostname verification enabled.
  url.search='';
  return {connectionString:url.href,ssl:local?false:sslSettings(ca),pooler};
}

function safeDatabaseError(error){
  // Reinspect legacy DB_SSL wrappers: their cause may still contain Node's code.
  // Other already-sanitized diagnostics remain unchanged on repeated handling.
  if(error?.safeDatabase&&error.code!=='DB_SSL')return error;
  const errors=[],pending=[error],seen=new Set();
  while(pending.length&&errors.length<32){
    const item=pending.shift();
    if(!item||seen.has(item))continue;
    seen.add(item);errors.push(item);
    pending.push(item.cause,...(Array.isArray(item.errors)?item.errors:[]));
  }
  const codes=new Set(errors.flatMap(item=>[item.code,item.originalCode]));
  const messages=errors.map(item=>String(item.message||'')).join(' ');
  const any=(...values)=>values.some(value=>codes.has(value));
  if(any('28P01','28000')||/password authentication failed|tenant or user not found|SASL.*password/i.test(messages))
    return diagnostic('DB_AUTH','PostgreSQL rechazó las credenciales. Revisá la contraseña de la base y el usuario completo del Session pooler.'+(any('28P01','28000')?' SQLSTATE '+(codes.has('28P01')?'28P01':'28000')+'.':''));
  if(/server does not support SSL|SSL is not supported/i.test(messages))
    return diagnostic('DB_SSL_UNSUPPORTED','El servidor no admite SSL. Revisá que DATABASE_URL apunte al PostgreSQL Session pooler de Supabase, puerto 5432.');
  const certificateErrors=[
    ['DB_SSL_HOSTNAME',['ERR_TLS_CERT_ALTNAME_INVALID'],'El certificado no corresponde al nombre del servidor. Copiá el host exacto de Connect → Session pooler; no uses una IP ni otro alias.'],
    ['DB_SSL_EXPIRED',['CERT_HAS_EXPIRED'],'El certificado del servidor o su cadena está vencido. Revisá la hora del servidor y el certificado de Supabase.'],
    ['DB_SSL_NOT_YET_VALID',['CERT_NOT_YET_VALID'],'El certificado todavía no es válido. Revisá la hora del servidor y el certificado de Supabase.'],
    ['DB_SSL_CA_UNTRUSTED',['DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','UNABLE_TO_GET_ISSUER_CERT','CERT_UNTRUSTED'],'No se pudo verificar la cadena de confianza. Descargá la CA desde Database Settings → SSL Configuration de Supabase y configurá DATABASE_SSL_CA o DATABASE_SSL_CA_FILE.'],
    ['DB_SSL_CERT_INVALID',['CERT_REVOKED','INVALID_CA','INVALID_PURPOSE','PATH_LENGTH_EXCEEDED','CERT_SIGNATURE_FAILURE'],'El certificado o su cadena no son válidos para esta conexión. Revisá la CA y el estado del certificado con Supabase.'],
  ];
  for(const [code,originals,message] of certificateErrors){
    const original=originals.find(value=>codes.has(value));
    // The server logs code + message, so put the original TLS code in the
    // sanitized message too. Never attach the raw error (it can contain secrets).
    if(original)return Object.assign(diagnostic(code,'DB_SSL ['+original+'] '+message),{originalCode:original});
  }
  if(
    codes.has('DB_SSL')||[...codes].some(code=>/^ERR_(?:TLS|SSL|OSSL_PEM|OSSL_X509)/.test(code))||/certificate|TLS|SSL/i.test(messages))
    {
      const original=[...codes].find(code=>/^ERR_(?:TLS|SSL|OSSL_PEM|OSSL_X509)_[A-Z0-9_]{1,80}$/.test(code));
      return Object.assign(diagnostic('DB_SSL_HANDSHAKE','DB_SSL ['+(original||'ORIGINAL_CODE_UNAVAILABLE')+'] Falló la negociación TLS con PostgreSQL. Revisá el certificado, el host y la compatibilidad TLS del servidor.'+(!original?' Código original de Node.js no disponible en el error recibido.':'')),original?{originalCode:original}:{});
    }
  if(any('ENOTFOUND','EAI_AGAIN'))return diagnostic('DB_DNS','No se pudo resolver el host PostgreSQL. Revisá la dirección del Session pooler.');
  if(any('ETIMEDOUT','ENETUNREACH','EHOSTUNREACH')||/connection timeout|timeout exceeded|Connection terminated due to connection timeout/i.test(messages))
    return diagnostic('DB_TIMEOUT','No se pudo alcanzar PostgreSQL a tiempo. Revisá el estado del proyecto, las restricciones de red y el Session pooler IPv4.');
  if(any('ECONNREFUSED','ECONNRESET','EPIPE')||/Connection terminated unexpectedly/i.test(messages))
    return diagnostic('DB_CONNECTION','La conexión PostgreSQL fue rechazada o interrumpida. Revisá el host, el puerto 5432 y el estado del proyecto.');
  if(any('53300','53400'))return diagnostic('DB_CONNECTION_LIMIT','Supabase alcanzó su límite de conexiones. Revisá las conexiones activas del proyecto.');
  if(any('3D000'))return diagnostic('DB_DATABASE','La base de datos indicada en DATABASE_URL no existe. Revisá el nombre de la base.');
  if(any('42501'))return diagnostic('DB_PERMISSION','El usuario PostgreSQL no tiene permisos para inicializar o consultar las tablas de Radar en el esquema elegido.');
  const state=[...codes].find(code=>/^[0-9A-Z]{5}$/.test(code));
  return diagnostic('DB_INITIALIZATION','PostgreSQL no pudo completar la inicialización. Revisá la estructura de las tablas y sus permisos.'+(state?' SQLSTATE '+state+'.':''));
}

module.exports={diagnostic,connectionSettings,safeDatabaseError};
