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
// La imagen simulada mide 640×480 y la cara, por omisión, está al centro.
function cuadro(vida = 2, { giro = 0, x = 270, y = 190, ancho = 100 } = {}) {
  const positions = Array.from({ length: 68 }, () => ({ x: 0, y: 0 }));
  positions[16] = { x: 100, y: 0 };
  positions[30] = { x: 50 + giro * 100, y: 0 };
  return { landmarks: { positions }, detection: { box: { x, y, width: ancho, height: ancho } }, vida };
}
const quieta = (n = 4, vida = 2, donde = {}) => Array.from({ length: n }, () => cuadro(vida, donde)); // los cuadros del acomodo
async function rostro(cuadros, opciones = {}) {
  let reloj = 1000, indice = 0, actual = null;
  const video = { currentTime: 0, videoWidth: 640, videoHeight: 480 }, avisos = [], procesados = [], etapas = [];
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
          async withFaceDescriptor() { procesados.push('descriptor'); return frame && { ...frame, descriptor: [indice] }; }
        };
      } };
    }
  };
  const { luz, ...resto } = opciones;
  const ctx = vm.createContext({
    cargarFaceApi: async () => detector, cargarAntispoof: async () => opciones.sinModelo ? Promise.reject(new Error('sin modelo')) : 'modelo',
    cuadroDe: () => 'lienzo', luzDe: () => (luz ? luz(reloj) : 120),
    vidaDe: async (modelo, imagen, caja) => { assert.equal(modelo, 'modelo'); assert.equal(caja, actual.detection.box); procesados.push('vida'); return actual.vida; },
    $: () => video, camaraLista: true,
    Date: { now: () => reloj },
    setTimeout(fn, ms) { reloj += ms; fn(); }
  });
  ctx.opciones = { aviso: msg => avisos.push(msg), etapa: (fase, avance) => etapas.push([fase, Math.round(avance * 100)]), ...resto };
  const captura = await vm.runInContext(codigoRostro + '\ncapturarCara(opciones)', ctx);
  return { captura, avisos, procesados, etapas, ctx };
}
test('no se toma nada hasta que la cara lleva 4 cuadros quieta y bien puesta; después, 3 cuadros reales seguidos', async () => {
  const r = await rostro([...quieta(), cuadro(), cuadro(), cuadro()]);
  assert.equal(r.captura.vivo, true);
  assert.equal(r.captura.preparado, true);
  assert.equal(r.captura.descriptores.length, 1);
  assert.deepEqual(r.procesados, ['cara', 'cara', 'cara', 'cara', 'descriptor', 'vida', 'cara', 'vida', 'cara', 'vida']);
  assert.equal(r.avisos.at(-1), 'Listo');
  assert.ok(r.avisos.includes('Muy bien, no te muevas…'));
  assert.equal(r.captura.diag.reales, 3);
  assert.equal(r.captura.diag.seguidos, 3);
  assert.equal(r.captura.diag.acomodo, .7);
  // La barra: primero el acomodo (25, 50, 75 %), luego la toma hasta 100 %.
  assert.deepEqual(r.etapas.slice(0, 5), [['acomodo', 0], ['acomodo', 25], ['acomodo', 50], ['acomodo', 75], ['toma', 0]]);
  assert.deepEqual(r.etapas.at(-1), ['toma', 100]);
});
test('quien todavía se está acomodando (se mueve) no gasta la toma: se le pide quedarse quieto y luego pasa', async () => {
  const moviendose = Array.from({ length: 10 }, (_, i) => cuadro(2, { x: 150 + i * 25 }));
  const r = await rostro([...moviendose, ...quieta(4, 2, { x: 375 }), ...quieta(3, 2, { x: 375 })]);
  assert.ok(r.avisos.includes('Quédate quieto un momento'));
  assert.equal(r.procesados.slice(0, 13).every(p => p === 'cara'), true); // mientras se mueve no hay muestra ni prueba de vida
  assert.equal(r.captura.vivo, true);
  assert.equal(r.captura.descriptores.length, 1);
});
test('si nunca se acomoda, termina sin muestra y sin haber «fallado» (preparado = false)', async () => {
  const r = await rostro(Array.from({ length: 60 }, (_, i) => cuadro(2, { x: 150 + (i % 2) * 60 })), { msAcomodo: 5000 });
  assert.equal(r.captura.preparado, false);
  assert.equal(r.captura.vivo, false);
  assert.equal(r.captura.descriptores.length, 0);
  assert.equal(r.captura.diag.evaluados, 0);
  assert.equal(r.procesados.includes('vida'), false);
});
test('un cuadro dudoso rompe la racha, pero la persona real termina pasando', async () => {
  const r = await rostro([...quieta(), cuadro(1), cuadro(-.5), cuadro(.3), cuadro(2), cuadro(1.5)]);
  assert.equal(r.captura.vivo, true);
  assert.equal(r.captura.diag.evaluados, 5);
});
test('una foto o pantalla (el modelo dice «falso») no pasa y se deja de intentar a los 12 cuadros', async () => {
  const r = await rostro([...quieta(), ...Array.from({ length: 40 }, (_, i) => cuadro(i % 3 ? -3 : .4))]);
  assert.equal(r.captura.vivo, false);
  assert.equal(r.captura.preparado, true);
  assert.equal(r.captura.diag.evaluados, 12);
  assert.ok(r.captura.diag.seguidos < 3);
  assert.ok(r.captura.diag.vida < 0);
  assert.equal(r.captura.descriptores.length, 1); // la cara sí se tomó: el servidor registra el intento como «parece foto»
});
test('de lado, lejos, muy cerca o fuera del centro: avisa qué corregir y no empieza la toma', async () => {
  const r = await rostro([cuadro(2, { giro: .2 }), cuadro(2, { ancho: 60 }), cuadro(2, { x: 20, ancho: 560 }), cuadro(2, { x: 10 }), cuadro(2, { y: 370 }), ...quieta(), ...quieta(3)]);
  assert.equal(r.captura.vivo, true);
  assert.equal(r.procesados.filter(p => p === 'vida').length, 3);
  for (const m of ['Mira de frente a la cámara', 'Acércate un poco a la cámara', 'Aléjate un poco de la cámara', 'Acomoda la tableta: tu cara debe quedar al centro']) assert.ok(r.avisos.includes(m), m);
  assert.equal(r.avisos.filter(m => m.startsWith('Acomoda la tableta')).length, 2);
  assert.equal(r.captura.diag.chica, true);
});
test('con poca luz se pide luz de frente; pasados unos segundos ya no detiene (por si el lugar es oscuro)', async () => {
  const r = await rostro([...quieta(60), ...quieta(3)], { luz: () => 20 });
  assert.ok(r.avisos.includes('Hay poca luz: busca luz de frente'));
  assert.equal(r.captura.diag.oscuro, true);
  assert.equal(r.captura.vivo, true);
  assert.ok(r.captura.diag.acomodo >= 8);
});
test('si en la toma aparece otra cara en otro lugar, se regresa al acomodo (no se mezclan caras) y puede pasar', async () => {
  const otra = { x: 400 };
  const r = await rostro([...quieta(), cuadro(), cuadro(), ...quieta(5, 2, otra), ...quieta(3, 2, otra)]);
  assert.equal(r.captura.diag.regresos, 1);
  assert.equal(r.captura.vivo, true);
  assert.equal(r.captura.descriptores.length, 1);
  assert.equal(r.captura.descriptores[0][0], 12); // la muestra es de la segunda cara, no de la primera
  const corta = await rostro([...quieta(), cuadro(), cuadro(), cuadro(2, otra), cuadro(2, otra)]);
  assert.equal(corta.captura.vivo, false);
});
test('perder la cara un momento no borra la racha; tras ~1 s sin cara se vuelve a acomodar (máximo 2 veces)', async () => {
  assert.equal((await rostro([...quieta(), cuadro(), cuadro(), null, null, cuadro()])).captura.vivo, true);
  const r = await rostro([...quieta(), cuadro(), cuadro(), ...Array(6).fill(null), cuadro()]);
  assert.equal(r.captura.vivo, false);
  assert.equal(r.captura.diag.regresos, 1);
  assert.ok(r.avisos.some(msg => msg.includes('No te vemos')));
  const tres = [...quieta(), cuadro(), ...Array(6).fill(null)];
  const fin = await rostro([...tres, ...tres, ...tres, ...quieta(), ...quieta(3)]);
  assert.equal(fin.captura.vivo, false);
  assert.equal(fin.captura.diag.regresos, 2);
});
test('en la toma, una imagen movida no se usa (ni muestra ni prueba de vida)', async () => {
  const r = await rostro([...quieta(), cuadro(), cuadro(2, { x: 290 }), cuadro(2, { x: 290 }), cuadro(2, { x: 290 })]);
  assert.ok(r.avisos.includes('No te muevas'));
  assert.equal(r.captura.diag.evaluados, 3); // 4 cuadros en la toma, pero el movido no se revisó
  assert.equal(r.captura.vivo, true); // y tampoco rompió la racha: 1, (movido), 2, 3
});
test('al checar se juntan 3 muestras de la misma toma (el servidor usa la que más se parece)', async () => {
  const r = await rostro([...quieta(), ...quieta(12)], { muestras: 3 });
  assert.equal(r.captura.vivo, true);
  assert.equal(r.captura.descriptores.length, 3);
});
test('sin cara en todo el tiempo: no hay muestra ni vida', async () => {
  const r = await rostro([]);
  assert.equal(r.captura.vivo, false);
  assert.equal(r.captura.preparado, false);
  assert.equal(r.captura.vistas, 0);
  assert.equal(r.captura.descriptores.length, 0);
  assert.ok(r.avisos.includes('Ponte frente a la cámara'));
  assert.ok(r.captura.diag.segundos >= 25); // esperó el tiempo completo del acomodo
});
test('si no carga la prueba de vida, falla la captura (el kiosco pide el PIN)', async () => {
  await assert.rejects(rostro([cuadro()], { sinModelo: true }));
});
test('el alta reúne cinco fotos espaciadas, de frente, sin prueba de vida', async () => {
  const r = await rostro([...quieta(), cuadro(), cuadro(), cuadro(2, { giro: .2 }), ...quieta(30)], { muestras: 5, vida: false, espacio: 700, ms: 30000, msAcomodo: 45000 });
  assert.equal(r.captura.descriptores.length, 5);
  assert.equal(r.procesados.filter(p => p === 'vida').length, 0);
  assert.ok(r.avisos.some(msg => msg.includes('foto 2 de 5')));
  assert.equal(r.avisos.at(-1), 'Listo');
  // Entre una foto y la siguiente pasan al menos 700 ms (4 cuadros de 175 ms): no son 5 copias del mismo instante.
  const tomas = r.procesados.map((p, i) => (p === 'descriptor' ? i : -1)).filter(i => i >= 0);
  assert.ok(tomas.slice(1).every((t, i) => t - tomas[i] >= 4), String(tomas));
});
test('del alta se quita la foto que no se parece a las demás, sin bajar de 3', async () => {
  const { ctx } = await rostro([]);
  const d = (a, b = 0) => [a, b, ...Array(126).fill(0)];
  const quitar = lista => JSON.parse(vm.runInContext('JSON.stringify(mejoresMuestras(' + JSON.stringify(lista) + ', 3))', ctx));
  assert.equal(quitar([d(0), d(.1), d(.05), d(.9), d(.02)]).length, 4); // la de 0.9 sale
  assert.equal(quitar([d(0), d(.1), d(.05), d(.9), d(.02)]).some(x => x[0] === .9), false);
  assert.equal(quitar([d(0), d(.1), d(.05), d(.2), d(.02)]).length, 5); // todas parecidas: se quedan
  assert.equal(quitar([d(0), d(.9), d(0, .9)]).length, 3); // nunca menos de 3: el servidor decide
});
test('cancelar detiene la captura en curso', async () => {
  let sigue = true, n = 0;
  const r = await rostro([...quieta(), cuadro(), cuadro(), cuadro()], { sigue: () => sigue, aviso: () => { if (++n === 5) sigue = false; } });
  assert.deepEqual(r.procesados, ['cara', 'cara', 'cara', 'cara', 'descriptor', 'vida']);
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
// 2026-11-11: el flujo de la cara da tiempo y deja intentar otra vez (Dirección: «toma desprevenida a la gente»).
test('la cara con calma: no se pregunta al servidor si la persona no llegó a acomodarse, y siempre hay «Intentar otra vez»', () => {
  const entrar = tramo('  async function caraPrimero(codigo)', '  // «rostro»: la última cara que se tomó');
  assert.ok(entrar.indexOf('!cap.preparado') > 0 && entrar.indexOf('!cap.preparado') < entrar.indexOf("api('rostro-entrar'"), 'primero se revisa que se haya acomodado');
  assert.match(entrar, /'Intentar otra vez', \(\) => caraPrimero\(codigo\)/);
  assert.match(entrar, /'Usar mi PIN'/);
  assert.match(entrar, /muestras: 3/);
  const alta = tramo('  function registrarCara()', '  // ---------- Teclado numérico');
  assert.match(alta, /'Estoy listo'/); // la toma del alta no empieza sola
  assert.match(alta, /muestras: MUESTRAS_ALTA, vida: false, ms, msAcomodo, espacio: 700/);
  assert.match(alta, /Tu código sigue sirviendo/);
  assert.match(html, /const TIEMPO_ACOMODO = 25000, TIEMPO_ROSTRO = 12000;/);
  // El temporizador de «regresar al inicio» nunca corta la toma a la mitad.
  assert.match(html, /const ESPERA_CARA = TIEMPO_ACOMODO \+ TIEMPO_ROSTRO \+ 2 \* REGRESO_MS \+ 15000;/);
});
