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
const NOMBRE_ETAPA = { 1: 'Recolección de datos', 2: 'Cotización enviada', 3: 'Seguimiento / Negociación', 4: 'Cierre' };

// ---------- Utilidades ----------
function on(id, evento, fn) {
  const el = document.getElementById(id);
  if (!el) {
    console.warn(`[Saneadren] No se encontró el elemento #${id}; no se pudo enlazar el evento '${evento}'.`);
    return;
  }
  el.addEventListener(evento, fn);
}
// Los avisos de error se quedan más tiempo en pantalla para que alcancen a leerse.
let TOAST_TIMER = null;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  if (TOAST_TIMER) clearTimeout(TOAST_TIMER);
  const esError = /no se pudo|error|sin conexi|no tienes|solo un/i.test(String(msg));
  TOAST_TIMER = setTimeout(() => t.style.display = 'none', esError ? 7000 : 3500);
}
function errorConEstado(mensaje, status, codigo) {
  const err = new Error(mensaje);
  err.status = status;
  if (codigo) err.codigo = codigo;
  return err;
}
// Toda escritura revisa la respuesta. api() ya lanza los rechazos, salvo el 409 (conflicto: teléfono de otro cliente, nombre
// repetido…), que deja pasar para que cada pantalla lo resuelva; quien no lo revisa diría «guardado» sin haberse guardado.
// Este ayudante lanza también el 409 con su mensaje (la auditoría total exige revisar cada llamada que guarda).
async function exigirOk(res, porDefecto = 'No se pudo guardar') {
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw errorConEstado(j.error || porDefecto, res.status, j.codigo);
  return j;
}
// Sucursal que se está viendo (la elige el selector de arriba; vacío = todas las permitidas).
// También lleva «Ver como este rol» si Dirección lo activó (permisos.js).
function encabezadoSucursal() { let v = ''; try { v = localStorage.getItem('sucursal_vista') || ''; } catch {} return { ...(v ? { 'X-Sucursal': v } : {}), ...(typeof Permisos !== 'undefined' ? Permisos.encabezado() : {}) }; }
async function api(path, opts) {
  // Sin sesión no se intenta nada: evita peticiones repetidas tras un 401 y pantallas a medias.
  const token = USUARIO_ACTUAL?.token;
  if (!token) {
    document.getElementById('overlay-login')?.classList.add('mostrar');
    throw errorConEstado('Inicia sesión para continuar.', 401);
  }
  let res;
  try {
    const { headers: extra, ...resto } = opts || {};
    res = await fetch(API + path, {
      ...resto,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...encabezadoSucursal(), ...(extra || {}) },
    });
  } catch (e) {
    // Sin internet o servidor caído: la sesión se conserva y el mensaje es comprensible.
    throw errorConEstado('Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.', 0, 'SIN_CONEXION');
  }
  if (res.status === 403) {
    const j = await res.clone().json().catch(() => ({}));
    if (j.codigo === 'CAMBIAR_PASSWORD') { Cuentas.pedirCambioObligatorio(); throw errorConEstado(j.error, 403, j.codigo); }
    if (j.codigo === 'SIN_SUCURSAL') { toast(j.error); throw errorConEstado(j.error, 403, j.codigo); }
    if (j.codigo === 'VER_COMO') { toast(j.error); throw errorConEstado(j.error, 403, j.codigo); }
    if (j.codigo === 'SUCURSAL') { try { localStorage.removeItem('sucursal_vista'); } catch {} location.reload(); throw errorConEstado(j.error, 403, j.codigo); }
  }
  if (res.status === 401) {
    // Solo se cierra la sesión con la que se hizo la petición: si mientras tanto alguien inició
    // sesión de nuevo, una respuesta tardía no debe sacarlo.
    if (USUARIO_ACTUAL?.token === token) {
      localStorage.removeItem('usuario_actual');
      USUARIO_ACTUAL = null;
      toast('Tu sesión expiró. Vuelve a iniciar sesión.');
      document.getElementById('overlay-login')?.classList.add('mostrar');
    }
    throw errorConEstado('Sesión expirada', 401);
  }
  if (!res.ok && res.status !== 409) {
    let msg = 'No se pudo completar la operación (código ' + res.status + ')';
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
document.querySelectorAll('header nav [data-vista]').forEach(btn => {
  btn.addEventListener('click', () => cambiarVista(btn.dataset.vista));
});
function cambiarVista(v, opciones) {
  if (v === 'usuarios' && !Permisos.puede('usuarios.administrar')) v = 'inicio';
  if (v === 'personal' && !Permisos.puede('personal.ver')) v = 'inicio';
  if (v === 'prospeccion' && !Permisos.puede('prospeccion.ver')) v = 'inicio';
  if ((v === 'cobrar' || (v === 'cuentas' && !['pagar', 'proveedores'].includes(opciones?.pestana))) && !Permisos.puede('cxc.ver')) v = 'inicio';
  if ((v === 'pagar' || (v === 'cuentas' && ['pagar', 'proveedores'].includes(opciones?.pestana))) && !Permisos.puede('cxp.ver')) v = 'inicio';
  if (v === 'pendientes') v = 'inicio'; // Pendientes ahora es parte de Inicio
  // Cuentas por cobrar y por pagar son dos secciones del menú Finanzas que usan la misma pantalla.
  if (v === 'cuentas') v = ['pagar', 'proveedores'].includes(opciones?.pestana) ? 'pagar' : 'cobrar';
  const seccionCuentas = ['cobrar', 'pagar'].includes(v) ? v : null;
  document.querySelectorAll('.vista').forEach(s => s.classList.remove('activa'));
  document.getElementById('vista-' + (seccionCuentas ? 'cuentas' : v)).classList.add('activa');
  window.MenuPrincipal?.marcar(v);
  if (v === 'inicio') cargarInicio();
  if (v === 'leads') cargarLeads();
  if (v === 'clientes') cargarClientes();
  if (v === 'prospeccion') Prospeccion.cargar();
  if (v === 'personal') Personal.cargar();
  if (v === 'resultados') abrirResultados();
  if (v === 'generador') cargarGenerador();
  if (v === 'calendario') Calendario.cargar();
  if (v === 'compras') Compras.cargar();
  if (v === 'solicitudes') Solicitudes.cargar();
  if (v === 'bitacora') Bitacora.cargar();
  if (v === 'usuarios') cargarUsuarios();
  if (seccionCuentas) Finanzas.cargar({ ...opciones, seccion: seccionCuentas });
  if (v === 'catalogos') { cargarTiposCliente(); cargarCatalogoServicios(); cargarCanalesCatalogo(); }
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
  for (const [idSel, vacio] of [['in-origen', 'Selecciona una opción'], ['fc-ed-origen', 'Sin registrar']]) {
    const origen = document.getElementById(idSel), origenPrevio = origen.value;
    origen.innerHTML = `<option value="">${escaparHtml(vacio)}</option>` + c.map(x=>`<option value="${Number(x.id)}">${escaparHtml(x.nombre)}</option>`).join('');
    origen.value = origenPrevio;
  }

  const optU = u.map(x => `<option value="${x.id}">${escaparHtml(x.nombre)} (${escaparHtml(nombreRol(x.rol))})</option>`).join('');
  const optS = s.map(x => `<option value="${x.id}">${escaparHtml(x.nombre)}</option>`).join('');
  const optC = c.map(x => `<option value="${Number(x.id)}">${escaparHtml(x.nombre)}</option>`).join('');


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
  if (data.cliente.otro_vendedor) {
    // De otro vendedor de su sucursal (y su rol ve «lo suyo»): no se le cotiza ni se ve lo que tiene.
    document.getElementById('dup-titulo').textContent = 'Este cliente ya lo atiende ' + data.cliente.atendido_por + ' (' + data.cliente.folio + ')';
    document.getElementById('dup-lista').innerHTML = '<p>Para no cruzar la cartera, no puedes ver sus cotizaciones ni cotizarle. Pídele a ' + escaparHtml(data.cliente.atendido_por) + ' o al gerente que te lo pase.</p>';
    return;
  }
  if (data.cliente.otra_sucursal) {
    // De otra sucursal: solo se sabe que existe (su ID); se le cotiza al mismo cliente para no duplicarlo.
    document.getElementById('dup-titulo').textContent = 'Este teléfono ya está registrado en otra sucursal (' + data.cliente.folio + ')';
    document.getElementById('dup-lista').innerHTML = '<p>Para no duplicarlo, se le cotiza a ese mismo cliente. Sus datos y lo que ha hecho con la otra sucursal no se muestran aquí ni se modifican.</p><button type="button" class="btn btn-primario" id="btn-dup-otra-sucursal">Cotizarle a este cliente</button>';
    document.getElementById('btn-dup-otra-sucursal').onclick = () => FlujoCRM.irACotizar(data.cliente.id, { ...data.cliente, telefono: telefono, direccion: document.getElementById('in-direccion')?.value || '' });
    return;
  }
  document.getElementById('dup-titulo').textContent = 'Este contacto ya existe: ' + (data.cliente.nombre || data.cliente.telefono);
  document.getElementById('dup-lista').innerHTML = '<p>Abre su ficha para consultar registros anteriores y usar Crear cotización o Crear orden de servicio. Sus datos no se sobrescribirán.</p><button type="button" class="btn btn-primario" onclick="FlujoCRM.irACotizar(' + Number(data.cliente.id) + ')">Abrir ficha del contacto</button>';

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
let DUPLICADO_DE = null; // id de la orden de servicio que se está duplicando (si aplica)
let FECHA_MIN_SERVICIO = ''; // fecha de la cotización que se convierte (el servicio no puede ser antes)
let CONVERTIR_ID = null; // cotización que se convierte en orden de servicio (modo 'convertir')
let ESTABLECIMIENTO_PENDIENTE = null; // { cliente_id, id, direccion } al abrir un contacto desde Prospección
let REGRESO_FICHA = null; // registro cuya ficha se reabre al terminar la ventana de crear (p. ej. tras Duplicar)
async function regresarAFicha() {
  // Si la ventana sigue abierta (p. ej. el usuario eligió volver a sus cambios), no se hace nada todavía.
  if (!REGRESO_FICHA || document.getElementById('overlay-servicio-nuevo').classList.contains('mostrar')) return;
  const id = REGRESO_FICHA; REGRESO_FICHA = null;
  await abrirFicha(id);
}
// Fechas 'AAAA-MM-DD' en horario de México (sin depender de la zona del equipo).
const hoyISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
const sumarDiasISO = (f, dias) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };
function abrirServicioNuevo(modo, prefill) {
  if (!CLIENTE_DUP) return;
  actualizarBotonesEstatusFicha(null);
  MODO_SERVICIO_NUEVO = modo || 'pipeline';
  // 'convertir' usa la misma ventana que una orden nueva, pero guarda sobre la cotización (mismo registro).
  const esDirecto = MODO_SERVICIO_NUEVO === 'directo' || MODO_SERVICIO_NUEVO === 'convertir';
  CONVERTIR_ID = MODO_SERVICIO_NUEVO === 'convertir' ? prefill?.convertir_de || null : null;
  DUPLICADO_DE = MODO_SERVICIO_NUEVO === 'directo' && prefill?.duplicado_de ? prefill.duplicado_de : null;
  document.getElementById('sn-titulo').innerHTML = CONVERTIR_ID
    ? `<span class="tag-estatus ganado">🧾 Orden de servicio</span> Convertir ${escaparHtml(prefill.folio || 'cotización')} en orden de servicio`
    : DUPLICADO_DE
    ? `<span class="tag-estatus ganado">🧾 Orden de servicio</span> Duplicar orden · copia de ${escaparHtml(prefill.folio || '#' + DUPLICADO_DE)}`
    : esDirecto
    ? '<span class="tag-estatus ganado">🧾 Orden de servicio</span> Crear orden de servicio · NUEVA'
    : '<span class="tag-estatus abierto">🔵 Cotización</span> Crear cotización · NUEVA';
  document.getElementById('sn-ayuda').innerHTML = CONVERTIR_ID
    ? 'El cliente aceptó la cotización: ya están cargados sus servicios, importes, IVA y ubicación. Indica la fecha acordada, el equipo (unidad) y el personal que realiza el servicio. La cotización se convierte en esta orden (no se crea otro registro).'
    : DUPLICADO_DE
    ? 'Se copiaron las partidas, importe, ubicación y notas de la orden original. Indica la nueva fecha acordada y ajusta lo que cambie. No se crea ninguna cotización.'
    : esDirecto
    ? 'Úsalo cuando el cliente ya confirmó. Indica el importe y la fecha acordados; aparecerá como contratado en su historial.'
    : 'Completa la propuesta y pulsa Crear cotización. Cerrar esta ventana no crea ningún registro.';
  document.getElementById('sn-label-valor').textContent = esDirecto ? 'Importe contratado (MXN)' : 'Importe propuesto (MXN, opcional)';
  document.getElementById('sn-campo-fecha').hidden = !esDirecto;
  document.getElementById('sn-cliente-info').innerHTML =
    `<b>${escaparHtml(CLIENTE_DUP.nombre || 'Sin nombre')}</b> · ${escaparHtml(CLIENTE_DUP.telefono)}${CLIENTE_DUP.direccion ? ' · ' + escaparHtml(CLIENTE_DUP.direccion) : ''}`;
  Finanzas.avisoAdeudo(CLIENTE_DUP.id, 'sn-aviso-adeudo');
  document.getElementById('sn-servicio').innerHTML = '<option value="">Selecciona un servicio</option>' + CATALOGOS.servicios.map(s=>`<option value="${s.id}">${escaparHtml(s.nombre)}</option>`).join('');
  document.getElementById('sn-ubicacion').value = prefill?.direccion || CLIENTE_DUP.direccion || '';
  // Contacto abierto desde Prospección: la cotización se liga al establecimiento y propone su domicilio.
  const est = !prefill && ESTABLECIMIENTO_PENDIENTE?.cliente_id === CLIENTE_DUP.id ? ESTABLECIMIENTO_PENDIENTE : null;
  if (est) { CLIENTE_DUP.establecimiento_id = est.id; if (est.direccion) document.getElementById('sn-ubicacion').value = est.direccion; }
  document.getElementById('btn-guardar-servicio-nuevo').textContent = CONVERTIR_ID ? 'Convertir en orden de servicio' : DUPLICADO_DE ? 'Guardar orden duplicada' : esDirecto ? 'Crear orden de servicio' : 'Crear cotización';
  rotularEditorContenido(esDirecto);
  document.getElementById('sn-valor').placeholder = CLIENTE_DUP.ultimo_valor
    ? `Última vez: ${formatoMoneda(CLIENTE_DUP.ultimo_valor)}`
    : 'Si ya se conoce';
  document.getElementById('sn-fecha').value = '';
  // Al convertir, el servicio no puede ser antes de la fecha de la cotización.
  FECHA_MIN_SERVICIO = CONVERTIR_ID ? (prefill?.fecha_cotizacion || '') : '';
  document.getElementById('sn-fecha').min = FECHA_MIN_SERVICIO;
  // Vigencia: solo en cotizaciones. Se propone la de siempre (15 días) y se puede quitar o cambiar.
  document.getElementById('sn-vigencia').hidden = esDirecto;
  document.getElementById('sn-incluye-vigencia').checked = true;
  document.getElementById('sn-wrap-vigencia').hidden = false;
  document.getElementById('sn-sin-vigencia').hidden = true;
  // Fecha de la cotización: hoy por defecto (se puede poner una anterior, nunca futura).
  document.getElementById('sn-fecha-cotizacion').value = hoyISO();
  document.getElementById('sn-fecha-cotizacion').max = hoyISO();
  document.getElementById('sn-vigencia-hasta').min = hoyISO();
  document.getElementById('sn-vigencia-hasta').value = sumarDiasISO(hoyISO(), EMPRESA_COTIZACION.vigenciaDias);
  document.getElementById('sn-datos-orden').hidden = !esDirecto;
  if (esDirecto) EquipoOrden.alta.mostrar({ sucursal_id: CONVERTIR_ID ? (prefill?.sucursal_id ?? null) : (window.Sucursales?.datos?.alta ?? null), equipo_personal: DUPLICADO_DE ? (prefill?.equipo_personal || []) : [] });
  document.getElementById('sn-equipo').value = prefill?.equipo || '';
  document.getElementById('sn-operador').value = prefill?.operador || '';
  document.getElementById('sn-observaciones').value = CONVERTIR_ID ? (prefill?.observaciones || '') : '';
  document.getElementById('sn-proyecto').value = esDirecto ? (prefill?.proyecto || '') : '';
  // Manifiestos y tiros son de cada servicio realizado: no se copian al duplicar.
  document.getElementById('sn-manifiestos').value = CONVERTIR_ID ? (prefill?.manifiestos || '') : '';
  document.getElementById('sn-tiros').value = CONVERTIR_ID ? (prefill?.tiros || '') : '';
  pintarCostosDuplicar(DUPLICADO_DE);
  // El prellenado pasa por prepararEditorCotizacion para que también arme la tabla de
  // partidas real (gc-items) — de otro modo, al validar/guardar se recalcula desde ahí
  // y borraría cualquier valor puesto solo en sn-servicio/sn-valor.
  // Una orden duplicada conserva su IVA (aunque esté por definir); lo demás empieza "más IVA".
  prepararEditorCotizacion(prefill ? { partidas_json: prefill.partidas_json, servicio_nombre: prefill.servicio_nombre, valor: prefill.valor,
    ...('iva_modo' in prefill ? { iva_modo: prefill.iva_modo, iva_tasa: prefill.iva_tasa } : {}) } : null, 'nuevo');
  abrirVentana('overlay-servicio-nuevo');
  FlujoCRM.marcarGuardado('overlay-servicio-nuevo');
}
// El editor de partidas es el mismo para cotización y orden de servicio; solo cambia el rótulo.
function rotularEditorContenido(esOrden) {
  const doc = esOrden ? 'orden de servicio' : 'cotización';
  document.getElementById('gc-titulo-contenido').textContent = 'Contenido de la ' + doc;
  document.getElementById('gc-ayuda-contenido').textContent = Permisos.puede('ordenes.importes') ? `Edita servicios, descripciones e importes. Se guardan con esta ${doc} y se usan en la descarga.`
    : `Servicios y descripción de la ${doc}. Tu rol no ve importes: se muestran sin precios y no se cambian aquí.`;
  document.getElementById('btn-gc-generar').textContent = 'Guardar y descargar ' + doc;
  // Las notas y condiciones son de la cotización (la orden tiene sus observaciones).
  document.getElementById('gc-notas-campo').hidden = esOrden;
}
async function guardarServicioNuevo(descargar=false) {
  if(!validarEditorCotizacion())return;
  sincronizarEditor();
  const botonGuardar = document.getElementById('btn-guardar-servicio-nuevo');
  if (botonGuardar.disabled) return;
  if (!CLIENTE_DUP) return;
  if (!document.getElementById('sn-servicio').value) { toast('Selecciona el servicio de este registro'); return; }
  if (!document.getElementById('sn-ubicacion').value.trim()) { toast('Indica la ubicación de este servicio'); return; }
  const esDirecto = MODO_SERVICIO_NUEVO === 'directo' || MODO_SERVICIO_NUEVO === 'convertir';
  if(esDirecto && !document.getElementById('sn-fecha').value){toast('Indica la fecha acordada del servicio');document.getElementById('sn-fecha').focus();return;}
  if(CONVERTIR_ID && FECHA_MIN_SERVICIO && document.getElementById('sn-fecha').value < FECHA_MIN_SERVICIO){toast('La fecha del servicio no puede ser anterior a la cotización ('+FECHA_MIN_SERVICIO.split('-').reverse().join('/')+')');document.getElementById('sn-fecha').focus();return;}
  const fechaCotizacion = document.getElementById('sn-fecha-cotizacion').value;
  if (!esDirecto && (!fechaCotizacion || fechaCotizacion > hoyISO())) { toast('Indica la fecha de la cotización (hoy o una anterior)'); document.getElementById('sn-fecha-cotizacion').focus(); return; }
  const conVigencia = !esDirecto && document.getElementById('sn-incluye-vigencia').checked;
  const vigenciaHasta = document.getElementById('sn-vigencia-hasta').value;
  if (conVigencia && (!vigenciaHasta || vigenciaHasta < fechaCotizacion)) { toast('La vigencia debe ser igual o posterior a la fecha de la cotización, o desmarca la vigencia'); document.getElementById('sn-vigencia-hasta').focus(); return; }
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
    valor: valorRaw === '' ? null : Number(valorRaw),
    fecha_servicio: esDirecto ? (document.getElementById('sn-fecha').value || null) : null,
    creado_por: USUARIO_ACTUAL.nombre,
    forzar_duplicado: true,
    estatus: esDirecto ? 'ganado' : undefined,
    duplicado_de: esDirecto ? DUPLICADO_DE : null,
    equipo: esDirecto ? document.getElementById('sn-equipo').value.trim() : null,
    operador: esDirecto ? document.getElementById('sn-operador').value.trim() : null,
    observaciones: esDirecto ? document.getElementById('sn-observaciones').value.trim() : null,
    proyecto: esDirecto ? document.getElementById('sn-proyecto').value.trim() : null,
    manifiestos: esDirecto ? document.getElementById('sn-manifiestos').value.trim() : null,
    tiros: esDirecto ? document.getElementById('sn-tiros').value.trim() : null,
    fecha_cotizacion: esDirecto ? undefined : fechaCotizacion,
    incluye_vigencia: esDirecto ? undefined : conVigencia,
    notas_cotizacion: esDirecto ? null : document.getElementById('gc-notas').value.trim(),
    vigencia_hasta: conVigencia ? vigenciaHasta : null,
    ...ivaPayload(),
    ...(DUPLICADO_DE ? { costos_duplicar: costosADuplicar() } : {}),
    ...(esDirecto ? EquipoOrden.alta.payloadNuevo() : {})
  };
  botonGuardar.disabled = true;
  try {
    let creado;
    if (CONVERTIR_ID) {
      // Misma cotización, ahora como orden de servicio: se manda la versión para no pisar cambios de otra persona.
      const actual = await api('/leads/' + CONVERTIR_ID).then(r => r.json());
      if (actual.estatus !== 'abierto') { toast('Esta cotización ya no está abierta; vuelve a abrirla para revisar.'); return; }
      const res = await api('/leads/' + CONVERTIR_ID, { method: 'PUT', body: JSON.stringify({
        version: actual.version, estatus: 'ganado', partidas_json: payload.partidas_json, servicio_id: payload.servicio_id, direccion: payload.direccion,
        fecha_servicio: payload.fecha_servicio, equipo: payload.equipo, operador: payload.operador, observaciones: payload.observaciones, proyecto: payload.proyecto, manifiestos: payload.manifiestos, tiros: payload.tiros, ...ivaPayload(), ...(payload.equipo_personal ? { equipo_personal: payload.equipo_personal } : {}) }) });
      creado = await res.json();
      if (!res.ok) { toast(creado.error || 'No se pudo convertir la cotización'); return; }
    } else {
      const res = await api('/leads', { method: 'POST', body: JSON.stringify(payload) });
      creado = await res.json().catch(() => ({}));
      if (!res.ok) { toast(creado.error || 'No se pudo guardar'); return; }
    }
    FlujoCRM.marcarGuardado('overlay-servicio-nuevo');
    const folio = esDirecto ? folioOrdenServicio(creado) : folioCotizacion(creado);
    const hecho = (CONVERTIR_ID ? 'Cotización convertida en orden de servicio' : DUPLICADO_DE ? 'Orden de servicio duplicada' : esDirecto ? 'Orden de servicio creada' : 'Cotización creada') + ': ' + folio;
    // El documento se arma con lo capturado en esta ventana, antes de cerrarla.
    if (descargar) {
      LEAD_ACTUAL = await api('/leads/' + creado.id).then(r => r.json());
      await (esDirecto ? descargarOrdenServicioActual(hecho + ' y descargada') : descargarCotizacionActual());
    }
    // Al guardar no se cambia de pantalla: se cierra la ventana y se vuelve a donde estabas
    // (ficha del contacto, Pipeline o Pendientes), con su lista ya actualizada.
    document.getElementById('overlay-servicio-nuevo').classList.remove('mostrar');
    document.getElementById('alerta-dup').classList.remove('mostrar');
    limpiarFormAlta();
    await ServiciosTabla.refrescar();
    await regresarAFicha();
    toast(hecho + '. Ya aparece en los registros del contacto.');
  } catch (err) {
    toast('No se pudo guardar: ' + err.message);
  } finally {
    botonGuardar.disabled = false;
  }
}
on('btn-guardar-servicio-nuevo','click',()=>guardarServicioNuevo());
on('sn-incluye-vigencia', 'change', e => { document.getElementById('sn-wrap-vigencia').hidden = !e.target.checked; document.getElementById('sn-sin-vigencia').hidden = e.target.checked; });
// Al cambiar la fecha de la cotización, la vigencia se recorre (15 días después) si quedó antes.
on('sn-fecha-cotizacion', 'change', e => {
  const f = e.target.value, vig = document.getElementById('sn-vigencia-hasta');
  if (!f) return;
  vig.min = f;
  if (!vig.value || vig.value < f) vig.value = sumarDiasISO(f, EMPRESA_COTIZACION.vigenciaDias);
});
// Cerrar la ventana de crear sin guardar también regresa a la orden de la que se partió.
document.querySelector('#overlay-servicio-nuevo .close-btn').addEventListener('click', () => setTimeout(regresarAFicha, 0));
on('btn-barra-guardar','click',()=>EDITOR_MODO==='nuevo'?guardarServicioNuevo():document.getElementById('btn-guardar-ficha').click());

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
  for (const id of ['in-telefono-alterno', 'in-rfc', 'in-notas-generales']) document.getElementById(id).value = '';
  document.getElementById('alerta-dup').classList.remove('mostrar');
}

