// PERSONAL (RH): todas las personas de la empresa —técnicos, operadores, ayudantes, administrativos—, tengan o no
// cuenta en el sistema. Cada usuario del CRM puede ligarse a su ficha.
//  · Ficha: datos generales, licencia de manejo (con vencimiento), datos de pago (banco y CLABE) y expediente
//    (RFC, CURP, NSS, salario, contrato, documentos escaneados), vacaciones e incidencias.
//  · Permisos (permisos.js): «personal.ver» (lista y fichas sin datos sensibles), «personal.editar» (altas, cambios,
//    bajas e incidencias) y «personal.sensibles» (pagos, expediente y documentos). Sin ese último, la CLABE sale
//    enmascarada y lo sensible no se manda ni se acepta. Cada cambio queda en la bitácora, pero sin los datos
//    sensibles (la CLABE solo con sus últimos 4 dígitos; RFC, CURP, NSS, salario y contrato solo «cambió»).
//  · Cifrado (cifrado.js): CLABE, RFC, CURP, NSS y salario se guardan cifrados (AES-256-GCM) y amarrados a su
//    persona y campo; los documentos del expediente, también. La lista nunca los manda (ni con permiso): solo la
//    ficha de una persona, y cada consulta de datos sensibles queda en la bitácora.
//  · Por sucursal, como lo demás: la vista «personal» solo muestra la gente de las sucursales de quien pide.
//  · En cada orden de servicio: un técnico responsable y, opcional, operadores y ayudantes (tabla orden_personal).
//    El responsable, si tiene cuenta, es el «técnico asignado» de la orden (leads.tecnico_id): la ve y la marca
//    realizada. Si se liga o desliga su cuenta después, sus órdenes se actualizan.
//  · Vacaciones según la Ley Federal del Trabajo (reforma 2023): 12 días al cumplir el primer año, 2 más por año
//    hasta 20 en el quinto, y 2 más cada 5 años después. Se cuentan las del año de aniversario en curso.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { tipoReal } = require('./expediente-oc');
const { hoyMexico } = require('./fechas');
const alcance = require('./alcance');
const C = require('./cifrado');

const MAX_BYTES = 10 * 1024 * 1024;
const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' };
const PUESTOS = ['Técnico', 'Operador', 'Ayudante', 'Supervisor', 'Ventas', 'Atención a clientes', 'Compras', 'Administración', 'Contabilidad', 'Dirección', 'Otro'];
const PERIODOS = ['diario', 'semanal', 'quincenal', 'mensual'];
const CONTRATOS = ['Indeterminado', 'Determinado', 'Periodo de prueba', 'Capacitación inicial', 'Honorarios', 'Otro'];
const LICENCIAS = ['A', 'B', 'C', 'D', 'E', 'Federal A', 'Federal B', 'Federal C', 'Federal D', 'Federal E', 'Otra'];
const DOCUMENTOS = { ine: 'INE', curp: 'CURP', domicilio: 'Comprobante de domicilio', acta: 'Acta de nacimiento', rfc: 'Constancia de situación fiscal', nss: 'Número de seguro social', licencia: 'Licencia de manejo', contrato: 'Contrato', banco: 'Estado de cuenta (CLABE)', otro: 'Otro' };
const INCIDENCIAS = { vacaciones: 'Vacaciones', falta: 'Falta', incapacidad: 'Incapacidad', permiso: 'Permiso', retardo: 'Retardo', otro: 'Otro' };
const PAPELES = { responsable: 'Técnico responsable', operador: 'Operador', ayudante: 'Ayudante' };
// Lo que solo se ve y cambia con «personal.sensibles».
const SENSIBLES = ['banco', 'clabe', 'rfc', 'curp', 'nss', 'salario', 'salario_periodo', 'tipo_contrato', 'contrato_vence'];
// Columnas que se guardan cifradas (el salario, en centavos).
const CIFRADOS = ['clabe', 'rfc', 'curp', 'nss', 'salario_cent'];
const contexto = (col, id) => `personal.${col}:${id}`;
const contextoDoc = id => `documentos_personal:${id}`;
const contextoNota = id => `incidencias_personal.notas:${id}`;
// En la bitácora (la ve quien tiene «Ver personal») nunca va el valor de un dato sensible: solo que cambió.
const OCULTOS_BITACORA = new Set(['banco', 'rfc', 'curp', 'nss', 'salario', 'salario_periodo', 'tipo_contrato', 'contrato_vence']);
const GENERALES = ['nombre', 'puesto', 'telefono', 'correo', 'direccion', 'fecha_ingreso', 'contacto_emergencia', 'tel_emergencia', 'licencia_tipo', 'licencia_numero', 'licencia_vence', 'notas', 'usuario_id', 'sucursal_id'];

