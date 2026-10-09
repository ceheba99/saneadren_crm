const crypto = require('crypto');
// Persistir solo el hash del token; conservar la caducidad entre reinicios.
module.exports = function crearAlmacen(db) {
  db.exec('CREATE TABLE IF NOT EXISTS sesiones (token_hash TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), expira INTEGER NOT NULL)');
  db.prepare('DELETE FROM sesiones WHERE expira <= ?').run(Date.now());
  const hash = token => crypto.createHash('sha256').update(token).digest('hex');
  return {
    get(token) {
      return db.prepare('SELECT usuario_id AS usuarioId, expira FROM sesiones WHERE token_hash = ?').get(hash(token));
    },
    set(token, sesion) {
      db.prepare('INSERT INTO sesiones (token_hash, usuario_id, expira) VALUES (?, ?, ?) ON CONFLICT(token_hash) DO UPDATE SET usuario_id = excluded.usuario_id, expira = excluded.expira').run(hash(token), sesion.usuarioId, sesion.expira);
    },
    delete(token) { db.prepare('DELETE FROM sesiones WHERE token_hash = ?').run(hash(token)); },
    // Cierra todas las sesiones de un usuario (p. ej. al restablecer su contraseña o desactivarlo).
    revocarUsuario(usuarioId) { db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(usuarioId); }
  };
};
