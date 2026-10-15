# Saneadren · Sistema de registro de leads

## Qué incluye
- **Alta rápida**: teléfono + nombre + canal + servicio en un solo bloque, con detección de duplicados por teléfono en tiempo real (mientras escribes).
- **Responsable automático**: cada canal (llamada, WhatsApp, correo, Facebook, Instagram, etc.) tiene un responsable por defecto configurado en la base de datos; se precarga solo pero se puede cambiar antes de guardar.
- **Tablero de 4 etapas** (kanban): Recolección de datos → Cotización/Visita → Cierre/Programación → Post-venta. Cambiar de etapa es un clic dentro de la ficha del lead.
- **Ficha editable**: datos del contacto, historial de observaciones, alertas con fecha ("volver a contactar mañana"), marcar ganado/perdido/reabrir.
- **Cotización vs. orden de servicio**:
  - *Cotización* (folio `COT-`): se crea desde "Nueva cotización"; se exporta como propuesta, se descarta o se convierte en orden con "Generar orden de servicio". Las cotizaciones **no** se duplican.
  - *Orden de servicio* (folio `OS-`): sale de una cotización aceptada, o se registra directo cuando el cliente ya confirmó. Solo las órdenes se pueden **duplicar** (servicio recurrente): se copian partidas, importe, ubicación y notas, y solo se pide la nueva fecha. Una orden directa o duplicada no muestra folio de cotización ni se puede "reabrir" como cotización.
- **IVA**: en el contenido de cada cotización u orden se elige una de tres opciones: **Más IVA 16 %**, **IVA incluido 16 %** o **Sin IVA**.
  - *Más IVA* (así empieza todo registro nuevo): los importes son sin IVA y se suma el 16 %. Ejemplo: 1,500 → IVA 240 → total 1,740.
  - *IVA incluido*: los importes ya traen IVA y el sistema lo desglosa. Ejemplo: 1,160 → subtotal 1,000 + IVA 160.
  - El editor, el PDF y el Word muestran Subtotal, IVA y Total; el importe con letra es el total. El cálculo vive en `public/importes.js` (lo usan el navegador y el servidor, en centavos).
  - La cuenta por cobrar de una orden es subtotal + IVA, salvo que se capture el **total del CFDI** (por retenciones o centavos), que manda; si no coinciden, la orden lo avisa.
  - Los registros anteriores al IVA quedan **"IVA por definir"** y no cambian de saldo ni de reportes. Una cotización abierta pide indicarlo al volver a guardarla; en una orden lo indican administración o atención (igual que el importe).
  - Resultados y el tablero suman importes **sin IVA** (la venta real); lo cobrado y los gastos sí incluyen IVA. La plantilla de Excel de cuentas por cobrar tiene una columna opcional "IVA del importe".
  - *Sin IVA*: el cliente paga exactamente lo capturado (1,000 → 1,000), sin desglose; se guarda con tasa 0. Conviene confirmarlo con el contador.
  - La tasa de IVA es 16 %. Otra tasa (p. ej. 8 % fronterizo) se habilita en `TASAS_PERMITIDAS` de `public/importes.js` cuando el contador lo confirme.
