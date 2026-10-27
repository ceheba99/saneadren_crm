# Qué ve y qué hace cada rol

Foto generada por `tests/foto-roles.cjs` con un equipo de prueba: en Querétaro, Valeria y Bruno (ventas), Tomás y Tito (técnicos), Alicia (atención), Carlos (compras) y Gema (gerente); en CDMX, Diego (ventas). Cada columna es lo que le llega a esa persona al pedir **todas** las rutas del sistema, no solo lo que muestra la pantalla.

Dirección la revisa y la aprueba. Si un cambio altera lo que ve un rol, la prueba falla hasta actualizar la foto, y la diferencia se ve en el PR antes de subir.

## Pantallas del menú

| Pantalla | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras | Marketing | Gerente de marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 🏠 Inicio | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| 📅 Calendario | ✔ | ✔ | ✔ | ✔ | ✔ | — | — | — |
| 🎨 Marketing | ✔ | — | — | — | — | — | ✔ | ✔ |
| ➕ Nuevo contacto | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| 👥 Contactos | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| 📒 Generador | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| 📄 Cotizaciones | ✔ | ✔ | ✔ | ✔ | ✔ | — | — | — |
| 🔎 Prospección | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| 📥 Cuentas por cobrar | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| 📤 Cuentas por pagar | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| 🏭 Proveedores | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| 📝 Solicitudes de compra | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| 🛒 Órdenes de compra | ✔ | ✔ | ✔ | ✔ | — | ✔ | — | — |
| 📊 Resultados | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| 👷 Personal | ✔ | ✔ | — | — | — | — | — | — |
| 📚 Catálogos | ✔ | ✔ | — | — | — | ✔ | — | — |
| 👤 Usuarios | ✔ | ✔ | — | — | — | — | — | — |
| 🗂️ Bitácora | ✔ | — | — | — | — | — | — | — |

## Qué ve en cada área (Roles y permisos)

| Área | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras | Marketing | Gerente de marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Contactos | Todo | Toda su sucursal ✎ | Lo suyo ✎ | Toda su sucursal ✎ | Nada | Nada | Nada | Nada |
| Prospección | Todo | Toda su sucursal ✎ | Lo suyo ✎ | Toda su sucursal ✎ | Nada | Nada | Nada | Nada |
| Generador | Todo | Toda su sucursal | Lo suyo | Toda su sucursal | Nada | Nada | Nada | Nada |
| Cotizaciones | Todo | Toda su sucursal ✎ | Lo suyo ✎ | Toda su sucursal ✎ | Nada | Nada | Nada | Nada |
| Órdenes de servicio | Todo | Toda su sucursal ✎ | Lo suyo ✎ | Toda su sucursal ✎ | Lo suyo | Nada | Nada | Nada |
| Cuentas por cobrar | Todo | Toda su sucursal | Lo suyo | Toda su sucursal | Solo lo que él registra | Nada | Nada | Nada |
| Cuentas por pagar | Todo | Toda su sucursal | Lo suyo | Lo suyo | Lo suyo | Toda su sucursal | Nada | Nada |
| Solicitudes de compra | Todo | Toda su sucursal ✎ | Lo suyo ✎ | Lo suyo ✎ | Lo suyo ✎ | Toda su sucursal ✎ | Nada | Nada |
| Órdenes de compra | Todo | Toda su sucursal | Lo suyo | Lo suyo | Nada | Toda su sucursal | Nada | Nada |
| Marketing | Todo | Nada | Nada | Nada | Nada | Nada | Toda la empresa ✎ | Toda la empresa ✎ |

## Qué datos le llegan

### Ventas

