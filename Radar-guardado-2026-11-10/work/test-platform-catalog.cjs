const assert = require('node:assert/strict');
const {pilotCatalogs,readCatalog} = require('./platform-catalog.cjs');
const {setup} = require('./platform-runtime.cjs');
const {analyze} = require('./market-intelligence.cjs');

async function main() {
  const fixed = Date.parse('2026-11-09T13:00:00Z');
  const feeds = pilotCatalogs();
  const [[code, productPath]] = feeds[0].products;
  const [otherCode, otherPath] = feeds[0].products[1];
  const fake = (code, price, plain = price) => '<div class="delivery-branch-button"><strong class="val">Sucursal de prueba</strong></div>'+
    '<script type="application/ld+json">'+JSON.stringify({'@type':'Product',gtin:code,name:'Fideos al huevo EPIDOR Tirabuzones 400 g',
      offers:{price,priceCurrency:'UYU',availability:'https://schema.org/InStock'}})+'</script>'+
    '<div class="det-precios"><div class="price"><span class="val">'+plain+'</span></div>'+
    '<div class="price dcto santander"><span class="val">35</span></div></div><div class="det-add">';
  const reads = [];
  const fetchFn = async (url,options) => {
    assert.equal(options.redirect,'error');
    const u=new URL(url);
    reads.push(u.pathname);
    if(u.pathname==='/robots.txt')return new Response('User-agent: *\nDisallow: '+otherPath);
    const price=u.hostname.includes('disco')?50:55;
    return new Response(fake(code,price));
  };
  const results=[];
  for(const feed of feeds)results.push(await readCatalog({...feed,products:[[code,productPath],[otherCode,otherPath]]},
    {fetchFn,clock:()=>fixed,pause:async()=>{}}));
  assert.deepEqual(reads,['/robots.txt',productPath,'/robots.txt',productPath]);
  assert(results.every(r=>r.issues.length===1));
  const offers=results.flatMap(r=>r.observations);
  assert.deepEqual(offers.map(r=>r.price),[50,55]);
  assert(offers.every(r=>r.scope==='online'&&r.checked==='2026-11-09T13:00:00.000Z'));
  const report=analyze(offers,{now:fixed});
  assert.equal(report.products.length,1);
  assert.equal(report.products[0].gap,10);
  const rejected=await readCatalog({...feeds[0],products:[[code,productPath]]},{
    fetchFn:async url=>new Response(url.endsWith('/robots.txt')?'User-agent: *':fake(code,50,60)),
    clock:()=>fixed,pause:async()=>{},
  });
  assert.equal(rejected.observations.length,0);
  assert.throws(()=>setup({database:':memory:',hosted:true,seedData:false,schedule:false,env:{GONDOLUPA_CATALOG_PILOT:'1'}}),
    /GONDOLUPA_CATALOG_PERMISSION/);
  console.log('OK: código, sucursal, robots, precio regular, canal y activación con autorización (datos de prueba).');
}

module.exports=main;
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
