# Qué ve y qué hace cada rol

Foto generada por `tests/foto-roles.cjs` con un equipo de prueba: en Querétaro, Valeria y Bruno (ventas), Tomás y Tito (técnicos), Alicia (atención), Carlos (compras) y Gema (gerente); en CDMX, Diego (ventas). Cada columna es lo que le llega a esa persona al pedir **todas** las rutas del sistema, no solo lo que muestra la pantalla.

Dirección la revisa y la aprueba. Si un cambio altera lo que ve un rol, la prueba falla hasta actualizar la foto, y la diferencia se ve en el PR antes de subir.

## Pantallas del menú

| Pantalla | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| 🏠 Inicio | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| 📅 Calendario | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| ➕ Nuevo contacto | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| 👥 Contactos | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| 📒 Generador | ✔ | ✔ | ✔ | ✔ | — | — |
| 📄 Cotizaciones | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| 🔎 Prospección | ✔ | ✔ | ✔ | ✔ | — | — |
| 📥 Cuentas por cobrar | ✔ | ✔ | ✔ | ✔ | — | — |
| 📤 Cuentas por pagar | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| 📝 Solicitudes de compra | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| 🛒 Órdenes de compra | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| 📊 Resultados | ✔ | ✔ | ✔ | ✔ | — | — |
| 👷 Personal | ✔ | ✔ | — | — | — | — |
| 📚 Catálogos | ✔ | ✔ | — | — | — | ✔ |
| 👤 Usuarios | ✔ | ✔ | — | — | — | — |
| 🗂️ Bitácora | ✔ | — | — | — | — | — |

## Qué ve en cada área (Roles y permisos)

| Área | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Contactos, cotizaciones y órdenes | Todo | Toda su sucursal | Lo suyo | Toda su sucursal | Lo suyo | Nada |
| Cuentas por cobrar | Todo | Toda su sucursal | Lo suyo | Toda su sucursal | Solo lo que él registra | Nada |
| Cuentas por pagar | Todo | Toda su sucursal | Lo suyo | Lo suyo | Lo suyo | Toda su sucursal |
| Solicitudes y órdenes de compra | Todo | Toda su sucursal | Lo suyo | Lo suyo | Lo suyo | Toda su sucursal |

## Qué datos le llegan

### Ventas

| Dato | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Orden de Valeria (vendedora), asignada a Tomás (técnico): cliente y servicio | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| … y su importe | ✔ | ✔ | ✔ | ✔ | — | — |
| Cotización de Bruno (otro vendedor de la sucursal): cliente | ✔ | ✔ | — | ✔ | — | — |
| … y su importe | ✔ | ✔ | — | ✔ | — | — |
| Orden de Bruno asignada a Tito (otro técnico): cliente | ✔ | ✔ | — | ✔ | — | ✔ |
| Orden de Diego (otra sucursal): cliente | ✔ | — | — | — | — | — |

### Cuentas por cobrar

| Dato | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Cobro que registró Tomás (técnico) en la orden de Valeria | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| Cobro que registró Alicia (atención) en la orden de Valeria | ✔ | ✔ | ✔ | ✔ | — | — |
| Saldo de la orden de Valeria (lo que debe el cliente) | ✔ | ✔ | ✔ | ✔ | — | — |

### Cuentas por pagar

| Dato | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Gasto que registró Tomás (técnico) en la orden de Valeria | ✔ | ✔ | ✔ | — | ✔ | ✔ |
| Gasto que registró Valeria (ventas) en su orden | ✔ | ✔ | ✔ | — | — | ✔ |
| Gasto que registró Carlos (compras) en la orden de Bruno | ✔ | ✔ | — | — | — | ✔ |
| Gasto que registró Alicia (atención) en la orden de Bruno | ✔ | ✔ | — | ✔ | — | ✔ |

### Compras

| Dato | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Solicitud de compra de Tomás | ✔ | ✔ | — | — | ✔ | ✔ |
| Solicitud de compra de Valeria | ✔ | ✔ | ✔ | — | — | ✔ |

### Prospección

| Dato | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Prospecto de Valeria | ✔ | ✔ | ✔ | ✔ | — | — |
| Prospecto de Bruno | ✔ | ✔ | — | ✔ | — | — |

### Personal

| Dato | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Un empleado activo: nombre y puesto (para asignarlo a una orden) | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| Su ficha: teléfono, licencia, ingreso | ✔ | ✔ | — | — | — | — |
| Sus datos sensibles: CLABE y salario | ✔ | ✔ | — | — | — | — |

### Reportes

