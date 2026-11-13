/* Nómina semanal (módulo contable F3, 2026-11-11). Servidor: server/nomina.js.
   Pantalla «Nómina y pago» (menú RH) y bloque «Nómina» de Inicio. Sin lógica de dinero aquí: el servidor calcula los
   totales; la pantalla solo manda lo que se captura (descuento, otros pagos y neto del IMSS) y lo vuelve a pedir.
   Todo dato se escapa con escaparHtml y los botones usan data-*, sin onclick en línea. */
const Nomina = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t);
  const dinero = v => formatoMoneda(Number(v || 0));
  const fecha = f => (/^\d{4}-\d{2}-\d{2}/.test(f || '') ? f.slice(0, 10).split('-').reverse().join('/') : '');
  const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  const VIAS = [['layout', 'Layout del banco'], ['transferencia', 'Transferencia'], ['efectivo', 'Efectivo'], ['cheque', 'Cheque']];
  const ESTADO = { sin_preparar: ['por-confirmar', 'Sin preparar'], abierta: ['parcial', 'Abierta'], cerrada: ['vencida', 'Cerrada sin pagar'], pagada: ['pagada', 'Pagada'] };
  async function pedir(ruta, opciones) {
    const res = await api(ruta, opciones), j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j.error || 'No se pudo completar'), { status: res.status, codigo: j.codigo, datos: j });
    return j;
  }
  let D = null, DESDE = null, SUC = null, listo = false, REGLAS_ABIERTAS = false;
  // Bono de puntualidad de una persona: lo que calculó la regla de su puesto, y quitarlo o regresarlo (con motivo).
  function puntualidadCelda(l, edita) {
    if (!l.puntualidad_razon && !l.puntualidad_calculada) return '<small>—</small>';
    const quitar = edita && l.puntualidad_calculada > 0 ? `<br><button type="button" class="enlace" data-nm="${l.puntualidad_quitada ? 'regresar-pu' : 'quitar-pu'}" data-linea="${Number(l.id)}">${l.puntualidad_quitada ? 'Regresar' : 'Quitar'}</button>` : '';
    const nota = l.puntualidad_quitada ? 'Quitado: ' + l.puntualidad_motivo : l.puntualidad_razon;
    return `${l.puntualidad_quitada ? '<s>' + esc(dinero(l.puntualidad_calculada)) + '</s>' : esc(dinero(l.puntualidad))}<br><small class="${l.puntualidad > 0 ? '' : 'nm-gris'}">${esc(nota)}</small>${quitar}`;
  }
  async function pintarReglas() {
    const cont = $('nm-reglas-cuerpo'); if (!cont) return;
    let r; try { r = await pedir('/nomina/reglas-puntualidad?sucursal=' + Number(D.sucursal_id)); } catch (err) { Repintado.falla(cont, err, pintarReglas, `<div class="aviso-error-carga" role="alert"><p>No se pudo cargar: ${esc(err.message)}</p></div>`); return; }
    const txt = g => !g ? 'Sin bono' : g.monto > 0 ? `${dinero(g.monto)} por semana · hasta ${g.max_retardos} retardo(s) y ${g.max_faltas} falta(s)${g.max_retardo_min != null ? ` · máximo ${g.max_retardo_min} min de retardo` : ''} · desde ${fecha(g.desde)}` : `Sin bono desde ${fecha(g.desde)}`;
    const con = r.vigentes.filter(v => v.regla || v.proxima);
    Repintado.pintar(cont, `<p class="ayuda">Por puesto, en esta sucursal. Vacaciones, incapacidades y permisos se respetan (no cuentan como falta). Solo aplica a quien checa. Un cambio es una regla nueva desde una fecha; las semanas ya cerradas no cambian.</p>
      ${con.length ? `<ul class="nm-reglas-lista">${con.map(v => `<li><b>${esc(v.puesto)}</b>: ${esc(txt(v.regla))}${v.proxima ? ` <small>(cambia el ${esc(fecha(v.proxima.desde))}: ${esc(txt(v.proxima))})</small>` : ''}</li>`).join('')}</ul>` : '<p class="util-45">Todavía no hay reglas: nadie recibe bono de puntualidad.</p>'}
      <div class="nm-pago"><h3>Poner o cambiar una regla</h3><div class="form-grid-2">
        <div class="campo"><label for="nm-r-puesto">Puesto (obligatorio)</label><select id="nm-r-puesto">${r.puestos.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select></div>
        <div class="campo"><label for="nm-r-monto">Bono por semana (obligatorio; 0 = sin bono)</label><input id="nm-r-monto" inputmode="decimal" placeholder="Ej. 200"></div>
        <div class="campo"><label for="nm-r-ret">Retardos permitidos en la semana</label><input id="nm-r-ret" type="number" min="0" max="7" value="0"></div>
        <div class="campo"><label for="nm-r-fal">Faltas permitidas en la semana</label><input id="nm-r-fal" type="number" min="0" max="7" value="0"></div>
        <div class="campo"><label for="nm-r-min">Minutos de retardo máximos (opcional)</label><input id="nm-r-min" type="number" min="0" max="600" placeholder="Sin límite"></div>
        <div class="campo"><label for="nm-r-desde">Aplica desde (obligatorio)</label><input id="nm-r-desde" type="date" value="${esc(D.desde)}"></div>
      </div><button type="button" class="btn btn-primario" data-nm="guardar-regla">Guardar regla</button></div>`);
  }

  async function cargar(opciones = {}) {
    if (!listo) iniciar();
    if (opciones.desde) DESDE = opciones.desde;
    if (opciones.sucursal) SUC = opciones.sucursal;
    const cont = $('nm-cuerpo');
    Repintado.cargando(cont, (DESDE || D?.desde || '') + '|' + (SUC || D?.sucursal_id || ''), '<p class="ayuda">Cargando nómina…</p>');
    try { D = await pedir('/nomina?desde=' + encodeURIComponent(DESDE || '') + (SUC ? '&sucursal=' + Number(SUC) : '')); }
    catch (err) { if (err.status !== 401) Repintado.falla(cont, err, cargar, `<div class="aviso-error-carga" role="alert"><p>No se pudo cargar: ${esc(err.message)}</p></div>`); return; }
    if (!DESDE) { DESDE = D.vencida; if (D.desde !== D.vencida) return cargar(); }
    DESDE = D.desde; SUC = D.sucursal_id;
    $('nm-sucursal').innerHTML = D.sucursales.map(s => `<option value="${Number(s.id)}"${s.id === D.sucursal_id ? ' selected' : ''}>${esc(s.nombre)}</option>`).join('');
    $('nm-sucursal').hidden = D.sucursales.length < 2;
    $('nm-semana').textContent = `Semana del ${fecha(D.desde)} al ${fecha(D.hasta)}`;
    $('nm-siguiente').disabled = D.siguiente > hoy();
    pintar(); pintarReglas();
  }
  function iniciar() {
    listo = true;
    $('nm-sucursal').addEventListener('change', () => cargar({ sucursal: Number($('nm-sucursal').value) }));
    $('nm-anterior').addEventListener('click', () => cargar({ desde: D?.anterior }));
    $('nm-siguiente').addEventListener('click', () => cargar({ desde: D?.siguiente }));
    $('nm-vencida').addEventListener('click', () => cargar({ desde: D?.vencida }));
    $('nm-excel').addEventListener('click', e => conBoton(e.currentTarget, excel));
    $('nm-cuerpo').addEventListener('change', guardarCampo);
    $('nm-cuerpo').addEventListener('click', accion);
    $('nm-cuerpo').addEventListener('toggle', e => { if (e.target.id === 'nm-reglas') REGLAS_ABIERTAS = e.target.open; }, true);
  }

  function pintar() {
    const d = D, edita = d.puede.editar, [clase, txt] = ESTADO[d.estado] || ['', d.estado];
    const num = (l, k, etiqueta) => edita ? `<input class="nm-num" type="text" inputmode="decimal" data-linea="${Number(l.id)}" data-campo="${k}" value="${l[k] == null ? '' : esc(Number(l[k]).toFixed(2))}" aria-label="${esc(etiqueta + ' de ' + l.nombre)}" placeholder="${k === 'neto_imss' ? 'del contador' : '0.00'}">` : (l[k] == null ? '—' : esc(dinero(l[k])));
    const nota = (l, k, etiqueta) => edita ? `<input class="nm-nota" type="text" maxlength="200" data-linea="${Number(l.id)}" data-campo="${k}" value="${esc(l[k] || '')}" aria-label="${esc(etiqueta + ' de ' + l.nombre)}" placeholder="¿por qué?">` : (l[k] ? `<small>${esc(l[k])}</small>` : '');
    const filas = d.lineas.map(l => `<tr class="${l.pendientes.length ? 'nm-pend' : ''}">
      <td><b>${esc(l.nombre)}</b><br><small>${esc(l.puesto || '')}${l.numero_empleado ? ' · No. ' + esc(l.numero_empleado) : ''}</small>${l.pendientes.length ? `<ul class="nm-avisos">${l.pendientes.map(p => `<li>⚠ ${esc(p)}</li>`).join('')}</ul>` : ''}</td>
      <td class="nm-c">${l.checa ? `${Number(l.dias_trabajados)} / ${Number(l.faltas)} / ${Number(l.retardos)}` : '<small>no checa</small>'}</td>
      <td class="nm-d">${esc(dinero(l.sueldo_imss))}</td>
      <td class="nm-d">${l.sueldo_imss > 0 ? num(l, 'neto_imss', 'Neto del IMSS') : '—'}${l.falta_neto && !edita ? '<br><small class="rojo">falta</small>' : ''}</td>
      <td class="nm-d">${esc(dinero(l.bono))}</td>
      <td class="nm-d">${esc(dinero(l.extra))}${l.extra_min ? `<br><small>${Math.round(l.extra_min / 6) / 10} h</small>` : ''}${l.sin_precio_extra ? '<br><small class="rojo">puesto sin precio por hora</small>' : ''}</td>
      <td class="nm-d">${puntualidadCelda(l, edita)}</td>
      <td class="nm-d">${num(l, 'otros', 'Otros pagos')}${nota(l, 'otros_nota', 'Motivo de otros pagos')}</td>
      <td class="nm-d">${num(l, 'descuento', 'Descuento')}${nota(l, 'descuento_nota', 'Motivo del descuento')}</td>
      <td class="nm-d"><b>${esc(dinero(l.total))}</b></td></tr>`).join('');
    const t = d.totales;
    const acciones = [];
    if (d.estado === 'sin_preparar') acciones.push('<button type="button" class="btn btn-primario" data-nm="preparar">Preparar nómina de esta semana</button>');
    if (d.estado === 'abierta') acciones.push('<button type="button" class="btn btn-outline" data-nm="actualizar">↻ Volver a leer checador y fichas</button>', '<button type="button" class="btn btn-primario" data-nm="cerrar">Cerrar nómina</button>');
    if (d.puede.reabrir) acciones.push('<button type="button" class="btn btn-outline" data-nm="reabrir">Reabrir (Dirección)</button>');
    if (['cerrada', 'pagada'].includes(d.estado) && d.puede.pagar) acciones.push('<button type="button" class="btn btn-outline" data-nm="lista">🏦 Lista para el banco (CSV)</button>');
    const pago = d.estado === 'cerrada' && d.puede.pagar ? `<div class="nm-pago" role="group" aria-label="Registrar el pago">
        <h3>Registrar el pago</h3>
        <div class="form-grid-2">
          <div class="campo"><label for="nm-p-via">¿Cómo se pagó? (obligatorio)</label><select id="nm-p-via">${VIAS.map(([v, x]) => `<option value="${v}">${esc(x)}</option>`).join('')}</select></div>
          <div class="campo"><label for="nm-p-cuenta-id">Cuenta de salida (obligatorio; con ella recibe su folio)</label><select id="nm-p-cuenta-id" data-cuentas-banco></select><input data-cb-texto id="nm-p-cuenta" maxlength="80" list="nm-cuentas" placeholder="Ej. Santander nómina"><datalist id="nm-cuentas"><option value="Santander nómina"></option><option value="Banorte nómina"></option></datalist></div>
          <div class="campo"><label for="nm-p-fecha">Fecha de pago (obligatorio)</label><input id="nm-p-fecha" type="date" value="${esc(hoy())}" max="${esc(hoy())}"></div>
          <div class="campo"><label for="nm-p-ref">Referencia (opcional)</label><input id="nm-p-ref" maxlength="120" placeholder="Ej. Layout 15/11"></div>
        </div>
        <button type="button" class="btn btn-primario" data-nm="pagar">Registrar pago de ${esc(dinero(t.total))}</button></div>` : '';
    const pagoTxt = d.estado === 'pagada' ? '<span class="ayuda">Pagó ' + esc(d.pago) + ' el ' + esc(fecha(d.fecha_pago)) + ' desde ' + esc(d.cuenta_origen) + '</span>' : '';
    const reglasAntes = $('nm-reglas-cuerpo')?.innerHTML || ''; // las reglas ya cargadas se quedan mientras llegan las nuevas
    Repintado.pintar($('nm-cuerpo'), `
      <div class="nm-cabeza"><span class="estado-cxc ${clase}">${esc(txt)}</span>
        ${d.estado === 'sin_preparar' ? '<span class="ayuda">Es la propuesta con lo que hay hoy: al prepararla se guarda y ya se puede capturar.</span>' : ''}
        ${d.cerro ? `<span class="ayuda">Cerró ${esc(d.cerro)} el ${esc(fecha(d.cerrada_at))}${d.forzada_motivo ? ' · ' + esc(d.forzada_motivo) : ''}</span>` : ''}
        ${pagoTxt}</div>
      <div class="logs-tarjetas">
        <div class="tarjeta-dinero"><small>Total a pagar</small><b>${esc(dinero(t.total))}</b><span>${Number(t.personas)} personas</span></div>
        <div class="tarjeta-dinero"><small>Sueldos IMSS (bruto)</small><b>${esc(dinero(t.sueldo_imss))}</b>${d.sin_neto ? `<span class="rojo">${Number(d.sin_neto)} sin neto del contador</span>` : ''}</div>
        <div class="tarjeta-dinero"><small>Bonos</small><b>${esc(dinero(t.bono))}</b></div>
        <div class="tarjeta-dinero"><small>Tiempo extra</small><b>${esc(dinero(t.extra))}</b></div>
        <div class="tarjeta-dinero"><small>Bono de puntualidad</small><b>${esc(dinero(t.puntualidad))}</b></div>
        <div class="tarjeta-dinero ${t.faltas ? 'aviso' : ''}"><small>Faltas / retardos</small><b>${Number(t.faltas)} / ${Number(t.retardos)}</b><span>se reportan; RH decide</span></div>
        ${d.pendientes ? `<div class="tarjeta-dinero alerta"><small>Con pendientes</small><b>${Number(d.pendientes)}</b><span>resolver en Asistencia o Personal</span></div>` : ''}
      </div>
      ${acciones.length ? `<div class="nm-acciones">${acciones.join('')}</div>` : ''}
      ${d.lineas.length ? `<div class="nm-tabla-caja"><table class="nm-tabla"><thead><tr><th>Persona</th><th>Días / faltas / retardos</th><th>Sueldo IMSS</th><th>Neto IMSS</th><th>Bono</th><th>Tiempo extra</th><th>Puntualidad</th><th>Otros pagos</th><th>Descuento</th><th>Total</th></tr></thead>
        <tbody>${filas}</tbody><tfoot><tr><td>Total</td><td></td><td class="nm-d">${esc(dinero(t.sueldo_imss))}</td><td></td><td class="nm-d">${esc(dinero(t.bono))}</td><td class="nm-d">${esc(dinero(t.extra))}</td><td class="nm-d">${esc(dinero(t.puntualidad))}</td><td class="nm-d">${esc(dinero(t.otros))}</td><td class="nm-d">${esc(dinero(t.descuento))}</td><td class="nm-d"><b>${esc(dinero(t.total))}</b></td></tr></tfoot></table></div>`
        : '<p class="util-45">Nadie entra en esta nómina: nadie de la sucursal checa ni tiene sueldo semanal en su ficha.</p>'}
      ${pago}
      <details class="nm-reglas" id="nm-reglas"${REGLAS_ABIERTAS ? ' open' : ''}><summary>🏅 Reglas del bono de puntualidad</summary><div id="nm-reglas-cuerpo">${reglasAntes || '<p class="ayuda">Cargando…</p>'}</div></details>
      <p class="ayuda">Total = neto del IMSS (o el sueldo IMSS mientras el contador no lo da) + bono + tiempo extra + puntualidad + otros − descuento. El ISR y el IMSS los calcula el contador. La lista para el banco es genérica; el formato exacto de Santander y Banorte se ajusta con una muestra vacía de su portal.</p>`);
  }

  async function guardarCampo(e) {
    const el = e.target.closest('[data-linea]'); if (!el) return;
    const id = Number(el.dataset.linea), campo = el.dataset.campo, cuerpo = { [campo]: el.value.trim().replace(/[$,\s]/g, '') };
    if (/_nota$/.test(campo)) cuerpo[campo] = el.value;
    // Monto y su nota van juntos (el servidor pide la nota si hay monto).
    const pareja = { descuento: 'descuento_nota', otros: 'otros_nota', descuento_nota: 'descuento', otros_nota: 'otros' }[campo];
    if (pareja) { const otro = document.querySelector(`[data-linea="${id}"][data-campo="${pareja}"]`); if (otro) cuerpo[pareja] = /_nota$/.test(pareja) ? otro.value : otro.value.trim().replace(/[$,\s]/g, ''); }
    // Monto sin su nota todavía: se espera a que escriban la nota.
    if ((campo === 'descuento' || campo === 'otros') && Number(cuerpo[campo]) > 0 && !String(cuerpo[pareja] || '').trim()) { toast('Escribe también el motivo'); document.querySelector(`[data-linea="${id}"][data-campo="${pareja}"]`)?.focus(); return; }
    try {
      await pedir('/nomina/lineas/' + id, { method: 'PUT', body: JSON.stringify(cuerpo) }); toast('Guardado');
      // Al volver a dibujar, el cursor regresa al campo donde ya estaba (p. ej. pasó con Tab al siguiente).
      const foco = document.activeElement?.closest?.('[data-linea]'), dondeL = foco?.dataset.linea, dondeC = foco?.dataset.campo, valor = foco?.value;
      await cargar();
      const nuevo = dondeL && document.querySelector(`[data-linea="${dondeL}"][data-campo="${dondeC}"]`);
      if (nuevo) { if (valor !== undefined && nuevo.value !== valor) nuevo.value = valor; nuevo.focus(); }
    } catch (err) { toast(err.message); }
  }

  async function accion(e) {
    const b = e.target.closest('[data-nm]'); if (!b) return;
    const a = b.dataset.nm;
    if (a === 'guardar-regla') return conBoton(b, async () => {
      const monto = $('nm-r-monto').value.trim().replace(/[$,\s]/g, '');
      if (monto === '') { toast('Escribe el bono por semana (0 = sin bono)'); $('nm-r-monto').focus(); return; }
      await pedir('/nomina/reglas-puntualidad', { method: 'POST', body: JSON.stringify({ sucursal_id: D.sucursal_id, puesto: $('nm-r-puesto').value, monto, max_retardos: $('nm-r-ret').value, max_faltas: $('nm-r-fal').value, max_retardo_min: $('nm-r-min').value, desde: $('nm-r-desde').value }) });
      toast('Regla guardada'); REGLAS_ABIERTAS = true; cargar();
    });
    if (a === 'quitar-pu') {
      const motivo = await solicitarDialogo({ titulo: 'Quitar bono de puntualidad', mensaje: 'Solo a esta persona y en esta semana. Queda anotado el motivo.', aceptar: 'Quitar', campo: { tipo: 'text', etiqueta: 'Motivo', requerido: 'Escribe el motivo (mínimo 5 letras)' } });
      if (!motivo) return;
      return conBoton(b, async () => { await pedir('/nomina/lineas/' + Number(b.dataset.linea), { method: 'PUT', body: JSON.stringify({ quitar_puntualidad: true, puntualidad_motivo: motivo }) }); toast('Bono quitado'); cargar(); });
    }
    if (a === 'regresar-pu') return conBoton(b, async () => { await pedir('/nomina/lineas/' + Number(b.dataset.linea), { method: 'PUT', body: JSON.stringify({ quitar_puntualidad: false }) }); toast('Bono regresado'); cargar(); });
    if (a === 'preparar') return conBoton(b, async () => { await pedir('/nomina/preparar', { method: 'POST', body: JSON.stringify({ desde: D.desde, sucursal_id: D.sucursal_id }) }); toast('Nómina preparada'); cargar(); });
    if (a === 'actualizar') return conBoton(b, async () => { await pedir('/nomina/' + D.id + '/actualizar', { method: 'POST', body: '{}' }); toast('Datos al día'); cargar(); });
    if (a === 'cerrar') return conBoton(b, async () => {
      if (!await solicitarDialogo({ titulo: 'Cerrar nómina', mensaje: `Se cierra la nómina de ${D.totales.personas} personas por ${dinero(D.totales.total)}. Ya no se podrá cambiar (solo Dirección la reabre, si no se ha pagado).`, aceptar: 'Cerrar' })) return;
      try { await pedir('/nomina/' + D.id + '/cerrar', { method: 'POST', body: '{}' }); }
      catch (err) {
        if (err.codigo !== 'PENDIENTES' || !err.datos?.puede_forzar) throw err;
        const motivo = await solicitarDialogo({ titulo: 'Hay pendientes del checador', mensaje: err.message, aceptar: 'Cerrar de todos modos', campo: { tipo: 'text', etiqueta: 'Motivo', requerido: 'Escribe el motivo (mínimo 5 letras)' } });
        if (!motivo) return;
        await pedir('/nomina/' + D.id + '/cerrar', { method: 'POST', body: JSON.stringify({ forzar: true, motivo }) });
      }
      toast('Nómina cerrada'); cargar();
    });
    if (a === 'reabrir') {
      const motivo = await solicitarDialogo({ titulo: 'Reabrir nómina', mensaje: 'Vuelve a quedar abierta para corregir. Queda anotado quién y por qué.', aceptar: 'Reabrir', campo: { tipo: 'text', etiqueta: 'Motivo', requerido: 'Escribe el motivo (mínimo 5 letras)' } });
      if (!motivo) return;
      return conBoton(b, async () => { await pedir('/nomina/' + D.id + '/reabrir', { method: 'POST', body: JSON.stringify({ motivo }) }); toast('Nómina reabierta'); cargar(); });
    }
    if (a === 'pagar') return conBoton(b, async () => {
      const cuerpo = { metodo: $('nm-p-via').value, cuenta_origen: $('nm-p-cuenta').value, cuenta_id: CuentasBanco.valor('nm-p-cuenta-id'), fecha: $('nm-p-fecha').value, referencia: $('nm-p-ref').value };
      // Con cuentas dadas de alta se elige de la lista; sin cuentas, se escribe como antes.
      if (!$('nm-p-cuenta-id').hidden ? !cuerpo.cuenta_id : !cuerpo.cuenta_origen.trim()) { toast('Elige de qué cuenta salió'); ($('nm-p-cuenta-id').hidden ? $('nm-p-cuenta') : $('nm-p-cuenta-id')).focus(); return; }
      if (!await solicitarDialogo({ titulo: 'Registrar pago', mensaje: `Se registra el pago de la nómina por ${dinero(D.totales.total)} desde «${cuerpo.cuenta_origen || $('nm-p-cuenta-id').selectedOptions[0]?.textContent || ''}». Queda como gasto de «Sueldos» ya pagado.`, aceptar: 'Registrar pago' })) return;
      await pedir('/nomina/' + D.id + '/pagar', { method: 'POST', body: JSON.stringify(cuerpo) }); toast('Pago de nómina registrado'); cargar();
    });
    if (a === 'lista') return conBoton(b, async () => {
      const res = await api('/nomina/' + D.id + '/lista-banco');
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'No se pudo descargar');
      saveAs(await res.blob(), `nomina_${D.sucursal}_${D.desde}.csv`);
    });
  }
  async function conBoton(boton, fn) { boton.disabled = true; try { await fn(); } catch (err) { toast(err.message); } finally { boton.disabled = false; } }

  // Excel para el contador: una hoja con cada persona (sin CLABE) y los totales.
  async function excel() {
    if (!D?.lineas?.length) { toast('No hay nadie en esta nómina'); return; }
    const ExcelJS = await Finanzas.cargarExcelJS(), wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Nómina');
    ws.columns = [['No. empleado', 12], ['Nombre', 30], ['Puesto', 16], ['Días trabajados', 10], ['Faltas', 8], ['Retardos', 9], ['Sueldo IMSS', 14], ['Neto IMSS', 14], ['Bono', 12], ['Horas extra', 10], ['Tiempo extra', 13], ['Bono puntualidad', 14], ['Otros pagos', 13], ['Motivo otros', 24], ['Descuento', 12], ['Motivo descuento', 24], ['Total', 14], ['Pendientes', 40]]
      .map(([header, width], i) => ({ header, width, key: 'c' + i, style: [6, 7, 8, 10, 11, 12, 14, 16].includes(i) ? { numFmt: '"$"#,##0.00' } : {} }));
    ws.getRow(1).font = { bold: true };
    for (const l of D.lineas) ws.addRow([l.numero_empleado, l.nombre, l.puesto, l.dias_trabajados, l.faltas, l.retardos, l.sueldo_imss, l.neto_imss, l.bono, Math.round(l.extra_min / 6) / 10, l.extra, l.puntualidad, l.otros, l.otros_nota, l.descuento, l.descuento_nota, l.total, l.pendientes.join('; ')]);
    const t = D.totales, fila = ws.addRow(['', 'TOTAL', '', '', t.faltas, t.retardos, t.sueldo_imss, '', t.bono, '', t.extra, t.puntualidad, t.otros, '', t.descuento, '', t.total, '']);
    fila.font = { bold: true };
    ws.addRow([]); ws.addRow(['', `Semana del ${fecha(D.desde)} al ${fecha(D.hasta)} · ${D.sucursal} · ${ESTADO[D.estado]?.[1] || D.estado}`]); // sin HTML: es una celda de Excel
    ws.addRow(['', 'El neto del IMSS (ISR e IMSS) lo calcula el contador. Las faltas se reportan; el descuento lo decide RH.']);
    saveAs(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `nomina_${D.sucursal}_${D.desde}.xlsx`);
  }

  // ---------- Inicio ----------
  async function pintarInicio() {
    const cont = $('inicio-nomina'); if (!cont || !(Permisos.puede('nomina.preparar') || Permisos.direccion())) return;
    let r;
    try { r = await pedir('/nomina/avisos'); }
    catch (err) { if (err.status !== 401) cont.innerHTML = `<div class="aviso-error-carga" role="alert"><p>No se pudo cargar: ${esc(err.message)}</p><button type="button" class="btn btn-outline" data-inicio-nm="reintentar">Reintentar</button></div>`; return; }
    cont.dataset.urgente = r.avisos.length ? '1' : '';
    cont.dataset.resumen = r.avisos.length ? `${r.avisos.length} por atender` : 'Al corriente';
    cont.innerHTML = r.avisos.length ? r.avisos.map(a => `<button type="button" class="fila-alerta vencido" data-inicio-nm="abrir" data-desde="${esc(a.desde)}" data-sucursal="${Number(a.sucursal_id)}"><span class="info"><b>${esc(a.texto)}</b><span class="txt">${esc(a.detalle)}</span></span><span aria-hidden="true">›</span></button>`).join('')
      : '<p class="util-45">La nómina está al día.</p>';
  }
  $('inicio-nomina')?.addEventListener('click', e => {
    const b = e.target.closest('[data-inicio-nm]'); if (!b) return;
    if (b.dataset.inicioNm === 'reintentar') return pintarInicio();
    DESDE = b.dataset.desde; SUC = Number(b.dataset.sucursal); cambiarVista('nomina');
  });

  return { cargar, pintarInicio };
})();
window.Nomina = Nomina;
