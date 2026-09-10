const Prospeccion=(()=>{
  const $=id=>document.getElementById(id),esc=escaparHtml;
  const estados={investigar:'Por investigar',pendiente:'Pendiente de contactar',contactado:'Contactado',interesado:'Interesado',no_contactar:'No contactar'};
  const campos=['nombre','sector_id','zona','direccion','telefono','correo','persona','cargo','fuente','necesidades','estado','responsable_id','proximo_contacto'];
  let sectores=[],usuarios=[],actual=null,base='',filas=[],ocupado=false,consulta=0;
  const datos=()=>Object.fromEntries(campos.map(k=>[k,$('pr-'+k).value]));
  const pendiente=()=>base!==JSON.stringify(datos());
  async function pedir(ruta,body,method='GET'){const r=await api('/prospeccion'+ruta,body?{method,body:JSON.stringify(body)}:undefined);const d=await r.json();if(!r.ok){const e=Error(d.error||'No se pudo completar la operación');e.datos=d;throw e;}return d;}
  const opciones=(lista,valor,nombre)=>lista.map(x=>`<option value="${esc(x[valor])}">${esc(x[nombre])}</option>`).join('');
  async function catalogos(){[sectores,usuarios]=await Promise.all([pedir('/sectores'),api('/usuarios').then(r=>r.json())]);
    for(const id of ['pr-sector_id','pr-f-sector']){const previo=$(id).value;$(id).innerHTML='<option value="">'+(id==='pr-f-sector'?'Todos los sectores':'Selecciona sector')+'</option>'+opciones(sectores,'id','nombre');$(id).value=previo;}
    for(const id of ['pr-responsable_id','pr-f-responsable']){const previo=$(id).value;$(id).innerHTML='<option value="">'+(id==='pr-f-responsable'?'Todos los responsables':'Selecciona responsable')+'</option>'+opciones(usuarios,'id','nombre');$(id).value=previo;}
    $('pr-admin').hidden=USUARIO_ACTUAL?.rol!=='admin';
    $('pr-sectores').innerHTML=sectores.map(s=>`<div class="servicio-row"><input aria-label="Nombre del sector" id="pr-sector-${s.id}" value="${esc(s.nombre)}" maxlength="80"><button class="btn btn-outline" data-sector="${s.id}">Guardar nombre</button></div>`).join('');
  }
  async function cargar(){const turno=++consulta;try{await catalogos();const q=new URLSearchParams({q:$('pr-buscar').value,sector_id:$('pr-f-sector').value,estado:$('pr-f-estado').value,responsable_id:$('pr-f-responsable').value,pendientes:$('pr-vencidos').checked?'1':''});const respuesta=await pedir('?'+q);if(turno!==consulta)return;filas=respuesta;render();}catch(e){$('pr-resumen').textContent='No se pudo cargar prospección: '+e.message;}}
  function render(){const faltan=filas.filter(e=>!e.telefono).length;$('pr-resumen').textContent=`${filas.length} establecimientos · ${faltan} sin teléfono · ${filas.filter(e=>e.cliente_id).length} vinculados al CRM`+(filas.length===2000?' · Límite de 2000: acota los filtros.':'');
    $('pr-tabla').innerHTML=filas.map(e=>`<tr><td>${esc(e.nombre)}</td><td>${esc(e.sector)}<br>${esc(e.zona)}</td><td>${esc(e.persona||'Por identificar')}<br>${esc(e.telefono||'Sin teléfono')}</td><td>${estados[e.estado]}</td><td>${esc(e.responsable)}</td><td>${esc(e.proximo_contacto||'Sin programar')}</td><td>${esc(e.cliente_nombre||'Sin vincular')}</td><td><button class="btn btn-outline" data-establecimiento="${e.id}">Abrir</button></td></tr>`).join('')||'<tr><td colspan="8">No hay establecimientos con estos filtros.</td></tr>';
  }
  async function abrir(id){try{if($('overlay-prospeccion').classList.contains('mostrar')&&!await permitirSalida())return;actual=id?await pedir('/'+id):null;await catalogos();campos.forEach(k=>$('pr-'+k).value=actual?.[k]??'');if(!actual){$('pr-estado').value='investigar';$('pr-responsable_id').value=USUARIO_ACTUAL.id;}if(actual&&!usuarios.some(u=>u.id===actual.responsable_id)){$('pr-responsable_id').insertAdjacentHTML('beforeend',`<option value="${actual.responsable_id}">${esc(actual.responsable)} (inactivo; reasignar)</option>`);$('pr-responsable_id').value=actual.responsable_id;}
    $('pr-titulo').textContent=actual?'Editar establecimiento #'+actual.id:'Registrar establecimiento';base=JSON.stringify(datos());aviso();abrirVentana('overlay-prospeccion');}catch(e){toast(e.message);}}
  function aviso(){$('pr-aviso').textContent=pendiente()?'Cambios sin guardar':actual?'Datos guardados':'Nuevo · aún no guardado';}
  async function permitirSalida(){return !pendiente()||await solicitarDialogo({titulo:'Cambios sin guardar',mensaje:'¿Descartar los cambios del establecimiento?',aceptar:'Descartar cambios'});}
  async function guardar(){const x=datos();x.sector_id=Number(x.sector_id);x.responsable_id=Number(x.responsable_id);x.version=actual?.version;if(!$('pr-correo').checkValidity())throw Error('Revisa el correo electrónico');actual=await pedir(actual?'/'+actual.id:'',x,actual?'PUT':'POST');base=JSON.stringify(datos());$('pr-titulo').textContent='Editar establecimiento #'+actual.id;aviso();await cargar();return actual;}
  async function accion(vincular){if(ocupado)return;ocupado=true;$('pr-guardar').disabled=true;$('pr-vincular').disabled=true;try{const e=await guardar();if(!vincular){toast('Establecimiento guardado');return;}let r;try{r=await pedir('/'+e.id+'/vincular',{version:e.version},'POST');}catch(error){const contacto=error.datos?.existente;if(!contacto)throw error;const ok=await solicitarDialogo({titulo:'Confirmar contacto existente',mensaje:`El teléfono pertenece a ${contacto.nombre} (#${contacto.id}). ¿Vincular este establecimiento a ese contacto? Sus datos no se modificarán.`,aceptar:'Vincular contacto'});if(!ok)return;r=await pedir('/'+e.id+'/vincular',{version:e.version,cliente_id:contacto.id},'POST');}
    $('overlay-prospeccion').classList.remove('mostrar');await abrirFichaCliente(r.cliente_id);await FlujoCRM.nuevoRegistro(r.cliente_id,'pipeline');if($('overlay-servicio-nuevo').classList.contains('mostrar')){CLIENTE_DUP.establecimiento_id=e.id;$('sn-ubicacion').value=e.direccion||'';FlujoCRM.marcarGuardado('overlay-servicio-nuevo');}await cargar();
  }catch(e){toast(e.message);$('pr-aviso').textContent=e.message;}finally{ocupado=false;$('pr-guardar').disabled=false;$('pr-vincular').disabled=false;}}
  $('pr-estado').innerHTML=Object.entries(estados).map(([v,n])=>`<option value="${v}">${n}</option>`).join('');$('pr-f-estado').innerHTML='<option value="">Todos los seguimientos</option>'+$('pr-estado').innerHTML;
  $('pr-nuevo').onclick=()=>abrir();$('pr-guardar').onclick=()=>accion(false);$('pr-vincular').onclick=()=>accion(true);
  $('pr-cerrar').onclick=async()=>{if(!ocupado&&await permitirSalida())$('overlay-prospeccion').classList.remove('mostrar');};
  $('overlay-prospeccion').addEventListener('input',aviso);$('overlay-prospeccion').addEventListener('change',aviso);
  $('pr-estado').addEventListener('change',()=>{if($('pr-estado').value==='no_contactar')$('pr-proximo_contacto').value='';aviso();});
  window.addEventListener('beforeunload',e=>{if($('overlay-prospeccion').classList.contains('mostrar')&&pendiente()){e.preventDefault();e.returnValue='';}});
  $('pr-tabla').onclick=e=>{const btn=e.target.closest('[data-establecimiento]');if(btn)abrir(Number(btn.dataset.establecimiento));};
  ['pr-f-sector','pr-f-estado','pr-f-responsable','pr-vencidos'].forEach(id=>$(id).onchange=cargar);$('pr-buscar').oninput=debounce(cargar,350);
  $('pr-agregar-sector').onclick=async()=>{try{await pedir('/sectores',{nombre:$('pr-sector-nuevo').value},'POST');$('pr-sector-nuevo').value='';await cargar();}catch(e){toast(e.message);}};
  $('pr-sectores').onclick=async e=>{const btn=e.target.closest('[data-sector]');if(!btn)return;try{await pedir('/sectores/'+btn.dataset.sector,{nombre:$('pr-sector-'+btn.dataset.sector).value},'PUT');await cargar();}catch(e){toast(e.message);}};
  $('pr-exportar').onclick=()=>descargarCSV('establecimientos-prospeccion.csv',['nombre','sector','zona','direccion','persona','cargo','telefono','correo','fuente','estado','responsable','proximo_contacto','necesidades'].map(k=>({titulo:k,valor:e=>{const v=k==='estado'?estados[e[k]]:String(e[k]||'');return /^[=+@\-\t\r\n]/.test(v)?"'"+v:v;}})),filas);
  return {cargar};
})();
