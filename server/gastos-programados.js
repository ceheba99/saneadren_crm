// GASTOS PROGRAMADOS (Cuentas por pagar, fase 4, 2026-11-13; decisiones del usuario del 2026-11-12).
// Gastos que llegan cada cierto tiempo (luz, agua, renta, internet, teléfono…): se dan de alta una vez con nombre propio
// («Luz Cancún», «Luz casa de Miguel»), proveedor, categoría y los MESES en que llegan (p. ej. los bimestres de la CFE).
//  · Unos días antes del día en que llega (aviso_dias), el sistema avisa en Inicio y en la pestaña «Programados»:
//    «Falta registrar Luz Cancún · noviembre 2026». NO inventa montos: quien paga abre «Registrar gasto» ya llenado y solo
//    captura lo que falta (el monto del recibo o su XML). Si tiene monto fijo (renta), ya viene escrito.
//  · Cada mes queda «registrado» (ligado a su cuenta por pagar) u «omitido» (no llegó, con motivo). Si la cuenta por pagar
//    se cancela, el mes vuelve a quedar pendiente. Un mes omitido se puede reabrir.
//  · Solo quien paga cuentas por pagar (dinero.mover: Dirección, Gerente y Compras) los ve, los da de alta y los edita.
//    Nada se borra: un gasto programado que ya no aplica se desactiva.
const { hoyMexico } = require('./fechas');
const CxpExcel = require('../public/cxp-excel.js');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_ATRAS = 12; // un aviso sin atender se sigue mostrando hasta un año
const pad = n => String(n).padStart(2, '0');
const diasDelMes = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();
const sumarDias = (f, d) => { const [a, m, dd] = f.split('-').map(Number); return new Date(Date.UTC(a, m - 1, dd + d)).toISOString().slice(0, 10); };
const periodoTxt = per => { const [a, m] = per.split('-').map(Number); return MESES[m - 1] + ' ' + a; };
// Fecha en que llega el gasto de un periodo ('AAAA-MM'): el día elegido, o el último del mes si ese mes es más corto (31 → 30 de abril).
const fechaDe = (periodo, dia) => { const [a, m] = periodo.split('-').map(Number); return `${a}-${pad(m)}-${pad(Math.min(dia, diasDelMes(a, m)))}`; };
const mesesDe = txt => String(txt || '').split(',').map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 12);

// Meses que tocan aviso hoy: desde el mes de «desde» (o un año atrás) hasta el mes siguiente, los que el gasto tiene
// marcados, cuya fecha menos los días de aviso ya llegó. Puro: lo prueba tests/simulacion-gastos-programados.cjs.
function periodosPorAvisar(p, hoy) {
  const meses = new Set(mesesDe(p.meses)), salida = [];
  let [a, m] = hoy.split('-').map(Number);
  m -= MESES_ATRAS; while (m < 1) { m += 12; a--; }
  const [ah, mh] = hoy.split('-').map(Number), fin = ah * 12 + mh; // hasta el mes siguiente al de hoy (avisos de inicio de mes)
  for (let k = a * 12 + m - 1; k <= fin; k++) {
    const aa = Math.floor(k / 12), mm = (k % 12) + 1, periodo = `${aa}-${pad(mm)}`;
    if (!meses.has(mm)) continue;
    const fecha = fechaDe(periodo, p.dia);
    if (fecha < p.desde) continue;
    if (sumarDias(fecha, -(p.aviso_dias || 0)) > hoy) continue;
    salida.push({ periodo, fecha });
  }
  return salida;
}

