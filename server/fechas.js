// Fechas del negocio (México), independientes del reloj o la zona horaria del servidor.
const FORMATO_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' });

// Fecha de hoy (AAAA-MM-DD) en la hora de México.
function hoyMexico() {
  return FORMATO_DIA.format(new Date());
}

const FORMATO_HORA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
// Ahora mismo en la hora de México, con el reloj del servidor (nunca el del dispositivo): { utc, fecha, hora }.
function ahoraMexico(d = new Date()) {
  const p = Object.fromEntries(FORMATO_HORA.formatToParts(d).map(x => [x.type, x.value]));
  return { utc: d.toISOString(), fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}:${p.second}` };
}

module.exports = { hoyMexico, ahoraMexico };
