// Encuesta de satisfacción en el CRM (2026-10-26; antes Google Forms con un QR fijo). Ver server/encuestas.js.
//  · En la ficha de la orden: el enlace único (para mandarlo por WhatsApp o copiarlo) y, ya contestada, sus respuestas.
//  · qrPng(leadId): el QR de esa orden como PNG, para la orden impresa (PDF y Word). Usa qrcode-generator (cdnjs).
const Encuestas = (() => {
  const $ = id => document.getElementById(id);
  const esc = t => escaparHtml(t == null ? '' : String(t));
  const cache = new Map(); // leadId → respuesta del servidor
  async function datos(leadId, fresco = false) {
    if (!fresco && cache.has(leadId)) return cache.get(leadId);
    const r = await api('/leads/' + Number(leadId) + '/encuesta'); const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'No se pudo cargar la encuesta');
    cache.set(leadId, j); return j;
  }
  // QR → PNG (bytes) dibujado en un canvas: jsPDF y docx reciben PNG.
  async function qrPng(leadId) {
    if (typeof qrcode !== 'function') throw new Error('Sin generador de QR');
    const { url } = await datos(leadId);
    const q = qrcode(0, 'M'); q.addData(url); q.make();
    const n = q.getModuleCount(), borde = 4, px = 8, lado = (n + borde * 2) * px;
    const cv = document.createElement('canvas'); cv.width = cv.height = lado;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, lado, lado); ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect((c + borde) * px, (r + borde) * px, px, px);
    const b64 = cv.toDataURL('image/png').split(',')[1], bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  const estrellas = v => typeof v === 'number' ? v + ' de 5' : 'N/A';
  async function pintarOrden(lead) {
    const sec = $('seccion-encuesta'), cont = $('encuesta-orden');
    if (!lead || lead.estatus !== 'ganado') { sec.hidden = true; return; }
    sec.hidden = false; cont.innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    let j; try { j = await datos(lead.id, true); } catch (err) { cont.innerHTML = '<p class="aviso-error-carga" role="alert">' + esc(err.message) + '</p>'; return; }
    if (LEAD_ACTUAL?.id !== lead.id) return;
    const anterior = lead.encuesta_calificacion ? '<p class="ayuda">Calificación capturada a mano antes de la encuesta propia: ' + Number(lead.encuesta_calificacion) + ' de 4' + (lead.encuesta_comentario ? ' · «' + esc(lead.encuesta_comentario) + '»' : '') + '</p>' : '';
    const r = j.respuesta;
    if (!r) {
      const wa = 'https://wa.me/?text=' + encodeURIComponent('Gracias por su preferencia. ¿Nos ayuda a calificar el servicio? Le toma menos de 2 minutos: ' + j.url);
      cont.innerHTML = '<p class="ayuda">Todavía no la contesta. El cliente la abre con el QR de su orden impresa, o mándale el enlace:</p>'
        + '<div class="encuesta-enlace"><input readonly value="' + esc(j.url) + '" aria-label="Enlace de la encuesta" onclick="this.select()">'
        + '<button type="button" class="btn btn-outline btn-chico" data-encuesta-copiar data-sl-libre>Copiar</button>'
        + '<a class="btn btn-outline btn-chico" href="' + esc(wa) + '" target="_blank" rel="noopener">WhatsApp</a></div>' + anterior;
      return;
    }
    const nombre = (lista, k) => (lista.find(([c]) => c === k) || [, k])[1];
    const aspectos = j.preguntas.aspectos.map(m => '<tr class="enc-modulo"><th colspan="2">' + esc(m.titulo) + '</th></tr>'
      + m.items.map(i => '<tr><td>' + esc(i.texto) + '</td><td class="st-num"><b>' + esc(estrellas(r.aspectos[i.clave])) + '</b></td></tr>').join('')).join('');
    cont.innerHTML = '<div class="cobranza-resumen">'
      + '<div><small>Promedio</small><b>' + (r.promedio == null ? '—' : r.promedio + ' de 5') + '</b></div>'
      + '<div><small>Recomendaría</small><b>' + Number(r.nps) + ' / 10</b></div>'
      + '<div><small>Contestó</small><b>' + esc(fechaCorta(r.respondida_at)) + '</b></div></div>'
      + (r.insatisfecho ? '<p class="cuentas-aviso">⚠ Cliente insatisfecho: se avisó a Dirección, al gerente y al responsable de la orden.</p>' : '')
      + '<p class="ayuda">' + (r.contacto ? 'Contestó: <b>' + esc(r.contacto) + '</b> · ' : '') + 'Facturación y manifiestos: <b>' + esc(nombre(j.preguntas.facturacion, r.facturacion)) + '</b> · Mantenimiento preventivo: <b>' + esc(nombre(j.preguntas.preventivo, r.preventivo)) + '</b></p>'
      + (r.mejorar ? '<p class="ayuda">💬 Qué mejorar: «' + esc(r.mejorar) + '»</p>' : '')
      + (r.reconocimiento || r.reconocido ? '<p class="ayuda">👏 Reconoce' + (r.reconocido ? ' a <b>' + esc(r.reconocido) + '</b>' : '') + (r.reconocimiento ? ': «' + esc(r.reconocimiento) + '»' : '') + '</p>' : '')
      + '<details class="enc-detalle"><summary>Ver todas las calificaciones</summary><div class="tabla-scroll"><table class="tabla-resumen enc-tabla"><tbody>' + aspectos + '</tbody></table></div></details>' + anterior;
  }
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-encuesta-copiar]'); if (!b) return;
    const v = b.parentElement.querySelector('input').value;
    try { await navigator.clipboard.writeText(v); toast('Enlace de la encuesta copiado'); } catch { toast('No se pudo copiar: selecciona el enlace y cópialo'); }
  });
  return { pintarOrden, qrPng, datos };
})();
window.Encuestas = Encuestas;
