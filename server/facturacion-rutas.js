/* Facturación CFDI 4.0 · configuración (2026-10-27): rutas de la pantalla «Facturación» de Ajustes. SOLO DIRECCIÓN (igual que Sucursales y Respaldo).
   · Nunca devuelve las llaves de factura.com: solo «puesta» o «falta» (estadoConfig).
   · En el DEMO (MODO_DEMO=1) nada se conecta con factura.com: probar, catálogos y cambiar series responden 409; el CP sí se puede cambiar.
   · Asignar una serie consulta la lista real de factura.com (que exista, que sea del tipo y que esté activa) antes de guardarla.
   · Todo cambio queda en la bitácora general (entidad «catalogo»).
   El cliente de factura.com, el demo y la bitácora llegan por parámetro: así se prueban las rutas sin red. */
const { estadoConfig, leerConfig } = require('./facturacion-config');
const { crearClienteFactura, ErrorFactura } = require('./facturacom');
const { CATALOGOS, sincronizarCatalogos } = require('./facturacion-catalogos');
const { listarSeries, asignarSerie } = require('./facturacion-series');

const TIPOS = { serie_factura: 'factura', serie_pago: 'pago' };

module.exports = function rutasFacturacion(app, db, h, { direccion, esDemo = () => process.env.MODO_DEMO === '1', crearCliente = () => crearClienteFactura(), env = process.env, auditar = () => {} } = {}) {
  const soloDireccion = (req, res) => {
    if (direccion(req)) return false;
    res.status(403).json({ error: 'La configuración de facturación es solo de Dirección' });
    return true;
  };
  const demoNo = res => { res.status(409).json({ error: 'El demo no se conecta con factura.com: aquí solo se ve cómo queda la pantalla.' }); return true; };
  // Los errores de factura.com o de configuración se muestran tal cual (en español). Cualquier otro error se registra y responde 500: el envoltorio «h»
  // del servidor NO espera funciones asíncronas, así que aquí se atrapa todo (un error suelto tras una llamada a la red tumbaría el servidor).
  const responder = (res, e) => {
    if (res.headersSent) return;
    if (e instanceof ErrorFactura) return res.status(e.codigo === 'config' ? 400 : 502).json({ error: e.message, detalles: e.detalles });
    // En el registro del servidor tampoco puede quedar una llave (se tacha si apareciera en el texto del error).
    const { apiKey, secretKey } = leerConfig(env).llaves; let t = String(e?.message ?? '');
    for (const k of [apiKey, secretKey]) if (k && k.length >= 4) t = t.split(k).join('***');
    console.error('Error en facturación:', t.slice(0, 300));
    res.status(500).json({ error: 'Error interno del servidor' });
  };
  const ocupado = new Set(); // una sola operación de cada tipo a la vez (evita el doble clic)
  const una = async (clave, res, tarea) => {
    if (ocupado.has(clave)) return res.status(409).json({ error: 'Ya se está haciendo; espera a que termine.' });
    ocupado.add(clave);
    try { return await tarea(); } catch (e) { return responder(res, e); } finally { ocupado.delete(clave); }
  };

  function sucursales() {
    const series = db.prepare('SELECT sucursal_id, tipo_documento, serie, serie_uid FROM series_factura WHERE activo = 1').all();
    const de = (id, tipo) => { const s = series.find(x => x.sucursal_id === id && x.tipo_documento === tipo); return s ? { id: s.serie_uid, nombre: s.serie } : null; };
    return db.prepare('SELECT id, nombre, clave, activo, cp_expedicion FROM sucursales ORDER BY id').all()
      .map(s => ({ ...s, cp_expedicion: s.cp_expedicion || '', serie_factura: de(s.id, 'factura'), serie_pago: de(s.id, 'pago') }));
  }
  function catalogos() {
    const filas = Object.fromEntries(db.prepare('SELECT catalogo, COUNT(*) total, MAX(actualizado_at) actualizado FROM sat_catalogos GROUP BY catalogo').all().map(r => [r.catalogo, r]));
    return Object.keys(CATALOGOS).map(c => ({ catalogo: c, total: filas[c]?.total || 0, actualizado: filas[c]?.actualizado || null }));
  }

  // La configuración completa: en la ruta base y en /config (la pantalla usa la segunda).
  const configuracion = (req, res) => {
    if (soloDireccion(req, res)) return;
    res.json({ ...estadoConfig(env), demo: esDemo(), sucursales: sucursales(), catalogos: catalogos() });
  };
  app.get('/api/facturacion', h(configuracion));
  app.get('/api/facturacion/config', h(configuracion));

  // Prueba la conexión leyendo las series de factura.com (no cambia nada allá) y las devuelve para elegirlas.
  app.post('/api/facturacion/probar', h((req, res) => {
    if (soloDireccion(req, res)) return;
    if (esDemo()) return demoNo(res);
    return una('probar', res, async () => {
      const series = await listarSeries(crearCliente());
      res.json({ ok: true, entorno: estadoConfig(env).entorno, series });
    });
  }));

  app.post('/api/facturacion/catalogos', h((req, res) => {
    if (soloDireccion(req, res)) return;
    if (esDemo()) return demoNo(res);
    return una('catalogos', res, async () => {
      const resultados = await sincronizarCatalogos(crearCliente(), db);
      auditar(req, 'catalogo', null, 'facturacion', 'Actualizó los catálogos del SAT: ' + resultados.map(r => `${r.catalogo} ${r.total}`).join(', '));
      res.json({ resultados, catalogos: catalogos() });
    });
  }));

  // CP de expedición y series (de factura y de pago) de una sucursal. Lo que no viene, no se toca; null o vacío lo quita.
  app.put('/api/facturacion/sucursales/:id', h((req, res) => {
    if (soloDireccion(req, res)) return;
    const s = db.prepare('SELECT id, nombre FROM sucursales WHERE id = ?').get(Number(req.params.id));
    if (!s) return res.status(404).json({ error: 'Sucursal no encontrada' });
    const b = req.body || {};
    if (!['cp_expedicion', ...Object.keys(TIPOS)].some(k => k in b)) return res.status(400).json({ error: 'No hay nada que cambiar' });
    let cp;
    if ('cp_expedicion' in b) {
      const v = String(b.cp_expedicion ?? '').trim();
      if (v && !/^\d{5}$/.test(v)) return res.status(400).json({ error: 'El código postal de expedición debe tener 5 números (o déjalo vacío para usar el del .env)' });
      cp = v || null;
    }
    const cambios = {};
    for (const campo of Object.keys(TIPOS)) {
      if (!(campo in b)) continue;
      const v = b[campo] == null ? '' : String(b[campo]).trim();
      if (v && !/^\d{1,12}$/.test(v)) return res.status(400).json({ error: 'La serie no es válida: elígela de la lista de factura.com' });
      cambios[campo] = v || null;
    }
    if (Object.values(cambios).some(v => v) && esDemo()) return demoNo(res);
    return una('sucursal-' + s.id, res, async () => {
      const partes = [];
      for (const [campo, serieId] of Object.entries(cambios)) {
        const tipo = TIPOS[campo];
        if (serieId) { const r = await asignarSerie(crearCliente(), db, s.id, tipo, serieId); partes.push(`serie de ${tipo} ${r.serie}`); }
        else { db.prepare('DELETE FROM series_factura WHERE sucursal_id = ? AND tipo_documento = ?').run(s.id, tipo); partes.push(`sin serie de ${tipo}`); }
      }
      if (cp !== undefined) { db.prepare('UPDATE sucursales SET cp_expedicion = ? WHERE id = ?').run(cp, s.id); partes.push(cp ? `CP de expedición ${cp}` : 'CP de expedición del .env'); }
      auditar(req, 'catalogo', s.id, 'facturacion', `Facturación de la sucursal ${s.nombre}: ${partes.join(' · ')}`);
      res.json(sucursales().find(x => x.id === s.id));
    });
  }));
};
