/* Inicio en fichas (decisión del dueño, 2026-10-21). Cada bloque de Inicio es una ficha que se pliega desde su título:
   el encabezado dice cuántos pendientes tiene (en rojo si hay algo vencido) y, abierta, muestra los primeros renglones; el
   resto con «Ver N más». La explicación de cada ficha va en un botón de ayuda. Arriba, un resumen con los números de cada
   ficha que lleva a ella y la abre. Lo plegado se recuerda en este equipo; una ficha sin pendientes queda plegada con
   «Nada pendiente» hasta que alguien la abra. Cada módulo sigue pintando sus renglones (.fila-alerta) como siempre: esto
   solo los acomoda, y se actualiza solo cuando cambian. */
const Inicio = (() => {
  const VISIBLES = 3;
  const leer = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
  // En su orden original (las columnas cambian el orden en la página).
  const bloques = () => [...document.querySelectorAll('#inicio-rejilla .inicio-bloque')].sort((x, y) => (x.dataset.orden || 0) - (y.dataset.orden || 0));
  const listaDe = b => b.querySelector('.inicio-lista');
  const claveDe = b => 'inicio-plegado-' + listaDe(b).id;
  const visible = el => getComputedStyle(el).display !== 'none';
  const esc = t => escaparHtml(t);

  // Qué tiene la ficha: renglones, si sigue cargando, si falló y si hay algo vencido.
  function estado(b) {
    const l = listaDe(b), filas = [...l.querySelectorAll(':scope > .fila-alerta')];
    const error = !!l.querySelector('.aviso-error-carga');
    const cargando = !error && !filas.length && (!l.children.length || !!l.querySelector('[role="status"]'));
    const urgentes = filas.filter(f => f.classList.contains('vencido') || f.querySelector('.tipo-tag.rojo')).length;
    return { filas, error, cargando, urgentes, resumen: l.dataset.resumen || '', urgente: l.dataset.urgente === '1' || urgentes > 0 };
  }
  // Abierta o plegada: lo que eligió la persona; si no eligió, plegada solo cuando no hay nada pendiente.
  function abierta(b, e) {
    const pref = leer(claveDe(b));
    if (pref === 'si') return false;
    if (pref === 'no') return true;
    return e.cargando || e.error || e.filas.length > 0;
  }
  function preparar(b) {
    if (b.dataset.listo) return;
    b.dataset.listo = '1';
    const h3 = b.querySelector('h3'), ayuda = b.querySelector(':scope > p.ayuda'), lista = listaDe(b), id = lista.id;
    // Encabezado: el título es el botón para plegar; a un lado, la ayuda.
    const boton = document.createElement('button');
    boton.type = 'button'; boton.className = 'inicio-plegar'; boton.setAttribute('aria-controls', id + '-cuerpo');
    boton.innerHTML = '<span class="inicio-titulo"></span><span class="inicio-cuenta"></span><span class="inicio-flecha" aria-hidden="true"></span>';
    boton.querySelector('.inicio-titulo').append(...h3.childNodes);
    h3.appendChild(boton);
    const cab = document.createElement('div'); cab.className = 'inicio-cab';
    h3.replaceWith(cab); cab.appendChild(h3);
    const cuerpo = document.createElement('div'); cuerpo.className = 'inicio-cuerpo'; cuerpo.id = id + '-cuerpo';
    if (ayuda) {
      const q = document.createElement('button');
      q.type = 'button'; q.className = 'inicio-ayuda-btn'; q.textContent = '?';
      q.setAttribute('aria-label', 'Qué muestra la ficha ' + (b.dataset.tituloCorto || '')); q.setAttribute('aria-expanded', 'false'); q.setAttribute('aria-controls', id + '-ayuda');
      ayuda.id = id + '-ayuda'; ayuda.hidden = true; ayuda.classList.add('inicio-ayuda');
      cab.appendChild(q);
      q.addEventListener('click', () => { ayuda.hidden = !ayuda.hidden; q.setAttribute('aria-expanded', String(!ayuda.hidden)); });
      cab.after(ayuda);
    }
    lista.before(cuerpo); cuerpo.appendChild(lista);
    const mas = document.createElement('button');
    mas.type = 'button'; mas.className = 'enlace inicio-mas'; mas.hidden = true;
    cuerpo.appendChild(mas);
    boton.addEventListener('click', () => { const abrir = boton.getAttribute('aria-expanded') !== 'true'; guardar(claveDe(b), abrir ? 'no' : 'si'); actualizar(b); });
    mas.addEventListener('click', () => { b.dataset.todo = b.dataset.todo === '1' ? '' : '1'; actualizar(b); });
    // Cada módulo vuelve a pintar su lista cuando cambia: la ficha se acomoda sola.
    new MutationObserver(() => actualizar(b)).observe(lista, { childList: true });
    new MutationObserver(() => actualizar(b)).observe(lista, { attributes: true, attributeFilter: ['data-resumen', 'data-urgente'] });
  }
  function actualizar(b) {
    const e = estado(b), abrir = abierta(b, e);
    const boton = b.querySelector('.inicio-plegar'), cuenta = b.querySelector('.inicio-cuenta'), cuerpo = b.querySelector('.inicio-cuerpo'), mas = b.querySelector('.inicio-mas');
    boton.setAttribute('aria-expanded', String(abrir));
    cuerpo.hidden = !abrir;
    b.classList.toggle('plegada', !abrir);
    const n = e.filas.length;
    cuenta.className = 'inicio-cuenta' + (e.error ? ' urgente' : e.urgente ? ' urgente' : n || e.resumen ? ' con' : e.cargando ? '' : ' nada');
    cuenta.textContent = e.error ? 'No se pudo cargar' : e.cargando ? '…' : e.resumen ? e.resumen : n ? n + (e.urgentes ? ' · ' + e.urgentes + (e.urgentes === 1 ? ' vencido' : ' vencidos') : '') : 'Nada pendiente';
    // Los primeros renglones; el resto con «Ver N más».
    const todo = b.dataset.todo === '1';
    e.filas.forEach((f, i) => { f.hidden = !todo && i >= VISIBLES; });
    mas.hidden = n <= VISIBLES;
    mas.textContent = todo ? 'Ver menos' : 'Ver ' + (n - VISIBLES) + ' más';
    pintarResumen();
  }
  // Dos columnas independientes (en pantalla ancha): las fichas visibles se reparten una y una, en su orden, para que una
  // ficha corta no deje un hueco junto a una larga. Solo se mueven cuando cambia qué fichas se ven (al entrar o cambiar de
  // rol), no al plegar. En celular las columnas desaparecen (display:contents) y el orden original lo da style.order.
  function acomodar() {
    const rejilla = document.getElementById('inicio-rejilla'), cols = [...rejilla.querySelectorAll(':scope > .inicio-col')];
    const todas = bloques(), vis = todas.filter(visible);
    rejilla.classList.toggle('una', vis.length < 2);
    const quiere = [[], []];
    vis.forEach((b, i) => quiere[i % 2].push(b));
    todas.filter(b => !vis.includes(b)).forEach(b => quiere[1].push(b));
    quiere.forEach((lista, c) => { if (lista.some((b, i) => cols[c].children[i] !== b)) cols[c].append(...lista); });
  }
  // Resumen de arriba: una cifra por ficha con pendientes; lleva a la ficha y la abre.
  let resumenPendiente = false;
  function pintarResumen() {
    if (resumenPendiente) return;
    resumenPendiente = true;
    requestAnimationFrame(() => {
      resumenPendiente = false;
      acomodar();
      const cont = document.getElementById('inicio-resumen'); if (!cont) return;
      const chips = bloques().filter(visible).map(b => ({ b, e: estado(b) })).filter(({ e }) => e.filas.length || e.resumen || e.error)
        .map(({ b, e }) => `<button type="button" class="inicio-chip${e.urgente || e.error ? ' urgente' : ''}" data-inicio-ir="${esc(listaDe(b).id)}"><b>${esc(e.error ? '!' : e.resumen || String(e.filas.length))}</b> ${esc(b.dataset.tituloCorto || '')}</button>`);
      cont.innerHTML = chips.join('');
      cont.hidden = !chips.length;
    });
  }
  function iniciar() {
    const rejilla = document.getElementById('inicio-rejilla'); if (!rejilla) return;
    bloques().forEach((b, i) => { b.dataset.orden = String(i); b.style.order = String(i); });
    for (let c = 0; c < 2; c++) { const col = document.createElement('div'); col.className = 'inicio-col'; rejilla.appendChild(col); }
    bloques().forEach(b => { preparar(b); actualizar(b); });
    document.getElementById('inicio-resumen')?.addEventListener('click', ev => {
      const c = ev.target.closest('[data-inicio-ir]'); if (!c) return;
      const b = document.getElementById(c.dataset.inicioIr)?.closest('.inicio-bloque'); if (!b) return;
      guardar(claveDe(b), 'no'); actualizar(b);
      b.scrollIntoView({ block: 'start' });
      b.querySelector('.inicio-plegar')?.focus({ preventScroll: true });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
  return { actualizar: () => bloques().forEach(actualizar) };
})();
window.Inicio = Inicio;
