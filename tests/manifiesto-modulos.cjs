// MANIFIESTO DE MÓDULOS: qué es cada parte del sistema y en qué lugares DEBE aparecer. La auditoría total
// (tests/auditoria-total.cjs) lo compara contra lo que de verdad hay en el código y en la base:
//  · todo lo que existe (tablas, rutas, pantallas) tiene que pertenecer a un módulo de aquí → nada nuevo se escapa;
//  · todo lo que un módulo declara (pantalla, bloque en Inicio, revisión de integridad, ejemplos en el demo, buscador,
//    permisos) tiene que existir → no se olvida conectar nada (como pasó con los avisos de Personal en Inicio).
// Al crear un módulo nuevo: agrégalo aquí. Si algo NO aplica, se dice con su razón (nunca se deja vacío sin explicar).
module.exports = {
  modulos: {
    ventas: {
      nombre: 'Contactos, cotizaciones y órdenes de servicio',
      vistas: ['alta', 'leads', 'clientes', 'calendario', 'generador'],
      tablas: ['clientes', 'clientes_alias', 'clientes_distintos', 'clientes_fusionados', 'telefonos_cliente', 'leads', 'historial', 'historial_archivo', 'canales', 'canales_alias', 'tipos_cliente', 'catalogo_servicios', 'servicios_alias', 'contadores_folio', 'orden_personal'],
      rutas: [/^\/api\/(leads|contactos|clientes|servicios|canales|tipos-cliente|recompras|alertas|generador|historial)(\/|$)/],
      pendientes: 'recordatorios vencidos, cotizaciones sin movimiento, servicios por concluir y recompras',
      inicio: ['inicio-cotizaciones', 'inicio-concluir', 'inicio-recompras'],
      demo: ['clientes', 'leads', 'historial', 'orden_personal'],
      integridad: ['leads', 'clientes'],
      buscador: ['leads', 'clientes'],
      permisos: ['ventas.ver', 'contactos.ver', 'contactos.sucursal', 'contactos.empresa', 'contactos.editar', 'cotizaciones.ver', 'cotizaciones.sucursal', 'cotizaciones.empresa', 'cotizaciones.editar',
        'ordenes.ver', 'ordenes.sucursal', 'ordenes.empresa', 'ordenes.editar', 'generador.ver', 'generador.sucursal', 'generador.empresa',
        'ordenes.importes', 'ventas.editar_otros', 'generador.cargar', 'ordenes.importe_ganada', 'clientes.exportar'],
    },
    cobranza: {
      nombre: 'Cuentas por cobrar',
      vistas: ['cuentas'],
      tablas: ['cobros'],
      rutas: [/^\/api\/finanzas\/(resumen|cartera|cobros|por-confirmar|clientes|periodo|revision-inicial|importar\/cxc)(\/|$)/, /^\/api\/leads\/\d*:?id?\/?(cobros|facturacion)/],
      pendientes: 'lo que te deben, lo vencido y los pagos por confirmar',
      inicio: ['inicio-dinero'],
      demo: ['cobros'],
      integridad: ['cobros'],
      buscador: null, buscadorRazon: 'los cobros se buscan por su orden de servicio (folio OS)',
      permisos: ['cxc.ver', 'cxc.sucursal', 'cxc.empresa', 'cobros.registrar', 'cobros.confirmar', 'cobros.directo', 'cobranza.factura', 'cobros.ajustes'],
    },
    pagar: {
      nombre: 'Cuentas por pagar y proveedores',
      vistas: [],
      vistasRazon: 'vive como pestaña dentro de «cuentas» (Finanzas)',
      tablas: ['cuentas_por_pagar', 'pagos_proveedor', 'proveedores', 'categorias_gasto'],
      rutas: [/^\/api\/finanzas\/(cxp|pagos-proveedor|proveedores|categorias|comprobantes|ordenes-para-gasto|importar\/cxp)(\/|$)/, /^\/api\/calendario(\/atrasados)?$/],
      pendientes: 'lo que hay que pagar esta semana y lo vencido con proveedores',
      inicio: ['inicio-dinero'],
      demo: ['cuentas_por_pagar', 'pagos_proveedor', 'proveedores'],
      integridad: ['cuentas_por_pagar', 'pagos_proveedor'],
      buscador: ['proveedores'],
      permisos: ['cxp.ver', 'cxp.sucursal', 'cxp.empresa', 'gastos.registrar', 'gastos.ver_orden', 'dinero.mover'],
    },
    compras: {
      nombre: 'Solicitudes y órdenes de compra',
      vistas: ['solicitudes', 'compras'],
      tablas: ['solicitudes_compra', 'documentos_solicitud', 'ordenes_compra', 'documentos_oc', 'centros_costo', 'unidades_medida'],
      rutas: [/^\/api\/compras(\/|$)/],
      pendientes: 'solicitudes por aprobar o por cotizar, órdenes de compra por autorizar y por recibir',
      inicio: ['inicio-compras'],
      demo: ['solicitudes_compra', 'documentos_solicitud', 'ordenes_compra', 'documentos_oc'],
      integridad: ['ordenes_compra', 'solicitudes_compra', 'documentos_oc', 'documentos_solicitud'],
      buscador: ['ordenes_compra', 'solicitudes_compra'],
      permisos: ['compras.ver', 'solicitudes.ver', 'solicitudes.sucursal', 'solicitudes.empresa', 'solicitudes.editar', 'ordenes_compra.ver', 'ordenes_compra.sucursal', 'ordenes_compra.empresa',
        'compras.importes', 'compras.gestionar', 'compras.aprobar_propias', 'compras.autorizar'],
    },
    personal: {
      nombre: 'Personal (RH)',
      vistas: ['personal'],
      tablas: ['personal', 'documentos_personal', 'incidencias_personal'],
      rutas: [/^\/api\/personal(\/|$)/],
      pendientes: 'licencias y contratos por vencer, quién falta esta semana y órdenes sin técnico responsable',
      inicio: ['inicio-personal'],
      demo: ['personal', 'documentos_personal', 'incidencias_personal'],
      integridad: ['personal', 'documentos_personal', 'incidencias_personal'],
      buscador: null, buscadorRazon: 'datos personales: no se exponen en el buscador general (se buscan dentro de Personal, con permiso)',
      permisos: ['personal.ver', 'personal.editar', 'personal.sensibles'],
    },
    prospeccion: {
      nombre: 'Prospección',
      vistas: ['prospeccion'],
      tablas: ['establecimientos', 'sectores_prospeccion'],
      rutas: [/^\/api\/prospeccion(\/|$)/],
      pendientes: 'establecimientos a los que toca llamar hoy o ya pasó su fecha de seguimiento',
      inicio: ['inicio-prospeccion'],
      demo: ['establecimientos'],
      integridad: null, integridadRazon: 'son prospectos sin dinero ni folios: no hay nada que deba cuadrar',
      buscador: null, buscadorRazon: 'se buscan dentro de Prospección (filtro propio)',
      permisos: ['prospeccion.ver', 'prospeccion.sucursal', 'prospeccion.empresa', 'prospeccion.editar'],
    },
    reportes: {
      nombre: 'Resultados y análisis',
      vistas: ['resultados'],
      tablas: [],
      rutas: [/^\/api\/(tablero|kpis|analisis)(\/|$)/],
      pendientes: null, pendientesRazon: 'solo consulta: sus alertas se ven dentro de Resultados',
      inicio: [],
      demo: [], integridad: null, integridadRazon: 'no guarda datos propios; la auditoría compara Resultados con el Generador',
      buscador: null, buscadorRazon: 'no tiene registros propios',
      permisos: ['reportes.analisis', 'reportes.panorama'],
    },
    administracion: {
      nombre: 'Usuarios, roles, sucursales, catálogos, bitácora y respaldos',
      vistas: ['usuarios', 'catalogos', 'bitacora'],
      tablas: ['usuarios', 'usuario_sucursales', 'roles', 'rol_permisos', 'rol_alcances', 'permisos_sembrados', 'sucursales', 'auditoria'],
      rutas: [/^\/api\/(usuarios|roles|permisos|sucursales|auditoria|admin|cambiar-password|buscar)(\/|$)/],
      pendientes: null, pendientesRazon: 'la revisión de integridad y la bitácora se consultan a propósito; no generan pendientes diarios',
      inicio: [],
      demo: ['usuarios', 'roles', 'sucursales', 'auditoria'],
      integridad: ['usuarios', 'sucursales'],
      buscador: null, buscadorRazon: 'cuentas y configuración no se buscan desde el buscador general',
      permisos: ['usuarios.administrar', 'catalogos.editar'],
    },
  },
  // Tablas internas del funcionamiento (no son de ningún módulo de negocio) y por qué.
  internas: {
    sesiones: 'sesiones abiertas (solo el hash del token)', tokens_cuenta: 'enlaces de un solo uso (restablecer contraseña)',
    config_servidor: 'datos internos del servidor (huella del admin inicial, marca de base demo)', migraciones_hechas: 'control de migraciones ya aplicadas',
  },
  // Tablas con columna de sucursal que a propósito NO se separan por sucursal, y por qué.
  sucursalCompartida: {
    clientes: 'los clientes se comparten entre sucursales (decisión del 2026-10); los de otra sucursal se enmascaran',
    contadores_folio: 'contador interno de folios por sucursal; nadie lo consulta desde la pantalla',
  },
  // Datos que la pantalla muestra y que NO salen de un formulario con su mismo nombre: los genera el sistema (razón) o
  // se capturan con otro nombre ({ como, razon }: la auditoría comprueba que la pantalla mande esa llave). Un dato que se
  // muestra y no está aquí ni se captura es un dato muerto (como «Realizó: propio/subcontratado», que se quitó).
  generados: {
    orden_generador: 'número de orden que trae el Excel del Generador al cargarlo',
    correo_verificado: 'lo marca el sistema al confirmar el correo o cuando un administrador lo captura',
    accion: 'la escribe el sistema en la bitácora',
    bytes: 'tamaño del archivo subido',
    oc_id: 'liga que pone el sistema al hacer la orden de compra de una solicitud',
    reabierta_total_cent: 'lo anota el sistema al regresar una orden a cotización, para avisar si se vuelve a ganar con otro importe',
    confirmado: 'lo marca el botón «Confirmar» de los cobros por confirmar',
    solicitante_id: 'quien capturó la solicitud (su sesión)',
    motivo_cancelacion: { como: 'motivo', razon: 'se pide al cancelar un cobro, una cuenta, un pago, una orden de compra o una incidencia' },
    motivo_eliminado: { como: 'motivo', razon: 'se pide al quitar un documento' },
    motivo_no_realizado: { como: 'motivo', razon: 'se pide al marcar que un servicio no se realizó' },
    motivo_cierre: { como: 'motivo', razon: 'se pide al rechazar o cancelar una solicitud de compra' },
    recibio_nombre: { como: 'recibio', razon: 'quién recibió, al marcar recibida la orden de compra' },
    recepcion_nota: { como: 'nota', razon: 'nota de la recepción de la orden de compra' },
    fecha_realizado: { como: 'fecha', razon: 'fecha en que se realizó, al marcar el servicio' },
    fecha_baja: { como: 'fecha', razon: 'fecha de la baja del personal' },
    ganadora_id: { como: 'cotizacion_id', razon: 'la cotización elegida de la solicitud' },
  },
  // Formularios con una ventana para CREAR y otra para EDITAR lo mismo: deben pedir los mismos datos (la auditoría compara
  // sus campos: input, select, textarea y los selectores que arma la pantalla, marcados con data-campo). Lo que solo está
  // en uno se declara aquí con su razón. Así se detecta lo que pasó con el equipo de la orden: al crear era texto libre y
  // al editar, la lista de Personal. Los formularios que sirven para crear y editar a la vez (proveedor, persona, orden de
  // compra, catálogos) son iguales por construcción.
  formularios: {
    'orden de servicio / cotización': {
      alta: 'sn-', edicion: 'ed-',
      equivalentes: { fecha: 'fecha-servicio', ubicacion: 'direccion' },
      soloEdicion: {
        canal: 'al crear se toma de «¿Cómo se enteró?» del contacto',
        responsable: 'al crear queda a nombre de quien la registra («Atendido por» se cambia después)',
        urgente: 'se marca después en «Avisos y notas» del registro, junto con notas y recordatorios',
        'encuesta-calificacion': 'la encuesta se contesta después de hacer el servicio',
        'encuesta-comentario': 'la encuesta se contesta después de hacer el servicio',
      },
      soloAlta: {},
    },
    contacto: { alta: 'in-', edicion: 'fc-ed-', equivalentes: {}, soloEdicion: {}, soloAlta: {} },
  },
  // Entradas del menú que llevan a una pantalla con otro nombre (pestañas de la misma pantalla).
  aliasMenu: { cobrar: 'cuentas', pagar: 'cuentas', proveedores: 'cuentas' },
  // Rutas que no pertenecen a un módulo: públicas y de cuenta propia.
  rutasGenerales: [/^\/api\/(salud|login|logout|registro|verificar-correo|olvide-password|restablecer-password|demo)(\/|$)/],
  // Recursos compartidos por todas las sucursales (verlos desde otra sucursal es correcto).
  compartidos: [/^\/api\/(servicios|canales|tipos-cliente|roles|permisos|sucursales|compras\/(centros|unidades|formato|formatos-documento)|finanzas\/(categorias|comprobantes|proveedores)|prospeccion\/sectores|personal\/catalogos)(\/|$)/, /^\/api\/clientes(\/|$)/],
};
