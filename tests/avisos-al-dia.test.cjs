// Notificaciones al día (2026-11-11, Dirección: «después de cumplir la notificación hay que recargar toda la página»).
// Se prueba el pedazo de public/app.js con api() y avisosAlDia en un contexto aislado.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const codigo = app.slice(app.indexOf('async function api('), app.indexOf('function fechaCorta('));

function montar({ vista = 'vista-inicio', respuesta = { ok: true, status: 200 } } = {}) {
  const timers = [], llamadas = [], escuchas = {};
  const activas = new Set([vista]);
  const ctx = vm.createContext({
    API: '/api', USUARIO_ACTUAL: { token: 't' },
    encabezadoSucursal: () => ({}), errorConEstado: (m, s) => Object.assign(new Error(m), { status: s }),
    fetch: async () => ({ ...respuesta, clone: () => ({ json: async () => ({}) }) }),
    document: {
      visibilityState: 'visible',
      getElementById: id => ({ classList: { contains: c => c === 'activa' && activas.has(id), add() {} } }),
      addEventListener: (e, fn) => { escuchas[e] = fn; }
    },
    cargarInicio: async silencioso => { llamadas.push(['inicio', silencioso]); },
    RH: { cargar: async () => { llamadas.push(['rh']); } },
    actualizarBadgePendientes: async () => { llamadas.push(['contador']); },
    setTimeout: (fn, ms) => { timers.push(fn); return timers.length; }, clearTimeout: id => { if (id) timers[id - 1] = null; },
    toast() {}, Cuentas: {}, localStorage: { removeItem() {} }, location: {}
  });
  vm.runInContext(codigo + ';globalThis.api = api;', ctx);
  const correr = async () => { const l = timers.splice(0).filter(Boolean); for (const fn of l) await fn(); };
  return { ctx, llamadas, correr, escuchas, activas };
}

test('al guardar un cambio en Inicio, los avisos se vuelven a pedir sin «Cargando…» y el contador también', async () => {
  const m = montar();
  await m.ctx.api('/historial/3/resolver', { method: 'PUT' });
  await m.correr();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(m.llamadas)), [['inicio', true], ['contador']]);
});
test('varios cambios seguidos se juntan en una sola recarga', async () => {
  const m = montar();
  await m.ctx.api('/a', { method: 'POST' }); await m.ctx.api('/b', { method: 'PUT' }); await m.ctx.api('/c', { method: 'DELETE' });
  await m.correr();
  assert.strictEqual(m.llamadas.filter(x => x[0] === 'inicio').length, 1);
});
test('solo leer (GET) no recarga nada', async () => {
  const m = montar();
  await m.ctx.api('/alertas'); await m.ctx.api('/leads', { method: 'get' });
  await m.correr();
  assert.strictEqual(m.llamadas.length, 0);
});
test('un cambio que falló no recarga', async () => {
  const m = montar({ respuesta: { ok: false, status: 409 } });
  await m.ctx.api('/a', { method: 'POST' });
  await m.correr();
  assert.strictEqual(m.llamadas.length, 0);
});
test('en Inicio de RH se recarga RH; en otra pantalla solo el contador (Inicio se pide al entrar)', async () => {
  const rh = montar({ vista: 'vista-rh' });
  await rh.ctx.api('/asistencia/intentos/revisar', { method: 'POST' }); await rh.correr();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rh.llamadas)), [['rh'], ['contador']]);
  const otra = montar({ vista: 'vista-leads' });
  await otra.ctx.api('/leads/1', { method: 'PUT' }); await otra.correr();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(otra.llamadas)), [['contador']]);
});
test('al regresar a la pestaña también se ponen al día', async () => {
  const m = montar();
  m.escuchas.visibilitychange(); await m.correr();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(m.llamadas)), [['inicio', true], ['contador']]);
});
test('sin sesión no se pide nada', async () => {
  const m = montar();
  await m.ctx.api('/a', { method: 'POST' });
  m.ctx.USUARIO_ACTUAL = null;
  await m.correr();
  assert.strictEqual(m.llamadas.length, 0);
});
