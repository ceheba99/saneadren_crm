/* Facturación CFDI 4.0 · F3 (2026-10-27): timbrado de la factura de una orden de servicio (ingreso, PUE) con factura.com.
   Documentación leída antes de programar (regla 7): apidocs crear-cfdi-40, borradores-cfdi-40, descargar-cfdi, buscar-cfdi y listar-cfdis.
     POST /v4/cfdi40/create                      → timbra (con BorradorSiFalla:"1", si falla deja un borrador y devuelve draft.uid)
     POST /v4/cfdi40/create/{UID} + Draft:"1"     → reemplaza el borrador (cuerpo completo; conserva su folio)
     POST /v4/cfdi40/{UID}/timbrarborrador        → timbra el borrador
     GET  /v4/cfdi/order/{NumOrder}               → busca un CFDI por el número de orden (para no timbrar dos veces)
     GET  /v4/cfdi40/{UID o UUID}/xml | /pdf      → descarga
   PROBADO contra sandbox el 2026-10-28 (RFC de prueba EKU9003173C9 con sus sellos de prueba): timbrado PUE con 229.90 y 1635.48 (XML con
   Total 2163.84 e IVA por concepto 36.784 y 261.6768), descarga de XML y PDF, y búsqueda por NumOrder (existente y «No se encontró CFDI», HTTP 200).
   Sin probar contra factura.com: borrador y timbrarborrador, «Ya existe un CFDI», y producción.
   Reglas de CLAUDE.md que se aplican aquí:
   · (1–3) No se manda nada con datos incompletos: RFC, razón social, CP, régimen, uso (compatible con el régimen) y correo, revisados antes.
   · (4) ClaveProdServ y ClaveUnidad salen del catálogo de servicios; ObjetoImp 02 con IVA trasladado. Nada se escribe a mano.
   · (5) Importes con enteros: 6 decimales por concepto; redondeo a 2 solo en las sumas (facturacion-validaciones.calcularTotales).
   · (6, 15) Idempotencia: NumOrder único por factura (folio de la orden + número de factura + instalación). Una factura «timbrando» (no se
     supo la respuesta) NUNCA se vuelve a mandar sin antes buscarla por NumOrder; «Ya existe un CFDI con folio y serie» tampoco duplica.
     Una sola a la vez por orden: candado en memoria + índice único parcial de la base (una vigente por orden y entorno).
   · (7) EnviarCorreo explícito: en sandbox siempre false.
   · (8) BorradorSiFalla:"1": se guarda el uid del borrador y la factura queda «borrador_error» (pendiente de corregir).
   · (9) FechaFromAPI no se manda: factura.com pone la fecha y hora del timbrado (así no hay riesgo de mandar una hora «futura» desde un servidor en UTC).
   · (12) XML en la base y PDF en el disco (archivos/facturas/<entorno>/), detectando si llega como archivo.
   · Solo una factura de PRODUCCIÓN toca la orden (folio, fecha y total del CFDI en la cobranza). Las de sandbox y demo viven aparte.
   · PUE solamente (la factura a crédito, PPD con complemento de pago, es la F6). Público en general y extranjeros (RFC genéricos) tampoco: F6. */
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const { ErrorFactura } = require('./facturacom');
const { validarDatosFiscales, calcularTotales, pesosAMicros, centavosAMicros, microsATexto } = require('./facturacion-validaciones');
const { leerCatalogos } = require('./facturacion-catalogos');
const { sincronizarCliente } = require('./facturacion-clientes');
const { ESTATUS_VIGENTES } = require('./facturacion-db');

const UUID_SAT = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
const RFC_GENERICOS = ['XAXX010101000', 'XEXX010101000'];
const MICROS = 1000000n;
const redondeo = (a, b) => (2n * a + b) / (2n * b); // a ≥ 0, mitad hacia arriba
const VIGENTES_SQL = ESTATUS_VIGENTES.map(e => `'${e}'`).join(', ');
const ESPERA_TIMBRANDO_MS = 60000; // una factura «timbrando» más reciente que esto se considera en curso
const texto = v => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
const normal = v => texto(v).toLocaleLowerCase('es-MX').normalize('NFD').replace(/[̀-ͯ]/g, '');
const fmt = cent => '$' + (cent / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const horaMexico = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()).replace(' ', 'T');
const numero = m => Number(microsATexto(m)); // micro-pesos → número con hasta 6 decimales exactos

/** Identificador corto de esta instalación (para que el NumOrder de una base de pruebas no choque con el de otra en la misma cuenta). */
function instancia(db) {
  db.exec('CREATE TABLE IF NOT EXISTS config_servidor (clave TEXT PRIMARY KEY, valor TEXT NOT NULL)');
  const r = db.prepare("SELECT valor FROM config_servidor WHERE clave = 'facturacion_instancia'").get();
  if (r) return r.valor;
  const v = crypto.randomBytes(3).toString('hex').toUpperCase();
  db.prepare("INSERT OR IGNORE INTO config_servidor (clave, valor) VALUES ('facturacion_instancia', ?)").run(v);
  return db.prepare("SELECT valor FROM config_servidor WHERE clave = 'facturacion_instancia'").get().valor;
}

// ---------------- Conceptos: de las partidas de la orden ----------------
/**
 * Cada partida { servicio, leyenda, cantidad?, precio?, importe } es un renglón. Importe sin IVA a 6 decimales:
 * «más IVA» → el importe capturado; «IVA incluido» → importe × 100 / (100 + tasa). Con cantidad y precio se respetan si dan exacto el importe;
 * si no, va cantidad 1 por el importe (así Importe = Cantidad × ValorUnitario siempre cuadra, como lo pide el SAT).
 */
