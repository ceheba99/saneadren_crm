/* Facturación CFDI 4.0 · F7 (2026-11-03): revisión «¿está lista la facturación para producción?». Solo LEE (la base y el nombre de las variables del .env);
   no llama a factura.com, no cambia nada y nunca devuelve una llave: de cada variable solo dice si está puesta. La ve únicamente Dirección (ruta en
   facturacion-rutas.js). Cada punto es { id, nivel, titulo, detalle } con nivel «ok», «falta» (bloquea pasar a producción) o «aviso» (hay que
   confirmarlo a mano: el sistema no lo puede saber). Lo que NO se puede comprobar desde aquí (CSD de producción en factura.com, saldo de timbres,
   que el contador confirme el régimen) va siempre como aviso. */
const fs = require('fs'), path = require('path');
const { leerConfig } = require('./facturacion-config');
const { CATALOGOS } = require('./facturacion-catalogos');

const REGIMEN_ESPERADO = '626'; // persona moral en RESICO (decisión del 2026-10-27)
const DIAS_RESPALDO = 2;

function ultimoRespaldo(env) {
  if (!env.DB_PATH || env.RESPALDOS === '0') return { activo: false };
  const dir = path.join(path.dirname(path.resolve(env.DB_PATH)), 'respaldos');
  try {
    const lista = fs.readdirSync(dir).filter(f => /^saneadren-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
    return { activo: true, ultimo: lista.length ? lista[lista.length - 1].slice(10, 20) : null, cuantos: lista.length };
  } catch { return { activo: true, ultimo: null, cuantos: 0 }; }
}
const diasDesde = fecha => Math.floor((Date.now() - new Date(fecha + 'T12:00:00').getTime()) / 86400000);

/** env: las variables del servidor. demo: el demo no se conecta con nadie. Devuelve { entorno, demo, listo, items }. */
function revisarProduccion(db, env = process.env, { demo = false } = {}) {
  const items = [];
  const punto = (id, nivel, titulo, detalle = '') => items.push({ id, nivel, titulo, detalle });
  const actual = leerConfig(env);
  // Las variables de PRODUCCIÓN se revisan aunque el servidor siga en pruebas: así se ve qué falta antes de cambiar FACTURA_ENV.
  const prod = leerConfig({ ...env, FACTURA_ENV: 'prod' });

  if (demo) punto('demo', 'aviso', 'Estás en el demo', 'El demo no tiene llaves ni se conecta con factura.com: esta revisión solo tiene sentido en el servidor real.');
  punto('entorno', actual.entorno === 'prod' ? 'ok' : 'aviso', actual.entorno === 'prod' ? 'El servidor ya está en PRODUCCIÓN' : 'El servidor sigue en pruebas (sandbox)',
    actual.entorno === 'prod' ? 'Los timbres nuevos tienen validez fiscal.' : 'Es lo correcto hasta que todo lo demás esté en verde. El cambio es lo último: poner FACTURA_ENV=prod en el .env del servidor y reiniciar.');
  punto('llaves_prod', prod.faltantes.length ? 'falta' : 'ok', 'Llaves y datos del emisor de producción en el .env',
    prod.faltantes.length ? `Faltan: ${prod.faltantes.join(', ')}. Se escriben solo en el archivo .env del servidor (nunca en el chat ni en el repositorio).` : 'Llave, llave secreta, régimen y CP del emisor puestos (el sistema nunca muestra su valor).');
  for (const a of prod.avisos) if (/debe|ya no se leen/.test(a)) punto('llaves_prod_aviso', /debe/.test(a) ? 'falta' : 'aviso', 'Revisa el .env', a);
  if (prod.emisor.regimen && prod.emisor.regimen !== REGIMEN_ESPERADO) punto('regimen', 'aviso', `El régimen del emisor de producción es ${prod.emisor.regimen}`, `Lo acordado para Saneadren es ${REGIMEN_ESPERADO} (persona moral en RESICO). Confírmalo con tu contador antes de timbrar.`);
  punto('csd_prod', 'aviso', 'Sellos (CSD) de Saneadren en la cuenta de producción de factura.com', 'No se puede comprobar desde aquí. En factura.com (producción) deben estar cargados el .cer, el .key y su contraseña, y la cuenta con timbres disponibles.');

  // Sucursales: CP de expedición y series DE PRODUCCIÓN (cada serie vive en la cuenta de su entorno).
  const series = db.prepare('SELECT sucursal_id, tipo_documento, serie, entorno FROM series_factura WHERE activo = 1').all();
  const sucursales = db.prepare('SELECT id, nombre, cp_expedicion FROM sucursales WHERE activo = 1 ORDER BY id').all();
  // Con el servidor en pruebas, una serie de pruebas es lo esperado: la de producción solo se puede crear cuando ya se está conectado a esa cuenta.
  for (const s of sucursales) {
    const falta = [], despues = [];
    if (!(s.cp_expedicion || prod.emisor.cp)) falta.push('código postal de expedición');
    for (const [tipo, nombre] of [['factura', 'serie de facturas'], ['pago', 'serie de complementos de pago']]) {
      const x = series.find(r => r.sucursal_id === s.id && r.tipo_documento === tipo);
      if (!x) falta.push(nombre);
      else if (x.entorno !== 'prod') (actual.entorno === 'prod' ? falta : despues).push(`${nombre} (la actual, ${x.serie}, es de pruebas)`);
    }
    punto('sucursal_' + s.id, falta.length ? 'falta' : despues.length ? 'aviso' : 'ok', `Sucursal ${s.nombre}`,
      [falta.length && 'Falta: ' + falta.join('; ') + '.', despues.length && 'Después de cambiar a producción: crea o elige en Ajustes → Facturación la ' + despues.join(' y la ') + '. Cada sucursal guarda una sola serie por tipo y es de la cuenta de su entorno: la de pruebas deja de servir.',
        !falta.length && !despues.length && 'CP de expedición y series de producción listos.'].filter(Boolean).join(' '));
  }
  if (!sucursales.length) punto('sucursales', 'falta', 'No hay sucursales activas');

  // Claves del SAT de cada servicio que se factura.
  const sinClave = db.prepare("SELECT nombre FROM catalogo_servicios WHERE activo = 1 AND (COALESCE(clave_prod_serv, '') = '' OR COALESCE(clave_unidad, '') = '') ORDER BY orden, id").all().map(r => r.nombre);
  punto('claves_sat', sinClave.length ? 'falta' : 'ok', 'Claves del SAT de los servicios', sinClave.length ? `Sin clave completa: ${sinClave.join(', ')}. Tu contador las confirma; se capturan en Ajustes → Facturación.` : 'Todos los servicios activos tienen clave de producto y unidad.');
  punto('claves_contador', 'aviso', 'Confirma las claves con tu contador', 'El sistema comprueba que existan en el catálogo del SAT, no que sean las que corresponden a tu servicio.');

  const cat = Object.fromEntries(db.prepare('SELECT catalogo, COUNT(*) total FROM sat_catalogos GROUP BY catalogo').all().map(r => [r.catalogo, r.total]));
  const vacios = Object.keys(CATALOGOS).filter(c => !cat[c]);
  punto('catalogos', vacios.length ? 'falta' : 'ok', 'Catálogos del SAT descargados', vacios.length ? `Faltan: ${vacios.join(', ')}. Pulsa «Actualizar catálogos del SAT».` : 'Todos los catálogos tienen datos. Vuelve a actualizarlos una vez en producción.');

  // Clientes: el UID de factura.com es de la cuenta de cada entorno; al pasar a producción se vuelve a buscar por RFC.
  const deprueba = db.prepare("SELECT COUNT(*) n FROM clientes_fiscales WHERE activo = 1 AND uid_facturacom IS NOT NULL AND uid_entorno = 'sandbox'").get().n;
  if (actual.entorno !== 'prod' && deprueba) punto('clientes_uid', 'aviso', `${deprueba} cliente${deprueba === 1 ? '' : 's'} fiscal${deprueba === 1 ? '' : 'es'} ligado${deprueba === 1 ? '' : 's'} a la cuenta de pruebas`, 'No es problema: al primer timbrado real el sistema los busca por RFC en producción (si ya existen te pregunta cuál es) o los crea. Revisa que su razón social, CP y régimen sean los de su Constancia de Situación Fiscal.');

  // Respaldo: la base guarda el XML timbrado, así que su copia es también la copia de tus facturas.
  const r = ultimoRespaldo(env);
  if (!r.activo) punto('respaldo', demo ? 'aviso' : 'falta', 'Respaldo diario de la base', demo ? 'No aplica en el demo.' : 'No está activo (falta DB_PATH o RESPALDOS=0). Los XML timbrados viven en la base: sin respaldo, una falla del disco los pierde.');
  else if (!r.ultimo) punto('respaldo', 'falta', 'Respaldo diario de la base', 'Todavía no hay ninguna copia en la carpeta «respaldos/».');
  else punto('respaldo', diasDesde(r.ultimo) <= DIAS_RESPALDO ? 'ok' : 'falta', 'Respaldo diario de la base', `Última copia: ${r.ultimo} (${r.cuantos} guardadas).${diasDesde(r.ultimo) > DIAS_RESPALDO ? ' Tiene más de ' + DIAS_RESPALDO + ' días: revisa por qué no se está haciendo.' : ''}`);
  punto('respaldo_fuera', 'aviso', 'Copia de la base fuera del servidor', 'Las copias diarias viven en el mismo disco y se borran a los 14 días; las facturas deben conservarse 5 años. Programa el respaldo de Plesk a otro lugar y descarga «Respaldar base» antes del primer timbre real.');

  const reales = db.prepare("SELECT COUNT(*) n FROM facturas WHERE entorno = 'prod' AND estatus IN ('timbrada', 'cancelacion_solicitada', 'cancelada')").get().n;
  if (reales) punto('reales', 'ok', `Ya hay ${reales} CFDI real${reales === 1 ? '' : 'es'} en el sistema`);
  punto('primera_real', 'aviso', 'La primera factura real', 'Hazla de una orden real y pequeña, con un RFC que controles (el tuyo o el de la empresa) y tu correo: en producción factura.com sí le manda el correo al receptor. Espera unos minutos antes de cancelarla (el SAT contesta 205 si es muy pronto).');

  return { entorno: actual.entorno, demo, listo: !items.some(i => i.nivel === 'falta'), items };
}

module.exports = { revisarProduccion };
