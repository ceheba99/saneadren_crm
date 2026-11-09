// CLIENTES CON PLANTILLA Y ELIMINAR (2026-11-09): solo Dirección. Revisar no guarda; guardar es todo o nada; un
// teléfono que ya existe se omite (no se duplica); cada carga queda registrada y se puede deshacer; un cliente solo se
// elimina si no tiene registros. Uso: node tests/simulacion-clientes-carga.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-clientes-carga-')), DB = path.join(dir, 'cc.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Carga-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Carga-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9600 + Math.floor(Math.random() * 100)), URLB = 'http://localhost:' + PUERTO;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', RESPALDOS: '0', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const cuenta = sql => { const d = new DatabaseSync(DB); try { return d.prepare(sql).get().n; } finally { d.close(); } };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  exigir(await pedir('POST', '/usuarios', A, { nombre: 'Gema Gerente', password: CLAVE, rol: 'gerente', sucursales: [qro.id] }), 'gerente');
  const G = exigir(await pedir('POST', '/login', null, { nombre: 'Gema Gerente', password: CLAVE }), 'entrar Gema').token;
  const canal = (await pedir('GET', '/canales', A))[1][0], tipo = (await pedir('GET', '/tipos-cliente', A))[1][0];
  // Un cliente que ya existe (capturado a mano).
  const viejo = exigir(await pedir('POST', '/contactos', A, { nombre: 'Laura Existente', telefono: '4421112233', canal_origen_id: canal.id }), 'cliente existente');

  console.log('1. Revisar');
  revisa((await pedir('POST', '/clientes-carga/revisar', G, { filas: [{ nombre: 'X', telefono: '4425550001' }] }))[0] === 403, 'El Gerente no carga clientes');
  const filas = [
    { fila: 2, nombre: 'Pedro Pérez', empresa: 'KFC Puerta la Victoria', telefono: '442 555 0001', correo: 'pedro@kfc.mx', tipo: tipo.nombre, canal: canal.nombre, sucursal: qro.clave },
    { fila: 3, nombre: 'Ana López', telefono: '(442) 555-0002', telefono_alterno: '4425550003', rfc: 'LOAA800101AB1' },
    { fila: 4, nombre: 'Laura Otra', telefono: '4421112233' }, // ya existe: se omite
    { fila: 5, nombre: 'Sin Teléfono' },
    { fila: 6, nombre: 'Correo Malo', telefono: '4425550004', correo: 'no-es-correo' },
    { fila: 7, nombre: 'Repetido', telefono: '4425550001' },
    { fila: 8, nombre: 'Canal Inventado', telefono: '4425550005', canal: 'Paloma mensajera' },
  ];
  let [s, j] = await pedir('POST', '/clientes-carga/revisar', A, { filas });
  const f = k => j.filas.find(x => x.fila === k);
  revisa(s === 200 && j.nuevos === 2 && j.existentes === 1 && j.con_errores === 4 && j.hay_errores, 'Cuenta nuevos, existentes y con errores', [j.nuevos, j.existentes, j.con_errores]);
  revisa(f(3).estado === 'nuevo' && f(3).telefono === '4425550002', 'Normaliza el teléfono con espacios, guiones y paréntesis', f(3));
  revisa(f(4).estado === 'existe' && f(4).existe.id === viejo.id && !f(4).errores.length, 'Un teléfono que ya es de un cliente: se omite (no es error) y dice de quién', f(4));
  revisa(/Falta el teléfono/.test(f(5).errores.join()) && /correo/.test(f(6).errores.join()) && /repetido en la fila 2/.test(f(7).errores.join()) && /Paloma/.test(f(8).errores.join()), 'Errores claros por fila', [f(5).errores, f(6).errores, f(7).errores, f(8).errores]);
  revisa(cuenta('SELECT COUNT(*) n FROM clientes') === 1, 'Revisar no guardó nada');
  [s, j] = await pedir('POST', '/clientes-carga/guardar', A, { filas });
  revisa(s === 400 && cuenta('SELECT COUNT(*) n FROM clientes') === 1, 'Con errores no se guarda nada (todo o nada)', s);

  console.log('2. Guardar');
  const buenas = filas.slice(0, 3);
  [s, j] = await pedir('POST', '/clientes-carga/guardar', A, { filas: buenas, archivo: 'clientes.xlsx' });
  revisa(s === 201 && j.creados === 2 && j.omitidos === 1, 'Guarda los 2 nuevos y omite el existente', j);
  const carga = j.carga_id;
  const pedro = (() => { const d = new DatabaseSync(DB); try { return d.prepare("SELECT * FROM clientes WHERE telefono_normalizado = '4425550001'").get(); } finally { d.close(); } })();
  revisa(pedro && pedro.empresa_contacto === 'KFC Puerta la Victoria' && pedro.giro === tipo.clave && pedro.canal_origen_id === canal.id && pedro.sucursal_id === qro.id && pedro.carga_id === carga, 'El cliente queda con empresa, tipo, canal, sucursal y su carga', pedro);
  revisa(cuenta("SELECT COUNT(*) n FROM telefonos_cliente WHERE telefono_normalizado = '4425550003'") === 1, 'El teléfono alterno también identifica al cliente');
  revisa(cuenta('SELECT COUNT(*) n FROM clientes WHERE telefono_normalizado = \'4421112233\'') === 1, 'No se duplicó el cliente que ya existía');
  [s, j] = await pedir('POST', '/clientes-carga/guardar', A, { filas: buenas });
  revisa(s === 400 && /No hay clientes nuevos/.test(j.error), 'Subir el mismo archivo otra vez no duplica nada', j.error);
  [s, j] = await pedir('GET', '/clientes-carga', A);
  revisa(s === 200 && j.cargas[0].id === carga && j.cargas[0].creados === 2 && j.cargas[0].quedan === 2 && j.cargas[0].archivo === 'clientes.xlsx', 'Las cargas quedan registradas (quién, cuándo, cuántos)', j.cargas[0]);
  revisa((await pedir('GET', '/clientes-carga', G))[0] === 403, 'El Gerente no ve las cargas');

  console.log('3. Eliminar');
  // A Pedro se le hace una cotización: ya no se elimina.
  const servicio = (await pedir('GET', '/servicios', A))[1][0];
  exigir(await pedir('POST', '/leads', A, { cliente_id: pedro.id, direccion: 'Cocina', canal_id: canal.id, servicio_id: servicio.id, responsable_id: 1, forzar_duplicado: true, partidas_json: JSON.stringify([{ servicio: servicio.nombre, leyenda: 'Prueba', importe: 1000 }]), iva_modo: 'mas_iva', valor: 1000, fecha_cotizacion: HOY }), 'cotización de Pedro');
  [s, j] = await pedir('GET', '/clientes-carga/' + carga, A);
  const pe = j.clientes.find(c => c.id === pedro.id), an = j.clientes.find(c => c.id !== pedro.id);
  revisa(!pe.eliminable && /cotizaciones/.test(pe.tiene) && an.eliminable, 'La lista dice quién se puede eliminar y por qué no', j.clientes);
  revisa((await pedir('POST', '/clientes/' + an.id + '/eliminar', G, {}))[0] === 403, 'El Gerente no elimina clientes');
  [s, j] = await pedir('POST', '/clientes/' + pedro.id + '/eliminar', A, {});
  revisa(s === 409 && /cotizaciones/.test(j.error) && cuenta('SELECT COUNT(*) n FROM clientes WHERE id = ' + pedro.id) === 1, 'Un cliente con cotizaciones no se elimina', j.error);
  [s, j] = await pedir('GET', '/clientes-gestion/buscar?q=Ana', A);
  revisa(s === 200 && j.clientes.some(c => c.id === an.id), 'Se encuentra con el buscador', j.clientes);
  [s] = await pedir('POST', '/clientes/' + an.id + '/eliminar', A, {});
  revisa(s === 200 && cuenta('SELECT COUNT(*) n FROM clientes WHERE id = ' + an.id) === 0 && cuenta("SELECT COUNT(*) n FROM telefonos_cliente WHERE telefono_normalizado = '4425550003'") === 0, 'Un cliente sin registros se elimina con sus teléfonos', s);
  revisa(cuenta(`SELECT COUNT(*) n FROM auditoria WHERE entidad = 'cliente' AND accion = 'eliminado' AND entidad_id = ${an.id}`) === 1, 'Queda en la bitácora');
  [s] = await pedir('POST', '/clientes/' + viejo.id + '/eliminar', A, {});
  revisa(s === 200, 'También se elimina un cliente capturado a mano (sin registros)', s);

  console.log('4. Deshacer una carga');
  [s, j] = await pedir('POST', '/clientes-carga/guardar', A, { filas: [{ nombre: 'Uno Deshacer', telefono: '4425550011' }, { nombre: 'Dos Deshacer', telefono: '4425550012' }] });
  const c2 = j.carga_id;
  [s, j] = await pedir('POST', '/clientes-carga/' + c2 + '/eliminar', A, {});
  revisa(s === 200 && j.eliminados === 2 && !j.quedan.length && cuenta('SELECT COUNT(*) n FROM clientes WHERE carga_id = ' + c2) === 0, 'Deshacer la carga elimina sus clientes sin registros', j);
  [s, j] = await pedir('POST', '/clientes-carga/' + carga + '/eliminar', A, {});
  revisa(s === 200 && j.eliminados === 0 && j.quedan.length === 1, 'Los que ya tienen registros se quedan al deshacer', j);

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
