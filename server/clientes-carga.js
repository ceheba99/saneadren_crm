// CARGA DE CLIENTES EN LOTE Y ELIMINAR CLIENTES (2026-11-09, pedido de Dirección): solo Dirección, en Ajustes.
//  · Plantilla de Excel (la arma la pantalla) con una fila por cliente. Primero «revisar» (no guarda nada: dice qué está
//    mal en cada fila, con su número de fila del Excel) y luego «guardar» (vuelve a revisar y guarda TODO o NADA).
//  · Las mismas reglas que dar de alta un contacto a mano: nombre, teléfono de 10 dígitos que parezca real, correo y RFC
//    válidos. Un teléfono que YA es de un cliente no es error: esa fila se OMITE (dice de quién es). Un nombre parecido a
//    otro cliente solo avisa.
//  · Cada carga queda registrada (quién, cuándo, cuántos) y sus clientes llevan carga_id: así se revisa qué entró y se
//    puede deshacer.
//  · Eliminar un cliente: solo si no tiene NADA en el sistema (cotizaciones, órdenes, cobros, facturas, encuestas…);
//    lo que es solo suyo (teléfonos extra, datos fiscales sin facturas, alias) se borra con él. Si ya tiene registros
//    no se elimina: se dice qué tiene (borrarlo perdería el historial y el rastro del dinero). Queda en la bitácora.
const MAX_FILAS = 2000;
const COLUMNAS = ['nombre', 'empresa', 'telefono', 'telefono_alterno', 'correo', 'direccion', 'tipo', 'canal', 'rfc', 'sucursal', 'notas'];
const RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const sinAcentos = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const texto = (v, max = 300) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

