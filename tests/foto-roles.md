# Qué ve y qué hace cada rol

Foto generada por `tests/foto-roles.cjs` con un equipo de prueba: en Querétaro, Valeria y Bruno (ventas), Tomás y Tito (técnicos), Alicia (atención), Carlos (compras) y Gema (gerente); en CDMX, Diego (ventas). Cada columna es lo que le llega a esa persona al pedir **todas** las rutas del sistema, no solo lo que muestra la pantalla.

Dirección la revisa y la aprueba. Si un cambio altera lo que ve un rol, la prueba falla hasta actualizar la foto, y la diferencia se ve en el PR antes de subir.

## Pantallas del menú

| Pantalla | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras | Marketing | Gerente de marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 🏠 Inicio | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| 📅 Calendario | ✔ | ✔ | ✔ | ✔ | ✔ | — | — | — |
| 📋 Tareas | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| 🎨 Marketing | ✔ | — | — | — | — | — | ✔ | ✔ |
| ➕ Nuevo contacto | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| 👥 Contactos | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| 📒 Generador | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| 📄 Cotizaciones | ✔ | ✔ | ✔ | ✔ | ✔ | — | — | — |
| 🔎 Prospección | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| 📥 Cuentas por cobrar | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| 🧾 Facturas | ✔ | ✔ | — | — | — | — | — | — |
| 📤 Cuentas por pagar | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| 🏭 Proveedores | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| 📝 Solicitudes de compra | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| 🛒 Órdenes de compra | ✔ | ✔ | ✔ | ✔ | — | ✔ | — | — |
| 📊 Resultados | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| 🧮 Contabilidad | ✔ | ✔ | — | — | — | — | — | — |
| 🧑‍💼 Inicio de RH | ✔ | ✔ | — | — | — | — | — | — |
| 👷 Personal | ✔ | ✔ | — | — | — | — | — | — |
| 🕒 Asistencia | ✔ | ✔ | — | — | — | — | — | — |
| 💵 Nómina y pago | ✔ | ✔ | — | — | — | — | — | — |
| 📅 Nómina semanal | — | — | — | — | — | — | — | — |
| 📚 Catálogos | ✔ | ✔ | — | — | — | ✔ | — | — |
| 📢 Avisos | ✔ | — | — | — | — | — | — | — |
| 🛠️ Ajustes | ✔ | ✔ | — | — | — | — | — | — |
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

### Facturación

| Dato | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras | Marketing | Gerente de marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Código postal de expedición de las facturas (pantalla Facturación) | ✔ | ✔ | — | — | — | — | — | — |
| Clave del SAT de un servicio (pantalla Facturación) | ✔ | ✔ | — | — | — | — | — | — |
| Datos fiscales de un cliente (razón social para facturar) | ✔ | ✔ | — | — | — | — | — | — |
| Factura timbrada de una orden (folio fiscal / UUID) | ✔ | ✔ | — | — | — | — | — | — |

### Marketing

| Dato | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras | Marketing | Gerente de marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Publicación de Mara (Marketing) para Querétaro | ✔ | — | — | — | — | — | ✔ | ✔ |
| Publicación para toda la empresa | ✔ | — | — | — | — | — | ✔ | ✔ |
| Publicación de CDMX (otra sucursal) | ✔ | — | — | — | — | — | ✔ | ✔ |
| Proyecto de marketing de Mara, con sus tareas y avances | ✔ | — | — | — | — | — | ✔ | ✔ |
| Idea de Mara en el banco de ideas | ✔ | — | — | — | — | — | ✔ | ✔ |
| Archivo de la biblioteca de marketing | ✔ | — | — | — | — | — | ✔ | ✔ |
| Presupuesto de marketing del mes (monto) | ✔ | — | — | — | — | — | — | ✔ |
| Gasto de marketing (concepto y monto) | ✔ | — | — | — | — | — | — | ✔ |
| Reporte de llamadas de Google Ads (por campaña, lada y horario, y las llamadas sin registrar) | ✔ | — | — | — | — | — | — | ✔ |

### Personal

