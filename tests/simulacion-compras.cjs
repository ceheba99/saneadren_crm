// Órdenes de compra (CM-F-03): crear, editar, autorizar (pasa a Cuentas por pagar) y cancelar.
// Usa las partidas de la orden real de la semana 40. Uso: node tests/simulacion-compras.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-compras-')); const PUERTO = String(5100 + Math.floor(Math.random() * 300));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Compras-' + Math.random().toString(36).slice(2) + '-9' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'c.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };

const SEMANA_40 = [['REPARACION FLECHA CARDAN JOSE LUIS ACOSTA', 2000], ['PAGO RECARGAS TELEVIA ROSA PEREA', 4000], ['COMPLEMENTO DE NOMINA SEMANA 40', 205524.06],
  ['PAGO A CUENTA DE MANIFIESTOS SYMRYSE YECENIA HERNANDEZ', 10000], ['REP MECANICA C29 C28 MATIZ ELISEO NIEVES', 4300], ['AVALUO COMERCIAL SANEADREN CELAYA', 1500],
  ['REMBOLSO GASTOS SIN FACTURA LUIS PEREA', 134367.25], ['REMPLAZO DE FLECHA COPLE Y VALVULA OSCAR FERNANDEZ', 14308], ['3 VIAJES PIPA SYMRYSE SEMANA 39', 22500],
  ['CUERPO DE ELECTROVALVULAS E37 MARIO ALBERTO LOPEZ', 6000], ['LODERAS E44 PEDRO ENRIQUEZ', 2000], ['CHAPA ESTRIBOS Y LUCES E44 LUIS PEREA', 4120],
  ['FARICACION DE ENGRANES Y ESPIGAS PARA BOMBA HIDRAHULICA', 15000], ['ANTICIPO FABRICACION DE RACKS Y TECHADO MANTTO NANCY RIOS', 10000],
  ['DESCARGAS RESIDUALES CHEMICO KFC DENISSE ARELY', 2500], ['PAGO A CUENTA DE DEUDA GLOBAL EVELYN PEREA', 24008.46], ['APYO POR OPERACIONES PROYECTO ATVM SHARAI VILLA', 5000]];

