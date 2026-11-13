// VIGÍA DE LOS KIOSCOS DEL RELOJ CHECADOR (2026-11-12, Dirección: «quiero el aviso, y que también me avise a mi correo»).
// La tableta del checador le habla al servidor cada minuto mientras está prendida, desbloqueada y con internet. Si en
// horario de trabajo de su sucursal pasan más de 5 minutos sin señal, el checador «no responde»: queda en los Logs del
// sistema, sale un aviso en Inicio y se manda un correo. Cuando vuelve a dar señal se avisa otra vez («ya responde»).
//  · Horario de trabajo: desde 15 min antes de la primera entrada hasta la última salida de los horarios activos de la
//    sucursal ese día (los que RH tiene en Asistencia → Horarios). Día sin horario o festivo: no se vigila.
//  · Solo se vigilan los kioscos activos que se usaron en los últimos 7 días (una tableta guardada no avisa).
//  · Un aviso por caída (no uno por minuto). Al reiniciar el sistema se dan 5 minutos antes de avisar.
//  · «Necesita atención» (2026-11-12, para prevenir la falla): la tableta manda con su señal cómo va de batería y si
//    su cámara funciona. Batería en 20 % o menos y sin cargador, o cámara fallando 3 minutos seguidos → un aviso (en
//    horario de trabajo). Se quita solo al conectarla (o pasar de 30 %) o cuando la cámara vuelve a funcionar.
//    2026-11-13: también si la tableta dice 3 minutos seguidos que NO puede mantener la pantalla encendida (se va a
//    apagar y a bloquear: pedirá el PIN de la tableta y nadie podrá checar).
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
  const arranque = ahora(), senales = new Map(), caidos = new Map(), estados = new Map(), atencion = new Map();
  const avisa = (tipo, k) => { try { avisar(tipo, k); } catch (e) { console.error('[kiosco] aviso:', e.message); } };
  // Cualquier petición válida del kiosco es una señal de vida.
  function senal(id) {
    senales.set(id, ahora());
    const c = caidos.get(id);
    if (c) { caidos.delete(id); avisa('volvio', { ...c, volvio: ahoraMexico(new Date(ahora())).hora.slice(0, 5) }); }
  }
  // Lo que la tableta dice de sí misma con cada señal: batería (0 a 100 o null), si está cargando y si la cámara sirve.
  function reporte(id, r = {}) {
    const e = estados.get(id) || { camMal: 0, panMal: 0 };
    e.bateria = Number.isFinite(r.bateria) && r.bateria >= 0 && r.bateria <= 100 ? Math.round(r.bateria) : null;
    e.cargando = typeof r.cargando === 'boolean' ? r.cargando : null;
    e.camMal = r.camara === false ? e.camMal + 1 : 0;
    // «pantalla»: false = la tableta pidió mantener la pantalla encendida y el sistema no la deja (ahorro de energía…).
    e.panMal = r.pantalla === false ? (e.panMal || 0) + 1 : 0; e.pantalla = typeof r.pantalla === 'boolean' ? r.pantalla : null;
    estados.set(id, e);
  }
  function revisar() {
    const t = ahora(), m = ahoraMexico(new Date(t)), hhmm = m.hora.slice(0, 5), vigilados = new Set();
    for (const k of kioscos()) {
      vigilados.add(k.id);
      const v = ventanaDe(k.sucursal_id, m.fecha), enHorario = !!v && hhmm >= v.desde && hhmm <= v.hasta;
      const base = { id: k.id, nombre: k.nombre, sucursal: k.sucursal || null, sucursal_id: k.sucursal_id, fecha: m.fecha, hora: hhmm };
      const ultima = senales.get(k.id) ?? null;
      if (!caidos.has(k.id) && enHorario && t - (ultima ?? arranque) > limiteMs) {
        const u = ultima === null ? null : ahoraMexico(new Date(ultima));
        const c = { ...base, ...(estadoTexto(k.id) ? { ultimo: estadoTexto(k.id) } : {}), desde: !u ? null : u.fecha === m.fecha ? 'las ' + u.hora.slice(0, 5) : 'el ' + u.fecha.split('-').reverse().join('/') + ' a las ' + u.hora.slice(0, 5) };
        caidos.set(k.id, c); avisa('sin_respuesta', c);
      }
      const e = estados.get(k.id);
      for (const [tipo, mal, bien] of [
        ['bateria', !!e && e.bateria !== null && e.bateria <= 20 && e.cargando === false, !e || e.cargando === true || e.bateria === null || e.bateria >= 30],
        ['camara', !!e && e.camMal >= 3, !e || e.camMal === 0],
        ['pantalla', !!e && e.panMal >= 3, !e || !e.panMal]]) {
        const llave = k.id + ':' + tipo;
        if (atencion.has(llave)) { if (bien) atencion.delete(llave); }
        else if (mal && enHorario && !caidos.has(k.id)) { const c = { ...base, tipo, bateria: e.bateria }; atencion.set(llave, c); avisa(tipo, c); }
      }
    }
    for (const id of [...caidos.keys()]) if (!vigilados.has(id)) caidos.delete(id); // lo dieron de baja o lo eliminaron
    for (const [llave, c] of [...atencion]) if (!vigilados.has(c.id)) atencion.delete(llave);
  }
  // Lo último que la tableta dijo de sí misma, en una frase para los Logs («batería 80 % cargando, cámara bien, pantalla fija»).
  function estadoTexto(id) {
    const e = estados.get(id); if (!e) return '';
    return [e.bateria != null ? 'batería ' + e.bateria + ' %' + (e.cargando === true ? ' cargando' : e.cargando === false ? ' sin cargador' : '') : '', e.camMal ? 'cámara fallando' : 'cámara bien',
      e.panMal ? 'pantalla se puede apagar sola' : e.pantalla === true ? 'pantalla fija' : ''].filter(Boolean).join(', ');
  }
  return { senal, reporte, revisar, estadoTexto, caidos: () => [...caidos.values()], atencion: () => [...atencion.values()] };
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
