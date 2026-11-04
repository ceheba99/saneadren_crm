// MARKETING · LLAMADAS DE GOOGLE ADS (2026-11-04): carga del reporte «Detalles de las llamadas» (vista previa, errores
// por renglón, sin duplicar al volver a subir) y su cruce con los contactos por teléfono a 10 dígitos: registrada (alta del
// contacto o de su cotización entre el día de la llamada y 7 días después), cliente que ya existía, sin registrar y sin
// número; órdenes ganadas e importe sin IVA (cada cotización una sola vez); totales por campaña, lada, horario, estado y
// sucursal; y quién lo ve (solo Dirección y el Gerente de marketing). Todos los números son inventados.
// Uso: node tests/simulacion-google-ads.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const GA = require('../server/marketing-google-ads');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-gads-')), DB = path.join(dir, 'sim.db');
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Llamadas-' + Math.random().toString(36).slice(2) + '-7Q' };
const CLAVE = 'Clave-Llamadas-2026x';
const PUERTO = String(9300 + Math.floor(Math.random() * 150)), URL = 'http://localhost:' + PUERTO + '/api';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
let salida = ''; srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => {
  const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  let j = {}; try { j = await x.json(); } catch { /* */ } return [x.status, j];
};
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 700) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const D = k => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'], MES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const corto = (f, h) => { const [a, m, d] = f.split('-').map(Number); return `"${d} ${MES[m - 1]} ${a}, ${h}:00:00"`; };
const largo = f => { const [a, m, d] = f.split('-').map(Number); return `${d} de ${MES_L[m - 1]} de ${a}`; };
const CAB = 'Hora de inicio,Duración (segundos),Código de país de la persona que llama,Prefijo de la persona que llama,Número de teléfono de la persona que llama,Grabación,Estado,Fuente de la llamada,Tipo de llamada,Campaña';
const fila = (f, h, dur, pais, pre, tel, estado, campana) => `${corto(f, h)},${dur},${pais}, ${pre}, ${tel},No disponible,${estado},Anuncio,Clics de llamada de móviles,${campana}`;
const reporte = filas => ['Detalles de las llamadas', `${largo(D(-12))} - ${largo(D(-1))}`, CAB, ...filas].join('\n');

