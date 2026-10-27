// Ayuda para pruebas cuyo tema NO es «qué ve cada rol» (dinero, sucursales, solicitudes, buscador…): deja los roles
// de fábrica como estaban antes de los niveles (cada quien ve y edita toda su sucursal, con sus permisos de antes),
// para que esas pruebas sigan probando lo mismo que siempre. Lo que cada rol ve con los niveles nuevos lo prueban
// simulacion-alcance-roles.cjs y foto-roles.cjs.
// Uso: await require('./ayuda-alcance.cjs').comoAntes(pedir, tokenDeDireccion)
//   (pedir(método, ruta, token, cuerpo) → [estado, json])
const AREAS = ['contactos', 'prospeccion', 'generador', 'cotizaciones', 'ordenes', 'cxc', 'cxp', 'solicitudes', 'ordenes_compra'];
// Marketing (2026-10-26) no entra en «como antes»: es un área aparte que los roles de ventas no ven.
const TODO = Object.fromEntries(AREAS.map(a => [a, 2]));
const EDITA = { contactos: true, prospeccion: true, cotizaciones: true, ordenes: true, solicitudes: true };
// Lo que cada rol podía hacer antes de los niveles (al sembrar niveles se quitan los permisos que ya no tienen sentido).
// Antes todos veían los importes («Ver importes» existe desde 2026-10-21) y editaban cualquier orden de su sucursal
// («Editar lo de otros» y la edición por quien la hizo, desde 2026-10-26).
const COMUNES = ['ordenes.importes', 'ventas.editar_otros', 'compras.importes', 'reportes.analisis', 'cobros.registrar', 'cobros.confirmar', 'cobranza.factura', 'gastos.registrar', 'catalogos.editar'];
const ANTES = {
  ventas: [...COMUNES, 'generador.cargar'],
  atencion: [...COMUNES, 'generador.cargar', 'ordenes.importe_ganada', 'cobros.directo'],
  tecnico: [...COMUNES],
  costos: [...COMUNES, 'dinero.mover', 'compras.gestionar'],
};
async function comoAntes(pedir, A) {
  for (const [rol, permisos] of Object.entries(ANTES)) {
    const [s, j] = await pedir('PUT', '/roles/' + rol + '/permisos', A, { permisos, alcances: TODO, ediciones: EDITA });
    if (s !== 200) throw new Error('No se pudo dejar ' + rol + ' como antes: ' + JSON.stringify(j));
  }
}
module.exports = { comoAntes, TODO, EDITA, ANTES, AREAS };
