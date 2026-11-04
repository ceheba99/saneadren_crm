// RH (2026-11-03, pedido de Dirección): la pestaña «RH» que junta todo lo de recursos humanos, y la CARGA DE
// TRABAJADORES EN LOTE desde la plantilla de Excel.
//  · Resumen (quien ve el personal): activos, sin horario, sin alta en el checador, sin aviso de privacidad firmado,
//    PIN bloqueados y, con «Ver asistencia», checadas por revisar. Todo de sus sucursales (vistas de la base).
//  · Carga en lote (quien edita el personal): la pantalla lee el Excel y manda las filas. Primero «revisar» (no guarda
//    nada: dice qué está mal en cada fila, con su número de fila del Excel) y luego «guardar» (vuelve a revisar todo y
//    guarda TODO o NADA). Cada persona recibe su número de empleado consecutivo (personal.js); si la fila lo pide, su
//    horario (con «Horarios y días festivos») y su alta en el reloj checador con PIN temporal. La respuesta trae los
//    códigos y PIN para repartir: es la única vez que se ven (la base guarda solo el hash del PIN).
//  · Columnas (decididas con Dirección: datos generales, horario y checador): nombre, puesto, sucursal, teléfono,
//    correo, fecha de ingreso, contacto y teléfono de emergencia, horario, checador (Sí/No). Sin datos sensibles.
const { ahoraMexico } = require('./fechas');

const MAX_FILAS = 300;
const COLUMNAS = ['nombre', 'puesto', 'sucursal', 'telefono', 'correo', 'fecha_ingreso', 'contacto_emergencia', 'tel_emergencia', 'horario', 'checador'];
const SI = /^(s[ií]|x|1|true|verdadero)$/i;
const texto = v => (v === null || v === undefined ? '' : String(v).trim());

