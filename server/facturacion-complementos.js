/* Facturación CFDI 4.0 · F6 (2026-11-03): complemento de pago (CFDI de tipo «pago», versión 2.0) de cada cobro de una factura a crédito (PPD).
   Documentación leída antes de programar (regla 7): apidocs complementos-de-pago y crear-cfdi-40.
     POST /v4/cfdi40/create con TipoCfdi «pago», UsoCFDI CP01, Moneda XXX, UN concepto (84111506 · ACT · «Pago» · valor 0) y Pagos[]:
       { FechaPago, FormaDePagoP (nunca 99), MonedaP, TipoCambioP, Monto, NumOperacion?, DoctoRelacionado[]: { IdDocumento (UUID de la factura),
         Serie, Folio, MonedaDR, EquivalenciaDR, NumParcialidad, ImpSaldoAnt, ImpPagado, ImpSaldoInsoluto, ObjetoImpuesto, Impuestos { Traslados, Retenidos } } }
     La serie (numérica) tiene que ser de tipo «pago». La doc dice que los importes, impuestos y redondeos los calcula quien manda (aquí, con enteros).
     La tabla de la doc llama «TasaCuota» a la tasa, pero sus ejemplos usan «TasaOCuota» (como el CFDI): se usa la de los ejemplos.
   Decisiones del usuario (2026-11-03):
   · Nada se timbra solo: al confirmar un cobro de una orden con factura PPD aparece «Complemento pendiente» (Inicio y la orden) y alguien con permiso de
     timbrar lo revisa y lo pulsa. Plazo del SAT: a más tardar el día 5 del mes siguiente al pago.
   · Forma de pago sugerida según cómo pagó el cliente: transferencia 03, efectivo 01, cheque 02. Tarjeta (04 crédito o 28 débito), depósito (01 efectivo o
     03 transferencia) y «otro» se preguntan. Siempre se puede cambiar antes de timbrar. Las claves se revisan contra el catálogo del SAT bajado de la API.
   · Un complemento por cobro. Las parcialidades van en orden (fecha del pago): primero el pago más antiguo.
   · Los ajustes o descuentos no son pagos: no llevan complemento (lo que corresponda es una nota de crédito, fuera de la F6).
   · Los pagos de antes de la factura también llevan complemento (cada pago de una factura PPD lo necesita); al timbrar la PPD se avisa.
   Reglas (CLAUDE.md) que se aplican igual que en la factura: «timbrando» antes de mandar, verificar por NumOrder antes de reenviar, borrador si falla,
   un complemento de prueba nunca toca la orden real, y nada se borra.
   Corregir un complemento (decisión del usuario, 2026-11-03; doc complementos-de-pago, nodo CfdiRelacionados):
   · El pago SÍ ocurrió y el complemento salió con un dato mal → «Corregir»: se timbra uno nuevo relacionado con el anterior (TipoRelacion 04, Sustitución),
     con la misma parcialidad y los mismos saldos, y después se cancela el anterior con el motivo 01. El pago nunca queda sin complemento.
   · El pago NO debió registrarse (cheque rebotado, pago duplicado) → se cancela el complemento con el motivo 02, sin reemplazo, y luego el pago en Finanzas.
   Mientras el nuevo no se timbra, factura_cobros sigue apuntando al anterior; al timbrarse, apunta al nuevo (enlazarSustituto, en el timbrado). */
const crypto = require('crypto');
const { ErrorFactura } = require('./facturacom');
const { centavosAMicros, microsATexto, ivaMicros } = require('./facturacion-validaciones');
const { leerCatalogos } = require('./facturacion-catalogos');
const { sincronizarCliente } = require('./facturacion-clientes');
const { log, actualizar, leer, errorTexto, enviarCfdi, simular, resolverSinRespuesta, instancia, UUID_SAT } = require('./facturacion-timbrado');

