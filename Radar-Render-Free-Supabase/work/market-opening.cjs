(function(root){
  const M=typeof module!=='undefined'&&module.exports?require('./market-intelligence.cjs'):root.MarketIntelligence;
  const key=value=>M.gtin(value)||M.productKey(value,'sipc');
  const money=value=>Math.round(value*100)/100;
  function normalize(input) {
    if(!Array.isArray(input))return [];
    const clean=new Map();
    for(const item of input.slice(0,24)){
      const code=key(item?.code),qty=Number(item?.qty),cost=item?.cost==null||item.cost===''?null:Number(item.cost);
      if(!code||!Number.isInteger(qty)||qty<1||qty>99)continue;
      clean.set(code,{code,qty,cost:Number.isFinite(cost)&&cost>=0&&cost<=10000000?cost:null});
    }
    return [...clean.values()];
  }
  function compare(report,items,target) {
    const products=new Map(report.products.map(p=>[p.code,p]));
    const lines=items.map(item=>{
      const product=products.get(item.code),cost=item.cost??product?.cost??null;
      const floor=cost===null?null:Math.ceil(cost*100/(1-target/100)-1e-8)/100;
      return {...item,product,cost,floor,canMatch:floor===null||!product?null:floor<=product.min};
    });
    const stores=report.stores.map(store=>{
      const quotes=lines.map(line=>line.product?.quotes.find(q=>q.store===store.store));
      const missing=lines.filter((_,i)=>!quotes[i]);
      const total=lines.length&&!missing.length?money(quotes.reduce((sum,q,i)=>sum+q.price*lines[i].qty,0)):null;
      return {...store,total,missing,quotes};
    });
    const complete=stores.filter(s=>s.total!==null).sort((a,b)=>a.total-b.total||a.branch.localeCompare(b.branch));
    const spread=complete.length>=2?lines.map((line,i)=>({line,difference:money((complete.at(-1).quotes[i].price-complete[0].quotes[i].price)*line.qty)}))
      .filter(row=>row.difference>0).sort((a,b)=>b.difference-a.difference):[];
    return {lines,complete,incomplete:stores.filter(s=>s.total===null),spread};
  }
  function actions(products,basket) {
    const chosen=basket.lines.map(line=>line.product).filter(Boolean);
    const pool=chosen.length?chosen:products;
    const gap=[...pool].sort((a,b)=>b.gap-a.gap||b.quotes.length-a.quotes.length)[0];
    const trial=[...pool].sort((a,b)=>b.quotes.length-a.quotes.length||a.gap-b.gap).find(p=>p!==gap)||gap;
    const missing=basket.incomplete.find(store=>store.missing.length<basket.lines.length)||basket.incomplete[0];
    const confirm=missing?.missing[0]||basket.lines.find(line=>line.cost===null);
    return {gap,trial,missing,confirm};
  }
  function suggested(products) {
    const pairs=new Map();
    for(const product of products){
      const stores=product.quotes.map(q=>q.store).sort();
      for(let i=0;i<stores.length;i++)for(let j=i+1;j<stores.length;j++){
        const key=JSON.stringify([stores[i],stores[j]]);
        if(!pairs.has(key))pairs.set(key,[]);
        pairs.get(key).push(product.code);
      }
    }
    const shared=[...pairs.values()].sort((a,b)=>b.length-a.length)[0]||[];
    return shared.slice(0,5);
  }
  function reference(data) {
    const places=Object.entries(data.place).map(([id,[name,store,address,neighborhood,lat,lon]])=>({
      id:'sipc-'+id,storeId:'sipc-'+id,store:store==='Sin Cadena'?name:store,name,address,neighborhood,lat,lon,source:data.source,
    }));
    const byId=new Map(places.map(place=>[place.id,place]));
    const observations=data.observations.flatMap(([day,branch,product,price])=>{
      const place=byId.get('sipc-'+branch),item=data.catalog[product];
      return place&&item?[{product:'sipc:'+product,name:item[0],brand:item[1],price,store:place.id,scope:'sipc',
        branch:place.name,checked:day+'T00:00:00-03:00',declared:true,url:data.source}]:[];
    });
    return {places,observations};
  }
  const api={key,normalize,compare,actions,suggested,reference};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.MarketOpening=api;
})(globalThis);
