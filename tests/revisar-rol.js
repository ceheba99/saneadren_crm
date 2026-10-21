// REVISIÓN POR ROL (se ejecuta DENTRO del navegador, sobre un demo sembrado con «node tests/sembrar-xss.cjs <url>»):
// con la sesión de cada usuario del demo recorre sus pantallas (tests/recorrido-pantallas.js), abre los registros
// sembrados que le toquen y junta:
//  · código trampa ejecutado (debe ser 0), errores de la página, elementos de permisos que no tiene, desbordes;
//  · qué datos sembrados RECIBE del servidor ese rol (la trampa lleva el nombre del campo: concat('campo')) y cuáles
//    se ven en alguna pantalla; lo que recibe y no ve en ningún lado es un dato capturado que ese rol no puede leer.
// Uso: insertar este archivo y recorrido-pantallas.js; llamar window.revisarRol({ lead, cliente, solicitud, oc, persona, prospecto })
async function revisarRol(ids = {}) {
  const espera = ms => new Promise(r => setTimeout(r, ms));
  const NOMBRE = /concat\('([^')]+)'\)/g;
  const vistos = new Set(), enCampos = new Set();
  window.__alRevisar = () => {
    for (const m of document.body.innerText.matchAll(NOMBRE)) vistos.add(m[1]);
    for (const el of document.querySelectorAll('input, textarea, select')) for (const m of String(el.value || '').matchAll(NOMBRE)) enCampos.add(m[1]);
  };
  const r = await recorrerPantallas({ maxClicsPorVista: 60 });
  const abrirPlegables = () => document.querySelectorAll('.overlay.mostrar [data-plegable]').forEach(s => { if (s.classList.contains('plegado')) s.querySelector('.seccion-tit, summary, button')?.click(); });
  const cerrar = () => document.querySelectorAll('.overlay.mostrar').forEach(o => o.classList.remove('mostrar'));
  // Lo que el servidor le entrega a este rol de cada registro sembrado.
  const recibe = new Set();
  const RUTAS = [['/leads/' + ids.lead], ['/clientes/' + ids.cliente], ['/compras/solicitudes/' + ids.solicitud], ['/compras/ordenes/' + ids.oc], ['/personal/' + ids.persona],
    ['/prospeccion/' + ids.prospecto], ['/finanzas/cxp'], ['/finanzas/proveedores'], ['/compras/centros'], ['/tipos-cliente'], ['/compras/unidades'], ['/leads/' + ids.lead + '/cobros']];
  const puede = {};
  for (const [ruta] of RUTAS) {
    try { const x = await fetch('/api' + ruta, { headers: { Authorization: 'Bearer ' + USUARIO_ACTUAL.token, ...encabezadoSucursal() } }); puede[ruta] = x.status; if (x.ok) for (const m of (await x.text()).matchAll(NOMBRE)) recibe.add(m[1]); } catch { /* sin acceso */ }
  }
  // Cada registro que el rol puede ver, abierto directamente (con sus secciones plegables abiertas).
  const pasos = [['/leads/' + ids.lead, () => abrirFicha(ids.lead)], ['/clientes/' + ids.cliente, () => abrirFichaCliente(ids.cliente)],
    ['/compras/solicitudes/' + ids.solicitud, () => Solicitudes.abrir(ids.solicitud)], ['/compras/ordenes/' + ids.oc, () => Compras.abrir(ids.oc)],
    ['/personal/' + ids.persona, () => Personal.abrir(ids.persona)], ['/prospeccion/' + ids.prospecto, () => Prospeccion.abrir(ids.prospecto)]];
  for (const [ruta, abrir] of pasos) {
    if (puede[ruta] !== 200) continue;
    try { await abrir(); await espera(1500); abrirPlegables(); await espera(800); window.__alRevisar(); } catch (e) { r.errores.push(ruta + ': ' + e.message); }
    cerrar();
  }
  // Ficha del proveedor sembrado (el recorrido no la abre sola), si el rol ve Cuentas por pagar.
  if (puede['/finanzas/proveedores'] === 200) {
    try {
      cambiarVista('cuentas'); await espera(2500);
      [...document.querySelectorAll('#vista-cuentas button')].find(b => /^proveedores/i.test(b.textContent.trim()))?.click(); await espera(2000);
      const prov = [...document.querySelectorAll('[data-ficha-prov]')].find(b => /Proveedor Trampa/.test(b.textContent)); prov?.click(); await espera(2500); abrirPlegables(); await espera(800); window.__alRevisar(); cerrar();
    } catch (e) { r.errores.push('proveedor: ' + e.message); }
  }
  delete window.__alRevisar;
  return {
    usuario: r.usuario, rol: r.rol, clics: r.clics, xss: window.__xss || 0, errores: r.errores, permisosVisibles: r.permisosVisibles, desbordes: r.desbordes, vacias: r.vacias,
    recibe: recibe.size, seVen: [...recibe].filter(n => vistos.has(n)).length,
    noLoVe: [...recibe].filter(n => !vistos.has(n) && !enCampos.has(n)),
    soloAlEditar: [...recibe].filter(n => !vistos.has(n) && enCampos.has(n)),
  };
}
window.revisarRol = revisarRol;
