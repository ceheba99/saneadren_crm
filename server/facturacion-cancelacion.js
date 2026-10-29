/* Facturación CFDI 4.0 · F5 (2026-10-29): cancelación de facturas con factura.com. Documentación leída antes de programar (regla 7):
   apidocs cancelar-cfdi-40, consultar-estatus-cancelacion-cfdi, descargar-acuse-cfdi-40 y catalogos (Relacion).
     POST /v4/cfdi40/{UID o UUID}/cancel  { motivo, folioSustituto }  → respuestaapi.acuse (XML del SAT)
     GET  /v4/cfdi40/{UID o UUID}/cancel_status                      → data { Estado, EsCancelable, EstatusCancelacion, CodigoEstatus }
     GET  /v4/cfdi40/{UID o UUID}/acuse                                → el acuse en XML
   Reglas (CLAUDE.md):
   · (13) Estatus propio: timbrada → cancelacion_solicitada → cancelada. NO se marca cancelada hasta que el SAT lo confirma («Estado: Cancelado»):
     la respuesta de «cancel» solo dice que se recibió la solicitud. Si el receptor la rechaza, vuelve a «timbrada».
   · (14) Nada se borra: la factura se queda con su XML, su acuse y su motivo.
   · Motivo 01 (con errores, CON relación): primero se timbra la factura que la sustituye (relacionada con «Sustitución de los CFDI previos»), y después se
     cancela la original diciendo cuál la sustituye. Motivos 02 (con errores, sin relación) y 03 (no se llevó a cabo la operación) no llevan sustituta.
     Motivo 04 (venta incluida en una factura global) llega con la factura global (F6).
   · Como el timbrado: «cancelacion_solicitada» se guarda ANTES de mandar; si no hay respuesta clara, se queda así y «Consultar estatus» lo resuelve.
     Solo un «no» explícito de factura.com regresa la factura a «timbrada».
   · Solo una factura de PRODUCCIÓN toca la cobranza de la orden: cancelada con 02 o 03, la orden se queda sin folio de factura; con 01, la sustituta
     ya ocupó su lugar al timbrarse. */
const { ErrorFactura } = require('./facturacom');
const { horaMexico, log, actualizar, leer, errorTexto, UUID_SAT } = require('./facturacion-timbrado');

