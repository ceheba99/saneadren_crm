/* Facturación CFDI 4.0 · configuración (2026-10-27): rutas de la pantalla «Facturación» de Ajustes. SOLO DIRECCIÓN (igual que Sucursales y Respaldo).
   · Nunca devuelve las llaves de factura.com: solo «puesta» o «falta» (estadoConfig).
   · En el DEMO (MODO_DEMO=1) nada se conecta con factura.com: probar, catálogos y cambiar series responden 409; el CP sí se puede cambiar.
   · Asignar una serie consulta la lista real de factura.com (que exista, que sea del tipo y que esté activa) antes de guardarla.
   · Todo cambio queda en la bitácora general (entidad «catalogo»).
   El cliente de factura.com, el demo y la bitácora llegan por parámetro: así se prueban las rutas sin red. */
const { estadoConfig, leerConfig } = require('./facturacion-config');
const { crearClienteFactura, ErrorFactura } = require('./facturacom');
const { CATALOGOS, TIPOS_CLAVE, sincronizarCatalogos, hayCatalogo, nombreDeClave, buscarClaves } = require('./facturacion-catalogos');
const { listarSeries, asignarSerie } = require('./facturacion-series');
const { validarRFC, normalizarRazonSocial, validarCorreo, validarDatosFiscales } = require('./facturacion-validaciones');
const { leerCatalogos } = require('./facturacion-catalogos');

const TIPOS = { serie_factura: 'factura', serie_pago: 'pago' };

