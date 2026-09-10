const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'saneadren.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = FULL');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  password TEXT NOT NULL DEFAULT '1234',
  rol TEXT NOT NULL CHECK(rol IN ('admin','ventas','atencion','tecnico')),
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
  const asignar = db.prepare('UPDATE leads SET cliente_id = ? WHERE id = ?');
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


function normalizarTelefono(tel) {
  return (tel || '').replace(/\D/g, '').slice(-10);
}

if (!db.prepare('PRAGMA table_info(clientes)').all().some(c => c.name === 'canal_origen_id')) {
  db.exec('ALTER TABLE clientes ADD COLUMN canal_origen_id INTEGER REFERENCES canales(id)');
}
db.exec('CREATE TABLE IF NOT EXISTS tipos_cliente (clave TEXT PRIMARY KEY, nombre TEXT NOT NULL COLLATE NOCASE UNIQUE)');
const insertarTipo = db.prepare('INSERT OR IGNORE INTO tipos_cliente (clave,nombre) VALUES (?,?)');
[['residencial','Residencial'],['comercial','Comercial'],['industrial','Industrial']].forEach(t=>insertarTipo.run(...t));
if(!db.prepare('PRAGMA table_info(leads)').all().some(c=>c.name==='partidas_json'))db.exec('ALTER TABLE leads ADD COLUMN partidas_json TEXT');
// Restricciones para escrituras nuevas; no se modifican registros históricos.
db.transaction(()=>{
  db.exec('CREATE INDEX IF NOT EXISTS idx_leads_estado_fecha ON leads(estatus,fecha_servicio)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_clientes_origen_fecha ON clientes(canal_origen_id,created_at)');
  for(const operacion of ['INSERT','UPDATE'])db.exec(`CREATE TRIGGER IF NOT EXISTS validar_lead_${operacion.toLowerCase()} BEFORE ${operacion} ON leads BEGIN
    SELECT CASE WHEN NEW.valor IS NOT NULL AND (typeof(NEW.valor) NOT IN ('integer','real') OR NEW.valor<0 OR NEW.valor>1000000000000) THEN RAISE(ABORT,'Importe inválido') END;
    SELECT CASE WHEN NEW.fecha_servicio IS NOT NULL AND (length(NEW.fecha_servicio)<>10 OR date(NEW.fecha_servicio,'+0 days') IS NULL OR date(NEW.fecha_servicio,'+0 days')<>NEW.fecha_servicio) THEN RAISE(ABORT,'Fecha inválida') END;
    SELECT CASE WHEN NEW.partidas_json IS NOT NULL AND NOT json_valid(NEW.partidas_json) THEN RAISE(ABORT,'Partidas inválidas') END;
  END`);
})();
module.exports = { db, normalizarTelefono };
