/* Marketing · fase 3 (2026-10-27): banco de ideas y biblioteca. Ver server/marketing.js.
   · IdeasMk: tablero por estado (Nuevas, En evaluación, Aprobadas, Realizadas, Descartadas) ordenado por votos. Cada idea
     abre su ventana: datos (los corrige quien la propuso o quien aprueba), imágenes de referencia, votos 👍, comentarios
     e historial; quien aprueba la pasa a evaluación, la aprueba o la descarta (con motivo); una aprobada se convierte en
     publicación o en proyecto y queda «Realizada» con su liga.
   · BibliotecaMk: rejilla de archivos (lo subido, las imágenes de publicaciones y los archivos de avances), con carpetas,
     etiquetas y búsqueda; el detalle permite renombrar, mover de carpeta, descargar o quitar. elegir(pubId) abre el
     selector para agregar una imagen de la biblioteca a una publicación. */
const BibliotecaMk = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t == null ? '' : String(t));
  const URLS = { biblioteca: '/marketing/biblioteca/', publicacion: '/marketing/imagenes/', avance: '/marketing/archivos/' };
  const ORIGEN = { biblioteca: 'Biblioteca', publicacion: 'Imagen de publicación', avance: 'Avance de proyecto' };
  const cache = new Map(); // origen:id → objectURL
  let LISTA = [], CARPETAS = [], PUEDE = false, ocupado = false;
  const peso = b => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  async function url(origen, id) {
    const k = origen + ':' + id; if (cache.has(k)) return cache.get(k);
    let r; try { r = await api(URLS[origen] + Number(id)); } catch { return ''; }
    const u = URL.createObjectURL(await r.blob()); cache.set(k, u); return u;
  }
  function pintarImagenes(cont) { cont.querySelectorAll('img[data-bib-img]').forEach(async img => { const [o, id] = img.dataset.bibImg.split(':'); const u = await url(o, id); if (u) img.src = u; }); }
  const tarjeta = (f, attr) => `<button type="button" class="bib-item" ${attr}="${esc(f.origen)}:${Number(f.id)}" title="${esc(f.nombre)}">
      ${f.formato === 'pdf' ? '<span class="bib-pdf">PDF</span>' : `<img alt="" data-bib-img="${esc(f.origen)}:${Number(f.id)}">`}
      <span class="bib-item-txt"><b>${esc(f.nombre)}</b><small>${esc(f.carpeta)}${f.etiquetas ? ' · ' + esc(f.etiquetas) : ''}</small></span></button>`;
  async function pedirLista(extra = {}) {
    const q = new URLSearchParams(extra);
    const r = await api('/marketing/biblioteca?' + q); return r.json();
  }
  async function cargar() {
    try {
      const d = await pedirLista({ q: $('bib-buscar').value.trim(), carpeta: $('bib-f-carpeta').value, origen: $('bib-f-origen').value });
      LISTA = d.archivos; CARPETAS = d.carpetas; PUEDE = d.puede.editar;
      const sel = $('bib-f-carpeta'), previo = sel.value;
      sel.innerHTML = '<option value="">Todas las carpetas</option>' + [...CARPETAS, 'Publicaciones', 'Avances de proyectos'].map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join(''); sel.value = previo;
      const sub = $('bib-carpeta-subir'), prev2 = sub.value || 'Logos';
      sub.innerHTML = CARPETAS.map(c => `<option value="${esc(c)}">Subir a: ${esc(c)}</option>`).join('') + '<option value="__nueva">Subir a una carpeta nueva…</option>'; sub.value = CARPETAS.includes(prev2) ? prev2 : CARPETAS[0];
      $('bib-conteo').textContent = LISTA.length + (LISTA.length === 1 ? ' archivo' : ' archivos');
      $('bib-rejilla').innerHTML = LISTA.length ? LISTA.map(f => tarjeta(f, 'data-bib-abrir')).join('') : '<p class="util-45">No hay archivos con estos filtros.</p>';
      pintarImagenes($('bib-rejilla'));
    } catch (e) { $('bib-rejilla').innerHTML = `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`; }
  }
  async function subir(archivos) {
    if (ocupado || !archivos.length) return;
    let carpeta = $('bib-carpeta-subir').value;
    if (carpeta === '__nueva') { carpeta = await solicitarDialogo({ titulo: 'Carpeta nueva', mensaje: 'Nombre de la carpeta (p. ej. «Campaña lluvias»).', aceptar: 'Subir aquí', campo: { etiqueta: 'Carpeta', requerido: 'Escribe el nombre de la carpeta' } }); if (!carpeta) return; }
    ocupado = true; let ok = 0;
    try {
      for (const f of archivos) {
        if (f.size > 10 * 1024 * 1024) { toast(`«${f.name}» pasa de 10 MB`); continue; }
        try {
          const r = await api('/marketing/biblioteca', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Nombre': encodeURIComponent(f.name), 'X-Carpeta': encodeURIComponent(carpeta) }, body: f });
          const d = await r.json().catch(() => ({})); if (!r.ok) toast(d.error || 'No se pudo subir ' + f.name); else ok++;
        } catch (e) { toast(`«${f.name}»: ${e.message}`); }
      }
      if (ok) toast(ok === 1 ? 'Archivo subido' : ok + ' archivos subidos');
      await cargar();
    } finally { ocupado = false; }
  }
  async function abrir(origen, id) {
    const f = LISTA.find(x => x.origen === origen && x.id === Number(id)); if (!f) return;
    const editable = PUEDE && origen === 'biblioteca';
    $('bib-kicker').textContent = 'BIBLIOTECA · ' + ORIGEN[origen].toUpperCase(); $('bib-titulo').textContent = f.nombre;
    const de = [f.publicacion_titulo && `📣 Publicación: <button type="button" class="enlace" data-bib-pub="${Number(f.publicacion_id)}">${esc(f.publicacion_titulo)}</button>`,
      f.proyecto_nombre && `📁 Proyecto: <button type="button" class="enlace" data-bib-proy="${Number(f.proyecto_id)}">${esc(f.proyecto_nombre)}</button>`,
      f.idea_titulo && `💡 Idea: ${esc(f.idea_titulo)}`].filter(Boolean).join(' · ');
    $('bib-detalle').innerHTML = `<div class="bib-grande">${f.formato === 'pdf' ? '<span class="bib-pdf bib-pdf-grande">PDF</span>' : `<img alt="${esc(f.nombre)}" data-bib-img="${esc(f.origen)}:${Number(f.id)}">`}</div>
      <p class="ayuda">${esc(peso(f.bytes))} · ${esc(String(f.formato).toUpperCase())} · subido por ${esc(f.subido_por_nombre || '—')} · ${esc(fechaCorta(f.created_at))}${de ? '<br>' + de : ''}</p>
      ${editable ? `<div class="form-grid-2"><div class="campo-modal"><label for="bib-d-nombre">Nombre (obligatorio)</label><input id="bib-d-nombre" maxlength="120" value="${esc(f.nombre)}"></div>
        <div class="campo-modal"><label for="bib-d-carpeta">Carpeta (obligatorio)</label><input id="bib-d-carpeta" maxlength="40" list="bib-carpetas-lista" value="${esc(f.carpeta)}"><datalist id="bib-carpetas-lista">${CARPETAS.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
        <div class="campo-modal full"><label for="bib-d-etiquetas">Etiquetas (opcional)</label><input id="bib-d-etiquetas" maxlength="200" value="${esc(f.etiquetas)}" placeholder="logo, horizontal, fondo blanco"></div></div>` : ''}
      <div class="btn-group">${editable ? '<button type="button" class="btn btn-primario" id="bib-d-guardar">Guardar</button>' : ''}<button type="button" class="btn btn-outline" id="bib-d-descargar">⬇ Descargar</button>${editable ? '<button type="button" class="btn btn-outline mk-btn-cancelar" id="bib-d-quitar">Quitar de la biblioteca</button>' : ''}</div>`;
    pintarImagenes($('bib-detalle'));
    abrirVentana('overlay-biblio');
    $('bib-d-descargar').onclick = async () => { const u = await url(f.origen, f.id); if (!u) return toast('No se pudo descargar'); const a = document.createElement('a'); a.href = u; a.download = f.nombre + (/\.\w{3,4}$/.test(f.nombre) ? '' : '.' + f.formato); a.click(); };
    if (editable) {
      $('bib-d-guardar').onclick = async () => {
        try { const r = await api('/marketing/biblioteca/' + f.id, { method: 'PUT', body: JSON.stringify({ nombre: $('bib-d-nombre').value, carpeta: $('bib-d-carpeta').value, etiquetas: $('bib-d-etiquetas').value }) }); if (!r.ok) throw Error((await r.json()).error); toast('Archivo actualizado'); $('overlay-biblio').classList.remove('mostrar'); cargar(); } catch (e) { toast(e.message); }
      };
      $('bib-d-quitar').onclick = async () => {
        if (!await solicitarDialogo({ titulo: 'Quitar de la biblioteca', mensaje: `«${f.nombre}» deja de estar en la biblioteca (queda registrado quién lo quitó). Las publicaciones que ya lo usan lo conservan.`, aceptar: 'Quitar' })) return;
        try { const r = await api('/marketing/biblioteca/' + f.id + '/quitar', { method: 'POST', body: '{}' }); if (!r.ok) throw Error((await r.json().catch(() => ({}))).error || 'No se pudo quitar'); toast('Quitado de la biblioteca'); $('overlay-biblio').classList.remove('mostrar'); cargar(); } catch (e) { toast(e.message); }
      };
    }
  }
  // ---------- Selector para una publicación ----------
  let ELEGIR = null; // { pubId, listo }
  async function elegir(pubId, listo) {
    ELEGIR = { pubId, listo }; $('bib-e-buscar').value = '';
    abrirVentana('overlay-biblio-elegir'); await pintarElegir();
  }
  async function pintarElegir() {
    const d = await pedirLista({ q: $('bib-e-buscar').value.trim(), origen: 'biblioteca' });
    const imgs = d.archivos.filter(f => f.formato !== 'pdf');
    $('bib-e-rejilla').innerHTML = imgs.length ? imgs.map(f => tarjeta(f, 'data-bib-elegir')).join('') : '<p class="util-45">No hay imágenes en la biblioteca' + ($('bib-e-buscar').value ? ' con esa búsqueda' : '') + '. Súbelas en la pestaña «Biblioteca».</p>';
    pintarImagenes($('bib-e-rejilla'));
  }
  $('bib-e-buscar').oninput = debounce(pintarElegir, 300);
  $('bib-e-rejilla').addEventListener('click', async e => {
    const b = e.target.closest('[data-bib-elegir]'); if (!b || !ELEGIR || ocupado) return;
    ocupado = true;
    try {
      const r = await api('/marketing/publicaciones/' + ELEGIR.pubId + '/desde-biblioteca', { method: 'POST', body: JSON.stringify({ biblioteca_id: Number(b.dataset.bibElegir.split(':')[1]) }) });
      const d = await r.json(); if (!r.ok) throw Error(d.error);
      $('overlay-biblio-elegir').classList.remove('mostrar'); toast(d.estado === 'borrador' && /regresó a borrador/.test(d.historial?.[0]?.texto || '') ? 'Imagen agregada; la publicación regresó a borrador' : 'Imagen agregada a la publicación'); ELEGIR.listo(d);
    } catch (err) { toast(err.message); } finally { ocupado = false; }
  });
  // ---------- Eventos ----------
  $('bib-buscar').oninput = debounce(cargar, 350); $('bib-f-carpeta').onchange = cargar; $('bib-f-origen').onchange = cargar;
  $('bib-subir').addEventListener('change', e => { subir([...e.target.files]); e.target.value = ''; });
  $('bib-rejilla').addEventListener('click', e => { const b = e.target.closest('[data-bib-abrir]'); if (b) { const [o, id] = b.dataset.bibAbrir.split(':'); abrir(o, id); } });
  $('bib-detalle').addEventListener('click', e => {
    const p = e.target.closest('[data-bib-pub]'); if (p) { $('overlay-biblio').classList.remove('mostrar'); Marketing.abrir(Number(p.dataset.bibPub)); return; }
    const y = e.target.closest('[data-bib-proy]'); if (y) { $('overlay-biblio').classList.remove('mostrar'); ProyectosMk.abrir(Number(y.dataset.bibProy)); }
  });
  return { cargar, elegir, url, pintarImagenes };
})();
window.BibliotecaMk = BibliotecaMk;

