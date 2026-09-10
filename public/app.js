const API = '/api';
let CATALOGOS = { usuarios: [], servicios: [], canales: [] };
let LEAD_ACTUAL = null;
let ETAPA_FICHA = 1;
let USUARIO_ACTUAL = null;

// ---------- Sesión (login) ----------
function cargarSesion() {
  const raw = localStorage.getItem('usuario_actual');
  if (!raw) { USUARIO_ACTUAL = null; return; }
  try {
    USUARIO_ACTUAL = JSON.parse(raw);
    if (!USUARIO_ACTUAL?.token) { USUARIO_ACTUAL = null; localStorage.removeItem('usuario_actual'); }
  } catch (e) {
    console.warn('Sesión guardada inválida, se descarta.', e);
    localStorage.removeItem('usuario_actual');
    USUARIO_ACTUAL = null;
  }
}
function guardarSesion(usuario) {
  USUARIO_ACTUAL = usuario;
  localStorage.setItem('usuario_actual', JSON.stringify(usuario));
}
function cerrarSesion() {
  api('/logout', { method: 'POST' }).catch(() => {}).finally(() => {
    localStorage.removeItem('usuario_actual');
    USUARIO_ACTUAL = null;
    location.reload();
  });
}
async function login(nombre, password) {
  const res = await fetch(API + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'No se pudo iniciar sesión');
  return data; // incluye { token, id, nombre, rol }
}
const NOMBRE_ETAPA = { 1: 'Recolección de datos', 2: 'Cotización / Visita', 3: 'Cierre / Programación', 4: 'Post-venta' };

