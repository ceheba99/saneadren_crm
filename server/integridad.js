// Revisión de integridad: recorre los datos YA guardados y busca incongruencias (fechas imposibles, montos que no
// cuadran, cobros de más, facturas repetidas, órdenes sin su cuenta por pagar, archivos perdidos…). No cambia
// nada: solo informa. Sirve para datos viejos, cargas de Excel o cualquier cosa que se haya colado.
// Solo administración. Ajustes → Usuarios → «Revisar integridad de los datos».
const fs = require('fs');
const path = require('path');
const Importes = require('../public/importes.js');
const { hoyMexico } = require('./fechas');

const folioL = l => require('./sucursales').folioLead(l);
const folioOC = o => require('./sucursales').folio('OC', 'ordenes_compra', o.id, o.created_at);
const folioSol = s => require('./sucursales').folio('SOL', 'solicitudes_compra', s.id, s.created_at);
const pesos = c => '$' + (Number(c || 0) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dma = f => String(f || '').slice(0, 10).split('-').reverse().join('/');
const existe = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const columnas = (db, t) => existe(db, t) ? db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name) : [];

function revisar(db, { dirArchivos } = {}) {
  const hoy = hoyMexico(), ahora = db.prepare("SELECT datetime('now','localtime', '+5 minutes') t").get().t;
  const R = [];
  // Cada revisión: grupo, qué se busca, gravedad (error = algo está mal; aviso = revisar) y los casos encontrados.
  const chequeo = (grupo, titulo, gravedad, fn) => {
    let casos;
    try { casos = fn() || []; } catch (err) { casos = [{ ref: '—', detalle: 'No se pudo revisar: ' + err.message }]; gravedad = 'error'; }
    R.push({ grupo, titulo, gravedad, casos: casos.slice(0, 200), total: casos.length });
  };
  const L = existe(db, 'leads') ? db.prepare('SELECT * FROM leads').all() : [];
  const leadPorId = new Map(L.map(l => [l.id, l]));
  const cobros = existe(db, 'cobros') ? db.prepare('SELECT * FROM cobros').all() : [];
  const cobradoDe = id => cobros.filter(k => k.lead_id === id && !k.cancelado && k.tipo !== 'ajuste').reduce((t, k) => t + k.monto_cent, 0);
  const totalOrden = l => l.factura_total_cent != null ? l.factura_total_cent : Math.round(Number(l.valor || 0) * 100) + (l.iva_cent || 0);

  // ---------- Base de datos ----------
  chequeo('Base de datos', 'El archivo de la base está sano (integrity_check)', 'error', () => {
    const r = db.prepare('PRAGMA integrity_check').all().map(x => Object.values(x)[0]);
    return r.length === 1 && r[0] === 'ok' ? [] : r.map(x => ({ ref: 'base', detalle: x }));
  });
  chequeo('Base de datos', 'Referencias rotas entre tablas (foreign_key_check)', 'error', () =>
    db.prepare('PRAGMA foreign_key_check').all().map(x => ({ ref: x.table + ' #' + x.rowid, detalle: 'apunta a ' + x.parent + ' que no existe' })));
  // Sucursales: todo registro operativo debe tener sucursal (sin ella nadie más que el admin general lo ve),
  // la cotización/orden y sus gastos deben ser de la misma sucursal, y los folios no se repiten dentro de una sucursal.
  if (existe(db, 'sucursales')) {
    chequeo('Sucursales', 'Registros sin sucursal', 'error', () => ['leads', 'cuentas_por_pagar', 'solicitudes_compra', 'ordenes_compra', 'establecimientos', 'clientes']
      .filter(t => existe(db, t) && db.prepare('PRAGMA table_info(' + t + ')').all().some(c => c.name === 'sucursal_id'))
      .flatMap(t => db.prepare('SELECT id FROM main.' + t + ' WHERE sucursal_id IS NULL').all().map(r => ({ ref: t + ' #' + r.id, detalle: 'no tiene sucursal' }))));
    chequeo('Sucursales', 'Gasto de una orden registrado en otra sucursal', 'error', () => existe(db, 'cuentas_por_pagar') ? db.prepare('SELECT x.id, x.concepto FROM main.cuentas_por_pagar x JOIN main.leads l ON l.id = x.lead_id WHERE x.sucursal_id IS NOT l.sucursal_id').all().map(r => ({ ref: 'cuenta por pagar #' + r.id, detalle: r.concepto })) : []);
    chequeo('Sucursales', 'Orden de compra en otra sucursal que su solicitud', 'error', () => existe(db, 'ordenes_compra') ? db.prepare('SELECT o.id, o.created_at, o.folio_num, o.sucursal_id FROM main.ordenes_compra o JOIN main.solicitudes_compra s ON s.id = o.solicitud_id WHERE o.sucursal_id IS NOT s.sucursal_id').all().map(o => ({ ref: folioOC(o), detalle: 'su solicitud es de otra sucursal' })) : []);
  }
  chequeo('Base de datos', 'Hay al menos un administrador activo', 'error', () =>
    db.prepare("SELECT COUNT(*) n FROM usuarios WHERE rol = 'admin' AND activo = 1").get().n ? [] : [{ ref: 'usuarios', detalle: 'No hay administradores activos' }]);

  // ---------- Ventas: cotizaciones y órdenes ----------
  // Qué ve cada rol (permisos.js): con «lo suyo», un vendedor ve sus cotizaciones y un técnico sus órdenes asignadas.
  const activos = new Set(db.prepare('SELECT id FROM usuarios WHERE activo = 1').all().map(u => u.id));
  chequeo('Qué ve cada rol', 'Cotizaciones u órdenes vivas sin responsable activo', 'aviso', () => L.filter(l => (l.estatus === 'abierto' || (l.estatus === 'ganado' && !l.ejecucion)) && !activos.has(l.responsable_id))
    .map(l => ({ ref: folioL(l), detalle: (l.responsable_id ? 'su responsable está desactivado' : 'no tiene responsable') + ': solo la ve quien ve toda su sucursal; asígnala a un vendedor' })));
  const conResponsable = new Set(existe(db, 'orden_personal') ? db.prepare("SELECT op.lead_id FROM orden_personal op JOIN personal p ON p.id = op.personal_id WHERE op.papel = 'responsable' AND p.activo = 1").all().map(r => r.lead_id) : []);
  if (existe(db, 'personal')) chequeo('Personal', 'Licencias de manejo vencidas (personal activo)', 'aviso', () => db.prepare('SELECT id, nombre, licencia_vence FROM personal WHERE activo = 1 AND licencia_vence IS NOT NULL AND licencia_vence < ?').all(hoy)
    .map(p => ({ ref: p.nombre, detalle: 'licencia vencida el ' + dma(p.licencia_vence) })));
  if (columnas(db, 'leads').includes('tecnico_id')) chequeo('Qué ve cada rol', 'Órdenes por realizar sin técnico responsable', 'aviso', () => L.filter(l => l.estatus === 'ganado' && !l.ejecucion && !activos.has(l.tecnico_id) && !conResponsable.has(l.id))
    .map(l => ({ ref: folioL(l), detalle: 'servicio ' + (l.fecha_servicio ? dma(l.fecha_servicio) : 'sin fecha') + (l.tecnico_id ? ': su técnico está desactivado' : '') + ': ningún técnico la ve hasta que se le asigne' })));

  chequeo('Ventas', 'Fechas de creación en el futuro', 'error', () => L.filter(l => String(l.created_at) > ahora).map(l => ({ ref: folioL(l), detalle: 'creada el ' + l.created_at })));
  chequeo('Ventas', 'Fecha de cotización en el futuro', 'error', () => L.filter(l => l.fecha_cotizacion && l.fecha_cotizacion > hoy).map(l => ({ ref: folioL(l), detalle: 'cotización del ' + dma(l.fecha_cotizacion) })));
  chequeo('Ventas', 'Órdenes de servicio sin fecha de servicio', 'aviso', () => L.filter(l => l.estatus === 'ganado' && !l.fecha_servicio).map(l => ({ ref: folioL(l), detalle: 'no saldrá en el calendario ni en «por realizar»' })));
  chequeo('Ventas', 'Servicio programado ANTES de la fecha de la cotización', 'error', () => L.filter(l => l.fecha_cotizacion && l.fecha_servicio && l.fecha_servicio < l.fecha_cotizacion).map(l => ({ ref: folioL(l), detalle: `servicio ${dma(l.fecha_servicio)} · cotización ${dma(l.fecha_cotizacion)}` })));
  chequeo('Ventas', 'Realizado sin fecha, con fecha futura o antes de cotizar', 'error', () => L.filter(l => l.ejecucion === 'realizado' && (!l.fecha_realizado || l.fecha_realizado > hoy || (l.fecha_cotizacion && l.fecha_realizado < l.fecha_cotizacion)))
    .map(l => ({ ref: folioL(l), detalle: 'realizado ' + (l.fecha_realizado ? dma(l.fecha_realizado) : 'sin fecha') + (l.fecha_cotizacion ? ' · cotización ' + dma(l.fecha_cotizacion) : '') })));
  chequeo('Ventas', 'Importe guardado distinto a la suma de sus partidas', 'error', () => L.filter(l => l.iva_modo && l.partidas_json).map(l => {
    let items; try { items = JSON.parse(l.partidas_json); } catch { return { l, mal: 'partidas dañadas' }; }
    if (!Array.isArray(items)) return { l, mal: 'partidas dañadas' };
    const r = Importes.calcular(items, l.iva_modo, l.iva_tasa);
    const sub = Math.round(Number(l.valor || 0) * 100);
    return r.subtotal_cent !== sub || (r.iva_cent ?? 0) !== (l.iva_cent ?? 0) ? { l, mal: `guardado ${pesos(sub)} + IVA ${pesos(l.iva_cent)} · partidas ${pesos(r.subtotal_cent)} + IVA ${pesos(r.iva_cent)}` } : null;
  }).filter(Boolean).map(({ l, mal }) => ({ ref: folioL(l), detalle: mal })));
  chequeo('Ventas', 'Órdenes ganadas en $0', 'aviso', () => L.filter(l => l.estatus === 'ganado' && !(Number(l.valor) > 0)).map(l => ({ ref: folioL(l), detalle: 'importe $0' })));
  chequeo('Ventas', 'Cotizaciones u órdenes sin cliente', 'error', () => L.filter(l => !l.cliente_id || !db.prepare('SELECT 1 FROM clientes WHERE id = ?').get(l.cliente_id)).map(l => ({ ref: folioL(l), detalle: 'cliente #' + (l.cliente_id ?? '—') + ' no existe' })));

  // ---------- Factura y cobranza ----------
  chequeo('Cobranza', 'Folio de factura repetido en varias órdenes', 'error', () => {
    const k = t => String(t || '').toUpperCase().replace(/[\s-]+/g, ''), m = new Map();
    for (const l of L) if (l.factura_folio) m.set(k(l.factura_folio), [...(m.get(k(l.factura_folio)) || []), l]);
    return [...m.values()].filter(v => v.length > 1).map(v => ({ ref: v[0].factura_folio, detalle: 'en ' + v.map(folioL).join(', ') }));
  });
  chequeo('Cobranza', 'Factura con fecha futura o antes de la cotización', 'error', () => L.filter(l => l.factura_fecha && (l.factura_fecha > hoy || (l.fecha_cotizacion && l.factura_fecha < l.fecha_cotizacion)))
    .map(l => ({ ref: folioL(l), detalle: 'factura ' + dma(l.factura_fecha) + (l.fecha_cotizacion ? ' · cotización ' + dma(l.fecha_cotizacion) : '') })));
  chequeo('Cobranza', 'Pagos en cotizaciones (no son órdenes de servicio)', 'error', () => cobros.filter(k => !k.cancelado && leadPorId.get(k.lead_id)?.estatus !== 'ganado')
    .map(k => ({ ref: leadPorId.get(k.lead_id) ? folioL(leadPorId.get(k.lead_id)) : 'orden #' + k.lead_id, detalle: 'pago de ' + pesos(k.monto_cent) + ' del ' + dma(k.fecha) })));
  chequeo('Cobranza', 'Pagos con fecha futura o antes de la cotización', 'error', () => cobros.filter(k => !k.cancelado && (k.fecha > hoy || (leadPorId.get(k.lead_id)?.fecha_cotizacion && k.fecha < leadPorId.get(k.lead_id).fecha_cotizacion)))
    .map(k => ({ ref: leadPorId.get(k.lead_id) ? folioL(leadPorId.get(k.lead_id)) : '#' + k.lead_id, detalle: 'pago del ' + dma(k.fecha) + ' por ' + pesos(k.monto_cent) })));
  chequeo('Cobranza', 'Se cobró más de lo que se debía (saldo a favor del cliente)', 'aviso', () => L.filter(l => l.estatus === 'ganado' && l.ejecucion !== 'no_realizado' && cobradoDe(l.id) > totalOrden(l))
    .map(l => ({ ref: folioL(l), detalle: `debe ${pesos(totalOrden(l))}, se cobró ${pesos(cobradoDe(l.id))} (a favor ${pesos(cobradoDe(l.id) - totalOrden(l))})` })));
  chequeo('Cobranza', 'Servicio NO realizado con pagos (devolver o aplicar)', 'aviso', () => L.filter(l => l.ejecucion === 'no_realizado' && cobradoDe(l.id) > 0).map(l => ({ ref: folioL(l), detalle: 'pagó ' + pesos(cobradoDe(l.id)) })));
  chequeo('Cobranza', 'Pagos sin confirmar desde hace más de 15 días', 'aviso', () => cobros.filter(k => !k.cancelado && !k.confirmado && k.fecha < db.prepare("SELECT date(?, '-15 days') d").get(hoy).d)
    .map(k => ({ ref: leadPorId.get(k.lead_id) ? folioL(leadPorId.get(k.lead_id)) : '#' + k.lead_id, detalle: pesos(k.monto_cent) + ' del ' + dma(k.fecha) + ' sigue por confirmar' })));

  // ---------- Cuentas por pagar ----------
  const cxp = existe(db, 'cuentas_por_pagar') ? db.prepare('SELECT x.*, p.nombre AS prov FROM cuentas_por_pagar x LEFT JOIN proveedores p ON p.id = x.proveedor_id').all() : [];
  const pagos = existe(db, 'pagos_proveedor') ? db.prepare('SELECT * FROM pagos_proveedor').all() : [];
  const pagadoCxp = id => pagos.filter(g => g.cxp_id === id && !g.cancelado).reduce((t, g) => t + g.monto_cent, 0);
  const refCxp = x => (x.prov || 'Proveedor') + ' · ' + String(x.concepto || '').slice(0, 50);
  chequeo('Cuentas por pagar', 'Vence antes de la fecha del documento', 'error', () => cxp.filter(x => x.fecha_vencimiento < x.fecha_documento).map(x => ({ ref: refCxp(x), detalle: `documento ${dma(x.fecha_documento)} · vence ${dma(x.fecha_vencimiento)}` })));
  chequeo('Cuentas por pagar', 'Se le pagó al proveedor más de lo que se debía', 'error', () => cxp.filter(x => pagadoCxp(x.id) > x.total_cent).map(x => ({ ref: refCxp(x), detalle: `debía ${pesos(x.total_cent)}, se pagó ${pesos(pagadoCxp(x.id))}` })));
  chequeo('Cuentas por pagar', 'Pagos a proveedor con fecha futura', 'error', () => pagos.filter(g => !g.cancelado && g.fecha > hoy).map(g => ({ ref: refCxp(cxp.find(x => x.id === g.cxp_id) || {}), detalle: 'pago del ' + dma(g.fecha) })));
  chequeo('Cuentas por pagar', 'Cuenta cancelada con pagos vigentes', 'error', () => cxp.filter(x => x.cancelada && pagadoCxp(x.id) > 0).map(x => ({ ref: refCxp(x), detalle: 'tiene ' + pesos(pagadoCxp(x.id)) + ' pagados' })));
  chequeo('Cuentas por pagar', 'Costos ligados a una orden de servicio que ya no existe o no es orden', 'error', () => cxp.filter(x => x.lead_id && leadPorId.get(x.lead_id)?.estatus !== 'ganado').map(x => ({ ref: refCxp(x), detalle: 'orden #' + x.lead_id })));

  // ---------- Compras ----------
  const ocs = existe(db, 'ordenes_compra') ? db.prepare('SELECT * FROM ordenes_compra').all() : [];
  const cols = columnas(db, 'ordenes_compra');
  chequeo('Compras', 'Total de la orden distinto a la suma de sus partidas', 'error', () => ocs.map(o => {
    let p; try { p = JSON.parse(o.partidas_json); } catch { return { ref: folioOC(o), detalle: 'partidas dañadas' }; }
    const r = Importes.calcular(p, o.iva_modo, o.iva_tasa);
    return r.total_cent !== o.total_cent ? { ref: folioOC(o), detalle: `guardado ${pesos(o.total_cent)} · partidas ${pesos(r.total_cent)}` } : null;
  }).filter(Boolean));
  chequeo('Compras', 'Orden autorizada sin su cuenta por pagar (o con otro monto)', 'error', () => ocs.filter(o => o.estado === 'autorizada').map(o => {
    const x = cxp.find(y => y.id === o.cxp_id);
    return !x ? { ref: folioOC(o), detalle: 'no tiene cuenta por pagar' } : x.cancelada ? { ref: folioOC(o), detalle: 'su cuenta por pagar está cancelada' } : x.total_cent !== o.total_cent ? { ref: folioOC(o), detalle: `orden ${pesos(o.total_cent)} · cuenta ${pesos(x.total_cent)}` } : null;
  }).filter(Boolean));
  chequeo('Compras', 'Orden cancelada con cuenta por pagar vigente', 'error', () => ocs.filter(o => o.estado === 'cancelada' && o.cxp_id && cxp.find(y => y.id === o.cxp_id && !y.cancelada)).map(o => ({ ref: folioOC(o), detalle: 'su cuenta por pagar sigue activa' })));
  chequeo('Compras', 'Fecha requerida antes de la fecha de la orden', 'error', () => ocs.filter(o => o.fecha_requerida && o.fecha_requerida < o.fecha).map(o => ({ ref: folioOC(o), detalle: `orden ${dma(o.fecha)} · requerida ${dma(o.fecha_requerida)}` })));
  if (cols.includes('recibida_at') && existe(db, 'documentos_oc')) chequeo('Compras', 'Recibida sin foto ni firma', 'aviso', () => ocs.filter(o => o.recibida_at && !db.prepare("SELECT 1 FROM documentos_oc WHERE oc_id = ? AND eliminado = 0 AND tipo IN ('evidencia', 'firma_recepcion')").get(o.id)).map(o => ({ ref: folioOC(o), detalle: 'recibida el ' + dma(o.recibida_at) })));
  if (existe(db, 'solicitudes_compra')) {
    const sols = db.prepare('SELECT * FROM solicitudes_compra').all();
    chequeo('Compras', 'Solicitud «con orden» o «recibida» sin una orden válida', 'error', () => sols.filter(s => ['con_orden', 'recibida'].includes(s.estado)).map(s => {
      const o = ocs.find(x => x.id === s.oc_id);
      return !o ? { ref: folioSol(s), detalle: 'no tiene orden' } : o.estado === 'cancelada' ? { ref: folioSol(s), detalle: folioOC(o) + ' está cancelada' } : o.solicitud_id !== s.id ? { ref: folioSol(s), detalle: folioOC(o) + ' es de otra solicitud' } : null;
    }).filter(Boolean));
    chequeo('Compras', 'Se eligió sin las 3 cotizaciones y sin excepción por urgencia', 'error', () => sols.filter(s => ['elegida', 'con_orden', 'recibida'].includes(s.estado) && !s.excepcion_motivo
      && db.prepare("SELECT COUNT(DISTINCT proveedor_id) n FROM documentos_solicitud WHERE solicitud_id = ? AND tipo = 'cotizacion' AND eliminado = 0").get(s.id).n < 3).map(s => ({ ref: folioSol(s), detalle: 'menos de 3 cotizaciones de proveedores distintos' })));
  }

  // ---------- Clientes ----------
  chequeo('Clientes', 'Mismo teléfono en dos clientes', 'aviso', () => db.prepare(`SELECT telefono_normalizado t, GROUP_CONCAT(id) ids FROM clientes WHERE telefono_normalizado IS NOT NULL AND length(telefono_normalizado) = 10
      AND telefono_normalizado NOT GLOB '0000*' GROUP BY telefono_normalizado HAVING COUNT(*) > 1`).all().map(r => ({ ref: r.t, detalle: 'clientes ' + r.ids.split(',').map(i => 'CLI-' + i.padStart(4, '0')).join(', ') })));
  chequeo('Clientes', 'Mismo RFC en dos clientes', 'aviso', () => db.prepare(`SELECT upper(rfc) r, GROUP_CONCAT(id) ids FROM clientes WHERE rfc IS NOT NULL AND trim(rfc) <> '' AND upper(rfc) NOT IN ('XAXX010101000', 'XEXX010101000')
      GROUP BY upper(rfc) HAVING COUNT(*) > 1`).all().map(r => ({ ref: r.r, detalle: 'clientes ' + r.ids.split(',').map(i => 'CLI-' + i.padStart(4, '0')).join(', ') })));

  // ---------- Archivos ----------
  if (dirArchivos) {
    for (const [tabla, sub, etiqueta] of [['documentos_oc', 'ordenes_compra', 'Expediente de órdenes de compra'], ['documentos_solicitud', 'solicitudes', 'Cotizaciones y fotos de solicitudes']]) {
      if (!existe(db, tabla)) continue;
      chequeo('Archivos', etiqueta + ': archivos que faltan en el servidor', 'error', () => db.prepare(`SELECT id, nombre, archivo FROM ${tabla} WHERE eliminado = 0`).all()
        .filter(d => !d.archivo || !fs.existsSync(path.join(dirArchivos, sub, d.archivo))).map(d => ({ ref: d.nombre, detalle: 'no se encuentra el archivo' })));
    }
  }
  const errores = R.filter(r => r.gravedad === 'error' && r.total).reduce((t, r) => t + r.total, 0);
  const avisos = R.filter(r => r.gravedad === 'aviso' && r.total).reduce((t, r) => t + r.total, 0);
  return { fecha: ahora.slice(0, 16), revisiones: R.length, errores, avisos, resultados: R };
}

module.exports = function integridad(app, db, h) {
  const base = process.env.DB_PATH ? path.dirname(path.resolve(process.env.DB_PATH)) : path.join(__dirname, '..');
  app.get('/api/admin/integridad', h((req, res) => {
    if (!req.usuarioSesion.admin_general) return res.status(403).json({ error: 'La revisión de integridad es solo para Dirección (revisa todas las sucursales)' });
    const r = require('./alcance').global(() => revisar(db, { dirArchivos: path.join(base, 'archivos') })); // siempre toda la base
    app.locals.auditoria?.registrar(req, 'catalogo', null, 'revisión de integridad', `${r.revisiones} revisiones · ${r.errores} errores · ${r.avisos} avisos`);
    res.json(r);
  }));
};
module.exports.revisar = revisar;
