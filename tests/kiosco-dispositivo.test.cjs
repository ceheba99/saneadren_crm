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
  return { $, contexto, evento: (k, e) => (eventos[k] || []).forEach(fn => fn(e)) };
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
  e.evento('click');e.evento('keydown');assert.equal(e.creados(), 1);assert.equal(e.reanudados(), 1);
  e.contexto.sonidos.sonar('ok');assert.deepEqual(e.notas.map(n => n.frequency.value), [660, 880]);
});
test('confirmación, guardado sin conexión y error tienen sonidos diferentes', () => {
  const e = audio();e.evento('click');
  for (const tipo of ['ok', 'guardada', 'error']) e.contexto.sonidos.sonar(tipo);
  assert.deepEqual(e.notas.map(n => n.frequency.value), [660, 880, 520, 520, 240, 180]);
});
test('silenciar se conserva y no genera notas hasta volver a activarlo', () => {
  const e = audio('no');e.evento('click');assert.equal(e.creados(), 0);
  assert.equal(e.$('sonido').attrs['aria-pressed'], 'false');
  e.$('sonido').onclick();e.contexto.sonidos.sonar('ok');assert.equal(e.notas.length, 2);
  e.$('sonido').onclick();e.contexto.sonidos.sonar('error');assert.equal(e.notas.length, 2);
  assert.deepEqual(e.guardados.at(-1), ['saneadren_kiosco_sonido', 'no']);
});
test('un navegador sin audio y un fallo al generar tonos no interrumpen la checada', () => {
  const e = entorno();vm.runInContext(codigoSonido+'\nglobalThis.sonidos=Sonidos;',e.contexto);
  assert.doesNotThrow(() => {e.evento('click');e.contexto.sonidos.sonar('ok');});
  assert.equal(e.$('sonido').textContent, 'Sonido no disponible');
  const f = audio();f.evento('click');f.contexto.window.AudioContext.prototype.createOscillator = () => {throw Error('audio');};
  assert.doesNotThrow(() => f.contexto.sonidos.sonar('error'));
});

test('el teclado táctil y físico confirman los dígitos y solo suenan al borrar si había datos', () => {
  const e = audio();
  let botones;
  Object.assign(e.contexto, {
    estado: {}, reiniciarEspera() {}, pintar() {},
    el(tag, props, ...children) { if (props.className === 'teclado') botones = children; return props; },
    setTimeout() {}
  });
  e.$('pantalla').classList.add = () => {};
  vm.runInContext(tramo('  // ---------- Teclado numérico', '  // ---------- Flujo') +
    "\nteclado('Código', '', false, () => {});", e.contexto);
  const pulsar = texto => botones.find(boton => boton.textContent === texto).onclick();
  e.evento('click');
  pulsar('⌫');
  pulsar('1');
  e.evento('keydown', { key: '9' });
  e.evento('keydown', { key: 'Backspace' });
  pulsar('Borrar todo');
  pulsar('Borrar todo');
  e.$('sonido').onclick();
  pulsar('2');
  assert.deepEqual(e.notas.map(n => n.frequency.value), [540, 540, 390, 390]);
});

test('la primera tecla suena aunque Android tarde en reanudar el audio', async () => {
  const e = audio();
  let arrancar;
  e.contexto.window.AudioContext.prototype.resume = function () {
    return new Promise(resolve => { arrancar = () => { this.state = 'running'; resolve(); }; });
  };
  e.evento('click');
  e.contexto.sonidos.sonar('tecla');
  assert.equal(e.notas.length, 0);
  arrancar();
  await esperar();
  assert.deepEqual(e.notas.map(n => n.frequency.value), [540]);
});

