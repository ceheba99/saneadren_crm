/* Facturación CFDI 4.0 · F2 (2026-10-27): sincroniza los datos fiscales de un cliente (tabla clientes_fiscales) con factura.com. SIN PROBAR contra
   la API real. Endpoints de apidocs/clientes.html:
     GET  /v1/clients/rfc/{RFC}        → todos los clientes con ese RFC (puede haber varios)
     GET  /v1/clients/{UID}            → un cliente
     POST /v1/clients/create           → { rfc, razons, codpos, email, regimen, pais, usocfdi, … }  → Data.UID
     POST /v1/clients/{UID}/update     → los mismos campos (todos los obligatorios otra vez)
   Reglas: (10) el UID guardado se usa SIEMPRE; el RFC solo sirve para AVISAR que ya existe, nunca para enlazar a ciegas (hay que
   elegir, con vincularCliente); (2) con datos incompletos o inválidos NO se llama a la API y se dice qué falta.
   · «codpos» figura como numérico en la doc: se manda como TEXTO para no perder el cero de un CP como 09410 (por confirmar en sandbox).
   · La razón social se manda ya normalizada (MAYÚSCULAS, sin régimen societario). */
const { validarDatosFiscales } = require('./facturacion-validaciones');
const { leerCatalogos } = require('./facturacion-catalogos');
const { ErrorFactura } = require('./facturacom');

const uidDe = d => String(d?.UID ?? d?.uid ?? '').trim();

/** Cuerpo para crear o actualizar, a partir de la fila de clientes_fiscales (ya validada y normalizada). */
function payloadCliente(n) {
  return { rfc: n.rfc, razons: n.razon_social, codpos: n.cp, email: n.correo, regimen: n.regimen, pais: 'MEX', usocfdi: n.uso_cfdi };
}

function filaFiscal(db, fiscalId) {
  const f = db.prepare('SELECT * FROM clientes_fiscales WHERE id = ?').get(Number(fiscalId));
  if (!f) throw new ErrorFactura('config', 'No existe ese dato fiscal del cliente');
  return f;
}

/**
 * Crea o actualiza al receptor en factura.com y guarda su UID.
 * Devuelve { estado: 'creado' | 'actualizado' | 'existe', uid, candidatos? }.
 * 'existe': ya hay clientes con ese RFC en factura.com y este todavía no tiene UID guardado → no se crea nada; hay que vincularlo a uno (vincularCliente) o crear otro a propósito (opciones.crearAunqueExista).
 */
async function sincronizarCliente(cliente, db, fiscalId, { crearAunqueExista = false } = {}) {
  const f = filaFiscal(db, fiscalId);
  const v = validarDatosFiscales(f, leerCatalogos(db));
  if (!v.listo) {
    const partes = [];
    if (v.faltantes.length) partes.push('falta: ' + v.faltantes.join(', '));
    if (v.errores.length) partes.push(v.errores.join('; '));
    throw new ErrorFactura('config', 'Los datos fiscales no están listos (' + partes.join(' · ') + '). No se mandó nada a factura.com.');
  }
  const cuerpo = payloadCliente(v.normalizado);
  if (f.uid_facturacom) {
    await cliente.post(`/v1/clients/${encodeURIComponent(f.uid_facturacom)}/update`, cuerpo);
    guardar(db, f.id, f.uid_facturacom, v.normalizado);
    return { estado: 'actualizado', uid: f.uid_facturacom };
  }
  if (!crearAunqueExista) {
    // La doc no dice qué contesta la API si no hay ningún cliente con ese RFC (¿lista vacía o error?): las dos formas cuentan como «no hay» (por confirmar en sandbox).
    let lista = [];
    try { const res = await cliente.get('/v1/clients/rfc/' + encodeURIComponent(v.normalizado.rfc)); lista = Array.isArray(res.datos) ? res.datos : []; }
    catch (e) { if (!(e instanceof ErrorFactura && e.codigo === 'api' && (e.httpStatus === 404 || /no se encontr|no existe|not found|sin resultados/i.test(e.message)))) throw e; }
    const candidatos = lista.map(c => ({ uid: uidDe(c), razon_social: c.RazonSocial || '', cp: c.CodigoPostal || '', regimen: c.RegimenId || c.Regimen || '' })).filter(c => c.uid);
    if (candidatos.length) return { estado: 'existe', uid: null, candidatos };
  }
  const res = await cliente.post('/v1/clients/create', cuerpo);
  const uid = uidDe(res.datos);
  if (!uid) throw new ErrorFactura('respuesta', 'factura.com creó al cliente pero no devolvió su UID: búscalo por RFC y vincúlalo (no se guardó nada).');
  guardar(db, f.id, uid, v.normalizado);
  return { estado: 'creado', uid };
}

/** Enlaza un dato fiscal con un cliente que YA existe en factura.com (se comprueba que sea el mismo RFC). */
async function vincularCliente(cliente, db, fiscalId, uid) {
  const f = filaFiscal(db, fiscalId);
  const res = await cliente.get('/v1/clients/' + encodeURIComponent(uid));
  const rfc = String(res.datos?.RFC ?? '').toUpperCase();
  if (!rfc) throw new ErrorFactura('respuesta', 'factura.com no devolvió los datos de ese cliente.');
  if (rfc !== String(f.rfc).toUpperCase()) throw new ErrorFactura('config', `Ese cliente de factura.com tiene otro RFC (${rfc}): no se vinculó.`);
  if (db.prepare('SELECT id FROM clientes_fiscales WHERE uid_facturacom = ? AND id <> ?').get(uid, f.id)) throw new ErrorFactura('config', 'Ese cliente de factura.com ya está vinculado a otro dato fiscal.');
  db.prepare("UPDATE clientes_fiscales SET uid_facturacom = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(uid, f.id);
  return { estado: 'vinculado', uid };
}

// Guarda el UID y deja en la base los datos tal como se mandaron (razón social normalizada, uso en mayúsculas…).
function guardar(db, id, uid, n) {
  db.prepare("UPDATE clientes_fiscales SET uid_facturacom = ?, rfc = ?, razon_social = ?, cp = ?, regimen = ?, uso_cfdi = ?, correo = ?, updated_at = datetime('now','localtime') WHERE id = ?")
    .run(uid, n.rfc, n.razon_social, n.cp, n.regimen, n.uso_cfdi, n.correo, id);
}

module.exports = { sincronizarCliente, vincularCliente, payloadCliente };
