// BIOMÉTRICO FACIAL DEL KIOSCO (RH, 2026-11-05, decidido con Dirección).
//  · Solo de quien firmó su consentimiento. Los expedientes son FÍSICOS (Dirección, 2026-11-05): RH marca en la ficha
//    «Firmó el consentimiento biométrico» (queda quién y cuándo). También vale el documento «Consentimiento biométrico
//    firmado» si se sube al expediente digital. Sin consentimiento, la persona checa como siempre y su plantilla no se usa.
//  · Registro EN LA TABLETA con RH: desde la ficha, RH da un código de 6 dígitos (un solo uso, 10 min); en el kiosco,
//    «Registrar mi cara» → código → se toman 3 muestras mirando de frente (sin prueba de vida: RH está presente). La tableta calcula los descriptores
//    (face-api, alojado en /vendor/face-api) y el servidor guarda SOLO su promedio, CIFRADO. Las fotos no se guardan.
//  · Al checar: comparación 1:1 contra SU plantilla (ya se sabe quién es por código y PIN), con prueba de vida
//    (prueba de vida pasiva: foto o pantalla vs. cara real). Si no coincide, la persona checa igual pero la checada queda «por revisar» (decidido con Dirección).
//    La tableta toma la cara una vez (otra solo si no la vio); la decisión final la toma el servidor.
//  · Nadie ve ni descarga la plantilla. Se borra al revocar el consentimiento (quitar la marca, borrar el registro o
//    quitar el documento) y al causar baja (revisión cada 12 h).
//  · Umbral: distancia euclidiana entre descriptores de face-api (128 números); ≤ BIOMETRIA_UMBRAL (0.55 por omisión)
//    = la misma persona.
const crypto = require('crypto');
const C = require('./cifrado');
const { hashToken } = require('./seguridad');

const UMBRAL = (() => { const u = Number(process.env.BIOMETRIA_UMBRAL); return u > 0.2 && u < 0.9 ? u : 0.55; })();
const CODIGO_MS = 10 * 60 * 1000, MUESTRAS = 3, CONSISTENCIA = 0.6, FALLOS_CODIGO = 10, VENTANA_MS = 10 * 60 * 1000;
const contexto = id => `rostros.plantilla:${id}`;
const idDe = v => { if (!/^\d{1,15}$/.test(String(v))) return 0; const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : 0; };
// Un descriptor válido: 128 números finitos y chicos (face-api da valores entre −1 y 1, aprox.).
const descriptorDe = v => (Array.isArray(v) && v.length === 128 && v.every(x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 2) ? v : null);
const distancia = (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));

function migrar(db) {
  const cols = db.prepare('PRAGMA table_info(personal)').all().map(c => c.name);
  if (!cols.includes('biometria_consentimiento_at')) db.exec('ALTER TABLE personal ADD COLUMN biometria_consentimiento_at TEXT');
  if (!cols.includes('biometria_consentimiento_por')) db.exec('ALTER TABLE personal ADD COLUMN biometria_consentimiento_por TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS rostros (
      personal_id INTEGER PRIMARY KEY REFERENCES personal(id),
      plantilla TEXT NOT NULL,
      muestras INTEGER NOT NULL,
      kiosco TEXT, autorizado_por_nombre TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS rostro_codigos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      personal_id INTEGER NOT NULL REFERENCES personal(id),
      codigo_hash TEXT NOT NULL UNIQUE, expira_ms INTEGER NOT NULL, usado_at TEXT,
      creado_por INTEGER, creado_por_nombre TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);
}

