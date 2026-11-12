// MÓDULO CONTABLE · F1 (2026-11-11): «Contabilidad del mes» para el contador. Consulta y descarga; el cierre del mes y el
// saldo inicial del banco (2026-11-12) están en server/contabilidad-cierres.js.
//  · Quién: Dirección y quien tenga «Contabilidad del mes» (contabilidad.ver), con las sucursales que ve.
//  · Resumen del mes: lo facturado (CFDI reales), lo cobrado CONFIRMADO, los gastos del mes y lo pagado a proveedores, y el
//    IVA visto de dos formas (según las facturas del mes y según el dinero que entró y salió). Son cifras de apoyo: qué
//    se declara lo decide el contador.
//  · Pendientes de comprobar: gastos con factura sin su XML, gastos con IVA estimado, cobros por confirmar, facturas
//    canceladas en el mes y anticipos por comprobar abiertos (F2, server/anticipos.js).
//  · Descargas: los datos del Excel (la pantalla lo arma, como los demás Excel) y un .tar con los XML del mes (facturas
//    emitidas y de gastos).
const path = require('path'), fs = require('fs');
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const pesos = c => Math.round(Number(c || 0)) / 100;
const COMP = { recibo: 'Recibo', estado_cuenta: 'Estado de cuenta', linea_captura: 'Línea de captura', nomina: 'Nómina', pagadora: 'Pagadora', sin_factura: 'Sin factura', otro: 'Otro' };

