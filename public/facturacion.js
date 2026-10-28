/* Facturación · pantalla de configuración (2026-10-27), en Ajustes y solo para Dirección. Ver server/facturacion-rutas.js.
   Muestra a qué entorno de factura.com está conectado el servidor (sin mostrar las llaves), permite probar la conexión, actualizar los catálogos del SAT
   y dejar en cada sucursal su CP de expedición y su serie de factura y de pago. Las series se eligen de la lista que da factura.com (cárgala con
   «Probar conexión»): no se escriben a mano. Lo que viene de factura.com se escapa como todo lo demás. */
const Facturacion = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t == null ? '' : String(t));
  let CFG = null, SERIES = null, SERV = null, ocupado = false;

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
    try { [CFG, SERV] = await Promise.all([pedir('/config'), pedir('/servicios')]); pintar(); pintarServicios(); }
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
  // ---------- Claves del SAT de cada servicio ----------
  function pintarServicios() {
    if (!SERV) return;
    const sinCatalogo = !SERV.catalogo.productos || !SERV.catalogo.unidades;
    const nombre = (clave, nom) => (nom ? esc(nom) : clave ? '⚠ No aparece en el catálogo del SAT' : '');
    $('fx-servicios').innerHTML = `${sinCatalogo ? '<p class="aviso-error-carga">Primero pulsa «Actualizar catálogos del SAT»: así se comprueba que cada clave exista.</p>' : ''}
      <div class="fx-aplicar"><b>Ponerle la misma clave a todos los servicios que no la tengan</b>
        <div class="fx-suc-campos">
          <label>Clave de producto o servicio<input id="fx-ap-prod" list="fx-dl-prod" inputmode="numeric" maxlength="8" placeholder="8 números" autocomplete="off"><small class="ayuda"></small></label>
          <label>Unidad<input id="fx-ap-uni" list="fx-dl-uni" maxlength="3" placeholder="por ejemplo E48" autocomplete="off"><small class="ayuda"></small></label>
        </div>
        <button type="button" class="btn btn-secundario" id="fx-aplicar">Aplicar a los que no tienen</button></div>
      ${SERV.servicios.map(s => `<div class="fx-serv" data-fx-serv="${Number(s.id)}">
        <div class="fx-serv-nom"><b>${esc(s.nombre)}</b> ${s.clave_prod_serv && s.clave_unidad ? '<span class="fx-ok">✔</span>' : '<small class="fx-mal">sin clave completa: no podrá facturarse</small>'}</div>
        <div class="fx-suc-campos">
          <label>Clave de producto o servicio<input data-fx-prod list="fx-dl-prod" inputmode="numeric" maxlength="8" value="${esc(s.clave_prod_serv)}" autocomplete="off"><small class="ayuda">${nombre(s.clave_prod_serv, s.clave_prod_serv_nombre)}</small></label>
          <label>Unidad<input data-fx-uni list="fx-dl-uni" maxlength="3" value="${esc(s.clave_unidad)}" autocomplete="off"><small class="ayuda">${nombre(s.clave_unidad, s.clave_unidad_nombre)}</small></label>
        </div>
        <div class="fx-suc-pie"><span></span><button type="button" class="btn btn-secundario" data-fx-serv-guardar>Guardar</button></div></div>`).join('') || '<p class="util-45">No hay servicios.</p>'}`;
  }
  // Sugerencias al escribir (por clave o por palabras) y el nombre oficial de lo que ya está escrito. Los textos se ponen con el DOM, no como HTML.
  async function sugerir(entrada) {
    const tipo = entrada.id === 'fx-ap-uni' || entrada.hasAttribute('data-fx-uni') ? 'unidad' : 'producto', q = entrada.value.trim();
    const nom = entrada.parentElement.querySelector('small'); if (!q) { nom.textContent = ''; return; }
    try {
      const r = await pedir('/buscar-clave?tipo=' + tipo + '&q=' + encodeURIComponent(q));
      const lista = $(tipo === 'unidad' ? 'fx-dl-uni' : 'fx-dl-prod');
      lista.replaceChildren(...r.resultados.map(x => { const o = document.createElement('option'); o.value = x.clave; o.textContent = x.nombre; return o; }));
      const exacta = r.resultados.find(x => x.clave === q.toUpperCase());
      nom.textContent = exacta ? exacta.nombre : r.catalogo_vacio ? '⚠ Primero actualiza los catálogos del SAT' : (q.length >= 2 ? '⚠ No aparece en el catálogo del SAT' : '');
    } catch { /* las sugerencias no son indispensables */ }
  }
  // (Este archivo se carga antes que app.js: por eso no se usa su «debounce».)
  let esperaSugerir = 0;
  document.addEventListener('input', e => { const i = e.target.closest?.('#fx-servicios input'); if (i) { clearTimeout(esperaSugerir); esperaSugerir = setTimeout(() => sugerir(i), 300); } });

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
    const r = await pedir('/catalogos', {}, 'POST'); CFG.catalogos = r.catalogos; SERV = await pedir('/servicios');
    const malos = r.resultados.filter(x => x.error || !x.actualizado);
    salida.innerHTML = malos.length ? `⚠ ${malos.map(x => `${esc(x.catalogo)}: ${esc(x.motivo || 'sin cambios')}`).join(' · ')}` : '✔ Catálogos del SAT actualizados.';
    pintar(); pintarServicios();
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

  $('fx-servicios')?.addEventListener('click', e => {
    const g = e.target.closest('[data-fx-serv-guardar]');
    if (g) {
      const fila = g.closest('[data-fx-serv]'), id = Number(fila.dataset.fxServ), s = SERV.servicios.find(x => x.id === id), cuerpo = {};
      const prod = fila.querySelector('[data-fx-prod]').value.trim(), uni = fila.querySelector('[data-fx-uni]').value.trim().toUpperCase();
      if (prod !== s.clave_prod_serv) cuerpo.clave_prod_serv = prod;
      if (uni !== s.clave_unidad) cuerpo.clave_unidad = uni;
      if (!Object.keys(cuerpo).length) { toast('No hay cambios que guardar'); return; }
      return operacion(g, async () => { const nuevo = await pedir('/servicios/' + id, cuerpo, 'PUT'); SERV.servicios = SERV.servicios.map(x => (x.id === id ? nuevo : x)); pintarServicios(); toast('Claves de «' + nuevo.nombre + '» guardadas'); });
    }
    const a = e.target.closest('#fx-aplicar');
    if (a) operacion(a, async salida => {
      const r = await pedir('/servicios/aplicar', { clave_prod_serv: $('fx-ap-prod').value, clave_unidad: $('fx-ap-uni').value }, 'POST');
      SERV.servicios = r.servicios; pintarServicios();
      salida.textContent = r.actualizados ? '✔ Claves puestas a ' + r.actualizados + ' servicio(s) que no tenían.' : 'Todos los servicios ya tenían sus claves: no se cambió ninguno.';
    });
  });

  // ---------- Datos fiscales del cliente (dentro de su ficha) ----------
  // Los capturan Dirección, el Gerente y quien tenga el permiso «Datos fiscales de clientes». Un cliente puede tener varios (varias razones sociales).
  // Se guardan aunque estén incompletos: la tarjeta dice qué falta y el timbrado no sale hasta que esté completo.
  let FIS = null, guardandoFiscal = false;
  const CAMPOS_FIS = ['rfc', 'razon_social', 'cp', 'regimen', 'uso_cfdi', 'correo'];
  async function cargarCliente(id) {
    const cont = $('fc-fiscales'); if (!cont) return;
    if (typeof Permisos !== 'undefined' && !Permisos.puede('facturacion.fiscales')) { cont.innerHTML = ''; FIS = null; return; }
    cont.innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    try { FIS = { clienteId: Number(id), nuevo: false, ...(await pedir('/clientes/' + Number(id))) }; pintarFiscales(); }
    catch (e) { FIS = null; cont.innerHTML = `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`; }
  }
  function opcionesUso(regimen, actual) {
    const usos = FIS.catalogo.usos.filter(u => !regimen || !u.regimenes.length || u.regimenes.includes(regimen));
    return '<option value="">— elige —</option>' + (actual && !usos.some(u => u.clave === actual) ? `<option value="${esc(actual)}" selected>${esc(actual)} (no es compatible con este régimen)</option>` : '')
      + usos.map(u => `<option value="${esc(u.clave)}"${u.clave === actual ? ' selected' : ''}>${esc(u.clave)} · ${esc(u.nombre)}</option>`).join('');
  }
  function tarjetaFiscal(f, nueva) {
    const cat = FIS.catalogo, s = FIS.sugerencia, v = nueva ? { id: 0, rfc: s.rfc, razon_social: s.razon_social, cp: '', regimen: '', uso_cfdi: '', correo: s.correo, predeterminado: false, activo: true, listo: false, faltantes: [], errores: [] } : f;
    const regimen = cat.regimenes
      ? `<select data-fx-f="regimen" data-fx-regimen><option value="">— elige —</option>${cat.regimenes.map(r => `<option value="${esc(r.clave)}"${r.clave === v.regimen ? ' selected' : ''}>${esc(r.clave)} · ${esc(r.nombre)}</option>`).join('')}</select>`
      : `<input data-fx-f="regimen" inputmode="numeric" maxlength="3" value="${esc(v.regimen)}" placeholder="601">`;
    const uso = cat.usos ? `<select data-fx-f="uso_cfdi" data-fx-uso>${opcionesUso(v.regimen, v.uso_cfdi)}</select>` : `<input data-fx-f="uso_cfdi" maxlength="4" value="${esc(v.uso_cfdi)}" placeholder="G03">`;
    const estado = nueva ? '<span class="fx-badge fx-sandbox">Nuevo</span>' : !v.activo ? '<span class="fx-badge fx-inactivo">Desactivado</span>' : v.listo ? '<span class="fx-ok">✔ Lista para facturar</span>' : `<span class="fx-mal">Falta: ${esc((v.faltantes.length ? v.faltantes : v.errores).join(', '))}</span>`;
    return `<details class="fx-fiscal${v.activo ? '' : ' fx-inactiva'}" data-fx-fid="${Number(v.id)}"${nueva || !v.listo ? ' open' : ''}>
      <summary><b>${esc(v.razon_social || 'Sin razón social')}</b> <small>${esc(v.rfc)}</small> ${v.predeterminado ? '<span class="fx-badge fx-sandbox">Predeterminado</span>' : ''} ${estado}</summary>
      <div class="fx-suc-campos">
        <label>RFC<input data-fx-f="rfc" maxlength="13" value="${esc(v.rfc)}" autocapitalize="characters" autocomplete="off"></label>
        <label>Razón social (como en la Constancia, sin S.A. de C.V.)<input data-fx-f="razon_social" maxlength="254" value="${esc(v.razon_social)}" autocomplete="off"></label>
        <label>Código postal fiscal<input data-fx-f="cp" inputmode="numeric" maxlength="5" value="${esc(v.cp)}" autocomplete="off"></label>
        <label>Régimen fiscal${regimen}</label>
        <label>Uso del CFDI${uso}</label>
        <label>Correo para enviar la factura<input data-fx-f="correo" type="email" maxlength="254" value="${esc(v.correo)}" autocomplete="off"></label>
      </div>
      ${!nueva && v.errores.length && v.faltantes.length === 0 ? `<p class="aviso-error-carga">${esc(v.errores.join(' · '))}</p>` : ''}
      <div class="fx-suc-pie"><span class="ayuda">${nueva ? '' : v.sincronizado ? 'Ya está dado de alta en factura.com.' : ''}</span>
        <span class="btn-group"><button type="button" class="btn btn-secundario" data-fx-fiscal-guardar>Guardar</button>
        ${nueva ? '<button type="button" class="btn btn-outline" data-fx-fiscal-cancelar>Cancelar</button>' : `${v.predeterminado || !v.activo ? '' : '<button type="button" class="btn btn-outline" data-fx-fiscal-pred>⭐ Predeterminado</button>'}<button type="button" class="btn btn-outline" data-fx-fiscal-activo>${v.activo ? 'Desactivar' : 'Reactivar'}</button>`}</span></div>
    </details>`;
  }
  function pintarFiscales() {
    if (!FIS) return;
    const cat = FIS.catalogo, activos = FIS.fiscales.filter(f => f.activo), resumen = $('fc-fiscales-resumen');
    if (resumen) resumen.textContent = !activos.length ? '· sin datos' : activos.some(f => f.listo) ? '· ✔ lista para facturar' : '· incompletos';
    $('fc-fiscales').innerHTML = `${!cat.regimenes || !cat.usos ? '<p class="ayuda">⚠ Los catálogos del SAT todavía no están cargados: Dirección debe pulsar «Actualizar catálogos del SAT» en Ajustes → Facturación. Mientras, el régimen y el uso se escriben a mano y no se comprueba que sean compatibles.</p>' : ''}
      ${FIS.fiscales.map(f => tarjetaFiscal(f, false)).join('') || '<p class="util-45">Este cliente todavía no tiene datos fiscales. Sin ellos no se le puede facturar.</p>'}
      ${FIS.nuevo ? tarjetaFiscal(null, true) : '<div class="btn-group"><button type="button" class="btn btn-secundario" id="fx-fiscal-nuevo">➕ Agregar datos fiscales</button></div>'}`;
  }
  const camposDe = tarjeta => Object.fromEntries(CAMPOS_FIS.map(k => [k, tarjeta.querySelector(`[data-fx-f="${k}"]`).value.trim()]));
  async function guardarFiscal(boton, tarjeta, accion) {
    if (guardandoFiscal) return; guardandoFiscal = true; boton.disabled = true;
    try {
      const fid = Number(tarjeta.dataset.fxFid);
      const r = fid ? await pedir('/fiscales/' + fid, accion, 'PUT') : await pedir('/clientes/' + FIS.clienteId, accion, 'POST');
      toast(fid ? 'Datos fiscales guardados' : 'Datos fiscales agregados'); for (const a of r.avisos_guardado || []) toast(a);
      FIS.nuevo = false; await cargarCliente(FIS.clienteId);
    } catch (e) { toast(e.message); } finally { guardandoFiscal = false; boton.disabled = false; }
  }
  $('fc-fiscales')?.addEventListener('click', e => {
    if (!FIS) return;
    if (e.target.closest('#fx-fiscal-nuevo')) { FIS.nuevo = true; pintarFiscales(); $('fc-fiscales').querySelector('details:last-of-type [data-fx-f="rfc"]')?.focus(); return; }
    if (e.target.closest('[data-fx-fiscal-cancelar]')) { FIS.nuevo = false; pintarFiscales(); return; }
    const t = e.target.closest('details[data-fx-fid]'); if (!t) return;
    const guardar = e.target.closest('[data-fx-fiscal-guardar]');
    if (guardar) {
      const id = Number(t.dataset.fxFid), campos = camposDe(t), actual = FIS.fiscales.find(x => x.id === id), cuerpo = {};
      for (const k of CAMPOS_FIS) if (!id || campos[k] !== (actual?.[k] ?? '')) cuerpo[k] = campos[k];
      if (id && !Object.keys(cuerpo).length) { toast('No hay cambios que guardar'); return; }
      return guardarFiscal(guardar, t, id ? cuerpo : campos);
    }
    const pred = e.target.closest('[data-fx-fiscal-pred]'); if (pred) return guardarFiscal(pred, t, { predeterminado: true });
    const act = e.target.closest('[data-fx-fiscal-activo]'); if (act) { const f = FIS.fiscales.find(x => x.id === Number(t.dataset.fxFid)); return guardarFiscal(act, t, { activo: !f.activo }); }
  });
  // Al elegir un régimen, el uso del CFDI solo ofrece los compatibles.
  $('fc-fiscales')?.addEventListener('change', e => {
    const r = e.target.closest('[data-fx-regimen]'); if (!r || !FIS?.catalogo.usos) return;
    const uso = r.closest('details').querySelector('[data-fx-uso]'); uso.innerHTML = opcionesUso(r.value, uso.value);
  });

  return { cargar, cargarCliente };
})();
window.Facturacion = Facturacion;
