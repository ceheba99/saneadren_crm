// Expediente de cada orden de compra: la orden, la cotización del proveedor, la factura (PDF y XML), los
// comprobantes de pago y la evidencia de entrega, más sus pagos y todo su historial. Los archivos se guardan
// fuera del sitio web (junto a la base de datos, en «archivos/»), con un nombre interno: nunca con el nombre
// que trae el archivo. Nada se borra: un documento quitado queda marcado con quién, cuándo y por qué.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const MAX_BYTES = 10 * 1024 * 1024;
const TIPOS = {
  cotizacion: { nombre: 'Cotización del proveedor', admite: ['pdf', 'jpg', 'png'] },
  orden_firmada: { nombre: 'Orden de compra firmada', admite: ['pdf', 'jpg', 'png'] },
  factura_pdf: { nombre: 'Factura (PDF)', admite: ['pdf'] },
  factura_xml: { nombre: 'Factura (XML del SAT)', admite: ['xml'] },
  comprobante_pago: { nombre: 'Comprobante de pago', admite: ['pdf', 'jpg', 'png'] },
  evidencia: { nombre: 'Evidencia de entrega / fotos', admite: ['pdf', 'jpg', 'png'] },
  firma_recepcion: { nombre: 'Firma de recibido', admite: ['png', 'jpg', 'pdf'] },
  otro: { nombre: 'Otro documento', admite: ['pdf', 'jpg', 'png', 'xml'] },
};
const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', xml: 'application/xml' };
// El tipo real se reconoce por el contenido (no por la extensión que diga el nombre).
function tipoReal(buf) {
  if (buf.length > 4 && buf.slice(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  const ini = buf.slice(0, 200).toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^<\?xml|^<cfdi:Comprobante/i.test(ini)) return 'xml';
  return null;
}
// Datos de una factura electrónica (CFDI 3.3 / 4.0) leídos del XML.
function leerCfdi(xml) {
  const attr = (etiqueta, nombre) => { const m = xml.match(new RegExp('<(?:\\w+:)?' + etiqueta + '\\b[^>]*\\s' + nombre + '="([^"]*)"', 'i')); return m ? m[1] : null; };
  if (!/<(?:\w+:)?Comprobante\b/i.test(xml)) return null;
  const num = v => (v == null || v === '' ? null : Number(v));
  return {
    uuid: (attr('TimbreFiscalDigital', 'UUID') || '').toUpperCase() || null,
    serie: attr('Comprobante', 'Serie'), folio: attr('Comprobante', 'Folio'), fecha: attr('Comprobante', 'Fecha'),
    subtotal: num(attr('Comprobante', 'SubTotal')), total: num(attr('Comprobante', 'Total')), moneda: attr('Comprobante', 'Moneda'),
    tipo: attr('Comprobante', 'TipoDeComprobante'), metodo_pago: attr('Comprobante', 'MetodoPago'),
    emisor_rfc: (attr('Emisor', 'Rfc') || '').toUpperCase() || null, emisor_nombre: attr('Emisor', 'Nombre'),
    receptor_rfc: (attr('Receptor', 'Rfc') || '').toUpperCase() || null, receptor_nombre: attr('Receptor', 'Nombre'),
  };
}
const nombreSeguro = t => String(t || 'documento').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120) || 'documento';