(async () => {
  for (let i = 0; i < 40 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  // Las órdenes de compra las hace el encargado de centro de costos (rol «costos») o administración.
  await pedir('POST', '/usuarios', A, { nombre: 'Compras Sim', correo: 'compras.sim@saneadren.com.mx', password: 'Compras-Sim-2026', rol: 'costos' });
  const V = (await pedir('POST', '/login', null, { nombre: 'compras.sim@saneadren.com.mx', password: 'Compras-Sim-2026' }))[1].token;
  let s, j;
  [s, j] = await pedir('GET', '/compras/centros', V);
  revisa(s === 200 && j.length === 8 && j.find(c => c.nombre === 'Operaciones')?.responsable === 'Noe Gomez', 'catálogo inicial de 8 centros de costo con responsable', j.map(c => c.nombre));
  const operaciones = j.find(c => c.nombre === 'Operaciones');
  // Centros de costo: cualquier usuario agrega, corrige o elimina
  [s, j] = await pedir('POST', '/compras/centros', V, { nombre: 'Taller', responsable: 'Isaac Hernandez' }); revisa(s === 201, 'ventas agrega un centro de costos', j);
  const taller = j;
  [s, j] = await pedir('POST', '/compras/centros', A, { nombre: 'taller' }); revisa(s === 409 && /Taller/.test(j.error), 'no se repite un centro de costos (dice cuál ya existe)', j.error);
  [s, j] = await pedir('POST', '/compras/centros', V, { nombre: '--' }); revisa(s === 400, 'un nombre sin letras no se acepta');
  [s, j] = await pedir('POST', '/compras/centros', V, { nombre: '<b>x</b>' }); revisa(s === 400, 'un nombre con código no se acepta');
  [s, j] = await pedir('PUT', '/compras/centros/' + taller.id, V, { nombre: 'Taller mecánico', responsable: 'Isaac Hernandez' }); revisa(s === 200 && j.nombre === 'Taller mecánico', 'ventas corrige el nombre del centro', j);
  [s, j] = await pedir('DELETE', '/compras/centros/' + taller.id, V); revisa(s === 200 && j.ok, 'ventas elimina un centro de costos que no le sirve', j);
  [s, j] = await pedir('GET', '/compras/centros', V); revisa(!j.some(c => c.id === taller.id && c.activo), 'el centro eliminado ya no se ofrece');
  [s, j] = await pedir('DELETE', '/compras/centros/' + taller.id, V); revisa(s === 404, 'eliminarlo dos veces no hace nada');
  [s, j] = await pedir('POST', '/compras/centros', V, { nombre: 'TALLER MECÁNICO' }); revisa(s === 201 && j.id === taller.id && j.activo === 1 && j.responsable === 'Isaac Hernandez', 'volver a agregarlo lo recupera (mismo registro, conserva el responsable)', j);
  [s, j] = await pedir('GET', '/auditoria?entidad=catalogo', A); revisa(s === 200 && j.some(r => r.accion === 'centro de costos eliminado' && /Taller/.test(r.detalle)), 'la eliminación queda en la bitácora con quién lo hizo', j.slice?.(0, 3));
  const [, prov] = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'PROFESIONALSERV', categoria: 'otro', dias_credito: 7 });

  const base = { forzar: true, proveedor_id: prov.id, centro_id: operaciones.id, categoria: 'otro', fecha: '2026-10-02', fecha_requerida: '2026-10-02', iva_modo: 'sin_iva',
    partidas: SEMANA_40.map(([descripcion, precio]) => ({ cantidad: 1, descripcion, precio })) };
  [s, j] = await pedir('POST', '/compras/ordenes', V, base);
  const oc = j;
  revisa(s === 201 && j.estado === 'borrador' && /^OC-\d{6}-0001$/.test(j.folio), 'ventas crea la orden de compra en borrador con folio OC', [s, j.folio, j.error]);
  revisa(j.partidas.length === 17 && j.total === 467127.77 && j.subtotal === 467127.77 && j.iva === 0, 'sin IVA: 17 partidas suman $467,127.77 (igual que el Excel)', [j.partidas?.length, j.total]);
  revisa(j.factura_a === 'SANEADREN' && j.solicitante_nombre === 'Compras Sim' && j.centro_nombre === 'Operaciones', 'por defecto factura a SANEADREN y solicita quien la captura', [j.factura_a, j.solicitante_nombre]);
  // IVA
  [s, j] = await pedir('POST', '/compras/ordenes', A, { ...base, iva_modo: 'mas_iva', partidas: [{ cantidad: 3, descripcion: 'Manguera 4 pulgadas', unidad: 'PZA', clave: 'MG-4', precio: 1000 }] });
  revisa(s === 201 && j.subtotal === 3000 && j.iva === 480 && j.total === 3480 && j.partidas[0].importe === 3000, 'más IVA: 3 × $1,000 = $3,000 + IVA $480 = $3,480', [j.subtotal, j.iva, j.total]);
  const oc2 = j;
  [s, j] = await pedir('POST', '/compras/ordenes', A, { ...base, iva_modo: 'incluido', partidas: [{ cantidad: 1, descripcion: 'Bomba', precio: 1160 }] });
  revisa(s === 201 && j.subtotal === 1000 && j.iva === 160 && j.total === 1160, 'IVA incluido: $1,160 = $1,000 + $160', [j.subtotal, j.iva, j.total]);
  // Validaciones
  for (const [cuerpo, texto] of [
    [{ ...base, proveedor_id: 99999 }, 'proveedor inexistente'], [{ ...base, centro_id: 99999 }, 'centro de costos inexistente'], [{ ...base, iva_modo: null }, 'sin indicar el IVA'],
    [{ ...base, partidas: [] }, 'sin partidas'], [{ ...base, partidas: [{ cantidad: 1, descripcion: 'x', precio: 0 }] }, 'precio en $0'],
    [{ ...base, partidas: [{ cantidad: 0, descripcion: 'x', precio: 5 }] }, 'cantidad 0'], [{ ...base, partidas: [{ cantidad: 1, descripcion: '  ', precio: 5 }] }, 'sin descripción'],
    [{ ...base, partidas: [{ cantidad: 1, descripcion: 'x', precio: 1.234 }] }, 'precio con 3 decimales'], [{ ...base, fecha_requerida: '2026-09-01' }, 'fecha requerida antes de la fecha'],
    [{ ...base, lead_id: 99999 }, 'orden de servicio inexistente']]) {
    [s, j] = await pedir('POST', '/compras/ordenes', A, cuerpo); revisa(s === 400, 'se rechaza: ' + texto, [s, j.error]);
  }
  // Editar borrador
  [s, j] = await pedir('PUT', '/compras/ordenes/' + oc.id, V, { ...base, version: oc.version, nota: 'GASTOS PAGADORA SEM 40', observaciones: 'Pagar viernes', entrega: 'Oficina Querétaro' });
  revisa(s === 200 && j.nota === 'GASTOS PAGADORA SEM 40' && j.version === 2, 'se edita el borrador', [s, j.error]);
  [s, j] = await pedir('PUT', '/compras/ordenes/' + oc.id, V, { ...base, version: 1 }); revisa(s === 409, 'editar con una versión vieja avisa del conflicto');
  // Autorizar
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', V, {}); revisa(s === 403, 'ventas no autoriza órdenes de compra');
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', A, {}); revisa(s === 400 && j.codigo === 'FALTA_CREDITO' && j.credito_proveedor === 7, 'sin escribir los días de crédito no se autoriza (y dice cuántos suele dar el proveedor)', [s, j]);
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', A, { dias_credito: '' }); revisa(s === 400, 'crédito vacío no cuenta');
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', A, { dias_credito: -3 }); revisa(s === 400, 'crédito negativo no');
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', A, { dias_credito: 2.5 }); revisa(s === 400, 'crédito con decimales no');
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', A, { dias_credito: 400 }); revisa(s === 400, 'crédito de más de un año no');
  [s, j] = await pedir('GET', '/compras/ordenes/' + oc.id, A); revisa(j.estado === 'borrador' && !j.cxp_id, 'los intentos fallidos no la autorizaron');
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', A, { dias_credito: 7 });
  revisa(s === 200 && j.orden.estado === 'autorizada' && j.cxp_id, 'el administrador autoriza la orden', [s, j.error]);
  const cxp = (await pedir('GET', '/finanzas/cxp?vista=todas', A))[1].find(x => x.id === j.cxp_id);
  revisa(cxp && cxp.total === 467127.77 && cxp.saldo === 467127.77 && cxp.fecha_documento === '2026-10-02' && cxp.fecha_vencimiento === '2026-10-09' && cxp.concepto.startsWith(oc.folio) && /Operaciones/.test(cxp.notas),
    'pasa a Cuentas por pagar: total, vence según el crédito escrito (7 días), concepto con el folio y centro de costos', cxp);
  revisa(/Crédito: 7 días/.test(cxp.notas), 'la cuenta por pagar dice el crédito de la compra', cxp.notas);
  [s, j] = await pedir('PUT', '/compras/ordenes/' + oc.id, A, { ...base }); revisa(s === 409, 'una orden autorizada ya no se edita');
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/autorizar', A, { dias_credito: 7 }); revisa(s === 409, 'no se autoriza dos veces');
  // Pago parcial y cancelar
  await pedir('POST', '/finanzas/cxp/' + cxp.id + '/pagos', A, { monto: 100000, metodo: 'transferencia' });
  [s, j] = await pedir('GET', '/compras/ordenes/' + oc.id, V);
  revisa(j.pagado === 100000 && j.saldo === 367127.77, 'la orden muestra lo pagado y el saldo', [j.pagado, j.saldo]);
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc.id + '/cancelar', A, { motivo: 'Se capturó mal' });
  revisa(s === 409, 'no se cancela una orden que ya tiene pagos al proveedor', [s, j.error]);
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc2.id + '/cancelar', V, { motivo: 'no' }); revisa(s === 400, 'cancelar exige motivo');
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc2.id + '/autorizar', A, { dias_credito: 0 });
  revisa(s === 200 && (await pedir('GET', '/finanzas/cxp?vista=todas', A))[1].find(x => x.id === j.cxp_id)?.fecha_vencimiento === j.orden.fecha, 'de contado (0 días): vence el mismo día de la orden');
  [s, j] = await pedir('GET', '/auditoria?entidad=orden_compra&id=' + oc2.id, A); revisa(j.some(r => /de contado \(el proveedor suele dar 7\)/.test(r.detalle || '')), 'si el crédito es distinto al habitual del proveedor, queda anotado');
  [s, j] = await pedir('GET', '/compras/ordenes/' + oc2.id, A);
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc2.id + '/cancelar', V, { motivo: 'El proveedor no tiene existencia' }); revisa(s === 403, 'ventas no cancela una orden autorizada');
  [s, j] = await pedir('POST', '/compras/ordenes/' + oc2.id + '/cancelar', A, { motivo: 'El proveedor no tiene existencia' });
  revisa(s === 200 && j.orden.estado === 'cancelada', 'el administrador cancela una autorizada sin pagos', [s, j.error]);
  const cx2 = (await pedir('GET', '/finanzas/cxp?vista=todas', A))[1].find(x => x.id === j.orden.cxp_id);
  revisa(!cx2, 'al cancelarla, su cuenta por pagar también se cancela (ya no aparece)', cx2);
  // Lista y filtros
  [s, j] = await pedir('GET', '/compras/ordenes?estado=pendiente_pago', V);
  revisa(s === 200 && j.length === 1 && j[0].id === oc.id, 'filtro "por pagar": solo la autorizada con saldo', j.map(o => o.folio));
  [s, j] = await pedir('GET', '/compras/ordenes?q=televia', V);
  revisa(j.length === 1 && j[0].id === oc.id, 'buscar por texto de las partidas', j.map(o => o.folio));

  // Entrega ya no se usa: aunque llegue, no se guarda
  [s, j] = await pedir('POST', '/compras/ordenes', V, { ...base, entrega: 'Oficina Querétaro' });
  revisa(s === 201 && j.entrega === null, 'el campo «entrega» ya no se guarda', [s, j.entrega]);

  // Unidades de medida: catálogo inicial y cualquiera lo edita
  [s, j] = await pedir('GET', '/compras/unidades', V);
  revisa(s === 200 && ['PZA', 'L', 'M', 'KG'].every(c => j.some(u => u.clave === c)), 'catálogo inicial de unidades (pieza, litro, metro, kilo…)', j.map(u => u.clave));
  [s, j] = await pedir('POST', '/compras/unidades', V, { clave: 'ml', nombre: 'Metro lineal' });
  revisa(s === 201 && j.clave === 'ML', 'ventas agrega una unidad (la abreviatura va en mayúsculas)', [s, j]);
  const ml = j;
  [s, j] = await pedir('POST', '/compras/unidades', V, { clave: 'Ml', nombre: 'Otra' }); revisa(s === 400, 'no se repite la abreviatura', [s, j.error]);
  [s, j] = await pedir('POST', '/compras/unidades', V, { clave: 'XX', nombre: 'metro lineal' }); revisa(s === 400, 'no se repite el nombre', [s, j.error]);
  [s, j] = await pedir('POST', '/compras/unidades', V, { clave: '<b>', nombre: 'Mala' }); revisa(s === 400, 'abreviatura con símbolos raros rechazada', [s, j.error]);
  [s, j] = await pedir('PUT', '/compras/unidades/' + ml.id, V, { nombre: 'Metro lineal (ML)', activo: false });
  revisa(s === 200 && j.nombre === 'Metro lineal (ML)' && j.activo === 0, 'ventas corrige y da de baja una unidad', j);
  [s, j] = await pedir('POST', '/compras/ordenes', V, { ...base, partidas: [{ cantidad: 2.5, descripcion: 'Manguera', unidad: 'M', precio: 100 }] });
  revisa(s === 201 && j.partidas[0].unidad === 'M', 'la partida guarda la unidad elegida', j.partidas?.[0]);

  // Categorías de gasto: cualquier usuario las agrega, corrige o elimina; renombrar actualiza lo capturado
  [s, j] = await pedir('GET', '/finanzas/categorias', V);
  revisa(s === 200 && j.some(c => c.clave === 'combustible') && j.every(c => c.activo === 1), 'categorías iniciales (solo activas)', j.map(c => c.clave));
  [s, j] = await pedir('POST', '/finanzas/categorias', V, { nombre: 'Papelería y consumibles' });
  revisa(s === 201 && j.clave === 'papeleria_y_consumibles', 'ventas agrega una categoría', j);
  [s] = await pedir('POST', '/finanzas/categorias', A, { nombre: 'papelería y consumibles' }); revisa(s === 409, 'no se repite una categoría');
  [s, j] = await pedir('POST', '/compras/ordenes', V, { ...base, categoria: 'papeleria_y_consumibles' });
  revisa(s === 201 && j.categoria_nombre === 'Papelería y consumibles', 'la categoría nueva se usa de inmediato en una orden', [s, j.categoria_nombre, j.error]);
  const ocPapel = j;
  [s, j] = await pedir('PUT', '/finanzas/categorias/papeleria_y_consumibles', A, { nombre: 'Papelería' });
  revisa(s === 200 && j.nombre === 'Papelería', 'el administrador renombra la categoría', j);
  [s, j] = await pedir('GET', '/compras/ordenes/' + ocPapel.id, V);
  revisa(j.categoria_nombre === 'Papelería', 'renombrar actualiza las órdenes ya capturadas', j.categoria_nombre);
  [s, j] = await pedir('PUT', '/finanzas/categorias/papeleria_y_consumibles', A, { activo: false });
  [s, j] = await pedir('GET', '/finanzas/categorias', V);
  revisa(!j.some(c => c.clave === 'papeleria_y_consumibles'), 'una categoría dada de baja ya no se ofrece');
  [s, j] = await pedir('GET', '/finanzas/categorias?todas=1', A);
  revisa(j.some(c => c.clave === 'papeleria_y_consumibles' && c.activo === 0), 'pero sigue en el catálogo completo para reactivarla');
  [s, j] = await pedir('PUT', '/finanzas/categorias/otro', A, { activo: false }); revisa(s === 400, '«Otro» no se puede dar de baja', [s, j.error]);
  [s, j] = await pedir('DELETE', '/finanzas/categorias/otro', V); revisa(s === 400, '«Otro» no se puede eliminar', [s, j.error]);
  [s, j] = await pedir('POST', '/finanzas/categorias', V, { nombre: 'Papelería' }); revisa(s === 201 && j.clave === 'papeleria_y_consumibles' && j.activo === 1, 'volver a agregar una categoría eliminada la recupera', j);
  [s, j] = await pedir('DELETE', '/finanzas/categorias/papeleria_y_consumibles', V); revisa(s === 200 && j.usos >= 1, 'ventas elimina una categoría (avisa cuántos registros la conservan)', j);
  [s, j] = await pedir('GET', '/compras/ordenes/' + ocPapel.id, V); revisa(j.categoria_nombre === 'Papelería', 'la orden que ya la usaba no cambia', j.categoria_nombre);
  [s, j] = await pedir('POST', '/compras/ordenes', V, { ...base, categoria: 'papeleria_y_consumibles' }); revisa(s === 400, 'una categoría eliminada no se usa en órdenes nuevas', [s, j.error]);
  [s, j] = await pedir('POST', '/finanzas/categorias', V, { nombre: 'Papelería' }); revisa(s === 201, 'se recupera de nuevo para seguir la prueba');

  // Autorizar = volverse deuda; solo un administrador
  [s, j] = await pedir('POST', '/compras/ordenes/' + ocPapel.id + '/autorizar', V); revisa(s === 403, 'ventas no autoriza (no se vuelve deuda)');
  [s, j] = await pedir('GET', '/finanzas/cxp', A);
  const antes = (Array.isArray(j) ? j : j.cuentas || []).length;
  [s, j] = await pedir('POST', '/compras/ordenes/' + ocPapel.id + '/autorizar', A, { dias_credito: 15 });
  revisa(s === 200 && j.orden.estado === 'autorizada' && j.cxp_id, 'al autorizarla pasa a Cuentas por pagar', [s, j.error]);
  [s, j] = await pedir('GET', '/finanzas/cxp', A);
  revisa((Array.isArray(j) ? j : j.cuentas || []).length === antes + 1, 'aparece una cuenta por pagar nueva');
  revisa(!/uncaughtException|Error no manejado|TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
