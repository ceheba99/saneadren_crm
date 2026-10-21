// CREAR = EDITAR: lo que se puede capturar al editar un registro también se puede capturar al crearlo, y se guarda igual.
// Antes, el equipo de la orden (técnico responsable, operadores, ayudantes de Personal) solo se elegía DESPUÉS de guardar
// la orden; al crearla era texto libre. Y el contacto pedía «¿Cómo se enteró?» al crear pero no dejaba corregirlo, y al
// revés con teléfono alterno, RFC y notas. La auditoría total compara los formularios; aquí se prueba con el servidor:
//  · orden nueva con su equipo: se guarda, el responsable con cuenta la ve, queda en el historial;
//  · las mismas reglas que al editar: nadie de otra sucursal, nadie dado de baja, solo en órdenes (no en cotizaciones);
//  · convertir una cotización en orden lleva el equipo; editar sigue igual;
//  · contacto con teléfono alterno, RFC y notas desde el alta; «¿Cómo se enteró?» se corrige después (y queda en la bitácora).
// Uso: node tests/simulacion-crear-editar.cjs   (base temporal; no toca saneadren.db)
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-crear-editar-')); const PUERTO = String(5400 + Math.floor(Math.random() * 300));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Paridad-' + Math.random().toString(36).slice(2) + '-9' };
const CLAVE = 'Paridad-Usuarios-2026';
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'p.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); const texto = await x.text(); let j; try { j = JSON.parse(texto); } catch { j = texto; } return [x.status, j]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  let s, j;
  const [, canales] = await pedir('GET', '/canales', A), [, servicios] = await pedir('GET', '/servicios', A);
  const partidas = JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Desazolve', importe: 5000 }]);
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const [, cdmx] = await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' });
  const T = {}, ID = {};
  for (const [nombre, rol] of [['Gerente Qro', 'gerente'], ['Tecnico Uno', 'tecnico']]) {
    [s, j] = await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [qro.id] }); if (s !== 201) throw new Error(JSON.stringify(j));
    ID[nombre] = j.id; T[nombre] = (await pedir('POST', '/login', null, { nombre, password: CLAVE }))[1].token;
  }
  const G = T['Gerente Qro'], TEC = T['Tecnico Uno'];
  const persona = async (d) => { const [st, p] = await pedir('POST', '/personal', A, d); if (st !== 201) throw new Error('alta de personal: ' + JSON.stringify(p)); return p; };
  const pTec = await persona({ nombre: 'Técnico Uno Pérez', puesto: 'Técnico', usuario_id: ID['Tecnico Uno'], sucursal_id: qro.id });
  const pOp = await persona({ nombre: 'Operador Sin Cuenta', puesto: 'Operador', sucursal_id: qro.id });
  const pAyu = await persona({ nombre: 'Ayudante Martínez', puesto: 'Ayudante', sucursal_id: qro.id });
  const pCdmx = await persona({ nombre: 'Operador De Cdmx', puesto: 'Operador', sucursal_id: cdmx.id });
  const pBaja = await persona({ nombre: 'Operador Ya Se Fue', puesto: 'Operador', sucursal_id: qro.id });
  [s] = await pedir('POST', '/personal/' + pBaja.id + '/baja', A, { motivo: 'Renuncia voluntaria' }); if (s !== 200) throw new Error('baja');

  console.log('1. Contacto: al crear se piden los mismos datos que al editar');
  [s, j] = await pedir('POST', '/contactos', G, { nombre: 'Lic. Paridad Contacto', telefono: '442 311 2201', empresa_contacto: 'Planta Paridad', direccion: 'Querétaro', canal_origen_id: canales[0].id, telefono_alterno: '442 311 2202', rfc: 'ppa010101ab1', notas_generales: 'Entrar por la puerta 3' });
  const cli = j;
  revisa(s === 201 && j.telefono_alterno === '442 311 2202' && j.rfc === 'PPA010101AB1' && j.notas_generales === 'Entrar por la puerta 3', 'alta con teléfono alterno, RFC (en mayúsculas) y notas generales', j);
  [s, j] = await pedir('GET', '/clientes/' + cli.id, G); revisa(s === 200 && j.rfc === 'PPA010101AB1' && j.telefono_alterno === '442 311 2202', 'la ficha los muestra igual que si se hubieran editado', [j.rfc, j.telefono_alterno]);
  const antes = (await pedir('GET', '/clientes?incluir_prospectos=1', G))[1];
  [s, j] = await pedir('POST', '/contactos', G, { nombre: 'Rfc Mal Escrito', telefono: '442 311 2203', canal_origen_id: canales[0].id, rfc: 'ABC' });
  revisa(s === 400, 'un RFC mal escrito al crear se rechaza (no se crea el contacto)', [s, j]);
  revisa((await pedir('GET', '/clientes?incluir_prospectos=1', G))[1].length === antes.length, 'y no quedó ningún contacto a medias', antes.length);
  [s, j] = await pedir('POST', '/contactos', G, { nombre: 'Otro Con Mismo Rfc', telefono: '442 311 2204', canal_origen_id: canales[0].id, rfc: 'PPA010101AB1' });
  revisa(s === 409 && !j.cliente_id, 'el mismo RFC de otro contacto se detecta al crear (igual que al editar)', [s, j]);

  console.log('2. Contacto: «¿Cómo se enteró?» se corrige al editar');
  const otroCanal = canales[1] || canales[0];
  [s, j] = await pedir('PUT', '/clientes/' + cli.id, G, { canal_origen_id: otroCanal.id });
  revisa(s === 200 && j.canal_origen_id === otroCanal.id, `se cambia a «${otroCanal.nombre}»`, j.canal_origen_id);
  [s, j] = await pedir('GET', '/auditoria?entidad=cliente&id=' + cli.id, G);
  revisa(s === 200 && j.some(a => a.accion === 'editado' && /canal_origen_id/.test(a.detalle || '')), 'el cambio queda en la bitácora del contacto', j.map(a => a.detalle));
  for (const [v, que] of [[999999, 'un canal que no existe'], ['abc', 'texto'], [0, 'cero'], [-1, 'negativo'], [null, 'vacío (null)'], ['', 'vacío']]) {
    [s, j] = await pedir('PUT', '/clientes/' + cli.id, G, { canal_origen_id: v }); revisa(s === 400, `se rechaza «cómo se enteró» = ${que}`, [s, j]);
  }
  [s, j] = await pedir('GET', '/clientes/' + cli.id, G); revisa(j.canal_origen_id === otroCanal.id, 'y el que tenía se conserva', j.canal_origen_id);
  [s, j] = await pedir('PUT', '/clientes/' + cli.id, G, { notas_generales: 'Sin tocar el origen' });
  revisa(s === 200 && j.canal_origen_id === otroCanal.id, 'editar otro dato sin mandar el origen no lo borra', j.canal_origen_id);

  console.log('3. Orden de servicio: el equipo se elige al crearla (igual que al editarla)');
  const orden = (extra) => pedir('POST', '/leads', G, { cliente_id: cli.id, direccion: 'Planta', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: ID['Gerente Qro'], partidas_json: partidas, iva_modo: 'mas_iva', valor: 5000, forzar_duplicado: true, ...extra });
  const equipo = [{ personal_id: pTec.id, papel: 'responsable' }, { personal_id: pOp.id, papel: 'operador' }, { personal_id: pAyu.id, papel: 'ayudante' }];
  [s, j] = await orden({ estatus: 'ganado', fecha_servicio: HOY, equipo_personal: equipo, operador: 'Pipa rentada' });
  const os1 = j; revisa(s === 201, 'orden nueva con técnico responsable, operador y ayudante', [s, j]);
  [s, j] = await pedir('GET', '/leads/' + os1.id, G);
  revisa(s === 200 && j.equipo_personal.length === 3 && j.equipo_personal.find(x => x.papel === 'responsable')?.personal_id === pTec.id, 'se guardó el equipo completo, con su responsable', j.equipo_personal);
  revisa(j.tecnico_id === ID['Tecnico Uno'], 'el responsable con cuenta queda como técnico de la orden', j.tecnico_id);
  revisa(j.operador === 'Pipa rentada', 'y el operador externo (texto) también', j.operador);
  revisa((j.historial || []).some(h => /^Equipo: /.test(h.texto || '') && /Técnico Uno Pérez/.test(h.texto)), 'queda en el historial de la orden quién la hace', (j.historial || []).map(h => h.texto));
  [s, j] = await pedir('GET', '/leads/' + os1.id, TEC); revisa(s === 200, 'el técnico responsable ya la ve desde que se crea (sin editarla después)', s);
  [s, j] = await orden({ estatus: 'ganado', fecha_servicio: HOY, equipo_personal: [] });
  const os2 = j; revisa(s === 201, 'orden sin equipo (lista vacía): se crea igual', [s, j]);
  [s, j] = await pedir('GET', '/leads/' + os2.id, G); revisa(j.equipo_personal.length === 0 && !j.tecnico_id, 'y queda sin equipo', j.equipo_personal);

  console.log('4. Las mismas reglas que al editar');
  const cuantas = async () => (await pedir('GET', '/leads', G))[1].length;
  const total = await cuantas();
  for (const [eq, extra, que] of [
    [[{ personal_id: pCdmx.id, papel: 'operador' }], { estatus: 'ganado', fecha_servicio: HOY }, 'alguien de otra sucursal'],
    [[{ personal_id: pBaja.id, papel: 'operador' }], { estatus: 'ganado', fecha_servicio: HOY }, 'alguien dado de baja'],
    [[{ personal_id: 999999, papel: 'operador' }], { estatus: 'ganado', fecha_servicio: HOY }, 'una persona que no existe'],
    [[{ personal_id: pTec.id, papel: 'responsable' }, { personal_id: pOp.id, papel: 'responsable' }], { estatus: 'ganado', fecha_servicio: HOY }, 'dos responsables'],
    [[{ personal_id: pOp.id, papel: 'jefe' }], { estatus: 'ganado', fecha_servicio: HOY }, 'un papel inventado'],
    ['no es lista', { estatus: 'ganado', fecha_servicio: HOY }, 'algo que no es una lista'],
    [equipo, {}, 'equipo en una cotización (todavía no es orden)'],
  ]) { [s, j] = await orden({ ...extra, equipo_personal: eq }); revisa(s === 400, `se rechaza al crear: ${que}`, [s, j]); }
  revisa(await cuantas() === total, 'ninguno de los rechazos dejó una orden o cotización a medias', total);

  console.log('5. Convertir una cotización en orden lleva el equipo; editar sigue igual');
  [s, j] = await orden({}); const cot = j; revisa(s === 201 && cot.estatus === 'abierto', 'cotización nueva', [s, j.estatus]);
  const version = async id => (await pedir('GET', '/leads/' + id, G))[1].version;
  [s, j] = await pedir('PUT', '/leads/' + cot.id, G, { version: await version(cot.id), equipo_personal: equipo });
  revisa(s === 400, 'a una cotización todavía no se le asigna equipo (igual que al crearla)', [s, j]);
  [s, j] = await pedir('PUT', '/leads/' + cot.id, G, { version: await version(cot.id), estatus: 'ganado', fecha_servicio: HOY, equipo_personal: equipo });
  revisa(s === 200 && j.tecnico_id === ID['Tecnico Uno'], 'al convertirla en orden se guarda su equipo', [s, j.tecnico_id, j.error]);
  [s, j] = await pedir('GET', '/leads/' + cot.id, G); revisa(j.equipo_personal.length === 3, 'la orden convertida tiene sus 3 personas', j.equipo_personal);
  [s, j] = await pedir('PUT', '/leads/' + os1.id, G, { version: await version(os1.id), equipo_personal: [{ personal_id: pOp.id, papel: 'responsable' }] });
  revisa(s === 200 && j.tecnico_id === null, 'editar el equipo después sigue funcionando (responsable sin cuenta → sin técnico)', [s, j.tecnico_id]);
  [s, j] = await pedir('GET', '/leads/' + os1.id, TEC); revisa(s === 404, 'y el técnico que ya no está asignado deja de verla', s);

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) { console.log('FALLARON:\n - ' + malos.join('\n - ')); process.exitCode = 1; }
  const errores = salida.split('\n').filter(l => /Error en|no manejado|uncaught/i.test(l));
  if (errores.length) { console.log('Errores del servidor:\n' + errores.slice(0, 5).join('\n')); process.exitCode = 1; }
  srv.kill();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
})().catch(e => { console.error('ERROR', e); console.error(salida.slice(-1500)); srv.kill(); process.exit(1); });
