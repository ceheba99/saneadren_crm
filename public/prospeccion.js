const Prospeccion=(()=>{
  const $=id=>document.getElementById(id),esc=escaparHtml;
  const estados={investigar:'Por investigar',pendiente:'Pendiente de contactar',contactado:'Contactado',interesado:'Interesado',no_contactar:'No contactar'};
  const MEDIOS={llamada:'📞 Llamada',whatsapp:'💬 WhatsApp',correo:'✉️ Correo',visita:'🚶 Visita',nota:'📝 Nota'};
  const campos=['nombre','sector_id','zona','direccion','telefono','correo','persona','cargo','fuente','necesidades','estado','responsable_id','proximo_contacto'];
  const FILTROS=['pr-buscar','pr-f-estado','pr-f-sector','pr-f-zona','pr-f-responsable','pr-f-agenda','pr-f-datos'];
  const PASO=100;
  let sectores=[],usuarios=[],actual=null,base='',filas=[],ocupado=false,consulta=0,mostrar=PASO,orden={k:'proximo',dir:1};
  const datos=()=>Object.fromEntries(campos.map(k=>[k,$('pr-'+k).value]));
  const pendiente=()=>base!==JSON.stringify(datos());
  async function pedir(ruta,body,method='GET'){const r=await api('/prospeccion'+ruta,body?{method,body:JSON.stringify(body)}:undefined);const d=await r.json();if(!r.ok){const e=Error(d.error||'No se pudo completar la operación');e.datos=d;throw e;}return d;}
  const opciones=(lista,valor,nombre)=>lista.map(x=>`<option value="${esc(x[valor])}">${esc(x[nombre])}</option>`).join('');
  const hoy=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City'}).format(new Date());
  const sumarDias=n=>{const d=new Date(hoy()+'T12:00:00');d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);};
  const diasHasta=f=>Math.round((new Date(f+'T12:00:00')-new Date(hoy()+'T12:00:00'))/864e5);
  const fecha=f=>f?new Date(String(f).slice(0,10)+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}):'';
  const telLimpio=t=>String(t||'').replace(/[^\d+]/g,'');
  const whats=t=>{let d=String(t||'').replace(/\D/g,'');if(d.length===10)d='52'+d;return d.length>=12?d:'';};
  // «Hoy», «Atrasado 3 días», «En 5 días» o la fecha: lo importante es a quién toca llamar.
  function proximoHTML(e){
    if(e.estado==='no_contactar')return '<span class="util-45">—</span>';
    if(!e.proximo_contacto)return '<span class="pr-sin-fecha">Sin programar</span>';
    const n=diasHasta(e.proximo_contacto);
    if(n<0)return `<b class="rojo">Atrasado ${-n} ${-n===1?'día':'días'}</b><small class="celda-sub">${esc(fecha(e.proximo_contacto))}</small>`;
    if(n===0)return '<b class="pr-hoy-txt">Hoy</b>';
    return `${esc(fecha(e.proximo_contacto))}<small class="celda-sub">${n===1?'Mañana':'En '+n+' días'}</small>`;
  }
  async function catalogos(){[sectores,usuarios]=await Promise.all([pedir('/sectores'),api('/usuarios').then(r=>r.json())]);
    for(const id of ['pr-sector_id','pr-f-sector']){const previo=$(id).value;$(id).innerHTML='<option value="">'+(id==='pr-f-sector'?'Todos los sectores':'Selecciona sector')+'</option>'+opciones(sectores,'id','nombre');$(id).value=previo;}
    const elegibles=Permisos.puede('prospeccion.sucursal')?usuarios:usuarios.filter(u=>u.id===USUARIO_ACTUAL.id);
    for(const id of ['pr-responsable_id','pr-f-responsable']){const previo=$(id).value;$(id).innerHTML='<option value="">'+(id==='pr-f-responsable'?'Todos los responsables':'Selecciona responsable')+'</option>'+opciones(elegibles,'id','nombre');$(id).value=previo;}
    $('pr-admin').hidden=!Permisos.direccion();
    $('pr-sectores').innerHTML=sectores.map(s=>`<div class="servicio-row"><input aria-label="Nombre del sector" id="pr-sector-${s.id}" value="${esc(s.nombre)}" maxlength="80"><button class="btn btn-outline" data-sector="${s.id}">Guardar nombre</button></div>`).join('');
  }
  // Tarjetas de la agenda y el embudo por estado (de todo lo que ve, sin filtros).
  function pintarResumen(r){
    for(const k of ['hoy','atrasados','sin_fecha','interesado','vinculados'])$('pr-n-'+k).textContent=Number(r[k])||0;
    $('pr-embudo').innerHTML=Object.entries(estados).map(([k,n])=>`<button type="button" class="pr-paso pr-e-${k}" data-pr-estado="${k}" aria-pressed="false"><b>${Number(r[k])||0}</b> ${esc(n)}</button>`).join('<span class="pr-flecha" aria-hidden="true">›</span>');
    const z=$('pr-f-zona'),previo=z.value;z.innerHTML='<option value="">Todas las zonas</option>'+(r.zonas||[]).map(x=>`<option value="${esc(x.zona)}">${esc(x.zona)} (${Number(x.n)})</option>`).join('');z.value=[...z.options].some(o=>o.value===previo)?previo:'';
    marcarTarjetas();
  }
  function marcarTarjetas(){
    const agenda=$('pr-f-agenda').value,estado=$('pr-f-estado').value,dat=$('pr-f-datos').value;
    document.querySelectorAll('#vista-prospeccion [data-pr-agenda]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.prAgenda===agenda)));
    document.querySelectorAll('#vista-prospeccion [data-pr-estado]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.prEstado===estado)));
    document.querySelectorAll('#vista-prospeccion [data-pr-vinculado]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.prVinculado===dat)));
    $('pr-limpiar').hidden=!FILTROS.some(id=>$(id).value.trim());
  }
  async function cargar(){const turno=++consulta;try{await catalogos();
      const dat=$('pr-f-datos').value,agenda=$('pr-f-agenda').value;
      const q=new URLSearchParams({q:$('pr-buscar').value,sector_id:$('pr-f-sector').value,estado:$('pr-f-estado').value,responsable_id:$('pr-f-responsable').value,zona:$('pr-f-zona').value,
        pendientes:agenda==='pendientes'?'1':'',agenda:agenda==='pendientes'?'':agenda,telefono:dat==='sin_telefono'?'sin':'',vinculado:['si','no'].includes(dat)?dat:''});
      const [respuesta,resumen]=await Promise.all([pedir('?'+q),pedir('/resumen')]);if(turno!==consulta)return;filas=respuesta;mostrar=PASO;pintarResumen(resumen);render();}
    catch(e){$('pr-resumen').textContent='No se pudo cargar prospección: '+e.message;}}
  const CLAVE={nombre:e=>e.nombre.toLocaleLowerCase('es'),persona:e=>(e.persona||'￿').toLocaleLowerCase('es'),estado:e=>Object.keys(estados).indexOf(e.estado),
    ultimo:e=>e.ultimo_seguimiento||'',proximo:e=>e.estado==='no_contactar'?'9999-99-98':e.proximo_contacto||'9999-99-97',responsable:e=>(e.responsable||'').toLocaleLowerCase('es')};
  function ordenadas(){const c=CLAVE[orden.k]||CLAVE.proximo;return [...filas].sort((a,b)=>{const x=c(a),y=c(b);return (x<y?-1:x>y?1:0)*orden.dir||b.id-a.id;});}
  function render(){
    marcarTarjetas();
    document.querySelectorAll('#vista-prospeccion [data-pr-orden]').forEach(b=>{const th=b.closest('th');if(b.dataset.prOrden===orden.k)th.setAttribute('aria-sort',orden.dir>0?'ascending':'descending');else th.removeAttribute('aria-sort');});
    const lista=ordenadas(),faltan=filas.filter(e=>!e.telefono).length;
    $('pr-resumen').textContent=`${filas.length} ${filas.length===1?'establecimiento':'establecimientos'} · ${faltan} sin teléfono · ${filas.filter(e=>e.cliente_id).length} ya son contactos`+(filas.length===2000?' · Límite de 2000: acota los filtros.':'');
    $('pr-mas').hidden=lista.length<=mostrar;$('btn-pr-mas').textContent='Mostrar más (faltan '+(lista.length-mostrar)+' de '+lista.length+')';
    $('pr-tabla').innerHTML=lista.slice(0,mostrar).map(e=>{const tel=telLimpio(e.telefono),wa=whats(e.telefono);
      return `<tr data-establecimiento="${Number(e.id)}">
      <td data-label="Establecimiento"><b>${esc(e.nombre)}</b><small class="contacto-relacion">${esc([e.sector,e.zona].filter(Boolean).join(' · '))}</small></td>
      <td data-label="Persona / teléfono">${esc(e.persona||'Por identificar')}${e.cargo?`<small class="celda-sub">${esc(e.cargo)}</small>`:''}<small class="celda-sub">${esc(e.telefono||'Sin teléfono')}</small></td>
      <td data-label="Seguimiento"><span class="pr-estado pr-e-${esc(e.estado)}">${esc(estados[e.estado]||e.estado)}</span></td>
      <td data-label="Último contacto">${e.ultimo_seguimiento?`${esc(MEDIOS[e.ultimo_medio]||'')} · ${esc(fecha(e.ultimo_seguimiento))}<small class="celda-sub pr-ultimo-txt" title="${esc(e.ultimo_texto||'')}">${esc(e.ultimo_texto||'')}</small>`:'<span class="util-45">Sin contactar</span>'}</td>
      <td data-label="Próximo contacto">${proximoHTML(e)}</td>
      <td data-label="Responsable">${esc(e.responsable)}</td>
      <td data-label="Contacto CRM">${e.cliente_id?`<button type="button" class="enlace" data-pr-cliente="${Number(e.cliente_id)}">${esc(folioCliente(e.cliente_id))}</button>`:'<span class="util-45">Sin vincular</span>'}</td>
      <td class="fc-acciones">${tel?`<a class="btn btn-outline btn-chico" href="tel:${esc(tel)}" title="Llamar al ${esc(e.telefono)}" aria-label="Llamar al ${esc(e.telefono)}">📞</a>`:''}${wa?`<a class="btn btn-outline btn-chico" href="https://wa.me/${wa}" target="_blank" rel="noopener noreferrer" title="Escribir por WhatsApp" aria-label="Escribir por WhatsApp">💬</a>`:''}<button type="button" class="btn btn-outline btn-chico">Abrir</button></td></tr>`;}).join('')
      ||`<tr><td colspan="8" class="util-37">${FILTROS.some(id=>$(id).value.trim())?'Ningún establecimiento con estos filtros. Prueba con «✕ Quitar filtros».':'Aún no hay establecimientos. Registra el primero.'}</td></tr>`;
  }
  // Cabeza de la ficha: quién es, cómo va y atajos para comunicarse.
  function pintarCabeza(){
    const c=$('pr-cabeza');if(!actual){c.hidden=true;c.innerHTML='';return;}
    const e=actual,tel=telLimpio(e.telefono),wa=whats(e.telefono),url=/^https?:\/\//i.test(e.fuente||'')?e.fuente:'';
    c.hidden=false;
    c.innerHTML=`<div class="pr-cabeza-fila"><div><span class="pr-estado pr-e-${esc(e.estado)}">${esc(estados[e.estado])}</span> <span class="etiqueta-contacto">${esc(e.sector)} · ${esc(e.zona)}</span>
      <h3>${esc(e.nombre)}</h3><p>${esc([e.persona,e.cargo].filter(Boolean).join(' · ')||'Persona por identificar')}${e.telefono?' · '+esc(e.telefono):''}${e.correo?' · '+esc(e.correo):''}</p>
      <p class="ayuda">Próximo contacto: ${proximoHTML(e)} · Responsable: <b>${esc(e.responsable)}</b>${e.cliente_id?` · Contacto CRM: <button type="button" class="enlace" data-pr-cliente="${Number(e.cliente_id)}" data-sl-libre>${esc(folioCliente(e.cliente_id))}</button>`:''}</p></div></div>
      <div class="contacto-acciones">${tel?`<a class="btn btn-outline btn-chico" href="tel:${esc(tel)}">📞 Llamar</a>`:''}${wa?`<a class="btn btn-outline btn-chico" href="https://wa.me/${wa}" target="_blank" rel="noopener noreferrer">💬 WhatsApp</a>`:''}${e.correo?`<a class="btn btn-outline btn-chico" href="mailto:${esc(e.correo)}">✉️ Correo</a>`:''}${url?`<a class="btn btn-outline btn-chico" href="${esc(url)}" target="_blank" rel="noopener noreferrer">🔗 Fuente</a>`:''}</div>`;
  }
  function pintarSeguimiento(){
    const sec=$('pr-seguimiento');if(!actual){sec.hidden=true;return;}
    sec.hidden=false;
    $('pr-s-estado').innerHTML=Object.entries(estados).map(([v,n])=>`<option value="${v}">${n}</option>`).join('');$('pr-s-estado').value=actual.estado;
    $('pr-s-proximo').value=actual.proximo_contacto||'';$('pr-s-texto').value='';
    const g=actual.seguimientos||[];
    $('pr-s-lista').innerHTML=g.length?'<ol class="pr-lista-seg">'+g.map(x=>`<li><div class="pr-seg-cab"><b>${esc(MEDIOS[x.medio]||x.medio)}</b> · ${esc(fechaCorta(x.created_at))} · ${esc(x.usuario||'')}</div><div>${esc(x.texto)}</div>`
      +((x.estado_nuevo||x.proximo_contacto)?`<small class="celda-sub">${x.estado_nuevo?`${esc(estados[x.estado_antes]||x.estado_antes||'')} → <b>${esc(estados[x.estado_nuevo]||x.estado_nuevo)}</b>`:''}${x.estado_nuevo&&x.proximo_contacto?' · ':''}${x.proximo_contacto?'Siguiente: '+esc(fecha(x.proximo_contacto)):''}</small>`:'')+'</li>').join('')+'</ol>'
      :'<p class="util-45">Aún no hay seguimientos. Anota aquí la primera llamada o visita.</p>';
  }
  async function abrir(id){try{if($('overlay-prospeccion').classList.contains('mostrar')&&!await permitirSalida())return;actual=id?await pedir('/'+id):null;await catalogos();campos.forEach(k=>$('pr-'+k).value=actual?.[k]??'');if(!actual){$('pr-estado').value='investigar';$('pr-responsable_id').value=USUARIO_ACTUAL.id;}if(actual&&!usuarios.some(u=>u.id===actual.responsable_id)){$('pr-responsable_id').insertAdjacentHTML('beforeend',`<option value="${actual.responsable_id}">${esc(actual.responsable)} (inactivo; reasignar)</option>`);$('pr-responsable_id').value=actual.responsable_id;}
    $('pr-titulo').textContent=actual?'Establecimiento #'+actual.id:'Registrar establecimiento';base=JSON.stringify(datos());aviso();pintarCabeza();pintarSeguimiento();abrirVentana('overlay-prospeccion');
    // Uno ya guardado abre en vista; «Editar» abre sus datos (2026-10-26). Anotar seguimiento y «Cotizar» siguen a la mano.
    const zona='#pr-datos';if(actual)SoloLectura.poner(zona,Permisos.puede('prospeccion.editar'),{que:'establecimiento',quien:'tu rol solo consulta la prospección.'});else SoloLectura.quitar(zona);}catch(e){toast(e.message);}}
  function aviso(){$('pr-aviso').textContent=pendiente()?'Cambios sin guardar':actual?'Datos guardados':'Nuevo · aún no guardado';}
  async function permitirSalida(){return !pendiente()||await solicitarDialogo({titulo:'Cambios sin guardar',mensaje:'¿Descartar los cambios del establecimiento?',aceptar:'Descartar cambios'});}
  async function guardar(){const x=datos();x.sector_id=Number(x.sector_id);x.responsable_id=Number(x.responsable_id);x.version=actual?.version;if(!$('pr-correo').checkValidity())throw Error('Revisa el correo electrónico');const g=actual?.seguimientos;actual=await pedir(actual?'/'+actual.id:'',x,actual?'PUT':'POST');actual.seguimientos=g||[];base=JSON.stringify(datos());$('pr-titulo').textContent='Establecimiento #'+actual.id;aviso();pintarCabeza();pintarSeguimiento();await cargar();return actual;}
  async function accion(vincular){if(ocupado)return;ocupado=true;$('pr-guardar').disabled=true;$('pr-vincular').disabled=true;try{const e=await guardar();if(!vincular){toast('Establecimiento guardado');SoloLectura.bloquear('#pr-datos');return;}let r;try{r=await pedir('/'+e.id+'/vincular',{version:e.version},'POST');}catch(error){const parecidos=error.datos?.parecidos;if(parecidos){const d=await resolverDuplicado(parecidos,{nombre:e.nombre,telefono:e.telefono});if(!d)return;r=await pedir('/'+e.id+'/vincular',d.mismo?{version:e.version,agregar_telefono_a:d.mismo}:{version:e.version,distinto_de:d.distinto},'POST');}else{const contacto=error.datos?.existente;if(!contacto)throw error;const ok=await solicitarDialogo({titulo:'Confirmar contacto existente',mensaje:`El teléfono pertenece a ${contacto.nombre} (${folioCliente(contacto.id)}). ¿Vincular este establecimiento a ese contacto? Sus datos no se modificarán.`,aceptar:'Vincular contacto'});if(!ok)return;r=await pedir('/'+e.id+'/vincular',{version:e.version,cliente_id:contacto.id},'POST');}}
    $('overlay-prospeccion').classList.remove('mostrar');ESTABLECIMIENTO_PENDIENTE={cliente_id:r.cliente_id,id:e.id,direccion:e.direccion||''};await FlujoCRM.irACotizar(r.cliente_id,r.otra_sucursal?{id:r.cliente_id,folio:folioCliente(r.cliente_id),nombre:'Cliente de otra sucursal',telefono:e.telefono,direccion:e.direccion||''}:null);toast('Contacto listo: usa Crear cotización o Crear orden de servicio');await cargar();
  }catch(e){toast(e.message);$('pr-aviso').textContent=e.message;}finally{ocupado=false;$('pr-guardar').disabled=false;$('pr-vincular').disabled=false;}}
  // Anotar seguimiento: no necesita «Editar» (no cambia los datos del establecimiento, solo su estado y próxima fecha).
  async function anotar(){if(ocupado||!actual)return;
    if(pendiente()){toast('Primero guarda o descarta los cambios de los datos del establecimiento');return;}
    const texto=$('pr-s-texto').value.trim();if(!texto){toast('Escribe qué pasó');$('pr-s-texto').focus();return;}
    ocupado=true;$('pr-s-guardar').disabled=true;
    try{actual=await pedir('/'+actual.id+'/seguimientos',{version:actual.version,medio:$('pr-s-medio').value,texto,estado:$('pr-s-estado').value,proximo_contacto:$('pr-s-proximo').value},'POST');
      campos.forEach(k=>$('pr-'+k).value=actual[k]??'');base=JSON.stringify(datos());aviso();pintarCabeza();pintarSeguimiento();toast('Seguimiento anotado');await cargar();}
    catch(e){toast(e.message);}finally{ocupado=false;$('pr-s-guardar').disabled=false;}}
  $('pr-estado').innerHTML=Object.entries(estados).map(([v,n])=>`<option value="${v}">${n}</option>`).join('');$('pr-f-estado').innerHTML='<option value="">Todos los seguimientos</option>'+$('pr-estado').innerHTML;
  $('pr-nuevo').onclick=()=>abrir();$('pr-guardar').onclick=()=>accion(false);$('pr-vincular').onclick=()=>accion(true);$('pr-s-guardar').onclick=anotar;
  $('pr-s-estado').addEventListener('change',()=>{if($('pr-s-estado').value==='no_contactar')$('pr-s-proximo').value='';});
  $('pr-seguimiento').addEventListener('click',e=>{const b=e.target.closest('[data-pr-dias]');if(!b)return;const n=Number(b.dataset.prDias);$('pr-s-proximo').value=n?sumarDias(n):'';});
  $('pr-cerrar').onclick=async()=>{if(!ocupado&&await permitirSalida())$('overlay-prospeccion').classList.remove('mostrar');};
  $('pr-datos').addEventListener('input',aviso);$('pr-datos').addEventListener('change',aviso);
  $('pr-estado').addEventListener('change',()=>{if($('pr-estado').value==='no_contactar')$('pr-proximo_contacto').value='';aviso();});
  window.addEventListener('beforeunload',e=>{if($('overlay-prospeccion').classList.contains('mostrar')&&pendiente()){e.preventDefault();e.returnValue='';}});
  // El folio del contacto abre su ficha; el resto de la fila, el establecimiento (salvo llamar y WhatsApp).
  document.addEventListener('click',e=>{const c=e.target.closest('[data-pr-cliente]');if(!c)return;if(c.closest('#overlay-prospeccion')){if(pendiente())return toast('Primero guarda o descarta los cambios');$('overlay-prospeccion').classList.remove('mostrar');}abrirFichaCliente(Number(c.dataset.prCliente));});
  $('pr-tabla').onclick=e=>{if(e.target.closest('a,[data-pr-cliente]'))return;const tr=e.target.closest('[data-establecimiento]');if(tr)abrir(Number(tr.dataset.establecimiento));};
  ['pr-f-sector','pr-f-estado','pr-f-responsable','pr-f-zona','pr-f-agenda','pr-f-datos'].forEach(id=>$(id).onchange=cargar);$('pr-buscar').oninput=debounce(cargar,350);
  // Tarjetas y embudo: atajos de los filtros (otro clic en la misma lo quita).
  $('vista-prospeccion').addEventListener('click',e=>{const b=e.target.closest('[data-pr-agenda],[data-pr-estado],[data-pr-vinculado]');if(!b||b.closest('#overlay-prospeccion'))return;
    const [id,v]=b.dataset.prAgenda!==undefined?['pr-f-agenda',b.dataset.prAgenda]:b.dataset.prEstado!==undefined?['pr-f-estado',b.dataset.prEstado]:['pr-f-datos',b.dataset.prVinculado];
    $(id).value=$(id).value===v?'':v;cargar();});
  $('pr-limpiar').onclick=()=>{FILTROS.forEach(id=>$(id).value='');cargar();};
  $('btn-pr-mas').onclick=()=>{mostrar+=PASO;render();};
  document.querySelectorAll('#vista-prospeccion [data-pr-orden]').forEach(b=>b.addEventListener('click',()=>{const k=b.dataset.prOrden;orden=orden.k===k?{k,dir:-orden.dir}:{k,dir:k==='ultimo'?-1:1};render();}));
  $('pr-agregar-sector').onclick=async()=>{try{await pedir('/sectores',{nombre:$('pr-sector-nuevo').value},'POST');$('pr-sector-nuevo').value='';await cargar();}catch(e){toast(e.message);}};
  $('pr-sectores').onclick=async e=>{const btn=e.target.closest('[data-sector]');if(!btn)return;try{await pedir('/sectores/'+btn.dataset.sector,{nombre:$('pr-sector-'+btn.dataset.sector).value},'PUT');await cargar();}catch(e){toast(e.message);}};
  // Exporta lo que está en pantalla (mismos filtros y orden), con encabezados claros y su último seguimiento.
  const COLUMNAS=[['nombre','Establecimiento'],['sector','Sector'],['zona','Zona'],['direccion','Domicilio'],['persona','Persona'],['cargo','Cargo'],['telefono','Teléfono'],['correo','Correo'],['fuente','Fuente'],['estado','Seguimiento'],['responsable','Responsable'],['proximo_contacto','Próximo contacto'],['ultimo_seguimiento','Último contacto'],['ultimo_texto','Qué pasó'],['seguimientos','Seguimientos anotados'],['cliente_id','Contacto CRM'],['necesidades','Necesidades y notas']];
  $('pr-exportar').onclick=()=>{const l=ordenadas();if(!l.length)return toast('No hay establecimientos con estos filtros para exportar');
    descargarCSV('establecimientos-prospeccion.csv',COLUMNAS.map(([k,t])=>({titulo:t,valor:e=>{const v=k==='estado'?estados[e[k]]:k==='cliente_id'?(e[k]?folioCliente(e[k]):''):String(e[k]??'');return /^[=+@\-\t\r\n]/.test(v)?"'"+v:v;}})),l);};
  // ---------- Bloque «Prospección» de Inicio: a quién toca llamar hoy (o ya pasó la fecha). ----------
  // Vendedor: los suyos; quien ve toda su sucursal: todos los de su sucursal.
  async function pintarInicio(){
    const cont=$('inicio-prospeccion');if(!cont||!Permisos.puede('prospeccion.ver'))return;
    cont.innerHTML='<p class="util-45" role="status">Cargando…</p>';
    let lista;
    try{lista=await pedir('?pendientes=1'+(Permisos.puede('prospeccion.sucursal')?'':'&responsable_id='+Number(USUARIO_ACTUAL.id)));}
    catch(e){cont.innerHTML=`<div class="aviso-error-carga" role="alert"><p>${esc(e.message)}</p></div>`;return;}
    const h=hoy();
    cont.innerHTML=lista.length?lista.slice(0,15).map(e=>`<div class="fila-alerta ${e.proximo_contacto<h?'vencido':'tipo-alerta'}">
        <div class="info"><span class="tipo-tag ${e.proximo_contacto<h?'rojo':'alerta'}">🔎 ${e.proximo_contacto<h?'Seguimiento atrasado':'Llamar hoy'}</span>
          <div><b>${esc(e.nombre)}</b> · ${esc(e.sector||'')} · ${esc(e.zona||'')}</div><div class="txt">${esc(estados[e.estado]||e.estado)}${e.persona?' · '+esc(e.persona):''}${e.telefono?' · '+esc(e.telefono):''}</div>
          ${e.ultimo_texto?`<div class="txt">Último: ${esc(e.ultimo_texto)}</div>`:''}
          <div class="fecha">${esc(String(e.proximo_contacto).split('-').reverse().join('/'))} · ${esc(e.responsable||'')}</div></div>
        <div class="util-46"><button type="button" class="btn btn-outline" data-pr-inicio="${Number(e.id)}">Abrir</button></div></div>`).join('')+(lista.length>15?`<p class="util-45">Y ${lista.length-15} más en Prospección.</p>`:'')
      :'<p class="util-45">No hay llamadas de prospección pendientes para hoy. 🎉</p>';
  }
  $('inicio-prospeccion')?.addEventListener('click',e=>{const b=e.target.closest('[data-pr-inicio]');if(b)abrir(Number(b.dataset.prInicio));});
  return {cargar,abrir,pintarInicio};
})();