- **Crear cotización**: la ventana pregunta si la cotización tiene vigencia y hasta qué fecha (propone 15 días; se puede quitar). Ninguna cotización ni orden puede ir en $0.00: cada servicio necesita un precio mayor a cero.
- **Notas y condiciones de la cotización**: debajo de los servicios hay un campo libre (forma de pago, qué incluye o no, horarios o lo que pida el cliente). Se edita al crear la cotización o en su ficha y se imprime en el PDF y Word como "NOTAS Y CONDICIONES". Las órdenes de servicio usan sus propias observaciones.
- **Tablas de Cuentas por cobrar y por pagar**: vista de **tabla** (en computadora) o **tarjetas** (en celular), se recuerda en cada equipo. Por cobrar, por orden: estado, OS, factura y su fecha, cliente, RFC, teléfono, servicio, fecha de servicio, ejecución, unidad, operador, proyecto, subtotal, IVA, total, crédito, vence, días vencido, cobrado (A/C), saldo, a favor, último pago (fecha, método y referencia), número de pagos y observaciones. Es una sola lista por orden (cada fila con Registrar pago); el crédito predeterminado del cliente se cambia en su ficha, en Estado de cuenta. Por pagar: cuándo vence, proveedor, categoría, concepto, factura, fechas, días, orden ligada, unidad, total, pagado, saldo, último pago y notas. Se ordena tocando el título, con totales al pie, y el botón **Columnas** elige qué ver. El Excel exporta todas las columnas.
- **Servicio no realizado con pagos**: si el cliente ya había pagado (anticipo o completo) y el servicio se marca *no realizado*, ya no debe nada (saldo $0) y lo pagado queda **a favor del cliente** (devolver o aplicar). La orden lo muestra, Cuentas por cobrar tiene la tarjeta "A favor de clientes" y no se aceptan más pagos. Al marcarlo, un aviso indica el dinero a favor y los gastos de la orden que siguen en Cuentas por pagar. Al volver a marcarlo realizado no se repiten gastos ya cargados, y una orden con gastos en Cuentas por pagar no se puede eliminar.
- **Cuentas por cobrar y servicio realizado**: una orden se cobra con su total con IVA (o el de la factura). Al marcarla *realizada*, la cuenta muestra la fecha en que se realizó, quién lo hizo, unidad, operador y proyecto (también en el Excel), y el crédito corre desde la factura o, sin factura, desde la fecha en que se realizó. Si se realiza antes de su fecha programada ya se cobra. Una orden *no realizada* sale de Cuentas por cobrar (salvo que ya tenga pagos registrados).
- **Solicitudes de compra** (Finanzas → Solicitudes de compra): el paso antes de la orden de compra.
  - **Cualquier usuario** pide lo que se necesita: qué, para qué, área (centro de costos), para cuándo, si es urgente, unidad o equipo, orden de servicio y una foto opcional. No pide proveedor ni precio. Si pide lo mismo dos veces, pregunta antes.
  - **Aprueba** el encargado de centro de costos (rol nuevo **costos**) o administración; también puede rechazarla con motivo. Quien pidió puede cancelarla.
  - **3 cotizaciones obligatorias** de 3 proveedores distintos (proveedor, total, entrega y archivo PDF o foto). Las suben el encargado o quien pidió. El mismo archivo no cuenta dos veces y dos cotizaciones del mismo proveedor cuentan como una. El cuadro marca la más barata.
  - **Urgente:** si no puede esperar, el encargado puede elegir con menos de 3 escribiendo por qué. Queda marcado como «excepción por urgencia» en la solicitud, en la orden (lo ve administración al autorizarla) y en la bitácora. Las que faltaron se pueden subir después.
  - **Elegir y crear la orden:** el encargado elige la ganadora (si no es la más barata queda registrado) y «Crear orden de compra» la deja llena: proveedor (fijo), área, fechas, lo que se pidió y el precio cotizado; la cotización pasa sola al expediente. Si la orden se cancela, la solicitud queda lista para otra.
  - **Recibido:** cuando llega, el encargado lo marca en la orden con la foto de lo que llegó y/o la firma de quien recibe (se firma con el dedo en el celular) y su nombre. Se guarda en el expediente y la solicitud queda «Recibida».
  - **Crédito obligatorio al pasar a pago:** al autorizar una orden siempre se escriben los días de crédito de esa compra (0 = de contado). El sistema no los toma solos del proveedor: solo muestra cuántos suele dar, como referencia. Con eso se calcula cuándo vence en Cuentas por pagar. Si es distinto a lo habitual del proveedor, queda anotado en la bitácora.
  - **Órdenes sin solicitud:** solo el encargado de centro de costos o administración (queda marcado «sin solicitud»). Desde este cambio, solo ellos crean, corrigen o cancelan órdenes de compra.