// Cómo pagó el cliente (cobros.metodo) → forma de pago del SAT. Solo los casos sin duda; los demás se preguntan con sus opciones.
const FORMA_SUGERIDA = { transferencia: '03', efectivo: '01', cheque: '02' };
const OPCIONES_DUDOSAS = { tarjeta: ['04', '28'], deposito: ['01', '03'] };
// Concepto único del CFDI de pago, como lo fija el SAT para el complemento de pago 2.0 (y como viene en el ejemplo de la doc de factura.com).
const CONCEPTO_PAGO = { ClaveProdServ: '84111506', Cantidad: 1, ClaveUnidad: 'ACT', Descripcion: 'Pago', ValorUnitario: 0, Importe: 0, ObjetoImp: '01' };
// Un complemento en estos estados ya ampara su pago (o no se sabe todavía): no se timbra otro para el mismo cobro.
const AMPARA = ['timbrada', 'cancelacion_solicitada'];
const OCUPA = ['timbrada', 'cancelacion_solicitada', 'timbrando', 'borrador_error'];
const lista = a => a.map(x => `'${x}'`).join(', ');
const MICROS = 1000000n;
const redondeo = (a, b) => (2n * a + b) / (2n * b); // a ≥ 0, mitad hacia arriba
const fmt = cent => '$' + (cent / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pesos = cent => (cent / 100).toFixed(2);
const texto = v => String(v ?? '').replace(/[\u0000-\u001f\u007f|]+/g, ' ').replace(/\s+/g, ' ').trim();
const hoyMexico = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City' }).format(new Date());
const folioDe = f => `${f.serie || ''}-${f.folio || ''}`;

/** Fecha límite del SAT para el complemento de un pago: el día 5 del mes siguiente. */
function fechaLimite(fechaPago) {
  const [a, m] = String(fechaPago).split('-').map(Number);
  const sig = m === 12 ? [a + 1, 1] : [a, m + 1];
  return `${sig[0]}-${String(sig[1]).padStart(2, '0')}-05`;
}

/** Fecha y hora del pago: a mediodía (no se sabe la hora); si el pago es de hoy y aún no es mediodía, la hora actual (nunca en el futuro). */
function fechaPago(fecha) {
  const ahora = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date()).replace(' ', 'T');
  const mediodia = `${fecha}T12:00:00`;
  return mediodia > ahora ? ahora : mediodia;
}

/** La tasa de IVA de la factura (de lo que se mandó a timbrar). Todas sus partidas llevan la misma (el timbrado lo exige). */
function tasaDe(factura, lead) {
  try {
    const t = JSON.parse(factura.conceptos_json || '[]')?.[0]?.Impuestos?.Traslados?.[0]?.TasaOCuota;
    if (t != null && Number.isFinite(Number(t))) return Math.round(Number(t) * 100);
  } catch { /* se usa la de la orden */ }
  return Number(lead?.iva_tasa) || 0;
}

/** La factura PPD timbrada de la orden en este entorno, o el motivo por el que no se puede usar. */
function facturaPpd(db, leadId, entorno) {
  const vigentes = db.prepare(`SELECT * FROM main.facturas WHERE lead_id = ? AND entorno = ? AND tipo_documento = 'factura' AND estatus IN ('timbrada', 'cancelacion_solicitada') ORDER BY id DESC`).all(leadId, entorno);
  if (!vigentes.length) return { error: 'Esta orden no tiene factura a crédito (PPD) timbrada' + (entorno === 'prod' ? '' : ' en pruebas') };
  if (vigentes.length > 1) return { error: 'La orden tiene dos facturas vigentes (una ya sustituida): primero termina la cancelación de la original' };
  const f = vigentes[0];
  if (f.metodo_pago !== 'PPD') return { error: `La factura ${folioDe(f)} es PUE (pago en una sola exhibición): no lleva complemento de pago` };
  if (f.estatus !== 'timbrada') return { error: `La factura ${folioDe(f)} está en proceso de cancelación` };
  if (!UUID_SAT.test(String(f.uuid || ''))) return { error: `La factura ${folioDe(f)} no tiene folio fiscal` };
  return { factura: f };
}

/** Cobros que pagan una factura (confirmados, no cancelados, sin ajustes), del más antiguo al más reciente, con su complemento (si tiene). */
function pagosDe(db, factura) {
  return db.prepare(`SELECT k.*, fc.complemento_id, fc.num_parcialidad, fc.saldo_anterior_cent, fc.importe_pagado_cent, fc.saldo_insoluto_cent,
      c.estatus AS complemento_estatus, c.serie AS complemento_serie, c.folio AS complemento_folio, c.uuid AS complemento_uuid
    FROM main.cobros k
    LEFT JOIN main.factura_cobros fc ON fc.cobro_id = k.id AND fc.factura_id = ?
    LEFT JOIN main.facturas c ON c.id = fc.complemento_id
    WHERE k.lead_id = ? AND k.cancelado = 0 AND k.confirmado = 1 AND k.tipo <> 'ajuste'
    ORDER BY k.fecha, k.id`).all(factura.id, factura.lead_id);
}
const amparado = k => AMPARA.includes(k.complemento_estatus);

