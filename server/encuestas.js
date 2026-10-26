// ENCUESTA DE SATISFACCIÓN (decidido con Dirección el 2026-10-26; antes era un Google Forms con un QR fijo).
//  · Cada orden de servicio tiene su enlace único (/e/<token>), que va como QR en la orden impresa. El cliente la
//    contesta sin cuenta; la respuesta queda ligada a la orden. Una sola vez por orden (no se corrige).
//  · Las preguntas son las del formulario que ya usaban: la empresa, el tipo de cliente y los servicios salen de la
//    orden (no se vuelven a preguntar); 11 aspectos del 1 al 5 (o N/A), facturación y manifiestos, recomendación del 0
//    al 10, interés en mantenimiento preventivo, qué mejorar y a quién reconocer.
//  · Al contestar: una nota en la bitácora de la orden con el resumen y, si el cliente quedó insatisfecho o quiere una
//    propuesta de mantenimiento preventivo, un aviso para Dirección, el gerente y el responsable de la orden (área
//    «encuesta» de la bitácora, ver sucursales.js).
//  · Lo público (/api/publico/encuesta/:token) solo muestra folio, fecha, servicios, empresa y el personal de la orden:
//    nunca montos ni datos de contacto. Tiene límite de peticiones por IP.
const crypto = require('crypto');
const path = require('path');
const alcance = require('./alcance');

const ASPECTOS = [
  ['comercial', 'Atención comercial y programación', [
    ['a21', 'Rapidez en la atención a su llamada o mensaje inicial'],
    ['a22', 'Claridad, asesoría técnica y prontitud en el envío de la cotización'],
    ['a23', 'Flexibilidad y cumplimiento en la fecha y horario pactados para el servicio']]],
  ['operacion', 'Desempeño operativo, personal y maquinaria', [
    ['a31', 'Puntualidad en el arribo de la cuadrilla y camión especializado'],
    ['a32', 'Presentación del personal, uniforme y Equipo de Protección Personal (EPP)'],
    ['a33', 'Estado y funcionamiento de la maquinaria (camión vactor, mangueras, equipo hidrolavador)'],
    ['a34', 'Respeto riguroso a las normas internas de seguridad de sus instalaciones'],
    ['a35', 'Claridad del operador al explicar el diagnóstico y los trabajos realizados']]],
  ['resultado', 'Efectividad del servicio y entrega final', [
    ['a41', 'Eficacia en la solución del problema (desazolve completo, flujo hidráulico recuperado)'],
    ['a42', 'Orden y limpieza en el área tras finalizar (sin derrames de lodo ni olores residuales)'],
    ['a43', 'Calidad del reporte técnico, evidencia fotográfica o video inspección entregado']]],
];
const CLAVES_ASPECTO = ASPECTOS.flatMap(([, , xs]) => xs.map(([k]) => k));
const FACTURACION = [['si', 'Sí, perfectamente en tiempo y forma'], ['parcial', 'Parcialmente (hubo retrasos menores en la entrega)'],
  ['no', 'No cumplió con las especificaciones o tiempos requeridos'], ['na', 'No aplica (no se requirió manifiesto de tiro / factura)']];
const PREVENTIVO = [['si', 'Sí, me gustaría que un asesor me contacte'], ['no', 'Por el momento no, solo servicios correctivos'], ['poliza', 'Ya contamos con una póliza de mantenimiento activa']];
const PREGUNTAS = { aspectos: ASPECTOS.map(([clave, titulo, items]) => ({ clave, titulo, items: items.map(([k, t]) => ({ clave: k, texto: t })) })), facturacion: FACTURACION, preventivo: PREVENTIVO };
// Cliente insatisfecho: promedio menor a 3, recomendaría 6 o menos, o la facturación no cumplió.
const insatisfecho = e => (e.promedio != null && e.promedio < 3) || (e.nps != null && e.nps <= 6) || e.facturacion === 'no';
const texto = (v, max) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return t ? t.slice(0, max) : null; };

