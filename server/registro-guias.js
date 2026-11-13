// GUÍAS DE LOS LOGS (2026-11-13, pedido de Dirección: que cada renglón se entienda sin conocer el sistema, también al
// mandarlo a soporte). Cada renglón de los Logs se explica solo:
//  · qué significa, en simple; · causas probables; · qué hacer, paso a paso; · dónde está en el código (archivo y parte);
//  · «lectura»: lo que dicen LOS DATOS de ese renglón en particular (p. ej. qué número de la velocidad está fuera de lo normal).
// La pantalla (public/logs.js) lo muestra en «¿Qué significa y qué hago?» y lo incluye en «Copiar reporte».
// Todos los tipos de renglón tienen guía (2026-11-13); un evento nuevo de los Logs debe traer la suya aquí.
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
      'Si lo alto es «trabada», «abrir» o «cara»: reinicia la tableta, cierra otras apps, apaga el ahorro de energía y déjala conectada al cargador.', 'Si sigue igual, copia este renglón con «Copiar reporte» y mándalo a quien da soporte.'],
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
      'Si dice «error al iniciar», copia el renglón con «Copiar reporte» y mándalo a soporte: es un defecto por corregir.'],
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
// ---------- Los demás renglones de los Logs (2026-11-13) ----------
const LOGIN = 'server/index.js → ruta POST /api/login (y limitarLogin, registrarLoginFallido, limitarLoginPorIp: los topes de intentos)';
const g = (que, causas, hacer, codigo, lectura = []) => ({ que, causas, hacer, codigo, lectura });
// Del detalle de un error: ruta, mensaje y los lugares del código («en archivo:línea (función) ← …»).
function partesError(d) {
  const t = String(d || ''), en = t.match(/ · en (.+)$/), cuerpo = en ? t.slice(0, en.index) : t;
  const lugares = en ? en[1].split(' ← ').map(x => x.trim()) : [];
  return { cuerpo, lugares, archivos: lugares.map(x => x.split(':')[0]) };
}
// Lo que suele querer decir un mensaje de error de JavaScript o de la base de datos, en simple.
function traducir(m) {
  const t = String(m || '');
  const r = [];
  if (/no such column/i.test(t)) r.push('«no such column»: el programa pidió a la base de datos una columna que no existe. Suele pasar si una actualización quedó a medias (falta reiniciar) o por un error del programa.');
  if (/no such table/i.test(t)) r.push('«no such table»: falta una tabla en la base de datos. Suele pasar cuando la actualización no terminó de arrancar.');
  if (/SQLITE_BUSY|database is locked/i.test(t)) r.push('«database is locked»: la base de datos estaba ocupada por otra operación al mismo tiempo. Si es raro, no pasa nada.');
  if (/is not defined/i.test(t)) r.push('«… is not defined»: el programa usó algo que no existe. Es un defecto del código.');
  if (/is not a function/i.test(t)) r.push('«… is not a function»: el programa intentó usar como función algo que no lo es. Es un defecto del código.');
  if (/Cannot read propert|of undefined|of null|is null|is undefined/i.test(t)) r.push('«… of undefined / is null»: el programa esperaba un dato que no llegó (vacío). Es un defecto del código o un dato incompleto.');
  if (/JSON/i.test(t)) r.push('Error con JSON: llegó un dato con un formato que no se pudo leer.');
  if (/ENOSPC/i.test(t)) r.push('«ENOSPC»: el disco del servidor está lleno.');
  if (/EACCES|EPERM/i.test(t)) r.push('«EACCES / EPERM»: el servidor no tiene permiso de escribir o leer un archivo o carpeta.');
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(t)) r.push('Error de conexión: el servidor no pudo comunicarse con otro servicio (internet o el servicio estaba caído).');
  return r;
}
function guiaError(d, pantalla) {
  const { cuerpo, lugares, archivos } = partesError(d), lectura = [];
  if (pantalla) {
    const [vista, archivo, ...resto] = cuerpo.split(' · ');
    if (vista) lectura.push(`Pasó en la pantalla «${vista}»${archivo && /:\d+$/.test(archivo) ? `, en ${archivo}` : ''}.`);
    lectura.push(...traducir(resto.join(' · ') || cuerpo));
  } else {
    const [ruta, ...msj] = cuerpo.split(' · ');
    if (/^(GET|POST|PUT|PATCH|DELETE) /.test(ruta)) lectura.push(`Pasó al atender la petición «${ruta}» (la dirección dice qué parte del sistema se estaba usando).`);
    else if (ruta === 'servidor') lectura.push('Pasó fuera de una petición (una tarea automática del servidor).');
    lectura.push(...traducir(msj.join(' · ')));
  }
  if (lugares.length) lectura.push(`Dónde pasó en el código: ${lugares.join(' ← ')} (el primero es donde ocurrió; los que siguen, desde dónde se llamó).`);
  else lectura.push('El renglón no trae el lugar exacto del código (errores anotados antes del 13-nov o de una parte del sistema que no lo manda).');
  return g(pantalla
    ? 'A una persona le falló algo en su pantalla del sistema (un error del programa en su navegador). Puede que algo no se haya mostrado o un botón no haya respondido. Solo se anota; no cambia datos.'
    : 'El servidor tuvo un error al atender una petición: a la persona le salió «Error interno del servidor» y lo que estaba haciendo NO se guardó. El sistema sigue funcionando.',
    pantalla ? ['Un defecto en el código de esa pantalla.', 'Un dato con un formato inesperado.', 'Una versión vieja de la pantalla guardada en el navegador después de una actualización (se arregla recargando).']
      : ['Un defecto del código.', 'Un dato que la base de datos no aceptó.', 'Una actualización que quedó a medias (falta reiniciar la app en Plesk).'],
    ['Si pasó una sola vez y la persona pudo continuar, solo vigila que no se repita.', pantalla ? 'Pide a la persona que recargue la página (o cierre sesión y vuelva a entrar).' : 'Pide a la persona que lo intente otra vez; si vuelve a fallar, es un defecto.',
      'Si se repite, toca «Copiar reporte» y mándalo a soporte: trae el archivo y la línea donde pasó.'],
    [...new Set(archivos), ...(pantalla ? ['public/app.js → bloque «Errores del navegador → logs» (manda el error y su pila)', 'server/registro-sistema.js → ruta POST /api/registro-sistema/pantalla y función lugares']
      : ['server/index.js → función h (envuelve cada ruta y anota el error) y la «red de seguridad final» (app.use al final)', 'server/registro-sistema.js → funciones error y lugares'])], lectura);
}
function guiaCorreo(d) {
  const lectura = [];
  if (/535|Invalid login|auth|credentials|EAUTH/i.test(d)) lectura.push('El servidor de correo rechazó el usuario o la contraseña: la contraseña del correo (SMTP_PASS en Plesk) está mal o venció.');
  else if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ESOCKET|EDNS/i.test(d)) lectura.push('No se pudo conectar con el servidor de correo: dirección o puerto mal puestos (SMTP_HOST, SMTP_PORT) o el servicio de correo estaba caído.');
  else if (/550|551|552|553|recipient|mailbox/i.test(d)) lectura.push('El correo del destinatario no existe o rechazó el mensaje.');
  else if (/SMTP_|no está configurado|sin configurar/i.test(d)) lectura.push('El correo del sistema no está configurado en Plesk (faltan variables SMTP_…).');
  return g('Un correo que el sistema debía mandar no salió (avisos, restablecer contraseña, reportes). El destinatario no lo recibió.',
    ['Contraseña del correo equivocada o vencida.', 'Datos del servidor de correo mal puestos en Plesk.', 'El correo del destinatario no existe.'],
    ['Lee el motivo al final del renglón.', 'Si es la contraseña: en Plesk → Node.js → variables, revisa SMTP_PASS (la contraseña del correo que manda el sistema) y reinicia la app.', 'Puedes probar el correo con la herramienta «probar-correo» del sistema.'],
    ['server/correo.js → función enviar (y verificarConexion)', 'server/index.js → require(\'./correo\').alFallar (anota el renglón)', 'herramientas/probar-correo.js → prueba de envío'], lectura);
}
function guiaWhatsapp(d) {
  const lectura = [], c = (String(d).match(/código (\d+)/) || [])[1];
  const codigos = { 190: 'el token de Meta venció o es inválido: hay que poner uno nuevo (WHATSAPP_TOKEN en Plesk).', 131030: 'el número no está autorizado (en modo de prueba de Meta solo se puede mandar a números dados de alta).',
    131047: 'pasaron más de 24 h desde el último mensaje de esa persona: fuera de esa ventana Meta solo deja mandar plantillas aprobadas.', 132000: 'la plantilla no coincide con la aprobada en Meta (número de datos).', 132001: 'la plantilla no existe o no está aprobada en Meta.',
    100: 'algún dato del envío es inválido (número o plantilla).', 368: 'Meta bloqueó temporalmente la cuenta por políticas.' };
  if (c && codigos[c]) lectura.push(`Código ${c}: ${codigos[c]}`);
  else if (/conectar/i.test(d)) lectura.push('No hubo conexión con Meta (internet del servidor o Meta caído).');
  return g('Un mensaje de WhatsApp que el sistema debía mandar no salió: Meta (la empresa de WhatsApp) lo rechazó o no se pudo conectar.',
    ['Token de Meta vencido.', 'Número no autorizado o fuera de la ventana de 24 horas.', 'Plantilla no aprobada.'], ['Lee el código de Meta en el renglón (abajo dice qué significa).', 'Los ajustes de WhatsApp están en el panel de Meta y en las variables WHATSAPP_… de Plesk.'],
    ['server/whatsapp.js → función enviar (anota el rechazo con el código de Meta) y plantilla'], lectura);
}
function guiaRespaldo(d, ok) {
  const lectura = ok ? [] : traducir(d);
  return ok ? g('El sistema hizo su copia diaria automática de la base de datos. Es una buena noticia: no hay que hacer nada.', ['Se hace solo una vez al día.'], ['Nada. Recuerda que esta copia queda en el mismo servidor: de vez en cuando baja un respaldo completo a otro lugar.'], ['server/respaldos.js → función hacer (copia diaria y cuántas se conservan)'])
    : g('La copia diaria automática de la base de datos NO se pudo hacer. Mientras siga así, no hay respaldo nuevo.', ['Disco del servidor lleno.', 'Permisos de la carpeta de respaldos.', 'La base de datos estaba ocupada.'],
      ['Lee el motivo en el renglón.', 'Baja hoy un respaldo completo desde Ajustes, por si acaso.', 'Si es disco lleno, libera espacio en Plesk.', 'Si se repite, «Copiar reporte» y a soporte.'], ['server/respaldos.js → función hacer'], lectura);
}
function guiaFactura(d, error) {
  const lectura = [], http = (String(d).match(/HTTP (\d+)/) || [])[1];
  if (/pruebas/.test(d)) lectura.push('Fue en el ambiente de PRUEBAS de factura.com (sandbox): no tiene validez fiscal.');
  if (error && http === '401') lectura.push('HTTP 401: las llaves de factura.com (F-Api-Key / F-Secret-Key en Plesk) están mal o no corresponden al ambiente.');
  if (error && http && http.startsWith('5')) lectura.push(`HTTP ${http}: factura.com tuvo una falla de su lado; se puede reintentar más tarde.`);
  if (error && http === '200') lectura.push('HTTP 200 con error: factura.com contestó pero rechazó la factura por un dato (el mensaje dice cuál, p. ej. RFC, régimen o código postal).');
  return error ? g('Una operación con factura.com (timbrar, cancelar, descargar, enviar) falló. La factura NO quedó como se pidió.', ['Un dato fiscal del cliente o del concepto está mal (RFC, régimen, uso de CFDI, código postal).', 'Llaves de factura.com mal puestas.', 'factura.com caído.'],
    ['Lee el mensaje de factura.com al final del renglón: casi siempre dice qué dato corregir.', 'Corrige el dato en la ficha del cliente o del servicio y vuelve a intentar.', 'Si dice algo de llaves o 401, revisa las variables de factura.com en Plesk.'],
    ['server/facturacion-rutas.js → rutas de facturación (anotan en facturas_log)', 'server/facturacion-timbrado.js → timbrado', 'server/facturacom.js → función pedir (la conexión con factura.com)', 'server/facturacion-validaciones.js → revisiones antes de timbrar'], lectura)
    : g('Una operación con factura.com salió bien (timbrar, descargar, enviar, cancelar…). Es informativo.', ['Alguien hizo una operación de facturación.'], ['Nada.'], ['server/facturacion-rutas.js → rutas de facturación', 'server/facturacom.js → conexión con factura.com'], lectura);
}
const accesos = {
  entro: () => g('Alguien entró al sistema con su usuario y contraseña. Es informativo.', ['Un inicio de sesión normal.'], ['Nada. Si no reconoces la red (IP) o el equipo, cambia la contraseña de ese usuario.'], [LOGIN]),
  salio: () => g('Alguien cerró su sesión. Es informativo.', ['Tocó «Salir».'], ['Nada.'], ['server/index.js → ruta POST /api/logout']),
  fallo: () => g('Alguien escribió mal la contraseña de un usuario que sí existe.', ['Se equivocó al teclear.', 'Alguien intenta adivinar la contraseña de otro.'], ['Si son pocos, nada.', 'Si son muchos del mismo usuario o de una red que no conoces, cambia esa contraseña y revisa los bloqueos.'], [LOGIN]),
  desconocido: () => g('Alguien intentó entrar con un usuario o correo que no existe en el sistema (por seguridad no se guarda lo que escribió).', ['Se equivocó al escribir su usuario.', 'Alguien prueba usuarios al azar.'], ['Si son muchos desde la misma red, es alguien probando: el sistema bloquea solo esa red.'], [LOGIN]),
  bloqueado: () => g('Un usuario o una red quedó bloqueado por muchos intentos fallidos. Mientras dure, no puede entrar ni con la contraseña correcta.', ['Muchas contraseñas equivocadas seguidas.', 'Alguien intentando adivinar.'], ['Si es alguien de la empresa, espera a que se desbloquee o asígnale una contraseña nueva en Ajustes → Usuarios.', 'Si no lo reconoces, déjalo bloqueado y cambia la contraseña de ese usuario.'], [LOGIN]),
  rechazado: () => g('Alguien siguió intentando entrar mientras estaba bloqueado.', ['La persona no sabía que estaba bloqueada.', 'Un intento de adivinar contraseñas.'], ['Igual que «Bloqueado por intentos».'], ['server/index.js → función anotarRechazo y limitarLogin']),
  olvido: () => g('Alguien pidió restablecer su contraseña con «¿Olvidaste tu contraseña?»: se le mandó un correo con un enlace.', ['La persona olvidó su contraseña.', 'Alguien escribió el correo de otra persona.'], ['Nada. Si no lo pidió el dueño del correo, el enlace caduca solo y su contraseña no cambia.'], ['server/cuentas.js → ruta POST /api/olvide-password']),
  restablecio: () => g('Alguien cambió su contraseña con el enlace del correo de «¿Olvidaste tu contraseña?».', ['La persona recuperó su acceso.'], ['Nada. Si el dueño no lo hizo, desactiva el usuario y revisa su correo.'], ['server/cuentas.js → ruta POST /api/restablecer-password']),
};
Object.assign(GUIAS, accesos, {
  error: f => guiaError(f.detalle, false),
  pantalla: f => guiaError(f.detalle, true),
  correo_fallo: f => guiaCorreo(f.detalle || ''),
  whatsapp_fallo: f => guiaWhatsapp(f.detalle || ''),
  respaldo_ok: f => guiaRespaldo(f.detalle || '', true),
  respaldo_fallo: f => guiaRespaldo(f.detalle || '', false),
  factura_ok: f => guiaFactura(f.detalle || '', false),
  factura_error: f => guiaFactura(f.detalle || '', true),
  inicio: () => g('El sistema arrancó: pasa después de cada actualización (al fusionar un cambio) o cuando se reinicia la app en Plesk. Es informativo.',
    ['Una actualización o un reinicio en Plesk.', 'Si nadie actualizó ni reinició: el servidor se cayó y Plesk lo volvió a levantar.'],
    ['Nada, si coincide con una actualización.', 'Si aparecen varios seguidos sin que nadie actualice, revisa los «Error del servidor» justo antes: el sistema se está cayendo.'],
    ['server/index.js → app.listen al final (anota la versión, Node y el ambiente de facturación)']),
  descarga: () => g('Alguien bajó un respaldo: la base de datos completa (o con archivos) salió del servidor. Solo Dirección puede hacerlo.', ['Un respaldo hecho a propósito.'], ['Si no lo hiciste tú, cambia tu contraseña de inmediato: ese archivo trae toda la información de la empresa.'],
    ['server/index.js → ruta GET /api/admin/backup', 'server/respaldo-completo.js → ruta GET /descargas/respaldo-completo']),
});
// La guía de un renglón de los Logs, o null si ese evento todavía no tiene.
function explicar(fila) {
  const g = fila && GUIAS[fila.evento];
  if (!g) return null;
  try { return g(fila); } catch { return null; }
}
module.exports = { explicar, EVENTOS_CON_GUIA: Object.keys(GUIAS), LIMITES };