- **Órdenes de compra** (Finanzas → Órdenes de compra, formato CM-F-03): proveedor, centro de costos (catálogo con responsable: Mantenimiento, Operaciones, Subdirección, Dirección, Compras, Administración, RH y Ventas), categoría del gasto (también se usa en Cuentas por pagar), factura a, fecha y fecha requerida, nota, orden de servicio relacionada (opcional), partidas (cantidad, descripción, unidad de medida a elegir de un catálogo que cualquier usuario amplía —pieza, litro, metro, kilo, etc.—, clave de artículo y precio; importe = cantidad × precio), IVA a elegir (más IVA, incluido o sin IVA), observaciones y área solicitante. Se guarda como borrador (no es deuda); la lista marca si está autorizada y el administrador la autoriza desde la lista o la orden: en ese momento se vuelve deuda y pasa sola a Cuentas por pagar como factura pendiente del proveedor (vence según su crédito); también se puede cancelar (si aún no tiene pagos). Se descarga en PDF con el formato CM-F-03 (logo, código, revisión, firmas de área solicitante, gerencia de área y dirección) y en Excel (administración).
- **Catálogos de la orden de compra** (botones «Centros de costo», «Categorías de gasto» y «Unidades de medida»): una misma ventana sencilla para los tres; arriba se escribe y se pulsa «+ Agregar», abajo está la lista con «Editar» y «Eliminar» en cada uno. Cualquier usuario puede usarlos. Después de cada cambio aparece un mensaje fijo («✔ Se agregó…», «✔ Cambios guardados…», «✔ Se eliminó…») y el renglón se ilumina; si algo falla, el mensaje sale en rojo y lo escrito no se borra. Eliminar pide confirmar y solo quita la opción para lo nuevo: lo ya capturado conserva su centro o categoría, y si se vuelve a agregar con el mismo nombre, regresa. No se repiten nombres aunque cambien mayúsculas o acentos («Almacén» = «ALMACEN»). «Otro» no se elimina y debe quedar al menos un centro de costos. Todo queda en la Bitácora.
- **Expediente de la orden de compra**: en la propia orden, la lista de lo que debe tener (orden, cotización del proveedor, autorización, factura PDF y XML, pago, comprobante, evidencia), los documentos subidos (PDF, JPG, PNG o el XML de la factura, hasta 10 MB; se reconoce el tipo por el contenido, no por el nombre), sus pagos y su historial. El XML del SAT se lee solo (folio fiscal, RFC del emisor, total) y avisa si no coincide con la orden; la misma factura no puede estar en dos órdenes. «Descargar expediente completo (ZIP)» junta la orden en PDF, los documentos y un resumen con el historial. Los archivos se guardan junto a la base de datos (carpeta «archivos/», fuera del sitio web); quitar un documento lo deja marcado con quién, cuándo y por qué. El PDF de la orden tiene nueva presentación; el código, la revisión y las fechas del formato (CM-F-03) son del formato, no de cada orden, y los edita administración en «Datos del formato».
- **Registro de todo**: el historial de cada cotización u orden registra además los cambios de fechas, etapa, responsable, canal, servicios, ubicación, notas, equipo y operador (de qué a qué), los costos con terceros y sus pagos o cancelaciones. Ajustes → Bitácora (administración) muestra todo lo demás: clientes (altas, cambios, teléfonos, fusiones), proveedores, órdenes de compra y su expediente, cuentas por pagar, usuarios, catálogos, datos del formato y registros eliminados (con una foto de lo que eran). La ficha del cliente tiene «Movimientos de este contacto». Costos con terceros: el concepto es obligatorio y no puede ser el nombre o la descripción del servicio que se le vende al cliente.
- **Resultados → Panorama general** (administración): cómo va la empresa en el periodo elegido (este mes, mes pasado, trimestre, año, 12 meses o fechas libres), comparado con el periodo anterior (mes contra mes, trimestre contra trimestre, año contra el mismo tramo del año pasado). Muestra venta realizada (sin IVA), utilidad estimada y margen, dinero cobrado, pagado a proveedores, flujo de efectivo y gastos; alertas para atender; gráfica de 12 meses (venta, gastos, utilidad y cobrado); lo que te deben hoy por antigüedad y quién debe más, días promedio para cobrar; lo que debes y gastos por categoría; operación (realizados, no realizados, sin marcar, próximos 7 días, subcontratado, cotizaciones, tasa de cierre, clientes nuevos y recurrentes) y los primeros lugares por cliente, servicio, canal, unidad y operador. Se exporta a Excel e imprime o guarda en PDF. La pestaña Análisis comercial conserva lo anterior.
- **Calendario** (menú 📅 Calendario): vista por mes con las órdenes de servicio en su fecha (programada, por concluir, realizada o no realizada), alertas y recordatorios con su hora, cobros que vencen (Cuentas por cobrar), pagos a proveedores que vencen (Cuentas por pagar), cotizaciones que vencen y recompras sugeridas. Filtros por tipo (se recuerdan en el equipo); al tocar un día se ve su lista y al tocar un evento se abre su orden, contacto o Cuentas por pagar. En celular cada día muestra puntos de color y la lista va debajo.
- **Generador** (Ventas → Generador): ventas de las órdenes de servicio, un renglón por servicio, con MES, FECHA, NO. ORDEN, NO. FACTURA, CONCEPTO (el servicio realizado), PRECIO UNITARIO C/IVA, CANTIDAD, PRECIO UNITARIO S/IVA, SUBTOTAL, IVA, TOTAL, CANAL DE VENTA, CLIENTE, PROYECTO, UNIDAD (equipo) y EMPLEADO (operador). Filtro por fechas y búsqueda; exportar a Excel (admin). El subtotal, IVA y total de los renglones suman exactamente los de cada orden.
- **Servicio realizado / no realizado**: en la ficha de la orden (sección *Ejecución del servicio*) se marca cuando termina. *Realizado* abre una ventana: fecha, quién lo hizo (nuestro equipo o subcontratado) y sus costos y gastos (proveedor, categoría, concepto, monto y, si ya se pagó, método, fecha y referencia); cada gasto se carga en Cuentas por pagar ligado a la orden. *No realizado* pide motivo. **Solo las órdenes realizadas aparecen en el Generador**; Inicio lista los servicios por concluir (fecha pasada sin marcar).
- **Duplicar una orden con costos con terceros**: la ventana de duplicar muestra los costos de la orden original; los marcados se copian a la nueva orden en Cuentas por pagar como pendientes de pago (con el monto ajustable).
- **Costos con terceros**: cuando otra empresa realiza el servicio, en la ficha de la orden se usa "+ Registrar costo de un tercero": crea el gasto en Cuentas por pagar ligado a la orden (proveedor, concepto, costo y, si ya se pagó, método —incluye Nómina—, fecha y referencia, p. ej. "Semana 40"). El Generador muestra MANIFIESTOS, TIROS, PROVEEDOR, CONCEPTO, COSTO, ESTATUS PAGO y VÍA DE PAGO de cada orden (una vez por orden).
- **Cantidad × precio unitario**: cada servicio de una cotización u orden lleva cantidad y precio unitario; el importe se calcula solo. Si algún servicio tiene cantidad distinta de 1, el PDF y el Word muestran las columnas Cant. y P. unitario. Las órdenes también tienen **Proyecto**.
- **Membretes**: `public/membrete-cotizacion.png` y `public/membrete-orden-servicio.png` se generan con `node herramientas/membretes/servidor.js` → http://localhost:3301 → "Guardar en public/". Los datos de contacto y textos están al inicio de `herramientas/membretes/membretes.html`.
- **Cuentas y seguridad**: solo un administrador crea cuentas (Ajustes → Usuarios), con contraseña temporal que la persona cambia al entrar; no hay registro público (la ruta responde que las cuentas las crea un administrador). Se recupera la contraseña por correo con un enlace de un solo uso que vence en 30 minutos (no revela si el correo existe y cierra las sesiones abiertas). Todos los campos de contraseña tienen «Mostrar / Ocultar». Intentos repetidos de contraseña se bloquean por un rato. Ver "Configuración de correo" abajo.
- **Clientes sin duplicados**: cada cliente (una razón social) tiene un ID fijo **CLI-0001** que nunca cambia ni se reutiliza; se ve en su ficha, en Contactos y en Cuentas por cobrar. Antes de crear un cliente (nuevo contacto, cotización, prospección o plantilla) se revisa: el teléfono (principal, alterno o adicional) → es ese cliente; el RFC → no se repite; y el nombre o la empresa parecidos (sin acentos, mayúsculas, puntos ni «S.A. de C.V.», con tolerancia a errores de dedo como GEISHA/GESISHA) → se pregunta «¿es el mismo?» (se le agrega el teléfono) o «es otro» (no se vuelve a preguntar). Un administrador revisa los duplicados que ya existan (Contactos → Revisar duplicados) y los junta: todo pasa al cliente que queda y el ID retirado y su nombre apuntan a él. La plantilla de cobranza trae la columna ID CLIENTE con la lista de clientes (o NUEVO).
- **Carga masiva del Generador** (Generador → Cargar generador): se sube el Excel tal como se lleva (una hoja por mes, títulos FECHA, NO. ORDEN, NO. FACTURA, CONCEPTO (también se acepta PRODUCTO), CANTIDAD, SUBTOTAL, IVA, TOTAL, CANAL DE VENTA, CLIENTE, PROYECTO, UNIDAD, EMPLEADO; ID CLIENTE opcional) o la plantilla que da el CRM. Cada renglón queda como orden de servicio realizada (conserva el no. de orden y la factura). Se ignoran los renglones de totales; se marcan los errores (sin fecha, IVA distinto de 16 % o 0, total que no cuadra, cliente vacío o de una letra…). Los clientes, conceptos y canales que el CRM no reconoce se deciden en una sola pantalla («es CLI-0039», «es el mismo que X de este archivo», «cliente nuevo», «agregar al catálogo») y se recuerdan para la próxima carga. Se indica si ya están cobrados (historial) o quedan por cobrar. Volver a subir el mismo archivo no duplica. Todo o nada. Los costos con terceros (pipas, tiros) siguen en Cuentas por pagar. Si hay renglones con error, «Descargar mi Excel con avisos» regresa el mismo archivo con cada celda a corregir en rojo y un comentario (como los de Excel), más una hoja «Avisos por corregir» con la lista.
- **A prueba de errores** (tests/simulacion-tramposa.cjs, 146 intentos): teléfonos con +52, 044, guiones o extensión se normalizan a 10 dígitos (se rechazan 0000000000, 1111111111…); nombres de cliente, empresa y proveedor necesitan al menos 2 letras y no aceptan < > { }; el teléfono alterno tampoco puede ser de otro cliente; renombrar un cliente o proveedor para que quede igual a otro pregunta antes; el RFC genérico XAXX010101000 no bloquea; lo que ventas marca como «es otro» el administrador lo sigue viendo hasta confirmarlo. Órdenes de compra: descripción con sentido, unidad del catálogo, fecha a no más de un mes, categoría activa y aviso si se captura dos veces la misma orden. Gastos: concepto con sentido, categoría activa, fecha a no más de 60 días y factura repetida aunque cambien mayúsculas o espacios. Proveedores sin duplicados (nombre parecido o mismo RFC). Motivos de cancelación con al menos 5 letras.
- **Acceso de administrador desde el servidor**: con `ADMIN_USUARIO`, `ADMIN_CORREO` (`@saneadren.com.mx`) y `ADMIN_PASSWORD` en las variables del servidor (Plesk o Render), al reiniciar se crea o actualiza la cuenta admin. Cada vez que se escribe un valor nuevo se aplica una vez (sirve para recuperar el acceso); si después se cambia la contraseña desde el CRM, reiniciar con las mismas variables no la sobrescribe.
- **Cuentas por cobrar y por pagar** (menú **Finanzas**, dos secciones separadas: *Cuentas por cobrar* y *Cuentas por pagar*, esta última con sus proveedores):
  - *Por cobrar*: cada orden de servicio es una cuenta por cobrar. Saldo = total de la orden con IVA (o el total del CFDI, si se captura) − pagos. Antigüedad (por vencer, 1-15, 16-30, 31-60, +60), vista por cliente u orden, recordatorio por WhatsApp, días de crédito por cliente y por orden, folio y fecha de factura CFDI (emitida fuera del sistema).
  - Los pagos se registran desde la lista o desde la ficha de la orden. Ventas y técnicos pueden registrarlos en campo, pero quedan **por confirmar** hasta que el admin los valida. Los pagos **no se borran**: el admin los cancela con motivo y queda en la bitácora.
  - *Revisión inicial*: las órdenes que ya existían al instalar el módulo no cuentan como deuda hasta que el admin indica cuáles ya se cobraron.
  - *Por pagar* y *Proveedores* (solo admin): facturas o gastos de proveedores con vencimiento según su crédito, gasto de contado ("ya lo pagué"), pagos parciales, agrupado por vencidas / esta semana / próxima semana, y relación opcional con una orden y un equipo.
  - Inicio muestra el bloque **Finanzas** (te deben, vencido, por confirmar, pagar esta semana).
  - **Carga masiva con plantillas de Excel** (solo admin): en *Por cobrar* y *Por pagar*, "Descargar plantilla" baja un `.xlsx` con hoja de instrucciones, listas desplegables (servicios del catálogo, categorías, métodos de pago) y validaciones. Se llena un renglón por registro y se usa "Subir plantilla": primero aparece una vista previa con los errores por renglón; **si hay un solo error no se importa nada**. Por cobrar crea (o reutiliza por teléfono) el cliente y una orden de servicio con su saldo y lo ya pagado; por pagar crea el proveedor si no existe y la factura o gasto. Subir dos veces el mismo archivo se detecta como duplicado. Máximo 1,000 renglones por archivo.
  - *Plantilla de cuentas por cobrar*: mismo formato que la hoja de cobranza (SERIE, FOLIO, FECHA, NOMBRE, M,P, SUBTOTAL, IVA, TOTAL, CREDITO, FECHA VENCE, DIAS VENCIDOS, OS, STATUS, PAGO PROGRAMADO, FECHA PAGO, CP, A/C, FLUJO, OBSERVACIONES; opcionales TELÉFONO, SERVICIO y DIRECCIÓN). Se puede subir el .xlsx de la plantilla o el CSV de cobranza tal cual (el título de arriba y el renglón de totales se ignoran). El cliente se busca por nombre; PAGADO registra el pago (A/C o el total) con su fecha, complemento y banco; CANCELADO se omite. Los clientes nuevos se crean sin teléfono: agrégalo en su ficha antes de cotizarles.
