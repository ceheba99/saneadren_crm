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
        ${enDemo ? '' : `<div class="fx-crear-serie"><span class="ayuda">¿Una serie propia para esta sucursal (por ejemplo ${esc(s.clave || 'QRO')})? Se crea en factura.com y queda asignada.</span>
          <label>Nombre<input data-fx-nueva-letra maxlength="10" placeholder="${esc(s.clave || 'QRO')}" autocapitalize="characters" autocomplete="off"></label>
          <label>Para<select data-fx-nueva-tipo><option value="factura">Facturas</option><option value="pago">Complementos de pago</option></select></label>
          <button type="button" class="btn btn-outline" data-fx-crear-serie>Crear serie</button></div>`}
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
  // ---------- Carga de clientes desde el CSV de factura.com (2026-11-03) ----------
  // Dos pasos: «Revisar» (el servidor solo lee y propone) y «Cargar» (el servidor vuelve a calcular con el mismo CSV y las decisiones de aquí). Lo que viene del archivo se escapa.
  let CLI = null; // { csv, plan }
  const salidaCli = () => $('fx-cli-resultado');
  const filaInfo = f => `${esc(f.razon_social || '(sin razón social)')} · régimen ${esc(f.regimen || '—')} · CP ${esc(f.cp || '—')}${f.correo ? '' : ' · sin correo'}${f.domicilio ? ' · ' + esc(f.domicilio) : ''}${f.incompleto.length ? ` <small class="fx-mal">(${esc(f.incompleto.join('; '))})</small>` : ''}`;
  const nombreCli = c => `${esc(c.empresa || c.nombre || 'Cliente ' + c.id)}${c.empresa && c.nombre ? ' (' + esc(c.nombre) + ')' : ''}`;
  function pintarClientes() {
    const p = CLI.plan, r = p.resumen, nec = p.unidades.filter(u => u.tipo !== 'sin_cliente' && (u.repetido || u.tipo === 'dudoso'));
    const bloqueNecesita = nec.map(u => `<div class="fx-serv" data-fx-cli-rfc="${esc(u.rfc)}">
      <div class="fx-serv-nom"><b>${esc(u.rfc)}</b> ${u.tipo === 'auto' ? `<small>liga sola con ${nombreCli(u.cliente)} (por ${esc(u.cliente.por)})</small>` : '<small>¿Con cuál cliente del CRM?</small>'}</div>
      ${u.tipo === 'dudoso' ? `<label>Cliente del CRM<select data-fx-cli-liga><option value="">— no ligar todavía —</option>${u.candidatos.map(c => `<option value="${Number(c.id)}">${nombreCli(c)} · ${esc(c.por)}</option>`).join('')}</select></label>` : ''}
      ${u.repetido ? `<div><small>Este RFC viene ${u.filas.length} veces en factura.com. Elige cuál usar:</small>${u.filas.map(f => `<label class="fx-check"><input type="radio" name="fx-cli-${esc(u.rfc)}" value="${esc(f.uid)}" data-fx-cli-uid> <span>${filaInfo(f)}</span></label>`).join('')}</div>` : ''}</div>`).join('');
    const lista = (titulo, items, f) => items.length ? `<details class="fx-detalle"><summary>${titulo} (${items.length})</summary><ul class="fx-lista">${items.slice(0, 300).map(f).join('')}</ul>${items.length > 300 ? '<p class="ayuda">Se muestran los primeros 300.</p>' : ''}</details>` : '';
    salidaCli().innerHTML = `<p><b>${Number(r.filas)} clientes en el archivo (${Number(r.rfc_distintos)} RFC distintos).</b> Se ligan solos: ${Number(r.automaticos)} · necesitan tu decisión: ${nec.length} · sin cliente en el CRM: ${Number(r.sin_cliente)} · no se pueden usar: ${Number(r.invalidos)}.</p>
      ${nec.length ? `<h4 class="fx-sub">Necesitan tu decisión</h4>${bloqueNecesita}` : ''}
      ${lista('Se ligan solos', p.unidades.filter(u => u.tipo === 'auto' && !u.repetido), u => `<li>${esc(u.rfc)} → ${nombreCli(u.cliente)} <small>(por ${esc(u.cliente.por)}${u.ya_cargado ? '; ya tenía sus datos fiscales: solo se completan los vacíos' : ''})</small></li>`)}
      ${lista('Sin cliente en el CRM (no se cargan)', p.unidades.filter(u => u.tipo === 'sin_cliente'), u => `<li>${esc(u.rfc)} · ${esc(u.filas[0].razon_social)}</li>`)}
      ${lista('No se pueden usar', p.invalidos, x => `<li>Línea ${Number(x.linea)}: ${esc(x.rfc || '—')} · ${esc(x.motivo)}</li>`)}
      <p class="ayuda">Lo incompleto (sin régimen, CP inválido, correo de relleno) se carga vacío: el sistema pedirá completarlo al facturar. El uso del CFDI no viene en el archivo y se elige al timbrar.</p>
      <button type="button" class="btn btn-primario" id="fx-cli-aplicar">Cargar</button> <span class="ayuda" id="fx-cli-cuenta"></span>`;
    contarClientes();
  }
  // Cuántos se cargarían con lo elegido hasta ahora (solo informativo: el servidor decide).
  function contarClientes() {
    if (!CLI) return; let n = 0;
    for (const u of CLI.plan.unidades) {
      if (u.tipo === 'sin_cliente') continue;
      const caja = [...salidaCli().querySelectorAll('[data-fx-cli-rfc]')].find(x => x.dataset.fxCliRfc === u.rfc);
      if (u.repetido && !caja?.querySelector('[data-fx-cli-uid]:checked')) continue;
      if (u.tipo === 'dudoso' && !caja?.querySelector('[data-fx-cli-liga]')?.value) continue;
      n++;
    }
    const c = $('fx-cli-cuenta'), b = $('fx-cli-aplicar'); if (c) c.textContent = `Se cargarían ${n} cliente(s) con lo elegido.`; if (b) b.disabled = !n;
  }
  $('fx-cli-revisar')?.addEventListener('click', async e => {
    const b = e.currentTarget, arch = $('fx-cli-archivo').files?.[0]; if (!arch) { toast('Elige el archivo CSV'); return; }
    if (arch.size > 900000) { toast('El archivo es muy grande (máximo 900 KB)'); return; }
    b.disabled = true; salidaCli().textContent = 'Revisando…';
    try {
      const csv = await arch.text(), plan = await pedir('/importar-clientes/vista-previa', { csv }, 'POST');
      CLI = { csv, plan }; pintarClientes();
    } catch (err) { CLI = null; salidaCli().innerHTML = `<p class="aviso-error-carga" role="alert">${esc(err.message)}</p>`; }
    finally { b.disabled = false; }
  });
  $('fx-cli-resultado')?.addEventListener('change', e => { if (e.target.closest('[data-fx-cli-liga], [data-fx-cli-uid]')) contarClientes(); });
  $('fx-cli-resultado')?.addEventListener('click', async e => {
    const b = e.target.closest('#fx-cli-aplicar'); if (!b || !CLI || b.disabled) return;
    const entorno = $('fx-cli-entorno').value, ligas = {}, elegidos = {};
    for (const caja of salidaCli().querySelectorAll('[data-fx-cli-rfc]')) {
      const rfc = caja.dataset.fxCliRfc, liga = caja.querySelector('[data-fx-cli-liga]')?.value, uid = caja.querySelector('[data-fx-cli-uid]:checked')?.value;
      if (liga) ligas[rfc] = Number(liga); if (uid) elegidos[rfc] = uid;
    }
    if (!await solicitarDialogo({ titulo: 'Cargar datos fiscales de los clientes', aceptar: 'Sí, cargar', mensaje: `Se guardan los datos fiscales de los clientes ligados (UID de la cuenta de ${entorno === 'prod' ? 'PRODUCCIÓN' : 'PRUEBAS'}). No se crea ningún cliente nuevo y lo que ya capturaste no se sobrescribe; solo se llenan campos vacíos.` })) return;
    b.disabled = true;
    try {
      const r = await pedir('/importar-clientes/aplicar', { csv: CLI.csv, decisiones: { entorno, ligas, elegidos } }, 'POST');
      const motivos = Object.entries(r.saltados.reduce((a, x) => (a[x.motivo] = (a[x.motivo] || 0) + 1, a), {}));
      salidaCli().innerHTML = `<p><span class="fx-ok">✔</span> <b>Listo:</b> ${Number(r.guardados)} cliente(s) cargado(s), ${Number(r.completados)} completado(s), ${Number(r.ya_estaban)} ya estaban. Sin cargar: ${r.saltados.length}.</p>
        ${motivos.length ? `<ul class="fx-lista">${motivos.map(([m, n]) => `<li>${Number(n)} · ${esc(m)}</li>`).join('')}</ul>` : ''}`;
      CLI = null; toast('Clientes cargados');
    } catch (err) { toast(err.message); b.disabled = false; }
  });

  // F7: revisión previa a producción (solo lectura). Todo lo que viene del servidor se escapa.
  $('fx-revisar')?.addEventListener('click', async e => {
    const b = e.currentTarget, salida = $('fx-revision'); b.disabled = true; salida.textContent = 'Revisando…';
    try {
      const r = await pedir('/revision-produccion'), icono = { ok: '<span class="fx-ok">✔</span>', falta: '<span class="fx-mal">✘</span>', aviso: '⚠' };
      const faltan = r.items.filter(i => i.nivel === 'falta').length;
      salida.innerHTML = `<p><b>${faltan ? `Faltan ${faltan} cosa${faltan === 1 ? '' : 's'} para producción` : 'Lo que el sistema puede comprobar está listo'}</b>${r.entorno === 'prod' ? ' · el servidor YA está en producción' : ' · el servidor sigue en pruebas'}. Los ⚠ los confirmas tú.</p>
        <ul class="fx-lista">${r.items.map(i => `<li>${icono[i.nivel] || ''} <b>${esc(i.titulo)}</b>${i.detalle ? '<br><small>' + esc(i.detalle) + '</small>' : ''}</li>`).join('')}</ul>`;
    } catch (err) { salida.innerHTML = `<p class="aviso-error-carga" role="alert">${esc(err.message)}</p>`; }
    finally { b.disabled = false; }
  });
  $('fx-catalogos')?.addEventListener('click', e => operacion(e.currentTarget, async salida => {
    const r = await pedir('/catalogos', {}, 'POST'); CFG.catalogos = r.catalogos; SERV = await pedir('/servicios');
    const malos = r.resultados.filter(x => x.error || !x.actualizado);
    salida.innerHTML = malos.length ? `⚠ ${malos.map(x => `${esc(x.catalogo)}: ${esc(x.motivo || 'sin cambios')}`).join(' · ')}` : '✔ Catálogos del SAT actualizados.';
    pintar(); pintarServicios();
  }));
  $('fx-sucursales')?.addEventListener('click', async e => {
    const nueva = e.target.closest('[data-fx-crear-serie]');
    if (nueva) {
      const fila = nueva.closest('[data-fx-suc]'), id = Number(fila.dataset.fxSuc), s = CFG.sucursales.find(x => x.id === id);
      const letra = fila.querySelector('[data-fx-nueva-letra]').value.trim().toUpperCase(), tipo = fila.querySelector('[data-fx-nueva-tipo]').value;
      if (!/^[A-Z0-9]{1,10}$/.test(letra)) { toast('Escribe la serie: de 1 a 10 letras o números, sin espacios ni acentos (por ejemplo QRO)'); return; }
      if (!await solicitarDialogo({ titulo: 'Crear serie en factura.com', aceptar: 'Sí, crear',
        mensaje: `Se crea la serie «${letra}» de ${tipo === 'pago' ? 'complementos de pago' : 'facturas'} en factura.com (${CFG.produccion ? 'PRODUCCIÓN' : 'pruebas'}) y queda asignada a ${s.nombre}.\n\nLas facturas ya hechas conservan su serie; las nuevas empiezan en el folio 1. Una serie creada no se borra desde aquí.` })) return;
      return operacion(nueva, async () => {
        const r = await pedir('/sucursales/' + id + '/crear-serie', { letra, tipo }, 'POST');
        CFG.sucursales = CFG.sucursales.map(x => (x.id === id ? r : x)); SERIES = null; pintar(); toast(`Serie «${letra}» creada y asignada a ${r.nombre}`); // sin HTML
      });
    }
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

  // ---------- Factura electrónica de una orden (F3, 2026-10-27) ----------
  // En la ficha de la orden de servicio, para quien puede facturar (Dirección, Gerente y el permiso «Timbrar facturas»). Muestra lo que se va a
  // timbrar (receptor, conceptos con sus claves del SAT, IVA y total) y lo que falta; el botón solo se activa cuando todo está completo.
  // En sandbox o en el demo se avisa en grande que es de PRUEBA. Nada de esto toca la cobranza salvo una factura de producción.
  let ORD = null, timbrando = false, TURNO = 0;
  const pesos = v => (typeof formatoMoneda === 'function' ? formatoMoneda(v) : '$' + Number(v).toFixed(2));
  const ESTADOS = { pendiente: ['Sin timbrar', 'fx-sandbox'], timbrando: ['Sin respuesta: verifica', 'fx-mal'], timbrada: ['Timbrada', 'fx-ok'], borrador_error: ['Borrador: corregir', 'fx-mal'], cancelacion_solicitada: ['Cancelación en proceso', 'fx-sandbox'], cancelada: ['Cancelada', 'fx-inactivo'] };
  async function pedirCompleto(ruta, cuerpo, metodo = 'GET') {
    const r = await api('/facturacion' + ruta, metodo !== 'GET' ? { method: metodo, body: JSON.stringify(cuerpo ?? {}) } : undefined);
    return { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) };
  }
  async function cargarOrden(lead, opciones = {}) {
    const sec = $('seccion-cfdi'), cont = $('cfdi-orden'); if (!sec || !cont) return;
    if (!lead || lead.estatus !== 'ganado' || (typeof Permisos !== 'undefined' && !Permisos.puede('facturacion.timbrar'))) { sec.hidden = true; ORD = null; return; }
    sec.hidden = false;
    const id = Number(lead.id), turno = ++TURNO; // si se abre otra ficha mientras carga, esta respuesta se descarta
    if (!ORD || ORD.id !== id) cont.innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    const q = new URLSearchParams(Object.entries(opciones).filter(([, v]) => v !== undefined && v !== '' && v !== null)).toString();
    const r = await pedirCompleto('/ordenes/' + id + (q ? '?' + q : ''));
    if (turno !== TURNO) return;
    if (!r.ok) { cont.innerHTML = `<p class="aviso-error-carga" role="alert">${esc(r.j.error || 'No se pudo cargar la factura')}</p>`; return; }
    ORD = { id, opciones: { ...opciones }, ...r.j, extra: ORD?.id === id ? ORD.extra : null };
    pintarOrden();
  }
  async function bajarArchivo(boton, fid, tipo) {
    boton.disabled = true;
    try {
      const r = await api('/facturacion/facturas/' + Number(fid) + '/' + tipo);
      if (!r.ok) throw Error((await r.json().catch(() => ({}))).error || 'No se pudo descargar');
      const nombre = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || 'factura.' + tipo;
      const url = URL.createObjectURL(await r.blob()), a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) { toast(err.message); } finally { boton.disabled = false; }
  }
  // ---------- Cancelación (F5, 2026-10-29) ----------
  // 01 = con errores y se sustituye (primero se timbra la nueva, relacionada con esta); 02 = con errores, sin sustituir; 03 = el servicio no se realizó.
  // 04 (factura global) no se usa: no hay factura global. Un complemento de pago (F6): 01 si se corrige (primero se timbra la corrección desde su pago),
  // 02 si el pago no debió registrarse.
  // Nada se da por cancelado hasta que el SAT lo confirma.
  function panelCancelar(tarjeta, f, enOrden) {
    tarjeta.parentNode.querySelectorAll('.fx-cancelar-panel').forEach(p => p.remove());
    const p = document.createElement('div'); p.className = 'fx-cancelar-panel'; p.dataset.fxPanel = String(f.id);
    const pago = f.tipo_documento === 'pago';
    p.innerHTML = `<p><b>¿Por qué se cancela ${pago ? 'el complemento de pago' : 'la'} ${esc(f.serie || '')}-${esc(f.folio || '')}?</b>${f.entorno === 'prod' ? ' Esta cancelación es ante el SAT y no se puede deshacer.' : ' (De prueba: sin validez fiscal.)'}</p>
      <label class="fx-check"><input type="radio" name="fx-motivo-${Number(f.id)}" value="01"> <span><b>01 · Tiene errores y se sustituye por ${pago ? 'otro complemento' : 'otra factura'}.</b> ${pago ? 'El pago sí ocurrió: primero se timbra el complemento corregido y después se cancela este. El pago nunca queda sin complemento.' : 'Primero se timbra la nueva (corregida) y después se cancela esta.'}</span></label>
      <label class="fx-check"><input type="radio" name="fx-motivo-${Number(f.id)}" value="02"> <span><b>02 · ${pago ? 'El pago no debió registrarse' : 'Tiene errores y no se va a sustituir'}.</b>${pago ? ' Por ejemplo, un cheque rebotado o un pago capturado dos veces. Cuando el SAT confirme la cancelación, cancela el pago en Finanzas (si no, vuelve a «complemento pendiente»).' : ''}</span></label>
      ${pago ? '' : '<label class="fx-check"><input type="radio" name="fx-motivo-' + Number(f.id) + '" value="03"> <span><b>03 · El servicio no se llevó a cabo.</b></span></label>'}
      <div class="btn-group"><button type="button" class="btn btn-primario" data-fx-cancelar-ok>Continuar</button><button type="button" class="btn btn-outline" data-fx-cancelar-no>No cancelar</button></div>`;
    tarjeta.after(p);
    p.addEventListener('click', async e => {
      if (e.target.closest('[data-fx-cancelar-no]')) return p.remove();
      const ok = e.target.closest('[data-fx-cancelar-ok]'); if (!ok) return;
      const motivo = p.querySelector('input[type=radio]:checked')?.value;
      if (!motivo) return toast('Elige el motivo de la cancelación');
      if (motivo === '01' && pago) {
        p.remove();
        const k = enOrden && ORD?.complementos?.pagos.find(x => x.complemento?.id === f.id);
        if (k) return abrirComplemento(k.cobro_id, null, f.id);
        return abrirFicha(Number(f.lead_id)).then(() => toast('Para corregirlo: en la tabla de pagos de la orden pulsa «Corregir» junto a este complemento')); // sin HTML
      }
      if (motivo === '01') {
        p.remove();
        if (enOrden) { ORD.extra = null; return cargarOrden({ id: ORD.id, estatus: 'ganado' }, { sustituye_a: f.id }).then(() => $('cfdi-orden').querySelector('.fx-preparar')?.scrollIntoView({ block: 'start' })); }
        return abrirFicha(Number(f.lead_id)).then(() => toast('Para sustituirla: en «Factura electrónica» pulsa «Cancelar», elige 01 y timbra la nueva factura')); // sin HTML
      }
      ok.disabled = true;
      await pedirCancelacion(f, motivo, null, enOrden);
    });
  }
  async function pedirCancelacion(f, motivo, sustituta, enOrden) {
    const pago = f.tipo_documento === 'pago', folioS = sustituta ? (sustituta.serie || '') + '-' + (sustituta.folio || '') : '';
    const texto = { '01': pago ? `corregido por el ${folioS}` : `sustituida por la ${folioS}`, '02': pago ? 'el pago no debió registrarse' : 'tiene errores y no se sustituye', '03': 'el servicio no se llevó a cabo' }[motivo];
    if (!await solicitarDialogo({ titulo: (f.entorno === 'prod' ? 'Cancelar ' : 'Cancelar ') + (pago ? 'complemento de pago' : 'factura') + (f.entorno === 'prod' ? ' ante el SAT' : ' de PRUEBA'), aceptar: 'Sí, cancelar',
      mensaje: `${pago ? 'Complemento de pago' : 'Factura'} ${f.serie || ''}-${f.folio || ''} · motivo ${motivo}: ${texto}.\n\n${f.entorno === 'prod' ? 'No se puede deshacer. ' : ''}Se da por cancelada solo cuando el SAT lo confirma; si el cliente tiene que aceptarla, puede tardar.` })) return false;
    const r = await pedirCompleto('/facturas/' + Number(f.id) + '/cancelar', { motivo, sustituta_id: sustituta?.id }, 'POST');
    toast(r.ok ? (r.j.estado === 'cancelada' ? 'Factura cancelada ante el SAT' : r.j.mensaje || 'Cancelación en proceso') : (r.j.error || 'No se pudo cancelar')); // sin HTML
    if (enOrden && ORD) { ORD.opciones = { ...ORD.opciones, sustituye_a: undefined }; await cargarOrden({ id: ORD.id, estatus: 'ganado' }, ORD.opciones); if (typeof Finanzas !== 'undefined' && f.entorno === 'prod') Finanzas.pintarCobranzaOrden({ id: ORD.id, estatus: 'ganado' }); }
    else cargarLista();
    return r.ok;
  }
  async function accionTarjeta(e, f, enOrden, recargar) {
    const tarjeta = e.target.closest('[data-fx-factura]');
    if (e.target.closest('[data-fx-cancelar]')) {
      if (f.sustituta) return pedirCancelacion(f, '01', f.sustituta, enOrden);
      return panelCancelar(tarjeta, f, enOrden);
    }
    if (e.target.closest('[data-fx-reintentar]')) {
      if (!await solicitarDialogo({ titulo: 'Volver a pedir la cancelación', aceptar: 'Sí, volver a pedirla', mensaje: 'Se manda otra vez la misma solicitud (mismo motivo). Úsalo solo si después de una hora el SAT sigue sin reportarla: repetirla no duplica nada.' })) return null;
      const r = await pedirCompleto('/facturas/' + Number(f.id) + '/cancelar', { reintentar: true }, 'POST');
      toast(r.ok ? (r.j.estado === 'cancelada' ? 'Factura cancelada ante el SAT' : r.j.mensaje || 'Cancelación en proceso') : (r.j.error || 'No se pudo')); // sin HTML
      return recargar();
    }
    const rev = e.target.closest('[data-fx-revisada]');
    if (rev) {
      if (!await solicitarDialogo({ titulo: 'Dar por revisada', aceptar: 'Sí, ya la revisé', mensaje: `${f.revisar}.\n\n¿Ya revisaste esta diferencia contra el XML? El aviso de Inicio deja de salir; la nota y el total calculado se conservan.` })) return null;
      rev.disabled = true;
      const r = await pedirCompleto('/facturas/' + Number(f.id) + '/revisada', {}, 'POST');
      toast(r.ok ? 'Marcada como revisada' : (r.j.error || 'No se pudo')); // sin HTML
      return recargar();
    }
    const est = e.target.closest('[data-fx-estatus]');
    if (est) {
      est.disabled = true;
      const r = await pedirCompleto('/facturas/' + Number(f.id) + '/estatus-cancelacion', {}, 'POST');
      toast(r.ok ? (r.j.estado === 'cancelada' ? 'El SAT confirmó la cancelación' : r.j.mensaje || 'Sigue en proceso') : (r.j.error || 'No se pudo consultar')); // sin HTML
      if (r.ok && enOrden && typeof Finanzas !== 'undefined' && f.entorno === 'prod') Finanzas.pintarCobranzaOrden({ id: ORD.id, estatus: 'ganado' });
      return recargar();
    }
    return null;
  }
  // lista = true: la tarjeta de la pantalla «Facturas» (con la orden y las acciones de reenviar y descartar).
  function tarjetaFactura(f, lista = false) {
    const [txt, clase] = f.descartada ? ['Borrador descartado', 'fx-inactivo'] : (ESTADOS[f.estatus] || [f.estatus, '']);
    const prueba = f.entorno !== 'prod' ? `<span class="fx-badge fx-sandbox">${f.entorno === 'demo' ? 'DEMO' : 'PRUEBA'}</span>` : '';
    return `<div class="fx-factura" data-fx-factura="${Number(f.id)}">
      <div>${f.tipo_documento === 'pago' ? 'Complemento de pago ' : ''}<b>${esc(f.serie || '')}${f.folio ? '-' + esc(f.folio) : (f.serie ? '' : 'Sin folio')}</b> ${prueba} <span class="${clase}">${esc(txt)}</span>${f.tipo_documento === 'pago' ? '' : ' · ' + pesos(f.total)}
        <small>${esc(f.receptor_razon_social)} · ${esc(f.receptor_rfc)} · ${esc(f.forma_pago || '')} ${esc(f.metodo_pago || '')}${f.uuid ? ' · Folio fiscal ' + esc(f.uuid) : ''}${f.fecha_timbrado ? ' · ' + esc(String(f.fecha_timbrado).replace('T', ' ').slice(0, 16)) : ''}</small>
        ${f.error && f.estatus !== 'timbrada' ? `<small class="fx-mal">${esc(f.error)}</small>` : ''}
        ${f.revisar ? `<small class="fx-mal">Revisar: ${esc(f.revisar)}</small>` : ''}
        ${f.motivo_cancelacion ? `<small>Motivo de cancelación ${esc(f.motivo_cancelacion)}${f.cancelacion_estado ? ' · SAT: ' + esc(f.cancelacion_estado) : ''}</small>` : ''}
        ${f.sustituta ? `<small class="fx-mal">Ya se timbró ${f.tipo_documento === 'pago' ? 'el complemento que lo corrige' : 'la que la sustituye'} (${esc(f.sustituta.serie || '')}-${esc(f.sustituta.folio || '')}): falta cancelar ${f.tipo_documento === 'pago' ? 'este' : 'esta'} con el motivo 01</small>` : ''}
        ${f.sustituye_a ? `<small>${f.tipo_documento === 'pago' ? 'Corrige a otro complemento de este pago' : 'Sustituye a otra factura de esta orden'} (motivo 01)</small>` : ''}
      </div>
      <div class="btn-group">
        ${f.tiene_xml || (f.estatus === 'timbrada' && f.entorno !== 'demo') ? `<button type="button" class="btn btn-outline" data-fx-bajar="xml">XML</button>` : ''}
        ${f.estatus === 'timbrada' && (f.tiene_pdf || f.entorno !== 'demo') ? `<button type="button" class="btn btn-outline" data-fx-bajar="pdf">PDF</button>` : ''}
        ${f.estatus === 'timbrando' ? '<button type="button" class="btn btn-secundario" data-fx-verificar>Verificar</button>' : ''}
        ${f.estatus === 'timbrada' ? `<button type="button" class="btn btn-outline" data-fx-cancelar>${f.sustituta ? 'Cancelar (motivo 01)' : 'Cancelar'}</button>` : ''}
        ${f.estatus === 'cancelacion_solicitada' && f.entorno !== 'demo' ? '<button type="button" class="btn btn-secundario" data-fx-estatus>Consultar estatus</button><button type="button" class="btn btn-outline" data-fx-reintentar>Volver a pedir la cancelación</button>' : ''}
        ${f.tiene_acuse ? '<button type="button" class="btn btn-outline" data-fx-bajar="acuse">Acuse</button>' : ''}
        ${f.revisar ? '<button type="button" class="btn btn-outline" data-fx-revisada>Ya la revisé</button>' : ''}
        ${lista && f.puede_reenviar ? '<button type="button" class="btn btn-outline" data-fx-reenviar>✉️ Reenviar</button>' : ''}
        ${lista && f.puede_descartar ? '<button type="button" class="btn btn-outline solo-general" data-fx-descartar>Descartar borrador</button>' : ''}
        ${lista && f.lead_id ? `<button type="button" class="btn btn-outline" data-fx-orden="${Number(f.lead_id)}">Abrir ${esc(f.folio_orden || 'orden')}</button>` : ''}
      </div>
    </div>`;
  }
  function pintarOrden() {
    const o = ORD, p = o.preparacion, cont = $('cfdi-orden');
    const timbrada = o.facturas.some(f => f.tipo_documento !== 'pago' && f.entorno === o.entorno && ['timbrada', 'cancelacion_solicitada'].includes(f.estatus));
    const sust = Number(o.opciones.sustituye_a) || 0, original = sust ? o.facturas.find(f => f.id === sust) : null;
    const mostrarForm = p && (sust ? !!original && original.estatus === 'timbrada' && !o.facturas.some(f => f.sustituye_a === sust && f.estatus === 'timbrada') : !timbrada);
    const banda = o.prueba ? `<p class="fx-demo ayuda">🧪 ${o.entorno === 'demo' ? 'Demo: la factura se SIMULA (no se conecta con factura.com).' : 'Conexión de PRUEBAS (sandbox): la factura no tiene validez fiscal y no cambia la cobranza de la orden.'}</p>` : '';
    const tarjetas = o.facturas.map(f => tarjetaFactura(f)).join(''); // cada tarjeta escapa lo suyo
    const lista = o.facturas.length ? `<div class="fx-facturas">${tarjetas}</div>` : '<p class="util-45">Esta orden todavía no tiene factura electrónica.</p>';
    let form = '';
    if (mostrarForm) {
      const r = p.resumen, op = o.opciones;
      const fiscales = p.fiscales.length ? `<select data-fx-o="cliente_fiscal_id">${p.fiscales.map(f => `<option value="${Number(f.id)}"${r.receptor && r.receptor.id === f.id ? ' selected' : ''}>${esc(f.razon_social || 'Sin razón social')} · ${esc(f.rfc)}${f.listo ? '' : ' (incompletos)'}</option>`).join('')}</select>` : '<span class="fx-mal">Sin datos fiscales (captúralos en la ficha del cliente)</span>';
      const usos = `<select data-fx-o="uso_cfdi"><option value="">— elige —</option>${p.usos.map(u => `<option value="${esc(u.clave)}"${u.clave === r.uso_cfdi ? ' selected' : ''}>${esc(u.clave)} · ${esc(u.nombre)}</option>`).join('')}</select>`;
      const elegido = r.metodo_pago, sugerido = r.metodo_sugerido; // PUE o PPD: textos fijos
      const metodos = `<select data-fx-o="metodo_pago">${[['PUE', 'PUE · pago en una sola exhibición'], ['PPD', 'PPD · a crédito o en parcialidades']].map(([c, t]) => `<option value="${c}"${c === elegido ? ' selected' : ''}>${t}${c === sugerido ? ' (sugerido)' : ''}</option>`).join('')}</select>`;
      const formas = r.metodo_pago === 'PPD' ? '<select data-fx-o="forma_pago" disabled><option value="99">99 · Por definir</option></select>' : `<select data-fx-o="forma_pago"><option value="">— elige cómo pagó o pagará —</option>${p.formas_pago.map(f => `<option value="${esc(f.clave)}"${f.clave === r.forma_pago ? ' selected' : ''}>${esc(f.clave)} · ${esc(f.nombre)}</option>`).join('')}</select>`;
      const filas = r.conceptos.map(c => `<tr><td>${esc(c.descripcion)}<small>${esc(c.clave_prod_serv)} · ${esc(c.clave_unidad)} ${esc(c.unidad)}</small></td><td class="num">${esc(Number(c.cantidad).toString())}</td><td class="num">${pesos(Number(c.valor_unitario))}</td><td class="num">${pesos(Number(c.importe))}</td></tr>`).join('');
      const totales = r.total_cent != null ? `<tr><th colspan="3">Subtotal</th><td class="num">${pesos(r.subtotal_cent / 100)}</td></tr><tr><th colspan="3">IVA ${Number(r.tasa)} % trasladado</th><td class="num">${pesos(r.iva_cent / 100)}</td></tr><tr><th colspan="3">Total</th><td class="num"><b>${pesos(r.total_cent / 100)}</b></td></tr>` : '';
      const correo = r.receptor?.correo ? ' (' + esc(r.receptor.correo) + ')' : '';
      const casillaCorreo = o.entorno === 'prod' ? `<label class="fx-check"><input type="checkbox" data-fx-o="enviar_correo"${op.enviar_correo === '0' ? '' : ' checked'}> Enviar la factura al correo del cliente${correo}</label>` : '';
      form = `<div class="fx-preparar">
        <h4>${original ? `Factura que SUSTITUYE a la ${esc(original.serie || '')}-${esc(original.folio || '')} (motivo 01)` : 'Nueva factura'} · ${r.metodo_pago === 'PPD' ? 'PPD (a crédito o en parcialidades)' : 'PUE (pago en una sola exhibición)'}</h4>
        ${original ? '<p class="ayuda">Corrige lo que estaba mal (datos fiscales del cliente, partidas de la orden o forma de pago) y timbra. Después se cancela la original diciendo que esta la sustituye. <button type="button" class="btn btn-outline" data-fx-sin-sustituir>No sustituir</button></p>' : ''}
        <div class="fx-suc-campos">
          <label>Receptor (datos fiscales del cliente)${fiscales}</label>
          <label>Uso del CFDI${usos}</label>
          <label>Método de pago${metodos}</label>
          <label>Forma de pago${formas}</label>
          ${casillaCorreo}
        </div>
        <p class="ayuda">Serie ${esc(r.serie || '—')} · lugar de expedición ${esc(r.lugar_expedicion || '—')} · moneda MXN · orden ${esc(r.orden.folio)}</p>
        ${r.conceptos.length ? `<div class="tabla-scroll"><table class="fx-conceptos"><thead><tr><th>Concepto</th><th class="num">Cant.</th><th class="num">Valor unitario</th><th class="num">Importe</th></tr></thead><tbody>${filas}</tbody><tfoot>${totales}</tfoot></table></div>` : ''}
        ${r.metodo_pago === 'PPD' ? '<p class="ayuda">Con PPD, cada pago que haga el cliente necesita su <b>complemento de pago</b>: al confirmar el pago aparece aquí y en Inicio para timbrarlo (a más tardar el día 5 del mes siguiente al pago).</p>' : ''}
        ${p.errores.length ? `<div class="aviso-error-carga" role="alert"><b>Falta para poder timbrar:</b><ul>${p.errores.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
        ${p.avisos.map(a => `<p class="ayuda">⚠ ${esc(a)}</p>`).join('')}
        ${p.confirmar.length && !p.errores.length ? `<label class="fx-check fx-confirmar"><input type="checkbox" data-fx-confirmar> ${esc(p.confirmar.join(' '))}</label>` : ''}
        ${o.extra || ''}
        <button type="button" class="btn btn-primario" data-fx-timbrar ${p.errores.length ? 'disabled' : ''}>🧾 Timbrar factura${o.prueba ? ' de prueba' : ''}</button>
      </div>`;
    }
    cont.innerHTML = banda + lista + pagosPpd() + form;
  }
  // ---------- Complementos de pago de la factura PPD (F6, 2026-11-03) ----------
  // Los pagos confirmados de la factura PPD, con su complemento. Nada se timbra solo: «Timbrar complemento» abre el resumen y se confirma.
  const COMP_ESTADO = { pendiente: 'No se timbró: revisa el motivo', borrador_error: 'Quedó en borrador: corrige y vuelve a timbrar', timbrando: 'Sin respuesta: pulsa «Verificar» en su tarjeta', cancelada: 'Su complemento se canceló: timbra otro' };
  const fechaDMA = f => String(f || '').split('-').reverse().join('/');
  function pagosPpd() {
    const c = ORD.complementos; if (!c) return '';
    const totalF = pesos(c.factura.total_cent / 100), faltaF = pesos(c.factura.saldo_insoluto_cent / 100);
    const filas = c.pagos.map(k => `<tr><td>${esc(fechaDMA(k.fecha))}</td><td class="num">${pesos(k.monto_cent / 100)}</td><td>${esc(k.metodo)}</td><td>${k.amparado
      ? `✅ Complemento ${esc(k.complemento.serie || '')}-${esc(k.complemento.folio || '')} · parcialidad ${Number(k.complemento.num_parcialidad)}${k.complemento.estatus === 'cancelacion_solicitada' ? ' (cancelación en proceso)' : ''}${correccionPpd(k)}`
      : `<span class="${k.vencido ? 'fx-mal' : ''}">${esc(k.complemento ? COMP_ESTADO[k.complemento.estatus] || k.complemento.estatus : 'Sin complemento')} · límite ${esc(fechaDMA(k.fecha_limite))}${k.vencido ? ' (vencido)' : ''}</span>
         ${k.complemento?.estatus === 'timbrando' ? '' : `<button type="button" class="btn btn-secundario" data-fx-comp="${Number(k.cobro_id)}">Timbrar complemento</button>`}`}</td></tr>
      <tr hidden data-fx-comp-panel="${Number(k.cobro_id)}"><td colspan="4"></td></tr>`).join('');
    return `<div class="fx-preparar"><h4>Pagos de la factura ${esc(c.factura.serie || '')}-${esc(c.factura.folio || '')} (PPD) y sus complementos</h4>
      <p class="ayuda">Total de la factura ${totalF} · falta amparar con complementos ${faltaF}. Solo cuentan los pagos confirmados (un ajuste o descuento no lleva complemento).</p>
      ${c.pagos.length ? `<div class="tabla-scroll"><table class="fx-conceptos"><thead><tr><th>Fecha del pago</th><th class="num">Monto</th><th>Cómo pagó</th><th>Complemento</th></tr></thead><tbody>${filas}</tbody></table></div>` : '<p class="util-45">Todavía no hay pagos confirmados de esta factura.</p>'}</div>`;
  }
  // Corregir (2026-11-03): el pago sí ocurrió y su complemento salió con un dato mal → se timbra otro relacionado (04) y el anterior se cancela con 01.
  function correccionPpd(k) {
    if (k.corrige_a) return `<br><small class="fx-mal">Corrige al ${esc(k.corrige_a.serie || '')}-${esc(k.corrige_a.folio || '')}${k.corrige_a.estatus === 'cancelacion_solicitada' ? ', cuya cancelación sigue en proceso: consulta su estatus en su tarjeta' : ', que sigue vigente: cancélalo con el motivo 01 desde su tarjeta'}</small>`;
    const s = k.correccion;
    if (s && ['timbrada', 'cancelacion_solicitada'].includes(s.estatus)) return '';
    if (s && s.estatus === 'timbrando') return '<br><small class="fx-mal">Su corrección se quedó sin respuesta: pulsa «Verificar» en su tarjeta</small>';
    if (k.complemento.estatus !== 'timbrada') return '';
    return `${s ? `<br><small class="fx-mal">Su corrección ${s.estatus === 'borrador_error' ? 'quedó en borrador' : 'no se timbró'}: revisa el motivo y vuelve a intentar</small>` : ''}
      <button type="button" class="btn btn-outline" data-fx-comp="${Number(k.cobro_id)}" data-fx-comp-sust="${Number(k.complemento.id)}" title="El pago sí ocurrió, pero el complemento salió con un dato mal">Corregir</button>`;
  }
  async function abrirComplemento(cobroId, forma, sustituye) {
    const fila = $('cfdi-orden').querySelector(`[data-fx-comp-panel="${Number(cobroId)}"]`); if (!fila) return;
    const celda = fila.firstElementChild; fila.hidden = false; celda.innerHTML = '<p class="util-45" role="status">Revisando…</p>';
    const q = new URLSearchParams(Object.entries({ forma_pago: forma, sustituye_a: sustituye }).filter(([, v]) => v)).toString();
    const r = await pedirCompleto('/complementos/cobros/' + Number(cobroId) + (q ? '?' + q : ''));
    if (!r.ok) { celda.innerHTML = `<p class="aviso-error-carga" role="alert">${esc(r.j.error || 'No se pudo revisar el pago')}</p>`; return; }
    const p = r.j, s = p.resumen;
    const opciones = p.formas_pago.map(f => `<option value="${esc(f.clave)}"${f.clave === s.forma_pago ? ' selected' : ''}>${esc(f.clave)} · ${esc(f.nombre)}${f.clave === s.forma_sugerida ? ' (sugerida)' : (s.opciones || []).includes(f.clave) ? ' (posible)' : ''}</option>`).join('');
    celda.innerHTML = `<div class="fx-cancelar-panel" data-fx-comp-form="${Number(cobroId)}">
      ${s.sustituye ? `<p><b>Corrección del complemento ${esc(s.sustituye.serie || '')}-${esc(s.sustituye.folio || '')}</b> (su forma de pago era «${esc(s.sustituye.forma_pago || "—")}»). El nuevo se relaciona con el anterior (sustitución) y conserva su parcialidad y saldos; después se cancela el anterior con el motivo 01. Si lo que estaba mal es la fecha o la referencia del pago, corrígela primero en Finanzas.</p>` : ''}
      <p><b>Complemento de pago${s.prueba ? ' de PRUEBA' : ''}</b> · parcialidad ${Number(s.num_parcialidad) || '—'} · saldo anterior ${s.saldo_anterior_cent != null ? pesos(s.saldo_anterior_cent / 100) : '—'} · pagado ${pesos(s.cobro.monto_cent / 100)} · queda ${s.saldo_insoluto_cent != null ? pesos(s.saldo_insoluto_cent / 100) : '—'}</p>
      <p class="ayuda">IVA del pago: base ${esc(s.base || '—')} · IVA ${esc(s.iva || '—')} (${Number(s.tasa) || 0} %) · serie ${esc(s.serie || '—')} · fecha del pago ${esc(fechaDMA(s.cobro.fecha))}${s.cobro.referencia ? ' · referencia ' + esc(s.cobro.referencia) : ''}</p>
      <div class="fx-suc-campos"><label>Forma de pago (cómo pagó el cliente: «${esc(s.cobro.metodo)}»)<select data-fx-comp-forma><option value="">— elige —</option>${opciones}</select></label></div>
      ${p.errores.length ? `<div class="aviso-error-carga" role="alert"><b>Falta para poder timbrar:</b><ul>${p.errores.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
      ${p.avisos.map(a => `<p class="ayuda">⚠ ${esc(a)}</p>`).join('')}
      ${p.confirmar.length && !p.errores.length ? `<label class="fx-check fx-confirmar"><input type="checkbox" data-fx-comp-confirmar> ${esc(p.confirmar.join(' '))}</label>` : ''}
      <div class="btn-group"><button type="button" class="btn btn-primario" data-fx-comp-timbrar="${Number(cobroId)}" ${p.errores.length ? 'disabled' : ''}>🧾 Timbrar complemento${s.prueba ? ' de prueba' : ''}</button><button type="button" class="btn btn-outline" data-fx-comp-cerrar>Cerrar</button></div></div>`;
    celda.querySelector('[data-fx-comp-forma]').addEventListener('change', e => abrirComplemento(cobroId, e.target.value, sustituye));
    celda.querySelector('[data-fx-comp-cerrar]').addEventListener('click', () => { fila.hidden = true; celda.innerHTML = ''; });
    celda.querySelector('[data-fx-comp-timbrar]').addEventListener('click', async e => {
      if (timbrando) return;
      const conf = celda.querySelector('[data-fx-comp-confirmar]');
      if (conf && !conf.checked) { toast('Marca la casilla para continuar'); conf.focus(); return; }
      const forma = celda.querySelector('[data-fx-comp-forma]').value;
      if (!await solicitarDialogo({ titulo: s.prueba ? 'Timbrar complemento de PRUEBA' : 'Timbrar complemento de pago', aceptar: 'Sí, timbrar',
        mensaje: `${s.prueba ? 'PRUEBA sin validez fiscal.\n\n' : 'Este complemento tiene validez fiscal ante el SAT y no se puede borrar (solo cancelar).\n\n'}${s.sustituye ? `Corrige al complemento ${s.sustituye.serie || ''}-${s.sustituye.folio || ''} (después se cancela con el motivo 01).\n` : ''}Factura ${s.factura.serie || ''}-${s.factura.folio || ''} · parcialidad ${s.num_parcialidad}\nPago de ${pesos(s.cobro.monto_cent / 100)} del ${fechaDMA(s.cobro.fecha)} · forma ${forma}\nQueda por pagar: ${pesos(s.saldo_insoluto_cent / 100)}` })) return;
      timbrando = true; e.target.disabled = true; e.target.textContent = 'Timbrando… (puede tardar hasta un minuto)';
      try {
        const t = await pedirCompleto('/complementos/cobros/' + Number(cobroId) + '/timbrar', { forma_pago: forma, confirmar: !!conf?.checked, sustituye_a: sustituye || undefined }, 'POST');
        if (t.ok) { toast(t.j.estado === 'timbrada' ? `Complemento ${t.j.factura.serie || ''}-${t.j.factura.folio || ''} timbrado` : (t.j.mensaje || 'No se timbró')); for (const a of t.j.avisos || []) toast(a); } // sin HTML
        else if (t.status >= 500 || !t.j.error) toast('No se sabe si quedó timbrado (el servidor no contestó a tiempo). Espera un minuto y vuelve a abrir la orden: no lo mandes otra vez sin revisar.'); // sin HTML
        else toast(t.j.error);
        await cargarOrden({ id: ORD.id, estatus: 'ganado' }, ORD.opciones);
        // Corrección timbrada: ahora se cancela el anterior con el motivo 01 (si se dice que no, queda «Cancelar (motivo 01)» en su tarjeta).
        const orig = sustituye && t.ok && t.j.estado === 'timbrada' ? ORD.facturas.find(x => x.id === Number(sustituye)) : null;
        if (orig) await pedirCancelacion(orig, '01', t.j.factura, true);
      } finally { timbrando = false; }
    });
  }
  const opcionesForm = () => {
    const cont = $('cfdi-orden'), v = k => cont.querySelector(`[data-fx-o="${k}"]`);
    return { sustituye_a: ORD?.opciones?.sustituye_a, cliente_fiscal_id: v('cliente_fiscal_id')?.value, uso_cfdi: v('uso_cfdi')?.value, metodo_pago: v('metodo_pago')?.value, forma_pago: v('metodo_pago')?.value === 'PPD' ? undefined : v('forma_pago')?.value, enviar_correo: v('enviar_correo') ? (v('enviar_correo').checked ? '1' : '0') : undefined };
  };
  $('cfdi-orden')?.addEventListener('change', e => {
    if (!ORD || !e.target.closest('[data-fx-o]')) return;
    const op = opcionesForm();
    if (e.target.dataset.fxO === 'cliente_fiscal_id') op.uso_cfdi = ''; // otro receptor: su uso predeterminado
    if (e.target.dataset.fxO === 'metodo_pago') op.forma_pago = ''; // de PPD (99) a PUE: se elige la forma real
    ORD.extra = null; cargarOrden({ id: ORD.id, estatus: 'ganado' }, op);
  });
  $('cfdi-orden')?.addEventListener('click', async e => {
    if (!ORD) return;
    const bajar = e.target.closest('[data-fx-bajar]');
    if (bajar) { await bajarArchivo(bajar, bajar.closest('[data-fx-factura]').dataset.fxFactura, bajar.dataset.fxBajar); return; }
    const comp = e.target.closest('[data-fx-comp]'); if (comp) return abrirComplemento(comp.dataset.fxComp, null, comp.dataset.fxCompSust);
    if (e.target.closest('[data-fx-sin-sustituir]')) { ORD.opciones = { ...ORD.opciones, sustituye_a: undefined }; return cargarOrden({ id: ORD.id, estatus: 'ganado' }, ORD.opciones); }
    const tarjetaOrden = e.target.closest('[data-fx-factura]');
    if (tarjetaOrden && e.target.closest('[data-fx-cancelar],[data-fx-estatus],[data-fx-reintentar],[data-fx-revisada]')) { const f = ORD.facturas.find(x => x.id === Number(tarjetaOrden.dataset.fxFactura)); if (f) return accionTarjeta(e, f, true, () => cargarOrden({ id: ORD.id, estatus: 'ganado' }, ORD.opciones)); }
    const ver = e.target.closest('[data-fx-verificar]');
    if (ver) {
      ver.disabled = true;
      const r = await pedirCompleto('/facturas/' + Number(ver.closest('[data-fx-factura]').dataset.fxFactura) + '/verificar', {}, 'POST');
      toast(r.ok ? (r.j.mensaje || (r.j.estado === 'timbrada' ? 'Sí quedó timbrada' : 'Estado: ' + r.j.estado)) : (r.j.error || 'No se pudo verificar'));
      return cargarOrden({ id: ORD.id, estatus: 'ganado' }, ORD.opciones);
    }
    const vincular = e.target.closest('[data-fx-vincular]');
    if (vincular) {
      vincular.disabled = true;
      const r = await pedirCompleto('/fiscales/' + Number(vincular.dataset.fxFiscal) + '/vincular', { uid: vincular.dataset.fxVincular }, 'POST');
      toast(r.ok ? 'Listo: ya puedes timbrar' : (r.j.error || 'No se pudo')); ORD.extra = null;
      return cargarOrden({ id: ORD.id, estatus: 'ganado' }, ORD.opciones);
    }
    const btn = e.target.closest('[data-fx-timbrar]'); if (!btn || timbrando) return;
    const r0 = ORD.preparacion.resumen, conf = $('cfdi-orden').querySelector('[data-fx-confirmar]');
    if (conf && !conf.checked) { toast('Marca la casilla para continuar'); conf.focus(); return; }
    const ok = await solicitarDialogo({ titulo: ORD.prueba ? 'Timbrar factura de PRUEBA' : 'Timbrar factura', aceptar: 'Sí, timbrar',
      mensaje: `${ORD.prueba ? 'PRUEBA sin validez fiscal.\n\n' : 'Esta factura tiene validez fiscal ante el SAT y no se puede borrar (solo cancelar).\n\n'}Receptor: ${r0.receptor.razon_social} (${r0.receptor.rfc})\nTotal: ${pesos(r0.total_cent / 100)} · ${r0.forma_pago} · ${r0.metodo_pago} · uso ${r0.uso_cfdi}` });
    if (!ok) return;
    timbrando = true; btn.disabled = true; btn.textContent = 'Timbrando… (puede tardar hasta un minuto)';
    try {
      const r = await pedirCompleto('/ordenes/' + ORD.id + '/timbrar', { ...opcionesForm(), confirmar: !!conf?.checked }, 'POST');
      const sustituida = Number(ORD.opciones.sustituye_a) || 0;
      if (r.ok) {
        ORD.extra = null;
        toast(r.j.estado === 'timbrada' ? `Factura ${r.j.factura.serie || ''}-${r.j.factura.folio || ''} timbrada` : (r.j.mensaje || 'No se timbró')); // sin HTML
        for (const a of r.j.avisos || []) toast(a);
      } else if (r.j.codigo === 'CLIENTE_EXISTE') {
        ORD.extra = `<div class="cuentas-aviso"><p>${esc(r.j.error)}</p>${r.j.candidatos.map(c => `<p>${esc(c.razon_social)} · CP ${esc(c.cp)} · régimen ${esc(c.regimen)} <button type="button" class="btn btn-outline" data-fx-vincular="${esc(c.uid)}" data-fx-fiscal="${Number(r.j.cliente_fiscal_id)}">Es este</button></p>`).join('')}</div>`;
      } else if (r.status >= 500 || !r.j.error) toast('No se sabe si quedó timbrada (el servidor no contestó a tiempo). Espera un minuto y vuelve a abrir la orden: no la mandes otra vez sin revisar.'); // sin HTML
      else toast(r.j.error);
      await cargarOrden({ id: ORD.id, estatus: 'ganado' }, ORD.opciones);
      if (r.ok && typeof Finanzas !== 'undefined' && r.j.factura?.entorno === 'prod') Finanzas.pintarCobranzaOrden({ id: ORD.id, estatus: 'ganado' });
      // Sustitución: ya está la nueva; ahora se cancela la original con el motivo 01 (si se dice que no, queda el botón «Cancelar (motivo 01)» en su tarjeta).
      const orig = sustituida && r.ok && r.j.estado === 'timbrada' ? ORD.facturas.find(x => x.id === sustituida) : null;
      if (orig) await pedirCancelacion(orig, '01', r.j.factura, true);
    } finally { timbrando = false; }
  });

  // ---------- Pantalla «Facturas» (F4, 2026-10-28) ----------
  let tLista = null, LISTA_OK = false, LISTA_F = [];
  const filtrosLista = () => ({ q: $('fx-l-q').value.trim(), estatus: $('fx-l-estatus').value, entorno: $('fx-l-entorno').value, sucursal: $('fx-l-sucursal').value, desde: $('fx-l-desde').value, hasta: $('fx-l-hasta').value });
  async function cargarLista() {
    const cont = $('fx-l-lista'); if (!cont) return;
    if (typeof Permisos !== 'undefined' && !Permisos.puede('facturacion.timbrar')) { cont.innerHTML = ''; return; }
    const f = filtrosLista(), q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    const turno = ++TURNO_LISTA;
    let r;
    try { r = await pedir('/facturas' + (q ? '?' + q : '')); }
    catch (e) { if (turno === TURNO_LISTA) cont.innerHTML = `<p class="aviso-error-carga" role="alert">${esc(e.message)}</p>`; return; }
    if (turno !== TURNO_LISTA) return; // llegó una búsqueda más nueva
    if (!LISTA_OK) { $('fx-l-sucursal').innerHTML = '<option value="">Todas las sucursales</option>' + r.sucursales.map(x => `<option value="${Number(x.id)}">${esc(x.nombre)}</option>`).join(''); LISTA_OK = true; }
    $('fx-lista-entorno').textContent = r.entorno === 'prod' ? 'Conexión en PRODUCCIÓN: las facturas nuevas tienen validez fiscal.' : r.entorno === 'demo' ? 'Demo: las facturas se simulan.' : 'Conexión de PRUEBAS (sandbox): las facturas nuevas no tienen validez fiscal.';
    $('fx-l-resumen').textContent = r.total ? `${r.total} factura(s)${r.truncado ? ' (se muestran las 200 más recientes: afina la búsqueda)' : ''}` : '';
    LISTA_F = r.facturas;
    cont.innerHTML = r.facturas.length ? r.facturas.map(x => tarjetaFactura(x, true)).join('') : '<p class="util-45">No hay facturas con esos filtros.</p>';
  }
  let TURNO_LISTA = 0;
  for (const id of ['fx-l-estatus', 'fx-l-entorno', 'fx-l-sucursal', 'fx-l-desde', 'fx-l-hasta']) $(id)?.addEventListener('change', cargarLista);
  // Descarga a Excel con los filtros de la pantalla. Los importes van como números (en pesos) para poder sumarlos; todo texto va como texto.
  const ESTATUS_EXCEL = { pendiente: 'Pendiente', timbrando: 'Sin respuesta', timbrada: 'Timbrada', borrador_error: 'Borrador con error', cancelacion_solicitada: 'Cancelación en proceso', cancelada: 'Cancelada' };
  $('fx-l-excel')?.addEventListener('click', async e => {
    const b = e.currentTarget; if (b.disabled) return; b.disabled = true;
    try {
      const ExcelJS = await Finanzas.cargarExcelJS();
      const q = new URLSearchParams(Object.entries(filtrosLista()).filter(([, v]) => v)).toString();
      const d = await pedir('/facturas/exportar' + (q ? '?' + q : ''));
      if (!d.filas.length) { toast('No hay facturas con esos filtros'); return; }
      const wb = new ExcelJS.Workbook(); wb.creator = 'Saneadren CRM';
      const ws = wb.addWorksheet('Facturas', { views: [{ state: 'frozen', ySplit: 1 }] });
      const COLS = [['Tipo', 20, 'tipo'], ['Folio', 12, 'folio'], ['Fecha', 12, 'fecha'], ['Orden', 22, 'orden'], ['Cliente', 34, 'cliente'], ['RFC', 16, 'rfc'], ['Subtotal', 14, 'subtotal_cent', 1], ['IVA', 14, 'iva_cent', 1],
        ['Total', 14, 'total_cent', 1], ['Método de pago', 12, 'metodo_pago'], ['Forma de pago', 12, 'forma_pago'], ['Estatus', 22, 'estatus', 2], ['Motivo de cancelación', 12, 'motivo_cancelacion'], ['Real o de prueba', 14, 'entorno'],
        ['Sucursal', 16, 'sucursal'], ['Folio fiscal (UUID)', 38, 'uuid']];
      ws.columns = COLS.map(([titulo, ancho]) => ({ header: titulo, width: ancho }));
      ws.getRow(1).font = { bold: true };
      for (const f of d.filas) ws.addRow(COLS.map(([, , k, t]) => (t === 1 ? Number(f[k]) / 100 : t === 2 ? ESTATUS_EXCEL[f[k]] || f[k] : String(f[k] ?? ''))));
      COLS.forEach(([, , , t], i) => { if (t === 1) ws.getColumn(i + 1).numFmt = '#,##0.00'; });
      const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City' }).format(new Date());
      saveAs(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `facturas_saneadren_${hoy}.xlsx`);
      toast(d.truncado ? 'Excel descargado (solo las 1,000 más recientes: afina los filtros)' : `Excel descargado: ${d.total} fila(s)`);
    } catch (err) { toast(err.message); } finally { b.disabled = false; }
  });
  $('fx-l-q')?.addEventListener('input', () => { clearTimeout(tLista); tLista = setTimeout(cargarLista, 300); });
  $('fx-l-lista')?.addEventListener('click', async e => {
    const tarjeta = e.target.closest('[data-fx-factura]'); if (!tarjeta) return;
    const fid = Number(tarjeta.dataset.fxFactura);
    const bajar = e.target.closest('[data-fx-bajar]'); if (bajar) return bajarArchivo(bajar, fid, bajar.dataset.fxBajar);
    const orden = e.target.closest('[data-fx-orden]'); if (orden) return abrirFicha(Number(orden.dataset.fxOrden));
    const fl = LISTA_F.find(x => x.id === fid);
    if (fl && e.target.closest('[data-fx-cancelar],[data-fx-estatus],[data-fx-reintentar],[data-fx-revisada]')) return accionTarjeta(e, fl, false, cargarLista);
    const ver = e.target.closest('[data-fx-verificar]');
    if (ver) { ver.disabled = true; const r = await pedirCompleto('/facturas/' + fid + '/verificar', {}, 'POST'); toast(r.ok ? (r.j.mensaje || (r.j.estado === 'timbrada' ? 'Sí quedó timbrada' : 'Estado: ' + r.j.estado)) : (r.j.error || 'No se pudo verificar')); return cargarLista(); }
    const reenviar = e.target.closest('[data-fx-reenviar]');
    if (reenviar) {
      if (!await solicitarDialogo({ titulo: 'Reenviar factura', aceptar: 'Sí, reenviar', mensaje: 'Se manda otra vez la factura (XML y PDF) al correo que tiene registrado el cliente en factura.com.' })) return;
      reenviar.disabled = true; const r = await pedirCompleto('/facturas/' + fid + '/reenviar', {}, 'POST'); toast(r.ok ? r.j.mensaje : (r.j.error || 'No se pudo reenviar')); reenviar.disabled = false; return;
    }
    const descartar = e.target.closest('[data-fx-descartar]');
    if (descartar) {
      if (!await solicitarDialogo({ titulo: 'Descartar borrador', aceptar: 'Sí, descartar', mensaje: 'El borrador se borra en factura.com y la orden queda libre para empezar una factura nueva. Una factura ya timbrada nunca se descarta.' })) return;
      descartar.disabled = true; const r = await pedirCompleto('/facturas/' + fid + '/descartar', {}, 'POST'); toast(r.ok ? 'Borrador descartado' : (r.j.error || 'No se pudo descartar')); return cargarLista();
    }
  });

  // ---------- Bloque «Facturación» de Inicio ----------
  const TAG_FX = { complemento_pendiente: '💳 Complemento de pago', timbrando: '⏳ Sin respuesta', borrador_error: '📝 Borrador', pendiente: '⚠️ No se timbró', por_facturar: '🧾 Por facturar', sin_cancelar: '⚠️ Sin cancelar', cancelacion_solicitada: '⏳ Cancelación', revisar: '🔎 Revisar total' };
  async function pintarInicio() {
    const cont = $('inicio-facturacion'); if (!cont || (typeof Permisos !== 'undefined' && !Permisos.puede('facturacion.timbrar'))) return;
    let r;
    try { r = await pedir('/avisos'); } catch (e) { cont.innerHTML = `<div class="aviso-error-carga" role="alert"><p>${esc(e.message)}</p></div>`; return; }
    const clase = n => (n === 'rojo' ? 'vencido' : n === 'azul' ? 'tipo-alerta' : 'tipo-recompra'), tag = n => (n === 'rojo' ? 'rojo' : n === 'azul' ? 'alerta' : 'recompra');
    cont.innerHTML = r.avisos.length ? r.avisos.map(a => `<div class="fila-alerta ${clase(a.nivel)}">
        <div class="info"><span class="tipo-tag ${tag(a.nivel)}">${esc(TAG_FX[a.tipo] || a.tipo)}</span>
          <div><b>${esc(a.folio || '')}</b> · ${esc(a.nombre || '')}</div><div class="txt">${esc(a.texto)}</div>${a.fecha ? `<div class="fecha">${a.tipo === 'complemento_pendiente' ? 'Pago del' : 'Realizada el'} ${esc(String(a.fecha).split('-').reverse().join('/'))}</div>` : ''}</div>
        <div class="util-46"><button type="button" class="btn btn-outline" data-fx-inicio-orden="${Number(a.lead_id)}">Abrir orden</button></div></div>`).join('') + (r.por_facturar_total > 15 ? `<p class="ayuda">Y ${Number(r.por_facturar_total) - 15} orden(es) más por facturar.</p>` : '')
        + (r.por_facturar_viejas ? `<p class="ayuda">⚠ Además, ${Number(r.por_facturar_viejas)} orden(es) realizadas hace más de 60 días siguen sin factura.</p>` : '')
      : '<p class="util-45">Nada pendiente de facturar. 🎉</p>';
  }
  $('inicio-facturacion')?.addEventListener('click', e => { const b = e.target.closest('[data-fx-inicio-orden]'); if (b) abrirFicha(Number(b.dataset.fxInicioOrden)); });

  return { cargar, cargarCliente, cargarOrden, cargarLista, pintarInicio };
})();
window.Facturacion = Facturacion;
