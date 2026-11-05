// Listas de los servicios (2026-11-05): la descripción de un servicio del catálogo puede llevar partes que cambian,
// escritas entre corchetes en mayúsculas, p. ej. «…DISPOSICION DE [VOLUMEN] DE AGUA RESIDUAL…» o «… KFC [SUCURSAL]».
// Cada parte tiene su lista precargada (4M3, 8M3… / PUERTA LA VICTORIA, JURIQUILLA…). Decidido con Dirección:
//  · Al capturar una partida se elige de la lista; no se escribe a mano. Sin elegir, no se guarda.
//  · Las listas las cargan y cambian solo Dirección (ni el Gerente). Por lo mismo, agregar o quitar una [PARTE]
//    en la descripción de un servicio también es solo de Dirección; los demás cambian el resto del texto.
//  · Quitar = desactivar: nunca se borra, y cada cambio queda en la bitácora.
const MAX_VALOR = 80, MAX_POR_LISTA = 300;
// [VOLUMEN], [SUCURSAL], [TIPO DE TRAMPA]: mayúsculas, números y espacios, hasta 30 caracteres.
const MARCA = /\[([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ0-9 ]{0,29})\]/g;
const marcasDe = texto => [...new Set([...String(texto || '').matchAll(MARCA)].map(m => m[1].trim()))];
const llave = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

