let platformAccount=null;
let platformPushKey=null;
let platformLoaded=false;
let accountResetToken='';

async function platformRequest(route,{method='GET',body,timeout=15000}={}){
  const response=await fetch('/api/gondolupa'+route,{
    method,headers:body===undefined?undefined:{'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout),
  });
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'La operación no pudo completarse.');
  return result;
}

function setAccount(account){
  const changed=platformAccount?.id!==account?.id;
  platformAccount=account;
  if(changed)switchStudyAccount(account);
  $('#platformSignIn').hidden=!!account;
  $('#platformDashboard').hidden=!account;
  if(!account){
    for(const id of ['platformAlerts','platformReports','platformOpportunities','platformSavedContent','platformAccountLabel'])
      $('#'+id).textContent='';
  }
}

async function loadPlatform(force=false){
  if(accountResetToken)return;
  if(location.protocol==='file:'){
    $('#platformMessage').textContent='Para usar cuentas y alertas, abrí Radar con el lanzador o desde la plataforma publicada.';
    $('#platformSignIn').hidden=true;
    return;
  }
  if(platformLoaded&&!force)return;
  platformLoaded=true;
  try{
    const data=await platformRequest('/session');
    platformPushKey=data.pushKey;
    setAccount(data.account);
    for(const button of $('#platformAuth').querySelectorAll('[value="recover"],[value="resend"]'))button.hidden=!data.emailConfigured;
    if(data.account)await loadDashboard();
  }catch(error){
    platformLoaded=false;
    $('#platformMessage').textContent=error.message;
  }
}

function platformNotice(message){$('#platformMessage').textContent=message;}

function renderDashboard(data){
  setAccount(data);
  const rule=data.preferences;
  const form=$('#platformPreferences').elements;
  form.products.value=rule.products.join(', ');
  form.categories.value=rule.categories.join(', ');
  form.stores.value=rule.stores.join(', ');
  form.threshold.value=rule.threshold;
  form.frequency.value=rule.frequency;
  form.channel.value=rule.channel;
  $('#platformProfile').elements.displayName.value=data.profile.name||'';
  $('#platformAccountLabel').textContent=data.email;
  $('#platformImport').hidden=!data.canImport;
  $('#platformAlertCount').textContent=String(data.alerts.filter(a=>!a.seen).length);
  const {price,percent}=MarketStrategy;
  $('#platformAlerts').innerHTML=data.alerts.length?data.alerts.map(a=>'<li class="market-opportunity"><strong>'+
    esc(a.name)+' · '+esc(marketNames[a.store]||a.store)+' · '+esc(a.kind)+'</strong><p>'+price(a.previous)+' → '+price(a.price)+
    ' · '+percent(a.percent)+' · '+marketTime(a.detected)+' · '+esc(a.branch)+'</p><p>'+
    (a.lostPosition?'Tu precio registrado quedó por encima de esta referencia. ':'')+esc(a.recommendation)+
    '</p><div class="market-links">'+safeLink(a.url,'Fuente ↗')+' <button type="button" class="quiet" data-platform-product="'+
    esc(a.product)+'">Ver producto</button> '+(a.seen?'Leída':'<button type="button" class="text-action" data-alert-read="'+
    Number(a.id)+'">Marcar como leída</button>')+'</div></li>').join(''):'<li>Las alertas nuevas aparecerán cuando se detecte una variación que coincida con tu seguimiento.</li>';
  $('#platformReports').innerHTML=data.reports.length?data.reports.map(report=>'<li>'+esc(report.name)+' · '+
    marketTime(report.created)+' <button class="text-action" type="button" data-platform-report="'+esc(report.id)+'">Abrir</button></li>').join(''):'<li>Sin informes guardados.</li>';
  renderPlatformOpportunities();
}

function renderPlatformOpportunities(){
  if(!platformAccount)return;
  const rule=platformAccount.preferences;
  const matches=(marketReportState?.products||[]).filter(p=>(rule.products.includes(p.code)||rule.categories.some(value=>value.toLowerCase()===p.category.toLowerCase()))&&
    (!rule.stores.length||p.quotes.some(q=>rule.stores.includes(q.store)))).slice(0,6);
  $('#platformOpportunities').innerHTML=matches.length?matches.map(p=>'<li><strong>'+esc(p.name)+'</strong> · '+
    MarketStrategy.percent(p.gap)+' de brecha'+
    ' <button class="text-action" type="button" data-platform-product="'+esc(p.code)+'">Ver oportunidad</button></li>').join(''):
    '<li>No hay comparables en el corte que coincidan con tu seguimiento.</li>';
}

