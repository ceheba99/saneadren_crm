# Hoja de ruta de mejoras del CRM Saneadren

Auditoría del 11/10/2026: 6 revisiones en paralelo, 56 hallazgos verificados contra el código. Varios describían el mismo problema y los junté, así que quedan 40 puntos. Junto a cada punto se indica cuántos hallazgos agrupa cuando son varios.

---

## 1. Urgente (riesgo de perder datos, dinero o seguridad)

**U1. Bloquear el código malicioso que se puede esconder en nombres, teléfonos y notas** (agrupa 2)
- **Por qué importa:** cualquier persona con cuenta, incluso alguien que se acaba de registrar, puede guardar un contacto, teléfono, nota o canal "trampa". Ese código se ejecuta cuando el administrador abre Inicio, Pendientes, Clientes o Cotizaciones. Con eso alguien puede crearse un usuario administrador, descargar la base completa o robar la sesión, y los permisos por rol dejan de servir.
- **Qué se haría:** usar una sola función que limpie los textos (incluidas las comillas) en todas las pantallas que muestran datos de la base, y que el servidor solo acepte en el teléfono dígitos, espacios, guiones, paréntesis y "+".
- **Esfuerzo:** bajo a medio
- **Referencia:** `public/app.js:1756` (alertas sin limpiar), `public/app.js:505` (tablero), `public/app.js:628` (la función actual no limpia comillas), `server/seguridad.js:104` (la política de seguridad permite código en línea)

**U2. Decidir dónde se guardan los datos: en el Render gratuito la base se borra sola** (agrupa 3)
- **Por qué importa:** sin disco persistente, cada actualización, reinicio o "siesta" del servidor empieza con una base vacía. El administrador se vuelve a crear solo, así que todo parece normal hasta que faltan clientes y órdenes. Además los folios COT y OS vuelven a empezar y repiten números que ya se entregaron a otros clientes.
- **Qué se haría:** elegir entre Render de pago con disco (unos 7 USD al mes, con `DB_PATH=/var/data/saneadren.db`) o trabajar solo en la PC local con el túnel. Además, que el servidor no arranque (o muestre una franja roja "Base temporal") si está en Render sin `DB_PATH`.
- **Esfuerzo:** bajo
- **Referencia:** `server/db.js:6`. Desde el código no se puede saber si Render ya tiene disco configurado; hay que revisarlo en el panel.

**U3. Completar la configuración del servidor: APP_URL, TRUST_PROXY y TZ** (agrupa 3)
- **Por qué importa:**
  - Los correos de "Confirma tu correo" y "Restablece tu contraseña" llevan enlaces a `localhost`. Karla o cualquier vendedor no puede activar su cuenta ni recuperar su contraseña desde su celular o su laptop.
  - Para el servidor, todos los usuarios llegan desde la misma dirección de internet. Por eso cualquier extraño puede bloquear la cuenta del administrador una y otra vez, y agotar para toda la empresa los límites de registro y de recuperación de contraseña.
  - En Render los recordatorios salen 6 horas antes de lo debido.
- **Qué se haría:** en Render ya están `APP_URL` y `TRUST_PROXY`; falta agregar `TZ=America/Mexico_City`. En el `.env` local faltan `APP_URL` (solo si se usa desde otros equipos con el túnel), `TRUST_PROXY=loopback` y `TZ`. Que el servidor avise al arrancar si falta alguna.
- **Esfuerzo:** bajo
- **Referencia:** `server/index.js:11` (enlaces a localhost), `server/index.js:16` (TRUST_PROXY), `server/cuentas.js:55` (límites por dirección de internet)

