// Etapa 2 de la auditoría (AUDITORIA_ERP/14): DB-01. Restaurar un respaldo «encima» de la instalación no debe dañar la base.
// 1) Se baja el respaldo completo (.tar) con 5 proveedores; luego se dan de alta 10 más y se detiene el sistema (SIGTERM).
// 2) Al detenerse, el sistema debe cerrar la base: no deben quedar «saneadren.db-wal»/«-shm» con cambios pendientes.
// 3) El LEEME del respaldo debe decir que se borren esos dos archivos antes de copiar.
// 4) Se restaura encima, como decía el LEEME viejo (solo copiar saneadren.db): integridad «ok», 5 proveedores, 0 llaves rotas,
//    y el sistema vuelve a arrancar y muestra Proveedores.
// Uso: node tests/simulacion-cierre-ordenado.cjs   (base temporal; nada toca la base real)
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-cierre-ordenado-')); const DB = path.join(dir, 'saneadren.db');
const PUERTO = String(5200 + Math.floor(Math.random() * 300));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Cierre-' + Math.random().toString(36).slice(2) + '-9' };
let proceso = null;
const arrancar = () => {
  let salida = '';
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: DB, APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', RESPALDOS: '0', TZ: 'America/Mexico_City' } });
  p.stdout.on('data', d => salida += d); p.stderr.on('data', d => salida += d);
  const fin = new Promise(r => p.on('exit', (codigo, senal) => r({ codigo, senal })));
  proceso = p;
  return { listo: () => /corriendo/.test(salida), salida: () => salida, fin, p };
};
const espera = ms => new Promise(r => setTimeout(r, ms));
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const levantar = async () => {
  const s = arrancar();
  for (let i = 0; i < 150 && !s.listo(); i++) await espera(150);
  if (!s.listo()) throw new Error('El sistema no arrancó: ' + s.salida().slice(-1500));
  const T = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  if (!T) throw new Error('No se pudo iniciar sesión');
  return { s, T };
};
const detener = async s => { s.p.kill('SIGTERM'); const r = await Promise.race([s.fin, espera(10000).then(() => null)]); if (!r) s.p.kill('SIGKILL'); proceso = null; return r; };
// Lee los archivos de un .tar (ustar sencillo, como lo arma server/respaldo-completo.js).
const leerTar = buf => {
  const out = {};
  for (let i = 0; i + 512 <= buf.length;) {
    const h = buf.subarray(i, i + 512); if (!h.some(x => x)) break;
    const corta = s => s.toString('utf8').replace(/\0.*$/s, '');
    const nombre = (corta(h.subarray(345, 500)) ? corta(h.subarray(345, 500)) + '/' : '') + corta(h.subarray(0, 100));
    const tam = parseInt(corta(h.subarray(124, 136)).trim() || '0', 8);
    out[nombre] = buf.subarray(i + 512, i + 512 + tam);
    i += 512 + Math.ceil(tam / 512) * 512;
  }
  return out;
};
const tamano = f => (fs.existsSync(f) ? fs.statSync(f).size : 0);
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
const sec = t => console.log('\n== ' + t);
const terminar = () => { if (proceso) proceso.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); };

