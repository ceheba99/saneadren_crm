/* Cuentas por cobrar y por pagar. Usa api(), toast(), escaparHtml(), formatoMoneda(),
   solicitarDialogo(), abrirVentana(), descargarCSV(), abrirFicha() y USUARIO_ACTUAL de app.js/ui.js.
   Todo dato se escapa con escaparHtml y los botones usan data-*, sin onclick en línea. */
const Finanzas = (() => {
  const $ = id => document.getElementById(id);
  const esc = v => escaparHtml(v);
  const METODOS = [['transferencia', 'Transferencia'], ['efectivo', 'Efectivo'], ['deposito', 'Depósito'], ['cheque', 'Cheque'], ['tarjeta', 'Tarjeta'], ['otro', 'Otro']];
  const NOMBRE_METODO = Object.fromEntries(METODOS);
  const esAdmin = () => USUARIO_ACTUAL?.rol === 'admin';
  // Todos los usuarios con sesión ven las cuentas; crédito y factura los cambian admin y atención.
  const puedeCartera = () => !!USUARIO_ACTUAL;
  const puedeEditarFactura = () => !!USUARIO_ACTUAL;
  // Todos operan las cuentas; los pagos que registran ventas o técnicos quedan "por confirmar".
  const cobroQuedaConfirmado = () => ['admin', 'atencion'].includes(USUARIO_ACTUAL?.rol);
  const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const sumarDias = (f, d) => { const x = new Date(f + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + (Number(d) || 0)); return x.toISOString().slice(0, 10); };
  const fechaTxt = f => (f ? new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
  const folioOS = c => folioOrdenServicio({ id: c.lead_id, created_at: c.created_at });
  const json = async res => { const j = await res.json().catch(() => ({})); if (!res.ok) throw Object.assign(new Error(j.error || 'No se pudo completar'), { status: res.status, codigo: j.codigo }); return j; };
  // POST/PUT que puede responder 409 "posible duplicado": pregunta y reintenta con forzar.
  async function enviar(ruta, metodo, cuerpo) {
    let res = await api(ruta, { method: metodo, body: JSON.stringify(cuerpo) });
    if (res.status === 409) {
      const j = await res.clone().json().catch(() => ({}));
      if (j.codigo === 'POSIBLE_DUPLICADO' && await solicitarDialogo({ titulo: 'Posible registro repetido', mensaje: j.error + '\n\nSi no es un duplicado, confirma para guardarlo.', aceptar: 'Sí, guardarlo' })) {
        res = await api(ruta, { method: metodo, body: JSON.stringify({ ...cuerpo, forzar: true }) });
      } else if (j.codigo === 'POSIBLE_DUPLICADO') return null;
    }
    return json(res);
  }
  function etiquetaEstado(c) {
    if (c.estado === 'pagada') return '<span class="estado-cxc pagada">Pagada</span>';
    if (c.vencida) return `<span class="estado-cxc vencida">Vencida hace ${Number(c.dias_vencido)} d</span>`;
    if (c.programada) return '<span class="estado-cxc programada">Servicio programado</span>';
    return `<span class="estado-cxc ${esc(c.estado)}">${c.estado === 'parcial' ? 'Pago parcial' : 'Pendiente'}</span>`;
  }
  function pintarMetodos(contId, seleccionado) {
    $(contId).innerHTML = METODOS.map(([k, n]) => `<button type="button" class="metodo${k === seleccionado ? ' activo' : ''}" data-metodo="${k}" aria-pressed="${k === seleccionado}">${n}</button>`).join('');
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('.metodos .metodo');
    if (!b) return;
    b.parentElement.querySelectorAll('.metodo').forEach(x => { x.classList.toggle('activo', x === b); x.setAttribute('aria-pressed', String(x === b)); });
  });
  const metodoElegido = contId => $(contId).querySelector('.metodo.activo')?.dataset.metodo;
  for (const id of ['overlay-cobro', 'overlay-gasto', 'overlay-pago-prov']) {
    $(id).querySelector('.close-btn').addEventListener('click', () => $(id).classList.remove('mostrar'));
  }
  const conBoton = async (btn, fn) => { if (btn.disabled) return; btn.disabled = true; try { await fn(); } catch (err) { toast('No se pudo guardar: ' + err.message); } finally { btn.disabled = false; } };
  async function pedirMotivo(titulo) {
    return solicitarDialogo({ titulo, mensaje: 'Queda registrado quién lo canceló, cuándo y por qué. No se puede deshacer.', aceptar: 'Cancelar el registro', campo: { tipo: 'text', etiqueta: 'Motivo' } });
  }

  // ===================== Registrar pago de un cliente =====================
  let COBRO = null;
  async function abrirCobro(leadId, despues) {
    let r;
    try { r = await api('/leads/' + Number(leadId) + '/cobros').then(json); } catch (err) { toast('No se pudo abrir: ' + err.message); return; }
    const c = r.cuenta;
    COBRO = { leadId: Number(leadId), despues };
    $('cobro-titulo').textContent = 'Registrar pago · ' + folioOS(c);
    $('cobro-info').textContent = `${c.cliente_nombre || 'Cliente'} · Total ${formatoMoneda(c.total)} · Saldo ${formatoMoneda(c.saldo)}`;
    $('cobro-monto').value = c.saldo > 0 ? c.saldo.toFixed(2) : '';
    pintarMetodos('cobro-metodos', 'transferencia');
    $('cobro-fecha').value = hoy(); $('cobro-fecha').max = hoy();
    $('cobro-tipo').value = ''; $('cobro-referencia').value = ''; $('cobro-notas').value = '';
    $('cobro-aviso').textContent = c.saldo <= 0 ? 'Esta orden ya está pagada.'
      : (cobroQuedaConfirmado() ? '' : 'Quedará "por confirmar" hasta que alguien verifique que el dinero llegó.');
    $('cobro-guardar').disabled = c.saldo <= 0;
    abrirVentana('overlay-cobro');
    setTimeout(() => $('cobro-monto').select(), 50);
  }
  $('cobro-guardar').addEventListener('click', e => conBoton(e.currentTarget, async () => {
    if (!COBRO) return;
    const cuerpo = { monto: $('cobro-monto').value.trim(), metodo: metodoElegido('cobro-metodos'), fecha: $('cobro-fecha').value,
      referencia: $('cobro-referencia').value, notas: $('cobro-notas').value };
    if (esAdmin() && $('cobro-tipo').value) cuerpo.tipo = $('cobro-tipo').value;
    const r = await enviar('/leads/' + COBRO.leadId + '/cobros', 'POST', cuerpo);
    if (!r) return;
    $('overlay-cobro').classList.remove('mostrar');
    toast(r.confirmado ? `Pago guardado. Saldo: ${formatoMoneda(r.cuenta.saldo)}` : 'Pago guardado; queda por confirmar por administración');
    const despues = COBRO.despues; COBRO = null;
    if (despues) await despues();
  }));

  // Cómo se forma el total de la orden (IVA) y aviso si el CFDI capturado no coincide.
  function desgloseIva(c) {
    const orden = c.iva_modo === 'mas_iva' ? `Orden: ${formatoMoneda(c.subtotal)} + IVA ${Number(c.iva_tasa)} % ${formatoMoneda(c.iva)} = ${formatoMoneda(c.total_orden)}`
      : c.iva_modo === 'incluido' ? `Orden con IVA incluido: ${formatoMoneda(c.total_orden)} (subtotal ${formatoMoneda(c.subtotal)} + IVA ${formatoMoneda(c.iva)})`
      : c.iva_modo === 'sin_iva' ? `Orden sin IVA: el cliente paga ${formatoMoneda(c.total_orden)}.`
      : 'IVA por definir: el total es el importe tal como se capturó. Si el cliente paga con IVA, captura el total del CFDI.';
    const dif = c.dif_cfdi ? `<p class="cuentas-aviso">El CFDI es ${formatoMoneda(Math.abs(c.dif_cfdi))} ${c.dif_cfdi > 0 ? 'mayor' : 'menor'} que el total de la orden (¿retención, descuento o centavos?). Se cobra el total del CFDI.</p>` : '';
    return `<p class="ayuda cobranza-iva">${orden}</p>${dif}`;
  }

  // ===================== Sección "Cobranza" en la ficha de la orden =====================
  let ORDEN_ACTUAL = null;
  async function pintarCobranzaOrden(lead) {
    const sec = $('seccion-cobranza'), cont = $('cobranza-orden');
    if (!lead || lead.estatus !== 'ganado') { sec.hidden = true; ORDEN_ACTUAL = null; return; }
    sec.hidden = false; ORDEN_ACTUAL = lead.id;
    cont.innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    let r;
    try { r = await api('/leads/' + Number(lead.id) + '/cobros').then(json); }
    catch (err) { cont.innerHTML = `<div class="aviso-error-carga" role="alert"><p>No se pudo cargar la cobranza: ${esc(err.message)}</p></div>`; return; }
    if (ORDEN_ACTUAL !== lead.id) return; // se abrió otra ficha mientras cargaba
    const c = r.cuenta;
    const fact = r.puede_editar_factura ? `
      <details class="cobranza-facturacion"><summary>Crédito y factura</summary>
        <div class="form-grid-2">
          <div class="campo-modal"><label for="fact-credito">Días de crédito</label><input id="fact-credito" type="number" min="0" max="180" step="1" value="${Number(c.dias_credito) || 0}"></div>
          <div class="campo-modal"><label for="fact-folio">Folio de factura (CFDI)</label><input id="fact-folio" maxlength="60" value="${esc(c.factura_folio || '')}"></div>
          <div class="campo-modal"><label for="fact-fecha">Fecha de factura</label><input id="fact-fecha" type="date" value="${esc(c.factura_fecha || '')}"></div>
          <div class="campo-modal"><label for="fact-total">Total del CFDI, con IVA (vacío = total de la orden)</label><input id="fact-total" type="text" inputmode="decimal" value="${c.factura_total == null ? '' : Number(c.factura_total).toFixed(2)}"></div>
        </div>
        <button type="button" class="btn btn-secundario" data-cobranza="guardar-factura">Guardar crédito y factura</button>
      </details>` : (c.factura_folio ? `<p class="ayuda">Factura ${esc(c.factura_folio)}${c.factura_fecha ? ' del ' + esc(fechaTxt(c.factura_fecha)) : ''}</p>` : '');
    const pagos = r.cobros.length ? r.cobros.map(k => `
      <div class="pago-fila${k.cancelado ? ' cancelado' : ''}">
        <div><b>${formatoMoneda(k.monto)}</b> · ${esc(NOMBRE_METODO[k.metodo] || k.metodo)} · ${esc(fechaTxt(k.fecha))}${k.tipo !== 'pago' ? ' · ' + esc(k.tipo) : ''}
          <small>Registró ${esc(k.registrado_por_nombre || '—')}${k.referencia ? ' · Ref. ' + esc(k.referencia) : ''}${k.notas ? ' · ' + esc(k.notas) : ''}</small>
          ${k.cancelado ? `<small class="motivo">Cancelado: ${esc(k.motivo_cancelacion || '')}</small>` : (!k.confirmado ? '<span class="estado-cxc por-confirmar">Por confirmar</span>' : '')}
        </div>
        ${r.puede_operar && !k.cancelado ? `<div class="btn-group">${!k.confirmado ? `<button type="button" class="btn btn-outline" data-cobro-confirmar="${Number(k.id)}">Confirmar</button>` : ''}<button type="button" class="btn btn-outline" data-cobro-cancelar="${Number(k.id)}">Cancelar</button></div>` : ''}
      </div>`).join('') : '<p class="util-45">Sin pagos registrados.</p>';
    cont.innerHTML = `
      ${c.por_revisar ? '<p class="cuentas-aviso">Orden anterior al módulo de cuentas: está pendiente de la revisión inicial (Finanzas → Cuentas por cobrar).</p>' : ''}
      <div class="cobranza-resumen">
        <div>${etiquetaEstado(c)}</div>
        <div><small>Total${c.factura_total != null ? ' (CFDI)' : ''}</small><b>${formatoMoneda(c.total)}</b></div>
        <div><small>Cobrado</small><b>${formatoMoneda(c.cobrado)}</b></div>
        <div><small>Saldo</small><b>${formatoMoneda(c.saldo)}</b></div>
        <div><small>Vence</small><b>${esc(fechaTxt(c.vence))}</b></div>
      </div>
      ${desgloseIva(c)}
      <button type="button" class="btn btn-primario" data-cobranza="registrar" ${c.saldo <= 0 ? 'disabled' : ''}>💵 Registrar pago</button>
      ${fact}
      <div class="pagos-lista">${pagos}</div>`;
  }
  $('cobranza-orden').addEventListener('click', async e => {
    const btn = e.target.closest('button'); if (!btn || !ORDEN_ACTUAL) return;
    const id = ORDEN_ACTUAL;
    // Tras un movimiento: repinta la cobranza, la bitácora de la ficha y las vistas de dinero abiertas.
    const recargar = async () => {
      await pintarCobranzaOrden({ id, estatus: 'ganado' });
      try {
        const lead = await api('/leads/' + id).then(r => r.json());
        if (LEAD_ACTUAL?.id === id) { LEAD_ACTUAL.historial = lead.historial; renderBitacora(lead); }
      } catch { /* la bitácora se verá al reabrir la ficha */ }
      refrescarVistasDinero();
    };
    if (btn.dataset.cobranza === 'registrar') return abrirCobro(id, recargar);
    if (btn.dataset.cobranza === 'guardar-factura') return conBoton(btn, async () => {
      await json(await api('/leads/' + id + '/facturacion', { method: 'PUT', body: JSON.stringify({
        dias_credito: $('fact-credito').value, factura_folio: $('fact-folio').value, factura_fecha: $('fact-fecha').value || null,
        factura_total: $('fact-total').value.trim() === '' ? null : $('fact-total').value.trim() }) }));
      toast('Crédito y factura guardados'); await recargar();
    });
    if (btn.dataset.cobroConfirmar) return conBoton(btn, async () => { await json(await api('/finanzas/cobros/' + Number(btn.dataset.cobroConfirmar) + '/confirmar', { method: 'POST' })); toast('Pago confirmado'); await recargar(); });
    if (btn.dataset.cobroCancelar) {
      const motivo = await pedirMotivo('Cancelar pago'); if (!motivo) return;
      return conBoton(btn, async () => { await json(await api('/finanzas/cobros/' + Number(btn.dataset.cobroCancelar) + '/cancelar', { method: 'POST', body: JSON.stringify({ motivo }) })); toast('Pago cancelado; el saldo se actualizó'); await recargar(); });
    }
  });

  function refrescarVistasDinero() {
    if ($('vista-cuentas')?.classList.contains('activa')) cargar();
    if ($('vista-inicio')?.classList.contains('activa')) pintarInicio();
  }

  // ===================== Vista Cuentas =====================
  // SECCION: 'cobrar' (cuentas por cobrar) o 'pagar' (facturas y gastos + proveedores).
  let SECCION = 'cobrar', PESTANA = 'cobrar', FILTRO = 'con_saldo', RESUMEN = null, CARTERA = [];
  document.querySelectorAll('[data-pestana]').forEach(b => b.addEventListener('click', () => irPestana(b.dataset.pestana)));
  function irPestana(p) {
    PESTANA = p;
    document.querySelectorAll('[data-pestana]').forEach(b => { b.classList.toggle('activo', b.dataset.pestana === p); b.setAttribute('aria-selected', String(b.dataset.pestana === p)); });
    document.querySelectorAll('.cuentas-panel').forEach(x => { x.hidden = x.dataset.panel !== p; });
    if (p === 'cobrar') cargarCobrar(); else if (p === 'pagar') cargarPagar(); else cargarProveedores();
  }
  document.querySelectorAll('[data-filtro-cobro]').forEach(b => b.addEventListener('click', () => {
    FILTRO = b.dataset.filtroCobro;
    document.querySelectorAll('[data-filtro-cobro]').forEach(x => x.classList.toggle('activo', x === b));
    cargarLista();
  }));
  let tBuscar;
  $('cobrar-buscar').addEventListener('input', () => { clearTimeout(tBuscar); tBuscar = setTimeout(cargarLista, 300); });
  $('cobrar-vista').addEventListener('change', cargarLista);

  async function cargar(opciones = {}) {
    if (!puedeCartera()) return;
    if (opciones.filtro || opciones.pestana) $('cobrar-buscar').value = '';
    if (opciones.seccion) SECCION = opciones.seccion;
    else if (opciones.pestana) SECCION = opciones.pestana === 'cobrar' ? 'cobrar' : 'pagar';
    $('cuentas-titulo').textContent = SECCION === 'cobrar' ? 'Cuentas por cobrar' : 'Cuentas por pagar';
    $('cuentas-pestanas').hidden = SECCION === 'cobrar';
    const pestana = SECCION === 'cobrar' ? 'cobrar' : (opciones.pestana && opciones.pestana !== 'cobrar' ? opciones.pestana : (PESTANA === 'cobrar' ? 'pagar' : PESTANA));
    if (opciones.filtro) {
      FILTRO = opciones.filtro;
      document.querySelectorAll('[data-filtro-cobro]').forEach(x => x.classList.toggle('activo', x.dataset.filtroCobro === FILTRO));
    }
    pintarTarjetas();
    irPestana(pestana);
  }
  async function pintarTarjetas() {
    const cont = $('cuentas-tarjetas');
    try { RESUMEN = await api('/finanzas/resumen').then(json); } catch (err) { cont.innerHTML = `<div class="aviso-error-carga" role="alert"><p>No se pudo cargar el resumen: ${esc(err.message)}</p></div>`; return; }
    const r = RESUMEN, t = (titulo, valor, detalle, clase = '') => `<div class="tarjeta-dinero ${clase}"><small>${titulo}</small><b>${valor}</b>${detalle ? `<span>${detalle}</span>` : ''}</div>`;
    cont.innerHTML = SECCION === 'pagar'
      ? (r.pagar_semana !== undefined ? t('Pagar esta semana', formatoMoneda(r.pagar_semana), `${Number(r.facturas_semana)} facturas (incluye vencidas)`, r.pagar_semana > 0 ? 'aviso' : '') : '')
        + (r.por_pagar !== undefined ? t('Total por pagar', formatoMoneda(r.por_pagar), '') : '')
        + (r.pagado_mes !== undefined ? t('Pagado este mes', formatoMoneda(r.pagado_mes), '') : '')
      : t('Te deben', formatoMoneda(r.por_cobrar), `${Number(r.cuentas_con_saldo)} órdenes con saldo`)
      + t('Vencido', formatoMoneda(r.vencido), `${Number(r.clientes_con_vencido)} clientes`, r.vencido > 0 ? 'alerta' : '')
      + (r.programado > 0 ? t('Programado', formatoMoneda(r.programado), `${Number(r.ordenes_programadas)} servicios aún no realizados`) : '')
      + t('Cobrado este mes', formatoMoneda(r.cobrado_mes), '')
      + (r.por_confirmar ? t('Por confirmar', formatoMoneda(r.por_confirmar.monto), `${Number(r.por_confirmar.cantidad)} pagos`, r.por_confirmar.cantidad ? 'aviso' : '') : '');
    pintarRevision();
  }

  // ---------- Por cobrar ----------
  async function cargarCobrar() {
    pintarPorConfirmar();
    cargarLista();
  }
  function pintarRevision() {
    const cont = $('cuentas-revision');
    if (!esAdmin() || !RESUMEN?.por_revisar) { cont.hidden = true; return; }
    cont.hidden = false;
    cont.innerHTML = `<p><b>Revisión inicial:</b> ${Number(RESUMEN.por_revisar)} órdenes anteriores al módulo todavía no cuentan en la cartera. Indica cuáles ya se cobraron para que los saldos sean reales.</p><button type="button" class="btn btn-secundario" data-revision="abrir">Revisar ahora</button><div id="revision-lista"></div>`;
  }
  $('cuentas-revision').addEventListener('click', async e => {
    const btn = e.target.closest('button'); if (!btn) return;
    if (btn.dataset.revision === 'abrir') {
      const lista = await api('/finanzas/revision-inicial').then(json).catch(err => { toast(err.message); return []; });
      $('revision-lista').innerHTML = `<div class="revision-tabla">${lista.map(c => `
        <label class="revision-fila"><span><b>${esc(folioOS(c))}</b> · ${esc(c.cliente_nombre)} · ${esc(c.servicio_nombre || '')} · ${esc(fechaTxt(c.fecha_servicio))} · ${formatoMoneda(c.total)}</span>
          <select data-revision-lead="${Number(c.lead_id)}"><option value="cobrada">Ya está cobrada</option><option value="pendiente">Sigue pendiente de cobro</option></select></label>`).join('')}</div>
        <button type="button" class="btn btn-primario" data-revision="guardar">Guardar revisión</button>`;
    }
    if (btn.dataset.revision === 'guardar') conBoton(btn, async () => {
      const cobradas = [], pendientes = [];
      document.querySelectorAll('[data-revision-lead]').forEach(s => (s.value === 'cobrada' ? cobradas : pendientes).push(Number(s.dataset.revisionLead)));
      const r = await json(await api('/finanzas/revision-inicial', { method: 'POST', body: JSON.stringify({ cobradas, pendientes }) }));
      toast(`Revisión guardada: ${r.revisadas} órdenes`); await cargar();
    });
  });
  async function pintarPorConfirmar() {
    const cont = $('cuentas-por-confirmar');
    const lista = await api('/finanzas/por-confirmar').then(json).catch(() => []);
    cont.innerHTML = lista.length ? `<div class="inicio-bloque inicio-bloque-aviso"><h3>Pagos por confirmar</h3><p class="ayuda">Los registraron vendedores o técnicos. Confírmalos cuando verifiques que el dinero llegó.</p>
      ${lista.map(k => `<div class="pago-fila"><div><b>${formatoMoneda(k.monto)}</b> · ${esc(NOMBRE_METODO[k.metodo] || k.metodo)} · ${esc(fechaTxt(k.fecha))}<small>${esc(k.cliente_nombre)} · ${esc(folioOrdenServicio({ id: k.lead_id, created_at: k.lead_created_at }))} · registró ${esc(k.registrado_por_nombre || '—')}</small></div>
        <div class="btn-group"><button type="button" class="btn btn-outline" data-confirmar="${Number(k.id)}">Confirmar</button><button type="button" class="btn btn-outline" data-cancelar="${Number(k.id)}">Cancelar</button></div></div>`).join('')}</div>` : '';
  }
  $('cuentas-por-confirmar').addEventListener('click', async e => {
    const btn = e.target.closest('button'); if (!btn) return;
    if (btn.dataset.confirmar) conBoton(btn, async () => { await json(await api('/finanzas/cobros/' + Number(btn.dataset.confirmar) + '/confirmar', { method: 'POST' })); toast('Pago confirmado'); cargar(); });
    if (btn.dataset.cancelar) {
      const motivo = await pedirMotivo('Cancelar pago'); if (!motivo) return;
      conBoton(btn, async () => { await json(await api('/finanzas/cobros/' + Number(btn.dataset.cancelar) + '/cancelar', { method: 'POST', body: JSON.stringify({ motivo }) })); toast('Pago cancelado'); cargar(); });
    }
  });

  function textoWhatsApp(g) {
    // Texto plano para WhatsApp (va codificado en la dirección, no como HTML).
    const folios = (g.folios || []).slice(0, 5).join(', ');
    return 'Hola ' + (g.cliente_nombre || '') + ', le saludamos de Saneadren. Le recordamos su saldo pendiente de ' + formatoMoneda(g.saldo)
      + (folios ? ' por los servicios ' + folios : '')
      + (g.vencido > 0 ? ' (vencido: ' + formatoMoneda(g.vencido) + ')' : g.proximo_vence ? ', con vencimiento el ' + fechaTxt(g.proximo_vence) : '')
      + '. Quedamos atentos a cualquier duda. ¡Gracias!';
  }
  function enlaceWhatsApp(telefono, textoMsg) {
    let d = String(telefono || '').replace(/\D/g, '');
    if (d.length === 10) d = '52' + d;
    return d.length >= 12 ? `https://wa.me/${d}?text=${encodeURIComponent(textoMsg)}` : '';
  }
  async function cargarLista() {
    const cont = $('cobrar-lista'), vista = $('cobrar-vista').value;
    cont.innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    const params = new URLSearchParams({ vista, filtro: FILTRO, q: $('cobrar-buscar').value.trim() });
    try { CARTERA = await api('/finanzas/cartera?' + params).then(json); }
    catch (err) { cont.innerHTML = `<div class="aviso-error-carga" role="alert"><p>No se pudo cargar: ${esc(err.message)}</p></div>`; return; }
    if (!CARTERA.length) { cont.innerHTML = '<p class="util-45">No hay cuentas con este filtro. 🎉</p>'; return; }
    cont.innerHTML = vista === 'cliente' ? CARTERA.map(g => {
      const wa = enlaceWhatsApp(g.telefono, textoWhatsApp(g));
      return `<div class="fila-dinero${g.vencido > 0 ? ' vencida' : ''}">
        <div class="info"><b>${esc(g.cliente_nombre || 'Sin nombre')}</b>${g.empresa_contacto ? ` · ${esc(g.empresa_contacto)}` : ''}
          <small>${esc(g.telefono || '')} · ${Number(g.ordenes)} ${Number(g.ordenes) === 1 ? 'orden' : 'órdenes'} · crédito ${Number(g.dias_credito)} días${g.max_dias_vencido > 0 ? ` · hasta ${Number(g.max_dias_vencido)} días vencido` : ''}</small></div>
        <div class="montos"><b>${formatoMoneda(g.saldo)}</b>${g.vencido > 0 ? `<small class="rojo">Vencido ${formatoMoneda(g.vencido)}</small>` : ''}</div>
        <div class="btn-group">
          ${wa ? `<a class="btn btn-outline" href="${esc(wa)}" target="_blank" rel="noopener noreferrer">Recordar por WhatsApp</a>` : ''}
          ${puedeEditarFactura() ? `<button type="button" class="btn btn-outline" data-credito-cliente="${Number(g.cliente_id)}" data-credito-actual="${Number(g.dias_credito)}">Crédito</button>` : ''}
          <button type="button" class="btn btn-secundario" data-ver-ordenes="${esc(g.telefono || g.cliente_nombre || '')}">Ver órdenes</button>
        </div></div>`;
    }).join('') : CARTERA.map(c => `<div class="fila-dinero${c.vencida ? ' vencida' : ''}">
        <div class="info"><b>${esc(folioOS(c))}</b> · ${esc(c.cliente_nombre || 'Sin nombre')} ${etiquetaEstado(c)}
          <small>${esc(c.servicio_nombre || 'Servicio')} · servicio ${esc(fechaTxt(c.fecha_servicio))} · vence ${esc(fechaTxt(c.vence))}${c.factura_folio ? ' · factura ' + esc(c.factura_folio) : ' · sin factura'}</small></div>
        <div class="montos"><b>${formatoMoneda(c.saldo)}</b><small>de ${formatoMoneda(c.total)}</small></div>
        <div class="btn-group">
          ${c.saldo > 0 ? `<button type="button" class="btn btn-primario" data-pagar-orden="${Number(c.lead_id)}">Registrar pago</button>` : ''}
          <button type="button" class="btn btn-outline" data-abrir-orden="${Number(c.lead_id)}">Abrir orden</button>
        </div></div>`).join('');
  }
  $('cobrar-lista').addEventListener('click', async e => {
    const btn = e.target.closest('button'); if (!btn) return;
    if (btn.dataset.pagarOrden) return abrirCobro(Number(btn.dataset.pagarOrden), () => cargar());
    if (btn.dataset.abrirOrden) return abrirFicha(Number(btn.dataset.abrirOrden));
    if (btn.dataset.verOrdenes !== undefined) { $('cobrar-vista').value = 'orden'; $('cobrar-buscar').value = btn.dataset.verOrdenes; return cargarLista(); }
    if (btn.dataset.creditoCliente) {
      const dias = await solicitarDialogo({ titulo: 'Días de crédito del cliente', mensaje: 'Se aplica a sus órdenes NUEVAS (0 = contado). Las órdenes existentes conservan el suyo; cámbialo en cada orden si hace falta.', aceptar: 'Guardar', campo: { tipo: 'number', etiqueta: 'Días (0 a 180)' } });
      if (dias === null) return;
      conBoton(btn, async () => { await json(await api('/finanzas/clientes/' + Number(btn.dataset.creditoCliente) + '/credito', { method: 'PUT', body: JSON.stringify({ dias_credito: dias }) })); toast('Crédito del cliente actualizado'); cargarLista(); });
    }
  });
  $('cobrar-exportar').addEventListener('click', () => {
    if (!CARTERA.length) { toast('No hay datos con este filtro para exportar'); return; }
    if ($('cobrar-vista').value === 'cliente') {
      descargarCSV('cuentas_por_cobrar_clientes_' + hoy() + '.csv', [
        { titulo: 'Cliente', valor: g => g.cliente_nombre }, { titulo: 'Empresa', valor: g => g.empresa_contacto }, { titulo: 'Teléfono', valor: g => g.telefono },
        { titulo: 'Órdenes con saldo', valor: g => g.ordenes }, { titulo: 'Saldo', valor: g => g.saldo.toFixed(2) }, { titulo: 'Vencido', valor: g => g.vencido.toFixed(2) },
        { titulo: 'Máx. días vencido', valor: g => g.max_dias_vencido }, { titulo: 'Días de crédito', valor: g => g.dias_credito }], CARTERA);
    } else {
      descargarCSV('cuentas_por_cobrar_ordenes_' + hoy() + '.csv', [
        { titulo: 'Folio', valor: folioOS }, { titulo: 'Cliente', valor: c => c.cliente_nombre }, { titulo: 'Servicio', valor: c => c.servicio_nombre },
        { titulo: 'Fecha del servicio', valor: c => c.fecha_servicio }, { titulo: 'Factura', valor: c => c.factura_folio }, { titulo: 'Total', valor: c => c.total.toFixed(2) },
        { titulo: 'Cobrado', valor: c => c.cobrado.toFixed(2) }, { titulo: 'Saldo', valor: c => c.saldo.toFixed(2) }, { titulo: 'Vence', valor: c => c.vence },
        { titulo: 'Días vencido', valor: c => c.dias_vencido }, { titulo: 'Estado', valor: c => (c.vencida ? 'vencida' : c.estado) }], CARTERA);
    }
  });

  // ---------- Por pagar ----------
  let CXP = [], PAGO_PROV = null, PROVEEDORES = [], CATEGORIAS = [];
  async function catalogosPagos() {
    [PROVEEDORES, CATEGORIAS] = await Promise.all([api('/finanzas/proveedores').then(json), CATEGORIAS.length ? CATEGORIAS : api('/finanzas/categorias').then(json)]);
    const opts = CATEGORIAS.map(c => `<option value="${esc(c.clave)}">${esc(c.nombre)}</option>`).join('');
    $('gasto-categoria').innerHTML = opts; $('prov-categoria').innerHTML = opts;
  }
  async function cargarPagar() {
    const cont = $('pagar-lista');
    cont.innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    try { CXP = await api('/finanzas/cxp?vista=' + encodeURIComponent($('pagar-vista').value)).then(json); }
    catch (err) { cont.innerHTML = `<div class="aviso-error-carga" role="alert"><p>No se pudo cargar: ${esc(err.message)}</p></div>`; return; }
    const h = hoy(), dow = new Date(h + 'T00:00:00Z').getUTCDay(), domingo = sumarDias(h, (7 - dow) % 7), domingoSig = sumarDias(domingo, 7);
    const grupos = [['Vencidas', x => x.saldo > 0 && x.fecha_vencimiento < h], ['Esta semana', x => x.saldo > 0 && x.fecha_vencimiento >= h && x.fecha_vencimiento <= domingo],
      ['Próxima semana', x => x.saldo > 0 && x.fecha_vencimiento > domingo && x.fecha_vencimiento <= domingoSig], ['Después', x => x.saldo > 0 && x.fecha_vencimiento > domingoSig], ['Pagadas', x => x.saldo <= 0]];
    const html = grupos.map(([titulo, f]) => {
      const items = CXP.filter(f);
      if (!items.length) return '';
      const subtotal = items.reduce((t, x) => t + x.saldo, 0);
      return `<h3 class="grupo-pagos">${titulo} <small>${items.length} · ${formatoMoneda(subtotal)}</small></h3>` + items.map(x => `
        <div class="fila-dinero${titulo === 'Vencidas' ? ' vencida' : ''}">
          <div class="info"><b>${esc(x.proveedor_nombre)}</b> · ${esc(x.concepto)}
            <small>${esc(x.categoria_nombre)} · vence ${esc(fechaTxt(x.fecha_vencimiento))}${x.factura_folio ? ' · factura ' + esc(x.factura_folio) : ''}${x.lead_id ? ' · orden #' + Number(x.lead_id) : ''}${x.equipo ? ' · ' + esc(x.equipo) : ''}</small></div>
          <div class="montos"><b>${formatoMoneda(x.saldo)}</b><small>de ${formatoMoneda(x.total)}</small></div>
          <div class="btn-group">${x.saldo > 0 ? `<button type="button" class="btn btn-primario" data-pagar-cxp="${Number(x.id)}">Pagar</button>` : ''}<button type="button" class="btn btn-outline" data-detalle-cxp="${Number(x.id)}">Pagos</button>
            ${x.pagado === 0 ? `<button type="button" class="btn btn-outline" data-cancelar-cxp="${Number(x.id)}">Cancelar</button>` : ''}</div>
        </div>`).join('');
    }).join('');
    cont.innerHTML = html || '<p class="util-45">No hay cuentas por pagar. 🎉</p>';
  }
  $('pagar-vista').addEventListener('change', cargarPagar);
  $('pagar-lista').addEventListener('click', async e => {
    const btn = e.target.closest('button'); if (!btn) return;
    const id = Number(btn.dataset.pagarCxp || btn.dataset.detalleCxp || btn.dataset.cancelarCxp);
    if (btn.dataset.cancelarCxp) {
      const motivo = await pedirMotivo('Cancelar cuenta por pagar'); if (!motivo) return;
      return conBoton(btn, async () => { await json(await api('/finanzas/cxp/' + id + '/cancelar', { method: 'POST', body: JSON.stringify({ motivo }) })); toast('Cuenta cancelada'); cargar({ pestana: 'pagar' }); });
    }
    abrirPagoProveedor(id, !!btn.dataset.pagarCxp);
  });
  async function abrirPagoProveedor(id, paraPagar) {
    const x = CXP.find(c => c.id === id); if (!x) return;
    PAGO_PROV = x;
    $('pagoprov-info').textContent = `${x.proveedor_nombre} · ${x.concepto} · Saldo ${formatoMoneda(x.saldo)}`;
    $('pagoprov-monto').value = x.saldo > 0 ? x.saldo.toFixed(2) : '';
    pintarMetodos('pagoprov-metodos', 'transferencia');
    $('pagoprov-fecha').value = hoy(); $('pagoprov-fecha').max = hoy(); $('pagoprov-referencia').value = '';
    $('pagoprov-guardar').disabled = x.saldo <= 0;
    [$('pagoprov-monto'), $('pagoprov-fecha'), $('pagoprov-referencia'), $('pagoprov-guardar')].forEach(el => { el.closest('.campo') ? (el.closest('.campo').hidden = !paraPagar) : (el.hidden = !paraPagar); });
    $('pagoprov-metodos').closest('.campo').hidden = !paraPagar;
    $('pagoprov-historial').innerHTML = '<p class="util-45">Cargando pagos…</p>';
    abrirVentana('overlay-pago-prov');
    const pagos = await api('/finanzas/cxp/' + id + '/pagos').then(json).catch(() => []);
    $('pagoprov-historial').innerHTML = pagos.length ? '<div class="seccion-tit">Pagos registrados</div>' + pagos.map(g => `
      <div class="pago-fila${g.cancelado ? ' cancelado' : ''}"><div><b>${formatoMoneda(g.monto)}</b> · ${esc(NOMBRE_METODO[g.metodo] || g.metodo)} · ${esc(fechaTxt(g.fecha))}
        <small>Registró ${esc(g.registrado_por_nombre || '—')}${g.referencia ? ' · Ref. ' + esc(g.referencia) : ''}</small>${g.cancelado ? `<small class="motivo">Cancelado: ${esc(g.motivo_cancelacion || '')}</small>` : ''}</div>
        ${!g.cancelado ? `<button type="button" class="btn btn-outline" data-cancelar-pagoprov="${Number(g.id)}">Cancelar</button>` : ''}</div>`).join('') : '<p class="util-45">Sin pagos registrados.</p>';
  }
  $('pagoprov-historial').addEventListener('click', async e => {
    const btn = e.target.closest('[data-cancelar-pagoprov]'); if (!btn) return;
    const motivo = await pedirMotivo('Cancelar pago a proveedor'); if (!motivo) return;
    conBoton(btn, async () => { await json(await api('/finanzas/pagos-proveedor/' + Number(btn.dataset.cancelarPagoprov) + '/cancelar', { method: 'POST', body: JSON.stringify({ motivo }) }));
      toast('Pago cancelado'); $('overlay-pago-prov').classList.remove('mostrar'); cargar({ pestana: 'pagar' }); });
  });
  $('pagoprov-guardar').addEventListener('click', e => conBoton(e.currentTarget, async () => {
    if (!PAGO_PROV) return;
    const r = await enviar('/finanzas/cxp/' + PAGO_PROV.id + '/pagos', 'POST', { monto: $('pagoprov-monto').value.trim(), metodo: metodoElegido('pagoprov-metodos'), fecha: $('pagoprov-fecha').value, referencia: $('pagoprov-referencia').value });
    if (!r) return;
    $('overlay-pago-prov').classList.remove('mostrar'); toast('Pago a proveedor guardado'); cargar({ pestana: 'pagar' });
  }));

  // Nuevo gasto o factura
  $('pagar-nuevo').addEventListener('click', async () => {
    try { await catalogosPagos(); } catch (err) { toast('No se pudo cargar: ' + err.message); return; }
    const activos = PROVEEDORES.filter(p => p.activo);
    if (!activos.length) { toast('Primero agrega un proveedor'); irPestana('proveedores'); return; }
    llenarProveedoresGasto();
    ['gasto-concepto', 'gasto-total', 'gasto-folio', 'gasto-orden', 'gasto-equipo'].forEach(id => { $(id).value = ''; });
    $('gasto-fecha').value = hoy(); $('gasto-vence').value = hoy(); $('gasto-pagado').checked = false; $('gasto-metodo-wrap').hidden = true;
    $('gasto-categoria').value = 'otro';
    pintarMetodos('gasto-metodos', 'efectivo');
    abrirVentana('overlay-gasto');
  });
  function llenarProveedoresGasto(seleccionado) {
    $('gasto-proveedor').innerHTML = '<option value="">Selecciona…</option>' + PROVEEDORES.filter(p => p.activo).map(p => `<option value="${Number(p.id)}">${esc(p.nombre)}</option>`).join('')
      + '<option value="__nuevo">+ Nuevo proveedor…</option>';
    if (seleccionado) $('gasto-proveedor').value = String(seleccionado);
  }
  const recalcularVence = () => {
    const p = PROVEEDORES.find(x => x.id === Number($('gasto-proveedor').value));
    if (p && $('gasto-fecha').value) $('gasto-vence').value = sumarDias($('gasto-fecha').value, p.dias_credito);
  };
  $('gasto-proveedor').addEventListener('change', async () => {
    if ($('gasto-proveedor').value === '__nuevo') {
      $('gasto-proveedor').value = '';
      const nombre = await solicitarDialogo({ titulo: 'Nuevo proveedor', mensaje: 'Se crea con la categoría elegida y sin crédito (contado). Puedes completar sus datos después en la pestaña Proveedores.', aceptar: 'Agregar', campo: { tipo: 'text', etiqueta: 'Nombre del proveedor' } });
      if (!nombre) return;
      try {
        const p = await json(await api('/finanzas/proveedores', { method: 'POST', body: JSON.stringify({ nombre, categoria: $('gasto-categoria').value || 'otro', dias_credito: 0 }) }));
        await catalogosPagos(); llenarProveedoresGasto(p.id); toast('Proveedor agregado');
      } catch (err) { toast('No se pudo agregar: ' + err.message); }
    }
    const p = PROVEEDORES.find(x => x.id === Number($('gasto-proveedor').value)); if (p) $('gasto-categoria').value = p.categoria; recalcularVence();
  });
  $('gasto-fecha').addEventListener('change', recalcularVence);
  $('gasto-pagado').addEventListener('change', () => { $('gasto-metodo-wrap').hidden = !$('gasto-pagado').checked; });
  $('gasto-guardar').addEventListener('click', e => conBoton(e.currentTarget, async () => {
    const orden = $('gasto-orden').value.trim();
    const leadId = orden ? Number((orden.match(/(\d+)\s*$/) || [])[1]) : null;
    if (orden && !leadId) { toast('Escribe el folio de la orden (OS-AAAAMM-0000) o su número'); return; }
    const r = await enviar('/finanzas/cxp', 'POST', {
      proveedor_id: Number($('gasto-proveedor').value) || null, categoria: $('gasto-categoria').value, concepto: $('gasto-concepto').value,
      total: $('gasto-total').value.trim(), fecha_documento: $('gasto-fecha').value, fecha_vencimiento: $('gasto-vence').value,
      factura_folio: $('gasto-folio').value, lead_id: leadId, equipo: $('gasto-equipo').value,
      ya_pagado: $('gasto-pagado').checked, metodo: metodoElegido('gasto-metodos') });
    if (!r) return;
    $('overlay-gasto').classList.remove('mostrar'); toast($('gasto-pagado').checked ? 'Gasto registrado como pagado' : 'Cuenta por pagar registrada'); cargar({ pestana: 'pagar' });
  }));
  $('pagar-exportar').addEventListener('click', () => {
    if (!CXP.length) { toast('No hay datos para exportar'); return; }
    descargarCSV('cuentas_por_pagar_' + hoy() + '.csv', [
      { titulo: 'Proveedor', valor: x => x.proveedor_nombre }, { titulo: 'Concepto', valor: x => x.concepto }, { titulo: 'Categoría', valor: x => x.categoria_nombre },
      { titulo: 'Factura', valor: x => x.factura_folio }, { titulo: 'Fecha', valor: x => x.fecha_documento }, { titulo: 'Vence', valor: x => x.fecha_vencimiento },
      { titulo: 'Total', valor: x => x.total.toFixed(2) }, { titulo: 'Pagado', valor: x => x.pagado.toFixed(2) }, { titulo: 'Saldo', valor: x => x.saldo.toFixed(2) },
      { titulo: 'Orden', valor: x => x.lead_id || '' }, { titulo: 'Equipo', valor: x => x.equipo || '' }], CXP);
  });

  // ---------- Proveedores ----------
  let PROV_EDITANDO = null;
  async function cargarProveedores() {
    const cont = $('prov-lista');
    try { await catalogosPagos(); } catch (err) { cont.innerHTML = `<div class="aviso-error-carga" role="alert"><p>No se pudo cargar: ${esc(err.message)}</p></div>`; return; }
    const cat = Object.fromEntries(CATEGORIAS.map(c => [c.clave, c.nombre]));
    cont.innerHTML = PROVEEDORES.length ? PROVEEDORES.map(p => `
      <div class="fila-dinero${p.activo ? '' : ' inactivo'}"><div class="info"><b>${esc(p.nombre)}</b>${p.activo ? '' : ' · inactivo'}
        <small>${esc(cat[p.categoria] || p.categoria)} · crédito ${Number(p.dias_credito)} días${p.telefono ? ' · ' + esc(p.telefono) : ''}${p.rfc ? ' · RFC ' + esc(p.rfc) : ''}</small></div>
        <div class="montos"><b>${formatoMoneda(p.saldo)}</b><small>por pagar</small></div>
        <div class="btn-group"><button type="button" class="btn btn-outline" data-editar-prov="${Number(p.id)}">Editar</button>
          <button type="button" class="btn btn-outline" data-activo-prov="${Number(p.id)}">${p.activo ? 'Desactivar' : 'Activar'}</button></div></div>`).join('')
      : '<p class="util-45">Aún no hay proveedores. Agrega el primero arriba.</p>';
    limpiarFormProveedor();
  }
  function limpiarFormProveedor() {
    PROV_EDITANDO = null;
    ['prov-nombre', 'prov-rfc', 'prov-telefono', 'prov-contacto'].forEach(id => { $(id).value = ''; });
    $('prov-credito').value = 0; $('prov-categoria').value = 'otro';
    $('prov-form-titulo').textContent = 'Agregar proveedor'; $('prov-cancelar').hidden = true;
  }
  $('prov-cancelar').addEventListener('click', limpiarFormProveedor);
  $('prov-lista').addEventListener('click', async e => {
    const btn = e.target.closest('button'); if (!btn) return;
    const p = PROVEEDORES.find(x => x.id === Number(btn.dataset.editarProv || btn.dataset.activoProv)); if (!p) return;
    if (btn.dataset.editarProv) {
      PROV_EDITANDO = p.id;
      $('prov-nombre').value = p.nombre; $('prov-categoria').value = p.categoria; $('prov-credito').value = p.dias_credito;
      $('prov-rfc').value = p.rfc || ''; $('prov-telefono').value = p.telefono || ''; $('prov-contacto').value = p.contacto || '';
      $('prov-form-titulo').textContent = 'Editar proveedor'; $('prov-cancelar').hidden = false; $('prov-nombre').focus();
      return;
    }
    conBoton(btn, async () => { await json(await api('/finanzas/proveedores/' + p.id, { method: 'PUT', body: JSON.stringify({ activo: !p.activo }) })); cargarProveedores(); });
  });
  $('prov-guardar').addEventListener('click', e => conBoton(e.currentTarget, async () => {
    const cuerpo = { nombre: $('prov-nombre').value, categoria: $('prov-categoria').value, dias_credito: $('prov-credito').value,
      rfc: $('prov-rfc').value, telefono: $('prov-telefono').value, contacto: $('prov-contacto').value };
    await json(await api('/finanzas/proveedores' + (PROV_EDITANDO ? '/' + PROV_EDITANDO : ''), { method: PROV_EDITANDO ? 'PUT' : 'POST', body: JSON.stringify(cuerpo) }));
    toast(PROV_EDITANDO ? 'Proveedor actualizado' : 'Proveedor agregado'); cargarProveedores();
  }));

  // ===================== Inicio: bloque "Dinero" =====================
  async function pintarInicio() {
    const cont = $('inicio-dinero');
    if (!cont || !puedeCartera()) return;
    let r;
    try { r = await api('/finanzas/resumen').then(json); }
    catch (err) { if (err.status !== 401) cont.innerHTML = `<div class="aviso-error-carga" role="alert"><p>No se pudo cargar: ${esc(err.message)}</p><button type="button" class="btn btn-outline" data-inicio-dinero="reintentar">Reintentar</button></div>`; return; }
    const fila = (accion, texto, detalle, clase = '') => `<button type="button" class="fila-alerta fila-dinero-inicio ${clase}" data-inicio-dinero="${accion}"><span class="info"><b>${texto}</b><span class="txt">${detalle}</span></span><span aria-hidden="true">›</span></button>`;
    let html = fila(r.vencido > 0 ? 'vencido' : 'con_saldo', `Te deben ${formatoMoneda(r.por_cobrar)}`, r.vencido > 0 ? `Vencido: ${formatoMoneda(r.vencido)} · ${Number(r.clientes_con_vencido)} clientes` : 'Nada vencido', r.vencido > 0 ? 'vencido' : '');
    if (r.por_confirmar?.cantidad) html += fila('cobrar', `Pagos por confirmar: ${Number(r.por_confirmar.cantidad)}`, `${formatoMoneda(r.por_confirmar.monto)} registrados por vendedores o técnicos`, 'aviso');
    if (r.pagar_semana !== undefined) html += fila('pagar', `Pagar esta semana: ${formatoMoneda(r.pagar_semana)}`, `${Number(r.facturas_semana)} facturas de proveedores (incluye vencidas)`, r.pagar_semana > 0 ? 'aviso' : '');
    if (esAdmin() && r.por_revisar) html += fila('cobrar', `Revisión inicial pendiente: ${Number(r.por_revisar)} órdenes`, 'Indica cuáles ya se cobraron para que la cartera sea real', 'aviso');
    cont.innerHTML = html;
  }
  $('inicio-dinero')?.addEventListener('click', e => {
    const b = e.target.closest('[data-inicio-dinero]'); if (!b) return;
    const a = b.dataset.inicioDinero;
    if (a === 'reintentar') return pintarInicio();
    cambiarVista('cuentas', { pestana: a === 'pagar' ? 'pagar' : 'cobrar', filtro: a === 'vencido' ? 'vencido' : a === 'con_saldo' ? 'con_saldo' : undefined });
  });

  // ===================== Ficha del contacto: estado de cuenta =====================
  let CLIENTE_ACTUAL_ID = null;
  async function pintarCliente(cliente) {
    const cont = $('fc-cobranza'); if (!cont) return;
    cont.innerHTML = ''; CLIENTE_ACTUAL_ID = cliente?.id || null;
    if (!CLIENTE_ACTUAL_ID) return;
    let r;
    try { r = await api('/finanzas/clientes/' + Number(cliente.id) + '/estado-cuenta').then(json); } catch { return; }
    if (CLIENTE_ACTUAL_ID !== cliente.id) return;
    if (r.saldo === undefined) { // ventas / técnico: solo el aviso, sin importes
      if (r.tiene_vencido) cont.innerHTML = `<p class="cuentas-aviso">⚠ Este cliente tiene pagos vencidos (hasta ${Number(r.dias_max_vencido)} días). Consulta con administración antes de comprometer crédito.</p>`;
      return;
    }
    const ordenes = r.ordenes.map(c => `<div class="pago-fila"><div><b>${esc(c.folio)}</b> · ${esc(c.servicio_nombre || 'Servicio')} ${etiquetaEstado(c)}<small>Saldo ${formatoMoneda(c.saldo)} de ${formatoMoneda(c.total)} · vence ${esc(fechaTxt(c.vence))}</small></div>
      <button type="button" class="btn btn-outline" data-fc-pagar="${Number(c.lead_id)}">Registrar pago</button></div>`).join('');
    cont.innerHTML = `<div class="modal-section" data-plegable="estado-cuenta"><div class="seccion-tit">💰 Estado de cuenta</div>
      <div class="cobranza-resumen"><div><small>Saldo</small><b>${formatoMoneda(r.saldo)}</b></div><div><small>Vencido</small><b class="${r.vencido > 0 ? 'rojo' : ''}">${formatoMoneda(r.vencido)}</b></div>
        <div><small>Programado</small><b>${formatoMoneda(r.programado)}</b></div><div><small>Crédito</small><b>${Number(r.dias_credito)} días</b></div></div>
      ${r.por_revisar_n ? `<p class="ayuda">${Number(r.por_revisar_n)} órdenes anteriores al módulo están pendientes de la revisión inicial.</p>` : ''}
      <div class="pagos-lista">${ordenes || '<p class="util-45">Sin saldos pendientes. 🎉</p>'}</div></div>`;
    window.Plegables?.preparar(cont);
  }
  $('fc-cobranza')?.addEventListener('click', e => {
    const b = e.target.closest('[data-fc-pagar]'); if (!b || !CLIENTE_ACTUAL_ID) return;
    const id = CLIENTE_ACTUAL_ID;
    abrirCobro(Number(b.dataset.fcPagar), () => pintarCliente({ id }));
  });

  // Aviso al cotizar o registrar un servicio para un cliente con pagos vencidos (sin importes).
  async function avisoAdeudo(clienteId, contenedorId) {
    const el = $(contenedorId); if (!el) return;
    el.hidden = true; el.textContent = '';
    if (!clienteId) return;
    try {
      const r = await api('/finanzas/clientes/' + Number(clienteId) + '/estado-cuenta').then(json);
      if (r.tiene_vencido) { el.textContent = `⚠ Este cliente tiene pagos vencidos (hasta ${Number(r.dias_max_vencido)} días).` + (r.vencido ? ' Vencido: ' + formatoMoneda(r.vencido) + '.' : ''); el.hidden = false; }
    } catch { /* el aviso es opcional: si falla no se interrumpe la captura */ }
  }

  // Resultados: cobrado y pagado en el periodo (admin y atención; gasto solo admin).
  async function pintarResultados(desde, hasta) {
    const cont = $('res-dinero-periodo'); if (!cont) return;
    cont.innerHTML = '';
    if (!puedeCartera()) return;
    const params = new URLSearchParams({ desde: desde || '2000-01-01', hasta: hasta || hoy() });
    let r;
    try { r = await api('/finanzas/periodo?' + params).then(json); } catch (err) { cont.innerHTML = `<p class="ayuda">No se pudo cargar lo cobrado: ${esc(err.message)}</p>`; return; }
    const card = (v, l) => `<div class="res-card"><div class="res-num">${v}</div><div class="res-label">${l}</div></div>`;
    cont.innerHTML = `<div class="res-grid">${card(formatoMoneda(r.cobrado), 'Cobrado en el periodo, con IVA (' + Number(r.cobros_n) + ' pagos, por fecha de pago)')}`
      + (r.pagado !== undefined ? card(formatoMoneda(r.pagado), 'Pagado a proveedores (con IVA)') + card(formatoMoneda(r.gasto_total), 'Gastos registrados, con IVA (por fecha de factura)') : '') + '</div>'
      + (r.gasto_por_categoria?.length ? '<div class="res-section"><h3>Gasto por categoría</h3><div id="res-gasto-categoria" class="bar-chart"></div></div>' : '');
    if (r.gasto_por_categoria?.length && typeof renderBarChart === 'function') renderBarChart('res-gasto-categoria', r.gasto_por_categoria, 'nombre', 'total', formatoMoneda);
  }

  // ===================== Plantillas de Excel para carga masiva (solo admin) =====================
  // ExcelJS se descarga solo cuando se usa, con verificación de integridad (SRI).
  let excelJs = null;
  function cargarExcelJS() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (!excelJs) excelJs = new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
      s.integrity = 'sha512-dlPw+ytv/6JyepmelABrgeYgHI0O+frEwgfnPdXDTOIZz+eDgfW07QXG02/O8COfivBdGNINy+Vex+lYmJ5rxw==';
      s.crossOrigin = 'anonymous';
      s.onload = () => ok(window.ExcelJS);
      s.onerror = () => { excelJs = null; mal(new Error('No se pudo cargar el lector de Excel. Revisa tu conexión.')); };
      document.head.appendChild(s);
    });
    return excelJs;
  }
  // tipo: texto | fecha | dinero | entero | lista. 'lista' toma sus opciones de la hoja Listas.
  const PLANTILLAS = {
    cxc: {
      titulo: 'Cuentas por cobrar', archivo: 'plantilla_cuentas_por_cobrar.xlsx', ruta: '/finanzas/importar/cxc',
      ayuda: 'Mismo formato de la hoja de cobranza: una factura por renglón. Cada renglón crea la orden de servicio con su factura y su saldo. El cliente se busca por NOMBRE (o por TELÉFONO si lo pones); si no existe, se crea. PAGADO registra el pago (A/C, o el TOTAL si A/C va vacío). CANCELADO y el renglón de totales se omiten. También puedes subir tu CSV de cobranza tal cual.',
      columnas: [
        { key: 'serie', titulo: 'SERIE', tipo: 'texto', ancho: 8, nota: 'Serie de la factura.', ej: 'QR' },
        { key: 'folio', titulo: 'FOLIO', tipo: 'texto', ancho: 9, nota: 'Folio de la factura. SERIE + FOLIO no se pueden repetir.', ej: '2786' },
        { key: 'fecha', titulo: 'FECHA', req: true, tipo: 'fecha', ancho: 12, nota: 'Fecha de la factura (también es la fecha del servicio).', ej: '2026-01-12' },
        { key: 'nombre', titulo: 'NOMBRE', req: true, tipo: 'texto', ancho: 34, nota: 'Cliente (razón social). Si ya existe con ese nombre, se usa ese cliente.', ej: 'PREMIUM RESTAURANT BRANDS' },
        { key: 'metodo_pago', titulo: 'M,P', tipo: 'lista', lista: 'metodo_pago', ancho: 7, nota: 'Método de pago del CFDI: PPD o PUE.', ej: 'PUE' },
        { key: 'subtotal', titulo: 'SUBTOTAL', req: true, tipo: 'dinero', ancho: 14, nota: 'Importe antes de IVA.', ej: 2150 },
        { key: 'iva', titulo: 'IVA', tipo: 'dinero', min: 0, ancho: 12, nota: 'IVA de la factura. 0 = sin IVA. Vacío = 16 %.', ej: 344 },
        { key: 'total', titulo: 'TOTAL', tipo: 'dinero', ancho: 14, nota: 'Total de la factura. Si no coincide con subtotal + IVA, este total es el que se cobra.', ej: 2494 },
        { key: 'credito', titulo: 'CREDITO', tipo: 'entero', ancho: 9, nota: 'Días de crédito (0 a 180).', ej: 30 },
        { key: 'fecha_vence', titulo: 'FECHA VENCE', tipo: 'fecha', ancho: 12, nota: 'Opcional: si CREDITO va vacío, los días se calculan con esta fecha.', ej: '2026-02-11' },
        { key: 'dias_vencidos', titulo: 'DIAS VENCIDOS', tipo: 'texto', ancho: 10, nota: 'Lo calcula el CRM: puedes dejarlo vacío.', ej: '' },
        { key: 'os', titulo: 'OS', alias: ['os'], tipo: 'texto', ancho: 9, nota: 'Orden de servicio relacionada (opcional).', ej: '' },
        { key: 'status', titulo: 'STATUS', tipo: 'lista', lista: 'status', ancho: 14, nota: 'PENDIENTE, PAGADO o CANCELADO (CANCELADO no se importa).', ej: 'PAGADO' },
        { key: 'pago_programado', titulo: 'PAGO PROGRAMADO', tipo: 'texto', ancho: 14, nota: 'Opcional: se guarda en las notas.', ej: '' },
        { key: 'fecha_pago', titulo: 'FECHA PAGO', tipo: 'fechaLibre', ancho: 12, nota: 'Fecha en que pagó. Puede ir sin año (19-feb): se toma el año desde la fecha de la factura.', ej: '19-feb' },
        { key: 'cp', titulo: 'CP', tipo: 'texto', ancho: 10, nota: 'Complemento de pago (se guarda como referencia del pago).', ej: '990' },
        { key: 'abonado', titulo: 'A/C', tipo: 'dinero', ancho: 14, nota: 'Lo que ya pagó. Vacío con PAGADO = el total.', ej: 2494 },
        { key: 'flujo', titulo: 'FLUJO', tipo: 'texto', ancho: 8, nota: 'QRO, MX… (se guarda en las notas).', ej: 'MX' },
        { key: 'observaciones', titulo: 'OBSERVACIONES', tipo: 'texto', ancho: 18, nota: 'Banco u observaciones (se guardan con el pago).', ej: 'SANTANDER' },
        { key: 'telefono', titulo: 'TELÉFONO (opcional)', alias: ['TELEFONO', 'Teléfono del cliente'], tipo: 'texto', ancho: 14, nota: 'Opcional, 10 dígitos. Si lo pones, el cliente se busca por teléfono.', ej: '' },
        { key: 'servicio', titulo: 'SERVICIO (opcional)', alias: ['SERVICIO', 'Servicio'], tipo: 'lista', lista: 'servicios', ancho: 26, nota: 'Opcional: servicio del catálogo.', ej: '' },
        { key: 'direccion', titulo: 'DIRECCIÓN (opcional)', alias: ['DIRECCION', 'Dirección del servicio'], tipo: 'texto', ancho: 28, nota: 'Opcional: dónde se hizo el servicio.', ej: '' },
      ],
    },
    cxp: {
      titulo: 'Cuentas por pagar', archivo: 'plantilla_cuentas_por_pagar.xlsx', ruta: '/finanzas/importar/cxp',
      ayuda: 'Cada renglón crea una factura o gasto de proveedor. Si el proveedor no existe se crea (con crédito 0; ajústalo después en Proveedores).',
      columnas: [
        { key: 'proveedor', titulo: 'Proveedor', req: true, tipo: 'texto', ancho: 28, nota: 'Nombre exacto. Si no existe, se crea.', ej: 'Disposición del Bajío' },
        { key: 'categoria', titulo: 'Categoría', req: true, tipo: 'lista', lista: 'categorias', ancho: 26, nota: 'Elige de la lista.', ej: 'Disposición de residuos' },
        { key: 'concepto', titulo: 'Concepto', req: true, tipo: 'texto', ancho: 32, nota: 'Qué se compró o qué servicio dio.', ej: 'Disposición 12 m3 de lodos' },
        { key: 'factura_folio', titulo: 'Folio de factura', tipo: 'texto', ancho: 14, nota: 'Evita registrar dos veces la misma factura.', ej: 'F-77' },
        { key: 'fecha_documento', titulo: 'Fecha de factura o gasto', req: true, tipo: 'fecha', ancho: 14, nota: '', ej: '2026-10-01' },
        { key: 'fecha_vencimiento', titulo: 'Fecha de vencimiento', tipo: 'fecha', ancho: 14, nota: 'Vacío = fecha + días de crédito del proveedor.', ej: '2026-10-31' },
        { key: 'total', titulo: 'Total con IVA (MXN)', req: true, tipo: 'dinero', ancho: 14, nota: 'Lo que hay que pagar.', ej: 2400.5 },
        { key: 'pagado', titulo: 'Ya pagado (MXN)', tipo: 'dinero', ancho: 14, nota: 'Lo ya pagado antes de importar. Vacío = nada.', ej: 400.5 },
        { key: 'metodo', titulo: 'Método de pago', tipo: 'lista', lista: 'metodos', ancho: 16, nota: 'Si hay algo ya pagado. Vacío = transferencia.', ej: 'Transferencia' },
        { key: 'orden', titulo: 'Orden de servicio relacionada', tipo: 'texto', ancho: 18, nota: 'Opcional: folio OS-AAAAMM-0000 o número.', ej: '' },
        { key: 'equipo', titulo: 'Equipo', tipo: 'texto', ancho: 14, nota: 'Opcional.', ej: 'E-37-04' },
        { key: 'notas', titulo: 'Notas', tipo: 'texto', ancho: 28, nota: 'Opcional.', ej: '' },
      ],
    },
  };
  const FILAS_PLANTILLA = 500;
  const sinAcentos = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[*()]/g, '').replace(/\s+/g, ' ').trim();

  async function descargarPlantilla(tipo) {
    const def = PLANTILLAS[tipo];
    let ExcelJS;
    try { ExcelJS = await cargarExcelJS(); } catch (err) { toast(err.message); return; }
    let listas;
    try {
      listas = {
        servicios: tipo === 'cxc' ? (await api('/servicios').then(json)).map(s => s.nombre) : [],
        categorias: tipo === 'cxp' ? (await api('/finanzas/categorias').then(json)).map(c => c.nombre) : [],
        metodos: METODOS.map(m => m[1]),
        metodo_pago: ['PPD', 'PUE'],
        status: ['PENDIENTE', 'PAGADO', 'CANCELADO'],
      };
    } catch (err) { toast('No se pudo preparar la plantilla: ' + err.message); return; }
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Saneadren CRM';
    const amarillo = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6B103' } };
    // Hoja de datos (la que se llena)
    const ws = wb.addWorksheet('Datos', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = def.columnas.map(c => ({ header: c.titulo + (c.req ? ' *' : ''), key: c.key, width: c.ancho }));
    ws.getRow(1).eachCell((cell, i) => {
      const c = def.columnas[i - 1];
      cell.font = { bold: true, color: { argb: 'FF1A1D23' } };
      cell.fill = c.req ? amarillo : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4E8EA' } };
      cell.alignment = { wrapText: true, vertical: 'middle' };
      if (c.nota) cell.note = c.nota;
    });
    ws.getRow(1).height = 32;
    // Hoja oculta con las listas de los desplegables
    const wl = wb.addWorksheet('Listas', { state: 'hidden' });
    const rangos = {};
    ['servicios', 'categorias', 'metodos', 'metodo_pago', 'status'].forEach((nombre, idx) => {
      const col = String.fromCharCode(65 + idx);
      wl.getCell(col + '1').value = nombre;
      listas[nombre].forEach((v, i) => { wl.getCell(col + (i + 2)).value = v; });
      rangos[nombre] = `Listas!$${col}$2:$${col}$${Math.max(2, listas[nombre].length + 1)}`;
    });
    def.columnas.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      // fechaLibre: acepta una fecha de Excel o un texto como "9-sep" (sin validación de fecha).
      if (c.tipo === 'fecha' || c.tipo === 'fechaLibre') col.numFmt = 'dd/mm/yyyy';
      if (c.tipo === 'dinero') col.numFmt = '#,##0.00';
      if (c.tipo === 'texto') col.numFmt = '@';
      for (let r = 2; r <= FILAS_PLANTILLA + 1; r++) {
        const celdaX = ws.getCell(r, i + 1);
        if (c.tipo === 'lista') celdaX.dataValidation = { type: 'list', allowBlank: !c.req, formulae: [rangos[c.lista]], showErrorMessage: true, errorTitle: c.titulo, error: 'Elige un valor de la lista.' };
        else if (c.tipo === 'fecha') celdaX.dataValidation = { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(2000, 0, 1))], showErrorMessage: true, errorTitle: c.titulo, error: 'Escribe una fecha (día/mes/año).' };
        else if (c.tipo === 'dinero') celdaX.dataValidation = { type: 'decimal', operator: 'between', allowBlank: true, formulae: [c.min ?? 0.01, 100000000], showErrorMessage: true, errorTitle: c.titulo, error: c.min === 0 ? 'Escribe un monto (0 si no lleva IVA).' : 'Escribe un monto mayor a 0.' };
        else if (c.tipo === 'entero') celdaX.dataValidation = { type: 'whole', operator: 'between', allowBlank: true, formulae: [0, 180], showErrorMessage: true, errorTitle: c.titulo, error: 'Número entero de 0 a 180.' };
      }
    });
    // Hoja de instrucciones con ejemplo
    const wi = wb.addWorksheet('Instrucciones');
    wi.getColumn(1).width = 30; wi.getColumn(2).width = 14; wi.getColumn(3).width = 60; wi.getColumn(4).width = 30;
    wi.addRow([`Plantilla de ${def.titulo} · Saneadren CRM`]).font = { bold: true, size: 14 };
    wi.addRow([def.ayuda]);
    wi.addRow(['1. Llena la hoja "Datos" (un renglón por registro, sin dejar renglones vacíos en medio). 2. Guarda como .xlsx. 3. En el CRM: Finanzas → ' + def.titulo + ' → "Subir plantilla". Verás una vista previa con los errores por renglón antes de importar; si hay errores no se importa nada.']);
    wi.addRow(['Las columnas con * (en amarillo) son obligatorias. No cambies los títulos de la primera fila. Máximo 1,000 renglones por archivo.']);
    wi.addRow([]);
    const enc = wi.addRow(['Columna', 'Obligatoria', 'Qué poner', 'Ejemplo']);
    enc.font = { bold: true }; enc.eachCell(c => { c.fill = amarillo; });
    def.columnas.forEach(c => wi.addRow([c.titulo, c.req ? 'Sí' : 'No', c.nota || '', c.ej === '' ? '' : String(c.ej)]));
    [2, 3, 4].forEach(r => { wi.getRow(r).alignment = { wrapText: true }; wi.mergeCells(r, 1, r, 4); wi.getRow(r).height = 30; });
    wb.views = [{ activeTab: 0 }];
    const buffer = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), def.archivo);
    toast('Plantilla descargada');
  }

  // Convierte el valor de una celda de ExcelJS a texto o número simple.
  function valorCelda(v) {
    if (v === null || v === undefined) return '';
    // Celda con error de Excel (#N/A, #¡REF!…): se marca para que el servidor la reporte, no se toma como vacía.
    if (typeof v === 'object' && !(v instanceof Date) && (v.error || v.result?.error)) return '#ERROR_EXCEL:' + (v.error || v.result.error);
    if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
    if (typeof v === 'object') {
      if (v.result !== undefined) return valorCelda(v.result);                    // fórmula
      if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join(''); // texto con formato
      if (v.text !== undefined) return valorCelda(v.text);                        // hipervínculo
      return '';
    }
    return v;
  }
  // Fechas escritas como texto: dd/mm/aaaa o d-m-aaaa → AAAA-MM-DD.
  // También "3-Dec-2025" o "15-ene-2026" (mes con letra, en español o inglés).
  const MESES_TXT = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };
  function fechaTexto(v) {
    const t = String(v).trim();
    const m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const l = t.match(/^(\d{1,2})[\s\-\/.]+([a-záéíóú]+)\.?[\s\-\/.]+(\d{2}|\d{4})$/i);
    const mes = l && MESES_TXT[sinAcentos(l[2]).slice(0, 3)];
    if (mes) return `${l[3].length === 2 ? '20' + l[3] : l[3]}-${String(mes).padStart(2, '0')}-${l[1].padStart(2, '0')}`;
    return t;
  }

  let IMPORTACION = null; // { tipo, filas }
  // CSV (como lo exporta Excel): separado por comas, con comillas para los valores que llevan comas.
  function leerCSV(texto) {
    const filas = []; let fila = [], valor = '', comillas = false;
    for (let i = 0; i < texto.length; i++) {
      const ch = texto[i];
      if (comillas) {
        if (ch === '"' && texto[i + 1] === '"') { valor += '"'; i++; }
        else if (ch === '"') comillas = false;
        else valor += ch;
      } else if (ch === '"') comillas = true;
      else if (ch === ',') { fila.push(valor); valor = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && texto[i + 1] === '\n') i++; fila.push(valor); filas.push(fila); fila = []; valor = ''; }
      else valor += ch;
    }
    if (valor !== '' || fila.length) { fila.push(valor); filas.push(fila); }
    return filas;
  }
  // Devuelve los renglones como arreglos de valores (1 = primera columna), de un .xlsx o un .csv.
  async function renglonesDelArchivo(archivo) {
    if (archivo.size > 5 * 1024 * 1024) throw new Error('El archivo es demasiado grande (máximo 5 MB)');
    if (/\.csv$/i.test(archivo.name)) {
      const bytes = await archivo.arrayBuffer();
      let texto = new TextDecoder('utf-8').decode(bytes);
      if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(bytes); // CSV de Excel en Windows
      const filas = leerCSV(texto.replace(/^﻿/, ''));
      if (filas.length > 5000) throw new Error('El archivo tiene demasiados renglones. Máximo 1,000 por archivo.');
      return filas.map(f => [undefined, ...f.map(v => v.trim())]);
    }
    const ExcelJS = await cargarExcelJS();
    const wb = new ExcelJS.Workbook();
    // Límites de lectura: un archivo pequeño con rangos enormes podría congelar el navegador.
    try { await wb.xlsx.load(await archivo.arrayBuffer(), { ignoreNodes: ['dataValidations', 'conditionalFormatting', 'hyperlinks'], maxRows: 5000, maxCols: 100 }); }
    catch (err) { throw new Error(/max (row|column)/i.test(err?.message || '') ? 'El archivo tiene demasiados renglones o columnas. Usa la plantilla y máximo 1,000 renglones.' : 'No se pudo leer el archivo. Guárdalo como Excel (.xlsx) o CSV e inténtalo de nuevo.'); }
    const ws = wb.getWorksheet('Datos') || wb.worksheets[0];
    if (!ws) throw new Error('El archivo no tiene hojas');
    const filas = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => { const v = []; row.eachCell({ includeEmpty: true }, (cell, i) => { v[i] = valorCelda(cell.value); }); filas[n - 1] = v; });
    return Array.from(filas, f => f || []);
  }
  async function leerArchivo(tipo, archivo) {
    const def = PLANTILLAS[tipo];
    const renglones = await renglonesDelArchivo(archivo);
    // El encabezado puede no estar en el primer renglón (p. ej. un título "COBRANZA QR 2026" arriba):
    // se busca entre los primeros 10 el que más títulos de columna reconoce.
    const columnaDe = t => def.columnas.find(x => [x.titulo, ...(x.alias || [])].some(n => sinAcentos(n) === sinAcentos(t)));
    let encabezado = -1, mejor = 0;
    renglones.slice(0, 10).forEach((r, i) => { const n = r.filter(v => v != null && columnaDe(v)).length; if (n > mejor) { mejor = n; encabezado = i; } });
    if (encabezado < 0) throw new Error('No se encontraron los títulos de las columnas. Descarga la plantilla de nuevo.');
    const posicion = {};
    renglones[encabezado].forEach((v, i) => { const c = v != null && columnaDe(v); if (c && !posicion[c.key]) posicion[c.key] = i; });
    const faltan = def.columnas.filter(c => c.req && !posicion[c.key]).map(c => c.titulo);
    if (faltan.length) throw new Error('Faltan columnas en la plantilla: ' + faltan.join(', ') + '. Descarga la plantilla de nuevo.');
    const filas = [];
    renglones.forEach((r, idx) => {
      if (idx <= encabezado) return;
      const f = { fila: idx + 1 };
      let algo = false;
      for (const c of def.columnas) {
        if (!posicion[c.key]) continue;
        let v = r[posicion[c.key]];
        if (v === undefined || v === null) v = '';
        const esFecha = c.tipo === 'fecha' || c.tipo === 'fechaLibre';
        // Una fecha puede llegar como número de serie de Excel (p. ej. 46296 = 01/10/2026).
        if (esFecha && typeof v === 'number' && v > 20000 && v < 80000) v = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
        if (esFecha && typeof v === 'string') v = fechaTexto(v);
        if (typeof v === 'string' && v.startsWith('#ERROR_EXCEL:')) v += '@' + c.titulo; // para que el mensaje diga la columna
        if (typeof v === 'number' && (c.tipo === 'texto' || c.tipo === 'lista')) v = String(v);
        // Montos calculados con fórmula (p. ej. con IVA) pueden traer residuos como 4060.0000001.
        if (typeof v === 'number' && c.tipo === 'dinero') v = Math.round(v * 100) / 100;
        if (v !== '') algo = true;
        f[c.key] = v;
      }
      if (algo) filas.push(f);
    });
    if (!filas.length) throw new Error('El archivo no tiene renglones con información');
    if (filas.length > 1000) throw new Error(`El archivo tiene ${filas.length} renglones; el máximo es 1,000. Divídelo en varios archivos.`);
    return filas;
  }

  async function simularImportacion(tipo, filas) {
    const def = PLANTILLAS[tipo];
    $('importar-titulo').textContent = 'Importar ' + def.titulo.toLowerCase();
    $('importar-resumen').textContent = 'Revisando ' + filas.length + ' renglones…';
    $('importar-errores').innerHTML = ''; $('importar-tabla').innerHTML = ''; $('importar-confirmar').hidden = true;
    abrirVentana('overlay-importar');
    let r;
    try { r = await api(def.ruta + '?simular=1', { method: 'POST', body: JSON.stringify({ filas }) }).then(json); }
    catch (err) { $('importar-resumen').textContent = 'No se pudo revisar: ' + err.message; return; }
    IMPORTACION = { tipo, filas };
    const nuevos = r.resumen.filter(x => !x.omitida && (x.cliente_nuevo || x.proveedor_nuevo)).length;
    const validos = r.resumen.filter(x => !x.omitida);
    const total = validos.reduce((t, x) => t + (x.total || 0), 0), pagado = validos.reduce((t, x) => t + (x.pagado || 0), 0);
    const omitidas = r.omitidas ? ` · ${Number(r.omitidas)} omitidos (cancelados o sin datos)` : '';
    $('importar-resumen').innerHTML = r.errores.length
      ? `<b>${Number(r.errores.length)} de ${Number(r.total)} renglones tienen errores.</b> Corrígelos en el Excel y vuelve a subirlo: no se importará nada mientras haya errores.`
      : `<b>Todo listo:</b> ${Number(r.total - (r.omitidas || 0))} renglones · total ${formatoMoneda(total)} · ya pagado ${formatoMoneda(pagado)} · saldo ${formatoMoneda(total - pagado)}${nuevos ? ` · ${nuevos} ${tipo === 'cxc' ? 'clientes' : 'proveedores'} nuevos` : ''}${omitidas}.`;
    $('importar-errores').innerHTML = r.errores.length ? '<div class="importar-errores">' + r.errores.slice(0, 200).map(e => `<div class="pago-fila"><div><b>Renglón ${Number(e.fila)}</b><small class="motivo">${e.errores.map(esc).join(' · ')}</small></div></div>`).join('') + (r.errores.length > 200 ? '<p class="ayuda">…y más.</p>' : '') + '</div>' : '';
    const primeros = r.resumen.slice(0, 100);
    $('importar-tabla').innerHTML = `<div class="importar-tabla"><table><thead><tr><th>Renglón</th><th>${tipo === 'cxc' ? 'Cliente' : 'Proveedor'}</th><th>${tipo === 'cxc' ? 'Factura' : 'Concepto'}</th><th>Total</th><th>Pagado</th>${tipo === 'cxc' ? '<th>Estado</th>' : ''}</tr></thead><tbody>`
      + primeros.map(x => `<tr><td>${Number(x.fila)}</td><td>${esc(x.cliente || x.proveedor || '')}${x.cliente_nuevo || x.proveedor_nuevo ? ' <span class="estado-cxc programada">nuevo</span>' : ''}</td><td>${esc(x.folio || x.concepto || '')}</td><td>${x.total == null ? '—' : formatoMoneda(x.total)}</td><td>${formatoMoneda(x.pagado || 0)}</td>${tipo === 'cxc' ? `<td>${esc(x.omitida || x.estado || '')}</td>` : ''}</tr>`).join('')
      + '</tbody></table></div>' + (r.resumen.length > 100 ? `<p class="ayuda">Se muestran los primeros 100 de ${Number(r.resumen.length)} renglones.</p>` : '');
    if (!r.errores.length) { $('importar-confirmar').hidden = false; $('importar-confirmar').textContent = `Importar ${Number(r.total - (r.omitidas || 0))} renglones`; }
  }
  $('importar-confirmar').addEventListener('click', e => conBoton(e.currentTarget, async () => {
    if (!IMPORTACION) return;
    const def = PLANTILLAS[IMPORTACION.tipo];
    const r = await api(def.ruta, { method: 'POST', body: JSON.stringify({ filas: IMPORTACION.filas }) }).then(json);
    if (r.errores.length) { toast('No se importó nada: aparecieron errores. Revísalos.'); return simularImportacion(IMPORTACION.tipo, IMPORTACION.filas); }
    const tipo = IMPORTACION.tipo; IMPORTACION = null;
    $('overlay-importar').classList.remove('mostrar');
    toast(`Importación lista: ${r.importadas} renglones`);
    cargar({ pestana: tipo === 'cxc' ? 'cobrar' : 'pagar' });
  }));
  $('overlay-importar').querySelector('.close-btn').addEventListener('click', () => { $('overlay-importar').classList.remove('mostrar'); IMPORTACION = null; });

  let TIPO_SUBIDA = null;
  document.addEventListener('click', e => {
    const d = e.target.closest('[data-plantilla-descargar]');
    if (d) return conBoton(d, () => descargarPlantilla(d.dataset.plantillaDescargar));
    const u = e.target.closest('[data-plantilla-subir]');
    if (u) { TIPO_SUBIDA = u.dataset.plantillaSubir; $('importar-archivo').value = ''; $('importar-archivo').click(); }
  });
  $('importar-archivo').addEventListener('change', async () => {
    const archivo = $('importar-archivo').files[0];
    if (!archivo || !TIPO_SUBIDA) return;
    try { await simularImportacion(TIPO_SUBIDA, await leerArchivo(TIPO_SUBIDA, archivo)); }
    catch (err) { toast(err.message); }
  });

  return { cargar, pintarCobranzaOrden, pintarInicio, abrirCobro, pintarCliente, avisoAdeudo, pintarResultados };
})();