**U4. Que no cualquiera pueda borrar para siempre una orden ya contratada** (agrupa 2)
- **Por qué importa:** un técnico o una cuenta nueva puede eliminar una orden ganada con su importe, sus notas y su encuesta. No queda rastro de quién lo hizo ni de qué contenía, y los ingresos de Resultados cambian sin explicación.
- **Qué se haría:** que solo el administrador pueda borrar, y que los demás usen "Cancelar" (el registro se marca con quién y cuándo, sin borrarse).
- **Esfuerzo:** bajo (solo administrador) / medio (cancelar en lugar de borrar)
- **Referencia:** `server/index.js:690`; el botón lo ve todo el mundo en `public/servicios-tabla.js:68`

**U5. Respaldo automático diario fuera del servidor y una forma segura de restaurar** (agrupa 3)
- **Por qué importa:**
  - Hoy solo hay respaldo si un administrador se acuerda de darle clic al botón.
  - Más de dos semanas de datos viven en el archivo auxiliar `saneadren.db-wal`. Quien copia solo `saneadren.db` (a una USB, a Drive o a un .rar) tiene un respaldo incompleto sin saberlo.
  - El archivo temporal del botón de respaldo queda en la carpeta del proyecto y se podría subir a GitHub por error.
- **Qué se haría:** programar un respaldo diario automático (las últimas 14 a 30 copias) enviado por correo o a Drive. Cerrar la base en orden al apagar el servidor, para que ese archivo auxiliar se integre al principal. Generar el respaldo del botón sin escribirlo en la carpeta del proyecto. Y crear un comando "restaurar" que revise el archivo y guarde antes una copia de la base actual.
- **Esfuerzo:** medio
- **Referencia:** `server/index.js:1051` (único respaldo, manual), `server/index.js:1056` (archivo en la carpeta del proyecto), `server/db.js:7` (modo WAL sin cierre ordenado)

**U6. Evitar que un desconocido sature el servidor con inicios de sesión falsos** (agrupa 2)
- **Por qué importa:** sin tener cuenta, alguien puede enviar miles de intentos con nombres enormes o distintos. La memoria crece sin límite y cada intento congela el CRM unos 50 ms para todos, lo que en el plan gratuito basta para dejarlo inutilizable.
- **Qué se haría:** rechazar nombres de más de 254 caracteres, poner un tope de intentos por dirección de internet usando el limitador que ya existe, y revisar las contraseñas sin congelar el servidor. Conviene hacerlo después de U3, para que el tope no bloquee a todo el equipo a la vez.
- **Esfuerzo:** bajo
- **Referencia:** `server/index.js:57`, `server/seguridad.js:8`

**U7. Una bitácora confiable: registrar los cambios de importe y no aceptar eventos "del sistema" falsos**
- **Por qué importa:** se puede bajar el importe de una orden cerrada de $1,000 a $1 sin que quede ninguna anotación, y cualquiera puede escribir notas que aparecen como eventos automáticos. Si hay una diferencia de dinero, la bitácora no sirve como prueba.
- **Qué se haría:** que el servidor anote él mismo cada cambio de importe, responsable, fecha y partidas (con el valor anterior y el nuevo), y que nunca acepte que el navegador marque una nota como "sistema".
- **Esfuerzo:** medio
- **Referencia:** `server/index.js:667` (el origen lo decide el navegador), `server/index.js:582` (al editar solo se anotan los cambios de estatus)

---

## 2. Rápido y valioso (poco esfuerzo, buen beneficio)

**R1. Arreglar el botón "Registrar servicio nuevo" de las recompras** (agrupa 3)
- **Por qué importa:** es el botón principal de las ventas recurrentes en Inicio y en Pendientes, y hoy siempre da el error "Cotización no encontrada". Además, "Desazolve con máquina eléctrica" (8 de las 12 órdenes) no tiene días de recurrencia, así que esos clientes nunca aparecen como recompra.
- **Qué se haría:** que el servidor mande el número de la última orden de cada recompra, agregar esa prueba a la simulación y que el administrador fije la recurrencia de ese servicio en Catálogos.
- **Esfuerzo:** bajo
- **Referencia:** `public/app.js:1746`, `server/index.js:893`

