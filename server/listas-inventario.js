// Inventario de TODAS las listas desplegables del sistema (pedido de Dirección, 2026-11-13), agrupadas por de dónde
// salen sus opciones. La pantalla «Listas desplegables» (Ajustes, solo Dirección) lo muestra tal cual.
//  · Cada renglón agrupa las listas que comparten las mismas opciones; «selects» son sus claves según
//    server/listas-escaneo.js. La prueba tests/listas-inventario.test.cjs exige que cada <select> de las pantallas
//    esté aquí: si se agrega una lista nueva sin anotarla, falla.
//  · Grupos:
//      editable  → fijas en el código, pero sin cálculos detrás: aquí se agregan, renombran, ordenan y ocultan
//                  (las define server/listas.js; «lista» es su clave allí).
//      catalogo  → catálogos que ya tenían su pantalla para editarse («donde»).
//      registros → las opciones son registros del sistema (proveedores, usuarios…): cambian al darlos de alta o baja.
//      fija      → el sistema hace cuentas o toma decisiones con cada opción: no se agregan ni se quitan.
//      sat       → claves del catálogo del SAT: no se inventan (la factura se rechazaría).
//      filtro    → filtros y controles de pantalla: se arman solos.
//  · «filtros»: claves de listas que solo filtran (lo oculto ahí sí se sigue viendo, para buscar lo viejo).
const GRUPOS = {
  editable: { nombre: 'Se editan aquí', explicacion: 'Estaban escritas fijas en el código, pero ningún cálculo depende de ellas. Aquí se agregan, se renombran, se ordenan y se ocultan.' },
  catalogo: { nombre: 'Catálogos con su propia pantalla', explicacion: 'Ya se podían editar. Se editan donde dice «Dónde se edita», porque cada uno tiene datos de más (responsable, claves del SAT, días de recompra…).' },
  registros: { nombre: 'Salen de los registros', explicacion: 'No son una lista fija: son los proveedores, usuarios, personal, cuentas o proyectos dados de alta. Cambian al dar de alta, editar o dar de baja ese registro en su módulo.' },
  fija: { nombre: 'Fijas: el sistema hace cuentas con ellas', explicacion: 'Cada opción le dice al sistema qué hacer (calcular el IVA, sumar o no a la nómina, en qué paso va un proceso). Agregar o quitar una opción descuadraría esas cuentas.' },
  sat: { nombre: 'Del SAT', explicacion: 'Son claves oficiales del SAT. Una clave escrita a mano haría que la factura se rechace.' },
  filtro: { nombre: 'Filtros y controles de pantalla', explicacion: 'Sirven para buscar o para manejar la pantalla. Sus opciones salen solas de las demás listas o del propio filtro.' },
};

