(() => {
  const $=id=>document.getElementById(id);
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dt=new Intl.DateTimeFormat('es-UY',{dateStyle:'short',timeStyle:'short',timeZone:'America/Montevideo'});
  const local=new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeStyle:'short',timeZone:'America/Montevideo'});
  const money=new Intl.NumberFormat('es-UY',{style:'currency',currency:'UYU'});
  const amount=cents=>money.format(cents/100);
  const percent=n=>Number(n).toLocaleString('es-UY',{maximumFractionDigits:1})+' %';
  const date=value=>value?dt.format(new Date(value)):'Sin registros';
  const now=()=>local.format(new Date()).replace(' ','T');
  const values=form=>Object.fromEntries(new FormData(form));
  const roles={admin:'Administrador',supervisor:'Supervisor',relevador:'Relevador'};
  const accessLink=()=>{
    const params=new URLSearchParams(location.hash.slice(1));
    return {invitation:params.get('invite'),activation:params.get('alta')};
  };
  const {invitation,activation}=accessLink();
  const activating=!!(invitation||activation);
  window.addEventListener('hashchange',()=>{
    const next=accessLink();
    if(next.invitation!==invitation||next.activation!==activation)location.reload();
  });
  const views=['captura','revision','analisis','alertas','equipo'];
  let session, company='', member, view='captura', records=[], products=[], report, activeMap, heat, markers, photoUrl;

  function message(text='',error=false){
    $('tradeMessage').textContent=text;
    $('tradeMessage').dataset.error=String(error);
  }
  async function request(path,{method='GET',body,format='json'}={}){
    const context=company;
    const headers={};
    if(context)headers['X-Radar-Company']=context;
    if(body!==undefined)headers['Content-Type']='application/json';
    const response=await fetch('/trade-api'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
    if(context!==company)throw Error('La empresa seleccionada cambió.');
    if(!response.ok){
      const error=await response.json().catch(()=>({}));
      if(response.status===401&&context){company='';member=null;showSession({memberships:[]});}
      throw Error(error.error||'No se pudo completar la operación.');
    }
    const result=await response[format]();
    if(context!==company)throw Error('La empresa seleccionada cambió.');
    return result;
  }
  function onForm(id,fn){
    $(id).addEventListener('submit',async event=>{
      event.preventDefault();
      const button=event.submitter;
      if(button)button.disabled=true;
      try{message();await fn(event.currentTarget,values(event.currentTarget));}
      catch(error){message(error.message,true);}
      finally{if(button)button.disabled=false;}
    });
  }
  function run(fn){void Promise.resolve().then(fn).catch(error=>message(error.message,true));}
  function resetDialog(){
    if($('tradeDialog').open)$('tradeDialog').close();
    if(photoUrl){URL.revokeObjectURL(photoUrl);photoUrl=null;}
    $('tradeDialogBody').replaceChildren();
  }
  function dialog(html){
    resetDialog();
    $('tradeDialogBody').innerHTML=html;
    $('tradeDialog').showModal();
  }
  function showSession(data){
    session=data;
    $('tradeAccess').hidden=!activating&&data.memberships.length>0;
    $('tradeWorkspace').hidden=activating||!data.memberships.length;
    if(!data.memberships.length){
      resetDialog();
      $('tradeWorkspace').querySelectorAll('form').forEach(form=>form.reset());
      ['tradeRecords','tradeAnalysis','tradeMembers','tradeRules','tradeAlerts','tradeMapPlaces','tradeSearchResults'].forEach(id=>$(id).replaceChildren());
      $('tradeVisit').replaceChildren();$('tradeCompany').replaceChildren();$('tradeMapProduct').replaceChildren();
      $('tradeInviteLink').value='';$('tradeInviteOutput').hidden=true;
      records=[];products=[];report=null;markers?.clearLayers();heat?.setData([],600);
    }
    $('tradeSignup').hidden=activating;
    $('tradeBackToLogin').hidden=!activating;
    $('tradeAccessTitle').textContent=activation?'Activá tu espacio empresarial':invitation?'Aceptar invitación empresarial':'Acceso empresarial';
    $('tradeAccessCopy').textContent=activating?'Ingresá el mismo correo. Si es tu primera cuenta, elegí una contraseña de al menos 12 caracteres. Si ya tenés cuenta, usá tu contraseña habitual.':'Ingresá con tu cuenta o creá el espacio de tu empresa.';
    $('tradeLoginButton').textContent=activation?'Activar e ingresar':invitation?'Aceptar e ingresar':'Ingresar';
    if(!activating&&data.memberships.length){
      $('tradeCompany').innerHTML=data.memberships.map(m=>'<option value="'+escape(m.company)+'">'+escape(m.companyName)+'</option>').join('');
      return selectCompany(data.memberships.some(m=>m.company===company)?company:data.memberships[0].company);
    }
  }
  async function selectCompany(id){
    company=id;
    member=session.memberships.find(m=>m.company===id);
    $('tradeCompany').value=id;
    $('tradeRole').textContent=member.name+' · '+roles[member.role];
    $('tradeTeamTab').hidden=member.role!=='admin';
    document.querySelectorAll('[data-trade-reviewer]').forEach(node=>node.hidden=member.role==='relevador');
    $('tradeWorkspace').querySelectorAll('form').forEach(form=>form.reset());
    $('tradeVisitForm').elements.checked.value=now();
    $('tradeOwn').elements.checked.value=now();
    $('tradeInviteLink').value='';$('tradeInviteOutput').hidden=true;
    $('tradeSearchResults').replaceChildren();
    $('tradeVisit').replaceChildren();$('tradeMapProduct').replaceChildren();
    ['tradeRecords','tradeAnalysis','tradeMembers','tradeRules','tradeAlerts','tradeMapPlaces'].forEach(id=>$(id).replaceChildren());
    records=[];products=[];report=null;markers?.clearLayers();heat?.setData([],600);resetDialog();
    await showView(location.hash==='#alertas'?'alertas':'captura');
  }
  async function showView(next){
    if(!views.includes(next)||next==='equipo'&&member.role!=='admin')return;
    view=next;
    document.querySelectorAll('[data-trade-panel]').forEach(node=>node.hidden=node.dataset.tradePanel!==next);
    document.querySelectorAll('[data-trade-view]').forEach(node=>node.setAttribute('aria-current',node.dataset.tradeView===next?'page':'false'));
    if(next==='captura')await loadVisits();
    if(next==='revision')await loadRecords();
    if(next==='analisis')await Promise.all([loadAnalysis(),member.role!=='relevador'&&loadProducts()]);
    if(next==='alertas')await Promise.all([loadAlerts(),member.role!=='relevador'&&loadProducts()]);
    if(next==='equipo')await loadMembers();
  }
  async function loadVisits(id=$('tradeVisit').value){
    const data=await request('/visits');
    $('tradeVisit').innerHTML='<option value="">Seleccioná una visita</option>'+data.visits.map(v=>'<option value="'+escape(v.id)+'">'+escape(v.store+' · '+v.branch+' · '+date(v.checked))+'</option>').join('');
    if(data.visits.some(v=>v.id===id))$('tradeVisit').value=id;
    if(!data.visits.length)$('tradeNewVisit').open=true;
  }
  async function loadProducts(q='',show=false){
    const data=await request('/products?q='+encodeURIComponent(q));
    products=data.products;
    const options=products.map(p=>'<option value="'+escape(p.product)+'">'+escape(p.name+' · '+p.presentation+(p.code?' · '+p.code:''))+'</option>').join('');
    if(show)$('tradeSearchResults').innerHTML=products.length?products.map((p,i)=>'<button class="quiet" type="button" data-product-index="'+i+'">'+escape(p.name+' · '+p.presentation)+'</button>').join(''):'<p>Sin coincidencias. Podés registrar un producto nuevo.</p>';
    else{
      $('tradeOwn').elements.product.innerHTML='<option value="">Elegí un producto</option>'+options;
      $('tradeRule').elements.product.innerHTML='<option value="">Todos</option>'+options;
    }
  }
  async function image(file){
    if(!file?.size)return undefined;
    if(file.size>20_000_000)throw Error('La foto supera 20 MB. Elegí una más pequeña.');
    if(file.size<=1_500_000&&/^image\/(jpeg|png|webp)$/.test(file.type))return dataUrl(file);
    const bitmap=await createImageBitmap(file);
    try{
      const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
      return canvas.toDataURL('image/jpeg',0.75);
    }finally{bitmap.close();}
  }
  function dataUrl(file){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result);
      reader.onerror=()=>reject(Error('No se pudo leer el archivo.'));
      reader.readAsDataURL(file);
    });
  }
  function fillProduct(form,p){
    for(const field of ['name','brand','category','presentation','code'])form.elements[field].value=p[field]||'';
  }
  const cmd=(label,action,id)=>'<button class="quiet" type="button" data-record-action="'+action+'" data-id="'+escape(id)+'">'+label+'</button>';
  async function loadRecords(){
    const data=await request('/records?status='+encodeURIComponent($('tradeStatus').value));
    records=data.rows;
    $('tradeRecords').innerHTML=records.length?records.map(r=>'<article class="trade-record"><h3>'+escape(r.name+' · '+r.presentation)+'</h3><p>'+escape(r.store+' · '+r.branch+' · '+date(r.checked)+' · '+r.employee)+'</p><p><b>'+amount(r.price)+'</b>'+
      (r.promo==null?'':' · Promoción '+amount(r.promo)+' · '+escape(r.conditions))+' · <span class="trade-badge">'+escape(r.status)+'</span></p>'+
      (r.notes?'<p>'+escape(r.notes)+'</p>':'')+(r.flags.length?'<p class="trade-flags">'+escape(r.flags.join(' · '))+'</p>':'')+
      '<div class="trade-actions">'+cmd('Historial de edición','audit',r.id)+(r.hasPhoto?cmd('Ver foto','photo',r.id):'')+
      (member.role!=='relevador'||r.status!=='validado'?cmd('Corregir','edit',r.id):'')+
      (member.role!=='relevador'&&r.status==='pendiente'?cmd('Validar','validado',r.id)+cmd('Rechazar','rechazado',r.id):'')+
      '</div></article>').join(''):'<p>No hay registros para este filtro.</p>';
  }
  async function recordAction(action,id){
    const row=records.find(r=>r.id===id);
    if(!row)return;
    if(action==='photo'){
      const blob=await request('/records/'+id+'/photo',{format:'blob'});
      dialog('<img alt="Foto privada del producto y su etiqueta">');
      photoUrl=URL.createObjectURL(blob);$('tradeDialogBody').querySelector('img').src=photoUrl;
      return;
    }
    if(action==='audit'){
      const data=await request('/records/'+id+'/audit');
      dialog('<h2>Historial de edición</h2><ol>'+data.events.map(a=>'<li><details><summary>'+escape(date(a.at)+' · '+a.actor+' · '+a.action)+' · '+amount(a.snapshot.price)+'</summary>'+
        '<p>'+escape([a.snapshot.name,a.snapshot.brand,a.snapshot.presentation,a.snapshot.category,a.snapshot.code].filter(Boolean).join(' · '))+'</p>'+
        (a.snapshot.promo==null?'':'<p>Promoción '+amount(a.snapshot.promo)+' · '+escape(a.snapshot.conditions)+'</p>')+
        (a.note?'<p>'+escape(a.note)+'</p>':'')+(a.snapshot.notes?'<p>'+escape(a.snapshot.notes)+'</p>':'')+'</details></li>').join('')+'</ol>');
      return;
    }
    if(action==='edit'){
      dialog('<h2>Corregir registro</h2><form class="trade-form" id="tradeEditForm">'+$('tradePriceForm').innerHTML+
        '<label>Motivo de la corrección <input name="reason" required></label></form>');
      const form=$('tradeEditForm');
      fillProduct(form,row);
      for(const k of ['conditions','notes'])form.elements[k].value=row[k]||'';
      form.elements.price.value=row.price/100;form.elements.promo.value=row.promo==null?'':row.promo/100;
      form.querySelector('button').textContent='Guardar corrección';
      onForm('tradeEditForm',async(form,data)=>{
        data.photo=await image(data.photo);
        data.version=row.version;
        await request('/records/'+id,{method:'PATCH',body:data});
        resetDialog();await loadRecords();message('Corrección guardada para revisión.');
      });
      return;
    }
    dialog('<h2>'+(action==='validado'?'Validar':'Rechazar')+'</h2><p>'+escape(row.name+' · '+row.branch)+'</p><form id="tradeReviewForm"><label>Motivo de la decisión <textarea name="reason" rows="3" '+(action==='rechazado'||row.flags.length?'required':'')+'></textarea></label><button class="primary">Confirmar</button></form>');
    onForm('tradeReviewForm',async(form,data)=>{
      await request('/records/'+id+'/review',{method:'POST',body:{status:action,version:row.version,reason:data.reason}});
      resetDialog();await loadRecords();message('Estado actualizado.');
    });
  }

  const table=(head,rows,empty)=>rows.length?'<div class="trade-scroll"><table><thead><tr>'+head.map(h=>'<th>'+h+'</th>').join('')+
    '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'<p>'+empty+'</p>';
  const card=(name,content)=>'<article class="card"><h2>'+name+'</h2>'+content+'</article>';
  function chart(series){
    const min=Math.min(...series.points.map(p=>p.price)),max=Math.max(...series.points.map(p=>p.price));
    const start=Date.parse(series.points[0].checked),end=Date.parse(series.points.at(-1).checked);
    const coords=series.points.map(p=>[6+308*(Date.parse(p.checked)-start)/Math.max(1,end-start),75-65*(p.price-min)/Math.max(1,max-min)]);
    return '<svg viewBox="0 0 320 82" class="trade-chart" role="img" aria-label="Evolución de precios"><polyline points="'+
      coords.map(p=>p.join(',')).join(' ')+'" fill="none" stroke="#387354" stroke-width="2"></polyline>'+
      coords.map(([x,y])=>'<circle cx="'+x+'" cy="'+y+'" r="3" fill="#387354"></circle>').join('')+'</svg>';
  }
  const query=()=>new URLSearchParams(values($('tradeFilters'))).toString();
  async function loadAnalysis(){
    report=await request('/analysis?'+query());
    const {stats,comparisons,channels,series,recommendations,promotions,activity}=report;
    const cards=[['Productos',stats.products],['Comercios',stats.stores],['Sucursales',stats.branches],['Último relevamiento',date(stats.last)],['Observaciones dentro de '+report.recentHours+' h',stats.recent]];
    const kpis='<div class="trade-kpis">'+cards.map(([k,v])=>'<div><small>'+escape(k)+'</small><strong>'+escape(v)+'</strong></div>').join('')+'</div>';
    const recs=recommendations.map(r=>'<div class="trade-record"><h3>'+escape(r.kind+' · '+r.row.name)+'</h3><p>'+escape(r.row.store+' · '+r.row.branch+' · '+date(r.row.checked))+'</p><p>Competidor '+amount(r.previous.price)+' → '+amount(r.row.price)+' ('+percent(r.movement)+') · Precio propio '+amount(r.own)+' · Brecha '+amount(r.delta)+' ('+percent(r.percent)+')</p><p>'+escape(r.action)+'</p></div>').join('');
    const comp=table(['Producto','Canal y día','Sucursales y precios','Brecha'],comparisons.map(c=>[escape(c.name),escape(c.source+' · '+c.date)+(c.recent?'':' · histórico'),
      c.quotes.map(q=>escape(q.store+' · '+q.branch)+' '+amount(q.price)).join('<br>'),percent(c.gap)]),'Se necesitan dos observaciones equivalentes del mismo canal y día.');
    const channel=table(['Producto y sucursal','Presencial','Digital','Diferencia'],channels.map(c=>[escape(c.local.name+' · '+c.local.branch),
      amount(c.local.price)+' · '+escape(date(c.local.checked)),amount(c.web.price)+' · '+escape(date(c.web.checked)),amount(c.delta)+' ('+percent(c.percent)+')']),
      'Todavía no hay fichas de ambos canales con el mismo GTIN, sucursal y día.');
    const histories=series.slice(0,40).map(s=>'<details><summary>'+escape(s.name+' · '+s.store+' · '+s.branch+' · '+s.source)+'</summary>'+chart(s)+
      '<p>'+escape(s.points.length+' observaciones')+' · '+amount(s.delta)+' ('+percent(s.percent)+')</p>'+
      table(['Fecha','Precio','Variación desde el anterior'],s.points.map((p,i)=>{
        const prev=s.points[i-1];
        return [escape(date(p.checked)),amount(p.price),prev?amount(p.price-prev.price)+' ('+percent((p.price-prev.price)/prev.price*100)+')':'—'];
      }),'')+'</details>').join('');
    $('tradeAnalysis').innerHTML=card('Informe · '+escape(member.companyName),kpis+(report.truncated?'<p>Se muestran hasta 5.000 relevamientos validados de la empresa.</p>':'')+
      '<p>Las recomendaciones requieren un cambio observado, un precio propio comparable y registros dentro del umbral de vigencia.</p>')+
      card('Oportunidades y amenazas',recs||'<p>Por ahora no hay evidencia suficiente para recomendar una acción.</p>')+
      card('Comparación de competidores',comp)+card('Góndola frente a catálogo digital',channel)+
      card('Evolución por producto',histories||'<p>Todavía no hay series de precios validados.</p>')+
      card('Promociones',table(['Producto','Sucursal','Fecha','Precio','Condiciones'],promotions.map(p=>[escape(p.name),escape(p.branch),escape(date(p.checked)),amount(p.promo),escape(p.conditions)]),'Sin promociones validadas para estos filtros.'))+
      card('Actividad de relevadores',table(['Empleado','Observaciones validadas','Visitas'],activity.map(a=>[escape(a.employee),a.observations,a.visits]),'Sin actividad validada.'));
    const mapComparisons=comparisons.filter(c=>c.source==='presencial');
    $('tradeMapProduct').innerHTML='<option value="">Elegí un producto y día</option>'+mapComparisons.map((c,i)=>'<option value="'+i+'">'+escape(c.name+' · '+c.date)+'</option>').join('');
    renderMap(true);
  }
  function renderMap(fit=false){
    if(!report||view!=='analisis')return;
    const mode=$('tradeMapMode').value,selected=$('tradeMapProduct').value;
    $('tradeMapProduct').disabled=mode!=='precios';
    const comparison=mode==='precios'&&selected!==''?report.comparisons.filter(c=>c.source==='presencial')[Number(selected)]:null;
    $('tradeMapHint').textContent=mode==='visitas'?'El calor representa cantidad de sucursales con coordenadas.':
      'Los marcadores comparan la misma presentación y día. Verde identifica el precio más bajo.';
    const places=report.points.filter(p=>mode==='visitas'||comparison?.quotes.some(q=>q.place===p.id));
    const located=places.filter(p=>p.lat!=null&&p.lng!=null);
    const info=p=>{
      const quote=comparison?.quotes.find(q=>q.place===p.id);
      return '<strong>'+escape(p.store+' · '+p.branch)+'</strong><br>'+escape(p.address)+(p.zone?' · '+escape(p.zone):'')+
        '<br>'+escape(date(p.checked)+' · '+p.products+' productos')+(quote?'<br>'+amount(quote.price)+' · '+percent((quote.price-comparison.min)/comparison.min*100)+' sobre el mínimo':'')+
        (p.differences.length?'<br>'+p.differences.map(c=>escape(c.name)+' '+percent(c.gap)+' de brecha').join('<br>'):'')+
        (p.recommendations.length?'<br>'+p.recommendations.map(r=>escape(r.kind+' · '+r.row.name)).join('<br>'):'');
    };
    $('tradeMapPlaces').innerHTML=places.length?'<details><summary>'+places.length+' sucursales</summary><ul>'+places.map(p=>'<li>'+info(p)+(p.lat==null?'<br>Sin coordenadas':'')+'</li>').join('')+'</ul></details>':'<p>Sin sucursales para esta capa.</p>';
    if(!window.L)return;
    if(!activeMap){
      activeMap=L.map('tradeMap',{scrollWheelZoom:false}).setView([-34.89,-56.17],12);
      addRadarBasemap(activeMap);
      activeMap.createPane('radarHeatPane');activeMap.getPane('radarHeatPane').style.zIndex=350;
      activeMap.getPane('radarHeatPane').style.pointerEvents='none';
      heat=createSmoothHeat().addTo(activeMap);markers=L.layerGroup().addTo(activeMap);
    }
    markers.clearLayers();
    heat.setData(mode==='visitas'?located.map(p=>({lat:p.lat,lon:p.lng})):[],600);
    for(const p of located){
      const quote=comparison?.quotes.find(q=>q.place===p.id);
      L.circleMarker([p.lat,p.lng],{radius:7,color:'#fff',weight:1,fillOpacity:.9,
        fillColor:quote&&quote.price>comparison.min?'#b66a36':'#387354'}).bindPopup(info(p)).addTo(markers);
    }
    activeMap.invalidateSize();
    if(located.length&&(fit||mode==='precios'))activeMap.fitBounds(located.map(p=>[p.lat,p.lng]),{maxZoom:15,padding:[25,25]});
  }
  async function loadAlerts(){
    const data=await request('/alerts');
    $('tradePush').hidden=!session.pushKey||!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window);
    $('tradePushHint').textContent=$('tradePush').hidden?'Los avisos se consultan en esta lista.':'Podés activar avisos del navegador para esta empresa.';
    $('tradeAlerts').innerHTML=data.alerts.length?data.alerts.map(a=>{
      const r=a.payload;
      return '<div class="trade-record"><h3>'+escape(r.name+' · '+r.branch)+'</h3><p>'+escape(r.store+' · '+date(r.checked))+' · '+amount(r.previous)+' → '+amount(r.price)+' ('+percent(r.percent)+')</p><p>'+escape(r.impact)+'</p></div>';
    }).join(''):'<p>No hay alertas generadas para la empresa.</p>';
    if(member.role==='relevador')return;
    const rules=await request('/rules');
    $('tradeRules').innerHTML=rules.rules.map(r=>'<div class="trade-record">'+escape(percent(r.threshold)+' · '+[r.store,r.branch,r.category,r.zone,r.product].filter(Boolean).join(' · '))+
      ' <button class="quiet" type="button" data-rule-id="'+escape(r.id)+'">Quitar regla</button></div>').join('');
  }
  async function loadMembers(){
    const data=await request('/members');
    $('tradeMembers').innerHTML=data.members.map(u=>'<form class="trade-record trade-inline" data-member="'+escape(u.user)+'"><div>'+escape(u.name+' · '+u.email)+'</div>'+
      (u.user===member.user?'<strong>'+escape(roles[u.role])+'</strong>':'<label>Rol <select name="role">'+Object.entries(roles).map(([k,label])=>'<option value="'+k+'"'+(u.role===k?' selected':'')+'>'+label+'</option>').join('')+'</select></label><label>Estado <select name="active"><option value="1"'+(u.active?' selected':'')+'>Activo</option><option value="0"'+(!u.active?' selected':'')+'>Inactivo</option></select></label><button class="quiet">Guardar</button>')+'</form>').join('');
  }

  onForm('tradeLogin',async(form,data)=>{
    if(activation)await request('/signup/confirm',{method:'POST',body:{...data,token:activation}});
    else{
      if(invitation)await request('/invite/accept',{method:'POST',body:{...data,token:invitation}});
      await request('/login',{method:'POST',body:data});
    }
    if(activating){history.replaceState(null,'',location.pathname);location.reload();return;}
    form.reset();await showSession(await request('/session'));
  });
  onForm('tradeSignupForm',async(form,data)=>{
    const result=await request('/signup',{method:'POST',body:data});
    form.reset();
    if(result.activation){location.assign(result.activation);return;}
    $('tradeSignup').open=false;
    message(result.message);
  });
  onForm('tradeVisitForm',async(form,data)=>{
    const saved=await request('/visits',{method:'POST',body:{...data,checked:data.checked+'-03:00'}});
    await loadVisits(saved.id);$('tradeNewVisit').open=false;message('Visita activa. Ya podés cargar productos.');
  });
  onForm('tradePriceForm',async(form,data)=>{
    if(!$('tradeVisit').value)throw Error('Seleccioná o iniciá una visita.');
    data.visit=$('tradeVisit').value;data.photo=await image(data.photo);
    const row=await request('/records',{method:'POST',body:data});
    form.reset();form.elements.name.focus();
    message('Registro pendiente de revisión.'+(row.flags.length?' Avisos: '+row.flags.join(', ')+'.':''));
  });
  onForm('tradeSearch',async(form,data)=>loadProducts(data.q,true));
  const importFields={name:'Producto',price:'Precio (UYU)',store:'Comercio',branch:'Sucursal',address:'Dirección',checked:'Fecha y hora',
    category:'Categoría',presentation:'Presentación',code:'Código de barras',brand:'Marca',zone:'Zona',lat:'Latitud',lng:'Longitud',
    promo:'Precio promocional',conditions:'Condiciones de la promoción',notes:'Observaciones'};
  function columnName(index){
    return (index>=26?String.fromCharCode(64+Math.floor(index/26)):'')+String.fromCharCode(65+index%26);
  }
  function showImport(file,initial,context){
    dialog('<h2>Revisá tu planilla</h2><p>Confirmá qué columnas contienen el producto y el precio. Las demás se pueden omitir o asignar.</p>'+
      '<form id="tradeImportReview"><div class="trade-inline"><label>Hoja <select name="sheet"></select></label>'+
      '<label>Fila de encabezados <input name="header" type="number" min="0" required></label>'+
      '<label>Última fila de datos <input name="last" type="number" min="1" placeholder="Hasta el final"></label></div>'+
      '<p class="mini">Usá 0 si la hoja no tiene encabezados. Podés indicar la última fila para excluir totales o notas al pie.</p>'+
      '<div id="tradeImportMapping" class="trade-form"></div>'+
      '<details id="tradeImportContext"><summary>Completar datos de la visita</summary>'+
      '<label>Usar una visita existente para todas las filas <select name="visit"></select></label>'+
      '<p class="mini">Si elegís una visita, se usa su comercio, sucursal, dirección y fecha. También podés indicar datos comunes para las celdas vacías.</p>'+
      '<div class="trade-form"><label>Comercio <input name="default-store"></label><label>Sucursal <input name="default-branch"></label>'+
      '<label>Dirección <input name="default-address"></label><label>Fecha y hora de Uruguay <input type="datetime-local" name="default-checked"></label>'+
      '<label>Categoría común <input name="default-category"></label><label>Presentación común <input name="default-presentation"></label></div></details>'+
      '<p id="tradeImportError" role="status" class="trade-flags"></p><div id="tradeImportIssues"></div><button class="primary" type="submit">Comprobar columnas</button></form>');
    const form=$('tradeImportReview'),elements=form.elements,error=$('tradeImportError'),button=form.querySelector('button[type="submit"]');
    const defaultKeys=['store','branch','address','checked','category','presentation'];
    elements.visit.innerHTML=$('tradeVisit').innerHTML;
    elements.sheet.innerHTML=initial.sheets.map((label,index)=>'<option value="'+index+'">'+escape(label)+'</option>').join('');
    const issuesPanel=$('tradeImportIssues');
    let current=initial,revision=0,configRevision=0,ready=false,busy=false,verified=false;
    let corrections={},excluded=new Set();
    const invalidate=()=>{configRevision++;verified=false;button.textContent='Comprobar columnas';};
    const render=preview=>{
      current=preview;corrections={};excluded=new Set();issuesPanel.replaceChildren();invalidate();
      elements.sheet.value=String(preview.sheet);
      elements.header.value=String(preview.header);
      elements.header.max=String(preview.total);
      elements.last.value='';elements.last.min=String(preview.header+1);elements.last.max=String(preview.total);
      const select=(field,label)=>'<label>'+label+' <select name="map-'+field+'" '+(['name','price'].includes(field)?'required':'')+'><option value="">'+
        (['name','price'].includes(field)?'Elegí una columna':'Omitir columna')+'</option>'+preview.columns.map((col,index)=>{
          const sample=col.samples.find(Boolean);
          return '<option value="'+index+'" '+(preview.mapping[field]===index?'selected':'')+'>'+escape(columnName(index)+' · '+(col.label||'Sin encabezado')+(sample?' · '+sample:''))+'</option>';
        }).join('')+'</select></label>';
      const fields=Object.entries(importFields);
      $('tradeImportMapping').innerHTML=fields.slice(0,2).map(([field,label])=>select(field,label)).join('')+
        '<details class="trade-wide"><summary>Asignar otras columnas</summary><div class="trade-form">'+fields.slice(2).map(([field,label])=>select(field,label)).join('')+'</div></details>';
      $('tradeImportContext').open=['store','branch','address','checked'].some(field=>!(field in preview.mapping));
      ready=true;button.disabled=false;
    };
    async function refresh(settings){
      const id=++revision;
      ready=false;button.disabled=true;error.textContent='Leyendo la hoja…';
      try{
        const next=await request('/import/preview',{method:'POST',body:{...file,...settings}});
        if(id!==revision||!form.isConnected)return;
        error.textContent='';render(next);
      }catch(failure){if(id===revision&&form.isConnected)error.textContent=failure.message;}
    }
    elements.sheet.onchange=()=>void refresh({sheet:Number(elements.sheet.value)});
    elements.header.onchange=()=>void refresh({sheet:Number(elements.sheet.value),header:Number(elements.header.value)});
    form.oninput=event=>{
      const input=event.target,line=Number(input.dataset.line),field=input.dataset.field;
      if(line&&field)(corrections[line]??={})[field]=input.value;
      else if(line){if(input.checked)excluded.add(line);else excluded.delete(line);}
      else if(input.name==='last'){
        const last=Number(input.value)||current.total;
        for(const key of Object.keys(corrections))if(Number(key)>last)delete corrections[key];
        for(const key of excluded)if(key>last)excluded.delete(key);
        issuesPanel.replaceChildren();
      }
      else if(input.name.startsWith('map-')){
        const field=input.name.slice(4);
        for(const row of Object.values(corrections))delete row[field];
        issuesPanel.replaceChildren();
      }
      invalidate();
    };
    function showIssues(issues){
      issuesPanel.innerHTML=issues.map(issue=>{
        const {line,field}=issue;
        const index=field?form.elements['map-'+field]?.value:'';
        const column=index!==''&&index!==undefined?current.columns[Number(index)]:null;
        const label=column?columnName(Number(index))+' · '+(column.label||importFields[field]):importFields[field];
        return '<article class="trade-record"><strong>Fila '+line+(issue.product?' · '+escape(issue.product):'')+'</strong><p>'+escape(issue.message)+'</p>'+
          (label?'<label>Corregir '+escape(label)+' <input data-line="'+line+'" data-field="'+escape(field)+'" maxlength="1000" value="'+escape(issue.value)+'"></label>':'')+
          '<label class="check"><input type="checkbox" data-line="'+line+'">Omitir esta fila</label></article>';
      }).join('');
    }
    form.onsubmit=async event=>{
      event.preventDefault();
      if(!ready||busy||context!==company)return;
      const data=values(form),mapping={},defaults={};
      for(const field of Object.keys(importFields))if(data['map-'+field]!=='')mapping[field]=Number(data['map-'+field]);
      const used=new Map();
      for(const [field,index] of Object.entries(mapping)){
        if(used.has(index)){
          error.textContent='La columna '+columnName(index)+' está asignada a '+importFields[used.get(index)]+' y a '+importFields[field]+'. Elegí otra columna u omití uno de esos campos.';
          return;
        }
        used.set(index,field);
      }
      for(const field of defaultKeys)if(data['default-'+field])defaults[field]=data['default-'+field];
      const body={...file,sheet:current.sheet,header:current.header,last:data.last?Number(data.last):undefined,
        mapping,defaults,visit:data.visit,corrections,exclude:[...excluded]};
      const checking=!verified,config=configRevision;
      busy=true;button.disabled=true;error.textContent=checking?'Comprobando los datos…':'Importando precios…';
      try{
        const result=await request(checking?'/import/check':'/import',{method:'POST',body});
        if(checking){
          if(config!==configRevision||!form.isConnected){if(form.isConnected)error.textContent='';return;}
          showIssues(result.issues);
          verified=!result.issues.length;
          error.textContent=verified?result.records+' precios listos para importar.':'Corregí la celda indicada o elegí omitir esa fila. Todavía no se guardaron precios.';
          if(verified)button.textContent='Importar '+result.records+' precios';
          return;
        }
        $('tradeImport').reset();resetDialog();await loadVisits(data.visit||undefined);
        message(result.records+' registros pendientes en '+result.visits+' visitas.');
      }catch(failure){if(form.isConnected){invalidate();error.textContent=failure.message;}else message(failure.message,true);}
      finally{busy=false;button.disabled=!ready;}
    };
    render(initial);
  }
  onForm('tradeImport',async(form,data)=>{
    if(!data.file.size||data.file.size>2_000_000)throw Error('Elegí un archivo de hasta 2 MB.');
    const context=company;
    const url=await dataUrl(data.file);
    if(context!==company)throw Error('La empresa seleccionada cambió.');
    const file={filename:data.file.name,content:url.split(',')[1]};
    const preview=await request('/import/preview',{method:'POST',body:file});
    showImport(file,preview,context);
  });
  onForm('tradeFilters',loadAnalysis);
  onForm('tradeOwn',async(form,data)=>{
    const product=products.find(p=>p.product===data.product);
    if(!product)throw Error('Elegí un producto registrado.');
    await request('/own',{method:'POST',body:{...product,...data,checked:data.checked+'-03:00'}});
    await loadAnalysis();message('Precio propio guardado.');
  });
  onForm('tradeRule',async(form,data)=>{await request('/rules',{method:'POST',body:data});form.reset();await loadAlerts();message('Regla guardada.');});
  onForm('tradeInvite',async(form,data)=>{
    const invitation=await request('/members/invite',{method:'POST',body:data});
    $('tradeInviteLink').value=invitation.link;$('tradeInviteOutput').hidden=false;form.reset();message('Invitación lista para compartir en privado.');
  });
  $('tradeMembers').addEventListener('submit',event=>{
    event.preventDefault();
    run(async()=>{const data=values(event.target);await request('/members',{method:'PATCH',body:{user:event.target.dataset.member,role:data.role,active:data.active==='1'}});await loadMembers();message('Permisos actualizados.');});
  });
  $('tradeCompany').onchange=event=>run(()=>selectCompany(event.target.value));
  $('tradeLogout').onclick=()=>run(async()=>{await request('/logout',{method:'POST',body:{}});company='';member=null;showSession({memberships:[]});message('Sesión cerrada.');});
  $('tradeStatus').onchange=()=>run(loadRecords);
  $('tradeMapMode').onchange=()=>renderMap();
  $('tradeMapProduct').onchange=()=>renderMap();
  $('tradePrint').onclick=()=>{
    const closed=[...$('tradeAnalysis').querySelectorAll('details:not([open])')];
    closed.forEach(d=>d.open=true);
    window.addEventListener('afterprint',()=>closed.forEach(d=>d.open=false),{once:true});
    window.print();
  };
  $('tradeDialog').addEventListener('close',()=>{if(photoUrl&&!$('tradeDialog').open){URL.revokeObjectURL(photoUrl);photoUrl=null;}});
  $('tradeLocate').onclick=()=>{
    if(!navigator.geolocation){message('El navegador no ofrece ubicación. Podés ingresar las coordenadas manualmente.',true);return;}
    const context=company;
    navigator.geolocation.getCurrentPosition(({coords})=>{
      if(context!==company)return;
      $('tradeVisitForm').elements.lat.value=coords.latitude.toFixed(6);
      $('tradeVisitForm').elements.lng.value=coords.longitude.toFixed(6);
      message('Coordenadas registradas en el formulario.');
    },()=>message('No se pudo obtener la ubicación. Podés ingresar las coordenadas manualmente.',true),{timeout:10000});
  };
  $('tradePush').onclick=()=>run(async()=>{
    const permission=await Notification.requestPermission();
    if(permission!=='granted')throw Error('El navegador no autorizó los avisos.');
    await navigator.serviceWorker.register('/gondolupa-sw.js');
    const registration=await navigator.serviceWorker.ready;
    const key=Uint8Array.from(atob(session.pushKey.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0));
    const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    await request('/push',{method:'POST',body:subscription.toJSON()});
    message('Avisos del navegador habilitados para esta empresa.');
  });
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');
    if(!button)return;
    const data=button.dataset;
    if(data.tradeView)run(()=>showView(data.tradeView));
    if(data.productIndex!==undefined)fillProduct($('tradePriceForm'),products[Number(data.productIndex)]);
    if(data.recordAction)run(()=>recordAction(data.recordAction,data.id));
    if(data.ruleId)run(async()=>{await request('/rules/'+data.ruleId,{method:'DELETE',body:{}});await loadAlerts();message('Regla retirada.');});
    if(data.export)run(async()=>{
      const blob=await request('/export/'+data.export+(data.export==='recommendations'?'?'+query():''),{format:'blob'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download='radar-trade-'+data.export+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
    });
  });
  run(async()=>{await showSession(await request('/session'));});
})();