function conceptosDeOrden(db, lead) {
  const errores = [], avisos = [], conceptos = [];
  const servicios = db.prepare('SELECT id, nombre, clave_prod_serv, clave_unidad, nombre_unidad, objeto_imp, tasa_iva FROM catalogo_servicios').all();
  const porNombre = new Map(servicios.map(s => [normal(s.nombre), s])), porId = new Map(servicios.map(s => [s.id, s]));
  let partidas = [];
  try { partidas = JSON.parse(lead.partidas_json || '[]'); } catch { errores.push('Las partidas de la orden no se pueden leer'); }
  if (!Array.isArray(partidas)) partidas = [];
  const modo = lead.iva_modo, tasa = Number(lead.iva_tasa);
  if (!partidas.length && Number(lead.valor) > 0) {
    // Orden anterior a las partidas: un solo renglón con el servicio de la orden por el subtotal (valor es sin IVA en ambos modos).
    partidas = [{ servicio: porId.get(lead.servicio_id)?.nombre, importe: lead.valor, _subtotal: true }];
    avisos.push('La orden no tiene partidas: se factura un solo renglón con su servicio por el subtotal');
  }
  if (!partidas.length) errores.push('La orden no tiene partidas ni importe');
  partidas.forEach((p, i) => {
    const n = i + 1;
    const s = (p?.servicio && porNombre.get(normal(p.servicio))) || porId.get(lead.servicio_id) || null;
    const nombreRenglon = texto(p?.leyenda) || texto(p?.servicio) || `renglón ${n}`;
    let importeCent;
    try { importeCent = Math.round(Number(p?.importe) * 100); if (!Number.isFinite(importeCent) || importeCent < 0) throw 0; } catch { errores.push(`El importe de «${nombreRenglon}» no es válido`); return; }
    if (importeCent === 0) { avisos.push(`«${nombreRenglon}» tiene importe $0: no se incluye en la factura`); return; }
    if (!s) { errores.push(`«${nombreRenglon}» no corresponde a un servicio del catálogo`); return; }
    if (!s.clave_prod_serv || !s.clave_unidad || !s.nombre_unidad) { errores.push(`El servicio «${s.nombre}» no tiene clave del SAT (producto y unidad): la pone Dirección en Ajustes → Facturación`); return; }
    if (s.objeto_imp !== '02') { errores.push(`El servicio «${s.nombre}» no está marcado como objeto de impuesto (02): por ahora solo se factura con IVA trasladado`); return; }
    if (Number(s.tasa_iva) !== tasa) { errores.push(`El servicio «${s.nombre}» lleva IVA ${s.tasa_iva} % y la orden ${tasa} %`); return; }
    // Importe sin IVA (micro-pesos) que debe llevar el renglón.
    const capturado = centavosAMicros(importeCent);
    const objetivo = modo === 'incluido' && !p._subtotal ? redondeo(capturado * 100n, BigInt(100 + tasa)) : capturado;
    let cantidad = MICROS, unitario = objetivo, importe = objetivo;
    const q = Number(p?.cantidad);
    if (Number.isFinite(q) && q > 0 && q !== 1) {
      try {
        const qm = pesosAMicros(q);
        const vu = redondeo(objetivo * MICROS, qm), imp = redondeo(qm * vu, MICROS);
        if (imp === objetivo && qm > 0n) { cantidad = qm; unitario = vu; importe = imp; }
      } catch { /* cantidad con más de 6 decimales: va como 1 */ }
      if (cantidad === MICROS) avisos.push(`«${nombreRenglon}»: la cantidad ${q} no da exacto el importe sin IVA a 6 decimales; en la factura va como 1 servicio por el importe completo`);
    }
    let descripcion = texto(p?.leyenda) || texto(s.nombre);
    if (descripcion.length > 1000) descripcion = descripcion.slice(0, 1000);
    conceptos.push({ servicio: s.nombre, descripcion, clave_prod_serv: s.clave_prod_serv, clave_unidad: s.clave_unidad, unidad: s.nombre_unidad,
      cantidad_micros: cantidad, unitario_micros: unitario, base_micros: importe });
  });
  return { conceptos, errores, avisos };
}

/** El cuerpo de cada concepto para la API (6 decimales; IVA trasladado: Impuesto 002, TipoFactor Tasa, como en la doc de crear-cfdi-40). */
function conceptoApi(c, ivaMicros, tasa) {
  const base = numero(c.base_micros);
  return { ClaveProdServ: c.clave_prod_serv, Cantidad: numero(c.cantidad_micros), ClaveUnidad: c.clave_unidad, Unidad: c.unidad,
    ValorUnitario: numero(c.unitario_micros), Importe: base, Descripcion: c.descripcion, ObjetoImp: '02',
    Impuestos: { Traslados: [{ Base: base, Impuesto: '002', TipoFactor: 'Tasa', TasaOCuota: (tasa / 100).toFixed(2), Importe: numero(ivaMicros) }] } };
}

// ---------------- Preparar: revisa TODO sin llamar a nadie ----------------
/**
 * Lo que se va a timbrar y lo que falta. op: { cliente_fiscal_id?, uso_cfdi?, forma_pago?, enviar_correo?, confirmar? }.
 * ctx: { config (leerConfig), demo }. Devuelve { lead, errores, avisos, confirmar, fiscales, fiscal, uso, formas, resumen, cuerpo, vigente, entorno }.
 */
