// Etapa 6 de la auditoría (2026-11-12): quien no tiene su ficha de personal ligada a su usuario no cambia sueldos ni da
// PIN, enlaces o códigos de cara (server/personal.js, sinFicha). Las pruebas que arman su equipo con gerentes o RH sin
// ficha los ligan aquí a una ficha propia YA DADA DE BAJA: así el sistema sabe cuál es la suya, sin mover las listas,
// los conteos de activos ni los números de empleado que esas pruebas revisan.
// Uso: require('./ligar-fichas.cjs')(DB, ['Gema Gerente', 'Gus GerenteMx'])
const { DatabaseSync } = require('node:sqlite');
module.exports = function ligarFichas(DB, nombres) {
  const d = new DatabaseSync(DB);
  try {
    d.exec('PRAGMA busy_timeout = 5000');
    for (const nombre of nombres) {
      const u = d.prepare('SELECT id FROM usuarios WHERE nombre = ?').get(nombre);
      if (!u || d.prepare('SELECT 1 FROM personal WHERE usuario_id = ?').get(u.id)) continue;
      d.prepare("INSERT INTO personal (nombre, puesto, usuario_id, activo, fecha_baja, motivo_baja) VALUES (?, 'Otro', ?, 0, '2020-01-01', 'Ficha propia de prueba')").run('Ficha propia ' + nombre, u.id);
    }
  } finally { d.close(); }
};
// Suelta la ficha de prueba de un usuario, para cuando la prueba le crea después su ficha propia de verdad.
module.exports.soltar = function soltar(DB, nombre) {
  const d = new DatabaseSync(DB);
  try { d.exec('PRAGMA busy_timeout = 5000'); d.prepare("UPDATE personal SET usuario_id = NULL WHERE nombre = ? AND activo = 0").run('Ficha propia ' + nombre); } finally { d.close(); }
};
