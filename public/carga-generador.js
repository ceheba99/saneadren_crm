/* Carga masiva del Generador: lee el Excel (una hoja por mes, como el «REPORTE DE VENTAS»), lo manda a revisar
   y muestra en una sola pantalla lo que el CRM no reconoce (clientes, productos, canales) para decidirlo una vez.
   Nada se guarda hasta que no haya errores, todo esté resuelto y se indique si ya se cobraron. Servidor: server/carga-generador.js */
const CargaGenerador = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t);
  const dinero = n => formatoMoneda(n);
  const sinAcentos = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Columnas del generador (título y otros nombres con que aparecen). Las de costo con terceros no se leen.
  const COLUMNAS = [
    { key: 'fecha', titulo: 'FECHA', fecha: true },
    { key: 'no_orden', titulo: 'NO. ORDEN', alias: ['NO ORDEN', 'ORDEN', 'NUMERO DE ORDEN', 'NO DE ORDEN'] },
    { key: 'factura', titulo: 'NO. FACTURA', alias: ['NO FACTURA', 'FACTURA', 'FOLIO FACTURA'] },
    { key: 'producto', titulo: 'CONCEPTO', alias: ['PRODUCTO', 'SERVICIO'] },
    { key: 'cantidad', titulo: 'CANTIDAD' },
    { key: 'subtotal', titulo: 'SUBTOTAL' },
    { key: 'iva', titulo: 'IVA' },
    { key: 'total', titulo: 'TOTAL' },
    { key: 'canal', titulo: 'CANAL DE VENTA', alias: ['CANAL'] },
    { key: 'id_cliente', titulo: 'ID CLIENTE', alias: ['ID DEL CLIENTE', 'CLIENTE ID'] },
    { key: 'cliente', titulo: 'CLIENTE' },
    { key: 'proyecto', titulo: 'PROYECTO' },
    { key: 'unidad', titulo: 'UNIDAD', alias: ['EQUIPO'] },
    { key: 'empleado', titulo: 'EMPLEADO', alias: ['OPERADOR'] },
    { key: 'manifiestos', titulo: 'MANIFIESTOS' },
  ];
  const columnaDe = t => { const k = sinAcentos(t); return k && COLUMNAS.find(c => [c.titulo, ...(c.alias || [])].some(n => sinAcentos(n) === k)); };

  let FILAS = null, EQ = null, ULTIMA = null, HOJAS = [], ARCHIVO = null, POS = {}, consulta = 0;

  // ---------- Avisos en el propio Excel (comentarios como los de Excel) ----------
  // A qué columna corresponde cada aviso del servidor: el comentario va en esa celda; si no se sabe, en la primera.
  const CAMPO_AVISO = [[/^ID CLIENTE/, 'id_cliente'], [/^FECHA/, 'fecha'], [/^SUBTOTAL/, 'subtotal'], [/^IVA/, 'iva'], [/^TOTAL/, 'total'], [/^CANTIDAD/, 'cantidad'],
    [/^(CONCEPTO|PRODUCTO)|servicio elegido/i, 'producto'], [/^CLIENTE|cliente elegido|«.*» y otro nombre/i, 'cliente'], [/^Ya se cargó/, 'no_orden']];
  const campoDeAviso = m => CAMPO_AVISO.find(([re]) => re.test(m))?.[1] || null;
  // Marca en el libro cada celda con error (fondo rojo claro y comentario) y agrega la hoja «Avisos por corregir»
  // con la lista y un enlace a cada celda. posPorHoja: { HOJA: { campo: número de columna } }.
  function anotarAvisos(wb, errores, posPorHoja) {
    const porCelda = new Map();
    for (const e of errores) {
      const corte = String(e.fila).lastIndexOf(' #'); if (corte < 0) continue;
      const hoja = String(e.fila).slice(0, corte), renglon = Number(String(e.fila).slice(corte + 2));
      const ws = wb.worksheets.find(w => w.name.trim() === hoja); if (!ws || !renglon) continue;
      for (const m of e.errores) {
        const pos = posPorHoja[hoja] || {};
        const col = pos[campoDeAviso(m)] || pos.cliente || pos.producto || 1;
        const k = hoja + '|' + renglon + '|' + col;
        const x = porCelda.get(k) || { ws, hoja, renglon, col, avisos: [] };
        x.avisos.push(m); porCelda.set(k, x);
      }
    }
    for (const x of porCelda.values()) {
      const cel = x.ws.getRow(x.renglon).getCell(x.col);
      cel.note = { texts: [{ font: { bold: true, size: 9 }, text: '⚠ Por corregir:\n' }, { font: { size: 9 }, text: x.avisos.join('\n') }] };
      cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAD4D0' } };
    }
    const ya = wb.getWorksheet('Avisos por corregir'); if (ya) wb.removeWorksheet(ya.id);
    const av = wb.addWorksheet('Avisos por corregir', { properties: { tabColor: { argb: 'FFB8443A' } } });
    av.columns = [{ header: 'Hoja', width: 14 }, { header: 'Renglón', width: 10 }, { header: 'Celda', width: 10 }, { header: 'Qué corregir', width: 90 }];
    av.getRow(1).font = { bold: true };
    [...porCelda.values()].sort((a, b) => a.hoja.localeCompare(b.hoja) || a.renglon - b.renglon).forEach(x => {
      const dir = x.ws.getRow(x.renglon).getCell(x.col).address;
      const r = av.addRow([x.hoja, x.renglon, { text: dir, hyperlink: "#'" + x.hoja.replace(/'/g, "''") + "'!" + dir }, x.avisos.join(' · ')]);
      r.getCell(3).font = { color: { argb: 'FF1F5FA8' }, underline: true };
    });
    // La hoja de avisos va primero para que sea lo primero que se ve al abrir.
    av.orderNo = -1;
    return porCelda.size;
  }
  async function descargarAvisos() {
    if (!ARCHIVO || !ULTIMA?.errores?.length) return;
    const ExcelJS = await Finanzas.cargarExcelJS();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await ARCHIVO.arrayBuffer());
    const n = anotarAvisos(wb, ULTIMA.errores, POS);
    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), ARCHIVO.name.replace(/\.xlsx$/i, '') + ' - con avisos.xlsx');
    toast(n + ' celdas marcadas en rojo con su comentario. Pasa el mouse sobre ellas en Excel para ver qué corregir.');
  }

  // ---------- Leer el Excel: todas las hojas visibles que tengan los títulos del generador ----------
  async function leerExcel(archivo) {
    if (archivo.size > 15 * 1024 * 1024) throw new Error('El archivo es demasiado grande (máximo 15 MB)');
    const ExcelJS = await Finanzas.cargarExcelJS();
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(await archivo.arrayBuffer(), { ignoreNodes: ['dataValidations', 'conditionalFormatting', 'hyperlinks'], maxRows: 6000, maxCols: 80 }); }
    catch { throw new Error('No se pudo leer el archivo. Guárdalo como Excel (.xlsx) e inténtalo de nuevo.'); }
    const filas = [], hojas = [], posHojas = {};
    for (const ws of wb.worksheets) {
      if (ws.state && ws.state !== 'visible') continue;
      const renglones = [];
      ws.eachRow({ includeEmpty: false }, (row, n) => { const v = []; row.eachCell({ includeEmpty: true }, (cell, i) => { v[i] = Finanzas.valorCelda(cell.value); }); renglones.push({ n, v }); });
      // El encabezado es el renglón (entre los primeros 10) que más títulos reconoce; se exigen los básicos.
      let enc = null, mejor = 0;
      for (const r of renglones.slice(0, 10)) { const k = r.v.filter(x => x != null && columnaDe(x)).length; if (k > mejor) { mejor = k; enc = r; } }
      if (!enc || mejor < 4) continue;
      const pos = {};
      posHojas[ws.name.trim()] = pos;
      enc.v.forEach((x, i) => { const c = x != null && columnaDe(x); if (c && pos[c.key] === undefined) pos[c.key] = i; });
      if (pos.cliente === undefined && pos.id_cliente === undefined || pos.producto === undefined || pos.subtotal === undefined) continue;
      let cuenta = 0;
      for (const r of renglones) {
        if (r.n <= enc.n) continue;
        const f = { fila: ws.name.trim() + ' #' + r.n };
        let algo = false;
        for (const c of COLUMNAS) {
          if (pos[c.key] === undefined) continue;
          let x = r.v[pos[c.key]];
          if (x === undefined || x === null) x = '';
          if (typeof x === 'string' && x.startsWith('#ERROR_EXCEL:')) x = ''; // celdas con #N/A, #¡REF!…
          if (c.fecha && typeof x === 'number' && x > 20000 && x < 80000) x = new Date(Date.UTC(1899, 11, 30) + Math.round(x) * 86400000).toISOString().slice(0, 10);
          if (c.fecha && typeof x === 'string') x = Finanzas.fechaTexto(x);
          if (typeof x === 'number' && ['subtotal', 'iva', 'total'].includes(c.key)) x = Math.round(x * 100) / 100;
          if (typeof x === 'number' && !['subtotal', 'iva', 'total', 'cantidad'].includes(c.key)) x = String(x);
          if (typeof x === 'string') x = x.trim();
          if (x !== '' && c.key !== 'fecha') algo = true;
          f[c.key] = x;
        }
        if (algo) { filas.push(f); cuenta++; }
      }
      if (cuenta) hojas.push({ nombre: ws.name.trim(), filas: cuenta });
    }
    if (!filas.length) throw new Error('No se encontraron hojas con los títulos del generador (FECHA, CONCEPTO o PRODUCTO, SUBTOTAL, CLIENTE…). Usa «Descargar plantilla».');
    if (filas.length > 5000) throw new Error(`El archivo tiene ${filas.length} renglones; el máximo es 5,000 por carga. Divídelo por meses.`);
    return { filas, hojas, pos: Object.fromEntries(Object.entries(posHojas).map(([h, p]) => [h, Object.fromEntries(Object.entries(p).map(([k, i]) => [k, i]))])) };
  }

  // ---------- Revisión ----------
  async function revisar() {
    const turno = ++consulta;
    $('cg-cargar').disabled = true;
    $('cg-resumen').textContent = 'Revisando ' + FILAS.length + ' renglones…';
    let r;
    try {
      const res = await api('/generador/importar?simular=1', { method: 'POST', body: JSON.stringify({ filas: FILAS, equivalencias: EQ }) });
      r = await res.json(); if (!res.ok) throw new Error(r.error || 'No se pudo revisar');
    } catch (err) { if (turno === consulta) $('cg-resumen').textContent = 'No se pudo revisar: ' + err.message; return; }
    if (turno !== consulta) return;
    ULTIMA = r;
    r._eq = JSON.stringify(EQ);
    pintar(r);
  }
  const opcion = (v, txt, sel) => '<option value="' + esc(String(v)) + '"' + (String(sel) === String(v) ? ' selected' : '') + '>' + esc(txt) + '</option>';
  function pintar(r) {
    const pr = r.por_resolver, cuantos = ['clientes', 'productos', 'canales'].reduce((t, k) => t + pr[k].filter(x => !x.decidido).length, 0);
    // Valores sugeridos de entrada (productos y canales con un parecido claro; clientes nunca: los decides tú).
    // Producto o canal: el del catálogo más parecido; si no hay, la forma más usada en el archivo; si no, agregarlo.
    const sugerir = x => x.sugerencias?.[0]?.id ?? (x.del_archivo?.find(o => o.filas > x.filas || (o.filas === x.filas && o.clave < x.clave)) ? 'como:' + x.del_archivo.find(o => o.filas > x.filas || (o.filas === x.filas && o.clave < x.clave)).clave : 'nuevo');
    pr.productos.forEach(p => { if (EQ.productos[p.clave] === undefined) EQ.productos[p.clave] = sugerir(p); });
    pr.canales.forEach(c => { if (EQ.canales[c.clave] === undefined) EQ.canales[c.clave] = sugerir(c); });
    pr.clientes.forEach(c => { if (EQ.clientes[c.clave] === undefined && !c.sugerencias.length && !c.del_archivo.length) EQ.clientes[c.clave] = 'nuevo'; });
    // Si se propusieron valores, se vuelve a revisar con ellos para que la vista previa sea exacta.
    const propuestos = JSON.stringify(EQ);
    if (propuestos !== r._eq) { r._eq = propuestos; return revisar(); }

    $('cg-resumen').innerHTML = '<b>' + Number(r.servicios) + ' servicios</b> en ' + HOJAS.map(h => esc(h.nombre) + ' (' + h.filas + ')').join(', ')
      + ' · total ' + dinero(r.importe.total) + ' (subtotal ' + dinero(r.importe.subtotal) + ' + IVA ' + dinero(r.importe.iva) + ')'
      + (r.errores.length ? ' · <b class="cg-mal">' + r.errores.length + ' renglones con error</b>' : '')
      + (cuantos ? ' · <b class="cg-pendiente">' + cuantos + ' nombres por decidir</b>' : '')
      + (r.clientes_nuevos ? ' · ' + r.clientes_nuevos + (r.clientes_nuevos === 1 ? ' cliente nuevo' : ' clientes nuevos') : '') + '.';

    // Cualquier otro nombre del archivo (no solo los parecidos), para unir a mano lo que la regla no detecta.
    const otros = (tipo, x, v) => {
      const ya = new Set((x.del_archivo || []).map(o => o.clave));
      const lista = pr[tipo].filter(o => o.clave !== x.clave && !ya.has(o.clave) && !String(EQ[tipo][o.clave] ?? '').startsWith('como:'));
      return lista.length ? '<optgroup label="Otro nombre de este archivo">' + lista.map(o => opcion('como:' + o.clave, (tipo === 'clientes' ? 'Es el mismo que «' : 'Igual que «') + o.texto + '»', v)).join('') + '</optgroup>' : '';
    };
    const servOpts = sel => r.catalogo.servicios.map(s => opcion(s.id, s.nombre, sel)).join('');
    const canalOpts = sel => r.catalogo.canales.map(c => opcion(c.id, c.nombre, sel)).join('');
    let html = '';
    if (pr.clientes.length) html += '<div class="cg-bloque"><div class="seccion-tit">Clientes que el CRM no reconoce (' + pr.clientes.length + ')</div><p class="ayuda">Decide una sola vez por nombre; se recuerda para las próximas cargas. Si se parece a un cliente que ya tienes, elige ese para no duplicarlo.</p>'
      + '<table class="tabla-resumen cg-tabla"><thead><tr><th>Así viene en el Excel</th><th class="st-num">Servicios</th><th class="st-num">Total</th><th>¿Quién es?</th></tr></thead><tbody>'
      + pr.clientes.map(c => {
        const v = EQ.clientes[c.clave] ?? '';
        const otro = typeof v === 'number' && !c.sugerencias.some(s => s.id === v) ? opcion(v, 'Es ' + folioCliente(v) + ' (escrito a mano)', v) : '';
        return '<tr><td><b>' + esc(c.texto) + '</b></td><td class="st-num">' + c.filas + '</td><td class="st-num">' + dinero(c.total) + '</td><td><select class="cg-sel' + (v === '' ? ' cg-falta' : '') + '" data-tipo="clientes" data-clave="' + esc(c.clave) + '">'
          + opcion('', '— Elige —', v)
          + c.sugerencias.map(s => opcion(s.id, 'Es ' + s.folio + ' · ' + (s.empresa || s.nombre) + ' (' + s.motivo.toLowerCase() + ')', v)).join('')
          + c.del_archivo.map(o => opcion('como:' + o.clave, 'Es el mismo que «' + o.texto + '» de este archivo', v)).join('')
          + otros('clientes', c, v) + otro + opcion('otro', 'Es otro cliente que ya existe… (escribir su ID)', '') + opcion('nuevo', 'Es un cliente nuevo', v) + '</select></td></tr>';
      }).join('') + '</tbody></table></div>';
    if (pr.productos.length) html += '<div class="cg-bloque"><div class="seccion-tit">Conceptos que no están en el catálogo de servicios (' + pr.productos.length + ')</div><p class="ayuda">Elige a qué servicio corresponde cada forma de escribirlo (ya viene sugerido el más parecido), o agrégalo al catálogo.</p>'
      + '<table class="tabla-resumen cg-tabla"><thead><tr><th>Así viene en el Excel</th><th class="st-num">Servicios</th><th>Servicio del catálogo</th></tr></thead><tbody>'
      + pr.productos.map(p => { const v = EQ.productos[p.clave] ?? ''; return '<tr><td><b>' + esc(p.texto) + '</b></td><td class="st-num">' + p.filas + '</td><td><select class="cg-sel" data-tipo="productos" data-clave="' + esc(p.clave) + '">'
        + opcion('', '— Elige —', v) + (p.sugerencias.length ? '<optgroup label="Más parecidos">' + p.sugerencias.map(s => opcion(s.id, s.nombre, v)).join('') + '</optgroup>' : '')
        + (p.del_archivo?.length ? '<optgroup label="Escrito casi igual en este archivo">' + p.del_archivo.map(o => opcion('como:' + o.clave, 'Igual que «' + o.texto + '» (' + o.filas + ')', v)).join('') + '</optgroup>' : '') + otros('productos', p, v)
        + '<optgroup label="Todo el catálogo">' + servOpts(p.sugerencias.some(s => String(s.id) === String(v)) ? '' : v) + '</optgroup>' + opcion('nuevo', 'Agregar «' + p.texto + '» al catálogo', v) + '</select></td></tr>'; }).join('')
      + '</tbody></table></div>';
    if (pr.canales.length) html += '<div class="cg-bloque"><div class="seccion-tit">Canales de venta que no existen (' + pr.canales.length + ')</div>'
      + '<table class="tabla-resumen cg-tabla"><thead><tr><th>Así viene en el Excel</th><th class="st-num">Servicios</th><th>Canal</th></tr></thead><tbody>'
      + pr.canales.map(c => { const v = EQ.canales[c.clave] ?? ''; return '<tr><td><b>' + esc(c.texto) + '</b></td><td class="st-num">' + c.filas + '</td><td><select class="cg-sel" data-tipo="canales" data-clave="' + esc(c.clave) + '">'
        + opcion('', '— Elige —', v) + (c.del_archivo?.length ? c.del_archivo.map(o => opcion('como:' + o.clave, 'Igual que «' + o.texto + '» (' + o.filas + ')', v)).join('') : '') + otros('canales', c, v) + canalOpts(v) + opcion('nuevo', 'Crear el canal «' + c.texto + '»', v) + opcion('ninguno', 'Sin canal', v) + '</select></td></tr>'; }).join('')
      + '</tbody></table></div>';
    $('cg-resolver').innerHTML = html;
    $('cg-errores').innerHTML = r.errores.length ? '<div class="cg-bloque"><div class="cg-errores-cab"><div class="seccion-tit cg-mal">Renglones con error: corrígelos en el Excel y vuelve a cargarlo</div>'
      + '<button type="button" class="btn btn-outline btn-chico" id="cg-avisos">📥 Descargar mi Excel con avisos</button></div><p class="ayuda">Te regresa tu mismo archivo con cada celda a corregir en rojo y un comentario (como los de Excel) que aparece al pasar el mouse, más una hoja «Avisos por corregir» con la lista.</p><div class="importar-errores">'
      + r.errores.slice(0, 300).map(e => '<div class="pago-fila"><div><b>' + esc(e.fila) + '</b><small class="motivo">' + e.errores.map(esc).join(' · ') + '</small></div></div>').join('')
      + (r.errores.length > 300 ? '<p class="ayuda">…y ' + (r.errores.length - 300) + ' más.</p>' : '') + '</div></div>' : '';
    $('cg-cobrado').hidden = false;
    actualizarBoton();
  }
  function cobrado() { const v = document.querySelector('input[name="cg-cobrado"]:checked')?.value; return v === 'si' ? true : v === 'no' ? false : null; }
  function actualizarBoton() {
    const r = ULTIMA; if (!r) return;
    const falta = [...document.querySelectorAll('#cg-resolver .cg-sel')].some(s => !s.value);
    const listo = !r.errores.length && !falta && cobrado() !== null;
    const b = $('cg-cargar');
    b.disabled = !listo;
    b.textContent = r.errores.length ? 'Corrige los errores para cargar' : falta ? 'Decide los nombres marcados para cargar' : cobrado() === null ? 'Indica si ya se cobraron' : 'Cargar ' + r.servicios + ' servicios';
  }

  // ---------- Cargar ----------
  async function cargar() {
    const res = await api('/generador/importar', { method: 'POST', body: JSON.stringify({ filas: FILAS, equivalencias: EQ, cobrado: cobrado() }) });
    const r = await res.json();
    if (!res.ok) { toast(r.error || 'No se pudo cargar'); return; }
    if (!r.importadas) { toast('No se cargó nada: revisa lo marcado.'); ULTIMA = r; pintar(r); return; }
    $('overlay-carga-gen').classList.remove('mostrar');
    FILAS = null;
    toast('Generador cargado: ' + r.importadas + ' servicios' + (r.creados?.clientes ? ' · ' + r.creados.clientes + ' clientes nuevos' : '') + '.');
    if (typeof cargarGenerador === 'function') cargarGenerador();
  }

  // ---------- Plantilla ----------
  async function plantilla() {
    let ExcelJS; try { ExcelJS = await Finanzas.cargarExcelJS(); } catch (err) { toast(err.message); return; }
    let clientes, servicios, canales;
    try { [clientes, servicios, canales] = await Promise.all([api('/clientes/catalogo').then(r => r.json()), api('/servicios').then(r => r.json()), api('/canales').then(r => r.json())]); }
    catch (err) { toast('No se pudo preparar la plantilla: ' + err.message); return; }
    const wb = new ExcelJS.Workbook(); wb.creator = 'Saneadren CRM';
    const ws = wb.addWorksheet('Generador', { views: [{ state: 'frozen', ySplit: 1 }] });
    const cols = [['FECHA', 12], ['NO. ORDEN', 11], ['NO. FACTURA', 13], ['CONCEPTO', 34], ['PRECIO UNITARIO SIN IVA', 14], ['CANTIDAD', 10], ['SUBTOTAL', 14], ['IVA', 12], ['TOTAL', 14],
      ['CANAL DE VENTA', 18], ['ID CLIENTE', 34], ['CLIENTE', 30], ['PROYECTO', 16], ['UNIDAD', 10], ['EMPLEADO', 22], ['MANIFIESTOS', 14]];
    ws.columns = cols.map(([t, w]) => ({ header: t, width: w }));
    const notas = { 'FECHA': 'Fecha del servicio (día/mes/año).', 'CONCEPTO': 'El servicio realizado: elige de la lista (catálogo de servicios).', 'ID CLIENTE': 'Elige el cliente de la lista: así no se duplica aunque el nombre se escriba distinto. Si es un cliente nuevo, déjalo vacío y escribe su nombre en CLIENTE.',
      'CLIENTE': 'Nombre o razón social. Si elegiste ID CLIENTE es solo de referencia.', 'SUBTOTAL': 'Se calcula: precio × cantidad.', 'IVA': 'Se calcula al 16 %. Si no lleva IVA, escribe 0.', 'TOTAL': 'Se calcula: subtotal + IVA.' };
    ws.getRow(1).eachCell((c, i) => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6B103' } }; c.alignment = { wrapText: true, vertical: 'middle' }; const n = notas[cols[i - 1][0]]; if (n) c.note = n; });
    ws.getRow(1).height = 32;
    const listas = wb.addWorksheet('Listas', { state: 'hidden' });
    const lista = (col, valores) => { valores.forEach((v, i) => { listas.getCell(col + (i + 1)).value = v; }); return `Listas!$${col}$1:$${col}$${Math.max(1, valores.length)}`; };
    const rServ = lista('A', servicios.filter(s => s.activo !== 0).map(s => s.nombre)), rCan = lista('B', canales.map(c => c.nombre)), rCli = lista('C', clientes.map(c => c.folio + ' · ' + (c.empresa || c.nombre || '')));
    for (let r = 2; r <= 1001; r++) {
      ws.getCell('A' + r).numFmt = 'dd/mm/yyyy';
      ws.getCell('A' + r).dataValidation = { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(2000, 0, 1))], showErrorMessage: true, error: 'Escribe una fecha (día/mes/año).' };
      ws.getCell('D' + r).dataValidation = { type: 'list', allowBlank: true, formulae: [rServ], showErrorMessage: true, error: 'Elige un servicio de la lista.' };
      ws.getCell('J' + r).dataValidation = { type: 'list', allowBlank: true, formulae: [rCan], showErrorMessage: true, error: 'Elige un canal de la lista.' };
      ws.getCell('K' + r).dataValidation = { type: 'list', allowBlank: true, formulae: [rCli], showErrorMessage: true, error: 'Elige un cliente de la lista (o déjalo vacío si es nuevo).' };
      ws.getCell('G' + r).value = { formula: `IF(E${r}="","",ROUND(E${r}*IF(F${r}="",1,F${r}),2))` };
      ws.getCell('H' + r).value = { formula: `IF(G${r}="","",ROUND(G${r}*0.16,2))` };
      ws.getCell('I' + r).value = { formula: `IF(G${r}="","",G${r}+H${r})` };
      ['E', 'G', 'H', 'I'].forEach(c => { ws.getCell(c + r).numFmt = '#,##0.00'; });
    }
    const wc = wb.addWorksheet('Clientes'); wc.columns = [{ header: 'ID', width: 12 }, { header: 'Razón social / nombre', width: 40 }, { header: 'Contacto', width: 26 }, { header: 'Teléfono', width: 14 }, { header: 'RFC', width: 15 }];
    wc.getRow(1).font = { bold: true };
    clientes.forEach(c => wc.addRow([c.folio, c.empresa || c.nombre || '', c.empresa && c.nombre !== c.empresa ? c.nombre : '', c.telefono || '', c.rfc || '']));
    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'plantilla_generador.xlsx');
  }

  // ---------- Eventos ----------
  $('cg-plantilla').addEventListener('click', e => conBotonCG(e.currentTarget, plantilla));
  $('cg-subir').addEventListener('click', () => { $('cg-archivo').value = ''; $('cg-archivo').click(); });
  $('cg-archivo').addEventListener('change', async () => {
    const archivo = $('cg-archivo').files[0]; if (!archivo) return;
    try {
      const leido = await leerExcel(archivo), { filas, hojas } = leido;
      FILAS = filas; HOJAS = hojas; POS = leido.pos; ARCHIVO = archivo; EQ = { clientes: {}, productos: {}, canales: {} }; ULTIMA = null;
      document.querySelectorAll('input[name="cg-cobrado"]').forEach(x => { x.checked = false; });
      $('cg-titulo').textContent = 'Cargar «' + archivo.name + '»';
      $('cg-resolver').innerHTML = ''; $('cg-errores').innerHTML = ''; $('cg-cobrado').hidden = true;
      abrirVentana('overlay-carga-gen');
      await revisar();
    } catch (err) { toast(err.message); }
  });
  $('cg-resolver').addEventListener('change', async e => {
    const s = e.target.closest('.cg-sel'); if (!s) return;
    const tipo = s.dataset.tipo, clave = s.dataset.clave;
    let v = s.value;
    if (v === 'otro') {
      const id = await solicitarDialogo({ titulo: 'Cliente que ya existe', mensaje: 'Escribe el ID del cliente (lo ves en su ficha, por ejemplo CLI-0039).', aceptar: 'Usar este cliente', campo: { tipo: 'text', etiqueta: 'ID del cliente' } });
      const m = String(id || '').trim().match(/^(?:CLI[\s-]*)?0*(\d{1,9})$/i);
      if (!m) { if (id) toast('Escribe un ID como CLI-0039'); s.value = EQ[tipo][clave] ?? ''; return; }
      v = Number(m[1]);
    } else if (/^\d+$/.test(v)) v = Number(v);
    if (v === '') delete EQ[tipo][clave]; else EQ[tipo][clave] = v;
    await revisar();
  });
  document.querySelectorAll('input[name="cg-cobrado"]').forEach(x => x.addEventListener('change', actualizarBoton));
  $('cg-errores').addEventListener('click', e => { const b = e.target.closest('#cg-avisos'); if (b) conBotonCG(b, descargarAvisos); });
  $('cg-cancelar').addEventListener('click', () => $('overlay-carga-gen').classList.remove('mostrar'));
  $('cg-cargar').addEventListener('click', e => conBotonCG(e.currentTarget, async () => {
    const r = ULTIMA; if (!r) return;
    const ok = await solicitarDialogo({ titulo: 'Cargar generador', mensaje: 'Se crearán ' + r.servicios + ' órdenes de servicio ya realizadas por ' + dinero(r.importe.total) + (cobrado() ? ', marcadas como cobradas (historial).' : ', que quedarán por cobrar en Cuentas por cobrar.') + (r.clientes_nuevos ? ' También ' + r.clientes_nuevos + ' clientes nuevos.' : ''), aceptar: 'Cargar' });
    if (ok) await cargar();
  }));
  async function conBotonCG(b, fn) { if (b.disabled) return; b.disabled = true; try { await fn(); } catch (err) { toast(err.message); } finally { b.disabled = false; actualizarBoton(); } }
  return { leerExcel, anotarAvisos };
})();
window.CargaGenerador = CargaGenerador;
