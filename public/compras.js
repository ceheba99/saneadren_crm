/* Órdenes de compra (formato CM-F-03): lista, captura (borrador), autorización (pasa a Cuentas por pagar),
   cancelación, centros de costo y descarga en PDF / Excel. Servidor: server/compras.js */
const Compras = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t); // app.js se carga después
  const dinero = n => formatoMoneda(n);
  const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  const fechaTxt = f => (f ? f.split('-').reverse().join('/') : '—');
  const esAdmin = () => USUARIO_ACTUAL?.rol === 'admin';
  const ESTADOS = { borrador: ['Borrador · por autorizar', 'parcial'], autorizada: ['Autorizada', 'programada'], cancelada: ['Cancelada', 'vencida'] };
  let LISTA = [], ACTUAL = null, PROVEEDORES = [], CENTROS = [], CATEGORIAS = [], UNIDADES = [], consulta = 0;
  const json = async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'No se pudo completar'), { datos: j }); return j; };
  const pedir = (ruta, metodo = 'GET', cuerpo) => api(ruta, metodo === 'GET' ? undefined : { method: metodo, body: JSON.stringify(cuerpo || {}) }).then(json);

  async function catalogos() {
    [PROVEEDORES, CENTROS, CATEGORIAS, UNIDADES] = await Promise.all([pedir('/finanzas/proveedores'), pedir('/compras/centros'), pedir('/finanzas/categorias'), pedir('/compras/unidades')]);
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
      // ¿Autorizada? Solo al autorizarla se vuelve deuda (factura pendiente en Cuentas por pagar).
      const deuda = o.estado === 'autorizada' ? '<span class="oc-deuda si" title="Ya es deuda: está en Cuentas por pagar">✔ Sí</span>'
        : o.estado === 'cancelada' ? '<span class="util-45">—</span>'
        : esAdmin() ? '<button type="button" class="btn btn-verde btn-chico" data-oc-autorizar="' + Number(o.id) + '">✔ Autorizar</button>' : '<span class="oc-deuda no">Por autorizar</span>';
      return '<tr class="' + (o.estado === 'cancelada' ? 'fila-cancelada' : '') + '"><td><span class="estado-cxc ' + cl + '">' + esc(txt) + '</span></td><td><b>' + esc(o.folio) + '</b></td><td>' + esc(fechaTxt(o.fecha)) + '</td>'
        + '<td>' + esc(o.proveedor_nombre) + '</td><td>' + esc(o.centro_nombre) + '</td><td>' + esc(o.partidas[0]?.descripcion || '') + (o.partidas.length > 1 ? ' <small class="util-45">y ' + (o.partidas.length - 1) + ' más</small>' : '') + '</td>'
        + '<td class="st-num"><b>' + dinero(o.total) + '</b></td><td>' + deuda + '</td><td>' + esc(pago) + '</td>'
        + '<td class="celda-acciones"><div class="acciones-fila"><button type="button" class="btn btn-outline btn-chico" data-oc-abrir="' + Number(o.id) + '">Abrir</button><button type="button" class="btn btn-outline btn-chico" data-oc-pdf="' + Number(o.id) + '">PDF</button></div></td></tr>';
    }).join('');
    const total = LISTA.filter(o => o.estado !== 'cancelada').reduce((t, o) => t + o.total, 0);
    const porAutorizar = LISTA.filter(o => o.estado === 'borrador');
    const aviso = porAutorizar.length ? '<p class="cuentas-aviso oc-por-autorizar">' + porAutorizar.length + (porAutorizar.length === 1 ? ' orden está' : ' órdenes están') + ' por autorizar (' + dinero(porAutorizar.reduce((t, o) => t + o.total, 0)) + '). '
      + (esAdmin() ? 'Al autorizarlas se vuelven deuda: pasan a Cuentas por pagar como factura pendiente del proveedor.' : 'Las autoriza un administrador; hasta entonces no son deuda.') + '</p>' : '';
    cont.innerHTML = aviso + '<div class="tabla-scroll tabla-dinero-caja"><table class="tabla-resumen tabla-dinero"><thead><tr><th>Estado</th><th>Folio</th><th>Fecha</th><th>Proveedor</th><th>Centro de costos</th><th>Concepto</th><th class="st-num">Total</th><th>¿Autorizada?</th><th>Pago</th><th></th></tr></thead><tbody>'
      + filas + '</tbody><tfoot><tr><td colspan="6"><b>Totales · ' + LISTA.length + '</b> <small class="util-45">(sin canceladas)</small></td><td class="st-num"><b>' + dinero(total) + '</b></td><td colspan="3"></td></tr></tfoot></table></div>';
  }

  // ---------- Ventana: captura / consulta ----------
  const opciones = (lista, sel, txt) => lista.map(x => '<option value="' + esc(String(x.v)) + '"' + (String(x.v) === String(sel) ? ' selected' : '') + '>' + esc(txt(x)) + '</option>').join('');
  function pintarSelects(o) {
    $('oc-proveedor').innerHTML = '<option value="">Selecciona…</option>' + opciones(PROVEEDORES.filter(p => p.activo || p.id === o?.proveedor_id).map(p => ({ v: p.id, n: p.nombre })), o?.proveedor_id, x => x.n) + '<option value="__nuevo">+ Nuevo proveedor…</option>';
    $('oc-centro').innerHTML = '<option value="">Selecciona…</option>' + opciones(CENTROS.filter(c => c.activo || c.id === o?.centro_id).map(c => ({ v: c.id, n: c.nombre + (c.responsable ? ' · ' + c.responsable : '') })), o?.centro_id, x => x.n);
    $('oc-categoria').innerHTML = opciones(CATEGORIAS.map(c => ({ v: c.clave, n: c.nombre })), o?.categoria || 'otro', x => x.n);
  }
  // Unidades: las activas del catálogo; si la partida trae una que ya no está (o escrita a mano antes), se respeta.
  const opcionesUnidad = sel => {
    const activas = UNIDADES.filter(u => u.activo);
    const extra = sel && !activas.some(u => u.clave.toLowerCase() === String(sel).toLowerCase()) ? [{ clave: sel, nombre: '' }] : [];
    return '<option value="">—</option>' + [...activas, ...extra].map(u => '<option value="' + esc(u.clave) + '"' + (sel && u.clave.toLowerCase() === String(sel).toLowerCase() ? ' selected' : '') + '>'
      + esc(u.nombre ? u.nombre + ' (' + u.clave + ')' : u.clave) + '</option>').join('') + '<option value="__nueva">+ Agregar unidad…</option>';
  };
  const filaHTML = (p = {}) => '<tr class="oc-fila"><td class="oc-num"></td>'
    + '<td><input type="number" class="oc-cantidad" min="0.001" step="any" value="' + esc(String(p.cantidad ?? 1)) + '" aria-label="Cantidad"></td>'
    + '<td><input class="oc-descripcion" maxlength="300" value="' + esc(p.descripcion || '') + '" placeholder="Qué se compra o qué servicio" aria-label="Descripción"></td>'
    + '<td><select class="oc-unidad" aria-label="Unidad">' + opcionesUnidad(p.unidad) + '</select></td>'
    + '<td><input class="oc-clave" maxlength="60" value="' + esc(p.clave || '') + '" aria-label="Clave artículo"></td>'
    + '<td><input type="number" class="oc-precio" min="0.01" step="0.01" value="' + esc(p.precio === undefined ? '' : String(p.precio)) + '" placeholder="Precio" aria-label="Precio unitario"></td>'
    + '<td class="st-num oc-importe"></td><td><button type="button" class="btn-eliminar oc-quitar" title="Quitar partida" aria-label="Quitar partida">🗑</button></td></tr>';
  const modo = () => document.querySelector('input[name="oc-iva"]:checked')?.value || null;
  function recolectar() {
    return [...document.querySelectorAll('#oc-filas .oc-fila')].map(f => ({ cantidad: Number(f.querySelector('.oc-cantidad').value), descripcion: f.querySelector('.oc-descripcion').value.trim(),
      unidad: f.querySelector('.oc-unidad').value.replace('__nueva', ''), clave: f.querySelector('.oc-clave').value.trim(), precio: f.querySelector('.oc-precio').value === '' ? 0 : Number(f.querySelector('.oc-precio').value) }));
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
    if (o) pintarExpediente(o.id); else { $('oc-expediente').hidden = true; $('oc-expediente').innerHTML = ''; }
    abrirVentana('overlay-compra');
  }
  const datosForm = () => ({ version: ACTUAL?.version, proveedor_id: Number($('oc-proveedor').value) || null, centro_id: Number($('oc-centro').value) || null, categoria: $('oc-categoria').value,
    factura_a: $('oc-factura-a').value, fecha: $('oc-fecha').value, fecha_requerida: $('oc-requerida').value || null, lead_id: Number($('oc-lead').value) || null,
    nota: $('oc-nota').value, observaciones: $('oc-observaciones').value, solicitante_nombre: $('oc-solicitante').value, solicitante_cargo: $('oc-cargo').value, iva_modo: modo(), partidas: recolectar() });
  async function guardar(descargar) {
    const d = datosForm();
    if (!d.proveedor_id) { toast('Elige el proveedor'); $('oc-proveedor').focus(); return; }
    if (!d.centro_id) { toast('Elige el centro de costos'); $('oc-centro').focus(); return; }
    if (!d.iva_modo) { toast('Elige el IVA de la orden'); return; }
    const mala = d.partidas.findIndex(p => !p.descripcion || !(p.cantidad > 0) || !(p.precio > 0));
    if (mala >= 0) { toast('Partida ' + (mala + 1) + ': escribe cantidad, descripción y precio (mayor a $0)'); return; }
    let o;
    if (ACTUAL) o = await pedir('/compras/ordenes/' + ACTUAL.id, 'PUT', d);
    else {
      try { o = await pedir('/compras/ordenes', 'POST', d); }
      catch (err) {
        // La misma orden ya existe (doble clic o se capturó otra vez): se pregunta antes de crear otra.
        if (err.datos?.codigo !== 'POSIBLE_DUPLICADO') throw err;
        if (!await solicitarDialogo({ titulo: '¿Es otra compra?', mensaje: err.message + ' Si es la misma, cancela y búscala en la lista.', aceptar: 'Sí, es otra compra' })) return;
        o = await pedir('/compras/ordenes', 'POST', { ...d, forzar: true });
      }
    }
    ACTUAL = o;
    toast((d.version ? 'Orden ' : 'Orden de compra creada: ') + o.folio + (d.version ? ' guardada' : ''));
    if (descargar) await pdf(o);
    await abrir(o.id); cargar();
  }

  // ---------- Documentos (formato CM-F-03) ----------
  let logoCache, FORMATO = null;
  const logo = () => (logoCache ||= fetch('/logo-saneadren.png').then(r => { if (!r.ok) throw new Error('No se pudo cargar el logo'); return r.arrayBuffer(); }).then(b => new Uint8Array(b)).catch(e => { logoCache = null; throw e; }));
  // Datos de control del formato (código, revisión y fechas): los edita administración en «Datos del formato».
  const FORMATO_BASE = { codigo: 'CM-F-03', revision: '0', fecha_elaboracion: '2023-08-19', fecha_revision: '2023-08-26' };
  async function formato() { try { FORMATO = await pedir('/compras/formato'); } catch { FORMATO = FORMATO || FORMATO_BASE; } return FORMATO; }
  const AHORA = () => new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());
  // Con { blob: true } regresa el PDF (para el expediente) en lugar de descargarlo.
  async function pdf(o, { blob = false } = {}) {
    const F = await formato();
    const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true }), M = 36, W = 612 - 2 * M, ALTO = 792;
    const img = await logo().catch(() => null);
    const NEGRO = [26, 29, 35], AMARILLO = [246, 177, 3], GRIS = [110, 112, 118], LINEA = [214, 216, 220], SUAVE = [247, 247, 245];
    const ESTADO = { borrador: ['BORRADOR · POR AUTORIZAR', [120, 122, 128]], autorizada: ['AUTORIZADA', [58, 125, 92]], cancelada: ['CANCELADA', [184, 68, 58]] }[o.estado] || ['', GRIS];
    const t = (s, x, y, op = {}) => { doc.setFont('helvetica', op.b ? 'bold' : 'normal'); doc.setFontSize(op.s || 9); doc.setTextColor(...(op.c || NEGRO)); doc.text(Array.isArray(s) ? s : String(s ?? ''), x, y, op.al ? { align: op.al } : undefined); };
    const etiqueta = (s, x, y) => t(String(s).toUpperCase(), x, y, { s: 6.5, b: true, c: GRIS });
    const marco = (x, y, w, h, relleno) => { doc.setDrawColor(...LINEA); doc.setLineWidth(0.6); if (relleno) { doc.setFillColor(...relleno); doc.roundedRect(x, y, w, h, 4, 4, 'FD'); } else doc.roundedRect(x, y, w, h, 4, 4, 'S'); };
    // Parte el texto en renglones con la MISMA letra con que se va a imprimir (si no, se encima con lo de al lado).
    const lineas = (s, w, max, op = {}) => { doc.setFont('helvetica', op.b ? 'bold' : 'normal'); doc.setFontSize(op.s || 9); const todas = doc.splitTextToSize(String(s || ''), w); if (todas.length <= max) return todas; const r = todas.slice(0, max); let u = r[max - 1]; while (u && doc.getTextWidth(u + '…') > w) u = u.slice(0, -1); r[max - 1] = u.trimEnd() + '…'; return r; };

    // Franja de marca y encabezado
    doc.setFillColor(...AMARILLO); doc.rect(0, 0, 612, 6, 'F');
    if (img) doc.addImage(img, 'PNG', M, M - 4, 140, 140 * 265 / 942, 'logo', 'FAST');
    t('ORDEN DE COMPRA', M + 158, M + 12, { b: true, s: 17 });
    t(o.folio, M + 158, M + 30, { b: true, s: 12, c: GRIS });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    const anchoEstado = doc.getTextWidth(ESTADO[0]) + 16;
    doc.setFillColor(...ESTADO[1]); doc.roundedRect(M + 158, M + 37, anchoEstado, 14, 7, 7, 'F'); t(ESTADO[0], M + 166, M + 46.5, { b: true, s: 7.5, c: [255, 255, 255] });
    // Control del formato (código, revisión y fechas del FORMATO, no de esta orden)
    const cx = M + W - 150, filasControl = [['Código', F.codigo], ['Revisión', F.revision], ['Elaboración', fechaTxt(F.fecha_elaboracion)], ['Fecha de revisión', fechaTxt(F.fecha_revision)], ['Página', '']];
    marco(cx, M - 6, 150, filasControl.length * 12 + 6);
    filasControl.forEach(([a, b], i) => { t(a, cx + 6, M + 4 + i * 12, { s: 7, c: GRIS }); t(b, cx + 144, M + 4 + i * 12, { s: 7, b: true, al: 'right' }); });
    let y = M + 64;

    // Proveedor y datos de la orden
    const alto = 74, wIzq = W * 0.5 - 5, wDer = W - wIzq - 10, xDer = M + wIzq + 10;
    marco(M, y, wIzq, alto, SUAVE); marco(xDer, y, wDer, alto, SUAVE);
    etiqueta('Proveedor', M + 10, y + 13);
    t(lineas(o.proveedor_nombre, wIzq - 20, 2, { b: true, s: 11 }), M + 10, y + 27, { b: true, s: 11 });
    t([o.proveedor_rfc ? 'RFC ' + o.proveedor_rfc : 'RFC: no registrado', 'Crédito: ' + (Number(o.proveedor_credito) ? o.proveedor_credito + ' días' : 'contado')].join('   ·   '), M + 10, y + 56, { s: 8, c: GRIS });
    t('Factura a: ' + (o.factura_a || 'SANEADREN'), M + 10, y + 67, { s: 8, c: GRIS });
    const datos = [['Fecha', fechaTxt(o.fecha)], ['Fecha requerida', fechaTxt(o.fecha_requerida)], ['Centro de costos', o.centro_nombre + (o.centro_responsable ? ' · ' + o.centro_responsable : '')],
      ['Categoría', o.categoria_nombre || '—'], ['Orden de servicio', o.orden_folio || '—'], ['Factura del proveedor', o.factura_folio || '—']];
    datos.forEach(([a, b], i) => {
      const col = i % 2, fila = Math.floor(i / 2), x = xDer + 10 + col * (wDer / 2), ancho = wDer / 2 - 16;
      // Si no cabe, la letra se achica un poco (hasta 6.5) antes de recortar con «…».
      let tam = 8.5; doc.setFont('helvetica', 'bold'); while (tam > 6.5) { doc.setFontSize(tam); if (doc.getTextWidth(String(b)) <= ancho) break; tam -= 0.5; }
      etiqueta(a, x, y + 13 + fila * 22); t(lineas(b, ancho, 1, { s: tam, b: true }), x, y + 23 + fila * 22, { s: tam, b: true });
    });
    y += alto + 10;
    if (o.nota) { marco(M, y, W, 22); etiqueta('Nota', M + 10, y + 13.5); t(lineas(o.nota, W - 70, 1, { s: 8.5 }), M + 42, y + 14, { s: 8.5 }); y += 30; }

    // Partidas
    doc.autoTable({ startY: y, margin: { left: M, right: M, bottom: 50 }, theme: 'plain',
      head: [['#', 'CANT.', 'UNIDAD', 'DESCRIPCIÓN', 'CLAVE', 'P. UNITARIO', 'IMPORTE']],
      body: o.partidas.map((p, i) => [i + 1, String(p.cantidad), p.unidad || '', p.descripcion, p.clave || '', dinero(p.precio), dinero(p.importe)]),
      styles: { fontSize: 8, cellPadding: { top: 4, bottom: 4, left: 5, right: 5 }, textColor: NEGRO, lineColor: LINEA, lineWidth: { bottom: 0.5 } },
      headStyles: { fillColor: NEGRO, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7, lineWidth: 0 },
      alternateRowStyles: { fillColor: SUAVE },
      columnStyles: { 0: { cellWidth: 22, halign: 'center', textColor: GRIS }, 1: { cellWidth: 38, halign: 'right' }, 2: { cellWidth: 44, halign: 'center' }, 4: { cellWidth: 56 }, 5: { cellWidth: 70, halign: 'right' }, 6: { cellWidth: 76, halign: 'right', fontStyle: 'bold' } },
      didParseCell: c => { if (c.section === 'head' && c.column.index >= 5) c.cell.styles.halign = 'right'; } });
    y = doc.lastAutoTable.finalY + 10;

    // Totales e importe con letra
    const filas = Importes.filasTotales({ subtotal_cent: o.subtotal_cent, iva_cent: o.iva_cent, total_cent: o.total_cent }, o.iva_modo, o.iva_tasa);
    if (y + filas.length * 16 + 50 > ALTO - 40) { doc.addPage(); doc.setFillColor(...AMARILLO); doc.rect(0, 0, 612, 6, 'F'); y = M; }
    const tx = M + W - 210, yTotales = y;
    etiqueta('Importe con letra', M, yTotales + 6);
    t(lineas(Importes.enLetras(o.total_cent), W - 240, 3, { s: 8.5, b: true }), M, yTotales + 18, { s: 8.5, b: true });
    filas.forEach(([e, c], i) => {
      const ultimo = i === filas.length - 1;
      if (ultimo) { doc.setFillColor(...AMARILLO); doc.roundedRect(tx, y - 2, 210, 22, 4, 4, 'F'); }
      t(ultimo ? 'TOTAL A PAGAR' : e, tx + 10, y + (ultimo ? 12.5 : 9), { s: ultimo ? 9.5 : 8.5, b: ultimo, c: ultimo ? NEGRO : GRIS });
      t(dinero(c / 100), tx + 200, y + (ultimo ? 12.5 : 9), { s: ultimo ? 11 : 9, b: true, al: 'right' });
      y += ultimo ? 24 : 15;
    });
    y = Math.max(y, yTotales + 46) + 8;

    // Observaciones
    if (o.observaciones) {
      const obs = lineas(o.observaciones, W - 20, 4, { s: 8.5 });
      marco(M, y, W, 22 + obs.length * 10); etiqueta('Observaciones', M + 10, y + 13); t(obs, M + 10, y + 25, { s: 8.5 }); y += 30 + obs.length * 10;
    }

    // Firmas
    y = Math.max(y + 26, ALTO - 170);
    if (y + 110 > ALTO - 30) { doc.addPage(); doc.setFillColor(...AMARILLO); doc.rect(0, 0, 612, 6, 'F'); y = M + 40; }
    const col = W / 3, ancho = col - 26;
    [['Solicita', o.solicitante_nombre || 'Nombre y firma', o.solicitante_cargo ? o.solicitante_cargo : 'Área solicitante'], ['Autoriza', 'Gerencia de área', 'Nombre y firma'], ['Autoriza', 'Dirección', 'Nombre y firma']].forEach(([a, b, c], i) => {
      const x = M + i * col + 13;
      etiqueta(a, x, y);
      doc.setDrawColor(...NEGRO); doc.setLineWidth(0.7); doc.line(x, y + 40, x + ancho, y + 40);
      t(lineas(b, ancho, 1, { s: 8.5, b: true }), x + ancho / 2, y + 52, { s: 8.5, b: true, al: 'center' });
      t(lineas(c, ancho, 1, { s: 7.5 }), x + ancho / 2, y + 62, { s: 7.5, c: GRIS, al: 'center' });
    });
    if (o.estado === 'autorizada') {
      const msg = '✓ Autorizada en el CRM por ' + (o.autorizada_por_nombre || '') + ' el ' + fechaTxt(String(o.autorizada_at || '').slice(0, 10)) + ' ' + String(o.autorizada_at || '').slice(11, 16);
      doc.setFillColor(232, 243, 238); doc.roundedRect(M, y + 76, W, 18, 4, 4, 'F'); t(msg.replace('✓ ', ''), M + W / 2, y + 88, { s: 8, b: true, c: [58, 125, 92], al: 'center' });
    }
    if (o.estado === 'cancelada') {
      doc.setTextColor(184, 68, 58); doc.setFont('helvetica', 'bold'); doc.setFontSize(54);
      doc.saveGraphicsState?.(); if (doc.GState) doc.setGState(new doc.GState({ opacity: 0.25 }));
      doc.text('CANCELADA', 306, 430, { align: 'center', angle: 30 }); doc.restoreGraphicsState?.();
      t('Motivo de la cancelación: ' + (o.motivo_cancelacion || '—'), M, y + 88, { s: 8, b: true, c: [184, 68, 58] });
    }
    // Pie y número real de hojas
    const hojas = doc.getNumberOfPages(), generado = AHORA();
    for (let i = 1; i <= hojas; i++) {
      doc.setPage(i);
      doc.setDrawColor(...LINEA); doc.setLineWidth(0.5); doc.line(M, ALTO - 30, M + W, ALTO - 30);
      t('Saneadren · ' + o.folio + ' · Formato ' + F.codigo + ' rev. ' + F.revision + ' · Generado ' + generado, M, ALTO - 19, { s: 7, c: GRIS });
      t('Hoja ' + i + ' de ' + hojas, M + W, ALTO - 19, { s: 7, c: GRIS, al: 'right' });
    }
    doc.setPage(1); t(hojas + (hojas === 1 ? ' hoja' : ' hojas'), cx + 144, M + 4 + 4 * 12, { s: 7, b: true, al: 'right' });
    if (blob) return doc.output('blob');
    doc.save('orden_compra_' + o.folio + '.pdf');
  }

  // ---------- Expediente de la orden: documentos, factura, pagos e historial ----------
  let EXPEDIENTE = null;
  const kb = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  async function pintarExpediente(id) {
    const cont = $('oc-expediente');
    cont.hidden = false;
    cont.innerHTML = '<p class="util-45" role="status">Cargando expediente…</p>';
    try { EXPEDIENTE = await pedir('/compras/ordenes/' + Number(id) + '/expediente'); } catch (err) { cont.innerHTML = '<p class="aviso-error-carga">' + esc(err.message) + '</p>'; return; }
    const e = EXPEDIENTE, vivos = e.documentos.filter(d => !d.eliminado), quitados = e.documentos.filter(d => d.eliminado);
    const tipos = Object.entries(e.tipos);
    const lista = '<ul class="oc-exp-lista">' + e.lista.map(x => '<li class="' + (x.listo ? 'listo' : x.opcional ? 'opcional' : 'falta') + '"><span aria-hidden="true">' + (x.listo ? '✔' : x.opcional ? '○' : '•') + '</span> ' + esc(x.texto)
      + (x.detalle ? ' <small>' + esc(x.detalle) + '</small>' : x.opcional && !x.listo ? ' <small>opcional</small>' : '') + '</li>').join('') + '</ul>';
    const datosFactura = d => {
      if (!d.datos) return '';
      const f = d.datos;
      return '<div class="oc-exp-factura">' + [f.uuid ? 'Folio fiscal ' + f.uuid : '', [f.serie, f.folio].filter(Boolean).join('-') ? 'Factura ' + [f.serie, f.folio].filter(Boolean).join('-') : '', f.emisor_rfc ? 'Emisor ' + f.emisor_rfc + (f.emisor_nombre ? ' · ' + f.emisor_nombre : '') : '',
        f.total != null ? 'Total ' + dinero(f.total) : '', f.fecha ? 'Fecha ' + fechaTxt(String(f.fecha).slice(0, 10)) : ''].filter(Boolean).map(esc).join(' · ')
        + (f.avisos?.length ? '<div class="oc-exp-aviso">⚠ ' + f.avisos.map(esc).join('<br>⚠ ') + '</div>' : '<div class="oc-exp-ok">✔ Coincide con la orden</div>') + '</div>';
    };
    const docs = vivos.length ? '<table class="tabla-resumen oc-exp-docs"><thead><tr><th>Documento</th><th>Archivo</th><th>Subió</th><th></th></tr></thead><tbody>' + vivos.map(d => '<tr><td><b>' + esc(d.tipo_nombre) + '</b></td>'
      + '<td>' + esc(d.nombre) + ' <small class="util-45">' + esc(d.formato.toUpperCase()) + ' · ' + kb(d.bytes) + '</small>' + datosFactura(d) + (d.nota ? '<div class="util-45">' + esc(d.nota) + '</div>' : '') + '</td>'
      + '<td><small>' + esc(d.subido_por_nombre || '') + '<br>' + esc(fechaTxt(String(d.created_at).slice(0, 10))) + '</small></td>'
      + '<td class="celda-acciones"><div class="acciones-fila"><button type="button" class="btn btn-outline btn-chico" data-doc-bajar="' + Number(d.id) + '">Descargar</button><button type="button" class="btn btn-outline btn-chico" data-doc-quitar="' + Number(d.id) + '">Quitar</button></div></td></tr>').join('') + '</tbody></table>'
      : '<p class="util-45">Todavía no hay documentos. Sube la cotización del proveedor, la factura (PDF y XML), los comprobantes de pago y la evidencia de entrega.</p>';
    const subir = '<div class="oc-exp-subir"><select id="oc-doc-tipo" aria-label="Qué documento es"><option value="">¿Qué documento es?</option>' + tipos.map(([k, v]) => '<option value="' + esc(k) + '">' + esc(v.nombre) + ' (' + esc(v.admite.join(', ').toUpperCase()) + ')</option>').join('') + '</select>'
      + '<input type="file" id="oc-doc-archivo" accept=".pdf,.xml,.jpg,.jpeg,.png,application/pdf,text/xml,application/xml,image/jpeg,image/png" aria-label="Archivo"><input id="oc-doc-nota" maxlength="300" placeholder="Nota (opcional)" aria-label="Nota del documento">'
      + '<button type="button" class="btn btn-secundario btn-chico" id="oc-doc-subir">Subir al expediente</button></div><p class="ayuda">PDF, JPG o PNG hasta 10 MB. El XML de la factura se lee solo: folio fiscal, RFC del emisor y total, y se compara con la orden.</p>';
    const c = e.cuenta_por_pagar;
    const cuenta = c ? '<div class="oc-exp-cxp"><div><span class="etiqueta-mini">Cuenta por pagar</span><b>' + dinero(c.total) + '</b></div><div><span class="etiqueta-mini">Pagado</span><b>' + dinero(c.pagado) + '</b></div><div><span class="etiqueta-mini">Saldo</span><b class="' + (c.saldo > 0 ? 'cg-pendiente' : 'oc-deuda si') + '">' + (c.cancelada ? 'cancelada' : dinero(c.saldo)) + '</b></div><div><span class="etiqueta-mini">Vence</span><b>' + esc(fechaTxt(c.vence)) + '</b></div><div><span class="etiqueta-mini">Factura</span><b>' + esc(c.factura_folio || '—') + '</b></div></div>'
      + (c.pagos.length ? '<table class="tabla-resumen"><thead><tr><th>Fecha</th><th>Método</th><th>Referencia</th><th class="st-num">Monto</th></tr></thead><tbody>' + c.pagos.map(p => '<tr class="' + (p.cancelado ? 'fila-cancelada' : '') + '"><td>' + esc(fechaTxt(p.fecha)) + '</td><td>' + esc(p.metodo) + '</td><td>' + esc(p.referencia || '') + (p.cancelado ? ' <small>cancelado: ' + esc(p.motivo_cancelacion || '') + '</small>' : '') + '</td><td class="st-num">' + dinero(p.monto) + '</td></tr>').join('') + '</tbody></table>' : '<p class="util-45">Sin pagos todavía (se registran en Cuentas por pagar).</p>')
      : '<p class="util-45">Todavía no es deuda: al autorizarla pasa a Cuentas por pagar.</p>';
    cont.innerHTML = '<div class="oc-exp-cab"><div class="seccion-tit">📁 Expediente de la orden</div><button type="button" class="btn btn-primario btn-chico" id="oc-exp-zip">📦 Descargar expediente completo (ZIP)</button></div>'
      + lista
      + '<div class="oc-exp-bloque"><div class="seccion-sub">Documentos</div>' + docs + subir
      + (quitados.length ? '<details class="oc-exp-quitados"><summary>' + quitados.length + ' documento(s) quitado(s)</summary><ul>' + quitados.map(d => '<li>' + esc(d.tipo_nombre) + ': «' + esc(d.nombre) + '» · quitado por ' + esc(d.eliminado_por || '') + ' el ' + esc(fechaTxt(String(d.eliminado_at || '').slice(0, 10))) + ' · ' + esc(d.motivo_eliminado || '') + '</li>').join('') + '</ul></details>' : '') + '</div>'
      + '<div class="oc-exp-bloque"><div class="seccion-sub">Pagos</div>' + cuenta + '</div>'
      + '<div class="oc-exp-bloque"><div class="seccion-sub">Historial de la orden</div>' + (e.historial.length ? Bitacora.tabla(e.historial, false) : '<p class="util-45">Sin movimientos.</p>') + '</div>';
  }
  // Subir: el archivo va tal cual (sin convertirlo), con su tipo y nombre en encabezados.
  async function subirDocumento() {
    const tipo = $('oc-doc-tipo').value, archivo = $('oc-doc-archivo').files[0];
    if (!tipo) { toast('Elige qué documento es'); $('oc-doc-tipo').focus(); return; }
    if (!archivo) { toast('Elige el archivo'); return; }
    if (archivo.size > 10 * 1024 * 1024) { toast('El archivo pasa de 10 MB'); return; }
    const r = await api('/compras/ordenes/' + ACTUAL.id + '/documentos', { method: 'POST', body: archivo,
      headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + USUARIO_ACTUAL.token, 'X-Tipo': tipo, 'X-Nombre': encodeURIComponent(archivo.name), 'X-Nota': encodeURIComponent($('oc-doc-nota').value.trim()) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast(j.error || 'No se pudo subir'); return; }
    toast(j.avisos?.length ? '⚠ Subido, pero revisa: ' + j.avisos.join(' · ') : 'Documento agregado al expediente');
    await pintarExpediente(ACTUAL.id);
  }
  async function bajarDocumento(id) {
    const r = await api('/compras/documentos/' + Number(id), { headers: { Authorization: 'Bearer ' + USUARIO_ACTUAL.token } });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'No se pudo descargar'); }
    const d = EXPEDIENTE.documentos.find(x => x.id === Number(id));
    saveAs(await r.blob(), d?.nombre || 'documento');
  }
  async function quitarDocumento(id) {
    const d = EXPEDIENTE.documentos.find(x => x.id === Number(id));
    const motivo = await solicitarDialogo({ titulo: 'Quitar documento', mensaje: '«' + (d?.nombre || '') + '» deja de contar en el expediente (queda registrado quién lo quitó y por qué; el archivo no se borra).', aceptar: 'Quitar', campo: { tipo: 'text', etiqueta: 'Motivo' } });
    if (!motivo) return;
    await pedir('/compras/documentos/' + Number(id) + '/quitar', 'POST', { motivo });
    toast('Documento quitado del expediente'); await pintarExpediente(ACTUAL.id);
  }
  // Expediente completo en un ZIP: la orden en PDF, los documentos, los pagos y el historial.
  let zipCache;
  const cargarZip = () => (zipCache ||= new Promise((ok, mal) => { if (window.JSZip) return ok(window.JSZip); const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; s.onload = () => ok(window.JSZip); s.onerror = () => { zipCache = null; mal(new Error('No se pudo cargar el compresor (revisa la conexión)')); }; document.head.appendChild(s); }));
  async function descargarZip() {
    const JSZip = await cargarZip();
    const e = EXPEDIENTE, o = e.orden, zip = new JSZip(), carpeta = zip.folder('Expediente ' + o.folio);
    carpeta.file('01 Orden de compra ' + o.folio + '.pdf', await pdf(o, { blob: true }));
    let n = 2;
    for (const d of e.documentos.filter(x => !x.eliminado)) {
      const r = await api('/compras/documentos/' + d.id, { headers: { Authorization: 'Bearer ' + USUARIO_ACTUAL.token } });
      if (!r.ok) continue;
      carpeta.file(String(n++).padStart(2, '0') + ' ' + d.tipo_nombre.replace(/[\\/:*?"<>|]/g, '') + ' - ' + d.nombre.replace(/[\\/:*?"<>|]/g, '_'), await r.blob());
    }
    const c = e.cuenta_por_pagar;
    const resumen = ['EXPEDIENTE ' + o.folio, '', 'Proveedor: ' + o.proveedor_nombre + (o.proveedor_rfc ? ' (RFC ' + o.proveedor_rfc + ')' : ''), 'Fecha: ' + fechaTxt(o.fecha) + ' · Requerida: ' + fechaTxt(o.fecha_requerida),
      'Centro de costos: ' + o.centro_nombre + ' · Categoría: ' + (o.categoria_nombre || ''), 'Total: ' + dinero(o.total) + ' · Estado: ' + (ESTADOS[o.estado]?.[0] || o.estado), '',
      'LISTA DEL EXPEDIENTE', ...e.lista.map(x => (x.listo ? '[x] ' : '[ ] ') + x.texto + (x.detalle ? ' (' + x.detalle + ')' : '')), '',
      'PAGOS', ...(c ? [`Cuenta por pagar ${dinero(c.total)} · pagado ${dinero(c.pagado)} · saldo ${dinero(c.saldo)} · vence ${fechaTxt(c.vence)}`, ...c.pagos.map(p => fechaTxt(p.fecha) + ' · ' + p.metodo + ' · ' + dinero(p.monto) + (p.referencia ? ' · ref. ' + p.referencia : '') + (p.cancelado ? ' · CANCELADO' : ''))] : ['Todavía no es deuda (no autorizada).']), '',
      'HISTORIAL', ...e.historial.slice().reverse().map(h => h.fecha + ' · ' + (h.usuario || '') + ' · ' + h.accion + (h.detalle ? ': ' + h.detalle : '')), '', 'Generado desde el CRM de Saneadren el ' + AHORA()].join('\r\n');
    carpeta.file('00 Resumen e historial.txt', resumen);
    saveAs(await zip.generateAsync({ type: 'blob' }), 'Expediente ' + o.folio + '.zip');
    toast('Expediente descargado');
  }

  // ---------- Datos del formato (solo administración) ----------
  async function editarFormato() {
    const f = await formato();
    $('fmt-codigo').value = f.codigo; $('fmt-revision').value = f.revision; $('fmt-elaboracion').value = f.fecha_elaboracion; $('fmt-fecha-revision').value = f.fecha_revision;
    abrirVentana('overlay-formato-oc');
  }
  async function guardarFormato() {
    FORMATO = await pedir('/compras/formato', 'PUT', { codigo: $('fmt-codigo').value, revision: $('fmt-revision').value, fecha_elaboracion: $('fmt-elaboracion').value, fecha_revision: $('fmt-fecha-revision').value });
    $('overlay-formato-oc').classList.remove('mostrar');
    toast('Datos del formato guardados: así saldrán en los PDF nuevos');
  }

  async function excel(o) {
    const F = await formato();
    let ExcelJS; try { ExcelJS = await Finanzas.cargarExcelJS(); } catch (err) { toast(err.message); return; }
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Formato-ORDEN COMPRA', { pageSetup: { paperSize: 1, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.columns = [{ width: 9 }, { width: 10 }, { width: 46 }, { width: 9 }, { width: 14 }, { width: 14 }, { width: 16 }];
    const borde = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    const amarillo = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6B103' } };
    const img = await logo().catch(() => null);
    if (img) ws.addImage(wb.addImage({ buffer: img, extension: 'png' }), { tl: { col: 0.1, row: 0.3 }, ext: { width: 150, height: 42 } });
    ws.mergeCells('C1:C3'); Object.assign(ws.getCell('C1'), { value: 'ORDEN DE COMPRAS\n' + o.folio }); ws.getCell('C1').font = { bold: true, size: 14 }; ws.getCell('C1').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    [['Código:', F.codigo], ['Revisión:', F.revision], ['Fecha de revisión:', fechaTxt(F.fecha_revision)]].forEach(([a, b], i) => { ws.mergeCells(`D${i + 1}:E${i + 1}`); ws.getCell(`D${i + 1}`).value = a; ws.mergeCells(`F${i + 1}:G${i + 1}`); ws.getCell(`F${i + 1}`).value = b; ws.getCell(`F${i + 1}`).font = { bold: true }; });
    ws.getRow(1).height = 22; ws.getRow(2).height = 22; ws.getRow(3).height = 22;
    const dato = (fila, etq, val, col1, col2) => { ws.getCell(col1 + fila).value = etq; ws.getCell(col1 + fila).font = { bold: true, size: 8 }; ws.getCell(col2 + fila).value = val; };
    dato(5, 'PROVEEDOR', o.proveedor_nombre, 'A', 'C'); dato(5, 'CENTRO DE COSTOS', o.centro_nombre, 'E', 'F'); dato(6, 'NOTA', o.nota || '', 'A', 'C'); dato(6, 'FACTURA A', o.factura_a, 'E', 'F');
    dato(7, 'ORDEN DE SERVICIO', o.orden_folio || '', 'A', 'C'); dato(7, 'FECHA', fechaTxt(o.fecha), 'E', 'F'); dato(8, 'FECHA REQUERIDA', fechaTxt(o.fecha_requerida), 'E', 'F');
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

  // ---------- Catálogos editables: unidades (todos), centros de costo y categorías (administración) ----------
  // Una sola ventana para los tres: cada renglón se corrige y se guarda solo; nada se borra, se da de baja.
  const CATALOGOS = {
    unidades: { titulo: 'Unidades de medida', lista: '/compras/unidades', item: u => '/compras/unidades/' + u.id, clave: u => u.id,
      ayuda: 'Las unidades que aparecen en las partidas de la orden de compra. Cualquier usuario puede agregar o corregir; dar de baja solo la quita de la lista (las órdenes viejas la conservan).',
      campos: [{ k: 'clave', t: 'Abreviatura', max: 10, ph: 'PZA', ancho: '7rem' }, { k: 'nombre', t: 'Nombre', max: 40, ph: 'Pieza' }] },
    centros: { titulo: 'Centros de costo', lista: '/compras/centros', item: c => '/compras/centros/' + c.id, clave: c => c.id, admin: true,
      ayuda: 'Solo administradores. Dar de baja un centro lo quita de la lista para órdenes nuevas; las órdenes viejas lo conservan.',
      campos: [{ k: 'nombre', t: 'Centro de costos', max: 80, ph: 'Mantenimiento' }, { k: 'responsable', t: 'Responsable', max: 120, ph: 'Nombre', vacio: true }] },
    categorias: { titulo: 'Categorías de gasto', lista: '/finanzas/categorias?todas=1', alta: '/finanzas/categorias', item: c => '/finanzas/categorias/' + encodeURIComponent(c.clave), clave: c => c.clave, admin: true,
      ayuda: 'Solo administradores. Se usan en órdenes de compra, Cuentas por pagar y resultados. Renombrar una categoría actualiza también los gastos ya capturados; «Otro» no se puede dar de baja.',
      campos: [{ k: 'nombre', t: 'Categoría', max: 80, ph: 'Ej. Papelería' }] },
  };
  let CAT = null, CAT_FILAS = [];
  async function abrirCatalogo(tipo) {
    CAT = CATALOGOS[tipo];
    if (CAT.admin && !esAdmin()) { toast('Solo un administrador puede editar ' + CAT.titulo.toLowerCase()); return; }
    $('cat-titulo').textContent = CAT.titulo; $('cat-ayuda').textContent = CAT.ayuda;
    $('cat-cabeza').innerHTML = '<tr>' + CAT.campos.map(c => '<th>' + esc(c.t) + '</th>').join('') + '<th>Activo</th><th></th></tr>';
    await pintarCatalogo();
    abrirVentana('overlay-catalogo');
  }
  const inputCat = (c, v, i) => '<input data-campo="' + esc(c.k) + '" maxlength="' + c.max + '" value="' + esc(v ?? '') + '" placeholder="' + esc(c.ph) + '" aria-label="' + esc(c.t) + '"' + (c.ancho ? ' style="width:' + esc(c.ancho) + '"' : '') + (i === undefined ? '' : ' data-fila="' + i + '"') + '>';
  async function pintarCatalogo() {
    try { CAT_FILAS = await pedir(CAT.lista); } catch (err) { toast(err.message); return; }
    $('cat-filas').innerHTML = CAT_FILAS.map((x, i) => '<tr class="' + (x.activo ? '' : 'fila-cancelada') + '" data-fila="' + i + '">' + CAT.campos.map(c => '<td>' + inputCat(c, x[c.k]) + '</td>').join('')
      + '<td><label class="cat-activo"><input type="checkbox" data-campo="activo"' + (x.activo ? ' checked' : '') + '> ' + (x.activo ? 'Sí' : 'Baja') + '</label></td>'
      + '<td><button type="button" class="btn btn-outline btn-chico" data-cat-guardar="' + i + '">Guardar</button></td></tr>').join('');
    $('cat-nuevo').innerHTML = '<tr class="cat-fila-nueva">' + CAT.campos.map(c => '<td>' + inputCat(c, '') + '</td>').join('') + '<td></td><td><button type="button" class="btn btn-primario btn-chico" id="cat-agregar">+ Agregar</button></td></tr>';
  }
  const leerFila = tr => Object.fromEntries([...tr.querySelectorAll('[data-campo]')].map(x => [x.dataset.campo, x.type === 'checkbox' ? x.checked : x.value.trim()]));
  async function guardarCatalogo(b) {
    const tr = b.closest('tr'), datos = leerFila(tr);
    const faltante = CAT.campos.find(c => !c.vacio && !datos[c.k]);
    if (faltante) { toast('Escribe ' + faltante.t.toLowerCase()); tr.querySelector('[data-campo="' + faltante.k + '"]').focus(); return; }
    if (b.id === 'cat-agregar') { delete datos.activo; await pedir(CAT.alta || CAT.lista, 'POST', datos); toast('Agregado a ' + CAT.titulo.toLowerCase()); }
    else { await pedir(CAT.item(CAT_FILAS[Number(b.dataset.catGuardar)]), 'PUT', datos); toast('Guardado'); }
    await pintarCatalogo();
    await catalogos();
    refrescarCatalogosEnOrden();
  }
  // Si la orden de compra está abierta, sus listas se actualizan sin perder lo capturado.
  function refrescarCatalogosEnOrden() {
    if (!$('overlay-compra').classList.contains('mostrar')) return;
    const d = datosForm();
    pintarSelects({ ...(ACTUAL || {}), ...d });
    document.querySelectorAll('#oc-filas .oc-unidad').forEach(sel => { const v = sel.value === '__nueva' ? '' : sel.value; sel.innerHTML = opcionesUnidad(v); });
  }
  // «+ Agregar unidad…» desde una partida: abreviatura y nombre en un solo paso.
  async function unidadRapida(sel) {
    sel.value = '';
    const txt = await solicitarDialogo({ titulo: 'Nueva unidad de medida', mensaje: 'Escribe la abreviatura y el nombre separados por un guion, por ejemplo «ML - Metro lineal». Queda disponible para todos.', aceptar: 'Agregar', campo: { tipo: 'text', etiqueta: 'Unidad' } });
    if (!txt) return;
    const partes = txt.split(/\s+-\s+|·/).map(x => x.trim()).filter(Boolean);
    // Sin abreviatura: se arma con las iniciales («Metro lineal» → ML) o las 3 primeras letras («Costal» → COS).
    const nombre = partes.length > 1 ? partes.slice(1).join(' ') : partes[0];
    const palabras = nombre.split(/\s+/);
    const clave = partes.length > 1 ? partes[0] : (palabras.length > 1 ? palabras.map(p => p[0]).join('') : nombre.slice(0, 3)).toUpperCase();
    try {
      const u = await pedir('/compras/unidades', 'POST', { clave: clave.slice(0, 10), nombre });
      await catalogos(); refrescarCatalogosEnOrden(); sel.value = u.clave; toast('Unidad agregada: ' + u.nombre);
    } catch (err) { toast(err.message); }
  }

  // Autorizar = la orden se vuelve deuda: pasa a Cuentas por pagar como factura pendiente del proveedor.
  async function autorizar(o) {
    if (!o) return false;
    if (!await solicitarDialogo({ titulo: 'Autorizar orden de compra', mensaje: 'La orden ' + o.folio + ' por ' + dinero(o.total) + ' se vuelve deuda: pasa a Cuentas por pagar como factura pendiente de ' + o.proveedor_nombre + '. Después ya no se puede editar.', aceptar: 'Autorizar' })) return false;
    try { await pedir('/compras/ordenes/' + o.id + '/autorizar', 'POST', {}); } catch (err) { toast(err.message); return false; }
    toast('Orden ' + o.folio + ' autorizada: ya está en Cuentas por pagar'); cargar(); return true;
  }

  // ---------- Eventos ----------
  let tBuscar;
  $('oc-buscar').addEventListener('input', () => { clearTimeout(tBuscar); tBuscar = setTimeout(cargar, 300); });
  $('oc-filtro').addEventListener('change', cargar);
  $('oc-nueva').addEventListener('click', () => abrir(null));
  $('oc-centros').addEventListener('click', () => abrirCatalogo('centros'));
  $('oc-categorias').addEventListener('click', () => abrirCatalogo('categorias'));
  $('oc-unidades').addEventListener('click', () => abrirCatalogo('unidades'));
  document.querySelector('#overlay-catalogo .modal-body').addEventListener('click', async e => {
    const b = e.target.closest('button[data-cat-guardar], #cat-agregar'); if (!b || b.disabled) return;
    b.disabled = true; try { await guardarCatalogo(b); } catch (err) { toast(err.message); } finally { b.disabled = false; }
  });
  document.querySelector('#overlay-catalogo .modal-body').addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault(); e.target.closest('tr').querySelector('button')?.click();
  });
  $('oc-filas').addEventListener('change', e => { if (e.target.classList.contains('oc-unidad') && e.target.value === '__nueva') unidadRapida(e.target); });
  const conBotonOC = async (b, fn) => { if (!b || b.disabled) return; b.disabled = true; try { await fn(); } catch (err) { toast(err.message); } finally { b.disabled = false; } };
  $('oc-expediente').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'oc-doc-subir') conBotonOC(b, subirDocumento);
    if (b.id === 'oc-exp-zip') conBotonOC(b, descargarZip);
    if (b.dataset.docBajar) conBotonOC(b, () => bajarDocumento(b.dataset.docBajar));
    if (b.dataset.docQuitar) conBotonOC(b, () => quitarDocumento(b.dataset.docQuitar));
  });
  $('oc-formato').addEventListener('click', e => conBotonOC(e.currentTarget, editarFormato));
  $('fmt-guardar').addEventListener('click', e => conBotonOC(e.currentTarget, guardarFormato));
  $('oc-lista').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ocAbrir) abrir(Number(b.dataset.ocAbrir));
    if (b.dataset.ocAutorizar) { await autorizar(LISTA.find(o => o.id === Number(b.dataset.ocAutorizar))); return; }
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
    try { const p = await Finanzas.guardarProveedor({ nombre, categoria: $('oc-categoria').value || 'otro' }); if (!p) return; await catalogos(); pintarSelects({ ...(ACTUAL || {}), ...datosForm(), proveedor_id: p.id }); toast('Proveedor agregado'); }
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
      if (b.id === 'oc-autorizar' && await autorizar(ACTUAL)) await abrir(ACTUAL.id);
      if (b.id === 'oc-cancelar') {
        const motivo = await solicitarDialogo({ titulo: 'Cancelar orden de compra', mensaje: ACTUAL.estado === 'autorizada' ? 'También se cancela su cuenta por pagar.' : 'La orden queda cancelada (se conserva en la lista).', aceptar: 'Cancelar orden', campo: { tipo: 'text', etiqueta: 'Motivo' } });
        if (!motivo) return;
        const r = await pedir('/compras/ordenes/' + ACTUAL.id + '/cancelar', 'POST', { motivo }); toast('Orden cancelada'); await abrir(r.orden.id); cargar();
      }
    } catch (err) { toast(err.message); } finally { b.disabled = false; }
  });
  return { cargar, pdf };
})();
window.Compras = Compras;
