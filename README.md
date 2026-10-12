# Saneadren · Sistema de registro de leads

## Qué incluye
- **Alta rápida**: teléfono + nombre + canal + servicio en un solo bloque, con detección de duplicados por teléfono en tiempo real (mientras escribes).
- **Responsable automático**: cada canal (llamada, WhatsApp, correo, Facebook, Instagram, etc.) tiene un responsable por defecto configurado en la base de datos; se precarga solo pero se puede cambiar antes de guardar.
- **Tablero de 4 etapas** (kanban): Recolección de datos → Cotización/Visita → Cierre/Programación → Post-venta. Cambiar de etapa es un clic dentro de la ficha del lead.
- **Ficha editable**: datos del contacto, historial de observaciones, alertas con fecha ("volver a contactar mañana"), marcar ganado/perdido/reabrir.
- **Cotización vs. orden de servicio**:
  - *Cotización* (folio `COT-`): se crea desde "Nueva cotización"; se exporta como propuesta, se descarta o se convierte en orden con "Generar orden de servicio". Las cotizaciones **no** se duplican.
  - *Orden de servicio* (folio `OS-`): sale de una cotización aceptada, o se registra directo cuando el cliente ya confirmó. Solo las órdenes se pueden **duplicar** (servicio recurrente): se copian partidas, importe, ubicación y notas, y solo se pide la nueva fecha. Una orden directa o duplicada no muestra folio de cotización ni se puede "reabrir" como cotización.
- **Membretes**: `public/membrete-cotizacion.png` y `public/membrete-orden-servicio.png` se generan con `node herramientas/membretes/servidor.js` → http://localhost:3301 → "Guardar en public/". Los datos de contacto y textos están al inicio de `herramientas/membretes/membretes.html`.
- **Cuentas y seguridad**: el personal se registra solo con correo `@saneadren.com.mx` (debe confirmar el correo antes de entrar), puede restablecer su contraseña por correo y se le pide cambiar contraseñas débiles heredadas (p. ej. `1234`) al iniciar sesión. Ver "Configuración de correo" abajo.
- **Cuentas por cobrar y por pagar** (pestaña **Cuentas**, admin y atención):
  - *Por cobrar*: cada orden de servicio es una cuenta por cobrar. Saldo = total (o total facturado con IVA, si se captura) − pagos. Antigüedad (por vencer, 1-15, 16-30, 31-60, +60), vista por cliente u orden, recordatorio por WhatsApp, días de crédito por cliente y por orden, folio y fecha de factura CFDI (emitida fuera del sistema).
  - Los pagos se registran desde la lista o desde la ficha de la orden. Ventas y técnicos pueden registrarlos en campo, pero quedan **por confirmar** hasta que el admin los valida. Los pagos **no se borran**: el admin los cancela con motivo y queda en la bitácora.
  - *Revisión inicial*: las órdenes que ya existían al instalar el módulo no cuentan como deuda hasta que el admin indica cuáles ya se cobraron.
  - *Por pagar* y *Proveedores* (solo admin): facturas o gastos de proveedores con vencimiento según su crédito, gasto de contado ("ya lo pagué"), pagos parciales, agrupado por vencidas / esta semana / próxima semana, y relación opcional con una orden y un equipo.
  - Inicio muestra el bloque **Dinero** (te deben, vencido, por confirmar, pagar esta semana).
  - **Carga masiva con plantillas de Excel** (solo admin): en *Por cobrar* y *Por pagar*, "Descargar plantilla" baja un `.xlsx` con hoja de instrucciones, listas desplegables (servicios del catálogo, categorías, métodos de pago) y validaciones. Se llena un renglón por registro y se usa "Subir plantilla": primero aparece una vista previa con los errores por renglón; **si hay un solo error no se importa nada**. Por cobrar crea (o reutiliza por teléfono) el cliente y una orden de servicio con su saldo y lo ya pagado; por pagar crea el proveedor si no existe y la factura o gasto. Subir dos veces el mismo archivo se detecta como duplicado. Máximo 1,000 renglones por archivo.
- **Permisos**:
  | Acción | Todos | Solo admin |
  |---|---|---|
  | Ver y administrar usuarios (crear, nombre, correo, rol, contraseña temporal, desactivar) | | ✔ |
  | Descargar respaldo de la base de datos | | ✔ |
  | Editar descripción de servicios y reordenarlos | ✔ | |
  | Dar de alta / eliminar servicios y cambiar su recurrencia | | ✔ |
  | Agregar, renombrar y reordenar canales ("cómo se enteró") | ✔ | |
  | Agregar y renombrar tipos de cliente | ✔ | |
  | Ver cuentas por cobrar, crédito y facturas | (admin y atención) | |
  | Registrar un pago de cliente desde la orden | ✔ (ventas/técnico: queda por confirmar) | |
  | Confirmar o cancelar pagos, revisión inicial | | ✔ |
  | Cuentas por pagar y proveedores | | ✔ |
  | Borrar cotizaciones u órdenes (sin pagos) | | ✔ |
  El servidor valida los permisos de cada acción de la tabla. Ojo: las pantallas de trabajo (contactos, cotizaciones) muestran sus datos a todos los usuarios con sesión, así que ocultar "Exportar a Excel" evita la descarga masiva con un clic, pero no impide que alguien copie lo que ve.
- **Vista de alertas**: todas las alertas vencidas o de hoy, con acceso directo a la ficha del lead y botón para resolverlas.
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
