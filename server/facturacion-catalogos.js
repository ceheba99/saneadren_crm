/* Facturación CFDI 4.0 · F2 (2026-10-27): copia local de los catálogos OFICIALES de factura.com (tabla sat_catalogos). Probado contra sandbox el
   2026-10-27: Régimen 23, UsoCfdi 24 (todos con sus regímenes), FormaPago 22, MetodoPago 2, ClaveUnidad 2,415. Para qué: validar el régimen y la compatibilidad régimen–uso al capturar datos fiscales (regla 3 de CLAUDE.md:
   nada de claves escritas a mano), y ofrecer las claves de unidad y las formas de pago.
   · Rutas y campos tomados de apidocs/catalogos.html: GET /v3/catalogo/{RegimenFiscal|FormaPago|MetodoPago|ClaveUnidad|ClaveProductServ}
     y GET /v4/catalogo/UsoCfdi (cada ítem: key, name; el uso trae además «use» y «regimenes»).
   · Una respuesta vacía o rara NUNCA borra el catálogo que ya se tenía.
   · ClaveProductServ trae 52,841 claves en UNA respuesta (sin paginar, ~2 s en sandbox): es opcional y se pide aparte (--claves-producto). */
const CATALOGOS = {
  RegimenFiscal: '/v3/catalogo/RegimenFiscal',
  UsoCfdi: '/v4/catalogo/UsoCfdi',
  FormaPago: '/v3/catalogo/FormaPago',
  MetodoPago: '/v3/catalogo/MetodoPago',
  ClaveUnidad: '/v3/catalogo/ClaveUnidad',
};
const CATALOGO_CLAVES_PRODUCTO = { ClaveProductServ: '/v3/catalogo/ClaveProductServ' };

/** Los ítems de una respuesta de catálogo, venga como { data: [...] }, { Data: [...] } o un arreglo suelto. */
function itemsDe(datos) {
  const lista = Array.isArray(datos) ? datos : Array.isArray(datos?.data) ? datos.data : Array.isArray(datos?.Data) ? datos.Data : null;
  if (!lista) return null;
  const vistos = new Set(), salida = [];
  for (const it of lista) {
    const clave = String(it?.key ?? '').trim(); if (!clave || vistos.has(clave)) continue; vistos.add(clave);
    const { key, name, ...resto } = it; // lo demás (use, regimenes, complement…) va en «extra»
    salida.push({ clave, nombre: String(name ?? '').trim(), extra: Object.keys(resto).length ? JSON.stringify(resto) : null });
  }
  return salida;
}

/** Descarga un catálogo y lo guarda reemplazando el anterior. Devuelve cuántos ítems quedaron (o el motivo por el que no se tocó). */
async function sincronizarCatalogo(cliente, db, nombre, ruta) {
  const res = await cliente.get(ruta);
  const items = itemsDe(res.crudo ?? res.datos);
  if (!items || !items.length) return { catalogo: nombre, actualizado: false, motivo: 'factura.com no devolvió ítems: se conserva lo que ya había', total: contar(db, nombre) };
  db.exec('BEGIN');
  try {
    const ins = db.prepare("INSERT INTO sat_catalogos (catalogo, clave, nombre, extra, actualizado_at) VALUES (?, ?, ?, ?, datetime('now','localtime')) ON CONFLICT(catalogo, clave) DO UPDATE SET nombre = excluded.nombre, extra = excluded.extra, actualizado_at = excluded.actualizado_at");
    for (const it of items) ins.run(nombre, it.clave, it.nombre, it.extra);
    const claves = new Set(items.map(i => i.clave));
    const del = db.prepare('DELETE FROM sat_catalogos WHERE catalogo = ? AND clave = ?');
    for (const { clave } of db.prepare('SELECT clave FROM sat_catalogos WHERE catalogo = ?').all(nombre)) if (!claves.has(clave)) del.run(nombre, clave);
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch { /* ya cerrada */ } throw e; }
  return { catalogo: nombre, actualizado: true, total: items.length };
}
const contar = (db, nombre) => db.prepare('SELECT COUNT(*) n FROM sat_catalogos WHERE catalogo = ?').get(nombre).n;

/** Sincroniza todos los catálogos chicos (y, si se pide, las claves de producto). Un catálogo que falla no impide los demás. */
async function sincronizarCatalogos(cliente, db, { clavesProducto = false } = {}) {
  const lista = { ...CATALOGOS, ...(clavesProducto ? CATALOGO_CLAVES_PRODUCTO : {}) }, resultados = [];
  for (const [nombre, ruta] of Object.entries(lista)) {
    try { resultados.push(await sincronizarCatalogo(cliente, db, nombre, ruta)); }
    catch (e) { resultados.push({ catalogo: nombre, actualizado: false, motivo: e.message, error: true, total: contar(db, nombre) }); }
  }
  return resultados;
}

/** Lo que usan las validaciones: Map clave→nombre de regímenes y Map clave→{ nombre, regimenes } de usos; null si el catálogo aún no se cargó. */
function leerCatalogos(db) {
  const filas = n => db.prepare('SELECT clave, nombre, extra FROM sat_catalogos WHERE catalogo = ?').all(n);
  const reg = filas('RegimenFiscal'), uso = filas('UsoCfdi');
  const json = t => { try { return JSON.parse(t || '{}'); } catch { return {}; } };
  return {
    regimenes: reg.length ? new Map(reg.map(r => [r.clave, r.nombre])) : null,
    usos: uso.length ? new Map(uso.map(r => [r.clave, { nombre: r.nombre, regimenes: Array.isArray(json(r.extra).regimenes) ? json(r.extra).regimenes.map(String) : [] }])) : null,
    formasPago: filas('FormaPago').map(r => ({ clave: r.clave, nombre: r.nombre })),
    unidades: filas('ClaveUnidad').map(r => ({ clave: r.clave, nombre: r.nombre })),
  };
}

module.exports = { CATALOGOS, itemsDe, sincronizarCatalogo, sincronizarCatalogos, leerCatalogos };
