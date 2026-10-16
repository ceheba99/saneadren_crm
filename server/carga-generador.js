// Carga masiva del Generador (formato «REPORTE DE VENTAS SANEADREN QUERETARO»: una hoja por mes, un renglón
// por servicio). Cada renglón se vuelve una orden de servicio ya REALIZADA, ligada al cliente correcto.
//
// Nada se crea a ciegas: el CRM junta los clientes, productos y canales que no reconoce y los regresa como
// «por resolver» (con sugerencias). Lo que se decide una vez se recuerda (equivalencias) y la próxima carga
// se asigna solo. Reglas:
//   · Cliente: ID CLIENTE → equivalencia guardada / nombre igual (sin acentos, puntos ni «S.A. de C.V.») →
//     por resolver (sugiere los parecidos, también los del mismo archivo). Un cliente nuevo solo se crea si
//     así se eligió.
//   · Producto → servicio del catálogo (o se agrega al catálogo si así se eligió). Canal → canal de venta.
//   · Montos: SUBTOTAL + IVA = TOTAL; IVA 16 % o sin IVA.
//   · Cargar el mismo archivo dos veces no duplica: cada renglón deja una huella.
//   · Todo o nada: si un renglón tiene error, no se guarda ninguno.
// Los costos con terceros (renta de pipas, tiros, status y vía de pago) no se cargan aquí: van en Cuentas por pagar.
const crypto = require('crypto');
const Importes = require('../public/importes.js');
const { hoyMexico } = require('./fechas');

const MAX_FILAS = 5000;
const quitarAcentos = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const claveTexto = t => quitarAcentos(t).toUpperCase().replace(/[^A-Z0-9Ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const celda = v => (v === undefined || v === null ? '' : String(v).trim());
const fechaOk = f => /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(Date.parse(f + 'T00:00:00Z')) && new Date(f + 'T00:00:00Z').toISOString().slice(0, 10) === f;
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 4) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
}
// Montos: número, «27,510.00», «$31,911.60» o con coma decimal «$31.911,60». Devuelve centavos o null.
function centavos(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  let t = celda(v).replace(/[$\s]/g, '');
  if (!t) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t) || /^-?\d+,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100);
}

