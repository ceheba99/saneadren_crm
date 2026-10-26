const Database = require('./sqlite'); // node:sqlite (integrado en Node; no necesita compilar)
const path = require('path');

// DB_PATH permite guardar la base en un disco persistente (p. ej. /var/data/saneadren.db en Render);
// sin él se usa saneadren.db junto al proyecto.
const db = new Database(process.env.DB_PATH || path.join(__dirname, '..', 'saneadren.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = FULL');
// Lo que se borra o se reemplaza se sobreescribe con ceros en el archivo (no quedan restos de datos sensibles).
db.pragma('secure_delete = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  password TEXT NOT NULL DEFAULT '1234',
  rol TEXT NOT NULL CHECK(rol <> '') /* roles de fábrica: 'admin','ventas','atencion','tecnico','costos','gerente'; los demás viven en la tabla roles */,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS catalogo_servicios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  activo INTEGER NOT NULL DEFAULT 1,
  orden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS canales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  responsable_default_id INTEGER REFERENCES usuarios(id),
  orden INTEGER NOT NULL DEFAULT 0
);

-- El cliente es la persona/empresa (permanece). El teléfono identifica al cliente, no a la cotización individual.
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telefono TEXT NOT NULL,
  telefono_normalizado TEXT NOT NULL UNIQUE,
  nombre TEXT,
  empresa_contacto TEXT,
  direccion TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_clientes_tel ON clientes(telefono_normalizado);

-- Cada cotización (lead) es un ciclo de pipeline propio; un cliente puede tener varias a lo largo del tiempo.
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER REFERENCES clientes(id),
  telefono TEXT NOT NULL,
  telefono_normalizado TEXT NOT NULL,
  nombre TEXT,
  empresa_contacto TEXT,
  direccion TEXT,
  canal_id INTEGER REFERENCES canales(id),
  servicio_id INTEGER REFERENCES catalogo_servicios(id),
  responsable_id INTEGER REFERENCES usuarios(id),
  etapa INTEGER NOT NULL DEFAULT 1 CHECK(etapa BETWEEN 1 AND 4),
  estatus TEXT NOT NULL DEFAULT 'abierto' CHECK(estatus IN ('abierto','ganado','perdido')),
  valor REAL,
  fecha_servicio TEXT,
  notas_iniciales TEXT,
  creado_por TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_leads_tel ON leads(telefono_normalizado);
CREATE INDEX IF NOT EXISTS idx_leads_etapa ON leads(etapa);
CREATE INDEX IF NOT EXISTS idx_leads_responsable ON leads(responsable_id);
CREATE INDEX IF NOT EXISTS idx_leads_cliente ON leads(cliente_id);

CREATE TABLE IF NOT EXISTS historial (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK(tipo IN ('observacion','alerta')),
  texto TEXT NOT NULL,
  fecha_alerta TEXT,
  resuelta INTEGER DEFAULT 0,
  usuario TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_hist_lead ON historial(lead_id);

-- Historial de cotizaciones u órdenes ELIMINADAS: se copia aquí antes de borrarlas, para que la ficha del
-- cliente conserve todo lo que pasó (y quién la eliminó y por qué).
CREATE TABLE IF NOT EXISTS historial_archivo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL, cliente_id INTEGER, folio TEXT NOT NULL,
  tipo TEXT NOT NULL, texto TEXT NOT NULL, usuario TEXT, created_at TEXT NOT NULL,
  archivado_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_hist_archivo_cliente ON historial_archivo(cliente_id);
CREATE INDEX IF NOT EXISTS idx_hist_alerta ON historial(fecha_alerta, resuelta);
`);

// Migración suave: si la base ya existía sin cliente_id (versión anterior), se agrega y se backfillea.
const columnasLeads = db.prepare("PRAGMA table_info(leads)").all().map(c => c.name);
if (!columnasLeads.includes('cliente_id')) {
  db.exec('ALTER TABLE leads ADD COLUMN cliente_id INTEGER REFERENCES clientes(id)');
}
if (!columnasLeads.includes('valor')) {
  db.exec('ALTER TABLE leads ADD COLUMN valor REAL');
}
if (!columnasLeads.includes('fecha_servicio')) {
  db.exec('ALTER TABLE leads ADD COLUMN fecha_servicio TEXT');
}
// Muchas solicitudes entran con urgencia (el cliente necesita el servicio el mismo día o al
// siguiente); esta bandera permite priorizarlas en el pipeline sin depender de leerlo en notas.
if (!columnasLeads.includes('urgente')) {
  db.exec('ALTER TABLE leads ADD COLUMN urgente INTEGER NOT NULL DEFAULT 0');
}
// Recurrencia por servicio: un CRM de saneamiento vive de las recompras (fosas, trampas de
// grasa, mantenimiento a plantas), no solo de leads nuevos. dias_recurrencia indica cada
// cuántos días conviene volver a ofrecer ESE servicio a un cliente que ya lo tuvo "ganado".
// NULL = servicio de una sola vez (no aplica recompra periódica).
const columnasServicios = db.prepare("PRAGMA table_info(catalogo_servicios)").all().map(c => c.name);
const esColumnaNueva = !columnasServicios.includes('dias_recurrencia');
if (esColumnaNueva) {
  db.exec('ALTER TABLE catalogo_servicios ADD COLUMN dias_recurrencia INTEGER');
}
// Backfill de valores razonables por nombre, tanto en instalaciones nuevas (seed) como
// existentes (columna recién agregada) — el admin puede ajustarlos después desde Usuarios.
const RECURRENCIA_DEFAULT = {
  'Desazolve de drenaje': 180,
  'Limpieza de fosas y cárcamos': 180,
  'Limpieza de trampas de grasa': 60,
  'Mantenimiento a plantas de tratamiento': 30,
  'Servicio industrial (aceitosos)': 60
};
if (esColumnaNueva) {
  const upd = db.prepare('UPDATE catalogo_servicios SET dias_recurrencia = ? WHERE nombre = ? AND dias_recurrencia IS NULL');
  Object.entries(RECURRENCIA_DEFAULT).forEach(([nombre, dias]) => upd.run(dias, nombre));
}

// Migración suave: datos de contacto adicionales para robustecer la ficha del cliente
// (correo, teléfono alterno, giro/tipo de cliente, RFC para facturación y notas generales
// permanentes del contacto, separadas de las notas de cada cotización individual).
const columnasClientes = db.prepare("PRAGMA table_info(clientes)").all().map(c => c.name);
const nuevasColumnasClientes = {
  correo: "TEXT",
  telefono_alterno: "TEXT",
  giro: "TEXT",          // residencial | comercial | industrial
  rfc: "TEXT",
  notas_generales: "TEXT"
};
Object.entries(nuevasColumnasClientes).forEach(([col, tipo]) => {
  if (!columnasClientes.includes(col)) db.exec(`ALTER TABLE clientes ADD COLUMN ${col} ${tipo}`);
});

// Migración suave: si usuarios ya existía sin password (versión anterior), se agrega con valor por defecto.
const columnasUsuarios = db.prepare("PRAGMA table_info(usuarios)").all().map(c => c.name);
if (!columnasUsuarios.includes('password')) {
  db.exec("ALTER TABLE usuarios ADD COLUMN password TEXT NOT NULL DEFAULT '1234'");
}
const backfillCliente = db.transaction(() => {
  const sinCliente = db.prepare('SELECT * FROM leads WHERE cliente_id IS NULL').all();
  const buscar = db.prepare('SELECT id FROM clientes WHERE telefono_normalizado = ?');
  const crear = db.prepare(`INSERT INTO clientes (telefono, telefono_normalizado, nombre, empresa_contacto, direccion)
    VALUES (?, ?, ?, ?, ?)`);
  const asignar = db.prepare('UPDATE main.leads SET cliente_id = ? WHERE id = ?');
  sinCliente.forEach(l => {
    let cliente = buscar.get(l.telefono_normalizado);
    let clienteId;
    if (cliente) {
      clienteId = cliente.id;
    } else {
      const info = crear.run(l.telefono, l.telefono_normalizado, l.nombre, l.empresa_contacto, l.direccion);
      clienteId = info.lastInsertRowid;
    }
    asignar.run(clienteId, l.id);
  });
});
backfillCliente();

// Roles: antes la tabla usuarios fijaba la lista de roles con un CHECK. Ahora los roles viven en la tabla «roles»
// (Dirección puede crear nuevos), así que ese CHECK se cambia por uno que acepta cualquier rol no vacío. SQLite no
// deja cambiar un CHECK: se rehace la tabla usuarios con la misma estructura y los mismos datos (procedimiento oficial
// de SQLite, sin llaves foráneas activas). La definición nueva conserva los nombres de los roles de fábrica en un
// comentario: el código anterior los busca al arrancar y, sin ellos, no arrancaría si hubiera que regresar a él.
{
  const sqlUsuarios = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'usuarios'").get().sql;
  if (/CHECK\s*\(\s*rol\s+IN\s*\(/i.test(sqlUsuarios)) {
    const nuevo = sqlUsuarios.replace(/CHECK\s*\(\s*rol\s+IN\s*\([^)]*\)\s*\)/i, 'CHECK(rol <> \'\') /* roles de fábrica: \'admin\',\'ventas\',\'atencion\',\'tecnico\',\'costos\',\'gerente\'; los demás viven en la tabla roles */')
      .replace(/^CREATE TABLE\s+("?usuarios"?|\[usuarios\])/i, 'CREATE TABLE usuarios_nuevo');
    if (nuevo === sqlUsuarios || !nuevo.includes('usuarios_nuevo') || /CHECK\s*\(\s*rol\s+IN/i.test(nuevo)) throw new Error('No se pudo preparar la tabla de usuarios para los roles');
    const antes = db.prepare('SELECT COUNT(*) n FROM usuarios').get().n;
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec('DROP TABLE IF EXISTS usuarios_nuevo');
        db.exec(nuevo);
        db.exec('INSERT INTO usuarios_nuevo SELECT * FROM usuarios');
        if (db.prepare('SELECT COUNT(*) n FROM usuarios_nuevo').get().n !== antes) throw new Error('La copia de usuarios no cuadra');
        db.exec('DROP TABLE usuarios');
        db.exec('ALTER TABLE usuarios_nuevo RENAME TO usuarios');
      })();
    } finally { db.pragma('foreign_keys = ON'); }
    const rotas = db.pragma('foreign_key_check');
    if (rotas.length) console.error('Aviso: referencias rotas después de rehacer la tabla de usuarios', rotas.slice(0, 5));
  }
}

// Seed data inicial (solo si las tablas están vacías)
const seed = db.transaction(() => {
  if (db.prepare('SELECT COUNT(*) c FROM usuarios').get().c === 0) {
    const ins = db.prepare('INSERT INTO usuarios (nombre, rol) VALUES (?, ?)');
    ins.run('Admin', 'admin');
    ins.run('Ventas 1', 'ventas');
    ins.run('Atención a Clientes', 'atencion');
    ins.run('Técnico de Campo', 'tecnico');
  }
  if (db.prepare('SELECT COUNT(*) c FROM catalogo_servicios').get().c === 0) {
    const ins = db.prepare('INSERT INTO catalogo_servicios (nombre, orden, dias_recurrencia) VALUES (?, ?, ?)');
    const servicios = [
      ['Desazolve de drenaje', 180],
      ['Retiro de agua / bombeo', null],
      ['Limpieza de fosas y cárcamos', 180],
      ['Limpieza de trampas de grasa', 60],
      ['Video inspección de tuberías', null],
      ['Rehabilitación de tuberías (CIPP)', null],
      ['Mantenimiento a plantas de tratamiento', 30],
      ['Servicio industrial (aceitosos)', 60],
      ['Otro', null]
    ];
    servicios.forEach(([s, dias], i) => ins.run(s, i, dias));
  }
  if (db.prepare('SELECT COUNT(*) c FROM canales').get().c === 0) {
    const ins = db.prepare('INSERT INTO canales (nombre, responsable_default_id, orden) VALUES (?, ?, ?)');
    ins.run('Llamada telefónica', 2, 0);
    ins.run('WhatsApp', 3, 1);
    ins.run('Correo electrónico', 3, 2);
    ins.run('Facebook', 3, 3);
    ins.run('Instagram', 3, 4);
    ins.run('Referido / recomendación', 2, 5);
    ins.run('Sitio web', 3, 6);
    ins.run('Otro', 1, 7);
  }
});
seed();

// Migración única: las descripciones posteriores pertenecen al catálogo editable.
if (!db.prepare('PRAGMA table_info(catalogo_servicios)').all().some(c => c.name === 'descripcion')) {
  db.transaction(() => {
    db.exec("ALTER TABLE catalogo_servicios ADD COLUMN descripcion TEXT NOT NULL DEFAULT ''");
    const nombre = 'Desazolve con máquina eléctrica';
    const descripcion = "Destape, sondeo y desazolve de la red general de drenaje interno, así como limpieza y desazolve de trampas de grasa internas y externas.";
    const existente = db.prepare('SELECT id, nombre FROM catalogo_servicios').all().find(s => s.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() === 'desazolve con maquina electrica');
    if (existente) db.prepare('UPDATE catalogo_servicios SET descripcion = ? WHERE id = ?').run(descripcion, existente.id);
    else db.prepare('INSERT INTO catalogo_servicios (nombre, orden, descripcion) VALUES (?, (SELECT COALESCE(MAX(orden),0)+1 FROM catalogo_servicios), ?)').run(nombre, descripcion);
    db.prepare("UPDATE catalogo_servicios SET descripcion = ? WHERE nombre = 'Desazolve'").run(descripcion);
  })();
}


// 10 dígitos. Se aceptan con lada internacional (+52, 52 1) o con 044/045; cualquier otro largo se regresa
// tal cual para que la validación de «10 dígitos» lo rechace (antes se tomaban los últimos 10 de lo que fuera).
function normalizarTelefono(tel) {
  // La extensión no es parte del número: «442 123 4567 ext. 3» → 4421234567.
  const d = String(tel || '').replace(/\s*(ext\.?|extensi[oó]n|x)\s*\d{1,6}\s*$/i, '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('52')) return d.slice(2);
  if (d.length === 13 && (d.startsWith('521') || d.startsWith('044') || d.startsWith('045'))) return d.slice(3);
  return d;
}

if (!db.prepare('PRAGMA table_info(clientes)').all().some(c => c.name === 'canal_origen_id')) {
  db.exec('ALTER TABLE clientes ADD COLUMN canal_origen_id INTEGER REFERENCES canales(id)');
}
db.exec('CREATE TABLE IF NOT EXISTS tipos_cliente (clave TEXT PRIMARY KEY, nombre TEXT NOT NULL COLLATE NOCASE UNIQUE)');
const insertarTipo = db.prepare('INSERT OR IGNORE INTO tipos_cliente (clave,nombre) VALUES (?,?)');
[['residencial','Residencial'],['comercial','Comercial'],['industrial','Industrial']].forEach(t=>insertarTipo.run(...t));
if(!db.prepare('PRAGMA table_info(leads)').all().some(c=>c.name==='partidas_json'))db.exec('ALTER TABLE leads ADD COLUMN partidas_json TEXT');
// Bitácora de actividad: distingue eventos que el propio sistema registra automáticamente
// (cotización creada, cambios de estatus) de las notas/alertas que escribe el equipo.
// No toca el CHECK de "tipo" (evita recrear la tabla); es una columna aditiva simple.
if(!db.prepare('PRAGMA table_info(historial)').all().some(c=>c.name==='origen'))db.exec("ALTER TABLE historial ADD COLUMN origen TEXT NOT NULL DEFAULT 'manual'");
// Encuesta de calidad: se responde cuando el servicio ya se hizo, por eso vive en el lead
// (no en el cliente) — cada servicio contratado tiene su propia calificación. Escala
// 1=Malo .. 4=Excelente (número más alto = mejor, para poder promediarla en reportes).
if(!db.prepare('PRAGMA table_info(leads)').all().some(c=>c.name==='encuesta_calificacion'))db.exec('ALTER TABLE leads ADD COLUMN encuesta_calificacion INTEGER');
if(!db.prepare('PRAGMA table_info(leads)').all().some(c=>c.name==='encuesta_comentario'))db.exec('ALTER TABLE leads ADD COLUMN encuesta_comentario TEXT');
// Fecha de la cotización (documento) es un dato distinto de fecha_servicio (cuándo se
// hace el trabajo, para la orden de servicio) — por eso van en columnas separadas y no
// se reutiliza una sola fecha con dos significados. incluye_vigencia por default en 1
// para no cambiar el comportamiento de las cotizaciones ya existentes.
if(!db.prepare('PRAGMA table_info(leads)').all().some(c=>c.name==='motivo_perdida'))db.exec('ALTER TABLE leads ADD COLUMN motivo_perdida TEXT');
// Total (con IVA, en centavos) que tenía la orden cuando se regresó a cotización; al volver a ganarla se compara.
if(!db.prepare('PRAGMA table_info(leads)').all().some(c=>c.name==='reabierta_total_cent'))db.exec('ALTER TABLE leads ADD COLUMN reabierta_total_cent INTEGER');
if(!db.prepare('PRAGMA table_info(leads)').all().some(c=>c.name==='fecha_cotizacion'))db.exec('ALTER TABLE leads ADD COLUMN fecha_cotizacion TEXT');
if(!db.prepare('PRAGMA table_info(leads)').all().some(c=>c.name==='incluye_vigencia'))db.exec('ALTER TABLE leads ADD COLUMN incluye_vigencia INTEGER NOT NULL DEFAULT 1');
if(!db.prepare('PRAGMA table_info(leads)').all().some(c=>c.name==='vigencia_hasta'))db.exec('ALTER TABLE leads ADD COLUMN vigencia_hasta TEXT');
// Control de concurrencia: sin esto, si dos personas abren la misma cotización a la vez,
// la segunda en guardar borra los cambios de la primera sin ningún aviso. Mismo patrón
// que ya usa establecimientos (prospección) — version por default 1 para no romper leads
// ya existentes; se compara y se incrementa en cada PUT /leads/:id.
if(!db.prepare('PRAGMA table_info(leads)').all().some(c=>c.name==='version'))db.exec('ALTER TABLE leads ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
// Origen del registro: 'cotizacion' = nació como cotización (puede terminar en orden de
// servicio); 'directo' = orden de servicio registrada o duplicada sin pasar por cotización,
// así que NO tiene folio de cotización. duplicado_de apunta a la orden de la que se copió.
if(!db.prepare('PRAGMA table_info(leads)').all().some(c=>c.name==='origen')){
  db.exec("ALTER TABLE leads ADD COLUMN origen TEXT NOT NULL DEFAULT 'cotizacion'");
  db.exec(`UPDATE main.leads SET origen='directo' WHERE id IN (SELECT lead_id FROM historial WHERE origen='sistema' AND texto='Servicio registrado directamente como contratado.')`);
}
if(!db.prepare('PRAGMA table_info(leads)').all().some(c=>c.name==='duplicado_de'))db.exec('ALTER TABLE leads ADD COLUMN duplicado_de INTEGER REFERENCES leads(id) ON DELETE SET NULL');
// Datos propios de la orden de servicio (los mismos del formato en papel): unidad/equipo
// que se envía, operador(es) que lo ejecutan, observaciones del trabajo realizado, proyecto, manifiestos y tiros.
// notas_cotizacion: notas y condiciones que se imprimen en la cotización (además de los servicios).
for(const c of ['equipo','operador','observaciones','proyecto','manifiestos','tiros','notas_cotizacion'])if(!db.prepare('PRAGMA table_info(leads)').all().some(x=>x.name===c))db.exec(`ALTER TABLE leads ADD COLUMN ${c} TEXT`);
// Ejecución del servicio: una orden pasa al Generador cuando se marca como realizada.
// ejecucion: NULL (por concluir) | 'realizado' | 'no_realizado'; realizado_por: 'propio' | 'subcontratado'.
// Bitácora de cada orden por área (permisos.js, «qué ve»): area NULL = de la orden (la ve quien ve la orden),
// 'cxc' = cobros y factura, 'cxp' = gastos y pagos a terceros; usuario_id = quién lo registró (para «lo suyo»).
// Las anotaciones anteriores se clasifican por su texto; las que mezclaban el servicio con sus gastos se separan.
if (!db.prepare('PRAGMA table_info(historial)').all().some(c => c.name === 'area')) {
  db.exec('ALTER TABLE historial ADD COLUMN area TEXT');
  db.exec('ALTER TABLE historial ADD COLUMN usuario_id INTEGER REFERENCES usuarios(id)');
  db.transaction(() => {
    db.exec(`UPDATE historial SET area = 'cxc' WHERE area IS NULL AND (texto LIKE 'Anticipo registrado:%' OR texto LIKE 'Pago registrado:%' OR texto LIKE 'Ajuste registrado:%'
      OR texto LIKE 'Pago de $%' OR texto LIKE 'Facturación:%' OR texto LIKE 'Revisión inicial de cobranza%' OR texto LIKE 'Orden importada desde la plantilla de cobranza%')`);
    db.exec(`UPDATE historial SET area = 'cxp' WHERE area IS NULL AND (texto LIKE 'Costo con terceros registrado:%' OR texto LIKE 'Pago a tercero%'
      OR texto LIKE 'Costo con terceros CANCELADO:%' OR texto LIKE 'Costos con terceros copiados de%')`);
    const ins = db.prepare("INSERT INTO historial (lead_id, tipo, texto, usuario, origen, area, created_at) VALUES (?, 'observacion', ?, ?, 'sistema', ?, ?)");
    for (const h of db.prepare("SELECT * FROM historial WHERE area IS NULL AND texto LIKE 'Servicio realizado el %. Gastos generados cargados%'").all()) {
      const i = h.texto.indexOf(' Gastos generados cargados');
      db.prepare('UPDATE historial SET texto = ? WHERE id = ?').run(h.texto.slice(0, i), h.id);
      ins.run(h.lead_id, h.texto.slice(i + 1), h.usuario, 'cxp', h.created_at);
    }
    for (const h of db.prepare("SELECT * FROM historial WHERE area IS NULL AND texto LIKE 'Servicio marcado como NO realizado.%'").all()) {
      const partes = h.texto.split(/\. (?=El cliente ya pagó|Tiene \d+ gasto)/);
      if (partes.length < 2) continue;
      db.prepare('UPDATE historial SET texto = ? WHERE id = ?').run(partes[0] + '.', h.id);
      for (const p of partes.slice(1)) ins.run(h.lead_id, p.replace(/\.?$/, '.'), h.usuario, p.startsWith('El cliente') ? 'cxc' : 'cxp', h.created_at);
    }
  })();
}
// Técnico asignado: ve la orden y registra sus gastos (lo suyo, ver permisos.js); si se realizó lo marca quien hizo la orden (2026-10-26).
if(!db.prepare('PRAGMA table_info(leads)').all().some(c=>c.name==='tecnico_id')){db.exec('ALTER TABLE leads ADD COLUMN tecnico_id INTEGER REFERENCES usuarios(id)');db.exec('CREATE INDEX IF NOT EXISTS idx_leads_tecnico ON leads(tecnico_id)');}
for(const c of ['ejecucion','realizado_por','fecha_realizado','motivo_no_realizado'])if(!db.prepare('PRAGMA table_info(leads)').all().some(x=>x.name===c))db.exec(`ALTER TABLE leads ADD COLUMN ${c} TEXT`);
// Quién capturó la cotización u orden y el contacto (2026-10-26): con su responsable, son los únicos que los editan
// (además del Gerente y Dirección). Las cotizaciones de antes lo toman del nombre guardado en creado_por.
for(const t of ['leads','clientes'])if(!db.prepare(`PRAGMA table_info(${t})`).all().some(x=>x.name==='capturado_por')){
  db.exec(`ALTER TABLE ${t} ADD COLUMN capturado_por INTEGER REFERENCES usuarios(id)`);
  if(t==='leads')db.exec("UPDATE leads SET capturado_por = (SELECT MIN(u.id) FROM usuarios u WHERE u.nombre = leads.creado_por) WHERE capturado_por IS NULL AND creado_por IS NOT NULL");
}
// Hora acordada del servicio (2026-10-26): opcional y solo interna (calendario); no sale en la orden impresa.
if(!db.prepare('PRAGMA table_info(leads)').all().some(x=>x.name==='hora_servicio'))db.exec('ALTER TABLE leads ADD COLUMN hora_servicio TEXT');
// IVA del documento (public/importes.js). iva_modo: 'mas_iva' (los importes son sin IVA),
// 'incluido' (ya lo traen) o 'sin_iva' (no lleva IVA; tasa 0); iva_tasa en porcentaje entero; iva_cent lo calcula el servidor.
// Los tres en NULL = registro anterior al IVA ("por definir"): valor se interpreta como hoy.
// Con IVA, valor es el subtotal sin IVA y el total es valor + iva_cent. Deben existir antes
// de recrear los triggers de abajo, que los validan.
for(const [c,t] of [['iva_modo','TEXT'],['iva_tasa','INTEGER'],['iva_cent','INTEGER']])if(!db.prepare('PRAGMA table_info(leads)').all().some(x=>x.name===c))db.exec(`ALTER TABLE leads ADD COLUMN ${c} ${t}`);
// Restricciones para escrituras nuevas; no se modifican registros históricos.
db.transaction(()=>{
  db.exec('CREATE INDEX IF NOT EXISTS idx_leads_estado_fecha ON leads(estatus,fecha_servicio)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_clientes_origen_fecha ON clientes(canal_origen_id,created_at)');
  // DROP + CREATE (no "IF NOT EXISTS"): un trigger ya creado en una base existente se
  // queda con el cuerpo de la primera vez que se creó, aunque el código de este archivo
  // cambie después — "IF NOT EXISTS" lo deja huérfano de las reglas nuevas para siempre.
  // Recrearlo en cada arranque asegura que las bases ya existentes reciban las reglas
  // agregadas más tarde (fecha_cotizacion, vigencia_hasta, encuesta_calificacion, etc.).
  for(const operacion of ['INSERT','UPDATE']){
    db.exec(`DROP TRIGGER IF EXISTS validar_lead_${operacion.toLowerCase()}`);
    db.exec(`CREATE TRIGGER validar_lead_${operacion.toLowerCase()} BEFORE ${operacion} ON leads BEGIN
    SELECT CASE WHEN NEW.valor IS NOT NULL AND (typeof(NEW.valor) NOT IN ('integer','real') OR NEW.valor<0 OR NEW.valor>1000000000000) THEN RAISE(ABORT,'Importe inválido') END;
    SELECT CASE WHEN NEW.fecha_servicio IS NOT NULL AND (length(NEW.fecha_servicio)<>10 OR date(NEW.fecha_servicio,'+0 days') IS NULL OR date(NEW.fecha_servicio,'+0 days')<>NEW.fecha_servicio) THEN RAISE(ABORT,'Fecha inválida') END;
    SELECT CASE WHEN NEW.fecha_cotizacion IS NOT NULL AND (length(NEW.fecha_cotizacion)<>10 OR date(NEW.fecha_cotizacion,'+0 days') IS NULL OR date(NEW.fecha_cotizacion,'+0 days')<>NEW.fecha_cotizacion) THEN RAISE(ABORT,'Fecha de cotización inválida') END;
    SELECT CASE WHEN NEW.vigencia_hasta IS NOT NULL AND (length(NEW.vigencia_hasta)<>10 OR date(NEW.vigencia_hasta,'+0 days') IS NULL OR date(NEW.vigencia_hasta,'+0 days')<>NEW.vigencia_hasta) THEN RAISE(ABORT,'Fecha de vigencia inválida') END;
    SELECT CASE WHEN NEW.partidas_json IS NOT NULL AND NOT json_valid(NEW.partidas_json) THEN RAISE(ABORT,'Partidas inválidas') END;
    SELECT CASE WHEN NEW.encuesta_calificacion IS NOT NULL AND NEW.encuesta_calificacion NOT BETWEEN 1 AND 4 THEN RAISE(ABORT,'Calificación inválida') END;
    SELECT CASE WHEN NEW.iva_modo IS NOT NULL AND NEW.iva_modo NOT IN ('mas_iva','incluido','sin_iva') THEN RAISE(ABORT,'Modo de IVA inválido') END;
    SELECT CASE WHEN NEW.iva_tasa IS NOT NULL AND (typeof(NEW.iva_tasa)<>'integer' OR NEW.iva_tasa NOT IN (0,8,16)) THEN RAISE(ABORT,'Tasa de IVA inválida') END;
    SELECT CASE WHEN NEW.iva_cent IS NOT NULL AND (typeof(NEW.iva_cent)<>'integer' OR NEW.iva_cent<0) THEN RAISE(ABORT,'IVA inválido') END;
    SELECT CASE WHEN (NEW.iva_modo IS NULL)<>(NEW.iva_tasa IS NULL) OR (NEW.iva_modo IS NULL)<>(NEW.iva_cent IS NULL) THEN RAISE(ABORT,'Datos de IVA incompletos') END;
  END`);
  }
})();
// Correcciones de datos que se aplican UNA sola vez (quedan registradas para no repetirse).
db.exec('CREATE TABLE IF NOT EXISTS migraciones_hechas (nombre TEXT PRIMARY KEY, fecha TEXT NOT NULL DEFAULT (datetime(\'now\',\'localtime\')))');
function unaVez(nombre, fn) {
  if (db.prepare('SELECT 1 FROM migraciones_hechas WHERE nombre = ?').get(nombre)) return;
  db.transaction(() => { fn(); db.prepare('INSERT INTO migraciones_hechas (nombre) VALUES (?)').run(nombre); })();
}
// Las cotizaciones creadas antes se quedaban en "Recolección de datos": ya tienen propuesta, van a "Cotización enviada".
unaVez('cotizaciones_a_cotizacion_enviada', () => {
  db.prepare("UPDATE main.leads SET etapa = 2 WHERE estatus = 'abierto' AND etapa = 1 AND partidas_json IS NOT NULL").run();
});
module.exports = { db, normalizarTelefono };
