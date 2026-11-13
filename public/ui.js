/* Comportamiento de presentación. No modifica datos ni sustituye reglas del CRM. */
// ---------- Repintar sin que la pantalla «brinque» ----------
// Regla de todo el frontend (2026-11-13, Dirección: «al guardar una zona la página me mandó hasta arriba»):
//  1. «Cargando…» solo si el contenedor está vacío o cambió lo que se ve (otra pestaña, otra fecha, otro registro):
//     Repintado.cargando(contenedor, clave). Al refrescar lo mismo tras guardar, lo de antes se queda hasta que llega lo nuevo.
//  2. Al pintar lo nuevo: Repintado.pintar(contenedor, html) (o conservar(contenedor, fn) si el pintado es más largo)
//     deja el scroll de la ventana, el de la ventana emergente, el horizontal de las tablas y los <details> abiertos como estaban.
//  3. Si falla: Repintado.falla(...) no borra lo que se veía; avisa arriba (avisoCarga de app.js) o con un aviso corto.
window.Repintado = (() => {
  const SCROLLS = '.tabla-scroll, .bitacora-lista, .modal-body, .overlay';
  const estado = c => c?.dataset.rpEstado || '';
  // Ancla del scroll de la ventana: varios repintados seguidos (p. ej. todos los bloques de Inicio) comparten el mismo punto de
  // partida, y un último ajuste en el siguiente cuadro corrige si algo (un bloque que se encogió y volvió a crecer) lo movió de
  // pasada. Si la persona toca, rueda o teclea, el ancla se suelta: nunca se pelea con quien está desplazando la pantalla.
  let ancla = null;
  const soltar = () => { ancla = null; };
  if (typeof window.addEventListener === 'function') for (const ev of ['wheel', 'touchstart', 'touchmove', 'keydown', 'pointerdown', 'mousedown']) window.addEventListener(ev, soltar, { passive: true, capture: true });
  function anclar() {
    const ahora = Date.now();
    if (!ancla || ahora - ancla.t > 400) ancla = { x: window.scrollX, y: window.scrollY, t: ahora };
    else ancla.t = ahora;
    return ancla;
  }
  function capturar(raiz) {
    const anc = anclar();
    const est = { x: anc.x, y: anc.y, a: anc, fuera: [], dentro: [], abiertos: new Set(), enfocado: null };
    const dentro = raiz ? [...raiz.querySelectorAll(SCROLLS)] : [];
    document.querySelectorAll(SCROLLS).forEach(el => {
      if (raiz && raiz !== el && raiz.contains(el)) return;      // los de adentro se guardan por posición
      if (el.scrollTop || el.scrollLeft) est.fuera.push([el, el.scrollTop, el.scrollLeft]);
    });
    if (raiz && (raiz.scrollTop || raiz.scrollLeft) && !est.fuera.some(f => f[0] === raiz)) est.fuera.push([raiz, raiz.scrollTop, raiz.scrollLeft]);
    dentro.forEach((el, i) => { if (el.scrollTop || el.scrollLeft) est.dentro.push([i, el.scrollTop, el.scrollLeft]); });
    if (raiz) raiz.querySelectorAll('details').forEach((d, i) => { if (d.open) est.abiertos.add(d.id || ('#' + i)); });
    const a = document.activeElement;
    if (raiz && a && a.id && raiz.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) est.enfocado = a.id;
    return est;
  }
  function restaurar(raiz, est) {
    if (!est) return;
    if (raiz) {
      raiz.querySelectorAll('details').forEach((d, i) => { if (est.abiertos.has(d.id || ('#' + i))) d.open = true; });
      const dentro = [...raiz.querySelectorAll(SCROLLS)];
      est.dentro.forEach(([i, t, l]) => { const el = dentro[i]; if (el) { el.scrollTop = t; el.scrollLeft = l; } });
    }
    est.fuera.forEach(([el, t, l]) => { if (el.isConnected) { el.scrollTop = t; el.scrollLeft = l; } });
    if (window.scrollY !== est.y || window.scrollX !== est.x) window.scrollTo({ left: est.x, top: est.y, behavior: 'instant' });
    if (est.a && typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => {
      if (ancla === est.a && Math.abs(window.scrollY - est.a.y) > 1) window.scrollTo({ left: est.a.x, top: est.a.y, behavior: 'instant' });
    });
  }
  // Pinta y deja todo donde estaba. «fn» puede ser síncrona o async (se restaura al terminar).
  function conservar(raiz, fn) {
    const est = capturar(raiz);
    const fin = () => { restaurar(raiz, est); if (raiz) { raiz.dataset.rpEstado = 'listo'; quitarAviso(raiz); } };
    const r = fn();
    if (r && typeof r.then === 'function') return r.then(v => { fin(); return v; });
    fin(); return r;
  }
  const pintar = (raiz, html) => conservar(raiz, () => { raiz.innerHTML = html; });
  function quitarAviso(raiz) {
    if (!raiz.dataset.rpAviso) return;           // solo quita el aviso que este mismo contenedor puso
    delete raiz.dataset.rpAviso;
    const sec = raiz.closest?.('section[id^="vista-"]');
    if (sec && typeof avisoCarga === 'function') avisoCarga(sec.id.replace(/^vista-/, ''));
  }
  // «Cargando…» solo si está vacío, si venía de un error o si cambió lo que se ve (clave distinta).
  function cargando(raiz, clave = '', html = '<p class="util-45" role="status">Cargando…</p>', forzar = false) {
    if (!raiz) return false;
    const k = String(clave);
    const igual = raiz.dataset.rpClave === undefined || raiz.dataset.rpClave === k;
    raiz.dataset.rpClave = k;
    if (!forzar && raiz.innerHTML.trim() && estado(raiz) !== 'error' && igual) return false;
    raiz.innerHTML = html; raiz.dataset.rpEstado = 'cargando';
    return true;
  }
  // Si lo de antes sigue a la vista, NO se borra: se avisa arriba (vista) o con un aviso corto (ventana emergente).
  function falla(raiz, err, reintentar, htmlError, vista) {
    if (!raiz) return;
    if (err && err.status === 401) return;
    const conserva = raiz.innerHTML.trim() && !['cargando', 'error'].includes(estado(raiz));
    if (conserva) {
      const v = vista || raiz.closest?.('section[id^="vista-"]')?.id.replace(/^vista-/, '');
      if (v && typeof avisoCarga === 'function') { raiz.dataset.rpAviso = '1'; avisoCarga(v, err, reintentar); }
      else if (typeof toast === 'function') toast('No se pudo actualizar: ' + (err?.message || 'sin conexión'));
      return;
    }
    raiz.innerHTML = htmlError; raiz.dataset.rpEstado = 'error';
  }
  return { capturar, restaurar, conservar, pintar, cargando, falla };
})();
// Mostrar / ocultar contraseña: cada campo de contraseña lleva un botón «Mostrar» que la deja ver mientras se
// escribe. Al enviar el formulario vuelve a ocultarse (por si la pantalla queda a la vista de alguien).
window.prepararOjo = input => {
  if (!input || input.dataset.ojo) return;
  input.dataset.ojo = '1';
  const caja = document.createElement('span');
  caja.className = 'campo-pass';
  input.parentNode.insertBefore(caja, input);
  caja.appendChild(input);
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'ojo-pass'; b.textContent = '👁 Mostrar'; b.setAttribute('aria-label', 'Mostrar contraseña'); b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => {
    const ver = input.type === 'password';
    input.type = ver ? 'text' : 'password';
    b.textContent = ver ? '🙈 Ocultar' : '👁 Mostrar';
    b.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña'); b.setAttribute('aria-pressed', String(ver));
    input.focus();
  });
  caja.appendChild(b);
};
window.ocultarContrasenas = (raiz = document) => raiz.querySelectorAll('input[data-ojo]').forEach(i => {
  if (i.type === 'text' && i.dataset.esPassword !== '0') i.type = 'password';
  const b = i.parentNode.querySelector('.ojo-pass'); if (b) { b.textContent = '👁 Mostrar'; b.setAttribute('aria-label', 'Mostrar contraseña'); b.setAttribute('aria-pressed', 'false'); }
});
document.querySelectorAll('input[type="password"]').forEach(window.prepararOjo);
document.addEventListener('submit', e => window.ocultarContrasenas(e.target), true);
(() => {
  const layer = document.createElement('div');
  layer.className = 'overlay';
  layer.id = 'overlay-confirmacion';
  layer.innerHTML = `<div class="modal dialogo-confirmacion"><div class="modal-header"><h2 id="dialogo-titulo"></h2><button class="close-btn" type="button" aria-label="Cerrar ventana">✕</button></div><div class="modal-body dialogo-contenido"><p class="dialogo-mensaje" id="dialogo-mensaje"></p><div class="campo" id="dialogo-campo-wrap" hidden><label for="dialogo-campo">Valor</label><input id="dialogo-campo" autocomplete="new-password" maxlength="128"><p class="dialogo-campo-aviso" id="dialogo-campo-aviso" role="alert" hidden></p></div><div class="dialogo-acciones"><button class="btn btn-secundario" id="dialogo-cancelar">Cancelar</button><button class="btn btn-peligro" id="dialogo-aceptar"></button></div></div></div>`;
  document.body.append(layer);
  // «¿Es el mismo cliente?»: cuando el CRM encuentra clientes parecidos antes de crear uno nuevo.
  // Resuelve { mismo: id } (agregar el teléfono a ese cliente), { distinto: [ids] } (crear uno nuevo) o null (cancelar).
  const dup = document.createElement('div');
  dup.className = 'overlay'; dup.id = 'overlay-duplicado';
  dup.innerHTML = '<div class="modal modal-duplicado"><div class="modal-header"><div><span class="flujo-kicker">REVISIÓN PARA NO DUPLICAR</span><h2>¿Es el mismo cliente?</h2></div><button class="close-btn" type="button" aria-label="Cerrar ventana">✕</button></div>'
    + '<div class="modal-body"><p class="dup-texto" id="dupc-texto"></p><div class="dup-lista" id="dupc-lista"></div>'
    + '<div class="dialogo-acciones"><button class="btn btn-secundario" type="button" id="dupc-cancelar">Cancelar</button><button class="btn btn-primario" type="button" id="dupc-otro">No, es otro cliente: crearlo</button></div></div></div>';
  document.body.append(dup);
  const escDup = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.folioCliente = id => (id ? 'CLI-' + String(id).padStart(4, '0') : '');
  window.resolverDuplicado = (parecidos, { nombre = '', telefono = '', mensaje = '', otro = 'No, es otro cliente: crearlo' } = {}) => new Promise(resolve => {
    const fin = v => { dup.classList.remove('mostrar'); resolve(v); };
    document.getElementById('dupc-texto').textContent = mensaje || ('Vas a registrar «' + nombre + '»' + (telefono ? ' con el teléfono ' + telefono : '') + '. Ya existe' + (parecidos.length > 1 ? 'n estos clientes parecidos' : ' un cliente parecido') + '. Si es el mismo, se le agrega este teléfono y no se crea otro.');
    document.getElementById('dupc-otro').textContent = otro;
    document.getElementById('dupc-lista').innerHTML = parecidos.map(p => '<div class="dup-item"><div><b>' + escDup(p.folio) + ' · ' + escDup(p.empresa || p.nombre) + '</b>'
      + '<small>' + escDup([p.empresa && p.nombre !== p.empresa ? p.nombre : '', p.otra_sucursal ? 'sus datos no se muestran' : p.telefono ? 'tel. ' + p.telefono : 'sin teléfono', p.rfc ? 'RFC ' + p.rfc : ''].filter(Boolean).join(' · ')) + '</small>'
      + '<small class="dup-motivo">' + escDup(p.motivo || '') + '</small></div><button type="button" class="btn btn-verde btn-chico" data-dup-mismo="' + Number(p.id) + '">Es este</button></div>').join('');
    document.getElementById('dupc-lista').onclick = e => { const b = e.target.closest('[data-dup-mismo]'); if (b) fin({ mismo: Number(b.dataset.dupMismo) }); };
    document.getElementById('dupc-otro').onclick = () => fin({ distinto: parecidos.map(p => p.id) });
    document.getElementById('dupc-cancelar').onclick = () => fin(null);
    dup.querySelector('.close-btn').onclick = () => fin(null);
    dup.classList.add('mostrar');
  });
  let resolver = null;
  const finish = value => { layer.classList.remove('mostrar'); const done = resolver; resolver = null; if(done) done(value); };
  layer.querySelector('.close-btn').onclick = () => finish(null);
  document.getElementById('dialogo-cancelar').onclick = () => finish(null);
  // Con `campo` el diálogo pide un dato (p. ej. { tipo: 'password' }) y resuelve con lo escrito.
  // Con `soloAviso` es un aviso informativo: solo el botón de aceptar.
  window.solicitarDialogo = ({titulo,mensaje,aceptar='Confirmar',campo=null,soloAviso=false}) => {
    if(resolver) return Promise.resolve(null);
    document.getElementById('dialogo-cancelar').hidden = soloAviso;
    document.getElementById('dialogo-titulo').textContent = titulo;
    document.getElementById('dialogo-mensaje').textContent = mensaje;
    document.getElementById('dialogo-aceptar').textContent = aceptar;
    const wrap = document.getElementById('dialogo-campo-wrap'), input = document.getElementById('dialogo-campo');
    wrap.hidden = !campo; input.value = ''; input.type = campo?.tipo || 'text';
    // En el diálogo el campo cambia de tipo: el botón «Mostrar» solo aparece cuando pide una contraseña.
    window.prepararOjo(input);
    input.dataset.esPassword = campo?.tipo === 'password' ? '1' : '0';
    input.parentNode.querySelector('.ojo-pass').hidden = campo?.tipo !== 'password';
    window.ocultarContrasenas(wrap);
    wrap.querySelector('label').textContent = campo?.etiqueta || (campo?.tipo === 'password' ? 'Contraseña' : 'Valor');
    // Con campo.requerido, si está vacío no se cierra: se marca el campo y se dice qué falta.
    const avisoCampo = document.getElementById('dialogo-campo-aviso');
    if (avisoCampo) avisoCampo.hidden = true;
    input.classList.remove('campo-error');
    document.getElementById('dialogo-aceptar').onclick = () => {
      if (campo?.requerido && !input.value.trim()) { input.classList.add('campo-error'); if (avisoCampo) { avisoCampo.textContent = campo.requerido; avisoCampo.hidden = false; } input.focus(); return; }
      finish(campo ? (input.value || null) : true);
    };
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('dialogo-aceptar').click(); } };
    if (campo) setTimeout(() => input.focus(), 0);
    layer.classList.add('mostrar');
    return new Promise(resolve => { resolver = resolve; });
  };
  const overlays = [...document.querySelectorAll('.overlay')];
  let stack = [];
  const previousFocus = new Map();
  const focusable = el => [...el.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(e=>!e.disabled && !e.closest('[hidden]') && e.getClientRects().length);
  overlays.forEach((overlay,i) => {
    const modal = overlay.querySelector('.modal');
    const title = modal.querySelector('h2');
    if(!title.id) title.id = 'ventana-titulo-'+i;
    modal.setAttribute('role','dialog'); modal.setAttribute('aria-labelledby',title.id); modal.tabIndex=-1;
    overlay.querySelectorAll('.close-btn').forEach(b=>{ b.setAttribute('aria-label','Cerrar ventana'); b.type='button'; });
  });
  function sync() {
    const open = overlays.filter(o=>o.classList.contains('mostrar'));
    const removed = stack.filter(o=>!open.includes(o));
    stack = stack.filter(o=>open.includes(o));
    open.filter(o=>!stack.includes(o)).forEach(o=>{ previousFocus.set(o,document.activeElement);stack.push(o); });
    const top = stack.at(-1);
    if(top) window.Plegables?.actualizarResumenes(top); // los datos se cargan antes de abrir la ventana
    document.body.classList.toggle('modal-abierta',!!top);
    document.querySelectorAll('body > header,body > main').forEach(e=>e.inert=!!top);
    overlays.forEach(o=>{
      const active=o===top;
      o.inert=!active;
      o.classList.toggle('modal-superior',active);
      o.setAttribute('aria-hidden',String(!active));
      o.querySelector('.modal').setAttribute('aria-modal',String(active));
    });
    if(top && !top.contains(document.activeElement)) {
      const restored = removed.length ? previousFocus.get(removed.at(-1)) : null;
      const target = restored && top.contains(restored) && restored.isConnected ? restored : (top===layer ? document.getElementById('dialogo-cancelar') : focusable(top)[0]);
      (target || top.querySelector('.modal')).focus();
    } else if(!top && removed.length) {
      const restored=previousFocus.get(removed[0]);
      if(restored?.isConnected && !restored.closest('[inert]') && restored.getClientRects().length) restored.focus();
      else window.MenuPrincipal?.enfocar();
    }
  }
  window.abrirVentana = id => {
    const overlay = document.getElementById(id);
    previousFocus.set(overlay,document.activeElement);
    overlay.classList.add('mostrar');
    stack = stack.filter(o=>o!==overlay);
    stack.push(overlay);
    sync();
  };
  const observer=new MutationObserver(records=>{ if(records.some(r=>(r.type==='childList' && stack.at(-1) && !stack.at(-1).contains(document.activeElement)) || (r.attributeName==='class' && overlays.includes(r.target) && r.target.classList.contains('mostrar') !== (r.oldValue||'').split(/\s+/).includes('mostrar')))) sync(); });
  overlays.forEach(o=>observer.observe(o,{attributes:true,attributeFilter:['class'],attributeOldValue:true,childList:true,subtree:true}));
  // Red de seguridad: la ✕ (y Esc, que la presiona) SIEMPRE cierra su ventana, aunque esa ventana no tenga su propio
  // manejo. Corre al final (fase de burbuja y en el siguiente ciclo): el aviso de «cambios sin guardar» de flujo.js
  // detiene el clic antes, así que si hay cambios sin guardar primero se pregunta.
  document.addEventListener('click',e=>{
    const cerrar=e.target.closest('.close-btn'); const overlay=cerrar?.closest('.overlay');
    if(!overlay || overlay.id==='overlay-login') return;
    setTimeout(()=>{ if(overlay.classList.contains('mostrar')) overlay.classList.remove('mostrar'); },0);
  });
  document.addEventListener('keydown',e=>{
    const top=stack.at(-1);if(!top)return;
    if(e.key==='Escape') {e.preventDefault();if(top.id!=='overlay-login')top.querySelector('.close-btn')?.click();}
    if(e.key==='Tab') {
      const items=focusable(top); const first=items[0],last=items.at(-1);
      if(!first){e.preventDefault();top.querySelector('.modal').focus();return;}
      if(e.shiftKey && (document.activeElement===first || !items.includes(document.activeElement))){e.preventDefault();last.focus();}
      else if(!e.shiftKey && (document.activeElement===last || !items.includes(document.activeElement))){e.preventDefault();first.focus();}
    }
  });
  document.querySelectorAll('.campo,.campo-modal').forEach(c=>{const label=c.querySelector('label');const input=c.querySelector('input,select,textarea');if(label && input?.id)label.htmlFor=input.id;});
  document.querySelectorAll('.kpi-card,.pipeline-step').forEach(e=>{e.tabIndex=0;e.setAttribute('role','button');e.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();e.click();}});});
  sync();
})();