module.exports = function biometria(app, db, h) {
  migrar(db);
  const P = app.locals.permisos, puede = (req, k) => P.puede(req, k);
  const negar = (res, msg) => res.status(403).json({ error: msg || 'No tienes permiso para el biométrico' });
  const audit = (req, id, accion, detalle) => app.locals.auditoria?.registrar(req, 'personal', id, accion, detalle);
  const marca = pid => db.prepare('SELECT biometria_consentimiento_at AS at, biometria_consentimiento_por AS por FROM main.personal WHERE id = ?').get(pid) || {};
  const consentimiento = pid => !!marca(pid).at || !!db.prepare("SELECT 1 FROM main.documentos_personal WHERE personal_id = ? AND tipo = 'biometria' AND eliminado = 0").get(pid);
  const fila = pid => db.prepare('SELECT * FROM main.rostros WHERE personal_id = ?').get(pid);
  const plantillaDe = pid => { const f = fila(pid); if (!f) return null; try { return JSON.parse(C.descifrar(f.plantilla, contexto(pid))); } catch { return null; } };
  const activo = pid => consentimiento(pid) && !!fila(pid);
  const estado = pid => { const f = fila(pid), m = marca(pid); return { consentimiento: consentimiento(pid), consentimiento_at: m.at || null, consentimiento_por: m.por || null, registrado: !!f, registrado_at: f?.created_at || null }; };

  // Revisión: sin consentimiento o dado de baja → la plantilla se borra.
  function limpiar() {
    const r = db.prepare(`DELETE FROM main.rostros WHERE personal_id IN (SELECT id FROM main.personal WHERE activo = 0)
      OR (personal_id IN (SELECT id FROM main.personal WHERE biometria_consentimiento_at IS NULL)
        AND personal_id NOT IN (SELECT personal_id FROM main.documentos_personal WHERE tipo = 'biometria' AND eliminado = 0))`).run();
    if (r.changes) console.log(`[biometria] Se borraron ${r.changes} plantilla(s) de personas sin consentimiento o dadas de baja.`);
  }
  setTimeout(() => { try { limpiar(); } catch (e) { console.error('[biometria] limpieza:', e.message); } }, 90 * 1000).unref();
  setInterval(() => { try { limpiar(); } catch (e) { console.error('[biometria] limpieza:', e.message); } }, 12 * 3600000).unref();

  // Evalúa la cara de una checada. null = la persona no usa biométrico. Si no, { resultado, distancia, nota } y
  // «nota» (si la hay) deja la checada por revisar.
  function evaluar(pid, rostro) {
    if (!activo(pid)) return null;
    const plantilla = plantillaDe(pid);
    if (!plantilla) return { resultado: 'sin_registro', distancia: null, nota: 'Biométrico: su registro no se pudo leer (que RH lo vuelva a registrar)' };
    const d = descriptorDe(rostro?.descriptor);
    if (!d) return { resultado: 'sin_rostro', distancia: null, nota: 'Biométrico: no se detectó su cara' };
    if (rostro.vivo !== true) return { resultado: 'no_vivo', distancia: null, nota: 'Biométrico: no pasó la prueba de vida (parece foto o pantalla)' };
    const dist = Math.round(distancia(d, plantilla) * 1000) / 1000;
    return dist <= UMBRAL ? { resultado: 'coincide', distancia: dist, nota: null } : { resultado: 'no_coincide', distancia: dist, nota: `Biométrico: la cara no coincide (${dist.toFixed(2)})` };
  }

  // Registro desde el kiosco con el código que dio RH. Regresa { status, error } o { ok, nombre }.
  const fallos = new Map();
  setInterval(() => { const t = Date.now(); for (const [k, v] of fallos) if (v.reinicia <= t) fallos.delete(k); }, VENTANA_MS).unref();
  function registrar(kiosco, codigo, descriptores, vivo) {
    const f = fallos.get(kiosco.id);
    if (f && f.reinicia > Date.now() && f.n >= FALLOS_CODIGO) return { status: 429, error: 'Demasiados códigos equivocados en este kiosco. Espera 10 minutos.' };
    const malo = () => { const t = Date.now(); let r = fallos.get(kiosco.id); if (!r || r.reinicia <= t) { r = { n: 0, reinicia: t + VENTANA_MS }; fallos.set(kiosco.id, r); } r.n++; return { status: 401, error: 'Código equivocado o vencido. Pide a RH uno nuevo.' }; };
    const c = /^\d{6}$/.test(String(codigo || '')) ? db.prepare('SELECT * FROM main.rostro_codigos WHERE codigo_hash = ?').get(hashToken('rostro:' + codigo)) : null;
    if (!c || c.usado_at || c.expira_ms < Date.now()) return malo();
    const p = db.prepare('SELECT * FROM main.personal WHERE id = ? AND activo = 1').get(c.personal_id);
    if (!p || !consentimiento(p.id)) return { status: 409, error: 'Falta marcar en su ficha que firmó el consentimiento biométrico.' };
    // Sin prueba de vida al registrar (2026-11-06): RH está presente, por eso dio el código. Al checar sí se pide.
    const ds = Array.isArray(descriptores) ? descriptores.map(descriptorDe) : [];
    if (ds.length !== MUESTRAS || ds.some(d => !d)) return { status: 400, error: 'No se tomaron bien las 3 muestras de la cara. Vuelve a intentarlo.' };
    // Las 3 muestras deben ser de la misma persona (si no, alguien se cruzó frente a la cámara).
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) if (distancia(ds[i], ds[j]) > CONSISTENCIA) return { status: 400, error: 'Las muestras no se parecen entre sí. Que solo esté la persona frente a la cámara y vuelve a intentarlo.' };
    const prom = Array.from({ length: 128 }, (_, k) => Math.round((ds.reduce((s, d) => s + d[k], 0) / ds.length) * 1e6) / 1e6);
    db.transaction(() => {
      db.prepare('INSERT INTO main.rostros (personal_id, plantilla, muestras, kiosco, autorizado_por_nombre) VALUES (?, ?, ?, ?, ?) ON CONFLICT(personal_id) DO UPDATE SET plantilla = excluded.plantilla, muestras = excluded.muestras, kiosco = excluded.kiosco, autorizado_por_nombre = excluded.autorizado_por_nombre, created_at = datetime(\'now\',\'localtime\')')
        .run(p.id, C.cifrar(JSON.stringify(prom), contexto(p.id)), ds.length, kiosco.nombre, c.creado_por_nombre);
      db.prepare("UPDATE main.rostro_codigos SET usado_at = datetime('now','localtime') WHERE id = ?").run(c.id);
    })();
    audit(null, p.id, 'biométrico', `${p.nombre}: registró su cara en el kiosco «${kiosco.nombre}» (código de ${c.creado_por_nombre || 'RH'})`);
    return { ok: true, nombre: String(p.nombre).split(/\s+/)[0] };
  }

  // ---------- Administración (desde la ficha) ----------
  const persona = id => db.prepare('SELECT * FROM personal WHERE id = ?').get(idDe(id)); // vista: solo sus sucursales
  app.post('/api/asistencia/personal/:id/biometria/codigo', h((req, res) => {
    if (!puede(req, 'personal.editar')) return negar(res, 'No tienes permiso para registrar el biométrico');
    const p = persona(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    if (app.locals.personal.esPropio(req, res, p.id, 'registrar tu propia cara')) return;
    if (!p.activo || !p.codigo_checador) return res.status(409).json({ error: 'Primero dala de alta en el reloj checador (código y PIN)' });
    if (!consentimiento(p.id)) return res.status(409).json({ error: 'Primero marca en su ficha que firmó el consentimiento biométrico' });
    const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    db.transaction(() => {
      db.prepare("UPDATE main.rostro_codigos SET usado_at = 'cancelado' WHERE personal_id = ? AND usado_at IS NULL").run(p.id);
      db.prepare('INSERT INTO main.rostro_codigos (personal_id, codigo_hash, expira_ms, creado_por, creado_por_nombre) VALUES (?, ?, ?, ?, ?)').run(p.id, hashToken('rostro:' + codigo), Date.now() + CODIGO_MS, req.usuarioSesion.id, req.usuarioSesion.nombre);
    })();
    audit(req, p.id, 'biométrico', `${p.nombre}: código para registrar su cara en el kiosco (10 min, un solo uso)`);
    res.json({ codigo, minutos: CODIGO_MS / 60000 });
  }));
  // Marca de consentimiento firmado (expediente físico). Quitarla = revocó: se borra su plantilla.
  app.put('/api/asistencia/personal/:id/biometria/consentimiento', h((req, res) => {
    if (!puede(req, 'personal.editar')) return negar(res, 'No tienes permiso para el biométrico');
    const p = persona(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    if (typeof req.body?.firmado !== 'boolean') return res.status(400).json({ error: 'Indica si firmó o no' });
    if (app.locals.personal.esPropio(req, res, p.id, 'marcar tu propio consentimiento biométrico')) return;
    if (req.body.firmado) {
      db.prepare("UPDATE main.personal SET biometria_consentimiento_at = datetime('now','localtime'), biometria_consentimiento_por = ? WHERE id = ?").run(req.usuarioSesion.nombre, p.id);
      audit(req, p.id, 'biométrico', `${p.nombre}: se marcó que firmó el consentimiento biométrico (expediente físico)`);
    } else {
      db.transaction(() => {
        db.prepare('UPDATE main.personal SET biometria_consentimiento_at = NULL, biometria_consentimiento_por = NULL WHERE id = ?').run(p.id);
        db.prepare('DELETE FROM main.rostros WHERE personal_id = ?').run(p.id);
        db.prepare("UPDATE main.rostro_codigos SET usado_at = 'cancelado' WHERE personal_id = ? AND usado_at IS NULL").run(p.id);
      })();
      audit(req, p.id, 'biométrico', `${p.nombre}: se quitó el consentimiento biométrico (revocó) y se borró el registro de su cara`);
    }
    res.json({ ok: true, ...estado(p.id) });
  }));
  app.post('/api/asistencia/personal/:id/biometria/borrar', h((req, res) => {
    if (!puede(req, 'personal.editar')) return negar(res, 'No tienes permiso para borrar el biométrico');
    const p = persona(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    if (app.locals.personal.esPropio(req, res, p.id, 'borrar tu propio registro biométrico')) return;
    const r = db.prepare('DELETE FROM main.rostros WHERE personal_id = ?').run(p.id);
    db.prepare("UPDATE main.rostro_codigos SET usado_at = 'cancelado' WHERE personal_id = ? AND usado_at IS NULL").run(p.id);
    if (r.changes) audit(req, p.id, 'biométrico', `${p.nombre}: se borró su registro de la cara`);
    res.json({ ok: true, borrado: r.changes });
  }));

  return { evaluar, registrar, activo, estado, UMBRAL };
};
module.exports.descriptorDe = descriptorDe;