/** Los complementos ligados por sustitución con estos (hacia atrás y hacia adelante): el anterior y su corrección son del mismo pago. */
function enCadena(db, ids) {
  const vistos = new Set(ids.filter(Boolean).map(Number)), cola = [...vistos];
  while (cola.length) {
    const id = cola.pop();
    const vecinos = [leer(db, id)?.sustituye_a, ...db.prepare("SELECT id FROM main.facturas WHERE sustituye_a = ? AND tipo_documento = 'pago'").all(id).map(r => r.id)];
    for (const v of vecinos) if (v && !vistos.has(v)) { vistos.add(v); cola.push(v); }
  }
  return [...vistos];
}
/** Otro complemento de la misma cadena que todavía ampara el pago (p. ej. el anterior, si se canceló su corrección): entonces no se timbra uno nuevo. */
const amparaPago = (db, c) => c && !AMPARA.includes(c.estatus) ? complementosEn(db, enCadena(db, [c.id]), `AND id <> ${Number(c.id)} AND estatus IN (${lista(AMPARA)}) ORDER BY id DESC`)[0] || null : null;
const complementosEn = (db, ids, extra = '') => ids.length ? db.prepare(`SELECT * FROM main.facturas WHERE id IN (${ids.map(Number).join(', ')}) AND estatus IN (${lista(OCUPA)}) ${extra}`).all() : [];
/** La corrección (sustituto) más reciente de un complemento, si se empezó y no se canceló. */
const sustitutoDe = (db, id) => db.prepare(`SELECT * FROM main.facturas WHERE sustituye_a = ? AND tipo_documento = 'pago' AND estatus IN ('pendiente', ${lista(OCUPA)}) ORDER BY id DESC LIMIT 1`).get(id) || null;

// ---------------- Preparar: revisa TODO sin llamar a nadie ----------------
/**
 * El complemento de un cobro y lo que falta. op: { forma_pago?, confirmar?, sustituye_a? (el complemento timbrado que se corrige) }. ctx: { config, demo }.
 * Devuelve null si el cobro no existe; si no { cobro, lead, factura, entorno, errores, avisos, confirmar, formas, sugerida, opciones, resumen, cuerpo, fiscal, serie, calculo, complemento, original }.
 */
