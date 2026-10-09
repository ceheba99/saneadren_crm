// Simulación de punta a punta sobre una base de datos NUEVA (como un servidor recién creado en
// Render): admin inicial por variables de entorno, cuentas, permisos y el flujo completo
// contacto → cotización → orden de servicio → duplicado.
// Uso: node tests/simulacion.cjs   (no toca saneadren.db: usa una base temporal)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-sim-'));
const PUERTO = String(3400 + Math.floor(Math.random() * 500));
const ADMIN = { usuario: 'admin', correo: 'marketing@saneadren.com.mx', password: 'Simulacion-Segura-41' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
  env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'sim.db'), APP_URL: 'http://localhost:' + PUERTO,
    ADMIN_USUARIO: ADMIN.usuario, ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' }
});
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);

const API = `http://localhost:${PUERTO}/api`;
let pruebas = 0, fallos = 0;
const ok = (c, t, extra) => { pruebas++; if (!c) fallos++; console.log((c ? '  ✔ ' : '  ✘ ') + t + (!c && extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const seccion = t => console.log('\n' + t);
async function pedir(metodo, ruta, token, cuerpo) {
  const r = await fetch(API + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  return [r.status, await r.json().catch(() => ({}))];
}
const enlace = accion => { const m = [...salida.matchAll(new RegExp('#' + accion + '=([\\w-]+)', 'g'))]; return m.length ? m.at(-1)[1] : null; };
const espera = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 40 && !/corriendo/.test(salida); i++) await espera(150);

  seccion('1. Servidor nuevo y admin inicial');
  ok(/\[admin inicial\] Configurado "admin"/.test(salida), 'el admin se configuró desde variables de entorno');
  let [s, j] = await pedir('POST', '/login', null, { nombre: 'Ventas 1', password: '1234' });
  ok(s === 403, 'los usuarios de ejemplo con 1234 están bloqueados');
  [s, j] = await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password });
  ok(s === 200 && j.rol === 'admin' && !j.cambiar_password, 'admin entra con su correo', j);
  const A = j.token;

  seccion('2. Registro de personal y recuperación de contraseña');
  [s] = await pedir('POST', '/registro', null, { nombre: 'Laura Pérez', correo: 'laura@sanedaren.com.mx', password: 'Desazolve-2026' });
  ok(s === 400, 'correo de otro dominio rechazado');
  [s] = await pedir('POST', '/registro', null, { nombre: 'Laura Pérez', correo: 'laura@saneadren.com.mx', password: 'Desazolve-2026' });
  ok(s === 202, 'registro aceptado');
  [s] = await pedir('POST', '/login', null, { nombre: 'laura@saneadren.com.mx', password: 'Desazolve-2026' });
  ok(s === 403, 'no entra sin confirmar el correo');
  await espera(200);
  [s] = await pedir('POST', '/verificar-correo', null, { token: enlace('verificar') });
  ok(s === 200, 'correo confirmado con el enlace');
  [s, j] = await pedir('POST', '/login', null, { nombre: 'laura@saneadren.com.mx', password: 'Desazolve-2026' });
  ok(s === 200 && j.rol === 'ventas', 'entra como ventas');
  let L = j.token;
  [s] = await pedir('POST', '/olvide-password', null, { correo: 'laura@saneadren.com.mx' });
  await espera(200);
  [s] = await pedir('POST', '/restablecer-password', null, { token: enlace('restablecer'), password: 'Bombeo-Pipa-2026' });
  ok(s === 200, 'contraseña restablecida por correo');
  [s] = await pedir('GET', '/servicios', L);
  ok(s === 401, 'la sesión anterior se cerró');
  [s, j] = await pedir('POST', '/login', null, { nombre: 'Laura Pérez', password: 'Bombeo-Pipa-2026' });
  L = j.token;
  ok(s === 200, 'entra con la contraseña nueva');

  seccion('3. Permisos');
  [s] = await pedir('GET', '/admin/backup', L); ok(s === 403, 'ventas no descarga la base de datos');
  [s] = await pedir('POST', '/usuarios', L, { nombre: 'Otro Admin', password: 'Intruso-Total-9', rol: 'admin' }); ok(s === 403, 'ventas no crea usuarios');
  [s] = await pedir('POST', '/servicios', L, { nombre: 'Servicio nuevo' }); ok(s === 403, 'ventas no da de alta servicios');
  const servicios = (await pedir('GET', '/servicios', L))[1];
  [s] = await pedir('PUT', '/servicios/' + servicios[0].id, L, { descripcion: 'Limpieza integral con equipo Vactor.' }); ok(s === 200, 'ventas edita la descripción de un servicio');
  [s] = await pedir('PUT', '/servicios/orden', L, { ids: servicios.map(x => x.id).reverse() }); ok(s === 200, 'ventas reordena servicios');
  [s] = await pedir('POST', '/canales', L, { nombre: 'Recomendación' }); ok(s === 201, 'ventas agrega un canal');
  const r = await fetch(API + '/admin/backup', { headers: { Authorization: 'Bearer ' + A } }); ok(r.status === 200, 'admin descarga la base de datos');

  seccion('4. Contacto → cotización → orden de servicio → duplicado');
  const canales = (await pedir('GET', '/canales', L))[1];
  [s, j] = await pedir('POST', '/contactos', L, { nombre: 'Empresa Salia', telefono: '4426164961', direccion: 'Carpinteros 9 Peñuelas', canal_origen_id: canales[0].id });
  ok(s === 201, 'contacto creado', j);
  const clienteId = j.id;
  const usuarioL = (await pedir('GET', '/usuarios', L))[1].find(u => u.nombre === 'Laura Pérez');
  const partidas = JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Desazolve de rejillas', importe: 3500 }]);
  [s, j] = await pedir('POST', '/leads', L, { cliente_id: clienteId, direccion: 'Carpinteros 9 Peñuelas', responsable_id: usuarioL.id, partidas_json: partidas });
  ok(s === 201 && j.estatus === 'abierto' && j.origen === 'cotizacion', 'cotización creada', j);
  const cot = j;
  [s, j] = await pedir('PUT', '/leads/' + cot.id, L, { version: cot.version, estatus: 'ganado', fecha_servicio: '2026-11-16', equipo: 'E-37-04', operador: 'Diego Arturo Hdz' });
  ok(s === 200 && j.estatus === 'ganado' && j.equipo === 'E-37-04', 'cotización convertida en orden de servicio con equipo y operador', j);
  [s, j] = await pedir('POST', '/leads', L, { cliente_id: clienteId, direccion: 'Carpinteros 9 Peñuelas', responsable_id: usuarioL.id, partidas_json: partidas, estatus: 'ganado', fecha_servicio: '2026-12-16', duplicado_de: cot.id, equipo: 'E-37-04', operador: 'Diego Arturo Hdz', forzar_duplicado: true });
  ok(s === 201 && j.origen === 'directo' && j.duplicado_de === cot.id && j.fecha_cotizacion === null, 'orden duplicada sin cotización fantasma', j);
  [s] = await pedir('PUT', '/leads/' + j.id, L, { version: j.version, estatus: 'abierto' });
  ok(s === 400, 'una orden duplicada no se puede "reabrir" como cotización');
  [s, j] = await pedir('POST', '/leads', L, { cliente_id: clienteId, direccion: 'x', responsable_id: usuarioL.id, partidas_json: partidas, duplicado_de: cot.id, forzar_duplicado: true });
  ok(s === 400, 'no se pueden duplicar cotizaciones');

  seccion('5. Seguridad general');
  const raiz = await fetch(`http://localhost:${PUERTO}/`);
  ok(raiz.headers.get('content-security-policy') && raiz.headers.get('x-frame-options') === 'DENY' && !raiz.headers.get('x-powered-by'), 'encabezados de seguridad');
  [s] = await pedir('GET', '/leads', 'token-inventado'); ok(s === 401, 'token inventado rechazado');
  [s] = await pedir('POST', '/registro', null, { nombre: '<script>alert(1)</script>', correo: 'x@saneadren.com.mx', password: 'Desazolve-2026' }); ok(s === 400, 'nombre con código rechazado');
  ok(!/uncaughtException|Error no manejado/.test(salida), 'sin errores no controlados en el servidor');

  console.log(`\n${pruebas - fallos}/${pruebas} pruebas correctas`);
  srv.kill();
  await espera(300);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
