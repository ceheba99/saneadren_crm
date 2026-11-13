// RH (menú «RH», 2026-11-03): la pestaña que junta todo lo de recursos humanos —personal y expedientes, asistencia,
// horarios, días festivos, tiempo extra, Excel de nómina, kioscos, celulares y aviso de privacidad— y la CARGA DE
// TRABAJADORES EN LOTE con la plantilla de Excel (server/rh.js): descargar la plantilla, subirla, revisar fila por fila
// y guardar todo junto. Al guardar se descarga la hoja con número de empleado, código del checador y PIN temporal
// (los PIN solo existen en esa hoja: el sistema no los guarda).
// CREDENCIALES (2026-11-05, decidido con Dirección): tamaño credencial (85.6 × 54 mm), 8 por hoja carta, a DOS CARAS.
// Frente: foto, nombre, puesto, sucursal, número de empleado y vigencia. Reverso: QR «SANEADREN-CHECADOR:<código>» que
// el kiosco lee (el PIN se sigue pidiendo; quien la olvide teclea su código), QR de verificación para clientes
// (server/credenciales.js), contacto de emergencia y teléfono de la empresa. Imprimir una nueva anula la anterior.
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
    Repintado.cargando(cont, ''); // solo la primera vez: al refrescar tras un cambio, lo de antes se queda hasta que llega lo nuevo
    try { resumen = await pedir('/resumen'); } catch (e) { Repintado.falla(cont, e, cargar, `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`, 'rh'); return; }
    const r = resumen, p = r.puede;
    const tarjeta = (num, texto, clase, accion) => `<button type="button" class="rc-card ${clase}" data-rh-ir="${esc(accion)}"><span class="rc-num">${esc(num)}</span><span class="rc-label">${esc(texto)}</span></button>`;
    let h = `<div class="rc-grid">${tarjeta(r.activos, 'Personas activas', 'cliente', 'personal')}${tarjeta(r.sin_checador, 'Sin alta en el checador', r.sin_checador ? 'pr-atrasado' : 'cliente', 'personal')}
      ${tarjeta(r.sin_horario, 'Checan pero sin horario', r.sin_horario ? 'pr-atrasado' : 'cliente', 'personal')}${tarjeta(r.sin_aviso, 'Sin aviso de privacidad firmado', r.sin_aviso ? 'pr-atrasado' : 'cliente', 'personal')}
      ${r.pin_bloqueados ? tarjeta(r.pin_bloqueados, 'PIN bloqueados', 'pr-atrasado', 'personal') : ''}${r.por_revisar != null ? tarjeta(r.por_revisar, 'Checadas por revisar', r.por_revisar ? 'pr-atrasado' : 'cliente', 'dia') : ''}
      ${r.intentos_hoy ? tarjeta(r.intentos_hoy, 'Intentos fallidos hoy en el kiosco', 'pr-atrasado', 'dia') : ''}${r.biometria_fallos ? tarjeta(r.biometria_fallos, 'Biométrico no los reconoció (7 días, por revisar)', 'pr-atrasado', 'dia') : ''}${r.otra_red ? tarjeta(r.otra_red, 'Checadas desde otra red (7 días)', 'pr-atrasado', 'kioscos') : ''}
      ${r.sucursales_sin_ubicacion ? tarjeta(r.sucursales_sin_ubicacion, 'Sucursales sin ubicación para el celular', 'pr-atrasado', 'horarios') : ''}</div>`;
    const acceso = (icono, titulo, texto, accion, si = true) => (si ? `<button type="button" class="rh-acceso" data-rh-ir="${esc(accion)}"><span class="rh-icono" aria-hidden="true">${esc(icono)}</span><b>${esc(titulo)}</b><small>${esc(texto)}</small></button>` : '');
    h += `<div class="rh-accesos">
      ${acceso('👷', 'Personal y expedientes', 'Altas, bajas, datos, vacaciones, incidencias, documentos, código del checador y celular', 'personal')}
      ${acceso('📥', 'Cargar trabajadores', 'Plantilla de Excel para dar de alta a varios a la vez', 'importar', p.editar)}
      ${acceso('🕒', 'Asistencia del día', 'Entradas, comida, salidas, retardos, faltas y checadas por revisar', 'dia', p.asistencia)}
      ${acceso('📅', 'Semana y Excel de nómina', 'Semana vencida (de lunes a domingo): horas, faltas, retardos y tiempo extra autorizado', 'semana', p.asistencia)}
      ${acceso('⏱️', 'Reglas del tiempo extra', 'Cuándo empieza la semana y cuándo ya cuenta como tiempo extra', 'reglas', p.asistencia)}
      ${acceso('🗓️', 'Horarios', 'Entrada, salida, tolerancia y comida de cada día, por sucursal', 'horarios', p.asistencia)}
      ${acceso('🎉', 'Días festivos', 'Los de la ley y los de la empresa', 'festivos', p.asistencia)}
      ${acceso('📟', 'Kioscos del checador', 'Registrar o dar de baja la tableta de la entrada', 'kioscos', p.kioscos)}
      ${acceso('🔒', 'Aviso de privacidad', 'Imprimir el aviso para que lo firme cada trabajador', 'aviso')}
      ${acceso('🪪', 'Credenciales', 'Con foto y QR: para checar y para identificarse con los clientes', 'credenciales', p.editar)}
    </div><div id="rh-importar"></div><div id="rh-credenciales"></div>`;
    // «Cargar trabajadores» y «Credenciales» ya abiertos se quedan tal cual (con lo marcado y lo subido): solo se repinta el resto.
    const importarAntes = $('rh-importar'), credAntes = $('rh-credenciales');
    const conservaImp = !!importarAntes?.innerHTML.trim(), conservaCred = !!credAntes?.innerHTML.trim();
    Repintado.pintar(cont, h);
    if (conservaImp) $('rh-importar').replaceWith(importarAntes);
    if (conservaCred) $('rh-credenciales').replaceWith(credAntes);
    if (!conservaImp && (revisadas || creados)) pintarImportar();
  }
  function ir(accion) {
    if (accion === 'personal') cambiarVista('personal');
    else if (['dia', 'semana', 'horarios', 'festivos', 'reglas'].includes(accion)) { cambiarVista('asistencia'); document.querySelector(`[data-as-pestana="${accion}"]`)?.click(); }
    else if (accion === 'kioscos') { cambiarVista('personal'); setTimeout(() => document.querySelector('.pe-kioscos')?.scrollIntoView({ behavior: 'smooth' }), 300); }
    else if (accion === 'aviso') window.open('/aviso-privacidad-checador.html', '_blank', 'noopener');
    else if (accion === 'credenciales') { pintarCredenciales(); $('rh-credenciales').scrollIntoView({ behavior: 'smooth' }); }
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
    Repintado.pintar(cont, h + '</div>');
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

  // ---------- Credenciales (frente y reverso) ----------
  let conCodigo = [];
  const unAnio = () => { const d = new Date(hoy() + 'T12:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + 1); return d.toISOString().slice(0, 10); };
  const telEmpresa = () => { try { return localStorage.getItem('saneadren_tel_empresa') || ''; } catch { return ''; } };
  async function pintarCredenciales() {
    const cont = $('rh-credenciales'); if (!cont) return;
    Repintado.cargando(cont, '');
    try { const r = await api('/personal?estado=activos'), l = await r.json(); if (!r.ok) throw new Error(l.error || 'No se pudo cargar el personal'); conCodigo = (Array.isArray(l) ? l : []).filter(p => p.codigo_checador); }
    catch (e) { Repintado.falla(cont, e, pintarCredenciales, `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`); return; }
    const sinFoto = conCodigo.filter(p => !p.tiene_foto).length;
    Repintado.pintar(cont, `<div class="modal-section"><h3 class="pe-sub">🪪 Credenciales de empleado</h3>
      <p class="ayuda">Sirven para checar y para identificarse con los clientes. <b>Frente:</b> foto, nombre, puesto, número de empleado y vigencia. <b>Reverso:</b> QR del checador, QR de verificación (el guardia lo escanea y ve si la persona sigue trabajando con ustedes), contacto de emergencia y teléfono de la empresa.
      Se imprimen <b>a dos caras</b>, 8 por hoja carta: imprime con «dos caras / voltear por el lado largo», recórtalas y enmícalas. <b>Imprimir una credencial anula la anterior</b> de esa persona.</p>
      ${conCodigo.length ? `<div class="filtros"><label>Vigente hasta <input type="date" id="rh-cred-vig" value="${esc(unAnio())}"></label><label>Teléfono de la empresa <input id="rh-cred-tel" maxlength="25" value="${esc(telEmpresa())}" placeholder="442 000 0000"></label></div>
      ${sinFoto ? `<p class="as-rojo">⚠️ ${esc(sinFoto)} persona(s) sin foto: súbela desde su ficha (Personal → su nombre → «Foto para su credencial»). Sin foto, la credencial no sirve para identificarse.</p>` : ''}
      <div class="btn-group"><button type="button" class="btn btn-outline" id="rh-cred-todos">Marcar todos</button><button type="button" class="btn btn-outline" id="rh-cred-ninguno">Quitar todos</button><button type="button" class="btn btn-primario" id="rh-cred-pdf">📄 Imprimir credenciales (PDF)</button></div>
      <ul class="pe-ordenes">${conCodigo.map((p, i) => `<li><label><input type="checkbox" class="rh-cred" data-i="${i}" checked> <b>${esc(p.numero_empleado || '')}</b> · ${esc(p.nombre)} · ${esc(p.puesto || '')}${p.tiene_foto ? '' : ' <span class="as-rojo">(sin foto)</span>'}</label></li>`).join('')}</ul>`
        : '<p class="ayuda">Todavía nadie tiene código del checador: dalos de alta primero (ficha de la persona o «Cargar trabajadores»).</p>'}</div>`);
  }
  // Imagen → JPEG achicado (el PDF pesa poco). «fondo»: color para lo transparente.
  const jpegDe = (src, maxLado, fondo = '#ffffff') => new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => { const k = Math.min(1, maxLado / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      const x = c.getContext('2d'); x.fillStyle = fondo; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); ok({ data: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height }); };
    img.onerror = mal; img.src = src;
  });
  // Foto recortada al centro con la forma del recuadro de la credencial (22 × 28 mm).
  const fotoDe = async id => {
    const r = await api('/personal/' + Number(id) + '/foto'); if (!r.ok) return null;
    const u = URL.createObjectURL(await r.blob());
    try {
      const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = u; });
      const prop = 22 / 28, w0 = img.naturalWidth, h0 = img.naturalHeight, sw = Math.min(w0, h0 * prop), sh = sw / prop, c = document.createElement('canvas');
      c.width = 330; c.height = 420; c.getContext('2d').drawImage(img, (w0 - sw) / 2, (h0 - sh) / 2, sw, sh, 0, 0, c.width, c.height);
      return { data: c.toDataURL('image/jpeg', 0.85) };
    } finally { URL.revokeObjectURL(u); }
  };
  // QR dibujado cuadro por cuadro (nítido al imprimir), con fondo blanco.
  const dibujarQR = (doc, texto, x, y, lado) => {
    const q = qrcode(0, 'M'); q.addData(texto); q.make();
    const n = q.getModuleCount(), celda = lado / n;
    doc.setFillColor(255, 255, 255); doc.rect(x - 1, y - 1, lado + 2, lado + 2, 'F'); doc.setFillColor(0, 0, 0);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) doc.rect(x + c * celda, y + r * celda, celda + 0.02, celda + 0.02, 'F');
  };
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const fechaCorta = f => `${Number(f.slice(8, 10))} ${MESES[Number(f.slice(5, 7)) - 1]} ${f.slice(0, 4)}`;
  async function credencialesPdf(b) {
    const elegidos = [...document.querySelectorAll('.rh-cred:checked')].map(c => conCodigo[Number(c.dataset.i)]).filter(Boolean);
    if (!elegidos.length) { toast('Marca al menos a una persona'); return; }
    if (!window.jspdf || typeof qrcode !== 'function') { toast('No se cargaron las herramientas para el PDF: recarga la página'); return; }
    const vigencia = $('rh-cred-vig').value, tel = $('rh-cred-tel').value.trim();
    try { localStorage.setItem('saneadren_tel_empresa', tel); } catch { /* */ }
    if (!await solicitarDialogo({ titulo: 'Imprimir credenciales', mensaje: `Se imprimirán ${elegidos.length} credencial(es) vigentes hasta el ${fechaCorta(vigencia)}. Las credenciales anteriores de esas personas dejarán de valer (su QR de verificación dirá «no válida»).`, aceptar: 'Imprimir' })) return;
    b.disabled = true;
    try {
      const { credenciales } = await pedir('/credenciales', { method: 'POST', body: JSON.stringify({ ids: elegidos.map(p => p.id), vigencia }) });
      const logo = await jpegDe('/logo-saneadren.png', 400, '#1a1d23').catch(() => null);
      const fotos = new Map(await Promise.all(credenciales.filter(c => c.tiene_foto).map(async c => [c.personal_id, await fotoDe(c.personal_id).catch(() => null)])));
      const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: 'mm', format: 'letter', compress: true });
      const W = 85.6, H = 54, GX = 6, GY = 4, X0 = (215.9 - 2 * W - GX) / 2, Y0 = (279.4 - 4 * H - 3 * GY) / 2;
      const pos = (i, reverso) => { const col = i % 2, fila = Math.floor((i % 8) / 2); return [X0 + (reverso ? 1 - col : col) * (W + GX), Y0 + fila * (H + GY)]; }; // el reverso va en espejo
      const franja = (x, y, titulo) => {
        doc.setDrawColor(190); doc.setLineWidth(0.2); doc.roundedRect(x, y, W, H, 3, 3);
        doc.setFillColor(26, 29, 35); doc.roundedRect(x, y, W, 12, 3, 3, 'F'); doc.rect(x, y + 6, W, 6, 'F');
        doc.setFillColor(246, 177, 3); doc.rect(x, y + 12, W, 1.2, 'F');
        if (logo) doc.addImage(logo.data, 'JPEG', x + 3.5, y + 2, 29, 29 * logo.h / logo.w);
        doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); doc.text(titulo, x + W - 3.5, y + 7.5, { align: 'right' });
      };
      for (let ini = 0; ini < credenciales.length; ini += 8) {
        const grupo = credenciales.slice(ini, ini + 8);
        if (ini) doc.addPage();
        // FRENTE
        grupo.forEach((c, k) => {
          const [x, y] = pos(k, false);
          franja(x, y, 'CREDENCIAL DE EMPLEADO');
          const f = fotos.get(c.personal_id), fx = x + 4, fy = y + 16, fw = 22, fh = 28;
          doc.setDrawColor(200); doc.setLineWidth(0.3); doc.rect(fx, fy, fw, fh);
          if (f) { doc.addImage(f.data, 'JPEG', fx, fy, fw, fh); doc.rect(fx, fy, fw, fh); }
          else { doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(150); doc.text('FOTO', fx + fw / 2, fy + fh / 2, { align: 'center' }); }
          const tx = fx + fw + 4, ancho = W - (tx - x) - 3.5;
          doc.setTextColor(31, 41, 55); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
          const nombre = doc.splitTextToSize(String(c.nombre || '').toUpperCase(), ancho).slice(0, 3);
          doc.text(nombre, tx, y + 19.5);
          let yy = y + 19.5 + nombre.length * 4.1;
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8.3); doc.setTextColor(75, 85, 99);
          doc.text(String(c.puesto || ''), tx, yy); yy += 3.7;
          if (c.sucursal) doc.text(String(c.sucursal), tx, yy);
          doc.setFontSize(6.2); doc.text('No. de empleado', tx, y + 41); doc.text('Vigente hasta', x + W - 3.5, y + 41, { align: 'right' });
          doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 29, 35); doc.setFontSize(13); doc.text(String(c.numero_empleado || ''), tx, y + 46.5);
          doc.setFontSize(9); doc.text(fechaCorta(c.vigencia), x + W - 3.5, y + 46.5, { align: 'right' });
          doc.setFont('helvetica', 'normal'); doc.setFontSize(5.4); doc.setTextColor(110); doc.text('Personal e intransferible. Propiedad de Saneadren.', x + W / 2, y + H - 2, { align: 'center' });
        });
        // REVERSO (página siguiente, en espejo para imprimir a dos caras)
        doc.addPage();
        grupo.forEach((c, k) => {
          const [x, y] = pos(k, true);
          franja(x, y, 'VERIFICACIÓN Y CHECADOR');
          const lado = 22, q1x = x + 6, q2x = x + W - lado - 6, qy = y + 16;
          if (c.codigo) dibujarQR(doc, 'SANEADREN-CHECADOR:' + c.codigo, q1x, qy, lado);
          dibujarQR(doc, c.url || (location.origin + c.ruta), q2x, qy, lado);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(6.3); doc.setTextColor(31, 41, 55);
          if (c.codigo) doc.text('Reloj checador · código ' + c.codigo, q1x + lado / 2, qy + lado + 2.8, { align: 'center' });
          doc.text('Verificar credencial', q2x + lado / 2, qy + lado + 2.8, { align: 'center' });
          doc.setFont('helvetica', 'normal'); doc.setFontSize(6.2); doc.setTextColor(55, 65, 81);
          const emer = c.contacto_emergencia || c.tel_emergencia ? `Emergencia: ${[c.contacto_emergencia, c.tel_emergencia].filter(Boolean).join(' · ')}` : 'Emergencia: (sin contacto registrado)';
          doc.text(doc.splitTextToSize(emer, W - 8).slice(0, 1), x + 4, y + H - 7.2);
          doc.setFontSize(5.6); doc.setTextColor(110);
          doc.text(`Si encuentra esta credencial, llame a Saneadren${tel ? ' al ' + tel : ''}.`, x + W / 2, y + H - 2.4, { align: 'center' });
        });
      }
      doc.save(`credenciales_${hoy()}.pdf`);
      const sin = credenciales.filter(c => !fotos.get(c.personal_id)).length;
      toast(`Se descargaron ${credenciales.length} credencial(es)${sin ? ` (${sin} sin foto)` : ''}. Imprime a dos caras, volteando por el lado largo.`);
    } catch (e) { toast('No se pudieron hacer las credenciales: ' + e.message); }
    b.disabled = false;
  }

  $('rh-cuerpo').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.rhIr) ir(b.dataset.rhIr);
    else if (b.id === 'rh-plantilla') plantilla();
    else if (b.id === 'rh-guardar') guardar(b);
    else if (b.id === 'rh-hoja') hojaCodigos();
    else if (b.id === 'rh-cred-pdf') credencialesPdf(b);
    else if (b.id === 'rh-cred-todos' || b.id === 'rh-cred-ninguno') document.querySelectorAll('.rh-cred').forEach(c => { c.checked = b.id === 'rh-cred-todos'; });
  });
  $('rh-cuerpo').addEventListener('change', e => { if (e.target.id === 'rh-archivo' && e.target.files[0]) { leerArchivo(e.target.files[0]); e.target.value = ''; } });
  return { cargar };
})();