function prepararComplemento(db, cobroId, op = {}, { config, demo = false } = {}) {
  const errores = [], avisos = [], confirmar = [];
  const entorno = demo ? 'demo' : config.entorno;
  const cobro = db.prepare('SELECT * FROM main.cobros WHERE id = ?').get(Number(cobroId));
  if (!cobro) return null;
  const lead = db.prepare('SELECT * FROM main.leads WHERE id = ?').get(cobro.lead_id);
  if (cobro.cancelado) errores.push('Este pago está cancelado: no lleva complemento');
  else if (!cobro.confirmado) errores.push('Este pago todavía no está confirmado: primero lo confirma otra persona');
  if (cobro.tipo === 'ajuste') errores.push('Un ajuste o descuento no es un pago: no lleva complemento (si hace falta, lo que corresponde es una nota de crédito)');
  const { factura, error } = facturaPpd(db, cobro.lead_id, entorno);
  if (error) errores.push(error);

  // El complemento de este pago (si ya se empezó) y los demás pagos de la factura.
  const fc = factura ? db.prepare('SELECT * FROM main.factura_cobros WHERE cobro_id = ? AND factura_id = ?').get(cobro.id, factura.id) : null;
  const complemento = fc?.complemento_id ? leer(db, fc.complemento_id) : null;
  // Corrección (sustitución): el complemento que se corrige tiene que ser el vigente de este pago.
  const sustId = Number(op.sustituye_a) || 0;
  const original = sustId ? leer(db, sustId) : null;
  const sustituto = original ? sustitutoDe(db, original.id) : null;
  if (sustId) {
    const previo = original?.sustituye_a ? leer(db, original.sustituye_a) : null;
    if (sustituto && AMPARA.includes(sustituto.estatus)) errores.push(`Ya se timbró el complemento que corrige al ${folioDe(original)} (${folioDe(sustituto)}): solo falta cancelar el anterior con el motivo 01`);
    else if (previo && AMPARA.includes(previo.estatus)) errores.push(`El ${folioDe(original)} corrige al ${folioDe(previo)}, que sigue vigente: primero termina de cancelar el ${folioDe(previo)} con el motivo 01`);
    else if (!original || original.tipo_documento !== 'pago' || original.estatus !== 'timbrada' || original.entorno !== entorno || complemento?.id !== original.id || !UUID_SAT.test(String(original.uuid || '')))
      errores.push('El complemento que se quiere corregir no es el vigente de este pago (o es de otro entorno)');
  } else if (amparaPago(db, complemento)) errores.push(`Este pago ya tiene su complemento ${folioDe(amparaPago(db, complemento))} vigente`);
  else if (complemento && AMPARA.includes(complemento.estatus)) errores.push(`Este pago ya tiene su complemento ${folioDe(complemento)}${complemento.estatus === 'cancelacion_solicitada' ? ' (en proceso de cancelación)' : ''}`);
  let calculo = null;
  if (factura) {
    const pagos = pagosDe(db, factura);
    const otroSinRespuesta = pagos.find(k => k.id !== cobro.id && k.complemento_estatus === 'timbrando');
    if (otroSinRespuesta) errores.push(`El complemento del pago del ${otroSinRespuesta.fecha} se quedó sin respuesta de factura.com: primero pulsa «Verificar» en ese`);
    // Mientras otro complemento de esta factura está en cancelación, no se sabe si sus saldos siguen contando: se espera a que el SAT lo confirme.
    const enCancelacion = pagos.find(k => k.id !== cobro.id && k.complemento_estatus === 'cancelacion_solicitada');
    if (enCancelacion) errores.push(`El complemento ${enCancelacion.complemento_serie || ''}-${enCancelacion.complemento_folio || ''} de esta factura está en proceso de cancelación: espera a que el SAT la confirme`);
    // Las parcialidades van en orden: primero el pago más antiguo que todavía no tiene complemento.
    const anterior = pagos.find(k => k.id !== cobro.id && !amparado(k) && (k.fecha < cobro.fecha || (k.fecha === cobro.fecha && k.id < cobro.id)));
    if (anterior && !cobro.cancelado && cobro.confirmado && !original) errores.push(`Primero timbra el complemento del pago del ${anterior.fecha} (${fmt(anterior.monto_cent)}): las parcialidades van en orden`);
    // Lo ya amparado por otros complementos vigentes de esta factura. Una corrección conserva la parcialidad y los saldos del complemento que corrige.
    const previos = pagos.filter(k => k.id !== cobro.id && amparado(k));
    const pagadoAntes = previos.reduce((t, k) => t + k.importe_pagado_cent, 0);
    const pagado = cobro.monto_cent;
    const saldoAnt = original && fc ? fc.saldo_anterior_cent : factura.total_cent - pagadoAntes;
    if (original && fc && fc.importe_pagado_cent !== pagado) errores.push(`El monto del pago cambió desde que se timbró el complemento ${folioDe(original)}: corregirlo rompería los saldos. Cancélalo con el motivo 02 y timbra otro`);
    if (pagado > saldoAnt) errores.push(`El pago (${fmt(pagado)}) es mayor que lo que falta de la factura ${folioDe(factura)} (${fmt(saldoAnt)}): revisa los pagos de la orden`);
    // IVA del pago, en proporción: base = pagado × 100 / (100 + tasa) y su IVA, a 6 decimales (enteros, sin flotantes).
    const tasa = tasaDe(factura, lead);
    if (!tasa && factura.iva_cent) errores.push('No se pudo saber la tasa de IVA de la factura');
    const pagadoM = centavosAMicros(pagado), baseM = redondeo(pagadoM * 100n, BigInt(100 + tasa)), ivaM = ivaMicros(baseM, tasa);
    calculo = { num_parcialidad: original && fc ? fc.num_parcialidad : previos.length + 1, saldo_anterior_cent: saldoAnt, importe_pagado_cent: pagado, saldo_insoluto_cent: Math.max(saldoAnt - pagado, 0), tasa, base_micros: baseM, iva_micros: ivaM };
  }
  if (lead?.estatus !== 'ganado') errores.push('El pago no es de una orden de servicio');

  // Forma de pago: la sugerida según cómo pagó, o la que se eligió. Nunca 99 (la doc lo prohíbe en el complemento).
  const cat = leerCatalogos(db);
  const formas = cat.formasPago.filter(f => f.clave !== '99');
  const sugerida = FORMA_SUGERIDA[cobro.metodo] || null;
  const opciones = OPCIONES_DUDOSAS[cobro.metodo] || null;
  const forma = texto(op.forma_pago) || sugerida || '';
  if (!cat.formasPago.length) errores.push('Faltan los catálogos del SAT: Dirección los actualiza en Ajustes → Facturación');
  else if (!forma) errores.push(opciones ? `Elige la forma de pago: el cliente pagó con ${cobro.metodo === 'tarjeta' ? 'tarjeta (04 crédito o 28 débito)' : 'depósito (01 en efectivo o 03 por transferencia)'}` : 'Elige la forma de pago');
  else if (forma === '99') errores.push('«Por definir» (99) no se usa en un complemento de pago: elige cómo pagó el cliente');
  else if (!formas.some(f => f.clave === forma)) errores.push(`La forma de pago ${forma} no está en el catálogo del SAT`);

  // Receptor: el mismo de la factura (su foto); sus datos fiscales tienen que seguir siendo del mismo RFC.
  const fiscal = factura?.cliente_fiscal_id ? db.prepare('SELECT * FROM main.clientes_fiscales WHERE id = ?').get(factura.cliente_fiscal_id) : null;
  if (factura && !fiscal) errores.push('No se encontraron los datos fiscales con los que se timbró la factura');
  else if (fiscal && fiscal.rfc !== factura.receptor_rfc) errores.push(`Los datos fiscales del cliente ya no son del RFC de la factura (${factura.receptor_rfc}): el complemento va al mismo RFC de la factura`);

  // Emisor, serie de pagos y lugar de expedición
  const suc = lead ? db.prepare('SELECT id, nombre, cp_expedicion FROM sucursales WHERE id = ?').get(lead.sucursal_id) : null;
  const serie = lead ? db.prepare("SELECT serie, serie_uid, entorno FROM series_factura WHERE sucursal_id = ? AND tipo_documento = 'pago' AND activo = 1").get(lead.sucursal_id) : null;
  if (!demo && !config.listo) errores.push('La conexión con factura.com no está completa (faltan llaves o datos del emisor): Dirección la revisa en Ajustes → Facturación');
  if (!serie?.serie_uid) errores.push(`La sucursal ${suc?.nombre || ''} no tiene serie de pagos: Dirección la asigna o la crea en Ajustes → Facturación`.replace('  ', ' '));
  else if (!demo && serie.entorno !== entorno) errores.push(`La serie de pagos de la sucursal ${suc?.nombre || ''} es de ${serie.entorno === 'prod' ? 'producción' : 'pruebas'} y la conexión está en ${entorno === 'prod' ? 'producción' : 'pruebas'}: Dirección la vuelve a asignar en Ajustes → Facturación`);
  const lugar = (suc?.cp_expedicion || (demo ? '' : config.emisor.cp) || '').trim();
  if (!lugar && !demo) errores.push('Falta el código postal de expedición (de la sucursal o del emisor)');

  const limite = fechaLimite(cobro.fecha);
  if (hoyMexico() > limite) avisos.push(`Ya pasó la fecha límite del SAT para este complemento (${limite}): tímbralo cuanto antes`);
  if (factura && cobro.fecha < String(factura.fecha_timbrado || '').slice(0, 10)) avisos.push(`Este pago (${cobro.fecha}) es de antes de la factura: con PPD también lleva su complemento`);
  if (forma && sugerida && forma !== sugerida) confirmar.push(`El pago se registró como «${cobro.metodo}» y elegiste la forma ${forma}. ¿Es correcto?`);
  const enviarCorreo = entorno === 'prod' ? op.enviar_correo !== false : false; // regla 7: en sandbox nunca se manda correo
  const numOperacion = texto(cobro.referencia).slice(0, 100);

  const resumen = {
    entorno, prueba: entorno !== 'prod',
    cobro: { id: cobro.id, fecha: cobro.fecha, monto_cent: cobro.monto_cent, metodo: cobro.metodo, referencia: cobro.referencia || null },
    factura: factura ? { id: factura.id, serie: factura.serie, folio: factura.folio, uuid: factura.uuid, total_cent: factura.total_cent } : null,
    receptor: factura ? { rfc: factura.receptor_rfc, razon_social: factura.receptor_razon_social } : null,
    sustituye: original ? { id: original.id, serie: original.serie, folio: original.folio, forma_pago: original.forma_pago } : null,
    forma_pago: forma || null, forma_sugerida: sugerida, opciones, serie: serie?.serie || null, lugar_expedicion: lugar || null, enviar_correo: enviarCorreo, fecha_limite: limite,
    ...(calculo ? { num_parcialidad: calculo.num_parcialidad, saldo_anterior_cent: calculo.saldo_anterior_cent, importe_pagado_cent: calculo.importe_pagado_cent,
      saldo_insoluto_cent: calculo.saldo_insoluto_cent, base: microsATexto(calculo.base_micros), iva: microsATexto(calculo.iva_micros), tasa: calculo.tasa } : {}),
  };
  // Cuerpo para factura.com (falta Receptor.UID y NumOrder: se ponen al timbrar). Importes del documento a 2 decimales; impuestos a 6.
  const cuerpo = factura && calculo ? {
    TipoCfdi: 'pago', RegimenFiscal: Number(config?.emisor?.regimen) || undefined, EnviarCorreo: enviarCorreo, Serie: Number(serie?.serie_uid) || undefined,
    LugarExpedicion: lugar || undefined, UsoCFDI: 'CP01', Moneda: 'XXX', BorradorSiFalla: '1',
    ...(original ? { CfdiRelacionados: { TipoRelacion: '04', UUID: [String(original.uuid).toUpperCase()] } } : {}),
    Conceptos: [CONCEPTO_PAGO],
    Pagos: [{
      FechaPago: fechaPago(cobro.fecha), FormaDePagoP: forma, MonedaP: 'MXN', TipoCambioP: '1', Monto: pesos(calculo.importe_pagado_cent),
      ...(numOperacion ? { NumOperacion: numOperacion } : {}),
      DoctoRelacionado: [{
        IdDocumento: String(factura.uuid).toUpperCase(), Serie: factura.serie || undefined, Folio: factura.folio || undefined, MonedaDR: 'MXN', EquivalenciaDR: '1',
        NumParcialidad: String(calculo.num_parcialidad), ImpSaldoAnt: pesos(calculo.saldo_anterior_cent), ImpPagado: pesos(calculo.importe_pagado_cent),
        ImpSaldoInsoluto: pesos(calculo.saldo_insoluto_cent), ObjetoImpuesto: '02',
        Impuestos: { Traslados: [{ Base: microsATexto(calculo.base_micros), Impuesto: '002', TipoFactor: 'Tasa', TasaOCuota: (calculo.tasa / 100).toFixed(6), Importe: microsATexto(calculo.iva_micros) }], Retenidos: [] },
      }],
    }],
  } : null;
  return { cobro, lead, factura, entorno, errores: [...new Set(errores)], avisos, confirmar, formas, sugerida, opciones, resumen, cuerpo, fiscal, serie, calculo, complemento, forma, original: sustId ? original : null };
}

