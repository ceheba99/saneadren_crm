// CRÉDITOS (Cuentas por pagar, fase 5, 2026-11-13; decisiones del usuario del 2026-11-12).
// Un crédito (PyME, revolvente, automotriz, terreno…) se captura con TODOS sus datos, como las hojas «CREDITO …» del
// Excel del usuario: banco, número de contrato, tasa, monto, total a pagar, apertura, plazo, mensualidad, fechas, día y
// cuenta de cargo, unidad y factura.
//  · Sus mensualidades son cuentas por pagar normales (se pagan, concilian y descargan como cualquier gasto), ligadas al
//    crédito (cuentas_por_pagar.credito_id / credito_num / credito_tipo) con su desglose opcional de capital, intereses e
//    IVA de intereses. Se programan las que se quieran (12, 24 o todas): IGUALES (mismo monto) o PEGANDO LA CORRIDA del
//    banco (renglones con número, fecha, capital, intereses, IVA y total), porque en la práctica cambian cada mes.
//  · Abonos extra: un gasto normal ligado al crédito como «abono» (todo es capital). Si el banco baja la mensualidad o el
//    plazo, «Reprogramar» cancela las mensualidades sin ningún pago y se programan de nuevo con la corrida nueva.
//  · Saldo de capital: el inicial (o el monto del crédito) menos el capital de las mensualidades pagadas completas y los
//    abonos pagados. Solo es exacto si la corrida trae el capital; sin desglose se dice que es un estimado.
//  · Capital e intereses NO cambian cómo cuenta en Resultados: la categoría decide (regla aprobada; pendiente del contador).
//  · Solo quien paga cuentas por pagar (dinero.mover). Nada se borra: un crédito se marca liquidado o cancelado.
const { hoyMexico } = require('./fechas');
const CxpExcel = require('../public/cxp-excel.js');

const TIPOS = { pyme_simple: 'Crédito PyME simple', revolvente: 'Crédito revolvente', automotriz: 'Crédito automotriz', arrendamiento: 'Arrendamiento',
  inmueble: 'Terreno o inmueble', prestamo: 'Préstamo', otro: 'Otro' };