**R2. Fecha correcta en las cotizaciones hechas después de las 6 pm** (agrupa 2)
- **Por qué importa:** toda cotización creada entre las 6 pm y la medianoche sale en el PDF del cliente con la fecha del día siguiente, y una hecha la tarde del último día del mes queda en el mes siguiente.
- **Qué se haría:** calcular "hoy" con la hora de México y agregar una prueba con una cotización creada a las 7 pm.
- **Esfuerzo:** bajo
- **Referencia:** `server/index.js:483`

**R3. Avisos claros cuando falla la conexión, en lugar de pantallas en blanco** (agrupa 2)
- **Por qué importa:**
  - Con mala señal, Inicio se queda vacío y parece que no hay pendientes.
  - Los errores salen en inglés ("Failed to fetch") y los avisos importantes desaparecen en 2.6 segundos.
  - Una respuesta tardía puede sacar de la sesión a quien acaba de entrar.
- **Qué se haría:** corregir la parte que se comunica con el servidor como piden las 3 pruebas que hoy fallan, mostrar "Cargando…" y un botón "Reintentar" en cada lista, y dejar los errores en pantalla al menos 6 segundos.
- **Esfuerzo:** bajo
- **Referencia:** `public/app.js:59` y `public/app.js:76`, `public/app.js:2056`

**R4. Que una nota sin agregar no se pase a la ficha de otro cliente**
- **Por qué importa:** si alguien escribe una nota o un recordatorio, cierra sin "Agregar" y abre otro cliente, el texto sigue ahí y puede guardarse en el cliente equivocado. El seguimiento del cliente correcto nunca aparece.
- **Qué se haría:** limpiar la nota, la casilla de recordatorio y la fecha al abrir cada ficha, y avisar "Cambios sin guardar" si hay una nota pendiente.
- **Esfuerzo:** bajo
- **Referencia:** `public/app.js:1404`, `public/flujo.js:7`

**R5. Pedir confirmación y motivo al "Descartar cotización"** (agrupa 2)
- **Por qué importa:** un toque por error cierra la cotización y borra sus recordatorios, que no vuelven aunque se reabra. Tampoco se sabe por qué se pierden las ventas (precio, competencia, no contestó).
- **Qué se haría:** pedir confirmación con una lista corta de motivos que se guarde en la bitácora, y avisar que los recordatorios se cerrarán.
- **Esfuerzo:** bajo
- **Referencia:** `public/app.js:1467`, `server/index.js:653`

**R6. Que Inicio se actualice al marcar una alerta como "Resuelta"**
- **Por qué importa:** en la pantalla principal la tarjeta no desaparece al pulsar "Resuelta"; parece que el sistema falla y el equipo deja de confiar en la lista de lo urgente.
- **Qué se haría:** recargar Inicio al resolver una alerta o al cerrar una ficha, con el aviso "Alerta resuelta".
- **Esfuerzo:** bajo
- **Referencia:** `public/app.js:1792`

**R7. No perder el "Atendió" en las cotizaciones de un vendedor dado de baja**
- **Por qué importa:** si se desactiva a un vendedor, la primera vez que alguien edite una de sus cotizaciones el responsable queda vacío y el PDF sale con "Por asignar".
- **Qué se haría:** rechazar un responsable vacío o inactivo al editar, y al desactivar a un usuario pedir a quién se pasan sus cotizaciones abiertas.
- **Esfuerzo:** bajo
- **Referencia:** `server/index.js:594`

**R8. Corregir el README**
- **Por qué importa:** la línea 64 indica borrar `saneadren.db`, lo que eliminaría todos los clientes. Además pide una versión de Node con la que el sistema no arranca y promete que "el servidor valida cada permiso", lo cual no es cierto.
- **Qué se haría:** quitar esa instrucción, poner Node 22.12 o superior, documentar las variables de Render, el respaldo y la restauración, y sacar del repositorio el archivo `test-simulacion.mjs`, que ya no sirve.
- **Esfuerzo:** bajo
- **Referencia:** `README.md:64`

