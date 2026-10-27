/* Facturación CFDI 4.0 · F2 (2026-10-27): series de factura.com y su asignación a cada sucursal. SIN PROBAR contra la API real. De apidocs/series.html:
     GET  /v4/series          → { status, data: [{ SerieID, SerieName, SerieType, SerieDescription, SerieStatus: «Activa» }] }
     POST /v4/series/create   → { letra, tipoDocumento, folio? }  → { response: «success», message } (NO devuelve el ID de la serie)
   · La serie debe corresponder al tipo de documento (factura, pago…): se comprueba antes de asignarla.
   · Como crear no devuelve el ID, después de crear se vuelve a listar para encontrarla.
   · Por confirmar en sandbox: la doc usa «SerieID» como UID de la serie en las rutas /v4/series/{UID}, sin decirlo expresamente. */
const { ErrorFactura } = require('./facturacom');
const { TIPOS_DOCUMENTO } = require('./facturacion-db');

const normalizar = s => ({ id: String(s.SerieID ?? '').trim(), nombre: String(s.SerieName ?? '').trim(), tipo: String(s.SerieType ?? '').trim().toLowerCase(), descripcion: String(s.SerieDescription ?? '').trim(),
  estado: String(s.SerieStatus ?? '').trim(), activa: /^activa$/i.test(String(s.SerieStatus ?? '').trim()) });

async function listarSeries(cliente) {
  const res = await cliente.get('/v4/series');
  if (!Array.isArray(res.datos)) throw new ErrorFactura('respuesta', 'factura.com no devolvió la lista de series.');
  return res.datos.map(normalizar).filter(s => s.id);
}

/** Crea una serie nueva y la devuelve (la busca en la lista, porque la API no regresa su ID). */
async function crearSerie(cliente, { letra, tipoDocumento, folio }) {
  const l = String(letra ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,10}$/.test(l)) throw new ErrorFactura('config', 'La serie debe llevar de 1 a 10 letras o números, sin espacios.');
  if (!TIPOS_DOCUMENTO.includes(tipoDocumento)) throw new ErrorFactura('config', `El tipo de documento debe ser uno de: ${TIPOS_DOCUMENTO.join(', ')}.`);
  if (folio !== undefined && (!Number.isInteger(folio) || folio < 1)) throw new ErrorFactura('config', 'El folio inicial debe ser un número entero mayor a 0.');
  if ((await listarSeries(cliente)).some(s => s.nombre.toUpperCase() === l && s.tipo === tipoDocumento)) throw new ErrorFactura('config', `Ya existe una serie «${l}» de ${tipoDocumento} en factura.com.`);
  await cliente.post('/v4/series/create', { letra: l, tipoDocumento, ...(folio ? { folio } : {}) });
  const creada = (await listarSeries(cliente)).find(s => s.nombre.toUpperCase() === l && s.tipo === tipoDocumento);
  if (!creada) throw new ErrorFactura('respuesta', 'La serie se creó pero no apareció en la lista: revísala en el panel de factura.com.');
  return creada;
}

/** Deja asignada la serie (de factura.com) a una sucursal y tipo de documento. */
async function asignarSerie(cliente, db, sucursalId, tipoDocumento, serieId) {
  const suc = db.prepare('SELECT id, nombre FROM sucursales WHERE id = ? AND activo = 1').get(Number(sucursalId));
  if (!suc) throw new ErrorFactura('config', 'Esa sucursal no existe o está desactivada.');
  if (!TIPOS_DOCUMENTO.includes(tipoDocumento)) throw new ErrorFactura('config', `El tipo de documento debe ser uno de: ${TIPOS_DOCUMENTO.join(', ')}.`);
  const serie = (await listarSeries(cliente)).find(s => s.id === String(serieId));
  if (!serie) throw new ErrorFactura('config', `La serie ${serieId} no existe en factura.com.`);
  if (serie.tipo !== tipoDocumento) throw new ErrorFactura('config', `Esa serie es de tipo «${serie.tipo}», no de «${tipoDocumento}»: la serie debe corresponder al tipo de documento.`);
  if (!serie.activa) throw new ErrorFactura('config', `La serie «${serie.nombre}» está desactivada en factura.com.`);
  const usada = db.prepare("SELECT s.nombre FROM series_factura x JOIN sucursales s ON s.id = x.sucursal_id WHERE x.serie_uid = ? AND x.tipo_documento = ? AND x.sucursal_id <> ? AND x.activo = 1").get(serie.id, tipoDocumento, suc.id);
  if (usada) throw new ErrorFactura('config', `Esa serie ya está asignada a la sucursal «${usada.nombre}»: cada sucursal lleva la suya.`);
  db.prepare("INSERT INTO series_factura (sucursal_id, tipo_documento, serie, serie_uid, activo) VALUES (?, ?, ?, ?, 1) ON CONFLICT(sucursal_id, tipo_documento) DO UPDATE SET serie = excluded.serie, serie_uid = excluded.serie_uid, activo = 1")
    .run(suc.id, tipoDocumento, serie.nombre, serie.id);
  return { sucursal: suc.nombre, tipoDocumento, serie: serie.nombre, serie_uid: serie.id };
}

module.exports = { listarSeries, crearSerie, asignarSerie };
