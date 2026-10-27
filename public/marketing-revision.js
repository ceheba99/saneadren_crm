/* Marketing · revisión rápida y PDF del mes (2026-10-27). Ver public/marketing.js y server/marketing.js.
   «Por aprobar» (Dirección y Gerente de marketing): todas las publicaciones en revisión en una lista, cada una con sus
   imágenes en grande, el texto de cada red y los botones Aprobar / Pedir cambios, sin abrir la ficha. Pensada para el
   celular. «PDF del mes»: arma el calendario del mes que se ve (con los filtros puestos) y el detalle de cada
   publicación con su portada, y abre el diálogo de impresión del navegador (ahí se elige «Guardar como PDF»). */
const RevisionMk = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t == null ? '' : String(t));
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const hoyTxt = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fechaDe = f => new Date(f + 'T12:00:00');
  const sumar = (f, n) => { const d = fechaDe(f); d.setDate(d.getDate() + n); return iso(d); };
  const fechaLarga = f => fechaDe(f).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  let CAT = null, LISTA = [], ocupado = false;
  async function pedir(ruta, body, method = 'GET') {
    const r = await api('/marketing' + ruta, body !== undefined ? { method, body: JSON.stringify(body) } : undefined);
    const d = await r.json().catch(() => ({})); if (!r.ok) throw Error(d.error || 'No se pudo completar'); return d;
  }
  const logos = redes => redes.map(r => Marketing.logo(r)).join(' ');
  const nombresRedes = redes => redes.map(r => CAT.redes[r] || r).join(', ');
  // Las que están en revisión: de 3 meses atrás a un año adelante (la lista del servidor pide un rango).
  const enRevision = () => pedir(`/publicaciones?desde=${sumar(hoyTxt(), -90)}&hasta=${sumar(hoyTxt(), 365)}&estado=revision`);
  async function imagenesEn(cont) {
    await Promise.all([...cont.querySelectorAll('img[data-ap-img]')].map(async img => { const u = await Marketing.urlImagen(Number(img.dataset.apImg)); if (u) img.src = u; }));
  }

  // ---------- Por aprobar ----------
  async function contar() {
    const b = $('mk-por-aprobar'); if (!b || !Permisos.puede('marketing.aprobar')) return;
    try { const n = (await enRevision()).length; $('mk-por-aprobar-n').textContent = n; b.classList.toggle('mk-hay', n > 0); } catch { /* el contador no es indispensable */ }
  }
  // El texto de cada red: si todas usan el base, uno solo; si alguna tiene el suyo, uno por red.
  function textos(p) {
    const propias = p.redes.filter(r => p.copy_redes?.[r] !== undefined);
    if (!propias.length) return `<div class="ap-texto"><div class="ap-texto-cab">${logos(p.redes)} <b>Texto</b></div><p>${esc(p.copy) || '<span class="util-45">Sin copy</span>'}</p></div>`;
    return p.redes.map(r => `<div class="ap-texto"><div class="ap-texto-cab">${Marketing.logo(r)} <b>${esc(CAT.redes[r])}</b>${p.copy_redes[r] === undefined ? ' <span class="ayuda">(texto base)</span>' : ''}</div><p>${esc(p.copy_redes[r] ?? p.copy) || '<span class="util-45">Sin copy</span>'}</p></div>`).join('');
  }
  function tarjeta(p) {
    const imgs = p.lista_imagenes || [];
    const galeria = imgs.length ? `<div class="ap-galeria"><img class="ap-grande" alt="${esc(imgs[0].nombre)}" data-ap-img="${Number(imgs[0].id)}" data-ap-grande>${imgs.length > 1 ? `<div class="ap-miniaturas">${imgs.map((i, n) => `<button type="button" data-ap-ver="${Number(i.id)}" aria-label="Ver imagen ${n + 1} de ${imgs.length}" aria-pressed="${n === 0}"><img alt="" data-ap-img="${Number(i.id)}"></button>`).join('')}</div>` : ''}</div>`
      : `<div class="ap-galeria ap-sin-img">${p.enlace ? `🔗 <a href="${esc(p.enlace)}" target="_blank" rel="noopener noreferrer">Ver el video o episodio ↗</a>` : 'Sin imágenes'}</div>`;
    const datos = [fechaLarga(p.fecha) + (p.hora ? ' · ' + p.hora : ''), CAT.formatos[p.formato], p.sucursal_nombre || 'Toda la empresa', p.responsable].filter(Boolean).map(esc).join(' · ');
    return `<article class="ap-tarjeta" data-ap-pub="${Number(p.id)}">${galeria}
      <div class="ap-info"><h3>${esc(p.titulo)}</h3><p class="ap-datos">${logos(p.redes)} ${datos}</p>
        ${textos(p)}${p.hashtags ? `<p class="ap-hash">${esc(p.hashtags)}</p>` : ''}${p.enlace && imgs.length ? `<p><a href="${esc(p.enlace)}" target="_blank" rel="noopener noreferrer">🔗 Ver el video o episodio ↗</a></p>` : ''}
        <div class="ap-acciones"><button type="button" class="btn btn-primario" data-ap-accion="aprobar">✅ Aprobar</button><button type="button" class="btn btn-outline" data-ap-accion="pedir_cambios">↩️ Pedir cambios</button><button type="button" class="btn btn-outline" data-ap-accion="abrir">Abrir ficha</button></div></div></article>`;
  }
  function resumen() { $('ap-resumen').textContent = LISTA.length ? `${LISTA.length} publicación(es) esperan tu aprobación, de la más próxima a la más lejana.` : 'No hay publicaciones por aprobar. 🎉'; }
  async function abrir() {
    try {
      CAT = await Marketing.catalogos();
      $('ap-lista').innerHTML = '<p class="util-45" role="status">Cargando…</p>'; abrirVentana('overlay-aprobar-mk');
      const ids = (await enRevision()).sort((a, b) => (a.fecha + (a.hora || '')).localeCompare(b.fecha + (b.hora || ''))).map(p => p.id);
      LISTA = await Promise.all(ids.map(id => pedir('/publicaciones/' + id)));
      $('ap-lista').innerHTML = LISTA.map(tarjeta).join(''); resumen(); imagenesEn($('ap-lista'));
    } catch (e) { $('ap-lista').innerHTML = `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`; }
  }
  async function accion(art, a) {
    const p = LISTA.find(x => x.id === Number(art.dataset.apPub)); if (!p || ocupado) return;
    if (a === 'abrir') { $('overlay-aprobar-mk').classList.remove('mostrar'); Marketing.abrir(p.id); return; }
    const cuerpo = { accion: a, version: p.version };
    if (a === 'pedir_cambios') { const t = await solicitarDialogo({ titulo: 'Pedir cambios', mensaje: `«${p.titulo}»: le llega a quien la hizo, en Inicio.`, aceptar: 'Pedir cambios', campo: { etiqueta: '¿Qué hay que cambiar?', requerido: 'Escribe qué cambios hacen falta' } }); if (!t) return; cuerpo.comentario = t; }
    ocupado = true;
    try {
      await pedir('/publicaciones/' + p.id + '/estado', cuerpo, 'POST');
      toast(a === 'aprobar' ? `«${p.titulo}» aprobada` : `Se pidieron cambios a «${p.titulo}»`);
      LISTA = LISTA.filter(x => x.id !== p.id); art.remove(); resumen(); contar(); Marketing.cargarCalendario();
    } catch (e) { toast(e.message); } finally { ocupado = false; }
  }

  // ---------- PDF del mes ----------
  async function imprimir() {
    const b = $('mk-imprimir'); if (b.disabled) return; b.disabled = true;
    try {
      CAT = await Marketing.catalogos();
      const f = Marketing.filtros(), d = fechaDe(f.fecha || hoyTxt()), ini = new Date(d.getFullYear(), d.getMonth(), 1), fin = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const q = new URLSearchParams({ desde: iso(ini), hasta: iso(fin), estado: f.estado, q: f.q });
      let lista = (await pedir('/publicaciones?' + q)).filter(p => p.estado !== 'cancelada' || f.estado === 'cancelada');
      if (f.redes.length) lista = lista.filter(p => p.redes.some(r => f.redes.includes(r)));
      lista.sort((a, c) => (a.fecha + (a.hora || '99')).localeCompare(c.fecha + (c.hora || '99')));
      const detalle = await Promise.all(lista.map(p => pedir('/publicaciones/' + p.id)));
      const titulo = MESES[d.getMonth()] + ' ' + d.getFullYear();
      const filtros = [f.estado && 'Estado: ' + CAT.estados[f.estado], f.q && 'Búsqueda: «' + f.q + '»', f.redes.length && 'Redes: ' + nombresRedes(f.redes)].filter(Boolean);
      // Cuadrícula del mes (lunes a domingo).
      const porDia = new Map(); for (const p of detalle) { if (!porDia.has(p.fecha)) porDia.set(p.fecha, []); porDia.get(p.fecha).push(p); }
      let celdas = ''; for (let i = 0; i < (ini.getDay() + 6) % 7; i++) celdas += '<div class="im-dia im-vacio"></div>';
      for (let n = 1; n <= fin.getDate(); n++) {
        const k = iso(new Date(d.getFullYear(), d.getMonth(), n));
        celdas += `<div class="im-dia"><b>${n}</b>${(porDia.get(k) || []).map(p => `<span class="im-chip mk-e-${esc(p.estado)}">${p.hora ? esc(p.hora) + ' ' : ''}${esc(p.titulo)}</span>`).join('')}</div>`;
      }
      const conteo = Object.entries(CAT.estados).map(([k, n]) => [n, detalle.filter(p => p.estado === k).length]).filter(([, c]) => c).map(([n, c]) => `${esc(n)}: <b>${c}</b>`).join(' · ');
      const fichas = detalle.map(p => `<section class="im-pub"><div class="im-pub-img">${p.lista_imagenes[0] ? `<img alt="" data-ap-img="${Number(p.lista_imagenes[0].id)}">` : '<span>Sin imagen</span>'}${p.lista_imagenes.length > 1 ? `<small>${p.lista_imagenes.length} imágenes</small>` : ''}</div>
        <div><h3>${esc(p.titulo)}</h3><p class="im-datos">${esc(fechaLarga(p.fecha))}${p.hora ? ' · ' + esc(p.hora) : ''} · ${esc(nombresRedes(p.redes))} · ${esc(CAT.formatos[p.formato] || '')} · <span class="mk-estado mk-e-${esc(p.estado)}">${esc(CAT.estados[p.estado])}</span></p>
        <p class="im-datos">${esc(p.sucursal_nombre || 'Toda la empresa')} · Responsable: ${esc(p.responsable || '—')}${p.campana ? ' · Campaña: ' + esc(p.campana) : ''}${p.aprobado_por_nombre ? ' · Aprobó: ' + esc(p.aprobado_por_nombre) : ''}</p>
        ${textos(p)}${p.hashtags ? `<p class="ap-hash">${esc(p.hashtags)}</p>` : ''}${p.enlace ? `<p class="im-datos">Enlace: ${esc(p.enlace)}</p>` : ''}</div></section>`).join('');
      let cont = $('mk-impresion'); if (!cont) { cont = document.createElement('div'); cont.id = 'mk-impresion'; document.body.appendChild(cont); }
      cont.innerHTML = `<header class="im-cab"><div><h1>Calendario de publicaciones · ${esc(titulo)}</h1><p>${detalle.length} publicación(es)${conteo ? ' · ' + conteo : ''}${filtros.length ? ' · ' + esc(filtros.join(' · ')) : ''}</p></div><p>Saneadren · ${esc(new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }))}</p></header>
        <div class="im-semana">${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(x => `<span>${x}</span>`).join('')}</div><div class="im-mes">${celdas}</div>
        ${detalle.length ? `<h2 class="im-titulo">Detalle de cada publicación</h2>${fichas}` : '<p>No hay publicaciones este mes con estos filtros.</p>'}`;
      await imagenesEn(cont);
      await Promise.all([...cont.querySelectorAll('img')].map(i => (i.src ? i.decode().catch(() => {}) : null)));
      document.body.classList.add('imprime-mk');
      const quitar = () => { document.body.classList.remove('imprime-mk'); window.removeEventListener('afterprint', quitar); };
      window.addEventListener('afterprint', quitar);
      window.print();
      setTimeout(quitar, 1000); // por si el navegador no avisa «afterprint»
    } catch (e) { toast(e.message); } finally { b.disabled = false; }
  }

  // ---------- Eventos ----------
  $('mk-por-aprobar')?.addEventListener('click', abrir);
  $('mk-imprimir')?.addEventListener('click', imprimir);
  $('ap-cerrar').onclick = () => $('overlay-aprobar-mk').classList.remove('mostrar');
  $('ap-lista').addEventListener('click', async e => {
    const ver = e.target.closest('[data-ap-ver]');
    if (ver) { const art = ver.closest('[data-ap-pub]'), g = art.querySelector('[data-ap-grande]'); g.dataset.apImg = ver.dataset.apVer; g.src = await Marketing.urlImagen(Number(ver.dataset.apVer));
      art.querySelectorAll('[data-ap-ver]').forEach(x => x.setAttribute('aria-pressed', String(x === ver))); return; }
    const g = e.target.closest('[data-ap-grande]'); if (g?.src) { window.open(g.src, '_blank', 'noopener'); return; }
    const b = e.target.closest('[data-ap-accion]'); if (b) accion(b.closest('[data-ap-pub]'), b.dataset.apAccion);
  });
  return { abrir, contar, imprimir };
})();
window.RevisionMk = RevisionMk;
