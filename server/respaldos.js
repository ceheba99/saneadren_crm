// Respaldos automáticos de la base: una copia al día en «respaldos/», junto a la base (fuera del sitio web),
// y se conservan las de los últimos RESPALDOS_DIAS días (14 si no se indica). Protege contra borrados por
// error o una base dañada. NO sustituye una copia fuera del servidor (si el disco falla, se pierden las dos):
// para eso, el respaldo programado de Plesk a otro lugar o descargar «Respaldar base» de vez en cuando.
// Solo corre si la base vive en DB_PATH (servidor); RESPALDOS=0 lo apaga.
const fs = require('fs');
const path = require('path');

module.exports = function respaldos(db, { hoyMexico }) {
  if (!process.env.DB_PATH || process.env.RESPALDOS === '0') return null;
  const dir = path.join(path.dirname(path.resolve(process.env.DB_PATH)), 'respaldos');
  const conservar = Math.max(1, Number(process.env.RESPALDOS_DIAS) || 14);
  const lista = () => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^saneadren-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort() : []);
  let corriendo = false;
  async function hacer() {
    if (corriendo) return; corriendo = true;
    try {
      const nombre = `saneadren-${hoyMexico()}.db`;
      if (lista().includes(nombre)) return;
      fs.mkdirSync(dir, { recursive: true });
      const tmp = path.join(dir, nombre + '.tmp');
      await db.backup(tmp);
      fs.renameSync(tmp, path.join(dir, nombre)); // solo queda con su nombre final si se terminó completo
      for (const viejo of lista().slice(0, -conservar)) fs.unlinkSync(path.join(dir, viejo));
      console.log(`[respaldo] ${nombre} listo (se conservan ${conservar} días)`);
    } catch (err) { console.error('[respaldo] no se pudo hacer:', err.message); }
    finally { corriendo = false; }
  }
  // El primero a los 10 minutos de arrancar y luego cada 6 horas (solo hace uno por día).
  setTimeout(hacer, 10 * 60 * 1000).unref();
  setInterval(hacer, 6 * 60 * 60 * 1000).unref();
  return { hacer, lista, dir };
};
