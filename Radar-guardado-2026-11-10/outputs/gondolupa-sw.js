self.addEventListener('push',event=>{
  let message;
  try{message=event.data.json();}catch{return;}
  event.waitUntil(self.registration.showNotification(message.title||'Gondolupa',{
    body:message.body||'Hay una nueva alerta.',tag:message.tag,data:{url:message.url||'/#mis-alertas'},
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'/#mis-alertas',self.location.origin);
  if(target.origin!==self.location.origin)return;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const tab=windows.find(client=>new URL(client.url).origin===target.origin);
    if(tab){await tab.navigate(target.href);return tab.focus();}
    return self.clients.openWindow(target.href);
  })());
});
