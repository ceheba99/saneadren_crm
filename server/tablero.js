// Panorama general (Resultados): cómo está la empresa en un periodo, comparado con el periodo anterior
// de la misma duración. Un solo pedido que junta ventas, utilidad estimada, flujo de dinero, cartera,
// cuentas por pagar, operación, comercial, clientes y una tendencia de 12 meses. Todo en centavos
// internamente; se responde en pesos. Solo administración (incluye utilidad y márgenes).
// Utilidad = venta SIN IVA menos gastos SIN IVA (el IVA de las facturas de gastos se acredita: ver ivaDeGasto en
// finanzas.js). Los comprobantes «informativo» no se suman, y lo que no es gasto (inversión, préstamos, traspasos)
// no resta a la utilidad, tampoco en la tendencia.
const Importes = require('../public/importes.js');
const { hoyMexico } = require('./fechas');
const alcance = require('./alcance');

const pesos = cent => Math.round(Number(cent || 0)) / 100;
const fechaOk = f => typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(Date.parse(f + 'T00:00:00Z'));
const sumarDias = (f, d) => { const x = new Date(f + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const diasEntre = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
// Mueve una fecha n meses (si el día no existe en ese mes, queda en el último día).
function moverMeses(f, n) {
  const [a, m, d] = f.split('-').map(Number);
  const x = new Date(Date.UTC(a, m - 1 + n, 1)), ultimo = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(d, ultimo)); return x.toISOString().slice(0, 10);
}
const finDeMes = f => { const [a, m] = f.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };
// Periodo con el que se compara: mes contra mes anterior, trimestre contra trimestre anterior, año contra
// el mismo tramo del año pasado; en otro caso, el mismo número de días inmediatamente antes.
function periodoAnterior(desde, hasta, tipo) {
  const meses = { mes: 1, mes_pasado: 1, trimestre: 3, anio: 12 }[tipo];
  if (meses && desde.endsWith('-01')) {
    const antDesde = moverMeses(desde, -meses);
    const antHasta = hasta === finDeMes(hasta) ? finDeMes(moverMeses(hasta, -meses)) : moverMeses(hasta, -meses);
    return [antDesde, antHasta];
  }
  const dias = diasEntre(desde, hasta) + 1, antHasta = sumarDias(desde, -1);
  return [sumarDias(antHasta, -(dias - 1)), antHasta];
}
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

module.exports = function tablero(app, db, h, finanzas) {
  const subtotalCent = l => Math.round(Number(l.valor || 0) * 100);
  const FECHA_VENTA = 'COALESCE(l.fecha_realizado, l.fecha_servicio, date(l.created_at))';

  // Servicios realizados en el periodo (la venta real: lo mismo que cuenta el Generador).
  function realizados(d, h) {
    return db.prepare(`SELECT l.id, l.cliente_id, l.valor, l.iva_cent, l.iva_modo, l.iva_tasa, l.partidas_json, l.equipo, l.operador, l.encuesta_calificacion,
        (SELECT group_concat(p.nombre, '|') FROM orden_personal op JOIN personal p ON p.id = op.personal_id WHERE op.lead_id = l.id) AS equipo_personal,
        ${FECHA_VENTA} AS fecha, COALESCE(c.empresa_contacto, c.nombre, l.nombre) AS cliente, COALESCE(cl.nombre, cc.nombre, 'Sin canal') AS canal, s.nombre AS servicio_nombre
      FROM leads l LEFT JOIN clientes c ON c.id = l.cliente_id LEFT JOIN canales cl ON cl.id = l.canal_id LEFT JOIN canales cc ON cc.id = c.canal_origen_id
      LEFT JOIN catalogo_servicios s ON s.id = l.servicio_id
      WHERE l.estatus = 'ganado' AND l.ejecucion = 'realizado' AND ${FECHA_VENTA} BETWEEN ? AND ?`).all(d, h);
  }
  const { ivaDeGasto } = require('./finanzas');
  // Gastos vivos (sin cancelados ni informativos), cada uno con su importe sin IVA.
  const COLS_GASTO = 'id, categoria, lead_id, total_cent, iva_cent, tipo_comprobante, factura_folio, fecha_documento';
  const sinIva = x => { const i = ivaDeGasto(x); return { ...x, iva: i.iva_cent, estimado: i.estimado, neto: x.total_cent - i.iva_cent }; };
  const vivos = (where, ...p) => db.prepare(`SELECT ${COLS_GASTO} FROM cuentas_por_pagar WHERE cancelada = 0 AND COALESCE(tipo_comprobante, '') <> 'informativo' AND ${where}`).all(...p).map(sinIva);
  // Costo de terceros (sin IVA) de cada orden.
  const costosDe = ids => {
    const m = new Map();
    for (let i = 0; i < ids.length; i += 500) {
      const parte = ids.slice(i, i + 500);
      for (const x of vivos(`lead_id IN (${parte.map(() => '?').join(',')})`, ...parte)) m.set(x.lead_id, (m.get(x.lead_id) || 0) + x.neto);
    }
    return m;
  };
  const uno = (sql, ...p) => db.prepare(sql).get(...p);

  // Números de un periodo (se calculan igual para el periodo y para el anterior).
  function periodo(d, h) {
    const ventas = realizados(d, h);
    const ventaSub = ventas.reduce((t, l) => t + subtotalCent(l), 0);
    const ventaTotal = ventas.reduce((t, l) => t + subtotalCent(l) + (l.iva_cent || 0), 0);
    const costos = costosDe(ventas.map(l => l.id));
    const costoDirecto = [...costos.values()].reduce((t, x) => t + x, 0);
    // Gastos del periodo por categoría, sin IVA (también con IVA, como se pagan).
    const delPeriodo = vivos('fecha_documento BETWEEN ? AND ?', d, h);
    const porCat = new Map();
    for (const x of delPeriodo) { const g = porCat.get(x.categoria) || { categoria: x.categoria, t: 0, con_iva: 0, sin_orden: 0 }; g.t += x.neto; g.con_iva += x.total_cent; if (!x.lead_id) g.sin_orden += x.neto; porCat.set(x.categoria, g); }
    const gastos = [...porCat.values()].sort((a, b) => b.t - a.t);
    // Compras de bienes (inversión), préstamos y traspasos no son gasto: se muestran aparte y no restan a la utilidad.
    const { CATEGORIAS_NO_GASTO } = require('./finanzas');
    const deGasto = delPeriodo.filter(x => !CATEGORIAS_NO_GASTO.has(x.categoria));
    const gastoTotal = deGasto.reduce((t, x) => t + x.neto, 0), gastoConIva = deGasto.reduce((t, x) => t + x.total_cent, 0);
    const estimados = deGasto.filter(x => x.estimado);
    const noGasto = delPeriodo.filter(x => CATEGORIAS_NO_GASTO.has(x.categoria)).reduce((t, x) => t + x.neto, 0);
    const cobrado = uno("SELECT COALESCE(SUM(monto_cent), 0) t, COUNT(*) n FROM cobros WHERE cancelado = 0 AND tipo <> 'ajuste' AND fecha BETWEEN ? AND ?", d, h);
    const descuentos = uno("SELECT COALESCE(SUM(monto_cent), 0) t FROM cobros WHERE cancelado = 0 AND tipo = 'ajuste' AND fecha BETWEEN ? AND ?", d, h).t;
    const pagado = uno('SELECT COALESCE(SUM(monto_cent), 0) t FROM pagos_proveedor WHERE cancelado = 0 AND fecha BETWEEN ? AND ?', d, h).t;
    const cot = uno(`SELECT COUNT(*) n, COALESCE(SUM(valor), 0) v,
        SUM(CASE WHEN estatus = 'ganado' THEN 1 ELSE 0 END) ganadas, SUM(CASE WHEN estatus = 'perdido' THEN 1 ELSE 0 END) perdidas,
        COALESCE(SUM(CASE WHEN estatus = 'ganado' THEN valor ELSE 0 END), 0) v_ganadas
      FROM leads WHERE origen = 'cotizacion' AND date(created_at) BETWEEN ? AND ?`, d, h);
    const noRealizados = uno("SELECT COUNT(*) n, COALESCE(SUM(valor), 0) v FROM leads WHERE estatus = 'ganado' AND ejecucion = 'no_realizado' AND fecha_servicio BETWEEN ? AND ?", d, h);
    const contactos = uno('SELECT COUNT(*) n FROM clientes WHERE date(created_at) BETWEEN ? AND ?', d, h).n;
    // Clientes: activos (con servicio realizado), nuevos (su primer servicio realizado cae en el periodo) y recurrentes.
    const activos = new Set(ventas.map(l => l.cliente_id));
    let nuevos = 0;
    const primero = db.prepare(`SELECT MIN(${FECHA_VENTA}) f FROM leads l WHERE l.cliente_id = ? AND l.estatus = 'ganado' AND l.ejecucion = 'realizado'`);
    for (const c of activos) if ((primero.get(c).f || '') >= d) nuevos++;
    return {
      ventas, costos,
      r: {
        venta: pesos(ventaSub), venta_con_iva: pesos(ventaTotal), servicios: ventas.length, ticket: ventas.length ? pesos(ventaSub / ventas.length) : 0,
        costo_directo: pesos(costoDirecto), margen_directo: pesos(ventaSub - costoDirecto),
        gasto: pesos(gastoTotal), gasto_con_iva: pesos(gastoConIva), iva_gastos: pesos(gastoConIva - gastoTotal), iva_estimado: pesos(estimados.reduce((t, x) => t + x.iva, 0)), iva_estimado_n: estimados.length,
        no_gasto: pesos(noGasto), utilidad: pesos(ventaSub - gastoTotal), margen_pct: ventaSub ? Math.round((ventaSub - gastoTotal) / ventaSub * 1000) / 10 : null,
        cobrado: pesos(cobrado.t), cobros_n: cobrado.n, descuentos: pesos(descuentos), pagado: pesos(pagado), flujo: pesos(cobrado.t - pagado),
        cotizaciones: cot.n, cotizado: Math.round((cot.v || 0) * 100) / 100, cot_ganadas: cot.ganadas || 0, cot_perdidas: cot.perdidas || 0,
        cierre_pct: (cot.ganadas || 0) + (cot.perdidas || 0) ? Math.round(cot.ganadas / (cot.ganadas + cot.perdidas) * 1000) / 10 : null,
        no_realizados: noRealizados.n, no_realizado_valor: Math.round((noRealizados.v || 0) * 100) / 100,
        // Encuesta de calidad de los servicios realizados en el periodo (1 malo … 4 excelente; se captura en la orden).
        encuestas: ventas.filter(l => l.encuesta_calificacion).length,
        calificacion: ventas.some(l => l.encuesta_calificacion) ? Math.round(ventas.filter(l => l.encuesta_calificacion).reduce((t, l) => t + l.encuesta_calificacion, 0) / ventas.filter(l => l.encuesta_calificacion).length * 10) / 10 : null,
        contactos_nuevos: contactos, clientes_activos: activos.size, clientes_nuevos: nuevos, clientes_recurrentes: activos.size - nuevos,
      },
      gastos: gastos.map(g => ({ categoria: g.categoria, nombre: finanzas.CATEGORIAS[g.categoria] || g.categoria, total: pesos(g.t), con_iva: pesos(g.con_iva), sin_orden: pesos(g.sin_orden), es_gasto: !CATEGORIAS_NO_GASTO.has(g.categoria) })),
    };
  }

  // Ranking por una clave (cliente, canal, unidad, persona) con venta, servicios, costo y margen. La clave puede ser
  // una lista (las personas del equipo): cada una suma la orden completa.
  function ranking(ventas, costos, clave, limite = 8) {
    const m = new Map();
    for (const l of ventas) {
      const ks = [].concat(clave(l) || []).filter(Boolean);
      for (const k of ks.length ? ks : ['Sin dato']) {
        const g = m.get(k) || { nombre: k, venta: 0, servicios: 0, costo: 0 };
        g.venta += subtotalCent(l); g.servicios++; g.costo += costos.get(l.id) || 0;
        m.set(k, g);
      }
    }
    const total = ventas.reduce((t, l) => t + subtotalCent(l), 0);
    return [...m.values()].sort((a, b) => b.venta - a.venta).slice(0, limite)
      .map(g => ({ nombre: g.nombre, venta: pesos(g.venta), servicios: g.servicios, costo: pesos(g.costo), pct: total ? Math.round(g.venta / total * 1000) / 10 : 0 }));
  }
  // Servicios del catálogo: cada partida con su subtotal (IVA incluido desglosado).
  function porServicio(ventas) {
    const m = new Map();
    let total = 0;
    for (const l of ventas) {
      let items; try { items = JSON.parse(l.partidas_json || 'null'); } catch { items = null; }
      if (!Array.isArray(items) || !items.length) items = [{ servicio: l.servicio_nombre || 'Servicio', importe: l.valor || 0 }];
      const lineas = Importes.desglosarPartidas(items, l.iva_modo, l.iva_tasa);
      items.forEach((it, i) => {
        const k = it.servicio || l.servicio_nombre || 'Servicio', g = m.get(k) || { nombre: k, venta: 0, servicios: 0 };
        g.venta += lineas[i].subtotal_cent; g.servicios++; total += lineas[i].subtotal_cent; m.set(k, g);
      });
    }
    return [...m.values()].sort((a, b) => b.venta - a.venta).slice(0, 8).map(g => ({ nombre: g.nombre, venta: pesos(g.venta), servicios: g.servicios, pct: total ? Math.round(g.venta / total * 1000) / 10 : 0 }));
  }

  // Tendencia: 12 meses que terminan en el mes de "hasta".
  function tendencia(hasta) {
    const [a, m] = hasta.split('-').map(Number);
    const meses = [];
    for (let i = 11; i >= 0; i--) { const x = new Date(Date.UTC(a, m - 1 - i, 1)); meses.push(x.toISOString().slice(0, 7)); }
    const ini = meses[0] + '-01', fin = hasta.slice(0, 7) + '-31';
    const mapa = (filas) => new Map(filas.map(f => [f.mes, f.t]));
    const venta = mapa(db.prepare(`SELECT substr(${FECHA_VENTA}, 1, 7) mes, SUM(CAST(ROUND(COALESCE(l.valor, 0) * 100) AS INTEGER)) t FROM leads l
      WHERE l.estatus = 'ganado' AND l.ejecucion = 'realizado' AND ${FECHA_VENTA} BETWEEN ? AND ? GROUP BY mes`).all(ini, fin));
    const cobrado = mapa(db.prepare("SELECT substr(fecha, 1, 7) mes, SUM(monto_cent) t FROM cobros WHERE cancelado = 0 AND tipo <> 'ajuste' AND fecha BETWEEN ? AND ? GROUP BY mes").all(ini, fin));
    const { CATEGORIAS_NO_GASTO } = require('./finanzas'), gasto = new Map();
    for (const x of vivos('fecha_documento BETWEEN ? AND ?', ini, fin)) if (!CATEGORIAS_NO_GASTO.has(x.categoria)) { const mes = x.fecha_documento.slice(0, 7); gasto.set(mes, (gasto.get(mes) || 0) + x.neto); }
    const pagado = mapa(db.prepare('SELECT substr(fecha, 1, 7) mes, SUM(monto_cent) t FROM pagos_proveedor WHERE cancelado = 0 AND fecha BETWEEN ? AND ? GROUP BY mes').all(ini, fin));
    return meses.map(mes => {
      const v = venta.get(mes) || 0, g = gasto.get(mes) || 0;
      return { mes, etiqueta: MESES[Number(mes.slice(5)) - 1] + ' ' + mes.slice(2, 4), venta: pesos(v), cobrado: pesos(cobrado.get(mes) || 0), gasto: pesos(g), pagado: pesos(pagado.get(mes) || 0), utilidad: pesos(v - g) };
    });
  }

  app.get('/api/tablero', h((req, res) => {
    if (!app.locals.permisos.puede(req, 'reportes.panorama')) return res.status(403).json({ error: 'No tienes permiso para ver el panorama general' });
    const hoy = hoyMexico();
    const desde = req.query.desde || hoy.slice(0, 8) + '01', hasta = req.query.hasta || hoy;
    if (!fechaOk(desde) || !fechaOk(hasta) || desde > hasta) return res.status(400).json({ error: 'Revisa el rango de fechas' });
    if (diasEntre(desde, hasta) > 3660) return res.status(400).json({ error: 'El rango máximo es de 10 años' });
    const [antDesde, antHasta] = periodoAnterior(desde, hasta, String(req.query.tipo || ''));
    const act = periodo(desde, hasta), ant = periodo(antDesde, antHasta);

    // Fotografía de hoy: cartera, cuentas por pagar, operación y comercial abiertos.
    const cart = finanzas.cartera();
    const conSaldo = cart.filter(c => c.saldo > 0 && !c.programada);
    const suma = arr => Math.round(arr.reduce((t, c) => t + c.saldo * 100, 0)) / 100;
    const tramos = [['por_vencer', 'Por vencer'], ['1-15', '1 a 15 días'], ['16-30', '16 a 30 días'], ['31-60', '31 a 60 días'], ['60+', 'Más de 60 días']]
      .map(([k, nombre]) => { const xs = conSaldo.filter(c => c.tramo === k); return { tramo: k, nombre, total: suma(xs), ordenes: xs.length }; });
    const deudores = new Map();
    for (const c of conSaldo) { const g = deudores.get(c.cliente_id) || { cliente_id: c.cliente_id, nombre: c.empresa_contacto || c.cliente_nombre, saldo: 0, vencido: 0, dias: 0 }; g.saldo += c.saldo; if (c.vencida) g.vencido += c.saldo; g.dias = Math.max(g.dias, c.dias_vencido); deudores.set(c.cliente_id, g); }
    const cxp = finanzas.cuentasPorPagar().filter(x => x.saldo > 0 && x.tipo_comprobante !== 'informativo');
    const domingo = sumarDias(hoy, (7 - new Date(hoy + 'T00:00:00Z').getUTCDay()) % 7);
    // Días promedio de cobro: de que se hizo el servicio a su último pago, en órdenes liquidadas en el periodo.
    const dso = uno(`SELECT AVG(julianday(u.ultimo) - julianday(COALESCE(l.fecha_realizado, l.fecha_servicio))) d, COUNT(*) n FROM leads l
      JOIN (SELECT lead_id, MAX(fecha) ultimo, SUM(monto_cent) cobrado FROM cobros WHERE cancelado = 0 GROUP BY lead_id) u ON u.lead_id = l.id
      WHERE l.estatus = 'ganado' AND u.ultimo BETWEEN ? AND ? AND u.cobrado >= COALESCE(l.factura_total_cent, CAST(ROUND(COALESCE(l.valor, 0) * 100) AS INTEGER) + COALESCE(l.iva_cent, 0))
        AND COALESCE(l.fecha_realizado, l.fecha_servicio) IS NOT NULL`, desde, hasta);
    const abiertas = uno("SELECT COUNT(*) n, COALESCE(SUM(valor), 0) v FROM leads WHERE estatus = 'abierto'");
    const vencenCot = uno("SELECT COUNT(*) n, COALESCE(SUM(valor), 0) v FROM leads WHERE estatus = 'abierto' AND incluye_vigencia = 1 AND vigencia_hasta BETWEEN ? AND ?", hoy, sumarDias(hoy, 7));
    const porConcluir = uno("SELECT COUNT(*) n, COALESCE(SUM(valor), 0) v FROM leads WHERE estatus = 'ganado' AND ejecucion IS NULL AND fecha_servicio IS NOT NULL AND fecha_servicio < ?", hoy);
    const proximos = uno("SELECT COUNT(*) n, COALESCE(SUM(valor), 0) v FROM leads WHERE estatus = 'ganado' AND ejecucion IS NULL AND fecha_servicio BETWEEN ? AND ?", hoy, sumarDias(hoy, 7));
    const porConfirmar = uno('SELECT COUNT(*) n, COALESCE(SUM(monto_cent), 0) t FROM cobros WHERE cancelado = 0 AND confirmado = 0');
    const ivaPorDefinir = uno("SELECT COUNT(*) n FROM leads WHERE estatus = 'ganado' AND iva_modo IS NULL AND ejecucion = 'realizado'").n;

    const foto = {
      te_deben: suma(conSaldo), vencido: suma(conSaldo.filter(c => c.vencida)), vencido_30: suma(conSaldo.filter(c => c.dias_vencido > 30)),
      ordenes_por_cobrar: conSaldo.length, por_realizar: suma(cart.filter(c => c.saldo > 0 && c.programada && !c.por_concluir)),
      por_concluir_monto: suma(cart.filter(c => c.saldo > 0 && c.por_concluir)), ordenes_por_concluir: cart.filter(c => c.saldo > 0 && c.por_concluir).length,
      a_favor: Math.round(cart.reduce((t, c) => t + (c.a_favor || 0) * 100, 0)) / 100, tramos,
      deudores: [...deudores.values()].sort((a, b) => b.saldo - a.saldo).slice(0, 8).map(g => ({ ...g, saldo: Math.round(g.saldo * 100) / 100, vencido: Math.round(g.vencido * 100) / 100 })),
      debes: Math.round(cxp.reduce((t, x) => t + x.saldo * 100, 0)) / 100, debes_vencido: Math.round(cxp.filter(x => x.vencida).reduce((t, x) => t + x.saldo * 100, 0)) / 100,
      pagar_semana: Math.round(cxp.filter(x => x.fecha_vencimiento <= domingo).reduce((t, x) => t + x.saldo * 100, 0)) / 100,
      dias_cobro: dso.n ? Math.round(dso.d) : null, liquidadas: dso.n,
      pipeline: { abiertas: abiertas.n, valor: Math.round(abiertas.v * 100) / 100, vencen_7: vencenCot.n, vencen_7_valor: Math.round(vencenCot.v * 100) / 100 },
      por_concluir: porConcluir.n, proximos_7: proximos.n, proximos_7_valor: Math.round(proximos.v * 100) / 100,
      por_confirmar: porConfirmar.n, por_confirmar_monto: pesos(porConfirmar.t), iva_por_definir: ivaPorDefinir,
    };

    // Alertas: lo que conviene atender primero.
    const fmt = n => '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const alertas = [];
    if (foto.vencido_30 > 0) alertas.push({ nivel: 'rojo', texto: `${fmt(foto.vencido_30)} de cobranza con más de 30 días vencida`, ir: 'cobrar' });
    if (act.r.flujo < 0) alertas.push({ nivel: 'rojo', texto: `Flujo negativo en el periodo: salió más dinero del que entró (${fmt(act.r.flujo)})`, ir: null });
    if (act.r.venta > 0 && act.r.utilidad < 0) alertas.push({ nivel: 'rojo', texto: `Los gastos del periodo superan las ventas (utilidad estimada ${fmt(act.r.utilidad)})`, ir: null });
    if (foto.debes_vencido > 0) alertas.push({ nivel: 'amarillo', texto: `${fmt(foto.debes_vencido)} vencido con proveedores`, ir: 'pagar' });
    if (foto.por_concluir > 0) alertas.push({ nivel: 'amarillo', texto: `${foto.por_concluir} ${foto.por_concluir === 1 ? 'servicio' : 'servicios'} con fecha pasada sin marcar si se realizó (no cuentan como venta)`, ir: 'inicio' });
    if (foto.por_confirmar > 0) alertas.push({ nivel: 'amarillo', texto: `${foto.por_confirmar} ${foto.por_confirmar === 1 ? 'pago' : 'pagos'} de clientes por confirmar (${fmt(foto.por_confirmar_monto)})`, ir: 'cobrar' });
    const top = ranking(act.ventas, act.costos, l => l.cliente, 1)[0];
    if (top && top.pct >= 40 && act.ventas.length > 1) alertas.push({ nivel: 'amarillo', texto: `Concentración: ${top.nombre} es el ${top.pct} % de las ventas del periodo`, ir: null });
    if (foto.pipeline.vencen_7 > 0) alertas.push({ nivel: 'azul', texto: `${foto.pipeline.vencen_7} ${foto.pipeline.vencen_7 === 1 ? 'cotización vence' : 'cotizaciones vencen'} en los próximos 7 días (${fmt(foto.pipeline.vencen_7_valor)})`, ir: 'leads' });
    if (foto.a_favor > 0) alertas.push({ nivel: 'azul', texto: `${fmt(foto.a_favor)} a favor de clientes por servicios no realizados (devolver o aplicar)`, ir: 'cobrar' });
    if (act.r.iva_estimado_n > 0) alertas.push({ nivel: 'azul', texto: `${act.r.iva_estimado_n} ${act.r.iva_estimado_n === 1 ? 'factura de gasto' : 'facturas de gastos'} sin IVA capturado: se estimó al 16 % (${fmt(act.r.iva_estimado)}). Captúralo en Cuentas por pagar para una utilidad exacta`, ir: 'pagar' });
    if (foto.iva_por_definir > 0) alertas.push({ nivel: 'azul', texto: `${foto.iva_por_definir} servicios realizados con IVA por definir (su importe se toma como se capturó)`, ir: null });

    // Viendo varias sucursales: el mismo cálculo para cada una (cada número sale solo con lo de esa sucursal).
    const sucs = [...req.alcanceSuc.ids];
    const porSucursal = sucs.length < 2 ? [] : db.prepare(`SELECT id, nombre, clave FROM sucursales WHERE id IN (${sucs.map(() => '?').join(',')}) ORDER BY id`).all(...sucs).map(s =>
      alcance.correr({ todo: false, ids: new Set([s.id]), alta: s.id }, () => {
        const r = periodo(desde, hasta).r, ca = finanzas.cartera().filter(c => c.saldo > 0 && !c.programada), px = finanzas.cuentasPorPagar().filter(x => x.saldo > 0 && x.tipo_comprobante !== 'informativo');
        const cent = arr => Math.round(arr.reduce((t, x) => t + x.saldo * 100, 0)) / 100;
        return { id: s.id, nombre: s.nombre, clave: s.clave, venta: r.venta, servicios: r.servicios, gasto: r.gasto, gasto_con_iva: r.gasto_con_iva, utilidad: r.utilidad, margen_pct: r.margen_pct, cobrado: r.cobrado, pagado: r.pagado, flujo: r.flujo,
          te_deben: cent(ca), vencido: cent(ca.filter(c => c.vencida)), debes: cent(px) };
      }));
    res.json({
      desde, hasta, anterior: { desde: antDesde, hasta: antHasta }, generado: new Date().toISOString(),
      actual: act.r, previo: ant.r, foto, alertas, por_sucursal: porSucursal,
      gastos: act.gastos, tendencia: tendencia(hasta),
      top_clientes: ranking(act.ventas, act.costos, l => l.cliente), por_servicio: porServicio(act.ventas),
      // Cotizaciones del periodo que no se aceptaron, con el motivo que se pide al marcarlas (antes solo quedaba en su historial).
      perdidas: db.prepare(`SELECT l.id, l.folio_num, l.sucursal_id, l.created_at, l.valor, l.motivo_perdida, COALESCE(NULLIF(c.empresa_contacto, ''), c.nombre, l.nombre) AS cliente
        FROM leads l LEFT JOIN clientes c ON c.id = l.cliente_id WHERE l.origen = 'cotizacion' AND l.estatus = 'perdido' AND date(l.created_at) BETWEEN ? AND ?
        ORDER BY l.created_at DESC LIMIT 30`).all(desde, hasta),
      por_canal: ranking(act.ventas, act.costos, l => l.canal), por_unidad: ranking(act.ventas, act.costos, l => l.equipo), por_operador: ranking(act.ventas, act.costos, l => (l.equipo_personal ? l.equipo_personal.split('|') : []).concat(l.operador ? [l.operador] : [])),
    });
  }));
};