**R9. Poner límites de tamaño a contactos, notas y alertas**
- **Por qué importa:** se aceptan notas de 900 KB y teléfonos con letras y símbolos. Eso hace lenta la app, infla los respaldos, rompe los PDF y facilita el problema de U1.
- **Qué se haría:** fijar topes en el servidor (por ejemplo nombre 120 caracteres, dirección 300, notas 3000, texto de la bitácora 2000), igual que ya se hizo con equipo y operador.
- **Esfuerzo:** bajo
- **Referencia:** `server/index.js:668`, `server/index.js:708`

**R10. Neutralizar fórmulas peligrosas en el Excel exportado**
- **Por qué importa:** un contacto llamado `=HYPERLINK(...)` se convierte en un enlace dentro del Excel del administrador que, al hacerle clic, puede mandar datos de clientes a un sitio externo.
- **Qué se haría:** aplicar la misma regla de una línea que ya usa la exportación de prospección (poner un apóstrofo delante de =, +, -, @).
- **Esfuerzo:** bajo
- **Referencia:** `public/app.js:1189`

**R11. Servir las librerías de PDF y Word desde el propio CRM** (agrupa 2)
- **Por qué importa:** se cargan desde sitios externos sin verificar que no hayan sido alteradas. Si uno de esos sitios se cuelga, puede no aparecer ni la pantalla de inicio de sesión.
- **Qué se haría:** guardar las 4 librerías en `public/vendor/` y quitar esos sitios de la política de seguridad.
- **Esfuerzo:** bajo
- **Referencia:** `public/index.html:645` a `public/index.html:648`

**R12. Que "Guardar y descargar" pase la cotización a "Cotización enviada"**
- **Por qué importa:** el camino más rápido deja la tarjeta en "Recolección de datos" aunque el cliente ya tenga el PDF, y los contadores quedan por debajo de la realidad.
- **Qué se haría:** aplicar la misma regla que ya existe al descargar desde la ficha. Si después se hace N1, el cambio de etapa debería pasar al envío real.
- **Esfuerzo:** bajo
- **Referencia:** `public/app.js:280`

**R13. "Exportar solo para administradores" protege solo en la pantalla**
- **Por qué importa:** cualquier usuario puede bajar toda la cartera con teléfonos, direcciones e importes desde la consola del navegador. El bloqueo es solo visual.
- **Qué se haría:** decidir qué puede ver cada rol. Lo inmediato es corregir el README. Si se quiere proteger de verdad, limitar en el servidor las consultas masivas a quien no es administrador.
- **Esfuerzo:** bajo (README) / medio (protección en el servidor)
- **Referencia:** `public/app.js:1186`, `server/index.js:390`

**R14. Aceptar solo días de recurrencia enteros y razonables**
- **Por qué importa:** un número muy grande escrito por error en Catálogos deja sin cargar Inicio y Pendientes para todos.
- **Qué se haría:** aceptar solo enteros de 1 a 3650 días y saltar en las recompras cualquier fila con fecha inválida.
- **Esfuerzo:** bajo
- **Referencia:** `server/index.js:288`

**R15. Usar los mismos nombres en toda la app**
- **Por qué importa:** "lead", "solicitud", "servicio contratado" y "orden de servicio" se mezclan para lo mismo, lo que confunde al personal nuevo y al leer los reportes.
- **Qué se haría:** usar solo "Cotización" y "Orden de servicio", y corregir los textos sueltos (por ejemplo "en leads" y "Todo lo que ya vencido").
- **Esfuerzo:** bajo
- **Referencia:** `public/app.js:1318`

---

## 3. Mejoras de negocio (funciones nuevas)

