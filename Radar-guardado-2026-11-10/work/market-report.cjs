(function (root) {
  const S = typeof module !== 'undefined' && module.exports ? require('./market-strategy.cjs') : root.MarketStrategy;
  const { price, percent } = S;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const sum = (label, body, open = false) => '<details class="market-detail"' + (open ? ' open' : '') + '><summary>' + label + '</summary>' + body + '</details>';
  const cash = value => value === null ? '—' : price(value);
  const stat = (label, value, note = '') => '<div class="market-stat"><small>' + label + '</small><strong>' + value + '</strong>' +
    (note ? '<small>' + note + '</small>' : '') + '</div>';

  function link(q, label) {
    let url;
    try { url = new URL(q.url); } catch { return esc(label); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return esc(label);
    return '<a target="_blank" rel="noopener noreferrer" href="' + esc(url.href) + '" title="' +
      esc(q.branch + ' · ' + (q.store.startsWith('sipc-')?q.checked.slice(0,10):q.checked)) + '">' + esc(label) + '</a>';
  }

  function render(report, names, options = {}) {
    const sipc=report.period?.endsWith('|sipc');
    const name = id => esc((sipc&&report.stores.find(s=>s.store===id)?.branch)||(Object.hasOwn(names, id) ? names[id] : id));
    const context = sipc?'Precios declarados al SIPC':report.period?.endsWith('|source-branch') ? 'Precios asociados a sucursal' : 'Catálogo online';
    const diagnostics = '<p class="market-coverage">' + context + ' · Base con ' + report.count + ' registros y ' + report.storeIds.length + ' comercios.</p><p class="mini">Generado ' +
      esc(new Intl.DateTimeFormat('es-UY',{dateStyle:'short',timeStyle:'short',timeZone:'America/Montevideo'}).format(new Date(report.generatedAt))) + '.</p>';
    if (!report.products.length) return diagnostics +
      '<div class="notice amber"><strong>Información insuficiente para comparar.</strong><p>Para este corte no hay precios disponibles del mismo código y presentación en al menos dos comercios. Elegí otro corte o incorporá observaciones compatibles.</p>' +
      (report.stores.length ? '<p>Comercios relevados en el corte · ' + report.stores.map(s => name(s.store)).join(', ') +
        '. Precios elegibles por separado · ' + report.eligible + '.</p>' : '') + '</div>';

    const selected = report.products.filter(p => !options.category || p.category === options.category);
    const byGap = [...selected].sort((a, b) => b.gap - a.gap || a.code.localeCompare(b.code));
    const sorted = options.sort === 'gap' ? byGap : options.sort === 'min'
      ? [...selected].sort((a, b) => a.min - b.min || a.code.localeCompare(b.code)) : selected;
    const top = byGap[0] || report.products[0];
    const benchmark = report.stores.filter(s => s.commonTotal > 0).sort((a, b) => a.commonTotal - b.commonTotal);
    const lowest = benchmark.filter(s => s.commonTotal === benchmark[0]?.commonTotal);
    const leader = lowest.length ? lowest.map(s => name(s.store)).join(', ') + ' · ' + price(lowest[0].commonTotal) : 'Sin canasta común';
    const summary = '<div class="market-stats">' +
      stat('Comercios comparados', String(report.stores.filter(s => s.comparable).length), report.stores.length + ' en el corte') +
      stat('Códigos comparables', String(report.products.length), report.common + ' en todos los comercios') +
      stat('Mayor brecha en la vista', percent(top.gap), esc(top.name)) +
      stat('Menor canasta común', leader, report.common ? '1 unidad por código · ' + report.common + ' productos' : '') +
      '</div>';
    const noOwn = !report.products.some(p => p.floor !== null);
    const risk = '<p class="market-warning">' + (noOwn
      ? '<strong>Rentabilidad pendiente.</strong> Agregá costo y margen objetivo en tu comparación con el mismo GTIN.'
      : '<strong>Margen bruto estimado.</strong> Los precios evaluados cubren el costo informado y excluyen gastos fijos.') + '</p>';
    const chart = '<figure class="market-chart"><figcaption><strong>' + esc(top.name) + '</strong> · ' + esc(top.code) +
      '</figcaption>' + top.quotes.map(q => '<div class="market-bar-row"><span>' + name(q.store) + '</span>' +
      '<div class="market-bar-track"><span style="width:' + (q.price / top.max * 100).toFixed(2) + '%"></span></div>' +
      link(q, price(q.price)) + '</div>').join('') + '</figure>';
    const opportunityRows = sorted.filter(p => p.gap >= 10 || p.floor !== null).slice(0, 5);
    const components = (p) => Object.entries(p.score).map(([k, v]) => ({
      dispersion: 'Brecha', coverage: 'Cobertura', quality: 'Presentación', freshness: 'Fecha de observación', price: 'Precio', margin: 'Margen',
    })[k] + ' ' + (v === null ? 'pendiente' : String(Math.round(v * 10) / 10))).join(' · ');
    const opportunityCards = opportunityRows.map(p => {
      const o = S.opportunity(p);
      return '<article class="market-opportunity"><div class="market-opportunity-head"><h4>' + esc(p.name) + '</h4>' +
        '<strong title="' + esc(components(p)) + '">' + p.points + '/100</strong></div><p><strong>' + esc(o.evidence) +
        '</strong> · diferencia ' + price(p.max-p.min) + ' · promedio ' + price(p.average) + ' · mediana ' + price(p.median) + '</p><div class="market-links">' +
        p.quotes.map(q => link(q, (names[q.store] || q.store) + ' ' + price(q.price))).join(' ') + '</div><p><b>' +
        esc(o.status) + '.</b> ' + esc(o.action) + '</p><small>' + esc(o.risk) + '</small><small>' + esc(components(p)) +
        '</small>'+(options.interactive?'<button class="quiet" type="button" data-market-product="'+p.code+'">Ver oportunidad</button>':'')+'</article>';
    }).join('');
    const table = '<div class="tablewrap market-table"><table><thead><tr><th>Producto exacto</th>' +
      report.stores.map(s => '<th>' + name(s.store) + '</th>').join('') +
      '<th>Mín.</th><th>Máx.</th><th>Prom.</th><th>Mediana</th><th>Brecha</th></tr></thead><tbody>' +
      sorted.map(p => '<tr id="market-code-' + p.code + '"><th scope="row">' + esc(p.name) + '<small>' +
        esc(p.code) + ' · ' + esc(p.category) + '</small></th>' + report.stores.map(s => {
          const q = p.quotes.find(quote => quote.store === s.store);
          return '<td>' + (q ? link(q, price(q.price)) + (q.unitPrice === null ? '' : '<small>' + price(q.unitPrice) +
            '/' + esc(p.measurement.unit) + '</small>') + (q.price > p.min ? '<small>+' +
            percent((q.price - p.min) / p.min * 100) + ' vs. mín.</small>' : '') : '—') + '</td>';
        }).join('') + '<td>' + price(p.min) + '</td><td>' + price(p.max) + '</td><td>' + price(p.average) + '</td><td>' +
        price(p.median) + '</td><td>' + percent(p.gap) + '</td></tr>').join('') + '</tbody></table></div>';
    const sourceLinks = codes => codes.map(code => report.products.find(p => p.code === code)).filter(Boolean)
      .flatMap(p => p.quotes.map(q => link(q, p.name + ' · ' + (names[q.store] || q.store) + ' ' + price(q.price)))).join(' ');
    const plan = S.buildPlan(report, options.format);
    const planItems = plan.map(a => '<li><strong>' + esc(a.title) + '</strong><span>Prioridad ' + a.priority +
      '/9 · impacto ' + a.impact + '/3 · esfuerzo ' + a.effort + '/3</span><p>' + esc(a.evidence) + '. ' + esc(a.benefit) +
      '</p><p><b>Medí</b> ' + esc(a.metric) + ' <b>Riesgo</b> ' + esc(a.risk) +
      '</p><div class="market-links">' + sourceLinks(a.codes) + '</div></li>').join('');
    const ownRows = report.products.filter(p => p.ownPrice !== null || p.cost !== null);
    const unmatched = report.unmatchedOwn ? '<p>' + report.unmatchedOwn +
      ' códigos propios quedaron sin vínculo por falta de un comparable, duplicación o presentación incompatible.</p>' : '';
    const own = unmatched + (ownRows.length ? '<div class="tablewrap market-table"><table><thead><tr><th>Producto</th><th>Tu precio</th><th>Tu costo</th>' +
      '<th>Mín. rival</th><th>Prom.</th><th>Precio evaluado</th><th>Margen / recargo</th><th>Riesgo observado</th></tr></thead><tbody>' +
      ownRows.map(p => {
        const risks = [];
        if (p.ownPrice > p.min) risks.push('Tu precio supera al mínimo en ' + percent((p.ownPrice - p.min) / p.min * 100));
        if (p.ownMargin !== null && p.ownMargin < 0) risks.push('Tu precio ingresado está por debajo del costo');
        else if (p.ownMargin !== null && p.target !== null && p.ownMargin < p.target) risks.push('Tu margen actual es ' + percent(p.ownMargin) + ', por debajo del objetivo');
        if (p.floor !== null && p.suggested === null) risks.push('Piso ' + price(p.floor) + ' fuera del rango observado');
        if (p.marketMargin !== null && p.marketMargin < 0) risks.push('Igualar el mínimo da pérdida bruta');
        return '<tr><th>' + esc(p.name) + '</th><td>' + cash(p.ownPrice) + '</td><td>' + cash(p.cost) + '</td><td>' +
          price(p.min) + '</td><td>' + price(p.average) + '</td><td>' + cash(p.suggested) + '</td><td>' +
          (p.suggestedMargin === null ? '—' : percent(p.suggestedMargin) + ' / ' +
            (p.suggestedMarkup === null ? '—' : percent(p.suggestedMarkup))) + '</td><td>' +
          esc(risks.join('. ') || 'Revisá vigencia y condiciones') + '</td></tr>';
      }).join('') + '</tbody></table></div><p>Margen = (venta − costo) / venta. Recargo = (venta − costo) / costo. El piso redondea hacia arriba al centésimo.</p>' :
      '<p>Vinculá tus productos por GTIN en «Cargar o editar mi comparación». Mientras tanto, el informe usa rangos observados y plantea riesgos potenciales.</p>');
    const categories = report.categories.map(c => {
      const own = ownRows.filter(p => p.category === c.name && p.ownPrice !== null);
      const above = own.filter(p => p.ownPrice > p.median).length;
      return '<li><strong>' + esc(c.name) + '</strong> · ' + c.count +
        ' códigos · brecha mediana ' + percent(c.medianGap) + ' · máxima ' + percent(c.maxGap) +
        ' · ' + c.full + ' con cobertura completa' +
        (own.length ? ' · ' + above + ' de ' + own.length + ' precios propios sobre la mediana rival' : '') + '</li>';
    }).join('');
    const stores = report.stores.map(s => '<li><strong>' + name(s.store) + '</strong> · ' + esc(s.branch) + ' · ' +
      s.comparable + ' comparables · ' + s.commonMinima + ' mínimos sobre ' + report.common + ' códigos comunes (incluye empates)' +
      (report.common ? ' · canasta ' + price(s.commonTotal) : '') + '</li>').join('');
    const absent = Object.keys(names).filter(id => !sipc&&!id.startsWith('sipc-')&&!report.storeIds.includes(id)).map(name);
    const methodology = '<p>' + report.eligible + ' precios elegibles en el corte seleccionado. ' + report.unverifiedCodes +
      ' registros sin identificador válido y ' + report.conflicts.length + ' códigos con presentaciones incompatibles excluidos. El universo total incluye registros de otras fechas y canales.</p>' +
      (sipc?'<p>Se comparan precios regulares declarados el mismo día por sucursal y presentación del SIPC. El identificador oficial de presentación no acredita un GTIN ni disponibilidad en góndola.</p>':
        '<p>Se usa el último registro del mismo día por código, comercio y sucursal. Las comparaciones requieren stock informado, GTIN válido y descripciones compatibles en dos comercios. Los códigos diferentes permanecen separados.</p>') +
      '<p>La brecha es (máximo − mínimo) / mínimo. Las categorías se infieren de las descripciones.</p>' +
      '<p>Puntaje sobre 100: brecha hasta 30 (50 % o más obtiene 30); cobertura hasta 20 (comercios con precio / comercios del corte); presentación hasta 5 (proporción de fichas con contenido explícito); fecha de observación hasta 20 (20 × máx. de 0 y 1 − días/30); precio viable hasta 10 (10 si el piso llega al mínimo, 5 a la mediana); margen hasta 15 (15 si logra el objetivo al mínimo, 7 al máximo). Sin costo y objetivo, los últimos 25 puntos quedan pendientes. Prioridad del plan = 2 × impacto + (4 − esfuerzo), con estimaciones cualitativas de 1 a 3.</p>' +
      (absent.length ? '<p>Sin precios en esta base para ' + absent.join(', ') + '. La ausencia de registro no indica ausencia de venta.</p>' : '');
    return diagnostics + summary + '<div class="market-top"><div><h3>Diferencia de precios</h3>' + chart +
      '</div><div><h3>Cobertura por comercio</h3><ul>' + stores + '</ul></div></div>' +
      '<h3>Oportunidades para evaluar</h3>' + risk + '<div class="market-opportunities">' +
      (opportunityCards || '<p>No hay brechas de al menos 10 % ni costos vinculados para esta vista.</p>') + '</div>' +
      sum('Comparación de precios por producto', table) +
      sum('Categorías y surtido', '<ul>' + categories + '</ul><p>Usá las categorías como hipótesis para un piloto de surtido. Confirmá rotación y demanda antes de ampliar compras.</p>') +
      sum('Mis precios, margen y riesgos', own, ownRows.length > 0) +
      sum('Plan comercial · ' + plan.length + ' acciones', '<ol class="market-plan">' + planItems + '</ol>') +
      sum('Cómo se calculó · límites y cobertura', methodology);
  }

  const api = { render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MarketReport = api;
})(globalThis);