module.exports = function rh(app, db, h) {
  const P = app.locals.permisos, puede = (req, k) => P.puede(req, k);
  const negar = (res, msg) => res.status(403).json({ error: msg || 'No tienes permiso para RH' });

  const resumen = (req, res) => {
    if (!puede(req, 'personal.ver')) return negar(res);
    const hoy = ahoraMexico().fecha, uno = (sql, ...p) => db.prepare(sql).get(...p).n;
    const activos = "FROM personal p WHERE p.activo = 1";
    res.json({
      activos: uno(`SELECT COUNT(*) n ${activos}`),
      sin_checador: uno(`SELECT COUNT(*) n ${activos} AND p.codigo_checador IS NULL`),
      sin_horario: uno(`SELECT COUNT(*) n ${activos} AND p.checa = 1 AND NOT EXISTS (SELECT 1 FROM main.personal_horario ph WHERE ph.personal_id = p.id AND ph.desde <= ?)`, hoy),
      sin_aviso: uno(`SELECT COUNT(*) n ${activos} AND p.codigo_checador IS NOT NULL AND NOT EXISTS (SELECT 1 FROM main.documentos_personal d WHERE d.personal_id = p.id AND d.tipo = 'privacidad' AND d.eliminado = 0)`),
      pin_bloqueados: uno(`SELECT COUNT(*) n ${activos} AND p.pin_bloqueado_hasta > ?`, Date.now()),
      por_revisar: puede(req, 'asistencia.ver') ? uno("SELECT COUNT(*) n FROM checadas c WHERE c.estado = 'por_revisar'") : null,
      puede: { editar: puede(req, 'personal.editar'), asistencia: puede(req, 'asistencia.ver'), horarios: puede(req, 'asistencia.horarios'), kioscos: puede(req, 'asistencia.kioscos'), sensibles: puede(req, 'personal.sensibles') },
    });
  };
  app.get('/api/rh', h(resumen)); // la pestaña RH pide su resumen aquí
  app.get('/api/rh/resumen', h(resumen));

  // Revisa todas las filas sin guardar. Regresa { filas: [{ fila, nombre, errores, datos, horario, checador }], hay_errores }.
  function revisar(req, filas) {
    const personal = app.locals.personal, asistencia = app.locals.asistencia;
    const sucursales = db.prepare('SELECT id, nombre, clave FROM main.sucursales WHERE activo = 1').all().filter(s => req.alcanceSuc?.permitidas?.includes(s.id));
    const vistos = new Map(), salida = [];
    filas.forEach((f, i) => {
      const x = Object.fromEntries(COLUMNAS.map(k => [k, texto(f?.[k])])), errores = [], fila = Number.isInteger(f?.fila) ? f.fila : i + 2;
      // Sucursal: por clave o nombre, de las suyas. Si solo tiene una, esa.
      let suc = null;
      if (x.sucursal) suc = sucursales.find(s => s.clave.toLowerCase() === x.sucursal.toLowerCase() || s.nombre.toLowerCase() === x.sucursal.toLowerCase()) || null;
      else if (sucursales.length === 1) suc = sucursales[0];
      if (!suc) errores.push(x.sucursal ? `La sucursal «${x.sucursal}» no existe o no es tuya` : 'Escribe la sucursal (su clave, p. ej. QRO)');
      const puesto = personal.PUESTOS.find(p => p.toLowerCase() === x.puesto.toLowerCase()) || x.puesto;
      const v = personal.revisarAlta(req, { nombre: x.nombre, puesto, telefono: x.telefono, correo: x.correo, fecha_ingreso: x.fecha_ingreso || null, contacto_emergencia: x.contacto_emergencia, tel_emergencia: x.tel_emergencia, ...(suc ? { sucursal_id: suc.id } : {}) });
      if (v.error) errores.push(v.error === 'Elige el puesto' ? (x.puesto ? `Puesto «${x.puesto}» no válido (usa uno de la lista)` : 'Falta el puesto') : v.error);
      if (x.telefono && !/^[\p{L}\d\s()+.,:;/#*-]{0,25}$/u.test(x.telefono)) errores.push('Teléfono con caracteres raros');
      const llave = x.nombre.toLowerCase().replace(/\s+/g, ' ');
      if (llave && vistos.has(llave)) errores.push(`Está repetido en la fila ${vistos.get(llave)}`); else if (llave) vistos.set(llave, fila);
      let horario = null;
      if (x.horario) {
        if (!puede(req, 'asistencia.horarios')) errores.push('No tienes permiso para asignar horarios: deja vacía la columna «Horario»');
        else if (suc) { horario = asistencia.horarioPorNombre(suc.id, x.horario); if (!horario) errores.push(`No existe el horario «${x.horario}» en ${suc.nombre}`); }
      }
      if (x.checador && !SI.test(x.checador) && !/^(no|0|)$/i.test(x.checador)) errores.push('En «Checador» escribe Sí o No');
      salida.push({ fila, nombre: x.nombre, puesto, sucursal: suc?.nombre || null, horario: horario?.nombre || null, checador: SI.test(x.checador), errores, _datos: v.datos, _horario: horario });
    });
    return { filas: salida, hay_errores: salida.some(f => f.errores.length) };
  }
  const leerFilas = (req, res) => {
    const filas = req.body?.filas;
    if (!Array.isArray(filas) || !filas.length) { res.status(400).json({ error: 'El archivo no tiene trabajadores' }); return null; }
    if (filas.length > MAX_FILAS) { res.status(400).json({ error: `Máximo ${MAX_FILAS} trabajadores por archivo` }); return null; }
    return filas;
  };
  const publico = r => ({ ...r, filas: r.filas.map(({ _datos, _horario, ...f }) => f) });

  app.post('/api/rh/importar/revisar', h((req, res) => {
    if (!puede(req, 'personal.editar')) return negar(res, 'No tienes permiso para dar de alta personal');
    const filas = leerFilas(req, res); if (!filas) return;
    res.json(publico(revisar(req, filas)));
  }));
  app.post('/api/rh/importar/guardar', h((req, res) => {
    if (!puede(req, 'personal.editar')) return negar(res, 'No tienes permiso para dar de alta personal');
    const filas = leerFilas(req, res); if (!filas) return;
    const r = revisar(req, filas);
    if (r.hay_errores) return res.status(400).json({ error: 'Hay filas con errores: no se guardó nada. Corrígelas y vuelve a intentar.', ...publico(r) });
    const hoy = ahoraMexico().fecha;
    const creados = db.transaction(() => r.filas.map(f => {
      const id = app.locals.personal.guardarAlta(req, f._datos);
      const p = db.prepare('SELECT * FROM main.personal WHERE id = ?').get(id);
      if (f._horario) app.locals.asistencia.asignarHorario(req, p, f._horario, p.fecha_ingreso && p.fecha_ingreso <= hoy ? p.fecha_ingreso : hoy);
      const ch = f.checador ? app.locals.checador.altaChecador(req, p) : null;
      return { numero_empleado: p.numero_empleado, nombre: p.nombre, puesto: p.puesto, sucursal: f.sucursal, horario: f.horario, codigo: ch?.codigo || null, pin: ch?.pin || null };
    }))();
    app.locals.auditoria?.registrar(req, 'personal', null, 'carga en lote', `${creados.length} trabajador(es) desde la plantilla (${creados.filter(c => c.codigo).length} con alta en el checador)`);
    res.status(201).json({ creados, aviso: 'Descarga la hoja de códigos y PIN ahora: los PIN no se vuelven a mostrar.' });
  }));
};
module.exports.COLUMNAS = COLUMNAS;
