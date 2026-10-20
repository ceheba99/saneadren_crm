// MODO DEMO: un sistema lleno de ejemplos realistas para enseñar y practicar, SIN tocar datos reales.
//
// Solo se activa con la variable MODO_DEMO=1 (se pone únicamente en el servidor de prueba, p. ej. Render) y además:
//  · solo siembra en una base SIN datos de negocio (sin clientes, cotizaciones, cuentas ni compras): si la base
//    ya tiene datos reales, se niega y no hace nada;
//  · marca la base como «base_demo». Solo una base así permite el acceso con los botones «Entrar como…»
//    (sin contraseña). En el servidor real esa marca no existe, así que esos botones nunca funcionan ahí.
// Los ejemplos se crean usando el propio sistema (como lo haría una persona), así que respetan todas las reglas.
// En Render gratis el disco se borra en cada reinicio: el demo vuelve a sembrarse limpio cada vez.
const crypto = require('crypto');
const { hashPassword } = require('./seguridad');
const { hoyMexico } = require('./fechas');

// Clave del botón, rol, nombre, texto del botón y sucursal (QRO = principal; CDMX = la segunda sucursal del ejemplo).
const USUARIOS_DEMO = [
  ['admin', 'admin', 'Dirección - Demo', 'Dirección (todas)', null], ['ventas', 'ventas', 'Laura Ventas - Demo', 'Ventas QRO', 'QRO'], ['costos', 'costos', 'Isaac Compras - Demo', 'Compras QRO', 'QRO'],
  ['tecnico', 'tecnico', 'Raúl Técnico - Demo', 'Técnico QRO', 'QRO'], ['atencion', 'atencion', 'Ana Atención - Demo', 'Atención QRO', 'QRO'],
  ['gerente_cdmx', 'gerente', 'Mónica Gerente CDMX - Demo', 'Gerente CDMX', 'CDMX'], ['ventas_cdmx', 'ventas', 'Pedro Ventas CDMX - Demo', 'Ventas CDMX', 'CDMX'],
];
const nombreDemo = clave => (USUARIOS_DEMO.find(([c]) => c === clave) || [])[2] || '';
const activo = () => process.env.MODO_DEMO === '1';

