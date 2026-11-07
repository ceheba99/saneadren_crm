// Listas de los servicios (2026-11-05, server/listas-servicio.js): la descripción de un servicio puede llevar partes que
// cambian entre corchetes ([VOLUMEN], [SUCURSAL]…). Al capturar una partida, junto a la descripción sale una lista por
// cada parte; lo elegido se escribe en el texto. En Catálogos → Servicios, Dirección carga y quita las opciones.
window.ListasServicio = (() => {
  let LISTAS = {}, PUEDE = false;
  const MARCA = /\[([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ0-9 ]{0,29})\]/g;
  const marcasDe = texto => [...new Set([...String(texto || '').matchAll(MARCA)].map(m => m[1].trim()))];
  const servicioDe = nombre => (CATALOGOS.servicios || []).find(s => s.nombre === nombre);
  const listaDe = (servicioId, marca) => LISTAS[servicioId]?.[marca] || [];
  // Partes de la descripción del servicio que tienen lista (las demás [ ] se dejan como texto).
  const partesDe = nombre => { const s = servicioDe(nombre); return s ? marcasDe(s.descripcion).filter(m => listaDe(s.id, m).some(x => x.activo)) : []; };

  async function cargar() {
    try {
      const r = await api('/servicios/listas' + (Permisos.direccion() ? '?todas=1' : ''));
      const d = r.ok ? await r.json() : {};
      LISTAS = d.listas || {}; PUEDE = !!d.puede_editar;
    } catch { LISTAS = {}; PUEDE = false; }
  }

  // ---------- Partidas ----------
  function opcionesLista(servicioId, marca, elegido) {
    const lista = listaDe(servicioId, marca).filter(x => x.activo || x.valor === elegido);
    const falta = elegido && !lista.some(x => x.valor === elegido);
    return `<option value="">— Elige —</option>${falta ? `<option selected>${escaparHtml(elegido)}</option>` : ''}`
      + lista.map(x => `<option${x.valor === elegido ? ' selected' : ''}>${escaparHtml(x.valor)}</option>`).join('');
  }
  // Dibuja (o quita) las listas de una partida según su servicio. «opciones» = lo ya elegido ({ VOLUMEN: '8M3' }).
  function pintarFila(fila, opciones = {}) {
    fila.querySelector('.gc-opciones')?.remove();
    const nombre = fila.querySelector('.gc-servicio').value, partes = partesDe(nombre), s = servicioDe(nombre);
    if (!partes.length) return;
    const id = fila.dataset.fila, leyenda = fila.querySelector('.gc-leyenda');
    // Una partida guardada con lo elegido: cambiar la opción no pide confirmación si el texto no se editó a mano.
    if (Object.keys(opciones).length && leyenda.value === textoCon(s.descripcion, opciones)) leyenda.dataset.generada = leyenda.value;
    fila.querySelector('.gc-c-leyenda').insertAdjacentHTML('beforebegin', `<div class="gc-opciones">${partes.map((m, n) => `
      <div class="campo-modal"><label for="gc-op-${escaparHtml(id)}-${n}">${escaparHtml(m.charAt(0) + m.slice(1).toLowerCase())}</label>
        <select class="gc-opcion" id="gc-op-${escaparHtml(id)}-${n}" data-marca="${escaparHtml(m)}">${opcionesLista(s.id, m, opciones[m])}</select></div>`).join('')}</div>`);
  }
  const elegidas = fila => Object.fromEntries([...fila.querySelectorAll('.gc-opcion')].filter(x => x.value).map(x => [x.dataset.marca, x.value]));
  // El texto de la descripción con lo elegido; lo que falta se queda como [PARTE].
  const textoCon = (plantilla, ops) => plantilla.replace(MARCA, (t, m) => ops[m.trim()] ?? t);
  // Al elegir: se reescribe la descripción. Si la editaron a mano, se pregunta antes.
  async function alElegir(select) {
    const fila = select.closest('.gc-fila'), leyenda = fila.querySelector('.gc-leyenda');
    const plantilla = servicioDe(fila.querySelector('.gc-servicio').value)?.descripcion || '';
    const nuevo = textoCon(plantilla, elegidas(fila)), anterior = leyenda.dataset.generada ?? plantilla;
    if (leyenda.value.trim() && leyenda.value !== anterior && !await solicitarDialogo({ titulo: 'Descripción editada', mensaje: '¿Reemplazar la descripción que editaste por la del servicio con lo que elegiste?', aceptar: 'Reemplazar' })) return;
    leyenda.value = nuevo; leyenda.dataset.generada = nuevo;
    leyenda.dispatchEvent(new Event('input', { bubbles: true }));
  }
  // Primera partida con una [PARTE] sin elegir (para avisar antes de guardar; el servidor también lo revisa).
  function faltante(filas) {
    for (const f of filas) {
      const partes = partesDe(f.querySelector('.gc-servicio').value), m = marcasDe(f.querySelector('.gc-leyenda').value).find(x => partes.includes(x));
      if (m) return { fila: f, marca: m };
    }
    return null;
  }

  // ---------- Catálogo de servicios ----------
  function listasCatalogoHTML(servicioId, descripcion) {
    const partes = [...new Set([...marcasDe(descripcion), ...Object.keys(LISTAS[servicioId] || {}).filter(m => listaDe(servicioId, m).some(x => x.activo))])];
    if (!partes.length) return ''; // cómo poner una [PARTE] lo dice el texto de ayuda de la descripción
    return partes.map(m => {
      const lista = listaDe(servicioId, m), activas = lista.filter(x => x.activo), quitadas = lista.filter(x => !x.activo);
      const enTexto = marcasDe(descripcion).includes(m);
      return `<div class="ls-lista" data-marca="${escaparHtml(m)}">
        <div class="ls-tit">Lista para <b>[${escaparHtml(m)}]</b>${enTexto ? '' : ' <small>(ya no está en la descripción: no se usa)</small>'}</div>
        <div class="ls-chips">${activas.map(x => `<span class="ls-chip">${escaparHtml(x.valor)}${PUEDE ? `<button type="button" class="ls-quitar" data-ls-quitar="${Number(x.id)}" aria-label="Quitar ${escaparHtml(x.valor)}">✕</button>` : ''}</span>`).join('') || '<small>Sin opciones todavía</small>'}</div>
        ${PUEDE ? `<div class="ls-agregar"><input type="text" maxlength="80" class="ls-nuevo" placeholder="Nueva opción, p. ej. 8M3" aria-label="Nueva opción para ${escaparHtml(m)}"><button type="button" class="btn btn-secundario" data-ls-agregar>Agregar</button></div>` : ''}
        ${PUEDE && quitadas.length ? `<details class="ls-quitadas"><summary>Quitadas (${quitadas.length})</summary>${quitadas.map(x => `<span class="ls-chip ls-chip-quitada">${escaparHtml(x.valor)}<button type="button" class="ls-quitar" data-ls-activar="${Number(x.id)}" aria-label="Activar ${escaparHtml(x.valor)}">↺</button></span>`).join('')}</details>` : ''}
      </div>`;
    }).join('') + (PUEDE ? '' : '<p class="ayuda ls-ayuda">Las listas y las partes entre corchetes las cambia solo Dirección.</p>');
  }
  function pintarCatalogo() {
    for (const fila of document.querySelectorAll('#lista-servicios-catalogo [data-servicio]')) {
      const id = Number(fila.dataset.servicio), desc = document.getElementById('desc-' + id)?.value || '';
      let cont = fila.querySelector('.ls-listas');
      if (!cont) { fila.querySelector('.info').insertAdjacentHTML('beforeend', '<div class="ls-listas"></div>'); cont = fila.querySelector('.ls-listas'); }
      cont.innerHTML = listasCatalogoHTML(id, desc);
    }
  }
  async function enCatalogo(e) {
    const btn = e.target.closest('[data-ls-agregar], [data-ls-quitar], [data-ls-activar]'); if (!btn) return;
    e.stopPropagation();
    const fila = btn.closest('[data-servicio]'), id = Number(fila.dataset.servicio), marca = btn.closest('.ls-lista').dataset.marca;
    try {
      if (btn.hasAttribute('data-ls-agregar')) {
        const campo = btn.closest('.ls-lista').querySelector('.ls-nuevo'), valor = campo.value.trim();
        if (!valor) { toast('Escribe la opción'); campo.focus(); return; }
        await exigirOk(await api('/servicios/' + id + '/listas', { method: 'POST', body: JSON.stringify({ marca, valor }) }), 'No se pudo agregar');
        toast('Opción agregada');
      } else {
        const quitar = !!btn.dataset.lsQuitar, lid = Number(btn.dataset.lsQuitar || btn.dataset.lsActivar);
        if (quitar) await exigirOk(await api('/servicios/' + id + '/listas/' + lid + '/desactivar', { method: 'POST', body: '{}' }), 'No se pudo quitar');
        else await exigirOk(await api('/servicios/' + id + '/listas/' + lid + '/reactivar', { method: 'POST', body: '{}' }), 'No se pudo activar');
        toast(quitar ? 'Opción quitada (queda en la bitácora)' : 'Opción activada otra vez');
      }
      await cargar(); pintarCatalogo();
    } catch (err) { toast(err.message); }
  }
  document.addEventListener('DOMContentLoaded', () => {
    const cat = document.getElementById('lista-servicios-catalogo');
    cat?.addEventListener('click', enCatalogo, true);
    cat?.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('ls-nuevo')) { e.preventDefault(); e.target.nextElementSibling?.click(); } });
    // Al escribir o quitar una [PARTE] en la descripción, se ve su lista.
    cat?.addEventListener('input', e => { if (e.target.matches('textarea[id^="desc-"]')) { const f = e.target.closest('[data-servicio]'); const c = f.querySelector('.ls-listas'); if (c) c.innerHTML = listasCatalogoHTML(Number(f.dataset.servicio), e.target.value); } });
  });

  return { cargar, marcasDe, pintarFila, elegidas, alElegir, faltante, pintarCatalogo };
})();
