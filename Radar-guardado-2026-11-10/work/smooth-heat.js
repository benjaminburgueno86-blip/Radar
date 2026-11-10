const HEAT_REF_LAT=-34.87,HEAT_METERS=6378137*Math.cos(HEAT_REF_LAT*Math.PI/180),heatPeakCache=new Map();
function heatXY(lat,lon){const r=Math.PI/180;return{x:HEAT_METERS*lon*r,y:HEAT_METERS*Math.log(Math.tan(Math.PI/4+lat*r/2))}}
function heatDensity(x,y,points,sigma){let sum=0;const limit=9*sigma*sigma;for(const p of points){const d=(x-p.x)**2+(y-p.y)**2;if(d<=limit)sum+=Math.exp(-d/(2*sigma*sigma))}return sum}
function heatNormalization(branches,sigma){if(!branches.length)return 1;const key=sigma+'|'+branches.map(b=>b.lat.toFixed(6)+','+b.lon.toFixed(6)).sort().join(';');if(heatPeakCache.has(key))return heatPeakCache.get(key);const points=branches.map(b=>heatXY(b.lat,b.lon)),step=sigma/3,minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));let max=1;for(const p of points)max=Math.max(max,heatDensity(p.x,p.y,points,sigma));for(let x=minX;x<=maxX;x+=step)for(let y=minY;y<=maxY;y+=step)max=Math.max(max,heatDensity(x,y,points,sigma));heatPeakCache.set(key,max);return max}
function heatColor(t){t=Math.max(0,Math.min(1,t));if(t<.015)return[255,235,0,0];const stops=[[0,[255,245,0]],[.35,[255,211,0]],[.65,[255,134,0]],[.85,[255,68,0]],[1,[245,22,0]]];let i=0;while(i<stops.length-2&&t>stops[i+1][0])i++;const [a,ca]=stops[i],[b,cb]=stops[i+1],f=(t-a)/(b-a);return[...ca.map((v,k)=>Math.round(v+(cb[k]-v)*f)),Math.round(225*Math.min(1,(t-.015)/.08)*Math.pow(t,.3))]}
function createSmoothHeat(){
 const layer=L.layerGroup();
 layer.setData=function(branches,sigma){
  this.clearLayers();branches=branches.filter(b=>Number.isFinite(b.lat)&&Number.isFinite(b.lon));
  if(!branches.length)return this;
  sigma=Number.isFinite(sigma)&&sigma>0?sigma:1000;
  const points=branches.map(b=>heatXY(b.lat,b.lon)),pad=sigma*3;
  const left=Math.min(...points.map(p=>p.x))-pad,right=Math.max(...points.map(p=>p.x))+pad,top=Math.max(...points.map(p=>p.y))+pad,bottom=Math.min(...points.map(p=>p.y))-pad;
  const step=Math.max(sigma/12,(right-left)/800,(top-bottom)/800),w=Math.ceil((right-left)/step),h=Math.ceil((top-bottom)/step),field=new Float32Array(w*h),cut=pad/step,den=2*(sigma/step)**2;
  for(const p of points){const cx=(p.x-left)/step,cy=(top-p.y)/step;for(let y=Math.max(0,Math.floor(cy-cut));y<=Math.min(h-1,Math.ceil(cy+cut));y++)for(let x=Math.max(0,Math.floor(cx-cut));x<=Math.min(w-1,Math.ceil(cx+cut));x++){const d=(x+.5-cx)**2+(y+.5-cy)**2;if(d<=cut*cut)field[y*w+x]+=Math.exp(-d/den)}}
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(w,h),peak=heatNormalization(branches,sigma);
  for(let i=0;i<field.length;i++)pixels.data.set(heatColor(field[i]/peak),i*4);ctx.putImageData(pixels,0,0);
  const lat=y=>(2*Math.atan(Math.exp(y/HEAT_METERS))-Math.PI/2)*180/Math.PI,lon=x=>x/HEAT_METERS*180/Math.PI;
  L.imageOverlay(canvas.toDataURL('image/png'),[[lat(top-h*step),lon(left)],[lat(top),lon(left+w*step)]],{pane:'radarHeatPane',interactive:false,opacity:.8,alt:'Concentración suavizada de locales'}).addTo(this);
  return this;
 };return layer;
}
