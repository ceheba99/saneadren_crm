// ELIMINAR USUARIOS Y SUCURSALES (2026-11-04): solo Dirección; se borran si nunca se usaron y se archivan si ya tienen
// registros (desaparecen de las listas, el historial se conserva). No la propia cuenta, el último Dirección ni la principal.
// Uso: node tests/simulacion-eliminar.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-eliminar-')), DB = path.join(dir, 'eliminar.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Eliminar-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Eliminar-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9550 + Math.floor(Math.random() * 150)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', RESPALDOS: '0', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
const conBase = fn => { const d = new DatabaseSync(DB); try { d.exec('PRAGMA busy_timeout = 5000'); return fn(d); } finally { d.close(); } };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const cdmx = exigir(await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' }), 'crear CDMX');
  const crear = async (nombre, rol, s) => { const u = exigir(await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [s] }), 'crear ' + nombre); return u; };
  const gema = await crear('Gema Gerente', 'gerente', qro.id), G = exigir(await pedir('POST', '/login', null, { nombre: 'Gema Gerente', password: CLAVE }), 'entrar Gema').token;
  const vale = await crear('Valeria Ventas', 'ventas', qro.id), V = exigir(await pedir('POST', '/login', null, { nombre: 'Valeria Ventas', password: CLAVE }), 'entrar Valeria').token;
  const nuevo = await crear('Nuevo Sin Usar', 'ventas', qro.id);
  const yo = (await pedir('GET', '/permisos/mios', A))[1].usuario_id;

  console.log('1. Usuarios');
  revisa((await pedir('POST', '/usuarios/' + nuevo.id + '/eliminar', G, {}))[0] === 403, 'El Gerente no elimina usuarios');
  revisa((await pedir('POST', '/usuarios/' + yo + '/eliminar', A, {}))[0] === 400, 'Dirección no se elimina a sí misma');
  let [s, r] = await pedir('POST', '/usuarios/' + nuevo.id + '/eliminar', A, {});
  revisa(s === 200 && r.resultado === 'eliminado' && !conBase(d => d.prepare('SELECT 1 FROM usuarios WHERE id = ?').get(nuevo.id)), 'Un usuario que nunca se usó se BORRA', r);
  // Valeria registra un contacto: ya tiene historial.
  const canal = (await pedir('GET', '/canales', V))[1][0];
  exigir(await pedir('POST', '/contactos', V, { nombre: 'Cliente de Valeria', telefono: '4423334455', canal_origen_id: canal.id }), 'contacto');
  [s, r] = await pedir('POST', '/usuarios/' + vale.id + '/eliminar', A, {});
  const fila = conBase(d => d.prepare('SELECT activo, archivado_at FROM usuarios WHERE id = ?').get(vale.id));
  revisa(s === 200 && r.resultado === 'archivado' && fila && !fila.activo && fila.archivado_at, 'Un usuario con registros se ARCHIVA (no se borra)', { r, fila });
  revisa(conBase(d => d.prepare("SELECT COUNT(*) n FROM clientes WHERE nombre = 'Cliente de Valeria' AND capturado_por = ?").get(vale.id).n) === 1, 'Su contacto sigue con su nombre de quien lo capturó');
  revisa((await pedir('GET', '/servicios', V))[0] === 401, 'Ya no puede entrar (sus sesiones se cerraron)');
  revisa(!(await pedir('GET', '/usuarios/desactivados', A))[1].some(u => u.id === vale.id) && !(await pedir('GET', '/usuarios', A))[1].some(u => u.id === vale.id), 'No sale ni en usuarios ni en desactivados');
  revisa((await pedir('POST', '/usuarios/' + vale.id + '/eliminar', A, {}))[0] === 404, 'Eliminar otra vez: ya no existe para la pantalla');
  void gema;

  console.log('2. Sucursales');
  revisa((await pedir('POST', '/sucursales/' + cdmx.id + '/eliminar', G, {}))[0] === 403, 'El Gerente no elimina sucursales');
  revisa((await pedir('POST', '/sucursales/' + qro.id + '/eliminar', A, {}))[0] === 400, 'La sucursal principal no se elimina');
  exigir(await pedir('GET', '/asistencia/horarios', A), 'horarios de arranque'); // crea los horarios de cada sucursal
  revisa(conBase(d => d.prepare('SELECT COUNT(*) n FROM horarios WHERE sucursal_id = ?').get(cdmx.id).n) > 0, 'La sucursal nueva ya tiene sus horarios de arranque');
  [s, r] = await pedir('POST', '/sucursales/' + cdmx.id + '/eliminar', A, {});
  revisa(s === 200 && r.resultado === 'eliminado' && !conBase(d => d.prepare('SELECT 1 FROM sucursales WHERE id = ?').get(cdmx.id)) && !conBase(d => d.prepare('SELECT 1 FROM horarios WHERE sucursal_id = ?').get(cdmx.id)), 'Una sucursal que nunca se usó se BORRA (con sus horarios de arranque)', r);
  const mty = exigir(await pedir('POST', '/sucursales', A, { nombre: 'Monterrey', clave: 'MTY' }), 'crear MTY');
  exigir(await pedir('POST', '/personal', A, { nombre: 'Persona de Monterrey', puesto: 'Operador', sucursal_id: mty.id }), 'persona en MTY');
  [s, r] = await pedir('POST', '/sucursales/' + mty.id + '/eliminar', A, {});
  const sm = conBase(d => d.prepare('SELECT activo, archivado_at FROM sucursales WHERE id = ?').get(mty.id));
  revisa(s === 200 && r.resultado === 'archivado' && sm && !sm.activo && sm.archivado_at, 'Una sucursal con registros se ARCHIVA', { r, sm });
  revisa((await pedir('GET', '/sucursales', A))[1].sucursales.find(x => x.id === mty.id)?.archivado_at, 'La pantalla recibe la marca de archivada para ocultarla');
  // El candado de horarios sigue firme para lo que sí se usa: un horario con gente asignada no se borra.
  const per = exigir(await pedir('POST', '/personal', A, { nombre: 'Persona con Horario', puesto: 'Operador', sucursal_id: qro.id }), 'persona QRO');
  const hor = (await pedir('GET', '/asistencia/horarios', A))[1].horarios.find(x => x.sucursal_id === qro.id);
  exigir(await pedir('PUT', '/asistencia/personal/' + per.id + '/horario', A, { horario_id: hor.id, desde: HOY }), 'asignar horario');
  revisa(conBase(d => { try { d.exec(`DELETE FROM horario_versiones WHERE horario_id = ${hor.id}`); return false; } catch { return true; } }), 'Un horario con gente asignada sigue sin poder borrarse');
  void HOY;

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