module.exports = function expedienteOC(app, db, h, { leer, esAdmin, folioOC }) {
  const base = process.env.DB_PATH ? path.dirname(path.resolve(process.env.DB_PATH)) : path.join(__dirname, '..');
  const DIR = path.join(base, 'archivos', 'ordenes_compra');
  db.exec(`CREATE TABLE IF NOT EXISTS documentos_oc (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    oc_id INTEGER NOT NULL REFERENCES ordenes_compra(id),
    tipo TEXT NOT NULL, nombre TEXT NOT NULL, archivo TEXT NOT NULL, formato TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
    datos_json TEXT, nota TEXT,
    subido_por INTEGER, subido_por_nombre TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    eliminado INTEGER NOT NULL DEFAULT 0, eliminado_por TEXT, eliminado_at TEXT, motivo_eliminado TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_documentos_oc ON documentos_oc(oc_id);`);
  const cols = db.prepare('PRAGMA table_info(ordenes_compra)').all().map(c => c.name);
  if (!cols.includes('factura_folio')) db.exec('ALTER TABLE ordenes_compra ADD COLUMN factura_folio TEXT');
  const audit = (req, id, accion, detalle) => app.locals.auditoria?.registrar(req, 'orden_compra', id, accion, detalle);
  const fmt = c => '$' + (Number(c || 0) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function documentos(ocId) {
    return db.prepare('SELECT id, oc_id, tipo, nombre, formato, bytes, datos_json, nota, subido_por_nombre, created_at, eliminado, eliminado_por, eliminado_at, motivo_eliminado FROM documentos_oc WHERE oc_id = ? ORDER BY id').all(ocId)
      .map(d => ({ ...d, tipo_nombre: TIPOS[d.tipo]?.nombre || d.tipo, datos: d.datos_json ? JSON.parse(d.datos_json) : null, datos_json: undefined }));
  }
  function cuentaPorPagar(o) {
    if (!o.cxp_id) return null;
    const c = db.prepare('SELECT * FROM cuentas_por_pagar WHERE id = ?').get(o.cxp_id);
    if (!c) return null;
    const pagos = db.prepare('SELECT id, fecha, monto_cent, metodo, referencia, cancelado, motivo_cancelacion FROM pagos_proveedor WHERE cxp_id = ? ORDER BY fecha, id').all(c.id);
    const pagado = pagos.filter(p => !p.cancelado).reduce((t, p) => t + p.monto_cent, 0);
    return { id: c.id, factura_folio: c.factura_folio, total: c.total_cent / 100, pagado: pagado / 100, saldo: c.cancelada ? 0 : (c.total_cent - pagado) / 100, vence: c.fecha_vencimiento, cancelada: !!c.cancelada,
      pagos: pagos.map(p => ({ ...p, monto: p.monto_cent / 100 })) };
  }

  function insertar(req, o, tipo, nombre, buf, formato, sha, datos, nota) {
    const r = db.prepare('INSERT INTO documentos_oc (oc_id, tipo, nombre, archivo, formato, bytes, sha256, datos_json, nota, subido_por, subido_por_nombre) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(o.id, tipo, nombre, '', formato, buf.length, sha, datos ? JSON.stringify(datos) : null, String(nota || '').slice(0, 300) || null, req.usuarioSesion.id, req.usuarioSesion.nombre);
    const archivo = path.join(String(o.id), `${r.lastInsertRowid}-${sha.slice(0, 12)}.${formato}`);
    fs.mkdirSync(path.join(DIR, String(o.id)), { recursive: true });
    fs.writeFileSync(path.join(DIR, archivo), buf);
    db.prepare('UPDATE documentos_oc SET archivo = ? WHERE id = ?').run(archivo, r.lastInsertRowid);
    return r;
  }
  // Para otros módulos (la cotización elegida de una solicitud pasa sola al expediente de su orden).
  function agregarDocumento(req, o, tipo, nombre, buf, nota) {
    const formato = tipoReal(buf);
    if (!formato || !TIPOS[tipo]?.admite.includes(formato)) throw new Error('Formato no admitido');
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (db.prepare('SELECT 1 FROM documentos_oc WHERE sha256 = ? AND eliminado = 0 AND oc_id = ?').get(sha, o.id)) return null;
    const r = db.transaction(() => insertar(req, o, tipo, nombreSeguro(nombre), buf, formato, sha, null, nota))();
    audit(req, o.id, 'documento', `${TIPOS[tipo].nombre}: «${nombreSeguro(nombre)}» (${formato.toUpperCase()}, ${Math.ceil(buf.length / 1024)} KB)${nota ? ' · ' + nota : ''}`);
    return r.lastInsertRowid;
  }

  app.get('/api/compras/formatos-documento', h((req, res) => res.json(TIPOS)));

  app.get('/api/compras/ordenes/:id/expediente', h((req, res) => {
    const o = leer(req.params.id);
    if (!o) return res.status(404).json({ error: 'Orden de compra no encontrada' });
    const docs = documentos(o.id), vivos = docs.filter(d => !d.eliminado);
    const tiene = t => vivos.some(d => d.tipo === t);
    const cxp = cuentaPorPagar(o);
    // Lo que debería tener el expediente según en qué va la orden.
    const lista = [
      { clave: 'orden', texto: 'Orden de compra (se genera del CRM)', listo: true },
      { clave: 'cotizacion', texto: 'Cotización del proveedor', listo: tiene('cotizacion'), opcional: true },
      { clave: 'autorizacion', texto: 'Autorización', listo: o.estado === 'autorizada', detalle: o.estado === 'autorizada' ? `por ${o.autorizada_por_nombre || ''} el ${String(o.autorizada_at || '').slice(0, 10).split('-').reverse().join('/')}` : 'pendiente' },
      { clave: 'factura_pdf', texto: 'Factura (PDF)', listo: tiene('factura_pdf') },
      { clave: 'factura_xml', texto: 'Factura (XML del SAT)', listo: tiene('factura_xml') },
      { clave: 'pago', texto: 'Pagada', listo: !!cxp && cxp.saldo <= 0 && cxp.pagado > 0, detalle: cxp ? (cxp.saldo > 0 ? `falta ${fmt(cxp.saldo * 100)}` : 'sí') : 'aún no es deuda' },
      { clave: 'comprobante_pago', texto: 'Comprobante de pago', listo: tiene('comprobante_pago') },
      { clave: 'recepcion', texto: 'Recibido (foto y/o firma)', listo: !!o.recibida_at, detalle: o.recibida_at ? `por ${o.recibio_nombre || o.recibida_por_nombre || ''} el ${String(o.recibida_at).slice(0, 10).split('-').reverse().join('/')}` : 'pendiente' },
    ];
    const historial = db.prepare("SELECT * FROM auditoria WHERE entidad = 'orden_compra' AND entidad_id = ? ORDER BY id DESC").all(o.id);
    res.json({ orden: o, documentos: docs, cuenta_por_pagar: cxp, lista, historial, tipos: TIPOS });
  }));

  // Subir un documento: el cuerpo es el archivo tal cual; tipo y nombre van en encabezados.
  app.post('/api/compras/ordenes/:id/documentos', express.raw({ type: () => true, limit: MAX_BYTES + 1024 }), h((req, res) => {
    const o = leer(req.params.id);
    if (!o) return res.status(404).json({ error: 'Orden de compra no encontrada' });
    const tipo = String(req.get('x-tipo') || '');
    if (!TIPOS[tipo]) return res.status(400).json({ error: 'Elige qué documento es' });
    let nombre; try { nombre = nombreSeguro(decodeURIComponent(String(req.get('x-nombre') || ''))); } catch { nombre = 'documento'; }
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buf.length) return res.status(400).json({ error: 'El archivo está vacío' });
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'El archivo pasa de 10 MB' });
    const formato = tipoReal(buf);
    if (!formato) return res.status(400).json({ error: 'Solo se aceptan PDF, JPG, PNG o el XML de la factura' });
    if (!TIPOS[tipo].admite.includes(formato)) return res.status(400).json({ error: `${TIPOS[tipo].nombre}: el archivo debe ser ${TIPOS[tipo].admite.map(x => x.toUpperCase()).join(' o ')} (este es ${formato.toUpperCase()})` });
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const repetido = db.prepare('SELECT d.id, d.oc_id FROM documentos_oc d WHERE d.sha256 = ? AND d.eliminado = 0 ORDER BY (d.oc_id = ?) DESC').get(sha, o.id);
    if (repetido) return res.status(409).json({ error: repetido.oc_id === o.id ? 'Ese mismo archivo ya está en este expediente' : `Ese mismo archivo ya está en el expediente de ${folioOC(db.prepare('SELECT * FROM ordenes_compra WHERE id = ?').get(repetido.oc_id))}` });
    // Factura XML: se leen sus datos y se comparan con la orden.
    let datos = null; const avisos = [];
    if (formato === 'xml') {
      datos = leerCfdi(buf.toString('utf8'));
      if (tipo === 'factura_xml' && !datos) return res.status(400).json({ error: 'Ese XML no es una factura electrónica (CFDI)' });
      if (datos?.uuid) {
        const otra = db.prepare("SELECT oc_id FROM documentos_oc WHERE eliminado = 0 AND tipo = 'factura_xml' AND json_extract(datos_json, '$.uuid') = ?").get(datos.uuid);
        if (otra) return res.status(409).json({ error: `Esta factura (folio fiscal ${datos.uuid}) ya está en ${folioOC(db.prepare('SELECT * FROM ordenes_compra WHERE id = ?').get(otra.oc_id))}` });
      }
      if (datos) {
        if (datos.total != null && Math.abs(Math.round(datos.total * 100) - o.total_cent) > 100) avisos.push(`El total de la factura (${fmt(Math.round(datos.total * 100))}) no coincide con el de la orden (${fmt(o.total_cent)})`);
        const prov = db.prepare('SELECT rfc, nombre FROM proveedores WHERE id = ?').get(o.proveedor_id);
        if (prov?.rfc && datos.emisor_rfc && prov.rfc.toUpperCase() !== datos.emisor_rfc) avisos.push(`La factura la emite el RFC ${datos.emisor_rfc}, pero el proveedor tiene ${prov.rfc}`);
        if (datos.tipo && datos.tipo !== 'I') avisos.push(`El comprobante no es de ingreso (tipo ${datos.tipo})`);
        datos.avisos = avisos;
      }
    }
    let notaTxt = ''; try { notaTxt = decodeURIComponent(String(req.get('x-nota') || '')); } catch { notaTxt = ''; }
    const info = db.transaction(() => {
      const r = insertar(req, o, tipo, nombre, buf, formato, sha, datos, notaTxt);
      // El folio de la factura queda en la orden y en su cuenta por pagar (si aún no tenía).
      if (datos?.folio || datos?.uuid) {
        const folio = [datos.serie, datos.folio].filter(Boolean).join('-') || datos.uuid.slice(0, 8);
        if (!o.factura_folio) db.prepare('UPDATE ordenes_compra SET factura_folio = ? WHERE id = ?').run(folio, o.id);
        if (o.cxp_id) db.prepare("UPDATE cuentas_por_pagar SET factura_folio = ? WHERE id = ? AND (factura_folio IS NULL OR factura_folio = '')").run(folio, o.cxp_id);
      }
      return r;
    })();
    audit(req, o.id, 'documento', `${TIPOS[tipo].nombre}: «${nombre}» (${formato.toUpperCase()}, ${Math.ceil(buf.length / 1024)} KB)${datos?.uuid ? ' · folio fiscal ' + datos.uuid : ''}${avisos.length ? ' · AVISOS: ' + avisos.join('; ') : ''}`);
    res.status(201).json({ id: info.lastInsertRowid, avisos, datos });
  }));

  app.get('/api/compras/documentos/:id', h((req, res) => {
    const d = db.prepare('SELECT * FROM documentos_oc WHERE id = ?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Documento no encontrado' });
    const ruta = path.join(DIR, d.archivo);
    if (!ruta.startsWith(DIR) || !fs.existsSync(ruta)) return res.status(404).json({ error: 'El archivo ya no está en el servidor' });
    res.set({ 'Content-Type': MIME[d.formato] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="documento.${d.formato}"; filename*=UTF-8''${encodeURIComponent(d.nombre)}` });
    res.send(fs.readFileSync(ruta));
  }));

  // Quitar un documento: queda marcado (no se borra el archivo). Administración, o quien lo subió mientras la orden es borrador.
  app.post('/api/compras/documentos/:id/quitar', h((req, res) => {
    const d = db.prepare('SELECT * FROM documentos_oc WHERE id = ?').get(req.params.id);
    if (!d || d.eliminado) return res.status(404).json({ error: 'Documento no encontrado' });
    const o = db.prepare('SELECT * FROM ordenes_compra WHERE id = ?').get(d.oc_id);
    if (!esAdmin(req) && !(d.subido_por === req.usuarioSesion.id && o.estado === 'borrador')) return res.status(403).json({ error: 'Solo administración puede quitar documentos de una orden autorizada o que subió otra persona' });
    const motivo = String(req.body?.motivo || '').trim().slice(0, 300);
    if ((motivo.match(/[\p{L}\p{N}]/gu) || []).length < 5) return res.status(400).json({ error: 'Escribe por qué se quita (mínimo 5 letras)' });
    db.prepare("UPDATE documentos_oc SET eliminado = 1, eliminado_por = ?, eliminado_at = datetime('now','localtime'), motivo_eliminado = ? WHERE id = ?").run(req.usuarioSesion.nombre, motivo, d.id);
    audit(req, d.oc_id, 'documento quitado', `${TIPOS[d.tipo]?.nombre || d.tipo}: «${d.nombre}» · motivo: ${motivo}`);
    res.json({ ok: true });
  }));

  return { TIPOS, leerCfdi, agregarDocumento };
};
module.exports.leerCfdi = leerCfdi;
module.exports.tipoReal = tipoReal;