// ---------- Vista Cotizaciones (Kanban) ----------
let ETAPA_FILTRO = null;

// ---------- Inicio (panel del día: alertas + cotizaciones estancadas + recompras) ----------
// Muestra "Cargando…" y, si falla, un aviso con botón Reintentar en vez de dejar la lista vacía
// (una lista vacía se confunde con "no hay pendientes").
function estadoCarga(ids, estado, reintentar) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (estado === 'cargando') el.innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    else {
      el.innerHTML = `<div class="aviso-error-carga" role="alert"><p>${escaparHtml(estado)}</p><button type="button" class="btn btn-outline">Reintentar</button></div>`;
      el.querySelector('button').onclick = reintentar;
    }
  });
}
async function cargarInicio() {
  const listas = ['inicio-cotizaciones', 'inicio-concluir', 'inicio-recompras'];
  estadoCarga(listas, 'cargando');
  let alertas, recompras, abiertas, ordenes;
  try {
    [alertas, recompras, abiertas, ordenes] = await Promise.all([
      api('/alertas').then(r => r.json()),
      api('/recompras').then(r => r.json()),
      api('/leads?estatus=abierto').then(r => r.json()),
      api('/leads?estatus=ganado').then(r => r.json())
    ]);
  } catch (err) {
    if (err.status !== 401) estadoCarga(listas, 'No se pudo cargar: ' + err.message, cargarInicio);
    return;
  }
  const estancadas = abiertas
    .filter(l => diasSinMovimiento(l.updated_at) > 7)
    .sort((a, b) => diasSinMovimiento(b.updated_at) - diasSinMovimiento(a.updated_at));

  const contCot = document.getElementById('inicio-cotizaciones');
  const filasCot = [...alertas.map(filaAlerta), ...estancadas.map(filaEstancada)];
  contCot.innerHTML = filasCot.length ? filasCot.join('') : '<p class="util-45">No hay avisos ni cotizaciones pendientes por ahora. 🎉</p>';

  // Órdenes con fecha ya pasada sin marcar como realizadas o no realizadas.
  const hoyTxt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  const porConcluir = ordenes.filter(o => !o.ejecucion && o.fecha_servicio && o.fecha_servicio <= hoyTxt).sort((a, b) => a.fecha_servicio.localeCompare(b.fecha_servicio));
  document.getElementById('inicio-concluir').innerHTML = porConcluir.length ? porConcluir.map(o => `
    <div class="fila-alerta tipo-estancada">
      <div class="info">
        <span class="tipo-tag estancada">🧾 Por concluir</span>
        <div><b>${escaparHtml(o.empresa_contacto || o.nombre || 'Sin nombre')}</b> · ${folioOrdenServicio(o)}</div>
        <div class="txt">${escaparHtml(o.servicio_nombre || 'Servicio')}${o.equipo ? ' · Unidad ' + escaparHtml(o.equipo) : ''}</div>
        <div class="fecha">Servicio del ${escaparHtml(o.fecha_servicio.split('-').reverse().join('/'))}</div>
      </div>
      <div class="util-46"><button class="btn btn-outline" onclick="abrirFicha(${Number(o.id)})">Abrir orden</button></div>
    </div>`).join('') : '<p class="util-45">No hay servicios pendientes de concluir. 🎉</p>';

  const contRec = document.getElementById('inicio-recompras');
  contRec.innerHTML = recompras.length
    ? recompras.map(r => filaRecompra(r, r.dias_restantes <= 0)).join('')
    : '<p class="util-45">No hay recompras próximas todavía.</p>';
  Finanzas.pintarInicio();
  if (typeof Personal !== 'undefined') Personal.pintarInicio(); // bloque «Personal» (licencias, contratos, ausencias, órdenes sin responsable)
  if (typeof Compras !== 'undefined') Compras.pintarInicio(); // bloque «Compras» (aprobar, cotizar, autorizar, recibir)
  if (typeof Prospeccion !== 'undefined') Prospeccion.pintarInicio(); // bloque «Prospección» (a quién llamar hoy)
}
function filaEstancada(l) {
  const dias = diasSinMovimiento(l.updated_at);
  return `
    <div class="fila-alerta tipo-estancada">
      <div class="info">
        <span class="tipo-tag estancada">📄 Sin movimiento</span>
        <div><b>${escaparHtml(l.nombre || 'Sin nombre')} · ${escaparHtml(l.telefono)}</b></div>
        <div class="txt">${escaparHtml(l.servicio_nombre || 'Servicio por definir')} · ${folioCotizacion(l)}</div>
        <div class="fecha">${dias} días sin actualizarse</div>
      </div>
      <div class="util-46">
        <button class="btn btn-outline" onclick="abrirFicha(${l.id})">Abrir cotización</button>
      </div>
    </div>`;
}

async function cargarLeads() {
  const params = new URLSearchParams();
  const resp = document.getElementById('f-responsable').value;
  const q = document.getElementById('f-buscar').value;
  const desde = document.getElementById('f-desde').value;
  const hasta = document.getElementById('f-hasta').value;
  const soloUrgentes = document.getElementById('f-urgente').checked;
  params.set('estatus', 'abierto');
  if (resp) params.set('responsable_id', resp);
  if (q) params.set('q', q);
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);
  if (soloUrgentes) params.set('urgente', '1');
  if (ETAPA_FILTRO) params.set('etapa', ETAPA_FILTRO);

  // Contactos sin ninguna cotización: van en "Recolección de datos". No tienen responsable ni
  // urgencia, así que se ocultan al filtrar por esos datos o por otra etapa.
  const conContactos = !resp && !soloUrgentes && (!ETAPA_FILTRO || ETAPA_FILTRO === 1);
  const pc = new URLSearchParams();
  if (q) pc.set('q', q);
  if (desde) pc.set('desde', desde);
  if (hasta) pc.set('hasta', hasta);
  const [leads, kpis, contactos] = await Promise.all([
    api('/leads?' + params.toString()).then(r => r.json()),
    api('/kpis' + (resp ? '?responsable_id=' + resp : '')).then(r => r.json()),
    conContactos ? api('/contactos/sin-cotizacion?' + pc.toString()).then(r => r.json()) : []
  ]);

  renderKpis(kpis, contactos.length);
  renderKanbanLeads(leads, contactos);
}
// Tarjeta de un contacto sin cotización: abre su ficha en Crear cotización / Crear orden de servicio.
function tarjetaContacto(c) {
  return `
      <div class="lead-card contacto-card" data-etapa="1" role="button" tabindex="0" onclick="FlujoCRM.irACotizar(${Number(c.id)})" onkeydown="if(event.key==='Enter')FlujoCRM.irACotizar(${Number(c.id)})" title="Abrir su ficha para crear la cotización">
        <div class="lead-folio">Contacto · sin cotización</div>
        <div class="lead-tel">${escaparHtml(c.telefono)}</div>
        <div class="lead-nombre">${escaparHtml(c.nombre || 'Sin nombre')}</div>
        <div class="lead-servicio">${escaparHtml(c.empresa_contacto || c.canal_nombre || 'Pendiente de cotizar')}</div>
        <div class="lead-meta"><span class="lead-resp">📄 Crear cotización</span></div>
        <div class="lead-fecha">${fechaCorta(c.created_at)}</div>
      </div>`;
}

