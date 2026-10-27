/* Marketing · proyectos (fase 2, 2026-10-26). Ver server/marketing.js.
   Lista de proyectos en tarjetas (avance, tareas atrasadas, próximo hito) y la ventana de cada uno:
   · Gantt: barras por tarea en su rango de fechas, relleno con su % de avance, hitos como rombo, la línea de hoy y
     flechas de dependencia (en rojo si una tarea empieza antes de que termine aquella de la que depende).
   · Tareas: se editan en la tabla de abajo (cada fila con su «Guardar»); agregar al final; «Quitar» no borra.
   · Avances: texto, si mueve el % de una tarea, y fotos o PDF.
   · Publicaciones ligadas al proyecto y «Nueva publicación de este proyecto».
   · Datos del proyecto: abren en vista, con «✏️ Editar». */
const ProyectosMk = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t == null ? '' : String(t));
  const FILA = 38; // alto de cada renglón del Gantt (px)
  let CAT = null, LISTA = [], actual = null, base = '', ocupado = false, PEST = 'gantt';
  const archivos = new Map(); // id → objectURL
  const hoyTxt = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  const fechaDe = f => new Date(f + 'T12:00:00');
  const dias = (a, b) => Math.round((fechaDe(b) - fechaDe(a)) / 864e5);
  const corta = f => fechaDe(f).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  const larga = f => fechaDe(f).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  const sumar = (f, n) => { const d = fechaDe(f); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  async function pedir(ruta, body, method = 'GET') {
    const r = await api('/marketing' + ruta, body !== undefined ? { method, body: JSON.stringify(body) } : undefined);
    const d = await r.json().catch(() => ({})); if (!r.ok) throw Error(d.error || 'No se pudo completar'); return d;
  }
  const estadoDe = p => estadoTag(p.estado); // etiqueta ya escapada
  const estadoTag = e => `<span class="py-estado py-e-${esc(e)}">${esc(CAT?.estados_proyecto[e] || e)}</span>`;
  // Empieza antes de que termine aquella de la que depende (después de un hito, el mismo día sí vale).
  const choca = (k, a) => (a.hito ? k.inicio < a.fin : k.inicio <= a.fin);
  const barra = pct => `<span class="py-barra" role="progressbar" aria-valuenow="${Number(pct)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.max(0, Math.min(100, Number(pct)))}%"></i></span>`;

  // ---------- Lista ----------
  async function cargar() {
    try {
      CAT = await Marketing.catalogos();
      if (!$('py-f-estado').dataset.listo) { $('py-f-estado').innerHTML = '<option value="">Todos los proyectos</option>' + Object.entries(CAT.estados_proyecto).map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join(''); $('py-f-estado').dataset.listo = '1'; }
      const q = new URLSearchParams({ estado: $('py-f-estado').value, q: $('py-buscar').value.trim() });
      LISTA = (await pedir('/proyectos?' + q)).proyectos;
      const hoy = hoyTxt();
      $('py-lista').innerHTML = LISTA.length ? LISTA.map(p => `<button type="button" class="py-tarjeta" data-py-abrir="${Number(p.id)}">
          <span class="py-tarjeta-cab"><b>${esc(p.nombre)}</b>${estadoDe(p)}</span>
          <span class="py-tarjeta-fechas">${esc(larga(p.inicio))} → ${esc(larga(p.fin))}${p.fin < hoy && !['terminado', 'cancelado'].includes(p.estado) ? ' · <b class="rojo">ya pasó su fin</b>' : ''}</span>
          <span class="py-tarjeta-avance">${barra(p.avance)} <b>${Number(p.avance)} %</b></span>
          <span class="py-tarjeta-datos">${Number(p.tareas_hechas)} de ${Number(p.tareas_total)} tareas${p.tareas_atrasadas ? ` · <b class="rojo">${Number(p.tareas_atrasadas)} atrasada${p.tareas_atrasadas === 1 ? '' : 's'}</b>` : ''}${p.publicaciones ? ` · 📣 ${Number(p.publicaciones)}` : ''}</span>
          ${p.proximo_hito ? `<span class="py-tarjeta-datos">◆ Próximo hito: ${esc(p.proximo_hito.titulo)} · ${esc(corta(p.proximo_hito.fin))}</span>` : ''}
          <span class="py-tarjeta-pie">${esc(p.responsable || '')} · ${esc(p.sucursal_nombre || 'Toda la empresa')}</span></button>`).join('')
        : '<p class="util-45">Aún no hay proyectos' + ($('py-f-estado').value || $('py-buscar').value ? ' con estos filtros' : '') + '.</p>';
    } catch (e) { $('py-lista').innerHTML = `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`; }
  }

  // ---------- Ventana ----------
  const CAMPOS = { nombre: 'py-nombre', objetivo: 'py-objetivo', inicio: 'py-inicio', fin: 'py-fin', estado: 'py-estado', sucursal: 'py-sucursal', responsable_id: 'py-responsable' };
  const datos = () => Object.fromEntries(Object.entries(CAMPOS).map(([k, id]) => [k, $(id).value]));
  const pendiente = () => base !== JSON.stringify(datos());
  const opcionesResp = (sel = '') => '<option value="">Sin responsable</option>' + CAT.responsables.map(u => `<option value="${Number(u.id)}"${Number(sel) === u.id ? ' selected' : ''}>${esc(u.nombre)}</option>`).join('');
  async function abrir(id) {
    try {
      if ($('overlay-proyecto').classList.contains('mostrar') && !await permitirSalida()) return;
      CAT = await Marketing.catalogos();
      actual = id ? await pedir('/proyectos/' + Number(id)) : null;
      $('py-estado').innerHTML = Object.entries(CAT.estados_proyecto).map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join('');
      $('py-sucursal').innerHTML = '<option value="empresa">Toda la empresa</option>' + CAT.sucursales.map(s => `<option value="${Number(s.id)}">${esc(s.nombre)} (${esc(s.clave)})</option>`).join('');
      $('py-responsable').innerHTML = CAT.responsables.map(u => `<option value="${Number(u.id)}">${esc(u.nombre)}</option>`).join('');
      const p = actual || { nombre: '', objetivo: '', inicio: hoyTxt(), fin: sumar(hoyTxt(), 30), estado: 'planeacion', sucursal_id: null, responsable_id: USUARIO_ACTUAL.id };
      if (p.responsable_id && !CAT.responsables.some(u => u.id === p.responsable_id)) $('py-responsable').insertAdjacentHTML('beforeend', `<option value="${Number(p.responsable_id)}">${esc(p.responsable || USUARIO_ACTUAL.nombre || 'Yo')}</option>`);
      for (const [k, idc] of Object.entries(CAMPOS)) $(idc).value = k === 'sucursal' ? (p.sucursal_id ? String(p.sucursal_id) : 'empresa') : (p[k] ?? '');
      base = JSON.stringify(datos());
      $('py-titulo').textContent = actual ? actual.nombre : 'Nuevo proyecto';
      $('py-kicker').textContent = actual ? 'PROYECTO #' + actual.id : 'NUEVO PROYECTO';
      $('py-aviso').textContent = actual ? '' : 'Nuevo · aún no guardado';
      PEST = actual ? (PEST === 'datos' ? 'gantt' : PEST) : 'datos';
      pintar();
      abrirVentana('overlay-proyecto');
      if (actual) SoloLectura.poner('#py-sec-datos', actual.puede.editar, { que: 'el proyecto', quien: 'tu rol solo consulta Marketing.' }); else SoloLectura.quitar('#py-sec-datos');
    } catch (e) { toast(e.message); }
  }
  function pintar() {
    $('py-cabeza').hidden = !actual; $('py-pestanas').hidden = !actual;
    for (const s of ['datos', 'gantt', 'avances', 'publicaciones']) $('py-sec-' + s).hidden = actual ? PEST !== s : s !== 'datos';
    document.querySelectorAll('#py-pestanas [data-py-pestana]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.pyPestana === PEST)));
    if (!actual) return;
    const hoy = hoyTxt(), atrasadas = actual.tareas.filter(t => t.avance < 100 && t.fin < hoy).length;
    $('py-cabeza').innerHTML = `<div class="py-cabeza-fila"><div>${estadoDe(actual)} <span class="etiqueta-contacto">${esc(actual.sucursal_nombre || 'Toda la empresa')}</span>
        <p class="ayuda">${esc(larga(actual.inicio))} → ${esc(larga(actual.fin))} · ${dias(actual.inicio, actual.fin) + 1} días · Responsable: <b>${esc(actual.responsable || '—')}</b></p>
        ${actual.objetivo ? `<p class="py-objetivo">🎯 ${esc(actual.objetivo)}</p>` : ''}</div>
      <div class="py-cabeza-avance"><b>${Number(actual.avance)} %</b>${barra(actual.avance)}<small>${actual.tareas.filter(t => t.avance >= 100).length} de ${actual.tareas.length} tareas${atrasadas ? ` · <span class="rojo">${atrasadas} atrasada${atrasadas === 1 ? '' : 's'}</span>` : ''}</small></div></div>`;
    gantt(); tareas(); avances(); publicaciones();
  }

  // ---------- Gantt ----------
  function gantt() {
    const t = actual.tareas, hoy = hoyTxt();
    let ini = actual.inicio, fin = actual.fin;
    for (const x of t) { if (x.inicio < ini) ini = x.inicio; if (x.fin > fin) fin = x.fin; }
    const total = dias(ini, fin) + 1, x = f => (dias(ini, f) / total) * 100, ancho = (a, b) => ((dias(a, b) + 1) / total) * 100;
    // Encabezado: meses y, debajo, el inicio de cada semana (o cada día si es corto).
    const meses = [], marcas = [];
    for (let f = ini, n = 0; f <= fin && n < 1200; f = sumar(f, 1), n++) {
      const d = fechaDe(f);
      if (f === ini || d.getDate() === 1) meses.push({ f, txt: d.toLocaleDateString('es-MX', { month: 'short', year: total > 300 ? '2-digit' : undefined }) });
      if (total <= 31 || d.getDay() === 1) marcas.push({ f, txt: String(d.getDate()) });
    }
    $('py-gantt-leyenda').innerHTML = '<span class="py-l py-l-hecha"></span> Terminada <span class="py-l py-l-curso"></span> En curso <span class="py-l py-l-atrasada"></span> Atrasada <span class="py-l py-l-futura"></span> Por empezar ◆ Hito';
    if (!t.length) { $('py-gantt').innerHTML = `<p class="util-45">Sin tareas todavía.${actual.puede.editar ? ' Agrégalas abajo: el Gantt se dibuja solo.' : ''}</p>`; return; }
    const estado = k => k.avance >= 100 ? 'hecha' : k.fin < hoy ? 'atrasada' : k.inicio <= hoy ? 'curso' : 'futura';
    const filas = t.map((k, i) => {
      const izq = x(k.inicio), w = ancho(k.inicio, k.fin), clase = estado(k);
      const barraHtml = k.hito ? `<span class="py-hito py-g-${clase}" style="left:calc(${x(k.fin) + ancho(k.fin, k.fin) / 2}% - 8px)" title="${esc(k.titulo)} · ${esc(larga(k.fin))}"></span>`
        : `<span class="py-g-barra py-g-${clase}" style="left:${izq}%;width:${w}%" title="${esc(k.titulo)} · ${esc(corta(k.inicio))} → ${esc(corta(k.fin))} · ${Number(k.avance)} %"><i style="width:${Number(k.avance)}%"></i><em>${Number(k.avance)} %</em></span>`;
      return `<div class="py-g-fila" style="height:${FILA}px"><div class="py-g-nombre" title="${esc(k.titulo)}"><b>${k.hito ? '◆ ' : ''}${esc(k.titulo)}</b><small>${esc(k.responsable || 'Sin responsable')}</small></div><div class="py-g-pista">${barraHtml}</div></div>`;
    }).join('');
    // Flechas de dependencia (SVG encima de las pistas, en % del ancho).
    const pos = new Map(t.map((k, i) => [k.id, i]));
    const flechas = t.filter(k => k.depende_de && pos.has(k.depende_de)).map(k => {
      const a = t[pos.get(k.depende_de)], ya = pos.get(a.id) * FILA + FILA / 2, yb = pos.get(k.id) * FILA + FILA / 2;
      const xe = (x(a.fin) + ancho(a.fin, a.fin)) * 10, xs = x(k.inicio) * 10, mal = choca(k, a);
      return `<path class="${mal ? 'py-dep-mal' : 'py-dep'}" d="M${xe} ${ya} H${xe + 6} V${yb} H${xs}"/>`;
    }).join('');
    const enRango = hoy >= ini && hoy <= fin;
    $('py-gantt').innerHTML = `<div class="py-g-cab"><div class="py-g-nombre"></div><div class="py-g-pista">${meses.map(m => `<span class="py-g-mes" style="left:${x(m.f)}%">${esc(m.txt)}</span>`).join('')}${marcas.map(m => `<span class="py-g-dia" style="left:${x(m.f)}%">${esc(m.txt)}</span>`).join('')}</div></div>
      <div class="py-g-cuerpo">${filas}
        <div class="py-g-capa"><div class="py-g-nombre"></div><div class="py-g-pista">${marcas.map(m => `<i class="py-g-linea" style="left:${x(m.f)}%"></i>`).join('')}${enRango ? `<i class="py-g-hoy" style="left:${x(hoy) + ancho(hoy, hoy) / 2}%" title="Hoy"></i>` : ''}
          <svg class="py-g-flechas" viewBox="0 0 1000 ${t.length * FILA}" preserveAspectRatio="none" aria-hidden="true">${flechas}</svg></div></div></div>`;
  }

  // ---------- Tareas (tabla editable) ----------
  function tareas() {
    const ed = actual.puede.editar, t = actual.tareas, hoy = hoyTxt();
    const dep = k => '<option value="">—</option>' + t.filter(o => o.id !== k?.id).map(o => `<option value="${Number(o.id)}"${k?.depende_de === o.id ? ' selected' : ''}>${esc(o.titulo)}</option>`).join('');
    const dis = ed ? '' : ' disabled';
    const fila = k => {
      const a = k && k.depende_de ? t.find(o => o.id === k.depende_de) : null, mal = a && choca(k, a);
      return `<tr data-py-tarea="${k ? Number(k.id) : 'nueva'}"${k && k.avance < 100 && k.fin < hoy ? ' class="py-t-atrasada"' : ''}>
      <td data-label="Tarea"><input class="py-t-titulo" maxlength="160" value="${esc(k?.titulo || '')}" placeholder="${k ? '' : 'Nueva tarea…'}" aria-label="Tarea"${dis}>${mal ? `<small class="rojo">⚠ Empieza antes de que termine «${esc(a.titulo)}»</small>` : ''}</td>
      <td data-label="Responsable"><select class="py-t-resp" aria-label="Responsable"${dis}>${opcionesResp(k ? k.responsable_id : USUARIO_ACTUAL.id)}</select></td>
      <td data-label="Inicio"><input type="date" class="py-t-inicio" value="${esc(k?.inicio || actual.inicio)}" aria-label="Inicio"${dis}></td>
      <td data-label="Fin"><input type="date" class="py-t-fin" value="${esc(k?.fin || sumar(k?.inicio || actual.inicio, 6))}" aria-label="Fin"${dis}></td>
      <td data-label="Avance"><input type="number" class="py-t-avance" min="0" max="100" step="5" value="${k ? Number(k.avance) : 0}" aria-label="Avance (%)"${dis}></td>
      <td data-label="Depende de"><select class="py-t-dep" aria-label="Depende de"${dis}>${dep(k)}</select></td>
      <td data-label="Hito"><input type="checkbox" class="py-t-hito"${k?.hito ? ' checked' : ''} aria-label="Es hito"${dis}></td>
      <td class="fc-acciones">${ed ? (k ? `<button type="button" class="btn btn-primario btn-chico" data-py-guardar disabled>Guardar</button><button type="button" class="btn btn-outline btn-chico" data-py-quitar aria-label="Quitar ${esc(k.titulo)}">Quitar</button>` : '<button type="button" class="btn btn-primario btn-chico" data-py-agregar>➕ Agregar</button>') : ''}</td></tr>`;
    };
    $('py-tareas').innerHTML = t.map(fila).join('') + (ed ? fila(null) : '') + (!t.length && !ed ? '<tr><td colspan="8" class="util-37">Sin tareas.</td></tr>' : '');
    $('py-av-tarea').innerHTML = '<option value="">No</option>' + t.map(k => `<option value="${Number(k.id)}">${esc(k.titulo)} (${Number(k.avance)} %)</option>`).join('');
    $('py-av-pct').disabled = true; $('py-av-pct').value = '';
  }
  const valoresFila = tr => ({ titulo: tr.querySelector('.py-t-titulo').value.trim(), responsable_id: Number(tr.querySelector('.py-t-resp').value) || null, inicio: tr.querySelector('.py-t-inicio').value, fin: tr.querySelector('.py-t-fin').value,
    avance: Number(tr.querySelector('.py-t-avance').value) || 0, depende_de: Number(tr.querySelector('.py-t-dep').value) || null, hito: tr.querySelector('.py-t-hito').checked });
  async function guardarTarea(tr) {
    if (ocupado) return; ocupado = true;
    try {
      const v = valoresFila(tr), id = tr.dataset.pyTarea;
      if (!v.titulo) throw Error('Escribe qué hay que hacer');
      if (v.hito) v.inicio = v.fin; // un hito es un día
      actual = id === 'nueva' ? await pedir('/proyectos/' + actual.id + '/tareas', v, 'POST')
        : await pedir('/tareas/' + Number(id), { ...v, version: actual.tareas.find(k => k.id === Number(id)).version }, 'PUT');
      toast(id === 'nueva' ? 'Tarea agregada' : 'Tarea guardada'); pintar(); cargar();
    } catch (e) { toast(e.message); } finally { ocupado = false; }
  }

  // ---------- Avances ----------
  async function urlArchivo(id) {
    if (archivos.has(id)) return archivos.get(id);
    let r; try { r = await api('/marketing/archivos/' + Number(id)); } catch { return ''; }
    const u = URL.createObjectURL(await r.blob()); archivos.set(id, u); return u;
  }
  function avances() {
    $('py-avances').innerHTML = actual.avances.length ? actual.avances.map(a => `<li><div class="pr-seg-cab"><b>${esc(a.usuario || '')}</b> · ${esc(fechaCorta(a.created_at))}</div><div>${esc(a.texto)}</div>
      ${a.tarea_id ? `<small class="celda-sub">📋 ${esc(a.tarea_titulo || 'Tarea')}: ${Number(a.avance_antes)} % → <b>${Number(a.avance_nuevo)} %</b></small>` : ''}
      ${a.archivos.length ? `<div class="py-adjuntos">${a.archivos.map(f => f.formato === 'pdf' ? `<button type="button" class="btn btn-outline btn-chico" data-py-pdf="${Number(f.id)}" data-nombre="${esc(f.nombre)}">📄 ${esc(f.nombre)}</button>` : `<a href="#" data-py-foto="${Number(f.id)}" title="${esc(f.nombre)}"><img alt="${esc(f.nombre)}" data-py-img="${Number(f.id)}"></a>`).join('')}</div>` : ''}</li>`).join('')
      : '<p class="util-45">Aún no hay avances.</p>';
    $('py-avances').querySelectorAll('img[data-py-img]').forEach(async img => { const u = await urlArchivo(Number(img.dataset.pyImg)); if (u) img.src = u; });
  }
  async function guardarAvance() {
    if (ocupado || !actual) return;
    const texto = $('py-av-texto').value.trim(); if (!texto) { toast('Escribe qué se avanzó'); $('py-av-texto').focus(); return; }
    const tarea = Number($('py-av-tarea').value) || null, pct = $('py-av-pct').value;
    if (tarea && pct === '') { toast('Escribe el nuevo % de la tarea'); $('py-av-pct').focus(); return; }
    ocupado = true; $('py-av-guardar').disabled = true;
    try {
      const r = await pedir('/proyectos/' + actual.id + '/avances', { texto, tarea_id: tarea, avance: tarea ? Number(pct) : undefined }, 'POST');
      actual = r;
      for (const f of [...$('py-av-archivos').files]) {
        if (f.size > 10 * 1024 * 1024) { toast(`«${f.name}» pasa de 10 MB`); continue; }
        try {
          const x = await api('/marketing/avances/' + r.avance_id + '/archivos', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Nombre': encodeURIComponent(f.name) }, body: f });
          const d = await x.json().catch(() => ({})); if (!x.ok) toast(d.error || 'No se pudo subir ' + f.name); else actual = d;
        } catch (e) { toast(`«${f.name}»: ${e.message}`); }
      }
      $('py-av-texto').value = ''; $('py-av-archivos').value = '';
      toast('Avance anotado'); pintar(); cargar();
    } catch (e) { toast(e.message); } finally { ocupado = false; $('py-av-guardar').disabled = false; }
  }

  // ---------- Publicaciones del proyecto ----------
  function publicaciones() {
    const l = actual.publicaciones_lista;
    $('py-publicaciones').innerHTML = l.length ? `<ul class="py-pubs">${l.map(p => `<li><button type="button" class="enlace" data-py-pub="${Number(p.id)}">${esc(p.titulo)}</button> · ${esc(larga(p.fecha))}${p.hora ? ' ' + esc(p.hora) : ''} · <span class="mk-estado mk-e-${esc(p.estado)}">${esc(CAT.estados[p.estado] || p.estado)}</span></li>`).join('')}</ul>`
      : '<p class="util-45">Ninguna publicación ligada todavía.</p>';
  }

  // ---------- Guardar datos ----------
  async function permitirSalida() { return !pendiente() || await solicitarDialogo({ titulo: 'Cambios sin guardar', mensaje: '¿Descartar los cambios del proyecto?', aceptar: 'Descartar cambios' }); }
  async function guardar() {
    if (ocupado) return; ocupado = true; $('py-guardar').disabled = true;
    try {
      const d = datos(), nuevo = !actual;
      const cuerpo = { ...d, responsable_id: Number(d.responsable_id) || undefined, version: actual?.version };
      actual = nuevo ? await pedir('/proyectos', cuerpo, 'POST') : await pedir('/proyectos/' + actual.id, cuerpo, 'PUT');
      base = JSON.stringify(datos());
      $('py-titulo').textContent = actual.nombre; $('py-kicker').textContent = 'PROYECTO #' + actual.id; $('py-aviso').textContent = '';
      toast(nuevo ? 'Proyecto creado: agrega sus tareas' : 'Proyecto guardado');
      if (nuevo) PEST = 'gantt';
      pintar(); SoloLectura.poner('#py-sec-datos', actual.puede.editar, { que: 'el proyecto', quien: 'tu rol solo consulta Marketing.' }); SoloLectura.bloquear('#py-sec-datos');
      cargar();
    } catch (e) { toast(e.message); $('py-aviso').textContent = e.message; } finally { ocupado = false; $('py-guardar').disabled = false; }
  }

  // ---------- Eventos ----------
  $('py-nuevo').onclick = () => abrir(null);
  $('py-f-estado').onchange = cargar; $('py-buscar').oninput = debounce(cargar, 350);
  $('py-lista').addEventListener('click', e => { const b = e.target.closest('[data-py-abrir]'); if (b) abrir(Number(b.dataset.pyAbrir)); });
  $('py-cerrar').onclick = async () => { if (!ocupado && await permitirSalida()) $('overlay-proyecto').classList.remove('mostrar'); };
  $('py-guardar').onclick = guardar;
  $('py-sec-datos').addEventListener('input', () => { if (actual) $('py-aviso').textContent = pendiente() ? 'Cambios sin guardar' : ''; });
  $('py-pestanas').addEventListener('click', e => { const b = e.target.closest('[data-py-pestana]'); if (b) { PEST = b.dataset.pyPestana; pintar(); } });
  $('py-tareas').addEventListener('input', e => { const tr = e.target.closest('tr'); const g = tr?.querySelector('[data-py-guardar]'); if (g) g.disabled = false; });
  $('py-tareas').addEventListener('change', e => {
    const tr = e.target.closest('tr'); if (!tr) return; const g = tr.querySelector('[data-py-guardar]'); if (g) g.disabled = false;
    // Al poner el inicio después del fin, el fin se recorre.
    if (e.target.classList.contains('py-t-inicio')) { const f = tr.querySelector('.py-t-fin'); if (f.value < e.target.value) f.value = e.target.value; }
  });
  $('py-tareas').addEventListener('click', async e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    if (e.target.closest('[data-py-guardar],[data-py-agregar]')) return guardarTarea(tr);
    if (e.target.closest('[data-py-quitar]')) {
      const k = actual.tareas.find(x => x.id === Number(tr.dataset.pyTarea));
      if (!await solicitarDialogo({ titulo: 'Quitar tarea', mensaje: `«${k.titulo}» deja de estar en el proyecto (queda anotado en los avances quién la quitó). Las tareas que dependían de ella quedan sueltas.`, aceptar: 'Quitar tarea' })) return;
      try { actual = await pedir('/tareas/' + k.id + '/quitar', {}, 'POST'); toast('Tarea quitada'); pintar(); cargar(); } catch (err) { toast(err.message); }
    }
  });
  $('py-tareas').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input:not([type=checkbox])')) { e.preventDefault(); guardarTarea(e.target.closest('tr')); } });
  $('py-av-tarea').onchange = () => { const k = actual?.tareas.find(x => x.id === Number($('py-av-tarea').value)); $('py-av-pct').disabled = !k; $('py-av-pct').value = k ? k.avance : ''; };
  $('py-av-guardar').onclick = guardarAvance;
  $('py-avances').addEventListener('click', async e => {
    const f = e.target.closest('[data-py-foto]'); if (f) { e.preventDefault(); const u = await urlArchivo(Number(f.dataset.pyFoto)); if (u) window.open(u, '_blank', 'noopener'); return; }
    const p = e.target.closest('[data-py-pdf]'); if (p) { const u = await urlArchivo(Number(p.dataset.pyPdf)); if (u) { const a = document.createElement('a'); a.href = u; a.download = p.dataset.nombre || 'archivo.pdf'; a.click(); } }
  });
  // Publicaciones: abren en su propia ventana; al cerrarla, el proyecto se actualiza.
  $('py-publicaciones').addEventListener('click', e => { const b = e.target.closest('[data-py-pub]'); if (b) Marketing.abrir(Number(b.dataset.pyPub)); });
  $('py-nueva-pub').onclick = () => actual && Marketing.abrir(null, actual.inicio > hoyTxt() ? actual.inicio : hoyTxt(), { proyecto_id: actual.id, sucursal_id: actual.sucursal_id });
  new MutationObserver(async () => {
    if (!$('overlay-publicacion').classList.contains('mostrar') && actual && $('overlay-proyecto').classList.contains('mostrar')) {
      try { actual = await pedir('/proyectos/' + actual.id); pintar(); } catch { /* se queda como estaba */ }
    }
  }).observe($('overlay-publicacion'), { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('beforeunload', e => { if ($('overlay-proyecto').classList.contains('mostrar') && pendiente()) { e.preventDefault(); e.returnValue = ''; } });
  return { cargar, abrir };
})();
window.ProyectosMk = ProyectosMk;
