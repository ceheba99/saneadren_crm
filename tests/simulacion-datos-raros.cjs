// AUDITORÍA — datos raros en TODAS las rutas: ninguna respuesta debe ser un error interno (500) ni tumbar el servidor.
// Se usan los ejemplos del demo (hay de todo) y, para cada ruta de la API (leída del código), se prueban números de
// registro reales y absurdos, cuerpos vacíos o mal formados, textos enormes, tipos equivocados, inyecciones y
// filtros de fecha imposibles. Al final el servidor debe seguir vivo, sin errores en su registro, y la revisión de
// integridad igual que al inicio (los intentos rechazados no dejan basura).
// Uso: node tests/simulacion-datos-raros.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-raros-')); const PUERTO = String(8800 + Math.floor(Math.random() * 150));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Raros-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '1', PORT: PUERTO, DB_PATH: path.join(dir, 'x.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 900) : '')); } else console.log('  ✔ ' + texto); };
const errores = [];
async function pedir(m, r, t, cuerpo, crudo) {
  try {
    const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': crudo ? 'application/octet-stream' : 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: m === 'GET' ? undefined : crudo ?? (cuerpo === undefined ? undefined : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)) });
    const texto = await x.text();
    if (x.status >= 500) errores.push(`${m} ${r} [${typeof cuerpo === 'string' ? cuerpo.slice(0, 40) : JSON.stringify(cuerpo)?.slice(0, 60)}] → ${x.status} ${texto.slice(0, 80)}`);
    return [x.status, texto];
  } catch (e) { errores.push(`${m} ${r} → sin respuesta (${e.message})`); return [0, '']; }
}

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  for (let i = 0; i < 400; i++) { const x = await fetch(`http://localhost:${PUERTO}/api/demo/estado`).then(r => r.json()).catch(() => ({})); if (x.listo || x.error) break; await espera(300); }
  const entrar = async rol => (await fetch(`http://localhost:${PUERTO}/api/demo/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rol }) }).then(r => r.json())).token;
  const A = await entrar('admin'), V = await entrar('ventas_cdmx');
  const get = async r => JSON.parse((await pedir('GET', r, A))[1] || 'null');
  const integridadAntes = (await get('/admin/integridad')).errores;
  // Números reales de cada tipo de registro (para que las rutas lleguen hasta su validación).
  const [leads, cxp, ocs, sols, provs, users, clis, suc] = await Promise.all(['/leads', '/finanzas/cxp?vista=todas', '/compras/ordenes', '/compras/solicitudes?estado=', '/finanzas/proveedores', '/usuarios', '/clientes/catalogo', '/sucursales'].map(get));
  const sol = sols.find(s => s.cotizaciones_n || true), solD = await get('/compras/solicitudes/' + sol.id);
  const oc = ocs[0], exp = await get('/compras/ordenes/' + oc.id + '/expediente');
  const real = {
    leads: leads.find(l => l.estatus === 'ganado').id, historial: (await get('/leads/' + leads[0].id)).historial?.[0]?.id ?? 1, cobros: (await get('/leads/' + leads.find(l => l.estatus === 'ganado').id + '/cobros'))?.cobros?.[0]?.id ?? 1,
    cxp: cxp[0].id, pagos: (await get('/finanzas/cxp/' + cxp[0].id + '/pagos'))?.[0]?.id ?? 1, ocs: oc.id, dococ: exp?.documentos?.[0]?.id ?? 1, sols: sol.id, docsol: solD?.cotizaciones?.[0]?.id ?? solD?.documentos?.[0]?.id ?? 1,
    provs: provs[0].id, users: users.find(u => /Ventas/.test(u.nombre))?.id ?? 2, clis: clis[0].id, suc: suc.sucursales[0].id, centros: 1, unidades: 1, servicios: 1, canales: 1, est: 1,
  };
  const idPara = r => /^\/leads\/buscar-telefono/.test(r) ? '4426901122' : /^\/leads/.test(r) ? real.leads : /^\/historial/.test(r) ? real.historial : /^\/finanzas\/cobros/.test(r) ? real.cobros
    : /^\/finanzas\/cxp/.test(r) ? real.cxp : /^\/finanzas\/pagos-proveedor/.test(r) ? real.pagos : /^\/compras\/ordenes/.test(r) ? real.ocs : /^\/compras\/documentos/.test(r) ? real.dococ
    : /^\/compras\/solicitudes\/documentos/.test(r) ? real.docsol : /^\/compras\/solicitudes/.test(r) ? real.sols : /^\/finanzas\/proveedores/.test(r) ? real.provs : /^\/usuarios/.test(r) ? real.users
    : /clientes/.test(r) ? real.clis : /^\/sucursales/.test(r) ? real.suc : /^\/compras\/centros/.test(r) ? real.centros : /^\/compras\/unidades/.test(r) ? real.unidades : /^\/servicios/.test(r) ? real.servicios
    : /^\/canales/.test(r) ? real.canales : /^\/prospeccion/.test(r) ? real.est : 1;
  const fuentes = fs.readdirSync(path.join(__dirname, '..', 'server')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(__dirname, '..', 'server', f), 'utf8')).join('\n');
  const rutas = [...new Set([...fuentes.matchAll(/app\.(get|post|put|delete)\('\/api(\/[^']+)'/g)].map(m => m[1].toUpperCase() + ' ' + m[2]))].map(x => x.split(' '))
    .filter(([, r]) => !/^\/(logout|cambiar-password|admin\/backup)$/.test(r)); // salir o cambiar la propia contraseña cortaría la prueba
  revisa(rutas.length > 130, `${rutas.length} rutas leídas del código`);
  const ponerId = (r, id) => r.replace(/:id\b/g, () => id).replace(/:clave\b/, 'otro').replace(/:tel(efono)?\b/, '4426901122');
  const IDS_RAROS = ['abc', '-1', '0', '99999999', '1e9', '1.5', '%2e%2e', "1' OR '1'='1", 'null', '9'.repeat(40)];
  const LARGO = 'x'.repeat(300000);
  const CUERPOS = [{}, [], null, 'no-es-json', '{"roto":', 0, true, [1, 2, 3], { a: { b: { c: { d: 1 } } } },
    { nombre: LARGO, concepto: LARGO, texto: LARGO, motivo: LARGO }, { monto: 'mucho', total: 'abc', valor: 'NaN', cantidad: -5, precio: 1e308, dias_credito: '30 días' },
    { fecha: '2026-02-30', fecha_servicio: '31/12/2026', fecha_documento: '9999-99-99', desde: 'ayer', hasta: '' }, { id: 1, version: 'x', estatus: 'borrado', rol: 'superadmin', sucursales: 'todas' },
    { __proto__: { admin: true }, constructor: { prototype: { x: 1 } } }, { partidas_json: '[{"servicio":1}]', partidas: 'no', gastos: [{}, null, 'x'] }, { q: "'; DROP TABLE leads; --", nombre: '<script>alert(1)</script>' },
    { telefono: '+52 (442) 💩 690', correo: 'a@', rfc: 'X', clabe: '1'.repeat(40) }, { monto: 0.001, total: -1, cantidad: '1e3' }];
  const QUERIES = ['', '?q=' + encodeURIComponent("' OR 1=1 --"), '?desde=2026-02-30&hasta=ayer', '?desde=2030-01-01&hasta=2020-01-01', '?vista=xyz&estado=__proto__', '?q=' + 'a'.repeat(5000), '?lead_id=abc&id=-1'];

  console.log('1. Cada ruta con datos raros (administración)');
  let peticiones = 0;
  for (const [m, r] of rutas) {
    const variantes = /:/.test(r) ? [ponerId(r, idPara(r)), ...IDS_RAROS.map(x => ponerId(r, encodeURIComponent(x)))] : [r];
    for (const ruta of variantes) {
      if (m === 'GET') { for (const q of QUERIES) { await pedir('GET', ruta + q, A); peticiones++; } }
      else for (const c of CUERPOS) { await pedir(m, ruta, A, c); peticiones++; }
    }
  }
  console.log(`  (${peticiones} peticiones)`);
  revisa(!errores.length, 'ninguna ruta respondió con error interno (500) ante datos raros', errores.slice(0, 12));
  console.log('2. Lo mismo con un usuario sin permisos de administración (ventas CDMX)');
  const antes2 = errores.length; let p2 = 0;
  for (const [m, r] of rutas) for (const c of (m === 'GET' ? [undefined] : CUERPOS.slice(0, 6))) { await pedir(m, ponerId(r, idPara(r)) + (m === 'GET' ? QUERIES[2] : ''), V, c); p2++; }
  revisa(errores.length === antes2, `${p2} peticiones más como ventas: ninguna con error interno`, errores.slice(antes2, antes2 + 10));
  console.log('3. Archivos raros en las rutas que reciben archivos');
  const antes3 = errores.length;
  for (const r of ['/compras/ordenes/' + real.ocs + '/documentos', '/compras/solicitudes/' + real.sols + '/documentos'])
    for (const buf of [Buffer.alloc(0), Buffer.from('no soy un pdf'), Buffer.alloc(30 * 1024 * 1024, 1), Buffer.from('%PDF-1.4 roto')])
      await pedir('POST', r, A, undefined, buf);
  revisa(errores.length === antes3, 'archivos vacíos, falsos o de 30 MB: rechazados sin error interno', errores.slice(antes3));
  console.log('4. Sin sesión y con sesión falsa');
  const antes4 = errores.length; let no401 = [];
  for (const [m, r] of rutas) { if (/^\/(salud|login|registro|verificar-correo|olvide-password|restablecer-password|demo\/estado|demo\/entrar)$/.test(r)) continue;
    const [st] = await pedir(m, ponerId(r, 1), 'token-falso-' + 'z'.repeat(60), m === 'GET' ? undefined : {}); if (st !== 401) no401.push(m + ' ' + r + ' → ' + st); }
  revisa(!no401.length && errores.length === antes4, 'con una sesión falsa, todas las rutas responden «inicia sesión» (401)', no401.slice(0, 10));
  console.log('5. Después de todo');
  const [st] = await pedir('GET', '/salud', null); revisa(st === 200, 'el servidor sigue vivo y respondiendo');
  const integridadDespues = (await get('/admin/integridad'));
  revisa(integridadDespues.errores === integridadAntes, `la revisión de integridad sigue igual (${integridadAntes} errores antes, ${integridadDespues.errores} después): los intentos rechazados no dejaron basura`, (integridadDespues.resultados || []).filter(x => x.gravedad === 'error' && x.total).map(x => x.titulo + ': ' + JSON.stringify(x.casos.slice(0, 2))));
  const internos = salida.split('\n').filter(l => /Error en |uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(l));
  revisa(!internos.length, 'el servidor no registró errores internos', [...new Set(internos.map(l => l.slice(0, 160)))].slice(0, 12));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-3000)); srv.kill(); process.exit(1); });
