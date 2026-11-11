const tls=require('node:tls');
const {X509Certificate}=require('node:crypto');

function sslSettings(ca){
  // Preserve Node's secure certificate verification defaults.
  if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')
    throw Object.assign(
      new Error('Quitá NODE_TLS_REJECT_UNAUTHORIZED=0: Radar requiere verificación TLS.'),
      {code:'DB_SSL_UNSAFE_ENV',safeDatabase:true}
    );

  const settings={
    minVersion:'TLSv1.2',
    checkServerIdentity:tls.checkServerIdentity
  };

  if(ca!==undefined){
    const value=String(ca).replace(/\\n/g,'\n').trim();
    const pattern=/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
    const certificates=value.match(pattern)||[];

    const fail=message=>{
      throw Object.assign(
        new Error(message),
        {code:'DB_SSL_CA_FORMAT',safeDatabase:true}
      );
    };

    if(!certificates.length||value.replace(pattern,'').trim())
      fail('DATABASE_SSL_CA debe contener el certificado CA completo en formato PEM, no una ruta ni una URL.');

    for(const pem of certificates){
      let certificate;
      try{
        certificate=new X509Certificate(pem);
      }catch{
        fail('No se pudo interpretar el certificado PEM de DATABASE_SSL_CA. Volvé a descargarlo de Supabase.');
      }

      if(!certificate.ca)
        fail('DATABASE_SSL_CA debe contener certificados de autoridad CA, no el certificado final del servidor.');

      if(Date.parse(certificate.validTo)<Date.now())
        fail('El certificado CA configurado está vencido. Descargá el certificado vigente de Supabase.');

      if(Date.parse(certificate.validFrom)>Date.now())
        fail('El certificado CA todavía no es válido. Revisá el certificado y la hora del servidor.');
    }

    // Add the project CA without replacing the public trust store.
    settings.ca=[
      ...tls.getCACertificates('default'),
      ...certificates
    ];
  }

  return settings;
}

function verifyConnection(client){
  const socket=client.connection?.stream;

  if(!socket?.encrypted||socket.authorized!==true)
    throw Object.assign(
      new Error('La conexión PostgreSQL no confirmó un canal TLS autenticado.'),
      {code:'DB_SSL_NOT_AUTHORIZED',safeDatabase:true}
    );
}

module.exports={sslSettings,verifyConnection};
