// AUDITORÍA TOTAL: revisa cada rincón del sistema sin depender de que alguien se acuerde de revisarlo. Todo se
// enumera solo, leyendo el código y la base; si aparece algo nuevo sin revisar, la auditoría FALLA.
//  A. Manifiesto (tests/manifiesto-modulos.cjs): cada tabla, ruta y pantalla pertenece a un módulo; cada módulo está
//     conectado donde debe (pantalla, menú, bloque en Inicio si tiene pendientes, revisión de integridad, ejemplos en
//     el demo, buscador, permisos). Lo que no aplica se declara con su razón.
//  B. Código: la pantalla solo llama rutas que existen; toda ruta atrapa sus errores; todo permiso se usa y existe;
//     todo id que busca el código existe en la página; ids únicos; campos con etiqueta; botones con texto; imágenes
//     con texto alternativo; variables de entorno documentadas.
//  C. Servidor (con los datos del demo): TODAS las rutas, con cada rol, sin sesión, con sesión falsa y con datos
//     basura: nunca un error 500, nunca datos sin sesión, nunca un registro de otra sucursal, nunca más de 3 s.
// Uso: node tests/auditoria-total.cjs
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const M = require('./manifiesto-modulos.cjs');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').split(String.fromCharCode(13)).join('');
const archivos = d => fs.readdirSync(path.join(RAIZ, d)).filter(f => f.endsWith('.js')).sort();
const SERVER = Object.fromEntries(archivos('server').map(f => [f, leer('server/' + f)]));
const PUBLICO = Object.fromEntries(archivos('public').map(f => [f, leer('public/' + f)]));
const HTML = leer('public/index.html');
const TODO_JS_PUBLICO = Object.values(PUBLICO).join('\n');
const hallazgos = [];
let revisiones = 0;
const revisa = (cond, area, texto, extra) => { revisiones++; if (!cond) { hallazgos.push(`[${area}] ${texto}`); console.log(`  ✘ [${area}] ${texto}` + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } return cond; };
const enModulo = (lista, x) => Object.entries(M.modulos).filter(([, m]) => (m[lista] || []).includes(x)).map(([k]) => k);

// ================= Inventario =================
const RUTAS = [];
for (const [f, t] of Object.entries(SERVER)) {
  const re = /app\.(get|post|put|delete)\(\s*'(\/api[^']*)'\s*,([^\n]{0,240})/g; let m;
  // Se sigue buscando justo después de la ruta (puede haber otra ruta en la misma línea).
  while ((m = re.exec(t))) { RUTAS.push({ metodo: m[1].toUpperCase(), ruta: m[2], archivo: f, resto: m[3] }); re.lastIndex = m.index + m[0].length - m[3].length; }
}
const patronRuta = r => new RegExp('^' + r.replace(/:[a-zA-Z_]+/g, '[^/]+') + '$');
const VISTAS_HTML = [...HTML.matchAll(/<section[^>]*id="vista-([\w-]+)"/g)].map(m => m[1]);
const NAV = [...HTML.matchAll(/<[^>]*class="[^"]*\bmenu-item\b[^"]*"[^>]*data-vista="([\w-]+)"/g)].map(m => (M.aliasMenu || {})[m[1]] || m[1]);
const CATALOGO = [...SERVER['permisos.js'].matchAll(/^\s*\['([a-z_]+\.[a-z_]+)',/gm)].map(m => m[1]);
const AREAS = [...SERVER['permisos.js'].matchAll(/^\s*\['(ventas|cxc|cxp|compras)', '/gm)].map(m => m[1]);
const VIRTUALES = AREAS.flatMap(a => [a + '.ver', a + '.sucursal']);
const PERMISOS = new Set([...CATALOGO, ...VIRTUALES]);
console.log(`Inventario: ${RUTAS.length} rutas, ${VISTAS_HTML.length} pantallas, ${PERMISOS.size} permisos, ${Object.keys(PUBLICO).length} archivos de pantalla, ${Object.keys(SERVER).length} del servidor`);

// ================= B. Código =================
console.log('B. Código');
// B1. Toda ruta atrapa sus errores (envuelta en h(...)), salvo las que lo hacen a mano.
const MANEJAN_SOLAS = ['/api/salud', '/api/demo/entrar', '/api/demo/estado', '/api/admin/backup'];
const envuelta = r => { if (/\bh\(/.test(r.resto) || MANEJAN_SOLAS.includes(r.ruta)) return true; const fn = (r.resto.match(/^\s*([A-Za-z_]\w*)\(/) || [])[1]; return !!fn && new RegExp(`(const|let)\\s+${fn}\\s*=\\s*\\([^)]*\\)\\s*=>\\s*h\\(`).test(SERVER[r.archivo]); };
for (const r of RUTAS) revisa(envuelta(r), 'rutas', `${r.metodo} ${r.ruta} (${r.archivo}) no está envuelta en h(): un error la tumbaría sin respuesta`);
// B2. La pantalla solo llama rutas que existen (con el método correcto).
function llamadasPantalla() {
  const out = [];
  for (const [f, t] of Object.entries(PUBLICO)) {
    // Cada archivo puede tener su propio «pedir»: se averigua qué prefijo le pone a la ruta (o ninguno).
    const defPedir = t.match(/(?:const\s+pedir\s*=\s*\([^)]*\)\s*=>|function\s+pedir\s*\([^)]*\)\s*\{)[\s\S]{0,160}?\bapi\(\s*(?:'([^']*)'\s*\+\s*)?\w+/);
    const prefijo = defPedir ? { pedir: defPedir[1] || '' } : {};
    const re = /\b(api|enviar|pedir|fetch)\(\s*(API\s*\+\s*)?/g; let m;
    while ((m = re.exec(t))) {
      const fn = m[1]; if (fn === 'pedir' && prefijo.pedir === undefined) continue; if (fn === 'fetch' && !m[2]) continue;
      if (fn === 'pedir' && /(?:const|function)\s+$/.test(t.slice(Math.max(0, m.index - 15), m.index))) continue; // la definición, no una llamada
      // Lee los argumentos de ESTA llamada hasta su paréntesis de cierre (respetando textos y paréntesis anidados).
      let i = re.lastIndex, prof = 0, enCad = null; const args = ['']; 
      for (; i < t.length; i++) { const c = t[i];
        if (enCad) { args[args.length - 1] += c; if (c === enCad && t[i - 1] !== '\\') enCad = null; continue; }
        if (c === "'" || c === '"' || c === '`') { enCad = c; args[args.length - 1] += c; continue; }
        if (c === '(' || c === '[' || c === '{') prof++; else if (c === ')' || c === ']' || c === '}') { if (prof === 0) break; prof--; } else if (c === ',' && prof === 0) { args.push(''); continue; }
        args[args.length - 1] += c; }
      const arg = args[0].trim(), resto = ',' + args.slice(1).join(',');
      // Partes unidas con «+» (fuera de los textos).
      const partes = []; { let cur = '', q = null; for (const c of arg) { if (q) { cur += c; if (c === q) q = null; continue; } if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; } if (c === '+') { partes.push(cur.trim()); cur = ''; continue; } cur += c; } partes.push(cur.trim()); }
      if (!partes.length || !/^['"`]\//.test(partes[0]) && !(prefijo.pedir && fn === 'pedir' && /^['"`]/.test(partes[0]))) continue; // ruta armada fuera: no se puede analizar
      let ruta = (fn === 'pedir' ? prefijo.pedir : '') + partes.map(p => /^'[^']*'$|^"[^"]*"$/.test(p) ? p.slice(1, -1) : /^`[^`]*`$/.test(p) ? p.slice(1, -1).replace(/\$\{[^}]*\}/g, ':p') : ':p').join('');
      ruta = ruta.split('?')[0].replace(/:p+/g, ':p').replace(/\/$/, '') || '/';
      // Método: en las opciones ({ method: 'X' }) o como texto suelto entre los argumentos (pedir(ruta, 'POST', …)).
      const suelto = args.slice(1).map(a => a.trim()).find(a => /^'(GET|POST|PUT|DELETE)'$/.test(a));
      const metodo = suelto ? suelto.slice(1, -1) : (resto.match(/method:\s*'([A-Z]+)'/) || [])[1] || (/method[:,\s]/.test(resto) || args.slice(1).some(a => /^[a-z]\w*$/i.test(a.trim()) && fn === 'pedir') ? '?' : 'GET');
      out.push({ archivo: f, ruta: '/api' + ruta, metodo, original: arg.slice(0, 80) });
    }
  }
  return out;
}
const LLAMADAS = llamadasPantalla();
const casa = (llamada, r) => { const a = llamada.ruta.split('/'), b = r.ruta.split('/'); return a.length === b.length && a.every((s, i) => s === ':p' || b[i].startsWith(':') || s === b[i] || (s.includes(':p') && new RegExp('^' + s.replace(/:p/g, '.*') + '$').test(b[i]))); };
for (const l of LLAMADAS) {
  const porRuta = RUTAS.filter(r => casa(l, r));
  revisa(porRuta.length > 0, 'pantalla→servidor', `${l.archivo} llama ${l.metodo} ${l.ruta}, que NO existe en el servidor`, l.original);
  if (porRuta.length && l.metodo !== '?') revisa(porRuta.some(r => r.metodo === l.metodo), 'pantalla→servidor', `${l.archivo} llama ${l.metodo} ${l.ruta}, pero el servidor solo la atiende con ${[...new Set(porRuta.map(r => r.metodo))].join('/')}`, l.original);
}
// B3. Permisos: cada uno existe, se usa en el servidor y pertenece a un módulo; cada clase perm-* corresponde a uno.
for (const k of CATALOGO) {
  const usos = Object.entries(SERVER).some(([f, t]) => (t.split(`'${k}'`).length - 1) > (f === 'permisos.js' ? 1 : 0));
  revisa(usos, 'permisos', `el permiso «${k}» no lo revisa ninguna ruta del servidor (dar o quitar ese permiso no cambiaría nada)`);
}
for (const k of PERMISOS) revisa(enModulo('permisos', k).length > 0, 'manifiesto', `el permiso «${k}» no pertenece a ningún módulo del manifiesto`);
const CLASES_PERM = new Set([...(HTML + TODO_JS_PUBLICO).matchAll(/\b(?:no)?perm-([a-z_]+-[a-z_]+)/g)].map(m => m[1].replace('-', '.')));
for (const c of CLASES_PERM) revisa(PERMISOS.has(c), 'permisos', `la clase perm-${c.replace('.', '-')} usa un permiso que no existe («${c}»): ese elemento nunca se mostraría u ocultaría bien`);
// B4. Ids: los que busca el código existen en la página (o se crean en una plantilla); ids únicos en la página.
const IDS_HTML = [...HTML.matchAll(/\sid="([\w-]+)"/g)].map(m => m[1]);
const dup = IDS_HTML.filter((x, i) => IDS_HTML.indexOf(x) !== i);
revisa(!dup.length, 'página', 'ids repetidos en index.html (el código encontraría el equivocado)', [...new Set(dup)]);
const PREFIJOS_ID = [...TODO_JS_PUBLICO.matchAll(/\bid="([\w-]+)\$\{/g)].map(m => m[1]);
const IDS_CREADOS = new Set([...IDS_HTML, ...[...TODO_JS_PUBLICO.matchAll(/\bid="([\w-]+)"/g)].map(m => m[1]), ...[...TODO_JS_PUBLICO.matchAll(/\.id\s*=\s*'([\w-]+)'/g)].map(m => m[1])]);
for (const [f, t] of Object.entries(PUBLICO)) {
  const usaDolar = /const \$ = (id|x|i) => document\.getElementById\(\1\)/.test(t);
  const buscados = new Set([...t.matchAll(/getElementById\('([\w-]+)'\)/g)].map(m => m[1]).concat(usaDolar ? [...t.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]) : []));
  for (const id of buscados) revisa(IDS_CREADOS.has(id) || PREFIJOS_ID.some(p => id.startsWith(p)), 'pantalla', `${f} busca el elemento #${id}, que no existe en la página`);
}
// B5. Pantallas y menú.
for (const v of NAV) revisa(VISTAS_HTML.includes(v), 'menú', `el menú lleva a «${v}», pantalla que no existe`);
for (const v of VISTAS_HTML) revisa(v === 'inicio' || enModulo('vistas', v).length > 0, 'manifiesto', `la pantalla «${v}» no pertenece a ningún módulo del manifiesto`);
// B6. Accesibilidad básica: cada campo con etiqueta, cada botón con texto, cada imagen con texto alternativo.
const sinEtiqueta = [...HTML.matchAll(/<(input|select|textarea)\b([^>]*)>/g)].filter(m => !/type="(hidden|checkbox|radio|file)"/.test(m[2])).map(m => (m[2].match(/id="([\w-]+)"/) || [])[1] || m[0].slice(0, 60))
  .filter(id => !new RegExp(`for="${id}"`).test(HTML) && !new RegExp(`id="${id}"[^>]*aria-label=|aria-label=[^>]*id="${id}"`).test(HTML) && !new RegExp(`<label[^>]*>[^<]*(<[^/][^>]*>[^<]*)*<(input|select|textarea)[^>]*id="${id}"`).test(HTML));
revisa(!sinEtiqueta.length, 'accesibilidad', `${sinEtiqueta.length} campo(s) de la página sin etiqueta (el lector de pantalla y el clic en el texto no funcionan)`, sinEtiqueta.slice(0, 30));
const botonesMudos = [...HTML.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].filter(m => !m[2].replace(/<[^>]+>/g, '').trim() && !/aria-label=|title=/.test(m[1])).map(m => (m[1].match(/id="([\w-]+)"/) || [])[1] || m[0].slice(0, 60));
revisa(!botonesMudos.length, 'accesibilidad', 'botones sin texto ni descripción', botonesMudos);
const imgsSinAlt = [...HTML.matchAll(/<img\b([^>]*)>/g)].filter(m => !/\balt=/.test(m[1])).map(m => m[0].slice(0, 80));
revisa(!imgsSinAlt.length, 'accesibilidad', 'imágenes sin texto alternativo', imgsSinAlt);
// B7. Variables de entorno usadas en el servidor: documentadas en .env.example.
const ENV_USADAS = [...new Set(Object.values(SERVER).flatMap(t => [...t.matchAll(/process\.env\.([A-Z_0-9]+)/g)].map(m => m[1])))].filter(v => !['RENDER', 'TZ'].includes(v));
const ENV_DOC = fs.existsSync(path.join(RAIZ, '.env.example')) ? leer('.env.example') : '';
for (const v of ENV_USADAS) revisa(new RegExp(`^#?\\s*${v}=`, 'm').test(ENV_DOC), 'configuración', `la variable ${v} se usa en el servidor pero no está explicada en .env.example`);

// ================= A. Manifiesto (lo estático) =================
console.log('A. Manifiesto de módulos');
for (const r of RUTAS) revisa(Object.values(M.modulos).some(m => m.rutas.some(re => re.test(r.ruta))) || M.rutasGenerales.some(re => re.test(r.ruta)), 'manifiesto', `la ruta ${r.metodo} ${r.ruta} no pertenece a ningún módulo`);
const INICIO = (HTML.match(/<section class="vista activa" id="vista-inicio">([\s\S]*?)<\/section>/) || [])[1] || '';
for (const [k, m] of Object.entries(M.modulos)) {
  for (const v of m.vistas) { revisa(VISTAS_HTML.includes(v), k, `declara la pantalla «${v}» y no existe`); revisa(NAV.includes(v), k, `la pantalla «${v}» no tiene entrada en el menú`); }
  if (!m.vistas.length) revisa(!!m.vistasRazon, k, 'no tiene pantalla y no explica por qué');
  revisa(m.pendientes ? m.inicio.length > 0 : !!m.pendientesRazon, k, m.pendientes ? `tiene pendientes (${m.pendientes}) pero ningún bloque en Inicio` : 'no dice si tiene pendientes');
  for (const id of m.inicio) {
    const bloque = (INICIO.match(new RegExp(`<div class="inicio-bloque[^"]*"[^>]*>(?:(?!<div class="inicio-bloque)[\\s\\S])*?id="${id}"`)) || [])[0] || '';
    revisa(bloque, k, `su bloque de Inicio #${id} no está en la pantalla de Inicio`);
    if (bloque) revisa(/\b(?:perm-[a-z_]+-[a-z_]+|solo-[a-z-]+)/.test(bloque.split('>')[0]), k, `el bloque de Inicio #${id} no dice qué permiso lo muestra (lo vería cualquiera)`);
    revisa(Object.values(PUBLICO).some(t => t.includes(`'${id}'`)), k, `nada llena el bloque de Inicio #${id}`);
  }
  for (const t of m.integridad || []) revisa(SERVER['integridad.js'].includes(t), k, `la revisión de integridad no revisa la tabla «${t}»`);
  if (!m.integridad) revisa(!!m.integridadRazon, k, 'no tiene revisión de integridad y no explica por qué');
  for (const t of m.buscador || []) revisa(SERVER['buscador.js'].includes(t), k, `el buscador general no busca en «${t}»`);
  if (!m.buscador) revisa(!!m.buscadorRazon, k, 'no está en el buscador y no explica por qué');
  for (const p of m.permisos) revisa(PERMISOS.has(p), k, `declara el permiso «${p}», que no existe`);
}

// Columnas de negocio que la pantalla muestra (f.columna, x.columna…) sin que ningún formulario las capture ni el
// sistema las genere. «Capturar» = la pantalla manda la llave (columna: …, o sin _cent en pesos) o un campo/lista la
// nombra (id «xx-columna», 'columna' en una lista de campos). Lo que genera el sistema va en M.generados (con su razón).
function retirados(js, db, tablas) {
  const negocio = tablas.filter(t => !M.internas[t]);
  const cols = new Map(); for (const t of negocio) for (const c of db.prepare(`PRAGMA table_info(${t})`).all()) cols.set(c.name, (cols.get(c.name) || []).concat(t));
  const mostrados = new Set([...js.matchAll(/\b(?:f|x|l|o|c|p|r|a|d|s|g|k|e|i|u|lead|orden|fila|item|cuenta|persona|actual|cliente|sol|oc)\.([a-z][a-z0-9_]+)\b/g)].map(m => m[1]));
  // M.generados: { campo: 'razón' } si lo genera el sistema, o { campo: { como: 'llave', razon } } si la pantalla lo
  // captura con otro nombre (p. ej. el «motivo» de una cancelación se guarda en motivo_cancelacion); «como» se comprueba.
  const G = M.generados || {};
  // «Quién lo hizo» lo pone el sistema con la sesión: SOLO estos nombres exactos (no cualquier «…_por»: «realizado_por»
  // —propio/subcontratado— es un dato de negocio y así se colaba como generado).
  const QUIEN = /^(registrad|cancelad|autorizad|recibid|elegid|aprobad|cerrad|eliminad|confirmad|subid|cread|resuelt)[oa]_por(_nombre|_id)?$/;
  const generado = c => /_at$/.test(c) || QUIEN.test(c) || ['id', 'version', 'created_at', 'updated_at', 'folio_num', 'sucursal_id'].includes(c) || (typeof G[c] === 'string' && G[c].length > 10);
  // Se manda como llave (x: …), abreviada ({ x, … }), asignada (d.x = …) o nombrada entre comillas (listas de campos).
  const manda = k => new RegExp(`\\b${k}\\s*:|[{,]\\s*${k}\\s*[,}]|\\.${k}\\s*=[^=]|'${k}'`).test(js);
  const comoOtro = c => !!G[c] && typeof G[c] === 'object' && !!G[c].razon && manda(G[c].como);
  const capturado = c => { const base = c.replace(/_cent$/, ''); return comoOtro(c) || manda(c) || manda(base) ||new RegExp(`id="[\\w]+-(${c}|${base})"`).test(HTML) || new RegExp(`'(${c}|${base})'`).test(js) || new RegExp(`-(${c}|${base})['"\`]`).test(js); };
  return [...mostrados].filter(c => cols.has(c) && !generado(c) && !capturado(c)).map(c => `${c} (${cols.get(c).join(', ')})`);
}

// ================= D. Crear = editar =================
// Los campos de un formulario: input/select/textarea y los selectores que arma la pantalla (data-campo), sin los ocultos.
function camposDe(prefijo) {
  const ids = [];
  for (const m of HTML.matchAll(/<(input|select|textarea|div)\b[^>]*>/g)) {
    const id = (m[0].match(/\sid="([\w-]+)"/) || [])[1];
    if (!id || !id.startsWith(prefijo) || /\stype="hidden"/.test(m[0]) || (m[1] === 'div' && !/\sdata-campo\b/.test(m[0]))) continue;
    ids.push(id.slice(prefijo.length));
  }
  return ids;
}
function formularios() {
  console.log('D. Formularios: lo que se pide al crear es lo mismo que se puede editar');
  for (const [nombre, f] of Object.entries(M.formularios || {})) {
    const eq = f.equivalentes || {}, soloE = f.soloEdicion || {}, soloA = f.soloAlta || {};
    const crudosA = camposDe(f.alta), crudosE = camposDe(f.edicion);
    const alta = new Set(crudosA.map(c => eq[c] || c)), edicion = new Set(crudosE);
    revisa(alta.size > 2 && edicion.size > 2, 'formularios', `${nombre}: no se encontraron sus campos (${f.alta}… / ${f.edicion}…)`);
    for (const c of edicion) if (!alta.has(c)) revisa(!!soloE[c], 'formularios', `${nombre}: «${c}» se puede editar pero NO se pide al crear (agrégalo al crear o declara por qué en el manifiesto)`);
    for (const c of alta) if (!edicion.has(c)) revisa(!!soloA[c], 'formularios', `${nombre}: «${c}» se pide al crear pero NO se puede editar después`);
    // Las excepciones declaradas siguen siendo ciertas (si ya se igualaron, sobran) y equivalen a campos que existen.
    for (const c of Object.keys(soloE)) revisa(edicion.has(c) && !alta.has(c), 'formularios', `${nombre}: la excepción «${c}» (solo al editar) ya no aplica: quítala del manifiesto`);
    for (const c of Object.keys(soloA)) revisa(alta.has(c) && !edicion.has(c), 'formularios', `${nombre}: la excepción «${c}» (solo al crear) ya no aplica: quítala del manifiesto`);
    for (const [a, e] of Object.entries(eq)) revisa(crudosA.includes(a) && edicion.has(e), 'formularios', `${nombre}: la equivalencia «${a}» = «${e}» ya no corresponde a campos que existan`);
    // Cada campo lo lee algún código de la pantalla: un campo que nadie lee se pide y no se guarda.
    for (const id of [...crudosA.map(c => f.alta + c), ...crudosE.map(c => f.edicion + c)])
      revisa(new RegExp(`['"\`]${id}['"\`]`).test(TODO_JS_PUBLICO), 'formularios', `${nombre}: #${id} está en la pantalla pero ningún código lo lee (se pediría y no se guardaría)`);
  }
}
formularios();

// ================= C. Servidor con datos del demo =================
(async () => {
  console.log('C. Servidor (todas las rutas con datos del demo)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-auditoria-')), DB = path.join(dir, 'auditoria.db');
  const PUERTO = String(10100 + Math.floor(Math.random() * 300)), URLB = 'http://localhost:' + PUERTO;
  const srv = spawn(process.execPath, [path.join(RAIZ, 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '1', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, SMTP_HOST: '', ADMIN_USUARIO: '', ADMIN_CORREO: '', ADMIN_PASSWORD: '', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') } });
  let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
  const espera = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 600; i++) { try { const e = await fetch(URLB + '/api/demo/estado').then(r => r.json()); if (e.listo || e.error) break; } catch { /* arrancando */ } await espera(250); }
  const est = await fetch(URLB + '/api/demo/estado').then(r => r.json());
  revisa(est.listo && !est.error, 'demo', 'los datos de ejemplo se sembraron', est.error);
  const TOK = {};
  for (const u of est.usuarios) TOK[u.rol] = (await fetch(URLB + '/api/demo/entrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rol: u.rol }) }).then(r => r.json())).token;
  const db = new DatabaseSync(DB, { readOnly: true });
  // A (con la base): cada tabla tiene dueño; las de sucursal están separadas por sucursal; el demo trae ejemplos.
  const TABLAS = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
  const CON_SUC = (SERVER['sucursales.js'].match(/const CON_SUCURSAL = \[([^\]]*)\]/) || [])[1] || '';
  const VISTAS_SUC = SERVER['sucursales.js'].slice(SERVER['sucursales.js'].indexOf('const VISTAS'), SERVER['sucursales.js'].indexOf('const RUTAS_REGISTRO'));
  for (const t of TABLAS) {
    revisa(enModulo('tablas', t).length > 0 || M.internas[t], 'manifiesto', `la tabla «${t}» no pertenece a ningún módulo (¿qué la revisa?)`);
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
    if (cols.includes('sucursal_id') && !['usuario_sucursales', 'sucursales'].includes(t) && !(M.sucursalCompartida || {})[t]) {
      revisa(CON_SUC.includes(`'${t}'`), 'sucursales', `la tabla «${t}» tiene sucursal pero no está en CON_SUCURSAL (se le asignaría mal la sucursal)`);
      revisa(VISTAS_SUC.includes(`'${t}'`), 'sucursales', `la tabla «${t}» tiene sucursal pero no tiene vista filtrada (todos verían todo)`);
    }
  }
  for (const [k, m] of Object.entries(M.modulos)) for (const t of m.demo) revisa(TABLAS.includes(t) && db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n > 0, k, `el demo no trae ejemplos de «${t}»`);
  // A3. Datos que se muestran pero ya no se capturan (p. ej. «Realizó: propio/subcontratado» cuando ya nadie lo escribe):
  // cada columna de la base que la pantalla muestra debe tener de dónde salir: un formulario que la mande, o que la
  // genere el propio sistema (fechas, folios, quién registró, montos que se capturan en pesos…), declarado en el manifiesto.
  revisa(retirados(TODO_JS_PUBLICO, db, TABLAS).length === 0, 'datos', 'la pantalla muestra datos que ya no se capturan en ningún formulario (o que el sistema no genera)', retirados(TODO_JS_PUBLICO, db, TABLAS));

  // C1. Cada ruta, con cada quien. Los números de registro se toman de la base (de Querétaro, para probar CDMX).
  const qro = db.prepare("SELECT id FROM sucursales WHERE clave = 'QRO'").get()?.id;
  const uno = (sql, ...p) => db.prepare(sql).get(...p);
  const ID = {
    leads: uno('SELECT id FROM leads WHERE sucursal_id = ? AND estatus = \'ganado\' ORDER BY id LIMIT 1', qro)?.id, historial: uno('SELECT h.id FROM historial h JOIN leads l ON l.id = h.lead_id WHERE l.sucursal_id = ? LIMIT 1', qro)?.id,
    cobros: uno('SELECT k.id FROM cobros k JOIN leads l ON l.id = k.lead_id WHERE l.sucursal_id = ? LIMIT 1', qro)?.id, cuentas_por_pagar: uno('SELECT id FROM cuentas_por_pagar WHERE sucursal_id = ? LIMIT 1', qro)?.id,
    pagos_proveedor: uno('SELECT g.id FROM pagos_proveedor g JOIN cuentas_por_pagar x ON x.id = g.cxp_id WHERE x.sucursal_id = ? LIMIT 1', qro)?.id, ordenes_compra: uno('SELECT id FROM ordenes_compra WHERE sucursal_id = ? LIMIT 1', qro)?.id,
    documentos_oc: uno('SELECT d.id FROM documentos_oc d JOIN ordenes_compra o ON o.id = d.oc_id WHERE o.sucursal_id = ? LIMIT 1', qro)?.id, documentos_solicitud: uno('SELECT d.id FROM documentos_solicitud d JOIN solicitudes_compra s ON s.id = d.solicitud_id WHERE s.sucursal_id = ? LIMIT 1', qro)?.id,
    solicitudes_compra: uno('SELECT id FROM solicitudes_compra WHERE sucursal_id = ? LIMIT 1', qro)?.id, establecimientos: uno('SELECT id FROM establecimientos WHERE sucursal_id = ? LIMIT 1', qro)?.id,
    personal: uno('SELECT id FROM personal WHERE sucursal_id = ? LIMIT 1', qro)?.id, documentos_personal: uno('SELECT d.id FROM documentos_personal d JOIN personal p ON p.id = d.personal_id WHERE p.sucursal_id = ? LIMIT 1', qro)?.id,
    incidencias_personal: uno('SELECT i.id FROM incidencias_personal i JOIN personal p ON p.id = i.personal_id WHERE p.sucursal_id = ? LIMIT 1', qro)?.id,
    clientes: uno('SELECT id FROM clientes ORDER BY id LIMIT 1')?.id, proveedores: uno('SELECT id FROM proveedores LIMIT 1')?.id, usuarios: uno("SELECT id FROM usuarios WHERE rol = 'ventas' LIMIT 1")?.id,
    roles: 'ventas', catalogo_servicios: uno('SELECT id FROM catalogo_servicios LIMIT 1')?.id, canales: uno('SELECT id FROM canales LIMIT 1')?.id, tipos_cliente: uno('SELECT clave FROM tipos_cliente LIMIT 1')?.clave,
    centros_costo: uno('SELECT id FROM centros_costo LIMIT 1')?.id, unidades_medida: uno('SELECT id FROM unidades_medida LIMIT 1')?.id, categorias_gasto: uno('SELECT clave FROM categorias_gasto LIMIT 1')?.clave,
    sucursales: qro, sectores_prospeccion: uno('SELECT id FROM sectores_prospeccion LIMIT 1')?.id,
  };
  const TEL = uno('SELECT telefono FROM clientes WHERE telefono IS NOT NULL LIMIT 1')?.telefono || '4420000000';
  // Qué tabla es el :id de cada ruta (la más específica primero).
  const TABLA_DE = [[/^\/api\/personal\/documentos\//, 'documentos_personal'], [/^\/api\/personal\/incidencias\//, 'incidencias_personal'], [/^\/api\/personal\//, 'personal'], [/^\/api\/compras\/solicitudes\/documentos\//, 'documentos_solicitud'],
    [/^\/api\/compras\/solicitudes\//, 'solicitudes_compra'], [/^\/api\/compras\/documentos\//, 'documentos_oc'], [/^\/api\/compras\/ordenes\//, 'ordenes_compra'], [/^\/api\/compras\/centros\//, 'centros_costo'], [/^\/api\/compras\/unidades\//, 'unidades_medida'],
    [/^\/api\/finanzas\/cobros\//, 'cobros'], [/^\/api\/finanzas\/cxp\//, 'cuentas_por_pagar'], [/^\/api\/finanzas\/pagos-proveedor\//, 'pagos_proveedor'], [/^\/api\/finanzas\/proveedores\//, 'proveedores'], [/^\/api\/finanzas\/clientes\//, 'clientes'],
    [/^\/api\/finanzas\/categorias\//, 'categorias_gasto'], [/^\/api\/leads\//, 'leads'], [/^\/api\/historial\//, 'historial'], [/^\/api\/clientes\//, 'clientes'], [/^\/api\/usuarios\//, 'usuarios'], [/^\/api\/roles\//, 'roles'],
    [/^\/api\/servicios\//, 'catalogo_servicios'], [/^\/api\/canales\//, 'canales'], [/^\/api\/tipos-cliente\//, 'tipos_cliente'], [/^\/api\/sucursales\//, 'sucursales'], [/^\/api\/prospeccion\/sectores\//, 'sectores_prospeccion'], [/^\/api\/prospeccion\//, 'establecimientos']];
  const concreta = r => { const t = (TABLA_DE.find(([re]) => re.test(r.ruta)) || [])[1]; return r.ruta.replace(':telefono', TEL).replace(':tel', TEL).replace(/:(id|clave)\b/, String(ID[t] ?? 1)).replace(/:[a-zA-Z_]+/g, '1'); };
  const PUBLICAS = /^\/api\/(salud|login|registro|verificar-correo|olvide-password|restablecer-password|demo\/estado|demo\/entrar)$/;
  const ROLES = Object.keys(TOK), CDMX = ROLES.filter(r => /cdmx/.test(r));
  const lento = [], errores500 = [];
  const pedir = async (m, url, t, cuerpo) => {
    const t0 = Date.now();
    const x = await fetch(URLB + url, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: cuerpo === undefined ? undefined : (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)) });
    const texto = await x.text(), ms = Date.now() - t0;
    if (ms > 3000) lento.push(`${m} ${url} ${ms} ms`);
    if (x.status >= 500) errores500.push(`${m} ${url} → ${x.status} ${texto.slice(0, 120)}`);
    return [x.status, texto];
  };
  let llamadas = 0;
  const RUTAS_DE_REGISTRO = RUTAS.filter(r => /:(id|clave)\b/.test(r.ruta) && !M.compartidos.some(re => re.test(r.ruta)) && !/\/(usuarios|roles|sucursales)\//.test(r.ruta));
  // C1. Sin sesión y con sesión falsa: nada que no sea público responde con datos.
  for (const r of RUTAS) {
    const url = concreta(r), cuerpo = r.metodo === 'GET' ? undefined : {};
    for (const [quien, t] of [['sin sesión', null], ['sesión falsa', crypto.randomBytes(32).toString('hex')]]) {
      const [st] = await pedir(r.metodo, url, t, cuerpo); llamadas++;
      revisa(PUBLICAS.test(r.ruta) || st === 401, 'sesión', `${quien}: ${r.metodo} ${r.ruta} responde ${st} (debe ser 401)`);
    }
  }
  // C2. Consultas: cada rol en cada ruta GET (nunca 500); CDMX no abre registros de Querétaro.
  for (const r of RUTAS.filter(x => x.metodo === 'GET')) for (const rol of ROLES) {
    const [st, texto] = await pedir('GET', concreta(r), TOK[rol]); llamadas++;
    if (CDMX.includes(rol) && RUTAS_DE_REGISTRO.includes(r)) revisa(st === 403 || st === 404 || (st === 200 && (texto === '[]' || texto === '{}')), 'sucursales', `${rol} abre ${r.ruta} de un registro de Querétaro (${st})`, texto.slice(0, 160));
  }
  // C3. Escrituras con basura, por cada rol (las de borrar, solo roles sin permiso para no vaciar el demo).
  const BASURA = [{}, [], '"texto"', '{"roto": ', { __proto__: { admin_general: true }, constructor: { prototype: { x: 1 } } }, { id: 'x', monto: 'abc', total: -1, fecha: '2026-13-45', nombre: '<b>x</b>', version: 'x', partidas_json: '{{', iva_modo: 'raro', sucursal_id: 999999 }, { nombre: 'A'.repeat(30000) }];
  for (const r of RUTAS.filter(x => x.metodo !== 'GET' && !/\/(logout|demo\/entrar|login)$/.test(x.ruta))) {
    const quienes = r.metodo === 'DELETE' ? ['ventas', 'tecnico', 'ventas_cdmx'] : ROLES;
    for (const rol of quienes) for (const b of BASURA) { await pedir(r.metodo, concreta(r), TOK[rol], b); llamadas++; }
    if (CDMX.length && RUTAS_DE_REGISTRO.includes(r)) for (const rol of CDMX) {
      const antes = JSON.stringify(db.prepare('SELECT * FROM leads ORDER BY id').all()) + JSON.stringify(db.prepare('SELECT * FROM cuentas_por_pagar ORDER BY id').all()) + JSON.stringify(db.prepare('SELECT * FROM personal ORDER BY id').all());
      const [st] = await pedir(r.metodo, concreta(r), TOK[rol], { motivo: 'intento desde otra sucursal', version: 1, monto: 1, metodo: 'efectivo', fecha: '2026-01-01', estado: 'realizado', dias_credito: 1, iva: 0, texto: 'x', tipo: 'falta', fecha_inicio: '2026-01-01' }); llamadas++;
      const despues = JSON.stringify(db.prepare('SELECT * FROM leads ORDER BY id').all()) + JSON.stringify(db.prepare('SELECT * FROM cuentas_por_pagar ORDER BY id').all()) + JSON.stringify(db.prepare('SELECT * FROM personal ORDER BY id').all());
      revisa((st === 403 || st === 404 || st === 400) && antes === despues, 'sucursales', `${rol} ${r.metodo} ${r.ruta} sobre un registro de Querétaro → ${st}${antes === despues ? '' : ' y CAMBIÓ la base'}`);
    }
  }
  revisa(!errores500.length, 'servidor', `ninguna ruta responde 500 (${errores500.length} encontrados)`, errores500.slice(0, 15));
  revisa(!lento.length, 'servidor', 'ninguna respuesta tarda más de 3 s con los datos del demo', lento.slice(0, 10));
  const [sti, ti] = await pedir('GET', '/api/salud'); revisa(sti === 200, 'servidor', 'sigue vivo después de todo el barrido');
  const integ = JSON.parse((await pedir('GET', '/api/admin/integridad', TOK.admin))[1]);
  revisa(integ.errores === 0, 'integridad', 'después del barrido, la revisión de integridad sigue sin errores', (integ.resultados || []).filter(r => r.gravedad === 'error' && r.total).map(r => r.titulo));
  const internos = salida.split('\n').filter(l => /Error en |no manejado|uncaught|unhandledRejection/i.test(l));
  revisa(!internos.length, 'servidor', 'el registro del servidor no tiene errores internos', internos.slice(0, 10));
  db.close(); srv.kill();
  console.log(`\n${llamadas} llamadas al servidor · ${LLAMADAS.length} llamadas de la pantalla revisadas · ${RUTAS.length} rutas · ${TABLAS.length} tablas`);
  console.log(`${revisiones - hallazgos.length}/${revisiones} correctas`);
  if (hallazgos.length) { console.log(`\nHALLAZGOS (${hallazgos.length}):\n - ` + hallazgos.join('\n - ')); process.exitCode = 1; }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
})().catch(e => { console.error('ERROR', e); process.exit(1); });