module.exports = function clientesCarga(app, db, h, { unicos, normalizarTelefono }) {
  const columnas = t => db.prepare(`PRAGMA table_info(${JSON.stringify(t)})`).all().map(c => c.name);
  db.exec(`CREATE TABLE IF NOT EXISTS cargas_clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    usuario_id INTEGER REFERENCES usuarios(id), usuario TEXT, archivo TEXT, creados INTEGER NOT NULL DEFAULT 0, omitidos INTEGER NOT NULL DEFAULT 0)`);
  if (!columnas('clientes').includes('carga_id')) db.exec('ALTER TABLE clientes ADD COLUMN carga_id INTEGER REFERENCES cargas_clientes(id)');

  const P = app.locals.permisos, suc = app.locals.sucursales;
  const audit = (...a) => app.locals.auditoria?.registrar(...a);
  const soloDireccion = (req, res) => { if (P.direccion(req)) return false; res.status(403).json({ error: 'La carga y la eliminación de clientes son solo para Dirección' }); return true; };

  // ---------- Revisar ----------
  function revisar(filas) {
    const tipos = db.prepare('SELECT clave, nombre FROM main.tipos_cliente').all();
    const canales = db.prepare('SELECT id, nombre FROM main.canales').all();
    const sucursales = db.prepare('SELECT id, nombre, clave FROM main.sucursales WHERE activo = 1 AND archivado_at IS NULL ORDER BY id').all();
    const telVisto = new Map(), salida = [];
    filas.forEach((f, i) => {
      const x = Object.fromEntries(COLUMNAS.map(k => [k, texto(f?.[k], k === 'notas' || k === 'direccion' ? 500 : 200)]));
      const fila = Number.isInteger(f?.fila) ? f.fila : i + 2, errores = [], avisos = [];
      if (!x.nombre) errores.push('Falta el nombre');
      else { const m = unicos.problemaNombreCliente(x.nombre, 'El nombre'); if (m) errores.push(m); }
      if (x.empresa) { const m = unicos.problemaNombreCliente(x.empresa, 'La empresa'); if (m) errores.push(m); }
      const tel = normalizarTelefono(x.telefono);
      if (!x.telefono) errores.push('Falta el teléfono');
      else if (tel.length !== 10) errores.push('El teléfono debe tener 10 dígitos');
      else if (unicos.telefonoFalso(tel)) errores.push(`El teléfono ${tel} no parece real`);
      const alt = x.telefono_alterno ? normalizarTelefono(x.telefono_alterno) : '';
      if (x.telefono_alterno && alt.length !== 10) errores.push('El teléfono alterno debe tener 10 dígitos');
      if (x.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.correo)) errores.push('El correo no es válido');
      const rfc = x.rfc.toUpperCase();
      if (rfc && !RFC.test(rfc)) errores.push('El RFC no es válido (p. ej. ABC010101AB1)');
      let tipo = null;
      if (x.tipo) { tipo = tipos.find(t => sinAcentos(t.nombre) === sinAcentos(x.tipo) || sinAcentos(t.clave) === sinAcentos(x.tipo)); if (!tipo) errores.push(`El tipo de cliente «${x.tipo}» no existe (usa uno de la lista)`); }
      let canal = null;
      if (x.canal) { canal = canales.find(c => sinAcentos(c.nombre) === sinAcentos(x.canal)); if (!canal) errores.push(`El canal «${x.canal}» no existe (usa uno de la lista)`); }
      let sucursal = null;
      if (x.sucursal) { sucursal = sucursales.find(s => sinAcentos(s.clave) === sinAcentos(x.sucursal) || sinAcentos(s.nombre) === sinAcentos(x.sucursal)); if (!sucursal) errores.push(`La sucursal «${x.sucursal}» no existe`); }
      else sucursal = sucursales[0]; // sin sucursal: la principal
      // Duplicados: en el mismo archivo es error; en el sistema, la fila se omite.
      let existe = null;
      if (tel.length === 10) {
        if (telVisto.has(tel)) errores.push(`El teléfono está repetido en la fila ${telVisto.get(tel)}`); else telVisto.set(tel, fila);
        const c = unicos.porTelefono(tel); if (c) existe = { id: c.id, folio: unicos.folioCliente(c.id), nombre: c.empresa_contacto || c.nombre };
      }
      if (alt.length === 10 && alt !== tel && !existe) {
        const c = unicos.porTelefono(alt); if (c) errores.push(`El teléfono alterno ya es de ${unicos.etiqueta(c)}`);
        else if (telVisto.has(alt)) errores.push(`El teléfono alterno está repetido en la fila ${telVisto.get(alt)}`); else telVisto.set(alt, fila);
      }
      if (rfc && RFC.test(rfc) && !existe) { const c = unicos.porRfc(rfc); if (c) errores.push(`El RFC ya es de ${unicos.etiqueta(c)}`); }
      if (!existe && !errores.length && x.nombre) {
        const p = unicos.parecidos({ nombre: x.nombre, empresa: x.empresa }, { limite: 1 })[0];
        if (p) avisos.push(`Se parece a ${unicos.folioCliente(p.id)} ${p.empresa_contacto || p.nombre}: revisa que no sea el mismo`);
      }
      salida.push({ fila, nombre: x.nombre, empresa: x.empresa, telefono: tel || x.telefono, sucursal: sucursal?.clave || null, estado: errores.length ? 'error' : existe ? 'existe' : 'nuevo',
        existe, errores, avisos, _d: { ...x, tel, alt, rfc, giro: tipo?.clave || null, canal_id: canal?.id || null, sucursal_id: sucursal?.id || null } });
    });
    const cuenta = e => salida.filter(f => f.estado === e).length;
    return { filas: salida, nuevos: cuenta('nuevo'), existentes: cuenta('existe'), con_errores: cuenta('error'), hay_errores: salida.some(f => f.estado === 'error') };
  }
  const publico = r => ({ ...r, filas: r.filas.map(({ _d, ...f }) => f) });
  const leerFilas = (req, res) => {
    const filas = req.body?.filas;
    if (!Array.isArray(filas) || !filas.length) { res.status(400).json({ error: 'El archivo no tiene clientes' }); return null; }
    if (filas.length > MAX_FILAS) { res.status(400).json({ error: `Máximo ${MAX_FILAS} clientes por archivo` }); return null; }
    return filas;
  };

  app.post('/api/clientes-carga/revisar', h((req, res) => {
    if (soloDireccion(req, res)) return;
    const filas = leerFilas(req, res); if (!filas) return;
    res.json(publico(revisar(filas)));
  }));
  app.post('/api/clientes-carga/guardar', h((req, res) => {
    if (soloDireccion(req, res)) return;
    const filas = leerFilas(req, res); if (!filas) return;
    const r = revisar(filas);
    if (r.hay_errores) return res.status(400).json({ error: 'Hay filas con errores: no se guardó nada. Corrígelas y vuelve a intentar.', ...publico(r) });
    if (!r.nuevos) return res.status(400).json({ error: 'No hay clientes nuevos: todos los teléfonos ya están en el sistema.', ...publico(r) });
    const archivo = texto(req.body.archivo, 120) || null;
    const ins = db.prepare(`INSERT INTO main.clientes (nombre, telefono, telefono_normalizado, empresa_contacto, direccion, correo, telefono_alterno, giro, rfc, notas_generales, canal_origen_id, carga_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const carga = db.transaction(() => {
      const cid = Number(db.prepare('INSERT INTO main.cargas_clientes (usuario_id, usuario, archivo, creados, omitidos) VALUES (?, ?, ?, ?, ?)')
        .run(req.usuarioSesion.id, req.usuarioSesion.nombre, archivo, r.nuevos, r.existentes).lastInsertRowid);
      for (const f of r.filas.filter(x => x.estado === 'nuevo')) {
        const d = f._d;
        const id = Number(ins.run(d.nombre, d.telefono, d.tel, d.empresa || null, d.direccion || null, d.correo || null, d.alt ? d.telefono_alterno : null, d.giro, d.rfc || null, d.notas || null, d.canal_id, cid).lastInsertRowid);
        suc.asignar('clientes', id, d.sucursal_id);
        if (d.alt && d.alt !== d.tel) unicos.agregarTelefono(id, d.telefono_alterno, 'Alterno');
      }
      return cid;
    })();
    audit(req, 'cliente', null, 'carga en lote', `${r.nuevos} cliente(s) desde la plantilla${archivo ? ' «' + archivo + '»' : ''} · carga #${carga}${r.existentes ? ` · ${r.existentes} omitido(s) porque su teléfono ya existía` : ''}`);
    res.status(201).json({ carga_id: carga, creados: r.nuevos, omitidos: r.existentes });
  }));

  // ---------- Qué tiene un cliente (para saber si se puede eliminar) ----------
  // Lo que es solo del cliente y se borra con él (no es historial).
  const SUYO = ['clientes', 'telefonos_cliente', 'clientes_alias', 'clientes_fiscales', 'cliente_sucursales', 'plantillas_descripcion', 'clientes_distintos', 'cargas_clientes'];
  const NOMBRES = { leads: 'cotizaciones u órdenes', historial_archivo: 'registros eliminados en su historial', establecimientos: 'establecimientos de prospección', facturas: 'facturas', clientes_fusionados: 'clientes que se juntaron con él' };
  const tablas = () => db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(x => x.name);
  function usos(id) {
    const r = [];
    for (const t of tablas()) {
      if (SUYO.includes(t)) continue;
      for (const c of columnas(t).filter(c => c === 'cliente_id')) {
        const n = db.prepare(`SELECT COUNT(*) n FROM main.${JSON.stringify(t)} WHERE ${JSON.stringify(c)} = ?`).get(id).n;
        if (n) r.push({ tabla: t, n });
      }
    }
    // Facturas emitidas con sus datos fiscales.
    const fiscales = db.prepare('SELECT id FROM main.clientes_fiscales WHERE cliente_id = ?').all(id).map(x => x.id);
    if (fiscales.length && columnas('facturas').includes('cliente_fiscal_id')) {
      const n = db.prepare(`SELECT COUNT(*) n FROM main.facturas WHERE cliente_fiscal_id IN (${fiscales.map(() => '?').join(',')})`).get(...fiscales).n;
      if (n) r.push({ tabla: 'facturas', n });
    }
    return r;
  }
  const queTiene = u => u.map(x => `${x.n} ${NOMBRES[x.tabla] || x.tabla}`).join(', ');
  const fila = c => {
    const u = usos(c.id);
    return { id: c.id, folio: unicos.folioCliente(c.id), nombre: c.nombre, empresa: c.empresa_contacto, telefono: c.telefono_normalizado, carga_id: c.carga_id ?? null,
      created_at: c.created_at, eliminable: !u.length, tiene: u.length ? queTiene(u) : null };
  };

  app.get('/api/clientes-carga', h((req, res) => {
    if (soloDireccion(req, res)) return;
    const cargas = db.prepare(`SELECT k.*, (SELECT COUNT(*) FROM main.clientes c WHERE c.carga_id = k.id) quedan FROM main.cargas_clientes k ORDER BY k.id DESC LIMIT 50`).all();
    res.json({ cargas });
  }));
  app.get('/api/clientes-carga/:id', h((req, res) => {
    if (soloDireccion(req, res)) return;
    const k = db.prepare('SELECT * FROM main.cargas_clientes WHERE id = ?').get(Number(req.params.id));
    if (!k) return res.status(404).json({ error: 'Carga no encontrada' });
    res.json({ carga: k, clientes: db.prepare('SELECT * FROM main.clientes WHERE carga_id = ? ORDER BY id').all(k.id).map(fila) });
  }));
  // Buscar cualquier cliente (cargado o capturado a mano) para eliminarlo.
  app.get('/api/clientes-gestion/buscar', h((req, res) => {
    if (soloDireccion(req, res)) return;
    const q = texto(req.query.q, 60);
    if (q.length < 2) return res.json({ clientes: [] });
    const folio = unicos.idDeFolio?.(q), dig = q.replace(/\D/g, ''), like = '%' + q + '%';
    const lista = db.prepare(`SELECT * FROM main.clientes WHERE id = ? OR nombre LIKE ? OR empresa_contacto LIKE ? OR (? <> '' AND telefono_normalizado LIKE ?) ORDER BY id DESC LIMIT 30`)
      .all(folio || -1, like, like, dig.length >= 4 ? dig : '', '%' + dig + '%');
    res.json({ clientes: lista.map(fila) });
  }));

  // ---------- Eliminar ----------
  function eliminarUno(req, c) {
    const u = usos(c.id);
    if (u.length) return { ok: false, error: `${unicos.folioCliente(c.id)} tiene ${queTiene(u)}: no se elimina para no perder su historial` };
    db.transaction(() => {
      for (const t of ['telefonos_cliente', 'clientes_alias', 'clientes_fiscales', 'cliente_sucursales', 'plantillas_descripcion'])
        if (tablas().includes(t)) db.prepare(`DELETE FROM main.${t} WHERE cliente_id = ?`).run(c.id);
      if (tablas().includes('clientes_distintos')) db.prepare('DELETE FROM main.clientes_distintos WHERE a = ? OR b = ?').run(c.id, c.id);
      db.prepare('DELETE FROM main.clientes WHERE id = ?').run(c.id);
    })();
    audit(req, 'cliente', c.id, 'eliminado', `${unicos.folioCliente(c.id)} ${c.empresa_contacto || c.nombre} · tel. ${c.telefono_normalizado}${c.carga_id ? ' · venía de la carga #' + c.carga_id : ''} · no tenía registros`);
    return { ok: true };
  }
  app.post('/api/clientes/:id/eliminar', h((req, res) => {
    if (soloDireccion(req, res)) return;
    const c = db.prepare('SELECT * FROM main.clientes WHERE id = ?').get(Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
    const r = eliminarUno(req, c);
    if (!r.ok) return res.status(409).json({ error: r.error });
    res.json({ ok: true });
  }));
  // Deshacer una carga: elimina los clientes de esa carga que siguen sin registros; los que ya se usaron se quedan.
  app.post('/api/clientes-carga/:id/eliminar', h((req, res) => {
    if (soloDireccion(req, res)) return;
    const k = db.prepare('SELECT * FROM main.cargas_clientes WHERE id = ?').get(Number(req.params.id));
    if (!k) return res.status(404).json({ error: 'Carga no encontrada' });
    let eliminados = 0; const quedan = [];
    for (const c of db.prepare('SELECT * FROM main.clientes WHERE carga_id = ?').all(k.id)) {
      const r = eliminarUno(req, c); if (r.ok) eliminados++; else quedan.push(r.error);
    }
    audit(req, 'cliente', null, 'carga deshecha', `Carga #${k.id}: ${eliminados} eliminado(s)${quedan.length ? ` · ${quedan.length} se quedan porque ya tienen registros` : ''}`);
    res.json({ eliminados, quedan });
  }));
};
module.exports.COLUMNAS = COLUMNAS;
