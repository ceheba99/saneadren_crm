/* Calendario: órdenes de servicio, alertas, cotizaciones que vencen, cobros y pagos por fecha.
   Vista de mes (en celular, lista por día). Cada evento abre su registro. */
const Calendario = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t); // app.js se carga después
  const TIPOS = {
    orden: { nombre: 'Órdenes de servicio', icono: '🧾' },
    alerta: { nombre: 'Alertas y recordatorios', icono: '⏰' },
    cobro: { nombre: 'Por cobrar', icono: '💵' },
    pago: { nombre: 'Por pagar', icono: '📤' },
    cotizacion: { nombre: 'Cotizaciones que vencen', icono: '📄' },
    recompra: { nombre: 'Recompras sugeridas', icono: '🔁' },
  };
  const ESTADOS = { programada: 'Programada', por_concluir: 'Por concluir', realizada: 'Realizada', no_realizada: 'No realizada', pendiente: 'Pendiente', resuelta: 'Resuelta', vencido: 'Vencido', por_vencer: 'Por vencer' };
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const hoyTxt = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let MES = null, EVENTOS = [], DIA = null, consulta = 0;
  const activos = new Set(Object.keys(TIPOS));
  try { const g = JSON.parse(localStorage.getItem('calendario-tipos') || 'null'); if (Array.isArray(g)) { activos.clear(); g.forEach(t => TIPOS[t] && activos.add(t)); } } catch { /* sin preferencias guardadas */ }

  // Lunes a domingo: el rango cubre las semanas completas que se ven en la cuadrícula del mes.
  function rango(mes) {
    const inicio = new Date(mes.getFullYear(), mes.getMonth(), 1), fin = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
    const desde = new Date(inicio); desde.setDate(desde.getDate() - ((desde.getDay() + 6) % 7));
    const hasta = new Date(fin); hasta.setDate(hasta.getDate() + (6 - ((hasta.getDay() + 6) % 7)));
    return { desde, hasta };
  }
  async function cargar(mes) {
    if (mes) MES = mes; else if (!MES) { const h = new Date(hoyTxt() + 'T12:00:00'); MES = new Date(h.getFullYear(), h.getMonth(), 1); }
    const turno = ++consulta, { desde, hasta } = rango(MES);
    $('cal-titulo').textContent = MESES[MES.getMonth()] + ' ' + MES.getFullYear();
    $('cal-estado').textContent = 'Cargando…';
    let r, recompras;
    try {
      [r, recompras] = await Promise.all([
        api(`/calendario?desde=${iso(desde)}&hasta=${iso(hasta)}`).then(x => x.json()),
        api('/recompras').then(x => x.json()).catch(() => []),
      ]);
    } catch (err) { if (turno === consulta) $('cal-estado').textContent = 'No se pudo cargar el calendario: ' + err.message; return; }
    if (turno !== consulta) return;
    EVENTOS = r.eventos.concat((recompras || []).filter(x => x.fecha_sugerida >= iso(desde) && x.fecha_sugerida <= iso(hasta)).map(x => ({
      tipo: 'recompra', fecha: x.fecha_sugerida, cliente_id: x.cliente_id, lead_id: x.ultimo_lead_id,
      titulo: 'Recompra · ' + (x.empresa_contacto || x.nombre || ''), detalle: x.servicio_nombre || '' })));
    $('cal-estado').textContent = '';
    pintar();
  }
  const visibles = () => EVENTOS.filter(e => activos.has(e.tipo));
  function pintarFiltros() {
    const n = t => EVENTOS.filter(e => e.tipo === t && e.fecha.slice(0, 7) === iso(MES).slice(0, 7)).length;
    $('cal-filtros').innerHTML = Object.entries(TIPOS).map(([t, d]) => `<button type="button" class="cal-filtro cal-${t}${activos.has(t) ? ' activo' : ''}" data-cal-tipo="${t}" aria-pressed="${activos.has(t)}">${d.icono} ${esc(d.nombre)} <span>${n(t)}</span></button>`).join('');
  }
  function eventoHTML(e, corto) {
    const estado = e.estado ? `<small class="cal-estado-${esc(e.estado)}">${esc(ESTADOS[e.estado] || e.estado)}</small>` : '';
    const monto = e.monto != null ? ' · ' + formatoMoneda(e.monto) : '';
    if (corto) return `<button type="button" class="cal-evento cal-${e.tipo} cal-e-${esc(e.estado || '')}" data-cal-evento="${EVENTOS.indexOf(e)}" title="${esc(e.titulo + monto)}">${TIPOS[e.tipo].icono} ${esc(e.titulo)}</button>`;
    return `<button type="button" class="cal-item cal-${e.tipo} cal-e-${esc(e.estado || '')}" data-cal-evento="${EVENTOS.indexOf(e)}"><span class="cal-item-tit">${TIPOS[e.tipo].icono} ${e.hora ? esc(e.hora) + ' · ' : ''}${esc(e.titulo)}${monto}</span><span class="cal-item-det">${esc(e.detalle || '')} ${estado}</span></button>`;
  }
  function pintar() {
    pintarFiltros();
    const { desde, hasta } = rango(MES), hoy = hoyTxt(), mes = MES.getMonth(), ev = visibles();
    const porDia = new Map(); ev.forEach(e => { if (!porDia.has(e.fecha)) porDia.set(e.fecha, []); porDia.get(e.fecha).push(e); });
    let html = '';
    for (const d = new Date(desde); d <= hasta; d.setDate(d.getDate() + 1)) {
      const f = iso(d), lista = porDia.get(f) || [], fuera = d.getMonth() !== mes;
      html += `<div class="cal-dia${fuera ? ' fuera' : ''}${f === hoy ? ' hoy' : ''}${f === DIA ? ' elegido' : ''}${lista.length ? ' con-eventos' : ''}" data-cal-dia="${f}" role="button" tabindex="0" aria-label="${d.getDate()} de ${MESES[d.getMonth()]}: ${lista.length} eventos">
        <span class="cal-num">${d.getDate()}</span>
        <div class="cal-eventos">${lista.slice(0, 3).map(e => eventoHTML(e, true)).join('')}${lista.length > 3 ? `<span class="cal-mas">+${lista.length - 3} más</span>` : ''}</div>
        <div class="cal-puntos">${[...new Set(lista.map(e => e.tipo))].map(t => `<i class="cal-punto cal-${t}"></i>`).join('')}</div>
      </div>`;
    }
    $('cal-grid').innerHTML = html;
    // Lista del día elegido (o, si no hay día elegido, los próximos eventos del mes)
    const delMes = ev.filter(e => e.fecha.slice(0, 7) === iso(MES).slice(0, 7)).sort((a, b) => (a.fecha + (a.hora || '')).localeCompare(b.fecha + (b.hora || '')));
    const lista = DIA ? ev.filter(e => e.fecha === DIA).sort((a, b) => (a.hora || '').localeCompare(b.hora || '')) : delMes;
    const fechaLarga = f => new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
    $('cal-lista-titulo').textContent = DIA ? fechaLarga(DIA) : 'Todo ' + MESES[mes].toLowerCase();
    $('cal-ver-mes').hidden = !DIA;
    const grupos = new Map(); lista.forEach(e => { if (!grupos.has(e.fecha)) grupos.set(e.fecha, []); grupos.get(e.fecha).push(e); });
    $('cal-lista').innerHTML = lista.length ? [...grupos].map(([f, es]) => `${DIA ? '' : `<div class="cal-lista-dia${f === hoy ? ' hoy' : ''}">${esc(fechaLarga(f))}</div>`}${es.map(e => eventoHTML(e, false)).join('')}`).join('')
      : `<p class="util-45">${DIA ? 'Sin eventos este día.' : 'Sin eventos este mes con los filtros elegidos.'}</p>`;
  }
  function abrirEvento(e) {
    if (!e) return;
    if (e.tipo === 'pago' && !e.lead_id) { cambiarVista('pagar'); return; }
    if (e.tipo === 'recompra' && e.cliente_id) { abrirFichaCliente(e.cliente_id); return; }
    if (e.lead_id) abrirFicha(e.lead_id);
  }
  $('cal-anterior').addEventListener('click', () => { DIA = null; cargar(new Date(MES.getFullYear(), MES.getMonth() - 1, 1)); });
  $('cal-siguiente').addEventListener('click', () => { DIA = null; cargar(new Date(MES.getFullYear(), MES.getMonth() + 1, 1)); });
  $('cal-hoy').addEventListener('click', () => { const h = new Date(hoyTxt() + 'T12:00:00'); DIA = hoyTxt(); cargar(new Date(h.getFullYear(), h.getMonth(), 1)); });
  $('cal-ver-mes').addEventListener('click', () => { DIA = null; pintar(); });
  $('cal-filtros').addEventListener('click', e => {
    const b = e.target.closest('[data-cal-tipo]'); if (!b) return;
    const t = b.dataset.calTipo; if (activos.has(t)) activos.delete(t); else activos.add(t);
    try { localStorage.setItem('calendario-tipos', JSON.stringify([...activos])); } catch { /* sin almacenamiento */ }
    pintar();
  });
  const elegirDia = el => { DIA = el.dataset.calDia === DIA ? null : el.dataset.calDia; pintar(); if (DIA && matchMedia('(max-width:700px)').matches) $('cal-lista-titulo').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  $('cal-grid').addEventListener('click', e => {
    const ev = e.target.closest('[data-cal-evento]'); if (ev) { abrirEvento(EVENTOS[Number(ev.dataset.calEvento)]); return; }
    const dia = e.target.closest('[data-cal-dia]'); if (dia) elegirDia(dia);
  });
  $('cal-grid').addEventListener('keydown', e => { const dia = e.target.closest('[data-cal-dia]'); if (dia && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); elegirDia(dia); } });
  $('cal-lista').addEventListener('click', e => { const ev = e.target.closest('[data-cal-evento]'); if (ev) abrirEvento(EVENTOS[Number(ev.dataset.calEvento)]); });
  return { cargar: () => cargar() };
})();
window.Calendario = Calendario;