// ---------- Utilidades ----------
function on(id, evento, fn) {
  const el = document.getElementById(id);
  if (!el) {
    console.warn(`[Saneadren] No se encontró el elemento #${id}; no se pudo enlazar el evento '${evento}'.`);
    return;
  }
  el.addEventListener(evento, fn);
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 2600);
}
async function api(path, opts) {
  const res = await fetch(API + path, {
    headers: {
      'Content-Type': 'application/json',
      ...(USUARIO_ACTUAL?.token ? { Authorization: 'Bearer ' + USUARIO_ACTUAL.token } : {})
    },
    ...opts
  });
  if (res.status === 401 && path !== '/login') {
    // Sesión expirada o inválida: no tiene caso seguir mostrando datos ni pedir de nuevo.
    localStorage.removeItem('usuario_actual');
    USUARIO_ACTUAL = null;
    toast('Tu sesión expiró. Vuelve a iniciar sesión.');
    document.getElementById('overlay-login')?.classList.add('mostrar');
    throw new Error('Sesión expirada');
  }
  if (!res.ok && res.status !== 409) {
    let msg = 'Error de red';
    try { const j = await res.clone().json(); if (j && j.error) msg = j.error; } catch (e) {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res;
}
function fechaCorta(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  return d.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ---------- Navegación entre vistas ----------
document.querySelectorAll('header nav button').forEach(btn => {
  btn.addEventListener('click', () => cambiarVista(btn.dataset.vista));
});
function cambiarVista(v) {
  document.querySelectorAll('.vista').forEach(s => s.classList.remove('activa'));
  document.getElementById('vista-' + v).classList.add('activa');
  document.querySelectorAll('header nav button').forEach(b => b.classList.toggle('activa', b.dataset.vista === v));
  if (v === 'leads') cargarLeads();
  if (v === 'clientes') cargarClientes();
  if (v === 'prospeccion') Prospeccion.cargar();
  if (v === 'pendientes') cargarPendientes();
  if (v === 'resultados') cargarResultados();
  if (v === 'usuarios') { cargarUsuarios(); cargarTiposCliente(); cargarCatalogoServicios(); cargarCanalesCatalogo(); }
}

// ---------- Cargar catálogos ----------
async function cargarCatalogos() {
  const [u, s, c] = await Promise.all([
    api('/usuarios').then(r => r.json()),
    api('/servicios').then(r => r.json()),
    api('/canales').then(r => r.json())
  ]);
  CATALOGOS = { usuarios: u, servicios: s, canales: c };
  await cargarTiposCliente();
  const origen = document.getElementById("in-origen");
  const origenPrevio = origen.value;
  origen.innerHTML = '<option value="">Selecciona una opción</option>' + c.map(x=>`<option value="${x.id}">${escaparHtml(x.nombre)}</option>`).join('');
  origen.value = origenPrevio;

  const optU = u.map(x => `<option value="${x.id}">${x.nombre} (${x.rol})</option>`).join('');
  const optS = s.map(x => `<option value="${x.id}">${x.nombre}</option>`).join('');
  const optC = c.map(x => `<option value="${x.id}">${x.nombre}</option>`).join('');


  document.getElementById('ed-servicio').innerHTML = optS;
  document.getElementById('ed-canal').innerHTML = optC;
  document.getElementById('ed-responsable').innerHTML = optU;
  document.getElementById('f-responsable').innerHTML =
    '<option value="">Todos los responsables</option>' + optU;
}

// ---------- Detección de duplicado en vivo ----------
let debounceTel;
let CLIENTE_DUP = null;
on('in-telefono', 'input', e => {
  clearTimeout(debounceTel);
  const val = e.target.value;
  CLIENTE_DUP = null;
  document.getElementById('alerta-dup').classList.remove('mostrar');
  debounceTel = setTimeout(() => verificarDuplicado(val).catch(()=>toast('No se pudo comprobar el teléfono. Se verificará al guardar.')), 400);
});
async function verificarDuplicado(telefono) {
  const digitos = telefono.replace(/\D/g, '');
  if (digitos.length < 10) return;
  const data = await api('/leads/buscar-telefono/' + encodeURIComponent(telefono)).then(r=>r.json());
  if (document.getElementById('in-telefono').value.replace(/\D/g,'') !== digitos) return;
  CLIENTE_DUP = data.cliente || null;
  const panel = document.getElementById('alerta-dup');
  panel.classList.toggle('mostrar',!!data.cliente);
  if (!data.cliente) return;
  document.getElementById('dup-titulo').textContent = 'Este contacto ya existe: ' + (data.cliente.nombre || data.cliente.telefono);
  document.getElementById('dup-lista').innerHTML = '<p>Abre su ficha para consultar registros anteriores, crear otra cotización o registrar un servicio. Sus datos no se sobrescribirán.</p><button type="button" class="btn btn-primario" onclick="abrirFichaCliente(' + Number(data.cliente.id) + ')">Abrir ficha del contacto</button><button type="button" class="btn btn-outline" onclick="FlujoCRM.nuevoRegistro(' + Number(data.cliente.id) + ', \'pipeline\')">Cotizar a este contacto</button>';

}

on('btn-cancelar-dup', 'click', () => {
  document.getElementById('alerta-dup').classList.remove('mostrar');
  document.getElementById('in-telefono').value = '';
});


// ---------- Capturar servicio nuevo ----------
// Dos modos:
// - 'directo': el cliente YA existe (viene de su ficha, o de Recompras) — el servicio se
//   registra de una vez como ganado, SIN pasar por el pipeline de Leads.
// - 'pipeline': viene del aviso de duplicado al capturar (cliente con otra solicitud abierta
//   pide un servicio distinto) — es una oportunidad nueva y sí debe pasar por Leads.
let MODO_SERVICIO_NUEVO = 'pipeline';
function abrirServicioNuevo(modo) {
  if (!CLIENTE_DUP) return;
  MODO_SERVICIO_NUEVO = modo || 'pipeline';
  const esDirecto = MODO_SERVICIO_NUEVO === 'directo';
  document.getElementById('sn-titulo').innerHTML = esDirecto
    ? '<span class="tag-estatus ganado">🟢 Servicio</span> Registrar servicio contratado · NUEVO'
    : '<span class="tag-estatus abierto">🔵 Cotización</span> Crear cotización · NUEVA';
  document.getElementById('sn-ayuda').innerHTML = esDirecto
    ? 'Úsalo cuando el cliente ya confirmó. Indica el importe y la fecha acordados; aparecerá como contratado en su historial.'
    : 'Completa la propuesta y pulsa Crear cotización. Cerrar esta ventana no crea ningún registro.';
  document.getElementById('sn-label-valor').textContent = esDirecto ? 'Importe contratado (MXN)' : 'Importe propuesto (MXN, opcional)';
  document.getElementById('sn-label-fecha').textContent = esDirecto ? 'Fecha acordada del servicio' : 'Fecha propuesta (opcional)';
  document.getElementById('sn-cliente-info').innerHTML =
    `<b>${CLIENTE_DUP.nombre || 'Sin nombre'}</b> · ${CLIENTE_DUP.telefono}${CLIENTE_DUP.direccion ? ' · ' + CLIENTE_DUP.direccion : ''}`;
  document.getElementById('sn-servicio').innerHTML = '<option value="">Selecciona un servicio</option>' + CATALOGOS.servicios.map(s=>`<option value="${s.id}">${escaparHtml(s.nombre)}</option>`).join('');
  document.getElementById('sn-servicio').value = CLIENTE_DUP.servicio_id || '';
  document.getElementById('sn-valor').value = '';
  document.getElementById('sn-ubicacion').value = CLIENTE_DUP.direccion || '';
  document.getElementById('btn-guardar-servicio-nuevo').textContent = esDirecto ? 'Crear servicio contratado' : 'Crear cotización';
  document.getElementById('sn-valor').placeholder = CLIENTE_DUP.ultimo_valor
    ? `Última vez: ${formatoMoneda(CLIENTE_DUP.ultimo_valor)}`
    : 'Si ya se conoce';
  document.getElementById('sn-fecha').value = '';
  document.getElementById('sn-notas').value = '';
  prepararEditorCotizacion(null,'nuevo');
  abrirVentana('overlay-servicio-nuevo');
  FlujoCRM.marcarGuardado('overlay-servicio-nuevo');
}
async function guardarServicioNuevo(descargar=false) {
  if(!validarEditorCotizacion())return;
  sincronizarEditor();
  const botonGuardar = document.getElementById('btn-guardar-servicio-nuevo');
  if (botonGuardar.disabled) return;
  if (!CLIENTE_DUP) return;
  if (!document.getElementById('sn-servicio').value) { toast('Selecciona el servicio de este registro'); return; }
  if (!document.getElementById('sn-ubicacion').value.trim()) { toast('Indica la ubicación de este servicio'); return; }
  const esDirecto = MODO_SERVICIO_NUEVO === 'directo';
  if(esDirecto && !document.getElementById('sn-fecha').value){toast('Indica la fecha acordada del servicio');document.getElementById('sn-fecha').focus();return;}
  const valorRaw = document.getElementById('sn-valor').value;
  if(valorRaw!=='' && (!Number.isFinite(Number(valorRaw)) || Number(valorRaw)<0)){toast('El importe debe ser mayor o igual a cero');return;}
  if (esDirecto && valorRaw === '') {
    toast('Ingresa el costo del servicio para registrarlo');
    return;
  }
  const payload = {
    telefono: CLIENTE_DUP.telefono,
    nombre: CLIENTE_DUP.nombre,
    empresa_contacto: CLIENTE_DUP.empresa_contacto,
    cliente_id: CLIENTE_DUP.id,
    establecimiento_id: CLIENTE_DUP.establecimiento_id || null,
    partidas_json: JSON.stringify(recolectarItemsCotizacion()),
    canal_id: CLIENTE_DUP.canal_origen_id || null,
    direccion: document.getElementById('sn-ubicacion').value.trim(),
    servicio_id: document.getElementById('sn-servicio').value || null,
    responsable_id: USUARIO_ACTUAL.id,
    notas_iniciales: document.getElementById('sn-notas').value.trim(),
    valor: valorRaw === '' ? null : Number(valorRaw),
    fecha_servicio: document.getElementById('sn-fecha').value || null,
    creado_por: USUARIO_ACTUAL.nombre,
    forzar_duplicado: true,
    estatus: esDirecto ? 'ganado' : undefined
  };
  botonGuardar.disabled = true;
  try {
    const creado = await api('/leads', { method: 'POST', body: JSON.stringify(payload) }).then(r => r.json());
    FlujoCRM.marcarGuardado('overlay-servicio-nuevo');
    toast(esDirecto ? 'Servicio registrado como ganado' : 'Nueva cotización registrada correctamente');
    document.getElementById('overlay-servicio-nuevo').classList.remove('mostrar');
    document.getElementById('alerta-dup').classList.remove('mostrar');
    limpiarFormAlta();
    if (esDirecto) {
      cambiarVista('clientes');
      await cargarClientes();
      await abrirFicha(creado.id);
    } else {
      cambiarVista('leads');
      await abrirFicha(creado.id);
    }
    await ServiciosTabla.refrescar();
    if(descargar)await descargarCotizacionActual();
  } catch (err) {
    toast('No se pudo guardar: ' + err.message);
  } finally {
    botonGuardar.disabled = false;
  }
}
on('btn-guardar-servicio-nuevo','click',()=>guardarServicioNuevo());

// ---------- Guardar cotización ----------
on('btn-guardar-lead', 'click', () => FlujoCRM.crearContacto(true));
function limpiarFormAlta() {
  document.getElementById("in-origen").value = "";
  clearTimeout(debounceTel);
  CLIENTE_DUP = null;
  document.getElementById('in-telefono').value = '';
  document.getElementById('in-nombre').value = '';
  document.getElementById('in-empresa').value = '';
  document.getElementById('in-correo').value = '';
  document.getElementById('in-giro').value = '';
  document.getElementById('in-direccion').value = '';
  document.getElementById('alerta-dup').classList.remove('mostrar');
}

// ---------- Vista Cotizaciones (Kanban) ----------
let ETAPA_FILTRO = null;

async function cargarLeads() {
  const params = new URLSearchParams();
  const resp = document.getElementById('f-responsable').value;
  const q = document.getElementById('f-buscar').value;
  const desde = document.getElementById('f-desde').value;
  const hasta = document.getElementById('f-hasta').value;
  params.set('estatus', 'abierto');
  if (resp) params.set('responsable_id', resp);
  if (q) params.set('q', q);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  if (ETAPA_FILTRO) params.set('etapa', ETAPA_FILTRO);

  const [leads, kpis] = await Promise.all([
    api('/leads?' + params.toString()).then(r => r.json()),
    api('/kpis' + (resp ? '?responsable_id=' + resp : '')).then(r => r.json())
  ]);

  renderKpis(kpis);
  renderKanbanLeads(leads);
}

function formatoMoneda(n) {
  return '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function renderKpis(kpis) {
  const porEtapa = kpis.etapas || {};
  for (let e = 1; e <= 4; e++) {
    const k = porEtapa[e] || { total: 0, abiertos: 0, ganados: 0, perdidos: 0, con_alertas: 0, valor_total: 0, dias_promedio: null };
    document.getElementById(`kpi-${e}-total`).textContent = k.total;
    const chips = [];
    if (k.abiertos > 0) chips.push(`<span class="kpi-chip">${k.abiertos} abierto${k.abiertos === 1 ? '' : 's'}</span>`);
    if (k.ganados > 0) chips.push(`<span class="kpi-chip ganado">${k.ganados} ganado${k.ganados === 1 ? '' : 's'}</span>`);
    if (k.perdidos > 0) chips.push(`<span class="kpi-chip perdido">${k.perdidos} perdido${k.perdidos === 1 ? '' : 's'}</span>`);
    if (k.con_alertas > 0) chips.push(`<span class="kpi-chip alerta">⏰ ${k.con_alertas} con alerta</span>`);
    document.getElementById(`kpi-${e}-desglose`).innerHTML = chips.join('') || '<span class="kpi-chip">Sin registros</span>';
    document.getElementById(`kpi-${e}-valor`).innerHTML = k.valor_total > 0
      ? `Cotización en la etapa: <b>${formatoMoneda(k.valor_total)}</b>`
      : '';
    document.getElementById(`kpi-${e}-dias`).innerHTML = k.dias_promedio != null
      ? `Promedio en esta etapa: <b>${k.dias_promedio} días</b>`
      : '';
    document.getElementById(`kpi-${e}`).classList.toggle('activa', ETAPA_FILTRO === e);
  }
  renderResumenClientes(kpis.resumen_clientes || {});
}

function renderResumenClientes(r) {
  document.getElementById('rc-total').textContent = r.total_clientes || 0;
  document.getElementById('rc-prospectos').textContent = r.prospectos || 0;
  document.getElementById('rc-activos').textContent = r.clientes_activos || 0;
  document.getElementById('rc-recurrentes').textContent = r.recurrentes || 0;
  document.getElementById('rc-valor').textContent = formatoMoneda(r.valor_historico_ganado || 0);
}

document.querySelectorAll('.kpi-card').forEach(card => {
  card.addEventListener('click', () => {
    const e = Number(card.dataset.etapa);
    ETAPA_FILTRO = (ETAPA_FILTRO === e) ? null : e;
    cargarLeads();
  });
});

// KANBAN: renderiza cotizaciones en columnas por etapa
function diasSinMovimiento(updatedAt) {
  if (!updatedAt) return 0;
  const diff = Math.floor((new Date() - new Date(updatedAt.replace(' ', 'T'))) / (1000 * 60 * 60 * 24));
  return diff;
}

function renderKanbanLeads(leads) {
  const etiquetaFiltro = ETAPA_FILTRO ? ` · filtrando etapa ${ETAPA_FILTRO}` : '';
  const conteoEl = document.getElementById('tabla-leads-conteo');
  if (conteoEl) conteoEl.textContent = leads.length + (leads.length === 1 ? ' cotización' : ' cotizaciones') + etiquetaFiltro;

  for (let e = 1; e <= 4; e++) {
    document.getElementById('col-' + e).innerHTML = '';
    document.getElementById('footer-' + e).innerHTML = '';
  }

  if (!leads.length) {
    document.getElementById('col-1').innerHTML = '<p class="util-36">Sin cotizaciones abiertas con estos filtros.</p>';
    for (let e = 1; e <= 4; e++) document.getElementById('count-' + e).textContent = '0';
    return;
  }

  const porEtapa = { 1: [], 2: [], 3: [], 4: [] };
  leads.forEach(l => {
    if (porEtapa[l.etapa]) porEtapa[l.etapa].push(l);
  });

  for (let e = 1; e <= 4; e++) {
    const lista = porEtapa[e];
    document.getElementById('count-' + e).textContent = lista.length;

    const valorColumna = lista.reduce((sum, l) => sum + (l.valor || 0), 0);
    if (valorColumna > 0) {
      document.getElementById('footer-' + e).innerHTML = `<div class="kanban-footer-valor">Total: <b>${formatoMoneda(valorColumna)}</b></div>`;
    }

    document.getElementById('col-' + e).innerHTML = lista.map(l => {
      const dias = diasSinMovimiento(l.updated_at);
      let diasClass = '';
      if (dias > 7) diasClass = 'critico';
      else if (dias > 3) diasClass = 'urgente';
      return `
      <div class="lead-card" data-etapa="${l.etapa}" draggable="true" ondragstart="dragStart(event, ${l.id})" ondragend="dragEnd(event)" onclick="abrirFicha(${l.id})">
        ${l.alertas_pendientes > 0 ? `<div class="lead-alertas">⏰ ${l.alertas_pendientes}</div>` : ''}
        ${dias > 2 ? `<div class="lead-dias ${diasClass}">⏱ ${dias}d</div>` : ''}
        ${l.etapa < 4 ? `<button class="btn-avanzar" title="Mover a ${NOMBRE_ETAPA[l.etapa + 1]}" onclick="event.stopPropagation();avanzarEtapa(${l.id}, ${l.etapa + 1})">›</button>` : ''}
        <div class="lead-tel">${l.telefono}</div>
        <div class="lead-nombre">${l.nombre || 'Sin nombre'}</div>
        <div class="lead-servicio">${l.servicio_nombre || 'Sin servicio'}</div>
        <div class="lead-meta">
          <span class="lead-resp">${l.responsable_nombre || '—'}</span>
          <span class="lead-valor">${l.valor != null ? formatoMoneda(l.valor) : '—'}</span>
        </div>
        <div class="lead-fecha">${fechaCorta(l.updated_at)}</div>
      </div>
    `}).join('');
  }
}

on('f-buscar', 'input', debounce(cargarLeads, 350));
on('f-responsable', 'change', cargarLeads);
on('f-desde', 'change', cargarLeads);
on('f-hasta', 'change', cargarLeads);
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ---------- Drag & Drop Kanban + utilidades ----------
function dragStart(e, leadId) {
  e.dataTransfer.setData('text/plain', leadId);
  e.dataTransfer.effectAllowed = 'move';
  e.target.style.opacity = '0.5';
}
function dragEnd(e) {
  e.target.style.opacity = '1';
}
function dragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const col = e.target.closest('.kanban-col');
  if (col) col.classList.add('drag-over');
}
function dragLeave(e) {
  const col = e.target.closest('.kanban-col');
  if (col) col.classList.remove('drag-over');
}
async function drop(e, etapa) {
  e.preventDefault();
  const col = e.target.closest('.kanban-col');
  if (col) col.classList.remove('drag-over');
  const leadId = e.dataTransfer.getData('text/plain');
  if (!leadId) return;
  await avanzarEtapa(leadId, etapa);
}
async function avanzarEtapa(leadId, etapa) {
  try {
    await api('/leads/' + leadId, { method: 'PUT', body: JSON.stringify({ etapa, usuario: USUARIO_ACTUAL ? USUARIO_ACTUAL.nombre : null }) });
    toast('Etapa actualizada: ' + NOMBRE_ETAPA[etapa]);
    cargarLeads();
    if (LEAD_ACTUAL && LEAD_ACTUAL.id == leadId) {
      ETAPA_FICHA = etapa;
      actualizarPipeline();
      const lead = await api('/leads/' + leadId).then(r => r.json());
      LEAD_ACTUAL = lead;

    }
  } catch (err) {
    toast('No se pudo cambiar de etapa: ' + err.message);
  }
}
function limpiarFiltros() {
  document.getElementById('f-buscar').value = '';
  document.getElementById('f-responsable').value = '';
  document.getElementById('f-desde').value = '';
  document.getElementById('f-hasta').value = '';
  ETAPA_FILTRO = null;
  document.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('activa'));
  cargarLeads();
}

// ---------- Vista Resultados (Análisis) ----------
let RESULTADOS_ACTUALES=null,consultaResultados=0;
async function cargarResultados(){
  const consulta=++consultaResultados,desde=document.getElementById('res-desde').value,hasta=document.getElementById('res-hasta').value;
  const estado=document.getElementById('res-estado');
  RESULTADOS_ACTUALES=null;document.getElementById('res-exportar').disabled=true;
  for(const id of ['res-kpis-extra','res-tendencia','res-conversion','res-top-valor','res-antiguedad','res-repeticion','res-kpis','res-canales','res-clientes','res-dinero-canal','res-contactos-canal'])document.getElementById(id).innerHTML='';
  if(desde&&hasta&&desde>hasta){estado.textContent='La fecha Desde no puede ser posterior a Hasta.';return;}
  estado.textContent='Consultando resultados…';
  try{
    const d=await api('/analisis/comercial?'+new URLSearchParams({desde,hasta})).then(r=>r.json());if(consulta!==consultaResultados)return;
    RESULTADOS_ACTUALES=d;document.getElementById('res-exportar').disabled=false;
    const r=d.resumen,pct=(a,b)=>b?(100*a/b).toFixed(1)+'%':'—';
    const tarjetas=[['Contactos nuevos',r.nuevos],['Clientes con servicios en el periodo',r.clientes],['Importe contratado',formatoMoneda(r.contratado)],['Servicios contratados',r.servicios],['Conversión de contactos nuevos',pct(r.convertidos,r.nuevos)],['Promedio por servicio',r.servicios?formatoMoneda(r.contratado/r.servicios):'—'],['Clientes recurrentes activos',r.recurrentes],['Importe en propuestas abiertas',formatoMoneda(r.propuesto)]];
    document.getElementById('res-kpis').innerHTML=tarjetas.map(([label,value])=>`<div class="res-card"><div class="res-num">${value}</div><div class="res-label">${label}</div></div>`).join('');
    document.getElementById('res-canales').innerHTML=d.canales.map(c=>`<tr><td>${escaparHtml(c.canal)}</td><td>${c.nuevos}</td><td>${c.convertidos}</td><td>${pct(c.convertidos,c.nuevos)}</td><td>${c.clientes}</td><td>${c.servicios}</td><td>${formatoMoneda(c.contratado)}</td><td>${c.servicios?formatoMoneda(c.contratado/c.servicios):'—'}</td><td>${c.abiertas}</td><td>${formatoMoneda(c.propuesto)}</td></tr>`).join('')||'<tr><td colspan="10">Sin datos.</td></tr>';
    document.getElementById('res-clientes').innerHTML=d.clientes.map(c=>`<tr><td>${escaparHtml(c.nombre||c.telefono)}</td><td>${escaparHtml(c.canal)}</td><td>${c.ganados_historicos>1?'Cliente recurrente':c.ganados_historicos?'Cliente':'Prospecto'}</td><td>${c.servicios}</td><td>${formatoMoneda(c.contratado)}</td><td>${formatoMoneda(c.total_historico)}</td><td>${c.abiertas}</td><td>${escaparHtml(c.ultima_fecha||'Sin fecha')}</td><td><button class="btn btn-outline" data-resultado-cliente="${Number(c.id)}">Abrir ficha</button></td></tr>`).join('')||'<tr><td colspan="9">Sin contactos ni actividad en el periodo.</td></tr>';
    renderBarChart('res-dinero-canal',d.canales,'canal','contratado',formatoMoneda);renderBarChart('res-contactos-canal',[...d.canales].sort((a,b)=>b.nuevos-a.nuevos),'canal','nuevos',v=>v+' contactos');
    renderGraficosComerciales(d);
    estado.textContent=(desde||hasta?'Periodo: '+(desde||'inicio')+' a '+(hasta||'sin límite'):'Todo el historial')+(d.sinFecha?' · '+d.sinFecha+' servicios contratados sin fecha: no se incluyen al filtrar por fechas.':'');
  }catch(err){if(consulta!==consultaResultados)return;estado.textContent='No se pudieron cargar los resultados. '+err.message;}
}
on('res-aplicar','click',cargarResultados);
on('res-todo','click',()=>{document.getElementById('res-desde').value='';document.getElementById('res-hasta').value='';cargarResultados();});
on('res-clientes','click',e=>{const btn=e.target.closest('[data-resultado-cliente]');if(btn)abrirFichaCliente(Number(btn.dataset.resultadoCliente));});
on('res-exportar','click',()=>{if(!RESULTADOS_ACTUALES)return;descargarCSV('resultados-canales.csv',[{titulo:'Canal de origen',valor:c=>c.canal},{titulo:'Contactos nuevos',valor:c=>c.nuevos},{titulo:'Convertidos',valor:c=>c.convertidos},{titulo:'Servicios contratados',valor:c=>c.servicios},{titulo:'Importe contratado MXN',valor:c=>c.contratado},{titulo:'Propuestas abiertas',valor:c=>c.abiertas},{titulo:'Importe abierto MXN',valor:c=>c.propuesto}],RESULTADOS_ACTUALES.canales);});

function renderBarChart(id, datos, labelKey, valueKey, fmt) {
  const cont = document.getElementById(id);
  if (!datos.length) { cont.innerHTML = '<p class="util-36">Sin datos para mostrar.</p>'; return; }
  const max = Math.max(...datos.map(d => Number(d[valueKey]) || 0));
  cont.innerHTML = datos.map((d, i) => {
    const val = Number(d[valueKey]) || 0;
    const pct = max > 0 ? (val / max) * 100 : 0;
    const barClass = 'bar-' + ((i % 5) + 1);
    return `
      <div class="bar-row">
        <div class="bar-label" title="${escaparHtml(d[labelKey] || '')}">${escaparHtml(d[labelKey] || '—')}</div>
        <div class="bar-track">
          <div class="bar-fill ${barClass}" style="width:${pct}%;min-width:0;${val===0?'display:none;':''}">${pct > 15 ? fmt(val) : ''}</div>
        </div>
        <div class="bar-val">${fmt(val)}</div>
      </div>
    `;
  }).join('');
}

function renderEvolucion(id, datos) {
  const cont = document.getElementById(id);
  if (!datos.length) { cont.innerHTML = '<p class="util-36">Sin datos mensuales.</p>'; return; }
  const max = Math.max(...datos.map(d => d.ganados));
  cont.innerHTML = datos.map(d => {
    const h = max > 0 ? (d.ganados / max) * 100 : 0;
    return `
      <div class="evo-col">
        <div class="evo-bar" style="height:${Math.max(h, 4)}%">
          <div class="evo-tooltip">${d.mes}: ${d.ganados} ganados · ${formatoMoneda(d.ingresos || 0)}</div>
        </div>
        <div class="evo-label">${d.mes_corto}</div>
      </div>
    `;
  }).join('');
}

function renderTablaMensual(id, datos) {
  const body = document.getElementById(id);
  if (!datos.length) { body.innerHTML = '<tr><td colspan="6" class="util-36">Sin datos mensuales disponibles.</td></tr>'; return; }
  body.innerHTML = datos.map(d => {
    const tasa = d.creados > 0 ? Math.round((d.ganados / d.creados) * 100) : 0;
    return `
      <tr>
        <td><b>${d.mes}</b></td>
        <td>${d.creados}</td>
        <td><span style="color:var(--verde);font-weight:700;">${d.ganados}</span></td>
        <td><span style="color:var(--rojo);">${d.perdidos}</span></td>
        <td>${formatoMoneda(d.ingresos || 0)}</td>
        <td><b>${tasa}%</b></td>
      </tr>
    `;
  }).join('');
}

function escaparHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---------- Generar documento de cotización (PDF o Word) desde la ficha del lead ----------
// Datos de la empresa que aparecen en el encabezado del documento.
// TODO: ajusta estos valores con los datos reales de contacto de Saneadren.
const EMPRESA_COTIZACION = {
  nombre: 'Saneadren',
  eslogan: 'Servicios de drenaje y saneamiento',
  telefono: '',
  correo: '',
  direccion: '',
  vigenciaDias: 15
};

// La plantilla pertenece al catálogo; editar una partida no modifica su plantilla.
function descripcionServicio(nombre) {
  return (CATALOGOS.servicios || []).find(s => s.nombre === nombre)?.descripcion || '';
}

function folioCotizacion(lead) {
  const fecha = new Date(lead.created_at || Date.now());
  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  return `COT-${yyyy}${mm}-${String(lead.id).padStart(4, '0')}`;
}

function nombreArchivoCotizacion(datos, extension) {
  const cliente = (datos.cliente.nombre || 'cliente').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `cotizacion_${datos.folio}_${cliente}.${extension}`;
}

function datosCotizacionDesdeLead(lead, items) {
  const emision = new Date();
  const vencimiento = new Date(emision);
  vencimiento.setDate(vencimiento.getDate() + EMPRESA_COTIZACION.vigenciaDias);
  return {
    folio: folioCotizacion(lead),
    fechaEmision: emision.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }),
    fechaVencimiento: vencimiento.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }),
    cliente: {
      nombre: lead.nombre || 'Cliente',
      empresa: lead.empresa_contacto || '',
      telefono: lead.telefono || '',
      direccion: lead.direccion || ''
    },
    items,
    total: items.reduce((suma, item) => suma + (Number(item.importe) || 0), 0)
  };
}

