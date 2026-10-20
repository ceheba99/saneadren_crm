// SEGURIDAD DE LOS DATOS PERSONALES (nivel banco): se ataca el módulo de Personal desde dentro y desde fuera.
//  1. Cifrado en reposo: se leen los archivos crudos de la base (y su WAL), los documentos en disco, el respaldo
//     descargable y la salida del servidor buscando CLABE, RFC, CURP, NSS, salario, notas médicas y el contenido de
//     los documentos. No debe aparecer nada en claro.
//  2. Alteraciones: datos cifrados cambiados a mano, copiados de una persona a otra o de un campo a otro, y
//     documentos alterados o intercambiados: nunca se muestran (ni datos de otra persona) y la revisión los detecta.
//  3. Claves: clave equivocada (no destruye nada), cambio de clave con la anterior, clave en archivo vs variable,
//     clave inválida (el servidor no arranca) y datos en claro de versiones anteriores (se cifran sin dejar restos).
//  4. Quién ve qué: cada rol recorre todas las rutas de consulta; solo quien tiene «Datos sensibles» y solo en la
//     ficha de una persona de su sucursal ve los datos. Ni la lista, ni la bitácora, ni el buscador los muestran.
//  5. Ataques a la API: sin sesión, sesión cerrada o desactivada, permisos quitados en caliente, «ver como», otra
//     sucursal por número, inyección SQL, archivos disfrazados, nombres con rutas o saltos de línea, encabezados.
// Uso: node tests/simulacion-seguridad-personal.cjs
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const RAIZ = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-seguridad-')), DB = path.join(dir, 'seg.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Seguridad-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE_USUARIOS = 'Clave-Seguridad-' + crypto.randomBytes(4).toString('hex') + '7';
let K2actual = null;
const K1 = crypto.randomBytes(32).toString('hex'), K2 = crypto.randomBytes(32).toString('base64'), K3 = 'una frase larga de prueba para la clave ' + crypto.randomBytes(6).toString('hex');
let srv = null, URLB = '', salida = '', todaSalida = '';

const entornoBase = () => { const e = { ...process.env }; delete e.CLAVE_CIFRADO; delete e.CLAVE_CIFRADO_ANTERIOR; return e; };
// Arranca el servidor con la misma base y las variables indicadas. Devuelve { ok, codigo }.
async function arrancar(extra = {}) {
  const puerto = String(9500 + Math.floor(Math.random() * 400));
  URLB = 'http://localhost:' + puerto;
  salida = '';
  srv = spawn(process.execPath, [path.join(RAIZ, 'server', 'index.js')], { env: { ...entornoBase(), MODO_DEMO: '', PORT: puerto, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', ...extra } });
  srv.stdout.on('data', d => { salida += d; todaSalida += d; }); srv.stderr.on('data', d => { salida += d; todaSalida += d; });
  let codigo = null; srv.on('exit', c => { codigo = c; });
  for (let i = 0; i < 160 && !/corriendo/.test(salida) && codigo === null; i++) await espera(100);
  return { ok: /corriendo/.test(salida) && codigo === null, codigo };
}
async function parar() {
  if (!srv || srv.exitCode !== null) return;
  const fin = new Promise(r => srv.once('exit', r)); srv.kill(); await fin; srv = null;
}
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b, extra = {}) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : JSON.stringify(b) });
  const buf = Buffer.from(await x.arrayBuffer()), texto = buf.toString('utf8'); let j = {}; try { j = JSON.parse(texto); } catch { /* archivo */ }
  return [x.status, j, texto, x.headers, buf];
};
const subir = async (r, t, buf, enc) => { const hh = { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + t }; for (const [k, v] of Object.entries(enc)) hh[k] = encodeURIComponent(String(v)); const x = await fetch(URLB + '/api' + r, { method: 'POST', headers: hh, body: buf }); return [x.status, await x.json().catch(() => ({}))]; };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const dia = k => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };

// Datos secretos (únicos en esta corrida, para poder buscarlos byte por byte).
const conDigito = p17 => { const w = [3, 7, 1]; let s = 0; for (let i = 0; i < 17; i++) s += (Number(p17[i]) * w[i % 3]) % 10; return p17 + ((10 - (s % 10)) % 10); };
const digitos = k => Array.from({ length: k }, () => crypto.randomInt(10)).join('');
const L = () => String.fromCharCode(65 + crypto.randomInt(26));
const fechaRfc = () => '8' + crypto.randomInt(10) + '0' + (1 + crypto.randomInt(9)) + '1' + crypto.randomInt(10);
const rfc = () => 'S' + L() + L() + L() + fechaRfc() + L() + crypto.randomInt(10) + L();
const curp = () => 'S' + L() + L() + L() + fechaRfc() + 'H' + 'QT' + L() + L() + L() + '0' + crypto.randomInt(10);
const A1 = { clabe: conDigito('0721800' + digitos(10)), rfc: rfc(), curp: curp(), nss: '9' + digitos(10), salario: 87000 + crypto.randomInt(900) + 0.37 };
const A2 = { rfc: rfc(), curp: curp(), nss: '8' + digitos(10), salario: 41000 + crypto.randomInt(900) + 0.73 };
const B1 = { clabe: conDigito('0121800' + digitos(10)), rfc: rfc(), curp: curp(), nss: '7' + digitos(10), salario: 23000 + crypto.randomInt(900) + 0.19 };
const LEGADO = { clabe: conDigito('0141800' + digitos(10)), rfc: rfc(), curp: curp(), nss: '6' + digitos(10), rfcViejo: rfc() };
const MARCA_DOC = 'DOCUMENTO-SECRETO-INE-' + crypto.randomBytes(8).toString('hex');
const MARCA_DOC_LEGADO = 'DOCUMENTO-LEGADO-' + crypto.randomBytes(8).toString('hex');
const MARCA_SALUD = 'Diagnostico hernia discal ' + crypto.randomBytes(4).toString('hex');
const centavos = v => String(Math.round(v * 100));
const SECRETOS = [A1, A2, B1].flatMap(x => [x.clabe, x.rfc, x.curp, x.nss, x.salario && String(x.salario), x.salario && centavos(x.salario)].filter(Boolean)).concat([MARCA_DOC, MARCA_SALUD]);
const SECRETOS_LEGADO = [LEGADO.clabe, LEGADO.rfc, LEGADO.curp, LEGADO.nss, LEGADO.rfcViejo, MARCA_DOC_LEGADO];
const encontrados = (texto, lista = SECRETOS) => lista.filter(x => texto.includes(x));
// Todos los archivos bajo la carpeta de la base (base, WAL, documentos, respaldos, clave).
const archivosDe = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? archivosDe(path.join(d, e.name)) : [path.join(d, e.name)]);
const escanearDisco = (lista = SECRETOS) => archivosDe(dir).flatMap(f => { let b; try { b = fs.readFileSync(f); } catch { return []; } const t = b.toString('latin1'); return lista.filter(x => t.includes(x)).map(x => path.relative(dir, f) + ': ' + x.slice(0, 10) + '…'); });
const conBase = fn => { const d = new DatabaseSync(DB); try { d.exec('PRAGMA busy_timeout = 5000'); return fn(d); } finally { d.close(); } };

