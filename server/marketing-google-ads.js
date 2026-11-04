// MARKETING · LLAMADAS DE GOOGLE ADS (decidido con Dirección el 2026-11-04).
//  · Se sube el reporte «Detalles de las llamadas» que exporta Google Ads (CSV en español, separado por comas):
//    línea 1 el título, línea 2 el rango («1 de octubre de 2026 - 26 de octubre de 2026»), línea 3 los encabezados
//    (Hora de inicio, Duración (segundos), Código de país…, Prefijo…, Número de teléfono…, Grabación, Estado, Fuente
//    de la llamada, Tipo de llamada, Campaña). La hora viene redondeada a la hora; sin número, Google pone « --».
//  · Dos pasos: «vista previa» (solo lee: errores por renglón, cuántas son nuevas y cuántas ya estaban) y «cargar»
//    (vuelve a leer el mismo CSV y guarda solo las nuevas). Cada llamada lleva una huella (hora + número + duración +
//    campaña + cuántas iguales van en el archivo): subir otra vez el mismo periodo no duplica nada.
//  · El cruce con el CRM NO se guarda: se calcula al pedir el reporte, así una llamada que se registra después aparece
//    como registrada sin volver a subir nada. Por teléfono a 10 dígitos (clientes, sus otros teléfonos y cotizaciones):
//      registrada            el contacto o una cotización suya se dio de alta entre el día de la llamada y 7 días después;
//      cliente que ya existía el contacto ya estaba antes de la llamada (y no hubo cotización nueva en esos 7 días);
//      sin registrar         no aparece en el CRM (o se dio de alta más de 7 días después);
//      sin número            Google no lo da (o es del extranjero, +1).
//    Las registradas: si terminaron en orden de servicio (ganado) y su importe sin IVA. Cada cotización cuenta una sola
//    vez, para la primera llamada de ese número que la alcanza.
//  · Sucursal = la del contacto. Las que no están registradas quedan «sin sucursal», con aviso de cuántas son lada
//    55/56 (CDMX y zona): en octubre de 2026 fueron la mayoría y CDMX aún no abre.
//  · Lo ven y lo cargan SOLO Dirección y el Gerente de marketing («Dinero de Marketing»), no el rol Marketing: el
//    reporte trae ventas e importes. No muestra nombres de contactos (solo números de Google y conteos).
const crypto = require('crypto');
const { leerCsv } = require('./facturacion-importar-clientes');

const MAX_FILAS = 20000;
const VENTANA_DIAS = 7;
const MESES = { ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, may: 5, mayo: 5, jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8,
  sep: 9, sept: 9, set: 9, septiembre: 9, setiembre: 9, oct: 10, octubre: 10, nov: 11, noviembre: 11, dic: 12, diciembre: 12 };
// Encabezados del CSV (sin acentos y en minúsculas) → llave interna. «Grabación» no se usa.
const COLUMNAS = { inicio: 'hora de inicio', duracion: 'duracion (segundos)', pais: 'codigo de pais de la persona que llama', prefijo: 'prefijo de la persona que llama',
  numero: 'numero de telefono de la persona que llama', estado: 'estado', fuente: 'fuente de la llamada', tipo: 'tipo de llamada', campana: 'campana' };
const CRUCES = { registrada: 'Registrada', ya_existia: 'Cliente que ya existía', sin_registrar: 'Sin registrar', sin_numero: 'Sin número' };
const LADAS = { cdmx: 'CDMX y zona (55/56)', otra: 'Otras ladas', extranjero: 'Extranjero (+1 u otro país)', sin_numero: 'Sin número' };
const LADA_NOMBRE = { 442: 'Querétaro' };

