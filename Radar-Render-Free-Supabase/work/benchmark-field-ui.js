const fieldMoney = new Intl.NumberFormat('es-UY', { style: 'currency', currency: 'UYU', maximumFractionDigits: 2 });
const fieldPct = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 1 });
const fieldAmount = cents => fieldMoney.format(cents / 100);
const fieldPercent = percent => fieldPct.format(percent) + ' %';
const fieldText = (name, label, value, extra = '') => '<label><span>' + esc(label) +
  '</span><input name="' + name + '" value="' + esc(value ?? '') + '" ' + extra + '></label>';

function renderFieldReference() {
  const { stores, items, day } = FIELD_REFERENCE;
  if (!items.length) {
    $('#fieldReference').textContent = 'No hay una canasta común en la muestra.';
    return;
  }
  const totals = stores.map((_, i) => items.reduce((sum, item) => sum + Math.round(item.quotes[i].price * 100), 0));
  const minimum = Math.min(...totals);
  const differences = items.map(item => ({
    name: item.name,
    gap: Math.max(...item.quotes.map(q => q.price)) - Math.min(...item.quotes.map(q => q.price)),
  })).sort((a, b) => b.gap - a.gap);
  const tied = differences.filter(item => !item.gap).length;
  const highest = differences[0];
  $('#fieldReference').innerHTML =
    '<p><strong>' + items.length + ' productos con el mismo código</strong> · ' + esc(day) +
    ' · precios registrados en fichas asociadas a sucursal. Precios en UYU, una unidad de cada producto.</p>' +
    '<div class="field-scorecards">' + stores.map((store, i) => '<div class="field-score"><span>' +
      esc(store.name) + '</span><strong>' + fieldAmount(totals[i]) + '</strong><small>' +
      esc(store.branch) + (totals[i] > minimum ? ' · +' + fieldAmount(totals[i] - minimum) : ' · Menor total observado') +
      '</small></div>').join('') + '</div>' +
    '<p><strong>Dónde mirar primero.</strong> ' + tied + ' productos tuvieron el mismo precio en las tres sucursales. ' +
    'La mayor brecha fue de ' + fieldAmount(Math.round(highest.gap * 100)) + ' en ' + esc(highest.name) +
    '. Revisá ese tipo de producto antes de bajar toda la canasta.</p>' +
    '<div class="tablewrap"><table class="field-table"><thead><tr><th>Producto exacto</th>' +
    stores.map(store => '<th>' + esc(store.name) + '</th>').join('') + '</tr></thead><tbody>' +
    items.map(item => '<tr><th scope="row">' + esc(item.name) + '<small>' + esc(item.code) + '</small></th>' +
      item.quotes.map(quote => '<td>' + safeLink(quote.url, fieldAmount(Math.round(quote.price * 100)) + ' ↗') + '</td>').join('') +
      '</tr>').join('') + '</tbody></table></div>';
}

