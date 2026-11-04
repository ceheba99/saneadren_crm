/* Marketing · llamadas de Google Ads (2026-11-04). Ver server/marketing-google-ads.js.
   Pestaña «📞 Google Ads» (solo Dirección y el Gerente de marketing): subir el reporte «Detalles de las llamadas» con
   vista previa y errores por renglón, y el reporte cruzado con los contactos (por campaña, lada, horario, estado y
   sucursal, más la lista de números que llamaron y no se registraron). */
const GoogleAdsMk = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t == null ? '' : String(t));
  const num = v => Number(v || 0).toLocaleString('es-MX');
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + ' %' : '—');
  const fechaTxt = f => (f ? new Date(String(f).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const horaTxt = h => String(h).padStart(2, '0') + ':00';
  const durTxt = s => { s = Number(s) || 0; return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0') + ' s'; };
  const promedio = x => durTxt(Math.round(x.duracion_seg / (x.llamadas || 1)));
  const barra = p => `<span class="py-barra" role="presentation"><i style="width:${Math.max(0, Math.min(100, Number(p) || 0))}%"></i></span>`;
  async function pedir(ruta, body, method = 'GET') {
    const r = await api('/marketing/google-ads' + ruta, body !== undefined ? { method, body: JSON.stringify(body) } : undefined);
    const d = await r.json().catch(() => ({})); if (!r.ok) throw Error(d.error || 'No se pudo completar'); return d;
  }
  let PREVIA = null, ocupado = false;

  // =================== Subir el CSV: vista previa y guardar ===================
  async function elegir(arch) {
    if (!arch) return;
    if (arch.size > 4 * 1024 * 1024) { toast('El archivo pesa más de 4 MB: descárgalo por periodos más cortos'); return; }
    try {
      const csv = await arch.text(), p = await pedir('/vista-previa', { csv }, 'POST');
      PREVIA = { csv, archivo: arch.name, ...p }; pintarPrevia();
    } catch (e) { PREVIA = null; $('ga-previa').innerHTML = `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`; }
    finally { $('ga-archivo').value = ''; }
  }
  function pintarPrevia() {
    if (!PREVIA) { $('ga-previa').innerHTML = ''; return; }
    const r = PREVIA.resumen;
    const errores = PREVIA.errores.length ? `<details class="mk-versiones" open><summary>⚠ ${num(r.con_error)} renglón(es) con error: no se guardan</summary><div class="tabla-scroll"><table class="pg-tabla"><thead><tr><th>Renglón</th><th>Qué pasa</th></tr></thead><tbody>
        ${PREVIA.errores.map(x => `<tr><td>${Number(x.fila)}</td><td>${esc(x.error)}</td></tr>`).join('')}</tbody></table></div></details>` : '';
    const muestra = PREVIA.muestra.length ? `<details class="mk-versiones"><summary>Ver las primeras ${PREVIA.muestra.length} llamadas como se leyeron</summary><div class="tabla-scroll"><table class="pg-tabla"><thead><tr><th>Fecha</th><th>Hora</th><th>Número</th><th class="st-num">Duración</th><th>Estado</th><th>Campaña</th></tr></thead><tbody>
        ${PREVIA.muestra.map(l => `<tr><td>${esc(fechaTxt(l.fecha))}</td><td>${esc(horaTxt(l.hora))}</td><td>${esc(l.telefono || 'sin número')}</td><td class="st-num">${esc(durTxt(l.duracion_seg))}</td><td>${esc(l.estado)}</td><td>${esc(l.campana)}</td></tr>`).join('')}</tbody></table></div></details>` : '';
    $('ga-previa').innerHTML = `<section class="modal-section pl-caja"><div class="seccion-tit">👀 Vista previa: ${esc(PREVIA.archivo)}</div>
      <p>${PREVIA.rango ? `Periodo del reporte: <b>${esc(PREVIA.rango.texto)}</b>. ` : r.desde ? `Llamadas del ${esc(fechaTxt(r.desde))} al ${esc(fechaTxt(r.hasta))}. ` : ''}
        <b>${num(r.validas)}</b> llamadas leídas (${num(r.recibidas)} recibidas, ${num(r.perdidas)} perdidas, ${num(r.sin_numero)} sin número; ${num(r.cdmx)} de ${num(r.con_numero)} con número son lada 55/56).</p>
      <p>${r.nuevas ? `Se guardarán <b>${num(r.nuevas)} nuevas</b>` : '<b>No hay llamadas nuevas</b>'}${r.repetidas ? ` · ${num(r.repetidas)} ya estaban guardadas y no se duplican` : ''}.</p>
      ${errores}${muestra}
      <div class="btn-group"><button type="button" class="btn btn-primario" id="ga-guardar"${r.nuevas ? '' : ' disabled'}>Guardar ${num(r.nuevas)} llamadas nuevas</button><button type="button" class="btn btn-outline" id="ga-cancelar">Cancelar</button></div></section>`;
  }
  async function guardar() {
    if (ocupado || !PREVIA) return; ocupado = true; $('ga-guardar').disabled = true;
    try {
      const r = await pedir('/cargar', { csv: PREVIA.csv, archivo: PREVIA.archivo }, 'POST');
      toast(`Se guardaron ${num(r.resumen.nuevas)} llamadas nuevas` + (r.resumen.repetidas ? ` (${num(r.resumen.repetidas)} ya estaban)` : ''));
      PREVIA = null; pintarPrevia();
      if (r.desde) { $('ga-desde').value = r.desde; $('ga-hasta').value = r.hasta; }
      await reporte();
    } catch (e) { toast(e.message); if ($('ga-guardar')) $('ga-guardar').disabled = false; } finally { ocupado = false; }
  }

  // =================== Reporte ===================
  async function reporte() {
    const q = $('ga-desde').value && $('ga-hasta').value ? { desde: $('ga-desde').value, hasta: $('ga-hasta').value } : {};
    if ($('ga-campana').value) q.campana = $('ga-campana').value;
    try {
      const r = await pedir(Object.keys(q).length ? '?' + new URLSearchParams(q) : '');
      if (r.desde) { $('ga-desde').value = r.desde; $('ga-hasta').value = r.hasta; }
      const elegida = r.campana || '';
      $('ga-campana').innerHTML = '<option value="">Todas las campañas</option>' + r.lista_campanas.map(c => `<option value="${esc(c)}"${c === elegida ? ' selected' : ''}>${esc(c)}</option>`).join('');
      $('ga-cuerpo').innerHTML = pintar(r);
    } catch (e) { $('ga-cuerpo').innerHTML = `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`; }
  }
  // Columnas comunes de las tablas de totales.
  const CAB = '<th class="st-num">Llamadas</th><th class="st-num">Recibidas</th><th class="st-num">Perdidas</th><th class="st-num">Registradas</th><th class="st-num">Ya existían</th><th class="st-num">Sin registrar</th><th class="st-num">Sin número</th><th class="st-num">Órdenes</th><th class="st-num">Vendido (sin IVA)</th>';
  const celdas = x => `<td data-label="Llamadas" class="st-num">${num(x.llamadas)}</td><td data-label="Recibidas" class="st-num">${num(x.recibidas)}</td><td data-label="Perdidas" class="st-num">${num(x.perdidas)}</td>
    <td data-label="Registradas" class="st-num">${num(x.registradas)}</td><td data-label="Ya existían" class="st-num">${num(x.ya_existian)}</td><td data-label="Sin registrar" class="st-num">${num(x.sin_registrar)}</td><td data-label="Sin número" class="st-num">${num(x.sin_numero)}</td>
    <td data-label="Órdenes" class="st-num">${num(x.ganadas)}</td><td data-label="Vendido (sin IVA)" class="st-num">${formatoMoneda(x.importe_cent / 100)}</td>`;
  const tablaTotales = (titulo, filas, nombre) => `<div class="tabla-scroll"><table class="tabla-clientes"><thead><tr><th>${esc(titulo)}</th>${CAB}</tr></thead><tbody>
    ${filas.map(x => `<tr><td data-label="${esc(titulo)}">${nombre(x)}</td>${celdas(x)}</tr>`).join('')}</tbody></table></div>`;
  function pintar(r) {
    if (!r.hay_llamadas) return '<p class="util-45">Aún no se ha subido ningún reporte. En Google Ads: Informes → «Detalles de las llamadas» → Descargar → CSV, y súbelo con el botón «📤 Subir reporte (CSV)».</p>';
    const t = r.total;
    if (!t.llamadas) return `<p class="util-45">No hay llamadas del ${esc(fechaTxt(r.desde))} al ${esc(fechaTxt(r.hasta))}${r.campana ? ' en esa campaña' : ''}. Hay llamadas guardadas del ${esc(fechaTxt(r.extremos.desde))} al ${esc(fechaTxt(r.extremos.hasta))}.</p>` + historial(r);
    const card = (n, txt, clase = '') => `<div class="rc-card ${clase}"><span class="rc-num">${n}</span><span class="rc-label">${esc(txt)}</span></div>`;
    const conNum = t.llamadas - t.sin_numero, a = r.aviso;
    const avisos = [];
    if (t.cdmx && conNum) avisos.push(['alerta', `📍 ${num(t.cdmx)} de ${num(conNum)} llamadas con número (${pct(t.cdmx, conNum)}) son lada 55/56: Ciudad de México y su zona.`]);
    if (a.sin_sucursal) avisos.push(['rojo', `⚠ ${num(a.sin_sucursal)} llamadas no quedaron registradas en el CRM (sin sucursal): ${num(a.con_numero)} con número (${num(a.numeros_distintos)} números distintos) y ${num(a.sin_sucursal - a.con_numero)} sin número. De ellas, ${num(a.cdmx)} son lada CDMX (55/56).`]);
    const porEstado = r.estados; // (alias: el revisor de escapado toma «.estados» por un texto libre)
    const maxHora = Math.max(...r.horario.map(x => x.llamadas), 1), maxDia = Math.max(...r.dias.map(x => x.llamadas), 1);
    return `${avisos.length ? `<div class="tb-avisos">${avisos.map(([c, x]) => `<p class="tb-aviso tb-${c}">${esc(x)}</p>`).join('')}</div>` : ''}
      <div class="rc-grid tb-tarjetas">${card(num(t.llamadas), 'Llamadas')}${card(num(t.recibidas), 'Recibidas')}${card(num(t.perdidas), 'Perdidas', t.perdidas ? 'prospecto' : '')}${card(num(t.sin_numero), 'Sin número')}${card(num(t.cdmx), 'Lada CDMX (55/56)')}
        ${card(num(t.registradas), 'Registradas en el CRM', 'cliente')}${card(num(t.ya_existian), 'Clientes que ya existían')}${card(num(t.sin_registrar), 'Sin registrar', t.sin_registrar ? 'prospecto' : '')}${card(num(t.ganadas), 'Terminaron en orden de servicio', 'recurrente')}${card(formatoMoneda(t.importe), 'Vendido (sin IVA)', 'valor')}</div>
      <p class="ayuda">Del ${esc(fechaTxt(r.desde))} al ${esc(fechaTxt(r.hasta))}${r.campana ? ` · campaña «${esc(r.campana)}»` : ''}. Una llamada cuenta como registrada si el contacto o su cotización se dio de alta ese día o en los ${Number(r.ventana_dias)} días siguientes; cada cotización cuenta una sola vez (para la primera llamada de su número).</p>
      <section class="modal-section pl-caja"><div class="seccion-tit">🔗 Cruce con el CRM</div>${tablaTotales('Resultado', r.cruces.filter(x => x.llamadas), x => esc(x.nombre))}</section>
      <section class="modal-section pl-caja"><div class="seccion-tit">📣 Por campaña</div>${tablaTotales('Campaña', r.campanas, x => esc(x.campana))}</section>
      <section class="modal-section pl-caja"><div class="seccion-tit">📍 Por lada</div>${tablaTotales('Lada', r.ladas, x => esc(x.nombre))}
          ${r.otras_ladas.length ? `<p class="ayuda">Otras ladas (por sus 3 primeros números): ${r.otras_ladas.map(x => `<b>${esc(x.lada)}</b>${esc(x.nombre ? ' ' + x.nombre : '')} ${num(x.llamadas)}`).join(' · ')}</p>` : ''}</section>
      <section class="modal-section pl-caja"><div class="seccion-tit">🏢 Por sucursal (la del contacto)</div>${tablaTotales('Sucursal', r.sucursales, x => esc(x.sucursal))}</section>
      <div class="tb-dos"><section class="modal-section pl-caja"><div class="seccion-tit">🕐 Por hora del día</div><p class="ayuda">Google redondea la hora: «10:00» son las llamadas de 10:00 a 10:59.</p>
          <div class="tabla-scroll"><table class="pg-tabla"><thead><tr><th>Hora</th><th></th><th class="st-num">Llamadas</th><th class="st-num">Perdidas</th><th class="st-num">Registradas</th></tr></thead><tbody>
          ${r.horario.map(x => `<tr><td>${esc(horaTxt(x.hora))}</td><td>${barra((x.llamadas / maxHora) * 100)}</td><td class="st-num">${num(x.llamadas)}</td><td class="st-num${x.perdidas ? ' rojo' : ''}">${num(x.perdidas)}</td><td class="st-num">${num(x.registradas)}</td></tr>`).join('')}</tbody></table></div></section>
        <section class="modal-section pl-caja"><div class="seccion-tit">📅 Por día de la semana</div>
          <div class="tabla-scroll"><table class="pg-tabla"><thead><tr><th>Día</th><th></th><th class="st-num">Llamadas</th><th class="st-num">Perdidas</th><th class="st-num">Registradas</th></tr></thead><tbody>
          ${r.dias.map(x => `<tr><td>${esc(x.dia)}</td><td>${barra((x.llamadas / maxDia) * 100)}</td><td class="st-num">${num(x.llamadas)}</td><td class="st-num${x.perdidas ? ' rojo' : ''}">${num(x.perdidas)}</td><td class="st-num">${num(x.registradas)}</td></tr>`).join('')}</tbody></table></div>
          <div class="seccion-tit">☎️ Por estado (como lo da Google)</div>
          <div class="tabla-scroll"><table class="pg-tabla"><thead><tr><th>Estado</th><th class="st-num">Llamadas</th><th class="st-num">Duración promedio</th></tr></thead><tbody>
          ${porEstado.map(x => `<tr><td>${esc(x.estado)}</td><td class="st-num">${num(x.llamadas)}</td><td class="st-num">${esc(promedio(x))}</td></tr>`).join('')}</tbody></table></div></section></div>
      <section class="modal-section pl-caja"><div class="seccion-tit">📋 Números que llamaron y no se registraron (${num(r.sin_registrar.length)})</div>
        <p class="ayuda">No aparecen en el CRM, o se dieron de alta más de ${Number(r.ventana_dias)} días después de llamar. Conviene revisar si se atendieron y darlos de alta con su canal «Google».</p>
        ${r.sin_registrar.length ? `<div class="tabla-scroll"><table class="tabla-clientes"><thead><tr><th>Número</th><th>Última llamada</th><th class="st-num">Veces</th><th class="st-num">Recibidas</th><th class="st-num">Duración total</th><th>Campaña</th></tr></thead><tbody>
          ${r.sin_registrar.map(x => `<tr><td data-label="Número">${esc(x.telefono)}${x.lada === 'cdmx' ? ' <small class="celda-sub">CDMX y zona</small>' : x.lada === 'extranjero' ? ' <small class="celda-sub">extranjero</small>' : ''}</td><td data-label="Última llamada">${esc(fechaTxt(x.ultima))} ${esc(x.ultima.slice(11))}<small class="celda-sub">${esc(x.ultimo_estado)}</small></td>
            <td data-label="Veces" class="st-num">${num(x.veces)}</td><td data-label="Recibidas" class="st-num">${num(x.recibidas)}</td><td data-label="Duración total" class="st-num">${esc(durTxt(x.duracion_seg))}</td><td data-label="Campaña">${esc(x.campanas.join(', '))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="util-45">Todas las llamadas con número están en el CRM. 👏</p>'}</section>
      ${historial(r)}`;
  }
  const historial = r => (r.cargas.length ? `<details class="mk-versiones"><summary>Reportes subidos (${num(r.cargas.length)})</summary><div class="tabla-scroll"><table class="pg-tabla"><thead><tr><th>Cuándo</th><th>Quién</th><th>Archivo y periodo</th><th class="st-num">Nuevas</th><th class="st-num">Ya estaban</th><th class="st-num">Con error</th></tr></thead><tbody>
    ${r.cargas.map(c => `<tr><td>${esc(fechaTxt(c.created_at))} ${esc(String(c.created_at).slice(11, 16))}</td><td>${esc(c.cargado_por || '—')}</td><td>${esc(c.archivo || '—')}<small class="celda-sub">${esc(c.rango_texto || (c.desde ? fechaTxt(c.desde) + ' – ' + fechaTxt(c.hasta) : ''))}</small></td><td class="st-num">${num(c.nuevas)}</td><td class="st-num">${num(c.repetidas)}</td><td class="st-num">${num(c.con_error)}</td></tr>`).join('')}</tbody></table></div></details>` : '');

  // =================== Eventos ===================
  $('ga-archivo').addEventListener('change', e => elegir(e.target.files[0]));
  $('ga-previa').addEventListener('click', e => { if (e.target.closest('#ga-guardar')) guardar(); else if (e.target.closest('#ga-cancelar')) { PREVIA = null; pintarPrevia(); } });
  $('ga-ver').addEventListener('click', reporte);
  $('ga-campana').addEventListener('change', reporte);
  return { cargar: reporte };
})();
window.GoogleAdsMk = GoogleAdsMk;
