// LISTAS DE LOS SERVICIOS (2026-11-05). Caso real: «RETIRO, TRANSPORTE Y DISPOSICION DE 4M3 DE AGUA RESIDUAL…» se usa
// igual en varias cotizaciones y solo cambia el volumen; lo mismo KFC con la sucursal. Decidido con Dirección:
//  · La descripción del servicio lleva la parte que cambia entre corchetes ([VOLUMEN]) y cada parte tiene su lista.
//  · Al capturar se elige de la lista; sin elegir no se guarda, y lo elegido debe estar en la lista.
//  · Las listas (y poner o quitar [PARTES] en la descripción) las cambia solo Dirección; ni el Gerente.
//  · Quitar = desactivar (nunca se borra) y queda en la bitácora.
// Uso: node tests/simulacion-listas-servicio.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-listas-serv-')), DB = path.join(dir, 'sim.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'ListasServ-' + Math.random().toString(36).slice(2) + '-7Q' };
const CLAVE = 'Clave-ListasServ-2026x';
const PUERTO = String(9850 + Math.floor(Math.random() * 120)), URL = 'http://localhost:' + PUERTO + '/api';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b, extra = {}) => {
  const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : JSON.stringify(b) });
  let j = {}; try { j = await x.json(); } catch { /* */ } return [x.status, j];
};
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); } else console.log('  ✔ ' + texto); };
const AGUA = 'RETIRO, TRANSPORTE Y DISPOSICION DE [VOLUMEN] DE AGUA RESIDUAL CON EQUIPO VACTOR PARA ESTE SERVICIO SE CONSIDERA LA ENTREGA DE MANIFIESTO POR DISPOSICION FINAL.';
const con = v => AGUA.replace('[VOLUMEN]', v);

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }))[1].token;
  let s, j;
  const [, canales] = await pedir('GET', '/canales', A), [, servicios] = await pedir('GET', '/servicios', A);
  const SERV = servicios[0], OTRO = servicios[1];
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const T = {}, ID = {};
  for (const [nombre, rol] of [['Gema Gerente', 'gerente'], ['Vale Ventas', 'ventas'], ['Ana Atencion', 'atencion'], ['Tito Tecnico', 'tecnico'], ['Coco Costos', 'costos']]) {
    [s, j] = await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [qro.id] });
    const k = nombre.split(' ')[0]; ID[k] = j.id; T[k] = (await pedir('POST', '/login', null, { nombre, password: CLAVE }))[1].token;
  }
  const base = '/servicios/' + SERV.id + '/listas';

  console.log('La parte que cambia en la descripción ([VOLUMEN]): solo Dirección la pone o la quita:');
  [s, j] = await pedir('PUT', '/servicios/' + SERV.id, T.Gema, { descripcion: AGUA });
  revisa(s === 403 && /Dirección/.test(j.error), 'el Gerente no puede poner [VOLUMEN] en la descripción', [s, j]);
  [s, j] = await pedir('PUT', '/servicios/' + SERV.id, A, { descripcion: AGUA });
  revisa(s === 200 && j.descripcion === AGUA, 'Dirección guarda la descripción con [VOLUMEN]', [s, j]);
  [s, j] = await pedir('PUT', '/servicios/' + SERV.id, T.Gema, { descripcion: AGUA.replace('AGUA RESIDUAL', 'AGUAS RESIDUALES') });
  revisa(s === 200, 'el Gerente sí cambia el resto del texto (sin tocar [VOLUMEN])', [s, j]);
  [s] = await pedir('PUT', '/servicios/' + SERV.id, T.Coco, { descripcion: 'SIN VOLUMEN' });
  revisa(s === 403, 'Compras tampoco quita [VOLUMEN] de la descripción', s);
  [s] = await pedir('PUT', '/servicios/' + SERV.id, A, { descripcion: AGUA });

  console.log('Cargar la lista (solo Dirección):');
  const VOL = {};
  for (const v of ['4M3', ' 8M3 ', '10M3']) { [s, j] = await pedir('POST', base, A, { marca: 'VOLUMEN', valor: v }); VOL[v.trim()] = j; revisa(s === 201 && j.valor === v.trim() && j.activo, 'Dirección agrega «' + v.trim() + '»', [s, j]); }
  [s, j] = await pedir('POST', base, A, { marca: 'VOLUMEN', valor: '8m3' });
  revisa(s === 409, 'no se repite una opción (sin importar mayúsculas)', [s, j]);
  [s, j] = await pedir('POST', base, A, { marca: 'volumen', valor: '12M3' });
  revisa(s === 400, 'la parte se escribe en mayúsculas', [s, j]);
  [s, j] = await pedir('POST', base, A, { marca: 'VOLUMEN', valor: '[X]' });
  revisa(s === 400, 'una opción no puede llevar corchetes', [s, j]);
  [s, j] = await pedir('POST', base, A, { marca: 'VOLUMEN', valor: 'x'.repeat(81) });
  revisa(s === 400, 'una opción de más de 80 caracteres se rechaza', s);
  [s] = await pedir('POST', '/servicios/999999/listas', A, { marca: 'VOLUMEN', valor: '4M3' });
  revisa(s === 404, 'un servicio que no existe: 404', s);
  for (const [quien, k] of [['el Gerente', 'Gema'], ['Ventas', 'Vale'], ['Atención', 'Ana'], ['Técnico', 'Tito'], ['Compras', 'Coco']]) {
    [s] = await pedir('POST', base, T[k], { marca: 'VOLUMEN', valor: '20M3 ' + k });
    revisa(s === 403, quien + ' no agrega opciones', s);
    [s] = await pedir('POST', base + '/' + VOL['4M3'].id + '/desactivar', T[k], {});
    revisa(s === 403, quien + ' no quita opciones', s);
  }
  [s, j] = await pedir('GET', '/servicios/listas', T.Vale);
  revisa(s === 200 && j.puede_editar === false && j.listas[SERV.id]?.VOLUMEN?.map(x => x.valor).join() === '4M3,8M3,10M3', 'quien cotiza lee la lista (sin poder cambiarla)', [s, j]);
  [s, j] = await pedir('GET', '/servicios/listas', A);
  revisa(j.puede_editar === true, 'Dirección la ve como editable', j);

  console.log('Capturar partidas: se elige de la lista:');
  const partida = (leyenda, extra) => JSON.stringify([{ servicio: SERV.nombre, leyenda, cantidad: 1, precio: 4800, importe: 4800, ...extra }]);
  const cotizar = async (t, partidas) => pedir('POST', '/leads', t, { nombre: 'Planta Norte', telefono: '442 111 2233', direccion: 'Querétaro', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: ID.Vale, forzar_duplicado: true, partidas_json: partidas, iva_modo: 'mas_iva', valor: 4800 });
  [s, j] = await cotizar(T.Vale, partida(AGUA));
  revisa(s === 400 && /VOLUMEN/.test(j.error), 'con [VOLUMEN] sin elegir no se guarda, y dice cuál falta', [s, j]);
  [s, j] = await cotizar(T.Vale, partida(con('8M3'), { opciones: { VOLUMEN: '8M3' } }));
  revisa(s === 201 || s === 200, 'Ventas guarda con 8M3 elegido de la lista', [s, j]);
  [s, j] = await pedir('GET', '/leads/' + j.id, T.Vale);
  const p0 = JSON.parse(j.partidas_json || '[]')[0] || {};
  revisa(p0.leyenda === con('8M3') && p0.opciones?.VOLUMEN === '8M3' && p0.cantidad === 1, 'se guarda el texto con 8M3 y lo elegido (para reabrirla)', p0);
  [s, j] = await cotizar(T.Vale, partida(con('7M3'), { opciones: { VOLUMEN: '7M3' } }));
  revisa(s === 400 && /no está en la lista/.test(j.error), 'una opción que no está en la lista se rechaza', [s, j]);
  [s, j] = await cotizar(T.Vale, partida(con('8M3'), { opciones: { SUCURSAL: '8M3' } }));
  revisa(s === 400, 'una parte que el servicio no tiene se rechaza', [s, j]);
  [s, j] = await cotizar(T.Vale, partida(con('8M3'), { opciones: ['8M3'] }));
  revisa(s === 400, 'opciones con forma rara se rechazan', [s, j]);
  [s, j] = await cotizar(T.Vale, JSON.stringify([{ servicio: OTRO.nombre, leyenda: 'TEXTO CON [CORCHETES] SIN LISTA', importe: 100 }]));
  revisa(s === 201 || s === 200, 'corchetes de un servicio sin lista no estorban (texto normal)', [s, j]);
  [s, j] = await cotizar(T.Vale, partida('Texto libre sin volumen'));
  revisa(s === 201 || s === 200, 'una partida con otro texto (sin [VOLUMEN]) se guarda como antes', [s, j]);

  console.log('Quitar y volver a activar (nunca se borra):');
  [s, j] = await pedir('POST', base + '/' + VOL['8M3'].id + '/desactivar', A, {});
  revisa(s === 200 && j.activo === false, 'Dirección quita «8M3»', [s, j]);
  [s, j] = await pedir('GET', '/servicios/listas', T.Vale);
  revisa(j.listas[SERV.id].VOLUMEN.map(x => x.valor).join() === '4M3,10M3', 'ya no sale en la lista para cotizar', j);
  [s, j] = await pedir('GET', '/servicios/listas?todas=1', A);
  revisa(j.listas[SERV.id].VOLUMEN.some(x => x.valor === '8M3' && !x.activo), 'Dirección la ve entre las quitadas', j);
  [s, j] = await cotizar(T.Vale, partida(con('8M3'), { opciones: { VOLUMEN: '8M3' } }));
  revisa(s === 201 || s === 200, 'una orden que ya traía 8M3 se puede volver a guardar', [s, j]);
  [s] = await pedir('POST', base + '/' + VOL['8M3'].id + '/desactivar', A, {});
  revisa(s === 409, 'quitarla dos veces: avisa', s);
  [s, j] = await pedir('POST', base + '/' + VOL['8M3'].id + '/reactivar', A, {});
  revisa(s === 200 && j.activo === true, 'Dirección la vuelve a activar', [s, j]);
  [s] = await pedir('DELETE', base + '/' + VOL['8M3'].id, A);
  revisa(s === 404 || s === 405, 'no hay ruta para borrar', s);
  // Si se quitan todas las opciones, [VOLUMEN] ya no es una parte con lista: no se exige elegir.
  for (const v of ['4M3', '8M3', '10M3']) await pedir('POST', base + '/' + VOL[v].id + '/desactivar', A, {});
  [s, j] = await cotizar(T.Vale, partida(AGUA));
  revisa(s === 201 || s === 200, 'sin opciones activas, [VOLUMEN] queda como texto', [s, j]);
  { const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(DB);
    revisa(d.prepare('SELECT COUNT(*) n FROM servicio_listas WHERE servicio_id = ?').get(SERV.id).n === 3, 'en la base siguen todas (nada se borró)');
    revisa(d.prepare("SELECT COUNT(*) n FROM auditoria WHERE entidad = 'catalogo' AND entidad_id = ? AND detalle LIKE 'Lista [VOLUMEN]%'").get(SERV.id).n >= 8, 'cada alta, quitar y reactivar quedó en la bitácora');
    for (const t of ['cliente_sucursales', 'plantillas_descripcion']) revisa(!!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t), 'la tabla retirada ' + t + ' se conserva (migraciones aditivas)');
    d.close(); }

  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 5));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
