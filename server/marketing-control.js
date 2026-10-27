// MARKETING · CONTROL DEL DEPARTAMENTO Y FINANZAS (fase 4, decidido con Dirección el 2026-10-27).
//  · Presupuesto mensual por rubro. Lo propone el Gerente de marketing (o quien tenga «Dinero de Marketing») y lo
//    aprueba o rechaza (con motivo) SOLO Dirección. Si se cambia después de enviado o aprobado, regresa a borrador.
//  · Gastos del departamento: control interno de Marketing (NO pasan a Cuentas por pagar). Fecha, concepto, rubro,
//    proveedor, monto (total pagado), factura, red, proyecto/campaña y comprobante (PDF o foto). No se borran: se
//    cancelan con motivo.
//  · Resultados y retorno: cada proyecto (campaña) se liga a un canal de «¿Cómo se enteró?»; en su ventana de fechas se
//    cuentan los contactos, cotizaciones y ventas de ese canal, y contra su gasto se calculan costo por contacto y
//    retorno. Además, el resumen por canal de los canales marcados «de marketing».
//  · Plan anual: objetivos del año y metas mensuales (publicaciones, contactos, cotizaciones, ventas, tope de gasto),
//    con lo real calculado solo.
//  · Tablero del departamento: el mes de un vistazo (publicaciones y cumplimiento, atrasos, carga de trabajo por persona,
//    proyectos, ideas, metas y, para quien ve el dinero, presupuesto contra gasto).
//  · Dinero (montos de presupuesto, gastos, ventas, costo por contacto y retorno): solo Dirección y quien tiene
//    «marketing.dinero» (Gerente de marketing). Al rol Marketing le llegan las cuentas sin montos.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { tipoReal } = require('./expediente-oc');

const RUBROS = { pauta: 'Publicidad pagada en redes', diseno: 'Diseño', impresion: 'Impresión y lonas', eventos: 'Eventos y patrocinios', video: 'Foto y video',
  herramientas: 'Herramientas y suscripciones', colaboraciones: 'Colaboraciones e influencers', otros: 'Otros' };
const ESTADOS_PRESUP = { borrador: 'Borrador', enviado: 'Enviado a Dirección', aprobado: 'Aprobado', rechazado: 'Rechazado' };
const ESTADOS_OBJ = { en_curso: 'En curso', logrado: 'Logrado', no_logrado: 'No logrado', cancelado: 'Cancelado' };
// Indicadores de las metas mensuales; los de dinero solo los ve y fija quien ve el dinero.
const INDICADORES = {
  publicaciones: { nombre: 'Publicaciones publicadas', dinero: false },
  contactos: { nombre: 'Contactos nuevos de canales de marketing', dinero: false },
  cotizaciones: { nombre: 'Cotizaciones de canales de marketing', dinero: false },
  ventas: { nombre: 'Vendido de canales de marketing (sin IVA)', dinero: true },
  gasto: { nombre: 'Tope de gasto del mes', dinero: true, tope: true },
};
const REDES = ['tiktok', 'facebook', 'instagram', 'linkedin', 'spotify'];
// Resultados de las publicaciones (los mismos datos que METRICAS e INTERACCIONES de server/marketing.js).
const METRICAS = ['alcance', 'impresiones', 'reproducciones', 'me_gusta', 'comentarios', 'compartidos', 'guardados', 'clics', 'mensajes'];
const INTERACCIONES = ['me_gusta', 'comentarios', 'compartidos', 'guardados'];
// Suma de interacciones y tasa sobre el alcance (null si no hay alcance).
const conTasa = r => { const i = INTERACCIONES.reduce((a, k) => a + (r[k] || 0), 0); return { ...r, interacciones: i, tasa: r.alcance ? Math.round((i / r.alcance) * 1000) / 10 : null }; };
const MAX_BYTES = 10 * 1024 * 1024;
const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' };
const centavos = v => Math.round(Number(v) * 100);
const pesos = c => Math.round(Number(c || 0)) / 100;
const periodoValido = p => /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
const fechaValida = f => { const d = new Date(f + 'T00:00:00Z'); return /^\d{4}-\d{2}-\d{2}$/.test(f) && !isNaN(d) && d.toISOString().slice(0, 10) === f; };
const montoValido = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1e8 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6; };
const nombreSeguro = t => String(t || 'comprobante').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120) || 'comprobante';
const encabezado = (req, k) => { try { return decodeURIComponent(String(req.get(k) || '')); } catch { return ''; } };
const ultimoDia = p => { const [a, m] = p.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };
const sumarDias = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

