// CREDENCIALES DE EMPLEADO (2026-11-05, decidido con Dirección): sirven para checar Y para identificarse en las
// empresas de los clientes.
//  · Frente: foto, nombre, puesto, sucursal, número de empleado y VIGENCIA. Reverso: QR del checador (el kiosco lo lee
//    en lugar de teclear el código; el PIN se sigue pidiendo), QR de VERIFICACIÓN para el cliente, contacto de
//    emergencia y teléfono de la empresa. Sin NSS, CURP ni tipo de sangre (datos sensibles: si se pierde, se exponen).
//  · Foto: la sube o la toma quien edita el personal, desde la ficha. Se guarda cifrada (como el expediente).
//  · Emitir (imprimir) una credencial le da un token nuevo de verificación (la base guarda solo su hash) y ANULA la
//    anterior de esa persona: si alguien la pierde, se imprime otra y la vieja deja de valer.
//  · Verificación pública en /credencial/<token>: el guardia escanea el QR y ve foto, nombre, puesto y «VIGENTE» si la
//    persona sigue activa, la credencial es la última que se le imprimió y no ha vencido. Si no, solo «NO VÁLIDA», sin
//    datos de la persona. Con tope de consultas por conexión.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./cifrado');
const { tipoReal } = require('./expediente-oc');
const { hashToken, nuevoToken } = require('./seguridad');
const { ahoraMexico } = require('./fechas');

const MAX_FOTO = 2 * 1024 * 1024, MAX_IDS = 300, MAX_VIGENCIA_DIAS = 3 * 366;
const contextoFoto = id => `personal.foto:${id}`;
const idDe = v => { if (!/^\d{1,15}$/.test(String(v))) return 0; const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : 0; };
const fechaOk = v => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return false; const d = new Date(v + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; };
const escHtml = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fechaCorta = f => `${Number(f.slice(8, 10))} ${MESES[Number(f.slice(5, 7)) - 1]} ${f.slice(0, 4)}`;