const codigoRostro = tramo('  // ---------- Captura de la cara', '  // Mientras se toma la cara:');
// Un cuadro: dónde está la cara, cuánto está volteada y qué dice el modelo de vida (≥ 0 real, < 0 foto/pantalla).
function cuadro(vida = 2, { giro = 0, x = 0, ancho = 100 } = {}) {
  const positions = Array.from({ length: 68 }, () => ({ x: 0, y: 0 }));
  positions[16] = { x: 100, y: 0 };
  positions[30] = { x: 50 + giro * 100, y: 0 };
  return { landmarks: { positions }, detection: { box: { x, y: 0, width: ancho, height: ancho } }, vida };
}
async function rostro(cuadros, opciones = {}) {
  let reloj = 1000, indice = 0, actual = null;
  const video = { currentTime: 0, videoWidth: 640 }, avisos = [], procesados = [];
  const detector = {
    TinyFaceDetectorOptions: class {},
    detectSingleFace(imagen) {
      assert.equal(imagen, 'lienzo'); // se busca la cara en la misma imagen que revisa la prueba de vida
      const frame = cuadros[indice++] ?? null;
      actual = frame;
      reloj += 175;
      video.currentTime += .175;
      return { withFaceLandmarks() {
        return {
          then(resolve) { procesados.push('cara'); resolve(frame); },
          async withFaceDescriptor() { procesados.push('descriptor'); return frame && { ...frame, descriptor: [1] }; }
        };
      } };
    }
  };
  const ctx = vm.createContext({
    cargarFaceApi: async () => detector, cargarAntispoof: async () => opciones.sinModelo ? Promise.reject(new Error('sin modelo')) : 'modelo',
    cuadroDe: () => 'lienzo',
    vidaDe: async (modelo, imagen, caja) => { assert.equal(modelo, 'modelo'); assert.equal(caja, actual.detection.box); procesados.push('vida'); return actual.vida; },
    $: () => video, camaraLista: true,
    Date: { now: () => reloj },
    setTimeout(fn, ms) { reloj += ms; fn(); }
  });
  ctx.opciones = { ms: 10000, aviso: msg => avisos.push(msg), ...opciones };
  const captura = await vm.runInContext(codigoRostro + '\ncapturarCara(opciones)', ctx);
  return { captura, avisos, procesados };
}
test('una cara real pasa con 3 cuadros reales seguidos, sin gestos', async () => {
  const r = await rostro([cuadro(), cuadro(), cuadro()]);
  assert.equal(r.captura.vivo, true);
  assert.equal(r.captura.descriptores.length, 1);
  assert.deepEqual(r.procesados, ['descriptor', 'vida', 'cara', 'vida', 'cara', 'vida']);
  assert.equal(r.avisos.at(-1), 'Listo');
  assert.equal(r.captura.diag.reales, 3);
  assert.equal(r.captura.diag.seguidos, 3);
});
test('un cuadro dudoso rompe la racha, pero la persona real termina pasando', async () => {
  const r = await rostro([cuadro(1), cuadro(-.5), cuadro(.3), cuadro(2), cuadro(1.5)]);
  assert.equal(r.captura.vivo, true);
  assert.equal(r.captura.diag.evaluados, 5);
});
test('una foto o pantalla (el modelo dice «falso») no pasa y se deja de intentar a los 12 cuadros', async () => {
  const r = await rostro(Array.from({ length: 40 }, (_, i) => cuadro(i % 3 ? -3 : .4)));
  assert.equal(r.captura.vivo, false);
  assert.equal(r.captura.diag.evaluados, 12);
  assert.ok(r.captura.diag.seguidos < 3);
  assert.ok(r.captura.diag.vida < 0);
  assert.equal(r.captura.descriptores.length, 1); // la cara sí se tomó: el servidor registra el intento como «parece foto»
});
test('de lado o muy lejos no se revisa ni se toma la muestra; avisa qué corregir', async () => {
  const r = await rostro([cuadro(2, { giro: .2 }), cuadro(2, { ancho: 60 }), cuadro(), cuadro(), cuadro()]);
  assert.equal(r.captura.vivo, true);
  assert.equal(r.procesados.filter(p => p === 'vida').length, 3);
  assert.ok(r.avisos.includes('Mira de frente a la cámara'));
  assert.ok(r.avisos.includes('Acércate un poco a la cámara'));
  assert.equal(r.captura.diag.chica, true);
});
test('si aparece otra cara en otro lugar, se empieza de nuevo (no se mezclan caras)', async () => {
  const r = await rostro([cuadro(), cuadro(), cuadro(2, { x: 200 }), cuadro(2, { x: 200 })]);
  assert.equal(r.captura.vivo, false);
});
test('perder la cara un momento no borra la racha; tras ~2 s sin cara se empieza de nuevo', async () => {
  assert.equal((await rostro([cuadro(), cuadro(), null, null, cuadro()])).captura.vivo, true);
  const r = await rostro([cuadro(), cuadro(), ...Array(12).fill(null), cuadro()]);
  assert.equal(r.captura.vivo, false);
  assert.ok(r.avisos.some(msg => msg.includes('No te vemos')));
});
test('sin cara en todo el tiempo: no hay muestra ni vida', async () => {
  const r = await rostro([]);
  assert.equal(r.captura.vivo, false);
  assert.equal(r.captura.vistas, 0);
  assert.equal(r.captura.descriptores.length, 0);
});
test('si no carga la prueba de vida, falla la captura (el kiosco pide el PIN)', async () => {
  await assert.rejects(rostro([cuadro()], { sinModelo: true }));
});
test('el alta reúne tres muestras frontales sin prueba de vida', async () => {
  const r = await rostro([cuadro(), cuadro(), cuadro(2, { giro: .2 }), ...Array.from({ length: 9 }, () => cuadro())], { muestras: 3, vida: false });
  assert.equal(r.captura.descriptores.length, 3);
  assert.equal(r.procesados.filter(p => p === 'vida').length, 0);
  assert.ok(r.avisos.some(msg => msg.includes('2 de 3 muestras')));
  assert.equal(r.avisos.at(-1), 'Listo');
});
test('cancelar detiene la captura en curso', async () => {
  let sigue = true;
  const r = await rostro([cuadro(), cuadro(), cuadro(), cuadro()], { sigue: () => sigue, aviso: () => { sigue = false; } });
  assert.deepEqual(r.procesados, ['descriptor', 'vida']);
  assert.equal(r.captura.vivo, false);
});
// El recorte para el modelo: igual que el del autor (cuadrado de 1.5 veces, borde reflejado, 128×128, RGB, CHW, /255).
const codigoVida = tramo('  // Igual que el preprocesado del modelo', '  // ---------- Captura de la cara');
test('el recorte de la prueba de vida respeta el preprocesado del modelo', async () => {
  const W = 40, H = 30, px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; px[i] = x; px[i + 1] = y; px[i + 2] = 200; px[i + 3] = 255; }
  let entrada;
  const ort = { Tensor: class { constructor(t, d, forma) { entrada = { t, d, forma }; } } };
  const sesion = { inputNames: ['input'], outputNames: ['logits'], run: async e => { assert.ok(e.input); return { logits: { data: [1.5, -.5] } }; } };
  const lienzo = { width: W, height: H, getContext: () => ({ getImageData: () => ({ data: px }) }) };
  const ctx = vm.createContext({ Float32Array, Math });
  vm.runInContext(codigoVida + '\nglobalThis.vidaDe = vidaDe; globalThis.reflejo = reflejo;', ctx);
  // Cara de 20×20 en el centro: recorte de 30 px, se sale 0 px a los lados en x (5..35) y 0 en y (0..30).
  const d = await ctx.vidaDe({ ort, sesion }, lienzo, { x: 10, y: 5, width: 20, height: 20 });
  assert.equal(d, 2);
  assert.equal(JSON.stringify(entrada.forma), '[1,3,128,128]');
  assert.equal(entrada.t, 'float32');
  const N = 128 * 128, en = (c, y, x) => entrada.d[c * N + y * 128 + x];
  assert.ok(Math.abs(en(0, 0, 0) - 5 / 255) < 1e-6, 'rojo = x del primer píxel del recorte');
  assert.ok(Math.abs(en(1, 127, 0) - 29 / 255) < 1e-6, 'verde = y del último renglón');
  assert.ok(Math.abs(en(2, 64, 64) - 200 / 255) < 1e-6, 'azul');
  assert.equal([-1, -2, 0, 9, 10, 11].map(i => ctx.reflejo(i, 10)).join(), '1,2,0,9,8,7');
});