function formatoMoneda(n) {
  return '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Importe con letra ("MIL QUINIENTOS PESOS 50/100 M.N."): lo calcula public/importes.js
// desde centavos enteros, igual para todos los documentos.
function numeroALetras(monto) {
  return Importes.enLetras(Math.round((Number(monto) || 0) * 100));
}

function renderKpis(kpis, contactos = 0) {
  const porEtapa = kpis.etapas || {};
  for (let e = 1; e <= 4; e++) {
    const k = porEtapa[e] || { total: 0, abiertos: 0, ganados: 0, perdidos: 0, con_alertas: 0, valor_total: 0, dias_promedio: null };
    document.getElementById(`kpi-${e}-total`).textContent = k.total + (e === 1 ? contactos : 0);
    const chips = [];
    if (k.abiertos > 0) chips.push(`<span class="kpi-chip">${k.abiertos} abierto${k.abiertos === 1 ? '' : 's'}</span>`);
    if (k.ganados > 0) chips.push(`<span class="kpi-chip ganado">${k.ganados} ganado${k.ganados === 1 ? '' : 's'}</span>`);
    if (k.perdidos > 0) chips.push(`<span class="kpi-chip perdido">${k.perdidos} perdido${k.perdidos === 1 ? '' : 's'}</span>`);
    if (e === 1 && contactos > 0) chips.push(`<span class="kpi-chip">${contactos} contacto${contactos === 1 ? '' : 's'} sin cotización</span>`);
    if (k.con_alertas > 0) chips.push(`<span class="kpi-chip alerta">⏰ ${k.con_alertas} con alerta</span>`);
    document.getElementById(`kpi-${e}-desglose`).innerHTML = chips.join('') || '<span class="kpi-chip">Sin registros</span>';
    document.getElementById(`kpi-${e}-valor`).innerHTML = k.valor_total > 0 && Permisos.puede('ordenes.importes')
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

// Importe de una tarjeta: "más IVA" muestra el subtotal + IVA; "IVA incluido", el total.
function importeTarjeta(l) {
  if (l.valor == null) return '—';
  if (l.iva_modo === 'mas_iva') return formatoMoneda(l.valor) + ' + IVA';
  if (l.iva_modo === 'incluido') return formatoMoneda((Math.round(l.valor * 100) + (l.iva_cent || 0)) / 100) + ' IVA incl.';
  if (l.iva_modo === 'sin_iva') return formatoMoneda(l.valor) + ' sin IVA';
  return formatoMoneda(l.valor);
}
function renderKanbanLeads(leads, contactos = []) {
  const etiquetaFiltro = ETAPA_FILTRO ? ` · filtrando etapa ${ETAPA_FILTRO}` : '';
  const conteoEl = document.getElementById('tabla-leads-conteo');
  if (conteoEl) conteoEl.textContent = leads.length + (leads.length === 1 ? ' cotización' : ' cotizaciones')
    + (contactos.length ? ` · ${contactos.length} contacto${contactos.length === 1 ? '' : 's'} sin cotización` : '') + etiquetaFiltro;

  for (let e = 1; e <= 4; e++) {
    document.getElementById('col-' + e).innerHTML = '';
    document.getElementById('footer-' + e).innerHTML = '';
  }

  if (!leads.length && !contactos.length) {
    document.getElementById('col-1').innerHTML = '<p class="util-36">Sin contactos ni cotizaciones abiertas con estos filtros.</p>';
    for (let e = 1; e <= 4; e++) document.getElementById('count-' + e).textContent = '0';
    return;
  }

  const porEtapa = { 1: [], 2: [], 3: [], 4: [] };
  leads.forEach(l => {
    if (porEtapa[l.etapa]) porEtapa[l.etapa].push(l);
  });

  for (let e = 1; e <= 4; e++) {
    const lista = porEtapa[e];
    document.getElementById('count-' + e).textContent = lista.length + (e === 1 ? contactos.length : 0);

    const valorColumna = lista.reduce((sum, l) => sum + (l.valor || 0), 0);
    if (valorColumna > 0) {
      document.getElementById('footer-' + e).innerHTML = Permisos.puede('ordenes.importes') ? `<div class="kanban-footer-valor">Total sin IVA: <b>${formatoMoneda(valorColumna)}</b></div>` : '';
    }

    document.getElementById('col-' + e).innerHTML = lista.map(l => {
      const dias = diasSinMovimiento(l.updated_at);
      let diasClass = '';
      if (dias > 7) diasClass = 'critico';
      else if (dias > 3) diasClass = 'urgente';
      return `
      <div class="lead-card" data-etapa="${l.etapa}" draggable="true" ondragstart="dragStart(event, ${l.id})" ondragend="dragEnd(event)" onclick="abrirFicha(${l.id})" ${l.urgente ? 'style="border-left:4px solid #e63946"' : ''}>
        ${l.urgente ? `<div class="lead-alertas" title="Solicitud urgente" style="background:#e63946">🔴 Urgente</div>` : ''}
        ${l.alertas_pendientes > 0 ? `<div class="lead-alertas">⏰ ${l.alertas_pendientes}</div>` : ''}
        ${dias > 2 ? `<div class="lead-dias ${diasClass}">⏱ ${dias}d</div>` : ''}
        ${l.etapa < 4 ? `<button class="btn-avanzar" title="Mover a ${NOMBRE_ETAPA[l.etapa + 1]}" onclick="event.stopPropagation();avanzarEtapa(${l.id}, ${l.etapa + 1})">›</button>` : ''}
        <div class="lead-folio">${folioCotizacion(l)}</div>
        <div class="lead-tel">${escaparHtml(l.telefono)}</div>
        <div class="lead-nombre">${escaparHtml(l.nombre || 'Sin nombre')}</div>
        <div class="lead-servicio">${escaparHtml(l.servicio_nombre || 'Sin servicio')}</div>
        <div class="lead-meta">
          <span class="lead-resp">${escaparHtml(l.responsable_nombre || '—')}</span>
          <span class="lead-valor perm-ordenes-importes">${importeTarjeta(l)}</span>
        </div>
        <div class="lead-fecha">${fechaCorta(l.updated_at)}</div>
      </div>
    `}).join('');
  }
  // Contactos sin cotización: arriba de la primera etapa.
  if (contactos.length) document.getElementById('col-1').insertAdjacentHTML('afterbegin', contactos.map(tarjetaContacto).join(''));
}

on('f-buscar', 'input', debounce(cargarLeads, 350));
on('f-responsable', 'change', cargarLeads);
on('f-desde', 'change', cargarLeads);
on('f-hasta', 'change', cargarLeads);
on('f-urgente', 'change', cargarLeads);
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
    const res = await api('/leads/' + leadId, { method: 'PUT', body: JSON.stringify({ etapa, usuario: USUARIO_ACTUAL ? USUARIO_ACTUAL.nombre : null }) });
    const datos = await res.json();
    if (!res.ok) { toast(datos.error || 'No se pudo cambiar de etapa'); cargarLeads(); return; }
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
  document.getElementById('f-urgente').checked = false;
  ETAPA_FILTRO = null;
  document.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('activa'));
  cargarLeads();
}

// ---------- Vista Generador: ventas por servicio de cada orden ----------
let GENERADOR = null, consultaGenerador = 0;
async function cargarGenerador() {
  const consulta = ++consultaGenerador, cuerpo = document.getElementById('gen-tabla'), resumen = document.getElementById('gen-resumen');
  const desde = document.getElementById('gen-desde').value, hasta = document.getElementById('gen-hasta').value;
  if (desde && hasta && desde > hasta) { resumen.textContent = 'La fecha Desde no puede ser posterior a Hasta.'; cuerpo.innerHTML = ''; return; }
  resumen.textContent = 'Cargando…';
  const params = new URLSearchParams({ desde, hasta, q: document.getElementById('gen-buscar').value.trim() });
  let r;
  try { r = await api('/generador?' + params).then(x => x.json()); } catch (err) { if (consulta === consultaGenerador) resumen.textContent = 'No se pudo cargar el generador: ' + err.message; return; }
  if (consulta !== consultaGenerador) return;
  GENERADOR = r;
  const m = v => v == null ? '—' : formatoMoneda(v), t = r.totales;
  resumen.textContent = `${r.filas.length} ${r.filas.length === 1 ? 'renglón' : 'renglones'} de ${t.ordenes} orden${t.ordenes === 1 ? '' : 'es'} · Subtotal ${formatoMoneda(t.subtotal)} · IVA ${formatoMoneda(t.iva)} · Total ${formatoMoneda(t.total)}${t.costo ? ` · Costo con terceros ${formatoMoneda(t.costo)}` : ''}`
    + (r.filas.some(f => f.iva_por_definir) ? ' · Las órdenes con IVA por definir se muestran como se capturaron.' : '')
    + (r.por_concluir ? ` · ${r.por_concluir} orden${r.por_concluir === 1 ? '' : 'es'} con fecha pasada aún sin marcar como realizada${r.por_concluir === 1 ? '' : 's'} (no aparecen aquí; ve a Inicio).` : '');
  cuerpo.innerHTML = r.filas.length ? r.filas.map(f => `<tr data-gen-orden="${Number(f.lead_id)}">
      <td>${escaparHtml(f.mes)}</td><td class="st-fecha">${escaparHtml(f.fecha.split('-').reverse().join('/'))}</td><td class="st-folio">${escaparHtml(f.orden)}${f.orden_generador ? `<small class="celda-sub">orden ${escaparHtml(f.orden_generador)}</small>` : ''}</td><td>${escaparHtml(f.factura || '—')}</td>
      <td>${escaparHtml(f.cliente || '—')}</td><td>${escaparHtml(f.proyecto || '—')}</td><td>${escaparHtml(f.producto)}</td><td class="st-num">${Number(f.cantidad)}</td><td class="st-num">${m(f.precio_sin_iva)}</td><td class="st-num">${m(f.precio_con_iva)}</td>
      <td class="st-num">${m(f.subtotal)}</td><td class="st-num">${f.iva_por_definir ? '<small>Por definir</small>' : m(f.iva)}</td><td class="st-num"><b>${m(f.total)}</b></td>
      <td>${escaparHtml(f.canal || '—')}</td><td>${escaparHtml(f.unidad || '—')}</td><td>${escaparHtml(f.empleado || '—')}</td><td>${escaparHtml(f.manifiestos || '—')}</td><td>${escaparHtml(f.tiros || '—')}</td>
      <td class="gen-costo">${escaparHtml(f.proveedor || '')}</td><td class="gen-costo">${escaparHtml(f.concepto || '')}</td><td class="gen-costo st-num">${f.costo == null ? '' : formatoMoneda(f.costo)}</td><td class="gen-costo">${escaparHtml(f.estatus_pago || '')}</td><td class="gen-costo">${escaparHtml(f.via_pago || '')}</td>
    </tr>`).join('') : '<tr><td colspan="23" class="servicios-vacio">No hay servicios realizados en este periodo.</td></tr>';
}
on('gen-desde', 'change', cargarGenerador);
on('gen-hasta', 'change', cargarGenerador);
on('gen-buscar', 'input', debounce(cargarGenerador, 350));
on('gen-mes', 'click', () => { const h = new Date(), p = n => String(n).padStart(2, '0'); document.getElementById('gen-desde').value = `${h.getFullYear()}-${p(h.getMonth() + 1)}-01`; document.getElementById('gen-hasta').value = `${h.getFullYear()}-${p(h.getMonth() + 1)}-${p(new Date(h.getFullYear(), h.getMonth() + 1, 0).getDate())}`; cargarGenerador(); });
on('gen-todo', 'click', () => { document.getElementById('gen-desde').value = ''; document.getElementById('gen-hasta').value = ''; cargarGenerador(); });
on('gen-tabla', 'click', e => { const fila = e.target.closest('[data-gen-orden]'); if (fila) abrirFicha(Number(fila.dataset.genOrden)); });
on('gen-exportar', 'click', () => {
  if (!GENERADOR?.filas.length) { toast('No hay renglones para exportar'); return; }
  descargarCSV('generador_saneadren_' + hoyISO() + '.csv', [
    ...(Sucursales.varias() ? [{ titulo: 'SUCURSAL', valor: f => f.sucursal || '' }] : []),
    { titulo: 'MES LETRA', valor: f => f.mes }, { titulo: 'FECHA', valor: f => f.fecha }, { titulo: 'NO. ORDEN', valor: f => f.orden }, { titulo: 'ORDEN GENERADOR', valor: f => f.orden_generador || '' }, { titulo: 'NO. FACTURA', valor: f => f.factura },
    { titulo: 'CLIENTE', valor: f => f.cliente }, { titulo: 'PROYECTO', valor: f => f.proyecto }, { titulo: 'CONCEPTO', valor: f => f.producto }, { titulo: 'CANTIDAD', valor: f => f.cantidad },
    { titulo: 'PRECIO UNITARIO S/IVA', valor: f => f.precio_sin_iva }, { titulo: 'PRECIO UNITARIO C/IVA', valor: f => f.precio_con_iva }, { titulo: 'SUBTOTAL', valor: f => f.subtotal }, { titulo: 'IVA', valor: f => f.iva ?? '' }, { titulo: 'TOTAL', valor: f => f.total },
    { titulo: 'CANAL DE VENTA', valor: f => f.canal }, { titulo: 'UNIDAD', valor: f => f.unidad }, { titulo: 'EMPLEADO', valor: f => f.empleado }, { titulo: 'MANIFIESTOS', valor: f => f.manifiestos }, { titulo: 'TIROS', valor: f => f.tiros },
    { titulo: 'PROVEEDOR', valor: f => f.proveedor }, { titulo: 'CONCEPTO DEL COSTO', valor: f => f.concepto }, { titulo: 'COSTO', valor: f => f.costo ?? '' }, { titulo: 'ESTATUS PAGO', valor: f => f.estatus_pago }, { titulo: 'VIA PAGO', valor: f => f.via_pago }
  ], GENERADOR.filas);
});

// ---------- Vista Resultados (Análisis) ----------
let RESULTADOS_ACTUALES=null,consultaResultados=0;
// Resultados: "Panorama general" (solo administración) y "Análisis comercial" en pestañas.
let RES_TAB = null;
function abrirResultados(tab) {
  const admin = Permisos.puede('reportes.panorama');
  RES_TAB = tab || RES_TAB || (admin ? 'panorama' : 'comercial');
  if (!admin) RES_TAB = 'comercial';
  document.querySelectorAll('[data-res-tab]').forEach(b => { const on = b.dataset.resTab === RES_TAB; b.classList.toggle('activo', on); b.setAttribute('aria-selected', on); });
  document.getElementById('res-panorama').hidden = RES_TAB !== 'panorama';
  document.getElementById('res-comercial').hidden = RES_TAB !== 'comercial';
  if (RES_TAB === 'panorama') Panorama.cargar(); else cargarResultados();
}
document.addEventListener('click', e => { const b = e.target.closest('[data-res-tab]'); if (b) abrirResultados(b.dataset.resTab); });
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
    const tarjetas=[['Contactos nuevos',r.nuevos,'ac_nuevos'],['Clientes con servicios realizados en el periodo',r.clientes,'ac_clientes'],['Vendido: servicios realizados (sin IVA)',formatoMoneda(r.contratado),'ac_vendido'],['Servicios realizados',r.servicios,'ac_servicios'],['Por realizar (contratados sin concluir, sin IVA)',formatoMoneda(r.por_realizar)+' · '+Number(r.por_realizar_n),'ac_por_realizar'],['Conversión de contactos nuevos',pct(r.convertidos,r.nuevos),'ac_conversion'],['Promedio por servicio (sin IVA)',r.servicios?formatoMoneda(r.contratado/r.servicios):'—','ac_promedio'],['Clientes recurrentes activos',r.recurrentes,'ac_recurrentes'],['Importe en propuestas abiertas (sin IVA)',formatoMoneda(r.propuesto),'ac_propuestas']];
    Finanzas.pintarResultados(desde, hasta);
    Ayuda.cerrar(document.getElementById('res-kpis'));document.getElementById('res-kpis').innerHTML=tarjetas.map(([label,value,clave])=>`<div class="res-card"><div class="res-num">${value}</div><div class="res-label">${label}${Ayuda.boton(clave)}</div></div>`).join('');
    document.getElementById('res-canales').innerHTML=d.canales.map(c=>`<tr><td>${escaparHtml(c.canal)}</td><td>${Number(c.nuevos)}</td><td>${Number(c.convertidos)}</td><td>${pct(c.convertidos,c.nuevos)}</td><td>${Number(c.clientes)}</td><td>${Number(c.servicios)}</td><td>${formatoMoneda(c.contratado)}</td><td>${Number(c.servicios)?formatoMoneda(c.contratado/c.servicios):'—'}</td><td>${Number(c.abiertas)}</td><td>${formatoMoneda(c.propuesto)}</td></tr>`).join('')||'<tr><td colspan="10">Sin datos.</td></tr>';
    document.getElementById('res-clientes').innerHTML=d.clientes.map(c=>`<tr><td>${escaparHtml(c.nombre||c.telefono)}</td><td>${escaparHtml(c.canal)}</td><td>${c.ganados_historicos>1?'Cliente recurrente':c.ganados_historicos?'Cliente':'Prospecto'}</td><td>${Number(c.servicios)}</td><td>${formatoMoneda(c.contratado)}</td><td>${formatoMoneda(c.total_historico)}</td><td>${Number(c.abiertas)}</td><td>${escaparHtml(c.ultima_fecha||'Sin fecha')}</td><td><button class="btn btn-outline" data-resultado-cliente="${Number(c.id)}">Abrir ficha</button></td></tr>`).join('')||'<tr><td colspan="9">Sin contactos ni actividad en el periodo.</td></tr>';
    renderBarChart('res-dinero-canal',d.canales,'canal','contratado',formatoMoneda);renderBarChart('res-contactos-canal',[...d.canales].sort((a,b)=>b.nuevos-a.nuevos),'canal','nuevos',v=>v+' contactos');
    renderGraficosComerciales(d);
    estado.textContent=(desde||hasta?'Periodo: '+(desde||'inicio')+' a '+(hasta||'sin límite'):'Todo el historial')+(d.sinFecha?' · '+d.sinFecha+' servicios contratados sin fecha: no se incluyen al filtrar por fechas.':'')
      +(d.ivaPorDefinir?.servicios?' · '+d.ivaPorDefinir.servicios+' servicio(s) del periodo con IVA por definir ('+formatoMoneda(d.ivaPorDefinir.importe)+'): se suman como se capturaron, con o sin IVA.':'');
  }catch(err){if(consulta!==consultaResultados)return;estado.textContent='No se pudieron cargar los resultados. '+err.message;}
}
on('res-aplicar','click',cargarResultados);
on('res-todo','click',()=>{document.getElementById('res-desde').value='';document.getElementById('res-hasta').value='';cargarResultados();});
on('res-clientes','click',e=>{const btn=e.target.closest('[data-resultado-cliente]');if(btn)abrirFichaCliente(Number(btn.dataset.resultadoCliente));});
on('res-exportar','click',()=>{if(!RESULTADOS_ACTUALES)return;descargarCSV('resultados-canales.csv',[{titulo:'Canal de origen',valor:c=>c.canal},{titulo:'Contactos nuevos',valor:c=>c.nuevos},{titulo:'Convertidos',valor:c=>c.convertidos},{titulo:'Servicios realizados',valor:c=>c.servicios},{titulo:'Vendido sin IVA MXN',valor:c=>c.contratado},{titulo:'Por realizar sin IVA MXN',valor:c=>c.por_realizar},{titulo:'Propuestas abiertas',valor:c=>c.abiertas},{titulo:'Importe abierto sin IVA MXN',valor:c=>c.propuesto}],RESULTADOS_ACTUALES.canales);});

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

// Escapa también comillas: el resultado es seguro tanto dentro de etiquetas como dentro de
// atributos (value="…", title="…"). Usarla con TODO dato que venga de la base o del usuario.
function escaparHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

// AAAAMM del folio: del texto de la fecha de creación («2026-09-30 23:59:59» → 202609), igual que el servidor,
// sin convertir zonas horarias. Si aún no tiene fecha (o no se entiende), el mes de hoy en Querétaro.
function mesDeFolio(creado) {
  const m = String(creado || '').match(/^(\d{4})-(\d{2})/);
  if (m) return m[1] + m[2];
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date()).slice(0, 7).replace('-', '');
}
// «COT-CDMX-202610-0001»: con clave y consecutivo de su sucursal; los de antes de las sucursales, «COT-202610-0087».
function folioDeLead(prefijo, lead) {
  if (lead && lead.folio && new RegExp('^' + prefijo + '-').test(lead.folio)) return lead.folio;
  const clave = lead && lead.folio_num != null && lead.sucursal_id != null ? (globalThis.SUCURSALES_MAPA || {})[lead.sucursal_id] : null;
  if (clave) return `${prefijo}-${clave}-${mesDeFolio(lead.created_at)}-${String(lead.folio_num).padStart(4, '0')}`;
  return `${prefijo}-${mesDeFolio(lead.created_at)}-${String(lead.id).padStart(4, '0')}`;
}
function folioCotizacion(lead) { return folioDeLead('COT', lead); }

function nombreArchivoCotizacion(datos, extension) {
  const cliente = (datos.cliente.nombre || 'cliente').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `cotizacion_${datos.folio}_${cliente}.${extension}`;
}

// Columnas de cantidad y precio unitario de una partida (solo si el documento las usa).
const colsCantidad = (datos, item) => datos.conCantidad ? [String(Importes.cantidadDe(item)), formatoMoneda(Importes.precioDe(item))] : [];
const titulosCantidad = datos => datos.conCantidad ? ['Cant.', 'P. unitario'] : [];
// Importes del documento con el IVA elegido en el editor (el que se acaba de guardar).
function importesDocumento(items) {
  const modo = modoIvaEditor(), tasa = IVA_TASA;
  const r = Importes.calcular(items, modo, tasa);
  return {
    modo, total: r.total_cent / 100, totalLetras: Importes.enLetras(r.total_cent),
    totales: Importes.filasTotales(r, modo, tasa), leyendaIva: Importes.leyenda(modo, tasa),
    encabezadoImporte: Importes.encabezadoImporte(modo) + ' (MXN)',
    // Si algún servicio lleva cantidad distinta de 1, los documentos muestran Cant. y P. unitario.
    conCantidad: items.some(i => Importes.cantidadDe(i) !== 1)
  };
}

function datosCotizacionDesdeLead(lead, items) {
  const fechaLargaISO = f => new Date(f + 'T12:00:00').toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
  let vigenciaTexto = null;
  if (lead.incluye_vigencia !== 0) vigenciaTexto = fechaLargaISO(lead.vigencia_hasta || sumarDiasISO(hoyISO(), EMPRESA_COTIZACION.vigenciaDias));
  return {
    folio: folioCotizacion(lead),
    fechaEmision: fechaLargaISO(hoyISO()),
    fechaCotizacion: fechaLargaISO(lead.fecha_cotizacion || lead.created_at.slice(0,10)),
    vigenciaTexto,
    notas: lead.notas_cotizacion || '', // ya guardadas: la descarga siempre guarda antes
    atendioPor: lead.responsable_nombre || 'Por asignar',
    cliente: {
      nombre: lead.nombre || 'Cliente',
      empresa: lead.empresa_contacto || '',
      telefono: lead.telefono || '',
      direccion: lead.direccion || ''
    },
    items,
    ...importesDocumento(items)
  };
}

// Cada documento tiene su propio membrete (generado con herramientas/membretes/membretes.html):
// ya trae el tipo de documento en el encabezado, por eso el cuerpo solo muestra el folio.
const membretesCache = {};
function cargarMembrete(archivo) {
  if (!membretesCache[archivo]) {
    membretesCache[archivo] = fetch('/' + archivo).then(async respuesta => {
      if (!respuesta.ok) throw new Error('No se pudo cargar el membrete');
      return new Uint8Array(await respuesta.arrayBuffer());
    }).catch(error => { delete membretesCache[archivo]; throw error; });
  }
  return membretesCache[archivo];
}
const cargarMembreteCotizacion = () => cargarMembrete('membrete-cotizacion.png');
const cargarMembreteOrdenServicio = () => cargarMembrete('membrete-orden-servicio.png');

