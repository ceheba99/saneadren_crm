// DATOS CAPTURADOS QUE NO SE VEN (se ejecuta DENTRO del navegador, en un servidor demo, después de
// «node tests/sembrar-xss.cjs <url> --marcas», que pone una marca única QQnQQ en cada campo de texto y dice de qué campo es).
// Recorre todas las pantallas (tests/recorrido-pantallas.js) y además abre cada registro sembrado; en cada paso junta
// dónde aparece cada marca:
//  · «texto»: se lee en la pantalla;
//  · «campo»: solo dentro de un campo para editar (se ve al editar, pero no en listas ni fichas);
//  · «plegado»: está en la página, en una sección cerrada o escondida.
// Lo que no aparece en ningún lado es un dato que se captura y nadie vuelve a ver.
// Uso: insertar este archivo y recorrido-pantallas.js como <script>, y llamar
//   window.buscarMarcas({ marcas, lead, cliente, solicitud, oc, persona, proveedor })   (lo que imprimió el sembrado)
async function buscarMarcas({ marcas, lead, cliente, solicitud, oc, persona, prospecto } = {}) {
  const espera = ms => new Promise(r => setTimeout(r, ms));
  const vistas = { texto: new Map(), campo: new Map(), plegado: new Map() };
  const anota = (tipo, m, donde) => { if (!vistas[tipo].has(m)) vistas[tipo].set(m, donde); };
  const RE = /QQ\d+QQ/g;
  window.__alRevisar = donde => {
    for (const m of document.body.innerText.match(RE) || []) anota('texto', m, donde);
    for (const el of document.querySelectorAll('input, textarea, select')) for (const m of String(el.value || '').match(RE) || []) anota('campo', m, donde);
    for (const m of document.body.textContent.match(RE) || []) anota('plegado', m, donde);
  };
  const recorrido = await recorrerPantallas({ maxClicsPorVista: 60 });
  // Cada registro sembrado, abierto directamente, con sus secciones plegables abiertas.
  const abrirPlegables = () => document.querySelectorAll('.overlay.mostrar [data-plegable]').forEach(s => { if (s.classList.contains('plegado')) s.querySelector('.seccion-tit, summary, button')?.click(); });
  const pasos = [
    ['ficha del contacto', () => abrirFichaCliente(cliente)], ['ficha de la orden', () => abrirFicha(lead)],
    ['solicitud de compra', () => Solicitudes.abrir(solicitud)], ['orden de compra', () => Compras.abrir(oc)],
    ['ficha de la persona', () => Personal.abrir(persona)], ['establecimiento', () => Prospeccion.abrir(prospecto)],
  ];
  for (const [donde, abrir] of pasos) {
    try { await abrir(); } catch (e) { recorrido.errores.push(donde + ': ' + e.message); continue; }
    await espera(1500); abrirPlegables(); await espera(800); window.__alRevisar(donde);
    document.querySelectorAll('.overlay.mostrar').forEach(o => o.classList.remove('mostrar'));
  }
  delete window.__alRevisar;
  const fila = m => ({ marca: m, campo: marcas?.[m] || '?' });
  const todas = Object.keys(marcas || {});
  return {
    nunca: todas.filter(m => !vistas.plegado.has(m) && !vistas.campo.has(m)).map(fila),
    soloAlEditar: todas.filter(m => !vistas.texto.has(m) && vistas.campo.has(m)).map(m => ({ ...fila(m), donde: vistas.campo.get(m) })),
    soloPlegado: todas.filter(m => !vistas.texto.has(m) && !vistas.campo.has(m) && vistas.plegado.has(m)).map(m => ({ ...fila(m), donde: vistas.plegado.get(m) })),
    seVen: todas.filter(m => vistas.texto.has(m)).length, total: todas.length,
    errores: recorrido.errores, xss: recorrido.xss, clics: recorrido.clics,
  };
}
window.buscarMarcas = buscarMarcas;
