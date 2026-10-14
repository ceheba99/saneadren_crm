// Admin inicial cuando alguien ya usó "Crear cuenta" con ADMIN_CORREO y nunca confirmó el correo
// (pasó en el servidor nuevo: sin correo saliente no llegaba la confirmación y el admin no entraba).
// Uso: node tests/simulacion-admin.cjs   (usa una base temporal)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-admin-'));
const DB = path.join(dir, 'sim.db');
const CORREO = 'marketing@saneadren.com.mx';
let pruebas = 0, fallos = 0;
const ok = (c, t, extra) => { pruebas++; if (!c) fallos++; console.log((c ? '  ✔ ' : '  ✘ ') + t + (!c && extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const espera = ms => new Promise(r => setTimeout(r, ms));

async function servidor(envExtra) {
  const puerto = String(3900 + Math.floor(Math.random() * 90));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: puerto, DB_PATH: DB, APP_URL: 'http://localhost:' + puerto, SMTP_HOST: '',
      ADMIN_USUARIO: '', ADMIN_CORREO: '', ADMIN_PASSWORD: '', USUARIO_PRUEBA_PASSWORD: '', USUARIO_2_PASSWORD: '', ...envExtra }
  });
  const s = { srv, salida: '', api: `http://localhost:${puerto}/api` };
  srv.stdout.on('data', d => s.salida += d); srv.stderr.on('data', d => s.salida += d);
  for (let i = 0; i < 60 && !/corriendo/.test(s.salida); i++) await espera(150);
  s.pedir = async (ruta, cuerpo, token) => {
    const r = await fetch(s.api + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(cuerpo) });
    return [r.status, await r.json().catch(() => ({}))];
  };
  s.cerrar = () => new Promise(r => { srv.on('exit', r); srv.kill(); });
  return s;
}

(async () => {
  console.log('\nAdmin inicial con una cuenta sin confirmar');
  let a = await servidor({});
  let [st] = await a.pedir('/registro', { nombre: 'Cesar Marketing', correo: CORREO, password: 'Registro-Propio-77' });
  ok(st === 202, 'alguien se registra con el correo del admin (sin correo saliente)');
  [st] = await a.pedir('/login', { nombre: CORREO, password: 'Registro-Propio-77' });
  ok(st === 403, 'esa cuenta no entra sin confirmar');
  await a.cerrar();

  const ADMIN = { ADMIN_USUARIO: 'Administracion', ADMIN_CORREO: CORREO, ADMIN_PASSWORD: 'Servidor-Nuevo-2026' };
  a = await servidor(ADMIN);
  ok(/\[admin inicial\] Configurado "Administracion"/.test(a.salida), 'al reiniciar con ADMIN_PASSWORD la cuenta sin confirmar pasa a ser el admin', a.salida);
  let [s2, j] = await a.pedir('/login', { nombre: 'Administracion', password: ADMIN.ADMIN_PASSWORD });
  ok(s2 === 200 && j.rol === 'admin', 'el admin entra con su usuario', j);
  [s2, j] = await a.pedir('/login', { nombre: CORREO, password: ADMIN.ADMIN_PASSWORD });
  ok(s2 === 200 && j.rol === 'admin', 'y con su correo', j);
  [s2] = await a.pedir('/login', { nombre: CORREO, password: 'Registro-Propio-77' });
  ok(s2 === 401, 'la contraseña del registro sin confirmar ya no sirve');
  await a.cerrar();

  // Caso real del servidor nuevo: el admin ya existía con otra contraseña y luego se cambiaron
  // usuario y contraseña en las variables. Los valores nuevos deben aplicarse al reiniciar.
  const NUEVO = { ADMIN_USUARIO: 'Direccion General', ADMIN_CORREO: CORREO, ADMIN_PASSWORD: 'Otra-Distinta-2027' };
  a = await servidor(NUEVO);
  ok(/\[admin inicial\] Configurado "Direccion General"/.test(a.salida), 'al cambiar las variables, el admin toma el usuario y la contraseña nuevos', a.salida);
  [s2, j] = await a.pedir('/login', { nombre: 'Direccion General', password: NUEVO.ADMIN_PASSWORD });
  ok(s2 === 200 && j.rol === 'admin', 'entra con el usuario nuevo', j);
  const T = j.token;
  [s2] = await a.pedir('/login', { nombre: CORREO, password: ADMIN.ADMIN_PASSWORD });
  ok(s2 === 401, 'la contraseña anterior ya no sirve');
  // Desde el CRM se cambia la contraseña: reiniciar con las MISMAS variables no la pisa.
  [s2] = await a.pedir('/cambiar-password', { actual: NUEVO.ADMIN_PASSWORD, nueva: 'Elegida-En-Crm-55' }, T);
  ok(s2 === 200, 'el admin cambia su contraseña desde el CRM');
  await a.cerrar();
  a = await servidor(NUEVO);
  ok(/ya está configurado/.test(a.salida), 'reiniciar con las mismas variables no cambia nada', a.salida);
  [s2] = await a.pedir('/login', { nombre: CORREO, password: 'Elegida-En-Crm-55' });
  ok(s2 === 200, 'sigue entrando con la contraseña que eligió en el CRM');
  await a.cerrar();
  // Recuperación: si la olvida, basta con poner una contraseña nueva en el servidor y reiniciar.
  a = await servidor({ ...NUEVO, ADMIN_PASSWORD: 'Recuperacion-Total-88' });
  [s2] = await a.pedir('/login', { nombre: 'Direccion General', password: 'Recuperacion-Total-88' });
  ok(s2 === 200, 'una contraseña nueva en el servidor recupera el acceso');
  await a.cerrar();
  // Otra cuenta ya usaba el nombre del admin: se renombra y el admin entra con su usuario.
  a = await servidor({});
  await a.pedir('/registro', { nombre: 'Helena Admin', correo: 'helena@saneadren.com.mx', password: 'Helena-Cuentas-12' });
  await a.cerrar();
  a = await servidor({ ADMIN_USUARIO: 'Helena Admin', ADMIN_CORREO: CORREO, ADMIN_PASSWORD: 'Choque-Nombres-34' });
  [s2, j] = await a.pedir('/login', { nombre: 'Helena Admin', password: 'Choque-Nombres-34' });
  ok(s2 === 200 && j.rol === 'admin', 'con un nombre repetido, el admin entra con su usuario', j);
  await a.cerrar();

  console.log(`\n${pruebas - fallos}/${pruebas} pruebas correctas`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