let qrEncuestaCache;
async function cargarQREncuesta() {
  if (!qrEncuestaCache) {
    qrEncuestaCache = fetch('/QR_Encuesta_Calidad_Saneadren.png').then(async respuesta => {
      if (!respuesta.ok) throw new Error('No se pudo cargar el QR de la encuesta');
      return new Uint8Array(await respuesta.arrayBuffer());
    }).catch(error => { qrEncuestaCache = null; throw error; });
  }
  return qrEncuestaCache;
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
  texto('Folio: '+datos.folio,15,true);
  texto('Fecha de cotización: '+datos.fechaCotizacion+(datos.vigenciaTexto?'   |   Vigencia hasta: '+datos.vigenciaTexto:''));
  texto('Atendió: '+datos.atendioPor);
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
    head:[['Servicio','Descripción / leyenda',...titulosCantidad(datos),datos.encabezadoImporte]],
    body:datos.items.map(item=>[item.servicio,item.leyenda||'—',...colsCantidad(datos,item),formatoMoneda(item.importe)]),
    // Con IVA: Subtotal / IVA / Total; solo el total va en negritas.
    foot:datos.totales.map(([etiqueta,cent])=>['',{content:etiqueta,colSpan:datos.conCantidad?3:1},formatoMoneda(cent/100)]),showFoot:'lastPage',rowPageBreak:'avoid',
    columnStyles:datos.conCantidad?{0:{cellWidth:110},2:{cellWidth:40,halign:'right'},3:{cellWidth:75,halign:'right'},4:{cellWidth:85,halign:'right'}}:{0:{cellWidth:125},2:{cellWidth:95,halign:'right'}},
    styles:{fontSize:10,cellPadding:6,overflow:'linebreak'},
    headStyles:{fillColor:[246,177,3],textColor:20},
    footStyles:{fillColor:[245,245,245],textColor:20,fontStyle:'bold'},
    didParseCell:d=>{
      if(d.section==='head'&&d.column.index>=2)d.cell.styles.halign='right';
      if(d.section==='foot'){d.cell.styles.halign=d.column.index===0?'left':'right';if(d.row.index<datos.totales.length-1)d.cell.styles.fontStyle='normal';}
    },
    willDrawPage:()=>{if(doc.internal.getCurrentPageInfo().pageNumber>1)fondo();}
  });
  y=doc.lastAutoTable.finalY+24;
  texto('Son: '+datos.totalLetras,9,true);
  if(datos.leyendaIva)texto(datos.leyendaIva,9);
  y+=4;
  if(datos.notas){y+=6;texto('NOTAS Y CONDICIONES',10,true);texto(datos.notas,9);y+=4;}
  if(datos.vigenciaTexto)texto('Esta cotización tiene vigencia hasta el '+datos.vigenciaTexto+'.',9);
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
    new TableRow({tableHeader:true,children:[celda('Servicio',true),celda('Descripción / leyenda',true),...titulosCantidad(datos).map(t=>celda(t,true)),celda(datos.encabezadoImporte,true)]}),
    ...datos.items.map(item=>new TableRow({children:[celda(item.servicio),celda(item.leyenda||'—'),...colsCantidad(datos,item).map(t=>celda(t)),celda(formatoMoneda(item.importe))]})),
    // Con IVA: Subtotal / IVA / Total; solo el total va resaltado.
    ...datos.totales.map(([etiqueta,cent],i)=>{const total=i===datos.totales.length-1;return new TableRow({children:[celda(''),...(datos.conCantidad?[celda(''),celda('')]:[]),celda(etiqueta,total),celda(formatoMoneda(cent/100),total)]});})
  ]});
  const documento=new Document({styles:{default:{document:{run:{font:'Arial',size:20,color:'222222'},paragraph:{spacing:{after:100}}}}},sections:[{
    properties:{page:{size:{width:12240,height:18360},margin:{top:2640,bottom:4160,left:960,right:960,header:0,footer:0}}},
    headers:{default:new Header({children:[new Paragraph({children:[new ImageRun({data:membrete,type:'png',transformation:{width:816,height:1224},floating:{horizontalPosition:{relative:'page',offset:0},verticalPosition:{relative:'page',offset:0},behindDocument:true,allowOverlap:true,layoutInCell:false}})]})]})},
    children:[
      new Paragraph({spacing:{after:160},children:[new TextRun({text:'Folio: '+datos.folio,bold:true,size:30})]}),
      parrafo('Fecha de cotización: '+datos.fechaCotizacion+(datos.vigenciaTexto?'   |   Vigencia hasta: '+datos.vigenciaTexto:'')),
      parrafo('Atendió: '+datos.atendioPor),
      parrafo('CLIENTE',true),parrafo(datos.cliente.nombre),
      ...(datos.cliente.empresa?[parrafo(datos.cliente.empresa)]:[]),
      ...(datos.cliente.telefono?[parrafo('Tel: '+datos.cliente.telefono)]:[]),
      ...(datos.cliente.direccion?[parrafo('Ubicación del servicio: '+datos.cliente.direccion)]:[]),
      tabla,parrafo('Son: '+datos.totalLetras,true),...(datos.leyendaIva?[parrafo(datos.leyendaIva)]:[]),parrafo(''),
      ...(datos.notas?[parrafo('NOTAS Y CONDICIONES',true),...datos.notas.split('\n').map(l=>parrafo(l))]:[]),
      ...(datos.vigenciaTexto?[parrafo('Esta cotización tiene vigencia hasta el '+datos.vigenciaTexto+'.')]:[])
    ]
  }]});
  saveAs(await Packer.toBlob(documento),nombreArchivoCotizacion(datos,'docx'));
}

// ---------- Generar documento de Orden de Servicio (PDF o Word) ----------
// Se entrega al cliente cuando acepta el servicio (lead.estatus === 'ganado'). A diferencia
// de la cotización (que es una propuesta con vigencia), esta formaliza el trabajo acordado:
// fecha del servicio, responsable asignado y espacio de firma de conformidad.
// TODO: ajusta este texto con las condiciones, alcance y garantía reales de Saneadren.
const CONDICIONES_ORDEN_SERVICIO = 'El presente documento formaliza el servicio aceptado por el cliente en los términos y el importe aquí descritos. Cualquier trabajo adicional no listado en esta orden se cotizará por separado.';

function folioOrdenServicio(lead) { return folioDeLead('OS', lead); }

function nombreArchivoOrdenServicio(datos, extension) {
  const cliente = (datos.cliente.nombre || 'cliente').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `orden_servicio_${datos.folio}_${cliente}.${extension}`;
}

function datosOrdenServicioDesdeLead(lead, items) {
  return {
    folio: folioOrdenServicio(lead),
    // Solo se cita la cotización si la orden realmente salió de una (no en directas ni duplicadas).
    folioCotizacion: lead.origen === 'directo' ? '' : folioCotizacion(lead),
    fechaServicio: lead.fecha_servicio ? lead.fecha_servicio.split('-').reverse().join('/') : 'Por confirmar',
    cliente: {
      nombre: lead.nombre || 'Cliente',
      empresa: lead.empresa_contacto || '',
      telefono: lead.telefono || '',
      direccion: lead.direccion || ''
    },
    equipo: lead.equipo || '',
    operador: [...(lead.equipo_personal || []).map(x => x.nombre), lead.operador].filter(Boolean).join(', '),
    proyecto: lead.proyecto || '',
    observaciones: lead.observaciones || '',
    items,
    ...importesDocumento(items)
  };
}
// ---- Duplicar orden: costos con terceros de la original que también se copian ----
async function pintarCostosDuplicar(origenId) {
  const caja = document.getElementById('sn-costos'), lista = document.getElementById('sn-costos-lista');
  caja.hidden = true; lista.innerHTML = '';
  if (!origenId) return;
  let costos;
  try { costos = await api('/finanzas/cxp?vista=todas&lead_id=' + Number(origenId)).then(r => r.json()); } catch { return; }
  if (DUPLICADO_DE !== origenId || !costos.length) return;
  lista.innerHTML = costos.map(x => `<label class="sn-costo"><input type="checkbox" checked data-cxp="${Number(x.id)}">
      <span><b>${escaparHtml(x.proveedor_nombre)}</b> · ${escaparHtml(x.concepto)}<small>${escaparHtml(x.categoria_nombre)}${x.saldo <= 0 ? ' · en la original ya está pagado' : ''}</small></span>
      <input type="text" inputmode="decimal" class="sn-costo-monto" aria-label="Monto con IVA" value="${Number(x.total).toFixed(2)}"></label>`).join('');
  caja.hidden = false;
}
const costosADuplicar = () => [...document.querySelectorAll('#sn-costos-lista input[data-cxp]:checked')].map(c => ({ cxp_id: Number(c.dataset.cxp), total: c.closest('.sn-costo').querySelector('.sn-costo-monto').value.trim() }));

// Rótulo del recuadro del total en la orden de servicio.
const etiquetaTotalOrden = modo => modo === 'mas_iva' ? 'TOTAL CON IVA' : modo === 'incluido' ? 'TOTAL (IVA INCLUIDO)' : modo === 'sin_iva' ? 'TOTAL (SIN IVA)' : 'IMPORTE TOTAL';

// Mismo orden de conceptos que el formato impreso "ORDENES DE SERVICIO" de Saneadren:
// Empresa/Fecha, Ubicación, Equipo, Operador → Descripción → Importe → Observaciones →
// Ejecutor / Vo.Bo. → Nombre y firma del operador / del cliente. Diseño ligero: etiquetas
// pequeñas sobre cada dato y líneas finas (sin cuadrícula pesada), para que respire sobre el membrete.
function camposOrden(datos) {
  return [
    // Con empresa: Empresa + Contacto (nombre y teléfono). Sin empresa: Cliente + Teléfono (no se inventa una empresa).
    datos.cliente.empresa
      ? [['Empresa', datos.cliente.empresa], ['Contacto', [datos.cliente.nombre, datos.cliente.telefono].filter(Boolean).join(' · ') || '—']]
      : [['Cliente', datos.cliente.nombre || '—'], ['Teléfono', datos.cliente.telefono || '—']],
    [['Ubicación', datos.cliente.direccion || '—']],
    [['Equipo', datos.equipo || ''], ['Operador(es)', datos.operador || '']],
    ...(datos.proyecto ? [[['Proyecto', datos.proyecto]]] : [])
  ];
}
const COLOR_ORDEN = { oscuro: [26, 29, 35], amarillo: [246, 177, 3], gris: [107, 114, 128], linea: [214, 217, 222], fondo: [246, 247, 249] };

async function generarPDFOrdenServicio(datos) {
  const membrete = await cargarMembreteOrdenServicio();
  const qr = await cargarQREncuesta().catch(() => null);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'pt', format:[612,918]});
  const C = COLOR_ORDEN, margen = 48, derecha = 564, ancho = 516, inicio = 126, limite = 706;
  let y = inicio;
  const fondo = () => doc.addImage(membrete,'PNG',0,0,612,918,'membrete');
  const pagina = () => { doc.addPage(); fondo(); y = inicio; };
  const asegurar = alto => { if (y + alto > limite) pagina(); };
  const fuente = (tam, negrita = false, color = C.oscuro) => { doc.setFont('helvetica', negrita ? 'bold' : 'normal'); doc.setFontSize(tam); doc.setTextColor(...color); };
  const linea = (x1, y1, x2, color = C.linea, grosor = 0.6) => { doc.setDrawColor(...color); doc.setLineWidth(grosor); doc.line(x1, y1, x2, y1); };
  const seccion = titulo => {
    asegurar(40);
    doc.setFillColor(...C.amarillo); doc.rect(margen, y - 8, 3, 11, 'F');
    fuente(9, true); doc.text(titulo, margen + 9, y + 1);
    linea(margen + 9 + doc.getTextWidth(titulo) + 8, y - 2, derecha);
    y += 14;
  };
  // Campo: etiqueta pequeña en gris y el dato debajo, con una línea fina como renglón.
  const campo = (etiqueta, valor, x, w) => {
    fuente(6.8, true, C.gris); doc.text(etiqueta.toUpperCase(), x, y);
    fuente(10); const lineas = doc.splitTextToSize(String(valor || ' '), w - 4);
    doc.text(lineas, x, y + 13);
    return 13 + (lineas.length - 1) * 12;
  };
  fondo();

  // Folio y fecha
  fuente(7, true, C.gris); doc.text('FOLIO', margen, y);
  fuente(14, true); doc.text(datos.folio, margen, y + 16);
  fuente(7, true, C.gris); doc.text('FECHA DEL SERVICIO', derecha, y, { align: 'right' });
  fuente(14, true); doc.text(datos.fechaServicio, derecha, y + 16, { align: 'right' });
  if (datos.folioCotizacion) { fuente(8, false, C.gris); doc.text('Cotización de referencia: ' + datos.folioCotizacion, margen + 160, y + 16); }
  y += 34;

  seccion('DATOS DEL SERVICIO');
  const gap = 20, mitad = (ancho - gap) / 2;
  for (const fila of camposOrden(datos)) {
    asegurar(34);
    const alto = Math.max(...fila.map(([e, v], i) => campo(e, v, margen + i * (mitad + gap), fila.length === 1 ? ancho : mitad)));
    fila.forEach((_, i) => linea(margen + i * (mitad + gap), y + alto + 5, margen + i * (mitad + gap) + (fila.length === 1 ? ancho : mitad)));
    y += alto + 19;
  }
  y += 4;

  seccion('DESCRIPCIÓN DEL TRABAJO');
  doc.autoTable({
    startY: y - 4, margin: { left: margen, right: margen, top: inicio, bottom: 212 }, theme: 'plain',
    head: [['Servicio', 'Descripción', ...titulosCantidad(datos), Importes.encabezadoImporte(datos.modo)]],
    body: datos.items.map(item => [item.servicio, item.leyenda || '—', ...colsCantidad(datos, item), formatoMoneda(item.importe)]),
    rowPageBreak: 'avoid',
    styles: { fontSize: 9.5, cellPadding: { top: 6, bottom: 6, left: 7, right: 7 }, textColor: C.oscuro, lineColor: C.linea, overflow: 'linebreak' },
    headStyles: { fillColor: C.oscuro, textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
    alternateRowStyles: { fillColor: C.fondo },
    columnStyles: datos.conCantidad
      ? { 0: { cellWidth: 120, fontStyle: 'bold' }, 2: { cellWidth: 38, halign: 'right' }, 3: { cellWidth: 72, halign: 'right' }, 4: { cellWidth: 82, halign: 'right' } }
      : { 0: { cellWidth: 140, fontStyle: 'bold' }, 2: { cellWidth: 90, halign: 'right' } },
    didParseCell: d => { if (d.section === 'head' && d.column.index >= 2) d.cell.styles.halign = 'right'; },
    didDrawCell: d => { if (d.section === 'body') { doc.setDrawColor(...C.linea); doc.setLineWidth(0.5); doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height); } },
    willDrawPage: () => { if (doc.internal.getCurrentPageInfo().pageNumber > 1) fondo(); }
  });
  y = doc.lastAutoTable.finalY + 10;
  // Total: recuadro a la derecha con acento amarillo, y el importe con letra a la izquierda.
  // Con IVA, encima del recuadro van Subtotal e IVA en renglones chicos.
  const desglose = datos.totales.slice(0, -1);
  asegurar(40 + desglose.length * 14);
  const anchoTotal = 210;
  desglose.forEach(([etiqueta, cent]) => {
    fuente(8, true, C.gris); doc.text(etiqueta.toUpperCase(), derecha - anchoTotal + 14, y + 9);
    fuente(9.5); doc.text(formatoMoneda(cent / 100), derecha - 10, y + 9, { align: 'right' });
    y += 14;
  });
  if (desglose.length) y += 4;
  doc.setFillColor(...C.fondo); doc.rect(derecha - anchoTotal, y, anchoTotal, 30, 'F');
  doc.setFillColor(...C.amarillo); doc.rect(derecha - anchoTotal, y, 4, 30, 'F');
  fuente(8, true, C.gris); doc.text(etiquetaTotalOrden(datos.modo), derecha - anchoTotal + 14, y + 19);
  fuente(14, true); doc.text(formatoMoneda(datos.total), derecha - 10, y + 20, { align: 'right' });
  fuente(8, false, C.gris);
  doc.text(doc.splitTextToSize('Son: ' + datos.totalLetras + (datos.leyendaIva ? ' ' + datos.leyendaIva : ''), ancho - anchoTotal - 20), margen, y + 13);
  y += 50;

  seccion('OBSERVACIONES');
  asegurar(56);
  doc.setFillColor(...C.fondo); doc.roundedRect(margen, y - 6, ancho, 48, 4, 4, 'F');
  if (datos.observaciones) { fuente(9.5); doc.text(doc.splitTextToSize(datos.observaciones, ancho - 20).slice(0, 3), margen + 10, y + 9); }
  else { [y + 12, y + 28].forEach(yy => linea(margen + 10, yy, derecha - 10, [200, 204, 210], 0.4)); } // renglones para escribir a mano
  y += 60;

  // Firmas: cuatro líneas como en el formato en papel.
  asegurar(110);
  const firma = (etiqueta, x, yy, nombre) => {
    if (nombre) { fuente(9.5); doc.text(nombre, x + mitad / 2, yy - 6, { align: 'center' }); }
    linea(x, yy, x + mitad, C.oscuro, 0.8);
    fuente(7, true, C.gris); doc.text(etiqueta, x + mitad / 2, yy + 11, { align: 'center' });
  };
  firma('EJECUTOR', margen, y + 20); firma('Vo.Bo.', margen + mitad + gap, y + 20);
  firma('NOMBRE Y FIRMA DEL OPERADOR', margen, y + 70, datos.operador); firma('NOMBRE Y FIRMA DEL CLIENTE', margen + mitad + gap, y + 70);
  y += 112;

  fuente(7.5, false, C.gris);
  doc.text(doc.splitTextToSize(CONDICIONES_ORDEN_SERVICIO, ancho - 80), margen, y);
  // Encuesta con QR a la derecha, alineada con las condiciones.
  if (qr) {
    const tamanoQR = 54;
    if (y + tamanoQR > limite + 4) pagina();
    doc.addImage(qr, 'PNG', derecha - tamanoQR, y - 8, tamanoQR, tamanoQR, 'qr');
    fuente(7, true); doc.text('CALIFICA EL SERVICIO', derecha - tamanoQR - 8, y + 14, { align: 'right' });
    fuente(7, false, C.gris); doc.text('Escanea el código', derecha - tamanoQR - 8, y + 24, { align: 'right' });
  }
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) { doc.setPage(i); fuente(7.5, false, C.gris); doc.text('Orden de servicio ' + datos.folio + ' · Página ' + i + ' de ' + paginas, derecha, 724, { align: 'right' }); }
  doc.save(nombreArchivoOrdenServicio(datos,'pdf'));
}