async function loadDashboard(){
  if(!platformAccount)return;
  renderDashboard(await platformRequest('/dashboard'));
}

async function followPlatformProduct(code){
  if(!platformAccount)return;
  try{
    const rule=platformAccount.preferences;
    platformAccount.preferences=await platformRequest('/preferences',{method:'PUT',body:{...rule,products:[...rule.products,code]}});
    await loadDashboard();
    $('#marketFollowProduct').textContent='Producto seguido';
  }catch(error){notify(error.message);}
}

async function enablePlatformPush(){
  if(!platformAccount)return;
  if(!platformPushKey)throw Error('El administrador todavía no configuró las notificaciones del navegador.');
  if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))
    throw Error('Este navegador o dispositivo admite alertas dentro de Gondolupa.');
  const permission=await Notification.requestPermission();
  if(permission!=='granted')throw Error('Permiso sin conceder. Tus alertas siguen en Gondolupa.');
  const registration=await navigator.serviceWorker.register('/gondolupa-sw.js',{scope:'/'});
  await navigator.serviceWorker.ready;
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription){
    const padded=platformPushKey.padEnd(Math.ceil(platformPushKey.length/4)*4,'=');
    const decoded=atob(padded.replace(/-/g,'+').replace(/_/g,'/'));
    subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(decoded,c=>c.charCodeAt(0))});
  }
  await platformRequest('/push',{method:'POST',body:subscription.toJSON()});
  platformAccount.preferences=await platformRequest('/preferences',{method:'PUT',body:{...platformAccount.preferences,channel:'push'}});
  await loadDashboard();
  platformNotice('Notificaciones habilitadas en este dispositivo.');
}

async function storePlatformReport(){
  await loadPlatform(true);
  if(!platformAccount){navigate('cuenta');platformNotice('Iniciá sesión para guardar un informe.');return;}
  if(!marketReportState?.products.length)throw Error('Seleccioná un corte con productos comparables.');
  const dayFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Montevideo'});
  const rows=marketRows.filter(row=>Date.parse(row.checked)&&dayFormat.format(new Date(row.checked))===marketReportState.day&&
    marketReportState.period.endsWith('|'+row.scope));
  const own=FieldBenchmark.normalize(study.fieldBenchmark,study.competitors);
  await platformRequest('/reports',{method:'POST',body:{
    name:(study.project.name||'Informe de mercado')+' · '+marketReportState.day,
    payload:{observations:rows,period:marketReportState.period,branches:marketBranches,ownItems:own.items,target:own.target,
      format:$('#marketType').value,...marketFreshness},
  }});
  notify('Informe guardado en Mi espacio.');
}

