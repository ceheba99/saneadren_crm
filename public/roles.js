// «Roles y permisos» (Ajustes → Usuarios, solo Dirección): tabla con los roles en columnas y, en filas, primero
// QUÉ VE cada rol en cada área (nada / lo suyo / toda su sucursal) y luego QUÉ HACE (casillas). Se guarda; también
// se crean roles nuevos (copiando otro), se renombran, se quitan los que nadie usa y se revisa cómo le queda el
// sistema a un rol con «Ver como».
// Lo que ve un rol viaja como permisos «virtuales» (cxc.ver = ve algo de cuentas por cobrar, cxc.sucursal = ve toda
// su sucursal): así las dependencias («Confirmar cobros» necesita ver cuentas por cobrar) funcionan igual para todo.
const Roles = (() => {
  const $ = id => document.getElementById(id);
  const esc = t => escaparHtml(t == null ? '' : String(t));
  let DATOS = null;
  const cambios = new Map(); // rol → Set de permisos, con los virtuales de lo que ve (solo los roles tocados)

  const permisosDe = rol => cambios.get(rol.clave) || new Set(rol.permisos);
  const pendientes = () => [...cambios.entries()].filter(([clave, set]) => {
    const r = DATOS.roles.find(x => x.clave === clave);
    return r && (set.size !== r.permisos.length || r.permisos.some(c => !set.has(c)));
  });
  const esVirtual = c => (DATOS.areas || []).some(a => c === a.clave + '.ver' || c === a.clave + '.sucursal');
  const nivelEn = (set, area) => set.has(area + '.sucursal') ? 2 : set.has(area + '.ver') ? 1 : 0;
  // Dependencias de la pantalla: las del servidor más «toda su sucursal» → «al menos lo suyo».
  const dependencias = () => ({ ...(DATOS.dependencias || {}), ...Object.fromEntries((DATOS.areas || []).map(a => [a.clave + '.sucursal', [a.clave + '.ver']])) });
  // Cuentas por cobrar en «Nada» con «Registrar cobros» (y órdenes que abrir): ve solo los cobros que él registra (el
  // técnico que cobra en campo).
  const etiquetaNivel = (area, i, set) => (area === 'cxc' && i === 0 && set.has('cobros.registrar') && set.has('ventas.ver') ? 'Solo lo que él registra' : DATOS.niveles[i]);
  const nombreDe = c => {
    const p = DATOS.catalogo.find(x => x.clave === c); if (p) return p.nombre;
    const [area, tipo] = c.split('.'), a = (DATOS.areas || []).find(x => x.clave === area);
    return a ? `ver ${tipo === 'sucursal' ? 'toda su sucursal' : 'lo suyo'} en ${a.nombre}` : c; // sin HTML: va a toast (textContent)
  };

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
    const roles = DATOS.roles, cols = roles.length + 1;
    const cab = roles.map(r => '<th scope="col" class="rp-rol"><span class="rp-rol-nombre">' + esc(r.nombre) + '</span>'
      + '<span class="rp-rol-gente">' + (r.usuarios === 1 ? '1 persona' : r.usuarios + ' personas') + '</span>'
      + (r.editable ? '<span class="rp-rol-acciones"><button type="button" class="btn btn-outline btn-chico" data-rp-ver="' + esc(r.clave) + '" aria-label="Ver el sistema como ' + esc(r.nombre) + '">Ver como</button>'
        + '<button type="button" class="btn btn-outline btn-chico" data-rp-renombrar="' + esc(r.clave) + '" aria-label="Renombrar ' + esc(r.nombre) + '">Renombrar</button>'
        + (!r.sistema ? '<button type="button" class="btn btn-outline btn-chico" data-rp-quitar="' + esc(r.clave) + '" aria-label="Quitar el rol ' + esc(r.nombre) + '">Quitar</button>' : '') + '</span>' : '<span class="rp-rol-gente">Siempre todo</span>')
      + '</th>').join('');
    // Qué ve: un selector por área y rol.
    let filas = '<tr class="rp-seccion"><th scope="rowgroup" colspan="' + cols + '">Qué ve (dentro de sus sucursales)</th></tr>';
    for (const a of DATOS.areas || []) {
      filas += '<tr><th scope="row" class="rp-permiso"><span>' + esc(a.nombre) + '</span><small>Lo suyo: ' + esc(a.suyo) + '</small>' + (a.nada ? '<small>Nada: ' + esc(a.nada) + '</small>' : '') + '</th>'
        + roles.map(r => {
          if (!r.editable) return '<td class="rp-celda"><span class="rp-todo">Todo</span></td>';
          const n = nivelEn(permisosDe(r), a.clave);
          return '<td class="rp-celda"><select class="rp-nivel" data-rp-nivel-rol="' + esc(r.clave) + '" data-rp-area="' + esc(a.clave) + '" aria-label="' + esc(r.nombre + ': qué ve en ' + a.nombre) + '">'
            + DATOS.niveles.map((t, i) => '<option value="' + i + '"' + (i === n ? ' selected' : '') + '>' + esc(etiquetaNivel(a.clave, i, permisosDe(r))) + '</option>').join('') + '</select></td>';
        }).join('') + '</tr>';
    }
    // Qué hace: casillas.
    let seccion = '';
    for (const p of DATOS.catalogo) {
      if (p.seccion !== seccion) { seccion = p.seccion; filas += '<tr class="rp-seccion"><th scope="rowgroup" colspan="' + cols + '">' + esc(seccion) + '</th></tr>'; }
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
      + '<p class="ayuda">«Lo suyo» se aplica en todo el sistema (listas, Inicio, calendario, buscador, reportes y Excel). El gerente además nunca hace lo que afecta a todas las sucursales (sucursales, catálogos, bitácora completa, respaldo). Los cambios aplican de inmediato a cada persona con ese rol (la pantalla se actualiza al recargarla).</p>'
      + '<div class="btn-group"><button type="button" class="btn btn-primario" id="rp-guardar"' + (n ? '' : ' disabled') + '>' + (n ? 'Guardar cambios (' + n + (n === 1 ? ' rol' : ' roles') + ')' : 'Sin cambios') + '</button>'
      + (n ? '<button type="button" class="btn btn-outline" id="rp-descartar">Descartar</button>' : '') + '</div>';
  }

  // Aplica marcar/quitar un permiso (real o virtual) con todo lo que arrastra; devuelve lo arrastrado.
  function aplicar(set, permiso, on, arrastrados) {
    const dep = dependencias();
    if (on) {
      const cola = [permiso];
      while (cola.length) { const p = cola.pop(); if (!set.has(p) && p !== permiso) arrastrados.push(['+', p]); set.add(p); (dep[p] || []).forEach(x => { if (!set.has(x)) cola.push(x); }); }
    } else {
      const cola = [permiso];
      while (cola.length) { const p = cola.pop(); if (set.delete(p) && p !== permiso) arrastrados.push(['-', p]); Object.entries(dep).forEach(([d, req]) => { if (req.includes(p) && set.has(d)) cola.push(d); }); }
    }
  }
  // Refleja en la columna del rol lo que quedó (casillas y selectores) y actualiza el botón de guardar.
  function reflejar(rolClave, arrastrados) {
    const set = cambios.get(rolClave);
    document.querySelectorAll(`[data-rp-rol="${CSS.escape(rolClave)}"]`).forEach(c => { c.checked = set.has(c.dataset.rpPermiso); });
    document.querySelectorAll(`[data-rp-nivel-rol="${CSS.escape(rolClave)}"]`).forEach(s => {
      s.value = String(nivelEn(set, s.dataset.rpArea));
      [...s.options].forEach(o => { o.textContent = etiquetaNivel(s.dataset.rpArea, Number(o.value), set); });
    });
    const visibles = arrastrados.filter(([, p]) => !esVirtual(p) || !p.endsWith('.ver') || !set.has(p.replace('.ver', '.sucursal')));
    if (visibles.length) toast(visibles.map(([s, p]) => (s === '+' ? 'También se marcó: ' : 'También se quitó: ') + nombreDe(p)).join(' · '));
    const n = pendientes().length, b = $('rp-guardar');
    b.disabled = !n; b.textContent = n ? 'Guardar cambios (' + n + (n === 1 ? ' rol' : ' roles') + ')' : 'Sin cambios';
    if (n && !$('rp-descartar')) b.insertAdjacentHTML('afterend', '<button type="button" class="btn btn-outline" id="rp-descartar">Descartar</button>');
    if (!n) $('rp-descartar')?.remove();
  }
  function marcar(rolClave, permiso, on) {
    const r = DATOS.roles.find(x => x.clave === rolClave);
    const set = new Set(permisosDe(r)), arrastrados = [];
    aplicar(set, permiso, on, arrastrados);
    cambios.set(rolClave, set);
    reflejar(rolClave, arrastrados);
  }
  // Qué ve en un área: 0 nada, 1 lo suyo, 2 toda su sucursal.
  function fijarNivel(rolClave, area, nivel) {
    const r = DATOS.roles.find(x => x.clave === rolClave);
    const set = new Set(permisosDe(r)), arrastrados = [];
    if (nivel >= 1) aplicar(set, area + '.ver', true, arrastrados); else aplicar(set, area + '.ver', false, arrastrados);
    if (nivel >= 2) aplicar(set, area + '.sucursal', true, arrastrados); else if (set.has(area + '.sucursal')) aplicar(set, area + '.sucursal', false, arrastrados);
    cambios.set(rolClave, set);
    reflejar(rolClave, arrastrados.filter(([, p]) => p !== area + '.ver' && p !== area + '.sucursal'));
  }

  async function guardar() {
    const lista = pendientes();
    if (!lista.length) return;
    const b = $('rp-guardar'); b.disabled = true;
    // Se guarda cada rol por su cuenta: si otra persona cambió uno mientras tanto, ese no se pisa y los demás sí se guardan.
    const guardados = [], chocaron = [], errores = [];
    for (const [clave, set] of lista) {
      const rol = DATOS.roles.find(x => x.clave === clave);
      const alcances = Object.fromEntries((DATOS.areas || []).map(a => [a.clave, nivelEn(set, a.clave)]));
      try {
        const r = await api('/roles/' + encodeURIComponent(clave) + '/permisos', { method: 'PUT', body: JSON.stringify({ permisos: [...set].filter(c => !esVirtual(c)), alcances, antes: rol.permisos }) });
        const j = await r.json().catch(() => ({}));
        if (r.status === 409) chocaron.push(rol.nombre);
        else if (!r.ok) errores.push(rol.nombre + ': ' + (j.error || 'no se pudo guardar'));
        else guardados.push(rol.nombre);
      } catch (e) { errores.push(rol.nombre + ': ' + e.message); }
    }
    const partes = [];
    if (guardados.length) partes.push('Guardado: ' + guardados.join(', ') + '.');
    if (chocaron.length) partes.push('No se guardó ' + chocaron.join(', ') + ': alguien más lo cambió mientras lo editabas; ya ves lo actual, vuelve a hacer tu cambio.');
    if (errores.length) partes.push(errores.join(' · '));
    toast(partes.join(' '));
    if (errores.length && !chocaron.length && !guardados.length) { b.disabled = false; return; }
    await cargar();
  }

  async function crear() {
    const nombre = $('rp-nuevo-nombre').value.trim();
    if (!nombre) { toast('Escribe el nombre del rol'); $('rp-nuevo-nombre').focus(); return; }
    if (pendientes().length && !await solicitarDialogo({ titulo: 'Cambios sin guardar', mensaje: 'Tienes casillas cambiadas sin guardar. Si creas el rol ahora, esos cambios se pierden.', aceptar: 'Crear de todos modos' })) return;
    const r = await api('/roles', { method: 'POST', body: JSON.stringify({ nombre, copiar_de: $('rp-nuevo-copia').value || null }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast(j.error || 'No se pudo crear'); return; }
    toast('Rol «' + j.nombre + '» creado: ajusta qué ve y qué hace, y guarda');
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
    if (c) return marcar(c.dataset.rpRol, c.dataset.rpPermiso, c.checked);
    const s = e.target.closest('[data-rp-nivel-rol]');
    if (s) fijarNivel(s.dataset.rpNivelRol, s.dataset.rpArea, Number(s.value));
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
