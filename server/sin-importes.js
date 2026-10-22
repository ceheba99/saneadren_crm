// «Ver importes» (permiso ordenes.importes, decidido con Dirección el 2026-10-21). Quien no lo tiene (de fábrica, el
// técnico) trabaja sus órdenes —cliente, dirección, fecha, servicio, descripción y cantidades— sin ver el dinero de la
// venta: precios, importes, IVA ni totales. Se quita en el servidor, no solo en pantalla:
//  · las respuestas de las rutas de ventas pasan por quitarImportes();
//  · lo que no ve no lo puede cambiar (se ignoran partidas, valor e IVA al guardar) y no cotiza;
//  · el Generador y Resultados (reportes de ventas) se niegan.
// La cobranza (/cobros) la decide el nivel de cuentas por cobrar, y las compras y gastos sus propias áreas.

// Campos con dinero de la venta (de la orden y sus sumas por cliente o etapa).
const DINERO = new Set(['valor', 'iva_cent', 'factura_total_cent', 'reabierta_total_cent', 'valor_total', 'valor_ganado',
  'valor_cotizado_total', 'valor_ganado_total', 'valor_historico_ganado', 'ultimo_valor']);
// Dentro de cada partida: lo que es precio (se conservan servicio, descripción, cantidad y unidad).
const PRECIO_PARTIDA = ['precio', 'importe', 'precio_sin_iva', 'precio_con_iva', 'subtotal', 'iva', 'total'];
// Montos escritos en la bitácora («Importe: $1,500.00 → $1,200.00»).
const MONTO_EN_TEXTO = /\$\s?\d[\d,]*(?:\.\d+)?/g;
// Lo que se ignora al guardar: no se cambia lo que no se ve.
const ENTRADA = ['partidas_json', 'valor', 'iva_modo', 'iva_tasa', 'iva_cent'];

const RUTAS_VENTAS = /^\/(leads|clientes|contactos|kpis|recompras|alertas|historial)(\/|$)/;
const RUTAS_NEGADAS = /^\/(generador|analisis)(\/|$)/;
const TIPOS_VENTA = new Set(['cotizacion', 'orden_servicio']);

function sinPrecios(json) {
  try {
    const items = JSON.parse(json);
    if (!Array.isArray(items)) return null;
    return JSON.stringify(items.map(i => { const c = { ...i }; PRECIO_PARTIDA.forEach(k => delete c[k]); return c; }));
  } catch { return null; }
}
function quitarImportes(x) {
  if (Array.isArray(x)) return x.map(quitarImportes);
  if (!x || typeof x !== 'object') return x;
  const r = {};
  for (const [k, v] of Object.entries(x)) {
    if (DINERO.has(k)) continue;
    if (k === 'partidas_json') r[k] = typeof v === 'string' ? sinPrecios(v) : v;
    else if (k === 'texto' && typeof v === 'string') r[k] = v.replace(MONTO_EN_TEXTO, '$ —');
    else r[k] = quitarImportes(v);
  }
  return r;
}
// Buscador: de las cotizaciones y órdenes no sale el monto (de compras y gastos sí, según sus áreas).
function buscadorSinImportes(r) {
  if (!r || !Array.isArray(r.grupos)) return r;
  const limpia = x => (x && TIPOS_VENTA.has(x.tipo) ? { ...x, monto: null } : x);
  return { ...r, exacta: limpia(r.exacta), grupos: r.grupos.map(g => (TIPOS_VENTA.has(g.tipo) ? { ...g, items: (g.items || []).map(x => ({ ...x, monto: null })) } : g)) };
}

module.exports = function sinImportes(permisos) {
  const ve = req => permisos.puede(req, 'ordenes.importes');
  // Va montado en /api, después de la sesión y antes de las rutas.
  return function middleware(req, res, next) {
    const ventas = RUTAS_VENTAS.test(req.path) && !/\/cobros$/.test(req.path), negada = RUTAS_NEGADAS.test(req.path), buscar = req.path === '/buscar';
    if ((!ventas && !negada && !buscar) || !req.usuarioSesion || ve(req)) return next();
    if (negada) return res.status(403).json({ error: 'Para ver el Generador y Resultados necesitas el permiso «Ver importes».' });
    const json = res.json.bind(res);
    if (buscar) { res.json = cuerpo => json(buscadorSinImportes(cuerpo)); return next(); }
    if (req.method === 'POST' && req.path === '/leads') return res.status(403).json({ error: 'Para cotizar o crear una orden necesitas el permiso «Ver importes».' });
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ENTRADA.forEach(k => delete req.body[k]);
    res.json = cuerpo => json(quitarImportes(cuerpo));
    next();
  };
};
module.exports.quitarImportes = quitarImportes;
