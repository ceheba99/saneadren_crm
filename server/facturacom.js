/* Facturación CFDI 4.0 · F2 (2026-10-27): cliente HTTP de factura.com. SIN PROBAR contra la API real (aún no hay llaves de sandbox):
   se probó con respuestas simuladas escritas a partir de la documentación oficial (apidocs). Reglas (CLAUDE.md):
   · Llaves solo del .env del servidor. NUNCA se imprimen, se guardan ni salen en un error: de una respuesta de error solo se
     toma el «message»; el cuerpo completo se descarta (el ejemplo de errores de la doc trae campos «Data» y «Secret» con
     valores que parecen credenciales).
   · Un error cuenta como error AUNQUE el HTTP sea 200 (status: «error» o response: «error»).
   · Timeout de 30 s. Reintentos SOLO en errores de red y SOLO en peticiones de lectura (GET); un POST (crear, timbrar,
     cancelar) NUNCA se reintenta aquí: antes de repetir un timbrado hay que consultar si ya existe (lo decide la F3).
   · La respuesta puede ser JSON o un archivo (PDF/XML): se detecta por el Content-Type y se devuelve como Buffer.
   · Las formas de respuesta no son uniformes en la doc (status/response, Data/data, message texto u objeto): aquí se unifican. */
const { leerConfig } = require('./facturacion-config');

const TIMEOUT_MS = 30000;

/** Error de facturación: lo que muestra el sistema (mensaje en español) y qué tipo de fallo fue. Nunca lleva llaves ni el cuerpo completo. */
class ErrorFactura extends Error {
  constructor(codigo, mensaje, extra = {}) {
    super(mensaje); this.name = 'ErrorFactura';
    this.codigo = codigo; // config | red | tiempo | api | respuesta
    this.httpStatus = extra.httpStatus ?? null;
    this.detalles = extra.detalles || []; // [{ campo, mensaje }] cuando la API señala campos
    this.reintentable = !!extra.reintentable;
  }
}

// «message» puede ser texto, o un objeto { campo: ["mensaje", …] } (errores de validación de la doc de clientes).
function textoDeMensaje(m) {
  if (typeof m === 'string') return { texto: m.trim(), detalles: [] };
  if (m && typeof m === 'object') {
    const detalles = [];
    for (const [campo, v] of Object.entries(m)) for (const t of Array.isArray(v) ? v : [v]) if (t != null && typeof t !== 'object') detalles.push({ campo, mensaje: String(t) });
    return { texto: detalles.map(d => d.mensaje).join(' · '), detalles };
  }
  return { texto: '', detalles: [] };
}
const esExito = c => c && typeof c === 'object' && !Array.isArray(c) && (c.status === 'success' || c.response === 'success') && c.status !== 'error' && c.response !== 'error';
const esFallo = c => c && typeof c === 'object' && !Array.isArray(c) && (c.status === 'error' || c.response === 'error');
/** Los datos útiles de una respuesta: «Data», «data», o la respuesta tal cual si no trae envoltorio. */
const datosDe = c => (c && typeof c === 'object' && !Array.isArray(c) ? (c.Data ?? c.data ?? c) : c);