- **Permisos**:
  | Acción | Todos | Solo admin |
  |---|---|---|
  | Ver y administrar usuarios (crear, nombre, correo, rol, contraseña temporal, desactivar) | | ✔ |
  | Descargar respaldo de la base de datos | | ✔ |
  | Editar descripción de servicios y reordenarlos | ✔ | |
  | Dar de alta / eliminar servicios y cambiar su recurrencia | | ✔ |
  | Agregar, renombrar y reordenar canales ("cómo se enteró") | ✔ | |
  | Agregar y renombrar tipos de cliente | ✔ | |
  | Ver Cuentas (por cobrar, por pagar, proveedores) | ✔ | |
  | Registrar pagos de clientes (ventas/técnico: quedan por confirmar), confirmarlos o cancelarlos con motivo | ✔ | |
  | Crédito y datos de factura de una orden | ✔ | |
  | Gastos, pagos a proveedores, proveedores e importar plantillas de Excel | ✔ | |
  | Ajustes o descuentos a una cuenta y revisión inicial | | ✔ |
  | Borrar cotizaciones u órdenes (sin pagos) | | ✔ |
  El servidor valida los permisos de cada acción de la tabla. Ojo: las pantallas de trabajo (contactos, cotizaciones) muestran sus datos a todos los usuarios con sesión, así que ocultar "Exportar a Excel" evita la descarga masiva con un clic, pero no impide que alguien copie lo que ve.