module.exports = function rutasFacturacion(app, db, h, { direccion, puede = () => false, verCliente = () => true, esDemo = () => process.env.MODO_DEMO === '1', crearCliente = () => crearClienteFactura(), env = process.env, auditar = () => {} } = {}) {
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

  // ---------- Claves del SAT de los servicios (2026-10-27) ----------
  // Cada servicio lleva su clave de producto (8 dígitos) y su unidad (2 o 3 caracteres, como E48). Solo se aceptan claves que EXISTEN en el catálogo oficial
  // que bajó factura.com: nada se escribe «a ojo». Sin el catálogo bajado no se guarda ninguna (se pide actualizarlo primero).
  const servicios = () => db.prepare('SELECT id, nombre, clave_prod_serv, clave_unidad FROM catalogo_servicios WHERE activo = 1 ORDER BY orden, id').all().map(s => ({
    id: s.id, nombre: s.nombre, clave_prod_serv: s.clave_prod_serv || '', clave_unidad: s.clave_unidad || '',
    clave_prod_serv_nombre: nombreDeClave(db, TIPOS_CLAVE.producto, s.clave_prod_serv), clave_unidad_nombre: nombreDeClave(db, TIPOS_CLAVE.unidad, s.clave_unidad) }));
  const FORMATO = { clave_prod_serv: [/^\d{8}$/, 'La clave de producto o servicio tiene 8 números (por ejemplo 76121600)', 'producto'], clave_unidad: [/^[A-Z0-9]{2,3}$/, 'La clave de unidad tiene 2 o 3 letras o números (por ejemplo E48)', 'unidad'] };
  /** Revisa las claves que vienen; devuelve { valores: {campo: clave|null}, error } sin tocar nada. */
  function revisarClaves(b) {
    const valores = {};
    for (const [campo, [formato, mensaje, tipo]] of Object.entries(FORMATO)) {
      if (!(campo in b)) continue;
      const v = b[campo] == null ? '' : String(b[campo]).trim().toUpperCase();
      if (!v) { valores[campo] = null; continue; }
      if (!formato.test(v)) return { error: mensaje, codigo: 400 };
      if (!hayCatalogo(db, TIPOS_CLAVE[tipo])) return { error: 'Primero actualiza los catálogos del SAT (botón de arriba): así se comprueba que la clave exista.', codigo: 409 };
      if (!nombreDeClave(db, TIPOS_CLAVE[tipo], v)) return { error: `La clave ${v} no aparece en el catálogo del SAT`, codigo: 400 };
      valores[campo] = v;
    }
    return { valores };
  }
  const guardarClaves = (id, valores) => {
    if ('clave_prod_serv' in valores) db.prepare('UPDATE catalogo_servicios SET clave_prod_serv = ? WHERE id = ?').run(valores.clave_prod_serv, id);
    if ('clave_unidad' in valores) db.prepare('UPDATE catalogo_servicios SET clave_unidad = ?, nombre_unidad = ? WHERE id = ?').run(valores.clave_unidad, valores.clave_unidad ? nombreDeClave(db, TIPOS_CLAVE.unidad, valores.clave_unidad) : null, id);
  };
  const resumenClaves = v => ['clave_prod_serv' in v && `producto ${v.clave_prod_serv || '(vacía)'}`, 'clave_unidad' in v && `unidad ${v.clave_unidad || '(vacía)'}`].filter(Boolean).join(' · ');

  app.get('/api/facturacion/servicios', h((req, res) => {
    if (soloDireccion(req, res)) return;
    res.json({ servicios: servicios(), catalogo: { productos: hayCatalogo(db, TIPOS_CLAVE.producto), unidades: hayCatalogo(db, TIPOS_CLAVE.unidad) } });
  }));
  // Para sugerir claves al escribir: por clave (empieza con…) o por palabras del nombre.
  app.get('/api/facturacion/buscar-clave', h((req, res) => {
    if (soloDireccion(req, res)) return;
    const tipo = TIPOS_CLAVE[String(req.query.tipo || '')];
    if (!tipo) return res.status(400).json({ error: 'El tipo de clave debe ser «producto» o «unidad»' });
    res.json({ resultados: buscarClaves(db, tipo, req.query.q), catalogo_vacio: !hayCatalogo(db, tipo) });
  }));
  app.put('/api/facturacion/servicios/:id', h((req, res) => {
    if (soloDireccion(req, res)) return;
    const s = db.prepare('SELECT id, nombre FROM catalogo_servicios WHERE id = ? AND activo = 1').get(Number(req.params.id));
    if (!s) return res.status(404).json({ error: 'Servicio no encontrado' });
    const b = req.body || {};
    if (!Object.keys(FORMATO).some(k => k in b)) return res.status(400).json({ error: 'No hay nada que cambiar' });
    const r = revisarClaves(b); if (r.error) return res.status(r.codigo).json({ error: r.error });
    guardarClaves(s.id, r.valores);
    auditar(req, 'catalogo', s.id, 'facturacion', `Claves del SAT del servicio ${s.nombre}: ${resumenClaves(r.valores)}`);
    res.json(servicios().find(x => x.id === s.id));
  }));
  // Pone la misma clave de producto y unidad a TODOS los servicios que todavía no la tengan (los que ya tienen no se tocan).
  app.post('/api/facturacion/servicios/aplicar', h((req, res) => {
    if (soloDireccion(req, res)) return;
    const b = req.body || {};
    if (!String(b.clave_prod_serv ?? '').trim() || !String(b.clave_unidad ?? '').trim()) return res.status(400).json({ error: 'Escribe la clave de producto y la unidad que quieres aplicar' });
    const r = revisarClaves({ clave_prod_serv: b.clave_prod_serv, clave_unidad: b.clave_unidad }); if (r.error) return res.status(r.codigo).json({ error: r.error });
    let cambiados = 0;
    for (const s of db.prepare('SELECT id, clave_prod_serv, clave_unidad FROM catalogo_servicios WHERE activo = 1').all()) {
      const v = {}; if (!s.clave_prod_serv) v.clave_prod_serv = r.valores.clave_prod_serv; if (!s.clave_unidad) v.clave_unidad = r.valores.clave_unidad;
      if (Object.keys(v).length) { guardarClaves(s.id, v); cambiados++; }
    }
    if (cambiados) auditar(req, 'catalogo', null, 'facturacion', `Claves del SAT puestas a ${cambiados} servicio(s) que no tenían: ${resumenClaves(r.valores)}`);
    res.json({ actualizados: cambiados, servicios: servicios() });
  }));

  // ---------- Datos fiscales de los clientes (2026-10-27) ----------
  // Los capturan Dirección, el Gerente y quien tenga el permiso «Datos fiscales de clientes» (quien factura). Un cliente puede tener varios (varias razones
  // sociales). Se pueden guardar incompletos (solo el RFC es obligatorio): la pantalla dice qué falta y el timbrado no sale hasta que esté completo.
  // Nunca se borran: se desactivan. Con facturas ya hechas, el RFC no se cambia (se crea otro dato fiscal).
  const puedeFiscal = req => direccion(req) || puede(req, 'facturacion.fiscales');
  const sinPermisoFiscal = (req, res) => { if (puedeFiscal(req)) return false; res.status(403).json({ error: 'No tienes permiso para los datos fiscales de clientes' }); return true; };
  const fiscalDe = (f, cat) => { const v = validarDatosFiscales(f, cat); return { id: f.id, cliente_id: f.cliente_id, rfc: f.rfc, razon_social: f.razon_social, cp: f.cp, regimen: f.regimen, uso_cfdi: f.uso_cfdi, correo: f.correo,
    predeterminado: !!f.predeterminado, activo: !!f.activo, sincronizado: !!f.uid_facturacom, listo: v.listo, faltantes: v.faltantes, errores: v.errores, avisos: v.avisos.filter(a => !/MAYÚSCULAS|Se quitó/.test(a)) }; };
  /** Revisa lo que viene (solo los campos presentes) contra los catálogos del SAT si ya se bajaron; devuelve { valores, avisos } o { error }. Sin tocar nada. */
  function revisarFiscal(b, actual, cat) {
    const v = {}, avisos = [];
    if ('rfc' in b || !actual) { const r = validarRFC(b.rfc); if (!r.ok) return { error: r.mensaje }; v.rfc = r.rfc; }
    if ('razon_social' in b) { const n = normalizarRazonSocial(b.razon_social); if (n.texto.length > 254) return { error: 'La razón social es demasiado larga' }; v.razon_social = n.texto; avisos.push(...n.avisos); }
    if ('cp' in b) { const t = String(b.cp ?? '').replace(/\s+/g, ''); if (t && !/^\d{5}$/.test(t)) return { error: 'El código postal fiscal debe tener 5 números' }; v.cp = t; }
    if ('regimen' in b) { const t = String(b.regimen ?? '').trim(); if (t && !/^\d{3}$/.test(t)) return { error: 'El régimen fiscal es la clave de 3 números (por ejemplo 601)' }; if (t && cat.regimenes && !cat.regimenes.has(t)) return { error: `El régimen ${t} no está en el catálogo del SAT` }; v.regimen = t; }
    if ('uso_cfdi' in b) { const t = String(b.uso_cfdi ?? '').trim().toUpperCase(); if (t && !/^[A-Z0-9]{2,4}$/.test(t)) return { error: 'El uso de CFDI no es válido (por ejemplo G03)' }; if (t && cat.usos && !cat.usos.has(t)) return { error: `El uso de CFDI ${t} no está en el catálogo del SAT` }; v.uso_cfdi = t; }
    if ('correo' in b) { const t = String(b.correo ?? '').trim(); if (t) { const c = validarCorreo(t); if (!c.ok) return { error: c.mensaje }; } v.correo = t; }
    const regimen = v.regimen ?? actual?.regimen ?? '', uso = v.uso_cfdi ?? actual?.uso_cfdi ?? '', u = cat.usos?.get(uso);
    if (regimen && uso && u?.regimenes?.length && !u.regimenes.includes(regimen)) return { error: `El uso ${uso} no es compatible con el régimen ${regimen}: elige otro uso o revisa el régimen en la Constancia de Situación Fiscal` };
    return { valores: v, avisos };
  }
  const clienteVisible = (req, res) => {
    const c = db.prepare('SELECT id, nombre, empresa_contacto, rfc, correo FROM clientes WHERE id = ?').get(Number(req.params.id));
    if (!c || !verCliente(c.id)) { res.status(404).json({ error: 'Cliente no encontrado' }); return null; }
    return c;
  };

  app.get('/api/facturacion/clientes/:id', h((req, res) => {
    if (sinPermisoFiscal(req, res)) return;
    const c = clienteVisible(req, res); if (!c) return;
    const cat = leerCatalogos(db);
    res.json({
      fiscales: db.prepare('SELECT * FROM clientes_fiscales WHERE cliente_id = ? ORDER BY activo DESC, predeterminado DESC, id').all(c.id).map(f => fiscalDe(f, cat)),
      catalogo: { regimenes: cat.regimenes ? [...cat.regimenes].map(([clave, nombre]) => ({ clave, nombre })) : null, usos: cat.usos ? [...cat.usos].map(([clave, u]) => ({ clave, nombre: u.nombre, regimenes: u.regimenes })) : null },
      // Lo que ya se sabe del cliente, para no teclearlo otra vez (se confirma al guardar: la razón social va como en la Constancia).
      sugerencia: { rfc: c.rfc || '', razon_social: normalizarRazonSocial(c.empresa_contacto || c.nombre || '').texto, correo: c.correo || '' },
    });
  }));
  app.post('/api/facturacion/clientes/:id', h((req, res) => {
    if (sinPermisoFiscal(req, res)) return;
    const c = clienteVisible(req, res); if (!c) return;
    const cat = leerCatalogos(db), b = req.body || {}, r = revisarFiscal(b, null, cat); if (r.error) return res.status(400).json({ error: r.error });
    const v = { razon_social: '', cp: '', regimen: '', uso_cfdi: '', correo: '', ...r.valores };
    if (db.prepare('SELECT 1 FROM clientes_fiscales WHERE cliente_id = ? AND rfc = ?').get(c.id, v.rfc)) return res.status(409).json({ error: 'Este cliente ya tiene datos fiscales con ese RFC: edítalos o desactívalos' });
    const primero = !db.prepare('SELECT 1 FROM clientes_fiscales WHERE cliente_id = ? AND activo = 1').get(c.id);
    const id = Number(db.prepare('INSERT INTO main.clientes_fiscales (cliente_id, rfc, razon_social, cp, regimen, uso_cfdi, correo, predeterminado, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(c.id, v.rfc, v.razon_social, v.cp, v.regimen, v.uso_cfdi, v.correo, primero || b.predeterminado ? 1 : 0, req.usuarioSesion?.id ?? null).lastInsertRowid);
    if (!primero && b.predeterminado) db.prepare('UPDATE main.clientes_fiscales SET predeterminado = 0 WHERE cliente_id = ? AND id <> ?').run(c.id, id);
    // La historia del cliente la ve quien ve al cliente: aquí solo se dice QUÉ pasó, nunca los valores (RFC, razón social…), que son solo de quien tiene el permiso.
    auditar(req, 'cliente', c.id, 'datos_fiscales', 'Alta de datos fiscales');
    res.status(201).json({ ...fiscalDe(db.prepare('SELECT * FROM clientes_fiscales WHERE id = ?').get(id), cat), avisos_guardado: r.avisos });
  }));
  app.put('/api/facturacion/fiscales/:id', h((req, res) => {
    if (sinPermisoFiscal(req, res)) return;
    const f = db.prepare('SELECT * FROM clientes_fiscales WHERE id = ?').get(Number(req.params.id));
    if (!f || !verCliente(f.cliente_id)) return res.status(404).json({ error: 'Datos fiscales no encontrados' });
    const cat = leerCatalogos(db), b = req.body || {};
    const campos = ['rfc', 'razon_social', 'cp', 'regimen', 'uso_cfdi', 'correo', 'predeterminado', 'activo'];
    if (!campos.some(k => k in b)) return res.status(400).json({ error: 'No hay nada que cambiar' });
    const r = revisarFiscal(b, f, cat); if (r.error) return res.status(400).json({ error: r.error });
    const v = r.valores;
    if (v.rfc && v.rfc !== f.rfc) {
      if (db.prepare('SELECT 1 FROM facturas WHERE cliente_fiscal_id = ?').get(f.id)) return res.status(409).json({ error: 'Ya se hicieron facturas con estos datos: el RFC no se cambia. Crea otros datos fiscales con el RFC nuevo.' });
      if (db.prepare('SELECT 1 FROM clientes_fiscales WHERE cliente_id = ? AND rfc = ? AND id <> ?').get(f.cliente_id, v.rfc, f.id)) return res.status(409).json({ error: 'Este cliente ya tiene datos fiscales con ese RFC' });
    }
    const cambios = Object.fromEntries(Object.entries(v).filter(([k, x]) => x !== f[k]));
    if ('activo' in b) cambios.activo = b.activo ? 1 : 0;
    if ('predeterminado' in b) cambios.predeterminado = b.predeterminado ? 1 : 0;
    for (const k of ['activo', 'predeterminado']) if (cambios[k] === f[k]) delete cambios[k];
    if (cambios.activo === 0) cambios.predeterminado = 0;
    if (!Object.keys(cambios).length) return res.json({ ...fiscalDe(f, cat), avisos_guardado: r.avisos });
    // Si cambia el RFC ya no es el mismo cliente de factura.com: se suelta el vínculo (se vuelve a dar de alta al facturar).
    if (cambios.rfc) cambios.uid_facturacom = null;
    db.prepare(`UPDATE main.clientes_fiscales SET ${Object.keys(cambios).map(k => k + ' = ?').join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`).run(...Object.values(cambios), f.id);
    if (cambios.predeterminado === 1) db.prepare('UPDATE main.clientes_fiscales SET predeterminado = 0 WHERE cliente_id = ? AND id <> ?').run(f.cliente_id, f.id);
    if (cambios.predeterminado === 0 && cambios.activo === 0) { const otro = db.prepare('SELECT id FROM clientes_fiscales WHERE cliente_id = ? AND activo = 1 AND id <> ? ORDER BY id').get(f.cliente_id, f.id); if (otro) db.prepare('UPDATE main.clientes_fiscales SET predeterminado = 1 WHERE id = ?').run(otro.id); }
    const nombres = { rfc: 'RFC', razon_social: 'razón social', cp: 'código postal', regimen: 'régimen', uso_cfdi: 'uso de CFDI', correo: 'correo', activo: 'activo', predeterminado: 'predeterminado' };
    auditar(req, 'cliente', f.cliente_id, 'datos_fiscales', `Datos fiscales: cambió ${Object.keys(cambios).filter(k => k !== 'uid_facturacom').map(k => nombres[k] || k).join(', ')}${cambios.activo === 0 ? ' (desactivados)' : ''}`);
    res.json({ ...fiscalDe(db.prepare('SELECT * FROM clientes_fiscales WHERE id = ?').get(f.id), cat), avisos_guardado: r.avisos });
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
