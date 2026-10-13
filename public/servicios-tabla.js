/* Tablas de servicios: presentación y filtros locales sobre datos del API existente. */
const ServiciosTabla = (() => {
  const estados = new Map();
  const nombres = {abierto:'Cotización abierta',ganado:'Servicio contratado',perdido:'Cotización no aceptada'};
  const escapar = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalizar = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const dia = value => /^\d{4}-\d{2}-\d{2}/.test(value || '') ? value.slice(0,10) : '';
  const fecha = value => {const d=dia(value);return d ? d.split('-').reverse().join('/') : 'Sin fecha';};
  // Cotizaciones y órdenes de servicio se separan con pestañas; la fecha que importa es la de
  // cada tipo (cotización: cuándo se cotizó; orden: fecha acordada del servicio).
  const esOrden = s => s.estatus === 'ganado';
  const folioDe = s => esOrden(s) ? folioOrdenServicio(s) : folioCotizacion(s);
  const fechaClave = s => esOrden(s) ? (s.fecha_servicio || dia(s.created_at)) : (s.fecha_cotizacion || dia(s.created_at));
  const VISTAS = { todos: 'Todos', cotizaciones: 'Cotizaciones', ordenes: 'Órdenes de servicio' };
  function filtrar(datos, f) {
    const q = normalizar(f.busqueda || '');
    return datos.filter(s => (f.vista === 'cotizaciones' ? !esOrden(s) : f.vista === 'ordenes' ? esOrden(s) : true)
      && (!q || normalizar([s.id, folioDe(s), s.servicio_nombre, s.responsable_nombre, s.notas_iniciales].join(' ')).includes(q)));
  }
  function ordenar(datos) { return [...datos].sort((x, y) => String(fechaClave(y)).localeCompare(String(fechaClave(x))) || y.id - x.id); }
  function inicial() { return { busqueda: '', vista: 'todos' }; }
  function render(id, datos, propietario, tipo) {
    let st = estados.get(id);
    const cont = document.getElementById(id);
    if (!st || st.propietario !== propietario) {
      st = { propietario, tipo, f: inicial(), datos: [] }; estados.set(id, st);
      cont.classList.add('servicios-tabla');
      const pestanas = Object.entries(VISTAS).map(([k, t]) => `<button type="button" role="tab" data-vista-st="${k}">${t} <span class="st-conteo"></span></button>`).join('');
      cont.innerHTML = `<div class="st-barra">
        <div class="st-pestanas" role="tablist" aria-label="Tipo de registro">${pestanas}</div>
        <input type="search" class="st-buscar" data-filtro="busqueda" aria-label="Buscar por folio o servicio" placeholder="Buscar folio o servicio">
      </div>
      <div class="servicios-resumen st-resumen" role="status" aria-live="polite"></div>
      <div class="st-scroll"><table class="st-tabla"><thead><tr><th scope="col">Folio</th><th scope="col">Servicio</th><th scope="col">Estado</th><th scope="col">Fecha</th><th scope="col" class="st-num">Importe</th><th scope="col">Atendió</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead><tbody></tbody></table></div>`;
      cont.querySelector('[data-filtro="busqueda"]').addEventListener('input', e => { st.f.busqueda = e.target.value; pintar(id); });
      cont.addEventListener('click', manejarClick);
    }
    st.datos = datos;
    pintar(id);
  }
  function estadoDe(s) {
    if (s.estatus === 'perdido') return ['perdido', 'Cotización no aceptada'];
    if (!esOrden(s)) return ['abierto', 'Cotización abierta'];
    const hoy = new Date().toISOString().slice(0, 10);
    return ['ganado', s.fecha_servicio && s.fecha_servicio > hoy ? 'Orden programada' : 'Orden de servicio'];
  }
  function filaHTML(s, st) {
    const [clase, etiqueta] = estadoDe(s);
    const actual = st.tipo === 'lead' && s.id === LEAD_ACTUAL?.id;
    const fechaTxt = esOrden(s) ? (s.fecha_servicio ? 'Servicio: ' + fecha(s.fecha_servicio) : 'Servicio sin fecha') : 'Cotizada: ' + fecha(s.fecha_cotizacion || s.created_at);
    const duplicar = esOrden(s) ? `<button type="button" class="btn btn-outline" data-accion="duplicar" data-id="${Number(s.id)}" title="Crea otra orden de servicio con los mismos datos (servicio recurrente)">Duplicar</button>` : '';
    return `<tr class="fila-${clase}${actual ? ' st-actual' : ''}" data-abrir-fila="${Number(s.id)}">
      <td class="st-folio" data-label="Folio">${escapar(folioDe(s))}${actual ? '<small>Abierto ahora</small>' : ''}</td>
      <td data-label="Servicio">${escapar(s.servicio_nombre || 'Servicio')}</td>
      <td data-label="Estado"><span class="tag-estatus ${clase}">${escapar(etiqueta)}</span></td>
      <td data-label="Fecha" class="st-fecha">${escapar(fechaTxt)}</td>
      <td data-label="Importe" class="st-num servicio-importe">${importeTarjeta(s)}${s.valor != null && !s.iva_modo ? '<small>IVA por definir</small>' : ''}</td>
      <td data-label="Atendió">${escapar(s.responsable_nombre || 'Sin asignar')}</td>
      <td class="st-acciones"><button type="button" class="btn btn-outline" data-accion="abrir" data-id="${Number(s.id)}">Abrir</button>${duplicar}<button type="button" class="btn-eliminar solo-admin" data-accion="eliminar" data-id="${Number(s.id)}" aria-label="Eliminar ${escapar(folioDe(s))}">Eliminar</button></td>
    </tr>`;
  }
  function pintar(id) {
    const st = estados.get(id), cont = document.getElementById(id);
    const n = { todos: st.datos.length, cotizaciones: st.datos.filter(x => !esOrden(x)).length, ordenes: st.datos.filter(esOrden).length };
    cont.querySelectorAll('[data-vista-st]').forEach(b => { const k = b.dataset.vistaSt; b.classList.toggle('activo', st.f.vista === k); b.setAttribute('aria-selected', String(st.f.vista === k)); b.querySelector('.st-conteo').textContent = n[k]; });
    const rows = ordenar(filtrar(st.datos, st.f));
    const abiertas = st.datos.filter(x => x.estatus === 'abierto').length;
    const contratado = st.datos.filter(esOrden).reduce((t, x) => t + (Number(x.valor) || 0), 0);
    cont.querySelector('.servicios-resumen').textContent = `${abiertas} cotización${abiertas === 1 ? '' : 'es'} abierta${abiertas === 1 ? '' : 's'} · ${n.ordenes} orden${n.ordenes === 1 ? '' : 'es'} de servicio · Contratado: ${formatoMoneda(contratado)} sin IVA`;
    const vacio = st.datos.length ? 'No hay registros con este filtro.' : 'Este contacto aún no tiene cotizaciones ni órdenes. Usa Crear cotización o Crear orden de servicio.';
    cont.querySelector('tbody').innerHTML = rows.length ? rows.map(s => filaHTML(s, st)).join('') : `<tr><td colspan="7" class="servicios-vacio">${vacio}</td></tr>`;
  }
  async function manejarClick(e) {
    const cont = e.currentTarget, st = estados.get(cont.id);
    const pestana = e.target.closest('[data-vista-st]');
    if (pestana) { st.f.vista = pestana.dataset.vistaSt; pintar(cont.id); return; }
    const btn = e.target.closest('button');
    // Tocar la fila (fuera de los botones) también abre el registro.
    const fila = !btn && e.target.closest('[data-abrir-fila]');
    if (fila) { await abrirFicha(Number(fila.dataset.abrirFila)); return; }
    if (!btn?.dataset.accion) return;
    const s = st.datos.find(x => x.id === Number(btn.dataset.id)); if (!s) return;
    btn.disabled = true;
    try {
      if (btn.dataset.accion === 'abrir') { await abrirFicha(s.id); return; }
      if (btn.dataset.accion === 'duplicar') { await duplicarRegistro(s.id); return; }
      if (btn.dataset.accion === 'eliminar') await eliminar(s);
    } catch (err) { toast('No se pudo completar: ' + err.message); }
    finally { btn.disabled = false; }
  }
  async function eliminar(s) {
    const confirmado=await solicitarDialogo({titulo:'Eliminar servicio',aceptar:'Eliminar servicio',mensaje:`¿Eliminar el servicio #${s.id}: ${s.servicio_nombre||'Servicio'}?\nRegistro: ${fecha(s.created_at)} · Importe: ${s.valor==null?'Sin importe':formatoMoneda(s.valor)}\n\nSe eliminarán esta solicitud, sus observaciones y sus alertas. No se puede deshacer. El contacto y sus demás servicios se conservarán.${s.estatus==='ganado'?'\nEl importe se descontará del total ganado. El contacto seguirá disponible en el directorio, aunque ya no tenga servicios contratados.':''}`});
    if(!confirmado)return;
    let r;
    try { r=await api('/leads/'+s.id,{method:'DELETE'}); } catch(err) { toast('No se pudo eliminar: '+err.message); return; }
    if(!r.ok){ const j=await r.json().catch(()=>({})); toast(j.error||'No se pudo eliminar'); return; }
    toast('Servicio eliminado');
    try {await refrescar(s.id);}catch(err){toast('Servicio eliminado, pero no se pudo actualizar la vista. Recarga la página.');}
  }
  async function refrescar(eliminado=null) {
    if(LEAD_ACTUAL?.id===eliminado){document.getElementById('overlay-ficha').classList.remove('mostrar');LEAD_ACTUAL=null;}
    if(LEAD_ACTUAL && document.getElementById('overlay-ficha').classList.contains('mostrar')) {
      const id=LEAD_ACTUAL.id;
      const lead=await api('/leads/'+id).then(r=>r.json());
      const cliente=lead.cliente_id?await api('/clientes/'+lead.cliente_id).then(r=>r.json()):null;
      if(LEAD_ACTUAL?.id===id){LEAD_ACTUAL={...lead,servicios_cliente:cliente?.servicios||[lead]};renderFichaMeta(lead);renderServiciosAnteriores();FlujoCRM.presentarRegistro(lead,cliente);ETAPA_FICHA=lead.etapa;actualizarPipeline();
        document.getElementById('ed-estatus-actual').textContent=FlujoCRM.estado(lead.estatus);
        actualizarBotonesEstatusFicha(lead);
      }
    }
    if(CLIENTE_ACTUAL && document.getElementById('overlay-ficha-cliente').classList.contains('mostrar')){
      const id=CLIENTE_ACTUAL.id;const c=await api('/clientes/'+id).then(r=>r.json());
      if(CLIENTE_ACTUAL?.id===id){CLIENTE_ACTUAL=c;document.getElementById('fc-meta').innerHTML=metaClienteHTML(c);renderServiciosCliente(c.servicios||[]);}
    }
    await cargarLeads();
    if(document.getElementById('vista-clientes').classList.contains('activa'))await cargarClientes();
    if(document.getElementById('vista-inicio').classList.contains('activa'))await cargarInicio();
    await actualizarBadgePendientes();
  }
  return {render,refrescar,eliminar,filtrar,ordenar,fecha,escapar};
})();
