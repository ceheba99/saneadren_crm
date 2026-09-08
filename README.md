# Saneadren · Sistema de registro de leads

## Qué incluye
- **Alta rápida**: teléfono + nombre + canal + servicio en un solo bloque, con detección de duplicados por teléfono en tiempo real (mientras escribes).
- **Responsable automático**: cada canal (llamada, WhatsApp, correo, Facebook, Instagram, etc.) tiene un responsable por defecto configurado en la base de datos; se precarga solo pero se puede cambiar antes de guardar.
- **Tablero de 4 etapas** (kanban): Recolección de datos → Cotización/Visita → Cierre/Programación → Post-venta. Cambiar de etapa es un clic dentro de la ficha del lead.
- **Ficha editable**: datos del contacto, historial de observaciones, alertas con fecha ("volver a contactar mañana"), marcar ganado/perdido/reabrir.
- **Vista de alertas**: todas las alertas vencidas o de hoy, con acceso directo a la ficha del lead y botón para resolverlas.
- **Filtros**: por responsable, por estatus (abierto/ganado/perdido) y búsqueda por nombre o teléfono.

## Requisitos
- Node.js 18+

## Instalación
```bash
npm install
node server/index.js
```
El sistema corre en `http://localhost:3210`. La base de datos SQLite (`saneadren.db`) se crea sola en el primer arranque, junto con los catálogos iniciales (servicios, canales, usuarios de ejemplo).

## Exponerlo a tu equipo (mismo patrón que tu sistema QR)
```bash
cloudflared tunnel --url http://localhost:3210
```
o configúralo como tunnel permanente igual que en `qr-inventory-system`.

## Personalizar catálogos iniciales
Edita el bloque `seed()` en `server/db.js`:
- **Usuarios**: nombre + rol (`admin`, `ventas`, `atencion`, `tecnico`). Agrega ahí a tu equipo real.
- **Servicios**: lista de servicios que ofrece Saneadren (ya precargada con desazolve, retiro de agua, fosas, trampas de grasa, video inspección, CIPP, plantas de tratamiento, industrial).
- **Canales**: cada canal apunta a un `responsable_default_id` (el índice del usuario en el array, empezando en 1). Cambia esos números para asignar quién atiende cada canal.

Después de editar, borra `saneadren.db` (o las tablas correspondientes) para que se vuelva a poblar, o inserta manualmente con SQL.

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
3. **Login**: este primer entregable no tiene autenticación — cualquiera con el enlace puede editar. Si tu equipo va a usarlo desde fuera de tu red, conviene agregar login simple (usuario/contraseña) antes de compartir el link públicamente.
4. **Migración de tu Excel actual**: si quieres, te ayudo a importar tus leads existentes de Google Sheets/Excel a la base de datos para no perder el historial.
5. **Cotización/servicio**: en la Etapa 2 dijiste "envío de cotización o visita técnica" — por ahora es una nota libre en el historial; si manejan montos o folios de cotización formales, podemos agregar esos campos.
