/* Facturación CFDI 4.0 · configuración (2026-10-27): rutas de la pantalla «Facturación» de Ajustes. SOLO DIRECCIÓN (igual que Sucursales y Respaldo).
   · Nunca devuelve las llaves de factura.com: solo «puesta» o «falta» (estadoConfig).
   · En el DEMO (MODO_DEMO=1) nada se conecta con factura.com: probar, catálogos y cambiar series responden 409; el CP sí se puede cambiar.
   · Asignar una serie consulta la lista real de factura.com (que exista, que sea del tipo y que esté activa) antes de guardarla.
   · Todo cambio queda en la bitácora general (entidad «catalogo»).
   El cliente de factura.com, el demo y la bitácora llegan por parámetro: así se prueban las rutas sin red. */
const { estadoConfig, leerConfig } = require('./facturacion-config');
const { crearClienteFactura, ErrorFactura } = require('./facturacom');
const { CATALOGOS, TIPOS_CLAVE, sincronizarCatalogos, hayCatalogo, nombreDeClave, buscarClaves } = require('./facturacion-catalogos');
const { listarSeries, asignarSerie, crearSerie } = require('./facturacion-series');
const { validarRFC, normalizarRazonSocial, validarCorreo, validarDatosFiscales } = require('./facturacion-validaciones');
const { leerCatalogos } = require('./facturacion-catalogos');
const { preparar, timbrar, resolverSinRespuesta, descargarArchivos, vistaFactura } = require('./facturacion-timbrado');
const { vincularCliente } = require('./facturacion-clientes');
const { cancelar, consultarEstatus, esAcuse, MOTIVOS } = require('./facturacion-cancelacion');
const fs = require('fs'), path = require('path');
const { ESTATUS, ESTATUS_VIGENTES } = require('./facturacion-db');
const VIGENTES = ESTATUS_VIGENTES.map(e => `'${e}'`).join(', ');

const TIPOS = { serie_factura: 'factura', serie_pago: 'pago' };

