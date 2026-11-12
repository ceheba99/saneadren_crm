// Base de datos SQLite con el módulo integrado de Node (node:sqlite): no necesita compilar nada al
// instalar, así funciona igual en Render, en Plesk o en una computadora sin herramientas de compilación.
// Ofrece lo que el CRM usaba de better-sqlite3: prepare().get/all/run, exec, transaction, pragma,
// backup y close.
const { DatabaseSync, backup: respaldar } = require('node:sqlite');

// node:sqlite entrega filas sin prototipo; se copian a objetos normales (como better-sqlite3).
const normal = fila => (fila === undefined ? undefined : Object.assign({}, fila));
// Un valor que no llegó (undefined) se toma como NULL: la consulta no encuentra nada y la ruta responde con su
// mensaje normal («elige un proveedor»…), en vez de tronar con «cannot be bound» (error 500).
const limpio = p => p.map(v => (v === undefined ? null : v));
class Sentencia {
  constructor(st) { this.st = st; }
  get(...p) { return normal(this.st.get(...limpio(p))); }
  all(...p) { return this.st.all(...limpio(p)).map(normal); }
  run(...p) { return this.st.run(...limpio(p)); }
}

class Database {
  constructor(archivo) {
    this.db = new DatabaseSync(archivo);
    this.archivo = archivo;
    this.profundidad = 0; // transacciones anidadas: la de afuera es BEGIN; las de adentro, SAVEPOINT
  }
  prepare(sql) { return new Sentencia(this.db.prepare(sql)); }
  exec(sql) { this.db.exec(sql); return this; }
  // Solo se usa para ajustes ("journal_mode = WAL", "foreign_keys = ON", …).
  pragma(texto) { return this.db.prepare('PRAGMA ' + texto).all(); }
  // Igual que better-sqlite3: devuelve una función que corre todo junto o nada.
  // .immediate(...) (también como en better-sqlite3) aparta la base para escribir desde el inicio: si otro proceso
  // está a mitad de una operación, espera a que termine (busy_timeout) en vez de leer un saldo que está por cambiar.
  // Se usa donde se revisa un saldo y luego se guarda dinero (auditoría ARQ-14 / H-001).
  transaction(fn) {
    const normal = this.envolver(fn, 'BEGIN');
    normal.immediate = this.envolver(fn, 'BEGIN IMMEDIATE');
    return normal;
  }
  envolver(fn, inicio) {
    const base = this;
    return function (...args) {
      const nivel = base.profundidad++;
      const punto = 'sp_' + nivel;
      base.db.exec(nivel === 0 ? inicio : 'SAVEPOINT ' + punto);
      try {
        const r = fn.apply(this, args);
        base.db.exec(nivel === 0 ? 'COMMIT' : 'RELEASE ' + punto);
        return r;
      } catch (err) {
        try { base.db.exec(nivel === 0 ? 'ROLLBACK' : 'ROLLBACK TO ' + punto + '; RELEASE ' + punto); } catch { /* ya se deshizo */ }
        throw err;
      } finally { base.profundidad--; }
    };
  }
  // Copia consistente de la base (descarga de respaldo del administrador).
  async backup(destino) { await respaldar(this.db, destino); }
  close() { this.db.close(); }
}

module.exports = Database;