const MAX_RENGLONES = 600;
const pad = n => String(n).padStart(2, '0');
// Fecha de la mensualidad n: la primera más (n-1) meses, el mismo día (o el último del mes si es más corto).
function fechaMensualidad(primera, n) {
  const [a, m, d] = primera.split('-').map(Number), t = a * 12 + (m - 1) + (n - 1), aa = Math.floor(t / 12), mm = (t % 12) + 1;
  return `${aa}-${pad(mm)}-${pad(Math.min(d, new Date(Date.UTC(aa, mm, 0)).getUTCDate()))}`;
}
// Montos pegados de Excel: «$45,889.13», «45889.13», «45 889,13» no (coma decimal no se usa en México). Vacío = null.
function centavos(v) {
  const t = String(v ?? '').replace(/[$\s]/g, '').replace(/,/g, '');
  if (!t || t === '-') return null;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100);
}
// La fecha existe de verdad (31/02 no): se arma y se compara.
const fechaReal = f => { const [a, m, d] = f.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d)).toISOString().slice(0, 10) === f; };
function fechaPegada(v) {
  const t = String(v ?? '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}
// La corrida pegada de Excel (separada por tabuladores o «;»): MENSUALIDAD, FECHA, CAPITAL, INTERESES, IVA INTERESES, TOTAL.
// Capital, intereses e IVA pueden ir vacíos; el total es obligatorio. Los renglones de títulos o totales se ignoran.
function leerCorrida(texto) {
  const filas = [], errores = [];
  String(texto || '').split(/\r?\n/).forEach((linea, i) => {
    if (!linea.trim()) return;
    const c = linea.split(/\t|;/).map(x => x.trim());
    if (!/^\d+(\.0+)?$/.test(c[0] || '')) return; // títulos, «TOTALES», etc.
    const num = Number(c[0]), fecha = fechaPegada(c[1]);
    const [capital, interes, iva, total] = [c[2], c[3], c[4], c[5]].map(centavos);
    const r = `Renglón ${i + 1} (mensualidad ${num})`;
    if (!num || num > 600) errores.push(`${r}: número de mensualidad inválido`);
    else if (!fecha || !fechaReal(fecha)) errores.push(`${r}: la fecha no es válida (usa dd/mm/aaaa)`);
    else if ([capital, interes, iva, total].some(Number.isNaN)) errores.push(`${r}: un monto no es número`);
    else if (!(total > 0)) errores.push(`${r}: falta el TOTAL A PAGAR (sexta columna)`);
    else if ([capital, interes, iva].some(x => x !== null && x < 0)) errores.push(`${r}: capital, intereses e IVA no pueden ser negativos`);
    else filas.push({ num, fecha, capital, interes, iva, total });
  });
  const vistos = new Set();
  for (const f of filas) { if (vistos.has(f.num)) errores.push(`La mensualidad ${f.num} viene dos veces`); vistos.add(f.num); }
  if (filas.length > MAX_RENGLONES) errores.push(`Son ${filas.length} renglones: el máximo es ${MAX_RENGLONES}`);
  return { filas, errores };
}

module.exports = function creditos(app, db, h) {
  const P = app.locals.permisos;
  const F = require('./finanzas');
  const { aCentavos, fechaValida, texto, conSentido, aPesos, CATEGORIAS } = F;
  const fmt = cent => '$' + (Math.round(Number(cent || 0)) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  db.exec(`CREATE TABLE IF NOT EXISTS creditos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL CHECK(length(trim(nombre)) BETWEEN 3 AND 100),
    proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
    tipo TEXT NOT NULL,
    numero TEXT, fecha_contrato TEXT,
    monto_cent INTEGER NOT NULL CHECK(typeof(monto_cent) = 'integer' AND monto_cent > 0),
    total_pagar_cent INTEGER, enganche_cent INTEGER, apertura_cent INTEGER, comisiones_cent INTEGER,
    tasa_anual REAL CHECK(tasa_anual IS NULL OR (tasa_anual >= 0 AND tasa_anual <= 300)),
    plazo_meses INTEGER NOT NULL CHECK(plazo_meses BETWEEN 1 AND 600),
    mensualidad_cent INTEGER CHECK(mensualidad_cent IS NULL OR mensualidad_cent > 0),
    fecha_primer_pago TEXT NOT NULL CHECK(length(fecha_primer_pago) = 10 AND date(fecha_primer_pago, '+0 days') = fecha_primer_pago),
    fecha_fin TEXT, cuenta_cargo TEXT, domiciliado INTEGER NOT NULL DEFAULT 1 CHECK(domiciliado IN (0, 1)),
    unidad TEXT, factura_unidad TEXT,
    categoria TEXT NOT NULL,
    pagadas_antes INTEGER NOT NULL DEFAULT 0 CHECK(pagadas_antes >= 0),
    saldo_inicial_cent INTEGER CHECK(saldo_inicial_cent IS NULL OR saldo_inicial_cent >= 0),
    notas TEXT,
    sucursal_id INTEGER REFERENCES sucursales(id),
    estado TEXT NOT NULL DEFAULT 'vigente' CHECK(estado IN ('vigente', 'liquidado', 'cancelado')),
    motivo_estado TEXT,
    creado_por INTEGER NOT NULL REFERENCES usuarios(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT,
    CHECK(pagadas_antes < plazo_meses)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_creditos_estado ON creditos(estado)');
  const cols = db.prepare('PRAGMA table_info(cuentas_por_pagar)').all().map(c => c.name);
  for (const [c, t] of [['credito_id', 'INTEGER REFERENCES creditos(id)'], ['credito_num', 'INTEGER'], ['credito_tipo', 'TEXT'], ['credito_capital_cent', 'INTEGER'], ['credito_interes_cent', 'INTEGER'], ['credito_iva_cent', 'INTEGER']])
    if (!cols.includes(c)) db.exec(`ALTER TABLE cuentas_por_pagar ADD COLUMN ${c} ${t}`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_cxp_credito ON cuentas_por_pagar(credito_id)');
  db.exec('DROP TRIGGER IF EXISTS creditos_sin_borrar');
  db.exec("CREATE TRIGGER creditos_sin_borrar BEFORE DELETE ON creditos BEGIN SELECT RAISE(ABORT, 'Los créditos no se borran: se marcan liquidados o cancelados'); END");

  const puede = req => P.puede(req, 'dinero.mover');
  const negar = res => res.status(403).json({ error: 'Los créditos los maneja quien paga cuentas por pagar' });
  const leer = id => db.prepare('SELECT c.*, p.nombre AS proveedor_nombre FROM creditos c JOIN main.proveedores p ON p.id = c.proveedor_id WHERE c.id = ?').get(Number(id) || 0);
  // Cuentas por pagar del crédito (vigentes) con lo pagado de cada una.
  const cuentasDe = id => db.prepare(`SELECT x.*, (SELECT COALESCE(SUM(monto_cent), 0) FROM main.pagos_proveedor g WHERE g.cxp_id = x.id AND g.cancelado = 0) AS pagado_cent,
      (SELECT MAX(fecha) FROM main.pagos_proveedor g WHERE g.cxp_id = x.id AND g.cancelado = 0) AS fecha_pago
    FROM main.cuentas_por_pagar x WHERE x.credito_id = ? AND x.cancelada = 0 ORDER BY x.credito_tipo = 'abono', x.credito_num, x.fecha_documento, x.id`).all(id);
  function resumen(c) {
    const cuentas = cuentasDe(c.id), hoy = hoyMexico();
    const mens = cuentas.filter(x => x.credito_tipo === 'mensualidad'), abonos = cuentas.filter(x => x.credito_tipo === 'abono');
    const pagadas = mens.filter(x => x.pagado_cent >= x.total_cent);
    const pagado = cuentas.reduce((t, x) => t + Math.min(x.pagado_cent, x.total_cent), 0);
    const porPagar = cuentas.reduce((t, x) => t + Math.max(x.total_cent - x.pagado_cent, 0), 0);
    const sinDesglose = pagadas.some(x => x.credito_capital_cent == null);
    const capitalPagado = pagadas.reduce((t, x) => t + (x.credito_capital_cent || 0), 0) + abonos.reduce((t, x) => t + Math.min(x.pagado_cent, x.total_cent), 0);
    const base = c.saldo_inicial_cent ?? c.monto_cent;
    const siguiente = mens.filter(x => x.pagado_cent < x.total_cent).sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))[0] || null;
    return {
      mensualidades_programadas: mens.length, mensualidades_pagadas: c.pagadas_antes + pagadas.length, plazo: c.plazo_meses,
      por_programar: Math.max(c.plazo_meses - c.pagadas_antes - mens.length, 0), ultima_programada: mens.reduce((m, x) => Math.max(m, x.credito_num || 0), c.pagadas_antes),
      pagado: aPesos(pagado), por_pagar: aPesos(porPagar), abonos: aPesos(abonos.reduce((t, x) => t + Math.min(x.pagado_cent, x.total_cent), 0)),
      saldo_capital: aPesos(Math.max(base - capitalPagado, 0)), saldo_capital_estimado: sinDesglose,
      vencidas: mens.filter(x => x.pagado_cent < x.total_cent && x.fecha_vencimiento < hoy).length,
      siguiente: siguiente ? { num: siguiente.credito_num, fecha: siguiente.fecha_vencimiento, total: aPesos(siguiente.total_cent - siguiente.pagado_cent) } : null,
    };
  }
  const publico = c => ({ ...c, tipo_nombre: TIPOS[c.tipo] || c.tipo, categoria_nombre: CATEGORIAS[c.categoria] || c.categoria,
    monto: aPesos(c.monto_cent), mensualidad: c.mensualidad_cent != null ? aPesos(c.mensualidad_cent) : null,
    ...Object.fromEntries(['total_pagar', 'enganche', 'apertura', 'comisiones', 'saldo_inicial'].map(k => [k, c[k + '_cent'] != null ? aPesos(c[k + '_cent']) : null])),
    resumen: resumen(c) });

  // ---------- Revisar los datos del crédito ----------
  const CAMPOS = ['nombre', 'proveedor_id', 'tipo', 'numero', 'fecha_contrato', 'monto_cent', 'total_pagar_cent', 'enganche_cent', 'apertura_cent', 'comisiones_cent', 'tasa_anual',
    'plazo_meses', 'mensualidad_cent', 'fecha_primer_pago', 'fecha_fin', 'cuenta_cargo', 'domiciliado', 'unidad', 'factura_unidad', 'categoria', 'pagadas_antes', 'saldo_inicial_cent', 'notas'];
  function datos(b, actual = null) {
    const nombre = texto(b.nombre, 100);
    if (!nombre || !conSentido(nombre, 3)) return { error: 'Escribe el nombre del crédito (ej. Crédito PyME Banorte)' };
    const prov = db.prepare('SELECT * FROM main.proveedores WHERE id = ?').get(Number(b.proveedor_id) || 0);
    if (!prov || (!prov.activo && prov.id !== actual?.proveedor_id)) return { error: 'Elige el banco o financiera (debe estar en Proveedores)' };
    const tipo = b.tipo || 'otro';
    if (!TIPOS[tipo]) return { error: 'Elige el tipo de crédito de la lista' };
    const dinero = (v, nombreCampo, obligatorio = false) => {
      if (v === undefined || v === null || String(v).trim() === '') return obligatorio ? { error: `Escribe ${nombreCampo}` } : { cent: null };
      const c = aCentavos(v); return c ? { cent: c } : { error: `Revisa ${nombreCampo} (mayor a 0, máximo 2 decimales)` };
    };
    const montos = {};
    for (const [k, nom, obl] of [['monto', 'el monto del crédito', true], ['total_pagar', 'el monto total a pagar'], ['enganche', 'el enganche o anticipo'], ['apertura', 'la comisión por apertura'],
      ['comisiones', 'otras comisiones'], ['mensualidad', 'la mensualidad']]) { const r = dinero(b[k], nom, obl); if (r.error) return r; montos[k + '_cent'] = r.cent; }
    let saldoInicial = null;
    if (b.saldo_inicial !== undefined && b.saldo_inicial !== null && String(b.saldo_inicial).trim() !== '') {
      saldoInicial = /^\s*\$?\s*0+(\.0+)?\s*$/.test(String(b.saldo_inicial)) ? 0 : aCentavos(b.saldo_inicial);
      if (saldoInicial === null) return { error: 'Revisa el saldo de capital al empezar en el sistema' };
    }
    let tasa = null;
    if (b.tasa_anual !== undefined && b.tasa_anual !== null && String(b.tasa_anual).trim() !== '') {
      tasa = Number(String(b.tasa_anual).replace('%', '').trim());
      if (!Number.isFinite(tasa) || tasa < 0 || tasa > 300) return { error: 'La tasa anual va en porcentaje (ej. 14.25)' };
    }
    const entero = (v, min, max) => (/^\s*\d{1,3}\s*$/.test(String(v ?? '')) && Number(v) >= min && Number(v) <= max ? Number(v) : NaN);
    const plazo = entero(b.plazo_meses, 1, 600);
    if (!Number.isInteger(plazo)) return { error: 'Escribe el plazo en meses (1 a 600)' };
    const pagadasAntes = b.pagadas_antes === undefined || b.pagadas_antes === null || b.pagadas_antes === '' ? 0 : entero(b.pagadas_antes, 0, 599);
    if (!Number.isInteger(pagadasAntes) || pagadasAntes >= plazo) return { error: 'Las mensualidades pagadas antes del sistema deben ser menos que el plazo' };
    const fechaPrimer = String(b.fecha_primer_pago || '');
    if (!fechaValida(fechaPrimer)) return { error: 'Escribe la fecha de la primera mensualidad' };
    for (const [k, nom] of [['fecha_contrato', 'del contrato'], ['fecha_fin', 'de fin']]) if (b[k] && !fechaValida(String(b[k]))) return { error: `La fecha ${nom} no es válida` };
    if (b.fecha_fin && String(b.fecha_fin) < fechaPrimer) return { error: 'La fecha de fin no puede ser antes de la primera mensualidad' };
    const categoria = b.categoria || 'creditos';
    if (!F.categoriaActiva(categoria) && categoria !== actual?.categoria) return { error: 'Elige una categoría vigente' };
    if (b.notas !== undefined && b.notas !== null && String(b.notas).trim().length > 1000) return { error: 'Las observaciones son muy largas (máximo 1000 letras)' };
    return { nombre, proveedor_id: prov.id, tipo, numero: texto(b.numero, 60), fecha_contrato: b.fecha_contrato || null, ...montos, tasa_anual: tasa, plazo_meses: plazo,
      fecha_primer_pago: fechaPrimer, fecha_fin: b.fecha_fin || null, cuenta_cargo: texto(b.cuenta_cargo, 80), domiciliado: b.domiciliado === false || b.domiciliado === 0 || b.domiciliado === '0' ? 0 : 1,
      unidad: texto(b.unidad, 120), factura_unidad: texto(b.factura_unidad, 60), categoria, pagadas_antes: pagadasAntes, saldo_inicial_cent: saldoInicial, notas: texto(b.notas, 1000) };
  }
  const repetido = (nombre, sinId) => db.prepare("SELECT id FROM creditos WHERE lower(trim(nombre)) = lower(trim(?)) AND id <> ? AND estado = 'vigente'").get(nombre, sinId || 0);

  // ---------- Lista, ficha, alta y edición ----------
  app.get('/api/creditos', h((req, res) => {
    if (!puede(req)) return negar(res);
    const lista = db.prepare("SELECT c.*, p.nombre AS proveedor_nombre FROM creditos c JOIN main.proveedores p ON p.id = c.proveedor_id ORDER BY c.estado = 'vigente' DESC, c.nombre").all().map(publico);
    res.json({ creditos: lista, tipos: TIPOS });
  }));
  app.get('/api/creditos/:id', h((req, res) => {
    if (!puede(req)) return negar(res);
    const c = leer(req.params.id);
    if (!c) return res.status(404).json({ error: 'Crédito no encontrado' });
    const hoy = hoyMexico();
    res.json({ credito: publico(c), cuentas: cuentasDe(c.id).map(x => ({ id: x.id, tipo: x.credito_tipo, num: x.credito_num, concepto: x.concepto, fecha: x.fecha_vencimiento,
      total: aPesos(x.total_cent), pagado: aPesos(Math.min(x.pagado_cent, x.total_cent)), saldo: aPesos(Math.max(x.total_cent - x.pagado_cent, 0)), fecha_pago: x.fecha_pago,
      capital: x.credito_capital_cent != null ? aPesos(x.credito_capital_cent) : null, interes: x.credito_interes_cent != null ? aPesos(x.credito_interes_cent) : null,
      iva: x.credito_iva_cent != null ? aPesos(x.credito_iva_cent) : null, status: CxpExcel.statusDe(x.total_cent, x.pagado_cent), vencida: x.pagado_cent < x.total_cent && x.fecha_vencimiento < hoy })) });
  }));
  app.post('/api/creditos', h((req, res) => {
    if (!puede(req)) return negar(res);
    const d = datos(req.body || {});
    if (d.error) return res.status(400).json({ error: d.error });
    if (repetido(d.nombre)) return res.status(409).json({ error: `Ya hay un crédito vigente llamado «${d.nombre}»` });
    const id = db.transaction(() => {
      const nuevo = Number(db.prepare(`INSERT INTO main.creditos (${CAMPOS.join(', ')}, creado_por) VALUES (${CAMPOS.map(() => '?').join(', ')}, ?)`).run(...CAMPOS.map(k => d[k]), req.usuarioSesion.id).lastInsertRowid);
      app.locals.sucursales.asignar('creditos', nuevo);
      app.locals.auditoria?.registrar(req, 'credito', nuevo, 'creado', `${d.nombre} · ${fmt(d.monto_cent)} · ${d.plazo_meses} meses${d.tasa_anual != null ? ' · tasa ' + d.tasa_anual + ' %' : ''}`);
      return nuevo;
    })();
    res.status(201).json(publico(leer(id)));
  }));
  app.put('/api/creditos/:id', h((req, res) => {
    if (!puede(req)) return negar(res);
    const actual = leer(req.params.id);
    if (!actual) return res.status(404).json({ error: 'Crédito no encontrado' });
    const pesosDe = k => (actual[k + '_cent'] != null ? actual[k + '_cent'] / 100 : null);
    const d = datos({ ...actual, ...Object.fromEntries(['monto', 'total_pagar', 'enganche', 'apertura', 'comisiones', 'mensualidad', 'saldo_inicial'].map(k => [k, pesosDe(k)])), ...req.body }, actual);
    if (d.error) return res.status(400).json({ error: d.error });
    if (actual.estado === 'vigente' && repetido(d.nombre, actual.id)) return res.status(409).json({ error: `Ya hay un crédito vigente llamado «${d.nombre}»` });
    const ultima = resumen(actual).ultima_programada;
    if (d.plazo_meses < ultima) return res.status(409).json({ error: `Ya hay mensualidades programadas hasta la ${ultima}: el plazo no puede ser menor (reprograma primero)` });
    db.prepare(`UPDATE main.creditos SET ${CAMPOS.map(k => k + ' = ?').join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`).run(...CAMPOS.map(k => d[k]), actual.id);
    const dif = app.locals.auditoria?.diferencias(actual, d, CAMPOS);
    if (dif) app.locals.auditoria.registrar(req, 'credito', actual.id, 'editado', `${actual.nombre}: ${dif}`);
    res.json(publico(leer(actual.id)));
  }));

  // ---------- Programar mensualidades (iguales o con la corrida del banco) ----------
  const insCxp = () => db.prepare(`INSERT INTO main.cuentas_por_pagar (proveedor_id, categoria, concepto, fecha_documento, fecha_vencimiento, total_cent, notas, registrado_por, dias_credito,
      tipo_comprobante, tipo_gasto, credito_id, credito_num, credito_tipo, credito_capital_cent, credito_interes_cent, credito_iva_cent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'estado_cuenta', ?, ?, ?, 'mensualidad', ?, ?, ?)`);
  const tipoGastoDe = plazo => (CxpExcel.esTipoGasto(plazo + '_meses') ? plazo + '_meses' : 'mensual');
  app.post('/api/creditos/:id/programar', h((req, res) => {
    if (!puede(req)) return negar(res);
    const c = leer(req.params.id);
    if (!c) return res.status(404).json({ error: 'Crédito no encontrado' });
    if (c.estado !== 'vigente') return res.status(409).json({ error: 'El crédito ya no está vigente' });
    const r = resumen(c), b = req.body || {};
    const activas = new Set(cuentasDe(c.id).filter(x => x.credito_tipo === 'mensualidad').map(x => x.credito_num));
    let filas;
    if (b.modo === 'corrida') {
      const leida = leerCorrida(b.corrida);
      if (leida.errores.length) return res.status(400).json({ error: 'Revisa la corrida: ' + leida.errores.slice(0, 5).join('; '), errores: leida.errores });
      if (!leida.filas.length) return res.status(400).json({ error: 'Pega la corrida: cada renglón con MENSUALIDAD, FECHA, CAPITAL, INTERESES, IVA INTERESES y TOTAL A PAGAR' });
      const fuera = leida.filas.filter(f => f.num > c.plazo_meses);
      if (fuera.length) return res.status(400).json({ error: `La corrida trae la mensualidad ${fuera[0].num} y el plazo es de ${c.plazo_meses}: corrige el plazo del crédito` });
      filas = leida.filas.filter(f => f.num > c.pagadas_antes && !activas.has(f.num));
    } else {
      const cuantas = Number(b.cuantas);
      if (!Number.isInteger(cuantas) || cuantas < 1 || cuantas > MAX_RENGLONES) return res.status(400).json({ error: '¿Cuántas mensualidades programas? (1 o más)' });
      const monto = b.monto !== undefined && b.monto !== null && String(b.monto).trim() !== '' ? aCentavos(b.monto) : c.mensualidad_cent;
      if (!monto) return res.status(400).json({ error: 'Escribe el monto de la mensualidad (o captúralo en los datos del crédito)' });
      filas = [];
      for (let n = c.pagadas_antes + 1; n <= c.plazo_meses && filas.length < cuantas; n++) if (!activas.has(n)) filas.push({ num: n, fecha: fechaMensualidad(c.fecha_primer_pago, n), capital: null, interes: null, iva: null, total: monto });
    }
    if (!filas.length) return res.status(409).json({ error: r.por_programar ? 'Esas mensualidades ya están programadas' : `Ya están programadas todas las mensualidades (${c.plazo_meses})` });
    const notas = [c.numero ? 'Crédito ' + c.numero : '', c.cuenta_cargo ? (c.domiciliado ? 'domiciliado a ' : 'cargo a ') + c.cuenta_cargo : ''].filter(Boolean).join(' · ') || null;
    db.transaction(() => {
      const ins = insCxp();
      for (const f of filas) {
        const desglose = f.capital != null || f.interes != null || f.iva != null ? ` (capital ${fmt(f.capital || 0)}, intereses ${fmt(f.interes || 0)}, IVA ${fmt(f.iva || 0)})` : '';
        const info = ins.run(c.proveedor_id, c.categoria, `Mensualidad ${f.num} de ${c.plazo_meses} · ${c.nombre}`.slice(0, 200), f.fecha, f.fecha, f.total, notas, req.usuarioSesion.id,
          tipoGastoDe(c.plazo_meses), c.id, f.num, f.capital, f.interes, f.iva);
        app.locals.sucursales.asignar('cuentas_por_pagar', Number(info.lastInsertRowid), c.sucursal_id ?? undefined);
        app.locals.auditoria?.registrar(req, 'cuenta_por_pagar', Number(info.lastInsertRowid), 'creada', `${c.nombre} · mensualidad ${f.num} de ${c.plazo_meses} · ${fmt(f.total)} · ${f.fecha}${desglose}`);
      }
      app.locals.auditoria?.registrar(req, 'credito', c.id, 'mensualidades programadas', `${filas.length} (${filas[0].num} a ${filas[filas.length - 1].num})${b.modo === 'corrida' ? ' con la corrida del banco' : ' iguales'}`);
    })();
    res.status(201).json({ ok: true, programadas: filas.length, desde: filas[0].num, hasta: filas[filas.length - 1].num, credito: publico(leer(c.id)) });
  }));

  // Reprogramar: cancela las mensualidades que no tienen ningún pago (p. ej. tras un abono el banco cambió la corrida).
  app.post('/api/creditos/:id/reprogramar', h((req, res) => {
    if (!puede(req)) return negar(res);
    const c = leer(req.params.id);
    if (!c) return res.status(404).json({ error: 'Crédito no encontrado' });
    const motivo = texto(req.body?.motivo, 300);
    if (!motivo || !conSentido(motivo, 5)) return res.status(400).json({ error: 'Escribe por qué se reprograma (ej. abono a capital: el banco bajó la mensualidad)' });
    const sinPago = cuentasDe(c.id).filter(x => x.credito_tipo === 'mensualidad' && x.pagado_cent === 0);
    if (!sinPago.length) return res.status(409).json({ error: 'No hay mensualidades sin pagar que reprogramar' });
    db.transaction(() => {
      const upd = db.prepare("UPDATE main.cuentas_por_pagar SET cancelada = 1, cancelada_por = ?, cancelada_at = datetime('now','localtime'), motivo_cancelacion = ? WHERE id = ? AND cancelada = 0");
      for (const x of sinPago) upd.run(req.usuarioSesion.id, 'Reprogramada: ' + motivo, x.id);
      app.locals.auditoria?.registrar(req, 'credito', c.id, 'reprogramado', `${sinPago.length} mensualidades sin pagar canceladas (${sinPago.map(x => x.credito_num).join(', ')}): ${motivo}`);
    })();
    res.json({ ok: true, canceladas: sinPago.length, credito: publico(leer(c.id)) });
  }));

  // Liquidado (ya no se debe nada), cancelado (se capturó por error, sin cuentas vigentes) o de nuevo vigente.
  app.post('/api/creditos/:id/estado', h((req, res) => {
    if (!puede(req)) return negar(res);
    const c = leer(req.params.id);
    if (!c) return res.status(404).json({ error: 'Crédito no encontrado' });
    const estado = String(req.body?.estado || ''), motivo = texto(req.body?.motivo, 300);
    if (!['vigente', 'liquidado', 'cancelado'].includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
    if (estado === c.estado) return res.json({ ok: true, credito: publico(c) });
    if (estado !== 'vigente' && (!motivo || !conSentido(motivo, 5))) return res.status(400).json({ error: 'Escribe el motivo (mínimo 5 letras)' });
    const r = resumen(c);
    if (estado === 'liquidado' && r.por_pagar > 0) return res.status(409).json({ error: `Tiene ${fmt(Math.round(r.por_pagar * 100))} por pagar en sus mensualidades: págalas o reprográmalas antes de liquidarlo` });
    if (estado === 'cancelado' && cuentasDe(c.id).length) return res.status(409).json({ error: 'Tiene mensualidades o abonos registrados: un crédito con movimientos se marca liquidado, no cancelado' });
    if (estado === 'vigente' && repetido(c.nombre, c.id)) return res.status(409).json({ error: `Ya hay otro crédito vigente llamado «${c.nombre}»` });
    db.prepare("UPDATE main.creditos SET estado = ?, motivo_estado = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(estado, estado === 'vigente' ? null : motivo, c.id);
    app.locals.auditoria?.registrar(req, 'credito', c.id, estado, `${c.nombre}${motivo ? ': ' + motivo : ''}`);
    res.json({ ok: true, credito: publico(leer(c.id)) });
  }));

  // ---------- Abonos (desde «Registrar gasto», server/finanzas.js) ----------
  app.locals.creditos = {
    paraAbono(req, id) {
      if (!puede(req)) return { status: 403, error: 'Los abonos a créditos los registra quien paga cuentas por pagar' };
      const c = leer(id);
      if (!c) return { status: 404, error: 'Crédito no encontrado' };
      if (c.estado !== 'vigente') return { status: 409, error: 'El crédito ya no está vigente' };
      return { credito: c };
    },
    marcarAbono(cxpId, creditoId, totalCent) {
      db.prepare("UPDATE main.cuentas_por_pagar SET credito_id = ?, credito_tipo = 'abono', credito_capital_cent = ? WHERE id = ?").run(creditoId, totalCent, cxpId);
    },
  };
};
module.exports.leerCorrida = leerCorrida;
module.exports.fechaMensualidad = fechaMensualidad;
module.exports.TIPOS = TIPOS;
