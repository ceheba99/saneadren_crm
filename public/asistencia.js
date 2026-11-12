// ASISTENCIA (Ajustes → Asistencia, RH F3 2026-11-03): el día y la semana de cada persona (entrada, comida, salida,
// retardos, faltas y tiempo extra), sus checadas con las correcciones (con motivo), la autorización del tiempo extra,
// los horarios (por versión, con fecha «desde») y los días festivos. Todo lo calcula el servidor (server/asistencia.js).
// F4 (2026-11-03): Excel de la semana de nómina con resumen, detalle por día y pendientes. Semana vencida de lunes a
// domingo (2026-11-09; el día en que empieza y cuándo cuenta el tiempo extra están en «Reglas del tiempo extra»).
// Ventana de checadas (2026-11-09): al pulsar el nombre de una persona se abre su día y su semana en una ventana, con
// sus checadas, fotos, intentos fallidos (cara que no coincidió) y las correcciones.
// Lleva horas; quien ve sueldos ve además el pago del tiempo extra (precio de la hora por puesto, en Horarios).
const Asistencia = (() => {
  const $ = id => document.getElementById(id);
  const esc = t => escaparHtml(t == null ? '' : String(t));
  const pesos = c => (c == null ? '—' : '$' + (c / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  // Texto del pago del tiempo extra de una fila de la semana (solo llega a quien ve sueldos).
  const pagoExtra = x => (!x ? '' : x.valor_hora_cent == null ? 'sin precio' : pesos(x.total_cent));
  const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  // Tramos del tiempo extra de un día en una línea (columna del Excel): «17:00–18:30 ✔ después de su salida».
  const textoExtra = x => [...(x.extra_detalle?.piezas || []).map(z => [z.desde + '–' + z.hasta, z.cuenta ? '✔' : '✖', z.motivo].join(' ')), x.extra_detalle?.redondeo ? `redondeo a ${x.extra_detalle.redondeo.bloque_min} min (−${x.extra_detalle.redondeo.perdidos_min} min)` : ''].filter(Boolean).join(' · ');
  const hm = m => (m == null ? '—' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);
  const fechaLarga = f => new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' });
  const TIPOS = { entrada: 'Entrada', comida_sale: 'Salida a comer', comida_regresa: 'Regreso de comer', salida: 'Salida', extra_inicia: 'Inicio de tiempo extra', extra_termina: 'Fin de tiempo extra' };
  const INCIDENCIA = { vacaciones: 'Vacaciones', incapacidad: 'Incapacidad', permiso: 'Permiso', falta: 'Falta registrada', retardo: 'Retardo registrado', otro: 'Incidencia' };
  let pestana = 'dia', fecha = hoy(), semana = null, anio = hoy().slice(0, 4), datos = null, consulta = 0;
  async function pedir(ruta, opciones) {
    const r = await api('/asistencia' + ruta, opciones), j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'No se pudo completar');
    return j;
  }
  const cargando = () => { $('as-cuerpo').innerHTML = '<p class="ayuda" role="status">Cargando…</p>'; };
  const fallo = e => { $('as-cuerpo').innerHTML = `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`; };

  // «Descargar la nómina» sin «Ver asistencia» (2026-11-11): solo la semana de nómina y su Excel, sin las demás
  // pestañas ni la ventana de checadas.
  const soloNomina = () => !Permisos.puede('asistencia.ver') && Permisos.puede('asistencia.nomina');
  async function cargar() {
    const solo = soloNomina();
    if (solo) pestana = 'semana';
    $('vista-asistencia').classList.toggle('as-solo-nomina', solo);
    $('as-titulo').textContent = solo ? 'Nómina semanal' : 'Asistencia';
    document.querySelectorAll('[data-as-pestana]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.asPestana === pestana)));
    const turno = ++consulta; cargando();
    try {
      // La respuesta se guarda en «datos» solo si sigue siendo la consulta vigente: si llega tarde la de otra pestaña
      // (p. ej. «Día» al entrar desde RH → Horarios), no debe pisar los datos de la que se ve.
      let r;
      if (pestana === 'dia') r = await pedir('/dia?fecha=' + encodeURIComponent(fecha));
      else if (pestana === 'semana') r = await pedir(semana ? '/semana?desde=' + encodeURIComponent(semana) : '/semana?vencida=1');
      else if (pestana === 'reglas') r = await pedir('/reglas-extra');
      else if (pestana === 'horarios') { r = await pedir('/horarios'); r.ubicaciones = await pedir('/sucursales').catch(() => null); }
      else r = await pedir('/festivos?anio=' + encodeURIComponent(anio));
      if (turno !== consulta) return;
      datos = r;
      ({ dia: pintarDia, semana: pintarSemana, horarios: pintarHorarios, festivos: pintarFestivos, reglas: pintarReglas })[pestana]();
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
    if (!filas.length) { $('as-cuerpo').innerHTML = h + '<p class="ayuda">No hay personas en el reloj checador. Dales de alta desde su ficha en Personal (bloque «Reloj checador»).</p>' + seccionIntentos(); return; }
    h += `<div class="tabla-scroll"><table class="tabla-resumen as-tabla"><thead><tr><th>Persona</th><th>Horario</th><th>Entrada</th><th>Comida</th><th>Salida</th><th>Trabajado</th><th>Retardo</th><th>Tiempo extra</th><th>Avisos</th></tr></thead><tbody>`;
    for (const d of filas) {
      const prog = d.programado ? `${d.programado.entrada}–${d.programado.salida}` : 'Descanso';
      h += `<tr class="${d.falta ? 'as-falta' : ''}"><td><button type="button" class="pe-nombre" data-as-abrir="${Number(d.personal_id)}">${esc(d.nombre)}</button></td>
        <td>${esc(d.horario || 'Sin horario')}<small class="pe-cuenta">${esc(prog)}</small></td><td>${esc(d.entrada || '—')}</td><td>${esc(d.comida_min ? hm(d.comida_min) : '—')}${d.exceso_comida_min ? `<small class="as-rojo">+${esc(d.exceso_comida_min)} min</small>` : ''}</td>
        <td>${esc(d.salida || '—')}${d.salida_dia_siguiente ? '<small>del día siguiente</small>' : ''}${d.salida_anticipada_min ? `<small class="as-rojo">${esc(d.salida_anticipada_min)} min antes</small>` : ''}</td><td>${esc(hm(d.trabajado_min))}</td>
        <td>${d.retardo_min ? `<b class="as-rojo">${esc(d.retardo_min)} min</b>` : '—'}</td>
        <td>${d.extra_min ? `${esc(hm(d.extra_min))}<small class="pe-cuenta">${d.extra_autorizado_min == null ? 'sin autorizar' : 'autorizado ' + esc(hm(d.extra_autorizado_min))}</small>` : '—'}</td>
        <td>${estadoDia(d).map(t => `<span class="as-chip">${esc(t)}</span>`).join(' ')}</td></tr>`;
    }
    $('as-cuerpo').innerHTML = h + '</tbody></table></div><p class="ayuda">Pulsa el nombre de una persona para ver sus checadas, fotos y su semana.</p>' + seccionIntentos();
  }
  // Intentos fallidos en los kioscos (código o PIN malo, PIN bloqueado, cara que no coincidió), con su foto.
  // 2026-11-11 (Dirección: «mejor como tabla»): una fila por intento. «persona»: con la columna «Código / de quién»
  // (en el día de todos); «foto»: el atributo del botón de la foto (cada pantalla abre la foto en su lugar).
  function tablaIntentos(l, { persona = true, foto = 'data-as-intento-foto' } = {}) {
    return `<div class="tabla-scroll"><table class="tabla-resumen as-tabla as-intentos"><thead><tr><th>Hora</th><th>Qué pasó</th>${persona ? '<th>Código · de quién</th>' : ''}<th>Kiosco</th><th>Detalle</th><th>Foto</th></tr></thead><tbody>
      ${l.map(i => `<tr><td data-et="Hora"><div><b>${esc(i.hora)}</b></div></td>
        <td data-et="Qué pasó"><div><span class="${i.es_cara ? 'ac-cara-mal' : ''}">${esc(i.motivo)}</span>${i.es_cara && i.revisado_por_nombre ? `<small class="pe-cuenta">✔ Revisado por ${esc(i.revisado_por_nombre)}</small>` : ''}</div></td>
        ${persona ? `<td data-et="Código"><div>${esc(i.codigo || '—')}<small>${i.persona ? `<button type="button" class="btn-link" data-as-abrir="${Number(i.personal_id)}">${esc(i.persona)}</button>` : 'No es de nadie'}</small></div></td>` : ''}
        <td data-et="Kiosco"><div>${esc(i.kiosco || '—')}</div></td>
        <td data-et="Detalle"><div>${i.detalle ? `<small class="pe-cuenta">${esc(i.detalle)}</small>` : '—'}</div></td>
        <td data-et="Foto"><div>${i.tiene_foto ? `<button type="button" class="btn-link" ${foto}="${Number(i.id)}">📷 Ver foto</button>` : esc(i.foto_borrada ? 'Borrada (plazo cumplido)' : 'Sin foto')}</div></td></tr>`).join('')}
      </tbody></table></div>`;
  }
  function seccionIntentos() {
    const l = datos.intentos || [];
    if (!l.length) return '';
    return `<div class="modal-section"><h3 class="pe-sub">⚠️ Intentos fallidos en el kiosco (${esc(l.length)})</h3><p class="ayuda">El kiosco toma foto cuando alguien se equivoca de código o PIN, o cuando su cara no coincide: sirve para ver si alguien prueba el código de otra persona. Pulsa el nombre para ver sus checadas.</p>
      ${tablaIntentos(l)}<div id="as-intento-foto"></div></div>`;
  }
  const revisar = c => c.estado === 'por_revisar', vigente = c => c.estado !== 'anulada';
  // Ubicación de una checada desde el celular: enlace al mapa (se abre solo si quien revisa lo pulsa).
  const mapa = c => (c.lat == null ? '' : ` <a class="btn-link" target="_blank" rel="noopener noreferrer" href="${esc('https://www.google.com/maps?q=' + Number(c.lat) + ',' + Number(c.lon))}">📍 Mapa${c.precision_m ? ' ±' + Number(c.precision_m) + ' m' : ''}</a>`);
  const botonCorregir = (si, accion, id, texto) => (si ? ` <button type="button" class="btn-link" data-as-${accion}="${Number(id)}">${esc(texto)}</button>` : '');
  async function pedirMotivo(titulo, mensaje) {
    const m = await solicitarDialogo({ titulo, mensaje, aceptar: 'Guardar', campo: { etiqueta: 'Motivo (obligatorio)', requerido: 'Escribe el motivo' } });
    if (m === null) return null;
    if (m.trim().length < 4) { toast('El motivo debe tener al menos 4 letras'); return null; }
    return m.trim();
  }
  async function accion(fn, ok) { try { await fn(); if (ok) toast(ok); await cargar(); if (pp && $('overlay-checadas').classList.contains('mostrar')) await pintarPersona(); } catch (e) { toast(e.message); } }

  // ---------- Ventana de checadas de una persona (2026-11-09) ----------
  // Un día de la persona (con su semana arriba para cambiar de día): resumen, checadas con foto y resultado del
  // biométrico, intentos fallidos (la cara que no coincidió) y, según permisos, aceptar/anular, agregar la checada
  // olvidada, autorizar el tiempo extra y marcar revisado el aviso de la cara. Se abre desde Asistencia y desde Inicio.
  let pp = null, puedeAs = null;
  const BIOMETRIA = { coincide: ['🙂 cara ✔', ''], no_coincide: ['✖ la cara no coincidió', 'ac-cara-mal'], no_vivo: ['✖ parecía foto o pantalla', 'ac-cara-mal'], sin_rostro: ['sin cara', 'ac-cara-mal'] };
  function verPersona(id, f) {
    pp = { id: Number(id), fecha: f && f <= hoy() ? f : hoy(), turno: 0 };
    $('ac-titulo').textContent = 'Checadas';
    $('ac-cuerpo').innerHTML = '<p class="ayuda" role="status">Cargando…</p>';
    abrirVentana('overlay-checadas');
    pintarPersona();
  }
  async function pintarPersona() {
    if (!pp) return;
    const yo = ++pp.turno, { id, fecha: f } = pp, q = `fecha=${encodeURIComponent(f)}&personal_id=${id}`;
    let sem, ch, ints;
    try {
      if (!puedeAs) puedeAs = (await pedir('')).puede;
      [sem, ch, ints] = await Promise.all([pedir(`/semana?desde=${encodeURIComponent(f)}&personal_id=${id}`), pedir('/checadas?' + q), pedir('/intentos?' + q).catch(() => [])]);
    } catch (e) { if (yo === pp?.turno) $('ac-cuerpo').innerHTML = `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`; return; }
    if (yo !== pp?.turno) return;
    const fila = sem.filas[0];
    if (!fila) { $('ac-cuerpo').innerHTML = '<p class="ayuda">Esta persona no está en el reloj checador ese día.</p>'; return; }
    const d = fila.dias.find(x => x.fecha === f) || {}, p = puedeAs || {};
    $('ac-titulo').textContent = `${fila.nombre}${fila.puesto ? ' · ' + fila.puesto : ''}`;
    let h = `<div class="filtros"><button type="button" class="btn btn-outline" data-ac-dia="-1">◀ Día anterior</button><label>Día <input type="date" id="ac-fecha" value="${esc(f)}" max="${esc(hoy())}"></label>
      <button type="button" class="btn btn-outline" data-ac-dia="1"${f >= hoy() ? ' disabled' : ''}>Día siguiente ▶</button><span class="ayuda">Semana ${esc(fechaLarga(sem.desde))} al ${esc(fechaLarga(sem.hasta))}</span></div>`;
    h += `<div class="ac-semana" role="group" aria-label="Días de la semana">${fila.dias.map(x => `<button type="button" data-ac-ir="${esc(x.fecha)}" class="${x.falta ? 'as-falta' : ''}"${x.fecha === f ? ' aria-current="date"' : ''}${x.fecha > hoy() ? ' disabled' : ''}>
      <b>${esc(fechaLarga(x.fecha))}</b><span>${x.entrada || x.salida ? esc(`${x.entrada || '?'}–${x.salida || '?'}`) : x.falta ? '❌ Falta' : esc(x.incidencia ? INCIDENCIA[x.incidencia] || x.incidencia : x.programado ? '—' : 'Descanso')}</span>
      ${x.extra_min ? `<small>+${esc(hm(x.extra_min))} extra</small>` : ''}${x.por_revisar ? '<small class="as-rojo">⚠️ revisar</small>' : ''}</button>`).join('')}</div>`;
    const dato = (t, v, extra = '') => `<span><small>${esc(t)}</small><b>${esc(v)}</b>${extra}</span>`;
    h += `<div class="ac-resumen">${dato('Horario', d.programado ? `${d.programado.entrada}–${d.programado.salida}` : d.festivo ? 'Festivo' : 'Descanso', d.horario ? `<small>${esc(d.horario)}</small>` : '')}${dato('Entrada', d.entrada || '—')}
      ${dato('Comida', d.comida_min ? hm(d.comida_min) : '—', d.exceso_comida_min ? `<small class="as-rojo">+${esc(d.exceso_comida_min)} min</small>` : '')}${dato('Salida', d.salida || '—', d.salida_anticipada_min ? `<small class="as-rojo">${esc(d.salida_anticipada_min)} min antes</small>` : '')}
      ${dato('Trabajado', hm(d.trabajado_min))}${dato('Retardo', d.retardo_min ? d.retardo_min + ' min' : '—')}${dato('Tiempo extra', d.extra_min ? hm(d.extra_min) : '—', d.extra_min ? `<small>${d.extra_autorizado_min == null ? 'sin autorizar' : 'autorizado ' + esc(hm(d.extra_autorizado_min))}</small>` : '')}</div>`;
    h += detalleExtra(d, fila, sem, f, ch);
    const chips = estadoDia(d);
    if (chips.length) h += `<p>${chips.map(t => `<span class="as-chip">${esc(t)}</span>`).join(' ')}</p>`;
    // Tabla de checadas (2026-11-11, Dirección: «entrada · Entrada» confundía; la segunda era el nombre del kiosco).
    h += `<h4 class="pe-sub2">Checadas</h4>`;
    h += ch.length ? `<div class="tabla-scroll"><table class="tabla-resumen as-tabla ac-checadas"><thead><tr><th>Hora</th><th>Qué marcó</th><th>Desde dónde</th><th>Cara</th><th>Evidencia</th><th>Notas</th>${p.corregir ? '<th></th>' : ''}</tr></thead><tbody>
      ${ch.map(c => `<tr class="${c.estado === 'anulada' ? 'pe-baja' : ''}"><td><b>${esc(String(c.hora).slice(0, 5))}</b></td><td>${esc(TIPOS[c.tipo] || c.tipo)}</td>
        <td>${esc(dondeChecada(c))}${mapa(c)}</td>
        <td>${c.biometria && BIOMETRIA[c.biometria] ? `<span class="${BIOMETRIA[c.biometria][1]}">${esc(BIOMETRIA[c.biometria][0])}${c.distancia_rostro != null && c.biometria !== 'coincide' ? ' (' + esc(Number(c.distancia_rostro).toFixed(2)) + ')' : ''}</span>` : '—'}</td>
        <td>${c.tiene_foto ? `<button type="button" class="btn-link" data-ac-foto="${Number(c.id)}">📷 Ver foto</button>` : esc(c.foto_borrada ? 'Foto borrada (plazo cumplido)' : '—')}</td>
        <td>${esc([c.estado === 'anulada' ? 'Anulada' : c.estado === 'por_revisar' ? 'Por revisar' : '', c.sin_conexion ? 'Sin conexión' : '', c.observaciones || ''].filter(Boolean).join(' · ') || '')}</td>
        ${p.corregir ? `<td>${revisar(c) ? `<button type="button" class="btn-link" data-ac-aceptar="${Number(c.id)}">Aceptar</button> ` : ''}${vigente(c) ? `<button type="button" class="btn-link" data-ac-anular="${Number(c.id)}">Anular</button>` : ''}</td>` : ''}</tr>`).join('')}
      </tbody></table></div>`
      : '<p class="ayuda">No checó este día.</p>';
    if (ints.length) {
      const sinRevisar = ints.filter(i => i.es_cara && !i.revisado_at).length;
      h += `<h4 class="pe-sub2">⚠️ Intentos fallidos en el kiosco (${esc(ints.length)})</h4>${tablaIntentos(ints, { persona: false, foto: 'data-ac-intento-foto' })}
        ${sinRevisar && p.corregir ? `<div class="btn-group"><button type="button" class="btn btn-secundario" id="ac-revisado">✔ Ya lo revisé (quitar el aviso de Inicio)</button></div>` : ''}`;
    }
    h += '<div id="ac-foto"></div>';
    if (p.corregir) h += `<div class="filtros as-form"><b>Agregar checada olvidada:</b><select id="ac-n-tipo" aria-label="Qué se registra">${Object.entries(TIPOS).map(([k, t]) => `<option value="${esc(k)}">${esc(t)}</option>`).join('')}</select>
      <input type="time" id="ac-n-hora" aria-label="Hora"><input id="ac-n-motivo" maxlength="300" placeholder="Motivo (obligatorio)" aria-label="Motivo"><button type="button" class="btn btn-secundario" id="ac-n-guardar">Agregar</button></div>`;
    if (p.extra && d.extra_min) h += `<div class="filtros as-form"><b>Tiempo extra:</b> registrado ${esc(hm(d.extra_min))}${d.extra_autorizado_por ? ` · autorizado ${esc(hm(d.extra_autorizado_min))} por ${esc(d.extra_autorizado_por)}` : ''}.
      Autorizar <input type="number" id="ac-x-min" min="0" max="${Number(d.extra_min)}" value="${Number(d.extra_autorizado_min ?? d.extra_min)}" aria-label="Minutos autorizados" class="as-num"> min
      <input id="ac-x-motivo" maxlength="300" placeholder="Motivo (si autorizas menos)" aria-label="Motivo"><button type="button" class="btn btn-secundario" id="ac-x-guardar">Autorizar</button></div>`;
    $('ac-cuerpo').innerHTML = h;
  }
  // Detalle del tiempo extra (2026-11-11): de dónde sale el del día (cada tramo, si cuenta o no y por qué, traslape,
  // redondeo y autorización) y el de toda su semana de nómina día por día, con dobles y triples.
  const dondeChecada = c => (c.origen === 'manual' ? 'A mano, por ' + (c.registrado_por_nombre || 'RH') : c.origen === 'celular' ? 'Desde su celular' : c.origen === 'whatsapp' ? 'Por WhatsApp' : c.kiosco ? 'Reloj checador «' + c.kiosco + '»' : c.origen || '');
  // Evidencia de un tramo: la foto de cada checada que lo marca (entrada, salida, inicio o fin de tiempo extra).
  function evidencia(ids, ch) {
    const l = (ids || []).map(id => ch.find(c => c.id === id)).filter(Boolean);
    // La checada de otro día (el «Fin» de la madrugada siguiente) dice de qué día es.
    const cuando = c => esc(String(c.hora).slice(0, 5)) + (c.fecha && ch.length && c.fecha !== ch[0].fecha ? ' (' + esc(fechaLarga(c.fecha)) + ')' : '');
    if (!l.length) return '—';
    return l.map(c => c.tiene_foto ? `<button type="button" class="btn-link" data-ac-evidencia="${Number(c.id)}">📷 ${esc(TIPOS[c.tipo] || c.tipo)} ${cuando(c)}</button>`
      : `<small class="pe-cuenta">${esc(TIPOS[c.tipo] || c.tipo)} ${cuando(c)}: ${esc(c.foto_borrada ? 'foto borrada' : c.origen === 'manual' ? 'a mano, sin foto' : 'sin foto')}</small>`).join('<br>');
  }
  function detalleExtra(d, fila, sem, f, ch) {
    const x = d.extra_detalle, dias = fila.dias.filter(y => y.extra_min || y.extra_detalle?.piezas?.some(z => z.cuenta));
    if (!x && !dias.length) return '';
    let h = '<details class="ac-extra" open><summary><b>⏱️ Tiempo extra a detalle</b></summary>';
    if (x) {
      h += `<h4 class="pe-sub2">Este día: ${esc(fechaLarga(f))}</h4><div class="tabla-scroll"><table class="tabla-resumen as-tabla"><thead><tr><th>De</th><th>A</th><th>Minutos</th><th>¿Cuenta?</th><th>Por qué</th><th>Evidencia</th></tr></thead><tbody>
        ${x.piezas.map(z => `<tr class="${z.cuenta ? '' : 'pe-baja'}"><td>${esc(z.desde)}</td><td>${z.min ? esc(z.hasta) : '—'}</td><td>${z.min ? esc(hm(z.min)) : '—'}</td><td>${z.cuenta ? '✔ Sí' : '✖ No'}</td><td>${esc(z.motivo)}</td><td>${evidencia(z.checadas, [...ch, ...(x.otras || [])])}</td></tr>`).join('')}
        ${x.sin_fin ? `<tr class="pe-baja"><td>${esc(x.sin_fin)}</td><td>?</td><td>—</td><td>✖ No</td><td>Marcó «Inicio de tiempo extra» y no marcó el fin: no cuenta hasta que RH agregue la hora real del fin</td><td>${evidencia([x.sin_fin_checada], ch)}</td></tr>` : ''}</tbody></table></div><div id="ac-foto-extra"></div><ul class="pe-ordenes">`;
      if (x.traslape_min) h += `<li>Los tramos se enciman ${esc(hm(x.traslape_min))}: ese tiempo se cuenta una sola vez.</li>`;
      h += `<li>Tiempo extra del día: <b>${esc(hm(x.sin_redondeo_min))}</b>${x.redondeo ? ` → redondeado hacia abajo a bloques de ${esc(x.redondeo.bloque_min)} min: <b>${esc(hm(d.extra_min))}</b> (no cuentan ${esc(hm(x.redondeo.perdidos_min))})` : ''}.</li>`;
      if (d.extra_min) h += `<li>${d.extra_autorizado_min == null ? '<span class="as-rojo">Sin autorizar</span>: no se paga hasta que RH o el gerente lo autoricen.' : `Autorizado <b>${esc(hm(d.extra_autorizado_min))}</b> por ${esc(d.extra_autorizado_por || '')}${d.extra_autorizado_motivo ? ' · ' + esc(d.extra_autorizado_motivo) : ''}.`}</li>`;
      h += `<li class="ayuda">Regla de ese día: ${esc(x.regla)}.</li></ul>`;
    }
    if (dias.length) {
      const t = fila.totales;
      h += `<h4 class="pe-sub2">Su semana de nómina (${esc(fechaLarga(sem.desde))} al ${esc(fechaLarga(sem.hasta))})</h4><div class="tabla-scroll"><table class="tabla-resumen as-tabla"><thead><tr><th>Día</th><th>Tramos que cuentan</th><th>Registrado</th><th>Autorizado</th><th>Por</th></tr></thead><tbody>
        ${dias.map(y => `<tr><td><button type="button" class="btn-link" data-ac-ir="${esc(y.fecha)}">${esc(fechaLarga(y.fecha))}</button></td><td>${esc((y.extra_detalle?.piezas || []).filter(z => z.cuenta).map(z => z.desde + '–' + z.hasta).join(', ') || '—')}</td>
          <td>${esc(hm(y.extra_min))}</td><td>${y.extra_min ? (y.extra_autorizado_min == null ? '<span class="as-rojo">sin autorizar</span>' : esc(hm(y.extra_autorizado_min))) : '—'}</td><td>${esc(y.extra_autorizado_por || '')}</td></tr>`).join('')}</tbody>
        <tfoot><tr><th>Semana</th><th></th><th>${esc(hm(t.extra_min))}</th><th>${esc(hm(t.extra_autorizado_min))}</th><th></th></tr></tfoot></table></div>
        <p class="ayuda">Del tiempo autorizado: <b>${esc(hm(t.extra_dobles_min))}</b> al doble (las primeras 9 h de la semana) y <b>${esc(hm(t.extra_triples_min))}</b> al triple.${fila.dinero?.valor_hora_cent != null ? ` Pago: ${esc(pagoExtra(fila.dinero))}.` : ''}</p>`;
    }
    return h + '</details>';
  }
  async function verFoto(ruta, alt, destino = 'ac-foto') {
    try { const r = await api(ruta); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'No se pudo abrir la foto');
      const url = URL.createObjectURL(await r.blob()), img = document.createElement('img'); img.src = url; img.alt = alt; img.className = 'pe-foto'; img.onload = () => URL.revokeObjectURL(url); $(destino).replaceChildren(img); img.scrollIntoView({ block: 'nearest' }); } catch (err) { toast(err.message); }
  }
  const irDia = f => { if (!pp || !f || f > hoy()) return; pp.fecha = f; pintarPersona(); };
  $('ac-cuerpo').addEventListener('change', e => { if (e.target.id === 'ac-fecha') irDia(e.target.value); });
  $('ac-cuerpo').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b || !pp) return;
    const d = b.dataset;
    if (d.acDia) irDia((() => { const x = new Date(pp.fecha + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + Number(d.acDia)); return x.toISOString().slice(0, 10); })());
    else if (d.acIr) irDia(d.acIr);
    else if (d.acEvidencia) verFoto('/asistencia/checadas/' + Number(d.acEvidencia) + '/foto', 'Evidencia: foto de la checada', 'ac-foto-extra');
    else if (d.acFoto) verFoto('/asistencia/checadas/' + Number(d.acFoto) + '/foto', 'Foto de la checada');
    else if (d.acIntentoFoto) verFoto('/asistencia/intentos/' + Number(d.acIntentoFoto) + '/foto', 'Foto del intento fallido');
    else if (d.acAceptar) { const m = await pedirMotivo('Aceptar la checada', 'Quedará como válida y contará para la nómina. Queda en la bitácora con tu nombre.'); if (m) accion(() => pedir('/checadas/' + Number(d.acAceptar) + '/aceptar', { method: 'POST', body: JSON.stringify({ motivo: m }) }), 'Checada aceptada'); }
    else if (d.acAnular) { const m = await pedirMotivo('Anular la checada', 'No se borra: queda tachada y deja de contar. Queda en la bitácora con tu nombre.'); if (m) accion(() => pedir('/checadas/' + Number(d.acAnular) + '/anular', { method: 'POST', body: JSON.stringify({ motivo: m }) }), 'Checada anulada'); }
    else if (b.id === 'ac-n-guardar') accion(() => pedir('/checadas', { method: 'POST', body: JSON.stringify({ personal_id: pp.id, tipo: $('ac-n-tipo').value, fecha: pp.fecha, hora: $('ac-n-hora').value, motivo: $('ac-n-motivo').value }) }), 'Checada agregada');
    else if (b.id === 'ac-x-guardar') accion(() => pedir('/extra', { method: 'POST', body: JSON.stringify({ personal_id: pp.id, fecha: pp.fecha, minutos: Number($('ac-x-min').value), motivo: $('ac-x-motivo').value }) }), 'Tiempo extra autorizado');
    else if (b.id === 'ac-revisado') { b.disabled = true; await accion(() => pedir('/intentos/revisar', { method: 'POST', body: JSON.stringify({ personal_id: pp.id, fecha: pp.fecha }) }), 'Aviso revisado'); if (typeof Personal !== 'undefined') Personal.pintarInicio(); }
  });
  $('ac-cerrar').onclick = () => $('overlay-checadas').classList.remove('mostrar');

  // ---------- Semana ----------
  function pintarSemana() {
    const d = datos;
    const abre = d.puede?.asistencia !== false; // con solo «Descargar la nómina» no se abren las checadas
    const cual = d.desde === d.vencida ? ' · <b>semana vencida (la que se paga)</b>' : d.desde === d.en_curso ? ' · semana en curso' : '';
    let h = `<div class="filtros"><button type="button" class="btn btn-outline" data-as-semana-ir="${esc(d.anterior)}">◀ Anterior</button><button type="button" class="btn btn-outline" data-as-semana-ir="${esc(d.vencida)}"${d.desde === d.vencida ? ' aria-pressed="true"' : ''}>Semana vencida</button><button type="button" class="btn btn-outline" data-as-semana-ir="${esc(d.en_curso)}"${d.desde === d.en_curso ? ' aria-pressed="true"' : ''}>En curso</button>${d.desde < d.en_curso ? `<button type="button" class="btn btn-outline" data-as-semana-ir="${esc(d.siguiente)}">Siguiente ▶</button>` : ''}
      <label>Semana del <input type="date" id="as-semana" value="${esc(d.desde)}"></label>${d.filas.length ? '<button type="button" class="btn btn-secundario" id="as-excel">📥 Excel de nómina</button>' : ''}</div>
      <p class="ayuda">${esc(fechaLarga(d.desde))} al ${esc(fechaLarga(d.hasta))}${cual}. Semana de nómina: ${esc(d.semana_texto || '')}${d.corta ? ' (esta semana es más corta porque cambió el día en que empieza la semana)' : ''}. Tiempo extra autorizado: las primeras 9 horas de la semana son dobles y lo demás triples (LFT).${abre ? ' Cuándo cuenta el tiempo extra: pestaña «Reglas del tiempo extra».' : ''}${d.dinero ? ` El pago usa el precio de la hora de cada puesto${abre ? ' (Horarios → Precio de la hora)' : ''}.` : ''}${abre ? ' Pulsa un nombre o un día para ver sus checadas.' : ''}</p>`;
    if (!d.filas.length) { $('as-cuerpo').innerHTML = h + '<p class="ayuda">No hay personas en el reloj checador.</p>'; return; }
    h += `<div class="tabla-scroll"><table class="tabla-resumen as-tabla as-semana"><thead><tr><th>Persona</th>${d.fechas.map((f, i) => `<th>${esc(fechaLarga(f))}${d.festivos[i] ? '<small class="pe-cuenta">🎉 festivo</small>' : ''}</th>`).join('')}
      <th>Trabajado</th><th>Retardos</th><th>Faltas</th><th>Extra registrado</th><th>Extra autorizado</th><th>Dobles</th><th>Triples</th>${d.dinero ? '<th>Pago extra</th>' : ''}</tr></thead><tbody>`;
    for (const f of d.filas) {
      const t = f.totales;
      const ultimo = [...f.dias].reverse().find(x => x.fecha <= hoy())?.fecha || d.desde;
      h += `<tr><td>${abre ? `<button type="button" class="pe-nombre" data-as-abrir="${Number(f.personal_id)}" data-fecha="${esc(ultimo)}">${esc(f.nombre)}</button>` : `<b>${esc(f.nombre)}</b>`}<small class="pe-cuenta">${esc(f.puesto || '')}</small></td>${f.dias.map(x => `<td class="${x.falta ? 'as-falta' : ''}">${abre && x.fecha <= hoy() ? `<button type="button" class="btn-link" data-as-abrir="${Number(f.personal_id)}" data-fecha="${esc(x.fecha)}" aria-label="Checadas de ${esc(f.nombre)} el ${esc(fechaLarga(x.fecha))}">` : '<span>'}${x.entrada || x.salida ? esc(`${x.entrada || '?'}–${x.salida || '?'}`) : x.falta ? '❌' : esc(x.incidencia ? INCIDENCIA[x.incidencia] || x.incidencia : x.programado ? '—' : 'Descanso')}${abre && x.fecha <= hoy() ? '</button>' : '</span>'}
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
    const pend = d.filas.reduce((s, f) => s + f.totales.por_revisar + (f.totales.extra_sin_autorizar_min ? 1 : 0) + f.totales.sin_salida + (f.totales.extra_sin_fin || 0) + f.totales.sin_horario, 0);
    if (pend && !await solicitarDialogo({ titulo: 'Hay pendientes en la semana', mensaje: 'Algunas personas tienen checadas por revisar, tiempo extra sin autorizar o sin fin, o días sin salida u horario. El Excel los marca en la hoja «Pendientes». ¿Descargarlo así?', aceptar: 'Descargar' })) return;
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
        ['Comida (min)', 9], ['Horas trabajadas', 11, 'h'], ['Retardo (min)', 9], ['Extra registrado', 11, 'h'], ['Extra autorizado', 11, 'h'], ['Autorizó', 22], ['Detalle del tiempo extra', 50], ['Falta', 7], ['Incidencia', 14], ['Avisos', 50]]);
      const P = hoja('Pendientes', [['Persona', 30], ['Fecha', 12], ['Qué falta', 60]]);
      for (const f of d.filas) {
        const t = f.totales, pendientes = [];
        if (t.por_revisar) pendientes.push(`${t.por_revisar} checada(s) por revisar`);
        if (t.extra_sin_autorizar_min) pendientes.push(`${hm(t.extra_sin_autorizar_min)} de tiempo extra sin autorizar`);
        if (t.sin_salida) pendientes.push(`${t.sin_salida} día(s) sin salida`);
        if (t.extra_sin_fin) pendientes.push(`${t.extra_sin_fin} día(s) con tiempo extra sin fin (ese bloque no cuenta)`);
        if (t.sin_horario) pendientes.push('sin horario asignado');
        if (d.dinero && t.extra_autorizado_min && f.dinero?.valor_hora_cent == null) pendientes.push(`su puesto (${f.puesto || 'sin puesto'}) no tiene precio de la hora: el tiempo extra no se pudo calcular en pesos`);
        R.addRow([f.nombre, f.puesto || '', t.dias_trabajados, t.faltas, t.retardos, t.retardo_min, horas(t.trabajado_min), horas(t.extra_min), horas(t.extra_autorizado_min), horas(t.extra_dobles_min), horas(t.extra_triples_min),
          t.domingos, t.festivos_trabajados, t.descansos_trabajados, t.vacaciones, t.incapacidad, t.permisos, pendientes.join(' · '),
          ...(d.dinero ? (f.dinero?.valor_hora_cent == null ? ['sin precio', null, null, null] : [f.dinero.valor_hora_cent / 100, f.dinero.dobles_cent / 100, f.dinero.triples_cent / 100, f.dinero.total_cent / 100]) : [])]);
        for (const x of f.dias) {
          D.addRow([x.fecha, x.dia, f.nombre, x.horario || 'Sin horario', x.programado?.entrada || (x.festivo ? 'Festivo' : 'Descanso'), x.programado?.salida || '', x.entrada || '', x.salida || '',
            x.comida_min || null, horas(x.trabajado_min), x.retardo_min || null, horas(x.extra_min || null), horas(x.extra_autorizado_min), x.extra_autorizado_por || '', textoExtra(x), x.falta ? 'Sí' : '',
            x.incidencia ? INCIDENCIA[x.incidencia] || x.incidencia : '', [x.festivo ? 'Festivo: ' + x.festivo : '', ...x.notas, x.por_revisar ? `${x.por_revisar} por revisar` : ''].filter(Boolean).join(' · ')]);
          const q = [];
          if (x.por_revisar) q.push(`${x.por_revisar} checada(s) por revisar (Asistencia → Día)`);
          if (x.extra_min && x.extra_autorizado_min == null) q.push(`${hm(x.extra_min)} de tiempo extra sin autorizar`);
          if (x.notas.includes('Sin salida')) q.push('No registró salida');
          if (x.notas.includes('Inició tiempo extra y no marcó el fin')) q.push('Inició tiempo extra y no marcó el fin: ese bloque no cuenta hasta que se agregue el fin');
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
    h += seccionUbicaciones();
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

  // ---------- Reglas del tiempo extra (2026-11-09) ----------
  // Para toda la empresa; cada cambio vale desde una fecha (lo anterior no cambia). Las cambia quien cambia los festivos.
  function pintarReglas() {
    const { vigente: v, dias, bloques, editar, proximas, versiones, semana_actual: sa } = datos, dis = editar ? '' : ' disabled';
    const nombreDia = k => dias[k].toLowerCase(), fin = k => nombreDia(((k + 5) % 7) + 1);
    let h = `<div class="modal-section as-reglas"><h3 class="pe-sub">⏱️ Reglas del tiempo extra</h3>
      <p class="ayuda">Valen para todas las sucursales. Ahora: semana de nómina de <b>${esc(nombreDia(v.inicio_semana))} a ${esc(fin(v.inicio_semana))}</b> (semana vencida: se paga la que ya cerró; la de hoy va del ${esc(fechaLarga(sa.desde))} al ${esc(fechaLarga(sa.hasta))}). Las primeras 9 horas autorizadas de la semana son dobles y lo demás triples (LFT, no se cambia). Vigente desde ${esc(v.desde === '2020-01-01' ? 'el inicio' : fechaLarga(v.desde))}${v.por ? ' · ' + esc(v.por) : ''}.</p>
      ${proximas.length ? `<p class="ayuda">Cambio programado desde el ${esc(fechaLarga(proximas[0].desde))}.</p>` : ''}
      <label>La semana de nómina empieza el <select id="as-r-inicio"${dis}>${Object.entries(dias).map(([k, n]) => `<option value="${esc(k)}"${Number(k) === v.inicio_semana ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select> <small class="pe-cuenta">y termina el día anterior. Si lo cambias, el cambio debe valer desde ese día; la semana del cambio queda más corta.</small></label>
      <label>¿Cómo se cuenta? <select id="as-r-modo"${dis}><option value="auto"${v.modo === 'auto' ? ' selected' : ''}>Automático: lo que trabaje fuera de su horario (y los botones de tiempo extra)</option><option value="botones"${v.modo === 'botones' ? ' selected' : ''}>Solo lo que marque con los botones «Inicio / Fin de tiempo extra»</option></select></label>
      <label>Después de su hora de salida, cuenta cuando se queda al menos <input type="number" id="as-r-despues" class="as-num" min="0" max="240" value="${Number(v.despues_min)}"${dis}> min <small class="pe-cuenta">0 = desde el primer minuto. Si llega a esos minutos, cuenta todo desde su hora de salida; si no, no cuenta.</small></label>
      <label><input type="checkbox" id="as-r-antes"${v.antes_cuenta ? ' checked' : ''}${dis}> Llegar antes de su entrada cuenta como tiempo extra si llega más de <input type="number" id="as-r-antes-min" class="as-num" min="0" max="240" value="${Number(v.antes_min)}"${dis}> min antes <small class="pe-cuenta">(entonces cuenta todo desde que llegó)</small></label>
      <label>Redondear el tiempo extra de cada día hacia abajo a <select id="as-r-bloque"${dis}>${bloques.map(b => `<option value="${b}"${b === v.bloque_min ? ' selected' : ''}>${b === 1 ? 'minuto a minuto (sin redondeo)' : 'bloques de ' + b + ' min'}</option>`).join('')}</select></label>
      <label><input type="checkbox" id="as-r-descanso"${v.descanso_todo ? ' checked' : ''}${dis}> En su día de descanso o en un festivo, todo lo que trabaje es tiempo extra <small class="pe-cuenta">(si no, solo lo que marque con los botones)</small></label>
      ${editar ? `<div class="filtros"><label>Vale desde <input type="date" id="as-r-desde" value="${esc(hoy())}"></label><button type="button" class="btn btn-primario" id="as-r-guardar">Guardar reglas</button></div>` : '<p class="ayuda">Las cambia Dirección o RH de la empresa.</p>'}</div>`;
    if (versiones.length > 1) h += `<div class="modal-section"><h3 class="pe-sub">Historial</h3><ul class="pe-ordenes">${versiones.map(x => `<li><b>Desde ${esc(x.desde === '2020-01-01' ? 'el inicio' : fechaLarga(x.desde))}</b>: semana ${esc(nombreDia(x.inicio_semana))} a ${esc(fin(x.inicio_semana))} · ${esc(x.modo === 'auto' ? 'automático' : 'solo botones')} · después de la salida desde ${esc(x.despues_min)} min · llegar antes ${x.antes_cuenta ? 'desde ' + esc(x.antes_min) + ' min' : 'no cuenta'} · ${esc(x.bloque_min === 1 ? 'minuto a minuto' : 'bloques de ' + x.bloque_min + ' min')} · descanso/festivo ${x.descanso_todo ? 'todo es extra' : 'solo botones'}${x.por ? ' <small class="pe-cuenta">' + esc(x.por) + '</small>' : ''}</li>`).join('')}</ul></div>`;
    $('as-cuerpo').innerHTML = h;
  }
  async function guardarReglas(b) {
    const r = { inicio_semana: Number($('as-r-inicio').value), modo: $('as-r-modo').value, despues_min: Number($('as-r-despues').value), antes_cuenta: $('as-r-antes').checked, antes_min: Number($('as-r-antes-min').value), bloque_min: Number($('as-r-bloque').value), descanso_todo: $('as-r-descanso').checked, desde: $('as-r-desde').value };
    if (!await solicitarDialogo({ titulo: 'Guardar las reglas del tiempo extra', mensaje: `Valen para todas las sucursales desde el ${fechaLarga(r.desde)}. Lo anterior a esa fecha no cambia. Queda en la bitácora con tu nombre.`, aceptar: 'Guardar' })) return;
    b.disabled = true;
    try { const x = await pedir('/reglas-extra', { method: 'PUT', body: JSON.stringify(r) }); toast(x.cambios ? 'Reglas guardadas' : 'Sin cambios'); semana = null; await cargar(); }
    catch (e) { toast(e.message); b.disabled = false; }
  }

  // ---------- Eventos ----------
  document.querySelectorAll('[data-as-pestana]').forEach(b => { b.onclick = () => { pestana = b.dataset.asPestana; editando = null; cargar(); }; });
  // Ubicación de cada sucursal: el celular que checa más lejos que su radio queda «por revisar» (la captura Dirección).
  function seccionUbicaciones() {
    const u = datos.ubicaciones;
    if (!u || !u.sucursales.length) return '';
    return `<div class="modal-section"><h3 class="pe-sub">📍 Ubicación de cada sucursal (para checar con el celular)</h3>
      <p class="ayuda">Si alguien checa con su celular a más del radio de su sucursal (${esc(u.radio_omision)} m si no se cambia), la checada queda «por revisar» y se ve en el mapa (p. ej. si checó en casa de un cliente).${u.editar ? ' Para sacar la ubicación: en Google Maps, mantén presionado el punto de la sucursal y copia los números que salen (p. ej. «20.5888, -100.3899»).' : ''}</p>
      <ul class="pe-ordenes">${u.sucursales.map(s => `<li><b>${esc(s.nombre)}</b>: ${s.lat == null ? '<span class="as-rojo">sin ubicación</span>' : `${esc(s.lat)}, ${esc(s.lon)} · radio ${esc(s.radio_m || u.radio_omision)} m <a class="btn-link" target="_blank" rel="noopener noreferrer" href="${esc('https://www.google.com/maps?q=' + Number(s.lat) + ',' + Number(s.lon))}">📍 Mapa</a>`}
        ${u.editar ? `<span class="filtros as-form"><input id="as-u-${Number(s.id)}" value="${esc(s.lat == null ? '' : s.lat + ', ' + s.lon)}" placeholder="20.5888, -100.3899" aria-label="Ubicación de ${esc(s.nombre)}"><input type="number" id="as-r-${Number(s.id)}" class="as-num" min="100" max="20000" value="${esc(s.radio_m || u.radio_omision)}" aria-label="Radio en metros"> m <button type="button" class="btn btn-secundario" data-as-ubicacion="${Number(s.id)}">Guardar</button></span>` : ''}</li>`).join('')}</ul></div>`;
  }
  $('as-cuerpo').addEventListener('change', e => {
    if (e.target.id === 'as-fecha' && e.target.value) { fecha = e.target.value; cargar(); }
    else if (e.target.id === 'as-semana' && e.target.value) { semana = e.target.value; cargar(); }
    else if (e.target.id === 'as-anio') { anio = e.target.value; cargar(); }
    else if (e.target.id === 'as-p-suc') { precioSuc = Number(e.target.value); pintarPrecios(); }
  });
  $('as-cuerpo').addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.asAbrir) verPersona(d.asAbrir, d.fecha || fecha);
    else if (d.asSemanaIr) { semana = d.asSemanaIr; cargar(); }
    else if (b.id === 'as-r-guardar') guardarReglas(b);
    else if (d.asIntentoFoto) {
      try { const r = await api('/asistencia/intentos/' + Number(d.asIntentoFoto) + '/foto'); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'No se pudo abrir la foto');
        const url = URL.createObjectURL(await r.blob()), img = document.createElement('img'); img.src = url; img.alt = 'Foto del intento fallido'; img.className = 'pe-foto'; img.onload = () => URL.revokeObjectURL(url); $('as-intento-foto').replaceChildren(img); } catch (err) { toast(err.message); }
    }
    else if (d.asUbicacion) {
      const id = Number(d.asUbicacion);
      try { await pedir('/sucursales/' + id + '/ubicacion', { method: 'PUT', body: JSON.stringify({ ubicacion: $('as-u-' + id).value, radio_m: $('as-r-' + id).value === '' ? null : Number($('as-r-' + id).value) }) }); toast('Ubicación guardada'); await cargar(); }
      catch (err) { toast(err.message); }
    }
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
  return { cargar, verPersona };
})();
