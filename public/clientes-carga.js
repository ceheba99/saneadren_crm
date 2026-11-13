/* Clientes: carga con plantilla y eliminar (Configuración → Ajustes, solo Dirección; 2026-11-09). Servidor:
   server/clientes-carga.js. Descargar la plantilla, subirla (revisar sin guardar), guardar, ver las cargas anteriores
   (y deshacerlas) y buscar cualquier cliente para eliminarlo si no tiene registros. */
const ClientesCarga = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t);
  // [llave, título, ancho, obligatoria, lista]
  const COLS = [['nombre', 'Nombre del contacto', 30, true], ['empresa', 'Empresa', 30], ['telefono', 'Teléfono (10 dígitos)', 18, true], ['telefono_alterno', 'Teléfono alterno', 18],
    ['correo', 'Correo', 28], ['direccion', 'Dirección', 40], ['tipo', 'Tipo de cliente', 22, false, 'tipos'], ['canal', 'Cómo nos conoció', 24, false, 'canales'],
    ['rfc', 'RFC', 16], ['sucursal', 'Sucursal', 12, false, 'sucursales'], ['notas', 'Notas', 40]];
  let revisadas = null, guardado = null, abierta = null, listo = false;
  const fecha = f => { const [d, h] = String(f || '').split(' '); return (d || '').split('-').reverse().join('/') + (h ? ' ' + h.slice(0, 5) : ''); };
  async function pedir(ruta, opciones) {
    const r = await api(ruta, opciones), j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'No se pudo completar'), { datos: j });
    return j;
  }

  // ---------- Pantalla ----------
  function pintarCarga() {
    let h = `<ol class="rh-pasos"><li>Descarga la plantilla y llena una fila por cliente (obligatorios: nombre y teléfono de 10 dígitos).</li>
      <li>Súbela: el sistema revisa cada fila y te dice qué corregir. Todavía no guarda nada.</li>
      <li>Si todo está bien, pulsa «Guardar». Los teléfonos que ya están en el sistema se omiten (no se duplican).</li></ol>
      <div class="btn-group"><button type="button" class="btn btn-outline" id="cc-plantilla">📄 Descargar plantilla</button><label class="btn btn-secundario">📤 Subir plantilla llena<input type="file" id="cc-archivo" accept=".xlsx" hidden></label></div>`;
    if (revisadas) {
      const r = revisadas;
      h += `<p role="status">${esc(r.filas.length)} fila(s) · <b>${esc(r.nuevos)} nuevo(s)</b> · ${esc(r.existentes)} ya existen (se omiten)${r.con_errores ? ` · <b class="as-rojo">${esc(r.con_errores)} con errores</b> (corrígelos en el Excel y vuelve a subirlo)` : ''}</p>
        <div class="tabla-scroll"><table class="tabla-resumen bit-tabla cc-tabla"><thead><tr><th>Fila</th><th>Nombre</th><th>Empresa</th><th>Teléfono</th><th>Sucursal</th><th>Revisión</th></tr></thead><tbody>
        ${r.filas.map(f => `<tr class="${f.errores.length ? 'as-falta' : ''}"><td>${esc(f.fila)}</td><td>${esc(f.nombre)}</td><td>${esc(f.empresa || '')}</td><td>${esc(f.telefono || '')}</td><td>${esc(f.sucursal || '')}</td>
          <td>${f.errores.length ? f.errores.map(x => `<span class="as-rojo">${esc(x)}</span>`).join('<br>') : f.existe ? 'Ya existe: ' + esc(f.existe.folio + ' ' + f.existe.nombre) + ' (se omite)' : '✔ Nuevo'}
          ${f.avisos?.length ? '<br><small>⚠ ' + f.avisos.map(esc).join('<br>⚠ ') + '</small>' : ''}</td></tr>`).join('')}</tbody></table></div>
        ${!r.hay_errores && r.nuevos ? `<div class="btn-group"><button type="button" class="btn btn-primario" id="cc-guardar">Guardar ${esc(r.nuevos)} cliente(s) nuevo(s)</button></div>` : ''}`;
    }
    if (guardado) h += `<p class="pe-pin-nuevo" role="alert">✔ Se dieron de alta ${esc(guardado.creados)} cliente(s) (carga #${esc(guardado.carga_id)})${guardado.omitidos ? ` · ${esc(guardado.omitidos)} omitido(s) porque ya existían` : ''}.</p>`;
    $('cc-carga').innerHTML = h;
  }
  async function pintarCargas() {
    const cont = $('cc-cargas');
    let j; try { j = await pedir('/clientes-carga'); } catch (e) { Repintado.falla(cont, e, pintarCargas, '<p class="aviso-error-carga">' + esc(e.message) + '</p>'); return; }
    const detalleAntes = abierta ? ($('cc-detalle-' + abierta)?.innerHTML || '') : ''; // el detalle abierto se queda mientras llega el nuevo
    Repintado.pintar(cont, j.cargas.length ? `<div class="tabla-scroll"><table class="tabla-resumen bit-tabla cc-tabla"><thead><tr><th>Carga</th><th>Fecha</th><th>Quién</th><th>Archivo</th><th>Clientes</th><th></th></tr></thead><tbody>
      ${j.cargas.map(k => `<tr><td>#${esc(k.id)}</td><td>${esc(fecha(k.fecha))}</td><td>${esc(k.usuario || '')}</td><td>${esc(k.archivo || '')}</td><td>${esc(k.quedan)} de ${esc(k.creados)}${k.omitidos ? ` <small>(${esc(k.omitidos)} omitidos)</small>` : ''}</td>
        <td class="cc-acciones"><button type="button" class="btn btn-outline btn-chico" data-cc-ver="${esc(k.id)}">${abierta === k.id ? 'Ocultar' : 'Ver clientes'}</button>${k.quedan ? ` <button type="button" class="btn btn-outline btn-chico" data-cc-deshacer="${esc(k.id)}">Deshacer carga</button>` : ''}</td></tr>
        ${abierta === k.id ? `<tr><td colspan="6" id="cc-detalle-${esc(k.id)}">${detalleAntes && !/Cargando/.test(detalleAntes) ? detalleAntes : '<p class="util-45">Cargando…</p>'}</td></tr>` : ''}`).join('')}</tbody></table></div>`
      : '<p class="util-45">Todavía no hay cargas.</p>');
    if (abierta) pintarDetalle(abierta);
  }
  const tablaClientes = lista => lista.length ? `<div class="tabla-scroll"><table class="tabla-resumen bit-tabla cc-tabla"><thead><tr><th>ID</th><th>Nombre</th><th>Empresa</th><th>Teléfono</th><th></th></tr></thead><tbody>
    ${lista.map(c => `<tr><td>${esc(c.folio)}</td><td>${esc(c.nombre)}</td><td>${esc(c.empresa || '')}</td><td>${esc(c.telefono || '')}</td>
      <td>${c.eliminable ? `<button type="button" class="btn btn-outline btn-chico btn-peligro-texto" data-cc-eliminar="${esc(c.id)}" data-cc-nombre="${esc(c.empresa || c.nombre)}">🗑 Eliminar</button>` : `<small title="${esc(c.tiene)}">No se elimina: tiene ${esc(c.tiene)}</small>`}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="util-45">No hay clientes.</p>';
  async function pintarDetalle(id) {
    const cont = $('cc-detalle-' + id); if (!cont) return;
    try { const j = await pedir('/clientes-carga/' + id); cont.innerHTML = tablaClientes(j.clientes); } catch (e) { cont.innerHTML = '<p class="aviso-error-carga">' + esc(e.message) + '</p>'; }
  }
  let consulta = 0;
  async function buscar() {
    const q = $('cc-buscar').value.trim(), turno = ++consulta, cont = $('cc-resultados');
    if (q.length < 2) { cont.innerHTML = ''; return; }
    try { const j = await pedir('/clientes-gestion/buscar?q=' + encodeURIComponent(q)); if (turno === consulta) cont.innerHTML = tablaClientes(j.clientes); }
    catch (e) { if (turno === consulta) cont.innerHTML = '<p class="aviso-error-carga">' + esc(e.message) + '</p>'; }
  }

  // ---------- Plantilla ----------
  async function plantilla() {
    let ExcelJS; try { ExcelJS = await Finanzas.cargarExcelJS(); } catch (e) { toast(e.message); return; }
    let tipos = [], canales = [];
    try { tipos = (await api('/tipos-cliente').then(r => r.json())).map(t => t.nombre); canales = (await api('/canales').then(r => r.json())).map(c => c.nombre); } catch { /* sin listas */ }
    const sucs = (window.Sucursales?.datos?.sucursales || []).filter(s => s.activo).map(s => s.clave);
    const wb = new ExcelJS.Workbook(); wb.creator = 'Saneadren CRM';
    const ws = wb.addWorksheet('Clientes', { views: [{ state: 'frozen', ySplit: 1 }] });
    const ls = wb.addWorksheet('Listas', { state: 'veryHidden' });
    const listas = { tipos, canales, sucursales: sucs };
    Object.values(listas).forEach((valores, i) => valores.forEach((v, j) => { ls.getCell(j + 1, i + 1).value = v; }));
    const rango = k => { const i = Object.keys(listas).indexOf(k), col = String.fromCharCode(65 + i); return `Listas!$${col}$1:$${col}$${Math.max(1, listas[k].length)}`; };
    ws.columns = COLS.map(([, titulo, ancho, req]) => ({ header: titulo + (req ? ' *' : ''), width: ancho }));
    ws.getRow(1).font = { bold: true };
    for (let r = 2; r <= 1001; r++) COLS.forEach(([k, , , , lista], c) => {
      const celda = ws.getCell(r, c + 1);
      if (lista && listas[lista].length) celda.dataValidation = { type: 'list', allowBlank: true, formulae: [rango(lista)], showErrorMessage: true, error: 'Elige un valor de la lista.' };
      if (k === 'telefono' || k === 'telefono_alterno' || k === 'rfc') celda.numFmt = '@';
    });
    const ins = wb.addWorksheet('Instrucciones');
    ins.columns = [{ width: 110 }];
    ['Cómo llenar la plantilla de clientes', '', '· Una fila por cliente, desde la fila 2 de la hoja «Clientes». Máximo 2,000.', '· Obligatorios: Nombre del contacto y Teléfono (10 dígitos, sin lada internacional).',
      '· Empresa: el nombre del negocio (p. ej. KFC Puerta la Victoria). Si es persona, déjala vacía.', '· Tipo de cliente y Cómo nos conoció: elige de la lista.',
      `· Sucursal: su clave (${sucs.join(', ') || 'p. ej. QRO'}). Vacía = la sucursal principal.`, '· RFC: opcional (p. ej. ABC010101AB1).',
      '· Si un teléfono ya es de un cliente del sistema, esa fila no se carga (no se duplica) y te dice de quién es.', '· Nada se guarda hasta que revisas y pulsas «Guardar».']
      .forEach((t, i) => { ins.getCell(i + 1, 1).value = t; if (!i) ins.getCell(1, 1).font = { bold: true, size: 13 }; });
    saveAs(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'plantilla_clientes.xlsx');
  }
  async function leerArchivo(archivo) {
    let ExcelJS; try { ExcelJS = await Finanzas.cargarExcelJS(); } catch (e) { toast(e.message); return; }
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(await archivo.arrayBuffer(), { ignoreNodes: ['dataValidations', 'conditionalFormatting', 'hyperlinks'] }); } catch { toast('No se pudo leer el archivo. Usa la plantilla y guárdala como Excel (.xlsx).'); return; }
    const ws = wb.getWorksheet('Clientes') || wb.worksheets[0];
    const filas = [];
    for (let r = 2; r <= Math.min(ws.rowCount, 2100); r++) {
      const fila = { fila: r };
      COLS.forEach(([k], c) => { fila[k] = String(Finanzas.valorCelda(ws.getCell(r, c + 1).value) ?? '').trim(); });
      if (COLS.some(([k]) => fila[k])) filas.push(fila);
    }
    if (!filas.length) { toast('El archivo no tiene clientes (llena desde la fila 2)'); return; }
    try { revisadas = await pedir('/clientes-carga/revisar', { method: 'POST', body: JSON.stringify({ filas }) }); revisadas._filas = filas; revisadas._archivo = archivo.name; guardado = null; pintarCarga(); }
    catch (e) { toast(e.message); }
  }
  async function guardar(boton) {
    if (!revisadas || boton.disabled) return;
    if (!await solicitarDialogo({ titulo: 'Guardar clientes', mensaje: `Se darán de alta ${revisadas.nuevos} cliente(s) nuevo(s)${revisadas.existentes ? ` y se omitirán ${revisadas.existentes} que ya existen` : ''}. Si alguno no puede guardarse, no se guarda ninguno.`, aceptar: 'Guardar' })) return;
    boton.disabled = true;
    try {
      guardado = await pedir('/clientes-carga/guardar', { method: 'POST', body: JSON.stringify({ filas: revisadas._filas, archivo: revisadas._archivo }) });
      revisadas = null; abierta = guardado.carga_id; pintarCarga(); pintarCargas();
    } catch (e) { if (e.datos?.filas) { revisadas = { ...e.datos, _filas: revisadas._filas, _archivo: revisadas._archivo }; pintarCarga(); } toast(e.message); boton.disabled = false; }
  }
  async function eliminar(boton) {
    const nombre = boton.dataset.ccNombre;
    if (!await solicitarDialogo({ titulo: 'Eliminar cliente', mensaje: `Se borrará «${nombre}» del sistema. Solo se puede porque no tiene cotizaciones, órdenes ni cobros. Queda registrado en la bitácora. No se puede deshacer.`, aceptar: 'Eliminar' })) return;
    boton.disabled = true;
    try { await pedir('/clientes/' + Number(boton.dataset.ccEliminar) + '/eliminar', { method: 'POST', body: '{}' }); toast('Cliente eliminado'); buscar(); pintarCargas(); }
    catch (e) { toast(e.message); boton.disabled = false; }
  }
  async function deshacer(id) {
    if (!await solicitarDialogo({ titulo: 'Deshacer carga #' + id, mensaje: 'Se eliminan los clientes de esta carga que todavía no tienen cotizaciones, órdenes ni cobros. Los que ya se usaron se quedan. Queda en la bitácora. No se puede deshacer.', aceptar: 'Deshacer carga' })) return;
    try { const r = await pedir('/clientes-carga/' + id + '/eliminar', { method: 'POST', body: '{}' }); toast(`${r.eliminados} cliente(s) eliminado(s)${r.quedan.length ? ` · ${r.quedan.length} se quedan porque ya tienen registros` : ''}`); pintarCargas(); }
    catch (e) { toast(e.message); }
  }

  function preparar() {
    listo = true;
    const panel = $('panel-clientes-carga');
    panel.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'cc-plantilla') plantilla();
      else if (b.id === 'cc-guardar') guardar(b);
      else if (b.dataset.ccVer) { abierta = abierta === Number(b.dataset.ccVer) ? null : Number(b.dataset.ccVer); pintarCargas(); }
      else if (b.dataset.ccDeshacer) deshacer(Number(b.dataset.ccDeshacer));
      else if (b.dataset.ccEliminar) eliminar(b);
    });
    panel.addEventListener('change', e => { if (e.target.id === 'cc-archivo' && e.target.files[0]) { leerArchivo(e.target.files[0]); e.target.value = ''; } });
    let espera; $('cc-buscar').addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(buscar, 300); });
  }
  function cargar() {
    if (!Permisos.datos?.direccion || !$('panel-clientes-carga')) return;
    if (!listo) preparar();
    pintarCarga(); pintarCargas();
  }
  return { cargar };
})();
window.ClientesCarga = ClientesCarga;