// ---------------- Guardar en la base ----------------
/** Aparta el complemento del cobro (o retoma el que no se timbró) con la foto de lo que se va a mandar, y su renglón en factura_cobros. */
function reservar(db, p, usuarioId) {
  return db.transaction(() => {
    const fc = db.prepare('SELECT * FROM main.factura_cobros WHERE cobro_id = ? AND factura_id = ?').get(p.cobro.id, p.factura.id);
    // Una corrección es su propio CFDI (relacionado con el anterior); el pago sigue apuntando al anterior hasta que la corrección se timbre.
    const ya = p.original ? sustitutoDe(db, p.original.id) : fc?.complemento_id ? leer(db, fc.complemento_id) : null;
    if ((ya && AMPARA.includes(ya.estatus)) || (!p.original && amparaPago(db, ya))) throw new ErrorFactura('config', p.original ? 'Ese complemento ya tiene su corrección timbrada' : 'Este pago ya tiene su complemento de pago');
    if (ya?.estatus === 'timbrando') return ya; // primero se averigua qué pasó con el intento anterior
    const foto = { cliente_fiscal_id: p.fiscal.id, receptor_rfc: p.factura.receptor_rfc, receptor_razon_social: p.factura.receptor_razon_social, receptor_cp: p.factura.receptor_cp,
      receptor_regimen: p.factura.receptor_regimen, uso_cfdi: 'CP01', receptor_correo: p.factura.receptor_correo, metodo_pago: null, forma_pago: p.forma, moneda: 'XXX',
      subtotal_cent: 0, iva_cent: 0, total_cent: 0, conceptos_json: JSON.stringify(p.cuerpo.Pagos), enviar_correo: p.resumen.enviar_correo ? 1 : 0, serie: p.serie.serie };
    const saldos = [p.calculo.num_parcialidad, p.calculo.saldo_anterior_cent, p.calculo.importe_pagado_cent, p.calculo.saldo_insoluto_cent];
    let id;
    if (ya && ['pendiente', 'borrador_error'].includes(ya.estatus)) { id = ya.id; actualizar(db, id, foto); }
    else {
      // Nuevo (o el anterior se canceló): otro CFDI de pago con su propio número de orden.
      id = Number(db.prepare("INSERT INTO main.facturas (lead_id, sucursal_id, tipo_documento, estatus, num_order, entorno, creado_por, sustituye_a) VALUES (?, ?, 'pago', 'pendiente', ?, ?, ?, ?)")
        .run(p.lead.id, p.lead.sucursal_id, 'reservando-' + crypto.randomUUID(), p.entorno, usuarioId ?? null, p.original?.id ?? null).lastInsertRowid);
      const folioOS = require('./sucursales').folio('OS', 'leads', p.lead.id, p.lead.created_at);
      actualizar(db, id, { ...foto, num_order: `${folioOS}-P${id}-${instancia(db)}` });
    }
    if (p.original) return leer(db, id);
    db.prepare(`INSERT INTO main.factura_cobros (factura_id, cobro_id, complemento_id, num_parcialidad, saldo_anterior_cent, importe_pagado_cent, saldo_insoluto_cent) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cobro_id, factura_id) DO UPDATE SET complemento_id = excluded.complemento_id, num_parcialidad = excluded.num_parcialidad, saldo_anterior_cent = excluded.saldo_anterior_cent,
        importe_pagado_cent = excluded.importe_pagado_cent, saldo_insoluto_cent = excluded.saldo_insoluto_cent`).run(p.factura.id, p.cobro.id, id, ...saldos);
    return leer(db, id);
  })();
}

