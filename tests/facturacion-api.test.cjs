// Facturación CFDI 4.0 · F2 (2026-10-27): pruebas del cliente HTTP de factura.com, de los catálogos, de la sincronización de clientes y de las
// series, con una API SIMULADA escrita a partir de la documentación oficial (apidocs). IMPORTANTE: esto NO prueba la API real. Lo que la doc
// no aclaraba (búsqueda sin resultados, UID de una serie, CP con cero inicial) se confirmó a mano contra sandbox el 2026-10-27 y los casos reales
// quedaron aquí; lo de timbrar y cancelar llega con la F3.
// Uso: node --test tests/facturacion-api.test.cjs   (también corre dentro de «npm test»)
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { crearClienteFactura, ErrorFactura } = require('../server/facturacom');
const { leerConfig } = require('../server/facturacion-config');
const crearTablas = require('../server/facturacion-db');
const { itemsDe, sincronizarCatalogos, leerCatalogos } = require('../server/facturacion-catalogos');
const { sincronizarCliente, vincularCliente, payloadCliente } = require('../server/facturacion-clientes');
const { listarSeries, crearSerie, asignarSerie } = require('../server/facturacion-series');
const { validarDatosFiscales } = require('../server/facturacion-validaciones');

// ---------- Utilería ----------
const LLAVE = 'LLAVE-PRIVADA-ABCDEF-123', SECRETA = 'SECRETA-PRIVADA-XYZ-789';
const CFG = leerConfig({ FACTURA_ENV: 'sandbox', FACTURA_SANDBOX_API_KEY: LLAVE, FACTURA_SANDBOX_SECRET_KEY: SECRETA, FACTURA_SANDBOX_EMISOR_REGIMEN: '601', FACTURA_SANDBOX_EMISOR_CP: '26015' });
const json = (cuerpo, { status = 200, tipo = 'application/json' } = {}) => new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), { status, headers: { 'content-type': tipo } });
/** API simulada: «manejador(metodo, ruta, cuerpo, cabeceras)» devuelve una Response; guarda todas las llamadas. */
function api(manejador) {
  const llamadas = [];
  const fetchImpl = async (url, op = {}) => {
    const u = new URL(url), cuerpo = op.body ? JSON.parse(op.body) : undefined;
    llamadas.push({ metodo: op.method, ruta: u.pathname.replace(/^\/api/, ''), query: u.search, cuerpo, cabeceras: op.headers, url });
    return manejador(op.method, u.pathname.replace(/^\/api/, ''), cuerpo, op, u);
  };
  return { fetchImpl, llamadas };
}
const cliente = (fetchImpl, extra = {}) => crearClienteFactura({ config: CFG, fetchImpl, esperaMs: 1, ...extra });
const sinLlaves = e => !JSON.stringify({ m: e.message, d: e.detalles, c: e.codigo }).includes(LLAVE) && !JSON.stringify({ m: e.message, d: e.detalles }).includes(SECRETA);

