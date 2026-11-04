// SUCURSALES DEL CLIENTE, HUECOS EN LA DESCRIPCIÓN DEL SERVICIO Y UNIDAD DE CADA PARTIDA (2026-11-04).
// Caso real: KFC usa siempre la misma descripción y solo cambia la sucursal. Decidido con Dirección:
//  · La descripción con huecos ({sucursal}) vive en el servicio del catálogo; el cliente guarda su lista de sucursales.
//  · Agregan, cambian o quitan sucursales del cliente solo Dirección y el Gerente de su sucursal; las usa quien cotiza.
//  · Quitar = desactivar (nunca se borra) y queda en el historial del cliente. Al juntar clientes pasan al que queda.
//  · Una partida no se guarda con huecos sin llenar. La unidad de medida (m³, metro…) va junto a la cantidad.
// Uso: node tests/simulacion-sucursales-cliente.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-suc-cliente-')), DB = path.join(dir, 'sim.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'SucCliente-' + Math.random().toString(36).slice(2) + '-7Q' };
const CLAVE = 'Clave-SucCliente-2026x';
const PUERTO = String(9700 + Math.floor(Math.random() * 150)), URL = 'http://localhost:' + PUERTO + '/api';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b, extra = {}) => {
  const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : JSON.stringify(b) });
  let j = {}; try { j = await x.json(); } catch { /* */ } return [x.status, j];
};
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); } else console.log('  ✔ ' + texto); };
const KFC = 'DESTAPAR, SONDEAR Y DESAZOLVAR RED DE DRENAJE GENERAL INTERNO. LIMPIEZA Y DESAZOLVE DE TRAMPAS DE GRASA INTERNAS Y EXTERNAS. KFC {sucursal}';

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }))[1].token;
  let s, j;
  const [, canales] = await pedir('GET', '/canales', A), [, servicios] = await pedir('GET', '/servicios', A);
  const SERV = servicios.find(x => /trampas/i.test(x.nombre)) || servicios[0];
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const [, cdmx] = await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' });
  const T = {}, ID = {};
  for (const [nombre, rol, suc] of [['Gema Gerente', 'gerente', qro.id], ['Gino Gerente', 'gerente', cdmx.id], ['Vale Ventas', 'ventas', qro.id], ['Ana Atencion', 'atencion', qro.id],
    ['Tito Tecnico', 'tecnico', qro.id], ['Coco Costos', 'costos', qro.id], ['Diego Ventas', 'ventas', cdmx.id]]) {
    [s, j] = await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [suc] });
    const k = nombre.split(' ')[0]; ID[k] = j.id; T[k] = (await pedir('POST', '/login', null, { nombre, password: CLAVE }))[1].token;
  }
  const [, kfc] = await pedir('POST', '/contactos', T.Vale, { nombre: 'Ing. Sofía Mantenimiento', telefono: '442 690 1122', empresa_contacto: 'Operadora KFC', direccion: 'Querétaro', canal_origen_id: canales[0].id });
  const base = '/clientes/' + kfc.id + '/sucursales';

  console.log('Descripción con hueco en el servicio del catálogo:');
  [s, j] = await pedir('PUT', '/servicios/' + SERV.id, T.Gema, { descripcion: KFC });
  revisa(s === 200 && j.descripcion === KFC, 'el Gerente (catálogos) guarda en el servicio la descripción con {sucursal}', [s, j]);
  [s] = await pedir('PUT', '/servicios/' + SERV.id, T.Vale, { descripcion: 'Otra' });
  revisa(s === 403, 'Ventas no cambia la descripción del catálogo', s);

  console.log('Sucursales del cliente: agregar (solo Dirección y el Gerente de su sucursal):');
  [s, j] = await pedir('POST', base, T.Gema, { nombre: '  Puerta   La Victoria ', direccion: 'Av. Constituyentes 40' });
  revisa(s === 201 && j.nombre === 'Puerta La Victoria' && j.direccion === 'Av. Constituyentes 40' && j.activo, 'el Gerente de Querétaro agrega «Puerta La Victoria» (limpia espacios)', [s, j]);
  const PV = j;
  [s, j] = await pedir('POST', base, A, { nombre: 'Juriquilla' });
  revisa(s === 201 && j.direccion === '', 'Dirección también (la dirección es opcional)', [s, j]);
  const JUR = j;
  for (const [quien, k] of [['Ventas', 'Vale'], ['Atención', 'Ana'], ['Técnico', 'Tito'], ['Compras', 'Coco'], ['el Gerente de otra sucursal', 'Gino'], ['Ventas de otra sucursal', 'Diego']]) {
    [s] = await pedir('POST', base, T[k], { nombre: 'Intento ' + k });
    revisa([403, 404].includes(s), quien + ' no agrega sucursales al cliente', s);
    [s] = await pedir('PUT', base + '/' + PV.id, T[k], { nombre: 'Cambiada ' + k });
    revisa([403, 404].includes(s), quien + ' no las cambia', s);
    [s] = await pedir('POST', base + '/' + PV.id + '/desactivar', T[k], {});
    revisa([403, 404].includes(s), quien + ' no las quita', s);
  }
  [s] = await pedir('POST', base, A, { nombre: 'Viendo como ventas' }, { 'X-Ver-Como': 'ventas' });
  revisa([403, 404].includes(s), 'Dirección «viendo como Ventas» no guarda nada', s);

  console.log('Quién las ve (para elegirlas al cotizar):');
  for (const [quien, k] of [['Ventas', 'Vale'], ['Atención', 'Ana'], ['el Gerente', 'Gema']]) {
    [s, j] = await pedir('GET', base, T[k]);
    revisa(s === 200 && j.sucursales.map(x => x.nombre).join() === 'Juriquilla,Puerta La Victoria', quien + ' ve la lista, en orden alfabético', [s, j]);
    revisa(j.puede_editar === (k === 'Gema'), quien + (k === 'Gema' ? ' puede cambiarlas' : ' ve que no puede cambiarlas'), j.puede_editar);
  }
  for (const [quien, k] of [['Técnico', 'Tito'], ['Compras', 'Coco'], ['Ventas de otra sucursal (no ve al cliente)', 'Diego']]) {
    [s] = await pedir('GET', base, T[k]);
    revisa([403, 404].includes(s), quien + ': no las ve', s);
  }

  console.log('Validaciones:');
  for (const [cuerpo, que, cod = 400] of [[{ nombre: '' }, 'nombre vacío'], [{ nombre: '   ' }, 'solo espacios'], [{ nombre: 'n'.repeat(81) }, 'nombre de más de 80'], [{ nombre: 'KFC {x}' }, 'nombre con llaves'],
    [{ nombre: { a: 1 } }, 'nombre que no es texto'], [{ nombre: 'Zaragoza', direccion: ['x'] }, 'dirección que no es texto'], [{ nombre: 'Zaragoza', direccion: 'd'.repeat(251) }, 'dirección de más de 250'],
    [{ nombre: 'puerta la victoria' }, 'repetida (sin importar mayúsculas)', 409], [{ nombre: 'JURÍQUILLA' }, 'repetida (sin importar acentos)', 409]]) {
    [s, j] = await pedir('POST', base, T.Gema, cuerpo);
    revisa(s === cod && j.error, 'rechaza ' + que, [s, j]);
  }
  [s] = await pedir('POST', '/clientes/999999/sucursales', A, { nombre: 'X' });
  revisa(s === 404, 'cliente inexistente: 404', s);
  [s] = await pedir('GET', '/clientes/' + kfc.id + '/plantillas', A);
  revisa(s === 404, 'las «descripciones guardadas por cliente» ya no tienen ruta (se reemplazaron)', s);

  console.log('Partidas: huecos y unidad de medida:');
  const partida = extra => JSON.stringify([{ servicio: SERV.nombre, leyenda: KFC.replace('{sucursal}', 'PUERTA LA VICTORIA'), cantidad: 3, precio: 1600, importe: 4800, ...extra }]);
  const cotizar = async (t, partidas) => pedir('POST', '/leads', t, { cliente_id: kfc.id, direccion: 'Querétaro', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: ID.Vale, forzar_duplicado: true, partidas_json: partidas, iva_modo: 'mas_iva', valor: 4800 });
  [s, j] = await cotizar(T.Vale, JSON.stringify([{ servicio: SERV.nombre, leyenda: KFC, importe: 4800 }]));
  revisa(s === 400 && /\{sucursal\}/.test(j.error), 'con el hueco {sucursal} sin llenar no se guarda, y dice cuál falta', [s, j]);
  [s, j] = await cotizar(T.Vale, partida({ unidad: 'm3' }));
  revisa(s === 201 || s === 200, 'Ventas guarda la cotización de KFC Puerta La Victoria, 3 m³', [s, j]);
  const cot = j;
  [s, j] = await pedir('GET', '/leads/' + cot.id, T.Vale);
  const p0 = JSON.parse(j.partidas_json || '[]')[0] || {};
  revisa(p0.leyenda === KFC.replace('{sucursal}', 'PUERTA LA VICTORIA') && p0.unidad === 'M3' && p0.cantidad === 3 && p0.importe === 4800, 'se guarda la descripción llenada y la unidad con su clave del catálogo (M3)', p0);
  [s, j] = await cotizar(T.Vale, partida({ unidad: 'NOEXISTE' }));
  revisa(s === 400 && /unidad/i.test(j.error), 'una unidad que no está en el catálogo se rechaza', [s, j]);
  [s, j] = await cotizar(T.Vale, partida({ unidad: '' }));
  revisa(s === 201 || s === 200, 'la unidad es opcional', [s, j]);
  [s, j] = await pedir('GET', '/leads/' + j.id, T.Vale);
  revisa(!('unidad' in (JSON.parse(j.partidas_json)[0])), 'sin unidad no se guarda el campo vacío', j.partidas_json);
  [s] = await cotizar(T.Vale, JSON.stringify([{ servicio: SERV.nombre, leyenda: 'x'.repeat(10001), importe: 1 }]));
  revisa(s === 400, 'el límite de la descripción sigue igual (más de 10,000 caracteres se rechaza)', s);
  [s, j] = await pedir('GET', '/compras/unidades', T.Vale);
  revisa(s === 200 && j.some(u => u.clave === 'M3'), 'quien cotiza puede leer el catálogo de unidades', [s, Array.isArray(j) ? j.length : j]);

  console.log('Cambiar, quitar y volver a usar (nunca se borra):');
  [s, j] = await pedir('PUT', base + '/' + PV.id, T.Gema, { direccion: 'Av. Constituyentes 42' });
  revisa(s === 200 && j.direccion === 'Av. Constituyentes 42' && j.nombre === 'Puerta La Victoria', 'el Gerente corrige la dirección', [s, j]);
  [s] = await pedir('PUT', base + '/' + PV.id, T.Gema, { direccion: 'Av. Constituyentes 42' });
  revisa(s === 400, 'sin cambios: no hace nada', s);
  [s] = await pedir('PUT', base + '/' + PV.id, T.Gema, { nombre: 'juriquilla' });
  revisa(s === 409, 'no se puede renombrar igual que otra', s);
  [s, j] = await pedir('POST', base + '/' + JUR.id + '/desactivar', T.Gema, {});
  revisa(s === 200 && j.activo === false, 'el Gerente quita Juriquilla', [s, j]);
  [s, j] = await pedir('GET', base + '?todas=1', T.Vale);
  revisa(!j.sucursales.some(x => x.id === JUR.id), 'la quitada ya no sale para elegir (Ventas no ve las quitadas aunque las pida)', j);
  [s, j] = await pedir('GET', base + '?todas=1', T.Gema);
  revisa(j.sucursales.some(x => x.id === JUR.id && !x.activo), 'el Gerente sí la ve, para volver a usarla', j);
  [s] = await pedir('PUT', base + '/' + JUR.id, T.Gema, { nombre: 'Otra' });
  revisa(s === 409, 'una quitada no se cambia sin reactivarla', s);
  [s, j] = await pedir('POST', base, T.Gema, { nombre: 'Juriquilla' });
  revisa(s === 201, 'se puede agregar otra con el nombre de una quitada', [s, j]);
  [s] = await pedir('POST', base + '/' + JUR.id + '/reactivar', A, {});
  revisa(s === 409, 'y entonces la quitada no se reactiva (quedarían dos iguales)', s);
  [s] = await pedir('POST', base + '/' + j.id + '/desactivar', A, {});
  [s, j] = await pedir('POST', base + '/' + JUR.id + '/reactivar', A, {});
  revisa(s === 200 && j.activo === true, 'Dirección la vuelve a activar', [s, j]);
  [s] = await pedir('DELETE', base + '/' + JUR.id, A);
  revisa(s === 404 || s === 405, 'no hay ruta para borrar', s);
  { const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(DB);
    revisa(d.prepare('SELECT COUNT(*) n FROM cliente_sucursales WHERE cliente_id = ?').get(kfc.id).n === 3, 'en la base siguen todas (nada se borró)');
    revisa(d.prepare("SELECT COUNT(*) n FROM auditoria WHERE entidad = 'cliente' AND entidad_id = ? AND detalle LIKE 'Sucursal del cliente%'").get(kfc.id).n >= 7, 'cada alta, cambio, quitar y reactivar quedó en la bitácora del cliente');
    revisa(!!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plantillas_descripcion'").get(), 'la tabla de las descripciones por cliente se conserva (migraciones aditivas)'); d.close(); }
  [s, j] = await pedir('GET', '/clientes/' + kfc.id + '/movimientos', T.Vale);
  revisa(JSON.stringify(j).includes('Sucursal del cliente') && JSON.stringify(j).includes('quitada'), 'y se ve en el historial completo del cliente', JSON.stringify(j).slice(0, 300));

  console.log('Juntar clientes:');
  const [, otro] = await pedir('POST', '/contactos', T.Vale, { nombre: 'KFC duplicado', telefono: '442 690 1199', direccion: 'Querétaro', canal_origen_id: canales[0].id });
  [s, j] = await pedir('POST', '/clientes/' + otro.id + '/sucursales', A, { nombre: 'Zaragoza' });
  const ZAR = j;
  [s, j] = await pedir('POST', '/clientes/' + otro.id + '/fusionar', A, { con: kfc.id });
  revisa(s === 200, 'Dirección junta el duplicado con KFC', [s, j]);
  [s, j] = await pedir('GET', base, A);
  revisa(j.sucursales?.some(x => x.id === ZAR.id), 'la sucursal del duplicado pasa a KFC', j);

  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 5));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
