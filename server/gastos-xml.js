// XML de la factura (CFDI 3.3 / 4.0) de un gasto de Cuentas por pagar (2026-11-04). Al registrar el gasto, o después en su
// detalle, se sube el XML: el servidor lo lee y llena solo el IVA, para que la utilidad sin IVA de Resultados sea exacta.
//  · Solo el IVA TRASLADADO (impuesto 002 del comprobante) se resta para la utilidad sin IVA. El IEPS (003, p. ej. de la
//    gasolina) NO es IVA: se queda como parte del gasto.
//  · Lo que no se sabe tratar sin el contador (retenciones, otra moneda, impuestos locales, nota de crédito) se guarda y se
//    avisa; no se adivina. En otra moneda el IVA no se toma del XML (los montos del gasto van en pesos).
//  · Validaciones: CFDI timbrado de tipo I o E; receptor = Saneadren (si FACTURA_PROD_EMISOR_RFC está en el .env; si no,
//    solo se avisa); el total coincide con el del gasto; el mismo folio fiscal (UUID) no se registra dos veces.
//  · El XML se guarda como archivo del gasto (fuera del sitio web, en «archivos/cuentas_por_pagar») y nada se borra.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { leerCfdi, tipoReal, MAX_BYTES, nombreSeguro } = require('./expediente-oc');

// Diferencia que se tolera entre el total capturado y el del XML (redondeos al capturar): $1.00.
const TOLERANCIA_CENT = 100;
const IMPUESTO = { '001': 'ISR', '002': 'IVA', '003': 'IEPS' };