/* ===================== Secciones plegables =====================
   Una sección con data-plegable="nombre" se pliega y despliega tocando su título (o su
   cabecera marcada con data-plegable-cabecera). El estado se recuerda en este navegador.
   data-plegado-defecto="1" la deja plegada la primera vez; data-resumen-campos="id1,id2"
   muestra esos valores como resumen mientras está plegada. */
const Plegables = (() => {
  const clave = n => 'plegado:' + n;
  const leer = n => { try { return localStorage.getItem(clave(n)); } catch { return null; } };
  const guardar = (n, v) => { try { localStorage.setItem(clave(n), v ? '1' : '0'); } catch { /* sin almacenamiento: solo dura la sesión */ } };
  // La cabecera es el título de la sección (o un elemento marcado con data-plegable-cabecera, aunque
  // esté anidado); nunca la de una sección plegable interior.
  const cabecera = sec => [...sec.querySelectorAll('[data-plegable-cabecera]')].find(c => c.closest('[data-plegable]') === sec)
    || sec.querySelector(':scope > .seccion-tit');
  // Hijo directo de la sección que contiene la cabecera: se mantiene visible al plegar.
  const fila = sec => { let c = cabecera(sec); while (c && c.parentElement !== sec) c = c.parentElement; return c; };
  const conCambios = sec => !!sec.querySelector('.estado-guardado.pendiente');
  function actualizarResumen(sec) {
    const res = sec.querySelector(':scope > .plegable-resumen');
    if (!res) return;
    const campos = (sec.dataset.resumenCampos || '').split(',').filter(Boolean);
    const pendiente = sec.classList.contains('plegada') && conCambios(sec);
    res.classList.toggle('pendiente', pendiente);
    // Con cambios sin guardar se avisa en vez de mostrar los datos editados como si ya estuvieran guardados.
    if (pendiente) { res.textContent = '⚠ Cambios sin guardar — toca para verlos y guardarlos'; res.hidden = false; return; }
    if (!sec.classList.contains('plegada') || !campos.length) { res.hidden = true; return; }
    const texto = campos.map(id => document.getElementById(id)?.value?.trim()).filter(Boolean).join(' · ');
    res.textContent = (texto || 'Sin datos capturados') + ' — toca para ver o editar';
    res.hidden = false;
  }
  function aplicar(sec, plegada) {
    sec.classList.toggle('plegada', plegada);
    cabecera(sec)?.setAttribute('aria-expanded', String(!plegada));
    actualizarResumen(sec);
  }
  function alternar(sec) {
    if (!sec) return;
    const plegada = !sec.classList.contains('plegada');
    aplicar(sec, plegada);
    guardar(sec.dataset.plegable, plegada);
  }
  function preparar(raiz = document) {
    raiz.querySelectorAll('[data-plegable]').forEach(sec => {
      if (sec.dataset.plegableListo) return;
      const cab = cabecera(sec);
      if (!cab) return;
      sec.dataset.plegableListo = '1';
      cab.classList.add('plegable-cabecera');
      fila(sec).classList.add('plegable-fila');
      cab.setAttribute('role', 'button');
      cab.tabIndex = 0;
      const res = document.createElement('div');
      res.className = 'plegable-resumen'; res.hidden = true;
      fila(sec).after(res);
      const guardado = leer(sec.dataset.plegable);
      aplicar(sec, guardado === null ? sec.dataset.plegadoDefecto === '1' : guardado === '1');
    });
  }
  document.addEventListener('click', e => {
    const res = e.target.closest('.plegable-resumen');
    if (res) return alternar(res.closest('[data-plegable]'));
    const cab = e.target.closest('.plegable-cabecera');
    if (!cab) return;
    // Los botones dentro de una cabecera (p. ej. "Crear cotización") hacen lo suyo, no pliegan.
    const control = e.target.closest('button, a, input, select, textarea, label');
    if (control && control !== cab) return;
    alternar(cab.closest('[data-plegable]'));
  });
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('plegable-cabecera')) { e.preventDefault(); alternar(e.target.closest('[data-plegable]')); }
  });
  document.addEventListener('input', e => { const sec = e.target.closest?.('[data-plegable][data-resumen-campos]'); if (sec) actualizarResumen(sec); });
  preparar();
  // Despliega las secciones plegadas que tienen cambios sin guardar (p. ej. al elegir "volver" en el aviso).
  const mostrarCambios = raiz => raiz.querySelectorAll('[data-plegable].plegada').forEach(sec => { if (conCambios(sec)) aplicar(sec, false); });
  return { preparar, mostrarCambios, actualizarResumenes: (raiz = document) => raiz.querySelectorAll('[data-plegable]').forEach(actualizarResumen) };
})();
window.Plegables = Plegables;

