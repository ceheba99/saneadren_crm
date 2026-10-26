// «Ver montos de compras» (permiso compras.importes, decidido con Dirección el 2026-10-26). Quien no lo tiene (de
// fábrica, el técnico) sigue su solicitud —qué pidió, en qué va, qué proveedor se eligió— sin ver precios: montos de
// las cotizaciones de proveedores ni totales de las órdenes de compra. Se quita en el servidor, no solo en pantalla.

// Campos con dinero (y sus versiones en centavos).
const DINERO = /^(monto|total|subtotal|precio|precio_unitario|importe|iva|pagado|saldo|por_pagar)(_cent)?$/;
// Montos escritos en la bitácora («por $1,500.00»).
const MONTO_EN_TEXTO = /\$\s?\d[\d,]*(?:\.\d+)?/g;
const RUTAS = /^\/compras\//;

function quitarMontos(x) {
  if (Array.isArray(x)) return x.map(quitarMontos);
  if (!x || typeof x !== 'object') return x;
  const r = {};
  for (const [k, v] of Object.entries(x)) {
    if (DINERO.test(k)) continue;
    r[k] = typeof v === 'string' && /texto|detalle|nota/.test(k) ? v.replace(MONTO_EN_TEXTO, '$ —') : quitarMontos(v);
  }
  return r;
}

module.exports = function sinMontosCompras(permisos) {
  return function middleware(req, res, next) {
    if (!RUTAS.test(req.path) || !req.usuarioSesion || permisos.puede(req, 'compras.importes')) return next();
    const json = res.json.bind(res);
    res.json = cuerpo => json(quitarMontos(cuerpo));
    next();
  };
};
module.exports.quitarMontos = quitarMontos;
