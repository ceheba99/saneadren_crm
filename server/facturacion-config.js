/* Facturación CFDI 4.0 · F1 (2026-10-27): configuración desde el .env del servidor. Las llaves de factura.com viven SOLO ahí:
   nunca en el navegador, en los registros ni en el repositorio. Esta función no devuelve las llaves por ninguna vía de «estado»:
   solo dice si están puestas. Por defecto SIEMPRE sandbox (sin validez fiscal); producción solo con FACTURA_ENV=prod escrito a propósito.
   Cada entorno tiene SUS PROPIAS variables (llaves, régimen y CP del emisor): en sandbox el emisor es un RFC de prueba con sellos de
   prueba, y las llaves de sandbox y de producción son distintas. Así, con FACTURA_ENV=sandbox NUNCA se leen las llaves de producción
   (ni al revés) y no se pueden mezclar por descuido. */

// Hosts de la API (CLAUDE.md y apidocs/primeros-pasos; se confirman con la primera llamada de la F2).
const HOSTS = { sandbox: 'https://sandbox.factura.com/api', prod: 'https://api.factura.com' };
// Valor fijo que pide la API en el encabezado F-PLUGIN (viene tal cual en la documentación oficial; no es un secreto).
const F_PLUGIN = '9d4095c8f7ed5785cb14c0e3b033eeb8252416ed';
// Prefijo de las variables de cada entorno: FACTURA_SANDBOX_API_KEY, FACTURA_PROD_API_KEY, etc.
const PREFIJO = { sandbox: 'FACTURA_SANDBOX_', prod: 'FACTURA_PROD_' };
// Nombres que se usaron antes de separar los entornos: ya no se leen, pero se avisa para que se renombren.
const NOMBRES_ANTERIORES = ['API_KEY', 'SECRET_KEY', 'FACTURA_API_KEY', 'FACTURA_SECRET_KEY', 'EMISOR_REGIMEN', 'EMISOR_CP'];

const limpio = v => String(v ?? '').trim();

function leerConfig(env = process.env) {
  const pedido = limpio(env.FACTURA_ENV).toLowerCase();
  const entorno = pedido === 'prod' ? 'prod' : 'sandbox';
  const p = PREFIJO[entorno];
  const avisos = [];
  if (pedido && !['sandbox', 'prod'].includes(pedido)) avisos.push(`FACTURA_ENV tiene «${limpio(env.FACTURA_ENV)}»: no es «sandbox» ni «prod», así que se usa sandbox`);
  const apiKey = limpio(env[p + 'API_KEY']), secretKey = limpio(env[p + 'SECRET_KEY']);
  const regimen = limpio(env[p + 'EMISOR_REGIMEN']), cp = limpio(env[p + 'EMISOR_CP']);
  const faltantes = [];
  if (!apiKey) faltantes.push(p + 'API_KEY');
  if (!secretKey) faltantes.push(p + 'SECRET_KEY');
  if (!regimen) faltantes.push(p + 'EMISOR_REGIMEN'); else if (!/^\d{3}$/.test(regimen)) avisos.push(`${p}EMISOR_REGIMEN debe ser la clave de 3 números (por ejemplo 626)`);
  if (!cp) faltantes.push(p + 'EMISOR_CP'); else if (!/^\d{5}$/.test(cp)) avisos.push(`${p}EMISOR_CP debe tener 5 números`);
  const viejas = NOMBRES_ANTERIORES.filter(n => limpio(env[n]));
  if (viejas.length) avisos.push(`Estas variables ya no se leen: ${viejas.join(', ')}. Cámbiales el nombre a ${PREFIJO.sandbox}… (llaves de sandbox) o ${PREFIJO.prod}… (llaves de producción)`);
  return {
    entorno, host: HOSTS[entorno], plugin: F_PLUGIN, prefijo: p,
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
  return { entorno: c.entorno, host: c.host, produccion: c.entorno === 'prod', prefijo: c.prefijo,
    apiKey: c.llaves.apiKey ? 'puesta' : 'falta', secretKey: c.llaves.secretKey ? 'puesta' : 'falta',
    emisor: { regimen: c.emisor.regimen || null, cp: c.emisor.cp || null }, faltantes: c.faltantes, avisos: c.avisos, listo: c.listo };
}

module.exports = { leerConfig, estadoConfig, HOSTS, F_PLUGIN, PREFIJO };
