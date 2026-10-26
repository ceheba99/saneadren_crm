/* Cuentas por cobrar y por pagar. Usa api(), toast(), escaparHtml(), formatoMoneda(),
   solicitarDialogo(), abrirVentana(), descargarCSV(), abrirFicha() y USUARIO_ACTUAL de app.js/ui.js.
   Todo dato se escapa con escaparHtml y los botones usan data-*, sin onclick en línea. */
const Finanzas = (() => {
  const $ = id => document.getElementById(id);
  const esc = v => escaparHtml(v);
  const METODOS = [['transferencia', 'Transferencia'], ['efectivo', 'Efectivo'], ['deposito', 'Depósito'], ['cheque', 'Cheque'], ['tarjeta', 'Tarjeta'], ['otro', 'Otro']];
  // A proveedores y terceros también se les paga por nómina.
  const METODOS_PROV = [...METODOS.slice(0, -1), ['nomina', 'Nómina'], ['layout', 'Layout'], ['pagadora', 'Pagadora'], ['domiciliado', 'Domiciliado'], ['linea_captura', 'Línea de captura'], ['directo', 'Directo'], ['otro', 'Otro']];
  const COMPROBANTES = [['factura', 'Factura (CFDI)'], ['recibo', 'Recibo'], ['estado_cuenta', 'Estado de cuenta / corrida'], ['linea_captura', 'Línea de captura (impuestos)'], ['nomina', 'Nómina, finiquito o liquidación'], ['pagadora', 'Pagadora'], ['sin_factura', 'Sin factura'], ['informativo', 'Informativo (no se suma)'], ['otro', 'Otro']];
  const NOMBRE_METODO = Object.fromEntries(METODOS_PROV);
  // Lo que puede cada quien lo decide su rol (permisos.js); el servidor lo vuelve a revisar.
  const esAdmin = () => Permisos.puede('cobros.ajustes'); // ajustes, descuentos y revisión inicial
  const puedeCartera = (seccion = 'cobrar') => Permisos.puede(seccion === 'pagar' ? 'cxp.ver' : 'cxc.ver');
  const puedeEditarFactura = () => Permisos.puede('cobranza.factura');
  // Sin «cobros.directo», lo que registra queda «por confirmar».
  const cobroQuedaConfirmado = () => Permisos.puede('cobros.directo');
  const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const sumarDias = (f, d) => { const x = new Date(f + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + (Number(d) || 0)); return x.toISOString().slice(0, 10); };
  const fechaTxt = f => (f ? new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
  const folioOS = c => c.folio || folioOrdenServicio({ id: c.lead_id, created_at: c.created_at });
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
  // De dónde sale la cuenta: servicio realizado (fecha y quién), por concluir o solo programado.
  function textoEjecucion(c) {
    if (c.ejecucion === 'realizado') return 'realizado el ' + fechaTxt(c.fecha_realizado || c.fecha_servicio);
    if (c.ejecucion === 'no_realizado') return 'no realizado';
    return (c.sin_marcar ? 'facturado, sin marcar realizado · servicio ' : c.por_concluir ? 'por concluir · servicio ' : 'servicio ') + fechaTxt(c.fecha_servicio);
  }
  // Estado de la cuenta en palabras claras: si el servicio ya se hizo y qué falta (realizarlo, marcarlo o cobrarlo).
  function textoEstado(c) {
    const dias = n => Number(n) === 1 ? '1 día' : Number(n) + ' días';
    const falta = c.estado === 'parcial' ? `pagó una parte, falta ${formatoMoneda(c.saldo)}` : 'pendiente de cobrar';
    if (c.ejecucion === 'no_realizado') return c.a_favor > 0 ? ['a-favor', `No realizado · ${formatoMoneda(c.a_favor)} a favor del cliente (devolver o aplicar)`] : ['programada', 'No realizado · no se cobra'];
    if (c.estado === 'pagada') return ['pagada', 'Cobrado completo ✓'];
    if (c.programada) return c.por_concluir ? ['parcial', 'Por concluir · se cobra cuando se marque realizado'] : ['programada', 'Por realizar · aún no se cobra'];
    const servicio = c.ejecucion === 'realizado' ? 'Servicio realizado' : c.sin_marcar ? 'Facturado, sin marcar realizado' : 'Servicio';
    if (c.vencida) return ['vencida', `${servicio} · cobro vencido hace ${dias(c.dias_vencido)}`];
    if (c.sin_marcar) return ['por-concluir', `${servicio} · ${falta}`];
    return [c.estado === 'parcial' ? 'parcial' : 'pendiente', `${servicio} · ${falta}${c.dias_vencido < 0 ? ' (vence en ' + dias(-c.dias_vencido) + ')' : c.dias_vencido === 0 ? ' (vence hoy)' : ''}`];
  }
  function etiquetaEstado(c) {
    const [clase, texto] = textoEstado(c);
    return `<span class="estado-cxc ${clase}">${esc(texto)}</span>${c.por_confirmar > 0 ? ' <span class="estado-cxc por-confirmar">Pago por confirmar</span>' : ''}`;
  }
  function pintarMetodos(contId, seleccionado, lista = METODOS) {
    $(contId).innerHTML = lista.map(([k, n]) => `<button type="button" class="metodo${k === seleccionado ? ' activo' : ''}" data-metodo="${k}" aria-pressed="${k === seleccionado}">${n}</button>`).join('');
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
    // Sin ver la cobranza (r.solo_propios) no hay total ni saldo: se captura lo que pagó el cliente.
    const c = r.cuenta || { ...r.orden, saldo: null };
    COBRO = { leadId: Number(leadId), despues };
    $('cobro-titulo').textContent = 'Registrar pago · ' + folioOS(c);
    $('cobro-info').textContent = r.cuenta ? `${c.cliente_nombre || 'Cliente'} · Total ${formatoMoneda(c.total)} · Saldo ${formatoMoneda(c.saldo)}` : (c.cliente_nombre || 'Cliente'); // sin HTML
    $('cobro-monto').value = c.saldo > 0 ? c.saldo.toFixed(2) : '';
    pintarMetodos('cobro-metodos', 'transferencia');
    $('cobro-fecha').value = hoy(); $('cobro-fecha').max = hoy();
    $('cobro-tipo').value = ''; $('cobro-referencia').value = ''; $('cobro-notas').value = '';
    const pagada = c.saldo !== null && c.saldo <= 0;
    $('cobro-aviso').textContent = pagada ? 'Esta orden ya está pagada.'
      : (cobroQuedaConfirmado() ? '' : 'Quedará "por confirmar" hasta que alguien verifique que el dinero llegó.');
    $('cobro-guardar').disabled = pagada;
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
    toast(!r.confirmado ? 'Pago guardado; queda por confirmar por administración' : r.cuenta ? `Pago guardado. Saldo: ${formatoMoneda(r.cuenta.saldo)}` : 'Pago guardado');
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
    if (r.solo_propios) { cont.innerHTML = cobranzaSoloPropios(r); return; }
    const c = r.cuenta;
    const fact = r.puede_editar_factura ? `
      <details class="cobranza-facturacion"><summary>Crédito y factura</summary>
        <div class="form-grid-2">
          <div class="campo-modal"><label for="fact-credito">Días de crédito</label><input id="fact-credito" type="number" min="0" max="180" step="1" value="${Number(c.dias_credito) || 0}"></div>
          <div class="campo-modal"><label for="fact-folio">Folio de factura (CFDI)</label><input id="fact-folio" maxlength="60" value="${esc(c.factura_folio || '')}"></div>
          <div class="campo-modal"><label for="fact-fecha">Fecha de factura</label><input id="fact-fecha" type="date" value="${esc(c.factura_fecha || '')}"></div>
          <div class="campo-modal"><label for="fact-metodo">Método de pago (M.P.)</label><select id="fact-metodo"><option value="">Sin indicar</option><option value="PUE"${c.factura_metodo === 'PUE' ? ' selected' : ''}>PUE · una sola exhibición</option><option value="PPD"${c.factura_metodo === 'PPD' ? ' selected' : ''}>PPD · parcialidades o diferido</option></select></div>
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
        ${r.puede_operar && !k.cancelado ? `<div class="btn-group">${!k.confirmado && (k.registrado_por !== USUARIO_ACTUAL?.id || cobroQuedaConfirmado()) ? `<button type="button" class="btn btn-outline" data-cobro-confirmar="${Number(k.id)}">Confirmar</button>` : ''}<button type="button" class="btn btn-outline perm-dinero-mover" data-cobro-cancelar="${Number(k.id)}">Cancelar</button></div>` : ''}
      </div>`).join('') : '<p class="util-45">Sin pagos registrados.</p>';
    cont.innerHTML = `
      ${c.por_revisar ? '<p class="cuentas-aviso">Orden anterior al módulo de cuentas: está pendiente de la revisión inicial (Finanzas → Cuentas por cobrar).</p>' : ''}
      <div class="cobranza-resumen">
        <div>${etiquetaEstado(c)}</div>
        <div><small>Total${c.factura_total != null ? ' (CFDI)' : ''}</small><b>${formatoMoneda(c.total)}</b></div>
        <div><small>Cobrado</small><b>${formatoMoneda(c.cobrado)}</b></div>
        <div><small>Saldo</small><b>${formatoMoneda(c.saldo)}</b></div>
        ${c.ejecucion === 'no_realizado' ? `<div><small>A favor del cliente</small><b>${formatoMoneda(c.a_favor || 0)}</b></div>` : `<div><small>Vence</small><b>${esc(fechaTxt(c.vence))}</b></div>`}
      </div>
      ${desgloseIva(c)}
      ${c.ejecucion === 'no_realizado' ? '' : `<button type="button" class="btn btn-primario" data-cobranza="registrar" ${c.saldo <= 0 ? 'disabled' : ''}>💵 Registrar pago</button>`}
      ${fact}
      <div class="pagos-lista">${pagos}</div>`;
  }
  // Quien no ve las cuentas por cobrar (p. ej. el técnico): registra lo que cobró en campo y ve solo esos pagos, con su
  // estado. Sin total, cobrado, saldo ni vencimiento.
  const detalleCobro = k => { const t = [k.referencia ? 'Ref. ' + k.referencia : '', k.notas || ''].filter(Boolean).join(' · '); return t ? '<small>' + esc(t) + '</small>' : ''; };
  function cobranzaSoloPropios(r) {
    const pagos = r.cobros.length ? r.cobros.map(k => `
      <div class="pago-fila${k.cancelado ? ' cancelado' : ''}">
        <div><b>${formatoMoneda(k.monto)}</b> · ${esc(NOMBRE_METODO[k.metodo] || k.metodo)} · ${esc(fechaTxt(k.fecha))}${k.tipo !== 'pago' ? ' · ' + esc(k.tipo) : ''}
          ${detalleCobro(k)}
          ${k.cancelado ? `<small class="motivo">Cancelado: ${esc(k.motivo_cancelacion || '')}</small>` : `<span class="estado-cxc ${k.confirmado ? 'pagada' : 'por-confirmar'}">${k.confirmado ? 'Confirmado' : 'Por confirmar'}</span>`}
        </div>
      </div>`).join('') : '<p class="util-45">No has registrado pagos en esta orden.</p>';
    const puede = r.puede_registrar && r.orden.ejecucion !== 'no_realizado';
    return `<p class="ayuda">Aquí anotas lo que te pagó el cliente; administración lo confirma. Solo ves los pagos que tú registraste.</p>
      ${puede ? '<button type="button" class="btn btn-primario" data-cobranza="registrar">💵 Registrar pago</button>' : ''}
      <h4 class="pagos-titulo">Pagos que registraste</h4>
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
        dias_credito: $('fact-credito').value, factura_folio: $('fact-folio').value, factura_fecha: $('fact-fecha').value || null, factura_metodo: $('fact-metodo').value,
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

  async function cargar(opciones = {}) {
    // Quien solo ve una de las dos (p. ej. Nómina o Compras: solo por pagar) entra directo a la que sí ve, en vez de
    // quedarse con la pantalla en blanco.
    const pedida = opciones.seccion || (opciones.pestana ? (opciones.pestana === 'cobrar' ? 'cobrar' : 'pagar') : SECCION);
    if (!puedeCartera(pedida)) {
      const otra = pedida === 'cobrar' ? 'pagar' : 'cobrar';
      if (!puedeCartera(otra)) return;
      opciones = { ...opciones, seccion: otra, pestana: otra === 'cobrar' ? 'cobrar' : undefined };
    }
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
    // Cada tarjeta lleva «?»: la explicación sale debajo de las tarjetas (public/ayuda.js).
    const r = RESUMEN, t = (titulo, valor, detalle, clase = '', ayuda = '') => `<div class="tarjeta-dinero ${clase}"><small>${titulo}${Ayuda.boton(ayuda)}</small><b>${valor}</b>${detalle ? `<span>${detalle}</span>` : ''}</div>`;
    cont.innerHTML = SECCION === 'pagar'
      ? (r.pagar_semana !== undefined ? t('Pagar esta semana', formatoMoneda(r.pagar_semana), `${Number(r.facturas_semana)} facturas (incluye vencidas)`, r.pagar_semana > 0 ? 'aviso' : '', 'pagar_semana') : '')
        + (r.por_pagar !== undefined ? t('Total por pagar', formatoMoneda(r.por_pagar), '', '', 'por_pagar') : '')
        + (r.pagado_mes !== undefined ? t('Pagado este mes', formatoMoneda(r.pagado_mes), '', '', 'pagado_mes') : '')
      : t('Te deben', formatoMoneda(r.por_cobrar), `${Number(r.cuentas_con_saldo)} ${Number(r.cuentas_con_saldo) === 1 ? 'orden' : 'órdenes'} por cobrar`, '', 'te_deben')
      + t('Vencido', formatoMoneda(r.vencido), `${Number(r.clientes_con_vencido)} ${Number(r.clientes_con_vencido) === 1 ? 'cliente' : 'clientes'}`, r.vencido > 0 ? 'alerta' : '', 'vencido')
      + (r.por_concluir > 0 ? t('Por concluir', formatoMoneda(r.por_concluir), `${Number(r.ordenes_por_concluir)} ${Number(r.ordenes_por_concluir) === 1 ? 'servicio con fecha pasada' : 'servicios con fecha pasada'}: márcalos realizados para cobrarlos`, 'aviso', 'por_concluir') : '')
      + (r.programado > 0 ? t('Por realizar', formatoMoneda(r.programado), `${Number(r.ordenes_programadas)} ${Number(r.ordenes_programadas) === 1 ? 'servicio programado' : 'servicios programados'} (aún no se cobran)`, '', 'por_realizar') : '')
      + (r.a_favor > 0 ? t('A favor de clientes', formatoMoneda(r.a_favor), `${Number(r.ordenes_a_favor)} ${Number(r.ordenes_a_favor) === 1 ? 'servicio no realizado' : 'servicios no realizados'} con pago (devolver o aplicar)`, 'aviso', 'a_favor') : '')
      + t('Cobrado este mes', formatoMoneda(r.cobrado_mes), '', '', 'cobrado_mes')
      + (r.por_confirmar ? t('Por confirmar', formatoMoneda(r.por_confirmar.monto), `${Number(r.por_confirmar.cantidad)} pagos`, r.por_confirmar.cantidad ? 'aviso' : '', 'por_confirmar') : '');
    Ayuda.cerrar(cont);
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
        <div class="btn-group">${k.registrado_por !== USUARIO_ACTUAL?.id || cobroQuedaConfirmado() ? `<button type="button" class="btn btn-outline" data-confirmar="${Number(k.id)}">Confirmar</button>` : '<span class="ayuda">Lo registraste tú: lo confirma otra persona</span>'}<button type="button" class="btn btn-outline perm-dinero-mover" data-cancelar="${Number(k.id)}">Cancelar</button></div></div>`).join('')}</div>` : '';
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
  // Recordatorio de UNA orden: folio, servicio, cuándo se realizó, saldo y vencimiento.
  function textoWhatsAppOrden(c) {
    const realizado = c.ejecucion === 'realizado' && c.fecha_realizado ? ' realizado el ' + fechaTxt(c.fecha_realizado) : '';
    return 'Hola ' + (c.cliente_nombre || '') + ', le saludamos de Saneadren. Le recordamos el pago de su servicio ' + folioOS(c)
      + (c.servicio_nombre ? ' (' + c.servicio_nombre + realizado + ')' : realizado)
      + (c.factura_folio ? ', factura ' + c.factura_folio : '')
      + ' por ' + formatoMoneda(c.saldo) + (c.estado === 'parcial' ? ' (saldo pendiente)' : '')
      + (c.vencida ? ', que venció el ' + fechaTxt(c.vence) : ', con vencimiento el ' + fechaTxt(c.vence))
      + '. Si ya realizó el pago, puede enviarnos su comprobante por este medio. ¡Gracias!';
  }
  // Solo se recuerda lo que ya se debe: con saldo, servicio no programado a futuro y no marcado como no realizado.
  const sePuedeRecordar = c => c.saldo > 0 && !c.programada && c.ejecucion !== 'no_realizado';
  // Botón de recordatorio de una orden (con el teléfono y nombre del contacto si vienen aparte).
  const waOrden = (c, cliente) => sePuedeRecordar(c) ? botonWhatsApp(cliente ? cliente.telefono : c.telefono, textoWhatsAppOrden(cliente ? { ...c, cliente_nombre: cliente.nombre } : c), c.lead_id) : '';
  function botonWhatsApp(telefono, textoMsg, leadId) {
    const wa = enlaceWhatsApp(telefono, textoMsg);
    return wa ? `<a class="btn btn-outline btn-whatsapp" href="${esc(wa)}" target="_blank" rel="noopener noreferrer"${leadId ? ` data-wa-orden="${Number(leadId)}"` : ''}>💬 Recordar por WhatsApp</a>` : '';
  }
  // Al enviar el recordatorio de una orden queda anotado en su bitácora.
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-wa-orden]');
    if (a) registrarEventoSistema(Number(a.dataset.waOrden), 'Recordatorio de pago enviado por WhatsApp.');
  });
  function enlaceWhatsApp(telefono, textoMsg) {
    let d = String(telefono || '').replace(/\D/g, '');
    if (d.length === 10) d = '52' + d;
    return d.length >= 12 ? `https://wa.me/${d}?text=${encodeURIComponent(textoMsg)}` : '';
  }

  // ===================== Tablas de Cuentas por cobrar y por pagar =====================
  // Cada columna: { k, t: título, v(fila) → HTML ya escapado, s(fila) → valor para ordenar, n: numérica,
  // sum(fila) → se suma en el pie, fija: no se puede ocultar, sinOrden }. Las preferencias (columnas
  // ocultas, tabla o tarjetas) se recuerdan en el equipo.
  const TABLAS = {};
  const leerPref = (clave, def) => { try { const v = JSON.parse(localStorage.getItem(clave)); return v ?? def; } catch { return def; } };
  const guardarPref = (clave, v) => { try { localStorage.setItem(clave, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };
  const modoDe = id => leerPref('tabla-modo-' + id, matchMedia('(max-width:700px)').matches ? 'tarjetas' : 'tabla');
  const ocultasDe = id => new Set(leerPref('tabla-ocultas-' + id, TABLAS[id]?.ocultasDef || []));
  const ultimoPagoTxt = u => { if (!u) return '—'; const [f, m, r] = String(u).split('|'); return [fechaTxt(f), NOMBRE_METODO[m] || m, r].filter(Boolean).join(' · '); };
  function tablaHTML(id, columnas, filas, claseFila) {
    const ocultas = ocultasDe(id), visibles = columnas.filter(c => c.fija || !ocultas.has(c.k)), orden = TABLAS[id].orden;
    if (orden) {
      const col = columnas.find(c => c.k === orden.k);
      if (col) filas = [...filas].sort((a, b) => { const x = (col.s || col.v)(a), y = (col.s || col.v)(b); return (x > y ? 1 : x < y ? -1 : 0) * orden.dir; });
    }
    const celdaPie = (c, i) => {
      if (c.sum) { const total = filas.reduce((t, f) => t + (Number(c.sum(f)) || 0), 0); return '<b>' + formatoMoneda(total) + '</b>'; }
      return i === 0 ? '<b>Totales · ' + filas.length + '</b>' : '';
    };
    const encabezado = c => {
      const flecha = orden && orden.k === c.k ? (orden.dir > 0 ? ' ▲' : ' ▼') : '';
      const sort = orden && orden.k === c.k ? (orden.dir > 0 ? 'ascending' : 'descending') : 'none';
      return c.sinOrden ? '<th class="' + (c.clase || '') + '">' + esc(c.t) + '</th>' : '<th class="ordenable' + (c.n ? ' st-num' : '') + (c.clase ? ' ' + c.clase : '') + '" data-orden="' + esc(c.k) + '" aria-sort="' + sort + '" tabindex="0">' + esc(c.t) + flecha + '</th>';
    };
    const celda = (c, f) => '<td class="' + (c.n ? 'st-num' : '') + (c.clase ? ' ' + c.clase : '') + '">' + c.v(f) + '</td>';
    return '<div class="tabla-scroll tabla-dinero-caja"><table class="tabla-resumen tabla-dinero" data-tabla="' + esc(id) + '">'
      + '<thead><tr>' + visibles.map(encabezado).join('') + '</tr></thead>'
      + '<tbody>' + filas.map(f => '<tr class="' + (claseFila ? claseFila(f) : '') + '">' + visibles.map(c => celda(c, f)).join('') + '</tr>').join('') + '</tbody>'
      + (visibles.some(c => c.sum) ? '<tfoot><tr>' + visibles.map((c, i) => '<td class="' + (c.n ? 'st-num' : '') + (c.clase ? ' ' + c.clase : '') + '">' + celdaPie(c, i) + '</td>').join('') + '</tr></tfoot>' : '')
      + '</table></div>';
  }
  // Barra (Tabla / Tarjetas y Columnas) + la tabla o las tarjetas de siempre.
  function vistaDinero(id, { columnas, filas, claseFila, tarjetas, ocultasDef }) {
    TABLAS[id] = { ...TABLAS[id], columnas, filas, claseFila, tarjetas, ocultasDef };
    const modo = modoDe(id), ocultas = ocultasDe(id);
    const opciones = columnas.filter(c => !c.fija && c.t).map(c => '<label><input type="checkbox" data-tabla-col="' + esc(c.k) + '"' + (ocultas.has(c.k) ? '' : ' checked') + '> ' + esc(c.t) + '</label>').join('');
    const barra = '<div class="tabla-barra" data-tabla-barra="' + esc(id) + '">'
      + '<div class="segmentado" role="group" aria-label="Cómo ver la lista">'
      + '<button type="button" data-tabla-modo="tabla" aria-pressed="' + (modo === 'tabla') + '">▦ Tabla</button>'
      + '<button type="button" data-tabla-modo="tarjetas" aria-pressed="' + (modo === 'tarjetas') + '">☰ Tarjetas</button></div>'
      + (modo === 'tabla' ? '<details class="tabla-columnas"><summary>Columnas</summary><div class="tabla-columnas-lista">' + opciones + '<button type="button" class="btn btn-outline" data-tabla-cols-todas>Mostrar todas</button></div></details><span class="ayuda">Toca un título para ordenar.</span>' : '')
      + '</div>';
    return barra + (modo === 'tabla' ? tablaHTML(id, columnas, filas, claseFila) : tarjetas());
  }
  function repintarTabla(id) {
    const t = TABLAS[id]; if (!t) return;
    $(t.contenedor).innerHTML = vistaDinero(id, t);
  }
  document.addEventListener('click', e => {
    const caja = e.target.closest('[data-tabla-barra], .tabla-dinero'); if (!caja) return;
    const id = caja.dataset.tablaBarra || caja.dataset.tabla;
    const th = e.target.closest('th[data-orden]');
    if (th) { const o = TABLAS[id].orden; TABLAS[id].orden = { k: th.dataset.orden, dir: o && o.k === th.dataset.orden ? -o.dir : 1 }; repintarTabla(id); return; }
    const m = e.target.closest('[data-tabla-modo]');
    if (m) { guardarPref('tabla-modo-' + id, m.dataset.tablaModo); repintarTabla(id); return; }
    if (e.target.closest('[data-tabla-cols-todas]')) { guardarPref('tabla-ocultas-' + id, []); repintarTabla(id); }
  });
  document.addEventListener('keydown', e => {
    const th = e.target.closest?.('.tabla-dinero th[data-orden]');
    if (th && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); th.click(); }
  });
  document.addEventListener('change', e => {
    const cb = e.target.closest('[data-tabla-col]'); if (!cb) return;
    const id = cb.closest('[data-tabla-barra]').dataset.tablaBarra, ocultas = ocultasDe(id);
    if (cb.checked) ocultas.delete(cb.dataset.tablaCol); else ocultas.add(cb.dataset.tablaCol);
    guardarPref('tabla-ocultas-' + id, [...ocultas]);
    const abierto = true; repintarTabla(id);
    const det = document.querySelector('[data-tabla-barra="' + id + '"] .tabla-columnas'); if (det && abierto) det.open = true;
  });

  // Días: vencido (rojo), vence hoy o en N días; nada si no se cobra todavía o ya está pagado.
  const diasCobro = c => {
    if (c.saldo <= 0 || c.programada) return '—';
    if (c.dias_vencido > 0) return '<b class="rojo">' + Number(c.dias_vencido) + '</b>';
    return c.dias_vencido === 0 ? 'Vence hoy' : 'en ' + Number(-c.dias_vencido) + ' d';
  };
  const ejecucionCorta = c => c.ejecucion === 'realizado' ? 'Realizado ' + fechaTxt(c.fecha_realizado || c.fecha_servicio)
    : c.ejecucion === 'no_realizado' ? 'No realizado' : c.sin_marcar ? 'Facturado, sin marcar' : c.por_concluir ? 'Por concluir' : 'Programado';
  // Mismo orden que la plantilla de cobranza (COBRANZA_QRO_2026): SERIE-FOLIO, FECHA, NOMBRE, M.P., SUBTOTAL, IVA, TOTAL,
  // CRÉDITO, FECHA VENCE, DÍAS VENCIDOS, OS, STATUS, FECHA PAGO, CP, A/C, OBSERVACIONES; después, datos extra del CRM.
  const pagoParte = (u, n) => (u ? String(u).split('|')[n] || '' : '');
  const COLS_COBRAR = [
    { k: 'estado', t: 'Status', fija: true, v: c => etiquetaEstado(c), s: c => textoEstado(c)[1] },
    { k: 'factura', t: 'Factura', v: c => esc(c.factura_folio || '—'), s: c => c.factura_folio || '' },
    { k: 'fecha', t: 'Fecha', v: c => esc(fechaTxt(c.factura_fecha || c.fecha_realizado || c.fecha_servicio)), s: c => c.factura_fecha || c.fecha_realizado || c.fecha_servicio || '' },
    { k: 'cliente', t: 'Cliente', fija: true, v: c => '<button type="button" class="enlace-cliente" data-cliente-cuenta="' + Number(c.cliente_id) + '" title="Ver todo lo de este cliente">' + esc(c.cliente_nombre || 'Sin nombre') + ' ›</button><small class="celda-sub">' + esc([folioCliente(c.cliente_id), c.empresa_contacto].filter(Boolean).join(' · ')) + '</small>', s: c => String(c.cliente_nombre || '').toLowerCase() },
    { k: 'mp', t: 'M.P.', v: c => esc(c.factura_metodo || '—'), s: c => c.factura_metodo || '' },
    { k: 'subtotal', t: 'Subtotal', n: true, v: c => formatoMoneda(c.subtotal), s: c => c.subtotal, sum: c => c.subtotal },
    { k: 'iva', t: 'IVA', n: true, v: c => (c.iva == null ? '<small>Por definir</small>' : formatoMoneda(c.iva)), s: c => c.iva || 0, sum: c => c.iva || 0 },
    { k: 'total', t: 'Total', n: true, v: c => formatoMoneda(c.total), s: c => c.total, sum: c => c.total },
    { k: 'credito', t: 'Crédito', n: true, v: c => Number(c.dias_credito) + ' d', s: c => c.dias_credito },
    { k: 'vence', t: 'Fecha vence', v: c => (c.programada ? '—' : esc(fechaTxt(c.vence))), s: c => (c.programada ? '9999' : c.vence) },
    { k: 'dias', t: 'Días vencidos', n: true, v: diasCobro, s: c => (c.saldo > 0 && !c.programada ? c.dias_vencido : -99999) },
    { k: 'folio', t: 'OS', fija: true, v: c => '<b>' + esc(folioOS(c)) + '</b>', s: c => c.lead_id },
    { k: 'fecha_pago', t: 'Fecha pago', v: c => esc(c.ultimo_pago ? fechaTxt(pagoParte(c.ultimo_pago, 0)) : '—'), s: c => pagoParte(c.ultimo_pago, 0) },
    { k: 'cp', t: 'CP / referencia', v: c => esc(pagoParte(c.ultimo_pago, 2) || (c.ultimo_pago ? NOMBRE_METODO[pagoParte(c.ultimo_pago, 1)] || '' : '—')), s: c => pagoParte(c.ultimo_pago, 2) },
    { k: 'cobrado', t: 'A/C', n: true, v: c => formatoMoneda(c.cobrado), s: c => c.cobrado, sum: c => c.cobrado },
    { k: 'notas', t: 'Observaciones', clase: 'celda-notas', v: c => esc(c.notas || ''), s: c => c.notas || '' },
    { k: 'servicio', t: 'Servicio', v: c => esc(c.servicio_nombre || '—'), s: c => c.servicio_nombre || '' },
    { k: 'fecha_servicio', t: 'Fecha servicio', v: c => esc(fechaTxt(c.fecha_servicio)), s: c => c.fecha_servicio || '' },
    { k: 'ejecucion', t: 'Ejecución', v: c => esc(ejecucionCorta(c)), s: c => ejecucionCorta(c) },
    { k: 'equipo', t: 'Unidad', v: c => esc(c.equipo || '—'), s: c => c.equipo || '' },
    { k: 'operador', t: 'Operador', v: c => esc(c.operador || '—'), s: c => c.operador || '' },
    { k: 'proyecto', t: 'Proyecto', v: c => esc(c.proyecto || '—'), s: c => c.proyecto || '' },
    { k: 'rfc', t: 'RFC', v: c => esc(c.rfc || '—'), s: c => c.rfc || '' },
    { k: 'telefono', t: 'Teléfono', v: c => esc(c.telefono || '—'), s: c => c.telefono || '' },
    { k: 'a_favor', t: 'A favor', n: true, v: c => (c.a_favor > 0 ? formatoMoneda(c.a_favor) : '—'), s: c => c.a_favor || 0, sum: c => c.a_favor || 0 },
    { k: 'pagos_n', t: 'Pagos', n: true, v: c => String(Number(c.pagos_n || 0)), s: c => c.pagos_n || 0 },
    { k: 'saldo', t: 'Saldo', n: true, fija: true, clase: 'celda-saldo', v: c => '<b>' + formatoMoneda(c.saldo) + '</b>', s: c => c.saldo, sum: c => c.saldo },
    { k: 'acciones', t: '', fija: true, sinOrden: true, clase: 'celda-acciones', v: c => accionesOrden(c) },
  ];
  const accionesOrden = c => '<div class="acciones-fila">' + waOrdenCorto(c)
    + (c.saldo > 0 && c.ejecucion !== 'no_realizado' ? '<button type="button" class="btn btn-primario btn-chico" data-pagar-orden="' + Number(c.lead_id) + '" title="Registrar pago">💵 Pagar</button>' : '')
    + '<button type="button" class="btn btn-outline btn-chico" data-abrir-orden="' + Number(c.lead_id) + '" title="Abrir la orden">Abrir</button></div>';
  // WhatsApp de una orden, solo con el ícono (para la tabla).
  const waOrdenCorto = c => waOrden(c).replace('💬 Recordar por WhatsApp', '💬').replace('class="btn btn-outline btn-whatsapp"', 'class="btn btn-outline btn-whatsapp btn-chico" title="Recordar por WhatsApp"');
  async function cargarLista() {
    // Una sola lista: por orden (cada fila con su "Registrar pago").
    const cont = $('cobrar-lista'), vista = 'orden';
    cont.innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    const params = new URLSearchParams({ vista, filtro: FILTRO, q: $('cobrar-buscar').value.trim() });
    try { CARTERA = await api('/finanzas/cartera?' + params).then(json); }
    catch (err) { cont.innerHTML = `<div class="aviso-error-carga" role="alert"><p>No se pudo cargar: ${esc(err.message)}</p></div>`; return; }
    if (!CARTERA.length) { cont.innerHTML = '<p class="util-45">No hay cuentas con este filtro. 🎉</p>'; return; }
    const id = 'cobrar';
    TABLAS[id] = { ...TABLAS[id], contenedor: 'cobrar-lista' };
    cont.innerHTML = vistaDinero(id, { columnas: COLS_COBRAR, filas: CARTERA, claseFila: c => (c.vencida ? 'fila-vencida' : ''), tarjetas: tarjetasCobrar, ocultasDef: ['servicio', 'fecha_servicio', 'ejecucion', 'equipo', 'operador', 'proyecto', 'rfc', 'telefono', 'a_favor', 'pagos_n'] });
  }
  function tarjetasCobrar() {
    return CARTERA.map(c => `<div class="fila-dinero${c.vencida ? ' vencida' : ''}">
        <div class="info"><b>${esc(folioOS(c))}</b> · <button type="button" class="enlace-cliente" data-cliente-cuenta="${Number(c.cliente_id)}">${esc(c.cliente_nombre || 'Sin nombre')} ›</button> ${etiquetaEstado(c)}
          <small>${esc(c.servicio_nombre || 'Servicio')} · ${esc(textoEjecucion(c))}${c.programada ? '' : ' · vence ' + esc(fechaTxt(c.vence))}${c.factura_folio ? ' · factura ' + esc(c.factura_folio) : ' · sin factura'}</small></div>
        <div class="montos"><b>${formatoMoneda(c.saldo)}</b><small>de ${formatoMoneda(c.total)}</small></div>
        <div class="btn-group">
          ${waOrden(c)}
          ${c.saldo > 0 ? `<button type="button" class="btn btn-primario" data-pagar-orden="${Number(c.lead_id)}">Registrar pago</button>` : ''}
          <button type="button" class="btn btn-outline" data-abrir-orden="${Number(c.lead_id)}">Abrir orden</button>
        </div></div>`).join('');
  }
  $('cobrar-lista').addEventListener('click', async e => {
    const btn = e.target.closest('button'); if (!btn) return;
    if (btn.dataset.pagarOrden) return abrirCobro(Number(btn.dataset.pagarOrden), () => cargar());
    if (btn.dataset.abrirOrden) return abrirFicha(Number(btn.dataset.abrirOrden));
  });
  $('cobrar-exportar').addEventListener('click', () => {
    if (!CARTERA.length) { toast('No hay datos con este filtro para exportar'); return; }
    {
      descargarCSV('cuentas_por_cobrar_ordenes_' + hoy() + '.csv', [
        ...(Sucursales.varias() ? [{ titulo: 'Sucursal', valor: c => (globalThis.SUCURSALES_MAPA || {})[c.sucursal_id] || '' }] : []),
        { titulo: 'Factura', valor: c => c.factura_folio }, { titulo: 'Fecha', valor: c => c.factura_fecha || c.fecha_realizado || c.fecha_servicio }, { titulo: 'M.P.', valor: c => c.factura_metodo || '' }, { titulo: 'OS', valor: folioOS },
        { titulo: 'Cliente', valor: c => c.cliente_nombre }, { titulo: 'Empresa', valor: c => c.empresa_contacto }, { titulo: 'RFC', valor: c => c.rfc }, { titulo: 'Teléfono', valor: c => c.telefono },
        { titulo: 'Servicio', valor: c => c.servicio_nombre },
        { titulo: 'Fecha del servicio', valor: c => c.fecha_servicio },
        { titulo: 'Ejecución', valor: c => (c.ejecucion === 'realizado' ? 'Realizado' : c.ejecucion === 'no_realizado' ? 'No realizado' : c.sin_marcar ? 'Facturado, sin marcar' : c.por_concluir ? 'Por concluir' : 'Programado') },
        { titulo: 'Fecha realizado', valor: c => c.fecha_realizado },
        { titulo: 'Unidad', valor: c => c.equipo }, { titulo: 'Operador', valor: c => c.operador }, { titulo: 'Proyecto', valor: c => c.proyecto },
        { titulo: 'Subtotal', valor: c => c.subtotal.toFixed(2) }, { titulo: 'IVA', valor: c => (c.iva == null ? '' : c.iva.toFixed(2)) }, { titulo: 'Total', valor: c => c.total.toFixed(2) },
        { titulo: 'Crédito (días)', valor: c => c.dias_credito }, { titulo: 'Vence', valor: c => c.vence }, { titulo: 'Días vencido', valor: c => c.dias_vencido },
        { titulo: 'Cobrado (A/C)', valor: c => c.cobrado.toFixed(2) }, { titulo: 'Saldo', valor: c => c.saldo.toFixed(2) }, { titulo: 'A favor', valor: c => (c.a_favor || 0).toFixed(2) },
        { titulo: 'Último pago', valor: c => (c.ultimo_pago ? ultimoPagoTxt(c.ultimo_pago) : '') }, { titulo: 'Pagos', valor: c => c.pagos_n || 0 },
        { titulo: 'Estado', valor: c => textoEstado(c)[1] }, { titulo: 'Observaciones', valor: c => c.notas || '' }], CARTERA);
    }
  });


  // ===================== Ventana: estado de cuenta de un cliente =====================
  // Se abre al tocar un cliente en Cuentas por cobrar: todas sus órdenes (con o sin saldo) y todos sus pagos.
  let CUENTA_CLIENTE = null, VER_PAGADAS = false;
  async function abrirCuentaCliente(id) {
    CUENTA_CLIENTE = id; VER_PAGADAS = false;
    $('cc-cuerpo').innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    abrirVentana('overlay-cuenta-cliente');
    await pintarCuentaCliente();
  }
  async function pintarCuentaCliente() {
    const id = CUENTA_CLIENTE; let r;
    try { r = await api('/finanzas/clientes/' + Number(id) + '/estado-cuenta?completo=1').then(json); }
    catch (err) { $('cc-cuerpo').innerHTML = '<div class="aviso-error-carga" role="alert"><p>No se pudo cargar: ' + esc(err.message) + '</p></div>'; return; }
    if (id !== CUENTA_CLIENTE) return;
    const cli = r.cliente || {};
    $('cc-titulo').textContent = folioCliente(cli.id) + ' · ' + (cli.empresa_contacto || cli.nombre || 'Cliente');
    const deudas = r.ordenes.filter(sePuedeRecordar);
    const wa = deudas.length ? botonWhatsApp(cli.telefono, textoWhatsApp({ cliente_nombre: cli.nombre, saldo: deudas.reduce((t, c) => t + c.saldo, 0), vencido: r.vencido,
      folios: deudas.map(c => c.folio), proximo_vence: deudas.map(c => c.vence).sort()[0] })).replace('Recordar por WhatsApp', 'Recordar todo el saldo') : '';
    const t = (titulo, valor, clase = '', ayuda = '') => '<div class="cc-tarjeta ' + clase + '"><small>' + esc(titulo) + Ayuda.boton(ayuda) + '</small><b>' + valor + '</b></div>';
    const ordenes = VER_PAGADAS ? r.ordenes : r.ordenes.filter(c => c.saldo > 0 || c.a_favor > 0);
    const filaOrden = c => '<tr class="' + (c.vencida ? 'fila-vencida' : '') + '"><td><b>' + esc(c.folio) + '</b></td><td>' + esc(c.factura_folio || '—') + '</td>'
      + '<td>' + esc(c.servicio_nombre || '—') + '<small class="celda-sub">' + esc(ejecucionCorta(c)) + '</small></td>'
      + '<td class="st-num">' + formatoMoneda(c.total) + '</td><td class="st-num">' + formatoMoneda(c.cobrado) + '</td><td class="st-num"><b>' + formatoMoneda(c.saldo) + '</b></td>'
      + '<td>' + (c.programada ? '—' : esc(fechaTxt(c.vence))) + '</td><td class="st-num">' + diasCobro(c) + '</td><td>' + etiquetaEstado(c) + '</td>'
      + '<td class="celda-acciones"><div class="acciones-fila">' + (c.saldo > 0 && c.ejecucion !== 'no_realizado' ? '<button type="button" class="btn btn-primario btn-chico" data-cc-pagar="' + Number(c.lead_id) + '">Registrar pago</button>' : '')
      + '<button type="button" class="btn btn-outline btn-chico" data-cc-abrir="' + Number(c.lead_id) + '">Abrir</button></div></td></tr>';
    const TIPO = { pago: 'Pago', anticipo: 'Anticipo', ajuste: 'Descuento / ajuste' };
    const filaPago = k => '<tr class="' + (k.cancelado ? 'fila-cancelada' : '') + '"><td>' + esc(fechaTxt(k.fecha)) + '</td><td><b>' + esc(k.folio) + '</b></td>'
      + '<td class="st-num">' + formatoMoneda(k.monto) + '</td><td>' + esc(TIPO[k.tipo] || k.tipo) + '</td><td>' + esc(NOMBRE_METODO[k.metodo] || k.metodo) + '</td>'
      + '<td>' + esc(k.referencia || '—') + '</td><td>' + (k.cancelado ? '<span class="estado-cxc vencida" title="' + esc(k.motivo_cancelacion || '') + '">Cancelado</span>' : k.confirmado ? '<span class="estado-cxc pagada">Confirmado</span>' : '<span class="estado-cxc parcial">Por confirmar</span>') + '</td>'
      + '<td>' + esc(k.registrado_por_nombre || '') + '</td></tr>';
    const vivos = r.cobros.filter(k => !k.cancelado);
    $('cc-sub').textContent = [cli.empresa_contacto, cli.telefono, cli.rfc ? 'RFC ' + cli.rfc : ''].filter(Boolean).join(' · ');
    $('cc-cuerpo').innerHTML =
      '<p class="cc-aviso">👤 Estás viendo el <b>estado de cuenta completo</b> de este cliente: todas sus órdenes y todos sus pagos. Cierra esta ventana para volver a la lista general.</p>'
      + '<div class="cc-tarjetas" data-ayuda-zona>' + t('Debe hoy', formatoMoneda(r.saldo), r.saldo > 0 ? 'aviso' : '', 'debe_hoy') + t('Vencido', formatoMoneda(r.vencido), r.vencido > 0 ? 'alerta' : '', 'vencido')
      + t('Por realizar', formatoMoneda(r.programado), '', 'por_realizar') + (r.por_concluir > 0 ? t('Por concluir', formatoMoneda(r.por_concluir), '', 'por_concluir') : '') + (r.a_favor > 0 ? t('A favor del cliente', formatoMoneda(r.a_favor), 'favor', 'a_favor') : '')
      + t('Pagado en total', formatoMoneda(r.pagado), '', 'pagado_total') + '<div class="cc-tarjeta"><small>Crédito</small><b>' + Number(r.dias_credito) + ' días</b>' + (puedeEditarFactura() ? '<button type="button" class="enlace" data-cc-credito>Cambiar</button>' : '') + '</div></div>'
      + '<div class="btn-group cc-acciones">' + wa + '<button type="button" class="btn btn-outline" data-cc-ficha>Abrir ficha del contacto</button></div>'
      + '<div class="cc-seccion"><div class="cc-seccion-cab"><h3>Órdenes de servicio</h3><label class="cc-check"><input type="checkbox" data-cc-pagadas' + (VER_PAGADAS ? ' checked' : '') + '> Mostrar también las pagadas</label></div>'
      + (ordenes.length ? '<div class="tabla-scroll tabla-dinero-caja"><table class="tabla-resumen tabla-dinero"><thead><tr><th>OS</th><th>Factura</th><th>Servicio</th><th class="st-num">Total</th><th class="st-num">A/C</th><th class="st-num">Saldo</th><th>Vence</th><th class="st-num">Días</th><th>Status</th><th></th></tr></thead><tbody>'
        + ordenes.map(filaOrden).join('') + '</tbody><tfoot><tr><td colspan="3"><b>Totales · ' + ordenes.length + '</b></td><td class="st-num"><b>' + formatoMoneda(ordenes.reduce((s, c) => s + c.total, 0)) + '</b></td><td class="st-num"><b>' + formatoMoneda(ordenes.reduce((s, c) => s + c.cobrado, 0)) + '</b></td><td class="st-num"><b>' + formatoMoneda(ordenes.reduce((s, c) => s + c.saldo, 0)) + '</b></td><td colspan="4"></td></tr></tfoot></table></div>'
        : '<p class="util-45">' + (VER_PAGADAS ? 'Este cliente no tiene órdenes de servicio.' : 'No debe nada. 🎉 Marca «Mostrar también las pagadas» para ver su historial.') + '</p>')
      + '</div><div class="cc-seccion"><div class="cc-seccion-cab"><h3>Pagos realizados</h3><span class="ayuda">' + vivos.length + ' ' + (vivos.length === 1 ? 'pago' : 'pagos') + '</span></div>'
      + (r.cobros.length ? '<div class="tabla-scroll tabla-dinero-caja"><table class="tabla-resumen tabla-dinero"><thead><tr><th>Fecha</th><th>OS</th><th class="st-num">Monto</th><th>Tipo</th><th>Método</th><th>CP / referencia</th><th>Estado</th><th>Registró</th></tr></thead><tbody>'
        + r.cobros.map(filaPago).join('') + '</tbody></table></div>' : '<p class="util-45">Todavía no hay pagos registrados.</p>') + '</div>';
  }
  $('cobrar-lista').addEventListener('click', e => { const b = e.target.closest('[data-cliente-cuenta]'); if (b) abrirCuentaCliente(Number(b.dataset.clienteCuenta)); });
  $('cc-cuerpo').addEventListener('change', e => { if (e.target.closest('[data-cc-pagadas]')) { VER_PAGADAS = e.target.checked; pintarCuentaCliente(); } });
  $('cc-cuerpo').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ccPagar) return abrirCobro(Number(b.dataset.ccPagar), () => { pintarCuentaCliente(); cargar(); });
    if (b.dataset.ccAbrir) return abrirFicha(Number(b.dataset.ccAbrir));
    if (b.dataset.ccFicha !== undefined) return abrirFichaCliente(CUENTA_CLIENTE);
    if (b.dataset.ccCredito !== undefined) {
      const id = CUENTA_CLIENTE;
      const dias = await solicitarDialogo({ titulo: 'Días de crédito del cliente', mensaje: 'Se aplica a sus órdenes NUEVAS (0 = contado). Las órdenes existentes conservan el suyo; cámbialo en cada orden (Crédito y factura) si hace falta.', aceptar: 'Guardar', campo: { tipo: 'number', etiqueta: 'Días (0 a 180)' } });
      if (dias === null) return;
      conBoton(b, async () => { await json(await api('/finanzas/clientes/' + Number(id) + '/credito', { method: 'PUT', body: JSON.stringify({ dias_credito: dias }) })); toast('Crédito del cliente actualizado'); pintarCuentaCliente(); });
    }
  });

  // ===================== Ventana: ficha del proveedor =====================
  // Igual que el estado de cuenta del cliente: cuánto se le debe, todas sus facturas, todos los pagos,
  // sus órdenes de compra, las cotizaciones que ha mandado y los cambios a sus datos.
  let CUENTA_PROV = null, CUENTA_PROV_DATOS = null, PROV_VER_PAGADAS = false;
  async function abrirCuentaProveedor(id) {
    CUENTA_PROV = Number(id); PROV_VER_PAGADAS = false; CUENTA_PROV_DATOS = null;
    $('cp-titulo').textContent = 'Proveedor'; $('cp-sub').textContent = '';
    $('cp-cuerpo').innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    abrirVentana('overlay-cuenta-proveedor');
    await pintarCuentaProveedor();
  }
  window.abrirCuentaProveedor = abrirCuentaProveedor;
  const refrescarFichaProv = () => { if (CUENTA_PROV && $('overlay-cuenta-proveedor').classList.contains('mostrar')) pintarCuentaProveedor(); };
  const COMPROBANTE_TXT = { factura: 'Factura', recibo: 'Recibo', estado_cuenta: 'Estado de cuenta', linea_captura: 'Línea de captura', nomina: 'Nómina', pagadora: 'Pagadora', sin_factura: 'Sin factura', informativo: 'Informativo', otro: 'Otro' };
  const ESTADO_OC = { borrador: 'Por autorizar', autorizada: 'Autorizada', cancelada: 'Cancelada' };
  async function pintarCuentaProveedor() {
    const id = CUENTA_PROV; let r;
    try { r = await api('/finanzas/proveedores/' + id + '/estado-cuenta').then(json); }
    catch (err) { $('cp-cuerpo').innerHTML = '<div class="aviso-error-carga" role="alert"><p>No se pudo cargar: ' + esc(err.message) + '</p></div>'; return; }
    if (id !== CUENTA_PROV) return;
    CUENTA_PROV_DATOS = r;
    if (!CATEGORIAS.length) { try { await catalogosPagos(); } catch {} }
    const p = r.proveedor, cat = (CATEGORIAS.find(c => c.clave === p.categoria) || {}).nombre || p.categoria;
    $('cp-titulo').textContent = p.nombre + (p.activo ? '' : ' (inactivo)');
    $('cp-sub').textContent = [cat, p.rfc ? 'RFC ' + p.rfc : '', p.contacto, p.telefono].filter(Boolean).join(' · ');
    const t = (titulo, valor, clase = '', ayuda = '') => '<div class="cc-tarjeta ' + clase + '"><small>' + esc(titulo) + Ayuda.boton(ayuda) + '</small><b>' + valor + '</b></div>';
    const cuentas = PROV_VER_PAGADAS ? r.cuentas : r.cuentas.filter(x => x.saldo > 0);
    const estado = x => x.saldo <= 0 ? '<span class="estado-cxc pagada">Pagada ✓</span>' : x.vencida ? '<span class="estado-cxc vencida">Vencida hace ' + Number(-x.dias_para_vencer) + ' d</span>'
      : x.dias_para_vencer === 0 ? '<span class="estado-cxc parcial">Vence hoy</span>' : '<span class="estado-cxc programada">En ' + Number(x.dias_para_vencer) + ' d</span>';
    const filaCuenta = x => '<tr class="' + (x.vencida ? 'fila-vencida' : '') + '"><td>' + esc(fechaTxt(x.fecha_documento)) + '</td><td><b>' + esc(x.concepto) + '</b><small class="celda-sub">' + esc(x.categoria_nombre)
      + (x.es_gasto ? '' : ' · no es gasto') + (x.beneficiario ? ' · pagar a ' + esc(x.beneficiario) : '') + '</small></td>'
      + '<td>' + esc(x.factura_folio || '—') + '<small class="celda-sub">' + esc(COMPROBANTE_TXT[x.tipo_comprobante] || '') + (x.metodo_sat ? ' ' + esc(x.metodo_sat) : '') + '</small></td>'
      + '<td>' + (x.lead_id ? '<button type="button" class="enlace" data-cp-orden="' + Number(x.lead_id) + '">' + esc(x.orden_folio) + '</button>' : '—') + '</td>'
      + '<td class="st-num">' + formatoMoneda(x.total) + '</td><td class="st-num">' + formatoMoneda(x.pagado) + '</td><td class="st-num"><b>' + formatoMoneda(x.saldo) + '</b></td>'
      + '<td>' + esc(fechaTxt(x.fecha_vencimiento)) + '<small class="celda-sub">' + Math.max(0, Math.round((Date.parse(x.fecha_vencimiento) - Date.parse(x.fecha_documento)) / 86400000)) + ' días de crédito</small></td><td>' + estado(x) + '</td>'
      + '<td class="celda-acciones"><div class="acciones-fila">' + (x.saldo > 0 ? '<button type="button" class="btn btn-primario btn-chico perm-dinero-mover" data-cp-pagar="' + Number(x.id) + '">Pagar</button>' : '')
      + '<button type="button" class="btn btn-outline btn-chico" data-cp-pagos="' + Number(x.id) + '">Pagos</button></div></td></tr>';
    const filaPago = g => '<tr class="' + (g.cancelado ? 'fila-cancelada' : '') + '"><td>' + esc(fechaTxt(g.fecha)) + '</td><td>' + esc(g.concepto) + (g.factura_folio ? '<small class="celda-sub">Factura ' + esc(g.factura_folio) + '</small>' : '') + '</td>'
      + '<td class="st-num">' + formatoMoneda(g.monto) + '</td><td>' + esc(NOMBRE_METODO[g.metodo] || g.metodo) + '</td><td>' + esc(g.cuenta_origen || '—') + '</td><td>' + esc(g.referencia || '—') + '</td>'
      + '<td>' + (g.cancelado ? '<span class="estado-cxc vencida" title="' + esc(g.motivo_cancelacion || '') + '">Cancelado</span>' : '<span class="estado-cxc pagada">Pagado</span>') + '</td><td>' + esc(g.registrado_por_nombre || '') + '</td></tr>';
    const filaOC = o => '<tr class="' + (o.estado === 'cancelada' ? 'fila-cancelada' : '') + '"><td><button type="button" class="enlace" data-cp-oc="' + Number(o.id) + '"><b>' + esc(o.folio) + '</b></button></td><td>' + esc(fechaTxt(o.fecha)) + '</td>'
      + '<td>' + esc(o.solicitud_folio || 'Sin solicitud') + '</td><td class="st-num">' + formatoMoneda(o.total) + '</td><td>' + esc(ESTADO_OC[o.estado] || o.estado) + '</td>'
      + '<td>' + (o.recibida ? '<span class="estado-cxc pagada">Recibida ' + esc(fechaTxt(String(o.recibida_at).slice(0, 10))) + '</span>' : o.estado === 'autorizada' ? '<span class="estado-cxc parcial">Por recibir</span>' : '—') + '</td></tr>';
    const filaCot = c => '<tr><td>' + esc(fechaTxt(c.fecha)) + '</td><td><button type="button" class="enlace" data-cp-sol="' + Number(c.solicitud_id) + '"><b>' + esc(c.solicitud_folio) + '</b></button><small class="celda-sub">' + esc(c.que) + '</small></td>'
      + '<td class="st-num">' + (c.monto == null ? '—' : formatoMoneda(c.monto)) + '</td><td>' + esc(c.entrega || '—') + '</td>'
      + '<td>' + (c.gano ? '<span class="estado-cxc pagada">Ganó ✓</span>' : c.decidida ? '<span class="estado-cxc vencida">No se eligió</span>' : '<span class="estado-cxc programada">En revisión</span>') + '</td></tr>';
    const tabla = (cab, filas) => '<div class="tabla-scroll tabla-dinero-caja"><table class="tabla-resumen tabla-dinero"><thead><tr>' + cab.map(c => '<th' + (c.startsWith('$') ? ' class="st-num">' + esc(c.slice(1)) : '>' + esc(c)) + '</th>').join('') + '</tr></thead><tbody>' + filas + '</tbody></table></div>';
    const seccion = (titulo, extra, cuerpo) => '<div class="cc-seccion"><div class="cc-seccion-cab"><h3>' + esc(titulo) + '</h3>' + extra + '</div>' + cuerpo + '</div>';
    const ganadas = r.cotizaciones.filter(c => c.gano).length;
    const vivos = r.pagos.filter(g => !g.cancelado);
    $('cp-cuerpo').innerHTML =
      '<p class="cc-aviso">🏭 Estás viendo la <b>ficha completa</b> de este proveedor: lo que se le debe, sus facturas, los pagos, sus órdenes de compra y sus cotizaciones. Cierra esta ventana para volver.</p>'
      + '<div class="cc-tarjetas">' + t('Le debemos', formatoMoneda(r.debe), r.debe > 0 ? 'aviso' : '') + t('Vencido', formatoMoneda(r.vencido), r.vencido > 0 ? 'alerta' : '')
      + t('Vence en 7 días', formatoMoneda(r.esta_semana)) + t('Pagado en total', formatoMoneda(r.pagado)) + t('Comprado en total', formatoMoneda(r.comprado))
      + t('Crédito', Number(p.dias_credito) + ' días') + '</div>'
      // Banco y CLABE solo para quien paga (decisión 2026-10-22); a los demás el servidor ni siquiera los manda.
      + '<div class="cp-datos">' + (Permisos.puede('dinero.mover') ? '<div><small>Banco</small><b>' + esc(p.banco || '—') + '</b></div><div><small>CLABE</small><b>' + esc(p.clabe || '—') + '</b>'
      + (p.clabe ? ' <button type="button" class="enlace" data-cp-copiar="' + esc(p.clabe) + '">Copiar</button>' : '') + '</div>' : '')
      + '<div><small>Último pago</small><b>' + (r.ultimo_pago ? esc(fechaTxt(r.ultimo_pago.fecha)) + ' · ' + formatoMoneda(r.ultimo_pago.monto) : '—') + '</b></div>'
      + '<div><small>Cotizaciones</small><b>' + r.cotizaciones.length + ' enviadas · ' + ganadas + ' ganadas</b></div></div>'
      + (p.notas ? '<p class="ayuda">📝 ' + esc(p.notas) + '</p>' : '')
      + '<div class="btn-group cc-acciones"><button type="button" class="btn btn-outline perm-dinero-mover" data-cp-editar>Editar datos del proveedor</button></div>'
      + seccion('Facturas y gastos', '<label class="cc-check"><input type="checkbox" data-cp-pagadas' + (PROV_VER_PAGADAS ? ' checked' : '') + '> Mostrar también las pagadas</label>',
        cuentas.length ? tabla(['Fecha', 'Concepto', 'Factura', 'Orden', '$Total', '$Pagado', '$Saldo', 'Vence', 'Status', ''], cuentas.map(filaCuenta).join(''))
          + '<p class="ayuda cp-total">Totales · ' + cuentas.length + ': ' + formatoMoneda(cuentas.reduce((s, x) => s + x.total, 0)) + ' · pagado ' + formatoMoneda(cuentas.reduce((s, x) => s + x.pagado, 0)) + ' · saldo <b>' + formatoMoneda(cuentas.reduce((s, x) => s + x.saldo, 0)) + '</b></p>'
          : '<p class="util-45">' + (PROV_VER_PAGADAS || !r.cuentas.length ? 'Este proveedor no tiene facturas ni gastos registrados.' : 'No se le debe nada. 🎉 Marca «Mostrar también las pagadas» para ver su historial.') + '</p>')
      + seccion('Pagos realizados', '<span class="ayuda">' + vivos.length + ' ' + (vivos.length === 1 ? 'pago' : 'pagos') + '</span>',
        r.pagos.length ? tabla(['Fecha', 'Qué se pagó', '$Monto', 'Vía', 'Cuenta de salida', 'Referencia', 'Estado', 'Registró'], r.pagos.map(filaPago).join('')) : '<p class="util-45">Todavía no hay pagos.</p>')
      + seccion('Órdenes de compra', '<span class="ayuda">' + r.ordenes.length + '</span>',
        r.ordenes.length ? tabla(['Folio', 'Fecha', 'Solicitud', '$Total', 'Estado', 'Recepción'], r.ordenes.map(filaOC).join('')) : '<p class="util-45">Sin órdenes de compra.</p>')
      + seccion('Cotizaciones que ha mandado', '<span class="ayuda">' + ganadas + ' de ' + r.cotizaciones.length + ' ganadas</span>',
        r.cotizaciones.length ? tabla(['Fecha', 'Solicitud', '$Monto', 'Entrega', 'Resultado'], r.cotizaciones.map(filaCot).join('')) : '<p class="util-45">No ha mandado cotizaciones en solicitudes de compra.</p>')
      + seccion('Historial de cambios a sus datos', '',
        r.historial.length ? '<ul class="cp-historial">' + r.historial.map(h => '<li><b>' + esc(fechaTxt(String(h.fecha).slice(0, 10))) + ' ' + esc(String(h.fecha).slice(11, 16)) + '</b> · ' + esc(h.usuario || '—') + ' · ' + esc(h.accion) + (h.detalle ? '<small>' + esc(h.detalle) + '</small>' : '') + '</li>').join('') + '</ul>' : '<p class="util-45">Sin cambios registrados.</p>');
  }
  $('cp-cuerpo').addEventListener('change', e => { if (e.target.closest('[data-cp-pagadas]')) { PROV_VER_PAGADAS = e.target.checked; pintarCuentaProveedor(); } });
  $('cp-cuerpo').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const cerrarCp = () => $('overlay-cuenta-proveedor').classList.remove('mostrar');
    if (b.dataset.cpPagar || b.dataset.cpPagos) return abrirPagoProveedor(Number(b.dataset.cpPagar || b.dataset.cpPagos), !!b.dataset.cpPagar);
    if (b.dataset.cpOrden) return abrirFicha(Number(b.dataset.cpOrden));
    if (b.dataset.cpOc) { cerrarCp(); cambiarVista('compras'); return Compras.abrir(Number(b.dataset.cpOc)); }
    if (b.dataset.cpSol) { cerrarCp(); cambiarVista('solicitudes'); return Solicitudes.abrir(Number(b.dataset.cpSol)); }
    if (b.dataset.cpCopiar) { try { await navigator.clipboard.writeText(b.dataset.cpCopiar); toast('CLABE copiada'); } catch { toast('No se pudo copiar'); } return; }
    if (b.dataset.cpEditar !== undefined) {
      const id = CUENTA_PROV; cerrarCp(); cambiarVista('cuentas', { pestana: 'proveedores' });
      for (let i = 0; i < 50; i++) { const el = document.querySelector('[data-editar-prov="' + id + '"]'); if (el) { el.click(); el.closest('.fila-dinero')?.scrollIntoView({ block: 'center' }); return; } await new Promise(r => setTimeout(r, 120)); }
    }
  });

  // ---------- Por pagar ----------
  let CXP = [], PAGO_PROV = null, PROVEEDORES = [], CATEGORIAS = [];
  async function catalogosPagos() {
    [PROVEEDORES, CATEGORIAS] = await Promise.all([api('/finanzas/proveedores').then(json), api('/finanzas/categorias').then(json)]);
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
    const cuando = x => (grupos.find(([, f]) => f(x)) || ['Pagadas'])[0];
    const COLS_PAGAR = [
      { k: 'cuando', t: 'Cuándo', fija: true, v: x => { const g = cuando(x); const cl = g === 'Vencidas' ? 'vencida' : g === 'Pagadas' ? 'pagada' : g === 'Esta semana' ? 'parcial' : 'programada';
        return '<span class="estado-cxc ' + cl + '">' + esc(g === 'Vencidas' ? 'Vencida hace ' + Number(-x.dias_para_vencer) + ' d' : g === 'Pagadas' ? 'Pagada ✓' : g) + '</span>'; }, s: x => (x.saldo > 0 ? x.fecha_vencimiento : '9999') },
      { k: 'proveedor', t: 'Proveedor', fija: true, v: x => '<button type="button" class="enlace enlace-fuerte" data-prov-cuenta="' + Number(x.proveedor_id) + '" title="Ver la ficha del proveedor">' + esc(x.proveedor_nombre) + '</button>', s: x => String(x.proveedor_nombre).toLowerCase() },
      { k: 'categoria', t: 'Categoría', v: x => esc(x.categoria_nombre), s: x => x.categoria_nombre },
      { k: 'concepto', t: 'Concepto', v: x => esc(x.concepto), s: x => x.concepto },
      { k: 'factura', t: 'Factura', v: x => esc(x.factura_folio || '—'), s: x => x.factura_folio || '' },
      { k: 'fecha', t: 'Fecha', v: x => esc(fechaTxt(x.fecha_documento)), s: x => x.fecha_documento },
      { k: 'vence', t: 'Vence', v: x => esc(fechaTxt(x.fecha_vencimiento)), s: x => x.fecha_vencimiento },
      { k: 'dias', t: 'Días', n: true, v: x => (x.saldo <= 0 ? '—' : x.dias_para_vencer < 0 ? '<b class="rojo">' + Number(-x.dias_para_vencer) + ' vencida</b>' : x.dias_para_vencer === 0 ? 'Hoy' : 'en ' + Number(x.dias_para_vencer) + ' d'), s: x => (x.saldo > 0 ? x.dias_para_vencer : 99999) },
      { k: 'orden', t: 'Orden', v: x => (x.lead_id ? '<button type="button" class="enlace" data-abrir-orden-cxp="' + Number(x.lead_id) + '">' + esc(x.orden_folio) + '</button>' : '—'), s: x => x.orden_folio || '' },
      { k: 'equipo', t: 'Unidad', v: x => esc(x.equipo || '—'), s: x => x.equipo || '' },
      { k: 'total', t: 'Total', n: true, v: x => formatoMoneda(x.total), s: x => x.total, sum: x => x.total },
      { k: 'iva', t: 'IVA', n: true, v: x => (x.es_factura ? formatoMoneda(x.iva) + (x.iva_estimado ? '<small class="celda-sub">estimado 16 %</small>' : '') : '—'), s: x => x.iva, sum: x => x.iva },
      { k: 'pagado', t: 'Pagado', n: true, v: x => formatoMoneda(x.pagado), s: x => x.pagado, sum: x => x.pagado },
      { k: 'saldo', t: 'Saldo', n: true, fija: true, v: x => '<b>' + formatoMoneda(x.saldo) + '</b>', s: x => x.saldo, sum: x => x.saldo },
      { k: 'ultimo_pago', t: 'Último pago', v: x => esc(ultimoPagoTxt(x.ultimo_pago)), s: x => x.ultimo_pago || '' },
      { k: 'notas', t: 'Notas', clase: 'celda-notas', v: x => esc(x.notas || ''), s: x => x.notas || '' },
      { k: 'acciones', t: '', fija: true, sinOrden: true, clase: 'celda-acciones', v: x => '<div class="acciones-fila">' + (x.saldo > 0 ? '<button type="button" class="btn btn-primario btn-chico perm-dinero-mover" data-pagar-cxp="' + Number(x.id) + '">Pagar</button>' : '')
        + '<button type="button" class="btn btn-outline btn-chico" data-detalle-cxp="' + Number(x.id) + '">Pagos</button>'
        + (x.es_factura ? '<button type="button" class="btn btn-outline btn-chico perm-dinero-mover" data-iva-cxp="' + Number(x.id) + '" title="Capturar o corregir el IVA de la factura">IVA</button>' : '')
        + (x.pagado === 0 ? '<button type="button" class="btn btn-outline btn-chico perm-dinero-mover" data-cancelar-cxp="' + Number(x.id) + '">Cancelar</button>' : '') + '</div>' },
    ];
    if (!CXP.length) { cont.innerHTML = '<p class="util-45">No hay cuentas por pagar. 🎉</p>'; return; }
    TABLAS.pagar = { ...TABLAS.pagar, contenedor: 'pagar-lista', orden: TABLAS.pagar?.orden || { k: 'vence', dir: 1 } };
    cont.innerHTML = vistaDinero('pagar', { columnas: COLS_PAGAR, filas: CXP, claseFila: x => (cuando(x) === 'Vencidas' ? 'fila-vencida' : ''), tarjetas: () => tarjetasPagar(), ocultasDef: ['fecha', 'equipo', 'notas'] });
    function tarjetasPagar() {
    const html = grupos.map(([titulo, f]) => {
      const items = CXP.filter(f);
      if (!items.length) return '';
      const subtotal = items.reduce((t, x) => t + x.saldo, 0);
      return `<h3 class="grupo-pagos">${titulo} <small>${items.length} · ${formatoMoneda(subtotal)}</small></h3>` + items.map(x => `
        <div class="fila-dinero${titulo === 'Vencidas' ? ' vencida' : ''}">
          <div class="info"><button type="button" class="enlace enlace-fuerte" data-prov-cuenta="${Number(x.proveedor_id)}">${esc(x.proveedor_nombre)}</button> · ${esc(x.concepto)}
            <small>${esc(x.categoria_nombre)} · vence ${esc(fechaTxt(x.fecha_vencimiento))}${x.factura_folio ? ' · factura ' + esc(x.factura_folio) : ''}${x.orden_folio ? ' · orden ' + esc(x.orden_folio) : ''}${x.equipo ? ' · ' + esc(x.equipo) : ''}</small></div>
          <div class="montos"><b>${formatoMoneda(x.saldo)}</b><small>de ${formatoMoneda(x.total)}</small></div>
          <div class="btn-group">${x.saldo > 0 ? `<button type="button" class="btn btn-primario perm-dinero-mover" data-pagar-cxp="${Number(x.id)}">Pagar</button>` : ''}<button type="button" class="btn btn-outline" data-detalle-cxp="${Number(x.id)}">Pagos</button>
            ${x.pagado === 0 ? `<button type="button" class="btn btn-outline perm-dinero-mover" data-cancelar-cxp="${Number(x.id)}">Cancelar</button>` : ''}</div>
        </div>`).join('');
    }).join('');
    return html || '<p class="util-45">No hay cuentas por pagar. 🎉</p>';
    }
  }
  $('pagar-vista').addEventListener('change', cargarPagar);
  $('pagar-lista').addEventListener('click', async e => {
    const btn = e.target.closest('button'); if (!btn) return;
    if (btn.dataset.abrirOrdenCxp) return abrirFicha(Number(btn.dataset.abrirOrdenCxp));
    if (btn.dataset.provCuenta) return abrirCuentaProveedor(Number(btn.dataset.provCuenta));
    const id = Number(btn.dataset.pagarCxp || btn.dataset.detalleCxp || btn.dataset.cancelarCxp || btn.dataset.ivaCxp);
    if (btn.dataset.ivaCxp) {
      const x = CXP.find(c => c.id === id); if (!x) return;
      const v = await solicitarDialogo({ titulo: 'IVA de la factura', mensaje: `«${x.concepto}» · total ${formatoMoneda(x.total)}. ${x.iva_estimado ? 'No se capturó: se estima en ' : 'Capturado: '}${formatoMoneda(x.iva)}. Escribe el IVA que trae la factura (0 si es tasa 0 o exenta).`, aceptar: 'Guardar', campo: { etiqueta: 'IVA (MXN)', requerido: 'Escribe el IVA (0 si no trae)' } });
      if (v === null) return;
      return conBoton(btn, async () => { await json(await api('/finanzas/cxp/' + id + '/iva', { method: 'POST', body: JSON.stringify({ iva: v.trim() }) })); toast('IVA guardado'); cargar({ pestana: 'pagar' }); });
    }
    if (btn.dataset.cancelarCxp) {
      const motivo = await pedirMotivo('Cancelar cuenta por pagar'); if (!motivo) return;
      return conBoton(btn, async () => { await json(await api('/finanzas/cxp/' + id + '/cancelar', { method: 'POST', body: JSON.stringify({ motivo }) })); toast('Cuenta cancelada'); cargar({ pestana: 'pagar' }); });
    }
    abrirPagoProveedor(id, !!btn.dataset.pagarCxp);
  });
  async function abrirPagoProveedor(id, paraPagar) {
    let x = CXP.find(c => c.id === id);
    const enFicha = (CUENTA_PROV_DATOS?.cuentas || []).find(c => c.id === id);
    if (!x && enFicha) x = { ...enFicha, proveedor_nombre: CUENTA_PROV_DATOS.proveedor.nombre };
    if (!x) return;
    PAGO_PROV = x;
    $('pagoprov-info').textContent = `${x.proveedor_nombre} · ${x.concepto} · Saldo ${formatoMoneda(x.saldo)}`;
    $('pagoprov-monto').value = x.saldo > 0 ? x.saldo.toFixed(2) : '';
    pintarMetodos('pagoprov-metodos', 'transferencia', METODOS_PROV);
    $('pagoprov-fecha').value = hoy(); $('pagoprov-fecha').max = hoy(); $('pagoprov-referencia').value = ''; $('pagoprov-cuenta').value = '';
    $('pagoprov-guardar').disabled = x.saldo <= 0;
    [$('pagoprov-monto'), $('pagoprov-fecha'), $('pagoprov-referencia'), $('pagoprov-guardar')].forEach(el => { el.closest('.campo') ? (el.closest('.campo').hidden = !paraPagar) : (el.hidden = !paraPagar); });
    $('pagoprov-metodos').closest('.campo').hidden = !paraPagar;
    $('pagoprov-historial').innerHTML = '<p class="util-45">Cargando pagos…</p>';
    abrirVentana('overlay-pago-prov');
    const pagos = await api('/finanzas/cxp/' + id + '/pagos').then(json).catch(() => []);
    $('pagoprov-historial').innerHTML = pagos.length ? '<div class="seccion-tit">Pagos registrados</div>' + pagos.map(g => `
      <div class="pago-fila${g.cancelado ? ' cancelado' : ''}"><div><b>${formatoMoneda(g.monto)}</b> · ${esc(NOMBRE_METODO[g.metodo] || g.metodo)} · ${esc(fechaTxt(g.fecha))}
        <small>Registró ${esc(g.registrado_por_nombre || '—')}${g.referencia ? ' · Ref. ' + esc(g.referencia) : ''}</small>${g.cancelado ? `<small class="motivo">Cancelado: ${esc(g.motivo_cancelacion || '')}</small>` : ''}</div>
        ${!g.cancelado ? `<button type="button" class="btn btn-outline perm-dinero-mover" data-cancelar-pagoprov="${Number(g.id)}">Cancelar</button>` : ''}</div>`).join('') : '<p class="util-45">Sin pagos registrados.</p>';
  }
  $('pagoprov-historial').addEventListener('click', async e => {
    const btn = e.target.closest('[data-cancelar-pagoprov]'); if (!btn) return;
    const motivo = await pedirMotivo('Cancelar pago a proveedor'); if (!motivo) return;
    conBoton(btn, async () => { await json(await api('/finanzas/pagos-proveedor/' + Number(btn.dataset.cancelarPagoprov) + '/cancelar', { method: 'POST', body: JSON.stringify({ motivo }) }));
      toast('Pago cancelado'); $('overlay-pago-prov').classList.remove('mostrar'); cargar({ pestana: 'pagar' }); refrescarFichaProv(); });
  });
  $('pagoprov-guardar').addEventListener('click', e => conBoton(e.currentTarget, async () => {
    if (!PAGO_PROV) return;
    const r = await enviar('/finanzas/cxp/' + PAGO_PROV.id + '/pagos', 'POST', { monto: $('pagoprov-monto').value.trim(), metodo: metodoElegido('pagoprov-metodos'), fecha: $('pagoprov-fecha').value, referencia: $('pagoprov-referencia').value, cuenta_origen: $('pagoprov-cuenta').value });
    if (!r) return;
    $('overlay-pago-prov').classList.remove('mostrar'); toast('Pago a proveedor guardado'); cargar({ pestana: 'pagar' }); refrescarFichaProv();
  }));

  // Nuevo gasto o factura
  // ---- Orden de servicio relacionada al gasto: búsqueda, vista previa y datos que se cargan ----
  let ORDENES_GASTO = [];
  async function cargarOrdenesGasto() {
    try { ORDENES_GASTO = await api('/finanzas/ordenes-para-gasto').then(json); } catch { ORDENES_GASTO = []; }
  }
  const sinAcentosGasto = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // Busca por folio (OS-202610-0001), número (1), cliente, servicio, unidad, operador o ubicación.
  function buscarOrdenesGasto(texto) {
    const q = sinAcentosGasto(texto).trim(); if (!q) return [];
    const numero = (q.match(/(\d+)\s*$/) || [])[1];
    const exacta = ORDENES_GASTO.filter(o => sinAcentosGasto(folioOrdenServicio(o)) === q || (/^\d+$/.test(q) && o.id === Number(q)));
    if (exacta.length) return exacta;
    const palabras = q.split(/\s+/);
    return ORDENES_GASTO.filter(o => { const t = sinAcentosGasto([folioOrdenServicio(o), o.id, o.nombre, o.empresa_contacto, o.servicio_nombre, o.equipo, o.operador, o.direccion, o.proyecto].join(' ')); return palabras.every(p => t.includes(p)); })
      .concat(numero && !/^\d+$/.test(q) ? ORDENES_GASTO.filter(o => o.id === Number(numero)) : [])
      .filter((o, i, a) => a.indexOf(o) === i).slice(0, 8);
  }
  const totalOrden = o => (Math.round((o.valor || 0) * 100) + (o.iva_cent || 0)) / 100;
  function pintarSugerenciasGasto() {
    const caja = $('gasto-orden-sugerencias'), lista = buscarOrdenesGasto($('gasto-orden').value);
    caja.hidden = !lista.length; $('gasto-orden').setAttribute('aria-expanded', String(!!lista.length));
    caja.innerHTML = lista.map(o => `<button type="button" role="option" class="gasto-orden-opcion" data-orden-gasto="${Number(o.id)}"><b>${esc(folioOrdenServicio(o))}</b> · ${esc(o.empresa_contacto || o.nombre || 'Sin cliente')} · ${esc(o.servicio_nombre || 'Servicio')}<small>${esc(fechaTxt(o.fecha_servicio))}${o.equipo ? ' · Unidad ' + esc(o.equipo) : ''}${o.valor != null ? ' · ' + formatoMoneda(totalOrden(o)) : ''}</small></button>`).join('');
  }
  // Muestra la información de la orden elegida y carga equipo y concepto si la orden los tiene.
  function elegirOrdenGasto(o, cargarDatos = true) {
    const info = $('gasto-orden-info'), campo = $('gasto-orden');
    $('gasto-orden-sugerencias').hidden = true; campo.setAttribute('aria-expanded', 'false');
    if (!o) { campo.dataset.leadId = ''; info.hidden = true; return; }
    campo.value = folioOrdenServicio(o); campo.dataset.leadId = String(o.id);
    info.hidden = false;
    info.innerHTML = `<b>✓ ${esc(folioOrdenServicio(o))}</b> · ${esc(o.empresa_contacto || o.nombre || 'Sin cliente')}
      <span>${esc(o.servicio_nombre || 'Servicio')} · servicio ${esc(fechaTxt(o.fecha_servicio))} · total ${formatoMoneda(totalOrden(o))}</span>
      <span>${o.equipo ? 'Unidad ' + esc(o.equipo) : 'Sin unidad'}${o.operador ? ' · Operador ' + esc(o.operador) : ''}${o.proyecto ? ' · Proyecto ' + esc(o.proyecto) : ''}${o.direccion ? ' · ' + esc(o.direccion) : ''}</span>`;
    if (!cargarDatos) return;
    // Solo se llenan los campos vacíos (o los que se llenaron solos con otra orden): no se pisa lo que escribió el usuario.
    const llenar = (id, valor) => { const el = $(id); if (valor && (!el.value.trim() || el.dataset.autollenado === el.value)) { el.value = valor; el.dataset.autollenado = valor; } };
    llenar('gasto-equipo', o.equipo);
    // El concepto NO se llena con el servicio: quien registra escribe qué se le paga al tercero.
    if ($('gasto-concepto').dataset.autollenado && $('gasto-concepto').value === $('gasto-concepto').dataset.autollenado) $('gasto-concepto').value = '';
    $('gasto-concepto').placeholder = 'Concepto del gasto (ej. Renta de pipa 20 m³, diésel, disposición de lodos)';
    if (o.equipo) $('gasto-folio').closest('details').open = true;
  }
  $('gasto-orden').addEventListener('input', () => { $('gasto-orden').dataset.leadId = ''; $('gasto-orden-info').hidden = true; pintarSugerenciasGasto(); });
  $('gasto-orden').addEventListener('focus', pintarSugerenciasGasto);
  $('gasto-orden').addEventListener('keydown', e => {
    if (e.key === 'Enter') { const primera = buscarOrdenesGasto($('gasto-orden').value)[0]; if (primera) { e.preventDefault(); elegirOrdenGasto(primera); } }
    if (e.key === 'Escape') { $('gasto-orden-sugerencias').hidden = true; $('gasto-orden').setAttribute('aria-expanded', 'false'); }
  });
  // Tocar fuera de la búsqueda cierra las sugerencias.
  document.addEventListener('click', e => { if (!e.target.closest('.gasto-orden-campo')) { $('gasto-orden-sugerencias').hidden = true; $('gasto-orden').setAttribute('aria-expanded', 'false'); } });
  $('gasto-orden-sugerencias').addEventListener('click', e => {
    const b = e.target.closest('[data-orden-gasto]'); if (!b) return;
    elegirOrdenGasto(ORDENES_GASTO.find(o => o.id === Number(b.dataset.ordenGasto)));
  });

  // GASTO_ALGUARDAR: qué refrescar después de guardar (la ficha de la orden o la vista de Cuentas por pagar).
  let GASTO_ALGUARDAR = null;
  async function nuevoGasto(prellenado = {}, alGuardar = null) {
    try { await catalogosPagos(); } catch (err) { toast('No se pudo cargar: ' + err.message); return; }
    llenarProveedoresGasto();
    // Quien no mueve dinero solo registra costos de una orden (las compras van por Solicitud de compra): ahí es obligatoria.
    document.querySelector('label[for="gasto-orden"]').textContent = Permisos.puede('dinero.mover') ? 'Orden de servicio relacionada (opcional)' : 'Orden de servicio relacionada (obligatorio)';
    ['gasto-concepto', 'gasto-total', 'gasto-folio', 'gasto-orden', 'gasto-equipo', 'gasto-referencia'].forEach(id => { $(id).value = prellenado[id] || ''; });
    $('gasto-fecha').value = hoy(); $('gasto-vence').value = ''; $('gasto-fecha-pago').value = hoy(); $('gasto-pagado').checked = false; $('gasto-metodo-wrap').hidden = true;
    $('gasto-credito').value = ''; $('gasto-credito').disabled = false; $('gasto-credito-ayuda').textContent = '';
    $('gasto-comprobante').innerHTML = '<option value="">Selecciona…</option>' + COMPROBANTES.map(([v, t]) => '<option value="' + v + '">' + esc(t) + '</option>').join('');
    $('gasto-sat').value = ''; $('gasto-sat-wrap').hidden = true; $('gasto-beneficiario').value = '';
    $('gasto-iva').value = ''; delete $('gasto-iva').dataset.editado; $('gasto-iva-wrap').hidden = true;
    $('gasto-beneficiarios').innerHTML = PROVEEDORES.filter(p => p.activo).map(p => '<option value="' + esc(p.nombre) + '"></option>').join('');
    $('gasto-categoria').value = 'otro';
    $('gasto-folio').closest('details').open = !!prellenado['gasto-equipo'];
    $('gasto-orden').dataset.leadId = ''; $('gasto-orden-sugerencias').hidden = true; $('gasto-orden-info').hidden = true;
    delete $('gasto-equipo').dataset.autollenado; delete $('gasto-concepto').dataset.autollenado;
    cargarOrdenesGasto().then(() => { if (prellenado['gasto-orden']) elegirOrdenGasto(buscarOrdenesGasto(prellenado['gasto-orden'])[0], false); });
    pintarMetodos('gasto-metodos', 'efectivo', METODOS_PROV);
    GASTO_ALGUARDAR = alGuardar;
    abrirVentana('overlay-gasto');
    if (!PROVEEDORES.some(p => p.activo)) toast('Elige "+ Nuevo proveedor…" para agregar a quien realizó el servicio');
  }
  $('pagar-nuevo').addEventListener('click', () => nuevoGasto());
  function llenarProveedoresGasto(seleccionado) {
    $('gasto-proveedor').innerHTML = '<option value="">Selecciona…</option>' + PROVEEDORES.filter(p => p.activo).map(p => `<option value="${Number(p.id)}">${esc(p.nombre)}</option>`).join('')
      + '<option value="__nuevo">+ Nuevo proveedor…</option>';
    if (seleccionado) $('gasto-proveedor').value = String(seleccionado);
  }
  // Días de crédito de ESTE gasto: se escriben siempre (0 = de contado). El del proveedor solo se muestra como referencia.
  const recalcularVence = () => {
    const p = PROVEEDORES.find(x => x.id === Number($('gasto-proveedor').value));
    $('gasto-credito-ayuda').textContent = p ? 'Este proveedor suele dar ' + Number(p.dias_credito) + ' días.' : '';
    const d = $('gasto-credito').value.trim();
    $('gasto-vence').value = /^\d{1,3}$/.test(d) && $('gasto-fecha').value ? sumarDias($('gasto-fecha').value, Number(d)) : '';
  };
  $('gasto-credito').addEventListener('input', recalcularVence);
  // IVA de la factura: se propone el 16 % incluido en el total mientras no lo escriban a mano.
  const ivaPropuesto = () => { const n = Number(String($('gasto-total').value).replace(/[$,\s]/g, '')); return Number.isFinite(n) && n > 0 ? (Math.round(n * 1600 / 116) / 100).toFixed(2) : ''; };
  const proponerIva = () => { if ($('gasto-comprobante').value === 'factura' && !$('gasto-iva').dataset.editado) $('gasto-iva').value = ivaPropuesto(); };
  $('gasto-comprobante').addEventListener('change', () => {
    const factura = $('gasto-comprobante').value === 'factura';
    $('gasto-sat-wrap').hidden = !factura; if (!factura) $('gasto-sat').value = '';
    $('gasto-iva-wrap').hidden = !factura; if (!factura) { $('gasto-iva').value = ''; delete $('gasto-iva').dataset.editado; } else proponerIva();
  });
  $('gasto-total').addEventListener('input', proponerIva);
  $('gasto-iva').addEventListener('input', () => { $('gasto-iva').dataset.editado = '1'; });
  $('gasto-proveedor').addEventListener('change', async () => {
    if ($('gasto-proveedor').value === '__nuevo') {
      $('gasto-proveedor').value = '';
      const nombre = await solicitarDialogo({ titulo: 'Nuevo proveedor', mensaje: 'Se crea con la categoría elegida y sin crédito (contado). Puedes completar sus datos después en la pestaña Proveedores.', aceptar: 'Agregar', campo: { tipo: 'text', etiqueta: 'Nombre del proveedor' } });
      if (!nombre) return;
      try {
        const p = await guardarProveedor({ nombre, categoria: $('gasto-categoria').value || 'otro', dias_credito: 0 });
        if (!p) return;
        await catalogosPagos(); llenarProveedoresGasto(p.id); toast('Proveedor listo: ' + p.nombre);
      } catch (err) { toast('No se pudo agregar: ' + err.message); }
    }
    const p = PROVEEDORES.find(x => x.id === Number($('gasto-proveedor').value)); if (p) $('gasto-categoria').value = p.categoria; recalcularVence();
  });
  $('gasto-fecha').addEventListener('change', recalcularVence);
  $('gasto-pagado').addEventListener('change', () => {
    const pagado = $('gasto-pagado').checked;
    $('gasto-metodo-wrap').hidden = !pagado;
    // Ya pagado = de contado.
    if (pagado) $('gasto-credito').value = '0';
    $('gasto-credito').disabled = pagado; recalcularVence();
  });
  $('gasto-guardar').addEventListener('click', e => conBoton(e.currentTarget, async () => {
    const orden = $('gasto-orden').value.trim();
    const leadId = orden ? Number($('gasto-orden').dataset.leadId) || null : null;
    if (orden && !leadId) { toast('Elige la orden de servicio de la lista (o deja el campo vacío)'); $('gasto-orden').focus(); return; }
    if (!leadId && !Permisos.puede('dinero.mover')) { toast('Elige la orden de servicio. Las compras se piden con una Solicitud de compra.'); $('gasto-orden').focus(); return; }
    if (!$('gasto-comprobante').value) { toast('Elige el tipo de comprobante (factura, recibo, sin factura…)'); $('gasto-comprobante').focus(); return; }
    const credito = $('gasto-pagado').checked ? '0' : $('gasto-credito').value.trim();
    if (!/^\d{1,3}$/.test(credito) || Number(credito) > 365) { toast('Escribe los días de crédito (0 si es de contado)'); $('gasto-credito').focus(); return; }
    const r = await enviar('/finanzas/cxp', 'POST', {
      proveedor_id: Number($('gasto-proveedor').value) || null, categoria: $('gasto-categoria').value, concepto: $('gasto-concepto').value,
      total: $('gasto-total').value.trim(), fecha_documento: $('gasto-fecha').value, dias_credito: Number(credito),
      tipo_comprobante: $('gasto-comprobante').value, metodo_sat: $('gasto-sat').value || null, beneficiario: $('gasto-beneficiario').value.trim() || null,
      iva: $('gasto-comprobante').value === 'factura' ? ($('gasto-iva').value.trim() || null) : null,
      factura_folio: $('gasto-folio').value, lead_id: leadId, equipo: $('gasto-equipo').value,
      ya_pagado: $('gasto-pagado').checked, metodo: metodoElegido('gasto-metodos'),
      fecha_pago: $('gasto-pagado').checked ? $('gasto-fecha-pago').value : null, referencia: $('gasto-pagado').checked ? $('gasto-referencia').value : null });
    if (!r) return;
    $('overlay-gasto').classList.remove('mostrar'); toast($('gasto-pagado').checked ? 'Gasto registrado como pagado' : 'Cuenta por pagar registrada');
    const alGuardar = GASTO_ALGUARDAR; GASTO_ALGUARDAR = null;
    if (alGuardar) await alGuardar(); else cargar({ pestana: 'pagar' });
  }));
  $('pagar-formato-cxp').addEventListener('click', e => conBoton(e.currentTarget, descargarFormatoCxp));
  async function descargarFormatoCxp() {
    let ExcelJS; try { ExcelJS = await cargarExcelJS(); } catch (err) { toast(err.message); return; }
    const d = await api('/finanzas/cxp/formato-excel').then(json);
    const COMP = d.comprobantes, VIA = Object.fromEntries(METODOS_PROV);
    const pagosDe = id => d.pagos.filter(g => g.cxp_id === id && !g.cancelado);
    const fecha = f => (f ? new Date(f + 'T12:00:00') : null);
    const wb = new ExcelJS.Workbook(); wb.creator = 'Saneadren CRM';
    const ws = wb.addWorksheet('CXP ' + hoy().slice(0, 4), { views: [{ state: 'frozen', ySplit: 2 }] });
    const COLS = [['FECHA VENCIMIENTO', 13], ['PROVEEDOR', 34], ['BENEFICIARIO', 34], ['DESCRIPCION', 44], ['FECHA FACTURA/SOLICITUD', 13], ['capturo', 12], ['FOLIO FACTURA', 16],
      ['METODO DE PAGO', 18], ['MONTO TOTAL FACTURA', 16], ['PENDIENTE', 14], ['ANTICIPO', 13], ['PAGADO', 16], ['CUENTA BANCARIA', 22], ['BANCO', 14], ['DIAS DE CREDITO', 9],
      ['CONCEPTO DE GASTO ', 30], ['STATUS', 12], ['FECHA DE PAGO', 13], ['OBSERVACIONES', 40], ...(Sucursales.varias() ? [['SUCURSAL', 10]] : [])];
    ws.columns = COLS.map(([, w]) => ({ width: w }));
    ws.mergeCells(Sucursales.varias() ? 'A1:T1' : 'A1:S1'); ws.getCell('A1').value = 'Cuentas por pagar ' + hoy().slice(0, 4); ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getRow(2).values = COLS.map(([t]) => t);
    ws.getRow(2).eachCell(c => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6B103' } }; c.alignment = { wrapText: true, vertical: 'middle' }; });
    let n = 3;
    for (const x of d.cuentas.filter(c => !c.cancelada)) {
      const pg = pagosDe(x.id), pagado = pg.reduce((t, g) => t + g.monto, 0), anticipo = pg.filter(g => g.fecha < x.fecha_documento).reduce((t, g) => t + g.monto, 0);
      const status = pagado <= 0 ? 'PENDIENTE' : pagado + 0.005 < x.total ? 'PARCIAL' : 'PAGADO';
      const metodo = x.tipo_comprobante === 'factura' ? (x.metodo_sat || 'FACTURA') : (COMP[x.tipo_comprobante] || '').toUpperCase();
      const folio = x.factura_folio || (x.tipo_comprobante && x.tipo_comprobante !== 'factura' ? (COMP[x.tipo_comprobante] || '').toUpperCase() : '');
      const ultimo = pg.length ? pg[pg.length - 1] : null;
      const r = ws.getRow(n);
      r.values = [fecha(x.fecha_vencimiento), x.proveedor, x.beneficiario, x.concepto, fecha(x.fecha_documento), (x.capturo || '').toUpperCase(), folio, metodo, x.total,
        { formula: 'I' + n + '-L' + n, result: Math.round((x.total - pagado) * 100) / 100 }, anticipo || null,
        // Varios pagos: como en el Excel, una suma con cada pago (=a+b+c); el detalle con fechas está en la hoja PAGOS.
        pg.length > 1 ? { formula: pg.map(g => g.monto).join('+'), result: pagado } : (pg.length ? pagado : null),
        x.clabe || '', x.banco || '', x.dias_credito ?? '', (x.categoria || '').toUpperCase(), status, ultimo ? fecha(ultimo.fecha) : null,
        [x.notas, x.orden_folio ? 'Orden ' + x.orden_folio : '', x.tipo_comprobante === 'informativo' ? 'INFORMATIVO: no se suma' : '', !x.es_gasto ? 'No cuenta como gasto' : ''].filter(Boolean).join(' · ')];
      if (Sucursales.varias()) r.getCell(20).value = x.sucursal || '';
      [1, 5, 18].forEach(i => { r.getCell(i).numFmt = 'dd/mm/yyyy'; });
      [9, 10, 11, 12].forEach(i => { r.getCell(i).numFmt = '"$"#,##0.00'; });
      n++;
    }
    const pw = wb.addWorksheet('PAGOS', { views: [{ state: 'frozen', ySplit: 1 }] });
    pw.columns = [{ header: 'FECHA DE PAGO', width: 13 }, { header: 'PROVEEDOR', width: 34 }, { header: 'BENEFICIARIO', width: 34 }, { header: 'DESCRIPCION', width: 40 }, { header: 'MONTO', width: 14 },
      { header: 'VIA DE PAGO', width: 16 }, { header: 'CUENTA DE SALIDA', width: 24 }, { header: 'REFERENCIA', width: 22 }, { header: 'REGISTRÓ', width: 16 }, { header: 'ESTADO', width: 30 }];
    pw.getRow(1).eachCell(c => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6B103' } }; });
    for (const g of d.pagos) {
      const x = d.cuentas.find(c => c.id === g.cxp_id) || {};
      const r = pw.addRow([fecha(g.fecha), x.proveedor, x.beneficiario, x.concepto, g.monto, VIA[g.metodo] || g.metodo, g.cuenta_origen || '', g.referencia || '', g.registro || '', g.cancelado ? 'CANCELADO: ' + (g.motivo_cancelacion || '') : 'Vigente']);
      r.getCell(1).numFmt = 'dd/mm/yyyy'; r.getCell(5).numFmt = '"$"#,##0.00';
    }
    const lw = wb.addWorksheet('LISTA');
    const listas = [['PROVEEDOR', [...new Set(d.cuentas.map(c => c.proveedor))].sort()], ['BENEFICIARIO', [...new Set(d.cuentas.map(c => c.beneficiario))].sort()],
      ['CONCEPTO DE GASTO', Object.values(d.categorias)], ['TIPO DE COMPROBANTE', Object.values(COMP)], ['VIA DE PAGO', METODOS_PROV.map(([, t]) => t)], ['STATUS', ['PENDIENTE', 'PARCIAL', 'PAGADO']]];
    listas.forEach(([t, vals], i) => { const col = lw.getColumn(i + 1); col.width = 34; lw.getCell(1, i + 1).value = t; lw.getCell(1, i + 1).font = { bold: true }; vals.forEach((v, j) => { lw.getCell(j + 2, i + 1).value = v; }); });
    saveAs(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'CUENTAS_POR_PAGAR_' + hoy() + '.xlsx');
    toast('Descargado con el formato CXP');
  }
  $('pagar-exportar').addEventListener('click', () => {
    if (!CXP.length) { toast('No hay datos para exportar'); return; }
    descargarCSV('cuentas_por_pagar_' + hoy() + '.csv', [
      ...(Sucursales.varias() ? [{ titulo: 'Sucursal', valor: x => (globalThis.SUCURSALES_MAPA || {})[x.sucursal_id] || '' }] : []),
      { titulo: 'Proveedor', valor: x => x.proveedor_nombre }, { titulo: 'Concepto', valor: x => x.concepto }, { titulo: 'Categoría', valor: x => x.categoria_nombre },
      { titulo: 'Factura', valor: x => x.factura_folio }, { titulo: 'Fecha', valor: x => x.fecha_documento }, { titulo: 'Vence', valor: x => x.fecha_vencimiento },
      { titulo: 'Total', valor: x => x.total.toFixed(2) }, { titulo: 'Pagado', valor: x => x.pagado.toFixed(2) }, { titulo: 'Saldo', valor: x => x.saldo.toFixed(2) },
      { titulo: 'Días para vencer', valor: x => (x.saldo > 0 ? x.dias_para_vencer : '') }, { titulo: 'Último pago', valor: x => (x.ultimo_pago ? ultimoPagoTxt(x.ultimo_pago) : '') },
      { titulo: 'Orden', valor: x => x.orden_folio || '' }, { titulo: 'Equipo', valor: x => x.equipo || '' }, { titulo: 'Notas', valor: x => x.notas || '' }], CXP);
  });

  // ---------- Proveedores ----------
  let PROV_EDITANDO = null;
  async function cargarProveedores() {
    const cont = $('prov-lista');
    try { await catalogosPagos(); } catch (err) { cont.innerHTML = `<div class="aviso-error-carga" role="alert"><p>No se pudo cargar: ${esc(err.message)}</p></div>`; return; }
    const cat = Object.fromEntries(CATEGORIAS.map(c => [c.clave, c.nombre]));
    cont.innerHTML = PROVEEDORES.length ? PROVEEDORES.map(p => `
      <div class="fila-dinero${p.activo ? '' : ' inactivo'}"><div class="info"><button type="button" class="enlace enlace-fuerte" data-ficha-prov="${Number(p.id)}">${esc(p.nombre)}</button>${p.activo ? '' : ' · inactivo'}
        <small>${esc(cat[p.categoria] || p.categoria)} · crédito ${Number(p.dias_credito)} días${p.telefono ? ' · ' + esc(p.telefono) : ''}${p.rfc ? ' · RFC ' + esc(p.rfc) : ''}</small></div>
        <div class="montos"><b>${formatoMoneda(p.saldo)}</b><small>por pagar</small></div>
        <div class="btn-group"><button type="button" class="btn btn-primario" data-ficha-prov="${Number(p.id)}">Ver ficha</button><button type="button" class="btn btn-outline" data-editar-prov="${Number(p.id)}">Editar</button>
          <button type="button" class="btn btn-outline" data-activo-prov="${Number(p.id)}">${p.activo ? 'Desactivar' : 'Activar'}</button></div></div>`).join('')
      : '<p class="util-45">Aún no hay proveedores. Agrega el primero arriba.</p>';
    limpiarFormProveedor();
  }
  function limpiarFormProveedor() {
    PROV_EDITANDO = null;
    ['prov-nombre', 'prov-rfc', 'prov-telefono', 'prov-contacto', 'prov-clabe', 'prov-banco'].forEach(id => { $(id).value = ''; });
    $('prov-credito').value = 0; $('prov-categoria').value = 'otro';
    $('prov-form-titulo').textContent = 'Agregar proveedor'; $('prov-cancelar').hidden = true;
  }
  $('prov-cancelar').addEventListener('click', limpiarFormProveedor);
  $('prov-lista').addEventListener('click', async e => {
    const btn = e.target.closest('button'); if (!btn) return;
    if (btn.dataset.fichaProv) return abrirCuentaProveedor(Number(btn.dataset.fichaProv));
    const p = PROVEEDORES.find(x => x.id === Number(btn.dataset.editarProv || btn.dataset.activoProv)); if (!p) return;
    if (btn.dataset.editarProv) {
      PROV_EDITANDO = p.id;
      $('prov-nombre').value = p.nombre; $('prov-categoria').value = p.categoria; $('prov-credito').value = p.dias_credito;
      $('prov-rfc').value = p.rfc || ''; $('prov-telefono').value = p.telefono || ''; $('prov-contacto').value = p.contacto || ''; $('prov-clabe').value = p.clabe || ''; $('prov-banco').value = p.banco || '';
      $('prov-form-titulo').textContent = 'Editar proveedor'; $('prov-cancelar').hidden = false; $('prov-nombre').focus();
      return;
    }
    conBoton(btn, async () => { await json(await api('/finanzas/proveedores/' + p.id, { method: 'PUT', body: JSON.stringify({ activo: !p.activo }) })); cargarProveedores(); });
  });
  // Crear o editar un proveedor. Si se parece a uno que ya existe, se pregunta «¿es otro?»; si es exactamente
  // el mismo (nombre o RFC), al crear se usa el que ya existe. Devuelve el proveedor, o null si se canceló.
  async function guardarProveedor(cuerpo, id = null) {
    const enviar = c => api('/finanzas/proveedores' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: JSON.stringify(c) });
    let r = await enviar(cuerpo), j = await r.json().catch(() => ({}));
    if (r.status === 409 && j.codigo === 'POSIBLE_DUPLICADO') {
      if (!await solicitarDialogo({ titulo: '¿Es otro proveedor?', mensaje: j.error + ' Si es el mismo, cancela y elígelo de la lista.', aceptar: 'Sí, es otro proveedor' })) return null;
      r = await enviar({ ...cuerpo, forzar: true }); j = await r.json().catch(() => ({}));
    }
    if (r.status === 409 && j.proveedor_id && !id) {
      const lista = await api('/finanzas/proveedores').then(x => x.json());
      const existente = lista.find(p => p.id === j.proveedor_id);
      if (existente) { toast(j.error + ': se usa ese proveedor.'); return existente; }
    }
    if (!r.ok) throw new Error(j.error || 'No se pudo guardar el proveedor');
    return j;
  }
  $('prov-guardar').addEventListener('click', e => conBoton(e.currentTarget, async () => {
    const cuerpo = { nombre: $('prov-nombre').value, categoria: $('prov-categoria').value, dias_credito: $('prov-credito').value,
      rfc: $('prov-rfc').value, telefono: $('prov-telefono').value, contacto: $('prov-contacto').value, clabe: $('prov-clabe').value, banco: $('prov-banco').value };
    if (!await guardarProveedor(cuerpo, PROV_EDITANDO)) return;
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
    // Lo que dice el encabezado de la ficha y el resumen de Inicio (inicio.js): el dinero, no cuántos renglones hay.
    cont.dataset.resumen = r.vencido > 0 ? `${formatoMoneda(r.vencido)} vencido` : r.por_cobrar > 0 ? `${formatoMoneda(r.por_cobrar)} por cobrar` : 'Al corriente';
    cont.dataset.urgente = r.vencido > 0 ? '1' : '';
    cont.innerHTML = html;
  }
  $('inicio-dinero')?.addEventListener('click', e => {
    const b = e.target.closest('[data-inicio-dinero]'); if (!b) return;
    const a = b.dataset.inicioDinero;
    if (a === 'reintentar') return pintarInicio();
    cambiarVista('cuentas', { pestana: a === 'pagar' ? 'pagar' : 'cobrar', filtro: a === 'vencido' ? 'vencido' : a === 'con_saldo' ? 'con_saldo' : undefined });
  });

  // ===================== Ficha del contacto: estado de cuenta =====================
  let CLIENTE_ACTUAL_ID = null, CLIENTE_ACTUAL = null;
  async function pintarCliente(cliente) {
    const cont = $('fc-cobranza'); if (!cont) return;
    cont.innerHTML = ''; CLIENTE_ACTUAL_ID = cliente?.id || null; CLIENTE_ACTUAL = cliente || null;
    if (!CLIENTE_ACTUAL_ID) return;
    let r;
    try { r = await api('/finanzas/clientes/' + Number(cliente.id) + '/estado-cuenta').then(json); } catch { return; }
    if (CLIENTE_ACTUAL_ID !== cliente.id) return;
    if (r.saldo === undefined) { // ventas / técnico: solo el aviso, sin importes
      if (r.tiene_vencido) cont.innerHTML = `<p class="cuentas-aviso">⚠ Este cliente tiene pagos vencidos (hasta ${Number(r.dias_max_vencido)} días). Consulta con administración antes de comprometer crédito.</p>`;
      return;
    }
    const ordenes = r.ordenes.map(c => `<div class="pago-fila"><div><b>${esc(c.folio)}</b> · ${esc(c.servicio_nombre || 'Servicio')} ${etiquetaEstado(c)}<small>Saldo ${formatoMoneda(c.saldo)} de ${formatoMoneda(c.total)}${c.programada ? '' : ' · vence ' + esc(fechaTxt(c.vence))}</small></div>
      <div class="btn-group">${waOrden(c, cliente)}<button type="button" class="btn btn-outline" data-fc-pagar="${Number(c.lead_id)}">Registrar pago</button></div></div>`).join('');
    // Un solo mensaje con todo lo que debe el cliente (sin lo programado a futuro).
    const deudas = r.ordenes.filter(sePuedeRecordar);
    const waCliente = deudas.length > 1 ? botonWhatsApp(cliente.telefono, textoWhatsApp({ cliente_nombre: cliente.nombre, saldo: deudas.reduce((t, c) => t + c.saldo, 0), vencido: r.vencido,
      folios: deudas.map(c => c.folio), proximo_vence: deudas.map(c => c.vence).sort()[0] })).replace('Recordar por WhatsApp', 'Recordar todo el saldo por WhatsApp') : '';
    cont.innerHTML = `<div class="modal-section" data-plegable="estado-cuenta"><div class="seccion-tit">💰 Estado de cuenta</div>
      <div class="cobranza-resumen"><div><small>Saldo</small><b>${formatoMoneda(r.saldo)}</b></div><div><small>Vencido</small><b class="${r.vencido > 0 ? 'rojo' : ''}">${formatoMoneda(r.vencido)}</b></div>
        <div><small>Por realizar</small><b>${formatoMoneda(r.programado)}</b></div>${r.por_concluir > 0 ? `<div><small>Por concluir</small><b>${formatoMoneda(r.por_concluir)}</b></div>` : ''}<div><small>Crédito</small><b>${Number(r.dias_credito)} días</b>${puedeEditarFactura() ? '<button type="button" class="enlace" data-fc-credito>Cambiar</button>' : ''}</div></div>
      ${r.por_revisar_n ? `<p class="ayuda">${Number(r.por_revisar_n)} órdenes anteriores al módulo están pendientes de la revisión inicial.</p>` : ''}
      ${waCliente ? `<div class="btn-group">${waCliente}</div>` : ''}
      <div class="pagos-lista">${ordenes || '<p class="util-45">Sin saldos pendientes. 🎉</p>'}</div></div>`;
    window.Plegables?.preparar(cont);
  }
  $('fc-cobranza')?.addEventListener('click', async e => {
    const cr = e.target.closest('[data-fc-credito]');
    if (cr && CLIENTE_ACTUAL_ID) {
      const id = CLIENTE_ACTUAL_ID;
      const dias = await solicitarDialogo({ titulo: 'Días de crédito del cliente', mensaje: 'Se aplica a sus órdenes NUEVAS (0 = contado). Las órdenes existentes conservan el suyo; cámbialo en cada orden (Crédito y factura) si hace falta.', aceptar: 'Guardar', campo: { tipo: 'number', etiqueta: 'Días (0 a 180)' } });
      if (dias === null) return;
      conBoton(cr, async () => { await json(await api('/finanzas/clientes/' + Number(id) + '/credito', { method: 'PUT', body: JSON.stringify({ dias_credito: dias }) })); toast('Crédito del cliente actualizado'); pintarCliente(CLIENTE_ACTUAL?.id === id ? CLIENTE_ACTUAL : { id }); });
      return;
    }
    const b = e.target.closest('[data-fc-pagar]'); if (!b || !CLIENTE_ACTUAL_ID) return;
    const id = CLIENTE_ACTUAL_ID;
    abrirCobro(Number(b.dataset.fcPagar), () => pintarCliente(CLIENTE_ACTUAL?.id === id ? CLIENTE_ACTUAL : { id }));
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
        { key: 'id_cliente', titulo: 'ID CLIENTE', alias: ['ID', 'ID DEL CLIENTE', 'CLIENTE ID'], tipo: 'lista', lista: 'clientes', ancho: 30, nota: 'Elige el cliente de la lista (CLI-0039 · nombre). Es lo más seguro: así no se duplica aunque el NOMBRE esté escrito distinto. Vacío = se busca por teléfono o nombre exacto. NUEVO = es un cliente nuevo aunque se parezca a otro.', ej: '' },
        { key: 'nombre', titulo: 'NOMBRE', req: true, tipo: 'texto', ancho: 34, nota: 'Cliente (razón social). Si pusiste ID CLIENTE, este nombre es solo de referencia.', ej: 'PREMIUM RESTAURANT BRANDS' },
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
        clientes: tipo === 'cxc' ? ['NUEVO', ...(await api('/clientes/catalogo').then(json)).map(c => c.folio + ' · ' + (c.empresa || c.nombre || ''))] : [],
        categorias: tipo === 'cxp' ? (await api('/finanzas/categorias').then(json)).map(c => c.nombre) : [],
        metodos: METODOS_PROV.map(m => m[1]),
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
    ['servicios', 'categorias', 'metodos', 'metodo_pago', 'status', 'clientes'].forEach((nombre, idx) => {
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

  // ===================== Ejecución del servicio (realizado / no realizado) =====================
  let EJECUCION_ORDEN = null;
  function pintarEjecucion(lead) {
    const sec = $('seccion-ejecucion'), cont = $('ejecucion-orden');
    if (!lead || lead.estatus !== 'ganado') { sec.hidden = true; EJECUCION_ORDEN = null; return; }
    sec.hidden = false; EJECUCION_ORDEN = lead;
    // Lo marca quien hizo la orden, el gerente o Dirección (2026-10-26); los demás solo ven en qué va.
    const botones = lead.puede_editar === false ? '<p class="ayuda">Si se realizó lo marca quien hizo la orden, el gerente o Dirección.</p>'
      : `<div class="btn-group"><button type="button" class="btn btn-verde" data-ejecucion="estatus">🔄 Actualizar estatus del servicio</button></div>`;
    // Si se marcó por error, Dirección lo regresa a «por realizar» (con motivo; queda en la bitácora).
    const deshacer = lead.ejecucion && Permisos.direccion() ? '<div class="btn-group"><button type="button" class="btn btn-outline" data-ejecucion="deshacer">↩ Regresar a «por realizar»</button></div>' : '';
    if (lead.ejecucion === 'realizado') {
      cont.innerHTML = `<p class="ejecucion-estado realizado"><b>✔ Servicio realizado</b> el ${esc(fechaTxt(lead.fecha_realizado))}. Ya cuenta en el Generador.</p>
        <p class="ayuda">¿Hubo otro gasto? Agrégalo en «Gastos generados de esta orden», abajo.</p>${deshacer}`;
    } else if (lead.ejecucion === 'no_realizado') {
      cont.innerHTML = `<p class="ejecucion-estado no-realizado"><b>✖ No realizado.</b> Motivo: ${esc(lead.motivo_no_realizado || '—')}. No cuenta en el Generador y no se le cobra; si ya había pagado, ese dinero queda a su favor (devolverlo o aplicarlo a otro servicio).</p>
        <p class="ayuda">Si al final sí se realizó, actualízalo:</p>${botones}${deshacer}`;
    } else {
      const vencida = lead.fecha_servicio && lead.fecha_servicio <= hoy();
      cont.innerHTML = `<p class="ayuda">${vencida ? '<b>Por concluir:</b> la fecha del servicio ya pasó.' : 'Programado para el ' + esc(fechaTxt(lead.fecha_servicio)) + '.'} Cuando termine, actualiza su estatus: si se realizó (pasa al Generador y se registran sus gastos) o no.</p>${botones}`;
    }
  }
  $('ejecucion-orden').addEventListener('click', async e => {
    const b = e.target.closest('[data-ejecucion]'); const lead = EJECUCION_ORDEN; if (!b || !lead) return;
    if (b.dataset.ejecucion === 'deshacer') {
      const motivo = await pedirMotivo('Regresar a «por realizar»'); if (!motivo) return;
      return conBoton(b, async () => { await enviar('/leads/' + lead.id + '/ejecucion', 'POST', { estado: 'pendiente', motivo }); toast('El servicio quedó «por realizar»'); await abrirFicha(lead.id); });
    }
    return abrirRealizado(lead, null);
  });
  // Avisos claros al marcar «no realizado»: el cliente no debe nada; lo pagado queda a su favor; los gastos siguen en Cuentas por pagar.
  async function avisosNoRealizado(r) {
    const avisos = ['Servicio marcado como no realizado: ya no se le cobra.'];
    if (r.a_favor > 0) avisos.push(`El cliente ya había pagado ${formatoMoneda(r.a_favor)}: queda a su favor (devuélvelo o aplícalo a otro servicio).`);
    if (r.gastos_ligados > 0) avisos.push(`Esta orden tiene ${Number(r.gastos_ligados)} gasto(s) en Cuentas por pagar${r.gastos_pendientes > 0 ? ' (' + formatoMoneda(r.gastos_pendientes) + ' sin pagar)' : ''}: revisa si alguno se cancela.`);
    if (avisos.length > 1) await solicitarDialogo({ titulo: 'Servicio no realizado', mensaje: avisos.join('\n\n'), aceptar: 'Entendido', soloAviso: true });
    else toast(avisos[0]);
  }
  async function refrescarFichaOrden(id) { if (LEAD_ACTUAL?.id === id) await abrirFicha(id); await ServiciosTabla.refrescar(); }

  // Ventana: quién lo hizo y sus gastos (cada gasto se carga en Cuentas por pagar ligado a la orden).
  let REALIZADO = null;
  const opcionesProveedor = sel => '<option value="">Selecciona…</option>' + PROVEEDORES.filter(p => p.activo).map(p => `<option value="${Number(p.id)}"${Number(p.id) === Number(sel) ? ' selected' : ''}>${esc(p.nombre)}</option>`).join('') + '<option value="__nuevo">+ Nuevo proveedor…</option>';
  const opcionesCategoria = sel => Object.entries(CATEGORIAS_TXT).map(([k, n]) => `<option value="${esc(k)}"${k === sel ? ' selected' : ''}>${esc(n)}</option>`).join('');
  const opcionesMetodo = () => METODOS_PROV.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('');
  let CATEGORIAS_TXT = {};
  function filaGasto(g = {}) {
    const div = document.createElement('div'); div.className = 'realizado-gasto';
    const categoriaInicial = g.categoria || 'otro';
    div.innerHTML = `<div class="form-grid-2">
        <div class="campo"><label>Proveedor</label><select class="rg-proveedor">${opcionesProveedor(g.proveedor_id)}</select></div>
        <div class="campo"><label>Categoría</label><select class="rg-categoria">${opcionesCategoria(categoriaInicial)}</select></div>
        <div class="campo"><label>Concepto del costo (obligatorio)</label><input class="rg-concepto" maxlength="200" value="${esc(g.concepto || '')}" placeholder="Ej. Diésel, casetas, renta de pipa 20 m³, disposición de lodos" required></div>
        <div class="campo"><label>Monto con IVA (MXN)</label><input class="rg-total" type="text" inputmode="decimal" autocomplete="off" value="${esc(g.total || '')}"></div>
      </div>
      <label class="diseno-campo-checkbox"><input type="checkbox" class="rg-pagado"> Ya se pagó</label>
      <div class="form-grid-2 rg-pago" hidden>
        <div class="campo"><label>¿Cómo se pagó?</label><select class="rg-metodo">${opcionesMetodo()}</select></div>
        <div class="campo"><label>Fecha de pago</label><input class="rg-fecha" type="date"></div>
        <div class="campo"><label>Referencia / vía de pago</label><input class="rg-referencia" maxlength="120" placeholder="Ej. Nómina semana 40"></div>
        <div class="campo"><label>Folio de factura (opcional)</label><input class="rg-folio" maxlength="60"></div>
      </div>
      <button type="button" class="btn-eliminar rg-quitar">🗑 Quitar gasto</button>`;
    div.querySelector('.rg-fecha').value = ($('realizado-campo-fecha').hidden ? '' : $('realizado-fecha').value) || hoy();
    return div;
  }
  function resumenRealizado() {
    const filas = [...document.querySelectorAll('#realizado-gastos .realizado-gasto')];
    const total = filas.reduce((t, f) => t + (Number(f.querySelector('.rg-total').value.replace(/[$,\s]/g, '')) || 0), 0);
    $('realizado-resumen').textContent = filas.length ? `${filas.length} gasto${filas.length === 1 ? '' : 's'} por ${formatoMoneda(total)}: se cargarán en Cuentas por pagar con el número de esta orden.` : 'Sin gastos: si no hubo, déjalo así.';
  }
  // La fecha se precarga con la de la orden; si esa fecha aún no llega, se pide la fecha real (no se acepta una futura).
  function avisoFechaRealizado() {
    const f = $('realizado-fecha').value, aviso = $('realizado-aviso-fecha');
    aviso.hidden = !(f && f > hoy());
    aviso.textContent = f && f > hoy() ? 'La orden está programada para el ' + fechaTxt(f) + ' (fecha futura): si ya se realizó, pon la fecha real en que se hizo.' : '';
  }
  // Sí: la fecha (precargada con la de la orden). No: el motivo es obligatorio. En ambos casos se pueden incluir gastos.
  function ayudaRealizado() {
    const si = document.querySelector('input[name="realizado-si"]:checked')?.value;
    $('realizado-campo-fecha').hidden = si !== 'si';
    $('realizado-campo-motivo').hidden = si !== 'no';
    $('realizado-ayuda').textContent = si === 'no' ? 'No se le cobrará al cliente; si ya había pagado, ese dinero queda a su favor.' : '';
    resumenRealizado();
  }
  async function abrirRealizado(lead, respuesta) {
    try { await catalogosPagos(); CATEGORIAS_TXT = Object.fromEntries((await api('/finanzas/categorias').then(json)).map(c => [c.clave, c.nombre])); }
    catch (err) { toast('No se pudo abrir: ' + err.message); return; }
    REALIZADO = lead;
    $('realizado-titulo').textContent = '¿Se realizó el servicio? · ' + folioOrdenServicio(lead);
    $('realizado-orden').textContent = [lead.empresa_contacto || lead.nombre, lead.servicio_nombre, lead.equipo ? 'Unidad ' + lead.equipo : '', lead.operador ? 'Operador ' + lead.operador : ''].filter(Boolean).join(' · ');
    $('realizado-fecha').value = lead.fecha_servicio || hoy();
    $('realizado-fecha').max = hoy();
    avisoFechaRealizado();
    document.querySelectorAll('input[name="realizado-si"]').forEach(r => { r.checked = r.value === respuesta; });
    $('realizado-motivo').value = '';
    $('realizado-gastos').innerHTML = '';
    ayudaRealizado();
    abrirVentana('overlay-realizado');
  }
  document.querySelectorAll('input[name="realizado-si"]').forEach(r => r.addEventListener('change', ayudaRealizado));
  $('realizado-fecha').addEventListener('input', avisoFechaRealizado);
  $('realizado-agregar').addEventListener('click', () => { $('realizado-gastos').append(filaGasto()); resumenRealizado(); });
  $('realizado-gastos').addEventListener('input', resumenRealizado);
  $('realizado-gastos').addEventListener('click', e => { const q = e.target.closest('.rg-quitar'); if (q) { q.closest('.realizado-gasto').remove(); resumenRealizado(); } });
  $('realizado-gastos').addEventListener('change', async e => {
    const fila = e.target.closest('.realizado-gasto'); if (!fila) return;
    if (e.target.classList.contains('rg-pagado')) fila.querySelector('.rg-pago').hidden = !e.target.checked;
    if (e.target.classList.contains('rg-proveedor')) {
      if (e.target.value === '__nuevo') {
        e.target.value = '';
        const nombre = await solicitarDialogo({ titulo: 'Nuevo proveedor', mensaje: 'Se crea sin crédito (contado). Puedes completar sus datos después en Proveedores.', aceptar: 'Agregar', campo: { tipo: 'text', etiqueta: 'Nombre del proveedor o empresa' } });
        if (!nombre) return;
        try {
          const p = await guardarProveedor({ nombre, categoria: fila.querySelector('.rg-categoria').value || 'otro', dias_credito: 0 });
          if (!p) return;
          await catalogosPagos();
          document.querySelectorAll('#realizado-gastos .rg-proveedor').forEach(s => { const v = s === e.target ? p.id : s.value; s.innerHTML = opcionesProveedor(v); });
          toast('Proveedor agregado');
        } catch (err) { toast('No se pudo agregar: ' + err.message); }
      }
    }
  });
  $('realizado-guardar').addEventListener('click', e => conBoton(e.currentTarget, async () => {
    const lead = REALIZADO; if (!lead) return;
    const si = document.querySelector('input[name="realizado-si"]:checked')?.value;
    if (!si) { toast('Indica si se realizó el servicio'); return; }
    const motivo = $('realizado-motivo').value.trim();
    if (si === 'no' && motivo.replace(/[^\p{L}\p{N}]/gu, '').length < 5) { toast('Escribe por qué no se realizó'); $('realizado-motivo').focus(); return; }
    if (si === 'si' && $('realizado-fecha').value > hoy()) { toast('La fecha en que se realizó no puede ser futura: pon la fecha real'); $('realizado-fecha').focus(); return; }
    if (si === 'si' && !await solicitarDialogo({ titulo: '¿Guardar el servicio como realizado?', mensaje: 'Una vez que el servicio se considera realizado, pasa a Cuentas por cobrar y ya no hay vuelta atrás.', aceptar: 'Sí, guardar' })) return;
    const gastos = [...document.querySelectorAll('#realizado-gastos .realizado-gasto')].map(f => ({
      proveedor_id: Number(f.querySelector('.rg-proveedor').value) || null, categoria: f.querySelector('.rg-categoria').value,
      concepto: f.querySelector('.rg-concepto').value, total: f.querySelector('.rg-total').value.trim(),
      ya_pagado: f.querySelector('.rg-pagado').checked, metodo: f.querySelector('.rg-metodo').value, fecha_pago: f.querySelector('.rg-fecha').value,
      referencia: f.querySelector('.rg-referencia').value, factura_folio: f.querySelector('.rg-folio').value }));
    const r = await enviar('/leads/' + Number(lead.id) + '/ejecucion', 'POST', si === 'si' ? { estado: 'realizado', fecha: $('realizado-fecha').value, gastos } : { estado: 'no_realizado', motivo, gastos });
    if (!r) return;
    $('overlay-realizado').classList.remove('mostrar'); REALIZADO = null;
    if (si === 'no') await avisosNoRealizado(r);
    else toast('Servicio realizado' + (r.gastos ? ` · ${r.gastos} gasto${r.gastos === 1 ? '' : 's'} cargado${r.gastos === 1 ? '' : 's'} en Cuentas por pagar` : ''));
    await refrescarFichaOrden(lead.id);
  }));

  // ===================== Gastos generados de la orden (ficha de la orden) =====================
  let COSTOS_ORDEN = null;
  async function pintarCostosOrden(lead) {
    const sec = $('seccion-costos'), cont = $('costos-orden');
    if (!lead || lead.estatus !== 'ganado') { sec.hidden = true; COSTOS_ORDEN = null; return; }
    sec.hidden = false; COSTOS_ORDEN = lead;
    // Quien no ve cuentas por pagar (p. ej. Atención) no recibe los gastos: se dice, sin pedirlos (antes: «No tienes permiso»).
    if (!puedeCartera('pagar')) { cont.innerHTML = '<p class="ayuda">Tu rol no ve las cuentas por pagar: los gastos de esta orden los revisa administración.</p>'; return; }
    cont.innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    let lista;
    try { lista = await api('/finanzas/cxp?vista=todas&lead_id=' + Number(lead.id)).then(json); }
    catch (err) { cont.innerHTML = `<p class="ayuda">No se pudieron cargar los gastos: ${esc(err.message)}</p>`; return; }
    if (COSTOS_ORDEN?.id !== lead.id) return;
    if (!lista.length) { cont.innerHTML = '<p class="util-45">Sin gastos registrados.</p>'; return; }
    const estado = x => x.saldo <= 0 ? '<span class="estado-cxc pagada">Pagado</span>' : x.pagado > 0 ? '<span class="estado-cxc parcial">Pagado en parte</span>' : '<span class="estado-cxc pendiente">Pendiente de pago</span>';
    const via = x => { const u = (x.ultimo_pago || '').split('|'); return x.ultimo_pago ? ` · ${esc(NOMBRE_METODO[u[1]] || u[1])}${u[2] ? ' · ' + esc(u[2]) : ''} · ${esc(fechaTxt(u[0]))}` : ''; };
    cont.innerHTML = '<div class="pagos-lista">' + lista.map(x => `<div class="pago-fila"><div><b>${formatoMoneda(x.total)}</b> · ${esc(x.proveedor_nombre)} · ${esc(x.concepto)} ${estado(x)}
        <small>${x.factura_folio ? 'Factura ' + esc(x.factura_folio) + ' · ' : ''}Pagado ${formatoMoneda(x.pagado)}${via(x)}</small></div></div>`).join('') + '</div>'
      + `<p class="ayuda">Total de gastos de esta orden: ${formatoMoneda(lista.reduce((t, x) => t + x.total, 0))}. Los pagos se registran en Finanzas → Cuentas por pagar.</p>`;
  }
  $('btn-costo-tercero').addEventListener('click', () => {
    const lead = COSTOS_ORDEN; if (!lead) return;
    nuevoGasto({ 'gasto-orden': folioOrdenServicio(lead), 'gasto-concepto': '', 'gasto-equipo': lead.equipo || '' },
      () => pintarCostosOrden(lead));
  });

  return { guardarProveedor, cargarExcelJS, valorCelda, fechaTexto, cargar, pintarCobranzaOrden, pintarCostosOrden, pintarEjecucion, nuevoGasto, pintarInicio, abrirCobro, pintarCliente, avisoAdeudo, pintarResultados };
})();