function initPlatform(){
  const form=$('#platformAuth');
  form.onsubmit=async event=>{
    event.preventDefault();
    const action=accountResetToken?'reset':event.submitter?.value||'login';
    try{
      const data=await platformRequest('/account/'+action,{method:'POST',body:{
        email:form.elements.email.value,password:form.elements.password.value,token:accountResetToken,
      }});
      if(action==='login'){platformLoaded=false;await loadPlatform();platformNotice('Sesión iniciada.');}
      else platformNotice(data.message);
      if(action==='reset'){accountResetToken='';form.elements.email.hidden=false;$('#platformAuthTitle').textContent='Ingresá a Gondolupa';}
      form.elements.password.value='';
    }catch(error){platformNotice(error.message);}
  };
  $('#platformLogout').onclick=async ()=>{
    try{
      if('serviceWorker' in navigator){
        const registration=await navigator.serviceWorker.getRegistration('/gondolupa-sw.js');
        const subscription=await registration?.pushManager.getSubscription();
        if(subscription){
          try{await platformRequest('/push',{method:'DELETE',body:{endpoint:subscription.endpoint}});}catch{}
          await subscription.unsubscribe().catch(()=>{});
        }
      }
      await studySave.catch(()=>{});
      await platformRequest('/account/logout',{method:'POST',body:{}});
      setAccount(null);
      platformNotice('Sesión cerrada.');
    }catch(error){platformNotice(error.message);}
  };
  $('#platformPreferences').onsubmit=async event=>{
    event.preventDefault();
    const f=event.target.elements,split=value=>value.split(',').map(v=>v.trim()).filter(Boolean);
    try{
      await platformRequest('/preferences',{method:'PUT',body:{products:split(f.products.value),categories:split(f.categories.value),
        stores:split(f.stores.value),threshold:Number(f.threshold.value),frequency:f.frequency.value,channel:f.channel.value}});
      await loadDashboard();
      platformNotice('Seguimiento guardado.');
    }catch(error){platformNotice(error.message);}
  };
  $('#platformProfile').onsubmit=async event=>{
    event.preventDefault();
    const own=FieldBenchmark.normalize(study.fieldBenchmark,study.competitors);
    try{
      await platformRequest('/profile',{method:'PUT',body:{name:event.target.elements.displayName.value,
        format:$('#marketType').value,target:own.target,prices:own.items.map(p=>({code:p.code,price:p.price,cost:p.cost}))}});
      await loadDashboard();
      platformNotice('Perfil y precios propios guardados.');
    }catch(error){platformNotice(error.message);}
  };
  $('#platformPush').onclick=()=>void enablePlatformPush().catch(e=>platformNotice(e.message));
  $('#platformImport').onsubmit=async event=>{
    event.preventDefault();
    try{
      const file=event.target.elements.priceFile.files[0];
      if(!file||file.size>5000000)throw Error('Elegí un JSON de hasta 5 MB.');
      const result=await platformRequest('/import',{method:'POST',body:JSON.parse(await file.text()),timeout:90000});
      applyMarket(result.market);
      await loadDashboard();
      platformNotice(result.inserted+' observaciones incorporadas · '+result.rejected+' rechazadas.');
    }catch(error){platformNotice(error.message);}
  };
  $('#platformReload').onclick=()=>void loadDashboard().catch(e=>platformNotice(e.message));
  $('#marketSave').onclick=()=>void storePlatformReport().catch(e=>notify(e.message));
  $('#platformSavedClose').onclick=()=>$('#platformSavedDialog').close();
  $('#platformDashboard').onclick=async event=>{
    const btn=event.target.closest('button');
    if(!btn)return;
    try{
      if(btn.dataset.platformProduct)openMarketProduct(btn.dataset.platformProduct);
      if(btn.dataset.alertRead){
        await platformRequest('/alerts/read',{method:'POST',body:{id:Number(btn.dataset.alertRead)}});
        await loadDashboard();
      }
      if(btn.dataset.platformReport){
        const report=await platformRequest('/reports/'+encodeURIComponent(btn.dataset.platformReport));
        const p=report.payload;
        if(!Array.isArray(p.observations))throw Error('La copia del informe no es válida.');
        $('#platformSavedTitle').textContent=report.name;
        $('#platformSavedContent').innerHTML=MarketReport.render(MarketIntelligence.analyze(p.observations,{
          period:p.period,branches:p.branches,ownItems:p.ownItems,target:p.target,recentHours:p.recentHours,staleHours:p.staleHours,
          now:Date.parse(report.created),
        }),marketNames,{format:p.format});
        $('#platformSavedDialog').showModal();
      }
    }catch(error){platformNotice(error.message);}
  };
  if(location.protocol==='file:')return;
  const params=new URLSearchParams(location.search);
  const verify=params.get('verify');
  accountResetToken=params.get('reset')||'';
  if(!accountResetToken)void loadPlatform();
  if(verify||accountResetToken||location.hash==='#mis-alertas'){
    navigate('cuenta');
    history.replaceState(null,'',location.pathname);
    if(verify)void platformRequest('/account/verify',{method:'POST',body:{token:verify}}).then(x=>platformNotice(x.message),e=>platformNotice(e.message));
    if(accountResetToken){
      setAccount(null);
      form.elements.email.hidden=true;
      $('#platformAuthTitle').textContent='Elegí una contraseña nueva';
    }
    const product=params.get('producto');
    if(product)void loadMarket().then(()=>openMarketProduct(product));
  }
}
