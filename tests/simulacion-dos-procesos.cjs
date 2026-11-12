// Etapa 1 de la auditoría (AUDITORIA_ERP/14): ARQ-14 / H-001 y DB-04.
// 1) Dos procesos del sistema sobre la MISMA base: dos cobros simultáneos por el saldo completo de una orden
//    no deben entrar los dos (antes: la revisión del saldo iba fuera de la transacción).
// 2) Lo mismo con dos pagos simultáneos a un proveedor por el saldo completo de su cuenta.
// 3) Pago a proveedor ligado a una orden: si falla la nota del historial, el pago NO debe quedar guardado.
// Uso: node tests/simulacion-dos-procesos.cjs   (base temporal; nada toca la base real)
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-dos-procesos-')); const DB = path.join(dir, 'd.db');
const base = 4700 + Math.floor(Math.random() * 300), PA = String(base), PB = String(base + 400);
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'DosProcesos-' + Math.random().toString(36).slice(2) + '-9' };
const N = 60;
const procesos = [];
const arrancar = puerto => {
  let salida = '';
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: puerto, DB_PATH: DB, APP_URL: 'http://localhost:' + puerto, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', RESPALDOS: '0', TZ: 'America/Mexico_City' } });
  p.stdout.on('data', d => salida += d); p.stderr.on('data', d => salida += d);
  procesos.push(p);
  return { listo: () => /corriendo/.test(salida), salida: () => salida };
};
const pedir = async (puerto, m, r, t, b) => { const x = await fetch(`http://localhost:${puerto}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
const leer = (sql, ...p) => { const d = new DatabaseSync(DB, { readOnly: true }); try { return d.prepare(sql).get(...p); } finally { d.close(); } };
const escribir = sql => { const d = new DatabaseSync(DB); d.exec('PRAGMA busy_timeout = 5000'); try { d.exec(sql); } finally { d.close(); } };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
const sec = t => console.log('\n== ' + t);
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const AYER = (() => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); })();
const terminar = () => { for (const p of procesos) p.kill(); fs.rmSync(dir, { recursive: true, force: true }); };

(async () => {
  const sa = arrancar(PA);
  for (let i = 0; i < 150 && !sa.listo(); i++) await espera(150);
  if (!sa.listo()) throw new Error('El proceso A no arrancó: ' + sa.salida().slice(-1500));
  const pa = (...x) => pedir(PA, ...x);
  const A = (await pa('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  await pa('POST', '/usuarios', A, { nombre: 'Atención Dos', correo: 'atn.dos@saneadren.com.mx', password: 'Atencion-Dos-2026', rol: 'atencion' });
  const G = (await pa('POST', '/login', null, { nombre: 'atn.dos@saneadren.com.mx', password: 'Atencion-Dos-2026' }))[1].token;
  await require('./ayuda-alcance.cjs').comoAntes((m, r, t, b) => pa(m, r, t, b), A);
  const servicios = (await pa('GET', '/servicios', A))[1], canales = (await pa('GET', '/canales', A))[1];
  const yo = (await pa('GET', '/usuarios', A))[1].find(u => u.rol === 'admin').id;
  const cli = (await pa('POST', '/contactos', A, { nombre: 'Cliente Dos Procesos', telefono: '4427770001', direccion: 'Calle', canal_origen_id: canales[0].id }))[1].id;
  const orden = async () => {
    const [s, j] = await pa('POST', '/leads', A, { cliente_id: cli, direccion: 'Planta', responsable_id: yo, forzar_duplicado: true, iva_modo: 'sin_iva', estatus: 'ganado', fecha_servicio: HOY,
      partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'x', importe: 1000, cantidad: 1, precio: 1000 }]) });
    if (s !== 201 && s !== 200) throw new Error('orden ' + s + JSON.stringify(j)); return j.id;
  };

  // El segundo proceso abre la MISMA base (como si Plesk levantara dos copias).
  const sb = arrancar(PB);
  for (let i = 0; i < 150 && !sb.listo(); i++) await espera(150);
  if (!sb.listo()) throw new Error('El proceso B no arrancó: ' + sb.salida().slice(-1500));
  const pb = (...x) => pedir(PB, ...x);
  revisa((await pb('GET', '/canales', A))[0] === 200, 'la sesión abierta en el proceso A sirve en el proceso B (las sesiones viven en la base)');

  sec(`1. Cobros: ${N} órdenes de $1,000; en cada una, Dirección (proceso A) y Atención (proceso B) cobran $1,000 al mismo tiempo`);
  let dobles = 0, e500 = 0, aceptados = 0; const codigos = {};
  for (let i = 0; i < N; i++) {
    const id = await orden();
    const r = await Promise.all([pa('POST', `/leads/${id}/cobros`, A, { monto: 1000, metodo: 'transferencia', fecha: HOY }), pb('POST', `/leads/${id}/cobros`, G, { monto: 1000, metodo: 'efectivo', fecha: HOY })]);
    for (const [s] of r) { codigos[s] = (codigos[s] || 0) + 1; if (s >= 500) e500++; if (s === 201) aceptados++; }
    if (leer('SELECT COALESCE(SUM(monto_cent), 0) t FROM cobros WHERE lead_id = ? AND cancelado = 0', id).t > 100000) dobles++;
  }
  console.log('  respuestas:', JSON.stringify(codigos));
  revisa(dobles === 0, `ninguna orden queda cobrada de más (cobradas dos veces: ${dobles} de ${N})`);
  revisa(e500 === 0, `ningún cobro responde «Error interno» por el choque entre procesos (${e500})`);
  revisa(aceptados === N, `entra exactamente un cobro por orden (${aceptados} de ${N})`);

  sec(`2. Pagos a proveedor: ${N} cuentas de $1,000; en cada una, dos pagos de $1,000 al mismo tiempo (uno por proceso)`);
  const prov = (await pa('POST', '/finanzas/proveedores', A, { nombre: 'Pipas Dos Procesos', categoria: 'subcontratacion', dias_credito: 0 }))[1];
  let pdobles = 0, p500 = 0, paceptados = 0; const pcodigos = {};
  for (let i = 0; i < N; i++) {
    const [s, j] = await pa('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'subcontratacion', concepto: 'Servicio subcontratado ' + i, total: 1000, dias_credito: 0, fecha_documento: AYER, forzar: true });
    if (s !== 201) throw new Error('cxp ' + s + JSON.stringify(j));
    const r = await Promise.all([pa('POST', `/finanzas/cxp/${j.id}/pagos`, A, { monto: 1000, metodo: 'transferencia', fecha: HOY }), pb('POST', `/finanzas/cxp/${j.id}/pagos`, A, { monto: 1000, metodo: 'transferencia', fecha: AYER })]);
    for (const [st] of r) { pcodigos[st] = (pcodigos[st] || 0) + 1; if (st >= 500) p500++; if (st === 201) paceptados++; }
    if (leer('SELECT COALESCE(SUM(monto_cent), 0) t FROM pagos_proveedor WHERE cxp_id = ? AND cancelado = 0', j.id).t > 100000) pdobles++;
  }
  console.log('  respuestas:', JSON.stringify(pcodigos));
  revisa(pdobles === 0, `ninguna cuenta queda pagada de más (pagadas dos veces: ${pdobles} de ${N})`);
  revisa(p500 === 0, `ningún pago responde «Error interno» por el choque entre procesos (${p500})`);
  revisa(paceptados === N, `entra exactamente un pago por cuenta (${paceptados} de ${N})`);

  sec('3. Pago a proveedor ligado a una orden: si la nota del historial falla, el pago no queda guardado (DB-04)');
  const ord = await orden();
  const [sc, cx] = await pa('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, categoria: 'subcontratacion', concepto: 'Servicio subcontratado ligado', total: 500, dias_credito: 0, lead_id: ord, forzar: true });
  revisa(sc === 201, 'gasto ligado a la orden registrado', [sc, cx]);
  const pagosAntes = leer('SELECT COUNT(*) n FROM pagos_proveedor').n, bitAntes = leer('SELECT COUNT(*) n FROM auditoria').n;
  escribir("CREATE TRIGGER falla_prueba BEFORE INSERT ON historial BEGIN SELECT RAISE(ABORT, 'fallo inyectado por la prueba'); END");
  const [sf] = await pa('POST', `/finanzas/cxp/${cx.id}/pagos`, A, { monto: 100, metodo: 'transferencia', fecha: HOY });
  escribir('DROP TRIGGER IF EXISTS falla_prueba');
  const pagosDespues = leer('SELECT COUNT(*) n FROM pagos_proveedor').n, bitDespues = leer('SELECT COUNT(*) n FROM auditoria').n;
  revisa(sf >= 500, 'la pantalla recibe error', sf);
  revisa(pagosDespues === pagosAntes, `el pago NO quedó guardado (pagos antes ${pagosAntes}, después ${pagosDespues})`);
  revisa(bitDespues === bitAntes, `tampoco quedó el renglón de la bitácora (antes ${bitAntes}, después ${bitDespues})`);
  const [so] = await pa('POST', `/finanzas/cxp/${cx.id}/pagos`, A, { monto: 100, metodo: 'transferencia', fecha: HOY });
  revisa(so === 201, 'sin el fallo, el mismo pago entra normal (no lo frena el aviso de pago repetido)', so);

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLARON:\n - ' + malos.join('\n - '));
  terminar(); process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); terminar(); process.exit(1); });