const fechaOk = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const nombreSeguro = t => String(t || 'documento').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120) || 'documento';
const encabezado = (req, k) => { try { return decodeURIComponent(String(req.get(k) || '')); } catch { return ''; } };
const idDe = v => { if (!/^\d{1,15}$/.test(String(v))) return 0; const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : 0; };
const texto = (v, max) => { const t = String(v ?? '').trim().replace(/\s+/g, ' '); return t ? t.slice(0, max) : null; };
// CLABE: 18 dígitos con dígito verificador (pesos 3, 7, 1).
function clabeValida(c) {
  if (!/^\d{18}$/.test(c)) return false;
  const pesos = [3, 7, 1]; let suma = 0;
  for (let i = 0; i < 17; i++) suma += (Number(c[i]) * pesos[i % 3]) % 10;
  return (10 - (suma % 10)) % 10 === Number(c[17]);
}
const mascaraClabe = c => (c ? '•••• •••• ' + String(c).slice(-4) : null);
const RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const CURP = /^[A-Z]{4}\d{6}[HMX][A-Z]{5}[A-Z0-9]\d$/;
// Días de vacaciones que da la LFT por años cumplidos.
const diasLFT = n => (n < 1 ? 0 : n <= 5 ? 10 + 2 * n : 22 + 2 * Math.floor((n - 6) / 5));
function vacacionesDe(p, usadasDesde, hoy) {
  if (!p.fecha_ingreso) return null;
  const [y, m, d] = p.fecha_ingreso.split('-').map(Number), [hy] = hoy.split('-').map(Number);
  let anios = hy - y; const aniv = k => `${y + k}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (aniv(anios) > hoy) anios--;
  if (anios < 1) return { anios: 0, corresponden: 0, tomados: 0, disponibles: 0, desde: null, proximo: aniv(1) };
  const desde = aniv(anios), tomados = usadasDesde(p.id, desde), corresponden = diasLFT(anios);
  return { anios, corresponden, tomados, disponibles: Math.max(0, corresponden - tomados), desde, proximo: aniv(anios + 1) };
}
const diasEntre = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

function migrar(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS personal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL CHECK(length(trim(nombre)) BETWEEN 3 AND 120),
      puesto TEXT NOT NULL,
      telefono TEXT, correo TEXT, direccion TEXT,
      fecha_ingreso TEXT, fecha_baja TEXT, motivo_baja TEXT,
      activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
      usuario_id INTEGER UNIQUE REFERENCES usuarios(id),
      licencia_tipo TEXT, licencia_numero TEXT, licencia_vence TEXT,
      contacto_emergencia TEXT, tel_emergencia TEXT,
      banco TEXT, clabe TEXT, rfc TEXT, curp TEXT, nss TEXT,
      salario_cent INTEGER CHECK(salario_cent IS NULL OR salario_cent >= 0), salario_periodo TEXT,
      tipo_contrato TEXT, contrato_vence TEXT,
      notas TEXT,
      sucursal_id INTEGER REFERENCES sucursales(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT, version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_personal_activo ON personal(activo, nombre);
    CREATE TABLE IF NOT EXISTS documentos_personal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      personal_id INTEGER NOT NULL REFERENCES personal(id),
      tipo TEXT NOT NULL, nombre TEXT NOT NULL, archivo TEXT NOT NULL, formato TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
      subido_por INTEGER, subido_por_nombre TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      eliminado INTEGER NOT NULL DEFAULT 0, eliminado_por TEXT, eliminado_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_documentos_personal ON documentos_personal(personal_id);
    CREATE TABLE IF NOT EXISTS incidencias_personal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      personal_id INTEGER NOT NULL REFERENCES personal(id),
      tipo TEXT NOT NULL, fecha_inicio TEXT NOT NULL, fecha_fin TEXT NOT NULL,
      dias REAL NOT NULL CHECK(dias > 0), con_goce INTEGER NOT NULL DEFAULT 1, notas TEXT,
      registrado_por INTEGER, registrado_por_nombre TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      cancelada INTEGER NOT NULL DEFAULT 0, cancelada_por TEXT, motivo_cancelacion TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_incidencias_personal ON incidencias_personal(personal_id, fecha_inicio);
    CREATE TABLE IF NOT EXISTS orden_personal (
      lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      personal_id INTEGER NOT NULL REFERENCES personal(id),
      papel TEXT NOT NULL CHECK(papel IN ('responsable', 'operador', 'ayudante')),
      PRIMARY KEY (lead_id, personal_id)
    );
    CREATE INDEX IF NOT EXISTS idx_orden_personal_persona ON orden_personal(personal_id);
  `);
}

