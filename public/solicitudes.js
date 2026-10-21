/* Solicitudes de compra: el paso antes de la orden de compra.
   Cualquiera pide (qué y para qué) → el encargado de centro de costos o administración aprueba → se suben
   3 cotizaciones de proveedores distintos → se elige una → «Crear orden de compra» la deja llena.
   Urgente: se puede seguir con menos de 3 escribiendo por qué no puede esperar (queda marcado).
   Servidor: server/solicitudes.js */
const Solicitudes = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t);
  const dinero = n => formatoMoneda(n);
  const fechaTxt = f => (f ? String(f).slice(0, 10).split('-').reverse().join('/') : '—');
  const esCostos = () => Permisos.puede('compras.gestionar');
  const ESTADOS = { por_aprobar: ['Por aprobar', 'parcial'], cotizando: ['Cotizando', 'programada'], elegida: ['Cotización elegida', 'programada'], con_orden: ['Con orden de compra', 'pagada'], recibida: ['Recibida ✓', 'pagada'], rechazada: ['Rechazada', 'vencida'], cancelada: ['Cancelada', 'vencida'] };
  const PASOS = [['por_aprobar', 'Pedida'], ['cotizando', 'Aprobada'], ['elegida', 'Cotización elegida'], ['con_orden', 'Orden de compra'], ['recibida', 'Recibida']];
  let LISTA = [], ACTUAL = null, CENTROS = [], PROVEEDORES = [], EDITANDO = false, consulta = 0;
  const json = async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'No se pudo completar'), { datos: j }); return j; };
  const pedir = (ruta, metodo = 'GET', cuerpo) => api(ruta, metodo === 'GET' ? undefined : { method: metodo, body: JSON.stringify(cuerpo || {}) }).then(json);
  async function catalogos() { [CENTROS, PROVEEDORES] = await Promise.all([pedir('/compras/centros'), pedir('/finanzas/proveedores')]); }

  // ---------- Lista ----------
  async function cargar() {
    const turno = ++consulta, cont = $('sol-lista');
    cont.innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    try {
      const q = new URLSearchParams({ estado: $('sol-filtro').value, q: $('sol-buscar').value.trim() });
      const lista = await pedir('/compras/solicitudes?' + q);
      if (turno !== consulta) return;
      LISTA = lista;
    } catch (err) { cont.innerHTML = '<div class="aviso-error-carga" role="alert"><p>No se pudo cargar: ' + esc(err.message) + '</p></div>'; return; }
    const porAprobar = LISTA.filter(s => s.estado === 'por_aprobar').length;
    const aviso = esCostos() && porAprobar ? '<p class="cuentas-aviso">' + porAprobar + (porAprobar === 1 ? ' solicitud espera' : ' solicitudes esperan') + ' tu aprobación.</p>' : '';
    if (!LISTA.length) { cont.innerHTML = aviso + '<p class="util-45">No hay solicitudes con este filtro. Usa «+ Nueva solicitud» para pedir lo que se necesita comprar.</p>'; return; }
    cont.innerHTML = aviso + '<div class="tabla-scroll"><table class="tabla-resumen sol-tabla"><thead><tr><th>Estado</th><th>Folio</th><th>Fecha</th><th>Qué se necesita</th><th>Área</th><th>Pidió</th><th>Cotizaciones</th><th>Orden de compra</th><th></th></tr></thead><tbody>'
      + LISTA.map(s => {
        const [txt, cl] = ESTADOS[s.estado];
        const cot = ['por_aprobar', 'rechazada', 'cancelada'].includes(s.estado) && !s.cotizaciones_count ? '—'
          : '<span class="sol-cot ' + (s.cotizaciones_faltan ? 'falta' : 'listo') + '">' + s.cotizaciones_count + ' de ' + s.requeridas + '</span>' + (s.excepcion_motivo ? ' <span class="sol-urgente" title="Se siguió sin las 3 cotizaciones por urgencia">excepción</span>' : '');
        return '<tr class="' + (['rechazada', 'cancelada'].includes(s.estado) ? 'fila-cancelada' : '') + '"><td><span class="estado-cxc ' + cl + '">' + esc(txt) + '</span></td><td><b>' + esc(s.folio) + '</b></td><td>' + esc(fechaTxt(s.created_at)) + '</td>'
          + '<td>' + (s.urgente ? '<span class="sol-urgente">URGENTE</span> ' : '') + esc(s.que) + '</td><td>' + esc(s.centro_nombre) + '</td><td>' + esc(s.solicitante_nombre) + '</td><td>' + cot + '</td><td>' + esc(s.oc_folio || '—') + '</td>'
          + '<td class="celda-acciones"><button type="button" class="btn btn-outline btn-chico" data-sol-abrir="' + Number(s.id) + '">Abrir</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // ---------- Ventana ----------
  const campo = (id, etiqueta, control, extra = '') => '<div class="campo' + extra + '"><label for="' + id + '">' + etiqueta + '</label>' + control + '</div>';
  function formulario(s) {
    const centros = CENTROS.filter(c => c.activo || c.id === s?.centro_id);
    return '<form id="sol-form" class="sol-form" autocomplete="off">'
      + campo('sol-que', '¿Qué necesitas? (obligatorio)', '<input id="sol-que" maxlength="500" placeholder="Ej. 4 llantas 11R22.5" value="' + esc(s?.que || '') + '">', ' full')
      + campo('sol-para', '¿Para qué? (obligatorio)', '<textarea id="sol-para" rows="2" maxlength="500" placeholder="Ej. Al camión C-22 se le reventó una y las demás están lisas">' + esc(s?.para_que || '') + '</textarea>', ' full')
      + '<div class="form-grid-2">'
      + campo('sol-centro', 'Área (centro de costos, obligatorio)', '<select id="sol-centro"><option value="">Selecciona…</option>' + centros.map(c => '<option value="' + Number(c.id) + '"' + (c.id === s?.centro_id ? ' selected' : '') + '>' + esc(c.nombre) + '</option>').join('') + '</select>')
      + campo('sol-fecha', '¿Para cuándo? (opcional)', '<input type="date" id="sol-fecha" value="' + esc(s?.fecha_requerida || '') + '">')
      + campo('sol-equipo', 'Unidad o equipo (opcional)', '<input id="sol-equipo" maxlength="80" placeholder="Ej. C-22" value="' + esc(s?.equipo || '') + '">')
      + campo('sol-lead', 'Orden de servicio (opcional)', '<input id="sol-lead" inputmode="numeric" placeholder="Número, ej. 125" value="' + esc(s?.lead_id ? String(s.lead_id) : '') + '">')
      + '</div>'
      + '<label class="check-linea sol-check-urgente"><input type="checkbox" id="sol-urgente"' + (s?.urgente ? ' checked' : '') + '> <span><b>Es urgente</b> (no puede esperar)</span></label>'
      + (s ? '' : campo('sol-foto', 'Foto (opcional)', '<input type="file" id="sol-foto" accept="image/*,application/pdf">', ' full'))
      + '<div class="barra-acciones"><button type="submit" class="btn btn-primario" id="sol-enviar">' + (s ? 'Guardar cambios' : 'Enviar solicitud') + '</button>' + (s ? '<button type="button" class="btn btn-outline" id="sol-no-editar">Cancelar</button>' : '') + '</div>'
      + '</form>';
  }
  function pasos(s) {
    if (['rechazada', 'cancelada'].includes(s.estado)) return '<p class="cuentas-aviso sol-cerrada">✖ ' + esc(ESTADOS[s.estado][0]) + ' por ' + esc(s.cerrada_por || '') + ' el ' + esc(fechaTxt(s.cerrada_at)) + '. Motivo: ' + esc(s.motivo_cierre || '—') + '</p>';
    const i = s.estado === 'recibida' ? PASOS.length : PASOS.findIndex(([k]) => k === s.estado); // recibida: todo hecho
    return '<ol class="sol-pasos">' + PASOS.map(([k, t], j) => '<li class="' + (j < i ? 'hecho' : j === i ? 'actual' : '') + '">' + esc(k === 'cotizando' && s.estado === 'cotizando' ? 'Cotizando (' + s.cotizaciones_count + ' de ' + s.requeridas + ')' : t) + '</li>').join('') + '</ol>';
  }
  function detalle(s) {
    const dato = (t, v) => v ? '<div><span class="etiqueta-mini">' + esc(t) + '</span><b>' + v + '</b></div>' : '';
    return '<div class="sol-detalle">'
      + '<div class="sol-que">' + (s.urgente ? '<span class="sol-urgente">URGENTE</span> ' : '') + esc(s.que) + '</div>'
      + '<p class="sol-para">' + esc(s.para_que) + '</p>'
      + '<div class="sol-datos">' + dato('Área', esc(s.centro_nombre)) + dato('Pidió', esc(s.solicitante_nombre) + ' · ' + esc(fechaTxt(s.created_at))) + dato('Para cuándo', s.fecha_requerida ? esc(fechaTxt(s.fecha_requerida)) : '')
      + dato('Unidad o equipo', esc(s.equipo || '')) + dato('Orden de servicio', s.lead_id ? '#' + Number(s.lead_id) : '') + dato('Aprobó', s.aprobada_por ? esc(s.aprobada_por) + ' · ' + esc(fechaTxt(s.aprobada_at)) : '') + '</div>'
      + (s.fotos.length ? '<div class="sol-fotos">' + s.fotos.map(f => '<button type="button" class="btn btn-outline btn-chico" data-sol-bajar="' + Number(f.id) + '">📷 ' + esc(f.nombre) + '</button>').join('') + '</div>' : '')
      + '</div>';
  }
  function cotizaciones(s) {
    if (['por_aprobar'].includes(s.estado) || (['rechazada', 'cancelada'].includes(s.estado) && !s.cotizaciones.length)) return '';
    const propia = s.solicitante_id === USUARIO_ACTUAL?.id;
    const completar = s.excepcion_motivo && ['elegida', 'con_orden', 'recibida'].includes(s.estado) && s.cotizaciones_faltan > 0;
    const puedeSubir = (propia || esCostos()) && (s.estado === 'cotizando' || completar);
    const puedeElegir = esCostos() && ['cotizando', 'elegida'].includes(s.estado);
    const filas = s.cotizaciones.map(c => {
      const elegida = c.id === s.ganadora_id;
      return '<tr class="' + (elegida ? 'sol-ganadora' : '') + '"><td><b>' + esc(c.proveedor_nombre || '') + '</b>' + (c.id === s.mas_barata_id && s.cotizaciones.length > 1 ? ' <span class="sol-barata">más barata</span>' : '') + (elegida ? ' <span class="sol-elegida">✔ elegida</span>' : '') + '</td>'
        + '<td class="st-num"><b>' + dinero(c.monto) + '</b></td><td>' + esc(c.entrega || '—') + '</td><td><small>' + esc(c.subido_por_nombre || '') + '</small></td>'
        + '<td class="celda-acciones"><div class="acciones-fila"><button type="button" class="btn btn-outline btn-chico" data-sol-bajar="' + Number(c.id) + '">Ver archivo</button>'
        + (puedeElegir && !elegida ? '<button type="button" class="btn btn-verde btn-chico" data-sol-elegir="' + Number(c.id) + '">Elegir</button>' : '')
        + (!elegida && (esCostos() || (c.subido_por === USUARIO_ACTUAL?.id && ['cotizando'].includes(s.estado))) ? '<button type="button" class="btn btn-outline btn-chico" data-sol-quitar="' + Number(c.id) + '">Quitar</button>' : '')
        + '</div></td></tr>';
    }).join('');
    const progreso = '<p class="sol-progreso ' + (s.cotizaciones_faltan ? 'falta' : 'listo') + '">' + (s.cotizaciones_faltan
      ? '📋 Van <b>' + s.cotizaciones_count + ' de ' + s.requeridas + '</b> cotizaciones (de proveedores distintos). Faltan ' + s.cotizaciones_faltan + '.'
      : '✔ Ya están las ' + s.requeridas + ' cotizaciones.' + (puedeElegir && s.estado === 'cotizando' ? ' Elige la ganadora.' : '')) + '</p>';
    const excepcion = s.excepcion_motivo ? '<p class="cuentas-aviso sol-excepcion">⚠ <b>Excepción por urgencia:</b> se eligió con ' + s.cotizaciones_count + ' de ' + s.requeridas + ' cotizaciones. Motivo: ' + esc(s.excepcion_motivo)
      + (s.cotizaciones_faltan ? ' · Se pueden agregar las que faltan para completar el expediente.' : '') + '</p>' : '';
    const alta = puedeSubir ? '<form class="sol-alta" id="sol-alta" autocomplete="off"><div class="seccion-sub">Agregar cotización</div><div class="sol-alta-campos">'
      + '<label class="cat-campo"><span>Proveedor</span><select id="sol-c-prov"><option value="">Selecciona…</option>' + PROVEEDORES.filter(p => p.activo).map(p => '<option value="' + Number(p.id) + '">' + esc(p.nombre) + '</option>').join('') + '<option value="__nuevo">+ Nuevo proveedor…</option></select></label>'
      + '<label class="cat-campo"><span>Total cotizado</span><input id="sol-c-monto" inputmode="decimal" placeholder="Ej. 15800"></label>'
      + '<label class="cat-campo"><span>Entrega (opcional)</span><input id="sol-c-entrega" maxlength="80" placeholder="Ej. 2 días"></label>'
      + '<label class="cat-campo"><span>Archivo (PDF o foto)</span><input type="file" id="sol-c-archivo" accept="application/pdf,image/*"></label>'
      + '</div><button type="submit" class="btn btn-secundario">+ Agregar cotización</button></form>' : '';
    return '<div class="sol-bloque"><div class="seccion-tit">Cotizaciones</div>' + progreso + excepcion
      + (filas ? '<div class="tabla-scroll"><table class="tabla-resumen tabla-dinero"><thead><tr><th>Proveedor</th><th class="st-num">Total</th><th>Entrega</th><th>Subió</th><th></th></tr></thead><tbody>' + filas + '</tbody></table></div>' : '<p class="util-45">Todavía no hay cotizaciones.</p>')
      + alta + '</div>';
  }
  function acciones(s) {
    const propia = s.solicitante_id === USUARIO_ACTUAL?.id, b = (id, txt, cl) => '<button type="button" class="btn ' + cl + '" id="' + id + '">' + txt + '</button>';
    let h = '';
    const meAprueba = esCostos() && (!propia || Permisos.puede('compras.aprobar_propias'));
    if (s.estado === 'por_aprobar' && meAprueba) h += b('sol-aprobar', '✔ Aprobar para cotizar', 'btn-verde') + b('sol-rechazar', 'Rechazar', 'btn-eliminar');
    if (s.estado === 'por_aprobar' && !meAprueba) h += '<span class="ayuda">' + (propia && esCostos() ? 'Tú la pediste: la aprueba un administrador u otro encargado de centro de costos.' : 'La aprueba el encargado de centro de costos o administración.') + '</span>';
    if (s.estado === 'elegida' && esCostos()) h += b('sol-crear-oc', '🛒 Crear orden de compra', 'btn-primario');
    if (s.estado === 'elegida' && !esCostos()) h += '<span class="ayuda">El encargado de centro de costos hará la orden de compra.</span>';
    if (s.oc_id) h += b('sol-ver-oc', 'Abrir ' + esc(s.oc_folio), 'btn-outline');
    if ((propia && s.estado === 'por_aprobar') || (esCostos() && ['por_aprobar', 'cotizando'].includes(s.estado))) h += b('sol-editar', 'Corregir', 'btn-outline');
    if ((propia || esCostos()) && ['por_aprobar', 'cotizando', 'elegida'].includes(s.estado)) h += b('sol-cancelar', 'Cancelar solicitud', 'btn-eliminar');
    return h ? '<div class="barra-acciones sol-acciones">' + h + '</div>' : '';
  }
  async function abrir(id) {
    try { await catalogos(); ACTUAL = id ? await pedir('/compras/solicitudes/' + Number(id)) : null; } catch (err) { toast(err.message); return; }
    EDITANDO = false; pintar();
    abrirVentana('overlay-solicitud');
    if (!ACTUAL) $('sol-que')?.focus();
  }
  function pintar() {
    const s = ACTUAL;
    $('sol-kicker').textContent = s ? 'SOLICITUD DE COMPRA · ' + ESTADOS[s.estado][0].toUpperCase() : 'SOLICITUD DE COMPRA';
    $('sol-titulo').textContent = s ? s.folio : 'Nueva solicitud de compra';
    if (!s) { $('sol-cuerpo').innerHTML = '<p class="ayuda">Di qué necesitas y para qué. No hace falta proveedor ni precio: eso lo ve el encargado de centro de costos. Se piden 3 cotizaciones antes de comprar.</p>' + formulario(null); return; }
    if (EDITANDO) { $('sol-cuerpo').innerHTML = formulario(s); return; }
    $('sol-cuerpo').innerHTML = pasos(s) + detalle(s) + acciones(s) + cotizaciones(s)
      + '<details class="sol-bloque sol-historial"><summary class="seccion-tit">Historial</summary>' + (s.historial.length ? Bitacora.tabla(s.historial, false) : '<p class="util-45">Sin movimientos.</p>') + '</details>';
  }

  // ---------- Acciones ----------
  async function subir(ruta, archivo, encabezados) {
    if (archivo.size > 10 * 1024 * 1024) throw new Error('El archivo pasa de 10 MB');
    const h = { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + USUARIO_ACTUAL.token, ...encabezadoSucursal(), 'X-Nombre': encodeURIComponent(archivo.name) };
    for (const [k, v] of Object.entries(encabezados)) h[k] = encodeURIComponent(v);
    return json(await api(ruta, { method: 'POST', body: archivo, headers: h }));
  }
  async function enviar() {
    const d = { que: $('sol-que').value.trim(), para_que: $('sol-para').value.trim(), centro_id: Number($('sol-centro').value) || null, fecha_requerida: $('sol-fecha').value || null,
      equipo: $('sol-equipo').value.trim(), lead_id: Number($('sol-lead').value) || null, urgente: $('sol-urgente').checked, version: ACTUAL?.version };
    if (!d.que) { toast('Escribe qué necesitas'); $('sol-que').focus(); return; }
    if (!d.para_que) { toast('Escribe para qué lo necesitas'); $('sol-para').focus(); return; }
    if (!d.centro_id) { toast('Elige el área (centro de costos)'); $('sol-centro').focus(); return; }
    if (ACTUAL) { ACTUAL = await pedir('/compras/solicitudes/' + ACTUAL.id, 'PUT', d); EDITANDO = false; toast('Solicitud corregida'); pintar(); cargar(); return; }
    const foto = $('sol-foto').files[0];
    let s;
    try { s = await pedir('/compras/solicitudes', 'POST', d); }
    catch (err) {
      if (err.datos?.codigo !== 'POSIBLE_DUPLICADO') throw err;
      if (!await solicitarDialogo({ titulo: '¿Es otra necesidad?', mensaje: err.message, aceptar: 'Sí, es otra' })) return;
      s = await pedir('/compras/solicitudes', 'POST', { ...d, forzar: true });
    }
    if (foto) { try { await subir('/compras/solicitudes/' + s.id + '/documentos', foto, { 'X-Tipo': 'foto' }); } catch (err) { toast('La solicitud se envió, pero la foto no: ' + err.message); } }
    toast('Solicitud ' + s.folio + ' enviada');
    await abrir(s.id); cargar();
  }
  async function agregarCotizacion() {
    const prov = $('sol-c-prov').value, monto = $('sol-c-monto').value.replace(/[$,\s]/g, ''), archivo = $('sol-c-archivo').files[0];
    if (!prov || prov === '__nuevo') { toast('Elige el proveedor'); $('sol-c-prov').focus(); return; }
    if (!(Number(monto) > 0)) { toast('Escribe el total de la cotización'); $('sol-c-monto').focus(); return; }
    if (!archivo) { toast('Adjunta el archivo de la cotización (PDF o foto)'); return; }
    const r = await subir('/compras/solicitudes/' + ACTUAL.id + '/documentos', archivo, { 'X-Tipo': 'cotizacion', 'X-Proveedor': prov, 'X-Monto': monto, 'X-Entrega': $('sol-c-entrega').value.trim() });
    ACTUAL = await pedir('/compras/solicitudes/' + ACTUAL.id);
    toast('Cotización agregada: van ' + r.solicitud.cotizaciones_count + ' de ' + r.solicitud.requeridas);
    pintar(); cargar();
  }
  async function elegir(id) {
    const c = ACTUAL.cotizaciones.find(x => x.id === id);
    const barata = ACTUAL.cotizaciones.find(x => x.id === ACTUAL.mas_barata_id);
    let motivo_urgencia;
    if (ACTUAL.cotizaciones_faltan) {
      motivo_urgencia = await solicitarDialogo({ titulo: 'Faltan cotizaciones', mensaje: 'Van ' + ACTUAL.cotizaciones_count + ' de ' + ACTUAL.requeridas + '. Solo si es urgente y no puede esperar se sigue sin las ' + ACTUAL.requeridas + ': queda marcado como excepción por urgencia (lo ve administración al autorizar la orden). ¿Por qué no puede esperar?', aceptar: 'Elegir ' + c.proveedor_nombre + ' por urgencia', campo: { tipo: 'text', etiqueta: 'Motivo de la urgencia' } });
      if (!motivo_urgencia) return;
    }
    let motivo_eleccion;
    if (barata && barata.monto < c.monto) {
      motivo_eleccion = await solicitarDialogo({ titulo: 'No es la más barata', mensaje: c.proveedor_nombre + ' cotizó ' + dinero(c.monto) + ' y ' + barata.proveedor_nombre + ' ' + dinero(barata.monto) + '. ¿Por qué se elige esta? (entrega, calidad, garantía…). Queda registrado.', aceptar: 'Elegir ' + c.proveedor_nombre, campo: { tipo: 'text', etiqueta: 'Motivo', requerido: 'Escribe el motivo (mínimo 10 letras)' } });
      if (!motivo_eleccion) return;
    } else if (!motivo_urgencia && !await solicitarDialogo({ titulo: 'Elegir cotización', mensaje: c.proveedor_nombre + ' por ' + dinero(c.monto) + '.', aceptar: 'Elegir' })) return;
    ACTUAL = await pedir('/compras/solicitudes/' + ACTUAL.id + '/elegir', 'POST', { cotizacion_id: id, motivo_urgencia, motivo_eleccion });
    toast('Cotización elegida: ' + c.proveedor_nombre); pintar(); cargar();
  }
  async function bajar(id) {
    const r = await api('/compras/solicitudes/documentos/' + Number(id), { headers: { Authorization: 'Bearer ' + USUARIO_ACTUAL.token } });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'No se pudo descargar'); }
    const d = [...(ACTUAL.cotizaciones || []), ...(ACTUAL.fotos || [])].find(x => x.id === Number(id));
    saveAs(await r.blob(), d?.nombre || 'documento');
  }
  async function quitar(id) {
    const motivo = await solicitarDialogo({ titulo: 'Quitar cotización', mensaje: 'Deja de contar (queda registrado quién la quitó y por qué).', aceptar: 'Quitar', campo: { tipo: 'text', etiqueta: 'Motivo' } });
    if (!motivo) return;
    ACTUAL = (await pedir('/compras/solicitudes/documentos/' + Number(id) + '/quitar', 'POST', { motivo })).solicitud;
    toast('Cotización quitada'); pintar(); cargar();
  }
  async function cerrar(tipo) {
    const motivo = await solicitarDialogo({ titulo: tipo === 'rechazar' ? 'Rechazar solicitud' : 'Cancelar solicitud', mensaje: tipo === 'rechazar' ? 'Quien la pidió verá el motivo.' : 'La solicitud queda cancelada (se conserva en la lista).', aceptar: tipo === 'rechazar' ? 'Rechazar' : 'Cancelar solicitud', campo: { tipo: 'text', etiqueta: 'Motivo' } });
    if (!motivo) return;
    ACTUAL = await pedir('/compras/solicitudes/' + ACTUAL.id + '/' + tipo, 'POST', { motivo }); pintar(); cargar();
  }
  async function nuevoProveedor(sel) {
    sel.value = '';
    const nombre = await solicitarDialogo({ titulo: 'Nuevo proveedor', mensaje: 'Nombre o razón social del proveedor.', aceptar: 'Agregar', campo: { tipo: 'text', etiqueta: 'Proveedor' } });
    if (!nombre) return;
    const p = await Finanzas.guardarProveedor({ nombre, categoria: 'otro' }); if (!p) return;
    PROVEEDORES = await pedir('/finanzas/proveedores');
    sel.innerHTML = '<option value="">Selecciona…</option>' + PROVEEDORES.filter(x => x.activo).map(x => '<option value="' + Number(x.id) + '">' + esc(x.nombre) + '</option>').join('') + '<option value="__nuevo">+ Nuevo proveedor…</option>';
    sel.value = String(p.id); toast('Proveedor agregado');
  }

  // ---------- Eventos ----------
  const conBoton = async (b, fn) => { if (!b || b.disabled) return; b.disabled = true; try { await fn(); } catch (err) { toast(err.message); } finally { b.disabled = false; } };
  let tBuscar;
  $('sol-buscar').addEventListener('input', () => { clearTimeout(tBuscar); tBuscar = setTimeout(cargar, 300); });
  $('sol-filtro').addEventListener('change', cargar);
  $('sol-nueva').addEventListener('click', () => abrir(null));
  $('sol-lista').addEventListener('click', e => { const b = e.target.closest('[data-sol-abrir]'); if (b) abrir(Number(b.dataset.solAbrir)); });
  $('sol-cuerpo').addEventListener('submit', e => {
    e.preventDefault();
    const b = e.target.querySelector('button[type=submit]');
    if (e.target.id === 'sol-form') conBoton(b, enviar);
    if (e.target.id === 'sol-alta') conBoton(b, agregarCotizacion);
  });
  $('sol-cuerpo').addEventListener('change', e => { if (e.target.id === 'sol-c-prov' && e.target.value === '__nuevo') nuevoProveedor(e.target).catch(err => toast(err.message)); });
  $('sol-cuerpo').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.type === 'submit') return;
    if (b.dataset.solBajar) conBoton(b, () => bajar(b.dataset.solBajar));
    if (b.dataset.solElegir) conBoton(b, () => elegir(Number(b.dataset.solElegir)));
    if (b.dataset.solQuitar) conBoton(b, () => quitar(Number(b.dataset.solQuitar)));
    if (b.id === 'sol-aprobar') conBoton(b, async () => { ACTUAL = await pedir('/compras/solicitudes/' + ACTUAL.id + '/aprobar', 'POST'); toast('Aprobada: ya se puede cotizar'); pintar(); cargar(); });
    if (b.id === 'sol-rechazar') conBoton(b, () => cerrar('rechazar'));
    if (b.id === 'sol-cancelar') conBoton(b, () => cerrar('cancelar'));
    if (b.id === 'sol-editar') { EDITANDO = true; pintar(); }
    if (b.id === 'sol-no-editar') { EDITANDO = false; pintar(); }
    if (b.id === 'sol-crear-oc') { $('overlay-solicitud').classList.remove('mostrar'); Compras.desdeSolicitud(ACTUAL); }
    if (b.id === 'sol-ver-oc') { $('overlay-solicitud').classList.remove('mostrar'); Compras.abrir(ACTUAL.oc_id); }
  });
  return { cargar, abrir };
})();
window.Solicitudes = Solicitudes;
