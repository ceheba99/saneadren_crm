/* Marketing · calendario de publicaciones (2026-10-26). Ver server/marketing.js.
   Vistas Mes (cuadrícula), Semana (tarjetas con portada) y Lista. Arrastrar una publicación a otro día cambia su fecha
   (no quita la aprobación). La ventana de cada publicación: contenido (abre en vista, con «✏️ Editar»), imágenes,
   vista previa como en el celular, botones del flujo (enviar, aprobar, pedir cambios, programada, publicada, cancelar),
   comentarios con historial y versiones anteriores del texto. Las imágenes se piden con la sesión y se muestran como blob. */
const Marketing = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t == null ? '' : String(t));
  // Logotipos oficiales de cada red (public/img/redes, 2026-10-27; antes emojis).
  const LOGO = { tiktok: 'img/redes/tiktok.png', facebook: 'img/redes/facebook.png', instagram: 'img/redes/instagram.jpg', linkedin: 'img/redes/linkedin.png', spotify: 'img/redes/spotify.png' };
  const logo = (r, clase = 'mk-logo') => LOGO[r] ? `<img class="${clase}" src="${LOGO[r]}" alt="" aria-hidden="true">` : '';
  // Hasta cuántos caracteres admite el texto de cada red (para avisar antes de subirlo).
  const LIMITE = { tiktok: 2200, instagram: 2200, linkedin: 3000, facebook: 63206, spotify: 4000 };
  const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'], MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  let CAT = null, VISTA = 'mes', FECHA = null, PUBS = [], actual = null, base = '', ocupado = false, consulta = 0;
  const redesFiltro = new Set();
  const imagenes = new Map(); // id → objectURL
  try { const v = localStorage.getItem('marketing-vista'); if (['mes', 'semana', 'lista'].includes(v)) VISTA = v; else if (matchMedia('(max-width: 700px)').matches) VISTA = 'semana'; } catch { /* sin preferencias */ }
  const hoyTxt = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fechaDe = f => new Date(f + 'T12:00:00');
  const fechaLarga = f => fechaDe(f).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  const fechaCortaTxt = f => fechaDe(f).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  async function pedir(ruta, body, method = 'GET') {
    const r = await api('/marketing' + ruta, body !== undefined ? { method, body: JSON.stringify(body) } : undefined);
    const d = await r.json().catch(() => ({})); if (!r.ok) throw Error(d.error || 'No se pudo completar'); return d;
  }
  async function catalogos() { if (!CAT) CAT = await pedir(''); return CAT; }
  const estadoDe = p => estadoTag(p.estado); // etiqueta ya escapada
  const movible = p => (CAT.puede.editar && p.estado !== 'publicada' ? 'true' : 'false');
  const estadoTag = e => `<span class="mk-estado mk-e-${esc(e)}">${esc(CAT?.estados[e] || e)}</span>`;
  const redesTxt = redes => redes.map(r => `<span class="mk-red mk-r-${esc(r)}" title="${esc(CAT?.redes[r] || r)}" aria-label="${esc(CAT?.redes[r] || r)}">${logo(r)}</span>`).join('');
  async function urlImagen(id) {
    if (imagenes.has(id)) return imagenes.get(id);
    let r; try { r = await api('/marketing/imagenes/' + Number(id)); } catch { return ''; }
    const u = URL.createObjectURL(await r.blob()); imagenes.set(id, u); return u;
  }
  // Pone las imágenes cuando llegan (cada <img data-mk-img="id">).
  function cargarImagenes(cont) { cont.querySelectorAll('img[data-mk-img]').forEach(async img => { const u = await urlImagen(Number(img.dataset.mkImg)); if (u) img.src = u; }); }

  // ---------- Rango que se ve ----------
  function rango() {
    const f = fechaDe(FECHA);
    if (VISTA === 'semana') { const d = new Date(f); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const h = new Date(d); h.setDate(h.getDate() + 6); return { desde: d, hasta: h }; }
    const ini = new Date(f.getFullYear(), f.getMonth(), 1), fin = new Date(f.getFullYear(), f.getMonth() + 1, 0);
    if (VISTA === 'lista') return { desde: ini, hasta: fin };
    const desde = new Date(ini); desde.setDate(desde.getDate() - ((desde.getDay() + 6) % 7));
    const hasta = new Date(fin); hasta.setDate(hasta.getDate() + (6 - ((hasta.getDay() + 6) % 7)));
    return { desde, hasta };
  }
  function titulo() {
    const f = fechaDe(FECHA);
    if (VISTA === 'semana') { const { desde, hasta } = rango(); return `Semana del ${desde.getDate()} ${MESES[desde.getMonth()].slice(0, 3).toLowerCase()} al ${hasta.getDate()} ${MESES[hasta.getMonth()].slice(0, 3).toLowerCase()} ${hasta.getFullYear()}`; }
    return MESES[f.getMonth()] + ' ' + f.getFullYear();
  }

  async function cargar() {
    const turno = ++consulta;
    try {
      await catalogos();
      if (!FECHA) FECHA = hoyTxt();
      pintarControles();
      const { desde, hasta } = rango();
      const q = new URLSearchParams({ desde: iso(desde), hasta: iso(hasta), estado: $('mk-f-estado').value, q: $('mk-buscar').value.trim() });
      const lista = await pedir('/publicaciones?' + q);
      if (turno !== consulta) return;
      PUBS = lista.filter(p => !redesFiltro.size || p.redes.some(r => redesFiltro.has(r)));
      pintar();
    } catch (e) { $('mk-grid').innerHTML = `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`; }
  }
  function pintarControles() {
    if (!$('mk-f-estado').dataset.listo) {
      $('mk-f-estado').innerHTML = '<option value="">Todos los estados</option>' + Object.entries(CAT.estados).map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join('');
      $('mk-f-estado').dataset.listo = '1';
      $('mk-leyenda').innerHTML = Object.entries(CAT.estados).map(([k]) => estadoTag(k)).join(' ');
    }
    $('mk-redes-filtro').innerHTML = Object.entries(CAT.redes).map(([k, n]) => `<button type="button" class="mk-red-btn mk-r-${esc(k)}" data-mk-red="${esc(k)}" aria-pressed="${redesFiltro.has(k)}">${logo(k)} ${esc(n)}</button>`).join('');
    document.querySelectorAll('#vista-marketing [data-mk-vista]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mkVista === VISTA)));
    document.querySelectorAll('#vista-marketing [data-mk-estado]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mkEstado === $('mk-f-estado').value)));
    $('mk-limpiar').hidden = !($('mk-f-estado').value || $('mk-buscar').value.trim() || redesFiltro.size);
    $('mk-titulo').textContent = titulo();
    $('mk-mes').hidden = VISTA !== 'mes'; $('mk-semana').hidden = VISTA !== 'semana'; $('mk-lista').hidden = VISTA !== 'lista';
  }
  const chip = p => `<button type="button" class="cal-evento mk-chip mk-e-${esc(p.estado)}" data-mk-pub="${Number(p.id)}" draggable="${movible(p)}" title="${esc(p.titulo + ' · ' + (CAT.estados[p.estado] || ''))}">${redesTxt(p.redes)} ${p.hora ? esc(p.hora) + ' ' : ''}${esc(p.titulo)}</button>`;
  function pintar() {
    // Tarjetas: lo que hay en el rango que se ve, por estado.
    for (const k of ['revision', 'cambios', 'aprobada', 'programada', 'publicada']) $('mk-n-' + k).textContent = PUBS.filter(p => p.estado === k).length;
    const hoy = hoyTxt(), porDia = new Map();
    for (const p of PUBS) { if (!porDia.has(p.fecha)) porDia.set(p.fecha, []); porDia.get(p.fecha).push(p); }
    const { desde, hasta } = rango();
    if (VISTA === 'mes') {
      const mes = fechaDe(FECHA).getMonth(); let html = '';
      for (let d = new Date(desde); d <= hasta; d.setDate(d.getDate() + 1)) {
        const f = iso(d), l = porDia.get(f) || [];
        html += `<div class="cal-dia mk-dia${d.getMonth() !== mes ? ' fuera' : ''}${f === hoy ? ' hoy' : ''}" data-mk-dia="${f}"><div class="mk-dia-cab"><span class="cal-num">${d.getDate()}</span>${CAT.puede.editar ? `<button type="button" class="mk-mas-dia" data-mk-nueva="${f}" aria-label="Nueva publicación el ${esc(fechaLarga(f))}" title="Nueva publicación este día">+</button>` : ''}</div>
          <div class="cal-eventos">${l.slice(0, 4).map(chip).join('')}${l.length > 4 ? `<button type="button" class="cal-mas enlace" data-mk-ver-dia="${f}">+${l.length - 4} más</button>` : ''}</div></div>`;
      }
      $('mk-grid').innerHTML = html;
    } else if (VISTA === 'semana') {
      let html = '';
      for (let d = new Date(desde), i = 0; d <= hasta; d.setDate(d.getDate() + 1), i++) {
        const f = iso(d), l = porDia.get(f) || [];
        html += `<div class="mk-col${f === hoy ? ' hoy' : ''}" data-mk-dia="${f}"><div class="mk-col-cab"><span>${DIAS[i]}</span><b>${d.getDate()}</b>${CAT.puede.editar ? `<button type="button" class="mk-mas-dia" data-mk-nueva="${f}" aria-label="Nueva publicación el ${esc(fechaLarga(f))}">+</button>` : ''}</div>`
          + (l.length ? l.map(p => `<button type="button" class="mk-tarjeta mk-e-${esc(p.estado)}" data-mk-pub="${Number(p.id)}" draggable="${movible(p)}">
            ${p.portada_id ? `<img alt="" data-mk-img="${Number(p.portada_id)}">` : `<span class="mk-sin-img">${redesTxt(p.redes)}</span>`}
            <span class="mk-tarjeta-txt"><b>${esc(p.titulo)}</b><small>${p.hora ? esc(p.hora) + ' · ' : ''}${redesTxt(p.redes)}</small>${estadoDe(p)}${p.comentarios ? `<small>💬 ${Number(p.comentarios)}</small>` : ''}</span></button>`).join('') : '<span class="cal-vacio">Sin publicaciones</span>') + '</div>';
      }
      $('mk-semana').innerHTML = html; cargarImagenes($('mk-semana'));
    } else {
      $('mk-tabla').innerHTML = PUBS.length ? PUBS.map(p => `<tr data-mk-pub="${Number(p.id)}"><td data-label="Fecha">${esc(fechaCortaTxt(p.fecha))}${p.hora ? `<small class="celda-sub">${esc(p.hora)}</small>` : ''}</td>
        <td data-label="Publicación"><b>${esc(p.titulo)}</b><small class="contacto-relacion">${esc([CAT.formatos[p.formato], p.proyecto_nombre && '📁 ' + p.proyecto_nombre, p.campana].filter(Boolean).join(' · '))}</small></td>
        <td data-label="Redes">${redesTxt(p.redes)}</td><td data-label="Estado">${estadoDe(p)}</td><td data-label="Responsable">${esc(p.responsable || '')}</td>
        <td data-label="Para">${esc(p.sucursal_nombre || 'Toda la empresa')}</td></tr>`).join('') : '<tr><td colspan="6" class="util-37">No hay publicaciones este mes con estos filtros.</td></tr>';
    }
  }

  // ---------- Ventana de la publicación ----------
  const CAMPOS = { titulo: 'mk-titulo-in', formato: 'mk-formato', fecha: 'mk-fecha', hora: 'mk-hora', sucursal: 'mk-sucursal', responsable_id: 'mk-responsable', proyecto_id: 'mk-proyecto', campana: 'mk-campana', copy: 'mk-copy', hashtags: 'mk-hashtags', enlace: 'mk-enlace' };
  const redesElegidas = () => [...document.querySelectorAll('#mk-redes input:checked')].map(i => i.value);
  const datos = () => ({ ...Object.fromEntries(Object.entries(CAMPOS).map(([k, id]) => [k, $(id).value])), redes: redesElegidas() });
  const pendiente = () => base !== JSON.stringify(datos());
  function llenarSelects() {
    $('mk-formato').innerHTML = Object.entries(CAT.formatos).map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join('');
    $('mk-sucursal').innerHTML = '<option value="empresa">Toda la empresa</option>' + CAT.sucursales.map(s => `<option value="${Number(s.id)}">${esc(s.nombre)} (${esc(s.clave)})</option>`).join('');
    $('mk-responsable').innerHTML = CAT.responsables.map(u => `<option value="${Number(u.id)}">${esc(u.nombre)}</option>`).join('');
    $('mk-proyecto').innerHTML = '<option value="">Sin proyecto</option>' + CAT.proyectos.map(p => `<option value="${Number(p.id)}">${esc(p.nombre)}</option>`).join('');
    $('mk-redes').innerHTML = Object.entries(CAT.redes).map(([k, n]) => `<label class="mk-red-op mk-r-${esc(k)}"><input type="checkbox" value="${esc(k)}"> ${logo(k)} ${esc(n)}</label>`).join('');
  }
  async function abrir(id, fecha, opciones = {}) {
    try {
      if ($('overlay-publicacion').classList.contains('mostrar') && !await permitirSalida()) return;
      CAT = null; await catalogos(); llenarSelects();
      actual = id ? await pedir('/publicaciones/' + Number(id)) : null;
      const p = actual || { titulo: '', redes: [], formato: 'post', fecha: fecha || FECHA || hoyTxt(), hora: '', sucursal_id: null, responsable_id: USUARIO_ACTUAL.id, proyecto_id: opciones.proyecto_id || null, campana: '', copy: '', hashtags: '', enlace: '' };
      // Una publicación ligada a un proyecto cerrado (terminado o cancelado) lo conserva en la lista.
      if (p.proyecto_id && !CAT.proyectos.some(x => x.id === p.proyecto_id)) $('mk-proyecto').insertAdjacentHTML('beforeend', `<option value="${Number(p.proyecto_id)}">${esc(p.proyecto_nombre || 'Proyecto #' + p.proyecto_id)}</option>`);
      // Si quien abre no está en la lista de responsables (p. ej. Dirección), se agrega para poder elegirse.
      if (!CAT.responsables.some(u => u.id === p.responsable_id) && p.responsable_id) $('mk-responsable').insertAdjacentHTML('beforeend', `<option value="${Number(p.responsable_id)}">${esc(p.responsable || USUARIO_ACTUAL.nombre || 'Yo')}</option>`);
      for (const [k, idc] of Object.entries(CAMPOS)) $(idc).value = k === 'sucursal' ? (p.sucursal_id ? String(p.sucursal_id) : 'empresa') : (p[k] ?? '');
      if (!actual && opciones.sucursal_id !== undefined) $('mk-sucursal').value = opciones.sucursal_id ? String(opciones.sucursal_id) : 'empresa';
      document.querySelectorAll('#mk-redes input').forEach(i => { i.checked = p.redes.includes(i.value); });
      base = JSON.stringify(datos());
      $('mk-p-titulo').textContent = actual ? actual.titulo : 'Nueva publicación';
      $('mk-kicker').textContent = actual ? 'PUBLICACIÓN #' + actual.id + ' · ' + (CAT.estados[actual.estado] || '').toUpperCase() : 'NUEVA PUBLICACIÓN';
      pintarFicha();
      abrirVentana('overlay-publicacion');
      if (actual) SoloLectura.poner('#mk-form', actual.puede.editar, { que: 'la publicación', quien: actual.estado === 'publicada' ? 'ya está publicada: solo se comenta.' : 'tu rol solo consulta Marketing.' });
      else SoloLectura.quitar('#mk-form');
    } catch (e) { toast(e.message); }
  }
  function pintarFicha() {
    $('mk-aviso').textContent = actual ? '' : 'Nueva · aún no guardada';
    $('mk-imagenes-sec').hidden = !actual; $('mk-historial-sec').hidden = !actual;
    $('mk-subir-lbl').hidden = !actual?.puede.editar; $('mk-desde-bib').hidden = !actual?.puede.editar;
    contador(); previa();
    if (!actual) { $('mk-estado-barra').hidden = true; return; }
    // Estado y botones del flujo (según el estado y quién mira).
    const e = actual.estado, ed = actual.puede.editar, ap = actual.puede.aprobar, b = [];
    if (ed && ['borrador', 'cambios'].includes(e)) b.push(['enviar', '📨 Enviar a revisión', 'btn-primario']);
    if (ap && e === 'revision') b.push(['aprobar', '✅ Aprobar', 'btn-primario'], ['pedir_cambios', '↩️ Pedir cambios', 'btn-outline']);
    if (ap && ['aprobada', 'programada'].includes(e)) b.push(['pedir_cambios', '↩️ Pedir cambios', 'btn-outline']);
    if (ed && e === 'aprobada') b.push(['programar', '🗓️ Marcar programada', 'btn-outline']);
    if (ed && ['aprobada', 'programada'].includes(e)) b.push(['publicar', '🚀 Marcar publicada', 'btn-primario']);
    if (ed && !['publicada', 'cancelada'].includes(e)) b.push(['cancelar', 'Cancelar publicación', 'btn-outline mk-btn-cancelar']);
    if (ed && e === 'cancelada') b.push(['reabrir', 'Reabrir como borrador', 'btn-outline']);
    const quien = { revision: 'Esperando que la apruebe Dirección o el Gerente de marketing.', cambios: 'Pidieron cambios: corrígela y vuelve a enviarla.', aprobada: `Aprobada por ${actual.aprobado_por_nombre || '—'}. Súbela a la red y márcala programada o publicada.`, programada: 'Programada en la red: márcala publicada cuando salga.', publicada: 'Ya salió en la red: solo se comenta.', borrador: 'Borrador: cuando esté lista, envíala a revisión.', cancelada: 'Cancelada.' }[e];
    $('mk-estado-barra').hidden = false;
    $('mk-estado-barra').innerHTML = `<div>${estadoTag(e)} <span class="ayuda">${esc(quien)}</span>${actual.publicado_url ? ` <a href="${esc(actual.publicado_url)}" target="_blank" rel="noopener noreferrer">Ver publicación ↗</a>` : ''}</div>`
      + (b.length ? `<div class="btn-group">${b.map(([a, t, c]) => `<button type="button" class="btn ${c} btn-chico" data-mk-accion="${a}">${esc(t)}</button>`).join('')}</div>` : '');
    // Imágenes
    $('mk-imagenes').innerHTML = actual.lista_imagenes.length ? actual.lista_imagenes.map((i, n) => `<figure class="mk-img"><a href="#" data-mk-ampliar="${Number(i.id)}" title="Ver grande"><img alt="${esc(i.nombre)}" data-mk-img="${Number(i.id)}"></a><figcaption>${n === 0 ? '<b>Portada</b> · ' : ''}${esc(i.nombre)}</figcaption>${ed ? `<button type="button" class="mk-img-quitar" data-mk-quitar="${Number(i.id)}" aria-label="Quitar ${esc(i.nombre)}">✕</button>` : ''}</figure>`).join('') : '<p class="util-45">Sin imágenes.</p>';
    cargarImagenes($('mk-imagenes'));
    // Historial
    const tipo = { comentario: '💬', estado: '•', cambios: '↩️', aprobada: '✅' };
    $('mk-historial').innerHTML = actual.historial.map(h => `<li class="mk-h-${esc(h.tipo)}"><div class="pr-seg-cab">${tipo[h.tipo] || ''} <b>${esc(h.usuario || '')}</b> · ${esc(fechaCorta(h.created_at))}</div><div>${esc(h.texto)}</div></li>`).join('');
    $('mk-versiones-det').hidden = !actual.versiones.length;
    $('mk-versiones').innerHTML = actual.versiones.map(v => `<div class="mk-version"><div class="pr-seg-cab">${esc(fechaCorta(v.created_at))} · ${esc(v.usuario || '')} · ${esc(v.titulo || '')}</div><pre>${esc(v.copy || '(sin copy)')}</pre>${v.hashtags ? `<small>${esc(v.hashtags)}</small>` : ''}</div>`).join('');
  }
  // Cuántos caracteres lleva y si pasa lo que admite alguna de las redes elegidas.
  function contador() {
    const n = $('mk-copy').value.length, pasa = redesElegidas().filter(r => n > LIMITE[r]);
    $('mk-contador').textContent = n.toLocaleString('es-MX') + ' caracteres' + (pasa.length ? ' · ⚠ ' + pasa.map(r => `${CAT.redes[r]} admite ${LIMITE[r].toLocaleString('es-MX')}`).join(', ') : '');
    $('mk-contador').classList.toggle('rojo', !!pasa.length);
  }
  // Vista previa: así se vería en el celular (la portada, el texto y los hashtags).
  function previa() {
    const d = datos(), portada = actual?.lista_imagenes?.[0];
    $('mk-previa').innerHTML = `<div class="mk-tel"><div class="mk-tel-cab"><span class="mk-tel-av">S</span><b>Saneadren</b><span>${redesTxt(d.redes)}</span></div>
      ${portada ? `<img alt="Portada" data-mk-img="${Number(portada.id)}">` : d.enlace ? `<div class="mk-tel-enlace">🔗 ${esc(d.enlace)}</div>` : '<div class="mk-tel-vacia">Sin imagen</div>'}
      ${actual?.lista_imagenes?.length > 1 ? `<div class="mk-tel-puntos">${actual.lista_imagenes.map((_, i) => `<i class="${i ? '' : 'activo'}"></i>`).join('')}</div>` : ''}
      <div class="mk-tel-txt"><b>Saneadren</b> ${esc(d.copy) || '<span class="util-45">Sin copy</span>'}${d.hashtags ? `<div class="mk-tel-hash">${esc(d.hashtags)}</div>` : ''}</div>
      <div class="mk-tel-pie">${d.fecha ? esc(fechaLarga(d.fecha)) : ''}${d.hora ? ' · ' + esc(d.hora) : ''}</div></div>`;
    cargarImagenes($('mk-previa'));
  }
  async function permitirSalida() { return !pendiente() || await solicitarDialogo({ titulo: 'Cambios sin guardar', mensaje: '¿Descartar los cambios de la publicación?', aceptar: 'Descartar cambios' }); }
  async function guardar() {
    if (ocupado) return; ocupado = true; $('mk-guardar').disabled = true;
    try {
      const d = datos(); if (!$('mk-enlace').checkValidity()) throw Error('El enlace debe empezar con https://');
      const cuerpo = { ...d, responsable_id: Number(d.responsable_id) || undefined, proyecto_id: Number(d.proyecto_id) || null, version: actual?.version };
      const antes = actual?.estado;
      actual = actual ? await pedir('/publicaciones/' + actual.id, cuerpo, 'PUT') : await pedir('/publicaciones', cuerpo, 'POST');
      base = JSON.stringify(datos());
      toast(antes && ['aprobada', 'programada'].includes(antes) && actual.estado === 'borrador' ? 'Guardada. Cambió el contenido: regresó a borrador y hay que enviarla a revisión otra vez.' : 'Publicación guardada');
      $('mk-p-titulo').textContent = actual.titulo; $('mk-kicker').textContent = 'PUBLICACIÓN #' + actual.id + ' · ' + (CAT.estados[actual.estado] || '').toUpperCase();
      pintarFicha(); SoloLectura.poner('#mk-form', actual.puede.editar, { que: 'la publicación', quien: 'tu rol solo consulta Marketing.' }); SoloLectura.bloquear('#mk-form');
      cargar();
    } catch (e) { toast(e.message); $('mk-aviso').textContent = e.message; } finally { ocupado = false; $('mk-guardar').disabled = false; }
  }
  async function accion(a) {
    if (ocupado || !actual) return;
    if (pendiente()) { toast('Primero guarda o descarta los cambios del contenido'); return; }
    const cuerpo = { accion: a, version: actual.version };
    if (a === 'pedir_cambios' || a === 'cancelar') {
      const t = await solicitarDialogo({ titulo: a === 'cancelar' ? 'Cancelar publicación' : 'Pedir cambios', mensaje: a === 'cancelar' ? 'Queda en el historial; se puede reabrir después.' : 'Le llega a quien la hizo, en Inicio.', aceptar: a === 'cancelar' ? 'Cancelar publicación' : 'Pedir cambios', campo: { etiqueta: a === 'cancelar' ? '¿Por qué se cancela?' : '¿Qué hay que cambiar?', requerido: 'Escríbelo para que quede claro' } });
      if (!t) return; cuerpo.comentario = t;
    }
    if (a === 'publicar') {
      // El enlace es opcional: aceptar con el campo vacío también vale (y cancelar no marca nada).
      const promesa = solicitarDialogo({ titulo: 'Marcar publicada', mensaje: 'Si ya salió, pega el enlace de la publicación (opcional).', aceptar: 'Marcar publicada', campo: { tipo: 'url', etiqueta: 'Enlace (https://…)' } });
      let acepto = false; const btn = document.getElementById('dialogo-aceptar'), marcar = () => { acepto = true; };
      btn.addEventListener('click', marcar);
      const u = await promesa; btn.removeEventListener('click', marcar);
      if (!acepto) return;
      cuerpo.url = u || '';
    }
    ocupado = true;
    try { actual = await pedir('/publicaciones/' + actual.id + '/estado', cuerpo, 'POST'); $('mk-kicker').textContent = 'PUBLICACIÓN #' + actual.id + ' · ' + (CAT.estados[actual.estado] || '').toUpperCase(); pintarFicha(); SoloLectura.poner('#mk-form', actual.puede.editar, { que: 'la publicación', quien: actual.estado === 'publicada' ? 'ya está publicada: solo se comenta.' : 'tu rol solo consulta Marketing.' }); toast({ enviar: 'Enviada a revisión', aprobar: 'Aprobada', pedir_cambios: 'Se pidieron cambios', programar: 'Marcada como programada', publicar: 'Marcada como publicada', cancelar: 'Cancelada', reabrir: 'Reabierta como borrador' }[a]); cargar(); pintarInicio(); }
    catch (e) { toast(e.message); } finally { ocupado = false; }
  }
  async function subir(archivos) {
    if (!actual || !archivos.length) return;
    for (const f of archivos) {
      if (f.size > 10 * 1024 * 1024) { toast(`«${f.name}» pasa de 10 MB`); continue; }
      try {
        const r = await api('/marketing/publicaciones/' + actual.id + '/imagenes', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Nombre': encodeURIComponent(f.name) }, body: f });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { toast(d.error || 'No se pudo subir ' + f.name); continue; }
        actual = d;
      } catch (e) { toast(`«${f.name}»: ${e.message}`); }
    }
    pintarFicha(); cargar();
  }

  // ---------- Bloque de Inicio ----------
  async function pintarInicio() {
    const cont = $('inicio-marketing'); if (!cont || !Permisos.puede('marketing.ver')) return;
    cont.innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    let l; try { l = await pedir('/pendientes'); } catch (e) { cont.innerHTML = `<div class="aviso-error-carga" role="alert"><p>${esc(e.message)}</p></div>`; return; }
    const hoy = hoyTxt(), MOT = { aprobar: ['alerta', '✅ Por aprobar'], cambios: ['rojo', '↩️ Te pidieron cambios'], publicar: ['rojo', '🚀 Ya toca subirla'], enviar: ['alerta', '📨 Falta enviarla a revisión'], tarea: ['alerta', '📋 Tarea por terminar'] };
    cont.innerHTML = l.length ? l.map(p => {
      const [clase, motivo] = MOT[p.motivo], esTarea = p.motivo === 'tarea';
      // Una tarea de proyecto dice de qué proyecto es y abre el proyecto; una publicación, sus redes y abre la publicación.
      const detalle = esTarea ? '📁 ' + esc(p.proyecto_nombre) + ' · ' + Number(p.avance) + ' %' : redesTxt(p.redes);
      const cuando = esTarea ? (p.fecha < hoy ? 'Venció el ' : 'Vence el ') : '';
      const abrirAttr = esTarea ? `data-py-inicio="${Number(p.proyecto_id)}"` : `data-mk-inicio="${Number(p.id)}"`;
      return `<div class="fila-alerta ${['publicar', 'tarea'].includes(p.motivo) && p.fecha < hoy ? 'vencido' : 'tipo-alerta'}"><div class="info"><span class="tipo-tag ${clase}">${motivo}</span>
      <div><b>${esc(p.titulo)}</b> · ${detalle}</div><div class="fecha">${cuando}${esc(fechaCortaTxt(p.fecha))}${p.hora ? ' · ' + esc(p.hora) : ''} · ${esc(p.responsable || '')}</div></div>
      <div class="util-46"><button type="button" class="btn btn-outline" ${abrirAttr}>Abrir</button></div></div>`; }).join('') : '<p class="util-45">Nada pendiente en Marketing. 🎉</p>';
  }

  // ---------- Eventos ----------
  $('mk-nueva').onclick = () => abrir(null);
  $('mk-ant').onclick = () => mover(-1); $('mk-sig').onclick = () => mover(1); $('mk-hoy').onclick = () => { FECHA = hoyTxt(); cargar(); };
  function mover(n) { const f = fechaDe(FECHA); if (VISTA === 'semana') f.setDate(f.getDate() + 7 * n); else f.setMonth(f.getMonth() + n, 1); FECHA = iso(f); cargar(); }
  document.querySelectorAll('#vista-marketing [data-mk-vista]').forEach(b => b.addEventListener('click', () => { VISTA = b.dataset.mkVista; try { localStorage.setItem('marketing-vista', VISTA); } catch { /* */ } cargar(); }));
  $('mk-f-estado').onchange = cargar; $('mk-buscar').oninput = debounce(cargar, 350);
  $('mk-limpiar').onclick = () => { $('mk-f-estado').value = ''; $('mk-buscar').value = ''; redesFiltro.clear(); cargar(); };
  $('vista-marketing').addEventListener('click', e => {
    const red = e.target.closest('[data-mk-red]'); if (red) { const k = red.dataset.mkRed; redesFiltro.has(k) ? redesFiltro.delete(k) : redesFiltro.add(k); cargar(); return; }
    const est = e.target.closest('[data-mk-estado]'); if (est) { $('mk-f-estado').value = $('mk-f-estado').value === est.dataset.mkEstado ? '' : est.dataset.mkEstado; cargar(); return; }
    const nueva = e.target.closest('[data-mk-nueva]'); if (nueva) { abrir(null, nueva.dataset.mkNueva); return; }
    const verDia = e.target.closest('[data-mk-ver-dia]'); if (verDia) { FECHA = verDia.dataset.mkVerDia; VISTA = 'semana'; cargar(); return; }
    const pub = e.target.closest('[data-mk-pub]'); if (pub) abrir(Number(pub.dataset.mkPub));
  });
  // Arrastrar a otro día: cambia la fecha (no la aprobación).
  $('vista-marketing').addEventListener('dragstart', e => { const p = e.target.closest('[data-mk-pub]'); if (p) { e.dataTransfer.setData('text/plain', p.dataset.mkPub); e.dataTransfer.effectAllowed = 'move'; } });
  $('vista-marketing').addEventListener('dragover', e => { const d = e.target.closest('[data-mk-dia]'); if (d && CAT?.puede.editar) { e.preventDefault(); d.classList.add('mk-soltar'); } });
  $('vista-marketing').addEventListener('dragleave', e => { e.target.closest('[data-mk-dia]')?.classList.remove('mk-soltar'); });
  $('vista-marketing').addEventListener('drop', async e => {
    const d = e.target.closest('[data-mk-dia]'); if (!d) return; e.preventDefault(); d.classList.remove('mk-soltar');
    const id = Number(e.dataTransfer.getData('text/plain')), p = PUBS.find(x => x.id === id); if (!p || p.fecha === d.dataset.mkDia) return;
    try { await pedir('/publicaciones/' + id, { version: p.version, fecha: d.dataset.mkDia }, 'PUT'); toast(`«${p.titulo}» pasó al ${fechaLarga(d.dataset.mkDia)}`); cargar(); } catch (err) { toast(err.message); cargar(); }
  });
  $('mk-cerrar').onclick = async () => { if (!ocupado && await permitirSalida()) $('overlay-publicacion').classList.remove('mostrar'); };
  $('mk-guardar').onclick = guardar;
  $('mk-copy').addEventListener('input', () => { contador(); previa(); });
  $('mk-form').addEventListener('input', () => { if (actual) $('mk-aviso').textContent = pendiente() ? 'Cambios sin guardar' : ''; previa(); });
  $('mk-redes').addEventListener('change', () => { contador(); previa(); });
  $('mk-estado-barra').addEventListener('click', e => { const b = e.target.closest('[data-mk-accion]'); if (b) accion(b.dataset.mkAccion); });
  $('mk-subir').addEventListener('change', e => { subir([...e.target.files]); e.target.value = ''; });
  $('mk-desde-bib').onclick = () => actual && window.BibliotecaMk?.elegir(actual.id, d => { actual = d; pintarFicha(); cargar(); });
  $('mk-imagenes').addEventListener('click', async e => {
    const q = e.target.closest('[data-mk-quitar]');
    if (q) { if (!await solicitarDialogo({ titulo: 'Quitar imagen', mensaje: 'La imagen deja de estar en la publicación (queda en el historial quién la quitó).' + (['aprobada', 'programada'].includes(actual.estado) ? ' Como ya está aprobada, regresará a borrador.' : ''), aceptar: 'Quitar' })) return;
      try { actual = await pedir('/imagenes/' + Number(q.dataset.mkQuitar) + '/quitar', {}, 'POST'); pintarFicha(); cargar(); } catch (err) { toast(err.message); } return; }
    const a = e.target.closest('[data-mk-ampliar]'); if (a) { e.preventDefault(); const u = await urlImagen(Number(a.dataset.mkAmpliar)); if (u) window.open(u, '_blank', 'noopener'); }
  });
  $('mk-comentar').onclick = async () => {
    const t = $('mk-comentario').value.trim(); if (!t) { toast('Escribe el comentario'); return; }
    try { actual = await pedir('/publicaciones/' + actual.id + '/comentarios', { texto: t }, 'POST'); $('mk-comentario').value = ''; pintarFicha(); } catch (e) { toast(e.message); }
  };
  $('inicio-marketing')?.addEventListener('click', e => { const b = e.target.closest('[data-mk-inicio]'); if (b) abrir(Number(b.dataset.mkInicio)); const py = e.target.closest('[data-py-inicio]'); if (py) window.ProyectosMk?.abrir(Number(py.dataset.pyInicio)); });
  // Pestañas: Calendario y Proyectos (se recuerda la última).
  let PESTANA = 'calendario';
  try { const g = localStorage.getItem('marketing-pestana'); if (['proyectos', 'ideas', 'biblioteca'].includes(g)) PESTANA = g; } catch { /* */ }
  function pestana(p) {
    PESTANA = p; try { localStorage.setItem('marketing-pestana', p); } catch { /* */ }
    document.querySelectorAll('#vista-marketing > .mk-pestanas [data-mk-pestana]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mkPestana === p)));
    for (const t of ['calendario', 'proyectos', 'ideas', 'biblioteca']) $('mk-tab-' + t).hidden = p !== t;
    if (p === 'proyectos') window.ProyectosMk?.cargar(); else if (p === 'ideas') window.IdeasMk?.cargar(); else if (p === 'biblioteca') window.BibliotecaMk?.cargar(); else cargar();
  }
  document.querySelectorAll('#vista-marketing > .mk-pestanas [data-mk-pestana]').forEach(b => b.addEventListener('click', () => pestana(b.dataset.mkPestana)));
  window.addEventListener('beforeunload', e => { if ($('overlay-publicacion').classList.contains('mostrar') && pendiente()) { e.preventDefault(); e.returnValue = ''; } });
  return { redesHtml: redes => redesTxt(redes), logo, pestana, cargar: () => pestana(PESTANA), cargarCalendario: cargar, abrir, pintarInicio, catalogos: async () => { CAT = null; return catalogos(); } };
})();
window.Marketing = Marketing;