const INVENTARIO = [
  // ---- editable (server/listas.js) ----
  { grupo: 'editable', lista: 'puestos', nombre: 'Puestos del personal', selects: ['pe-puesto', 'nm-r-puesto'], filtros: ['pe-f-puesto'], aparece: 'Ficha del personal, reglas del bono de puntualidad (Nómina) y filtro de Personal' },
  { grupo: 'editable', lista: 'contratos', nombre: 'Tipos de contrato', selects: ['pe-tipo_contrato'], aparece: 'Ficha del personal (datos sensibles)' },
  { grupo: 'editable', lista: 'licencias', nombre: 'Tipos de licencia de manejo', selects: ['pe-licencia_tipo'], aparece: 'Ficha del personal' },
  { grupo: 'editable', lista: 'documentos_personal', nombre: 'Documentos del expediente del personal', selects: ['pe-doc-tipo'], aparece: 'Expediente del personal' },
  { grupo: 'editable', lista: 'tipos_gasto', nombre: 'Tipo de gasto (cada cuánto se repite)', selects: ['gasto-tipo-gasto', 'gp-tipo-gasto', 'cxp-datos-tipo'], aparece: 'Registrar gasto, gastos programados y datos de una cuenta por pagar (columna TIPO GASTO del Excel)' },
  { grupo: 'editable', lista: 'tipos_credito', nombre: 'Tipos de crédito', selects: ['cr-tipo'], aparece: 'Créditos (Cuentas por pagar)' },
  { grupo: 'editable', lista: 'documentos_oc', nombre: 'Documentos de la orden de compra', selects: ['oc-doc-tipo'], aparece: 'Expediente de la orden de compra' },
  { grupo: 'editable', lista: 'formatos_mk', nombre: 'Formatos de publicación', selects: ['mk-formato'], aparece: 'Marketing: calendario de publicaciones' },
  { grupo: 'editable', lista: 'rubros_mk', nombre: 'Rubros de gasto de marketing', selects: ['gm-rubro'], filtros: ['dn-f-rubro'], aparece: 'Marketing: presupuesto y gastos' },
  { grupo: 'editable', lista: 'carpetas_mk', nombre: 'Carpetas de la biblioteca de marketing', selects: ['bib-carpeta-subir'], filtros: ['bib-f-carpeta'], aparece: 'Marketing: biblioteca' },

  // ---- catalogo ----
  { grupo: 'catalogo', nombre: 'Tipos de cliente', selects: ['in-giro', 'fc-ed-giro'], filtros: ['fc-giro'], aparece: 'Alta y edición de contactos', donde: 'Configuración → Catálogos → Tipos de cliente' },
  { grupo: 'catalogo', nombre: '¿Cómo se enteró de nosotros? (canales)', selects: ['in-origen', 'fc-ed-origen', 'ed-canal', 'data-rs-canal'], filtros: ['fc-canal'], aparece: 'Contactos, cotizaciones y resultados de marketing', donde: 'Configuración → Catálogos → Cómo se enteraron de nosotros' },
  { grupo: 'catalogo', nombre: 'Servicios', selects: ['ed-servicio', 'sn-servicio', 'gc-servicio-*'], aparece: 'Cotizaciones, órdenes y generador', donde: 'Configuración → Catálogos → Catálogo de servicios' },
  { grupo: 'catalogo', nombre: 'Opciones de la parte que cambia de un servicio ([VOLUMEN]…)', selects: ['gc-op-*'], aparece: 'Partidas de la cotización', donde: 'Configuración → Catálogos → Catálogo de servicios (lista de cada servicio)' },
  { grupo: 'catalogo', nombre: 'Categorías de gasto', selects: ['gasto-categoria', 'prov-categoria', 'oc-categoria', 'gp-categoria', 'cr-categoria', 'rg-categoria', 'cc-g-cat-*'], aparece: 'Gastos, proveedores, órdenes de compra, gastos programados, créditos y conciliación', donde: 'Cuentas por pagar → Categorías' },
  { grupo: 'catalogo', nombre: 'Centros de costos', selects: ['oc-centro', 'sol-centro', 'gasto-centro'], aparece: 'Solicitudes, órdenes de compra y registrar gasto', donde: 'Compras → Centros de costos' },
  { grupo: 'catalogo', nombre: 'Unidades de medida', selects: ['oc-unidad'], aparece: 'Partidas de la orden de compra', donde: 'Compras → Unidades' },
  { grupo: 'catalogo', nombre: 'Sectores de prospección', selects: ['pr-sector_id'], filtros: ['pr-f-sector'], aparece: 'Prospección', donde: 'Prospección → Sectores' },
  { grupo: 'catalogo', nombre: 'Sucursales', selects: ['pe-sucursal_id', 'pe-kiosco-suc', 'mk-sucursal', 'py-sucursal', 'id-sucursal', 'as-p-suc', 'as-h-suc', 'nm-sucursal', 'ct-sucursal', 'sucursal-vista'], filtros: ['fx-l-sucursal'], aparece: 'Personal, marketing, asistencia, nómina, contabilidad y el cambio de sucursal', donde: 'Ajustes → Sucursales' },
  { grupo: 'catalogo', nombre: 'Roles', selects: ['nu-rol', 'usr-rol-*', 'rp-nuevo-copia'], aparece: 'Alta y edición de usuarios; copiar un rol', donde: 'Ajustes → Roles y permisos' },
  { grupo: 'catalogo', nombre: 'Series de factura', selects: ['data-fx-serie=serie_factura', 'data-fx-serie=serie_pago'], aparece: 'Facturación: series por sucursal', donde: 'Ajustes → Facturación (se crean en factura.com)' },

  // ---- registros ----
  { grupo: 'registros', nombre: 'Proveedores', selects: ['oc-proveedor', 'gasto-proveedor', 'gp-proveedor', 'cr-proveedor', 'sol-c-prov', 'rg-proveedor', 'cc-g-prov-*'], aparece: 'Compras, gastos, créditos y conciliación', donde: 'Cuentas por pagar → Proveedores' },
  { grupo: 'registros', nombre: 'Usuarios (responsables)', selects: ['ed-responsable', 'pr-responsable_id', 'mk-responsable', 'py-responsable', 'py-t-resp', 'tg-t-asignado', 'pe-usuario_id'], filtros: ['f-responsable', 'fc-atiende', 'pr-f-responsable', 'tg-f-persona'], aparece: 'Cotizaciones, prospección, marketing, tareas y ficha del personal', donde: 'Ajustes → Usuarios' },
  { grupo: 'registros', nombre: 'Personal', selects: ['ant-persona', 'data-eq-persona', 'data-eq-resp', 'reconocido'], aparece: 'Anticipos, equipo de la orden y encuesta de calidad', donde: 'RH → Personal' },
  { grupo: 'registros', nombre: 'Cuentas de banco', selects: ['cobro-cuenta', 'gasto-cuenta', 'pagoprov-cuenta-id', 'ant-cuenta-id', 'ant-r-cuenta-id', 'nm-p-cuenta-id', 'ct-cuenta', 'ct-mov-cuenta', 'cc-cuenta', 'cb-elegir', 'sin-nombre@contabilidad.js'], aparece: 'Cobros, pagos, anticipos, nómina, contabilidad y conciliación', donde: 'Contabilidad → Conciliación → Cuentas' },
  { grupo: 'registros', nombre: 'Horarios', selects: ['pe-horario'], aparece: 'Ficha del personal', donde: 'RH → Asistencia → Horarios' },
  { grupo: 'registros', nombre: 'Proyectos y tareas', selects: ['mk-proyecto', 'gm-proyecto', 'py-av-tarea', 'py-t-dep', 'tg-t-proyecto', 'tg-t-depende'], filtros: ['tg-f-proy', 'ga-campana'], aparece: 'Marketing y tareas', donde: 'Marketing → Proyectos / Tareas' },
  { grupo: 'registros', nombre: 'Datos fiscales del cliente', selects: ['data-fx-o=cliente_fiscal_id', 'data-fx-cli-liga'], aparece: 'Facturar una orden; importar clientes de factura.com', donde: 'Ficha del cliente → Datos fiscales' },

  // ---- fija ----
  { grupo: 'fija', nombre: 'Tipo de comprobante', selects: ['gasto-comprobante', 'gp-comprobante'], aparece: 'Registrar gasto y gastos programados', porque: '«Factura» propone y suma el IVA, «Informativo» no se suma a lo que se debe y cada tipo sale distinto en el Excel de cuentas por pagar.' },
  { grupo: 'fija', nombre: 'Forma de pago (vía)', selects: ['prov-forma-pago', 'rg-metodo', 'ant-via', 'ant-r-via', 'nm-p-via'], aparece: 'Proveedores, pagos, anticipos y nómina', porque: 'De la vía sale la forma de pago del complemento SAT (transferencia = 03, efectivo = 01…), el MÉTODO DE PAGO del Excel y la conciliación con el banco.' },
  { grupo: 'fija', nombre: 'Tipo de cobro', selects: ['cobro-tipo'], aparece: 'Registrar cobro', porque: 'Anticipo, pago y ajuste se suman distinto en el saldo del cliente.' },
  { grupo: 'fija', nombre: 'Qué pide el bot al checar por WhatsApp', selects: ['pe-wa-pide'], aparece: 'Ficha del personal (Reloj checador → Checar por WhatsApp)', porque: 'Cada opción le dice al bot qué pedir (foto, ubicación o nada) y decide si la checada vale o queda por revisar.' },
  { grupo: 'fija', nombre: 'Incidencias del personal', selects: ['pe-inc-tipo'], aparece: 'Ficha del personal', porque: 'Vacaciones, faltas, incapacidades y permisos cambian la nómina, el bono de puntualidad y los días de vacaciones.' },
  { grupo: 'fija', nombre: 'Periodo del sueldo', selects: ['pe-salario_periodo'], aparece: 'Ficha del personal', porque: 'Con él se calcula el sueldo diario y el precio del tiempo extra.' },
  { grupo: 'fija', nombre: 'Papel en la orden (responsable, operador, ayudante)', selects: ['data-eq-papel'], aparece: 'Equipo de la orden de servicio', porque: 'El reloj checador decide con él quién puede imprimir la orden y qué le toca a cada quien.' },
  { grupo: 'fija', nombre: 'Estados de la prospección', selects: ['pr-estado', 'pr-s-estado'], filtros: ['pr-f-estado'], aparece: 'Prospección', porque: '«No contactar» borra la próxima fecha y cada estado mueve la agenda de seguimiento.' },
  { grupo: 'fija', nombre: 'Cómo fue el contacto (llamada, WhatsApp…)', selects: ['pr-s-medio'], aparece: 'Seguimiento de prospección', porque: 'La base de datos solo acepta esas cinco opciones; agregar otra requiere cambiar la base.' },
  { grupo: 'fija', nombre: 'Prioridad de las tareas', selects: ['tg-t-prioridad'], aparece: 'Tareas', porque: 'La base de datos solo acepta alta, media y baja, y con ellas se ordena el Gantt.' },
  { grupo: 'fija', nombre: 'Estados de proyectos, publicaciones, tareas y objetivos', selects: ['py-estado', 'data-pl-estado'], filtros: ['py-f-estado', 'mk-f-estado', 'tg-f-estado'], aparece: 'Marketing y tareas', porque: 'Cada estado es un paso del proceso (aprobar, publicar, terminar): el sistema decide con él qué se puede hacer después.' },
  { grupo: 'fija', nombre: 'Redes sociales', selects: ['gm-red'], aparece: 'Gastos de marketing', porque: 'Cada red tiene sus propias métricas (alcance, reproducciones…) y su tablero.' },
  { grupo: 'fija', nombre: 'Tipo de checada', selects: ['ac-n-tipo'], aparece: 'Corregir asistencia', porque: 'Entrada, comida y salida son los pasos del reloj checador y con ellos se calculan horas, retardos y tiempo extra.' },
  { grupo: 'fija', nombre: 'Reglas del tiempo extra', selects: ['as-r-inicio', 'as-r-modo', 'as-r-bloque'], aparece: 'Asistencia → Reglas', porque: 'Son las opciones con las que se calcula el tiempo extra (inicio de semana, modo y bloques de minutos).' },
  { grupo: 'fija', nombre: 'Movimientos de banco (entró / salió y qué es)', selects: ['ct-mov-tipo', 'ct-mov-categoria'], aparece: 'Contabilidad → movimiento de banco', porque: 'Cada tipo se suma o se resta distinto en el flujo de bancos.' },
  { grupo: 'fija', nombre: 'Banco de la cuenta', selects: ['cc-n-banco'], aparece: 'Conciliación → nueva cuenta', porque: 'El sistema lee el estado de cuenta según el formato de cada banco.' },
  { grupo: 'fija', nombre: 'Tipo de serie de factura', selects: ['data-fx-nueva-tipo'], aparece: 'Ajustes → Facturación', porque: 'factura.com solo maneja series de factura y de complemento de pago.' },
  { grupo: 'fija', nombre: 'Revisión inicial de cobros', selects: ['data-revision-lead'], aparece: 'Cuentas por cobrar → revisión inicial', porque: 'Solo hay dos respuestas posibles: cobrada o pendiente.' },
  { grupo: 'fija', nombre: 'Qué ve cada rol (nivel)', selects: ['data-rp-nivel-rol'], aparece: 'Ajustes → Roles y permisos', porque: 'Nada, lo suyo, su sucursal o toda la empresa: con eso se filtra todo lo que ve cada rol.' },
  { grupo: 'fija', nombre: 'Cuenta de factura.com (producción o pruebas)', selects: ['fx-cli-entorno'], aparece: 'Ajustes → Facturación → importar clientes', porque: 'Solo existen esas dos cuentas en factura.com.' },

  // ---- sat ----
  { grupo: 'sat', nombre: 'Régimen fiscal', selects: ['data-fx-f=regimen'], aparece: 'Datos fiscales del cliente', porque: 'Catálogo c_RegimenFiscal del SAT.' },
  { grupo: 'sat', nombre: 'Uso del CFDI', selects: ['data-fx-f=uso_cfdi', 'data-fx-o=uso_cfdi'], aparece: 'Datos fiscales y facturar', porque: 'Catálogo c_UsoCFDI del SAT; además depende del régimen.' },
  { grupo: 'sat', nombre: 'Forma de pago del SAT', selects: ['data-fx-o=forma_pago', 'data-fx-comp-forma'], aparece: 'Facturar y complemento de pago', porque: 'Catálogo c_FormaPago del SAT.' },
  { grupo: 'sat', nombre: 'Método de pago (PUE / PPD)', selects: ['data-fx-o=metodo_pago', 'gasto-sat', 'fact-metodo'], aparece: 'Facturar, registrar gasto y datos de factura de la orden', porque: 'Catálogo c_MetodoPago del SAT: PUE o PPD.' },

  // ---- filtro ----
  { grupo: 'filtro', nombre: 'Filtros de búsqueda', selects: [], filtros: ['fc-tipo', 'sol-filtro', 'oc-filtro', 'fx-l-estatus', 'fx-l-entorno', 'pe-f-estado', 'pr-f-zona', 'pr-f-agenda', 'pr-f-datos', 'bib-f-origen', 'bit-entidad', 'logs-tipo', 'pagar-vista', 'prov-filtro', 'fc-mov-filtro', 'data-ct-filtro', 'tg-f-agrupar'], aparece: 'Arriba de cada tabla', porque: 'Solo cambian lo que se ve en la tabla.' },
  { grupo: 'filtro', nombre: 'Controles de carga y conciliación', selects: [], filtros: ['data-tipo=clientes', 'data-tipo=canales', 'data-tipo=productos', 'cc-m-*', 'as-anio'], aparece: 'Cargar el generador, columnas del estado de cuenta, año de días festivos', porque: 'Sus opciones salen del archivo que se sube o del calendario.' },
];

module.exports = { GRUPOS, INVENTARIO };