| Dato | Dirección | Gerente | Ventas | Atención | Técnico | Costos y compras | Marketing | Gerente de marketing |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Un empleado activo: nombre y puesto (para asignarlo a una orden) | ✔ | ✔ | ✔ | ✔ | ✔ | — | — | — |
| Su ficha: teléfono, licencia, ingreso | ✔ | ✔ | — | — | — | — | — | — |
| Sus datos sensibles: CLABE y salario | ✔ | ✔ | — | — | — | — | — | — |
| Sus checadas del reloj checador (entradas, salidas) y su motivo | ✔ | ✔ | — | — | — | — | — | — |
| La foto que se tomó al checar en el kiosco | ✔ | ✔ | — | — | — | — | — | — |
| La ubicación GPS de una checada desde el celular | ✔ | ✔ | — | — | — | — | — | — |

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
| Proponer el presupuesto de marketing del mes | ✔ | — | — | — | — | — | — | ✔ |
| Aprobar el presupuesto de marketing | ✔ | — | — | — | — | — | — | — |
| Registrar un gasto de marketing | ✔ | — | — | — | — | — | — | ✔ |
| El gasto de marketing aparece en Cuentas por pagar | — | — | — | — | — | — | — | — |
| Cambiar la configuración de facturación (CP de expedición de una sucursal) | ✔ | — | — | — | — | — | — | — |
| Crear la serie de facturas de una sucursal (con el nombre que se escriba) | ✔ | — | — | — | — | — | — | — |
| Cambiar la clave del SAT de un servicio | ✔ | — | — | — | — | — | — | — |
| Capturar los datos fiscales de un cliente | ✔ | ✔ | — | — | — | — | — | — |
| Timbrar la factura (CFDI) de una orden | ✔ | ✔ | — | — | — | — | — | — |
| Reenviar una factura por correo | ✔ | ✔ | — | — | — | — | — | — |
| Descartar un borrador de factura atorado | ✔ | — | — | — | — | — | — | — |
| Cancelar una factura timbrada (CFDI) | ✔ | ✔ | — | — | — | — | — | — |
| Timbrar el complemento de pago de un cobro (factura PPD) | ✔ | ✔ | — | — | — | — | — | — |
| Cargar de golpe los datos fiscales de los clientes desde el CSV de factura.com (revisar y aplicar) | ✔ | — | — | — | — | — | — | — |
| Descargar en Excel la lista de facturas y complementos (folio, cliente, RFC, importes, estatus) | ✔ | ✔ | — | — | — | — | — | — |
| Ver la revisión de «¿está lista la facturación para producción?» (llaves, series, claves del SAT, respaldo) | ✔ | — | — | — | — | — | — | — |
| Cambiar a mano el folio o el total de una orden que ya tiene factura real timbrada | — | — | — | — | — | — | — | — |
| Capturar los resultados (alcance, me gusta…) de una publicación ya publicada | ✔ | — | — | — | — | — | ✔ | ✔ |
| Dar de alta a una persona en el reloj checador (código y PIN temporal) o desbloquear su PIN | ✔ | ✔ | — | — | — | — | — | — |
| Registrar una tableta o computadora como kiosco del reloj checador | ✔ | ✔ | — | — | — | — | — | — |
| Eliminar un kiosco de la lista de kioscos del reloj checador | ✔ | — | — | — | — | — | — | — |
| Agregar a mano una checada olvidada (con motivo) | ✔ | ✔ | — | — | — | — | — | — |
| Cambiar un horario (entrada, salida, tolerancia o comida) | ✔ | ✔ | — | — | — | — | — | — |
| Marcar o quitar días festivos (valen para todas las sucursales) | ✔ | — | — | — | — | — | — | — |
| Autorizar el tiempo extra de una persona | ✔ | ✔ | — | — | — | — | — | — |
| Corregir su PROPIA asistencia (agregarse una checada o autorizarse su tiempo extra) | ✔ | — | — | — | — | — | — | — |
| Cambiar su PROPIO sueldo o datos de pago, o desligarse de su ficha | ✔ | — | — | — | — | — | — | — |
| Darse a sí mismo el PIN del checador | ✔ | — | — | — | — | — | — | — |
| Darle un PIN nuevo a quien ya tiene uno (reiniciar su PIN) | ✔ | ✔ | — | — | — | — | — | — |
| Mandar a una persona el enlace para checar desde su celular | ✔ | ✔ | — | — | — | — | — | — |
| Ponerle precio a la hora de cada puesto (para pagar el tiempo extra) | ✔ | ✔ | — | — | — | — | — | — |
| Ver cuánto dinero sale por tiempo extra (en la semana y en el Excel de nómina) | ✔ | ✔ | — | — | — | — | — | — |
| Cambiar los días de crédito y los datos de factura de una orden | ✔ | ✔ | — | — | — | — | — | — |
| Encontrar proveedores en el buscador general (Ctrl K) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| Ver la contabilidad del mes y descargar su Excel y los XML (para el contador) | ✔ | ✔ | — | — | — | — | — | — |
| Repetir un gasto fijo al mes siguiente (renta, internet…) | ✔ | ✔ | — | — | — | ✔ | — | — |
| Registrar un gasto «ya pagado» como pago a proveedor (sin esto queda «por reembolsar» a quien lo pagó) | ✔ | ✔ | — | — | — | ✔ | — | — |
| Cargar clientes con la plantilla de Excel (revisar y guardar) y ver las cargas anteriores | ✔ | — | — | — | — | — | — | — |
| Eliminar un cliente que no tiene cotizaciones, órdenes ni cobros | ✔ | — | — | — | — | — | — | — |
| Eliminar un usuario (se borra si nunca se usó; si ya tiene registros, se archiva) | ✔ | — | — | — | — | — | — | — |
| Ver los logs del sistema (entradas y salidas, contraseñas equivocadas, bloqueos, errores del servidor y quién está conectado) | ✔ | — | — | — | — | — | — | — |
| Eliminar una sucursal (se borra si nunca se usó; si ya tiene registros, se archiva) | ✔ | — | — | — | — | — | — | — |
| Mandar a una persona el enlace para checar desde su celular, o quitarle el celular | ✔ | ✔ | — | — | — | — | — | — |
| Ver los intentos fallidos en el kiosco (código o PIN malo, PIN bloqueado) con su foto y la red de cada checada | ✔ | ✔ | — | — | — | — | — | — |
| Capturar la ubicación de una sucursal (para revisar dónde checan con el celular) | ✔ | — | — | — | — | — | — | — |
| Subir o tomar la foto de una persona para su credencial | ✔ | ✔ | — | — | — | — | — | — |
| Imprimir credenciales (con su QR de verificación para clientes y su vigencia) | ✔ | ✔ | — | — | — | — | — | — |
| Activar o quitar a una persona el checar por WhatsApp (foráneos) | ✔ | ✔ | — | — | — | — | — | — |
| Dar el código para registrar la cara de una persona en el kiosco, o borrar su registro (biométrico) | ✔ | ✔ | — | — | — | — | — | — |
| Ver en Inicio (ficha «Personal») el aviso de que la cara no coincidió en el kiosco | ✔ | ✔ | — | — | — | — | — | — |
| Marcar como revisado el aviso de que la cara no coincidió | ✔ | ✔ | — | — | — | — | — | — |
| Cambiar las reglas del tiempo extra (semana de nómina, desde cuándo cuenta, redondeo…) | ✔ | — | — | — | — | — | — | — |
| Ver la pestaña RH (resumen del personal: sin horario, sin checador, sin aviso firmado…) | ✔ | ✔ | — | — | — | — | — | — |
| Cargar trabajadores en lote desde la plantilla de Excel (revisar y guardar) | ✔ | ✔ | — | — | — | — | — | — |
| Ver la asistencia del día y de la semana (retardos, faltas, tiempo extra) | ✔ | ✔ | — | — | — | — | — | — |
| Cargar el reporte de llamadas de Google Ads (CSV) y verlo cruzado con los contactos | ✔ | — | — | — | — | — | — | ✔ |
| Subir el XML de la factura a un gasto que registró Tomás (el sistema llena el IVA) | ✔ | ✔ | — | — | ✔ | ✔ | — | — |
| Corregir a mano el IVA de ese gasto (botón «IVA») | ✔ | ✔ | — | — | — | ✔ | — | — |
| Cambiar después el «Tipo de gasto» y las «Observaciones» de ese gasto (sin tocar montos) | ✔ | ✔ | — | — | — | ✔ | — | — |
| Agregar o quitar opciones en la lista de un servicio (p. ej. 4M3, 8M3 para [VOLUMEN]) | ✔ | — | — | — | — | — | — | — |
| Ver y preparar la nómina semanal (los dos sueldos de cada persona, descuentos y neto del IMSS) | ✔ | ✔ | — | — | — | — | — | — |
| Pagar la nómina y bajar la lista para el banco (con la CLABE de cada persona) | ✔ | ✔ | — | — | — | — | — | — |
| Poner o cambiar las reglas del bono de puntualidad (monto por puesto, retardos y faltas permitidos) | ✔ | ✔ | — | — | — | — | — | — |
| Conciliación bancaria: dar de alta una cuenta de banco, subir su estado de cuenta y emparejar sus movimientos con el CRM | ✔ | ✔ | — | — | — | — | — | — |
| Poner las metas del mes (venta, cobranza, margen, satisfacción…) contra las que se mide el semáforo del Panorama | ✔ | — | — | — | — | — | — | — |
| Mandar por correo a Dirección el reporte ejecutivo del mes | ✔ | — | — | — | — | — | — | — |
| Ver los indicadores del Análisis comercial (satisfacción, cobranza a tiempo, servicios en fecha y recompras de lo que ve) | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| Asignar una tarea (con fechas, para el Gantt) a alguien del equipo de su sucursal | ✔ | ✔ | — | — | — | — | — | — |
| Ver una tarea asignada a otra persona (la que Dirección le asignó a Tito) | ✔ | ✔ | — | — | — | — | — | — |
| Actualizar el avance de una tarea que le asignaron a él | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Entregar un anticipo por comprobar a una persona del personal (y cerrarlo o cancelarlo) | ✔ | ✔ | — | — | — | — | — | — |
| Ver los anticipos por comprobar de otras personas (el de Ernesto Obsidiana) | ✔ | ✔ | — | — | — | — | — | — |
| Contabilidad › Flujo de banco: guardar el saldo inicial del banco de un mes (queda para todos, con quién y cuándo) | ✔ | ✔ | — | — | — | — | — | — |
| Contabilidad: cerrar un mes ya terminado (después solo Dirección cambia cobros, pagos y anticipos de ese mes) | ✔ | — | — | — | — | — | — | — |
| Contabilidad › Flujo de banco: «Editar tabla» y guardar correcciones en las celdas (marcas, textos, monto CFDI, cuenta de banco) | ✔ | ✔ | — | — | — | — | — | — |
| Elegir la cuenta de banco al pagar, cobrar o confirmar un cobro (con ella el movimiento recibe su folio) | ✔ | ✔ | ✔ | ✔ | — | ✔ | — | — |
| Poner la clave de folio de una cuenta de banco (STD, BNT, PAG, CAJ…) | ✔ | ✔ | — | — | — | — | — | — |
| Contabilidad › Flujo de banco: «Asignar folios pendientes» a lo que ya tiene cuenta con clave | ✔ | ✔ | — | — | — | — | — | — |
| Contabilidad › Flujo de banco: agregar un movimiento que no pasó por el sistema (traspaso, préstamo, comisión…) y desglosar un pago en varios renglones | ✔ | ✔ | — | — | — | — | — | — |

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
| Cuentas por cobrar · Crédito y datos de factura | ✔ | ✔ | — | — | — | — | — | — |
| Cuentas por cobrar · Ajustes, descuentos y revisión inicial | ✔ | ✔ | — | — | — | — | — | — |
| Facturación · Datos fiscales de clientes | ✔ | ✔ | — | — | — | — | — | — |
| Facturación · Timbrar facturas | ✔ | ✔ | — | — | — | — | — | — |
| Cuentas por pagar · Registrar gastos de una orden | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| Cuentas por pagar · Ver los gastos de sus órdenes | ✔ | ✔ | ✔ | — | — | — | — | — |
| Cuentas por pagar · Mover dinero | ✔ | ✔ | — | — | — | ✔ | — | — |
| Compras · Ver montos de compras | ✔ | ✔ | ✔ | ✔ | — | ✔ | — | — |
| Compras · Gestionar compras | ✔ | ✔ | — | — | — | ✔ | — | — |
| Compras · Aprobar sus propias solicitudes | ✔ | ✔ | — | — | — | — | — | — |
| Compras · Autorizar órdenes de compra | ✔ | ✔ | — | — | — | — | — | — |
| Reportes · Análisis comercial | ✔ | ✔ | ✔ | ✔ | — | — | — | — |
| Reportes · Panorama general | ✔ | ✔ | — | — | — | — | — | — |
| Reportes · Contabilidad del mes | ✔ | ✔ | — | — | — | — | — | — |
| Reportes · Cerrar el mes de contabilidad | ✔ | — | — | — | — | — | — | — |
| Catálogos · Catálogos compartidos | ✔ | ✔ | — | — | — | ✔ | — | — |
| Personal · Ver personal | ✔ | ✔ | — | — | — | — | — | — |
| Personal · Editar personal | ✔ | ✔ | — | — | — | — | — | — |
| Personal · Datos sensibles del personal | ✔ | ✔ | — | — | — | — | — | — |
| Personal · Ver asistencia | ✔ | ✔ | — | — | — | — | — | — |
| Personal · Corregir asistencia | ✔ | ✔ | — | — | — | — | — | — |
| Personal · Kioscos del checador | ✔ | ✔ | — | — | — | — | — | — |
| Personal · Horarios y días festivos | ✔ | ✔ | — | — | — | — | — | — |
| Personal · Autorizar tiempo extra | ✔ | ✔ | — | — | — | — | — | — |
| Personal · Descargar la nómina | ✔ | ✔ | — | — | — | — | — | — |
| Personal · Preparar la nómina | ✔ | ✔ | — | — | — | — | — | — |
| Administración · Publicar avisos | ✔ | — | — | — | — | — | — | — |
| Administración · Asignar tareas | ✔ | ✔ | — | — | — | — | — | — |
| Administración · Usuarios | ✔ | ✔ | — | — | — | — | — | — |
| Marketing · Aprobar publicaciones | ✔ | — | — | — | — | — | — | ✔ |
| Marketing · Dinero de Marketing | ✔ | — | — | — | — | — | — | ✔ |

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
- **2026-11-03** · Reloj checador: ver las checadas del personal, corregirlas con motivo, dar código y PIN y registrar kioscos lo hacen Dirección y el Gerente (de su sucursal); los demás roles no. Nadie ve un PIN ni borra una checada.
- **2026-11-03** · Foto de cada checada del kiosco (para revisar quién checó): la ven Dirección y el Gerente (de su sucursal), y cada vez queda en la bitácora; los demás roles no. Se guarda cifrada.
- **2026-11-03** · Asistencia (horarios, retardos, faltas y tiempo extra): la ven Dirección y el Gerente; cambian horarios y días festivos y autorizan el tiempo extra Dirección y el Gerente (Dirección se los da a RH en Roles y permisos); los demás roles no.
- **2026-11-05** · Días festivos: valen para TODAS las sucursales, así que los marca o quita quien tiene «Horarios y días festivos» y ve todas las sucursales (Dirección, o RH de la empresa). El Gerente de una sola sucursal ya no (auditoría: su festivo convertía en tiempo extra lo trabajado en las demás).
- **2026-11-05** · Intentos fallidos en el kiosco (código o PIN malo, PIN bloqueado): el kiosco les toma foto; los intentos, su foto y la red (IP) desde la que se checó los ven Dirección y el Gerente (de su sucursal), y cada foto que se abre queda en la bitácora. Los demás roles no.
- **2026-11-05** · Ubicación de cada sucursal (para el celular: a más de su radio, 500 m por omisión, la checada queda «por revisar» y se ve en el mapa): la captura solo Dirección.
- **2026-11-05** · Credenciales de empleado (foto, nombre, puesto, número de empleado, vigencia, contacto de emergencia, QR del checador y QR de verificación para clientes): tomar la foto e imprimirlas lo hacen quienes editan el personal (Dirección y el Gerente, de su sucursal). Imprimir una nueva anula la anterior. La página de verificación es pública solo con el QR y muestra foto, nombre y puesto si la persona sigue trabajando y la credencial está vigente; si no, solo dice que no es válida.
- **2026-11-05** · Checar por WhatsApp (foráneos, respaldo del celular): solo quien RH active en su ficha y desde el celular de su ficha; sin foto ni ubicación, cada checada queda «por revisar». Activarlo o quitarlo lo hacen quienes editan el personal (Dirección y el Gerente, de su sucursal), nunca para sí mismos (salvo Dirección).
- **2026-11-11** · Módulo contable F1: «Contabilidad del mes» (resumen de ingresos, egresos e IVA, pendientes de comprobar y descarga del Excel y los XML) la ven Dirección, el Gerente (de su sucursal) y el rol que Dirección cree con el permiso «Contabilidad del mes» (p. ej. Contador); los demás roles de fábrica no. Es solo consulta. «Repetir» un gasto fijo al mes siguiente lo hace quien paga a proveedores (Dirección, Gerente, Compras).
- **2026-11-11** · Auditoría externa, decisiones de Dirección. H01: un gasto marcado «ya pagado» solo se registra como pago a proveedor si quien lo registra paga a proveedores (Dirección, Gerente, Compras); para los demás (Ventas, Atención, Técnico) queda por pagar como «Reembolso a <su nombre>», vence ese día, y el pago lo hace quien tiene permiso. H11: si RH da de baja a alguien y su usuario sigue activo, Dirección ve un pendiente en Inicio hasta desactivarlo. (H06 y H10 no cambian quién hace qué: cobrado y «pagada» cuentan solo lo confirmado; los choques de agenda solo avisan.)
- **2026-11-11** · Auditoría externa (H02 y H04): los proveedores salen en el buscador general solo a quien trabaja con ellos (cuentas por pagar o compras), y su historial también; la CLABE de los cambios viejos se ve tapada (últimos 4 dígitos) a quien no hace pagos. Las notas y recordatorios de una orden los agregan quien puede editarla, su técnico o quien lleva su cobranza; ver la orden ya no basta. Marcar resuelto un aviso pide lo mismo.
- **2026-11-09** · Clientes con plantilla (Configuración → Ajustes): cargar clientes en lote con la plantilla de Excel, ver las cargas anteriores y deshacerlas, y eliminar un cliente lo hace solo Dirección; ningún otro rol, ni el Gerente. Un cliente solo se elimina si no tiene cotizaciones, órdenes, cobros ni facturas; si ya tiene, se queda. Queda en la bitácora.
- **2026-11-05** · Crédito al cliente y datos de factura de una orden (días de crédito, folio, fecha y total): los cambian solo Dirección y el Gerente, porque el crédito es una decisión de dinero. Ventas, Atención y los demás roles lo ven pero no lo cambian. (Antes lo cambiaba cualquiera que viera la cobranza.)
- **2026-11-05** · Logs del sistema (Configuración → Ajustes): quién entró y salió, desde qué IP y equipo, contraseñas equivocadas, bloqueos por intentos, contraseñas restablecidas, errores del servidor y quién está conectado ahora. Los ve solo Dirección; ningún otro rol, ni el Gerente. Nunca guardan contraseñas.
- **2026-11-05** · Biométrico facial en el kiosco (solo de quien firmó su consentimiento; los expedientes son físicos, así que RH marca en la ficha que lo firmó, con quién y cuándo): marcar el consentimiento, dar el código de un solo uso para registrar su cara en el kiosco o borrar su registro lo hacen quienes editan el personal (Dirección y el Gerente, de su sucursal), nunca para sí mismos (salvo Dirección). Nadie ve ni descarga la plantilla de la cara: solo se compara al checar. Si no coincide, la checada queda por revisar.
- **2026-11-04** · Eliminar usuarios y sucursales: solo Dirección. Si nunca se usaron se borran; si ya tienen registros (cotizaciones, cobros, bitácora…) se archivan: desaparecen de las listas y su historial se conserva. La sucursal principal y la propia cuenta no se eliminan.
- **2026-11-03** · Precio de la hora de cada puesto y el dinero del tiempo extra (dobles y triples, en la semana y en el Excel de nómina): lo ven y lo cambian quienes ven sueldos (Dirección y el Gerente, de su sucursal); los demás roles solo ven horas.
- **2026-11-03** · Nadie corrige su PROPIA asistencia (agregar, anular o aceptar sus checadas, autorizarse tiempo extra, cambiarse el horario, registrarse vacaciones o permisos), ni el Gerente: lo hace otra persona con permiso. Dirección sí, porque no tiene a quién pedírselo.
- **2026-11-03** · Checar desde el celular: mandar el enlace o quitar el celular lo hacen Dirección y el Gerente (quien edita el personal); la ubicación de cada checada la ven solo Dirección y el Gerente (se toma solo al checar). Los demás roles no.
- **2026-11-03** · Pestaña RH (junta Personal, asistencia, horarios, kioscos, nómina y aviso de privacidad): la ve quien ve el personal (Gerente y Dirección); cargar trabajadores en lote desde la plantilla, solo quien edita el personal (Gerente y Dirección). Los demás roles no.
- **2026-11-12** · Cuentas por pagar como el Excel: cambiar después el «Tipo de gasto» y las «Observaciones» de un gasto ya registrado (sin tocar montos, proveedor ni fechas) lo hace solo quien paga cuentas por pagar (Dirección, Gerente y Compras), como el IVA. Los demás roles no.
- **2026-11-04** · Gastos con factura: subir el XML a un gasto ya registrado (el sistema llena solo el IVA) lo hacen quien registró el gasto y quien paga cuentas por pagar (Dirección, Gerente y Compras). Corregir el IVA a mano, solo quien paga (como antes). Los demás roles no.
- **2026-10-26** · Marketing: aprueban las publicaciones Dirección y el Gerente de marketing; nadie más (ni Marketing, aunque la haya escrito).
- **2026-10-26** · Marketing y Gerente de marketing: ven, editan y comentan las publicaciones de toda la empresa (de cualquier sucursal y las generales), y nada más del sistema: ni ventas, cobranza, gastos, compras, prospección ni personal.
- **2026-10-26** · Los demás roles (Gerente, Ventas, Atención, Técnico, Compras) no ven Marketing; Dirección lo puede prender en Roles y permisos.
- **2026-10-26** · Dirección ve y aprueba todo Marketing.
- **2026-10-27** · Dinero de Marketing (presupuesto, gastos, costo por contacto y retorno): lo ven Dirección y el Gerente de marketing; el rol Marketing y los demás roles no.
- **2026-11-04** · Llamadas de Google Ads (subir el reporte «Detalles de las llamadas» y verlo cruzado con los contactos, ventas e importes): lo ven y lo cargan solo Dirección y el Gerente de marketing; el rol Marketing y los demás roles no.
- **2026-11-09** · Cara que no coincide en el kiosco (o parece foto o pantalla): además de pedir el PIN y tomar la foto, sale un aviso en Inicio (ficha «Personal») por persona y día, hasta que alguien lo revisa. Lo ven quienes ven los intentos fallidos (Dirección y el Gerente, de su sucursal); marcarlo revisado lo hacen quienes corrigen la asistencia (Dirección y el Gerente). Los demás roles no.
- **2026-11-09** · Reglas del tiempo extra (semana de nómina —semana vencida de lunes a domingo—, desde cuántos minutos después de la salida cuenta, llegar antes, redondeo, descansos y festivos): valen para TODA la empresa, así que las cambia quien cambia los días festivos (Dirección, o RH de la empresa); cada cambio vale desde una fecha y lo pasado no cambia. El Gerente de una sola sucursal y los demás roles no.
- **2026-11-11** · Descargar la nómina (la semana con horas trabajadas, retardos, faltas y tiempo extra de cada persona, con el pago del tiempo extra, y su Excel): es un permiso aparte, «Descargar la nómina», que Dirección puede dar a cualquier rol en Roles y permisos. Quien solo tiene ese permiso ve únicamente esa pantalla: nada más de RH (fichas, checadas, fotos, intentos, horarios, precios, kioscos). De fábrica lo tienen Dirección y el Gerente; los demás roles no.
- **2026-11-12** · Personal y checador (etapa 6 de la auditoría): nadie cambia su propio sueldo o datos de pago, ni la cuenta ligada a su ficha, ni liga su propio usuario a una ficha; tampoco se da su propio PIN, enlace del celular o código de la cara. Quien no tiene su ficha ligada no cambia sueldos ni datos de pago ni da PIN, enlaces o códigos de cara, hasta que Dirección o RH la liguen. La primera alta en el checador la da quien edita el personal; reiniciar un PIN que ya existe, mandar el enlace del celular y dar el código de la cara, solo quien además corrige la asistencia (Dirección y el Gerente, de su sucursal). Dirección sí puede todo, también sobre sí misma.
- **2026-11-11** · Eliminar un kiosco de la lista de kioscos del reloj checador: solo Dirección (ni el Gerente, que sí registra y da de baja kioscos). Las checadas e intentos que hizo ese kiosco se conservan.
- **2026-11-11** · Avisos (comunicados): los publica quien tenga el permiso «Publicar avisos» (Dirección siempre; los demás roles no, hasta que Dirección se lo dé en Roles y permisos). Se mandan a personas elegidas (personal y usuarios del sistema), que lo ven en el reloj checador, en su celular o en el Inicio del CRM hasta que tocan «Enterado»; también por correo y WhatsApp si se elige. Un aviso no se borra: se retira y queda quién lo leyó y cuándo.
- **2026-11-05** · Listas de los servicios (las opciones que se eligen para la parte que cambia de la descripción, p. ej. [VOLUMEN]: 4M3, 8M3… o [SUCURSAL] de KFC): las agregan o quitan solo Dirección; ningún otro rol, ni el Gerente. Quienes cotizan solo eligen de la lista. Quitar no borra: queda en la bitácora.
- **2026-10-27** · Presupuesto de Marketing: lo propone el Gerente de marketing y lo aprueba solo Dirección.
- **2026-10-27** · Gastos de Marketing: los registran Dirección y el Gerente de marketing, y son control interno del departamento: no aparecen en Cuentas por pagar.
- **2026-10-27** · Resultados de cada publicación (alcance, me gusta, mensajes…): los capturan Marketing, el Gerente de marketing y Dirección, cuando ya está publicada; los demás roles no.
- **2026-10-27** · Facturación (conexión con factura.com, código postal de expedición y series de cada sucursal, incluido crear la serie propia de una sucursal —agregado el 2026-10-29—): la cambia solo Dirección. El código postal de expedición lo ve además quien timbra (Gerente y quien factura), porque sale en cada factura; los demás roles no lo ven, tampoco por la lista de sucursales. (Ajustada el 2026-10-27 al llegar el timbrado: «ven, no cambian».)
- **2026-10-27** · Claves del SAT de los servicios (clave de producto y unidad para facturar): las cambia solo Dirección. Las ve además quien timbra (Gerente y quien factura), porque salen en cada renglón de la factura; los demás roles ven los servicios sin esos datos. (Ajustada el 2026-10-27 al llegar el timbrado: «ven, no cambian».)
- **2026-10-27** · Datos fiscales de los clientes (RFC, razón social, código postal, régimen, uso de CFDI y correo para facturar): los ven y los capturan Dirección, el Gerente y quien tenga el permiso «Datos fiscales de clientes» (quien factura); los demás roles no los ven ni los cambian.
- **2026-10-27** · Timbrar facturas (CFDI) y ver las facturas de una orden (folio fiscal, receptor, XML y PDF): Dirección, el Gerente y quien tenga el permiso «Timbrar facturas» (quien factura); los demás roles no.
- **2026-10-28** · Ver la lista de facturas (pantalla «Facturas» y el aviso de Inicio), bajar su XML y PDF y reenviarlas por correo: Dirección, el Gerente y quien tenga «Timbrar facturas»; los demás roles no.
- **2026-10-28** · Descartar un borrador de factura que quedó atorado: solo Dirección (ni el Gerente ni quien factura).
- **2026-10-29** · Cancelar una factura timbrada (motivos 01 a 03, y pedir su estatus y acuse): Dirección, el Gerente y quien tenga «Timbrar facturas» (quien factura); los demás roles no.
- **2026-11-03** · Timbrar el complemento de pago de un cobro de una factura a crédito (PPD), y cancelarlo: Dirección, el Gerente y quien tenga «Timbrar facturas» (quien factura); los demás roles no. Nada se timbra solo: alguien con permiso lo revisa y lo pulsa.
- **2026-11-03** · Cargar de golpe los datos fiscales de los clientes desde el CSV de factura.com (revisar qué cliente del CRM es cada uno y aplicar): solo Dirección. Nunca crea clientes del CRM ni sobrescribe datos fiscales ya capturados.
- **2026-11-03** · Descargar en Excel la lista de facturas y complementos (con los filtros de la pantalla «Facturas»): Dirección, el Gerente y quien tenga «Timbrar facturas» (quien factura); los demás roles no. Es lo mismo que ya ven en la lista.
- **2026-11-03** · Ver la revisión «¿está lista la facturación para producción?» (qué falta en llaves, series, claves del SAT y respaldos, sin mostrar nunca una llave): solo Dirección, como el resto de la configuración de facturación.
- **2026-11-11** · Nómina semanal: la ven, preparan y cierran Dirección, el Gerente y a quien Dirección le dé «Preparar la nómina» (p. ej. el contador): ven los dos sueldos de cada persona (IMSS y bono). Los demás roles no.
- **2026-11-11** · Pagar la nómina y bajar la lista para el banco con la CLABE de cada persona: quien prepara la nómina y además mueve dinero (Dirección y el Gerente). Compras mueve dinero pero no ve sueldos: no.
- **2026-11-11** · Proyectos y tareas con Gantt: asignan tareas Dirección y el Gerente (este solo a gente de su sucursal) y ven las del equipo; cada persona ve y avanza solo las suyas (las marca terminadas y quien la asignó la acepta o la regresa). Al asignarla le llega en Inicio y por correo.
- **2026-11-11** · Reporte de Dirección: las metas del mes (venta, cobranza, margen, satisfacción y cumplimiento) las pone solo Dirección; el Gerente las ve en su Panorama. El reporte ejecutivo del mes llega por correo a Dirección el día 1, y mandarlo a mano también es solo de Dirección.
- **2026-11-11** · Análisis comercial: los indicadores nuevos (satisfacción, cobranza a tiempo, servicios en fecha, recompras) los ve quien ve el análisis comercial, cada quien con lo suyo; nada de cuentas por pagar ni dinero de la empresa (eso queda en el Panorama, para Dirección y el Gerente).
- **2026-11-12** · Folios de banco: cada movimiento recibe su folio al registrarse con su cuenta (STD-E-0001…). Eligen la cuenta quienes pagan, cobran ya confirmado o confirman cobros (Dirección, Gerente, Ventas, Atención y Compras); el técnico no. La clave de folio de una cuenta y «Asignar folios pendientes» los hacen Dirección, el Gerente y quien tiene «Contabilidad del mes» (el Contador). Los folios nunca se reusan ni se borran.
- **2026-11-12** · Contabilidad › Flujo de banco: agregar movimientos que no pasaron por el sistema (traspasos, préstamos, comisiones, devoluciones) y desglosar un pago en varios renglones (varias facturas o una factura por unidad) lo hacen Dirección, el Gerente y quien tiene «Contabilidad del mes» (el Contador). Un movimiento no se borra: se cancela con motivo; un renglón del desglose se quita y queda en la bitácora. Un mes cerrado, solo Dirección. Los demás roles no.
- **2026-11-12** · Contabilidad › Flujo de banco: «Editar tabla» y guardar correcciones en las celdas (marcas S/FALTA/NA, textos, monto CFDI, cuenta de banco) lo hacen Dirección, el Gerente y quien tiene «Contabilidad del mes» (el Contador). Cada corrección queda con quién, cuándo y el valor anterior, y se puede regresar al dato del sistema. El saldo, X comprobar, los importes y las fechas no se corrigen ahí. Un mes cerrado lo corrige solo Dirección. Los demás roles no.
- **2026-11-12** · Contabilidad: el saldo inicial del banco (Flujo de banco) lo guardan en el sistema Dirección, el Gerente y quien tiene «Contabilidad del mes» (el Contador), y queda quién y cuándo. Cerrar un mes ya terminado: Dirección y el rol que Dirección cree con «Cerrar el mes de contabilidad» (el Contador); el Gerente no. Ya cerrado, solo Dirección registra, confirma, corrige o cancela cobros, pagos y anticipos con fecha de ese mes (en cualquier pantalla) y cambia su saldo inicial; reabrirlo es solo de Dirección, con motivo.
- **2026-11-11** · Conciliación bancaria (subir el estado de cuenta de Santander o Banorte y emparejarlo con cobros, pagos, anticipos y nómina del CRM): Dirección, el Gerente y quien tiene «Contabilidad del mes» (el Contador). Registrar como gasto un cargo del banco que no está en el CRM (p. ej. una comisión) además pide «Mover dinero». Los demás roles no.
- **2026-11-11** · Bono de puntualidad: sus reglas (monto por puesto y sucursal, retardos y faltas permitidos; vacaciones, incapacidades y permisos se respetan) las ponen quienes preparan la nómina: Dirección y el Gerente. Los demás roles no.
- **2026-11-11** · Anticipos por comprobar: los entregan, cierran y cancelan Dirección y quien mueve dinero y ya ve al personal (el Gerente). Compras mueve dinero pero no ve al personal (regla del 2026-10-19): por ahora no; los demás roles tampoco.
- **2026-11-11** · Anticipos por comprobar: Dirección, el Gerente y quien tiene «Contabilidad del mes» ven todos los de su sucursal; cada persona ve solo los suyos (los comprueba con sus gastos, aunque no tenga orden de servicio).
- **2026-10-28** · Una orden con factura real ya timbrada: su folio, fecha, total y método de pago salen de la factura y nadie los cambia a mano (ni Dirección); los días de crédito sí.
- **2026-10-27** · Banco de ideas: las proponen, votan y comentan Marketing, Gerente de marketing y Dirección; las aprueban o descartan solo Dirección y el Gerente de marketing. Los demás roles no ven las ideas.
- **2026-10-27** · Biblioteca de marketing (logos, fotos, plantillas): la ven y usan Marketing, Gerente de marketing y Dirección; los demás roles no.
- **2026-10-26** · Proyectos de marketing (tareas, Gantt y avances): los ven y editan Marketing, Gerente de marketing y Dirección; los demás roles no.

