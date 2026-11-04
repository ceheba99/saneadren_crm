// DESCRIPCIONES GUARDADAS POR CLIENTE (2026-11-04): plantillas de texto con huecos ({sucursal}) para las partidas de las
// cotizaciones y órdenes de un cliente. Caso real: KFC usa siempre la misma descripción y solo cambia la sucursal.
//  · Crean, cambian o quitan solo Dirección y el Gerente de la sucursal del cliente; las usa quien cotiza al cliente.
//  · Quitar = desactivar (nunca se borra) y cada cambio queda en el historial del cliente.
//  · Al juntar dos clientes, sus descripciones pasan al que queda. La descripción llenada respeta el límite de la partida.
// Uso: node tests/simulacion-plantillas-descripcion.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-plantillas-')), DB = path.join(dir, 'sim.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Plantillas-' + Math.random().toString(36).slice(2) + '-7Q' };
const CLAVE = 'Clave-Plantillas-2026x';
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
    ID[nombre.split(' ')[0]] = j.id; T[nombre.split(' ')[0]] = (await pedir('POST', '/login', null, { nombre, password: CLAVE }))[1].token;
  }
  const [, kfc] = await pedir('POST', '/contactos', T.Vale, { nombre: 'Ing. Sofía Mantenimiento', telefono: '442 690 1122', empresa_contacto: 'Operadora KFC', direccion: 'Querétaro', canal_origen_id: canales[0].id });
  const base = '/clientes/' + kfc.id + '/plantillas';

  console.log('Crear (solo Dirección y el Gerente de la sucursal del cliente):');
  [s, j] = await pedir('POST', base, T.Gema, { nombre: 'Mantenimiento KFC', servicio_id: SERV.id, texto: KFC });
  revisa(s === 201 && j.huecos?.length === 1 && j.huecos[0] === 'sucursal' && j.servicio_nombre === SERV.nombre, 'el Gerente de Querétaro guarda la descripción de KFC con su hueco {sucursal}', [s, j]);
  const P = j;
  [s, j] = await pedir('POST', base, A, { texto: 'Servicio de {equipo} en {sucursal} con {equipo}' });
  revisa(s === 201 && JSON.stringify(j.huecos) === '["equipo","sucursal"]' && j.nombre === '', 'Dirección también; los huecos salen sin repetir y en orden', j);
  const P2 = j;
  for (const [quien, k] of [['Ventas', 'Vale'], ['Atención', 'Ana'], ['Técnico', 'Tito'], ['Compras', 'Coco'], ['el Gerente de otra sucursal', 'Gino'], ['Ventas de otra sucursal', 'Diego']]) {
    [s] = await pedir('POST', base, T[k], { texto: 'Intento {x}' });
    revisa([403, 404].includes(s), quien + ' no crea descripciones', s);
    [s] = await pedir('PUT', base + '/' + P.id, T[k], { texto: 'Cambiada {x}' });
    revisa([403, 404].includes(s), quien + ' no las cambia', s);
    [s] = await pedir('POST', base + '/' + P.id + '/desactivar', T[k], {});
    revisa([403, 404].includes(s), quien + ' no las quita', s);
  }
  [s] = await pedir('POST', base, A, { texto: 'Viendo como ventas {x}' }, { 'X-Ver-Como': 'ventas' });
  revisa([403, 404].includes(s), 'Dirección «viendo como Ventas» no guarda nada', s);

  console.log('Usar (quien cotiza al cliente):');
  for (const [quien, k] of [['Ventas', 'Vale'], ['Atención', 'Ana'], ['el Gerente', 'Gema']]) {
    [s, j] = await pedir('GET', base, T[k]);
    revisa(s === 200 && j.plantillas.some(p => p.id === P.id && p.texto === KFC), quien + ' ve la descripción de KFC para usarla', [s, j]);
    revisa(j.puede_editar === (k === 'Gema'), quien + (k === 'Gema' ? ' puede cambiarlas' : ' ve que no puede cambiarlas'), j.puede_editar);
  }
  for (const [quien, k] of [['Técnico', 'Tito'], ['Compras', 'Coco']]) {
    [s] = await pedir('GET', base, T[k]);
    revisa([403, 404].includes(s), quien + ' no las ve (no cotiza)', s);
  }
  [s] = await pedir('GET', base, T.Diego);
  revisa([403, 404].includes(s), 'Ventas de otra sucursal que no ha trabajado con el cliente no lo ve', s);

  console.log('Validaciones:');
  for (const [cuerpo, que] of [[{ texto: '' }, 'texto vacío'], [{ texto: '   ' }, 'solo espacios'], [{ texto: 'Hueco vacío {}' }, 'hueco vacío «{}»'], [{ texto: 'x'.repeat(10001) }, 'más de 10,000 caracteres (el límite de la partida)'],
    [{ texto: 'Ok {a}', servicio_id: 999999 }, 'servicio que no existe'], [{ texto: 'Ok {a}', nombre: 'n'.repeat(81) }, 'nombre de más de 80'], [{ texto: { a: 1 } }, 'texto que no es texto'], [{ texto: 'Ok', nombre: ['x'] }, 'nombre que no es texto'],
    [{ texto: Array.from({ length: 11 }, (_, i) => '{h' + i + '}').join(' ') }, 'más de 10 huecos']]) {
    [s, j] = await pedir('POST', base, T.Gema, cuerpo);
    revisa(s === 400 && j.error, 'rechaza ' + que, [s, j]);
  }
  [s] = await pedir('POST', '/clientes/999999/plantillas', A, { texto: 'X' });
  revisa(s === 404, 'cliente inexistente: 404', s);

  console.log('Llenar la partida con la descripción (la pantalla reemplaza los huecos):');
  const leyenda = KFC.replace('{sucursal}', 'PUERTA LA VICTORIA');
  [s, j] = await pedir('POST', '/leads', T.Vale, { cliente_id: kfc.id, direccion: 'Querétaro', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: ID.Vale, forzar_duplicado: true,
    partidas_json: JSON.stringify([{ servicio: SERV.nombre, leyenda, importe: 4800 }]), iva_modo: 'mas_iva', valor: 4800 });
  const cot = j;
  revisa(s === 201 || s === 200, 'Ventas crea la cotización de KFC', [s, j]);
  [s, j] = await pedir('GET', '/leads/' + cot.id, T.Vale);
  revisa(s === 200 && JSON.parse(j.partidas_json)[0].leyenda === leyenda, 'la cotización de KFC Puerta La Victoria se guarda con la descripción llenada', [s, j.partidas_json]);
  [s] = await pedir('POST', '/leads', T.Vale, { cliente_id: kfc.id, direccion: 'Querétaro', canal_id: canales[0].id, servicio_id: SERV.id, forzar_duplicado: true,
    partidas_json: JSON.stringify([{ servicio: SERV.nombre, leyenda: 'x'.repeat(10001), importe: 1 }]), iva_modo: 'mas_iva', valor: 1 });
  revisa(s === 400, 'la validación de la partida sigue igual (más de 10,000 caracteres se rechaza)', s);
  const { huecosDe } = require('../server/plantillas-descripcion.js');
  revisa(JSON.stringify(huecosDe('A {sucursal} B { ciudad } {sucursal} {}')) === '["sucursal","ciudad"]', 'huecosDe: quita espacios, no repite e ignora «{}»');

  console.log('Cambiar, quitar y volver a usar (nunca se borra):');
  [s, j] = await pedir('PUT', base + '/' + P.id, T.Gema, { texto: KFC + ' {ciudad}' });
  revisa(s === 200 && j.huecos.join() === 'sucursal,ciudad', 'el Gerente cambia el texto y aparecen los huecos nuevos', [s, j]);
  [s, j] = await pedir('PUT', base + '/' + P.id, T.Gema, { texto: KFC + ' {ciudad}' });
  revisa(s === 400, 'sin cambios: no hace nada', [s, j]);
  [s, j] = await pedir('PUT', base + '/' + P.id, T.Gema, { servicio_id: null, nombre: '' });
  revisa(s === 200 && j.servicio_id === null && j.nombre === '' && j.texto === KFC + ' {ciudad}', 'se le puede quitar el servicio y el nombre sin tocar el texto', j);
  [s, j] = await pedir('POST', base + '/' + P2.id + '/desactivar', T.Gema, {});
  revisa(s === 200 && j.activo === false, 'el Gerente quita una descripción', [s, j]);
  [s, j] = await pedir('GET', base, T.Vale);
  revisa(!j.plantillas.some(p => p.id === P2.id), 'la quitada ya no sale al capturar partidas', j);
  [s, j] = await pedir('GET', base + '?todas=1', T.Vale);
  revisa(!j.plantillas.some(p => p.id === P2.id), 'Ventas no ve las quitadas aunque las pida', j);
  [s, j] = await pedir('GET', base + '?todas=1', T.Gema);
  revisa(j.plantillas.some(p => p.id === P2.id && !p.activo), 'el Gerente sí las ve, para reactivarlas', j);
  [s] = await pedir('PUT', base + '/' + P2.id, T.Gema, { texto: 'Otra cosa' });
  revisa(s === 409, 'una quitada no se cambia sin reactivarla', s);
  [s] = await pedir('POST', base + '/' + P2.id + '/desactivar', T.Gema, {});
  revisa(s === 409, 'quitarla dos veces avisa', s);
  [s] = await pedir('DELETE', base + '/' + P2.id, A);
  revisa(s === 404 || s === 405, 'no hay ruta para borrar', s);
  [s, j] = await pedir('POST', base + '/' + P2.id + '/reactivar', A, {});
  revisa(s === 200 && j.activo === true, 'Dirección la vuelve a activar', j);
  { const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(DB);
    revisa(d.prepare('SELECT COUNT(*) n FROM plantillas_descripcion WHERE cliente_id = ?').get(kfc.id).n === 2, 'en la base siguen las dos (nada se borró)');
    revisa(d.prepare("SELECT COUNT(*) n FROM auditoria WHERE entidad = 'cliente' AND entidad_id = ? AND detalle LIKE 'Descripción guardada%'").get(kfc.id).n >= 6, 'cada alta, cambio, quitar y reactivar quedó en la bitácora del cliente'); d.close(); }
  [s, j] = await pedir('GET', '/clientes/' + kfc.id + '/movimientos', T.Vale);
  revisa(JSON.stringify(j).includes('Descripción guardada') && JSON.stringify(j).includes('quitada'), 'y se ve en el historial completo del cliente', JSON.stringify(j).slice(0, 300));
  [s, j] = await pedir('POST', '/clientes/' + kfc.id + '/plantillas/' + P.id + '/desactivar', T.Gino, {});
  revisa([403, 404].includes(s), 'el Gerente de otra sucursal no quita las de un cliente de Querétaro', s);

  console.log('Juntar clientes:');
  const [, otro] = await pedir('POST', '/contactos', T.Vale, { nombre: 'KFC duplicado', telefono: '442 690 1199', direccion: 'Querétaro', canal_origen_id: canales[0].id });
  [s, j] = await pedir('POST', '/clientes/' + otro.id + '/plantillas', A, { texto: 'Del duplicado {sucursal}' });
  const P3 = j;
  [s, j] = await pedir('POST', '/clientes/' + otro.id + '/fusionar', A, { con: kfc.id });
  revisa(s === 200, 'Dirección junta el duplicado con KFC', [s, j]);
  [s, j] = await pedir('GET', base, A);
  revisa(j.plantillas?.some(p => p.id === P3.id), 'la descripción del duplicado pasa a KFC', j);

  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 5));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
