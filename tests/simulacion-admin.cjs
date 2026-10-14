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
  s.pedir = async (ruta, cuerpo) => {
    const r = await fetch(s.api + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
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

  // Una vez confirmada (o cambiada desde el CRM), reiniciar NO vuelve a imponer la del servidor.
  a = await servidor({ ...ADMIN, ADMIN_PASSWORD: 'Otra-Distinta-2027' });
  ok(/ya tiene contraseña propia/.test(a.salida), 'un admin ya configurado no se sobrescribe al reiniciar', a.salida);
  [s2] = await a.pedir('/login', { nombre: CORREO, password: 'Otra-Distinta-2027' });
  ok(s2 === 401, 'la contraseña nueva de la variable no reemplaza la existente');
  [s2] = await a.pedir('/login', { nombre: CORREO, password: ADMIN.ADMIN_PASSWORD });
  ok(s2 === 200, 'sigue entrando con la suya');
  await a.cerrar();

  console.log(`\n${pruebas - fallos}/${pruebas} pruebas correctas`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
