/* Anticipos por comprobar (módulo contable F2, 2026-11-11). Servidor: server/anticipos.js.
   Pestaña «Anticipos» de Cuentas por pagar y bloque «Anticipos» de Inicio.
   · Quien mueve dinero y ve al personal (Dirección, Gerente) entrega, cierra y cancela; ve todos los de sus sucursales.
   · Cada persona ve los suyos y los comprueba con «+ Comprobar gasto» (el formulario normal de gastos, pagado con el anticipo).
   Todo dato se escapa con escaparHtml y los botones usan data-*, sin onclick en línea. */
const Anticipos = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t);
  const dinero = v => formatoMoneda(Number(v || 0));
  const fecha = f => (/^\d{4}-\d{2}-\d{2}/.test(f || '') ? f.slice(0, 10).split('-').reverse().join('/') : '');
  const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  const VIAS = [['efectivo', 'Efectivo'], ['transferencia', 'Transferencia'], ['deposito', 'Depósito'], ['tarjeta', 'Tarjeta'], ['cheque', 'Cheque']];
  const VIA = Object.fromEntries([...VIAS, ['nomina', 'Nómina'], ['layout', 'Layout'], ['otro', 'Otro']]);
  async function pedir(ruta, opciones) {
    const res = await api(ruta, opciones), j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j.error || 'No se pudo completar'), { status: res.status, codigo: j.codigo });
    return j;
  }
  let DATOS = null, FILTRO = 'abiertos', CERRANDO = null;

  async function cargar() {
    const cont = $('anticipos-panel'); if (!cont) return;
    cont.innerHTML = '<p class="ayuda">Cargando anticipos…</p>';
    try { DATOS = await pedir('/anticipos?estado=' + FILTRO); }
    catch (err) { if (err.status !== 401) cont.innerHTML = `<div class="aviso-error-carga" role="alert"><p>No se pudo cargar: ${esc(err.message)}</p><button type="button" class="btn btn-outline" data-ant="recargar">Reintentar</button></div>`; return; }
    pintar();
  }

  function formEntregar() {
    const personas = DATOS.personas || [];
    if (!personas.length) return '<p class="cuentas-aviso">Para entregar un anticipo, primero da de alta a la persona en Personal.</p>';
    return `<details class="ant-entregar" id="ant-entregar"><summary class="btn btn-primario">+ Entregar anticipo</summary>
      <div class="ant-form">
        <div class="form-grid-2">
          <div class="campo"><label for="ant-persona">¿A quién? (obligatorio)</label><select id="ant-persona"><option value="">Selecciona…</option>${personas.map(p => `<option value="${Number(p.id)}">${esc(p.nombre)}${p.puesto ? ' · ' + esc(p.puesto) : ''}</option>`).join('')}</select></div>
          <div class="campo"><label for="ant-monto">Monto (obligatorio)</label><input id="ant-monto" inputmode="decimal" placeholder="Ej. 3000"></div>
          <div class="campo"><label for="ant-fecha">Fecha de entrega (obligatorio)</label><input id="ant-fecha" type="date" value="${esc(hoy())}" max="${esc(hoy())}"></div>
          <div class="campo"><label for="ant-via">¿Cómo se entregó? (obligatorio)</label><select id="ant-via">${VIAS.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select></div>
          <div class="campo"><label for="ant-cuenta-id">Cuenta de salida (con ella recibe su folio)</label><select id="ant-cuenta-id" data-cuentas-banco></select><input data-cb-texto id="ant-cuenta" maxlength="80" placeholder="Ej. Caja chica, BBVA 1234"></div>
          <div class="campo"><label for="ant-referencia">Referencia (opcional)</label><input id="ant-referencia" maxlength="120" placeholder="Ej. SPEI 12345"></div>
        </div>
        <div class="campo"><label for="ant-motivo">¿Para qué es? (obligatorio)</label><input id="ant-motivo" maxlength="300" placeholder="Ej. Casetas y diésel de la ruta a San Juan del Río"></div>
        <button type="button" class="btn btn-primario" data-ant="entregar">Guardar anticipo</button>
      </div></details>`;
  }

  function tarjeta(a) {
    const estado = a.estado === 'cancelado' ? ['vencida', 'Cancelado'] : a.estado === 'cerrado' ? ['pagada', 'Cerrado'] : a.vencido ? ['vencida', `Abierto · ${Number(a.dias)} días`] : ['parcial', 'Abierto'];
    const puede = DATOS.puede_entregar, abierto = a.estado === 'abierto';
    const gastos = a.gastos.length ? `<ul class="ant-gastos">${a.gastos.map(g => `<li><span>${fecha(g.fecha)} · ${esc(g.proveedor)} · ${esc(g.concepto)}${g.xml ? ' · XML' : g.comprobante === 'factura' ? ' · <b>falta el XML</b>' : ''}</span>
        <b>${dinero(g.total)}</b>${g.por_reembolsar > 0 ? `<small class="ant-reembolso">${dinero(g.por_reembolsar)} por reembolsar a ${esc(a.persona)}</small>` : ''}</li>`).join('')}</ul>`
      : '<p class="ayuda">Todavía no tiene gastos comprobados.</p>';
    const cierre = CERRANDO === a.id ? (a.saldo > 0 ? `<div class="ant-form" role="group" aria-label="Cerrar anticipo">
        <p class="cuentas-aviso">Sobraron <b>${dinero(a.saldo)}</b>: anota cómo los regresó ${esc(a.persona)}.</p>
        <div class="form-grid-2">
          <div class="campo"><label for="ant-r-via">¿Cómo los regresó? (obligatorio)</label><select id="ant-r-via">${VIAS.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select></div>
          <div class="campo"><label for="ant-r-fecha">Fecha (obligatorio)</label><input id="ant-r-fecha" type="date" value="${esc(hoy())}" max="${esc(hoy())}"></div>
          <div class="campo"><label for="ant-r-cuenta-id">¿A qué cuenta regresó? (con ella recibe su folio)</label><select id="ant-r-cuenta-id" data-cuentas-banco></select><input data-cb-texto id="ant-r-cuenta" maxlength="80" placeholder="Ej. Caja chica"></div>
          <div class="campo"><label for="ant-r-nota">Nota (opcional)</label><input id="ant-r-nota" maxlength="300"></div>
        </div>
        <button type="button" class="btn btn-primario" data-ant="cerrar-ok" data-id="${Number(a.id)}">Cerrar con reintegro de ${dinero(a.saldo)}</button>
        <button type="button" class="btn btn-outline" data-ant="cerrar-no">No cerrar</button></div>` : '') : '';
    const acciones = abierto ? [
      a.es_mio || puede ? `<button type="button" class="btn btn-secundario" data-ant="comprobar" data-id="${Number(a.id)}">+ Comprobar gasto</button>` : '',
      puede && CERRANDO !== a.id ? `<button type="button" class="btn btn-outline" data-ant="cerrar" data-id="${Number(a.id)}">${a.saldo > 0 ? 'Cerrar (regresó lo que sobró)' : 'Cerrar'}</button>` : '',
      puede && !a.gastos.length ? `<button type="button" class="enlace" data-ant="cancelar" data-id="${Number(a.id)}">Cancelar (se capturó mal)</button>` : '',
    ].join('') : '';
    // Cómo se cerró o por qué se canceló (todo escapado aquí).
    const notas = (a.estado === 'cerrado' && a.reintegro > 0 ? '<br>Regresó ' + esc(dinero(a.reintegro)) + ' el ' + esc(fecha(a.reintegro_fecha)) + ' (' + esc(VIA[a.reintegro_metodo] || a.reintegro_metodo) + ')' : '')
      + (a.nota_cierre ? ' · ' + esc(a.nota_cierre) : '') + (a.estado === 'cancelado' ? '<br>Cancelado: ' + esc(a.motivo_cancelacion) : '');
    return `<article class="ant-tarjeta${a.vencido ? ' ant-vencido' : ''}">
      <header><div><h3>${esc(a.persona)}${a.es_mio ? ' (tú)' : ''}</h3><p class="ayuda">${esc(a.motivo)}${a.orden ? ' · ' + esc(a.orden) : ''}</p></div><span class="estado-cxc ${estado[0]}">${esc(estado[1])}</span></header>
      <dl class="ant-cifras">
        <div><dt>Entregado</dt><dd>${dinero(a.monto)}</dd></div>
        <div><dt>Comprobado</dt><dd>${dinero(a.comprobado)}</dd></div>
        ${a.reintegro > 0 ? `<div><dt>Regresó</dt><dd>${dinero(a.reintegro)}</dd></div>` : ''}
        <div><dt>Por comprobar</dt><dd class="${a.saldo > 0 ? 'ant-pendiente' : ''}">${dinero(a.saldo)}</dd></div>
      </dl>
      <p class="ayuda">Entregó ${esc(a.entrego || '—')} el ${fecha(a.fecha)} · ${esc(VIA[a.metodo] || a.metodo)}${a.cuenta_origen ? ' · ' + esc(a.cuenta_origen) : ''}${a.referencia ? ' · ref. ' + esc(a.referencia) : ''}
        ${notas}</p>
      ${gastos}${cierre}
      ${acciones ? `<div class="ant-acciones">${acciones}</div>` : ''}
    </article>`;
  }

  function pintar() {
    const cont = $('anticipos-panel'), d = DATOS;
    const abiertos = d.anticipos.filter(a => a.estado === 'abierto'), porComprobar = abiertos.reduce((t, a) => t + a.saldo, 0);
    cont.innerHTML = `
      <p class="ayuda">Dinero que se entrega antes del gasto (casetas, diésel, viáticos, una compra en campo). Se comprueba con sus tickets o facturas: cada uno es un gasto que se paga con el anticipo. Lo que sobre se regresa; si los gastos pasan del anticipo, la diferencia se le reembolsa. Pasados ${Number(d.dias_aviso)} días sin cerrarse, avisa en Inicio a quien lo entregó.</p>
      ${d.puede_entregar ? formEntregar() : ''}
      <div class="pendientes-filtros" role="group" aria-label="Mostrar anticipos">
        ${[['abiertos', 'Abiertos'], ['cerrados', 'Cerrados y cancelados'], ['todos', 'Todos']].map(([v, t]) => `<button type="button" class="${FILTRO === v ? 'activo' : ''}" data-ant-filtro="${v}">${t}</button>`).join('')}
      </div>
      ${FILTRO !== 'cerrados' && abiertos.length ? `<p class="ant-total">${abiertos.length} ${abiertos.length === 1 ? 'anticipo abierto' : 'anticipos abiertos'} · <b>${dinero(porComprobar)}</b> por comprobar</p>` : ''}
      ${d.anticipos.length ? `<div class="ant-lista">${d.anticipos.map(tarjeta).join('')}</div>` : `<p class="util-45">${FILTRO === 'abiertos' ? 'No hay anticipos abiertos.' : 'No hay anticipos.'}</p>`}`;
  }

  document.addEventListener('click', async e => {
    const f = e.target.closest('[data-ant-filtro]');
    if (f && $('anticipos-panel')?.contains(f)) { FILTRO = f.dataset.antFiltro; CERRANDO = null; return cargar(); }
    const b = e.target.closest('[data-ant]'); if (!b || !$('anticipos-panel')?.contains(b)) return;
    const accion = b.dataset.ant, id = Number(b.dataset.id) || 0, a = DATOS?.anticipos.find(x => x.id === id);
    if (accion === 'recargar') return cargar();
    if (accion === 'comprobar' && a) return Finanzas.nuevoGasto({ anticipo: { id: a.id, persona: a.persona, saldo: a.saldo } }, cargar);
    if (accion === 'cerrar' && a) {
      if (a.saldo > 0) { CERRANDO = a.id; pintar(); $('ant-r-via')?.focus(); return; }
      if (!await solicitarDialogo({ titulo: 'Cerrar anticipo', mensaje: `El anticipo de ${a.persona} ya está comprobado completo (${dinero(a.monto)}). ¿Lo cierras? Ya no recibirá más gastos.`, aceptar: 'Cerrar' })) return;
      return conBotonAnt(b, async () => { await pedir('/anticipos/' + id + '/cerrar', { method: 'POST', body: '{}' }); toast('Anticipo cerrado'); CERRANDO = null; cargar(); });
    }
    if (accion === 'cerrar-no') { CERRANDO = null; return pintar(); }
    if (accion === 'cerrar-ok') return conBotonAnt(b, async () => {
      const r = await pedir('/anticipos/' + id + '/cerrar', { method: 'POST', body: JSON.stringify({ metodo: $('ant-r-via').value, fecha: $('ant-r-fecha').value, cuenta: $('ant-r-cuenta').value, cuenta_id: CuentasBanco.valor('ant-r-cuenta-id'), nota: $('ant-r-nota').value }) });
      toast(`Anticipo cerrado: regresó ${dinero(r.reintegro)}`); CERRANDO = null; cargar();
    });
    if (accion === 'cancelar' && a) {
      const motivo = await solicitarDialogo({ titulo: 'Cancelar anticipo', mensaje: `Solo si se capturó mal (no se entregó ese dinero a ${a.persona}). No se borra: queda cancelado con el motivo.`, aceptar: 'Cancelar anticipo', campo: { tipo: 'text', etiqueta: 'Motivo', requerido: 'Escribe el motivo (mínimo 5 letras)' } });
      if (!motivo) return;
      return conBotonAnt(b, async () => { await pedir('/anticipos/' + id + '/cancelar', { method: 'POST', body: JSON.stringify({ motivo }) }); toast('Anticipo cancelado'); cargar(); });
    }
    if (accion === 'entregar') return conBotonAnt(b, async () => {
      const cuerpo = { personal_id: Number($('ant-persona').value) || null, monto: $('ant-monto').value.trim().replace(/[$,\s]/g, ''), fecha: $('ant-fecha').value, metodo: $('ant-via').value,
        cuenta_origen: $('ant-cuenta').value, cuenta_id: CuentasBanco.valor('ant-cuenta-id'), referencia: $('ant-referencia').value, motivo: $('ant-motivo').value };
      if (!cuerpo.personal_id) { toast('Elige a quién se le entrega'); $('ant-persona').focus(); return; }
      try { await pedir('/anticipos', { method: 'POST', body: JSON.stringify(cuerpo) }); }
      catch (err) {
        if (err.codigo !== 'POSIBLE_DUPLICADO') throw err;
        if (!await solicitarDialogo({ titulo: 'Posible anticipo repetido', mensaje: err.message + '\n\nSi es otro anticipo, confirma para guardarlo.', aceptar: 'Sí, guardarlo' })) return;
        await pedir('/anticipos', { method: 'POST', body: JSON.stringify({ ...cuerpo, forzar: true }) });
      }
      toast('Anticipo registrado'); FILTRO = 'abiertos'; cargar();
    });
  });
  async function conBotonAnt(boton, fn) {
    boton.disabled = true;
    try { await fn(); } catch (err) { toast(err.message); } finally { boton.disabled = false; }
  }

  // ---------- Inicio ----------
  async function pintarInicio() {
    const cont = $('inicio-anticipos'); if (!cont || !Permisos.puede('cxp.ver')) return;
    let r;
    try { r = await pedir('/anticipos/avisos'); }
    catch (err) { if (err.status !== 401) cont.innerHTML = `<div class="aviso-error-carga" role="alert"><p>No se pudo cargar: ${esc(err.message)}</p><button type="button" class="btn btn-outline" data-inicio-ant="reintentar">Reintentar</button></div>`; return; }
    cont.dataset.urgente = r.avisos.some(a => a.urgente) ? '1' : '';
    cont.dataset.resumen = r.avisos.length ? `${r.avisos.length} por revisar` : 'Al corriente';
    cont.innerHTML = r.avisos.length ? r.avisos.map(a => `<button type="button" class="fila-alerta${a.urgente ? ' vencido' : ' aviso'}" data-inicio-ant="abrir"><span class="info"><b>${esc(a.texto)}</b><span class="txt">${esc(a.detalle)}</span></span><span aria-hidden="true">›</span></button>`).join('')
      : '<p class="util-45">Sin anticipos por comprobar.</p>';
  }
  $('inicio-anticipos')?.addEventListener('click', e => {
    const b = e.target.closest('[data-inicio-ant]'); if (!b) return;
    if (b.dataset.inicioAnt === 'reintentar') return pintarInicio();
    cambiarVista('cuentas', { pestana: 'anticipos' });
  });

  return { cargar, pintarInicio };
})();
window.Anticipos = Anticipos;
