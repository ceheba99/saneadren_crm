/* Cuentas por pagar con las palabras del Excel «CUENTAS POR PAGAR QRO» (hoja CXP, listas de la hoja LISTA).
   Un solo lugar para el navegador (pantalla y descarga) y el servidor (que lo carga con require), para que
   el STATUS, el MÉTODO DE PAGO y el TIPO DE GASTO salgan iguales en todos lados.
   - TIPO DE GASTO: cada cuánto se repite o a qué plazo es el gasto (no es la categoría: esa es «Concepto de gasto»).
   - STATUS: nunca se captura; sale de los montos (lo pagado contra el total).
   - MÉTODO DE PAGO: se arma con el tipo de comprobante, el método del SAT (PUE/PPD) y la vía del pago. */
(function (raiz, crear) {
  const m = crear();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.CxpExcel = m;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // [clave guardada, como se ve en pantalla, como va en el Excel]. Lista de la columna G de la hoja LISTA (2026-11-12).
  const TIPOS_GASTO = [['semanal', 'Semanal', 'SEMANAL'], ['mensual', 'Mensual', 'MENSUAL'], ['bimestral', 'Bimestral', 'BIMESTRAL'],
    ['4_meses', '4 meses', '4 MESES'], ['24_meses', '24 meses', '24 MESES'], ['36_meses', '36 meses', '36 MESES'], ['48_meses', '48 meses', '48 MESES'],
    ['variable', 'Variable', 'VARIABLE'], ['unico', 'Único', 'UNICO']];
  const TIPO = Object.fromEntries(TIPOS_GASTO.map(([k, t, e]) => [k, { texto: t, excel: e }]));
  // Dirección cambia esta lista en «Listas desplegables» (server/listas.js y public/listas.js): se reemplaza aquí mismo
  // para que el servidor, la pantalla y el Excel usen la misma. lista: [[clave, como se ve, como va en el Excel], …].
  function ponerTiposGasto(lista) {
    TIPOS_GASTO.splice(0, TIPOS_GASTO.length, ...lista.map(x => x.slice(0, 3)));
    for (const k of Object.keys(TIPO)) delete TIPO[k];
    for (const [k, t, e] of TIPOS_GASTO) TIPO[k] = { texto: t, excel: e };
  }
  const esTipoGasto = k => Object.prototype.hasOwnProperty.call(TIPO, k);
  const tipoGastoTexto = k => (esTipoGasto(k) ? TIPO[k].texto : '');
  const tipoGastoExcel = k => (esTipoGasto(k) ? TIPO[k].excel : '');

  // STATUS de la hoja LISTA: solo PENDIENTE, PARCIAL y PAGADO (2026-11-12: «SIN FACTURA» es del comprobante y va en MÉTODO DE PAGO).
  const STATUS = ['PENDIENTE', 'PARCIAL', 'PAGADO'];
  const statusDe = (totalCent, pagadoCent) => (!(pagadoCent > 0) ? 'PENDIENTE' : pagadoCent < totalCent ? 'PARCIAL' : 'PAGADO');

  // MÉTODO DE PAGO de la hoja LISTA (columna D) más «SIN FACTURA», que el Excel usa en los gastos sin factura.
  const METODOS_EXCEL = ['PUE', 'PPD', 'PAGADORA', 'CALCULO FINIQUITO/LIQUIDACION', 'LINEA CAPTURA', 'INFORMATIVO', 'LAYOUT', 'DOMICILIACION', 'SIN FACTURA'];
  const POR_COMPROBANTE = { pagadora: 'PAGADORA', nomina: 'CALCULO FINIQUITO/LIQUIDACION', linea_captura: 'LINEA CAPTURA', informativo: 'INFORMATIVO' };
  const POR_VIA = { layout: 'LAYOUT', domiciliado: 'DOMICILIACION' };
  // x: { tipo_comprobante, metodo_sat }; via: vía del último pago (si ya se pagó).
  // Factura → PUE/PPD (vacío si no se capturó). Recibo, estado de cuenta, otro o sin factura → LAYOUT o DOMICILIACION
  // si así se pagó; si no, SIN FACTURA. Sin tipo de comprobante (registros viejos) → vacío.
  function metodoExcel(x, via) {
    const t = x?.tipo_comprobante;
    if (!t) return '';
    if (t === 'factura') return ['PUE', 'PPD'].includes(x.metodo_sat) ? x.metodo_sat : '';
    if (POR_COMPROBANTE[t]) return POR_COMPROBANTE[t];
    return POR_VIA[via] || 'SIN FACTURA';
  }

  // «capturo» como en el Excel: el primer nombre en mayúsculas (MARCO, LETTY).
  const capturoCorto = nombre => String(nombre || '').trim().split(/\s+/)[0].toLocaleUpperCase('es-MX');

  // FOLIO FACTURA sin folio: la palabra que el Excel pone según el comprobante (PAGADORA, RECIBO, CORRIDA…).
  const FOLIO_POR_COMPROBANTE = { recibo: 'RECIBO', estado_cuenta: 'CORRIDA', linea_captura: 'LINEA CAPTURA', nomina: 'NOMINA', pagadora: 'PAGADORA',
    sin_factura: 'SIN FACTURA', informativo: 'INFORMATIVO' };
  const folioExcel = x => x?.factura_folio || (x?.tipo_comprobante && x.tipo_comprobante !== 'factura' ? FOLIO_POR_COMPROBANTE[x.tipo_comprobante] || '' : '');

  // ---------- Descarga «CXP» (fase 3, 2026-11-12): la hoja igual al Excel ----------
  // [título, ancho, color del encabezado, formato]; los mismos del archivo «CUENTAS POR PAGAR QRO 2026-2.xlsx».
  const CONTABLE = '_-* #,##0.00_-;\\-* #,##0.00_-;_-* "-"??_-;_-@';
  const COLUMNAS_CXP = [['FECHA VENCIMIENTO', 12, 'FFB4C6E7', 'd/m/yyyy'], ['TIPO DE GASTO', 15.29, 'FFF9CB9C'], ['PROVEEDOR', 21, 'FFB4C6E7'], ['BENEFICIARIO', 30.29, 'FFFF0000'],
    ['DESCRIPCION', 44.86, 'FFF9CB9C'], ['FECHA FACTURA/SOLICITUD', 15.43, 'FFF9CB9C', 'd/m/yyyy'], ['capturo', 14.14, 'FFF9CB9C'], ['FOLIO FACTURA', 18.14, 'FFFF0000'],
    ['METODO DE PAGO', 13.14, 'FFFF0000'], ['MONTO TOTAL FACTURA', 17.86, 'FFF9CB9C', CONTABLE], ['PENDIENTE', 15.71, 'FFF9CB9C', CONTABLE], ['ANTICIPO', 14.71, 'FF00FF00', CONTABLE],
    ['PAGADO', 13, 'FFF9CB9C', CONTABLE], ['CUENTA BANCARIA', 15, 'FFB4C6E7'], ['BANCO', 11.14, 'FFB4C6E7'], ['DIAS DE CREDITO', 12.71, 'FFB4C6E7'], ['CONCEPTO DE GASTO ', 15.29, 'FFF4B084'],
    ['STATUS', 12.57, 'FFF9CB9C'], ['FECHA DE PAGO', 21.29, 'FFF9CB9C', 'd/mm/yyyy'], ['OBSERVACIONES', 29.29, 'FFF9CB9C']];
  const COL_FECHAS = [0, 5, 18]; // A, F y S: llevan fecha (en la hoja se convierten a fecha de Excel)
  const cent = v => Math.round(Number(v || 0) * 100);
  const sumarDias = (f, d) => { const [a, m, dd] = f.split('-').map(Number); return new Date(Date.UTC(a, m - 1, dd + d)).toISOString().slice(0, 10); };

  // d: lo que manda /api/finanzas/cxp/formato-excel. Regresa los renglones de la hoja «CXP» (desde el renglón 3) en el
  // orden del Excel. Una celda es un valor o { formula, result } (como ExcelJS); las fechas van como 'AAAA-MM-DD'.
  // Las fórmulas son las del Excel: vencimiento =F+P, pendiente =J-M y, con varios pagos, PAGADO =a+b+c. STATUS también
  // es fórmula de los montos, para que no contradiga lo pagado aunque se corrija un monto en el archivo.
  function renglonesCxp(d, { conSucursal = false } = {}) {
    const pagos = new Map();
    for (const g of d.pagos || []) if (!g.cancelado) { if (!pagos.has(g.cxp_id)) pagos.set(g.cxp_id, []); pagos.get(g.cxp_id).push(g); }
    return (d.cuentas || []).filter(x => !x.cancelada).map((x, i) => {
      const n = i + 3, pg = (pagos.get(x.id) || []).slice().sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id));
      const totalC = cent(x.total), pagadoC = pg.reduce((t, g) => t + cent(g.monto), 0), anticipoC = pg.filter(g => g.fecha < x.fecha_documento).reduce((t, g) => t + cent(g.monto), 0);
      const ultimo = pg.length ? pg[pg.length - 1] : null;
      const dias = Number.isInteger(x.dias_credito) ? x.dias_credito : null;
      const vence = dias !== null && x.fecha_documento && sumarDias(x.fecha_documento, dias) === x.fecha_vencimiento ? { formula: `F${n}+P${n}`, result: x.fecha_vencimiento } : x.fecha_vencimiento || null;
      const pagado = pg.length > 1 ? { formula: pg.map(g => (cent(g.monto) / 100).toFixed(2).replace(/\.00$/, '')).join('+'), result: pagadoC / 100 } : pg.length ? pagadoC / 100 : null;
      const obs = [x.notas, x.orden_folio ? 'Orden ' + x.orden_folio : '', x.tipo_comprobante === 'informativo' ? 'INFORMATIVO: no se suma' : '', x.es_gasto === false ? 'No cuenta como gasto' : ''].filter(Boolean).join(' · ');
      const r = [vence, tipoGastoExcel(x.tipo_gasto), x.proveedor || '', x.beneficiario || x.proveedor || '', x.concepto || '', x.fecha_documento || null, capturoCorto(x.capturo),
        folioExcel(x), metodoExcel(x, ultimo?.metodo), totalC / 100, { formula: `J${n}-M${n}`, result: (totalC - pagadoC) / 100 }, anticipoC ? anticipoC / 100 : null, pagado,
        x.clabe || '', x.banco || '', dias ?? '', String(x.categoria || '').toLocaleUpperCase('es-MX'),
        { formula: `IF(ROUND(M${n}-J${n},2)>=0,"PAGADO",IF(M${n}>0,"PARCIAL","PENDIENTE"))`, result: statusDe(totalC, pagadoC) },
        ultimo ? ultimo.fecha : null, obs];
      if (conSucursal) r.push(x.sucursal || '');
      return r;
    });
  }
  // Hoja LISTA con las mismas columnas que la del Excel (de ahí salen las listas desplegables).
  function listasCxp(d, categorias) {
    const unicos = a => [...new Set(a.filter(v => v !== null && v !== undefined && v !== ''))];
    const cuentas = (d.cuentas || []).filter(x => !x.cancelada), orden = (a, b) => String(a).localeCompare(String(b), 'es');
    return [['PROVEEDOR', unicos(cuentas.map(x => x.proveedor)).sort(orden)], ['BENEFICIARIO', unicos(cuentas.map(x => x.beneficiario || x.proveedor)).sort(orden)],
      ['CONCEPTO DE GASTO ', unicos(categorias.map(c => String(c).toLocaleUpperCase('es-MX'))).sort(orden)], ['METODO DE PAGO', METODOS_EXCEL.slice()],
      ['DIAS CREDITO', unicos(cuentas.map(x => x.dias_credito).filter(Number.isInteger)).sort((a, b) => a - b)], ['STATUS', STATUS.slice()], ['TIPO GASTO', TIPOS_GASTO.map(t => t[2])]];
  }
  // Listas desplegables de la hoja CXP, como en el Excel: columna → columna de LISTA. STATUS no: es fórmula.
  const VALIDACIONES_CXP = [['B', 'G'], ['C', 'A'], ['D', 'B'], ['I', 'D'], ['Q', 'C']];
  // Sombreado de celdas vacías, como en el Excel (formato condicional «LEN(TRIM(celda))=0», amarillo FFD965): se pinta
  // mientras la celda está vacía y se quita sola al llenarla. Solo en los renglones con datos, de la A a la última columna.
  const COLOR_VACIA = 'FFFFD965';
  const letra = n => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
  function sombreadoVacias(renglones, columnas) {
    if (!(renglones > 0)) return null;
    return { ref: `A3:${letra(columnas)}${renglones + 2}`, rules: [{ type: 'expression', priority: 1, formulae: ['LEN(TRIM(A3))=0'],
      style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: COLOR_VACIA } } } }] };
  }

  return { TIPOS_GASTO, ponerTiposGasto, esTipoGasto, tipoGastoTexto, tipoGastoExcel, STATUS, statusDe, METODOS_EXCEL, metodoExcel, capturoCorto, folioExcel,
    COLUMNAS_CXP, COL_FECHAS, renglonesCxp, listasCxp, VALIDACIONES_CXP, COLOR_VACIA, sombreadoVacias };
});
