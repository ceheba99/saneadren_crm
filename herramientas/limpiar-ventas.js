// LIMPIEZA DE VENTAS, FACTURACIÓN Y CUENTAS POR PAGAR (2026-11-05): deja en cero lo comercial (clientes, órdenes, cobros,
// facturas, cuentas por pagar, compras, prospección y sus catálogos) para empezar con datos reales.
// Se CONSERVA: RH (personal, checadas, horarios, credenciales, WhatsApp), marketing, canales de origen, usuarios, roles,
// permisos, sucursales y la bitácora de auditoría. Los catálogos de fábrica (servicios, unidades, etc.) vuelven al reiniciar.
//
// Uso (desde la carpeta de la app, con DB_PATH apuntando a la base; si la consola no la pasa, se escribe con --base=):
//   npm run limpieza-revisar [-- --base=/ruta/saneadren.db]   → solo cuenta lo que se borraría y lo que se queda.
//   npm run limpieza-borrar  [-- --base=/ruta/saneadren.db]   → copia la base (antes-de-limpieza-<fecha>.db), mueve los archivos a
//                                archivos-antes-de-limpieza-<fecha>/ y borra todo en una sola transacción.
// Si hay alguna factura timbrada en PRODUCCIÓN, no borra nada.
const fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');

const BORRAR = process.argv.includes('--borrar');
// La consola de comandos de Plesk no pasa las variables de la app: ahí la ruta se escribe con --base=.
const argBase = (process.argv.find(a => a.startsWith('--base=')) || '').slice('--base='.length);
const DB_PATH = argBase || process.env.DB_PATH ? path.resolve(argBase || process.env.DB_PATH) : '';
const alto = msg => { console.error('\n✘ ' + msg + '\n  No se cambió nada.'); process.exit(1); };
if (!DB_PATH) alto('Falta la ruta de la base. Agrégala al comando: run limpieza-revisar -- --base=/ruta/de/la/base.db (es el valor de DB_PATH en Environment).');
if (!fs.existsSync(DB_PATH)) alto('No existe la base en ' + DB_PATH);

// En orden: primero lo que cuelga de otra tabla.
const BORRAR_TABLAS = [
  // Facturación
  'factura_cobros', 'factura_ventas', 'facturas_log', 'facturas', 'clientes_fiscales', 'series_factura',
  // Lo que cuelga de cada orden
  'encuestas', 'orden_personal', 'historial', 'historial_archivo',
  // Cuentas por pagar y compras
  'cfdi_gastos', 'pagos_proveedor', 'documentos_oc', 'documentos_solicitud', 'solicitudes_compra', 'ordenes_compra',
  'cobros', 'cuentas_por_pagar', 'proveedores',
  // Prospección
  'seguimientos_prospeccion', 'establecimientos', 'sectores_prospeccion',
  // Órdenes y clientes
  'leads', 'telefonos_cliente', 'clientes_alias', 'clientes_distintos', 'clientes_fusionados', 'cliente_sucursales',
  'plantillas_descripcion', 'clientes',
  // Catálogos comerciales (los de fábrica se vuelven a poner al reiniciar)
  'servicio_listas', 'servicios_alias', 'catalogo_servicios', 'tipos_cliente', 'categorias_gasto', 'centros_costo', 'unidades_medida'
];
const CONSERVAR = {
  'RH': ['personal', 'documentos_personal', 'incidencias_personal', 'checadas', 'checadas_correcciones', 'checador_dispositivos',
    'horarios', 'horario_versiones', 'personal_horario', 'extra_autorizaciones', 'precios_hora_puesto', 'dias_festivos', 'credenciales', 'whatsapp_mensajes'],
  'Marketing': ['proyectos_marketing', 'tareas_marketing', 'avances_marketing', 'archivos_marketing', 'biblioteca_marketing', 'ideas_marketing',
    'publicaciones', 'publicacion_imagenes', 'publicacion_metricas', 'mk_gastos', 'mk_presupuestos', 'mk_objetivos', 'mk_metas',
    'google_ads_cargas', 'google_ads_llamadas', 'canales'],
  'Sistema': ['usuarios', 'roles', 'rol_permisos', 'sucursales', 'auditoria']
};
// Carpetas de archivos/ que son de lo que se borra (las de RH y marketing no se tocan).
const CARPETAS = ['facturas', 'cuentas_por_pagar', 'ordenes_compra', 'solicitudes'];
const FOLIOS = ['leads', 'solicitudes', 'ordenes_compra'];

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA busy_timeout = 5000');
const existe = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const cuenta = t => existe(t) ? db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n : null;
const tablas = BORRAR_TABLAS.filter(existe);