**N1. Enviar cotizaciones y recordatorios de recompra por WhatsApp y por correo**
- **Por qué importa:** hoy "Cotización enviada" significa solo que se descargó, sin saber si el cliente la recibió. Las recompras dependen de que alguien entre al CRM y llame.
- **Qué se haría:**
  1. Un botón "Enviar por WhatsApp" con el mensaje ya escrito, que quede anotado en la bitácora.
  2. Un botón "Enviar por correo" con el PDF adjunto, usando el correo de Google Workspace que ya está configurado.
  3. Un aviso diario al vendedor con sus recompras y recordatorios vencidos.
- **Esfuerzo:** bajo (WhatsApp) / medio (correo y aviso diario)
- **Referencia:** `public/app.js:1170`

**N2. Agenda de servicios y estado de cada orden: programada, realizada o cancelada** (agrupa 2)
- **Por qué importa:**
  - Nadie ve en el CRM qué servicios hay hoy o mañana, con qué equipo y qué operador; hay que abrir cliente por cliente.
  - Una orden realizada no se distingue de una pendiente, y para cancelar hay que borrar.
- **Qué se haría:**
  - Agregar a la orden su estado y su hora.
  - Crear una vista "Agenda" por día y por semana, filtrable por operador y equipo, que avise si alguno queda dos veces el mismo día.
  - En Inicio, un bloque "Servicios de hoy y mañana".
  - Que el técnico vea solo sus órdenes y pueda marcarlas como realizadas.
- **Esfuerzo:** medio
- **Referencia:** `server/db.js:61`, `public/app.js:309`

**N3. Recompras de todos los servicios de una orden, no solo del primero**
- **Por qué importa:** si un cliente contrata en la misma orden un servicio de una sola vez y otro recurrente, el CRM nunca le vuelve a ofrecer el recurrente. Además, el precio sugerido usa el total de toda la orden.
- **Qué se haría:** calcular las recompras por cada servicio de la orden con su propio importe y, más adelante, permitir un "repetir cada N días" por orden.
- **Esfuerzo:** medio
- **Referencia:** `server/index.js:467` (solo se guarda el primer servicio), `server/index.js:893`

**N4. Un buscador que encuentre por folio, empresa, nombres con acento y teléfono en cualquier formato** (agrupa 2)
- **Por qué importa:** si el cliente llama y dice "COT-202610-0045" o el nombre de su restaurante, no se le encuentra. Además, "martinez" no encuentra a "Martínez".
- **Qué se haría:** un solo buscador que entienda folio, número, nombre, empresa, correo y teléfono (comparando solo los dígitos), sin importar acentos, con el texto de ayuda "Nombre, empresa, teléfono o folio".
- **Esfuerzo:** medio
- **Referencia:** `server/index.js:406`, `public/index.html:89`

**N5. Cotizaciones con IVA, cantidad y precio unitario, RFC del cliente y catálogo con precios**
- **Por qué importa:** restaurantes, hoteles e industrias piden subtotal más IVA desglosado. Hoy no queda claro si el precio incluye IVA, y cada vendedor cobra distinto por el mismo servicio.
- **Qué se haría:** agregar a cada partida cantidad, unidad y precio unitario, elegir "más IVA" o "IVA incluido", imprimir el RFC y dar a cada servicio del catálogo un precio base que se cargue solo.
- **Esfuerzo:** medio. Conviene hacer antes M6, porque esto toca los 4 generadores de documentos.
- **Referencia:** `server/index.js:463`

**N6. Mantener al día los datos del contacto en cotizaciones, alertas y PDF**
- **Por qué importa:** si se corrige el teléfono en la ficha del cliente, las alertas, el tablero y el PDF siguen mostrando el número viejo, y se llama al número equivocado.
- **Qué se haría:** al guardar la ficha, actualizar también las cotizaciones abiertas y las órdenes con fecha futura, o que esas pantallas lean siempre el dato de la ficha del contacto.
- **Esfuerzo:** medio
- **Referencia:** `server/index.js:816`