module.exports = function cargaGenerador(app, db, h, unicos) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS servicios_alias (clave TEXT PRIMARY KEY, servicio_id INTEGER NOT NULL REFERENCES catalogo_servicios(id) ON DELETE CASCADE, fecha TEXT NOT NULL DEFAULT (datetime('now','localtime')));
    CREATE TABLE IF NOT EXISTS canales_alias (clave TEXT PRIMARY KEY, canal_id INTEGER REFERENCES canales(id) ON DELETE CASCADE, fecha TEXT NOT NULL DEFAULT (datetime('now','localtime')));
  `);
  const cols = db.prepare('PRAGMA table_info(leads)').all().map(c => c.name);
  // No. de orden del generador (referencia en papel; puede repetirse) y huella del renglón importado.
  if (!cols.includes('orden_generador')) db.exec('ALTER TABLE leads ADD COLUMN orden_generador TEXT');
  if (!cols.includes('import_huella')) db.exec('ALTER TABLE leads ADD COLUMN import_huella TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_leads_import_huella ON leads(import_huella)');

  const puede = req => ['admin', 'atencion', 'ventas'].includes(req.usuarioSesion?.rol);

  // ---------- Catálogos y equivalencias ----------
  function catalogos() {
    const servicios = db.prepare('SELECT id, nombre, activo FROM catalogo_servicios').all();
    const canales = db.prepare('SELECT id, nombre FROM canales').all();
    const servPorClave = new Map(servicios.map(s => [claveTexto(s.nombre), s]));
    for (const a of db.prepare('SELECT clave, servicio_id FROM servicios_alias').all()) { const s = servicios.find(x => x.id === a.servicio_id); if (s) servPorClave.set(a.clave, s); }
    const canPorClave = new Map(canales.map(c => [claveTexto(c.nombre), c]));
    const canAlias = new Map(db.prepare('SELECT clave, canal_id FROM canales_alias').all().map(a => [a.clave, a.canal_id]));
    return { servicios, canales, servPorClave, canPorClave, canAlias };
  }
  // Servicios del catálogo con nombre parecido (para sugerir): «RETIRO DEAGUAS RESIDUALES» → «Retiro de aguas residuales».
  function serviciosParecidos(texto, servicios) {
    const k = claveTexto(texto).replace(/ /g, '');
    if (!k) return [];
    return servicios.map(s => ({ s, d: lev(k, claveTexto(s.nombre).replace(/ /g, '')) }))
      .filter(x => x.d <= Math.max(2, Math.floor(k.length * 0.2))).sort((a, b) => a.d - b.d).slice(0, 3).map(x => ({ id: x.s.id, nombre: x.s.nombre }));
  }

  // ---------- Revisión (simulación) e importación ----------
  // equivalencias: { clientes: { CLAVE: id | 'nuevo' | 'como:CLAVE' }, productos: { CLAVE: id | 'nuevo' }, canales: { CLAVE: id | 'nuevo' | 'ninguno' } }
  function revisar(filas, equivalencias = {}) {
    const eqC = equivalencias.clientes || {}, eqP = equivalencias.productos || {}, eqK = equivalencias.canales || {};
    const cat = catalogos();
    const porResolver = { clientes: new Map(), productos: new Map(), canales: new Map() };
    const huellasArchivo = new Map();
    const existeHuella = db.prepare("SELECT id, created_at FROM leads WHERE import_huella = ?");
    const resultado = [];
    // Nombres de producto / canal que no están en el catálogo, con su texto y cuántas veces vienen (para sugerir «igual que»).
    const vistos = { productos: new Map(), canales: new Map() };
    for (const f of filas) for (const [tipo, campo] of [['productos', 'producto'], ['canales', 'canal']]) {
      const t = celda(f[campo]), k = claveTexto(t); if (!k) continue;
      const v = vistos[tipo].get(k) || { clave: k, texto: t, filas: 0 }; v.filas++; vistos[tipo].set(k, v);
    }
    const textoDe = (tipo, k) => vistos[tipo].get(k)?.texto || k;
    // Resuelve un producto o canal: catálogo / equivalencia guardada → elegido (id, «nuevo», «ninguno», «como:CLAVE») → por resolver.
    // Lo que el CRM no reconoce se lista (también lo ya decidido en esta carga, para poder cambiarlo).
    function anotar(tipo, k, texto, decidido, sugerencias, monto = 0) {
      const r = porResolver[tipo].get(k) || { clave: k, texto, filas: 0, total: 0, sugerencias: sugerencias() };
      r.filas++; r.total += monto; r.decidido = decidido; porResolver[tipo].set(k, r);
    }
    function resolverCatalogo(tipo, k, texto, eq, enCatalogo, porId, errores) {
      let e = eq[k], destino = k;
      const sug = () => serviciosParecidos(texto, tipo === 'productos' ? cat.servicios : cat.canales);
      if (e === undefined) {
        const ya = enCatalogo(k);
        if (ya) return { item: ya };
        anotar(tipo, k, texto, false, sug);
        return {};
      }
      anotar(tipo, k, texto, true, sug);
      for (let n = 0; typeof e === 'string' && e.startsWith('como:') && n < 20; n++) { destino = e.slice(5); e = eq[destino] !== undefined ? eq[destino] : (enCatalogo(destino) ? 'catalogo' : ''); }
      if (typeof e === 'string' && e.startsWith('como:')) { errores.push(`«${texto}» y otro nombre apuntan uno al otro: en uno de ellos elige «agregar» o uno del catálogo`); return {}; }
      if (e === 'catalogo') return { item: enCatalogo(destino) };
      if (e === '') { errores.push(`Primero decide qué es «${textoDe(tipo, destino)}» (a ese apunta «${texto}»)`); return {}; }
      if (e === 'nuevo') return { nuevo: textoDe(tipo, destino) };
      if (e === 'ninguno') return { item: 'ninguno' };
      const item = porId(e);
      if (!item) errores.push(`Lo elegido para «${texto}» ya no existe`);
      return { item };
    }

    for (const [i, f] of filas.entries()) {
      const fila = celda(f.fila) || String(i + 2);
      const errores = [];
      const clienteTxt = celda(f.cliente), productoTxt = celda(f.producto);
      const sub = centavos(f.subtotal), iva = centavos(f.iva), tot = centavos(f.total);
      // Renglones sin cliente ni producto (vacíos, o el de totales del mes al final de la hoja): se omiten.
      if (!clienteTxt && !celda(f.id_cliente) && !productoTxt) { resultado.push({ fila, errores: [], omitida: true }); continue; }

      const fecha = celda(f.fecha);
      if (!fecha) errores.push('FECHA vacía');
      else if (!fechaOk(fecha)) errores.push(`FECHA "${fecha.slice(0, 20)}" no es una fecha válida`);
      else if (fecha > hoyMexico()) errores.push('FECHA en el futuro');

      // Montos
      if (sub === null) errores.push('SUBTOTAL vacío');
      else if (Number.isNaN(sub)) errores.push(`SUBTOTAL "${celda(f.subtotal).slice(0, 20)}" no es un número`);
      else if (sub <= 0) errores.push('SUBTOTAL debe ser mayor a $0');
      if (Number.isNaN(iva)) errores.push(`IVA "${celda(f.iva).slice(0, 20)}" no es un número`);
      if (Number.isNaN(tot)) errores.push(`TOTAL "${celda(f.total).slice(0, 20)}" no es un número (¿está escrito como texto?)`);
      let modo = null, imp = null;
      if (sub > 0 && !Number.isNaN(iva) && !Number.isNaN(tot)) {
        const ivaC = iva ?? (tot != null ? tot - sub : null);
        if (ivaC === null || ivaC === 0) modo = 'sin_iva';
        else if (Math.abs(ivaC - Math.round(sub * 0.16)) <= 2) modo = 'mas_iva';
        else errores.push(`IVA ${(ivaC / 100).toFixed(2)} no es el 16 % del subtotal (${(sub * 0.0016).toFixed(2)}) ni 0`);
        if (modo) {
          imp = Importes.calcular([{ importe: sub / 100 }], modo, modo === 'mas_iva' ? 16 : 0);
          if (tot != null && Math.abs(tot - imp.total_cent) > 2) errores.push(`TOTAL ${(tot / 100).toFixed(2)} no cuadra con SUBTOTAL + IVA (${(imp.total_cent / 100).toFixed(2)})`);
        }
      }
      let cantidad = f.cantidad === '' || f.cantidad == null ? 1 : Number(celda(f.cantidad).replace(/,/g, ''));
      if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 1e6) { errores.push('CANTIDAD debe ser mayor a 0'); cantidad = 1; }
      cantidad = Math.round(cantidad * 1000) / 1000;

      // Cliente
      let cliente = null, clienteNuevo = null;
      const kc = unicos.clave(clienteTxt);
      const idTxt = celda(f.id_cliente);
      if (!clienteTxt && !idTxt) errores.push('CLIENTE vacío');
      else if (idTxt && !/^nuevo$/i.test(idTxt)) { cliente = unicos.porId(idTxt); if (!cliente) errores.push(`ID CLIENTE "${idTxt.slice(0, 20)}" no existe`); }
      else if (kc.replace(/ /g, '').length < 2) errores.push(`CLIENTE "${clienteTxt}" es demasiado corto: escribe el nombre completo`);
      else if (unicos.problemaNombreCliente(clienteTxt, 'CLIENTE')) errores.push(unicos.problemaNombreCliente(clienteTxt, 'CLIENTE') + ` («${clienteTxt.slice(0, 30)}»)`);
      else {
        // «Es el mismo que X de este archivo»: se sigue la cadena hasta un cliente que ya existe o uno nuevo.
        let eq = eqC[kc], destino = kc;
        if (eq !== undefined) anotar('clientes', kc, clienteTxt, true, () => unicos.parecidos({ nombre: clienteTxt, empresa: clienteTxt }, { limite: 4 }), imp?.total_cent || 0);
        for (let n = 0; typeof eq === 'string' && eq.startsWith('como:') && n < 20; n++) { destino = eq.slice(5); if (eqC[destino] !== undefined) eq = eqC[destino]; else { const ya = unicos.porNombreExacto(destino); eq = ya ? ya.id : ''; } }
        if (typeof eq === 'string' && eq.startsWith('como:')) errores.push(`«${clienteTxt}» y otro nombre apuntan uno al otro: en uno de ellos elige «Es un cliente nuevo»`);
        else if (eq === '' && destino !== kc) errores.push(`Primero decide quién es «${destino}» (a ese apunta «${clienteTxt}»)`);
        else if (eq === 'nuevo' || /^nuevo$/i.test(idTxt)) clienteNuevo = destino;
        else if (eq != null && eq !== '') { cliente = unicos.porId(eq); if (!cliente) errores.push('El cliente elegido para "' + clienteTxt + '" ya no existe'); }
        else {
          cliente = unicos.porNombreExacto(clienteTxt);
          if (!cliente) anotar('clientes', kc, clienteTxt, false, () => unicos.parecidos({ nombre: clienteTxt, empresa: clienteTxt }, { limite: 4 }), imp?.total_cent || 0);
        }
      }

      // Producto → servicio del catálogo; canal de venta (opcional). Ambos admiten «igual que X de este archivo».
      let servicio = null, servicioNuevo = null;
      const kp = claveTexto(productoTxt);
      if (!productoTxt) errores.push('CONCEPTO vacío');
      else {
        const r = resolverCatalogo('productos', kp, productoTxt, eqP, k => cat.servPorClave.get(k) || null, id => cat.servicios.find(x => x.id === Number(id)) || null, errores);
        servicio = r.item; servicioNuevo = r.nuevo;
      }
      let canal = null, canalNuevo = null;
      const canalTxt = celda(f.canal), kk = claveTexto(canalTxt);
      if (canalTxt) {
        const r = resolverCatalogo('canales', kk, canalTxt, eqK, k => cat.canAlias.has(k) ? (cat.canAlias.get(k) == null ? 'ninguno' : cat.canales.find(c => c.id === cat.canAlias.get(k)) || null) : cat.canPorClave.get(k) || null,
          id => cat.canales.find(x => x.id === Number(id)) || null, errores);
        canal = r.item === 'ninguno' ? null : r.item; canalNuevo = r.nuevo;
      }

      // Huella: el mismo renglón no se carga dos veces (renglones idénticos dentro del archivo cuentan aparte).
      const base = [fecha, claveTexto(f.no_orden), claveTexto(f.factura), kc, kp, cantidad, sub, tot].join('|');
      const vez = (huellasArchivo.get(base) || 0) + 1; huellasArchivo.set(base, vez);
      const huella = crypto.createHash('sha256').update(base + '|' + vez).digest('hex').slice(0, 32);
      const previa = existeHuella.get(huella);
      if (previa) errores.push(`Ya se cargó antes (OS-${String(previa.created_at).slice(0, 7).replace('-', '')}-${String(previa.id).padStart(4, '0')})`);

      resultado.push({ fila, errores, datos: { fecha, cliente, clienteNuevo, clienteTxt, servicio, servicioNuevo, productoTxt, canal, canalNuevo, canalTxt, cantidad, sub, modo, imp, huella,
        no_orden: celda(f.no_orden).slice(0, 40) || null, factura: celda(f.factura).slice(0, 60) || null, proyecto: celda(f.proyecto).slice(0, 200) || null,
        unidad: celda(f.unidad).slice(0, 200) || null, empleado: celda(f.empleado).replace(/\s+/g, ' ').slice(0, 200) || null, manifiestos: celda(f.manifiestos).slice(0, 200) || null } });
    }
    // En «por resolver», a cada cliente se le sugieren también los otros nombres del archivo que se le parecen.
    const pendientes = [...porResolver.clientes.values()];
    for (const r of pendientes) {
      r.del_archivo = pendientes.filter(o => o.clave !== r.clave && !String(eqC[o.clave] ?? '').startsWith('como:') && unicos.motivoParecido(o.clave, r.clave))
        .sort((x, y) => y.filas - x.filas).map(o => ({ clave: o.clave, texto: o.texto, filas: o.filas }));
      r.total = r.total / 100;
    }
    // Productos y canales pendientes: los otros nombres del archivo escritos casi igual (y que no están ya en el catálogo).
    const casiIgual = (a, b) => { const x = a.replace(/ /g, ''), y = b.replace(/ /g, ''); return x !== y && lev(x, y) <= Math.max(2, Math.floor(Math.min(x.length, y.length) * 0.15)); };
    for (const tipo of ['productos', 'canales']) for (const r of porResolver[tipo].values()) {
      r.del_archivo = [...vistos[tipo].values()].filter(o => o.clave !== r.clave && casiIgual(o.clave, r.clave) && porResolver[tipo].has(o.clave) && !String((tipo === 'productos' ? eqP : eqK)[o.clave] ?? '').startsWith('como:'))
        .sort((x, y) => y.filas - x.filas).map(o => ({ clave: o.clave, texto: o.texto, filas: o.filas }));
    }
    const validas = resultado.filter(r => !r.omitida);
    const sinResolver = ['clientes', 'productos', 'canales'].reduce((t, k) => t + [...porResolver[k].values()].filter(r => !r.decidido).length, 0);
    const suma = k => validas.reduce((t, r) => t + (r.datos?.imp?.[k] || 0), 0) / 100;
    return {
      resultado, sinResolver,
      respuesta: {
        total: filas.length, servicios: validas.length, omitidas: resultado.length - validas.length,
        errores: resultado.filter(r => r.errores.length).map(r => ({ fila: r.fila, errores: r.errores })),
        por_resolver: { clientes: pendientes, productos: [...porResolver.productos.values()], canales: [...porResolver.canales.values()] },
        importe: { subtotal: suma('subtotal_cent'), iva: suma('iva_cent'), total: suma('total_cent') },
        clientes_nuevos: [...new Set(validas.map(r => r.datos?.clienteNuevo).filter(Boolean))].length,
        catalogo: { servicios: cat.servicios.filter(s => s.activo).map(s => ({ id: s.id, nombre: s.nombre })), canales: cat.canales.map(c => ({ id: c.id, nombre: c.nombre })) },
      },
    };
  }

  app.post('/api/generador/importar', h((req, res) => {
    if (!puede(req)) return res.status(403).json({ error: 'Tu usuario no puede cargar el generador' });
    const filas = req.body?.filas;
    if (!Array.isArray(filas) || !filas.length) return res.status(400).json({ error: 'El archivo no tiene renglones' });
    if (filas.length > MAX_FILAS) return res.status(400).json({ error: `Máximo ${MAX_FILAS} renglones por carga` });
    const simular = req.query.simular === '1';
    const cobrado = req.body.cobrado === true ? true : req.body.cobrado === false ? false : null;
    const { resultado, sinResolver, respuesta } = revisar(filas, req.body.equivalencias || {});
    const hayErrores = respuesta.errores.length > 0;
    if (simular || hayErrores || sinResolver) return res.json({ ...respuesta, simulacion: simular, importadas: 0 });
    if (cobrado === null) return res.status(400).json({ error: 'Indica si estos servicios ya están cobrados o quedan por cobrar' });

    const usuario = req.usuarioSesion;
    const creados = db.transaction(() => {
      const eqC = req.body.equivalencias?.clientes || {}, eqP = req.body.equivalencias?.productos || {}, eqK = req.body.equivalencias?.canales || {};
      const clientesNuevos = new Map(), serviciosNuevos = new Map(), canalesNuevos = new Map();
      const insCliente = db.prepare('INSERT INTO clientes (telefono, telefono_normalizado, nombre, empresa_contacto) VALUES (?, ?, ?, ?)');
      const insServicio = db.prepare('INSERT INTO catalogo_servicios (nombre, orden) VALUES (?, (SELECT COALESCE(MAX(orden), 0) + 1 FROM catalogo_servicios))');
      const insCanal = db.prepare('INSERT INTO canales (nombre, orden) VALUES (?, 99)');
      const insLead = db.prepare(`INSERT INTO leads (cliente_id, telefono, telefono_normalizado, nombre, empresa_contacto, direccion, canal_id, servicio_id, responsable_id,
          creado_por, valor, fecha_servicio, estatus, etapa, origen, partidas_json, iva_modo, iva_tasa, iva_cent, factura_folio, proyecto, equipo, operador, manifiestos,
          ejecucion, realizado_por, fecha_realizado, orden_generador, import_huella, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'ganado', 4, 'directo', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'realizado', 'propio', ?, ?, ?, ?, datetime('now','localtime'))`);
      const insCobro = db.prepare(`INSERT INTO cobros (lead_id, fecha, monto_cent, tipo, metodo, notas, confirmado, confirmado_por, confirmado_at, registrado_por)
        VALUES (?, ?, ?, 'pago', 'otro', 'Cobrado antes de la carga del generador (histórico)', 1, ?, datetime('now','localtime'), ?)`);
      const bit = db.prepare("INSERT INTO historial (lead_id, tipo, texto, usuario, origen) VALUES (?, 'observacion', ?, ?, 'sistema')");
      const aliasCanal = db.prepare('INSERT INTO canales_alias (clave, canal_id) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET canal_id = excluded.canal_id');
      let n = 0;
      for (const r of resultado) {
        if (r.omitida) continue;
        const d = r.datos;
        // Cliente
        let cli = d.cliente;
        if (!cli && d.clienteNuevo) {
          cli = clientesNuevos.get(d.clienteNuevo);
          if (!cli) {
            const nombre = d.clienteNuevo === unicos.clave(d.clienteTxt) ? d.clienteTxt : (resultado.find(x => x.datos && unicos.clave(x.datos.clienteTxt) === d.clienteNuevo)?.datos.clienteTxt || d.clienteTxt);
            const tel = 'sin-telefono-' + crypto.randomBytes(6).toString('hex');
            const id = insCliente.run('', tel, nombre.trim(), nombre.trim()).lastInsertRowid;
            cli = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
            clientesNuevos.set(d.clienteNuevo, cli);
          }
        }
        // Lo resuelto a mano se recuerda: la próxima carga con ese nombre se asigna sola.
        const kc = unicos.clave(d.clienteTxt);
        if (d.clienteTxt && eqC[kc] != null && eqC[kc] !== 'nuevo') unicos.recordarAlias(d.clienteTxt, cli.id, 'Carga del generador');
        // Servicio
        let serv = d.servicio;
        if (!serv && d.servicioNuevo) {
          const k = claveTexto(d.servicioNuevo);
          serv = serviciosNuevos.get(k) || db.prepare('SELECT * FROM catalogo_servicios WHERE lower(nombre) = lower(?)').get(d.servicioNuevo.trim());
          if (!serv) { const id = insServicio.run(d.servicioNuevo.trim()).lastInsertRowid; serv = db.prepare('SELECT * FROM catalogo_servicios WHERE id = ?').get(id); }
          serviciosNuevos.set(k, serv);
        }
        const kp = claveTexto(d.productoTxt);
        if (eqP[kp] != null && eqP[kp] !== 'nuevo' && kp !== claveTexto(serv.nombre)) db.prepare('INSERT INTO servicios_alias (clave, servicio_id) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET servicio_id = excluded.servicio_id').run(kp, serv.id);
        // Canal
        let canal = d.canal;
        if (!canal && d.canalNuevo) {
          const k = claveTexto(d.canalNuevo);
          canal = canalesNuevos.get(k) || db.prepare('SELECT * FROM canales WHERE lower(nombre) = lower(?)').get(d.canalNuevo.trim());
          if (!canal) { const id = insCanal.run(d.canalNuevo.trim()).lastInsertRowid; canal = db.prepare('SELECT * FROM canales WHERE id = ?').get(id); }
          canalesNuevos.set(k, canal);
        }

        // Canal resuelto a mano (otro canal, «igual que», «sin canal»): se recuerda para la próxima carga.
        const kk = claveTexto(d.canalTxt);
        if (kk && eqK[kk] !== undefined && eqK[kk] !== 'nuevo' && kk !== claveTexto(canal?.nombre)) aliasCanal.run(kk, canal ? canal.id : null);
        const precio = Math.round(d.sub / d.cantidad) / 100;
        const partida = { servicio: serv.nombre, leyenda: d.productoTxt !== serv.nombre ? d.productoTxt : '', importe: d.sub / 100 };
        if (d.cantidad !== 1 && Importes.importeDe(d.cantidad, precio) * 100 === d.sub) Object.assign(partida, { cantidad: d.cantidad, precio });
        // El folio OS-AAAAMM y los reportes por mes salen del mes del servicio. A las 12:00 de ese día, pero nunca
        // en el futuro (un servicio de hoy cargado en la mañana queda con la hora actual).
        const ahora = db.prepare("SELECT datetime('now','localtime') t").get().t;
        const creadoEn = d.fecha + ' 12:00:00' > ahora ? ahora : d.fecha + ' 12:00:00';
        const id = insLead.run(cli.id, cli.telefono, cli.telefono_normalizado, cli.nombre, cli.empresa_contacto, canal?.id ?? null, serv.id, usuario.id, usuario.nombre,
          d.sub / 100, d.fecha, JSON.stringify([partida]), d.modo, d.modo === 'mas_iva' ? 16 : 0, d.imp.iva_cent, d.factura, d.proyecto, d.unidad, d.empleado, d.manifiestos,
          d.fecha, d.no_orden, d.huella, creadoEn).lastInsertRowid;
        if (cobrado) insCobro.run(id, d.fecha, d.imp.total_cent, usuario.id, usuario.id);
        bit.run(id, 'Orden cargada desde el generador' + (d.no_orden ? ` (orden ${d.no_orden})` : '') + (cobrado ? ' · cobrada (histórico)' : ' · por cobrar') + '.', usuario.nombre);
        n++;
      }
      return { n, clientes: clientesNuevos.size, servicios: serviciosNuevos.size, canales: canalesNuevos.size };
    })();
    console.log(`[generador] ${usuario.nombre} cargó ${creados.n} servicios (${creados.clientes} clientes nuevos)`);
    res.status(201).json({ ...respuesta, simulacion: false, importadas: creados.n, creados });
  }));
};
module.exports.centavos = centavos;
