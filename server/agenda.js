// CHOQUES DE AGENDA (Dirección, 2026-11-11, auditoría H10): al programar o cambiar una orden se AVISA —sin bloquear—
// si su técnico o alguien de su equipo, o su unidad (pipa, equipo), ya tiene otro servicio ese día a una hora cercana,
// o si alguien del equipo está de vacaciones, incapacidad o permiso. Las órdenes no tienen duración: se considera choque
// mismo día y menos de 2 horas de diferencia, o cuando a alguna de las dos le falta la hora.
const VENTANA_MIN = 120;
const AUSENCIA = { vacaciones: 'de vacaciones', incapacidad: 'con incapacidad', permiso: 'con permiso' };
const minutos = h => (/^\d{2}:\d{2}/.test(h || '') ? Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5)) : null);
const cerca = (a, b) => { const x = minutos(a), y = minutos(b); return x == null || y == null || Math.abs(x - y) < VENTANA_MIN; };
const clave = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function choques(db, leadId) {
  const l = db.prepare('SELECT id, fecha_servicio, hora_servicio, equipo, tecnico_id, estatus, ejecucion FROM main.leads WHERE id = ?').get(leadId);
  if (!l || l.estatus !== 'ganado' || !l.fecha_servicio || l.ejecucion) return [];
  const folio = o => require('./sucursales').folio('OS', 'leads', o.id, o.created_at);
  const hora = o => (o.hora_servicio ? ' a las ' + o.hora_servicio : ' (sin hora)');
  const avisos = [];
  // Otras órdenes vigentes ese mismo día.
  const otras = db.prepare(`SELECT id, created_at, hora_servicio, equipo, tecnico_id FROM main.leads WHERE id <> ? AND estatus = 'ganado'
    AND fecha_servicio = ? AND COALESCE(ejecucion, '') <> 'no_realizado'`).all(l.id, l.fecha_servicio).filter(o => cerca(o.hora_servicio, l.hora_servicio));
  // Personas: el equipo de la orden (y el técnico asignado por usuario, si no tiene ficha en el equipo).
  const gente = db.prepare('SELECT p.id, p.nombre, p.usuario_id FROM main.orden_personal op JOIN main.personal p ON p.id = op.personal_id WHERE op.lead_id = ?').all(l.id);
  for (const p of gente) {
    for (const o of otras) {
      if (db.prepare('SELECT 1 FROM main.orden_personal WHERE lead_id = ? AND personal_id = ?').get(o.id, p.id) || (p.usuario_id && o.tecnico_id === p.usuario_id))
        avisos.push(`${p.nombre} ya tiene la orden ${folio(o)} ese día${hora(o)}`);
    }
    const a = db.prepare(`SELECT tipo FROM main.incidencias_personal WHERE personal_id = ? AND cancelada = 0 AND tipo IN ('vacaciones', 'incapacidad', 'permiso')
      AND fecha_inicio <= ? AND fecha_fin >= ? LIMIT 1`).get(p.id, l.fecha_servicio, l.fecha_servicio);
    if (a) avisos.push(`${p.nombre} está ${AUSENCIA[a.tipo]} ese día`);
  }
  if (l.tecnico_id && !gente.some(p => p.usuario_id === l.tecnico_id)) {
    const u = db.prepare('SELECT nombre FROM main.usuarios WHERE id = ?').get(l.tecnico_id);
    for (const o of otras) if (o.tecnico_id === l.tecnico_id) avisos.push(`${u?.nombre || 'El técnico'} ya tiene la orden ${folio(o)} ese día${hora(o)}`);
  }
  // Unidad o equipo (texto libre: pipa, vactor…): mismo texto = misma unidad.
  if (clave(l.equipo)) for (const o of otras) if (clave(o.equipo) === clave(l.equipo)) avisos.push(`La unidad «${l.equipo}» ya está en la orden ${folio(o)} ese día${hora(o)}`);
  return [...new Set(avisos)].slice(0, 10);
}
module.exports = { choques };
