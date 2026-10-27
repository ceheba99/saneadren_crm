// Corre todas las pruebas una por una y exige que cada simulación termine con su resumen («N/N correctas»).
// Si alguna termina sin resumen (p. ej. se quedó esperando algo y Node salió en silencio), cuenta como FALLA:
// una prueba que no llegó al final no prueba nada.
// Uso: node tests/correr-todo.cjs   (o npm test)
const { spawnSync } = require('child_process'); const path = require('path');
const T = f => path.join(__dirname, f);
const PASOS = [
  ['pruebas unitarias', ['--test', ...require('fs').readdirSync(__dirname).filter(f => f.endsWith('.test.cjs')).map(T)], /ℹ fail 0/],
  ['textos escapados', [T('revisar-escapado.cjs')], /Sin interpolaciones sin escapar/],
  ...['simulacion', 'simulacion-dinero', 'simulacion-dinero-2', 'simulacion-conflictos', 'simulacion-tablero', 'simulacion-utilidad-iva', 'simulacion-crear-editar', 'simulacion-revision-pantallas', 'simulacion-compras', 'simulacion-admin', 'simulacion-clientes',
    'simulacion-generador', 'simulacion-tramposa', 'simulacion-principio-a-fin', 'simulacion-expediente', 'simulacion-solicitudes', 'simulacion-folios', 'simulacion-buscador',
    'simulacion-auditoria', 'simulacion-historial-cliente', 'simulacion-fechas', 'simulacion-integridad', 'simulacion-cxp-formato', 'simulacion-demo', 'simulacion-ficha-proveedor',
    'simulacion-sucursales', 'simulacion-encuestas', 'simulacion-contactos', 'simulacion-prospeccion', 'simulacion-sucursales-procesos', 'simulacion-servicio-realizado', 'simulacion-datos-raros', 'simulacion-sucursales-aleatoria', 'simulacion-migracion-sucursales', 'simulacion-permisos', 'simulacion-permisos-ataques', 'simulacion-alcance-roles', 'foto-roles', 'simulacion-procesos-ataques', 'simulacion-personal', 'simulacion-seguridad-personal', 'simulacion-caos', 'auditoria-total', 'simulacion-regreso-version']
    .map(n => [n, [T(n + '.cjs')], /(\d+)\/\1 (pruebas )?correctas|se omite/]),
];
const resultados = [];
let falla = false;
for (const [nombre, args, fin] of PASOS) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000 });
  const salida = (r.stdout || '') + (r.stderr || '');
  const resumen = (salida.match(/\d+\/\d+ (pruebas )?correctas|se omite[^\n]*|ℹ pass \d+|Sin interpolaciones sin escapar/g) || []).pop() || '';
  const ok = r.status === 0 && fin.test(salida);
  if (!ok) { falla = true; process.stdout.write(salida.slice(-4000) + '\n'); }
  resultados.push([ok ? '✔' : '✘', nombre, resumen || (r.status === 0 ? 'TERMINÓ SIN RESUMEN' : 'salida ' + r.status), Math.round((Date.now() - t0) / 1000) + ' s']);
  console.log(resultados.at(-1).join('  '));
}
console.log('\n' + (falla ? '✘ HAY PRUEBAS QUE FALLARON O NO TERMINARON' : `✔ ${resultados.length} baterías completas, todas correctas`));
process.exit(falla ? 1 : 0);