module.exports = function marketingControl(app, db, h) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mk_presupuestos (
      periodo TEXT PRIMARY KEY, estado TEXT NOT NULL DEFAULT 'borrador' CHECK(estado IN ('borrador','enviado','aprobado','rechazado')),
      motivo TEXT, propuesto_por INTEGER REFERENCES usuarios(id), enviado_at TEXT, aprobado_por INTEGER REFERENCES usuarios(id), aprobado_at TEXT,
      version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS mk_presupuesto_lineas (periodo TEXT NOT NULL REFERENCES mk_presupuestos(periodo), rubro TEXT NOT NULL, monto_cent INTEGER NOT NULL CHECK(monto_cent >= 0), PRIMARY KEY (periodo, rubro));
    CREATE TABLE IF NOT EXISTS mk_presupuesto_historial (id INTEGER PRIMARY KEY AUTOINCREMENT, periodo TEXT NOT NULL, usuario_id INTEGER REFERENCES usuarios(id), texto TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
    CREATE TABLE IF NOT EXISTS mk_gastos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL, concepto TEXT NOT NULL CHECK(length(trim(concepto)) BETWEEN 1 AND 160),
      rubro TEXT NOT NULL, proveedor TEXT NOT NULL DEFAULT '', monto_cent INTEGER NOT NULL CHECK(monto_cent > 0), factura TEXT NOT NULL DEFAULT '',
      red TEXT, proyecto_id INTEGER REFERENCES proyectos_marketing(id), notas TEXT NOT NULL DEFAULT '',
      comprobante_archivo TEXT, comprobante_formato TEXT, comprobante_nombre TEXT,
      registrado_por INTEGER REFERENCES usuarios(id), cancelado INTEGER NOT NULL DEFAULT 0, cancelado_por INTEGER REFERENCES usuarios(id), cancelado_at TEXT, motivo_cancelacion TEXT,
      version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_mk_gastos_fecha ON mk_gastos(fecha);
    CREATE TABLE IF NOT EXISTS mk_canales (canal_id INTEGER PRIMARY KEY REFERENCES canales(id));
    CREATE TABLE IF NOT EXISTS mk_objetivos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, anio INTEGER NOT NULL, titulo TEXT NOT NULL CHECK(length(trim(titulo)) BETWEEN 1 AND 160), descripcion TEXT NOT NULL DEFAULT '',
      responsable_id INTEGER REFERENCES usuarios(id), estado TEXT NOT NULL DEFAULT 'en_curso' CHECK(estado IN ('en_curso','logrado','no_logrado','cancelado')),
      creado_por INTEGER REFERENCES usuarios(id), version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS mk_metas (anio INTEGER NOT NULL, mes INTEGER NOT NULL CHECK(mes BETWEEN 1 AND 12), indicador TEXT NOT NULL, valor REAL NOT NULL CHECK(valor >= 0), PRIMARY KEY (anio, mes, indicador));
  `);
  if (!db.prepare('PRAGMA table_info(proyectos_marketing)').all().some(c => c.name === 'canal_id')) db.exec('ALTER TABLE proyectos_marketing ADD COLUMN canal_id INTEGER REFERENCES canales(id)');
  const base = process.env.DB_PATH ? path.dirname(path.resolve(process.env.DB_PATH)) : path.join(__dirname, '..');
  const DIR = path.join(base, 'archivos', 'marketing', 'gastos');
  const P = () => app.locals.permisos, yo = req => req.usuarioSesion.id, hoy = () => require('./fechas').hoyMexico();
  const direccion = req => P().direccion(req);
  const dinero = req => direccion(req) || P().puede(req, 'marketing.dinero');
  const editar = req => P().puede(req, 'marketing.editar');
  const texto = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const sinDinero = res => res.status(403).json({ error: 'El dinero de Marketing lo ven Dirección y el Gerente de marketing' });

  // ---------- Canales «de marketing» (los que cuentan para resultados y metas) ----------
  const canalesMk = () => {
    const marcados = db.prepare('SELECT canal_id FROM mk_canales').all().map(r => r.canal_id);
    const deProyectos = db.prepare('SELECT DISTINCT canal_id FROM main.proyectos_marketing WHERE canal_id IS NOT NULL').all().map(r => r.canal_id);
    return [...new Set([...marcados, ...deProyectos])];
  };
  // Contactos, cotizaciones y ventas de unos canales en un rango (se cuentan en toda la empresa: es el resultado de Marketing).
  function medir(canales, desde, hasta) {
    if (!canales.length) return { contactos: 0, cotizaciones: 0, ventas: 0, vendido_cent: 0 };
    const q = canales.map(() => '?').join(',');
    const c = db.prepare(`SELECT COUNT(*) n FROM main.clientes WHERE canal_origen_id IN (${q}) AND date(created_at) BETWEEN ? AND ?`).get(...canales, desde, hasta).n;
    const l = db.prepare(`SELECT COUNT(*) n, SUM(estatus = 'ganado') g, COALESCE(SUM(CASE WHEN estatus = 'ganado' THEN ROUND(valor * 100) END), 0) v FROM main.leads WHERE canal_id IN (${q}) AND date(created_at) BETWEEN ? AND ?`).get(...canales, desde, hasta);
    return { contactos: c, cotizaciones: l.n, ventas: l.g || 0, vendido_cent: l.v || 0 };
  }
  const gastoEntre = (desde, hasta, extra = '', args = []) => db.prepare(`SELECT COALESCE(SUM(monto_cent), 0) c FROM main.mk_gastos WHERE cancelado = 0 AND fecha BETWEEN ? AND ? ${extra}`).get(desde, hasta, ...args).c;

  // =================== PRESUPUESTO ===================
  function presupuesto(periodo) {
    const p = db.prepare('SELECT x.*, u.nombre propuesto_por_nombre, a.nombre aprobado_por_nombre FROM mk_presupuestos x LEFT JOIN usuarios u ON u.id = x.propuesto_por LEFT JOIN usuarios a ON a.id = x.aprobado_por WHERE x.periodo = ?').get(periodo)
      || { periodo, estado: 'borrador', version: 0, nuevo: true };
    const lineas = Object.fromEntries(db.prepare('SELECT rubro, monto_cent FROM mk_presupuesto_lineas WHERE periodo = ?').all(periodo).map(r => [r.rubro, r.monto_cent]));
    const gastado = Object.fromEntries(db.prepare('SELECT rubro, SUM(monto_cent) c FROM main.mk_gastos WHERE cancelado = 0 AND substr(fecha, 1, 7) = ? GROUP BY rubro').all(periodo).map(r => [r.rubro, r.c]));
    const filas = Object.entries(RUBROS).map(([k, n]) => ({ rubro: k, nombre: n, presupuesto: pesos(lineas[k] || 0), gastado: pesos(gastado[k] || 0), disponible: pesos((lineas[k] || 0) - (gastado[k] || 0)) }));
    const total = Object.values(lineas).reduce((a, b) => a + b, 0), totalGastado = Object.values(gastado).reduce((a, b) => a + b, 0);
    return { ...p, rubros: filas, total: pesos(total), gastado: pesos(totalGastado), disponible: pesos(total - totalGastado),
      historial: db.prepare('SELECT h.texto, h.created_at, u.nombre usuario FROM mk_presupuesto_historial h LEFT JOIN usuarios u ON u.id = h.usuario_id WHERE h.periodo = ? ORDER BY h.id DESC').all(periodo) };
  }
  const notaP = (periodo, req, t) => db.prepare('INSERT INTO main.mk_presupuesto_historial (periodo, usuario_id, texto) VALUES (?, ?, ?)').run(periodo, yo(req), t);
  app.get('/api/marketing/presupuestos/:periodo', h((req, res) => {
    if (!dinero(req)) return sinDinero(res);
    if (!periodoValido(req.params.periodo)) return res.status(400).json({ error: 'Mes no válido' });
    res.json({ ...presupuesto(req.params.periodo), puede: { editar: true, aprobar: direccion(req) } });
  }));
  // Guardar los montos por rubro: queda en borrador (si estaba enviado o aprobado, hay que volver a enviarlo).
  app.put('/api/marketing/presupuestos/:periodo', h((req, res) => {
    if (!dinero(req)) return sinDinero(res);
    const periodo = req.params.periodo; if (!periodoValido(periodo)) return res.status(400).json({ error: 'Mes no válido' });
    const lineas = req.body?.lineas; if (!lineas || typeof lineas !== 'object' || Array.isArray(lineas)) return res.status(400).json({ error: 'Faltan los montos por rubro' });
    for (const [k, v] of Object.entries(lineas)) { if (!RUBROS[k]) return res.status(400).json({ error: 'Rubro no válido: ' + k }); if (!montoValido(v)) return res.status(400).json({ error: `Revisa el monto de «${RUBROS[k]}» (de $0 a $100,000,000, máximo 2 decimales)` }); }
    const actual = db.prepare('SELECT * FROM mk_presupuestos WHERE periodo = ?').get(periodo);
    if (actual && req.body.version !== undefined && req.body.version !== actual.version) return res.status(409).json({ error: 'Otra persona cambió este presupuesto. Vuelve a abrirlo.' });
    db.transaction(() => {
      if (!actual) db.prepare('INSERT INTO main.mk_presupuestos (periodo, propuesto_por) VALUES (?, ?)').run(periodo, yo(req));
      for (const [k, v] of Object.entries(lineas)) {
        if (centavos(v) === 0) db.prepare('DELETE FROM main.mk_presupuesto_lineas WHERE periodo = ? AND rubro = ?').run(periodo, k);
        else db.prepare('INSERT INTO main.mk_presupuesto_lineas (periodo, rubro, monto_cent) VALUES (?, ?, ?) ON CONFLICT(periodo, rubro) DO UPDATE SET monto_cent = excluded.monto_cent').run(periodo, k, centavos(v));
      }
      const regresa = actual && ['enviado', 'aprobado'].includes(actual.estado);
      db.prepare("UPDATE main.mk_presupuestos SET estado = CASE WHEN estado = 'rechazado' THEN 'rechazado' ELSE 'borrador' END, propuesto_por = ?, aprobado_por = NULL, aprobado_at = NULL, version = version + 1, updated_at = datetime('now','localtime') WHERE periodo = ?").run(yo(req), periodo);
      notaP(periodo, req, 'Cambió los montos' + (regresa ? ' (estaba ' + ESTADOS_PRESUP[actual.estado].toLowerCase() + ': regresó a borrador y hay que enviarlo otra vez)' : ''));
    })();
    res.json({ ...presupuesto(periodo), puede: { editar: true, aprobar: direccion(req) } });
  }));
  const ACC_P = { enviar: [['borrador', 'rechazado'], 'enviado', false, 'Lo envió a Dirección'], aprobar: [['enviado', 'borrador', 'rechazado'], 'aprobado', true, 'Lo aprobó'], rechazar: [['enviado'], 'rechazado', true, 'Lo rechazó'] };
  app.post('/api/marketing/presupuestos/:periodo/estado', h((req, res) => {
    if (!dinero(req)) return sinDinero(res);
    const periodo = req.params.periodo, p = db.prepare('SELECT * FROM mk_presupuestos WHERE periodo = ?').get(periodo);
    if (!p) return res.status(404).json({ error: 'Ese mes todavía no tiene presupuesto' });
    const a = ACC_P[String(req.body?.accion || '')]; if (!a) return res.status(400).json({ error: 'Acción no válida' });
    if (a[2] && !direccion(req)) return res.status(403).json({ error: 'El presupuesto de Marketing lo aprueba solo Dirección' });
    if (req.body.version !== p.version) return res.status(409).json({ error: 'Otra persona cambió este presupuesto. Vuelve a abrirlo.' });
    if (!a[0].includes(p.estado)) return res.status(409).json({ error: `Está «${ESTADOS_PRESUP[p.estado]}»: no se puede` });
    if (!db.prepare('SELECT 1 FROM mk_presupuesto_lineas WHERE periodo = ?').get(periodo)) return res.status(400).json({ error: 'El presupuesto no tiene montos' });
    const motivo = texto(req.body.motivo, 500);
    if (a[1] === 'rechazado' && motivo.length < 3) return res.status(400).json({ error: 'Escribe por qué se rechaza' });
    db.transaction(() => {
      db.prepare(`UPDATE main.mk_presupuestos SET estado = ?, motivo = ?, ${a[1] === 'enviado' ? "enviado_at = datetime('now','localtime')," : ''} aprobado_por = ?, aprobado_at = ${a[1] === 'aprobado' ? "datetime('now','localtime')" : 'NULL'}, version = version + 1, updated_at = datetime('now','localtime') WHERE periodo = ?`)
        .run(a[1], motivo || null, a[1] === 'aprobado' ? yo(req) : null, periodo);
      notaP(periodo, req, a[3] + (motivo ? ': ' + motivo : ''));
    })();
    res.json({ ...presupuesto(periodo), puede: { editar: true, aprobar: direccion(req) } });
  }));
  // Los meses con presupuesto (para el selector) y sus totales.
  app.get('/api/marketing/presupuestos', h((req, res) => {
    if (!dinero(req)) return sinDinero(res);
    res.json(db.prepare('SELECT p.periodo, p.estado, (SELECT COALESCE(SUM(monto_cent), 0) FROM mk_presupuesto_lineas l WHERE l.periodo = p.periodo) total_cent FROM mk_presupuestos p ORDER BY p.periodo DESC LIMIT 60').all()
      .map(r => ({ periodo: r.periodo, estado: r.estado, total: pesos(r.total_cent) })));
  }));

  // =================== GASTOS ===================
  const gastoDe = id => db.prepare(`SELECT g.*, u.nombre registrado_por_nombre, c.nombre cancelado_por_nombre, pm.nombre proyecto_nombre FROM mk_gastos g LEFT JOIN usuarios u ON u.id = g.registrado_por
    LEFT JOIN usuarios c ON c.id = g.cancelado_por LEFT JOIN proyectos_marketing pm ON pm.id = g.proyecto_id WHERE g.id = ?`).get(id);
  const forma = g => g && ({ ...g, monto: pesos(g.monto_cent), monto_cent: undefined, comprobante_archivo: undefined, tiene_comprobante: !!g.comprobante_archivo });
  function validarGasto(body, actual) {
    const x = {};
    if (body.fecha !== undefined || !actual) { x.fecha = String(body.fecha || ''); if (!fechaValida(x.fecha) || x.fecha > sumarDias(hoy(), 1)) throw Error('Elige la fecha del gasto (no puede ser futura)'); }
    if (body.concepto !== undefined || !actual) { x.concepto = texto(body.concepto, 160); if (!x.concepto) throw Error('Escribe el concepto del gasto'); }
    if (body.rubro !== undefined || !actual) { x.rubro = String(body.rubro || ''); if (!RUBROS[x.rubro]) throw Error('Elige el rubro'); }
    if (body.monto !== undefined || !actual) { if (!montoValido(body.monto) || Number(body.monto) <= 0) throw Error('Escribe el monto (mayor a $0, máximo 2 decimales)'); x.monto_cent = centavos(body.monto); }
    if (body.proveedor !== undefined) x.proveedor = texto(body.proveedor, 120);
    if (body.factura !== undefined) x.factura = texto(body.factura, 60);
    if (body.notas !== undefined) x.notas = texto(body.notas, 1000);
    if (body.red !== undefined) { x.red = body.red ? String(body.red) : null; if (x.red && !REDES.includes(x.red)) throw Error('Red no válida'); }
    if (body.proyecto_id !== undefined) { x.proyecto_id = body.proyecto_id ? Number(body.proyecto_id) : null; if (x.proyecto_id && !db.prepare('SELECT id FROM proyectos_marketing WHERE id = ?').get(x.proyecto_id)) throw Error('Elige un proyecto válido'); }
    return x;
  }
  app.get('/api/marketing/gastos', h((req, res) => {
    if (!dinero(req)) return sinDinero(res);
    const desde = String(req.query.desde || ''), hasta = String(req.query.hasta || '');
    if (!fechaValida(desde) || !fechaValida(hasta) || desde > hasta) return res.status(400).json({ error: 'Indica el rango de fechas' });
    let where = 'g.fecha BETWEEN ? AND ?'; const args = [desde, hasta];
    if (req.query.rubro && RUBROS[req.query.rubro]) { where += ' AND g.rubro = ?'; args.push(req.query.rubro); }
    if (req.query.proyecto) { where += ' AND g.proyecto_id = ?'; args.push(Number(req.query.proyecto)); }
    if (req.query.q) { where += ' AND (sin_acentos(g.concepto) LIKE sin_acentos(?) OR sin_acentos(g.proveedor) LIKE sin_acentos(?) OR g.factura LIKE ?)'; args.push(...Array(3).fill('%' + req.query.q + '%')); }
    if (req.query.cancelados !== '1') where += ' AND g.cancelado = 0';
    const filas = db.prepare(`SELECT g.id FROM mk_gastos g WHERE ${where} ORDER BY g.fecha DESC, g.id DESC LIMIT 2000`).all(...args).map(r => forma(gastoDe(r.id)));
    res.json({ gastos: filas, total: pesos(filas.filter(g => !g.cancelado).reduce((a, g) => a + centavos(g.monto), 0)) });
  }));
  app.post('/api/marketing/gastos', h((req, res) => {
    if (!dinero(req)) return sinDinero(res);
    let x; try { x = validarGasto(req.body || {}, null); } catch (e) { return res.status(400).json({ error: e.message }); }
    x.registrado_por = yo(req); const ks = Object.keys(x);
    const r = db.prepare(`INSERT INTO main.mk_gastos (${ks.join(',')}) VALUES (${ks.map(() => '?').join(',')})`).run(...Object.values(x));
    app.locals.auditoria?.registrar(req, 'gasto_marketing', r.lastInsertRowid, 'alta', `${x.concepto} · $${pesos(x.monto_cent).toFixed(2)}`);
    res.status(201).json(forma(gastoDe(r.lastInsertRowid)));
  }));
  app.put('/api/marketing/gastos/:id', h((req, res) => {
    if (!dinero(req)) return sinDinero(res);
    const g = gastoDe(Number(req.params.id)); if (!g) return res.status(404).json({ error: 'Gasto no encontrado' });
    if (g.cancelado) return res.status(409).json({ error: 'El gasto está cancelado: no se cambia' });
    if (req.body?.version !== g.version) return res.status(409).json({ error: 'Otra persona cambió este gasto. Vuelve a abrirlo.' });
    let x; try { x = validarGasto(req.body || {}, g); } catch (e) { return res.status(400).json({ error: e.message }); }
    const ks = Object.keys(x); if (!ks.length) return res.json(forma(g));
    db.prepare(`UPDATE main.mk_gastos SET ${ks.map(k => k + ' = ?').join(', ')}, version = version + 1, updated_at = datetime('now','localtime') WHERE id = ?`).run(...Object.values(x), g.id);
    app.locals.auditoria?.registrar(req, 'gasto_marketing', g.id, 'cambio', ks.join(', '));
    res.json(forma(gastoDe(g.id)));
  }));
  app.post('/api/marketing/gastos/:id/cancelar', h((req, res) => {
    if (!dinero(req)) return sinDinero(res);
    const g = gastoDe(Number(req.params.id)); if (!g) return res.status(404).json({ error: 'Gasto no encontrado' });
    if (g.cancelado) return res.status(409).json({ error: 'Ya está cancelado' });
    const motivo = texto(req.body?.motivo, 500); if (motivo.length < 3) return res.status(400).json({ error: 'Escribe por qué se cancela' });
    db.prepare("UPDATE main.mk_gastos SET cancelado = 1, cancelado_por = ?, cancelado_at = datetime('now','localtime'), motivo_cancelacion = ?, version = version + 1 WHERE id = ?").run(yo(req), motivo, g.id);
    app.locals.auditoria?.registrar(req, 'gasto_marketing', g.id, 'cancelado', motivo);
    res.json(forma(gastoDe(g.id)));
  }));
  app.post('/api/marketing/gastos/:id/comprobante', express.raw({ type: () => true, limit: MAX_BYTES + 1024 }), h((req, res) => {
    if (!dinero(req)) return sinDinero(res);
    const g = gastoDe(Number(req.params.id)); if (!g) return res.status(404).json({ error: 'Gasto no encontrado' });
    if (g.cancelado) return res.status(409).json({ error: 'El gasto está cancelado' });
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buf.length) return res.status(400).json({ error: 'El archivo está vacío' });
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'El archivo pasa de 10 MB' });
    const formato = tipoReal(buf); if (!['pdf', 'jpg', 'png'].includes(formato)) return res.status(400).json({ error: 'El comprobante debe ser PDF, JPG o PNG' });
    const sha = crypto.createHash('sha256').update(buf).digest('hex'), archivo = `${g.id}-${sha.slice(0, 12)}.${formato}`;
    fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, archivo), buf);
    db.prepare("UPDATE main.mk_gastos SET comprobante_archivo = ?, comprobante_formato = ?, comprobante_nombre = ?, version = version + 1, updated_at = datetime('now','localtime') WHERE id = ?").run(archivo, formato, nombreSeguro(encabezado(req, 'x-nombre')), g.id);
    res.status(201).json(forma(gastoDe(g.id)));
  }));
  app.get('/api/marketing/gastos/:id/comprobante', h((req, res) => {
    if (!dinero(req)) return sinDinero(res);
    const g = gastoDe(Number(req.params.id)); if (!g?.comprobante_archivo) return res.status(404).json({ error: 'Sin comprobante' });
    const ruta = path.join(DIR, g.comprobante_archivo);
    if (!ruta.startsWith(DIR + path.sep) || !fs.existsSync(ruta)) return res.status(404).json({ error: 'El archivo ya no está en el servidor' });
    res.set({ 'Content-Type': MIME[g.comprobante_formato] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="comprobante.${g.comprobante_formato}"; filename*=UTF-8''${encodeURIComponent(g.comprobante_nombre || 'comprobante')}` });
    res.send(fs.readFileSync(ruta));
  }));

  // =================== RESULTADOS Y RETORNO ===================
  // Publicaciones ya publicadas en el rango con lo que se capturó de cada una (sin dinero: lo ve todo Marketing).
  function publicacionesEntre(desde, hasta) {
    const suma = METRICAS.map(k => `SUM(m.${k}) ${k}`).join(', ');
    const pubs = db.prepare(`SELECT p.id, p.titulo, p.fecha, p.formato, p.redes, COUNT(m.id) capturas, ${suma} FROM publicaciones p LEFT JOIN publicacion_metricas m ON m.publicacion_id = p.id
      WHERE p.estado = 'publicada' AND p.fecha BETWEEN ? AND ? GROUP BY p.id`).all(desde, hasta).map(r => conTasa({ ...r, redes: String(r.redes || '').split(',').filter(Boolean) }));
    pubs.sort((a, b) => b.interacciones - a.interacciones || (b.alcance || 0) - (a.alcance || 0) || b.fecha.localeCompare(a.fecha));
    const porRed = db.prepare(`SELECT m.red, COUNT(*) publicaciones, ${suma} FROM publicacion_metricas m JOIN publicaciones p ON p.id = m.publicacion_id
      WHERE p.estado = 'publicada' AND p.fecha BETWEEN ? AND ? GROUP BY m.red`).all(desde, hasta).map(conTasa).sort((a, b) => b.interacciones - a.interacciones);
    return { publicaciones: pubs, publicaciones_por_red: porRed, sin_capturar: pubs.filter(p => !p.capturas).length };
  }
  app.get('/api/marketing/resultados', h((req, res) => {
    const desde = String(req.query.desde || ''), hasta = String(req.query.hasta || '');
    if (!fechaValida(desde) || !fechaValida(hasta) || desde > hasta) return res.status(400).json({ error: 'Indica el rango de fechas' });
    const conDinero = dinero(req);
    const canales = db.prepare('SELECT id, nombre FROM canales ORDER BY orden, nombre').all();
    const marcados = new Set(db.prepare('SELECT canal_id FROM mk_canales').all().map(r => r.canal_id)), mk = new Set(canalesMk());
    const retorno = (vendido, gasto) => (gasto > 0 ? Math.round(((vendido - gasto) / gasto) * 1000) / 10 : null);
    // Por campaña: cada proyecto con canal, en su ventana (del inicio al fin + 30 días) que toque el rango pedido.
    const proyectos = db.prepare('SELECT pm.id, pm.nombre, pm.estado, pm.inicio, pm.fin, pm.canal_id, c.nombre canal FROM proyectos_marketing pm LEFT JOIN canales c ON c.id = pm.canal_id WHERE pm.inicio <= ? AND pm.fin >= ? ORDER BY pm.inicio DESC').all(hasta, sumarDias(desde, -30))
      .map(p => {
        const fin = [sumarDias(p.fin, 30), hoy()].sort()[0], m = p.canal_id ? medir([p.canal_id], p.inicio, fin) : { contactos: 0, cotizaciones: 0, ventas: 0, vendido_cent: 0 };
        const g = db.prepare('SELECT COALESCE(SUM(monto_cent), 0) c FROM main.mk_gastos WHERE cancelado = 0 AND proyecto_id = ?').get(p.id).c;
        const fila = { ...p, ventana: { desde: p.inicio, hasta: fin }, contactos: m.contactos, cotizaciones: m.cotizaciones, ventas: m.ventas, conversion: m.contactos ? Math.round((m.ventas / m.contactos) * 1000) / 10 : null };
        return conDinero ? { ...fila, gasto: pesos(g), vendido: pesos(m.vendido_cent), costo_contacto: m.contactos && g ? pesos(Math.round(g / m.contactos)) : null, retorno: retorno(m.vendido_cent, g) } : fila;
      });
    // Por canal (los de marketing) en el rango.
    const porCanal = canales.filter(c => mk.has(c.id)).map(c => { const m = medir([c.id], desde, hasta); return { canal_id: c.id, canal: c.nombre, contactos: m.contactos, cotizaciones: m.cotizaciones, ventas: m.ventas, ...(conDinero ? { vendido: pesos(m.vendido_cent) } : {}) }; });
    const t = medir([...mk], desde, hasta), gTot = gastoEntre(desde, hasta);
    const porRed = conDinero ? REDES.map(r => ({ red: r, gasto: pesos(gastoEntre(desde, hasta, 'AND red = ?', [r])) })).filter(x => x.gasto > 0) : [];
    const porRubro = conDinero ? Object.entries(RUBROS).map(([k, n]) => ({ rubro: k, nombre: n, gasto: pesos(gastoEntre(desde, hasta, 'AND rubro = ?', [k])) })).filter(x => x.gasto > 0) : [];
    res.json({ desde, hasta, dinero: conDinero, canales: canales.map(c => ({ ...c, marcado: marcados.has(c.id), por_proyecto: mk.has(c.id) && !marcados.has(c.id) })),
      totales: { contactos: t.contactos, cotizaciones: t.cotizaciones, ventas: t.ventas, conversion: t.contactos ? Math.round((t.ventas / t.contactos) * 1000) / 10 : null,
        ...(conDinero ? { gasto: pesos(gTot), vendido: pesos(t.vendido_cent), costo_contacto: t.contactos && gTot ? pesos(Math.round(gTot / t.contactos)) : null, retorno: retorno(t.vendido_cent, gTot) } : {}) },
      proyectos, por_canal: porCanal, por_red: porRed, por_rubro: porRubro, ...publicacionesEntre(desde, hasta) });
  }));
  // Qué canales cuentan como «de marketing» (además de los ligados a un proyecto).
  app.put('/api/marketing/canales', h((req, res) => {
    if (!editar(req)) return res.status(403).json({ error: 'Tu rol solo consulta Marketing' });
    const ids = Array.isArray(req.body?.canales) ? [...new Set(req.body.canales.map(Number))] : null;
    if (!ids) return res.status(400).json({ error: 'Faltan los canales' });
    const validos = new Set(db.prepare('SELECT id FROM canales').all().map(r => r.id));
    if (ids.some(i => !validos.has(i))) return res.status(400).json({ error: 'Canal no válido' });
    db.transaction(() => { db.prepare('DELETE FROM main.mk_canales').run(); for (const i of ids) db.prepare('INSERT INTO main.mk_canales (canal_id) VALUES (?)').run(i); })();
    res.json({ ok: true, canales: ids });
  }));
  // El canal de una campaña (proyecto).
  app.put('/api/marketing/proyectos/:id/canal', h((req, res) => {
    if (!editar(req)) return res.status(403).json({ error: 'Tu rol solo consulta Marketing' });
    const p = db.prepare('SELECT id FROM proyectos_marketing WHERE id = ?').get(Number(req.params.id)); if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const c = req.body?.canal_id ? Number(req.body.canal_id) : null;
    if (c && !db.prepare('SELECT id FROM canales WHERE id = ?').get(c)) return res.status(400).json({ error: 'Canal no válido' });
    db.prepare("UPDATE main.proyectos_marketing SET canal_id = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(c, p.id);
    res.json({ ok: true });
  }));

  // =================== PLAN ANUAL Y METAS ===================
  function realDelMes(anio, mes, conDinero) {
    const p = `${anio}-${String(mes).padStart(2, '0')}`, desde = p + '-01', hasta = ultimoDia(p), m = medir(canalesMk(), desde, hasta);
    const r = { publicaciones: db.prepare("SELECT COUNT(*) n FROM publicaciones WHERE estado = 'publicada' AND substr(fecha, 1, 7) = ?").get(p).n, contactos: m.contactos, cotizaciones: m.cotizaciones };
    return conDinero ? { ...r, ventas: pesos(m.vendido_cent), gasto: pesos(gastoEntre(desde, hasta)) } : r;
  }
  app.get('/api/marketing/plan/:anio', h((req, res) => {
    const anio = Number(req.params.anio); if (!Number.isInteger(anio) || anio < 2020 || anio > 2100) return res.status(400).json({ error: 'Año no válido' });
    const conDinero = dinero(req), visibles = Object.entries(INDICADORES).filter(([, i]) => conDinero || !i.dinero);
    const metas = {}; for (const r of db.prepare('SELECT mes, indicador, valor FROM mk_metas WHERE anio = ?').all(anio)) if (conDinero || !INDICADORES[r.indicador]?.dinero) (metas[r.mes] ||= {})[r.indicador] = r.valor;
    const mesHoy = hoy().slice(0, 7), real = {};
    for (let m = 1; m <= 12; m++) { const p = `${anio}-${String(m).padStart(2, '0')}`; if (p <= mesHoy) real[m] = realDelMes(anio, m, conDinero); }
    res.json({ anio, indicadores: Object.fromEntries(visibles), metas, real,
      objetivos: db.prepare('SELECT o.*, u.nombre responsable FROM mk_objetivos o LEFT JOIN usuarios u ON u.id = o.responsable_id WHERE o.anio = ? ORDER BY CASE o.estado WHEN \'en_curso\' THEN 0 ELSE 1 END, o.id').all(anio),
      estados_objetivo: ESTADOS_OBJ, puede: { editar: editar(req), dinero: conDinero } });
  }));
  app.put('/api/marketing/plan/:anio/metas', h((req, res) => {
    if (!editar(req)) return res.status(403).json({ error: 'Tu rol solo consulta Marketing' });
    const anio = Number(req.params.anio); if (!Number.isInteger(anio) || anio < 2020 || anio > 2100) return res.status(400).json({ error: 'Año no válido' });
    const metas = req.body?.metas; if (!metas || typeof metas !== 'object') return res.status(400).json({ error: 'Faltan las metas' });
    const cambios = [];
    for (const [mes, ind] of Object.entries(metas)) {
      const m = Number(mes); if (!Number.isInteger(m) || m < 1 || m > 12 || !ind || typeof ind !== 'object') return res.status(400).json({ error: 'Mes no válido' });
      for (const [k, v] of Object.entries(ind)) {
        if (!INDICADORES[k]) return res.status(400).json({ error: 'Indicador no válido: ' + k });
        if (INDICADORES[k].dinero && !dinero(req)) return sinDinero(res);
        if (v !== null && v !== '' && (!Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 1e9)) return res.status(400).json({ error: `Revisa la meta de «${INDICADORES[k].nombre}»` });
        cambios.push([m, k, v === null || v === '' ? null : Number(v)]);
      }
    }
    db.transaction(() => { for (const [m, k, v] of cambios) { if (v === null) db.prepare('DELETE FROM main.mk_metas WHERE anio = ? AND mes = ? AND indicador = ?').run(anio, m, k); else db.prepare('INSERT INTO main.mk_metas (anio, mes, indicador, valor) VALUES (?, ?, ?, ?) ON CONFLICT(anio, mes, indicador) DO UPDATE SET valor = excluded.valor').run(anio, m, k, v); } })();
    res.json({ ok: true, cambios: cambios.length });
  }));
  function validarObjetivo(req, body, actual) {
    const x = {};
    if (body.titulo !== undefined || !actual) { x.titulo = texto(body.titulo, 160); if (!x.titulo) throw Error('Escribe el objetivo'); }
    if (body.descripcion !== undefined) x.descripcion = texto(body.descripcion, 2000);
    if (body.estado !== undefined) { x.estado = String(body.estado); if (!ESTADOS_OBJ[x.estado]) throw Error('Estado no válido'); }
    if (body.responsable_id !== undefined) { const r = body.responsable_id ? Number(body.responsable_id) : null; if (r && !db.prepare('SELECT id FROM usuarios WHERE id = ? AND activo = 1').get(r)) throw Error('Elige a un responsable activo'); x.responsable_id = r; }
    return x;
  }
  app.post('/api/marketing/plan/:anio/objetivos', h((req, res) => {
    if (!editar(req)) return res.status(403).json({ error: 'Tu rol solo consulta Marketing' });
    const anio = Number(req.params.anio); if (!Number.isInteger(anio) || anio < 2020 || anio > 2100) return res.status(400).json({ error: 'Año no válido' });
    let x; try { x = validarObjetivo(req, req.body || {}, null); } catch (e) { return res.status(400).json({ error: e.message }); }
    x.anio = anio; x.creado_por = yo(req); if (x.responsable_id === undefined) x.responsable_id = yo(req);
    const ks = Object.keys(x); const r = db.prepare(`INSERT INTO main.mk_objetivos (${ks.join(',')}) VALUES (${ks.map(() => '?').join(',')})`).run(...Object.values(x));
    res.status(201).json(db.prepare('SELECT * FROM mk_objetivos WHERE id = ?').get(r.lastInsertRowid));
  }));
  app.put('/api/marketing/objetivos/:id', h((req, res) => {
    if (!editar(req)) return res.status(403).json({ error: 'Tu rol solo consulta Marketing' });
    const o = db.prepare('SELECT * FROM mk_objetivos WHERE id = ?').get(Number(req.params.id)); if (!o) return res.status(404).json({ error: 'Objetivo no encontrado' });
    if (req.body?.version !== o.version) return res.status(409).json({ error: 'Otra persona cambió este objetivo. Vuelve a abrirlo.' });
    let x; try { x = validarObjetivo(req, req.body || {}, o); } catch (e) { return res.status(400).json({ error: e.message }); }
    const ks = Object.keys(x); if (ks.length) db.prepare(`UPDATE main.mk_objetivos SET ${ks.map(k => k + ' = ?').join(', ')}, version = version + 1, updated_at = datetime('now','localtime') WHERE id = ?`).run(...Object.values(x), o.id);
    res.json(db.prepare('SELECT * FROM mk_objetivos WHERE id = ?').get(o.id));
  }));

  // =================== TABLERO DEL DEPARTAMENTO ===================
  app.get('/api/marketing/tablero', h((req, res) => {
    const h0 = hoy(), mes = periodoValido(String(req.query.mes || '')) ? String(req.query.mes) : h0.slice(0, 7), desde = mes + '-01', hasta = ultimoDia(mes), conDinero = dinero(req);
    const pubs = db.prepare('SELECT p.id, p.titulo, p.fecha, p.hora, p.estado, p.redes, p.responsable_id, u.nombre responsable FROM publicaciones p LEFT JOIN usuarios u ON u.id = p.responsable_id WHERE p.fecha BETWEEN ? AND ?').all(desde, hasta);
    const porEstado = {}; for (const p of pubs) porEstado[p.estado] = (porEstado[p.estado] || 0) + 1;
    const vencidas = pubs.filter(p => p.fecha < h0 && p.estado !== 'cancelada');
    const atrasadas = db.prepare("SELECT p.id, p.titulo, p.fecha, p.estado, p.redes, u.nombre responsable FROM publicaciones p LEFT JOIN usuarios u ON u.id = p.responsable_id WHERE p.fecha < ? AND p.estado IN ('borrador','revision','cambios','aprobada','programada') ORDER BY p.fecha LIMIT 50").all(h0)
      .map(p => ({ ...p, redes: String(p.redes || '').split(',').filter(Boolean) }));
    const porRed = {}; for (const p of pubs.filter(x => x.estado !== 'cancelada')) for (const r of String(p.redes || '').split(',').filter(Boolean)) porRed[r] = (porRed[r] || 0) + 1;
    // Carga de trabajo: por persona de Marketing, lo que tiene pendiente.
    const gente = db.prepare('SELECT id, nombre, rol FROM usuarios WHERE activo = 1 ORDER BY nombre').all().filter(u => P().tieneRol(u.rol, 'marketing.editar'));
    const carga = gente.map(u => {
      const pend = db.prepare("SELECT COUNT(*) n, SUM(fecha < ?) atr FROM publicaciones WHERE responsable_id = ? AND estado IN ('borrador','revision','cambios','aprobada','programada')").get(h0, u.id);
      const t = db.prepare("SELECT COUNT(*) n, SUM(t.fin < ?) atr, SUM(t.fin BETWEEN ? AND ?) semana FROM tareas_marketing t JOIN proyectos_marketing pm ON pm.id = t.proyecto_id WHERE t.eliminado = 0 AND t.avance < 100 AND t.responsable_id = ? AND pm.estado IN ('planeacion','en_curso')").get(h0, h0, sumarDias(h0, 7), u.id);
      return { id: u.id, nombre: u.nombre, publicaciones: pend.n, publicaciones_atrasadas: pend.atr || 0, tareas: t.n, tareas_atrasadas: t.atr || 0, tareas_semana: t.semana || 0 };
    }).filter(c => c.publicaciones || c.tareas);
    const proyectos = db.prepare("SELECT pm.id, pm.nombre, pm.estado, pm.inicio, pm.fin FROM proyectos_marketing pm WHERE pm.estado IN ('planeacion','en_curso','pausa') ORDER BY pm.fin").all().map(p => {
      const t = db.prepare('SELECT inicio, fin, avance FROM tareas_marketing WHERE proyecto_id = ? AND eliminado = 0').all(p.id);
      const peso = x => Math.max(1, Math.round((new Date(x.fin) - new Date(x.inicio)) / 864e5) + 1), tot = t.reduce((a, x) => a + peso(x), 0);
      return { ...p, avance: tot ? Math.round(t.reduce((a, x) => a + peso(x) * x.avance, 0) / tot) : 0, atrasadas: t.filter(x => x.avance < 100 && x.fin < h0).length, tareas: t.length };
    });
    const ideas = Object.fromEntries(db.prepare('SELECT estado, COUNT(*) n FROM ideas_marketing GROUP BY estado').all().map(r => [r.estado, r.n]));
    const [a, m] = mes.split('-').map(Number), metasMes = {};
    for (const r of db.prepare('SELECT indicador, valor FROM mk_metas WHERE anio = ? AND mes = ?').all(a, m)) if (conDinero || !INDICADORES[r.indicador]?.dinero) metasMes[r.indicador] = r.valor;
    const avisos = [];
    if (atrasadas.length) avisos.push({ tipo: 'rojo', texto: `${atrasadas.length} publicación(es) con fecha pasada sin publicar` });
    const porAprobar = db.prepare("SELECT COUNT(*) n FROM publicaciones WHERE estado = 'revision'").get().n; if (porAprobar) avisos.push({ tipo: 'alerta', texto: `${porAprobar} publicación(es) esperan aprobación` });
    const tareasAtr = carga.reduce((x, c) => x + c.tareas_atrasadas, 0); if (tareasAtr) avisos.push({ tipo: 'rojo', texto: `${tareasAtr} tarea(s) de proyectos atrasadas` });
    let dineroMes = null;
    if (conDinero) {
      const pr = presupuesto(mes);
      dineroMes = { estado: pr.estado, presupuesto: pr.total, gastado: pr.gastado, disponible: pr.disponible, rubros: pr.rubros.filter(r => r.presupuesto || r.gastado) };
      if (pr.nuevo || !pr.total) avisos.push({ tipo: 'alerta', texto: 'Este mes no tiene presupuesto capturado' });
      else if (pr.estado !== 'aprobado') avisos.push({ tipo: 'alerta', texto: 'El presupuesto del mes está ' + ESTADOS_PRESUP[pr.estado].toLowerCase() });
      for (const r of pr.rubros.filter(x => x.gastado > x.presupuesto && x.gastado > 0)) avisos.push({ tipo: 'rojo', texto: `${r.nombre}: se gastó más de lo presupuestado` });
    }
    res.json({ mes, hoy: h0, dinero: conDinero,
      publicaciones: { total: pubs.filter(p => p.estado !== 'cancelada').length, por_estado: porEstado, por_red: porRed,
        cumplimiento: vencidas.length ? Math.round((vencidas.filter(p => p.estado === 'publicada').length / vencidas.length) * 100) : null },
      atrasadas, carga, proyectos, ideas, metas: metasMes, real: realDelMes(a, m, conDinero), indicadores: Object.fromEntries(Object.entries(INDICADORES).filter(([, i]) => conDinero || !i.dinero)),
      dinero_mes: dineroMes, avisos, rubros: RUBROS });
  }));

  // Catálogos de esta parte (rubros, estados).
  app.get('/api/marketing/control', h((req, res) => res.json({ rubros: RUBROS, estados_presupuesto: ESTADOS_PRESUP, puede: { dinero: dinero(req), aprobar_presupuesto: direccion(req), editar: editar(req) } })));
};