function migrar(db) {
  const cols = db.prepare('PRAGMA table_info(personal)').all().map(c => c.name);
  if (!cols.includes('foto_archivo')) db.exec('ALTER TABLE personal ADD COLUMN foto_archivo TEXT');
  if (!cols.includes('foto_at')) db.exec('ALTER TABLE personal ADD COLUMN foto_at TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS credenciales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      personal_id INTEGER NOT NULL REFERENCES personal(id),
      token_hash TEXT NOT NULL UNIQUE,
      vigencia TEXT NOT NULL,
      emitida_por INTEGER, emitida_por_nombre TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      anulada_at TEXT, anulada_motivo TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_credenciales_persona ON credenciales(personal_id);
    CREATE TRIGGER IF NOT EXISTS credenciales_no_borrar BEFORE DELETE ON credenciales
      BEGIN SELECT RAISE(ABORT, 'Las credenciales emitidas no se borran: se anulan'); END;
    CREATE TRIGGER IF NOT EXISTS credenciales_fijas BEFORE UPDATE OF personal_id, token_hash, vigencia, emitida_por, created_at ON credenciales
      BEGIN SELECT RAISE(ABORT, 'Una credencial emitida no se cambia: se imprime otra'); END;
  `);
}

module.exports = function credenciales(app, db, h) {
  migrar(db);
  const P = app.locals.permisos, puede = (req, k) => P.puede(req, k);
  const negar = (res, msg) => res.status(403).json({ error: msg || 'No tienes permiso para las credenciales' });
  const audit = (req, id, accion, detalle) => app.locals.auditoria?.registrar(req, 'personal', id, accion, detalle);
  const base = process.env.DB_PATH ? path.dirname(path.resolve(process.env.DB_PATH)) : path.join(__dirname, '..');
  const DIR = path.join(base, 'archivos', 'credenciales');
  const persona = id => db.prepare('SELECT * FROM personal WHERE id = ?').get(idDe(id)); // vista: solo sus sucursales
  const leerFoto = p => {
    if (!p?.foto_archivo) return null;
    const ruta = path.join(DIR, p.foto_archivo);
    if (!ruta.startsWith(DIR + path.sep) || !fs.existsSync(ruta)) return null;
    try { return C.descifrarArchivo(fs.readFileSync(ruta), contextoFoto(p.id)); } catch { return null; }
  };

  // ---------- Foto para la credencial ----------
  app.post('/api/personal/:id/foto', require('express').raw({ type: () => true, limit: MAX_FOTO + 1024 }), h((req, res) => {
    if (!puede(req, 'personal.editar')) return negar(res, 'No tienes permiso para cambiar la foto');
    const p = persona(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buf.length) return res.status(400).json({ error: 'La foto está vacía' });
    if (buf.length > MAX_FOTO) return res.status(413).json({ error: 'La foto pasa de 2 MB' });
    const tipo = tipoReal(buf);
    if (!['jpg', 'png'].includes(tipo)) return res.status(400).json({ error: 'La foto debe ser JPG o PNG' });
    const archivo = `${p.id}-${crypto.randomBytes(8).toString('hex')}.${tipo}.cifrado`;
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    C.escribirSeguro(path.join(DIR, archivo), C.cifrarArchivo(buf, contextoFoto(p.id)));
    db.prepare("UPDATE main.personal SET foto_archivo = ?, foto_at = datetime('now','localtime') WHERE id = ?").run(archivo, p.id);
    if (p.foto_archivo && p.foto_archivo !== archivo) { const vieja = path.join(DIR, p.foto_archivo); if (vieja.startsWith(DIR + path.sep)) fs.rmSync(vieja, { force: true }); }
    audit(req, p.id, 'foto', `${p.nombre}: foto para su credencial`);
    res.status(201).json({ ok: true });
  }));
  app.get('/api/personal/:id/foto', h((req, res) => {
    if (!puede(req, 'personal.ver')) return negar(res, 'No tienes permiso para ver el personal');
    const p = persona(req.params.id), buf = leerFoto(p);
    if (!buf) return res.status(404).json({ error: 'Sin foto' });
    res.set({ 'Content-Type': tipoReal(buf) === 'png' ? 'image/png' : 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
    res.send(buf);
  }));

  // ---------- Emitir (imprimir) credenciales ----------
  // Regresa por persona el token de verificación (solo existe en esta respuesta) y los datos para imprimir.
  app.post('/api/rh/credenciales', h((req, res) => {
    if (!puede(req, 'personal.editar')) return negar(res, 'No tienes permiso para imprimir credenciales');
    const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(idDe).filter(Boolean))] : null, vigencia = String(req.body?.vigencia || '');
    if (!ids || !ids.length) return res.status(400).json({ error: 'Elige al menos a una persona' });
    if (ids.length > MAX_IDS) return res.status(400).json({ error: `Máximo ${MAX_IDS} credenciales a la vez` });
    const hoy = ahoraMexico().fecha, tope = new Date(Date.parse(hoy + 'T12:00:00Z') + MAX_VIGENCIA_DIAS * 86400000).toISOString().slice(0, 10);
    if (!fechaOk(vigencia) || vigencia <= hoy || vigencia > tope) return res.status(400).json({ error: 'La vigencia debe ser una fecha futura, de hasta 3 años' });
    const gente = ids.map(persona);
    if (gente.some(p => !p || !p.activo)) return res.status(404).json({ error: 'Alguna persona no existe o está dada de baja' });
    const sucursales = new Map(db.prepare('SELECT id, nombre FROM main.sucursales').all().map(s => [s.id, s.nombre]));
    const base = process.env.APP_URL ? process.env.APP_URL.replace(/\/+$/, '') : null;
    const emitidas = db.transaction(() => gente.map(p => {
      db.prepare("UPDATE main.credenciales SET anulada_at = datetime('now','localtime'), anulada_motivo = 'Se imprimió una nueva' WHERE personal_id = ? AND anulada_at IS NULL").run(p.id);
      const token = nuevoToken();
      db.prepare('INSERT INTO main.credenciales (personal_id, token_hash, vigencia, emitida_por, emitida_por_nombre) VALUES (?, ?, ?, ?, ?)').run(p.id, hashToken(token), vigencia, req.usuarioSesion.id, req.usuarioSesion.nombre);
      return { personal_id: p.id, numero_empleado: p.numero_empleado, nombre: p.nombre, puesto: p.puesto, sucursal: sucursales.get(p.sucursal_id) || null,
        codigo: p.codigo_checador || null, contacto_emergencia: p.contacto_emergencia || null, tel_emergencia: p.tel_emergencia || null, tiene_foto: !!p.foto_archivo,
        vigencia, ruta: '/credencial/' + token, url: base ? base + '/credencial/' + token : null };
    }))();
    for (const e of emitidas) audit(req, e.personal_id, 'credencial', `${e.nombre}: credencial impresa, vigente hasta ${e.vigencia} (la anterior queda anulada)`);
    res.status(201).json({ credenciales: emitidas });
  }));

  // ---------- Verificación pública (la abre el guardia con el QR) ----------
  const consultas = new Map(), TOPE = 60, VENTANA = 10 * 60 * 1000;
  setInterval(() => { const t = Date.now(); for (const [k, v] of consultas) if (v.reinicia <= t) consultas.delete(k); }, VENTANA).unref();
  const pagina = (titulo, cuerpo) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>${escHtml(titulo)} · Saneadren</title><style>body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f4f5f7;color:#1f2937}
header{background:#1a1d23;border-bottom:4px solid #f6b103;padding:12px 16px}header img{height:36px;display:block}main{max-width:460px;margin:20px auto;padding:0 16px}
.tarjeta{background:#fff;border-radius:14px;padding:20px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.08)}.estado{font-size:1.5rem;font-weight:800;margin:6px 0 14px}
.ok{color:#15803d}.no{color:#b91c1c}.foto{width:160px;height:200px;object-fit:cover;border-radius:10px;border:3px solid #e5e7eb}h1{font-size:1.3rem;margin:12px 0 4px}p{margin:4px 0;color:#4b5563}small{color:#6b7280}</style></head>
<body><header><img src="/logo-saneadren.png" alt="Saneadren"></header><main><div class="tarjeta">${cuerpo}</div><p style="text-align:center;margin-top:14px"><small>Verificación de credenciales de Saneadren · consultado el ${escHtml(ahoraMexico().fecha.split('-').reverse().join('/'))} a las ${escHtml(ahoraMexico().hora.slice(0, 5))}</small></p></main></body></html>`;
  app.get('/credencial/:token', (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
    const k = req.ipCliente || req.ip, t = Date.now(); let r = consultas.get(k);
    if (!r || r.reinicia <= t) { r = { n: 0, reinicia: t + VENTANA }; consultas.set(k, r); }
    if (++r.n > TOPE) return res.status(429).type('html').send(pagina('Espera un momento', '<p class="estado no">Demasiadas consultas</p><p>Espera unos minutos y vuelve a escanear.</p>'));
    const tok = String(req.params.token || '');
    const c = /^[A-Za-z0-9_-]{40,60}$/.test(tok) ? db.prepare('SELECT * FROM main.credenciales WHERE token_hash = ?').get(hashToken(tok)) : null;
    const p = c ? db.prepare('SELECT * FROM main.personal WHERE id = ?').get(c.personal_id) : null, hoy = ahoraMexico().fecha;
    if (!c || !p || c.anulada_at || !p.activo || c.vigencia < hoy) {
      return res.status(c ? 200 : 404).type('html').send(pagina('Credencial no válida', `<p class="estado no">✘ CREDENCIAL NO VÁLIDA</p>
        <p>Esta credencial no está vigente: la persona ya no trabaja en Saneadren, la credencial fue reemplazada por otra o ya venció.</p><p><b>No permita el acceso con ella.</b></p>`));
    }
    const foto = leerFoto(p), suc = db.prepare('SELECT nombre FROM main.sucursales WHERE id = ?').get(p.sucursal_id)?.nombre;
    const img = foto ? `<img class="foto" alt="Foto" src="data:${tipoReal(foto) === 'png' ? 'image/png' : 'image/jpeg'};base64,${foto.toString('base64')}">` : '<p><small>(sin foto registrada)</small></p>';
    res.type('html').send(pagina('Credencial vigente', `<p class="estado ok">✔ CREDENCIAL VIGENTE</p>${img}<h1>${escHtml(p.nombre)}</h1><p>${escHtml(p.puesto || '')}${suc ? ' · ' + escHtml(suc) : ''}</p>
      <p>No. de empleado <b>${escHtml(p.numero_empleado || '')}</b></p><p>Vigente hasta el <b>${escHtml(fechaCorta(c.vigencia))}</b></p>
      <p><small>Compare la foto con la persona que la presenta.</small></p>`));
  });
};