module.exports = function demo(app, db, { sesiones, PORT, SESSION_TTL_MS }) {
  const estado = { activo: activo(), listo: false, error: null, alEscuchar() {} };
  const esBaseDemo = () => !!db.prepare("SELECT 1 FROM config_servidor WHERE clave = 'base_demo' AND valor = '1'").get();
  const hayDatosNegocio = () => ['clientes', 'leads', 'cuentas_por_pagar', 'ordenes_compra', 'solicitudes_compra'].some(t => {
    try { return db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n > 0; } catch { return false; }
  });
  const usuarioDemo = clave => db.prepare('SELECT id, nombre, rol FROM usuarios WHERE nombre = ? AND activo = 1').get(nombreDemo(clave));

  // «Entrar como…» (sin contraseña): solo en el modo demo y en una base sembrada como demo.
  app.post('/api/demo/entrar', (req, res) => {
    if (!estado.activo || !esBaseDemo()) return res.status(404).json({ error: 'No disponible' });
    if (!estado.listo) return res.status(503).json({ error: 'Preparando los datos de ejemplo… intenta en unos segundos' });
    const u = usuarioDemo(String(req.body?.rol || ''));
    if (!u) return res.status(400).json({ error: 'Usuario de ejemplo no encontrado' });
    const token = crypto.randomBytes(32).toString('hex');
    sesiones.set(token, { usuarioId: u.id, expira: Date.now() + SESSION_TTL_MS });
    res.json({ token, id: u.id, nombre: u.nombre, rol: u.rol === 'gerente' ? 'admin' : u.rol, rol_real: u.rol, cambiar_password: false, demo: true });
  });
  app.get('/api/demo/estado', (req, res) => res.json({ demo: estado.activo && (esBaseDemo() || !estado.listo), listo: estado.listo, error: estado.error, usuarios: USUARIOS_DEMO.map(([c, , n, t]) => ({ rol: c, nombre: n, etiqueta: t })) }));

  if (!estado.activo) return estado;
  if (hayDatosNegocio() && !esBaseDemo()) {
    estado.activo = false;
    console.error('[demo] MODO_DEMO=1 pero esta base ya tiene datos de negocio: NO se siembran ejemplos (protección de datos reales).');
    return estado;
  }
  if (esBaseDemo()) { estado.listo = true; return estado; }
  // Se siembra cuando el servidor ya escucha (los ejemplos se crean llamando al propio sistema).
  estado.alEscuchar = () => sembrar().then(() => { estado.listo = true; console.log('[demo] datos de ejemplo listos'); })
    .catch(err => { estado.error = err.message; console.error('[demo] no se pudieron sembrar los ejemplos:', err); });
  return estado;

  async function sembrar() {
    // Usuarios de ejemplo (contraseña aleatoria que nadie conoce: se entra con los botones del demo).
    const ins = db.prepare('INSERT INTO usuarios (nombre, password, rol) VALUES (?, ?, ?)');
    for (const [clave, rol, nombre] of USUARIOS_DEMO) if (!usuarioDemo(clave)) ins.run(nombre, hashPassword(crypto.randomBytes(24).toString('hex')), rol);
    db.prepare("INSERT INTO config_servidor (clave, valor) VALUES ('base_demo', '1') ON CONFLICT(clave) DO UPDATE SET valor = '1'").run();
    const tok = rol => { const t = crypto.randomBytes(32).toString('hex'); sesiones.set(t, { usuarioId: usuarioDemo(rol).id, expira: Date.now() + 3600000 }); return t; };
    const A = tok('admin'), V = tok('ventas'), C = tok('costos'), T = tok('tecnico');
    const URL = `http://127.0.0.1:${PORT}/api`;
    const pedir = async (m, r, t, b) => {
      const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: b === undefined ? undefined : JSON.stringify(b) });
      const j = await x.json().catch(() => ({}));
      if (x.status >= 400) throw new Error(`${m} ${r} → ${x.status} ${j.error || ''}`);
      return j;
    };
    const subir = async (r, t, buf, enc) => {
      const h = { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + t };
      for (const [k, v] of Object.entries(enc)) h[k] = encodeURIComponent(String(v));
      const x = await fetch(URL + r, { method: 'POST', headers: h, body: buf });
      const j = await x.json().catch(() => ({})); if (x.status >= 400) throw new Error(`subir ${r} → ${x.status} ${j.error || ''}`); return j;
    };
    const pdf = t => Buffer.from(`%PDF-1.4\n% ${t} ${crypto.randomBytes(6).toString('hex')}\n%%EOF`);
    const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(48)]);
    const HOY = hoyMexico();
    const dia = n => { const x = new Date(HOY + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const min = (a, b) => (a < b ? a : b);
    // Segunda sucursal (CDMX) y la sucursal de cada usuario de ejemplo.
    const cdmx = await pedir('POST', '/sucursales', A, { nombre: 'Ciudad de México', clave: 'CDMX', direccion: 'Av. Insurgentes Sur 1602, Benito Juárez' });
    const qroId = db.prepare("SELECT id FROM sucursales WHERE clave = 'QRO'").get()?.id ?? db.prepare('SELECT id FROM sucursales ORDER BY id LIMIT 1').get().id;
    for (const [clave, , , , s] of USUARIOS_DEMO) if (s) {
      const u = usuarioDemo(clave); db.prepare('DELETE FROM usuario_sucursales WHERE usuario_id = ?').run(u.id);
      db.prepare('INSERT INTO usuario_sucursales (usuario_id, sucursal_id) VALUES (?, ?)').run(u.id, s === 'CDMX' ? cdmx.id : qroId);
    }
    const GC = tok('gerente_cdmx'), VC = tok('ventas_cdmx');
    const usuarios = await pedir('GET', '/usuarios', A), idDe = clave => usuarios.find(u => u.nombre === nombreDemo(clave)).id;
    const [canales, servicios, centros] = await Promise.all([pedir('GET', '/canales', A), pedir('GET', '/servicios', A), pedir('GET', '/compras/centros', A)]);
    const servicio = n => { const s = servicios.find(x => x.nombre === n); if (!s) throw new Error('Servicio no está en el catálogo: ' + n); return s; };
    const canal = n => (canales.find(c => c.nombre === n) || canales[0]).id;
    // Personal (RH): el técnico con cuenta, un operador y un ayudante sin cuenta en QRO, y un operador en CDMX.
    const persona = async datos => { const p = await pedir('POST', '/personal', A, datos); if (!p.id) throw new Error('Personal de ejemplo: ' + JSON.stringify(p)); return p.id; };
    const PER = {
      raul: await persona({ nombre: 'Raúl Técnico - Demo', puesto: 'Técnico', usuario_id: idDe('tecnico'), telefono: '442 555 1001', fecha_ingreso: dia(-900), licencia_tipo: 'Federal B', licencia_numero: 'QRO-123456', licencia_vence: dia(20), contacto_emergencia: 'María (esposa)', tel_emergencia: '442 555 1002', banco: 'BBVA', clabe: '012180001234567899', salario: 520, salario_periodo: 'diario', tipo_contrato: 'Indeterminado' }),
      diego: await persona({ nombre: 'Diego Arturo Hernández', puesto: 'Operador', telefono: '442 555 1003', fecha_ingreso: dia(-420), licencia_tipo: 'Federal E', licencia_vence: dia(300), tipo_contrato: 'Indeterminado' }),
      luis: await persona({ nombre: 'Luis Ángel Pérez', puesto: 'Ayudante', telefono: '442 555 1004', fecha_ingreso: dia(-120), tipo_contrato: 'Periodo de prueba', contrato_vence: dia(15) }),
      oscar: await persona({ nombre: 'Óscar Medina', puesto: 'Operador', telefono: '55 5555 1005', fecha_ingreso: dia(-200), sucursal_id: cdmx.id, licencia_tipo: 'Federal B', licencia_vence: dia(-5) }),
    };
    await pedir('POST', '/personal/' + PER.raul + '/incidencias', A, { tipo: 'vacaciones', fecha_inicio: dia(-60), fecha_fin: dia(-56), notas: 'Vacaciones de verano' });
    await pedir('POST', '/personal/' + PER.diego + '/incidencias', A, { tipo: 'incapacidad', fecha_inicio: dia(-30), fecha_fin: dia(-28), con_goce: false, notas: 'Incapacidad IMSS' });
    const contacto = async (nombre, telefono, empresa, direccion, canalNombre, rfc) => {
      const c = await pedir('POST', '/contactos', V, { nombre, telefono, empresa_contacto: empresa, direccion, canal_origen_id: canal(canalNombre) });
      if (rfc) await pedir('PUT', '/clientes/' + c.id, A, { ...c, rfc });
      return c;
    };
    // Cotización → (opcional) orden de servicio → realizado → factura → cobros
    const orden = async ({ cliente, serv, partidas, iva = 'mas_iva', fCot, fServ, direccion, proyecto, equipo, operador, realizado, sub, propio, factura, cobros = [], quien = V, tec, resp = 'ventas', etapa, tecnico = resp === 'ventas' ? 'tecnico' : null }) => {
      const s = servicio(serv);
      const items = partidas.map(p => ({ servicio: s.nombre, leyenda: p.leyenda, ...(p.cantidad ? { cantidad: p.cantidad, precio: p.precio, importe: p.cantidad * p.precio } : { importe: p.importe }) }));
      const c = await pedir('POST', '/leads', quien, { cliente_id: cliente.id, direccion: direccion || cliente.direccion, canal_id: canal('Llamada telefónica'), servicio_id: s.id, responsable_id: idDe(resp),
        forzar_duplicado: true, partidas_json: JSON.stringify(items), iva_modo: iva, valor: 1, fecha_cotizacion: fCot });
      if (etapa) await pedir('PUT', '/leads/' + c.id, quien, { version: (await pedir('GET', '/leads/' + c.id, quien)).version, etapa });
      if (!fServ) return c;
      await pedir('PUT', '/leads/' + c.id, quien, { version: (await pedir('GET', '/leads/' + c.id, quien)).version, estatus: 'ganado', fecha_servicio: fServ, ...(tecnico ? { equipo_personal: [{ personal_id: PER.raul, papel: 'responsable' }, { personal_id: PER.diego, papel: 'operador' }] } : {}), ...(proyecto ? { proyecto } : {}), ...(equipo ? { equipo } : {}), ...(operador ? { operador } : {}) });
      if (realizado) await pedir('POST', '/leads/' + c.id + '/ejecucion', tec || T, { estado: 'realizado', fecha: realizado, realizado_por: sub ? 'subcontratado' : 'propio', gastos: sub || propio || [] });
      if (factura) await pedir('PUT', '/leads/' + c.id + '/facturacion', A, { dias_credito: factura.dias, factura_folio: factura.folio, factura_fecha: factura.fecha, factura_metodo: factura.metodo || 'PUE' });
      for (const k of cobros) if (k.fecha <= HOY) await pedir('POST', '/leads/' + c.id + '/cobros', A, { monto: k.monto, metodo: k.metodo || 'transferencia', fecha: k.fecha, referencia: k.ref || null });
      return c;
    };
    const total = (sub, iva = 'mas_iva') => (iva === 'mas_iva' ? Math.round(sub * 116) / 100 : sub);

    // ===== Proveedores =====
    const prov = {};
    for (const [k, nombre, cat, dias, clabe, banco] of [
      ['pipas', 'Pipas Hermanos Ramírez', 'renta_maquinaria', 15, '014680655039528945', 'Santander'], ['llantera', 'Llantera Querétaro', 'mantto_vehiculos', 15, null, null],
      ['bajio', 'Llantas del Bajío', 'mantto_vehiculos', 15, '072680010337891087', 'Banorte'], ['servi', 'Servillantas', 'mantto_vehiculos', 7, null, null],
      ['bombas', 'Bombas y Equipos del Centro', 'refacciones', 0, null, null], ['banorte', 'Banco Banorte', 'creditos', 0, null, 'Banorte'],
      ['renta', 'Inmobiliaria Constituyentes', 'renta_inmuebles', 0, '012420015116262450', 'BBVA'], ['cfe', 'Comisión Federal de Electricidad', 'servicios_oficina', 0, null, null],
      ['imss', 'Instituto Mexicano del Seguro Social', 'impuestos', 0, null, null], ['comidas', 'Cocina Doña Angélica', 'casetas_viaticos', 0, null, null],
      ['gasolinera', 'Combucenter Querétaro', 'combustible', 0, null, null], ['camiones', 'Camiones Groso', 'activos', 30, null, null],
      ['disposicion', 'Disposición del Bajío', 'residuos', 30, null, null]]) prov[k] = await pedir('POST', '/finanzas/proveedores', A, { nombre, categoria: cat, dias_credito: dias, clabe, banco });

    // ===== 1. Caso sencillo: un desazolve de contado =====
    const esquina = await contacto('Don Roberto Méndez', '442 215 3040', 'Restaurante La Esquina', 'Av. Universidad 120, Centro', 'Llamada telefónica');
    await orden({ cliente: esquina, serv: 'Desazolve de drenaje', partidas: [{ leyenda: 'Desazolve de línea principal de cocina, 15 m', importe: 3500 }], fCot: dia(-24), fServ: dia(-22), realizado: dia(-22),
      factura: { dias: 0, folio: 'A-1001', fecha: dia(-22) }, cobros: [{ monto: total(3500), metodo: 'efectivo', fecha: dia(-22) }] });

    // ===== 2. KFC: un solo cliente (misma razón social), varias sucursales =====
    const kfc = await contacto('Ing. Sofía Hernández · Mantenimiento', '442 690 1122', 'Operadora KFC del Bajío S.A. de C.V.', 'Oficinas: Blvd. Bernardo Quintana 400', 'Correo electrónico', 'OKB980512AB3');
    const sucursales = [['Constituyentes', 'Av. Constituyentes 101'], ['Juriquilla', 'Blvd. Juriquilla 3002'], ['Zaragoza', 'Av. Zaragoza 55'], ['Plaza Antea', 'Antea Lifestyle Center, local 12'], ['El Marqués', 'Av. Paseo de la Constitución 9'], ['Bernardo Quintana', 'Blvd. Bernardo Quintana 1450']];
    const kfcPlan = [[-50, true, 'pagada'], [-41, true, 'pagada'], [-33, true, 'parcial'], [-26, true, 'pagada'], [-12, true, 'pendiente'], [4, false, 'programada']];
    for (const [i, [s, dir]] of sucursales.entries()) {
      const [d, hecho, cobro] = kfcPlan[i], fServ = d > 0 ? dia(d) : dia(d), t = total(4800);
      await orden({ cliente: kfc, serv: 'Limpieza de trampas de grasa', partidas: [{ leyenda: `Limpieza de trampa de grasa · sucursal ${s}`, importe: 4800 }], fCot: dia(Math.min(d, 0) - 3), fServ,
        direccion: `Sucursal ${s} · ${dir}`, proyecto: `Sucursal ${s}`, equipo: 'E-37', operador: 'Diego Arturo Hdz',
        realizado: hecho ? fServ : null, factura: hecho ? { dias: 30, folio: 'A-' + (1100 + i), fecha: fServ } : null,
        cobros: cobro === 'pagada' ? [{ monto: t, fecha: dia(d + 28), ref: 'SPEI KFC ' + (i + 1) }] : cobro === 'parcial' ? [{ monto: 2500, fecha: dia(d + 25), ref: 'SPEI KFC parcial' }] : [] });
    }

    // ===== 3. Symrise: recolección de agua de lunes a sábado con pipas rentadas a un tercero =====
    const symrise = await contacto('Lic. Mariana Torres · Compras', '442 238 7700', 'Symrise S.A. de C.V.', 'Parque Industrial Querétaro, Av. La Noria 101', 'Correo electrónico', 'SYM030101KA2');
    // Lunes 5 viajes, martes a viernes 3, sábado 5. Una orden por día; las pipas las renta y opera «Pipas Hermanos Ramírez».
    // El cliente paga a 30 días (las semanas más viejas ya están cobradas) y a las pipas se les paga cada semana.
    const SEMANAS = 8, lunes0 = -((new Date(HOY + 'T12:00:00Z').getUTCDay() + 6) % 7) - 7 * (SEMANAS - 1);
    let folioSym = 2000;
    for (let semana = 0; semana < SEMANAS; semana++) {
      const L = lunes0 + semana * 7;
      for (let d = 0; d < 6; d++) {
        if (L + d >= 0) continue; // solo días ya trabajados
        const viajes = d === 0 || d === 5 ? 5 : 3, f = dia(L + d);
        const o = await orden({ cliente: symrise, serv: 'Retiro de agua / bombeo', partidas: [{ leyenda: `Recolección de agua residual · ${viajes} viajes de pipa 20 m³`, cantidad: viajes, precio: 3200 }],
          fCot: dia(L), fServ: f, realizado: f, proyecto: 'Planta Symrise · recolección diaria', equipo: 'Pipa 20 m³', operador: 'Supervisa: Diego Arturo Hdz',
          sub: [{ proveedor_id: prov.pipas.id, categoria: 'renta_maquinaria', concepto: `Renta de pipa 20 m³ con operador · ${viajes} viajes`, total: viajes * 1900 }],
          factura: { dias: 30, folio: 'SYM-' + (++folioSym), fecha: f }, cobros: L + d + 30 < -1 ? [{ monto: total(viajes * 3200), fecha: dia(L + d + 30), ref: 'SPEI Symrise ' + f }] : [] });
        const pagoPipas = L + 12; // el lunes de la semana siguiente a la que se trabajó
        if (pagoPipas <= 0) for (const x of await pedir('GET', '/finanzas/cxp?vista=todas&lead_id=' + o.id, C))
          if (x.saldo > 0) await pedir('POST', '/finanzas/cxp/' + x.id + '/pagos', C, { monto: x.saldo, metodo: 'transferencia', fecha: dia(pagoPipas), referencia: 'Pago semanal pipas', cuenta_origen: 'Santander empresa' });
      }
    }

    // ===== 3b. El día a día: servicios sueltos con equipo propio (combustible y disposición como costo) =====
    const cs = [];
    for (const [nombre, tel, emp, dir, cn, rfc] of [
      ['Lic. Andrea Solís', '442 301 4455', 'Plaza Comercial Boulevares', 'Blvd. Bernardo Quintana 4100', 'Correo electrónico', 'PCB100215QR1'],
      ['Sr. Jorge Medina', '442 118 9090', 'Jorge Medina (casa habitación)', 'Fracc. Milenio III, calle Jade 14', 'WhatsApp', null],
      ['Ing. Carla Fuentes', '442 277 6512', 'Autopartes del Centro S.A. de C.V.', 'Parque Industrial El Marqués, nave 7', 'Correo electrónico', 'ACE090901LM4'],
      ['Arq. Daniel Ortiz', '442 455 7788', 'Constructora Arco Bajío', 'Obra Zibatá, El Marqués', 'Llamada telefónica', 'CAB150612HT8'],
      ['Sra. Patricia León', '442 160 2323', 'Fraccionamiento Cumbres del Lago (administración)', 'Juriquilla', 'WhatsApp', null],
      ['Ing. Héctor Lara', '442 299 1414', 'Plásticos Moldeados de Querétaro', 'Av. 5 de Febrero 1325', 'Correo electrónico', 'PMQ070320BB9']]) cs.push(await contacto(nombre, tel, emp, dir, cn, rfc));
    const TRABAJOS = [['Desazolve de drenaje', 'Desazolve de red sanitaria con equipo hidroneumático', 8500], ['Limpieza de fosas y cárcamos', 'Limpieza de fosa séptica y retiro de lodos', 14500],
      ['Servicio industrial (aceitosos)', 'Retiro de agua aceitosa de cárcamo industrial', 42000], ['Video inspección de tuberías', 'Video inspección de línea sanitaria con reporte', 9800],
      ['Retiro de agua / bombeo', 'Bombeo de agua pluvial en sótano', 18600], ['Rehabilitación de tuberías (CIPP)', 'Rehabilitación de 12 m de tubería con manga CIPP', 68000]];
    let folioA = 1300;
    for (let i = 0; i < 26; i++) {
      const d = -78 + i * 3 + (i % 3), cl = cs[i % cs.length], [serv, ley, base] = TRABAJOS[(i * 5) % TRABAJOS.length];
      const imp = Math.round(base * (1 + (i % 4) * 0.12) / 100) * 100, particular = i % cs.length === 1 || i % cs.length === 4, credito = particular ? 0 : 15;
      const facturado = d < -4, vence = d + credito;
      const pagado = facturado && (particular || (vence < -3 && i % 7 !== 3));
      const gastos = [{ proveedor_id: prov.gasolinera.id, categoria: 'combustible', concepto: 'Diésel del servicio', total: Math.round(imp * 0.07), ya_pagado: true, metodo: 'tarjeta', fecha_pago: dia(d) }];
      if (/fosa|aceitosa|cárcamo/i.test(ley)) gastos.push({ proveedor_id: prov.disposicion.id, categoria: 'residuos', concepto: 'Disposición de lodos y agua residual', total: Math.round(imp * 0.11) });
      await orden({ cliente: cl, serv, partidas: [{ leyenda: ley, importe: imp }], fCot: dia(d - 3), fServ: dia(d), realizado: dia(d), equipo: ['E-37', 'E-44', 'V-12'][i % 3], operador: ['Diego Arturo Hdz', 'Juan Carlos Ríos', 'Miguel Ángel Soto'][i % 3],
        propio: gastos, factura: facturado ? { dias: credito, folio: 'A-' + (++folioA), fecha: dia(d) } : null,
        cobros: pagado ? [{ monto: total(imp), metodo: particular ? 'efectivo' : 'transferencia', fecha: dia(Math.min(vence + (i % 2), -1)), ref: particular ? null : 'SPEI ' + cl.empresa_contacto.split(' ')[0] }] : [] });
    }
    for (const [i, d] of [[0, 2], [2, 5], [3, 9]].entries()) // trabajos ya programados para los próximos días
      await orden({ cliente: cs[d[0]], serv: TRABAJOS[i][0], partidas: [{ leyenda: TRABAJOS[i][1], importe: TRABAJOS[i][2] }], fCot: dia(-2), fServ: dia(d[1]), equipo: 'E-37', operador: 'Diego Arturo Hdz' });

    // ===== 4. Otros casos de ventas =====
    const hotel = await contacto('Ing. Ramírez', '442 555 0101', 'Hotel Real de Querétaro', 'Av. Constituyentes 100', 'WhatsApp');
    const cotHotel = await orden({ cliente: hotel, serv: 'Video inspección de tuberías', partidas: [{ leyenda: 'Video inspección de 60 m de tubería de 6"', importe: 9800 }], fCot: dia(-15) });
    await pedir('PUT', '/leads/' + cotHotel.id, V, { version: (await pedir('GET', '/leads/' + cotHotel.id, V)).version, estatus: 'perdido', motivo_perdida: 'Precio alto: eligió a otro proveedor' });
    const plaza = await contacto('Administración Plaza Galerías', '442 410 2020', 'Plaza Galerías Querétaro', 'Av. 5 de Febrero 99', 'Llamada telefónica');
    const noReal = await orden({ cliente: plaza, serv: 'Limpieza de fosas y cárcamos', partidas: [{ leyenda: 'Limpieza de cárcamo de bombeo', importe: 12000 }], fCot: dia(-20), fServ: dia(-14), cobros: [{ monto: 5000, fecha: dia(-18), ref: 'Anticipo 40%' }] });
    await pedir('POST', '/leads/' + noReal.id + '/ejecucion', T, { estado: 'no_realizado', motivo: 'El cliente canceló porque la plaza cerró por remodelación' });
    const hospital = await contacto('Ing. Pablo Ruiz · Mantenimiento', '442 192 0000', 'Hospital San José Querétaro', 'Prol. Constituyentes 302', 'Correo electrónico', 'HSJ850101MT5');
    await orden({ cliente: hospital, serv: 'Mantenimiento a plantas de tratamiento', partidas: [{ leyenda: 'Mantenimiento mensual a planta de tratamiento', importe: 45000 }], fCot: dia(-35), fServ: dia(-30), realizado: dia(-30),
      factura: { dias: 30, folio: 'A-1200', fecha: dia(-30), metodo: 'PPD' }, cobros: [{ monto: 20000, fecha: dia(-15), ref: 'Parcialidad 1' }, { monto: 15000, fecha: dia(-2), ref: 'Parcialidad 2' }] });
    for (const [nombre, tel, emp, serv, imp, etapa, d] of [['Arq. Lucía Paredes', '442 300 1111', 'Condominio Los Arcos', 'Desazolve de drenaje', 6500, 2, -6], ['Ing. Tomás Vega', '442 300 2222', 'Planta Kellogg Querétaro', 'Servicio industrial (aceitosos)', 38000, 3, -4], ['Dirección escolar', '442 300 3333', 'Colegio Monte Alto', 'Limpieza de fosas y cárcamos', 8900, 2, -1]]) {
      const cl = await contacto(nombre, tel, emp, 'Querétaro', 'WhatsApp');
      await orden({ cliente: cl, serv, partidas: [{ leyenda: 'Cotización ' + serv.toLowerCase(), importe: imp }], fCot: dia(d), etapa });
    }

    // ===== 5. Compras: solicitudes, cotizaciones, órdenes, autorización, pago y recepción =====
    const mantto = centros.find(c => c.nombre === 'Mantenimiento') || centros[0], opera = centros.find(c => c.nombre === 'Operaciones') || centros[0];
    // a) Normal: llantas para el C-22
    const s1 = await pedir('POST', '/compras/solicitudes', V, { que: '4 llantas 11R22.5 para el camión C-22', para_que: 'Se reventó una y las demás están lisas; el camión hace la ruta de Symrise', centro_id: mantto.id, equipo: 'C-22', urgente: false });
    await subir('/compras/solicitudes/' + s1.id + '/documentos', V, png(), { 'X-Tipo': 'foto', 'X-Nombre': 'llanta-c22.png' });
    await pedir('POST', '/compras/solicitudes/' + s1.id + '/aprobar', A);
    for (const [k, monto, entrega] of [['llantera', 16800, '1 día'], ['bajio', 15800, '2 días'], ['servi', 17200, '3 días']])
      await subir('/compras/solicitudes/' + s1.id + '/documentos', C, pdf('cotizacion ' + k), { 'X-Tipo': 'cotizacion', 'X-Proveedor': prov[k].id, 'X-Monto': monto, 'X-Entrega': entrega, 'X-Nombre': 'cotizacion-' + k + '.pdf' });
    const c1 = (await pedir('GET', '/compras/solicitudes/' + s1.id, C)).cotizaciones.find(c => c.proveedor_id === prov.bajio.id);
    await pedir('POST', '/compras/solicitudes/' + s1.id + '/elegir', C, { cotizacion_id: c1.id });
    const oc1 = await pedir('POST', '/compras/ordenes', C, { solicitud_id: s1.id, proveedor_id: prov.bajio.id, centro_id: mantto.id, categoria: 'mantto_vehiculos', iva_modo: 'incluido', partidas: [{ cantidad: 4, descripcion: 'Llanta 11R22.5', unidad: 'PZA', precio: 3950 }] });
    const aut1 = await pedir('POST', '/compras/ordenes/' + oc1.id + '/autorizar', A, { dias_credito: 15 });
    await pedir('POST', '/finanzas/cxp/' + aut1.cxp_id + '/pagos', C, { monto: 15800, metodo: 'transferencia', fecha: HOY, referencia: 'SPEI llantas C-22', cuenta_origen: 'Santander empresa' });
    await subir('/compras/ordenes/' + oc1.id + '/documentos', C, png(), { 'X-Tipo': 'firma_recepcion', 'X-Nombre': 'firma-almacen.png' });
    await pedir('POST', '/compras/ordenes/' + oc1.id + '/recibir', C, { recibio: 'Raúl Técnico', nota: 'Llegaron las 4 llantas' });
    // b) Urgente sin las 3 cotizaciones
    const s2 = await pedir('POST', '/compras/solicitudes', T, { que: 'Bomba sumergible 2 HP', para_que: 'Se quemó la bomba durante un servicio de emergencia en KFC Juriquilla', centro_id: opera.id, urgente: true });
    await pedir('POST', '/compras/solicitudes/' + s2.id + '/aprobar', A);
    await subir('/compras/solicitudes/' + s2.id + '/documentos', C, pdf('cotizacion bomba'), { 'X-Tipo': 'cotizacion', 'X-Proveedor': prov.bombas.id, 'X-Monto': 8900, 'X-Entrega': 'Hoy', 'X-Nombre': 'cotizacion-bomba.pdf' });
    const c2 = (await pedir('GET', '/compras/solicitudes/' + s2.id, C)).cotizaciones[0];
    await pedir('POST', '/compras/solicitudes/' + s2.id + '/elegir', C, { cotizacion_id: c2.id, motivo_urgencia: 'El cliente está inundado y no hay otra bomba en almacén' });
    const oc2 = await pedir('POST', '/compras/ordenes', C, { solicitud_id: s2.id, proveedor_id: prov.bombas.id, centro_id: opera.id, categoria: 'refacciones', iva_modo: 'incluido', partidas: [{ cantidad: 1, descripcion: 'Bomba sumergible 2 HP', unidad: 'PZA', precio: 8900 }] });
    await pedir('POST', '/compras/ordenes/' + oc2.id + '/autorizar', A, { dias_credito: 0 });
    // c) Rechazada, d) cotizando y e) por aprobar
    const s3 = await pedir('POST', '/compras/solicitudes', V, { que: 'Silla ejecutiva de piel', para_que: 'Para la oficina de ventas', centro_id: centros.find(c => c.nombre === 'Ventas')?.id || mantto.id });
    await pedir('POST', '/compras/solicitudes/' + s3.id + '/rechazar', A, { motivo: 'No hay presupuesto este mes' });
    const s4 = await pedir('POST', '/compras/solicitudes', T, { que: 'Manguera de succión 4 pulgadas, 20 m', para_que: 'La de la unidad E-44 está rota', centro_id: opera.id, equipo: 'E-44' });
    await pedir('POST', '/compras/solicitudes/' + s4.id + '/aprobar', C);
    for (const [k, monto] of [['llantera', 6200], ['bombas', 5900]]) await subir('/compras/solicitudes/' + s4.id + '/documentos', C, pdf('manguera ' + k), { 'X-Tipo': 'cotizacion', 'X-Proveedor': prov[k].id, 'X-Monto': monto, 'X-Nombre': 'manguera-' + k + '.pdf' });
    await pedir('POST', '/compras/solicitudes', V, { que: 'Uniformes para 6 técnicos', para_que: 'Los actuales ya están rotos', centro_id: opera.id, fecha_requerida: dia(10) });

    // ===== 6. Cuentas por pagar fijas y otros gastos =====
    const cxp = (cuerpo, quien = C) => pedir('POST', '/finanzas/cxp', quien, cuerpo);
    const pagar = (id, monto, fecha, metodo, cuenta, ref) => pedir('POST', '/finanzas/cxp/' + id + '/pagos', C, { monto, metodo, fecha, cuenta_origen: cuenta, referencia: ref || null });
    const credito1 = await cxp({ proveedor_id: prov.banorte.id, categoria: 'creditos', concepto: 'Mensualidad 3 de 36 · crédito empresarial Banorte', total: 68450.20, fecha_documento: dia(-45), dias_credito: 0, tipo_comprobante: 'estado_cuenta' });
    await pagar(credito1.id, 68450.20, dia(-45), 'domiciliado', 'Banorte empresa');
    await cxp({ proveedor_id: prov.banorte.id, categoria: 'creditos', concepto: 'Mensualidad 4 de 36 · crédito empresarial Banorte', total: 68450.20, fecha_documento: dia(-15), dias_credito: 0, tipo_comprobante: 'estado_cuenta' });
    const renta1 = await cxp({ proveedor_id: prov.renta.id, categoria: 'renta_inmuebles', concepto: 'Renta de oficina y patio · mes anterior', total: 28000, fecha_documento: dia(-32), dias_credito: 5, tipo_comprobante: 'factura', metodo_sat: 'PUE', factura_folio: 'R-501' });
    await pagar(renta1.id, 28000, dia(-28), 'transferencia', 'Santander empresa', 'SPEI renta');
    await cxp({ proveedor_id: prov.renta.id, categoria: 'renta_inmuebles', concepto: 'Renta de oficina y patio · este mes', total: 28000, fecha_documento: dia(-2), dias_credito: 5, tipo_comprobante: 'factura', metodo_sat: 'PUE', factura_folio: 'R-502' });
    const luz = await cxp({ proveedor_id: prov.cfe.id, categoria: 'servicios_oficina', concepto: 'Luz de oficina y taller · bimestre', total: 7157, fecha_documento: dia(-20), dias_credito: 10, tipo_comprobante: 'recibo' });
    await pagar(luz.id, 7157, dia(-12), 'transferencia', 'Santander empresa');
    await cxp({ proveedor_id: prov.imss.id, categoria: 'impuestos', concepto: 'Cuotas IMSS, RCV e INFONAVIT del mes', total: 48360, fecha_documento: dia(-6), dias_credito: 10, tipo_comprobante: 'linea_captura' });
    for (let s = 3; s >= 0; s--) {
      const c = await cxp({ proveedor_id: prov.comidas.id, categoria: 'casetas_viaticos', concepto: `Comidas del personal · semana ${s === 0 ? 'actual' : 'de hace ' + s}`, total: 7020, fecha_documento: dia(-7 * s - 1), dias_credito: 0, tipo_comprobante: 'sin_factura' });
      if (s > 0) await pagar(c.id, 7020, dia(-7 * s - 1), 'pagadora', 'Pagadora');
    }
    await cxp({ proveedor_id: prov.gasolinera.id, categoria: 'combustible', concepto: 'Gasolina de la camioneta de dirección (la pagó Luis con su tarjeta)', total: 1543.05, fecha_documento: dia(-9), dias_credito: 0,
      tipo_comprobante: 'factura', metodo_sat: 'PUE', factura_folio: '285987', beneficiario: 'Luis Ángel Perea García', notas: 'Reembolsar a Luis Perea' });
    const camion = await cxp({ proveedor_id: prov.camiones.id, categoria: 'activos', concepto: 'Tracto camión FAW 2026 (enganche)', total: 1825000, fecha_documento: dia(-40), dias_credito: 60, tipo_comprobante: 'factura', metodo_sat: 'PPD', factura_folio: 'GROSO-77' }, A);
    await pagar(camion.id, 500000, dia(-38), 'transferencia', 'Santander empresa', 'Enganche camión');
    await cxp({ proveedor_id: prov.disposicion.id, categoria: 'residuos', concepto: 'Disposición de lodos del mes (todas las órdenes)', total: 9860, fecha_documento: dia(-8), dias_credito: 30, tipo_comprobante: 'factura', metodo_sat: 'PUE', factura_folio: 'DB-311' });

    // ===== 7. Sucursal CDMX: opera lo suyo; solo Dirección ve las dos =====
    const torre = await pedir('POST', '/contactos', VC, { nombre: 'Arq. Daniela Ríos · Mantenimiento', telefono: '55 5250 7700', empresa_contacto: 'Corporativo Torre Reforma', direccion: 'Paseo de la Reforma 483, Cuauhtémoc', canal_origen_id: canal('Correo electrónico') });
    await orden({ cliente: torre, quien: VC, tec: GC, resp: 'ventas_cdmx', serv: 'Desazolve de drenaje', partidas: [{ leyenda: 'Desazolve de bajadas pluviales y cárcamo del sótano 3', importe: 28500 }], fCot: dia(-14), fServ: dia(-12), realizado: dia(-12),
      factura: { dias: 15, folio: 'C-101', fecha: dia(-12) }, cobros: [{ monto: total(28500), fecha: dia(-2), ref: 'SPEI Torre Reforma' }] });
    const antara = await pedir('POST', '/contactos', VC, { nombre: 'Ing. Mauricio Peña', telefono: '55 5280 4411', empresa_contacto: 'Centro Comercial Plaza Lomas', direccion: 'Av. Ejército Nacional 843, Granada', canal_origen_id: canal('Llamada telefónica') });
    await orden({ cliente: antara, quien: VC, tec: GC, resp: 'ventas_cdmx', serv: 'Limpieza de fosas y cárcamos', partidas: [{ leyenda: 'Limpieza de cárcamo de aguas negras y retiro de lodos', importe: 36000 }], fCot: dia(-8), fServ: dia(-4), realizado: dia(-4),
      factura: { dias: 30, folio: 'C-102', fecha: dia(-4) } });
    for (const [s, dir, d, cobrar] of [['Reforma', 'Paseo de la Reforma 222', -10, false], ['Polanco', 'Av. Presidente Masaryk 101', -6, false], ['Coyoacán', 'Av. Miguel Ángel de Quevedo 450', 3, false]])
      await orden({ cliente: kfc, quien: VC, tec: GC, resp: 'ventas_cdmx', serv: 'Limpieza de trampas de grasa', partidas: [{ leyenda: `Limpieza de trampa de grasa · sucursal ${s} (CDMX)`, importe: 5200 }], fCot: dia(Math.min(d, 0) - 2), fServ: dia(d),
        direccion: `Sucursal ${s} · ${dir}`, proyecto: `Sucursal ${s}`, equipo: 'CDMX-01', operador: 'Óscar Medina', realizado: d < 0 ? dia(d) : null, factura: d < 0 ? { dias: 30, folio: 'C-1' + (200 - d), fecha: dia(d) } : null,
        cobros: cobrar ? [{ monto: total(5200), fecha: dia(d + 14), ref: 'SPEI KFC CDMX' }] : [] });
    const hotelC = await pedir('POST', '/contactos', VC, { nombre: 'Lic. Ernesto Salas', telefono: '55 5512 3344', empresa_contacto: 'Hotel Centro Histórico', direccion: 'República de Uruguay 40, Centro', canal_origen_id: canal('WhatsApp') });
    await orden({ cliente: hotelC, quien: VC, resp: 'ventas_cdmx', serv: 'Video inspección de tuberías', partidas: [{ leyenda: 'Video inspección de colector general, 80 m', importe: 14500 }], fCot: dia(-3), etapa: 3 });
    const provCdmx = await pedir('POST', '/finanzas/proveedores', A, { nombre: 'Inmobiliaria Insurgentes', categoria: 'renta_inmuebles', dias_credito: 0 });
    const rentaC = await pedir('POST', '/finanzas/cxp', GC, { proveedor_id: provCdmx.id, categoria: 'renta_inmuebles', concepto: 'Renta de bodega y oficina CDMX · este mes', total: 18500, fecha_documento: dia(-5), dias_credito: 5, tipo_comprobante: 'factura', metodo_sat: 'PUE', factura_folio: 'II-88' });
    await pedir('POST', '/finanzas/cxp/' + rentaC.id + '/pagos', GC, { monto: 18500, metodo: 'transferencia', fecha: dia(-4), referencia: 'SPEI renta CDMX', cuenta_origen: 'BBVA sucursal CDMX' });
    await pedir('POST', '/finanzas/cxp', GC, { proveedor_id: prov.gasolinera.id, categoria: 'combustible', concepto: 'Diésel unidad CDMX-01 · semana', total: 6400, fecha_documento: dia(-2), dias_credito: 0, tipo_comprobante: 'factura', metodo_sat: 'PUE', factura_folio: 'CB-9921' });
    await pedir('POST', '/compras/solicitudes', VC, { que: 'Hidrolavadora de agua caliente para la unidad CDMX-01', para_que: 'Las trampas de grasa de KFC CDMX requieren agua caliente', centro_id: opera.id, equipo: 'CDMX-01', urgente: false });

    // Al final: la revisión de integridad debe salir limpia.
    const r = require('./alcance').global(() => require('./integridad').revisar(db, {}));
    console.log(`[demo] revisión de integridad: ${r.errores} errores, ${r.avisos} avisos`);
    for (const t of [A, V, C, T, GC, VC]) sesiones.delete?.(t);
  }
};
