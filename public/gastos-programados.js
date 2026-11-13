/* Gastos programados (Cuentas por pagar, fase 4, 2026-11-13). Servidor: server/gastos-programados.js.
   Pestaña «Programados» de Cuentas por pagar y bloque «Gastos programados» de Inicio. Solo quien paga (dinero.mover).
   · Se dan de alta una vez («Luz Cancún», «Luz casa de Miguel») con los meses en que llegan y el día.
   · Cuando toca, aparece «Falta registrar…»: «Registrar gasto» abre el formulario normal ya llenado (solo falta el monto
     del recibo o su XML) y al guardar ese mes queda registrado; «No llegó» lo marca con un motivo (se puede reabrir).
   Todo dato se escapa con escaparHtml y los botones usan data-*, sin onclick en línea. */
const GastosProgramados = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t);
  const dinero = v => formatoMoneda(Number(v || 0));
  const fecha = f => (/^\d{4}-\d{2}-\d{2}/.test(f || '') ? f.slice(0, 10).split('-').reverse().join('/') : '');
  const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  // «· último: noviembre 2026 $1,635.48» (o «(no llegó)»): texto plano, se escapa al pintarlo.
  const ultimoTxt = p => (p.ultimo ? ' · último: ' + p.ultimo.periodo_txt + (p.ultimo.estado === 'omitido' ? ' (no llegó)' : p.ultimo.monto != null ? ' ' + dinero(p.ultimo.monto) : '') : '');
  const textoMeses = m => (m.length === 12 ? 'Todos los meses' : m.length === 6 && m.every(x => x % 2 === 1) ? 'Bimestral (ene, mar, may…)' : m.length === 6 && m.every(x => x % 2 === 0) ? 'Bimestral (feb, abr, jun…)' : m.map(x => MESES[x - 1]).join(', '));
  async function pedir(ruta, opciones) {
    const res = await api(ruta, opciones), j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j.error || 'No se pudo completar'), { status: res.status });
    return j;
  }
  let DATOS = null, VER_INACTIVOS = false, EDITANDO = null, CATALOGOS = null;

  async function cargar() {
    const cont = $('gp-panel'); if (!cont) return;
    Repintado.cargando(cont, '', '<p class="ayuda">Cargando gastos programados…</p>');
    try { DATOS = await pedir('/gastos-programados'); }
    catch (err) { if (err.status !== 401) Repintado.falla(cont, err, cargar, `<div class="aviso-error-carga" role="alert"><p>No se pudo cargar: ${esc(err.message)}</p><button type="button" class="btn btn-outline" data-gp="recargar">Reintentar</button></div>`); return; }
    pintar();
  }

  function pintar() {
    const cont = $('gp-panel'), d = DATOS;
    const lista = d.programados.filter(p => VER_INACTIVOS || p.activo);
    const pendientes = d.pendientes.length ? d.pendientes.map(x => `
      <div class="fila-dinero${x.vencido ? ' vencida' : ''}">
        <div class="info"><b>${esc(x.nombre)}</b> · ${esc(x.periodo_txt)}<small>${esc(x.proveedor)} · ${x.vencido ? 'llegaba el' : 'llega el'} ${esc(fecha(x.fecha))}${x.monto ? ' · monto fijo ' + esc(dinero(x.monto)) : ''}</small></div>
        <div class="btn-group"><button type="button" class="btn btn-primario" data-gp="registrar" data-id="${Number(x.programado_id)}" data-periodo="${esc(x.periodo)}">Registrar gasto</button>
          <button type="button" class="btn btn-outline" data-gp="omitir" data-id="${Number(x.programado_id)}" data-periodo="${esc(x.periodo)}">No llegó</button></div>
      </div>`).join('') : '<p class="util-45">Nada pendiente: todos los gastos programados que tocan ya están registrados. 🎉</p>';
    const filas = lista.length ? lista.map(p => `
      <div class="fila-dinero${p.activo ? '' : ' inactivo'}">
        <div class="info"><b>${esc(p.nombre)}</b>${p.activo ? '' : ' · desactivado'}
          <small>${esc(p.proveedor_nombre)} · ${esc(p.categoria_nombre)}${p.tipo_gasto_nombre ? ' · ' + esc(p.tipo_gasto_nombre) : ''}</small>
          <small>${esc(textoMeses(p.meses))} · día ${Number(p.dia)} · avisa ${Number(p.aviso_dias)} ${Number(p.aviso_dias) === 1 ? 'día' : 'días'} antes${esc(ultimoTxt(p))}</small></div>
        <div class="montos"><b>${p.monto ? esc(dinero(p.monto)) : 'Cambia'}</b><small>${p.monto ? 'monto fijo' : 'cada recibo'}</small></div>
        <div class="btn-group"><button type="button" class="btn btn-outline" data-gp="editar" data-id="${Number(p.id)}">Editar</button>
          <button type="button" class="btn btn-outline" data-gp="activo" data-id="${Number(p.id)}">${p.activo ? 'Desactivar' : 'Activar'}</button></div>
      </div>`).join('') : `<p class="util-45">${d.programados.length ? 'No hay gastos programados activos.' : 'Aún no hay gastos programados. Da de alta el primero (ej. «Luz Cancún») con «+ Nuevo gasto programado».'}</p>`;
    Repintado.pintar(cont, `
      <div class="prov-cabecera"><div><h2>Gastos programados</h2><p class="ayuda">Luz, agua, renta, internet… Se dan de alta una vez con los meses en que llegan; el sistema avisa cuando toca y tú solo capturas el monto del recibo.</p></div>
        <button type="button" class="btn btn-primario" data-gp="nuevo">+ Nuevo gasto programado</button></div>
      <h3 class="grupo-pagos">Por registrar <small>${d.pendientes.length}</small></h3>${pendientes}
      <h3 class="grupo-pagos">Dados de alta <small>${lista.length}</small></h3>
      <label class="cc-check"><input type="checkbox" data-gp="inactivos"${VER_INACTIVOS ? ' checked' : ''}> Mostrar también los desactivados</label>${filas}`);
  }

  // ---------- Alta y edición (ventana) ----------
  async function catalogos() {
    if (CATALOGOS) return CATALOGOS;
    const [prov, cats, comp] = await Promise.all([pedir('/finanzas/proveedores'), pedir('/finanzas/categorias'), pedir('/finanzas/comprobantes')]);
    return (CATALOGOS = { prov, cats, comp: comp.comprobantes || {} });
  }
  async function abrirForm(p = null) {
    let c; try { c = await catalogos(); } catch (err) { toast('No se pudo cargar: ' + err.message); return; }
    EDITANDO = p ? p.id : null;
    $('gp-form-titulo').textContent = p ? 'Editar ' + p.nombre : 'Nuevo gasto programado';
    $('gp-proveedor').innerHTML = '<option value="">Selecciona…</option>' + c.prov.filter(x => x.activo || x.id === p?.proveedor_id).map(x => `<option value="${Number(x.id)}">${esc(x.nombre)}</option>`).join('');
    $('gp-categoria').innerHTML = c.cats.map(x => `<option value="${esc(x.clave)}">${esc(x.nombre)}</option>`).join('');
    $('gp-tipo-gasto').innerHTML = '<option value="">Sin indicar</option>' + CxpExcel.TIPOS_GASTO.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    $('gp-comprobante').innerHTML = '<option value="">Sin indicar</option>' + Object.entries(c.comp).map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    $('gp-meses').innerHTML = MESES.map((m, i) => `<label class="gp-mes"><input type="checkbox" value="${i + 1}"> ${m}</label>`).join('');
    const v = (id, val) => { $(id).value = val ?? ''; };
    v('gp-nombre', p?.nombre); v('gp-proveedor', p?.proveedor_id); v('gp-categoria', p?.categoria || 'otro'); v('gp-tipo-gasto', p?.tipo_gasto); v('gp-comprobante', p?.tipo_comprobante);
    v('gp-dia', p?.dia); v('gp-aviso', p?.aviso_dias ?? 5); v('gp-monto', p?.monto); v('gp-credito', p?.dias_credito ?? 0); v('gp-concepto', p?.concepto);
    v('gp-beneficiario', p?.beneficiario); v('gp-notas', p?.notas); v('gp-desde', p?.desde || '');
    for (const cb of $('gp-meses').querySelectorAll('input')) cb.checked = !!p?.meses.includes(Number(cb.value));
    abrirVentana('overlay-gprog'); $('gp-nombre').focus();
  }
  function marcarMeses(cual) {
    for (const cb of $('gp-meses').querySelectorAll('input')) { const m = Number(cb.value); cb.checked = cual === 'todos' || (cual === 'nones' ? m % 2 === 1 : cual === 'pares' ? m % 2 === 0 : false); }
  }
  async function guardar(boton) {
    const meses = [...$('gp-meses').querySelectorAll('input:checked')].map(cb => Number(cb.value));
    if (!$('gp-nombre').value.trim()) { toast('Escribe el nombre (ej. Luz Cancún)'); $('gp-nombre').focus(); return; }
    if (!$('gp-proveedor').value) { toast('Elige el proveedor (ej. CFE)'); $('gp-proveedor').focus(); return; }
    if (!meses.length) { toast('Marca en qué meses llega'); return; }
    if (!$('gp-dia').value.trim()) { toast('Escribe el día del mes en que llega o vence'); $('gp-dia').focus(); return; }
    const cuerpo = { nombre: $('gp-nombre').value, proveedor_id: Number($('gp-proveedor').value), categoria: $('gp-categoria').value, tipo_gasto: $('gp-tipo-gasto').value || null,
      tipo_comprobante: $('gp-comprobante').value || null, meses, dia: $('gp-dia').value.trim(), aviso_dias: $('gp-aviso').value.trim(), monto: $('gp-monto').value.trim() || null,
      dias_credito: $('gp-credito').value.trim(), concepto: $('gp-concepto').value, beneficiario: $('gp-beneficiario').value, notas: $('gp-notas').value, desde: $('gp-desde').value || undefined };
    boton.disabled = true;
    try {
      await pedir('/gastos-programados' + (EDITANDO ? '/' + EDITANDO : ''), { method: EDITANDO ? 'PUT' : 'POST', body: JSON.stringify(cuerpo) });
      $('overlay-gprog').classList.remove('mostrar'); toast(EDITANDO ? 'Gasto programado guardado' : 'Gasto programado dado de alta'); EDITANDO = null;
      await cargar(); pintarInicio();
    } catch (err) { toast(err.message); } finally { boton.disabled = false; }
  }

  // ---------- Registrar el gasto de un mes o marcarlo «no llegó» ----------
  function registrar(id, periodo) {
    const p = DATOS?.programados.find(x => x.id === id), x = DATOS?.pendientes.find(y => y.programado_id === id && y.periodo === periodo);
    if (!p || !x) return;
    const concepto = (p.concepto || p.nombre) + ' ' + x.periodo_txt;
    Finanzas.nuevoGasto({ 'gasto-concepto': concepto, 'gasto-total': p.monto ? String(p.monto) : '', 'gasto-tipo-gasto': p.tipo_gasto || '', 'gasto-notas': p.notas || '',
      programado: { id: p.id, periodo, periodo_txt: x.periodo_txt, nombre: p.nombre, proveedor_id: p.proveedor_id, categoria: p.categoria, tipo_comprobante: p.tipo_comprobante,
        fecha: x.fecha, dias_credito: p.dias_credito, beneficiario: p.beneficiario, monto: p.monto } }, async () => { await cargar(); pintarInicio(); });
  }
  async function omitir(id, periodo, boton) {
    const x = DATOS?.pendientes.find(y => y.programado_id === id && y.periodo === periodo); if (!x) return;
    const motivo = await solicitarDialogo({ titulo: 'No llegó: ' + x.nombre + ' · ' + x.periodo_txt, mensaje: 'Ese mes deja de aparecer como pendiente. Queda registrado quién lo marcó y por qué; si después llega, se puede reabrir.',
      aceptar: 'Marcar «no llegó»', campo: { tipo: 'text', etiqueta: 'Motivo', requerido: 'Escribe el motivo (ej. no llegó el recibo, se pagó junto con otro)' } });
    if (!motivo) return;
    boton.disabled = true;
    try { await pedir('/gastos-programados/' + id + '/omitir', { method: 'POST', body: JSON.stringify({ periodo, motivo }) }); toast('Marcado como «no llegó»'); await cargar(); pintarInicio(); }
    catch (err) { toast(err.message); } finally { boton.disabled = false; }
  }

  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-gp]'); if (!b || b.tagName === 'INPUT') return;
    const id = Number(b.dataset.id), acc = b.dataset.gp;
    if (acc === 'recargar') return cargar();
    if (acc === 'nuevo') return abrirForm();
    if (acc === 'editar') return abrirForm(DATOS.programados.find(p => p.id === id));
    if (acc === 'registrar') return registrar(id, b.dataset.periodo);
    if (acc === 'omitir') return omitir(id, b.dataset.periodo, b);
    if (acc === 'meses') return marcarMeses(b.dataset.cuales);
    if (acc === 'guardar') return guardar(b);
    if (acc === 'activo') {
      const p = DATOS.programados.find(x => x.id === id); if (!p) return;
      if (p.activo && !await solicitarDialogo({ titulo: 'Desactivar ' + p.nombre, mensaje: 'Ya no avisará. Lo registrado se queda igual y se puede volver a activar.', aceptar: 'Desactivar' })) return;
      b.disabled = true;
      try { await pedir('/gastos-programados/' + id + '/activo', { method: 'POST', body: JSON.stringify({ activo: !p.activo }) }); await cargar(); pintarInicio(); }
      catch (err) { toast(err.message); } finally { b.disabled = false; }
    }
  });
  document.addEventListener('change', e => { if (e.target.matches('[data-gp="inactivos"]')) { VER_INACTIVOS = e.target.checked; pintar(); } });
  $('overlay-gprog')?.querySelector('.close-btn')?.addEventListener('click', () => { $('overlay-gprog').classList.remove('mostrar'); EDITANDO = null; });

  // ---------- Inicio ----------
  async function pintarInicio() {
    const cont = $('inicio-programados'); if (!cont || !Permisos.puede('dinero.mover')) return;
    let r;
    try { r = await pedir('/gastos-programados/avisos'); }
    catch (err) { if (err.status !== 401) cont.innerHTML = `<div class="aviso-error-carga" role="alert"><p>No se pudo cargar: ${esc(err.message)}</p><button type="button" class="btn btn-outline" data-inicio-gp="reintentar">Reintentar</button></div>`; return; }
    cont.dataset.urgente = r.avisos.some(a => a.urgente) ? '1' : '';
    cont.dataset.resumen = r.avisos.length ? `${r.avisos.length} por registrar` : 'Al corriente';
    cont.innerHTML = r.avisos.length ? r.avisos.map(a => `<button type="button" class="fila-alerta${a.urgente ? ' vencido' : ' aviso'}" data-inicio-gp="abrir"><span class="info"><b>${esc(a.texto)}</b><span class="txt">${esc(a.detalle)}</span></span></button>`).join('')
      : '<p class="util-45">Ningún gasto programado por registrar.</p>';
  }
  $('inicio-programados')?.addEventListener('click', e => {
    const b = e.target.closest('[data-inicio-gp]'); if (!b) return;
    if (b.dataset.inicioGp === 'reintentar') return pintarInicio();
    cambiarVista('cuentas', { pestana: 'programados' });
  });

  return { cargar, pintarInicio };
})();
window.GastosProgramados = GastosProgramados;
