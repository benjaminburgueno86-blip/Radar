function addRadarBasemap(map){
 const status=map.getContainer().parentElement.querySelector('[data-map-status], #mapBaseStatus');
 const blank='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
 const base=L.tileLayer.wms('https://mapas.ide.uy/geoserver-vectorial/ows',{
  layers:'capa_base_ideuy_ideuy',format:'image/png',version:'1.1.1',
  maxZoom:18,updateWhenIdle:true,keepBuffer:1,errorTileUrl:blank,
  attribution:'Cartografía <a href="https://www.gub.uy/infraestructura-datos-espaciales/politicas-y-gestion/geoservicio-del-mapa-base-uruguay">IDE Uruguay</a>'
 });
 let failures=0;
 function announce(text){if(status){status.textContent=text;status.hidden=false;}}
 base.on('loading',()=>{failures=0;announce('Cargando calles y barrios…');});
 base.on('tileerror',()=>{failures++;announce('No se pudo cargar parte del mapa de fondo. Podés seguir consultando los locales y el mapa de calor.');});
 base.on('load',()=>{if(!failures)announce('Mapa de calles y barrios de IDE Uruguay');});
 return base.addTo(map);
}
