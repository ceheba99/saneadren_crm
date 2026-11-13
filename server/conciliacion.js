// MÓDULO CONTABLE · F4 (2026-11-11, aprobado por Dirección): CONCILIACIÓN BANCARIA.
// Comprobar que lo que dice el CRM coincide con lo que dice el banco (Santander y Banorte).
//  1. Cuentas de banco por sucursal (nombre como se escribe en «cuenta de salida», banco y terminación).
//  2. Subir el estado de cuenta (Excel o CSV del portal del banco): la pantalla lo lee y la persona elige qué columna es
//     la fecha, el concepto, la referencia, el cargo, el abono y el saldo; eso se recuerda por cuenta. Aquí llegan los
//     renglones ya acomodados. Subir otra vez el mismo archivo no duplica nada (cada movimiento lleva su huella).
//  3. Emparejar solos: cada movimiento del banco con un movimiento del CRM de la misma dirección (abono ↔ cobro
//     confirmado o reintegro de anticipo; cargo ↔ pago a proveedor —incluida la nómina— o entrega de anticipo), mismo
//     monto y hasta 3 días de diferencia. Si hay dos candidatos igual de buenos no adivina: se deja para hacerlo a mano.
//     Lo que se pagó en efectivo o con un anticipo no pasa por el banco y no se empareja.
//  4. Tres listas: conciliados, en el banco y no en el CRM (emparejar a mano, registrar como gasto —p. ej. una comisión,
//     solo quien mueve dinero— o marcar «no aplica» con motivo, p. ej. un traspaso entre cuentas propias), y en el CRM y
//     no en el banco. Saldo del banco del mes contra lo conciliado.
//  · Quién: Dirección y quien tiene «Contabilidad del mes» (Gerente y Contador), con las sucursales que ve. Nada se borra.
const { hoyMexico } = require('./fechas');
const pesos = c => Math.round(Number(c || 0)) / 100;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const DIAS = 3;

