/* Contabilidad del mes (módulo contable F1, 2026-11-11). Servidor: server/contabilidad.js. Solo consulta.
   Pestañas: Resumen (tarjetas y pendientes) y las tablas del mes —Facturas, Cobros, Gastos (con las columnas del Excel CXP
   de Dirección, en su orden, y lo que le faltaba: subtotal, IVA, XML, UUID) y Pagos—, cada una con buscador, orden por
   columna y totales. El Excel que se descarga trae exactamente las mismas columnas, más la hoja Resumen. */
const Contabilidad = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t);
  const dinero = v => formatoMoneda(Number(v || 0));
  const mesActual = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit' }).format(new Date());
  const fecha = f => (/^\d{4}-\d{2}-\d{2}/.test(f || '') ? f.slice(0, 10).split('-').reverse().join('/') : '');
  const VIA = { transferencia: 'Transferencia', efectivo: 'Efectivo', deposito: 'Depósito', cheque: 'Cheque', tarjeta: 'Tarjeta', otro: 'Otro', nomina: 'Nómina', layout: 'Layout', pagadora: 'Pagadora', domiciliado: 'Domiciliado', linea_captura: 'Línea de captura', directo: 'Directo' };
  const COMP = { factura: 'Factura', recibo: 'Recibo', estado_cuenta: 'Estado de cuenta', linea_captura: 'Línea de captura', nomina: 'Nómina', pagadora: 'Pagadora', sin_factura: 'Sin factura', otro: 'Otro' };
  // Columnas: [llave, título, ancho en Excel, tipo] · tipo: f fecha, d dinero, s estado (chip), v vía, c comprobante, n número.
  const TABLAS = {
    gastos: { titulo: 'Gastos (CXP)', hoja: 'CXP', cols: [['vence', 'FECHA VENCIMIENTO', 13, 'f'], ['proveedor', 'PROVEEDOR', 28], ['beneficiario', 'BENEFICIARIO', 24], ['concepto', 'DESCRIPCIÓN', 32],
      ['fecha', 'FECHA FACTURA', 12, 'f'], ['capturo', 'CAPTURÓ', 16], ['folio', 'FOLIO FACTURA', 13], ['via', 'VÍA DE PAGO', 14, 'v'], ['total', 'MONTO TOTAL', 14, 'd'], ['pendiente', 'PENDIENTE', 14, 'd'],
      ['pagado', 'PAGADO', 14, 'd'], ['dias_credito', 'DÍAS DE CRÉDITO', 10, 'n'], ['categoria', 'CONCEPTO DE GASTO', 20], ['status', 'STATUS', 11, 's'], ['fecha_pago', 'FECHA DE PAGO', 12, 'f'],
      ['observaciones', 'OBSERVACIONES', 30], ['rfc', 'RFC', 15], ['comprobante', 'COMPROBANTE', 14, 'c'], ['subtotal', 'SUBTOTAL', 14, 'd'], ['iva', 'IVA', 13, 'd'], ['iva_origen', 'IVA DE', 13],
      ['xml', 'XML', 7, 's'], ['uuid', 'FOLIO FISCAL (UUID)', 38], ['sucursal', 'SUCURSAL', 9]] },
    facturas: { titulo: 'Facturas emitidas', hoja: 'Facturas emitidas', cols: [['fecha', 'FECHA', 11, 'f'], ['tipo', 'TIPO', 18], ['folio', 'SERIE-FOLIO', 13], ['cliente', 'CLIENTE', 32], ['rfc', 'RFC', 15],
      ['orden', 'ORDEN', 20], ['metodo', 'MÉTODO', 8], ['forma', 'FORMA', 7], ['subtotal', 'SUBTOTAL', 14, 'd'], ['iva', 'IVA', 13, 'd'], ['total', 'TOTAL', 14, 'd'], ['estatus', 'ESTATUS', 13, 's'],
      ['cancelada', 'CANCELADA EL', 12, 'f'], ['uuid', 'FOLIO FISCAL (UUID)', 38], ['sucursal', 'SUCURSAL', 9]] },
    cobros: { titulo: 'Cobros', hoja: 'Cobros', cols: [['fecha', 'FECHA', 11, 'f'], ['cliente', 'CLIENTE', 32], ['orden', 'ORDEN', 20], ['factura', 'FACTURA', 12], ['monto', 'MONTO', 14, 'd'], ['metodo', 'VÍA', 14, 'v'],
      ['referencia', 'REFERENCIA', 20], ['estado', 'ESTADO', 14, 's'], ['sucursal', 'SUCURSAL', 9]] },
    pagos: { titulo: 'Pagos a proveedores', hoja: 'Pagos a proveedores', cols: [['fecha', 'FECHA', 11, 'f'], ['proveedor', 'PROVEEDOR', 28], ['concepto', 'CONCEPTO', 32], ['folio', 'FOLIO', 12], ['monto', 'MONTO', 14, 'd'],
      ['metodo', 'VÍA', 14, 'v'], ['referencia', 'REFERENCIA', 20], ['cuenta', 'CUENTA DE SALIDA', 20]] },
  };
  const CHIP = { PAGADO: 'pagada', PARCIAL: 'parcial', PENDIENTE: 'vencida', Confirmado: 'pagada', 'Por confirmar': 'por-confirmar', timbrada: 'pagada', cancelada: 'vencida', cancelacion_solicitada: 'parcial', Sí: 'pagada', Falta: 'vencida' };
  const textoDe = (v, tipo) => (tipo === 'f' ? fecha(v) : tipo === 'v' ? VIA[v] || v || '' : tipo === 'c' ? COMP[v] || v || '' : tipo === 'd' ? dinero(v) : String(v ?? ''));
  let listo = false, consulta = 0, DATOS = null, PESTANA = 'resumen';
  const estado = {}; // por tabla: { q, k, dir }
  const conBoton = async (b, fn) => { if (b.disabled) return; b.disabled = true; try { await fn(); } finally { b.disabled = false; } };
  const consultaDe = () => { const q = new URLSearchParams({ mes: $('ct-mes').value }); if ($('ct-sucursal').value) q.set('sucursal', $('ct-sucursal').value); return q; };
  const tarjeta = (t, v, sub, malo) => `<div class="logs-tarjeta${malo ? ' logs-alerta' : ''}"><b>${esc(v)}</b><span>${esc(t)}</span>${sub ? `<small class="util-45">${esc(sub)}</small>` : ''}</div>`;

  async function cargar() {
    if (!$('vista-contabilidad')) return;
    if (!listo) preparar();
    const turno = ++consulta, cont = $('ct-resumen');
    cont.innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    let d;
    try { const res = await api('/contabilidad/excel?' + consultaDe()); d = await res.json(); if (!res.ok) throw new Error(d.error); }
    catch (e) { if (turno === consulta) cont.innerHTML = '<p class="aviso-error-carga">' + esc(e.message) + '</p>'; return; }
    if (turno !== consulta) return;
    DATOS = d;
    pintar();
  }
  function pintar() {
    const d = DATOS, n = k => (d[k] || []).length;
    const pestanas = [['resumen', 'Resumen'], ...Object.entries(TABLAS).map(([k, t]) => [k, `${t.titulo} (${n(k)})`])];
    $('ct-resumen').innerHTML = `<div class="ct-pestanas" role="tablist">${pestanas.map(([k, t]) => `<button type="button" role="tab" class="ct-pestana${k === PESTANA ? ' activa' : ''}" aria-selected="${k === PESTANA}" data-ct-pestana="${esc(k)}">${esc(t)}</button>`).join('')}</div>
      <div id="ct-contenido">${PESTANA === 'resumen' ? resumenHtml(d.resumen) : tablaHtml(PESTANA)}</div>`;
  }
  function resumenHtml(r) {
    const p = r.pendientes, pend = [
      p.gastos_sin_xml ? `${Number(p.gastos_sin_xml)} gasto(s) con factura sin su XML (súbelo en Cuentas por pagar)` : '',
      p.gastos_iva_estimado ? `${Number(p.gastos_iva_estimado)} gasto(s) con IVA estimado al 16 % (falta capturar el real o subir el XML)` : '',
      p.cobros_por_confirmar ? `${Number(p.cobros_por_confirmar)} cobro(s) por confirmar (no cuentan como cobrados hasta confirmarlos)` : '',
      p.facturas_canceladas ? `${Number(p.facturas_canceladas)} factura(s) cancelada(s) en el mes (no cuentan en lo facturado)` : ''].filter(Boolean);
    return `${r.entorno !== 'prod' ? `<p class="aviso-error-carga">La facturación está en ${r.entorno === 'demo' ? 'demostración' : 'pruebas (sandbox)'}: lo facturado aquí no tiene validez fiscal.</p>` : ''}
      <h3 class="util-13">Ingresos</h3><div class="logs-tarjetas">${tarjeta('Facturado (sin IVA)', dinero(r.ingresos.facturado_subtotal), r.ingresos.facturas + ' factura(s)')}${tarjeta('IVA facturado', dinero(r.ingresos.facturado_iva))}
        ${tarjeta('Total facturado', dinero(r.ingresos.facturado_total))}${tarjeta('Cobrado confirmado', dinero(r.ingresos.cobrado), 'IVA cobrado ' + dinero(r.ingresos.cobrado_iva))}
        ${tarjeta('Cobros por confirmar', dinero(r.ingresos.por_confirmar), null, r.ingresos.por_confirmar > 0)}${tarjeta('Complementos de pago', String(r.ingresos.complementos))}</div>
      <h3 class="util-13">Egresos</h3><div class="logs-tarjetas">${tarjeta('Gastos del mes (con IVA)', dinero(r.egresos.gastos_total), r.egresos.gastos + ' gasto(s)')}${tarjeta('IVA de los gastos', dinero(r.egresos.gastos_iva), r.egresos.gastos_iva_estimado ? 'de ello ' + dinero(r.egresos.gastos_iva_estimado) + ' estimado' : '', r.egresos.gastos_iva_estimado > 0)}
        ${tarjeta('Pagado a proveedores', dinero(r.egresos.pagado), 'IVA pagado ' + dinero(r.egresos.pagado_iva))}</div>
      <h3 class="util-13">IVA del mes (apoyo para el contador)</h3><div class="logs-tarjetas">${tarjeta('Según facturas: facturado − gastos', dinero(Math.abs(r.iva.segun_facturas)), r.iva.segun_facturas >= 0 ? 'a cargo' : 'a favor')}
        ${tarjeta('Según el dinero: cobrado − pagado', dinero(Math.abs(r.iva.segun_flujo)), r.iva.segun_flujo >= 0 ? 'a cargo' : 'a favor')}</div>
      <h3 class="util-13">Pendientes de comprobar</h3>${pend.length ? '<ul class="ct-pendientes">' + pend.map(t => '<li>⚠ ' + esc(t) + '</li>').join('') + '</ul>' : '<p class="util-45">Nada pendiente de comprobar este mes. 🎉</p>'}
      <p class="ayuda">${Number(r.xml_disponibles)} XML disponibles para descargar este mes.</p>`;
  }
  // Filas de una tabla con el buscador y el orden aplicados.
  function filasDe(k) {
    const t = TABLAS[k], e = estado[k] || (estado[k] = { q: '', k: t.cols[0][0], dir: 1 }), q = e.q.trim().toLowerCase();
    const tipo = (t.cols.find(c => c[0] === e.k) || [])[3];
    const filas = (DATOS[k] || []).filter(f => !q || t.cols.some(([c, , , tp]) => textoDe(f[c], tp).toLowerCase().includes(q)));
    return filas.sort((a, b) => { const x = a[e.k], y = b[e.k]; const r = tipo === 'd' || tipo === 'n' ? Number(x || 0) - Number(y || 0) : String(x ?? '').localeCompare(String(y ?? ''), 'es'); return r * e.dir; });
  }
  function tablaHtml(k) {
    const t = TABLAS[k], e = estado[k] || (estado[k] = { q: '', k: t.cols[0][0], dir: 1 }), filas = filasDe(k);
    const celda = (f, [c, , , tp]) => {
      const v = textoDe(f[c], tp);
      if (tp === 's') return `<td><span class="estado-cxc ${esc(CHIP[f[c]] || '')}">${esc(v)}</span></td>`;
      return `<td class="${tp === 'd' || tp === 'n' ? 'ct-num' : ''}">${esc(v)}</td>`;
    };
    const totales = t.cols.map(([c, , , tp]) => (tp === 'd' ? dinero(filas.reduce((s, f) => s + Number(f[c] || 0), 0)) : ''));
    return `<div class="filtros"><input type="search" id="ct-buscar" data-ct-tabla="${esc(k)}" value="${esc(e.q)}" placeholder="Buscar en ${esc(t.titulo.toLowerCase())}…" aria-label="Buscar en la tabla"><span class="util-45">${Number(filas.length)} renglón(es)</span></div>
      ${filas.length ? `<div class="tabla-scroll ct-tabla-scroll"><table class="tabla-resumen ct-tabla"><thead><tr>${t.cols.map(([c, titulo]) => `<th><button type="button" class="ct-orden" data-ct-orden="${esc(c)}">${esc(titulo)}${e.k === c ? (e.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`).join('')}</tr></thead>
        <tbody>${filas.map(f => `<tr>${t.cols.map(c => celda(f, c)).join('')}</tr>`).join('')}</tbody>
        <tfoot><tr>${totales.map((v, i) => `<td class="ct-num">${i === 0 ? 'TOTAL' : esc(v)}</td>`).join('')}</tr></tfoot></table></div>`
      : '<p class="util-45">No hay renglones este mes.</p>'}`;
  }

  async function excel() {
    let ExcelJS; try { ExcelJS = await Finanzas.cargarExcelJS(); } catch (e) { toast(e.message); return; }
    let d; try { const res = await api('/contabilidad/excel?' + consultaDe()); d = await res.json(); if (!res.ok) throw new Error(d.error); } catch (e) { toast(e.message); return; }
    const wb = new ExcelJS.Workbook(); wb.creator = 'Saneadren CRM';
    const r = d.resumen, R = wb.addWorksheet('Resumen');
    R.columns = [{ width: 46 }, { width: 18 }];
    [['Contabilidad del mes', d.resumen.mes], [], ['INGRESOS'], ['Facturado sin IVA', r.ingresos.facturado_subtotal], ['IVA facturado', r.ingresos.facturado_iva], ['Total facturado', r.ingresos.facturado_total],
      ['Cobrado confirmado', r.ingresos.cobrado], ['IVA de lo cobrado', r.ingresos.cobrado_iva], ['Cobros por confirmar', r.ingresos.por_confirmar], [], ['EGRESOS'], ['Gastos del mes (con IVA)', r.egresos.gastos_total],
      ['IVA de los gastos', r.egresos.gastos_iva], ['  de ello, estimado al 16 %', r.egresos.gastos_iva_estimado], ['Pagado a proveedores', r.egresos.pagado], ['IVA de lo pagado', r.egresos.pagado_iva], [],
      ['IVA SEGÚN FACTURAS (facturado − gastos)', r.iva.segun_facturas], ['IVA SEGÚN EL DINERO (cobrado − pagado)', r.iva.segun_flujo], [], ['Cifras de apoyo: qué se declara lo decide el contador.']]
      .forEach((f, i) => { const row = R.addRow(f); if (typeof f[1] === 'number') row.getCell(2).numFmt = '"$"#,##0.00'; if (f.length === 1 || i === 0) row.font = { bold: true }; });
    // Mismas columnas y orden que en pantalla; fechas como fecha y montos como número (para sumar en Excel), con fila TOTAL.
    for (const [k, t] of Object.entries(TABLAS)) {
      const ws = wb.addWorksheet(t.hoja, { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = t.cols.map(([c, titulo, ancho, tp]) => ({ header: titulo, key: c, width: ancho, style: tp === 'd' ? { numFmt: '"$"#,##0.00' } : tp === 'f' ? { numFmt: 'dd/mm/yyyy' } : {} }));
      ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6B103' } };
      for (const f of d[k] || []) ws.addRow(Object.fromEntries(t.cols.map(([c, , , tp]) => [c, tp === 'f' ? (f[c] ? new Date(f[c].slice(0, 10) + 'T12:00:00Z') : null) : tp === 'd' ? Number(f[c] || 0) : tp === 'v' || tp === 'c' ? textoDe(f[c], tp) : f[c]])));
      if ((d[k] || []).length) {
        const n = (d[k] || []).length + 1, fila = ws.addRow({});
        t.cols.forEach(([c, , , tp], i) => { if (i === 0) fila.getCell(1).value = 'TOTAL'; else if (tp === 'd') { const col = ws.getColumn(i + 1).letter; fila.getCell(i + 1).value = { formula: `SUM(${col}2:${col}${n})` }; } });
        fila.font = { bold: true };
      }
    }
    saveAs(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `contabilidad_${$('ct-mes').value}.xlsx`);
  }
  async function xml() {
    try { const res = await api('/contabilidad/xml?' + consultaDe()); if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'No se pudo descargar'); saveAs(await res.blob(), `xml_${$('ct-mes').value}.tar`); }
    catch (e) { toast(e.message); }
  }

  function preparar() {
    listo = true;
    $('ct-mes').value = mesActual();
    const sucs = window.Sucursales?.datos?.sucursales || [];
    $('ct-sucursal').innerHTML = '<option value="">Todas las sucursales</option>' + sucs.map(s => `<option value="${Number(s.id)}">${esc(s.nombre)}</option>`).join('');
    $('ct-sucursal').hidden = sucs.length < 2;
    $('ct-mes').addEventListener('change', cargar); $('ct-sucursal').addEventListener('change', cargar);
    $('ct-excel').addEventListener('click', e => conBoton(e.currentTarget, excel));
    $('ct-xml').addEventListener('click', e => conBoton(e.currentTarget, xml));
    $('ct-resumen').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !DATOS) return;
      if (b.dataset.ctPestana) { PESTANA = b.dataset.ctPestana; pintar(); }
      else if (b.dataset.ctOrden) { const s = estado[PESTANA]; s.dir = s.k === b.dataset.ctOrden ? -s.dir : 1; s.k = b.dataset.ctOrden; $('ct-contenido').innerHTML = tablaHtml(PESTANA); }
    });
    let espera;
    $('ct-resumen').addEventListener('input', e => {
      if (e.target.id !== 'ct-buscar') return;
      const k = e.target.dataset.ctTabla; estado[k].q = e.target.value; clearTimeout(espera);
      espera = setTimeout(() => { $('ct-contenido').innerHTML = tablaHtml(k); const i = $('ct-buscar'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250);
    });
  }
  return { cargar };
})();
window.Contabilidad = Contabilidad;
