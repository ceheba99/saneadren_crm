/* Bitácora general (Ajustes → Bitácora, solo administración): qué pasó, a qué, quién y cuándo, en clientes,
   proveedores, órdenes de compra, cuentas por pagar, usuarios, catálogos y registros eliminados. También pinta
   el historial de un registro (p. ej. «Movimientos de este contacto» en la ficha). Servidor: server/auditoria.js */
const Bitacora = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t);
  const ENTIDADES = { cliente: 'Cliente', proveedor: 'Proveedor', orden_compra: 'Orden de compra', solicitud_compra: 'Solicitud de compra', cuenta_por_pagar: 'Cuenta por pagar', usuario: 'Usuario', catalogo: 'Catálogos', orden_servicio: 'Cotización / orden' };
  const fechaHora = f => { const [d, h] = String(f || '').split(' '); return (d || '').split('-').reverse().join('/') + (h ? ' ' + h.slice(0, 5) : ''); };
  const referencia = r => r.entidad === 'cliente' && r.entidad_id ? folioCliente(r.entidad_id) : r.entidad_id ? '#' + r.entidad_id : '';
  let consulta = 0;

  const renglon = (r, conEntidad) => '<tr><td class="st-fecha">' + esc(fechaHora(r.fecha)) + '</td>'
    + (conEntidad ? '<td><span class="bit-entidad">' + esc(ENTIDADES[r.entidad] || r.entidad) + '</span> <small class="util-45">' + esc(referencia(r)) + '</small></td>' : '')
    + '<td><b>' + esc(r.accion) + '</b></td><td class="bit-detalle">' + esc(r.detalle || '') + '</td><td>' + esc(r.usuario || '') + '</td></tr>';
  const tabla = (filas, conEntidad) => '<div class="tabla-scroll"><table class="tabla-resumen bit-tabla"><thead><tr><th>Fecha</th>' + (conEntidad ? '<th>Qué</th>' : '') + '<th>Movimiento</th><th>Detalle</th><th>Quién</th></tr></thead><tbody>'
    + filas.map(r => renglon(r, conEntidad)).join('') + '</tbody></table></div>';

  async function cargar() {
    const turno = ++consulta, cont = $('bit-lista');
    cont.innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    const q = new URLSearchParams();
    for (const [k, id] of [['entidad', 'bit-entidad'], ['desde', 'bit-desde'], ['hasta', 'bit-hasta'], ['q', 'bit-buscar']]) if ($(id).value.trim()) q.set(k, $(id).value.trim());
    let filas;
    try { const r = await api('/auditoria?' + q); filas = await r.json(); if (!r.ok) throw new Error(filas.error); }
    catch (err) { if (turno === consulta) cont.innerHTML = '<p class="aviso-error-carga">' + esc(err.message) + '</p>'; return; }
    if (turno !== consulta) return;
    cont.innerHTML = filas.length ? '<p class="ayuda">' + filas.length + (filas.length === 1000 ? ' movimientos (los 1,000 más recientes; acota con las fechas)' : filas.length === 1 ? ' movimiento' : ' movimientos') + '</p>' + tabla(filas, true)
      : '<p class="util-45">Sin movimientos con estos filtros.</p>';
  }
  // Historial de un registro dentro de otra pantalla.
  async function movimientos(entidad, id, contenedor) {
    const cont = typeof contenedor === 'string' ? $(contenedor) : contenedor;
    if (!cont) return;
    cont.innerHTML = '<p class="util-45">Cargando…</p>';
    try {
      const filas = await api('/auditoria?entidad=' + encodeURIComponent(entidad) + '&id=' + Number(id)).then(r => r.json());
      cont.innerHTML = filas.length ? tabla(filas, false) : '<p class="util-45">Todavía no hay movimientos registrados.</p>';
    } catch (err) { cont.innerHTML = '<p class="aviso-error-carga">' + esc(err.message) + '</p>'; }
  }

  // Historial completo de un cliente (ficha del cliente, hasta abajo).
  let HC = [], HC_CLIENTE = null;
  const GRUPO = { contacto: '👤 Contacto', registro: '📄 Cotización / orden', nota: '📝 Nota / alerta', eliminado: '🗑️ Eliminado' };
  const sinAcentos = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  async function historialCliente(clienteId) {
    HC_CLIENTE = clienteId; HC = [];
    const cont = $('fc-movimientos'); if (!cont) return;
    $('fc-mov-filtro').value = ''; $('fc-mov-buscar').value = '';
    cont.innerHTML = '<p class="util-45">Cargando…</p>';
    try { const r = await api('/clientes/' + Number(clienteId) + '/movimientos'); const j = await r.json(); if (!r.ok) throw new Error(j.error); if (HC_CLIENTE !== clienteId) return; HC = j; }
    catch (err) { cont.innerHTML = '<p class="aviso-error-carga">' + esc(err.message) + '</p>'; return; }
    $('fc-mov-cuenta').textContent = '(' + HC.length + (HC.length === 1 ? ' movimiento)' : ' movimientos)');
    pintarHistorial();
  }
  function pintarHistorial() {
    const cont = $('fc-movimientos'), g = $('fc-mov-filtro').value, q = sinAcentos($('fc-mov-buscar').value.trim());
    const filas = HC.filter(x => (!g || x.grupo === g) && (!q || sinAcentos([x.registro, x.que, x.detalle, x.usuario].join(' ')).includes(q)));
    cont.innerHTML = filas.length ? '<div class="tabla-scroll"><table class="tabla-resumen bit-tabla hc-tabla"><thead><tr><th>Fecha</th><th>Registro</th><th>Qué pasó</th><th>Quién</th></tr></thead><tbody>'
      + filas.map(x => '<tr class="hc-' + esc(x.grupo) + '"><td class="st-fecha">' + esc(fechaHora(x.fecha)) + '</td>'
        + '<td>' + (x.lead_id ? '<button type="button" class="enlace" data-hc-abrir="' + Number(x.lead_id) + '">' + esc(x.registro) + '</button>' : '<b>' + esc(x.registro || '') + '</b>') + '<small class="celda-sub">' + esc(GRUPO[x.grupo] || '') + '</small></td>'
        + '<td><b>' + esc(x.que) + '</b><div class="bit-detalle">' + esc(x.detalle || '') + '</div></td><td>' + esc(x.usuario || '—') + '</td></tr>').join('') + '</tbody></table></div>'
      : '<p class="util-45">' + (HC.length ? 'Nada con ese filtro.' : 'Todavía no hay movimientos.') + '</p>';
  }
  $('fc-mov-filtro')?.addEventListener('change', pintarHistorial);
  $('fc-mov-buscar')?.addEventListener('input', pintarHistorial);
  $('fc-movimientos')?.addEventListener('click', e => { const b = e.target.closest('[data-hc-abrir]'); if (b) abrirFicha(Number(b.dataset.hcAbrir)); });

  let t;
  ['bit-entidad', 'bit-desde', 'bit-hasta'].forEach(id => $(id).addEventListener('change', cargar));
  $('bit-buscar').addEventListener('input', () => { clearTimeout(t); t = setTimeout(cargar, 350); });
  return { cargar, movimientos, tabla, historialCliente };
})();
window.Bitacora = Bitacora;
