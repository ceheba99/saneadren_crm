// DIRECTORIO DE CONTACTOS (2026-10-26): búsqueda por correo, RFC, domicilio, otros teléfonos y sin acentos; filtros por
// tipo (recurrentes, por recuperar), tipo de cliente, cómo se enteró y quién lo atiende; último y próximo servicio.
// El alcance no cambia: cada quien sigue viendo solo los contactos que ya veía.
// Uso: node tests/simulacion-contactos.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-contactos-')), DB = path.join(dir, 'sim.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Contactos-' + Math.random().toString(36).slice(2) + '-7Q' };
const CLAVE = 'Clave-Contactos-2026x';
const PUERTO = String(9500 + Math.floor(Math.random() * 200)), URL = 'http://localhost:' + PUERTO + '/api';
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
  const [, canales] = await pedir('GET', '/canales', A), [, servicios] = await pedir('GET', '/servicios', A), [, tipos] = await pedir('GET', '/tipos-cliente', A);
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const T = {}, ID = {};
  for (const [nombre, rol] of [['Vale Ventas', 'ventas'], ['Beto Ventas', 'ventas']]) {
    [s, j] = await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [qro.id] });
    const k = nombre.split(' ')[0]; ID[k] = j.id; T[k] = (await pedir('POST', '/login', null, { nombre, password: CLAVE }))[1].token;
  }
  const alta = async (t, datos) => (await pedir('POST', '/contactos', t, { canal_origen_id: canales[0].id, direccion: 'Querétaro', ...datos }))[1];
  const orden = async (t, cli, responsable, extra) => (await pedir('POST', '/leads', t, { cliente_id: cli.id, direccion: 'Querétaro', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: responsable, forzar_duplicado: true,
    partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Desazolve', importe: 1000 }]), iva_modo: 'mas_iva', valor: 1000, ...extra }))[1];

  const sofia = await alta(T.Vale, { nombre: 'Ing. Sofía Ñúñez', telefono: '442 111 0001', empresa_contacto: 'Planta Ámbar', correo: 'sofia@ambar.mx', rfc: 'AMB010101AB1', giro: tipos[0].clave });
  const dormido = await alta(T.Vale, { nombre: 'Lic. Dormido', telefono: '442 111 0002', canal_origen_id: canales[1].id });
  const recurrente = await alta(T.Vale, { nombre: 'Arq. Recurrente', telefono: '442 111 0003' });
  const ajeno = await alta(T.Beto, { nombre: 'Sr. Ajeno', telefono: '442 111 0004' });
  revisa(sofia.id && dormido.id && recurrente.id && ajeno.id, 'se dan de alta 4 contactos', [sofia, dormido, recurrente, ajeno]);
  await pedir('POST', '/clientes/' + sofia.id + '/telefonos', T.Vale, { telefono: '442 999 8877' });
  await orden(T.Vale, sofia, ID.Vale, { estatus: 'ganado', fecha_servicio: dias(-10) });
  await orden(T.Vale, sofia, ID.Vale, { estatus: 'ganado', fecha_servicio: dias(5) });
  await orden(T.Vale, dormido, ID.Vale, { estatus: 'ganado', fecha_servicio: dias(-300) });
  await orden(T.Vale, recurrente, ID.Vale, { estatus: 'ganado', fecha_servicio: dias(-20) });
  await orden(T.Vale, recurrente, ID.Vale, { estatus: 'ganado', fecha_servicio: dias(-40) });
  await orden(T.Beto, ajeno, ID.Beto, {});

  const lista = async (t, q) => { const [st, l] = await pedir('GET', '/clientes?incluir_prospectos=1&' + q, t); return st === 200 ? l.map(c => c.id) : st; };
  console.log('1. Buscar');
  for (const [q, que] of [['sofia nunez'.split(' ')[0], 'sin acentos («sofia»)'], ['ambar.mx', 'por correo'], ['AMB010101', 'por RFC'], ['9998877', 'por otro de sus teléfonos'], ['planta ambar', 'por empresa sin acentos']]) {
    const l = await lista(A, 'q=' + encodeURIComponent(q));
    revisa(Array.isArray(l) && l.includes(sofia.id) && l.length === 1, 'encuentra a Sofía ' + que, l);
  }
  revisa((await lista(A, 'q=CLI-' + String(dormido.id).padStart(4, '0'))).join() === String(dormido.id), 'sigue buscando por ID (CLI-0002)');

  console.log('2. Filtros');
  revisa((await lista(A, 'tipo=recurrentes')).sort().join() === [sofia.id, recurrente.id].sort().join(), 'recurrentes: 2 o más órdenes');
  revisa((await lista(A, 'tipo=dormidos')).join() === String(dormido.id), 'por recuperar: su último servicio fue hace más de 6 meses y no tiene nada en curso');
  revisa((await lista(A, 'giro=' + tipos[0].clave)).join() === String(sofia.id), 'por tipo de cliente');
  revisa(!(await lista(A, 'giro=sin')).includes(sofia.id), '«sin tipo de cliente» no incluye a quien sí tiene');
  revisa((await lista(A, 'canal=' + canales[1].id)).join() === String(dormido.id), 'por cómo se enteró');
  revisa((await lista(A, 'atiende=' + ID.Beto)).join() === String(ajeno.id), 'por quién lo atiende');

  console.log('3. Lo que trae cada fila');
  [, j] = await pedir('GET', '/clientes?incluir_prospectos=1&q=sofia', A); const f = j[0] || {};
  revisa(f.ultimo_servicio === dias(-10) && f.proximo_servicio === dias(5) && f.atiende_nombre === 'Vale Ventas' && f.canal_origen_nombre === canales[0].nombre, 'último y próximo servicio, quién lo atiende y cómo se enteró', f);

  console.log('4. El alcance no cambia');
  const deBeto = await lista(T.Beto, '');
  revisa(Array.isArray(deBeto) && deBeto.includes(ajeno.id) && !deBeto.includes(sofia.id), 'un vendedor solo ve sus contactos, también con los filtros nuevos', deBeto);
  revisa(!(await lista(T.Beto, 'q=ambar.mx')).length && !(await lista(T.Beto, 'q=9998877')).length, 'buscar por correo u otro teléfono no deja ver contactos ajenos');
  revisa(!(await lista(T.Beto, 'atiende=' + ID.Vale)).length, 'filtrar por otro vendedor no deja ver sus contactos');
  [s] = await pedir('GET', '/clientes?incluir_prospectos=1&atiende=abc&canal=x%27--', A); revisa(s === 200, 'filtros con basura no truenan', s);

  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 5));
  srv.kill();
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e, salida.slice(-1500)); srv.kill(); process.exit(1); });