- **Inicio = pendientes**: avisos y recordatorios vencidos o de hoy, cotizaciones sin movimiento y recompras, con acceso directo a cada registro (ya no hay una pestaña Pendientes aparte).
- **Flujo cotización vs. orden**: la cotización no lleva fecha de servicio. "Convertir en orden de servicio" abre la ventana de orden con los datos de la cotización (partidas, IVA, ubicación) para completar fecha acordada, equipo, operador y observaciones; la misma cotización pasa a ser la orden. Notas, recordatorios y "urgente" van en *Avisos y notas* de cada cotización u orden.
- **Filtros**: por responsable, por estatus (abierto/ganado/perdido) y búsqueda por nombre o teléfono.

## Requisitos
- Node.js 22.12 o superior

## Instalación
```bash
npm install
npm start
```
El sistema corre en `http://localhost:3210`. La base de datos SQLite (`saneadren.db`) se crea sola en el primer arranque, junto con los catálogos iniciales (servicios, canales, usuarios de ejemplo).

## Exponerlo a tu equipo (mismo patrón que tu sistema QR)
```bash
cloudflared tunnel --url http://localhost:3210
```
o configúralo como tunnel permanente igual que en `qr-inventory-system`.

Detrás del tunnel define `TRUST_PROXY=loopback` (así los límites de intentos ven la IP real de cada persona y no la del tunnel) y `APP_URL` con la dirección pública, p. ej. `APP_URL=https://crm.saneadren.com.mx`.