console.log('Base: ' + DB_PATH + '\n\nSE BORRA:');
for (const t of tablas) console.log('  ' + t.padEnd(26) + cuenta(t));
for (const [grupo, ts] of Object.entries(CONSERVAR)) {
  console.log('\nSE QUEDA · ' + grupo + ':');
  for (const t of ts) if (existe(t)) console.log('  ' + t.padEnd(26) + cuenta(t));
}

// Candado: una factura real (producción) nunca se borra.
const reales = existe('facturas') ? db.prepare("SELECT COUNT(*) n FROM facturas WHERE entorno = 'prod' AND COALESCE(uuid, '') <> ''").get().n : 0;
if (reales) alto(`Hay ${reales} factura(s) timbrada(s) en PRODUCCIÓN. Esas tienen validez fiscal y no se borran.`);

if (!BORRAR) { console.log('\nModo REVISAR: no se cambió nada. Para borrar: el mismo comando con limpieza-borrar en vez de limpieza-revisar.'); process.exit(0); }

const sello = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' })
  .format(new Date()).replace(/[^0-9]/g, '').replace(/^(\d{8})/, '$1-');
const base = path.dirname(DB_PATH);
const copia = path.join(base, `antes-de-limpieza-${sello}.db`);
if (fs.existsSync(copia)) alto('Ya existe ' + copia + '. Espera un minuto y vuelve a correrlo.');
db.exec(`VACUUM INTO '${copia.replace(/'/g, "''")}'`);
console.log('\n✔ Copia de la base: ' + copia);

const original = {}; for (const t of tablas) original[t] = cuenta(t);
// Los candados «no se borra» de estas tablas se quitan solo dentro de la transacción y se vuelven a poner igual.
const marca = tablas.map(() => '?').join(',');
const candados = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN (${marca})`).all(...tablas);
db.exec('PRAGMA foreign_keys = OFF');
db.exec('BEGIN IMMEDIATE');
try {
  for (const c of candados) db.exec(`DROP TRIGGER ${c.name}`);
  for (const t of tablas) db.exec(`DELETE FROM ${t}`);
  if (existe('contadores_folio')) db.prepare(`UPDATE contadores_folio SET ultimo = 0 WHERE tipo IN (${FOLIOS.map(() => '?').join(',')})`).run(...FOLIOS);
  if (existe('sqlite_sequence')) db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${marca})`).run(...tablas);
  for (const c of candados) db.exec(c.sql);
  const rotas = db.prepare('PRAGMA foreign_key_check').all();
  if (rotas.length) throw new Error('Quedarían registros sueltos: ' + JSON.stringify(rotas.slice(0, 5)));
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  alto('Falló la limpieza y se deshizo todo: ' + e.message);
}

let movidas = 0;
const destino = path.join(base, `archivos-antes-de-limpieza-${sello}`);
for (const c of CARPETAS) {
  const de = path.join(base, 'archivos', c);
  if (!fs.existsSync(de)) continue;
  fs.mkdirSync(destino, { recursive: true });
  fs.renameSync(de, path.join(destino, c));
  movidas++;
}

console.log('\n✔ LIMPIEZA HECHA:');
for (const t of tablas) if (original[t]) console.log('  ' + t.padEnd(26) + original[t] + ' → ' + cuenta(t));
console.log('  folios de órdenes, solicitudes y OC: vuelven a empezar en 1');
console.log(movidas ? `✔ Archivos de ventas/facturas/CxP movidos a: ${destino}` : '✔ No había archivos de ventas/facturas/CxP');
console.log('\nAHORA reinicia la app (Restart App) para que vuelvan los catálogos de fábrica.');
