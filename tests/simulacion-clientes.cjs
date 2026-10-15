// Clientes sin duplicados: ID CLI-0001, teléfono, RFC, nombres parecidos (errores de dedo del generador real),
// «es el mismo» (teléfono adicional), «es otro» (no se vuelve a preguntar), fusión y plantilla de cobranza por ID.
// Uso: node tests/simulacion-clientes.cjs   (usa una base temporal)
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-clientes-')); const PUERTO = String(5500 + Math.floor(Math.random() * 300));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Clientes-' + Math.random().toString(36).slice(2) + '-7' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'c.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 400) : '')); } else console.log('  ✔ ' + texto); };
const seccion = t => console.log('\n' + t);

(async () => {
  for (let i = 0; i < 40 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  await pedir('POST', '/usuarios', A, { nombre: 'Ventas Sim', correo: 'ventas.sim@saneadren.com.mx', password: 'Ventas-Sim-2026', rol: 'ventas' });
  const V = (await pedir('POST', '/login', null, { nombre: 'ventas.sim@saneadren.com.mx', password: 'Ventas-Sim-2026' }))[1].token;
  const [, canales] = await pedir('GET', '/canales', V);
  const canal = canales[0].id;
  const contacto = (nombre, telefono, extra = {}) => pedir('POST', '/contactos', V, { nombre, telefono, direccion: 'Querétaro', canal_origen_id: canal, ...extra });
  let s, j;

  seccion('1. Teléfono repetido: nunca crea otro');
  [s, j] = await contacto('Pedro Ramírez', '4421000001', { empresa_contacto: 'KFC México S.A. de C.V.' });
  revisa(s === 201, 'se crea KFC México S.A. de C.V.', j);
  const kfc = j;
  [s, j] = await contacto('Otra Persona', '442-100-0001');
  revisa(s === 409 && j.cliente_id === kfc.id && j.error.includes('CLI-' + String(kfc.id).padStart(4, '0')), 'mismo teléfono (con guiones) → avisa que ya es de CLI-xxxx y no crea otro', j);

  seccion('2. Nombre o empresa parecidos: pregunta antes de crear');
  [s, j] = await contacto('Luis', '4421000002', { empresa_contacto: 'kfc mexico' });
  revisa(s === 409 && j.error === 'posible_duplicado' && j.parecidos[0].id === kfc.id && j.parecidos[0].folio.startsWith('CLI-'), '«kfc mexico» (minúsculas, sin acento ni S.A. de C.V.) → ¿es el mismo?', j);
  [s, j] = await contacto('Luis', '4421000002', { empresa_contacto: 'KFC', agregar_telefono_a: kfc.id });
  revisa(s === 200 && j.id === kfc.id && j.telefono_agregado, '«Es el mismo» → se agrega el teléfono a KFC, no se crea otro', j);
  [s, j] = await pedir('GET', '/leads/buscar-telefono/4421000002', V);
  revisa(j.cliente?.id === kfc.id, 'el teléfono nuevo ya reconoce a KFC');
  [s, j] = await contacto('Alguien', '4421000002');
  revisa(s === 409 && j.cliente_id === kfc.id, 'y ya no se puede usar para otro cliente');
  [s, j] = await pedir('GET', '/clientes/' + kfc.id + '/telefonos', V);
  revisa(j.length === 1 && j[0].telefono_normalizado === '4421000002', 'KFC tiene su teléfono adicional', j);

  seccion('3. Errores de dedo del generador real');
  const pares = [['GEISHA K', 'GESISHA K'], ['JHONSON MATHEY', 'JHONSON MATHIE'], ['THE HASKEL COMPANY', 'THE HASKELL'], ['FIBRA SHOP', 'FIBRASHO´'], ['AGUAKAN', 'AGUKAN CANCUN'],
    ['TKL', 'TKL TERMINAL'], ['PROMOTORA ECOLOGICA SAN PEDRO MARTIR', 'PROMOTORA SAN PEDRO MARTIR'], ['GRUPO TRACTOCAMIONES Y AUTOBUSES DEL BAJIO', 'TRACTOCAMIONES Y AUTO. BAJIO']];
  let tel = 4422000000;
  for (const [a, b] of pares) {
    [s, j] = await contacto('Encargado', String(++tel), { empresa_contacto: a });
    const original = j;
    [s, j] = await contacto('Encargado', String(++tel), { empresa_contacto: b });
    revisa(s === 409 && j.parecidos?.some(p => p.id === original.id), `«${b}» se detecta como posible «${a}»`, [s, j.error]);
  }

  seccion('4. Sin avisos absurdos');
  const sinAviso = [['Juan', null], ['Juan Pérez', null], ['Juan López', null], ['César Barroso', null], ['César Pérez', null], ['María', null], ['Ana Ruiz', null], ['TL KAPITAL', 'TL KAPITAL'], ['ATVM', 'ATVM'], ['KLUBER', 'KLUBER'], ['DURR', 'DURR']];
  for (const [nombre, empresa] of sinAviso) {
    [s, j] = await contacto(nombre, String(++tel), empresa ? { empresa_contacto: empresa } : {});
    revisa(s === 201, `«${nombre}${empresa ? ' / ' + empresa : ''}» se crea sin preguntar`, [s, j.error, j.parecidos?.map(p => p.empresa || p.nombre)]);
  }
  [s, j] = await contacto('Cesar Barroso', String(++tel));
  revisa(s === 409 && j.parecidos.some(p => p.nombre === 'César Barroso'), '«Cesar Barroso» (sin acento) con otro teléfono → pregunta', j.parecidos);
  const barroso = j.parecidos.find(p => p.nombre === 'César Barroso');
  [s, j] = await contacto('Cesar Barroso', String(tel), { distinto_de: [barroso.id] });
  revisa(s === 201, '«No, es otro» → se crea el nuevo', j);
  const barroso2 = j;
  [s, j] = await pedir('GET', '/clientes/duplicados', A);
  revisa(!j.some(p => [p.a.id, p.b.id].includes(barroso.id) && [p.a.id, p.b.id].includes(barroso2.id)), 'la pareja confirmada como distinta no vuelve a aparecer en la revisión');

  seccion('5. Cotización directa con cliente nuevo (también revisa)');
  const [, servicios] = await pedir('GET', '/servicios', V);
  const [, usuarios] = await pedir('GET', '/usuarios', A);
  const ventas = usuarios.find(u => u.nombre === 'Ventas Sim');
  const lead = extra => pedir('POST', '/leads', V, { telefono: String(++tel), nombre: 'Compras', empresa_contacto: 'Geisha-K', direccion: 'Qro', canal_id: canal, servicio_id: servicios[0].id, responsable_id: ventas.id,
    partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Desazolve', importe: 1000 }]), valor: 1000, ...extra });
  [s, j] = await lead();
  revisa(s === 409 && j.error === 'posible_duplicado', '«Geisha-K» al cotizar con teléfono nuevo → pregunta', [s, j.error]);
  const geisha = j.parecidos?.[0];
  [s, j] = await lead({ agregar_telefono_a: geisha?.id });
  revisa(s === 201 && j.cliente_id === geisha?.id, '«Es el mismo» → la cotización queda en ese cliente', [s, j.error, j.cliente_id]);

  seccion('5b. Teléfono alterno');
  [s, j] = await pedir('PUT', '/clientes/' + kfc.id, V, { telefono_alterno: '4421000001' });
  revisa(s === 200, 'el alterno puede ser su propio teléfono');
  [s, j] = await contacto('Otro Cliente Alterno', String(++tel), { empresa_contacto: 'Ferretería Alterna' });
  const ferre = j;
  [s, j] = await pedir('PUT', '/clientes/' + ferre.id, V, { telefono_alterno: '4421000002' });
  revisa(s === 409 && /CLI-/.test(j.error), 'el alterno no puede ser el teléfono de otro cliente', j);
  [s, j] = await pedir('PUT', '/clientes/' + ferre.id, V, { telefono_alterno: '4423334455' });
  [s, j] = await pedir('GET', '/leads/buscar-telefono/4423334455', V);
  revisa(j.cliente?.id === ferre.id, 'si llaman del alterno, el CRM reconoce al cliente');

  seccion('6. RFC: no se repite');
  [s, j] = await pedir('PUT', '/clientes/' + kfc.id, V, { rfc: 'KME010101AB1' });
  revisa(s === 200 && j.rfc === 'KME010101AB1', 'se captura el RFC de KFC al facturar');
  [s, j] = await contacto('Sucursal Centro', String(++tel), { empresa_contacto: 'Pollo Feliz Centro' });
  const pollo = j;
  [s, j] = await pedir('PUT', '/clientes/' + pollo.id, V, { rfc: 'kme010101ab1' });
  revisa(s === 409 && j.rfc_de?.id === kfc.id, 'el mismo RFC en otro cliente → avisa que ya es de KFC', j);
  [s, j] = await contacto('Otro', String(++tel), { empresa_contacto: 'Restaurantes Nuevos', rfc: 'KME010101AB1' });
  revisa(s === 409 && j.rfc_de?.id === kfc.id, 'tampoco se puede dar de alta un contacto con ese RFC');

  seccion('7. Juntar duplicados (solo administración)');
  const [, cot] = await pedir('POST', '/leads', V, { cliente_id: pollo.id, direccion: 'Qro', canal_id: canal, servicio_id: servicios[0].id, responsable_id: ventas.id, partidas_json: JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Desazolve', importe: 500 }]), valor: 500 });
  [s] = await pedir('POST', '/clientes/' + pollo.id + '/fusionar', V, { con: kfc.id }); revisa(s === 403, 'ventas no puede juntar clientes');
  [s] = await pedir('GET', '/clientes/duplicados', V); revisa(s === 403, 'ventas no ve la revisión de duplicados');
  [s, j] = await pedir('POST', '/clientes/' + pollo.id + '/fusionar', A, { con: kfc.id });
  revisa(s === 200 && j.cliente.id === kfc.id, 'el administrador junta Pollo Feliz dentro de KFC', j);
  [s, j] = await pedir('GET', '/leads/' + cot.id, V); revisa(j.cliente_id === kfc.id, 'su cotización pasó a KFC');
  [s, j] = await pedir('GET', '/leads/buscar-telefono/' + pollo.telefono, V); revisa(j.cliente?.id === kfc.id, 'su teléfono ahora reconoce a KFC');
  [s] = await pedir('GET', '/clientes/' + pollo.id, V); revisa(s === 404, 'el cliente retirado ya no existe');
  [s, j] = await contacto('X', String(++tel), { empresa_contacto: 'Otra SA', rfc: 'OSA010101AB1' });
  const otra = j;
  [s, j] = await pedir('POST', '/clientes/' + otra.id + '/fusionar', A, { con: kfc.id });
  revisa(s === 400 && /RFC distinto/.test(j.error), 'no se juntan dos clientes con RFC distinto (son razones sociales diferentes)', j);

  seccion('8. Plantilla de cobranza: por ID y sin duplicados');
  const fila = (k, nombre, extra = {}) => ({ fila: k, nombre, fecha: '2026-09-01', subtotal: 1000, status: 'PENDIENTE', ...extra });
  const folioKfc = 'CLI-' + String(kfc.id).padStart(4, '0');
  // La importación responde { errores: [{ fila, errores }], resumen: [{ fila, cliente, cliente_nuevo… }] }: se junta por fila.
  const porFila = j => (j.resumen || []).map(r => ({ errores: (j.errores || []).find(e => e.fila === r.fila)?.errores || [], resumen: r }));
  const imp = async (filas, simular = true) => { const [st, jj] = await pedir('POST', '/finanzas/importar/cxc' + (simular ? '?simular=1' : ''), A, { filas }); return [st, { ...jj, filas: porFila(jj) }]; };
  [s, j] = await imp([fila(2, 'K.F.C. de mexico', { folio: 'A1' })]);
  revisa(s === 200 && j.filas?.[0]?.errores?.length === 0 && j.filas[0].resumen.cliente_nuevo === false, 'nombre exacto (sin puntos ni acentos) → usa KFC', j.filas?.[0]);
  [s, j] = await imp([fila(2, 'POLLO FELIZ CENTRO', { folio: 'A2' })]);
  revisa(j.filas?.[0]?.errores?.length === 0 && j.filas[0].resumen.cliente_nuevo === false, 'el nombre del cliente retirado se asigna solo a KFC', j.filas?.[0]);
  [s, j] = await imp([fila(2, 'KFC Y CARLS', { folio: 'A3' })]);
  revisa(j.filas?.[0]?.errores?.some(e => e.includes(folioKfc)), '«KFC Y CARLS» sin ID → pide el ID (se parece a ' + folioKfc + ')', j.filas?.[0]?.errores);
  [s, j] = await imp([fila(2, 'KFC Y CARLS', { folio: 'A3', id_cliente: folioKfc + ' · KFC México' })]);
  revisa(j.filas?.[0]?.errores?.length === 0 && j.filas[0].resumen.cliente_nuevo === false, 'con ID CLIENTE (de la lista) → va a KFC aunque el nombre sea distinto', j.filas?.[0]);
  [s, j] = await imp([fila(2, 'X', { folio: 'A4', id_cliente: 'CLI-' + String(pollo.id).padStart(4, '0') })]);
  revisa(j.filas?.[0]?.errores?.length === 0 && j.filas[0].resumen.cliente === kfc.nombre, 'el ID retirado por la fusión apunta a KFC', j.filas?.[0]);
  [s, j] = await imp([fila(2, 'X', { folio: 'A5', id_cliente: 'CLI-9999' })]);
  revisa(j.filas?.[0]?.errores?.some(e => /no existe/.test(e)), 'un ID que no existe se rechaza');
  [s, j] = await imp([fila(2, 'BIOGENERACION SUSTENTABLE', { folio: 'B1' }), fila(3, 'BIOGENERACION SUSTENTALBE', { folio: 'B2' })]);
  revisa(j.filas?.[1]?.errores?.some(e => /mismo archivo/.test(e)), 'dos clientes nuevos casi iguales en el mismo archivo → error en la fila 3', j.filas?.[1]?.errores);
  [s, j] = await imp([fila(2, 'KFC Y CARLS', { folio: 'C1', id_cliente: 'NUEVO' })], false);
  revisa(s === 200 || s === 201, '«NUEVO» crea el cliente aunque se parezca (decisión explícita)', [s, j.error]);
  [s, j] = await pedir('GET', '/clientes/duplicados', A);
  revisa(j.some(p => [p.a.empresa || p.a.nombre, p.b.empresa || p.b.nombre].includes('KFC Y CARLS')), 'y aparece en la revisión de duplicados para que un administrador decida', j.map(p => p.motivo + ': ' + (p.a.empresa || p.a.nombre) + ' / ' + (p.b.empresa || p.b.nombre)));
  [s, j] = await pedir('GET', '/clientes/catalogo', V);
  revisa(s === 200 && j.every(c => /^CLI-\d{4,}$/.test(c.folio)) && j.some(c => c.id === kfc.id), 'catálogo con el ID de cada cliente (para las listas de la plantilla)');

  revisa(!/uncaughtException|Error en |TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
