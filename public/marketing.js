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
  // Texto propio de cada red (2026-10-27): {red: texto}; la red sin texto propio usa el copy base. PREVIA_RED: la red que se ve en la vista previa.
  let TEXTOS = {}, PREVIA_RED = null;
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
  // Antes de subir una imagen (2026-10-27): si mide más de 2048 px por lado o pesa más de 700 KB, el navegador la ajusta a
  // 2048 px y la comprime (JPG se queda JPG; PNG y WebP pasan a WebP, que conserva la transparencia). Una foto de celular de
  // 6–8 MB queda en unos cientos de KB sin diferencia visible en redes. Los GIF (pueden ser animados) se suben tal cual, y si
  // el resultado no pesa menos, se sube el original.
  const LADO_MAX = 2048, PESO_OK = 700 * 1024;
  async function reducir(f) {
    if (!/^image\/(jpeg|png|webp)$/.test(f.type) || typeof createImageBitmap !== 'function') return f;
    try {
      const bmp = await createImageBitmap(f), k = Math.min(1, LADO_MAX / Math.max(bmp.width, bmp.height));
      if (k === 1 && f.size <= PESO_OK) { bmp.close?.(); return f; }
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
      const blob = await new Promise(r => c.toBlob(r, f.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp', 0.85));
      if (!blob || blob.size >= f.size) return f;
      const ext = { 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/png': '.png' }[blob.type] || '';
      return new File([blob], f.name.replace(/\.[^.]+$/, '') + ext, { type: blob.type });
    } catch { return f; }
  }
  const pesoTxt = b => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
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
      pintar(); window.RevisionMk?.contar();
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
  const chip = p => `<button type="button" class="cal-evento mk-chip mk-e-${esc(p.estado)}" data-mk-pub="${Number(p.id)}" draggable="${movible(p)}" aria-label="${esc(p.titulo + ' · ' + (CAT.estados[p.estado] || ''))}"><span class="mk-chip-redes">${redesTxt(p.redes)}</span>${p.hora ? `<span class="mk-chip-hora">${esc(p.hora)}</span>` : ''}${p.imagenes ? '<span class="mk-chip-img" aria-hidden="true">🖼</span>' : ''}<span class="mk-chip-txt">${esc(p.titulo)}</span></button>`;
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
        html += `<div class="cal-dia mk-dia${d.getMonth() !== mes ? ' fuera' : ''}${f === hoy ? ' hoy' : ''}${[0, 6].includes(d.getDay()) ? ' mk-finde' : ''}${f < hoy ? ' mk-pasado' : ''}" data-mk-dia="${f}"><div class="mk-dia-cab"><span class="cal-num">${d.getDate()}</span>${f === hoy ? '<span class="mk-hoy-tag">Hoy</span>' : ''}${CAT.puede.editar ? `<button type="button" class="mk-mas-dia" data-mk-nueva="${f}" aria-label="Nueva publicación el ${esc(fechaLarga(f))}" title="Nueva publicación este día">+</button>` : ''}</div>
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
  const textosLimpios = () => { const r = redesElegidas(); return Object.fromEntries(Object.keys(CAT?.redes || {}).filter(k => r.includes(k) && TEXTOS[k] !== undefined && TEXTOS[k].trim()).map(k => [k, TEXTOS[k]])); };
  const datos = () => ({ ...Object.fromEntries(Object.entries(CAMPOS).map(([k, id]) => [k, $(id).value])), redes: redesElegidas(), copy_redes: textosLimpios() });
  const textoDe = (d, red) => (d.copy_redes[red] !== undefined ? d.copy_redes[red] : d.copy);
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
      const p = actual || { titulo: '', redes: [], copy_redes: {}, formato: 'post', fecha: fecha || FECHA || hoyTxt(), hora: '', sucursal_id: null, responsable_id: USUARIO_ACTUAL.id, proyecto_id: opciones.proyecto_id || null, campana: '', copy: '', hashtags: '', enlace: '' };
      // Una publicación ligada a un proyecto cerrado (terminado o cancelado) lo conserva en la lista.
      if (p.proyecto_id && !CAT.proyectos.some(x => x.id === p.proyecto_id)) $('mk-proyecto').insertAdjacentHTML('beforeend', `<option value="${Number(p.proyecto_id)}">${esc(p.proyecto_nombre || 'Proyecto #' + p.proyecto_id)}</option>`);
      // Si quien abre no está en la lista de responsables (p. ej. Dirección), se agrega para poder elegirse.
      if (!CAT.responsables.some(u => u.id === p.responsable_id) && p.responsable_id) $('mk-responsable').insertAdjacentHTML('beforeend', `<option value="${Number(p.responsable_id)}">${esc(p.responsable || USUARIO_ACTUAL.nombre || 'Yo')}</option>`);
      for (const [k, idc] of Object.entries(CAMPOS)) $(idc).value = k === 'sucursal' ? (p.sucursal_id ? String(p.sucursal_id) : 'empresa') : (p[k] ?? '');
      if (!actual && opciones.sucursal_id !== undefined) $('mk-sucursal').value = opciones.sucursal_id ? String(opciones.sucursal_id) : 'empresa';
      document.querySelectorAll('#mk-redes input').forEach(i => { i.checked = p.redes.includes(i.value); });
      TEXTOS = { ...(p.copy_redes || {}) }; PREVIA_RED = null; pintarTextos();
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
    const L = actual.lista_imagenes, varias = ed && L.length > 1;
    $('mk-imagenes').innerHTML = L.length ? L.map((i, n) => `<figure class="mk-img${n === 0 ? ' mk-portada' : ''}" data-mk-fig="${Number(i.id)}"${varias ? ' draggable="true"' : ''}><a href="#" data-mk-ampliar="${Number(i.id)}" title="Ver grande"><img alt="${esc(i.nombre)}" data-mk-img="${Number(i.id)}"></a>
      <span class="mk-img-num">${n === 0 ? '★ Portada' : n + 1}</span><figcaption>${esc(i.nombre)}</figcaption>
      ${ed ? `<button type="button" class="mk-img-quitar" data-mk-quitar="${Number(i.id)}" aria-label="Quitar ${esc(i.nombre)}">✕</button>` : ''}
      ${varias ? `<div class="mk-img-acc"><button type="button" data-mk-mover="${Number(i.id)}" data-dir="-1" aria-label="Mover antes"${n === 0 ? ' disabled' : ''}>◀</button>${n ? `<button type="button" data-mk-portada="${Number(i.id)}" title="Hacerla portada">★</button>` : ''}<button type="button" data-mk-mover="${Number(i.id)}" data-dir="1" aria-label="Mover después"${n === L.length - 1 ? ' disabled' : ''}>▶</button></div>` : ''}</figure>`).join('') : '<p class="util-45">Sin imágenes.</p>';
    $('mk-imagenes-ayuda').textContent = varias ? 'Arrastra las imágenes (o usa ◀ ▶ y ★) para cambiar el orden del carrusel y la portada.' : '';
    pintarMetricas();
    cargarImagenes($('mk-imagenes'));
    // Historial
    const tipo = { comentario: '💬', estado: '•', cambios: '↩️', aprobada: '✅' };
    $('mk-historial').innerHTML = actual.historial.map(h => `<li class="mk-h-${esc(h.tipo)}"><div class="pr-seg-cab">${tipo[h.tipo] || ''} <b>${esc(h.usuario || 'Sistema')}</b> · ${esc(fechaCorta(h.created_at))}</div><div>${esc(h.texto)}</div></li>`).join('');
    $('mk-versiones-det').hidden = !actual.versiones.length;
    $('mk-versiones').innerHTML = actual.versiones.map(v => `<div class="mk-version"><div class="pr-seg-cab">${esc(fechaCorta(v.created_at))} · ${esc(v.usuario || '')} · ${esc(v.titulo || '')}</div><pre>${esc(v.copy || '(sin copy)')}</pre>${textosVersion(v)}${v.hashtags ? `<small>${esc(v.hashtags)}</small>` : ''}</div>`).join('');
  }
  // Cuántos caracteres lleva y si pasa lo que admite alguna de las redes elegidas.
  function contador() {
    // El texto base solo cuenta para las redes que no tienen el suyo.
    const n = $('mk-copy').value.length, pasa = redesElegidas().filter(r => TEXTOS[r] === undefined && n > LIMITE[r]);
    document.querySelectorAll('#mk-copy-redes [data-mk-texto]').forEach(t => { const r = t.dataset.mkTexto, c = t.value.length, el = $('mk-cont-' + r); if (!el) return;
      el.textContent = c.toLocaleString('es-MX') + ' de ' + LIMITE[r].toLocaleString('es-MX') + ' caracteres' + (c > LIMITE[r] ? ' · ⚠ pasa el límite de ' + CAT.redes[r] : ''); el.classList.toggle('rojo', c > LIMITE[r]); });
    $('mk-contador').textContent = n.toLocaleString('es-MX') + ' caracteres' + (pasa.length ? ' · ⚠ ' + pasa.map(r => `${CAT.redes[r]} admite ${LIMITE[r].toLocaleString('es-MX')}`).join(', ') : '');
    $('mk-contador').classList.toggle('rojo', !!pasa.length);
  }
  // Vista previa: así se vería en el celular (la portada, el texto y los hashtags).
  function previa() {
    const d = datos(), portada = actual?.lista_imagenes?.[0];
    if (!d.redes.includes(PREVIA_RED)) PREVIA_RED = d.redes[0] || null;
    const red = PREVIA_RED, txt = red ? textoDe(d, red) : d.copy;
    const pestanas = d.redes.length > 1 ? `<div class="mk-previa-redes" role="group" aria-label="Ver como se ve en">${d.redes.map(r => `<button type="button" data-mk-previa-red="${esc(r)}" aria-pressed="${r === red}" title="${esc(CAT.redes[r])}">${logo(r)}${d.copy_redes[r] !== undefined ? '<i class="mk-propio" title="Texto propio"></i>' : ''}</button>`).join('')}</div>` : '';
    $('mk-previa').innerHTML = `${pestanas}<div class="mk-tel mk-tel-${esc(red || 'base')}"><div class="mk-tel-cab"><span class="mk-tel-av">S</span><b>Saneadren</b><span>${red ? logo(red) + ' ' + esc(CAT.redes[red]) : ''}</span></div>
      ${portada ? `<img alt="Portada" data-mk-img="${Number(portada.id)}">` : d.enlace ? `<div class="mk-tel-enlace">🔗 ${esc(d.enlace)}</div>` : '<div class="mk-tel-vacia">Sin imagen</div>'}
      ${actual?.lista_imagenes?.length > 1 ? `<div class="mk-tel-puntos">${actual.lista_imagenes.map((_, i) => `<i class="${i ? '' : 'activo'}"></i>`).join('')}</div>` : ''}
      <div class="mk-tel-txt"><b>Saneadren</b> ${esc(txt) || '<span class="util-45">Sin copy</span>'}${d.hashtags ? `<div class="mk-tel-hash">${esc(d.hashtags)}</div>` : ''}</div>
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
      const t = await solicitarDialogo({ titulo: a === 'cancelar' ? 'Cancelar publicación' : 'Pedir cambios', mensaje: a === 'cancelar' ? 'Queda en el historial; se puede reabrir después. Sus imágenes se borran a los 60 días de cancelada para liberar espacio.' : 'Le llega a quien la hizo, en Inicio.', aceptar: a === 'cancelar' ? 'Cancelar publicación' : 'Pedir cambios', campo: { etiqueta: a === 'cancelar' ? '¿Por qué se cancela?' : '¿Qué hay que cambiar?', requerido: 'Escríbelo para que quede claro' } });
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
  // ---------- Texto propio por red ----------
  function pintarTextos() {
    const r = redesElegidas();
    $('mk-copy-redes').innerHTML = r.length ? r.map(k => TEXTOS[k] !== undefined
      ? `<div class="mk-texto-red"><div class="mk-texto-cab">${logo(k)} <b>${esc(CAT.redes[k])}</b> <span class="ayuda">texto propio</span><button type="button" class="enlace" data-mk-texto-quitar="${esc(k)}">Usar el texto base</button></div>
        <label class="sr-only" for="mk-texto-${esc(k)}">Texto para ${esc(CAT.redes[k])}</label><textarea id="mk-texto-${esc(k)}" rows="4" maxlength="5000" data-mk-texto="${esc(k)}">${esc(TEXTOS[k])}</textarea><small class="mk-contador" id="mk-cont-${esc(k)}" aria-live="polite"></small></div>`
      : `<div class="mk-texto-red mk-texto-base">${logo(k)} <b>${esc(CAT.redes[k])}</b> <span class="ayuda">usa el texto base</span><button type="button" class="btn btn-outline btn-chico" data-mk-texto-ajustar="${esc(k)}">✏️ Ajustar para ${esc(CAT.redes[k])}</button></div>`).join('') : '';
    contador();
  }
  const textosVersion = v => Object.entries(v.copy_redes || {}).map(([k, t]) => `<div class="mk-version-red">${logo(k)} <b>${esc(CAT.redes[k] || k)}:</b><pre>${esc(t)}</pre></div>`).join('');

  // ---------- Orden de las imágenes ----------
  async function ordenar(ids) {
    if (!actual || ocupado) return;
    if (['aprobada', 'programada'].includes(actual.estado) && !await solicitarDialogo({ titulo: 'Cambiar el orden', mensaje: 'El orden del carrusel es parte del contenido: como ya está aprobada, regresará a borrador y habrá que enviarla a revisión otra vez.', aceptar: 'Cambiar el orden' })) return;
    ocupado = true;
    try { actual = await pedir('/publicaciones/' + actual.id + '/imagenes/orden', { ids, version: actual.version }, 'PUT'); pintarFicha(); cargar(); } catch (e) { toast(e.message); } finally { ocupado = false; }
  }
  const idsImagenes = () => actual.lista_imagenes.map(i => i.id);

  // ---------- Resultados de la publicación (cuando ya salió) ----------
  const numTxt = v => (v == null ? '—' : Number(v).toLocaleString('es-MX'));
  function pintarMetricas() {
    const sec = $('mk-metricas-sec'), ver = actual?.estado === 'publicada'; sec.hidden = !ver; if (!ver) return;
    const ed = CAT.puede.editar, M = CAT.metricas, porRed = Object.fromEntries((actual.metricas || []).map(m => [m.red, m]));
    $('mk-metricas').innerHTML = actual.redes.map(r => {
      const m = porRed[r] || {}, inter = CAT.interacciones.reduce((a, k) => a + (m[k] || 0), 0), tasa = m.alcance ? Math.round((inter / m.alcance) * 1000) / 10 : null;
      const resumen = m.id ? `<span class="mk-met-res"><b>${numTxt(inter)}</b> interacciones${tasa != null ? ` · <b>${tasa.toLocaleString('es-MX')} %</b> del alcance` : ''}</span>` : '<span class="ayuda">Sin capturar</span>';
      const campos = Object.entries(M).map(([k, n]) => ed
        ? `<label class="mk-met-campo"><span>${esc(n)}</span><input type="number" min="0" step="1" inputmode="numeric" data-mk-met="${esc(k)}" value="${m[k] ?? ''}"></label>`
        : `<div class="mk-met-campo"><span>${esc(n)}</span><b>${numTxt(m[k])}</b></div>`).join('');
      const enlace = ed ? `<label class="mk-met-enlace"><span>Enlace de la publicación en ${esc(CAT.redes[r])}</span><input type="url" maxlength="500" data-mk-met-enlace value="${esc(m.enlace || '')}" placeholder="https://"></label>`
        : (m.enlace ? `<a href="${esc(m.enlace)}" target="_blank" rel="noopener noreferrer">Ver en ${esc(CAT.redes[r])} ↗</a>` : '');
      const quien = m.id ? `<small class="ayuda">Capturó ${esc(m.capturado_por_nombre || '—')} · ${esc(fechaCorta(m.updated_at))}</small>` : '';
      return `<div class="mk-met-red" data-mk-met-red="${esc(r)}"><div class="mk-met-cab">${logo(r)} <b>${esc(CAT.redes[r])}</b> ${resumen}</div><div class="mk-met-grid">${campos}</div>${enlace}
        <div class="mk-met-pie">${quien}${ed ? '<button type="button" class="btn btn-primario btn-chico" data-mk-met-guardar>Guardar resultados</button>' : ''}</div></div>`;
    }).join('');
  }
  async function guardarMetricas(caja) {
    if (ocupado) return;
    const valores = Object.fromEntries([...caja.querySelectorAll('[data-mk-met]')].map(i => [i.dataset.mkMet, i.value === '' ? null : i.value]));
    ocupado = true;
    try { actual = await pedir('/publicaciones/' + actual.id + '/metricas', { red: caja.dataset.mkMetRed, valores, enlace: caja.querySelector('[data-mk-met-enlace]')?.value || '' }, 'PUT'); toast('Resultados guardados'); pintarFicha(); }
    catch (e) { toast(e.message); } finally { ocupado = false; }
  }

  async function subir(archivos) {
    if (!actual || !archivos.length) return;
    let antes = 0, despues = 0;
    for (const original of archivos) {
      const f = await reducir(original); antes += original.size; despues += f.size;
      if (f.size > 10 * 1024 * 1024) { toast(`«${f.name}» pasa de 10 MB`); continue; }
      try {
        const r = await api('/marketing/publicaciones/' + actual.id + '/imagenes', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Nombre': encodeURIComponent(f.name) }, body: f });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { toast(d.error || 'No se pudo subir ' + f.name); continue; }
        actual = d;
      } catch (e) { toast(`«${f.name}»: ${e.message}`); }
    }
    if (despues < antes) toast(`Imágenes optimizadas: ${pesoTxt(antes)} → ${pesoTxt(despues)}`);
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
  // Vista rápida (2026-10-27): al pasar el mouse por una publicación del mes o de la lista se ve su portada, estado y datos.
  const pop = document.createElement('div'); pop.className = 'mk-pop'; pop.hidden = true; pop.setAttribute('role', 'tooltip'); document.body.appendChild(pop);
  let popId = 0;
  const ocultarPop = () => { pop.hidden = true; popId = 0; };
  $('vista-marketing').addEventListener('mouseover', async e => {
    if (!matchMedia('(hover: hover)').matches) return;
    const el = e.target.closest('#mk-grid [data-mk-pub], #mk-tabla [data-mk-pub]'); if (!el) return;
    const p = PUBS.find(x => x.id === Number(el.dataset.mkPub)); if (!p || popId === p.id) return; popId = p.id;
    pop.innerHTML = `${p.portada_id ? `<img alt="" data-mk-img="${Number(p.portada_id)}">` : `<div class="mk-pop-sin">${redesTxt(p.redes)}</div>`}<div class="mk-pop-txt"><b>${esc(p.titulo)}</b>
      <span>${esc(fechaLarga(p.fecha))}${p.hora ? ' · ' + esc(p.hora) : ''}</span><span>${redesTxt(p.redes)} ${estadoDe(p)}</span>
      <small>${esc([p.responsable, p.sucursal_nombre || 'Toda la empresa'].filter(Boolean).join(' · '))}${p.imagenes ? ` · 🖼 ${Number(p.imagenes)}` : ''}${p.comentarios ? ` · 💬 ${Number(p.comentarios)}` : ''}</small></div>`;
    const r = el.getBoundingClientRect(); pop.hidden = false;
    const ancho = pop.offsetWidth, alto = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(innerWidth - ancho - 8, r.left)) + 'px';
    pop.style.top = (r.bottom + alto + 8 > innerHeight ? Math.max(8, r.top - alto - 6) : r.bottom + 6) + 'px';
    cargarImagenes(pop);
  });
  $('vista-marketing').addEventListener('mouseout', e => { if (e.target.closest('[data-mk-pub]') && !e.relatedTarget?.closest?.('[data-mk-pub]')) ocultarPop(); });
  window.addEventListener('scroll', ocultarPop, { passive: true });
  $('vista-marketing').addEventListener('mousedown', ocultarPop);
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
  $('mk-redes').addEventListener('change', () => { pintarTextos(); previa(); });
  $('mk-copy-redes').addEventListener('input', e => { const t = e.target.closest('[data-mk-texto]'); if (t) { TEXTOS[t.dataset.mkTexto] = t.value; contador(); previa(); } });
  $('mk-copy-redes').addEventListener('click', e => {
    const aj = e.target.closest('[data-mk-texto-ajustar]'); if (aj) { const k = aj.dataset.mkTextoAjustar; TEXTOS[k] = $('mk-copy').value; PREVIA_RED = k; pintarTextos(); previa(); $('mk-texto-' + k)?.focus(); $('mk-form').dispatchEvent(new Event('input')); return; }
    const q = e.target.closest('[data-mk-texto-quitar]'); if (q) { delete TEXTOS[q.dataset.mkTextoQuitar]; pintarTextos(); previa(); $('mk-form').dispatchEvent(new Event('input')); }
  });
  $('mk-previa').addEventListener('click', e => { const b = e.target.closest('[data-mk-previa-red]'); if (b) { PREVIA_RED = b.dataset.mkPreviaRed; previa(); cargarImagenes($('mk-previa')); } });
  $('mk-metricas').addEventListener('click', e => { const b = e.target.closest('[data-mk-met-guardar]'); if (b) guardarMetricas(b.closest('[data-mk-met-red]')); });
  // Orden de las imágenes: botones ◀ ★ ▶ y arrastrar una sobre otra.
  let arrastrada = null;
  $('mk-imagenes').addEventListener('dragstart', e => { const f = e.target.closest('[data-mk-fig]'); if (f) { arrastrada = Number(f.dataset.mkFig); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(arrastrada)); } });
  $('mk-imagenes').addEventListener('dragover', e => { if (arrastrada && e.target.closest('[data-mk-fig]')) { e.preventDefault(); e.target.closest('[data-mk-fig]').classList.add('mk-soltar'); } });
  $('mk-imagenes').addEventListener('dragleave', e => e.target.closest('[data-mk-fig]')?.classList.remove('mk-soltar'));
  $('mk-imagenes').addEventListener('drop', e => {
    const f = e.target.closest('[data-mk-fig]'); if (!f || !arrastrada) return; e.preventDefault(); f.classList.remove('mk-soltar');
    const destino = Number(f.dataset.mkFig), ids = idsImagenes().filter(i => i !== arrastrada); ids.splice(ids.indexOf(destino) + (idsImagenes().indexOf(arrastrada) < idsImagenes().indexOf(destino) ? 1 : 0), 0, arrastrada);
    arrastrada = null; ordenar(ids);
  });
  $('mk-imagenes').addEventListener('dragend', () => { arrastrada = null; });
  $('mk-estado-barra').addEventListener('click', e => { const b = e.target.closest('[data-mk-accion]'); if (b) accion(b.dataset.mkAccion); });
  $('mk-subir').addEventListener('change', e => { subir([...e.target.files]); e.target.value = ''; });
  $('mk-desde-bib').onclick = () => actual && window.BibliotecaMk?.elegir(actual.id, d => { actual = d; pintarFicha(); cargar(); });
  $('mk-imagenes').addEventListener('click', async e => {
    const mv = e.target.closest('[data-mk-mover]');
    if (mv) { const ids = idsImagenes(), i = ids.indexOf(Number(mv.dataset.mkMover)), j = i + Number(mv.dataset.dir); if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; ordenar(ids); return; }
    const po = e.target.closest('[data-mk-portada]');
    if (po) { const id = Number(po.dataset.mkPortada); ordenar([id, ...idsImagenes().filter(i => i !== id)]); return; }
    const q = e.target.closest('[data-mk-quitar]');
    if (q) { if (!await solicitarDialogo({ titulo: 'Quitar imagen', mensaje: 'La imagen deja de estar en la publicación (queda en el historial quién la quitó). El archivo se borra del servidor a los 60 días.' + (['aprobada', 'programada'].includes(actual.estado) ? ' Como ya está aprobada, regresará a borrador.' : ''), aceptar: 'Quitar' })) return;
      try { actual = await pedir('/imagenes/' + Number(q.dataset.mkQuitar) + '/quitar', {}, 'POST'); pintarFicha(); cargar(); } catch (err) { toast(err.message); } return; }
    const a = e.target.closest('[data-mk-ampliar]'); if (a) { e.preventDefault(); const u = await urlImagen(Number(a.dataset.mkAmpliar)); if (u) window.open(u, '_blank', 'noopener'); }
  });
  $('mk-comentar').onclick = async () => {
    const t = $('mk-comentario').value.trim(); if (!t) { toast('Escribe el comentario'); return; }
    try { actual = await pedir('/publicaciones/' + actual.id + '/comentarios', { texto: t }, 'POST'); $('mk-comentario').value = ''; pintarFicha(); } catch (e) { toast(e.message); }
  };
  $('inicio-marketing')?.addEventListener('click', e => { const b = e.target.closest('[data-mk-inicio]'); if (b) abrir(Number(b.dataset.mkInicio)); const py = e.target.closest('[data-py-inicio]'); if (py) window.ProyectosMk?.abrir(Number(py.dataset.pyInicio)); });
  // Pestañas: Calendario y Proyectos (se recuerda la última).
  // Por defecto el Tablero; se recuerda la última pestaña (la de dinero solo si la puede ver).
  let PESTANA = 'tablero';
  try { const g = localStorage.getItem('marketing-pestana'); if (['calendario', 'proyectos', 'ideas', 'biblioteca', 'plan', 'dinero', 'resultados'].includes(g)) PESTANA = g; } catch { /* */ }
  function pestana(p) {
    PESTANA = p; try { localStorage.setItem('marketing-pestana', p); } catch { /* */ }
    document.querySelectorAll('#vista-marketing > .mk-pestanas [data-mk-pestana]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mkPestana === p)));
    if (p === 'dinero' && !Permisos.puede('marketing.dinero')) p = 'tablero';
    PESTANA = p;
    document.querySelectorAll('#vista-marketing > .mk-pestanas [data-mk-pestana]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mkPestana === p)));
    for (const t of ['tablero', 'calendario', 'proyectos', 'ideas', 'biblioteca', 'plan', 'dinero', 'resultados']) $('mk-tab-' + t).hidden = p !== t;
    if (p === 'proyectos') window.ProyectosMk?.cargar(); else if (p === 'ideas') window.IdeasMk?.cargar(); else if (p === 'biblioteca') window.BibliotecaMk?.cargar();
    else if (['tablero', 'plan', 'dinero', 'resultados'].includes(p)) window.ControlMk?.cargar(p); else cargar();
  }
  document.querySelectorAll('#vista-marketing > .mk-pestanas [data-mk-pestana]').forEach(b => b.addEventListener('click', () => pestana(b.dataset.mkPestana)));
  window.addEventListener('beforeunload', e => { if ($('overlay-publicacion').classList.contains('mostrar') && pendiente()) { e.preventDefault(); e.returnValue = ''; } });
  return { redesHtml: redes => redesTxt(redes), logo, reducir, urlImagen, filtros: () => ({ fecha: FECHA, estado: $('mk-f-estado').value, q: $('mk-buscar').value.trim(), redes: [...redesFiltro] }), pestana, cargar: () => pestana(PESTANA), cargarCalendario: cargar, abrir, pintarInicio, catalogos: async () => { CAT = null; return catalogos(); } };
})();
window.Marketing = Marketing;