let membreteCotizacionCache;
async function cargarMembreteCotizacion() {
  if (!membreteCotizacionCache) {
    membreteCotizacionCache = fetch('/membrete-cotizacion.png').then(async respuesta => {
      if (!respuesta.ok) throw new Error('No se pudo cargar el membrete');
      return new Uint8Array(await respuesta.arrayBuffer());
    }).catch(error => { membreteCotizacionCache = null; throw error; });
  }
  return membreteCotizacionCache;
}

async function generarPDFCotizacion(datos) {
  const membrete = await cargarMembreteCotizacion();
  const { jsPDF } = window.jspdf;
  // Mantiene la proporción 2:3 del membrete original sin recortarlo.
  const doc = new jsPDF({unit:'pt', format:[612,918]});
  const margen=48, inicio=132, limite=710;
  let y=inicio;
  const fondo=()=>doc.addImage(membrete,'PNG',0,0,612,918,'membrete');
  const pagina=()=>{doc.addPage(); fondo(); y=inicio;};
  fondo();
  const texto=(contenido,tamano=10,negrita=false)=>{
    doc.setFont('helvetica',negrita?'bold':'normal'); doc.setFontSize(tamano); doc.setTextColor(30);
    const lineas=doc.splitTextToSize(String(contenido),516);
    for(const linea of lineas){if(y+tamano>limite)pagina();doc.text(linea,margen,y);y+=tamano+5;}
  };
  texto('COTIZACIÓN '+datos.folio,15,true);
  texto('Fecha: '+datos.fechaEmision+'   |   Vigencia hasta: '+datos.fechaVencimiento);
  y+=10;
  texto('CLIENTE',10,true);
  texto(datos.cliente.nombre);
  if(datos.cliente.empresa)texto(datos.cliente.empresa);
  if(datos.cliente.telefono)texto('Tel: '+datos.cliente.telefono);
  if(datos.cliente.direccion)texto('Ubicación del servicio: '+datos.cliente.direccion);
  y+=12;
  if(y>limite-70)pagina();
  doc.autoTable({
    startY:y, margin:{left:margen,right:margen,top:inicio,bottom:208},
    head:[['Servicio','Descripción / leyenda','Importe (MXN)']],
    body:datos.items.map(item=>[item.servicio,item.leyenda||'—',formatoMoneda(item.importe)]),
    foot:[['','Total',formatoMoneda(datos.total)]],showFoot:'lastPage',rowPageBreak:'avoid',columnStyles:{0:{cellWidth:125},2:{cellWidth:95}},
    styles:{fontSize:10,cellPadding:6,overflow:'linebreak'},
    headStyles:{fillColor:[246,177,3],textColor:20},
    footStyles:{fillColor:[245,245,245],textColor:20,fontStyle:'bold'},
    willDrawPage:()=>{if(doc.internal.getCurrentPageInfo().pageNumber>1)fondo();}
  });
  y=doc.lastAutoTable.finalY+24;
  texto('Esta cotización tiene una vigencia de '+EMPRESA_COTIZACION.vigenciaDias+' días a partir de su fecha de emisión.',9);
  const paginas=doc.getNumberOfPages();
  for(let i=1;i<=paginas;i++){doc.setPage(i);doc.setFontSize(8);doc.setTextColor(90);doc.text('Cotización '+datos.folio+' · Página '+i+' de '+paginas,564,722,{align:'right'});}
  doc.save(nombreArchivoCotizacion(datos,'pdf'));
}

