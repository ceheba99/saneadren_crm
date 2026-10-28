/* Facturación CFDI 4.0 con factura.com · F1 (2026-10-27): tablas y columnas ADITIVAS (no se borra ni se renombra nada).
   Se ejecuta al arrancar, es idempotente (se puede correr las veces que sea) y no toca los datos existentes.
   Decisiones (ver CLAUDE.md y la conversación del 2026-10-27):
   · Una orden puede tener VARIAS facturas a lo largo del tiempo (cancelar y sustituir con motivo 01): por eso no hay UNIQUE
     simple por orden; el índice único es PARCIAL y solo cuenta las facturas vigentes (pendiente, timbrando, timbrada,
     borrador con error, cancelación en proceso). Una cancelada ya no estorba.
   · Los datos fiscales NO van como columnas de «clientes»: el cliente se identifica por su teléfono, pero un mismo contacto
     puede facturar a más de una razón social, y cada una tiene su propio UID en factura.com → tabla clientes_fiscales.
   · Cada factura guarda una FOTO del receptor (RFC, razón social, CP, régimen, uso) tal como se timbró.
   · El XML timbrado se guarda en la base (la copia diaria la respalda; la carpeta «archivos» no entra en ese respaldo).
   · Las claves del SAT (ClaveProdServ, ClaveUnidad, ObjetoImp) y la compatibilidad régimen–uso NO están escritas aquí:
     las claves se capturan en el catálogo de servicios y los catálogos oficiales se copian de la API en sat_catalogos (F2). */

// Estatus de una factura. Los vigentes ocupan el «lugar» de la orden: mientras haya uno, no se puede timbrar otra.
const ESTATUS = ['pendiente', 'timbrando', 'timbrada', 'borrador_error', 'cancelacion_solicitada', 'cancelada'];
const ESTATUS_VIGENTES = ['pendiente', 'timbrando', 'timbrada', 'borrador_error', 'cancelacion_solicitada'];
const TIPOS_DOCUMENTO = ['factura', 'pago']; // «TipoDocumento» de la API: ingreso y complemento de pago
// Dónde se timbró (F3, 2026-10-27): sandbox (pruebas, sin validez fiscal), prod (real) o demo (simulada, sin llamar a nadie).
// Solo una factura de «prod» toca la orden (folio de factura en cobranza); las demás viven aparte y no estorban a la real.
const ENTORNOS = ['sandbox', 'prod', 'demo'];

