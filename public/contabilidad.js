/* Contabilidad del mes (módulo contable F1, 2026-11-11). Servidor: server/contabilidad.js y server/contabilidad-cierres.js
   (2026-11-12: cerrar el mes y el saldo inicial del banco guardado en el sistema, con rastro).
   Pestañas: Resumen (tarjetas y pendientes) y las tablas del mes —Facturas, Cobros, Gastos (con las columnas del Excel CXP
   de Dirección, en su orden, y lo que le faltaba: subtotal, IVA, XML, UUID) y Pagos—, cada una con buscador, orden por
   columna y totales. El Excel que se descarga trae exactamente las mismas columnas, más la hoja Resumen. */
const Contabilidad = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t);
  const dinero = v => formatoMoneda(Number(v || 0));
  const mesActual = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit' }).format(new Date());
  const fecha = f => (/^\d{4}-\d{2}-\d{2}/.test(f || '') ? f.slice(0, 10).split('-').reverse().join('/') : '');
  const VIA = { anticipo: 'Anticipo', transferencia: 'Transferencia', efectivo: 'Efectivo', deposito: 'Depósito', cheque: 'Cheque', tarjeta: 'Tarjeta', otro: 'Otro', nomina: 'Nómina', layout: 'Layout', pagadora: 'Pagadora', domiciliado: 'Domiciliado', linea_captura: 'Línea de captura', directo: 'Directo' };
  const COMP = { factura: 'Factura', recibo: 'Recibo', estado_cuenta: 'Estado de cuenta', linea_captura: 'Línea de captura', nomina: 'Nómina', pagadora: 'Pagadora', sin_factura: 'Sin factura', otro: 'Otro' };
  // Columnas: [llave, título, ancho en Excel, tipo] · tipo: f fecha, d dinero, s estado (chip), v vía, c comprobante, n número.
  const TABLAS = {
    // Flujo de banco: tal cual el Excel «flujo banco» de Dirección (A–Z, 2026-11-12), llenado solo con cobros confirmados,
    // pagos y anticipos (la entrega sale y el reintegro entra; lo pagado con el anticipo no sale otra vez). A, B y C son
    // marcas S / FALTA / NA; K es el número seguido de las salidas. Al final, 3 columnas del sistema.
    flujo: { titulo: 'Flujo de banco', hoja: 'Flujo de banco', cols: [['marca_transf', 'TRANSFERENCIA', 14, 's'], ['marca_oc', 'O.C O REQ', 10, 's'], ['marca_comp', 'COMPROBANTE', 13, 's'], ['fecha', 'FECHA', 11, 'f'],
      ['concepto_banco', 'CONCEPTO', 30], ['clabe', 'CLABE BENEFICIARIO', 20], ['beneficiario', 'NOMBRE BENEFICIARIO', 26], ['egreso', 'EGRESOS', 14, 'd'], ['ingreso', 'INGRESOS', 14, 'd'], ['saldo', 'SALDO', 15, 'S'],
      ['consecutivo', '# TRANSFERENCIA', 10], ['metodo', 'MÉTODO DE PAGO', 12, 's'], ['cfdi', 'PPD/PUE COMPROBANTE FISCAL', 34], ['complemento', 'COMPLEMENTO PAGO COMPROBANTE', 30, 's'], ['tercero', 'PROVEEDOR/CLIENTE', 28],
      ['concepto', 'CONCEPTO ', 28], ['observaciones', 'OBSERVACIONES', 28], ['cfdi_monto', 'MONTO REAL CFDI', 14, 'd'], ['no_deducible', 'NO DEDUCIBLES', 14, 'd'], ['por_comprobar', 'X COMPROBAR / EXCEDENTE', 14, 'd'],
      ['cuenta_abono', 'CUENTA ABONO', 13], ['proyecto', 'PROYECTO', 9], ['unidad', 'UNIDAD', 12], ['tipo_gasto', 'TIPO DE GASTO', 20], ['cuenta_tercero', 'CUENTA BANCARIA PROVEEDOR/CL', 26],
      ['observaciones_z', 'OBSERVACIONES', 24], ['revisar', 'REVISAR (SISTEMA)', 30, 's'], ['cuenta', 'CUENTA DE BANCO (SISTEMA)', 22], ['datos_sistema', 'DATOS DEL SISTEMA', 40]] },
    gastos: { titulo: 'Gastos (CXP)', hoja: 'CXP', cols: [['vence', 'FECHA VENCIMIENTO', 13, 'f'], ['proveedor', 'PROVEEDOR', 28], ['beneficiario', 'BENEFICIARIO', 24], ['concepto', 'DESCRIPCIÓN', 32],
      ['fecha', 'FECHA FACTURA', 12, 'f'], ['capturo', 'CAPTURÓ', 16], ['folio', 'FOLIO FACTURA', 13], ['via', 'VÍA DE PAGO', 14, 'v'], ['total', 'MONTO TOTAL', 14, 'd'], ['pendiente', 'PENDIENTE', 14, 'd'],
      ['pagado', 'PAGADO', 14, 'd'], ['dias_credito', 'DÍAS DE CRÉDITO', 10, 'n'], ['categoria', 'CONCEPTO DE GASTO', 20], ['status', 'STATUS', 11, 's'], ['fecha_pago', 'FECHA DE PAGO', 12, 'f'],
      ['observaciones', 'OBSERVACIONES', 30], ['rfc', 'RFC', 15], ['comprobante', 'COMPROBANTE', 14, 'c'], ['subtotal', 'SUBTOTAL', 14, 'd'], ['iva', 'IVA', 13, 'd'], ['iva_origen', 'IVA DE', 13],
      ['xml', 'XML', 7, 's'], ['uuid', 'FOLIO FISCAL (UUID)', 38], ['sucursal', 'SUCURSAL', 9]] },
    facturas: { titulo: 'Facturas emitidas', hoja: 'Facturas emitidas', cols: [['fecha', 'FECHA', 11, 'f'], ['tipo', 'TIPO', 18], ['folio', 'SERIE-FOLIO', 13], ['cliente', 'CLIENTE', 32], ['rfc', 'RFC', 15],
      ['orden', 'ORDEN', 20], ['metodo', 'MÉTODO', 8], ['forma', 'FORMA', 7], ['subtotal', 'SUBTOTAL', 14, 'd'], ['iva', 'IVA', 13, 'd'], ['total', 'TOTAL', 14, 'd'], ['estatus', 'ESTATUS', 13, 's'],
      ['cancelada', 'CANCELADA EL', 12, 'f'], ['uuid', 'FOLIO FISCAL (UUID)', 38], ['sucursal', 'SUCURSAL', 9]] },
    cobros: { titulo: 'Cobros', hoja: 'Cobros', cols: [['fecha', 'FECHA', 11, 'f'], ['cliente', 'CLIENTE', 32], ['orden', 'ORDEN', 20], ['factura', 'FACTURA', 12], ['monto', 'MONTO', 14, 'd'], ['metodo', 'VÍA', 14, 'v'],
      ['referencia', 'REFERENCIA', 20], ['estado', 'ESTADO', 14, 's'], ['sucursal', 'SUCURSAL', 9]] },
    pagos: { titulo: 'Pagos a proveedores', hoja: 'Pagos a proveedores', cols: [['fecha', 'FECHA', 11, 'f'], ['proveedor', 'PROVEEDOR', 28], ['concepto', 'CONCEPTO', 32], ['folio', 'FOLIO', 12], ['monto', 'MONTO', 14, 'd'],
      ['metodo', 'VÍA', 14, 'v'], ['referencia', 'REFERENCIA', 20], ['cuenta', 'CUENTA DE SALIDA', 20]] },
  };
  const CHIP = { S: 'pagada', NA: '', DOMICILIADO: '', LAYOUT: '', CN01: 'pagada', PUE: 'pagada', 'PPD/CP': 'parcial', 'NO APLICA': '', FALTA: 'vencida', 'Pedirlo al proveedor': 'parcial',  PAGADO: 'pagada', PARCIAL: 'parcial', PENDIENTE: 'vencida', Confirmado: 'pagada', 'Por confirmar': 'por-confirmar', timbrada: 'pagada', cancelada: 'vencida', cancelacion_solicitada: 'parcial', Sí: 'pagada', Falta: 'vencida' };
  const textoDe = (v, tipo) => (tipo === 'f' ? fecha(v) : tipo === 'v' ? VIA[v] || v || '' : tipo === 'c' ? COMP[v] || v || '' : tipo === 'd' || tipo === 'S' ? dinero(v) : String(v ?? ''));
  let listo = false, consulta = 0, DATOS = null, PESTANA = 'resumen', CUENTA = ''; // CUENTA: '' todas, '0' sin cuenta, o el id
  const nombreCuenta = c => (c.id ? [c.nombre, c.banco, c.terminacion ? '••' + c.terminacion : ''].filter(Boolean).join(' · ') : 'Sin cuenta'); // texto plano: se escapa al pintarlo
  // Saldo inicial del banco (2026-11-12): se guarda en el sistema por mes y sucursal, con quién y cuándo; si nadie lo
  // escribió, es el que calcula el CRM. Ya no se guarda en el navegador.
  // Filas del flujo con el saldo corrido desde el saldo inicial.
  function flujoConSaldo() {
    const ini = Number(DATOS.saldo_inicial || 0); let saldo = ini;
    return { ini, filas: (DATOS.flujo || []).map(f => { saldo = Math.round((saldo + Number(f.ingreso) - Number(f.egreso)) * 100) / 100; return { ...f, saldo }; }), fin: () => saldo };
  }
  const estado = {}; // por tabla: { q, k, dir }
  const conBoton = async (b, fn) => { if (b.disabled) return; b.disabled = true; try { await fn(); } finally { b.disabled = false; } };
  const pedir = async (ruta, opciones) => { const res = await api(ruta, opciones), j = await res.json().catch(() => ({})); if (!res.ok) throw new Error(j.error || 'No se pudo completar'); return j; };
  const cuando = t => (t ? fecha(t) + ' ' + String(t).slice(11, 16) : '');
  const consultaDe = (cuenta = CUENTA) => { const q = new URLSearchParams({ mes: $('ct-mes').value }); if ($('ct-sucursal').value) q.set('sucursal', $('ct-sucursal').value); if (cuenta !== '') q.set('cuenta', cuenta); return q; };
  const tarjeta = (t, v, sub, malo) => `<div class="logs-tarjeta${malo ? ' logs-alerta' : ''}"><b>${esc(v)}</b><span>${esc(t)}</span>${sub ? `<small class="util-45">${esc(sub)}</small>` : ''}</div>`;

  async function cargar() {
    if (!$('vista-contabilidad')) return;
    if (!listo) preparar();
    const turno = ++consulta, cont = $('ct-resumen');
    cont.innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    let d;
    try { const res = await api('/contabilidad/excel?' + consultaDe()); d = await res.json(); if (!res.ok) throw new Error(d.error); }
    catch (e) { if (turno === consulta) cont.innerHTML = '<p class="aviso-error-carga">' + esc(e.message) + '</p>'; return; }
    if (turno !== consulta) return;
    DATOS = d;
    pintar();
  }
  function pintar() {
    const d = DATOS, n = k => (d[k] || []).length;
    const pestanas = [['resumen', 'Resumen'], ...Object.entries(TABLAS).map(([k, t]) => [k, `${t.titulo} (${n(k)})`]), ...(window.Conciliacion ? [['conciliacion', 'Conciliación bancaria']] : [])];
    $('ct-resumen').innerHTML = `${cierreHtml(d.cierre)}<div class="ct-pestanas" role="tablist">${pestanas.map(([k, t]) => `<button type="button" role="tab" class="ct-pestana${k === PESTANA ? ' activa' : ''}" aria-selected="${k === PESTANA}" data-ct-pestana="${esc(k)}">${esc(t)}</button>`).join('')}</div>
      <div id="ct-contenido">${PESTANA === 'resumen' ? resumenHtml(d.resumen) : PESTANA === 'conciliacion' ? '<div id="cc-cuerpo"></div>' : tablaHtml(PESTANA)}</div>`;
    // Conciliación bancaria (F4): la dibuja public/conciliacion.js con el mes elegido.
    if (PESTANA === 'conciliacion') window.Conciliacion.pintar($('cc-cuerpo'), $('ct-mes').value);
  }
  // Mes cerrado (2026-11-12): cerrado, solo Dirección cambia cobros, pagos, anticipos y saldo de ese mes.
  function cierreHtml(c) {
    if (!c) return '';
    const sucs = c.sucursales || [], varias = sucs.length > 1;
    const linea = s => `${varias ? `<b>${esc(s.clave || s.nombre)}:</b> ` : ''}${s.cerrado ? `🔒 cerrado por ${esc(s.ultimo.usuario)} el ${esc(cuando(s.ultimo.fecha))}` : '🔓 abierto' + (s.ultimo ? ` (reabierto por ${esc(s.ultimo.usuario)} el ${esc(cuando(s.ultimo.fecha))}: ${esc(s.ultimo.motivo)})` : '')}`
      + (s.cerrado && c.puede_reabrir ? ` <button type="button" class="btn btn-outline btn-chico" data-ct-reabrir="${Number(s.sucursal_id)}">Reabrir</button>` : '');
    const cerrar = c.puede_cerrar && c.terminado && !c.cerrado ? `<button type="button" class="btn btn-outline btn-chico" id="ct-cerrar-mes">🔒 Cerrar el mes${varias ? ' (todas las sucursales que ves)' : ''}</button>` : '';
    return `<div class="apartado ct-cierre"><p>${sucs.map(linea).join('<br>') || 'Sin sucursal'}</p>
      <p class="ayuda">${c.cerrado || c.alguno_cerrado ? (c.es_direccion ? 'Mes cerrado: tú (Dirección) todavía puedes corregir; cada cambio queda en la bitácora.' : 'Mes cerrado: los cobros, pagos, anticipos y el saldo inicial de este mes solo los cambia Dirección.')
        : c.terminado ? 'Al cerrar el mes, solo Dirección podrá registrar, corregir o cancelar movimientos con fecha de este mes.' : 'El mes todavía no termina: se cierra cuando ya pasó.'} ${cerrar}</p></div>`;
  }
  // Saldo inicial guardado en el sistema, por sucursal y cuenta de banco: se cambia con una sola sucursal y una cuenta
  // elegidas; se ve quién lo cambió y el anterior. Si no se escribió, es el calculado (encadenado desde el último escrito).
  const nombreMes = m => { const [a, n] = String(m).split('-').map(Number); return n ? ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][n - 1] + ' ' + a : ''; };
  function saldoHtml(fl) {
    const sis = DATOS.saldos_iniciales || [], c = DATOS.cierre || {};
    const intro = 'Solo entra el dinero que ya se movió: cobros <b>confirmados</b> y pagos registrados.';
    if (sis.length !== 1) return `<p class="ayuda">${intro} Saldo inicial: la suma de ${sis.length} saldo(s) (${sis.filter(s => s.saldo || s.escrito).map(s => `${esc(s.clave || s.nombre)} ${esc(s.cuenta)} ${esc(dinero(s.saldo))}`).join(' · ') || 'todos en cero'}). Para escribirlo, elige arriba una sucursal y una cuenta.</p>`;
    const s = sis[0], cerrado = (c.sucursales || []).some(x => x.sucursal_id === s.sucursal_id && x.cerrado), bloqueado = !c.puede_saldo || (cerrado && !c.es_direccion);
    const h = s.historial || [], ult = h[0], ant = h[1];
    const origen = s.escrito ? '' : s.viene_de ? `Calculado: el saldo escrito en ${esc(nombreMes(s.viene_de))} más lo que se movió desde entonces.` : 'Calculado por el CRM con todo lo que se movió antes de este mes.';
    const rastro = ult ? `Lo cambió ${esc(ult.usuario)} el ${esc(cuando(ult.fecha))}${ant ? `; antes era ${ant.saldo == null ? 'el calculado' : esc(dinero(ant.saldo))}` : `; antes era el calculado (${esc(dinero(s.crm))})`}.` : '';
    return `<p class="ayuda">${intro} Si el saldo de <b>${esc(s.cuenta)}</b> al inicio del mes es otro, escríbelo y guárdalo: queda para todos y con rastro, y los meses siguientes arrancan de él.
      <label class="ct-saldo">Saldo inicial del banco <input type="number" step="0.01" id="ct-saldo-inicial" value="${Number(fl.ini)}"${bloqueado ? ' disabled' : ''}></label>
      ${bloqueado ? (cerrado ? '🔒 Mes cerrado: solo Dirección lo cambia.' : '') : `<button type="button" class="btn btn-outline btn-chico" id="ct-saldo-guardar">Guardar saldo</button>${s.escrito ? ` <button type="button" class="btn btn-outline btn-chico" id="ct-saldo-crm">Usar el calculado (${esc(dinero(s.crm))})</button>` : ''}`}
      ${origen || rastro ? `<br><small class="util-45">${[origen, rastro].filter(Boolean).join(' ')}</small>` : ''}</p>`;
  }
  // Selector de cuenta de banco (las de Conciliación › cuentas, y «Sin cuenta» para lo que no se sabe de qué cuenta salió).
  function cuentaHtml() {
    const cs = DATOS.cuentas || [];
    return `<label class="ct-saldo">Cuenta de banco <select id="ct-cuenta"><option value="">Todas las cuentas</option>${cs.map(c => `<option value="${Number(c.id)}"${String(c.id) === CUENTA ? ' selected' : ''}>${esc(nombreCuenta(c))} (${Number(c.movimientos)})</option>`).join('')}</select></label>
      ${cs.length < 2 ? '<small class="util-45">Para llevar un flujo por cuenta (Santander, Banorte…), da de alta las cuentas en la pestaña Conciliación bancaria.</small>' : ''}`;
  }
  function resumenHtml(r) {
    const p = r.pendientes, pend = [
      p.gastos_sin_xml ? `${Number(p.gastos_sin_xml)} gasto(s) con factura sin su XML (súbelo en Cuentas por pagar)` : '',
      p.gastos_iva_estimado ? `${Number(p.gastos_iva_estimado)} gasto(s) con IVA estimado al 16 % (falta capturar el real o subir el XML)` : '',
      p.cobros_por_confirmar ? `${Number(p.cobros_por_confirmar)} cobro(s) por confirmar (no cuentan como cobrados hasta confirmarlos)` : '',
      p.facturas_canceladas ? `${Number(p.facturas_canceladas)} factura(s) cancelada(s) en el mes (no cuentan en lo facturado)` : '',
      p.anticipos_abiertos ? (() => { const con = (p.anticipos || []).filter(a => a.por_comprobar > 0), sin = Number(p.anticipos_abiertos) - con.length;
        return `${Number(p.anticipos_abiertos)} anticipo(s) sin cerrar` + (con.length ? `: ${dinero(p.anticipos_por_comprobar)} por comprobar (${con.map(a => a.persona + ' ' + dinero(a.por_comprobar)).join(', ')})` : '') // sin HTML: se escapa al pintar la lista
          + (sin ? `${con.length ? '; ' : ': '}${sin} ya comprobado(s), solo falta cerrarlo(s)` : '') + ' · se revisan en Cuentas por pagar › Anticipos'; })() : ''].filter(Boolean);
    return `${r.entorno !== 'prod' ? `<p class="aviso-error-carga">La facturación está en ${r.entorno === 'demo' ? 'demostración' : 'pruebas (sandbox)'}: lo facturado aquí no tiene validez fiscal.</p>` : ''}
      <section class="apartado"><h3 class="util-13">Ingresos</h3><div class="logs-tarjetas">${tarjeta('Facturado (sin IVA)', dinero(r.ingresos.facturado_subtotal), r.ingresos.facturas + ' factura(s)')}${tarjeta('IVA facturado', dinero(r.ingresos.facturado_iva))}
        ${tarjeta('Total facturado', dinero(r.ingresos.facturado_total))}${tarjeta('Cobrado confirmado', dinero(r.ingresos.cobrado), 'IVA cobrado ' + dinero(r.ingresos.cobrado_iva))}
        ${tarjeta('Cobros por confirmar', dinero(r.ingresos.por_confirmar), null, r.ingresos.por_confirmar > 0)}${tarjeta('Complementos de pago', String(r.ingresos.complementos))}</div></section>
      <section class="apartado"><h3 class="util-13">Egresos</h3><div class="logs-tarjetas">${tarjeta('Gastos del mes (con IVA)', dinero(r.egresos.gastos_total), r.egresos.gastos + ' gasto(s)')}${tarjeta('IVA de los gastos', dinero(r.egresos.gastos_iva), r.egresos.gastos_iva_estimado ? 'de ello ' + dinero(r.egresos.gastos_iva_estimado) + ' estimado' : '', r.egresos.gastos_iva_estimado > 0)}
        ${tarjeta('Pagado a proveedores', dinero(r.egresos.pagado), 'IVA pagado ' + dinero(r.egresos.pagado_iva))}
        ${r.egresos.anticipos_entregados || r.egresos.anticipos_reintegrados ? tarjeta('Anticipos entregados', dinero(r.egresos.anticipos_entregados), 'regresaron ' + dinero(r.egresos.anticipos_reintegrados)) : ''}</div></section>
      <section class="apartado"><h3 class="util-13">IVA del mes (apoyo para el contador)</h3><div class="logs-tarjetas">${tarjeta('Según facturas: facturado − gastos', dinero(Math.abs(r.iva.segun_facturas)), r.iva.segun_facturas >= 0 ? 'a cargo' : 'a favor')}
        ${tarjeta('Según el dinero: cobrado − pagado', dinero(Math.abs(r.iva.segun_flujo)), r.iva.segun_flujo >= 0 ? 'a cargo' : 'a favor')}</div></section>
      <section class="apartado"><h3 class="util-13">Pendientes de comprobar</h3>${pend.length ? '<ul class="ct-pendientes">' + pend.map(t => '<li>⚠ ' + esc(t) + '</li>').join('') + '</ul>' : '<p class="util-45">Nada pendiente de comprobar este mes. 🎉</p>'}
      <p class="ayuda">${Number(r.xml_disponibles)} XML disponibles para descargar este mes.</p></section>`;
  }
  // Filas de una tabla con el buscador y el orden aplicados.
  function filasDe(k) {
    const t = TABLAS[k], e = estado[k] || (estado[k] = { q: '', k: k === 'flujo' ? 'fecha' : t.cols[0][0], dir: 1 }), q = e.q.trim().toLowerCase();
    const base = k === 'flujo' ? flujoConSaldo().filas : (DATOS[k] || []);
    const tipo = (t.cols.find(c => c[0] === e.k) || [])[3];
    const filas = base.filter(f => !q || t.cols.some(([c, , , tp]) => textoDe(f[c], tp).toLowerCase().includes(q)));
    return filas.sort((a, b) => { const x = a[e.k], y = b[e.k]; const r = tipo === 'd' || tipo === 'n' ? Number(x || 0) - Number(y || 0) : String(x ?? '').localeCompare(String(y ?? ''), 'es'); return r * e.dir; });
  }
  function tablaHtml(k) {
    const t = TABLAS[k], e = estado[k] || (estado[k] = { q: '', k: k === 'flujo' ? 'fecha' : t.cols[0][0], dir: 1 }), filas = filasDe(k);
    const celda = (f, [c, , , tp]) => {
      const v = textoDe(f[c], tp);
      if (tp === 's') return v ? `<td><span class="estado-cxc ${esc(CHIP[f[c]] ?? 'por-confirmar')}">${esc(v)}</span></td>` : '<td></td>';
      return `<td class="${tp === 'd' || tp === 'n' || tp === 'S' ? 'ct-num' : ''}">${esc(v)}</td>`;
    };
    const fl = k === 'flujo' ? flujoConSaldo() : null;
    const totales = t.cols.map(([c, , , tp]) => (tp === 'd' ? dinero(filas.reduce((s, f) => s + Number(f[c] || 0), 0)) : tp === 'S' && fl ? dinero(fl.fin()) : ''));
    const cabeza = !fl ? '' : (() => { const ing = (DATOS.flujo || []).reduce((s, f) => s + Number(f.ingreso), 0), egr = (DATOS.flujo || []).reduce((s, f) => s + Number(f.egreso), 0), pc = (DATOS.flujo || []).filter(f => f.revisar).length;
      const escrito = (DATOS.saldos_iniciales || []).some(x => x.escrito);
      return `<div class="logs-tarjetas">${tarjeta('Saldo inicial', dinero(fl.ini), escrito ? 'escrito en el sistema' : 'calculado por el CRM')}${tarjeta('Ingresos (cobros y reintegros)', dinero(ing))}${tarjeta('Egresos (pagos y anticipos)', dinero(egr))}
        ${tarjeta('Saldo final', dinero(fl.fin()))}${tarjeta('Movimientos por revisar', String(pc), 'falta XML, complemento o comprobar', pc > 0)}</div>
        ${cuentaHtml()}${saldoHtml(fl)}`; })();
    return `${cabeza}<div class="filtros"><input type="search" id="ct-buscar" data-ct-tabla="${esc(k)}" value="${esc(e.q)}" placeholder="Buscar en ${esc(t.titulo.toLowerCase())}…" aria-label="Buscar en la tabla"><span class="util-45">${Number(filas.length)} renglón(es)</span></div>
      ${filas.length ? `<div class="tabla-scroll ct-tabla-scroll"><table class="tabla-resumen ct-tabla"><thead><tr>${t.cols.map(([c, titulo]) => `<th><button type="button" class="ct-orden" data-ct-orden="${esc(c)}">${esc(titulo)}${e.k === c ? (e.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`).join('')}</tr></thead>
        <tbody>${filas.map(f => `<tr>${t.cols.map(c => celda(f, c)).join('')}</tr>`).join('')}</tbody>
        <tfoot><tr>${totales.map((v, i) => `<td class="ct-num">${i === 0 ? 'TOTAL' : esc(v)}</td>`).join('')}</tr></tfoot></table></div>`
      : '<p class="util-45">No hay renglones este mes.</p>'}`;
  }

  async function excel() {
    let ExcelJS; try { ExcelJS = await Finanzas.cargarExcelJS(); } catch (e) { toast(e.message); return; }
    let d; try { const res = await api('/contabilidad/excel?' + consultaDe()); d = await res.json(); if (!res.ok) throw new Error(d.error); } catch (e) { toast(e.message); return; }
    const wb = new ExcelJS.Workbook(); wb.creator = 'Saneadren CRM';
    const r = d.resumen, R = wb.addWorksheet('Resumen');
    R.columns = [{ width: 46 }, { width: 18 }];
    [['Contabilidad del mes', d.resumen.mes], [], ['INGRESOS'], ['Facturado sin IVA', r.ingresos.facturado_subtotal], ['IVA facturado', r.ingresos.facturado_iva], ['Total facturado', r.ingresos.facturado_total],
      ['Cobrado confirmado', r.ingresos.cobrado], ['IVA de lo cobrado', r.ingresos.cobrado_iva], ['Cobros por confirmar', r.ingresos.por_confirmar], [], ['EGRESOS'], ['Gastos del mes (con IVA)', r.egresos.gastos_total],
      ['IVA de los gastos', r.egresos.gastos_iva], ['  de ello, estimado al 16 %', r.egresos.gastos_iva_estimado], ['Pagado a proveedores', r.egresos.pagado], ['IVA de lo pagado', r.egresos.pagado_iva],
      ['Anticipos entregados', r.egresos.anticipos_entregados || 0], ['Anticipos regresados (reintegros)', r.egresos.anticipos_reintegrados || 0], ['Anticipos abiertos por comprobar', r.pendientes.anticipos_por_comprobar || 0], [],
      ['IVA SEGÚN FACTURAS (facturado − gastos)', r.iva.segun_facturas], ['IVA SEGÚN EL DINERO (cobrado − pagado)', r.iva.segun_flujo], [], ['Cifras de apoyo: qué se declara lo decide el contador.']]
      .forEach((f, i) => { const row = R.addRow(f); if (typeof f[1] === 'number') row.getCell(2).numFmt = '"$"#,##0.00'; if (f.length === 1 || i === 0) row.font = { bold: true }; });
    // Mismas columnas y orden que en pantalla; fechas como fecha y montos como número (para sumar en Excel), con fila TOTAL.
    // Flujo de banco: una hoja por cuenta con movimientos (como la hoja «STD» de Dirección); si no hay cuentas, una sola.
    const conMov = (d.cuentas || []).filter(c => c.movimientos > 0), usados = new Set();
    const nombreHoja = t => { let n = String(t).replace(/[\\/*?:[\]]/g, ' ').slice(0, 31).trim() || 'Flujo', i = 2; while (usados.has(n.toLowerCase())) n = n.slice(0, 28) + ' ' + i++; usados.add(n.toLowerCase()); return n; };
    const flujos = conMov.length > 1 || (conMov.length === 1 && conMov[0].id) ? await Promise.all(conMov.map(async c => ({ hoja: 'Flujo ' + (c.id ? c.nombre : 'sin cuenta'), d: await pedir('/contabilidad/flujo?' + consultaDe(String(c.id))) })))
      : [{ hoja: 'Flujo de banco', d: await pedir('/contabilidad/flujo?' + consultaDe('')) }];
    for (const fl of flujos) hojaFlujo(wb, nombreHoja(fl.hoja), fl.d);
    for (const [k, t] of Object.entries(TABLAS)) {
      if (k === 'flujo') continue;
      const ws = wb.addWorksheet(t.hoja, { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = t.cols.map(([c, titulo, ancho, tp]) => ({ header: titulo, key: c, width: ancho, style: tp === 'd' || tp === 'S' ? { numFmt: '"$"#,##0.00' } : tp === 'f' ? { numFmt: 'dd/mm/yyyy' } : {} }));
      ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6B103' } };
      const filasHoja = d[k] || [];
      for (const f of filasHoja) ws.addRow(Object.fromEntries(t.cols.map(([c, , , tp]) => [c, tp === 'f' ? (f[c] ? new Date(f[c].slice(0, 10) + 'T12:00:00Z') : null) : tp === 'd' || tp === 'S' ? Number(f[c] || 0) : tp === 'v' || tp === 'c' ? textoDe(f[c], tp) : f[c]])));
      if ((d[k] || []).length) {
        const n = (d[k] || []).length + 1, fila = ws.addRow({});
        t.cols.forEach(([c, , , tp], i) => { if (i === 0) fila.getCell(1).value = 'TOTAL'; else if (tp === 'd') { const col = ws.getColumn(i + 1).letter; fila.getCell(i + 1).value = { formula: `SUM(${col}2:${col}${n})` }; } });
        fila.font = { bold: true };
      }
    }
    saveAs(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `contabilidad_${$('ct-mes').value}.xlsx`);
  }
  // Una hoja del flujo tal cual la de Dirección: encabezado, el saldo inicial arriba (columna J), los movimientos con su saldo
  // corrido y, al final, los totales de egresos, ingresos, saldo final y monto real CFDI.
  function hojaFlujo(wb, nombre, fd) {
    const t = TABLAS.flujo, ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 2 }] });
    ws.columns = t.cols.map(([c, titulo, ancho, tp]) => ({ header: titulo, key: c, width: ancho, style: tp === 'd' || tp === 'S' ? { numFmt: '"$"#,##0.00' } : tp === 'f' ? { numFmt: 'dd/mm/yyyy' } : {} }));
    ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6B103' } };
    const ini = Number(fd.saldo_inicial || 0); let saldo = ini;
    const inicio = ws.addRow({ concepto_banco: 'SALDO INICIAL', saldo: ini }); inicio.font = { bold: true };
    for (const f of fd.flujo || []) {
      saldo = Math.round((saldo + Number(f.ingreso) - Number(f.egreso)) * 100) / 100;
      ws.addRow(Object.fromEntries(t.cols.map(([c, , , tp]) => [c, c === 'saldo' ? saldo : tp === 'f' ? (f[c] ? new Date(f[c].slice(0, 10) + 'T12:00:00Z') : null) : tp === 'd' ? Number(f[c] || 0) : tp === 'v' || tp === 'c' ? textoDe(f[c], tp) : f[c]])));
    }
    const n = (fd.flujo || []).length + 2, col = k => ws.getColumn(t.cols.findIndex(c => c[0] === k) + 1).letter;
    ws.addRow({});
    const tot = ws.addRow({ concepto_banco: 'TOTAL' });
    for (const k of ['egreso', 'ingreso', 'cfdi_monto', 'no_deducible', 'por_comprobar']) tot.getCell(col(k)).value = { formula: `SUM(${col(k)}3:${col(k)}${n})` };
    tot.getCell(col('saldo')).value = { formula: `${col('saldo')}2+${col('ingreso')}${n + 2}-${col('egreso')}${n + 2}` };
    tot.font = { bold: true };
  }
  async function xml() {
    try { const res = await api('/contabilidad/xml?' + consultaDe()); if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'No se pudo descargar'); saveAs(await res.blob(), `xml_${$('ct-mes').value}.tar`); }
    catch (e) { toast(e.message); }
  }

  const sucursalSaldo = () => (DATOS.saldos_iniciales || [])[0]?.sucursal_id;
  async function guardarSaldo(valor) {
    const s = (DATOS.saldos_iniciales || [])[0] || {};
    try { await pedir('/contabilidad/saldo-inicial', { method: 'POST', body: JSON.stringify({ mes: $('ct-mes').value, sucursal: sucursalSaldo(), cuenta: s.cuenta_id ?? 0, saldo: valor === null ? null : String(valor).trim() }) }); toast('Saldo inicial guardado'); await cargar(); }
    catch (e) { toast(e.message); }
  }
  async function cerrarMes() {
    const mes = $('ct-mes').value;
    const ok = await solicitarDialogo({ titulo: 'Cerrar el mes', mensaje: `Después de cerrar ${mes}, solo Dirección podrá registrar, corregir o cancelar cobros, pagos y anticipos con fecha de ese mes, y cambiar su saldo inicial. Reabrirlo también es solo de Dirección.`, aceptar: 'Cerrar el mes' });
    if (!ok) return;
    try { await pedir('/contabilidad/cierre', { method: 'POST', body: JSON.stringify({ mes, sucursal: $('ct-sucursal').value || undefined }) }); toast('Mes cerrado'); await cargar(); }
    catch (e) { toast(e.message); }
  }
  async function reabrir(sucursal) {
    const motivo = await solicitarDialogo({ titulo: 'Reabrir el mes', mensaje: 'Al reabrirlo, quien tenga permiso podrá volver a registrar y cancelar movimientos de este mes. Queda en la bitácora con tu motivo.', aceptar: 'Reabrir', campo: { tipo: 'text', etiqueta: 'Motivo', requerido: 'Escribe el motivo (mínimo 5 letras)' } });
    if (!motivo) return;
    try { await pedir('/contabilidad/cierre/reabrir', { method: 'POST', body: JSON.stringify({ mes: $('ct-mes').value, sucursal, motivo }) }); toast('Mes reabierto'); await cargar(); }
    catch (e) { toast(e.message); }
  }

  function preparar() {
    listo = true;
    $('ct-mes').value = mesActual();
    const sucs = window.Sucursales?.datos?.sucursales || [];
    $('ct-sucursal').innerHTML = '<option value="">Todas las sucursales</option>' + sucs.map(s => `<option value="${Number(s.id)}">${esc(s.nombre)}</option>`).join('');
    $('ct-sucursal').hidden = sucs.length < 2;
    $('ct-mes').addEventListener('change', cargar); $('ct-sucursal').addEventListener('change', () => { CUENTA = ''; cargar(); });
    $('ct-excel').addEventListener('click', e => conBoton(e.currentTarget, excel));
    $('ct-xml').addEventListener('click', e => conBoton(e.currentTarget, xml));
    $('ct-resumen').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !DATOS) return;
      if (b.dataset.ctPestana) { PESTANA = b.dataset.ctPestana; pintar(); }
      else if (b.id === 'ct-saldo-guardar' || b.id === 'ct-saldo-crm') conBoton(b, () => guardarSaldo(b.id === 'ct-saldo-crm' ? null : $('ct-saldo-inicial').value));
      else if (b.id === 'ct-cerrar-mes') conBoton(b, cerrarMes);
      else if (b.dataset.ctReabrir) conBoton(b, () => reabrir(Number(b.dataset.ctReabrir)));
      else if (b.dataset.ctOrden) { const s = estado[PESTANA]; s.dir = s.k === b.dataset.ctOrden ? -s.dir : 1; s.k = b.dataset.ctOrden; $('ct-contenido').innerHTML = tablaHtml(PESTANA); }
    });
    let espera;
    $('ct-resumen').addEventListener('change', e => { if (e.target.id === 'ct-cuenta') { CUENTA = e.target.value; cargar(); } });
    $('ct-resumen').addEventListener('input', e => {
      if (e.target.id !== 'ct-buscar') return;
      const k = e.target.dataset.ctTabla; estado[k].q = e.target.value; clearTimeout(espera);
      espera = setTimeout(() => { $('ct-contenido').innerHTML = tablaHtml(k); const i = $('ct-buscar'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250);
    });
  }
  return { cargar };
})();
window.Contabilidad = Contabilidad;
