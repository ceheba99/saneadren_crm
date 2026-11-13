/* Conciliación bancaria (módulo contable F4, 2026-11-11). Servidor: server/conciliacion.js.
   Pestaña «Conciliación» de Contabilidad: cuentas de banco, subir el estado de cuenta (Excel o CSV del portal; la persona
   elige qué columna es cada cosa y se recuerda por cuenta), y las listas de conciliados, lo del banco que no está en el
   CRM y lo del CRM que no está en el banco. El servidor empareja; aquí solo se manda lo que se elige.
   Todo dato se escapa con escaparHtml y los botones usan data-*, sin onclick en línea. */
const Conciliacion = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t);
  const dinero = v => formatoMoneda(Number(v || 0));
  const fecha = f => (/^\d{4}-\d{2}-\d{2}/.test(f || '') ? f.slice(0, 10).split('-').reverse().join('/') : '');
  const TIPO = { cobro: 'Cobro', pago: 'Pago', anticipo: 'Anticipo', reintegro: 'Reintegro' };
  const CAMPOS = [['fecha', 'Fecha (obligatorio)'], ['concepto', 'Concepto'], ['referencia', 'Referencia'], ['cargo', 'Cargo / retiro'], ['abono', 'Abono / depósito'], ['importe', 'Importe con signo (si no hay cargo y abono)'], ['saldo', 'Saldo']];
  // Para adivinar la columna por su encabezado (la persona la corrige si hace falta).
  const PISTAS = { fecha: /fecha|date/i, concepto: /concepto|descrip/i, referencia: /referencia|ref\b|folio/i, cargo: /cargo|retiro|debe/i, abono: /abono|dep[oó]sito|haber/i, importe: /importe|monto/i, saldo: /saldo/i };
  async function pedir(ruta, opciones) {
    const res = await api(ruta, opciones), j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j.error || 'No se pudo completar'), { status: res.status, datos: j });
    return j;
  }
  let D = null, CUENTA = null, MES = null, ARCHIVO = null, CAT = null, abierto = null;

  async function pintar(cont, mes) {
    MES = mes;
    cont.innerHTML = '<p class="util-45" role="status">Cargando…</p>';
    try { D = await pedir('/conciliacion?mes=' + encodeURIComponent(mes) + (CUENTA ? '&cuenta=' + Number(CUENTA) : '')); }
    catch (err) { cont.innerHTML = `<p class="aviso-error-carga">${esc(err.message)}</p>`; return; }
    CUENTA = D.cuenta?.id || null;
    cont.innerHTML = html();
  }

  function html() {
    const d = D;
    const nueva = `<details class="cc-nueva"${d.cuentas.length ? '' : ' open'}><summary class="btn btn-outline">+ Nueva cuenta de banco</summary><div class="ant-form"><div class="form-grid-2">
      <div class="campo"><label for="cc-n-nombre">Nombre (como lo anotan al pagar; obligatorio)</label><input id="cc-n-nombre" maxlength="80" placeholder="Ej. Santander empresa"></div>
      <div class="campo"><label for="cc-n-banco">Banco (obligatorio)</label><select id="cc-n-banco"><option>Santander</option><option>Banorte</option><option>BBVA</option><option>Pagadora</option><option>Caja (efectivo)</option><option>Otro</option></select></div>
      <div class="campo"><label for="cc-n-term">Últimos 4 dígitos (opcional)</label><input id="cc-n-term" maxlength="4" inputmode="numeric"></div>
      <div class="campo"><label for="cc-n-clave">Clave de folio (obligatoria; va en cada folio)</label><input id="cc-n-clave" maxlength="6" placeholder="Ej. STD, BNT, PAG, CAJ" autocapitalize="characters"></div>
      </div><button type="button" class="btn btn-primario" data-cc="crear-cuenta">Guardar cuenta</button></div></details>`;
    if (!d.cuenta) return `<p class="ayuda">Para conciliar, primero da de alta la cuenta de banco (Santander, Banorte…). Después subes cada mes el estado de cuenta que bajas del portal.</p>${nueva}`;
    const t = d.totales;
    const cab = `<div class="cc-cab"><label>Cuenta <select id="cc-cuenta">${d.cuentas.map(c => `<option value="${Number(c.id)}"${c.id === d.cuenta.id ? ' selected' : ''}>${esc(c.nombre)}${c.terminacion ? ' ••' + esc(c.terminacion) : ''}${c.sucursal ? ' · ' + esc(c.sucursal) : ''}</option>`).join('')}</select></label>
      <label class="btn btn-primario cc-subir">📤 Subir estado de cuenta<input type="file" id="cc-archivo" accept=".xlsx,.csv,.txt" hidden></label>
      <button type="button" class="btn btn-outline" data-cc="emparejar">🔗 Emparejar solos</button>
      ${d.cuenta.clave_folio ? `<span class="ayuda">Folios: <b>${esc(d.cuenta.clave_folio)}</b>-I / -E</span>` : '<button type="button" class="btn btn-outline" data-cc="clave-folio">🏷️ Poner clave de folio</button>'}</div>${nueva}<div id="cc-mapeo"></div>`;
    const tarjetas = `<div class="logs-tarjetas">
      <div class="tarjeta-dinero"><small>Movimientos del banco en el mes</small><b>${Number(t.movimientos)}</b><span>abonos ${esc(dinero(t.abonos))} · cargos ${esc(dinero(t.cargos))}</span></div>
      <div class="tarjeta-dinero"><small>Conciliados</small><b>${Number(t.conciliados)}</b></div>
      <div class="tarjeta-dinero ${t.sin_crm ? 'alerta' : ''}"><small>En el banco, no en el CRM</small><b>${Number(t.sin_crm)}</b></div>
      <div class="tarjeta-dinero ${t.crm_sin_banco ? 'aviso' : ''}"><small>En el CRM, no en el banco</small><b>${Number(t.crm_sin_banco)}</b></div>
      ${t.saldo_final_banco != null ? `<div class="tarjeta-dinero"><small>Saldo del banco</small><b>${esc(dinero(t.saldo_final_banco))}</b><span>al ${esc(fecha(t.saldo_fecha))}</span></div>` : ''}</div>`;
    const monto = b => (b.cargo ? `<span class="rojo">−${esc(dinero(b.cargo))}</span>` : `+${esc(dinero(b.abono))}`);
    const sinCrm = d.banco_sin_crm.map(b => `<tr><td>${esc(fecha(b.fecha))}</td><td>${esc(b.concepto)}${b.referencia ? `<br><small>ref. ${esc(b.referencia)}</small>` : ''}</td><td class="nm-d">${monto(b)}</td>
      <td><div class="cc-acciones"><button type="button" class="btn btn-outline btn-chico" data-cc="candidatos" data-id="${Number(b.id)}">Emparejar</button>
        ${b.cargo && d.puede_gasto ? `<button type="button" class="btn btn-outline btn-chico" data-cc="gasto" data-id="${Number(b.id)}">Registrar gasto</button>` : ''}
        <button type="button" class="enlace" data-cc="no-aplica" data-id="${Number(b.id)}">No aplica</button></div>
        <div id="cc-extra-${Number(b.id)}"></div></td></tr>`).join('');
    const conc = d.conciliados.map(b => `<tr><td>${esc(fecha(b.fecha))}</td><td>${esc(b.concepto)}</td><td class="nm-d">${monto(b)}</td><td><small>${esc(TIPO[b.conciliado.tipo] || b.conciliado.tipo)}${b.conciliado.fecha ? ' del ' + esc(fecha(b.conciliado.fecha)) : ''}: ${esc(b.conciliado.texto)} · ${b.conciliado.auto ? 'solo' : 'a mano'}</small>
      <button type="button" class="enlace" data-cc="soltar" data-id="${Number(b.id)}">Soltar</button></td></tr>`).join('');
    const noAp = d.no_aplica.map(b => `<tr><td>${esc(fecha(b.fecha))}</td><td>${esc(b.concepto)}</td><td class="nm-d">${monto(b)}</td><td><small>${esc(b.no_aplica_motivo)}</small> <button type="button" class="enlace" data-cc="soltar" data-id="${Number(b.id)}">Quitar</button></td></tr>`).join('');
    const crm = d.crm_sin_banco.map(m => `<tr><td>${esc(fecha(m.fecha))}</td><td>${esc(TIPO[m.tipo] || m.tipo)}: ${esc(m.texto)}${m.cuenta ? `<br><small>cuenta anotada: ${esc(m.cuenta)}</small>` : ''}</td><td class="nm-d">${m.dir === 'cargo' ? `<span class="rojo">−${esc(dinero(m.monto))}</span>` : '+' + esc(dinero(m.monto))}</td></tr>`).join('');
    const tablaDe = (titulo, ayuda, filas, cols) => `<section class="apartado"><h3 class="util-13">${titulo}</h3><p class="ayuda">${ayuda}</p>${filas ? `<div class="nm-tabla-caja"><table class="cc-tabla"><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${filas}</tbody></table></div>` : '<p class="util-45">Nada.</p>'}</section>`;
    return cab + tarjetas
      + tablaDe('En el banco y no en el CRM', 'Empareja a mano con algo del CRM, regístralo como gasto (por ejemplo una comisión) o márcalo «no aplica» (por ejemplo un traspaso entre cuentas propias). Si es un cobro que nadie registró, regístralo en su orden de servicio y pulsa «Emparejar solos».', sinCrm, ['Fecha', 'Concepto del banco', 'Monto', ''])
      + tablaDe('En el CRM y no en el banco', 'Cobros confirmados, pagos y anticipos del mes (que no son en efectivo) que todavía no aparecen en este estado de cuenta. Puede que pasaran por otra cuenta o que aún no se reflejen.', crm, ['Fecha', 'Movimiento del CRM', 'Monto'])
      + tablaDe('Conciliados', 'Coinciden el banco y el CRM (misma dirección, mismo monto y hasta 3 días de diferencia, o emparejados a mano).', conc, ['Fecha', 'Concepto del banco', 'Monto', 'Con'])
      + (noAp ? tablaDe('No aplica', 'Movimientos del banco que no corresponden a nada del CRM.', noAp, ['Fecha', 'Concepto', 'Monto', 'Motivo']) : '');
  }

  // ---------- Leer el archivo ----------
  async function leerArchivo(f) {
    const nombre = f.name.toLowerCase();
    if (nombre.endsWith('.xlsx')) {
      const ExcelJS = await Finanzas.cargarExcelJS(), wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await f.arrayBuffer());
      const ws = wb.worksheets[0], filas = [];
      ws.eachRow({ includeEmpty: false }, row => {
        const r = []; for (let i = 1; i <= Math.max(ws.columnCount, row.cellCount); i++) {
          const v = row.getCell(i).value;
          r.push(v instanceof Date ? v.toISOString().slice(0, 10) : v && typeof v === 'object' ? (v.result ?? v.text ?? v.richText?.map(x => x.text).join('') ?? '') : v ?? '');
        }
        filas.push(r.map(x => String(x).trim()));
      });
      return filas;
    }
    const texto = await f.text(), lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    const sep = [',', ';', '\t', '|'].map(s => [s, (lineas[0].match(new RegExp('\\' + s, 'g')) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
    return lineas.map(l => { const r = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === sep && !q) { r.push(cur.trim()); cur = ''; } else cur += ch; } r.push(cur.trim()); return r; });
  }
  function mapeo(filas, nombre) {
    // Encabezado: la primera fila (entre las 15 primeras) que tiene una «fecha» y un «saldo/cargo/abono/importe» escritos.
    let enc = filas.slice(0, 15).findIndex(r => r.some(c => PISTAS.fecha.test(c)) && r.some(c => /saldo|cargo|abono|importe|retiro|dep/i.test(c)));
    const guardadas = D.cuenta.columnas || {};
    const cols = Math.max(...filas.slice(0, 30).map(r => r.length));
    const titulos = Array.from({ length: cols }, (_, i) => (enc >= 0 ? filas[enc][i] : '') || 'Columna ' + (i + 1));
    // Si el archivo trae encabezado, manda lo que dice el encabezado; si no, lo que se eligió la vez pasada en esta cuenta.
    const porEncabezado = k => { const i = titulos.findIndex(t => PISTAS[k].test(t)); return k === 'importe' && (titulos.some(t => PISTAS.cargo.test(t)) || titulos.some(t => PISTAS.abono.test(t))) ? -1 : i; };
    const elegida = k => (enc >= 0 ? porEncabezado(k) : guardadas[k] != null ? guardadas[k] : -1);
    ARCHIVO = { filas, nombre, desde: enc >= 0 ? enc + 1 : guardadas.desde != null ? guardadas.desde : 0 };
    const prev = filas.slice(Math.max(0, ARCHIVO.desde), ARCHIVO.desde + 5);
    $('cc-mapeo').innerHTML = `<div class="nm-pago"><h3>¿Qué columna es cada cosa? · ${esc(nombre)}</h3>
      <p class="ayuda">Se recuerda para esta cuenta. Revisa la vista previa antes de subir.</p>
      <div class="form-grid-2">${CAMPOS.map(([k, t]) => `<div class="campo"><label for="cc-m-${k}">${esc(t)}</label><select id="cc-m-${k}"><option value="-1">— no viene —</option>${titulos.map((x, i) => `<option value="${i}"${elegida(k) === i ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></div>`).join('')}
        <div class="campo"><label for="cc-m-desde">Los movimientos empiezan en el renglón</label><input id="cc-m-desde" type="number" min="1" value="${Number(ARCHIVO.desde) + 1}"></div></div>
      <div class="nm-tabla-caja"><table class="cc-tabla"><thead><tr>${titulos.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${prev.map(r => `<tr>${titulos.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <button type="button" class="btn btn-primario" data-cc="subir">Subir ${Number(filas.length - ARCHIVO.desde)} renglones</button> <button type="button" class="btn btn-outline" data-cc="cancelar-mapeo">Cancelar</button></div>`;
  }
  async function subir(boton) {
    const col = Object.fromEntries(CAMPOS.map(([k]) => [k, Number($('cc-m-' + k).value)]));
    const desde = Math.max(0, Number($('cc-m-desde').value || 1) - 1);
    if (col.fecha < 0) { toast('Elige la columna de la fecha'); return; }
    if (col.cargo < 0 && col.abono < 0 && col.importe < 0) { toast('Elige las columnas de cargo y abono, o la del importe con signo'); return; }
    const filas = ARCHIVO.filas.slice(desde).filter(r => (r[col.fecha] || '').trim()).map(r => {
      const f = { fecha: r[col.fecha], concepto: col.concepto >= 0 ? r[col.concepto] : '', referencia: col.referencia >= 0 ? r[col.referencia] : '', saldo: col.saldo >= 0 ? r[col.saldo] : '' };
      if (col.cargo >= 0 || col.abono >= 0) { f.cargo = col.cargo >= 0 ? r[col.cargo] : ''; f.abono = col.abono >= 0 ? r[col.abono] : ''; } else f.importe = r[col.importe];
      return f;
    });
    boton.disabled = true;
    try {
      const r = await pedir('/conciliacion/cargar', { method: 'POST', body: JSON.stringify({ cuenta_id: CUENTA, filas, archivo: ARCHIVO.nombre, columnas: { ...col, desde } }) });
      toast(`${r.nuevos} movimiento(s) nuevo(s)${r.repetidos ? `, ${r.repetidos} ya estaban` : ''}; ${r.emparejados} emparejado(s) solos`);
      ARCHIVO = null; recargarAhora();
    } catch (err) { toast(err.message + (err.datos?.errores ? ': ' + err.datos.errores.slice(0, 3).join(' · ') : '')); }
    finally { boton.disabled = false; }
  }
  const recargarAhora = () => { const c = $('cc-cuerpo'); if (c) pintar(c, MES); };

  async function catalogos() {
    if (CAT) return CAT;
    const [prov, cat] = await Promise.all([pedir('/finanzas/proveedores'), pedir('/finanzas/categorias')]);
    return (CAT = { prov: prov.filter(p => p.activo), cat });
  }

  document.addEventListener('change', async e => {
    if (e.target.id === 'cc-cuenta') { CUENTA = Number(e.target.value); return recargarAhora(); }
    if (e.target.id === 'cc-archivo') {
      const f = e.target.files[0]; if (!f) return;
      try { const filas = await leerArchivo(f); if (!filas.length) throw new Error('El archivo está vacío'); mapeo(filas, f.name); }
      catch (err) { toast('No se pudo leer el archivo: ' + err.message); }
      e.target.value = '';
    }
  });
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-cc]'); if (!b || !$('cc-cuerpo')?.contains(b)) return;
    const a = b.dataset.cc, id = Number(b.dataset.id) || 0, extra = $('cc-extra-' + id);
    const hacer = async (fn, ok) => { b.disabled = true; try { await fn(); if (ok) toast(ok); recargarAhora(); } catch (err) { toast(err.message); } finally { b.disabled = false; } };
    if (a === 'crear-cuenta') return hacer(async () => {
      if (!$('cc-n-clave').value.trim()) throw new Error('Escribe la clave de folio de la cuenta (por ejemplo STD): con ella se folian sus movimientos');
      const r = await pedir('/conciliacion/cuentas', { method: 'POST', body: JSON.stringify({ nombre: $('cc-n-nombre').value, banco: $('cc-n-banco').value, terminacion: $('cc-n-term').value, clave_folio: $('cc-n-clave').value, sucursal_id: Number($('ct-sucursal')?.value) || undefined }) }); CUENTA = r.id; }, 'Cuenta guardada');
    // Poner la clave de folio a una cuenta que no la tiene (2026-11-12).
    if (a === 'clave-folio') return hacer(async () => {
      const clave = await solicitarDialogo({ titulo: 'Clave de folio', mensaje: 'Va en cada folio de esta cuenta, por ejemplo STD-E-0001. De 2 a 6 letras o números. Ya con folios, no se cambia.', aceptar: 'Guardar', campo: { tipo: 'text', etiqueta: 'Clave (STD, BNT, PAG, CAJ…)', requerido: 'Escribe la clave' } });
      if (!clave) throw new Error('No se cambió la clave'); await pedir('/cuentas-banco/' + Number(CUENTA) + '/clave', { method: 'POST', body: JSON.stringify({ clave }) }); }, 'Clave guardada');
    if (a === 'emparejar') return hacer(async () => { const r = await pedir('/conciliacion/cuentas/' + CUENTA + '/emparejar', { method: 'POST', body: '{}' }); toast(`${r.emparejados} emparejado(s)`); });
    if (a === 'subir') return subir(b);
    if (a === 'cancelar-mapeo') { ARCHIVO = null; $('cc-mapeo').innerHTML = ''; return; }
    if (a === 'soltar') return hacer(() => pedir('/conciliacion/movimientos/' + id + '/soltar', { method: 'POST', body: '{}' }), 'Listo');
    if (a === 'no-aplica') {
      const motivo = await solicitarDialogo({ titulo: 'No aplica', mensaje: 'Este movimiento del banco no corresponde a nada del CRM (por ejemplo, un traspaso entre cuentas propias).', aceptar: 'Guardar', campo: { tipo: 'text', etiqueta: 'Motivo', requerido: 'Escribe el motivo (mínimo 5 letras)' } });
      if (!motivo) return;
      return hacer(() => pedir('/conciliacion/movimientos/' + id + '/no-aplica', { method: 'POST', body: JSON.stringify({ motivo }) }), 'Marcado «no aplica»');
    }
    if (a === 'candidatos') {
      if (abierto === 'c' + id) { extra.innerHTML = ''; abierto = null; return; }
      abierto = 'c' + id;
      try {
        const r = await pedir('/conciliacion/movimientos/' + id + '/candidatos');
        extra.innerHTML = r.candidatos.length ? `<ul class="cc-cand">${r.candidatos.map(c => `<li><button type="button" class="btn btn-outline btn-chico" data-cc="elegir" data-id="${id}" data-tipo="${esc(c.tipo)}" data-crm="${Number(c.id)}">Es este</button> ${esc(fecha(c.fecha))} · ${esc(TIPO[c.tipo] || c.tipo)}: ${esc(c.texto)}</li>`).join('')}</ul>`
          : '<p class="ayuda">No hay nada en el CRM con ese monto (30 días antes o después). Si es un cobro o un gasto que falta, regístralo primero.</p>';
      } catch (err) { toast(err.message); }
      return;
    }
    if (a === 'elegir') return hacer(() => pedir('/conciliacion/movimientos/' + id + '/emparejar', { method: 'POST', body: JSON.stringify({ tipo: b.dataset.tipo, id: Number(b.dataset.crm) }) }), 'Emparejado');
    if (a === 'gasto') {
      if (abierto === 'g' + id) { extra.innerHTML = ''; abierto = null; return; }
      abierto = 'g' + id;
      let c; try { c = await catalogos(); } catch (err) { toast(err.message); return; }
      const mov = D.banco_sin_crm.find(x => x.id === id);
      extra.innerHTML = `<div class="ant-form"><div class="form-grid-2">
        <div class="campo"><label for="cc-g-prov-${id}">Proveedor (obligatorio)</label><select id="cc-g-prov-${id}"><option value="">Selecciona…</option>${c.prov.map(p => `<option value="${Number(p.id)}">${esc(p.nombre)}</option>`).join('')}</select></div>
        <div class="campo"><label for="cc-g-cat-${id}">Categoría (obligatorio)</label><select id="cc-g-cat-${id}">${c.cat.map(x => `<option value="${esc(x.clave)}"${x.clave === 'comisiones_bancarias' ? ' selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select></div>
        <div class="campo"><label for="cc-g-con-${id}">Concepto (obligatorio)</label><input id="cc-g-con-${id}" maxlength="200" value="${esc(mov?.concepto || '')}"></div>
        </div><button type="button" class="btn btn-primario btn-chico" data-cc="guardar-gasto" data-id="${id}">Registrar gasto de ${esc(dinero(mov?.cargo))}</button></div>`;
      return;
    }
    if (a === 'guardar-gasto') return hacer(() => pedir('/conciliacion/movimientos/' + id + '/gasto', { method: 'POST', body: JSON.stringify({ proveedor_id: Number($('cc-g-prov-' + id).value) || null, categoria: $('cc-g-cat-' + id).value, concepto: $('cc-g-con-' + id).value }) }), 'Gasto registrado y conciliado');
  });

  return { pintar };
})();
window.Conciliacion = Conciliacion;
