function subscriptionOf(value) {
  try{
    const endpoint=new URL(value.endpoint);
    const host=endpoint.hostname;
    if(endpoint.protocol!=='https:'||endpoint.port||endpoint.username||endpoint.password||
       !(host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||
         host.endsWith('.push.apple.com')||host.endsWith('.notify.windows.com')))return null;
    const {p256dh,auth}=value.keys;
    if(!/^[\w-]+$/.test(p256dh)||!(/^[\w-]+$/.test(auth))||
       Buffer.from(p256dh,'base64url').length!==65||Buffer.from(auth,'base64url').length!==16)return null;
    return {endpoint:endpoint.href,keys:{p256dh,auth}};
  }catch{return null;}
}

function configurePush(env) {
  const {VAPID_PUBLIC_KEY,VAPID_PRIVATE_KEY,VAPID_SUBJECT}=env;
  if(!VAPID_PUBLIC_KEY||!VAPID_PRIVATE_KEY||!VAPID_SUBJECT)return null;
  let sender;
  try{sender=require('web-push');}catch{sender=require('./service/node_modules/web-push');}
  return {publicKey:VAPID_PUBLIC_KEY,send:(subscription,message)=>sender.sendNotification(subscription,JSON.stringify(message),
    {vapidDetails:{subject:VAPID_SUBJECT,publicKey:VAPID_PUBLIC_KEY,privateKey:VAPID_PRIVATE_KEY},TTL:86400,timeout:10000})};
}

function pushDispatcher({db},push,clock=Date.now) {
  let active=false;
  return async ()=>{
    if(!push||active)return;
    active=true;
    try{
      const candidates=db.prepare('SELECT DISTINCT user_id FROM inbox WHERE pushed IS NULL').all();
      for(const {user_id:id} of candidates){
        const rule=JSON.parse(db.prepare('SELECT preferences FROM follows WHERE user_id=?').get(id)?.preferences||'{}');
        if(rule.channel!=='push')continue;
        const last=db.prepare('SELECT max(pushed) time FROM inbox WHERE user_id=?').get(id).time;
        const now=clock();
        if(rule.frequency==='daily'&&last&&now-last<86400000)continue;
        const pending=db.prepare('SELECT c.id,c.event FROM inbox i JOIN changes c ON c.id=i.change_id WHERE i.user_id=? AND i.pushed IS NULL ORDER BY c.id').all(id);
        const devices=db.prepare('SELECT endpoint,subscription FROM subscriptions WHERE user_id=?').all(id);
        if(!pending.length||!devices.length)continue;
        const batches=rule.frequency==='daily'?[pending]:pending.map(item=>[item]);
        const done=db.prepare('UPDATE inbox SET pushed=? WHERE user_id=? AND change_id=?');
        for(const batch of batches){
          const change=JSON.parse(batch[0].event);
          const message={title:'Gondolupa · '+(batch.length>1?batch.length+' cambios de precio':change.kind),
            body:batch.length>1?'Consultá tus alertas para ver los productos y precios.':change.name+' · '+change.store+' · $'+change.previous+' → $'+change.price,
            url:'/?producto='+encodeURIComponent(change.product)+'#mis-alertas',tag:'gondolupa-'+batch[0].id};
          const sent=await Promise.all(devices.map(async device=>{
            try{await push.send(JSON.parse(device.subscription),message);return true;}
            catch(error){
              if(error.statusCode===404||error.statusCode===410)db.prepare('DELETE FROM subscriptions WHERE endpoint=? AND user_id=?').run(device.endpoint,id);
              return false;
            }
          }));
          if(sent.some(Boolean))for(const event of batch)done.run(now,id,event.id);
        }
      }
    }finally{active=false;}
  };
}

module.exports={subscriptionOf,configurePush,pushDispatcher};
