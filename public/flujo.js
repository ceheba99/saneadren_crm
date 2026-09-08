/* Identidad del contacto y contexto de cada operación comercial. */
const FlujoCRM = (() => {
  const $ = id => document.getElementById(id);
  const baselines = new Map();
  const campos = {
    'overlay-ficha':'#ed-direccion,#ed-canal,#ed-servicio,#ed-responsable,#ed-valor,#ed-fecha-servicio,#ed-notas',
    'overlay-ficha-cliente':'#fc-ed-telefono,#fc-ed-telefono-alterno,#fc-ed-nombre,#fc-ed-correo,#fc-ed-empresa,#fc-ed-rfc,#fc-ed-direccion,#fc-ed-giro,#fc-ed-notas-generales',
    'overlay-servicio-nuevo':'#sn-servicio,#sn-valor,#sn-fecha,#sn-notas,#sn-ubicacion',
    'overlay-generar-cotizacion':'#gc-items input,#gc-items select,#gc-items textarea,input[name="gc-formato"]'
  };
  const estado = s => ({abierto:'Cotización abierta',ganado:'Servicio contratado',perdido:'Cotización no aceptada'}[s]||s);
  const escapar = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const elementos = id => [...document.querySelectorAll(campos[id]||':not(*)')];
  const valores = id => elementos(id).map(e=>({value:e.value,checked:e.checked}));
  const dirty = id => baselines.has(id) && JSON.stringify(valores(id))!==JSON.stringify(baselines.get(id));
  function actualizarAviso(id) {
    const output = $({'overlay-ficha':'estado-guardado-registro','overlay-ficha-cliente':'estado-guardado-contacto','overlay-servicio-nuevo':'estado-guardado-nuevo'}[id]);
    if(output){output.textContent=dirty(id)?'Cambios sin guardar':id==='overlay-servicio-nuevo'?'Nuevo · todavía no registrado':'Sin cambios pendientes';output.classList.toggle('pendiente',dirty(id));}
  }
  function marcarGuardado(id){baselines.set(id,valores(id));actualizarAviso(id);}
  async function permitirCambio(id){
    if(!$(id)?.classList.contains('mostrar') || !dirty(id))return true;
    const ok=await solicitarDialogo({titulo:'Hay cambios sin guardar',mensaje:'Puedes volver para guardarlos, o descartar estos cambios y continuar.',aceptar:'Descartar cambios'});
    if(!ok)return false;
    const saved=baselines.get(id);elementos(id).forEach((e,i)=>{if(saved[i]){e.value=saved[i].value;if('checked' in e)e.checked=saved[i].checked;}});
    marcarGuardado(id);return true;
  }
  function presentarContacto(c){
    $('fc-titulo').textContent=c.nombre||c.telefono;
    const giroEtiqueta={residencial:'Residencial',comercial:'Comercial',industrial:'Industrial'}[c.giro]||'';
    $('contacto-identidad').innerHTML=`<div class="contacto-avatar" aria-hidden="true">${escapar((c.nombre||'C').slice(0,1).toUpperCase())}</div><div><span class="etiqueta-contacto">${c.servicios_ganados>0?'CLIENTE · YA HA CONTRATADO':'PROSPECTO · AÚN NO HA CONTRATADO'}</span>${giroEtiqueta?` <span class="etiqueta-contacto">${giroEtiqueta}</span>`:''}<h3>${escapar(c.nombre||'Sin nombre')}</h3><p>${escapar(c.empresa_contacto||'Contacto particular')} · ${escapar(c.telefono)}${c.correo?' · '+escapar(c.correo):''}</p><small>Contacto #${c.id} · Sus registros comerciales están separados de estos datos.</small></div>`;
    $('fc-meta').innerHTML=metaClienteHTML(c);
  }
  function presentarRegistro(lead,contacto){
    const contratado=lead.estatus==='ganado';
    const nombre=contratado?'servicio contratado':'cotización';
    $('registro-tipo').textContent='EDITAR '+nombre.toUpperCase()+' · REGISTRO EXISTENTE';
    $('ficha-titulo').textContent=`${contratado?'Servicio':'Cotización'} #${lead.id} · ${lead.servicio_nombre||'Servicio por definir'}`;
    $('registro-datos-titulo').textContent='Datos de este '+(contratado?'servicio':'registro de cotización');
    $('btn-guardar-ficha').textContent=contratado?'Guardar cambios del servicio':'Guardar cambios de la cotización';
    $('btn-eliminar-lead').textContent=contratado?'Eliminar este servicio':'Eliminar esta cotización';
    $('ed-estatus-actual').textContent=estado(lead.estatus);
    $('btn-generar-cotizacion').textContent='Exportar propuesta PDF / Word';
    $('ed-valor').closest('.campo-modal').querySelector('label').textContent=contratado?'Importe contratado (MXN)':'Importe propuesto (MXN)';
    $('ed-fecha-servicio').closest('.campo-modal').querySelector('label').textContent=contratado?'Fecha acordada del servicio':'Fecha propuesta / acordada';
    $('ed-notas').closest('.campo-modal').querySelector('label').textContent=contratado?'Notas de este servicio':'Notas de esta cotización';
    $('registro-etapas-titulo').closest('.modal-section').hidden=lead.estatus!=='abierto';
    const c=contacto||{id:lead.cliente_id,nombre:lead.nombre,telefono:lead.telefono,empresa_contacto:lead.empresa_contacto};
    $('registro-contacto').innerHTML=`<div><span class="flujo-kicker">CONTACTO ASOCIADO · SOLO CONSULTA</span><strong>${escapar(c.nombre||'Sin nombre')}</strong><span>${escapar(c.telefono||'')} ${c.empresa_contacto?'· '+escapar(c.empresa_contacto):''}</span></div>${c.id?`<button type="button" class="btn btn-outline" data-abrir-contacto="${Number(c.id)}">Ver / editar contacto #${Number(c.id)}</button>`:''}`;
  }
  async function nuevoRegistro(id,modo){
    if(!await permitirCambio('overlay-ficha-cliente') || !await permitirCambio('overlay-servicio-nuevo'))return;
    const c=await api('/clientes/'+id).then(r=>r.json());
    CLIENTE_DUP=c;
    // 'directo' (servicio ya contratado) necesita el importe desde el inicio, así que conserva
    // la ventana rápida. 'pipeline' (nueva cotización) ya no pasa por esa ventana: se crea el
    // registro de una vez y se completa directamente en su ficha, para no capturar el mismo
    // servicio/valor/notas dos veces en dos ventanas distintas.
    if(modo==='directo' || !c.direccion){abrirServicioNuevo(modo);return;}
    try{
      const creado=await api('/leads',{method:'POST',body:JSON.stringify({
        telefono:c.telefono,nombre:c.nombre,empresa_contacto:c.empresa_contacto,cliente_id:c.id,
        direccion:c.direccion,responsable_id:USUARIO_ACTUAL.id,creado_por:USUARIO_ACTUAL.nombre,forzar_duplicado:true
      })}).then(r=>r.json());
      toast('Nueva cotización creada. Completa el servicio y el importe aquí mismo.');
      cambiarVista('leads');
      await abrirFicha(creado.id);
      await ServiciosTabla.refrescar();
    }catch(err){toast('No se pudo crear la cotización: '+err.message);}
  }
  document.addEventListener('input',e=>{const id=e.target.closest('.overlay')?.id;if(campos[id])actualizarAviso(id);});
  document.addEventListener('change',e=>{const id=e.target.closest('.overlay')?.id;if(campos[id])actualizarAviso(id);});
  const cierresAutorizados=new WeakSet();
  document.addEventListener('click',async e=>{
    const contactBtn=e.target.closest('[data-abrir-contacto]');
    if(contactBtn){await abrirFichaCliente(Number(contactBtn.dataset.abrirContacto));return;}
    const close=e.target.closest('.close-btn');if(!close)return;
    const id=close.closest('.overlay')?.id;
    if(!campos[id] || !dirty(id) || cierresAutorizados.has(close))return;
    e.preventDefault();e.stopImmediatePropagation();
    if(await permitirCambio(id)){cierresAutorizados.add(close);close.click();cierresAutorizados.delete(close);}
  },true);
  window.addEventListener('beforeunload',e=>{if(Object.keys(campos).some(id=>$(id)?.classList.contains('mostrar') && dirty(id))){e.preventDefault();e.returnValue='';}});
  $('fc-tipo').addEventListener('change',()=>cargarClientes());
  $('btn-guardar-contacto-nuevo').addEventListener('click',async e=>{
    const btn=e.currentTarget;btn.disabled=true;
    try{
      const payload={nombre:$('in-nombre').value.trim(),telefono:$('in-telefono').value.trim(),empresa_contacto:$('in-empresa').value.trim(),direccion:$('in-direccion').value.trim(),correo:$('in-correo').value.trim(),giro:$('in-giro').value};
      const r=await api('/contactos',{method:'POST',body:JSON.stringify(payload)});const c=await r.json();
      if(r.status===409){toast('El contacto ya existe. Abrimos su ficha.');await abrirFichaCliente(c.cliente_id);return;}
      limpiarFormAlta();cambiarVista('clientes');await abrirFichaCliente(c.id);toast('Contacto creado. Todavía no tiene cotizaciones ni servicios.');
    }catch(err){toast(err.message);}finally{btn.disabled=false;}
  });
  return {estado,presentarContacto,presentarRegistro,nuevoRegistro,marcarGuardado,permitirCambio};
})();
