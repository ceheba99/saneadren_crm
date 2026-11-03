// Facturación · carga de clientes desde el CSV de factura.com (2026-11-03): pruebas SIN red y con un CSV inventado que trae las mismas mañas del real
// (comillas dobles, «:» al inicio, S.A. DE C.V., CP 000000, sin régimen, correo de relleno, RFC repetido con otro UID, RFC genérico). Revisa: lector de CSV,
// ligar por RFC / teléfono / nombre, lo dudoso, lo repetido, lo que se deja vacío, que NUNCA se cree un cliente del CRM y que lo capturado a mano no se pise.
// Uso: node --test tests/facturacion-importar-clientes.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../server/sqlite');
const crearTablas = require('../server/facturacion-db');
const { leerCsv, planear, aplicar, llave } = require('../server/facturacion-importar-clientes');

const ENC = 'UID,RFC,Razon_Social,Regimen,Calle,Numero_Exterior,Numero_Interior,Colonia,CP,Ciudad_Municipio,Estado,Pais,Nombre,Email,"Email 2","Email 3",Telefono';
const fila = (uid, rfc, razon, reg, cp, email, nombre = '', tel = '') => [uid, rfc, `"${razon.replace(/"/g, '""')}"`, reg, 'CALLE', '1', '', 'COL', cp, 'QUERETARO', 'QUERETARO', 'MEX', nombre, email, '', '', tel].join(',');
const CSV = ['﻿' + ENC,
  fila('U1', 'ACM101125MH6', '"ADMINISTRACION Y CONSULTORIA DE MANTENIMIENTO BESTAAN"', '626', '50265', 'miguel@bestaan.com.mx'), // ligada por RFC (el CRM ya lo tiene), comillas dobles
  fila('U2', 'HTI110209AB8', 'HIDRODINAMICA TECNICA INDUSTRIAL', '601', '52977', 'admon@saneadren.com.mx'), // correo de relleno; ligada por teléfono
  fila('U3', 'NEU080526GV2', ':Hotel Berilo S.A. DE C.V.', '', '000000', 'alejandro@neutratec.com', '', ''), // ligada por nombre (sin acentos ni régimen societario); sin régimen y CP malo
  fila('U4', 'AAB1208304C1', 'ABC ALIMENTOS BOTANAS Y CEREALES SAPI DE CV', '999', '76000', 'x@abc.com'), // régimen que no está en el catálogo; nombre parecido a dos clientes → dudosa
  fila('U5', 'ASF0505096B5', 'Acarreos San Fandila S de R.L.', '601', '54719', 'f@acarreos.com'), // sin cliente en el CRM
  fila('U6', 'ACO050701TJ2', 'ACSA CONTRATISTA S.A. DE C.V.', '601', '76135', 'a@acsa.com'),
  fila('U7', 'ACO050701TJ2', 'ACSA CONTRATISTA', '603', '76135', 'b@acsa.com'), // mismo RFC, otro UID
  fila('U8', 'XAXX010101000', 'PUBLICO EN GENERAL', '616', '76000', 'p@g.com'), // genérico
  fila('U9', 'RFC-MALO', 'ALGO', '601', '76000', 'z@z.com'), // RFC inválido
  fila('', 'ZZZ010101AB1', 'SIN UID', '601', '76000', 'z@z.com'),
  'U1,ACM101125MH6,"OTRA VEZ LO MISMO",601,CALLE,1,,COL,50265,Q,Q,MEX,,a@a.com,,,'].join('\r\n') + '\r\n'; // UID repetido