async function generarWordOrdenServicio(datos) {
  const membrete=await cargarMembreteOrdenServicio();
  const qr=await cargarQREncuesta().catch(()=>null);
  const {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,WidthType,Header,ImageRun,AlignmentType,HeightRule,VerticalAlign,BorderStyle,TabStopType}=docx;
  const OSC='1A1D23',AMA='F6B103',GRI='6B7280',LIN='D6D9DE',FON='F6F7F9';
  const nada={style:BorderStyle.NONE,size:0,color:'FFFFFF'};
  const sinBordes={top:nada,bottom:nada,left:nada,right:nada,insideHorizontal:nada,insideVertical:nada};
  const lineaAbajo=(color=LIN,size=4)=>({top:nada,left:nada,right:nada,bottom:{style:BorderStyle.SINGLE,size,color}});
  const run=(t,o={})=>new TextRun({text:String(t??''),bold:!!o.bold,size:o.size||20,color:o.color||OSC});
  const p=(hijos,o={})=>new Paragraph({spacing:{before:o.antes||0,after:o.despues??60},alignment:o.centro?AlignmentType.CENTER:o.derecha?AlignmentType.RIGHT:undefined,tabStops:o.tabs,children:[].concat(hijos)});
  const celda=(hijos,o={})=>new TableCell({columnSpan:o.span,borders:o.bordes||sinBordes,shading:o.fondo?{fill:o.fondo}:undefined,verticalAlign:o.abajo?VerticalAlign.BOTTOM:undefined,
    margins:{top:o.mv??60,bottom:o.mv??60,left:o.mh??100,right:o.mh??100},children:[].concat(hijos)});
  const tabla=(filas,anchos,o={})=>new Table({width:{size:100,type:WidthType.PERCENTAGE},columnWidths:anchos,borders:o.bordes||sinBordes,rows:filas});
  const fila=(celdas,alto)=>new TableRow({height:alto?{value:alto,rule:HeightRule.ATLEAST}:undefined,children:celdas});
  const seccion=t=>p([run('▌ ',{color:AMA,bold:true,size:20}),run(t,{bold:true,size:18})],{antes:220,despues:80});
  const campo=(etiqueta,valor,span)=>celda([p(run(etiqueta.toUpperCase(),{bold:true,size:14,color:GRI}),{despues:20}),p(run(valor||' '))],{span,bordes:lineaAbajo(),mh:40});
  const sep=()=>celda(p(run('')),{mh:0});

  const cabecera=tabla([fila([
    celda([p(run('FOLIO',{bold:true,size:14,color:GRI}),{despues:0}),p(run(datos.folio,{bold:true,size:28}))],{mh:0}),
    celda(datos.folioCotizacion?p(run('Cotización de referencia: '+datos.folioCotizacion,{size:16,color:GRI})):p(run('')),{abajo:true}),
    celda([p(run('FECHA DEL SERVICIO',{bold:true,size:14,color:GRI}),{derecha:true,despues:0}),p(run(datos.fechaServicio,{bold:true,size:28}),{derecha:true})],{mh:0})
  ])],[3300,3720,3300]);
  const datosServicio=tabla(camposOrden(datos).map(f=>fila(f.length===1?[campo(f[0][0],f[0][1],3)]:[campo(f[0][0],f[0][1]),sep(),campo(f[1][0],f[1][1])])),[5000,320,5000]);
  const trabajo=tabla([
    fila(['Servicio','Descripción',...titulosCantidad(datos),Importes.encabezadoImporte(datos.modo)].map((t,i)=>celda(p(run(t,{bold:true,size:17,color:'FFFFFF'}),{derecha:i>=2}),{fondo:OSC}))),
    ...datos.items.map((item,n)=>fila([
      celda(p(run(item.servicio,{bold:true,size:19})),{fondo:n%2?FON:undefined,bordes:lineaAbajo()}),
      celda(p(run(item.leyenda||'—',{size:19})),{fondo:n%2?FON:undefined,bordes:lineaAbajo()}),
      ...colsCantidad(datos,item).map(t=>celda(p(run(t,{size:19}),{derecha:true}),{fondo:n%2?FON:undefined,bordes:lineaAbajo()})),
      celda(p(run(formatoMoneda(item.importe),{size:19}),{derecha:true}),{fondo:n%2?FON:undefined,bordes:lineaAbajo()})]))
  ],datos.conCantidad?[2400,4120,800,1200,1800]:[2800,5720,1800]);
  // Con IVA, Subtotal e IVA van en renglones chicos encima del total, dentro del mismo recuadro.
  const desglose=datos.totales.slice(0,-1).map(([etiqueta,cent])=>p([run(etiqueta.toUpperCase()+'   ',{bold:true,size:14,color:GRI}),run(formatoMoneda(cent/100),{size:18})],{derecha:true,despues:20}));
  const total=tabla([fila([
    celda([p(run('Son: '+datos.totalLetras,{size:16,color:GRI}))].concat(datos.leyendaIva?[p(run(datos.leyendaIva,{size:16,color:GRI}))]:[]),{mh:0}),
    celda([...desglose,p([run(etiquetaTotalOrden(datos.modo)+'   ',{bold:true,size:15,color:GRI}),run(formatoMoneda(datos.total),{bold:true,size:28})],{derecha:true})],{fondo:FON,bordes:{top:nada,bottom:nada,right:nada,left:{style:BorderStyle.SINGLE,size:24,color:AMA}}})
  ])],[6120,4200]);
  const observaciones=tabla([fila([celda(datos.observaciones?p(run(datos.observaciones)):p(run('')),{fondo:FON,mv:120})],900)],[10320]);
  const firma=(etiqueta,nombre)=>celda([p(run(nombre||' '),{centro:true,despues:0})].concat(p(run(etiqueta,{bold:true,size:14,color:GRI}),{centro:true})),{bordes:{top:nada,left:nada,right:nada,bottom:nada},mh:0});
  const lineaFirma=()=>celda(p(run('')),{bordes:lineaAbajo(OSC,8),mh:0});
  const firmas=tabla([
    fila([lineaFirma(),sep(),lineaFirma()],650),
    fila([firma('EJECUTOR'),sep(),firma('Vo.Bo.')]),
    fila([celda(p(run(datos.operador||' '),{centro:true}),{bordes:lineaAbajo(OSC,8),abajo:true,mh:0}),sep(),lineaFirma()],750),
    fila([firma('NOMBRE Y FIRMA DEL OPERADOR'),sep(),firma('NOMBRE Y FIRMA DEL CLIENTE')])
  ],[5000,320,5000]);

  const documento=new Document({styles:{default:{document:{run:{font:'Arial',size:20,color:OSC},paragraph:{spacing:{after:60}}}}},sections:[{
    properties:{page:{size:{width:12240,height:18360},margin:{top:2520,bottom:4240,left:960,right:960,header:0,footer:0}}},
    headers:{default:new Header({children:[new Paragraph({children:[new ImageRun({data:membrete,type:'png',transformation:{width:816,height:1224},floating:{horizontalPosition:{relative:'page',offset:0},verticalPosition:{relative:'page',offset:0},behindDocument:true,allowOverlap:true,layoutInCell:false}})]})]})},
    children:[
      cabecera,
      seccion('DATOS DEL SERVICIO'),datosServicio,
      seccion('DESCRIPCIÓN DEL TRABAJO'),trabajo,p(run(''),{despues:80}),total,
      seccion('OBSERVACIONES'),observaciones,
      p(run(''),{despues:200}),firmas,
      p(run(CONDICIONES_ORDEN_SERVICIO,{size:15,color:GRI}),{antes:240}),
      ...(qr?[p([new ImageRun({data:qr,type:'png',transformation:{width:72,height:72}}),run('   Califica el servicio: escanea el código',{size:16,color:GRI})],{antes:80})]:[])
    ]
  }]});
  saveAs(await Packer.toBlob(documento),nombreArchivoOrdenServicio(datos,'docx'));
}

async function descargarOrdenServicioActual(mensaje){
  const formato=document.querySelector('input[name="gc-formato"]:checked').value;
  const datos=datosOrdenServicioDesdeLead(LEAD_ACTUAL,recolectarItemsCotizacion());
  if(formato==='pdf')await generarPDFOrdenServicio(datos);else await generarWordOrdenServicio(datos);
  registrarEventoSistema(LEAD_ACTUAL.id, 'Orden de servicio descargada ('+formato.toUpperCase()+').');
  toast(mensaje || 'Orden de servicio generada');
}
// Convertir en orden de servicio: abre la misma ventana que una orden nueva, con lo que tiene la
// cotización en pantalla (partidas, IVA, ubicación); ahí se completan fecha, equipo y operador.
on('btn-generar-orden-servicio','click',async()=>{
  const lead=LEAD_ACTUAL;
  if(!lead||lead.estatus!=='abierto')return;
  if(!lead.cliente_id){toast('Esta cotización no tiene un contacto asociado; no se puede convertir.');return;}
  if(!validarEditorCotizacion())return;
  const items=recolectarItemsCotizacion();
  const prefill={convertir_de:lead.id,folio:folioCotizacion(lead),partidas_json:JSON.stringify(items),servicio_nombre:items[0]?.servicio,
    iva_modo:modoIvaEditor(),iva_tasa:IVA_TASA,direccion:document.getElementById('ed-direccion').value.trim()||lead.direccion,
    equipo:lead.equipo,operador:lead.operador,observaciones:lead.observaciones,proyecto:lead.proyecto,manifiestos:lead.manifiestos,tiros:lead.tiros,
    fecha_cotizacion:document.getElementById('ed-fecha-cotizacion').value||lead.fecha_cotizacion||String(lead.created_at||'').slice(0,10)};
  FlujoCRM.marcarGuardado('overlay-ficha'); // lo capturado en la ficha pasa a la ventana
  await FlujoCRM.nuevoRegistro(lead.cliente_id,'convertir',prefill);
});
document.getElementById('cadena-documentos').addEventListener('click',async e=>{
  if(!e.target.closest('[data-ver-cotizacion]'))return;
  if(!validarEditorCotizacion())return;
  try{ await descargarCotizacionActual(); }
  catch(err){toast('No se pudo generar la cotización: '+err.message);}
});

// ---------- Ventana emergente: armar la cotización (varios servicios, leyenda y formato) ----------
let GC_CONTADOR = 0;

function crearFilaServicioHTML(item) {
  const id = ++GC_CONTADOR;
  const opciones = (CATALOGOS.servicios || []).map(s =>
    `<option value="${escaparHtml(s.nombre)}" ${s.nombre === item.servicio ? 'selected' : ''}>${escaparHtml(s.nombre)}</option>`
  ).join('');
  return `
    <div class="gc-fila" data-fila="${id}">
      <div class="gc-fila-cab"><span class="gc-fila-num"></span><button type="button" class="btn-eliminar gc-quitar perm-ordenes-importes" data-fila="${id}">🗑 Quitar</button></div>
      <div class="gc-fila-grid">
        <div class="campo-modal gc-c-servicio">
          <label for="gc-servicio-${id}">Servicio</label>
          <select class="gc-servicio" id="gc-servicio-${id}" data-fila="${id}">
            <option value="">— Selecciona —</option>
            ${opciones}
          </select>
        </div>
          <div class="campo-modal gc-c-cantidad"><label for="gc-cantidad-${id}">Cantidad</label>
            <input type="number" class="gc-cantidad" id="gc-cantidad-${id}" data-fila="${id}" min="0.001" step="any" value="${Number(Importes.cantidadDe(item))}"></div>
          <div class="campo-modal gc-c-precio perm-ordenes-importes"><label class="gc-etiqueta-importe" for="gc-precio-${id}">${etiquetaPrecio(modoIvaEditor())}</label>
            <input type="number" class="gc-precio" id="gc-precio-${id}" data-fila="${id}" min="0.01" step="0.01" placeholder="Precio" value="${item.importe === undefined && item.precio === undefined ? '' : Number(Importes.precioDe(item))}"></div>
          <div class="campo-modal gc-c-importe perm-ordenes-importes"><label for="gc-importe-${id}">Importe</label>
            <input type="number" class="gc-importe" id="gc-importe-${id}" data-fila="${id}" readonly tabindex="-1" value="${item.importe ?? ''}"></div>
        <div class="campo-modal gc-c-leyenda">
          <label for="gc-leyenda-${id}">Descripción / leyenda</label>
          <textarea class="gc-leyenda" id="gc-leyenda-${id}" data-fila="${id}" data-plantilla="${escaparHtml(descripcionServicio(item.servicio))}" rows="2">${escaparHtml(item.leyenda || '')}</textarea>
        </div>
      </div>
    </div>
  `;
}

// Rótulo del precio unitario según el IVA del documento.
const etiquetaPrecio = modo => 'Precio unitario' + (modo === 'incluido' ? ' con IVA' : modo === 'mas_iva' ? ' sin IVA' : '');
function agregarFilaCotizacion(item = {}) {
  document.getElementById('gc-items').insertAdjacentHTML('beforeend', crearFilaServicioHTML(item));
}

// ---------- IVA del documento (casilla "IVA incluido") ----------
// #gc-iva-modo guarda el modo: 'mas_iva' (casilla sin marcar: los importes son sin IVA y se
// suma el 16 %), 'incluido' (marcada: ya lo traen y se desglosa) o '' = por definir (registros
// anteriores al IVA). Es un campo oculto para que el aviso de cambios sin guardar lo vigile.
let IVA_TASA = Importes.TASA_DEFAULT;
let IVA_BLOQUEADO = false; // orden de servicio: solo administración o atención cambian su IVA
const modoIvaEditor = () => document.getElementById('gc-iva-modo').value || null;
const ivaPayload = () => modoIvaEditor() ? { iva_modo: modoIvaEditor(), iva_tasa: Importes.tasaDe(modoIvaEditor(), IVA_TASA) } : {};
function fijarModoIva(modo) {
  const campo = document.getElementById('gc-iva-modo');
  if (campo.value === (modo || '')) return;
  campo.value = modo || '';
  campo.dispatchEvent(new Event('change', { bubbles: true })); // aviso de cambios sin guardar
  actualizarTotalCotizacion();
}
function pintarIvaEditor() {
  const modo = modoIvaEditor();
  document.querySelectorAll('input[name="gc-iva-opcion"]').forEach(r => { r.checked = r.value === modo; r.disabled = IVA_BLOQUEADO; });
  document.getElementById('gc-iva-ayuda').textContent = !modo ? ''
    : ({ incluido: `Escribe el total que paga el cliente: el sistema separa el subtotal y el IVA (${IVA_TASA} %). Ej.: 1,160 = 1,000 + 160.`,
      mas_iva: `Escribe el precio sin IVA: el sistema suma el ${IVA_TASA} %. Ej.: 1,000 + 160 = 1,160.`,
      sin_iva: 'El precio no lleva IVA: el cliente paga exactamente lo que escribes. Ej.: 1,000 = 1,000.' }[modo] || '')
      + (IVA_BLOQUEADO ? ' Solo administración o atención pueden cambiar el IVA o los importes de una orden de servicio.' : '');
  // En una orden, quien no puede cambiar lo que se cobra tampoco puede editar importes ni partidas
  // (antes podía escribirlos y el error salía hasta guardar).
  document.querySelectorAll('#gc-items .gc-cantidad, #gc-items .gc-precio').forEach(i => { i.readOnly = IVA_BLOQUEADO; });
  document.querySelectorAll('#gc-items .gc-quitar').forEach(b => { b.disabled = IVA_BLOQUEADO; });
  document.getElementById('btn-gc-agregar-servicio').disabled = IVA_BLOQUEADO;
  document.getElementById('gc-iva-aviso').hidden = !!modo;
  if (!modo) {
    document.getElementById('gc-iva-aviso-texto').textContent = IVA_BLOQUEADO
      ? 'IVA por definir: este registro es anterior al IVA. Lo indica administración o atención.'
      : 'IVA por definir: este registro es anterior al IVA. Elige cómo va el importe que se le dio al cliente: más IVA, IVA incluido o sin IVA.';
  }
  document.querySelectorAll('#gc-items .gc-etiqueta-importe').forEach(l => { l.textContent = etiquetaPrecio(modo); });
}
document.querySelectorAll('input[name="gc-iva-opcion"]').forEach(r => r.addEventListener('change', () => { if (r.checked) fijarModoIva(r.value); }));

function actualizarTotalCotizacion() {
  pintarIvaEditor();
  const modo = modoIvaEditor();
  const items = Array.from(document.querySelectorAll('#gc-items .gc-importe')).map(input => ({ importe: Number(input.value) || 0 }));
  const r = Importes.calcular(items, modo, IVA_TASA);
  const filas = Importes.filasTotales(r, modo, IVA_TASA);
  // Con desglose (más IVA o IVA incluido) hay Subtotal / IVA / Total; sin IVA o por definir, solo Total.
  const conDesglose = filas.length > 1;
  document.getElementById('gc-fila-subtotal').hidden = !conDesglose;
  document.getElementById('gc-fila-iva').hidden = !conDesglose;
  if (conDesglose) {
    document.getElementById('gc-etiqueta-subtotal').textContent = filas[0][0];
    document.getElementById('gc-subtotal').textContent = formatoMoneda(filas[0][1] / 100);
    document.getElementById('gc-etiqueta-iva').textContent = filas[1][0];
    document.getElementById('gc-iva-monto').textContent = formatoMoneda(filas[1][1] / 100);
  }
  document.getElementById('gc-etiqueta-total').textContent = filas.at(-1)[0];
  document.getElementById('gc-total').textContent = formatoMoneda(r.total_cent / 100);
}

function recolectarItemsCotizacion() {
  return Array.from(document.querySelectorAll('#gc-items .gc-fila'))
    .map(fila => ({
      servicio: fila.querySelector('.gc-servicio').value,
      leyenda: fila.querySelector('.gc-leyenda').value.trim(),
      cantidad: Number(fila.querySelector('.gc-cantidad').value) || 1,
      precio: Number(fila.querySelector('.gc-precio').value) || 0,
      importe: Number(fila.querySelector('.gc-importe').value) || 0
    }))
    .filter(item => item.servicio || item.importe || item.leyenda);
}

let EDITOR_MODO='existente';
function prepararEditorCotizacion(lead,modo){
  EDITOR_MODO=modo;
  const editor=document.getElementById('editor-cotizacion');
  if(modo==='nuevo')document.getElementById('editor-nuevo-destino').append(editor);
  else document.getElementById('ed-direccion').closest('.form-grid-2').after(editor);
  editor.hidden=false;
  // La barra de guardado va al final: en la ventana de crear o en la ficha del registro.
  const barra=document.getElementById('barra-acciones');barra.hidden=false;
  // El aviso de "cambios sin guardar" va dentro de la barra, junto a los botones.
  const grupoFicha=document.getElementById('btn-guardar-ficha').closest('.btn-group');
  const estadoNuevo=document.getElementById('estado-guardado-nuevo'),estadoFicha=document.getElementById('estado-guardado-registro');
  if(modo==='nuevo'){document.getElementById('btn-guardar-servicio-nuevo').before(barra);grupoFicha.prepend(estadoFicha);barra.prepend(estadoNuevo);}
  else{grupoFicha.before(barra);document.getElementById('btn-guardar-servicio-nuevo').before(estadoNuevo);barra.prepend(estadoFicha);}
  document.getElementById('btn-barra-guardar').textContent=modo==='nuevo'?'Guardar':'Guardar cambios';
  ['sn-servicio','sn-valor','ed-servicio','ed-valor','ed-canal'].forEach(id=>document.getElementById(id).parentElement.hidden=true);
  // IVA: un registro nuevo empieza "más IVA" (casilla sin marcar); los demás traen el suyo.
  document.getElementById('gc-iva-modo').value=(lead && 'iva_modo' in lead ? lead.iva_modo : 'mas_iva')||'';
  IVA_TASA=lead?.iva_tasa||Importes.TASA_DEFAULT;
  IVA_BLOQUEADO=modo!=='nuevo'&&lead?.estatus==='ganado'&&!Permisos.puede('ordenes.importe_ganada');
  document.getElementById('gc-notas').value=lead?.notas_cotizacion||'';
  document.getElementById('gc-items').innerHTML='';GC_CONTADOR=0;
  let items;try{items=JSON.parse(lead?.partidas_json||'null');}catch{}
  (items||[{servicio:lead?.servicio_nombre||'',leyenda:descripcionServicio(lead?.servicio_nombre||''),...(lead?.valor?{importe:lead.valor}:{})}]).forEach(agregarFilaCotizacion); // sin precio: el campo queda vacío, nunca en $0
  actualizarTotalCotizacion();sincronizarEditor();
  // Sin «Ver importes»: las partidas se leen (servicio, descripción y cantidad) pero no se cambian; el servidor tampoco las cambia.
  const soloLeer=!Permisos.puede('ordenes.importes');
  document.querySelectorAll('#gc-items .gc-servicio').forEach(x=>{x.disabled=soloLeer;});
  document.querySelectorAll('#gc-items .gc-leyenda, #gc-items .gc-cantidad').forEach(x=>{if(soloLeer)x.readOnly=true;});
}
function sincronizarEditor(){
  const items=recolectarItemsCotizacion(),prefijo=EDITOR_MODO==='nuevo'?'sn':'ed';
  const servicio=CATALOGOS.servicios.find(s=>s.nombre===items[0]?.servicio);
  document.getElementById(prefijo+'-servicio').value=servicio?.id||'';
  document.getElementById(prefijo+'-valor').value=Importes.calcular(items,modoIvaEditor(),IVA_TASA).subtotal_cent/100;
}
function validarEditorCotizacion(){
  if(!Permisos.puede('ordenes.importes'))return true; // sin importes las partidas no se cambian (el servidor las ignora)
  const filas=[...document.querySelectorAll('#gc-items .gc-fila')];
  if(!filas.length||filas.some(f=>!f.querySelector('.gc-servicio').value||f.querySelector('.gc-precio').value===''||!(Number(f.querySelector('.gc-precio').value)>0)||!(Number(f.querySelector('.gc-cantidad').value)>0))){toast('Selecciona un servicio y escribe cantidad y precio unitario (mayor a $0) en cada partida');return false;}
  // Un registro nuevo o una cotización abierta deben decir si sus importes llevan IVA.
  if(!modoIvaEditor()&&(EDITOR_MODO==='nuevo'||LEAD_ACTUAL?.estatus==='abierto')){
    toast('Indica el IVA: elige Más IVA, IVA incluido o Sin IVA');
    document.getElementById('gc-iva').scrollIntoView({block:'center',behavior:'smooth'});return false;
  }
  return true;
}
async function descargarCotizacionActual(){
  const formato=document.querySelector('input[name="gc-formato"]:checked').value;
  const datos=datosCotizacionDesdeLead(LEAD_ACTUAL,recolectarItemsCotizacion());
  if(formato==='pdf')await generarPDFCotizacion(datos);else await generarWordCotizacion(datos);
  registrarEventoSistema(LEAD_ACTUAL.id, 'Cotización descargada ('+formato.toUpperCase()+').');
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
  // Importe de la partida = cantidad × precio unitario.
  if (e.target.classList.contains('gc-cantidad') || e.target.classList.contains('gc-precio')) {
    const fila = e.target.closest('.gc-fila'), precio = fila.querySelector('.gc-precio').value;
    fila.querySelector('.gc-importe').value = precio === '' ? '' : Importes.importeDe(fila.querySelector('.gc-cantidad').value, precio);
    actualizarTotalCotizacion();
  }
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
    // La primera cotización descargada es la señal de que ya se le envió una propuesta al
    // cliente: el lead avanza de "Recolección de datos" a "Cotización enviada" sin que haya
    // que arrastrar la tarjeta a mano.
    const payload=recolectarPayloadFicha();
    if(LEAD_ACTUAL.etapa===1)payload.etapa=2;
    if(!await guardarLeadExistente(payload))return;
    FlujoCRM.marcarGuardado('overlay-ficha');
    // En una orden de servicio el documento que se entrega es la orden, no la cotización.
    if(LEAD_ACTUAL.estatus==='ganado')await descargarOrdenServicioActual('Orden de servicio guardada y descargada');
    else await descargarCotizacionActual();
  }catch(err){toast('No se pudo guardar o descargar: '+err.message);}finally{btn.disabled=false;}
});

