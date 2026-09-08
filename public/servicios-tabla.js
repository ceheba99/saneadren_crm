/* Tablas de servicios: presentación y filtros locales sobre datos del API existente. */
const ServiciosTabla = (() => {
  const estados = new Map();
  const nombres = {abierto:'Cotización abierta',ganado:'Servicio contratado',perdido:'Cotización no aceptada'};
  const escapar = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalizar = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const dia = value => /^\d{4}-\d{2}-\d{2}/.test(value || '') ? value.slice(0,10) : '';
  const fecha = value => {const d=dia(value);return d ? d.split('-').reverse().join('/') : 'Sin fecha';};
  function filtrar(datos,f) {
    if(f.desde && f.hasta && f.desde>f.hasta) return [];
    return datos.filter(s=>{
      const d=dia(s[f.fecha]);
      return (!f.estatus || s.estatus===f.estatus) && (!f.busqueda || normalizar([s.id,s.servicio_nombre,s.responsable_nombre,s.notas_iniciales].join(' ')).includes(normalizar(f.busqueda))) && (!f.desde || (d && d>=f.desde)) && (!f.hasta || (d && d<=f.hasta));
    });
  }
  function ordenar(datos,col,dir) {
    return [...datos].sort((a,b)=>{
      let x=a[col],y=b[col];
      if(x==null || x==='') return y==null || y==='' ? a.id-b.id : 1;
      if(y==null || y==='') return -1;
      const cmp = ['id','valor'].includes(col) ? Number(x)-Number(y) : String(x).localeCompare(String(y),'es',{numeric:true});
      return cmp*dir || a.id-b.id;
    });
  }
  function inicial(tipo) {return {busqueda:'',estatus:'',fecha:'created_at',desde:'',hasta:''};}
  const columnas=[['id','ID'],['servicio_nombre','Servicio'],['estatus','Estatus'],['valor','Importe (MXN)'],['created_at','Registro'],['fecha_servicio','Fecha del servicio'],['responsable_nombre','Responsable']];
  function render(id,datos,propietario,tipo) {
    let st=estados.get(id);
    const cont=document.getElementById(id);
    if(!st || st.propietario!==propietario) {
      st={propietario,tipo,f:inicial(tipo),col:'created_at',dir:-1,datos:[]}; estados.set(id,st);
      cont.classList.add('servicios-tabla');
      cont.innerHTML=`<div class="servicios-filtros">
        <label class="servicios-busqueda">Buscar servicio<input type="search" data-filtro="busqueda" placeholder="Servicio, ID, responsable o notas"></label>
        <label>Estatus<select data-filtro="estatus"><option value="">Todos</option><option value="abierto">Cotizaciones abiertas</option><option value="ganado">Servicios contratados</option><option value="perdido">Cotizaciones no aceptadas</option></select></label>
        <label>Filtrar por<select data-filtro="fecha"><option value="created_at">Fecha de registro</option><option value="fecha_servicio">Fecha del servicio</option></select></label>
        <label>Desde<input type="date" data-filtro="desde"></label><label>Hasta<input type="date" data-filtro="hasta"></label>
        <button type="button" class="btn btn-outline" data-limpiar>Limpiar filtros</button>
      </div><p class="servicios-error" role="alert" hidden></p>
      <p class="ayuda">Haz clic en un encabezado para ordenar. Las fechas Desde y Hasta se incluyen. Los servicios sin fecha se excluyen al filtrar por un periodo.</p>
      <div class="servicios-resumen" role="status" aria-live="polite"></div>
      <div class="servicios-scroll" tabindex="0" role="region" aria-label="Tabla de servicios con desplazamiento horizontal">
        <table class="tabla-servicios"><caption>Historial comercial del contacto</caption><thead><tr>${columnas.map(([key,label])=>`<th scope="col" data-col="${key}" aria-sort="none"><button type="button" data-orden="${key}">${label}<span aria-hidden="true"></span></button></th>`).join('')}<th scope="col">Notas</th><th scope="col">Acciones</th></tr></thead><tbody></tbody></table>
      </div>`;
      cont.querySelectorAll('[data-filtro]').forEach(el=>{el.setAttribute('aria-label',{busqueda:'Buscar servicio',estatus:'Estatus',fecha:'Filtrar por',desde:'Desde',hasta:'Hasta'}[el.dataset.filtro]);el.value=st.f[el.dataset.filtro];el.addEventListener(el.type==='search'?'input':'change',()=>{st.f[el.dataset.filtro]=el.value;pintar(id);});});
      cont.addEventListener('click', manejarClick);
    }
    st.datos=datos;
    pintar(id);
  }
  function pintar(id) {
    const st=estados.get(id),cont=document.getElementById(id);
    const error=!!(st.f.desde && st.f.hasta && st.f.desde>st.f.hasta);
    const aviso=cont.querySelector('.servicios-error');aviso.hidden=!error;aviso.textContent=error?'La fecha Desde no puede ser posterior a Hasta. Corrige el periodo.':'';
    const rows=ordenar(filtrar(st.datos,st.f),st.col,st.dir);
    const total=rows.reduce((sum,s)=>sum+(Number(s.valor)||0),0);
    const sinImporte=rows.filter(s=>s.valor==null).length;
    cont.querySelector('.servicios-resumen').textContent=`${rows.length} de ${st.datos.length} registros · Total filtrado: ${formatoMoneda(total)}${sinImporte ? ` · ${sinImporte} sin importe` : ''}`;
    cont.querySelectorAll('[data-col]').forEach(th=>{const actual=th.dataset.col===st.col;th.setAttribute('aria-sort',actual?(st.dir===1?'ascending':'descending'):'none');th.querySelector('span').textContent=actual?(st.dir===1?' ↑':' ↓'):' ↕';});
    cont.querySelector('tbody').innerHTML=rows.length ? rows.map(s=>`<tr>
      <td>#${Number(s.id)}</td><td class="servicio-nombre">${escapar(s.servicio_nombre||'Servicio')}${st.tipo==='lead' && s.id===LEAD_ACTUAL?.id?'<small>Ficha actual</small>':''}</td>
      <td><span class="tag-estatus ${Object.hasOwn(nombres,s.estatus)?s.estatus:'abierto'}">${escapar(nombres[s.estatus]||s.estatus)}</span></td>
      <td class="servicio-importe">${s.valor==null?'Sin importe':formatoMoneda(s.valor)}</td><td>${fecha(s.created_at)}</td><td>${fecha(s.fecha_servicio)}</td>
      <td>${escapar(s.responsable_nombre||'Sin asignar')}</td><td class="servicio-notas">${escapar(s.notas_iniciales||'—')}</td>
      <td><div class="servicios-acciones"><button type="button" class="btn btn-outline" data-accion="abrir" data-id="${Number(s.id)}" aria-label="Abrir ${s.estatus==='ganado'?'servicio':'cotización'} ${Number(s.id)}">${s.estatus==='ganado'?'Ver servicio':'Ver cotización'}</button>
      <button type="button" class="btn btn-eliminar" data-accion="eliminar" data-id="${Number(s.id)}" aria-label="Eliminar servicio ${Number(s.id)}">Eliminar</button></div></td>
    </tr>`).join('') : `<tr><td colspan="9" class="servicios-vacio">${error?'Corrige las fechas para consultar servicios.':st.datos.length?'No hay servicios con estos filtros. Puedes seleccionar Todos o limpiar los filtros.':'Este contacto aún no tiene cotizaciones ni servicios registrados.'}</td></tr>`;
  }
  async function manejarClick(e) {
    const cont=e.currentTarget,st=estados.get(cont.id),btn=e.target.closest('button');if(!btn)return;
    if(btn.hasAttribute('data-limpiar')){st.f={...inicial(st.tipo),estatus:''};cont.querySelectorAll('[data-filtro]').forEach(el=>el.value=st.f[el.dataset.filtro]);pintar(cont.id);return;}
    if(btn.dataset.orden){const col=btn.dataset.orden;st.dir=st.col===col?-st.dir:1;st.col=col;pintar(cont.id);return;}
    if(!btn.dataset.accion)return;
    const s=st.datos.find(s=>s.id===Number(btn.dataset.id));if(!s)return;
    btn.disabled=true;
    try {
      if(btn.dataset.accion==='abrir'){await abrirFicha(s.id);return;}
      if(btn.dataset.accion==='eliminar') await eliminar(s);
      else await cambiarEstatusServicio(s.id,btn.dataset.accion);
    } catch(err){toast('No se pudo completar: '+err.message);}
    finally{btn.disabled=false;}
  }
  async function eliminar(s) {
    const confirmado=await solicitarDialogo({titulo:'Eliminar servicio',aceptar:'Eliminar servicio',mensaje:`¿Eliminar el servicio #${s.id}: ${s.servicio_nombre||'Servicio'}?\nRegistro: ${fecha(s.created_at)} · Importe: ${s.valor==null?'Sin importe':formatoMoneda(s.valor)}\n\nSe eliminarán esta solicitud, sus observaciones y sus alertas. No se puede deshacer. El contacto y sus demás servicios se conservarán.${s.estatus==='ganado'?'\nEl importe se descontará del total ganado. El contacto seguirá disponible en el directorio, aunque ya no tenga servicios contratados.':''}`});
    if(!confirmado)return;
    await api('/leads/'+s.id,{method:'DELETE'});
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
        ['btn-convertir-cliente','btn-marcar-perdido'].forEach(id=>document.getElementById(id).style.display=lead.estatus==='abierto'?'inline-flex':'none');
        document.getElementById('btn-reabrir').style.display=lead.estatus==='abierto'?'none':'inline-flex';
      }
    }
    if(CLIENTE_ACTUAL && document.getElementById('overlay-ficha-cliente').classList.contains('mostrar')){
      const id=CLIENTE_ACTUAL.id;const c=await api('/clientes/'+id).then(r=>r.json());
      if(CLIENTE_ACTUAL?.id===id){CLIENTE_ACTUAL=c;document.getElementById('fc-meta').innerHTML=metaClienteHTML(c);renderServiciosCliente(c.servicios||[]);}
    }
    await cargarLeads();
    if(document.getElementById('vista-clientes').classList.contains('activa'))await cargarClientes();
    if(document.getElementById('vista-pendientes').classList.contains('activa'))await cargarPendientes();
    await actualizarBadgePendientes();
  }
  return {render,refrescar,eliminar,filtrar,ordenar,fecha,escapar};
})();
