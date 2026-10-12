// Fechas del negocio (México), independientes del reloj o la zona horaria del servidor.
const FORMATO_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' });

// Fecha de hoy (AAAA-MM-DD) en la hora de México.
function hoyMexico() {
  return FORMATO_DIA.format(new Date());
}

module.exports = { hoyMexico };