(async () => {
  let s, j, texto, hdr, buf;
  let r = await arrancar({ CLAVE_CIFRADO: K1 });
  if (!r.ok) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = (await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }))[1].token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  [, j] = await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' }); const cdmx = j;
  const rol = async (nombre, permisos, alcances = {}) => { const [, x] = await pedir('POST', '/roles', A, { nombre }); const [st, y] = await pedir('PUT', '/roles/' + x.clave + '/permisos', A, { permisos, alcances }); if (st !== 200) throw new Error(nombre + ': ' + JSON.stringify(y)); return x.clave; };
  const SUP = await rol('Supervisor de campo', ['personal.ver', 'personal.editar'], { ventas: 2 });
  const CONS = await rol('Consulta de personal', ['personal.ver']);
  const RH = await rol('Recursos humanos', ['personal.ver', 'personal.editar', 'personal.sensibles']);
  const T = {}, ID = {};
  for (const [nombre, r2, suc] of [['Monica Gerente', 'gerente', qro.id], ['Sergio Supervisor', SUP, qro.id], ['Carla Consulta', CONS, qro.id], ['Rita Humanos', RH, qro.id], ['Laura Ventas', 'ventas', qro.id],
    ['Raul Tecnico', 'tecnico', qro.id], ['Celia Costos', 'costos', qro.id], ['Ana Atencion', 'atencion', qro.id], ['Gerardo Cdmx', 'gerente', cdmx.id], ['Tomas Temporal', RH, qro.id]]) {
    [s, j] = await pedir('POST', '/usuarios', A, { nombre, password: CLAVE_USUARIOS, rol: r2, sucursales: [suc] }); if (s !== 201) throw new Error(nombre + ': ' + JSON.stringify(j));
    const k = nombre.split(' ')[0]; ID[k] = j.id; T[k] = (await pedir('POST', '/login', null, { nombre, password: CLAVE_USUARIOS }))[1].token;
  }
  const { Monica: M, Sergio: S, Carla: CC, Rita: RHt, Laura: LV, Raul: TEC, Celia: CO, Ana: AT, Gerardo: G, Tomas: TT } = T;

  console.log('1. Cifrado en reposo');
  [s, j] = await pedir('POST', '/personal', M, { nombre: 'Alberto Secreto Uno', puesto: 'Técnico', usuario_id: ID.Raul, fecha_ingreso: dia(-800), banco: 'BBVA', clabe: A1.clabe, rfc: A1.rfc, curp: A1.curp, nss: A1.nss, salario: A1.salario, salario_periodo: 'mensual', tipo_contrato: 'Indeterminado' });
  const pA = j; revisa(s === 201 && j.clabe === A1.clabe && j.rfc === A1.rfc && j.salario === A1.salario, 'la gerente da de alta a Alberto con todos sus datos sensibles (y los ve)', [s, j]);
  [s, j] = await pedir('POST', '/personal', M, { nombre: 'Beatriz Secreta Dos', puesto: 'Operador', fecha_ingreso: dia(-400), clabe: B1.clabe, rfc: B1.rfc, curp: B1.curp, nss: B1.nss, salario: B1.salario });
  const pB = j; revisa(s === 201, 'y a Beatriz');
  [s, j] = await pedir('POST', '/personal', G, { nombre: 'Octavio Capital', puesto: 'Operador', fecha_ingreso: dia(-300), clabe: B1.clabe }); const pO = j;
  revisa(s === 201 && j.sucursal_id === cdmx.id, 'el gerente de CDMX da de alta a Octavio (misma CLABE que Beatriz, a propósito)');
  [s, j] = await pedir('PUT', '/personal/' + pA.id, M, { rfc: A2.rfc, curp: A2.curp, nss: A2.nss, salario: A2.salario, banco: 'Santander', version: pA.version });
  revisa(s === 200 && j.rfc === A2.rfc && j.nss === A2.nss, 'la gerente cambia RFC, CURP, NSS, salario y banco de Alberto', j);
  const pdf = Buffer.from('%PDF-1.4\n% ' + MARCA_DOC + '\n1 0 obj << >> endobj\n%%EOF');
  [s, j] = await subir('/personal/' + pA.id + '/documentos', M, pdf, { 'X-Tipo': 'ine', 'X-Nombre': 'INE Alberto.pdf' }); const docA = j.id;
  revisa(s === 201, 'sube la INE de Alberto', j);
  const pdfB = Buffer.from('%PDF-1.4\n% CURP de Beatriz ' + crypto.randomBytes(8).toString('hex') + '\n%%EOF');
  [s, j] = await subir('/personal/' + pB.id + '/documentos', M, pdfB, { 'X-Tipo': 'curp', 'X-Nombre': 'CURP Beatriz.pdf' }); const docB = j.id;
  [s, j] = await pedir('POST', '/personal/' + pB.id + '/incidencias', M, { tipo: 'incapacidad', fecha_inicio: dia(-10), fecha_fin: dia(-8), con_goce: false, notas: MARCA_SALUD });
  revisa(s === 201, 'registra una incapacidad de Beatriz con su diagnóstico en las notas');

  const fila = id => conBase(d => d.prepare('SELECT clabe, rfc, curp, nss, salario_cent FROM personal WHERE id = ?').get(id));
  const fA = fila(pA.id), fB = fila(pB.id), fO = fila(pO.id);
  revisa(['clabe', 'rfc', 'curp', 'nss', 'salario_cent'].every(k => typeof fA[k] === 'string' && fA[k].startsWith('enc1:')), 'en la base, CLABE, RFC, CURP, NSS y salario de Alberto están cifrados (enc1:…)', fA);
  revisa(typeof fB.salario_cent === 'string' && !/^\d+$/.test(fB.salario_cent), 'el salario ya no se guarda como número legible');
  revisa(fB.clabe !== fO.clabe, 'la misma CLABE en dos personas queda cifrada distinta (no se puede saber que es la misma)');
  revisa(conBase(d => d.prepare('SELECT COUNT(*) n FROM personal WHERE clabe = ? OR rfc = ? OR curp = ? OR nss = ?').get(A1.clabe, A2.rfc, A2.curp, A2.nss).n) === 0, 'buscar en la base por CLABE, RFC, CURP o NSS en claro no encuentra nada');
  const doc = conBase(d => d.prepare('SELECT * FROM documentos_personal WHERE id = ?').get(docA));
  const rutaDoc = path.join(dir, 'archivos', 'personal', doc.archivo), crudo = fs.readFileSync(rutaDoc);
  revisa(crudo.subarray(0, 4).toString() === 'SNC1' && !crudo.toString('latin1').includes(MARCA_DOC) && !crudo.toString('latin1').includes('%PDF'), 'el documento en disco está cifrado (ni la marca de PDF se ve)');
  revisa(!/INE|Alberto|[0-9a-f]{64}/.test(doc.archivo) && /\.cifrado$/.test(doc.archivo), 'el nombre del archivo en disco no dice de quién es ni qué es', doc.archivo);
  revisa(/^h1:[0-9a-f]{64}$/.test(doc.sha256) && doc.sha256.slice(3) !== crypto.createHash('sha256').update(pdf).digest('hex'), 'la huella guardada es con clave (no es el SHA-256 del documento, que se podría comparar)');
  [s, , , hdr, buf] = await pedir('GET', '/personal/documentos/' + docA, M);
  revisa(s === 200 && buf.equals(pdf), 'la gerente descarga la INE y llega idéntica a la original');
  revisa(/^attachment/.test(hdr.get('content-disposition') || '') && hdr.get('x-content-type-options') === 'nosniff' && /no-store/.test(hdr.get('cache-control') || ''), 'la descarga va como adjunto, sin «adivinar» el tipo y sin guardarse en caché', Object.fromEntries(hdr));
  conBase(d => d.exec('PRAGMA wal_checkpoint(PASSIVE)'));
  let fugas = escanearDisco();
  revisa(!fugas.length, 'escaneo byte por byte de la base, su WAL y los archivos: ningún dato sensible en claro', fugas);
  [s, , , , buf] = await pedir('GET', '/admin/backup', A);
  revisa(s === 200 && buf.length > 1000 && !encontrados(buf.toString('latin1')).length && buf.toString('latin1').includes('enc1:'), 'el respaldo descargable trae los datos, pero cifrados', encontrados(buf.toString('latin1')));
  const bitacora = conBase(d => d.prepare("SELECT detalle FROM auditoria WHERE entidad = 'personal'").all().map(x => x.detalle).join('\n'));
  revisa(!encontrados(bitacora).length && /rfc \(cambió\)/.test(bitacora) && /salario \(cambió\)/.test(bitacora) && /banco \(cambió\)/.test(bitacora), 'la bitácora dice qué cambió pero no guarda RFC, CURP, NSS, salario ni banco', bitacora.slice(0, 400));
  revisa(bitacora.includes('•••• •••• ' + A1.clabe.slice(-4)) && !bitacora.includes(A1.clabe), 'de la CLABE solo quedan los últimos 4 dígitos');

  console.log('2. Quién ve qué (todas las rutas de consulta, cada rol)');
  const RUTAS = ['/personal', '/personal?estado=todos', '/personal?alertas=1', '/personal/para-asignar', '/personal/catalogos', '/personal/usuarios/sin-ficha',
    ...[pA, pB, pO].flatMap(p => ['/personal/' + p.id, '/auditoria?entidad=personal&id=' + p.id]), '/auditoria', '/auditoria?entidad=personal',
    '/usuarios', '/leads', '/clientes', '/kpis', '/alertas', '/tablero', '/finanzas/resumen', '/finanzas/cxp', '/finanzas/proveedores', '/compras/ordenes', '/compras/solicitudes', '/calendario', '/admin/integridad', '/permisos/mios',
    ...[A1.rfc, A2.rfc, A1.clabe, A2.nss, A2.curp].flatMap(x => ['/buscar?q=' + encodeURIComponent(x), '/personal?q=' + encodeURIComponent(x)])];
  // El buscador repite lo que se buscó (campo q): eso lo escribió quien busca, no es una fuga; se revisan los resultados.
  const sinEco = (ruta, [, j, texto]) => (ruta.startsWith('/buscar') && j && typeof j === 'object' && !Array.isArray(j) ? JSON.stringify({ ...j, q: undefined }) : texto);
  for (const [quien, t] of [['supervisor (ve y edita, sin datos sensibles)', S], ['consulta (solo ve)', CC], ['ventas', LV], ['técnico', TEC], ['costos', CO], ['atención', AT], ['gerente de otra sucursal (sin la ficha de su propio Octavio)', G]]) {
    let todo = ''; for (const ruta of RUTAS.filter(x => !(t === G && x === '/personal/' + pO.id))) todo += sinEco(ruta, await pedir('GET', ruta, t)) + '\n';
    revisa(!encontrados(todo).length && !todo.includes('enc1:'), `${quien}: ningún dato sensible ni texto cifrado en ninguna respuesta`, encontrados(todo));
  }
  // Quien sí tiene permiso: solo en la ficha de cada persona (no en listas, bitácora ni buscador).
  for (const [quien, t] of [['Dirección', A], ['gerente', M], ['Recursos humanos', RHt]]) {
    let fuera = ''; for (const ruta of RUTAS.filter(x => !/^\/personal\/\d+$/.test(x))) fuera += sinEco(ruta, await pedir('GET', ruta, t)) + '\n';
    revisa(!encontrados(fuera).length && !fuera.includes('enc1:'), `${quien}: fuera de la ficha (lista, bitácora, buscador, respaldos de pantalla) no aparecen`, encontrados(fuera));
  }
  [s, j] = await pedir('GET', '/personal/' + pA.id, RHt); revisa(s === 200 && j.clabe === A1.clabe && j.rfc === A2.rfc && j.curp === A2.curp && j.salario === A2.salario, 'Recursos humanos sí los ve en la ficha de Alberto');
  [s, j] = await pedir('GET', '/personal/' + pB.id, S); const notaInc = j.incidencias?.find(i => i.tipo === 'incapacidad');
  revisa(s === 200 && notaInc && notaInc.notas === null && notaInc.notas_ocultas, 'el supervisor ve la incapacidad de Beatriz pero no el diagnóstico', notaInc);
  [s, j] = await pedir('GET', '/personal/' + pB.id, M); revisa(j.incidencias?.some(i => i.notas === MARCA_SALUD), 'la gerente (datos sensibles) sí ve el diagnóstico');
  for (const q of [A1.rfc, A2.rfc, A1.clabe, A2.nss, A1.clabe.slice(-4)]) { [s, j] = await pedir('GET', '/personal?estado=todos&q=' + encodeURIComponent(q), A); revisa(s === 200 && j.length === 0, `buscar personal por un dato sensible (${q.length} caracteres) no confirma nada`, j.map?.(p => p.nombre)); }
  const consultas = conBase(d => d.prepare("SELECT usuario, detalle FROM auditoria WHERE entidad = 'personal' AND accion = 'consulta'").all());
  revisa(consultas.some(c => c.usuario === 'Rita Humanos' && /vio sus datos sensibles/.test(c.detalle)) && consultas.some(c => /descargó INE/.test(c.detalle)), 'la bitácora registra quién vio datos sensibles y quién descargó documentos', consultas);
  revisa(!consultas.some(c => c.usuario === 'Sergio Supervisor'), 'quien no ve datos sensibles no queda como «consulta» (no los vio)');

  console.log('3. Intentos de cambiar o sacar datos sin permiso');
  [s] = await pedir('PUT', '/personal/' + pA.id, S, { clabe: B1.clabe }); revisa(s === 403, 'el supervisor no cambia la CLABE');
  [s] = await pedir('PUT', '/personal/' + pA.id, S, { salario_cent: 1 }); const fA2 = fila(pA.id); revisa(fA2.salario_cent === fila(pA.id).salario_cent && (await pedir('GET', '/personal/' + pA.id, M))[1].salario === A2.salario, 'ni mete «salario_cent» directo (se ignora)', s);
  [s, j] = await pedir('PUT', '/personal/' + pA.id, S, { clabe: '', rfc: '', nss: null, telefono: '442 000 1111', version: (await pedir('GET', '/personal/' + pA.id, S))[1].version });
  [, j] = await pedir('GET', '/personal/' + pA.id, M); revisa(j.clabe === A1.clabe && j.rfc === A2.rfc && j.nss === A2.nss, 'mandar CLABE, RFC o NSS vacíos sin permiso no los borra', [s, j.clabe, j.rfc]);
  for (const [quien, t] of [['supervisor', S], ['consulta', CC], ['ventas', LV]]) {
    [s] = await pedir('GET', '/personal/documentos/' + docA, t); revisa(s === 403, `${quien} no descarga documentos (${s})`);
    [s] = await subir('/personal/' + pA.id + '/documentos', t, Buffer.from('%PDF-1.4\n%%EOF'), { 'X-Tipo': 'ine', 'X-Nombre': 'x.pdf' }); revisa(s === 403, `${quien} no sube documentos (${s})`);
    [s] = await pedir('POST', '/personal/documentos/' + docA + '/quitar', t, {}); revisa(s === 403, `${quien} no quita documentos (${s})`);
  }
  for (const [m, ruta, b] of [['PUT', '/personal/' + pA.id, { telefono: '1' }], ['POST', '/personal/' + pA.id + '/incidencias', { tipo: 'falta', fecha_inicio: HOY }], ['POST', '/personal/' + pA.id + '/baja', { motivo: 'prueba de ataque' }], ['POST', '/personal', { nombre: 'Intruso Total', puesto: 'Otro' }]]) {
    [s] = await pedir(m, ruta, CC, b); revisa(s === 403, `«solo ver» no puede ${m} ${ruta.replace(/\d+/, ':id')} (${s})`);
  }
  // Otra sucursal por número: todo «no existe».
  for (const [m, ruta, b] of [['GET', '/personal/' + pA.id], ['PUT', '/personal/' + pA.id, { telefono: '1' }], ['POST', '/personal/' + pA.id + '/baja', { motivo: 'ataque ataque' }], ['POST', '/personal/' + pA.id + '/incidencias', { tipo: 'falta', fecha_inicio: HOY }],
    ['GET', '/personal/documentos/' + docA], ['POST', '/personal/documentos/' + docA + '/quitar', {}], ['GET', '/auditoria?entidad=personal&id=' + pA.id]]) {
    [s, j] = await pedir(m, ruta, G, b); revisa(s === 404 || (m === 'GET' && /auditoria/.test(ruta) && Array.isArray(j) && !j.length), `el gerente de CDMX: ${m} ${ruta.replace(/\d+/, ':id')} de Querétaro no existe (${s})`);
  }
  [s] = await subir('/personal/' + pA.id + '/documentos', G, Buffer.from('%PDF-1.4\n%%EOF'), { 'X-Tipo': 'ine', 'X-Nombre': 'x.pdf' }); revisa(s === 404, 'ni le sube documentos');
  [s, j] = await pedir('PUT', '/leads/999999', LV, { equipo_personal: [{ personal_id: pO.id, papel: 'responsable' }] }); revisa(s >= 400 && s < 500, 'nadie arma un equipo con gente de otra sucursal');

  console.log('4. Sesiones y permisos en caliente');
  for (const [m, ruta] of [['GET', '/personal'], ['GET', '/personal/' + pA.id], ['GET', '/personal/documentos/' + docA], ['GET', '/personal/para-asignar'], ['POST', '/personal'], ['PUT', '/personal/' + pA.id], ['GET', '/auditoria?entidad=personal&id=' + pA.id]]) {
    for (const [como, t] of [['sin sesión', null], ['con un token inventado', crypto.randomBytes(32).toString('hex')]]) { [s, , texto] = await pedir(m, ruta, t, m === 'GET' ? undefined : {}); revisa(s === 401 && !encontrados(texto).length, `${como}: ${m} ${ruta.replace(/\d+/, ':id')} → 401`, s); }
  }
  [s, j] = await pedir('GET', '/personal/' + pA.id, TT); revisa(s === 200 && j.clabe === A1.clabe, 'Tomás (Recursos humanos) ve la CLABE…');
  [s] = await pedir('DELETE', '/usuarios/' + ID.Tomas, A); [s, , texto] = await pedir('GET', '/personal/' + pA.id, TT); revisa(s === 401 && !encontrados(texto).length, '…lo desactivan y su sesión deja de servir al instante', s);
  [s] = await pedir('PUT', '/roles/' + RH + '/permisos', A, { permisos: ['personal.ver', 'personal.editar'], alcances: {} }); revisa(s === 200, 'Dirección le quita «Datos sensibles» al rol de Recursos humanos');
  [s, j, texto] = await pedir('GET', '/personal/' + pA.id, RHt); revisa(s === 200 && !encontrados(texto).length && !('clabe' in j), 'Rita deja de verlos en la siguiente petición (sin cerrar sesión)', encontrados(texto));
  [s] = await pedir('GET', '/personal/documentos/' + docA, RHt); revisa(s === 403, 'ni descarga documentos');
  await pedir('PUT', '/roles/' + RH + '/permisos', A, { permisos: ['personal.ver', 'personal.editar', 'personal.sensibles'], alcances: {} });
  [s, j, texto] = await pedir('GET', '/personal/' + pA.id, A, undefined, { 'X-Ver-Como': CONS }); revisa(s === 200 && !encontrados(texto).length, 'Dirección «viendo como» Consulta tampoco ve los datos sensibles', encontrados(texto));
  [s] = await pedir('PUT', '/personal/' + pA.id, A, { telefono: '1' }, { 'X-Ver-Como': CONS }); revisa(s === 403, 'y en esa vista no puede cambiar nada');
  [s] = await pedir('GET', '/personal/' + pA.id, M, undefined, { 'X-Ver-Como': 'ventas' }); revisa(s === 403, 'nadie más que Dirección usa «ver como» (la gerente lo intenta)', s);
  [s] = await pedir('POST', '/logout', M, {}); [s, , texto] = await pedir('GET', '/personal/' + pA.id, M); revisa(s === 401 && !encontrados(texto).length, 'al cerrar sesión el token ya no sirve');
  const M2 = (await pedir('POST', '/login', null, { nombre: 'Monica Gerente', password: CLAVE_USUARIOS }))[1].token;

  console.log('5. Inyección, archivos disfrazados y encabezados');
  for (const q of ["' OR '1'='1", "x' UNION SELECT clabe, rfc, curp, nss FROM personal --", '%', '_', "\\' OR 1=1 --", '"; DROP TABLE personal; --']) {
    [s, j, texto] = await pedir('GET', '/personal?estado=todos&q=' + encodeURIComponent(q), CC); revisa(s === 200 && Array.isArray(j) && j.length === 0 && !encontrados(texto).length, `búsqueda con inyección «${q.slice(0, 24)}»: nada`, j.length);
  }
  [s, j] = await pedir('GET', "/personal?puesto=' OR 1=1 --", CC); revisa(s === 200 && j.length === 0, 'filtro de puesto con inyección: nada');
  for (const id of ['1 OR 1=1', '-1', '0x1', '1;DROP TABLE personal', '../' + pA.id, '%00', '9e999']) {
    [s, , texto] = await pedir('GET', '/personal/' + encodeURIComponent(id), CC); revisa((s === 404 || s === 400) && !encontrados(texto).length, `número de persona raro «${id}» → ${s}`);
  }
  revisa(conBase(d => d.prepare('SELECT COUNT(*) n FROM personal').get().n) === 3, 'la tabla de personal sigue intacta');
  for (const [b, nombre, que] of [[Buffer.from('<html><script>alert(1)</script></html>'), 'ine.pdf', 'HTML disfrazado de PDF'], [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'foto.png', 'SVG con código'],
    [Buffer.from('MZ\x90\x00 ejecutable'), 'nomina.pdf', 'ejecutable'], [Buffer.alloc(10 * 1024 * 1024 + 10, 0x25), 'grande.pdf', 'más de 10 MB']]) {
    [s] = await subir('/personal/' + pA.id + '/documentos', M2, b, { 'X-Tipo': 'otro', 'X-Nombre': nombre }); revisa(s === 400 || s === 413, `se rechaza: ${que} (${s})`);
  }
  [s, j] = await subir('/personal/' + pA.id + '/documentos', M2, Buffer.from('%PDF-1.4\n% ruta\n%%EOF'), { 'X-Tipo': 'otro', 'X-Nombre': '../../../server/index.js' }); const docRuta = j.id;
  revisa(s === 201 && archivosDe(path.join(dir, 'archivos', 'personal')).every(f => path.dirname(path.dirname(f)) === path.join(dir, 'archivos', 'personal')), 'un nombre con «../» no saca el archivo de su carpeta', archivosDe(path.join(dir, 'archivos')).map(f => path.relative(dir, f)));
  [s, j] = await subir('/personal/' + pA.id + '/documentos', M2, Buffer.from('%PDF-1.4\n% cabecera\n%%EOF'), { 'X-Tipo': 'otro', 'X-Nombre': 'a"\r\nSet-Cookie: robo=1\r\nX: "b.pdf' });
  [s, , , hdr] = await pedir('GET', '/personal/documentos/' + j.id, M2); revisa(s === 200 && !hdr.get('set-cookie') && !hdr.get('x'), 'un nombre con saltos de línea no mete encabezados en la descarga', Object.fromEntries(hdr));
  [s, , , hdr] = await pedir('GET', '/personal/' + pA.id, M2);
  revisa(/no-store/.test(hdr.get('cache-control') || '') && hdr.get('x-frame-options') === 'DENY' && hdr.get('x-content-type-options') === 'nosniff' && /default-src 'self'/.test(hdr.get('content-security-policy') || '') && !hdr.get('x-powered-by'),
    'las respuestas con datos personales: sin caché, sin incrustarse en otra página, con política de contenido y sin delatar el servidor', Object.fromEntries(hdr));
  for (const ruta of ['/clave-cifrado.key', '/seg.db', '/../seg.db', '/%2e%2e/server/index.js', '/archivos/personal/' + doc.archivo.replace(/\\/g, '/'), '/.env', '/.git/config']) {
    const x = await fetch(URLB + ruta); const t = await x.text(); revisa(x.status >= 400 || (x.status === 200 && /<html/i.test(t) && !t.includes('enc1:') && !t.includes('SNC1')), `el sitio no entrega «${ruta}» (${x.status})`);
  }

  console.log('6. Datos alterados en la base y documentos intercambiados');
  const escribir = (sql, ...p) => conBase(d => d.prepare(sql).run(...p));
  const original = fila(pA.id), originalB = fila(pB.id);
  const voltear = c => { const i = c.length - 3; return c.slice(0, i) + (c[i] === 'A' ? 'B' : 'A') + c.slice(i + 1); };
  escribir('UPDATE personal SET clabe = ? WHERE id = ?', voltear(original.clabe), pA.id);
  [s, j, texto] = await pedir('GET', '/personal/' + pA.id, M2);
  revisa(s === 200 && j.clabe === null && j.datos_ilegibles?.includes('clabe') && j.alertas.some(a => /no se pueden leer/.test(a)) && !texto.includes('enc1:'), 'una CLABE alterada a mano: no se muestra (ni basura), se avisa, y el resto de la ficha sí carga', [s, j.clabe, j.datos_ilegibles]);
  escribir('UPDATE personal SET clabe = ? WHERE id = ?', original.clabe, pB.id);
  [s, j, texto] = await pedir('GET', '/personal/' + pB.id, M2);
  revisa(j.clabe === null && !texto.includes(A1.clabe), 'copiar la CLABE cifrada de Alberto a Beatriz (para desviar su pago) no funciona: queda ilegible', j.clabe);
  escribir('UPDATE personal SET rfc = ? WHERE id = ?', original.curp, pA.id);
  [, j, texto] = await pedir('GET', '/personal/' + pA.id, M2); revisa(j.rfc === null && j.datos_ilegibles?.includes('rfc') && j.curp === A2.curp, 'mover la CURP cifrada a la columna del RFC tampoco: el RFC queda ilegible (no aparece la CURP en su lugar)', [j.rfc, j.datos_ilegibles]);
  escribir('UPDATE personal SET nss = ? WHERE id = ?', LEGADO.nss, pA.id);
  [, j, texto] = await pedir('GET', '/personal/' + pA.id, M2); revisa(j.nss === null && j.datos_ilegibles?.includes('nss') && !texto.includes(LEGADO.nss), 'un NSS escrito en claro directo en la base no se muestra como si fuera válido');
  [s, j] = await pedir('GET', '/admin/integridad', A);
  const seg = t => j.resultados?.find(x => x.titulo.startsWith(t));
  revisa(seg('Datos cifrados que no se pueden leer')?.total >= 3 && seg('Datos sensibles del personal guardados sin cifrar')?.total >= 1, 'la revisión de integridad detecta los datos alterados y el que está en claro', j.resultados?.filter(x => x.grupo === 'Seguridad'));
  revisa(!encontrados(JSON.stringify(j)).length, 'y su reporte tampoco muestra datos sensibles');
  escribir('UPDATE personal SET clabe = ?, rfc = ?, nss = ? WHERE id = ?', original.clabe, original.rfc, original.nss, pA.id);
  escribir('UPDATE personal SET clabe = ? WHERE id = ?', originalB.clabe, pB.id);
  [, j] = await pedir('GET', '/personal/' + pA.id, M2); revisa(j.clabe === A1.clabe && j.rfc === A2.rfc && !j.datos_ilegibles, 'al dejar los valores como estaban, todo vuelve a leerse');
  const docBfila = conBase(d => d.prepare('SELECT archivo FROM documentos_personal WHERE id = ?').get(docB)), rutaB = path.join(dir, 'archivos', 'personal', docBfila.archivo);
  const crudoB = fs.readFileSync(rutaB);
  const alterado = Buffer.from(crudo); alterado[alterado.length - 5] ^= 1; fs.writeFileSync(rutaDoc, alterado);
  [s, , texto] = await pedir('GET', '/personal/documentos/' + docA, M2); revisa(s === 409 && !texto.includes(MARCA_DOC), 'un documento alterado en disco no se entrega (ni a medias)', s);
  fs.writeFileSync(rutaDoc, crudoB);
  [s, , texto] = await pedir('GET', '/personal/documentos/' + docA, M2); revisa(s === 409 && !texto.includes('CURP de Beatriz'), 'cambiar el archivo de Alberto por el de Beatriz tampoco: no se entrega el de otra persona', s);
  fs.writeFileSync(rutaDoc, crudo);
  [s, , , , buf] = await pedir('GET', '/personal/documentos/' + docA, M2); revisa(s === 200 && buf.equals(pdf), 'con el archivo original, se descarga bien');

  console.log('7. Claves: equivocada, cambio de clave, archivo y variable, inválida');
  const antes = fila(pA.id), archivoAntes = fs.readFileSync(rutaDoc);
  await parar(); r = await arrancar({ CLAVE_CIFRADO: K2 });
  revisa(r.ok, 'con otra clave (equivocada) el servidor arranca');
  [s, j, texto] = await pedir('GET', '/personal/' + pA.id, M2);
  revisa(s === 200 && j.clabe === null && j.rfc === null && j.datos_ilegibles?.length === 5 && !texto.includes('enc1:'), 'pero no puede leer nada sensible y lo avisa (no muestra basura)', j.datos_ilegibles);
  [s] = await pedir('GET', '/personal/documentos/' + docA, M2); revisa(s === 409, 'ni abrir documentos');
  revisa(JSON.stringify(fila(pA.id)) === JSON.stringify(antes) && fs.readFileSync(rutaDoc).equals(archivoAntes), 'y NO toca lo guardado: nada se pierde por arrancar con la clave equivocada');
  [, j] = await pedir('GET', '/admin/integridad', A); revisa(j.resultados?.find(x => x.titulo.startsWith('Datos cifrados que no se pueden leer'))?.casos.some(c => /otra clave/.test(c.detalle)), 'la revisión de integridad dice que se cifró con otra clave', j.resultados?.find(x => x.titulo.startsWith('Datos cifrados que no')));
  [s] = await pedir('PUT', '/personal/' + pA.id, M2, { telefono: '442 333 4444', clabe: '', rfc: '', version: (await pedir('GET', '/personal/' + pA.id, M2))[1].version });
  revisa(s === 200 && fila(pA.id).clabe === antes.clabe && fila(pA.id).rfc === antes.rfc, 'guardar la ficha con los campos ilegibles vacíos no borra los datos cifrados', s);
  await parar(); r = await arrancar({ CLAVE_CIFRADO: K1 });
  [, j] = await pedir('GET', '/personal/' + pA.id, M2); revisa(r.ok && j.clabe === A1.clabe && j.rfc === A2.rfc && j.salario === A2.salario, 'con la clave correcta todo vuelve a leerse');
  await parar(); r = await arrancar({ CLAVE_CIFRADO: K2, CLAVE_CIFRADO_ANTERIOR: K1 });
  const tras = fila(pA.id), kid = v => v.split(':')[1];
  revisa(r.ok && kid(tras.clabe) !== kid(antes.clabe) && /Se cifraron/.test(salida), 'cambio de clave (nueva + anterior): al arrancar se vuelve a cifrar todo con la nueva', salida.split('\n').filter(x => /cifr/.test(x)));
  revisa(fs.readFileSync(rutaDoc).subarray(4, 12).toString() === kid(tras.clabe), 'los documentos también quedan con la clave nueva');
  await parar(); r = await arrancar({ CLAVE_CIFRADO: K2 });
  [, j] = await pedir('GET', '/personal/' + pA.id, M2); [s, , , , buf] = await pedir('GET', '/personal/documentos/' + docA, M2);
  revisa(j.clabe === A1.clabe && j.nss === A2.nss && s === 200 && buf.equals(pdf), 'ya solo con la clave nueva se lee todo (datos y documentos)');
  [s] = await subir('/personal/' + pA.id + '/documentos', M2, pdf, { 'X-Tipo': 'ine', 'X-Nombre': 'repetida.pdf' }); revisa(s === 409, 'y sigue reconociendo un documento repetido (huella recalculada)', s);
  await parar(); r = await arrancar({});
  const archivoClave = path.join(dir, 'clave-cifrado.key');
  revisa(r.ok && fs.existsSync(archivoClave) && /^[0-9a-f]{64}\s*$/.test(fs.readFileSync(archivoClave, 'utf8')), 'sin variable de entorno se crea un archivo de clave junto a la base (no en el sitio web)');
  [, j] = await pedir('GET', '/admin/integridad', A); revisa(j.resultados?.find(x => x.titulo.startsWith('Clave de cifrado guardada en la variable'))?.total === 1, 'y la revisión de integridad pide pasarla a la variable de entorno');
  [s, j] = await pedir('POST', '/personal', M2, { nombre: 'Fausto Archivo', puesto: 'Ayudante', clabe: conDigito('0021800' + digitos(10)) }); const pF = j; const clabeF = j.clabe;
  await parar(); r = await arrancar({ CLAVE_CIFRADO: K2 });
  [, j] = await pedir('GET', '/personal/' + pF.id, M2);
  revisa(r.ok && j.clabe === clabeF && kid(fila(pF.id).clabe) === kid(fila(pA.id).clabe), 'al poner la variable, lo cifrado con el archivo se pasa solo a la clave de la variable', [j.clabe, fila(pF.id).clabe.slice(0, 15)]);
  let rf = ''; try { rf = execFileSync('git', ['check-ignore', '-v', 'clave-cifrado.key'], { cwd: RAIZ, encoding: 'utf8' }); } catch { /* no ignorado */ }
  revisa(/clave-cifrado\.key/.test(rf), 'el archivo de clave nunca se sube al repositorio (.gitignore)', rf);
  await parar(); r = await arrancar({ CLAVE_CIFRADO: K3, CLAVE_CIFRADO_ANTERIOR: K2 });
  [, j] = await pedir('GET', '/personal/' + pA.id, M2); revisa(r.ok && j.clabe === A1.clabe && kid(fila(pA.id).clabe) !== kid(tras.clabe), 'una frase larga también sirve de clave (y se cambia a ella desde la anterior)');
  await parar(); K2actual = K3;
  for (const [mala, que] of [['corta', 'demasiado corta'], ['z'.repeat(20), '20 caracteres']]) {
    r = await arrancar({ CLAVE_CIFRADO: mala }); const log = salida;
    revisa(!r.ok && r.codigo !== 0 && /CLAVE_CIFRADO/.test(log) && !log.includes(mala), `una clave inválida (${que}) detiene el arranque, sin mostrar la clave en el registro`, log.slice(-300));
    await parar();
  }

  console.log('8. Datos en claro de una versión anterior: se cifran sin dejar restos');
  // Como si una versión vieja hubiera guardado todo en claro: datos, documento y bitácora.
  const pdfLegado = Buffer.from('%PDF-1.4\n% ' + MARCA_DOC_LEGADO + '\n%%EOF');
  conBase(d => {
    d.prepare('UPDATE personal SET clabe = ?, rfc = ?, curp = ?, nss = ?, salario_cent = ? WHERE id = ?').run(LEGADO.clabe, LEGADO.rfc, LEGADO.curp, LEGADO.nss, 1234567, pB.id);
    const info = d.prepare("INSERT INTO documentos_personal (personal_id, tipo, nombre, archivo, formato, bytes, sha256) VALUES (?, 'ine', 'legado.pdf', '', 'pdf', ?, ?)").run(pB.id, pdfLegado.length, crypto.createHash('sha256').update(pdfLegado).digest('hex'));
    const rel = path.join(String(pB.id), 'legado-' + info.lastInsertRowid + '.pdf');
    fs.writeFileSync(path.join(dir, 'archivos', 'personal', rel), pdfLegado);
    d.prepare('UPDATE documentos_personal SET archivo = ? WHERE id = ?').run(rel, info.lastInsertRowid);
    d.prepare("INSERT INTO incidencias_personal (personal_id, tipo, fecha_inicio, fecha_fin, dias, notas) VALUES (?, 'incapacidad', ?, ?, 1, ?)").run(pB.id, dia(-100), dia(-100), MARCA_DOC_LEGADO + ' nota medica');
    d.prepare("INSERT INTO auditoria (entidad, entidad_id, accion, detalle, usuario) VALUES ('personal', ?, 'cambios', ?, 'Versión anterior')").run(pB.id, `Beatriz Secreta Dos: rfc ${LEGADO.rfcViejo} → ${LEGADO.rfc} · telefono 1 → 2 · nss (vacío) → ${LEGADO.nss} · salario $1.00 → $12,345.67`);
  });
  revisa(escanearDisco(SECRETOS_LEGADO).length > 0, '(control) antes de arrancar, los datos viejos sí están en claro en el disco');
  r = await arrancar({ CLAVE_CIFRADO: K2actual });
  const fL = fila(pB.id);
  revisa(r.ok && ['clabe', 'rfc', 'curp', 'nss', 'salario_cent'].every(k => String(fL[k]).startsWith('enc1:')), 'al arrancar, los datos en claro quedan cifrados', fL);
  [, j] = await pedir('GET', '/personal/' + pB.id, M2); revisa(j.clabe === LEGADO.clabe && j.rfc === LEGADO.rfc && j.salario === 12345.67 && j.incidencias.some(i => i.notas === MARCA_DOC_LEGADO + ' nota medica'), 'y se siguen leyendo bien (también la nota médica vieja)');
  const bitB = conBase(d => d.prepare("SELECT detalle FROM auditoria WHERE entidad = 'personal' AND usuario = 'Versión anterior'").get().detalle);
  revisa(bitB === 'Beatriz Secreta Dos: rfc (cambió) · telefono 1 → 2 · nss (cambió) · salario (cambió)', 'la bitácora vieja se limpia: queda qué cambió, sin los valores', bitB);
  [s, j] = await pedir('GET', '/personal/' + pB.id, M2); const docLeg = j.documentos.find(x => x.nombre === 'legado.pdf');
  [s, , , , buf] = await pedir('GET', '/personal/documentos/' + docLeg.id, M2); revisa(s === 200 && buf.equals(pdfLegado), 'el documento viejo queda cifrado y se descarga idéntico');
  fugas = escanearDisco([...SECRETOS_LEGADO, ...SECRETOS]);
  revisa(!fugas.length, 'escaneo byte por byte después: no quedan restos en claro (ni en espacio libre de la base ni en el WAL)', fugas);

  console.log('9. Proveedores: la CLABE a la que se paga lleva dígito verificador');
  [s, j] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Tubería Segura del Bajío', dias_credito: 0, clabe: '012180001234567897' }); revisa(s === 400 && /no es válida/.test(j.error), 'una CLABE con un dígito mal tecleado se rechaza', j);
  [s, j] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Tubería Segura del Bajío', dias_credito: 0, clabe: '012180001234567899' }); const prov = j; revisa(s === 201, 'una CLABE correcta se acepta', j);
  conBase(d => d.prepare('UPDATE proveedores SET clabe = ? WHERE id = ?').run('012180001234567897', prov.id));
  [s, j] = await pedir('PUT', '/finanzas/proveedores/' + prov.id, A, { notas: 'Proveedor de tubería' }); revisa(s === 200, 'un proveedor viejo con CLABE mal guardada se puede seguir corrigiendo en lo demás', j);
  [s, j] = await pedir('PUT', '/finanzas/proveedores/' + prov.id, A, { clabe: '014680655039528946' }); revisa(s === 400, 'pero cambiarle la CLABE por otra mal tecleada no', j);

  console.log('10. Registro del servidor');
  await parar();
  const filtrados = encontrados(todaSalida, [...SECRETOS, ...SECRETOS_LEGADO, K1, K2, K3, ADMIN.password, CLAVE_USUARIOS]);
  revisa(!filtrados.length, 'en todo lo que escribió el servidor no aparecen datos sensibles, claves de cifrado ni contraseñas', filtrados.map(x => x.slice(0, 6) + '…'));

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) { console.log('FALLARON:\n - ' + malos.join('\n - ')); process.exitCode = 1; }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows a veces retiene el archivo */ }
})().catch(async e => { console.error('ERROR', e); console.error(salida.slice(-1500)); await parar(); process.exit(1); });
