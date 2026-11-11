/* Contabilidad del mes (módulo contable F1, 2026-11-11). Servidor: server/contabilidad.js. Resumen del mes, pendientes de
   comprobar y descargas para el contador (Excel armado aquí, como los demás, y los XML en un .tar). Solo consulta. */
const Contabilidad = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t);
  const dinero = v => formatoMoneda(Number(v || 0));
  const mesActual = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit' }).format(new Date());
  let listo = false, consulta = 0;
  const conBoton = async (b, fn) => { if (b.disabled) return; b.disabled = true; try { await fn(); } finally { b.disabled = false; } };
  const consultaDe = () => { const q = new URLSearchParams({ mes: $('ct-mes').value }); if ($('ct-sucursal').value) q.set('sucursal', $('ct-sucursal').value); return q; };
  const tarjeta = (t, v, sub, malo) => `<div class="logs-tarjeta${malo ? ' logs-alerta' : ''}"><b>${esc(v)}</b><span>${esc(t)}</span>${sub ? `<small class="util-45">${esc(sub)}</small>` : ''}</div>`;

  async function cargar() {
    if (!$('vista-contabilidad')) return;
    if (!listo) preparar();
    const turno = ++consulta, cont = $('ct-resumen');
    cont.innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    let r;
    try { const res = await api('/contabilidad/resumen?' + consultaDe()); r = await res.json(); if (!res.ok) throw new Error(r.error); }
    catch (e) { if (turno === consulta) cont.innerHTML = '<p class="aviso-error-carga">' + esc(e.message) + '</p>'; return; }
    if (turno !== consulta) return;
    const p = r.pendientes, pend = [
      p.gastos_sin_xml ? `${Number(p.gastos_sin_xml)} gasto(s) con factura sin su XML (súbelo en Cuentas por pagar)` : '',
      p.gastos_iva_estimado ? `${Number(p.gastos_iva_estimado)} gasto(s) con IVA estimado al 16 % (falta capturar el real o subir el XML)` : '',
      p.cobros_por_confirmar ? `${Number(p.cobros_por_confirmar)} cobro(s) por confirmar (no cuentan como cobrados hasta confirmarlos)` : '',
      p.facturas_canceladas ? `${Number(p.facturas_canceladas)} factura(s) cancelada(s) en el mes (no cuentan en lo facturado)` : ''].filter(Boolean);
    cont.innerHTML = `${r.entorno !== 'prod' ? `<p class="aviso-error-carga">La facturación está en ${r.entorno === 'demo' ? 'demostración' : 'pruebas (sandbox)'}: lo facturado aquí no tiene validez fiscal.</p>` : ''}
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

  async function excel() {
    let ExcelJS; try { ExcelJS = await Finanzas.cargarExcelJS(); } catch (e) { toast(e.message); return; }
    let d; try { const res = await api('/contabilidad/excel?' + consultaDe()); d = await res.json(); if (!res.ok) throw new Error(d.error); } catch (e) { toast(e.message); return; }
    const wb = new ExcelJS.Workbook(); wb.creator = 'Saneadren CRM';
    const hoja = (nombre, cols, filas) => {
      const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = cols.map(([k, t, w, dinero]) => ({ header: t, key: k, width: w, style: dinero ? { numFmt: '"$"#,##0.00' } : {} }));
      ws.getRow(1).font = { bold: true };
      filas.forEach(f => ws.addRow(f));
      return ws;
    };
    const r = d.resumen, R = wb.addWorksheet('Resumen');
    R.columns = [{ width: 46 }, { width: 18 }];
    [['Contabilidad del mes', d.resumen.mes], [], ['INGRESOS'], ['Facturado sin IVA', r.ingresos.facturado_subtotal], ['IVA facturado', r.ingresos.facturado_iva], ['Total facturado', r.ingresos.facturado_total],
      ['Cobrado confirmado', r.ingresos.cobrado], ['IVA de lo cobrado', r.ingresos.cobrado_iva], ['Cobros por confirmar', r.ingresos.por_confirmar], [], ['EGRESOS'], ['Gastos del mes (con IVA)', r.egresos.gastos_total],
      ['IVA de los gastos', r.egresos.gastos_iva], ['  de ello, estimado al 16 %', r.egresos.gastos_iva_estimado], ['Pagado a proveedores', r.egresos.pagado], ['IVA de lo pagado', r.egresos.pagado_iva], [],
      ['IVA SEGÚN FACTURAS (facturado − gastos)', r.iva.segun_facturas], ['IVA SEGÚN EL DINERO (cobrado − pagado)', r.iva.segun_flujo], [], ['Cifras de apoyo: qué se declara lo decide el contador.']]
      .forEach((f, i) => { const row = R.addRow(f); if (typeof f[1] === 'number') row.getCell(2).numFmt = '"$"#,##0.00'; if (f.length === 1 || i === 0) row.font = { bold: true }; });
    hoja('Facturas emitidas', [['fecha', 'Fecha', 11], ['tipo', 'Tipo', 18], ['folio', 'Serie-folio', 13], ['uuid', 'Folio fiscal (UUID)', 38], ['orden', 'Orden', 20], ['rfc', 'RFC', 15], ['cliente', 'Cliente', 34], ['metodo', 'Método', 8], ['forma', 'Forma', 7],
      ['subtotal', 'Subtotal', 14, 1], ['iva', 'IVA', 13, 1], ['total', 'Total', 14, 1], ['estatus', 'Estatus', 14], ['cancelada', 'Cancelada el', 12], ['sucursal', 'Sucursal', 9]], d.facturas);
    hoja('Cobros', [['fecha', 'Fecha', 11], ['orden', 'Orden', 20], ['cliente', 'Cliente', 34], ['factura', 'Factura', 12], ['monto', 'Monto', 14, 1], ['metodo', 'Método', 14], ['referencia', 'Referencia', 20], ['estado', 'Estado', 14], ['sucursal', 'Sucursal', 9]], d.cobros);
    hoja('Gastos', [['fecha', 'Fecha', 11], ['proveedor', 'Proveedor', 30], ['rfc', 'RFC', 15], ['folio', 'Folio', 12], ['uuid', 'Folio fiscal (UUID)', 38], ['comprobante', 'Comprobante', 14], ['concepto', 'Concepto', 32], ['categoria', 'Categoría', 18],
      ['subtotal', 'Subtotal', 14, 1], ['iva', 'IVA', 13, 1], ['iva_origen', 'IVA de', 14], ['total', 'Total', 14, 1], ['xml', 'XML', 7], ['beneficiario', 'A quién se paga', 24], ['sucursal', 'Sucursal', 9]], d.gastos);
    hoja('Pagos a proveedores', [['fecha', 'Fecha', 11], ['proveedor', 'Proveedor', 30], ['concepto', 'Concepto', 32], ['folio', 'Folio', 12], ['monto', 'Monto', 14, 1], ['metodo', 'Vía', 14], ['referencia', 'Referencia', 20], ['cuenta', 'Cuenta de salida', 20]], d.pagos);
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
  }
  return { cargar };
})();
window.Contabilidad = Contabilidad;
