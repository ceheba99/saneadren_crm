// Uso: node tests/simulacion-duplicados-dinero.cjs   (base temporal; no toca saneadren.db)
// Etapa 4 de la auditoría: duplicados de dinero.
//   A-02    · subir dos veces el mismo Excel de cuentas por pagar o por cobrar no debe crear nada nuevo.
//   M-09    · el mismo gasto (de contado o a crédito sin folio) enviado dos veces seguidas pide confirmar.
//   FLW-H07 · «Repetir» no se permite en la cuenta de una orden de compra ni en un costo de una orden de servicio.
// Y lo legítimo sigue: la misma renta de cada mes se captura, se importa y se repite.
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-duplicados-')); const PUERTO = String(4300 + Math.floor(Math.random() * 400));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Duplicados-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'd.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
const sec = t => console.log('\n== ' + t);
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const mesAntes = (f, k) => { const [a, m] = f.split('-').map(Number), d = new Date(Date.UTC(a, m - 1 - k, 5)); return d.toISOString().slice(0, 10); };
const F1 = mesAntes(HOY, 2), F2 = mesAntes(HOY, 1); // día 5 de hace dos meses y de hace un mes

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  await require('./ayuda-alcance.cjs').comoAntes(pedir, A);
  let s, j;
  const cxp = async () => (await pedir('GET', '/finanzas/cxp?vista=todas', A))[1];
  const deConcepto = async c => (await cxp()).filter(x => x.concepto === c);
  const pagadoDe = lista => lista.reduce((t, x) => t + x.pagado, 0);

  sec('A-02 · Excel de cuentas por pagar subido dos veces');
  const filaCxp = { proveedor: 'Gasolinera Duplicada', concepto: 'Diésel pipa 3 sin factura', fecha_documento: F1, total: 1500, pagado: 1500, metodo: 'efectivo' };
  [s, j] = await pedir('POST', '/finanzas/importar/cxp', A, { filas: [filaCxp] });
  revisa(s === 201 && j.importadas === 1, '1.ª carga: se importa el renglón sin folio', [s, j]);
  [s, j] = await pedir('POST', '/finanzas/importar/cxp', A, { filas: [filaCxp] });
  revisa(j.importadas === 0, '2.ª carga idéntica: 0 importadas', [s, j]);
  let lista = await deConcepto(filaCxp.concepto);
  revisa(lista.length === 1 && pagadoDe(lista) === 1500, 'en la base sigue 1 sola cuenta y $1,500 pagados (no 2 y $3,000)', lista.map(x => [x.id, x.total, x.pagado]));

  sec('A-02 · reglas de Dirección (12-nov): el Excel que va creciendo y renglones iguales en un archivo');
  [s, j] = await pedir('POST', '/finanzas/importar/cxp?simular=1', A, { filas: [filaCxp] });
  revisa(s === 200 && j.omitidas === 1 && /Ya se había subido/.test(j.resumen[0].omitida || ''), 'la vista previa dice que el renglón ya se había subido', [s, j]);
  const nuevaFila = { ...filaCxp, concepto: 'Diésel pipa 5 sin factura', fecha_documento: F2 };
  [s, j] = await pedir('POST', '/finanzas/importar/cxp', A, { filas: [filaCxp, nuevaFila] });
  revisa(s === 201 && j.importadas === 1 && j.omitidas === 1, 'archivo con un renglón viejo y uno nuevo: se brinca el viejo y se importa solo el nuevo', [s, j]);
  const gemela = { proveedor: 'Gasolinera Duplicada', concepto: 'Carga de diésel', fecha_documento: F2, total: 700, pagado: 700, metodo: 'efectivo' };
  [s, j] = await pedir('POST', '/finanzas/importar/cxp', A, { filas: [gemela, { ...gemela }] });
  revisa(s === 201 && j.importadas === 2, 'dos renglones iguales del mismo archivo son dos gastos distintos', [s, j]);
  [s, j] = await pedir('POST', '/finanzas/importar/cxp', A, { filas: [gemela, { ...gemela }] });
  revisa(j.importadas === 0 && j.omitidas === 2, 'volver a subir ese archivo: los dos se reconocen como ya subidos', [s, j]);
  [s, j] = await pedir('POST', '/finanzas/importar/cxp', A, { filas: [gemela, { ...gemela }, { ...gemela }] });
  revisa(j.importadas === 1 && j.omitidas === 2, 'si ahora trae una tercera carga igual, solo esa se importa', [s, j]);
  revisa((await deConcepto('Carga de diésel')).length === 3, 'quedan 3 cargas de diésel');
  const conFolio = { proveedor: 'Gasolinera Duplicada', concepto: 'Factura de aceite', factura_folio: 'A-778', fecha_documento: F2, total: 1200 };
  [s, j] = await pedir('POST', '/finanzas/importar/cxp', A, { filas: [conFolio] });
  [s, j] = await pedir('POST', '/finanzas/importar/cxp', A, { filas: [conFolio, { ...nuevaFila, concepto: 'Diésel pipa 6 sin factura' }] });
  revisa(s === 201 && j.importadas === 1 && j.omitidas === 1, 'un renglón con folio ya subido también se brinca (antes detenía todo el archivo)', [s, j]);
  [s, j] = await pedir('POST', '/finanzas/importar/cxp', A, { filas: [{ ...conFolio, total: 1300 }] });
  revisa(s === 200 && j.importadas === 0 && /ya está registrada/.test(JSON.stringify(j.errores)), 'el mismo folio con otro monto sigue siendo error (no es el mismo renglón)', [s, j]);

  sec('A-02 · Excel de cobranza subido dos veces');
  const filaCxc = { nombre: 'Hotel Duplicado Prueba', fecha: F1, subtotal: 2000, iva: 320, total: 2320, status: 'PAGADO' };
  [s, j] = await pedir('POST', '/finanzas/importar/cxc', A, { filas: [filaCxc] });
  revisa(s === 201 && j.importadas === 1, '1.ª carga: se importa el renglón sin folio', [s, j]);
  [s, j] = await pedir('POST', '/finanzas/importar/cxc', A, { filas: [filaCxc] });
  revisa(j.importadas === 0, '2.ª carga idéntica: 0 importadas', [s, j]);
  const cartera = (await pedir('GET', '/finanzas/cartera?filtro=todas', A))[1];
  const ordenesHotel = (Array.isArray(cartera) ? cartera : cartera.cuentas || []).filter(c => /Hotel Duplicado Prueba/.test(c.cliente_nombre || c.nombre || ''));
  revisa(ordenesHotel.length === 1, 'en la base sigue 1 sola orden del cliente (no 2)', ordenesHotel.map(c => [c.lead_id, c.total, c.cobrado]));
  [s, j] = await pedir('POST', '/finanzas/importar/cxc', A, { filas: [filaCxc, { ...filaCxc, fecha: F2 }] });
  revisa(s === 201 && j.importadas === 1 && j.omitidas === 1, 'cobranza: se brinca lo ya subido y entra la factura del otro mes', [s, j]);

  sec('A-02 · lo legítimo: la misma renta en otro mes sí se importa');
  const renta = { proveedor: 'Inmobiliaria Renta Fija', concepto: 'Renta de bodega', fecha_documento: F1, total: 8000, pagado: 8000, metodo: 'transferencia' };
  [s, j] = await pedir('POST', '/finanzas/importar/cxp', A, { filas: [renta] });
  revisa(s === 201 && j.importadas === 1, 'renta del mes 1 se importa', [s, j]);
  [s, j] = await pedir('POST', '/finanzas/importar/cxp', A, { filas: [{ ...renta, fecha_documento: F2 }] });
  revisa(s === 201 && j.importadas === 1, 'renta del mes 2 (mismo proveedor, concepto y monto) se importa', [s, j]);
  revisa((await deConcepto('Renta de bodega')).length === 2, 'quedan 2 rentas, una por mes');

  sec('M-09 · el mismo gasto enviado dos veces seguidas');
  const [, prov] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Refaccionaria Doble Envío', categoria: 'otro', dias_credito: 0 });
  const gasto = { proveedor_id: prov.id, concepto: 'Filtros de aceite para la pipa', total: 640, fecha_documento: HOY, ya_pagado: true, metodo: 'efectivo' };
  [s, j] = await pedir('POST', '/finanzas/cxp', A, gasto);
  revisa(s === 201, '1.er envío de contado: se registra', [s, j]);
  [s, j] = await pedir('POST', '/finanzas/cxp', A, gasto);
  revisa(s === 409 && j.codigo === 'POSIBLE_DUPLICADO', '2.º envío idéntico: pide confirmar (posible repetido)', [s, j]);
  lista = await deConcepto(gasto.concepto);
  revisa(lista.length === 1 && pagadoDe(lista) === 640, 'queda 1 gasto y 1 pago (no 2)', lista.map(x => [x.id, x.pagado]));
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { ...gasto, forzar: true });
  revisa(s === 201, 'si la persona confirma que es otro, se guarda', [s, j]);
  const credito = { proveedor_id: prov.id, concepto: 'Llantas traseras a crédito', total: 11600, fecha_documento: HOY, dias_credito: 30 };
  [s, j] = await pedir('POST', '/finanzas/cxp', A, credito);
  revisa(s === 201, '1.er envío a crédito sin folio: se registra', [s, j]);
  [s, j] = await pedir('POST', '/finanzas/cxp', A, credito);
  revisa(s === 409 && j.codigo === 'POSIBLE_DUPLICADO', '2.º envío a crédito sin folio: pide confirmar', [s, j]);
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { ...gasto, concepto: 'Renta de oficina', total: 9000, fecha_documento: F2 });
  revisa(s === 201, 'la renta del mes pasado se captura', [s, j]);
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { ...gasto, concepto: 'Renta de oficina', total: 9000, fecha_documento: HOY });
  revisa(s === 201, 'la misma renta de este mes (otra fecha) se captura sin preguntar', [s, j]);

  sec('FLW-H07 · «Repetir»');
  const centros = (await pedir('GET', '/compras/centros', A))[1];
  [s, j] = await pedir('POST', '/compras/ordenes', A, { forzar: true, proveedor_id: prov.id, centro_id: centros[0].id, categoria: 'otro', fecha: HOY, fecha_requerida: HOY, iva_modo: 'sin_iva', partidas: [{ cantidad: 1, descripcion: 'Manguera de 4 pulgadas', precio: 1044 }] });
  revisa(s === 201, 'se crea una orden de compra', [s, j.error]);
  [s, j] = await pedir('POST', '/compras/ordenes/' + j.id + '/autorizar', A, { dias_credito: 0 });
  const cxpOc = j.cxp_id;
  revisa(s === 200 && cxpOc, 'al autorizarla nace su cuenta por pagar', [s, j.error]);
  const antes = (await cxp()).length;
  [s, j] = await pedir('POST', '/finanzas/cxp/' + cxpOc + '/repetir', A, {});
  revisa(s === 409 && /orden de compra/i.test(j.error || ''), 'no se repite la cuenta de una orden de compra', [s, j]);
  [s, j] = await pedir('POST', '/finanzas/cxp/' + cxpOc + '/repetir', A, { forzar: true });
  revisa(s === 409, 'ni confirmando («forzar»)', [s, j]);
  revisa((await cxp()).length === antes, 'no se creó ninguna deuda nueva');

  const canales = (await pedir('GET', '/canales', A))[1], servicios = (await pedir('GET', '/servicios', A))[1];
  const yo = (await pedir('GET', '/usuarios', A))[1].find(u => u.rol === 'admin').id;
  [s, j] = await pedir('POST', '/contactos', A, { nombre: 'Planta Repetir', telefono: '4427770001', direccion: 'Parque 2', canal_origen_id: canales[0].id });
  [s, j] = await pedir('POST', '/leads', A, { cliente_id: j.id, direccion: 'Planta', responsable_id: yo, forzar_duplicado: true, iva_modo: 'mas_iva', estatus: 'ganado', fecha_servicio: HOY,
    partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'x', importe: 5000, cantidad: 1, precio: 5000 }]) });
  const orden = j;
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, lead_id: orden.id, concepto: 'Renta de vactor para el servicio', total: 3000, fecha_documento: HOY, dias_credito: 15 });
  revisa(s === 201, 'se registra un costo ligado a la orden de servicio', [s, j]);
  [s, j] = await pedir('POST', '/finanzas/cxp/' + j.id + '/repetir', A, { forzar: true });
  revisa(s === 409 && /orden de servicio/i.test(j.error || ''), 'no se repite un costo de una orden de servicio', [s, j]);
  [s, j] = await pedir('POST', '/finanzas/cxp', A, { proveedor_id: prov.id, concepto: 'Renta de vactor para el servicio', total: 3000, fecha_documento: HOY, dias_credito: 15 });
  revisa(s === 201, 'M-09: el mismo gasto pero sin la orden de servicio no cuenta como repetido', [s, j]);

  const rentaFija = (await deConcepto('Renta de bodega')).find(x => x.fecha_documento === F2);
  [s, j] = await pedir('POST', '/finanzas/cxp/' + rentaFija.id + '/repetir', A, {});
  revisa(s === 201, 'la renta (gasto fijo) sí se repite al mes siguiente', [s, j]);
  const lst = await cxp();
  revisa(lst.find(x => x.id === cxpOc)?.repetible === false && lst.find(x => x.id === rentaFija.id)?.repetible === true, 'la lista dice cuál se puede repetir (para ocultar el botón)', lst.filter(x => [cxpOc, rentaFija.id].includes(x.id)).map(x => [x.id, x.repetible]));

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLARON:\n - ' + malos.join('\n - '));
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-3000)); srv.kill(); process.exit(1); });