(async () => {
  sec('1. Respaldo completo con 5 proveedores; después se dan de alta 10 más y se detiene el sistema');
  let { s, T } = await levantar();
  const alta = async nombre => { const [st, j] = await pedir('POST', '/finanzas/proveedores', T, { nombre, categoria: 'subcontratacion', dias_credito: 7, forzar: true }); if (st !== 201 && st !== 200) throw new Error('alta de proveedor ' + st + JSON.stringify(j)); };
  for (let i = 1; i <= 5; i++) await alta('ANTES DEL RESPALDO ' + i);
  const [sb, jb] = await pedir('POST', '/admin/backup-completo', T);
  if (sb !== 200) throw new Error('No se pudo pedir el respaldo: ' + sb + JSON.stringify(jb));
  const tar = Buffer.from(await (await fetch(`http://localhost:${PUERTO}` + jb.url)).arrayBuffer());
  const contenido = leerTar(tar);
  revisa(!!contenido['saneadren.db'] && !!contenido['LEEME.txt'], 'el respaldo trae saneadren.db y LEEME.txt', Object.keys(contenido));
  const respaldo = path.join(dir, 'respaldo.db'); fs.writeFileSync(respaldo, contenido['saneadren.db']);
  const enRespaldo = (() => { const d = new DatabaseSync(respaldo, { readOnly: true }); try { return d.prepare('SELECT COUNT(*) n FROM proveedores').get().n; } finally { d.close(); } })();
  revisa(enRespaldo >= 5, `el respaldo tiene los proveedores de antes (${enRespaldo})`);
  for (let i = 1; i <= 10; i++) await alta('DESPUES DEL RESPALDO ' + i);
  const salida = await detener(s);
  revisa(salida && (salida.codigo === 0 || salida.senal === 'SIGTERM'), 'el sistema se detiene con la señal normal de apagado', salida);

  sec('2. Al detenerse, el sistema cierra la base (no deja cambios pendientes en archivos auxiliares)');
  const wal = tamano(DB + '-wal'), shm = fs.existsSync(DB + '-shm');
  revisa(wal === 0, `no queda «saneadren.db-wal» con cambios pendientes (tamaño: ${wal} bytes)`);
  revisa(!shm, 'no queda «saneadren.db-shm»');
  const enBase = (() => { const d = new DatabaseSync(DB, { readOnly: true }); try { return d.prepare("SELECT COUNT(*) n FROM proveedores WHERE nombre LIKE 'DESPUES DEL RESPALDO%'").get().n; } finally { d.close(); } })();
  revisa(enBase === 10, `la base detenida conserva las 10 altas de después del respaldo (${enBase})`);

  sec('3. El LEEME del respaldo explica qué hacer con los archivos auxiliares');
  const leeme = contenido['LEEME.txt'].toString('utf8');
  revisa(/saneadren\.db-wal/.test(leeme) && /saneadren\.db-shm/.test(leeme) && /borra/i.test(leeme), 'el LEEME dice que se borren «saneadren.db-wal» y «saneadren.db-shm» antes de copiar', leeme);

  sec('4. Restaurar encima (copiar solo saneadren.db, sin tocar nada más de la carpeta)');
  fs.copyFileSync(respaldo, DB);
  const d = new DatabaseSync(DB);
  let integ, prov, rotas;
  try { integ = d.prepare('PRAGMA integrity_check').all().map(r => Object.values(r)[0]).join(' '); prov = d.prepare('SELECT COUNT(*) n FROM proveedores').get().n; rotas = d.prepare('PRAGMA foreign_key_check').all().length; }
  catch (e) { integ = 'ERROR: ' + e.message; } finally { d.close(); }
  revisa(integ === 'ok', `integridad de la base restaurada: «${integ}»`);
  revisa(prov === enRespaldo, `la base restaurada tiene los mismos proveedores que el respaldo (${prov} de ${enRespaldo})`);
  revisa(rotas === 0, `0 llaves rotas (${rotas})`);
  ({ s, T } = await levantar());
  const [sp, jp] = await pedir('GET', '/finanzas/proveedores', T);
  revisa(sp === 200, `tras restaurar, la pantalla de Proveedores responde (código ${sp})`);
  revisa(Array.isArray(jp) ? !jp.some(p => /^DESPUES DEL RESPALDO/.test(p.nombre)) : true, 'no aparece ningún proveedor de después del respaldo');
  await detener(s);

  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) { console.log('FALLARON:\n - ' + malos.join('\n - ')); process.exitCode = 1; }
})().catch(e => { console.error('Error en la prueba:', e); process.exitCode = 1; }).finally(terminar);
