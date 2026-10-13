/* Importes e IVA de cotizaciones y órdenes de servicio.
   Un solo cálculo para el editor, los documentos (PDF/Word) y el servidor (que lo carga con
   require), para que las cifras siempre coincidan. Todo se calcula en centavos enteros.
   - 'mas_iva':  los importes capturados son sin IVA; el IVA se suma al subtotal del documento.
   - 'incluido': los importes ya traen IVA; el total es exactamente lo capturado y se desglosa.
   - null:       registro anterior al IVA ("por definir"): total = suma, sin desglose. */
(function (raiz, crear) {
  const m = crear();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.Importes = m;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MODOS = ['mas_iva', 'incluido'];
  const TASAS_PERMITIDAS = [16];
  const TASA_DEFAULT = 16;
  // Tope por documento con IVA ($100,000,000.00): mantiene exactos los cálculos en centavos.
  const TOPE_CENT = 10000000000;

  const aCent = importe => Math.round((Number(importe) || 0) * 100);

  function calcular(items, modo, tasa) {
    const suma = (items || []).reduce((t, i) => t + aCent(i.importe), 0);
    if (!modo) return { subtotal_cent: suma, iva_cent: null, total_cent: suma };
    const p = Number(tasa ?? TASA_DEFAULT);
    if (modo === 'incluido') {
      const subtotal = Math.round(suma * 100 / (100 + p));
      return { subtotal_cent: subtotal, iva_cent: suma - subtotal, total_cent: suma };
    }
    const iva = Math.round(suma * p / 100);
    return { subtotal_cent: suma, iva_cent: iva, total_cent: suma + iva };
  }

  const etiquetaModo = (modo, tasa) => modo === 'incluido' ? `IVA incluido ${tasa ?? TASA_DEFAULT}%`
    : modo === 'mas_iva' ? `Más IVA ${tasa ?? TASA_DEFAULT}%` : 'IVA por definir';
  const encabezadoImporte = modo => modo === 'incluido' ? 'Importe con IVA' : modo === 'mas_iva' ? 'Importe sin IVA' : 'Importe';
  const leyenda = (modo, tasa) => modo === 'incluido' ? `Precios con IVA (${tasa ?? TASA_DEFAULT} %) incluido.`
    : modo === 'mas_iva' ? `Precios en moneda nacional más IVA (${tasa ?? TASA_DEFAULT} %).` : '';
  // Renglones de totales del documento: [etiqueta, centavos]. El último siempre es el total a pagar.
  function filasTotales(r, modo, tasa) {
    const p = tasa ?? TASA_DEFAULT;
    if (modo === 'mas_iva') return [['Subtotal', r.subtotal_cent], [`IVA ${p}%`, r.iva_cent], ['Total', r.total_cent]];
    if (modo === 'incluido') return [['Subtotal sin IVA', r.subtotal_cent], [`IVA ${p}% (incluido)`, r.iva_cent], ['Total (IVA incluido)', r.total_cent]];
    return [['Total', r.total_cent]];
  }

  // Importe con letra, a partir de centavos enteros (formato de documentos en México:
  // "MIL QUINIENTOS PESOS 50/100 M.N."). Siempre "PESOS" en plural, como la mayoría de los
  // sistemas de facturación; millones exactos llevan "DE": "UN MILLÓN DE PESOS".
  function enLetras(cent) {
    const UNIDADES = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
    const ESPECIALES = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE',
      'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
    const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
    const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
    function seccion(n) {
      let letras = '';
      const c = Math.floor(n / 100), resto = n % 100;
      if (c > 0) letras += (n === 100 ? 'CIEN' : CENTENAS[c]) + (resto > 0 ? ' ' : '');
      if (resto > 0) {
        if (resto < 10) letras += UNIDADES[resto];
        else if (resto < 30) letras += ESPECIALES[resto - 10];
        else { const d = Math.floor(resto / 10), u = resto % 10; letras += DECENAS[d] + (u > 0 ? ' Y ' + UNIDADES[u] : ''); }
      }
      return letras;
    }
    function miles(n) {
      const m = Math.floor(n / 1000), resto = n % 1000;
      let letras = '';
      if (m > 0) letras += (m === 1 ? 'MIL' : seccion(m) + ' MIL');
      if (resto > 0) letras += (letras ? ' ' : '') + seccion(resto);
      return letras;
    }
    function millones(n) {
      const mm = Math.floor(n / 1000000), resto = n % 1000000;
      let letras = '';
      if (mm > 0) letras += (mm === 1 ? 'UN MILLÓN' : miles(mm) + ' MILLONES');
      if (resto > 0) letras += (letras ? ' ' : '') + miles(resto);
      return letras;
    }
    const total = Math.abs(Math.round(Number(cent) || 0));
    const entero = Math.floor(total / 100), centavos = total % 100;
    let letras = entero === 0 ? 'CERO' : millones(entero);
    // Apócope: "UNO"/"VEINTIUNO" antes de un sustantivo se dice "UN"/"VEINTIÚN".
    letras = letras.replace(/\bVEINTIUNO\b/g, 'VEINTIÚN').replace(/\bUNO\b/g, 'UN');
    if (entero > 0 && entero % 1000000 === 0) letras += ' DE';
    return `${letras} PESOS ${String(centavos).padStart(2, '0')}/100 M.N.`;
  }

  return { MODOS, TASAS_PERMITIDAS, TASA_DEFAULT, TOPE_CENT, aCent, calcular, etiquetaModo, encabezadoImporte, leyenda, filasTotales, enLetras };
});
