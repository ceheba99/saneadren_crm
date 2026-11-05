/* Logs del sistema (Configuración → Ajustes, hasta abajo; solo Dirección): resumen de las últimas 24 h, quién está
   conectado ahora y el registro de accesos, bloqueos y errores del servidor. Servidor: server/registro-sistema.js */
const Logs = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t);
  const EVENTO = {
    entro: ['🟢', 'Entró'], salio: ['⚪', 'Salió'], fallo: ['🟠', 'Contraseña equivocada'], desconocido: ['🟠', 'Usuario que no existe'],
    bloqueado: ['🔴', 'Bloqueado por intentos'], rechazado: ['🟠', 'Intentó entrar estando bloqueado'],
    olvido: ['🔑', 'Pidió restablecer su contraseña'], restablecio: ['🔑', 'Restableció su contraseña'], error: ['⛔', 'Error del servidor']
  };
  const fechaHora = f => { const [d, h] = String(f || '').split(' '); return (d || '').split('-').reverse().join('/') + (h ? ' ' + h.slice(0, 5) : ''); };
  const hace = iso => {
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return min < 1 ? 'ahora' : min < 60 ? 'hace ' + min + ' min' : 'hace ' + Math.floor(min / 60) + ' h ' + (min % 60) + ' min';
  };
  let consulta = 0, filas = [], listo = false;

  const tarjeta = (n, texto, malo) => '<div class="logs-tarjeta' + (malo && n ? ' logs-alerta' : '') + '"><b>' + Number(n) + '</b><span>' + esc(texto) + '</span></div>';
  const renglon = r => {
    const [icono, texto] = EVENTO[r.evento] || ['•', r.evento];
    return '<tr class="logs-' + esc(r.nivel) + '"><td class="st-fecha">' + esc(fechaHora(r.fecha)) + '</td>'
      + '<td><span aria-hidden="true">' + icono + '</span> <b>' + esc(texto) + '</b>' + (r.detalle ? '<div class="bit-detalle">' + esc(r.detalle) + '</div>' : '') + '</td>'
      + '<td>' + esc(r.usuario || '—') + '</td><td><code>' + esc(r.ip || '') + '</code></td><td>' + esc(r.equipo || '') + '</td></tr>';
  };
  function pintarLista(hayMas) {
    $('logs-lista').innerHTML = filas.length
      ? '<div class="tabla-scroll"><table class="tabla-resumen bit-tabla"><thead><tr><th>Fecha</th><th>Qué pasó</th><th>Usuario</th><th>IP</th><th>Equipo</th></tr></thead><tbody>'
        + filas.map(renglon).join('') + '</tbody></table></div>'
        + (hayMas ? '<button type="button" class="btn btn-secundario" id="logs-mas">Ver más antiguos</button>' : '')
      : '<p class="util-45">Sin registros con estos filtros.</p>';
  }

  async function cargar(mas) {
    if (!Permisos.datos?.direccion || !$('panel-logs')) return;
    if (!listo) preparar();
    const turno = ++consulta;
    const q = new URLSearchParams();
    for (const [k, id] of [['tipo', 'logs-tipo'], ['desde', 'logs-desde'], ['hasta', 'logs-hasta'], ['q', 'logs-buscar']]) if ($(id).value.trim()) q.set(k, $(id).value.trim());
    if (mas && filas.length) q.set('antes_de', filas[filas.length - 1].id);
    else $('logs-lista').innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    let j;
    try { const r = await api('/registro-sistema?' + q); j = await r.json(); if (!r.ok) throw new Error(j.error); }
    catch (err) { if (turno === consulta) $('logs-lista').innerHTML = '<p class="aviso-error-carga">No se pudieron cargar los logs: ' + esc(err.message) + '</p>'; return; }
    if (turno !== consulta) return;
    filas = mas ? filas.concat(j.filas) : j.filas;
    const s = j.resumen;
    $('logs-resumen').innerHTML = '<p class="ayuda">Últimas 24 horas</p><div class="logs-tarjetas">' + tarjeta(s.entradas, 'Entradas') + tarjeta(s.fallos, 'Contraseñas equivocadas', true)
      + tarjeta(s.bloqueos, 'Bloqueos', true) + tarjeta(s.errores, 'Errores del servidor', true) + '</div>';
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
    $('logs-lista').addEventListener('click', e => { if (e.target.id === 'logs-mas') { e.target.disabled = true; cargar(true); } });
    $('logs-ir-bitacora').addEventListener('click', () => cambiarVista('bitacora'));
  }

  return { cargar };
})();
window.Logs = Logs;