module.exports = function listasServicio(app, db, h, { permisos, audit }) {
  db.exec(`CREATE TABLE IF NOT EXISTS servicio_listas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    servicio_id INTEGER NOT NULL REFERENCES catalogo_servicios(id),
    marca TEXT NOT NULL CHECK(length(marca) BETWEEN 1 AND 30),
    valor TEXT NOT NULL CHECK(length(trim(valor)) BETWEEN 1 AND ${MAX_VALOR}),
    activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
    creado_por INTEGER REFERENCES usuarios(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_servicio_listas ON servicio_listas(servicio_id, marca, activo);`);

  const SOLO_DIRECCION = { error: 'Las listas de los servicios las carga y cambia solo Dirección', codigo: 'LISTA_SOLO_DIRECCION' };
  const servicio = id => db.prepare('SELECT id, nombre FROM catalogo_servicios WHERE id = ?').get(Number(id));
  const leer = (servicioId, id) => db.prepare('SELECT * FROM servicio_listas WHERE servicio_id = ? AND id = ?').get(servicioId, Number(id));
  const vista = x => ({ id: x.id, servicio_id: x.servicio_id, marca: x.marca, valor: x.valor, activo: !!x.activo });
  const repetido = (servicioId, marca, valor, menosId = 0) => db.prepare('SELECT valor FROM servicio_listas WHERE servicio_id = ? AND marca = ? AND activo = 1 AND id <> ?')
    .all(servicioId, marca, menosId).some(x => llave(x.valor) === llave(valor));
  const lleno = (servicioId, marca) => db.prepare('SELECT COUNT(*) n FROM servicio_listas WHERE servicio_id = ? AND marca = ? AND activo = 1').get(servicioId, marca).n >= MAX_POR_LISTA;

  // Todas las listas, por servicio y parte: { "3": { "VOLUMEN": [{id, valor, activo}] } }. Las usa quien captura partidas;
  // Dirección pide también las quitadas (?todas=1) para poder reactivarlas.
  app.get('/api/servicios/listas', h((req, res) => {
    const todas = permisos.direccion(req) && req.query.todas === '1';
    const listas = {};
    for (const x of db.prepare(`SELECT * FROM servicio_listas ${todas ? '' : 'WHERE activo = 1'} ORDER BY servicio_id, marca, activo DESC, id`).all())
      ((listas[x.servicio_id] ||= {})[x.marca] ||= []).push({ id: x.id, valor: x.valor, activo: !!x.activo });
    res.json({ puede_editar: permisos.direccion(req), listas });
  }));

  app.post('/api/servicios/:id/listas', h((req, res) => {
    if (!permisos.direccion(req)) return res.status(403).json(SOLO_DIRECCION);
    const s = servicio(req.params.id); if (!s) return res.status(404).json({ error: 'Servicio no encontrado' });
    const { marca, valor } = req.body || {};
    if (typeof marca !== 'string' || marcasDe('[' + marca.trim() + ']').length !== 1) return res.status(400).json({ error: 'La parte que cambia se escribe en mayúsculas, p. ej. VOLUMEN o SUCURSAL' });
    if (typeof valor !== 'string' || !valor.trim()) return res.status(400).json({ error: 'Escribe la opción de la lista' });
    const m = marca.trim(), v = valor.replace(/\s+/g, ' ').trim();
    if (v.length > MAX_VALOR) return res.status(400).json({ error: `Cada opción puede tener hasta ${MAX_VALOR} caracteres` });
    if (/[[\]]/.test(v)) return res.status(400).json({ error: 'La opción no puede llevar corchetes [ ]' });
    if (repetido(s.id, m, v)) return res.status(409).json({ error: `La lista [${m}] ya tiene «${v}»` });
    if (lleno(s.id, m)) return res.status(400).json({ error: `La lista [${m}] ya tiene ${MAX_POR_LISTA} opciones: quita las que ya no se usen` });
    const id = db.prepare('INSERT INTO servicio_listas (servicio_id, marca, valor, creado_por) VALUES (?, ?, ?, ?)').run(s.id, m, v, req.usuarioSesion.id).lastInsertRowid;
    audit.registrar(req, 'catalogo', s.id, 'editado', `Lista [${m}] de «${s.nombre}»: agregada «${v}»`);
    res.status(201).json(vista(leer(s.id, id)));
  }));

  // Quitar (desactivar) o volver a activar; nunca se borra.
  const cambiarActivo = activo => (req, res) => {
    if (!permisos.direccion(req)) return res.status(403).json(SOLO_DIRECCION);
    const s = servicio(req.params.id); if (!s) return res.status(404).json({ error: 'Servicio no encontrado' });
    const x = leer(s.id, req.params.lid); if (!x) return res.status(404).json({ error: 'Opción no encontrada' });
    if (x.activo === activo) return res.status(409).json({ error: activo ? 'Ya está activa' : 'Ya estaba quitada' });
    if (activo && repetido(s.id, x.marca, x.valor, x.id)) return res.status(409).json({ error: `La lista [${x.marca}] ya tiene «${x.valor}»` });
    if (activo && lleno(s.id, x.marca)) return res.status(400).json({ error: `La lista [${x.marca}] ya tiene ${MAX_POR_LISTA} opciones: quita las que ya no se usen` });
    db.prepare("UPDATE servicio_listas SET activo = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(activo, x.id);
    audit.registrar(req, 'catalogo', s.id, 'editado', `Lista [${x.marca}] de «${s.nombre}»: «${x.valor}» ${activo ? 'activada otra vez' : 'quitada'}`);
    res.json(vista(leer(s.id, x.id)));
  };
  app.post('/api/servicios/:id/listas/:lid/desactivar', h(cambiarActivo(0)));
  app.post('/api/servicios/:id/listas/:lid/reactivar', h(cambiarActivo(1)));

  // Cambiar la descripción de un servicio: agregar o quitar una [PARTE] es solo de Dirección (regresa el error o null).
  function revisarDescripcion(req, antes, despues) {
    if (permisos.direccion(req)) return null;
    const a = marcasDe(antes).sort().join('|'), d = marcasDe(despues).sort().join('|');
    return a === d ? null : 'Las partes que cambian [ENTRE CORCHETES] y sus listas las pone solo Dirección; cambia solo el resto del texto';
  }

  // Partidas: la descripción ya no debe traer [PARTES] con lista sin elegir, y lo elegido (item.opciones) debe venir de
  // la lista de ese servicio (una opción ya quitada se acepta si la partida ya la traía: no se pierde al reabrir).
  function revisarPartidas(items) {
    for (const i of items) {
      const s = db.prepare('SELECT id FROM catalogo_servicios WHERE nombre = ?').get(i.servicio);
      const conLista = new Set(db.prepare('SELECT DISTINCT marca FROM servicio_listas WHERE servicio_id = ? AND activo = 1').all(s.id).map(x => x.marca));
      const falta = marcasDe(i.leyenda).find(m => conLista.has(m));
      if (falta) return `Elige ${falta} de la lista en la partida «${i.servicio}»`;
      if (i.opciones === undefined || i.opciones === null) { delete i.opciones; continue; }
      if (typeof i.opciones !== 'object' || Array.isArray(i.opciones)) return 'Opciones inválidas en una partida';
      const pares = Object.entries(i.opciones);
      if (pares.length > 20) return 'Demasiadas opciones en una partida';
      for (const [m, v] of pares) {
        if (typeof v !== 'string' || !db.prepare('SELECT 1 FROM servicio_listas WHERE servicio_id = ? AND marca = ? AND valor = ?').get(s.id, m, v))
          return `«${String(v).slice(0, 80)}» no está en la lista [${String(m).slice(0, 30)}] de «${i.servicio}»`;
      }
      if (!pares.length) delete i.opciones;
    }
    return null;
  }

  return { marcasDe, revisarDescripcion, revisarPartidas };
};