const MOTIVOS = {
  '01': 'Comprobante emitido con errores con relación (se sustituye por otra factura)',
  '02': 'Comprobante emitido con errores sin relación (no se sustituye)',
  '03': 'No se llevó a cabo la operación',
  '04': 'Operación nominativa relacionada en una factura global',
};
const folioDe = f => `${f.serie || ''}-${f.folio || ''}`;
const fmt = cent => '$' + (cent / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esAcuse = t => typeof t === 'string' && /<(\w+:)?Acuse\b/.test(t);

/** Revisa que se pueda pedir la cancelación (sin llamar a nadie). Devuelve { sustituta } o lanza ErrorFactura con el motivo en español. */
const ESPERA_REINTENTO_MIN = 60; // una solicitud sin confirmar se puede volver a pedir después de una hora (repetirla no duplica: el SAT contesta 202)
const minutosDesde = (db, t) => db.prepare("SELECT (julianday('now','localtime') - julianday(?)) * 1440 AS m").get(t)?.m;
function revisar(db, f, { motivo, sustituta_id, reintentar = false } = {}, { config, demo = false } = {}) {
  if (!f) throw new ErrorFactura('config', 'Factura no encontrada');
  if (f.estatus === 'cancelacion_solicitada') {
    if (!reintentar) throw new ErrorFactura('config', 'Ya se pidió cancelar esta factura: consulta su estatus');
    if (!(Number(minutosDesde(db, f.cancelacion_solicitada_at || f.updated_at)) >= ESPERA_REINTENTO_MIN)) throw new ErrorFactura('config', 'La cancelación se pidió hace menos de una hora: primero consulta su estatus');
    motivo = f.motivo_cancelacion; // se repite exactamente la misma solicitud
  } else if (reintentar) throw new ErrorFactura('config', 'Solo se vuelve a pedir una cancelación que sigue en proceso');
  else if (f.estatus !== 'timbrada') throw new ErrorFactura('config', 'Solo se cancela una factura timbrada');
  if (!UUID_SAT.test(String(f.uuid || ''))) throw new ErrorFactura('config', 'Solo se cancela una factura timbrada');
  if (!MOTIVOS[motivo]) throw new ErrorFactura('config', 'Elige el motivo de la cancelación (01, 02 o 03)');
  if (motivo === '04') throw new ErrorFactura('config', 'El motivo 04 es para ventas incluidas en una factura global, que todavía no está disponible');
  const entorno = demo ? 'demo' : config.entorno;
  if (f.entorno !== entorno) throw new ErrorFactura('config', `Esta factura es de ${f.entorno === 'prod' ? 'producción' : f.entorno === 'demo' ? 'demostración' : 'pruebas'} y la conexión está en otro entorno: no se puede cancelar ahora`);
  if (!demo && !config.listo) throw new ErrorFactura('config', 'La conexión con factura.com no está completa: Dirección la revisa en Ajustes → Facturación');
  const sustituta = db.prepare("SELECT * FROM main.facturas WHERE sustituye_a = ? AND estatus = 'timbrada' ORDER BY id DESC LIMIT 1").get(f.id) || null;
  // Una sustituta que todavía no termina (sin respuesta, en borrador o en cancelación) puede quedar timbrada después: primero se resuelve.
  const enCurso = db.prepare("SELECT * FROM main.facturas WHERE sustituye_a = ? AND estatus IN ('timbrando', 'borrador_error', 'cancelacion_solicitada') ORDER BY id DESC LIMIT 1").get(f.id);
  if (enCurso) throw new ErrorFactura('config', `La factura que la sustituye ${enCurso.estatus === 'timbrando' ? 'se quedó sin respuesta' : enCurso.estatus === 'borrador_error' ? 'quedó en borrador' : 'está en cancelación'}: primero verifícala o descártala`);
  // Esta factura respalda la cancelación (motivo 01) de otra que sigue en proceso: si se cancela, aquella quedaría sustituida por una cancelada.
  const respalda = f.sustituye_a ? db.prepare("SELECT serie, folio FROM main.facturas WHERE id = ? AND estatus = 'cancelacion_solicitada' AND folio_sustituto = ?").get(f.sustituye_a, f.uuid) : null;
  if (respalda && !reintentar) throw new ErrorFactura('config', `Esta factura sustituye a la ${folioDe(respalda)}, cuya cancelación sigue en proceso: espera a que el SAT la confirme`);
  if (reintentar) return { sustituta: f.motivo_cancelacion === '01' ? (sustituta || db.prepare('SELECT * FROM main.facturas WHERE uuid = ?').get(f.folio_sustituto)) : null };
  if (motivo === '01') {
    if (!sustituta) throw new ErrorFactura('config', 'Con el motivo 01 primero se timbra la factura que la sustituye: pulsa «Sustituir» en la orden');
    if (sustituta_id && Number(sustituta_id) !== sustituta.id) throw new ErrorFactura('config', 'Esa no es la factura que sustituye a esta');
    if (!UUID_SAT.test(String(sustituta.uuid || ''))) throw new ErrorFactura('config', 'La factura que la sustituye no tiene folio fiscal');
  } else if (sustituta) throw new ErrorFactura('config', `Esta factura ya tiene una sustituta timbrada (${folioDe(sustituta)}): cancélala con el motivo 01`);
  return { sustituta };
}

/** Solo PRODUCCIÓN: cancelada con 02 o 03, la orden se queda sin factura en su cobranza (si el folio es el de esta factura). */
function anotarCancelacion(db, f, usuario) {
  if (f.entorno !== 'prod' || !f.lead_id) return;
  const lead = db.prepare('SELECT id, factura_folio FROM main.leads WHERE id = ?').get(f.lead_id);
  if (!lead) return;
  const sust = f.motivo_cancelacion === '01' ? db.prepare("SELECT serie, folio FROM main.facturas WHERE sustituye_a = ? AND estatus = 'timbrada' ORDER BY id DESC LIMIT 1").get(f.id) : null;
  if (f.motivo_cancelacion !== '01' && lead.factura_folio === folioDe(f)) db.prepare('UPDATE main.leads SET factura_folio = NULL, factura_fecha = NULL, factura_total_cent = NULL, factura_metodo = NULL WHERE id = ?').run(lead.id);
  // Motivo 03 (no se llevó a cabo): lo cobrado NO se toca solo; se avisa para revisar la devolución y marcar la orden como no realizada.
  const cobrado = f.motivo_cancelacion === '03' ? db.prepare('SELECT COALESCE(SUM(monto_cent), 0) t FROM main.cobros WHERE lead_id = ? AND cancelado = 0').get(lead.id).t : 0;
  db.prepare("INSERT INTO main.historial (lead_id, tipo, texto, usuario, origen, area, usuario_id) VALUES (?, 'observacion', ?, ?, 'sistema', 'cxc', ?)")
    .run(lead.id, `Factura ${folioDe(f)} CANCELADA ante el SAT (motivo ${f.motivo_cancelacion}${sust ? `, sustituida por la ${folioDe(sust)}` : ''}).${f.motivo_cancelacion === '03' ? ' El servicio no se realizó: marca la orden como «no realizada»' + (cobrado ? ` y revisa la devolución de los ${fmt(cobrado)} cobrados` : '') + '.' : ''}`, usuario?.nombre || 'Sistema', usuario?.id ?? null);
}

/** El SAT confirmó la cancelación: se marca, se guarda el acuse (si se puede bajar) y se anota en la orden (solo prod). */
async function quedoCancelada(db, cliente, f, estado, ctx) {
  db.transaction(() => {
    actualizar(db, f.id, { estatus: 'cancelada', cancelada_at: horaMexico().replace('T', ' '), cancelacion_estado: estado || 'Cancelado', cancelacion_revisada_at: horaMexico().replace('T', ' '), error_json: null });
    log(db, f, 'cancelar', 'ok', `Cancelada ante el SAT (motivo ${f.motivo_cancelacion})`, ctx.usuario?.id);
    anotarCancelacion(db, leer(db, f.id), ctx.usuario);
  })();
  if (!leer(db, f.id).acuse && cliente) {
    try {
      const r = await cliente.get(`/v4/cfdi40/${encodeURIComponent(f.uuid)}/acuse`);
      const t = r.archivo ? r.archivo.toString('utf8') : typeof r.datos === 'string' ? r.datos : '';
      if (esAcuse(t)) actualizar(db, f.id, { acuse: t });
    } catch (e) { log(db, f, 'acuse', 'error', e.message, ctx.usuario?.id, e.httpStatus); }
  }
  return { estado: 'cancelada', factura: leer(db, f.id) };
}

/**
 * Pregunta al SAT (vía factura.com) cómo va la cancelación. «Cancelado» → cancelada; un rechazo del receptor → regresa a timbrada; lo demás se queda en
 * proceso (el SAT puede tardar en reflejarla: la doc avisa que una cancelada puede verse «Vigente» un tiempo). Nunca marca cancelada sin confirmación.
 */
async function consultarEstatus(db, cliente, f, ctx = {}) {
  if (f.estatus !== 'cancelacion_solicitada') throw new ErrorFactura('config', 'Solo se consulta una factura con cancelación en proceso');
  let r;
  try { r = await cliente.get(`/v4/cfdi40/${encodeURIComponent(f.uuid)}/cancel_status`); }
  catch (e) { log(db, f, 'estatus_cancelacion', 'error', e.message, ctx.usuario?.id, e.httpStatus); throw e; }
  const d = r.datos && typeof r.datos === 'object' ? r.datos : {};
  const estado = String(d.Estado ?? '').trim(), sat = Array.isArray(d.EstatusCancelacion) ? '' : String(d.EstatusCancelacion ?? '').trim(), es = String(d.EsCancelable ?? '').trim();
  const texto = [estado, sat, es].filter(Boolean).join(' · ').slice(0, 200);
  if (/^cancelado$/i.test(estado)) return quedoCancelada(db, cliente, f, texto, ctx);
  // Vuelve a vigente si el cliente la rechazó, o si el SAT dice que NO es cancelable (y no hay nada en curso). Lo pedido queda en la bitácora técnica.
  const noCancelable = /^vigente$/i.test(estado) && /no cancelable/i.test(es) && !sat;
  if (/rechaz/i.test(sat) || noCancelable) {
    const mensaje = noCancelable ? 'El SAT dice que esta factura no se puede cancelar (por ejemplo, porque tiene documentos relacionados): sigue vigente' : 'El cliente rechazó la cancelación: la factura sigue vigente';
    db.transaction(() => {
      log(db, f, 'cancelar', 'error', `${mensaje} (se había pedido con motivo ${f.motivo_cancelacion} el ${f.cancelacion_solicitada_at || '—'})`, ctx.usuario?.id);
      actualizar(db, f.id, { estatus: 'timbrada', motivo_cancelacion: null, folio_sustituto: null, cancelacion_solicitada_at: null, acuse: null, cancelacion_estado: texto, cancelacion_revisada_at: horaMexico().replace('T', ' '), error_json: errorTexto(new ErrorFactura('api', mensaje)) });
    })();
    return { estado: 'timbrada', factura: leer(db, f.id), mensaje: mensaje + '.' };
  }
  actualizar(db, f.id, { cancelacion_estado: texto || null, cancelacion_revisada_at: horaMexico().replace('T', ' ') });
  log(db, f, 'estatus_cancelacion', 'ok', texto || 'sin cambios', ctx.usuario?.id);
  return { estado: 'cancelacion_solicitada', factura: leer(db, f.id), mensaje: /acept/i.test(es) && !/sin acept/i.test(es)
    ? 'Esta cancelación necesita que el cliente la acepte o la rechace en el buzón del SAT (tiene unos 3 días; si no contesta, se cancela). Vuelve a consultar más tarde.'
    : 'El SAT todavía no la reporta como cancelada. Vuelve a consultar más tarde' + (Number(minutosDesde(db, f.cancelacion_solicitada_at || f.updated_at)) >= ESPERA_REINTENTO_MIN ? '; si sigue igual, pulsa «Volver a pedir la cancelación».' : '.') };
}

/**
 * Pide cancelar una factura timbrada. op: { motivo, sustituta_id? }. ctx: { config, demo, crearCliente, usuario }.
 * Devuelve { estado, factura, mensaje? }. Lanza ErrorFactura si no se puede ni pedir (validación) — en ese caso nada cambió.
 */
async function cancelar(db, f, op, ctx) {
  const { sustituta } = revisar(db, f, op, ctx);
  const motivo = op.reintentar ? f.motivo_cancelacion : op.motivo;
  // Se guarda ANTES de mandar: si no hay respuesta, el siguiente paso es consultar el estatus (nunca volver a pedir a ciegas).
  db.transaction(() => {
    actualizar(db, f.id, { estatus: 'cancelacion_solicitada', motivo_cancelacion: motivo, folio_sustituto: sustituta?.uuid || null, cancelacion_solicitada_at: horaMexico().replace('T', ' '), error_json: null });
    log(db, f, 'cancelar', 'ok', `${op.reintentar ? 'Se vuelve a pedir la cancelación' : 'Solicitud de cancelación'} (motivo ${motivo}${sustituta ? ', sustituta ' + folioDe(sustituta) : ''})`, ctx.usuario?.id);
  })();
  if (ctx.demo) {
    actualizar(db, f.id, { acuse: `<?xml version="1.0" encoding="UTF-8"?>\n<!-- DEMOSTRACIÓN: esto NO es un acuse del SAT. -->\n<Acuse Fecha="${horaMexico()}"><Folios><UUID>${f.uuid}</UUID><EstatusUUID>201</EstatusUUID></Folios></Acuse>` });
    return quedoCancelada(db, null, leer(db, f.id), 'Cancelado (demostración)', ctx);
  }
  const cliente = ctx.crearCliente();
  let r;
  try { r = await cliente.post(`/v4/cfdi40/${encodeURIComponent(f.uuid)}/cancel`, { motivo, ...(sustituta ? { folioSustituto: sustituta.uuid } : {}) }); }
  catch (e) {
    // «Ya estaba cancelada»: no es un «no», es que ya se hizo. Se consulta el estatus en vez de regresarla a vigente.
    if (e instanceof ErrorFactura && e.codigo === 'api' && /previamente cancel|ya (se )?(encuentra|estaba|est[aá]) cancelad/i.test(e.message)) {
      log(db, f, 'cancelar', 'ok', 'factura.com dice que ya estaba cancelada: se consulta el estatus', ctx.usuario?.id, e.httpStatus);
      try { return await consultarEstatus(db, cliente, leer(db, f.id), ctx); }
      catch (e2) { return { estado: 'cancelacion_solicitada', factura: leer(db, f.id), mensaje: 'factura.com dice que ya estaba cancelada; consulta su estatus en unos minutos para confirmarlo. (' + e2.message + ')' }; }
    }
    if (e instanceof ErrorFactura && ((e.codigo === 'api' && e.rechazo) || e.codigo === 'config') && !op.reintentar) {
      // «No» explícito (o no se llegó a mandar): la factura sigue vigente, con el motivo a la vista.
      db.transaction(() => {
        actualizar(db, f.id, { estatus: 'timbrada', motivo_cancelacion: null, folio_sustituto: null, cancelacion_solicitada_at: null, error_json: errorTexto(e) });
        log(db, f, 'cancelar', 'error', e.message, ctx.usuario?.id, e.httpStatus);
      })();
      return { estado: 'timbrada', factura: leer(db, f.id), mensaje: 'No se canceló: ' + e.message };
    }
    if (!(e instanceof ErrorFactura)) throw e;
    // Sin respuesta clara: se queda «cancelación en proceso». Se resuelve con «Consultar estatus».
    actualizar(db, f.id, { error_json: errorTexto(e) }); log(db, f, 'cancelar', 'error', e.message, ctx.usuario?.id, e.httpStatus);
    return { estado: 'cancelacion_solicitada', factura: leer(db, f.id), mensaje: e.message + ' La solicitud pudo haber llegado: pulsa «Consultar estatus» en unos minutos.' };
  }
  const anidada = r.crudo?.respuestaapi || {}, acuse = anidada.acuse;
  // El acuse del SAT trae el resultado de la solicitud: 201 (recibida) o 202 (ya estaba cancelada) son buenos; cualquier otro código es un «no».
  const codigo = esAcuse(acuse) ? (/<(?:\w+:)?EstatusUUID>\s*(\d+)\s*</.exec(acuse) || [])[1] : null;
  if (anidada.response === 'error' || (codigo && !['201', '202'].includes(codigo))) {
    const mensaje = codigo && !['201', '202'].includes(codigo) ? `El SAT no aceptó la solicitud de cancelación (código ${codigo})` : 'factura.com no pudo pedir la cancelación';
    db.transaction(() => {
      actualizar(db, f.id, { estatus: 'timbrada', motivo_cancelacion: null, folio_sustituto: null, cancelacion_solicitada_at: null, error_json: errorTexto(new ErrorFactura('api', mensaje)) });
      log(db, f, 'cancelar', 'error', mensaje, ctx.usuario?.id);
    })();
    return { estado: 'timbrada', factura: leer(db, f.id), mensaje: 'No se canceló: ' + mensaje };
  }
  if (esAcuse(acuse)) actualizar(db, f.id, { acuse });
  // La respuesta solo dice que el SAT recibió la solicitud: se pregunta enseguida cómo quedó (si falla, se queda en proceso).
  try { return await consultarEstatus(db, cliente, leer(db, f.id), ctx); }
  catch (e) { return { estado: 'cancelacion_solicitada', factura: leer(db, f.id), mensaje: 'Se pidió la cancelación; el SAT todavía no confirma (' + e.message + '). Consulta su estatus en unos minutos.' }; }
}

module.exports = { MOTIVOS, revisar, cancelar, consultarEstatus, esAcuse };
