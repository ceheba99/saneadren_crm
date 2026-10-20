// Un cliente = una razón social, sin duplicados. Antes de crear un cliente se revisa, en este orden:
//   1. Teléfono: si ya es de un cliente (principal o adicional), es ese cliente.
//   2. RFC (cuando se captura): no se puede repetir.
//   3. Nombre o empresa parecidos (acentos, mayúsculas, puntos, «S.A. de C.V.» y errores de dedo):
//      se pregunta «¿es el mismo o es otro?». Lo que se responde «es otro» no se vuelve a preguntar.
// Cada cliente se identifica con su ID fijo CLI-0001 (el id de la base: nunca cambia ni se reutiliza).
// Un administrador puede fusionar duplicados que ya existan: todo pasa al cliente correcto y el ID
// retirado y el nombre mal escrito quedan apuntando a él (para plantillas y búsquedas).

const folioCliente = id => (id ? 'CLI-' + String(id).padStart(4, '0') : '');
// Acepta «CLI-0039», «cli 39», «39» y lo que trae la lista de la plantilla («CLI-0039 · KFC») → 39
const idDeFolio = v => { const m = String(v ?? '').trim().match(/^(?:CLI[\s-]*)?0*(\d{1,9})(?:\s*·.*)?$/i); return m ? Number(m[1]) : null; };
const telNorm = t => { const d = String(t || '').replace(/\s*(ext\.?|extensi[oó]n|x)\s*\d{1,6}\s*$/i, '').replace(/\D/g, ''); return d.length === 12 && d.startsWith('52') ? d.slice(2) : d.length === 13 && /^(521|044|045)/.test(d) ? d.slice(3) : d; };
// Teléfonos de relleno que no son de nadie: 0000000000, 1111111111, 1234567890…
const telefonoFalso = t => /^(\d)\1{9}$/.test(t) || ['1234567890', '0123456789', '9876543210'].includes(t);
// Nombre o empresa capturables: al menos 2 letras y sin < > { } (nada de código ni solo signos o emojis).
function problemaNombreCliente(t, etiqueta = 'El nombre') {
  const s = String(t ?? '').trim();
  if (/[<>{}]/.test(s)) return etiqueta + ' no puede llevar < > { }';
  if ((s.match(/\p{L}/gu) || []).length < 2) return etiqueta + ' debe tener al menos 2 letras';
  return null;
}
// RFC genéricos del SAT (público en general / extranjeros): los comparten muchos clientes, no identifican a nadie.
const RFC_GENERICOS = new Set(['XAXX010101000', 'XEXX010101000']);
const esTelReal = t => /^\d{10}$/.test(String(t || ''));

