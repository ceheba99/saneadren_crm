// AVISO «EL RELOJ CHECADOR NO RESPONDE» (2026-11-12, Dirección: «quiero el aviso, y que también me avise a mi correo»).
// La regla (server/kiosco-vigia.js): en horario de trabajo de la sucursal, más de 5 minutos sin señal del kiosco →
// un aviso (uno solo por caída) y otro cuando vuelve. Fuera de horario, en festivo o con la tableta guardada: nada.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { vigia, ventana, correosDe } = require('../server/kiosco-vigia');
const { ahoraMexico } = require('../server/fechas');

const MIN = 60000;
// Jueves 12-nov-2026 en hora de México (UTC−6).
const a = (hhmm, dia = 12) => Date.parse(`2026-11-${dia}T${hhmm}:00-06:00`);
function armar({ inicio = '09:00', kioscos = [{ id: 1, nombre: 'Entrada', sucursal: 'Querétaro', sucursal_id: 1 }], ventanaDe = () => ({ desde: '08:15', hasta: '18:30' }) } = {}) {
  let t = a(inicio); const avisos = [], estado = { kioscos };
  const v = vigia({ kioscos: () => estado.kioscos, ventanaDe, ahoraMexico, avisar: (tipo, k) => avisos.push([tipo, k]), ahora: () => t });
  // Pasa el tiempo minuto a minuto; «senal» dice si el kiosco sigue hablando.
  // Pasa el tiempo minuto a minuto; «senal» dice si el kiosco sigue hablando (true, o lo que reporta de sí mismo).
  const pasar = (min, senal = false) => { for (let i = 0; i < min; i++) { t += MIN; if (senal) { v.senal(1); if (typeof senal === 'object') v.reporte(1, senal); } v.revisar(); } };
  return { v, avisos, estado, pasar, ir: (hhmm, dia) => { t = a(hhmm, dia); } };
}

test('vigía: mientras el kiosco da señal cada minuto, no avisa', () => {
  const x = armar(); x.pasar(180, true);
  assert.deepEqual(x.avisos, []); assert.deepEqual(x.v.caidos(), []);
});
test('vigía: más de 5 minutos sin señal en horario de trabajo → UN aviso, con desde cuándo', () => {
  const x = armar(); x.pasar(10, true); x.pasar(5);
  assert.deepEqual(x.avisos, [], 'a los 5 minutos todavía no');
  x.pasar(1);
  assert.equal(x.avisos.length, 1); assert.equal(x.avisos[0][0], 'sin_respuesta');
  assert.deepEqual({ ...x.avisos[0][1] }, { id: 1, nombre: 'Entrada', sucursal: 'Querétaro', sucursal_id: 1, fecha: '2026-11-12', hora: '09:16', desde: 'las 09:10' });
  x.pasar(120);
  assert.equal(x.avisos.length, 1, 'no repite el aviso cada minuto'); assert.equal(x.v.caidos().length, 1, 'sigue en Inicio mientras no vuelva');
});
test('vigía: cuando vuelve a dar señal avisa «ya responde» y se quita de Inicio; si se cae otra vez, avisa otra vez', () => {
  const x = armar(); x.pasar(10, true); x.pasar(20); x.pasar(1, true);
  assert.deepEqual(x.avisos.map(y => y[0]), ['sin_respuesta', 'volvio']); assert.equal(x.avisos[1][1].volvio, '09:31'); assert.equal(x.avisos[1][1].desde, 'las 09:10');
  assert.deepEqual(x.v.caidos(), []);
  x.pasar(30, true); x.pasar(10);
  assert.deepEqual(x.avisos.map(y => y[0]), ['sin_respuesta', 'volvio', 'sin_respuesta']);
});
test('vigía: fuera del horario de trabajo no avisa; al empezar el día con la tableta apagada, sí', () => {
  const x = armar({ inicio: '18:00' }); x.pasar(25, true); // dio señal hasta las 18:25 y la apagaron
  x.ir('19:00'); x.pasar(60);
  assert.deepEqual(x.avisos, [], 'de noche no molesta');
  x.ir('08:10', 13); x.pasar(4); assert.deepEqual(x.avisos, [], 'al día siguiente, antes de las 8:15 todavía no');
  x.pasar(1);
  assert.equal(x.avisos.length, 1, 'a las 8:15 sigue apagada: avisa'); assert.equal(x.avisos[0][1].desde, 'el 12/11/2026 a las 18:25');
});
test('vigía: día sin horario o festivo (sin ventana) no se vigila', () => {
  const x = armar({ ventanaDe: () => null }); x.pasar(300);
  assert.deepEqual(x.avisos, []);
});
test('vigía: al reiniciar el sistema da 5 minutos antes de avisar (los reinicios por actualización no alarman)', () => {
  const x = armar(); x.pasar(5); assert.deepEqual(x.avisos, []);
  x.pasar(1); assert.equal(x.avisos.length, 1); assert.equal(x.avisos[0][1].desde, null, 'no sabe desde cuándo: no lo inventa');
  const y = armar(); y.pasar(3); y.pasar(60, true); assert.deepEqual(y.avisos, [], 'si la tableta sí estaba, no pasa nada');
});
test('vigía: un kiosco dado de baja o guardado deja de vigilarse y se quita de Inicio', () => {
  const x = armar(); x.pasar(10); assert.equal(x.v.caidos().length, 1);
  x.estado.kioscos = []; x.pasar(1);
  assert.deepEqual(x.v.caidos(), []); assert.equal(x.avisos.length, 1, 'sin correo de «ya responde» que no es cierto');
});
test('vigía: un error al avisar (correo caído) no detiene la vigilancia', () => {
  let t = a('09:00'); const v = vigia({ kioscos: () => [{ id: 1, nombre: 'E', sucursal_id: 1 }], ventanaDe: () => ({ desde: '00:00', hasta: '23:59' }), ahoraMexico, avisar: () => { throw new Error('sin correo'); }, ahora: () => t });
  t += 10 * MIN; assert.doesNotThrow(() => v.revisar()); assert.equal(v.caidos().length, 1);
  assert.doesNotThrow(() => v.senal(1)); assert.equal(v.caidos().length, 0);
});