module.exports = function encuestas(app, db, h, { urlBase }) {
  db.exec(`CREATE TABLE IF NOT EXISTS encuestas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL UNIQUE REFERENCES leads(id),
    token TEXT NOT NULL UNIQUE,
    creada_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    respondida_at TEXT, contacto TEXT, respuestas_json TEXT, promedio REAL, nps INTEGER CHECK(nps IS NULL OR nps BETWEEN 0 AND 10),
    facturacion TEXT, preventivo TEXT, mejorar TEXT, reconocimiento TEXT, reconocido_personal_id INTEGER REFERENCES personal(id)
  )`);
  const nuevoToken = () => crypto.randomBytes(16).toString('base64url'); // 128 bits: no se adivina
  // Con APP_URL (producción) el enlace usa esa dirección; sin ella, la dirección con la que se entró (no «localhost»).
  const enlace = (token, req) => (process.env.APP_URL ? urlBase : (req.get('x-forwarded-proto') || req.protocol) + '://' + req.get('host')) + '/e/' + token;
  // Personal de la orden (para «reconocer a un operador»): solo nombres.
  const personalDe = leadId => db.prepare('SELECT p.id, p.nombre FROM main.orden_personal op JOIN main.personal p ON p.id = op.personal_id WHERE op.lead_id = ? ORDER BY op.papel = \'responsable\' DESC, p.nombre').all(leadId);
  const respuesta = e => e && e.respondida_at ? {
    respondida_at: e.respondida_at, contacto: e.contacto, promedio: e.promedio, nps: e.nps, facturacion: e.facturacion, preventivo: e.preventivo,
    mejorar: e.mejorar, reconocimiento: e.reconocimiento, reconocido: e.reconocido_personal_id ? db.prepare('SELECT nombre FROM main.personal WHERE id = ?').get(e.reconocido_personal_id)?.nombre || null : null,
    aspectos: JSON.parse(e.respuestas_json || '{}'), insatisfecho: insatisfecho(e) } : null;

  // ---------- Dentro del sistema: el enlace y lo que contestó, para quien ve la orden ----------
  app.get('/api/leads/:id/encuesta', h((req, res) => {
    const lead = db.prepare('SELECT id, estatus FROM leads WHERE id = ?').get(req.params.id); // la vista: solo si la ve
    if (!lead) return res.status(404).json({ error: 'Orden no encontrada' });
    if (lead.estatus !== 'ganado') return res.status(400).json({ error: 'La encuesta es de las órdenes de servicio' });
    let e = db.prepare('SELECT * FROM main.encuestas WHERE lead_id = ?').get(lead.id);
    if (!e) { db.prepare('INSERT OR IGNORE INTO main.encuestas (lead_id, token) VALUES (?, ?)').run(lead.id, nuevoToken()); e = db.prepare('SELECT * FROM main.encuestas WHERE lead_id = ?').get(lead.id); }
    res.json({ url: enlace(e.token, req), respuesta: respuesta(e), preguntas: PREGUNTAS });
  }));

  // ---------- Reporte para Panorama: encuestas contestadas en el periodo de las órdenes que ve quien pide ----------
  function reporte(desde, hasta) {
    const filas = db.prepare(`SELECT e.*, l.responsable_id, l.tecnico_id, l.sucursal_id, u.nombre AS vendedor, t.nombre AS tecnico, s.nombre AS servicio, su.clave AS sucursal,
        COALESCE(c.empresa_contacto, c.nombre, l.empresa_contacto, l.nombre) AS cliente, l.created_at AS lead_created_at
      FROM encuestas e JOIN leads l ON l.id = e.lead_id LEFT JOIN usuarios u ON u.id = l.responsable_id LEFT JOIN usuarios t ON t.id = l.tecnico_id
      LEFT JOIN catalogo_servicios s ON s.id = l.servicio_id LEFT JOIN sucursales su ON su.id = l.sucursal_id LEFT JOIN clientes c ON c.id = l.cliente_id
      WHERE e.respondida_at IS NOT NULL AND date(e.respondida_at) BETWEEN ? AND ? ORDER BY e.respondida_at DESC`).all(desde, hasta);
    const resumen = lista => {
      const conProm = lista.filter(x => x.promedio != null), conNps = lista.filter(x => x.nps != null);
      const prom = conProm.length ? Math.round(conProm.reduce((t, x) => t + x.promedio, 0) / conProm.length * 10) / 10 : null;
      const nps = conNps.length ? Math.round((conNps.filter(x => x.nps >= 9).length - conNps.filter(x => x.nps <= 6).length) / conNps.length * 100) : null;
      return { encuestas: lista.length, promedio: prom, nps };
    };
    const agrupar = clave => { const m = new Map(); for (const x of filas) { const k = clave(x) || 'Sin dato'; if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
      return [...m].map(([nombre, xs]) => ({ nombre, ...resumen(xs) })).sort((a, b) => b.encuestas - a.encuestas || (b.promedio || 0) - (a.promedio || 0)); };
    const aspectos = ASPECTOS.flatMap(([, modulo, items]) => items.map(([k, t]) => {
      const vs = filas.map(x => JSON.parse(x.respuestas_json || '{}')[k]).filter(v => typeof v === 'number');
      return { clave: k, modulo, texto: t, promedio: vs.length ? Math.round(vs.reduce((a, b) => a + b, 0) / vs.length * 10) / 10 : null, respuestas: vs.length };
    }));
    const folio = x => require('./sucursales').folio('OS', 'leads', x.lead_id, x.lead_created_at);
    return {
      ...resumen(filas), insatisfechos: filas.filter(insatisfecho).length, quieren_preventivo: filas.filter(x => x.preventivo === 'si').length,
      por_vendedor: agrupar(x => x.vendedor), por_tecnico: agrupar(x => x.tecnico), por_servicio: agrupar(x => x.servicio), por_sucursal: agrupar(x => x.sucursal), aspectos,
      comentarios: filas.filter(x => x.mejorar || x.reconocimiento).slice(0, 20).map(x => ({ lead_id: x.lead_id, folio: folio(x), cliente: x.cliente, fecha: x.respondida_at, promedio: x.promedio, nps: x.nps, mejorar: x.mejorar, reconocimiento: x.reconocimiento })),
    };
  }

  // ---------- Público: la página que abre el QR ----------
  // Límite por IP (en memoria): consultar 60 y enviar 10 cada 10 minutos.
  const visitas = new Map();
  const limitar = (req, tipo, max) => {
    const k = tipo + '|' + (req.ip || ''), ahora = Date.now(), v = visitas.get(k);
    if (!v || ahora - v.desde > 10 * 60 * 1000) { visitas.set(k, { desde: ahora, n: 1 }); return false; }
    v.n++; if (visitas.size > 5000) visitas.clear();
    return v.n > max;
  };
  const porToken = token => (/^[\w-]{16,40}$/.test(String(token || '')) ? db.prepare('SELECT * FROM main.encuestas WHERE token = ?').get(token) : null);
  app.get('/e/:token', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'encuesta.html')));
  app.get('/api/publico/encuesta/:token', h((req, res) => {
    if (limitar(req, 'ver', 60)) return res.status(429).json({ error: 'Demasiadas consultas. Intenta en unos minutos.' });
    const e = alcance.global(() => porToken(req.params.token));
    if (!e) return res.status(404).json({ error: 'Este enlace de encuesta no es válido. Revisa el código QR de tu orden de servicio.' });
    const l = db.prepare(`SELECT l.id, l.created_at, l.fecha_servicio, l.fecha_realizado, l.partidas_json, s.nombre AS servicio, COALESCE(c.empresa_contacto, c.nombre, l.empresa_contacto, l.nombre) AS empresa,
        tc.nombre AS tipo_cliente FROM main.leads l LEFT JOIN main.clientes c ON c.id = l.cliente_id LEFT JOIN catalogo_servicios s ON s.id = l.servicio_id
        LEFT JOIN tipos_cliente tc ON tc.clave = c.giro WHERE l.id = ?`).get(e.lead_id);
    if (!l) return res.status(404).json({ error: 'Este enlace de encuesta ya no es válido.' });
    let servicios = []; try { servicios = [...new Set((JSON.parse(l.partidas_json || '[]') || []).map(p => p.servicio).filter(Boolean))]; } catch { /* sin partidas */ }
    res.json({
      folio: require('./sucursales').folio('OS', 'leads', l.id, l.created_at), empresa: l.empresa || '', tipo_cliente: l.tipo_cliente || '', fecha: l.fecha_realizado || l.fecha_servicio || '',
      servicios: servicios.length ? servicios : [l.servicio].filter(Boolean), personal: personalDe(l.id), respondida: !!e.respondida_at, preguntas: PREGUNTAS,
    });
  }));
  app.post('/api/publico/encuesta/:token', h((req, res) => {
    if (limitar(req, 'enviar', 10)) return res.status(429).json({ error: 'Demasiados envíos. Intenta en unos minutos.' });
    const e = alcance.global(() => porToken(req.params.token));
    if (!e) return res.status(404).json({ error: 'Este enlace de encuesta no es válido.' });
    if (e.respondida_at) return res.status(409).json({ error: 'Esta encuesta ya se contestó. ¡Gracias!', codigo: 'YA_CONTESTADA' });
    const b = req.body || {}, asp = b.aspectos && typeof b.aspectos === 'object' ? b.aspectos : {};
    const aspectos = {};
    for (const k of CLAVES_ASPECTO) {
      const v = asp[k];
      if (v === 'na') aspectos[k] = 'na';
      else if (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5) aspectos[k] = Number(v);
      else return res.status(400).json({ error: 'Califica todos los aspectos (del 1 al 5, o N/A si no aplica)', falta: k });
    }
    if (!FACTURACION.some(([k]) => k === b.facturacion)) return res.status(400).json({ error: 'Contesta la pregunta de facturación y manifiestos', falta: 'facturacion' });
    const nps = Number(b.nps);
    if (b.nps === '' || b.nps == null || !Number.isInteger(nps) || nps < 0 || nps > 10) return res.status(400).json({ error: 'Indica del 0 al 10 qué tan probable es que nos recomiende', falta: 'nps' });
    if (!PREVENTIVO.some(([k]) => k === b.preventivo)) return res.status(400).json({ error: 'Contesta la pregunta de mantenimiento preventivo', falta: 'preventivo' });
    const personal = personalDe(e.lead_id);
    const reconocido = b.reconocido_personal_id ? Number(b.reconocido_personal_id) : null;
    if (reconocido && !personal.some(p => p.id === reconocido)) return res.status(400).json({ error: 'Esa persona no participó en esta orden' });
    const nums = Object.values(aspectos).filter(v => typeof v === 'number');
    const d = { contacto: texto(b.contacto, 200), promedio: nums.length ? Math.round(nums.reduce((a, x) => a + x, 0) / nums.length * 10) / 10 : null, nps, facturacion: b.facturacion,
      preventivo: b.preventivo, mejorar: texto(b.mejorar, 2000), reconocimiento: texto(b.reconocimiento, 500), reconocido_personal_id: reconocido };
    const lead = db.prepare('SELECT id, sucursal_id FROM main.leads WHERE id = ?').get(e.lead_id);
    db.transaction(() => {
      const r = db.prepare(`UPDATE main.encuestas SET respondida_at = datetime('now','localtime'), contacto = ?, respuestas_json = ?, promedio = ?, nps = ?, facturacion = ?, preventivo = ?, mejorar = ?,
        reconocimiento = ?, reconocido_personal_id = ? WHERE id = ? AND respondida_at IS NULL`)
        .run(d.contacto, JSON.stringify(aspectos), d.promedio, d.nps, d.facturacion, d.preventivo, d.mejorar, d.reconocimiento, d.reconocido_personal_id, e.id);
      if (!r.changes) return;
      const nota = (tipo, txt, area = null) => db.prepare(`INSERT INTO main.historial (lead_id, tipo, texto, usuario, origen, area${tipo === 'alerta' ? ', fecha_alerta' : ''})
        VALUES (?, ?, ?, 'Encuesta del cliente', 'sistema', ?${tipo === 'alerta' ? ", datetime('now','localtime')" : ''})`).run(lead.id, tipo, txt, area);
      const fact = FACTURACION.find(([k]) => k === d.facturacion)[1];
      nota('observacion', `Encuesta del cliente contestada: ${d.promedio == null ? 'sin calificaciones' : 'promedio ' + d.promedio + ' de 5'} · recomendaría ${d.nps}/10 · facturación y manifiestos: ${fact}`
        + (d.mejorar ? ` · Mejorar: «${d.mejorar.slice(0, 200)}»` : '') + (d.reconocimiento ? ` · Reconoce: «${d.reconocimiento.slice(0, 120)}»` : ''));
      if (insatisfecho(d)) nota('alerta', `⚠ Cliente insatisfecho en la encuesta (${d.promedio == null ? 'sin promedio' : 'promedio ' + d.promedio + ' de 5'}, recomendaría ${d.nps}/10${d.facturacion === 'no' ? ', la facturación no cumplió' : ''}). Llamarle para atenderlo.`, 'encuesta');
      if (d.preventivo === 'si') nota('alerta', '💼 En la encuesta, el cliente pidió una propuesta de mantenimiento preventivo. Contactarlo.', 'encuesta');
    })();
    res.json({ ok: true });
  }));

  return { reporte, PREGUNTAS, insatisfecho };
};
module.exports.PREGUNTAS = PREGUNTAS;