// ---------- Comparación de nombres ----------
const SUFIJOS = /\b(?:S\s?A\s?P\s?I|S\s?A\s?B|S\s?A|S\s?C|A\s?C|S\s?(?:DE\s?)?R\s?L|S\s?(?:EN\s?)?C)(?:\s?(?:DE\s?)?C\s?V)?\s*$|\bDE\s?C\s?V\s*$|\bC\s?V\s*$/;
const VACIAS = new Set(['Y', 'E', 'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'THE', 'AND', 'OF', 'CIA', 'GRUPO', 'SA', 'CV']);
// Nombres de pila muy comunes: un nombre suelto («Juan») no se compara contra «Juan Pérez», «Juan López»…
const NOMBRES_PILA = new Set(('JUAN JOSE LUIS CARLOS JORGE MIGUEL JESUS ANTONIO FRANCISCO ALEJANDRO MANUEL PEDRO RICARDO FERNANDO JAVIER ROBERTO DANIEL ' +
  'EDUARDO RAFAEL SERGIO MARIO ARTURO DAVID OSCAR CESAR HECTOR RAUL ENRIQUE VICTOR ALBERTO GERARDO ALFREDO ANDRES DIEGO ADRIAN GABRIEL IVAN ' +
  'EMILIO ERNESTO GUILLERMO HUGO ISAAC JAIME JULIO MARCO MARTIN NOE OMAR PABLO RAMON RUBEN SALVADOR SANTIAGO TOMAS ULISES ARMANDO ABRAHAM ' +
  'MARIA GUADALUPE ANA LAURA PATRICIA ROSA ELIZABETH VERONICA ALEJANDRA LETICIA GABRIELA DANIELA ADRIANA CLAUDIA MARTHA SILVIA ' +
  'SANDRA MONICA KARLA DIANA JESSICA ANDREA FERNANDA PAOLA LUCIA SOFIA VALERIA MARIANA ISABEL TERESA CARMEN JULIA LORENA EVELYN ' +
  'HELENA ELENA BEATRIZ ROCIO YOLANDA NANCY ERIKA BRENDA CRISTINA CAROLINA NORMA ALICIA IRMA GLORIA ESTHER RAQUEL SUSANA LILIANA').split(' '));

function clave(t) {
  let s = String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/&/g, ' Y ').replace(/[^A-Z0-9Ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) { const sin = s.replace(SUFIJOS, '').trim(); if (sin === s || !sin) break; s = sin; }
  // Iniciales sueltas se juntan: «K.F.C.» → «K F C» → «KFC».
  const out = [];
  let enIniciales = false;
  for (const p of s.split(' ')) {
    if (p.length === 1 && enIniciales) out[out.length - 1] += p;
    else out.push(p);
    enIniciales = p.length === 1 || (enIniciales && p.length === 1);
  }
  return out.join(' ');
}
const compacta = c => c.replace(/ /g, '');
// Firma: el nombre sin espacios ni palabras de relleno («KFC DE MEXICO» y «KFC MEXICO» → «KFCMEXICO»).
const firma = c => palabrasUtiles(c).join('');
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// Tolerancia a errores de dedo según el largo: nada en siglas cortas (KFC ≠ TKL).
const tolerancia = n => (n >= 12 ? 2 : n >= 5 ? 1 : 0);
function palabrasUtiles(c) { return String(c || '').split(' ').filter(p => p && !VACIAS.has(p)); }
// Palabras que muchas empresas distintas comparten al inicio: no bastan para sospechar que son la misma.
const GENERICAS = new Set(('SERVICIO SERVICIOS CONSTRUCTORA CONSTRUCCIONES PROMOTORA INDUSTRIAL INDUSTRIAS COMERCIAL COMERCIALIZADORA INMOBILIARIA ' +
  'TRANSPORTES AUTOTRANSPORTES DISTRIBUIDORA PARQUE PLAZA CONDOMINIO RESTAURANTE RESTAURANTES HOTEL FRACCIONAMIENTO EMPAQUES ORGANISMO ' +
  'MANTENIMIENTO TERMINAL CORPORATIVO ADMINISTRADORA PRODUCTOS LABORATORIOS LABORATORIO FARMACIA COLEGIO ESCUELA HOSPITAL CLINICA AGRICOLA ' +
  'CENTRO TALLER ALIMENTOS INGENIERIA SOLUCIONES INTERNACIONAL NACIONAL MEXICANA MEXICO TECNOLOGIA SISTEMAS PLASTICOS METALICA QUIMICA ' +
  'LOGISTICA DESARROLLOS DESARROLLADORA PROYECTOS EVENTOS GASOLINERA ESTACION TIENDA TIENDAS SUPER AGUA AGUAS').split(' '));
// Una palabra coincide con otra si es igual, si una abrevia a la otra (AUTO / AUTOBUSES) o por un error de dedo.
const palabraCoincide = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) || (Math.min(a.length, b.length) >= 5 && lev(a, b) <= 1);

// ¿Dos nombres (ya en clave) parecen el mismo cliente? Devuelve el motivo o null.
function motivoParecido(a, b) {
  if (!a || !b) return null;
  const ca = compacta(a), cb = compacta(b);
  if (ca.length < 2 || cb.length < 2) return null;
  if (ca === cb || (firma(a) && firma(a) === firma(b))) return 'Mismo nombre';
  const n = Math.min(ca.length, cb.length);
  if (lev(ca, cb) <= tolerancia(n)) return 'Nombre casi igual (posible error de dedo)';
  const pa = palabrasUtiles(a), pb = palabrasUtiles(b);
  const [corto, largo] = pa.length <= pb.length ? [pa, pb] : [pb, pa];
  if (!corto.length) return null;
  // Un solo nombre de pila suelto («Juan») no basta para sospechar.
  if (corto.length === 1 && NOMBRES_PILA.has(corto[0])) return null;
  // Todas las palabras del nombre corto están en el largo: «TKL» / «TKL TERMINAL», «PROMOTORA SAN PEDRO MARTIR» /
  // «PROMOTORA ECOLOGICA SAN PEDRO MARTIR», «TRACTOCAMIONES Y AUTO BAJIO» / «GRUPO TRACTOCAMIONES Y AUTOBUSES DEL BAJIO».
  if (corto.every(p => largo.some(q => palabraCoincide(p, q)))) {
    if (corto.length === 1 && corto[0].length < 3) return null;
    return 'Un nombre contiene al otro';
  }
  // Empiezan con la misma marca: «KFC MEXICO» / «KFC Y CARLS» (no cuenta «Promotora…», «Grupo…» ni «Juan…»).
  if (pa[0] === pb[0] && pa[0].length >= 3 && !GENERICAS.has(pa[0]) && !NOMBRES_PILA.has(pa[0])) return 'Empiezan con el mismo nombre';
  return null;
}

// ¿Dos clientes parecen la misma razón social? El cliente es la empresa: si los dos tienen empresa, solo se
// comparan las empresas («Compras» de KFC y «Compras» de Walmart son clientes distintos). Si alguno no tiene
// empresa (persona, o un cliente importado con la razón social en el nombre), se compara también su nombre.
function motivoClientes(x, y) {
  const N = clave(x.nombre), E = clave(x.empresa), n = clave(y.nombre), e = clave(y.empresa);
  const pruebas = E && e ? [[E, e]] : E ? [[E, n], [N, n]] : e ? [[N, e], [N, n]] : [[N, n]];
  for (const [a, b] of pruebas) { const m = motivoParecido(a, b); if (m) return m; }
  return null;
}

module.exports = function clientesUnicos(app, db, h) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS telefonos_cliente (
      telefono_normalizado TEXT PRIMARY KEY CHECK(length(telefono_normalizado) = 10),
      cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      telefono TEXT NOT NULL,
      etiqueta TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_tel_cliente ON telefonos_cliente(cliente_id);
    CREATE TABLE IF NOT EXISTS clientes_distintos (
      a INTEGER NOT NULL, b INTEGER NOT NULL, confirmado_por INTEGER, fecha TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (a, b), CHECK (a < b)
    );
    CREATE TABLE IF NOT EXISTS clientes_fusionados (
      id_retirado INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL, nombre TEXT, empresa TEXT,
      fusionado_por INTEGER, fecha TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS clientes_alias (
      clave TEXT PRIMARY KEY, cliente_id INTEGER NOT NULL, origen TEXT,
      fecha TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_clientes_rfc ON clientes(rfc);
  `);
  // El teléfono alterno que ya estaba capturado también identifica al cliente (si no es de nadie más).
  db.transaction(() => {
    const ocupado = db.prepare('SELECT 1 FROM clientes WHERE telefono_normalizado = ? UNION SELECT 1 FROM telefonos_cliente WHERE telefono_normalizado = ?');
    const ins = db.prepare('INSERT INTO telefonos_cliente (telefono_normalizado, cliente_id, telefono, etiqueta) VALUES (?, ?, ?, ?)');
    for (const c of db.prepare("SELECT id, telefono_alterno FROM clientes WHERE telefono_alterno IS NOT NULL AND trim(telefono_alterno) <> ''").all()) {
      const t = telNorm(c.telefono_alterno);
      if (esTelReal(t) && !ocupado.get(t, t)) ins.run(t, c.id, c.telefono_alterno, 'Alterno');
    }
  })();

  const esAdmin = req => !!req.usuarioSesion && app.locals.permisos.direccion(req); // duplicados: ven clientes de todas las sucursales
  const par = (x, y) => (x < y ? [x, y] : [y, x]);
  const sonDistintos = db.prepare('SELECT 1 FROM clientes_distintos WHERE a = ? AND b = ?');
  const quienDistintos = db.prepare('SELECT u.nombre, u.rol FROM clientes_distintos d LEFT JOIN usuarios u ON u.id = d.confirmado_por WHERE d.a = ? AND d.b = ?');
  // Un cliente de otra sucursal (que esta no ve): solo se dice que existe y su ID, sin nombre, teléfono ni RFC.
  const ve = c => !app.locals.sucursales || app.locals.sucursales.verCliente(c.id);
  // Con «lo suyo» (permisos.js), el cliente de OTRO vendedor de su sucursal tampoco se ve: solo quién lo atiende.
  let atiende = null; // se prepara al usarse: en_alcance existe hasta que se activan los candados
  const quienAtiende = c => { atiende ||= db.prepare('SELECT u.nombre FROM main.leads l LEFT JOIN usuarios u ON u.id = l.responsable_id WHERE l.cliente_id = ? AND en_alcance(l.sucursal_id) ORDER BY l.id DESC LIMIT 1'); return atiende.get(c.id)?.nombre || null; };
  const resumen = c => { if (!c) return c; if (ve(c)) return { id: c.id, folio: folioCliente(c.id), nombre: c.nombre, empresa: c.empresa_contacto, telefono: esTelReal(c.telefono_normalizado) ? c.telefono : null, rfc: c.rfc || null };
    const quien = quienAtiende(c);
    return quien ? { id: c.id, folio: folioCliente(c.id), nombre: 'Cliente que atiende ' + quien, empresa: null, telefono: null, rfc: null, otro_vendedor: true, atendido_por: quien }
      : { id: c.id, folio: folioCliente(c.id), nombre: 'Cliente de otra sucursal', empresa: null, telefono: null, rfc: null, otra_sucursal: true }; };
  // «CLI-0039 · KFC», «CLI-0039 (lo atiende Laura)» o «CLI-0039 (cliente de otra sucursal)» para los mensajes.
  const etiqueta = c => { if (!c) return ''; if (ve(c)) return folioCliente(c.id) + ' · ' + (c.empresa_contacto || c.nombre); const quien = quienAtiende(c); return folioCliente(c.id) + (quien ? ' (lo atiende ' + quien + ')' : ' (cliente de otra sucursal)'); };

  // ---------- Búsquedas ----------
  function porTelefono(tel) {
    const t = telNorm(tel);
    if (!esTelReal(t)) return null;
    return db.prepare('SELECT * FROM clientes WHERE telefono_normalizado = ?').get(t)
      || db.prepare('SELECT c.* FROM telefonos_cliente x JOIN clientes c ON c.id = x.cliente_id WHERE x.telefono_normalizado = ?').get(t) || null;
  }
  function porRfc(rfc, excluir = 0) {
    const r = String(rfc || '').trim().toUpperCase();
    if (RFC_GENERICOS.has(r)) return null;
    return r ? db.prepare('SELECT * FROM clientes WHERE upper(rfc) = ? AND id <> ? ORDER BY id LIMIT 1').get(r, excluir) || null : null;
  }
  // Por ID (también los retirados por fusión, que apuntan al cliente que quedó).
  function porId(v) {
    const id = idDeFolio(v);
    if (!id) return null;
    const c = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
    if (c) return c;
    const f = db.prepare('SELECT cliente_id FROM clientes_fusionados WHERE id_retirado = ?').get(id);
    return f ? db.prepare('SELECT * FROM clientes WHERE id = ?').get(f.cliente_id) || null : null;
  }
  // Por nombre exacto (sin acentos, mayúsculas, puntos ni «S.A. de C.V.») o por un nombre ya confirmado antes.
  function porNombreExacto(nombre) {
    const k = clave(nombre);
    if (!k) return null;
    const alias = db.prepare('SELECT cliente_id FROM clientes_alias WHERE clave = ?').get(k);
    if (alias) { const c = db.prepare('SELECT * FROM clientes WHERE id = ?').get(alias.cliente_id); if (c) return c; }
    for (const c of db.prepare('SELECT * FROM clientes ORDER BY id').all()) if ([c.nombre, c.empresa_contacto].some(x => x && firma(clave(x)) && firma(clave(x)) === firma(k))) return c;
    return null;
  }
  // Clientes con nombre o empresa parecidos (sin los ya confirmados como distintos de `excluir`).
  function parecidos({ nombre, empresa } = {}, { excluir = [], limite = 5 } = {}) {
    if (!clave(nombre) && !clave(empresa)) return [];
    const fuera = new Set(excluir.map(Number));
    const lista = [];
    for (const c of db.prepare('SELECT * FROM clientes').all()) {
      if (fuera.has(c.id)) continue;
      if (excluir.length && excluir.some(e => { const [x, y] = par(Number(e), c.id); return x !== y && sonDistintos.get(x, y); })) continue;
      const motivo = motivoClientes({ nombre, empresa }, { nombre: c.nombre, empresa: c.empresa_contacto });
      if (motivo) lista.push({ ...resumen(c), motivo, fuerza: motivo === 'Mismo nombre' ? 3 : motivo.startsWith('Nombre casi') ? 2 : 1 });
    }
    return lista.sort((x, y) => y.fuerza - x.fuerza || x.id - y.id).slice(0, limite).map(({ fuerza, ...x }) => x);
  }
  // Revisión completa antes de crear un cliente.
  function verificar({ telefono, nombre, empresa, rfc } = {}) {
    const tel = porTelefono(telefono);
    const deRfc = rfc ? porRfc(rfc) : null;
    return { telefono: resumen(tel), rfc: resumen(deRfc), parecidos: tel || deRfc ? [] : parecidos({ nombre, empresa }) };
  }
  // Para rutas que crean clientes: ¿falta que el usuario confirme algo? Devuelve null o el cuerpo del 409.
  // `distintos` = ids que el usuario ya dijo que NO son el mismo cliente.
  function exigirConfirmacion(datos, distintos = [], excluir = []) {
    const lista = parecidos(datos, { limite: 5, excluir }).filter(p => !distintos.map(Number).includes(p.id));
    return lista.length ? { error: 'posible_duplicado', mensaje: 'Hay clientes parecidos: confirma si es el mismo o es otro.', parecidos: lista } : null;
  }
  // Tras crear un cliente «distinto» a otros, se recuerda para no volver a preguntar.
  function recordarDistintos(nuevoId, distintos = [], usuarioId = null) {
    // Si ya estaba marcada, se actualiza quién lo confirmó (un administrador puede ratificar lo que dijo ventas).
    const ins = db.prepare("INSERT INTO clientes_distintos (a, b, confirmado_por) VALUES (?, ?, ?) ON CONFLICT(a, b) DO UPDATE SET confirmado_por = excluded.confirmado_por, fecha = datetime('now','localtime')");
    for (const d of distintos.map(Number).filter(x => x && x !== nuevoId)) { const [a, b] = par(nuevoId, d); ins.run(a, b, usuarioId); }
  }
  // Agrega un teléfono más a un cliente («es el mismo»). Error si ya es de otro cliente.
  function agregarTelefono(clienteId, telefono, etiqueta = null) {
    const t = telNorm(telefono);
    if (!esTelReal(t)) return { error: 'El teléfono debe tener 10 dígitos' };
    const dueño = porTelefono(t);
    if (dueño && dueño.id !== Number(clienteId)) return { error: `Ese teléfono ya es de ${etiqueta(dueño)}` };
    if (!dueño) db.prepare('INSERT INTO telefonos_cliente (telefono_normalizado, cliente_id, telefono, etiqueta) VALUES (?, ?, ?, ?)').run(t, clienteId, String(telefono).trim(), etiqueta);
    return { ok: true };
  }
  function recordarAlias(nombre, clienteId, origen) {
    const k = clave(nombre);
    if (k) db.prepare('INSERT INTO clientes_alias (clave, cliente_id, origen) VALUES (?, ?, ?) ON CONFLICT(clave) DO UPDATE SET cliente_id = excluded.cliente_id').run(k, clienteId, origen || null);
  }

  // ---------- Fusionar (solo administración) ----------
  function fusionar(retiradoId, quedaId, usuarioId) {
    const r = db.prepare('SELECT * FROM clientes WHERE id = ?').get(retiradoId), q = db.prepare('SELECT * FROM clientes WHERE id = ?').get(quedaId);
    if (!r || !q) return { error: 'Cliente no encontrado' };
    if (r.id === q.id) return { error: 'Elige dos clientes distintos' };
    if (r.rfc && q.rfc && r.rfc.toUpperCase() !== q.rfc.toUpperCase()) return { error: `No se pueden juntar: tienen RFC distinto (${r.rfc} y ${q.rfc}), son razones sociales diferentes` };
    db.transaction(() => {
      db.prepare('UPDATE main.leads SET cliente_id = ? WHERE cliente_id = ?').run(q.id, r.id);
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'establecimientos'").get()) db.prepare('UPDATE main.establecimientos SET cliente_id = ? WHERE cliente_id = ?').run(q.id, r.id);
      // Teléfonos: el principal y los adicionales del retirado pasan como adicionales del que queda.
      db.prepare('UPDATE telefonos_cliente SET cliente_id = ? WHERE cliente_id = ?').run(q.id, r.id);
      // Datos que le falten al que queda se completan con los del retirado (nunca se pisan).
      const completar = ['empresa_contacto', 'direccion', 'correo', 'giro', 'rfc', 'notas_generales', 'canal_origen_id'].filter(k => k in q && (q[k] == null || q[k] === '') && r[k] != null && r[k] !== '');
      if (completar.length) db.prepare(`UPDATE clientes SET ${completar.map(k => k + ' = ?').join(', ')} WHERE id = ?`).run(...completar.map(k => r[k]), q.id);
      db.prepare('DELETE FROM clientes_distintos WHERE a = ? OR b = ?').run(r.id, r.id);
      db.prepare('UPDATE clientes_alias SET cliente_id = ? WHERE cliente_id = ?').run(q.id, r.id);
      db.prepare('UPDATE clientes_fusionados SET cliente_id = ? WHERE cliente_id = ?').run(q.id, r.id);
      db.prepare('INSERT INTO clientes_fusionados (id_retirado, cliente_id, nombre, empresa, fusionado_por) VALUES (?, ?, ?, ?, ?)').run(r.id, q.id, r.nombre, r.empresa_contacto, usuarioId);
      db.prepare('DELETE FROM clientes WHERE id = ?').run(r.id);
      if (esTelReal(r.telefono_normalizado) && !porTelefono(r.telefono_normalizado)) db.prepare('INSERT INTO telefonos_cliente (telefono_normalizado, cliente_id, telefono, etiqueta) VALUES (?, ?, ?, ?)').run(r.telefono_normalizado, q.id, r.telefono, 'De ' + folioCliente(r.id));
      // Los nombres del retirado se recuerdan: si llegan así en una plantilla, se asignan solos al que queda.
      for (const n of [r.nombre, r.empresa_contacto]) if (n && compacta(clave(n)) !== compacta(clave(q.nombre)) && compacta(clave(n)) !== compacta(clave(q.empresa_contacto))) recordarAlias(n, q.id, 'Fusión de ' + folioCliente(r.id));
    })();
    return { ok: true, cliente: resumen(db.prepare('SELECT * FROM clientes WHERE id = ?').get(q.id)) };
  }

  // Pares de posibles duplicados entre los clientes que ya existen (para revisarlos uno por uno).
  function duplicadosExistentes() {
    const todos = db.prepare('SELECT * FROM clientes ORDER BY id').all().map(c => ({ c }));
    const pares = [];
    for (let i = 0; i < todos.length; i++) for (let j = i + 1; j < todos.length; j++) {
      const A = todos[i], B = todos[j];
      // Lo que marcó como «distinto» alguien que no es administrador se sigue mostrando, por si fue un descuido.
      const marca = quienDistintos.get(A.c.id, B.c.id);
      if (marca && marca.rol === 'admin') continue;
      let motivo = null;
      if (A.c.rfc && B.c.rfc && A.c.rfc.toUpperCase() === B.c.rfc.toUpperCase() && !RFC_GENERICOS.has(A.c.rfc.toUpperCase())) motivo = 'Mismo RFC';
      motivo ||= motivoClientes({ nombre: A.c.nombre, empresa: A.c.empresa_contacto }, { nombre: B.c.nombre, empresa: B.c.empresa_contacto });
      if (motivo) pares.push({ motivo, marcado_distinto_por: marca ? marca.nombre || 'otro usuario' : null, a: { ...resumen(A.c), servicios: db.prepare('SELECT COUNT(*) n FROM leads WHERE cliente_id = ?').get(A.c.id).n }, b: { ...resumen(B.c), servicios: db.prepare('SELECT COUNT(*) n FROM leads WHERE cliente_id = ?').get(B.c.id).n } });
    }
    return pares.slice(0, 300);
  }

  // ---------- Rutas ----------
  app.post('/api/clientes/verificar', h((req, res) => res.json(verificar(req.body || {}))));
  // Todos los clientes con su ID (para las listas de las plantillas y los buscadores).
  app.get('/api/clientes/catalogo', h((req, res) => {
    // Solo los de la sucursal: los dio de alta o ha trabajado con ellos.
    res.json(db.prepare('SELECT * FROM clientes c WHERE (cliente_en_alcance(c.sucursal_id, c.id) OR EXISTS (SELECT 1 FROM leads lv WHERE lv.cliente_id = c.id)) ORDER BY lower(COALESCE(empresa_contacto, nombre))').all().map(resumen));
  }));
  app.get('/api/clientes/duplicados', h((req, res) => {
    if (!esAdmin(req)) return res.status(403).json({ error: 'Solo un administrador revisa duplicados' });
    res.json(duplicadosExistentes());
  }));
  app.post('/api/clientes/distintos', h((req, res) => {
    if (!esAdmin(req)) return res.status(403).json({ error: 'Los duplicados los revisa Dirección' });
    const a = Number(req.body?.a), b = Number(req.body?.b);
    if (!a || !b || a === b || !db.prepare('SELECT 1 FROM clientes WHERE id = ?').get(a) || !db.prepare('SELECT 1 FROM clientes WHERE id = ?').get(b)) return res.status(400).json({ error: 'Clientes no válidos' });
    recordarDistintos(a, [b], req.usuarioSesion.id);
    app.locals.auditoria?.registrar(req, 'cliente', a, 'son distintos', `Se confirmó que ${folioCliente(a)} y ${folioCliente(b)} son clientes distintos`);
    res.json({ ok: true });
  }));
  app.post('/api/clientes/:id/fusionar', h((req, res) => {
    if (!esAdmin(req)) return res.status(403).json({ error: 'Solo un administrador puede juntar clientes' });
    const retirado = db.prepare('SELECT * FROM clientes WHERE id = ?').get(Number(req.params.id));
    const r = fusionar(Number(req.params.id), Number(req.body?.con), req.usuarioSesion.id);
    if (r.error) return res.status(400).json(r);
    const bit = app.locals.auditoria;
    if (bit) {
      const nombre = retirado.empresa_contacto || retirado.nombre;
      bit.registrar(req, 'cliente', Number(req.body.con), 'fusión', `Se juntó ${folioCliente(retirado.id)} «${nombre}» (tel. ${retirado.telefono || '—'}) dentro de este cliente: sus registros y teléfonos pasaron aquí`);
      bit.registrar(req, 'cliente', retirado.id, 'retirado', `«${nombre}» se juntó en ${folioCliente(Number(req.body.con))}; su ID queda apuntando a ese cliente`);
    }
    console.log(`[clientes] ${folioCliente(req.params.id)} se juntó en ${folioCliente(req.body.con)} por ${req.usuarioSesion.nombre}`);
    res.json(r);
  }));
  app.get('/api/clientes/:id/telefonos', h((req, res) => {
    res.json(db.prepare('SELECT telefono, telefono_normalizado, etiqueta, created_at FROM telefonos_cliente WHERE cliente_id = ? ORDER BY created_at').all(req.params.id));
  }));
  app.post('/api/clientes/:id/telefonos', h((req, res) => {
    if (!db.prepare('SELECT 1 FROM clientes WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Cliente no encontrado' });
    if (app.locals.sucursales && !app.locals.sucursales.puedeEditarCliente(req, Number(req.params.id))) return res.status(403).json(app.locals.sucursales.NO_EDITA(req, Number(req.params.id)));
    const r = agregarTelefono(Number(req.params.id), req.body?.telefono, String(req.body?.etiqueta || '').trim().slice(0, 60) || null);
    if (r.error) return res.status(409).json(r);
    app.locals.auditoria?.registrar(req, 'cliente', Number(req.params.id), 'teléfono agregado', telNorm(req.body?.telefono));
    res.status(201).json(r);
  }));
  app.delete('/api/clientes/:id/telefonos/:tel', h((req, res) => {
    if (app.locals.sucursales && !app.locals.sucursales.puedeEditarCliente(req, Number(req.params.id))) return res.status(403).json(app.locals.sucursales.NO_EDITA(req, Number(req.params.id)));
    const quitado = db.prepare('DELETE FROM telefonos_cliente WHERE cliente_id = ? AND telefono_normalizado = ?').run(req.params.id, telNorm(req.params.tel));
    if (quitado.changes) app.locals.auditoria?.registrar(req, 'cliente', Number(req.params.id), 'teléfono quitado', telNorm(req.params.tel));
    res.json({ ok: true });
  }));

  return { telefonoFalso, problemaNombreCliente, folioCliente, idDeFolio, clave, motivoParecido, porTelefono, porRfc, porId, porNombreExacto, parecidos, verificar, exigirConfirmacion, recordarDistintos, agregarTelefono, recordarAlias, fusionar, resumen, etiqueta };
};
module.exports.folioCliente = folioCliente;
module.exports.problemaNombreCliente = problemaNombreCliente;
module.exports.telefonoFalso = telefonoFalso;
module.exports.clave = clave;
module.exports.motivoParecido = motivoParecido;
module.exports.motivoClientes = motivoClientes;
module.exports.idDeFolio = idDeFolio;
