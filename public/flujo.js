/* Identidad del contacto y contexto de cada operación comercial. */
const FlujoCRM = (() => {
  const $ = id => document.getElementById(id);
  const baselines = new Map();
  const listasGuardadas = new Map();
  const campos = {
    'overlay-ficha':'#gc-iva-modo,#gc-items input,#gc-items select,#gc-items textarea,#ed-direccion,#ed-canal,#ed-servicio,#ed-responsable,#ed-valor,#ed-fecha-servicio,#ed-hora-servicio,#ed-fecha-cotizacion,#ed-incluye-vigencia,#ed-vigencia-hasta,#ed-equipo,#ed-operador,#ed-proyecto,#ed-manifiestos,#ed-tiros,#ed-observaciones,#gc-notas',
    'overlay-ficha-cliente':'#fc-ed-telefono,#fc-ed-telefono-alterno,#fc-ed-nombre,#fc-ed-correo,#fc-ed-empresa,#fc-ed-rfc,#fc-ed-direccion,#fc-ed-giro,#fc-ed-notas-generales',
    'overlay-servicio-nuevo':'#gc-iva-modo,#gc-items input,#gc-items select,#gc-items textarea,#sn-servicio,#sn-valor,#sn-fecha,#sn-ubicacion,#sn-equipo,#sn-operador,#sn-proyecto,#sn-manifiestos,#sn-tiros,#sn-observaciones,#gc-notas,#sn-fecha-cotizacion,#sn-incluye-vigencia,#sn-vigencia-hasta',

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
    if(!ok){window.Plegables?.mostrarCambios($(id));return false;}
    const lista=$(id).querySelector('#gc-items');if(lista && listasGuardadas.has(id))lista.innerHTML=listasGuardadas.get(id);
    const saved=baselines.get(id);elementos(id).forEach((e,i)=>{if(saved[i]){e.value=saved[i].value;if('checked' in e)e.checked=saved[i].checked;}});
    if(lista){actualizarTotalCotizacion();sincronizarEditor();}
    marcarGuardado(id);return true;
  }
  function presentarContacto(c){
    $('fc-titulo').textContent=folioCliente(c.id)+' · '+(c.empresa_contacto||c.nombre||c.telefono);
    const giroEtiqueta=(CATALOGOS.tipos||[]).find(t=>t.clave===c.giro)?.nombre||'';
    $('contacto-identidad').innerHTML=`<div class="contacto-avatar" aria-hidden="true">${escapar((c.nombre||'C').slice(0,1).toUpperCase())}</div><div><span class="etiqueta-contacto etiqueta-id">${folioCliente(c.id)}</span> <span class="etiqueta-contacto">${c.servicios_ganados>0?'CLIENTE · YA HA CONTRATADO':'PROSPECTO · AÚN NO HA CONTRATADO'}</span>${giroEtiqueta?` <span class="etiqueta-contacto">${escapar(giroEtiqueta)}</span>`:''}<h3>${escapar(c.nombre||'Sin nombre')}</h3><p>${escapar(c.empresa_contacto||'Contacto particular')} · ${escapar(c.telefono)}${c.correo?' · '+escapar(c.correo):''}</p><small>ID de cliente ${folioCliente(c.id)}: fijo, no cambia aunque se corrija el nombre. Sus registros comerciales están separados de estos datos.</small></div>`;
    $('fc-meta').innerHTML=metaClienteHTML(c);
    const origen=CATALOGOS.canales.find(x=>Number(x.id)===Number(c.canal_origen_id));
    const info=$('contacto-identidad').lastElementChild;
    info.insertAdjacentHTML('beforeend',`<p>Cómo se enteró: <b>${escapar(origen?.nombre || 'Sin registrar')}</b></p>`);
    // Las notas generales (acceso al predio, preferencias…) se leen sin abrir el formulario de edición; también salen en sus órdenes.
    if(c.notas_generales)info.insertAdjacentHTML('beforeend',`<p class="ayuda">📝 Notas del contacto: ${escapar(c.notas_generales)}</p>`);
    $('contacto-identidad').insertAdjacentHTML('beforeend',accionesContacto(c)+resumenContacto(c));
  }
  // Atajos para comunicarse sin copiar datos a mano (2026-10-26).
  function accionesContacto(c){
    const tel=String(c.telefono||'').replace(/[^\d+]/g,'');let wa=String(c.telefono||'').replace(/\D/g,'');if(wa.length===10)wa='52'+wa;
    return '<div class="contacto-acciones">'
      +(tel?`<a class="btn btn-outline btn-chico" href="tel:${escapar(tel)}">📞 Llamar</a>`:'')
      +(wa.length>=12?`<a class="btn btn-outline btn-chico" href="https://wa.me/${wa}" target="_blank" rel="noopener noreferrer">💬 WhatsApp</a>`:'')
      +(c.correo?`<a class="btn btn-outline btn-chico" href="mailto:${escapar(c.correo)}">✉️ Correo</a>`:'')
      +'<button type="button" class="btn btn-outline btn-chico" data-sl-libre data-copiar-contacto>📋 Copiar datos</button></div>';
  }
  // Su historia de un vistazo: desde cuándo es cliente, último y próximo servicio, ticket promedio y la recompra sugerida.
  function resumenContacto(c){
    const hoy=hoyISO(),ganados=(c.servicios||[]).filter(s=>s.estatus==='ganado');
    const fechas=ganados.map(s=>String(s.fecha_servicio||'').slice(0,10)).filter(Boolean).sort();
    const ultimo=fechas.filter(f=>f<=hoy).pop(),proximo=fechas.find(f=>f>hoy);
    const f=x=>x?new Date(x+'T12:00:00').toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}):'—';
    const caja=(t,v,sub)=>`<div><small>${t}</small><b>${v}</b>${sub?`<span class="celda-sub">${sub}</span>`:''}</div>`;
    const conValor=ganados.filter(s=>Number(s.valor)>0);
    const ticket=Permisos.puede('ordenes.importes')&&conValor.length?caja('Ticket promedio',formatoMoneda(conValor.reduce((t,s)=>t+Number(s.valor),0)/conValor.length),'sin IVA'):'';
    const rec=c.proxima_recompra;
    const recompra=rec?caja('Recompra sugerida',escapar(f(rec.fecha_sugerida)),escapar(rec.servicio_nombre)+(rec.dias_restantes<0?' · ya pasó':' · en '+rec.dias_restantes+' días')):'';
    return '<div class="cobranza-resumen contacto-historia">'+caja('Contacto desde',escapar(f([c.cliente_desde,c.created_at,fechas[0]].map(x=>String(x||'').slice(0,10)).filter(Boolean).sort()[0])))
      +caja('Último servicio',escapar(f(ultimo)))+caja('Próximo servicio',escapar(f(proximo)))+ticket+recompra+'</div>';
  }
  document.addEventListener('click',async e=>{
    if(!e.target.closest('[data-copiar-contacto]')||!CLIENTE_ACTUAL)return;
    const c=CLIENTE_ACTUAL;
    const texto=[c.nombre,c.empresa_contacto,c.telefono&&'Tel. '+c.telefono,c.correo,c.rfc&&'RFC '+c.rfc,c.direccion].filter(Boolean).join('\n');
    try{await navigator.clipboard.writeText(texto);toast('Datos del contacto copiados');}catch{toast('No se pudo copiar');}
  });
  function presentarRegistro(lead,contacto){
    $('registro-motivo-perdida').hidden=lead.estatus!=='perdido';
    $('registro-motivo-perdida').textContent=lead.estatus==='perdido'?'❌ No aceptada. Motivo: '+(lead.motivo_perdida||'sin registrar'):'';
    const contratado=lead.estatus==='ganado';
    const nombre=contratado?'servicio contratado':'cotización';
    const icono=contratado?'🟢':'🔵';
    $('registro-tipo').innerHTML=`<span class="tag-estatus ${escapar(lead.estatus)}">${icono} ${escapar(estado(lead.estatus))}</span> · EDITAR ${nombre.toUpperCase()} · REGISTRO EXISTENTE`;
    $('ficha-titulo').textContent=`${contratado?'Servicio':'Cotización'} ${contratado?folioOrdenServicio(lead):folioCotizacion(lead)} · ${lead.servicio_nombre||'Servicio por definir'}`;
    // Una orden registrada directo o duplicada no tiene cotización detrás: no se muestra un folio COT inexistente.
    const nodoOrden=`<span class="cadena-nodo activo">🧾 ${folioOrdenServicio(lead)}</span>`;
    $('cadena-documentos').innerHTML=!contratado
      ?`<span class="cadena-nodo activo">📄 ${folioCotizacion(lead)}</span>`
      :lead.origen==='directo'
        ?(lead.duplicado_de?`<span class="cadena-nodo pasado" title="Orden de servicio de la que se copió">🧾 Copia del registro #${Number(lead.duplicado_de)}</span><span class="cadena-flecha">→</span>`:'')+nodoOrden
        :`<span class="cadena-nodo pasado" data-ver-cotizacion title="Ver la cotización de la que viene este servicio">📄 ${folioCotizacion(lead)}</span><span class="cadena-flecha">→</span>`+nodoOrden;
    $('registro-datos-titulo').textContent='Datos de este '+(contratado?'servicio':'registro de cotización');
    $('btn-guardar-ficha').textContent=contratado?'Guardar cambios del servicio':'Guardar cambios de la cotización';
    $('btn-eliminar-lead').textContent=contratado?'Eliminar este servicio':'Eliminar esta cotización';
    $('ed-estatus-actual').textContent=estado(lead.estatus);
    $('btn-generar-cotizacion').textContent='Exportar propuesta PDF / Word';
    const btnOrden=$('btn-generar-orden-servicio');
    if(btnOrden)btnOrden.textContent='🧾 Convertir en orden de servicio';
    $('ed-valor').closest('.campo-modal').querySelector('label').textContent=contratado?'Importe contratado (MXN)':'Importe propuesto (MXN)';
    // Las notas con fecha dicen a qué registro pertenecen, para no confundirlas con el contacto.
    const folio=contratado?folioOrdenServicio(lead):folioCotizacion(lead),doc=contratado?'la orden':'la cotización';
    $('bitacora-titulo').textContent=`Avisos y notas de ${doc} ${folio}`;
    $('obs-ayuda').textContent=`La nota se guarda solo en ${doc} ${folio}, con fecha y quién la escribió. No se agrega al contacto ni a sus otros servicios.`;
    $('obs-texto').placeholder=`Escribe una nota sobre ${doc} ${folio}...`;
    $('ed-fecha-cotizacion').closest('.campo-modal').hidden=contratado;
    $('ed-incluye-vigencia').closest('.campo-modal').hidden=contratado;
    $('wrap-vigencia-hasta').hidden=contratado || !$('ed-incluye-vigencia').checked;
    rotularEditorContenido(contratado);
    document.querySelectorAll('#overlay-ficha .solo-orden').forEach(e=>e.hidden=!contratado);
    const c=contacto||{id:lead.cliente_id,nombre:lead.nombre,telefono:lead.telefono,empresa_contacto:lead.empresa_contacto};
    $('registro-contacto').innerHTML=`<div><span class="flujo-kicker">CONTACTO ASOCIADO · SOLO CONSULTA</span><strong>${escapar(c.nombre||'Sin nombre')}</strong><span>${escapar(c.telefono||'')} ${c.empresa_contacto?'· '+escapar(c.empresa_contacto):''}</span>${c.notas_generales?`<p class="ayuda">📝 Notas del contacto: ${escapar(c.notas_generales)}</p>`:''}</div>${c.id?`<button type="button" class="btn btn-outline" data-abrir-contacto="${Number(c.id)}">Ver / editar contacto #${Number(c.id)}</button>`:''}`;
  }
  async function nuevoRegistro(id,modo,prefill,clienteOculto){
    if(!await permitirCambio('overlay-ficha') || !await permitirCambio('overlay-ficha-cliente') || !await permitirCambio('overlay-servicio-nuevo'))return;
    try {
      CLIENTE_DUP=clienteOculto?{...clienteOculto,id:Number(id)}:await api('/clientes/'+id).then(r=>r.json());
      // Si se abrió desde la ficha de una orden (p. ej. Duplicar), al terminar se regresa a esa orden:
      // la ficha se cierra porque el editor de partidas pasa a la ventana nueva.
      REGRESO_FICHA=$('overlay-ficha').classList.contains('mostrar')?LEAD_ACTUAL?.id??null:null;
      $('overlay-ficha').classList.remove('mostrar'); abrirServicioNuevo(modo,prefill);
    }
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
    const payload={canal_origen_id:$('in-origen').value,nombre:$('in-nombre').value.trim(),telefono:$('in-telefono').value.trim(),empresa_contacto:$('in-empresa').value.trim(),direccion:$('in-direccion').value.trim(),correo:$('in-correo').value.trim(),giro:$('in-giro').value,telefono_alterno:$('in-telefono-alterno').value.trim(),rfc:$('in-rfc').value.trim(),notas_generales:$('in-notas-generales').value.trim()};
    if(payload.telefono.replace(/\D/g,'').length<10){toast('Escribe un teléfono de 10 dígitos');$('in-telefono').focus();return;}
    if(!payload.nombre){toast('Escribe el nombre del contacto');$('in-nombre').focus();return;}
    if(!$('in-correo').checkValidity()){$('in-correo').reportValidity();return;}
    if(!payload.canal_origen_id){toast('Selecciona cómo se enteró de nosotros');$('in-origen').focus();return;}
    botones.forEach(b=>b.disabled=true);
    try{
      let r=await api('/contactos',{method:'POST',body:JSON.stringify(payload)});let c=await r.json();
      // Nombre o empresa parecidos a un cliente que ya existe: se pregunta antes de crear otro.
      if(r.status===409&&c.error==='posible_duplicado'){
        const decision=await resolverDuplicado(c.parecidos,{nombre:payload.empresa_contacto||payload.nombre,telefono:payload.telefono});
        if(!decision)return;
        r=await api('/contactos',{method:'POST',body:JSON.stringify(decision.mismo?{...payload,agregar_telefono_a:decision.mismo}:{...payload,distinto_de:decision.distinto})});c=await r.json();
        if(!r.ok&&r.status!==409){toast(c.error||'No se pudo guardar');return;}
      }
      if(!r.ok&&r.status!==409){toast(c.error||'No se pudo guardar');return;}
      if(r.status===409&&!c.cliente_id){toast(c.error||'No se pudo guardar');return;}
      const id=r.status===409?c.cliente_id:c.id;
      if(r.status===409)toast((c.error||'Este teléfono ya está registrado')+'. Usaremos ese cliente; sus datos se conservan.');
      else if(c.telefono_agregado)toast('Teléfono agregado a '+folioCliente(c.id)+' · '+(c.empresa_contacto||c.nombre)+'. No se creó otro cliente.');
      else toast('Contacto guardado: '+folioCliente(c.id)+'.');
      limpiarFormAlta();
      // Guardar contacto solo guarda. Para cotizar se abre su ficha: ahí están Crear cotización y
      // Crear orden de servicio, la única forma de crear registros (evita rutas paralelas).
      const oculto=r.status===409&&c.cliente?.otra_sucursal?{...c.cliente,telefono:payload.telefono,direccion:payload.direccion}:null;
      if(cotizar)await irACotizar(id,oculto);else $('in-telefono').focus();
    }catch(err){toast(err.message);}finally{botones.forEach(b=>b.disabled=false);}
  }
  $('btn-guardar-contacto-nuevo').addEventListener('click',()=>crearContacto(false));
  // Abre la ficha del contacto y lleva la vista a los botones Crear cotización / Crear orden de servicio.
  async function irACotizar(id,clienteOculto){
    // Cliente de otra sucursal: su ficha no se muestra aquí; se le cotiza directo (sus datos no se cambian).
    if(clienteOculto){document.getElementById('in-telefono')?.closest('.overlay')?.classList.remove('mostrar');return nuevoRegistro(id,'pipeline',undefined,clienteOculto);}
    cambiarVista('clientes');await abrirFichaCliente(id);
    const sec=document.querySelector('#overlay-ficha-cliente [data-plegable="registros-contacto"]');
    if(sec?.classList.contains('plegada'))sec.querySelector('.plegable-cabecera')?.click();
    const btn=$('btn-contacto-cotizar');btn.focus({preventScroll:true});
    // Tras abrir la ventana (y cargar su contenido) se centra el botón, sin quedar bajo el encabezado.
    setTimeout(()=>btn.scrollIntoView({block:'center',behavior:'smooth'}),350);
  }
  return {crearContacto,irACotizar,estado,presentarContacto,presentarRegistro,nuevoRegistro,marcarGuardado,permitirCambio};
})();