function crearClienteFactura({ config = leerConfig(), fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS, reintentosRed = 2, esperaMs = 400, alEvento = null } = {}) {
  const { apiKey, secretKey } = config.llaves;
  // Quita las llaves de cualquier texto (por si una respuesta las repitiera).
  const limpiar = t => { let s = String(t ?? ''); for (const k of [apiKey, secretKey]) if (k && k.length >= 4) s = s.split(k).join('***'); return s.slice(0, 500); };
  const aviso = e => { try { alEvento?.(e); } catch { /* el registro no debe romper la llamada */ } };

  async function pedirUna(metodo, ruta, { query, cuerpo } = {}) {
    if (!apiKey || !secretKey) throw new ErrorFactura('config', `Faltan las llaves de factura.com del entorno ${config.entorno}: revisa ${config.prefijo}API_KEY y ${config.prefijo}SECRET_KEY en el .env (npm run facturacion-estado)`);
    const qs = query && Object.keys(query).length ? '?' + new URLSearchParams(query) : '';
    const control = new AbortController(), reloj = setTimeout(() => control.abort(), timeoutMs);
    let r;
    try {
      r = await fetchImpl(config.host + ruta + qs, { method: metodo, signal: control.signal, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        headers: { 'Content-Type': 'application/json', 'F-PLUGIN': config.plugin, 'F-Api-Key': apiKey, 'F-Secret-Key': secretKey } });
    } catch (e) {
      clearTimeout(reloj);
      if (e?.name === 'AbortError') throw new ErrorFactura('tiempo', 'factura.com tardó más de 30 segundos en contestar. No se sabe si recibió la petición: antes de repetirla, revisa si ya quedó registrada.', { reintentable: false });
      throw new ErrorFactura('red', 'No se pudo conectar con factura.com (revisa la conexión a internet del servidor).', { reintentable: true });
    }
    let tipo = '', buf;
    try { tipo = String(r.headers?.get?.('content-type') || '').toLowerCase(); buf = Buffer.from(await r.arrayBuffer()); }
    catch (e) {
      clearTimeout(reloj);
      if (e?.name === 'AbortError') throw new ErrorFactura('tiempo', 'factura.com tardó más de 30 segundos en contestar. No se sabe si recibió la petición: antes de repetirla, revisa si ya quedó registrada.', { reintentable: false });
      throw new ErrorFactura('red', 'Se cortó la conexión mientras factura.com contestaba.', { reintentable: true });
    }
    clearTimeout(reloj);
    const http = r.status;
    // Archivo (PDF, XML…): se entrega tal cual; un error con HTTP no exitoso se trata abajo.
    if (http >= 200 && http < 300 && tipo && !/json|text\/plain|text\/html/.test(tipo)) return { http, tipo, archivo: buf, datos: null, crudo: null };
    let cuerpoJson = null;
    try { cuerpoJson = JSON.parse(buf.toString('utf8')); } catch { /* no es JSON */ }
    if (http >= 400 || esFallo(cuerpoJson)) {
      const { texto, detalles } = textoDeMensaje(cuerpoJson?.message ?? cuerpoJson?.messsage);
      const base = texto || (http === 401 || http === 403 ? 'factura.com no aceptó las llaves (revisa que sean las del entorno activo)' : `factura.com respondió con un error (HTTP ${http})`);
      throw new ErrorFactura('api', limpiar(base), { httpStatus: http, detalles: detalles.map(d => ({ campo: d.campo, mensaje: limpiar(d.mensaje) })), reintentable: false });
    }
    if (cuerpoJson === null) throw new ErrorFactura('respuesta', 'factura.com respondió algo que el sistema no pudo leer.', { httpStatus: http });
    // Sin «status»/«response» también se acepta (hay catálogos y listas sin envoltorio); lo que NO se acepta es un éxito dudoso con HTTP raro.
    return { http, tipo, archivo: null, datos: datosDe(cuerpoJson), crudo: cuerpoJson, exito: esExito(cuerpoJson) };
  }

  /** GET se reintenta solo ante fallos de red; cualquier otro método, una sola vez. */
  async function pedir(metodo, ruta, opciones = {}) {
    const intentos = metodo === 'GET' ? 1 + reintentosRed : 1;
    let ultimo;
    for (let i = 1; i <= intentos; i++) {
      try {
        const res = await pedirUna(metodo, ruta, opciones);
        aviso({ metodo, ruta, http: res.http, ok: true, intento: i });
        return res;
      } catch (e) {
        ultimo = e; aviso({ metodo, ruta, http: e.httpStatus, ok: false, codigo: e.codigo, mensaje: e.message, intento: i });
        if (!(e instanceof ErrorFactura) || !e.reintentable || i === intentos) break;
        await new Promise(r => setTimeout(r, esperaMs * i));
      }
    }
    throw ultimo;
  }

  return { config, get: (ruta, query) => pedir('GET', ruta, { query }), post: (ruta, cuerpo) => pedir('POST', ruta, { cuerpo }) };
}

module.exports = { crearClienteFactura, ErrorFactura, textoDeMensaje, esExito, esFallo, datosDe, TIMEOUT_MS };
