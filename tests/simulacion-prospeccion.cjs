// PROSPECCIÓN (2026-10-26): historial de seguimiento (cada llamada o visita con su resultado y la próxima fecha), tarjetas
// de la agenda, búsqueda más amplia y filtros. El alcance no cambia: el vendedor ve y anota solo en lo suyo; el gerente,
// en toda su sucursal; quien no ve prospección no entra.
// Uso: node tests/simulacion-prospeccion.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-prospeccion-')), DB = path.join(dir, 'sim.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Prospecta-' + Math.random().toString(36).slice(2) + '-5Q' };
const CLAVE = 'Clave-Prospecta-2026x';
const PUERTO = String(9700 + Math.floor(Math.random() * 200)), URL = 'http://localhost:' + PUERTO + '/api';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => {
  const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  let j = {}; try { j = await x.json(); } catch { /* */ } return [x.status, j];
};
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const dias = d => { const f = new Date(HOY + 'T12:00:00'); f.setDate(f.getDate() + d); return f.toISOString().slice(0, 10); };

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }))[1].token;
  let s, j;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const T = {}, ID = {};
  for (const [nombre, rol] of [['Vale Ventas', 'ventas'], ['Beto Ventas', 'ventas'], ['Gema Gerente', 'gerente'], ['Tomas Tecnico', 'tecnico']]) {
    [s, j] = await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [qro.id] });
    const k = nombre.split(' ')[0]; ID[k] = j.id; T[k] = (await pedir('POST', '/login', null, { nombre, password: CLAVE }))[1].token;
  }
  const [, sectores] = await pedir('GET', '/prospeccion/sectores', T.Vale);
  const alta = async (t, quien, datos) => (await pedir('POST', '/prospeccion', t, { sector_id: sectores[0].id, zona: 'Querétaro', direccion: '', telefono: '', correo: '', persona: '', cargo: '', fuente: '', necesidades: '', estado: 'investigar', responsable_id: ID[quien], proximo_contacto: '', ...datos }))[1];
  const hotel = await alta(T.Vale, 'Vale', { nombre: 'Hotel Ámbar', zona: 'Juriquilla', telefono: '442 555 0001', correo: 'compras@ambar.mx', necesidades: 'Trampa de grasa en cocina', estado: 'pendiente', proximo_contacto: dias(-2) });
  const resto = await alta(T.Vale, 'Vale', { nombre: 'Restaurante Coral', proximo_contacto: HOY });
  const ajeno = await alta(T.Beto, 'Beto', { nombre: 'Hospital Jade', telefono: '442 555 0003' });
  revisa(hotel.id && resto.id && ajeno.id, 'se registran 3 establecimientos', [hotel, resto, ajeno]);

  console.log('1. Anotar seguimiento');
  [s, j] = await pedir('POST', '/prospeccion/' + hotel.id + '/seguimientos', T.Vale, { version: hotel.version, medio: 'llamada', texto: 'Pidió cotización para enero', estado: 'interesado', proximo_contacto: dias(7) });
  revisa(s === 201 && j.estado === 'interesado' && j.proximo_contacto === dias(7) && j.seguimientos.length === 1 && j.seguimientos[0].usuario === 'Vale Ventas' && j.seguimientos[0].estado_antes === 'pendiente', 'se guarda con quién, y cambia el estado y la próxima fecha de la ficha', j);
  const v = j.version;
  [s] = await pedir('POST', '/prospeccion/' + hotel.id + '/seguimientos', T.Vale, { version: hotel.version, medio: 'nota', texto: 'otra' });
  revisa(s === 409, 'con una versión vieja de la ficha no se anota (otra persona la cambió)', s);
  for (const [cuerpo, que] of [[{ medio: 'fax', texto: 'x' }, 'un medio inventado'], [{ medio: 'nota', texto: '  ' }, 'sin texto'], [{ medio: 'nota', texto: 'x', proximo_contacto: '2026-02-30' }, 'una fecha imposible'], [{ medio: 'nota', texto: 'x', estado: 'ganado' }, 'un estado inventado'], [{ medio: 'nota', texto: 'x'.repeat(2001) }, 'un texto de más de 2000']]) {
    [s] = await pedir('POST', '/prospeccion/' + hotel.id + '/seguimientos', T.Vale, { version: v, ...cuerpo });
    revisa(s === 400, 'rechaza ' + que, s);
  }
  [s, j] = await pedir('POST', '/prospeccion/' + hotel.id + '/seguimientos', T.Vale, { version: v, medio: 'whatsapp', texto: '<img src=x onerror=alert(1)>', estado: 'no_contactar', proximo_contacto: dias(3) });
  revisa(s === 201 && j.proximo_contacto === null && j.seguimientos[0].texto === '<img src=x onerror=alert(1)>', '«No contactar» borra la próxima fecha; el texto se guarda tal cual (la pantalla lo escapa)', j);
  [s, j] = await pedir('GET', '/prospeccion/' + hotel.id, T.Vale);
  revisa(j.seguimientos?.length === 2 && j.seguimientos[0].medio === 'whatsapp', 'la ficha trae su historial, lo más reciente primero', j.seguimientos);

  console.log('2. Quién ve y quién anota');
  [s] = await pedir('GET', '/prospeccion/' + hotel.id, T.Beto); revisa(s === 404 || s === 403, 'otro vendedor no ve la ficha ni su historial', s);
  [s] = await pedir('POST', '/prospeccion/' + resto.id + '/seguimientos', T.Beto, { version: resto.version, medio: 'nota', texto: 'me meto' });
  revisa(s === 404 || s === 403, 'otro vendedor no anota en lo ajeno', s);
  [s, j] = await pedir('POST', '/prospeccion/' + resto.id + '/seguimientos', T.Gema, { version: resto.version, medio: 'visita', texto: 'Visita del gerente' });
  revisa(s === 201, 'el gerente (toda su sucursal) sí anota', [s, j]);
  [s] = await pedir('POST', '/prospeccion/' + resto.id + '/seguimientos', T.Tomas, { version: j.version, medio: 'nota', texto: 'x' });
  revisa(s === 403 || s === 404, 'quien no ve prospección (técnico) no anota', s);
  [s] = await pedir('GET', '/prospeccion/resumen', T.Tomas); revisa(s === 403, 'ni ve el resumen', s);

  console.log('3. Resumen y filtros');
  [, j] = await pedir('GET', '/prospeccion/resumen', T.Vale);
  revisa(j.total === 2 && j.hoy === 1 && j.no_contactar === 1 && j.zonas.length === 2, 'el resumen de un vendedor cuenta solo lo suyo (hoy, por estado, zonas)', j);
  [, j] = await pedir('GET', '/prospeccion/resumen', T.Gema); revisa(j.total === 3, 'el del gerente, toda su sucursal', j);
  const ids = async (t, q) => (await pedir('GET', '/prospeccion?' + q, t))[1].map(e => e.id);
  revisa((await ids(T.Vale, 'q=ambar.mx')).join() === String(hotel.id), 'busca por correo');
  revisa((await ids(T.Vale, 'q=cocina')).join() === String(hotel.id), 'busca en las notas');
  revisa((await ids(T.Vale, 'q=hotel%20ambar')).join() === String(hotel.id), 'busca sin acentos');
  revisa((await ids(T.Vale, 'q=5550001')).join() === String(hotel.id), 'busca por los dígitos del teléfono');
  revisa((await ids(T.Vale, 'agenda=hoy')).join() === String(resto.id), 'agenda: para hoy');
  revisa((await ids(T.Vale, 'zona=juriquilla')).join() === String(hotel.id), 'por zona');
  revisa((await ids(T.Vale, 'telefono=sin')).join() === String(resto.id), 'sin teléfono');
  revisa(!(await ids(T.Vale, 'q=jade')).length, 'buscar no deja ver lo de otro vendedor');
  [, j] = await pedir('GET', '/prospeccion?q=coral', T.Vale);
  revisa(j[0]?.seguimientos === 1 && j[0]?.ultimo_medio === 'visita' && j[0]?.ultimo_texto === 'Visita del gerente', 'cada fila trae su último seguimiento', j[0]);

  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 5));
  srv.kill();
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e, salida.slice(-1500)); srv.kill(); process.exit(1); });
