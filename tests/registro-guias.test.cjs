// Guías de los Logs (2026-11-13, pedido de Dirección: que el log se entienda solo, también para soporte sin
// contexto): cada renglón del reloj checador trae qué significa, causas probables, qué hacer y dónde está en el código.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { explicar, EVENTOS_CON_GUIA } = require('../server/registro-guias.js');
const fila = (evento, detalle) => ({ evento, detalle });

test('todos los eventos del reloj tienen guía completa', () => {
  for (const e of ['kiosco_recuperado', 'kiosco_velocidad', 'kiosco_sin_respuesta', 'kiosco_volvio', 'kiosco_atencion']) {
    assert.ok(EVENTOS_CON_GUIA.includes(e), e);
    const g = explicar(fila(e, 'Kiosco «Entrada» (Querétaro): algo'));
    assert.ok(g && g.que.length > 20 && g.causas.length && g.hacer.length && g.codigo.length, e);
    assert.ok(g.codigo.every(c => /^(server|public|android-checador)\//.test(c)), 'el código se cita por archivo: ' + g.codigo);
  }
});
test('un evento sin guía no inventa nada', () => { assert.equal(explicar(fila('entro', 'x')), null); assert.equal(explicar(null), null); });
test('velocidad: servidor lento → la lectura apunta al internet o al servidor, no a la tableta', () => {
  const g = explicar(fila('kiosco_velocidad', 'Kiosco «Entrada» (Querétaro): Velocidad (app, 8 nucleos, 4 GB): abrir 1.2 s; servidor 2400 ms; sin caras registradas; trabada 0.3 s (peor 0.2 s)'));
  assert.match(g.lectura.join(' '), /servidor tard[oó] 2400 ms/i); assert.match(g.lectura.join(' '), /internet/i);
  assert.doesNotMatch(g.lectura.join(' '), /saturada/);
});
test('velocidad: pantalla trabada → la lectura apunta a la tableta', () => {
  const g = explicar(fila('kiosco_velocidad', 'Kiosco «Entrada»: Velocidad (navegador, 4 nucleos, 2 GB): abrir 9.5 s; servidor 180 ms; cara 22.0 s; vida 9.1 s; trabada 14.2 s (peor 3.1 s)'));
  const t = g.lectura.join(' ');
  assert.match(t, /saturada|trab/i); assert.match(t, /9\.5 s/); assert.match(t, /reconocimiento facial/i); assert.match(t, /2 GB/);
});
test('velocidad: todo normal → lo dice', () => {
  const g = explicar(fila('kiosco_velocidad', 'Kiosco «Entrada»: Velocidad (app, 8 nucleos, 8 GB): abrir 0.8 s; servidor 140 ms; sin caras registradas; trabada 0.1 s (peor 0.1 s)'));
  assert.match(g.lectura.join(' '), /normal/i);
});
test('velocidad al checar: dice qué paso fue el lento', () => {
  const g = explicar(fila('kiosco_velocidad', 'Kiosco «Entrada»: Velocidad al checar: codigo a PIN 0.3 s; PIN a botones 4.2 s; registrar 0.5 s; trabada 0.4 s desde que abrio'));
  assert.match(g.lectura.join(' '), /PIN.*4\.2 s/);
});
test('se recuperó solo: distingue reinicio, pantalla vacía y que no inició', () => {
  const r = explicar(fila('kiosco_recuperado', 'Kiosco «Entrada»: Reinicio (abrieron la app). Última señal hace 12 min; estaba bloqueada u oculta; descartada'));
  assert.match(r.lectura.join(' '), /bloqueada|oculta/); assert.match(r.lectura.join(' '), /descart/i);
  assert.match(explicar(fila('kiosco_recuperado', 'Kiosco «Entrada»: pantalla vacía')).lectura.join(' '), /en blanco|vac[ií]a/i);
  assert.match(explicar(fila('kiosco_recuperado', 'Kiosco «Entrada»: no terminó de iniciar')).lectura.join(' '), /12 segundos|iniciar/i);
  assert.match(explicar(fila('kiosco_recuperado', 'Kiosco «Entrada»: error al iniciar: x is not defined')).lectura.join(' '), /error de programa/i);
});
test('necesita atención: batería, cámara y pantalla tienen pasos distintos', () => {
  assert.match(explicar(fila('kiosco_atencion', 'Kiosco «Entrada»: batería en 12 % y sin cargador: conéctala')).hacer.join(' '), /cargador/i);
  assert.match(explicar(fila('kiosco_atencion', 'Kiosco «Entrada»: la cámara no está funcionando')).hacer.join(' '), /cámara/i);
  assert.match(explicar(fila('kiosco_atencion', 'Kiosco «Entrada»: no puede mantener la pantalla encendida')).hacer.join(' '), /Pantalla activa|ahorro de energía/i);
});