function baseDeDatos() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE usuarios (id INTEGER PRIMARY KEY); CREATE TABLE clientes (id INTEGER PRIMARY KEY, telefono TEXT); CREATE TABLE leads (id INTEGER PRIMARY KEY);
    CREATE TABLE cobros (id INTEGER PRIMARY KEY); CREATE TABLE catalogo_servicios (id INTEGER PRIMARY KEY, nombre TEXT);
    CREATE TABLE sucursales (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, clave TEXT, activo INTEGER DEFAULT 1);
    INSERT INTO clientes (id, telefono) VALUES (1, '4421112233'); INSERT INTO sucursales (nombre, clave) VALUES ('Querétaro', 'QRO'), ('Ciudad de México', 'CDMX');`);
  crearTablas(db);
  return db;
}
const fiscal = (db, datos = {}) => {
  const d = { rfc: 'ABC010203AB1', razon_social: 'ACME', cp: '09410', regimen: '601', uso_cfdi: 'G03', correo: 'a@acme.mx', ...datos };
  return Number(db.prepare('INSERT INTO clientes_fiscales (cliente_id, rfc, razon_social, cp, regimen, uso_cfdi, correo) VALUES (1, ?, ?, ?, ?, ?, ?)').run(d.rfc, d.razon_social, d.cp, d.regimen, d.uso_cfdi, d.correo).lastInsertRowid);
};

// ---------- Cliente HTTP ----------
test('HTTP: manda las cabeceras de la doc al host del entorno y las llaves solo ahí', async () => {
  const a = api(() => json({ status: 'success', data: [] }));
  await cliente(a.fetchImpl).get('/v4/series', { page: 2 });
  const l = a.llamadas[0];
  assert.equal(l.url, 'https://sandbox.factura.com/api/v4/series?page=2');
  assert.deepEqual(l.cabeceras, { 'Content-Type': 'application/json', 'F-PLUGIN': CFG.plugin, 'F-Api-Key': LLAVE, 'F-Secret-Key': SECRETA });
  const prod = leerConfig({ FACTURA_ENV: 'prod', FACTURA_PROD_API_KEY: 'a'.repeat(8), FACTURA_PROD_SECRET_KEY: 'b'.repeat(8) });
  const b = api(() => json({ status: 'success', data: [] }));
  await crearClienteFactura({ config: prod, fetchImpl: b.fetchImpl }).get('/v4/series');
  assert.equal(b.llamadas[0].url, 'https://api.factura.com/v4/series', 'en producción no lleva /api');
});
test('HTTP: las distintas formas de éxito de la doc se entienden', async () => {
  for (const [cuerpo, esperado] of [[{ status: 'success', Data: { UID: 'u1' } }, { UID: 'u1' }], [{ status: 'success', data: [1, 2] }, [1, 2]], [{ response: 'success', data: [3] }, [3]], [{ response: 'success', message: 'ok' }, { response: 'success', message: 'ok' }], [[{ key: '601' }], [{ key: '601' }]]]) {
    const r = await cliente(api(() => json(cuerpo)).fetchImpl).get('/x'); assert.deepEqual(r.datos, esperado, JSON.stringify(cuerpo));
  }
});
test('HTTP: un error con HTTP 200 es un error; el mensaje de campos se aplana y NO se filtra el cuerpo (Data/Secret)', async () => {
  const eco = { status: 'error', message: 'La cuenta que intenta autenticarse no existe', Data: '$2y$10$ECO-DE-LA-LLAVE', Secret: '$2y$10$ECO-DEL-SECRETO' };
  await assert.rejects(() => cliente(api(() => json(eco)).fetchImpl).get('/v4/series'), e => {
    assert.ok(e instanceof ErrorFactura); assert.equal(e.codigo, 'api'); assert.equal(e.message, 'La cuenta que intenta autenticarse no existe');
    const todo = JSON.stringify(e, Object.getOwnPropertyNames(e)); assert.ok(!todo.includes('ECO-DE-LA-LLAVE') && !todo.includes('ECO-DEL-SECRETO'), 'el error no debe llevar Data ni Secret'); return true;
  });
  await assert.rejects(() => cliente(api(() => json({ status: 'error', message: { rfc: ['El campo rfc es requerido'], codpos: ['El campo codpos es requerido', 'Formato no válido'] } })).fetchImpl).post('/v1/clients/create', {}), e => {
    assert.equal(e.message, 'El campo rfc es requerido · El campo codpos es requerido · Formato no válido'); assert.deepEqual(e.detalles.map(d => d.campo), ['rfc', 'codpos', 'codpos']); return true;
  });
  await assert.rejects(() => cliente(api(() => json({ response: 'error', message: 'El cliente ya cuenta con CFDI\'s por lo que no puede ser eliminado' })).fetchImpl).post('/x'), /ya cuenta con CFDI/);
});
test('HTTP: errores de HTTP, mensajes por omisión y llaves repetidas en un mensaje', async () => {
  await assert.rejects(() => cliente(api(() => json({ message: 'Falla interna' }, { status: 500 })).fetchImpl).get('/x'), e => e.codigo === 'api' && e.httpStatus === 500 && e.message === 'Falla interna');
  await assert.rejects(() => cliente(api(() => json({}, { status: 401 })).fetchImpl).get('/x'), /no aceptó las llaves/);
  await assert.rejects(() => cliente(api(() => json({}, { status: 502 })).fetchImpl).get('/x'), /HTTP 502/);
  await assert.rejects(() => cliente(api(() => json({ status: 'error', message: `La llave ${LLAVE} y la secreta ${SECRETA} no sirven` })).fetchImpl).get('/x'), e => { assert.ok(sinLlaves(e)); assert.match(e.message, /\*\*\*/); return true; });
});
test('HTTP: GET se reintenta ante fallos de red; POST jamás', async () => {
  let n = 0; const a = api(() => { n++; if (n < 3) throw new TypeError('fetch failed'); return json({ status: 'success', data: [] }); });
  const r = await cliente(a.fetchImpl).get('/v4/series'); assert.equal(a.llamadas.length, 3); assert.deepEqual(r.datos, []);
  const b = api(() => { throw new TypeError('fetch failed'); });
  await assert.rejects(() => cliente(b.fetchImpl).get('/x'), e => e.codigo === 'red' && e.reintentable === true); assert.equal(b.llamadas.length, 3, 'GET: el intento y 2 reintentos');
  const c = api(() => { throw new TypeError('fetch failed'); });
  await assert.rejects(() => cliente(c.fetchImpl).post('/v4/cfdi40/create', { x: 1 }), e => e.codigo === 'red'); assert.equal(c.llamadas.length, 1, 'un POST nunca se repite solo (podría duplicar un timbrado)');
  const d = api(() => json({ status: 'error', message: 'No' })); await assert.rejects(() => cliente(d.fetchImpl).get('/x')); assert.equal(d.llamadas.length, 1, 'un error de la API no se reintenta');
});
test('HTTP: el tiempo se agota (conectando o leyendo) y avisa que no se sabe si la petición llegó', async () => {
  const cuelga = (_u, op) => new Promise((_, rej) => op.signal.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' }))));
  const a = api((m, r, c, op) => cuelga(null, op));
  await assert.rejects(() => cliente(a.fetchImpl, { timeoutMs: 20 }).post('/v4/cfdi40/create', {}), e => e.codigo === 'tiempo' && /antes de repetirla/.test(e.message)); assert.equal(a.llamadas.length, 1);
  const g = api((m, r, c, op) => cuelga(null, op)); await assert.rejects(() => cliente(g.fetchImpl, { timeoutMs: 20 }).get('/x'), e => e.codigo === 'tiempo'); assert.equal(g.llamadas.length, 1, 'un tiempo agotado tampoco se reintenta solo');
  const lenta = api(() => ({ status: 200, headers: new Headers({ 'content-type': 'application/json' }), arrayBuffer: () => new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('abort'), { name: 'AbortError' })), 5)) }));
  await assert.rejects(() => cliente(lenta.fetchImpl, { timeoutMs: 20 }).post('/x', {}), e => e.codigo === 'tiempo');
});
test('HTTP: archivos (PDF) llegan como Buffer; texto que no es JSON es un error claro', async () => {
  const pdf = Buffer.from('%PDF-1.4 prueba');
  const r = await cliente(api(() => new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } })).fetchImpl).get('/v4/cfdi40/x/pdf');
  assert.ok(Buffer.isBuffer(r.archivo) && r.archivo.equals(pdf) && r.datos === null && /pdf/.test(r.tipo));
  await assert.rejects(() => cliente(api(() => json('<html>mantenimiento</html>', { tipo: 'text/html' })).fetchImpl).get('/x'), e => e.codigo === 'respuesta');
  await assert.rejects(() => cliente(api(() => json('no es json')).fetchImpl).get('/x'), e => e.codigo === 'respuesta');
});
test('HTTP: sin llaves no se llama a la API', async () => {
  const a = api(() => json({ status: 'success' }));
  await assert.rejects(() => crearClienteFactura({ config: leerConfig({}), fetchImpl: a.fetchImpl }).get('/x'), e => e.codigo === 'config' && /FACTURA_SANDBOX_API_KEY/.test(e.message)); assert.equal(a.llamadas.length, 0);
});
test('HTTP: el registro de eventos no lleva llaves ni cuerpos, y si falla no rompe la llamada', async () => {
  const eventos = [], a = api(() => json({ status: 'success', data: [] }));
  await cliente(a.fetchImpl, { alEvento: e => eventos.push(e) }).post('/v1/clients/create', { rfc: 'SECRETO-DE-PRUEBA' });
  assert.equal(eventos.length, 1); assert.ok(!JSON.stringify(eventos).includes(LLAVE) && !JSON.stringify(eventos).includes('SECRETO-DE-PRUEBA'));
  await cliente(a.fetchImpl, { alEvento: () => { throw new Error('falla el registro'); } }).get('/x');
});

// ---------- Catálogos ----------
const REG = { response: 'success', data: [{ key: '601', name: 'General de Ley Personas Morales' }, { key: '612', name: 'Personas Físicas con Actividades Empresariales' }, { key: '626', name: 'Régimen Simplificado de Confianza' }] };
const USO = { response: 'success', data: [{ key: 'G03', name: 'Gastos en general', use: 'ambos', regimenes: ['601', '612', '626'] }, { key: 'D01', name: 'Honorarios médicos', use: 'fisica', regimenes: ['612'] }] };
const rutaCat = { '/v3/catalogo/RegimenFiscal': REG, '/v4/catalogo/UsoCfdi': USO, '/v3/catalogo/FormaPago': { response: 'success', data: [{ key: '01', name: 'Efectivo' }, { key: '03', name: 'Transferencia' }] },
  '/v3/catalogo/MetodoPago': { response: 'success', data: [{ key: 'PUE', name: 'Pago en una sola exhibición' }, { key: 'PPD', name: 'Pago en parcialidades' }] }, '/v3/catalogo/ClaveUnidad': { response: 'success', data: [{ key: 'E48', name: 'Unidad de servicio' }] } };
test('Catálogos: se entienden las formas de respuesta y se ignoran ítems sin clave o repetidos', () => {
  assert.deepEqual(itemsDe([{ key: 'A', name: 'a' }]).map(i => i.clave), ['A']); assert.deepEqual(itemsDe({ Data: [{ key: 'B', name: 'b' }] }).map(i => i.clave), ['B']);
  assert.deepEqual(itemsDe({ data: [{ key: 'A', name: 'x' }, { key: 'A', name: 'y' }, { name: 'sin clave' }, null, { key: ' ' }] }).map(i => i.clave), ['A']);
  assert.equal(itemsDe({ mensaje: 'otra cosa' }), null); assert.equal(itemsDe(null), null);
  assert.deepEqual(JSON.parse(itemsDe([{ key: 'G03', name: 'x', use: 'ambos', regimenes: ['601'] }])[0].extra), { use: 'ambos', regimenes: ['601'] });
});
test('Catálogos: se guardan, se actualizan, se quitan los que ya no vienen y NUNCA se borra con una respuesta vacía o mala', async () => {
  const db = baseDeDatos(); let estado = { ...rutaCat };
  const a = api((m, ruta) => (estado[ruta] ? json(estado[ruta]) : json({ status: 'error', message: 'no existe' }, { status: 404 })));
  let r = await sincronizarCatalogos(cliente(a.fetchImpl), db);
  assert.deepEqual(r.map(x => [x.catalogo, x.total]), [['RegimenFiscal', 3], ['UsoCfdi', 2], ['FormaPago', 2], ['MetodoPago', 2], ['ClaveUnidad', 1]]);
  estado = { ...rutaCat, '/v3/catalogo/RegimenFiscal': { response: 'success', data: [{ key: '601', name: 'General de Ley (nombre nuevo)' }, { key: '603', name: 'Fines no lucrativos' }] }, '/v4/catalogo/UsoCfdi': { response: 'success', data: [] }, '/v3/catalogo/FormaPago': undefined };
  r = await sincronizarCatalogos(cliente(a.fetchImpl), db);
  const claves = db.prepare("SELECT clave, nombre FROM sat_catalogos WHERE catalogo = 'RegimenFiscal' ORDER BY clave").all();
  assert.deepEqual(claves.map(c => c.clave), ['601', '603'], 'quita el 612 y el 626 que ya no vienen, agrega el 603'); assert.equal(claves[0].nombre, 'General de Ley (nombre nuevo)');
  assert.equal(r.find(x => x.catalogo === 'UsoCfdi').actualizado, false); assert.equal(db.prepare("SELECT COUNT(*) n FROM sat_catalogos WHERE catalogo = 'UsoCfdi'").get().n, 2, 'respuesta vacía: se conserva');
  const fp = r.find(x => x.catalogo === 'FormaPago'); assert.equal(fp.error, true); assert.equal(fp.total, 2, 'si un catálogo falla se conserva y los demás siguen');
  assert.equal(r.find(x => x.catalogo === 'ClaveUnidad').actualizado, true);
});
test('Catálogos: alimentan las validaciones del F1 (régimen y compatibilidad régimen–uso salen de la API, no de código)', async () => {
  const db = baseDeDatos(); const c = leerCatalogos(db); assert.equal(c.regimenes, null); assert.equal(c.usos, null);
  await sincronizarCatalogos(cliente(api((m, ruta) => json(rutaCat[ruta])).fetchImpl), db);
  const cat = leerCatalogos(db); assert.equal(cat.regimenes.get('626'), 'Régimen Simplificado de Confianza'); assert.deepEqual(cat.usos.get('D01').regimenes, ['612']); assert.equal(cat.formasPago.length, 2); assert.equal(cat.unidades[0].clave, 'E48');
  const base = { rfc: 'ABC010203AB1', razon_social: 'ACME', cp: '76087', regimen: '626', uso_cfdi: 'G03', correo: 'a@acme.mx' };
  assert.equal(validarDatosFiscales(base, cat).listo, true);
  assert.match(validarDatosFiscales({ ...base, uso_cfdi: 'D01' }, cat).errores[0], /no es compatible con el régimen 626/);
  assert.match(validarDatosFiscales({ ...base, regimen: '999' }, cat).errores[0], /no está en el catálogo/);
});

// ---------- Clientes ----------
const clienteOk = Data => ({ status: 'success', Data: { UID: 'uid-nuevo', RFC: 'ABC010203AB1', ...Data } });
test('Clientes: el cuerpo que se manda sigue la doc (CP como texto con su cero, razón social normalizada, país MEX)', () => {
  const p = payloadCliente({ rfc: 'ABC010203AB1', razon_social: 'ACME', cp: '09410', regimen: '601', uso_cfdi: 'G03', correo: 'a@acme.mx' });
  assert.deepEqual(p, { rfc: 'ABC010203AB1', razons: 'ACME', codpos: '09410', email: 'a@acme.mx', regimen: '601', pais: 'MEX', usocfdi: 'G03' }); assert.equal(typeof p.codpos, 'string');
});
test('Clientes: con datos incompletos o inválidos NO se llama a la API y se dice qué falta', async () => {
  const db = baseDeDatos(), a = api(() => json(clienteOk()));
  const incompleto = fiscal(db, { rfc: 'XYZ010203AB1', razon_social: '', correo: '', uso_cfdi: '' });
  await assert.rejects(() => sincronizarCliente(cliente(a.fetchImpl), db, incompleto), e => e.codigo === 'config' && /falta: Razón social, Correo, Uso del CFDI/.test(e.message) && /No se mandó nada/.test(e.message));
  const mal = fiscal(db, { rfc: 'QWE013203AB1' }); // 12 caracteres (la base lo acepta) pero con mes 13: lo detecta la validación
  await assert.rejects(() => sincronizarCliente(cliente(a.fetchImpl), db, mal), /fecha dentro del RFC/);
  await assert.rejects(() => sincronizarCliente(cliente(a.fetchImpl), db, 9999), /No existe ese dato fiscal/);
  assert.equal(a.llamadas.length, 0);
});
test('Clientes: un cliente nuevo se crea y se guarda su UID (la búsqueda por RFC sin resultados, como lista vacía o como error)', async () => {
  for (const sinResultados of [() => json({ status: 'success', Data: [] }), () => json({ status: 'error', message: 'No se encontraron clientes' }, { status: 404 }), () => json({ status: 'error', message: 'El cliente no existe' })]) { // el último es lo que contesta sandbox de verdad (HTTP 200)
    const db = baseDeDatos(), id = fiscal(db, { razon_social: 'Acme, S.A. de C.V.' });
    const a = api((m, ruta) => (m === 'GET' ? sinResultados() : json(clienteOk())));
    const r = await sincronizarCliente(cliente(a.fetchImpl), db, id);
    assert.deepEqual(r, { estado: 'creado', uid: 'uid-nuevo' });
    assert.deepEqual(a.llamadas.map(l => l.metodo + ' ' + l.ruta), ['GET /v1/clients/rfc/ABC010203AB1', 'POST /v1/clients/create']);
    assert.equal(a.llamadas[1].cuerpo.razons, 'ACME', 'se mandó normalizada'); assert.equal(a.llamadas[1].cuerpo.codpos, '09410');
    const f = db.prepare('SELECT * FROM clientes_fiscales WHERE id = ?').get(id); assert.equal(f.uid_facturacom, 'uid-nuevo'); assert.equal(f.razon_social, 'ACME');
  }
});
test('Clientes: si el RFC ya existe en factura.com NO se crea ni se enlaza a ciegas; se avisa con los candidatos', async () => {
  const db = baseDeDatos(), id = fiscal(db);
  const a = api((m) => (m === 'GET' ? json({ status: 'success', Data: [{ UID: 'u-a', RazonSocial: 'ACME', RFC: 'ABC010203AB1', CodigoPostal: '76087', RegimenId: '601' }, { UID: 'u-b', RazonSocial: 'ACME SUR', CodigoPostal: '09410' }] }) : json(clienteOk())));
  const r = await sincronizarCliente(cliente(a.fetchImpl), db, id);
  assert.equal(r.estado, 'existe'); assert.deepEqual(r.candidatos.map(c => c.uid), ['u-a', 'u-b']); assert.equal(r.uid, null);
  assert.equal(a.llamadas.filter(l => l.metodo === 'POST').length, 0, 'no se creó nada'); assert.equal(db.prepare('SELECT uid_facturacom FROM clientes_fiscales').get().uid_facturacom, null);
  const b = api((m) => (m === 'GET' ? json({ status: 'success', Data: [{ UID: 'u-a' }] }) : json(clienteOk())));
  assert.equal((await sincronizarCliente(cliente(b.fetchImpl), db, id, { crearAunqueExista: true })).estado, 'creado', 'si se decide a propósito, se crea otro');
});
test('Clientes: con UID guardado se ACTUALIZA ese (sin buscar por RFC)', async () => {
  const db = baseDeDatos(), id = fiscal(db, { razon_social: 'acme sa de cv' }); db.prepare("UPDATE clientes_fiscales SET uid_facturacom = 'uid-guardado' WHERE id = ?").run(id);
  const a = api(() => json(clienteOk({ UID: 'uid-guardado' })));
  assert.deepEqual(await sincronizarCliente(cliente(a.fetchImpl), db, id), { estado: 'actualizado', uid: 'uid-guardado' });
  assert.deepEqual(a.llamadas.map(l => l.metodo + ' ' + l.ruta), ['POST /v1/clients/uid-guardado/update']); assert.equal(a.llamadas[0].cuerpo.razons, 'ACME');
  assert.equal(db.prepare('SELECT razon_social FROM clientes_fiscales WHERE id = ?').get(id).razon_social, 'ACME');
});
test('Clientes: si la API rechaza un campo se muestra y no se guarda ningún UID; sin UID en la respuesta tampoco', async () => {
  const db = baseDeDatos(), id = fiscal(db);
  const a = api((m) => (m === 'GET' ? json({ status: 'success', Data: [] }) : json({ status: 'error', message: { codpos: ['El código postal no existe'] } })));
  await assert.rejects(() => sincronizarCliente(cliente(a.fetchImpl), db, id), e => e.message === 'El código postal no existe' && e.detalles[0].campo === 'codpos');
  assert.equal(db.prepare('SELECT uid_facturacom FROM clientes_fiscales').get().uid_facturacom, null);
  const b = api((m) => (m === 'GET' ? json({ status: 'success', Data: [] }) : json({ status: 'success', Data: {} })));
  await assert.rejects(() => sincronizarCliente(cliente(b.fetchImpl), db, id), e => e.codigo === 'respuesta' && /no devolvió su UID/.test(e.message));
  assert.equal(db.prepare('SELECT uid_facturacom FROM clientes_fiscales').get().uid_facturacom, null);
});
test('Clientes: vincular exige el mismo RFC y que el UID no esté en uso', async () => {
  const db = baseDeDatos(), id = fiscal(db), otro = fiscal(db, { rfc: 'GOMC800101AB1' });
  const a = api((m, ruta) => json({ status: 'success', Data: { UID: ruta.split('/').pop(), RFC: ruta.endsWith('u-ok') ? 'ABC010203AB1' : 'ZZZ010101ZZ1' } }));
  assert.deepEqual(await vincularCliente(cliente(a.fetchImpl), db, id, 'u-ok'), { estado: 'vinculado', uid: 'u-ok' }); assert.equal(db.prepare('SELECT uid_facturacom FROM clientes_fiscales WHERE id = ?').get(id).uid_facturacom, 'u-ok');
  await assert.rejects(() => vincularCliente(cliente(a.fetchImpl), db, otro, 'u-otro'), /tiene otro RFC/);
  await assert.rejects(() => vincularCliente(cliente(api(() => json({ status: 'success', Data: { UID: 'u-ok', RFC: 'GOMC800101AB1' } })).fetchImpl), db, otro, 'u-ok'), /ya está vinculado a otro/);
  await assert.rejects(() => vincularCliente(cliente(api(() => json({ status: 'success', Data: {} })).fetchImpl), db, otro, 'u-x'), e => e.codigo === 'respuesta');
});

// ---------- Series ----------
const SERIES = { status: 'success', data: [{ SerieID: 19843, SerieName: 'R', SerieType: 'factura', SerieDescription: 'Factura', SerieStatus: 'Activa' }, { SerieID: 19844, SerieName: 'P', SerieType: 'pago', SerieDescription: 'Pago', SerieStatus: 'Activa' },
  { SerieID: 19845, SerieName: 'X', SerieType: 'factura', SerieDescription: 'Vieja', SerieStatus: 'Inactiva' }] };
test('Series: se listan normalizadas', async () => {
  const s = await listarSeries(cliente(api(() => json(SERIES)).fetchImpl));
  assert.deepEqual(s.map(x => [x.id, x.nombre, x.tipo, x.activa]), [['19843', 'R', 'factura', true], ['19844', 'P', 'pago', true], ['19845', 'X', 'factura', false]]);
  await assert.rejects(() => listarSeries(cliente(api(() => json({ status: 'success', data: 'nada' })).fetchImpl)), e => e.codigo === 'respuesta');
});
test('Series: asignar exige que exista, que sea del tipo, que esté activa y que no sea de otra sucursal', async () => {
  const db = baseDeDatos(), c = cliente(api(() => json(SERIES)).fetchImpl);
  assert.deepEqual(await asignarSerie(c, db, 1, 'factura', 19843), { sucursal: 'Querétaro', tipoDocumento: 'factura', serie: 'R', serie_uid: '19843' });
  await assert.rejects(() => asignarSerie(c, db, 2, 'factura', 19843), /ya está asignada a la sucursal «Querétaro»/);
  await assert.rejects(() => asignarSerie(c, db, 2, 'factura', 19844), /es de tipo «pago», no de «factura»/);
  await assert.rejects(() => asignarSerie(c, db, 2, 'factura', 19845), /desactivada/);
  await assert.rejects(() => asignarSerie(c, db, 2, 'factura', 77), /no existe en factura\.com/);
  await assert.rejects(() => asignarSerie(c, db, 99, 'factura', 19843), /sucursal no existe/);
  await assert.rejects(() => asignarSerie(c, db, 1, 'nota', 19843), /tipo de documento/);
  assert.deepEqual(await asignarSerie(c, db, 2, 'pago', 19844), { sucursal: 'Ciudad de México', tipoDocumento: 'pago', serie: 'P', serie_uid: '19844' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM series_factura').get().n, 2);
});
test('Series: crear valida, no duplica y encuentra la serie nueva volviendo a listar (la API no devuelve su ID)', async () => {
  let creada = false;
  const a = api((m, ruta, cuerpo) => {
    if (m === 'POST') { creada = true; return json({ response: 'success', message: 'Serie creada correctamente' }); }
    return json({ status: 'success', data: [...SERIES.data, ...(creada ? [{ SerieID: 20001, SerieName: 'QR', SerieType: 'factura', SerieDescription: '', SerieStatus: 'Activa' }] : [])] });
  });
  const c = cliente(a.fetchImpl);
  for (const [datos, texto] of [[{ letra: '', tipoDocumento: 'factura' }, /1 a 10/], [{ letra: 'A B', tipoDocumento: 'factura' }, /1 a 10/], [{ letra: 'Q', tipoDocumento: 'nota' }, /tipo de documento/], [{ letra: 'Q', tipoDocumento: 'factura', folio: 0 }, /folio inicial/], [{ letra: 'r', tipoDocumento: 'factura' }, /Ya existe/]]) await assert.rejects(() => crearSerie(c, datos), texto);
  assert.equal(a.llamadas.filter(l => l.metodo === 'POST').length, 0, 'nada se mandó con datos malos o repetidos');
  const s = await crearSerie(c, { letra: 'qr', tipoDocumento: 'factura', folio: 5 });
  assert.deepEqual([s.id, s.nombre], ['20001', 'QR']); assert.deepEqual(a.llamadas.find(l => l.metodo === 'POST').cuerpo, { letra: 'QR', tipoDocumento: 'factura', folio: 5 });
  const fantasma = cliente(api((m) => (m === 'POST' ? json({ response: 'success' }) : json(SERIES))).fetchImpl);
  await assert.rejects(() => crearSerie(fantasma, { letra: 'ZZ', tipoDocumento: 'factura' }), e => e.codigo === 'respuesta');
});