module.exports = function personal(app, db, h) {
  migrar(db);
  const P = app.locals.permisos;
  const audit = (req, id, accion, detalle) => app.locals.auditoria?.registrar(req, 'personal', id, accion, detalle);
  const base = process.env.DB_PATH ? path.dirname(path.resolve(process.env.DB_PATH)) : path.join(__dirname, '..');
  const DIR = path.join(base, 'archivos', 'personal');
  const usadas = (id, desde) => db.prepare("SELECT COALESCE(SUM(dias), 0) d FROM incidencias_personal WHERE personal_id = ? AND tipo = 'vacaciones' AND cancelada = 0 AND fecha_inicio >= ?").get(id, desde).d;
  const ve = req => P.puede(req, 'personal.ver'), edita = req => P.puede(req, 'personal.editar'), sensible = req => P.puede(req, 'personal.sensibles');
  const negar = (res, msg) => res.status(403).json({ error: msg || 'No tienes permiso para ver el personal' });

  // Lo que se manda de una persona: lo sensible solo con permiso (si no, la CLABE enmascarada y lo demás fuera).
  // En la lista (lista = true) nunca va lo sensible, ni con permiso: así no sale todo de golpe en una sola respuesta.
  function presentar(req, p, hoy = hoyMexico(), { lista = false } = {}) {
    const x = { ...p };
    delete x._ilegibles;
    const conSens = sensible(req) && !lista;
    if (sensible(req) && p._ilegibles?.length) x.datos_ilegibles = p._ilegibles;
    if (!conSens) { for (const k of SENSIBLES) delete x[k]; delete x.salario_cent; x.clabe_mascara = mascaraClabe(p.clabe); x.tiene_clabe = !!p.clabe || !!p._ilegibles?.includes('clabe'); }
    else { x.salario = p.salario_cent == null ? null : p.salario_cent / 100; x.clabe_mascara = mascaraClabe(p.clabe); }
    x.vacaciones = vacacionesDe(p, usadas, hoy);
    x.alertas = [];
    if (x.datos_ilegibles) x.alertas.push('Datos cifrados que no se pueden leer: revisa la clave de cifrado');
    if (p.activo && p.licencia_vence) { const d = diasEntre(hoy, p.licencia_vence); if (d < 0) x.alertas.push('Licencia vencida'); else if (d <= 30) x.alertas.push(`Licencia vence en ${d} día${d === 1 ? '' : 's'}`); }
    if (sensible(req) && p.activo && p.contrato_vence) { const d = diasEntre(hoy, p.contrato_vence); if (d < 0) x.alertas.push('Contrato vencido'); else if (d <= 30) x.alertas.push(`Contrato vence en ${d} día${d === 1 ? '' : 's'}`); }
    x.usuario_nombre = p.usuario_id ? db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(p.usuario_id)?.nombre || null : null;
    return x;
  }
  // Una fila con sus datos sensibles ya descifrados. Si alguno no se puede descifrar (otra clave o dato alterado),
  // queda en null y se anota en _ilegibles: nunca se manda el texto cifrado ni se tumba la petición.
  function abrir(fila) {
    if (!fila) return fila;
    const p = { ...fila, _ilegibles: [] };
    for (const k of CIFRADOS) {
      if (p[k] === null || p[k] === undefined) continue;
      try { const t = C.descifrar(p[k], contexto(k, p.id)); p[k] = k === 'salario_cent' ? Number(t) : t; }
      catch { p[k] = null; p._ilegibles.push(k === 'salario_cent' ? 'salario' : k); }
    }
    return p;
  }
  const leer = id => abrir(db.prepare('SELECT * FROM personal WHERE id = ?').get(idDe(id)));
  const sellar = (id, d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, CIFRADOS.includes(k) ? C.cifrar(v === null || v === undefined ? null : String(v), contexto(k, id)) : v]));
  // Quién consultó datos sensibles de quién (una vez por hora por persona consultada, para no llenar la bitácora).
  const consultas = new Map();
  setInterval(() => { const t = Date.now(); for (const [k, v] of consultas) if (v < t) consultas.delete(k); }, 3600000).unref();
  const anotarConsulta = (req, p, que) => { const k = req.usuarioSesion.id + ':' + p.id + ':' + que; if ((consultas.get(k) || 0) > Date.now()) return; consultas.set(k, Date.now() + 3600000); audit(req, p.id, 'consulta', `${p.nombre}: ${que}`); };
  // Cuentas que puede ligar quien pide: activas, sin ficha y de sus sucursales (Dirección: todas).
  const deMisSucursales = (req, usuarioId) => { const a = req.alcanceSuc; if (!a || a.todo) return true; return app.locals.sucursales.sucursalesDe(usuarioId).some(s => a.ids.has(s)); };
  const usuariosSinFicha = req => db.prepare('SELECT u.id, u.nombre, u.rol FROM usuarios u WHERE u.activo = 1 AND NOT EXISTS (SELECT 1 FROM main.personal x WHERE x.usuario_id = u.id) ORDER BY u.nombre').all().filter(u => deMisSucursales(req, u.id));

  // Valida y normaliza lo que llega para crear o cambiar una persona. Devuelve { datos } o { error, status }.
  function validar(req, b, actual) {
    const d = {};
    const conSens = sensible(req);
    for (const k of SENSIBLES) if (b[k] !== undefined && b[k] !== null && b[k] !== '' && !conSens) return { error: 'Los datos de pago y el expediente los captura quien tiene permiso de datos sensibles', status: 403 };
    const fija = (k, v) => { d[k] = v; };
    if (b.nombre !== undefined || !actual) { const n = texto(b.nombre, 120); if (!n || n.length < 3 || /[<>{}]/.test(n)) return { error: 'Escribe el nombre completo (sin símbolos raros)' }; fija('nombre', n); }
    if (b.puesto !== undefined || !actual) { if (!PUESTOS.includes(b.puesto)) return { error: 'Elige el puesto' }; fija('puesto', b.puesto); }
    for (const [k, max] of [['telefono', 25], ['direccion', 200], ['contacto_emergencia', 120], ['tel_emergencia', 25], ['licencia_numero', 40], ['notas', 2000]]) if (b[k] !== undefined) fija(k, texto(b[k], max));
    if (b.correo !== undefined) { const c = texto(b.correo, 120); if (c && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return { error: 'El correo no es válido' }; fija('correo', c ? c.toLowerCase() : null); }
    for (const k of ['fecha_ingreso', 'licencia_vence', 'contrato_vence']) if (b[k] !== undefined) { const f = b[k] || null; if (f && !fechaOk(f)) return { error: 'Revisa la fecha (' + k.replace('_', ' ') + ')' }; fija(k, f); }
    if (d.fecha_ingreso && d.fecha_ingreso > hoyMexico()) return { error: 'La fecha de ingreso no puede ser futura' };
    if (b.licencia_tipo !== undefined) { if (b.licencia_tipo && !LICENCIAS.includes(b.licencia_tipo)) return { error: 'Tipo de licencia inválido' }; fija('licencia_tipo', b.licencia_tipo || null); }
    if (b.usuario_id !== undefined) {
      const u = b.usuario_id === null || b.usuario_id === '' ? null : Number(b.usuario_id);
      if (u !== null) {
        if (!db.prepare('SELECT 1 FROM usuarios WHERE id = ? AND activo = 1').get(u) || !deMisSucursales(req, u)) return { error: 'Ese usuario no existe, está desactivado o no es de tus sucursales' };
        const otra = db.prepare('SELECT id, nombre FROM main.personal WHERE usuario_id = ? AND id <> ?').get(u, actual?.id ?? 0);
        if (otra) return { error: `Ese usuario ya está ligado a la ficha de ${otra.nombre}`, status: 409 };
      }
      fija('usuario_id', u);
    }
    if (b.sucursal_id !== undefined && b.sucursal_id !== null && b.sucursal_id !== '') {
      const s = Number(b.sucursal_id);
      if (!req.alcanceSuc?.permitidas?.includes(s)) return { error: 'Solo puedes asignar tus sucursales', status: 403 };
      fija('sucursal_id', s);
    }
    if (conSens) {
      if (b.banco !== undefined) fija('banco', texto(b.banco, 60));
      if (b.clabe !== undefined) { const c = String(b.clabe ?? '').replace(/\s+/g, ''); if (c && !clabeValida(c)) return { error: 'La CLABE no es válida (18 dígitos y su dígito verificador)' }; fija('clabe', c || null); }
      if (b.rfc !== undefined) { const r = String(b.rfc ?? '').trim().toUpperCase(); if (r && !RFC.test(r)) return { error: 'El RFC no es válido' }; fija('rfc', r || null); }
      if (b.curp !== undefined) { const r = String(b.curp ?? '').trim().toUpperCase(); if (r && !CURP.test(r)) return { error: 'La CURP no es válida' }; fija('curp', r || null); }
      if (b.nss !== undefined) { const r = String(b.nss ?? '').replace(/\D/g, ''); if (r && r.length !== 11) return { error: 'El NSS lleva 11 dígitos' }; fija('nss', r || null); }
      if (b.salario !== undefined) { const v = b.salario === null || b.salario === '' ? null : Number(b.salario); if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1e7 || Math.abs(v * 100 - Math.round(v * 100)) > 1e-6)) return { error: 'Revisa el salario (máximo 2 decimales)' }; fija('salario_cent', v === null ? null : Math.round(v * 100)); }
      if (b.salario_periodo !== undefined) { if (b.salario_periodo && !PERIODOS.includes(b.salario_periodo)) return { error: 'Periodo de salario inválido' }; fija('salario_periodo', b.salario_periodo || null); }
      if (b.tipo_contrato !== undefined) { if (b.tipo_contrato && !CONTRATOS.includes(b.tipo_contrato)) return { error: 'Tipo de contrato inválido' }; fija('tipo_contrato', b.tipo_contrato || null); }
    }
    return { datos: d };
  }
  const descripcion = (k, v) => (OCULTOS_BITACORA.has(k.replace('_cent', '')) ? null : k === 'clabe' ? mascaraClabe(v) || '(sin CLABE)' : k === 'salario_cent' ? (v == null ? '(sin salario)' : '$' + (v / 100).toLocaleString('es-MX', { minimumFractionDigits: 2 })) : k === 'usuario_id' ? (v ? db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(v)?.nombre : '(sin cuenta)') : (v ?? '(vacío)'));
  // Al ligar o desligar la cuenta de una persona, las órdenes donde es responsable cambian de «técnico asignado».
  const sincronizarOrdenes = personalId => db.prepare("UPDATE main.leads SET tecnico_id = (SELECT usuario_id FROM main.personal WHERE id = ?) WHERE id IN (SELECT lead_id FROM main.orden_personal WHERE personal_id = ? AND papel = 'responsable')").run(personalId, personalId);

  // ---------- Lista y ficha ----------
  app.get('/api/personal/catalogos', h((req, res) => res.json({ puestos: PUESTOS, periodos: PERIODOS, contratos: CONTRATOS, licencias: LICENCIAS, documentos: DOCUMENTOS, incidencias: INCIDENCIAS, papeles: PAPELES })));
  // Para asignar gente a una orden: solo nombre y puesto de los activos de su sucursal.
  app.get('/api/personal/para-asignar', h((req, res) => {
    if (!P.puede(req, 'ventas.ver')) return negar(res);
    res.json(db.prepare('SELECT id, nombre, puesto, sucursal_id, usuario_id IS NOT NULL AS con_cuenta FROM personal WHERE activo = 1 ORDER BY nombre').all());
  }));
  app.get('/api/personal', h((req, res) => {
    if (!ve(req)) return negar(res);
    const hoy = hoyMexico(), mes = hoy.slice(0, 7);
    const estado = req.query.estado || 'activos', q = String(req.query.q || '').trim().toLowerCase();
    let filas = db.prepare('SELECT * FROM personal ORDER BY activo DESC, nombre').all().map(abrir);
    if (estado === 'activos') filas = filas.filter(p => p.activo); else if (estado === 'bajas') filas = filas.filter(p => !p.activo);
    if (req.query.puesto) filas = filas.filter(p => p.puesto === req.query.puesto);
    if (q) filas = filas.filter(p => [p.nombre, p.puesto, p.telefono, p.correo].some(v => String(v || '').toLowerCase().includes(q)));
    const ordenes = new Map(db.prepare(`SELECT op.personal_id, COUNT(*) n FROM orden_personal op JOIN leads l ON l.id = op.lead_id
      WHERE COALESCE(l.fecha_realizado, l.fecha_servicio) LIKE ? GROUP BY op.personal_id`).all(mes + '%').map(r => [r.personal_id, r.n]));
    const lista = filas.map(p => ({ ...presentar(req, p, hoy, { lista: true }), ordenes_mes: ordenes.get(p.id) || 0 }));
    if (req.query.alertas === '1') return res.json(lista.filter(p => p.alertas.length));
    res.json(lista);
  }));
  app.get('/api/personal/:id', h((req, res) => {
    if (!ve(req)) return negar(res);
    const p = leer(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    // Las notas de una incapacidad pueden traer datos de salud: solo con «Datos sensibles».
    const incidencias = db.prepare('SELECT * FROM incidencias_personal WHERE personal_id = ? ORDER BY fecha_inicio DESC, id DESC').all(p.id).map(i => {
      if (i.notas === null) return i;
      if (i.tipo === 'incapacidad' && !sensible(req)) return { ...i, notas: null, notas_ocultas: true };
      try { return { ...i, notas: C.descifrar(i.notas, contextoNota(i.id)) }; } catch { return { ...i, notas: null, notas_ilegibles: true }; }
    });
    if (sensible(req) && CIFRADOS.some(k => p[k] !== null && p[k] !== undefined)) anotarConsulta(req, p, 'vio sus datos sensibles');
    const documentos = sensible(req) ? db.prepare('SELECT id, tipo, nombre, formato, bytes, subido_por_nombre, created_at FROM documentos_personal WHERE personal_id = ? AND eliminado = 0 ORDER BY id DESC').all(p.id) : [];
    const ordenes = db.prepare(`SELECT l.id, l.created_at, l.folio_num, l.sucursal_id, l.estatus, l.fecha_servicio, l.fecha_realizado, l.ejecucion, COALESCE(l.empresa_contacto, l.nombre) AS cliente, op.papel
      FROM orden_personal op JOIN leads l ON l.id = op.lead_id WHERE op.personal_id = ? ORDER BY COALESCE(l.fecha_realizado, l.fecha_servicio) DESC LIMIT 30`).all(p.id);
    res.json({ ...presentar(req, p), incidencias, documentos, ordenes, usuarios_sin_ficha: edita(req) ? usuariosSinFicha(req) : [], puede: { editar: edita(req), sensibles: sensible(req) } });
  }));
  // Usuarios activos que todavía no tienen ficha (para ligarlos o darlos de alta).
  app.get('/api/personal/usuarios/sin-ficha', h((req, res) => {
    if (!edita(req)) return negar(res);
    res.json(usuariosSinFicha(req));
  }));

  // ---------- Alta, cambios, baja ----------
  app.post('/api/personal', h((req, res) => {
    if (!edita(req)) return negar(res, 'No tienes permiso para dar de alta personal');
    const v = validar(req, req.body || {}, null);
    if (v.error) return res.status(v.status || 400).json({ error: v.error });
    const d = v.datos;
    if (db.prepare('SELECT 1 FROM personal WHERE lower(nombre) = lower(?) AND activo = 1').get(d.nombre)) return res.status(409).json({ error: 'Ya hay una persona activa con ese nombre' });
    // Primero la fila sin lo cifrado (el cifrado se amarra al número de la persona) y luego sus datos sensibles.
    const cols = Object.keys(d).filter(k => !CIFRADOS.includes(k)), sens = Object.keys(d).filter(k => CIFRADOS.includes(k) && d[k] !== null);
    const id = db.transaction(() => {
      const info = db.prepare(`INSERT INTO main.personal (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map(k => d[k]));
      const nuevo = Number(info.lastInsertRowid);
      if (sens.length) { const c = sellar(nuevo, Object.fromEntries(sens.map(k => [k, d[k]]))); db.prepare(`UPDATE main.personal SET ${sens.map(k => k + ' = ?').join(', ')} WHERE id = ?`).run(...sens.map(k => c[k]), nuevo); }
      if (!d.sucursal_id) app.locals.sucursales.asignar('personal', nuevo);
      return nuevo;
    })();
    audit(req, id, 'alta', `${d.nombre} · ${d.puesto}${d.usuario_id ? ' · cuenta ' + descripcion('usuario_id', d.usuario_id) : ''}${d.clabe ? ' · CLABE ' + mascaraClabe(d.clabe) : ''}`);
    res.status(201).json(presentar(req, leer(id)));
  }));
  app.put('/api/personal/:id', h((req, res) => {
    if (!edita(req)) return negar(res, 'No tienes permiso para cambiar al personal');
    const p = leer(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    if (req.body?.version !== undefined && Number(req.body.version) !== p.version) return res.status(409).json({ error: 'Otra persona cambió esta ficha mientras la tenías abierta. Ciérrala y vuelve a abrirla.' });
    const v = validar(req, req.body || {}, p);
    if (v.error) return res.status(v.status || 400).json({ error: v.error });
    const d = v.datos;
    if (d.nombre && d.nombre.toLowerCase() !== p.nombre.toLowerCase() && db.prepare('SELECT 1 FROM personal WHERE lower(nombre) = lower(?) AND activo = 1 AND id <> ?').get(d.nombre, p.id)) return res.status(409).json({ error: 'Ya hay una persona activa con ese nombre' });
    const cambian = Object.keys(d).filter(k => String(d[k] ?? '') !== String(p[k] ?? ''));
    if (!cambian.length) return res.json(presentar(req, p));
    const c = sellar(p.id, Object.fromEntries(cambian.map(k => [k, d[k]])));
    db.transaction(() => {
      db.prepare(`UPDATE main.personal SET ${cambian.map(k => k + ' = ?').join(', ')}, updated_at = datetime('now','localtime'), version = version + 1 WHERE id = ?`).run(...cambian.map(k => c[k]), p.id);
      if (cambian.includes('usuario_id')) sincronizarOrdenes(p.id);
    })();
    audit(req, p.id, 'cambios', `${p.nombre}: ` + cambian.map(k => { const e = k.replace('_cent', ''); return OCULTOS_BITACORA.has(e) ? `${e} (cambió)` : `${e} ${descripcion(k, p[k])} → ${descripcion(k, d[k])}`; }).join(' · '));
    res.json(presentar(req, leer(p.id)));
  }));
  app.post('/api/personal/:id/baja', h((req, res) => {
    if (!edita(req)) return negar(res, 'No tienes permiso para dar de baja');
    const p = leer(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    if (!p.activo) return res.status(409).json({ error: 'Ya está dada de baja' });
    const fecha = req.body?.fecha || hoyMexico(), motivo = texto(req.body?.motivo, 300);
    if (!fechaOk(fecha) || (p.fecha_ingreso && fecha < p.fecha_ingreso)) return res.status(400).json({ error: 'Revisa la fecha de baja' });
    if (!motivo || motivo.length < 4) return res.status(400).json({ error: 'Escribe el motivo de la baja' });
    const abiertas = db.prepare(`SELECT COUNT(*) n FROM main.orden_personal op JOIN main.leads l ON l.id = op.lead_id WHERE op.personal_id = ? AND op.papel = 'responsable' AND l.estatus = 'ganado' AND l.ejecucion IS NULL`).get(p.id).n;
    let desactivado = false;
    db.transaction(() => {
      db.prepare("UPDATE main.personal SET activo = 0, fecha_baja = ?, motivo_baja = ?, updated_at = datetime('now','localtime'), version = version + 1 WHERE id = ?").run(fecha, motivo, p.id);
      // Si tiene cuenta y se pide, también se le quita el acceso (no si es la de quien da la baja).
      if (req.body?.desactivar_usuario && p.usuario_id && p.usuario_id !== req.usuarioSesion.id && P.puede(req, 'usuarios.administrar')) {
        const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(p.usuario_id);
        if (u && u.rol !== 'admin' && (!app.locals.sucursales.puedeAdministrar || app.locals.sucursales.puedeAdministrar(req, u))) {
          db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(u.id); app.locals.sesiones?.revocarUsuario?.(u.id); desactivado = true;
        }
      }
    })();
    audit(req, p.id, 'baja', `${p.nombre} · ${fecha} · ${motivo}${desactivado ? ' · se desactivó su acceso al sistema' : ''}`);
    res.json({ ...presentar(req, leer(p.id)), ordenes_abiertas: abiertas, acceso_desactivado: desactivado });
  }));
  app.post('/api/personal/:id/reactivar', h((req, res) => {
    if (!edita(req)) return negar(res, 'No tienes permiso para reactivar');
    const p = leer(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    if (p.activo) return res.status(409).json({ error: 'Ya está activa' });
    if (db.prepare('SELECT 1 FROM personal WHERE lower(nombre) = lower(?) AND activo = 1').get(p.nombre)) return res.status(409).json({ error: 'Ya hay una persona activa con ese nombre' });
    db.prepare("UPDATE main.personal SET activo = 1, fecha_baja = NULL, motivo_baja = NULL, updated_at = datetime('now','localtime'), version = version + 1 WHERE id = ?").run(p.id);
    audit(req, p.id, 'reingreso', p.nombre);
    res.json(presentar(req, leer(p.id)));
  }));

  // ---------- Vacaciones e incidencias ----------
  app.post('/api/personal/:id/incidencias', h((req, res) => {
    if (!edita(req)) return negar(res, 'No tienes permiso para registrar incidencias');
    const p = leer(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    const b = req.body || {};
    if (!INCIDENCIAS[b.tipo]) return res.status(400).json({ error: 'Elige el tipo' });
    const ini = b.fecha_inicio, fin = b.fecha_fin || b.fecha_inicio;
    if (!fechaOk(ini) || !fechaOk(fin) || fin < ini) return res.status(400).json({ error: 'Revisa las fechas (la final no puede ser antes de la inicial)' });
    if (diasEntre(ini, fin) > 366) return res.status(400).json({ error: 'Máximo un año por registro' });
    const dias = b.dias === undefined || b.dias === null || b.dias === '' ? diasEntre(ini, fin) + 1 : Number(b.dias);
    if (!Number.isFinite(dias) || dias <= 0 || dias > diasEntre(ini, fin) + 1 || Math.abs(dias * 2 - Math.round(dias * 2)) > 1e-9) return res.status(400).json({ error: 'Los días deben ser mayores a 0, en medios días, y no más que los del periodo' });
    if (b.tipo === 'vacaciones') {
      const v = vacacionesDe(p, usadas, ini);
      if (!v || v.anios < 1) return res.status(409).json({ error: 'Todavía no cumple su primer año: no le corresponden vacaciones (LFT)' });
      if (dias > v.disponibles && !b.forzar) return res.status(409).json({ error: `Solo le quedan ${v.disponibles} día(s) de vacaciones de este año (le corresponden ${v.corresponden})`, codigo: 'SIN_DIAS' });
    }
    const empalme = db.prepare('SELECT tipo, fecha_inicio, fecha_fin FROM incidencias_personal WHERE personal_id = ? AND cancelada = 0 AND fecha_inicio <= ? AND fecha_fin >= ?').get(p.id, fin, ini);
    if (empalme && !b.forzar) return res.status(409).json({ error: `Se empalma con ${INCIDENCIAS[empalme.tipo].toLowerCase()} del ${empalme.fecha_inicio} al ${empalme.fecha_fin}`, codigo: 'EMPALME' });
    const nota = texto(b.notas, 300);
    const info = db.transaction(() => {
      const r = db.prepare('INSERT INTO main.incidencias_personal (personal_id, tipo, fecha_inicio, fecha_fin, dias, con_goce, notas, registrado_por, registrado_por_nombre) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)')
        .run(p.id, b.tipo, ini, fin, dias, b.con_goce === false || b.con_goce === 0 ? 0 : 1, req.usuarioSesion.id, req.usuarioSesion.nombre);
      if (nota) db.prepare('UPDATE main.incidencias_personal SET notas = ? WHERE id = ?').run(C.cifrar(nota, contextoNota(r.lastInsertRowid)), r.lastInsertRowid);
      return r;
    })();
    audit(req, p.id, INCIDENCIAS[b.tipo].toLowerCase(), `${p.nombre}: ${ini}${fin !== ini ? ' al ' + fin : ''} · ${dias} día(s)`);
    res.status(201).json({ id: Number(info.lastInsertRowid), vacaciones: vacacionesDe(p, usadas, hoyMexico()) });
  }));
  app.post('/api/personal/incidencias/:id/cancelar', h((req, res) => {
    if (!edita(req)) return negar(res, 'No tienes permiso para cancelar incidencias');
    const i = db.prepare('SELECT * FROM incidencias_personal WHERE id = ? AND personal_id IN (SELECT id FROM personal)').get(idDe(req.params.id));
    if (!i || i.cancelada) return res.status(404).json({ error: 'Registro no encontrado' });
    const motivo = texto(req.body?.motivo, 200);
    if (!motivo || motivo.length < 4) return res.status(400).json({ error: 'Escribe por qué se cancela' });
    db.prepare('UPDATE main.incidencias_personal SET cancelada = 1, cancelada_por = ?, motivo_cancelacion = ? WHERE id = ?').run(req.usuarioSesion.nombre, motivo, i.id);
    audit(req, i.personal_id, 'incidencia cancelada', `${INCIDENCIAS[i.tipo]} ${i.fecha_inicio} · ${motivo}`);
    res.json({ ok: true });
  }));

  // ---------- Documentos del expediente (solo con datos sensibles) ----------
  app.post('/api/personal/:id/documentos', express.raw({ type: () => true, limit: MAX_BYTES + 1024 }), h((req, res) => {
    if (!sensible(req) || !edita(req)) return negar(res, 'El expediente lo maneja quien tiene permiso de datos sensibles');
    const p = leer(req.params.id);
    if (!p) return res.status(404).json({ error: 'Persona no encontrada' });
    const tipo = encabezado(req, 'x-tipo');
    if (!DOCUMENTOS[tipo]) return res.status(400).json({ error: 'Elige qué documento es' });
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buf.length) return res.status(400).json({ error: 'El archivo está vacío' });
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'El archivo pasa de 10 MB' });
    const formato = tipoReal(buf);
    if (!['pdf', 'jpg', 'png'].includes(formato)) return res.status(400).json({ error: 'El documento debe ser PDF, JPG o PNG' });
    const sha = C.huella(buf); // huella con clave: reconoce el mismo archivo sin guardar un hash comparable
    if (db.prepare('SELECT 1 FROM documentos_personal WHERE personal_id = ? AND sha256 = ? AND eliminado = 0').get(p.id, sha)) return res.status(409).json({ error: 'Ese mismo archivo ya está en su expediente' });
    const nombre = nombreSeguro(encabezado(req, 'x-nombre'));
    const id = db.transaction(() => {
      const r = db.prepare('INSERT INTO main.documentos_personal (personal_id, tipo, nombre, archivo, formato, bytes, sha256, subido_por, subido_por_nombre) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(p.id, tipo, nombre, '', formato, buf.length, sha, req.usuarioSesion.id, req.usuarioSesion.nombre);
      // Nombre al azar (no revela nada del contenido); el archivo va cifrado.
      const archivo = path.join(String(p.id), `${r.lastInsertRowid}-${crypto.randomBytes(8).toString('hex')}.${formato}.cifrado`);
      fs.mkdirSync(path.join(DIR, String(p.id)), { recursive: true, mode: 0o700 });
      C.escribirSeguro(path.join(DIR, archivo), C.cifrarArchivo(buf, contextoDoc(r.lastInsertRowid)));
      db.prepare('UPDATE main.documentos_personal SET archivo = ? WHERE id = ?').run(archivo, r.lastInsertRowid);
      return Number(r.lastInsertRowid);
    })();
    audit(req, p.id, 'documento', `${p.nombre}: ${DOCUMENTOS[tipo]} «${nombre}»`);
    res.status(201).json({ id });
  }));
  app.get('/api/personal/documentos/:id', h((req, res) => {
    if (!sensible(req)) return negar(res, 'El expediente lo ve quien tiene permiso de datos sensibles');
    const d = db.prepare('SELECT * FROM documentos_personal WHERE id = ? AND eliminado = 0 AND personal_id IN (SELECT id FROM personal)').get(idDe(req.params.id));
    if (!d) return res.status(404).json({ error: 'Documento no encontrado' });
    const ruta = path.join(DIR, d.archivo);
    if (!ruta.startsWith(DIR + path.sep) || !fs.existsSync(ruta)) return res.status(404).json({ error: 'El archivo ya no está en el servidor' });
    let contenido;
    try { contenido = C.descifrarArchivo(fs.readFileSync(ruta), contextoDoc(d.id)); }
    catch (e) { console.error('[personal] documento ' + d.id + ':', e.message); return res.status(409).json({ error: 'El documento está cifrado con otra clave o fue alterado: no se puede abrir. Revisa la clave de cifrado del servidor.' }); }
    const dueno = leer(d.personal_id); if (dueno) audit(req, dueno.id, 'consulta', `${dueno.nombre}: descargó ${DOCUMENTOS[d.tipo] || d.tipo} «${d.nombre}»`);
    res.set({ 'Content-Type': MIME[d.formato] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="documento.${d.formato}"; filename*=UTF-8''${encodeURIComponent(d.nombre)}` });
    res.send(contenido);
  }));
  app.post('/api/personal/documentos/:id/quitar', h((req, res) => {
    if (!sensible(req) || !edita(req)) return negar(res, 'El expediente lo maneja quien tiene permiso de datos sensibles');
    const d = db.prepare('SELECT * FROM documentos_personal WHERE id = ? AND eliminado = 0 AND personal_id IN (SELECT id FROM personal)').get(idDe(req.params.id));
    if (!d) return res.status(404).json({ error: 'Documento no encontrado' });
    db.prepare("UPDATE main.documentos_personal SET eliminado = 1, eliminado_por = ?, eliminado_at = datetime('now','localtime') WHERE id = ?").run(req.usuarioSesion.nombre, d.id);
    audit(req, d.personal_id, 'documento quitado', `${DOCUMENTOS[d.tipo] || d.tipo} «${d.nombre}» (el archivo se conserva en el servidor)`);
    res.json({ ok: true });
  }));

  // ---------- Equipo de una orden de servicio (lo usa PUT /api/leads/:id) ----------
  // equipo: [{ personal_id, papel }] — un solo responsable; todos activos y de la sucursal de la orden.
  function validarEquipo(lista, lead) {
    if (!Array.isArray(lista) || lista.length > 20) return { error: 'Equipo inválido (máximo 20 personas)' };
    const vistos = new Set(); let responsables = 0;
    for (const x of lista) {
      const id = Number(x?.personal_id);
      if (!PAPELES[x?.papel]) return { error: 'Papel inválido en el equipo' };
      if (vistos.has(id)) return { error: 'Una persona aparece dos veces en el equipo' };
      vistos.add(id);
      const p = db.prepare('SELECT id, activo, sucursal_id FROM personal WHERE id = ?').get(id || 0);
      if (!p) return { error: 'Esa persona no existe en tu personal' };
      if (!p.activo) return { error: 'Esa persona está dada de baja' };
      if (p.sucursal_id !== lead.sucursal_id) return { error: 'El equipo debe ser de la sucursal de la orden' };
      if (x.papel === 'responsable') responsables++;
    }
    if (responsables > 1) return { error: 'Solo puede haber un técnico responsable' };
    return { lista: lista.map(x => ({ personal_id: Number(x.personal_id), papel: x.papel })) };
  }
  function guardarEquipo(leadId, lista) {
    db.prepare('DELETE FROM main.orden_personal WHERE lead_id = ?').run(leadId);
    const ins = db.prepare('INSERT INTO main.orden_personal (lead_id, personal_id, papel) VALUES (?, ?, ?)');
    for (const x of lista) ins.run(leadId, x.personal_id, x.papel);
    const resp = lista.find(x => x.papel === 'responsable');
    const usuario = resp ? db.prepare('SELECT usuario_id FROM main.personal WHERE id = ?').get(resp.personal_id)?.usuario_id ?? null : null;
    db.prepare('UPDATE main.leads SET tecnico_id = ? WHERE id = ?').run(usuario, leadId);
  }
  const equipoDe = leadId => db.prepare('SELECT op.personal_id, op.papel, p.nombre, p.puesto, p.usuario_id FROM main.orden_personal op JOIN main.personal p ON p.id = op.personal_id WHERE op.lead_id = ? ORDER BY op.papel = \'responsable\' DESC, op.papel, p.nombre').all(leadId);
  // Si se asigna un técnico por su usuario (forma anterior), queda como responsable si tiene ficha.
  function responsableDesdeUsuario(leadId, usuarioId) {
    db.prepare("DELETE FROM main.orden_personal WHERE lead_id = ? AND papel = 'responsable'").run(leadId);
    const p = usuarioId ? db.prepare('SELECT id FROM main.personal WHERE usuario_id = ?').get(Number(usuarioId)) : null;
    if (p) db.prepare("INSERT INTO main.orden_personal (lead_id, personal_id, papel) VALUES (?, ?, 'responsable') ON CONFLICT(lead_id, personal_id) DO UPDATE SET papel = 'responsable'").run(leadId, p.id);
  }
  const textoEquipo = lista => lista.map(x => `${x.nombre} (${PAPELES[x.papel].toLowerCase()})`).join(', ') || 'sin equipo';

  // Migración: quien ya era técnico asignado (usuario) obtiene su ficha y queda como responsable de sus órdenes.
  db.transaction(() => {
    const sinFicha = db.prepare("SELECT DISTINCT l.tecnico_id AS u FROM leads l WHERE l.tecnico_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM orden_personal op WHERE op.lead_id = l.id AND op.papel = 'responsable')").all();
    for (const { u } of sinFicha) {
      let p = db.prepare('SELECT id FROM personal WHERE usuario_id = ?').get(u);
      if (!p) {
        const us = db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(u); if (!us) continue;
        const suc = db.prepare('SELECT sucursal_id FROM usuario_sucursales WHERE usuario_id = ? ORDER BY sucursal_id LIMIT 1').get(u)?.sucursal_id ?? null;
        p = { id: Number(db.prepare("INSERT INTO personal (nombre, puesto, usuario_id, sucursal_id) VALUES (?, 'Técnico', ?, ?)").run(us.nombre.slice(0, 120), u, suc).lastInsertRowid) };
      }
      db.prepare("INSERT OR IGNORE INTO orden_personal (lead_id, personal_id, papel) SELECT id, ?, 'responsable' FROM leads WHERE tecnico_id = ?").run(p.id, u);
    }
  })();

  // ---------- Cifrado de lo ya guardado ----------
  // Al arrancar: lo que esté en claro (versiones anteriores) se cifra, y lo cifrado con una clave anterior se vuelve
  // a cifrar con la actual. Lo que no se puede descifrar se deja como está (no se pierde: sirve con la clave correcta).
  // Lo mismo con los archivos del expediente. Con secure_delete (db.js) no quedan restos en claro en la base.
  function asegurarCifrado() {
    // La clave se valida al arrancar (una clave mal escrita detiene el arranque en vez de fallar después).
    const e = C.estado();
    console.log(`[cifrado] Clave de datos sensibles: ${e.origen === 'variable' ? 'variable CLAVE_CIFRADO' : 'archivo ' + C.NOMBRE_ARCHIVO} (id ${e.kid}${e.claves > 1 ? ', más ' + (e.claves - 1) + ' anterior(es)' : ''}).`);
    let datos = 0, archivos = 0, fallas = 0;
    db.transaction(() => {
      for (const f of db.prepare(`SELECT id, ${CIFRADOS.join(', ')} FROM main.personal`).all()) {
        const nuevos = {};
        for (const k of CIFRADOS) {
          if (!C.pendiente(f[k])) continue;
          let claro = f[k];
          if (C.esCifrado(claro)) { try { claro = C.descifrar(claro, contexto(k, f.id)); } catch { fallas++; continue; } }
          nuevos[k] = C.cifrar(String(claro), contexto(k, f.id));
        }
        const ks = Object.keys(nuevos);
        if (ks.length) { db.prepare(`UPDATE main.personal SET ${ks.map(k => k + ' = ?').join(', ')} WHERE id = ?`).run(...ks.map(k => nuevos[k]), f.id); datos += ks.length; }
      }
      for (const i of db.prepare('SELECT id, notas FROM main.incidencias_personal WHERE notas IS NOT NULL').all()) {
        if (!C.pendiente(i.notas)) continue;
        let claro = i.notas;
        if (C.esCifrado(claro)) { try { claro = C.descifrar(claro, contextoNota(i.id)); } catch { fallas++; continue; } }
        db.prepare('UPDATE main.incidencias_personal SET notas = ? WHERE id = ?').run(C.cifrar(claro, contextoNota(i.id)), i.id); datos++;
      }
      // La bitácora de versiones anteriores pudo guardar RFC, CURP, NSS o salario: se dejan solo como «cambió».
      for (const a of db.prepare("SELECT id, detalle FROM auditoria WHERE entidad = 'personal' AND accion = 'cambios' AND detalle IS NOT NULL").all()) {
        const i = a.detalle.indexOf(': '); if (i < 0) continue;
        const segs = a.detalle.slice(i + 2).split(' · '), limpio = segs.map(x => { const k = x.split(' ')[0]; return OCULTOS_BITACORA.has(k) && x !== k + ' (cambió)' ? k + ' (cambió)' : x; });
        if (limpio.some((x, j) => x !== segs[j])) { db.prepare('UPDATE auditoria SET detalle = ? WHERE id = ?').run(a.detalle.slice(0, i + 2) + limpio.join(' · '), a.id); datos++; }
      }
    })();
    for (const d of db.prepare("SELECT id, archivo FROM main.documentos_personal WHERE archivo <> ''").all()) {
      const ruta = path.join(DIR, d.archivo);
      if (!ruta.startsWith(DIR + path.sep) || !fs.existsSync(ruta)) continue;
      try {
        const buf = fs.readFileSync(ruta), kid = C.kidDeArchivo(buf);
        if (kid === C.estado().kid) continue;
        const claro = kid ? C.descifrarArchivo(buf, contextoDoc(d.id)) : buf;
        C.escribirSeguro(ruta, C.cifrarArchivo(claro, contextoDoc(d.id)));
        db.prepare('UPDATE main.documentos_personal SET sha256 = ? WHERE id = ?').run(C.huella(claro), d.id);
        archivos++;
      } catch (e) { fallas++; console.error('[cifrado] documento ' + d.id + ':', e.message); }
    }
    if (datos || archivos) { db.pragma('wal_checkpoint(TRUNCATE)'); console.log(`[cifrado] Se cifraron o limpiaron ${datos} dato(s) y ${archivos} documento(s) del personal con la clave actual.`); }
    if (fallas) console.error(`[cifrado] ${fallas} dato(s) o documento(s) no se pudieron descifrar con las claves disponibles (¿falta CLAVE_CIFRADO_ANTERIOR?). Se dejaron como estaban.`);
  }
  asegurarCifrado();

  return { validarEquipo, guardarEquipo, responsableDesdeUsuario, equipoDe, textoEquipo, PAPELES, vacacionesDe: p => vacacionesDe(p, usadas, hoyMexico()), clabeValida, diasLFT };
};
module.exports.diasLFT = diasLFT;
module.exports.clabeValida = clabeValida;
