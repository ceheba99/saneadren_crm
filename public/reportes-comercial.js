/* Análisis comercial · indicadores (2026-11-11, reportes de Dirección). Servidor: /api/analisis/indicadores
   (server/reportes.js). Cada quien ve lo suyo: satisfacción de sus clientes, cobranza a tiempo de sus órdenes (si ve
   la cobranza), servicios en su fecha y recompras. Nada de cuentas por pagar ni dinero de la empresa.
   Todo dato se escapa con escaparHtml. */
const IndicadoresComerciales = (() => {
  const $ = id => document.getElementById(id), esc = t => escaparHtml(t);
  const pct = v => (v === null || v === undefined ? '—' : v + ' %');
  let consulta = 0;
  async function pintar(desde, hasta) {
    const cont = $('res-indicadores'); if (!cont) return;
    const turno = ++consulta;
    cont.innerHTML = '<p class="ayuda" role="status">Calculando indicadores…</p>';
    let d;
    try { const r = await api('/analisis/indicadores?' + new URLSearchParams({ desde: desde || '2000-01-01', hasta: hasta || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date()) })); d = await r.json(); if (!r.ok) throw new Error(d.error); }
    catch (err) { if (turno === consulta) cont.innerHTML = `<p class="aviso-error-carga">No se pudieron calcular los indicadores: ${esc(err.message)}</p>`; return; }
    if (turno !== consulta) return;
    const s = d.satisfaccion, o = d.operacion, c = d.cobranza, rc = d.recompras;
    const tarjeta = (titulo, valor, sub) => `<div class="res-card"><div class="res-num">${esc(valor)}</div><div class="res-label">${esc(titulo)}${sub ? `<br><small>${esc(sub)}</small>` : ''}</div></div>`;
    const tabla = (titulo, filas) => filas.length ? `<div class="res-section"><h3>${esc(titulo)}</h3><table class="pg-tabla"><thead><tr><th></th><th class="st-num">Encuestas</th><th class="st-num">Promedio (1 a 5)</th><th class="st-num">NPS</th></tr></thead><tbody>${filas.map(f => `<tr><td>${esc(f.nombre)}</td><td class="st-num">${Number(f.encuestas)}</td><td class="st-num">${f.promedio == null ? '—' : esc(String(f.promedio))}</td><td class="st-num">${f.nps == null ? '—' : Number(f.nps)}</td></tr>`).join('')}</tbody></table></div>` : '';
    const motivos = o.motivos_no_realizado.length ? '<p class="ayuda">No realizados: ' + o.motivos_no_realizado.map(m => esc(m.motivo) + ' (' + Number(m.n) + ')').join(' · ') + '</p>' : '';
    cont.innerHTML = `<div class="res-section"><h3>Satisfacción, cobranza, operación y recompras</h3><p class="ayuda">Con lo que tú ves en el periodo. La satisfacción sale de las encuestas que contestan los clientes con el QR de la orden.</p>
      <div class="res-grid">
        ${tarjeta('Satisfacción promedio', s.promedio == null ? '—' : s.promedio + ' de 5', s.encuestas + ' encuestas contestadas' + (s.respuesta?.mandadas ? ` de ${s.respuesta.mandadas} mandadas` : ''))}
        ${tarjeta('NPS (recomendarían)', s.nps == null ? '—' : String(s.nps), s.insatisfechos ? s.insatisfechos + ' cliente(s) insatisfecho(s)' : 'Sin insatisfechos')}
        ${c ? tarjeta('Cobrado a tiempo', pct(c.pct), c.liquidadas ? `${c.a_tiempo} de ${c.liquidadas} órdenes · ${c.dias_promedio ?? '—'} días promedio` : 'Ninguna orden liquidada') : ''}
        ${tarjeta('Servicios en su fecha', pct(o.pct), `${o.en_fecha} de ${o.realizados} realizados · ${o.no_realizados} no realizados`)}
        ${tarjeta('Recompras', pct(rc.pct), rc.tocaban ? `${rc.volvieron} de ${rc.tocaban} clientes volvieron a contratar a tiempo` : 'Ninguna recompra tocaba en el periodo')}
      </div></div>
      <div class="res-two-col">${tabla('Satisfacción por servicio', s.por_servicio)}${tabla('Satisfacción por vendedor', s.por_vendedor)}</div>
      ${motivos}`;
  }
  return { pintar };
})();
window.IndicadoresComerciales = IndicadoresComerciales;
