// Ayuda para pruebas cuyo tema NO es «qué ve cada rol» (dinero, sucursales, solicitudes, buscador…): deja los roles
// de fábrica como estaban antes de los niveles (cada quien ve toda su sucursal, con sus permisos de antes), para que
// esas pruebas sigan probando lo mismo que siempre. Lo que cada rol ve con los niveles nuevos lo prueba
// simulacion-alcance-roles.cjs.
// Uso: await require('./ayuda-alcance.cjs').comoAntes(pedir, tokenDeDireccion)
//   (pedir(método, ruta, token, cuerpo) → [estado, json])
const TODO = { ventas: 2, cxc: 2, cxp: 2, compras: 2 };
// Lo que cada rol podía hacer antes de los niveles (al sembrar niveles se quitan los permisos que ya no tienen sentido).
// Antes todos veían los importes («Ver importes» existe desde 2026-10-21).
const ANTES = {
  ventas: ['ordenes.importes', 'generador.cargar', 'ordenes.estatus', 'cobros.registrar', 'cobros.confirmar', 'cobranza.factura', 'gastos.registrar', 'catalogos.editar'],
  atencion: ['ordenes.importes', 'generador.cargar', 'ordenes.importe_ganada', 'ordenes.estatus', 'cobros.registrar', 'cobros.confirmar', 'cobros.directo', 'cobranza.factura', 'gastos.registrar', 'catalogos.editar'],
  tecnico: ['ordenes.importes', 'ordenes.estatus', 'cobros.registrar', 'cobros.confirmar', 'cobranza.factura', 'gastos.registrar', 'catalogos.editar'],
  costos: ['ordenes.importes', 'ordenes.estatus', 'cobros.registrar', 'cobros.confirmar', 'cobranza.factura', 'gastos.registrar', 'dinero.mover', 'compras.gestionar', 'catalogos.editar'],
};
async function comoAntes(pedir, A) {
  for (const [rol, permisos] of Object.entries(ANTES)) {
    const [s, j] = await pedir('PUT', '/roles/' + rol + '/permisos', A, { permisos, alcances: TODO });
    if (s !== 200) throw new Error('No se pudo dejar ' + rol + ' como antes: ' + JSON.stringify(j));
  }
}
module.exports = { comoAntes, TODO, ANTES };
