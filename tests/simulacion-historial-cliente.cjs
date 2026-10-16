// Historial completo del cliente: que no se escape nada. Recorre la vida de un cliente (alta, cambios de datos,
// cotizaciones, cambios de importe, aceptación, factura, pago, notas, rechazo con motivo, eliminación con motivo,
// fusión con otro cliente) y revisa que todo aparezca en su ficha con quién y cuándo.
// Uso: node tests/simulacion-historial-cliente.cjs
const { spawn } = require('child_process'); const { DatabaseSync } = require('node:sqlite'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-histcli-')); const PUERTO = String(7300 + Math.floor(Math.random() * 250));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Historial-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'h.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); } else console.log('  ✔ ' + texto); };
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  await pedir('POST', '/usuarios', A, { nombre: 'Laura Ventas', correo: 'laura.hist@saneadren.com.mx', password: 'Saneadren-Ventas-Hist-26', rol: 'ventas' });
  const V = (await pedir('POST', '/login', null, { nombre: 'laura.hist@saneadren.com.mx', password: 'Saneadren-Ventas-Hist-26' }))[1].token;
  const [, usuarios] = await pedir('GET', '/usuarios', A), vid = usuarios.find(u => u.nombre === 'Laura Ventas').id;
  const [, canales] = await pedir('GET', '/canales', V), [, servicios] = await pedir('GET', '/servicios', V);
  let s, j;
  const cli = (await pedir('POST', '/contactos', V, { nombre: 'Gerente Hotel', telefono: '442 555 9101', empresa_contacto: 'Hotel Historia', direccion: 'Centro', canal_origen_id: canales[0].id }))[1];
  const otro = (await pedir('POST', '/contactos', V, { nombre: 'Otro Cliente', telefono: '442 555 9202', empresa_contacto: 'Restaurante Ajeno', direccion: 'Norte', canal_origen_id: canales[0].id }))[1];
  await pedir('PUT', '/clientes/' + cli.id, A, { ...cli, rfc: 'HHI900101AB1', notas_generales: 'Paga a 15 días' });
  const partidas = v => JSON.stringify([{ servicio: servicios[0].nombre, leyenda: 'Desazolve de cocina', importe: v }]);
  const cotizar = async (c, v) => (await pedir('POST', '/leads', V, { cliente_id: c, direccion: 'Cocina', canal_id: canales[0].id, servicio_id: servicios[0].id, responsable_id: vid, forzar_duplicado: true, partidas_json: partidas(v), iva_modo: 'mas_iva', valor: v, fecha_cotizacion: HOY }))[1];
  const leer = async id => (await pedir('GET', '/leads/' + id, V))[1];
  // 1) Cotización que se gana
  const c1 = await cotizar(cli.id, 10000);
  await pedir('PUT', '/leads/' + c1.id, V, { version: (await leer(c1.id)).version, valor: 12000, partidas_json: partidas(12000) });
  await pedir('PUT', '/leads/' + c1.id, V, { version: (await leer(c1.id)).version, estatus: 'ganado', fecha_servicio: HOY });
  await pedir('PUT', '/leads/' + c1.id, A, { version: (await leer(c1.id)).version, valor: 11500, partidas_json: partidas(11500) });
  await pedir('PUT', '/leads/' + c1.id + '/facturacion', A, { dias_credito: 15, factura_folio: 'H-1', factura_fecha: HOY });
  await pedir('POST', '/leads/' + c1.id + '/cobros', A, { monto: 5000, metodo: 'transferencia', fecha: HOY });
  await pedir('POST', '/leads/' + c1.id + '/historial', V, { tipo: 'observacion', texto: 'El gerente pidió factura con su RFC nuevo' });
  // 2) Cotización que no se acepta
  const c2 = await cotizar(cli.id, 8000);
  await pedir('PUT', '/leads/' + c2.id, V, { version: (await leer(c2.id)).version, estatus: 'perdido', motivo_perdida: 'Precio alto, eligió otro proveedor' });
  // 3) Cotización eliminada
  const c3 = await cotizar(cli.id, 3000);
  await pedir('POST', '/leads/' + c3.id + '/historial', V, { tipo: 'observacion', texto: 'Llamó para pedir otra fecha' });
  [s, j] = await pedir('DELETE', '/leads/' + c3.id, A); revisa(s === 400 && j.codigo === 'FALTA_MOTIVO', 'eliminar sin motivo no se permite', [s, j.error]);
  [s, j] = await pedir('DELETE', '/leads/' + c3.id, A, { motivo: 'Se capturó dos veces por error' }); revisa(s === 200, 'administración elimina la cotización con motivo', [s, j.error]);
  // 4) Otro cliente que se junta con este (sus movimientos pasan con él)
  const dup = (await pedir('POST', '/contactos', V, { nombre: 'Compras Hotel', telefono: '442 555 9303', empresa_contacto: 'Hotel Historia Centro', direccion: 'Centro', canal_origen_id: canales[0].id, distinto_de: [cli.id] }))[1];
  await pedir('PUT', '/clientes/' + dup.id, V, { ...dup, notas_generales: 'Es la misma razón social' });
  [s] = await pedir('POST', '/clientes/' + dup.id + '/fusionar', A, { con: cli.id }); revisa(s === 200, 'se junta un cliente duplicado dentro de este');
  // Algo de otro cliente (no debe aparecer)
  await cotizar(otro.id, 999);

  [s, j] = await pedir('GET', '/clientes/' + cli.id + '/movimientos', V);
  const h = Array.isArray(j) ? j : [];
  const hay = (re, extra = () => true) => h.some(x => re.test(x.que + ' · ' + x.detalle) && extra(x));
  const fOS = 'OS-' + String(c1.created_at).slice(0, 7).replace('-', '') + '-' + String(c1.id).padStart(4, '0');
  revisa(s === 200 && h.length >= 10, 'la ficha trae el historial completo (' + h.length + ' movimientos)', [s, j.error]);
  revisa(hay(/creado/i, x => x.grupo === 'contacto'), 'alta del contacto (quién lo dio de alta)');
  revisa(hay(/RFC|Notas/, x => x.grupo === 'contacto' && x.usuario === 'admin'), 'cambio de datos del contacto y quién lo hizo');
  revisa(hay(/Cotización creada/, x => x.usuario === 'Laura Ventas'), 'cotización creada y quién la creó');
  revisa(hay(/importe \$10,000\.00 → \$12,000\.00/, x => x.usuario === 'Laura Ventas'), 'cambio de importe ANTES de aceptarse, con quién', h.filter(x => /importe/i.test(x.detalle)).map(x => x.detalle));
  revisa(hay(/marcada como ganada/i, x => x.registro === fOS), 'cuándo se aceptó (pasó a orden de servicio)');
  revisa(hay(/Importe de la orden cambiado/, x => x.usuario === 'admin'), 'cambio de importe DESPUÉS de aceptada, con quién');
  revisa(hay(/H-1/), 'factura');
  revisa(hay(/Pago registrado|Pago .*5,000/i), 'pago registrado');
  revisa(hay(/RFC nuevo/, x => x.grupo === 'nota'), 'notas que escribió el equipo');
  revisa(hay(/no aceptada.*Motivo: Precio alto/i), 'cotización no aceptada con su motivo');
  revisa(hay(/ELIMINADA.*Motivo: Se capturó dos veces/, x => x.grupo === 'eliminado' && x.usuario === 'admin'), 'cotización eliminada: quién y por qué');
  revisa(hay(/Llamó para pedir otra fecha/, x => x.grupo === 'eliminado'), 'lo que pasó en la cotización eliminada NO se pierde');
  revisa(hay(/fusión|juntó/i, x => x.grupo === 'contacto'), 'la fusión con el cliente duplicado');
  revisa(hay(/Es la misma razón social/), 'los movimientos del cliente que se juntó también aparecen');
  revisa(!hay(/Restaurante Ajeno|999/), 'no se mezclan movimientos de otros clientes');
  revisa(h.every((x, i) => i === 0 || String(h[i - 1].fecha) >= String(x.fecha)), 'de lo más reciente a lo más antiguo');
  revisa(h.every(x => x.fecha && x.registro && x.que), 'cada renglón dice cuándo, en qué registro y qué pasó');
  // Una eliminada ANTES de este cambio (solo quedó la foto en la bitácora): también debe salir.
  const c4 = await cotizar(cli.id, 4000);
  await pedir('DELETE', '/leads/' + c4.id, A, { motivo: 'Prueba de eliminación vieja' });
  { const db = new DatabaseSync(path.join(dir, 'h.db')); db.prepare('DELETE FROM historial_archivo WHERE lead_id = ?').run(c4.id); db.close(); }
  [s, j] = await pedir('GET', '/clientes/' + cli.id + '/movimientos', V);
  revisa(j.some(x => x.grupo === 'eliminado' && x.que === 'Eliminada' && x.registro === 'COT-' + String(c4.created_at).slice(0, 7).replace('-', '') + '-' + String(c4.id).padStart(4, '0')), 'las eliminadas antes de este cambio también aparecen (de la bitácora general)');
  [s] = await pedir('GET', '/clientes/999999/movimientos', V); revisa(s === 404, 'cliente que no existe');
  { const x = await fetch(`http://localhost:${PUERTO}/api/clientes/${cli.id}/movimientos`); revisa(x.status === 401, 'sin sesión no se ve'); }

  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