// ---------------- Timbrar ----------------
/**
 * Timbra el complemento de pago de un cobro. op: { forma_pago?, confirmar?, enviar_correo? }. ctx como en el timbrado de la factura.
 * Devuelve { estado, factura (el complemento), avisos?, mensaje?, descargas? }. Lanza ErrorFactura si no se puede ni intentar.
 */
async function timbrarComplemento(db, cobroId, op, ctx) {
  const p = prepararComplemento(db, cobroId, op, ctx);
  if (!p) throw new ErrorFactura('config', 'Pago no encontrado');
  if (p.errores.length) throw Object.assign(new ErrorFactura('config', 'Todavía no se puede timbrar el complemento: ' + p.errores.join(' · '), { detalles: p.errores.map(m => ({ campo: '', mensaje: m })) }), { faltan: p.errores });
  if (p.confirmar.length && !op.confirmar) throw Object.assign(new ErrorFactura('config', p.confirmar.join(' ')), { confirmar: p.confirmar });
  let f = reservar(db, p, ctx.usuario?.id);
  if (ctx.demo) return simular(db, f, ctx);
  const cliente = ctx.crearCliente();
  if (f.estatus === 'timbrando') {
    const r = await resolverSinRespuesta(db, cliente, f, ctx);
    if (r.estado !== 'pendiente') return r;
    f = reservar(db, p, ctx.usuario?.id);
  }
  // El receptor: el mismo cliente de factura.com que recibió la factura (se actualiza con lo de la ficha; el UID guardado manda).
  let sinc;
  try { sinc = await sincronizarCliente(cliente, db, p.fiscal.id); }
  catch (e) { actualizar(db, f.id, { error_json: errorTexto(e) }); log(db, f, 'cliente', 'error', e.message, ctx.usuario?.id, e.httpStatus); throw e; }
  if (sinc.estado === 'existe') {
    const e = Object.assign(new ErrorFactura('config', `Ya hay ${sinc.candidatos.length === 1 ? 'un cliente' : sinc.candidatos.length + ' clientes'} con el RFC ${p.fiscal.rfc} en factura.com: elige cuál es para no duplicarlo.`), { candidatos: sinc.candidatos, cliente_fiscal_id: p.fiscal.id });
    actualizar(db, f.id, { error_json: errorTexto(e) });
    throw e;
  }
  // Mientras se hablaba con factura.com alguien pudo cancelar el cobro (Finanzas no usa el candado de la orden): se revisa justo antes de mandar.
  const ahora = db.prepare('SELECT cancelado, confirmado FROM main.cobros WHERE id = ?').get(p.cobro.id);
  if (!ahora || ahora.cancelado || !ahora.confirmado) throw new ErrorFactura('config', 'El pago se canceló mientras se preparaba el complemento: no se mandó nada a factura.com');
  return enviarCfdi(db, cliente, f, { Receptor: { UID: sinc.uid }, ...p.cuerpo, NumOrder: f.num_order }, ctx);
}

