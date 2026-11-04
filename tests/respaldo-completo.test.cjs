// Pruebas del respaldo completo (server/respaldo-completo.js): base + carpeta «archivos/» en un .tar válido, solo
// Dirección, boleto de un solo uso, y que NUNCA incluya la clave de cifrado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const express = require('express');

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-respaldo-completo-'));
const DB = path.join(raiz, 'saneadren.db'), ARCH = path.join(raiz, 'archivos');
const escribir = (rel, buf) => { const r = path.join(ARCH, rel); fs.mkdirSync(path.dirname(r), { recursive: true }); fs.writeFileSync(r, buf); return buf; };
fs.writeFileSync(DB, 'base de prueba');
fs.writeFileSync(path.join(raiz, 'clave-cifrado.key'), 'NO-DEBE-SALIR');
const esperados = {
  'checadas/2026-11/1-abc.jpg.cifrado': escribir('checadas/2026-11/1-abc.jpg.cifrado', crypto.randomBytes(5000)),
  'personal/7/3-def.pdf.cifrado': escribir('personal/7/3-def.pdf.cifrado', crypto.randomBytes(512)),
  'facturas/vacio.pdf': escribir('facturas/vacio.pdf', Buffer.alloc(0)),
  ['marketing/' + 'carpeta-con-nombre-largo/'.repeat(4) + 'comprobante-ñandú.pdf']: escribir('marketing/' + 'carpeta-con-nombre-largo/'.repeat(4) + 'comprobante-ñandú.pdf', crypto.randomBytes(1300)),
};

let servidor, base;
test.before(async () => {
  process.env.DB_PATH = DB;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { const r = req.get('x-rol'); if (r) req.usuarioSesion = { id: 1, nombre: 'Prueba', admin_general: r === 'admin' }; next(); });
  app.locals.auditoria = { registrar: () => {} };
  const h = fn => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };
  const db = { backup: async destino => fs.copyFileSync(DB, destino) };
  require('../server/respaldo-completo')(app, db, h, { hoyMexico: () => '2026-11-03' });
  await new Promise(r => { servidor = app.listen(0, r); });
  base = 'http://127.0.0.1:' + servidor.address().port;
});
test.after(() => { servidor?.close(); fs.rmSync(raiz, { recursive: true, force: true }); });

const boleto = rol => fetch(base + '/api/admin/backup-completo', { method: 'POST', headers: { 'x-rol': rol } });

test('solo Dirección pide el respaldo completo', async () => {
  assert.equal((await boleto('ventas')).status, 403);
  assert.equal((await fetch(base + '/descargas/respaldo-completo?b=' + 'x'.repeat(32))).status, 403);
  assert.equal((await fetch(base + '/descargas/respaldo-completo')).status, 403);
});

test('el .tar trae la base y todos los archivos idénticos, y no la clave de cifrado', async () => {
  const { url } = await (await boleto('admin')).json();
  const r = await fetch(base + url);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /saneadren_respaldo_completo_2026-11-03\.tar/);
  const tar = Buffer.from(await r.arrayBuffer());
  assert.equal(tar.length % 512, 0);
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-respaldo-sacado-')), archivoTar = path.join(destino, 'r.tar');
  fs.writeFileSync(archivoTar, tar);
  const x = spawnSync('tar', ['-xf', archivoTar, '-C', destino], { encoding: 'utf8' });
  assert.equal(x.status, 0, x.stderr);
  assert.equal(fs.readFileSync(path.join(destino, 'saneadren.db'), 'utf8'), 'base de prueba');
  for (const [rel, buf] of Object.entries(esperados)) assert.ok(fs.readFileSync(path.join(destino, 'archivos', rel)).equals(buf), rel);
  assert.ok(!tar.includes(Buffer.from('NO-DEBE-SALIR')) && !fs.existsSync(path.join(destino, 'clave-cifrado.key')));
  assert.match(fs.readFileSync(path.join(destino, 'LEEME.txt'), 'utf8'), /4 archivo\(s\)/);
  fs.rmSync(destino, { recursive: true, force: true });
  // El boleto sirve una sola vez.
  assert.equal((await fetch(base + url)).status, 403);
});
