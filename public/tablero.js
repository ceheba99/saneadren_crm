/* Resultados → Panorama general: cómo está la empresa en un periodo, comparado con el periodo anterior
   de la misma duración. Lee todo de GET /api/tablero (solo administración). */
const Panorama = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t); // app.js se carga después
  const hoyTxt = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  const iso = d => d.toISOString().slice(0, 10);
  const dinero = n => formatoMoneda(n);
  const corto = n => { const a = Math.abs(n); return (n < 0 ? '-' : '') + '$' + (a >= 1e6 ? (a / 1e6).toFixed(1) + ' M' : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + ' k' : a.toFixed(0)); };
  const fechaTxt = f => new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  let DATOS = null, consulta = 0, PRESET = 'mes';

  // Periodos rápidos (en hora de México).
  function rangoPreset(p) {
    const h = hoyTxt(), [a, m] = h.split('-').map(Number);
    const ini = (y, mo) => iso(new Date(Date.UTC(y, mo, 1))), fin = (y, mo) => iso(new Date(Date.UTC(y, mo + 1, 0)));
    if (p === 'mes') return [ini(a, m - 1), h];
    if (p === 'mes_pasado') return [ini(a, m - 2), fin(a, m - 2)];
    if (p === 'trimestre') { const q = Math.floor((m - 1) / 3) * 3; return [ini(a, q), h]; }
    if (p === 'anio') return [a + '-01-01', h];
    if (p === '12m') return [ini(a, m - 12), h];
    return [$('pg-desde').value || ini(a, m - 1), $('pg-hasta').value || h];
  }
  async function cargar(p) {
    if (p) PRESET = p;
    document.querySelectorAll('[data-pg-preset]').forEach(b => b.classList.toggle('activo', b.dataset.pgPreset === PRESET));
    const [desde, hasta] = rangoPreset(PRESET);
    $('pg-desde').value = desde; $('pg-hasta').value = hasta;
    const turno = ++consulta;
    $('pg-estado').textContent = 'Calculando…';
    try {
      const r = await api('/tablero?' + new URLSearchParams({ desde, hasta, tipo: PRESET }));
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'No se pudo calcular');
      if (turno !== consulta) return;
      DATOS = j; $('pg-estado').textContent = ''; pintar();
    } catch (err) { if (turno === consulta) { $('pg-estado').textContent = ''; $('pg-cuerpo').innerHTML = '<div class="aviso-error-carga" role="alert"><p>No se pudo calcular el panorama: ' + esc(err.message) + '</p><button type="button" class="btn btn-outline" data-pg-reintentar>Reintentar</button></div>'; } }
  }

  // Variación contra el periodo anterior. "bueno": si subir es bueno (ventas) o malo (gastos).
  function delta(act, ant, bueno = true) {
    if (ant === null || ant === undefined) return '';
    if (!ant) return act ? '<span class="pg-delta neutro">sin dato anterior</span>' : '<span class="pg-delta neutro">igual</span>';
    const pct = (act - ant) / Math.abs(ant) * 100;
    if (Math.abs(pct) < 0.5) return '<span class="pg-delta neutro">= igual</span>';
    const sube = pct > 0, clase = sube === bueno ? 'bien' : 'mal';
    return '<span class="pg-delta ' + clase + '">' + (sube ? '▲' : '▼') + ' ' + Math.abs(pct).toFixed(pct > -10 && pct < 10 ? 1 : 0) + ' %</span>';
  }
  const tarjeta = (titulo, valor, sub, extra = '', clase = '') => '<div class="pg-tarjeta ' + clase + '"><small>' + esc(titulo) + '</small><b>' + valor + '</b><div class="pg-tarjeta-pie">' + extra + (sub ? '<span>' + sub + '</span>' : '') + '</div></div>';
  const barras = (lista, campo = 'venta', fmtFn = dinero, detalle = x => x.servicios + (x.servicios === 1 ? ' servicio' : ' servicios')) => {
    if (!lista.length) return '<p class="util-45">Sin datos en el periodo.</p>';
    const max = Math.max(...lista.map(x => x[campo])) || 1;
    return '<div class="pg-barras">' + lista.map(x => '<div class="pg-barra"><div class="pg-barra-cab"><span>' + esc(x.nombre) + '</span><b>' + fmtFn(x[campo]) + '</b></div>'
      + '<div class="pg-barra-fondo"><div class="pg-barra-relleno" style="width:' + Math.max(2, x[campo] / max * 100).toFixed(1) + '%"></div></div>'
      + '<small>' + esc(detalle(x)) + (x.pct !== undefined ? ' · ' + x.pct + ' %' : '') + '</small></div>').join('') + '</div>';
  };

  // Gráfica de 12 meses: barras de venta y gasto, línea de utilidad y de cobrado (SVG, sin librerías).
  function grafica(t) {
    const W = 760, H = 240, ml = 52, mr = 10, mt = 14, mb = 30, ancho = (W - ml - mr) / t.length;
    const valores = t.flatMap(m => [m.venta, m.gasto, m.cobrado, m.utilidad]);
    const max = Math.max(1, ...valores), min = Math.min(0, ...valores), rango = max - min;
    const y = v => mt + (max - v) / rango * (H - mt - mb), y0 = y(0);
    const lineas = [0, .25, .5, .75, 1].map(f => { const v = min + rango * f; return '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" class="pg-g-guia"/><text x="' + (ml - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" class="pg-g-eje" text-anchor="end">' + corto(v) + '</text>'; }).join('');
    const bw = ancho * 0.32;
    const barra = (v, x, clase) => { const top = Math.min(y(v), y0), alto = Math.max(1, Math.abs(y(v) - y0)); return '<rect x="' + x.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + alto.toFixed(1) + '" class="' + clase + '" rx="2"/>'; };
    const cuerpo = t.map((m, i) => { const x = ml + i * ancho; return barra(m.venta, x + ancho * 0.16, 'pg-g-venta') + barra(m.gasto, x + ancho * 0.16 + bw + 2, 'pg-g-gasto')
      + '<text x="' + (x + ancho / 2).toFixed(1) + '" y="' + (H - 10) + '" class="pg-g-eje" text-anchor="middle">' + esc(m.etiqueta) + '</text>'
      + '<rect x="' + x.toFixed(1) + '" y="' + mt + '" width="' + ancho.toFixed(1) + '" height="' + (H - mt - mb) + '" class="pg-g-zona"><title>' + esc(m.etiqueta) + '\nVenta: ' + dinero(m.venta) + '\nGasto: ' + dinero(m.gasto) + '\nUtilidad: ' + dinero(m.utilidad) + '\nCobrado: ' + dinero(m.cobrado) + '\nPagado: ' + dinero(m.pagado) + '</title></rect>'; }).join('');
    const linea = (campo, clase) => '<polyline class="' + clase + '" points="' + t.map((m, i) => (ml + i * ancho + ancho / 2).toFixed(1) + ',' + y(m[campo]).toFixed(1)).join(' ') + '"/>'
      + t.map((m, i) => '<circle class="' + clase + '-p" cx="' + (ml + i * ancho + ancho / 2).toFixed(1) + '" cy="' + y(m[campo]).toFixed(1) + '" r="3"/>').join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="pg-grafica" role="img" aria-label="Ventas, gastos, utilidad y cobrado de los últimos 12 meses">' + lineas
      + '<line x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y0.toFixed(1) + '" y2="' + y0.toFixed(1) + '" class="pg-g-cero"/>' + cuerpo + linea('utilidad', 'pg-g-utilidad') + linea('cobrado', 'pg-g-cobrado') + '</svg>'
      + '<div class="pg-leyenda"><span><i class="pg-l-venta"></i>Venta realizada (sin IVA)</span><span><i class="pg-l-gasto"></i>Gastos (sin IVA)</span><span><i class="pg-l-utilidad"></i>Utilidad estimada</span><span><i class="pg-l-cobrado"></i>Dinero cobrado</span></div>';
  }

  function pintar() {
    const d = DATOS, a = d.actual, p = d.previo, f = d.foto;
    const periodoTxt = fechaTxt(d.desde) + ' – ' + fechaTxt(d.hasta), anteriorTxt = fechaTxt(d.anterior.desde) + ' – ' + fechaTxt(d.anterior.hasta);
    const pct = v => (v === null || v === undefined ? '—' : v + ' %');
    const alertas = d.alertas.length ? d.alertas.map(x => '<li class="pg-alerta ' + esc(x.nivel) + '">' + (x.ir ? '<button type="button" class="enlace" data-pg-ir="' + esc(x.ir) + '">' + esc(x.texto) + ' ›</button>' : esc(x.texto)) + '</li>').join('')
      : '<li class="pg-alerta ok">Todo en orden: no hay pendientes importantes. ✓</li>';
    const tramoMax = Math.max(1, ...f.tramos.map(t => t.total));
    $('pg-cuerpo').innerHTML =
      '<p class="pg-periodo">Periodo: <b>' + esc(periodoTxt) + '</b> · comparado con <b>' + esc(anteriorTxt) + '</b></p>'
      // 1. Lo principal del periodo
      + '<div class="pg-tarjetas">'
      + tarjeta('Venta realizada', dinero(a.venta), a.servicios + (a.servicios === 1 ? ' servicio' : ' servicios') + ' · sin IVA', delta(a.venta, p.venta), 'principal')
      + tarjeta('Utilidad estimada', dinero(a.utilidad), 'Margen ' + pct(a.margen_pct) + ' · venta menos gastos, ambos sin IVA', delta(a.utilidad, p.utilidad), a.utilidad < 0 ? 'negativo' : 'positivo')
      + tarjeta('Dinero cobrado', dinero(a.cobrado), a.cobros_n + (a.cobros_n === 1 ? ' pago recibido' : ' pagos recibidos'), delta(a.cobrado, p.cobrado))
      + tarjeta('Pagado a proveedores', dinero(a.pagado), 'Salida de dinero', delta(a.pagado, p.pagado, false))
      + tarjeta('Flujo de efectivo', dinero(a.flujo), 'Cobrado menos pagado', delta(a.flujo, p.flujo), a.flujo < 0 ? 'negativo' : '')
      + tarjeta('Gastos del periodo (sin IVA)', dinero(a.gasto), 'Con IVA: ' + dinero(a.gasto_con_iva) + (a.iva_estimado_n ? ' · IVA estimado en ' + Number(a.iva_estimado_n) + (a.iva_estimado_n === 1 ? ' factura' : ' facturas') : ''), delta(a.gasto, p.gasto, false))
      + '</div>'
      // 1b. Comparativo por sucursal (solo si se ven varias)
      + ((d.por_sucursal || []).length > 1 ? '<div class="pg-caja"><div class="pg-caja-cab"><h3>Por sucursal</h3><span class="ayuda">Cada renglón solo con lo de esa sucursal; la suma es el total de arriba.</span></div><div class="tabla-scroll"><table class="pg-tabla pg-sucursales"><thead><tr><th>Sucursal</th><th class="st-num">Venta</th><th class="st-num">Gastos</th><th class="st-num">Utilidad</th><th class="st-num">Margen</th><th class="st-num">Cobrado</th><th class="st-num">Pagado</th><th class="st-num">Te deben</th><th class="st-num">Vencido</th><th class="st-num">Debes</th></tr></thead><tbody>'
        + d.por_sucursal.map(s => '<tr><td><b>' + esc(s.clave) + '</b> · ' + esc(s.nombre) + '<small class="celda-sub">' + s.servicios + (s.servicios === 1 ? ' servicio' : ' servicios') + '</small></td><td class="st-num">' + dinero(s.venta) + '</td><td class="st-num">' + dinero(s.gasto) + '</td><td class="st-num' + (s.utilidad < 0 ? ' rojo' : '') + '">' + dinero(s.utilidad) + '</td><td class="st-num">' + pct(s.margen_pct) + '</td><td class="st-num">' + dinero(s.cobrado) + '</td><td class="st-num">' + dinero(s.pagado) + '</td><td class="st-num">' + dinero(s.te_deben) + '</td><td class="st-num' + (s.vencido > 0 ? ' rojo' : '') + '">' + dinero(s.vencido) + '</td><td class="st-num">' + dinero(s.debes) + '</td></tr>').join('')
        + '</tbody></table></div></div>' : '')
      // 2. Alertas
      + '<div class="pg-caja"><h3>Para atender</h3><ul class="pg-alertas">' + alertas + '</ul></div>'
      // 3. Tendencia
      + '<div class="pg-caja"><div class="pg-caja-cab"><h3>Últimos 12 meses</h3><span class="ayuda">Pasa el ratón sobre un mes para ver sus cifras.</span></div>' + grafica(d.tendencia) + '</div>'
      // 4. Hoy: lo que te deben y lo que debes
      + '<div class="pg-dos">'
      + '<div class="pg-caja"><div class="pg-caja-cab"><h3>Te deben hoy</h3><button type="button" class="enlace" data-pg-ir="cobrar">Ver cuentas por cobrar ›</button></div>'
      + '<div class="pg-mini">' + tarjeta('Por cobrar', dinero(f.te_deben), f.ordenes_por_cobrar + ' órdenes') + tarjeta('Vencido', dinero(f.vencido), 'Más de 30 días: ' + dinero(f.vencido_30), '', f.vencido > 0 ? 'negativo' : '')
      + tarjeta('Días para cobrar', f.dias_cobro === null ? '—' : f.dias_cobro + ' días', 'Promedio, de servicio a pago') + '</div>'
      + '<div class="pg-tramos">' + f.tramos.map(t => '<div class="pg-tramo ' + (t.tramo === 'por_vencer' ? 'ok' : t.tramo === '1-15' ? 'leve' : t.tramo === '16-30' ? 'medio' : 'alto') + '"><span>' + esc(t.nombre) + '</span><div class="pg-barra-fondo"><div class="pg-barra-relleno" style="width:' + Math.max(t.total ? 2 : 0, t.total / tramoMax * 100).toFixed(1) + '%"></div></div><b>' + dinero(t.total) + '</b></div>').join('') + '</div>'
      + (f.deudores.length ? '<h4>Quién debe más</h4><table class="pg-tabla"><tbody>' + f.deudores.map(x => '<tr><td>' + esc(x.nombre || 'Sin nombre') + '</td><td class="st-num">' + dinero(x.saldo) + '</td><td class="st-num">' + (x.vencido > 0 ? '<span class="rojo">' + dinero(x.vencido) + ' vencido</span>' : '<span class="util-45">al corriente</span>') + '</td></tr>').join('') + '</tbody></table>' : '')
      + (f.por_realizar > 0 || f.a_favor > 0 ? '<p class="ayuda">' + (f.por_realizar > 0 ? 'Además hay ' + dinero(f.por_realizar) + ' de servicios por realizar (aún no se cobran). ' : '') + (f.a_favor > 0 ? dinero(f.a_favor) + ' a favor de clientes.' : '') + '</p>' : '')
      + '</div>'
      + '<div class="pg-caja"><div class="pg-caja-cab"><h3>Debes hoy</h3><button type="button" class="enlace" data-pg-ir="pagar">Ver cuentas por pagar ›</button></div>'
      + '<div class="pg-mini">' + tarjeta('Por pagar', dinero(f.debes), 'A proveedores') + tarjeta('Vencido', dinero(f.debes_vencido), '', '', f.debes_vencido > 0 ? 'negativo' : '') + tarjeta('Esta semana', dinero(f.pagar_semana), 'Vence a más tardar el domingo') + '</div>'
      + '<h4>Gastos del periodo por categoría (sin IVA)</h4>' + barras(d.gastos.map(g => ({ nombre: g.nombre, venta: g.total, sin_orden: g.sin_orden })), 'venta', dinero, g => g.sin_orden ? dinero(g.sin_orden) + ' sin orden ligada' : 'ligado a órdenes')
      + '<p class="ayuda">Costo de terceros en los servicios del periodo (sin IVA): <b>' + dinero(a.costo_directo) + '</b> · margen directo de servicios: <b>' + dinero(a.margen_directo) + '</b>.</p>'
      + '</div></div>'
      // 5. Operación y ventas
      + '<div class="pg-caja"><h3>Operación y ventas del periodo</h3><div class="pg-tarjetas pg-tarjetas-chicas">'
      + tarjeta('Servicios realizados', String(a.servicios), 'Ticket promedio ' + dinero(a.ticket), delta(a.servicios, p.servicios))
      + tarjeta('No realizados', String(a.no_realizados), a.no_realizados ? dinero(a.no_realizado_valor) + ' que no se hizo' : 'Ninguno', '', a.no_realizados ? 'negativo' : '')
      + tarjeta('Sin marcar', String(f.por_concluir), 'Fecha pasada, falta marcar si se hizo', '', f.por_concluir ? 'aviso' : '')
      + tarjeta('Próximos 7 días', String(f.proximos_7), dinero(f.proximos_7_valor) + ' programado')
      + tarjeta('Subcontratado', pct(a.subcontratado_pct), 'De la venta, hecho por terceros')
      + tarjeta('Cotizaciones', String(a.cotizaciones), dinero(a.cotizado) + ' cotizado', delta(a.cotizaciones, p.cotizaciones))
      + tarjeta('Tasa de cierre', pct(a.cierre_pct), a.cot_ganadas + ' ganadas · ' + a.cot_perdidas + ' perdidas')
      + tarjeta('Propuestas abiertas', String(f.pipeline.abiertas), dinero(f.pipeline.valor) + ' en negociación')
      + tarjeta('Clientes atendidos', String(a.clientes_activos), a.clientes_nuevos + ' nuevos · ' + a.clientes_recurrentes + ' recurrentes', delta(a.clientes_activos, p.clientes_activos))
      + tarjeta('Contactos nuevos', String(a.contactos_nuevos), 'Registrados en el periodo', delta(a.contactos_nuevos, p.contactos_nuevos))
      + '</div></div>'
      // 6. Rankings
      + '<div class="pg-dos"><div class="pg-caja"><h3>Clientes que más compraron</h3>' + barras(d.top_clientes) + '</div>'
      + '<div class="pg-caja"><h3>Servicios que más se vendieron</h3>' + barras(d.por_servicio, 'venta', dinero, x => x.servicios + (x.servicios === 1 ? ' vez' : ' veces')) + '</div></div>'
      + '<div class="pg-tres"><div class="pg-caja"><h3>Por canal de venta</h3>' + barras(d.por_canal) + '</div>'
      + '<div class="pg-caja"><h3>Por unidad</h3>' + barras(d.por_unidad) + '</div>'
      + '<div class="pg-caja"><h3>Por operador</h3>' + barras(d.por_operador) + '</div></div>'
      + '<p class="ayuda pg-nota">Venta realizada: servicios marcados como realizados en el periodo, sin IVA (lo mismo que el Generador). Utilidad estimada: venta realizada menos facturas y gastos del periodo, los dos sin IVA. A cada factura de gasto se le quita su IVA (el capturado o, si no se capturó, el 16 % incluido, marcado como estimado); los gastos sin factura cuentan completos. No restan los comprobantes informativos ni lo que no es gasto (inversión, préstamos y traspasos). Flujo: dinero que entró (pagos de clientes, sin descuentos) menos el que salió (pagos a proveedores). "Te deben" y "Debes" son al día de hoy.</p>';
  }

  function exportar() {
    if (!DATOS) return;
    const d = DATOS, a = d.actual, p = d.previo;
    const filas = [['Concepto', 'Periodo actual', 'Periodo anterior'],
      ['Periodo', d.desde + ' a ' + d.hasta, d.anterior.desde + ' a ' + d.anterior.hasta],
      ['Venta realizada (sin IVA)', a.venta, p.venta], ['Venta con IVA', a.venta_con_iva, p.venta_con_iva], ['Servicios realizados', a.servicios, p.servicios], ['Ticket promedio', a.ticket, p.ticket],
      ['Gastos del periodo (sin IVA)', a.gasto, p.gasto], ['Gastos del periodo (con IVA)', a.gasto_con_iva, p.gasto_con_iva], ['Utilidad estimada', a.utilidad, p.utilidad], ['Margen %', a.margen_pct, p.margen_pct],
      ['Costo de terceros en servicios', a.costo_directo, p.costo_directo], ['Dinero cobrado', a.cobrado, p.cobrado], ['Pagado a proveedores', a.pagado, p.pagado], ['Flujo de efectivo', a.flujo, p.flujo],
      ['Cotizaciones', a.cotizaciones, p.cotizaciones], ['Tasa de cierre %', a.cierre_pct, p.cierre_pct], ['Clientes atendidos', a.clientes_activos, p.clientes_activos], ['Clientes nuevos', a.clientes_nuevos, p.clientes_nuevos],
      [], ['Mes', 'Venta (sin IVA)', 'Gastos (sin IVA)', 'Utilidad', 'Cobrado', 'Pagado'], ...d.tendencia.map(m => [m.mes, m.venta, m.gasto, m.utilidad, m.cobrado, m.pagado]),
      ...((d.por_sucursal || []).length > 1 ? [[], ['Sucursal', 'Venta', 'Gastos', 'Utilidad', 'Cobrado', 'Pagado', 'Te deben', 'Vencido', 'Debes'], ...d.por_sucursal.map(s => [s.clave + ' · ' + s.nombre, s.venta, s.gasto, s.utilidad, s.cobrado, s.pagado, s.te_deben, s.vencido, s.debes])] : [])];
    descargarCSV('panorama_' + d.desde + '_a_' + d.hasta + '.csv', filas[0].map((t, i) => ({ titulo: t, valor: f => f[i] ?? '' })), filas.slice(1));
  }

  document.addEventListener('click', e => {
    const pr = e.target.closest('[data-pg-preset]'); if (pr) { cargar(pr.dataset.pgPreset); return; }
    if (e.target.closest('[data-pg-reintentar]')) { cargar(); return; }
    const ir = e.target.closest('[data-pg-ir]'); if (ir) { cambiarVista(ir.dataset.pgIr); return; }
    if (e.target.closest('#pg-aplicar')) { cargar('personalizado'); return; }
    if (e.target.closest('#pg-exportar')) exportar();
    if (e.target.closest('#pg-imprimir')) window.print();
  });
  return { cargar: () => cargar() };
})();
window.Panorama = Panorama;
