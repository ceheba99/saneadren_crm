// PERMISOS BAJO ATAQUE: combinaciones que se contraponen y todo lo que intente romper la lógica.
//  1. Revisiones de rol escondidas: un rol inventado con TODOS los permisos debe comportarse en las ~130 rutas
//     igual que el gerente (que también los tiene todos) y uno SIN permisos igual que un gerente sin permisos.
//     Ninguna ruta da error 500 con cualquiera de ellos. Lo que solo hace Dirección sigue siendo solo de Dirección.
//  2. Permisos que se contraponen o dependen de otro: no se pueden guardar combinaciones sin sentido.
//  3. Nadie se confirma a sí mismo un cobro (salvo que su rol lo permita), ni se aprueba a sí mismo una compra.
//  4. Escalar privilegios: con «Usuarios» no se crean ni editan roles más fuertes, ni de otra sucursal, ni Dirección.
//  5. Datos raros: nombres con HTML, nombres que imitan a Dirección, listas enormes o malformadas, claves trampa.
//  6. Dos personas guardando el mismo rol a la vez: la segunda no pisa a la primera sin darse cuenta.
//  7. Roles quitados: lo que tenían deja de valer.
//  8. Al azar: cientos de combinaciones (sembrado fijo); lo que responde el servidor siempre coincide con la casilla.
// Uso: node tests/simulacion-permisos-ataques.cjs   (SEMILLA=n para otra serie al azar)
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const NUEVO = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-ataques-'));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Ataques-' + Math.random().toString(36).slice(2) + '-9Q' };
const CLAVE = 'Clave-De-Ataque-2026x';
let srv = null, salida = '', PUERTO = 0;
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 900) : '')); } else console.log('  ✔ ' + texto); };
async function arrancar(DB, extra = {}) {
  PUERTO = 9600 + Math.floor(Math.random() * 380); salida = '';
  srv = spawn(process.execPath, [path.join(NUEVO, 'server', 'index.js')], { cwd: NUEVO, env: { ...process.env, MODO_DEMO: '', ...extra, PORT: String(PUERTO), DB_PATH: DB, APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
  srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
  for (let i = 0; i < 150 && !/corriendo/.test(salida); i++) await espera(150);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó:\n' + salida.slice(-1500));
}
const parar = () => new Promise(r => { if (!srv || srv.exitCode !== null) return r(); srv.on('exit', () => r()); srv.kill(); });
const pedir = async (m, r, t, b, extra = {}) => {
  const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j];
};
const login = async nombre => { const [s, j] = await pedir('POST', '/login', null, { nombre, password: nombre === 'admin' ? ADMIN.password : CLAVE }); if (s !== 200) throw new Error('No entra ' + nombre + ': ' + JSON.stringify(j)); return j.token; };
function rutas() {
  const set = new Set();
  for (const f of fs.readdirSync(path.join(NUEVO, 'server')).filter(f => f.endsWith('.js'))) {
    const s = fs.readFileSync(path.join(NUEVO, 'server', f), 'utf8');
    for (const m of s.matchAll(/app\.(get|post|put|patch|delete)\(\s*'(\/api\/[^']+)'/g)) set.add(m[1].toUpperCase() + ' ' + m[2]);
  }
  const fuera = /^(POST|GET) \/api\/(login|logout|registro|cambiar-password|verificar-correo|olvide-password|restablecer-password|demo\/)/;
  return [...set].filter(r => !fuera.test(r)).sort().map(r => { const [m, p] = r.split(' '); return [m, p.replace(/:[a-z_]+/gi, '1').replace(/^\/api/, '')]; });
}
// Generador al azar con semilla (para repetir exactamente la misma serie).
let semilla = Number(process.env.SEMILLA || 20261019);
const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };

(async () => {
  // ---------- Base: los ejemplos del demo + usuarios de prueba en QRO ----------
  const BASE = path.join(dir, 'base.db');
  await arrancar(BASE, { MODO_DEMO: '1' });
  for (let i = 0; i < 400; i++) { const [, j] = await pedir('GET', '/demo/estado'); if (j.listo || j.error) break; await espera(250); }
  let A = await login('admin');
  let [s, j] = await pedir('GET', '/permisos', A);
  const CATALOGO = j.catalogo.map(p => p.clave);
  const sucs = (await pedir('GET', '/sucursales', A))[1].sucursales, QRO = sucs.find(x => x.clave === 'QRO').id, CDMX = sucs.find(x => x.clave === 'CDMX')?.id;
  const AREAS = j.areas.map(a => a.clave);
  const VIRTUALES = AREAS.flatMap(a => [a + '.ver', a + '.sucursal']);
  const cuerpo = (lista, extra = {}) => {
    if (!Array.isArray(lista)) return { permisos: lista, ...extra };
    const alcances = Object.fromEntries(AREAS.map(a => [a, lista.includes(a + '.sucursal') ? 2 : lista.includes(a + '.ver') ? 1 : 0]));
    return { permisos: lista.filter(c => !VIRTUALES.includes(c)), alcances, ...extra };
  };
  const TODO = [...CATALOGO, ...VIRTUALES];
  const crearRol = async (nombre, permisos) => { const [, r] = await pedir('POST', '/roles', A, { nombre }); await pedir('PUT', '/roles/' + r.clave + '/permisos', A, cuerpo(permisos)); return r.clave; };
  const ROL_TODO = await crearRol('Todo de prueba', TODO), ROL_NADA = await crearRol('Nada de prueba', []);
  const crearUsuario = async (nombre, rol, sucursales = [QRO]) => (await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales }));
  for (const [nombre, rol] of [['Prueba Gerente', 'gerente'], ['Prueba Todo', ROL_TODO], ['Prueba Nada', ROL_NADA], ['Prueba Ventas', 'ventas'], ['Prueba Atencion', 'atencion'], ['Prueba Costos', 'costos']]) {
    [s, j] = await crearUsuario(nombre, rol); if (s !== 201) throw new Error('No se creó ' + nombre + ': ' + JSON.stringify(j));
  }
  await parar();
  { const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(BASE); d.exec('PRAGMA wal_checkpoint(TRUNCATE)'); d.close(); } // la copia lleva todo

  console.log('1. Revisiones de rol escondidas (cada rol en su copia de la base, todas las rutas)');
  const RUTAS = rutas();
  async function foto(usuario, preparar) {
    const DB = path.join(dir, 'foto-' + Math.random().toString(36).slice(2) + '.db'); fs.copyFileSync(BASE, DB);
    await arrancar(DB);
    if (preparar) await preparar(await login('admin'));
    const t = await login(usuario), f = {};
    for (const [m, r] of RUTAS) f[m + ' ' + r] = (await pedir(m, r, t, m === 'GET' ? undefined : {}))[0];
    await parar(); return f;
  }
  const difs = (a, b) => Object.keys(a).filter(k => a[k] !== b[k]).map(k => `${k}: ${a[k]} vs ${b[k]}`);
  const fG = await foto('Prueba Gerente'), fT = await foto('Prueba Todo');
  revisa(!difs(fG, fT).length, `un rol inventado con todos los permisos se comporta igual que el gerente en las ${RUTAS.length} rutas`, difs(fG, fT));
  const fGN = await foto('Prueba Gerente', t => pedir('PUT', '/roles/gerente/permisos', t, cuerpo([]))), fN = await foto('Prueba Nada');
  revisa(!difs(fGN, fN).length, 'un gerente sin permisos se comporta igual que un rol inventado sin permisos', difs(fGN, fN));
  const con500 = Object.entries({ ...Object.fromEntries(Object.entries(fT).map(([k, v]) => ['todo ' + k, v])), ...Object.fromEntries(Object.entries(fN).map(([k, v]) => ['nada ' + k, v])), ...Object.fromEntries(Object.entries(fGN).map(([k, v]) => ['gerente-nada ' + k, v])) }).filter(([, v]) => v >= 500);
  revisa(!con500.length, 'ninguna ruta truena (error 500) con todos o sin ningún permiso', con500);
  const fD = await foto('admin');
  const soloDireccion = Object.keys(fD).filter(k => fD[k] !== 403 && fT[k] === 403);
  // Además de lo de todas las sucursales: «deshacer» (recepción de compra, aviso resuelto) es solo de Dirección por decisión
  // del dueño (2026-10-21), con motivo y registro en la bitácora.
  const DIRECCION_ESPERADO = /\/(admin\/|sucursales|auditoria$|roles|permisos$|clientes\/(duplicados|distintos)|clientes\/1\/fusionar|servicios|canales|tipos-cliente|finanzas\/categorias|prospeccion\/sectores|compras\/(formato|centros|unidades)|compras\/ordenes\/1\/deshacer-recepcion$|historial\/1\/reabrir$)/;
  revisa(soloDireccion.every(k => DIRECCION_ESPERADO.test(k)), `lo que el rol con todo NO puede y Dirección sí son solo cosas de todas las sucursales (${soloDireccion.length})`, soloDireccion.filter(k => !DIRECCION_ESPERADO.test(k)));
  revisa(fT['GET /permisos'] === 403 && fT['PUT /roles/1/permisos'] === 403 && fT['POST /roles'] === 403, 'ni con todos los permisos se editan roles (solo Dirección)');

  // ---------- Base de trabajo para lo demás ----------
  const DB = path.join(dir, 'trabajo.db'); fs.copyFileSync(BASE, DB);
  await arrancar(DB);
  A = await login('admin');
  const T = {}; for (const u of ['Prueba Gerente', 'Prueba Todo', 'Prueba Nada', 'Prueba Ventas', 'Prueba Atencion', 'Prueba Costos']) T[u] = await login(u);
  const tabla = async () => (await pedir('GET', '/permisos', A))[1];
  const permisosDe = async rol => (await tabla()).roles.find(r => r.clave === rol).permisos;
  const guardar = (rol, permisos, extra = {}) => pedir('PUT', '/roles/' + rol + '/permisos', A, cuerpo(permisos, extra));
  // Lo que no es el tema de esta parte (cobros propios, escalar privilegios): los roles de fábrica como antes de los niveles.
  await require('./ayuda-alcance.cjs').comoAntes(pedir, A);

  console.log('\n2. Permisos que se contraponen o dependen de otro');
  const DEP = (await pedir('GET', '/permisos', A))[1].dependencias || {};
  revisa(Object.keys(DEP).length >= 4, 'la pantalla recibe qué permiso necesita a cuál (para marcarlos juntos)', DEP);
  // Más «toda su sucursal» → «al menos lo suyo» en cada área.
  const DEPENDE = Object.entries(DEP).flatMap(([a, req]) => req.map(b => [a, b])).concat(AREAS.map(a => [a + '.sucursal', a + '.ver']));
  const cerrar = set => { let cambio = true; while (cambio) { cambio = false; for (const [a, b] of DEPENDE) if (set.has(a) && !set.has(b)) { set.add(b); cambio = true; } } return set; };
  for (const [p, req] of DEPENDE.filter(([a]) => !VIRTUALES.includes(a))) {
    [s, j] = await guardar(ROL_NADA, [...cerrar(new Set([p]))].filter(x => x !== req));
    revisa(s === 400 && /necesita/i.test(j.error || ''), `«${p}» sin «${req}» no se guarda (no tiene sentido)`, [s, j]);
    const completo = [...cerrar(new Set([p]))];
    [s, j] = await guardar(ROL_NADA, completo); revisa(s === 200, `«${p}» con lo que necesita sí se guarda`, [s, j]);
    [s, j] = await guardar(ROL_NADA, completo.filter(x => x !== req)); revisa(s === 400, `y no se puede quitar «${req}» dejando «${p}»`, [s, j]);
    await guardar(ROL_NADA, []);
  }
  for (const rol of ['gerente', 'ventas', 'atencion', 'tecnico', 'costos']) {
    const p = await permisosDe(rol);
    const rotas = DEPENDE.filter(([a, b]) => p.includes(a) && !p.includes(b));
    revisa(!rotas.length, `los permisos de fábrica de ${rol} no traen combinaciones sin sentido`, rotas);
  }

  console.log('\n3. Nadie se confirma a sí mismo');
  const cartera = (await pedir('GET', '/finanzas/cartera', T['Prueba Ventas']))[1];
  const filas = (Array.isArray(cartera) ? cartera : cartera.cuentas || []).filter(c => c.saldo >= 50);
  revisa(filas.length > 0, 'hay órdenes con saldo para probar cobros en QRO', filas.length);
  if (filas.length) {
    const lead = filas[0].lead_id;
    [s, j] = await pedir('POST', `/leads/${lead}/cobros`, T['Prueba Ventas'], { monto: 10, metodo: 'efectivo' });
    revisa(s === 201 && j.confirmado === false, 'ventas registra un cobro y queda «por confirmar»', [s, j]);
    const cobro = j.id;
    [s, j] = await pedir('POST', `/finanzas/cobros/${cobro}/confirmar`, T['Prueba Ventas'], {});
    revisa(s === 403, 'ventas NO puede confirmarse su propio cobro', [s, j]);
    [s] = await pedir('POST', `/finanzas/cobros/${cobro}/confirmar`, T['Prueba Atencion'], {});
    revisa(s === 200, 'atención (otra persona) sí lo confirma');
    const [, hist] = await pedir('GET', `/leads/${lead}/historial`, A);
    revisa(!JSON.stringify(hist).includes('confirmado por administración'), 'la bitácora dice quién lo confirmó (no «administración» si no fue)', JSON.stringify(hist).slice(0, 300));
    // Con «Sus cobros entran ya confirmados» no hace falta que otro los revise.
    await guardar('ventas', [...await permisosDe('ventas'), 'cobros.directo']);
    [s, j] = await pedir('POST', `/leads/${lead}/cobros`, T['Prueba Ventas'], { monto: 11, metodo: 'efectivo' });
    revisa(s === 201 && j.confirmado === true, 'con «entran ya confirmados», ventas registra confirmado', [s, j]);
    await guardar('ventas', (await permisosDe('ventas')).filter(c => c !== 'cobros.directo'));
  }

  console.log('\n4. Escalar privilegios con «Usuarios»');
  const ROL_JEFE = await crearRol('Jefe de prueba', ['usuarios.administrar', 'cxc.ver', 'cobros.registrar']);
  [s] = await crearUsuario('Prueba Jefe', ROL_JEFE); const TJ = await login('Prueba Jefe');
  [s, j] = await pedir('POST', '/usuarios', TJ, { nombre: 'Prueba Creada Gerente', password: CLAVE, rol: 'gerente', sucursales: [QRO] }); revisa(s === 403, 'no crea gerentes', j);
  [s, j] = await pedir('POST', '/usuarios', TJ, { nombre: 'Prueba Creada Admin', password: CLAVE, rol: 'admin', sucursales: [QRO] }); revisa(s === 403, 'no crea Dirección', j);
  [s, j] = await pedir('POST', '/usuarios', TJ, { nombre: 'Prueba Creada Costos', password: CLAVE, rol: 'costos', sucursales: [QRO] }); revisa(s === 403, 'no crea roles con permisos que él no tiene', j);
  [s, j] = await pedir('POST', '/usuarios', TJ, { nombre: 'Prueba Creada Nada', password: CLAVE, rol: ROL_NADA, sucursales: [QRO] }); revisa(s === 201, 'sí crea un rol con menos permisos', j);
  if (CDMX) { [s, j] = await pedir('POST', '/usuarios', TJ, { nombre: 'Prueba Creada Cdmx', password: CLAVE, rol: ROL_NADA, sucursales: [CDMX] }); revisa(s === 400 || s === 403, 'no asigna sucursales que no son suyas', j); }
  const usuarios = (await pedir('GET', '/usuarios', A))[1], id = nombre => usuarios.find(u => u.nombre === nombre)?.id;
  const idAdmin = usuarios.find(u => u.nombre === 'admin')?.id, idJefe = id('Prueba Jefe');
  [s] = await pedir('PUT', '/usuarios/' + idAdmin, TJ, { nombre: 'Admin Hackeado' }); revisa(s === 404, 'no edita a Dirección');
  [s] = await pedir('POST', '/usuarios/' + idAdmin + '/password', TJ, { password: 'Otra-Clave-Hack-77' }); revisa(s === 404 || s === 403, 'no le cambia la contraseña a Dirección', s);
  [s, j] = await pedir('PUT', '/usuarios/' + idJefe, TJ, { rol: ROL_TODO }); revisa(s === 403 || s === 404, 'no se sube a sí mismo a un rol más fuerte', [s, j]);
  [s, j] = await pedir('PUT', '/usuarios/' + idJefe, TJ, { rol: 'gerente' }); revisa(s === 403 || s === 404, 'ni se hace gerente', [s, j]);
  [s] = await pedir('PUT', '/usuarios/' + id('Prueba Costos'), TJ, { nombre: 'Costos Editado' }); revisa(s === 404, 'no edita a quien tiene más permisos que él');
  [s] = await pedir('DELETE', '/usuarios/' + id('Prueba Costos'), TJ); revisa(s === 404, 'ni lo desactiva');
  [s] = await pedir('GET', '/permisos/mios', TJ, undefined, { 'X-Ver-Como': ROL_TODO }); revisa(s === 403, 'no puede «ver como» otro rol para brincar candados');
  [s] = await pedir('PUT', '/roles/' + ROL_JEFE + '/permisos', TJ, { permisos: CATALOGO }); revisa(s === 403, 'no se da permisos a sí mismo');
  // Si Dirección le quita «Usuarios» a su rol, al momento ya no administra nada.
  await guardar(ROL_JEFE, ['cxc.ver', 'cobros.registrar']);
  [s] = await pedir('POST', '/usuarios', TJ, { nombre: 'Prueba Tarde', password: CLAVE, rol: ROL_NADA, sucursales: [QRO] }); revisa(s === 403, 'al quitarle «Usuarios», deja de crear usuarios al instante');

  console.log('\n5. Datos raros');
  for (const nombre of ['<img src=x onerror=alert(1)>', 'Ventas"><script>', 'a'.repeat(41), '   ', '\u0000Nulo', 'Rol {{x}}']) {
    [s, j] = await pedir('POST', '/roles', A, { nombre }); revisa(s === 400, `nombre de rol rechazado: ${JSON.stringify(nombre).slice(0, 30)}`, [s, j]);
  }
  for (const nombre of ['Direccion', 'DIRECCIÓN', 'dirección ', 'Gerente', 'gerénte', 'Admin', 'Administrador']) {
    [s, j] = await pedir('POST', '/roles', A, { nombre }); revisa(s === 409 || s === 400, `no se crea un rol que se confunde con otro: «${nombre}»`, [s, j]);
  }
  [s, j] = await pedir('POST', '/roles', A, { nombre: 'Auxiliar contable' }); revisa(s === 201, 'un nombre normal sí se crea (con acentos y espacios)', j);
  const ROL_AUX = j.clave;
  [s, j] = await pedir('PUT', '/roles/' + ROL_AUX, A, { nombre: 'Dirección' }); revisa(s === 409, 'ni se renombra para hacerse pasar por Dirección', [s, j]);
  for (const [cuerpo, texto] of [[{ permisos: null }, 'null'], [{ permisos: {} }, 'objeto'], [{ permisos: [1, 2] }, 'números'], [{ permisos: ['__proto__'] }, '__proto__'], [{ permisos: ['cxc.ver', 'constructor'] }, 'constructor'], [{}, 'sin lista']]) {
    [s] = await guardar(ROL_AUX, cuerpo.permisos === undefined ? undefined : cuerpo.permisos); revisa(s === 400, `lista inválida (${texto}) se rechaza`, s);
  }
  [s, j] = await guardar(ROL_AUX, Array(20000).fill('cxc.ver')); revisa(s === 200 && (await permisosDe(ROL_AUX)).join() === 'cxc.ver', 'una lista con 20,000 repetidos se guarda como uno solo', [s, j]);
  for (const clave of ['__proto__', 'constructor', '..%2F..%2Fadmin', 'admin%00', "ventas' OR '1'='1"]) {
    [s] = await pedir('PUT', '/roles/' + clave + '/permisos', A, { permisos: [] }); revisa(s === 404 || s === 400, `clave trampa en la ruta: ${clave}`, s);
  }
  [s] = await pedir('GET', '/permisos/mios', A, undefined, { 'X-Ver-Como': '__proto__' }); revisa(s === 400, '«ver como» con clave trampa se rechaza');

  console.log('\n6. Dos personas guardando el mismo rol');
  const antes = await permisosDe('atencion');
  [s] = await guardar('atencion', [...antes, 'clientes.exportar'], { antes }); revisa(s === 200, 'la primera guarda (con lo que vio al abrir)');
  [s, j] = await guardar('atencion', antes.filter(c => c !== 'cobranza.factura'), { antes }); revisa(s === 409, 'la segunda, con lo que vio ANTES del cambio, recibe «alguien más lo cambió» y no pisa', [s, j]);
  revisa((await permisosDe('atencion')).includes('clientes.exportar') && (await permisosDe('atencion')).includes('cobranza.factura'), 'queda lo que guardó la primera');
  await guardar('atencion', antes);

  console.log('\n7. Roles quitados');
  [s] = await crearUsuario('Prueba Temporal', ROL_AUX); const TT = await login('Prueba Temporal');
  [s] = await pedir('GET', '/finanzas/cartera', TT); revisa(s === 200, 'con su rol, ve la cartera');
  const idTemp = (await pedir('GET', '/usuarios', A))[1].find(u => u.nombre === 'Prueba Temporal').id;
  [s] = await pedir('DELETE', '/usuarios/' + idTemp, A); revisa(s === 200, 'se desactiva a la persona');
  [s] = await pedir('DELETE', '/roles/' + ROL_AUX, A); revisa(s === 200, 'y se quita su rol');
  [s, j] = await pedir('GET', '/permisos', A); revisa(!j.roles.some(r => r.clave === ROL_AUX), 'el rol quitado ya no aparece');
  const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(DB);
  revisa(!d.prepare('SELECT 1 FROM rol_permisos WHERE rol = ?').get(ROL_AUX), 'y sus permisos ya no existen (si alguien quedara con ese rol, no tendría nada)'); d.close();
  [s, j] = await pedir('POST', '/roles', A, { nombre: 'Auxiliar contable' }); revisa(s === 201 && j.clave !== ROL_AUX, 'un rol nuevo con el mismo nombre es otro (no hereda nada)', j);
  revisa(!(await permisosDe(j.clave)).length, 'y empieza sin permisos');

  console.log('\n8. Al azar: la casilla y el servidor siempre coinciden');
  const PRUEBAS = [ // [permiso, método, ruta, cuerpo, códigos que significan «tiene permiso»]
    ['cxc.ver', 'GET', '/finanzas/cartera'], ['cxp.ver', 'GET', '/finanzas/cxp'], ['cobros.ajustes', 'GET', '/finanzas/revision-inicial'],
    ['reportes.panorama', 'GET', '/tablero'], ['dinero.mover', 'POST', '/finanzas/importar/cxp', {}], ['cobros.confirmar', 'GET', '/finanzas/por-confirmar'],
    ['usuarios.administrar', 'POST', '/usuarios', {}], ['compras.gestionar', 'POST', '/compras/ordenes', {}], ['generador.cargar', 'POST', '/generador/importar', {}],
  ].filter(([p]) => CATALOGO.includes(p));
  let fallas = [], vueltas = 0;
  for (; vueltas < 150; vueltas++) {
    const set = cerrar(new Set(TODO.filter(() => azar() < 0.5)));
    [s, j] = await guardar(ROL_NADA, [...set]);
    if (s !== 200) { fallas.push(['no guardó', [...set], j]); continue; }
    const [, mios] = await pedir('GET', '/permisos/mios', T['Prueba Nada']);
    if ([...set].sort().join() !== [...mios.permisos].sort().join()) fallas.push(['permisos/mios no coincide', vueltas]);
    for (const [p, m, r, b] of PRUEBAS) {
      const [st] = await pedir(m, r, T['Prueba Nada'], b);
      if ((st === 403) === set.has(p)) fallas.push([vueltas, p, m + ' ' + r, st, set.has(p) ? 'tenía permiso y se negó' : 'NO tenía permiso y pasó']);
    }
  }
  revisa(!fallas.length, `${vueltas} combinaciones al azar × ${PRUEBAS.length} rutas: siempre coincide lo marcado con lo que deja hacer`, fallas.slice(0, 5));

  // Carrera: 200 peticiones de la persona mientras Dirección cambia sus permisos 30 veces, todo a la vez.
  const tareas = [];
  for (let i = 0; i < 200; i++) { const [, m, r, b] = PRUEBAS[i % PRUEBAS.length]; tareas.push(pedir(m, r, T['Prueba Nada'], b)); }
  for (let i = 0; i < 30; i++) tareas.push(guardar(ROL_NADA, i % 2 ? [] : [...cerrar(new Set(['cxc.ver', 'dinero.mover']))]));
  const res = await Promise.all(tareas);
  revisa(!res.some(([st]) => st >= 500), 'cambiar permisos mientras la persona trabaja no truena nada (230 peticiones a la vez)', res.filter(([st]) => st >= 500).slice(0, 3));
  await guardar(ROL_NADA, ['cxc.ver']);
  const [, final] = await pedir('GET', '/permisos/mios', T['Prueba Nada']);
  const [stC] = await pedir('GET', '/finanzas/cartera', T['Prueba Nada']), [stP] = await pedir('GET', '/finanzas/cxp', T['Prueba Nada']);
  revisa(final.permisos.join() === 'cxc.ver' && stC === 200 && stP === 403, 'al terminar, queda exactamente lo último que se guardó', [final.permisos, stC, stP]);

  // «Ver como» no abre lo que es solo de Dirección (para que la vista previa sea fiel).
  for (const r of ['/clientes/duplicados', '/admin/integridad', '/auditoria']) {
    [s] = await pedir('GET', r, A, undefined, { 'X-Ver-Como': 'ventas' }); revisa(s === 403, `viendo como ventas, «${r}» se niega como a ventas`, s);
  }

  await parar();
  console.log(`\n${n - malos.length}/${n} correctas`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(async e => { console.error(e); await parar(); process.exit(1); });