// ---------------- Lo que se ve ----------------
/** Pagos de facturas PPD (de este entorno) que todavía no tienen complemento timbrado, con su fecha límite. leadId: solo los de esa orden. */
function pendientes(db, entorno, { leadId = null } = {}) {
  return db.prepare(`SELECT k.id AS cobro_id, k.lead_id, k.fecha, k.monto_cent, k.metodo, inv.id AS factura_id, inv.serie, inv.folio, inv.receptor_razon_social, inv.created_at AS factura_created_at,
      c.id AS complemento_id, c.estatus AS complemento_estatus
    FROM facturas inv
    JOIN cobros k ON k.lead_id = inv.lead_id AND k.cancelado = 0 AND k.confirmado = 1 AND k.tipo <> 'ajuste'
    LEFT JOIN factura_cobros fc ON fc.cobro_id = k.id AND fc.factura_id = inv.id
    LEFT JOIN facturas c ON c.id = fc.complemento_id
    WHERE inv.entorno = ? AND inv.tipo_documento = 'factura' AND inv.metodo_pago = 'PPD' AND inv.estatus = 'timbrada' ${leadId ? 'AND inv.lead_id = ?' : ''}
      AND (c.id IS NULL OR c.estatus NOT IN (${lista(AMPARA)}))
    ORDER BY k.fecha, k.id`).all(...[entorno, ...(leadId ? [leadId] : [])]).map(r => ({ ...r, fecha_limite: fechaLimite(r.fecha), vencido: hoyMexico() > fechaLimite(r.fecha) }));
}

