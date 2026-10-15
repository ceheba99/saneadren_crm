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

  let t;
  ['bit-entidad', 'bit-desde', 'bit-hasta'].forEach(id => $(id).addEventListener('change', cargar));
  $('bit-buscar').addEventListener('input', () => { clearTimeout(t); t = setTimeout(cargar, 350); });
  return { cargar, movimientos, tabla };
})();
window.Bitacora = Bitacora;
