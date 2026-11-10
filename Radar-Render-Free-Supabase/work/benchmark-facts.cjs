const { createHash } = require('node:crypto');

const usefulLink = /env[ií]os?|entregas?|retiro|click.?and.?go|click.?go|delivery|sucursales|locales|preguntas.frecuentes|faq|promociones|medios.de.pago|shipping|stores/i;
const officialPages = {
  'kinko.com.uy': ['https://kinko.com.uy/locales'],
  'tiendainglesa.com.uy': ['https://callback.tiendainglesa.com.uy/supermercado/landing/envios/38'],
  'tata.com.uy': ['https://www.tata.com.uy/lp/preguntas-frecuentes'],
};
const rules = [
  ['compra', 'Costo y condiciones de entrega', /(?=.*(?:env[ií]o|entrega|delivery|despacho|domicilio))(?=.*(?:\$\s*\d|(?:sin costo|gratuit[oa]|gratis|m[ií]nimo)|(?:\d+|mismo)\s+d[ií]as?))/i],
  ['compra', 'Modalidad de retiro', /(?=.*(?:retiro|retir[aá]|retiral[oa]|pickup|click\s*&\s*go))(?=.*(?:sin costo|gratis|sucursal|pedido|horario|seleccion[aá]))/i],
  ['confianza', 'Dirección publicada', /\b(?:av\.|avenida|calle|bvar\.|br\.|rambla|esq\.|local\s+\d)[\s\S]{3,110}\b\d{2,5}\b|\b[A-ZÁÉÍÓÚ][\p{L} ]{3,45}\s\d{3,5},?\s+esq\./u],
  ['confianza', 'Horario publicado', /(?=.*(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|horario|abierto))(?=.*(?:\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(?:hs?\.?\b|horas?\b)|24\s*\/\s*7))/i],
  ['promociones', 'Beneficio publicado', /(?=.*(?:descuento|ahorr[aá]|beneficio|reintegro|promo|off))(?=.*\b\d{1,3}\s*%)/i],
  ['compra', 'Pedido por mensajería', /(?=.*(?:whatsapp|wa\.me))(?=.*(?:pedido|compr[aá]|retir|encarg))/i],
];

function clean(value) {
  return value.replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, key) => {
      if (key[0] === '#') {
        const code = /^#x/i.test(key) ? parseInt(key.slice(2), 16) : Number(key.slice(1));
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
      }
      return { amp: '&', nbsp: ' ', quot: '"', apos: "'", ndash: '–', aacute: 'á', eacute: 'é',
        iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ' }[key] ?? entity;
    })
    .replace(/\s+/g, ' ').trim();
}

function relevantLinks(page, website) {
  const root = new URL(website).hostname.replace(/^www\./, '');
  const links = new Map();
  for (const [, raw, label] of page.html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const link = new URL(raw.replace(/&amp;/g, '&'), page.url);
      if (!['http:', 'https:'].includes(link.protocol) || link.username || link.password || link.port ||
          !(link.hostname === root || link.hostname.endsWith('.' + root))) continue;
      link.hash = '';
      const path = decodeURIComponent(link.pathname);
      if (link.href === page.url || !usefulLink.test(path + ' ' + clean(label))) continue;
      const score = /env[ií]os?|preguntas.frecuentes|faq|sucursales|\/locales/i.test(path) ? 2 : 1;
      links.set(link.href, score);
    } catch {}
  }
  return [...links].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([url]) => url);
}

function factsFromPage(page, channel) {
  const content = page.html
    .replace(/<(script|style|noscript|svg|template|header|nav)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/(?:td|th)\s*>/gi, ' | ')
    .replace(/<\/(?:tr|li|p|div|h[1-6]|section)\s*>|<br\b[^>]*>/gi, '\n');
  const description = [...page.html.matchAll(/<meta\b[^>]*>/gi)]
    .find(([tag]) => /(?:name|property)\s*=\s*["'](?:description|og:description)["']/i.test(tag))?.[0]
    .match(/\bcontent\s*=\s*(["'])(.*?)\1/i)?.[2] || '';
  const deliveryTable = [];
  if (channel === 'web') {
    for (const [table] of page.html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
      if (!/(?:zona|alcance)/i.test(table) || !/costo|tarifa/i.test(table)) continue;
      for (const [row] of table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)) {
        const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(([, cell]) => clean(cell));
        if (cells.length >= 2 && cells[0] && cells.some(cell => /\$\s*\d/.test(cell))) {
          deliveryTable.push('Envío publicado · ' + cells.filter(Boolean).join(' · '));
        }
      }
    }
  }
  const parts = (channel === 'redes' ? [description] : [...deliveryTable, ...content.split('\n')]).map(clean);
  const facts = [];
  for (const part of parts) {
    if (part.length < 15 || part.length > 360) continue;
    const text = part.replace(/\s*\|\s*$/, '');
    const match = rules.find(([, , pattern]) => pattern.test(text));
    if (!match) continue;
    const [category, title] = match;
    facts.push({ category: channel === 'redes' ? 'redes' : category, title, observation: text });
  }
  return facts;
}

function observationId(competitor, url, fact, date) {
  return 'Dato_' + createHash('sha256')
    .update(JSON.stringify([competitor.id, url, fact.category, fact.observation, date])).digest('hex').slice(0, 20);
}

async function collectFacts(study, date, getPage) {
  const read = async url => {
    try { return await getPage(url, AbortSignal.timeout(10000)); } catch { return null; }
  };
  const reports = await Promise.all(study.competitors.map(async competitor => {
    const [home, social] = await Promise.all([read(competitor.website), read(competitor.social)]);
    const domain = new URL(competitor.website).hostname.replace(/^(?:www|callback)\./, '');
    const links = [...new Set([...(officialPages[domain] || []), ...(home ? relevantLinks(home, competitor.website) : [])])]
      .filter(url => url !== home?.url).slice(0, 4);
    const extra = await Promise.all(links.map(read));
    const pages = [...extra.filter(Boolean).map(page => [page, 'web']), ...(home ? [[home, 'web']] : []),
      ...(social ? [[social, 'redes']] : [])];
    const evidence = new Map();
    for (const [page, channel] of pages) {
      for (const fact of factsFromPage(page, channel)) {
        if ([...evidence.values()].filter(e => e.title === fact.title && e.channel === channel).length >= 3) continue;
        const id = observationId(competitor, page.url, fact, date);
        if ([...evidence.values()].some(e => e.observation === fact.observation)) continue;
        evidence.set(id, { ...fact, id, competitorId: competitor.id, channel, status: 'observado', date, url: page.url });
      }
    }
    return { competitorId: competitor.id, checked: pages.length, evidence: [...evidence.values()] };
  }));
  return { checks: reports.map(({ competitorId, checked }) => ({ competitorId, checked })),
    evidence: reports.flatMap(report => report.evidence) };
}

module.exports = { collectFacts, factsFromPage };