/** Los pagos de la factura PPD de una orden con el estado de su complemento (para la ficha de la orden). null si la orden no tiene factura PPD timbrada. */
function complementosDeOrden(db, leadId, entorno) {
  const inv = db.prepare(`SELECT * FROM facturas WHERE lead_id = ? AND entorno = ? AND tipo_documento = 'factura' AND metodo_pago = 'PPD' AND estatus IN ('timbrada', 'cancelacion_solicitada') ORDER BY id DESC LIMIT 1`).get(leadId, entorno);
  if (!inv) return null;
  const pagos = pagosDe(db, inv);
  const amparadoCent = pagos.filter(amparado).reduce((t, k) => t + k.importe_pagado_cent, 0);
  return {
    factura: { id: inv.id, serie: inv.serie, folio: inv.folio, total_cent: inv.total_cent, saldo_insoluto_cent: inv.total_cent - amparadoCent },
    pagos: pagos.map(k => ({ cobro_id: k.id, fecha: k.fecha, monto_cent: k.monto_cent, metodo: k.metodo, fecha_limite: fechaLimite(k.fecha), vencido: !amparado(k) && hoyMexico() > fechaLimite(k.fecha),
      complemento: k.complemento_id ? { id: k.complemento_id, estatus: k.complemento_estatus, serie: k.complemento_serie, folio: k.complemento_folio, uuid: k.complemento_uuid, num_parcialidad: k.num_parcialidad } : null,
      amparado: amparado(k), ...correccion(db, k) })),
  };
}
/** Para la tabla de pagos: la corrección en curso del complemento vigente, o el anterior que ya se corrigió y falta cancelar (motivo 01). */
function correccion(db, k) {
  if (!k.complemento_id) return {};
  const s = sustitutoDe(db, k.complemento_id), c = leer(db, k.complemento_id);
  const ant = c?.sustituye_a ? leer(db, c.sustituye_a) : null;
  return {
    correccion: s ? { id: s.id, estatus: s.estatus, serie: s.serie, folio: s.folio } : null,
    corrige_a: ant && AMPARA.includes(ant.estatus) ? { id: ant.id, estatus: ant.estatus, serie: ant.serie, folio: ant.folio } : null,
  };
}

/** ¿El cobro tiene un complemento REAL que lo ampara (o en curso)? Entonces el cobro no se cancela hasta cancelar (o resolver) el complemento.
 *  Uno de pruebas (sandbox) no estorba al cobro real; en el demo sí cuenta, para que se vea igual que en producción. */
function complementoQueBloquea(db, cobroId) {
  const ids = enCadena(db, db.prepare('SELECT complemento_id FROM main.factura_cobros WHERE cobro_id = ?').all(Number(cobroId)).map(r => r.complemento_id));
  return complementosEn(db, ids, "AND entorno IN ('prod', 'demo') ORDER BY id DESC LIMIT 1")[0] || null;
}

/** Complementos vigentes de la misma factura con una parcialidad POSTERIOR: mientras existan, este no se cancela con el motivo 02 (se rompería la cadena
 *  de saldos). Una corrección (motivo 01) conserva los saldos, así que no los toca. */
function complementosPosteriores(db, complementoId) {
  const ids = enCadena(db, [complementoId]);
  const fc = db.prepare(`SELECT factura_id, num_parcialidad FROM main.factura_cobros WHERE complemento_id IN (${ids.map(Number).join(', ')})`).get();
  if (!fc) return [];
  const otros = db.prepare('SELECT complemento_id FROM main.factura_cobros WHERE factura_id = ? AND num_parcialidad > ?').all(fc.factura_id, fc.num_parcialidad).map(r => r.complemento_id);
  return complementosEn(db, enCadena(db, otros), 'ORDER BY id');
}

/** Complementos de una factura que todavía cuentan ante el SAT (o en curso), con sus correcciones y los que corrigen: con ellos el SAT no deja cancelarla. */
function complementosVigentes(db, facturaId) {
  return complementosEn(db, enCadena(db, db.prepare('SELECT complemento_id FROM main.factura_cobros WHERE factura_id = ?').all(Number(facturaId)).map(r => r.complemento_id)), 'ORDER BY id');
}

module.exports = { prepararComplemento, timbrarComplemento, pendientes, complementosDeOrden, complementoQueBloquea, complementosVigentes, complementosPosteriores, fechaLimite, fechaPago, FORMA_SUGERIDA, OPCIONES_DUDOSAS, CONCEPTO_PAGO };
