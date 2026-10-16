// Buscador general: una sola caja arriba que encuentra clientes, cotizaciones, órdenes de servicio, solicitudes
// y órdenes de compra, cuentas por pagar y proveedores por folio, nombre, empresa, RFC, teléfono o concepto.
//
// Seguridad:
//  · Solo con sesión (lo pone el candado general de /api) y con límite de búsquedas por minuto por usuario.
//  · Texto de 2 a 80 caracteres; consultas siempre con parámetros; «%» y «_» se buscan como letras normales.
//  · Cada fuente decide quién la ve (hoy: todos los usuarios con sesión, igual que sus pantallas) y regresa solo
//    lo que ya se ve en las listas. Bitácora, usuarios, archivos y la base nunca entran aquí.
//  · Lo que la gente busca no se guarda.
// Robustez: sin importar acentos ni mayúsculas, varias palabras (deben estar todas), folios flexibles
// («OC-202610-0034», «oc 202610 34», «34»), teléfonos con cualquier formato, y si una fuente falla las demás siguen.
const { limitador } = require('./seguridad');
const { folioSol } = require('./solicitudes');
const { folio: folioCentral } = require('./sucursales');

const MIN = 2, MAX = 80, POR_GRUPO = 6, MAX_PALABRAS = 6;
const quitarAcentos = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const mes = c => String(c || '').slice(0, 7).replace('-', '');
const pad = id => String(id).padStart(4, '0');
const TABLA = { COT: 'leads', OS: 'leads', SOL: 'solicitudes_compra', OC: 'ordenes_compra' };
const folioDe = (prefijo, id, creado) => folioCentral(prefijo, TABLA[prefijo], id, creado);
const pesos = c => (c == null ? null : Math.round(c) / 100);
const ESCAPE = s => s.replace(/[\\%_]/g, m => '\\' + m); // «%» y «_» como letras, no como comodines

// Texto de las partidas guardadas en JSON (servicio y leyenda de una cotización; descripción de una orden de compra).
function textoPartidas(json) {
  try { const l = JSON.parse(json || '[]'); return Array.isArray(l) ? l.map(p => [p?.servicio, p?.leyenda, p?.descripcion, p?.clave].filter(Boolean).join(' ')).join(' ') : ''; } catch { return ''; }
}

// Entiende lo que se escribió: palabras, si parece folio (y de qué tipo) y si trae un teléfono.
function interpretar(q) {
  const limpio = String(q).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const folio = limpio.match(/^(cot|os|sol|oc|cli)?[\s-]*(?:([a-z][a-z0-9]{1,5})[\s-]+)?(?:(\d{6})[\s-]+)?0*(\d{1,7})$/i);
  const digitos = limpio.replace(/\D/g, '');
  return {
    limpio,
    palabras: [...new Set(quitarAcentos(limpio).split(/[\s,;]+/).filter(Boolean))].slice(0, MAX_PALABRAS),
    folio: folio ? { tipo: (folio[1] || '').toLowerCase() || null, clave: folio[2] ? folio[2].toUpperCase() : null, mes: folio[3] || null, id: Number(folio[4]) } : null,
    // Un número de 7 a 13 dígitos (con o sin espacios, guiones o +52) se busca también como teléfono: los últimos 10.
    telefono: digitos.length >= 7 && digitos.length <= 13 && /^[\d\s()+.-]+$/.test(limpio) ? digitos.slice(-10) : null,
  };
}

