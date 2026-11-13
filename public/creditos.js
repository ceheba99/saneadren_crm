/* Créditos (Cuentas por pagar, fase 5, 2026-11-13). Servidor: server/creditos.js.
   Pestaña «Créditos» de Cuentas por pagar. Solo quien paga (dinero.mover).
   · Alta con todos los datos del contrato (banco, número, tasa, monto, total, apertura, plazo, mensualidad, fechas, cuenta de cargo, unidad).
   · Ficha del crédito: saldo de capital, pagado, por pagar, mensualidades (con capital, intereses e IVA si se pegó la corrida).
   · «Programar mensualidades»: iguales (N de un monto) o pegando la corrida del banco copiada de Excel.
   · «Registrar abono»: el formulario normal de gasto, ligado al crédito. «Reprogramar»: cancela las que no tienen pago.
   Las mensualidades se pagan en «Facturas y gastos» como cualquier cuenta por pagar.
   Todo dato se escapa con escaparHtml y los botones usan data-*, sin onclick en línea. */
const Creditos = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t);
  const dinero = v => formatoMoneda(Number(v || 0));
  const fecha = f => (/^\d{4}-\d{2}-\d{2}/.test(f || '') ? f.slice(0, 10).split('-').reverse().join('/') : '');
  async function pedir(ruta, opciones) {
    const res = await api(ruta, opciones), j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j.error || 'No se pudo completar'), { status: res.status });
    return j;
  }
  let DATOS = null, VER_TODOS = false, EDITANDO = null, FICHA = null, PROVS = null, CATS = null;

  async function cargar() {
    const cont = $('cr-panel'); if (!cont) return;
    cont.innerHTML = '<p class="ayuda">Cargando créditos…</p>';
    try { DATOS = await pedir('/creditos'); }
    catch (err) { if (err.status !== 401) cont.innerHTML = `<div class="aviso-error-carga" role="alert"><p>No se pudo cargar: ${esc(err.message)}</p><button type="button" class="btn btn-outline" data-cr="recargar">Reintentar</button></div>`; return; }
    pintar();
  }
  const estadoTxt = c => (c.estado === 'vigente' ? '' : c.estado === 'liquidado' ? ' · liquidado' : ' · cancelado');
  const siguienteTxt = r => (r.siguiente ? `Siguiente: ${r.siguiente.num ? 'mensualidad ' + r.siguiente.num + ', ' : ''}${fecha(r.siguiente.fecha)} · ${dinero(r.siguiente.total)}` : 'Sin mensualidades por pagar');
  function pintar() {
    const lista = DATOS.creditos.filter(c => VER_TODOS || c.estado === 'vigente');
    const filas = lista.length ? lista.map(c => { const r = c.resumen; return `
      <div class="fila-dinero${c.estado === 'vigente' ? '' : ' inactivo'}${r.vencidas ? ' vencida' : ''}">
        <div class="info"><button type="button" class="enlace enlace-fuerte" data-cr="ficha" data-id="${Number(c.id)}">${esc(c.nombre)}</button>${esc(estadoTxt(c))}
          <small>${esc(c.proveedor_nombre)} · ${esc(c.tipo_nombre)}${c.numero ? ' · No. ' + esc(c.numero) : ''}${c.tasa_anual != null ? ' · tasa ' + esc(String(c.tasa_anual)) + ' %' : ''}</small>
          <small>Pagadas ${Number(r.mensualidades_pagadas)} de ${Number(r.plazo)} · programadas ${Number(r.mensualidades_programadas)}${r.por_programar ? ' · faltan ' + Number(r.por_programar) + ' por programar' : ''}${r.vencidas ? ' · ' + Number(r.vencidas) + ' vencidas' : ''}</small>
          <small>${esc(siguienteTxt(r))}</small></div>
        <div class="montos"><b>${esc(dinero(r.saldo_capital))}</b><small>saldo de capital${r.saldo_capital_estimado ? ' (estimado)' : ''}</small></div>
        <div class="btn-group"><button type="button" class="btn btn-primario" data-cr="ficha" data-id="${Number(c.id)}">Ver crédito</button></div>
      </div>`; }).join('') : `<p class="util-45">${DATOS.creditos.length ? 'No hay créditos vigentes.' : 'Aún no hay créditos. Da de alta el primero con «+ Nuevo crédito».'}</p>`;
    $('cr-panel').innerHTML = `
      <div class="prov-cabecera"><div><h2>Créditos</h2><p class="ayuda">Bancos, financieras, automotriz, terreno… Sus mensualidades salen en «Facturas y gastos» y se pagan como cualquier cuenta por pagar.</p></div>
        <button type="button" class="btn btn-primario" data-cr="nuevo">+ Nuevo crédito</button></div>
      <label class="cc-check"><input type="checkbox" data-cr="todos"${VER_TODOS ? ' checked' : ''}> Mostrar también liquidados y cancelados</label>${filas}`;
  }

  // ---------- Alta y edición ----------
  const CAMPOS = { nombre: 'cr-nombre', proveedor_id: 'cr-proveedor', tipo: 'cr-tipo', numero: 'cr-numero', fecha_contrato: 'cr-fecha-contrato', monto: 'cr-monto', total_pagar: 'cr-total',
    enganche: 'cr-enganche', apertura: 'cr-apertura', comisiones: 'cr-comisiones', tasa_anual: 'cr-tasa', plazo_meses: 'cr-plazo', mensualidad: 'cr-mensualidad', fecha_primer_pago: 'cr-primer-pago',
    fecha_fin: 'cr-fecha-fin', cuenta_cargo: 'cr-cuenta', unidad: 'cr-unidad', factura_unidad: 'cr-factura', categoria: 'cr-categoria', pagadas_antes: 'cr-pagadas', saldo_inicial: 'cr-saldo-inicial', notas: 'cr-notas' };
  async function abrirForm(c = null) {
    try { [PROVS, CATS] = await Promise.all([pedir('/finanzas/proveedores'), pedir('/finanzas/categorias')]); } catch (err) { toast('No se pudo cargar: ' + err.message); return; }
    EDITANDO = c ? c.id : null;
    $('cr-form-titulo').textContent = c ? 'Editar ' + c.nombre : 'Nuevo crédito';
    $('cr-proveedor').innerHTML = '<option value="">Selecciona…</option>' + PROVS.filter(p => p.activo || p.id === c?.proveedor_id).map(p => `<option value="${Number(p.id)}">${esc(p.nombre)}</option>`).join('');
    $('cr-tipo').innerHTML = Object.entries(DATOS.tipos).map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    $('cr-categoria').innerHTML = CATS.map(x => `<option value="${esc(x.clave)}">${esc(x.nombre)}</option>`).join('');
    for (const [k, id] of Object.entries(CAMPOS)) $(id).value = c ? (c[k] ?? '') : '';
    if (!c) { $('cr-tipo').value = 'pyme_simple'; $('cr-categoria').value = CATS.some(x => x.clave === 'creditos') ? 'creditos' : 'otro'; $('cr-pagadas').value = '0'; }
    $('cr-domiciliado').checked = c ? !!c.domiciliado : true;
    abrirVentana('overlay-credito'); $('cr-nombre').focus();
  }
  async function guardar(boton) {
    const cuerpo = Object.fromEntries(Object.entries(CAMPOS).map(([k, id]) => [k, $(id).value.trim()]));
    cuerpo.proveedor_id = Number(cuerpo.proveedor_id) || null; cuerpo.domiciliado = $('cr-domiciliado').checked;
    for (const k of ['fecha_contrato', 'fecha_fin']) if (!cuerpo[k]) cuerpo[k] = null;
    if (!cuerpo.nombre) { toast('Escribe el nombre del crédito'); $('cr-nombre').focus(); return; }
    if (!cuerpo.proveedor_id) { toast('Elige el banco o financiera'); $('cr-proveedor').focus(); return; }
    boton.disabled = true;
    try {
      const r = await pedir('/creditos' + (EDITANDO ? '/' + EDITANDO : ''), { method: EDITANDO ? 'PUT' : 'POST', body: JSON.stringify(cuerpo) });
      $('overlay-credito').classList.remove('mostrar'); toast(EDITANDO ? 'Crédito guardado' : 'Crédito dado de alta: ahora programa sus mensualidades');
      const id = EDITANDO || r.id; EDITANDO = null;
      await cargar(); abrirFicha(id);
    } catch (err) { toast(err.message); } finally { boton.disabled = false; }
  }

  // ---------- Ficha del crédito ----------
  async function abrirFicha(id) {
    try { FICHA = await pedir('/creditos/' + id); } catch (err) { toast(err.message); return; }
    pintarFicha(); abrirVentana('overlay-credito-ficha');
  }
  function pintarFicha() {
    const c = FICHA.credito, r = c.resumen, vig = c.estado === 'vigente';
    MODO = 'iguales';
    // campo(): un dato de la ficha ya escapado (nombre y valor); vacío no se muestra.
    const campo = (k, v) => (v === null || v === undefined || v === '' ? '' : `<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`);
    const tarjeta = (t, v, cl = '') => `<div class="cc-tarjeta ${cl}"><small>${esc(t)}</small><b>${esc(v)}</b></div>`;
    const filas = FICHA.cuentas.map(x => `<tr class="${x.vencida ? 'fila-vencida' : ''}"><td>${x.tipo === 'abono' ? 'Abono' : Number(x.num)}</td><td>${esc(fecha(x.fecha))}</td>
      <td class="st-num">${x.capital != null ? esc(dinero(x.capital)) : '—'}</td><td class="st-num">${x.interes != null ? esc(dinero(x.interes)) : '—'}</td><td class="st-num">${x.iva != null ? esc(dinero(x.iva)) : '—'}</td>
      <td class="st-num"><b>${esc(dinero(x.total))}</b></td><td class="st-num">${esc(dinero(x.pagado))}</td><td>${esc(x.status)}${x.fecha_pago ? '<small class="celda-sub">' + esc(fecha(x.fecha_pago)) + '</small>' : ''}</td></tr>`).join('');
    $('cr-ficha-titulo').textContent = c.nombre + (c.estado === 'vigente' ? '' : ' (' + c.estado + ')');
    $('cr-ficha-cuerpo').innerHTML = `
      <div class="cc-tarjetas">${tarjeta('Saldo de capital' + (r.saldo_capital_estimado ? ' (estimado)' : ''), dinero(r.saldo_capital), 'aviso')}${tarjeta('Pagado en el sistema', dinero(r.pagado))}
        ${tarjeta('Programado por pagar', dinero(r.por_pagar), r.vencidas ? 'alerta' : '')}${tarjeta('Mensualidades', r.mensualidades_pagadas + ' de ' + r.plazo + ' pagadas')}</div>
      <p class="ayuda">${esc(siguienteTxt(r))}${r.por_programar ? ' · faltan ' + Number(r.por_programar) + ' mensualidades por programar' : ''}${r.saldo_capital_estimado ? ' · El saldo de capital es estimado: hay mensualidades pagadas sin desglose de capital (pega la corrida del banco para que sea exacto).' : ''}</p>
      <div class="cp-datos">${campo('Banco o financiera', c.proveedor_nombre)}${campo('Tipo', c.tipo_nombre)}${campo('Número de crédito', c.numero)}${campo('Fecha del contrato', fecha(c.fecha_contrato))}
        ${campo('Monto del crédito', dinero(c.monto))}${campo('Total a pagar', c.total_pagar != null ? dinero(c.total_pagar) : '')}${campo('Enganche o anticipo', c.enganche != null ? dinero(c.enganche) : '')}
        ${campo('Apertura', c.apertura != null ? dinero(c.apertura) : '')}${campo('Otras comisiones', c.comisiones != null ? dinero(c.comisiones) : '')}${campo('Tasa anual', c.tasa_anual != null ? c.tasa_anual + ' %' : '')}
        ${campo('Plazo', c.plazo_meses + ' meses')}${campo('Mensualidad', c.mensualidad != null ? dinero(c.mensualidad) : '')}${campo('Primera mensualidad', fecha(c.fecha_primer_pago))}${campo('Fin', fecha(c.fecha_fin))}
        ${campo(c.domiciliado ? 'Domiciliado a' : 'Cuenta de cargo', c.cuenta_cargo)}${campo('Unidad', c.unidad)}${campo('Factura de la unidad', c.factura_unidad)}${campo('Categoría', c.categoria_nombre)}
        ${campo('Pagadas antes del sistema', c.pagadas_antes ? String(c.pagadas_antes) : '')}${campo('Saldo de capital al empezar', c.saldo_inicial != null ? dinero(c.saldo_inicial) : '')}${campo('Motivo', c.motivo_estado)}</div>
      ${c.notas ? '<p class="ayuda">📝 ' + esc(c.notas) + '</p>' : ''}
      <div class="btn-group cc-acciones">${vig ? `<button type="button" class="btn btn-primario" data-cr="programar">Programar mensualidades</button><button type="button" class="btn btn-outline" data-cr="abono">Registrar abono</button>
        <button type="button" class="btn btn-outline" data-cr="reprogramar">Reprogramar</button>` : ''}<button type="button" class="btn btn-outline" data-cr="editar">Editar datos</button>
        ${vig ? '<button type="button" class="btn btn-outline" data-cr="liquidar">Marcar liquidado</button>' : '<button type="button" class="btn btn-outline" data-cr="vigente">Volver a vigente</button>'}
        ${vig && !FICHA.cuentas.length ? '<button type="button" class="btn btn-outline" data-cr="cancelar">Cancelar (capturado por error)</button>' : ''}</div>
      <div class="cr-programar" id="cr-programar" hidden>
        <div class="segmentado" role="group" aria-label="Cómo programar"><button type="button" data-cr="modo" data-modo="iguales" aria-pressed="true">Mensualidades iguales</button><button type="button" data-cr="modo" data-modo="corrida" aria-pressed="false">Pegar la corrida del banco</button></div>
        <div id="cr-modo-iguales" class="form-grid-2"><div class="campo"><label for="cr-cuantas">¿Cuántas?</label><input id="cr-cuantas" type="number" min="1" max="600" step="1" inputmode="numeric" value="${Math.min(12, r.por_programar) || 1}"><small class="ayuda">Faltan ${Number(r.por_programar)} por programar.</small></div>
          <div class="campo"><label for="cr-monto-mens">Monto de cada una</label><input id="cr-monto-mens" type="text" inputmode="decimal" value="${esc(c.mensualidad != null ? String(c.mensualidad) : '')}"></div></div>
        <div id="cr-modo-corrida" hidden><div class="campo"><label for="cr-corrida">Corrida (copia de Excel y pega aquí)</label><textarea id="cr-corrida" rows="8" placeholder="MENSUALIDAD&#9;FECHA&#9;CAPITAL&#9;INTERESES&#9;IVA INTERESES&#9;TOTAL A PAGAR"></textarea>
          <small class="ayuda">Seis columnas en este orden: mensualidad, fecha (dd/mm/aaaa), capital, intereses, IVA de intereses y total a pagar. Capital, intereses e IVA pueden ir vacíos. Los títulos y los renglones ya programados o pagados antes del sistema se brincan.</small></div></div>
        <div class="btn-group"><button type="button" class="btn btn-primario" data-cr="programar-guardar">Programar</button></div>
      </div>
      <h3 class="grupo-pagos">Mensualidades y abonos <small>${FICHA.cuentas.length}</small></h3>
      ${FICHA.cuentas.length ? `<div class="tabla-dinero-caja"><table class="tabla-dinero"><thead><tr><th>No.</th><th>Fecha</th><th class="st-num">Capital</th><th class="st-num">Intereses</th><th class="st-num">IVA</th><th class="st-num">Total</th><th class="st-num">Pagado</th><th>Status</th></tr></thead><tbody>${filas}</tbody></table></div>
        <p class="ayuda">Para pagar una mensualidad, búscala en «Facturas y gastos» y pulsa «Pagar».</p>` : '<p class="util-45">Todavía no hay mensualidades: pulsa «Programar mensualidades».</p>'}`;
  }
  let MODO = 'iguales';
  async function programar(boton) {
    const c = FICHA.credito;
    const cuerpo = MODO === 'corrida' ? { modo: 'corrida', corrida: $('cr-corrida').value } : { modo: 'iguales', cuantas: Number($('cr-cuantas').value), monto: $('cr-monto-mens').value.trim() || null };
    boton.disabled = true;
    try {
      const r = await pedir('/creditos/' + c.id + '/programar', { method: 'POST', body: JSON.stringify(cuerpo) });
      toast(`${r.programadas} ${r.programadas === 1 ? 'mensualidad programada' : 'mensualidades programadas'} (de la ${r.desde} a la ${r.hasta})`);
      await abrirFicha(c.id); cargar();
    } catch (err) { toast(err.message); } finally { boton.disabled = false; }
  }
  async function accionEstado(estado, titulo, mensaje) {
    const c = FICHA.credito;
    const motivo = estado === 'vigente' ? '' : await solicitarDialogo({ titulo, mensaje, aceptar: titulo, campo: { tipo: 'text', etiqueta: 'Motivo', requerido: 'Escribe el motivo (mínimo 5 letras)' } });
    if (motivo === null) return;
    try { await pedir('/creditos/' + c.id + '/estado', { method: 'POST', body: JSON.stringify({ estado, motivo }) }); toast('Crédito ' + (estado === 'vigente' ? 'vigente otra vez' : estado)); await abrirFicha(c.id); cargar(); }
    catch (err) { toast(err.message); }
  }

  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-cr]'); if (!b || b.tagName === 'INPUT') return;
    const acc = b.dataset.cr;
    if (acc === 'recargar') return cargar();
    if (acc === 'nuevo') return abrirForm();
    if (acc === 'ficha') return abrirFicha(Number(b.dataset.id));
    if (acc === 'guardar') return guardar(b);
    if (!FICHA) return;
    const c = FICHA.credito;
    if (acc === 'editar') { $('overlay-credito-ficha').classList.remove('mostrar'); return abrirForm(DATOS.creditos.find(x => x.id === c.id) || c); }
    if (acc === 'programar') { const p = $('cr-programar'); p.hidden = !p.hidden; if (!p.hidden) $('cr-cuantas')?.focus(); return; }
    if (acc === 'modo') {
      MODO = b.dataset.modo;
      document.querySelectorAll('[data-cr="modo"]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      $('cr-modo-iguales').hidden = MODO !== 'iguales'; $('cr-modo-corrida').hidden = MODO !== 'corrida'; return;
    }
    if (acc === 'programar-guardar') return programar(b);
    if (acc === 'abono') {
      $('overlay-credito-ficha').classList.remove('mostrar');
      return Finanzas.nuevoGasto({ 'gasto-concepto': 'Abono a capital · ' + c.nombre, credito: { id: c.id, nombre: c.nombre, proveedor_id: c.proveedor_id, categoria: c.categoria } }, async () => { await cargar(); abrirFicha(c.id); });
    }
    if (acc === 'reprogramar') {
      const motivo = await solicitarDialogo({ titulo: 'Reprogramar ' + c.nombre, mensaje: 'Se cancelan las mensualidades que no tienen ningún pago (quedan en el historial). Después programa las nuevas, por ejemplo pegando la corrida nueva del banco.', aceptar: 'Reprogramar', campo: { tipo: 'text', etiqueta: 'Motivo', requerido: 'Escribe el motivo (ej. abono a capital: bajó la mensualidad)' } });
      if (!motivo) return;
      try { const r = await pedir('/creditos/' + c.id + '/reprogramar', { method: 'POST', body: JSON.stringify({ motivo }) }); toast(`${r.canceladas} mensualidades sin pagar canceladas: ahora programa las nuevas`); await abrirFicha(c.id); cargar(); }
      catch (err) { toast(err.message); }
      return;
    }
    if (acc === 'liquidar') return accionEstado('liquidado', 'Marcar liquidado', 'Úsalo cuando ya no se debe nada. Queda registrado quién lo marcó y por qué.');
    if (acc === 'cancelar') return accionEstado('cancelado', 'Cancelar crédito', 'Solo para un crédito capturado por error (sin mensualidades). Queda en el historial.');
    if (acc === 'vigente') return accionEstado('vigente');
  });
  document.addEventListener('change', e => { if (e.target.matches('[data-cr="todos"]')) { VER_TODOS = e.target.checked; pintar(); } });
  for (const id of ['overlay-credito', 'overlay-credito-ficha']) $(id)?.querySelector('.close-btn')?.addEventListener('click', () => { $(id).classList.remove('mostrar'); if (id === 'overlay-credito') EDITANDO = null; });

  return { cargar };
})();
window.Creditos = Creditos;
