// GUÍAS DE LOS LOGS (2026-11-13, pedido de Dirección: que cada renglón se entienda sin conocer el sistema, también al
// pasarlo a un asistente de IA o a soporte). Cada renglón de los Logs se explica solo:
//  · qué significa, en simple; · causas probables; · qué hacer, paso a paso; · dónde está en el código (archivo y parte);
//  · «lectura»: lo que dicen LOS DATOS de ese renglón en particular (p. ej. qué número de la velocidad está fuera de lo normal).
// La pantalla (public/logs.js) lo muestra en «¿Qué significa y qué hago?» y lo incluye en «Copiar para una IA».
// Se empezó por el reloj checador; los demás eventos se irán agregando aquí mismo (uno por función).
const num = (t, re) => { const m = String(t || '').match(re); return m ? Number(m[1]) : null; };

// Límites de lo «normal» en la tableta (medidos con el checador en una tableta de gama media; se ajustan aquí).
const LIMITES = { abrir_s: 6, servidor_ms: 800, cara_s: 15, vida_s: 12, trabada_s: 4, peor_s: 1.5, paso_s: 2 };

function velocidad(d) {
  const codigo = ['public/kiosco.html → bloque «Velocidad» (funciones velocidadAlAbrir y velocidadAlChecar; los tiempos de cada petición se toman en api())',
    'server/checador.js → ruta POST /api/publico/kiosco/diagnostico (recibe el renglón) y GET /api/publico/kiosco/estado («servidor»)',
    'public/kiosco-sw.js → caché de la página y de los archivos del reconocimiento facial', 'android-checador/src/mx/saneadren/checador/MainActivity.java → la app de la tableta (WebView)'];
  const lectura = [], equipo = String(d).match(/\((app|navegador)(?:, (\d+) nucleos)?(?:, ([\d.]+) GB)?\)/);
  if (/al checar/.test(d)) {
    for (const [re, que] of [[/codigo a PIN ([\d.]+) s/, 'de escribir el código a pedir el PIN'], [/PIN a botones ([\d.]+) s/, 'de escribir el PIN a mostrar los botones'], [/registrar ([\d.]+) s/, 'de tocar el botón a quedar registrada']]) {
      const s = num(d, re);
      if (s !== null && s > LIMITES.paso_s) lectura.push(`Paso lento: ${que} tardó ${s} s (lo normal es menos de ${LIMITES.paso_s} s). Ese paso es una consulta al servidor: casi siempre es el internet de la tableta.`);
    }
    if (!lectura.length) lectura.push('Los tres pasos de la checada (código, PIN y registrar) están dentro de lo normal.');
  } else {
    const abrir = num(d, /abrir ([\d.]+) s/), srv = num(d, /servidor (\d+) ms/), cara = num(d, /cara ([\d.]+) s/), vida = num(d, /vida ([\d.]+) s/), trab = num(d, /trabada ([\d.]+) s/), peor = num(d, /peor ([\d.]+) s/);
    if (/sin servidor/.test(d)) lectura.push('Al abrir no hubo respuesta del servidor: la tableta estaba sin internet (o el sistema se estaba reiniciando).');
    if (srv !== null && srv > LIMITES.servidor_ms) lectura.push(`El servidor tardó ${srv} ms en contestar (lo normal es menos de ${LIMITES.servidor_ms} ms): es el internet de la tableta (Wi-Fi débil) o el servidor ocupado, no la tableta.`);
    if (abrir !== null && abrir > LIMITES.abrir_s) lectura.push(`La pantalla tardó ${abrir} s en abrir (lo normal es menos de ${LIMITES.abrir_s} s).`);
    if (cara !== null && cara > LIMITES.cara_s) lectura.push(`Cargar el reconocimiento facial tardó ${cara} s (lo normal es menos de ${LIMITES.cara_s} s): mientras carga, la tableta responde más lento. Solo se carga si alguien de la sucursal tiene su cara registrada.`);
    if (vida !== null && vida > LIMITES.vida_s) lectura.push(`Cargar la prueba de vida tardó ${vida} s (lo normal es menos de ${LIMITES.vida_s} s).`);
    if ((trab !== null && trab > LIMITES.trabada_s) || (peor !== null && peor > LIMITES.peor_s)) lectura.push(`La pantalla se trabó ${trab} s en total (la peor pausa, ${peor} s): la tableta está saturada (procesador o memoria). No es el internet.`);
    if (equipo && equipo[3] && Number(equipo[3]) <= 2) lectura.push(`La tableta reporta ${equipo[3]} GB de memoria: es poca para el reconocimiento facial.`);
    if (!lectura.length) lectura.push('Todos los tiempos están dentro de lo normal: la tableta, el internet y el servidor respondieron bien en esta medición.');
  }
  if (equipo) lectura.push(`Medido en ${equipo[1] === 'app' ? 'la app propia del checador' : 'un navegador (Chrome), no en la app'}${equipo[2] ? ', ' + equipo[2] + ' núcleos' : ''}${equipo[3] ? ', ' + equipo[3] + ' GB de memoria' : ''}.`);
  return { que: 'La tableta del reloj checador midió cuánto tarda y lo mandó aquí. No es una falla: es un informe. «abrir» = segundos hasta que la pantalla quedó lista; «servidor» = milisegundos que tardó el sistema en contestarle; «cara» y «vida» = segundos en cargar el reconocimiento facial y la prueba de vida; «trabada» = segundos en que la pantalla no respondió al dedo.',
    causas: ['Servidor lento (más de 800 ms): Wi-Fi débil donde está la tableta, internet de la oficina saturado o el sistema reiniciándose.', 'Pantalla trabada o «abrir» alto: tableta con poca memoria, muchas apps abiertas, ahorro de energía prendido, o el reconocimiento facial cargándose.',
      'Pasos lentos al checar con «servidor» normal: el Wi-Fi se corta por momentos.'],
    hacer: ['Compara varios renglones de «Velocidad»: uno solo malo puede ser casualidad; si se repite, es real.', 'Si lo alto es «servidor» o los pasos al checar: acerca la tableta al módem o revisa el internet.',
      'Si lo alto es «trabada», «abrir» o «cara»: reinicia la tableta, cierra otras apps, apaga el ahorro de energía y déjala conectada al cargador.', 'Si sigue igual, copia este renglón con «Copiar para una IA» y mándalo a quien da soporte.'],
    codigo, lectura };
}

