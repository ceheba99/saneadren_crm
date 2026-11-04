// RH (menú «RH», 2026-11-03): la pestaña que junta todo lo de recursos humanos —personal y expedientes, asistencia,
// horarios, días festivos, tiempo extra, Excel de nómina, kioscos, celulares y aviso de privacidad— y la CARGA DE
// TRABAJADORES EN LOTE con la plantilla de Excel (server/rh.js): descargar la plantilla, subirla, revisar fila por fila
// y guardar todo junto. Al guardar se descarga la hoja con número de empleado, código del checador y PIN temporal
// (los PIN solo existen en esa hoja: el sistema no los guarda).
const RH = (() => {
  const $ = id => document.getElementById(id);
  const esc = t => escaparHtml(t == null ? '' : String(t));
  const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  // Columnas de la plantilla: [llave, título, ancho, obligatoria, lista]
  const COLS = [['nombre', 'Nombre completo', 34, true], ['puesto', 'Puesto', 18, true, 'puestos'], ['sucursal', 'Sucursal (clave)', 14, false, 'sucursales'],
    ['telefono', 'Teléfono', 16], ['correo', 'Correo', 26], ['fecha_ingreso', 'Fecha de ingreso', 14], ['contacto_emergencia', 'Contacto de emergencia', 26],
    ['tel_emergencia', 'Teléfono de emergencia', 18], ['horario', 'Horario', 18, false, 'horarios'], ['checador', 'Alta en checador (Sí/No)', 14, false, 'sino']];
  let resumen = null, revisadas = null, creados = null;
  async function pedir(ruta, opciones) {
    const r = await api('/rh' + ruta, opciones), j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'No se pudo completar'); e.datos = j; throw e; }
    return j;
  }

  // ---------- Resumen y accesos ----------
  async function cargar() {
    const cont = $('rh-cuerpo');
    try { resumen = await pedir('/resumen'); } catch (e) { cont.innerHTML = `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`; return; }
    const r = resumen, p = r.puede;
    const tarjeta = (num, texto, clase, accion) => `<button type="button" class="rc-card ${clase}" data-rh-ir="${esc(accion)}"><span class="rc-num">${esc(num)}</span><span class="rc-label">${esc(texto)}</span></button>`;
    let h = `<div class="rc-grid">${tarjeta(r.activos, 'Personas activas', 'cliente', 'personal')}${tarjeta(r.sin_checador, 'Sin alta en el checador', r.sin_checador ? 'pr-atrasado' : 'cliente', 'personal')}
      ${tarjeta(r.sin_horario, 'Checan pero sin horario', r.sin_horario ? 'pr-atrasado' : 'cliente', 'personal')}${tarjeta(r.sin_aviso, 'Sin aviso de privacidad firmado', r.sin_aviso ? 'pr-atrasado' : 'cliente', 'personal')}
      ${r.pin_bloqueados ? tarjeta(r.pin_bloqueados, 'PIN bloqueados', 'pr-atrasado', 'personal') : ''}${r.por_revisar != null ? tarjeta(r.por_revisar, 'Checadas por revisar', r.por_revisar ? 'pr-atrasado' : 'cliente', 'dia') : ''}</div>`;
    const acceso = (icono, titulo, texto, accion, si = true) => (si ? `<button type="button" class="rh-acceso" data-rh-ir="${esc(accion)}"><span class="rh-icono" aria-hidden="true">${esc(icono)}</span><b>${esc(titulo)}</b><small>${esc(texto)}</small></button>` : '');
    h += `<div class="rh-accesos">
      ${acceso('👷', 'Personal y expedientes', 'Altas, bajas, datos, vacaciones, incidencias, documentos, código del checador y celular', 'personal')}
      ${acceso('📥', 'Cargar trabajadores', 'Plantilla de Excel para dar de alta a varios a la vez', 'importar', p.editar)}
      ${acceso('🕒', 'Asistencia del día', 'Entradas, comida, salidas, retardos, faltas y checadas por revisar', 'dia', p.asistencia)}
      ${acceso('📅', 'Semana y Excel de nómina', 'De viernes a jueves: horas, faltas, retardos y tiempo extra autorizado', 'semana', p.asistencia)}
      ${acceso('🗓️', 'Horarios', 'Entrada, salida, tolerancia y comida de cada día, por sucursal', 'horarios', p.asistencia)}
      ${acceso('🎉', 'Días festivos', 'Los de la ley y los de la empresa', 'festivos', p.asistencia)}
      ${acceso('📟', 'Kioscos del checador', 'Registrar o dar de baja la tableta de la entrada', 'kioscos', p.kioscos)}
      ${acceso('🔒', 'Aviso de privacidad', 'Imprimir el aviso para que lo firme cada trabajador', 'aviso')}
    </div><div id="rh-importar"></div>`;
    cont.innerHTML = h;
    if (revisadas || creados) pintarImportar();
  }
  function ir(accion) {
    if (accion === 'personal') cambiarVista('personal');
    else if (['dia', 'semana', 'horarios', 'festivos'].includes(accion)) { cambiarVista('asistencia'); document.querySelector(`[data-as-pestana="${accion}"]`)?.click(); }
    else if (accion === 'kioscos') { cambiarVista('personal'); setTimeout(() => document.querySelector('.pe-kioscos')?.scrollIntoView({ behavior: 'smooth' }), 300); }
    else if (accion === 'aviso') window.open('/aviso-privacidad-checador.html', '_blank', 'noopener');
    else if (accion === 'importar') { revisadas = null; creados = null; pintarImportar(); $('rh-importar').scrollIntoView({ behavior: 'smooth' }); }
  }

  // ---------- Carga en lote ----------
  function pintarImportar() {
    const cont = $('rh-importar'); if (!cont) return;
    let h = `<div class="modal-section"><h3 class="pe-sub">📥 Cargar trabajadores</h3>
      <ol class="rh-pasos"><li>Descarga la plantilla y llena una fila por trabajador (los obligatorios: nombre y puesto).</li><li>Súbela: el sistema revisa cada fila y te dice qué corregir. Todavía no guarda nada.</li>
      <li>Si todo está bien, pulsa «Guardar». A cada uno se le da su número de empleado (0001, 0002…) y, si lo pediste, su código y PIN temporal del checador.</li></ol>
      <div class="btn-group"><button type="button" class="btn btn-outline" id="rh-plantilla">📄 Descargar plantilla</button><label class="btn btn-secundario">📤 Subir plantilla llena<input type="file" id="rh-archivo" accept=".xlsx" hidden></label></div>`;
    if (revisadas) {
      const malas = revisadas.filas.filter(f => f.errores.length).length;
      h += `<p role="status">${esc(revisadas.filas.length)} trabajador(es) en el archivo · ${malas ? `<b class="as-rojo">${esc(malas)} con errores</b> (corrígelos en el Excel y vuelve a subirlo)` : '<b>todo correcto</b>'}</p>
        <div class="tabla-scroll"><table class="tabla-resumen as-tabla"><thead><tr><th>Fila</th><th>Nombre</th><th>Puesto</th><th>Sucursal</th><th>Horario</th><th>Checador</th><th>Revisión</th></tr></thead><tbody>
        ${revisadas.filas.map(f => `<tr class="${f.errores.length ? 'as-falta' : ''}"><td>${esc(f.fila)}</td><td>${esc(f.nombre)}</td><td>${esc(f.puesto)}</td><td>${esc(f.sucursal || '')}</td><td>${esc(f.horario || '')}</td><td>${esc(f.checador ? 'Sí' : 'No')}</td>
          <td>${f.errores.length ? f.errores.map(x => `<span class="as-rojo">${esc(x)}</span>`).join('<br>') : '✔'}</td></tr>`).join('')}</tbody></table></div>
        ${malas ? '' : `<div class="btn-group"><button type="button" class="btn btn-primario" id="rh-guardar">Guardar ${esc(revisadas.filas.length)} trabajador(es)</button></div>`}`;
    }
    if (creados) h += `<p class="pe-pin-nuevo" role="alert">✔ Se dieron de alta ${esc(creados.length)} trabajador(es). La hoja con número de empleado, código y PIN temporal se descargó; si no, <button type="button" class="btn-link" id="rh-hoja">descárgala aquí</button>. <b>Los PIN no se vuelven a mostrar</b>: entrégalos y guarda la hoja en un lugar seguro (o destrúyela al repartirlos).</p>`;
    cont.innerHTML = h + '</div>';
  }
  async function plantilla() {
    let ExcelJS; try { ExcelJS = await Finanzas.cargarExcelJS(); } catch (e) { toast(e.message); return; }
    let horarios = [], catalogo = null;
    try { catalogo = await api('/personal/catalogos').then(r => r.json()); const hs = await api('/asistencia/horarios').then(r => (r.ok ? r.json() : { horarios: [] })); horarios = [...new Set(hs.horarios.filter(x => x.activo).map(x => x.nombre))]; } catch { /* sin listas */ }
    const sucs = (window.Sucursales?.datos?.sucursales || []).filter(s => s.activo).map(s => s.clave);
    const wb = new ExcelJS.Workbook(); wb.creator = 'Saneadren CRM';
    const ws = wb.addWorksheet('Trabajadores', { views: [{ state: 'frozen', ySplit: 1 }] });
    const ls = wb.addWorksheet('Listas', { state: 'veryHidden' });
    const listas = { puestos: catalogo?.puestos || [], sucursales: sucs, horarios, sino: ['Sí', 'No'] };
    Object.entries(listas).forEach(([, valores], i) => valores.forEach((v, j) => { ls.getCell(j + 1, i + 1).value = v; }));
    const rango = k => { const i = Object.keys(listas).indexOf(k), col = String.fromCharCode(65 + i); return `Listas!$${col}$1:$${col}$${Math.max(1, listas[k].length)}`; };
    ws.columns = COLS.map(([, titulo, ancho, req]) => ({ header: titulo + (req ? ' *' : ''), width: ancho }));
    ws.getRow(1).font = { bold: true };
    for (let r = 2; r <= 301; r++) COLS.forEach(([k, , , , lista], c) => {
      const celda = ws.getCell(r, c + 1);
      if (lista && listas[lista].length) celda.dataValidation = { type: 'list', allowBlank: true, formulae: [rango(lista)], showErrorMessage: true, error: 'Elige un valor de la lista.' };
      if (k === 'fecha_ingreso') { celda.numFmt = 'dd/mm/yyyy'; celda.dataValidation = { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(1970, 0, 1))], showErrorMessage: true, error: 'Escribe una fecha (día/mes/año).' }; }
      if (k === 'telefono' || k === 'tel_emergencia') celda.numFmt = '@';
    });
    const ins = wb.addWorksheet('Instrucciones');
    ins.columns = [{ width: 110 }];
    ['Cómo llenar la plantilla de trabajadores', '', '· Una fila por trabajador, desde la fila 2 de la hoja «Trabajadores». Máximo 300.', '· Obligatorios: Nombre completo y Puesto (elige de la lista).',
      `· Sucursal: su clave (${sucs.join(', ') || 'p. ej. QRO'}). Si solo manejas una sucursal, puedes dejarla vacía.`, '· Fecha de ingreso: día/mes/año. No puede ser futura.',
      '· Horario: elige de la lista (el nombre del horario de esa sucursal). Déjalo vacío si aún no lo sabes.', '· Alta en checador: «Sí» para darle código y PIN temporal del reloj checador.',
      '· El número de empleado (0001, 0002…) lo pone el sistema: no lo escribas.', '· Al guardar se descarga una hoja con los códigos y PIN temporales: es la única vez que se ven.']
      .forEach((t, i) => { ins.getCell(i + 1, 1).value = t; if (!i) ins.getCell(1, 1).font = { bold: true, size: 13 }; });
    saveAs(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'plantilla_trabajadores.xlsx');
  }
  async function leerArchivo(archivo) {
    let ExcelJS; try { ExcelJS = await Finanzas.cargarExcelJS(); } catch (e) { toast(e.message); return; }
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(await archivo.arrayBuffer(), { ignoreNodes: ['dataValidations', 'conditionalFormatting', 'hyperlinks'] }); } catch { toast('No se pudo leer el archivo. Usa la plantilla y guárdala como Excel (.xlsx).'); return; }
    const ws = wb.getWorksheet('Trabajadores') || wb.worksheets[0];
    const filas = [];
    for (let r = 2; r <= Math.min(ws.rowCount, 400); r++) {
      const fila = { fila: r };
      COLS.forEach(([k], c) => { let v = Finanzas.valorCelda(ws.getCell(r, c + 1).value); if (k === 'fecha_ingreso' && v) v = Finanzas.fechaTexto(v); fila[k] = String(v ?? '').trim(); });
      if (COLS.some(([k]) => fila[k])) filas.push(fila);
    }
    if (!filas.length) { toast('El archivo no tiene trabajadores (llena desde la fila 2)'); return; }
    try { revisadas = await pedir('/importar/revisar', { method: 'POST', body: JSON.stringify({ filas }) }); revisadas._filas = filas; creados = null; pintarImportar(); }
    catch (e) { toast(e.message); }
  }
  async function guardar(boton) {
    if (!revisadas || boton.disabled) return;
    if (!await solicitarDialogo({ titulo: 'Guardar trabajadores', mensaje: `Se darán de alta ${revisadas.filas.length} trabajador(es) con su número de empleado. Si alguno no puede guardarse, no se guarda ninguno.`, aceptar: 'Guardar' })) return;
    boton.disabled = true;
    try {
      const r = await pedir('/importar/guardar', { method: 'POST', body: JSON.stringify({ filas: revisadas._filas }) });
      creados = r.creados; revisadas = null; await hojaCodigos(); await cargar();
    } catch (e) { if (e.datos?.filas) { revisadas = { ...e.datos, _filas: revisadas._filas }; pintarImportar(); } toast(e.message); boton.disabled = false; }
  }
  async function hojaCodigos() {
    if (!creados?.length) return;
    let ExcelJS; try { ExcelJS = await Finanzas.cargarExcelJS(); } catch (e) { toast(e.message); return; }
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Códigos y PIN');
    ws.addRow(['Códigos del reloj checador · PIN TEMPORAL: cada quien elige el suyo en su primera checada. Entrégalos en persona.']).font = { bold: true };
    ws.addRow(['Número de empleado', 'Nombre', 'Puesto', 'Sucursal', 'Horario', 'Código para checar', 'PIN temporal']).font = { bold: true };
    for (const c of creados) ws.addRow([c.numero_empleado, c.nombre, c.puesto, c.sucursal || '', c.horario || '', c.codigo || '(sin alta en checador)', c.pin || '']);
    [12, 32, 16, 16, 16, 16, 12].forEach((w, i) => { ws.getColumn(i + 1).width = w; ws.getColumn(i + 1).numFmt = '@'; });
    saveAs(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `codigos_checador_${hoy()}.xlsx`);
  }

  $('rh-cuerpo').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.rhIr) ir(b.dataset.rhIr);
    else if (b.id === 'rh-plantilla') plantilla();
    else if (b.id === 'rh-guardar') guardar(b);
    else if (b.id === 'rh-hoja') hojaCodigos();
  });
  $('rh-cuerpo').addEventListener('change', e => { if (e.target.id === 'rh-archivo' && e.target.files[0]) { leerArchivo(e.target.files[0]); e.target.value = ''; } });
  return { cargar };
})();