module.exports = function rutasFacturacion(app, db, h, { direccion, puede = () => false, verCliente = () => true, esDemo = () => process.env.MODO_DEMO === '1', crearCliente = () => crearClienteFactura(), env = process.env, auditar = () => {},
  dirArchivos = path.join(env.DB_PATH ? path.dirname(path.resolve(env.DB_PATH)) : path.join(__dirname, '..'), 'archivos') } = {}) {
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

  // Crear una serie nueva con el nombre que escribe Dirección (p. ej. «QRO» para Querétaro) y dejarla asignada a la sucursal (2026-10-29). La serie se
  // imprime junto al folio de cada factura, así se sabe de qué sucursal es. Las facturas ya hechas conservan su serie; las nuevas empiezan en el folio 1.
  app.post('/api/facturacion/sucursales/:id/crear-serie', h((req, res) => {
    if (soloDireccion(req, res)) return;
    const s = db.prepare('SELECT id, nombre FROM sucursales WHERE id = ? AND activo = 1').get(Number(req.params.id));
    if (!s) return res.status(404).json({ error: 'Sucursal no encontrada' });
    const b = req.body || {}, tipo = String(b.tipo || ''), letra = String(b.letra ?? '').trim().toUpperCase();
    if (!Object.values(TIPOS).includes(tipo)) return res.status(400).json({ error: 'El tipo de serie es «factura» o «pago»' });
    if (!/^[A-Z0-9]{1,10}$/.test(letra)) return res.status(400).json({ error: 'La serie lleva de 1 a 10 letras o números, sin espacios ni acentos (por ejemplo QRO)' });
    if (esDemo()) return demoNo(res);
    return una('sucursal-' + s.id, res, async () => {
      const cliente = crearCliente();
      const serie = await crearSerie(cliente, { letra, tipoDocumento: tipo });
      const r = await asignarSerie(cliente, db, s.id, tipo, serie.id);
      auditar(req, 'catalogo', s.id, 'facturacion', `Creó la serie de ${tipo} «${r.serie}» en factura.com y la asignó a la sucursal ${s.nombre}`);
      res.status(201).json(sucursales().find(x => x.id === s.id));
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

  // ---------- Timbrado de la factura de una orden (F3, 2026-10-27) ----------
  // Timbran Dirección, el Gerente y quien tenga el permiso «Timbrar facturas» (quien factura). La orden tiene que estar a su alcance (si no, 404).
  // Las facturas de una orden (folio fiscal, receptor, XML y PDF) las ve solo quien puede timbrar: la demás gente ve el folio en «Crédito y factura».
  const puedeTimbrar = req => direccion(req) || puede(req, 'facturacion.timbrar');
  const sinPermisoTimbrar = (req, res) => { if (puedeTimbrar(req)) return false; res.status(403).json({ error: 'No tienes permiso para facturar' }); return true; };
  const ctxDe = req => ({ config: leerConfig(env), demo: esDemo(), crearCliente, dirArchivos, usuario: { id: req.usuarioSesion?.id ?? null, nombre: req.usuarioSesion?.nombre || '' } });
  const ordenVisible = (req, res) => {
    const l = db.prepare('SELECT id, estatus, cliente_id FROM leads WHERE id = ?').get(Number(req.params.id)); // «leads» respeta el alcance de quien pide
    if (!l) { res.status(404).json({ error: 'Orden no encontrada' }); return null; }
    return l;
  };
  const facturaVisible = (req, res) => {
    const f = db.prepare('SELECT * FROM facturas WHERE id = ?').get(Number(req.params.id));
    if (!f || (f.lead_id && !db.prepare('SELECT 1 FROM leads WHERE id = ?').get(f.lead_id))) { res.status(404).json({ error: 'Factura no encontrada' }); return null; }
    return f;
  };
  const opcionesDe = q => ({ sustituye_a: q.sustituye_a ? Number(q.sustituye_a) : undefined, cliente_fiscal_id: q.cliente_fiscal_id ? Number(q.cliente_fiscal_id) : undefined, uso_cfdi: q.uso_cfdi || undefined, forma_pago: q.forma_pago || undefined,
    enviar_correo: q.enviar_correo === undefined ? undefined : !(q.enviar_correo === false || q.enviar_correo === '0' || q.enviar_correo === 'false'), confirmar: q.confirmar === true || q.confirmar === '1' });
  function preparacion(leadId, op) {
    const p = preparar(db, leadId, op, { config: leerConfig(env), demo: esDemo() }); if (!p) return null;
    const cat = leerCatalogos(db);
    return { errores: p.errores, avisos: p.avisos, confirmar: p.confirmar, resumen: p.resumen, formas_pago: p.formas,
      fiscales: p.fiscales.map(f => ({ id: f.id, rfc: f.rfc, razon_social: f.razon_social, regimen: f.regimen, uso_cfdi: f.uso_cfdi, listo: validarDatosFiscales(f, cat).listo, predeterminado: !!f.predeterminado })),
      usos: p.fiscal && cat.usos ? [...cat.usos].filter(([, u]) => !u.regimenes?.length || u.regimenes.includes(p.fiscal.regimen)).map(([clave, u]) => ({ clave, nombre: u.nombre })) : [],
      listo: !p.errores.length };
  }
  const facturasDe = leadId => db.prepare('SELECT * FROM facturas WHERE lead_id = ? ORDER BY id DESC').all(leadId).map(f => ({ ...vistaFactura(f), sustituta: f.estatus === 'timbrada' ? sustitutaDe(f.id) : null }));

  app.get('/api/facturacion/ordenes/:id', h((req, res) => {
    if (sinPermisoTimbrar(req, res)) return;
    const l = ordenVisible(req, res); if (!l) return;
    const c = estadoConfig(env);
    res.json({ entorno: esDemo() ? 'demo' : c.entorno, prueba: esDemo() || c.entorno !== 'prod', facturas: facturasDe(l.id),
      preparacion: l.estatus === 'ganado' ? preparacion(l.id, opcionesDe(req.query)) : null });
  }));

  app.post('/api/facturacion/ordenes/:id/timbrar', h((req, res) => {
    if (sinPermisoTimbrar(req, res)) return;
    const l = ordenVisible(req, res); if (!l) return;
    return una('orden-' + l.id, res, async () => {
      try {
        const r = await timbrar(db, l.id, opcionesDe(req.body || {}), ctxDe(req));
        const f = r.factura;
        if (r.estado === 'timbrada') auditar(req, 'orden_servicio', l.id, 'factura', `Timbró la factura ${f.serie || ''}-${f.folio || ''}${f.entorno === 'prod' ? '' : f.entorno === 'demo' ? ' (demostración)' : ' (de prueba, sandbox)'}`);
        res.json({ estado: r.estado, factura: vistaFactura(f), avisos: r.avisos || [], mensaje: r.mensaje || null, detalles: r.detalles || [] });
        // El XML y el PDF se bajan después de contestar (así la respuesta no pasa del minuto); si fallan, se bajan desde sus botones.
        if (r.descargas) await r.descargas;
      } catch (e) {
        if (e instanceof ErrorFactura && e.confirmar) return res.status(409).json({ codigo: 'CONFIRMAR', error: e.message, confirmar: e.confirmar });
        if (e instanceof ErrorFactura && e.candidatos) return res.status(409).json({ codigo: 'CLIENTE_EXISTE', error: e.message, candidatos: e.candidatos, cliente_fiscal_id: e.cliente_fiscal_id });
        if (e instanceof ErrorFactura && e.faltan) return res.status(400).json({ error: e.message, faltan: e.faltan });
        throw e;
      }
    });
  }));

  // Una factura que se quedó sin respuesta («timbrando»): se busca en factura.com por su número de orden. No manda nada nuevo.
  app.post('/api/facturacion/facturas/:id/verificar', h((req, res) => {
    if (sinPermisoTimbrar(req, res)) return;
    const f = facturaVisible(req, res); if (!f) return;
    if (f.estatus !== 'timbrando') return res.status(409).json({ error: 'Solo se verifica una factura que se quedó sin respuesta' });
    if (f.entorno === 'demo' || esDemo()) return demoNo(res);
    if (f.entorno !== leerConfig(env).entorno) return res.status(409).json({ error: `Esta factura es de ${f.entorno === 'prod' ? 'producción' : 'pruebas'} y la conexión está en otro entorno` });
    return una('orden-' + f.lead_id, res, async () => {
      // La misma puerta que usa el timbrado: busca por NumOrder y solo libera la factura si no existe Y ya pasó el minuto de espera.
      const r = await resolverSinRespuesta(db, crearCliente(), f, ctxDe(req));
      const ahora = db.prepare('SELECT * FROM facturas WHERE id = ?').get(f.id);
      res.json({ encontrada: r.estado !== 'pendiente', estado: ahora.estatus, factura: vistaFactura(ahora), avisos: r.avisos || [], mensaje: r.mensaje || null });
      if (r.descargas) await r.descargas;
    });
  }));

  // El RFC ya existía en factura.com: quien factura elige cuál de esos clientes es (se comprueba que sea el mismo RFC) y vuelve a timbrar.
  app.post('/api/facturacion/fiscales/:id/vincular', h((req, res) => {
    if (sinPermisoTimbrar(req, res)) return;
    const fi = db.prepare('SELECT id, cliente_id FROM clientes_fiscales WHERE id = ?').get(Number(req.params.id));
    if (!fi || !verCliente(fi.cliente_id)) return res.status(404).json({ error: 'Datos fiscales no encontrados' });
    const uid = String(req.body?.uid ?? '').trim();
    if (!/^[A-Za-z0-9-]{1,64}$/.test(uid)) return res.status(400).json({ error: 'Elige un cliente de la lista' });
    if (esDemo()) return demoNo(res);
    return una('fiscal-' + fi.id, res, async () => {
      await vincularCliente(crearCliente(), db, fi.id, uid);
      auditar(req, 'cliente', fi.cliente_id, 'datos_fiscales', 'Datos fiscales: se enlazaron con su cliente de factura.com');
      res.json({ ok: true });
    });
  }));

  // Descargas: el XML sale de la base; el PDF del disco (si no se bajó al timbrar, se baja ahora de factura.com y se guarda).
  const nombreArchivo = (f, ext) => `factura-${String(f.serie || '').replace(/[^A-Za-z0-9]/g, '')}${String(f.folio || f.id).replace(/[^A-Za-z0-9]/g, '')}${f.entorno === 'prod' ? '' : '-PRUEBA'}.${ext}`;
  app.get('/api/facturacion/facturas/:id/xml', h((req, res) => {
    if (sinPermisoTimbrar(req, res)) return;
    const f = facturaVisible(req, res); if (!f) return;
    const enviar = xml => res.set('Content-Type', 'application/xml; charset=utf-8').set('Content-Disposition', `attachment; filename="${nombreArchivo(f, 'xml')}"`).send(xml);
    if (f.xml) return enviar(f.xml);
    // Timbrada pero sin XML guardado (falló la descarga al timbrar): se baja ahora de factura.com y se guarda.
    if (f.estatus !== 'timbrada' || !f.uuid || f.entorno === 'demo' || esDemo()) return res.status(404).json({ error: 'Esta factura no tiene XML guardado' });
    if (f.entorno !== leerConfig(env).entorno) return res.status(409).json({ error: 'El XML no está guardado y la conexión está en otro entorno: no se puede bajar ahora' });
    return una('xml-' + f.id, res, async () => {
      await descargarArchivos(db, crearCliente(), f, { usuarioId: req.usuarioSesion?.id, soloXml: true });
      const ahora = db.prepare('SELECT xml FROM facturas WHERE id = ?').get(f.id);
      if (!ahora?.xml) return res.status(502).json({ error: 'factura.com no entregó el XML; intenta más tarde' });
      enviar(ahora.xml);
    });
  }));
  app.get('/api/facturacion/facturas/:id/pdf', h((req, res) => {
    if (sinPermisoTimbrar(req, res)) return;
    const f = facturaVisible(req, res); if (!f) return;
    const enviar = ruta => res.set('Content-Type', 'application/pdf').set('Content-Disposition', `attachment; filename="${nombreArchivo(f, 'pdf')}"`).send(fs.readFileSync(ruta));
    const dentro = r => path.resolve(r).startsWith(path.resolve(dirArchivos) + path.sep);
    const ruta = f.pdf_path ? path.join(dirArchivos, f.pdf_path) : null;
    if (ruta && dentro(ruta) && fs.existsSync(ruta)) return enviar(ruta);
    if (f.estatus !== 'timbrada' || !f.uuid || f.entorno === 'demo' || esDemo()) return res.status(404).json({ error: 'Esta factura no tiene PDF' });
    if (f.entorno !== leerConfig(env).entorno) return res.status(409).json({ error: 'El PDF no está guardado y la conexión está en otro entorno: no se puede bajar ahora' });
    return una('pdf-' + f.id, res, async () => {
      await descargarArchivos(db, crearCliente(), f, { dirArchivos, usuarioId: req.usuarioSesion?.id });
      const ahora = db.prepare('SELECT pdf_path FROM facturas WHERE id = ?').get(f.id);
      if (!ahora?.pdf_path) return res.status(502).json({ error: 'factura.com no entregó el PDF; intenta más tarde' });
      enviar(path.join(dirArchivos, ahora.pdf_path));
    });
  }));

  // ---------- Vista de facturas, reenvío y borradores atorados (F4, 2026-10-28) ----------
  // La lista y los avisos los ve quien puede timbrar; la base ya filtra por sucursal (vista «facturas» de sucursales.js). Reenviar por correo solo
  // existe en PRODUCCIÓN (en pruebas no se manda correo: regla 7). Descartar un borrador atorado es solo de Dirección.
  const folioDeOrden = f => (f.lead_id ? require('./sucursales').folio('OS', 'leads', f.lead_id, f.created_at) : '');
  const filaLista = f => ({ ...vistaFactura(f), folio_orden: folioDeOrden(f), sucursal_id: f.sucursal_id,
    puede_reenviar: f.estatus === 'timbrada' && f.entorno === 'prod' && !!f.receptor_correo, puede_descartar: f.estatus === 'borrador_error', sustituta: f.estatus === 'timbrada' ? sustitutaDe(f.id) : null });
  const sustitutaDe = id => db.prepare("SELECT id, serie, folio FROM facturas WHERE sustituye_a = ? AND estatus = 'timbrada' ORDER BY id DESC LIMIT 1").get(id) || null;
  const textoFiltro = v => String(v ?? '').trim().toLocaleLowerCase('es-MX');
  const FECHA = /^\d{4}-\d{2}-\d{2}$/;

  app.get('/api/facturacion/facturas', h((req, res) => {
    if (sinPermisoTimbrar(req, res)) return;
    const q = req.query, donde = [], args = [];
    if (q.estatus) { if (!ESTATUS.includes(String(q.estatus))) return res.status(400).json({ error: 'Ese estado de factura no existe' }); donde.push('estatus = ?'); args.push(String(q.estatus)); }
    if (q.entorno === 'prod') donde.push("entorno = 'prod'"); else if (q.entorno === 'prueba') donde.push("entorno IN ('sandbox', 'demo')");
    if (q.sucursal) { donde.push('sucursal_id = ?'); args.push(Number(q.sucursal) || 0); }
    for (const [k, op] of [['desde', '>='], ['hasta', '<=']]) if (q[k]) {
      if (!FECHA.test(String(q[k]))) return res.status(400).json({ error: 'La fecha no es válida' });
      donde.push(`substr(COALESCE(fecha_timbrado, created_at), 1, 10) ${op} ?`); args.push(String(q[k]));
    }
    let filas = db.prepare(`SELECT * FROM facturas ${donde.length ? 'WHERE ' + donde.join(' AND ') : ''} ORDER BY id DESC LIMIT 1000`).all(...args).map(filaLista);
    const t = textoFiltro(q.q);
    if (t) filas = filas.filter(f => [f.serie && f.folio ? `${f.serie}-${f.folio}` : '', f.serie, f.folio, f.uuid, f.receptor_rfc, f.receptor_razon_social, f.folio_orden].some(x => textoFiltro(x).includes(t)));
    const c = estadoConfig(env);
    res.json({ entorno: esDemo() ? 'demo' : c.entorno, total: filas.length, truncado: filas.length > 200, facturas: filas.slice(0, 200),
      sucursales: db.prepare('SELECT id, nombre FROM sucursales WHERE activo = 1 ORDER BY id').all() });
  }));

  // Lo que pide atención en Inicio: facturas sin respuesta, borradores por corregir, rechazadas, y órdenes realizadas con IVA que todavía no se facturan.
  app.get('/api/facturacion/avisos', h((req, res) => {
    if (sinPermisoTimbrar(req, res)) return;
    const entorno = esDemo() ? 'demo' : estadoConfig(env).entorno, avisos = [];
    const TEXTO = { cancelacion_solicitada: ['amarillo', 'Cancelación pedida y todavía sin confirmar por el SAT: consulta su estatus'], timbrando: ['rojo', 'Sin respuesta de factura.com: abre la orden y pulsa «Verificar» (no la mandes otra vez sin revisar)'], borrador_error: ['rojo', 'Quedó en borrador: corrige lo que dice el motivo y vuelve a timbrar'], pendiente: ['amarillo', 'No se timbró: revisa el motivo y vuelve a intentar'] };
    for (const f of db.prepare("SELECT * FROM facturas WHERE entorno = ? AND ((estatus IN ('timbrando', 'borrador_error', 'cancelacion_solicitada')) OR (estatus = 'pendiente' AND error_json IS NOT NULL)) ORDER BY id DESC LIMIT 30").all(entorno)) {
      const v = vistaFactura(f), [nivel, texto] = TEXTO[f.estatus];
      avisos.push({ tipo: f.estatus, nivel, lead_id: f.lead_id, folio: folioDeOrden(f), nombre: f.receptor_razon_social, texto: v.error ? `${texto}. Motivo: ${v.error}` : texto });
    }
    // Sustituta timbrada y original todavía vigente: hay DOS facturas vigentes ante el SAT para la misma venta.
    for (const o of db.prepare("SELECT o.* FROM facturas o JOIN facturas s ON s.sustituye_a = o.id AND s.estatus = 'timbrada' WHERE o.entorno = ? AND o.estatus = 'timbrada' ORDER BY o.id DESC LIMIT 20").all(entorno))
      avisos.push({ tipo: 'sin_cancelar', nivel: 'rojo', lead_id: o.lead_id, folio: folioDeOrden(o), nombre: o.receptor_razon_social, texto: `La factura ${o.serie || ''}-${o.folio || ''} ya tiene su sustituta timbrada y sigue vigente: cancélala con el motivo 01` });
    // Realizadas en los últimos 60 días, con IVA, sin folio de factura capturado ni factura vigente en este entorno.
    const porFacturar = db.prepare(`SELECT l.id, l.created_at, l.fecha_realizado, COALESCE(c.empresa_contacto, c.nombre) AS cliente FROM leads l LEFT JOIN clientes c ON c.id = l.cliente_id
      WHERE l.estatus = 'ganado' AND l.ejecucion = 'realizado' AND l.iva_modo IN ('mas_iva', 'incluido') AND (l.factura_folio IS NULL OR l.factura_folio = '')
        AND l.fecha_realizado >= date('now', 'localtime', '-60 days')
        AND NOT EXISTS (SELECT 1 FROM facturas f WHERE f.lead_id = l.id AND f.entorno = ? AND f.tipo_documento = 'factura' AND (f.estatus IN (${VIGENTES}) OR (f.estatus = 'cancelada' AND f.motivo_cancelacion = '03')))
      ORDER BY l.fecha_realizado DESC, l.id DESC LIMIT 40`).all(entorno);
    for (const o of porFacturar.slice(0, 15)) avisos.push({ tipo: 'por_facturar', nivel: 'azul', lead_id: o.id, folio: require('./sucursales').folio('OS', 'leads', o.id, o.created_at), nombre: o.cliente || '', fecha: o.fecha_realizado, texto: 'Realizada con IVA y todavía sin factura' });
    res.json({ entorno, avisos, por_facturar_total: porFacturar.length });
  }));

  // Reenviar la factura al correo que tiene factura.com del cliente. Solo producción, solo timbradas.
  app.post('/api/facturacion/facturas/:id/reenviar', h((req, res) => {
    if (sinPermisoTimbrar(req, res)) return;
    const f = facturaVisible(req, res); if (!f) return;
    if (f.estatus !== 'timbrada' || !f.uuid) return res.status(409).json({ error: 'Solo se reenvía una factura ya timbrada' });
    if (f.entorno !== 'prod') return res.status(409).json({ error: 'En pruebas (sandbox) y en el demo no se manda correo: solo las facturas reales se reenvían.' });
    if (esDemo() || leerConfig(env).entorno !== 'prod') return res.status(409).json({ error: 'La conexión no está en producción: no se puede reenviar ahora.' });
    if (!f.receptor_correo) return res.status(409).json({ error: 'Esta factura no tiene correo del receptor.' });
    return una('reenviar-' + f.id, res, async () => {
      try { await crearCliente().get(`/v4/cfdi40/${encodeURIComponent(f.uuid)}/email`); }
      catch (e) { db.prepare('INSERT INTO main.facturas_log (factura_id, lead_id, accion, resultado, http_status, mensaje, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(f.id, f.lead_id, 'reenviar', 'error', e.httpStatus ?? null, String(e.message).slice(0, 500), req.usuarioSesion?.id ?? null); throw e; }
      db.prepare('INSERT INTO main.facturas_log (factura_id, lead_id, accion, resultado, usuario_id) VALUES (?, ?, ?, ?, ?)').run(f.id, f.lead_id, 'reenviar', 'ok', req.usuarioSesion?.id ?? null);
      auditar(req, 'orden_servicio', f.lead_id, 'factura', `Reenvió la factura ${f.serie || ''}-${f.folio || ''} al correo del cliente`);
      res.json({ ok: true, mensaje: 'Factura enviada al correo del cliente.' });
    });
  }));

  // Descartar un borrador que quedó atorado (se borró en el panel, venció, o ya no se quiere): libera el lugar de la orden para empezar una factura nueva
  // con otro número de orden. Un CFDI timbrado NUNCA se descarta (solo se cancela, F5). Primero se intenta borrar el borrador en factura.com.
  app.post('/api/facturacion/facturas/:id/descartar', h((req, res) => {
    if (!direccion(req)) return res.status(403).json({ error: 'Descartar un borrador de factura es solo de Dirección' });
    const f = facturaVisible(req, res); if (!f) return;
    if (f.estatus !== 'borrador_error' || !f.cfdi_uid) return res.status(409).json({ error: 'Solo se descarta un borrador con error (una factura timbrada nunca se descarta)' });
    if (f.entorno === 'demo' || esDemo()) return demoNo(res);
    if (f.entorno !== leerConfig(env).entorno) return res.status(409).json({ error: `Este borrador es de ${f.entorno === 'prod' ? 'producción' : 'pruebas'} y la conexión está en otro entorno` });
    return una('orden-' + f.lead_id, res, async () => {
      let nota = 'Borrador descartado por Dirección';
      try { await crearCliente().post(`/v4/drafts/${encodeURIComponent(f.cfdi_uid)}/drop`, {}); }
      catch (e) {
        // Un «no» claro de factura.com (p. ej. el borrador ya no existe) deja descartar; una falla de red o un 5xx no: no se sabe si lo borró.
        if (!(e instanceof ErrorFactura && e.codigo === 'api' && e.rechazo)) throw e;
        nota += ' (factura.com dijo: ' + String(e.message).slice(0, 150) + ')';
      }
      db.transaction(() => {
        db.prepare("UPDATE main.facturas SET estatus = 'cancelada', error_json = ?, updated_at = datetime('now','localtime') WHERE id = ? AND estatus = 'borrador_error'").run(JSON.stringify({ codigo: 'descartado', mensaje: nota }), f.id);
        db.prepare('INSERT INTO main.facturas_log (factura_id, lead_id, accion, resultado, mensaje, usuario_id) VALUES (?, ?, ?, ?, ?, ?)').run(f.id, f.lead_id, 'descartar', 'ok', nota.slice(0, 500), req.usuarioSesion?.id ?? null);
      })();
      auditar(req, 'orden_servicio', f.lead_id, 'factura', 'Descartó un borrador de factura');
      res.json({ ok: true, factura: vistaFactura(db.prepare('SELECT * FROM facturas WHERE id = ?').get(f.id)) });
    });
  }));

  // ---------- Cancelación (F5, 2026-10-29) ----------
  // Cancelan Dirección, el Gerente y quien factura (decisión de Dirección, 2026-10-29): el mismo permiso que timbrar. Nada se marca cancelado hasta que el
  // SAT lo confirma; mientras, «Cancelación en proceso» y se consulta el estatus.
  app.get('/api/facturacion/motivos-cancelacion', h((req, res) => { if (sinPermisoTimbrar(req, res)) return; res.json({ motivos: Object.entries(MOTIVOS).map(([clave, nombre]) => ({ clave, nombre, disponible: clave !== '04' })) }); }));
  app.post('/api/facturacion/facturas/:id/cancelar', h((req, res) => {
    if (sinPermisoTimbrar(req, res)) return;
    const f = facturaVisible(req, res); if (!f) return;
    const b = req.body || {};
    return una('orden-' + f.lead_id, res, async () => {
      const r = await cancelar(db, db.prepare('SELECT * FROM main.facturas WHERE id = ?').get(f.id), { motivo: String(b.motivo || ''), sustituta_id: b.sustituta_id, reintentar: b.reintentar === true }, ctxDe(req));
      if (r.estado !== 'timbrada') auditar(req, 'orden_servicio', f.lead_id, 'factura', `Pidió cancelar la factura ${f.serie || ''}-${f.folio || ''} (motivo ${b.motivo})${r.estado === 'cancelada' ? ': cancelada' : ': en proceso'}${f.entorno === 'prod' ? '' : ' (de prueba)'}`);
      res.json({ estado: r.estado, factura: vistaFactura(r.factura), mensaje: r.mensaje || null });
    });
  }));
  app.post('/api/facturacion/facturas/:id/estatus-cancelacion', h((req, res) => {
    if (sinPermisoTimbrar(req, res)) return;
    const f = facturaVisible(req, res); if (!f) return;
    if (f.estatus !== 'cancelacion_solicitada') return res.status(409).json({ error: 'Solo se consulta una factura con cancelación en proceso' });
    if (f.entorno === 'demo' || esDemo()) return demoNo(res);
    if (f.entorno !== leerConfig(env).entorno) return res.status(409).json({ error: 'Esta factura es de otro entorno: no se puede consultar ahora' });
    return una('orden-' + f.lead_id, res, async () => {
      const r = await consultarEstatus(db, crearCliente(), db.prepare('SELECT * FROM main.facturas WHERE id = ?').get(f.id), ctxDe(req));
      if (r.estado === 'cancelada') auditar(req, 'orden_servicio', f.lead_id, 'factura', `El SAT confirmó la cancelación de la factura ${f.serie || ''}-${f.folio || ''}`);
      res.json({ estado: r.estado, factura: vistaFactura(r.factura), mensaje: r.mensaje || null });
    });
  }));
  // El acuse de cancelación del SAT (XML): de la base, o se baja de factura.com si falta.
  app.get('/api/facturacion/facturas/:id/acuse', h((req, res) => {
    if (sinPermisoTimbrar(req, res)) return;
    const f = facturaVisible(req, res); if (!f) return;
    const enviar = xml => res.set('Content-Type', 'application/xml; charset=utf-8').set('Content-Disposition', `attachment; filename="${nombreArchivo(f, 'xml').replace(/^factura-/, 'acuse-cancelacion-')}"`).send(xml);
    if (f.acuse) return enviar(f.acuse);
    if (f.estatus !== 'cancelada' || f.entorno === 'demo' || esDemo()) return res.status(404).json({ error: 'Esta factura no tiene acuse de cancelación' });
    if (f.entorno !== leerConfig(env).entorno) return res.status(409).json({ error: 'El acuse no está guardado y la conexión está en otro entorno' });
    return una('acuse-' + f.id, res, async () => {
      const r = await crearCliente().get(`/v4/cfdi40/${encodeURIComponent(f.uuid)}/acuse`);
      const t = r.archivo ? r.archivo.toString('utf8') : typeof r.datos === 'string' ? r.datos : '';
      if (!esAcuse(t)) return res.status(502).json({ error: 'factura.com no entregó el acuse; intenta más tarde' });
      db.prepare("UPDATE main.facturas SET acuse = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(t, f.id);
      enviar(t);
    });
  }));
};
