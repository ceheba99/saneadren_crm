// Tablas retiradas (2026-11-05): se conservan con sus datos aunque ya no tengan pantalla (migraciones aditivas).
//  · plantillas_descripcion: descripciones guardadas por cliente (PR #134).
//  · cliente_sucursales: sucursales de cada cliente para llenar {sucursal} (PR #135).
// Dirección decidió quitarlas: las descripciones van en el servicio del catálogo, con listas precargadas por servicio.
module.exports = function tablasRetiradas(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS cliente_sucursales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id),
    nombre TEXT NOT NULL CHECK(length(trim(nombre)) BETWEEN 1 AND 80),
    direccion TEXT,
    activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
    creado_por INTEGER REFERENCES usuarios(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_cliente_sucursales ON cliente_sucursales(cliente_id, activo);
  CREATE TABLE IF NOT EXISTS plantillas_descripcion (
    id INTEGER PRIMARY KEY AUTOINCREMENT, cliente_id INTEGER NOT NULL REFERENCES clientes(id), servicio_id INTEGER REFERENCES catalogo_servicios(id),
    nombre TEXT, texto TEXT NOT NULL CHECK(length(texto) BETWEEN 1 AND 10000), activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
    creado_por INTEGER REFERENCES usuarios(id), created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));`);
};
