/* Facturación CFDI 4.0 · F1 (2026-10-27): validaciones y cálculo de importes. Funciones puras (sin base de datos ni red), para
   poder probarlas solas. Los mensajes van en español claro: son los que verá quien captura.
   · NADA de claves del SAT escritas aquí: la compatibilidad régimen–uso y el régimen válido salen de los catálogos oficiales
     que da factura.com (tabla sat_catalogos, la llena la F2). Mientras no estén cargados, se avisa que no se pudo verificar.
   · Importes con enteros (BigInt): micro-pesos (6 decimales) por concepto; el redondeo a 2 decimales SOLO en subtotales y en
     la suma de traslados (regla 5 de CLAUDE.md). Sin flotantes. */

// ---------------- RFC ----------------
const RFC_MORAL = /^[A-ZÑ&]{3}(\d{2})(\d{2})(\d{2})[A-Z0-9]{3}$/; // 12 caracteres
const RFC_FISICA = /^[A-ZÑ&]{4}(\d{2})(\d{2})(\d{2})[A-Z0-9]{3}$/; // 13 caracteres
const RFC_GENERICOS = { XAXX010101000: 'publico_general', XEXX010101000: 'extranjero' };
const DIAS_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // febrero 29 siempre: no se sabe el siglo de «AA»
const fechaRfcValida = (mm, dd) => mm >= 1 && mm <= 12 && dd >= 1 && dd <= DIAS_MES[mm - 1];

/** Revisa la forma del RFC (largo, letras, fecha y homoclave). No consulta al SAT: eso lo hace factura.com al timbrar. */
function validarRFC(valor) {
  const rfc = String(valor ?? '').replace(/\s+/g, '').toUpperCase();
  if (!rfc) return { ok: false, rfc, tipo: null, mensaje: 'Falta el RFC' };
  if (RFC_GENERICOS[rfc]) return { ok: true, rfc, tipo: RFC_GENERICOS[rfc], mensaje: '' };
  const m = rfc.length === 12 ? RFC_MORAL.exec(rfc) : rfc.length === 13 ? RFC_FISICA.exec(rfc) : null;
  if (!m) return { ok: false, rfc, tipo: null, mensaje: rfc.length === 12 || rfc.length === 13 ? 'El RFC no tiene el formato correcto (letras, fecha AAMMDD y homoclave)' : 'El RFC debe tener 12 caracteres (empresa) o 13 (persona física)' };
  if (!fechaRfcValida(Number(m[2]), Number(m[3]))) return { ok: false, rfc, tipo: null, mensaje: 'La fecha dentro del RFC no es válida' };
  return { ok: true, rfc, tipo: rfc.length === 12 ? 'moral' : 'fisica', mensaje: '' };
}

// ---------------- Razón social ----------------
// Al final del nombre, el régimen societario NO va (la Constancia de Situación Fiscal lo muestra aparte). Se compara sin puntos ni comas.
const SOCIETARIO = /\s+(S ?A ?P ?I( DE C ?V)?|S ?A ?B( DE C ?V)?|S ?A( DE C ?V)?|S ?A ?S|S DE R ?L( DE C ?V)?|S ?C|A ?C)$/;
/** Deja la razón social como la pide el SAT: MAYÚSCULAS, espacios simples y sin régimen societario. Avisa lo que cambió. */
function normalizarRazonSocial(valor) {
  const avisos = [];
  let texto = String(valor ?? '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('es-MX');
  if (texto !== String(valor ?? '').replace(/\s+/g, ' ').trim()) avisos.push('Se pasó a MAYÚSCULAS, como en la Constancia de Situación Fiscal');
  const plano = texto.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = SOCIETARIO.exec(plano);
  if (m && plano.length > m[0].length) {
    // Se quita del texto original lo mismo que se detectó en el plano (cuenta los caracteres alfanuméricos del final).
    const quitado = m[0].trim(), letras = quitado.replace(/[^A-ZÑ0-9&]/g, '').length;
    let n = 0, i = texto.length;
    while (i > 0 && n < letras) { i--; if (/[A-ZÑ0-9&]/.test(texto[i])) n++; }
    texto = texto.slice(0, i).replace(/[\s.,]+$/, '').trim();
    avisos.push(`Se quitó «${quitado}» del final: la razón social va como en la Constancia, sin régimen societario`);
  }
  return { texto, avisos };
}

// ---------------- Código postal y correo ----------------
const validarCP = valor => {
  const cp = String(valor ?? '').replace(/\s+/g, '');
  return /^\d{5}$/.test(cp) ? { ok: true, cp, mensaje: '' } : { ok: false, cp, mensaje: cp ? 'El código postal fiscal debe tener 5 números' : 'Falta el código postal fiscal' };
};
const validarCorreo = valor => {
  const correo = String(valor ?? '').trim();
  if (!correo) return { ok: false, correo, mensaje: 'Falta el correo para enviar la factura' };
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo) && correo.length <= 254 ? { ok: true, correo, mensaje: '' } : { ok: false, correo, mensaje: 'El correo no es válido' };
};

