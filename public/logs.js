/* Logs del sistema (Configuración → Ajustes, hasta abajo; solo Dirección): resumen de las últimas 24 h, quién está
   conectado ahora y el registro de accesos, bloqueos y errores del servidor. Servidor: server/registro-sistema.js */
const Logs = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t);
  const EVENTO = {
    entro: ['🟢', 'Entró'], salio: ['⚪', 'Salió'], fallo: ['🟠', 'Contraseña equivocada'], desconocido: ['🟠', 'Usuario que no existe'],
    bloqueado: ['🔴', 'Bloqueado por intentos'], rechazado: ['🟠', 'Intentó entrar estando bloqueado'],
    olvido: ['🔑', 'Pidió restablecer su contraseña'], restablecio: ['🔑', 'Restableció su contraseña'], error: ['⛔', 'Error del servidor'],
    pantalla: ['⚠️', 'Error en pantalla'], correo_fallo: ['📧', 'Correo que no salió'], respaldo_ok: ['💾', 'Respaldo automático hecho'],
    respaldo_fallo: ['💾', 'Respaldo automático falló'], whatsapp_fallo: ['💬', 'WhatsApp no se envió'], kiosco_recuperado: ['🕒', 'El reloj checador se recuperó solo'], kiosco_velocidad: ['⏱️', 'Velocidad del reloj checador'], kiosco_hueco: ['📡', 'El reloj checador estuvo sin señal'], kiosco_sin_respuesta: ['🚨', 'El reloj checador no responde'], kiosco_volvio: ['✅', 'El reloj checador ya responde'], kiosco_atencion: ['🔋', 'El reloj checador necesita atención'], inicio: ['🔄', 'Sistema iniciado (actualización o reinicio)'],
    descarga: ['⬇️', 'Descargó un respaldo'], factura_ok: ['🧾', 'Facturación'], factura_error: ['🧾', 'Facturación: error']
  };
  const fechaHora = f => { const [d, h] = String(f || '').split(' '); return (d || '').split('-').reverse().join('/') + (h ? ' ' + h.slice(0, 5) : ''); };
  const hace = iso => {
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return min < 1 ? 'ahora' : min < 60 ? 'hace ' + min + ' min' : 'hace ' + Math.floor(min / 60) + ' h ' + (min % 60) + ' min';
  };
  let consulta = 0, filas = [], listo = false, sistema = null;
  // «¿Qué significa y qué hago?» (2026-11-13): la explicación del renglón, en simple, y dónde está en el código.
  const lista = (titulo, l) => (l && l.length ? '<p class="logs-guia-titulo"><b>' + esc(titulo) + '</b></p><ul>' + l.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '');
  const guia = g => '<details class="logs-guia"><summary>¿Qué significa y qué hago?</summary><p>' + esc(g.que) + '</p>'
    + lista('Lo que dicen los datos de este renglón', g.lectura) + lista('Causas probables', g.causas) + lista('Qué hacer', g.hacer) + lista('Dónde está en el código', g.codigo) + '</details>';
  // «Copiar reporte»: un reporte que se entiende sin conocer el sistema (qué es, qué pasó, qué significa, dónde está
  // en el código y qué más pasó cerca). Para pegarlo en cualquier asistente o mandarlo a soporte.
  function reporte(r) {
    const [, texto] = EVENTO[r.evento] || ['', r.evento], g = r.guia, s = sistema || {};
    const cerca = filas.filter(x => x.id !== r.id && Math.abs(new Date(x.fecha.replace(' ', 'T')) - new Date(r.fecha.replace(' ', 'T'))) <= 60 * 60000
      && (x.nivel !== 'info' || String(x.evento).split('_')[0] === String(r.evento).split('_')[0])).slice(0, 12);
    const bloque = (titulo, l) => (l && l.length ? ['', titulo + ':', ...l.map(x => '- ' + x)] : []);
    return ['REPORTE DE UN LOG DEL SISTEMA DE SANEADREN', '(reporte de soporte: se entiende sin conocer el sistema)', '',
      'EL SISTEMA', s.descripcion || '', 'Versión ' + (s.version || '?') + (s.commit ? ' · commit ' + s.commit : '') + (s.node ? ' · Node ' + s.node : '') + (s.iniciado ? ' · arrancó por última vez el ' + s.iniciado : ''), '',
      'QUÉ PASÓ', 'Evento: ' + texto + ' (clave: ' + r.evento + ' · tipo: ' + r.tipo + ' · nivel: ' + r.nivel + ')', 'Cuándo: ' + r.fecha + ' (hora del centro de México)',
      'Detalle tal como quedó registrado: ' + (r.detalle || '(sin detalle)'), ...(r.usuario ? ['Usuario: ' + r.usuario] : []), ...(r.equipo ? ['Equipo: ' + r.equipo] : []), ...(r.ip ? ['Red (IP): ' + r.ip] : []),
      ...(g ? ['', 'QUÉ SIGNIFICA', g.que, ...bloque('Lo que dicen los datos de este renglón', g.lectura), ...bloque('Causas probables', g.causas), ...bloque('Qué se recomienda hacer', g.hacer), ...bloque('Dónde está en el código', g.codigo)]
        : ['', '(Este tipo de evento todavía no tiene explicación automática: la clave del evento y el detalle son lo que hay.)']),
      ...(cerca.length ? ['', 'OTROS RENGLONES DE LA MISMA HORA (del más reciente al más antiguo):', ...cerca.map(x => '- ' + x.fecha + ' · ' + ((EVENTO[x.evento] || ['', x.evento])[1]) + (x.detalle ? ' · ' + x.detalle : ''))] : []),
      '', 'LO QUE NECESITO', 'Explica qué pasó, si es grave y qué hay que hacer. Si hace falta cambiar el código, dime en qué archivo y qué parte.'].join('\n');
  }
  async function copiar(id) {
    const r = filas.find(x => String(x.id) === String(id) && x.tipo !== 'facturacion') || filas.find(x => String(x.id) === String(id));
    if (!r) return;
    try { await navigator.clipboard.writeText(reporte(r)); toast('Reporte copiado: listo para mandarlo a soporte'); }
    catch { toast('No se pudo copiar en este navegador'); }
  }

  const tarjeta = (n, texto, malo) => '<div class="logs-tarjeta' + (malo && n ? ' logs-alerta' : '') + '"><b>' + Number(n) + '</b><span>' + esc(texto) + '</span></div>';
  const renglon = r => {
    const [icono, texto] = EVENTO[r.evento] || ['•', r.evento];
    return '<tr class="logs-' + esc(r.nivel) + '"><td class="st-fecha">' + esc(fechaHora(r.fecha)) + '</td>'
      + '<td><span aria-hidden="true">' + icono + '</span> <b>' + esc(texto) + '</b>' + (r.detalle ? '<div class="bit-detalle">' + esc(r.detalle) + '</div>' : '') + (r.guia ? guia(r.guia) : '')
      + '<div><button type="button" class="btn btn-outline btn-chico" data-logs-copiar="' + esc(r.id) + '">📋 Copiar reporte</button></div></td>'
      + '<td>' + esc(r.usuario || '—') + '</td><td><code>' + esc(r.ip || '') + '</code></td><td>' + esc(r.equipo || '') + '</td></tr>';
  };
  function pintarLista(hayMas) {
    Repintado.pintar($('logs-lista'), filas.length
      ? '<div class="tabla-scroll"><table class="tabla-resumen bit-tabla"><thead><tr><th>Fecha</th><th>Qué pasó</th><th>Usuario</th><th>IP</th><th>Equipo</th></tr></thead><tbody>'
        + filas.map(renglon).join('') + '</tbody></table></div>'
        + (hayMas ? '<button type="button" class="btn btn-secundario" id="logs-mas">Ver más antiguos</button>' : '')
      : '<p class="util-45">Sin registros con estos filtros.</p>');
  }

  async function cargar(mas) {
    if (!Permisos.datos?.direccion || !$('panel-logs')) return;
    if (!listo) preparar();
    const turno = ++consulta;
    const q = new URLSearchParams();
    for (const [k, id] of [['tipo', 'logs-tipo'], ['desde', 'logs-desde'], ['hasta', 'logs-hasta'], ['q', 'logs-buscar']]) if ($(id).value.trim()) q.set(k, $(id).value.trim());
    if (mas && filas.length) q.set('antes_de', filas[filas.length - 1].id);
    else Repintado.cargando($('logs-lista'), [$('logs-tipo').value, $('logs-desde').value, $('logs-hasta').value].join('|'));
    let j;
    try { const r = await api('/registro-sistema?' + q); j = await r.json(); if (!r.ok) throw new Error(j.error); }
    catch (err) { if (turno === consulta) Repintado.falla($('logs-lista'), err, () => cargar(), '<p class="aviso-error-carga">No se pudieron cargar los logs: ' + esc(err.message) + '</p>'); return; }
    if (turno !== consulta) return;
    filas = mas ? filas.concat(j.filas) : j.filas; sistema = j.sistema || sistema;
    const s = j.resumen;
    const resp = j.respaldo;
    $('logs-resumen').innerHTML = '<p class="ayuda">Últimas 24 horas</p><div class="logs-tarjetas">' + tarjeta(s.entradas, 'Entradas') + tarjeta(s.fallos, 'Contraseñas equivocadas', true)
      + tarjeta(s.bloqueos, 'Bloqueos', true) + tarjeta(s.errores, 'Errores (servidor y pantallas)', true)
      + tarjeta(s.facturas_error, 'Errores de facturación', true) + tarjeta(s.servicios, 'Correos, respaldos o WhatsApp con falla', true) + '</div>'
      + '<p class="ayuda logs-estado">' + (resp ? (resp.evento === 'respaldo_ok' ? '💾 Último respaldo automático: ' : '⚠️ El último respaldo automático FALLÓ: ') + esc(fechaHora(resp.fecha)) + (resp.evento === 'respaldo_fallo' ? ' · ' + esc(resp.detalle || '') : '') : '💾 Todavía no hay respaldo automático registrado (se hace uno al día).')
      + (j.inicio ? ' · 🔄 El sistema arrancó por última vez: ' + esc(fechaHora(j.inicio)) : '') + '</p>';
    $('logs-conectados').innerHTML = j.conectados.length
      ? '<div class="tabla-scroll"><table class="tabla-resumen bit-tabla"><thead><tr><th>Usuario</th><th>Última actividad</th><th>Sesiones abiertas</th><th>Entró desde</th></tr></thead><tbody>'
        + j.conectados.map(c => '<tr><td><b>' + esc(c.nombre) + '</b></td><td>' + esc(hace(c.ultima_actividad)) + '</td><td>' + Number(c.sesiones) + '</td><td>'
          + esc(c.equipo || '') + (c.ip ? ' <code>' + esc(c.ip) + '</code>' : '') + '</td></tr>').join('') + '</tbody></table></div>'
        + '<p class="ayuda">Una sesión cuenta como abierta hasta 12 h después de su última actividad. Para sacar a alguien, desactívalo o asígnale una contraseña nueva arriba: se cierran todas sus sesiones.</p>'
      : '<p class="util-45">Nadie tiene la sesión abierta.</p>';
    pintarLista(j.hay_mas);
  }

  function preparar() {
    listo = true;
    let espera;
    for (const id of ['logs-tipo', 'logs-desde', 'logs-hasta']) $(id).addEventListener('change', () => cargar());
    $('logs-buscar').addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(() => cargar(), 350); });
    $('logs-lista').addEventListener('click', e => { if (e.target.id === 'logs-mas') { e.target.disabled = true; cargar(true); } else if (e.target.dataset?.logsCopiar) copiar(e.target.dataset.logsCopiar); });
    $('logs-ir-bitacora').addEventListener('click', () => cambiarVista('bitacora'));
  }

  return { cargar };
})();
window.Logs = Logs;