**N7. Resultados por vendedor y por servicio**
- **Por qué importa:** no se puede comparar cuánto cotiza y cierra cada vendedor (porcentaje de cierre, ticket promedio, comisiones) ni qué servicio deja más dinero.
- **Qué se haría:** agregar a Resultados las tablas "Por vendedor" y "Por servicio", más el conteo de motivos de pérdida de R5, aprovechando cálculos que ya existen en el servidor y hoy no se usan.
- **Esfuerzo:** bajo
- **Referencia:** `server/index.js:965`

**N8. Cobranza: anticipos, pagos, saldo y factura**
- **Por qué importa:** el CRM solo sabe lo contratado, no lo cobrado; la propia pantalla de Resultados lo advierte. No hay forma de saber quién debe ni de dar seguimiento a créditos de 15 o 30 días.
- **Qué se haría:** registrar los pagos de cada orden, mostrar el saldo, marcar si está facturada, crear una vista "Por cobrar" por antigüedad y comparar en Resultados lo cobrado contra lo contratado. Pierde prioridad si la cobranza ya se lleva en otro sistema.
- **Esfuerzo:** medio
- **Referencia:** `public/index.html:254`

**N9. Que los folios se guarden en el servidor, con numeración propia para cotizaciones y para órdenes** (agrupa 2)
- **Por qué importa:**
  - Las órdenes saltan de número (por ejemplo de la 36 a la 43) porque comparten la numeración con las cotizaciones, y en una revisión parece que faltan órdenes.
  - El mes del folio es el de la cotización, no el de la orden.
- **Qué se haría:** que el servidor asigne y guarde el folio de cada tipo con su propia numeración, conservando el folio que ya se imprimió en los documentos existentes.
- **Esfuerzo:** medio
- **Referencia:** `public/app.js:801`

**N10. Encuesta de calidad ligada a cada orden**
- **Por qué importa:** todas las órdenes llevan el mismo código QR y ninguna de las 12 tiene encuesta registrada, así que no hay forma de saber qué operador o qué servicio genera quejas.
- **Qué se haría:** un QR único por orden que lleve a una página corta de calificación y guarde la respuesta en esa orden, con el promedio por mes, operador y servicio en Resultados.
- **Esfuerzo:** medio
- **Referencia:** `public/app.js:713`

**N11. Mejor manejo desde el celular**
- **Por qué importa:** para abrir una orden hay que deslizar una tabla de 1130 px dentro de una ventana pequeña, y el tablero pide arrastrar tarjetas, cosa que no funciona con el dedo.
- **Qué se haría:** en pantallas angostas, mostrar el historial como tarjetas con un botón grande "Abrir", y agregar a cada tarjeta del tablero un selector de etapa.
- **Esfuerzo:** medio
- **Referencia:** `public/servicios-tabla.css:12`

---

## 4. Mantenimiento técnico

**M1. Que las pruebas automáticas sirvan de alarma**
- **Por qué importa:** `npm test` falla desde el último gran cambio (3 de 8 pruebas), así que nadie notó, por ejemplo, el botón de recompras roto. Las reglas de folios, totales y permisos no tienen pruebas.
- **Qué se haría:** dejar las pruebas en verde (con R3), incluir la simulación en `npm test`, que Render publique solo si las pruebas pasan (`npm ci && npm test`) y separar las funciones de folio, totales y fechas para poder probarlas.
- **Esfuerzo:** medio
- **Referencia:** `tests/sesion-conexion.test.cjs:33`, `server/index.js:1075`

**M2. Que un rechazo del servidor no se muestre como éxito**
- **Por qué importa:** al cambiar el nombre o el correo de un usuario por uno que ya existe, la pantalla dice "Usuario actualizado" aunque no se guardó nada.
- **Qué se haría:** tratar ese tipo de rechazo (código 409) como error en todas las pantallas, salvo donde se espera a propósito.
- **Esfuerzo:** bajo
- **Referencia:** `public/app.js:78`