| Dato | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras | Marketing | Gerente de marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Orden de Valeria (vendedora), asignada a Tomás (técnico): cliente y servicio | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| … y su importe | ✔ | ✔ | ✔ | ✔ | ✔ | — | — | — |
| Cotización de Bruno (otro vendedor de la sucursal): cliente | ✔ | ✔ | — | ✔ | — | — | — | — |
| … y su importe | ✔ | ✔ | — | ✔ | — | — | — | — |
| Orden de Bruno asignada a Tito (otro técnico): cliente | ✔ | ✔ | — | ✔ | — | ✔ | — | — |
| Orden de Diego (otra sucursal): cliente | ✔ | — | — | — | — | — | — | — |

### Cuentas por cobrar

| Dato | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras | Marketing | Gerente de marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Cobro que registró Tomás (técnico) en la orden de Valeria | ✔ | ✔ | ✔ | ✔ | ✔ | — | — | — |
| Cobro que registró Alicia (atención) en la orden de Valeria | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| Saldo de la orden de Valeria (lo que debe el cliente) | ✔ | ✔ | ✔ | ✔ | — | — | — | — |

### Cuentas por pagar

| Dato | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras | Marketing | Gerente de marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Gasto que registró Tomás (técnico) en la orden de Valeria | ✔ | ✔ | ✔ | — | ✔ | ✔ | — | — |
| Gasto que registró Valeria (ventas) en su orden | ✔ | ✔ | ✔ | — | — | ✔ | — | — |
| Gasto que registró Carlos (compras) en la orden de Bruno | ✔ | ✔ | — | — | — | ✔ | — | — |
| Gasto que registró Alicia (atención) en la orden de Bruno | ✔ | ✔ | — | ✔ | — | ✔ | — | — |

### Proveedores

| Dato | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras | Marketing | Gerente de marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Datos bancarios de un proveedor (CLABE) | ✔ | ✔ | — | — | — | ✔ | — | — |

### Compras

| Dato | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras | Marketing | Gerente de marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Solicitud de compra de Tomás | ✔ | ✔ | — | — | ✔ | ✔ | — | — |
| Solicitud de compra de Valeria | ✔ | ✔ | ✔ | — | — | ✔ | — | — |

### Encuesta

| Dato | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras | Marketing | Gerente de marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Aviso «cliente insatisfecho» de la encuesta de la orden de Valeria | ✔ | ✔ | ✔ | — | — | — | — | — |

### Prospección

| Dato | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras | Marketing | Gerente de marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Prospecto de Valeria | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| Prospecto de Bruno | ✔ | ✔ | — | ✔ | — | — | — | — |

### Marketing

| Dato | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras | Marketing | Gerente de marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Publicación de Mara (Marketing) para Querétaro | ✔ | — | — | — | — | — | ✔ | ✔ |
| Publicación para toda la empresa | ✔ | — | — | — | — | — | ✔ | ✔ |
| Publicación de CDMX (otra sucursal) | ✔ | — | — | — | — | — | ✔ | ✔ |
| Proyecto de marketing de Mara, con sus tareas y avances | ✔ | — | — | — | — | — | ✔ | ✔ |
| Idea de Mara en el banco de ideas | ✔ | — | — | — | — | — | ✔ | ✔ |
| Archivo de la biblioteca de marketing | ✔ | — | — | — | — | — | ✔ | ✔ |

### Personal

| Dato | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras | Marketing | Gerente de marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Un empleado activo: nombre y puesto (para asignarlo a una orden) | ✔ | ✔ | ✔ | ✔ | ✔ | — | — | — |
| Su ficha: teléfono, licencia, ingreso | ✔ | ✔ | — | — | — | — | — | — |
| Sus datos sensibles: CLABE y salario | ✔ | ✔ | — | — | — | — | — | — |

### Reportes

| Reporte | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras | Marketing | Gerente de marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Generador | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| Resultados · análisis comercial | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| Resultados · panorama general | ✔ | ✔ | — | — | — | — | — | — |

## Qué puede hacer

