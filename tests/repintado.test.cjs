// Candado «sin brincos» (2026-11-13): ninguna pantalla muestra «Cargando…» encima de lo que ya se veía.
// Regla (public/ui.js, Repintado): «Cargando…» solo con Repintado.cargando(contenedor, clave) o, a mano, solo si el contenedor
// está vacío (if (!cont.innerHTML.trim()) …) o cambió lo que se ve (if (!ORD || ORD.id !== id) …). Si no, esta prueba falla.
// Para una excepción justificada, agrégala a EXCEPCIONES con el archivo, un trozo único de la línea y el PORQUÉ.
const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs'); const path = require('path');
const PUBLIC = path.join(__dirname, '..', 'public');
const EXCEPCIONES = [
  // Una sola línea de texto de estado: no es el contenido de la pantalla y no cambia su altura, así que no hay nada que se encoja ni que brinque.
  { archivo: 'app.js', trozo: "resumen.textContent = 'Cargando…'", porque: 'resumen de una línea del Generador (la tabla de abajo no se borra)' },
  { archivo: 'calendario.js', trozo: "$('cal-estado').textContent = 'Cargando…'", porque: 'texto de estado de una línea; el calendario de abajo se queda hasta que llega lo nuevo' },
];
const lineas = f => fs.readFileSync(path.join(PUBLIC, f), 'utf8').split('\n');
const archivos = fs.readdirSync(PUBLIC).filter(f => f.endsWith('.js'));

