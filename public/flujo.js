/* Identidad del contacto y contexto de cada operación comercial. */
const FlujoCRM = (() => {
  const $ = id => document.getElementById(id);
  const baselines = new Map();
  const listasGuardadas = new Map();
  const campos = {
    'overlay-ficha':'#gc-items input,#gc-items select,#gc-items textarea,#ed-direccion,#ed-canal,#ed-servicio,#ed-responsable,#ed-valor,#ed-fecha-servicio,#ed-notas',
    'overlay-ficha-cliente':'#fc-ed-telefono,#fc-ed-telefono-alterno,#fc-ed-nombre,#fc-ed-correo,#fc-ed-empresa,#fc-ed-rfc,#fc-ed-direccion,#fc-ed-giro,#fc-ed-notas-generales',
    'overlay-servicio-nuevo':'#gc-items input,#gc-items select,#gc-items textarea,#sn-servicio,#sn-valor,#sn-fecha,#sn-notas,#sn-ubicacion',

  };
  const estado = s => ({abierto:'Cotización abierta',ganado:'Servicio contratado',perdido:'Cotización no aceptada'}[s]||s);
  const escapar = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const elementos = id => [...$(id).querySelectorAll(campos[id]||':not(*)')];
  const valores = id => elementos(id).map(e=>({value:e.value,checked:e.checked}));
  const dirty = id => baselines.has(id) && JSON.stringify(valores(id))!==JSON.stringify(baselines.get(id));
  function actualizarAviso(id) {
    const output = $({'overlay-ficha':'estado-guardado-registro','overlay-ficha-cliente':'estado-guardado-contacto','overlay-servicio-nuevo':'estado-guardado-nuevo'}[id]);
    if(output){output.textContent=dirty(id)?'Cambios sin guardar':id==='overlay-servicio-nuevo'?'Nuevo · todavía no registrado':'Sin cambios pendientes';output.classList.toggle('pendiente',dirty(id));}
  }
  function marcarGuardado(id){baselines.set(id,valores(id));const lista=$(id).querySelector('#gc-items');if(lista)listasGuardadas.set(id,lista.innerHTML);actualizarAviso(id);}
  async function permitirCambio(id){
    if(!$(id)?.classList.contains('mostrar') || !dirty(id))return true;
    const ok=await solicitarDialogo({titulo:'Hay cambios sin guardar',mensaje:'Puedes volver para guardarlos, o descartar estos cambios y continuar.',aceptar:'Descartar cambios'});
    if(!ok)return false;
    const lista=$(id).querySelector('#gc-items');if(lista && listasGuardadas.has(id))lista.innerHTML=listasGuardadas.get(id);
    const saved=baselines.get(id);elementos(id).forEach((e,i)=>{if(saved[i]){e.value=saved[i].value;if('checked' in e)e.checked=saved[i].checked;}});
    if(lista){actualizarTotalCotizacion();sincronizarEditor();}
    marcarGuardado(id);return true;
  }
  function presentarContacto(c){
    $('fc-titulo').textContent=c.nombre||c.telefono;
    const giroEtiqueta=(CATALOGOS.tipos||[]).find(t=>t.clave===c.giro)?.nombre||'';
    $('contacto-identidad').innerHTML=`<div class="contacto-avatar" aria-hidden="true">${escapar((c.nombre||'C').slice(0,1).toUpperCase())}</div><div><span class="etiqueta-contacto">${c.servicios_ganados>0?'CLIENTE · YA HA CONTRATADO':'PROSPECTO · AÚN NO HA CONTRATADO'}</span>${giroEtiqueta?` <span class="etiqueta-contacto">${escapar(giroEtiqueta)}</span>`:''}<h3>${escapar(c.nombre||'Sin nombre')}</h3><p>${escapar(c.empresa_contacto||'Contacto particular')} · ${escapar(c.telefono)}${c.correo?' · '+escapar(c.correo):''}</p><small>Contacto #${c.id} · Sus registros comerciales están separados de estos datos.</small></div>`;
    $('fc-meta').innerHTML=metaClienteHTML(c);
    const origen=CATALOGOS.canales.find(x=>Number(x.id)===Number(c.canal_origen_id));
    $('contacto-identidad').insertAdjacentHTML('beforeend',`<p>Cómo se enteró: <b>${escapar(origen?.nombre || 'Sin registrar')}</b></p>`);
  }
  function presentarRegistro(lead,contacto){
    const contratado=lead.estatus==='ganado';
    const nombre=contratado?'servicio contratado':'cotización';
    const icono=contratado?'🟢':'🔵';
    $('registro-tipo').innerHTML=`<span class="tag-estatus ${escapar(lead.estatus)}">${icono} ${escapar(estado(lead.estatus))}</span> · EDITAR ${nombre.toUpperCase()} · REGISTRO EXISTENTE`;
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
    if(!await permitirCambio('overlay-ficha') || !await permitirCambio('overlay-ficha-cliente') || !await permitirCambio('overlay-servicio-nuevo'))return;
    try { CLIENTE_DUP=await api('/clientes/'+id).then(r=>r.json()); $('overlay-ficha').classList.remove('mostrar'); abrirServicioNuevo(modo); }
    catch(err){toast('No se pudo abrir el contacto: '+err.message);}
  }
  document.addEventListener('click',e=>{if(e.target.closest('#btn-gc-agregar-servicio,.gc-quitar')){const id=e.target.closest('.overlay')?.id;if(campos[id])setTimeout(()=>actualizarAviso(id),0);}},true);
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
  async function crearContacto(cotizar=false){
    const botones=[$('btn-guardar-contacto-nuevo'),$('btn-guardar-lead')];
    if(botones.some(b=>b.disabled))return;
    const payload={canal_origen_id:$('in-origen').value,nombre:$('in-nombre').value.trim(),telefono:$('in-telefono').value.trim(),empresa_contacto:$('in-empresa').value.trim(),direccion:$('in-direccion').value.trim(),correo:$('in-correo').value.trim(),giro:$('in-giro').value};
    if(payload.telefono.replace(/\D/g,'').length<10){toast('Escribe un teléfono de 10 dígitos');$('in-telefono').focus();return;}
    if(!payload.nombre){toast('Escribe el nombre del contacto');$('in-nombre').focus();return;}
    if(!$('in-correo').checkValidity()){$('in-correo').reportValidity();return;}
    if(!payload.canal_origen_id){toast('Selecciona cómo se enteró de nosotros');$('in-origen').focus();return;}
    botones.forEach(b=>b.disabled=true);
    try{
      const r=await api('/contactos',{method:'POST',body:JSON.stringify(payload)});const c=await r.json();
      const id=r.status===409?c.cliente_id:c.id;
      if(r.status===409)toast('Usaremos el contacto existente; sus datos se conservan.');
      else toast('Contacto guardado.');
      limpiarFormAlta();cambiarVista('clientes');await abrirFichaCliente(id);
      if(cotizar)await nuevoRegistro(id,'pipeline');
    }catch(err){toast(err.message);}finally{botones.forEach(b=>b.disabled=false);}
  }
  $('btn-guardar-contacto-nuevo').addEventListener('click',()=>crearContacto(false));
  return {crearContacto,estado,presentarContacto,presentarRegistro,nuevoRegistro,marcarGuardado,permitirCambio};
})();
