// VIGÍA DE LOS KIOSCOS DEL RELOJ CHECADOR (2026-11-12, Dirección: «quiero el aviso, y que también me avise a mi correo»).
// La tableta del checador le habla al servidor cada minuto mientras está prendida, desbloqueada y con internet. Si en
// horario de trabajo de su sucursal pasan más de 5 minutos sin señal, el checador «no responde»: queda en los Logs del
// sistema, sale un aviso en Inicio y se manda un correo. Cuando vuelve a dar señal se avisa otra vez («ya responde»).
//  · Horario de trabajo: desde 15 min antes de la primera entrada hasta la última salida de los horarios activos de la
//    sucursal ese día (los que RH tiene en Asistencia → Horarios). Día sin horario o festivo: no se vigila.
//  · Solo se vigilan los kioscos activos que se usaron en los últimos 7 días (una tableta guardada no avisa).
//  · Un aviso por caída (no uno por minuto). Al reiniciar el sistema se dan 5 minutos antes de avisar.
// Aquí solo va la regla; quién recibe el aviso y cómo se manda lo decide server/checador.js.
const diaSemana = f => { const d = new Date(f + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; };
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const restar = (hhmm, min) => { const [h, m] = hhmm.split(':').map(Number), t = Math.max(0, h * 60 + m - min); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };

// { desde, hasta } («HH:MM») en que se vigila el kiosco de una sucursal ese día, o null si ese día no se trabaja.
function ventana(db, sucursalId, fecha, margenMin = 15) {
  if (db.prepare('SELECT 1 FROM main.dias_festivos WHERE fecha = ? AND activo = 1').get(fecha)) return null;
  let desde = null, hasta = null;
  for (const h of db.prepare('SELECT id FROM main.horarios WHERE sucursal_id = ? AND activo = 1').all(sucursalId)) {
    const v = db.prepare('SELECT dias FROM main.horario_versiones WHERE horario_id = ? AND desde <= ? ORDER BY desde DESC, id DESC LIMIT 1').get(h.id, fecha);
    let d = null; try { d = v ? JSON.parse(v.dias)[diaSemana(fecha)] : null; } catch { d = null; }
    if (!d || !HORA.test(d.entrada || '') || !HORA.test(d.salida || '') || d.salida <= d.entrada) continue;
    if (!desde || d.entrada < desde) desde = d.entrada;
    if (!hasta || d.salida > hasta) hasta = d.salida;
  }
  return desde ? { desde: restar(desde, margenMin), hasta } : null;
}

// kioscos(): los que se vigilan [{ id, nombre, sucursal, sucursal_id }]; ventanaDe(sucursal_id, fecha); avisar(tipo, kiosco)
// con tipo 'sin_respuesta' | 'volvio'.
function vigia({ kioscos, ventanaDe, ahoraMexico, avisar, ahora = Date.now, limiteMs = 5 * 60000 }) {
  const arranque = ahora(), senales = new Map(), caidos = new Map();
  const avisa = (tipo, k) => { try { avisar(tipo, k); } catch (e) { console.error('[kiosco] aviso:', e.message); } };
  // Cualquier petición válida del kiosco es una señal de vida.
  function senal(id) {
    senales.set(id, ahora());
    const c = caidos.get(id);
    if (c) { caidos.delete(id); avisa('volvio', { ...c, volvio: ahoraMexico(new Date(ahora())).hora.slice(0, 5) }); }
  }
  function revisar() {
    const t = ahora(), m = ahoraMexico(new Date(t)), hhmm = m.hora.slice(0, 5), vigilados = new Set();
    for (const k of kioscos()) {
      vigilados.add(k.id);
      if (caidos.has(k.id)) continue;
      const ultima = senales.get(k.id) ?? null;
      if (t - (ultima ?? arranque) <= limiteMs) continue;
      const v = ventanaDe(k.sucursal_id, m.fecha);
      if (!v || hhmm < v.desde || hhmm > v.hasta) continue;
      const u = ultima === null ? null : ahoraMexico(new Date(ultima));
      const c = { id: k.id, nombre: k.nombre, sucursal: k.sucursal || null, sucursal_id: k.sucursal_id, fecha: m.fecha, hora: hhmm,
        desde: !u ? null : u.fecha === m.fecha ? 'las ' + u.hora.slice(0, 5) : 'el ' + u.fecha.split('-').reverse().join('/') + ' a las ' + u.hora.slice(0, 5) };
      caidos.set(k.id, c); avisa('sin_respuesta', c);
    }
    for (const id of [...caidos.keys()]) if (!vigilados.has(id)) caidos.delete(id); // lo dieron de baja o lo eliminaron
  }
  return { senal, revisar, caidos: () => [...caidos.values()] };
}

// Correos de la variable CORREO_AVISOS_CHECADOR (separados por coma), más los que se le pasen; sin repetir ni inválidos.
function correosDe(...listas) {
  const vistos = new Set(), r = [];
  for (const c of listas.flat().flatMap(x => String(x || '').split(/[,;\s]+/))) {
    const k = c.trim().toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(k) && !vistos.has(k)) { vistos.add(k); r.push(k); }
  }
  return r;
}
module.exports = { vigia, ventana, correosDe };
