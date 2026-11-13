/* Cuenta de banco al registrar dinero (folios de banco, Editar Contabilidad parte 5, 2026-11-12). Servidor: server/folios-banco.js.
   Toda lista <select data-cuentas-banco> se llena sola con las cuentas que ve la persona (al aparecer en pantalla y al
   abrirla). Si su campo trae además un texto [data-cb-texto] (la «cuenta de salida» escrita de antes), se muestra el texto
   solo mientras no haya cuentas dadas de alta; con cuentas, la lista es obligatoria y con ella el movimiento recibe su folio.
   CuentasBanco.elegir(titulo) pide la cuenta en una ventanita (para «Confirmar» un cobro): resuelve el id, '' si todavía no
   hay cuentas, o null si se canceló. */
const CuentasBanco = (() => {
  let datos = null, cuando = 0, pendiente = null;
  const esc = t => escaparHtml(t);
  async function cargar(forzar) {
    if (datos && !forzar && Date.now() - cuando < 60000) return datos;
    if (pendiente) return pendiente;
    pendiente = (async () => {
      try { const r = await api('/cuentas-banco'); datos = r.ok ? await r.json() : { cuentas: [], requiere: false }; }
      catch { datos = datos || { cuentas: [], requiere: false }; }
      cuando = Date.now(); pendiente = null; return datos;
    })();
    return pendiente;
  }
  const varias = () => new Set((datos?.cuentas || []).map(c => c.sucursal_id)).size > 1;
  const etiqueta = c => [c.nombre, c.clave_folio ? 'folios ' + c.clave_folio : 'sin clave de folio', c.terminacion ? '••' + c.terminacion : '', varias() ? window.Sucursales?.datos?.sucursales?.find(s => s.id === c.sucursal_id)?.clave : ''].filter(Boolean).join(' · ');
  function opciones(seleccion) {
    const cs = datos?.cuentas || [];
    return '<option value="">Elige la cuenta…</option>' + cs.map(c => `<option value="${Number(c.id)}"${String(c.id) === String(seleccion ?? '') ? ' selected' : ''}>${esc(etiqueta(c))}</option>`).join('');
  }
  async function llenar(sel, forzar) {
    await cargar(forzar);
    const antes = sel.value, campo = sel.closest('.campo'), texto = campo?.querySelector('[data-cb-texto]'), hay = (datos?.cuentas || []).length > 0;
    sel.innerHTML = opciones(antes); sel.dataset.cbListo = '1';
    sel.hidden = !hay; sel.required = hay;
    if (texto) { texto.hidden = hay; if (hay) texto.value = ''; }
    else if (campo && campo.dataset.cbOcultar !== 'no') campo.hidden = !hay;
  }
  const llenarTodos = raiz => raiz.querySelectorAll?.('select[data-cuentas-banco]:not([data-cb-listo])').forEach(s => llenar(s));
  // Las listas nuevas (formularios que se dibujan después) se llenan solas; al abrirlas se refrescan si pasó un minuto.
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches?.('select[data-cuentas-banco]')) llenar(n); else llenarTodos(n); } })
    .observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('focusin', e => { if (e.target.matches?.('select[data-cuentas-banco]') && Date.now() - cuando > 60000) llenar(e.target, true); });
  if (document.readyState !== 'loading') llenarTodos(document); else document.addEventListener('DOMContentLoaded', () => llenarTodos(document));

  // Ventanita para elegir la cuenta (Confirmar un cobro).
  async function elegir(titulo, mensaje) {
    await cargar();
    if (!(datos?.cuentas || []).length) return '';
    return new Promise(resolve => {
      const capa = document.createElement('div');
      capa.className = 'cb-capa';
      capa.innerHTML = `<div class="cb-ventana" role="dialog" aria-modal="true" aria-labelledby="cb-titulo"><h2 id="cb-titulo">${esc(titulo)}</h2>
        <p class="ayuda">${esc(mensaje || 'Con la cuenta, el movimiento recibe su folio de banco.')}</p>
        <label for="cb-elegir">Cuenta de banco (obligatorio)</label><select id="cb-elegir">${opciones('')}</select>
        <p class="cb-error" id="cb-error" hidden>Elige la cuenta.</p>
        <div class="cb-botones"><button type="button" class="btn btn-outline" id="cb-cancelar">Cancelar</button><button type="button" class="btn btn-primario" id="cb-aceptar">Aceptar</button></div></div>`;
      const fin = v => { capa.remove(); document.removeEventListener('keydown', tecla); resolve(v); };
      const tecla = e => { if (e.key === 'Escape') fin(null); };
      capa.querySelector('#cb-cancelar').onclick = () => fin(null);
      capa.querySelector('#cb-aceptar').onclick = () => { const v = capa.querySelector('#cb-elegir').value; if (!v) { capa.querySelector('#cb-error').hidden = false; return; } fin(v); };
      capa.addEventListener('click', e => { if (e.target === capa) fin(null); });
      document.addEventListener('keydown', tecla);
      document.body.appendChild(capa);
      setTimeout(() => capa.querySelector('#cb-elegir').focus(), 0);
    });
  }
  // El valor elegido en un formulario: el id, o undefined si la lista no aplica (sin cuentas o campo oculto por permiso).
  const valor = id => { const s = document.getElementById(id); return s && !s.hidden && s.offsetParent !== null && s.value ? Number(s.value) : undefined; };
  return { cargar, llenar, elegir, valor };
})();
window.CuentasBanco = CuentasBanco;