function preparar(db, leadId, op = {}, { config, demo = false } = {}) {
  const errores = [], avisos = [], confirmar = [];
  const entorno = demo ? 'demo' : config.entorno;
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(Number(leadId));
  if (!lead) return null;
  const vigente = db.prepare(`SELECT * FROM facturas WHERE lead_id = ? AND entorno = ? AND tipo_documento = 'factura' AND estatus IN (${VIGENTES_SQL}) ORDER BY id DESC LIMIT 1`).get(lead.id, entorno) || null;
  if (lead.estatus !== 'ganado') errores.push('Solo se factura una orden de servicio (esta es una cotización)');
  if (lead.ejecucion === 'no_realizado') errores.push('El servicio está marcado como NO realizado: no se factura');
  if (lead.iva_modo === 'sin_iva') errores.push('La orden es «sin IVA», es decir, sin factura. Si el cliente pide factura, cambia la orden a «más IVA» o «IVA incluido»');
  else if (!lead.iva_modo) errores.push('La orden tiene el IVA «por definir»: primero indica si es más IVA o IVA incluido');
  if (vigente?.estatus === 'timbrada') errores.push(`Esta orden ya tiene factura${vigente.serie || vigente.folio ? ` ${vigente.serie || ''}${vigente.folio ? '-' + vigente.folio : ''}` : ''}${entorno === 'prod' ? '' : ' (de prueba)'}: no se timbra otra`);
  if (vigente?.estatus === 'cancelacion_solicitada') errores.push('La factura de esta orden está en proceso de cancelación');
  // Una factura capturada a mano (de antes del sistema) en una orden real: no se timbra otra encima.
  if (lead.factura_folio && !vigente) {
    if (entorno === 'prod') errores.push(`La orden ya tiene registrada la factura ${lead.factura_folio} (capturada a mano en Crédito y factura). Si esa factura es válida, no timbres otra`);
    else avisos.push(`La orden tiene registrada la factura ${lead.factura_folio}; como esta es de PRUEBA, no se toca`);
  }

  const conc = lead.iva_modo && lead.iva_modo !== 'sin_iva' ? conceptosDeOrden(db, lead) : { conceptos: [], errores: [], avisos: [] };
  errores.push(...conc.errores); avisos.push(...conc.avisos);
  const tasa = Number(lead.iva_tasa) || 0;
  let totales = null;
  if (conc.conceptos.length && !conc.errores.length) {
    totales = calcularTotales(conc.conceptos.map(c => ({ base_micros: c.base_micros })), { tasa, objetoImp: '02' });
    const totalOrden = Math.round((Number(lead.valor) || 0) * 100) + (Number(lead.iva_cent) || 0);
    const dif = totales.total_cent - totalOrden;
    if (Math.abs(dif) > 1) errores.push(`La factura sumaría ${fmt(totales.total_cent)} y la orden dice ${fmt(totalOrden)}: revisa las partidas de la orden`);
    else if (dif) avisos.push(`La factura suma ${fmt(totales.total_cent)}, un centavo ${dif > 0 ? 'más' : 'menos'} que la orden (${fmt(totalOrden)}), por el redondeo del IVA de cada renglón`);
  }

  // Receptor
  const cat = leerCatalogos(db);
  const fiscales = lead.cliente_id ? db.prepare('SELECT * FROM clientes_fiscales WHERE cliente_id = ? AND activo = 1 ORDER BY predeterminado DESC, id').all(lead.cliente_id) : [];
  let fiscal = null;
  if (!lead.cliente_id) errores.push('La orden no tiene cliente');
  else if (!fiscales.length) errores.push('El cliente no tiene datos fiscales: captúralos en su ficha («Datos fiscales para facturar»)');
  else {
    fiscal = op.cliente_fiscal_id ? fiscales.find(f => f.id === Number(op.cliente_fiscal_id)) : fiscales[0];
    if (!fiscal) errores.push('Esos datos fiscales no son de este cliente o están desactivados');
  }
  let uso = '';
  if (fiscal) {
    const v = validarDatosFiscales(fiscal, cat);
    if (v.faltantes.length) errores.push('Faltan datos fiscales del cliente: ' + v.faltantes.join(', '));
    errores.push(...v.errores);
    if (RFC_GENERICOS.includes(fiscal.rfc)) errores.push('La factura a público en general o a extranjeros (RFC genérico) todavía no está disponible');
    uso = texto(op.uso_cfdi || fiscal.uso_cfdi).toUpperCase();
    if (uso && cat.usos) {
      const u = cat.usos.get(uso);
      if (!u) errores.push(`El uso de CFDI ${uso} no está en el catálogo del SAT`);
      else if (fiscal.regimen && u.regimenes?.length && !u.regimenes.includes(fiscal.regimen)) errores.push(`El uso ${uso} no es compatible con el régimen ${fiscal.regimen} del cliente`);
    }
  }
  if (!cat.regimenes || !cat.usos || !cat.formasPago.length) errores.push('Faltan los catálogos del SAT: Dirección los actualiza en Ajustes → Facturación');

  // Forma de pago (PUE: la forma real en que pagó o pagará; «99 Por definir» es solo para PPD)
  const formas = cat.formasPago.filter(f => f.clave !== '99');
  const forma = texto(op.forma_pago);
  if (!forma) errores.push('Elige la forma de pago');
  else if (forma === '99') errores.push('«Por definir» (99) solo se usa en facturas a crédito (PPD), que todavía no están disponibles: elige la forma real de pago');
  else if (cat.formasPago.length && !cat.formasPago.some(f => f.clave === forma)) errores.push(`La forma de pago ${forma} no está en el catálogo del SAT`);

  // Emisor, serie y lugar de expedición
  const suc = db.prepare('SELECT id, nombre, cp_expedicion FROM sucursales WHERE id = ?').get(lead.sucursal_id);
  const serie = db.prepare("SELECT serie, serie_uid, entorno FROM series_factura WHERE sucursal_id = ? AND tipo_documento = 'factura' AND activo = 1").get(lead.sucursal_id);
  if (!demo && !config.listo) errores.push('La conexión con factura.com no está completa (faltan llaves o datos del emisor): Dirección la revisa en Ajustes → Facturación');
  if (!serie?.serie_uid) errores.push(`La sucursal ${suc?.nombre || ''} no tiene serie de factura: Dirección la asigna en Ajustes → Facturación`.replace('  ', ' '));
  else if (!demo && serie.entorno !== entorno) errores.push(`La serie de la sucursal ${suc?.nombre || ''} es de ${serie.entorno === 'prod' ? 'producción' : 'pruebas'} y la conexión está en ${entorno === 'prod' ? 'producción' : 'pruebas'}: Dirección la vuelve a asignar en Ajustes → Facturación`);
  const lugar = (suc?.cp_expedicion || (demo ? '' : config.emisor.cp) || '').trim();
  if (!lugar && !demo) errores.push('Falta el código postal de expedición (de la sucursal o del emisor)');

  // PUE con saldo: el SAT espera el pago completo a más tardar el día 17 del mes siguiente; si no, se cancela y se sustituye por una PPD.
  // Solo cuentan los cobros CONFIRMADOS (uno «por confirmar», p. ej. el que anota el técnico en campo, todavía no está verificado). Un centavo de
  // diferencia (redondeo del IVA por renglón) no cuenta como saldo.
  const cob = db.prepare('SELECT COALESCE(SUM(CASE WHEN confirmado = 1 THEN monto_cent END), 0) confirmado, COALESCE(SUM(CASE WHEN confirmado = 0 THEN monto_cent END), 0) porConfirmar FROM main.cobros WHERE lead_id = ? AND cancelado = 0').get(lead.id);
  const cobrado = cob.confirmado;
  if (totales && cobrado + 1 < totales.total_cent) {
    confirmar.push(`El cliente todavía debe ${fmt(totales.total_cent - cobrado)}${cob.porConfirmar ? ` (sin contar ${fmt(cob.porConfirmar)} de pagos por confirmar)` : ''}. Esta factura es PUE (pago en una sola exhibición): úsala solo si el cliente paga el total a más tardar el día 17 del mes siguiente. Si pagará después o en partes, lo correcto es una factura a crédito (PPD), que todavía no está disponible.`);
  }
  const enviarCorreo = entorno === 'prod' ? op.enviar_correo !== false : false; // regla 7: en sandbox nunca se manda correo

  const resumen = {
    entorno, prueba: entorno !== 'prod',
    orden: { id: lead.id, folio: require('./sucursales').folio('OS', 'leads', lead.id, lead.created_at), sucursal: suc?.nombre || '' },
    receptor: fiscal ? { id: fiscal.id, rfc: fiscal.rfc, razon_social: fiscal.razon_social, cp: fiscal.cp, regimen: fiscal.regimen, correo: fiscal.correo } : null,
    uso_cfdi: uso, forma_pago: forma, metodo_pago: 'PUE', moneda: 'MXN', serie: serie?.serie || null, lugar_expedicion: lugar || null,
    enviar_correo: enviarCorreo, tasa,
    conceptos: conc.conceptos.map((c, i) => ({ descripcion: c.descripcion, servicio: c.servicio, clave_prod_serv: c.clave_prod_serv, clave_unidad: c.clave_unidad, unidad: c.unidad,
      cantidad: microsATexto(c.cantidad_micros), valor_unitario: microsATexto(c.unitario_micros), importe: microsATexto(c.base_micros), iva: totales ? microsATexto(totales.conceptos[i].iva_micros) : null })),
    subtotal_cent: totales?.subtotal_cent ?? null, iva_cent: totales?.iva_cent ?? null, total_cent: totales?.total_cent ?? null, cobrado_cent: cobrado,
  };
  // Cuerpo para factura.com (falta Receptor.UID y NumOrder: se ponen al timbrar).
  const cuerpo = totales ? {
    TipoDocumento: 'factura', RegimenFiscal: Number(config.emisor.regimen) || undefined,
    Conceptos: conc.conceptos.map((c, i) => conceptoApi(c, totales.conceptos[i].iva_micros, tasa)),
    UsoCFDI: uso, Serie: Number(serie?.serie_uid) || undefined, FormaPago: forma, MetodoPago: 'PUE', Moneda: 'MXN',
    LugarExpedicion: lugar || undefined, EnviarCorreo: enviarCorreo, BorradorSiFalla: '1',
    Comentarios: `Orden de servicio ${resumen.orden.folio}`,
  } : null;
  return { lead, errores: [...new Set(errores)], avisos, confirmar, fiscales, fiscal, uso, formas, resumen, cuerpo, vigente, entorno, totales, serie, conceptos: conc.conceptos };
}

