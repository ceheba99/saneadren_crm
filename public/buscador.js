/* Buscador general: botón «🔍 Buscar» arriba (o Ctrl+K, o «/») que abre una ventana para encontrar cualquier
   cliente, cotización, orden de servicio, solicitud u orden de compra, cuenta por pagar o proveedor por folio,
   nombre, empresa, RFC, teléfono o concepto. Al tocar un resultado se abre donde vive.
   Servidor: server/buscador.js (permisos, límites y consultas seguras están allá). */
const Buscador = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t);
  const ICONOS = { cliente: '👤', cotizacion: '📄', orden_servicio: '🧾', solicitud: '📝', orden_compra: '🛒', cuenta_por_pagar: '📤', proveedor: '🏭' };
  let RESULTADO = null, control = null, turno = 0, temporizador;

  // ---------- Abrir y cerrar ----------
  function abrir(texto) {
    abrirVentana('overlay-buscar');
    const c = $('buscar-caja');
    if (typeof texto === 'string') c.value = texto;
    setTimeout(() => { c.focus(); c.select(); }, 0);
    if (c.value.trim().length >= 2) buscar();
    else pintarAyuda();
  }
  const cerrar = () => $('overlay-buscar').classList.remove('mostrar');
  function pintarAyuda(mensaje) {
    $('buscar-resultados').innerHTML = (mensaje ? '<p class="buscar-aviso">' + esc(mensaje) + '</p>' : '')
      + '<div class="buscar-ayuda"><p>Escribe un folio, nombre, empresa, RFC, teléfono o concepto. Ejemplos:</p><ul>'
      + ['OC-202610-0034', 'COT-202610-0125', 'CLI-0039', 'KFC', '442 555 0101', 'llantas'].map(x => '<li><button type="button" class="buscar-ejemplo" data-ejemplo="' + esc(x) + '">' + esc(x) + '</button></li>').join('')
      + '</ul><p class="util-45">Atajos: <kbd>Ctrl</kbd>+<kbd>K</kbd> o <kbd>/</kbd> para abrir · <kbd>↑</kbd><kbd>↓</kbd> para moverte · <kbd>Enter</kbd> abre · <kbd>Esc</kbd> cierra</p></div>';
  }

  // ---------- Buscar (espera a que dejes de teclear y cancela la búsqueda anterior) ----------
  async function buscar() {
    const q = $('buscar-caja').value.trim();
    if (q.length < 2) { pintarAyuda(); return; }
    const mio = ++turno;
    control?.abort(); control = new AbortController();
    $('buscar-estado').textContent = 'Buscando…';
    let r, j;
    try { r = await fetch('/api/buscar?q=' + encodeURIComponent(q), { headers: { Authorization: 'Bearer ' + USUARIO_ACTUAL?.token }, signal: control.signal }); j = await r.json().catch(() => ({})); }
    catch (err) { if (err.name !== 'AbortError' && mio === turno) { $('buscar-estado').textContent = ''; pintarAyuda('No se pudo buscar: revisa tu conexión.'); } return; }
    if (mio !== turno) return;
    $('buscar-estado').textContent = '';
    if (r.status === 401) { cerrar(); document.getElementById('overlay-login')?.classList.add('mostrar'); return; }
    if (!r.ok) { pintarAyuda(j.error || 'No se pudo buscar'); return; }
    RESULTADO = j; pintar();
  }

  // ---------- Resultados ----------
  const VER_TODOS = { cliente: 'Clientes', cotizacion: 'Cotizaciones', orden_servicio: 'Cotizaciones', solicitud: 'Solicitudes de compra', orden_compra: 'Órdenes de compra' };
  function pintar() {
    const { grupos, exacta, q } = RESULTADO;
    const conDatos = grupos.filter(g => g.items?.length);
    if (!conDatos.length && !grupos.some(g => g.error)) { $('buscar-resultados').innerHTML = '<p class="buscar-vacio">No se encontró nada con «' + esc(q) + '».</p><p class="util-45">Revisa cómo está escrito o busca solo una palabra (por ejemplo, el nombre de la empresa).</p>'; return; }
    const item = (x, tipo) => '<li><button type="button" class="buscar-item' + (x.exacta ? ' exacta' : '') + '" data-tipo="' + esc(tipo) + '" data-id="' + Number(x.id) + '">'
      + '<span class="buscar-icono" aria-hidden="true">' + (ICONOS[tipo] || '•') + '</span>'
      + '<span class="buscar-texto"><span class="buscar-linea1">' + (x.folio ? '<b class="buscar-folio">' + esc(x.folio) + '</b> ' : '') + '<span>' + esc(x.titulo || '') + '</span>' + (x.exacta ? ' <span class="buscar-exacta">coincidencia exacta</span>' : '') + '</span>'
      + (x.detalle ? '<small>' + esc(x.detalle) + '</small>' : '') + '</span>'
      + '<span class="buscar-lado">' + (x.monto != null ? '<b>' + esc(formatoMoneda(x.monto)) + '</b>' : '') + (x.estado ? '<small class="buscar-estado-item">' + esc(x.estado) + '</small>' : '') + (x.fecha ? '<small>' + esc(String(x.fecha).split('-').reverse().join('/')) + '</small>' : '') + '</span>'
      + '</button></li>';
    $('buscar-resultados').innerHTML = (exacta ? '<p class="buscar-aviso ok">Encontrado: <b>' + esc(exacta.folio || '') + '</b>. Pulsa <kbd>Enter</kbd> para abrirlo.</p>' : '')
      + grupos.map(g => '<section class="buscar-grupo"><h3>' + esc(g.titulo) + (g.total ? ' <small>' + Number(g.total) + '</small>' : '') + '</h3>'
        + (g.error ? '<p class="buscar-aviso">' + esc(g.error) + '</p>'
          : '<ul>' + g.items.map(x => item(x, g.tipo)).join('') + '</ul>'
            + (g.total > g.items.length && VER_TODOS[g.tipo] ? '<button type="button" class="buscar-ver-todos" data-ver-todos="' + esc(g.tipo) + '">Ver los ' + Number(g.total) + ' en ' + esc(VER_TODOS[g.tipo]) + ' ›</button>' : ''))
        + '</section>').join('');
    const primero = $('buscar-resultados').querySelector('.buscar-item');
    if (primero) primero.classList.add('activo');
  }

  // ---------- Abrir un resultado donde vive ----------
  const esperar = async (sel, ms = 6000) => { const fin = Date.now() + ms; while (Date.now() < fin) { const el = document.querySelector(sel); if (el) return el; await new Promise(r => setTimeout(r, 120)); } return null; };
  const resaltar = el => { if (!el) return; const fila = el.closest('tr, .fila-dinero, li') || el; fila.scrollIntoView({ block: 'center', behavior: 'smooth' }); fila.classList.add('buscar-resaltado'); setTimeout(() => fila.classList.remove('buscar-resaltado'), 3000); };
  async function abrirResultado(tipo, id) {
    cerrar();
    try {
      if (tipo === 'cliente') return await abrirFichaCliente(id);
      if (tipo === 'cotizacion' || tipo === 'orden_servicio') return await abrirFicha(id);
      if (tipo === 'solicitud') { cambiarVista('solicitudes'); return await Solicitudes.abrir(id); }
      if (tipo === 'orden_compra') { cambiarVista('compras'); return await Compras.abrir(id); }
      if (tipo === 'cuenta_por_pagar') {
        cambiarVista('cuentas', { pestana: 'pagar' });
        const sel = $('pagar-vista'); if (sel && sel.value !== 'todas') { sel.value = 'todas'; sel.dispatchEvent(new Event('change')); }
        const b = await esperar('[data-detalle-cxp="' + Number(id) + '"]');
        if (!b) { toast('No se encontró esa cuenta en la lista'); return; }
        resaltar(b); b.click(); return;
      }
      if (tipo === 'proveedor') {
        cambiarVista('cuentas', { pestana: 'proveedores' });
        resaltar(await esperar('[data-editar-prov="' + Number(id) + '"]')); return;
      }
    } catch (err) { toast(err.message || 'No se pudo abrir'); }
  }
  function verTodos(tipo) {
    const q = RESULTADO?.q || ''; cerrar();
    const poner = (id, valor) => { const el = $(id); if (!el) return; el.value = valor; el.dispatchEvent(new Event('input')); };
    if (tipo === 'cliente') { cambiarVista('clientes'); poner('fc-buscar', q); }
    if (tipo === 'cotizacion' || tipo === 'orden_servicio') { cambiarVista('leads'); poner('f-buscar', q); }
    if (tipo === 'solicitud') { cambiarVista('solicitudes'); $('sol-filtro').value = ''; poner('sol-buscar', q); }
    if (tipo === 'orden_compra') { cambiarVista('compras'); $('oc-filtro').value = ''; poner('oc-buscar', q); }
  }

  // ---------- Teclado y eventos ----------
  function mover(paso) {
    const items = [...$('buscar-resultados').querySelectorAll('.buscar-item')]; if (!items.length) return;
    const i = items.findIndex(x => x.classList.contains('activo'));
    items.forEach(x => x.classList.remove('activo'));
    const nuevo = items[(i + paso + items.length) % items.length];
    nuevo.classList.add('activo'); nuevo.scrollIntoView({ block: 'nearest' });
  }
  $('buscar-caja').addEventListener('input', () => { clearTimeout(temporizador); temporizador = setTimeout(buscar, 250); });
  $('buscar-caja').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); mover(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1); }
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(temporizador);
      const activo = $('buscar-resultados').querySelector('.buscar-item.activo');
      // Si aún no llegan los resultados de lo último que se escribió, busca primero.
      if (!RESULTADO || RESULTADO.q !== $('buscar-caja').value.trim().replace(/\s+/g, ' ')) { buscar().then(() => { const a = $('buscar-resultados').querySelector('.buscar-item.activo'); if (RESULTADO?.exacta && a) abrirResultado(a.dataset.tipo, Number(a.dataset.id)); }); return; }
      if (activo) abrirResultado(activo.dataset.tipo, Number(activo.dataset.id));
    }
  });
  $('buscar-resultados').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ejemplo) { $('buscar-caja').value = b.dataset.ejemplo; buscar(); $('buscar-caja').focus(); return; }
    if (b.dataset.verTodos) { verTodos(b.dataset.verTodos); return; }
    if (b.classList.contains('buscar-item')) abrirResultado(b.dataset.tipo, Number(b.dataset.id));
  });
  $('btn-buscar-general').addEventListener('click', () => abrir());
  document.addEventListener('keydown', e => {
    if (!USUARIO_ACTUAL) return;
    const escribiendo = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); abrir(); }
    else if (e.key === '/' && !escribiendo && !document.querySelector('.overlay.mostrar')) { e.preventDefault(); abrir(); }
  });
  return { abrir };
})();
window.Buscador = Buscador;
