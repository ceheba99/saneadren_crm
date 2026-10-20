// PERSONAL (RH): fichas, datos sensibles, vacaciones (LFT), incidencias, documentos, bajas y equipo de cada orden.
//  · Quién ve y cambia qué: Dirección y gerente (todo su sucursal); un rol con «Ver personal» sin «Datos sensibles»
//    no recibe CLABE completa, RFC, CURP, NSS, salario ni documentos en NINGUNA respuesta (se rastrean todas).
//  · Sucursales: el personal de CDMX no existe para Querétaro (ni por número).
//  · Validaciones: CLABE con dígito verificador, RFC, CURP, NSS, fechas, nombres repetidos, cuenta ligada a dos fichas.
//  · Vacaciones según la LFT (12 días al primer año, +2 por año hasta 20, luego +2 cada 5) y empalmes.
//  · En la orden: responsable + equipo de su sucursal; el responsable con cuenta ve la orden; al ligar o desligar
//    su cuenta, sus órdenes cambian; dar de baja quita (si se pide) el acceso al sistema.
// Uso: node tests/simulacion-personal.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-personal-')), DB = path.join(dir, 'sim.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Personal-' + Math.random().toString(36).slice(2) + '-9Q' };
const CLAVE = 'Clave-Personal-2026x';
const PUERTO = String(9250 + Math.floor(Math.random() * 200)), URL = 'http://localhost:' + PUERTO + '/api';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b, extra = {}) => {
  const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b === undefined ? undefined : JSON.stringify(b) });
  const texto = await x.text(); let j = {}; try { j = JSON.parse(texto); } catch { /* archivo */ } return [x.status, j, texto];
};
const subir = async (r, t, buf, enc) => { const hh = { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + t }; for (const [k, v] of Object.entries(enc)) hh[k] = encodeURIComponent(String(v)); const x = await fetch(URL + r, { method: 'POST', headers: hh, body: buf }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const dia = k => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const hace = anios => { const [y, m, d] = HOY.split('-'); return `${Number(y) - anios}-${m}-${d}`; };
// Hace N años y 60 días (para que el año de aniversario en curso ya haya empezado).
const haceY60 = anios => { const x = new Date(hace(anios) + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - 60); return x.toISOString().slice(0, 10); };
const CLABE = '014680655039528945', CLABE2 = '012180001234567899';

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }))[1].token;
  let s, j, texto;
  const [, canales] = await pedir('GET', '/canales', A), [, servicios] = await pedir('GET', '/servicios', A);
  const SERV = servicios[0], partidas = (l, imp) => JSON.stringify([{ servicio: SERV.nombre, leyenda: l, importe: imp }]);
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  [, j] = await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' }); const cdmx = j;
  // Rol «Supervisor de campo»: ve el personal (sin datos sensibles) y registra incidencias.
  [, j] = await pedir('POST', '/roles', A, { nombre: 'Supervisor de campo' }); const SUP = j.clave;
  [s, j] = await pedir('PUT', '/roles/' + SUP + '/permisos', A, { permisos: ['personal.ver', 'personal.editar'], alcances: { ventas: 2, cxc: 0, cxp: 0, compras: 1 } });
  revisa(s === 200, 'rol «Supervisor de campo»: ve y edita personal, sin datos sensibles', j);
  [s, j] = await pedir('PUT', '/roles/' + SUP + '/permisos', A, { permisos: ['personal.sensibles'], alcances: {} }); revisa(s === 400, '«Datos sensibles» sin «Ver personal» no tiene sentido (no se guarda)', j);
  const T = {}, ID = {};
  for (const [nombre, rol, suc] of [['Monica Gerente', 'gerente', qro.id], ['Sergio Supervisor', SUP, qro.id], ['Laura Ventas', 'ventas', qro.id], ['Raul Tecnico', 'tecnico', qro.id], ['Gerardo Cdmx', 'gerente', cdmx.id]]) {
    [s, j] = await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [suc] }); if (s !== 201) throw new Error(JSON.stringify(j));
    ID[nombre.split(' ')[0]] = j.id; T[nombre.split(' ')[0]] = (await pedir('POST', '/login', null, { nombre, password: CLAVE }))[1].token;
  }
  const { Monica: M, Sergio: S, Laura: L, Raul: R, Gerardo: G } = T;

  console.log('1. Altas y validaciones');
  const alta = (t, d) => pedir('POST', '/personal', t, d);
  [s, j] = await alta(M, { nombre: 'Raúl Pérez Gómez', puesto: 'Técnico', usuario_id: ID.Raul, telefono: '442 123 4567', fecha_ingreso: haceY60(3), licencia_tipo: 'Federal B', licencia_vence: dia(10), banco: 'BBVA', clabe: CLABE, rfc: 'PEGR800101AB1', curp: 'PEGR800101HQTRMLA1', nss: '12345678901', salario: 520.5, salario_periodo: 'diario', tipo_contrato: 'Indeterminado' });
  const pRaul = j; revisa(s === 201 && j.clabe === CLABE && j.salario === 520.5, 'Mónica (gerente) da de alta a Raúl con todos sus datos', [s, j]);
  [s, j] = await alta(M, { nombre: 'Diego Hernández Ruiz', puesto: 'Operador', fecha_ingreso: hace(1), licencia_tipo: 'Federal E', licencia_vence: dia(-3) }); const pDiego = j;
  revisa(s === 201 && j.alertas.includes('Licencia vencida'), 'alta de Diego (operador sin cuenta); avisa su licencia vencida', j.alertas);
  [s, j] = await alta(M, { nombre: 'Luis Ángel Pérez', puesto: 'Ayudante', fecha_ingreso: dia(-60) }); const pLuis = j; revisa(s === 201, 'alta de Luis (ayudante)');
  [s, j] = await alta(G, { nombre: 'Óscar Medina Silva', puesto: 'Operador', fecha_ingreso: hace(2), clabe: CLABE2 }); const pOscar = j; revisa(s === 201 && j.sucursal_id === cdmx.id, 'Gerardo da de alta a Óscar en CDMX', j);
  for (const [d, que] of [[{ nombre: 'X', puesto: 'Técnico' }, 'nombre muy corto'], [{ nombre: 'Nombre Sin Puesto' }, 'sin puesto'], [{ nombre: 'Puesto Inventado', puesto: 'Astronauta' }, 'puesto inventado'],
    [{ nombre: 'Clabe Mala', puesto: 'Operador', clabe: '014680655039528946' }, 'CLABE con dígito verificador mal'], [{ nombre: 'Clabe Corta', puesto: 'Operador', clabe: '12345' }, 'CLABE corta'],
    [{ nombre: 'Rfc Malo', puesto: 'Operador', rfc: 'ABC' }, 'RFC inválido'], [{ nombre: 'Curp Mala', puesto: 'Operador', curp: 'XXXX' }, 'CURP inválida'], [{ nombre: 'Nss Malo', puesto: 'Operador', nss: '123' }, 'NSS inválido'],
    [{ nombre: 'Fecha Futura', puesto: 'Operador', fecha_ingreso: dia(5) }, 'ingreso en el futuro'], [{ nombre: 'Fecha Rara', puesto: 'Operador', fecha_ingreso: '2026-02-30' }, 'fecha imposible'],
    [{ nombre: 'Salario Negativo', puesto: 'Operador', salario: -1 }, 'salario negativo'], [{ nombre: '<img src=x onerror=1>', puesto: 'Operador' }, 'nombre con HTML'],
    [{ nombre: 'Raúl Pérez Gómez', puesto: 'Técnico' }, 'nombre repetido de alguien activo'], [{ nombre: 'Otra Cuenta', puesto: 'Técnico', usuario_id: ID.Raul }, 'la misma cuenta en dos fichas'],
    [{ nombre: 'Otra Sucursal', puesto: 'Técnico', sucursal_id: cdmx.id }, 'Mónica (QRO) da de alta en CDMX']]) {
    [s, j] = await alta(M, d); revisa(s >= 400 && s < 500, `se rechaza: ${que} (${s})`, j);
  }

  console.log('2. Quién ve qué (datos sensibles)');
  [s, j, texto] = await pedir('GET', '/personal', S);
  revisa(s === 200 && j.length === 3 && !texto.includes(CLABE) && !/520\.5|PEGR800101|12345678901|BBVA/.test(texto) && j.find(p => p.id === pRaul.id).clabe_mascara === '•••• •••• 8945', 'el supervisor ve la lista sin CLABE, RFC, CURP, NSS, banco ni salario (solo los últimos 4 de la CLABE)', texto.slice(0, 300));
  [s] = await pedir('GET', '/personal', L); revisa(s === 403, 'ventas no ve el personal');
  [s, j] = await pedir('GET', '/personal/para-asignar', L); revisa(s === 200 && j.length === 3 && !JSON.stringify(j).includes('clabe') && !JSON.stringify(j).includes('telefono'), 'para asignar a una orden, ventas solo recibe nombre y puesto', j);
  [s, j] = await pedir('PUT', '/personal/' + pRaul.id, S, { clabe: CLABE2 }); revisa(s === 403, 'el supervisor (sin datos sensibles) no cambia la CLABE', j);
  [s, j] = await pedir('PUT', '/personal/' + pRaul.id, S, { salario: 9999 }); revisa(s === 403, 'ni el salario');
  [s, j] = await pedir('POST', '/personal', S, { nombre: 'Nuevo Con Clabe', puesto: 'Operador', clabe: CLABE2 }); revisa(s === 403, 'ni da de alta con CLABE');
  [s, j] = await pedir('PUT', '/personal/' + pRaul.id, S, { telefono: '442 999 0000', version: pRaul.version }); revisa(s === 200 && j.telefono === '442 999 0000' && !('clabe' in j), 'pero sí corrige el teléfono (y la respuesta tampoco trae lo sensible)', j);
  // Rastreo: el supervisor pide todas las rutas de personal con cada id; nada sensible aparece.
  const rutas = ['/personal', '/personal?estado=todos', '/personal/para-asignar', '/personal/catalogos', ...[pRaul, pDiego, pLuis, pOscar].flatMap(p => ['/personal/' + p.id]), '/auditoria?entidad=personal&id=' + pRaul.id];
  let todo = ''; for (const r of rutas) todo += (await pedir('GET', r, S))[2];
  revisa(!todo.includes(CLABE) && !todo.includes(CLABE2) && !/PEGR800101|12345678901|520\.5|52050/.test(todo), 'rastreo de todas las rutas de personal del supervisor: ningún dato sensible (ni en la bitácora)', todo.slice(0, 200));

  console.log('3. Sucursales');
  [s] = await pedir('GET', '/personal/' + pOscar.id, M); revisa(s === 404, 'Mónica (QRO) abre a Óscar (CDMX) por número: no existe');
  [s] = await pedir('PUT', '/personal/' + pOscar.id, M, { telefono: '1' }); revisa(s === 404, 'ni lo edita');
  [s] = await pedir('POST', '/personal/' + pOscar.id + '/baja', M, { motivo: 'hack hack' }); revisa(s === 404, 'ni lo da de baja');
  [s, j] = await pedir('GET', '/personal', G); revisa(s === 200 && j.length === 1 && j[0].id === pOscar.id, 'Gerardo (CDMX) solo ve a Óscar', j.map?.(p => p.nombre));
  [s, j] = await pedir('GET', '/personal?estado=todos', A); revisa(j.length === 4, 'Dirección ve a todos');
  [s, j] = await pedir('GET', '/personal/usuarios/sin-ficha', G); revisa(s === 200 && !j.some(u => /Monica|Sergio|Laura/.test(u.nombre)), 'para ligar cuentas, Gerardo solo ve usuarios de CDMX', j.map?.(u => u.nombre));
  [s, j] = await pedir('PUT', '/personal/' + pOscar.id, G, { usuario_id: ID.Laura }); revisa(s === 400, 'y no puede ligar a Óscar la cuenta de alguien de Querétaro', j);

  console.log('4. Vacaciones (LFT) e incidencias');
  [s, j] = await pedir('GET', '/personal/' + pRaul.id, M);
  revisa(j.vacaciones.anios === 3 && j.vacaciones.corresponden === 16 && j.vacaciones.disponibles === 16, '3 años de antigüedad: le corresponden 16 días (LFT)', j.vacaciones);
  const { diasLFT } = require('../server/personal.js');
  revisa([1, 2, 3, 4, 5, 6, 10, 11, 15, 16, 21, 26, 31].map(diasLFT).join() === '12,14,16,18,20,22,22,24,24,26,28,30,32', 'tabla de la LFT: 12,14,16,18,20 y luego +2 cada 5 años');
  [s, j] = await pedir('POST', '/personal/' + pRaul.id + '/incidencias', M, { tipo: 'vacaciones', fecha_inicio: dia(-20), fecha_fin: dia(-16) });
  revisa(s === 201 && j.vacaciones.disponibles === 11, '5 días de vacaciones: le quedan 11', j);
  [s, j] = await pedir('POST', '/personal/' + pRaul.id + '/incidencias', M, { tipo: 'falta', fecha_inicio: dia(-18), fecha_fin: dia(-18) }); revisa(s === 409 && j.codigo === 'EMPALME', 'una falta dentro de sus vacaciones: se avisa del empalme', j);
  [s, j] = await pedir('POST', '/personal/' + pRaul.id + '/incidencias', M, { tipo: 'vacaciones', fecha_inicio: dia(1), fecha_fin: dia(30) }); revisa(s === 409 && j.codigo === 'SIN_DIAS', 'pedir 30 días con 11 disponibles: se avisa', j);
  [s, j] = await pedir('POST', '/personal/' + pLuis.id + '/incidencias', M, { tipo: 'vacaciones', fecha_inicio: dia(1), fecha_fin: dia(2) }); revisa(s === 409, 'Luis (2 meses) aún no tiene vacaciones por ley', j);
  [s, j] = await pedir('POST', '/personal/' + pDiego.id + '/incidencias', S, { tipo: 'incapacidad', fecha_inicio: dia(-5), fecha_fin: dia(-3), con_goce: false }); const incDiego = j.id; revisa(s === 201, 'el supervisor registra una incapacidad');
  for (const [b, que] of [[{ tipo: 'fiesta', fecha_inicio: HOY }, 'tipo inventado'], [{ tipo: 'falta', fecha_inicio: dia(2), fecha_fin: dia(1) }, 'fin antes del inicio'], [{ tipo: 'falta', fecha_inicio: '2026-13-01' }, 'fecha imposible'],
    [{ tipo: 'falta', fecha_inicio: dia(-40), fecha_fin: dia(-40), dias: 3 }, 'más días que el periodo'], [{ tipo: 'falta', fecha_inicio: dia(-50), fecha_fin: dia(-50), dias: 0.3 }, 'días que no son medios días']]) {
    [s] = await pedir('POST', '/personal/' + pDiego.id + '/incidencias', M, b); revisa(s === 400, `incidencia rechazada: ${que}`, s);
  }
  [s] = await pedir('POST', '/personal/' + pDiego.id + '/incidencias', L, { tipo: 'falta', fecha_inicio: HOY }); revisa(s === 403, 'ventas no registra incidencias');
  [s] = await pedir('POST', '/personal/incidencias/' + incDiego + '/cancelar', M, {}); revisa(s === 400, 'cancelar pide motivo');
  [s] = await pedir('POST', '/personal/incidencias/' + incDiego + '/cancelar', G, { motivo: 'hack hack' }); revisa(s === 404, 'Gerardo (CDMX) no cancela incidencias de QRO');
  [s] = await pedir('POST', '/personal/incidencias/' + incDiego + '/cancelar', M, { motivo: 'Se capturó mal' }); revisa(s === 200, 'Mónica la cancela con motivo');

  console.log('5. Documentos del expediente');
  const pdf = Buffer.from('%PDF-1.4\n% INE de Raúl ' + Math.random() + '\n%%EOF');
  [s, j] = await subir('/personal/' + pRaul.id + '/documentos', M, pdf, { 'X-Tipo': 'ine', 'X-Nombre': 'INE Raúl.pdf' }); const doc = j.id; revisa(s === 201, 'Mónica sube la INE de Raúl', j);
  [s, j] = await subir('/personal/' + pRaul.id + '/documentos', M, pdf, { 'X-Tipo': 'ine', 'X-Nombre': 'otra vez.pdf' }); revisa(s === 409, 'el mismo archivo dos veces no');
  [s] = await subir('/personal/' + pRaul.id + '/documentos', M, Buffer.from('MZ ejecutable'), { 'X-Tipo': 'ine', 'X-Nombre': 'virus.exe' }); revisa(s === 400, 'un archivo que no es PDF ni imagen no');
  [s] = await subir('/personal/' + pRaul.id + '/documentos', S, Buffer.from('%PDF-1.4\n% x\n%%EOF'), { 'X-Tipo': 'ine', 'X-Nombre': 'x.pdf' }); revisa(s === 403, 'el supervisor (sin datos sensibles) no sube al expediente');
  [s] = await pedir('GET', '/personal/documentos/' + doc, S); revisa(s === 403, 'ni lo descarga');
  [s] = await pedir('GET', '/personal/documentos/' + doc, G); revisa(s === 404, 'Gerardo (CDMX) tampoco');
  [s, , texto] = await pedir('GET', '/personal/documentos/' + doc, M); revisa(s === 200 && texto.includes('INE de Raúl'), 'Mónica sí lo descarga');
  [s] = await pedir('POST', '/personal/documentos/' + doc + '/quitar', M, {}); revisa(s === 200, 'y lo quita (se conserva en el servidor y en la bitácora)');

  console.log('6. Equipo de la orden y técnico responsable');
  const [, cli] = await pedir('POST', '/contactos', L, { nombre: 'Lic. Cliente Prueba', telefono: '442 222 3344', empresa_contacto: 'Planta Prueba', direccion: 'Querétaro', canal_origen_id: canales[0].id });
  [s, j] = await pedir('POST', '/leads', L, { cliente_id: cli.id, direccion: 'Planta', canal_id: canales[0].id, servicio_id: SERV.id, responsable_id: ID.Laura, partidas_json: partidas('Desazolve', 5000), iva_modo: 'mas_iva', valor: 5000, estatus: 'ganado', fecha_servicio: HOY });
  const orden = j; revisa(s === 201, 'Laura registra una orden');
  const v = async () => (await pedir('GET', '/leads/' + orden.id, A))[1].version;
  [s] = await pedir('GET', '/leads/' + orden.id, R); revisa(s === 404, 'Raúl todavía no la ve (no está asignado)');
  [s, j] = await pedir('PUT', '/leads/' + orden.id, L, { version: await v(), equipo_personal: [{ personal_id: pRaul.id, papel: 'responsable' }, { personal_id: pDiego.id, papel: 'operador' }, { personal_id: pLuis.id, papel: 'ayudante' }] });
  revisa(s === 200 && j.tecnico_id === ID.Raul, 'Laura arma el equipo: Raúl responsable, Diego operador, Luis ayudante', j.tecnico_id);
  [s, j] = await pedir('GET', '/leads/' + orden.id, R); revisa(s === 200 && j.equipo_personal.length === 3, 'Raúl ya ve su orden con su equipo');
  revisa(j.historial.some(h => /^Equipo: sin equipo → Raúl Pérez Gómez \(técnico responsable\)/.test(h.texto)), 'la bitácora de la orden dice quién quedó en el equipo', j.historial.map(h => h.texto).slice(0, 4));
  for (const [eq, que] of [[[{ personal_id: pRaul.id, papel: 'responsable' }, { personal_id: pDiego.id, papel: 'responsable' }], 'dos responsables'], [[{ personal_id: pOscar.id, papel: 'operador' }], 'alguien de CDMX'],
    [[{ personal_id: pRaul.id, papel: 'responsable' }, { personal_id: pRaul.id, papel: 'operador' }], 'la misma persona dos veces'], [[{ personal_id: 99999, papel: 'operador' }], 'alguien que no existe'],
    [[{ personal_id: pDiego.id, papel: 'jefe' }], 'un papel inventado'], ['Raúl', 'texto en vez de lista']]) {
    [s] = await pedir('PUT', '/leads/' + orden.id, L, { version: await v(), equipo_personal: eq }); revisa(s === 400, `equipo rechazado: ${que}`, s);
  }
  // Al desligar la cuenta de Raúl, deja de ver la orden; al ligarla de nuevo, la vuelve a ver.
  let ficha = (await pedir('GET', '/personal/' + pRaul.id, M))[1];
  [s] = await pedir('PUT', '/personal/' + pRaul.id, M, { usuario_id: null, version: ficha.version }); revisa(s === 200, 'Mónica desliga la cuenta de Raúl de su ficha');
  [s] = await pedir('GET', '/leads/' + orden.id, R); revisa(s === 404, 'Raúl (su cuenta) ya no ve la orden');
  ficha = (await pedir('GET', '/personal/' + pRaul.id, M))[1];
  [s] = await pedir('PUT', '/personal/' + pRaul.id, M, { usuario_id: ID.Raul, version: ficha.version }); revisa(s === 200, 'y la vuelve a ligar');
  [s] = await pedir('GET', '/leads/' + orden.id, R); revisa(s === 200, 'Raúl la vuelve a ver');
  [s] = await pedir('PUT', '/personal/' + pRaul.id, M, { telefono: 'x', version: 1 }); revisa(s === 409, 'guardar la ficha con una versión vieja: se avisa');
  // Baja con desactivación de acceso.
  [s, j] = await pedir('POST', '/personal/' + pRaul.id + '/baja', M, { motivo: 'Renuncia voluntaria', desactivar_usuario: true });
  revisa(s === 200 && j.acceso_desactivado && j.ordenes_abiertas === 1, 'baja de Raúl: se le quita el acceso y avisa que era responsable de 1 orden por realizar', j);
  [s] = await pedir('GET', '/permisos/mios', R); revisa(s === 401, 'su sesión ya no sirve');
  [s, j] = await pedir('PUT', '/leads/' + orden.id, L, { version: await v(), equipo_personal: [{ personal_id: pRaul.id, papel: 'responsable' }] }); revisa(s === 400, 'alguien dado de baja ya no se asigna');
  [s, j] = await pedir('GET', '/personal/para-asignar', L); revisa(!j.some(p => p.id === pRaul.id), 'ni aparece para asignar');
  [s, j] = await pedir('GET', '/personal?estado=bajas', M); revisa(j.some(p => p.id === pRaul.id && p.motivo_baja === 'Renuncia voluntaria'), 'queda en «Dados de baja» con su motivo');
  [s] = await pedir('POST', '/personal/' + pRaul.id + '/reactivar', M, {}); revisa(s === 200, 'reingreso');
  [s, j] = await pedir('GET', '/auditoria?entidad=personal&id=' + pRaul.id, M);
  const bit = JSON.stringify(j);
  revisa(/alta/.test(bit) && /baja/.test(bit) && /reingreso/.test(bit) && /vacaciones/.test(bit) && !bit.includes(CLABE), 'la bitácora de Raúl tiene alta, vacaciones, baja y reingreso (sin la CLABE completa)', bit.slice(0, 200));
  [s, j] = await pedir('GET', '/admin/integridad', A); revisa(s === 200 && JSON.stringify(j).includes('Licencias de manejo vencidas') && JSON.stringify(j).includes('Diego Hernández Ruiz'), 'la revisión de integridad avisa la licencia vencida de Diego');

  srv.kill();
  console.log(`\n${n - malos.length}/${n} correctas`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e, salida.slice(-1500)); srv.kill(); process.exit(1); });