function crearTablasFacturacion(db) {
  const columnas = tabla => db.prepare(`PRAGMA table_info(${tabla})`).all().map(c => c.name);
  const agregar = (tabla, col, def) => { if (!columnas(tabla).includes(col)) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${col} ${def}`); };
  const lista = a => a.map(x => `'${x}'`).join(', ');

  db.exec(`
    -- Datos fiscales de quien recibe la factura: varios por cliente (cada uno con su UID en factura.com).
    -- Se permiten incompletos (solo el RFC es obligatorio) para poder marcar «qué falta»; el servicio de timbrado no timbra con datos incompletos.
    CREATE TABLE IF NOT EXISTS clientes_fiscales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
      rfc TEXT NOT NULL CHECK(length(rfc) BETWEEN 12 AND 13),
      razon_social TEXT NOT NULL DEFAULT '' CHECK(length(razon_social) <= 254),
      cp TEXT NOT NULL DEFAULT '' CHECK(cp = '' OR (length(cp) = 5 AND cp NOT GLOB '*[^0-9]*')),
      regimen TEXT NOT NULL DEFAULT '' CHECK(regimen = '' OR (length(regimen) = 3 AND regimen NOT GLOB '*[^0-9]*')),
      uso_cfdi TEXT NOT NULL DEFAULT '' CHECK(length(uso_cfdi) <= 4),
      correo TEXT NOT NULL DEFAULT '' CHECK(length(correo) <= 254),
      uid_facturacom TEXT,
      predeterminado INTEGER NOT NULL DEFAULT 0 CHECK(predeterminado IN (0, 1)),
      activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
      creado_por INTEGER REFERENCES usuarios(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(cliente_id, rfc)
    );
    CREATE INDEX IF NOT EXISTS idx_clientes_fiscales_cliente ON clientes_fiscales(cliente_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_fiscales_uid ON clientes_fiscales(uid_facturacom) WHERE uid_facturacom IS NOT NULL;

    -- Una fila por CFDI (ingreso o complemento de pago). Nunca se borra un CFDI timbrado: solo cambia su estatus.
    CREATE TABLE IF NOT EXISTS facturas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER REFERENCES leads(id) ON DELETE RESTRICT, -- la orden de origen; NULL en una factura global (ver factura_ventas)
      sucursal_id INTEGER NOT NULL REFERENCES sucursales(id), -- la sucursal de la orden: de ahí salen la serie y el CP de expedición
      tipo_documento TEXT NOT NULL DEFAULT 'factura' CHECK(tipo_documento IN (${lista(TIPOS_DOCUMENTO)})),
      estatus TEXT NOT NULL DEFAULT 'pendiente' CHECK(estatus IN (${lista(ESTATUS)})),
      num_order TEXT NOT NULL, -- idempotencia: identifica la venta en factura.com (la sustituta lleva su propio consecutivo)
      sustituye_a INTEGER REFERENCES facturas(id),
      -- receptor tal como se timbró (foto)
      cliente_fiscal_id INTEGER REFERENCES clientes_fiscales(id),
      receptor_rfc TEXT NOT NULL DEFAULT '', receptor_razon_social TEXT NOT NULL DEFAULT '', receptor_cp TEXT NOT NULL DEFAULT '',
      receptor_regimen TEXT NOT NULL DEFAULT '', uso_cfdi TEXT NOT NULL DEFAULT '', receptor_correo TEXT NOT NULL DEFAULT '',
      -- importes en centavos (enteros); el IVA se calcula en el servidor
      metodo_pago TEXT CHECK(metodo_pago IS NULL OR metodo_pago IN ('PUE', 'PPD')),
      forma_pago TEXT,
      moneda TEXT NOT NULL DEFAULT 'MXN',
      subtotal_cent INTEGER NOT NULL DEFAULT 0 CHECK(typeof(subtotal_cent) = 'integer' AND subtotal_cent >= 0),
      iva_cent INTEGER NOT NULL DEFAULT 0 CHECK(typeof(iva_cent) = 'integer' AND iva_cent >= 0),
      total_cent INTEGER NOT NULL DEFAULT 0 CHECK(typeof(total_cent) = 'integer' AND total_cent >= 0),
      -- lo que devuelve factura.com
      serie TEXT, folio TEXT, cfdi_uid TEXT, uuid TEXT,
      fecha_timbrado TEXT,
      xml TEXT,           -- el XML timbrado, en la base (la copia diaria lo respalda)
      pdf_path TEXT,      -- ruta del PDF en el disco del servidor (se puede volver a bajar de factura.com)
      error_json TEXT,    -- último error (sin llaves ni datos sensibles)
      -- cancelación
      motivo_cancelacion TEXT CHECK(motivo_cancelacion IS NULL OR motivo_cancelacion IN ('01', '02', '03', '04')),
      folio_sustituto TEXT,
      cancelacion_solicitada_at TEXT, cancelada_at TEXT, acuse TEXT,
      creado_por INTEGER REFERENCES usuarios(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_facturas_cfdi_uid ON facturas(cfdi_uid) WHERE cfdi_uid IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_facturas_uuid ON facturas(uuid) WHERE uuid IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_facturas_num_order ON facturas(num_order);
    CREATE INDEX IF NOT EXISTS idx_facturas_lead ON facturas(lead_id);
    CREATE INDEX IF NOT EXISTS idx_facturas_estatus ON facturas(estatus);
    CREATE INDEX IF NOT EXISTS idx_facturas_sucursal ON facturas(sucursal_id); -- mismo nombre que crea sucursales.js: así el esquema no cambia entre arranques

    -- Bitácora de lo que se le pidió a factura.com y qué contestó. SIN llaves, SIN el cuerpo completo: solo lo necesario para investigar.
    CREATE TABLE IF NOT EXISTS facturas_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      factura_id INTEGER REFERENCES facturas(id) ON DELETE RESTRICT,
      lead_id INTEGER REFERENCES leads(id) ON DELETE RESTRICT,
      accion TEXT NOT NULL CHECK(length(accion) BETWEEN 1 AND 40),
      resultado TEXT NOT NULL CHECK(resultado IN ('ok', 'error')),
      http_status INTEGER,
      mensaje TEXT CHECK(mensaje IS NULL OR length(mensaje) <= 2000),
      usuario_id INTEGER REFERENCES usuarios(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_facturas_log_factura ON facturas_log(factura_id);
    CREATE INDEX IF NOT EXISTS idx_facturas_log_lead ON facturas_log(lead_id);

    -- Factura global (público en general): enlaza UNA factura con VARIAS órdenes. Se usa desde la F6.
    CREATE TABLE IF NOT EXISTS factura_ventas (
      factura_id INTEGER NOT NULL REFERENCES facturas(id) ON DELETE RESTRICT,
      lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
      importe_cent INTEGER NOT NULL CHECK(typeof(importe_cent) = 'integer' AND importe_cent >= 0),
      PRIMARY KEY (factura_id, lead_id)
    );
    CREATE INDEX IF NOT EXISTS idx_factura_ventas_lead ON factura_ventas(lead_id);

    -- Complemento de pago (facturas PPD): cada cobro aplicado a una factura, con su parcialidad y saldos. Se usa desde la F6.
    CREATE TABLE IF NOT EXISTS factura_cobros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      factura_id INTEGER NOT NULL REFERENCES facturas(id) ON DELETE RESTRICT,   -- la factura de ingreso que se paga
      cobro_id INTEGER NOT NULL REFERENCES cobros(id) ON DELETE RESTRICT,
      complemento_id INTEGER REFERENCES facturas(id) ON DELETE RESTRICT,        -- el CFDI de pago que lo ampara (NULL: aún sin timbrar)
      num_parcialidad INTEGER NOT NULL CHECK(num_parcialidad >= 1),
      saldo_anterior_cent INTEGER NOT NULL CHECK(saldo_anterior_cent >= 0),
      importe_pagado_cent INTEGER NOT NULL CHECK(importe_pagado_cent > 0),
      saldo_insoluto_cent INTEGER NOT NULL CHECK(saldo_insoluto_cent >= 0),
      UNIQUE(cobro_id, factura_id)
    );
    CREATE INDEX IF NOT EXISTS idx_factura_cobros_factura ON factura_cobros(factura_id);

    -- Serie de factura.com de cada sucursal (una por tipo de documento; la serie debe ser del tipo del documento).
    CREATE TABLE IF NOT EXISTS series_factura (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sucursal_id INTEGER NOT NULL REFERENCES sucursales(id) ON DELETE RESTRICT,
      tipo_documento TEXT NOT NULL CHECK(tipo_documento IN (${lista(TIPOS_DOCUMENTO)})),
      serie TEXT NOT NULL CHECK(length(trim(serie)) BETWEEN 1 AND 25),
      serie_uid TEXT, -- el identificador de la serie en factura.com
      activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(sucursal_id, tipo_documento)
    );

    -- Copia de los catálogos OFICIALES que da factura.com (régimen, uso de CFDI con sus regímenes compatibles, forma de pago,
    -- clave de unidad…). Se llena desde la API (F2); no se escribe a mano para no inventar claves.
    CREATE TABLE IF NOT EXISTS sat_catalogos (
      catalogo TEXT NOT NULL,
      clave TEXT NOT NULL,
      nombre TEXT NOT NULL DEFAULT '',
      extra TEXT, -- JSON con lo demás que traiga el catálogo (p. ej. los regímenes compatibles de un uso de CFDI)
      actualizado_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (catalogo, clave)
    );
  `);

  // Catálogo de servicios: las claves del SAT de cada servicio. Vacías hasta que se capturen (nunca se inventan ni se hardcodean).
  agregar('catalogo_servicios', 'clave_prod_serv', "TEXT");
  agregar('catalogo_servicios', 'clave_unidad', "TEXT");
  agregar('catalogo_servicios', 'nombre_unidad', "TEXT");
  agregar('catalogo_servicios', 'objeto_imp', "TEXT NOT NULL DEFAULT '02' CHECK(objeto_imp IN ('01', '02', '03', '04'))");
  agregar('catalogo_servicios', 'tasa_iva', 'INTEGER NOT NULL DEFAULT 16 CHECK(tasa_iva BETWEEN 0 AND 100)');
  // Sucursales: el código postal de expedición (LugarExpedicion). Vacío: se usa EMISOR_CP del .env.
  // F3 (2026-10-27): el entorno de cada factura, y el entorno del UID del cliente y de la serie (un UID o una serie de sandbox no existen en producción).
  agregar('facturas', 'entorno', `TEXT NOT NULL DEFAULT 'sandbox' CHECK(entorno IN (${lista(ENTORNOS)}))`);
  agregar('facturas', 'conceptos_json', 'TEXT'); // los renglones tal como se mandaron a timbrar (para revisar y para sustituir)
  agregar('facturas', 'enviar_correo', 'INTEGER NOT NULL DEFAULT 0 CHECK(enviar_correo IN (0, 1))');
  agregar('clientes_fiscales', 'uid_entorno', `TEXT CHECK(uid_entorno IS NULL OR uid_entorno IN (${lista(ENTORNOS)}))`);
  db.exec("UPDATE clientes_fiscales SET uid_entorno = 'sandbox' WHERE uid_facturacom IS NOT NULL AND uid_entorno IS NULL"); // hasta hoy solo se ha conectado sandbox
  agregar('series_factura', 'entorno', `TEXT NOT NULL DEFAULT 'sandbox' CHECK(entorno IN (${lista(ENTORNOS)}))`);
  // Una sola factura vigente por orden EN CADA ENTORNO (las canceladas no cuentan: así se puede cancelar y sustituir). La de la F1 no distinguía el
  // entorno: una de prueba habría bloqueado la real. Es un índice (no datos): se reemplaza sin tocar ninguna fila.
  db.exec('DROP INDEX IF EXISTS idx_facturas_vigente_por_orden');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_facturas_vigente_por_orden_entorno ON facturas(lead_id, entorno)
    WHERE lead_id IS NOT NULL AND tipo_documento = 'factura' AND estatus IN (${lista(ESTATUS_VIGENTES)})`);
  agregar('sucursales', 'cp_expedicion', "TEXT CHECK(cp_expedicion IS NULL OR (length(cp_expedicion) = 5 AND cp_expedicion NOT GLOB '*[^0-9]*'))");
}

module.exports = crearTablasFacturacion;
module.exports.ESTATUS = ESTATUS;
module.exports.ESTATUS_VIGENTES = ESTATUS_VIGENTES;
module.exports.TIPOS_DOCUMENTO = TIPOS_DOCUMENTO;
module.exports.ENTORNOS = ENTORNOS;
