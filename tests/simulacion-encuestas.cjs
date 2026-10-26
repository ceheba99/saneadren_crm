// ENCUESTA DE SATISFACCIÓN (2026-10-26): enlace único por orden, página pública sin sesión, una sola respuesta, avisos
// solo para Dirección, el gerente y el responsable de la orden, y el reporte de Panorama.
// Uso: node tests/simulacion-encuestas.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-encuestas-')), DB = path.join(dir, 'sim.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Encuesta-' + Math.random().toString(36).slice(2) + '-9Q' };
const CLAVE = 'Clave-Encuesta-2026x';
const PUERTO = String(9300 + Math.floor(Math.random() * 200)), BASE = 'http://localhost:' + PUERTO, URL = BASE + '/api';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: BASE, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => {
  const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }))[1].token;
  let s, j, texto;
  const [, canales] = await pedir('GET', '/canales', A), [, servicios] = await pedir('GET', '/servicios', A);
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const T = {}, ID = {};
  for (const [nombre, rol] of [['Valeria Ventas', 'ventas'], ['Gema Gerente', 'gerente'], ['Alicia Atencion', 'atencion'], ['Tomas Tecnico', 'tecnico']]) {
    [s, j] = await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [qro.id] });
    const k = nombre.split(' ')[0]; ID[k] = j.id; T[k] = (await pedir('POST', '/login', null, { nombre, password: CLAVE }))[1].token;
  }
  [, j] = await pedir('POST', '/contactos', T.Valeria, { nombre: 'Ing. Encuesta', telefono: '442 333 0001', empresa_contacto: 'Planta Zafiro', direccion: 'Querétaro', canal_origen_id: canales[0].id });
  const cli = j;
  const crear = async extra => (await pedir('POST', '/leads', T.Valeria, { cliente_id: cli.id, direccion: 'Querétaro', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: ID.Valeria, forzar_duplicado: true,
    partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Desazolve', importe: 7123.41 }]), iva_modo: 'mas_iva', valor: 7123.41, ...extra }))[1];
  const orden = await crear({ estatus: 'ganado', fecha_servicio: HOY });
  await pedir('PUT', '/leads/' + orden.id, T.Valeria, { version: (await pedir('GET', '/leads/' + orden.id, T.Valeria))[1].version, tecnico_id: ID.Tomas });
  const cot = await crear({});

  console.log('1. El enlace de cada orden');
  [s, j] = await pedir('GET', '/leads/' + orden.id + '/encuesta', T.Valeria);
  const url = j.url, token = String(url || '').split('/e/')[1];
  revisa(s === 200 && url.startsWith(BASE + '/e/') && /^[\w-]{20,}$/.test(token) && !j.respuesta, 'la orden tiene su enlace único (aún sin contestar)', j);
  [s, j] = await pedir('GET', '/leads/' + orden.id + '/encuesta', T.Valeria); revisa(j.url === url, 'pedirlo otra vez da el mismo enlace');
  [s] = await pedir('GET', '/leads/' + cot.id + '/encuesta', T.Valeria); revisa(s === 400, 'una cotización no tiene encuesta', s);
  [s] = await pedir('GET', '/leads/' + orden.id + '/encuesta', T.Tomas); revisa(s === 200, 'el técnico asignado ve la encuesta de su orden', s);
  [s] = await pedir('GET', '/leads/' + orden.id + '/encuesta'); revisa(s === 401, 'sin sesión, el enlace interno no se da', s);

  console.log('2. La página pública (sin sesión)');
  const r = await fetch(BASE + '/e/' + token); const html = await r.text();
  revisa(r.status === 200 && /Encuesta de calidad/.test(html), 'el QR abre la página de la encuesta');
  [s, j, texto] = await pedir('GET', '/publico/encuesta/' + token);
  revisa(s === 200 && j.empresa === 'Planta Zafiro' && /^OS-/.test(j.folio) && j.servicios.length && j.preguntas.aspectos.length === 3, 'muestra folio, empresa, servicio y las preguntas', j);
  revisa(!/7123|7,123|8263|valor|total|telefono|442 333/.test(texto), 'sin montos ni teléfono del cliente', texto.slice(0, 300));
  [s] = await pedir('GET', '/publico/encuesta/no-existe-este-token-123'); revisa(s === 404, 'un enlace inventado no existe');

  console.log('3. Contestar');
  const aspectos = Object.fromEntries(j.preguntas.aspectos.flatMap(m => m.items.map(i => [i.clave, 2])));
  [s, j] = await pedir('POST', '/publico/encuesta/' + token, null, { aspectos: { ...aspectos, a21: undefined }, facturacion: 'no', nps: 3, preventivo: 'si' });
  revisa(s === 400 && j.falta === 'a21', 'si falta un aspecto, no se guarda y dice cuál', j);
  [s, j] = await pedir('POST', '/publico/encuesta/' + token, null, { aspectos, facturacion: 'no', nps: 11, preventivo: 'si' }); revisa(s === 400 && j.falta === 'nps', 'la recomendación va del 0 al 10', j);
  [s, j] = await pedir('POST', '/publico/encuesta/' + token, null, { aspectos: { ...aspectos, a43: 'na' }, facturacion: 'no', nps: 3, preventivo: 'si', contacto: 'Ing. Encuesta, jefe de planta', mejorar: 'Llegar a tiempo', reconocimiento: '<b>Gracias</b>' });
  revisa(s === 200, 'con todo contestado se guarda', j);
  [s, j] = await pedir('POST', '/publico/encuesta/' + token, null, { aspectos, facturacion: 'si', nps: 10, preventivo: 'no' }); revisa(s === 409, 'una sola respuesta por orden: no se corrige (decisión 1-a)', [s, j]);
  [s, j] = await pedir('GET', '/publico/encuesta/' + token); revisa(j.respondida === true, 'la página ya dice que se contestó');

  console.log('4. En el CRM');
  [s, j] = await pedir('GET', '/leads/' + orden.id + '/encuesta', T.Valeria);
  const resp = j.respuesta;
  revisa(resp && resp.promedio === 2 && resp.nps === 3 && resp.insatisfecho === true && resp.aspectos.a43 === 'na' && resp.contacto === 'Ing. Encuesta, jefe de planta', 'la orden muestra lo que contestó (N/A no cuenta en el promedio)', resp);
  [, j] = await pedir('GET', '/leads/' + orden.id, T.Valeria);
  revisa(j.historial.some(x => /Encuesta del cliente contestada: promedio 2 de 5 · recomendaría 3\/10/.test(x.texto)), 'su bitácora tiene el resumen', j.historial.map(x => x.texto));
  const avisos = async t => (await pedir('GET', '/alertas', t))[1].filter(x => x.lead_id === orden.id).map(x => x.texto);
  for (const [quien, t, ve] of [['Dirección', A, true], ['el gerente', T.Gema, true], ['la responsable (Valeria)', T.Valeria, true], ['Atención (ve la orden, no es suya)', T.Alicia, false], ['el técnico asignado', T.Tomas, false]]) {
    const xs = await avisos(t);
    revisa(ve ? xs.some(x => /insatisfecho/.test(x)) && xs.some(x => /mantenimiento preventivo/.test(x)) : !xs.some(x => /insatisfecho|preventivo/.test(x)),
      `aviso de cliente insatisfecho y de mantenimiento preventivo: ${ve ? 'le llega a' : 'NO le llega a'} ${quien} (decisión 2)`, xs);
  }
  [s, j] = await pedir('GET', '/tablero?desde=' + HOY + '&hasta=' + HOY, A);
  const sat = j.satisfaccion;
  revisa(s === 200 && sat.encuestas === 1 && sat.promedio === 2 && sat.nps === -100 && sat.insatisfechos === 1 && sat.quieren_preventivo === 1 && sat.por_vendedor[0].nombre === 'Valeria Ventas' && sat.por_tecnico[0].nombre === 'Tomas Tecnico',
    'Panorama: promedio, NPS, insatisfechos y por vendedor y técnico', sat && { ...sat, aspectos: undefined });
  revisa(sat.comentarios[0].mejorar === 'Llegar a tiempo' && sat.aspectos.find(x => x.clave === 'a43').promedio === null, 'los comentarios y cada aspecto (el N/A no cuenta)', sat.comentarios);

  console.log('5. Límite de envíos y borrado');
  let limite = false;
  for (let i = 0; i < 12 && !limite; i++) { [s] = await pedir('POST', '/publico/encuesta/token-inexistente-abcdefgh', null, {}); limite = s === 429; }
  revisa(limite, 'muchos envíos seguidos desde la misma IP se frenan (429)');
  [s] = await pedir('DELETE', '/leads/' + orden.id, A, { motivo: 'Prueba de la encuesta' });
  revisa(s === 409 || s === 200, 'borrar la orden no truena por su encuesta', s);
  if (s === 200) { [s] = await pedir('GET', '/publico/encuesta/' + token); revisa(s === 404 || s === 429, 'y su enlace deja de servir', s); }

  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 5));
  srv.kill();
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e, salida.slice(-1500)); srv.kill(); process.exit(1); });
