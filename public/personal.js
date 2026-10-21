// PERSONAL (Ajustes → Personal): lista y ficha de cada persona —datos generales, licencia, pagos y expediente,
// vacaciones e incidencias, órdenes donde participó— y el equipo de cada orden de servicio (EquipoOrden).
// Lo sensible (CLABE, RFC, CURP, NSS, salario, contrato, documentos) solo aparece con el permiso «Datos sensibles
// del personal»; el servidor tampoco lo manda sin él.
const Personal = (() => {
  const $ = id => document.getElementById(id);
  const esc = t => escaparHtml(t == null ? '' : String(t));
  let CAT = null, filas = [], actual = null, base = '', ocupado = false, consulta = 0;
  const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  const fecha = f => (f ? new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
  const antiguedad = f => { if (!f) return '—'; const d = Math.floor((Date.parse(hoy()) - Date.parse(f)) / 86400000); const a = Math.floor(d / 365.25), m = Math.floor((d % 365.25) / 30.44); return a ? `${a} año${a === 1 ? '' : 's'}${m ? ' ' + m + ' m' : ''}` : `${m} mes${m === 1 ? '' : 'es'}`; };
  async function pedir(ruta, opciones) {
    const r = await api('/personal' + ruta, opciones);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'No se pudo completar'); e.status = r.status; e.datos = j; throw e; }
    return j;
  }
  async function catalogos() {
    if (!CAT) CAT = await pedir('/catalogos');
    const f = $('pe-f-puesto'), v = f.value;
    f.innerHTML = '<option value="">Todos los puestos</option>' + CAT.puestos.map(p => `<option>${esc(p)}</option>`).join('');
    f.value = v;
  }

  async function cargar() {
    const turno = ++consulta;
    try {
      await catalogos();
      const q = new URLSearchParams({ q: $('pe-buscar').value, puesto: $('pe-f-puesto').value, estado: $('pe-f-estado').value, alertas: $('pe-f-alertas').checked ? '1' : '' });
      const lista = await pedir('?' + q);
      if (turno !== consulta) return;
      filas = lista; pintar();
    } catch (e) { $('pe-tabla').innerHTML = `<tr><td colspan="8"><p class="aviso-error-carga" role="alert">${esc(e.message)}</p></td></tr>`; }
  }
  function pintar() {
    const avisos = filas.filter(p => p.alertas.length).length;
    $('pe-resumen').textContent = `${filas.length} persona${filas.length === 1 ? '' : 's'}` + (avisos ? ` · ${avisos} con avisos (licencias o contratos por vencer)` : '');
    $('pe-tabla').innerHTML = filas.length ? filas.map(p => `<tr class="${p.activo ? '' : 'pe-baja'}">
        <td><button type="button" class="pe-nombre" data-persona="${Number(p.id)}">${esc(p.nombre)}</button>${p.usuario_nombre ? '<small class="pe-cuenta">Cuenta: ' + esc(p.usuario_nombre) + '</small>' : ''}${p.activo ? '' : '<small class="pe-cuenta">Baja ' + esc(fecha(p.fecha_baja)) + '</small>'}</td>
        <td>${esc(p.puesto)}</td><td>${esc(p.telefono || '—')}</td><td>${esc(antiguedad(p.fecha_ingreso))}</td>
        <td>${p.vacaciones ? (p.vacaciones.anios ? `${p.vacaciones.disponibles} de ${p.vacaciones.corresponden}` : 'Aún no cumple 1 año') : '—'}</td>
        <td>${p.licencia_vence ? esc((p.licencia_tipo || '') + ' · vence ' + fecha(p.licencia_vence)) : '—'}</td>
        <td>${Number(p.ordenes_mes) || 0}</td>
        <td>${p.alertas.map(a => `<span class="chip alert-chip">${esc(a)}</span>`).join(' ') || ''}</td></tr>`).join('')
      : '<tr><td colspan="8"><p class="ayuda">No hay personas con esos filtros. ' + (Permisos.puede('personal.editar') ? 'Da de alta a la primera con «+ Nueva persona».' : '') + '</p></td></tr>';
  }

  // ---------- Ficha ----------
  const campo = (id, etiqueta, html, clase = '') => `<div class="campo-modal ${clase}"><label for="pe-${id}">${etiqueta}</label>${html}</div>`;
  const input = (id, valor, extra = '') => `<input id="pe-${id}" value="${esc(valor ?? '')}" ${extra}>`;
  const opciones = (lista, valor, vacio) => (vacio !== undefined ? `<option value="">${esc(vacio)}</option>` : '') + lista.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(valor ?? '') ? ' selected' : ''}>${esc(t)}</option>`; }).join('');
  function datosFormulario() {
    const v = id => $('pe-' + id)?.value ?? undefined;
    const d = { nombre: v('nombre'), puesto: v('puesto'), telefono: v('telefono'), correo: v('correo'), direccion: v('direccion'), fecha_ingreso: v('fecha_ingreso') || null,
      contacto_emergencia: v('contacto_emergencia'), tel_emergencia: v('tel_emergencia'), licencia_tipo: v('licencia_tipo') || null, licencia_numero: v('licencia_numero'), licencia_vence: v('licencia_vence') || null,
      notas: v('notas'), usuario_id: v('usuario_id') || null };
    if ($('pe-sucursal_id')) d.sucursal_id = Number(v('sucursal_id')) || null;
    if (actual?.puede?.sensibles ?? Permisos.puede('personal.sensibles')) Object.assign(d, { banco: v('banco'), clabe: (v('clabe') || '').replace(/\s+/g, ''), rfc: v('rfc'), curp: v('curp'), nss: v('nss'),
      salario: v('salario') === '' ? null : Number(v('salario')), salario_periodo: v('salario_periodo') || null, tipo_contrato: v('tipo_contrato') || null, contrato_vence: v('contrato_vence') || null });
    return d;
  }
  const pendiente = () => !!$('pe-nombre') && base !== JSON.stringify(datosFormulario());
  async function abrir(id) {
    try {
      if ($('overlay-personal').classList.contains('mostrar') && !await permitirSalida()) return;
      await catalogos();
      if (id) actual = await pedir('/' + Number(id));
      else { actual = null; actual = { nuevo: true, activo: 1, puede: { editar: true, sensibles: Permisos.puede('personal.sensibles') }, usuarios_sin_ficha: await pedir('/usuarios/sin-ficha').catch(() => []) }; }
      pintarFicha();
      abrirVentana('overlay-personal');
    } catch (e) { toast(e.message); }
  }
  function pintarFicha() {
    const p = actual, edita = !!p.puede?.editar, sens = !!p.puede?.sensibles, nuevo = !!p.nuevo, ro = edita ? '' : ' disabled';
    $('pe-titulo').textContent = nuevo ? 'Nueva persona' : p.nombre + (p.activo ? '' : ' (dada de baja)');
    const usuarios = [...(p.usuario_id ? [{ id: p.usuario_id, nombre: p.usuario_nombre }] : []), ...(p.usuarios_sin_ficha || [])].map(u => [u.id, u.nombre]);
    const sucursales = window.Sucursales?.varias?.() ? (Sucursales.datos.sucursales || []).filter(s => s.activo).map(s => [s.id, s.clave + ' · ' + s.nombre]) : null;
    let h = `<div class="modal-section"><h3 class="pe-sub">Datos generales</h3><div class="form-grid-2">
      ${campo('nombre', 'Nombre completo *', input('nombre', p.nombre, 'maxlength="120" autocomplete="off"' + ro))}
      ${campo('puesto', 'Puesto *', `<select id="pe-puesto"${ro}>${opciones(CAT.puestos, p.puesto, 'Elige el puesto')}</select>`)}
      ${campo('telefono', 'Teléfono', input('telefono', p.telefono, 'maxlength="25" inputmode="tel"' + ro))}
      ${campo('correo', 'Correo', input('correo', p.correo, 'type="email" maxlength="120"' + ro))}
      ${campo('fecha_ingreso', 'Fecha de ingreso', input('fecha_ingreso', p.fecha_ingreso, 'type="date" max="' + hoy() + '"' + ro))}
      ${sucursales ? campo('sucursal_id', 'Sucursal', `<select id="pe-sucursal_id"${ro}>${opciones(sucursales, p.sucursal_id, nuevo ? 'La que estás viendo' : undefined)}</select>`) : ''}
      ${campo('direccion', 'Dirección', input('direccion', p.direccion, 'maxlength="200"' + ro), 'full')}
      ${campo('contacto_emergencia', 'Contacto de emergencia', input('contacto_emergencia', p.contacto_emergencia, 'maxlength="120" placeholder="Nombre y parentesco"' + ro))}
      ${campo('tel_emergencia', 'Teléfono de emergencia', input('tel_emergencia', p.tel_emergencia, 'maxlength="25" inputmode="tel"' + ro))}
      ${campo('usuario_id', 'Cuenta en el sistema', `<select id="pe-usuario_id"${ro}>${opciones(usuarios, p.usuario_id, 'Sin cuenta (no entra al sistema)')}</select><small class="ayuda">Si es técnico responsable de una orden, con su cuenta la ve y la marca realizada.</small>`)}
      ${campo('notas', 'Notas', `<textarea id="pe-notas" rows="2" maxlength="2000"${ro}>${esc(p.notas || '')}</textarea>`, 'full')}
      </div></div>
      <div class="modal-section"><h3 class="pe-sub">Licencia de manejo</h3><div class="form-grid-2">
      ${campo('licencia_tipo', 'Tipo', `<select id="pe-licencia_tipo"${ro}>${opciones(CAT.licencias, p.licencia_tipo, 'No aplica')}</select>`)}
      ${campo('licencia_numero', 'Número', input('licencia_numero', p.licencia_numero, 'maxlength="40"' + ro))}
      ${campo('licencia_vence', 'Vence', input('licencia_vence', p.licencia_vence, 'type="date"' + ro))}
      </div></div>`;
    if (sens) {
      h += `<div class="modal-section"><h3 class="pe-sub">Pagos y expediente <span class="pe-candado">🔒 datos sensibles</span></h3><div class="form-grid-2">
        ${campo('banco', 'Banco', input('banco', p.banco, 'maxlength="60" autocomplete="off"' + ro))}
        ${campo('clabe', 'CLABE (18 dígitos)', input('clabe', p.clabe, 'maxlength="22" inputmode="numeric" autocomplete="off"' + ro))}
        ${campo('rfc', 'RFC', input('rfc', p.rfc, 'maxlength="13" autocapitalize="characters" autocomplete="off"' + ro))}
        ${campo('curp', 'CURP', input('curp', p.curp, 'maxlength="18" autocapitalize="characters" autocomplete="off"' + ro))}
        ${campo('nss', 'Número de seguro social', input('nss', p.nss, 'maxlength="11" inputmode="numeric" autocomplete="off"' + ro))}
        ${campo('salario', 'Salario', `<div class="pe-salario"><input id="pe-salario" type="number" min="0" step="0.01" autocomplete="off" value="${Number.isFinite(p.salario) ? p.salario : ''}"${ro}><select id="pe-salario_periodo" aria-label="Periodo del salario"${ro}>${opciones(CAT.periodos, p.salario_periodo, 'Periodo')}</select></div>`)}
        ${campo('tipo_contrato', 'Contrato', `<select id="pe-tipo_contrato"${ro}>${opciones(CAT.contratos, p.tipo_contrato, 'Sin especificar')}</select>`)}
        ${campo('contrato_vence', 'Contrato vence', input('contrato_vence', p.contrato_vence, 'type="date"' + ro))}
        </div>`;
      if (!nuevo) h += `<h4 class="pe-sub2">Documentos del expediente</h4>
        <div class="pe-docs">${(p.documentos || []).map(d => `<div class="pe-doc"><span><b>${esc(CAT.documentos[d.tipo] || d.tipo)}</b> · ${esc(d.nombre)} <small>${esc(fecha(d.created_at.slice(0, 10)))} · ${esc(d.subido_por_nombre || '')}</small></span><span class="btn-group"><button type="button" class="btn btn-outline btn-chico" data-pe-doc="${Number(d.id)}">Descargar</button>${edita ? `<button type="button" class="btn btn-outline btn-chico" data-pe-doc-quitar="${Number(d.id)}">Quitar</button>` : ''}</span></div>`).join('') || '<p class="ayuda">Sin documentos todavía.</p>'}</div>
        ${edita ? `<div class="pe-subir"><select id="pe-doc-tipo" aria-label="Qué documento es">${opciones(Object.entries(CAT.documentos), '', 'Qué documento es')}</select><input type="file" id="pe-doc-archivo" accept=".pdf,.jpg,.jpeg,.png" aria-label="Archivo"><button type="button" class="btn btn-secundario btn-chico" id="pe-doc-subir">Subir</button></div><small class="ayuda">PDF, JPG o PNG, hasta 10 MB.</small>` : ''}`;
      h += '</div>';
    } else if (!nuevo) {
      h += `<div class="modal-section"><h3 class="pe-sub">Pagos y expediente</h3><p class="ayuda">🔒 Solo con el permiso «Datos sensibles del personal».${p.tiene_clabe ? ' CLABE registrada: ' + esc(p.clabe_mascara) + '.' : ''}</p></div>`;
    }
    if (!nuevo) {
      const v = p.vacaciones;
      h += `<div class="modal-section"><h3 class="pe-sub">Vacaciones e incidencias</h3>
        <p class="pe-vac">${!v ? 'Captura la fecha de ingreso para calcular sus vacaciones.' : !v.anios ? `Aún no cumple su primer año (lo cumple el ${esc(fecha(v.proximo))}); por ley todavía no le corresponden vacaciones.` : `<b>${v.disponibles}</b> día(s) disponibles de ${v.corresponden} que le corresponden por ${v.anios} año(s) de antigüedad (del ${esc(fecha(v.desde))} al ${esc(fecha(v.proximo))}).`}</p>
        <div class="tabla-scroll"><table class="tabla-resumen pe-tabla"><thead><tr><th>Tipo</th><th>Fechas</th><th>Días</th><th>Notas</th><th></th></tr></thead><tbody>
        ${(p.incidencias || []).map(i => `<tr class="${i.cancelada ? 'pe-baja' : ''}"><td>${esc(CAT.incidencias[i.tipo] || i.tipo)}${i.con_goce ? '' : ' <small>(sin goce)</small>'}</td><td>${esc(fecha(i.fecha_inicio))}${i.fecha_fin !== i.fecha_inicio ? ' – ' + esc(fecha(i.fecha_fin)) : ''}</td><td>${Number(i.dias)}</td><td>${i.notas_ocultas ? '<small>🔒 Notas solo con datos sensibles</small>' : i.notas_ilegibles ? '<small>⚠ No se pueden leer (clave de cifrado)</small>' : esc(i.notas || '')}${i.cancelada ? '<small> · Cancelada: ' + esc(i.motivo_cancelacion || '') + '</small>' : ''}</td><td>${edita && !i.cancelada ? `<button type="button" class="btn btn-outline btn-chico" data-pe-inc-cancelar="${Number(i.id)}">Cancelar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5"><p class="ayuda">Sin registros.</p></td></tr>'}
        </tbody></table></div>
        ${edita && p.activo ? `<div class="pe-inc-nueva form-grid-2">
          ${campo('inc-tipo', 'Registrar', `<select id="pe-inc-tipo">${opciones(Object.entries(CAT.incidencias), 'vacaciones')}</select>`)}
          ${campo('inc-dias', 'Días (opcional)', '<input id="pe-inc-dias" type="number" min="0.5" step="0.5" placeholder="Se calculan de las fechas">')}
          ${campo('inc-inicio', 'Desde', `<input id="pe-inc-inicio" type="date" value="${hoy()}">`)}
          ${campo('inc-fin', 'Hasta', `<input id="pe-inc-fin" type="date" value="${hoy()}">`)}
          ${campo('inc-notas', 'Notas', '<input id="pe-inc-notas" maxlength="300">')}
          <div class="campo-modal"><label class="check-linea"><input type="checkbox" id="pe-inc-goce" checked> Con goce de sueldo</label><button type="button" class="btn btn-secundario" id="pe-inc-registrar">Registrar</button></div>
        </div>` : ''}</div>
        <div class="modal-section"><h3 class="pe-sub">Órdenes donde participó</h3>${(p.ordenes || []).length ? '<ul class="pe-ordenes">' + p.ordenes.map(o => `<li><b>${esc(folioOrdenServicio(o))}</b> · ${esc(o.cliente || '')} · ${esc(fecha(o.fecha_realizado || o.fecha_servicio))} · ${esc(CAT.papeles[o.papel] || o.papel)}${o.ejecucion === 'realizado' ? ' ✔' : ''}</li>`).join('') + '</ul>' : '<p class="ayuda">Todavía no está en ninguna orden.</p>'}</div>`;
    }
    h += `<div class="modal-section pe-pie"><p id="pe-aviso" role="status"></p><div class="btn-group">
      ${edita ? `<button type="button" class="btn btn-primario" id="pe-guardar">${nuevo ? 'Dar de alta' : 'Guardar cambios'}</button>` : ''}
      ${edita && !nuevo ? (p.activo ? '<button type="button" class="btn btn-peligro" id="pe-baja">Dar de baja</button>' : '<button type="button" class="btn btn-outline" id="pe-reactivar">Reactivar (reingreso)</button>') : ''}
      </div></div>`;
    $('pe-cuerpo').innerHTML = h;
    base = JSON.stringify(datosFormulario());
    aviso();
  }
  function aviso() { const a = $('pe-aviso'); if (a) a.textContent = actual?.nuevo ? 'Nueva · aún no guardada' : pendiente() ? 'Cambios sin guardar' : ''; }
  async function permitirSalida() { return !pendiente() || await solicitarDialogo({ titulo: 'Cambios sin guardar', mensaje: '¿Descartar los cambios de la ficha?', aceptar: 'Descartar' }); }

  async function guardar() {
    if (ocupado) return; ocupado = true;
    const b = $('pe-guardar'); if (b) b.disabled = true;
    try {
      const d = datosFormulario();
      if (actual.nuevo) { if (!d.sucursal_id) delete d.sucursal_id; const x = await pedir('', { method: 'POST', body: JSON.stringify(d) }); toast('Persona dada de alta'); actual = await pedir('/' + x.id); }
      else { await pedir('/' + actual.id, { method: 'PUT', body: JSON.stringify({ ...d, version: actual.version }) }); toast('Ficha guardada'); actual = await pedir('/' + actual.id); }
      pintarFicha(); cargar();
    } catch (e) { toast(e.message); const a = $('pe-aviso'); if (a) a.textContent = e.message; }
    finally { ocupado = false; if (b && b.isConnected) b.disabled = false; }
  }
  async function baja() {
    if (pendiente()) { toast('Guarda o descarta los cambios antes de dar de baja'); return; }
    const motivo = await solicitarDialogo({ titulo: 'Dar de baja a ' + actual.nombre, mensaje: 'Queda en el historial (sus órdenes, vacaciones y documentos se conservan) y ya no aparece para asignarlo a órdenes.', aceptar: 'Dar de baja', campo: { etiqueta: 'Motivo', requerido: 'Escribe el motivo' } });
    if (!motivo) return;
    let desactivar = false;
    if (actual.usuario_id && Permisos.puede('usuarios.administrar')) desactivar = !!await solicitarDialogo({ titulo: 'Su cuenta en el sistema', mensaje: `${actual.nombre} tiene la cuenta «${actual.usuario_nombre}». ¿También se le quita el acceso?`, aceptar: 'Sí, quitar acceso' });
    try {
      const r = await pedir('/' + actual.id + '/baja', { method: 'POST', body: JSON.stringify({ motivo, desactivar_usuario: desactivar }) });
      toast('Baja registrada' + (r.acceso_desactivado ? ' y acceso desactivado' : '') + (r.ordenes_abiertas ? ` · era responsable de ${r.ordenes_abiertas} orden(es) por realizar: asígnales otro técnico` : ''));
      actual = await pedir('/' + actual.id); pintarFicha(); cargar();
    } catch (e) { toast(e.message); }
  }
  async function reactivar() {
    try { await pedir('/' + actual.id + '/reactivar', { method: 'POST', body: '{}' }); toast('Reingreso registrado'); actual = await pedir('/' + actual.id); pintarFicha(); cargar(); } catch (e) { toast(e.message); }
  }
  async function registrarIncidencia(forzar = false) {
    const cuerpo = { tipo: $('pe-inc-tipo').value, fecha_inicio: $('pe-inc-inicio').value, fecha_fin: $('pe-inc-fin').value || $('pe-inc-inicio').value, dias: $('pe-inc-dias').value || null, notas: $('pe-inc-notas').value, con_goce: $('pe-inc-goce').checked, forzar };
    try {
      await pedir('/' + actual.id + '/incidencias', { method: 'POST', body: JSON.stringify(cuerpo) });
      toast('Registrado'); actual = await pedir('/' + actual.id); pintarFicha(); cargar();
    } catch (e) {
      if (!forzar && (e.datos?.codigo === 'EMPALME' || e.datos?.codigo === 'SIN_DIAS') && await solicitarDialogo({ titulo: 'Revisa antes de registrar', mensaje: e.message + '. ¿Registrar de todos modos?', aceptar: 'Registrar' })) return registrarIncidencia(true);
      toast(e.message);
    }
  }
  async function cancelarIncidencia(id) {
    const motivo = await solicitarDialogo({ titulo: 'Cancelar registro', mensaje: 'Queda tachado en el historial.', aceptar: 'Cancelar registro', campo: { etiqueta: 'Motivo', requerido: 'Escribe el motivo' } });
    if (!motivo) return;
    try { await pedir('/incidencias/' + Number(id) + '/cancelar', { method: 'POST', body: JSON.stringify({ motivo }) }); actual = await pedir('/' + actual.id); pintarFicha(); cargar(); } catch (e) { toast(e.message); }
  }
  async function subirDocumento() {
    const tipo = $('pe-doc-tipo').value, archivo = $('pe-doc-archivo').files[0];
    if (!tipo) { toast('Elige qué documento es'); return; }
    if (!archivo) { toast('Elige el archivo'); return; }
    if (archivo.size > 10 * 1024 * 1024) { toast('El archivo pasa de 10 MB'); return; }
    try {
      const r = await fetch(API + '/personal/' + actual.id + '/documentos', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + USUARIO_ACTUAL.token, ...encabezadoSucursal(), 'X-Tipo': tipo, 'X-Nombre': encodeURIComponent(archivo.name) }, body: archivo });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'No se pudo subir');
      toast('Documento agregado al expediente'); actual = await pedir('/' + actual.id); pintarFicha();
    } catch (e) { toast(e.message); }
  }
  async function descargar(id) {
    try {
      const r = await api('/personal/documentos/' + Number(id));
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'No se pudo descargar'); }
      const d = (actual.documentos || []).find(x => x.id === Number(id));
      saveAs(await r.blob(), d?.nombre || 'documento');
    } catch (e) { toast(e.message); }
  }
  async function quitarDocumento(id) {
    if (!await solicitarDialogo({ titulo: 'Quitar documento', mensaje: 'Deja de aparecer en el expediente (el archivo se conserva en el servidor y queda en la bitácora).', aceptar: 'Quitar' })) return;
    try { await pedir('/documentos/' + Number(id) + '/quitar', { method: 'POST', body: '{}' }); actual = await pedir('/' + actual.id); pintarFicha(); } catch (e) { toast(e.message); }
  }

  // ---------- Eventos ----------
  $('pe-nuevo').onclick = () => abrir();
  $('pe-tabla').onclick = e => { const b = e.target.closest('[data-persona]'); if (b) abrir(b.dataset.persona); };
  ['pe-f-puesto', 'pe-f-estado', 'pe-f-alertas'].forEach(id => { $(id).onchange = cargar; });
  $('pe-buscar').oninput = debounce(cargar, 350);
  $('pe-cerrar').onclick = async () => { if (!ocupado && await permitirSalida()) $('overlay-personal').classList.remove('mostrar'); };
  $('pe-cuerpo').addEventListener('input', aviso);
  $('pe-cuerpo').addEventListener('change', aviso);
  $('pe-cuerpo').addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.id === 'pe-guardar') guardar();
    else if (t.id === 'pe-baja') baja();
    else if (t.id === 'pe-reactivar') reactivar();
    else if (t.id === 'pe-inc-registrar') registrarIncidencia();
    else if (t.id === 'pe-doc-subir') subirDocumento();
    else if (t.dataset.peIncCancelar) cancelarIncidencia(t.dataset.peIncCancelar);
    else if (t.dataset.peDoc) descargar(t.dataset.peDoc);
    else if (t.dataset.peDocQuitar) quitarDocumento(t.dataset.peDocQuitar);
  });
  // Al cerrar la ficha (con la X, Esc o desde otra pantalla) se borra de la página: lo sensible no se queda ahí.
  new MutationObserver(() => { if (!$('overlay-personal').classList.contains('mostrar') && !ocupado) { $('pe-cuerpo').innerHTML = ''; actual = null; base = ''; } })
    .observe($('overlay-personal'), { attributes: true, attributeFilter: ['class'] });
  // ---------- Bloque «Personal» de Inicio ----------
  const TAG = { licencia_vence: '🪪 Licencia', contrato_vence: '📄 Contrato', ausencia: '🏖️ Ausencia', sin_responsable: '👷 Sin responsable', cifrado: '🔒 Cifrado' };
  async function pintarInicio() {
    const cont = $('inicio-personal'); if (!cont || !Permisos.puede('personal.ver')) return;
    cont.innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    let avisos;
    try { avisos = await pedir('/avisos'); } catch (e) { cont.innerHTML = `<div class="aviso-error-carga" role="alert"><p>${esc(e.message)}</p><button type="button" class="btn btn-outline" data-pe-inicio-reintentar="1">Reintentar</button></div>`; return; }
    cont.innerHTML = avisos.length ? avisos.map(a => `<div class="fila-alerta ${a.nivel === 'rojo' ? 'vencido' : a.nivel === 'azul' ? 'tipo-alerta' : 'tipo-recompra'}">
        <div class="info"><span class="tipo-tag ${a.nivel === 'rojo' ? 'rojo' : a.nivel === 'azul' ? 'alerta' : 'recompra'}">${esc(TAG[a.tipo] || a.tipo)}</span>
          <div><b>${esc(a.nombre || 'Sin nombre')}</b>${a.folio ? ' · ' + esc(a.folio) : ''}</div><div class="txt">${esc(a.texto)}</div>${a.fecha ? `<div class="fecha">${esc(fecha(a.fecha))}</div>` : ''}</div>
        <div class="util-46">${a.lead_id ? `<button type="button" class="btn btn-outline" data-pe-inicio-orden="${Number(a.lead_id)}">Abrir orden</button>` : `<button type="button" class="btn btn-outline" data-pe-inicio-persona="${Number(a.persona_id)}">Abrir ficha</button>`}</div></div>`).join('')
      : '<p class="util-45">Todo en orden con el personal: sin licencias ni contratos por vencer, nadie falta esta semana y las órdenes próximas tienen responsable. 🎉</p>';
  }
  $('inicio-personal')?.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.peInicioOrden) abrirFicha(Number(b.dataset.peInicioOrden));
    else if (b.dataset.peInicioPersona) abrir(b.dataset.peInicioPersona);
    else if (b.dataset.peInicioReintentar) pintarInicio();
  });
  window.addEventListener('beforeunload', e => { if ($('overlay-personal').classList.contains('mostrar') && pendiente()) { e.preventDefault(); e.returnValue = ''; } });
  return { cargar, abrir, pintarInicio };
})();

// Equipo de una orden de servicio: técnico responsable y, opcional, operadores y ayudantes (de Personal).
const EquipoOrden = (() => {
  const esc = t => escaparHtml(t == null ? '' : String(t));
  const PAPELES = [['operador', 'Operador'], ['ayudante', 'Ayudante']];
  // Un selector por contenedor: el de «editar orden» (ed-equipo-personal) y el de «crear orden» (sn-equipo-personal).
  function crear(contId) {
    const caja = () => document.getElementById(contId);
    let gente = [], inicial = '[]', sucursal = null;
    function lista() {
      const c = caja(); if (!c) return [];
      const resp = c.querySelector('[data-eq-resp]')?.value;
      const otros = [...c.querySelectorAll('[data-eq-fila]')].map(f => ({ personal_id: Number(f.querySelector('[data-eq-persona]').value), papel: f.querySelector('[data-eq-papel]').value })).filter(x => x.personal_id);
      return [...(resp ? [{ personal_id: Number(resp), papel: 'responsable' }] : []), ...otros.filter(x => String(x.personal_id) !== resp)];
    }
    // Sin sucursal conocida (p. ej. Dirección viendo todas) se ofrece todo el personal; el servidor revisa la sucursal.
    const deLaSucursal = p => sucursal == null || p.sucursal_id === sucursal;
    const opcionesGente = (sel, vacio) => `<option value="">${esc(vacio)}</option>` + gente.filter(p => deLaSucursal(p) || String(p.id) === String(sel)).map(p => `<option value="${Number(p.id)}"${String(p.id) === String(sel) ? ' selected' : ''}>${esc(p.nombre)} · ${esc(p.puesto)}${p.con_cuenta ? '' : ' (sin cuenta)'}</option>`).join('');
    function fila(x) {
      return `<div class="pe-eq-fila" data-eq-fila><select data-eq-persona aria-label="Persona del equipo">${opcionesGente(x?.personal_id, 'Elige a la persona')}</select><select data-eq-papel aria-label="Papel en la orden">${PAPELES.map(([v, t]) => `<option value="${v}"${x?.papel === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select><button type="button" class="btn btn-outline btn-chico" data-eq-quitar aria-label="Quitar del equipo">✕</button></div>`;
    }
    async function mostrar(lead) {
      const cont = caja(); if (!cont) return;
      sucursal = lead.sucursal_id ?? null;
      const equipo = lead.equipo_personal || [];
      inicial = JSON.stringify(equipo.map(x => ({ personal_id: x.personal_id, papel: x.papel })));
      cont.innerHTML = '<p class="util-45" role="status">Cargando personal…</p>';
      try { gente = await api('/personal/para-asignar').then(r => r.ok ? r.json() : Promise.reject(new Error('sin acceso'))); }
      catch { gente = []; cont.innerHTML = '<p class="ayuda">No se pudo cargar el personal.</p>'; inicial = null; return; }
      // Quien ya está en la orden aunque ya no esté activo, sigue apareciendo.
      for (const x of equipo) if (!gente.some(p => p.id === x.personal_id)) gente.push({ id: x.personal_id, nombre: x.nombre + ' (baja)', puesto: x.puesto, sucursal_id: sucursal, con_cuenta: !!x.usuario_id });
      const resp = equipo.find(x => x.papel === 'responsable');
      cont.innerHTML = `<div class="pe-eq"><label for="${contId}-resp" class="pe-eq-etq">Técnico responsable</label><select id="${contId}-resp" data-eq-resp>${opcionesGente(resp?.personal_id, 'Sin responsable')}</select>
        <div data-eq-otros>${equipo.filter(x => x.papel !== 'responsable').map(fila).join('')}</div>
        <button type="button" class="btn btn-outline btn-chico" data-eq-agregar>+ Operador o ayudante</button>
        ${gente.some(deLaSucursal) ? '' : '<p class="ayuda">No hay personal dado de alta en esta sucursal (agrégalo en Personal).</p>'}</div>`;
    }
    // Al editar solo se manda si cambió (así una lista que no cargó no borra el equipo).
    function payload() { if (inicial === null || !caja()?.querySelector('[data-eq-resp]')) return {}; const l = lista(); return JSON.stringify(l) === inicial ? {} : { equipo_personal: l }; }
    // Al crear se manda lo que se eligió (si se eligió algo).
    function payloadNuevo() { if (inicial === null || !caja()?.querySelector('[data-eq-resp]')) return {}; const l = lista(); return l.length ? { equipo_personal: l } : {}; }
    caja()?.addEventListener('click', e => {
      if (e.target.closest('[data-eq-agregar]')) caja().querySelector('[data-eq-otros]').insertAdjacentHTML('beforeend', fila(null));
      else if (e.target.closest('[data-eq-quitar]')) e.target.closest('[data-eq-fila]').remove();
    });
    return { mostrar, payload, payloadNuevo, lista };
  }
  const edicion = crear('ed-equipo-personal'), alta = crear('sn-equipo-personal');
  return { mostrar: lead => edicion.mostrar(lead), payload: () => edicion.payload(), alta };
})();