## Roles hechos a mano (lo que Dirección apaga en «Roles y permisos»)

| Qué se revisa | Cobranza sin ventas (contactos y cuentas por cobrar) | Cotiza sin órdenes (contactos, cotizaciones y cobranza) | Solo contactos | Atención (de fábrica, para comparar) |
|---|:-:|:-:|:-:|:-:|
| Menú: Cotizaciones | — | ✔ | — | ✔ |
| Menú: Calendario | ✔ | ✔ | — | ✔ |
| Inicio: Avisos y seguimiento | — | ✔ | — | ✔ |
| Inicio: Servicios por concluir | — | — | — | ✔ |
| Inicio: Recompras | — | — | — | ✔ |
| Inicio: Finanzas | ✔ | ✔ | — | ✔ |
| Le llega la recompra de una orden | — | — | — | ✔ |
| Le llega el aviso de una orden | — | — | — | ✔ |
| Le llega el aviso de una cotización | — | ✔ | — | ✔ |
| Le llega la orden por concluir | — | — | — | ✔ |
| Ve la orden en el calendario | — | — | — | ✔ |
| Ve la cobranza de la orden | ✔ | ✔ | — | ✔ |

- **2026-11-03** · Un rol sin cotizaciones ni órdenes no ve «Cotizaciones» en el menú ni sus avisos en Inicio, aunque vea contactos o la cobranza.
- **2026-11-03** · «Servicios por concluir» y las órdenes del calendario: solo quien ve órdenes de servicio. Quien solo ve la cobranza sigue viendo la cobranza de esas órdenes, no la orden para concluirla.
- **2026-11-03** · Recompras: salen de las órdenes de servicio, así que solo las ve quien ve órdenes (no quien solo ve contactos o la cobranza).
- **2026-11-03** · Atención (con órdenes de toda su sucursal) sigue viendo todo eso: avisos, servicios por concluir, recompras y calendario.