function recuperado(d) {
  const lectura = [];
  if (/Reinicio \(/.test(d)) {
    lectura.push('La página del checador volvió a arrancar sin que ella misma lo pidiera, y al arrancar anotó cómo había quedado la vez anterior (la «caja negra»).');
    if (/abrieron la app/.test(d)) lectura.push('Volvió porque alguien abrió la app (o el sistema la volvió a abrir).');
    if (/recarga del navegador/.test(d)) lectura.push('Volvió por una recarga del navegador.');
    const hace = String(d).match(/Última señal hace ([^;]+);/); if (hace) lectura.push(`La última señal de vida había sido hace ${hace[1]}: ese tiempo el checador estuvo sin funcionar.`);
    if (/estaba bloqueada u oculta/.test(d)) lectura.push('La pantalla estaba bloqueada u oculta: la tableta se apagó, se bloqueó o alguien salió de la app. El sistema operativo detuvo la página.');
    if (/estaba a la vista/.test(d)) lectura.push('La pantalla estaba a la vista: el programa seguía vivo pero dejó de dibujar o se colgó (no fue un bloqueo de la tableta).');
    if (/descartada/.test(d)) lectura.push('«descartada»: el sistema operativo sacó la página de la memoria (tableta con poca memoria libre).');
    if (/caché: \d+ sin responder/.test(d)) lectura.push('La copia guardada de la página no contestó al abrir: la caché de la tableta falló en ese arranque.');
    if (/caché lenta/.test(d)) lectura.push('La copia guardada de la página tardó varios segundos en abrir.');
  } else if (/pantalla vacía/.test(d)) lectura.push('La pantalla del checador se quedó en blanco (vacía) más de 4 segundos y el vigilante la recargó solo.');
  else if (/no terminó de iniciar/.test(d)) lectura.push('La página no terminó de iniciar en 12 segundos y el vigilante la recargó solo.');
  else if (/error al iniciar/.test(d)) lectura.push('Hubo un error de programa al iniciar la página (el texto después de «error al iniciar:» es el error). El vigilante la recargó solo. Si se repite, es un defecto del código: mándalo a soporte.');
  return { que: 'La pantalla del reloj checador tuvo un tropiezo y se compuso sola (se recargó o volvió a arrancar). La gente pudo seguir checando; queda anotado para saber qué pasó y cada cuánto.',
    causas: ['La tableta se bloqueó o se apagó la pantalla y al volver la página se reinició.', 'Poca memoria: el sistema operativo descartó la página.', 'El internet tardó al abrir y la página no alcanzó a cargar.', 'Un error del programa al iniciar (raro; el renglón trae el texto del error).'],
    hacer: ['Si pasa una o dos veces al día, no hay que hacer nada.', 'Si pasa muchas veces: revisa que la tableta esté conectada al cargador, sin ahorro de energía y con «Pantalla activa» encendida (Ajustes → Opciones de desarrollador).',
      'Si dice «error al iniciar», copia el renglón con «Copiar para una IA» y mándalo a soporte: es un defecto por corregir.'],
    codigo: ['public/kiosco.html → primer bloque <script> («vigilante» y «caja negra»: funciones recuperar, K.anotar y el arranque que arma el texto «Reinicio (…)»)', 'public/kiosco.html → función revivir (qué hace al volver de un bloqueo)',
      'public/kiosco-sw.js → caché que abre la página sin internet', 'server/checador.js → ruta POST /api/publico/kiosco/diagnostico'], lectura };
}

function atencion(d) {
  const codigo = ['server/kiosco-vigia.js → función revisar (cuándo avisa) y reporte (lo que dice la tableta)', 'server/checador.js → avisarAtencion y textoAtencion; GET /api/publico/kiosco/estado (recibe batería, cargador, cámara y pantalla)', 'public/kiosco.html → estadoTableta (lo que manda la tableta cada minuto)'];
  if (/bater[ií]a/i.test(d)) return { que: 'La tableta del checador tiene 20 % de batería o menos y no está cargando. Si se apaga, nadie puede checar.',
    causas: ['El cargador está desconectado, flojo o dañado.', 'El contacto no tiene corriente.'], hacer: ['Conecta la tableta al cargador y revisa que marque «cargando».', 'Si está conectada y no carga, cambia el cable o el cargador.', 'El aviso se quita solo al cargar o pasar de 30 %.'], codigo, lectura: [] };
  if (/c[aá]mara/i.test(d)) return { que: 'La cámara de la tableta lleva 3 minutos sin funcionar. Las checadas siguen entrando, pero sin foto y quedan «por revisar».',
    causas: ['Otra app está usando la cámara.', 'Se quitó el permiso de cámara a la app o al navegador.', 'La cámara se quedó trabada.'], hacer: ['En la tableta, toca el aviso amarillo de la cámara para reintentar.', 'Cierra y abre la app del checador.', 'Revisa en Ajustes → Aplicaciones → Checador Saneadren → Permisos que la cámara esté permitida.', 'Si sigue, reinicia la tableta.'], codigo: [...codigo, 'public/kiosco.html → iniciarCamara (motivos por los que falla)'], lectura: [] };
  return { que: 'La tableta dice que NO puede mantener su pantalla encendida. Se va a apagar sola y, si tiene bloqueo, pedirá el PIN de la tableta: nadie podrá checar hasta que alguien la desbloquee.',
    causas: ['El ahorro de energía de la tableta está prendido.', 'La batería está baja.', 'Se usa en Chrome en vez de la app propia del checador.'], hacer: ['Conecta la tableta al cargador.', 'Apaga el ahorro de energía (Ajustes → Batería).', 'Activa «Pantalla activa» en Ajustes → Opciones de desarrollador.', 'Usa la app «Checador Saneadren» en vez de Chrome: mantiene la pantalla encendida por sí misma.'],
    codigo: [...codigo, 'public/kiosco.html → función despierta (pide mantener la pantalla encendida)', 'android-checador/src/mx/saneadren/checador/MainActivity.java → FLAG_KEEP_SCREEN_ON'], lectura: [] };
}

function sinRespuesta(d) {
  const lectura = [];
  const u = String(d).match(/lo último que reportó: ([^.]+)/); if (u) lectura.push('Antes de callarse la tableta reportó: ' + u[1] + '.');
  if (/bater[ií]a (\d+) %[^,;.]*sin cargador/.test(d) && num(d, /bater[ií]a (\d+) %/) <= 25) lectura.push('Tenía poca batería y estaba sin cargador: lo más probable es que se apagó por batería.');
  return { que: 'La tableta del reloj checador lleva más de 5 minutos sin comunicarse con el sistema, en horario de trabajo. Mientras siga así, nadie puede checar en ella (quien tenga su enlace puede checar desde su celular).',
    causas: ['La tableta se apagó o se quedó sin batería.', 'Se bloqueó la pantalla (pide el PIN de la tableta).', 'Se quedó sin internet (Wi-Fi caído).', 'Alguien cerró la app del checador o abrió otra.'],
    hacer: ['Ve a la tableta: ¿está prendida y en la pantalla del checador?', 'Si pide PIN, desbloquéala y abre «Checador Saneadren».', 'Si dice «Sin conexión», revisa el Wi-Fi.', 'Cuando vuelva, saldrá el renglón «El reloj checador ya responde». Las checadas que se hicieron sin internet se suben solas.'],
    codigo: ['server/kiosco-vigia.js → función revisar (más de 5 minutos sin señal dentro del horario de la sucursal) y ventana (horario vigilado)', 'server/checador.js → avisarKiosco (Logs, Inicio y correo) y el middleware kiosco (cada petición de la tableta es una señal)', 'public/kiosco.html → el intervalo de 60 s del arranque que llama a conectar()'], lectura };
}

const GUIAS = {
  kiosco_velocidad: f => velocidad(f.detalle || ''),
  kiosco_recuperado: f => recuperado(f.detalle || ''),
  kiosco_atencion: f => atencion(f.detalle || ''),
  kiosco_sin_respuesta: f => sinRespuesta(f.detalle || ''),
  kiosco_volvio: () => ({ que: 'La tableta del reloj checador volvió a comunicarse con el sistema después de un rato sin dar señal. Ya se puede checar en ella.',
    causas: ['Regresó el internet, alguien desbloqueó o prendió la tableta, o volvió a abrir la app.'], hacer: ['Nada. Si se cae seguido, revisa el renglón anterior «El reloj checador no responde» para ver la causa.'],
    codigo: ['server/kiosco-vigia.js → función senal (la primera señal después de una caída)', 'server/checador.js → avisarKiosco'], lectura: [] }),
  whatsapp_rechazado: f => {
    const firma = /firma/i.test(f?.detalle || '');
    return { que: firma ? 'Llegó un aviso de Meta (un mensaje de WhatsApp) pero su firma no coincide con la llave del sistema, así que se ignoró. Nadie recibe respuesta del bot mientras esto pase.'
        : 'Llegó un mensaje de WhatsApp a un número que no es el configurado en el sistema (WHATSAPP_PHONE_ID), así que se ignoró.',
      causas: firma ? ['WHATSAPP_APP_SECRET en Plesk no es la «Clave secreta de la app» de la misma app de Meta (o tiene espacios de más).', 'Alguien que no es Meta mandó algo al webhook (raro).']
        : ['WHATSAPP_PHONE_ID en Plesk es de otro número (p. ej. el real) y el mensaje llegó al de prueba, o al revés.', 'Hay dos números conectados a la misma app de Meta.'],
      hacer: firma ? ['En developers.facebook.com → tu app → Configuración de la app → Básica: copia la «Clave secreta de la app» y pégala en WHATSAPP_APP_SECRET de Plesk; reinicia la app Node.js.']
        : ['En developers.facebook.com → tu app → WhatsApp → Configuración de la API: copia el «Identificador del número de teléfono» del número que vas a usar y ponlo en WHATSAPP_PHONE_ID de Plesk; reinicia la app Node.js.'],
      codigo: ['server/whatsapp.js → POST /api/publico/whatsapp'], lectura: [] };
  },
};
// La guía de un renglón de los Logs, o null si ese evento todavía no tiene.
function explicar(fila) {
  const g = fila && GUIAS[fila.evento];
  if (!g) return null;
  try { return g(fila); } catch { return null; }
}
module.exports = { explicar, EVENTOS_CON_GUIA: Object.keys(GUIAS), LIMITES };
