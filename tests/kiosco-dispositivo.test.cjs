const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../public/kiosco.html'), 'utf8');
const tramo = (inicio, fin) => html.slice(html.indexOf(inicio), html.indexOf(fin));
const codigoBateria = tramo('  // ---------- Batería del dispositivo', '  // ---------- Sonidos de confirmación');
const codigoSonido = tramo('  // ---------- Sonidos de confirmación', '  // ---------- Reloj (referencia:');
function entorno(extra = {}) {
  const nodos = new Map(), eventos = {};
  const $ = id => {
    if (!nodos.has(id)) nodos.set(id, { textContent: '', hidden: true, dataset: {}, title: '', attrs: {}, clases: new Set(), valores: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      style: { setProperty(k, v) { $(id).valores[k] = v; } },
      classList: { toggle(k, v) { v ? $(id).clases.add(k) : $(id).clases.delete(k); } }
    });
    return nodos.get(id);
  };
  const contexto = vm.createContext({ $, navigator: {}, window: {}, localStorage: { getItem: () => null, setItem() {} },
    document: { visibilityState: 'visible', addEventListener(k, fn) { (eventos[k] ||= []).push(fn); } }, ...extra });
  return { $, contexto, evento: k => (eventos[k] || []).forEach(fn => fn()) };
}
const esperar = () => new Promise(resolve => setImmediate(resolve));
async function bateria(level, charging = false) {
  const eventos = {}, b = { level, charging, addEventListener: (k, fn) => { eventos[k] = fn; } };
  const e = entorno({ navigator: { getBattery: () => Promise.resolve(b) } });
  vm.runInContext(codigoBateria, e.contexto); await esperar();
  return { ...e, b, cambio: k => eventos[k]() };
}
test('muestra porcentaje real y reacciona a conectar y desconectar el cargador', async () => {
  const e = await bateria(.78);
  assert.equal(e.$('bateria-texto').textContent, '78 %');
  e.b.charging = true; e.cambio('chargingchange');
  assert.equal(e.$('bateria-texto').textContent, '78 % · Cargando');
  assert.equal(e.$('bateria').dataset.estado, 'cargando');
  e.b.charging = false; e.cambio('chargingchange');
  assert.equal(e.$('bateria-texto').textContent, '78 %');
});
test('avisa al 20 %, distingue nivel crítico y retira el aviso al cargar', async () => {
  const e = await bateria(.20);
  assert.equal(e.$('bateria').dataset.estado, 'baja'); assert.equal(e.$('bateria-aviso').hidden, false);
  e.b.level = .10; e.cambio('levelchange');
  assert.equal(e.$('bateria').dataset.estado, 'critica');
  e.b.charging = true; e.cambio('chargingchange');
  assert.equal(e.$('bateria-aviso').hidden, true);
  e.b.level = 1; e.cambio('levelchange');
  assert.equal(e.$('bateria-texto').textContent, '100 % · Cargada');
});
test('refresca al volver a primer plano y representa cero sin inventar carga', async () => {
  const e = await bateria(.5); e.b.level = 0; e.evento('visibilitychange');
  assert.equal(e.$('bateria-texto').textContent, '0 %');
  assert.equal(e.$('bateria').dataset.estado, 'critica');
});
test('API ausente, permiso rechazado, error síncrono y valores inválidos no bloquean la app', async () => {
  for (const navigator of [{}, { getBattery() { throw Error('bloqueado'); } }, { getBattery: () => Promise.reject(Error('permiso')) }]) {
    const e = entorno({ navigator });vm.runInContext(codigoBateria, e.contexto);await esperar();
    assert.equal(e.$('bateria-texto').textContent, 'Batería no disponible');assert.equal(e.$('bateria-aviso').hidden, true);
  }
  for (const valor of [NaN, undefined, -1, 2]) {
    const e = await bateria(valor);assert.equal(e.$('bateria-texto').textContent, 'Batería no disponible');
  }
});
function audio(preferencia = null) {
  const notas = [];let creados = 0, reanudados = 0;
  class Audio {
    constructor() { this.state = 'suspended';this.currentTime = 0;creados++; }
    resume() { this.state = 'running';reanudados++;return Promise.resolve(); }
    suspend() { this.state = 'suspended';return Promise.resolve(); }
    createOscillator() { const n = { frequency: {}, connect() {}, disconnect() {}, start() {}, stop() {} };notas.push(n);return n; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },connect() {},disconnect() {} }; }
  }
  const guardados = [];
  const e = entorno({ window: { AudioContext: Audio }, localStorage: { getItem: () => preferencia, setItem: (...args) => guardados.push(args) } });
  vm.runInContext(codigoSonido + '\nglobalThis.sonidos = Sonidos;', e.contexto);
  return { ...e, notas, guardados, creados: () => creados, reanudados: () => reanudados };
}
test('no pide audio al abrir; el primer toque lo prepara y solo crea un contexto', () => {
  const e = audio();assert.equal(e.creados(), 0);
  e.contexto.sonidos.sonar('ok');assert.equal(e.notas.length, 0);
  e.evento('pointerdown');e.evento('keydown');assert.equal(e.creados(), 1);assert.equal(e.reanudados(), 1);
  e.contexto.sonidos.sonar('ok');assert.deepEqual(e.notas.map(n => n.frequency.value), [660, 880]);
});
test('confirmación, guardado sin conexión y error tienen sonidos diferentes', () => {
  const e = audio();e.evento('pointerdown');
  for (const tipo of ['ok', 'guardada', 'error']) e.contexto.sonidos.sonar(tipo);
  assert.deepEqual(e.notas.map(n => n.frequency.value), [660, 880, 520, 520, 240, 180]);
});
test('silenciar se conserva y no genera notas hasta volver a activarlo', () => {
  const e = audio('no');e.evento('pointerdown');assert.equal(e.creados(), 0);
  assert.equal(e.$('sonido').attrs['aria-pressed'], 'false');
  e.$('sonido').onclick();e.contexto.sonidos.sonar('ok');assert.equal(e.notas.length, 2);
  e.$('sonido').onclick();e.contexto.sonidos.sonar('error');assert.equal(e.notas.length, 2);
  assert.deepEqual(e.guardados.at(-1), ['saneadren_kiosco_sonido', 'no']);
});
test('un navegador sin audio y un fallo al generar tonos no interrumpen la checada', () => {
  const e = entorno();vm.runInContext(codigoSonido+'\nglobalThis.sonidos=Sonidos;',e.contexto);
  assert.doesNotThrow(() => {e.evento('pointerdown');e.contexto.sonidos.sonar('ok');});
  assert.equal(e.$('sonido').textContent, 'Sonido no disponible');
  const f = audio();f.evento('pointerdown');f.contexto.window.AudioContext.prototype.createOscillator = () => {throw Error('audio');};
  assert.doesNotThrow(() => f.contexto.sonidos.sonar('error'));
});
