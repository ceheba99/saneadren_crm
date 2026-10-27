// Herramienta de facturación con factura.com (F2): probar la conexión, bajar los catálogos del SAT, ver y asignar series, y sincronizar
// clientes. SIN PROBAR contra la API real hasta tener llaves de sandbox. Nunca muestra las llaves. Los comandos que CAMBIAN algo en
// factura.com (crear-serie, cliente, vincular) se niegan a correr en PRODUCCIÓN salvo con --si-es-produccion.
// Uso (desde la carpeta del proyecto):
//   npm run facturacion -- probar
//   npm run facturacion -- catalogos [--claves-producto]
//   npm run facturacion -- series
//   npm run facturacion -- crear-serie <LETRA> <factura|pago> [folio-inicial]
//   npm run facturacion -- asignar-serie <clave-de-sucursal> <factura|pago> <id-de-serie>
//   npm run facturacion -- sucursal-cp <clave-de-sucursal> <CP-de-5-digitos>
//   npm run facturacion -- cliente <id-del-dato-fiscal> [--crear-aunque-exista]
//   npm run facturacion -- vincular <id-del-dato-fiscal> <UID-en-factura.com>
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { leerConfig } = require('../server/facturacion-config');
const { crearClienteFactura, ErrorFactura } = require('../server/facturacom');
const { sincronizarCatalogos, leerCatalogos } = require('../server/facturacion-catalogos');
const { listarSeries, crearSerie, asignarSerie } = require('../server/facturacion-series');
const { sincronizarCliente, vincularCliente } = require('../server/facturacion-clientes');

const args = process.argv.slice(2), banderas = new Set(args.filter(a => a.startsWith('--'))), pos = args.filter(a => !a.startsWith('--'));
const [orden, ...resto] = pos;
const config = leerConfig();
const ok = t => console.log('✔ ' + t), mal = t => { console.error('✘ ' + t); process.exitCode = 1; };
const MUTAN = new Set(['crear-serie', 'cliente', 'vincular']);

function abrirBase() {
  const ruta = process.env.DB_PATH || path.join(__dirname, '..', 'saneadren.db');
  const db = new DatabaseSync(ruta);
  const hay = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('facturas', 'sat_catalogos', 'series_factura', 'clientes_fiscales')").all().length;
  if (hay < 4) { db.close(); throw new ErrorFactura('config', 'La base de datos todavía no tiene las tablas de facturación: arranca el sistema una vez (npm start) y vuelve a intentar.'); }
  return db;
}
const cliente = () => crearClienteFactura({ config });
const tabla = (filas, cols) => { for (const f of filas) console.log('  ' + cols.map(([k, ancho]) => String(f[k] ?? '').padEnd(ancho)).join(' ')); };

