const assert = require('node:assert/strict');
const fs = require('node:fs');
const M = require('./market-intelligence.cjs');
const S = require('./market-strategy.cjs');
const R = require('./market-report.cjs');

const source = JSON.parse(fs.readFileSync('outputs/datos-gondolupa.json', 'utf8'));
const now = Date.parse('2026-11-09T15:00:00Z');
const report = M.analyze(source.observations, { now });
assert.equal(report.count, 216);
assert.equal(report.latest, '2026-10-26');
assert.equal(report.period, '2026-10-20|source-branch');
assert.equal(report.products.length, 26);
assert.equal(report.common, 7);
assert.deepEqual(report.stores.map(s => [s.store, s.commonTotal]), [['devoto', 660], ['disco', 660], ['frog', 654]]);
assert(report.conflicts.includes('07622210659460'));
assert(!report.products.some(p => p.code === '07622210659460'));
assert.equal(M.analyze(source.observations, { now, period: '2026-10-20|online' }).products.length, 0);

const code = '07622300841461';
const oreo = report.products.find(p => p.code === code);
assert.equal(oreo.min, 40);
assert.equal(oreo.max, 50);
assert.equal(oreo.median, 40);
assert.equal(oreo.average, 130 / 3);
assert.equal(oreo.gap, 25);
assert.deepEqual(oreo.quotes.map(q => q.unitPrice), [800, 800, 1000]);
assert.equal(oreo.points, 47);
assert(oreo.quotes.every(q=>q.freshness==='desactualizado'));
assert.equal(report.recentProducts,0);
assert(M.analyze(source.observations,{now,recentHours:600,staleHours:720,period:report.period})
  .products.find(p=>p.code===code).quotes.every(q=>q.freshness==='reciente'));
assert.deepEqual(M.analyze([...source.observations].reverse(), { now }), report);
for (const product of report.products) for (const quote of product.quotes) {
  assert(source.observations.some(o => M.gtin(o.product) === product.code && o.checked === quote.checked &&
    o.store === quote.store && o.price === quote.price && o.url === quote.url && o.available === 1));
}

const ownItem = { code: code.slice(1), name: 'Galletitas Mini Oreo 50 g', price: 49, cost: 31 };
const evaluate = (item, target = 25) => M.analyze(source.observations, { now, target, ownItems: [item] }).products.find(p => p.code === code);
const feasible = evaluate(ownItem);
assert.equal(feasible.floor, 41.34);
assert.equal(feasible.suggested, 41.34);
assert(feasible.suggestedMargin >= 25);
assert(feasible.marketMargin < 25);
assert(feasible.suggestedMarkup > feasible.suggestedMargin);
assert(feasible.points > oreo.points);
const blocked = evaluate({ ...ownItem, cost: 51 });
assert.equal(blocked.suggested, null);
assert(blocked.marketMargin < 0);
assert.equal(evaluate({ ...ownItem, name: 'Galletitas Mini Oreo 150 g' }).cost, null);
assert.equal(evaluate({ ...ownItem, code: '11111111' }).cost, null);
assert.equal(M.gtin('07730197001193'), '07730197001193');
assert.equal(M.gtin('07730197001194'), '');
assert.deepEqual(M.measure('Agua 6 x 500 ml'), { unit: 'L', amount: 0.5, count: 6 });
assert.equal(M.measure('Pack 500 ml'), null);

const relevant = source.observations.filter(o => o.product === code && o.scope === 'source-branch');
const frog = relevant.find(o => o.store === 'frog');
const modified = M.analyze([...relevant, { ...frog, checked: '2026-10-20T22:00:00Z', price: 75 }], { now });
assert.equal(modified.products[0].gap, 87.5);
assert(modified.products[0].points > oreo.points);
const unavailable = M.analyze([...relevant, { ...frog, checked: '2026-10-20T22:00:00Z', available: 0 }], { now });
assert.equal(unavailable.products[0].quotes.length, 2);
assert.equal(unavailable.products[0].max, 40);
const conflictingBrand = M.analyze(relevant.map(o => o.store === 'frog' ? { ...o, name: 'Galletitas Mini OtraMarca 50 g' } : o), { now });
assert.equal(conflictingBrand.products.length, 0);

const plan = S.buildPlan(report, 'minimercado');
assert(plan.length >= 5 && plan.length <= 10);
assert(plan.every(action => action.codes.length && action.codes.every(code => report.products.some(p => p.code === code))));
assert(plan.every((a, i) => i === 0 || a.priority <= plan[i - 1].priority));
const names = { devoto: 'Devoto', disco: 'Disco', frog: 'Frog' };
const html = R.render(report, names, { format: 'minimercado' });
assert(html.includes('market-bar-track') && html.includes('<table>') && html.includes('market-plan'));
assert(html.includes(oreo.quotes[0].url));
assert(R.render(M.analyze([], { now }), names).includes('Información insuficiente'));
console.log('OK: registros originales, códigos y presentación, fechas, sucursal, stock, brecha, precio unitario, mediana, márgenes, puntuación, plan y cambios de entrada.');