const IdeasMk = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t == null ? '' : String(t));
  const COLUMNAS = ['nueva', 'evaluacion', 'aprobada', 'realizada', 'descartada'];
  let CAT = null, LISTA = [], actual = null, base = '', ocupado = false;
  const redesElegidas = () => [...document.querySelectorAll('#id-redes input:checked')].map(i => i.value);
  const datos = () => ({ titulo: $('id-titulo-in').value, descripcion: $('id-desc').value, redes: redesElegidas(), sucursal: $('id-sucursal').value, referencia: $('id-referencia').value });
  const pendiente = () => base !== JSON.stringify(datos());
  async function pedir(ruta, body, method = 'GET') {
    const r = await api('/marketing' + ruta, body !== undefined ? { method, body: JSON.stringify(body) } : undefined);
    const d = await r.json().catch(() => ({})); if (!r.ok) throw Error(d.error || 'No se pudo completar'); return d;
  }
  const estadoTag = e => `<span class="id-estado id-e-${esc(e)}">${esc(CAT?.estados_idea[e] || e)}</span>`;
  const estadoDe = i => estadoTag(i.estado); // etiqueta ya escapada
  async function cargar() {
    try {
      CAT = await Marketing.catalogos();
      LISTA = await pedir('/ideas?' + new URLSearchParams({ q: $('id-buscar').value.trim() }));
      $('id-tablero').innerHTML = COLUMNAS.map(c => { const l = LISTA.filter(i => i.estado === c);
        const resumen = i => (i.descripcion.length > 140 ? i.descripcion.slice(0, 140) + '…' : i.descripcion);
        return `<section class="id-col id-c-${c}" aria-label="${esc(CAT.estados_idea[c])}"><h3>${esc(CAT.estados_idea[c])} <span>${l.length}</span></h3>
          ${l.length ? l.map(i => `<article class="id-tarjeta" data-id-abrir="${Number(i.id)}" tabindex="0" role="button" aria-label="Abrir idea ${esc(i.titulo)}">
            ${i.portada_id ? `<img alt="" data-bib-img="biblioteca:${Number(i.portada_id)}">` : ''}
            <b>${esc(i.titulo)}</b>${i.descripcion ? `<p>${esc(resumen(i))}</p>` : ''}
            <div class="id-tarjeta-pie"><span>${Marketing.redesHtml(i.redes)}</span><span class="id-autor">${esc(i.autor || '')}</span>
              <button type="button" class="id-voto${i.mi_voto ? ' activo' : ''}" data-id-voto="${Number(i.id)}" aria-pressed="${i.mi_voto}" aria-label="${i.mi_voto ? 'Quitar mi voto' : 'Votar'}"${CAT.puede.editar ? '' : ' disabled'}>👍 ${Number(i.votos)}</button>
              ${i.comentarios ? `<span class="id-coment">💬 ${Number(i.comentarios)}</span>` : ''}</div></article>`).join('') : '<p class="util-45">Ninguna.</p>'}</section>`; }).join('');
      BibliotecaMk.pintarImagenes($('id-tablero'));
    } catch (e) { $('id-tablero').innerHTML = `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`; }
  }
  async function abrir(id) {
    try {
      if ($('overlay-idea').classList.contains('mostrar') && !await permitirSalida()) return;
      CAT = await Marketing.catalogos();
      actual = id ? await pedir('/ideas/' + Number(id)) : null;
      $('id-redes').innerHTML = Object.entries(CAT.redes).map(([k, n]) => `<label class="mk-red-op mk-r-${esc(k)}"><input type="checkbox" value="${esc(k)}"> ${Marketing.logo(k)} ${esc(n)}</label>`).join('');
      $('id-sucursal').innerHTML = '<option value="empresa">Toda la empresa</option>' + CAT.sucursales.map(s => `<option value="${Number(s.id)}">${esc(s.nombre)} (${esc(s.clave)})</option>`).join('');
      const i = actual || { titulo: '', descripcion: '', redes: [], sucursal_id: null, referencia: '' };
      $('id-titulo-in').value = i.titulo; $('id-desc').value = i.descripcion; $('id-referencia').value = i.referencia;
      $('id-sucursal').value = i.sucursal_id ? String(i.sucursal_id) : 'empresa';
      document.querySelectorAll('#id-redes input').forEach(x => { x.checked = i.redes.includes(x.value); });
      base = JSON.stringify(datos());
      pintar();
      abrirVentana('overlay-idea');
      if (actual) SoloLectura.poner('#id-form', actual.puede.editar, { que: 'la idea', quien: actual.estado === 'realizada' ? 'ya se realizó: solo se comenta.' : 'la corrige quien la propuso, el Gerente de marketing o Dirección.' });
      else SoloLectura.quitar('#id-form');
    } catch (e) { toast(e.message); }
  }
  function pintar() {
    $('id-titulo').textContent = actual ? actual.titulo : 'Nueva idea';
    $('id-kicker').textContent = actual ? 'IDEA #' + actual.id + ' · ' + (CAT.estados_idea[actual.estado] || '').toUpperCase() : 'NUEVA IDEA';
    $('id-aviso').textContent = actual ? '' : 'Nueva · aún no guardada';
    $('id-extra').hidden = !actual; $('id-barra').hidden = !actual;
    if (!actual) return;
    const i = actual, b = [];
    if (i.puede.decidir && ['nueva', 'descartada'].includes(i.estado)) b.push(['evaluar', '🔎 Pasar a evaluación', 'btn-outline']);
    if (i.puede.decidir && ['nueva', 'evaluacion'].includes(i.estado)) b.push(['aprobar', '✅ Aprobar', 'btn-primario']);
    if (i.puede.decidir && ['nueva', 'evaluacion', 'aprobada'].includes(i.estado)) b.push(['descartar', 'Descartar', 'btn-outline mk-btn-cancelar']);
    if (i.puede.decidir && i.estado === 'descartada') b.push(['reabrir', 'Reabrir', 'btn-outline']);
    if (i.puede.convertir) b.push(['a-publicacion', '📣 Convertir en publicación', 'btn-primario'], ['a-proyecto', '📁 Convertir en proyecto', 'btn-outline']);
    const quien = { nueva: 'Esperando que la revisen Dirección o el Gerente de marketing.', evaluacion: 'En evaluación.', aprobada: `Aprobada por ${i.decidido_por_nombre || '—'}: conviértela en publicación o en proyecto.`, descartada: 'Descartada por ' + (i.decidido_por_nombre || '—') + (i.motivo ? ': ' + i.motivo : '') + '.', realizada: 'Ya se realizó.' }[i.estado];
    const liga = [i.publicacion_id && `📣 <button type="button" class="enlace" data-id-pub="${Number(i.publicacion_id)}">${esc(i.publicacion_titulo || 'Publicación')}</button>`, i.proyecto_id && `📁 <button type="button" class="enlace" data-id-proy="${Number(i.proyecto_id)}">${esc(i.proyecto_nombre || 'Proyecto')}</button>`].filter(Boolean).join(' · ');
    $('id-barra').innerHTML = `<div>${estadoDe(i)} <span class="ayuda">${esc(quien)} Propuesta por ${esc(i.autor || '—')}.</span>${liga ? ' ' + liga : ''}${i.referencia ? ` · <a href="${esc(i.referencia)}" target="_blank" rel="noopener noreferrer">Referencia ↗</a>` : ''}</div>`
      + (b.length ? `<div class="btn-group">${b.map(([a, t, c]) => `<button type="button" class="btn ${c} btn-chico" data-id-accion="${a}">${esc(t)}</button>`).join('')}</div>` : '');
    $('id-adjuntos').innerHTML = i.adjuntos.length ? i.adjuntos.map(f => f.formato === 'pdf' ? `<button type="button" class="btn btn-outline btn-chico" data-id-pdf="${Number(f.id)}" data-nombre="${esc(f.nombre)}">📄 ${esc(f.nombre)}</button>` : `<a href="#" data-id-foto="${Number(f.id)}" title="${esc(f.nombre)}"><img alt="${esc(f.nombre)}" data-bib-img="biblioteca:${Number(f.id)}"></a>`).join('') : '<p class="util-45">Sin imágenes.</p>';
    BibliotecaMk.pintarImagenes($('id-adjuntos'));
    $('id-votos').innerHTML = `<button type="button" class="id-voto${i.mi_voto ? ' activo' : ''}" data-id-voto="${Number(i.id)}" aria-pressed="${i.mi_voto}"${i.puede.votar ? '' : ' disabled'}>👍 ${Number(i.votos)} ${i.mi_voto ? '· votaste' : '· votar'}</button> <span class="ayuda">${i.votantes.length ? esc(i.votantes.join(', ')) : 'Nadie ha votado todavía.'}</span>`;
    $('id-historial').innerHTML = i.historial.map(h => `<li class="mk-h-${h.tipo === 'estado' ? 'estado' : 'comentario'}"><div class="pr-seg-cab"><b>${esc(h.usuario || '')}</b> · ${esc(fechaCorta(h.created_at))}</div><div>${esc(h.texto)}</div></li>`).join('');
  }
  async function permitirSalida() { return !pendiente() || await solicitarDialogo({ titulo: 'Cambios sin guardar', mensaje: '¿Descartar los cambios de la idea?', aceptar: 'Descartar cambios' }); }
  async function guardar() {
    if (ocupado) return; ocupado = true; $('id-guardar').disabled = true;
    try {
      if (!$('id-referencia').checkValidity()) throw Error('La referencia debe ser un enlace que empiece con https://');
      const nueva = !actual;
      actual = nueva ? await pedir('/ideas', datos(), 'POST') : await pedir('/ideas/' + actual.id, { ...datos(), version: actual.version }, 'PUT');
      base = JSON.stringify(datos()); toast(nueva ? 'Idea guardada' : 'Idea actualizada'); pintar();
      SoloLectura.poner('#id-form', actual.puede.editar, { que: 'la idea', quien: 'la corrige quien la propuso, el Gerente de marketing o Dirección.' }); SoloLectura.bloquear('#id-form');
      cargar();
    } catch (e) { toast(e.message); $('id-aviso').textContent = e.message; } finally { ocupado = false; $('id-guardar').disabled = false; }
  }
  async function accion(a) {
    if (ocupado || !actual) return;
    if (pendiente()) { toast('Primero guarda o descarta los cambios de la idea'); return; }
    try {
      if (a === 'a-publicacion' || a === 'a-proyecto') {
        const pub = a === 'a-publicacion';
        if (!await solicitarDialogo({ titulo: pub ? 'Convertir en publicación' : 'Convertir en proyecto', mensaje: pub ? 'Se crea una publicación en borrador con el título, la descripción como copy, sus redes y sus imágenes. La idea queda «Realizada».' : 'Se crea un proyecto de 30 días (en planeación) con el título y la descripción como objetivo. La idea queda «Realizada».', aceptar: pub ? 'Crear publicación' : 'Crear proyecto' })) return;
        ocupado = true;
        const r = await pedir('/ideas/' + actual.id + '/convertir', { a: pub ? 'publicacion' : 'proyecto', version: actual.version }, 'POST');
        actual = r; pintar(); cargar(); toast(pub ? 'Publicación creada en borrador' : 'Proyecto creado');
        $('overlay-idea').classList.remove('mostrar');
        if (pub) Marketing.abrir(r.publicacion_id); else ProyectosMk.abrir(r.proyecto_id);
        return;
      }
      const cuerpo = { accion: a, version: actual.version };
      if (a === 'descartar') { const m = await solicitarDialogo({ titulo: 'Descartar idea', mensaje: 'Le aparece a quien la propuso.', aceptar: 'Descartar', campo: { etiqueta: '¿Por qué se descarta?', requerido: 'Escribe el motivo' } }); if (!m) return; cuerpo.motivo = m; }
      ocupado = true;
      actual = await pedir('/ideas/' + actual.id + '/estado', cuerpo, 'POST'); pintar(); cargar();
      SoloLectura.poner('#id-form', actual.puede.editar, { que: 'la idea', quien: 'la corrige quien la propuso, el Gerente de marketing o Dirección.' });
      toast({ evaluar: 'Pasó a evaluación', aprobar: 'Idea aprobada', descartar: 'Idea descartada', reabrir: 'Idea reabierta' }[a]);
    } catch (e) { toast(e.message); } finally { ocupado = false; }
  }
  async function votar(id, voto) {
    try { const r = await pedir('/ideas/' + Number(id) + '/voto', { voto }, 'POST'); if (actual?.id === r.id) { actual = r; pintar(); } cargar(); } catch (e) { toast(e.message); }
  }
  // ---------- Eventos ----------
  $('id-nueva').onclick = () => abrir(null);
  $('id-buscar').oninput = debounce(cargar, 350);
  $('id-tablero').addEventListener('click', e => {
    const v = e.target.closest('[data-id-voto]'); if (v) { e.stopPropagation(); votar(v.dataset.idVoto, v.getAttribute('aria-pressed') !== 'true'); return; }
    const t = e.target.closest('[data-id-abrir]'); if (t) abrir(Number(t.dataset.idAbrir));
  });
  $('id-tablero').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-id-abrir]')) { e.preventDefault(); abrir(Number(e.target.dataset.idAbrir)); } });
  $('id-cerrar').onclick = async () => { if (!ocupado && await permitirSalida()) $('overlay-idea').classList.remove('mostrar'); };
  $('id-guardar').onclick = guardar;
  $('id-form').addEventListener('input', () => { if (actual) $('id-aviso').textContent = pendiente() ? 'Cambios sin guardar' : ''; });
  $('id-barra').addEventListener('click', e => {
    const b = e.target.closest('[data-id-accion]'); if (b) return accion(b.dataset.idAccion);
    const p = e.target.closest('[data-id-pub]'); if (p) { $('overlay-idea').classList.remove('mostrar'); Marketing.abrir(Number(p.dataset.idPub)); return; }
    const y = e.target.closest('[data-id-proy]'); if (y) { $('overlay-idea').classList.remove('mostrar'); ProyectosMk.abrir(Number(y.dataset.idProy)); }
  });
  $('id-votos').addEventListener('click', e => { const v = e.target.closest('[data-id-voto]'); if (v) votar(v.dataset.idVoto, v.getAttribute('aria-pressed') !== 'true'); });
  $('id-comentar').onclick = async () => {
    const t = $('id-comentario').value.trim(); if (!t) { toast('Escribe el comentario'); return; }
    try { actual = await pedir('/ideas/' + actual.id + '/comentarios', { texto: t }, 'POST'); $('id-comentario').value = ''; pintar(); cargar(); } catch (e) { toast(e.message); }
  };
  $('id-subir').addEventListener('change', async e => {
    const archivos = [...e.target.files]; e.target.value = ''; if (!actual) return;
    for (const original of archivos) {
      const f = await Marketing.reducir(original); // las imágenes de una idea se optimizan; la biblioteca guarda originales
      if (f.size > 10 * 1024 * 1024) { toast(`«${f.name}» pasa de 10 MB`); continue; }
      try {
        const r = await api('/marketing/biblioteca', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Nombre': encodeURIComponent(f.name), 'X-Carpeta': encodeURIComponent('Ideas'), 'X-Idea': String(actual.id) }, body: f });
        const d = await r.json().catch(() => ({})); if (!r.ok) toast(d.error || 'No se pudo subir ' + f.name); else if (d.idea) actual = d.idea;
      } catch (err) { toast(`«${f.name}»: ${err.message}`); }
    }
    pintar(); cargar();
  });
  $('id-adjuntos').addEventListener('click', async e => {
    const f = e.target.closest('[data-id-foto]'); if (f) { e.preventDefault(); const u = await BibliotecaMk.url('biblioteca', f.dataset.idFoto); if (u) window.open(u, '_blank', 'noopener'); return; }
    const p = e.target.closest('[data-id-pdf]'); if (p) { const u = await BibliotecaMk.url('biblioteca', p.dataset.idPdf); if (u) { const a = document.createElement('a'); a.href = u; a.download = p.dataset.nombre || 'archivo.pdf'; a.click(); } }
  });
  window.addEventListener('beforeunload', e => { if ($('overlay-idea').classList.contains('mostrar') && pendiente()) { e.preventDefault(); e.returnValue = ''; } });
  return { cargar, abrir };
})();
window.IdeasMk = IdeasMk;