module.exports = function contabilidad(app, db, h) {
  const P = app.locals.permisos;
  const puede = req => P.direccion(req) || P.puede(req, 'contabilidad.ver');
  const negar = res => res.status(403).json({ error: 'La contabilidad del mes la ven Dirección y quien tenga «Contabilidad del mes»' });
  const { ivaDeGasto, CATEGORIAS } = require('./finanzas');
  const { estadoConfig } = require('./facturacion-config');
  const entorno = () => (process.env.MODO_DEMO === '1' ? 'demo' : estadoConfig(process.env).entorno);
  const base = process.env.DB_PATH ? path.dirname(path.resolve(process.env.DB_PATH)) : path.join(__dirname, '..');
  const dirXmlGastos = path.join(base, 'archivos', 'cuentas_por_pagar');
  const tabla = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(t);
  const folioOS = (id, creado) => (id ? require('./sucursales').folio('OS', 'leads', id, creado) : '');
  const rango = mes => [mes + '-01', mes + '-31'];

  // Todo lo del mes de las SUCURSALES que ve quien pide (en_alcance), sin el filtro «lo suyo» de cada área: el contador
  // necesita la contabilidad completa de su sucursal aunque no opere cobranza ni pagos.
  function datosDelMes(mes, sucursal) {
    const [d, hst] = rango(mes), suc = col => (sucursal ? ` AND ${col} = ${Number(sucursal)}` : '') + ` AND en_alcance(${col})`;
    const facturas = tabla('facturas') ? db.prepare(`SELECT f.*, l.created_at AS lead_created_at FROM main.facturas f LEFT JOIN main.leads l ON l.id = f.lead_id
      WHERE f.entorno = ? AND f.estatus IN ('timbrada', 'cancelacion_solicitada', 'cancelada') AND substr(f.fecha_timbrado, 1, 10) BETWEEN ? AND ?${suc('f.sucursal_id')}
      ORDER BY f.fecha_timbrado, f.id`).all(entorno(), d, hst) : [];
    const cobros = db.prepare(`SELECT k.*, l.created_at AS lead_created_at, l.iva_cent, l.valor, l.factura_folio, COALESCE(c.empresa_contacto, c.nombre) AS cliente, l.sucursal_id
      FROM main.cobros k JOIN main.leads l ON l.id = k.lead_id LEFT JOIN main.clientes c ON c.id = l.cliente_id
      WHERE k.cancelado = 0 AND k.tipo <> 'ajuste' AND k.fecha BETWEEN ? AND ?${suc('l.sucursal_id')} ORDER BY k.fecha, k.id`).all(d, hst);
    // Con lo pagado de cada gasto (como en el Excel CXP: PAGADO, PENDIENTE, STATUS, FECHA y VÍA del último pago) y quién lo capturó.
    const gastos = db.prepare(`SELECT x.*, p.nombre AS proveedor, p.rfc AS proveedor_rfc, u.nombre AS capturo,
        (SELECT COALESCE(SUM(g.monto_cent), 0) FROM main.pagos_proveedor g WHERE g.cxp_id = x.id AND g.cancelado = 0) AS pagado_cent,
        (SELECT g.fecha || '|' || g.metodo FROM main.pagos_proveedor g WHERE g.cxp_id = x.id AND g.cancelado = 0 ORDER BY g.fecha DESC, g.id DESC LIMIT 1) AS ultimo_pago
      FROM main.cuentas_por_pagar x JOIN main.proveedores p ON p.id = x.proveedor_id LEFT JOIN main.usuarios u ON u.id = x.registrado_por
      WHERE x.cancelada = 0 AND COALESCE(x.tipo_comprobante, '') <> 'informativo' AND x.fecha_documento BETWEEN ? AND ?${suc('x.sucursal_id')} ORDER BY x.fecha_documento, x.id`).all(d, hst)
      .map(x => ({ ...x, ...(() => { const i = ivaDeGasto(x); return { iva: i.iva_cent, estimado: i.estimado }; })() }));
    const xmls = new Map(tabla('cfdi_gastos') ? db.prepare('SELECT cxp_id, uuid, archivo FROM main.cfdi_gastos WHERE eliminado = 0').all().map(r => [r.cxp_id, r]) : []);
    const pagos = db.prepare(`SELECT g.*, x.concepto, x.total_cent AS cxp_total, x.iva_cent AS cxp_iva, x.tipo_comprobante, x.factura_folio, x.categoria, p.nombre AS proveedor
      FROM main.pagos_proveedor g JOIN main.cuentas_por_pagar x ON x.id = g.cxp_id JOIN main.proveedores p ON p.id = x.proveedor_id
      WHERE g.cancelado = 0 AND g.fecha BETWEEN ? AND ?${suc('x.sucursal_id')} ORDER BY g.fecha, g.id`).all(d, hst);
    return { facturas, cobros, gastos, xmls, pagos };
  }

  // Anticipos por comprobar (F2): entregados y regresados en el mes, y los que siguen abiertos al cierre del mes.
  function anticiposDelMes(mes, sucursal) {
    if (!tabla('anticipos')) return { entregado: 0, reintegrado: 0, abiertos: [] };
    const [d, hst] = rango(mes), suc = (sucursal ? ` AND a.sucursal_id = ${Number(sucursal)}` : '') + ' AND en_alcance(a.sucursal_id)';
    const comprobado = id => app.locals.anticipos?.comprobadoDe(id) || 0;
    const uno = sql => db.prepare(sql).get(d, hst).n;
    return {
      entregado: uno(`SELECT COALESCE(SUM(a.monto_cent), 0) n FROM main.anticipos a WHERE a.estado <> 'cancelado' AND a.fecha BETWEEN ? AND ?${suc}`),
      reintegrado: uno(`SELECT COALESCE(SUM(a.reintegro_cent), 0) n FROM main.anticipos a WHERE a.estado <> 'cancelado' AND a.reintegro_fecha BETWEEN ? AND ?${suc}`),
      abiertos: db.prepare(`SELECT a.id, a.fecha, a.monto_cent, a.motivo, p.nombre AS persona FROM main.anticipos a JOIN main.personal p ON p.id = a.personal_id
        WHERE a.estado = 'abierto' AND a.fecha <= ?${suc} ORDER BY a.fecha`).all(hst).map(a => ({ ...a, saldo_cent: a.monto_cent - comprobado(a.id) })),
    };
  }

  function resumen(mes, sucursal) {
    const { facturas, cobros, gastos, xmls, pagos } = datosDelMes(mes, sucursal);
    const ant = anticiposDelMes(mes, sucursal);
    const vigentes = facturas.filter(f => f.tipo_documento === 'factura' && f.estatus !== 'cancelada');
    const sum = (a, k) => a.reduce((t, x) => t + Number(x[k] || 0), 0);
    // IVA de lo cobrado / pagado: la parte de IVA de cada pago, en proporción al total de su orden o gasto.
    const totalOrden = k => Math.round(Number(k.valor || 0) * 100) + (k.iva_cent || 0);
    const ivaCobrado = cobros.filter(k => k.confirmado).reduce((t, k) => t + (totalOrden(k) > 0 ? Math.round(k.monto_cent * (k.iva_cent || 0) / totalOrden(k)) : 0), 0);
    const ivaPagado = pagos.reduce((t, g) => { const i = ivaDeGasto({ total_cent: g.cxp_total, iva_cent: g.cxp_iva, tipo_comprobante: g.tipo_comprobante, factura_folio: g.factura_folio, categoria: g.categoria });
      return t + (g.cxp_total > 0 ? Math.round(g.monto_cent * i.iva_cent / g.cxp_total) : 0); }, 0);
    const ivaGastos = sum(gastos, 'iva'), ivaFacturado = sum(vigentes, 'iva_cent');
    const conFactura = gastos.filter(x => x.tipo_comprobante === 'factura' || x.factura_folio);
    return {
      mes, entorno: entorno(),
      ingresos: { facturas: vigentes.length, facturado_subtotal: pesos(sum(vigentes, 'subtotal_cent')), facturado_iva: pesos(ivaFacturado), facturado_total: pesos(sum(vigentes, 'total_cent')),
        canceladas: facturas.filter(f => f.estatus === 'cancelada').length, complementos: facturas.filter(f => f.tipo_documento === 'pago' && f.estatus !== 'cancelada').length,
        cobrado: pesos(sum(cobros.filter(k => k.confirmado), 'monto_cent')), cobrado_iva: pesos(ivaCobrado), por_confirmar: pesos(sum(cobros.filter(k => !k.confirmado), 'monto_cent')) },
      egresos: { gastos: gastos.length, gastos_total: pesos(sum(gastos, 'total_cent')), gastos_iva: pesos(ivaGastos), gastos_iva_estimado: pesos(sum(gastos.filter(x => x.estimado), 'iva')),
        pagado: pesos(sum(pagos, 'monto_cent')), pagado_iva: pesos(ivaPagado),
        anticipos_entregados: pesos(ant.entregado), anticipos_reintegrados: pesos(ant.reintegrado) },
      iva: { segun_facturas: pesos(ivaFacturado - ivaGastos), segun_flujo: pesos(ivaCobrado - ivaPagado) },
      pendientes: {
        gastos_sin_xml: conFactura.filter(x => !xmls.has(x.id)).length,
        gastos_iva_estimado: gastos.filter(x => x.estimado).length,
        cobros_por_confirmar: cobros.filter(k => !k.confirmado).length,
        facturas_canceladas: facturas.filter(f => f.estatus === 'cancelada').length,
        anticipos_abiertos: ant.abiertos.length, anticipos_por_comprobar: pesos(sum(ant.abiertos, 'saldo_cent')),
        anticipos: ant.abiertos.map(a => ({ id: a.id, persona: a.persona, fecha: a.fecha, monto: pesos(a.monto_cent), por_comprobar: pesos(a.saldo_cent), motivo: a.motivo })),
      },
      xml_disponibles: facturas.filter(f => f.xml).length + gastos.filter(x => xmls.has(x.id)).length,
    };
  }
  const leerMes = (req, res) => {
    const mes = String(req.query.mes || '');
    if (!MES.test(mes)) { res.status(400).json({ error: 'Elige el mes (AAAA-MM)' }); return null; }
    return mes;
  };

  // FLUJO DE BANCO (2026-11-11, con el formato de la hoja «BNT» de Dirección): cada peso que entró (cobros CONFIRMADOS)
  // y salió (pagos a proveedores) en el mes, en orden, con su saldo, su factura (PUE / PPD y complemento), lo deducible,
  // lo no deducible y lo que falta por comprobar. Lo que la hoja se capturaba a mano aquí sale solo del CRM.
  // Saldo inicial: lo que el CRM acumuló antes del mes (cobros − pagos), o el que escriba quien consulta (el del banco).
  function flujoDelMes(req, mes, sucursal) {
    const [d, hst] = rango(mes), suc = col => (sucursal ? ` AND ${col} = ${Number(sucursal)}` : '') + ` AND en_alcance(${col})`;
    const veClabe = P.direccion(req) || P.puede(req, 'dinero.mover'); // la CLABE completa solo quien paga (2026-10-22)
    const clabe = c => (!c ? '' : veClabe ? c : '•••' + String(c).slice(-4));
    const folioF = f => (f ? [f.serie, f.folio].filter(Boolean).join('-') + (f.uuid ? ` (${f.uuid})` : '') : '');
    const conFacturas = tabla('facturas'), conComp = tabla('factura_cobros');
    const facturaDe = leadId => (conFacturas ? db.prepare(`SELECT serie, folio, uuid, metodo_pago FROM main.facturas WHERE lead_id = ? AND tipo_documento = 'factura' AND entorno = ?
      AND estatus IN ('timbrada', 'cancelacion_solicitada') ORDER BY id DESC LIMIT 1`).get(leadId, entorno()) : null);
    const complementoDe = cobroId => (conComp ? db.prepare(`SELECT c.serie, c.folio, c.uuid FROM main.factura_cobros fc JOIN main.facturas c ON c.id = fc.complemento_id
      WHERE fc.cobro_id = ? AND c.estatus = 'timbrada' ORDER BY c.id DESC LIMIT 1`).get(cobroId) : null);
    const filas = [];
    for (const k of db.prepare(`SELECT k.*, l.created_at AS lead_created_at, l.factura_folio, l.factura_metodo, l.equipo, l.sucursal_id, l.iva_modo, COALESCE(c.empresa_contacto, c.nombre) AS cliente
      FROM main.cobros k JOIN main.leads l ON l.id = k.lead_id LEFT JOIN main.clientes c ON c.id = l.cliente_id
      WHERE k.cancelado = 0 AND k.confirmado = 1 AND k.tipo <> 'ajuste' AND k.fecha BETWEEN ? AND ?${suc('l.sucursal_id')}`).all(d, hst)) {
      const f = facturaDe(k.lead_id), cp = complementoDe(k.id), metodo = f?.metodo_pago || k.factura_metodo || '';
      const conCfdi = !!(f || k.factura_folio), monto = k.monto_cent;
      filas.push({ orden: k.fecha + '|1|' + k.id, fecha: k.fecha, transferencia: k.referencia || '', oc: folioOS(k.lead_id, k.lead_created_at), comprobante: f ? 'Factura' : k.factura_folio ? 'Factura (folio capturado)' : 'Sin factura',
        concepto_banco: `Cobro ${folioOS(k.lead_id, k.lead_created_at)}${k.tipo === 'anticipo' ? ' (anticipo)' : ''}`, clabe: '', beneficiario: 'SANEADREN', egreso: 0, ingreso: monto,
        metodo: !conCfdi ? 'NO APLICA' : metodo === 'PPD' ? 'PPD/CP' : metodo || 'PUE', cfdi: folioF(f) || k.factura_folio || '', complemento: metodo === 'PPD' ? (folioF(cp) || 'FALTA') : 'NO APLICA',
        tercero: k.cliente || '', concepto: k.tipo === 'anticipo' ? 'ANTICIPO' : 'SERVICIO', observaciones: k.notas || '', cfdi_monto: conCfdi ? monto : 0, no_deducible: 0,
        cuenta_abono: 'CLIENTE', proyecto: app.locals.sucursales?.claveDe?.(k.sucursal_id) || '', unidad: k.equipo || 'NO APLICA', tipo_gasto: 'INGRESO', cuenta_tercero: '', via: k.metodo });
    }
    for (const g of db.prepare(`SELECT g.*, x.id AS cxp_id, x.concepto, x.categoria, x.tipo_comprobante, x.factura_folio, x.metodo_sat, x.beneficiario, x.equipo, x.sucursal_id, x.notas AS cxp_notas,
        p.nombre AS proveedor, p.clabe, p.banco,
        (SELECT o.id || '|' || o.created_at FROM main.ordenes_compra o WHERE o.cxp_id = x.id LIMIT 1) AS oc,
        (SELECT q.uuid FROM main.cfdi_gastos q WHERE q.cxp_id = x.id AND q.eliminado = 0 LIMIT 1) AS uuid
      FROM main.pagos_proveedor g JOIN main.cuentas_por_pagar x ON x.id = g.cxp_id JOIN main.proveedores p ON p.id = x.proveedor_id
      WHERE g.cancelado = 0 AND g.metodo <> 'anticipo' AND g.fecha BETWEEN ? AND ?${suc('x.sucursal_id')}`).all(d, hst)) {
      const esFactura = g.tipo_comprobante === 'factura' || (!g.tipo_comprobante && !!g.factura_folio), monto = g.monto_cent;
      const [ocId, ocCreado] = String(g.oc || '').split('|');
      const reembolso = /^Reembolso a /.test(g.beneficiario || '');
      filas.push({ orden: g.fecha + '|2|' + g.id, fecha: g.fecha, transferencia: g.referencia || '', oc: ocId ? require('./sucursales').folio('OC', 'ordenes_compra', Number(ocId), ocCreado) : '',
        comprobante: esFactura ? (g.uuid ? 'Factura con XML' : 'Factura sin XML') : (COMP[g.tipo_comprobante] || 'Sin comprobante'),
        concepto_banco: `Pago a ${g.beneficiario || g.proveedor}`, clabe: reembolso ? '' : clabe(g.clabe), beneficiario: g.beneficiario || g.proveedor, egreso: monto, ingreso: 0,
        metodo: esFactura ? (g.metodo_sat === 'PPD' ? 'PPD/CP' : 'PUE') : 'NO APLICA', cfdi: esFactura ? [g.factura_folio, g.uuid ? `(${g.uuid})` : ''].filter(Boolean).join(' ') : 'NO APLICA',
        complemento: esFactura && g.metodo_sat === 'PPD' ? 'Pedirlo al proveedor' : 'NO APLICA', tercero: g.proveedor, concepto: g.concepto, observaciones: g.cxp_notas || '',
        cfdi_monto: esFactura ? monto : 0, no_deducible: esFactura ? 0 : monto, cuenta_abono: reembolso ? 'REEMBOLSO' : 'PROVEEDOR', proyecto: app.locals.sucursales?.claveDe?.(g.sucursal_id) || '',
        unidad: g.equipo || 'NO APLICA', tipo_gasto: CATEGORIAS[g.categoria] || g.categoria, cuenta_tercero: [g.banco, clabe(g.clabe)].filter(Boolean).join(' · '), via: g.metodo, cuenta_salida: g.cuenta_origen || '' });
    }
    // Anticipos por comprobar (F2, 2026-11-11): la entrega SALE del banco y lo que regresó (reintegro) ENTRA. Los gastos que
    // se pagaron con el anticipo (vía «anticipo») no son otra salida: arriba se dejan fuera para no contarlos dos veces.
    const conAnt = tabla('anticipos');
    // La CLABE del personal es dato sensible (y va cifrada): aquí no se muestra.
    const comprobacion = conAnt ? db.prepare(`SELECT COALESCE(SUM(CASE WHEN x.tipo_comprobante = 'factura' OR (x.tipo_comprobante IS NULL AND x.factura_folio IS NOT NULL) THEN g.monto_cent END), 0) AS cfdi,
        COALESCE(SUM(CASE WHEN x.tipo_comprobante = 'factura' OR (x.tipo_comprobante IS NULL AND x.factura_folio IS NOT NULL) THEN 0 ELSE g.monto_cent END), 0) AS otro
      FROM main.pagos_proveedor g JOIN main.cuentas_por_pagar x ON x.id = g.cxp_id WHERE x.anticipo_id = ? AND x.cancelada = 0 AND g.cancelado = 0 AND g.metodo = 'anticipo'`) : null;
    if (conAnt) for (const a of db.prepare(`SELECT a.*, p.nombre AS persona, l.created_at AS lead_created_at, l.equipo FROM main.anticipos a JOIN main.personal p ON p.id = a.personal_id
        LEFT JOIN main.leads l ON l.id = a.lead_id WHERE a.estado <> 'cancelado' AND (a.fecha BETWEEN ? AND ? OR (a.reintegro_cent > 0 AND a.reintegro_fecha BETWEEN ? AND ?))${suc('a.sucursal_id')}`).all(d, hst, d, hst)) {
      const comun = { oc: folioOS(a.lead_id, a.lead_created_at), comprobante: 'Anticipo', clabe: '', beneficiario: a.persona, metodo: 'NO APLICA', cfdi: 'NO APLICA', complemento: 'NO APLICA',
        tercero: a.persona, cuenta_abono: 'ANTICIPO', proyecto: app.locals.sucursales?.claveDe?.(a.sucursal_id) || '', unidad: a.equipo || 'NO APLICA',
        tipo_gasto: 'ANTICIPO POR COMPROBAR', cuenta_tercero: '', anticipo: true };
      // Lo comprobado con sus gastos (con factura = deducible; sin factura = no deducible) y lo que falta por comprobar hoy.
      const c = comprobacion.get(a.id), falta = Math.max(0, a.monto_cent - c.cfdi - c.otro - a.reintegro_cent);
      if (a.fecha >= d && a.fecha <= hst) filas.push({ ...comun, orden: a.fecha + '|3|' + a.id, fecha: a.fecha, transferencia: a.referencia || '', concepto_banco: `Anticipo por comprobar a ${a.persona}`,
        egreso: a.monto_cent, ingreso: 0, concepto: a.motivo, cfdi_monto: c.cfdi, no_deducible: c.otro, por_comprobar_cent: falta,
        observaciones: (a.estado === 'cerrado' ? 'Cerrado' : 'Abierto') + (a.reintegro_cent ? ` · regresó ${pesos(a.reintegro_cent).toFixed(2)}` : ''), via: a.metodo, cuenta_salida: a.cuenta_origen || '' });
      if (a.reintegro_cent > 0 && a.reintegro_fecha >= d && a.reintegro_fecha <= hst) filas.push({ ...comun, orden: a.reintegro_fecha + '|4|' + a.id, fecha: a.reintegro_fecha, transferencia: a.reintegro_referencia || '',
        concepto_banco: `Reintegro de anticipo de ${a.persona}`, egreso: 0, ingreso: a.reintegro_cent, cfdi_monto: 0, no_deducible: 0, por_comprobar_cent: 0, concepto: 'Lo que sobró: ' + a.motivo, observaciones: a.nota_cierre || '', via: a.reintegro_metodo, cuenta_salida: a.reintegro_cuenta || '' });
    }
    filas.sort((a, b) => a.orden.localeCompare(b.orden));
    // Saldo inicial (Editar Contabilidad, 2026-11-12): por sucursal, el que se escribió en el sistema (con quién y cuándo)
    // o lo que el CRM acumuló antes del mes (cobros − pagos − anticipos + reintegros). Ver server/contabilidad-cierres.js.
    const si = app.locals.contabilidadCierres.saldoInicial(mes, app.locals.contabilidadCierres.sucursalesDe(req, sucursal) || []), antes = si.saldo_cent;
    let saldo = antes;
    return { saldo_inicial: pesos(antes), saldo_inicial_crm: pesos(si.crm_cent), saldos_iniciales: si.sucursales, filas: filas.map(({ orden, anticipo, por_comprobar_cent, ...f }) => {
      saldo += f.ingreso - f.egreso;
      const porComprobar = por_comprobar_cent ?? f.egreso + f.ingreso - f.cfdi_monto - f.no_deducible;
      return { ...f, egreso: pesos(f.egreso), ingreso: pesos(f.ingreso), saldo: pesos(saldo), cfdi_monto: pesos(f.cfdi_monto), no_deducible: pesos(f.no_deducible), por_comprobar: pesos(porComprobar),
        revisar: [f.complemento === 'FALTA' ? 'Falta el complemento de pago' : '', f.comprobante === 'Factura sin XML' ? 'Falta el XML' : '', porComprobar > 0 && f.egreso ? (anticipo ? 'Se comprueba con los gastos del anticipo' : 'Por comprobar') : ''].filter(Boolean).join(' · ') };
    }) };
  }

  app.get('/api/contabilidad/resumen', h((req, res) => {
    if (!puede(req)) return negar(res);
    const mes = leerMes(req, res); if (!mes) return;
    res.json(resumen(mes, req.query.sucursal ? Number(req.query.sucursal) : null));
  }));

  // Los renglones del Excel del mes (la pantalla arma el archivo).
  app.get('/api/contabilidad/excel', h((req, res) => {
    if (!puede(req)) return negar(res);
    const mes = leerMes(req, res); if (!mes) return;
    const suc = req.query.sucursal ? Number(req.query.sucursal) : null;
    const { facturas, cobros, gastos, xmls, pagos } = datosDelMes(mes, suc);
    const claveSuc = id => app.locals.sucursales?.claveDe?.(id) || '';
    const flujo = flujoDelMes(req, mes, suc);
    res.json({
      flujo: flujo.filas, saldo_inicial: flujo.saldo_inicial, saldo_inicial_crm: flujo.saldo_inicial_crm, saldos_iniciales: flujo.saldos_iniciales,
      cierre: app.locals.contabilidadCierres.estadoCierre(req, mes, app.locals.contabilidadCierres.sucursalesDe(req, suc) || []),
      resumen: resumen(mes, suc),
      facturas: facturas.map(f => ({ tipo: f.tipo_documento === 'pago' ? 'Complemento de pago' : 'Factura', fecha: String(f.fecha_timbrado || '').slice(0, 10), folio: [f.serie, f.folio].filter(Boolean).join('-'), uuid: f.uuid || '',
        orden: folioOS(f.lead_id, f.lead_created_at), rfc: f.receptor_rfc || '', cliente: f.receptor_razon_social || '', metodo: f.metodo_pago || '', forma: f.forma_pago || '',
        subtotal: pesos(f.subtotal_cent), iva: pesos(f.iva_cent), total: pesos(f.total_cent), estatus: f.estatus, cancelada: f.cancelada_at ? String(f.cancelada_at).slice(0, 10) : '', sucursal: claveSuc(f.sucursal_id) })),
      cobros: cobros.map(k => ({ fecha: k.fecha, orden: folioOS(k.lead_id, k.lead_created_at), cliente: k.cliente || '', factura: k.factura_folio || '', monto: pesos(k.monto_cent), metodo: k.metodo, referencia: k.referencia || '',
        estado: k.confirmado ? 'Confirmado' : 'Por confirmar', sucursal: claveSuc(k.sucursal_id) })),
      gastos: gastos.map(x => { const [fechaPago, via] = String(x.ultimo_pago || '|').split('|'), pend = x.total_cent - x.pagado_cent;
        return { vence: x.fecha_vencimiento, fecha: x.fecha_documento, proveedor: x.proveedor, beneficiario: x.beneficiario || x.proveedor, rfc: x.proveedor_rfc || '', concepto: x.concepto, capturo: x.capturo || '',
          folio: x.factura_folio || '', uuid: xmls.get(x.id)?.uuid || '', comprobante: x.tipo_comprobante || '', via: via || '', subtotal: pesos(x.total_cent - x.iva), iva: pesos(x.iva),
          iva_origen: x.estimado ? 'Estimado 16 %' : x.iva_origen === 'xml' ? 'XML' : x.iva_cent != null ? 'Capturado' : '', total: pesos(x.total_cent), pagado: pesos(x.pagado_cent), pendiente: pesos(pend),
          dias_credito: x.dias_credito ?? '', categoria: CATEGORIAS[x.categoria] || x.categoria, status: pend <= 0 ? 'PAGADO' : x.pagado_cent > 0 ? 'PARCIAL' : 'PENDIENTE', fecha_pago: fechaPago || '',
          xml: xmls.has(x.id) ? 'Sí' : (x.tipo_comprobante === 'factura' || x.factura_folio ? 'Falta' : ''), observaciones: x.notas || '', sucursal: claveSuc(x.sucursal_id) }; }),
      pagos: pagos.map(g => ({ fecha: g.fecha, proveedor: g.proveedor, concepto: g.concepto, folio: g.factura_folio || '', monto: pesos(g.monto_cent), metodo: g.metodo, referencia: g.referencia || '', cuenta: g.cuenta_origen || '' })),
    });
  }));

  // Los XML del mes en un .tar: emitidas/ (facturas y complementos timbrados) y gastos/ (los XML subidos a cada gasto).
  app.get('/api/contabilidad/xml', h((req, res) => {
    if (!puede(req)) return negar(res);
    const mes = leerMes(req, res); if (!mes) return;
    const { encabezado, relleno } = require('./respaldo-completo');
    const { facturas, gastos, xmls } = datosDelMes(mes, req.query.sucursal ? Number(req.query.sucursal) : null);
    const partes = [], omitidos = [];
    const agrega = (nombre, buf) => { const e = encabezado(nombre, buf.length, Date.now()); if (!e) return; partes.push(e, buf, relleno(buf.length)); };
    for (const f of facturas) if (f.xml) agrega(`emitidas/${[f.serie, f.folio].filter(Boolean).join('-') || 'factura-' + f.id}_${f.uuid || f.id}.xml`, Buffer.from(f.xml, 'utf8'));
    for (const x of gastos) {
      const r = xmls.get(x.id); if (!r) continue;
      try { agrega(`gastos/${x.fecha_documento}_${String(x.proveedor).replace(/[^\w.-]+/g, '_').slice(0, 40)}_${r.uuid || x.id}.xml`, fs.readFileSync(path.join(dirXmlGastos, r.archivo))); }
      catch { omitidos.push(`${x.proveedor} · ${x.concepto} (no se encontró el archivo)`); }
    }
    const nota = Buffer.from([`XML de ${mes} · Saneadren CRM`, `emitidas/: facturas y complementos timbrados (${facturas.filter(f => f.xml).length})`, `gastos/: XML subidos a cada gasto (${gastos.filter(x => xmls.has(x.id)).length})`,
      ...(omitidos.length ? ['', 'NO SE INCLUYERON:', ...omitidos] : [])].join('\n') + '\n');
    agrega('LEEME.txt', nota);
    partes.push(Buffer.alloc(1024));
    app.locals.auditoria?.registrar(req, 'contabilidad', null, 'descarga XML', `XML de ${mes}`);
    res.set({ 'Content-Type': 'application/x-tar', 'Content-Disposition': `attachment; filename="xml_${mes}.tar"`, 'Cache-Control': 'private, no-store' });
    res.send(Buffer.concat(partes));
  }));
};