function base() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE usuarios (id INTEGER PRIMARY KEY, nombre TEXT); INSERT INTO usuarios VALUES (1, 'Dirección');
    CREATE TABLE clientes (id INTEGER PRIMARY KEY, telefono TEXT, telefono_normalizado TEXT UNIQUE, nombre TEXT, empresa_contacto TEXT, rfc TEXT);
    CREATE TABLE sucursales (id INTEGER PRIMARY KEY, nombre TEXT, clave TEXT, activo INTEGER DEFAULT 1);
    CREATE TABLE catalogo_servicios (id INTEGER PRIMARY KEY, nombre TEXT, activo INTEGER DEFAULT 1, orden INTEGER DEFAULT 0);
    CREATE TABLE leads (id INTEGER PRIMARY KEY);`);
  crearTablas(db);
  db.exec(`INSERT INTO sat_catalogos (catalogo, clave, nombre) VALUES ('RegimenFiscal', '601', 'x'), ('RegimenFiscal', '603', 'x'), ('RegimenFiscal', '626', 'x'), ('RegimenFiscal', '612', 'x');
    INSERT INTO clientes (id, telefono, telefono_normalizado, nombre, empresa_contacto, rfc) VALUES
      (1, '722 182 8324', '7221828324', 'Miguel', 'Bestaan', 'ACM101125MH6'),
      (2, '55 1111 2222', '5511112222', 'Ing. Hidro', 'Otra empresa', NULL),
      (3, '442 000 0003', '4420000003', 'Sra. Berilo', 'Hotel Bérilo', NULL),
      (4, '442 000 0004', '4420000004', 'Ana', 'Alimentos y Botanas del Bajío', NULL),
      (5, '442 000 0005', '4420000005', 'Beto', 'Cereales y Botanas del Centro', NULL),
      (6, '442 000 0006', '4420000006', 'Chuy', 'ACSA Contratista', NULL);`);
  return db;
}
const por = (p, rfc) => p.unidades.find(u => u.rfc === rfc);

test('Lector de CSV: BOM, comillas, comillas dobles, saltos de línea dentro de un campo y filas vacías', () => {
  const f = leerCsv('﻿A,B,C\r\n1,"dos, con coma","tres ""citado"""\r\n"cuatro\ncon salto",5,\r\n\r\n');
  assert.deepEqual(f, [['A', 'B', 'C'], ['1', 'dos, con coma', 'tres "citado"'], ['cuatro\ncon salto', '5', '']]);
});

test('Nombres: se comparan sin acentos, sin comillas ni «:» y sin régimen societario', () => {
  assert.equal(llave(':Hotel Bérilo S.A. DE C.V.'), 'HOTEL BERILO');
  assert.equal(llave('"ACSA CONTRATISTA"'), 'ACSA CONTRATISTA');
});

test('Plan: liga por RFC, teléfono y nombre; lo parecido es dudoso; lo que no existe va aparte; repetidos, genéricos e inválidos se señalan', () => {
  const db = base();
  // U2 (HIDRODINAMICA) se liga por el teléfono del contacto.
  const csv = CSV.replace('HIDRODINAMICA TECNICA INDUSTRIAL,601,CALLE,1,,COL,52977,QUERETARO,QUERETARO,MEX,,admon', 'HIDRODINAMICA TECNICA INDUSTRIAL,601,CALLE,1,,COL,52977,QUERETARO,QUERETARO,MEX,Ing,admon').replace(/(admon@saneadren.com.mx,,,)/, '$1' + '55 1111 2222');
  const p = planear(db, csv);
  assert.equal(p.error, undefined);
  assert.deepEqual([por(p, 'ACM101125MH6').tipo, por(p, 'ACM101125MH6').cliente.por, por(p, 'ACM101125MH6').cliente.id], ['auto', 'RFC', 1]);
  assert.deepEqual([por(p, 'HTI110209AB8').tipo, por(p, 'HTI110209AB8').cliente.por, por(p, 'HTI110209AB8').cliente.id], ['auto', 'teléfono', 2]);
  assert.deepEqual([por(p, 'NEU080526GV2').tipo, por(p, 'NEU080526GV2').cliente.por, por(p, 'NEU080526GV2').cliente.id], ['auto', 'nombre igual', 3], 'sin acentos ni S.A. DE C.V.');
  const abc = por(p, 'AAB1208304C1'); assert.equal(abc.tipo, 'dudoso'); assert.deepEqual(abc.candidatos.map(c => c.id).sort(), [4, 5]);
  assert.equal(por(p, 'ASF0505096B5').tipo, 'sin_cliente');
  const acsa = por(p, 'ACO050701TJ2'); assert.equal(acsa.repetido, true); assert.equal(acsa.filas.length, 2); assert.equal(acsa.cliente.id, 6);
  assert.equal(p.invalidos.length, 4);
  for (const m of [/RFC genérico/, /El RFC debe tener 12/, /Sin UID/, /UID repetido/]) assert.ok(p.invalidos.some(x => m.test(x.motivo)), String(m));
  assert.equal(p.resumen.filas, 11); assert.equal(p.resumen.repetidos, 1);
});

test('Lo que no se puede dar por bueno queda VACÍO y marcado; la razón social va limpia; el uso del CFDI no se inventa', () => {
  const p = planear(base(), CSV);
  const neu = por(p, 'NEU080526GV2').filas[0];
  assert.equal(neu.razon_social, 'HOTEL BERILO'); assert.equal(neu.regimen, ''); assert.equal(neu.cp, '');
  assert.deepEqual(neu.incompleto, ['sin régimen fiscal', 'CP fiscal no válido']);
  const hti = por(p, 'HTI110209AB8').filas[0]; assert.equal(hti.correo, ''); assert.match(hti.incompleto.join(), /correo genérico de Saneadren/);
  const abc = por(p, 'AAB1208304C1').filas[0]; assert.equal(abc.regimen, ''); assert.match(abc.incompleto.join(), /régimen 999 no válido/);
  const acm = por(p, 'ACM101125MH6').filas[0]; assert.equal(acm.razon_social, 'ADMINISTRACION Y CONSULTORIA DE MANTENIMIENTO BESTAAN'); assert.deepEqual(acm.incompleto, []);
});

test('Archivo que no es el de factura.com o vacío: error claro', () => {
  assert.match(planear(base(), 'A,B\n1,2\n').error, /faltan las columnas UID, RFC/);
  assert.match(planear(base(), '').error, /vacío/);
});

test('Aplicar: solo ligas seguras, nunca crea clientes del CRM, guarda el UID con su entorno y es repetible', () => {
  const db = base(), antes = db.prepare('SELECT COUNT(*) n FROM clientes').get().n;
  const r = aplicar(db, CSV, { entorno: 'prod' }, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM clientes').get().n, antes, 'ningún cliente nuevo en el CRM');
  assert.equal(r.guardados, 2, 'solo las que ligaron solas y no tienen duda: U1 (por RFC) y U3 (por nombre)');
  const filas = db.prepare('SELECT * FROM clientes_fiscales ORDER BY id').all();
  const acm = filas.find(f => f.rfc === 'ACM101125MH6');
  assert.deepEqual([acm.cliente_id, acm.uid_facturacom, acm.uid_entorno, acm.predeterminado, acm.uso_cfdi, acm.regimen, acm.cp], [1, 'U1', 'prod', 1, '', '626', '50265']);
  assert.ok(!filas.some(f => f.rfc === 'ASF0505096B5'), 'sin cliente en el CRM: no se carga');
  assert.ok(!filas.some(f => f.rfc === 'AAB1208304C1'), 'dudoso sin decisión: no se carga');
  assert.ok(!filas.some(f => f.rfc === 'ACO050701TJ2'), 'repetido sin elegir: no se carga');
  assert.ok(r.saltados.some(s => s.rfc === 'ACO050701TJ2' && /Falta elegir/.test(s.motivo)));
  const otra = aplicar(db, CSV, { entorno: 'prod' }, 1);
  assert.equal(otra.guardados, 0); assert.equal(db.prepare('SELECT COUNT(*) n FROM clientes_fiscales').get().n, filas.length, 'repetirlo no duplica');
});

test('Aplicar con decisiones: el dudoso se liga al que se elija; el repetido usa el UID elegido; un UID en uso o un cliente que no existe se saltan', () => {
  const db = base();
  const r = aplicar(db, CSV, { entorno: 'sandbox', ligas: { AAB1208304C1: 5, ASF0505096B5: 999 }, elegidos: { ACO050701TJ2: 'U7' } }, 1);
  const abc = db.prepare("SELECT * FROM clientes_fiscales WHERE rfc = 'AAB1208304C1'").get();
  assert.deepEqual([abc.cliente_id, abc.uid_entorno], [5, 'sandbox']);
  const acsa = db.prepare("SELECT * FROM clientes_fiscales WHERE rfc = 'ACO050701TJ2'").get();
  assert.deepEqual([acsa.uid_facturacom, acsa.regimen, acsa.correo], ['U7', '603', 'b@acsa.com'], 'se usó la fila del UID elegido');
  assert.ok(r.saltados.some(s => s.rfc === 'ASF0505096B5' && /ya no existe/.test(s.motivo)));
  // Un UID que ya está ligado a otros datos fiscales no se reutiliza.
  const db2 = base(); db2.exec("INSERT INTO clientes_fiscales (cliente_id, rfc, razon_social, uid_facturacom, uid_entorno) VALUES (2, 'BBB010101AB1', 'OTRO', 'U1', 'prod')");
  assert.ok(aplicar(db2, CSV, {}, 1).saltados.some(s => s.rfc === 'ACM101125MH6' && /ya está ligado/.test(s.motivo)));
});

test('Lo capturado a mano no se pisa: solo se completan los campos vacíos y el UID', () => {
  const db = base();
  db.exec("INSERT INTO clientes_fiscales (cliente_id, rfc, razon_social, cp, regimen, correo, predeterminado) VALUES (1, 'ACM101125MH6', 'RAZON CAPTURADA A MANO', '76000', '', '', 1)");
  const r = aplicar(db, CSV, { entorno: 'prod' }, 1);
  const f = db.prepare("SELECT * FROM clientes_fiscales WHERE rfc = 'ACM101125MH6'").get();
  assert.deepEqual([f.razon_social, f.cp, f.regimen, f.correo, f.uid_facturacom, f.uid_entorno], ['RAZON CAPTURADA A MANO', '76000', '626', 'miguel@bestaan.com.mx', 'U1', 'prod']);
  assert.equal(r.completados, 1); assert.equal(db.prepare("SELECT COUNT(*) n FROM clientes_fiscales WHERE rfc = 'ACM101125MH6'").get().n, 1);
});
