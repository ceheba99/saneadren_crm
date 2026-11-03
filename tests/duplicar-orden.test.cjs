// DUPLICAR UNA ORDEN DESDE SU FICHA (bug reportado por César, 2026-11-03): la ficha de la orden se abre en solo lectura y
// el candado esconde sus botones, entre ellos la barra «Guardar» y el editor de partidas que viven en la ficha. Al pulsar
// Duplicar, esa barra y ese editor se mueven a la ventana de la orden nueva… y llegaban escondidos: no había cómo guardar.
// Aquí se carga solo-lectura.js con un DOM mínimo y se revisa que, al llevarlos a la ventana nueva, se liberen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CAMPOS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON']);
class El {
  constructor(tagName, props = {}) { this.tagName = tagName; this.children = []; this.parentElement = null; this.dataset = {}; this.hidden = false; this.disabled = false; this.innerHTML = ''; this.cls = new Set(); Object.assign(this, props); }
  get classList() { const c = this.cls; return { toggle: (n, v) => (v ? c.add(n) : c.delete(n)), contains: n => c.has(n) }; }
  append(...h) { for (const x of h) { x.parentElement?.children.splice(x.parentElement.children.indexOf(x), 1); x.parentElement = this; this.children.push(x); } }
  prepend(x) { this.append(x); }
  after(x) { this.parentElement.append(x); }
  remove() { this.parentElement?.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
  todos() { return this.children.flatMap(h => [h, ...h.todos()]); }
  querySelectorAll(sel) { return sel === 'input, select, textarea, button' ? this.todos().filter(x => CAMPOS.has(x.tagName)) : []; }
  querySelector(sel) { return sel === '[data-sl-editar]' ? { set onclick(f) {} } : null; }
  matches() { return false; }
  setAttribute() {}
}

function cargar() {
  const ctx = { document: { createElement: t => new El(t.toUpperCase()), querySelector: () => null }, MutationObserver: class { observe() {} disconnect() {} }, escaparHtml: s => s };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'solo-lectura.js'), 'utf8') + '\nthis.SoloLectura = SoloLectura;', ctx);
  return ctx.SoloLectura;
}

test('duplicar desde la ficha en solo lectura: el botón Guardar y las partidas llegan usables a la orden nueva', () => {
  const SL = cargar();
  // Ficha de la orden: su zona de datos con la barra «Guardar» y el editor de partidas dentro.
  const zona = new El('DIV'), barra = new El('DIV'), editor = new El('DIV');
  const guardar = new El('BUTTON'), descargar = new El('BUTTON'), convertir = new El('BUTTON', { hidden: true });
  const servicio = new El('SELECT'), precio = new El('INPUT'), agregar = new El('BUTTON');
  barra.append(guardar, descargar, convertir); editor.append(servicio, precio, agregar); zona.append(editor, barra);

  SL.poner(zona, true, { que: 'esta orden' });
  assert.ok(guardar.hidden && agregar.hidden && servicio.disabled && precio.disabled, 'la ficha abre en solo lectura');

  // Duplicar: el editor y la barra pasan a la ventana de la orden nueva y se liberan.
  const ventanaNueva = new El('DIV'); ventanaNueva.append(editor, barra);
  SL.liberar(editor); SL.liberar(barra);
  assert.equal(guardar.hidden, false, 'el botón Guardar se ve en la orden duplicada');
  assert.equal(descargar.hidden, false, 'Guardar y descargar se ve');
  assert.equal(agregar.hidden, false, '«+ Agregar servicio» se ve');
  assert.equal(servicio.disabled || precio.disabled, false, 'las partidas se pueden editar');
  assert.equal(convertir.hidden, true, 'lo que ya estaba escondido antes del candado sigue escondido');
  assert.equal(guardar.dataset.slAntes, undefined, 'no queda rastro del candado');

  // Al regresar a la ficha (otra orden), el candado se vuelve a poner como siempre.
  zona.append(editor, barra); SL.poner(zona, true, { que: 'esta orden' });
  assert.ok(guardar.hidden && servicio.disabled, 'de vuelta en la ficha, solo lectura otra vez');
  SL.liberar(barra);
  assert.equal(convertir.hidden, true);
});

test('la ventana de crear libera el editor y la barra al recibirlos', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const fn = app.slice(app.indexOf('function prepararEditorCotizacion('), app.indexOf('function sincronizarEditor('));
  const linea = fn.split('\n').find(l => l.includes("if(modo==='nuevo')") && l.includes('before(barra)'));
  assert.ok(linea, 'existe la línea que lleva la barra a la ventana de crear');
  assert.match(linea, /SoloLectura\.liberar\(editor\)/);
  assert.match(linea, /SoloLectura\.liberar\(barra\)/);
});
