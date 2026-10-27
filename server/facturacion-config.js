/* Facturación CFDI 4.0 · F1 (2026-10-27): configuración desde el .env del servidor. Las llaves de factura.com viven SOLO ahí:
   nunca en el navegador, en los registros ni en el repositorio. Esta función no devuelve las llaves por ninguna vía de «estado»:
   solo dice si están puestas. Por defecto SIEMPRE sandbox (sin validez fiscal); producción solo con FACTURA_ENV=prod escrito a propósito. */

// Hosts de la API (CLAUDE.md y apidocs/primeros-pasos; se confirman con la primera llamada de la F2).
const HOSTS = { sandbox: 'https://sandbox.factura.com/api', prod: 'https://api.factura.com' };
// Valor fijo que pide la API en el encabezado F-PLUGIN (viene tal cual en la documentación oficial; no es un secreto).
const F_PLUGIN = '9d4095c8f7ed5785cb14c0e3b033eeb8252416ed';

const limpio = v => String(v ?? '').trim();

function leerConfig(env = process.env) {
  const pedido = limpio(env.FACTURA_ENV).toLowerCase();
  const entorno = pedido === 'prod' ? 'prod' : 'sandbox';
  const avisos = [];
  if (pedido && !['sandbox', 'prod'].includes(pedido)) avisos.push(`FACTURA_ENV tiene «${limpio(env.FACTURA_ENV)}»: no es «sandbox» ni «prod», así que se usa sandbox`);
  const apiKey = limpio(env.FACTURA_API_KEY), secretKey = limpio(env.FACTURA_SECRET_KEY);
  const regimen = limpio(env.EMISOR_REGIMEN), cp = limpio(env.EMISOR_CP);
  const faltantes = [];
  if (!apiKey) faltantes.push('FACTURA_API_KEY');
  if (!secretKey) faltantes.push('FACTURA_SECRET_KEY');
  if (!regimen) faltantes.push('EMISOR_REGIMEN'); else if (!/^\d{3}$/.test(regimen)) avisos.push('EMISOR_REGIMEN debe ser la clave de 3 números (por ejemplo 626)');
  if (!cp) faltantes.push('EMISOR_CP'); else if (!/^\d{5}$/.test(cp)) avisos.push('EMISOR_CP debe tener 5 números');
  return {
    entorno, host: HOSTS[entorno], plugin: F_PLUGIN,
    // Las llaves salen solo para el cliente HTTP del servidor (F2), nunca hacia el navegador.
    llaves: { apiKey, secretKey },
    emisor: { regimen, cp },
    faltantes, avisos,
    listo: !faltantes.length && !avisos.some(a => /debe/.test(a)),
  };
}

/** Lo que se puede mostrar a una persona: sin llaves (solo «puesta» o «falta»). */
function estadoConfig(env = process.env) {
  const c = leerConfig(env);
  return { entorno: c.entorno, host: c.host, produccion: c.entorno === 'prod',
    apiKey: c.llaves.apiKey ? 'puesta' : 'falta', secretKey: c.llaves.secretKey ? 'puesta' : 'falta',
    emisor: { regimen: c.emisor.regimen || null, cp: c.emisor.cp || null }, faltantes: c.faltantes, avisos: c.avisos, listo: c.listo };
}

module.exports = { leerConfig, estadoConfig, HOSTS, F_PLUGIN };