/* ===================== Menú principal =====================
   Escritorio: barra con grupos desplegables (Ventas, Finanzas, Ajustes).
   Celular: un botón "☰ Menú" y categorías plegables con sus secciones. */
const MenuPrincipal = (() => {
  const nav = document.getElementById('menu-principal');
  if (!nav) return { marcar() {} };
  const movil = document.getElementById('menu-movil');
  const cerrarGrupos = excepto => nav.querySelectorAll('.menu-grupo.abierto').forEach(g => {
    if (g === excepto) return;
    g.classList.remove('abierto');
    g.querySelector('.menu-grupo-btn').setAttribute('aria-expanded', 'false');
  });
  const cerrarPanel = () => { cerrarGrupos(); nav.classList.remove('abierta'); movil.setAttribute('aria-expanded', 'false'); };
  const esMovil = () => matchMedia('(max-width:900px)').matches;
  const visible = el => !!el && el.getClientRects().length > 0;
  // Elemento visible del menú que representa la sección actual (para devolverle el foco).
  function enfocar() {
    const destino = [movil, nav.querySelector('.menu-grupo.activa > .menu-grupo-btn'), nav.querySelector('[data-vista].activa')].find(visible);
    destino?.focus({ preventScroll: true });
  }
  // Las categorías se pueden abrir con clic, toque o teclado en cualquier tamaño.
  function ajustarGrupos() {
    nav.querySelectorAll('.menu-grupo-btn').forEach(b => {
      const grupo = b.closest('.menu-grupo'), sub = grupo.querySelector('.menu-sub');
      sub.id ||= 'menu-sub-' + grupo.dataset.grupo;
      b.removeAttribute('tabindex');
      b.removeAttribute('aria-hidden');
      b.setAttribute('aria-controls', sub.id);
      b.setAttribute('aria-expanded', String(grupo.classList.contains('abierto')));
    });
  }
  ajustarGrupos();
  // El submenú de un grupo pegado a la orilla derecha (Finanzas, Ajustes) se salía de la pantalla: la página quedaba más
  // ancha que la franja negra. Si no cabe, se abre hacia la izquierda, alineado al lado derecho de su botón.
  function alinearSub(grupo) {
    const sub = grupo.querySelector('.menu-sub'); if (!sub || esMovil()) return;
    grupo.classList.remove('sub-derecha');
    if (sub.getBoundingClientRect().right > document.documentElement.clientWidth - 8) grupo.classList.add('sub-derecha');
  }
  matchMedia('(max-width:900px)').addEventListener?.('change', () => { cerrarGrupos(); cerrarPanel(); ajustarGrupos(); });
  // El submenú se cierra cuando el foco sale de él (Tab).
  nav.querySelectorAll('.menu-grupo').forEach(g => g.addEventListener('focusout', e => { if (!esMovil() && !g.contains(e.relatedTarget)) cerrarGrupos(); }));
  movil.addEventListener('click', () => {
    const abrir = !nav.classList.contains('abierta');
    cerrarGrupos();
    nav.classList.toggle('abierta', abrir);
    movil.setAttribute('aria-expanded', String(abrir));
  });
  nav.addEventListener('click', e => {
    const btnGrupo = e.target.closest('.menu-grupo-btn');
    if (btnGrupo) {
      const grupo = btnGrupo.closest('.menu-grupo');
      const abrir = !grupo.classList.contains('abierto');
      cerrarGrupos(grupo);
      grupo.classList.toggle('abierto', abrir);
      btnGrupo.setAttribute('aria-expanded', String(abrir));
      if (abrir) alinearSub(grupo);
      return;
    }
    const elegido = e.target.closest('[data-vista]');
    if (elegido) {
      cerrarGrupos(); cerrarPanel();
      // El botón elegido puede quedar oculto: el foco pasa a un control visible del menú.
      setTimeout(enfocar, 0);
    }
  });
  document.addEventListener('click', e => { if (!nav.contains(e.target)) { cerrarGrupos(); cerrarPanel(); } });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const grupo = nav.querySelector('.menu-grupo.abierto');
    if (!grupo && !nav.classList.contains('abierta')) return;
    const dentro = nav.contains(document.activeElement);
    cerrarGrupos(); cerrarPanel();
    if (dentro) (grupo?.querySelector('.menu-grupo-btn') || movil).focus();
  });
  // Texto visible de un botón, sin el ícono ni el contador.
  const texto = b => [...b.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
  function marcar(vista) {
    nav.querySelectorAll('[data-vista]').forEach(b => {
      const activa = b.dataset.vista === vista;
      b.classList.toggle('activa', activa);
      if (activa) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    nav.querySelectorAll('.menu-grupo').forEach(g => g.classList.toggle('activa', !!g.querySelector('[data-vista].activa')));
    const actual = [...nav.querySelectorAll('[data-vista].activa')].find(b => getComputedStyle(b).display !== 'none') || nav.querySelector('[data-vista].activa');
    document.getElementById('menu-actual').textContent = actual ? texto(actual) : '';
  }
  // Un grupo sin nada que ver para el rol (p. ej. Finanzas para quien solo hace Marketing) no se muestra vacío.
  // Lo llama permisos.js cada vez que pinta los permisos.
  function ocultarVacios() {
    nav.querySelectorAll('.menu-grupo').forEach(g => {
      g.classList.remove('menu-vacio');
      g.classList.toggle('menu-vacio', ![...g.querySelectorAll('.menu-sub .menu-item')].some(b => getComputedStyle(b).display !== 'none'));
    });
  }
  // También cuando cambian las clases del body que esconden opciones (cobranza, solo Dirección…), que llegan después.
  new MutationObserver(ocultarVacios).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return { marcar, enfocar, ocultarVacios };
})();
window.MenuPrincipal = MenuPrincipal;