**M3. Calcular el total y el importe en letras en un solo lugar**
- **Por qué importa:** el total se calcula en cuatro lugares con reglas distintas. En casos raros (más de 2 decimales, millones exactos) la cifra y el texto en letras del PDF no coinciden.
- **Qué se haría:** una sola función de total redondeada a centavos, corregir las centésimas y el "DE PESOS" en el importe en letras, y cubrirlo con 8 a 10 casos de prueba.
- **Esfuerzo:** bajo
- **Referencia:** `public/app.js:410`

**M4. Una ruta de "salud" y mejores registros de errores**
- **Por qué importa:** ni Render ni un monitor externo pueden saber si el CRM está funcionando ni si la base es persistente, y cuando algo falla el registro no dice dónde.
- **Qué se haría:** agregar una ruta pública `/api/salud`, conectarla a Render y a un monitor gratuito, y guardar el detalle completo de cada error.
- **Esfuerzo:** bajo
- **Referencia:** `server/index.js:103`

**M5. Reglas de validación en un solo lugar y limpieza de código que ya no se usa** (agrupa 2)
- **Por qué importa:** las reglas de teléfono, correo, roles y fechas están copiadas con diferencias, así que un dato se acepta en una pantalla y se rechaza en otra. La fecha de los recordatorios no se valida, y cuando la base rechaza un dato el usuario ve un mensaje genérico.
- **Qué se haría:**
  - Crear `server/validaciones.js` con esas reglas en un solo lugar.
  - Validar la fecha de los recordatorios y mostrar el motivo real cuando la base rechaza un dato.
  - Borrar las 5 rutas de análisis que no se usan.
- **Esfuerzo:** medio
- **Referencia:** `server/index.js:497`, `server/index.js:671`, `server/index.js:88`

**M6. Que los generadores de PDF y Word compartan sus datos**
- **Por qué importa:** cuatro funciones largas repiten el folio, el membrete y el bloque del cliente. Cualquier cambio (IVA, RFC) obliga a tocar las cuatro, y ya hay diferencias: el Word no lleva pie con folio ni número de página.
- **Qué se haría:** preparar los datos del documento una sola vez y compartir los bloques comunes entre las cuatro funciones.
- **Esfuerzo:** medio
- **Referencia:** `public/app.js:721`

**M7. Ordenar `app.js` por partes**
- **Por qué importa:** son 2,100 líneas, y tres archivos más modifican sus mismos datos internos; cada mejora cuesta más horas y es fácil dejar una pantalla con datos viejos.
- **Qué se haría:** por pasos y sin reescribir: dar formato al código, crear una sola función para recargar la ficha y después separar el archivo por pantallas.
- **Esfuerzo:** alto
- **Referencia:** `public/servicios-tabla.js:98`

---

## Los 3 primeros pasos que recomiendo

1. **Hoy mismo, sin programar (U2, U3, R1 y U5 provisional):**
   - En el panel de Render, decidir entre disco persistente con `DB_PATH` o dejar de usar Render con datos reales.
   - Definir `APP_URL`, `TRUST_PROXY` y `TZ=America/Mexico_City` en Render y en el `.env` local.
   - Descargar un respaldo con el botón y guardarlo en Drive.
   - En Catálogos, ponerle días de recurrencia a "Desazolve con máquina eléctrica".

2. **Primer paquete de código corto, de 1 a 2 días (U1, U4, R1, R2, R3):**
   - Limpiar todos los textos que se muestran en pantalla.
   - Dejar el borrado de órdenes solo al administrador.
   - Arreglar el botón de recompras.
   - Corregir la fecha de las cotizaciones de la tarde.
   - Corregir el manejo de conexión, con lo que `npm test` queda en verde.

   Son los riesgos más graves y casi todos tienen esfuerzo bajo.

3. **Respaldo automático y luego la primera función nueva (U5, después N1 y N2):** dejar programado el respaldo diario fuera del servidor, con el cierre ordenado de la base y el comando para restaurar. Con los datos ya protegidos, empezar con el botón "Enviar por WhatsApp" (rápido y ligado a ventas) y después la Agenda de servicios.