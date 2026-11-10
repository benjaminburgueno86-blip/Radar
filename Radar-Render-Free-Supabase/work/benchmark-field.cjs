(function (root) {
  const text = (value, limit = 150) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  const number = (value, max, integer = false) => {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const raw = String(value).trim().replace(',', '.');
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
    const n = Number(raw);
    return n <= max && (!integer || Number.isInteger(n)) ? n : null;
  };
  const cents = n => n === null ? null : Math.round(n * 100);

  function identity(competitor) {
    return [competitor.name, competitor.website, competitor.social].join('|');
  }

  function normalize(raw, competitors) {
    const rivals = competitors.map((competitor, i) => {
      const record = raw?.rivals?.[i];
      const key = identity(competitor);
      return { key, source: record?.key === key ? text(record.source, 250) : '' };
    });
    const items = Array.isArray(raw?.items) ? raw.items.slice(0, 12) : [{}];
    const data = Array.isArray(raw?.trials) ? raw.trials : [];
    const day = text(raw?.day, 10);
    const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(day) : NaN;
    return {
      day: Number.isFinite(timestamp) && timestamp <= Date.now() && new Date(timestamp).toISOString().slice(0, 10) === day ? day : '',
      method: text(raw?.method, 250),
      target: number(raw?.target, 99.99),
      protocol: text(raw?.protocol, 250),
      rivals,
      items: items.map(item => ({
        name: text(item?.name, 180), code: text(item?.code, 14), qty: number(item?.qty, 999, true),
        price: number(item?.price, 10000000), cost: number(item?.cost, 10000000),
        rivals: rivals.map(({ key }, i) => {
          if (raw?.rivals?.[i]?.key !== key) return null;
          const value = item?.rivals?.[i];
          const quote = number(value, 10000000);
          return text(value).toLowerCase() === 'agotado' ? 'agotado' : quote > 0 ? quote : null;
        }),
      })),
      trials: [null, ...rivals].map((rival, i) => {
        const trial = data[i];
        if (rival && raw?.rivals?.[i - 1]?.key !== rival.key) return {};
        const attempts = number(trial?.attempts, 1000, true);
        const completed = number(trial?.completed, attempts ?? 0, true);
        return { attempts, completed, minutes: completed > 0 ? number(trial?.minutes, 1440) : null };
      }),
    };
  }

  function compare(data) {
    const items = data.items.filter(item => item.name && item.qty > 0);
    const basketReady = items.length > 0 && items.length === data.items.length;
    const total = (read, valid) => basketReady && items.every(item => valid(read(item)))
      ? items.reduce((sum, item) => sum + cents(read(item)) * item.qty, 0) : null;
    const own = total(item => item.price, price => price > 0);
    const cost = total(item => item.cost, cost => cost !== null);
    const results = data.rivals.map((rival, i) => ({
      known: data.day && data.method && rival.source ? items.filter(item => item.rivals[i] !== null).length : 0,
      out: data.day && data.method && rival.source ? items.filter(item => item.rivals[i] === 'agotado').length : 0,
      total: data.day && data.method && rival.source
        ? total(item => item.rivals[i], price => price > 0) : null,
    }));
    const comparable = results.filter(row => row.total !== null);
    const best = comparable.length ? Math.min(...comparable.map(row => row.total)) : null;
    const margin = (price, costs) => price !== null && costs !== null ? (price - costs) / price * 100 : null;
    const floor = cost !== null && data.target !== null ? Math.ceil(cost * 100 / (100 - data.target) - 1e-8) : null;
    return { items, own, cost, results, best, floor, margin: margin(own, cost), match: margin(best, cost) };
  }

  const api = { normalize, compare };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FieldBenchmark = api;
})(globalThis);
