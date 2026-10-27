/* Marketing · control del departamento y finanzas (fase 4, 2026-10-27). Ver server/marketing-control.js.
   Cuatro pestañas: Tablero (el mes de un vistazo), Plan y metas (objetivos del año y metas mensuales con lo real),
   Presupuesto y gastos (solo con «Dinero de Marketing»: presupuesto por rubro con su aprobación y los gastos internos)
   y Resultados (contactos, ventas, costo por contacto y retorno de cada campaña; sin montos para quien no ve el dinero). */
const ControlMk = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t == null ? '' : String(t));
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const hoyTxt = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  const nombreMes = p => { const [a, m] = p.split('-').map(Number); return MESES[m - 1] + ' ' + a; };
  const moverMes = (p, n) => { const [a, m] = p.split('-').map(Number); const d = new Date(Date.UTC(a, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const dinero = () => Permisos.puede('marketing.dinero');
  const pct = (real, meta, tope) => { if (meta == null || meta === '' || real == null) return null; if (tope) return real <= meta ? 100 : Math.round((meta / real) * 100); return meta > 0 ? Math.round((real / meta) * 100) : null; };
  const barra = (p, clase = '') => `<span class="py-barra ${clase}" role="progressbar" aria-valuenow="${Number(p) || 0}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.max(0, Math.min(100, Number(p) || 0))}%"></i></span>`;
  const num = v => (v == null ? '—' : Number(v).toLocaleString('es-MX'));
  // Monto con signo antes del símbolo: «-$600.00» (no «$-600.00»).
  const dinTxt = v => (Number(v) < 0 ? '-' + formatoMoneda(-Number(v)) : formatoMoneda(v));
  const fechaTxt = f => new Date(String(f).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  // Opciones de los estados de un objetivo, con el suyo elegido.
  const opcEstados = o => Object.entries(PLAN.estados_objetivo).map(([k, n]) => `<option value="${esc(k)}"${o.estado === k ? ' selected' : ''}>${esc(n)}</option>`).join('');
  // Casilla de un canal (ligado a una campaña: marcado y fijo).
  const casillaCanal = (c, ed) => `<label class="mk-red-op"><input type="checkbox" value="${Number(c.id)}" data-rs-mk${c.marcado || c.por_proyecto ? ' checked' : ''}${c.por_proyecto ? ' disabled title="Ligado a una campaña"' : ''}${ed ? '' : ' disabled'}> ${esc(c.nombre)}</label>`;
  async function pedir(ruta, body, method = 'GET') {
    const r = await api('/marketing' + ruta, body !== undefined ? { method, body: JSON.stringify(body) } : undefined);
    const d = await r.json().catch(() => ({})); if (!r.ok) throw Error(d.error || 'No se pudo completar'); return d;
  }
  let CTRL = null, MES_TB = null, ANIO_PL = null, MES_DN = null, PLAN = null, PRESUP = null, GASTOS = [], gastoActual = null, ocupado = false;
  async function control() { if (!CTRL) CTRL = await pedir('/control'); return CTRL; }
  function cargar(p) { if (p === 'tablero') return tablero(); if (p === 'plan') return plan(); if (p === 'dinero') return presupuestoYGastos(); if (p === 'resultados') return resultados(); }

  // =================== TABLERO ===================
  async function tablero() {
    MES_TB ||= hoyTxt().slice(0, 7); $('tb-mes').textContent = nombreMes(MES_TB);
    try {
      await control();
      const t = await pedir('/tablero?mes=' + MES_TB), p = t.publicaciones, est = p.por_estado;
      const card = (n, t2, sub = '', clase = '') => `<div class="rc-card ${clase}"><span class="rc-num">${n}</span><span class="rc-label">${esc(t2)}${sub ? '<br>' + sub : ''}</span></div>`;
      const metas = Object.entries(t.indicadores).map(([k, i]) => {
        const meta = t.metas[k], real = t.real[k], c = pct(real, meta, i.tope), esDin = i.dinero;
        const fmt = v => (v == null ? '—' : esDin ? formatoMoneda(v) : num(v));
        return `<div class="tb-meta"><div class="tb-meta-cab"><b>${esc(i.nombre)}</b><span>${fmt(real)} ${meta != null ? 'de ' + fmt(meta) : '· sin meta'}</span></div>${c != null ? barra(c, c >= 100 ? 'ok' : c < 50 ? 'mal' : '') : ''}</div>`;
      }).join('');
      const din = t.dinero_mes;
      $('tb-cuerpo').innerHTML = (t.avisos.length ? `<div class="tb-avisos">${t.avisos.map(a => `<p class="tb-aviso tb-${esc(a.tipo)}">${a.tipo === 'rojo' ? '⚠' : 'ℹ'} ${esc(a.texto)}</p>`).join('')}</div>` : '<p class="tb-aviso tb-ok">✔ Todo en orden este mes.</p>')
        + `<div class="rc-grid tb-tarjetas">${card(num(p.total), 'Publicaciones del mes')}${card(num(est.publicada || 0), 'Publicadas')}${card(p.cumplimiento == null ? '—' : p.cumplimiento + ' %', 'Cumplimiento del calendario', 'de lo que ya tocaba publicar', p.cumplimiento != null && p.cumplimiento < 80 ? 'tb-bajo' : '')}${card(num(t.atrasadas.length), 'Atrasadas', 'fecha pasada sin publicar', t.atrasadas.length ? 'tb-bajo' : '')}${card(num(est.revision || 0), 'Por aprobar')}</div>`
        + `<div class="tb-dos">`
        + `<section class="modal-section pl-caja"><div class="seccion-tit">🎯 Metas del mes</div>${metas || '<p class="util-45">Sin indicadores.</p>'}<button type="button" class="enlace" data-tb-ir="plan">Ver el plan del año →</button></section>`
        + (din ? `<section class="modal-section pl-caja"><div class="seccion-tit">💰 Presupuesto del mes</div><p class="ayuda">${din.presupuesto ? `Estado: <b>${esc(CTRL?.estados_presupuesto?.[din.estado] || din.estado)}</b>` : 'Sin presupuesto capturado'}</p>
            <div class="tb-meta"><div class="tb-meta-cab"><b>Gastado</b><span>${formatoMoneda(din.gastado)} de ${formatoMoneda(din.presupuesto)}</span></div>${din.presupuesto ? barra(Math.round((din.gastado / din.presupuesto) * 100), din.gastado > din.presupuesto ? 'mal' : '') : ''}</div>
            ${din.rubros.map(r => `<div class="tb-meta tb-rubro"><div class="tb-meta-cab"><span>${esc(r.nombre)}</span><span>${formatoMoneda(r.gastado)} / ${formatoMoneda(r.presupuesto)}</span></div>${r.presupuesto ? barra(Math.round((r.gastado / r.presupuesto) * 100), r.gastado > r.presupuesto ? 'mal' : '') : ''}</div>`).join('')}
            <button type="button" class="enlace" data-tb-ir="dinero">Ver presupuesto y gastos →</button></section>` : '')
        + `</div>`
        + `<div class="tb-dos"><section class="modal-section pl-caja"><div class="seccion-tit">👥 Carga de trabajo</div>${t.carga.length ? `<div class="tabla-scroll"><table class="pg-tabla"><thead><tr><th>Persona</th><th class="st-num">Publicaciones pendientes</th><th class="st-num">Tareas abiertas</th><th class="st-num">Vencen en 7 días</th><th class="st-num">Atrasadas</th></tr></thead><tbody>${t.carga.map(c => `<tr><td>${esc(c.nombre)}</td><td class="st-num">${Number(c.publicaciones)}</td><td class="st-num">${Number(c.tareas)}</td><td class="st-num">${Number(c.tareas_semana)}</td><td class="st-num ${c.tareas_atrasadas + c.publicaciones_atrasadas ? 'rojo' : ''}">${Number(c.tareas_atrasadas) + Number(c.publicaciones_atrasadas)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="util-45">Nadie tiene pendientes.</p>'}</section>`
        + `<section class="modal-section pl-caja"><div class="seccion-tit">📁 Proyectos activos</div>${t.proyectos.length ? t.proyectos.map(x => `<button type="button" class="tb-proy" data-tb-proy="${Number(x.id)}"><span><b>${esc(x.nombre)}</b><small>vence ${esc(fechaTxt(x.fin))}${x.atrasadas ? ` · <span class="rojo">${Number(x.atrasadas)} tarea(s) atrasada(s)</span>` : ''}</small></span><span class="tb-proy-av">${barra(x.avance)} ${Number(x.avance)} %</span></button>`).join('') : '<p class="util-45">Sin proyectos activos.</p>'}</section></div>`
        + `<div class="tb-dos"><section class="modal-section pl-caja"><div class="seccion-tit">⏰ Publicaciones atrasadas</div>${t.atrasadas.length ? `<ul class="tb-lista">${t.atrasadas.slice(0, 12).map(x => `<li><button type="button" class="enlace" data-tb-pub="${Number(x.id)}">${esc(x.titulo)}</button> · ${Marketing.redesHtml(x.redes)} ${esc(fechaTxt(x.fecha))} · <span class="mk-estado mk-e-${esc(x.estado)}">${esc(x.estado)}</span> · ${esc(x.responsable || '')}</li>`).join('')}</ul>` : '<p class="util-45">Nada atrasado. 🎉</p>'}</section>`
        + `<section class="modal-section pl-caja"><div class="seccion-tit">💡 Ideas y redes del mes</div><p>${['nueva', 'evaluacion', 'aprobada', 'realizada', 'descartada'].map(k => `<span class="id-estado id-e-${k}">${esc({ nueva: 'Nuevas', evaluacion: 'En evaluación', aprobada: 'Aprobadas', realizada: 'Realizadas', descartada: 'Descartadas' }[k])}: ${Number(t.ideas[k] || 0)}</span>`).join(' ')}</p>
            <p class="tb-redes">${Object.entries(p.por_red).map(([r, n]) => `<span>${Marketing.logo(r)} ${Number(n)}</span>`).join('') || '<span class="util-45">Sin publicaciones este mes.</span>'}</p></section></div>`;
    } catch (e) { $('tb-cuerpo').innerHTML = `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`; }
  }

  // =================== PLAN Y METAS ===================
  async function plan() {
    ANIO_PL ||= Number(hoyTxt().slice(0, 4)); $('pl-anio').textContent = String(ANIO_PL);
    try {
      PLAN = await pedir('/plan/' + ANIO_PL);
      const ed = PLAN.puede.editar, mesHoy = hoyTxt().slice(0, 7);
      $('pl-objetivos').innerHTML = PLAN.objetivos.length ? `<div class="pl-objs">${PLAN.objetivos.map(o => `<div class="pl-obj pl-o-${esc(o.estado)}" data-pl-obj="${Number(o.id)}"><div><b>${esc(o.titulo)}</b>${o.descripcion ? `<small>${esc(o.descripcion)}</small>` : ''}<small>Responsable: ${esc(o.responsable || '—')}</small></div>
          <select aria-label="Estado del objetivo" data-pl-estado${ed ? '' : ' disabled'}>${opcEstados(o)}</select></div>`).join('')}</div>`
        : '<p class="util-45">Aún no hay objetivos para este año.</p>';
      const ind = Object.entries(PLAN.indicadores);
      $('pl-metas').innerHTML = `<thead><tr><th>Indicador</th>${CORTOS.map((m, i) => `<th class="st-num${`${ANIO_PL}-${String(i + 1).padStart(2, '0')}` === mesHoy ? ' pl-hoy' : ''}">${m}</th>`).join('')}</tr></thead><tbody>${ind.map(([k, i]) => `<tr><th scope="row">${esc(i.nombre)}${i.tope ? '<small>es un tope: no pasarse</small>' : ''}</th>${CORTOS.map((_, n) => {
        const mes = n + 1, meta = PLAN.metas[mes]?.[k], real = PLAN.real[mes]?.[k], c = pct(real, meta, i.tope);
        return `<td class="pl-celda"><input type="number" min="0" step="${i.dinero ? '0.01' : '1'}" value="${meta ?? ''}" data-pl-meta="${mes}:${esc(k)}" aria-label="Meta de ${esc(i.nombre)} en ${MESES[n]}"${ed ? '' : ' disabled'}>${real != null ? `<small class="${c == null ? '' : c >= 100 ? 'ok' : c < 50 ? 'rojo' : ''}">${i.dinero ? formatoMoneda(real) : num(real)}${c != null ? ' · ' + c + ' %' : ''}</small>` : ''}</td>`;
      }).join('')}</tr>`).join('')}</tbody>`;
      $('pl-guardar').disabled = true;
    } catch (e) { $('pl-objetivos').innerHTML = `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`; $('pl-metas').innerHTML = ''; }
  }
  async function guardarMetas() {
    if (ocupado) return; ocupado = true; $('pl-guardar').disabled = true;
    try {
      const metas = {};
      for (const inp of document.querySelectorAll('#pl-metas [data-pl-meta]')) {
        const [mes, k] = inp.dataset.plMeta.split(':'), antes = PLAN.metas[mes]?.[k], v = inp.value === '' ? null : Number(inp.value);
        if ((antes ?? null) !== v) (metas[mes] ||= {})[k] = v;
      }
      if (!Object.keys(metas).length) { toast('No hay cambios'); return; }
      await pedir('/plan/' + ANIO_PL + '/metas', { metas }, 'PUT'); toast('Metas guardadas'); await plan();
    } catch (e) { toast(e.message); $('pl-guardar').disabled = false; } finally { ocupado = false; }
  }

  // =================== PRESUPUESTO Y GASTOS ===================
  async function presupuestoYGastos() {
    if (!dinero()) return;
    MES_DN ||= hoyTxt().slice(0, 7); $('dn-mes').textContent = nombreMes(MES_DN);
    await control();
    if (!$('dn-f-rubro').dataset.listo) { $('dn-f-rubro').innerHTML = '<option value="">Todos los rubros</option>' + Object.entries(CTRL.rubros).map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join(''); $('dn-f-rubro').dataset.listo = '1'; }
    await Promise.all([pintarPresupuesto(), pintarGastos()]);
  }
  async function pintarPresupuesto() {
    try {
      PRESUP = await pedir('/presupuestos/' + MES_DN);
      const e = PRESUP.estado, nuevo = PRESUP.nuevo;
      const quien = { borrador: 'En borrador: cuando esté listo, envíalo a Dirección.', enviado: 'Enviado a Dirección: falta que lo apruebe.', aprobado: `Aprobado por ${PRESUP.aprobado_por_nombre || '—'}.`, rechazado: 'Rechazado' + (PRESUP.motivo ? ': ' + PRESUP.motivo : '') + '. Corrígelo y vuelve a enviarlo.' }[e];
      $('dn-barra').innerHTML = `<div><span class="pr-estado dn-e-${esc(e)}">${esc(nuevo ? 'Sin presupuesto' : CTRL.estados_presupuesto[e])}</span> <span class="ayuda">${esc(nuevo ? 'Captura los montos por rubro y guárdalos.' : quien)}</span></div>`;
      $('dn-rubros').innerHTML = PRESUP.rubros.map(r => { const uso = r.presupuesto ? Math.round((r.gastado / r.presupuesto) * 100) : (r.gastado ? 100 : 0);
        return `<tr><td data-label="Rubro">${esc(r.nombre)}</td><td data-label="Presupuesto" class="st-num"><input type="number" min="0" step="0.01" value="${r.presupuesto || ''}" data-dn-rubro="${esc(r.rubro)}" aria-label="Presupuesto de ${esc(r.nombre)}" placeholder="0.00"></td>
          <td data-label="Gastado" class="st-num">${formatoMoneda(r.gastado)}</td><td data-label="Disponible" class="st-num ${r.disponible < 0 ? 'rojo' : ''}">${dinTxt(r.disponible)}</td><td data-label="Uso">${barra(uso, r.gastado > r.presupuesto ? 'mal' : '')} ${uso} %</td></tr>`; }).join('');
      $('dn-total').innerHTML = `<tr><th>Total</th><th class="st-num">${formatoMoneda(PRESUP.total)}</th><th class="st-num">${formatoMoneda(PRESUP.gastado)}</th><th class="st-num ${PRESUP.disponible < 0 ? 'rojo' : ''}">${dinTxt(PRESUP.disponible)}</th><th></th></tr>`;
      const b = ['<button type="button" class="btn btn-primario btn-chico" data-dn-accion="guardar" disabled>Guardar montos</button>'];
      if (!nuevo && ['borrador', 'rechazado'].includes(e)) b.push('<button type="button" class="btn btn-outline btn-chico" data-dn-accion="enviar">📨 Enviar a Dirección</button>');
      if (PRESUP.puede.aprobar && !nuevo && e !== 'aprobado') b.push('<button type="button" class="btn btn-primario btn-chico" data-dn-accion="aprobar">✅ Aprobar</button>');
      if (PRESUP.puede.aprobar && e === 'enviado') b.push('<button type="button" class="btn btn-outline btn-chico mk-btn-cancelar" data-dn-accion="rechazar">Rechazar</button>');
      $('dn-acciones').innerHTML = b.join('');
      $('dn-historial').innerHTML = PRESUP.historial.map(h => `<li><div class="pr-seg-cab"><b>${esc(h.usuario || '')}</b> · ${esc(fechaCorta(h.created_at))}</div><div>${esc(h.texto)}</div></li>`).join('') || '<li class="util-45">Sin movimientos.</li>';
    } catch (e) { $('dn-barra').innerHTML = `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`; }
  }
  async function accionPresupuesto(a) {
    if (ocupado) return;
    try {
      if (a === 'guardar') {
        const lineas = Object.fromEntries([...document.querySelectorAll('#dn-rubros [data-dn-rubro]')].map(i => [i.dataset.dnRubro, i.value === '' ? 0 : Number(i.value)]));
        ocupado = true; await pedir('/presupuestos/' + MES_DN, { lineas, version: PRESUP.nuevo ? undefined : PRESUP.version }, 'PUT'); toast('Presupuesto guardado');
      } else {
        if (document.querySelector('[data-dn-accion="guardar"]:not([disabled])')) { toast('Primero guarda los montos'); return; }
        const cuerpo = { accion: a, version: PRESUP.version };
        if (a === 'rechazar') { const m = await solicitarDialogo({ titulo: 'Rechazar presupuesto', mensaje: 'Le aparece al Gerente de marketing para que lo corrija.', aceptar: 'Rechazar', campo: { etiqueta: '¿Qué hay que cambiar?', requerido: 'Escribe el motivo' } }); if (!m) return; cuerpo.motivo = m; }
        ocupado = true; await pedir('/presupuestos/' + MES_DN + '/estado', cuerpo, 'POST'); toast({ enviar: 'Enviado a Dirección', aprobar: 'Presupuesto aprobado', rechazar: 'Presupuesto rechazado' }[a]);
      }
      await pintarPresupuesto();
    } catch (e) { toast(e.message); } finally { ocupado = false; }
  }
  async function pintarGastos() {
    try {
      const desde = MES_DN + '-01', [a, m] = MES_DN.split('-').map(Number), hasta = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
      const q = new URLSearchParams({ desde, hasta, rubro: $('dn-f-rubro').value, q: $('dn-buscar').value.trim(), cancelados: $('dn-f-cancelados').checked ? '1' : '' });
      const d = await pedir('/gastos?' + q); GASTOS = d.gastos;
      $('dn-gastos').innerHTML = GASTOS.length ? GASTOS.map(g => `<tr data-dn-gasto="${Number(g.id)}"${g.cancelado ? ' class="dn-cancelado"' : ''}><td data-label="Fecha">${esc(fechaTxt(g.fecha))}</td><td data-label="Concepto"><b>${esc(g.concepto)}</b><small class="contacto-relacion">${esc([g.proveedor, g.factura && 'Factura ' + g.factura].filter(Boolean).join(' · '))}${g.cancelado ? ' · Cancelado: ' + esc(g.motivo_cancelacion || '') : ''}</small></td>
          <td data-label="Rubro">${esc(CTRL.rubros[g.rubro] || g.rubro)}</td><td data-label="Red / proyecto">${g.red ? Marketing.logo(g.red) : ''} ${esc(g.proyecto_nombre || '')}</td><td data-label="Monto" class="st-num">${formatoMoneda(g.monto)}</td>
          <td class="fc-acciones">${g.tiene_comprobante ? `<button type="button" class="btn btn-outline btn-chico" data-dn-comp="${Number(g.id)}" title="Descargar comprobante">📎</button>` : ''}<button type="button" class="btn btn-outline btn-chico">Abrir</button></td></tr>`).join('')
        : '<tr><td colspan="6" class="util-37">Sin gastos este mes.</td></tr>';
      $('dn-gastos-total').textContent = GASTOS.filter(g => !g.cancelado).length + ' gasto(s) · total ' + formatoMoneda(d.total);
    } catch (e) { $('dn-gastos').innerHTML = `<tr><td colspan="6" class="aviso-error-carga">${esc(e.message)}</td></tr>`; }
  }
  async function abrirGasto(id) {
    await control();
    const cat = await Marketing.catalogos();
    gastoActual = id ? GASTOS.find(g => g.id === Number(id)) : null;
    const g = gastoActual || { fecha: hoyTxt(), monto: '', concepto: '', rubro: 'pauta', proveedor: '', red: '', proyecto_id: '', factura: '', notas: '' };
    $('gm-rubro').innerHTML = Object.entries(CTRL.rubros).map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join('');
    $('gm-red').innerHTML = '<option value="">Ninguna</option>' + Object.entries(cat.redes).map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join('');
    $('gm-proyecto').innerHTML = '<option value="">Ninguno</option>' + cat.proyectos.map(p => `<option value="${Number(p.id)}">${esc(p.nombre)}</option>`).join('');
    if (g.proyecto_id && !cat.proyectos.some(p => p.id === g.proyecto_id)) $('gm-proyecto').insertAdjacentHTML('beforeend', `<option value="${Number(g.proyecto_id)}">${esc(g.proyecto_nombre || 'Proyecto')}</option>`);
    for (const [k, idc] of [['fecha', 'gm-fecha'], ['monto', 'gm-monto'], ['concepto', 'gm-concepto'], ['rubro', 'gm-rubro'], ['proveedor', 'gm-proveedor'], ['red', 'gm-red'], ['proyecto_id', 'gm-proyecto'], ['factura', 'gm-factura'], ['notas', 'gm-notas']]) $(idc).value = g[k] ?? '';
    $('gm-fecha').max = hoyTxt(); $('gm-comprobante').value = '';
    $('gm-comp-actual').textContent = gastoActual?.tiene_comprobante ? 'Ya tiene comprobante: subir otro lo reemplaza.' : '';
    $('gm-titulo').textContent = gastoActual ? gastoActual.concepto : 'Registrar gasto';
    $('gm-kicker').textContent = gastoActual ? 'GASTO #' + gastoActual.id + ' · ' + (gastoActual.registrado_por_nombre || '') : 'GASTO DE MARKETING';
    $('gm-cancelado').hidden = !gastoActual?.cancelado; $('gm-cancelado').textContent = gastoActual?.cancelado ? `Cancelado por ${gastoActual.cancelado_por_nombre || '—'}: ${gastoActual.motivo_cancelacion || ''}` : '';
    $('gm-cancelar').hidden = !gastoActual || !!gastoActual.cancelado; $('gm-guardar').hidden = !!gastoActual?.cancelado;
    document.querySelectorAll('#gm-form input, #gm-form select, #gm-form textarea').forEach(x => { x.disabled = !!gastoActual?.cancelado; });
    $('gm-aviso').textContent = '';
    abrirVentana('overlay-gasto-mk');
  }
  async function guardarGasto() {
    if (ocupado) return; ocupado = true; $('gm-guardar').disabled = true;
    try {
      const cuerpo = { fecha: $('gm-fecha').value, monto: $('gm-monto').value === '' ? 0 : Number($('gm-monto').value), concepto: $('gm-concepto').value, rubro: $('gm-rubro').value, proveedor: $('gm-proveedor').value,
        red: $('gm-red').value || null, proyecto_id: Number($('gm-proyecto').value) || null, factura: $('gm-factura').value, notas: $('gm-notas').value };
      let g = gastoActual ? await pedir('/gastos/' + gastoActual.id, { ...cuerpo, version: gastoActual.version }, 'PUT') : await pedir('/gastos', cuerpo, 'POST');
      const f = $('gm-comprobante').files[0];
      if (f) {
        if (f.size > 10 * 1024 * 1024) toast('El comprobante pasa de 10 MB: no se subió');
        else { const r = await api('/marketing/gastos/' + g.id + '/comprobante', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Nombre': encodeURIComponent(f.name) }, body: f }); const d = await r.json().catch(() => ({})); if (!r.ok) toast(d.error || 'No se pudo subir el comprobante'); else g = d; }
      }
      toast(gastoActual ? 'Gasto actualizado' : 'Gasto registrado'); $('overlay-gasto-mk').classList.remove('mostrar');
      await Promise.all([pintarGastos(), pintarPresupuesto()]);
    } catch (e) { toast(e.message); $('gm-aviso').textContent = e.message; } finally { ocupado = false; $('gm-guardar').disabled = false; }
  }
  async function cancelarGasto() {
    if (!gastoActual || ocupado) return;
    const m = await solicitarDialogo({ titulo: 'Cancelar gasto', mensaje: 'Deja de sumar en el presupuesto; queda registrado quién lo canceló y por qué.', aceptar: 'Cancelar gasto', campo: { etiqueta: '¿Por qué se cancela?', requerido: 'Escribe el motivo' } });
    if (!m) return;
    ocupado = true;
    try { await pedir('/gastos/' + gastoActual.id + '/cancelar', { motivo: m }, 'POST'); toast('Gasto cancelado'); $('overlay-gasto-mk').classList.remove('mostrar'); await Promise.all([pintarGastos(), pintarPresupuesto()]); }
    catch (e) { toast(e.message); } finally { ocupado = false; }
  }
  async function descargarComprobante(id) {
    try { const r = await api('/marketing/gastos/' + Number(id) + '/comprobante'); const g = GASTOS.find(x => x.id === Number(id)); const u = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = u; a.download = g?.comprobante_nombre || 'comprobante'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 5000); }
    catch (e) { toast(e.message); }
  }

  // =================== RESULTADOS ===================
  function rango(tipo) {
    const h = hoyTxt(), a = h.slice(0, 4);
    if (tipo === 'mes') return [h.slice(0, 7) + '-01', h];
    if (tipo === 'trimestre') { const d = new Date(h + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 3); return [d.toISOString().slice(0, 10), h]; }
    return [a + '-01-01', h];
  }
  async function resultados() {
    if (!$('rs-desde').value) [$('rs-desde').value, $('rs-hasta').value] = rango('trimestre');
    try {
      const r = await pedir('/resultados?' + new URLSearchParams({ desde: $('rs-desde').value, hasta: $('rs-hasta').value })), t = r.totales, din = r.dinero;
      const card = (n, txt, clase = '') => `<div class="rc-card ${clase}"><span class="rc-num">${n}</span><span class="rc-label">${esc(txt)}</span></div>`;
      const ret = v => (v == null ? '—' : `<span class="${v >= 0 ? 'ok' : 'rojo'}">${v > 0 ? '+' : ''}${v} %</span>`);
      const ed = Permisos.puede('marketing.editar');
      const casillas = r.canales.map(c => casillaCanal(c, ed)).join('');
      const opcCanal = p => '<option value="">Sin canal</option>' + r.canales.map(c => `<option value="${Number(c.id)}"${c.id === p.canal_id ? ' selected' : ''}>${esc(c.nombre)}</option>`).join('');
      $('rs-cuerpo').innerHTML = `<div class="rc-grid tb-tarjetas">${card(num(t.contactos), 'Contactos de canales de marketing')}${card(num(t.cotizaciones), 'Cotizaciones')}${card(num(t.ventas), 'Ventas')}${card(t.conversion == null ? '—' : t.conversion + ' %', 'Conversión (ventas / contactos)')}
          ${din ? card(formatoMoneda(t.gasto), 'Gastado') + card(formatoMoneda(t.vendido), 'Vendido (sin IVA)') + card(t.costo_contacto == null ? '—' : formatoMoneda(t.costo_contacto), 'Costo por contacto') + card(t.retorno == null ? '—' : (t.retorno > 0 ? '+' : '') + t.retorno + ' %', 'Retorno', t.retorno != null && t.retorno < 0 ? 'tb-bajo' : '') : ''}</div>
        ${din ? '' : '<p class="ayuda">Los montos (gasto, ventas, costo por contacto y retorno) los ven Dirección y el Gerente de marketing.</p>'}
        <section class="modal-section pl-caja"><div class="seccion-tit">📣 Por campaña (proyecto)</div>
          <div class="tabla-scroll"><table class="tabla-clientes"><thead><tr><th>Campaña</th><th>Canal que mide</th><th class="st-num">Contactos</th><th class="st-num">Cotizaciones</th><th class="st-num">Ventas</th><th class="st-num">Conversión</th>${din ? '<th class="st-num">Gasto</th><th class="st-num">Vendido</th><th class="st-num">Costo por contacto</th><th class="st-num">Retorno</th>' : ''}</tr></thead>
          <tbody>${r.proyectos.length ? r.proyectos.map(p => `<tr><td data-label="Campaña"><button type="button" class="enlace" data-rs-proy="${Number(p.id)}">${esc(p.nombre)}</button><small class="celda-sub">medido del ${esc(fechaTxt(p.ventana.desde))} al ${esc(fechaTxt(p.ventana.hasta))}</small></td>
              <td data-label="Canal"><select data-rs-canal="${Number(p.id)}" aria-label="Canal de la campaña"${ed ? '' : ' disabled'}>${opcCanal(p)}</select></td>
              <td data-label="Contactos" class="st-num">${num(p.contactos)}</td><td data-label="Cotizaciones" class="st-num">${num(p.cotizaciones)}</td><td data-label="Ventas" class="st-num">${num(p.ventas)}</td><td data-label="Conversión" class="st-num">${p.conversion == null ? '—' : p.conversion + ' %'}</td>
              ${din ? `<td data-label="Gasto" class="st-num">${formatoMoneda(p.gasto)}</td><td data-label="Vendido" class="st-num">${formatoMoneda(p.vendido)}</td><td data-label="Costo por contacto" class="st-num">${p.costo_contacto == null ? '—' : formatoMoneda(p.costo_contacto)}</td><td data-label="Retorno" class="st-num">${ret(p.retorno)}</td>` : ''}</tr>`).join('')
            : `<tr><td colspan="${din ? 10 : 6}" class="util-37">Sin campañas en estas fechas.</td></tr>`}</tbody></table></div>
          <p class="ayuda">Liga cada campaña al canal de «¿Cómo se enteró?» que la mide (por ejemplo, un canal «Campaña lluvias 2026»).</p></section>
        <div class="tb-dos"><section class="modal-section pl-caja"><div class="seccion-tit">📡 Por canal de marketing</div>${r.por_canal.length ? `<div class="tabla-scroll"><table class="pg-tabla"><thead><tr><th>Canal</th><th class="st-num">Contactos</th><th class="st-num">Cotizaciones</th><th class="st-num">Ventas</th>${din ? '<th class="st-num">Vendido</th>' : ''}</tr></thead><tbody>${r.por_canal.map(c => `<tr><td>${esc(c.canal)}</td><td class="st-num">${num(c.contactos)}</td><td class="st-num">${num(c.cotizaciones)}</td><td class="st-num">${num(c.ventas)}</td>${din ? `<td class="st-num">${formatoMoneda(c.vendido)}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<p class="util-45">Marca abajo qué canales son de marketing.</p>'}</section>
          ${din ? `<section class="modal-section pl-caja"><div class="seccion-tit">💸 En qué se gastó</div>${r.por_rubro.length ? r.por_rubro.map(x => `<div class="tb-meta tb-rubro"><div class="tb-meta-cab"><span>${esc(x.nombre)}</span><span>${formatoMoneda(x.gasto)}</span></div>${barra(t.gasto ? Math.round((x.gasto / t.gasto) * 100) : 0)}</div>`).join('') : '<p class="util-45">Sin gastos en estas fechas.</p>'}
            ${r.por_red.length ? `<p class="tb-redes">${r.por_red.map(x => `<span>${Marketing.logo(x.red)} ${formatoMoneda(x.gasto)}</span>`).join('')}</p>` : ''}</section>` : ''}</div>
        <section class="modal-section pl-caja"><div class="seccion-tit">⚙️ Canales que cuentan como de marketing</div><p class="ayuda">Además de los ligados a una campaña. Sirven para el resumen por canal y para las metas de contactos, cotizaciones y ventas.</p>
          <div class="rs-canales">${casillas}</div>
          ${ed ? '<div class="btn-group"><button type="button" class="btn btn-outline btn-chico" id="rs-guardar-canales">Guardar canales</button></div>' : ''}</section>`;
    } catch (e) { $('rs-cuerpo').innerHTML = `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`; }
  }

  // =================== Eventos ===================
  $('tb-ant').onclick = () => { MES_TB = moverMes(MES_TB, -1); tablero(); }; $('tb-sig').onclick = () => { MES_TB = moverMes(MES_TB, 1); tablero(); };
  $('tb-cuerpo').addEventListener('click', e => {
    const ir = e.target.closest('[data-tb-ir]'); if (ir) return Marketing.pestana(ir.dataset.tbIr);
    const p = e.target.closest('[data-tb-proy]'); if (p) return ProyectosMk.abrir(Number(p.dataset.tbProy));
    const pub = e.target.closest('[data-tb-pub]'); if (pub) Marketing.abrir(Number(pub.dataset.tbPub));
  });
  $('pl-ant').onclick = () => { ANIO_PL--; plan(); }; $('pl-sig').onclick = () => { ANIO_PL++; plan(); };
  $('pl-metas').addEventListener('input', () => { $('pl-guardar').disabled = false; });
  $('pl-guardar').onclick = guardarMetas;
  $('pl-nuevo-obj').onclick = async () => {
    const t = await solicitarDialogo({ titulo: 'Nuevo objetivo de ' + ANIO_PL, mensaje: 'Algo medible: «Duplicar seguidores en TikTok», «40 contactos por campaña».', aceptar: 'Agregar', campo: { etiqueta: 'Objetivo', requerido: 'Escribe el objetivo' } });
    if (!t) return;
    try { await pedir('/plan/' + ANIO_PL + '/objetivos', { titulo: t }, 'POST'); toast('Objetivo agregado'); plan(); } catch (e) { toast(e.message); }
  };
  $('pl-objetivos').addEventListener('change', async e => {
    const sel = e.target.closest('[data-pl-estado]'); if (!sel) return;
    const id = Number(sel.closest('[data-pl-obj]').dataset.plObj), o = PLAN.objetivos.find(x => x.id === id);
    try { await pedir('/objetivos/' + id, { estado: sel.value, version: o.version }, 'PUT'); toast('Objetivo actualizado'); plan(); } catch (err) { toast(err.message); plan(); }
  });
  $('dn-ant').onclick = () => { MES_DN = moverMes(MES_DN, -1); presupuestoYGastos(); }; $('dn-sig').onclick = () => { MES_DN = moverMes(MES_DN, 1); presupuestoYGastos(); };
  $('dn-rubros').addEventListener('input', () => { const b = document.querySelector('[data-dn-accion="guardar"]'); if (b) b.disabled = false; });
  $('dn-acciones').addEventListener('click', e => { const b = e.target.closest('[data-dn-accion]'); if (b) accionPresupuesto(b.dataset.dnAccion); });
  $('dn-nuevo').onclick = () => abrirGasto(null);
  $('dn-gastos').addEventListener('click', e => { const c = e.target.closest('[data-dn-comp]'); if (c) return descargarComprobante(c.dataset.dnComp); const tr = e.target.closest('[data-dn-gasto]'); if (tr) abrirGasto(tr.dataset.dnGasto); });
  $('dn-buscar').oninput = debounce(pintarGastos, 350); $('dn-f-rubro').onchange = pintarGastos; $('dn-f-cancelados').onchange = pintarGastos;
  $('dn-exportar').onclick = () => {
    const l = GASTOS.filter(g => !g.cancelado); if (!l.length) return toast('No hay gastos para exportar');
    descargarCSV('gastos-marketing-' + MES_DN + '.csv', [{ titulo: 'Fecha', valor: g => g.fecha }, { titulo: 'Concepto', valor: g => g.concepto }, { titulo: 'Rubro', valor: g => CTRL.rubros[g.rubro] || g.rubro }, { titulo: 'Proveedor', valor: g => g.proveedor },
      { titulo: 'Factura', valor: g => g.factura }, { titulo: 'Red', valor: g => g.red || '' }, { titulo: 'Proyecto', valor: g => g.proyecto_nombre || '' }, { titulo: 'Monto (MXN)', valor: g => g.monto }, { titulo: 'Registró', valor: g => g.registrado_por_nombre || '' }], l);
  };
  $('gm-guardar').onclick = guardarGasto; $('gm-cancelar').onclick = cancelarGasto;
  $('gm-cerrar').onclick = () => $('overlay-gasto-mk').classList.remove('mostrar');
  document.querySelectorAll('[data-rs-rango]').forEach(b => b.addEventListener('click', () => { [$('rs-desde').value, $('rs-hasta').value] = rango(b.dataset.rsRango); resultados(); }));
  $('rs-desde').onchange = resultados; $('rs-hasta').onchange = resultados;
  $('rs-cuerpo').addEventListener('change', async e => {
    const s = e.target.closest('[data-rs-canal]'); if (!s) return;
    try { await pedir('/proyectos/' + Number(s.dataset.rsCanal) + '/canal', { canal_id: Number(s.value) || null }, 'PUT'); toast('Canal de la campaña guardado'); resultados(); } catch (err) { toast(err.message); }
  });
  $('rs-cuerpo').addEventListener('click', async e => {
    const p = e.target.closest('[data-rs-proy]'); if (p) return ProyectosMk.abrir(Number(p.dataset.rsProy));
    if (e.target.id === 'rs-guardar-canales') {
      const ids = [...document.querySelectorAll('#rs-cuerpo [data-rs-mk]:checked:not(:disabled)')].map(i => Number(i.value));
      try { await pedir('/canales', { canales: ids }, 'PUT'); toast('Canales de marketing guardados'); resultados(); } catch (err) { toast(err.message); }
    }
  });
  return { cargar };
})();
window.ControlMk = ControlMk;
