// ROLES Y PERMISOS: Dirección decide qué ve y hace cada rol.
//  A. (con CODIGO_ANTERIOR) Mismo comportamiento que antes: sobre la misma base llena (ejemplos del demo), cada rol
//     (Dirección, gerente, ventas, atención, técnico, costos) pide TODAS las rutas del sistema con el código anterior
//     y con el nuevo. Las respuestas deben ser iguales, salvo los cambios a propósito (lista CAMBIOS_ESPERADOS).
//  B. Lo nuevo: quitar y dar permisos aplica al momento, roles nuevos, candados (Dirección siempre todo, nadie da
//     más de lo que tiene, solo Dirección edita), «Ver como» solo mira, bitácora y que todo sobrevive un reinicio.
// Uso: node tests/simulacion-permisos.cjs            (solo B)
//      CODIGO_ANTERIOR=<carpeta> node tests/simulacion-permisos.cjs   (A y B)
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('../server/seguridad');
const NUEVO = path.join(__dirname, '..'), ANTERIOR = process.env.CODIGO_ANTERIOR;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-permisos-'));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Permisos-' + Math.random().toString(36).slice(2) + '-9Q' };
const CLAVE = 'Clave-De-Prueba-2026x';
let srv = null, salida = '', PUERTO = 0;
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
async function arrancar(codigo, DB, extra = {}) {
  PUERTO = 9100 + Math.floor(Math.random() * 380); salida = '';
  srv = spawn(process.execPath, [path.join(codigo, 'server', 'index.js')], { cwd: codigo, env: { ...process.env, MODO_DEMO: '', ...extra, NODE_PATH: path.join(NUEVO, 'node_modules'), PORT: String(PUERTO), DB_PATH: DB, APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
  srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
  for (let i = 0; i < 150 && !/corriendo/.test(salida); i++) await espera(150);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó:\n' + salida.slice(-1500));
}
const parar = () => new Promise(r => { if (!srv || srv.exitCode !== null) return r(); srv.on('exit', () => r()); srv.kill(); });
const pedir = async (m, r, t, b, extra = {}) => {
  const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j];
};
const login = async (nombre, password) => { const [s, j] = await pedir('POST', '/login', null, { nombre, password }); if (s !== 200) throw new Error('No entra ' + nombre + ': ' + JSON.stringify(j)); return j.token; };
const ROLES = ['admin', 'gerente', 'ventas', 'atencion', 'tecnico', 'costos'];
const usuarioDe = rol => rol === 'admin' ? 'admin' : 'Prueba ' + rol;
// Usuarios de prueba directo en la base (iguales para el código anterior y el nuevo), en la sucursal QRO.
function sembrarUsuarios(DB) {
  const d = new DatabaseSync(DB);
  const qro = d.prepare("SELECT id FROM sucursales WHERE clave = 'QRO'").get().id;
  for (const rol of ROLES.filter(r => r !== 'admin')) {
    const id = d.prepare('INSERT INTO usuarios (nombre, password, rol, correo_verificado) VALUES (?, ?, ?, 1)').run(usuarioDe(rol), hashPassword(CLAVE), rol).lastInsertRowid;
    d.prepare('INSERT INTO usuario_sucursales (usuario_id, sucursal_id) VALUES (?, ?)').run(id, qro);
  }
  d.close();
}
// Todas las rutas del sistema (del código nuevo), con :parámetros = 1. Fuera: sesión, demo y lo que no existía antes.
function rutas() {
  const set = new Set();
  for (const f of fs.readdirSync(path.join(NUEVO, 'server')).filter(f => f.endsWith('.js'))) {
    const s = fs.readFileSync(path.join(NUEVO, 'server', f), 'utf8');
    for (const m of s.matchAll(/app\.(get|post|put|patch|delete)\(\s*'(\/api\/[^']+)'/g)) set.add(m[1].toUpperCase() + ' ' + m[2]);
  }
  // Fuera: sesión, demo y lo que no existía en el código anterior (roles, permisos, lista mínima de órdenes para gastos).
  const fuera = /^(POST|GET) \/api\/(login|logout|registro|cambiar-password|verificar-correo|olvide-password|restablecer-password|demo\/)|\/api\/(permisos|roles)(\/|$)|\/api\/finanzas\/ordenes-para-gasto$/;
  return [...set].filter(r => !fuera.test(r)).sort().map(r => { const [m, p] = r.split(' '); return [m, p.replace(/:[a-z_]+/gi, '1').replace(/^\/api/, '')]; });
}
// Cambios a propósito respecto al código anterior: [rol, expresión "MÉTODO /ruta", motivo].
const CATALOGOS = /^(POST|PUT|DELETE) \/(canales|tipos-cliente|compras\/(centros|unidades)|finanzas\/categorias|servicios\/(1|orden))(\/|$)/;
const CAMBIOS_ESPERADOS = [
  ['gerente', CATALOGOS, 'el gerente ya edita los catálogos compartidos como ventas o atención (lo decide «Catálogos compartidos»)'],
  ...['ventas', 'atencion', 'tecnico', 'costos'].map(r => [r, /^POST \/clientes\/distintos$/, 'marcar clientes «distintos» es parte de revisar duplicados: solo Dirección']),
];

(async () => {
  const RUTAS = rutas();
  if (ANTERIOR && fs.existsSync(path.join(ANTERIOR, 'server', 'index.js'))) {
    console.log(`A. Mismo comportamiento que antes: ${RUTAS.length} rutas × ${ROLES.length} roles, código anterior contra nuevo`);
    const BASE = path.join(dir, 'base.db');
    await arrancar(ANTERIOR, BASE, { MODO_DEMO: '1' });
    for (let i = 0; i < 400; i++) { const [, j] = await pedir('GET', '/demo/estado'); if (j.listo || j.error) break; await espera(250); }
    await parar();
    sembrarUsuarios(BASE);
    const fotos = {};
    for (const [nombre, codigo] of [['anterior', ANTERIOR], ['nuevo', NUEVO]]) {
      fotos[nombre] = {};
      for (const rol of ROLES) {
        const DB = path.join(dir, `${nombre}-${rol}.db`);
        fs.copyFileSync(BASE, DB);
        await arrancar(codigo, DB);
        // Con «qué ve cada rol» igual que antes (cada quien ve su sucursal), todo debe responder igual que el publicado.
        if (codigo === NUEVO) await require('./ayuda-alcance.cjs').comoAntes((m, r, t, b) => pedir(m, r, t, b), await login('admin', ADMIN.password));
        const t = await login(usuarioDe(rol), rol === 'admin' ? ADMIN.password : CLAVE);
        const f = fotos[nombre][rol] = {};
        for (const [m, r] of RUTAS) f[m + ' ' + r] = (await pedir(m, r, t, m === 'GET' ? undefined : {}))[0];
        await parar();
      }
    }
    for (const rol of ROLES) {
      const difs = Object.keys(fotos.nuevo[rol]).filter(k => fotos.anterior[rol][k] !== fotos.nuevo[rol][k]);
      const esperadas = difs.filter(k => CAMBIOS_ESPERADOS.some(([r, ruta]) => r === rol && ruta.test(k)));
      const raras = difs.filter(k => !esperadas.includes(k));
      revisa(!raras.length, `${rol}: las ${RUTAS.length} rutas responden igual que antes` + (esperadas.length ? ` (salvo ${esperadas.length} cambio(s) a propósito)` : ''),
        raras.map(k => `${k}: ${fotos.anterior[rol][k]} → ${fotos.nuevo[rol][k]}`));
      const motivos = [...new Set(esperadas.map(k => CAMBIOS_ESPERADOS.find(([r, x]) => r === rol && x.test(k))[2]))];
      for (const m of motivos) revisa(true, `${rol}: cambio a propósito → ${m}`);
    }
    const negados = rol => Object.values(fotos.nuevo[rol]).filter(s => s === 403).length;
    const negadasDir = Object.keys(fotos.nuevo.admin).filter(k => fotos.nuevo.admin[k] === 403);
    revisa(negadasDir.every(k => fotos.anterior.admin[k] === 403), 'Dirección no pierde ninguna ruta' + (negadasDir.length ? ' (' + negadasDir.join(', ') + ' se negaba igual antes, por una regla de negocio)' : ''), negadasDir);
    revisa(negados('tecnico') > negados('costos') - 10 && negados('ventas') > 5, `los demás roles sí tienen rutas negadas (ventas ${negados('ventas')}, técnico ${negados('tecnico')}, costos ${negados('costos')})`);
  } else console.log('A. Falta CODIGO_ANTERIOR: se omite la comparación contra el código anterior.');

  console.log('\nB. Roles y permisos nuevos');
  const DB = path.join(dir, 'nuevo.db');
  await arrancar(NUEVO, DB);
  const A = await login('admin', ADMIN.password);
  const [, sucs] = await pedir('GET', '/sucursales', A);
  const qro = sucs.sucursales[0].id;
  const T = {};
  for (const rol of ROLES.filter(r => r !== 'admin')) {
    const [s, j] = await pedir('POST', '/usuarios', A, { nombre: usuarioDe(rol), password: CLAVE, rol, sucursales: [qro] });
    revisa(s === 201, `Dirección crea un usuario ${rol}`, j);
    T[rol] = await login(usuarioDe(rol), CLAVE);
  }
  let [s, j] = await pedir('GET', '/permisos', A);
  revisa(s === 200 && j.roles.length === 6 && j.catalogo.length >= 18, `la tabla de permisos trae los 6 roles y ${j.catalogo?.length} permisos`);
  const tabla = j, permisosDe = clave => tabla.roles.find(r => r.clave === clave).permisos;
  revisa(j.catalogo.every(p => permisosDe('admin').includes(p.clave)) && Object.values(j.roles.find(r => r.clave === 'admin').alcances).every(n => n === 2), 'Dirección tiene todos los permisos y lo ve todo');
  revisa(permisosDe('costos').includes('dinero.mover') && !permisosDe('ventas').includes('dinero.mover'), 'al inicio, costos mueve dinero y ventas no (como antes)');
  for (const rol of ['gerente', 'ventas', 'tecnico']) { [s] = await pedir('GET', '/permisos', T[rol]); revisa(s === 403, `${rol} no puede ver la tabla de permisos`); }
  [s] = await pedir('PUT', '/roles/ventas/permisos', T.gerente, { permisos: [] }); revisa(s === 403, 'el gerente no puede cambiar permisos');
  [s] = await pedir('POST', '/roles', T.gerente, { nombre: 'Mi rol' }); revisa(s === 403, 'el gerente no puede crear roles');

  // Quitar y dar permisos aplica al momento (sin volver a entrar).
  [s] = await pedir('GET', '/finanzas/cartera', T.ventas); revisa(s === 200, 'ventas ve cuentas por cobrar');
  let ventas = permisosDe('ventas');
  [s, j] = await pedir('PUT', '/roles/ventas/permisos', A, { permisos: ventas, alcances: { cxc: 0 } });
  revisa(s === 400 && /necesita/.test(j.error), 'no se le quita «Ver cuentas por cobrar» dejando «Confirmar cobros» (lo necesita)', j);
  [s, j] = await pedir('PUT', '/roles/ventas/permisos', A, { permisos: ventas.filter(c => c !== 'cobros.confirmar'), alcances: { cxc: 0 } });
  revisa(s === 200 && j.cambios === 2, 'Dirección le quita a ventas «Ver cuentas por cobrar» (y «Confirmar cobros»)', j);
  [s] = await pedir('GET', '/finanzas/cartera', T.ventas); revisa(s === 403, 'ventas ya no ve cuentas por cobrar (sin volver a entrar)');
  [s, j] = await pedir('GET', '/permisos/mios', T.ventas); revisa(!j.permisos.includes('cxc.ver') && j.todas.includes('cxc.ver'), 'la pantalla de ventas sabe que no lo tiene (para esconderlo)');
  [s] = await pedir('GET', '/finanzas/cartera', T.atencion); revisa(s === 200, 'atención sigue viéndolas (es otro rol)');
  [s] = await pedir('GET', '/finanzas/revision-inicial', T.ventas); revisa(s === 403, 'ventas no hace la revisión inicial');
  [s] = await pedir('PUT', '/roles/ventas/permisos', A, { permisos: [...ventas, 'cobros.ajustes'], alcances: { cxc: 1 } }); revisa(s === 200, 'Dirección le devuelve cuentas por cobrar y le da «Ajustes»');
  [s] = await pedir('GET', '/finanzas/revision-inicial', T.ventas); revisa(s === 200, 'ventas ya puede hacer la revisión inicial');
  [s] = await pedir('GET', '/finanzas/cartera', T.ventas); revisa(s === 200, 'y vuelve a ver cuentas por cobrar');
  [s] = await pedir('GET', '/finanzas/cxp/formato-excel', T.tecnico); revisa(s === 403, 'el técnico no exporta a Excel');
  [s] = await pedir('PUT', '/roles/tecnico/permisos', A, { permisos: [...permisosDe('tecnico'), 'clientes.exportar'] });
  [s] = await pedir('GET', '/finanzas/cxp/formato-excel', T.tecnico); revisa(s === 200, 'con el permiso, el técnico sí exporta', s);
  [s] = await pedir('POST', '/servicios', T.gerente, { nombre: 'Servicio de prueba gerente' }); revisa(s === 403, 'agregar servicios al catálogo es solo de Dirección (ni el gerente)');

  // Candados.
  [s, j] = await pedir('PUT', '/roles/admin/permisos', A, { permisos: [] }); revisa(s === 400, 'a Dirección no se le quitan permisos', j);
  [s] = await pedir('PUT', '/roles/ventas/permisos', A, { permisos: ['no.existe'] }); revisa(s === 400, 'un permiso que no existe se rechaza');
  [s] = await pedir('PUT', '/roles/ventas/permisos', A, { permisos: 'cxc.ver' }); revisa(s === 400, 'una lista mal formada se rechaza');
  [s] = await pedir('PUT', '/roles/no_existe/permisos', A, { permisos: [] }); revisa(s === 404, 'un rol que no existe: 404');
  [s] = await pedir('PUT', '/roles/admin', A, { nombre: 'Jefe' }); revisa(s === 400, 'Dirección no se renombra');
  [s] = await pedir('DELETE', '/roles/ventas', A); revisa(s === 400, 'los roles de fábrica no se quitan');

  // Rol nuevo: Contador, copiando al técnico.
  [s, j] = await pedir('POST', '/roles', A, { nombre: 'Contador', copiar_de: 'tecnico' });
  revisa(s === 201 && j.clave === 'contador', 'Dirección crea el rol «Contador» copiando al técnico', j);
  [s] = await pedir('POST', '/roles', A, { nombre: 'contador' }); revisa(s === 409, 'no se repite el nombre');
  [s] = await pedir('POST', '/roles', A, { nombre: 'ab' }); revisa(s === 400, 'nombre demasiado corto se rechaza');
  [s, j] = await pedir('POST', '/usuarios', A, { nombre: 'Prueba contador', password: CLAVE, rol: 'contador', sucursales: [qro] });
  revisa(s === 201, 'se crea una persona con el rol nuevo', j);
  const TC = await login('Prueba contador', CLAVE);
  [s, j] = await pedir('GET', '/permisos/mios', TC);
  const tec = (await pedir('GET', '/permisos', A))[1].roles.find(r => r.clave === 'tecnico').permisos;
  revisa(j.rol === 'contador' && j.rol_nombre === 'Contador' && j.permisos.length === tec.length && tec.every(c => j.permisos.includes(c)), 'el contador tiene exactamente los permisos del técnico');
  [s] = await pedir('GET', '/finanzas/cxp', TC); revisa(s === 200, 'el contador ve cuentas por pagar');
  [s] = await pedir('POST', '/finanzas/importar/cxp', TC, {}); revisa(s === 403, 'pero no mueve dinero');
  [s, j] = await pedir('PUT', '/roles/contador', A, { nombre: 'Contabilidad' }); revisa(s === 200, 'se renombra a «Contabilidad»');
  [s, j] = await pedir('GET', '/permisos/mios', TC); revisa(j.rol_nombre === 'Contabilidad', 'la persona ve el nombre nuevo de su rol');
  [s, j] = await pedir('DELETE', '/roles/contador', A); revisa(s === 409, 'no se quita un rol que alguien tiene', j);
  const idCont = (await pedir('GET', '/usuarios', A))[1].find(u => u.nombre === 'Prueba contador').id;
  [s] = await pedir('PUT', '/usuarios/' + idCont, A, { rol: 'ventas' }); revisa(s === 200, 'se le cambia el rol a la persona');
  [s] = await pedir('DELETE', '/roles/contador', A); revisa(s === 200, 'ahora sí se quita el rol');
  [s] = await pedir('POST', '/usuarios', A, { nombre: 'Prueba otro', password: CLAVE, rol: 'contador', sucursales: [qro] }); revisa(s === 400, 'un rol quitado ya no se asigna');
  [s] = await pedir('POST', '/usuarios', A, { nombre: 'Prueba otro', password: CLAVE, rol: 'superusuario', sucursales: [qro] }); revisa(s === 400, 'un rol inventado no se asigna');

  // Nadie da más permisos de los que tiene.
  const gerente = (await pedir('GET', '/permisos', A))[1].roles.find(r => r.clave === 'gerente').permisos;
  [s] = await pedir('PUT', '/roles/gerente/permisos', A, { permisos: gerente.filter(c => c !== 'dinero.mover') }); revisa(s === 200, 'Dirección le quita al gerente «Mover dinero»');
  [s, j] = await pedir('POST', '/usuarios', T.gerente, { nombre: 'Prueba costos dos', password: CLAVE, rol: 'costos', sucursales: [qro] });
  revisa(s === 403, 'el gerente ya no puede crear a alguien de costos (tendría más permisos que él)', j);
  [s, j] = await pedir('POST', '/usuarios', T.gerente, { nombre: 'Prueba atencion dos', password: CLAVE, rol: 'atencion', sucursales: [qro] });
  revisa(s === 201, 'pero sí a alguien de atención', j);
  const idCostos = (await pedir('GET', '/usuarios', A))[1].find(u => u.nombre === usuarioDe('costos')).id;
  [s] = await pedir('PUT', '/usuarios/' + idCostos, T.gerente, { nombre: 'Prueba costos cambiado' }); revisa(s === 404, 'ni administra a quien tiene más permisos que él');
  [s, j] = await pedir('GET', '/roles', T.gerente); revisa(j.find(r => r.clave === 'costos').cabe === false && j.find(r => r.clave === 'ventas').cabe === true, 'la lista de roles le dice cuáles puede dar');
  [s] = await pedir('PUT', '/roles/gerente/permisos', A, { permisos: gerente }); revisa(s === 200, 'Dirección se lo devuelve');
  [s] = await pedir('GET', '/admin/integridad', T.gerente); revisa(s === 403, 'el gerente no corre la revisión de integridad (abarca todas las sucursales)');
  [s] = await pedir('GET', '/admin/backup', T.gerente); revisa(s === 403, 'ni descarga el respaldo de la base');

  // «Ver como este rol»: Dirección mira; nada se guarda.
  const COMO = { 'X-Ver-Como': 'tecnico' };
  [s, j] = await pedir('GET', '/permisos/mios', A, undefined, COMO); revisa(j.rol === 'tecnico' && j.ver_como === 'tecnico', 'Dirección ve el sistema con los permisos del técnico');
  [s] = await pedir('GET', '/finanzas/revision-inicial', A, undefined, COMO); revisa(s === 403, 'como técnico, lo que el técnico no puede se niega');
  [s] = await pedir('GET', '/finanzas/cartera', A, undefined, COMO); revisa(s === 200, 'y lo que sí puede, se ve');
  [s, j] = await pedir('POST', '/servicios', A, { nombre: 'No se debe guardar' }, COMO); revisa(s === 403 && j.codigo === 'VER_COMO', 'en esa vista no se guarda nada', j);
  [s] = await pedir('GET', '/permisos/mios', T.ventas, undefined, COMO); revisa(s === 403, 'solo Dirección puede ver como otro rol');
  [s] = await pedir('GET', '/permisos/mios', A, undefined, { 'X-Ver-Como': 'admin' }); revisa(s === 400, 'no hay «ver como Dirección»');
  [s] = await pedir('GET', '/permisos/mios', A, undefined, { 'X-Ver-Como': 'inventado' }); revisa(s === 400, 'ni como un rol que no existe');

  // Bitácora y reinicio.
  [s, j] = await pedir('GET', '/auditoria?entidad=rol', A);
  const lista = Array.isArray(j) ? j : j.filas || j.registros || [];
  revisa(s === 200 && JSON.stringify(j).includes('ve en Cuentas por cobrar: Lo suyo → Nada') && JSON.stringify(j).includes('Contador'), 'la bitácora registra los cambios de permisos y roles', JSON.stringify(j).slice(0, 300));
  const ventasAntes = (await pedir('GET', '/permisos', A))[1].roles.find(r => r.clave === 'ventas').permisos.sort();
  [s] = await pedir('PUT', '/roles/ventas/permisos', A, { permisos: ventasAntes.filter(c => c !== 'cobranza.factura') });
  await parar(); await arrancar(NUEVO, DB);
  const A2 = await login('admin', ADMIN.password);
  const ventasDespues = (await pedir('GET', '/permisos', A2))[1].roles.find(r => r.clave === 'ventas').permisos;
  revisa(!ventasDespues.includes('cobranza.factura') && ventasDespues.includes('cobros.ajustes'), 'tras reiniciar, los permisos siguen como los dejó Dirección (no regresan los de fábrica)');
  const d = new DatabaseSync(DB); const sql = d.prepare("SELECT sql FROM sqlite_master WHERE name = 'usuarios'").get().sql; d.close();
  revisa(!/CHECK\s*\(\s*rol\s+IN/i.test(sql) && /'costos'/.test(sql) && /'gerente'/.test(sql), 'la tabla de usuarios ya no limita la lista de roles (y el código anterior la sigue reconociendo)');
  await parar();

  console.log(`\n${n - malos.length}/${n} correctas`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(async e => { console.error(e); await parar(); process.exit(1); });
