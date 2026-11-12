/* Proyectos y tareas con Gantt (2026-11-11). Servidor: server/tareas.js.
   · Pestañas: «Mis tareas» (todos) y «Equipo» (quien asigna: Dirección y Gerente), con el Gantt agrupado por proyecto o
     por persona, la línea de hoy, avance dentro de cada barra, vencidas en rojo e hitos como rombo.
   · Detalle de una tarea: historial, avance, comentario, archivo, terminar; y para quien asignó: cambiar, aceptar o
     regresar, cancelar. «Mis tareas» también sale hasta arriba del Inicio.
   Todo dato se escapa con escaparHtml y los botones usan data-*, sin onclick en línea. */
const Tareas = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t);
  const fecha = f => (/^\d{4}-\d{2}-\d{2}/.test(f || '') ? f.slice(0, 10).split('-').reverse().join('/') : '');
  const corta = f => { const [, m, d] = f.split('-'); return `${Number(d)}/${Number(m)}`; };
  const dias = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
  const sumar = (f, n) => new Date(Date.parse(f + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const claseDe = t => (t.vencida ? 'tg-venc' : COLOR[t.estado] || '');
  const COLOR = { pendiente: 'tg-pend', en_proceso: 'tg-proc', por_revisar: 'tg-rev', terminada: 'tg-ok', cancelada: 'tg-canc' };
  async function pedir(ruta, opciones) {
    const res = await api(ruta, opciones), j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j.error || 'No se pudo completar'), { status: res.status });
    return j;
  }
  let D = null, PEST = 'mias', AGRUPAR = 'proyecto', ESTADO = 'abiertas', FILTRO_P = '', FILTRO_U = '', ABIERTA = null, FORM = null, listo = false;

  async function cargar() {
    if (!listo) iniciar();
    const cont = $('tg-cuerpo');
    cont.innerHTML = '<p class="ayuda" role="status">Cargando tareas…</p>';
    try { D = await pedir('/tareas?' + new URLSearchParams({ vista: PEST === 'mias' ? 'mias' : 'equipo', estado: ESTADO, ...(FILTRO_P ? { proyecto: FILTRO_P } : {}), ...(FILTRO_U ? { persona: FILTRO_U } : {}) })); }
    catch (err) { if (err.status !== 401) cont.innerHTML = `<div class="aviso-error-carga" role="alert"><p>No se pudieron cargar: ${esc(err.message)}</p></div>`; return; }
    if (!D.puede_asignar) PEST = 'mias';
    pintar();
  }
  function iniciar() {
    listo = true;
    $('tg-cuerpo').addEventListener('click', clic);
    $('tg-cuerpo').addEventListener('change', e => {
      if (e.target.id === 'tg-f-proy') { FILTRO_P = e.target.value; cargar(); }
      if (e.target.id === 'tg-f-persona') { FILTRO_U = e.target.value; cargar(); }
      if (e.target.id === 'tg-f-agrupar') { AGRUPAR = e.target.value; pintar(); }
      if (e.target.id === 'tg-f-estado') { ESTADO = e.target.value; cargar(); }
      if (e.target.id === 'tg-archivo') subirArchivo(e.target);
    });
  }

  // ---------- Gantt ----------
  function gantt(tareas) {
    if (!tareas.length) return '<p class="util-45">No hay tareas con estos filtros.</p>';
    const hoy = D.hoy;
    let ini = tareas.reduce((m, t) => (t.inicio < m ? t.inicio : m), hoy), fin = tareas.reduce((m, t) => (t.fin > m ? t.fin : m), sumar(hoy, 7));
    ini = sumar(ini, -1); fin = sumar(fin, 1); if (dias(ini, fin) < 14) fin = sumar(ini, 14);
    const total = dias(ini, fin) + 1, pos = f => (dias(ini, f) / total) * 100;
    const grupos = new Map();
    for (const t of tareas) { const k = AGRUPAR === 'persona' ? t.asignado : t.proyecto || 'Sin proyecto'; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(t); }
    const marcas = []; for (let i = 0; i < total; i += Math.max(1, Math.ceil(total / 12))) marcas.push(sumar(ini, i));
    const fila = t => {
      const izq = pos(t.inicio), ancho = Math.max((dias(t.inicio, t.fin) + 1) / total * 100, 1.2);
      const barra = t.es_hito ? `<span class="tg-hito ${claseDe(t)}" style="left:calc(${pos(t.fin)}% + ${50 / total}%)" title="${esc(t.titulo)}"></span>`
        : `<span class="tg-barra ${claseDe(t)}" style="left:${izq}%;width:${ancho}%" title="${esc(t.titulo + ' · ' + fecha(t.inicio) + ' a ' + fecha(t.fin) + ' · ' + t.avance + ' %')}"><span class="tg-relleno" style="width:${Number(t.avance)}%"></span></span>`;
      return `<div class="tg-fila"><button type="button" class="tg-nombre" data-tg="abrir" data-id="${Number(t.id)}"><b>${esc(t.titulo)}</b><small>${esc(AGRUPAR === 'persona' ? (t.proyecto || 'Sin proyecto') : t.asignado)} · ${esc(corta(t.fin))}${t.depende_de ? ' · depende' : ''}</small></button>
        <div class="tg-pista" data-tg="abrir" data-id="${Number(t.id)}">${barra}</div></div>`;
    };
    return `<div class="tg-gantt" role="figure" aria-label="Diagrama de Gantt">
      <div class="tg-fila tg-cab"><span class="tg-nombre"></span><div class="tg-pista">${marcas.map(m => `<span class="tg-marca" style="left:${pos(m)}%">${esc(corta(m))}</span>`).join('')}
        ${hoy >= ini && hoy <= fin ? `<span class="tg-hoy-et" style="left:${pos(hoy) + 50 / total}%">hoy</span>` : ''}</div></div>
      <div class="tg-filas">${hoy >= ini && hoy <= fin ? `<span class="tg-hoy" style="left:calc(var(--tg-nombre) + (100% - var(--tg-nombre)) * ${(pos(hoy) + 50 / total) / 100})"></span>` : ''}
      ${[...grupos].map(([g, ts]) => `<div class="tg-grupo">${esc(g)}</div>${ts.map(fila).join('')}`).join('')}</div></div>
      <p class="tg-leyenda"><span class="tg-cuadro tg-pend"></span>Pendiente <span class="tg-cuadro tg-proc"></span>En proceso <span class="tg-cuadro tg-rev"></span>Por revisar <span class="tg-cuadro tg-ok"></span>Terminada <span class="tg-cuadro tg-venc"></span>Vencida · ◆ hito</p>`;
  }

  // ---------- Pantalla ----------
  function pintar() {
    const d = D;
    const pestanas = d.puede_asignar ? `<div class="ct-pestanas" role="tablist">${[['mias', 'Mis tareas'], ['equipo', 'Equipo (Gantt)']].map(([k, t]) => `<button type="button" role="tab" class="ct-pestana${PEST === k ? ' activa' : ''}" aria-selected="${PEST === k}" data-tg="pestana" data-p="${k}">${t}</button>`).join('')}</div>` : '';
    const opcionesPersona = d.equipo.map(u => '<option value="' + Number(u.id) + '"' + (String(u.id) === FILTRO_U ? ' selected' : '') + '>' + esc(u.nombre) + '</option>').join('');
    const filtros = `<div class="filtros tg-filtros">
      ${d.proyectos.length ? `<label>Proyecto <select id="tg-f-proy"><option value="">Todos</option>${d.proyectos.map(p => `<option value="${Number(p.id)}"${String(p.id) === FILTRO_P ? ' selected' : ''}>${esc(p.nombre)} (${Number(p.avance)} %)</option>`).join('')}</select></label>` : ''}
      ${PEST === 'equipo' ? `<label>Persona <select id="tg-f-persona"><option value="">Todas</option>${opcionesPersona}</select></label>
        <label>Agrupar <select id="tg-f-agrupar"><option value="proyecto"${AGRUPAR === 'proyecto' ? ' selected' : ''}>por proyecto</option><option value="persona"${AGRUPAR === 'persona' ? ' selected' : ''}>por persona</option></select></label>` : ''}
      <label>Mostrar <select id="tg-f-estado"><option value="abiertas"${ESTADO === 'abiertas' ? ' selected' : ''}>Abiertas</option><option value="cerradas"${ESTADO === 'cerradas' ? ' selected' : ''}>Terminadas y canceladas</option><option value="todas"${ESTADO === 'todas' ? ' selected' : ''}>Todas</option></select></label>
      ${d.puede_asignar ? '<button type="button" class="btn btn-primario" data-tg="nueva">+ Nueva tarea</button><button type="button" class="btn btn-outline" data-tg="nuevo-proyecto">+ Nuevo proyecto</button>' : ''}</div>`;
    const resumen = (() => { const ts = d.tareas, venc = ts.filter(t => t.vencida).length, rev = ts.filter(t => t.estado === 'por_revisar').length;
      return `<p class="tg-resumen">${ts.length} ${ts.length === 1 ? 'tarea' : 'tareas'}${venc ? ` · <b class="rojo">${venc} vencida(s)</b>` : ''}${rev ? ` · ${rev} por revisar` : ''}</p>`; })();
    $('tg-cuerpo').innerHTML = pestanas + filtros + (FORM ? formulario() : '') + (ABIERTA ? '<div id="tg-detalle"></div>' : '') + resumen + gantt(d.tareas);
    if (ABIERTA) abrir(ABIERTA, true);
  }

  // ---------- Formularios ----------
  function formulario() {
    if (FORM.tipo === 'proyecto') return `<div class="ant-form tg-form"><h3>Nuevo proyecto</h3><div class="campo"><label for="tg-p-nombre">Nombre (obligatorio)</label><input id="tg-p-nombre" maxlength="120" placeholder="Ej. Arranque de la sucursal CDMX"></div>
      <div class="campo"><label for="tg-p-desc">Descripción (opcional)</label><textarea id="tg-p-desc" rows="2" maxlength="2000"></textarea></div>
      <div class="ant-acciones"><button type="button" class="btn btn-primario" data-tg="guardar-proyecto">Guardar proyecto</button><button type="button" class="btn btn-outline" data-tg="cerrar-form">Cancelar</button></div></div>`;
    const t = FORM.tarea || {}, hoy = D.hoy;
    const deps = D.tareas.filter(x => x.id !== t.id);
    const opcionesEquipo = D.equipo.map(u => '<option value="' + Number(u.id) + '"' + (u.id === t.asignado_a ? ' selected' : '') + '>' + esc(u.nombre) + '</option>').join('');
    return `<div class="ant-form tg-form"><h3>${t.id ? 'Cambiar tarea' : 'Nueva tarea'}</h3><div class="form-grid-2">
      <div class="campo"><label for="tg-t-titulo">¿Qué hay que hacer? (obligatorio)</label><input id="tg-t-titulo" maxlength="160" value="${esc(t.titulo || '')}"></div>
      <div class="campo"><label for="tg-t-asignado">¿Quién? (obligatorio)</label><select id="tg-t-asignado"><option value="">Selecciona…</option>${opcionesEquipo}</select></div>
      <div class="campo"><label for="tg-t-inicio">Inicio (obligatorio)</label><input id="tg-t-inicio" type="date" value="${esc(t.inicio || hoy)}"></div>
      <div class="campo"><label for="tg-t-fin">Entrega (obligatorio)</label><input id="tg-t-fin" type="date" value="${esc(t.fin || sumar(hoy, 7))}"></div>
      <div class="campo"><label for="tg-t-prioridad">Prioridad</label><select id="tg-t-prioridad">${Object.entries(D.prioridades).map(([k, v]) => `<option value="${k}"${(t.prioridad || 'media') === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
      <div class="campo"><label for="tg-t-proyecto">Proyecto (opcional)</label><select id="tg-t-proyecto"><option value="">Sin proyecto</option>${D.proyectos.map(p => `<option value="${Number(p.id)}"${p.id === t.proyecto_id ? ' selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></div>
      <div class="campo"><label for="tg-t-depende">Depende de (opcional)</label><select id="tg-t-depende"><option value="">De ninguna</option>${deps.map(x => `<option value="${Number(x.id)}"${x.id === t.depende_de ? ' selected' : ''}>${esc(x.titulo)}</option>`).join('')}</select></div>
      <div class="campo"><label class="diseno-campo-checkbox"><input type="checkbox" id="tg-t-hito"${t.es_hito ? ' checked' : ''}> Es un hito (un momento clave, sin duración)</label></div>
      </div><div class="campo"><label for="tg-t-desc">Descripción (opcional)</label><textarea id="tg-t-desc" rows="3" maxlength="4000">${esc(t.descripcion || '')}</textarea></div>
      <p class="ayuda">A la persona le sale en su Inicio y le llega por correo.</p>
      <div class="ant-acciones"><button type="button" class="btn btn-primario" data-tg="guardar-tarea">${t.id ? 'Guardar cambios' : 'Asignar tarea'}</button><button type="button" class="btn btn-outline" data-tg="cerrar-form">Cancelar</button></div></div>`;
  }

  // ---------- Detalle ----------
  async function abrir(id, sinScroll) {
    ABIERTA = id;
    let cont = $('tg-detalle'); if (!cont) { pintar(); return; }
    cont.innerHTML = '<p class="ayuda">Cargando…</p>';
    let t; try { t = await pedir('/tareas/' + id); } catch (err) { cont.innerHTML = `<p class="aviso-error-carga">${esc(err.message)}</p>`; return; }
    const abierta = ['pendiente', 'en_proceso'].includes(t.estado);
    const hist = t.historial.map(h => `<li><small>${esc(fecha(h.fecha))} ${esc(h.fecha.slice(11, 16))} · ${esc(h.quien)}</small><br>${h.archivo ? `<button type="button" class="enlace" data-tg="archivo" data-id="${Number(h.id)}">📎 ${esc(h.archivo.nombre)}</button>` : esc(h.texto)}</li>`).join('');
    const notas = (t.vencida ? ' · vencida' : '') + (t.depende ? ' · depende de «' + t.depende.titulo + '» (' + (D.estados[t.depende.estado] || t.depende.estado) + ')' : '');
    const tid = Number(t.id);
    const botones = (abierta && t.es_mia ? '<button type="button" class="btn btn-primario" data-tg="terminar" data-id="' + tid + '">✓ Marcar terminada</button>' : '')
      + (t.estado === 'por_revisar' && t.puede_mandar && !t.es_mia ? '<button type="button" class="btn btn-primario" data-tg="aceptar" data-id="' + tid + '">Aceptar</button><button type="button" class="btn btn-outline" data-tg="regresar" data-id="' + tid + '">Regresar</button>' : '')
      + (t.estado !== 'cancelada' ? '<label class="btn btn-outline btn-chico">📎 Adjuntar<input type="file" id="tg-archivo" data-id="' + tid + '" accept=".pdf,.jpg,.jpeg,.png" hidden></label>' : '')
      + '<button type="button" class="btn btn-outline btn-chico" data-tg="comentar" data-id="' + tid + '">💬 Comentar</button>'
      + (t.puede_mandar && !['terminada', 'cancelada'].includes(t.estado) ? '<button type="button" class="btn btn-outline btn-chico" data-tg="editar" data-id="' + tid + '">Cambiar</button><button type="button" class="enlace" data-tg="cancelar" data-id="' + tid + '">Cancelar tarea</button>' : '');
    cont.innerHTML = `<article class="ant-tarjeta tg-det${t.vencida ? ' ant-vencido' : ''}">
      <header><div><h3>${t.es_hito ? '◆ ' : ''}${esc(t.titulo)}</h3><p class="ayuda">${esc(t.proyecto || 'Sin proyecto')} · de ${esc(t.asigno)} para ${esc(t.asignado)} · ${esc(fecha(t.inicio))} a ${esc(fecha(t.fin))} · prioridad ${esc((D.prioridades[t.prioridad] || '').toLowerCase())}${esc(notas)}</p></div>
        <div><span class="estado-cxc ${t.vencida ? 'vencida' : t.estado === 'terminada' ? 'pagada' : 'parcial'}">${esc(D.estados[t.estado] || t.estado)} · ${Number(t.avance)} %</span> <button type="button" class="enlace" data-tg="cerrar-detalle">Cerrar ✕</button></div></header>
      ${t.descripcion ? `<p class="tg-desc">${esc(t.descripcion)}</p>` : ''}
      ${abierta && (t.es_mia || t.puede_mandar) ? `<div class="tg-avance"><label for="tg-avance">Avance: <b id="tg-avance-v">${Number(t.avance)} %</b></label><input type="range" id="tg-avance" min="0" max="99" step="5" value="${Math.min(99, Number(t.avance))}">
        <input id="tg-avance-c" maxlength="2000" placeholder="¿Qué se hizo? (opcional)"><button type="button" class="btn btn-secundario btn-chico" data-tg="avance" data-id="${Number(t.id)}">Guardar avance</button></div>` : ''}
      <div class="ant-acciones">${botones}
      </div>
      <h4>Historial</h4><ul class="tg-hist">${hist}</ul></article>`;
    $('tg-avance')?.addEventListener('input', e => { $('tg-avance-v').textContent = e.target.value + ' %'; });
    if (!sinScroll) cont.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function clic(e) {
    const b = e.target.closest('[data-tg]'); if (!b) return;
    const a = b.dataset.tg, id = Number(b.dataset.id) || 0;
    const hacer = async (fn, ok, refrescar = true) => { b.disabled = true; try { await fn(); if (ok) toast(ok); if (refrescar) await cargar(); } catch (err) { toast(err.message); } finally { b.disabled = false; } };
    if (a === 'pestana') { PEST = b.dataset.p; FILTRO_U = ''; ABIERTA = null; return cargar(); }
    if (a === 'abrir') { if (!$('tg-detalle')) { ABIERTA = id; pintar(); } else abrir(id); return; }
    if (a === 'cerrar-detalle') { ABIERTA = null; return pintar(); }
    if (a === 'nueva') { FORM = { tipo: 'tarea' }; return pintar(); }
    if (a === 'nuevo-proyecto') { FORM = { tipo: 'proyecto' }; return pintar(); }
    if (a === 'cerrar-form') { FORM = null; return pintar(); }
    if (a === 'editar') { const t = await pedir('/tareas/' + id).catch(err => { toast(err.message); }); if (t) { FORM = { tipo: 'tarea', tarea: t }; pintar(); $('tg-t-titulo')?.scrollIntoView({ block: 'center' }); } return; }
    if (a === 'guardar-proyecto') return hacer(async () => { await pedir('/tareas/proyectos', { method: 'POST', body: JSON.stringify({ nombre: $('tg-p-nombre').value, descripcion: $('tg-p-desc').value }) }); FORM = null; }, 'Proyecto creado');
    if (a === 'guardar-tarea') return hacer(async () => {
      const t = FORM.tarea, cuerpo = { titulo: $('tg-t-titulo').value, asignado_a: Number($('tg-t-asignado').value) || null, inicio: $('tg-t-inicio').value, fin: $('tg-t-fin').value, prioridad: $('tg-t-prioridad').value,
        proyecto_id: Number($('tg-t-proyecto').value) || null, depende_de: Number($('tg-t-depende').value) || null, es_hito: $('tg-t-hito').checked, descripcion: $('tg-t-desc').value };
      if (t) await pedir('/tareas/' + t.id, { method: 'PUT', body: JSON.stringify({ ...cuerpo, version: t.version }) });
      else await pedir('/tareas', { method: 'POST', body: JSON.stringify(cuerpo) });
      FORM = null;
    }, FORM?.tarea ? 'Tarea actualizada' : 'Tarea asignada');
    if (a === 'avance') return hacer(() => pedir('/tareas/' + id + '/avance', { method: 'POST', body: JSON.stringify({ avance: Number($('tg-avance').value), comentario: $('tg-avance-c').value }) }), 'Avance guardado');
    if (a === 'terminar') {
      const c = await solicitarDialogo({ titulo: 'Marcar terminada', mensaje: 'Le llega a quien te la asignó para que la revise.', aceptar: 'Marcar terminada', campo: { tipo: 'text', etiqueta: 'Comentario (opcional)' } });
      if (c === null || c === false) return;
      return hacer(() => pedir('/tareas/' + id + '/terminar', { method: 'POST', body: JSON.stringify({ comentario: typeof c === 'string' ? c : '' }) }), 'Tarea terminada');
    }
    if (a === 'aceptar') return hacer(() => pedir('/tareas/' + id + '/revisar', { method: 'POST', body: JSON.stringify({ acepta: true }) }), 'Tarea aceptada');
    if (a === 'regresar') {
      const c = await solicitarDialogo({ titulo: 'Regresar tarea', mensaje: 'Vuelve a quedar en proceso y le llega por correo lo que falta.', aceptar: 'Regresar', campo: { tipo: 'text', etiqueta: '¿Qué falta?', requerido: 'Escribe qué falta (mínimo 5 letras)' } });
      if (!c) return;
      return hacer(() => pedir('/tareas/' + id + '/revisar', { method: 'POST', body: JSON.stringify({ acepta: false, comentario: c }) }), 'Tarea regresada');
    }
    if (a === 'comentar') {
      const c = await solicitarDialogo({ titulo: 'Comentar', mensaje: 'Queda en el historial de la tarea.', aceptar: 'Guardar', campo: { tipo: 'text', etiqueta: 'Comentario', requerido: 'Escribe el comentario' } });
      if (!c) return;
      return hacer(() => pedir('/tareas/' + id + '/comentarios', { method: 'POST', body: JSON.stringify({ texto: c }) }), 'Comentario guardado');
    }
    if (a === 'cancelar') {
      const m = await solicitarDialogo({ titulo: 'Cancelar tarea', mensaje: 'No se borra: queda cancelada con el motivo.', aceptar: 'Cancelar tarea', campo: { tipo: 'text', etiqueta: 'Motivo', requerido: 'Escribe el motivo (mínimo 5 letras)' } });
      if (!m) return;
      return hacer(() => pedir('/tareas/' + id + '/cancelar', { method: 'POST', body: JSON.stringify({ motivo: m }) }), 'Tarea cancelada');
    }
    if (a === 'archivo') {
      try { const res = await api('/tareas/archivos/' + id); if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'No se pudo descargar'); const cd = res.headers.get('content-disposition') || ''; const nombre = decodeURIComponent((cd.match(/filename\*=UTF-8''([^;]+)/) || [])[1] || 'archivo'); saveAs(await res.blob(), nombre); }
      catch (err) { toast(err.message); }
    }
  }
  async function subirArchivo(input) {
    const f = input.files[0]; if (!f) return;
    try { const res = await api('/tareas/' + Number(input.dataset.id) + '/archivos', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Nombre': encodeURIComponent(f.name) }, body: f }); const j = await res.json().catch(() => ({})); if (!res.ok) throw new Error(j.error || 'No se pudo subir'); toast('Archivo subido'); await cargar(); }
    catch (err) { toast(err.message); }
    input.value = '';
  }

  // ---------- Inicio: «Mis tareas» (y lo de su equipo por revisar o vencido) hasta arriba ----------
  async function pintarInicio() {
    const cont = $('inicio-tareas-mias'); if (!cont) return;
    let r; try { r = await pedir('/tareas/avisos'); } catch { cont.innerHTML = ''; return; }
    cont.innerHTML = r.avisos.length ? `<div class="tg-inicio"><h3>📋 Tareas</h3>${r.avisos.slice(0, 8).map(a => `<button type="button" class="fila-alerta ${a.urgente ? 'vencido' : 'aviso'}" data-tg-inicio="${Number(a.id)}"><span class="info"><b>${esc(a.texto)}</b><span class="txt">${esc(a.detalle)}</span></span><span aria-hidden="true">›</span></button>`).join('')}${r.avisos.length > 8 ? `<button type="button" class="enlace" data-tg-inicio="0">Ver las ${r.avisos.length}</button>` : ''}</div>` : '';
  }
  $('inicio-tareas-mias')?.addEventListener('click', e => {
    const b = e.target.closest('[data-tg-inicio]'); if (!b) return;
    const id = Number(b.dataset.tgInicio); ABIERTA = id || null; PEST = 'mias'; cambiarVista('tareas');
  });

  return { cargar, pintarInicio };
})();
window.Tareas = Tareas;