// ---------- Exportar a Excel (CSV con BOM, se abre directo con Excel) ----------
// Exportar a Excel: permiso «clientes.exportar» (los botones también se ocultan con .perm-clientes-exportar).
function descargarCSV(nombreArchivo, columnas, filas) {
  if (!Permisos.puede('clientes.exportar')) { toast('No tienes permiso para exportar a Excel'); return; }
  const escaparCelda = valor => {
    let texto = String(valor ?? '');
    // Un texto que empieza con = + - @ Excel lo ejecuta como fórmula (p. ej. =HYPERLINK que manda
    // datos fuera). Se antepone un apóstrofo, salvo que sea un número.
    if (/^[=+\-@\t\r]/.test(texto) && !/^-?\d+(\.\d+)?$/.test(texto)) texto = "'" + texto;
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
  descargarCSV('cotizaciones_saneadren_' + hoyISO() + '.csv', [
    { titulo: 'ID', valor: l => l.id },
    { titulo: 'Teléfono', valor: l => l.telefono },
    { titulo: 'Nombre', valor: l => l.nombre || '' },
    { titulo: 'Empresa', valor: l => l.empresa_contacto || '' },
    { titulo: 'Dirección', valor: l => l.direccion || '' },
    { titulo: 'Canal', valor: l => l.canal_nombre || '' },
    { titulo: 'Servicio', valor: l => l.servicio_nombre || '' },
    { titulo: 'Atendido por', valor: l => l.responsable_nombre || '' },
    { titulo: 'Etapa', valor: l => l.etapa },
    { titulo: 'Estatus', valor: l => l.estatus },
    { titulo: 'Servicio cotizado o contratado', valor: l => l.estatus === 'ganado' ? 'Contratado' : 'Cotizado' },
    { titulo: 'Importe sin IVA (MXN)', valor: l => l.valor ?? '' },
    { titulo: 'IVA (MXN)', valor: l => l.iva_cent == null ? '' : l.iva_cent / 100 },
    { titulo: 'Total con IVA (MXN)', valor: l => l.valor == null ? '' : (Math.round(l.valor * 100) + (l.iva_cent || 0)) / 100 },
    { titulo: 'Tipo de precio', valor: l => Importes.etiquetaModo(l.iva_modo, l.iva_tasa) },
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
  descargarCSV('clientes_saneadren_' + hoyISO() + '.csv', [
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
    body.innerHTML = '<tr><td class="util-37" colspan="7">No hay contactos con estos filtros. Puedes crear uno con Nuevo contacto.</td></tr>';
    return;
  }
  // Una fila por contacto: quién es, qué tipo de contacto es y cuánto ha contratado.
  const tipo = c => c.servicios_ganados > 1 ? ['recurrente', 'Recurrente'] : c.servicios_ganados > 0 ? ['cliente', 'Cliente'] : ['prospecto', 'Prospecto'];
  body.innerHTML = clientes.map(c => `
    <tr onclick="abrirFichaCliente(${Number(c.id)})">
      <td data-label="Contacto"><b>${escaparHtml(c.nombre || 'Sin nombre')}</b><small class="contacto-relacion">${escaparHtml([folioCliente(c.id), c.empresa_contacto, c.telefono].filter(Boolean).join(' · '))}</small></td>
      <td data-label="Tipo"><span class="tipo-contacto ${tipo(c)[0]}">${tipo(c)[1]}</span></td>
      <td data-label="Cotizaciones abiertas" class="st-num">${Number(c.solicitudes_abiertas) || '—'}</td>
      <td data-label="Órdenes de servicio" class="st-num">${Number(c.servicios_ganados) || '—'}</td>
      <td data-label="Contratado (sin IVA)" class="st-num perm-ordenes-importes">${c.valor_ganado_total ? formatoMoneda(c.valor_ganado_total) : '—'}</td>
      <td data-label="Última actividad">${fechaCorta(c.ultima_actividad)}</td>
      <td><button type="button" class="btn btn-outline">Abrir</button></td>
    </tr>
  `).join('');
}

// ---------- Ficha de cliente ----------
async function abrirFichaCliente(id) {
  if (!await FlujoCRM.permitirCambio('overlay-ficha-cliente')) return;
  const cliente = await api('/clientes/' + id).then(r => r.json());
  CLIENTE_ACTUAL = cliente;

  document.getElementById('fc-titulo').textContent = [folioCliente(cliente.id), cliente.empresa_contacto || cliente.nombre || 'Sin nombre', cliente.telefono].filter(Boolean).join(' · ');
  pintarTelefonosCliente(cliente.id);
  Bitacora.historialCliente(cliente.id);
  document.getElementById('fc-meta').innerHTML = metaClienteHTML(cliente);
  Finanzas.pintarCliente(cliente);
  document.getElementById('fc-ed-telefono').value = cliente.telefono || '';
  document.getElementById('fc-ed-telefono-alterno').value = cliente.telefono_alterno || '';
  document.getElementById('fc-ed-nombre').value = cliente.nombre || '';
  document.getElementById('fc-ed-correo').value = cliente.correo || '';
  document.getElementById('fc-ed-empresa').value = cliente.empresa_contacto || '';
  document.getElementById('fc-ed-rfc').value = cliente.rfc || '';
  document.getElementById('fc-ed-direccion').value = cliente.direccion || '';
  document.getElementById('fc-ed-giro').value = cliente.giro || '';
  document.getElementById('fc-ed-notas-generales').value = cliente.notas_generales || '';
  document.getElementById('fc-ed-origen').value = cliente.canal_origen_id ? String(cliente.canal_origen_id) : '';

  renderServiciosCliente(cliente.servicios || []);
  abrirVentana('overlay-ficha-cliente');
  FlujoCRM.presentarContacto(cliente);
  FlujoCRM.marcarGuardado('overlay-ficha-cliente');
}

// ---------- Revisar duplicados (administración) ----------
async function abrirDuplicados() {
  const cont = document.getElementById('dup-pares');
  cont.innerHTML = '<p class="util-45" role="status">Buscando…</p>';
  abrirVentana('overlay-duplicados');
  let pares;
  try { const r = await api('/clientes/duplicados'); pares = await r.json(); if (!r.ok) throw new Error(pares.error); } catch (err) { cont.innerHTML = '<p class="aviso-error-carga">' + escaparHtml(err.message) + '</p>'; return; }
  if (!pares.length) { cont.innerHTML = '<p class="dup-limpio">✔ No hay posibles duplicados.</p>'; return; }
  const lado = c => '<div class="dup-lado"><b>' + escaparHtml(c.folio + ' · ' + (c.empresa || c.nombre || 'Sin nombre')) + '</b><small>' + escaparHtml([c.empresa && c.nombre !== c.empresa ? c.nombre : '', c.telefono ? 'tel. ' + c.telefono : 'sin teléfono', c.rfc ? 'RFC ' + c.rfc : '', c.servicios + (c.servicios === 1 ? ' registro' : ' registros')].filter(Boolean).join(' · ')) + '</small></div>';
  cont.innerHTML = '<p class="ayuda">' + pares.length + (pares.length === 1 ? ' pareja' : ' parejas') + ' por revisar.</p>' + pares.map((p, i) => '<div class="dup-par" data-par="' + i + '"><div class="dup-motivo">' + escaparHtml(p.motivo) + (p.marcado_distinto_por ? ' · ' + escaparHtml(p.marcado_distinto_por) + ' dijo que son distintos: confírmalo' : '') + '</div><div class="dup-lados">' + lado(p.a) + lado(p.b) + '</div>'
    + '<div class="dup-acciones"><button type="button" class="btn btn-outline btn-chico" data-dup-juntar="' + i + '" data-queda="b">Juntar en ' + escaparHtml(p.b.folio) + '</button><button type="button" class="btn btn-outline btn-chico" data-dup-juntar="' + i + '" data-queda="a">Juntar en ' + escaparHtml(p.a.folio) + '</button><button type="button" class="btn btn-secundario btn-chico" data-dup-distintos="' + i + '">Son distintos</button></div></div>').join('');
  cont.onclick = async e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const p = pares[Number(b.dataset.dupJuntar ?? b.dataset.dupDistintos)];
    if (b.dataset.dupDistintos !== undefined) {
      b.disabled = true;
      const r = await api('/clientes/distintos', { method: 'POST', body: JSON.stringify({ a: p.a.id, b: p.b.id }) });
      if (r.ok) { b.closest('.dup-par').remove(); toast('Marcados como clientes distintos'); } else { b.disabled = false; toast('No se pudo guardar'); }
      return;
    }
    const queda = b.dataset.queda === 'a' ? p.a : p.b, sale = b.dataset.queda === 'a' ? p.b : p.a;
    if (!await solicitarDialogo({ titulo: 'Juntar clientes', mensaje: 'Todo lo de ' + sale.folio + ' (' + (sale.empresa || sale.nombre) + ': cotizaciones, órdenes, cobros y teléfonos) pasa a ' + queda.folio + ' (' + (queda.empresa || queda.nombre) + '). ' + sale.folio + ' deja de existir y su ID queda apuntando a ' + queda.folio + '.', aceptar: 'Juntar en ' + queda.folio })) return;
    b.disabled = true;
    const r = await api('/clientes/' + sale.id + '/fusionar', { method: 'POST', body: JSON.stringify({ con: queda.id }) });
    const d = await r.json();
    if (!r.ok) { b.disabled = false; toast(d.error || 'No se pudieron juntar'); return; }
    toast('Juntados en ' + queda.folio);
    await abrirDuplicados(); cargarClientes();
  };
}
on('btn-revisar-duplicados', 'click', abrirDuplicados);

// Otros teléfonos del mismo cliente (sucursales, otras personas): cualquiera de ellos lo identifica.
async function pintarTelefonosCliente(id) {
  const cont = document.getElementById('fc-telefonos');
  if (!cont) return;
  let lista = [];
  try { lista = await api('/clientes/' + id + '/telefonos').then(r => r.json()); } catch { lista = []; }
  cont.innerHTML = (lista.length ? lista.map(t => '<span class="chip tel-chip">' + escaparHtml(t.telefono) + (t.etiqueta ? ' <small>' + escaparHtml(t.etiqueta) + '</small>' : '')
    + ' <button type="button" class="tel-quitar" data-tel-quitar="' + escaparHtml(t.telefono_normalizado) + '" aria-label="Quitar teléfono">✕</button></span>').join('') : '<span class="util-45">Ninguno</span>')
    + ' <button type="button" class="btn btn-outline btn-chico" id="fc-tel-agregar">+ Agregar teléfono</button>';
}
document.addEventListener('click', e => manejarTelefonos(e).catch(err => toast(err.message)));
async function manejarTelefonos(e) {
  if (!CLIENTE_ACTUAL) return;
  const quitar = e.target.closest('[data-tel-quitar]');
  if (quitar && quitar.closest('#fc-telefonos')) {
    if (!await solicitarDialogo({ titulo: 'Quitar teléfono', mensaje: 'Este teléfono ya no identificará a ' + folioCliente(CLIENTE_ACTUAL.id) + '.', aceptar: 'Quitar' })) return;
    const rq = await api('/clientes/' + CLIENTE_ACTUAL.id + '/telefonos/' + encodeURIComponent(quitar.dataset.telQuitar), { method: 'DELETE' });
    if (!rq.ok) { toast((await rq.json().catch(() => ({}))).error || 'No se pudo quitar el teléfono'); return; }
    pintarTelefonosCliente(CLIENTE_ACTUAL.id); return;
  }
  if (e.target.id === 'fc-tel-agregar') {
    const tel = await solicitarDialogo({ titulo: 'Agregar teléfono', mensaje: 'Otro teléfono de ' + folioCliente(CLIENTE_ACTUAL.id) + ' (otra persona o sucursal de la misma razón social). Si llaman de ese número, el CRM reconocerá a este cliente.', aceptar: 'Agregar', campo: { tipo: 'tel', etiqueta: 'Teléfono (10 dígitos)' } });
    if (!tel) return;
    const r = await api('/clientes/' + CLIENTE_ACTUAL.id + '/telefonos', { method: 'POST', body: JSON.stringify({ telefono: tel }) });
    const d = await r.json();
    if (!r.ok) { toast(d.error || 'No se pudo agregar'); return; }
    toast('Teléfono agregado'); pintarTelefonosCliente(CLIENTE_ACTUAL.id);
  }
}

function renderServiciosCliente(servicios) {
  ServiciosTabla.render('fc-servicios', servicios, CLIENTE_ACTUAL.id, 'cliente');
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
  // Igual que al crear el contacto: «¿Cómo se enteró?» es obligatorio (un contacto importado sin origen lo completa aquí).
  if (!document.getElementById('fc-ed-origen').value) { toast('Selecciona cómo se enteró de nosotros'); document.getElementById('fc-ed-origen').focus(); return; }
  const payload = {
    telefono: document.getElementById('fc-ed-telefono').value.trim(),
    telefono_alterno: document.getElementById('fc-ed-telefono-alterno').value.trim(),
    nombre: document.getElementById('fc-ed-nombre').value.trim(),
    correo: document.getElementById('fc-ed-correo').value.trim(),
    empresa_contacto: document.getElementById('fc-ed-empresa').value.trim(),
    rfc: document.getElementById('fc-ed-rfc').value.trim(),
    direccion: document.getElementById('fc-ed-direccion').value.trim(),
    giro: document.getElementById('fc-ed-giro').value,
    notas_generales: document.getElementById('fc-ed-notas-generales').value.trim(),
    canal_origen_id: Number(document.getElementById('fc-ed-origen').value)
  };
  try {
    const res = await api('/clientes/' + CLIENTE_ACTUAL.id, { method: 'PUT', body: JSON.stringify(payload) });
    // api() ya lanza los rechazos salvo el 409 (conflicto), que se resuelve abajo; esto es por si algún otro llegara aquí.
    if (!res.ok && res.status !== 409) { const d = await res.json().catch(() => ({})); toast(d.error || 'No se pudieron guardar los datos del contacto'); return; }
    if (res.status === 409) {
      const data = await res.json();
      // El nuevo nombre lo deja igual a otro cliente: ¿es el mismo? (se juntan) o es otro (se guarda).
      if (data.error === 'posible_duplicado') {
        const d = await resolverDuplicado(data.parecidos, { mensaje: 'Con el nombre «' + (payload.empresa_contacto || payload.nombre) + '», ' + folioCliente(CLIENTE_ACTUAL.id) + ' quedaría igual a otro cliente. Si es el mismo, se juntan en uno; si es otro, se guarda el cambio.', otro: 'Es otro cliente: guardar el cambio' });
        if (!d) return;
        if (d.distinto) {
          const r2 = await api('/clientes/' + CLIENTE_ACTUAL.id, { method: 'PUT', body: JSON.stringify({ ...payload, distinto_de: d.distinto }) });
          const j2 = await r2.json();
          if (!r2.ok) { toast(j2.error === 'posible_duplicado' ? 'Sigue pareciéndose a otro cliente' : (j2.error || 'No se pudo guardar')); return; }
          toast('Datos del cliente actualizados'); FlujoCRM.marcarGuardado('overlay-ficha-cliente'); await abrirFichaCliente(CLIENTE_ACTUAL.id); await cargarClientes();
          return;
        }
        if (!Permisos.direccion()) { toast('Es el mismo cliente: pide a un administrador que los junte (Contactos → Revisar duplicados). No se guardó el cambio de nombre.'); return; }
        if (!await solicitarDialogo({ titulo: 'Juntar clientes', mensaje: 'Todo lo de ' + folioCliente(CLIENTE_ACTUAL.id) + ' pasa a ' + folioCliente(d.mismo) + ' y ' + folioCliente(CLIENTE_ACTUAL.id) + ' deja de existir (su ID queda apuntando a ' + folioCliente(d.mismo) + ').', aceptar: 'Juntar en ' + folioCliente(d.mismo) })) return;
        const rj = await api('/clientes/' + CLIENTE_ACTUAL.id + '/fusionar', { method: 'POST', body: JSON.stringify({ con: d.mismo }) });
        const dj = await rj.json();
        if (!rj.ok) { toast(dj.error || 'No se pudieron juntar'); return; }
        toast('Clientes juntados en ' + folioCliente(d.mismo)); FlujoCRM.marcarGuardado('overlay-ficha-cliente');
        await abrirFichaCliente(d.mismo); await cargarClientes();
        return;
      }
      // Mismo RFC = misma razón social: un administrador puede juntar los dos clientes en uno.
      if (data.rfc_de && Permisos.direccion()) {
        const ok = await solicitarDialogo({ titulo: 'Este RFC ya es de otro cliente', mensaje: data.error.split('. Si')[0] + '. Si es la misma razón social, junta ' + folioCliente(CLIENTE_ACTUAL.id) + ' dentro de ' + data.rfc_de.folio + ': sus cotizaciones, órdenes, cobros y teléfonos pasan a ' + data.rfc_de.folio + ' y ' + folioCliente(CLIENTE_ACTUAL.id) + ' deja de existir (su ID queda apuntando a ' + data.rfc_de.folio + ').', aceptar: 'Juntar en ' + data.rfc_de.folio });
        if (!ok) return;
        const rj = await api('/clientes/' + CLIENTE_ACTUAL.id + '/fusionar', { method: 'POST', body: JSON.stringify({ con: data.rfc_de.id }) });
        const dj = await rj.json();
        if (!rj.ok) { toast(dj.error || 'No se pudieron juntar'); return; }
        toast('Clientes juntados en ' + data.rfc_de.folio);
        FlujoCRM.marcarGuardado('overlay-ficha-cliente');
        await abrirFichaCliente(data.rfc_de.id); await cargarClientes();
        return;
      }
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
  // Con «lo suyo» en ventas, pasar la cotización a otro vendedor lo hace el gerente.
  const soloSuyo = (Permisos.datos.alcances?.ventas ?? 2) < 2;
  document.getElementById('ed-responsable').disabled = soloSuyo;
  document.getElementById('ed-responsable').title = soloSuyo ? 'Para pasarla a otro vendedor, pídeselo al gerente' : '';
  EquipoOrden.mostrar(lead);
  document.getElementById('ed-valor').value = lead.valor != null ? lead.valor : '';
  document.getElementById('ed-fecha-servicio').value = lead.fecha_servicio || '';
  // Orden que viene de una cotización: su fecha de servicio no puede ser antes de la cotización.
  document.getElementById('ed-fecha-servicio').min = lead.origen === 'cotizacion' && lead.fecha_cotizacion ? lead.fecha_cotizacion : '';
  document.getElementById('ed-fecha-cotizacion').value = lead.fecha_cotizacion || '';
  document.getElementById('ed-incluye-vigencia').checked = lead.incluye_vigencia !== 0;
  document.getElementById('ed-vigencia-hasta').value = lead.vigencia_hasta || '';
  const notasIniciales = document.getElementById('ed-notas-iniciales');
  notasIniciales.hidden = !lead.notas_iniciales;
  notasIniciales.textContent = lead.notas_iniciales ? 'Nota al crear este registro: ' + lead.notas_iniciales : '';
  document.getElementById('ed-urgente').checked = !!lead.urgente;
  document.getElementById('ed-equipo').value = lead.equipo || '';
  document.getElementById('ed-operador').value = lead.operador || '';
  document.getElementById('ed-proyecto').value = lead.proyecto || '';
  document.getElementById('ed-manifiestos').value = lead.manifiestos || '';
  document.getElementById('ed-tiros').value = lead.tiros || '';
  document.getElementById('ed-observaciones').value = lead.observaciones || '';
  document.getElementById('ed-encuesta-calificacion').value = lead.encuesta_calificacion ? String(lead.encuesta_calificacion) : '';
  document.getElementById('ed-encuesta-comentario').value = lead.encuesta_comentario || '';
  document.getElementById('ed-creado-por').textContent = lead.creado_por || '—';
  document.getElementById('ed-created-at').textContent = fechaCorta(lead.created_at) || '—';
  document.getElementById('ed-estatus-actual').textContent = lead.estatus || '—';


  // Mostrar/ocultar botones según estatus actual
  actualizarBotonesEstatusFicha(lead);

  actualizarPipeline();

  renderServiciosAnteriores(lead.otras_solicitudes || []);
  abrirVentana('overlay-ficha');
  FlujoCRM.presentarRegistro(lead, clienteServicios);
  Finanzas.pintarEjecucion(lead);
  Finanzas.pintarCobranzaOrden(lead);
  Finanzas.pintarCostosOrden(lead);
  prepararEditorCotizacion(lead,'existente');
  FlujoCRM.marcarGuardado('overlay-ficha');
}

function renderServiciosAnteriores() {
  ServiciosTabla.render('ficha-anteriores', LEAD_ACTUAL.servicios_cliente || [LEAD_ACTUAL], LEAD_ACTUAL.cliente_id || 'lead-'+LEAD_ACTUAL.id, 'lead');
}

async function cambiarEstatusLeadActual(estatus, motivoPerdida) {
  if (!LEAD_ACTUAL) return;
  try {
    // Se envían junto los campos de la ficha (cotización, fecha, etc.): así, si el usuario
    // acaba de escribir la cotización final y da clic en "Convertir a Cliente" sin guardar
    // primero, ese dato no se pierde.
    const body = { ...recolectarPayloadFicha(), estatus, usuario: USUARIO_ACTUAL ? USUARIO_ACTUAL.nombre : null, ...(motivoPerdida ? { motivo_perdida: motivoPerdida } : {}) };
    if (!await guardarLeadExistente(body)) return;
    toast('Cotización ' + (estatus === 'ganado' ? 'cerrada como servicio' : estatus === 'perdido' ? 'descartada' : 'reabierta'));
    FlujoCRM.marcarGuardado('overlay-ficha');
    await abrirFicha(LEAD_ACTUAL.id);
    await ServiciosTabla.refrescar();
  } catch (err) {
    toast('No se pudo cambiar el estatus: ' + err.message);
  }
}
on('btn-marcar-perdido', 'click', async () => {
  const motivo = await solicitarDialogo({ titulo: 'Cotización no aceptada', mensaje: '¿Por qué no se aceptó? Sirve para saber por qué se pierden ventas. Ejemplos: precio alto, eligió a otro proveedor, ya no lo necesita, no contestó.', aceptar: 'Marcar como no aceptada', campo: { tipo: 'text', etiqueta: 'Motivo', requerido: 'Escribe el motivo' } });
  if (motivo) cambiarEstatusLeadActual('perdido', motivo);
});
on('btn-reabrir', 'click', () => cambiarEstatusLeadActual('abierto'));

on('btn-cerrar-modal', 'click', () => {
  document.getElementById('overlay-ficha').classList.remove('mostrar');
  cargarLeads();
});

// Única fuente de verdad para mostrar/ocultar estos tres botones según el estatus del
// lead. Antes esta misma regla vivía repetida en abrirFicha() y en refrescar(), y se
// desincronizaron en cuanto una de las dos copias cambió sin tocar la otra. lead=null
// significa "no hay ningún registro existente todavía" (formulario de servicio nuevo).
function actualizarBotonesEstatusFicha(lead) {
  const esAbierto = !!lead && lead.estatus === 'abierto';
  document.getElementById('btn-marcar-perdido').style.display = esAbierto ? 'inline-flex' : 'none';
  // Una orden directa/duplicada nunca fue cotización: no se puede "reabrir" ni descartar como tal.
  const puedeReabrir = lead && !esAbierto && lead.origen !== 'directo' && (lead.estatus !== 'ganado' || Permisos.puede('ordenes.importe_ganada'));
  document.getElementById('btn-reabrir').style.display = puedeReabrir ? 'inline-flex' : 'none';
  // Solo las órdenes de servicio se duplican (servicio recurrente); las cotizaciones no.
  document.getElementById('btn-recomprar').style.display = (lead && lead.estatus === 'ganado' && lead.cliente_id) ? 'inline-flex' : 'none';
  // Solo una cotización abierta se convierte en orden; en la orden ya está "Guardar y descargar".
  document.getElementById('btn-generar-orden-servicio').hidden = !lead || lead.estatus !== 'abierto';
}

// Registra un evento de sistema en la bitácora sin interrumpir al usuario si falla
// (nunca debe bloquear una descarga o un guardado por un problema de red al loguear).
async function registrarEventoSistema(leadId, texto) {
  try {
    const r = await api('/leads/' + leadId + '/historial', { method: 'POST', body: JSON.stringify({ tipo: 'observacion', texto, origen: 'sistema' }) });
    if (!r.ok) return; // se anota «si se puede»: nunca interrumpe lo que se estaba haciendo
    if (LEAD_ACTUAL?.id === leadId) {
      const lead = await api('/leads/' + leadId).then(r => r.json());
      if (LEAD_ACTUAL?.id === leadId) { LEAD_ACTUAL = lead; renderBitacora(lead); }
    }
  } catch (err) { /* no interrumpir el flujo principal por esto */ }
}

function renderFichaMeta(lead) {
  document.getElementById('ficha-meta').innerHTML = '<span class="chip">Registro: <b>#'+lead.id+'</b></span><span class="chip">Estado: <b>'+FlujoCRM.estado(lead.estatus)+'</b></span><span class="chip">Creado: <b>'+fechaCorta(lead.created_at)+'</b></span>';
  renderBitacora(lead);
}

// Bitácora de actividad: combina, en un solo timeline cronológico, los eventos que el
// propio sistema registra automáticamente (origen 'sistema': creación, cambios de
// estatus) con las observaciones y alertas que escribe el equipo (origen 'manual').
// Mismo patrón que el "activity timeline" de CRMs como HubSpot o Pipedrive.
function iconoBitacora(item) {
  if (item.origen === 'sistema') return { clase: 'sistema', icono: '⚙️' };
  if (item.tipo === 'alerta') return item.resuelta ? { clase: 'alerta-resuelta', icono: '✅' } : { clase: 'alerta-pendiente', icono: '⏰' };
  return { clase: 'nota', icono: '📝' };
}
function renderBitacora(lead) {
  const cont = document.getElementById('bitacora-lista');
  const items = lead.historial || [];
  if (!items.length) { cont.innerHTML = '<p class="bitacora-vacio">Sin actividad registrada todavía.</p>'; return; }
  cont.innerHTML = items.map(item => {
    const { clase, icono } = iconoBitacora(item);
    const meta = item.tipo === 'alerta'
      ? `Para: ${fechaCorta(item.fecha_alerta)}${item.resuelta ? ' · Resuelta' : ' · Pendiente'}`
      : fechaCorta(item.created_at);
    const accion = (item.tipo === 'alerta' && !item.resuelta)
      ? `<button class="btn btn-outline" data-resolver-obs="${Number(item.id)}">Resuelta</button>`
      : (item.tipo === 'alerta' && Permisos.direccion()) ? `<button class="btn btn-outline" data-reabrir-obs="${Number(item.id)}">Reabrir</button>` : '';
    return `<div class="bitacora-item ${clase}">
      <div class="bitacora-icono">${icono}</div>
      <div class="bitacora-texto">${escaparHtml(item.texto)}<div class="bitacora-meta">${meta}${item.usuario ? ' · ' + escaparHtml(item.usuario) : ''}</div></div>
      ${accion}
    </div>`;
  }).join('');
}
document.getElementById('bitacora-lista').addEventListener('click', async e => {
  const reabrir = e.target.closest('[data-reabrir-obs]');
  if (reabrir && LEAD_ACTUAL) {
    reabrir.disabled = true;
    try {
      await exigirOk(await api('/historial/' + Number(reabrir.dataset.reabrirObs) + '/reabrir', { method: 'PUT' }), 'No se pudo reabrir');
      LEAD_ACTUAL = await api('/leads/' + LEAD_ACTUAL.id).then(r => r.json()); renderBitacora(LEAD_ACTUAL); toast('Aviso reabierto');
    } catch (err) { toast(err.message); reabrir.disabled = false; }
    return;
  }
  const btn = e.target.closest('[data-resolver-obs]');
  if (!btn || !LEAD_ACTUAL) return;
  btn.disabled = true;
  try {
    await exigirOk(await api('/historial/' + btn.dataset.resolverObs + '/resolver', { method: 'PUT' }), 'No se pudo resolver');
    const lead = await api('/leads/' + LEAD_ACTUAL.id).then(r => r.json());
    LEAD_ACTUAL = lead;
    renderBitacora(lead);
    toast('Marcada como resuelta');
  } catch (err) {
    toast('No se pudo resolver: ' + err.message);
    btn.disabled = false;
  }
});

// La etapa se mueve solo desde el Pipeline (tablero); la ficha ya no tiene barra de etapas.
function actualizarPipeline() {}

// Guarda los cambios de la cotización/servicio en la ficha. Es la ÚNICA puerta de guardado
// para los botones que modifican el registro: si el servidor lo rechaza (por ejemplo,
// porque otra persona lo actualizó mientras estaba abierto) muestra el aviso y devuelve
// null, para que ningún botón siga adelante como si todo hubiera salido bien.
async function guardarLeadExistente(payload) {
  const res = await api('/leads/' + LEAD_ACTUAL.id, { method: 'PUT', body: JSON.stringify(payload) });
  const datos = await res.json();
  if (!res.ok) { toast(datos.error || 'No se pudo guardar el registro'); return null; }
  LEAD_ACTUAL = { ...LEAD_ACTUAL, ...datos };
  return datos;
}

function recolectarPayloadFicha() {
  sincronizarEditor();
  const valorRaw = document.getElementById('ed-valor').value;
  return {
    partidas_json: JSON.stringify(recolectarItemsCotizacion()),
    version: LEAD_ACTUAL?.version,
    direccion: document.getElementById('ed-direccion').value.trim(),
    canal_id: document.getElementById('ed-canal').value || null,
    servicio_id: document.getElementById('ed-servicio').value || null,
    responsable_id: document.getElementById('ed-responsable').value || null,
    ...EquipoOrden.payload(),
    valor: valorRaw === '' ? null : Number(valorRaw),
    fecha_servicio: document.getElementById('ed-fecha-servicio').value || null,
    fecha_cotizacion: document.getElementById('ed-fecha-cotizacion').value || null,
    incluye_vigencia: document.getElementById('ed-incluye-vigencia').checked,
    vigencia_hasta: document.getElementById('ed-incluye-vigencia').checked ? (document.getElementById('ed-vigencia-hasta').value || null) : null,
    equipo: document.getElementById('ed-equipo').value.trim(),
    operador: document.getElementById('ed-operador').value.trim(),
    proyecto: document.getElementById('ed-proyecto').value.trim(),
    manifiestos: document.getElementById('ed-manifiestos').value.trim(),
    tiros: document.getElementById('ed-tiros').value.trim(),
    observaciones: document.getElementById('ed-observaciones').value.trim(),
    // La encuesta solo existe en órdenes de servicio (se contesta después del servicio).
    ...(LEAD_ACTUAL?.estatus === 'ganado' ? { encuesta_calificacion: Number(document.getElementById('ed-encuesta-calificacion').value) || null, encuesta_comentario: document.getElementById('ed-encuesta-comentario').value.trim() || null } : {}),
    ...(LEAD_ACTUAL?.estatus === 'abierto' ? { notas_cotizacion: document.getElementById('gc-notas').value.trim() } : {}),
    ...ivaPayload()
  };
}
on('btn-guardar-ficha', 'click', async () => {
  if(!validarEditorCotizacion())return;
  try {
    if (!await guardarLeadExistente(recolectarPayloadFicha())) return;
    toast('Cambios guardados en este registro');
    FlujoCRM.marcarGuardado('overlay-ficha');
    const lead = await api('/leads/' + LEAD_ACTUAL.id).then(r => r.json());
    LEAD_ACTUAL = lead;
    renderFichaMeta(lead);
    Finanzas.pintarCobranzaOrden(lead);
    await ServiciosTabla.refrescar();
  } catch (err) {
    toast('No se pudo guardar: ' + err.message);
  }
});

on('btn-recomprar', 'click', () => duplicarRegistro(LEAD_ACTUAL.id));


on('btn-eliminar-lead', 'click', async () => {
  if (!LEAD_ACTUAL) return;
  try { await ServiciosTabla.eliminar(LEAD_ACTUAL); }
  catch (err) { toast('No se pudo eliminar: ' + err.message); }
});

on('ed-incluye-vigencia', 'change', e => {
  document.getElementById('wrap-vigencia-hasta').hidden = !e.target.checked;
  const campoFecha = document.getElementById('ed-vigencia-hasta');
  if (e.target.checked && !campoFecha.value) {
    campoFecha.value = sumarDiasISO(hoyISO(), 15);
  }
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
  document.getElementById('obs-fecha-rapida').classList.remove('show');
  const lead = await api('/leads/' + LEAD_ACTUAL.id).then(r => r.json());
  LEAD_ACTUAL = lead;
  renderBitacora(lead);

  toast(esAlerta ? 'Recordatorio agregado' : 'Observación agregada');
});

// ---------- Pendientes (en Inicio): recompras y avisos ----------
function filaRecompra(r, vencido) {
  const texto = vencido
    ? `Vencido hace ${Math.abs(r.dias_restantes)} día${Math.abs(r.dias_restantes) === 1 ? '' : 's'}`
    : `Vence en ${r.dias_restantes} día${r.dias_restantes === 1 ? '' : 's'}`;
  return `
    <div class="fila-alerta tipo-recompra ${vencido ? 'vencido' : ''}">
      <div class="info">
        <span class="tipo-tag recompra">🔁 Recompra</span>
        <div><b>${escaparHtml(r.nombre || 'Sin nombre')} · ${escaparHtml(r.telefono)}</b></div>
        <div class="txt">${escaparHtml(r.servicio_nombre)} — última vez: ${escaparHtml(r.ultima_fecha)}</div>
        <div class="fecha" style="color:${vencido ? 'var(--rojo)' : 'var(--azul-600)'};">${texto} (sugerido: ${escaparHtml(r.fecha_sugerida)})</div>
      </div>
      <div class="util-46">
        <button class="btn btn-outline" onclick="abrirFichaCliente(${r.cliente_id})">Ver cliente</button>
        <button class="btn btn-primario" onclick="duplicarRegistro(${r.ultimo_lead_id})">➕ Registrar servicio nuevo</button>
      </div>
    </div>`;
}
function filaAlerta(r) {
  return `
    <div class="fila-alerta tipo-alerta">
      <div class="info">
        <span class="tipo-tag alerta">⏰ Alerta</span>
        <div><b>${escaparHtml(r.lead_nombre || 'Sin nombre')} · ${escaparHtml(r.telefono)}</b></div>
        <div class="txt">${escaparHtml(r.texto)}</div>
        <div class="fecha">Para: ${fechaCorta(r.fecha_alerta)} · Responsable: ${escaparHtml(r.responsable_nombre || '—')}</div>
      </div>
      <div class="util-46">
        <button class="btn btn-outline" onclick="abrirFicha(${r.lead_id})">Ver ficha</button>
        <button class="btn btn-verde" onclick="resolverAlertaGlobal(${r.id})">Resuelta</button>
      </div>
    </div>`;
}
async function duplicarRegistro(leadId) {
  try {
    const lead = await api('/leads/' + leadId).then(r => r.json());
    if (!lead.cliente_id) { toast('Este registro no tiene un cliente asociado; no se puede duplicar.'); return; }
    if (lead.estatus !== 'ganado') { toast('Solo puedes duplicar órdenes de servicio ya contratadas.'); return; }
    const ok = await solicitarDialogo({
      titulo: 'Duplicar orden de servicio',
      mensaje: `Se abrirá una nueva orden de servicio para ${lead.nombre || lead.telefono}, copiando ${folioOrdenServicio(lead)} (servicio, importe, dirección y notas) — pensado para clientes con servicio recurrente. No se crea ninguna cotización; solo falta indicar la nueva fecha acordada antes de guardarla.`,
      aceptar: 'Duplicar'
    });
    if (!ok) return;
    await FlujoCRM.nuevoRegistro(lead.cliente_id, 'directo', {
      direccion: lead.direccion,
      partidas_json: lead.partidas_json,
      servicio_nombre: lead.servicio_nombre,
      valor: lead.valor,
      iva_modo: lead.iva_modo,
      iva_tasa: lead.iva_tasa,
      equipo: lead.equipo,
      operador: (lead.equipo_personal || []).map(x => x.nombre).join(', ') || lead.operador,
      proyecto: lead.proyecto,
      duplicado_de: lead.id,
      folio: folioOrdenServicio(lead)
    });
    toast('Indica la nueva fecha de la orden y guarda');
  } catch (err) {
    toast('No se pudo duplicar: ' + err.message);
  }
}
async function resolverAlertaGlobal(id) {
  try { await exigirOk(await api('/historial/' + id + '/resolver', { method: 'PUT' }), 'No se pudo marcar como resuelto'); }
  catch (err) { toast('No se pudo marcar como resuelto: ' + err.message); return; }
  cargarInicio();
  actualizarBadgePendientes();
}

// "Urgente" está en Avisos y notas del registro: se guarda al marcarlo (no espera a "Guardar cambios").
on('ed-urgente', 'change', async e => {
  if (!LEAD_ACTUAL) return;
  const urgente = e.target.checked;
  try {
    if (!await guardarLeadExistente({ version: LEAD_ACTUAL.version, urgente })) { e.target.checked = !urgente; return; }
    await registrarEventoSistema(LEAD_ACTUAL.id, urgente ? 'Marcado como urgente.' : 'Ya no está marcado como urgente.');
    toast(urgente ? 'Marcado como urgente' : 'Ya no es urgente');
    if (document.getElementById('vista-leads').classList.contains('activa')) cargarLeads();
  } catch (err) { e.target.checked = !urgente; toast('No se pudo guardar: ' + err.message); }
});
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
  // En celular el menú está cerrado: el contador también se muestra en el botón "☰ Menú".
  const bm = document.getElementById('badge-menu');
  if (bm) { bm.textContent = n; bm.hidden = !(n > 0); }
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
    document.getElementById('login-password').value = '';
    if (usuario.cambiar_password) { Cuentas.pedirCambioObligatorio(); return; }
    document.getElementById('overlay-login').classList.remove('mostrar');
    iniciarApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
});
on('btn-logout', 'click', cerrarSesion);
// Revisión de integridad (solo administración): muestra cada revisión con lo que encontró.
on('btn-integridad', 'click', async e => {
  const btn = e.currentTarget, cont = document.getElementById('integridad-resultado');
  btn.disabled = true; cont.innerHTML = '<p class="util-45" role="status">Revisando…</p>';
  try {
    const r = await api('/admin/integridad').then(x => x.json());
    if (r.error) throw new Error(r.error);
    const conCasos = r.resultados.filter(x => x.total), limpias = r.resultados.filter(x => !x.total);
    const caja = x => `<details class="integ-item ${x.gravedad}"${x.gravedad === 'error' ? ' open' : ''}><summary><b>${x.gravedad === 'error' ? '✘' : '⚠'} ${escaparHtml(x.titulo)}</b> <span class="integ-n">${Number(x.total)}</span> <small>${escaparHtml(x.grupo)}</small></summary>`
      + '<ul>' + x.casos.map(c => `<li><b>${escaparHtml(c.ref)}</b> · ${escaparHtml(c.detalle)}</li>`).join('') + (x.total > x.casos.length ? `<li>… y ${Number(x.total - x.casos.length)} más</li>` : '') + '</ul></details>';
    cont.innerHTML = `<p class="integ-resumen ${r.errores ? 'mal' : r.avisos ? 'aviso' : 'ok'}">${r.errores ? '✘ ' + Number(r.errores) + ' error(es)' : '✔ Sin errores'}${r.avisos ? ' · ⚠ ' + Number(r.avisos) + ' aviso(s) para revisar' : ''} · ${Number(r.revisiones)} revisiones · ${escaparHtml(r.fecha)}</p>`
      + conCasos.sort((a, b) => (a.gravedad === 'error' ? 0 : 1) - (b.gravedad === 'error' ? 0 : 1)).map(caja).join('')
      + `<details class="integ-limpias"><summary>✔ ${limpias.length} revisiones sin problemas</summary><ul>${limpias.map(x => '<li>' + escaparHtml(x.grupo + ' · ' + x.titulo) + '</li>').join('')}</ul></details>`;
  } catch (err) { cont.innerHTML = '<p class="aviso-error-carga">No se pudo revisar: ' + escaparHtml(err.message) + '</p>'; }
  finally { btn.disabled = false; }
});
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
  // Lo que cada rol no puede hacer se oculta con las clases perm-<permiso> (permisos.js); el servidor lo valida.
  document.body.classList.toggle('puede-cobranza', !!USUARIO_ACTUAL);
}

// ---------- Gestión de usuarios (solo admin) ----------
// Roles: vienen de la base (Dirección puede crear más en «Roles y permisos»). «cabe» = este usuario puede darlo.
let ROLES_DATOS = [];
const NOMBRES_DE_FABRICA = { admin: 'Dirección', gerente: 'Gerente', ventas: 'Ventas', atencion: 'Atención a clientes', tecnico: 'Técnico', costos: 'Costos y compras' };
const nombreRol = clave => ROLES_DATOS.find(r => r.clave === clave)?.nombre || NOMBRES_DE_FABRICA[clave] || clave;
const opcionesRol = actual => ROLES_DATOS.filter(r => (r.cabe && (Sucursales.datos.admin_general || !['admin', 'gerente'].includes(r.clave))) || r.clave === actual)
  .map(r => `<option value="${escaparHtml(r.clave)}" ${r.clave === actual ? 'selected' : ''}>${escaparHtml(r.nombre + (r.descripcion ? ' · ' + r.descripcion : ''))}</option>`).join('');
async function cargarUsuarios() {
  const [usuarios, roles] = await Promise.all([api('/usuarios').then(r => r.json()), api('/roles').then(r => r.json())]);
  pintarDesactivados();
  ROLES_DATOS = roles;
  const nuRol = document.getElementById('nu-rol'); if (nuRol) { const v = nuRol.value; nuRol.innerHTML = opcionesRol(''); if ([...nuRol.options].some(o => o.value === v)) nuRol.value = v; else if ([...nuRol.options].some(o => o.value === 'ventas')) nuRol.value = 'ventas'; }
  if (Permisos.datos.direccion) Roles.cargar();
  const nuS = document.getElementById('nu-sucursales'); if (nuS) nuS.innerHTML = Sucursales.casillas('nu', Sucursales.datos.sucursales.length === 1 ? [Sucursales.datos.sucursales[0].id] : []);
  const admins = usuarios.filter(x => x.rol === 'admin').length;
  document.getElementById('lista-usuarios').innerHTML = usuarios.map(u => {
    const id = Number(u.id), propio = id === USUARIO_ACTUAL.id;
    return `<div class="servicio-row fila-usuario" data-usuario="${id}">
      <div><label for="usr-nombre-${id}">Nombre${propio ? ' (tú)' : ''}</label><input id="usr-nombre-${id}" value="${escaparHtml(u.nombre)}" maxlength="60"></div>
      <div><label for="usr-correo-${id}">Correo${u.correo && !u.correo_verificado ? ' · sin confirmar' : ''}</label><input id="usr-correo-${id}" type="email" value="${escaparHtml(u.correo || '')}" placeholder="nombre@saneadren.com.mx" maxlength="254"></div>
      <div><label for="usr-rol-${id}">Rol</label><select id="usr-rol-${id}" ${u.rol === 'admin' && admins === 1 ? 'disabled title="Debe quedar al menos un administrador"' : ''}>${opcionesRol(u.rol)}</select></div>
      ${Sucursales.varias() ? `<div><label>Sucursales</label>${u.rol === 'admin' ? '<p class="ayuda">Todas</p>' : Sucursales.casillas('usr-' + id, u.sucursales || [])}</div>` : ''}
      <div class="acciones-catalogo">
        <button type="button" class="btn btn-secundario" data-accion="guardar">Guardar</button>
        <button type="button" class="btn btn-outline" data-accion="password">Nueva contraseña</button>
        <button type="button" class="btn btn-peligro" data-accion="desactivar" ${propio || (u.rol === 'admin' && admins === 1) ? 'disabled title="No disponible para esta cuenta"' : ''}>Desactivar</button>
      </div>
    </div>`;
  }).join('');
}
// Desactivados: se pueden reactivar (vuelven con su rol y sus sucursales; deben cambiar su contraseña al entrar).
async function pintarDesactivados() {
  const cont = document.getElementById('lista-usuarios-desactivados'); if (!cont) return;
  const r = await api('/usuarios/desactivados'); const lista = r.ok ? await r.json() : [];
  cont.innerHTML = lista.length ? lista.map(u => `<div class="servicio-row fila-usuario"><div><b>${escaparHtml(u.nombre)}</b> · ${escaparHtml(nombreRol(u.rol))}${u.correo ? ' · ' + escaparHtml(u.correo) : ''}</div>`
    + `<div class="acciones-catalogo"><button type="button" class="btn btn-outline" data-reactivar="${Number(u.id)}" data-nombre="${escaparHtml(u.nombre)}">Reactivar</button></div></div>`).join('')
    : '<p class="ayuda">Ninguno.</p>';
}
async function reactivarUsuario(id, nombre) {
  if (!await solicitarDialogo({ titulo: 'Reactivar usuario', aceptar: 'Reactivar', mensaje: `¿Reactivar a «${nombre}»?\n\nVuelve con su rol y sus sucursales. Al entrar tendrá que cambiar su contraseña (si no la recuerda, asígnale una nueva).` })) return false;
  await exigirOk(await api('/usuarios/' + Number(id) + '/reactivar', { method: 'POST', body: '{}' }), 'No se pudo reactivar');
  toast('Usuario reactivado: al entrar deberá cambiar su contraseña');
  await cargarUsuarios(); cargarCatalogos();
  return true;
}
on('lista-usuarios-desactivados', 'click', async e => {
  const b = e.target.closest('[data-reactivar]'); if (!b) return;
  b.disabled = true;
  try { await reactivarUsuario(b.dataset.reactivar, b.dataset.nombre); } catch (err) { toast(err.message); } finally { b.disabled = false; }
});
on('lista-usuarios', 'click', async e => {
  const btn = e.target.closest('[data-accion]'); if (!btn) return;
  const fila = btn.closest('[data-usuario]'), id = Number(fila.dataset.usuario);
  const nombre = document.getElementById('usr-nombre-' + id).value.trim();
  btn.disabled = true;
  try {
    if (btn.dataset.accion === 'guardar') {
      const rolNuevo = document.getElementById('usr-rol-' + id).value, cuerpo = { nombre, correo: document.getElementById('usr-correo-' + id).value.trim() || null, rol: rolNuevo };
      if (Sucursales.varias() && rolNuevo !== 'admin' && fila.querySelector('[data-sucursales]')) cuerpo.sucursales = Sucursales.elegidas('usr-' + id);
      const r = await api('/usuarios/' + id, { method: 'PUT', body: JSON.stringify(cuerpo) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'No se pudo guardar'); }
      toast('Usuario actualizado');
      if (id === USUARIO_ACTUAL.id) { guardarSesion({ ...USUARIO_ACTUAL, nombre }); mostrarUsuarioEnHeader(); }
    } else if (btn.dataset.accion === 'password') {
      const password = await solicitarDialogo({ titulo: 'Nueva contraseña para ' + nombre, mensaje: 'Mínimo 10 caracteres, con letras y números. Compártela por un medio privado: deberá cambiarla al iniciar sesión.', aceptar: 'Asignar', campo: { tipo: 'password' } });
      if (!password) return;
      await exigirOk(await api('/usuarios/' + id + '/password', { method: 'POST', body: JSON.stringify({ password }) }), 'No se pudo asignar la contraseña');
      toast('Contraseña asignada; se cerraron sus sesiones abiertas');
    } else if (btn.dataset.accion === 'desactivar') {
      if (!await solicitarDialogo({ titulo: 'Desactivar usuario', aceptar: 'Desactivar', mensaje: `¿Desactivar a "${nombre}"?\n\nSus registros históricos se conservan, pero ya no podrá iniciar sesión.` })) return;
      await exigirOk(await api('/usuarios/' + id, { method: 'DELETE' }), 'No se pudo desactivar');
      toast('Usuario desactivado');
    }
    await cargarUsuarios();
    cargarCatalogos();
  } catch (err) { toast('No se pudo completar: ' + err.message); }
  finally { btn.disabled = false; }
});
// Mueve un elemento de una lista y guarda el nuevo orden en el servidor.
async function moverEnCatalogo(ruta, ids, id, delta) {
  const i = ids.indexOf(id), j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return false;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await exigirOk(await api(ruta, { method: 'PUT', body: JSON.stringify({ ids }) }), 'No se pudo cambiar el orden');
  return true;
}
let IDS_SERVICIOS = [];
async function cargarCatalogoServicios() {
  const cont = document.getElementById('lista-servicios-catalogo');
  if (!cont) return;
  const servicios = await api('/servicios').then(r => r.json());
  IDS_SERVICIOS = servicios.map(s => s.id);
  const admin = Permisos.direccion(); // alta, baja y recompra de servicios: solo Dirección
  cont.innerHTML = servicios.map((s, i) => `
    <div class="servicio-row fila-catalogo" data-servicio="${Number(s.id)}">
      <div class="orden-btns"><button type="button" class="btn btn-outline" data-mover="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir ${escaparHtml(s.nombre)}">↑</button><button type="button" class="btn btn-outline" data-mover="1" ${i === servicios.length - 1 ? 'disabled' : ''} aria-label="Bajar ${escaparHtml(s.nombre)}">↓</button></div>
      <div class="info"><div class="tit">${escaparHtml(s.nombre)}</div><label for="desc-${s.id}">Descripción predeterminada para cotizaciones</label><textarea id="desc-${s.id}" rows="3" maxlength="10000" placeholder="Descripción que se precargará al elegir este servicio">${escaparHtml(s.descripcion || '')}</textarea></div>
      <div class="acciones-catalogo">
        <span class="solo-general"><input class="util-48" type="number" min="1" step="1" placeholder="Sin recompra" value="${s.dias_recurrencia != null ? s.dias_recurrencia : ''}" id="rec-${s.id}" aria-label="Recompra cada (días)"> <span class="util-49">días</span></span>
        <button type="button" class="btn btn-secundario" data-guardar>Guardar</button>
        ${admin ? '<button type="button" class="btn btn-peligro" data-eliminar>Eliminar</button>' : ''}
      </div>
    </div>`).join('');
}
on('lista-servicios-catalogo', 'click', async e => {
  const fila = e.target.closest('[data-servicio]'); if (!fila) return;
  const id = Number(fila.dataset.servicio);
  const btn = e.target.closest('button'); if (!btn) return;
  btn.disabled = true;
  try {
    if (btn.dataset.mover) {
      if (await moverEnCatalogo('/servicios/orden', [...IDS_SERVICIOS], id, Number(btn.dataset.mover))) { await cargarCatalogoServicios(); cargarCatalogos(); }
      return;
    }
    if (btn.hasAttribute('data-guardar')) {
      const cuerpo = { descripcion: document.getElementById('desc-' + id).value };
      if (Permisos.direccion()) { const v = document.getElementById('rec-' + id).value; cuerpo.dias_recurrencia = v === '' ? null : Number(v); }
      await exigirOk(await api('/servicios/' + id, { method: 'PUT', body: JSON.stringify(cuerpo) }));
      toast('Servicio guardado');
      cargarCatalogos();
    }
    if (btn.hasAttribute('data-eliminar')) {
      const nombre = fila.querySelector('.tit').textContent;
      if (!await solicitarDialogo({ titulo: 'Eliminar servicio', aceptar: 'Eliminar', mensaje: `¿Eliminar "${nombre}" del catálogo?\n\nLas cotizaciones y órdenes que ya lo usan lo conservan; solo dejará de aparecer para registros nuevos.` })) return;
      await exigirOk(await api('/servicios/' + id, { method: 'DELETE' }), 'No se pudo eliminar');
      toast('Servicio eliminado del catálogo');
      await cargarCatalogoServicios(); cargarCatalogos();
    }
  } catch (err) { toast('No se pudo guardar: ' + err.message); }
  finally { btn.disabled = false; }
});

on('btn-crear-servicio', 'click', async () => {
  const nombre = document.getElementById('nserv-nombre').value.trim();
  const dias = document.getElementById('ns-dias').value;
  if (!nombre) { toast('Escribe un nombre para el servicio'); return; }
  try {
    const res = await api('/servicios', {
      method: 'POST',
      body: JSON.stringify({ nombre, descripcion: document.getElementById('ns-descripcion').value, dias_recurrencia: dias === '' ? null : Number(dias) })
    });
    if (res.status === 409) {
      const data = await res.json();
      toast(data.error || 'Ya existe un servicio con ese nombre');
      return;
    }
    toast('Servicio agregado');
    document.getElementById('nserv-nombre').value = '';
    document.getElementById('ns-descripcion').value = '';
    document.getElementById('ns-dias').value = '';
    cargarCatalogoServicios();
    cargarCatalogos();
  } catch (err) {
    toast('No se pudo agregar: ' + err.message);
  }
});

let IDS_CANALES = [];
async function cargarCanalesCatalogo() {
  const cont = document.getElementById('lista-canales-catalogo');
  if (!cont) return;
  const canales = await api('/canales').then(r => r.json());
  IDS_CANALES = canales.map(c => c.id);
  cont.innerHTML = canales.map((c, i) => `
    <div class="servicio-row fila-catalogo" data-canal="${Number(c.id)}">
      <div class="orden-btns"><button type="button" class="btn btn-outline" data-mover="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir ${escaparHtml(c.nombre)}">↑</button><button type="button" class="btn btn-outline" data-mover="1" ${i === canales.length - 1 ? 'disabled' : ''} aria-label="Bajar ${escaparHtml(c.nombre)}">↓</button></div>
      <div class="info"><label for="canal-${Number(c.id)}">Nombre del canal</label><input id="canal-${Number(c.id)}" value="${escaparHtml(c.nombre)}" maxlength="80"></div>
      <div class="acciones-catalogo"><button type="button" class="btn btn-secundario" data-guardar>Guardar nombre</button></div>
    </div>`).join('');
}
on('lista-canales-catalogo', 'click', async e => {
  const fila = e.target.closest('[data-canal]'); const btn = e.target.closest('button');
  if (!fila || !btn) return;
  const id = Number(fila.dataset.canal);
  btn.disabled = true;
  try {
    if (btn.dataset.mover) {
      if (await moverEnCatalogo('/canales/orden', [...IDS_CANALES], id, Number(btn.dataset.mover))) { await cargarCanalesCatalogo(); cargarCatalogos(); }
    } else {
      const r = await api('/canales/' + id, { method: 'PUT', body: JSON.stringify({ nombre: document.getElementById('canal-' + id).value }) });
      await exigirOk(r);
      toast('Canal actualizado; los contactos conservan su canal');
      cargarCatalogos();
    }
  } catch (err) { toast('No se pudo guardar: ' + err.message); }
  finally { btn.disabled = false; }
});

on('btn-crear-canal', 'click', async () => {
  const nombre = document.getElementById('nc-nombre').value.trim();
  if (!nombre) { toast('Escribe un nombre para el canal'); return; }
  try {
    const res = await api('/canales', {
      method: 'POST',
      body: JSON.stringify({ nombre })
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
  const correo = document.getElementById('nu-correo').value.trim();
  if (!nombre) { toast('Escribe un nombre'); return; }
  if (!password || password.length < 10) { toast('La contraseña debe tener al menos 10 caracteres, con letras y números'); return; }
  try {
    const res = await api('/usuarios', {
      method: 'POST',
      body: JSON.stringify({ nombre, password, rol, correo: correo || null, temporal: document.getElementById('nu-temporal').checked, ...(Sucursales.varias() && rol !== 'admin' ? { sucursales: Sucursales.elegidas('nu') } : {}) })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // Era alguien desactivado: en vez de crear otro, se ofrece reactivarlo.
      if (data.codigo === 'USUARIO_DESACTIVADO') { await reactivarUsuario(data.usuario_id, nombre).catch(err => toast(err.message)); return; }
      toast(data.error || 'No se pudo crear el usuario');
      return;
    }
    toast(document.getElementById('nu-temporal').checked ? 'Usuario creado. Al entrar por primera vez tendrá que cambiar la contraseña.' : 'Usuario creado correctamente');
    document.getElementById('nu-nombre').value = '';
    document.getElementById('nu-password').value = '';
    document.getElementById('nu-correo').value = '';
    cargarUsuarios();
    cargarCatalogos();
  } catch (err) {
    toast('No se pudo crear: ' + err.message);
  }
});

// ---------- Inicio ----------
async function iniciarApp() {
  await Permisos.cargar();
  if (!USUARIO_ACTUAL) return; // la sesión expiró mientras cargaba: ya se pidió volver a entrar
  mostrarUsuarioEnHeader();
  await Sucursales.cargar();
  // Si otra persona inicia sesión en el mismo navegador, no debe quedar a la vista lo del usuario anterior.
  for (const id of ['cuentas-tarjetas', 'cobrar-lista', 'pagar-lista', 'prov-lista', 'cuentas-por-confirmar', 'fc-cobranza', 'inicio-dinero']) { const el = document.getElementById(id); if (el) el.innerHTML = ''; }
  cambiarVista('inicio'); // también carga Inicio
  await cargarCatalogos();
  await cargarLeads();
  actualizarBadgePendientes();
  setInterval(() => actualizarBadgePendientes().catch(() => {}), 60000); // sin conexión: se reintenta al siguiente minuto
}
cargarSesion();
if (Cuentas.atenderEnlace()) {
  // Se abrió desde un enlace de correo (confirmar cuenta / restablecer contraseña).
} else if (USUARIO_ACTUAL) {
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
  cont.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Vendido por mes" style="display:block;width:100%;max-height:300px"><line x1="70" y1="190" x2="910" y2="190" stroke="#9aa4ad"/><text x="2" y="24" font-size="12">${formatoMoneda(max)}</text><text x="12" y="192" font-size="12">$0</text><polyline points="${puntos.map(p=>p.x+','+p.y).join(' ')}" fill="none" stroke="#bb8200" stroke-width="3"/>${puntos.map((p,i)=>`<circle cx="${p.x}" cy="${p.y}" r="4" fill="#f6b103"><title>${escaparHtml(p.mes)}: ${formatoMoneda(p.importe)} · ${Number(p.servicios)} servicios</title></circle>${i===0||i===puntos.length-1||i%Math.max(1,Math.ceil(puntos.length/8))===0?`<text x="${p.x}" y="215" text-anchor="middle" font-size="12">${escaparHtml(p.mes)}</text>`:''}`).join('')}</svg><details><summary>Ver cifras mensuales</summary><div class="tabla-scroll"><table class="tabla-resumen"><thead><tr><th>Mes</th><th>Servicios</th><th>Importe contratado</th></tr></thead><tbody>${serie.map(m=>`<tr><td>${escaparHtml(m.mes)}</td><td>${Number(m.servicios)}</td><td>${formatoMoneda(m.importe)}</td></tr>`).join('')}</tbody></table></div></details>`;
}