async function generarWordCotizacion(datos) {
  const membrete=await cargarMembreteCotizacion();
  const {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,WidthType,Header,ImageRun}=docx;
  const parrafo=(texto,bold=false)=>new Paragraph({spacing:{after:100},children:[new TextRun({text:String(texto),bold})]});
  const celda=(texto,bold=false)=>new TableCell({children:[parrafo(texto,bold)],shading:bold?{fill:'F6B103'}:undefined});
  const tabla=new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[
    new TableRow({tableHeader:true,children:[celda('Servicio',true),celda('Descripción / leyenda',true),celda('Importe (MXN)',true)]}),
    ...datos.items.map(item=>new TableRow({children:[celda(item.servicio),celda(item.leyenda||'—'),celda(formatoMoneda(item.importe))]})),
    new TableRow({children:[celda(''),celda('Total',true),celda(formatoMoneda(datos.total),true)]})
  ]});
  const documento=new Document({styles:{default:{document:{run:{font:'Arial',size:20,color:'222222'},paragraph:{spacing:{after:100}}}}},sections:[{
    properties:{page:{size:{width:12240,height:18360},margin:{top:2640,bottom:4160,left:960,right:960,header:0,footer:0}}},
    headers:{default:new Header({children:[new Paragraph({children:[new ImageRun({data:membrete,type:'png',transformation:{width:816,height:1224},floating:{horizontalPosition:{relative:'page',offset:0},verticalPosition:{relative:'page',offset:0},behindDocument:true,allowOverlap:true,layoutInCell:false}})]})]})},
    children:[
      new Paragraph({spacing:{after:160},children:[new TextRun({text:'COTIZACIÓN '+datos.folio,bold:true,size:30})]}),
      parrafo('Fecha: '+datos.fechaEmision+'   |   Vigencia hasta: '+datos.fechaVencimiento),
      parrafo('CLIENTE',true),parrafo(datos.cliente.nombre),
      ...(datos.cliente.empresa?[parrafo(datos.cliente.empresa)]:[]),
      ...(datos.cliente.telefono?[parrafo('Tel: '+datos.cliente.telefono)]:[]),
      ...(datos.cliente.direccion?[parrafo('Ubicación del servicio: '+datos.cliente.direccion)]:[]),
      tabla,parrafo(''),parrafo('Esta cotización tiene una vigencia de '+EMPRESA_COTIZACION.vigenciaDias+' días a partir de su fecha de emisión.')
    ]
  }]});
  saveAs(await Packer.toBlob(documento),nombreArchivoCotizacion(datos,'docx'));
}


// ---------- Ventana emergente: armar la cotización (varios servicios, leyenda y formato) ----------
let GC_CONTADOR = 0;

function crearFilaServicioHTML(item) {
  const id = ++GC_CONTADOR;
  const opciones = (CATALOGOS.servicios || []).map(s =>
    `<option value="${escaparHtml(s.nombre)}" ${s.nombre === item.servicio ? 'selected' : ''}>${escaparHtml(s.nombre)}</option>`
  ).join('');
  return `
    <div class="gc-fila util-16" data-fila="${id}">
      <div class="form-grid-2">
        <div class="campo-modal">
          <label>Servicio</label>
          <select class="gc-servicio" data-fila="${id}">
            <option value="">— Selecciona —</option>
            ${opciones}
          </select>
        </div>
        <div class="campo-modal">
          <label>Importe (MXN)</label>
          <input type="number" class="gc-importe" data-fila="${id}" min="0" step="0.01" value="${item.importe ?? ''}">
        </div>
        <div class="campo-modal full">
          <label>Descripción / leyenda</label>
          <textarea class="gc-leyenda" data-fila="${id}" data-plantilla="${escaparHtml(descripcionServicio(item.servicio))}" rows="2">${escaparHtml(item.leyenda || '')}</textarea>
        </div>
      </div>
      <button type="button" class="btn-eliminar gc-quitar" data-fila="${id}">🗑 Quitar servicio</button>
    </div>
  `;
}

function agregarFilaCotizacion(item = {}) {
  document.getElementById('gc-items').insertAdjacentHTML('beforeend', crearFilaServicioHTML(item));
}

function actualizarTotalCotizacion() {
  const total = Array.from(document.querySelectorAll('#gc-items .gc-importe'))
    .reduce((suma, input) => suma + (Number(input.value) || 0), 0);
  document.getElementById('gc-total').textContent = formatoMoneda(total);
}

function recolectarItemsCotizacion() {
  return Array.from(document.querySelectorAll('#gc-items .gc-fila'))
    .map(fila => ({
      servicio: fila.querySelector('.gc-servicio').value,
      leyenda: fila.querySelector('.gc-leyenda').value.trim(),
      importe: Number(fila.querySelector('.gc-importe').value) || 0
    }))
    .filter(item => item.servicio || item.importe || item.leyenda);
}

let EDITOR_MODO='existente';
function prepararEditorCotizacion(lead,modo){
  EDITOR_MODO=modo;
  const editor=document.getElementById('editor-cotizacion');
  if(modo==='nuevo')document.getElementById('editor-nuevo-destino').append(editor);
  else document.getElementById('ed-notas').closest('.form-grid-2').after(editor);
  editor.hidden=false;
  ['sn-servicio','sn-valor','ed-servicio','ed-valor','ed-canal'].forEach(id=>document.getElementById(id).parentElement.hidden=true);
  document.getElementById('gc-items').innerHTML='';GC_CONTADOR=0;
  let items;try{items=JSON.parse(lead?.partidas_json||'null');}catch{}
  (items||[{servicio:lead?.servicio_nombre||'',leyenda:descripcionServicio(lead?.servicio_nombre||''),importe:lead?.valor??0}]).forEach(agregarFilaCotizacion);
  actualizarTotalCotizacion();sincronizarEditor();
}
function sincronizarEditor(){
  const items=recolectarItemsCotizacion(),prefijo=EDITOR_MODO==='nuevo'?'sn':'ed';
  const servicio=CATALOGOS.servicios.find(s=>s.nombre===items[0]?.servicio);
  document.getElementById(prefijo+'-servicio').value=servicio?.id||'';
  document.getElementById(prefijo+'-valor').value=items.reduce((t,i)=>t+i.importe,0);
}
function validarEditorCotizacion(){
  const filas=[...document.querySelectorAll('#gc-items .gc-fila')];
  if(!filas.length||filas.some(f=>!f.querySelector('.gc-servicio').value||f.querySelector('.gc-importe').value===''||!Number.isFinite(Number(f.querySelector('.gc-importe').value))||Number(f.querySelector('.gc-importe').value)<0)){toast('Selecciona un servicio e importe válido en cada partida');return false;}return true;
}
async function descargarCotizacionActual(){
  const formato=document.querySelector('input[name="gc-formato"]:checked').value;
  const datos=datosCotizacionDesdeLead(LEAD_ACTUAL,recolectarItemsCotizacion());
  if(formato==='pdf')await generarPDFCotizacion(datos);else await generarWordCotizacion(datos);
  toast('Cotización guardada y descargada');
}
on('btn-gc-agregar-servicio', 'click', () => { agregarFilaCotizacion(); });

on('gc-items', 'change', async e => {
  if (e.target.classList.contains('gc-servicio')) {
    const fila = e.target.closest('.gc-fila');
    const leyendaEl = fila.querySelector('.gc-leyenda');
    const preset = descripcionServicio(e.target.value);
    const personalizada = leyendaEl.value.trim() && leyendaEl.value !== (leyendaEl.dataset.plantilla || '');
    if (!personalizada || await solicitarDialogo({titulo:'Descripción editada',mensaje:'¿Reemplazar la descripción que editaste por la plantilla del servicio seleccionado?',aceptar:'Usar plantilla'})) leyendaEl.value = preset;
    leyendaEl.dataset.plantilla = preset;
  }
});
on('gc-items', 'input', e => {
  if (e.target.classList.contains('gc-importe')) actualizarTotalCotizacion();
});
on('gc-items', 'click', e => {
  if (e.target.classList.contains('gc-quitar')) {
    if (document.querySelectorAll('#gc-items .gc-fila').length <= 1) {
      toast('La cotización debe tener al menos un servicio');
      return;
    }
    e.target.closest('.gc-fila').remove();
    actualizarTotalCotizacion();
  }
});