module.exports = function gastosProgramados(app, db, h) {
  const P = app.locals.permisos;
  const F = require('./finanzas');
  const { aCentavos, fechaValida, texto, conSentido, aPesos, COMPROBANTES, CATEGORIAS } = F;
  const fmt = cent => '$' + (Math.round(Number(cent || 0)) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  db.exec(`CREATE TABLE IF NOT EXISTS gastos_programados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL CHECK(length(trim(nombre)) BETWEEN 3 AND 80),
    proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
    categoria TEXT NOT NULL,
    concepto TEXT,
    tipo_gasto TEXT,
    meses TEXT NOT NULL CHECK(length(meses) BETWEEN 1 AND 30),
    dia INTEGER NOT NULL CHECK(dia BETWEEN 1 AND 31),
    aviso_dias INTEGER NOT NULL DEFAULT 5 CHECK(aviso_dias BETWEEN 0 AND 30),
    monto_cent INTEGER CHECK(monto_cent IS NULL OR (typeof(monto_cent) = 'integer' AND monto_cent > 0)),
    tipo_comprobante TEXT,
    dias_credito INTEGER NOT NULL DEFAULT 0 CHECK(dias_credito BETWEEN 0 AND 365),
    beneficiario TEXT,
    notas TEXT,
    desde TEXT NOT NULL CHECK(length(desde) = 10 AND date(desde, '+0 days') = desde),
    sucursal_id INTEGER REFERENCES sucursales(id),
    activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
    creado_por INTEGER NOT NULL REFERENCES usuarios(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS gastos_programados_periodos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    programado_id INTEGER NOT NULL REFERENCES gastos_programados(id),
    periodo TEXT NOT NULL CHECK(length(periodo) = 7),
    estado TEXT NOT NULL CHECK(estado IN ('registrado', 'omitido', 'reabierto')),
    cxp_id INTEGER REFERENCES cuentas_por_pagar(id),
    motivo TEXT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(programado_id, periodo),
    CHECK(estado <> 'registrado' OR cxp_id IS NOT NULL),
    CHECK(estado <> 'omitido' OR length(trim(motivo)) >= 3)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_gprog_activo ON gastos_programados(activo)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_gprog_periodos_cxp ON gastos_programados_periodos(cxp_id)');
  const trigger = (nombre, cuerpo) => { db.exec(`DROP TRIGGER IF EXISTS ${nombre}`); db.exec(`CREATE TRIGGER ${nombre} ${cuerpo}`); };
  trigger('gastos_programados_sin_borrar', `BEFORE DELETE ON gastos_programados BEGIN SELECT RAISE(ABORT, 'Los gastos programados no se borran: se desactivan'); END`);
  trigger('gastos_programados_periodos_sin_borrar', `BEFORE DELETE ON gastos_programados_periodos BEGIN SELECT RAISE(ABORT, 'Los meses de un gasto programado no se borran: se reabren'); END`);

  const puede = req => P.puede(req, 'dinero.mover');
  const negar = res => res.status(403).json({ error: 'Los gastos programados los maneja quien paga cuentas por pagar' });
  // Solo los de las sucursales que ve quien pide (la vista temporal gastos_programados ya filtra por sucursal).
  const leer = id => db.prepare(`SELECT g.*, p.nombre AS proveedor_nombre FROM gastos_programados g JOIN main.proveedores p ON p.id = g.proveedor_id WHERE g.id = ?`).get(Number(id) || 0);
  // Estado de cada mes: registrado (con su cuenta vigente), omitido o pendiente (sin fila, reabierto o con la cuenta cancelada).
  const filaPeriodo = db.prepare(`SELECT r.*, x.cancelada AS cxp_cancelada, x.total_cent AS cxp_total FROM main.gastos_programados_periodos r
    LEFT JOIN main.cuentas_por_pagar x ON x.id = r.cxp_id WHERE r.programado_id = ? AND r.periodo = ?`);
  const hecho = r => !!r && ((r.estado === 'registrado' && r.cxp_cancelada === 0) || r.estado === 'omitido');
  function pendientesDe(p, hoy) {
    if (!p.activo) return [];
    return periodosPorAvisar(p, hoy).filter(({ periodo }) => !hecho(filaPeriodo.get(p.id, periodo))).map(({ periodo, fecha }) => ({
      programado_id: p.id, nombre: p.nombre, proveedor: p.proveedor_nombre, periodo, periodo_txt: periodoTxt(periodo), fecha, vencido: fecha < hoy,
      monto: p.monto_cent ? aPesos(p.monto_cent) : null,
    }));
  }
  function conDatos(p, hoy) {
    const ultimo = db.prepare(`SELECT r.periodo, r.estado, x.total_cent FROM main.gastos_programados_periodos r LEFT JOIN main.cuentas_por_pagar x ON x.id = r.cxp_id
      WHERE r.programado_id = ? AND ((r.estado = 'registrado' AND x.cancelada = 0) OR r.estado = 'omitido') ORDER BY r.periodo DESC LIMIT 1`).get(p.id);
    return { ...p, meses: mesesDe(p.meses), monto: p.monto_cent ? aPesos(p.monto_cent) : null, categoria_nombre: CATEGORIAS[p.categoria] || p.categoria,
      tipo_gasto_nombre: CxpExcel.tipoGastoTexto(p.tipo_gasto), ultimo: ultimo ? { periodo: ultimo.periodo, periodo_txt: periodoTxt(ultimo.periodo), estado: ultimo.estado, monto: ultimo.total_cent != null ? aPesos(ultimo.total_cent) : null } : null,
      pendientes: pendientesDe(p, hoy) };
  }

  // Revisa y arma los datos de un gasto programado (alta o edición). actual: el guardado (al editar).
  function datos(b, actual = null) {
    const nombre = texto(b.nombre, 80);
    if (!nombre || !conSentido(nombre, 3)) return { error: 'Escribe el nombre del gasto (ej. Luz Cancún)' };
    const prov = db.prepare('SELECT * FROM main.proveedores WHERE id = ?').get(Number(b.proveedor_id) || 0);
    if (!prov || (!prov.activo && prov.id !== actual?.proveedor_id)) return { error: 'Elige el proveedor (ej. CFE)' };
    const categoria = b.categoria || prov.categoria;
    if (!F.categoriaActiva(categoria) && categoria !== actual?.categoria) return { error: 'Elige una categoría vigente' };
    const tipoGasto = b.tipo_gasto === undefined || b.tipo_gasto === null || b.tipo_gasto === '' ? null : String(b.tipo_gasto);
    if (tipoGasto && !CxpExcel.esTipoGasto(tipoGasto)) return { error: 'Elige el tipo de gasto de la lista (mensual, bimestral…) o déjalo sin indicar' };
    const meses = Array.isArray(b.meses) ? [...new Set(b.meses.map(Number))].sort((x, y) => x - y) : [];
    if (!meses.length || meses.some(m => !Number.isInteger(m) || m < 1 || m > 12)) return { error: 'Marca en qué meses llega (al menos uno)' };
    const entero = (v, min, max, def) => (v === undefined || v === null || v === '' ? def : /^\s*\d{1,3}\s*$/.test(String(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : NaN);
    const dia = entero(b.dia, 1, 31, NaN);
    if (!Number.isInteger(dia)) return { error: 'Escribe el día del mes en que llega o vence (1 a 31)' };
    const avisoDias = entero(b.aviso_dias, 0, 30, 5);
    if (!Number.isInteger(avisoDias)) return { error: 'Los días de aviso van de 0 a 30' };
    const diasCredito = entero(b.dias_credito, 0, 365, 0);
    if (!Number.isInteger(diasCredito)) return { error: 'Los días de crédito van de 0 a 365' };
    let monto = null;
    if (b.monto !== undefined && b.monto !== null && String(b.monto).trim() !== '') { monto = aCentavos(b.monto); if (!monto) return { error: 'El monto fijo debe ser mayor a 0 (o déjalo vacío si cambia cada vez)' }; }
    const comp = b.tipo_comprobante ? String(b.tipo_comprobante) : null;
    if (comp && !COMPROBANTES[comp]) return { error: 'Elige el tipo de comprobante de la lista' };
    const hoy = hoyMexico();
    const desde = b.desde ? String(b.desde) : actual?.desde || hoy.slice(0, 8) + '01';
    if (!fechaValida(desde)) return { error: 'La fecha «desde» no es válida' };
    const concepto = texto(b.concepto, 200);
    if (b.notas !== undefined && b.notas !== null && String(b.notas).trim().length > 1000) return { error: 'Las observaciones son muy largas (máximo 1000 letras)' };
    return { nombre, proveedor_id: prov.id, categoria, concepto, tipo_gasto: tipoGasto, meses: meses.join(','), dia, aviso_dias: avisoDias, monto_cent: monto, tipo_comprobante: comp,
      dias_credito: diasCredito, beneficiario: texto(b.beneficiario, 120), notas: texto(b.notas, 1000), desde };
  }
  const repetido = (nombre, sinId) => db.prepare("SELECT id FROM gastos_programados WHERE lower(trim(nombre)) = lower(trim(?)) AND id <> ? AND activo = 1").get(nombre, sinId || 0);
  const CAMPOS = ['nombre', 'proveedor_id', 'categoria', 'concepto', 'tipo_gasto', 'meses', 'dia', 'aviso_dias', 'monto_cent', 'tipo_comprobante', 'dias_credito', 'beneficiario', 'notas', 'desde'];

  // ---------- Lista y pendientes ----------
  app.get('/api/gastos-programados', h((req, res) => {
    if (!puede(req)) return negar(res);
    const hoy = hoyMexico();
    const programados = db.prepare(`SELECT g.*, p.nombre AS proveedor_nombre FROM gastos_programados g JOIN main.proveedores p ON p.id = g.proveedor_id ORDER BY g.activo DESC, g.nombre`).all().map(p => conDatos(p, hoy));
    const pendientes = programados.flatMap(p => p.pendientes).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.nombre.localeCompare(b.nombre));
    res.json({ programados, pendientes, hoy });
  }));
  // Inicio: lo que falta registrar (solo a quien paga; a los demás, nada).
  app.get('/api/gastos-programados/avisos', h((req, res) => {
    if (!puede(req)) return res.json({ avisos: [] });
    const hoy = hoyMexico();
    const filas = db.prepare(`SELECT g.*, p.nombre AS proveedor_nombre FROM gastos_programados g JOIN main.proveedores p ON p.id = g.proveedor_id WHERE g.activo = 1`).all();
    const avisos = filas.flatMap(p => pendientesDe(p, hoy)).sort((a, b) => a.fecha.localeCompare(b.fecha)).map(x => ({ ...x, urgente: x.vencido,
      texto: `Falta registrar ${x.nombre} · ${x.periodo_txt}`, detalle: `${x.proveedor} · ${x.vencido ? 'llegaba el' : 'llega el'} ${x.fecha.split('-').reverse().join('/')}${x.monto ? ' · ' + fmt(Math.round(x.monto * 100)) : ''}` }));
    res.json({ avisos });
  }));

  // ---------- Alta, edición y activar/desactivar ----------
  app.post('/api/gastos-programados', h((req, res) => {
    if (!puede(req)) return negar(res);
    const d = datos(req.body || {});
    if (d.error) return res.status(400).json({ error: d.error });
    if (repetido(d.nombre)) return res.status(409).json({ error: `Ya hay un gasto programado activo llamado «${d.nombre}»` });
    const id = db.transaction(() => {
      const info = db.prepare(`INSERT INTO main.gastos_programados (${CAMPOS.join(', ')}, creado_por) VALUES (${CAMPOS.map(() => '?').join(', ')}, ?)`).run(...CAMPOS.map(k => d[k]), req.usuarioSesion.id);
      const nuevo = Number(info.lastInsertRowid);
      app.locals.sucursales.asignar('gastos_programados', nuevo);
      app.locals.auditoria?.registrar(req, 'gasto_programado', nuevo, 'creado', `${d.nombre} · meses ${d.meses} · día ${d.dia}${d.monto_cent ? ' · ' + fmt(d.monto_cent) : ''}`);
      return nuevo;
    })();
    res.status(201).json(conDatos(leer(id), hoyMexico()));
  }));
  app.put('/api/gastos-programados/:id', h((req, res) => {
    if (!puede(req)) return negar(res);
    const actual = leer(req.params.id);
    if (!actual) return res.status(404).json({ error: 'Gasto programado no encontrado' });
    const d = datos({ ...actual, monto: actual.monto_cent != null ? actual.monto_cent / 100 : null, meses: mesesDe(actual.meses), ...req.body }, actual);
    if (d.error) return res.status(400).json({ error: d.error });
    if (actual.activo && repetido(d.nombre, actual.id)) return res.status(409).json({ error: `Ya hay un gasto programado activo llamado «${d.nombre}»` });
    db.prepare(`UPDATE main.gastos_programados SET ${CAMPOS.map(k => k + ' = ?').join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`).run(...CAMPOS.map(k => d[k]), actual.id);
    const dif = app.locals.auditoria?.diferencias(actual, d, CAMPOS);
    if (dif) app.locals.auditoria.registrar(req, 'gasto_programado', actual.id, 'editado', `${actual.nombre}: ${dif}`);
    res.json(conDatos(leer(actual.id), hoyMexico()));
  }));
  app.post('/api/gastos-programados/:id/activo', h((req, res) => {
    if (!puede(req)) return negar(res);
    const actual = leer(req.params.id);
    if (!actual) return res.status(404).json({ error: 'Gasto programado no encontrado' });
    const activo = req.body?.activo ? 1 : 0;
    if (activo && repetido(actual.nombre, actual.id)) return res.status(409).json({ error: `Ya hay otro gasto programado activo llamado «${actual.nombre}»` });
    db.prepare("UPDATE main.gastos_programados SET activo = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(activo, actual.id);
    if (activo !== actual.activo) app.locals.auditoria?.registrar(req, 'gasto_programado', actual.id, activo ? 'activado' : 'desactivado', actual.nombre);
    res.json({ ok: true, activo });
  }));

  // ---------- Un mes: «no llegó» (omitir) o reabrirlo ----------
  const periodoValido = per => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(per || ''));
  app.post('/api/gastos-programados/:id/omitir', h((req, res) => {
    if (!puede(req)) return negar(res);
    const p = leer(req.params.id);
    if (!p) return res.status(404).json({ error: 'Gasto programado no encontrado' });
    const periodo = String(req.body?.periodo || ''), motivo = texto(req.body?.motivo, 200);
    if (!periodoValido(periodo) || !mesesDe(p.meses).includes(Number(periodo.slice(5)))) return res.status(400).json({ error: 'Ese mes no le toca a este gasto' });
    if (!motivo || !conSentido(motivo, 3)) return res.status(400).json({ error: 'Escribe por qué no se registra (ej. no llegó el recibo, se pagó junto con otro)' });
    const r = filaPeriodo.get(p.id, periodo);
    if (hecho(r)) return res.status(409).json({ error: r.estado === 'omitido' ? 'Ese mes ya está marcado como «no llegó»' : 'Ese mes ya tiene su gasto registrado' });
    db.prepare(`INSERT INTO main.gastos_programados_periodos (programado_id, periodo, estado, motivo, usuario_id) VALUES (?, ?, 'omitido', ?, ?)
      ON CONFLICT(programado_id, periodo) DO UPDATE SET estado = 'omitido', motivo = excluded.motivo, cxp_id = NULL, usuario_id = excluded.usuario_id, updated_at = datetime('now','localtime')`).run(p.id, periodo, motivo, req.usuarioSesion.id);
    app.locals.auditoria?.registrar(req, 'gasto_programado', p.id, 'mes omitido', `${p.nombre} · ${periodoTxt(periodo)}: ${motivo}`);
    res.json({ ok: true });
  }));
  app.post('/api/gastos-programados/:id/reabrir', h((req, res) => {
    if (!puede(req)) return negar(res);
    const p = leer(req.params.id);
    if (!p) return res.status(404).json({ error: 'Gasto programado no encontrado' });
    const periodo = String(req.body?.periodo || ''), r = periodoValido(periodo) ? filaPeriodo.get(p.id, periodo) : null;
    if (!r || r.estado !== 'omitido') return res.status(400).json({ error: 'Solo se reabre un mes marcado como «no llegó»' });
    db.prepare("UPDATE main.gastos_programados_periodos SET estado = 'reabierto', usuario_id = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(req.usuarioSesion.id, r.id);
    app.locals.auditoria?.registrar(req, 'gasto_programado', p.id, 'mes reabierto', `${p.nombre} · ${periodoTxt(periodo)}`);
    res.json({ ok: true });
  }));

  // ---------- Para «Registrar gasto» (server/finanzas.js) ----------
  // Revisa que el gasto programado y el mes se puedan registrar; marcar() liga la cuenta por pagar al mes (misma transacción).
  app.locals.gastosProgramados = {
    paraGasto(req, id, periodo) {
      if (!puede(req)) return { status: 403, error: 'Los gastos programados los registra quien paga cuentas por pagar' };
      const p = leer(id);
      if (!p) return { status: 404, error: 'Gasto programado no encontrado' };
      if (!periodoValido(periodo) || !mesesDe(p.meses).includes(Number(String(periodo).slice(5)))) return { status: 400, error: 'Ese mes no le toca a este gasto programado' };
      const r = filaPeriodo.get(p.id, periodo);
      if (hecho(r)) return { status: 409, error: r.estado === 'omitido' ? `${p.nombre} de ${periodoTxt(periodo)} está marcado como «no llegó»: reábrelo primero` : `${p.nombre} de ${periodoTxt(periodo)} ya está registrado` };
      return { programado: p };
    },
    marcar(req, id, periodo, cxpId) {
      // Otro proceso lo registró entre la revisión y el guardado: se deshace todo (la transacción del gasto se cancela).
      if (hecho(filaPeriodo.get(id, periodo))) throw Object.assign(new Error('Ese mes del gasto programado ya se registró'), { code: 'SQLITE_CONSTRAINT_PROGRAMADO' });
      db.prepare(`INSERT INTO main.gastos_programados_periodos (programado_id, periodo, estado, cxp_id, usuario_id) VALUES (?, ?, 'registrado', ?, ?)
        ON CONFLICT(programado_id, periodo) DO UPDATE SET estado = 'registrado', cxp_id = excluded.cxp_id, motivo = NULL, usuario_id = excluded.usuario_id, updated_at = datetime('now','localtime')`).run(id, periodo, cxpId, req.usuarioSesion.id);
    },
  };
};
module.exports.periodosPorAvisar = periodosPorAvisar;
module.exports.fechaDe = fechaDe;
