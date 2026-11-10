(function (root) {
  const money = new Intl.NumberFormat('es-UY', { style: 'currency', currency: 'UYU', maximumFractionDigits: 2 });
  const pct = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 1 });
  const price = value => money.format(value);
  const percent = value => pct.format(value) + ' %';
  const retail = {
    almacén: 'una compra de reposición pequeña',
    minimercado: 'una compra de reposición de varias categorías',
    supermercado: 'una canasta semanal',
    conveniencia: 'una compra corta de consumo inmediato',
  };

  function opportunity(p) {
    const min = price(p.min), max = price(p.max);
    const evidence = min + ' a ' + max + ' en ' + p.quotes.length + ' comercios · brecha ' + percent(p.gap);
    if (p.floor !== null && p.suggested === null) return {
      evidence, status: 'Fuera del rango al margen objetivo',
      action: 'Negociá el costo o elegí otro producto. El piso de ' + price(p.floor) + ' supera el mayor precio relevado.',
      risk: 'Igualar el mínimo daría un margen bruto de ' + percent(p.marketMargin) + '.',
    };
    if (p.suggested !== null) return {
      evidence, status: p.suggested === p.min ? 'Igualar el mínimo es viable al costo ingresado' : 'Viable dentro del rango, por encima del mínimo',
      action: 'Evaluá ' + price(p.suggested) + ' tras confirmar vigencia. Al costo ingresado deja ' + percent(p.suggestedMargin) + ' de margen bruto.',
      risk: 'El margen excluye gastos fijos y no mide demanda. Confirmá canal, condiciones y precio antes del piloto.',
    };
    return {
      evidence, status: 'Hipótesis pendiente de costo y margen objetivo',
      action: 'Confirmá precios y condiciones de los extremos para este código. Pedí una cotización de la misma presentación.',
      risk: 'La dispersión puede deberse a una promoción, fecha o sucursal. La rentabilidad queda pendiente.',
    };
  }

  function buildPlan(report, format) {
    const { products, categories } = report;
    if (!products.length) return [];
    const plan = [];
    const add = (title, evidence, benefit, risk, impact, effort, metric, codes) =>
      plan.push({ title, evidence, benefit, risk, impact, effort, metric, codes, priority: impact * 2 + (4 - effort) });
    const byGap = [...products].sort((a, b) => b.gap - a.gap || a.code.localeCompare(b.code));
    const blocked = products.filter(p => p.floor !== null && p.suggested === null)
      .sort((a, b) => b.floor - b.max - (a.floor - a.max))[0];
    if (blocked) add('Renegociá el costo de ' + blocked.name, 'Piso ' + price(blocked.floor) + ' frente a máximo ' + price(blocked.max),
      'Evaluar si el producto puede entrar en el rango con el margen objetivo.', 'Una rebaja del proveedor puede exigir un volumen inviable.',
      3, 2, 'Costo cotizado, volumen mínimo y margen bruto recalculado.', [blocked.code]);
    for (const p of products.filter(item => item.gap >= 10 && item.code !== blocked?.code).slice(0, 3)) {
      const o = opportunity(p);
      add(p.suggested === null ? 'Cotizá ' + p.name : 'Probá el precio de ' + p.name, o.evidence,
        p.suggested === null ? 'Saber si la brecha justifica una prueba de precio.' : 'Medir si el precio candidato convierte sin sacrificar margen.',
        o.risk, p.gap >= 20 ? 3 : 2, p.suggested === null ? 1 : 2,
        p.suggested === null ? 'Cotización por código, cantidad mínima y fecha de vigencia.' : 'Unidades vendidas y margen bruto por unidad.', [p.code]);
    }
    const stable = [...byGap].reverse().find(p => p.gap <= 5);
    if (stable) add('Usá ' + stable.name + ' como referencia de precio', 'Brecha de ' + percent(stable.gap) + ' · ' + price(stable.min) + ' a ' + price(stable.max),
      'Evaluar precio, surtido y servicio sin descontar toda la compra.', 'La coincidencia de precios en la muestra no predice ventas.',
      2, 1, 'Precio final de la compra y margen del conjunto.', [stable.code]);
    const category = categories.find(c => c.count >= 2 && c.name !== 'Sin clasificar');
    if (category) add('Ensayá un surtido corto de ' + category.name, category.count + ' códigos · dispersión mediana ' + percent(category.medianGap),
      'Probar si esos productos encajan en ' + (retail[format] || 'la compra de tu público') + '.',
      'La dispersión mide precios, no rotación. Un surtido más grande puede inmovilizar capital.',
      2, 2, 'Unidades por código, rotación y faltantes del piloto.', products.filter(p => p.category === category.name).slice(0, 3).map(p => p.code));
    const missing = products.find(p => p.quotes.length < report.stores.length);
    if (missing) add('Completá el relevamiento de ' + missing.name, missing.quotes.length + ' de ' + report.stores.length + ' comercios con precio comparable',
      'Comprobar si el orden de precios se sostiene con más observaciones.', 'La falta de dato no equivale a falta de stock.',
      2, 1, 'Comercios con precio, presentación y condiciones verificadas.', [missing.code]);
    const promo = products.find(p => p.suggested !== null && p.suggested > p.floor);
    if (promo) add('Calculá el límite de una promoción para ' + promo.name,
      'Precio evaluado ' + price(promo.suggested) + ' · piso ' + price(promo.floor),
      'Establecer un descuento que respete el margen bruto objetivo.', 'Confirmá vigencia, costo de reposición y descuentos de otros canales.',
      2, 2, 'Margen bruto durante la prueba y unidades vendidas.', [promo.code]);
    return plan.sort((a, b) => b.priority - a.priority || a.effort - b.effort).slice(0, 8);
  }

  const api = { opportunity, buildPlan, price, percent };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MarketStrategy = api;
})(globalThis);