| Acción (se intenta de verdad) | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras | Marketing | Gerente de marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Editar la orden de Valeria (cliente, servicio, técnico…) | ✔ | ✔ | ✔ | — | — | — | — | — |
| Editar la orden de Bruno (otro vendedor) | ✔ | ✔ | — | — | — | — | — | — |
| Editar el contacto de Valeria | ✔ | ✔ | ✔ | — | — | — | — | — |
| Marcar realizada una orden de Valeria | ✔ | ✔ | ✔ | — | — | — | — | — |
| Borrar una cotización de Valeria | ✔ | — | — | — | — | — | — | — |
| Editar la publicación de Mara (Marketing) | ✔ | — | — | — | — | — | ✔ | ✔ |
| Comentar la publicación de Mara | ✔ | — | — | — | — | — | ✔ | ✔ |
| Aprobar una publicación en revisión | ✔ | — | — | — | — | — | — | ✔ |
| Editar el proyecto de marketing de Mara (datos, tareas y avances) | ✔ | — | — | — | — | — | ✔ | ✔ |
| Votar y comentar la idea de Mara | ✔ | — | — | — | — | — | ✔ | ✔ |
| Aprobar o descartar una idea | ✔ | — | — | — | — | — | — | ✔ |
| Subir un archivo a la biblioteca de marketing | ✔ | — | — | — | — | — | ✔ | ✔ |

| Permiso | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras | Marketing | Gerente de marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Contactos y clientes · Exportar a Excel | ✔ | ✔ | — | — | — | — | — | — |
| Cotizaciones y órdenes · Ver importes | ✔ | ✔ | ✔ | ✔ | ✔ | — | — | — |
| Cotizaciones y órdenes · Editar lo de otros | ✔ | ✔ | — | — | — | — | — | — |
| Cotizaciones y órdenes · Cargar el generador | ✔ | ✔ | — | ✔ | — | — | — | — |
| Cotizaciones y órdenes · Cambiar importe o IVA de una orden | ✔ | ✔ | — | ✔ | — | — | — | — |
| Cuentas por cobrar · Registrar cobros | ✔ | ✔ | ✔ | ✔ | ✔ | — | — | — |
| Cuentas por cobrar · Confirmar cobros | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| Cuentas por cobrar · Sus cobros entran ya confirmados | ✔ | ✔ | — | ✔ | — | — | — | — |
| Cuentas por cobrar · Crédito y datos de factura | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| Cuentas por cobrar · Ajustes, descuentos y revisión inicial | ✔ | ✔ | — | — | — | — | — | — |
| Cuentas por pagar · Registrar gastos de una orden | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| Cuentas por pagar · Ver los gastos de sus órdenes | ✔ | ✔ | ✔ | — | — | — | — | — |
| Cuentas por pagar · Mover dinero | ✔ | ✔ | — | — | — | ✔ | — | — |
| Compras · Ver montos de compras | ✔ | ✔ | ✔ | ✔ | — | ✔ | — | — |
| Compras · Gestionar compras | ✔ | ✔ | — | — | — | ✔ | — | — |
| Compras · Aprobar sus propias solicitudes | ✔ | ✔ | — | — | — | — | — | — |
| Compras · Autorizar órdenes de compra | ✔ | ✔ | — | — | — | — | — | — |
| Reportes · Análisis comercial | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| Reportes · Panorama general | ✔ | ✔ | — | — | — | — | — | — |
| Catálogos · Catálogos compartidos | ✔ | ✔ | — | — | — | ✔ | — | — |
| Personal · Ver personal | ✔ | ✔ | — | — | — | — | — | — |
| Personal · Editar personal | ✔ | ✔ | — | — | — | — | — | — |
| Personal · Datos sensibles del personal | ✔ | ✔ | — | — | — | — | — | — |
| Administración · Usuarios | ✔ | ✔ | — | — | — | — | — | — |
| Marketing · Aprobar publicaciones | ✔ | — | — | — | — | — | — | ✔ |

## Reglas acordadas que se revisan una por una