function renderField() {
  const rivals = study.competitors.map((competitor, i) => competitor.name || 'Competidor ' + (i + 1));
  const data = FieldBenchmark.normalize(study.fieldBenchmark, study.competitors);
  const decimal = 'inputmode="decimal" maxlength="14" pattern="[0-9]+([,.][0-9]{1,2})?"';
  const integer = 'inputmode="numeric" maxlength="4" pattern="[0-9]+"';
  const fields = [
    fieldText('day', 'Fecha de relevamiento', data.day, 'type="date"'),
    fieldText('method', 'Canal y condiciones comunes', data.method, 'maxlength="250" placeholder="Ej. compra en local, sin cupón"'),
    fieldText('target', 'Margen bruto objetivo (%)', data.target, decimal),
    ...data.rivals.map((record, i) => fieldText('source' + i, 'Sucursal y comprobante · ' + rivals[i], record.source,
      'maxlength="250" placeholder="Ej. Cordón · ticket 42"')),
  ];
  $('#fieldSettings').innerHTML = fields.join('');
  $('#fieldItems').innerHTML = data.items.map((item, i) => '<fieldset class="field-item"><legend>Producto ' + (i + 1) + '</legend>' +
    '<div class="field-inputs">' +
    fieldText('name' + i, 'Producto, marca y presentación o código', item.name, 'maxlength="180" placeholder="Ej. Yerba Canarias 1 kg"') +
    fieldText('code' + i, 'Código de barras GTIN (opcional)', item.code, 'inputmode="numeric" maxlength="14" pattern="[0-9]{8}|[0-9]{12,14}"') +
    fieldText('qty' + i, 'Unidades en la canasta', item.qty, integer) +
    fieldText('own' + i, 'Mi precio unitario (UYU)', item.price, decimal) +
    fieldText('cost' + i, 'Mi costo unitario (UYU)', item.cost, decimal) +
    item.rivals.map((price, j) => fieldText('rival' + i + '_' + j, rivals[j] + ' · precio unitario o agotado', price,
      'maxlength="14" pattern="[0-9]+([,.][0-9]{1,2})?|[aA][gG][oO][tT][aA][dD][oO]" placeholder="Ej. 125,50 o agotado"')).join('') +
    '</div><button class="text-action" type="button" data-field-remove="' + i + '">Quitar producto</button></fieldset>').join('');
  $('#fieldAdd').disabled = data.items.length >= 12;
  $('#fieldTrialFields').innerHTML = fieldText('protocol', 'Prueba común, canal y franja', data.protocol,
    'maxlength="250" placeholder="Ej. Pedir la misma canasta por mensaje entre las 17 y las 19 h"') +
    '<div class="field-inputs">' + ['Mi tienda (piloto)', ...rivals].map((name, i) => {
      const row = data.trials[i];
      return '<fieldset><legend>' + esc(name) + '</legend>' +
        fieldText('attempts' + i, 'Intentos', row.attempts, integer) +
        fieldText('completed' + i, 'Pedidos confirmados', row.completed, integer) +
        fieldText('minutes' + i, 'Minutos promedio hasta confirmar', row.minutes, decimal) + '</fieldset>';
    }).join('') + '</div>';
  renderFieldResult(data, rivals);
}

function saveField(removeIndex, add = false) {
  const form = $('#fieldForm');
  if (removeIndex === undefined && !form.reportValidity()) return;
  const get = name => form.elements[name]?.value ?? '';
  const data = FieldBenchmark.normalize(study.fieldBenchmark, study.competitors);
  const raw = {
    day: get('day'), method: get('method'), target: get('target'), protocol: get('protocol'),
    rivals: data.rivals.map((record, i) => ({ ...record, source: get('source' + i) })),
    items: data.items.map((_, i) => ({
      name: get('name' + i), code: get('code' + i), qty: get('qty' + i), price: get('own' + i), cost: get('cost' + i),
      rivals: data.rivals.map((_, j) => get('rival' + i + '_' + j)),
    })).filter((_, i) => i !== removeIndex),
    trials: data.trials.map((_, i) => ({ attempts: get('attempts' + i), completed: get('completed' + i), minutes: get('minutes' + i) })),
  };
  if (add || !raw.items.length) raw.items.push({});
  study.fieldBenchmark = FieldBenchmark.normalize(raw, study.competitors);
  persist();
  renderField();
  renderMarket();
  return true;
}