test('horario de trabajo: de 15 min antes de la primera entrada a la última salida de los horarios activos de la sucursal', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE horarios (id INTEGER PRIMARY KEY, sucursal_id INTEGER, activo INTEGER DEFAULT 1);
    CREATE TABLE horario_versiones (id INTEGER PRIMARY KEY AUTOINCREMENT, horario_id INTEGER, desde TEXT, dias TEXT);
    CREATE TABLE dias_festivos (fecha TEXT, nombre TEXT, activo INTEGER DEFAULT 1);
    INSERT INTO horarios (id, sucursal_id, activo) VALUES (1, 1, 1), (2, 1, 1), (3, 1, 0), (4, 2, 1);
    INSERT INTO dias_festivos VALUES ('2026-11-16', 'Revolución', 1), ('2026-11-13', 'Quitado por RH', 0);`);
  const dias = (e, s, sabado) => JSON.stringify({ 1: { entrada: e, salida: s }, 2: { entrada: e, salida: s }, 3: { entrada: e, salida: s }, 4: { entrada: e, salida: s }, 5: { entrada: e, salida: s }, ...(sabado ? { 6: { entrada: e, salida: '14:00' } } : {}) });
  const ins = db.prepare('INSERT INTO horario_versiones (horario_id, desde, dias) VALUES (?, ?, ?)');
  ins.run(1, '2020-01-01', dias('08:30', '18:00')); ins.run(2, '2020-01-01', dias('08:30', '18:30', true));
  ins.run(2, '2026-12-01', dias('07:00', '18:30', true)); // cambio que todavía no empieza
  ins.run(3, '2020-01-01', dias('05:00', '23:00')); ins.run(4, '2020-01-01', dias('10:00', '15:00'));
  assert.deepEqual(ventana(db, 1, '2026-11-12'), { desde: '08:15', hasta: '18:30' }, 'jueves: administrativos y operaciones; el horario desactivado no cuenta');
  assert.deepEqual(ventana(db, 1, '2026-11-14'), { desde: '08:15', hasta: '14:00' }, 'sábado: solo operaciones');
  assert.equal(ventana(db, 1, '2026-11-15'), null, 'domingo: nadie trabaja');
  assert.equal(ventana(db, 1, '2026-11-16'), null, 'festivo');
  assert.deepEqual(ventana(db, 1, '2026-11-13'), { desde: '08:15', hasta: '18:30' }, 'un festivo que RH quitó se trabaja');
  assert.deepEqual(ventana(db, 1, '2026-12-02'), { desde: '06:45', hasta: '18:30' }, 'la versión nueva del horario, desde su fecha');
  assert.deepEqual(ventana(db, 2, '2026-11-12'), { desde: '09:45', hasta: '15:00' }, 'cada sucursal con sus horarios');
  assert.equal(ventana(db, 9, '2026-11-12'), null, 'sucursal sin horarios');
});
test('correos: Dirección más los de CORREO_AVISOS_CHECADOR, sin repetir y sin inválidos', () => {
  assert.deepEqual(correosDe(['Dir@saneadren.com.mx', null], ' persona@gmail.com, dir@saneadren.com.mx ; no-es-correo'), ['dir@saneadren.com.mx', 'persona@gmail.com']);
  assert.deepEqual(correosDe([], undefined), []);
});

// 2026-11-12 (blindaje): avisar ANTES de que falle.
test('atención: batería en 20 % o menos y sin cargador → un aviso; se quita al conectarla', () => {
  const x = armar(); x.pasar(10, { bateria: 45, cargando: false, camara: true });
  assert.deepEqual(x.avisos, []);
  x.pasar(3, { bateria: 20, cargando: false, camara: true });
  assert.deepEqual(x.avisos.map(y => [y[0], y[1].bateria, y[1].nombre]), [['bateria', 20, 'Entrada']]);
  x.pasar(30, { bateria: 12, cargando: false, camara: true });
  assert.equal(x.avisos.length, 1, 'un solo aviso'); assert.equal(x.v.atencion().length, 1, 'sigue en Inicio');
  x.pasar(1, { bateria: 12, cargando: true, camara: true });
  assert.deepEqual(x.v.atencion(), [], 'al conectarla se quita');
  x.pasar(5, { bateria: 15, cargando: false, camara: true });
  assert.equal(x.avisos.length, 2, 'si la vuelven a desconectar con poca pila, avisa otra vez');
});
test('atención: con cargador, sin lectura de batería o fuera de horario no avisa', () => {
  let x = armar(); x.pasar(30, { bateria: 5, cargando: true, camara: true }); assert.deepEqual(x.avisos, []);
  x = armar(); x.pasar(30, { bateria: null, cargando: null, camara: true }); assert.deepEqual(x.avisos, []);
  x = armar({ inicio: '20:00' }); x.pasar(30, { bateria: 10, cargando: false, camara: true }); assert.deepEqual(x.avisos, [], 'de noche no manda correo');
  x.ir('08:14', 13); x.pasar(2, { bateria: 9, cargando: false, camara: true });
  assert.deepEqual(x.avisos.map(y => y[0]), ['bateria'], 'pero al empezar el día sí');
});
test('atención: cámara fallando 3 minutos seguidos → un aviso; un tropiezo de un minuto no', () => {
  const x = armar(); x.pasar(2, { camara: false }); x.pasar(1, { camara: true }); x.pasar(2, { camara: false });
  assert.deepEqual(x.avisos, [], 'tropiezos sueltos no avisan');
  x.pasar(1, { camara: false });
  assert.deepEqual(x.avisos.map(y => y[0]), ['camara']);
  x.pasar(20, { camara: false }); assert.equal(x.avisos.length, 1);
  x.pasar(1, { camara: true }); assert.deepEqual(x.v.atencion(), []);
});
test('atención: si el kiosco además dejó de responder, manda ese aviso y no otro encima', () => {
  const x = armar(); x.pasar(5, { bateria: 25, cargando: false, camara: true }); x.pasar(10);
  assert.deepEqual(x.avisos.map(y => y[0]), ['sin_respuesta']);
});