(async () => {
  console.log('1. Lectura del formato de Google Ads (sin servidor)');
  revisa(JSON.stringify(GA.leerHora('3 oct 2026, 14:00:00')) === JSON.stringify({ fecha: '2026-10-03', hora: 14, minuto: 0 }), '«3 oct 2026, 14:00:00» → 3 de octubre, 14 h');
  revisa(GA.leerHora('3 oct. 2026, 9:00:00')?.hora === 9 && GA.leerHora('12 sept 2026, 23:00:00')?.fecha === '2026-09-12' && GA.leerHora('1 Dic 2026, 00:00:00')?.fecha === '2026-12-01', 'acepta «oct.», «sept», mayúsculas y medianoche');
  revisa(GA.leerHora('31 feb 2026, 9:00:00') === null && GA.leerHora('3 octu 2026, 9:00') === null && GA.leerHora('2026-10-03 09:00') === null && GA.leerHora('3 oct 2026, 25:00:00') === null, 'rechaza fechas imposibles, meses que no existen, otro formato y horas fuera de rango');
  revisa(JSON.stringify(GA.leerRango('1 de octubre de 2026 - 26 de octubre de 2026')) === JSON.stringify({ desde: '2026-10-01', hasta: '2026-10-26' }), 'entiende el rango de la línea 2');
  { const r = GA.leerReporte(reporte([fila('2026-10-03', 14, 142, 52, 55, '+52 55 1111 2222', 'Recibida', 'Campaña Febrero 2026'), '"3 oct 2026, 14:00:00",0,52, --, --,No disponible,Perdida,Anuncio,Clics de llamada de móviles,Campaña Febrero 2026']));
    revisa(r.llamadas.length === 2 && r.llamadas[0].telefono_10 === '5511112222' && r.llamadas[0].lada === 'cdmx' && r.llamadas[1].lada === 'sin_numero' && r.llamadas[1].telefono_10 === '', 'el ejemplo del formato: número a 10 dígitos, lada CDMX y «--» como sin número', r.llamadas); }
  { const r = GA.leerReporte('hola,mundo\n1,2'); revisa(/Hora de inicio/.test(r.error || ''), 'un CSV que no es el reporte se rechaza con un mensaje claro', r); }
  { const r = GA.leerReporte(['Detalles', 'x', CAB.replace(',Campaña', '')].join('\n')); revisa(/Campaña/.test(r.error || ''), 'si falta una columna, dice cuál', r); }

  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }))[1].token;
  let s, j;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  const cdmx = (await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX' }))[1];
  const T = {};
  for (const [nombre, rol] of [['Mara Marketing', 'marketing'], ['Gil Mercadotecnia', 'marketing_gerente'], ['Gema Gerente', 'gerente'], ['Vale Ventas', 'ventas']]) {
    await pedir('POST', '/usuarios', A, { nombre, password: CLAVE, rol, sucursales: [qro.id] });
    T[nombre.split(' ')[0]] = (await pedir('POST', '/login', null, { nombre, password: CLAVE }))[1].token;
  }
  const [, canales] = await pedir('GET', '/canales', A), [, servicios] = await pedir('GET', '/servicios', A);
  const YO = (await pedir('GET', '/permisos/mios', A))[1].usuario_id;
  const contacto = async (nombre, tel) => (await pedir('POST', '/contactos', A, { nombre, telefono: tel, direccion: 'Querétaro', canal_origen_id: canales[0].id }))[1];
  const cotizar = async (cli, imp, ganada) => { const [st, x] = await pedir('POST', '/leads', A, { cliente_id: cli.id, direccion: 'Querétaro', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: YO,
    partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Servicio', importe: imp }]), iva_modo: 'mas_iva', valor: imp, forzar_duplicado: true, ...(ganada ? { estatus: 'ganado', fecha_servicio: D(1) } : {}) }); if (st !== 201 && st !== 200) throw new Error('No se pudo cotizar: ' + JSON.stringify(x)); return x; };
  // Contactos y cotizaciones, con su fecha de alta puesta a propósito.
  const c1 = await contacto('Antiguo Uno', '442 300 0001'), l1 = await cotizar(c1, 800);          // ya existía (alta hace 20 días)
  const l1b = await cotizar(c1, 2500, true);                                                     // … y cotizó de nuevo 3 días después de volver a llamar
  const c2 = await contacto('Nuevo Dos', '442 300 0002'), l2 = await cotizar(c2, 1000, true);   // se registró al día siguiente de llamar y compró
  const c3 = await contacto('Tardío Tres', '55 3000 0003');                                      // se registró 8 días después: sin registrar
  const c5 = await contacto('Otro Teléfono Cinco', '442 300 0005');                              // llamó desde su otro teléfono (CDMX)
  const c6 = await contacto('Abierta Seis', '442 300 0006'), l6 = await cotizar(c6, 4321);      // cotización abierta, no ganada
  { const d = new DatabaseSync(DB), alta = (t, id, f) => d.prepare(`UPDATE ${t} SET created_at = ? WHERE id = ?`).run(f + ' 10:00:00', id);
    alta('clientes', c1.id, D(-20)); alta('leads', l1.id, D(-20)); alta('leads', l1b.id, D(-2));
    alta('clientes', c2.id, D(-9)); alta('leads', l2.id, D(-9));
    alta('clientes', c3.id, D(-2)); alta('clientes', c5.id, D(-10)); alta('clientes', c6.id, D(-7)); alta('leads', l6.id, D(-7));
    d.prepare('UPDATE clientes SET sucursal_id = ? WHERE id = ?').run(cdmx.id, c5.id);
    d.prepare("INSERT INTO telefonos_cliente (telefono_normalizado, cliente_id, telefono, etiqueta) VALUES ('5530000055', ?, '55 3000 0055', 'Celular')").run(c5.id);
    d.close(); }

  console.log('2. Vista previa y carga');
  const FILAS = [
    fila(D(-10), 9, 120, 52, 442, '+52 442 300 0001', 'Recibida', 'Querétaro'),     // ya existía
    fila(D(-10), 11, 95, 52, 442, '+52 442 300 0002', 'Recibida', 'Querétaro'),     // registrada, ganada $1,000
    fila(D(-8), 16, 30, 52, 442, '+52 442 300 0002', 'Recibida', 'Querétaro'),      // ya era cliente (se registró el día anterior): no vuelve a contar la orden
    fila(D(-10), 12, 60, 52, 55, '+52 55 3000 0003', 'Recibida', 'CDMX'),           // sin registrar (se dio de alta 8 días después)
    fila(D(-5), 10, 200, 52, 442, '+52 442 300 0001', 'Recibida', 'Querétaro'),      // cliente viejo, nueva cotización ganada $2,500 → registrada
    fila(D(-10), 13, 45, 52, 55, '+52 55 3000 0055', 'Recibida', 'CDMX'),           // registrada por su otro teléfono; sucursal CDMX
    fila(D(-7), 17, 15, 52, 442, '+52 442 300 0006', 'Recibida', 'Querétaro'),       // registrada, cotización abierta
    fila(D(-6), 18, 0, 52, 55, '+52 55 9999 0001', 'Perdida', 'CDMX'),              // sin registrar, dos veces igual en la misma hora
    fila(D(-6), 18, 0, 52, 55, '+52 55 9999 0001', 'Perdida', 'CDMX'),
    `${corto(D(-3), 20)},0,52, --, --,No disponible,Perdida,Anuncio,Clics de llamada de móviles,CDMX`,         // sin número (dos iguales)
    `${corto(D(-3), 20)},0,52, --, --,No disponible,Perdida,Anuncio,Clics de llamada de móviles,CDMX`,
    fila(D(-4), 9, 33, 1, 512, '+1 512-555-0147', 'Recibida', 'Querétaro'),          // de EUA, no está en el CRM
    '"31 feb 2026, 10:00:00",10,52, 55, +52 55 1234 5678,No disponible,Recibida,Anuncio,Clics,CDMX',      // error: fecha imposible
    `${corto(D(-3), 10)},diez,52, 55, +52 55 1234 5678,No disponible,Recibida,Anuncio,Clics,CDMX`,         // error: duración
    `${corto(D(-3), 10)},10,52, 55, +52 55 1234 56,No disponible,Recibida,Anuncio,Clics,CDMX`,             // error: número corto
  ];
  const CSV = reporte(FILAS);
  [s, j] = await pedir('POST', '/marketing/google-ads/vista-previa', T.Gil, { csv: CSV });
  revisa(s === 200 && j.resumen.validas === 12 && j.resumen.nuevas === 12 && j.resumen.repetidas === 0 && j.resumen.con_error === 3, 'vista previa: 12 llamadas buenas y nuevas, 3 renglones con error', j.resumen || j);
  revisa(JSON.stringify(j.errores?.map(e => e.fila)) === '[16,17,18]' && /Hora de inicio/.test(j.errores[0].error) && /Duración/.test(j.errores[1].error) && /10 dígitos/.test(j.errores[2].error), 'cada error dice su renglón del archivo y qué pasa', j.errores);
  revisa(j.rango?.desde === D(-12) && j.rango?.hasta === D(-1) && j.resumen.recibidas === 8 && j.resumen.perdidas === 4 && j.resumen.sin_numero === 2 && j.resumen.cdmx === 4, 'lee el periodo, recibidas, perdidas, sin número y lada 55/56', { rango: j.rango, r: j.resumen });
  { const d = new DatabaseSync(DB); revisa(d.prepare('SELECT COUNT(*) n FROM google_ads_llamadas').get().n === 0, 'la vista previa no guarda nada'); d.close(); }
  [s, j] = await pedir('POST', '/marketing/google-ads/cargar', T.Gil, { csv: CSV, archivo: 'llamadas.csv' });
  revisa(s === 200 && j.resumen.nuevas === 12 && j.desde === D(-12), 'se guardan las 12 llamadas', j);
  [s, j] = await pedir('POST', '/marketing/google-ads/cargar', A, { csv: CSV });
  revisa(s === 200 && j.resumen.nuevas === 0 && j.resumen.repetidas === 12, 'subir otra vez el mismo periodo no duplica nada (las 2 llamadas iguales siguen siendo 2)', j.resumen);
  [s, j] = await pedir('POST', '/marketing/google-ads/cargar', A, { csv: reporte([FILAS[0], FILAS[7], fila(D(-1), 8, 50, 52, 33, '+52 33 1111 0000', 'Recibida', 'Querétaro')]) });
  revisa(s === 200 && j.resumen.nuevas === 1 && j.resumen.repetidas === 2, 'un reporte que se encima con el anterior solo agrega la llamada nueva', j.resumen);
  { const d = new DatabaseSync(DB); revisa(d.prepare('SELECT COUNT(*) n FROM google_ads_llamadas').get().n === 13 && d.prepare('SELECT COUNT(*) n FROM google_ads_cargas').get().n === 3, 'quedan 13 llamadas y 3 cargas en el historial'); d.close(); }
  [s, j] = await pedir('POST', '/marketing/google-ads/cargar', A, { csv: 'Hora,Otra\n1,2' }); revisa(s === 400 && /Hora de inicio/.test(j.error), 'un archivo equivocado no se carga y avisa por qué', j);
  [s, j] = await pedir('POST', '/marketing/google-ads/cargar', A, { csv: '' }); revisa(s === 400, 'sin archivo: 400', j);
  [s, j] = await pedir('POST', '/marketing/google-ads/cargar', A, { csv: { a: 1 } }); revisa(s === 400, 'un «csv» que no es texto: 400', j);

  console.log('3. Cruce con el CRM');
  [s, j] = await pedir('GET', '/marketing/google-ads', T.Gil);
  revisa(s === 200 && j.desde === D(-12) && j.hasta === D(-1), 'sin fechas, muestra el periodo del último reporte subido', { desde: j.desde, hasta: j.hasta });
  const cruce = Object.fromEntries((j.cruces || []).map(c => [c.clave, c.llamadas]));
  revisa(cruce.registrada === 4 && cruce.ya_existia === 2 && cruce.sin_registrar === 5 && cruce.sin_numero === 2, 'registradas 4, ya existían 2 (una, la segunda llamada de quien se acababa de registrar), sin registrar 5 (incluye la de EUA y la de lada 33), sin número 2', cruce);
  revisa(j.total.llamadas === 13 && j.total.ganadas === 2 && j.total.importe_cent === 350000, 'terminaron en orden 2 llamadas y suman $3,500 sin IVA (la orden de Nuevo Dos cuenta una sola vez)', j.total);
  const camp = Object.fromEntries(j.campanas.map(c => [c.campana, c]));
  revisa(camp['Querétaro']?.llamadas === 7 && camp['Querétaro'].registradas === 3 && camp['Querétaro'].importe_cent === 350000 && camp.CDMX?.llamadas === 6 && camp.CDMX.registradas === 1 && camp.CDMX.sin_numero === 2, 'totales por campaña', j.campanas);
  const lada = Object.fromEntries(j.ladas.map(c => [c.clave, c.llamadas]));
  revisa(lada.cdmx === 4 && lada.otra === 6 && lada.extranjero === 1 && lada.sin_numero === 2, 'por lada: 4 CDMX (55/56), 6 de otras, 1 del extranjero y 2 sin número', lada);
  revisa(j.otras_ladas.find(x => x.lada === '442')?.nombre === 'Querétaro' && j.otras_ladas.find(x => x.lada === '442').llamadas === 5, 'las otras ladas por sus 3 primeros números (442 Querétaro)', j.otras_ladas);
  revisa(j.horario.find(x => x.hora === 18)?.perdidas === 2 && j.horario.every(x => x.llamadas > 0), 'por horario: las 18:00 con sus 2 perdidas; solo horas con llamadas', j.horario);
  revisa(j.estados.find(x => x.estado === 'Recibida')?.llamadas === 9 && j.estados.find(x => x.estado === 'Perdida')?.llamadas === 4, 'por estado (como lo da Google)', j.estados);
  const suc = Object.fromEntries(j.sucursales.map(x => [x.sucursal, x.llamadas]));
  revisa(suc[qro.nombre] === 5 && suc['Ciudad de México'] === 1 && suc['Sin sucursal (no registradas)'] === 7, 'sucursal = la del contacto; las no registradas, «sin sucursal»', suc);
  revisa(j.aviso.sin_sucursal === 7 && j.aviso.cdmx === 3 && j.aviso.numeros_distintos === 4, 'aviso: 7 sin sucursal, 3 de ellas lada CDMX, 4 números distintos', j.aviso);
  const lista = Object.fromEntries(j.sin_registrar.map(x => [x.telefono_10, x]));
  revisa(lista['5599990001']?.veces === 2 && lista['5530000003'] && lista['5125550147']?.lada === 'extranjero' && !lista['4423000001'] && !lista['4423000002'], 'lista de números sin registrar (cada número una vez, con cuántas veces llamó)', j.sin_registrar);
  revisa(!JSON.stringify(j).match(/Antiguo Uno|Nuevo Dos|Abierta Seis|Otro Teléfono/), 'el reporte no muestra nombres de contactos del CRM');
  [s, j] = await pedir('GET', '/marketing/google-ads?' + new URLSearchParams({ desde: D(-12), hasta: D(-1), campana: 'CDMX' }), T.Gil);
  revisa(s === 200 && j.total.llamadas === 6 && j.lista_campanas.length === 2, 'filtro por campaña (y la lista de campañas completa para elegir)', j.total);
  [s, j] = await pedir('GET', '/marketing/google-ads?' + new URLSearchParams({ desde: D(-6), hasta: D(-5) }), T.Gil);
  revisa(s === 200 && j.total.llamadas === 3, 'filtro por fechas', j.total);
  [s] = await pedir('GET', '/marketing/google-ads?desde=2026-13-01&hasta=2026-10-01', T.Gil); revisa(s === 400, 'fechas imposibles: 400');
  // Se registra después: la llamada que estaba «sin registrar» cambia sola (el cruce no se guarda).
  { const d = new DatabaseSync(DB); d.prepare('UPDATE clientes SET created_at = ? WHERE id = ?').run(D(-6) + ' 09:00:00', c3.id); d.close(); }
  [s, j] = await pedir('GET', '/marketing/google-ads', A);
  revisa(Object.fromEntries(j.cruces.map(c => [c.clave, c.llamadas])).registrada === 5, 'si el contacto se registra dentro de los 7 días, la llamada pasa a «registrada» sin volver a subir nada', j.cruces);

  console.log('4. Quién lo ve (regla 2026-11-04)');
  for (const [k, quien] of [['Mara', 'Marketing'], ['Gema', 'Gerente'], ['Vale', 'Ventas']]) {
    const r = await Promise.all([pedir('GET', '/marketing/google-ads', T[k]), pedir('POST', '/marketing/google-ads/vista-previa', T[k], { csv: CSV }), pedir('POST', '/marketing/google-ads/cargar', T[k], { csv: CSV })]);
    revisa(r.every(([st]) => st === 403), `${quien} no ve ni carga las llamadas de Google Ads`, r.map(x => x[0]));
  }
  [s] = await pedir('GET', '/marketing/google-ads'); revisa(s === 401, 'sin sesión: 401');

  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|Error en (GET|POST|PUT|DELETE)/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 5));
  srv.kill();
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e, salida.slice(-1500)); srv.kill(); process.exit(1); });
