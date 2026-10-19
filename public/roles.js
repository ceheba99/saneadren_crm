// «Roles y permisos» (Ajustes → Usuarios, solo Dirección): tabla con los permisos en filas y los roles en columnas.
// Se marcan o desmarcan casillas y se guarda; también se crean roles nuevos (copiando otro), se renombran,
// se quitan los que nadie usa y se revisa cómo le queda el sistema a un rol con «Ver como».
const Roles = (() => {
  const $ = id => document.getElementById(id);
  const esc = t => escaparHtml(t == null ? '' : String(t));
  let DATOS = null;
  const cambios = new Map(); // rol → Set de permisos (solo los roles tocados)

  const permisosDe = rol => cambios.get(rol.clave) || new Set(rol.permisos);
  const pendientes = () => [...cambios.entries()].filter(([clave, set]) => {
    const r = DATOS.roles.find(x => x.clave === clave);
    return r && (set.size !== r.permisos.length || r.permisos.some(c => !set.has(c)));
  });

  async function cargar() {
    const cont = $('roles-permisos');
    if (!cont || !Permisos.datos.direccion) return;
    cont.innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    try { DATOS = await api('/permisos').then(r => r.ok ? r.json() : Promise.reject(new Error('No se pudo cargar'))); }
    catch (e) { cont.innerHTML = '<p class="aviso-error-carga" role="alert">' + esc(e.message) + '</p>'; return; }
    cambios.clear();
    pintar();
  }

  function pintar() {
    const cont = $('roles-permisos');
    const roles = DATOS.roles;
    const cab = roles.map(r => '<th scope="col" class="rp-rol"><span class="rp-rol-nombre">' + esc(r.nombre) + '</span>'
      + '<span class="rp-rol-gente">' + (r.usuarios === 1 ? '1 persona' : r.usuarios + ' personas') + '</span>'
      + (r.editable ? '<span class="rp-rol-acciones"><button type="button" class="btn btn-outline btn-chico" data-rp-ver="' + esc(r.clave) + '" aria-label="Ver el sistema como ' + esc(r.nombre) + '">Ver como</button>'
        + '<button type="button" class="btn btn-outline btn-chico" data-rp-renombrar="' + esc(r.clave) + '" aria-label="Renombrar ' + esc(r.nombre) + '">Renombrar</button>'
        + (!r.sistema ? '<button type="button" class="btn btn-outline btn-chico" data-rp-quitar="' + esc(r.clave) + '" aria-label="Quitar el rol ' + esc(r.nombre) + '">Quitar</button>' : '') + '</span>' : '<span class="rp-rol-gente">Siempre todo</span>')
      + '</th>').join('');
    let seccion = '', filas = '';
    for (const p of DATOS.catalogo) {
      if (p.seccion !== seccion) { seccion = p.seccion; filas += '<tr class="rp-seccion"><th scope="rowgroup" colspan="' + (roles.length + 1) + '">' + esc(seccion) + '</th></tr>'; }
      filas += '<tr><th scope="row" class="rp-permiso"><span>' + esc(p.nombre) + '</span>' + (p.ayuda ? '<small>' + esc(p.ayuda) + '</small>' : '') + '</th>'
        + roles.map(r => {
          const id = 'rp-' + Permisos.clase(r.clave) + '-' + Permisos.clase(p.clave);
          const on = !r.editable || permisosDe(r).has(p.clave);
          return '<td class="rp-celda"><input type="checkbox" id="' + id + '" data-rp-rol="' + esc(r.clave) + '" data-rp-permiso="' + esc(p.clave) + '"'
            + (on ? ' checked' : '') + (r.editable ? '' : ' disabled') + ' aria-label="' + esc(r.nombre + ': ' + p.nombre) + '"></td>';
        }).join('') + '</tr>';
    }
    const n = pendientes().length;
    cont.innerHTML = '<div class="rp-nuevo form-grid">'
      + '<div class="campo"><label for="rp-nuevo-nombre">Rol nuevo</label><input id="rp-nuevo-nombre" maxlength="40" placeholder="Ej. Contador, Cobranza"></div>'
      + '<div class="campo"><label for="rp-nuevo-copia">Empieza con los permisos de</label><select id="rp-nuevo-copia"><option value="">Ninguno (sin permisos)</option>'
      + roles.filter(r => r.editable).map(r => '<option value="' + esc(r.clave) + '">' + esc(r.nombre) + '</option>').join('') + '</select></div>'
      + '<div class="campo"><button type="button" class="btn btn-secundario" id="rp-crear">Crear rol</button></div></div>'
      + '<div class="tabla-scroll rp-tabla-caja"><table class="rp-tabla"><thead><tr><th scope="col" class="rp-permiso">Permiso</th>' + cab + '</tr></thead><tbody>' + filas + '</tbody></table></div>'
      + '<p class="ayuda">El gerente además nunca hace lo que afecta a todas las sucursales (sucursales, catálogos, bitácora completa, respaldo). Los cambios aplican de inmediato a cada persona con ese rol (la pantalla se actualiza al recargarla).</p>'
      + '<div class="btn-group"><button type="button" class="btn btn-primario" id="rp-guardar"' + (n ? '' : ' disabled') + '>' + (n ? 'Guardar cambios (' + n + (n === 1 ? ' rol' : ' roles') + ')' : 'Sin cambios') + '</button>'
      + (n ? '<button type="button" class="btn btn-outline" id="rp-descartar">Descartar</button>' : '') + '</div>';
  }

  function marcar(rolClave, permiso, on) {
    const r = DATOS.roles.find(x => x.clave === rolClave);
    const set = new Set(permisosDe(r));
    if (on) set.add(permiso); else set.delete(permiso);
    cambios.set(rolClave, set);
    const n = pendientes().length, b = $('rp-guardar');
    b.disabled = !n; b.textContent = n ? 'Guardar cambios (' + n + (n === 1 ? ' rol' : ' roles') + ')' : 'Sin cambios';
    if (n && !$('rp-descartar')) b.insertAdjacentHTML('afterend', '<button type="button" class="btn btn-outline" id="rp-descartar">Descartar</button>');
    if (!n) $('rp-descartar')?.remove();
  }

  async function guardar() {
    const lista = pendientes();
    if (!lista.length) return;
    const b = $('rp-guardar'); b.disabled = true;
    try {
      for (const [clave, set] of lista) {
        const r = await api('/roles/' + encodeURIComponent(clave) + '/permisos', { method: 'PUT', body: JSON.stringify({ permisos: [...set] }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'No se pudo guardar');
      }
      toast('Permisos guardados');
      await cargar();
    } catch (e) { toast(e.message); b.disabled = false; }
  }

  async function crear() {
    const nombre = $('rp-nuevo-nombre').value.trim();
    if (!nombre) { toast('Escribe el nombre del rol'); $('rp-nuevo-nombre').focus(); return; }
    if (pendientes().length && !await solicitarDialogo({ titulo: 'Cambios sin guardar', mensaje: 'Tienes casillas cambiadas sin guardar. Si creas el rol ahora, esos cambios se pierden.', aceptar: 'Crear de todos modos' })) return;
    const r = await api('/roles', { method: 'POST', body: JSON.stringify({ nombre, copiar_de: $('rp-nuevo-copia').value || null }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast(j.error || 'No se pudo crear'); return; }
    toast('Rol «' + j.nombre + '» creado: ajusta sus casillas y guarda');
    await cargar();
    if (typeof cargarUsuarios === 'function') cargarUsuarios();
  }

  async function renombrar(clave) {
    const r = DATOS.roles.find(x => x.clave === clave);
    const nombre = await solicitarDialogo({ titulo: 'Renombrar «' + r.nombre + '»', mensaje: 'El nombre se ve en la lista de usuarios. Los permisos no cambian.', aceptar: 'Renombrar', campo: { etiqueta: 'Nombre nuevo', requerido: 'Escribe el nombre' } });
    if (!nombre) return;
    const x = await api('/roles/' + encodeURIComponent(clave), { method: 'PUT', body: JSON.stringify({ nombre }) });
    const j = await x.json().catch(() => ({}));
    if (!x.ok) { toast(j.error || 'No se pudo renombrar'); return; }
    toast('Rol renombrado'); await cargar();
    if (typeof cargarUsuarios === 'function') cargarUsuarios();
  }

  async function quitar(clave) {
    const r = DATOS.roles.find(x => x.clave === clave);
    if (!await solicitarDialogo({ titulo: 'Quitar el rol «' + r.nombre + '»', mensaje: 'Ya no aparecerá para asignarlo. Solo se puede si nadie lo tiene.', aceptar: 'Quitar rol' })) return;
    const x = await api('/roles/' + encodeURIComponent(clave), { method: 'DELETE' });
    const j = await x.json().catch(() => ({}));
    if (!x.ok) { toast(j.error || 'No se pudo quitar'); return; }
    toast('Rol quitado'); await cargar();
    if (typeof cargarUsuarios === 'function') cargarUsuarios();
  }

  document.addEventListener('change', e => {
    const c = e.target.closest('[data-rp-rol]');
    if (c) marcar(c.dataset.rpRol, c.dataset.rpPermiso, c.checked);
  });
  document.addEventListener('click', e => {
    const t = e.target;
    if (t.id === 'rp-guardar') guardar();
    else if (t.id === 'rp-descartar') { cambios.clear(); pintar(); }
    else if (t.id === 'rp-crear') crear();
    else if (t.dataset?.rpVer) {
      if (pendientes().length) { toast('Guarda o descarta los cambios antes de ver como otro rol'); return; }
      Permisos.verComo(t.dataset.rpVer);
    }
    else if (t.dataset?.rpRenombrar) renombrar(t.dataset.rpRenombrar);
    else if (t.dataset?.rpQuitar) quitar(t.dataset.rpQuitar);
  });
  return { cargar, hayCambios: () => !!(DATOS && pendientes().length) };
})();