async function main() {
  console.log(`Entorno: ${config.entorno === 'prod' ? 'PRODUCCIÓN (con validez fiscal)' : 'sandbox (pruebas)'} · ${config.host}`);
  if (MUTAN.has(orden) && config.entorno === 'prod' && !banderas.has('--si-es-produccion')) throw new ErrorFactura('config', `«${orden}» cambia datos reales en factura.com y estás en PRODUCCIÓN. Si de verdad quieres, agrega --si-es-produccion.`);
  switch (orden) {
    case 'probar': {
      if (config.faltantes.length) throw new ErrorFactura('config', 'Falta configurar: ' + config.faltantes.join(', ') + ' (npm run facturacion-estado)');
      const series = await listarSeries(cliente());
      ok(`La conexión funciona y factura.com aceptó las llaves. Series en esta cuenta: ${series.length}`);
      tabla(series, [['id', 8], ['nombre', 8], ['tipo', 10], ['estado', 10]]);
      break;
    }
    case 'catalogos': {
      const db = abrirBase();
      const r = await sincronizarCatalogos(cliente(), db, { clavesProducto: banderas.has('--claves-producto') });
      for (const x of r) (x.error ? mal : ok)(`${x.catalogo}: ${x.actualizado ? x.total + ' claves guardadas' : (x.motivo || 'sin cambios') + ` (hay ${x.total})`}`);
      const c = leerCatalogos(db);
      if (c.regimenes) ok(`Régimen 626 en el catálogo: ${c.regimenes.has('626') ? 'sí (' + c.regimenes.get('626') + ')' : 'NO aparece'}`);
      db.close(); break;
    }
    case 'series': {
      const series = await listarSeries(cliente());
      ok(`${series.length} serie(s) en factura.com`); tabla(series, [['id', 8], ['nombre', 8], ['tipo', 10], ['estado', 10]]);
      const db = abrirBase();
      const asignadas = db.prepare('SELECT s.clave, x.tipo_documento, x.serie, x.serie_uid FROM series_factura x JOIN sucursales s ON s.id = x.sucursal_id ORDER BY s.id, x.tipo_documento').all();
      console.log(asignadas.length ? '\nAsignadas a sucursales:' : '\nTodavía no hay series asignadas a sucursales.'); tabla(asignadas, [['clave', 7], ['tipo_documento', 10], ['serie', 8], ['serie_uid', 8]]);
      db.close(); break;
    }
    case 'crear-serie': {
      const [letra, tipo, folio] = resto;
      if (!letra || !tipo) throw new ErrorFactura('config', 'Uso: crear-serie <LETRA> <factura|pago> [folio-inicial]');
      const s = await crearSerie(cliente(), { letra, tipoDocumento: tipo, folio: folio ? Number(folio) : undefined });
      ok(`Serie creada: «${s.nombre}» (${s.tipo}) con id ${s.id}. Para usarla en una sucursal: asignar-serie <sucursal> ${s.tipo} ${s.id}`); break;
    }
    case 'asignar-serie': {
      const [clave, tipo, id] = resto;
      if (!clave || !tipo || !id) throw new ErrorFactura('config', 'Uso: asignar-serie <clave-de-sucursal> <factura|pago> <id-de-serie>');
      const db = abrirBase(); const suc = db.prepare('SELECT id FROM sucursales WHERE upper(clave) = upper(?)').get(clave);
      if (!suc) throw new ErrorFactura('config', `No hay una sucursal con la clave «${clave}».`);
      const r = await asignarSerie(cliente(), db, suc.id, tipo, id);
      ok(`La sucursal ${r.sucursal} usará la serie «${r.serie}» (${r.tipoDocumento}).`); db.close(); break;
    }
    case 'sucursal-cp': {
      const [clave, cp] = resto;
      if (!clave || !/^\d{5}$/.test(cp || '')) throw new ErrorFactura('config', 'Uso: sucursal-cp <clave-de-sucursal> <CP de 5 dígitos>');
      const db = abrirBase(); const r = db.prepare('UPDATE sucursales SET cp_expedicion = ? WHERE upper(clave) = upper(?)').run(cp, clave);
      if (!r.changes) throw new ErrorFactura('config', `No hay una sucursal con la clave «${clave}».`);
      ok(`CP de expedición de ${clave.toUpperCase()}: ${cp}`); db.close(); break;
    }
    case 'cliente': {
      if (!resto[0]) throw new ErrorFactura('config', 'Uso: cliente <id-del-dato-fiscal> [--crear-aunque-exista]');
      const db = abrirBase(); const r = await sincronizarCliente(cliente(), db, resto[0], { crearAunqueExista: banderas.has('--crear-aunque-exista') });
      if (r.estado === 'existe') { mal('Ya hay clientes con ese RFC en factura.com y no se creó nada. Elige uno y vincúlalo, o crea otro a propósito:'); tabla(r.candidatos, [['uid', 16], ['razon_social', 30], ['cp', 6]]); console.log(`  → vincular ${resto[0]} <UID>   ·   cliente ${resto[0]} --crear-aunque-exista`); }
      else ok(`Cliente ${r.estado} en factura.com (UID ${r.uid}).`);
      db.close(); break;
    }
    case 'vincular': {
      if (!resto[0] || !resto[1]) throw new ErrorFactura('config', 'Uso: vincular <id-del-dato-fiscal> <UID-en-factura.com>');
      const db = abrirBase(); const r = await vincularCliente(cliente(), db, resto[0], resto[1]); ok(`Vinculado con el cliente ${r.uid} de factura.com.`); db.close(); break;
    }
    default:
      console.log('Comandos: probar · catalogos [--claves-producto] · series · crear-serie · asignar-serie · sucursal-cp · cliente · vincular\nVe el encabezado de este archivo (herramientas/facturacion-sandbox.js) para el uso de cada uno.');
  }
}
main().catch(e => { mal(e instanceof ErrorFactura ? e.message : 'Error inesperado: ' + e.message); if (e.detalles?.length) for (const d of e.detalles) console.error(`   · ${d.campo}: ${d.mensaje}`); });