on('btn-gc-generar','click',async e=>{
  if(!validarEditorCotizacion())return;
  const btn=e.currentTarget;btn.disabled=true;
  try{
    if(EDITOR_MODO==='nuevo'){await guardarServicioNuevo(true);return;}
    const respuesta=await api('/leads/'+LEAD_ACTUAL.id,{method:'PUT',body:JSON.stringify(recolectarPayloadFicha())});
    LEAD_ACTUAL={...LEAD_ACTUAL,...await respuesta.json()};
    FlujoCRM.marcarGuardado('overlay-ficha');
    await descargarCotizacionActual();
  }catch(err){toast('No se pudo guardar o descargar: '+err.message);}finally{btn.disabled=false;}
});

// ---------- Exportar a Excel (CSV con BOM, se abre directo con Excel) ----------
function descargarCSV(nombreArchivo, columnas, filas) {
  const escaparCelda = valor => {
    const texto = String(valor ?? '');
    return /[",\n;]/.test(texto) ? '"' + texto.replace(/"/g, '""') + '"' : texto;
  };
  const encabezado = columnas.map(c => escaparCelda(c.titulo)).join(',');
  const cuerpo = filas.map(f => columnas.map(c => escaparCelda(c.valor(f))).join(',')).join('\r\n');
  const csv = '\uFEFF' + encabezado + '\r\n' + cuerpo;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

on('btn-exportar-leads', 'click', async () => {
  // Exporta el historial completo de cotizaciones (abiertas, ganadas y perdidas) respetando
  // los filtros activos en la vista, sin forzar estatus=abierto como hace el pipeline en pantalla.
  const params = new URLSearchParams();
  const resp = document.getElementById('f-responsable').value;
  const q = document.getElementById('f-buscar').value;
  const desde = document.getElementById('f-desde').value;
  const hasta = document.getElementById('f-hasta').value;
  if (resp) params.set('responsable_id', resp);
  if (q) params.set('q', q);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  if (ETAPA_FILTRO) params.set('etapa', ETAPA_FILTRO);
  const leads = await api('/leads?' + params.toString()).then(r => r.json());
  if (!leads.length) { toast('No hay cotizaciones con estos filtros para exportar'); return; }
  descargarCSV('cotizaciones_saneadren_' + new Date().toISOString().slice(0, 10) + '.csv', [
    { titulo: 'ID', valor: l => l.id },
    { titulo: 'Teléfono', valor: l => l.telefono },
    { titulo: 'Nombre', valor: l => l.nombre || '' },
    { titulo: 'Empresa', valor: l => l.empresa_contacto || '' },
    { titulo: 'Dirección', valor: l => l.direccion || '' },
    { titulo: 'Canal', valor: l => l.canal_nombre || '' },
    { titulo: 'Servicio', valor: l => l.servicio_nombre || '' },
    { titulo: 'Responsable', valor: l => l.responsable_nombre || '' },
    { titulo: 'Etapa', valor: l => l.etapa },
    { titulo: 'Estatus', valor: l => l.estatus },
    { titulo: 'Servicio cotizado o contratado', valor: l => l.estatus === 'ganado' ? 'Contratado' : 'Cotizado' },
    { titulo: 'Valor (MXN)', valor: l => l.valor ?? '' },
    { titulo: 'Fecha del servicio', valor: l => l.fecha_servicio || '' },
    { titulo: 'Notas', valor: l => l.notas_iniciales || '' },
    { titulo: 'Creado por', valor: l => l.creado_por || '' },
    { titulo: 'Fecha de creación', valor: l => l.created_at },
    { titulo: 'Última actualización', valor: l => l.updated_at }
  ], leads);
  toast(leads.length + ' cotización(es) exportada(s)');
});

on('btn-exportar-clientes', 'click', async () => {
  const q = document.getElementById('fc-buscar').value;
  const desde = document.getElementById('fc-desde').value;
  const hasta = document.getElementById('fc-hasta').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  const clientes = await api('/clientes?incluir_prospectos=1&tipo=' + document.getElementById('fc-tipo').value + '&' + params.toString()).then(r => r.json());
  if (!clientes.length) { toast('No hay clientes con estos filtros para exportar'); return; }
  // El listado de /clientes solo trae conteos; para exportar el detalle de servicios
  // cotizados/contratados por cliente hay que pedir la ficha completa de cada uno.
  toast('Preparando exportación de ' + clientes.length + ' cliente(s)…');
  const detalles = await Promise.all(
    clientes.map(c => api('/clientes/' + c.id).then(r => r.json()).catch(() => null))
  );
  const clientesConServicios = clientes.map((c, i) => ({ ...c, servicios: (detalles[i] && detalles[i].servicios) || [] }));
  const listaServicios = (servicios, filtro) => servicios
    .filter(s => filtro(s.estatus))
    .map(s => s.servicio_nombre || 'Sin servicio')
    .join('; ');
  descargarCSV('clientes_saneadren_' + new Date().toISOString().slice(0, 10) + '.csv', [
    { titulo: 'ID', valor: c => c.id },
    { titulo: 'Teléfono', valor: c => c.telefono },
    { titulo: 'Nombre', valor: c => c.nombre || '' },
    { titulo: 'Empresa', valor: c => c.empresa_contacto || '' },
    { titulo: 'Dirección', valor: c => c.direccion || '' },
    { titulo: 'Servicios cotizados', valor: c => listaServicios(c.servicios, e => e === 'abierto') },
    { titulo: 'Servicios contratados', valor: c => listaServicios(c.servicios, e => e === 'ganado') },
    { titulo: 'Servicios ganados', valor: c => c.servicios_ganados },
    { titulo: 'Solicitudes abiertas', valor: c => c.solicitudes_abiertas },
    { titulo: 'Valor ganado total (MXN)', valor: c => c.valor_ganado_total },
    { titulo: 'Última actividad', valor: c => c.ultima_actividad }
  ], clientesConServicios);
  toast(clientesConServicios.length + ' cliente(s) exportado(s)');
});

// ---------- Vista Clientes ----------
let CLIENTE_ACTUAL = null;

async function cargarClientes() {
  const q = document.getElementById('fc-buscar').value;
  const desde = document.getElementById('fc-desde').value;
  const hasta = document.getElementById('fc-hasta').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  const [clientes, kpis] = await Promise.all([
    api('/clientes?incluir_prospectos=1&tipo=' + document.getElementById('fc-tipo').value + '&' + params.toString()).then(r => r.json()),
    api('/kpis').then(r => r.json())
  ]);
  renderResumenClientes(kpis.resumen_clientes || {});
  renderTablaClientesReales(clientes);
}
on('fc-buscar', 'input', debounce(cargarClientes, 350));
on('fc-desde', 'change', cargarClientes);
on('fc-hasta', 'change', cargarClientes);

function renderTablaClientesReales(clientes) {
  const body = document.getElementById('tabla-clientes-reales-body');
  document.getElementById('tabla-conteo-clientes').textContent =
    clientes.length + (clientes.length === 1 ? ' contacto' : ' contactos');
  if (!clientes.length) {
    body.innerHTML = '<tr><td class="util-37" colspan="9">No hay contactos con estos filtros. Puedes crear uno desde Nuevo contacto.</td></tr>';
    return;
  }
  body.innerHTML = clientes.map(c => `
    <tr onclick="abrirFichaCliente(${c.id})">
      <td>#${c.id}</td>
      <td class="tel">${c.telefono}</td>
      <td><b>${escaparHtml(c.nombre || '—')}</b><small class="contacto-relacion">${c.servicios_ganados > 0 ? 'Cliente' : 'Prospecto · aún no ha contratado'}</small></td>
      <td>${c.empresa_contacto || '—'}</td>
      <td>${c.direccion || '—'}</td>
      <td><span class="tag-alerta-tabla util-38">${c.servicios_ganados} servicio${c.servicios_ganados === 1 ? '' : 's'}</span></td>
      <td>${formatoMoneda(c.valor_ganado_total)}</td>
      <td>${c.solicitudes_abiertas > 0 ? `<span class="tag-estatus abierto">${c.solicitudes_abiertas} en leads</span>` : '—'}</td>
      <td>${fechaCorta(c.ultima_actividad)}</td>
    </tr>
  `).join('');
}

// ---------- Ficha de cliente ----------
async function abrirFichaCliente(id) {
  if (!await FlujoCRM.permitirCambio('overlay-ficha-cliente')) return;
  const cliente = await api('/clientes/' + id).then(r => r.json());
  CLIENTE_ACTUAL = cliente;

  document.getElementById('fc-titulo').textContent = `${cliente.telefono} · ${cliente.nombre || 'Sin nombre'}`;
  document.getElementById('fc-meta').innerHTML = metaClienteHTML(cliente);
  document.getElementById('fc-ed-telefono').value = cliente.telefono || '';
  document.getElementById('fc-ed-telefono-alterno').value = cliente.telefono_alterno || '';
  document.getElementById('fc-ed-nombre').value = cliente.nombre || '';
  document.getElementById('fc-ed-correo').value = cliente.correo || '';
  document.getElementById('fc-ed-empresa').value = cliente.empresa_contacto || '';
  document.getElementById('fc-ed-rfc').value = cliente.rfc || '';
  document.getElementById('fc-ed-direccion').value = cliente.direccion || '';
  document.getElementById('fc-ed-giro').value = cliente.giro || '';
  document.getElementById('fc-ed-notas-generales').value = cliente.notas_generales || '';

  renderServiciosCliente(cliente.servicios || []);
  abrirVentana('overlay-ficha-cliente');
  FlujoCRM.presentarContacto(cliente);
  FlujoCRM.marcarGuardado('overlay-ficha-cliente');
}

function renderServiciosCliente(servicios) {
  ServiciosTabla.render('fc-servicios', servicios, CLIENTE_ACTUAL.id, 'cliente');
}

async function cambiarEstatusServicio(leadId, estatus) {
  try {
    const body = { estatus, usuario: USUARIO_ACTUAL ? USUARIO_ACTUAL.nombre : null };
    await api('/leads/' + leadId, { method: 'PUT', body: JSON.stringify(body) });
    toast(estatus === 'ganado' ? 'Servicio contratado. El contacto ya aparece como cliente.' : estatus === 'perdido' ? 'Cotización no aceptada; conservada en el historial.' : 'Cotización reabierta');
  } catch (err) {
    toast('No se pudo cambiar el estatus: ' + err.message);
    return;
  }
  try { await ServiciosTabla.refrescar(); } catch (err) { toast('Estatus guardado; recarga para actualizar las tablas.'); }
}

// Chips de la ficha de cliente, incluyendo la próxima recompra sugerida (si aplica) —
// es la pieza que convierte a un cliente ya ganado en la siguiente oportunidad de venta.
function metaClienteHTML(cliente) {
  const registros = cliente.servicios || [];
  const abiertas = registros.filter(s=>s.estatus==='abierto');
  return '<span class="chip">Cotizaciones abiertas: <b>'+abiertas.length+'</b></span><span class="chip">Cotizaciones no aceptadas: <b>'+registros.filter(s=>s.estatus==='perdido').length+'</b></span><span class="chip recontratado">Servicios contratados: <b>'+registros.filter(s=>s.estatus==='ganado').length+'</b></span><span class="chip valor-chip">Importe contratado: <b>'+formatoMoneda(cliente.valor_ganado_total)+'</b></span>';
}

on('btn-cerrar-modal-cliente', 'click', () => {
  document.getElementById('overlay-ficha-cliente').classList.remove('mostrar');
  cargarClientes();
  cargarLeads();
});

on('btn-guardar-cliente', 'click', async () => {
  if (!CLIENTE_ACTUAL) return;
  const payload = {
    telefono: document.getElementById('fc-ed-telefono').value.trim(),
    telefono_alterno: document.getElementById('fc-ed-telefono-alterno').value.trim(),
    nombre: document.getElementById('fc-ed-nombre').value.trim(),
    correo: document.getElementById('fc-ed-correo').value.trim(),
    empresa_contacto: document.getElementById('fc-ed-empresa').value.trim(),
    rfc: document.getElementById('fc-ed-rfc').value.trim(),
    direccion: document.getElementById('fc-ed-direccion').value.trim(),
    giro: document.getElementById('fc-ed-giro').value,
    notas_generales: document.getElementById('fc-ed-notas-generales').value.trim()
  };
  try {
    const res = await api('/clientes/' + CLIENTE_ACTUAL.id, { method: 'PUT', body: JSON.stringify(payload) });
    if (res.status === 409) {
      const data = await res.json();
      toast(data.error || 'Ese teléfono ya pertenece a otro cliente');
      return;
    }
    toast('Datos del cliente actualizados');
    const cliente = await api('/clientes/' + CLIENTE_ACTUAL.id).then(r => r.json());
    CLIENTE_ACTUAL = cliente;
    FlujoCRM.presentarContacto(cliente);
    if (LEAD_ACTUAL?.cliente_id === cliente.id) FlujoCRM.presentarRegistro(LEAD_ACTUAL, cliente);
    FlujoCRM.marcarGuardado('overlay-ficha-cliente');
    await cargarClientes();
  } catch (err) {
    toast('No se pudo guardar: ' + err.message);
  }
});

on('btn-recapturar-servicio', 'click', () => FlujoCRM.nuevoRegistro(CLIENTE_ACTUAL.id, 'directo'));
on('btn-contacto-cotizar', 'click', () => FlujoCRM.nuevoRegistro(CLIENTE_ACTUAL.id, 'pipeline'));



// ---------- Ficha de lead (modal) ----------
async function abrirFicha(id) {
  if (!await FlujoCRM.permitirCambio('overlay-ficha')) return;
  const lead = await api('/leads/' + id).then(r => r.json());
  const clienteServicios = lead.cliente_id ? await api('/clientes/' + lead.cliente_id).then(r => r.json()) : null;
  lead.servicios_cliente = clienteServicios ? clienteServicios.servicios : [lead];
  LEAD_ACTUAL = lead;
  ETAPA_FICHA = lead.etapa;

  document.getElementById('ficha-titulo').textContent = `${lead.telefono} · ${lead.nombre || 'Sin nombre'} · ${lead.servicio_nombre || 'Sin servicio'}`;
  renderFichaMeta(lead);
  document.getElementById('ed-direccion').value = lead.direccion || '';
  document.getElementById('ed-canal').value = lead.canal_id || '';
  document.getElementById('ed-servicio').value = lead.servicio_id || '';
  document.getElementById('ed-responsable').value = lead.responsable_id || '';
  document.getElementById('ed-valor').value = lead.valor != null ? lead.valor : '';
  document.getElementById('ed-fecha-servicio').value = lead.fecha_servicio || '';
  document.getElementById('ed-notas').value = lead.notas_iniciales || '';
  document.getElementById('ed-creado-por').textContent = lead.creado_por || '—';
  document.getElementById('ed-created-at').textContent = fechaCorta(lead.created_at) || '—';
  document.getElementById('ed-estatus-actual').textContent = lead.estatus || '—';

  document.getElementById('btn-recomprar').style.display = lead.cliente_id ? 'inline-flex' : 'none';

  // Mostrar/ocultar botones según estatus actual
  const esAbierto = lead.estatus === 'abierto';
  document.getElementById('btn-convertir-cliente').style.display = esAbierto ? 'inline-flex' : 'none';
  document.getElementById('btn-marcar-perdido').style.display = esAbierto ? 'inline-flex' : 'none';
  document.getElementById('btn-reabrir').style.display = !esAbierto ? 'inline-flex' : 'none';

  actualizarPipeline();

  renderServiciosAnteriores(lead.otras_solicitudes || []);
  abrirVentana('overlay-ficha');
  FlujoCRM.presentarRegistro(lead, clienteServicios);
  prepararEditorCotizacion(lead,'existente');
  FlujoCRM.marcarGuardado('overlay-ficha');
}

function renderServiciosAnteriores() {
  ServiciosTabla.render('ficha-anteriores', LEAD_ACTUAL.servicios_cliente || [LEAD_ACTUAL], LEAD_ACTUAL.cliente_id || 'lead-'+LEAD_ACTUAL.id, 'lead');
}

async function cambiarEstatusLeadActual(estatus) {
  if (!LEAD_ACTUAL) return;
  try {
    // Se envían junto los campos de la ficha (cotización, fecha, etc.): así, si el usuario
    // acaba de escribir la cotización final y da clic en "Convertir a Cliente" sin guardar
    // primero, ese dato no se pierde.
    const body = { ...recolectarPayloadFicha(), estatus, usuario: USUARIO_ACTUAL ? USUARIO_ACTUAL.nombre : null };
    await api('/leads/' + LEAD_ACTUAL.id, { method: 'PUT', body: JSON.stringify(body) });
    toast('Cotización ' + (estatus === 'ganado' ? 'cerrada como servicio' : estatus === 'perdido' ? 'descartada' : 'reabierta'));
    FlujoCRM.marcarGuardado('overlay-ficha');
    await abrirFicha(LEAD_ACTUAL.id);
    await ServiciosTabla.refrescar();
  } catch (err) {
    toast('No se pudo cambiar el estatus: ' + err.message);
  }
}
on('btn-convertir-cliente', 'click', () => {
  if(!validarEditorCotizacion())return;sincronizarEditor();
  if(!document.getElementById('ed-servicio').value){toast('Selecciona el servicio que se contratará');document.getElementById('ed-servicio').focus();return;}
  if(!document.getElementById('ed-direccion').value.trim()){toast('Indica la ubicación del servicio');document.getElementById('ed-direccion').focus();return;}
  if (!document.getElementById('ed-fecha-servicio').value) {
    toast('Indica la fecha acordada del servicio antes de aceptar la cotización');
    document.getElementById('ed-fecha-servicio').focus();
    return;
  }
  // Un lead "ganado" sin cotización rompería los reportes de ingresos en Clientes —
  // se exige antes de dejar pasar la conversión (el backend también lo valida).
  if (document.getElementById('ed-valor').value === '') {
    toast('Ingresa el costo del servicio antes de cerrar esta cotización como ganada');
    document.getElementById('ed-valor').focus();
    return;
  }
  cambiarEstatusLeadActual('ganado');
});
on('btn-marcar-perdido', 'click', () => cambiarEstatusLeadActual('perdido'));
on('btn-reabrir', 'click', () => cambiarEstatusLeadActual('abierto'));

on('btn-cerrar-modal', 'click', () => {
  document.getElementById('overlay-ficha').classList.remove('mostrar');
  cargarLeads();
});

function renderFichaMeta(lead) {
  document.getElementById('ficha-meta').innerHTML = '<span class="chip">Registro: <b>#'+lead.id+'</b></span><span class="chip">Estado: <b>'+FlujoCRM.estado(lead.estatus)+'</b></span><span class="chip">Creado: <b>'+fechaCorta(lead.created_at)+'</b></span>';
}

// Pipeline visual clickeable
function actualizarPipeline() {
  document.querySelectorAll('.pipeline-step').forEach(b => {
    const step = Number(b.dataset.step);
    b.classList.toggle('active', step === ETAPA_FICHA);
  });
}

document.querySelectorAll('.pipeline-step').forEach(btn => {
  btn.addEventListener('click', async () => {
    ETAPA_FICHA = Number(btn.dataset.step);
    actualizarPipeline();
    try {
      await api('/leads/' + LEAD_ACTUAL.id, { method: 'PUT', body: JSON.stringify({ etapa: ETAPA_FICHA, usuario: 'Web' }) });
      toast('Etapa actualizada: ' + NOMBRE_ETAPA[ETAPA_FICHA]);
      const lead = await api('/leads/' + LEAD_ACTUAL.id).then(r => r.json());
      LEAD_ACTUAL = lead;

      cargarLeads();
    } catch (err) {
      toast('No se pudo cambiar de etapa: ' + err.message);
      ETAPA_FICHA = LEAD_ACTUAL.etapa;
      actualizarPipeline();
    }
  });
});

function recolectarPayloadFicha() {
  sincronizarEditor();
  const valorRaw = document.getElementById('ed-valor').value;
  return {
    partidas_json: JSON.stringify(recolectarItemsCotizacion()),
    direccion: document.getElementById('ed-direccion').value.trim(),
    canal_id: document.getElementById('ed-canal').value || null,
    servicio_id: document.getElementById('ed-servicio').value || null,
    responsable_id: document.getElementById('ed-responsable').value || null,
    valor: valorRaw === '' ? null : Number(valorRaw),
    fecha_servicio: document.getElementById('ed-fecha-servicio').value || null,
    notas_iniciales: document.getElementById('ed-notas').value.trim() || null
  };
}
on('btn-guardar-ficha', 'click', async () => {
  if(!validarEditorCotizacion())return;
  try {
    const res = await api('/leads/' + LEAD_ACTUAL.id, { method: 'PUT', body: JSON.stringify(recolectarPayloadFicha()) });
    if (res.status === 409) {
      const data = await res.json();
      toast(data.error || 'Ese teléfono ya pertenece a otro cliente');
      return;
    }
    toast('Cambios guardados en este registro');
    FlujoCRM.marcarGuardado('overlay-ficha');
    const lead = await api('/leads/' + LEAD_ACTUAL.id).then(r => r.json());
    LEAD_ACTUAL = lead;
    renderFichaMeta(lead);
    await ServiciosTabla.refrescar();
  } catch (err) {
    toast('No se pudo guardar: ' + err.message);
  }
});

on('btn-recomprar', 'click', () => FlujoCRM.nuevoRegistro(LEAD_ACTUAL.cliente_id, 'directo'));


on('btn-eliminar-lead', 'click', async () => {
  if (!LEAD_ACTUAL) return;
  try { await ServiciosTabla.eliminar(LEAD_ACTUAL); }
  catch (err) { toast('No se pudo eliminar: ' + err.message); }
});

on('obs-es-alerta', 'change', e => {
  document.getElementById('obs-fecha').classList.toggle('show', e.target.checked);
  document.getElementById('obs-fecha-rapida').classList.toggle('show', e.target.checked);
});
function formatoDatetimeLocal(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
document.querySelectorAll('[data-rapido]').forEach(btn => {
  btn.addEventListener('click', () => {
    const ahora = new Date();
    let fecha;
    if (btn.dataset.rapido === 'manana') { fecha = new Date(ahora); fecha.setDate(fecha.getDate() + 1); fecha.setHours(9, 0, 0, 0); }
    else if (btn.dataset.rapido === '3dias') { fecha = new Date(ahora); fecha.setDate(fecha.getDate() + 3); fecha.setHours(9, 0, 0, 0); }
    else { fecha = new Date(ahora); fecha.setDate(fecha.getDate() + 7); fecha.setHours(9, 0, 0, 0); }
    document.getElementById('obs-fecha').value = formatoDatetimeLocal(fecha);
  });
});

on('btn-agregar-obs', 'click', async () => {
  const texto = document.getElementById('obs-texto').value.trim();
  if (!texto) { toast('Escribe una observación'); return; }
  const esAlerta = document.getElementById('obs-es-alerta').checked;
  const fecha = document.getElementById('obs-fecha').value;
  if (esAlerta && !fecha) { toast('Indica la fecha/hora de la alerta'); return; }
  try {
    await api('/leads/' + LEAD_ACTUAL.id + '/historial', {
      method: 'POST',
      body: JSON.stringify({
        tipo: esAlerta ? 'alerta' : 'observacion',
        texto,
        fecha_alerta: esAlerta ? fecha.replace('T', ' ') + ':00' : null,
        usuario: 'Web'
      })
    });
  } catch (err) {
    toast('No se pudo agregar: ' + err.message);
    return;
  }
  document.getElementById('obs-texto').value = '';
  document.getElementById('obs-es-alerta').checked = false;
  document.getElementById('obs-fecha').classList.remove('show');
  const lead = await api('/leads/' + LEAD_ACTUAL.id).then(r => r.json());
  LEAD_ACTUAL = lead;

  toast(esAlerta ? 'Recordatorio agregado' : 'Observación agregada');
});

// ---------- Vista Pendientes: recompras (servicios por vencer) + alertas, juntas ----------
let FILTRO_PENDIENTE = 'todos';
document.querySelectorAll('[data-filtro-pendiente]').forEach(btn => {
  btn.addEventListener('click', () => {
    FILTRO_PENDIENTE = btn.dataset.filtroPendiente;
    document.querySelectorAll('[data-filtro-pendiente]').forEach(b => b.classList.toggle('activo', b === btn));
    pintarPendientes();
  });
});
let PENDIENTES_DATOS = [];
async function cargarPendientes() {
  const [recompras, alertas] = await Promise.all([
    api('/recompras').then(r => r.json()),
    api('/alertas').then(r => r.json())
  ]);
  actualizarBadgePendientes(recompras.length + alertas.length);
  PENDIENTES_DATOS = [
    ...recompras.map(r => ({ tipo: 'recompra', vencido: r.dias_restantes <= 0, datos: r })),
    ...alertas.map(r => ({ tipo: 'alerta', vencido: false, datos: r }))
  ];
  pintarPendientes();
}
function pintarPendientes() {
  const cont = document.getElementById('lista-pendientes');
  const items = PENDIENTES_DATOS.filter(p => FILTRO_PENDIENTE === 'todos' || p.tipo === FILTRO_PENDIENTE);
  if (!items.length) { cont.innerHTML = '<p class="util-45">No hay pendientes con este filtro por ahora.</p>'; return; }
  cont.innerHTML = items.map(p => p.tipo === 'recompra' ? filaRecompra(p.datos, p.vencido) : filaAlerta(p.datos)).join('');
}
function filaRecompra(r, vencido) {
  const texto = vencido
    ? `Vencido hace ${Math.abs(r.dias_restantes)} día${Math.abs(r.dias_restantes) === 1 ? '' : 's'}`
    : `Vence en ${r.dias_restantes} día${r.dias_restantes === 1 ? '' : 's'}`;
  return `
    <div class="fila-alerta tipo-recompra ${vencido ? 'vencido' : ''}">
      <div class="info">
        <span class="tipo-tag recompra">🔁 Recompra</span>
        <div><b>${r.nombre || 'Sin nombre'} · ${r.telefono}</b></div>
        <div class="txt">${r.servicio_nombre} — última vez: ${r.ultima_fecha}</div>
        <div class="fecha" style="color:${vencido ? 'var(--rojo)' : 'var(--azul-600)'};">${texto} (sugerido: ${r.fecha_sugerida})</div>
      </div>
      <div class="util-46">
        <button class="btn btn-outline" onclick="abrirFichaCliente(${r.cliente_id})">Ver cliente</button>
        <button class="btn btn-primario" onclick='recontactarRecompra(${r.cliente_id},"${encodeURIComponent(r.telefono || '')}","${encodeURIComponent(r.nombre || '')}","${encodeURIComponent(r.empresa_contacto || '')}","${encodeURIComponent(r.direccion || '')}",${r.servicio_id},${r.ultimo_valor == null ? 'null' : r.ultimo_valor})'>➕ Registrar servicio nuevo</button>
      </div>
    </div>`;
}
function filaAlerta(r) {
  return `
    <div class="fila-alerta tipo-alerta">
      <div class="info">
        <span class="tipo-tag alerta">⏰ Alerta</span>
        <div><b>${r.lead_nombre || 'Sin nombre'} · ${r.telefono}</b></div>
        <div class="txt">${r.texto}</div>
        <div class="fecha">Para: ${fechaCorta(r.fecha_alerta)} · Responsable: ${r.responsable_nombre || '—'}</div>
      </div>
      <div class="util-46">
        <button class="btn btn-outline" onclick="abrirFicha(${r.lead_id})">Ver ficha</button>
        <button class="btn btn-verde" onclick="resolverAlertaGlobal(${r.id})">Resuelta</button>
      </div>
    </div>`;
}
async function recontactarRecompra(id, telefono, nombre, empresa_contacto, direccion, servicio_id, ultimo_valor) {
  await FlujoCRM.nuevoRegistro(id, 'directo');
}
async function resolverAlertaGlobal(id) {
  await api('/historial/' + id + '/resolver', { method: 'PUT' });
  cargarPendientes();
}
async function actualizarBadgePendientes(n) {
  const b = document.getElementById('badge-pendientes');
  if (n === undefined) {
    const [recompras, alertas] = await Promise.all([
      api('/recompras').then(r => r.json()),
      api('/alertas').then(r => r.json())
    ]);
    n = recompras.length + alertas.length;
  }
  b.textContent = n;
  b.style.display = n > 0 ? 'inline-block' : 'none';
}

// ---------- Login ----------
on('form-login', 'submit', async e => {
  e.preventDefault();
  const nombre = document.getElementById('login-nombre').value;
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  try {
    const usuario = await login(nombre, password);
    guardarSesion(usuario);
    document.getElementById('overlay-login').classList.remove('mostrar');
    iniciarApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
});
on('btn-logout', 'click', cerrarSesion);
on('btn-descargar-respaldo', 'click', async () => {
  try {
    const res = await api('/admin/backup');
    const blob = await res.blob();
    const nombre = (res.headers.get('content-disposition') || '').match(/filename="?([^"]+)"?/)?.[1] || 'saneadren_backup.db';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Respaldo descargado');
  } catch (err) {
    toast('No se pudo descargar el respaldo: ' + err.message);
  }
});

function mostrarUsuarioEnHeader() {
  document.getElementById('sesion-nombre').textContent = USUARIO_ACTUAL.nombre;
  document.getElementById('nav-usuarios').style.display = USUARIO_ACTUAL.rol === 'admin' ? 'inline-block' : 'none';
}

// ---------- Gestión de usuarios ----------
async function cargarUsuarios() {  const usuarios = await api('/usuarios').then(r => r.json());  const cont = document.getElementById('lista-usuarios');  cont.innerHTML = usuarios.map(u => `    <div class="servicio-row util-47">      <div class="info"><div class="tit">${u.nombre}</div><div class="sub">${u.rol}</div></div>      <div class="actions">        <button class="btn btn-peligro" onclick="eliminarUsuario(${u.id}, '${u.nombre.replace(/'/g, "&#39;")}')"           ${u.rol === 'admin' && usuarios.filter(x=>x.rol==='admin').length===1 ? 'disabled title="Último admin"' : ''}>          Eliminar        </button>      </div>    </div>  `).join('');}async function eliminarUsuario(id, nombre) {  const confirmado = await solicitarDialogo({    titulo: 'Eliminar usuario',    aceptar: 'Eliminar',    mensaje: `¿Eliminar al usuario "${nombre}"?\n\nSus leads históricos se conservarán, pero ya no podrá iniciar sesión.`  });  if (!confirmado) return;  try {    await api('/usuarios/' + id, { method: 'DELETE', body: JSON.stringify({ solicitante_id: USUARIO_ACTUAL.id }) });    toast('Usuario eliminado');    cargarUsuarios();    cargarCatalogos(); /* Actualiza selects de responsables */  } catch (err) {    toast('No se pudo eliminar: ' + err.message);  }}
async function cargarCatalogoServicios() {
  const cont = document.getElementById('lista-servicios-catalogo');
  if (!cont) return;
  const servicios = await api('/servicios').then(r => r.json());
  cont.innerHTML = servicios.map(s => `
    <div class="servicio-row util-47">
      <div class="info"><div class="tit">${escaparHtml(s.nombre)}</div><label for="desc-${s.id}">Descripción predeterminada para cotizaciones</label><textarea id="desc-${s.id}" rows="3" maxlength="10000" placeholder="Descripción que se precargará al elegir este servicio">${escaparHtml(s.descripcion || '')}</textarea></div>
      <div class="actions diseno-overlay-login">
        <input class="util-48" type="number" min="1" step="1" placeholder="Sin recompra" value="${s.dias_recurrencia != null ? s.dias_recurrencia : ''}"
          id="rec-${s.id}">
        <span class="util-49">días</span>
        <button class="btn btn-secundario" onclick="guardarRecurrenciaServicio(${s.id})">Guardar</button>
      </div>
    </div>
  `).join('');
}
async function guardarRecurrenciaServicio(id) {
  const valor = document.getElementById('rec-' + id).value;
  try {
    await api('/servicios/' + id, {
      method: 'PUT',
      body: JSON.stringify({ dias_recurrencia: valor === '' ? null : Number(valor), descripcion: document.getElementById('desc-' + id).value, solicitante_id: USUARIO_ACTUAL.id })
    });
    toast('Descripción y recurrencia guardadas');
    cargarCatalogos();
  } catch (err) {
    toast('No se pudo guardar: ' + err.message);
  }
}

on('btn-crear-servicio', 'click', async () => {
  const nombre = document.getElementById('ns-nombre').value.trim();
  const dias = document.getElementById('ns-dias').value;
  if (!nombre) { toast('Escribe un nombre para el servicio'); return; }
  try {
    const res = await api('/servicios', {
      method: 'POST',
      body: JSON.stringify({ nombre, descripcion: document.getElementById('ns-descripcion').value, dias_recurrencia: dias === '' ? null : Number(dias), solicitante_id: USUARIO_ACTUAL.id })
    });
    if (res.status === 409) {
      const data = await res.json();
      toast(data.error || 'Ya existe un servicio con ese nombre');
      return;
    }
    toast('Servicio agregado');
    document.getElementById('ns-nombre').value = '';
    document.getElementById('ns-descripcion').value = '';
    document.getElementById('ns-dias').value = '';
    cargarCatalogoServicios();
    cargarCatalogos();
  } catch (err) {
    toast('No se pudo agregar: ' + err.message);
  }
});

async function cargarCanalesCatalogo() {
  const cont = document.getElementById('lista-canales-catalogo');
  if (!cont) return;
  const canales = await api('/canales').then(r => r.json());
  cont.innerHTML = canales.map(c => `
    <div class="servicio-row util-47">
      <div class="info"><div class="tit">${c.nombre}</div></div>
    </div>
  `).join('');
}

on('btn-crear-canal', 'click', async () => {
  const nombre = document.getElementById('nc-nombre').value.trim();
  if (!nombre) { toast('Escribe un nombre para el canal'); return; }
  try {
    const res = await api('/canales', {
      method: 'POST',
      body: JSON.stringify({ nombre, solicitante_id: USUARIO_ACTUAL.id })
    });
    if (res.status === 409) {
      const data = await res.json();
      toast(data.error || 'Ya existe un canal con ese nombre');
      return;
    }
    toast('Canal agregado');
    document.getElementById('nc-nombre').value = '';
    cargarCanalesCatalogo();
    cargarCatalogos();
  } catch (err) {
    toast('No se pudo agregar: ' + err.message);
  }
});

on('btn-crear-usuario', 'click', async () => {
  const nombre = document.getElementById('nu-nombre').value.trim();
  const password = document.getElementById('nu-password').value;
  const rol = document.getElementById('nu-rol').value;
  if (!nombre) { toast('Escribe un nombre'); return; }
  if (!password || password.length < 4) { toast('La contraseña debe tener al menos 4 caracteres'); return; }
  try {
    const res = await api('/usuarios', {
      method: 'POST',
      body: JSON.stringify({ nombre, password, rol, solicitante_id: USUARIO_ACTUAL.id })
    });
    if (res.status === 409) {
      const data = await res.json();
      toast(data.error || 'Ya existe un usuario con ese nombre');
      return;
    }
    toast('Usuario creado correctamente');
    document.getElementById('nu-nombre').value = '';
    document.getElementById('nu-password').value = '';
    cargarUsuarios();
    cargarCatalogos();
  } catch (err) {
    toast('No se pudo crear: ' + err.message);
  }
});

// ---------- Inicio ----------
async function iniciarApp() {
  mostrarUsuarioEnHeader();
  await cargarCatalogos();
  await cargarLeads();
  actualizarBadgePendientes();
  setInterval(actualizarBadgePendientes, 60000);
}
cargarSesion();
if (USUARIO_ACTUAL) {
  iniciarApp();
} else {
  abrirVentana('overlay-login');
}

async function cargarTiposCliente(){
  let tipos;
  try { tipos=await api('/tipos-cliente').then(r=>r.json()); }
  catch(error){
    document.getElementById('lista-tipos-cliente').textContent='No se pudo cargar el catálogo. Si acabas de actualizar el CRM, reinicia el servidor y recarga la página.';
    document.getElementById('btn-agregar-tipo').disabled=true;
    // Mantiene las opciones conocidas para que un fallo del catálogo no bloquee el inicio.
    tipos=CATALOGOS.tipos || [{clave:'residencial',nombre:'Residencial'},{clave:'comercial',nombre:'Comercial'},{clave:'industrial',nombre:'Industrial'}];
    for(const id of ['in-giro','fc-ed-giro']){const el=document.getElementById(id);if(!el.options.length || el.options.length===1){el.innerHTML='<option value="">Sin especificar</option>'+tipos.map(t=>`<option value="${escaparHtml(t.clave)}">${escaparHtml(t.nombre)}</option>`).join('');}}
    CATALOGOS.tipos=tipos;
    toast('Catálogo de tipos no disponible. Reinicia el servidor si acabas de actualizar.');
    return;
  }
  document.getElementById('btn-agregar-tipo').disabled=false;
  CATALOGOS.tipos=tipos;
  for(const id of ['in-giro','fc-ed-giro']){const el=document.getElementById(id),valor=el.value;el.innerHTML='<option value="">Sin especificar</option>'+tipos.map(t=>`<option value="${escaparHtml(t.clave)}">${escaparHtml(t.nombre)}</option>`).join('');el.value=valor;}
  document.getElementById('lista-tipos-cliente').innerHTML=tipos.map(t=>`<div class="servicio-row"><label for="tipo-${escaparHtml(t.clave)}">Tipo de cliente</label><input id="tipo-${escaparHtml(t.clave)}" value="${escaparHtml(t.nombre)}" maxlength="80"><button type="button" class="btn btn-secundario" data-tipo-clave="${escaparHtml(t.clave)}">Guardar nombre</button></div>`).join('');
}
on('lista-tipos-cliente','click',async e=>{const btn=e.target.closest('[data-tipo-clave]');if(!btn)return;btn.disabled=true;try{const clave=btn.dataset.tipoClave;const r=await api('/tipos-cliente/'+encodeURIComponent(clave),{method:'PUT',body:JSON.stringify({nombre:document.getElementById('tipo-'+clave).value})});if(!r.ok)throw Error((await r.json()).error);await cargarTiposCliente();toast('Tipo actualizado; los clientes conservan su clasificación.');}catch(err){toast(err.message);}finally{btn.disabled=false;}});
on('btn-agregar-tipo','click',async e=>{const btn=e.currentTarget;btn.disabled=true;try{const r=await api('/tipos-cliente',{method:'POST',body:JSON.stringify({nombre:document.getElementById('nuevo-tipo-cliente').value})});if(!r.ok)throw Error((await r.json()).error);document.getElementById('nuevo-tipo-cliente').value='';await cargarTiposCliente();toast('Tipo de cliente agregado');}catch(err){toast(err.message);}finally{btn.disabled=false;}});

function renderGraficosComerciales(d){
  const r=d.resumen,activos=d.clientes.filter(c=>c.servicios>0).sort((a,b)=>b.contratado-a.contratado);
  const concentracion=r.contratado?100*activos.slice(0,3).reduce((t,c)=>t+c.contratado,0)/r.contratado:null;
  const viejas=(d.antiguedad||[]).filter(a=>a.grupo>=2).reduce((t,a)=>t+a.cantidad,0);
  const kpis=[['Participación de los 3 principales clientes',concentracion===null?'—':concentracion.toFixed(1)+'%'],['Clientes activos que son recurrentes',r.clientes?(100*r.recurrentes/r.clientes).toFixed(1)+'%':'—'],['Propuestas abiertas de más de 30 días',viejas]];
  document.getElementById('res-kpis-extra').innerHTML=kpis.map(([titulo,valor])=>`<div class="res-card"><div class="res-num">${valor}</div><div class="res-label">${titulo}</div></div>`).join('');
  renderBarChart('res-conversion',d.canales.filter(c=>c.nuevos).map(c=>({nombre:c.canal+' ('+c.convertidos+'/'+c.nuevos+')',valor:100*c.convertidos/c.nuevos})).sort((a,b)=>b.valor-a.valor),'nombre','valor',v=>v.toFixed(1)+'%');
  renderBarChart('res-top-valor',activos.slice(0,10),'nombre','contratado',formatoMoneda);
  const labels=['0–7 días','8–30 días','31–60 días','Más de 60 días'];
  renderBarChart('res-antiguedad',labels.map((nombre,i)=>({nombre,valor:(d.antiguedad||[]).find(a=>a.grupo===i)?.cantidad||0})),'nombre','valor',v=>v+' propuestas');
  renderBarChart('res-repeticion',[{nombre:'Una contratación histórica',valor:r.clientes-r.recurrentes},{nombre:'Más de una contratación',valor:r.recurrentes}],'nombre','valor',v=>v+' clientes');
  const mensual=d.mensual||[],cont=document.getElementById('res-tendencia');
  if(!mensual.length){cont.innerHTML='<p>Sin contrataciones con fecha en este periodo.</p>';return;}
  const meses=new Map(mensual.map(m=>[m.mes,m]));const primero=mensual[0].mes,ultimo=mensual[mensual.length-1].mes;
  const serie=[];let fecha=new Date(primero+'-01T12:00:00Z');
  while(fecha.toISOString().slice(0,7)<=ultimo && serie.length<1200){const mes=fecha.toISOString().slice(0,7);serie.push(meses.get(mes)||{mes,importe:0,servicios:0});fecha.setUTCMonth(fecha.getUTCMonth()+1);}
  const max=Math.max(1,...serie.map(m=>m.importe)),w=960,h=240;
  const puntos=serie.map((m,i)=>({x:70+(serie.length===1?420:i*840/(serie.length-1)),y:190-160*m.importe/max,...m}));
  cont.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Importe contratado por mes" style="display:block;width:100%;max-height:300px"><line x1="70" y1="190" x2="910" y2="190" stroke="#9aa4ad"/><text x="2" y="24" font-size="12">${formatoMoneda(max)}</text><text x="12" y="192" font-size="12">$0</text><polyline points="${puntos.map(p=>p.x+','+p.y).join(' ')}" fill="none" stroke="#bb8200" stroke-width="3"/>${puntos.map((p,i)=>`<circle cx="${p.x}" cy="${p.y}" r="4" fill="#f6b103"><title>${p.mes}: ${formatoMoneda(p.importe)} · ${p.servicios} servicios</title></circle>${i===0||i===puntos.length-1||i%Math.max(1,Math.ceil(puntos.length/8))===0?`<text x="${p.x}" y="215" text-anchor="middle" font-size="12">${p.mes}</text>`:''}`).join('')}</svg><details><summary>Ver cifras mensuales</summary><div class="tabla-scroll"><table class="tabla-resumen"><thead><tr><th>Mes</th><th>Servicios</th><th>Importe contratado</th></tr></thead><tbody>${serie.map(m=>`<tr><td>${m.mes}</td><td>${m.servicios}</td><td>${formatoMoneda(m.importe)}</td></tr>`).join('')}</tbody></table></div></details>`;
}
