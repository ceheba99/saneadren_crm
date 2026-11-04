// Sucursales del cliente y huecos de la descripción del servicio (2026-11-04, ver server/cliente-sucursales.js).
//  · Ficha del cliente: sección «Sucursales del cliente». Dirección y el Gerente de su sucursal las agregan, cambian o
//    quitan (quitar = desactivar; se pueden volver a activar). Los demás que cotizan al cliente solo las ven.
//  · Partidas: la descripción del servicio (catálogo) puede traer huecos entre llaves. Al elegir el servicio se abre
//    «Completar la descripción»: {sucursal} se elige de la lista del cliente (solo de la lista) y los demás huecos se
//    escriben. La descripción queda llena y se puede seguir editando; con huecos sin llenar no se guarda.
const SucursalesCliente = (() => {
  const $ = id => document.getElementById(id);
  const esc = v => escaparHtml(v ?? '');
  const MAX_LEYENDA = 10000; // validarPartidas (server/index.js)
  const HUECO = /\{([^{}\n]{1,40})\}/g;
  const llave = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const esSucursal = k => llave(k) === 'sucursal';
  const huecosDe = t => { const v = []; for (const m of String(t || '').matchAll(HUECO)) { const k = m[1].trim(); if (k && !v.includes(k)) v.push(k); } return v; };
  // Si el texto fijo va todo en mayúsculas, lo que se pone en los huecos también.
  const enMayusculas = t => { const fijo = String(t).replace(HUECO, '').replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, ''); return fijo.length >= 3 && fijo === fijo.toLocaleUpperCase('es-MX'); };
  const llenar = (t, valores, mayus) => String(t).replace(HUECO, (todo, k) => { const v = valores[k.trim()]; return v ? (mayus ? v.toLocaleUpperCase('es-MX') : v) : todo; });
  const escHuecos = t => esc(t).replace(/\{([^{}\n]{1,40})\}/g, '<mark class="hx-hueco">{$1}</mark>');
  async function pedir(ruta, cuerpo, metodo = 'GET') {
    const r = await api(ruta, { method: metodo, ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'No se pudo completar');
    return j;
  }

  // ---------- Ficha del cliente ----------
  let FICHA = null; // { clienteId, puede_editar, sucursales, editando: id | 0 (nueva) | null }
  async function cargarCliente(id) {
    const sec = $('fc-sucursales-cli-seccion'), cont = $('fc-sucursales-cli'); if (!sec || !cont) return;
    FICHA = null; cont.innerHTML = ''; $('fc-sucursales-cli-resumen').textContent = '';
    let datos;
    try { datos = await pedir('/clientes/' + Number(id) + '/sucursales?todas=1'); }
    catch { sec.hidden = true; return; } // su rol no cotiza a este cliente
    if (CLIENTE_ACTUAL?.id !== Number(id)) return; // ya abrieron otra ficha
    FICHA = { clienteId: Number(id), ...datos, editando: null };
    sec.hidden = false;
    pintarFicha();
  }
  function formulario(s) {
    const v = s || { id: 0, nombre: '', direccion: '' };
    return `<div class="sc-form" data-sc-form="${Number(v.id)}">
      <div class="campo-modal"><label for="sc-nombre-${v.id}">Nombre de la sucursal</label><input id="sc-nombre-${v.id}" data-sc-f="nombre" maxlength="80" value="${esc(v.nombre)}" placeholder="Ej. Puerta La Victoria" autocomplete="off"></div>
      <div class="campo-modal"><label for="sc-dir-${v.id}">Dirección (opcional)</label><input id="sc-dir-${v.id}" data-sc-f="direccion" maxlength="250" value="${esc(v.direccion)}" autocomplete="off"></div>
      <div class="btn-group"><button type="button" class="btn btn-primario btn-chico" data-sc-guardar>Guardar sucursal</button><button type="button" class="btn btn-secundario btn-chico" data-sc-cancelar>Cancelar</button></div>
    </div>`;
  }
  function fila(s) {
    if (FICHA.editando === s.id) return formulario(s);
    const acciones = !FICHA.puede_editar ? '' : s.activo
      ? `<button type="button" class="btn btn-outline btn-chico" data-sc-cambiar="${s.id}">✏️ Cambiar</button><button type="button" class="btn btn-outline btn-chico" data-sc-quitar="${s.id}">Quitar</button>`
      : `<button type="button" class="btn btn-outline btn-chico" data-sc-reactivar="${s.id}">Volver a usar</button>`;
    return `<div class="sc-fila${s.activo ? '' : ' sc-quitada'}"><b>${esc(s.nombre)}</b>${s.direccion ? `<small>${esc(s.direccion)}</small>` : ''}<span class="sc-acciones">${acciones}</span></div>`;
  }
  function pintarFicha() {
    const cont = $('fc-sucursales-cli'); if (!FICHA || !cont) return;
    const activas = FICHA.sucursales.filter(s => s.activo), quitadas = FICHA.sucursales.filter(s => !s.activo);
    $('fc-sucursales-cli-resumen').textContent = activas.length ? '· ' + activas.length : '';
    cont.innerHTML = (activas.length ? `<div class="sc-lista">${activas.map(fila).join('')}</div>` : '<p class="ayuda">Este cliente no tiene sucursales registradas.</p>')
      + (FICHA.puede_editar ? (FICHA.editando === 0 ? formulario(null) : '<button type="button" class="btn btn-outline btn-chico" data-sc-nueva>➕ Agregar sucursal</button>')
        : '<p class="ayuda">Las agregan o cambian Dirección y el Gerente de la sucursal del cliente.</p>')
      + (FICHA.puede_editar && quitadas.length ? `<details class="sc-quitadas"><summary>Quitadas (${quitadas.length})</summary><div class="sc-lista">${quitadas.map(fila).join('')}</div></details>` : '');
  }
  let guardando = false;
  async function guardar(form) {
    if (guardando) return;
    const id = Number(form.dataset.scForm), campo = k => form.querySelector(`[data-sc-f="${k}"]`).value;
    const cuerpo = { nombre: campo('nombre'), direccion: campo('direccion') };
    if (!cuerpo.nombre.trim()) { toast('Escribe el nombre de la sucursal'); form.querySelector('[data-sc-f="nombre"]').focus(); return; }
    guardando = true;
    try {
      const base = '/clientes/' + FICHA.clienteId + '/sucursales';
      if (id) await pedir(base + '/' + id, cuerpo, 'PUT'); else await pedir(base, cuerpo, 'POST');
      toast(id ? 'Sucursal cambiada' : 'Sucursal agregada');
      await cargarCliente(FICHA.clienteId);
      if (!id) { FICHA.editando = 0; pintarFicha(); $('fc-sucursales-cli').querySelector('[data-sc-form="0"] [data-sc-f="nombre"]')?.focus(); } // para capturar varias seguidas
      window.Bitacora?.historialCliente(FICHA.clienteId);
    } catch (e) { toast(e.message); } finally { guardando = false; }
  }
  async function cambiarEstado(id, accion) {
    const s = FICHA.sucursales.find(x => x.id === id); if (!s) return;
    if (accion === 'desactivar' && !await solicitarDialogo({ titulo: 'Quitar sucursal del cliente', mensaje: `«${s.nombre}» ya no aparecerá al capturar partidas. No se borra: queda en la bitácora del cliente y se puede volver a usar.`, aceptar: 'Quitar' })) return;
    const ruta = accion === 'desactivar' ? '/clientes/' + FICHA.clienteId + '/sucursales/' + id + '/desactivar' : '/clientes/' + FICHA.clienteId + '/sucursales/' + id + '/reactivar';
    try { await pedir(ruta, {}, 'POST'); toast(accion === 'desactivar' ? 'Sucursal quitada' : 'Sucursal activa otra vez'); await cargarCliente(FICHA.clienteId); window.Bitacora?.historialCliente(FICHA.clienteId); }
    catch (e) { toast(e.message); }
  }
  $('fc-sucursales-cli')?.addEventListener('click', e => {
    if (!FICHA) return;
    const b = e.target.closest('button'); if (!b) return;
    if (b.matches('[data-sc-nueva]')) { FICHA.editando = 0; pintarFicha(); $('fc-sucursales-cli').querySelector('[data-sc-form="0"] [data-sc-f="nombre"]')?.focus(); }
    else if (b.dataset.scCambiar) { FICHA.editando = Number(b.dataset.scCambiar); pintarFicha(); }
    else if (b.matches('[data-sc-cancelar]')) { FICHA.editando = null; pintarFicha(); }
    else if (b.matches('[data-sc-guardar]')) guardar(b.closest('[data-sc-form]'));
    else if (b.dataset.scQuitar) cambiarEstado(Number(b.dataset.scQuitar), 'desactivar');
    else if (b.dataset.scReactivar) cambiarEstado(Number(b.dataset.scReactivar), 'reactivar');
  });
  $('fc-sucursales-cli')?.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-sc-f]')) { e.preventDefault(); guardar(e.target.closest('[data-sc-form]')); } });

  // ---------- Partidas de la cotización u orden ----------
  let EDITOR = { clienteId: null, sucursales: [], soloLeer: true, cargadas: Promise.resolve() }, turno = 0;
  function prepararEditor(clienteId, soloLeer) {
    const mio = ++turno;
    EDITOR = { clienteId: clienteId ? Number(clienteId) : null, sucursales: [], soloLeer, cargadas: Promise.resolve() };
    pintarBotones();
    if (!clienteId || soloLeer) return;
    EDITOR.cargadas = pedir('/clientes/' + Number(clienteId) + '/sucursales').then(d => { if (mio === turno) EDITOR.sucursales = d.sucursales || []; }).catch(() => {});
  }
  // «✏️ Completar la descripción» en cada partida cuya descripción tenga huecos sin llenar (en solo lectura lo esconde solo-lectura.js).
  function pintarBotones() {
    document.querySelectorAll('#gc-items .gc-fila').forEach(fila => {
      const b = fila.querySelector('.gc-llenar-huecos'), hay = !EDITOR.soloLeer && huecosDe(fila.querySelector('.gc-leyenda')?.value).length > 0;
      if (!hay) { b?.remove(); return; }
      if (!b) fila.querySelector('.gc-c-leyenda').insertAdjacentHTML('beforeend', '<button type="button" class="btn-link gc-llenar-huecos">✏️ Completar la descripción (sucursal…)</button>');
    });
  }

  const opcionesSucursal = lista => '<option value="">— Elige la sucursal —</option>' + lista.map(s => '<option value="' + esc(s.nombre) + '">' + esc(s.nombre) + (s.direccion ? ' · ' + esc(s.direccion) : '') + '</option>').join('');
  let FILA = null; // la partida que se está llenando
  async function llenarHuecos(fila) {
    const leyenda = fila?.querySelector('.gc-leyenda'); if (!leyenda || EDITOR.soloLeer) return;
    const huecos = huecosDe(leyenda.value); if (!huecos.length) return;
    await EDITOR.cargadas;
    FILA = fila;
    const lista = EDITOR.sucursales;
    $('hx-campos').innerHTML = huecos.map((k, i) => {
      const etiqueta = esc(k.charAt(0).toUpperCase() + k.slice(1));
      if (!esSucursal(k)) return `<div class="campo-modal"><label for="hx-${i}">${etiqueta}</label><input id="hx-${i}" data-hueco="${esc(k)}" maxlength="200" autocomplete="off"></div>`;
      if (!lista.length) return `<div class="campo-modal"><label>${etiqueta}</label><p class="aviso-error-carga" role="alert">Este cliente no tiene sucursales registradas. Pídele a Dirección o al Gerente que las agreguen en la ficha del cliente («🏬 Sucursales del cliente»).</p><input type="hidden" data-hueco="${esc(k)}" value=""></div>`;
      return `<div class="campo-modal"><label for="hx-${i}">${etiqueta} del cliente</label><select id="hx-${i}" data-hueco="${esc(k)}">${opcionesSucursal(lista)}</select></div>`;
    }).join('');
    $('hx-mayus').hidden = !enMayusculas(leyenda.value);
    vistaPrevia();
    abrirVentana('overlay-huecos');
    setTimeout(() => $('hx-campos').querySelector('select, input:not([type="hidden"])')?.focus(), 50);
  }
  const valores = () => Object.fromEntries([...$('hx-campos').querySelectorAll('[data-hueco]')].map(i => [i.dataset.hueco, i.value.trim()]));
  function vistaPrevia() {
    const t = FILA?.querySelector('.gc-leyenda').value || '';
    $('hx-vista').innerHTML = escHuecos(llenar(t, valores(), enMayusculas(t)));
  }
  function usar() {
    if (!FILA?.isConnected) return;
    const leyenda = FILA.querySelector('.gc-leyenda'), v = valores(), falta = Object.keys(v).find(k => !v[k]);
    if (falta) { toast(esSucursal(falta) ? 'Elige la sucursal del cliente' : 'Escribe qué va en «' + falta + '»'); $('hx-campos').querySelector(`[data-hueco="${CSS.escape(falta)}"]`)?.focus(); return; }
    const texto = llenar(leyenda.value, v, enMayusculas(leyenda.value));
    if (texto.length > MAX_LEYENDA) { toast('La descripción quedaría de más de ' + MAX_LEYENDA.toLocaleString('es-MX') + ' caracteres: acorta lo que escribiste'); return; }
    leyenda.value = texto;
    leyenda.dispatchEvent(new Event('input', { bubbles: true })); leyenda.dispatchEvent(new Event('change', { bubbles: true }));
    $('overlay-huecos').classList.remove('mostrar');
    pintarBotones();
    leyenda.focus();
  }
  $('gc-items')?.addEventListener('click', e => { const b = e.target.closest('.gc-llenar-huecos'); if (b) llenarHuecos(b.closest('.gc-fila')); });
  $('gc-items')?.addEventListener('input', e => { if (e.target.classList.contains('gc-leyenda')) pintarBotones(); });
  $('hx-campos')?.addEventListener('input', vistaPrevia);
  $('hx-campos')?.addEventListener('change', vistaPrevia);
  $('hx-campos')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); usar(); } });
  $('hx-aceptar')?.addEventListener('click', usar);
  $('hx-cancelar')?.addEventListener('click', () => $('overlay-huecos').classList.remove('mostrar'));

  return { cargarCliente, prepararEditor, pintarBotones, llenarHuecos, huecosDe, llenar, enMayusculas };
})();
window.SucursalesCliente = SucursalesCliente;