// ---------------- Guardar en la base ----------------
// facturas_log sin datos sensibles (CLAUDE.md): un mensaje del SAT puede traer el RFC del receptor; se tacha.
const sinRfc = t => String(t).replace(/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g, '[RFC]');
const log = (db, f, accion, resultado, mensaje, usuarioId, http = null) => db.prepare('INSERT INTO main.facturas_log (factura_id, lead_id, accion, resultado, http_status, mensaje, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run(f.id, f.lead_id, accion, resultado, http, mensaje == null ? null : sinRfc(mensaje).slice(0, 2000), usuarioId ?? null);
const actualizar = (db, id, campos) => db.prepare(`UPDATE main.facturas SET ${Object.keys(campos).map(k => k + ' = ?').join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`).run(...Object.values(campos), id);
const leer = (db, id) => db.prepare('SELECT * FROM main.facturas WHERE id = ?').get(id);
const errorTexto = e => JSON.stringify({ codigo: e?.codigo || 'interno', mensaje: String(e?.message || 'Error').slice(0, 500), detalles: (e?.detalles || []).slice(0, 10) });

/** Aparta la factura de la orden (o retoma la vigente sin timbrar) con la foto de lo que se va a mandar. Devuelve la fila. */
function reservar(db, p, op, usuarioId) {
  return db.transaction(() => {
    const ya = db.prepare(`SELECT * FROM main.facturas WHERE lead_id = ? AND entorno = ? AND tipo_documento = 'factura' AND estatus IN (${VIGENTES_SQL}) ORDER BY id DESC LIMIT 1`).get(p.lead.id, p.entorno);
    if (ya && ['timbrada', 'cancelacion_solicitada'].includes(ya.estatus)) throw new ErrorFactura('config', 'Esta orden ya tiene factura');
    if (ya?.estatus === 'timbrando') return ya; // primero se averigua qué pasó con el intento anterior
    const foto = { cliente_fiscal_id: p.fiscal.id, receptor_rfc: p.fiscal.rfc, receptor_razon_social: p.fiscal.razon_social, receptor_cp: p.fiscal.cp, receptor_regimen: p.fiscal.regimen,
      uso_cfdi: p.uso, receptor_correo: p.fiscal.correo, metodo_pago: 'PUE', forma_pago: p.resumen.forma_pago, moneda: 'MXN',
      subtotal_cent: p.totales.subtotal_cent, iva_cent: p.totales.iva_cent, total_cent: p.totales.total_cent, conceptos_json: JSON.stringify(p.cuerpo.Conceptos),
      enviar_correo: p.resumen.enviar_correo ? 1 : 0, serie: p.serie.serie };
    if (ya) { actualizar(db, ya.id, foto); return leer(db, ya.id); }
    const id = Number(db.prepare("INSERT INTO main.facturas (lead_id, sucursal_id, tipo_documento, estatus, num_order, entorno, creado_por) VALUES (?, ?, 'factura', 'pendiente', ?, ?, ?)")
      .run(p.lead.id, p.lead.sucursal_id, 'reservando-' + crypto.randomUUID(), p.entorno, usuarioId ?? null).lastInsertRowid);
    actualizar(db, id, { ...foto, num_order: `${p.resumen.orden.folio}-F${id}-${instancia(db)}` });
    return leer(db, id);
  })();
}

// ---------------- Después de timbrar ----------------
const atributo = (xml, nombre) => { const m = new RegExp(`<cfdi:Comprobante\\b[^>]*\\s${nombre}="([^"]*)"`).exec(xml || ''); return m ? m[1] : null; };
/** Totales leídos del XML timbrado (la verdad fiscal). */
function totalesDelXml(xml) {
  const t = atributo(xml, 'Total'), s = atributo(xml, 'SubTotal');
  if (t == null || s == null || !/^\d+(\.\d+)?$/.test(t) || !/^\d+(\.\d+)?$/.test(s)) return null;
  const c = v => Math.round(Number(v) * 100);
  return { subtotal_cent: c(s), total_cent: c(t), iva_cent: c(t) - c(s) };
}
const contenido = r => (r.archivo ? r.archivo : typeof r.datos === 'string' ? Buffer.from(r.datos, 'utf8') : null);

/** Baja el XML (a la base) y el PDF (al disco). Si falla, la factura sigue timbrada: se puede volver a bajar después. */
async function descargarArchivos(db, cliente, f, { dirArchivos, usuarioId, soloXml = false } = {}) {
  const id = f.uuid || f.cfdi_uid, avisos = [];
  if (!f.xml) try {
    const r = await cliente.get(`/v4/cfdi40/${encodeURIComponent(id)}/xml`), b = contenido(r);
    const xml = b ? b.toString('utf8') : '';
    if (!/<cfdi:Comprobante\b/.test(xml)) throw new ErrorFactura('respuesta', 'factura.com no devolvió el XML');
    const campos = { xml }, t = totalesDelXml(xml);
    if (t) {
      if (t.total_cent !== f.total_cent) avisos.push(`El XML timbrado dice ${fmt(t.total_cent)} y el sistema calculó ${fmt(f.total_cent)}: se guarda lo del XML`);
      Object.assign(campos, t);
    }
    db.transaction(() => {
      actualizar(db, f.id, campos); log(db, f, 'descargar_xml', 'ok', null, usuarioId);
      // La cobranza (solo producción) lleva el total del XML, que es la verdad fiscal.
      if (t && f.entorno === 'prod' && f.lead_id && f.estatus === 'timbrada') db.prepare('UPDATE main.leads SET factura_total_cent = ? WHERE id = ? AND factura_folio = ?').run(t.total_cent, f.lead_id, `${f.serie}-${f.folio}`);
    })();
  } catch (e) { avisos.push('No se pudo bajar el XML: ' + e.message); log(db, f, 'descargar_xml', 'error', e.message, usuarioId, e.httpStatus); }
  if (dirArchivos && !soloXml && !f.pdf_path) {
    try {
      const r = await cliente.get(`/v4/cfdi40/${encodeURIComponent(id)}/pdf`), b = contenido(r);
      if (!b || b.subarray(0, 5).toString('latin1') !== '%PDF-') throw new ErrorFactura('respuesta', 'factura.com no devolvió el PDF');
      const rel = path.join('facturas', f.entorno, `${f.id}.pdf`);
      fs.mkdirSync(path.join(dirArchivos, 'facturas', f.entorno), { recursive: true });
      fs.writeFileSync(path.join(dirArchivos, rel), b);
      actualizar(db, f.id, { pdf_path: rel.split(path.sep).join('/') }); log(db, f, 'descargar_pdf', 'ok', null, usuarioId);
    } catch (e) { avisos.push('No se pudo bajar el PDF: ' + e.message); log(db, f, 'descargar_pdf', 'error', e.message, usuarioId, e.httpStatus); }
  }
  return avisos;
}

/** Solo en PRODUCCIÓN: la factura queda en la cobranza de la orden (folio, fecha, total del CFDI y PUE) y en su bitácora. */
function anotarEnOrden(db, f, usuario) {
  if (f.entorno !== 'prod' || !f.lead_id) return;
  const lead = db.prepare('SELECT id, factura_folio FROM main.leads WHERE id = ?').get(f.lead_id);
  if (!lead || (lead.factura_folio && lead.factura_folio !== `${f.serie}-${f.folio}`)) return; // nunca se pisa una factura capturada a mano
  const fecha = String(f.fecha_timbrado || '').slice(0, 10) || null;
  db.prepare("UPDATE main.leads SET factura_folio = ?, factura_fecha = ?, factura_total_cent = ?, factura_metodo = 'PUE' WHERE id = ?").run(`${f.serie}-${f.folio}`, fecha, f.total_cent, lead.id);
  // La bitácora de la orden la ve quien ve su cobranza: solo el folio (que ya ve en «Crédito y factura»), nunca el UUID ni el receptor.
  db.prepare("INSERT INTO main.historial (lead_id, tipo, texto, usuario, origen, area, usuario_id) VALUES (?, 'observacion', ?, ?, 'sistema', 'cxc', ?)")
    .run(lead.id, `Factura ${f.serie}-${f.folio} timbrada (CFDI, ${fmt(f.total_cent)}).`, usuario?.nombre || 'Sistema', usuario?.id ?? null);
}

/**
 * Quedó timbrada: en UNA transacción se marca y (en producción) se anota en la cobranza, antes de cualquier descarga, para que una caída a medio
 * camino no deje la orden sin su folio. El XML y el PDF se bajan después: «descargas» es la promesa (la ruta contesta sin esperarla; el XML y el
 * PDF se pueden volver a bajar desde sus botones).
 */
function quedoTimbrada(db, cliente, f, d, ctx) {
  db.transaction(() => {
    actualizar(db, f.id, { estatus: 'timbrada', cfdi_uid: d.uid || f.cfdi_uid, uuid: d.uuid.toUpperCase(), serie: d.serie || f.serie, folio: d.folio || f.folio,
      fecha_timbrado: d.fecha || null, error_json: null });
    log(db, f, 'timbrar', 'ok', `${d.serie || f.serie || ''}-${d.folio || ''} ${d.uuid}`, ctx.usuario?.id);
    anotarEnOrden(db, leer(db, f.id), ctx.usuario);
  })();
  const descargas = cliente ? descargarArchivos(db, cliente, leer(db, f.id), { dirArchivos: ctx.dirArchivos, usuarioId: ctx.usuario?.id }).catch(e => ['No se pudieron bajar los archivos: ' + e.message]) : Promise.resolve([]);
  return { estado: 'timbrada', factura: leer(db, f.id), avisos: [], descargas };
}
function quedoBorrador(db, f, e, borrador, ctx) {
  actualizar(db, f.id, { estatus: 'borrador_error', cfdi_uid: borrador.uid, serie: borrador.serie || f.serie, folio: borrador.folio || f.folio, error_json: errorTexto(e) });
  log(db, f, 'timbrar', 'error', 'Quedó en borrador: ' + e.message, ctx.usuario?.id, e.httpStatus);
  return { estado: 'borrador_error', factura: leer(db, f.id), mensaje: e.message };
}

/**
 * Busca en factura.com la factura por su NumOrder. Devuelve null si no existe; si existe, la deja como quedó allá (timbrada o borrador).
 * Se usa antes de volver a mandar una factura cuyo intento anterior no tuvo respuesta.
 */
async function verificar(db, cliente, f, ctx = {}) {
  let r;
  try { r = await cliente.get('/v4/cfdi/order/' + encodeURIComponent(f.num_order)); }
  catch (e) {
    // «No existe» SOLO si factura.com lo dijo explícitamente con el mensaje de la doc (buscar-cfdi). Un 404 en HTML, un 5xx o «La serie no existe» NO
    // prueban que la factura no exista: se lanza el error y la factura sigue como estaba (nunca se reenvía por una respuesta dudosa).
    if (e instanceof ErrorFactura && e.codigo === 'api' && e.rechazo && /no se encontr[oó] (el )?cfdi/i.test(e.message)) return null;
    throw e;
  }
  const d = Array.isArray(r.datos) ? r.datos.find(x => String(x?.NumOrder ?? '') === f.num_order) : r.datos;
  if (!d || typeof d !== 'object' || (d.NumOrder != null && String(d.NumOrder) !== f.num_order)) {
    if (Array.isArray(r.datos) && !r.datos.length) return null;
    throw new ErrorFactura('respuesta', 'factura.com contestó algo inesperado al buscar la factura por su número de orden: no se volvió a mandar. Revisa en el panel de factura.com.');
  }
  const uid = String(d.UID ?? d.uid ?? '').trim(), uuid = String(d.UUID ?? '').trim(), folioTxt = String(d.Folio ?? '').trim();
  if (!UUID_SAT.test(uuid) && !/^[A-Za-z0-9-]{1,64}$/.test(uid)) throw new ErrorFactura('respuesta', 'factura.com encontró la factura pero sin identificador: no se volvió a mandar. Revisa en el panel de factura.com.');
  // Sandbox da el folio como «F 1» (serie, espacio, número; visto el 2026-10-28): se quita la serie y lo que la separe.
  const folio = f.serie && folioTxt.toUpperCase().startsWith(String(f.serie).toUpperCase()) ? folioTxt.slice(String(f.serie).length).replace(/^[\s-]+/, '') : folioTxt;
  log(db, f, 'verificar', 'ok', `Encontrada: ${folioTxt} ${uuid}`, ctx.usuario?.id);
  // Regla 13: «cancelada» solo con el estatus exacto; cualquier otro que hable de cancelación queda «en proceso» (cancelacion_solicitada).
  const status = String(d.Status ?? '').trim();
  if (/cancel/i.test(status) && UUID_SAT.test(uuid)) {
    const final = /^cancelad[ao]$/i.test(status);
    actualizar(db, f.id, { estatus: final ? 'cancelada' : 'cancelacion_solicitada', cfdi_uid: uid || f.cfdi_uid, uuid: uuid.toUpperCase(), folio, ...(final ? { cancelada_at: horaMexico().replace('T', ' ') } : {}) });
    return { estado: final ? 'cancelada' : 'cancelacion_solicitada', factura: leer(db, f.id) };
  }
  if (UUID_SAT.test(uuid)) return quedoTimbrada(db, cliente, f, { uid, uuid, folio, fecha: d.FechaTimbrado || null }, ctx);
  return quedoBorrador(db, f, new ErrorFactura('api', 'La factura quedó como borrador en factura.com: corrige y vuelve a timbrar'), { uid, folio }, ctx);
}

/**
 * Factura «timbrando» (no se supo la respuesta): la busca por NumOrder. Si existe, la deja como quedó allá. Si no existe y ya pasó el minuto de espera,
 * la libera («pendiente») para volver a mandarla con el MISMO NumOrder. Si es reciente, pide esperar (factura.com puede tardar en reportarla).
 * Es la ÚNICA puerta para reenviar: la usan el timbrado y el botón «Verificar».
 */
async function resolverSinRespuesta(db, cliente, f, ctx = {}) {
  const r = await verificar(db, cliente, f, ctx);
  if (r) return r;
  const ms = db.prepare("SELECT (julianday('now','localtime') - julianday(updated_at)) * 86400000 AS ms FROM main.facturas WHERE id = ?").get(f.id)?.ms;
  if (!(Number(ms) >= ESPERA_TIMBRANDO_MS)) throw new ErrorFactura('config', 'Esta factura se acaba de mandar y factura.com todavía no la reporta. Espera un minuto y vuelve a intentar.');
  db.transaction(() => { actualizar(db, f.id, { estatus: 'pendiente' }); log(db, f, 'verificar', 'ok', 'No existe en factura.com: se puede volver a mandar con el mismo número de orden', ctx.usuario?.id); })();
  return { estado: 'pendiente', factura: leer(db, f.id), mensaje: 'factura.com no tiene esa factura: no se timbró. Ya puedes volver a timbrarla.' };
}

// ---------------- Timbrar ----------------
/** Simulación del demo: nunca llama a factura.com. El «XML» dice claramente que no es un CFDI. */
function simular(db, f, ctx) {
  const uuid = crypto.randomUUID().toUpperCase();
  const folio = String(db.prepare("SELECT COUNT(*) n FROM main.facturas WHERE entorno = 'demo' AND serie IS ? AND estatus IN ('timbrada', 'cancelacion_solicitada', 'cancelada')").get(f.serie).n + 1);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- DEMOSTRACIÓN: esto NO es un CFDI ni tiene validez fiscal. -->\n<demo Serie="${f.serie || ''}" Folio="${folio}" SubTotal="${(f.subtotal_cent / 100).toFixed(2)}" Total="${(f.total_cent / 100).toFixed(2)}" UUID="${uuid}"/>`;
  actualizar(db, f.id, { estatus: 'timbrada', uuid, folio, fecha_timbrado: horaMexico(), xml, error_json: null, cfdi_uid: 'demo-' + uuid.slice(0, 8) });
  log(db, f, 'timbrar', 'ok', 'Simulada (demo)', ctx.usuario?.id);
  return { estado: 'timbrada', factura: leer(db, f.id), avisos: ['Factura de DEMOSTRACIÓN: no se conectó con factura.com ni tiene validez fiscal'] };
}

/**
 * Timbra la factura de una orden. op como en preparar. ctx: { config, demo, crearCliente, usuario {id, nombre}, dirArchivos }.
 * Devuelve { estado: 'timbrada' | 'borrador_error' | 'pendiente' | 'sin_respuesta' | 'cancelada', factura, avisos?, mensaje? }.
 * Lanza ErrorFactura si no se puede ni intentar (datos incompletos, falta confirmar, cliente repetido en factura.com…).
 */
async function timbrar(db, leadId, op, ctx) {
  const p = preparar(db, leadId, op, ctx);
  if (!p) throw new ErrorFactura('config', 'Orden no encontrada');
  if (p.errores.length) throw Object.assign(new ErrorFactura('config', 'Todavía no se puede timbrar: ' + p.errores.join(' · '), { detalles: p.errores.map(m => ({ campo: '', mensaje: m })) }), { faltan: p.errores });
  if (p.confirmar.length && !op.confirmar) throw Object.assign(new ErrorFactura('config', p.confirmar.join(' ')), { confirmar: p.confirmar });
  let f = reservar(db, p, op, ctx.usuario?.id);
  if (ctx.demo) return simular(db, f, ctx);
  const cliente = ctx.crearCliente();
  // 1) Un intento anterior sin respuesta: primero se averigua si sí se timbró (regla 15). Nunca se manda dos veces a ciegas.
  if (f.estatus === 'timbrando') {
    const r = await resolverSinRespuesta(db, cliente, f, ctx);
    if (r.estado !== 'pendiente') return r;
    f = reservar(db, p, op, ctx.usuario?.id); // con la foto de lo que se mandará ahora
  }
  // 2) El receptor en factura.com (se da de alta o se actualiza con lo de la ficha; el UID guardado manda).
  let sinc;
  try { sinc = await sincronizarCliente(cliente, db, p.fiscal.id); }
  catch (e) { actualizar(db, f.id, { error_json: errorTexto(e) }); log(db, f, 'cliente', 'error', e.message, ctx.usuario?.id, e.httpStatus); throw e; }
  if (sinc.estado === 'existe') {
    const e = Object.assign(new ErrorFactura('config', `Ya hay ${sinc.candidatos.length === 1 ? 'un cliente' : sinc.candidatos.length + ' clientes'} con el RFC ${p.fiscal.rfc} en factura.com: elige cuál es para no duplicarlo.`), { candidatos: sinc.candidatos, cliente_fiscal_id: p.fiscal.id });
    actualizar(db, f.id, { error_json: errorTexto(e) });
    throw e;
  }
  const cuerpo = { Receptor: { UID: sinc.uid }, ...p.cuerpo, NumOrder: f.num_order };
  // 3) Se marca «timbrando» ANTES de mandar: si el proceso se cae o no hay respuesta, el siguiente intento verifica primero.
  actualizar(db, f.id, { estatus: 'timbrando', error_json: null });
  log(db, f, 'timbrar', 'ok', 'Enviada a factura.com' + (f.cfdi_uid ? ' (borrador ' + f.cfdi_uid + ')' : ''), ctx.usuario?.id);
  try {
    let r;
    if (f.cfdi_uid) {
      // Ya hay un borrador (falló antes): se reemplaza con lo corregido y se timbra, conservando su folio.
      await cliente.post(`/v4/cfdi40/create/${encodeURIComponent(f.cfdi_uid)}`, { ...cuerpo, Draft: '1', BorradorSiFalla: undefined });
      r = await cliente.post(`/v4/cfdi40/${encodeURIComponent(f.cfdi_uid)}/timbrarborrador`);
    } else r = await cliente.post('/v4/cfdi40/create', cuerpo);
    const c = r.crudo || {}, uuid = String(c.UUID ?? c.SAT?.UUID ?? '').trim();
    if (!UUID_SAT.test(uuid)) {
      // Respuesta «exitosa» sin folio fiscal: no se sabe si se timbró. Se queda «timbrando» y el siguiente intento verifica por NumOrder.
      log(db, f, 'timbrar', 'error', 'Respuesta sin UUID', ctx.usuario?.id, r.http);
      actualizar(db, f.id, { error_json: errorTexto(new ErrorFactura('respuesta', 'factura.com contestó sin folio fiscal (UUID)')) });
      return { estado: 'sin_respuesta', factura: leer(db, f.id), mensaje: 'factura.com contestó sin folio fiscal. Pulsa «Verificar» en un minuto para saber si quedó timbrada.' };
    }
    return await quedoTimbrada(db, cliente, f, { uid: String(c.uid ?? c.invoice_uid ?? '').trim() || null, uuid, serie: c.INV?.Serie ? String(c.INV.Serie) : null, folio: c.INV?.Folio != null ? String(c.INV.Folio) : null, fecha: c.SAT?.FechaTimbrado || null }, ctx);
  } catch (e) {
    if (!(e instanceof ErrorFactura)) throw e;
    if (e.codigo === 'api' && e.rechazo) {
      if (e.ids?.borrador?.uid) return quedoBorrador(db, f, e, e.ids.borrador, ctx);
      if (f.cfdi_uid) return quedoBorrador(db, f, e, { uid: f.cfdi_uid }, ctx); // falló al corregir o timbrar el borrador: sigue siendo borrador
      if (/ya existe un cfdi/i.test(e.message)) {
        // Puede ser esta misma factura (se mandó dos veces): se busca por NumOrder. Si no es nuestra, no se duplica nada.
        const v = await verificar(db, cliente, f, ctx).catch(() => null);
        if (v) return v;
      }
      // Rechazada sin borrador: no se creó nada en factura.com. Queda «pendiente» con el motivo, para corregir y volver a mandar.
      actualizar(db, f.id, { estatus: 'pendiente', error_json: errorTexto(e) });
      log(db, f, 'timbrar', 'error', e.message, ctx.usuario?.id, e.httpStatus);
      return { estado: 'pendiente', factura: leer(db, f.id), mensaje: e.message, detalles: e.detalles };
    }
    // Sin respuesta clara (tiempo, red, un 5xx, una página HTML o algo ilegible): NO se sabe si se timbró. Se queda «timbrando»; «Verificar» (o el
    // siguiente intento) la busca por NumOrder antes de cualquier reenvío.
    actualizar(db, f.id, { error_json: errorTexto(e) });
    log(db, f, 'timbrar', 'error', e.message, ctx.usuario?.id, e.httpStatus);
    return { estado: 'sin_respuesta', factura: leer(db, f.id), mensaje: e.message + ' Pulsa «Verificar» para saber si quedó timbrada (no se manda otra vez sin revisar).' };
  }
}

/** Lo que ve la pantalla de una factura (sin el XML). */
function vistaFactura(f) {
  let error = null; try { error = f.error_json ? JSON.parse(f.error_json).mensaje : null; } catch { /* */ }
  return { id: f.id, lead_id: f.lead_id, entorno: f.entorno, estatus: f.estatus, serie: f.serie, folio: f.folio, uuid: f.uuid, fecha_timbrado: f.fecha_timbrado,
    receptor_rfc: f.receptor_rfc, receptor_razon_social: f.receptor_razon_social, uso_cfdi: f.uso_cfdi, metodo_pago: f.metodo_pago, forma_pago: f.forma_pago,
    subtotal: f.subtotal_cent / 100, iva: f.iva_cent / 100, total: f.total_cent / 100, tiene_xml: !!f.xml, tiene_pdf: !!f.pdf_path, borrador: f.estatus === 'borrador_error' && !!f.cfdi_uid,
    error, created_at: f.created_at, updated_at: f.updated_at };
}

module.exports = { preparar, timbrar, verificar, resolverSinRespuesta, descargarArchivos, vistaFactura, conceptosDeOrden, totalesDelXml, instancia, UUID_SAT };
