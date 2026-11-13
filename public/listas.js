/* «Listas desplegables» (2026-11-13). Servidor: server/listas.js (inventario en server/listas-inventario.js).
   1) Para todos: al entrar se piden las opciones ocultas de cada lista de captura. Al abrir esa lista, las ocultas se
      esconden; si lo ya guardado trae una oculta, se sigue viendo y se puede guardar igual. También se pone el
      «Tipo de gasto» vigente en la copia de public/cxp-excel.js que usa la pantalla.
   2) Solo Dirección (Ajustes, apartado «Listas desplegables»): todas las listas del sistema, agrupadas por de dónde salen
      sus opciones y por qué se pueden o no editar; las editables se cambian aquí (agregar, renombrar, ordenar, ocultar). */
const Listas = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t);
  let OCULTAS = {}, DATOS = null, EDITANDO = {};

  async function cargar() {
    try {
      const r = await api('/listas'); const j = await r.json(); if (!r.ok) return;
      OCULTAS = j.ocultas || {};
      if (Array.isArray(j.tipos_gasto) && window.CxpExcel?.ponerTiposGasto) CxpExcel.ponerTiposGasto(j.tipos_gasto);
    } catch { /* sin conexión: se ven todas las opciones; el servidor sigue validando */ }
  }
  // Al abrir una lista (clic, toque o teclado), esconder lo oculto salvo lo que ya trae elegido.
  function esconder(e) {
    const sel = e.target; if (!(sel instanceof HTMLSelectElement) || !OCULTAS[sel.id]) return;
    const ocultas = new Set(OCULTAS[sel.id]);
    for (const o of sel.options) { const fuera = ocultas.has(o.value) && o.value !== sel.value; o.hidden = fuera; o.disabled = fuera; }
  }
  for (const ev of ['focusin', 'pointerdown', 'mousedown']) document.addEventListener(ev, esconder, true);

  // ---------- Apartado de Dirección ----------
  const sinGuardar = clave => EDITANDO[clave] && JSON.stringify(EDITANDO[clave]) !== JSON.stringify(DATOS.editables[clave].opciones.map(copia));
  const copia = o => ({ clave: o.clave, nombre: o.nombre, oculta: !!o.oculta });

  // Trae todo del servidor. Lo que se está editando y no se ha guardado (salvo la lista «guardada») se conserva.
  async function traer(guardada) {
    const caja = $('listas-desplegables');
    let j;
    try { const r = await api('/listas/admin'); j = await r.json(); if (!r.ok) throw new Error(j.error); }
    catch (err) { if (!DATOS) caja.innerHTML = '<p class="aviso-error-carga">No se pudieron cargar las listas: ' + esc(err.message) + '</p>'; else toast('No se pudieron recargar las listas: ' + err.message); return; }
    const conservar = DATOS ? Object.keys(EDITANDO).filter(k => k !== guardada && sinGuardar(k)) : [];
    DATOS = j;
    for (const [k, l] of Object.entries(DATOS.editables)) if (!conservar.includes(k)) EDITANDO[k] = l.opciones.map(copia);
    pintar();
  }
  async function admin() {
    const caja = $('listas-desplegables'); if (!caja || !Permisos.datos?.direccion) return;
    if (DATOS && Object.keys(EDITANDO).some(sinGuardar)) return; // no pisar lo que se está editando
    if (!DATOS) caja.innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    await traer();
  }

  function filaOpcion(clave, o, i, n) {
    const l = DATOS.editables[clave], info = l.opciones.find(x => x.clave === o.clave) || {};
    const nota = info.protegida ? '🔒 ' + info.protegida : info.de_fabrica ? 'Antes: «' + info.de_fabrica + '»' : (!o.clave ? 'Nueva (sin guardar)' : info.nueva ? 'Agregada por Dirección' : '');
    return '<div class="lst-fila' + (o.oculta ? ' lst-oculta' : '') + '" data-lst-i="' + i + '">'
      + '<span class="lst-mover"><button type="button" class="btn btn-outline btn-chico" data-lst-subir aria-label="Subir «' + esc(o.nombre) + '»"' + (i === 0 ? ' disabled' : '') + '>▲</button>'
      + '<button type="button" class="btn btn-outline btn-chico" data-lst-bajar aria-label="Bajar «' + esc(o.nombre) + '»"' + (i === n - 1 ? ' disabled' : '') + '>▼</button></span>'
      + '<input data-lst-nombre value="' + esc(o.nombre) + '" maxlength="' + Number(l.max) + '" aria-label="Nombre de la opción"' + (info.protegida ? ' disabled' : '') + '>'
      + '<label class="lst-ocultar"><input type="checkbox" data-lst-oculta' + (o.oculta ? ' checked' : '') + (info.protegida ? ' disabled' : '') + '> Oculta</label>'
      + (!o.clave ? '<button type="button" class="btn btn-outline btn-chico" data-lst-quitar>Quitar</button>' : '')
      + (nota ? '<small class="lst-nota">' + esc(nota) + '</small>' : '') + '</div>';
  }

  function tarjetaEditable(e) {
    const clave = e.lista, l = DATOS.editables[clave], ops = EDITANDO[clave];
    return '<details class="lst-lista" data-lst="' + esc(clave) + '"' + (sinGuardar(clave) ? ' open' : '') + '><summary><b>' + esc(e.nombre) + '</b> · '
      + Number(ops.filter(o => !o.oculta).length) + ' opciones' + (ops.some(o => o.oculta) ? ' (+' + Number(ops.filter(o => o.oculta).length) + ' ocultas)' : '')
      + '<small class="lst-donde">' + esc(e.aparece) + '</small></summary>'
      + (l.renombrar_cambia_guardado ? '<p class="ayuda">Al renombrar una opción también se cambia en lo que ya estaba guardado con ella.</p>' : '')
      + '<div class="lst-filas">' + ops.map((o, i) => filaOpcion(clave, o, i, ops.length)).join('') + '</div>'
      + '<div class="lst-agregar"><input data-lst-nueva maxlength="' + Number(l.max) + '" placeholder="Opción nueva" aria-label="Opción nueva para ' + esc(e.nombre) + '">'
      + '<button type="button" class="btn btn-outline" data-lst-agregar>＋ Agregar</button></div>'
      + '<div class="lst-acciones"><button type="button" class="btn btn-secundario" data-lst-guardar' + (sinGuardar(clave) ? '' : ' disabled') + '>Guardar cambios</button>'
      + '<button type="button" class="btn btn-outline" data-lst-deshacer' + (sinGuardar(clave) ? '' : ' disabled') + '>Deshacer</button></div></details>';
  }

  function tarjetaFija(e) {
    const n = e.cuantas;
    return '<div class="lst-lista lst-solo"><b>' + esc(e.nombre) + '</b> · ' + Number(n) + (n === 1 ? ' lista' : ' listas')
      + '<small class="lst-donde">' + esc(e.aparece) + '</small>'
      + (e.donde ? '<small class="lst-razon">✏️ Dónde se edita: ' + esc(e.donde) + '</small>' : '')
      + (e.porque ? '<small class="lst-razon">🔒 ' + esc(e.porque) + '</small>' : '') + '</div>';
  }

  function pintar() {
    const porGrupo = {};
    for (const e of DATOS.inventario) (porGrupo[e.grupo] ||= []).push(e);
    const conteo = g => (porGrupo[g] || []).reduce((s, e) => s + e.cuantas, 0);
    $('listas-desplegables').innerHTML = '<p class="ayuda">El sistema tiene <b>' + Number(DATOS.total) + ' listas desplegables</b>. Están agrupadas según de dónde salen sus opciones.</p>'
      + Object.entries(DATOS.grupos).map(([g, info]) => '<section class="lst-grupo"><h3 class="util-13">' + esc(info.nombre) + ' · ' + Number(conteo(g)) + '</h3>'
        + '<p class="ayuda">' + esc(info.explicacion) + '</p>'
        + (porGrupo[g] || []).map(e => (e.lista ? tarjetaEditable(e) : tarjetaFija(e))).join('') + '</section>').join('');
  }
  const repintar = clave => {
    const viejo = document.querySelector('[data-lst="' + CSS.escape(clave) + '"]'); if (!viejo) return;
    const e = DATOS.inventario.find(x => x.lista === clave), abierto = viejo.open;
    viejo.outerHTML = tarjetaEditable(e);
    const nuevo = document.querySelector('[data-lst="' + CSS.escape(clave) + '"]'); if (nuevo && abierto) nuevo.open = true;
  };

  async function guardar(clave, btn) {
    btn.disabled = true;
    try {
      const r = await api('/listas/' + encodeURIComponent(clave), { method: 'PUT', body: JSON.stringify({ version: DATOS.editables[clave].version, opciones: EDITANDO[clave] }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      toast(j.sin_cambios ? 'No había cambios' : 'Lista guardada' + (j.migrados ? ` (se actualizaron ${j.migrados} registros ya guardados)` : ''));
      await traer(clave); await cargar();
      const t = document.querySelector('[data-lst="' + CSS.escape(clave) + '"]'); if (t) t.open = true;
    } catch (err) { toast(err.message); btn.disabled = false; }
  }

  function preparar() {
    const caja = $('listas-desplegables'); if (!caja || caja.dataset.listo) return; caja.dataset.listo = '1';
    caja.addEventListener('input', e => {
      const t = e.target.closest('[data-lst]'); if (!t) return; const clave = t.dataset.lst;
      const fila = e.target.closest('[data-lst-i]');
      if (fila && e.target.matches('[data-lst-nombre]')) EDITANDO[clave][Number(fila.dataset.lstI)].nombre = e.target.value;
      else if (fila && e.target.matches('[data-lst-oculta]')) { EDITANDO[clave][Number(fila.dataset.lstI)].oculta = e.target.checked; fila.classList.toggle('lst-oculta', e.target.checked); }
      else return;
      const hay = sinGuardar(clave); t.querySelector('[data-lst-guardar]').disabled = !hay; t.querySelector('[data-lst-deshacer]').disabled = !hay;
    });
    caja.addEventListener('change', e => { if (e.target.matches('[data-lst-oculta]')) e.target.dispatchEvent(new Event('input', { bubbles: true })); });
    caja.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-lst-nueva]')) { e.preventDefault(); e.target.closest('[data-lst]').querySelector('[data-lst-agregar]').click(); } });
    caja.addEventListener('click', e => {
      const b = e.target.closest('button'); const t = b?.closest('[data-lst]'); if (!t) return;
      const clave = t.dataset.lst, ops = EDITANDO[clave], i = Number(b.closest('[data-lst-i]')?.dataset.lstI);
      if (b.matches('[data-lst-subir]') && i > 0) [ops[i - 1], ops[i]] = [ops[i], ops[i - 1]];
      else if (b.matches('[data-lst-bajar]') && i < ops.length - 1) [ops[i + 1], ops[i]] = [ops[i], ops[i + 1]];
      else if (b.matches('[data-lst-quitar]')) ops.splice(i, 1);
      else if (b.matches('[data-lst-agregar]')) {
        const v = t.querySelector('[data-lst-nueva]').value.replace(/\s+/g, ' ').trim();
        if (!v) { toast('Escribe la opción nueva'); return; }
        ops.push({ clave: null, nombre: v, oculta: false });
      } else if (b.matches('[data-lst-deshacer]')) EDITANDO[clave] = DATOS.editables[clave].opciones.map(copia);
      else if (b.matches('[data-lst-guardar]')) { guardar(clave, b); return; }
      else return;
      repintar(clave);
    });
  }

  return { cargar, admin: () => { preparar(); return admin(); } };
})();
window.Listas = Listas;