module.exports = function gastosXml(app, db, h, { P, fmt, ivaDeGasto }) {
  const base = process.env.DB_PATH ? path.dirname(path.resolve(process.env.DB_PATH)) : path.join(__dirname, '..');
  const DIR = path.join(base, 'archivos', 'cuentas_por_pagar');
  // Migración aditiva: tabla nueva y una columna (de dónde salió el IVA del gasto: 'xml' o 'manual'; NULL = de antes).
  db.exec(`CREATE TABLE IF NOT EXISTS cfdi_gastos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cxp_id INTEGER NOT NULL REFERENCES cuentas_por_pagar(id),
    uuid TEXT NOT NULL, version TEXT, tipo TEXT, serie TEXT, folio TEXT, fecha TEXT, metodo_pago TEXT, forma_pago TEXT,
    emisor_rfc TEXT, emisor_nombre TEXT, receptor_rfc TEXT, receptor_nombre TEXT, moneda TEXT, tipo_cambio TEXT,
    subtotal_cent INTEGER, descuento_cent INTEGER, total_cent INTEGER,
    iva_cent INTEGER NOT NULL DEFAULT 0, ieps_cent INTEGER NOT NULL DEFAULT 0, ret_iva_cent INTEGER NOT NULL DEFAULT 0, ret_isr_cent INTEGER NOT NULL DEFAULT 0,
    impuestos_json TEXT, avisos_json TEXT,
    nombre TEXT NOT NULL, archivo TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
    subido_por INTEGER, subido_por_nombre TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    eliminado INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_cfdi_gastos_cxp ON cfdi_gastos(cxp_id);
  CREATE INDEX IF NOT EXISTS idx_cfdi_gastos_uuid ON cfdi_gastos(uuid);`);
  if (!db.prepare('PRAGMA table_info(cuentas_por_pagar)').all().some(c => c.name === 'iva_origen')) db.exec('ALTER TABLE cuentas_por_pagar ADD COLUMN iva_origen TEXT');

  const rfcPropio = () => String(process.env.FACTURA_PROD_EMISOR_RFC || '').split(',').map(r => r.trim().toUpperCase()).filter(Boolean);
  const dma = f => String(f || '').slice(0, 10).split('-').reverse().join('/');

  // ¿Ya hay un gasto (vigente) o una orden de compra con este folio fiscal? Devuelve el texto para avisar cuál.
  function yaRegistrado(uuid, excluirCxp = 0) {
    const g = db.prepare(`SELECT c.id, c.concepto, c.total_cent, c.fecha_documento, p.nombre AS proveedor, en_alcance(c.sucursal_id) AS visible FROM main.cfdi_gastos x
      JOIN main.cuentas_por_pagar c ON c.id = x.cxp_id LEFT JOIN main.proveedores p ON p.id = c.proveedor_id
      WHERE x.uuid = ? AND x.eliminado = 0 AND c.cancelada = 0 AND c.id <> ? LIMIT 1`).get(uuid, excluirCxp);
    if (g) return g.visible ? `ya está registrada en el gasto #${g.id} «${g.concepto}» de ${g.proveedor || 'proveedor'} (${dma(g.fecha_documento)}, ${fmt(g.total_cent)})` : 'ya está registrada en un gasto de otra sucursal';
    const oc = db.prepare("SELECT d.oc_id FROM main.documentos_oc d WHERE d.eliminado = 0 AND d.tipo = 'factura_xml' AND json_extract(d.datos_json, '$.uuid') = ? LIMIT 1").get(uuid);
    if (oc) {
      const o = db.prepare('SELECT * FROM main.ordenes_compra WHERE id = ?').get(oc.oc_id);
      const cxp = o?.cxp_id && o.cxp_id !== excluirCxp ? o.cxp_id : null;
      if (o && (!o.cxp_id || cxp)) return `ya está en el expediente de la orden de compra ${require('./sucursales').folio('OC', 'ordenes_compra', o.id, o.created_at)}${cxp ? ' (su gasto es el #' + cxp + ')' : ''}`;
    }
    return null;
  }

  /** Lee y revisa un XML. totalCent: el del gasto (null = se llena del XML). Devuelve { error, status } o { datos, avisos, ivaCent, totalCent }. */
  function revisar(texto, { totalCent = null, proveedorRfc = null, excluirCxp = 0 } = {}) {
    const d = leerCfdi(texto);
    if (!d) return { status: 400, error: 'Ese archivo no es el XML de una factura electrónica (CFDI)' };
    if (!['3.3', '4.0'].includes(d.version)) return { status: 400, error: `Solo se leen facturas CFDI 3.3 o 4.0 (este XML dice versión ${d.version || 'sin indicar'})` };
    if (!['I', 'E'].includes(d.tipo)) return { status: 400, error: `Este CFDI es de tipo «${d.tipo || 'sin indicar'}»: aquí solo van facturas de ingreso (I) o notas de crédito (E). Un complemento de pago (P) o de nómina (N) no es un gasto nuevo.` };
    if (!d.uuid || !/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(d.uuid)) return { status: 400, error: 'El XML no trae el timbre del SAT (folio fiscal / UUID): pide al proveedor el XML timbrado' };
    if (d.total_cent == null || d.total_cent <= 0) return { status: 400, error: 'El XML no trae un total válido' };
    const repetido = yaRegistrado(d.uuid, excluirCxp);
    if (repetido) return { status: 409, codigo: 'UUID_REPETIDO', error: `Esta factura (folio fiscal ${d.uuid}) ${repetido}. No se registra dos veces.` };
    const propio = rfcPropio();
    if (propio.length && d.receptor_rfc && !propio.includes(d.receptor_rfc)) return { status: 400, error: `Esta factura está a nombre de otro RFC (${d.receptor_rfc}${d.receptor_nombre ? ' · ' + d.receptor_nombre : ''}), no de Saneadren (${propio.join(', ')}). Pide al proveedor que la facture a Saneadren.` };
    const avisos = [];
    if (!propio.length) avisos.push('No se revisó que la factura esté a nombre de Saneadren: falta poner el RFC de la empresa (FACTURA_PROD_EMISOR_RFC) en la configuración del servidor');
    const enPesos = !d.moneda || d.moneda === 'MXN';
    const imp = d.impuestos;
    if (!enPesos) avisos.push(`La factura está en ${d.moneda}${d.tipo_cambio ? ' (tipo de cambio ' + d.tipo_cambio + ')' : ''}: el total y el IVA del gasto van en pesos, así que NO se tomaron del XML. Captúralos en pesos (pregunta a tu contador qué tipo de cambio usar).`);
    if (d.tipo === 'E') avisos.push('Es una nota de crédito (egreso): disminuye lo que se le debe al proveedor, no es un gasto nuevo. Pregunta a tu contador cómo registrarla.');
    if (imp.ret_isr_cent || imp.ret_iva_cent) avisos.push(`Trae retenciones (${[imp.ret_isr_cent ? 'ISR ' + fmt(imp.ret_isr_cent) : '', imp.ret_iva_cent ? 'IVA ' + fmt(imp.ret_iva_cent) : ''].filter(Boolean).join(', ')}): el total de la factura ya las descuenta y Saneadren las paga al SAT aparte. Aquí no se suman al gasto: pregunta a tu contador cómo registrarlas.`);
    if (imp.otros.length) avisos.push(`Trae un impuesto que el sistema no conoce (clave ${[...new Set(imp.otros)].join(', ')}): se guardó tal cual, revísalo con tu contador.`);
    if (imp.locales) avisos.push('Trae impuestos locales (estatales, p. ej. hospedaje): forman parte del total y se quedan como gasto; revísalo con tu contador.');
    // El total del comprobante debe ser subtotal − descuento + trasladados − retenidos (si no, algo raro trae el XML).
    const tras = imp.traslados.reduce((t, x) => t + x.importe_cent, 0), ret = imp.retenciones.reduce((t, x) => t + x.importe_cent, 0);
    if (d.subtotal_cent != null && !imp.locales && Math.abs(d.subtotal_cent - d.descuento_cent + tras - ret - d.total_cent) > 1) avisos.push(`Las cuentas del XML no cuadran (subtotal ${fmt(d.subtotal_cent)} − descuento ${fmt(d.descuento_cent)} + impuestos ${fmt(tras)} − retenciones ${fmt(ret)} ≠ total ${fmt(d.total_cent)}): revísalo con tu contador.`);
    if (proveedorRfc && d.emisor_rfc && proveedorRfc.toUpperCase() !== d.emisor_rfc) avisos.push(`La factura la emite el RFC ${d.emisor_rfc}${d.emisor_nombre ? ' (' + d.emisor_nombre + ')' : ''}, pero el proveedor elegido tiene ${proveedorRfc.toUpperCase()}`);
    let total = totalCent;
    if (enPesos) {
      if (total == null) total = d.total_cent;
      else if (Math.abs(total - d.total_cent) > TOLERANCIA_CENT) return { status: 400, codigo: 'TOTAL_DISTINTO', error: `El total de la factura (${fmt(d.total_cent)}) no coincide con el total del gasto (${fmt(total)}). Revisa que sea la factura correcta o corrige el total.` };
      if (imp.iva_cent >= total) return { status: 400, error: 'El IVA del XML no es menor que el total: revisa que sea la factura correcta' };
    }
    return { datos: d, avisos, totalCent: total, ivaCent: enPesos ? imp.iva_cent : null, enPesos };
  }

  // Lo que se muestra del XML de un gasto (en la lista y en el detalle).
  const vista = x => (x ? { id: x.id, uuid: x.uuid, serie: x.serie, folio: x.folio, fecha: x.fecha, tipo: x.tipo, moneda: x.moneda, emisor_rfc: x.emisor_rfc, emisor_nombre: x.emisor_nombre,
    receptor_rfc: x.receptor_rfc, subtotal: x.subtotal_cent / 100, descuento: (x.descuento_cent || 0) / 100, total: x.total_cent / 100, iva: x.iva_cent / 100, ieps: x.ieps_cent / 100,
    ret_iva: x.ret_iva_cent / 100, ret_isr: x.ret_isr_cent / 100, avisos: x.avisos_json ? JSON.parse(x.avisos_json) : [], nombre: x.nombre, subido_por_nombre: x.subido_por_nombre, created_at: x.created_at } : null);
  function deGastos() { return new Map(db.prepare('SELECT * FROM cfdi_gastos WHERE eliminado = 0').all().map(x => [x.cxp_id, vista(x)])); }

  /** Guarda el XML ya revisado (dentro de la transacción de quien llama). */
  function guardar(req, cxpId, buf, nombre, r) {
    const d = r.datos, imp = d.impuestos;
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const info = db.prepare(`INSERT INTO main.cfdi_gastos (cxp_id, uuid, version, tipo, serie, folio, fecha, metodo_pago, forma_pago, emisor_rfc, emisor_nombre, receptor_rfc, receptor_nombre, moneda, tipo_cambio,
      subtotal_cent, descuento_cent, total_cent, iva_cent, ieps_cent, ret_iva_cent, ret_isr_cent, impuestos_json, avisos_json, nombre, archivo, bytes, sha256, subido_por, subido_por_nombre)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)`).run(cxpId, d.uuid, d.version, d.tipo, d.serie, d.folio, d.fecha, d.metodo_pago, d.forma_pago,
      d.emisor_rfc, d.emisor_nombre, d.receptor_rfc, d.receptor_nombre, d.moneda, d.tipo_cambio, d.subtotal_cent, d.descuento_cent, d.total_cent, imp.iva_cent, imp.ieps_cent, imp.ret_iva_cent, imp.ret_isr_cent,
      JSON.stringify({ traslados: imp.traslados, retenciones: imp.retenciones, locales: imp.locales }), JSON.stringify(r.avisos), nombreSeguro(nombre || 'factura.xml'), buf.length, sha, req.usuarioSesion.id, req.usuarioSesion.nombre);
    const archivo = path.join(String(cxpId), `${info.lastInsertRowid}-${sha.slice(0, 12)}.xml`);
    fs.mkdirSync(path.join(DIR, String(cxpId)), { recursive: true });
    fs.writeFileSync(path.join(DIR, archivo), buf);
    db.prepare('UPDATE main.cfdi_gastos SET archivo = ? WHERE id = ?').run(archivo, info.lastInsertRowid);
    return info.lastInsertRowid;
  }
  // Texto para la bitácora: qué se leyó del XML.
  const resumen = r => { const d = r.datos, imp = d.impuestos;
    return `XML folio fiscal ${d.uuid}${d.serie || d.folio ? ' (' + [d.serie, d.folio].filter(Boolean).join('-') + ')' : ''} de ${d.emisor_rfc || '—'} · total ${fmt(d.total_cent)}${!r.enPesos ? ' ' + d.moneda : ''} · IVA ${fmt(imp.iva_cent)}${imp.ieps_cent ? ' · IEPS ' + fmt(imp.ieps_cent) + ' (queda como gasto)' : ''}${imp.ret_isr_cent || imp.ret_iva_cent ? ' · retenciones ' + fmt(imp.ret_isr_cent + imp.ret_iva_cent) : ''}${r.avisos.length ? ' · AVISOS: ' + r.avisos.join(' | ') : ''}`; };

  const cuerpoXml = (req, res) => {
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buf.length) { res.status(400).json({ error: 'El archivo está vacío' }); return null; }
    if (buf.length > MAX_BYTES) { res.status(413).json({ error: 'El archivo pasa de 10 MB' }); return null; }
    if (tipoReal(buf) !== 'xml') { res.status(400).json({ error: 'Sube el archivo XML de la factura (no el PDF)' }); return null; }
    return buf;
  };
  const nombreDe = req => { try { return decodeURIComponent(String(req.get('x-nombre') || '')); } catch { return 'factura.xml'; } };
  const raw = express.raw({ type: () => true, limit: MAX_BYTES + 1024 });

  // Leer un XML sin guardar nada: para llenar el formulario del gasto nuevo (total, folio, fecha, IVA) y avisar antes de guardar.
  app.post('/api/finanzas/cxp/leer-xml', raw, h((req, res) => {
    if (!P.exigir(req, res, 'gastos.registrar', 'No tienes permiso para esta acción')) return;
    const buf = cuerpoXml(req, res); if (!buf) return;
    const prov = req.query.proveedor_id ? db.prepare('SELECT rfc FROM proveedores WHERE id = ?').get(Number(req.query.proveedor_id) || 0) : null;
    const r = revisar(buf.toString('utf8'), { proveedorRfc: prov?.rfc });
    if (r.error) return res.status(r.status).json({ error: r.error, codigo: r.codigo });
    const d = r.datos, imp = d.impuestos;
    res.json({ uuid: d.uuid, serie: d.serie, folio: d.folio, fecha: String(d.fecha || '').slice(0, 10), tipo: d.tipo, moneda: d.moneda || 'MXN', en_pesos: r.enPesos, metodo_pago: d.metodo_pago,
      emisor_rfc: d.emisor_rfc, emisor_nombre: d.emisor_nombre, receptor_rfc: d.receptor_rfc, subtotal: d.subtotal_cent / 100, descuento: d.descuento_cent / 100, total: d.total_cent / 100,
      iva: imp.iva_cent / 100, ieps: imp.ieps_cent / 100, ret_iva: imp.ret_iva_cent / 100, ret_isr: imp.ret_isr_cent / 100, avisos: r.avisos });
  }));

  // Subir el XML a un gasto ya registrado: quien lo registró o quien paga cuentas por pagar. Cambia su IVA (queda capturado).
  app.post('/api/finanzas/cxp/:id/xml', raw, h((req, res) => {
    const x = db.prepare('SELECT * FROM cuentas_por_pagar WHERE id = ? AND cancelada = 0').get(Number(req.params.id) || 0);
    if (!x) return res.status(404).json({ error: 'Cuenta por pagar no encontrada' });
    if (!P.puede(req, 'dinero.mover') && !(P.puede(req, 'gastos.registrar') && x.registrado_por === req.usuarioSesion.id)) return res.status(403).json({ error: 'El XML lo sube quien registró el gasto o quien paga cuentas por pagar' });
    if (db.prepare('SELECT 1 FROM cfdi_gastos WHERE cxp_id = ? AND eliminado = 0').get(x.id)) return res.status(409).json({ error: 'Este gasto ya tiene su XML' });
    const buf = cuerpoXml(req, res); if (!buf) return;
    const prov = db.prepare('SELECT rfc FROM proveedores WHERE id = ?').get(x.proveedor_id);
    const r = revisar(buf.toString('utf8'), { totalCent: x.total_cent, proveedorRfc: prov?.rfc, excluirCxp: x.id });
    if (r.error) return res.status(r.status).json({ error: r.error, codigo: r.codigo });
    const antes = ivaDeGasto(x), d = r.datos;
    const folio = [d.serie, d.folio].filter(Boolean).join('-') || d.uuid.slice(0, 8);
    const metodo = ['PUE', 'PPD'].includes(d.metodo_pago) ? d.metodo_pago : null;
    const id = db.transaction(() => {
      const nuevo = guardar(req, x.id, buf, nombreDe(req), r);
      // Con XML es factura; el folio y el método del SAT se llenan si no tenían; el IVA queda capturado (salvo en otra moneda).
      db.prepare(`UPDATE main.cuentas_por_pagar SET tipo_comprobante = 'factura', factura_folio = COALESCE(NULLIF(factura_folio, ''), ?), metodo_sat = COALESCE(metodo_sat, ?)${r.ivaCent != null ? ", iva_cent = ?, iva_origen = 'xml'" : ''},
        updated_at = datetime('now','localtime') WHERE id = ?`).run(...[folio, metodo, ...(r.ivaCent != null ? [r.ivaCent] : []), x.id]);
      const cambioTipo = x.tipo_comprobante && x.tipo_comprobante !== 'factura' ? ` · comprobante «${x.tipo_comprobante}» → factura` : '';
      app.locals.auditoria?.registrar(req, 'cuenta_por_pagar', x.id, 'XML de factura', `«${x.concepto}»: ${resumen(r)}${r.ivaCent != null ? ` · IVA del gasto ${fmt(antes.iva_cent)}${antes.estimado ? ' (estimado)' : ''} → ${fmt(r.ivaCent)}` : ' · IVA sin cambio'}${cambioTipo}`);
      return nuevo;
    })();
    res.status(201).json({ id, avisos: r.avisos, iva: r.ivaCent != null ? r.ivaCent / 100 : null, ieps: d.impuestos.ieps_cent / 100 });
  }));

  // Descargar el XML de un gasto (quien ve el gasto).
  app.get('/api/finanzas/cxp/:id/xml', h((req, res) => {
    if (!P.exigir(req, res, 'cxp.ver', 'No tienes permiso para esta sección')) return;
    const x = db.prepare('SELECT g.* FROM cfdi_gastos g JOIN cuentas_por_pagar c ON c.id = g.cxp_id WHERE g.cxp_id = ? AND g.eliminado = 0 ORDER BY g.id DESC LIMIT 1').get(Number(req.params.id) || 0);
    if (!x) return res.status(404).json({ error: 'Este gasto no tiene XML' });
    const ruta = path.join(DIR, x.archivo);
    if (!ruta.startsWith(DIR + path.sep) || !fs.existsSync(ruta)) return res.status(404).json({ error: 'El archivo ya no está en el servidor' });
    res.set({ 'Content-Type': 'application/xml', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="factura.xml"; filename*=UTF-8''${encodeURIComponent(x.nombre)}` });
    res.send(fs.readFileSync(ruta));
  }));

  return { revisar, guardar, resumen, deGastos, IMPUESTO };
};
