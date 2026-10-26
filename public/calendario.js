/* Calendario: órdenes de servicio, avisos, cotizaciones que vencen, cobros, pagos y recompras.
   Tres vistas (decisión del dueño, 2026-10-21): Hoy (lo atrasado y la agenda del día), Semana (siete columnas) y Mes
   (cuadrícula con la lista del día elegido). Se recuerda la última vista y solo se pide al servidor el rango que se ve.
   En celular las tres se leen como lista por día. Cada evento abre su registro. */
const Calendario = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t); // app.js se carga después
  const TIPOS = {
    orden: { nombre: 'Órdenes de servicio', corto: 'Orden', icono: '🧾' },
    alerta: { nombre: 'Alertas y recordatorios', corto: 'Aviso', icono: '⏰' },
    cobro: { nombre: 'Por cobrar', corto: 'Cobro', icono: '💵' },
    pago: { nombre: 'Por pagar', corto: 'Pago', icono: '📤' },
    cotizacion: { nombre: 'Cotizaciones que vencen', corto: 'Cotización', icono: '📄' },
    recompra: { nombre: 'Recompras sugeridas', corto: 'Recompra', icono: '🔁' },
  };
  const ESTADOS = { programada: 'Programada', por_concluir: 'Por concluir', realizada: 'Realizada', no_realizada: 'No realizada', pendiente: 'Pendiente', resuelta: 'Resuelta', vencido: 'Vencido', por_vencer: 'Por vencer', esperado: 'Esperado' };
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const VISTAS = ['hoy', 'semana', 'mes'];
  const hoyTxt = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fechaDe = f => new Date(f + 'T12:00:00');
  const fechaLarga = f => fechaDe(f).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  const mayus = t => t.charAt(0).toUpperCase() + t.slice(1);
  const fechaCortaTxt = f => fechaDe(f).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  const porHora = (a, b) => (a.fecha + (a.hora || '99')).localeCompare(b.fecha + (b.hora || '99'));
  let VISTA = 'hoy', FECHA = null, EVENTOS = [], ATRASADOS = [], ATR_TOTALES = {}, ATR_TOPE = 0, DIA = null, consulta = 0, ATR_TODO = false;
  const ATR_VISIBLES = 5; // lo atrasado: los más viejos primero; el resto con «Ver los N»
  try { const v = localStorage.getItem('calendario-vista'); if (VISTAS.includes(v)) VISTA = v; } catch { /* sin preferencias guardadas */ }
  const activos = new Set(Object.keys(TIPOS));
  try { const g = JSON.parse(localStorage.getItem('calendario-tipos') || 'null'); if (Array.isArray(g)) { activos.clear(); g.forEach(t => TIPOS[t] && activos.add(t)); } } catch { /* sin preferencias guardadas */ }

  // Rango que se ve: un día; lunes a domingo; o las semanas completas de la cuadrícula del mes.
  function rango() {
    const f = fechaDe(FECHA);
    if (VISTA === 'hoy') return { desde: f, hasta: f };
    if (VISTA === 'semana') { const d = new Date(f); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const h = new Date(d); h.setDate(h.getDate() + 6); return { desde: d, hasta: h }; }
    const inicio = new Date(f.getFullYear(), f.getMonth(), 1), fin = new Date(f.getFullYear(), f.getMonth() + 1, 0);
    const desde = new Date(inicio); desde.setDate(desde.getDate() - ((desde.getDay() + 6) % 7));
    const hasta = new Date(fin); hasta.setDate(hasta.getDate() + (6 - ((hasta.getDay() + 6) % 7)));
    return { desde, hasta };
  }
  function titulo() {
    const f = fechaDe(FECHA);
    if (VISTA === 'hoy') { const t = fechaLarga(FECHA); return (FECHA === hoyTxt() ? 'Hoy, ' + t : mayus(t)) + (f.getFullYear() !== fechaDe(hoyTxt()).getFullYear() ? ' de ' + f.getFullYear() : ''); }
    if (VISTA === 'semana') {
      const { desde, hasta } = rango();
      return desde.getMonth() === hasta.getMonth() ? `${desde.getDate()} – ${hasta.getDate()} de ${MESES[hasta.getMonth()].toLowerCase()} ${hasta.getFullYear()}`
        : `${desde.getDate()} ${MESES[desde.getMonth()].slice(0, 3).toLowerCase()} – ${hasta.getDate()} ${MESES[hasta.getMonth()].slice(0, 3).toLowerCase()} ${hasta.getFullYear()}`;
    }
    return MESES[f.getMonth()] + ' ' + f.getFullYear();
  }
  function pintarControles() {
    document.querySelectorAll('[data-cal-vista]').forEach(b => { const on = b.dataset.calVista === VISTA; b.classList.toggle('activo', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    const paso = { hoy: 'Día', semana: 'Semana', mes: 'Mes' }[VISTA];
    $('cal-anterior').setAttribute('aria-label', paso + ' anterior'); $('cal-siguiente').setAttribute('aria-label', paso + ' siguiente');
    $('cal-titulo').textContent = titulo();
    for (const v of VISTAS) $('cal-vista-' + v).hidden = v !== VISTA;
  }
  async function cargar() {
    if (!FECHA) FECHA = hoyTxt();
    const turno = ++consulta, { desde, hasta } = rango(), hoy = hoyTxt();
    pintarControles();
    $('cal-estado').textContent = 'Cargando…';
    // Lo atrasado solo se muestra en la vista de hoy (es lo que quedó pendiente de días anteriores).
    const conAtrasados = VISTA === 'hoy' && FECHA === hoy;
    let r, recompras, atr;
    try {
      [r, recompras, atr] = await Promise.all([
        api(`/calendario?desde=${iso(desde)}&hasta=${iso(hasta)}`).then(x => x.json()),
        api('/recompras').then(x => x.json()).catch(() => []),
        conAtrasados ? api('/calendario/atrasados').then(x => x.json()) : Promise.resolve({ eventos: [] }),
      ]);
    } catch (err) { if (turno === consulta) $('cal-estado').textContent = 'No se pudo cargar el calendario: ' + err.message; return; }
    if (turno !== consulta) return;
    EVENTOS = r.eventos.concat((recompras || []).filter(x => x.fecha_sugerida >= iso(desde) && x.fecha_sugerida <= iso(hasta)).map(x => ({
      tipo: 'recompra', fecha: x.fecha_sugerida, cliente_id: x.cliente_id, lead_id: x.ultimo_lead_id,
      titulo: 'Recompra · ' + (x.empresa_contacto || x.nombre || ''), detalle: x.servicio_nombre || '' })));
    ATRASADOS = atr.eventos || []; ATR_TOTALES = atr.totales || {}; ATR_TOPE = atr.tope || 0;
    $('cal-estado').textContent = '';
    pintar();
  }
  const visibles = () => EVENTOS.filter(e => activos.has(e.tipo));
  // Cuántos hay de cada tipo en lo que se ve (en Mes, solo los días del mes).
  function pintarFiltros() {
    const mes = FECHA.slice(0, 7), enVista = e => VISTA !== 'mes' || e.fecha.slice(0, 7) === mes;
    const n = t => EVENTOS.filter(e => e.tipo === t && enVista(e)).length + (VISTA === 'hoy' ? ATR_TOTALES[t] ?? ATRASADOS.filter(e => e.tipo === t).length : 0);
    $('cal-filtros').innerHTML = Object.entries(TIPOS).map(([t, d]) => `<button type="button" class="cal-filtro cal-${t}${activos.has(t) ? ' activo' : ''}" data-cal-tipo="${t}" aria-pressed="${activos.has(t)}">${d.icono} ${esc(d.nombre)} <span>${n(t)}</span></button>`).join('');
  }
  const estadoHTML = e => e.estado ? `<small class="cal-estado-${esc(e.estado)}">${esc(ESTADOS[e.estado] || e.estado)}</small>` : '';
  const montoTxt = e => e.monto != null ? ' · ' + formatoMoneda(e.monto) : '';
  // Evento corto (cuadrícula del mes), renglón (listas) y renglón con hora (Hoy).
  function eventoHTML(e, corto) {
    if (corto) return `<button type="button" class="cal-evento cal-${e.tipo} cal-e-${esc(e.estado || '')}" data-cal-evento="${EVENTOS.indexOf(e)}" title="${esc(e.titulo + montoTxt(e))}">${TIPOS[e.tipo].icono} ${esc(e.titulo)}</button>`;
    return `<button type="button" class="cal-item cal-${e.tipo} cal-e-${esc(e.estado || '')}" data-cal-evento="${EVENTOS.indexOf(e)}"><span class="cal-item-tit">${TIPOS[e.tipo].icono} ${e.hora ? esc(e.hora) + ' · ' : ''}${esc(e.titulo)}${montoTxt(e)}</span><span class="cal-item-det">${esc(e.detalle || '')} ${estadoHTML(e)}</span></button>`;
  }
  function filaHTML(e, atrasado) {
    const ref = atrasado ? `data-cal-atr="${ATRASADOS.indexOf(e)}"` : `data-cal-evento="${EVENTOS.indexOf(e)}"`;
    const cuando = atrasado ? fechaCortaTxt(e.fecha) : (e.hora || '—');
    return `<button type="button" class="cal-fila cal-${e.tipo} cal-e-${esc(e.estado || '')}" ${ref}><span class="cal-fila-hora">${esc(cuando)}</span>`
      + `<span class="cal-fila-txt"><b>${TIPOS[e.tipo].icono} ${esc(e.titulo)}${montoTxt(e)}</b><small>${esc(e.detalle || '')}</small></span>`
      + `<span class="cal-fila-tag">${esc(TIPOS[e.tipo].corto)}${e.estado ? '<em>' + esc(ESTADOS[e.estado] || e.estado) + '</em>' : ''}</span></button>`;
  }
  function pintar() {
    pintarControles(); pintarFiltros();
    if (VISTA === 'hoy') pintarHoy(); else if (VISTA === 'semana') pintarSemana(); else pintarMes();
  }
  function pintarHoy() {
    const hoy = hoyTxt(), dia = visibles().filter(e => e.fecha === FECHA).sort(porHora);
    const atr = ATRASADOS.filter(e => activos.has(e.tipo));
    $('cal-atrasado').hidden = FECHA !== hoy;
    const mostrar = ATR_TODO ? atr : atr.slice(0, ATR_VISIBLES);
    // El servidor manda como máximo ATR_TOPE de cada tipo (los más viejos); el total real viene aparte.
    const total = [...activos].reduce((t, k) => t + (ATR_TOTALES[k] ?? atr.filter(e => e.tipo === k).length), 0);
    $('cal-atrasado').innerHTML = `<h3>Atrasado · ${total}</h3>` + (atr.length ? mostrar.map(e => filaHTML(e, true)).join('') : '<p class="cal-nada">Nada atrasado ✓</p>')
      + (total > atr.length ? `<p class="cal-nada">Aquí salen los ${ATR_TOPE} más viejos de cada tipo; el resto está en su pantalla (Inicio, Cuentas).</p>` : '')
      + (atr.length > ATR_VISIBLES ? `<button type="button" class="enlace" data-cal-atr-todo>${ATR_TODO ? 'Ver menos' : 'Ver los ' + atr.length}</button>` : '');
    $('cal-agenda').innerHTML = `<h3>${FECHA === hoy ? 'Hoy' : esc(mayus(fechaLarga(FECHA)))} · ${dia.length}</h3>` + (dia.length ? dia.map(e => filaHTML(e, false)).join('') : '<p class="cal-nada">Sin eventos este día.</p>');
  }
  // Debajo del evento, en la semana: monto y estado.
  const pieChip = e => { const t = [e.monto != null ? formatoMoneda(e.monto) : '', e.estado ? ESTADOS[e.estado] || e.estado : ''].filter(Boolean).join(' · '); return t ? '<small>' + esc(t) + '</small>' : ''; };
  function pintarSemana() {
    const { desde } = rango(), hoy = hoyTxt(), ev = visibles();
    let html = '';
    for (let i = 0; i < 7; i++) {
      const d = new Date(desde); d.setDate(d.getDate() + i);
      const f = iso(d), lista = ev.filter(e => e.fecha === f).sort(porHora);
      html += `<div class="cal-col${f === hoy ? ' hoy' : ''}"><button type="button" class="cal-col-cab" data-cal-ir-dia="${f}" aria-label="Ver ${esc(fechaLarga(f))}"><span>${DIAS[i]}</span><b>${d.getDate()}</b>${lista.length ? `<em>${lista.length}</em>` : ''}</button>`
        + (lista.length ? lista.map(e => `<button type="button" class="cal-chip cal-${e.tipo} cal-e-${esc(e.estado || '')}" data-cal-evento="${EVENTOS.indexOf(e)}"><span>${e.hora ? esc(e.hora) + ' · ' : ''}${TIPOS[e.tipo].icono} ${esc(e.titulo)}</span>${pieChip(e)}</button>`).join('') : '<span class="cal-vacio">Sin eventos</span>')
        + '</div>';
    }
    $('cal-semana-grid').innerHTML = html;
  }
  function pintarMes() {
    const { desde, hasta } = rango(), hoy = hoyTxt(), f0 = fechaDe(FECHA), mes = f0.getMonth(), ev = visibles();
    const porDia = new Map(); ev.forEach(e => { if (!porDia.has(e.fecha)) porDia.set(e.fecha, []); porDia.get(e.fecha).push(e); });
    let html = '';
    for (const d = new Date(desde); d <= hasta; d.setDate(d.getDate() + 1)) {
      const f = iso(d), lista = porDia.get(f) || [], fuera = d.getMonth() !== mes;
      html += `<div class="cal-dia${fuera ? ' fuera' : ''}${f === hoy ? ' hoy' : ''}${f === DIA ? ' elegido' : ''}${lista.length ? ' con-eventos' : ''}" data-cal-dia="${f}" role="button" tabindex="0" aria-label="${d.getDate()} de ${MESES[d.getMonth()]}: ${lista.length ? lista.length + (lista.length === 1 ? ' evento' : ' eventos') : 'sin eventos'}">
        <span class="cal-num">${d.getDate()}</span>
        <div class="cal-eventos">${lista.slice(0, 3).map(e => eventoHTML(e, true)).join('')}${lista.length > 3 ? `<span class="cal-mas">+${lista.length - 3} más</span>` : ''}</div>
        <div class="cal-puntos">${[...new Set(lista.map(e => e.tipo))].map(t => `<i class="cal-punto cal-${t}"></i>`).join('')}</div>
      </div>`;
    }
    $('cal-grid').innerHTML = html;
    // Lista del día elegido (o, si no hay día elegido, todo el mes).
    const delMes = ev.filter(e => e.fecha.slice(0, 7) === FECHA.slice(0, 7)).sort(porHora);
    const lista = DIA ? ev.filter(e => e.fecha === DIA).sort(porHora) : delMes;
    $('cal-lista-titulo').textContent = DIA ? fechaLarga(DIA) : 'Todo ' + MESES[mes].toLowerCase();
    $('cal-ver-mes').hidden = !DIA;
    const grupos = new Map(); lista.forEach(e => { if (!grupos.has(e.fecha)) grupos.set(e.fecha, []); grupos.get(e.fecha).push(e); });
    $('cal-lista').innerHTML = lista.length ? [...grupos].map(([f, es]) => `${DIA ? '' : `<div class="cal-lista-dia${f === hoy ? ' hoy' : ''}">${esc(fechaLarga(f))}</div>`}${es.map(e => eventoHTML(e, false)).join('')}`).join('')
      : `<p class="util-45">${DIA ? 'Sin eventos este día.' : 'Sin eventos este mes con los filtros elegidos.'}</p>`;
  }
  function abrirEvento(e) {
    if (!e) return;
    if (e.oc_id) { cambiarVista('compras'); Compras.abrir(e.oc_id); return; } // pago esperado: su orden de compra
    if (e.tipo === 'pago' && !e.lead_id) { cambiarVista('pagar'); return; }
    if (e.tipo === 'recompra' && e.cliente_id) { abrirFichaCliente(e.cliente_id); return; }
    if (e.lead_id) abrirFicha(e.lead_id);
  }
  // Las flechas avanzan un día, una semana o un mes, según la vista.
  function mover(n) {
    const f = fechaDe(FECHA);
    if (VISTA === 'hoy') f.setDate(f.getDate() + n); else if (VISTA === 'semana') f.setDate(f.getDate() + 7 * n); else { f.setDate(1); f.setMonth(f.getMonth() + n); }
    FECHA = iso(f); DIA = null; cargar();
  }
  function cambiarVistaCal(v, fecha) {
    if (!VISTAS.includes(v)) return;
    VISTA = v; if (fecha) FECHA = fecha; DIA = null;
    try { localStorage.setItem('calendario-vista', v); } catch { /* sin almacenamiento */ }
    cargar();
  }
  $('cal-anterior').addEventListener('click', () => mover(-1));
  $('cal-siguiente').addEventListener('click', () => mover(1));
  $('cal-hoy').addEventListener('click', () => { FECHA = hoyTxt(); DIA = VISTA === 'mes' ? FECHA : null; cargar(); });
  $('cal-ver-mes').addEventListener('click', () => { DIA = null; pintar(); });
  document.querySelector('.cal-vistas').addEventListener('click', e => { const b = e.target.closest('[data-cal-vista]'); if (b) cambiarVistaCal(b.dataset.calVista); });
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
  // Hoy, Semana y la lista del mes: abrir un evento o, desde la semana, ir a ese día.
  for (const id of ['cal-lista', 'cal-vista-hoy', 'cal-vista-semana']) $(id).addEventListener('click', e => {
    const ir = e.target.closest('[data-cal-ir-dia]'); if (ir) { cambiarVistaCal('hoy', ir.dataset.calIrDia); return; }
    if (e.target.closest('[data-cal-atr-todo]')) { ATR_TODO = !ATR_TODO; pintarHoy(); return; }
    const atr = e.target.closest('[data-cal-atr]'); if (atr) { abrirEvento(ATRASADOS[Number(atr.dataset.calAtr)]); return; }
    const ev = e.target.closest('[data-cal-evento]'); if (ev) abrirEvento(EVENTOS[Number(ev.dataset.calEvento)]);
  });
  return { cargar: () => cargar() };
})();
window.Calendario = Calendario;