## Configuración de correo (registro y recuperación de contraseña)
El correo de saneadren.com.mx está en **Google Workspace**. Copia `.env.example` como `.env` y llena los valores (`npm start` lo lee solo; `.env` no se sube a git). Para comprobarlo: `npm run probar-correo -- tu@saneadren.com.mx`.

| Variable | Ejemplo | Para qué |
|---|---|---|
| `APP_URL` | `https://crm.saneadren.com.mx` | Dirección que va en los enlaces de los correos. Obligatoria en producción. |
| `SMTP_HOST` | `smtp.office365.com` / `smtp.gmail.com` | Servidor de correo de saneadren.com.mx. |
| `SMTP_PORT` | `587` (STARTTLS) o `465` (TLS) | |
| `SMTP_USER` / `SMTP_PASS` | `servicios@saneadren.com.mx` / contraseña de aplicación | Cuenta que envía los correos. |
| `CORREO_REMITENTE` | `Saneadren CRM <servicios@saneadren.com.mx>` | Remitente visible. |
| `DOMINIO_CORREO` | `saneadren.com.mx` | Único dominio que puede registrarse (valor por defecto). |
| `USUARIO_PRUEBA_NOMBRE` / `USUARIO_PRUEBA_PASSWORD` | `Karla` / (la contraseña) | Opcional: usuario de pruebas que se crea solo al arrancar (útil en Render sin disco, donde la base se borra en cada despliegue). `USUARIO_PRUEBA_ROL` (ventas por defecto) y `USUARIO_PRUEBA_CORREO` son opcionales. |
| `USUARIO_2_PASSWORD` | (la contraseña) | Opcional: crea a **Luis Perea** al arrancar. `USUARIO_2_NOMBRE` (Luis Perea por defecto), `USUARIO_2_ROL` (ventas por defecto) y `USUARIO_2_CORREO` son opcionales. |

