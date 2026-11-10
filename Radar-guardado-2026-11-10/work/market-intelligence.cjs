(function (root) {
  const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Montevideo' });
  const money = n => Math.round(n * 100 + 1e-8) / 100;
  const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const plain = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const group = (rows, key) => {
    const groups = new Map();
    for (const row of rows) {
      const id = key(row);
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(row);
    }
    return groups;
  };

  function gtin(value) {
    const code = String(value ?? '').trim();
    if (!/^(?:\d{8}|\d{12,14})$/.test(code) || /^0+$/.test(code)) return '';
    const digits = [...code].reverse().map(Number);
    return digits.reduce((sum, n, i) => sum + n * (i % 2 ? 3 : 1), 0) % 10 === 0
      ? code.padStart(14, '0') : '';
  }

  function productKey(value, scope) {
    return scope === 'sipc' ? (/^sipc:[1-9]\d{0,6}$/.test(value) ? value : '') : gtin(value);
  }

  function measure(name) {
    const label = plain(name);
    const re = /(\d+(?:[.,]\d+)?)\s*(kilogramos?|kg|gramos?|grs?|g|mililitros?|ml|litros?|lts?|l|unidades?|unds?|un)\b/g;
    const matches = [...label.matchAll(re)];
    if (matches.length !== 1) return null;
    const [matched, value, unit] = matches[0];
    const before = label.slice(0, matches[0].index);
    const after = label.slice(matches[0].index + matched.length);
    const times = before.match(/(\d+)\s*[x×]\s*$/)?.[1] ?? after.match(/^\s*[x×]\s*(\d+)\b/)?.[1];
    const count = Number(times ?? 1);
    const n = Number(value.replace(',', '.'));
    if (!n || !count || (!times && /\b(?:pack|multipack)\b/.test(label))) return null;
    if (/^(kg|kilo)/.test(unit)) return { unit: 'kg', amount: n, count };
    if (/^g/.test(unit)) return { unit: 'kg', amount: n / 1000, count };
    if (/^(ml|mili)/.test(unit)) return { unit: 'L', amount: n / 1000, count };
    if (/^l/.test(unit)) return { unit: 'L', amount: n, count };
    return { unit: 'unidad', amount: n, count };
  }

  function category(name) {
    const s = plain(name);
    if (/\b(?:sprite|coca.cola|refresco|gaseosa|jugo|agua|bebida|cerveza)\b/.test(s)) return 'Bebidas';
    if (/\b(?:galletas?|galletitas?|oreo|alfajor(?:es)?|bizcochos?|chocolate)\b/.test(s)) return 'Galletas y dulces';
    if (/\b(?:leche|yogur|yogurt|queso|manteca)\b/.test(s)) return 'Lácteos';
    if (/\b(?:yerba|arroz|fideos|harina|aceite|azucar|sal|cafe|conserva|atun|te)\b/.test(s)) return 'Almacén';
    if (/\b(?:detergente|lavandina|jabon|papel higienico|limpiador)\b/.test(s)) return 'Limpieza e higiene';
    return 'Sin clasificar';
  }

  function brand(name) {
    const brands = ['Coca-Cola', 'Oreo', 'Sprite', 'Canarias', 'Gatorade', 'Axion', 'Jimo', 'Protergente', 'Epidor', 'Duracell'];
    return brands.find(value => plain(name).split(/[^a-z0-9-]+/).includes(plain(value))) || '';
  }

  function compatible(quotes) {
    const presentations = quotes.map(row => measure(row.name));
    const known = presentations.filter(Boolean);
    if (new Set(known.map(p => [p.unit, p.amount, p.count].join('|'))).size > 1) return false;
    const labels = quotes.map(row => plain(row.name));
    if (labels.some(s => /\b(?:no retornable|descartable)\b/.test(s)) &&
      labels.some(s => /\bretornable\b/.test(s) && !/\bno retornable\b/.test(s))) return false;
    const qualifiers = labels.map(label => new Set((label.match(/[a-z]+/g) || []).filter(word =>
      !/^(?:de|al|en|con|la|las|el|los|y|x|g|grs?|gramos?|kg|kilogramos?|l|lts?|litros?|ml|mililitros?|unds?|un(?:idad(?:es)?)?|retornable|no|descartable|galletas?|galletitas?|refrescos?|gaseosas?|bebidas?)$/.test(word))));
    return qualifiers.every((a, i) => qualifiers.slice(i + 1).every(b => {
      const [small, large] = a.size <= b.size ? [a, b] : [b, a];
      return [...small].every(word => large.has(word));
    }));
  }

  function validRows(observations, now) {
    return observations.flatMap(row => {
      if (!row || !row.store || !row.branch || !row.name || !['source-branch', 'online', 'sipc'].includes(row.scope)) return [];
      const timestamp = Date.parse(row.checked);
      if (!Number.isFinite(timestamp) || timestamp > now) return [];
      return [{ ...row, timestamp, day: dayFormat.format(timestamp), code: productKey(row.product,row.scope) }];
    });
  }

  function isQuote(row) {
    const eligible = row.scope === 'sipc' ? row.declared === true : row.available === 1;
    return eligible && Number.isFinite(row.price) && row.price > 0 &&
      typeof row.url === 'string' && /^https?:\/\/[^/\s]+/i.test(row.url);
  }

  function snapshot(rows, branches = {}) {
    const contexts = [...group(rows, row => row.store)].map(([store, quotes]) => {
      const options = [...group(quotes, row => row.branch)].map(([name, obs]) => {
        const newest = [...group(obs.filter(r => r.code && !r.promotion), row => row.code)].flatMap(([, items]) => {
          const last = Math.max(...items.map(r => r.timestamp));
          const tied = items.filter(r => r.timestamp === last);
          if (new Set(tied.map(r => JSON.stringify([r.price, r.available, r.name]))).size > 1) return [];
          return [tied.sort((a, b) => a.url.localeCompare(b.url))[0]];
        });
        const eligible = newest.filter(isQuote);
        return { name, quotes: eligible, codes: eligible.length };
      }).sort((a, b) => b.codes - a.codes || a.name.localeCompare(b.name));
      const branch = options.find(b => b.name === branches[store]) || options[0];
      return { store, branch: branch.name, options: options.map(({ name, codes }) => ({ name, codes })), quotes: branch.quotes };
    }).sort((a, b) => a.store.localeCompare(b.store));
    const eligible = contexts.flatMap(c => c.quotes);
    const conflicts = [];
    const products = [...group(eligible, row => row.code)].flatMap(([code, quotes]) => {
      if (quotes.length < 2) return [];
      if (!compatible(quotes)) { conflicts.push(code); return []; }
      quotes.sort((a, b) => a.price - b.price || a.store.localeCompare(b.store));
      const prices = quotes.map(row => row.price);
      const min = prices[0], max = prices.at(-1);
      const measurement = quotes.map(q => measure(q.name)).find(Boolean);
      const name = quotes[0].name;
      return [{
        code, name, brand: quotes[0].brand || brand(name), category: quotes[0].category || category(name), min, max, measurement,
        explicitSize: quotes.filter(q => measure(q.name)).length,
        average: prices.reduce((sum, price) => sum + price, 0) / prices.length,
        median: median(prices), gap: (max - min) / min * 100,
        quotes: quotes.map(({ store, branch, price, checked, url, promotion }) => ({
          store, branch, price, checked, url, promotion: promotion || '',
          unitPrice: measurement ? price / (measurement.amount * measurement.count) : null,
        })),
      }];
    });
    return { contexts, products, conflicts, eligible: eligible.length };
  }

  function evaluate(product, own, target, age, storeCount) {
    const cost = own?.cost;
    const price = own?.price;
    const hasCost = Number.isFinite(cost) && cost >= 0;
    const hasTarget = Number.isFinite(target) && target >= 0 && target < 100;
    const margin = p => hasCost && p > 0 ? (p - cost) / p * 100 : null;
    const floor = hasCost && hasTarget ? Math.ceil(cost * 100 / (1 - target / 100) - 1e-8) / 100 : null;
    const suggested = floor !== null && floor <= product.max ? Math.max(product.min, floor) : null;
    const score = {
      dispersion: 30 * Math.min(1, product.gap / 50),
      coverage: 20 * product.quotes.length / storeCount,
      quality: 5 * product.explicitSize / product.quotes.length,
      freshness: 20 * Math.max(0, 1 - age / 30),
      price: floor !== null ? floor <= product.min ? 10 : floor <= product.median ? 5 : 0 : null,
      margin: floor !== null ? margin(product.min) >= target - 1e-8 ? 15 : margin(product.max) >= target - 1e-8 ? 7 : 0 : null,
    };
    return { ...product, ownPrice: price ?? null, cost: hasCost ? cost : null, target: hasTarget ? target : null,
      ownMargin: margin(price), marketMargin: margin(product.min), floor, suggested, suggestedMargin: margin(suggested),
      suggestedMarkup: suggested && cost > 0 ? (suggested - cost) / cost * 100 : null,
      score, points: Math.round(Object.values(score).reduce((sum, value) => sum + (value ?? 0), 0)) };
  }

  function analyze(observations, options = {}) {
    const now = options.now ?? Date.now();
    const recentHours = options.recentHours ?? 24;
    const staleHours = options.staleHours ?? 48;
    const rows = validRows(observations, now);
    const snapshots = [...group(rows, row => row.day + '|' + row.scope)].map(([id, records]) => {
      const [day, scope] = id.split('|');
      return { id, day, scope, records, comparable: snapshot(records).products.length };
    }).sort((a, b) => b.day.localeCompare(a.day) || b.comparable - a.comparable || a.scope.localeCompare(b.scope));
    const recent = snapshots.filter(s => s.records.some(row => now - row.timestamp <= recentHours * 3600000));
    const selected = snapshots.find(s => s.id === options.period) || recent.find(s => s.comparable > 0) ||
      recent[0] || snapshots.find(s => s.comparable > 0) || snapshots[0];
    const view = snapshot(selected?.records ?? [], options.branches);
    const age = selected ? Math.round((Date.parse(dayFormat.format(now)) - Date.parse(selected.day)) / 86400000) : null;
    const ownItems = group((options.ownItems ?? []).map(item => ({ ...item, code: gtin(item.code) })).filter(item => item.code), item => item.code);
    const usedOwn = new Set();
    const products = view.products.map(product => {
      const candidates = ownItems.get(product.code);
      const candidate = candidates?.length === 1 ? candidates[0] : undefined;
      const own = candidate && (!candidate.name || compatible([product, candidate])) ? candidate : undefined;
      if (own) usedOwn.add(product.code);
      return evaluate(product, own, options.target, age, view.contexts.length);
    }).sort((a, b) => b.points - a.points || b.gap - a.gap || a.code.localeCompare(b.code));
    const categories = [...group(products, p => p.category)].map(([name, list]) => ({
      name, count: list.length, medianGap: median(list.map(p => p.gap)),
      maxGap: Math.max(...list.map(p => p.gap)),
      full: list.filter(p => p.quotes.length === view.contexts.length).length,
    })).sort((a, b) => b.medianGap - a.medianGap || b.maxGap - a.maxGap || a.name.localeCompare(b.name));
    const freshness = checked => {
      const hours = (now - Date.parse(checked)) / 3600000;
      return hours <= recentHours ? 'reciente' : hours <= staleHours ? 'con antigüedad' : 'desactualizado';
    };
    for (const p of products) for (const q of p.quotes) q.freshness = freshness(q.checked);
    const latestByStore = [...group(rows, row => row.store)].map(([store, obs]) => ({
      store, checked: new Date(Math.max(...obs.map(row => row.timestamp))).toISOString(),
      products: new Set(obs.filter(r => isQuote(r) && now - r.timestamp <= recentHours * 3600000).map(r => r.code || r.product)).size,
    })).sort((a,b) => a.store.localeCompare(b.store));
    const stores = view.contexts.map(({ store, branch, options }) => {
      const quotes = products.flatMap(p => p.quotes.filter(q => q.store === store).map(q => ({ q, p })));
      return { store, branch, options, comparable: quotes.length, minima: quotes.filter(({ p, q }) => q.price === p.min).length,
        commonMinima: quotes.filter(({ p, q }) => p.quotes.length === view.contexts.length && q.price === p.min).length,
        commonTotal: money(quotes.filter(({ p }) => p.quotes.length === view.contexts.length).reduce((sum, { q }) => sum + q.price, 0)) };
    });
    return { products, categories, stores, age, conflicts: view.conflicts, eligible: view.eligible,
      generatedAt: new Date(now).toISOString(), recentHours, staleHours, latestByStore,
      recentProducts: products.filter(p => p.quotes.every(q => q.freshness === 'reciente')).length,
      count: observations.length, accepted: rows.length,
      storeIds: [...new Set(rows.map(row => row.store))].sort(),
      latest: snapshots[0]?.day ?? null, day: selected?.day ?? null, period: selected?.id ?? null,
      unverifiedCodes: selected?.records.filter(r => !r.code).length ?? 0,
      common: products.filter(p => p.quotes.length === view.contexts.length).length,
      unmatchedOwn: [...ownItems.keys()].filter(code => !usedOwn.has(code)).length,
      periods: snapshots.map(({ id, day, scope, comparable }) => ({ id, day, scope, comparable })),
    };
  }

  function history(observations, code, { from = '', to = '', now = Date.now() } = {}) {
    const rows = validRows(observations, now).filter(r => r.code === productKey(code,r.scope) && r.code && isQuote(r) &&
      (!from || r.day >= from) && (!to || r.day <= to));
    return [...group(rows, r => JSON.stringify([r.store,r.scope,r.branch,r.promotion || '']))].map(([key, all]) => {
      const [store, scope, branch, promotion] = JSON.parse(key);
      const points = [...all].sort((a,b)=>a.timestamp-b.timestamp || a.price-b.price);
      if (!compatible(points)) return null;
      let increases = 0, decreases = 0;
      for (let i=1;i<points.length;i++) {
        increases += Number(points[i].price > points[i-1].price);
        decreases += Number(points[i].price < points[i-1].price);
      }
      const first = points[0].price, last = points.at(-1).price;
      return { store, scope, branch, promotion, increases, decreases, change:last-first,
        percent:(last-first)/first*100, min:Math.min(...points.map(p=>p.price)), max:Math.max(...points.map(p=>p.price)), points };
    }).filter(Boolean);
  }

  const api = { analyze, gtin, productKey, measure, history, category, compatible };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MarketIntelligence = api;
})(globalThis);
