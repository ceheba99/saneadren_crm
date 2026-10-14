/* Órdenes de compra (formato CM-F-03): lista, captura (borrador), autorización (pasa a Cuentas por pagar),
   cancelación, centros de costo y descarga en PDF / Excel. Servidor: server/compras.js */
const Compras = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t); // app.js se carga después
  const dinero = n => formatoMoneda(n);
  const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  const fechaTxt = f => (f ? f.split('-').reverse().join('/') : '—');
  const esAdmin = () => USUARIO_ACTUAL?.rol === 'admin';
  const ESTADOS = { borrador: ['Borrador · por autorizar', 'parcial'], autorizada: ['Autorizada', 'programada'], cancelada: ['Cancelada', 'vencida'] };
  let LISTA = [], ACTUAL = null, PROVEEDORES = [], CENTROS = [], CATEGORIAS = [], consulta = 0;
  const json = async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'No se pudo completar'); return j; };
  const pedir = (ruta, metodo = 'GET', cuerpo) => api(ruta, metodo === 'GET' ? undefined : { method: metodo, body: JSON.stringify(cuerpo || {}) }).then(json);

  async function catalogos() {
    [PROVEEDORES, CENTROS, CATEGORIAS] = await Promise.all([pedir('/finanzas/proveedores'), pedir('/compras/centros'), CATEGORIAS.length ? CATEGORIAS : pedir('/finanzas/categorias')]);
  }
  // ---------- Lista ----------
  async function cargar() {
    const turno = ++consulta, cont = $('oc-lista');
    cont.innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    try {
      const q = new URLSearchParams({ estado: $('oc-filtro').value, q: $('oc-buscar').value.trim() });
      const [lista] = await Promise.all([pedir('/compras/ordenes?' + q), catalogos()]);
      if (turno !== consulta) return;
      LISTA = lista;
    } catch (err) { cont.innerHTML = '<div class="aviso-error-carga" role="alert"><p>No se pudo cargar: ' + esc(err.message) + '</p></div>'; return; }
    if (!LISTA.length) { cont.innerHTML = '<p class="util-45">No hay órdenes de compra con este filtro. Usa «+ Nueva orden de compra».</p>'; return; }
    const filas = LISTA.map(o => {
      const [txt, cl] = ESTADOS[o.estado];
      const pago = o.estado === 'autorizada' ? (o.saldo > 0 ? (o.pagado > 0 ? 'Pagado ' + dinero(o.pagado) + ' · falta ' + dinero(o.saldo) : 'Pendiente de pago') : 'Pagada ✓') : '—';
      return '<tr class="' + (o.estado === 'cancelada' ? 'fila-cancelada' : '') + '"><td><span class="estado-cxc ' + cl + '">' + esc(txt) + '</span></td><td><b>' + esc(o.folio) + '</b></td><td>' + esc(fechaTxt(o.fecha)) + '</td>'
        + '<td>' + esc(o.proveedor_nombre) + '</td><td>' + esc(o.centro_nombre) + '</td><td>' + esc(o.partidas[0]?.descripcion || '') + (o.partidas.length > 1 ? ' <small class="util-45">y ' + (o.partidas.length - 1) + ' más</small>' : '') + '</td>'
        + '<td class="st-num"><b>' + dinero(o.total) + '</b></td><td>' + esc(pago) + '</td>'
        + '<td class="celda-acciones"><div class="acciones-fila"><button type="button" class="btn btn-outline btn-chico" data-oc-abrir="' + Number(o.id) + '">Abrir</button><button type="button" class="btn btn-outline btn-chico" data-oc-pdf="' + Number(o.id) + '">PDF</button></div></td></tr>';
    }).join('');
    const total = LISTA.filter(o => o.estado !== 'cancelada').reduce((t, o) => t + o.total, 0);
    cont.innerHTML = '<div class="tabla-scroll tabla-dinero-caja"><table class="tabla-resumen tabla-dinero"><thead><tr><th>Estado</th><th>Folio</th><th>Fecha</th><th>Proveedor</th><th>Centro de costos</th><th>Concepto</th><th class="st-num">Total</th><th>Pago</th><th></th></tr></thead><tbody>'
      + filas + '</tbody><tfoot><tr><td colspan="6"><b>Totales · ' + LISTA.length + '</b> <small class="util-45">(sin canceladas)</small></td><td class="st-num"><b>' + dinero(total) + '</b></td><td colspan="2"></td></tr></tfoot></table></div>';
  }

  // ---------- Ventana: captura / consulta ----------
  const opciones = (lista, sel, txt) => lista.map(x => '<option value="' + esc(String(x.v)) + '"' + (String(x.v) === String(sel) ? ' selected' : '') + '>' + esc(txt(x)) + '</option>').join('');
  function pintarSelects(o) {
    $('oc-proveedor').innerHTML = '<option value="">Selecciona…</option>' + opciones(PROVEEDORES.filter(p => p.activo || p.id === o?.proveedor_id).map(p => ({ v: p.id, n: p.nombre })), o?.proveedor_id, x => x.n) + '<option value="__nuevo">+ Nuevo proveedor…</option>';
    $('oc-centro').innerHTML = '<option value="">Selecciona…</option>' + opciones(CENTROS.filter(c => c.activo || c.id === o?.centro_id).map(c => ({ v: c.id, n: c.nombre + (c.responsable ? ' · ' + c.responsable : '') })), o?.centro_id, x => x.n);
    $('oc-categoria').innerHTML = opciones(CATEGORIAS.map(c => ({ v: c.clave, n: c.nombre })), o?.categoria || 'otro', x => x.n);
  }
  const filaHTML = (p = {}) => '<tr class="oc-fila"><td class="oc-num"></td>'
    + '<td><input type="number" class="oc-cantidad" min="0.001" step="any" value="' + esc(String(p.cantidad ?? 1)) + '" aria-label="Cantidad"></td>'
    + '<td><input class="oc-descripcion" maxlength="300" value="' + esc(p.descripcion || '') + '" placeholder="Qué se compra o qué servicio" aria-label="Descripción"></td>'
    + '<td><input class="oc-unidad" maxlength="30" value="' + esc(p.unidad || '') + '" placeholder="PZA" aria-label="Unidad"></td>'
    + '<td><input class="oc-clave" maxlength="60" value="' + esc(p.clave || '') + '" aria-label="Clave artículo"></td>'
    + '<td><input type="number" class="oc-precio" min="0.01" step="0.01" value="' + esc(p.precio === undefined ? '' : String(p.precio)) + '" placeholder="Precio" aria-label="Precio unitario"></td>'
    + '<td class="st-num oc-importe"></td><td><button type="button" class="btn-eliminar oc-quitar" title="Quitar partida" aria-label="Quitar partida">🗑</button></td></tr>';
  const modo = () => document.querySelector('input[name="oc-iva"]:checked')?.value || null;
  function recolectar() {
    return [...document.querySelectorAll('#oc-filas .oc-fila')].map(f => ({ cantidad: Number(f.querySelector('.oc-cantidad').value), descripcion: f.querySelector('.oc-descripcion').value.trim(),
      unidad: f.querySelector('.oc-unidad').value.trim(), clave: f.querySelector('.oc-clave').value.trim(), precio: f.querySelector('.oc-precio').value === '' ? 0 : Number(f.querySelector('.oc-precio').value) }));
  }
  function recalcular() {
    const filas = [...document.querySelectorAll('#oc-filas .oc-fila')];
    filas.forEach((f, i) => { f.querySelector('.oc-num').textContent = i + 1; const c = Number(f.querySelector('.oc-cantidad').value) || 0, p = Number(f.querySelector('.oc-precio').value) || 0; f.querySelector('.oc-importe').textContent = dinero(Importes.importeDe(c, p)); });
    const items = recolectar().map(p => ({ importe: Importes.importeDe(p.cantidad || 0, p.precio || 0) }));
    const m = modo();
    $('oc-totales').innerHTML = m ? Importes.filasTotales(Importes.calcular(items, m, 16), m, 16).map(([e, c], i, a) => '<tr class="' + (i === a.length - 1 ? 'gc-fila-total' : '') + '"><th>' + esc(e) + '</th><td>' + (i === a.length - 1 ? '<b>' + dinero(c / 100) + '</b>' : dinero(c / 100)) + '</td></tr>').join('')
      : '<tr><td colspan="2" class="util-45">Elige el IVA para ver los totales.</td></tr>';
  }
  async function abrir(id) {
    try { await catalogos(); ACTUAL = id ? await pedir('/compras/ordenes/' + Number(id)) : null; } catch (err) { toast(err.message); return; }
    const o = ACTUAL, editable = !o || o.estado === 'borrador';
    $('oc-titulo').textContent = o ? o.folio + ' · ' + o.proveedor_nombre : 'Nueva orden de compra';
    $('oc-kicker').textContent = o ? 'ORDEN DE COMPRA · ' + ESTADOS[o.estado][0].toUpperCase() : 'ORDEN DE COMPRA · CM-F-03';
    pintarSelects(o);
    $('oc-factura-a').value = o?.factura_a || 'SANEADREN';
    $('oc-fecha').value = o?.fecha || hoy();
    $('oc-requerida').value = o?.fecha_requerida || '';
    $('oc-entrega').value = o?.entrega || '';
    $('oc-lead').value = o?.lead_id || '';
    $('oc-nota').value = o?.nota || '';
    $('oc-observaciones').value = o?.observaciones || '';
    $('oc-solicitante').value = o?.solicitante_nombre || USUARIO_ACTUAL?.nombre || '';
    $('oc-cargo').value = o?.solicitante_cargo || '';
    document.querySelectorAll('input[name="oc-iva"]').forEach(r => { r.checked = r.value === (o?.iva_modo || 'mas_iva'); });
    $('oc-filas').innerHTML = (o?.partidas?.length ? o.partidas : [{}]).map(filaHTML).join('');
    recalcular();
    // Estado y bloqueo
    const est = $('oc-estado');
    est.hidden = !o || o.estado === 'borrador';
    if (o?.estado === 'autorizada') est.innerHTML = '✔ Autorizada por ' + esc(o.autorizada_por_nombre || '') + ' el ' + esc(fechaTxt(String(o.autorizada_at || '').slice(0, 10))) + '. Está en Cuentas por pagar: ' + (o.saldo > 0 ? 'falta pagar <b>' + dinero(o.saldo) + '</b>' : '<b>pagada</b>') + '. Ya no se puede editar.';
    if (o?.estado === 'cancelada') est.innerHTML = '✖ Cancelada el ' + esc(fechaTxt(String(o.cancelada_at || '').slice(0, 10))) + '. Motivo: ' + esc(o.motivo_cancelacion || '—');
    $('oc-cuerpo').querySelectorAll('input,select,textarea').forEach(x => { x.disabled = !editable; });
    $('oc-agregar').hidden = !editable;
    document.querySelectorAll('#oc-filas .oc-quitar').forEach(b => { b.hidden = !editable; });
    const bt = (id, txt, cl, extra = '') => '<button type="button" class="btn ' + cl + '" id="' + id + '"' + extra + '>' + txt + '</button>';
    $('oc-acciones').innerHTML = (editable ? bt('oc-guardar', 'Guardar borrador', 'btn-outline') + bt('oc-guardar-pdf', 'Guardar y descargar PDF', 'btn-primario') : bt('oc-pdf', 'Descargar PDF', 'btn-primario'))
      + (o ? bt('oc-excel', 'Excel', 'btn-outline solo-admin') : '')
      + (o && o.estado === 'borrador' && esAdmin() ? bt('oc-autorizar', '✔ Autorizar y pasar a Cuentas por pagar', 'btn-verde') : '')
      + (o && o.estado === 'borrador' && !esAdmin() ? '<span class="ayuda">La autoriza un administrador.</span>' : '')
      + (o && (o.estado === 'borrador' || (o.estado === 'autorizada' && esAdmin())) ? bt('oc-cancelar', 'Cancelar orden', 'btn-eliminar') : '');
    abrirVentana('overlay-compra');
  }
  const datosForm = () => ({ version: ACTUAL?.version, proveedor_id: Number($('oc-proveedor').value) || null, centro_id: Number($('oc-centro').value) || null, categoria: $('oc-categoria').value,
    factura_a: $('oc-factura-a').value, fecha: $('oc-fecha').value, fecha_requerida: $('oc-requerida').value || null, entrega: $('oc-entrega').value, lead_id: Number($('oc-lead').value) || null,
    nota: $('oc-nota').value, observaciones: $('oc-observaciones').value, solicitante_nombre: $('oc-solicitante').value, solicitante_cargo: $('oc-cargo').value, iva_modo: modo(), partidas: recolectar() });
  async function guardar(descargar) {
    const d = datosForm();
    if (!d.proveedor_id) { toast('Elige el proveedor'); $('oc-proveedor').focus(); return; }
    if (!d.centro_id) { toast('Elige el centro de costos'); $('oc-centro').focus(); return; }
    if (!d.iva_modo) { toast('Elige el IVA de la orden'); return; }
    const mala = d.partidas.findIndex(p => !p.descripcion || !(p.cantidad > 0) || !(p.precio > 0));
    if (mala >= 0) { toast('Partida ' + (mala + 1) + ': escribe cantidad, descripción y precio (mayor a $0)'); return; }
    const o = ACTUAL ? await pedir('/compras/ordenes/' + ACTUAL.id, 'PUT', d) : await pedir('/compras/ordenes', 'POST', d);
    ACTUAL = o;
    toast((d.version ? 'Orden ' : 'Orden de compra creada: ') + o.folio + (d.version ? ' guardada' : ''));
    if (descargar) await pdf(o);
    await abrir(o.id); cargar();
  }

  // ---------- Documentos (formato CM-F-03) ----------
  let logoCache;
  const logo = () => (logoCache ||= fetch('/logo-saneadren.png').then(r => { if (!r.ok) throw new Error('No se pudo cargar el logo'); return r.arrayBuffer(); }).then(b => new Uint8Array(b)).catch(e => { logoCache = null; throw e; }));
  async function pdf(o) {
    const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true }), M = 36, W = 612 - 2 * M;
    const img = await logo().catch(() => null);
    const caja = (x, y, w, h, fill) => { doc.setDrawColor(60); doc.setLineWidth(0.6); if (fill) { doc.setFillColor(...fill); doc.rect(x, y, w, h, 'FD'); } else doc.rect(x, y, w, h); };
    const t = (s, x, y, o2 = {}) => { doc.setFont('helvetica', o2.b ? 'bold' : 'normal'); doc.setFontSize(o2.s || 9); doc.setTextColor(25); doc.text(String(s ?? ''), x, y, o2.al ? { align: o2.al } : undefined); };
    // Encabezado: logo · ORDEN DE COMPRAS · código y revisiones
    caja(M, M, 130, 70); if (img) doc.addImage(img, 'PNG', M + 8, M + 18, 114, 114 * 265 / 942, 'logo', 'FAST');
    caja(M + 130, M, 220, 70); t('ORDEN DE COMPRAS', M + 240, M + 32, { b: true, s: 15, al: 'center' }); t(o.folio, M + 240, M + 52, { b: true, s: 11, al: 'center' });
    const cx = M + 350, cw = W - 350;
    [['Página', ''], ['Código:', 'CM-F-03'], ['Fecha de elaboración:', '19/08/2023'], ['Revisión:', '0'], ['Fecha de revisión:', '26/08/2023']].forEach(([a, b], i) => {
      caja(cx, M + i * 14, cw, 14); t(a, cx + 4, M + i * 14 + 10, { s: 7.5 }); t(b, cx + cw - 4, M + i * 14 + 10, { s: 7.5, b: true, al: 'right' });
    });
    // Datos generales
    let y = M + 82;
    const celda = (etq, val, x, w, h = 30) => { caja(x, y, w, h); t(etq, x + 4, y + 10, { s: 7, b: true }); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(doc.splitTextToSize(String(val || ''), w - 8).slice(0, 2), x + 4, y + 21); };
    celda('PROVEEDOR', o.proveedor_nombre + (o.proveedor_rfc ? ' · RFC ' + o.proveedor_rfc : ''), M, W * 0.42); celda('CENTRO DE COSTOS', o.centro_nombre, M + W * 0.42, W * 0.25); celda('FACTURA A', o.factura_a, M + W * 0.67, W * 0.33); y += 30;
    celda('ENTREGA', o.entrega || '', M, W * 0.42); celda('FECHA', fechaTxt(o.fecha), M + W * 0.42, W * 0.25); celda('FECHA REQUERIDA', fechaTxt(o.fecha_requerida), M + W * 0.67, W * 0.33); y += 30;
    celda('NOTA', o.nota || '', M, W * 0.67); celda('ORDEN DE SERVICIO', o.orden_folio || '—', M + W * 0.67, W * 0.33); y += 38;
    // Partidas
    doc.autoTable({ startY: y, margin: { left: M, right: M }, theme: 'grid',
      head: [['PARTIDA', 'CANTIDAD', 'DESCRIPCIÓN', 'UNIDAD', 'CLAVE ARTÍCULO', 'PRECIO', 'IMPORTE']],
      body: o.partidas.map((p, i) => [i + 1, p.cantidad, p.descripcion, p.unidad || '', p.clave || '', dinero(p.precio), dinero(p.importe)]),
      styles: { fontSize: 7.5, cellPadding: 2.4, lineColor: [90, 90, 90], lineWidth: 0.4, textColor: 25 }, headStyles: { fillColor: [246, 177, 3], textColor: 20, fontStyle: 'bold', halign: 'center' },
      columnStyles: { 0: { cellWidth: 44, halign: 'center' }, 1: { cellWidth: 50, halign: 'center' }, 3: { cellWidth: 46 }, 4: { cellWidth: 62 }, 5: { cellWidth: 66, halign: 'right' }, 6: { cellWidth: 72, halign: 'right' } } });
    y = doc.lastAutoTable.finalY + 6;
    const filas = Importes.filasTotales({ subtotal_cent: o.subtotal_cent, iva_cent: o.iva_cent, total_cent: o.total_cent }, o.iva_modo, o.iva_tasa)
      .map(([e, c], i, a) => [i === a.length - 1 ? 'TOTAL A PAGAR' : e.toUpperCase(), dinero(c / 100)]);
    if (y + filas.length * 16 + 120 > 760) { doc.addPage(); y = M; }
    filas.forEach(([e, v], i) => { const last = i === filas.length - 1; caja(M + W - 210, y, 130, 16, last ? [246, 177, 3] : null); caja(M + W - 80, y, 80, 16, last ? [246, 177, 3] : null); t(e, M + W - 205, y + 11, { s: 8, b: true }); t(v, M + W - 4, y + 11, { s: 8.5, b: last, al: 'right' }); y += 16; });
    t('Son: ' + Importes.enLetras(o.total_cent), M, y + 10, { s: 8, b: true }); y += 20;
    // Observaciones
    caja(M, y, W, 42); t('OBSERVACIONES:', M + 4, y + 10, { s: 7.5, b: true }); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text(doc.splitTextToSize(o.observaciones || '', W - 10).slice(0, 3), M + 4, y + 21); y += 52;
    // Firmas: área solicitante, gerencia de área y dirección en un solo renglón
    y += 12;
    if (y + 100 > 772) { doc.addPage(); y = M; }
    t('ÁREA SOLICITANTE:', M, y, { s: 8, b: true }); t('AUTORIZACIÓN:', M + W / 3 + 10, y, { s: 8, b: true }); y += 42;
    const ancho = W / 3 - 20;
    [0, 1, 2].forEach(n => doc.line(M + n * (W / 3) + 5, y, M + n * (W / 3) + 5 + ancho, y));
    const centro = n => M + n * (W / 3) + 5 + ancho / 2;
    t(o.solicitante_nombre || 'NOMBRE Y FIRMA', centro(0), y + 11, { s: 8, b: true, al: 'center' }); t(o.solicitante_cargo ? 'CARGO: ' + o.solicitante_cargo : 'CARGO:', centro(0), y + 21, { s: 7, al: 'center' });
    t('GERENCIA DE ÁREA', centro(1), y + 11, { s: 8, b: true, al: 'center' }); t('NOMBRE Y FIRMA', centro(1), y + 21, { s: 7, al: 'center' });
    t('DIRECCIÓN', centro(2), y + 11, { s: 8, b: true, al: 'center' }); t('NOMBRE Y FIRMA', centro(2), y + 21, { s: 7, al: 'center' });
    if (o.estado === 'autorizada') t('Autorizada en el CRM por ' + (o.autorizada_por_nombre || '') + ' el ' + fechaTxt(String(o.autorizada_at || '').slice(0, 10)), M, y + 38, { s: 7.5 });
    if (o.estado === 'cancelada') { doc.setTextColor(184, 68, 58); doc.setFontSize(40); doc.text('CANCELADA', 306, 420, { align: 'center', angle: 30 }); }
    // Número real de hojas en el encabezado (y al pie de cada hoja)
    const hojas = doc.getNumberOfPages();
    doc.setPage(1); t(hojas === 1 ? '1 de 1' : '1 de ' + hojas, cx + cw - 4, M + 10, { s: 7.5, b: true, al: 'right' });
    for (let i = 1; i <= hojas; i++) { doc.setPage(i); t(o.folio + ' · Hoja ' + i + ' de ' + hojas, 612 - M, 780, { s: 7, al: 'right' }); }
    doc.save('orden_compra_' + o.folio + '.pdf');
  }
  async function excel(o) {
    let ExcelJS; try { ExcelJS = await Finanzas.cargarExcelJS(); } catch (err) { toast(err.message); return; }
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Formato-ORDEN COMPRA', { pageSetup: { paperSize: 1, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.columns = [{ width: 9 }, { width: 10 }, { width: 46 }, { width: 9 }, { width: 14 }, { width: 14 }, { width: 16 }];
    const borde = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    const amarillo = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6B103' } };
    const img = await logo().catch(() => null);
    if (img) ws.addImage(wb.addImage({ buffer: img, extension: 'png' }), { tl: { col: 0.1, row: 0.3 }, ext: { width: 150, height: 42 } });
    ws.mergeCells('C1:C3'); Object.assign(ws.getCell('C1'), { value: 'ORDEN DE COMPRAS\n' + o.folio }); ws.getCell('C1').font = { bold: true, size: 14 }; ws.getCell('C1').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    [['Código:', 'CM-F-03'], ['Revisión:', '0'], ['Fecha de elaboración:', '19/08/2023']].forEach(([a, b], i) => { ws.mergeCells(`D${i + 1}:E${i + 1}`); ws.getCell(`D${i + 1}`).value = a; ws.mergeCells(`F${i + 1}:G${i + 1}`); ws.getCell(`F${i + 1}`).value = b; ws.getCell(`F${i + 1}`).font = { bold: true }; });
    ws.getRow(1).height = 22; ws.getRow(2).height = 22; ws.getRow(3).height = 22;
    const dato = (fila, etq, val, col1, col2) => { ws.getCell(col1 + fila).value = etq; ws.getCell(col1 + fila).font = { bold: true, size: 8 }; ws.getCell(col2 + fila).value = val; };
    dato(5, 'PROVEEDOR', o.proveedor_nombre, 'A', 'C'); dato(5, 'CENTRO DE COSTOS', o.centro_nombre, 'E', 'F'); dato(6, 'ENTREGA', o.entrega || '', 'A', 'C'); dato(6, 'FACTURA A', o.factura_a, 'E', 'F');
    dato(7, 'NOTA', o.nota || '', 'A', 'C'); dato(7, 'FECHA', fechaTxt(o.fecha), 'E', 'F'); dato(8, 'ORDEN DE SERVICIO', o.orden_folio || '', 'A', 'C'); dato(8, 'FECHA REQUERIDA', fechaTxt(o.fecha_requerida), 'E', 'F');
    const cab = ws.getRow(10); cab.values = ['PARTIDA', 'CANTIDAD', 'DESCRIPCIÓN', 'UNIDAD', 'CLAVE ARTÍCULO', 'PRECIO', 'IMPORTE'];
    cab.eachCell(c => { c.font = { bold: true }; c.fill = amarillo; c.border = borde; c.alignment = { horizontal: 'center' }; });
    o.partidas.forEach((p, i) => {
      const n = 11 + i, r = ws.getRow(n);
      r.values = [i + 1, p.cantidad, p.descripcion, p.unidad || '', p.clave || '', p.precio, { formula: `B${n}*F${n}`, result: p.importe }];
      r.eachCell({ includeEmpty: true }, c => { c.border = borde; }); r.getCell(3).alignment = { wrapText: true };
      r.getCell(6).numFmt = r.getCell(7).numFmt = '"$"#,##0.00';
    });
    let f = 11 + o.partidas.length + 1;
    const suma = `SUM(G11:G${f - 2})`, totales = Importes.filasTotales({ subtotal_cent: o.subtotal_cent, iva_cent: o.iva_cent, total_cent: o.total_cent }, o.iva_modo, o.iva_tasa);
    const formulas = o.iva_modo === 'mas_iva' ? [suma, `ROUND(G${f}*${o.iva_tasa}/100,2)`, `G${f}+G${f + 1}`] : o.iva_modo === 'incluido' ? [`ROUND(${suma}*100/(100+${o.iva_tasa}),2)`, `${suma}-G${f}`, suma] : [suma];
    totales.forEach(([e, c], i) => { const last = i === totales.length - 1; ws.mergeCells(`E${f + i}:F${f + i}`); ws.getCell(`E${f + i}`).value = last ? 'TOTAL A PAGAR' : e.toUpperCase(); ws.getCell(`E${f + i}`).font = { bold: true };
      const cel = ws.getCell(`G${f + i}`); cel.value = { formula: formulas[i], result: c / 100 }; cel.numFmt = '"$"#,##0.00'; cel.font = { bold: last }; if (last) { cel.fill = amarillo; ws.getCell(`E${f + i}`).fill = amarillo; } });
    f += totales.length + 1;
    ws.getCell('A' + f).value = 'OBSERVACIONES:'; ws.getCell('A' + f).font = { bold: true }; ws.mergeCells(`A${f + 1}:G${f + 3}`); ws.getCell('A' + (f + 1)).value = o.observaciones || ''; ws.getCell('A' + (f + 1)).alignment = { wrapText: true, vertical: 'top' }; ws.getCell('A' + (f + 1)).border = borde;
    f += 5; ws.getCell('A' + f).value = 'ÁREA SOLICITANTE:'; ws.getCell('A' + f).font = { bold: true };
    ws.getCell('C' + (f + 2)).value = 'NOMBRE: ' + (o.solicitante_nombre || ''); ws.getCell('C' + (f + 3)).value = 'CARGO: ' + (o.solicitante_cargo || ''); ws.getCell('A' + (f + 3)).value = 'FIRMA';
    f += 5; ws.getCell('A' + f).value = 'AUTORIZACIÓN:'; ws.getCell('A' + f).font = { bold: true };
    ws.getCell('C' + (f + 3)).value = 'GERENCIA DE ÁREA · NOMBRE Y FIRMA'; ws.getCell('F' + (f + 3)).value = 'DIRECCIÓN · NOMBRE Y FIRMA';
    const centros = wb.addWorksheet('C.C.'); centros.columns = [{ header: 'No.', width: 6 }, { header: 'Centro', width: 24 }, { header: 'Responsable', width: 28 }];
    CENTROS.forEach((c, i) => centros.addRow([i + 1 + '.-', c.nombre, c.responsable || '']));
    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'orden_compra_' + o.folio + '.xlsx');
  }

  // ---------- Centros de costo (administración) ----------
  async function centros() {
    await catalogos();
    const lista = CENTROS.map((c, i) => (i + 1) + '. ' + c.nombre + (c.responsable ? ' · ' + c.responsable : '') + (c.activo ? '' : ' (inactivo)')).join('\n');
    const nombre = await solicitarDialogo({ titulo: 'Centros de costo', mensaje: lista + '\n\nPara agregar uno, escribe "Nombre · Responsable". Para editar uno, escribe su número, por ejemplo "3 · Subdirección · Luis Perea", o "3 · baja" para desactivarlo.', aceptar: 'Guardar', campo: { tipo: 'text', etiqueta: 'Centro de costos' } });
    if (!nombre) return;
    const partes = nombre.split('·').map(x => x.trim());
    try {
      if (/^\d+$/.test(partes[0]) && CENTROS[Number(partes[0]) - 1]) {
        const c = CENTROS[Number(partes[0]) - 1];
        const cuerpo = partes[1]?.toLowerCase() === 'baja' ? { activo: false } : partes[1]?.toLowerCase() === 'alta' ? { activo: true } : { nombre: partes[1] || c.nombre, responsable: partes[2] ?? c.responsable };
        await pedir('/compras/centros/' + c.id, 'PUT', cuerpo); toast('Centro de costos actualizado');
      } else { await pedir('/compras/centros', 'POST', { nombre: partes[0], responsable: partes[1] || '' }); toast('Centro de costos agregado'); }
    } catch (err) { toast(err.message); }
  }

  // ---------- Eventos ----------
  let tBuscar;
  $('oc-buscar').addEventListener('input', () => { clearTimeout(tBuscar); tBuscar = setTimeout(cargar, 300); });
  $('oc-filtro').addEventListener('change', cargar);
  $('oc-nueva').addEventListener('click', () => abrir(null));
  $('oc-centros').addEventListener('click', centros);
  $('oc-lista').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ocAbrir) abrir(Number(b.dataset.ocAbrir));
    if (b.dataset.ocPdf) { try { await pdf(await pedir('/compras/ordenes/' + Number(b.dataset.ocPdf))); } catch (err) { toast(err.message); } }
  });
  $('oc-agregar').addEventListener('click', () => { $('oc-filas').insertAdjacentHTML('beforeend', filaHTML()); recalcular(); $('oc-filas').lastElementChild.querySelector('.oc-descripcion').focus(); });
  $('oc-filas').addEventListener('input', recalcular);
  $('oc-filas').addEventListener('click', e => { const q = e.target.closest('.oc-quitar'); if (!q) return; if (document.querySelectorAll('#oc-filas .oc-fila').length === 1) { toast('La orden necesita al menos una partida'); return; } q.closest('tr').remove(); recalcular(); });
  document.querySelectorAll('input[name="oc-iva"]').forEach(r => r.addEventListener('change', recalcular));
  $('oc-proveedor').addEventListener('change', async e => {
    if (e.target.value !== '__nuevo') { const p = PROVEEDORES.find(x => String(x.id) === e.target.value); if (p && CATEGORIAS.some(c => c.clave === p.categoria)) $('oc-categoria').value = p.categoria; return; }
    e.target.value = '';
    const nombre = await solicitarDialogo({ titulo: 'Nuevo proveedor', mensaje: 'Nombre o razón social del proveedor. Sus datos (RFC, crédito) se completan en Cuentas por pagar → Proveedores.', aceptar: 'Agregar', campo: { tipo: 'text', etiqueta: 'Proveedor' } });
    if (!nombre) return;
    try { const p = await pedir('/finanzas/proveedores', 'POST', { nombre, categoria: $('oc-categoria').value || 'otro' }); await catalogos(); pintarSelects({ ...(ACTUAL || {}), ...datosForm(), proveedor_id: p.id }); toast('Proveedor agregado'); }
    catch (err) { toast(err.message); }
  });
  $('oc-acciones').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    b.disabled = true;
    try {
      if (b.id === 'oc-guardar') await guardar(false);
      if (b.id === 'oc-guardar-pdf') await guardar(true);
      if (b.id === 'oc-pdf') await pdf(ACTUAL);
      if (b.id === 'oc-excel') await excel(ACTUAL);
      if (b.id === 'oc-autorizar') {
        if (!await solicitarDialogo({ titulo: 'Autorizar orden de compra', mensaje: 'La orden ' + ACTUAL.folio + ' por ' + dinero(ACTUAL.total) + ' pasa a Cuentas por pagar como factura pendiente de ' + ACTUAL.proveedor_nombre + '. Después ya no se puede editar.', aceptar: 'Autorizar' })) return;
        const r = await pedir('/compras/ordenes/' + ACTUAL.id + '/autorizar', 'POST', {}); toast('Orden autorizada: ya está en Cuentas por pagar'); await abrir(r.orden.id); cargar();
      }
      if (b.id === 'oc-cancelar') {
        const motivo = await solicitarDialogo({ titulo: 'Cancelar orden de compra', mensaje: ACTUAL.estado === 'autorizada' ? 'También se cancela su cuenta por pagar.' : 'La orden queda cancelada (se conserva en la lista).', aceptar: 'Cancelar orden', campo: { tipo: 'text', etiqueta: 'Motivo' } });
        if (!motivo) return;
        const r = await pedir('/compras/ordenes/' + ACTUAL.id + '/cancelar', 'POST', { motivo }); toast('Orden cancelada'); await abrir(r.orden.id); cargar();
      }
    } catch (err) { toast(err.message); } finally { b.disabled = false; }
  });
  return { cargar };
})();
window.Compras = Compras;
