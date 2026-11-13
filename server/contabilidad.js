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
const VIA = { transferencia: 'Transferencia', efectivo: 'Efectivo', deposito: 'Depósito', cheque: 'Cheque', tarjeta: 'Tarjeta', otro: 'Otro', nomina: 'Nómina', layout: 'Layout', pagadora: 'Pagadora', domiciliado: 'Domiciliado', linea_captura: 'Línea de captura', directo: 'Directo' };
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

  // FLUJO DE BANCO (2026-11-11; formato «tal cual» del Excel «flujo banco.xlsx» de Dirección, 2026-11-12): cada peso que
  // entró (cobros CONFIRMADOS, reintegros) y salió (pagos a proveedores, anticipos) en orden, con su saldo, su factura (PUE /
  // PPD y complemento; CN01 la nómina), lo deducible, lo no deducible y lo que falta por comprobar.
  //  · A, B y C son marcas como en la hoja: S (sí está), FALTA o NA (no aplica); DOMICILIADO o LAYOUT en A. K es el número
  //    seguido de cada salida del mes (las entradas llevan «.»).
  //  · Cada renglón va a una cuenta de banco: la del estado de cuenta si ya se concilió; si no, la que se escribió como
  //    «cuenta de salida» (por nombre, terminación o banco); si no se sabe, «Sin cuenta».
  //  · Saldo inicial por cuenta y sucursal: el que se escribió en ese mes o, si no, el último escrito antes más lo que se movió
  //    desde entonces (como la hoja, que arranca del final del mes anterior); sin ninguno escrito, lo que acumuló el CRM.
  const clave = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const cuentasBanco = () => (tabla('cuentas_banco') ? db.prepare(`SELECT id, nombre, banco, terminacion, sucursal_id, activa${db.prepare('PRAGMA table_info(cuentas_banco)').all().some(c => c.name === 'clave_folio') ? ', clave_folio' : ''} FROM main.cuentas_banco ORDER BY id`).all() : []);
  // A qué cuenta de banco va un texto escrito a mano («Santander nómina», «BNT 4521», «Banorte»…), dentro de su sucursal.
  function cuentaDeTexto(texto, suc, cuentas) {
    const t = clave(texto); if (!t) return 0;
    const deSuc = cuentas.filter(c => c.sucursal_id === suc), dig = String(texto).replace(/\D/g, '');
    const porNombre = deSuc.find(c => clave(c.nombre) === t) || deSuc.find(c => clave(c.nombre) && t.includes(clave(c.nombre)));
    if (porNombre) return porNombre.id;
    const porTerm = deSuc.filter(c => c.terminacion && dig.length >= 4 && dig.endsWith(String(c.terminacion).replace(/\D/g, '')));
    if (porTerm.length === 1) return porTerm[0].id;
    const porBanco = deSuc.filter(c => clave(c.banco) && t.split(' ').includes(clave(c.banco)));
    return porBanco.length === 1 ? porBanco[0].id : 0;
  }
  // Los renglones (en centavos) con fecha entre «desde» y «hasta» (null = sin límite) de esas sucursales, ya con su cuenta.
  function filasFlujo(req, desde, hasta, sucursal) {
    const suc = col => (sucursal ? ` AND ${col} = ${Number(sucursal)}` : '') + ` AND en_alcance(${col})`;
    const rangoSql = col => `${desde ? ` AND ${col} >= '${desde}'` : ''}${hasta ? ` AND ${col} <= '${hasta}'` : ''}`;
    const veClabe = P.direccion(req) || P.puede(req, 'dinero.mover'); // la CLABE completa solo quien paga (2026-10-22)
    const clabe = c => (!c ? '' : veClabe ? c : '•••' + String(c).slice(-4));
    const folioF = f => (f ? [f.serie, f.folio].filter(Boolean).join('-') + (f.uuid ? ` (${f.uuid})` : '') : '');
    const conFacturas = tabla('facturas'), conComp = tabla('factura_cobros');
    const facturaDe = leadId => (conFacturas ? db.prepare(`SELECT serie, folio, uuid, metodo_pago FROM main.facturas WHERE lead_id = ? AND tipo_documento = 'factura' AND entorno = ?
      AND estatus IN ('timbrada', 'cancelacion_solicitada') ORDER BY id DESC LIMIT 1`).get(leadId, entorno()) : null);
    const complementoDe = cobroId => (conComp ? db.prepare(`SELECT c.serie, c.folio, c.uuid FROM main.factura_cobros fc JOIN main.facturas c ON c.id = fc.complemento_id
      WHERE fc.cobro_id = ? AND c.estatus = 'timbrada' ORDER BY c.id DESC LIMIT 1`).get(cobroId) : null);
    const cuentas = cuentasBanco();
    const conciliado = new Map(tabla('movimientos_banco') ? db.prepare('SELECT conciliado_tipo, conciliado_id, cuenta_id FROM main.movimientos_banco WHERE conciliado_id IS NOT NULL').all()
      .map(m => [m.conciliado_tipo + ':' + m.conciliado_id, m.cuenta_id]) : []);
    const cuentaDe = (tipo, id, texto, s) => conciliado.get(tipo + ':' + id) || cuentaDeTexto(texto, s, cuentas);
    const enBanco = (tipo, id) => conciliado.has(tipo + ':' + id);
    const proyectoDe = (proyecto, s) => String(proyecto || '').trim() || app.locals.sucursales?.claveDe?.(s) || '';
    const VIA_A = { domiciliado: 'DOMICILIADO', layout: 'LAYOUT' };
    const marcaA = (tipo, id, metodo, referencia) => VIA_A[metodo] || (enBanco(tipo, id) || String(referencia || '').trim() ? 'S' : 'FALTA');
    const datos = (...p) => p.filter(Boolean).join(' · ');
    const filas = [];
    for (const k of db.prepare(`SELECT k.*, l.created_at AS lead_created_at, l.factura_folio, l.factura_metodo, l.equipo, l.proyecto, l.sucursal_id, l.iva_modo, COALESCE(c.empresa_contacto, c.nombre) AS cliente
      FROM main.cobros k JOIN main.leads l ON l.id = k.lead_id LEFT JOIN main.clientes c ON c.id = l.cliente_id
      WHERE k.cancelado = 0 AND k.confirmado = 1 AND k.tipo <> 'ajuste'${rangoSql('k.fecha')}${suc('l.sucursal_id')}`).all()) {
      const f = facturaDe(k.lead_id), cp = complementoDe(k.id), metodo = f?.metodo_pago || k.factura_metodo || '';
      const conCfdi = !!(f || k.factura_folio), monto = k.monto_cent, os = folioOS(k.lead_id, k.lead_created_at);
      filas.push({ orden: k.fecha + '|1|' + k.id, ref: 'cobro:' + k.id, sucursal_id: k.sucursal_id, cuenta_id: cuentaDe('cobro', k.id, '', k.sucursal_id), fecha: k.fecha,
        marca_transf: marcaA('cobro', k.id, k.metodo, k.referencia), marca_oc: 'NA', marca_comp: conCfdi ? 'S' : k.iva_modo && k.iva_modo !== 'sin_iva' ? 'FALTA' : 'NA', // con IVA y sin factura: falta; sin IVA: no aplica
        concepto_banco: `Cobro ${os}${k.tipo === 'anticipo' ? ' (anticipo)' : ''}`, clabe: '', beneficiario: 'SANEADREN', egreso: 0, ingreso: monto,
        metodo: !conCfdi ? 'NO APLICA' : metodo === 'PPD' ? 'PPD/CP' : metodo || 'PUE', cfdi: folioF(f) || k.factura_folio || '', complemento: metodo === 'PPD' ? (folioF(cp) || 'FALTA') : 'NO APLICA',
        tercero: k.cliente || '', concepto: k.tipo === 'anticipo' ? 'ANTICIPO' : 'SERVICIO', observaciones: k.notas || '', cfdi_monto: conCfdi ? monto : 0, no_deducible: 0,
        cuenta_abono: 'CLIENTE', proyecto: proyectoDe(k.proyecto, k.sucursal_id), unidad: k.equipo || 'NO APLICA', tipo_gasto: 'INGRESO', cuenta_tercero: '', via: k.metodo, cuenta_salida: '',
        datos_sistema: datos(VIA[k.metodo] || k.metodo, k.referencia ? 'ref. ' + k.referencia : '', os) });
    }
    for (const g of db.prepare(`SELECT g.*, x.id AS cxp_id, x.concepto, x.categoria, x.tipo_comprobante, x.factura_folio, x.metodo_sat, x.beneficiario, x.equipo, x.sucursal_id, x.notas AS cxp_notas,
        p.nombre AS proveedor, p.clabe, p.banco, l.proyecto,
        (SELECT o.id || '|' || o.created_at FROM main.ordenes_compra o WHERE o.cxp_id = x.id LIMIT 1) AS oc,
        (SELECT q.uuid FROM main.cfdi_gastos q WHERE q.cxp_id = x.id AND q.eliminado = 0 LIMIT 1) AS uuid
      FROM main.pagos_proveedor g JOIN main.cuentas_por_pagar x ON x.id = g.cxp_id JOIN main.proveedores p ON p.id = x.proveedor_id LEFT JOIN main.leads l ON l.id = x.lead_id
      WHERE g.cancelado = 0 AND g.metodo <> 'anticipo'${rangoSql('g.fecha')}${suc('x.sucursal_id')}`).all()) {
      const nomina = g.categoria === 'sueldos' || g.tipo_comprobante === 'nomina';
      const esFactura = !nomina && (g.tipo_comprobante === 'factura' || (!g.tipo_comprobante && !!g.factura_folio)), monto = g.monto_cent;
      const [ocId, ocCreado] = String(g.oc || '').split('|'), oc = ocId ? require('./sucursales').folio('OC', 'ordenes_compra', Number(ocId), ocCreado) : '';
      const reembolso = /^Reembolso a /.test(g.beneficiario || '');
      const comprobante = esFactura ? (g.uuid ? 'Factura con XML' : 'Factura sin XML') : (COMP[g.tipo_comprobante] || 'Sin comprobante');
      filas.push({ orden: g.fecha + '|2|' + g.id, ref: 'pago:' + g.id, sucursal_id: g.sucursal_id, cuenta_id: cuentaDe('pago', g.id, g.cuenta_origen, g.sucursal_id), fecha: g.fecha,
        marca_transf: marcaA('pago', g.id, g.metodo, g.referencia), marca_oc: oc ? 'S' : nomina || g.metodo === 'domiciliado' || !esFactura && g.tipo_comprobante && g.tipo_comprobante !== 'sin_factura' ? 'NA' : 'FALTA',
        marca_comp: nomina ? 'S' : esFactura ? (g.uuid ? 'S' : 'FALTA') : g.tipo_comprobante === 'sin_factura' ? 'NA' : g.tipo_comprobante ? 'S' : 'FALTA',
        concepto_banco: `Pago a ${g.beneficiario || g.proveedor}`, clabe: reembolso ? '' : clabe(g.clabe), beneficiario: g.beneficiario || g.proveedor, egreso: monto, ingreso: 0,
        metodo: nomina ? 'CN01' : esFactura ? (g.metodo_sat === 'PPD' ? 'PPD/CP' : 'PUE') : 'NO APLICA', cfdi: nomina ? 'ANEXO NOMINA CFDI' : esFactura ? [g.factura_folio, g.uuid ? `(${g.uuid})` : ''].filter(Boolean).join(' ') : 'NO APLICA',
        complemento: esFactura && g.metodo_sat === 'PPD' ? 'Pedirlo al proveedor' : 'NO APLICA', tercero: g.proveedor, concepto: g.concepto, observaciones: g.cxp_notas || '',
        cfdi_monto: esFactura ? monto : 0, no_deducible: esFactura || nomina ? 0 : monto, cuenta_abono: nomina ? 'NOMINA' : reembolso ? 'REEMBOLSO' : 'PROVEEDOR', proyecto: proyectoDe(g.proyecto, g.sucursal_id),
        unidad: g.equipo || 'NO APLICA', tipo_gasto: CATEGORIAS[g.categoria] || g.categoria, cuenta_tercero: [g.banco, clabe(g.clabe)].filter(Boolean).join(' · '), via: g.metodo, cuenta_salida: g.cuenta_origen || '',
        comprobante, datos_sistema: datos(VIA[g.metodo] || g.metodo, g.referencia ? 'ref. ' + g.referencia : '', oc, comprobante) });
    }
    // Anticipos por comprobar (F2, 2026-11-11): la entrega SALE del banco y lo que regresó (reintegro) ENTRA. Los gastos que
    // se pagaron con el anticipo (vía «anticipo») no son otra salida: arriba se dejan fuera para no contarlos dos veces.
    const conAnt = tabla('anticipos');
    // La CLABE del personal es dato sensible (y va cifrada): aquí no se muestra.
    const comprobacion = conAnt ? db.prepare(`SELECT COALESCE(SUM(CASE WHEN x.tipo_comprobante = 'factura' OR (x.tipo_comprobante IS NULL AND x.factura_folio IS NOT NULL) THEN g.monto_cent END), 0) AS cfdi,
        COALESCE(SUM(CASE WHEN x.tipo_comprobante = 'factura' OR (x.tipo_comprobante IS NULL AND x.factura_folio IS NOT NULL) THEN 0 ELSE g.monto_cent END), 0) AS otro
      FROM main.pagos_proveedor g JOIN main.cuentas_por_pagar x ON x.id = g.cxp_id WHERE x.anticipo_id = ? AND x.cancelada = 0 AND g.cancelado = 0 AND g.metodo = 'anticipo'`) : null;
    const enRango = f => !!f && (!desde || f >= desde) && (!hasta || f <= hasta);
    if (conAnt) for (const a of db.prepare(`SELECT a.*, p.nombre AS persona, l.created_at AS lead_created_at, l.equipo, l.proyecto FROM main.anticipos a JOIN main.personal p ON p.id = a.personal_id
        LEFT JOIN main.leads l ON l.id = a.lead_id WHERE a.estado <> 'cancelado'${suc('a.sucursal_id')}`).all()) {
      const os = folioOS(a.lead_id, a.lead_created_at);
      const comun = { sucursal_id: a.sucursal_id, oc: os, clabe: '', beneficiario: a.persona, metodo: 'NO APLICA', cfdi: 'NO APLICA', complemento: 'NO APLICA', marca_oc: 'NA',
        tercero: a.persona, cuenta_abono: 'ANTICIPO', proyecto: proyectoDe(a.proyecto, a.sucursal_id), unidad: a.equipo || 'NO APLICA',
        tipo_gasto: 'ANTICIPO POR COMPROBAR', cuenta_tercero: '', anticipo: true };
      // Lo comprobado con sus gastos (con factura = deducible; sin factura = no deducible) y lo que falta por comprobar hoy.
      const c = comprobacion.get(a.id), falta = Math.max(0, a.monto_cent - c.cfdi - c.otro - a.reintegro_cent);
      if (enRango(a.fecha)) filas.push({ ...comun, orden: a.fecha + '|3|' + a.id, ref: 'anticipo:' + a.id, cuenta_id: cuentaDe('anticipo', a.id, a.cuenta_origen, a.sucursal_id), fecha: a.fecha,
        marca_transf: marcaA('anticipo', a.id, a.metodo, a.referencia), marca_comp: falta > 0 ? 'FALTA' : 'S', concepto_banco: `Anticipo por comprobar a ${a.persona}`,
        egreso: a.monto_cent, ingreso: 0, concepto: a.motivo, cfdi_monto: c.cfdi, no_deducible: c.otro, por_comprobar_cent: falta,
        observaciones: (a.estado === 'cerrado' ? 'Cerrado' : 'Abierto') + (a.reintegro_cent ? ` · regresó ${pesos(a.reintegro_cent).toFixed(2)}` : ''), via: a.metodo, cuenta_salida: a.cuenta_origen || '',
        datos_sistema: datos(VIA[a.metodo] || a.metodo, a.referencia ? 'ref. ' + a.referencia : '', os) });
      if (a.reintegro_cent > 0 && enRango(a.reintegro_fecha)) filas.push({ ...comun, orden: a.reintegro_fecha + '|4|' + a.id, ref: 'reintegro:' + a.id, cuenta_id: cuentaDe('reintegro', a.id, a.reintegro_cuenta, a.sucursal_id),
        fecha: a.reintegro_fecha, marca_transf: marcaA('reintegro', a.id, a.reintegro_metodo, a.reintegro_referencia), marca_comp: 'S',
        concepto_banco: `Reintegro de anticipo de ${a.persona}`, egreso: 0, ingreso: a.reintegro_cent, cfdi_monto: 0, no_deducible: 0, por_comprobar_cent: 0, concepto: 'Lo que sobró: ' + a.motivo, observaciones: a.nota_cierre || '',
        via: a.reintegro_metodo, cuenta_salida: a.reintegro_cuenta || '', datos_sistema: datos(VIA[a.reintegro_metodo] || a.reintegro_metodo, a.reintegro_referencia ? 'ref. ' + a.reintegro_referencia : '', os) });
    }
    // Movimientos propios (parte 4): lo que no pasó por el sistema (traspasos, préstamos, comisiones…), agregado a mano.
    if (tabla('flujo_movimientos')) for (const m of db.prepare(`SELECT * FROM main.flujo_movimientos m WHERE m.cancelado = 0${rangoSql('m.fecha')}${suc('m.sucursal_id')}`).all()) {
      const monto = m.monto_cent, cat = (CATEG_MOV[m.categoria] || m.categoria).toUpperCase();
      filas.push({ orden: m.fecha + '|5|' + m.id, ref: 'manual:' + m.id, manual: true, sucursal_id: m.sucursal_id, cuenta_id: m.cuenta_id, fecha: m.fecha,
        marca_transf: String(m.referencia || '').trim() ? 'S' : 'FALTA', marca_oc: 'NA', marca_comp: 'NA', concepto_banco: m.concepto, clabe: '', beneficiario: '',
        egreso: m.tipo === 'egreso' ? monto : 0, ingreso: m.tipo === 'ingreso' ? monto : 0, metodo: 'NO APLICA', cfdi: 'NO APLICA', complemento: 'NO APLICA', tercero: '', concepto: cat,
        observaciones: m.observaciones || '', cfdi_monto: 0, no_deducible: 0, cuenta_abono: '', proyecto: proyectoDe('', m.sucursal_id), unidad: 'NO APLICA', tipo_gasto: cat, cuenta_tercero: '',
        via: '', cuenta_salida: '', por_comprobar_cent: SIN_COMPROBAR.has(m.categoria) ? 0 : undefined,
        datos_sistema: datos(`Agregado a mano por ${m.creado_por_nombre} el ${String(m.created_at).slice(0, 10).split('-').reverse().join('/')}`, m.referencia ? 'ref. ' + m.referencia : '') });
    }
    filas.sort((a, b) => a.orden.localeCompare(b.orden));
    // Desglose (parte 4): renglones debajo de su pago, sin importe propio (el saldo se mueve una vez). Los gastos que se
    // comprobaron con un anticipo salen solos debajo de la entrega; los demás los agrega quien edita («Desglosar»).
    const padres = new Map(filas.map(f => [f.ref, f])), hijos = new Map();
    const agrega = (padre, h) => { if (!hijos.has(padre.ref)) hijos.set(padre.ref, []); hijos.get(padre.ref).push(h); };
    const base = padre => ({ padre: padre.ref, es_desglose: true, sucursal_id: padre.sucursal_id, fecha: padre.fecha, marca_transf: '', marca_oc: '', marca_comp: '', concepto_banco: padre.concepto_banco,
      clabe: '', beneficiario: '', egreso: 0, ingreso: 0, complemento: 'NO APLICA', cuenta_tercero: '', via: '', cuenta_salida: '', observaciones_z: '' });
    if (conAnt) {
      const gastosAnt = db.prepare(`SELECT g.id, g.monto_cent, x.concepto, x.categoria, x.tipo_comprobante, x.factura_folio, x.equipo, p.nombre AS proveedor, l.proyecto,
          (SELECT q.uuid FROM main.cfdi_gastos q WHERE q.cxp_id = x.id AND q.eliminado = 0 LIMIT 1) AS uuid
        FROM main.pagos_proveedor g JOIN main.cuentas_por_pagar x ON x.id = g.cxp_id JOIN main.proveedores p ON p.id = x.proveedor_id LEFT JOIN main.leads l ON l.id = x.lead_id
        WHERE x.anticipo_id = ? AND x.cancelada = 0 AND g.cancelado = 0 AND g.metodo = 'anticipo' ORDER BY g.fecha, g.id`);
      for (const padre of filas) if (padre.ref.startsWith('anticipo:')) for (const g of gastosAnt.all(Number(padre.ref.split(':')[1]))) {
        const fac = g.tipo_comprobante === 'factura' || (!g.tipo_comprobante && !!g.factura_folio);
        agrega(padre, { ...base(padre), ref: 'gastoant:' + g.id, auto: true, metodo: fac ? 'PUE' : 'NO APLICA', cfdi: fac ? [g.factura_folio, g.uuid ? `(${g.uuid})` : ''].filter(Boolean).join(' ') : 'NO APLICA',
          tercero: g.proveedor, concepto: g.concepto, observaciones: '', cfdi_monto: fac ? g.monto_cent : 0, no_deducible: fac ? 0 : g.monto_cent, cuenta_abono: padre.tercero,
          proyecto: proyectoDe(g.proyecto, padre.sucursal_id), unidad: g.equipo || 'NO APLICA', tipo_gasto: CATEGORIAS[g.categoria] || g.categoria, datos_sistema: 'Gasto comprobado con el anticipo (Cuentas por pagar)' });
      }
    }
    if (tabla('flujo_desglose')) for (const r of db.prepare('SELECT * FROM main.flujo_desglose WHERE anulado = 0 ORDER BY id').all()) {
      const padre = padres.get(r.ref_padre); if (!padre) continue;
      agrega(padre, { ...base(padre), ref: 'desglose:' + r.id, metodo: r.metodo || '', cfdi: r.cfdi || '', tercero: r.tercero || '', concepto: r.concepto || '', observaciones: r.observaciones || '',
        cfdi_monto: r.cfdi_monto_cent, no_deducible: r.no_deducible_cent, cuenta_abono: r.cuenta_abono || '', proyecto: r.proyecto || '', unidad: r.unidad || '', tipo_gasto: r.tipo_gasto || '',
        datos_sistema: `Desglose agregado por ${r.usuario}` + (r.actualizado_por ? ` · cambió ${r.actualizado_por}` : '') });
    }
    const todas = filas.flatMap(f => [f, ...(hijos.get(f.ref) || [])]);
    aplicarCorrecciones(todas);
    // Folios (parte 5): el folio vigente de cada movimiento y su cuenta (el folio manda: nació con esa cuenta).
    const folios = new Map(tabla('folios_banco') ? db.prepare("SELECT ref, folio, cuenta_id FROM main.folios_banco WHERE estado = 'vigente'").all().map(r => [r.ref, r]) : []);
    for (const f of filas) { const fo = folios.get(f.ref); if (fo) { f.folio = fo.folio; f.cuenta_id = fo.cuenta_id; } }
    // El renglón de arriba: su monto CFDI y no deducible son la suma de los de abajo, y su concepto dice si ya cuadra
    // (DESGLOSADO) o falta (X DESGLOSAR), salvo que alguien lo haya corregido. Los de abajo van en su misma cuenta.
    for (const f of filas) {
      const hs = hijos.get(f.ref); if (!hs?.length) continue;
      for (const h of hs) { h.cuenta_id = f.cuenta_id; h.folio = f.folio; }
      if (f.anticipo) continue; // la entrega de un anticipo ya suma lo comprobado
      f.cfdi_monto = hs.reduce((t, h) => t + Number(h.cfdi_monto || 0), 0); f.no_deducible = hs.reduce((t, h) => t + Number(h.no_deducible || 0), 0);
      if (!f.corregido?.concepto) f.concepto = f.cfdi_monto + f.no_deducible === f.egreso + f.ingreso ? 'DESGLOSADO' : 'X DESGLOSAR';
      f.desglosado = true;
    }
    // Folios que ya no tienen movimiento vigente (se canceló) o cambiaron de cuenta: se quedan en su lugar, en gris y sin
    // importe, para que la serie no tenga huecos escondidos.
    if (tabla('folios_banco')) {
      const activos = new Set(filas.map(f => f.ref)), cuentas = new Map(cuentasBanco().map(c => [c.id, c]));
      const sucOk = s => (sucursal ? s === Number(sucursal) : true) && db.prepare('SELECT en_alcance(?) v').get(s).v;
      for (const fo of db.prepare(`SELECT f.*, u.nombre AS usuario FROM main.folios_banco f LEFT JOIN main.usuarios u ON u.id = f.cambio_usuario_id
          WHERE 1 = 1${rangoSql('f.fecha_mov')}`).all()) {
        if (fo.estado === 'vigente' && activos.has(fo.ref)) continue;
        const c = cuentas.get(fo.cuenta_id); if (!c || !sucOk(c.sucursal_id)) continue;
        const leyenda = fo.estado === 'vigente' ? 'CANCELADO' : fo.estado === 'reasignado' ? 'CAMBIÓ A ' + fo.reasignado_a : 'SE QUITÓ LA CUENTA';
        todas.push({ orden: fo.fecha_mov + '|9|' + fo.id, ref: 'folio:' + fo.id, fantasma: true, folio: fo.folio, sucursal_id: c.sucursal_id, cuenta_id: fo.cuenta_id, fecha: fo.fecha_mov,
          marca_transf: '', marca_oc: '', marca_comp: '', concepto_banco: fo.concepto || '', clabe: '', beneficiario: '', egreso: 0, ingreso: 0, metodo: '', cfdi: '', complemento: '', tercero: '',
          concepto: leyenda, observaciones: `Folio ${fo.folio} por ${pesos(fo.monto_cent || 0).toFixed(2)}` + (fo.usuario ? ` · cambió ${fo.usuario}` : ''), cfdi_monto: 0, no_deducible: 0,
          cuenta_abono: '', proyecto: '', unidad: '', tipo_gasto: '', cuenta_tercero: '', via: '', cuenta_salida: '', por_comprobar_cent: 0, datos_sistema: leyenda });
      }
      // Cada fantasma en su lugar por fecha (los movimientos y su desglose no se separan).
      const grupos = []; for (const f of todas) { if (f.es_desglose) grupos[grupos.length - 1].push(f); else grupos.push([f]); }
      grupos.sort((a, b) => a[0].fecha.localeCompare(b[0].fecha) || 0);
      return grupos.flat();
    }
    return todas;
  }
  // Movimientos propios: categorías; los que no son gasto no quedan «por comprobar».
  const CATEG_MOV = { traspaso: 'Traspaso entre cuentas', prestamo: 'Préstamo', aportacion: 'Aportación de socios', retiro: 'Retiro', devolucion: 'Devolución', comision: 'Comisión bancaria', interes: 'Intereses', otro: 'Otro' };
  const SIN_COMPROBAR = new Set(['traspaso', 'prestamo', 'aportacion', 'retiro', 'devolucion']);
  // ---------- Correcciones a mano (Editar Contabilidad parte 3, 2026-11-12) ----------
  // Lo que alguien corrigió en la tabla se guarda ENCIMA del dato del sistema (tabla flujo_correcciones, que no se cambia
  // ni se borra): vale el último cambio de cada renglón y columna; null = volver al dato del sistema. El renglón lleva
  // «corregido» con lo que decía el sistema, quién y cuándo.
  const DINERO = new Set(['cfdi_monto', 'no_deducible']);
  const EDITABLES = { marca_transf: 'marca_a', marca_oc: 'marca', marca_comp: 'marca', concepto_banco: 'texto', beneficiario: 'texto', metodo: 'texto', cfdi: 'texto', complemento: 'texto',
    tercero: 'texto', concepto: 'texto', observaciones: 'texto', cfdi_monto: 'dinero', no_deducible: 'dinero', cuenta_abono: 'texto', proyecto: 'texto', unidad: 'texto', tipo_gasto: 'texto',
    observaciones_z: 'texto', cuenta_id: 'cuenta' };
  const ETIQ = { marca_transf: 'Transferencia (A)', marca_oc: 'O.C. o req (B)', marca_comp: 'Comprobante (C)', concepto_banco: 'Concepto (E)', beneficiario: 'Nombre beneficiario (G)', metodo: 'Método de pago (L)',
    cfdi: 'Comprobante fiscal (M)', complemento: 'Complemento de pago (N)', tercero: 'Proveedor/cliente (O)', concepto: 'Concepto (P)', observaciones: 'Observaciones (Q)', cfdi_monto: 'Monto real CFDI (R)',
    no_deducible: 'No deducibles (S)', cuenta_abono: 'Cuenta abono (U)', proyecto: 'Proyecto (V)', unidad: 'Unidad (W)', tipo_gasto: 'Tipo de gasto (X)', observaciones_z: 'Observaciones (Z)', cuenta_id: 'Cuenta de banco' };
  const MARCAS = ['S', 'FALTA', 'NA'], MARCAS_A = [...MARCAS, 'DOMICILIADO', 'LAYOUT'];
  // Lo que se escribe en un renglón del desglose (columna en pantalla → columna de flujo_desglose).
  const CAMPOS_DESGLOSE = { metodo: 'metodo', cfdi: 'cfdi', tercero: 'tercero', concepto: 'concepto', observaciones: 'observaciones', cfdi_monto: 'cfdi_monto_cent', no_deducible: 'no_deducible_cent',
    cuenta_abono: 'cuenta_abono', proyecto: 'proyecto', unidad: 'unidad', tipo_gasto: 'tipo_gasto' };
  // Revisa y limpia un valor escrito según su tipo; { error } si no sirve.
  function limpiarValor(campo, tipo, valor, f) {
    const t = String(valor ?? '').trim().replace(/\s+/g, ' ');
    if (tipo === 'texto') return t.length > 300 ? { error: `${ETIQ[campo]}: máximo 300 letras` } : { valor: t };
    if (tipo === 'marca' || tipo === 'marca_a') { const v = t.toUpperCase(), ok = tipo === 'marca_a' ? MARCAS_A : MARCAS; return ok.includes(v) ? { valor: v } : { error: `${ETIQ[campo]}: elige ${ok.join(', ')}` }; }
    if (tipo === 'dinero') { const x = t.replace(/[$,]/g, ''); return /^\d{1,12}(\.\d{1,2})?$/.test(x) ? { valor: String(Math.round(Number(x) * 100)) } : { error: `${ETIQ[campo]}: escribe el monto en pesos (sin negativos, máximo 2 decimales)` }; }
    if (tipo === 'cuenta') { const n = Number(t); return Number.isInteger(n) && app.locals.flujoBanco.cuentasDe([f.sucursal_id]).some(x => x.id === n) ? { valor: String(n) } : { error: 'Esa cuenta de banco no es de la sucursal del movimiento' }; }
    return { error: 'Valor inválido' };
  }
  const valorDe = (campo, v) => (DINERO.has(campo) || campo === 'cuenta_id' ? Number(v) : v);
  function aplicarCorrecciones(filas) {
    if (!tabla('flujo_correcciones') || !filas.length) return;
    const vig = new Map();
    for (const c of db.prepare('SELECT c.* FROM main.flujo_correcciones c WHERE c.id IN (SELECT MAX(id) FROM main.flujo_correcciones GROUP BY ref, campo)').all()) {
      if (!vig.has(c.ref)) vig.set(c.ref, []); vig.get(c.ref).push(c);
    }
    for (const f of filas) for (const c of vig.get(f.ref) || []) {
      if (c.valor == null || !(c.campo in EDITABLES)) continue;
      (f.corregido ||= {})[c.campo] = { sistema: f[c.campo] ?? '', usuario: c.usuario, fecha: c.fecha };
      f[c.campo] = valorDe(c.campo, c.valor);
    }
  }
  // Para la bitácora: el valor como se lee.
  const legible = (campo, v, cuentas) => (v === null || v === undefined || v === '' ? '(vacío)' : DINERO.has(campo) ? '$' + pesos(v).toFixed(2) : campo === 'cuenta_id' ? (Number(v) ? cuentas.find(c => c.id === Number(v))?.nombre || 'Cuenta ' + v : 'Sin cuenta') : String(v));
  // Cuentas que se muestran en el selector: las de las sucursales elegidas y «Sin cuenta» (0).
  function cuentasDe(sucursales) {
    const ids = new Set(sucursales);
    return [...cuentasBanco().filter(c => ids.has(c.sucursal_id)).map(c => ({ id: c.id, nombre: c.nombre, banco: c.banco, terminacion: c.terminacion || '', clave_folio: c.clave_folio || '', sucursal_id: c.sucursal_id, activa: !!c.activa })),
      { id: 0, nombre: 'Sin cuenta', banco: '', terminacion: '', clave_folio: '', sucursal_id: null, activa: true }];
  }
  // Saldo inicial del mes por cada sucursal y cuenta (cuenta = null: todas). Encadenado: el último escrito (de ese mes o de
  // antes) más lo que se movió desde ese mes; sin ninguno escrito, todo lo que acumuló el CRM antes del mes.
  function saldoInicial(req, mes, sucursales, cuenta) {
    const d = mes + '-01', antes = filasFlujo(req, null, null, null).filter(f => f.fecha < d);
    const CC = app.locals.contabilidadCierres;
    const pares = [];
    for (const s of sucursales) {
      const ids = cuenta == null ? [...new Set([0, ...cuentasBanco().filter(c => c.sucursal_id === s).map(c => c.id), ...antes.filter(f => f.sucursal_id === s).map(f => f.cuenta_id), ...CC.cuentasEscritas(s)])] : [Number(cuenta)];
      for (const c of ids) {
        const esc = CC.escrito(s, c, mes), net = desde => antes.filter(f => f.sucursal_id === s && f.cuenta_id === c && (!desde || f.fecha >= desde)).reduce((t, f) => t + f.ingreso - f.egreso, 0);
        const crm = esc.anterior ? esc.anterior.saldo_cent + net(esc.anterior.mes + '-01') : net(null);
        pares.push({ sucursal_id: s, cuenta_id: c, crm_cent: crm, usado_cent: esc.este ? esc.este.saldo_cent : crm, escrito: !!esc.este, historial: esc.historial,
          desde_mes: esc.anterior?.mes || null });
      }
    }
    const suma = k => pares.reduce((t, p) => t + p[k], 0);
    const cuentaNombre = id => (id ? cuentasBanco().find(c => c.id === id)?.nombre || 'Cuenta ' + id : 'Sin cuenta');
    return { saldo_cent: suma('usado_cent'), crm_cent: suma('crm_cent'),
      sucursales: pares.map(p => { const s = app.locals.sucursales?.lista?.().find(x => x.id === p.sucursal_id) || {};
        return { sucursal_id: p.sucursal_id, clave: s.clave || '', nombre: s.nombre || '', cuenta_id: p.cuenta_id, cuenta: cuentaNombre(p.cuenta_id), crm: pesos(p.crm_cent), saldo: pesos(p.usado_cent),
          escrito: p.escrito, viene_de: p.desde_mes, historial: p.historial.map(r => ({ saldo: r.saldo_cent == null ? null : pesos(r.saldo_cent), usuario: r.usuario, fecha: r.fecha })) }; }) };
  }
  // El flujo del mes de esas sucursales y una cuenta (null = todas; 0 = sin cuenta), con saldo corrido y el número seguido.
  function flujoDelMes(req, mes, sucursal, cuenta) {
    const [d, hst] = rango(mes), sucs = app.locals.contabilidadCierres.sucursalesDe(req, sucursal) || [];
    const cuentaN = cuenta === undefined || cuenta === null || cuenta === '' ? null : Number(cuenta);
    const todas = filasFlujo(req, d, hst, sucursal), filas = cuentaN == null ? todas : todas.filter(f => f.cuenta_id === cuentaN);
    const si = saldoInicial(req, mes, sucs, cuentaN), cuentas = cuentasDe(sucs);
    const nombreCuenta = id => cuentas.find(c => c.id === id)?.nombre || 'Sin cuenta';
    let saldo = si.saldo_cent, n = 0; const kDe = new Map();
    return { saldo_inicial: pesos(si.saldo_cent), saldo_inicial_crm: pesos(si.crm_cent), saldos_iniciales: si.sucursales, cuenta: cuentaN,
      cuentas: cuentas.map(c => ({ ...c, movimientos: todas.filter(f => f.cuenta_id === c.id && !f.es_desglose && !f.fantasma).length })),
      sin_folio: todas.filter(f => !f.es_desglose && !f.fantasma && !f.folio).length,
      puede_editar: puede(req), es_direccion: P.direccion(req), editables: Object.keys(EDITABLES), editables_desglose: Object.keys(CAMPOS_DESGLOSE), categorias_mov: CATEG_MOV,
      filas: filas.map(({ orden, anticipo, por_comprobar_cent, sucursal_id, ...f }) => {
        saldo += f.ingreso - f.egreso;
        // Un renglón de un mes cerrado lo corrige solo Dirección.
        f.editable = !f.auto && puede(req) && (P.direccion(req) || !app.locals.contabilidadCierres.cerrado(f.fecha.slice(0, 7), sucursal_id));
        // Un renglón del desglose: lleva el número (K) de su pago, sin saldo ni X comprobar propios.
        if (f.es_desglose) return { ...f, consecutivo: f.folio || kDe.get(f.padre) || '—', cuenta: '', saldo: null, egreso: 0, ingreso: 0, cfdi_monto: pesos(f.cfdi_monto), no_deducible: pesos(f.no_deducible), por_comprobar: null, revisar: '' };
        // Un folio cancelado o reasignado: en gris, sin importe, sin saldo y sin editar.
        if (f.fantasma) return { ...f, editable: false, consecutivo: f.folio, cuenta: nombreCuenta(f.cuenta_id), saldo: null, egreso: 0, ingreso: 0, cfdi_monto: 0, no_deducible: 0, por_comprobar: null, revisar: '' };
        const porComprobar = por_comprobar_cent ?? f.egreso + f.ingreso - f.cfdi_monto - f.no_deducible;
        // Lo que decía el sistema en una columna de dinero corregida, en pesos como el resto del renglón.
        if (f.corregido) for (const c of Object.keys(f.corregido)) if (DINERO.has(c)) f.corregido[c] = { ...f.corregido[c], sistema: pesos(f.corregido[c].sistema) };
        const k = f.folio || '—'; kDe.set(f.ref, k); n++;
        return { ...f, consecutivo: k, cuenta: f.cuenta_id ? nombreCuenta(f.cuenta_id) : f.cuenta_salida ? f.cuenta_salida + ' (sin ligar)' : 'Sin cuenta',
          egreso: pesos(f.egreso), ingreso: pesos(f.ingreso), saldo: pesos(saldo), cfdi_monto: pesos(f.cfdi_monto), no_deducible: pesos(f.no_deducible), por_comprobar: pesos(porComprobar),
          revisar: [!f.folio ? (f.cuenta_id ? 'Sin folio: la cuenta no tiene clave' : 'Sin folio: falta la cuenta') : '', f.complemento === 'FALTA' ? 'Falta el complemento de pago' : '', f.comprobante === 'Factura sin XML' ? 'Falta el XML' : '', porComprobar > 0 && f.egreso ? (anticipo ? 'Se comprueba con los gastos del anticipo' : f.desglosado ? 'Falta desglosar' : 'Por comprobar') : ''].filter(Boolean).join(' · ') };
      }) };
  }
  app.locals.flujoBanco = { saldoInicial, cuentasDe, cuentaDeTexto: (texto, suc) => cuentaDeTexto(texto, suc, cuentasBanco()) };

  app.get('/api/contabilidad/resumen', h((req, res) => {
    if (!puede(req)) return negar(res);
    const mes = leerMes(req, res); if (!mes) return;
    res.json(resumen(mes, req.query.sucursal ? Number(req.query.sucursal) : null));
  }));

  // Guardar cambios de la tabla (botón «Guardar cambios»): todos juntos o ninguno. Cada cambio: { ref, campo, valor };
  // valor null = volver al dato del sistema. Quién: Dirección, el Gerente y quien tenga «Contabilidad del mes»; un mes
  // cerrado, solo Dirección (y la base lo vuelve a revisar).
  app.post('/api/contabilidad/flujo/correcciones', h((req, res) => {
    if (!puede(req)) return res.status(403).json({ error: 'Corrigen el flujo de banco Dirección, el Gerente y quien tenga «Contabilidad del mes»' });
    const b = req.body || {}, mes = String(b.mes || '');
    if (!MES.test(mes)) return res.status(400).json({ error: 'Elige el mes (AAAA-MM)' });
    const cambios = Array.isArray(b.cambios) ? b.cambios : null;
    if (!cambios || !cambios.length) return res.status(400).json({ error: 'No hay cambios que guardar' });
    if (cambios.length > 500) return res.status(400).json({ error: 'Son demasiados cambios a la vez (máximo 500): guarda por partes' });
    const [d, hst] = rango(mes), filas = new Map(filasFlujo(req, d, hst, null).map(f => [f.ref, f]));
    const listos = [], desglose = [];
    for (const c of cambios) {
      const f = filas.get(String(c?.ref || '')), campo = String(c?.campo || '');
      if (!f) return res.status(404).json({ error: 'Un renglón ya no existe en el flujo de este mes (¿se canceló?). Recarga la pantalla.' });
      if (app.locals.contabilidadCierres.cerrado(f.fecha.slice(0, 7), f.sucursal_id) && !P.direccion(req)) return res.status(409).json({ error: 'Ese mes ya está cerrado en Contabilidad: solo Dirección puede corregirlo.', codigo: 'MES_CERRADO' });
      if (f.auto) return res.status(400).json({ error: 'Ese renglón es un gasto del anticipo: se corrige en Cuentas por pagar' });
      if (f.fantasma) return res.status(400).json({ error: 'Ese folio ya no tiene movimiento (se canceló o cambió de cuenta): no se corrige' });
      // Un renglón del desglose es de quien lo agregó: se cambia ahí mismo (con su rastro en la bitácora).
      if (f.ref.startsWith('desglose:')) {
        if (!(campo in CAMPOS_DESGLOSE)) return res.status(400).json({ error: `En un renglón del desglose no se cambia «${ETIQ[campo] || campo}»` });
        const v = limpiarValor(campo, EDITABLES[campo], c.valor, f); if (v.error) return res.status(400).json({ error: v.error });
        const nuevo = DINERO.has(campo) ? Number(v.valor) : v.valor;
        if (String(nuevo) === String(f[campo] ?? '')) continue;
        desglose.push({ f, campo, nuevo, antes: f[campo] });
        continue;
      }
      const tipo = EDITABLES[campo];
      if (!tipo) return res.status(400).json({ error: `La columna «${campo}» no se corrige aquí (el saldo, el X comprobar y los importes y fechas salen del cobro o pago)` });
      if (f.desglosado && DINERO.has(campo)) return res.status(400).json({ error: 'Ese pago está desglosado: su monto CFDI y no deducible son la suma de los renglones de abajo. Corrige esos renglones.' });
      let valor = c.valor;
      if (valor !== null) { const v = limpiarValor(campo, tipo, valor, f); if (v.error) return res.status(400).json({ error: v.error }); valor = v.valor; }
      const actual = f[campo], yaCorregido = !!f.corregido?.[campo];
      // Sin cambio de verdad: el mismo valor, o «volver al del sistema» cuando ya es el del sistema.
      if (valor === null ? !yaCorregido : String(valorDe(campo, valor)) === String(actual ?? '')) continue;
      listos.push({ f, campo, valor, antes: actual });
    }
    // El desglose no puede pasar del importe de su pago.
    { const sumas = new Map();
      for (const { f, campo, nuevo } of desglose) if (DINERO.has(campo)) { const k = f.ref + '|' + campo; sumas.set(k, nuevo); }
      for (const padreRef of new Set(desglose.map(x => x.f.padre))) {
        const p = filas.get(padreRef), hs = [...filas.values()].filter(h => h.padre === padreRef);
        const total = hs.reduce((t, h) => t + (sumas.get(h.ref + '|cfdi_monto') ?? h.cfdi_monto) + (sumas.get(h.ref + '|no_deducible') ?? h.no_deducible), 0);
        if (total > p.egreso + p.ingreso) return res.status(400).json({ error: `El desglose de «${p.concepto_banco}» suma $${pesos(total).toFixed(2)} y el pago es de $${pesos(p.egreso + p.ingreso).toFixed(2)}: no puede pasar del pago` });
      } }
    if (!listos.length && !desglose.length) return res.json({ ok: true, guardados: 0 });
    const cuentas = app.locals.flujoBanco.cuentasDe([...new Set([...listos, ...desglose].map(x => x.f.sucursal_id))]);
    db.transaction(() => {
      for (const { f, campo, valor, antes } of listos) {
        db.prepare('INSERT INTO main.flujo_correcciones (ref, campo, valor, valor_anterior, mes, sucursal_id, usuario_id, usuario) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(f.ref, campo, valor, antes == null ? null : String(antes), f.fecha.slice(0, 7), f.sucursal_id, req.usuarioSesion.id, req.usuarioSesion.nombre);
        const nuevo = valor === null ? (f.corregido?.[campo]?.sistema ?? '') : valorDe(campo, valor);
        // Cambiar la cuenta cambia el folio: el viejo queda reasignado y el movimiento recibe el siguiente de la cuenta nueva.
        if (campo === 'cuenta_id' && app.locals.folios) app.locals.folios.reasignar(req, f.ref, Number(nuevo) || 0, f.egreso ? 'E' : 'I', f.fecha, f.egreso || f.ingreso, f.concepto_banco);
        app.locals.auditoria?.registrar(req, 'contabilidad', f.sucursal_id, 'flujo corregido', `${f.fecha.split('-').reverse().join('/')} · ${f.concepto_banco} · ${ETIQ[campo]}: ${legible(campo, antes, cuentas)} → ${legible(campo, nuevo, cuentas)}${valor === null ? ' (el del sistema)' : ''}`);
      }
      for (const { f, campo, nuevo, antes } of desglose) {
        db.prepare(`UPDATE main.flujo_desglose SET ${CAMPOS_DESGLOSE[campo]} = ?, actualizado_por = ?, updated_at = datetime('now','localtime') WHERE id = ? AND anulado = 0`).run(nuevo, req.usuarioSesion.nombre, Number(f.ref.split(':')[1]));
        app.locals.auditoria?.registrar(req, 'contabilidad', f.sucursal_id, 'desglose corregido', `${f.fecha.split('-').reverse().join('/')} · ${f.concepto_banco} (renglón ${f.ref.split(':')[1]}) · ${ETIQ[campo]}: ${legible(campo, antes, cuentas)} → ${legible(campo, nuevo, cuentas)}`);
      }
    }).immediate();
    res.json({ ok: true, guardados: listos.length + desglose.length });
  }));

  // ---------- Desglosar un pago (parte 4) ----------
  // Agrega un renglón debajo del pago con su factura, proveedor, proyecto y tipo de gasto, y con lo que falta por desglosar
  // como monto CFDI (se ajusta después en la tabla). Solo en salidas que no son la entrega de un anticipo (esa se desglosa sola).
  app.post('/api/contabilidad/flujo/desglose', h((req, res) => {
    if (!puede(req)) return res.status(403).json({ error: 'Desglosan el flujo de banco Dirección, el Gerente y quien tenga «Contabilidad del mes»' });
    const b = req.body || {}, mes = String(b.mes || '');
    if (!MES.test(mes)) return res.status(400).json({ error: 'Elige el mes (AAAA-MM)' });
    const [d, hst] = rango(mes), todas = filasFlujo(req, d, hst, null), p = todas.find(f => f.ref === String(b.ref || ''));
    if (!p || p.es_desglose) return res.status(404).json({ error: 'No se encontró ese pago en el flujo de este mes' });
    if (!p.egreso) return res.status(400).json({ error: 'Solo se desglosan las salidas (egresos)' });
    if (p.anticipo) return res.status(400).json({ error: 'La entrega de un anticipo se desglosa sola con los gastos que lo comprueban' });
    if (app.locals.contabilidadCierres.cerrado(p.fecha.slice(0, 7), p.sucursal_id) && !P.direccion(req)) return res.status(409).json({ error: 'Ese mes ya está cerrado en Contabilidad: solo Dirección puede desglosarlo.', codigo: 'MES_CERRADO' });
    const hs = todas.filter(h => h.padre === p.ref);
    if (hs.length >= 100) return res.status(400).json({ error: 'Ese pago ya tiene 100 renglones de desglose' });
    const falta = Math.max(0, p.egreso - hs.reduce((t, h) => t + h.cfdi_monto + h.no_deducible, 0));
    const id = db.transaction(() => {
      const r = db.prepare(`INSERT INTO main.flujo_desglose (ref_padre, mes, sucursal_id, metodo, cfdi, tercero, concepto, observaciones, cfdi_monto_cent, cuenta_abono, proyecto, unidad, tipo_gasto, creado_por, usuario)
        VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`).run(p.ref, p.fecha.slice(0, 7), p.sucursal_id, p.metodo === 'NO APLICA' ? 'PUE' : p.metodo, p.cfdi === 'NO APLICA' ? '' : p.cfdi, p.tercero,
        hs.length ? '' : ['DESGLOSADO', 'X DESGLOSAR'].includes(p.concepto) ? '' : p.concepto, falta, p.cuenta_abono, p.proyecto, '', p.tipo_gasto, req.usuarioSesion.id, req.usuarioSesion.nombre);
      app.locals.auditoria?.registrar(req, 'contabilidad', p.sucursal_id, 'desglose agregado', `${p.fecha.split('-').reverse().join('/')} · ${p.concepto_banco}: renglón ${r.lastInsertRowid} con monto CFDI $${pesos(falta).toFixed(2)}`);
      return Number(r.lastInsertRowid);
    }).immediate();
    res.status(201).json({ id, ref: 'desglose:' + id, monto_cfdi: pesos(falta) });
  }));

  // Quitar un renglón del desglose: no se borra, queda con quién y cuándo.
  app.post('/api/contabilidad/flujo/desglose/:id/quitar', h((req, res) => {
    if (!puede(req)) return res.status(403).json({ error: 'Desglosan el flujo de banco Dirección, el Gerente y quien tenga «Contabilidad del mes»' });
    const r = db.prepare('SELECT * FROM main.flujo_desglose WHERE id = ? AND anulado = 0 AND en_alcance(sucursal_id)').get(Number(req.params.id) || 0);
    if (!r) return res.status(404).json({ error: 'No se encontró ese renglón del desglose' });
    if (app.locals.contabilidadCierres.cerrado(r.mes, r.sucursal_id) && !P.direccion(req)) return res.status(409).json({ error: 'Ese mes ya está cerrado en Contabilidad: solo Dirección puede cambiarlo.', codigo: 'MES_CERRADO' });
    db.transaction(() => {
      db.prepare("UPDATE main.flujo_desglose SET anulado = 1, anulado_por = ?, anulado_at = datetime('now','localtime') WHERE id = ?").run(req.usuarioSesion.nombre, r.id);
      app.locals.auditoria?.registrar(req, 'contabilidad', r.sucursal_id, 'desglose quitado', `Renglón ${r.id} de ${r.ref_padre}: ${r.tercero || ''} · ${r.concepto || ''} · $${pesos(r.cfdi_monto_cent + r.no_deducible_cent).toFixed(2)}`);
    }).immediate();
    res.json({ ok: true });
  }));

  // ---------- Movimientos que no pasaron por el sistema (parte 4) ----------
  app.post('/api/contabilidad/flujo/movimientos', h((req, res) => {
    if (!puede(req)) return res.status(403).json({ error: 'Agregan movimientos al flujo de banco Dirección, el Gerente y quien tenga «Contabilidad del mes»' });
    const b = req.body || {}, sucs = app.locals.contabilidadCierres.sucursalesDe(req, b.sucursal);
    if (!sucs) return res.status(404).json({ error: 'No encontrado' });
    if (sucs.length !== 1) return res.status(400).json({ error: 'Elige arriba la sucursal del movimiento' });
    const suc = sucs[0], hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date()), fecha = String(b.fecha || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || isNaN(Date.parse(fecha + 'T12:00:00Z')) || new Date(fecha + 'T12:00:00Z').toISOString().slice(0, 10) !== fecha) return res.status(400).json({ error: 'La fecha no es válida' });
    if (fecha > hoy) return res.status(400).json({ error: 'La fecha no puede ser futura' });
    if (!['ingreso', 'egreso'].includes(b.tipo)) return res.status(400).json({ error: 'Elige si el dinero entró o salió' });
    const x = String(b.monto ?? '').trim().replace(/[$,]/g, '');
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(x) || Number(x) <= 0) return res.status(400).json({ error: 'Escribe el monto en pesos, mayor a 0 y con máximo 2 decimales' });
    if (!(b.categoria in CATEG_MOV)) return res.status(400).json({ error: 'Elige qué tipo de movimiento es' });
    const concepto = String(b.concepto ?? '').trim().replace(/\s+/g, ' ');
    if (concepto.length < 3 || concepto.length > 200) return res.status(400).json({ error: 'Escribe el concepto como lo trae el banco (3 a 200 letras)' });
    const cuenta = Number(b.cuenta || 0);
    if (!Number.isInteger(cuenta) || !app.locals.flujoBanco.cuentasDe([suc]).some(c => c.id === cuenta)) return res.status(400).json({ error: 'Esa cuenta de banco no es de la sucursal' });
    { const r = app.locals.folios?.resolver(suc, cuenta, { requerida: true }); if (r?.error) return res.status(400).json(r); } // con cuentas con folio, hay que decir cuál
    if (app.locals.contabilidadCierres.cerrado(fecha.slice(0, 7), suc) && !P.direccion(req)) return res.status(409).json({ error: 'Ese mes ya está cerrado en Contabilidad: solo Dirección puede agregarle movimientos.', codigo: 'MES_CERRADO' });
    const texto = (v, n) => { const t = String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, n); return t || null; };
    const monto = Math.round(Number(x) * 100);
    const id = db.transaction(() => {
      const r = db.prepare(`INSERT INTO main.flujo_movimientos (sucursal_id, cuenta_id, fecha, tipo, monto_cent, categoria, concepto, referencia, observaciones, creado_por, creado_por_nombre)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(suc, cuenta, fecha, b.tipo, monto, b.categoria, concepto, texto(b.referencia, 120), texto(b.observaciones, 300), req.usuarioSesion.id, req.usuarioSesion.nombre);
      app.locals.auditoria?.registrar(req, 'contabilidad', suc, 'movimiento agregado', `${fecha.split('-').reverse().join('/')} · ${b.tipo === 'ingreso' ? 'entrada' : 'salida'} de $${pesos(monto).toFixed(2)} · ${CATEG_MOV[b.categoria]} · ${concepto}`);
      return Number(r.lastInsertRowid);
    }).immediate();
    res.status(201).json({ id, ref: 'manual:' + id });
  }));

  app.post('/api/contabilidad/flujo/movimientos/:id/cancelar', h((req, res) => {
    if (!puede(req)) return res.status(403).json({ error: 'Cancelan movimientos del flujo de banco Dirección, el Gerente y quien tenga «Contabilidad del mes»' });
    const m = db.prepare('SELECT * FROM main.flujo_movimientos WHERE id = ? AND cancelado = 0 AND en_alcance(sucursal_id)').get(Number(req.params.id) || 0);
    if (!m) return res.status(404).json({ error: 'No se encontró ese movimiento (o ya estaba cancelado)' });
    const motivo = String(req.body?.motivo ?? '').trim().replace(/\s+/g, ' ').slice(0, 300);
    if (motivo.length < 5) return res.status(400).json({ error: 'Escribe por qué se cancela (mínimo 5 letras)' });
    if (app.locals.contabilidadCierres.cerrado(m.fecha.slice(0, 7), m.sucursal_id) && !P.direccion(req)) return res.status(409).json({ error: 'Ese mes ya está cerrado en Contabilidad: solo Dirección puede cancelarlo.', codigo: 'MES_CERRADO' });
    db.transaction(() => {
      db.prepare("UPDATE main.flujo_movimientos SET cancelado = 1, cancelado_por = ?, cancelado_at = datetime('now','localtime'), motivo_cancelacion = ? WHERE id = ?").run(req.usuarioSesion.id, motivo, m.id);
      app.locals.auditoria?.registrar(req, 'contabilidad', m.sucursal_id, 'movimiento cancelado', `${m.fecha.split('-').reverse().join('/')} · $${pesos(m.monto_cent).toFixed(2)} · ${m.concepto} · motivo: ${motivo}`);
    }).immediate();
    res.json({ ok: true });
  }));


  // Asignar folios pendientes (parte 5): a lo que ya tiene cuenta con clave y no tiene folio (cargas de Excel, lo registrado
  // antes de poner las claves, una cuenta corregida), en orden de fecha. Lo de un mes cerrado, solo Dirección.
  app.post('/api/contabilidad/flujo/folios-pendientes', h((req, res) => {
    if (!puede(req)) return res.status(403).json({ error: 'Asignan folios Dirección, el Gerente y quien tenga «Contabilidad del mes»' });
    const filas = filasFlujo(req, null, null, null).filter(f => !f.es_desglose && !f.fantasma && !f.folio && f.cuenta_id).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.orden.localeCompare(b.orden));
    const cerrado = (f) => app.locals.contabilidadCierres.cerrado(f.fecha.slice(0, 7), f.sucursal_id) && !P.direccion(req);
    const asignados = db.transaction(() => filas.filter(f => !cerrado(f)).map(f => app.locals.folios.asignar(req, f.ref, f.cuenta_id, f.egreso ? 'E' : 'I', f.fecha, f.egreso || f.ingreso, f.concepto_banco)).filter(Boolean)).immediate();
    if (asignados.length) app.locals.auditoria?.registrar(req, 'contabilidad', null, 'folios asignados', `${asignados.length} folio(s): ${asignados.slice(0, 20).join(', ')}${asignados.length > 20 ? '…' : ''}`);
    res.json({ ok: true, asignados: asignados.length, omitidos: filas.length - asignados.length });
  }));

  // Solo el flujo de banco de una cuenta (para el Excel: una hoja por cuenta, como la hoja «STD» de Dirección).
  app.get('/api/contabilidad/flujo', h((req, res) => {
    if (!puede(req)) return negar(res);
    const mes = leerMes(req, res); if (!mes) return;
    const suc = req.query.sucursal ? Number(req.query.sucursal) : null;
    if (!app.locals.contabilidadCierres.sucursalesDe(req, suc)) return res.status(404).json({ error: 'No encontrado' });
    const f = flujoDelMes(req, mes, suc, req.query.cuenta);
    res.json({ flujo: f.filas, saldo_inicial: f.saldo_inicial, saldo_inicial_crm: f.saldo_inicial_crm, saldos_iniciales: f.saldos_iniciales, flujo_cuenta: f.cuenta, cuentas: f.cuentas, puede_editar: f.puede_editar, es_direccion: f.es_direccion, editables: f.editables, editables_desglose: f.editables_desglose, categorias_mov: f.categorias_mov, sin_folio: f.sin_folio });
  }));

  // Los renglones del Excel del mes (la pantalla arma el archivo).
  app.get('/api/contabilidad/excel', h((req, res) => {
    if (!puede(req)) return negar(res);
    const mes = leerMes(req, res); if (!mes) return;
    const suc = req.query.sucursal ? Number(req.query.sucursal) : null;
    const { facturas, cobros, gastos, xmls, pagos } = datosDelMes(mes, suc);
    const claveSuc = id => app.locals.sucursales?.claveDe?.(id) || '';
    const flujo = flujoDelMes(req, mes, suc, req.query.cuenta);
    res.json({
      flujo: flujo.filas, saldo_inicial: flujo.saldo_inicial, saldo_inicial_crm: flujo.saldo_inicial_crm, saldos_iniciales: flujo.saldos_iniciales, flujo_cuenta: flujo.cuenta, cuentas: flujo.cuentas, puede_editar: flujo.puede_editar, es_direccion: flujo.es_direccion, editables: flujo.editables, editables_desglose: flujo.editables_desglose, categorias_mov: flujo.categorias_mov, sin_folio: flujo.sin_folio,
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