test('ninguna pantalla pone «Cargando…» sobre lo que ya se veía', () => {
  const malas = [];
  for (const f of archivos) {
    if (f === 'ui.js') continue; // aquí vive el ayudante
    lineas(f).forEach((l, i) => {
      if (!/Cargando/.test(l)) return;
      const asigna = /\.innerHTML\s*=/.test(l) || /\.textContent\s*=/.test(l) || /estadoCarga\(/.test(l);
      if (!asigna) return;
      if (/Repintado\./.test(l)) return;
      if (/if \(\s*!\s*[\w$.()'"\[\]-]+\.innerHTML\.trim\(\)\s*\)/.test(l)) return;           // solo si está vacío
      if (/if \(\s*!(ORD|DATOS)\b/.test(l)) return;                                          // solo si cambió el registro / aún no hay datos
      if (EXCEPCIONES.some(e => e.archivo === f && l.includes(e.trozo.replace(/\n$/, '')))) return;
      malas.push(`${f}:${i + 1}  ${l.trim().slice(0, 120)}`);
    });
  }
  assert.deepStrictEqual(malas, [], 'Estas líneas muestran «Cargando…» sin la condición de contenedor vacío ni el ayudante Repintado (public/ui.js):\n' + malas.join('\n'));
});

test('cada excepción sigue siendo necesaria (no se acumulan avisos viejos)', () => {
  const sobran = EXCEPCIONES.filter(e => !lineas(e.archivo).some(l => /Cargando/.test(l) && l.includes(e.trozo.replace(/\n$/, '')))
    && !lineas(e.archivo).some(l => l.includes(e.trozo.replace(/\n$/, ''))));
  assert.deepStrictEqual(sobran.map(e => e.archivo + ' · ' + e.trozo.slice(0, 40)), [], 'Excepciones que ya no aplican: quítalas de EXCEPCIONES');
});

test('el ayudante Repintado existe y se carga antes que las pantallas', () => {
  const ui = fs.readFileSync(path.join(PUBLIC, 'ui.js'), 'utf8');
  for (const m of ['capturar', 'restaurar', 'conservar', 'pintar', 'cargando', 'falla']) assert.match(ui, new RegExp('\\b' + m + '\\b'), 'falta Repintado.' + m);
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const orden = [...html.matchAll(/<script src="([\w.-]+\.js)/g)].map(m => m[1]);
  const posUi = orden.indexOf('ui.js');
  assert.ok(posUi >= 0, 'ui.js no está en index.html');
  for (const f of archivos) {
    if (f === 'ui.js' || !/Repintado\./.test(fs.readFileSync(path.join(PUBLIC, f), 'utf8'))) continue;
    const pos = orden.indexOf(f);
    if (pos >= 0) assert.ok(pos > posUi, f + ' usa Repintado pero se carga antes que ui.js');
  }
});

test('el ayudante conserva scroll, scroll horizontal de tablas y secciones abiertas (simulado)', () => {
  // Mini-DOM suficiente para el ayudante: se ejecuta ui.js solo en la parte de Repintado.
  const ui = fs.readFileSync(path.join(PUBLIC, 'ui.js'), 'utf8');
  const ini = ui.indexOf('window.Repintado = (() => {'), fin = ui.indexOf('})();', ini) + 5;
  const el = (o = {}) => Object.assign({ scrollTop: 0, scrollLeft: 0, dataset: {}, isConnected: true, innerHTML: '', contains: () => false, querySelectorAll: () => [], closest: () => null }, o);
  const det = { open: true, id: 'd1' }, tabla = el({ scrollLeft: 40 }), raiz = el({ dataset: {} });
  raiz.querySelectorAll = sel => (sel === 'details' ? [det] : sel.includes('.tabla-scroll') ? [tabla] : []);
  raiz.contains = x => x === tabla;
  const overlay = el({ scrollTop: 300 });
  const win = { scrollX: 0, scrollY: 500, llamadas: [], addEventListener() {}, requestAnimationFrame() {}, scrollTo(o) { this.llamadas.push(o); this.scrollY = o.top; } };
  const doc = { activeElement: null, querySelectorAll: () => [overlay, tabla] };
  const ctx = { window: win, document: doc, avisoCarga() {}, toast() {} };
  new Function('window', 'document', 'avisoCarga', 'toast', ui.slice(ini, fin))(win, doc, ctx.avisoCarga, ctx.toast);
  const R = win.Repintado;
  // «Cargando…» solo vacío / clave distinta
  raiz.innerHTML = '';
  assert.strictEqual(R.cargando(raiz, 'a'), true, 'vacío: sí muestra Cargando');
  raiz.innerHTML = '<b>datos</b>'; raiz.dataset.rpEstado = 'listo';
  assert.strictEqual(R.cargando(raiz, 'a'), false, 'misma clave con datos: NO muestra Cargando');
  assert.strictEqual(raiz.innerHTML, '<b>datos</b>');
  assert.strictEqual(R.cargando(raiz, 'b'), true, 'otra clave (otra pestaña/fecha/registro): sí');
  // pintar: conserva scroll de ventana, de ventana emergente y de la tabla; reabre los <details>
  raiz.innerHTML = 'x'; raiz.dataset.rpEstado = 'listo';
  win.scrollY = 500; overlay.scrollTop = 300; tabla.scrollLeft = 40; det.open = true;
  R.conservar(raiz, () => { win.scrollY = 0; overlay.scrollTop = 0; tabla.scrollLeft = 0; det.open = false; raiz.innerHTML = 'nuevo'; });
  assert.strictEqual(win.scrollY, 500, 'scroll de la ventana'); assert.strictEqual(overlay.scrollTop, 300, 'scroll de la ventana emergente');
  assert.strictEqual(tabla.scrollLeft, 40, 'scroll horizontal de la tabla'); assert.strictEqual(det.open, true, '<details> abierto');
  // falla: si ya había datos NO se borran
  raiz.innerHTML = '<b>datos</b>'; raiz.dataset.rpEstado = 'listo';
  R.falla(raiz, new Error('sin red'), () => {}, '<p>error</p>', 'prueba');
  assert.strictEqual(raiz.innerHTML, '<b>datos</b>', 'una recarga fallida no borra lo que se veía');
  raiz.innerHTML = '<p>Cargando…</p>'; raiz.dataset.rpEstado = 'cargando';
  R.falla(raiz, new Error('sin red'), () => {}, '<p>error</p>', 'prueba');
  assert.strictEqual(raiz.innerHTML, '<p>error</p>', 'si solo había «Cargando…», sí se muestra el error');
});
