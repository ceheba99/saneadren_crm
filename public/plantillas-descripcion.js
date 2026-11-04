// Descripciones guardadas por cliente (2026-11-04, ver server/plantillas-descripcion.js).
//  · Ficha del cliente: sección «Descripciones guardadas». Dirección y el Gerente de su sucursal las crean, cambian o
//    quitan (quitar = desactivar; se pueden reactivar). Los demás que cotizan al cliente solo las ven.
//  · Partidas de una cotización u orden de ese cliente: botón «📋 Usar descripción guardada» junto a la descripción;
//    pide el valor de cada hueco ({sucursal}…) y llena la descripción, que se puede seguir editando.
const PlantillasDesc = (() => {
  const $ = id => document.getElementById(id);
  const esc = v => escaparHtml(v ?? '');
  const MAX_LEYENDA = 10000; // validarPartidas (server/index.js)
  const HUECO = /\{([^{}\n]{1,40})\}/g;
  const huecosDe = t => { const v = []; for (const m of String(t || '').matchAll(HUECO)) { const k = m[1].trim(); if (k && !v.includes(k)) v.push(k); } return v; };
  // Si el texto fijo va todo en mayúsculas (como el de KFC), lo que se escribe en los huecos también.
  const enMayusculas = t => { const fijo = String(t).replace(HUECO, '').replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, ''); return fijo.length >= 3 && fijo === fijo.toLocaleUpperCase('es-MX'); };
  const llenar = (t, valores, mayus) => String(t).replace(HUECO, (todo, k) => { const v = valores[k.trim()]; return v == null ? todo : (mayus ? v.toLocaleUpperCase('es-MX') : v); });
  const etiqueta = p => p.nombre || (p.texto.length > 70 ? p.texto.slice(0, 67) + '…' : p.texto);
  const escHuecos = t => esc(t).replace(/\{([^{}\n]{1,40})\}/g, '<mark class="pd-hueco">{$1}</mark>');
  async function pedir(ruta, cuerpo, metodo = cuerpo ? 'POST' : 'GET') {
    const r = await api(ruta, { method: metodo, ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'No se pudo completar');
    return j;
  }

  // ---------- Ficha del cliente ----------
  let FICHA = null; // { clienteId, puede_editar, plantillas, editando: id | 0 (nueva) | null }
  async function cargarCliente(id) {
    const sec = $('fc-plantillas-seccion'), cont = $('fc-plantillas'); if (!sec || !cont) return;
    FICHA = null; cont.innerHTML = ''; $('fc-plantillas-resumen').textContent = '';
    let datos;
    try { datos = await pedir('/clientes/' + Number(id) + '/plantillas?todas=1'); }
    catch { sec.hidden = true; return; } // su rol no cotiza a este cliente
    if (CLIENTE_ACTUAL?.id !== Number(id)) return; // ya abrieron otra ficha
    FICHA = { clienteId: Number(id), ...datos, editando: null };
    sec.hidden = false;
    pintarFicha();
  }
  function opcionesServicio(actual) {
    return '<option value="">— Cualquier servicio —</option>' + (CATALOGOS.servicios || []).map(s => `<option value="${Number(s.id)}"${Number(s.id) === Number(actual) ? ' selected' : ''}>${esc(s.nombre)}</option>`).join('');
  }
  function formulario(p) {
    const v = p || { id: 0, nombre: '', servicio_id: null, texto: '' };
    return `<div class="pd-form" data-pd-form="${Number(v.id)}">
      <div class="campo-modal"><label for="pd-nombre-${v.id}">Nombre corto (para elegirla rápido, opcional)</label><input id="pd-nombre-${v.id}" data-pd-f="nombre" maxlength="80" value="${esc(v.nombre)}" placeholder="Ej. Mantenimiento trampas"></div>
      <div class="campo-modal"><label for="pd-servicio-${v.id}">Servicio del catálogo (opcional)</label><select id="pd-servicio-${v.id}" data-pd-f="servicio_id">${opcionesServicio(v.servicio_id)}</select></div>
      <div class="campo-modal pd-ancho"><label for="pd-texto-${v.id}">Texto de la descripción</label><textarea id="pd-texto-${v.id}" data-pd-f="texto" rows="4" maxlength="${MAX_LEYENDA}" placeholder="Ej. DESTAPAR Y DESAZOLVAR RED DE DRENAJE… KFC {sucursal}">${esc(v.texto)}</textarea>
        <p class="ayuda">Escribe entre llaves lo que cambia cada vez, por ejemplo <b>{sucursal}</b>. Al usarla, el sistema pregunta qué va en cada hueco. <span data-pd-huecos></span></p></div>
      <div class="btn-group"><button type="button" class="btn btn-primario btn-chico" data-pd-guardar>Guardar descripción</button><button type="button" class="btn btn-secundario btn-chico" data-pd-cancelar>Cancelar</button></div>
    </div>`;
  }
  function tarjeta(p) {
    if (FICHA.editando === p.id) return formulario(p);
    const acciones = !FICHA.puede_editar ? '' : p.activo
      ? `<button type="button" class="btn btn-outline btn-chico" data-pd-cambiar="${p.id}">✏️ Cambiar</button><button type="button" class="btn btn-outline btn-chico" data-pd-quitar="${p.id}">Quitar</button>`
      : `<button type="button" class="btn btn-outline btn-chico" data-pd-reactivar="${p.id}">Volver a usar</button>`;
    return `<div class="pd-tarjeta${p.activo ? '' : ' pd-quitada'}">
      <div class="pd-cab"><b>${esc(p.nombre || 'Sin nombre')}</b>${p.servicio_nombre ? ` <span class="pd-etiqueta">${esc(p.servicio_nombre)}</span>` : ''}${p.activo ? '' : ' <span class="pd-etiqueta">Quitada</span>'}<span class="pd-acciones">${acciones}</span></div>
      <p class="pd-texto">${escHuecos(p.texto)}</p>
      ${p.huecos.length ? `<p class="ayuda">Al usarla pregunta: ${p.huecos.map(esc).join(', ')}</p>` : ''}
    </div>`;
  }
  function pintarFicha() {
    const cont = $('fc-plantillas'); if (!FICHA || !cont) return;
    const activas = FICHA.plantillas.filter(p => p.activo), quitadas = FICHA.plantillas.filter(p => !p.activo);
    $('fc-plantillas-resumen').textContent = activas.length ? '· ' + activas.length : '';
    cont.innerHTML = (activas.length ? activas.map(tarjeta).join('') : '<p class="ayuda">Este cliente no tiene descripciones guardadas.</p>')
      + (FICHA.puede_editar ? (FICHA.editando === 0 ? formulario(null) : '<button type="button" class="btn btn-outline btn-chico" data-pd-nueva>➕ Agregar descripción guardada</button>')
        : '<p class="ayuda">Las crean o cambian Dirección y el Gerente de la sucursal del cliente.</p>')
      + (FICHA.puede_editar && quitadas.length ? `<details class="pd-quitadas"><summary>Quitadas (${quitadas.length})</summary>${quitadas.map(tarjeta).join('')}</details>` : '');
    cont.querySelectorAll('[data-pd-form]').forEach(f => mostrarHuecos(f));
  }
  function mostrarHuecos(form) {
    const h = huecosDe(form.querySelector('[data-pd-f="texto"]').value);
    form.querySelector('[data-pd-huecos]').textContent = h.length ? 'Huecos: ' + h.join(', ') + '.' : '';
  }
  let guardando = false;
  async function guardar(form) {
    if (guardando) return;
    const id = Number(form.dataset.pdForm), campo = k => form.querySelector(`[data-pd-f="${k}"]`).value;
    const cuerpo = { nombre: campo('nombre'), servicio_id: campo('servicio_id') || null, texto: campo('texto') };
    if (!cuerpo.texto.trim()) { toast('Escribe el texto de la descripción'); form.querySelector('[data-pd-f="texto"]').focus(); return; }
    guardando = true;
    try {
      const base = '/clientes/' + FICHA.clienteId + '/plantillas';
      if (id) await pedir(base + '/' + id, cuerpo, 'PUT'); else await pedir(base, cuerpo, 'POST');
      toast(id ? 'Descripción cambiada' : 'Descripción guardada');
      await cargarCliente(FICHA.clienteId);
      window.Bitacora?.historialCliente(FICHA.clienteId);
    } catch (e) { toast(e.message); } finally { guardando = false; }
  }
  async function cambiarEstado(id, accion) {
    const p = FICHA.plantillas.find(x => x.id === id); if (!p) return;
    if (accion === 'desactivar' && !await solicitarDialogo({ titulo: 'Quitar descripción guardada', mensaje: `«${etiqueta(p)}» ya no aparecerá al capturar partidas. No se borra: queda en la bitácora del cliente y se puede volver a usar.`, aceptar: 'Quitar' })) return;
    const ruta = accion === 'desactivar' ? '/clientes/' + FICHA.clienteId + '/plantillas/' + id + '/desactivar' : '/clientes/' + FICHA.clienteId + '/plantillas/' + id + '/reactivar';
    try { await pedir(ruta, {}, 'POST'); toast(accion === 'desactivar' ? 'Descripción quitada' : 'Descripción activa otra vez'); await cargarCliente(FICHA.clienteId); window.Bitacora?.historialCliente(FICHA.clienteId); }
    catch (e) { toast(e.message); }
  }
  $('fc-plantillas')?.addEventListener('click', e => {
    if (!FICHA) return;
    const b = e.target.closest('button'); if (!b) return;
    if (b.matches('[data-pd-nueva]')) { FICHA.editando = 0; pintarFicha(); $('fc-plantillas').querySelector('[data-pd-form="0"] [data-pd-f="texto"]')?.focus(); }
    else if (b.dataset.pdCambiar) { FICHA.editando = Number(b.dataset.pdCambiar); pintarFicha(); }
    else if (b.matches('[data-pd-cancelar]')) { FICHA.editando = null; pintarFicha(); }
    else if (b.matches('[data-pd-guardar]')) guardar(b.closest('[data-pd-form]'));
    else if (b.dataset.pdQuitar) cambiarEstado(Number(b.dataset.pdQuitar), 'desactivar');
    else if (b.dataset.pdReactivar) cambiarEstado(Number(b.dataset.pdReactivar), 'reactivar');
  });
  $('fc-plantillas')?.addEventListener('input', e => { const f = e.target.closest('[data-pd-form]'); if (f && e.target.matches('[data-pd-f="texto"]')) mostrarHuecos(f); });

  // ---------- Partidas de la cotización u orden ----------
  let EDITOR = { clienteId: null, plantillas: [], soloLeer: true }, turno = 0;
  async function prepararEditor(clienteId, soloLeer) {
    const mio = ++turno;
    EDITOR = { clienteId: clienteId ? Number(clienteId) : null, plantillas: [], soloLeer };
    pintarBotones();
    if (!clienteId || soloLeer) return;
    let datos; try { datos = await pedir('/clientes/' + Number(clienteId) + '/plantillas'); } catch { return; }
    if (mio !== turno) return; // ya se abrió otro registro
    EDITOR.plantillas = datos.plantillas || [];
    pintarBotones();
  }
  // El botón se agrega (o se quita) en cada partida; si la ficha está en solo lectura, solo-lectura.js lo esconde.
  function pintarBotones() {
    const hay = !EDITOR.soloLeer && EDITOR.plantillas.length > 0;
    document.querySelectorAll('#gc-items .gc-fila').forEach(fila => {
      const b = fila.querySelector('.gc-usar-plantilla');
      if (!hay) { b?.remove(); return; }
      if (!b) fila.querySelector('.gc-c-leyenda').insertAdjacentHTML('beforeend', '<button type="button" class="btn-link gc-usar-plantilla">📋 Usar descripción guardada del cliente</button>');
    });
  }

  let FILA = null; // la partida que se está llenando
  function abrirUso(fila) {
    FILA = fila;
    const servicio = fila.querySelector('.gc-servicio').value;
    const idServ = (CATALOGOS.servicios || []).find(s => s.nombre === servicio)?.id;
    // Primero las del servicio de esta partida, luego las generales y al final las de otros servicios.
    const orden = p => (p.servicio_id && p.servicio_id === idServ ? 0 : !p.servicio_id ? 1 : 2);
    const lista = [...EDITOR.plantillas].sort((a, b) => orden(a) - orden(b));
    $('pd-uso-plantilla').innerHTML = lista.map(p => `<option value="${p.id}">${esc(etiqueta(p))}${p.servicio_nombre ? ' · ' + esc(p.servicio_nombre) : ''}</option>`).join('');
    $('pd-uso-elegir').hidden = lista.length < 2;
    pintarUso(true);
    abrirVentana('overlay-plantilla-desc');
    setTimeout(() => ($('pd-uso-huecos').querySelector('input') || $('pd-uso-plantilla')).focus(), 0);
  }
  const plantillaElegida = () => EDITOR.plantillas.find(p => p.id === Number($('pd-uso-plantilla').value));
  function valoresUso() { return Object.fromEntries([...$('pd-uso-huecos').querySelectorAll('input')].map(i => [i.dataset.hueco, i.value.trim()])); }
  function pintarUso(nueva) {
    const p = plantillaElegida(); if (!p) return;
    if (nueva) $('pd-uso-huecos').innerHTML = p.huecos.length ? p.huecos.map((k, i) => `<div class="campo-modal"><label for="pd-hueco-${i}">${esc(k.charAt(0).toUpperCase() + k.slice(1))}</label><input id="pd-hueco-${i}" data-hueco="${esc(k)}" maxlength="200" autocomplete="off"></div>`).join('')
      : '<p class="ayuda">Esta descripción no tiene huecos: se usa tal cual.</p>';
    $('pd-uso-mayus').hidden = !(p.huecos.length && enMayusculas(p.texto));
    const v = valoresUso(), vistaPrevia = llenar(p.texto, Object.fromEntries(Object.entries(v).filter(([, x]) => x)), enMayusculas(p.texto));
    $('pd-uso-vista').innerHTML = escHuecos(vistaPrevia);
  }
  async function usar() {
    const p = plantillaElegida(); if (!p || !FILA?.isConnected) return;
    const v = valoresUso(), falta = p.huecos.find(k => !v[k]);
    if (falta) { toast('Escribe qué va en «' + falta + '»'); $('pd-uso-huecos').querySelector(`[data-hueco="${CSS.escape(falta)}"]`)?.focus(); return; }
    const texto = llenar(p.texto, v, enMayusculas(p.texto));
    if (texto.length > MAX_LEYENDA) { toast('La descripción quedaría de más de ' + MAX_LEYENDA.toLocaleString('es-MX') + ' caracteres: acorta lo que escribiste'); return; }
    const leyenda = FILA.querySelector('.gc-leyenda'), escrita = leyenda.value.trim() && leyenda.value !== (leyenda.dataset.plantilla || '') && leyenda.value !== texto;
    $('overlay-plantilla-desc').classList.remove('mostrar');
    if (escrita && !await solicitarDialogo({ titulo: 'Ya hay una descripción', mensaje: '¿Reemplazar la descripción que ya tiene esta partida por la descripción guardada?', aceptar: 'Reemplazar' })) return;
    // Si la partida no tiene servicio, toma el de la descripción guardada.
    const sel = FILA.querySelector('.gc-servicio');
    if (!sel.value && p.servicio_nombre && [...sel.options].some(o => o.value === p.servicio_nombre)) {
      sel.value = p.servicio_nombre; leyenda.dataset.plantilla = descripcionServicio(p.servicio_nombre);
      sel.dispatchEvent(new Event('input', { bubbles: true })); sincronizarEditor();
    }
    leyenda.value = texto;
    leyenda.dispatchEvent(new Event('input', { bubbles: true })); leyenda.dispatchEvent(new Event('change', { bubbles: true }));
    leyenda.focus();
    toast('Descripción lista: puedes seguir editándola');
  }
  $('gc-items')?.addEventListener('click', e => { const b = e.target.closest('.gc-usar-plantilla'); if (b) abrirUso(b.closest('.gc-fila')); });
  $('pd-uso-plantilla')?.addEventListener('change', () => pintarUso(true));
  $('pd-uso-huecos')?.addEventListener('input', () => pintarUso(false));
  $('pd-uso-huecos')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); usar(); } });
  $('pd-uso-aceptar')?.addEventListener('click', usar);
  $('pd-uso-cancelar')?.addEventListener('click', () => $('overlay-plantilla-desc').classList.remove('mostrar'));

  return { cargarCliente, prepararEditor, pintarBotones, huecosDe, llenar, enMayusculas };
})();
window.PlantillasDesc = PlantillasDesc;
