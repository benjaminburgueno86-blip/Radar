const { setTimeout: delay } = require('node:timers/promises');

const basket = [
  ['07730430002680', '/product/fideos-al-huevo-epidor-tirabuzones-400-g/345198'],
  ['07622300841461', '/product/galletitas-mini-oreo-50-g/742639'],
  ['07730197252960', '/product/refresco-sprite-1.5-l/591224'],
  ['07792170042005', '/product/bebida-gatorade-manzana-500-ml/571264'],
  ['07730377014395', '/product/detergente-axion-limon-640-ml/344916'],
  ['07730329024502', '/product/detergente-lavavajilla-protergente-500-ml/591029'],
  ['07622300864934', '/product/galletitas-oreo-regular-118-g/669767'],
  ['07622300848934', '/product/galletitas-mini-oreo-150-g/669296'],
  ['07790895000270', '/product/refresco-sprite-354-ml/590796'],
  ['07730197001452', '/product/refresco-sprite-600-ml/590464'],
  ['07730197008727', '/product/refresco-sprite-sin-azucar-1-l/590937'],
  ['07730377059167', '/product/detergente-concentrado-axion-1350-ml/344641'],
  ['07702010380747', '/product/detergente-crema-axion-450-g/591392'],
  ['07730377014388', '/product/detergente-axion-limon-1250-ml/344917'],
];

function pilotCatalogs() {
  return ['disco', 'devoto'].map(store => ({
    id: 'catalogo-piloto-' + store, store, host: 'www.' + store + '.com.uy', products: basket,
  }));
}

async function page(fetchFn, url, accept, limit) {
  const response = await fetchFn(url, {
    redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { Accept: accept, 'User-Agent': 'Gondolupa/1.0 (comparador de precios)' },
  });
  if (!response.ok) throw Object.assign(Error('La fuente respondió HTTP ' + response.status), {statusCode: response.status});
  const decoder = new TextDecoder();
  let bytes = 0, text = '';
  for await (const part of response.body) {
    bytes += part.length;
    if (bytes > limit) throw Error('La fuente superó el límite de lectura.');
    text += decoder.decode(part, {stream:true});
  }
  return text + decoder.decode();
}

function blocked(robots, path) {
  let applies = false, hasRules = false, longest = null;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim();
    const field = line.match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i);
    if (!field) continue;
    const key = field[1].toLowerCase(), value = field[2].trim();
    if (key === 'user-agent') {
      if (hasRules) applies = false;
      hasRules = false;
      applies ||= !!value && (value === '*' || 'gondolupa'.startsWith(value.toLowerCase()));
      continue;
    }
    hasRules = true;
    if (!applies || !value) continue;
    const pattern = value.replace(/\$$/, '').split('*')
      .map(part => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')).join('.*');
    if (!new RegExp('^' + pattern + (value.endsWith('$') ? '$' : '')).test(path)) continue;
    const length = value.replace(/[*$]/g, '').length;
    if (!longest || length > longest.length || length === longest.length && key === 'allow') longest = {length,key};
  }
  return longest?.key === 'disallow';
}

function regularPrice(html, uyPrice) {
  const section = html.match(/class="det-precios"[\s\S]*?(?=<div class="det-add"|<div class="det-desc")/)?.[0] || '';
  const plain = section.split(/(?=<div class="price(?:\s[^"]*)?")/)
    .filter(block => /^<div class="price"\s*>/.test(block))
    .map(block => uyPrice(block.match(/class="val">\s*([\d.,]+)/)?.[1]));
  return plain.length === 1 && plain[0] > 0 ? plain[0] : null;
}

async function readCatalog(feed, {fetchFn=fetch, clock=Date.now, pause=()=>delay(750)}={}) {
  const {parseProduct, stores} = await import('./service/gdu-catalog.mjs');
  const {uyPrice} = await import('./service/providers.mjs');
  const store = stores.find(row => row.id === feed.store && row.host === feed.host);
  if (!store) throw Error('La fuente de catálogo no está reconocida.');
  const origin = 'https://' + store.host;
  const robots = await page(fetchFn, origin + '/robots.txt', 'text/plain', 65536);
  if (!/^\s*user-agent\s*:/im.test(robots)) throw Error('La fuente no publicó reglas de acceso legibles.');
  const observations = [], issues = [];
  for (const [gtin, path] of feed.products) {
    if (blocked(robots,path)) {issues.push(gtin + ' restringido por robots.txt');continue;}
    try {
      const url = origin + path;
      const html = await page(fetchFn, url, 'text/html', 2*1024*1024);
      const offer = parseProduct(html, url, store);
      const price = regularPrice(html,uyPrice);
      if (offer.gtin !== gtin || offer.branch === 'Sucursal no informada' || offer.available === null || price !== offer.price)
        throw Error('El código, sucursal, disponibilidad o precio regular no se pudo confirmar.');
      observations.push({product:gtin,store:store.id,scope:'online',branch:offer.branch,name:offer.name,
        brand:offer.brand,price,currency:offer.currency,available:Number(offer.available),url,
        checked:new Date(clock()).toISOString()});
    } catch(error) {
      issues.push(gtin + ' · ' + (error.statusCode ? 'HTTP ' + error.statusCode : 'ficha no verificable'));
      if ([401,403,429].includes(error.statusCode)) break;
    }
    await pause();
  }
  return {observations,issues};
}

module.exports = {pilotCatalogs, readCatalog};
