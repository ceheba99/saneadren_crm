/* Avisos (2026-11-11, pedido de Dirección). Servidor: server/avisos.js.
   · Pantalla «Avisos» (permiso «Publicar avisos»): escribir un aviso, elegir las personas una por una (con buscador y
     «marcar las que se ven»), mandarlo también por correo o WhatsApp, y ver quién ya tocó «Enterado», cuándo y dónde.
   · Inicio: a cada usuario le salen arriba los avisos que le mandaron hasta que toca «Enterado». */
const Avisos = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t);
  const fecha = f => (f ? String(f).slice(0, 16).replace(/^(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1') : '');
  async function pedir(ruta, opciones) {
    const r = await api(ruta, opciones), j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'No se pudo');
    return j;
  }
  const ESTADO = { enviado: '✔ enviado', sin_correo: 'sin correo', sin_telefono: 'sin celular', error: '✖ no salió', pendiente: 'enviando…', sin_configurar: 'correo sin configurar' };

  // ---------- Inicio: mis avisos ----------
  async function pintarInicio() {
    const caja = $('inicio-avisos-mios'); if (!caja) return;
    let d; try { d = await pedir('/avisos-mios'); } catch { caja.innerHTML = ''; return; }
    caja.innerHTML = d.avisos.map(a => `<div class="av-inicio${a.urgente ? ' urgente' : ''}"><div><b>📢 ${a.urgente ? 'URGENTE · ' : ''}${esc(a.titulo)}</b><p>${esc(a.texto)}</p>
      <small>De ${esc(a.de || '')} · ${esc(fecha(a.created_at))}</small></div><button type="button" class="btn btn-primario" data-av-enterado="${Number(a.id)}">✔ Enterado</button></div>`).join('');
  }
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-av-enterado]'); if (!b) return;
    b.disabled = true;
    try { await pedir('/avisos-mios/' + Number(b.dataset.avEnterado) + '/enterado', { method: 'POST' }); toast('Aviso marcado como leído'); pintarInicio(); }
    catch (err) { b.disabled = false; toast(err.message); }
  });

  // ---------- Pantalla Avisos ----------
  let personas = [], canales = {}, elegidos = new Set();
  async function cargar() {
    const c = $('av-cuerpo');
    Repintado.cargando(c, '', '<p class="ayuda" role="status">Cargando…</p>');
    let l; try { l = await pedir('/avisos'); } catch (e) { Repintado.falla(c, e, cargar, `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`); return; }
    Repintado.pintar(c, `<div class="filtros"><button type="button" class="btn btn-primario" id="av-nuevo">📢 Nuevo aviso</button></div>
      ${l.avisos.length ? `<div class="tabla-scroll"><table class="tabla-resumen"><thead><tr><th>Publicado</th><th>Aviso</th><th>Leído</th><th>Por</th><th>Estado</th><th></th></tr></thead><tbody>
      ${l.avisos.map(a => `<tr><td>${esc(fecha(a.created_at))}</td><td><b>${a.urgente ? '⚠️ ' : ''}${esc(a.titulo)}</b></td><td><b>${esc(a.leidos)}</b> de ${esc(a.total)}</td><td>${esc(a.creado_por_nombre || '')}</td>
        <td>${a.retirado_at ? 'Retirado' : a.vigente ? 'Vigente' + (a.vence ? ' hasta ' + esc(fecha(a.vence)) : '') : 'Venció'}</td><td><button type="button" class="btn-link" data-av-ver="${Number(a.id)}">Ver quién lo leyó</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="ayuda">Todavía no hay avisos publicados.</p>'}`);
  }
  async function nuevo() {
    let d; try { d = await pedir('/avisos/destinatarios'); } catch (e) { toast(e.message); return; }
    personas = d.personas; canales = d; elegidos = new Set();
    $('av-ventana-titulo').textContent = 'Nuevo aviso';
    $('av-ventana-cuerpo').innerHTML = `<div class="modal-section">
      <div class="campo-modal"><label for="av-titulo">Título</label><input id="av-titulo" maxlength="120" placeholder="Ej. Junta general el viernes"></div>
      <div class="campo-modal"><label for="av-texto">Aviso</label><textarea id="av-texto" rows="5" maxlength="2000" placeholder="Escribe lo que quieres que sepan"></textarea></div>
      <div class="form-grid-2"><div class="campo-modal"><label for="av-vence">Se deja de mostrar después del (opcional)</label><input type="date" id="av-vence"></div>
      <label class="av-check"><input type="checkbox" id="av-urgente"> ⚠️ Urgente (sale en rojo y primero)</label></div>
      <label class="av-check"><input type="checkbox" id="av-correo"${d.correo ? '' : ' disabled'}> ✉️ Mandarlo también por correo${d.correo ? '' : ' <small class="pe-cuenta">(el correo del sistema no está configurado)</small>'}</label>
      <label class="av-check"><input type="checkbox" id="av-whatsapp"${d.whatsapp ? '' : ' disabled'}> 💬 Mandarlo también por WhatsApp${d.whatsapp ? '' : ' <small class="pe-cuenta">(todavía no está listo: falta la plantilla aprobada en Meta)</small>'}</label>
    </div><div class="modal-section"><h3 class="pe-sub">¿A quién? <span id="av-cuantos" class="pe-cuenta"></span></h3>
      <div class="filtros"><input id="av-buscar" placeholder="Buscar por nombre, puesto o sucursal" aria-label="Buscar personas"><button type="button" class="btn btn-outline" id="av-todos">Marcar los que se ven</button><button type="button" class="btn btn-outline" id="av-ninguno">Quitar todos</button></div>
      <div id="av-lista" class="av-lista"></div>
    </div><div class="modal-section"><div class="btn-group"><button type="button" class="btn btn-primario" id="av-publicar">📢 Publicar</button></div></div>`;
    pintarLista();
    abrirVentana('overlay-avisos');
  }
  const visibles = () => { const q = ($('av-buscar')?.value || '').trim().toLowerCase(); return personas.filter(p => !q || [p.nombre, p.detalle].some(v => String(v || '').toLowerCase().includes(q))); };
  function pintarLista() {
    const l = visibles();
    $('av-lista').innerHTML = l.length ? l.map(p => `<label class="av-persona"><input type="checkbox" data-av-p="${esc(p.clave)}"${elegidos.has(p.clave) ? ' checked' : ''}>
      <span><b>${esc(p.nombre)}</b><small>${esc(p.detalle)} · lo ve en: ${esc(p.donde.join(' y ') || 'correo o WhatsApp')}${p.correo ? ' · ✉️' : ''}${p.whatsapp ? ' · 💬' : ''}</small></span></label>`).join('') : '<p class="ayuda">Nadie coincide con la búsqueda.</p>';
    $('av-cuantos').textContent = elegidos.size ? `(${elegidos.size} elegida${elegidos.size === 1 ? '' : 's'})` : '';
  }
  async function publicar(b) {
    const cuerpo = { titulo: $('av-titulo').value, texto: $('av-texto').value, vence: $('av-vence').value || null, urgente: $('av-urgente').checked, correo: $('av-correo').checked, whatsapp: $('av-whatsapp').checked, destinatarios: [...elegidos] };
    if (!elegidos.size) return toast('Elige al menos a una persona');
    if (!await solicitarDialogo({ titulo: 'Publicar el aviso', mensaje: `Lo verán ${elegidos.size} persona(s) hasta que toquen «Enterado»${cuerpo.correo ? ', y les llegará por correo' : ''}${cuerpo.whatsapp ? ', y por WhatsApp' : ''}. Un aviso publicado no se cambia: si te equivocas, retíralo y publica otro.`, aceptar: 'Publicar' })) return;
    b.disabled = true;
    try { const r = await pedir('/avisos', { method: 'POST', body: JSON.stringify(cuerpo) }); toast(`Aviso publicado para ${r.destinatarios} persona(s)`); $('overlay-avisos').classList.remove('mostrar'); cargar(); }
    catch (e) { toast(e.message); b.disabled = false; }
  }
  async function ver(id) {
    let d; try { d = await pedir('/avisos/' + Number(id)); } catch (e) { toast(e.message); return; }
    const a = d.aviso;
    $('av-ventana-titulo').textContent = a.titulo;
    $('av-ventana-cuerpo').innerHTML = `<div class="modal-section"><p class="av-texto">${esc(a.texto)}</p>
      <p class="ayuda">Publicado el ${esc(fecha(a.created_at))} por ${esc(a.creado_por_nombre || '')}${a.vence ? ' · se muestra hasta el ' + esc(fecha(a.vence)) : ''}${a.retirado_at ? ` · <b>retirado</b> el ${esc(fecha(a.retirado_at))} por ${esc(a.retirado_por_nombre || '')}` : ''}.</p>
      <p><b>${esc(a.leidos)} de ${esc(a.total)}</b> ya tocaron «Enterado».</p></div>
      <div class="modal-section"><div class="tabla-scroll"><table class="tabla-resumen"><thead><tr><th>Persona</th><th>Enterado</th><th>Dónde</th>${a.por_correo ? '<th>Correo</th>' : ''}${a.por_whatsapp ? '<th>WhatsApp</th>' : ''}</tr></thead><tbody>
      ${d.destinatarios.map(x => `<tr><td>${esc(x.nombre)}</td><td>${x.enterado_at ? '✔ ' + esc(fecha(x.enterado_at)) : '<span class="as-rojo">Todavía no</span>'}</td><td>${esc(x.enterado_en || '')}</td>
        ${a.por_correo ? `<td>${esc(ESTADO[x.correo_estado] || '—')}</td>` : ''}${a.por_whatsapp ? `<td>${esc(ESTADO[x.whatsapp_estado] || (x.personal_id ? '—' : 'no aplica'))}</td>` : ''}</tr>`).join('')}</tbody></table></div></div>
      ${a.vigente ? `<div class="modal-section"><div class="btn-group"><button type="button" class="btn btn-outline" data-av-retirar="${Number(a.id)}">Retirar el aviso</button></div><p class="ayuda">Al retirarlo deja de mostrarse. No se borra: queda quién lo leyó.</p></div>` : ''}`;
    abrirVentana('overlay-avisos');
  }
  $('av-ventana-cuerpo')?.addEventListener('input', e => { if (e.target.id === 'av-buscar') pintarLista(); });
  $('av-ventana-cuerpo')?.addEventListener('change', e => {
    const k = e.target.dataset?.avP; if (!k) return;
    if (e.target.checked) elegidos.add(k); else elegidos.delete(k);
    $('av-cuantos').textContent = elegidos.size ? `(${elegidos.size} elegida${elegidos.size === 1 ? '' : 's'})` : '';
  });
  $('av-ventana-cuerpo')?.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'av-todos') { visibles().forEach(p => elegidos.add(p.clave)); pintarLista(); }
    else if (b.id === 'av-ninguno') { elegidos.clear(); pintarLista(); }
    else if (b.id === 'av-publicar') publicar(b);
    else if (b.dataset.avRetirar) {
      if (!await solicitarDialogo({ titulo: 'Retirar el aviso', mensaje: 'Deja de mostrarse a quien no lo ha leído. No se borra: queda en el historial con quién lo leyó.', aceptar: 'Retirar' })) return;
      try { await pedir('/avisos/' + Number(b.dataset.avRetirar) + '/retirar', { method: 'POST' }); toast('Aviso retirado'); $('overlay-avisos').classList.remove('mostrar'); cargar(); } catch (err) { toast(err.message); }
    }
  });
  $('av-cuerpo')?.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'av-nuevo') nuevo();
    else if (b.dataset.avVer) ver(b.dataset.avVer);
  });
  $('av-cerrar')?.addEventListener('click', () => $('overlay-avisos').classList.remove('mostrar'));
  return { cargar, pintarInicio };
})();
