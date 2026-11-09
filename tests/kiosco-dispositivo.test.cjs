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

const codigoRostro = tramo('  // Apertura del ojo', '  // Mientras se toma la cara:');
const abiertos = [.29, .26], cerrados = [.20, .17];
function cuadro(ojos = abiertos, giro = 0, x = 0) {
  const positions = Array.from({ length: 68 }, () => ({ x: 0, y: 0 }));
  positions[16] = { x: 100, y: 0 };
  positions[30] = { x: 50 + giro * 100, y: 0 };
  ojos.forEach((ojo, i) => {
    const alto = ojo * 20;
    positions.splice(36 + i * 6, 6, ...[[0, 0], [5, alto / 2], [15, alto / 2], [20, 0], [15, -alto / 2], [5, -alto / 2]]
      .map(([x, y]) => ({ x, y })));
  });
  return { landmarks: { positions }, detection: { box: { x, y: 0, width: 100, height: 100 } } };
}
async function rostro(cuadros, opciones = {}) {
  let reloj = 1000, indice = 0;
  const video = { currentTime: 0, videoWidth: 640 }, avisos = [], procesados = [];
  const detector = {
    TinyFaceDetectorOptions: class {},
    detectSingleFace() {
      const frame = cuadros[indice++] ?? null;
      reloj += 175;
      video.currentTime += .175;
      return { withFaceLandmarks() {
        return {
          then(resolve) { procesados.push('ojos'); resolve(frame); },
          async withFaceDescriptor() {
            procesados.push('descriptor');
            return frame && { ...frame, descriptor: [1] };
          }
        };
      } };
    }
  };
  const ctx = vm.createContext({
    cargarFaceApi: async () => detector, $: () => video, camaraLista: true,
    Date: { now: () => reloj },
    setTimeout(fn, ms) { reloj += ms; fn(); }
  });
  ctx.opciones = { ms: 5000, aviso: msg => avisos.push(msg), ...opciones };
  const captura = await vm.runInContext(codigoRostro + '\ncapturarCara(opciones)', ctx);
  return { captura, avisos, procesados };
}
test('detecta el cierre breve de ambos ojos y la reapertura sin calcular descriptores durante el reto', async () => {
  const r = await rostro([cuadro(cerrados), cuadro(), cuadro(), cuadro(), cuadro(), cuadro(cerrados), cuadro()]);
  assert.equal(r.captura.vivo, true);
  assert.equal(r.captura.descriptores.length, 1);
  assert.deepEqual(r.procesados, ['ojos', 'ojos', 'ojos', 'ojos', 'descriptor', 'ojos', 'ojos']);
  assert.ok(r.avisos.some(msg => msg.includes('Cierre detectado')));
  assert.equal(r.avisos.at(-1), 'Listo');
});
test('exige ambos ojos y reapertura, y descarta el gesto al perder el seguimiento', async () => {
  const inicio = Array.from({ length: 4 }, () => cuadro());
  for (const secuencia of [
    [cuadro(), cuadro()],
    [cuadro([.20, .26]), cuadro()],
    Array.from({ length: 25 }, () => cuadro(cerrados)),
    [cuadro(cerrados), null, null, cuadro(), cuadro(), cuadro(), cuadro()],
    [cuadro(cerrados), cuadro(abiertos, 0, 80)]
  ]) {
    assert.equal((await rostro([...inicio, ...secuencia])).captura.vivo, false);
  }
});
test('también acepta girar la cabeza y volver al centro', async () => {
  const r = await rostro([...Array.from({ length: 4 }, () => cuadro()), cuadro(abiertos, .15), cuadro()]);
  assert.equal(r.captura.vivo, true);
  assert.ok(r.avisos.some(msg => msg.includes('Giro detectado')));
});
test('el alta reúne tres muestras frontales con ojos abiertos sin pedir un gesto', async () => {
  const r = await rostro([...Array.from({ length: 3 }, () => cuadro()), cuadro(cerrados), cuadro(),
    cuadro(), cuadro(), cuadro(), cuadro(abiertos, .2), ...Array.from({ length: 5 }, () => cuadro())], { muestras: 3, vida: false });
  assert.equal(r.captura.descriptores.length, 3);
  assert.equal(r.procesados.filter(p => p === 'descriptor').length, 5);
  assert.ok(r.avisos.some(msg => msg.includes('2 de 3 muestras')));
  assert.equal(r.avisos.at(-1), 'Listo');
});
test('cancelar detiene la captura en curso', async () => {
  let sigue = true;
  const r = await rostro([cuadro(), cuadro(), cuadro(), cuadro()], { sigue: () => sigue, aviso: () => { sigue = false; } });
  assert.deepEqual(r.procesados, ['ojos']);
  assert.equal(r.captura.descriptores.length, 0);
});