- **2026-10-19** · Dirección ve todo, en todas las sucursales.
- **2026-10-19** · Gerente: todo lo de su sucursal, nada de otra.
- **2026-10-19** · Ventas ve lo suyo: sus clientes, cotizaciones y órdenes (no las de otro vendedor ni de otra sucursal) y la cobranza de sus órdenes.
- **2026-10-19** · Técnico, en cuentas por pagar: solo los gastos que él registró.
- **2026-10-22** · Ventas, en cuentas por pagar: los gastos que registró y todos los de sus órdenes, aunque los anote otra persona.
- **2026-10-22** · Atención, en cuentas por pagar: solo los gastos que ella registró.
- **2026-10-22** · Catálogos compartidos: los cambian Dirección, Gerente y Compras; Ventas, Atención y Técnico no.
- **2026-10-22** · Costos y compras no registra cobros (no abre órdenes de servicio).
- **2026-10-22** · La CLABE de los proveedores solo la ve quien paga (Dirección, Gerente y Compras); Ventas, Atención y Técnico no.
- **2026-10-19** · En compras, ventas y técnico ven solo lo que ellos pidieron.
- **2026-10-19** · Atención: ventas y cobranza de toda su sucursal.
- **2026-10-19** · Técnico: solo las órdenes que tiene asignadas.
- **2026-10-19** · Costos y compras: ve folio y cliente de las órdenes para ligar gastos, sin montos de venta ni cobranza; todas las cuentas por pagar y compras de su sucursal.
- **2026-10-21** · Técnico, en cuentas por cobrar: solo los cobros que él registró (sin saldos ni vencidos).
- **2026-10-26** · Técnico: ve el importe de sus órdenes, pero no las modifica; sin Generador ni Resultados (antes, 2026-10-21, no veía importes).
- **2026-10-26** · Contactos, cotizaciones y órdenes: los edita quien los capturó o los tiene a su nombre, el Gerente y Dirección. Quien solo los ve (Atención con lo de otra persona, Técnico, Compras) no los cambia.
- **2026-10-26** · Marcar si se realizó: quien hizo la orden, el Gerente y Dirección (el técnico todavía no).
- **2026-10-26** · Borrar (cotizaciones, órdenes, usuarios, roles, catálogos): solo Dirección.
- **2026-10-26** · Encuesta: el aviso de cliente insatisfecho le llega a Dirección, al gerente y al responsable de la orden; no a quien solo ve la orden.
- **2026-10-26** · Técnico: ve su solicitud de compra, no las de otros, y no ve montos de compras.
- **2026-10-21** · Prospección: cada quien lo suyo (quien ve toda su sucursal en ventas, todos los de su sucursal); el técnico no prospecta.
- **2026-10-19** · Personal: quien ve órdenes ve nombre y puesto del personal activo, para asignarlo a una orden; la ficha y los datos sensibles, solo Gerente y Dirección.
- **2026-10-26** · Marketing: aprueban las publicaciones Dirección y el Gerente de marketing; nadie más (ni Marketing, aunque la haya escrito).
- **2026-10-26** · Marketing y Gerente de marketing: ven, editan y comentan las publicaciones de toda la empresa (de cualquier sucursal y las generales), y nada más del sistema: ni ventas, cobranza, gastos, compras, prospección ni personal.
- **2026-10-26** · Los demás roles (Gerente, Ventas, Atención, Técnico, Compras) no ven Marketing; Dirección lo puede prender en Roles y permisos.
- **2026-10-26** · Dirección ve y aprueba todo Marketing.
- **2026-10-27** · Banco de ideas: las proponen, votan y comentan Marketing, Gerente de marketing y Dirección; las aprueban o descartan solo Dirección y el Gerente de marketing. Los demás roles no ven las ideas.
- **2026-10-27** · Biblioteca de marketing (logos, fotos, plantillas): la ven y usan Marketing, Gerente de marketing y Dirección; los demás roles no.
- **2026-10-26** · Proyectos de marketing (tareas, Gantt y avances): los ven y editan Marketing, Gerente de marketing y Dirección; los demás roles no.
