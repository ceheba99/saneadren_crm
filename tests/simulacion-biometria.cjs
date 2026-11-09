// BIOMÉTRICO FACIAL (2026-11-05): consentimiento, registro con código de RH, comparación 1:1 y trampas.
// Las caras se simulan con descriptores de 128 números: «la misma persona» = el mismo vector con poco ruido;
// «otra persona» = otro vector al azar (lejos).
//  1. Consentimiento: RH lo marca en la ficha (expedientes físicos), con quién y cuándo; nadie el suyo. Código de
//     registro: solo quien edita el personal, de su sucursal, nunca para sí mismo; exige la marca; un solo uso; hash.
//  2. Registro en el kiosco: código malo o usado, sin pasar la prueba de vida, menos de 3 muestras o muestras de distintas personas →
//     no; bien → plantilla CIFRADA (sin las fotos).
//  3. Al checar: quien tiene biométrico debe mandar su cara; coincide → válida; otra cara, sin pasar la prueba de vida o sin cara →
//     checa igual pero queda por revisar; 3 intentos de comprobación por ticket; quien no tiene biométrico, como antes.
//  3b. Entrar con la cara SIN PIN (2026-11-05): código → cara que coincide con prueba de vida → ticket sin PIN; cara de otra
//     persona o sin pasar la prueba de vida → intento fallido con permiso de foto; a los 3, solo con PIN; aviso en RH.
//  4. Revocar: borrar el registro o quitar la marca de consentimiento → se borra y deja de usarse; los triggers protegen el
//     resultado guardado en la checada.
// Uso: node tests/simulacion-biometria.cjs
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-biometria-')), DB = path.join(dir, 'bio.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Biometria-' + crypto.randomBytes(6).toString('hex') + '-9Q' };
const CLAVE = 'Clave-Bio-' + crypto.randomBytes(4).toString('hex') + '7';
const PUERTO = String(9300 + Math.floor(Math.random() * 90)), URLB = 'http://localhost:' + PUERTO;
const env = { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: URLB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', CLAVE_CIFRADO: crypto.randomBytes(32).toString('hex') };
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b, extra = {}) => {
  const x = await fetch(URLB + '/api' + r, { method: m, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.60.0.1', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* */ } return [x.status, j, texto];
};
const kio = (tk, r, b) => pedir('POST', '/publico/kiosco/' + r, null, b, { 'X-Kiosco': tk });
let n = 0; const malos = [];
const revisa = (cond, t, extra) => { n++; if (!cond) { malos.push(t); console.log('  ✘ ' + t + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + t); };
const exigir = (r, que) => { if (r[0] !== 200 && r[0] !== 201) throw new Error('No se pudo ' + que + ': ' + JSON.stringify(r[1])); return r[1]; };
const conBase = fn => { const d = new DatabaseSync(DB); try { d.exec('PRAGMA busy_timeout = 5000'); return fn(d); } finally { d.close(); } };
// Caras sintéticas.
const normal = v => { const m = Math.hypot(...v); return v.map(x => Math.round((x / m) * 1e6) / 1e6); };
const cara = () => normal(Array.from({ length: 128 }, () => Math.random() - 0.5));
const parecida = (v, ruido = 0.008) => normal(v.map(x => x + (Math.random() - 0.5) * ruido * 2));
const PDF = Buffer.from('%PDF-1.4\n% consentimiento biometrico\n' + crypto.randomBytes(200).toString('hex') + '\n%%EOF');

(async () => {
  for (let i = 0; i < 160 && !/corriendo/.test(salida); i++) await espera(100);
  if (!/corriendo/.test(salida)) throw new Error('El servidor no arrancó: ' + salida.slice(-800));
  const A = exigir(await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }), 'entrar').token;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const cdmx = exigir(await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' }), 'crear CDMX');
  const T = {}, U = {};
  for (const [nombre, rol, s] of [['Gema Gerente', 'gerente', qro.id], ['Valeria Ventas', 'ventas', qro.id], ['Gus GerenteMx', 'gerente', cdmx.id]]) {
    U[nombre.split(' ')[0]] = exigir(await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [s] }), 'crear ' + nombre);
    T[nombre.split(' ')[0]] = exigir(await pedir('POST', '/login', null, { nombre, password: CLAVE }), 'entrar ' + nombre).token;
  }
  const PIN = {};
  const alta = async (nombre, pin) => {
    const p = exigir(await pedir('POST', '/personal', T.Gema, { nombre, puesto: 'Técnico' }), 'alta'); const c = exigir(await pedir('POST', '/asistencia/personal/' + p.id + '/pin', T.Gema), 'checador');
    p.codigo = c.codigo; p.temporal = c.pin; PIN[p.id] = pin; return p;
  };
  const juan = await alta('Juan Pérez', '5813'), ana = await alta('Ana López', '7392');
  const K = exigir(await pedir('POST', '/asistencia/dispositivos', T.Gema, { nombre: 'Entrada', sucursal_id: qro.id }), 'kiosco').token;
  for (const p of [juan, ana]) { const i = exigir(await kio(K, 'identificar', { codigo: p.codigo, pin: p.temporal }), 'identificar'); exigir(await kio(K, 'cambiar-pin', { ticket: i.ticket, nuevo: PIN[p.id] }), 'PIN'); }
  const subirConsentimiento = async p => { const r = await fetch(URLB + '/api/personal/' + p.id + '/documentos', { method: 'POST', headers: { Authorization: 'Bearer ' + A, 'X-Tipo': 'biometria', 'X-Nombre': 'consentimiento.pdf', 'Content-Type': 'application/pdf' }, body: PDF }); return [r.status, await r.json().catch(() => ({}))]; };

  console.log('1. Código de registro');
  revisa((await pedir('POST', '/asistencia/personal/' + juan.id + '/biometria/codigo', T.Gema))[0] === 409, 'Sin el consentimiento marcado en la ficha, no hay código');
  revisa((await pedir('PUT', '/asistencia/personal/' + juan.id + '/biometria/consentimiento', T.Valeria, { firmado: true }))[0] === 403, 'Ventas no marca consentimientos');
  revisa((await pedir('PUT', '/asistencia/personal/' + juan.id + '/biometria/consentimiento', T.Gus, { firmado: true }))[0] === 404, 'El gerente de CDMX no marca a alguien de Querétaro');
  const [sm, jm] = await pedir('PUT', '/asistencia/personal/' + juan.id + '/biometria/consentimiento', T.Gema, { firmado: true });
  revisa(sm === 200 && jm.consentimiento === true && jm.consentimiento_por === 'Gema Gerente' && jm.consentimiento_at, 'La gerente marca que firmó (expediente físico): queda quién y cuándo', jm);
  revisa(conBase(d => d.prepare("SELECT COUNT(*) n FROM auditoria WHERE detalle LIKE '%firmó el consentimiento biométrico%'").get().n) === 1, 'La marca queda en la bitácora');
  revisa((await pedir('POST', '/asistencia/personal/' + juan.id + '/biometria/codigo', T.Valeria))[0] === 403, 'Ventas no da códigos');
  revisa((await pedir('POST', '/asistencia/personal/' + juan.id + '/biometria/codigo', T.Gus))[0] === 404, 'El gerente de CDMX no da códigos para Querétaro');
  const gemaFicha = exigir(await pedir('POST', '/personal', A, { nombre: 'Gema Gerente Ficha', puesto: 'Administración', usuario_id: U.Gema.id, sucursal_id: qro.id }), 'ficha de Gema');
  revisa((await pedir('POST', '/asistencia/personal/' + gemaFicha.id + '/biometria/codigo', T.Gema))[1].codigo === 'PROPIO', 'Gema no se da un código a sí misma');
  revisa((await pedir('PUT', '/asistencia/personal/' + gemaFicha.id + '/biometria/consentimiento', T.Gema, { firmado: true }))[1].codigo === 'PROPIO', 'Ni marca su propio consentimiento');
  const c1 = exigir(await pedir('POST', '/asistencia/personal/' + juan.id + '/biometria/codigo', T.Gema), 'código').codigo;
  revisa(/^\d{6}$/.test(c1) && !conBase(d => JSON.stringify(d.prepare('SELECT * FROM rostro_codigos').all())).includes(c1), 'Código de 6 dígitos; la base solo guarda su hash');

  console.log('2. Registro en el kiosco');
  const JUAN = cara();
  const tres = () => [parecida(JUAN), parecida(JUAN), parecida(JUAN)];
  revisa((await kio(K, 'rostro-registrar', { codigo: '000000', descriptores: tres(), vivo: true }))[0] === 401, 'Un código inventado no sirve');

  revisa((await kio(K, 'rostro-registrar', { codigo: c1, descriptores: tres().slice(0, 2), vivo: true }))[0] === 400, 'Con menos de 3 muestras no se registra');
  revisa((await kio(K, 'rostro-registrar', { codigo: c1, descriptores: [parecida(JUAN), parecida(JUAN), cara()], vivo: true }))[0] === 400, 'Si una muestra es de otra persona, no se registra');
  revisa((await kio(K, 'rostro-registrar', { codigo: c1, descriptores: [[...JUAN.slice(0, 127), 'x'], parecida(JUAN), parecida(JUAN)], vivo: true }))[0] === 400, 'Datos que no son números se rechazan');
  const [sr, rr] = await kio(K, 'rostro-registrar', { codigo: c1, descriptores: tres(), vivo: true });
  revisa(sr === 201 && rr.nombre === 'Juan', 'Con el código y 3 muestras de la misma cara: registrado', [sr, rr]);
  revisa((await kio(K, 'rostro-registrar', { codigo: c1, descriptores: tres(), vivo: true }))[0] === 401, 'El código no sirve dos veces');
  const fila = conBase(d => d.prepare('SELECT * FROM rostros WHERE personal_id = ?').get(juan.id));
  revisa(fila && !fila.plantilla.startsWith('[') && !fila.plantilla.includes(String(JUAN[0]).slice(0, 7)), 'La plantilla queda cifrada en la base', fila && fila.plantilla.slice(0, 40));
  const [, ficha] = await pedir('GET', '/asistencia/personal/' + juan.id, T.Gema);
  revisa(ficha.biometria?.registrado === true && ficha.biometria.consentimiento === true && !JSON.stringify(ficha).includes('plantilla'), 'La ficha dice «registrado» sin mandar la plantilla', ficha.biometria);

  console.log('3. Al checar');
  const ident = async p => exigir(await kio(K, 'identificar', { codigo: p.codigo, pin: PIN[p.id] }), 'identificar');
  let i1 = await ident(juan);
  revisa(i1.biometria === true, 'Al identificarse, el kiosco sabe que Juan usa biométrico');
  revisa((await ident(ana)).biometria === false, 'Ana (sin consentimiento) no');
  const [, v1] = await kio(K, 'rostro-verificar', { ticket: i1.ticket, rostro: { descriptor: parecida(JUAN), vivo: true } });
  revisa(v1.coincide === true, 'Su cara coincide', v1);
  const [, v2] = await kio(K, 'rostro-verificar', { ticket: i1.ticket, rostro: { descriptor: cara(), vivo: true } });
  revisa(v2.coincide === false && v2.resultado === 'no_coincide', 'Otra cara no coincide', v2);
  await kio(K, 'rostro-verificar', { ticket: i1.ticket, rostro: { descriptor: parecida(JUAN), vivo: true } });
  revisa((await kio(K, 'rostro-verificar', { ticket: i1.ticket, rostro: { descriptor: parecida(JUAN), vivo: true } }))[0] === 429, 'Máximo 3 comprobaciones por ticket');
  const checa = async (tipo, rostro) => { const i = await ident(juan); const [s, j] = await kio(K, 'checar', { ticket: i.ticket, tipo, ...(rostro ? { rostro } : {}) }); return conBase(d => d.prepare('SELECT estado, biometria, distancia_rostro, observaciones FROM checadas WHERE id = ?').get(j.id)); };
  let ch = await checa('entrada', { descriptor: parecida(JUAN), vivo: true });
  revisa(ch.estado === 'por_revisar' && ch.biometria === 'coincide' && ch.distancia_rostro < 0.3 && !/Biométrico/.test(ch.observaciones || ''), 'Coincide: queda el resultado «coincide» (por revisar solo porque no trae foto)', ch);
  ch = await checa('comida_sale', { descriptor: cara(), vivo: true });
  revisa(ch.estado === 'por_revisar' && ch.biometria === 'no_coincide' && /la cara no coincide/.test(ch.observaciones), 'Otra cara: checa, pero por revisar «la cara no coincide»', ch);
  ch = await checa('comida_regresa', { descriptor: parecida(JUAN), vivo: false });
  revisa(ch.biometria === 'no_vivo' && /no pasó la prueba de vida/.test(ch.observaciones), 'No pasó la prueba de vida (foto o pantalla): por revisar', ch);
  ch = await checa('salida', null);
  revisa(ch.biometria === 'sin_rostro' && /no se detectó su cara/.test(ch.observaciones), 'Si la tableta no manda cara: por revisar', ch);
  const ia = await ident(ana); const [, ca] = await kio(K, 'checar', { ticket: ia.ticket, tipo: 'entrada' });
  revisa(conBase(d => d.prepare('SELECT biometria FROM checadas WHERE id = ?').get(ca.id).biometria) === null, 'Ana checa como siempre, sin biométrico');
  revisa(conBase(d => { try { d.prepare("UPDATE checadas SET biometria = 'coincide' WHERE biometria = 'no_coincide'").run(); return false; } catch { return true; } }), 'Nadie puede cambiar en la base el resultado del biométrico de una checada');

  console.log('3b. Entrar con la cara, sin PIN');
  revisa((await kio(K, 'rostro-previo', { codigo: juan.codigo }))[1].biometria === true, 'Juan (con biométrico) entra con su cara');
  revisa((await kio(K, 'rostro-previo', { codigo: ana.codigo }))[1].biometria === false && (await kio(K, 'rostro-previo', { codigo: '0000' }))[1].biometria === false, 'Ana (sin biométrico) y un código que no existe: PIN');
  const [se1, e1] = await kio(K, 'rostro-entrar', { codigo: juan.codigo, rostro: { descriptor: parecida(JUAN), vivo: true } });
  revisa(se1 === 200 && e1.ticket && e1.con_cara === true && e1.nombre === 'Juan', 'Su cara coincide y pasó la prueba de vida: entra SIN PIN', [se1, e1]);
  const [, chk] = await kio(K, 'checar', { ticket: e1.ticket, tipo: 'extra_inicia', rostro: { descriptor: parecida(JUAN), vivo: true } });
  revisa(conBase(d => d.prepare('SELECT biometria FROM checadas WHERE id = ?').get(chk.id).biometria) === 'coincide', 'Y su checada queda «coincide»');
  const [sf1, f1] = await kio(K, 'rostro-entrar', { codigo: juan.codigo, rostro: { descriptor: cara(), vivo: true } });
  revisa(sf1 === 401 && !f1.ticket && f1.intentos === 1 && typeof f1.intento === 'string', 'Otra persona con el código de Juan: no entra, y el kiosco debe tomarle foto', [sf1, f1]);
  revisa((await kio(K, 'intento-foto', { intento: f1.intento, foto: 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(2000), Buffer.from([0xff, 0xd9])]).toString('base64') }))[0] === 200, 'La foto del intento se guarda');
  const [sf2, f2] = await kio(K, 'rostro-entrar', { codigo: juan.codigo, rostro: { descriptor: parecida(JUAN), vivo: false, diag: { cuadros: 15, segundos: 4.2, evaluados: 12, reales: 2, seguidos: 1, vida: -2.34, chica: false, raro: '<script>' } } });
  revisa(sf2 === 401 && f2.resultado === 'no_vivo', 'Una foto de Juan (no pasó la prueba de vida): no entra', [sf2, f2]);
  const det = conBase(d => d.prepare("SELECT detalle FROM checador_intentos WHERE motivo LIKE 'Parece foto%' ORDER BY id DESC").get()?.detalle);
  revisa(/15 cuadros en 4.2 s · vida: 2 de 12 reales, racha 1 \(pide 3\), promedio -2.3/.test(det || '') && !det.includes('script'), 'El intento guarda el diagnóstico de la prueba de vida sin texto ajeno', det);
  const [sf3, f3] = await kio(K, 'rostro-entrar', { codigo: juan.codigo, rostro: { descriptor: cara(), vivo: true } });
  revisa(sf3 === 401 && f3.pin === true, 'Al tercer intento, el kiosco pide el PIN', f3);
  revisa((await kio(K, 'rostro-previo', { codigo: juan.codigo }))[1].biometria === false && (await kio(K, 'rostro-entrar', { codigo: juan.codigo, rostro: { descriptor: parecida(JUAN), vivo: true } }))[0] === 409, 'Agotados los 3 intentos, ya no se puede entrar con la cara (ni con la correcta) por 10 min: solo PIN');
  const intentosCara = conBase(d => d.prepare("SELECT motivo FROM checador_intentos WHERE personal_id = ? AND (motivo LIKE '%cara%' OR motivo LIKE '%foto%')").all(juan.id));
  revisa(intentosCara.length === 3, 'Los 3 intentos quedan en «Intentos fallidos» para RH', intentosCara);
  const ip = await ident(juan); const [, cp] = await kio(K, 'checar', { ticket: ip.ticket, tipo: 'extra_termina', rostro: { descriptor: cara(), vivo: true } });
  revisa(conBase(d => d.prepare('SELECT estado, biometria FROM checadas WHERE id = ?').get(cp.id)).biometria === 'no_coincide', 'Con su PIN checa, y la checada queda por revisar (la cara no coincidió)');
  revisa((await pedir('GET', '/rh/resumen', T.Gema))[1].biometria_fallos >= 1, 'Inicio de RH avisa «Biométrico no los reconoció»');

  console.log('4. Revocar');
  revisa((await pedir('POST', '/asistencia/personal/' + juan.id + '/biometria/borrar', T.Gus))[0] === 404, 'El de CDMX no borra registros de Querétaro');
  revisa((await pedir('POST', '/asistencia/personal/' + juan.id + '/biometria/borrar', T.Valeria))[0] === 403, 'Ventas no borra registros');
  exigir(await pedir('POST', '/asistencia/personal/' + juan.id + '/biometria/borrar', T.Gema), 'borrar');
  revisa(!conBase(d => d.prepare('SELECT 1 FROM rostros WHERE personal_id = ?').get(juan.id)) && (await ident(juan)).biometria === false, 'Borrado: se elimina la plantilla y ya no se pide la cara');
  const c2 = exigir(await pedir('POST', '/asistencia/personal/' + juan.id + '/biometria/codigo', T.Gema), 'código 2').codigo;
  exigir(await kio(K, 'rostro-registrar', { codigo: c2, descriptores: tres(), vivo: true }), 'volver a registrar');
  exigir(await pedir('PUT', '/asistencia/personal/' + juan.id + '/biometria/consentimiento', T.Gema, { firmado: false }), 'quitar consentimiento');
  revisa((await ident(juan)).biometria === false && !conBase(d => d.prepare('SELECT 1 FROM rostros WHERE personal_id = ?').get(juan.id)), 'Si revocó (se quita la marca), se borra su plantilla y ya no se pide la cara');
  const [sd, doc] = await subirConsentimiento(ana);
  revisa(sd === 201 && (await pedir('POST', '/asistencia/personal/' + ana.id + '/biometria/codigo', T.Gema))[0] === 200, 'También vale el documento subido al expediente digital (opcional)', [sd, doc]);

  console.log(`\n${n - malos.length}/${n} correctas`);
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('\n' + salida.slice(-1500)); srv.kill(); process.exit(1); });