const llano = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const sumarDias = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fechaValida = f => { const d = new Date(f + 'T00:00:00Z'); return /^\d{4}-\d{2}-\d{2}$/.test(f) && !isNaN(d) && d.toISOString().slice(0, 10) === f; };
const fechaIso = (a, m, d) => { const f = `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; return fechaValida(f) ? f : null; };

/** «3 oct 2026, 14:00:00» → { fecha: '2026-10-03', hora: 14 }. También acepta «3 oct. 2026 14:00» y el mes completo. */
function leerHora(t) {
  const m = llano(t).match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\.?\s+(?:de\s+)?(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m || !MESES[m[2]]) return null;
  const fecha = fechaIso(m[3], MESES[m[2]], m[1]), hora = Number(m[4]);
  return fecha && hora <= 23 && Number(m[5]) <= 59 ? { fecha, hora, minuto: Number(m[5]) } : null;
}
/** «1 de octubre de 2026 - 26 de octubre de 2026» → { desde, hasta } (o null si no se entiende). */
function leerRango(t) {
  const partes = llano(t).split(/\s+[-–]\s+/);
  if (partes.length !== 2) return null;
  const una = p => { const m = p.match(/^(\d{1,2})\s+(?:de\s+)?([a-z]+)\.?\s+(?:de\s+)?(\d{4})$/); return m && MESES[m[2]] ? fechaIso(m[3], MESES[m[2]], m[1]) : null; };
  const desde = una(partes[0]), hasta = una(partes[1]);
  return desde && hasta && desde <= hasta ? { desde, hasta } : null;
}
// Igual que normalizarTelefono de db.js (no se importa db.js: abriría la base real al probar este archivo suelto).
function normalizarTelefono(tel) {
  const d = String(tel || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('52')) return d.slice(2);
  if (d.length === 13 && (d.startsWith('521') || d.startsWith('044') || d.startsWith('045'))) return d.slice(3);
  return d;
}
const ladaDe = (pais, digitos, tel10) => (!digitos ? 'sin_numero' : pais && pais !== '52' ? 'extranjero' : /^5[56]/.test(tel10) ? 'cdmx' : 'otra');

/** Lee el CSV completo. Devuelve { error } o { rango, llamadas: [...], errores: [{ fila, error, texto }] }. */
function leerReporte(csv) {
  const filas = leerCsv(csv);
  const iCab = filas.findIndex(f => llano(f[0]) === COLUMNAS.inicio);
  if (iCab < 0) return { error: 'Este archivo no parece el reporte «Detalles de las llamadas» de Google Ads: no se encontró el encabezado «Hora de inicio». Descárgalo de nuevo en formato CSV.' };
  const cab = filas[iCab].map(llano), col = {};
  for (const [k, nombre] of Object.entries(COLUMNAS)) { col[k] = cab.indexOf(nombre); if (col[k] < 0) return { error: `Al reporte le falta la columna «${{ inicio: 'Hora de inicio', duracion: 'Duración (segundos)', pais: 'Código de país de la persona que llama', prefijo: 'Prefijo de la persona que llama', numero: 'Número de teléfono de la persona que llama', estado: 'Estado', fuente: 'Fuente de la llamada', tipo: 'Tipo de llamada', campana: 'Campaña' }[k]}»` }; }
  const datos = filas.slice(iCab + 1);
  if (!datos.length) return { error: 'El reporte no trae llamadas' };
  if (datos.length > MAX_FILAS) return { error: `El reporte trae ${datos.length} renglones; el máximo por archivo es ${MAX_FILAS}. Descárgalo por periodos más cortos.` };
  let rango = null; for (const f of filas.slice(0, iCab)) rango ||= leerRango(f[0]) && { texto: String(f[0]).trim(), ...leerRango(f[0]) };
  const llamadas = [], errores = [], vistas = {};
  datos.forEach((f, i) => {
    const fila = iCab + 2 + i, v = k => String(f[col[k]] ?? '').trim(), mal = error => errores.push({ fila, error, texto: f.join(',').slice(0, 160) });
    if (llano(f[0]).startsWith('total')) return; // renglones de totales que a veces agrega Google
    const h = leerHora(v('inicio')); if (!h) return mal(`«Hora de inicio» no se entiende: «${v('inicio').slice(0, 40)}» (se espera como «3 oct 2026, 14:00:00»)`);
    const dur = v('duracion'); if (!/^\d{1,6}$/.test(dur)) return mal(`«Duración (segundos)» no es un número entero: «${dur.slice(0, 20)}»`);
    const pais = v('pais').replace(/\D/g, ''), digitos = v('numero').replace(/\D/g, '');
    // El número sin su código de país («+52 55 1111 2222» → 5511112222), para no confundir «+52 55 1234 56» con 10 dígitos.
    const conMas = v('numero').startsWith('+'), local = conMas && pais && digitos.startsWith(pais) ? digitos.slice(pais.length) : conMas ? '' : digitos;
    let tel10 = '';
    if (digitos) {
      if (conMas && !local) return mal(`El número «${v('numero').slice(0, 30)}» no coincide con su código de país «${pais || '(vacío)'}»`);
      if (pais === '52' || !pais) { tel10 = local.length === 11 && local.startsWith('1') ? local.slice(1) : local.length === 10 ? local : normalizarTelefono(local); if (tel10.length !== 10) return mal(`El número «${v('numero').slice(0, 30)}» no tiene 10 dígitos`); }
      else if (pais === '1' && local.length === 10) tel10 = local; // EUA: se busca en el CRM por sus 10 dígitos
    }
    const campana = v('campana').slice(0, 160) || '(sin campaña)', estado = v('estado').slice(0, 40) || '(sin estado)';
    // Huella: dos llamadas iguales en el mismo archivo (misma hora, número, duración y campaña) son dos llamadas distintas.
    const llave = `${h.fecha} ${String(h.hora).padStart(2, '0')}:${String(h.minuto).padStart(2, '0')}|${pais}${digitos}|${dur}|${llano(campana)}`;
    vistas[llave] = (vistas[llave] || 0) + 1;
    llamadas.push({ fila, huella: crypto.createHash('sha256').update(llave + '#' + vistas[llave]).digest('hex').slice(0, 40), fecha: h.fecha, hora: h.hora,
      duracion_seg: Number(dur), pais, telefono: !digitos ? '' : v('numero').startsWith('+') || !pais ? v('numero').slice(0, 30) : '+' + pais + ' ' + v('numero').slice(0, 30), telefono_10: tel10,
      lada: ladaDe(pais, digitos, tel10), estado, fuente: v('fuente').slice(0, 80), tipo: v('tipo').slice(0, 80), campana });
  });
  return { rango, llamadas, errores };
}

module.exports = function marketingGoogleAds(app, db, h) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS google_ads_cargas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, archivo TEXT NOT NULL DEFAULT '', rango_texto TEXT NOT NULL DEFAULT '', desde TEXT, hasta TEXT,
      renglones INTEGER NOT NULL DEFAULT 0, nuevas INTEGER NOT NULL DEFAULT 0, repetidas INTEGER NOT NULL DEFAULT 0, con_error INTEGER NOT NULL DEFAULT 0,
      cargado_por INTEGER REFERENCES usuarios(id), created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS google_ads_llamadas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, huella TEXT NOT NULL UNIQUE, carga_id INTEGER REFERENCES google_ads_cargas(id),
      fecha TEXT NOT NULL, hora INTEGER NOT NULL CHECK(hora BETWEEN 0 AND 23), duracion_seg INTEGER NOT NULL CHECK(duracion_seg >= 0),
      pais TEXT NOT NULL DEFAULT '', telefono TEXT NOT NULL DEFAULT '', telefono_10 TEXT NOT NULL DEFAULT '', lada TEXT NOT NULL,
      estado TEXT NOT NULL, fuente TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', campana TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_gads_fecha ON google_ads_llamadas(fecha);
    CREATE INDEX IF NOT EXISTS idx_gads_tel ON google_ads_llamadas(telefono_10);
  `);
  const P = () => app.locals.permisos;
  const puede = req => P().direccion(req) || P().puede(req, 'marketing.dinero');
  const sinPermiso = res => res.status(403).json({ error: 'Las llamadas de Google Ads las ven y las cargan Dirección y el Gerente de marketing' });
  const csvDe = (req, res) => {
    const csv = req.body?.csv;
    if (typeof csv !== 'string' || !csv.trim()) { res.status(400).json({ error: 'Elige el archivo CSV «Detalles de las llamadas» de Google Ads' }); return null; }
    return csv;
  };
  const yaEstan = huellas => {
    const hay = new Set();
    for (let i = 0; i < huellas.length; i += 500) {
      const lote = huellas.slice(i, i + 500);
      for (const r of db.prepare(`SELECT huella FROM main.google_ads_llamadas WHERE huella IN (${lote.map(() => '?').join(',')})`).all(...lote)) hay.add(r.huella);
    }
    return hay;
  };
  function planear(csv) {
    const r = leerReporte(csv); if (r.error) return r;
    const hay = yaEstan(r.llamadas.map(l => l.huella)), nuevas = r.llamadas.filter(l => !hay.has(l.huella));
    const cuenta = (lista, f) => lista.filter(f).length;
    return { ...r, nuevas, resumen: { renglones: r.llamadas.length + r.errores.length, validas: r.llamadas.length, nuevas: nuevas.length, repetidas: r.llamadas.length - nuevas.length, con_error: r.errores.length,
      recibidas: cuenta(r.llamadas, l => llano(l.estado) === 'recibida'), perdidas: cuenta(r.llamadas, l => llano(l.estado) === 'perdida'),
      sin_numero: cuenta(r.llamadas, l => l.lada === 'sin_numero'), cdmx: cuenta(r.llamadas, l => l.lada === 'cdmx'), con_numero: cuenta(r.llamadas, l => l.lada !== 'sin_numero'),
      desde: r.llamadas.reduce((a, l) => (!a || l.fecha < a ? l.fecha : a), null), hasta: r.llamadas.reduce((a, l) => (!a || l.fecha > a ? l.fecha : a), null) } };
  }
  const sinHuella = l => { const { huella, fila, ...x } = l; return { fila, ...x }; };

  app.post('/api/marketing/google-ads/vista-previa', h((req, res) => {
    if (!puede(req)) return sinPermiso(res);
    const csv = csvDe(req, res); if (csv === null) return;
    const p = planear(csv); if (p.error) return res.status(400).json({ error: p.error });
    res.json({ rango: p.rango, resumen: p.resumen, errores: p.errores.slice(0, 200), muestra: p.llamadas.slice(0, 15).map(sinHuella) });
  }));
  app.post('/api/marketing/google-ads/cargar', h((req, res) => {
    if (!puede(req)) return sinPermiso(res);
    const csv = csvDe(req, res); if (csv === null) return;
    const p = planear(csv); if (p.error) return res.status(400).json({ error: p.error });
    const archivo = typeof req.body.archivo === 'string' ? req.body.archivo.trim().slice(0, 160) : '';
    let cargaId = null;
    db.transaction(() => {
      cargaId = Number(db.prepare('INSERT INTO main.google_ads_cargas (archivo, rango_texto, desde, hasta, renglones, nuevas, repetidas, con_error, cargado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(archivo, p.rango?.texto || '', p.rango?.desde || p.resumen.desde, p.rango?.hasta || p.resumen.hasta, p.resumen.renglones, p.resumen.nuevas, p.resumen.repetidas, p.resumen.con_error, req.usuarioSesion.id).lastInsertRowid);
      const ins = db.prepare('INSERT OR IGNORE INTO main.google_ads_llamadas (huella, carga_id, fecha, hora, duracion_seg, pais, telefono, telefono_10, lada, estado, fuente, tipo, campana) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const l of p.nuevas) ins.run(l.huella, cargaId, l.fecha, l.hora, l.duracion_seg, l.pais, l.telefono, l.telefono_10, l.lada, l.estado, l.fuente, l.tipo, l.campana);
    })();
    app.locals.auditoria?.registrar(req, 'google_ads', cargaId, 'alta', `Cargó el reporte de llamadas de Google Ads: ${p.resumen.nuevas} nuevas, ${p.resumen.repetidas} ya estaban, ${p.resumen.con_error} con error`);
    res.json({ carga_id: cargaId, resumen: p.resumen, errores: p.errores.slice(0, 200), desde: p.rango?.desde || p.resumen.desde, hasta: p.rango?.hasta || p.resumen.hasta });
  }));

  // ---------- Cruce con el CRM (se calcula cada vez; se cuenta en toda la empresa, como los demás resultados de Marketing) ----------
  function cruzar(llamadas) {
    const sucursales = Object.fromEntries(db.prepare('SELECT id, nombre FROM main.sucursales').all().map(s => [s.id, s.nombre]));
    const qCli = db.prepare(`SELECT id, sucursal_id, date(created_at) alta FROM main.clientes WHERE telefono_normalizado = ?
      UNION SELECT c.id, c.sucursal_id, date(c.created_at) FROM main.telefonos_cliente t JOIN main.clientes c ON c.id = t.cliente_id WHERE t.telefono_normalizado = ?
      UNION SELECT c.id, c.sucursal_id, date(c.created_at) FROM main.leads l JOIN main.clientes c ON c.id = l.cliente_id WHERE l.telefono_normalizado = ?`);
    const qLeads = db.prepare(`SELECT id, date(created_at) alta, estatus, ROUND(COALESCE(valor, 0) * 100) cent FROM main.leads WHERE cliente_id = ? OR (cliente_id IS NULL AND telefono_normalizado = ?) ORDER BY created_at, id`);
    const porNumero = {};
    const datos = tel => (porNumero[tel] ||= (() => {
      const clientes = qCli.all(tel, tel, tel);
      // Si el número está en dos contactos (no debería), cuenta el más antiguo como «el contacto».
      clientes.sort((a, b) => (a.alta < b.alta ? -1 : a.alta > b.alta ? 1 : a.id - b.id));
      const c = clientes[0] || null;
      const leads = []; const vistos = new Set();
      for (const cl of clientes.length ? clientes : [{ id: -1 }]) for (const l of qLeads.all(cl.id, tel)) if (!vistos.has(l.id)) { vistos.add(l.id); leads.push(l); }
      return { cliente: c, leads, usados: new Set() };
    })());
    // En orden de la llamada: cada cotización cuenta solo para la primera llamada de su número que la alcanza.
    const orden = [...llamadas].sort((a, b) => (a.fecha + String(a.hora).padStart(2, '0')).localeCompare(b.fecha + String(b.hora).padStart(2, '0')) || a.id - b.id);
    for (const l of orden) {
      l.cruce = 'sin_numero'; l.sucursal = null; l.ganada = false; l.importe_cent = 0; l.cotizaciones = 0;
      if (!l.telefono_10) continue;
      const d = datos(l.telefono_10), limite = sumarDias(l.fecha, VENTANA_DIAS);
      const enVentana = d.leads.filter(x => x.alta >= l.fecha && x.alta <= limite);
      const clienteNuevo = d.cliente && d.cliente.alta >= l.fecha && d.cliente.alta <= limite;
      if (clienteNuevo || enVentana.length) {
        l.cruce = 'registrada';
        const propias = enVentana.filter(x => !d.usados.has(x.id)); propias.forEach(x => d.usados.add(x.id));
        l.cotizaciones = propias.length;
        const ganadas = propias.filter(x => x.estatus === 'ganado');
        l.ganada = ganadas.length > 0; l.importe_cent = ganadas.reduce((a, x) => a + x.cent, 0);
      } else if (d.cliente && d.cliente.alta < l.fecha) l.cruce = 'ya_existia';
      else l.cruce = 'sin_registrar';
      if (l.cruce !== 'sin_registrar' && d.cliente) l.sucursal = d.cliente.sucursal_id ? (sucursales[d.cliente.sucursal_id] || 'Sucursal ' + d.cliente.sucursal_id) : null;
    }
    return llamadas;
  }

  app.get('/api/marketing/google-ads', h((req, res) => {
    if (!puede(req)) return sinPermiso(res);
    const cargas = db.prepare('SELECT g.id, g.archivo, g.rango_texto, g.desde, g.hasta, g.renglones, g.nuevas, g.repetidas, g.con_error, g.created_at, u.nombre cargado_por FROM main.google_ads_cargas g LEFT JOIN usuarios u ON u.id = g.cargado_por ORDER BY g.id DESC LIMIT 30').all();
    const ext = db.prepare('SELECT MIN(fecha) desde, MAX(fecha) hasta, COUNT(*) n FROM main.google_ads_llamadas').get();
    let { desde, hasta } = req.query;
    if (desde !== undefined || hasta !== undefined) {
      if (!fechaValida(String(desde)) || !fechaValida(String(hasta)) || desde > hasta) return res.status(400).json({ error: 'Revisa el rango de fechas' });
    } else { desde = cargas[0]?.desde || ext.desde; hasta = cargas[0]?.hasta || ext.hasta; }
    const campana = typeof req.query.campana === 'string' ? req.query.campana.slice(0, 160) : '';
    const base = { desde: desde || null, hasta: hasta || null, campana, ventana_dias: VENTANA_DIAS, cruces: CRUCES, ladas: LADAS, cargas, hay_llamadas: ext.n > 0, extremos: { desde: ext.desde, hasta: ext.hasta } };
    if (!desde) return res.json({ ...base, total: 0, campanas: [], lista_campanas: [] });
    const todas = db.prepare('SELECT id, fecha, hora, duracion_seg, pais, telefono, telefono_10, lada, estado, fuente, tipo, campana FROM main.google_ads_llamadas WHERE fecha BETWEEN ? AND ? ORDER BY fecha, hora, id').all(desde, hasta);
    const listaCampanas = [...new Set(todas.map(l => l.campana))].sort();
    const llamadas = cruzar(campana ? todas.filter(l => l.campana === campana) : todas);
    const vacio = () => ({ llamadas: 0, recibidas: 0, perdidas: 0, otras: 0, sin_numero: 0, cdmx: 0, registradas: 0, ya_existian: 0, sin_registrar: 0, ganadas: 0, importe_cent: 0, duracion_seg: 0 });
    const sumar = (t, l) => {
      const e = llano(l.estado); t.llamadas++; t[e === 'recibida' ? 'recibidas' : e === 'perdida' ? 'perdidas' : 'otras']++; t.duracion_seg += l.duracion_seg;
      if (l.lada === 'sin_numero') t.sin_numero++; if (l.lada === 'cdmx') t.cdmx++;
      if (l.cruce === 'registrada') t.registradas++; if (l.cruce === 'ya_existia') t.ya_existian++; if (l.cruce === 'sin_registrar') t.sin_registrar++;
      if (l.ganada) t.ganadas++; t.importe_cent += l.importe_cent; return t;
    };
    const agrupar = clave => { const g = {}; for (const l of llamadas) sumar(g[clave(l)] ||= vacio(), l); return g; };
    const aLista = (g, nombre = 'nombre') => Object.entries(g).map(([k, t]) => ({ [nombre]: k, ...t, importe: t.importe_cent / 100 }));
    const total = llamadas.reduce(sumar, vacio());
    const campanas = aLista(agrupar(l => l.campana), 'campana').sort((a, b) => b.llamadas - a.llamadas);
    const ladas = Object.keys(LADAS).map(k => ({ clave: k, nombre: LADAS[k], ...(agrupar(l => l.lada)[k] || vacio()) })).filter(x => x.llamadas);
    // Las otras ladas, por sus 3 primeros dígitos (la de Querétaro con su nombre), para ver de dónde llaman.
    const otras = Object.entries(agrupar(l => (l.lada === 'otra' ? l.telefono_10.slice(0, 3) : ''))).filter(([k]) => k).map(([k, t]) => ({ lada: k, nombre: LADA_NOMBRE[k] || '', llamadas: t.llamadas, registradas: t.registradas }))
      .sort((a, b) => b.llamadas - a.llamadas).slice(0, 12);
    const horas = agrupar(l => String(l.hora)), horario = Array.from({ length: 24 }, (_, i) => ({ hora: i, ...(horas[i] || vacio()) })).filter(x => x.llamadas);
    const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const porDia = agrupar(l => String(new Date(l.fecha + 'T12:00:00Z').getUTCDay())), dias = [1, 2, 3, 4, 5, 6, 0].map(d => ({ dia: DIAS[d], ...(porDia[d] || vacio()) })).filter(x => x.llamadas);
    const estados = aLista(agrupar(l => l.estado), 'estado').sort((a, b) => b.llamadas - a.llamadas);
    const cruces = Object.keys(CRUCES).map(k => ({ clave: k, nombre: CRUCES[k], ...(agrupar(l => l.cruce)[k] || vacio()) }));
    const sucs = aLista(agrupar(l => (['registrada', 'ya_existia'].includes(l.cruce) ? l.sucursal || 'Sin sucursal en el contacto' : 'Sin sucursal (no registradas)')), 'sucursal')
      .sort((a, b) => (a.sucursal.startsWith('Sin sucursal (') ? 1 : 0) - (b.sucursal.startsWith('Sin sucursal (') ? 1 : 0) || b.llamadas - a.llamadas);
    const noReg = llamadas.filter(l => l.cruce === 'sin_registrar' || l.cruce === 'sin_numero');
    const sinRegistrar = llamadas.filter(l => l.cruce === 'sin_registrar');
    const aviso = { sin_sucursal: noReg.length, cdmx: noReg.filter(l => l.lada === 'cdmx').length, con_numero: sinRegistrar.length, numeros_distintos: new Set(sinRegistrar.map(l => l.telefono_10)).size };
    // Cada número sin registrar una vez (con cuántas veces llamó), del más reciente al más antiguo.
    const porTel = {};
    for (const l of sinRegistrar) { const x = porTel[l.telefono_10] ||= { telefono: l.telefono, telefono_10: l.telefono_10, lada: l.lada, veces: 0, recibidas: 0, ultima: null, campanas: new Set(), duracion_seg: 0 };
      x.veces++; if (llano(l.estado) === 'recibida') x.recibidas++; x.duracion_seg += l.duracion_seg; x.campanas.add(l.campana);
      const cuando = l.fecha + ' ' + String(l.hora).padStart(2, '0') + ':00'; if (!x.ultima || cuando > x.ultima) { x.ultima = cuando; x.ultimo_estado = l.estado; } }
    const lista = Object.values(porTel).map(x => ({ ...x, campanas: [...x.campanas] })).sort((a, b) => b.ultima.localeCompare(a.ultima));
    res.json({ ...base, lista_campanas: listaCampanas, total: { ...total, importe: total.importe_cent / 100 }, cruces, campanas, ladas, otras_ladas: otras, horario, dias, estados, sucursales: sucs, aviso, sin_registrar: lista });
  }));
};
module.exports.leerReporte = leerReporte;
module.exports.leerHora = leerHora;
module.exports.leerRango = leerRango;
