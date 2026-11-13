// «Listas desplegables» (2026-11-13): TODAS las listas de las pantallas deben estar en el inventario
// (server/listas-inventario.js), cada una en un solo renglón, y las editables deben existir en server/listas.js.
// Si alguien agrega un <select> nuevo y no lo anota, esta prueba falla y dice cuál.
const test = require('node:test'), assert = require('node:assert');
const { escanear } = require('../server/listas-escaneo');
const { GRUPOS, INVENTARIO } = require('../server/listas-inventario');

test('cada lista desplegable de las pantallas está en el inventario', () => {
  const anotadas = new Map();
  for (const e of INVENTARIO) for (const k of [...e.selects, ...(e.filtros || [])]) {
    assert.ok(!anotadas.has(k), `«${k}» está en dos renglones del inventario: ${anotadas.get(k)} y ${e.nombre}`);
    anotadas.set(k, e.nombre);
  }
  const vistas = escanear();
  const faltan = vistas.filter(x => !anotadas.has(x.clave)).map(x => `${x.archivo}:${x.linea} (${x.clave})`);
  assert.deepStrictEqual(faltan, [], 'Listas sin anotar en server/listas-inventario.js');
  const claves = new Set(vistas.map(x => x.clave));
  assert.deepStrictEqual([...anotadas.keys()].filter(k => !claves.has(k)), [], 'Listas anotadas que ya no existen en las pantallas');
});

test('cada renglón tiene grupo válido y su explicación', () => {
  for (const e of INVENTARIO) {
    assert.ok(GRUPOS[e.grupo], e.nombre + ': grupo desconocido ' + e.grupo);
    assert.ok(e.aparece, e.nombre + ': falta dónde aparece');
    if (e.grupo === 'fija' || e.grupo === 'sat') assert.ok(e.porque, e.nombre + ': falta por qué no se edita');
    if (e.grupo === 'catalogo' || e.grupo === 'registros') assert.ok(e.donde, e.nombre + ': falta dónde se edita');
    if (e.grupo === 'editable') assert.ok(e.lista, e.nombre + ': falta la clave de la lista editable');
  }
});

test('las listas editables del inventario existen en server/listas.js y viceversa', () => {
  const fuente = require('fs').readFileSync(require('path').join(__dirname, '..', 'server', 'listas.js'), 'utf8');
  const enMotor = [...fuente.matchAll(/\{ clave: '([a-z_]+)', nombre: /g)].map(m => m[1]).sort();
  const enInventario = INVENTARIO.filter(e => e.lista).map(e => e.lista).sort();
  assert.deepStrictEqual(enInventario, enMotor);
});