module.exports = function buscador(app, db, h) {
  // Funciones propias para la base: comparar sin acentos y leer el texto de las partidas.
  const nativa = db.db;
  nativa.function('sin_acentos', { deterministic: true }, t => quitarAcentos(t));
  nativa.function('texto_partidas', { deterministic: true }, t => textoPartidas(t));
  nativa.function('solo_digitos', { deterministic: true }, t => String(t ?? '').replace(/\D/g, ''));

  // Cada palabra debe aparecer en el texto de la fuente (en cualquier orden).
  const condicion = (expr, palabras) => ({ sql: palabras.map(() => `sin_acentos(${expr}) LIKE ? ESCAPE '\\'`).join(' AND '), params: palabras.map(p => '%' + ESCAPE(p) + '%') });

  // ---------- Fuentes ----------
  // Cada una: tipo, título del grupo, quién la ve, texto donde se busca, folio exacto y cómo se presenta.
  const FUENTES = [
    {
      tipo: 'cliente', titulo: 'Clientes', prefijo: 'cli', puede: () => true,
      base: `FROM clientes c WHERE (en_alcance(c.sucursal_id) OR EXISTS (SELECT 1 FROM leads lv WHERE lv.cliente_id = c.id))`,
      texto: `'cli-' || printf('%04d', c.id) || ' ' || COALESCE(c.nombre,'') || ' ' || COALESCE(c.empresa_contacto,'') || ' ' || COALESCE(c.rfc,'') || ' ' || COALESCE(c.direccion,'') || ' ' || COALESCE(c.correo,'')`,
      telefono: `(c.telefono_normalizado LIKE ? OR solo_digitos(c.telefono_alterno) LIKE ? OR EXISTS (SELECT 1 FROM telefonos_cliente t WHERE t.cliente_id = c.id AND t.telefono_normalizado LIKE ?))`, telParams: 3,
      porId: `c.id = ?`,
      campos: `c.id, c.nombre, c.empresa_contacto, c.telefono, c.rfc, c.created_at, (SELECT COUNT(*) FROM leads l WHERE l.cliente_id = c.id AND l.estatus = 'ganado') AS servicios`,
      orden: `c.id DESC`,
      pinta: c => ({ id: c.id, folio: 'CLI-' + pad(c.id), titulo: c.empresa_contacto || c.nombre || 'Sin nombre', detalle: [c.empresa_contacto ? c.nombre : null, c.telefono, c.rfc ? 'RFC ' + c.rfc : null].filter(Boolean).join(' · '), estado: c.servicios ? c.servicios + (c.servicios === 1 ? ' servicio' : ' servicios') : 'Prospecto', fecha: String(c.created_at).slice(0, 10) }),
    },
    ...[['cotizacion', 'Cotizaciones', 'cot', `l.estatus <> 'ganado'`], ['orden_servicio', 'Órdenes de servicio', 'os', `l.estatus = 'ganado'`]].map(([tipo, titulo, prefijo, filtro]) => ({
      tipo, titulo, prefijo, puede: () => true,
      base: `FROM leads l LEFT JOIN clientes c ON c.id = l.cliente_id LEFT JOIN catalogo_servicios s ON s.id = l.servicio_id WHERE ${filtro}`,
      texto: `'${prefijo}-' || COALESCE((SELECT lower(su.clave) FROM sucursales su WHERE su.id = l.sucursal_id AND l.folio_num IS NOT NULL) || '-', '') || strftime('%Y%m', l.created_at) || '-' || printf('%04d', COALESCE(l.folio_num, l.id)) || ' ' || COALESCE(l.nombre,'') || ' ' || COALESCE(l.empresa_contacto,'') || ' ' || COALESCE(c.empresa_contacto,'') || ' ' || COALESCE(c.nombre,'') || ' ' || COALESCE(c.rfc,'') || ' ' || COALESCE(l.direccion,'') || ' ' || COALESCE(s.nombre,'') || ' ' || texto_partidas(l.partidas_json) || ' ' || COALESCE(l.factura_folio,'') || ' ' || COALESCE(l.orden_generador,'') || ' ' || COALESCE(l.equipo,'') || ' ' || COALESCE(l.proyecto,'')`,
      telefono: `l.telefono_normalizado LIKE ?`, telParams: 1,
      porId: `l.id = ?`, conSucursal: 'l', porMes: `strftime('%Y%m', l.created_at) = ?`,
      campos: `l.id, l.created_at, l.estatus, l.ejecucion, l.valor, l.fecha_servicio, l.factura_folio, COALESCE(c.empresa_contacto, l.empresa_contacto, c.nombre, l.nombre) AS cliente, s.nombre AS servicio`,
      orden: `l.id DESC`,
      pinta: l => ({ id: l.id, folio: folioDe(prefijo.toUpperCase(), l.id, l.created_at), titulo: l.cliente || 'Sin cliente', detalle: [l.servicio, l.factura_folio ? 'Factura ' + l.factura_folio : null].filter(Boolean).join(' · '),
        monto: l.valor ?? null, estado: tipo === 'cotizacion' ? (l.estatus === 'perdido' ? 'No se cerró' : 'Abierta') : ({ realizado: 'Realizada', no_realizado: 'No realizada' }[l.ejecucion] || 'Programada'),
        fecha: (tipo === 'orden_servicio' && l.fecha_servicio) || String(l.created_at).slice(0, 10) }),
    })),
    {
      tipo: 'solicitud', titulo: 'Solicitudes de compra', prefijo: 'sol', puede: () => true,
      base: `FROM solicitudes_compra x JOIN centros_costo cc ON cc.id = x.centro_id LEFT JOIN ordenes_compra o ON o.id = x.oc_id`,
      texto: `'sol-' || COALESCE((SELECT lower(su.clave) FROM sucursales su WHERE su.id = x.sucursal_id AND x.folio_num IS NOT NULL) || '-', '') || strftime('%Y%m', x.created_at) || '-' || printf('%04d', COALESCE(x.folio_num, x.id)) || ' ' || x.que || ' ' || x.para_que || ' ' || COALESCE(x.equipo,'') || ' ' || x.solicitante_nombre || ' ' || cc.nombre || ' ' || COALESCE('oc-' || strftime('%Y%m', o.created_at) || '-' || printf('%04d', o.id), '')`,
      porId: `x.id = ?`, conSucursal: 'x', porMes: `strftime('%Y%m', x.created_at) = ?`,
      campos: `x.id, x.created_at, x.que, x.estado, x.urgente, x.solicitante_nombre, cc.nombre AS centro`,
      orden: `x.id DESC`,
      pinta: x => ({ id: x.id, folio: folioSol(x), titulo: x.que, detalle: [x.centro, 'pidió ' + x.solicitante_nombre, x.urgente ? 'URGENTE' : null].filter(Boolean).join(' · '),
        estado: { por_aprobar: 'Por aprobar', cotizando: 'Cotizando', elegida: 'Cotización elegida', con_orden: 'Con orden de compra', recibida: 'Recibida', rechazada: 'Rechazada', cancelada: 'Cancelada' }[x.estado], fecha: String(x.created_at).slice(0, 10) }),
    },
    {
      tipo: 'orden_compra', titulo: 'Órdenes de compra', prefijo: 'oc', puede: () => true,
      base: `FROM ordenes_compra o JOIN proveedores p ON p.id = o.proveedor_id JOIN centros_costo cc ON cc.id = o.centro_id LEFT JOIN solicitudes_compra x ON x.id = o.solicitud_id`,
      texto: `'oc-' || COALESCE((SELECT lower(su.clave) FROM sucursales su WHERE su.id = o.sucursal_id AND o.folio_num IS NOT NULL) || '-', '') || strftime('%Y%m', o.created_at) || '-' || printf('%04d', COALESCE(o.folio_num, o.id)) || ' ' || p.nombre || ' ' || COALESCE(p.rfc,'') || ' ' || cc.nombre || ' ' || texto_partidas(o.partidas_json) || ' ' || COALESCE(o.nota,'') || ' ' || COALESCE(o.observaciones,'') || ' ' || COALESCE(o.factura_folio,'') || ' ' || COALESCE('sol-' || strftime('%Y%m', x.created_at) || '-' || printf('%04d', x.id), '')`,
      porId: `o.id = ?`, conSucursal: 'o', porMes: `strftime('%Y%m', o.created_at) = ?`,
      campos: `o.id, o.created_at, o.estado, o.total_cent, o.fecha, o.recibida_at, p.nombre AS proveedor, texto_partidas(o.partidas_json) AS concepto`,
      orden: `o.id DESC`,
      pinta: o => ({ id: o.id, folio: folioDe('OC', o.id, o.created_at), titulo: o.proveedor, detalle: String(o.concepto || '').slice(0, 90), monto: pesos(o.total_cent),
        estado: o.estado === 'cancelada' ? 'Cancelada' : o.recibida_at ? 'Recibida' : o.estado === 'autorizada' ? 'Autorizada' : 'Por autorizar', fecha: o.fecha }),
    },
    {
      tipo: 'cuenta_por_pagar', titulo: 'Cuentas por pagar', puede: () => true,
      base: `FROM cuentas_por_pagar k JOIN proveedores p ON p.id = k.proveedor_id`,
      texto: `COALESCE(k.factura_folio,'') || ' ' || p.nombre || ' ' || COALESCE(p.rfc,'') || ' ' || k.concepto || ' ' || COALESCE(k.notas,'') || ' ' || COALESCE(k.equipo,'')`,
      campos: `k.id, k.concepto, k.factura_folio, k.total_cent, k.fecha_vencimiento, k.cancelada, p.nombre AS proveedor, (SELECT COALESCE(SUM(g.monto_cent), 0) FROM pagos_proveedor g WHERE g.cxp_id = k.id AND g.cancelado = 0) AS pagado_cent`,
      orden: `k.id DESC`,
      pinta: k => ({ id: k.id, folio: k.factura_folio ? 'Factura ' + k.factura_folio : null, titulo: k.proveedor, detalle: k.concepto, monto: pesos(k.total_cent),
        estado: k.cancelada ? 'Cancelada' : k.total_cent - k.pagado_cent <= 0 ? 'Pagada' : 'Por pagar · vence ' + k.fecha_vencimiento.split('-').reverse().join('/'), fecha: k.fecha_vencimiento }),
    },
    {
      tipo: 'proveedor', titulo: 'Proveedores', puede: () => true,
      base: `FROM proveedores p`,
      texto: `p.nombre || ' ' || COALESCE(p.rfc,'') || ' ' || COALESCE(p.contacto,'')`,
      telefono: `solo_digitos(p.telefono) LIKE ?`, telParams: 1,
      campos: `p.id, p.nombre, p.rfc, p.telefono, p.dias_credito, p.activo`,
      orden: `p.activo DESC, p.nombre`,
      pinta: p => ({ id: p.id, folio: null, titulo: p.nombre, detalle: [p.rfc ? 'RFC ' + p.rfc : null, p.telefono, 'crédito ' + p.dias_credito + ' días'].filter(Boolean).join(' · '), estado: p.activo ? null : 'Inactivo' }),
    },
  ];

  // Busca en una fuente: por folio exacto (si aplica) y por texto o teléfono. Devuelve { total, items }.
  function buscarEn(f, i) {
    const where = f.base.includes(' WHERE ') ? ' AND ' : ' WHERE ';
    let exacta = null;
    // Folio: el número del registro (y el mes, si se escribió; si no coincide, no trae nada para no confundir).
    if (i.folio && f.porId && (!i.folio.tipo || i.folio.tipo === f.prefijo) && !(i.folio.mes && !f.porMes) && !(i.folio.clave && !f.conSucursal)) {
      // Con sucursal: su consecutivo propio (folio_num); sin ella, también los folios de antes (por id).
      const a = f.conSucursal, suc = i.folio.clave ? db.prepare('SELECT id FROM sucursales WHERE clave = ?').get(i.folio.clave) : null;
      const cond = !a ? f.porId : i.folio.clave ? `${a}.sucursal_id = ? AND ${a}.folio_num = ?` : `((${a}.id = ? AND ${a}.folio_num IS NULL) OR ${a}.folio_num = ?)`;
      const ps = !a ? [i.folio.id] : i.folio.clave ? [suc?.id ?? -1, i.folio.id] : [i.folio.id, i.folio.id];
      const fila = db.prepare(`SELECT ${f.campos} ${f.base}${where}${cond}${i.folio.mes ? ' AND ' + f.porMes : ''} ORDER BY ${a ? a + '.folio_num IS NULL DESC, ' : ''}1 LIMIT 1`).get(...ps, ...(i.folio.mes ? [i.folio.mes] : []));
      if (fila) exacta = { ...f.pinta(fila), exacta: true };
      // Cliente que se juntó con otro: su ID viejo lleva al cliente que quedó.
      else if (f.tipo === 'cliente') {
        const r = db.prepare('SELECT id_retirado, cliente_id FROM clientes_fusionados WHERE id_retirado = ?').get(i.folio.id);
        const vivo = r && db.prepare(`SELECT ${f.campos} ${f.base}${where}c.id = ?`).get(r.cliente_id);
        if (vivo) { const p = f.pinta(vivo); exacta = { ...p, exacta: true, detalle: 'CLI-' + pad(r.id_retirado) + ' se juntó con este cliente' + (p.detalle ? ' · ' + p.detalle : '') }; }
      }
    }
    const partes = [], params = [];
    if (i.palabras.length) { const c = condicion(f.texto, i.palabras); partes.push('(' + c.sql + ')'); params.push(...c.params); }
    if (i.telefono && f.telefono) { partes.push('(' + f.telefono + ')'); for (let k = 0; k < f.telParams; k++) params.push('%' + i.telefono + '%'); }
    if (!partes.length) return { total: exacta ? 1 : 0, items: exacta ? [exacta] : [] };
    const cond = '(' + partes.join(' OR ') + ')';
    const filas = db.prepare(`SELECT ${f.campos} ${f.base}${where}${cond} ORDER BY ${f.orden} LIMIT ${POR_GRUPO}`).all(...params).map(f.pinta);
    let total = db.prepare(`SELECT COUNT(*) n ${f.base}${where}${cond}`).get(...params).n;
    if (exacta && !(f.porId && db.prepare(`SELECT 1 ${f.base}${where}${cond} AND ${f.porId}`).get(...params, exacta.id))) total++;
    const items = exacta ? [exacta, ...filas.filter(x => x.id !== exacta.id)] : filas;
    return { total, items: items.slice(0, POR_GRUPO) };
  }

  const limite = limitador({ max: 60, ventanaMs: 60 * 1000, clave: req => 'buscar:' + (req.usuarioSesion?.id ?? req.ipCliente ?? req.ip), mensaje: 'Demasiadas búsquedas seguidas. Espera un momento.' });
  app.get('/api/buscar', limite, h((req, res) => {
    if (typeof req.query.q !== 'string') return res.status(400).json({ error: 'Escribe qué buscas' });
    const q = req.query.q;
    if (q.length > MAX * 2) return res.status(400).json({ error: `La búsqueda es demasiado larga (máximo ${MAX} caracteres)` });
    const i = interpretar(q);
    if (i.limpio.length < MIN) return res.status(400).json({ error: `Escribe al menos ${MIN} letras o números` });
    if (i.limpio.length > MAX) return res.status(400).json({ error: `La búsqueda es demasiado larga (máximo ${MAX} caracteres)` });
    // Un folio puro (p. ej. «OC-202610-0034») no se busca además como texto: sería ruido.
    if (i.folio && i.folio.tipo) i.palabras = [];
    const grupos = [];
    for (const f of FUENTES) {
      if (!f.puede(req)) continue;
      try { const r = buscarEn(f, i); if (r.items.length) grupos.push({ tipo: f.tipo, titulo: f.titulo, total: r.total, items: r.items }); }
      catch (err) { console.error('[buscar]', f.tipo, err.message); grupos.push({ tipo: f.tipo, titulo: f.titulo, error: 'No se pudo buscar aquí' }); }
    }
    // Coincidencia exacta de folio con tipo (COT-, OS-, SOL-, OC-, CLI-): se abre directo con Enter.
    // Con la clave de sucursal y sin tipo («cdmx 2»): si solo hay un registro con ese número, también se abre directo.
    const exactas = grupos.flatMap(g => (g.items || []).filter(x => x.exacta).map(x => ({ ...x, tipo: g.tipo })));
    const exacta = i.folio?.tipo ? exactas[0] || null : i.folio?.clave && exactas.length === 1 ? exactas[0] : null;
    res.set('Cache-Control', 'no-store');
    res.json({ q: i.limpio, exacta, grupos });
  }));
  return { interpretar };
};
module.exports.interpretar = interpretar;