| Reporte | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Generador | ✔ | ✔ | ✔ | ✔ | — | — |
| Resultados · análisis comercial | ✔ | ✔ | ✔ | ✔ | — | — |
| Resultados · panorama general | ✔ | ✔ | — | — | — | — |

## Qué puede hacer

| Permiso | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Contactos y clientes · Prospección | ✔ | ✔ | ✔ | ✔ | — | — |
| Contactos y clientes · Exportar a Excel | ✔ | ✔ | — | — | — | — |
| Cotizaciones y órdenes · Ver importes | ✔ | ✔ | ✔ | ✔ | — | — |
| Cotizaciones y órdenes · Cargar el generador | ✔ | ✔ | — | ✔ | — | — |
| Cotizaciones y órdenes · Cambiar importe o IVA de una orden | ✔ | ✔ | — | ✔ | — | — |
| Cotizaciones y órdenes · Actualizar estatus del servicio | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| Cotizaciones y órdenes · Eliminar cotizaciones y órdenes | ✔ | ✔ | — | — | — | — |
| Cuentas por cobrar · Registrar cobros | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| Cuentas por cobrar · Confirmar cobros | ✔ | ✔ | ✔ | ✔ | — | — |
| Cuentas por cobrar · Sus cobros entran ya confirmados | ✔ | ✔ | — | ✔ | — | — |
| Cuentas por cobrar · Crédito y datos de factura | ✔ | ✔ | ✔ | ✔ | — | — |
| Cuentas por cobrar · Ajustes, descuentos y revisión inicial | ✔ | ✔ | — | — | — | — |
| Cuentas por pagar · Registrar gastos de una orden | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Cuentas por pagar · Ver los gastos de sus órdenes | ✔ | ✔ | ✔ | — | — | — |
| Cuentas por pagar · Mover dinero | ✔ | ✔ | — | — | — | ✔ |
| Compras · Gestionar compras | ✔ | ✔ | — | — | — | ✔ |
| Compras · Aprobar sus propias solicitudes | ✔ | ✔ | — | — | — | — |
| Compras · Autorizar órdenes de compra | ✔ | ✔ | — | — | — | — |
| Reportes · Panorama general | ✔ | ✔ | — | — | — | — |
| Catálogos · Catálogos compartidos | ✔ | ✔ | — | — | — | ✔ |
| Personal · Ver personal | ✔ | ✔ | — | — | — | — |
| Personal · Editar personal | ✔ | ✔ | — | — | — | — |
| Personal · Datos sensibles del personal | ✔ | ✔ | — | — | — | — |
| Administración · Usuarios | ✔ | ✔ | — | — | — | — |

## Reglas acordadas que se revisan una por una

- **2026-10-19** · Dirección ve todo, en todas las sucursales.
- **2026-10-19** · Gerente: todo lo de su sucursal, nada de otra.
- **2026-10-19** · Ventas ve lo suyo: sus clientes, cotizaciones y órdenes (no las de otro vendedor ni de otra sucursal) y la cobranza de sus órdenes.
- **2026-10-19** · Técnico, en cuentas por pagar: solo los gastos que él registró.
- **2026-10-22** · Ventas, en cuentas por pagar: los gastos que registró y todos los de sus órdenes, aunque los anote otra persona.
- **2026-10-22** · Atención, en cuentas por pagar: solo los gastos que ella registró.
- **2026-10-22** · Catálogos compartidos: los cambian Dirección, Gerente y Compras; Ventas, Atención y Técnico no.
- **2026-10-22** · Costos y compras no registra cobros (no abre órdenes de servicio).
- **2026-10-19** · En compras, ventas y técnico ven solo lo que ellos pidieron.
- **2026-10-19** · Atención: ventas y cobranza de toda su sucursal.
- **2026-10-19** · Técnico: solo las órdenes que tiene asignadas.
- **2026-10-19** · Costos y compras: ve folio y cliente de las órdenes para ligar gastos, sin montos de venta ni cobranza; todas las cuentas por pagar y compras de su sucursal.
- **2026-10-21** · Técnico, en cuentas por cobrar: solo los cobros que él registró (sin saldos ni vencidos).
- **2026-10-21** · Técnico sin «Ver importes»: sus órdenes sin precios ni totales, sin Generador ni Resultados.
- **2026-10-21** · Prospección: cada quien lo suyo (quien ve toda su sucursal en ventas, todos los de su sucursal); el técnico no prospecta.
- **2026-10-19** · Personal: quien ve órdenes ve nombre y puesto del personal activo, para asignarlo a una orden; la ficha y los datos sensibles, solo Gerente y Dirección.
