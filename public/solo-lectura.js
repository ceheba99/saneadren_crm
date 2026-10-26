// SOLO LECTURA (decidido con Dirección el 2026-10-26): contactos, cotizaciones y órdenes de servicio se abren para
// consultar. Quien puede editarlos (quien los capturó o los tiene a su nombre, el gerente y Dirección; lo decide el
// servidor: puede_editar) pulsa «✏️ Editar»; al guardar, vuelven a quedar en solo lectura. Los demás (p. ej. Cobranza o
// el técnico asignado) solo los ven.
//  · En la zona bloqueada los campos quedan deshabilitados y los botones de cambiar se esconden; lo que no es editar
//    (abrir o cerrar secciones) sigue funcionando. El candado real está en el servidor.
//  · SoloLectura.poner(zona, puede, textos) al abrir la ficha; SoloLectura.bloquear(zona) después de guardar.
const SoloLectura = (() => {
  const BARRA = 'solo-lectura-barra';
  const respetar = el => el.matches('[data-plegable-cabecera], [data-plegable-cabecera] *, .plegable-boton, [data-sl-libre], .' + BARRA + ' *');

  // La barra va después del título de la zona, o dentro de «textos.barraEn» (p. ej. junto a los botones de una tarjeta).
  function barraDe(zona, textos = {}) {
    let b = zona.querySelector('.' + BARRA);
    if (!b) {
      b = document.createElement('div'); b.className = BARRA; b.setAttribute('role', 'status');
      const dentro = textos.barraEn && zona.querySelector(textos.barraEn), titulo = zona.querySelector(':scope > .seccion-tit');
      if (dentro) dentro.prepend(b); else if (titulo) titulo.after(b); else zona.prepend(b);
    }
    return b;
  }
  function fijar(zona, bloqueada) {
    zona.classList.toggle('solo-lectura', bloqueada);
    // Lo que se dibuja después (p. ej. el personal de la orden, que llega del servidor) también queda bloqueado.
    zona._slObs?.disconnect();
    if (bloqueada) { zona._slObs = new MutationObserver(() => { zona._slObs.disconnect(); fijar(zona, true); }); zona._slObs.observe(zona, { childList: true, subtree: true }); }
    for (const el of zona.querySelectorAll('input, select, textarea, button')) {
      if (respetar(el)) continue;
      if (bloqueada) {
        if (el.dataset.slAntes === undefined) el.dataset.slAntes = el.tagName === 'BUTTON' ? (el.hidden ? '1' : '0') : (el.disabled ? '1' : '0');
        if (el.tagName === 'BUTTON') el.hidden = true; else el.disabled = true;
      } else if (el.dataset.slAntes !== undefined) {
        if (el.tagName === 'BUTTON') el.hidden = el.dataset.slAntes === '1'; else el.disabled = el.dataset.slAntes === '1';
        delete el.dataset.slAntes;
      }
    }
  }
  // zona: elemento o selector; puede: si quien mira la puede editar; textos: { que: 'esta orden', quien: '…' }.
  function poner(zona, puede, textos) {
    zona = typeof zona === 'string' ? document.querySelector(zona) : zona;
    if (!zona) return;
    zona._soloLectura = [puede, textos];
    fijar(zona, false); // lo que haya quedado de la ficha anterior
    const b = barraDe(zona, textos);
    b.classList.toggle('compacta', !!textos.compacto);
    if (puede) {
      b.innerHTML = (textos.compacto ? '' : '<span>🔒 Solo lectura.</span> ') + '<button type="button" class="btn btn-outline btn-chico" data-sl-editar>✏️ Editar' + (textos.que ? ' ' + escaparHtml(textos.que) : '') + '</button>';
      b.querySelector('[data-sl-editar]').onclick = () => {
        fijar(zona, false);
        b.innerHTML = '<span>✏️ Editando' + (textos.que ? ' ' + escaparHtml(textos.que) : '') + '. Al guardar vuelve a quedar en solo lectura.</span>';
        textos.alEditar?.();
      };
    } else {
      b.innerHTML = '<span>🔒 Solo lectura: ' + escaparHtml(textos.quien) + '</span>';
    }
    fijar(zona, true);
  }
  // Registro nuevo (se captura directo): sin candado ni aviso.
  function quitar(zona) {
    zona = typeof zona === 'string' ? document.querySelector(zona) : zona;
    if (!zona) return;
    fijar(zona, false); zona._slObs?.disconnect(); zona._soloLectura = null;
    zona.querySelector('.' + BARRA)?.remove();
  }
  // Después de guardar: vuelve a solo lectura (con su botón «Editar»).
  function bloquear(zona) {
    zona = typeof zona === 'string' ? document.querySelector(zona) : zona;
    if (zona?._soloLectura) poner(zona, ...zona._soloLectura);
  }
  return { poner, bloquear, quitar };
})();