function renderFieldResult(data, names) {
  const { items, own, cost, results, best, floor, margin, match } = FieldBenchmark.compare(data);
  const labels = ['Mi tienda', ...names];
  const price = value => value === null ? 'Sin total comparable' : fieldAmount(value);
  const cards = [{ total: own, hint: margin === null ? '' : 'Margen bruto ' + fieldPercent(margin) },
    ...results.map(row => ({ total: row.total, hint: row.known + ' de ' + items.length + ' relevados · ' + row.out + ' agotados' }))];
  $('#fieldResults').innerHTML = '<div class="field-scorecards">' + cards.map((card, i) =>
    '<div class="field-score"><span>' + esc(labels[i]) + '</span><strong>' + price(card.total) +
    '</strong><small>' + card.hint + '</small></div>').join('') + '</div>';
  const decisions = [];
  if (own !== null && best !== null) {
    const rivals = results.filter(row => row.total !== null).length;
    const gap = own - best;
    decisions.push(gap ? 'Tu canasta queda ' + fieldAmount(Math.abs(gap)) + ' (' + fieldPercent(Math.abs(gap) / best * 100) + ') ' +
      (gap > 0 ? 'por encima' : 'por debajo') + ' del menor total entre ' + rivals + ' rival(es) con canasta completa.' :
      'Tu canasta iguala el menor total entre ' + rivals + ' rival(es) con canasta completa.');
    if (gap > 0) {
      const rival = results.findIndex(row => row.total === best);
      const biggest = items.map(item => ({ name: item.name, gap: Math.round((item.price - item.rivals[rival]) * 100) * item.qty }))
        .sort((a, b) => b.gap - a.gap)[0];
      decisions.push(biggest.name + ' explica la mayor brecha por producto (' + fieldAmount(biggest.gap) +
        '). Revisá su costo o precio antes de ajustar el resto.');
    }
  }
  if (floor !== null) decisions.push('Para obtener ' + fieldPercent(data.target) + ' de margen bruto, tu canasta debería facturar al menos ' + fieldAmount(floor) + '.');
  if (match !== null) {
    const shortfall = floor !== null && best < floor;
    decisions.push('Si igualás el menor total observado, tu margen bruto sería ' + fieldPercent(match) + '. ' +
      (shortfall ? 'Para sostener tu objetivo, tendrías que bajar el costo de la canasta en al menos ' +
        fieldAmount(cost - Math.floor(best * (100 - data.target) / 100 + 1e-8)) +
        ' o mantener un precio mayor y probar si el cliente valora la diferencia.' : ''));
  }
  const withShortage = results.findIndex(row => row.out > 0);
  if (withShortage !== -1) {
    const item = items.find(row => row.rivals[withShortage] === 'agotado');
    decisions.push(names[withShortage] + ' registró falta de ' + item.name +
      '. Repetí la medición en otra fecha antes de aumentar tu stock para cubrir esa demanda.');
  }
  const observed = data.protocol && data.day ? data.trials.flatMap((row, i) => {
    if (!(row.attempts > 0 && row.completed !== null && row.completed !== undefined && (i === 0 || data.rivals[i - 1].source))) return [];
    return [{ ...row, name: labels[i], own: i === 0 }];
  }) : [];
  if (observed.length) {
    $('#fieldResults').innerHTML += '<h4>Pruebas de compra registradas</h4><ul>' + observed.map(row =>
      '<li><strong>' + esc(row.name) + '</strong> · ' + row.completed + ' de ' + row.attempts +
      ' confirmados (' + fieldPercent(row.completed / row.attempts * 100) + ')' +
      (row.minutes === null ? '' : ' · ' + fieldPct.format(row.minutes) + ' min promedio en confirmados') + '</li>').join('') + '</ul>';
    const ownTrial = observed.find(row => row.own);
    const fastest = observed.filter(row => !row.own && row.minutes !== null).sort((a, b) => a.minutes - b.minutes)[0];
    if (ownTrial?.minutes != null && fastest && ownTrial.minutes > fastest.minutes) {
      decisions.push('En las pruebas confirmadas, tu piloto demoró ' + fieldPct.format(ownTrial.minutes - fastest.minutes) +
        ' min más que ' + fastest.name + '. Probá una confirmación de stock y precio en el primer mensaje y repetí la prueba.');
    }
  }
  const hasMeasurements = own !== null || results.some(row => row.known > 0) || observed.length > 0;
  if (!hasMeasurements) {
    $('#fieldResults').innerHTML = '';
  }
  $('#fieldDecisions').innerHTML = decisions.length ? '<h4>Brechas y decisiones</h4><ul>' +
    decisions.map(value => '<li>' + esc(value) + '</li>').join('') + '</ul>' :
    (hasMeasurements ? '' : '<p class="mini">Cargá tu canasta y los precios rivales para calcular la brecha y el margen.</p>');
}

function initField() {
  renderFieldReference();
  renderField();
  $('#fieldForm').onsubmit = event => {
    event.preventDefault();
    if (saveField()) $('#fieldEdit').open = false;
  };
  $('#fieldAdd').onclick = () => saveField(undefined, true);
  $('#fieldItems').onclick = event => {
    const button = event.target.closest('[data-field-remove]');
    if (button) saveField(Number(button.dataset.fieldRemove));
  };
}
