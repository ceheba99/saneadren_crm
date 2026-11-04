// ASISTENCIA (Ajustes → Asistencia, RH F3 2026-11-03): el día y la semana de cada persona (entrada, comida, salida,
// retardos, faltas y tiempo extra), sus checadas con las correcciones (con motivo), la autorización del tiempo extra,
// los horarios (por versión, con fecha «desde») y los días festivos. Todo lo calcula el servidor (server/asistencia.js).
// F4 (2026-11-03): Excel de la semana de nómina (viernes a jueves) con resumen, detalle por día y pendientes.
// Lleva horas; quien ve sueldos ve además el pago del tiempo extra (precio de la hora por puesto, en Horarios).
const Asistencia = (() => {
  const $ = id => document.getElementById(id);
  const esc = t => escaparHtml(t == null ? '' : String(t));
  const pesos = c => (c == null ? '—' : '$' + (c / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  // Texto del pago del tiempo extra de una fila de la semana (solo llega a quien ve sueldos).
  const pagoExtra = x => (!x ? '' : x.valor_hora_cent == null ? 'sin precio' : pesos(x.total_cent));
  const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  const hm = m => (m == null ? '—' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);
  const fechaLarga = f => new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' });
  const TIPOS = { entrada: 'Entrada', comida_sale: 'Salida a comer', comida_regresa: 'Regreso de comer', salida: 'Salida', extra_inicia: 'Inicio de tiempo extra', extra_termina: 'Fin de tiempo extra' };
  const INCIDENCIA = { vacaciones: 'Vacaciones', incapacidad: 'Incapacidad', permiso: 'Permiso', falta: 'Falta registrada', retardo: 'Retardo registrado', otro: 'Incidencia' };
  let pestana = 'dia', fecha = hoy(), semana = hoy(), anio = hoy().slice(0, 4), datos = null, abierto = null, consulta = 0;
  async function pedir(ruta, opciones) {
    const r = await api('/asistencia' + ruta, opciones), j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'No se pudo completar');
    return j;
  }
  const cargando = () => { $('as-cuerpo').innerHTML = '<p class="ayuda" role="status">Cargando…</p>'; };
  const fallo = e => { $('as-cuerpo').innerHTML = `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`; };

  async function cargar() {
    document.querySelectorAll('[data-as-pestana]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.asPestana === pestana)));
    const turno = ++consulta; cargando();
    try {
      if (pestana === 'dia') datos = await pedir('/dia?fecha=' + encodeURIComponent(fecha));
      else if (pestana === 'semana') datos = await pedir('/semana?desde=' + encodeURIComponent(semana));
      else if (pestana === 'horarios') datos = await pedir('/horarios');
      else datos = await pedir('/festivos?anio=' + encodeURIComponent(anio));
      if (turno !== consulta) return;
      ({ dia: pintarDia, semana: pintarSemana, horarios: pintarHorarios, festivos: pintarFestivos })[pestana]();
    } catch (e) { if (turno === consulta) fallo(e); }
  }

  // ---------- Día ----------
  const estadoDia = d => {
    const t = [];
    if (d.festivo) t.push('🎉 ' + d.festivo);
    if (d.incidencia) t.push(INCIDENCIA[d.incidencia] || d.incidencia);
    if (d.falta) t.push('❌ Falta');
    if (!d.programado && !d.festivo) t.push('Descanso');
    if (d.por_revisar) t.push(`⚠️ ${d.por_revisar} por revisar`);
    return t.concat(d.notas);
  };
  function pintarDia() {
    const filas = datos.filas;
    let h = `<div class="filtros"><label>Día <input type="date" id="as-fecha" value="${esc(fecha)}" max="${esc(hoy())}"></label>${datos.festivo ? `<span class="as-festivo">🎉 ${esc(datos.festivo)}</span>` : ''}</div>`;
    if (!filas.length) { $('as-cuerpo').innerHTML = h + '<p class="ayuda">No hay personas en el reloj checador. Dales de alta desde su ficha en Personal (bloque «Reloj checador»).</p>'; return; }
    h += `<div class="tabla-scroll"><table class="tabla-resumen as-tabla"><thead><tr><th>Persona</th><th>Horario</th><th>Entrada</th><th>Comida</th><th>Salida</th><th>Trabajado</th><th>Retardo</th><th>Tiempo extra</th><th>Avisos</th></tr></thead><tbody>`;
    for (const d of filas) {
      const prog = d.programado ? `${d.programado.entrada}–${d.programado.salida}` : 'Descanso';
      h += `<tr class="${d.falta ? 'as-falta' : ''}"><td><button type="button" class="pe-nombre" data-as-abrir="${Number(d.personal_id)}">${esc(d.nombre)}</button></td>
        <td>${esc(d.horario || 'Sin horario')}<small class="pe-cuenta">${esc(prog)}</small></td><td>${esc(d.entrada || '—')}</td><td>${esc(d.comida_min ? hm(d.comida_min) : '—')}${d.exceso_comida_min ? `<small class="as-rojo">+${esc(d.exceso_comida_min)} min</small>` : ''}</td>
        <td>${esc(d.salida || '—')}${d.salida_anticipada_min ? `<small class="as-rojo">${esc(d.salida_anticipada_min)} min antes</small>` : ''}</td><td>${esc(hm(d.trabajado_min))}</td>
        <td>${d.retardo_min ? `<b class="as-rojo">${esc(d.retardo_min)} min</b>` : '—'}</td>
        <td>${d.extra_min ? `${esc(hm(d.extra_min))}<small class="pe-cuenta">${d.extra_autorizado_min == null ? 'sin autorizar' : 'autorizado ' + esc(hm(d.extra_autorizado_min))}</small>` : '—'}</td>
        <td>${estadoDia(d).map(t => `<span class="as-chip">${esc(t)}</span>`).join(' ')}</td></tr>`;
      if (abierto === d.personal_id) h += `<tr><td colspan="9"><div class="as-detalle" id="as-detalle">Cargando…</div></td></tr>`;
    }
    $('as-cuerpo').innerHTML = h + '</tbody></table></div>';
    if (abierto) pintarDetalle(filas.find(x => x.personal_id === abierto));
  }
  const revisar = c => c.estado === 'por_revisar', vigente = c => c.estado !== 'anulada';
  // Ubicación de una checada desde el celular: enlace al mapa (se abre solo si quien revisa lo pulsa).
  const mapa = c => (c.lat == null ? '' : ` <a class="btn-link" target="_blank" rel="noopener noreferrer" href="${esc('https://www.google.com/maps?q=' + Number(c.lat) + ',' + Number(c.lon))}">📍 Mapa${c.precision_m ? ' ±' + Number(c.precision_m) + ' m' : ''}</a>`);
  const botonCorregir = (si, accion, id, texto) => (si ? ` <button type="button" class="btn-link" data-as-${accion}="${Number(id)}">${esc(texto)}</button>` : '');
  async function pintarDetalle(d) {
    if (!d || !$('as-detalle')) return;
    let ch;
    try { const r = await api(`/asistencia/checadas?fecha=${encodeURIComponent(fecha)}&personal_id=${Number(d.personal_id)}`); ch = await r.json(); if (!r.ok) throw new Error(ch.error || 'No se pudo'); }
    catch (e) { $('as-detalle').textContent = e.message; return; }
    const p = datos.puede || {};
    let h = `<h4 class="pe-sub2">Checadas de ${esc(d.nombre)} · ${esc(fechaLarga(fecha))}</h4>`;
    h += ch.length ? '<ul class="pe-ordenes">' + ch.map(c => `<li class="${c.estado === 'anulada' ? 'pe-baja' : ''}"><b>${esc(String(c.hora).slice(0, 5))}</b> · ${esc(TIPOS[c.tipo] || c.tipo)} · ${esc(c.origen === 'manual' ? 'a mano por ' + (c.registrado_por_nombre || '') : c.origen === 'celular' ? 'desde su celular' : c.kiosco || c.origen)}${esc(c.sin_conexion ? ' · sin conexión' : '')}
      ${esc(c.estado === 'anulada' ? ' · anulada' : c.estado === 'por_revisar' ? ' · por revisar' : '')}${c.observaciones ? ` <small>(${esc(c.observaciones)})</small>` : ''}
      ${c.tiene_foto ? ` <button type="button" class="btn-link" data-as-foto="${Number(c.id)}">📷 Foto</button>` : ''}${mapa(c)}${esc(c.foto_borrada ? ' · foto borrada (plazo cumplido)' : '')}
      ${botonCorregir(p.corregir && revisar(c), 'aceptar', c.id, 'Aceptar')}${botonCorregir(p.corregir && vigente(c), 'anular', c.id, 'Anular')}</li>`).join('') + '</ul><div id="as-foto"></div>'
      : '<p class="ayuda">No checó este día.</p>';
    if (p.corregir) h += `<div class="filtros as-form"><b>Agregar checada olvidada:</b><select id="as-n-tipo" aria-label="Qué se registra">${Object.entries(TIPOS).map(([k, t]) => `<option value="${esc(k)}">${esc(t)}</option>`).join('')}</select>
      <input type="time" id="as-n-hora" aria-label="Hora"><input id="as-n-motivo" maxlength="300" placeholder="Motivo (obligatorio)" aria-label="Motivo"><button type="button" class="btn btn-secundario" id="as-n-guardar">Agregar</button></div>`;
    if (p.extra && d.extra_min) h += `<div class="filtros as-form"><b>Tiempo extra:</b> registrado ${esc(hm(d.extra_min))}${d.extra_autorizado_por ? ` · autorizado ${esc(hm(d.extra_autorizado_min))} por ${esc(d.extra_autorizado_por)}` : ''}.
      Autorizar <input type="number" id="as-x-min" min="0" max="${Number(d.extra_min)}" value="${Number(d.extra_autorizado_min ?? d.extra_min)}" aria-label="Minutos autorizados" class="as-num"> min
      <input id="as-x-motivo" maxlength="300" placeholder="Motivo (si autorizas menos)" aria-label="Motivo"><button type="button" class="btn btn-secundario" id="as-x-guardar">Autorizar</button></div>`;
    $('as-detalle').innerHTML = h;
  }
  async function pedirMotivo(titulo, mensaje) {
    const m = await solicitarDialogo({ titulo, mensaje, aceptar: 'Guardar', campo: { etiqueta: 'Motivo (obligatorio)', requerido: 'Escribe el motivo' } });
    if (m === null) return null;
    if (m.trim().length < 4) { toast('El motivo debe tener al menos 4 letras'); return null; }
    return m.trim();
  }
  async function accion(fn, ok) { try { await fn(); if (ok) toast(ok); await cargar(); } catch (e) { toast(e.message); } }

  // ---------- Semana ----------
  function pintarSemana() {
    const d = datos;
    let h = `<div class="filtros"><label>Semana del <input type="date" id="as-semana" value="${esc(d.desde)}"></label>${d.filas.length ? '<button type="button" class="btn btn-secundario" id="as-excel">📥 Excel de nómina</button>' : ''}<span class="ayuda">${esc(fechaLarga(d.desde))} al ${esc(fechaLarga(d.hasta))}. Semana de nómina: de viernes a jueves. Tiempo extra autorizado: las primeras 9 horas de la semana son dobles y lo demás triples (LFT).${d.dinero ? ' El pago usa el precio de la hora de cada puesto (Horarios → Precio de la hora).' : ''}</span></div>`;
    if (!d.filas.length) { $('as-cuerpo').innerHTML = h + '<p class="ayuda">No hay personas en el reloj checador.</p>'; return; }
    h += `<div class="tabla-scroll"><table class="tabla-resumen as-tabla as-semana"><thead><tr><th>Persona</th>${d.fechas.map((f, i) => `<th>${esc(fechaLarga(f))}${d.festivos[i] ? '<small class="pe-cuenta">🎉 festivo</small>' : ''}</th>`).join('')}
      <th>Trabajado</th><th>Retardos</th><th>Faltas</th><th>Extra registrado</th><th>Extra autorizado</th><th>Dobles</th><th>Triples</th>${d.dinero ? '<th>Pago extra</th>' : ''}</tr></thead><tbody>`;
    for (const f of d.filas) {
      const t = f.totales;
      h += `<tr><td><b>${esc(f.nombre)}</b><small class="pe-cuenta">${esc(f.puesto || '')}</small></td>${f.dias.map(x => `<td class="${x.falta ? 'as-falta' : ''}">${x.entrada || x.salida ? esc(`${x.entrada || '?'}–${x.salida || '?'}`) : x.falta ? '❌' : esc(x.incidencia ? INCIDENCIA[x.incidencia] || x.incidencia : x.programado ? '—' : 'Descanso')}
        ${x.retardo_min ? `<small class="as-rojo">R ${esc(x.retardo_min)}′</small>` : ''}${x.extra_min ? `<small class="pe-cuenta">+${esc(hm(x.extra_min))}${x.extra_autorizado_min == null ? '' : ' ✔'}</small>` : ''}${x.por_revisar ? '<small class="as-rojo">⚠️ revisar</small>' : ''}</td>`).join('')}
        <td>${esc(hm(t.trabajado_min))}</td><td>${esc(t.retardos)}${t.retardo_min ? ` <small>(${esc(t.retardo_min)} min)</small>` : ''}</td><td>${esc(t.faltas)}</td><td>${esc(hm(t.extra_min))}</td><td>${esc(hm(t.extra_autorizado_min))}</td><td>${esc(hm(t.extra_dobles_min))}</td><td>${esc(hm(t.extra_triples_min))}</td>${d.dinero ? `<td>${esc(pagoExtra(f.dinero))}${f.dinero?.valor_hora_cent != null ? `<small class="pe-cuenta">hora ${esc(pesos(f.dinero.valor_hora_cent))}</small>` : ''}</td>` : ''}</tr>`;
    }
    $('as-cuerpo').innerHTML = h + '</tbody></table></div>';
  }

  // ---------- Excel de nómina (F4) ----------
  // Horas como fracción de día con formato [h]:mm: se ven como 9:35 y se pueden sumar en Excel.
  const horas = m => (m == null ? null : m / 1440);
  async function excelNomina(boton) {
    const d = datos; if (!d?.filas?.length || boton.disabled) return;
    const pend = d.filas.reduce((s, f) => s + f.totales.por_revisar + (f.totales.extra_sin_autorizar_min ? 1 : 0) + f.totales.sin_salida + f.totales.sin_horario, 0);
    if (pend && !await solicitarDialogo({ titulo: 'Hay pendientes en la semana', mensaje: 'Algunas personas tienen checadas por revisar, tiempo extra sin autorizar o días sin salida u horario. El Excel los marca en la hoja «Pendientes». ¿Descargarlo así?', aceptar: 'Descargar' })) return;
    boton.disabled = true;
    try {
      const ExcelJS = await Finanzas.cargarExcelJS(), wb = new ExcelJS.Workbook(); wb.creator = 'Saneadren CRM';
      const titulo = `Semana del ${fechaLarga(d.desde)} al ${fechaLarga(d.hasta)}`;
      const hoja = (nombre, cols) => {
        const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 2 }] });
        ws.addRow([titulo]).font = { bold: true, size: 12 };
        ws.addRow(cols.map(c => c[0])).font = { bold: true };
        cols.forEach(([, ancho, tipo], i) => { const col = ws.getColumn(i + 1); col.width = ancho; if (tipo === 'h') col.numFmt = '[h]:mm'; if (tipo === '$') col.numFmt = '"$"#,##0.00'; });
        return ws;
      };
      const R = hoja('Resumen', [['Persona', 30], ['Puesto', 16], ['Días trabajados', 10], ['Faltas', 8], ['Retardos', 9], ['Minutos de retardo', 10], ['Horas trabajadas', 11, 'h'],
        ['Tiempo extra registrado', 12, 'h'], ['Tiempo extra autorizado', 12, 'h'], ['Extra dobles', 11, 'h'], ['Extra triples', 11, 'h'], ['Domingos trabajados', 10], ['Festivos trabajados', 10],
        ['Descansos trabajados', 10], ['Vacaciones (días)', 10], ['Incapacidad (días)', 10], ['Permisos (días)', 10], ['Pendientes', 40],
        ...(d.dinero ? [['Precio hora normal', 12, '$'], ['Pago extra dobles', 12, '$'], ['Pago extra triples', 12, '$'], ['Pago tiempo extra', 13, '$']] : [])]);
      const D = hoja('Detalle por día', [['Fecha', 12], ['Día', 11], ['Persona', 30], ['Horario', 18], ['Entrada programada', 10], ['Salida programada', 10], ['Entrada', 9], ['Salida', 9],
        ['Comida (min)', 9], ['Horas trabajadas', 11, 'h'], ['Retardo (min)', 9], ['Extra registrado', 11, 'h'], ['Extra autorizado', 11, 'h'], ['Autorizó', 22], ['Falta', 7], ['Incidencia', 14], ['Avisos', 50]]);
      const P = hoja('Pendientes', [['Persona', 30], ['Fecha', 12], ['Qué falta', 60]]);
      for (const f of d.filas) {
        const t = f.totales, pendientes = [];
        if (t.por_revisar) pendientes.push(`${t.por_revisar} checada(s) por revisar`);
        if (t.extra_sin_autorizar_min) pendientes.push(`${hm(t.extra_sin_autorizar_min)} de tiempo extra sin autorizar`);
        if (t.sin_salida) pendientes.push(`${t.sin_salida} día(s) sin salida`);
        if (t.sin_horario) pendientes.push('sin horario asignado');
        if (d.dinero && t.extra_autorizado_min && f.dinero?.valor_hora_cent == null) pendientes.push(`su puesto (${f.puesto || 'sin puesto'}) no tiene precio de la hora: el tiempo extra no se pudo calcular en pesos`);
        R.addRow([f.nombre, f.puesto || '', t.dias_trabajados, t.faltas, t.retardos, t.retardo_min, horas(t.trabajado_min), horas(t.extra_min), horas(t.extra_autorizado_min), horas(t.extra_dobles_min), horas(t.extra_triples_min),
          t.domingos, t.festivos_trabajados, t.descansos_trabajados, t.vacaciones, t.incapacidad, t.permisos, pendientes.join(' · '),
          ...(d.dinero ? (f.dinero?.valor_hora_cent == null ? ['sin precio', null, null, null] : [f.dinero.valor_hora_cent / 100, f.dinero.dobles_cent / 100, f.dinero.triples_cent / 100, f.dinero.total_cent / 100]) : [])]);
        for (const x of f.dias) {
          D.addRow([x.fecha, x.dia, f.nombre, x.horario || 'Sin horario', x.programado?.entrada || (x.festivo ? 'Festivo' : 'Descanso'), x.programado?.salida || '', x.entrada || '', x.salida || '',
            x.comida_min || null, horas(x.trabajado_min), x.retardo_min || null, horas(x.extra_min || null), horas(x.extra_autorizado_min), x.extra_autorizado_por || '', x.falta ? 'Sí' : '',
            x.incidencia ? INCIDENCIA[x.incidencia] || x.incidencia : '', [x.festivo ? 'Festivo: ' + x.festivo : '', ...x.notas, x.por_revisar ? `${x.por_revisar} por revisar` : ''].filter(Boolean).join(' · ')]);
          const q = [];
          if (x.por_revisar) q.push(`${x.por_revisar} checada(s) por revisar (Asistencia → Día)`);
          if (x.extra_min && x.extra_autorizado_min == null) q.push(`${hm(x.extra_min)} de tiempo extra sin autorizar`);
          if (x.notas.includes('Sin salida')) q.push('No registró salida');
          if (x.notas.includes('Sin horario asignado') && (x.entrada || x.salida)) q.push('No tiene horario asignado');
          if (x.notas.some(n => /cambió después/.test(n))) q.push('El tiempo extra cambió después de autorizarlo');
          if (q.length) P.addRow([f.nombre, x.fecha, q.join(' · ')]);
        }
      }
      if (P.rowCount === 2) P.addRow(['Sin pendientes: todo está revisado y autorizado.']);
      saveAs(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `nomina_semana_${d.desde}_al_${d.hasta}.xlsx`);
      toast('Excel de nómina descargado');
    } catch (err) { toast(err.message); } finally { boton.disabled = false; }
  }

  // ---------- Horarios ----------
  let editando = null; // id del horario que se edita, 'nuevo' o null
  const varias = () => !!window.Sucursales?.varias?.();
  const sucursales = () => (window.Sucursales?.datos?.sucursales || []).filter(s => s.activo);
  function pintarHorarios() {
    const { horarios, dias, puede } = datos;
    let h = `<p class="ayuda">Cada cambio a un horario es una versión nueva desde una fecha: las semanas anteriores se siguen calculando con el horario que tenían. La hora de entrada y salida puede ser distinta cada día (p. ej. el sábado).</p>`;
    if (puede.editar) h += '<button type="button" class="btn btn-primario" data-as-horario-nuevo="1">+ Nuevo horario</button>';
    if (editando === 'nuevo') h += formularioHorario(null, dias);
    for (const x of horarios) {
      const v = x.vigente;
      h += `<div class="modal-section as-horario${x.activo ? '' : ' pe-baja'}"><h3 class="pe-sub">${esc(x.nombre)}${x.activo ? '' : ' (desactivado)'}${varias() ? ' · ' + esc(x.sucursal || '') : ''} <small class="pe-cuenta">${esc(x.personas)} persona(s)</small></h3>`;
      if (v) h += `<p>${Object.keys(dias).map(d => v.dias[d] ? `<b>${esc(dias[d].slice(0, 3))}</b> ${esc(v.dias[d].entrada)}–${esc(v.dias[d].salida)}` : `<span class="as-descanso">${esc(dias[d].slice(0, 3))} descanso</span>`).join(' · ')}<br>
        Tolerancia ${esc(v.tolerancia_min)} min · Comida ${esc(v.comida_min)} min · vigente desde ${esc(v.desde === '2020-01-01' ? 'el inicio' : fechaLarga(v.desde))}</p>`;
      if (x.proxima) h += `<p class="ayuda">Cambio programado desde el ${esc(fechaLarga(x.proxima.desde))}.</p>`;
      if (puede.editar) h += `<div class="btn-group"><button type="button" class="btn btn-secundario" data-as-horario-editar="${Number(x.id)}">Cambiar horario</button><button type="button" class="btn btn-outline" data-as-horario-activo="${Number(x.id)}" data-activo="${x.activo ? '' : '1'}">${x.activo ? 'Desactivar' : 'Activar'}</button></div>`;
      if (editando === x.id) h += formularioHorario(x, dias);
      h += '</div>';
    }
    if (puede.precios) h += '<div class="modal-section" id="as-precios"><p class="ayuda" role="status">Cargando precios…</p></div>';
    $('as-cuerpo').innerHTML = h;
    if (puede.precios) cargarPrecios();
  }

  // ---------- Precio de la hora por puesto (solo quien ve sueldos) ----------
  let precios = null, precioSuc = null;
  async function cargarPrecios() {
    try { precios = await pedir('/precios'); } catch (e) { if ($('as-precios')) $('as-precios').innerHTML = `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`; return; }
    if (!precios.sucursales.some(s => s.id === precioSuc)) precioSuc = precios.sucursales[0]?.id ?? null;
    pintarPrecios();
  }
  function pintarPrecios() {
    const cont = $('as-precios'), s = precios?.sucursales.find(x => x.id === precioSuc); if (!cont || !s) return;
    let h = `<h3 class="pe-sub">💲 Precio de la hora por puesto</h3>
      <p class="ayuda">Escribe cuánto vale la <b>hora normal</b> de cada puesto. El tiempo extra se paga solo: las primeras 9 horas de la semana al doble y lo demás al triple. Un cambio vale desde hoy; las semanas pasadas se quedan con el precio que tenían. Solo lo ven quienes ven sueldos.</p>`;
    if (precios.sucursales.length > 1) h += `<div class="filtros"><label>Sucursal <select id="as-p-suc">${precios.sucursales.map(x => `<option value="${Number(x.id)}"${x.id === s.id ? ' selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select></label></div>`;
    h += '<div class="tabla-scroll"><table class="tabla-resumen"><thead><tr><th>Puesto</th><th>Hora normal</th><th>Hora doble</th><th>Hora triple</th><th></th></tr></thead><tbody>';
    precios.puestos.forEach((pu, i) => {
      const p = s.precios[pu], c = p ? Math.round(p.valor * 100) : null;
      h += `<tr><td><b>${esc(pu)}</b>${p ? `<small class="pe-cuenta">desde ${esc(fechaLarga(p.desde))} · ${esc(p.por || '')}</small>` : ''}</td>
        <td>${precios.editar ? `$ <input type="number" min="0" step="0.01" class="as-num" id="as-p-${Number(i)}" value="${p ? esc(Number(p.valor).toFixed(2)) : ''}" placeholder="0.00" aria-label="Precio de la hora normal de ${esc(pu)}">` : esc(pesos(c))}</td>
        <td>${esc(c == null ? '—' : pesos(c * 2))}</td><td>${esc(c == null ? '—' : pesos(c * 3))}</td>
        <td>${precios.editar ? `<button type="button" class="btn btn-secundario" data-as-precio="${Number(i)}">Guardar</button>` : ''}</td></tr>`;
    });
    cont.innerHTML = h + '</tbody></table></div>';
  }
  function formularioHorario(x, dias) {
    const v = x?.proxima || x?.vigente || { dias: { 1: { entrada: '08:30', salida: '18:00' }, 2: { entrada: '08:30', salida: '18:00' }, 3: { entrada: '08:30', salida: '18:00' }, 4: { entrada: '08:30', salida: '18:00' }, 5: { entrada: '08:30', salida: '18:00' } }, tolerancia_min: 10, comida_min: 60 };
    return `<div class="as-form-horario" id="as-form-horario">
      ${x ? '' : '<label>Nombre <input id="as-h-nombre" maxlength="60" placeholder="p. ej. Operaciones sábado corto"></label>'}
      ${!x && varias() ? `<label>Sucursal <select id="as-h-suc">${sucursales().map(s => `<option value="${Number(s.id)}">${esc(s.nombre)}</option>`).join('')}</select></label>` : ''}
      <table class="tabla-resumen"><thead><tr><th>Día</th><th>Trabaja</th><th>Entrada</th><th>Salida</th></tr></thead><tbody>
      ${Object.entries(dias).map(([d, n]) => `<tr><td>${esc(n)}</td><td><input type="checkbox" data-as-h-dia="${esc(d)}" ${v.dias[d] ? 'checked' : ''} aria-label="Trabaja el ${esc(n)}"></td>
        <td><input type="time" data-as-h-entrada="${esc(d)}" value="${esc(v.dias[d]?.entrada || '08:30')}" aria-label="Entrada del ${esc(n)}"></td><td><input type="time" data-as-h-salida="${esc(d)}" value="${esc(v.dias[d]?.salida || '18:00')}" aria-label="Salida del ${esc(n)}"></td></tr>`).join('')}
      </tbody></table>
      <div class="filtros"><label>Tolerancia (min) <input type="number" id="as-h-tol" min="0" max="120" value="${Number(v.tolerancia_min)}" class="as-num"></label>
      <label>Comida (min) <input type="number" id="as-h-com" min="0" max="240" value="${Number(v.comida_min)}" class="as-num"></label>
      ${x ? `<label>Vale desde <input type="date" id="as-h-desde" value="${esc(hoy())}"></label>` : ''}
      <button type="button" class="btn btn-primario" id="as-h-guardar" data-id="${x ? Number(x.id) : ''}">Guardar</button><button type="button" class="btn btn-outline" id="as-h-cancelar">Cancelar</button></div></div>`;
  }
  function leerHorario() {
    const dias = {};
    document.querySelectorAll('[data-as-h-dia]').forEach(c => { const d = c.dataset.asHDia; if (c.checked) dias[d] = { entrada: document.querySelector(`[data-as-h-entrada="${d}"]`).value, salida: document.querySelector(`[data-as-h-salida="${d}"]`).value }; });
    return { dias, tolerancia_min: Number($('as-h-tol').value), comida_min: Number($('as-h-com').value), ...($('as-h-desde') ? { desde: $('as-h-desde').value } : {}), ...($('as-h-nombre') ? { nombre: $('as-h-nombre').value } : {}), ...($('as-h-suc') ? { sucursal_id: Number($('as-h-suc').value) } : {}) };
  }

  // ---------- Días festivos ----------
  function pintarFestivos() {
    const { festivos, puede } = datos, a = Number(anio);
    let h = `<div class="filtros"><label>Año <select id="as-anio">${[a - 1, a, a + 1].map(x => `<option ${x === a ? 'selected' : ''}>${x}</option>`).join('')}</select></label><span class="ayuda">Los de la ley (art. 74 LFT) se agregan solos; las jornadas electorales y los de la empresa se agregan aquí. Trabajar un festivo se marca en la asistencia.</span></div>
      <div class="tabla-scroll"><table class="tabla-resumen"><thead><tr><th>Fecha</th><th>Día</th><th>Origen</th><th></th></tr></thead><tbody>
      ${festivos.map(f => `<tr class="${f.activo ? '' : 'pe-baja'}"><td>${esc(fechaLarga(f.fecha))}</td><td>${esc(f.nombre)}${f.activo ? '' : ' (no se descansa)'}</td><td>${esc(f.origen === 'ley' ? 'Ley' : 'Empresa')}</td>
        <td>${puede.editar ? `<button type="button" class="btn-link" data-as-festivo="${esc(f.fecha)}" data-nombre="${esc(f.nombre)}" data-activo="${f.activo ? '' : '1'}">${f.activo ? 'Quitar' : 'Volver a poner'}</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>`;
    if (puede.editar) h += `<div class="filtros as-form"><b>Agregar:</b><input type="date" id="as-f-fecha" aria-label="Fecha"><input id="as-f-nombre" maxlength="80" placeholder="p. ej. Jornada electoral" aria-label="Qué día es"><button type="button" class="btn btn-secundario" id="as-f-guardar">Agregar</button></div>`;
    $('as-cuerpo').innerHTML = h;
  }

  // ---------- Eventos ----------
  document.querySelectorAll('[data-as-pestana]').forEach(b => { b.onclick = () => { pestana = b.dataset.asPestana; abierto = null; editando = null; cargar(); }; });
  $('as-cuerpo').addEventListener('change', e => {
    if (e.target.id === 'as-fecha' && e.target.value) { fecha = e.target.value; abierto = null; cargar(); }
    else if (e.target.id === 'as-semana' && e.target.value) { semana = e.target.value; cargar(); }
    else if (e.target.id === 'as-anio') { anio = e.target.value; cargar(); }
    else if (e.target.id === 'as-p-suc') { precioSuc = Number(e.target.value); pintarPrecios(); }
  });
  $('as-cuerpo').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.asAbrir) { abierto = abierto === Number(d.asAbrir) ? null : Number(d.asAbrir); pintarDia(); }
    else if (d.asFoto) {
      try { const r = await api('/asistencia/checadas/' + Number(d.asFoto) + '/foto'); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'No se pudo abrir la foto');
        const url = URL.createObjectURL(await r.blob()), img = document.createElement('img'); img.src = url; img.alt = 'Foto de la checada'; img.className = 'pe-foto'; img.onload = () => URL.revokeObjectURL(url); $('as-foto').replaceChildren(img); } catch (err) { toast(err.message); }
    } else if (d.asAceptar) { const m = await pedirMotivo('Aceptar la checada', 'Quedará como válida y contará para la nómina. Queda en la bitácora con tu nombre.'); if (m) accion(() => pedir('/checadas/' + Number(d.asAceptar) + '/aceptar', { method: 'POST', body: JSON.stringify({ motivo: m }) }), 'Checada aceptada'); }
    else if (d.asAnular) { const m = await pedirMotivo('Anular la checada', 'No se borra: queda tachada y deja de contar. Queda en la bitácora con tu nombre.'); if (m) accion(() => pedir('/checadas/' + Number(d.asAnular) + '/anular', { method: 'POST', body: JSON.stringify({ motivo: m }) }), 'Checada anulada'); }
    else if (b.id === 'as-n-guardar') accion(() => pedir('/checadas', { method: 'POST', body: JSON.stringify({ personal_id: abierto, tipo: $('as-n-tipo').value, fecha, hora: $('as-n-hora').value, motivo: $('as-n-motivo').value }) }), 'Checada agregada');
    else if (b.id === 'as-x-guardar') accion(() => pedir('/extra', { method: 'POST', body: JSON.stringify({ personal_id: abierto, fecha, minutos: Number($('as-x-min').value), motivo: $('as-x-motivo').value }) }), 'Tiempo extra autorizado');
    else if (b.id === 'as-excel') excelNomina(b);
    else if (d.asPrecio !== undefined) {
      const i = Number(d.asPrecio), puesto = precios?.puestos[i], valor = $('as-p-' + i)?.value;
      if (!puesto) return;
      b.disabled = true;
      try { const r = await pedir('/precios', { method: 'PUT', body: JSON.stringify({ sucursal_id: precioSuc, puesto, valor }) }); toast(r.cambios ? `Precio de la hora de ${puesto} guardado` : 'Sin cambios'); await cargarPrecios(); }
      catch (err) { toast(err.message); b.disabled = false; }
    }
    else if (d.asHorarioNuevo) { editando = 'nuevo'; pintarHorarios(); }
    else if (d.asHorarioEditar) { editando = Number(d.asHorarioEditar); pintarHorarios(); }
    else if (d.asHorarioActivo) accion(() => pedir('/horarios/' + Number(d.asHorarioActivo), { method: 'PUT', body: JSON.stringify({ activo: !!d.activo }) }));
    else if (b.id === 'as-h-cancelar') { editando = null; pintarHorarios(); }
    else if (b.id === 'as-h-guardar') { const x = leerHorario(), id = b.dataset.id; await accion(async () => { await pedir(id ? '/horarios/' + Number(id) : '/horarios', { method: id ? 'PUT' : 'POST', body: JSON.stringify(x) }); editando = null; }, 'Horario guardado'); }
    else if (b.id === 'as-f-guardar') accion(() => pedir('/festivos', { method: 'POST', body: JSON.stringify({ fecha: $('as-f-fecha').value, nombre: $('as-f-nombre').value }) }), 'Día festivo agregado');
    else if (d.asFestivo) accion(() => pedir('/festivos', { method: 'POST', body: JSON.stringify({ fecha: d.asFestivo, nombre: d.nombre, activo: !!d.activo }) }));
  });
  return { cargar };
})();
