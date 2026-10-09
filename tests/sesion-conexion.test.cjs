const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const crearAlmacen = require('../server/sesiones');
test('sesiones sobreviven al reinicio, conservan vencimiento y se revocan', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-sesiones-'));
  const file = path.join(dir, 'test.db');
  let db = new Database(file);
  try {
    db.exec('CREATE TABLE usuarios (id INTEGER PRIMARY KEY); INSERT INTO usuarios VALUES (1)');
    let store = crearAlmacen(db);
    const expira = Date.now() + 100000;
    store.set('token-de-prueba', { usuarioId: 1, expira });
    assert.notEqual(db.prepare('SELECT token_hash FROM sesiones').get().token_hash, 'token-de-prueba');
    db.close(); db = new Database(file); store = crearAlmacen(db);
    assert.deepEqual(store.get('token-de-prueba'), { usuarioId: 1, expira });
    store.delete('token-de-prueba');
    assert.equal(store.get('token-de-prueba'), undefined);
    store.set('vencido', { usuarioId: 1, expira: Date.now() - 1 });
    assert.equal(crearAlmacen(db).get('vencido'), undefined);
  } finally { db.close(); fs.rmSync(dir, { recursive: true }); }
});
function cliente(fetch) {
  const elements = new Map();
  const context = vm.createContext({ fetch, console, localStorage: { removeItem() {}, setItem() {} },
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, {style:{},classList:{add(){}}}); return elements.get(id); } },
    window:{addEventListener(){}}, setTimeout(){}, clearInterval(){} });
  const src = fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  vm.runInContext(src.slice(0,src.indexOf('function fechaCorta')),context);
  vm.runInContext("guardarSesion({token:'vigente'})",context);
  return context;
}
test('401 invalida sesión y bloquea nuevas peticiones sin token', async () => {
  let llamadas=0;
  const c=cliente(async()=>{llamadas++;return {status:401};});
  await assert.rejects(vm.runInContext("api('/usuarios')",c),e=>e.status===401);
  await assert.rejects(vm.runInContext("api('/servicios')",c),e=>e.status===401);
  assert.equal(llamadas,1);
});
test('fallo de conexión conserva sesión y devuelve error comprensible', async () => {
  const c=cliente(async()=>{throw new TypeError('Failed to fetch');});
  await assert.rejects(vm.runInContext("api('/leads')",c),e=>e.codigo==='SIN_CONEXION');
  assert.equal(vm.runInContext('USUARIO_ACTUAL.token',c),'vigente');
});
test('401 tardío no elimina una sesión nueva', async () => {
  let resolve;
  const c=cliente(()=>new Promise(r=>resolve=r));
  const pending=vm.runInContext("api('/leads')",c);
  vm.runInContext("guardarSesion({token:'nueva'})",c);
  resolve({status:401});
  await assert.rejects(pending,e=>e.status===401);
  assert.equal(vm.runInContext('USUARIO_ACTUAL.token',c),'nueva');
});