module.exports = function conciliacion(app, db, h) {
  const P = app.locals.permisos;
  const F = require('./finanzas');
  const { texto, conSentido, fechaValida, aCentavos, CATEGORIAS } = F;
  const fmt = c => '$' + pesos(c).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dma = f => String(f || '').slice(0, 10).split('-').reverse().join('/');

  db.exec(`CREATE TABLE IF NOT EXISTS cuentas_banco (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL CHECK(length(trim(nombre)) BETWEEN 3 AND 80),
    banco TEXT NOT NULL, terminacion TEXT,
    sucursal_id INTEGER REFERENCES sucursales(id),
    columnas TEXT, activa INTEGER NOT NULL DEFAULT 1 CHECK(activa IN (0, 1)),
    creada_por INTEGER NOT NULL REFERENCES usuarios(id), created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_cuentas_banco_nombre ON cuentas_banco(sucursal_id, nombre COLLATE NOCASE)');
  db.exec(`CREATE TABLE IF NOT EXISTS movimientos_banco (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cuenta_id INTEGER NOT NULL REFERENCES cuentas_banco(id),
    fecha TEXT NOT NULL CHECK(length(fecha) = 10 AND date(fecha, '+0 days') = fecha),
    concepto TEXT, referencia TEXT,
    cargo_cent INTEGER NOT NULL DEFAULT 0 CHECK(cargo_cent >= 0), abono_cent INTEGER NOT NULL DEFAULT 0 CHECK(abono_cent >= 0),
    saldo_cent INTEGER, huella TEXT NOT NULL, archivo TEXT,
    subido_por INTEGER NOT NULL REFERENCES usuarios(id), subido_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    conciliado_tipo TEXT CHECK(conciliado_tipo IS NULL OR conciliado_tipo IN ('cobro', 'pago', 'anticipo', 'reintegro')), conciliado_id INTEGER,
    conciliado_auto INTEGER NOT NULL DEFAULT 0, conciliado_por INTEGER REFERENCES usuarios(id), conciliado_at TEXT,
    no_aplica INTEGER NOT NULL DEFAULT 0 CHECK(no_aplica IN (0, 1)), no_aplica_motivo TEXT, no_aplica_por INTEGER REFERENCES usuarios(id),
    UNIQUE(cuenta_id, huella),
    CHECK((cargo_cent > 0) <> (abono_cent > 0)),
    CHECK(conciliado_tipo IS NULL OR no_aplica = 0)
  )`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_mov_banco_crm ON movimientos_banco(conciliado_tipo, conciliado_id) WHERE conciliado_id IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_mov_banco_fecha ON movimientos_banco(cuenta_id, fecha)');
  { const t = (n, c) => { db.exec(`DROP TRIGGER IF EXISTS ${n}`); db.exec(`CREATE TRIGGER ${n} ${c}`); };
    t('movimientos_banco_fijos', `BEFORE UPDATE ON movimientos_banco WHEN NEW.fecha <> OLD.fecha OR NEW.cargo_cent <> OLD.cargo_cent OR NEW.abono_cent <> OLD.abono_cent OR NEW.cuenta_id <> OLD.cuenta_id
      BEGIN SELECT RAISE(ABORT, 'Un movimiento del banco no se cambia: viene del estado de cuenta'); END`);
    t('movimientos_banco_sin_borrar', `BEFORE DELETE ON movimientos_banco BEGIN SELECT RAISE(ABORT, 'Los movimientos del banco no se borran'); END`); }

  // 2026-11-13 (formatos reales de Santander y Banorte, server/formatos-banco.js): lo que el banco dice de cada movimiento
  // además del concepto —quién está del otro lado, su RFC, la clave de rastreo, la hora y el detalle largo—, para requisitar.
  { const hay = new Set(db.prepare('PRAGMA table_info(movimientos_banco)').all().map(c => c.name));
    for (const c of ['hora', 'contraparte', 'contraparte_rfc', 'rastreo', 'detalle']) if (!hay.has(c)) db.exec(`ALTER TABLE movimientos_banco ADD COLUMN ${c} TEXT`); }

  const puede = req => P.direccion(req) || P.puede(req, 'contabilidad.ver');
  const negar = res => res.status(403).json({ error: 'La conciliación bancaria la hacen Dirección y quien tiene «Contabilidad del mes»' });
  const enAlcance = s => !!db.prepare('SELECT en_alcance(?) v').get(s).v;
  const yo = req => req.usuarioSesion.id;
  const tabla = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(t);
  const cuentaDe = (req, id) => { const c = db.prepare('SELECT * FROM main.cuentas_banco WHERE id = ?').get(Number(id) || 0); return c && enAlcance(c.sucursal_id) ? c : null; };
  const sumarDias = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const folioOS = (id, creado) => (id ? require('./sucursales').folio('OS', 'leads', id, creado) : '');
  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

  // Movimientos del CRM que pasan por el banco, de una sucursal y entre dos fechas. Cada uno: tipo, id, fecha, monto,
  // dirección (abono/cargo), cuenta escrita (si la hay) y descripción.
  function movimientosCrm(sucursalId, desde, hasta) {
    const r = [];
    for (const k of db.prepare(`SELECT k.id, k.fecha, k.monto_cent, k.metodo, k.referencia, k.lead_id, l.created_at AS lc, COALESCE(c.empresa_contacto, c.nombre) AS cliente FROM main.cobros k
        JOIN main.leads l ON l.id = k.lead_id LEFT JOIN main.clientes c ON c.id = l.cliente_id
        WHERE k.cancelado = 0 AND k.confirmado = 1 AND k.tipo <> 'ajuste' AND k.metodo <> 'efectivo' AND l.sucursal_id = ? AND k.fecha BETWEEN ? AND ?`).all(sucursalId, desde, hasta))
      r.push({ tipo: 'cobro', id: k.id, fecha: k.fecha, monto: k.monto_cent, dir: 'abono', cuenta: '', via: k.metodo, texto: `Cobro ${folioOS(k.lead_id, k.lc)} · ${k.cliente || ''}${k.referencia ? ' · ref. ' + k.referencia : ''}` });
    for (const g of db.prepare(`SELECT g.id, g.fecha, g.monto_cent, g.metodo, g.referencia, g.cuenta_origen, x.concepto, x.beneficiario, p.nombre AS prov FROM main.pagos_proveedor g
        JOIN main.cuentas_por_pagar x ON x.id = g.cxp_id JOIN main.proveedores p ON p.id = x.proveedor_id
        WHERE g.cancelado = 0 AND g.metodo NOT IN ('efectivo', 'anticipo') AND x.sucursal_id = ? AND g.fecha BETWEEN ? AND ?`).all(sucursalId, desde, hasta))
      r.push({ tipo: 'pago', id: g.id, fecha: g.fecha, monto: g.monto_cent, dir: 'cargo', cuenta: g.cuenta_origen || '', via: g.metodo, texto: `Pago a ${g.beneficiario || g.prov} · ${g.concepto}${g.referencia ? ' · ref. ' + g.referencia : ''}` });
    if (tabla('anticipos')) {
      for (const a of db.prepare(`SELECT a.id, a.fecha, a.monto_cent, a.metodo, a.cuenta_origen, a.motivo, p.nombre AS persona FROM main.anticipos a JOIN main.personal p ON p.id = a.personal_id
          WHERE a.estado <> 'cancelado' AND a.metodo <> 'efectivo' AND a.sucursal_id = ? AND a.fecha BETWEEN ? AND ?`).all(sucursalId, desde, hasta))
        r.push({ tipo: 'anticipo', id: a.id, fecha: a.fecha, monto: a.monto_cent, dir: 'cargo', cuenta: a.cuenta_origen || '', via: a.metodo, texto: `Anticipo a ${a.persona} · ${a.motivo}` });
      for (const a of db.prepare(`SELECT a.id, a.reintegro_fecha AS fecha, a.reintegro_cent, a.reintegro_metodo, a.reintegro_cuenta, a.motivo, p.nombre AS persona FROM main.anticipos a JOIN main.personal p ON p.id = a.personal_id
          WHERE a.estado = 'cerrado' AND a.reintegro_cent > 0 AND a.reintegro_metodo <> 'efectivo' AND a.sucursal_id = ? AND a.reintegro_fecha BETWEEN ? AND ?`).all(sucursalId, desde, hasta))
        r.push({ tipo: 'reintegro', id: a.id, fecha: a.fecha, monto: a.reintegro_cent, dir: 'abono', cuenta: a.reintegro_cuenta || '', via: a.reintegro_metodo, texto: `Reintegro de anticipo de ${a.persona} · ${a.motivo}` });
    }
    const usados = new Set(db.prepare('SELECT conciliado_tipo || \':\' || conciliado_id k FROM main.movimientos_banco WHERE conciliado_id IS NOT NULL').all().map(x => x.k));
    return r.map(m => ({ ...m, conciliado: usados.has(m.tipo + ':' + m.id) }));
  }
  const dirDe = m => (m.cargo_cent > 0 ? 'cargo' : 'abono'), montoDe = m => m.cargo_cent || m.abono_cent;
  const diasEntre = (a, b) => Math.abs(Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 864e5));
  // ¿Es de esta cuenta lo que dice el CRM? Si no dice cuenta, puede ser; si dice otra, no.
  const deLaCuenta = (cuenta, m) => !m.cuenta || norm(m.cuenta).includes(norm(cuenta.nombre)) || norm(cuenta.nombre).includes(norm(m.cuenta)) || (cuenta.terminacion && norm(m.cuenta).includes(norm(cuenta.terminacion)));

  // Empareja solos los movimientos sin conciliar de una cuenta (todo su historial). Devuelve cuántos.
  function emparejarSolos(cuenta) {
    const pend = db.prepare('SELECT * FROM main.movimientos_banco WHERE cuenta_id = ? AND conciliado_id IS NULL AND no_aplica = 0 ORDER BY fecha, id').all(cuenta.id);
    if (!pend.length) return 0;
    const desde = sumarDias(pend[0].fecha, -DIAS), hasta = sumarDias(pend[pend.length - 1].fecha, DIAS);
    const crm = movimientosCrm(cuenta.sucursal_id, desde, hasta).filter(m => !m.conciliado && deLaCuenta(cuenta, m));
    const tomados = new Set(); let n = 0;
    const marcar = db.prepare("UPDATE main.movimientos_banco SET conciliado_tipo = ?, conciliado_id = ?, conciliado_auto = 1, conciliado_por = NULL, conciliado_at = datetime('now','localtime') WHERE id = ? AND conciliado_id IS NULL");
    db.transaction(() => {
      for (const b of pend) {
        const cands = crm.filter(m => !tomados.has(m.tipo + ':' + m.id) && m.dir === dirDe(b) && m.monto === montoDe(b) && diasEntre(m.fecha, b.fecha) <= DIAS)
          .map(m => ({ m, puntos: (m.cuenta ? 0 : 10) + diasEntre(m.fecha, b.fecha) })).sort((x, y) => x.puntos - y.puntos);
        if (!cands.length || (cands[1] && cands[1].puntos === cands[0].puntos)) continue; // ninguno, o dos igual de buenos: a mano
        const m = cands[0].m; tomados.add(m.tipo + ':' + m.id); marcar.run(m.tipo, m.id, b.id); n++;
      }
    })();
    return n;
  }

  const fila = (b, crmPorClave) => ({ id: b.id, fecha: b.fecha, concepto: b.concepto || '', referencia: b.referencia || '', cargo: pesos(b.cargo_cent), abono: pesos(b.abono_cent), saldo: b.saldo_cent == null ? null : pesos(b.saldo_cent),
    hora: b.hora || '', contraparte: b.contraparte || '', contraparte_rfc: b.contraparte_rfc || '', rastreo: b.rastreo || '', detalle: b.detalle || '',
    conciliado: b.conciliado_id ? { tipo: b.conciliado_tipo, id: b.conciliado_id, auto: !!b.conciliado_auto, texto: crmPorClave?.get(b.conciliado_tipo + ':' + b.conciliado_id)?.texto || `${b.conciliado_tipo} #${b.conciliado_id}`,
      fecha: crmPorClave?.get(b.conciliado_tipo + ':' + b.conciliado_id)?.fecha || '' } : null,
    no_aplica: !!b.no_aplica, no_aplica_motivo: b.no_aplica_motivo || '' });

  // ---------- La conciliación de una cuenta y un mes ----------
  app.get('/api/conciliacion', h((req, res) => {
    if (!puede(req)) return negar(res);
    const cuentas = db.prepare('SELECT * FROM main.cuentas_banco WHERE activa = 1 AND en_alcance(sucursal_id) ORDER BY nombre').all();
    const mes = MES.test(req.query.mes || '') ? req.query.mes : hoyMexico().slice(0, 7);
    const lista = cuentas.map(c => ({ id: c.id, nombre: c.nombre, banco: c.banco, terminacion: c.terminacion || '', clave_folio: c.clave_folio || '', sucursal: app.locals.sucursales?.claveDe?.(c.sucursal_id) || '', columnas: c.columnas ? JSON.parse(c.columnas) : null }));
    const c = req.query.cuenta ? cuentaDe(req, req.query.cuenta) : cuentas[0];
    if (!c) return res.json({ cuentas: lista, mes, cuenta: null, puede_gasto: P.direccion(req) || P.puede(req, 'dinero.mover') });
    const d = mes + '-01', hst = mes + '-31';
    const banco = db.prepare('SELECT * FROM main.movimientos_banco WHERE cuenta_id = ? AND fecha BETWEEN ? AND ? ORDER BY fecha, id').all(c.id, d, hst);
    const crm = movimientosCrm(c.sucursal_id, sumarDias(d, -40), sumarDias(hst, 40)), porClave = new Map(crm.map(m => [m.tipo + ':' + m.id, m]));
    const crmDelMes = crm.filter(m => m.fecha >= d && m.fecha <= hst && !m.conciliado && deLaCuenta(c, m));
    const sum = (a, k) => a.reduce((t, x) => t + x[k], 0);
    const ultimoSaldo = [...banco].reverse().find(b => b.saldo_cent != null);
    res.json({ cuentas: lista, mes, puede_gasto: P.direccion(req) || P.puede(req, 'dinero.mover'),
      cuenta: { id: c.id, nombre: c.nombre, banco: c.banco, terminacion: c.terminacion || '', clave_folio: c.clave_folio || '', columnas: c.columnas ? JSON.parse(c.columnas) : null },
      conciliados: banco.filter(b => b.conciliado_id).map(b => fila(b, porClave)),
      banco_sin_crm: banco.filter(b => !b.conciliado_id && !b.no_aplica).map(b => fila(b)),
      no_aplica: banco.filter(b => b.no_aplica).map(b => fila(b)),
      crm_sin_banco: crmDelMes.map(m => ({ tipo: m.tipo, id: m.id, fecha: m.fecha, monto: pesos(m.monto), dir: m.dir, texto: m.texto, cuenta: m.cuenta, via: m.via })),
      totales: { movimientos: banco.length, abonos: pesos(sum(banco, 'abono_cent')), cargos: pesos(sum(banco, 'cargo_cent')), conciliados: banco.filter(b => b.conciliado_id).length,
        sin_crm: banco.filter(b => !b.conciliado_id && !b.no_aplica).length, crm_sin_banco: crmDelMes.length, saldo_final_banco: ultimoSaldo ? pesos(ultimoSaldo.saldo_cent) : null,
        saldo_fecha: ultimoSaldo?.fecha || '' } });
  }));

  // ---------- Cuentas de banco ----------
  app.post('/api/conciliacion/cuentas', h((req, res) => {
    if (!puede(req)) return negar(res);
    const b = req.body || {}, nombre = texto(b.nombre, 80), banco = texto(b.banco, 40);
    if (!nombre || !conSentido(nombre, 3)) return res.status(400).json({ error: 'Escribe el nombre de la cuenta como la anotan al pagar (por ejemplo: Santander nómina)' });
    if (!banco) return res.status(400).json({ error: 'Escribe el banco (Santander, Banorte…)' });
    const term = b.terminacion ? String(b.terminacion).replace(/\D/g, '').slice(-4) : null;
    const suc = Number(b.sucursal_id) || req.alcanceSuc?.permitidas?.[0];
    if (!suc || !(app.locals.sucursales?.lista?.() || []).some(s => s.id === suc) || !enAlcance(suc)) return res.status(400).json({ error: 'Elige la sucursal' });
    if (db.prepare('SELECT 1 FROM main.cuentas_banco WHERE sucursal_id = ? AND nombre = ? COLLATE NOCASE').get(suc, nombre)) return res.status(409).json({ error: 'Ya hay una cuenta con ese nombre en la sucursal' });
    // Clave de folio (2026-11-12): va en cada folio de la cuenta (STD-E-0001). Única en todo el sistema.
    const clave = b.clave_folio ? String(b.clave_folio).trim().toUpperCase() : null;
    if (clave && !require('./folios-banco').CLAVE.test(clave)) return res.status(400).json({ error: 'La clave de folio va en cada folio: de 2 a 6 letras o números, sin espacios (por ejemplo STD, BNT, PAG o CAJ)' });
    if (clave && db.prepare('SELECT 1 FROM main.cuentas_banco WHERE clave_folio = ?').get(clave)) return res.status(409).json({ error: `La clave ${clave} ya es de otra cuenta` });
    const id = Number(db.prepare('INSERT INTO main.cuentas_banco (nombre, banco, terminacion, sucursal_id, creada_por) VALUES (?, ?, ?, ?, ?)').run(nombre, banco, term, suc, yo(req)).lastInsertRowid);
    if (clave) db.prepare('UPDATE main.cuentas_banco SET clave_folio = ? WHERE id = ?').run(clave, id);
    app.locals.auditoria?.registrar(req, 'conciliacion', id, 'cuenta de banco', `${nombre} · ${banco}${term ? ' ••' + term : ''}${clave ? ' · folios ' + clave : ''}`);
    res.status(201).json({ id });
  }));

  // ---------- Subir el estado de cuenta (ya acomodado por la pantalla) ----------
  const fechaDe = v => {
    const t = String(v ?? '').trim();
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
    // Ocho números pegados (Santander: 01102026 = 1 de octubre de 2026): día-mes-año; si así no es una fecha de este
    // siglo, año-mes-día (20261001).
    m = t.replace(/^'+|'+$/g, '').match(/^(\d{8})$/);
    if (m) { const x = m[1], dma = `${x.slice(4)}-${x.slice(2, 4)}-${x.slice(0, 2)}`, amd = `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6)}`;
      const sirve = f => fechaValida(f) && f >= '2000-01-01' && f <= '2099-12-31'; return sirve(dma) ? dma : sirve(amd) ? amd : null; }
    return null;
  };
  const montoDeTexto = v => {
    const t = String(v ?? '').trim().replace(/[$\s]/g, '');
    if (!t || t === '-' || /^0+([.,]0+)?$/.test(t)) return 0;
    const neg = /^-|^\(.*\)$/.test(t), limpio = t.replace(/^-|[()]/g, '');
    const c = aCentavos(limpio.replace(/,(?=\d{3}(\D|$))/g, ''));
    return c == null ? null : (neg ? -c : c);
  };
  app.post('/api/conciliacion/cargar', h((req, res) => {
    if (!puede(req)) return negar(res);
    const b = req.body || {}, c = cuentaDe(req, b.cuenta_id);
    if (!c) return res.status(404).json({ error: 'Elige la cuenta de banco' });
    // El archivo tal como se bajó del banco («crudo»): si es de un formato conocido (Santander, Banorte) se acomoda solo.
    let formato = null;
    if (Array.isArray(b.crudo)) {
      if (b.crudo.length > 5200) return res.status(400).json({ error: 'Son demasiados renglones (máximo 5,000 por archivo)' });
      const r = require('./formatos-banco').reconocer(b.crudo);
      if (!r) return res.status(422).json({ error: 'No reconozco el formato de ese archivo: elige qué columna es cada cosa', codigo: 'FORMATO_DESCONOCIDO' });
      if (r.errores.length) return res.status(400).json({ error: `El archivo de ${r.banco} tiene ${r.errores.length} renglón(es) con problemas; no se guardó nada`, errores: r.errores.slice(0, 30) });
      // Que no se suba el archivo de una cuenta en otra: se compara con los últimos 4 dígitos de la cuenta.
      const term = String(c.terminacion || '').replace(/\D/g, '');
      if (term && r.cuenta && !r.cuenta.endsWith(term)) return res.status(400).json({ error: `Ese archivo es de la cuenta ••${r.cuenta.slice(-4)} y estás en «${c.nombre}» (••${term}). Cambia de cuenta arriba y súbelo ahí.`, codigo: 'OTRA_CUENTA' });
      formato = { banco: r.banco, cuenta: r.cuenta ? '••' + r.cuenta.slice(-4) : '' }; b.filas = r.filas;
    }
    if (!Array.isArray(b.filas) || !b.filas.length) return res.status(400).json({ error: 'El archivo no trae movimientos' });
    if (b.filas.length > 5000) return res.status(400).json({ error: 'Son demasiados renglones (máximo 5,000 por archivo)' });
    const hoy = hoyMexico(), errores = [], listos = [], vistos = new Map();
    b.filas.forEach((f, i) => {
      const ren = `Renglón ${i + 1}: `, fecha = fechaDe(f.fecha);
      if (!fecha || !fechaValida(fecha)) return errores.push(ren + 'la fecha no se entiende');
      if (fecha > hoy) return errores.push(ren + 'la fecha es futura');
      let cargo = montoDeTexto(f.cargo), abono = montoDeTexto(f.abono);
      if (f.importe !== undefined) { const imp = montoDeTexto(f.importe); if (imp == null) return errores.push(ren + 'el importe no se entiende'); cargo = imp < 0 ? -imp : 0; abono = imp > 0 ? imp : 0; }
      if (cargo == null || abono == null) return errores.push(ren + 'el cargo o el abono no se entienden');
      if (cargo < 0) { abono = -cargo; cargo = 0; } if (abono < 0) { cargo = -abono; abono = 0; }
      if ((cargo > 0) === (abono > 0)) return errores.push(ren + (cargo ? 'trae cargo y abono a la vez' : 'no trae ni cargo ni abono'));
      const saldo = f.saldo === undefined || f.saldo === null || String(f.saldo).trim() === '' ? null : montoDeTexto(f.saldo);
      const concepto = texto(String(f.concepto ?? ''), 300), referencia = texto(String(f.referencia ?? ''), 120);
      const base = [fecha, cargo, abono, norm(concepto), norm(referencia)].join('|'), k = (vistos.get(base) || 0) + 1; vistos.set(base, k);
      listos.push({ fecha, cargo, abono, saldo: saldo == null ? null : saldo, concepto, referencia, hora: /^\d{2}:\d{2}/.test(String(f.hora || '')) ? String(f.hora).slice(0, 5) : null,
        contraparte: texto(String(f.contraparte ?? ''), 160), contraparte_rfc: /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(String(f.contraparte_rfc || '')) ? f.contraparte_rfc : null,
        rastreo: texto(String(f.rastreo ?? ''), 60), detalle: texto(String(f.detalle ?? ''), 600), huella: require('crypto').createHash('sha256').update(base + '#' + k).digest('hex').slice(0, 32) });
    });
    if (errores.length) return res.status(400).json({ error: `El archivo tiene ${errores.length} renglón(es) con problemas; no se guardó nada`, errores: errores.slice(0, 30) });
    // Vista previa (la pantalla la enseña antes de subir un formato reconocido): qué se leyó, sin guardar nada.
    if (b.previa) { const yaEsta = db.prepare('SELECT 1 FROM main.movimientos_banco WHERE cuenta_id = ? AND huella = ?');
      return res.json({ previa: true, formato, leidos: listos.length, nuevos: listos.filter(f => !yaEsta.get(c.id, f.huella)).length, desde: listos.reduce((m, f) => (f.fecha < m ? f.fecha : m), listos[0].fecha),
        hasta: listos.reduce((m, f) => (f.fecha > m ? f.fecha : m), listos[0].fecha), cargos: pesos(listos.reduce((t, f) => t + f.cargo, 0)), abonos: pesos(listos.reduce((t, f) => t + f.abono, 0)),
        con_nombre: listos.filter(f => f.contraparte).length, saldo_final: (() => { const u = listos.filter(f => f.saldo != null).at(-1); return u ? pesos(u.saldo) : null; })() }); }
    const ins = db.prepare('INSERT OR IGNORE INTO main.movimientos_banco (cuenta_id, fecha, concepto, referencia, cargo_cent, abono_cent, saldo_cent, huella, archivo, subido_por, hora, contraparte, contraparte_rfc, rastreo, detalle) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    let nuevos = 0;
    db.transaction(() => {
      for (const f of listos) nuevos += ins.run(c.id, f.fecha, f.concepto, f.referencia, f.cargo, f.abono, f.saldo, f.huella, texto(b.archivo, 120), yo(req), f.hora, f.contraparte, f.contraparte_rfc, f.rastreo, f.detalle).changes;
      if (b.columnas && typeof b.columnas === 'object') db.prepare('UPDATE main.cuentas_banco SET columnas = ? WHERE id = ?').run(JSON.stringify(b.columnas).slice(0, 2000), c.id);
    })();
    const emparejados = emparejarSolos(c);
    app.locals.auditoria?.registrar(req, 'conciliacion', c.id, 'estado de cuenta', `${c.nombre}${formato ? ' (formato ' + formato.banco + ')' : ''}: ${nuevos} movimiento(s) nuevo(s) de ${listos.length}; ${emparejados} emparejado(s) solos`);
    res.status(201).json({ leidos: listos.length, nuevos, repetidos: listos.length - nuevos, emparejados, formato });
  }));

  // ---------- Emparejar solos (otra vez: p. ej. después de registrar un cobro que faltaba) ----------
  app.post('/api/conciliacion/cuentas/:id/emparejar', h((req, res) => {
    if (!puede(req)) return negar(res);
    const c = cuentaDe(req, req.params.id); if (!c) return res.status(404).json({ error: 'No se encontró la cuenta' });
    res.json({ emparejados: emparejarSolos(c) });
  }));

  const movDe = (req, id) => { const m = db.prepare('SELECT b.*, c.sucursal_id, c.nombre AS cuenta_nombre FROM main.movimientos_banco b JOIN main.cuentas_banco c ON c.id = b.cuenta_id WHERE b.id = ?').get(Number(id) || 0); return m && enAlcance(m.sucursal_id) ? m : null; };

  // Candidatos para emparejar a mano: misma dirección y mismo monto, hasta 30 días antes o después, sin conciliar.
  app.get('/api/conciliacion/movimientos/:id/candidatos', h((req, res) => {
    if (!puede(req)) return negar(res);
    const m = movDe(req, req.params.id); if (!m) return res.status(404).json({ error: 'No se encontró el movimiento' });
    const crm = movimientosCrm(m.sucursal_id, sumarDias(m.fecha, -30), sumarDias(m.fecha, 30)).filter(x => !x.conciliado && x.dir === dirDe(m) && x.monto === montoDe(m))
      .sort((a, b) => diasEntre(a.fecha, m.fecha) - diasEntre(b.fecha, m.fecha));
    res.json({ candidatos: crm.map(x => ({ tipo: x.tipo, id: x.id, fecha: x.fecha, monto: pesos(x.monto), texto: x.texto, cuenta: x.cuenta })) });
  }));
  app.post('/api/conciliacion/movimientos/:id/emparejar', h((req, res) => {
    if (!puede(req)) return negar(res);
    const m = movDe(req, req.params.id); if (!m) return res.status(404).json({ error: 'No se encontró el movimiento' });
    if (m.conciliado_id) return res.status(409).json({ error: 'Ese movimiento ya está conciliado' });
    const b = req.body || {};
    const x = movimientosCrm(m.sucursal_id, sumarDias(m.fecha, -30), sumarDias(m.fecha, 30)).find(v => v.tipo === b.tipo && v.id === Number(b.id));
    if (!x) return res.status(404).json({ error: 'No se encontró ese movimiento del CRM (o no es de la misma sucursal o fecha)' });
    if (x.conciliado) return res.status(409).json({ error: 'Ese movimiento del CRM ya está conciliado con otro del banco' });
    if (x.dir !== dirDe(m) || x.monto !== montoDe(m)) return res.status(400).json({ error: `No coincide: el banco dice ${dirDe(m)} de ${fmt(montoDe(m))} y el CRM ${x.dir} de ${fmt(x.monto)}` });
    db.prepare("UPDATE main.movimientos_banco SET conciliado_tipo = ?, conciliado_id = ?, conciliado_auto = 0, conciliado_por = ?, conciliado_at = datetime('now','localtime'), no_aplica = 0, no_aplica_motivo = NULL, no_aplica_por = NULL WHERE id = ?")
      .run(x.tipo, x.id, yo(req), m.id);
    app.locals.auditoria?.registrar(req, 'conciliacion', m.cuenta_id, 'emparejado a mano', `${m.cuenta_nombre} ${dma(m.fecha)} ${fmt(montoDe(m))} ↔ ${x.texto}`);
    res.json({ ok: true });
  }));
  app.post('/api/conciliacion/movimientos/:id/soltar', h((req, res) => {
    if (!puede(req)) return negar(res);
    const m = movDe(req, req.params.id); if (!m) return res.status(404).json({ error: 'No se encontró el movimiento' });
    if (!m.conciliado_id && !m.no_aplica) return res.status(409).json({ error: 'Ese movimiento no está conciliado' });
    db.prepare('UPDATE main.movimientos_banco SET conciliado_tipo = NULL, conciliado_id = NULL, conciliado_auto = 0, conciliado_por = NULL, conciliado_at = NULL, no_aplica = 0, no_aplica_motivo = NULL, no_aplica_por = NULL WHERE id = ?').run(m.id);
    app.locals.auditoria?.registrar(req, 'conciliacion', m.cuenta_id, 'soltado', `${m.cuenta_nombre} ${dma(m.fecha)} ${fmt(montoDe(m))}`);
    res.json({ ok: true });
  }));
  // «No aplica»: no corresponde a nada del CRM (p. ej. traspaso entre cuentas propias). Con motivo.
  app.post('/api/conciliacion/movimientos/:id/no-aplica', h((req, res) => {
    if (!puede(req)) return negar(res);
    const m = movDe(req, req.params.id); if (!m) return res.status(404).json({ error: 'No se encontró el movimiento' });
    if (m.conciliado_id) return res.status(409).json({ error: 'Ese movimiento ya está conciliado: suéltalo primero' });
    const motivo = texto(req.body?.motivo, 200);
    if (!motivo || !conSentido(motivo, 5)) return res.status(400).json({ error: 'Escribe por qué no aplica (por ejemplo: traspaso entre cuentas propias)' });
    db.prepare('UPDATE main.movimientos_banco SET no_aplica = 1, no_aplica_motivo = ?, no_aplica_por = ? WHERE id = ?').run(motivo, yo(req), m.id);
    app.locals.auditoria?.registrar(req, 'conciliacion', m.cuenta_id, 'no aplica', `${m.cuenta_nombre} ${dma(m.fecha)} ${fmt(montoDe(m))} · ${motivo}`);
    res.json({ ok: true });
  }));

  // ---------- Registrar como gasto un cargo del banco que no está en el CRM (comisión, cargo domiciliado…) ----------
  // Queda como gasto ya pagado desde esa cuenta, en la sucursal de la cuenta, y conciliado con el movimiento.
  app.post('/api/conciliacion/movimientos/:id/gasto', h((req, res) => {
    if (!puede(req)) return negar(res);
    if (!P.direccion(req) && !P.puede(req, 'dinero.mover')) return res.status(403).json({ error: 'Registrar el gasto lo hace quien mueve dinero' });
    const m = movDe(req, req.params.id); if (!m) return res.status(404).json({ error: 'No se encontró el movimiento' });
    if (m.conciliado_id) return res.status(409).json({ error: 'Ese movimiento ya está conciliado' });
    if (!m.cargo_cent) return res.status(400).json({ error: 'Solo un cargo del banco se registra como gasto (un abono es un cobro: regístralo en la orden de servicio)' });
    const b = req.body || {}, prov = db.prepare('SELECT * FROM main.proveedores WHERE id = ? AND activo = 1').get(Number(b.proveedor_id) || 0);
    if (!prov) return res.status(400).json({ error: 'Elige el proveedor (por ejemplo, el banco)' });
    const categoria = b.categoria || prov.categoria;
    if (!CATEGORIAS[categoria]) return res.status(400).json({ error: 'Elige la categoría' });
    const concepto = texto(b.concepto, 200) || texto(m.concepto, 200);
    if (!concepto || !conSentido(concepto, 3)) return res.status(400).json({ error: 'Escribe el concepto del gasto' });
    const COMP = F.COMPROBANTES, comp = b.tipo_comprobante && COMP[b.tipo_comprobante] ? b.tipo_comprobante : 'estado_cuenta';
    const cxpId = db.transaction(() => {
      const id = Number(db.prepare(`INSERT INTO main.cuentas_por_pagar (proveedor_id, categoria, concepto, fecha_documento, fecha_vencimiento, total_cent, notas, registrado_por, dias_credito, tipo_comprobante)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`).run(prov.id, categoria, concepto, m.fecha, m.fecha, m.cargo_cent, `Registrado desde la conciliación de ${m.cuenta_nombre} (${dma(m.fecha)}${m.referencia ? ', ref. ' + m.referencia : ''})`, yo(req), comp).lastInsertRowid);
      app.locals.sucursales.asignar('cuentas_por_pagar', id, m.sucursal_id);
      // Con la cuenta del estado de cuenta: así recibe su folio de esa cuenta (2026-11-12).
      const pago = Number(db.prepare("INSERT INTO main.pagos_proveedor (cxp_id, fecha, monto_cent, metodo, referencia, registrado_por, cuenta_origen, cuenta_id) VALUES (?, ?, ?, 'domiciliado', ?, ?, ?, ?)")
        .run(id, m.fecha, m.cargo_cent, texto(m.referencia, 120), yo(req), m.cuenta_nombre, m.cuenta_id).lastInsertRowid);
      db.prepare("UPDATE main.movimientos_banco SET conciliado_tipo = 'pago', conciliado_id = ?, conciliado_auto = 0, conciliado_por = ?, conciliado_at = datetime('now','localtime') WHERE id = ?").run(pago, yo(req), m.id);
      return id;
    })();
    app.locals.auditoria?.registrar(req, 'cuenta_por_pagar', cxpId, 'creada', `${prov.nombre} · «${concepto}» · ${fmt(m.cargo_cent)} · desde la conciliación de ${m.cuenta_nombre}`);
    res.status(201).json({ cxp_id: cxpId });
  }));
};