// ---------------- Datos fiscales completos de un receptor ----------------
/** catalogos: { regimenes: Map clave→nombre | null, usos: Map clave→{ nombre, regimenes: [clave…] } | null } (de sat_catalogos). */
function validarDatosFiscales(d, catalogos = {}) {
  const faltantes = [], errores = [], avisos = [];
  const rfc = validarRFC(d.rfc); if (!rfc.ok) (d.rfc ? errores : faltantes).push(d.rfc ? rfc.mensaje : 'RFC');
  const razon = normalizarRazonSocial(d.razon_social); avisos.push(...razon.avisos);
  if (!razon.texto) faltantes.push('Razón social');
  const cp = validarCP(d.cp); if (!cp.ok) (d.cp ? errores : faltantes).push(d.cp ? cp.mensaje : 'Código postal fiscal');
  const correo = validarCorreo(d.correo); if (!correo.ok) (d.correo ? errores : faltantes).push(d.correo ? correo.mensaje : 'Correo');
  const regimen = String(d.regimen ?? '').trim(), uso = String(d.uso_cfdi ?? '').trim().toUpperCase();
  if (!regimen) faltantes.push('Régimen fiscal');
  else if (!/^\d{3}$/.test(regimen)) errores.push('El régimen fiscal debe ser la clave de 3 números (por ejemplo 601)');
  else if (catalogos.regimenes && !catalogos.regimenes.has(regimen)) errores.push(`El régimen fiscal ${regimen} no está en el catálogo del SAT`);
  if (!uso) faltantes.push('Uso del CFDI');
  else if (catalogos.usos) {
    const u = catalogos.usos.get(uso);
    if (!u) errores.push(`El uso de CFDI ${uso} no está en el catálogo del SAT`);
    else if (regimen && Array.isArray(u.regimenes) && u.regimenes.length && !u.regimenes.includes(regimen)) errores.push(`El uso ${uso} no es compatible con el régimen ${regimen}: elige otro uso o revisa el régimen en la Constancia`);
  }
  if (regimen && uso && (!catalogos.usos || !catalogos.regimenes)) avisos.push('Los catálogos del SAT todavía no están cargados: no se pudo comprobar que el régimen y el uso del CFDI sean compatibles');
  return { listo: !faltantes.length && !errores.length, faltantes, errores, avisos,
    normalizado: { rfc: rfc.rfc, razon_social: razon.texto, cp: cp.cp, regimen, uso_cfdi: uso, correo: correo.correo } };
}

// ---------------- Importes (enteros) ----------------
const MICROS = 1000000n, MICROS_POR_CENTAVO = 10000n;
const dividirRedondeando = (a, b) => (2n * a + b) / (2n * b); // a ≥ 0, redondeo «mitad hacia arriba»
/** Pesos (número o texto) → micro-pesos (BigInt). Admite hasta 6 decimales; lo demás se rechaza. */
function pesosAMicros(valor) {
  const s = typeof valor === 'number' ? (Number.isFinite(valor) ? valor.toFixed(6) : '') : String(valor ?? '').trim();
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) throw Error('Importe no válido: ' + String(valor));
  return BigInt(m[1]) * MICROS + BigInt((m[2] || '').padEnd(6, '0'));
}
const centavosAMicros = c => { if (!Number.isInteger(c) || c < 0) throw Error('Importe no válido (centavos): ' + String(c)); return BigInt(c) * MICROS_POR_CENTAVO; };
const microsACentavos = m => Number(dividirRedondeando(m, MICROS_POR_CENTAVO)); // redondeo a 2 decimales
/** Micro-pesos → texto con los decimales pedidos («36.784000»). */
function microsATexto(m, decimales = 6) {
  const entero = m / MICROS, frac = String(m % MICROS).padStart(6, '0');
  return decimales >= 6 ? `${entero}.${frac}` : decimales <= 0 ? String(entero) : `${entero}.${frac.slice(0, decimales)}`;
}
/** IVA de una base: base × tasa / 100, a 6 decimales (sin pasar por flotantes). */
const ivaMicros = (baseMicros, tasa = 16) => dividirRedondeando(baseMicros * BigInt(tasa), 100n);
/**
 * Totales de una factura. conceptos: [{ base_cent }] o [{ base_micros }]. objetoImp '02' → causa IVA; con 01, 03 o 04 los impuestos se ignoran.
 * Devuelve cada concepto con su IVA a 6 decimales, y subtotal / traslado / total en centavos (redondeo solo en las sumas).
 */
function calcularTotales(conceptos, { tasa = 16, objetoImp = '02' } = {}) {
  if (!Array.isArray(conceptos) || !conceptos.length) throw Error('La factura necesita al menos un concepto');
  const causaIva = objetoImp === '02';
  const filas = conceptos.map(c => {
    const base = c.base_micros !== undefined ? BigInt(c.base_micros) : centavosAMicros(c.base_cent);
    return { base_micros: base, iva_micros: causaIva ? ivaMicros(base, tasa) : 0n };
  });
  const sub = filas.reduce((a, f) => a + f.base_micros, 0n), iva = filas.reduce((a, f) => a + f.iva_micros, 0n);
  const subtotal_cent = microsACentavos(sub), iva_cent = microsACentavos(iva);
  return { conceptos: filas, subtotal_cent, iva_cent, total_cent: subtotal_cent + iva_cent };
}

module.exports = { validarRFC, normalizarRazonSocial, validarCP, validarCorreo, validarDatosFiscales, pesosAMicros, centavosAMicros, microsACentavos, microsATexto, ivaMicros, calcularTotales };
