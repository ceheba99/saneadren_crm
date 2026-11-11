// AUDITORÍA EXTERNA (6-nov-2026, corregida el 11-nov): H02 CLABE tapada en historial y buscador, H03 repetir «no
// realizado» no duplica gastos, H04 notas y avisos solo con permiso, H05 técnico de la sucursal y activo, H09 buscar
// facturas antes del corte, H13 sin SMTP el enlace no se escribe en la consola.
// Uso: node tests/simulacion-auditoria-externa.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-aud-ext-')), DB = path.join(dir, 'a.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'AudExt-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-AudExt-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9450 + Math.floor(Math.random() * 100)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', CORREO_CONSOLA: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', RESPALDOS: '0', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b, extra = {}) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); } else console.log('  ✔ ' + texto); };
const uno = sql => { const d = new DatabaseSync(DB); try { return d.prepare(sql).get(); } finally { d.close(); } };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const cdmx = exigir(await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' }), 'CDMX');
  const usuario = async (nombre, rol, s) => { const u = exigir(await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [s] }), nombre); return { ...u, t: exigir(await pedir('POST', '/login', null, { nombre, password: CLAVE }), 'entrar ' + nombre).token }; };
  const V = await usuario('Valeria Ventas', 'ventas', qro.id), V2 = await usuario('Victor Ventas', 'ventas', qro.id), M = await usuario('Mara Marketing', 'marketing', qro.id);
  const T = await usuario('Tito Tecnico', 'tecnico', cdmx.id);
  const canal = (await pedir('GET', '/canales', A))[1][0], servicio = (await pedir('GET', '/servicios', A))[1][0];
  const cli = exigir(await pedir('POST', '/contactos', V.t, { nombre: 'Cliente Auditoría', telefono: '4425551234', canal_origen_id: canal.id }), 'cliente');
  const orden = async (t, uid) => {
    const l = exigir(await pedir('POST', '/leads', t, { cliente_id: cli.cliente_id || cli.id, direccion: 'Cocina', canal_id: canal.id, servicio_id: servicio.id, responsable_id: uid, forzar_duplicado: true, partidas_json: JSON.stringify([{ servicio: servicio.nombre, leyenda: 'Prueba', importe: 1000 }]), iva_modo: 'mas_iva', valor: 1000, fecha_cotizacion: HOY }), 'cotización');
    return exigir(await pedir('PUT', '/leads/' + l.id, t, { version: l.version, estatus: 'ganado', fecha_servicio: HOY }), 'ganar');
  };
  const oV = await orden(V.t, V.id);

  console.log('H02 · CLABE y proveedores');
  const prov = exigir(await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Pipas Auditoría', tipo_comprobante: 'factura', clabe: '012180001234567899', banco: 'BBVA' }), 'proveedor');
  exigir(await pedir('PUT', '/finanzas/proveedores/' + prov.id, A, { ...prov, clabe: '002180009876543212', banco: 'Banamex' }), 'cambiar CLABE');
  let [s, j] = await pedir('GET', '/auditoria?entidad=proveedor&id=' + prov.id, V.t);
  const texto = JSON.stringify(j);
  revisa(s === 200 && /•••7899/.test(texto) && !texto.includes('012180001234567899') && !texto.includes('002180009876543212'), 'Ventas (sin pagos) ve el cambio de CLABE tapado', texto.slice(0, 300));
  [s, j] = await pedir('GET', '/auditoria?entidad=proveedor&id=' + prov.id, A);
  revisa(JSON.stringify(j).includes('002180009876543212'), 'Dirección (hace pagos) sí ve la CLABE completa en el historial');
  [s, j] = await pedir('GET', '/auditoria?entidad=proveedor&id=' + prov.id, M.t);
  revisa(s === 200 && Array.isArray(j) && !j.length, 'Marketing no ve el historial de un proveedor', j);
  [s, j] = await pedir('GET', '/buscar?q=Pipas', M.t);
  revisa(!JSON.stringify(j).includes('Pipas Auditoría'), 'Marketing no encuentra proveedores en el buscador', j);
  [s, j] = await pedir('GET', '/buscar?q=Pipas', V.t);
  revisa(JSON.stringify(j).includes('Pipas Auditoría'), 'Quien registra gastos sí los encuentra');

  console.log('H03 · «no realizado» dos veces');
  const oN = await orden(V.t, V.id);
  const cuerpo = { estado: 'no_realizado', motivo: 'El cliente canceló en el sitio', gastos: [{ proveedor_id: prov.id, categoria: 'renta_maquinaria', concepto: 'Pipa en falso', total: 1500 }] };
  [s] = await pedir('POST', '/leads/' + oN.id + '/ejecucion', A, cuerpo);
  const [s2, j2] = await pedir('POST', '/leads/' + oN.id + '/ejecucion', A, cuerpo);
  revisa(s === 200 && s2 === 409 && j2.codigo === 'YA_NO_REALIZADO', 'El segundo envío se rechaza', [s, s2, j2]);
  revisa(uno(`SELECT COUNT(*) n FROM cuentas_por_pagar WHERE lead_id = ${oN.id}`).n === 1, 'Queda un solo gasto (no se duplicó)');

  console.log('H04 · notas y avisos');
  [s] = await pedir('POST', '/leads/' + oV.id + '/historial', V.t, { tipo: 'alerta', texto: 'Llamar al cliente', fecha_alerta: HOY + 'T10:00' });
  revisa(s === 201 || s === 200, 'Quien hizo la orden agrega un recordatorio', s);
  const alerta = uno(`SELECT id FROM historial WHERE lead_id = ${oV.id} AND tipo = 'alerta'`);
  // Victor (ventas, misma sucursal) puede ver la orden de Valeria según el alcance, pero no editarla.
  [s, j] = await pedir('POST', '/leads/' + oV.id + '/historial', V2.t, { tipo: 'observacion', texto: 'Nota de alguien que no la lleva' });
  revisa(s === 403 || s === 404, 'Quien no puede editar la orden no le agrega notas', [s, j]);
  [s] = await pedir('PUT', '/historial/' + alerta.id + '/resolver', V2.t);
  revisa((s === 403 || s === 404) && !uno(`SELECT resuelta FROM historial WHERE id = ${alerta.id}`).resuelta, 'Ni le marca resuelto el aviso', s);
  [s] = await pedir('PUT', '/historial/' + alerta.id + '/resolver', T.t);
  revisa(s === 404, 'Desde otra sucursal, el aviso «no existe» (antes cualquiera lo cerraba con su número)', s);
  [s] = await pedir('POST', '/leads/' + oV.id + '/historial', V.t, { tipo: 'observacion', texto: 'Aprobado por Dirección', origen: 'sistema' });
  revisa(uno(`SELECT origen FROM historial WHERE lead_id = ${oV.id} AND texto = 'Aprobado por Dirección'`).origen === 'manual', 'Una nota escrita a mano no puede hacerse pasar por «Sistema»');
  [s] = await pedir('POST', '/leads/' + oV.id + '/historial', V.t, { tipo: 'observacion', texto: 'Orden de servicio descargada (PDF).', origen: 'sistema' });
  revisa(uno(`SELECT origen FROM historial WHERE lead_id = ${oV.id} AND texto = 'Orden de servicio descargada (PDF).'`).origen === 'sistema', 'Lo que la pantalla anota sola sí queda como «Sistema»');
  [s] = await pedir('PUT', '/historial/' + alerta.id + '/resolver', V.t);
  revisa(s === 200 && uno(`SELECT resuelta FROM historial WHERE id = ${alerta.id}`).resuelta === 1, 'Quien lleva la orden marca resuelto su aviso', s);

  console.log('H05 · técnico de la sucursal');
  const actual = (await pedir('GET', '/leads/' + oV.id, A))[1];
  [s, j] = await pedir('PUT', '/leads/' + oV.id, A, { version: actual.version, tecnico_id: T.id });
  revisa(s === 400 && /sucursal/.test(j.error), 'No se asigna un técnico de otra sucursal', [s, j.error]);

  console.log('H09 · buscar facturas');
  { const d = new DatabaseSync(DB); d.prepare("INSERT INTO facturas (lead_id, sucursal_id, num_order, estatus, entorno, receptor_rfc, receptor_razon_social, total_cent) VALUES (?, ?, 'X-1', 'cancelada', 'sandbox', 'AUDI800101AB1', 'RAZON MUY ANTIGUA', 1000)").run(oV.id, qro.id);
    const ins = d.prepare("INSERT INTO facturas (lead_id, sucursal_id, num_order, estatus, entorno, receptor_rfc, total_cent) VALUES (?, ?, ?, 'cancelada', 'sandbox', 'XAXX010101000', 1000)");
    d.exec('BEGIN'); for (let i = 0; i < 1005; i++) ins.run(oV.id, qro.id, 'N-' + i); d.exec('COMMIT'); d.close(); }
  [s, j] = await pedir('GET', '/facturacion/facturas?q=muy%20antigua', A);
  revisa(s === 200 && j.facturas.length === 1 && j.facturas[0].receptor_razon_social === 'RAZON MUY ANTIGUA', 'Encuentra una factura que quedó fuera de las 1,000 más nuevas', [s, j.total]);
  [s, j] = await pedir('GET', '/facturacion/facturas', A);
  revisa(j.total === 1006 && j.truncado, 'El total dice cuántas hay de verdad (no se queda en 1,000)', j.total);

  console.log('H13 · correo sin SMTP');
  await pedir('POST', '/olvide-password', null, { correo: ADMIN.correo });
  await espera(300);
  revisa(/correo NO enviado/.test(salida) && !/restablecer\?token=|token=[A-Za-z0-9_-]{20,}/.test(salida) && /enlace oculto/.test(salida), 'El enlace para cambiar la contraseña no se escribe en la consola');

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