Sin `SMTP_HOST` los correos **no se envían**: se imprimen en la consola del servidor con su enlace (útil para probar). Nunca guardes `SMTP_PASS` en el repositorio.

## Personalizar catálogos iniciales
Edita el bloque `seed()` en `server/db.js`:
- **Usuarios**: nombre + rol (`admin`, `ventas`, `atencion`, `tecnico`). Agrega ahí a tu equipo real.
- **Servicios**: lista de servicios que ofrece Saneadren (ya precargada con desazolve, retiro de agua, fosas, trampas de grasa, video inspección, CIPP, plantas de tratamiento, industrial).
- **Canales**: cada canal apunta a un `responsable_default_id` (el índice del usuario en el array, empezando en 1). Cambia esos números para asignar quién atiende cada canal.

Estos catálogos iniciales solo se cargan en una base nueva. **Nunca borres `saneadren.db`**: ahí están todos los clientes, cotizaciones, órdenes y pagos. Para cambiar catálogos de una base en uso, hazlo desde la pestaña **Catálogos** del CRM.

**Respaldo:** usa **Usuarios → Descargar respaldo** (genera una copia completa y consistente). No copies solo `saneadren.db` a mano con el servidor encendido: parte de los datos recientes vive en `saneadren.db-wal`.

## Estructura
```
server/
  db.js        → esquema SQLite + catálogos iniciales
  index.js     → API REST (Express)
public/
  index.html   → interfaz
  app.js       → lógica del frontend
```

## Cosas a decidir contigo antes de producción
1. **Usuarios reales**: nombres y roles del equipo de Saneadren para reemplazar los de ejemplo (Admin, Ventas 1, Atención a Clientes, Técnico de Campo).
2. **Responsable por canal**: confirmar quién atiende cada canal realmente (¿ventas atiende llamadas o es atención a clientes?).
3. **Login**: las rutas de la API requieren sesión. Las sesiones se guardan en SQLite mediante un hash del token y caducan tras 12 horas de inactividad; sobreviven al reinicio del servidor.
4. **Migración de tu Excel actual**: si quieres, te ayudo a importar tus leads existentes de Google Sheets/Excel a la base de datos para no perder el historial.
5. **Cotización/servicio**: en la Etapa 2 dijiste "envío de cotización o visita técnica" — por ahora es una nota libre en el historial; si manejan montos o folios de cotización formales, podemos agregar esos campos.

## Verificación y conexión
Ejecuta `npm test` para verificar sesiones y manejo de desconexiones. Mantén `npm start` en ejecución mientras uses el CRM. Si el navegador indica conexión rechazada, comprueba que el servidor esté activo en el puerto 3210. Después de esta actualización, las sesiones anteriores guardadas solo en memoria requieren iniciar sesión una vez más.
