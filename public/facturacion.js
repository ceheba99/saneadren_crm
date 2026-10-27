/* Facturación · pantalla de configuración (2026-10-27), en Ajustes y solo para Dirección. Ver server/facturacion-rutas.js.
   Muestra a qué entorno de factura.com está conectado el servidor (sin mostrar las llaves), permite probar la conexión, actualizar los catálogos del SAT
   y dejar en cada sucursal su CP de expedición y su serie de factura y de pago. Las series se eligen de la lista que da factura.com (cárgala con
   «Probar conexión»): no se escriben a mano. Lo que viene de factura.com se escapa como todo lo demás. */
const Facturacion = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t == null ? '' : String(t));
  let CFG = null, SERIES = null, ocupado = false;

  async function pedir(ruta, cuerpo, metodo = 'GET') {
    const r = await api('/facturacion' + ruta, cuerpo !== undefined || metodo !== 'GET' ? { method: metodo, body: JSON.stringify(cuerpo ?? {}) } : undefined);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(j.error || 'No se pudo completar');
    return j;
  }
  const marca = ok => (ok ? '<span class="fx-ok">✔</span>' : '<span class="fx-mal">✘</span>');
  const cuando = f => (f ? (typeof fechaCorta === 'function' ? fechaCorta(f) : f) : 'nunca');

  async function cargar() {
    const panel = $('panel-facturacion'); if (!panel || !document.body.classList.contains('es-general')) return;
    try { CFG = await pedir('/config'); pintar(); }
    catch (e) { $('fx-estado').innerHTML = `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`; }
  }

  function opcionesSerie(tipo, actual) {
    const lista = (SERIES || []).filter(s => s.tipo === tipo && s.activa);
    const hay = !actual || lista.some(s => s.id === actual.id);
    return '<option value="">— sin serie —</option>'
      + (!hay ? `<option value="${esc(actual.id)}" selected>${esc(actual.nombre)} (la actual)</option>` : '')
      + lista.map(s => `<option value="${esc(s.id)}"${actual && actual.id === s.id ? ' selected' : ''}>${esc(s.nombre)}${s.descripcion ? ' · ' + esc(s.descripcion) : ''}</option>`).join('');
  }

  function pintar() {
    const c = CFG, enDemo = c.demo;
    $('fx-estado').innerHTML = `${enDemo ? '<p class="ayuda fx-demo">🧪 Demo: aquí no hay conexión con factura.com. Solo se ve cómo queda la pantalla; los datos son de ejemplo.</p>' : ''}
      <p><span class="fx-badge ${c.produccion ? 'fx-prod' : 'fx-sandbox'}">${c.produccion ? 'PRODUCCIÓN · los timbres tienen validez fiscal' : 'Pruebas (sandbox) · sin validez fiscal'}</span></p>
      <ul class="fx-lista">
        <li>${marca(c.apiKey === 'puesta')} Llave de la API: ${c.apiKey === 'puesta' ? 'puesta' : 'falta'}</li>
        <li>${marca(c.secretKey === 'puesta')} Llave secreta: ${c.secretKey === 'puesta' ? 'puesta' : 'falta'}</li>
        <li>${marca(!!c.emisor.regimen)} Régimen del emisor: ${esc(c.emisor.regimen || 'falta')}</li>
        <li>${marca(!!c.emisor.cp)} CP de expedición general (si una sucursal no tiene el suyo): ${esc(c.emisor.cp || 'falta')}</li>
      </ul>
      ${c.faltantes.length && !enDemo ? `<p class="aviso-error-carga">Falta en el archivo .env del servidor: ${esc(c.faltantes.join(', '))}.</p>` : ''}
      ${c.avisos.map(a => `<p class="ayuda">⚠ ${esc(a)}</p>`).join('')}
      <p class="ayuda">Las llaves viven solo en el servidor y nunca se muestran aquí. El entorno lo decide <code>FACTURA_ENV</code> en el .env.</p>`;
    botones();
    $('fx-catalogos-lista').innerHTML = c.catalogos.map(k => `<li>${marca(k.total > 0)} ${esc(k.catalogo)}: ${Number(k.total).toLocaleString('es-MX')} claves · actualizado ${esc(cuando(k.actualizado))}</li>`).join('');
    $('fx-sucursales').innerHTML = c.sucursales.map(s => {
      const sinSerie = s.activo && !s.serie_factura;
      return `<div class="fx-suc${s.activo ? '' : ' fx-inactiva'}" data-fx-suc="${Number(s.id)}">
        <div class="fx-suc-tit"><b>${esc(s.nombre)}</b> <small>${esc(s.clave)}${s.activo ? '' : ' · desactivada'}</small></div>
        <div class="fx-suc-campos">
          <label>CP de expedición<input data-fx-cp inputmode="numeric" maxlength="5" value="${esc(s.cp_expedicion)}" placeholder="${c.emisor.cp ? 'usa el general: ' + esc(c.emisor.cp) : '5 dígitos'}" autocomplete="off"></label>
          <label>Serie de factura<select data-fx-serie="serie_factura" ${enDemo ? 'disabled' : ''}>${opcionesSerie('factura', s.serie_factura)}</select></label>
          <label>Serie de pago (complemento)<select data-fx-serie="serie_pago" ${enDemo ? 'disabled' : ''}>${opcionesSerie('pago', s.serie_pago)}</select></label>
        </div>
        <div class="fx-suc-pie"><span class="ayuda" data-fx-aviso>${sinSerie ? '⚠ Sin serie de factura: esta sucursal todavía no podrá facturar.' : ''}</span><button type="button" class="btn btn-secundario" data-fx-guardar>Guardar</button></div>
      </div>`;
    }).join('') || '<p class="util-45">No hay sucursales.</p>';
    if (!SERIES && !enDemo) $('fx-sucursales').insertAdjacentHTML('afterbegin', '<p class="ayuda">Para elegir las series, pulsa primero «Probar conexión»: así se cargan las de factura.com.</p>');
  }

  const botones = () => { for (const id of ['fx-probar', 'fx-catalogos']) { const b = $(id); if (b) b.disabled = !!CFG?.demo || ocupado; } };
  async function operacion(boton, tarea) {
    if (ocupado) return; ocupado = true; botones(); boton.disabled = true; const texto = boton.textContent; boton.textContent = 'Trabajando…';
    const salida = $('fx-resultado'); salida.className = 'ayuda'; salida.textContent = '';
    try { await tarea(salida); } catch (e) { salida.className = 'aviso-error-carga'; salida.textContent = e.message; toast(e.message); }
    finally { ocupado = false; boton.disabled = false; boton.textContent = texto; botones(); }
  }

  $('fx-probar')?.addEventListener('click', e => operacion(e.currentTarget, async salida => {
    const r = await pedir('/probar', {}, 'POST'); SERIES = r.series;
    salida.innerHTML = `✔ La conexión funciona: factura.com aceptó las llaves (${esc(r.entorno === 'prod' ? 'producción' : 'sandbox')}). Series en la cuenta: ${Number(r.series.length)}.`;
    pintar();
  }));
  $('fx-catalogos')?.addEventListener('click', e => operacion(e.currentTarget, async salida => {
    const r = await pedir('/catalogos', {}, 'POST'); CFG.catalogos = r.catalogos;
    const malos = r.resultados.filter(x => x.error || !x.actualizado);
    salida.innerHTML = malos.length ? `⚠ ${malos.map(x => `${esc(x.catalogo)}: ${esc(x.motivo || 'sin cambios')}`).join(' · ')}` : '✔ Catálogos del SAT actualizados.';
    pintar();
  }));
  $('fx-sucursales')?.addEventListener('click', e => {
    const b = e.target.closest('[data-fx-guardar]'); if (!b) return;
    const fila = b.closest('[data-fx-suc]'), id = Number(fila.dataset.fxSuc), s = CFG.sucursales.find(x => x.id === id), cuerpo = {};
    const cp = fila.querySelector('[data-fx-cp]').value.trim();
    if (cp !== s.cp_expedicion) cuerpo.cp_expedicion = cp;
    for (const sel of fila.querySelectorAll('[data-fx-serie]')) { const campo = sel.dataset.fxSerie, actual = s[campo]?.id || ''; if (sel.value !== actual) cuerpo[campo] = sel.value || null; }
    if (!Object.keys(cuerpo).length) { toast('No hay cambios que guardar'); return; }
    operacion(b, async () => {
      const nueva = await pedir('/sucursales/' + id, cuerpo, 'PUT');
      CFG.sucursales = CFG.sucursales.map(x => (x.id === id ? nueva : x)); pintar(); toast('Facturación de ' + nueva.nombre + ' guardada');
    });
  });

  return { cargar };
})();
window.Facturacion = Facturacion;
