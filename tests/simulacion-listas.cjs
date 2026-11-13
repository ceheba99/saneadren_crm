// LISTAS DESPLEGABLES (2026-11-13, pedido de Dirección): un apartado con TODAS las listas del sistema y por qué se
// pueden o no editar; las que estaban fijas en el código sin cálculos detrás se editan ahí. Reglas:
//  · Solo Dirección (el admin) ve el apartado y cambia las listas; ni el Gerente.
//  · Agregar, renombrar, ordenar y ocultar. Nada se borra. Lo oculto no se ofrece al capturar, pero lo ya guardado
//    con esa opción se sigue viendo y se puede volver a guardar.
//  · Renombrar un puesto (lo guardado es el texto) cambia también a las personas que lo tienen.
//  · «Supervisor» no se renombra ni se oculta: el reloj checador lo usa por su nombre.
//  · Los cambios siguen después de reiniciar el sistema y quedan en la bitácora.
// Uso: node tests/simulacion-listas.cjs
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-listas-')), DB = path.join(dir, 'sim.db');
const ADMIN = { correo: 'direccion@saneadren.com.mx', password: 'Listas-' + Math.random().toString(36).slice(2) + '-7Q' };
const CLAVE = 'Clave-Listas-2026x';
const PUERTO = String(9980 + Math.floor(Math.random() * 15)), URL = 'http://localhost:' + PUERTO + '/api';
let srv, salida = '';
const arrancar = async () => {
  salida = '';
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, MODO_DEMO: '', PORT: PUERTO, DB_PATH: DB, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '', CLAVE_CIFRADO: 'clave-de-prueba-listas-1234567890abcdef' } });
  srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
};
const parar = () => new Promise(r => { srv.once('exit', r); srv.kill(); });
const pedir = async (m, r, t, b) => {
  const x = await fetch(URL + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  let j = {}; try { j = await x.json(); } catch { /* */ } return [x.status, j];
};
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 600) : '')); } else console.log('  ✔ ' + texto); };
const opciones = l => l.opciones.map(o => ({ clave: o.clave, nombre: o.nombre, oculta: o.oculta }));

(async () => {
  await arrancar();
  let A = (await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }))[1].token;
  let s, j;
  const qro = (await pedir('GET', '/sucursales', A))[1].sucursales[0];
  [s, j] = await pedir('POST', '/usuarios', A, { nombre: 'Gema Gerente', password: CLAVE, rol: 'gerente', sucursales: [qro.id] });
  const G = (await pedir('POST', '/login', null, { nombre: 'Gema Gerente', password: CLAVE }))[1].token;

  console.log('Inventario completo (solo Dirección):');
  [s, j] = await pedir('GET', '/listas/admin', A);
  const total = require('../server/listas-escaneo').escanear().length;
  revisa(s === 200 && j.total === total && total > 150, `Dirección ve las ${total} listas del sistema`, [s, j.total]);
  const suma = j.inventario.reduce((t, e) => t + e.cuantas, 0);
  revisa(suma === new Set(require('../server/listas-escaneo').escanear().map(x => x.clave)).size, 'cada lista está en un grupo del inventario', suma);
  revisa(['editable', 'catalogo', 'registros', 'fija', 'sat', 'filtro'].every(g => j.grupos[g]), 'están los 6 grupos con su explicación');
  revisa(j.inventario.filter(e => e.grupo === 'fija' || e.grupo === 'sat').every(e => e.porque), 'cada lista fija o del SAT dice por qué no se edita');
  revisa(j.inventario.filter(e => e.grupo === 'catalogo' || e.grupo === 'registros').every(e => e.donde), 'cada catálogo y registro dice dónde se edita');
  const PUESTOS = j.editables.puestos;
  [s] = await pedir('GET', '/listas/admin', G);
  revisa(s === 403, 'el Gerente no ve el apartado', s);
  [s] = await pedir('PUT', '/listas/puestos', G, { opciones: opciones(PUESTOS) });
  revisa(s === 403, 'el Gerente no cambia una lista', s);
  [s, j] = await pedir('GET', '/listas', G);
  revisa(s === 200 && Array.isArray(j.tipos_gasto), 'todos reciben las opciones ocultas y el tipo de gasto vigente', s);

  console.log('Puestos: renombrar cambia lo ya guardado; ocultar no rompe lo guardado:');
  [s, j] = await pedir('POST', '/personal', A, { nombre: 'Ana Ayudante', puesto: 'Ayudante', sucursal_id: qro.id });
  const ANA = j; revisa(s === 201, 'alta de una persona con puesto «Ayudante»', [s, j]);
  [s, j] = await pedir('POST', '/personal', A, { nombre: 'Oscar Operador', puesto: 'Operador', sucursal_id: qro.id });
  const OSC = j;
  const ren = opciones(PUESTOS).map(o => o.clave === 'Ayudante' ? { ...o, nombre: 'Auxiliar de campo' } : o.clave === 'Operador' ? { ...o, oculta: true } : o);
  [s, j] = await pedir('PUT', '/listas/puestos', A, { version: PUESTOS.version, opciones: ren });
  revisa(s === 200 && j.migrados === 1, 'Dirección renombra «Ayudante» y oculta «Operador» (1 persona actualizada)', [s, j]);
  [s, j] = await pedir('GET', '/personal/' + ANA.id, A);
  revisa(j.puesto === 'Auxiliar de campo', 'la persona ya tiene el puesto con el nombre nuevo', j.puesto);
  [s, j] = await pedir('GET', '/personal/catalogos', A);
  revisa(j.puestos.includes('Auxiliar de campo') && !j.puestos.includes('Ayudante'), 'la ficha del personal ofrece el nombre nuevo', j.puestos);
  [s, j] = await pedir('GET', '/listas', A);
  revisa((j.ocultas['pe-puesto'] || []).includes('Operador') && (j.ocultas['nm-r-puesto'] || []).includes('Operador'), 'la pantalla sabe que «Operador» está oculto en las listas de captura', j.ocultas);
  revisa(!j.ocultas['pe-f-puesto'], 'en el filtro de Personal sí se sigue viendo (para buscar lo viejo)', j.ocultas);
  const pOsc = (await pedir('GET', '/personal/' + OSC.id, A))[1];
  [s, j] = await pedir('PUT', '/personal/' + OSC.id, A, { version: pOsc.version, puesto: 'Operador', telefono: '442 111 2233' });
  revisa(s === 200, 'quien ya tenía «Operador» se sigue guardando sin problema', [s, j]);
  [s, j] = await pedir('POST', '/personal', A, { nombre: 'Nadia Nueva', puesto: 'Ayudante', sucursal_id: qro.id });
  revisa(s === 400, 'el nombre viejo «Ayudante» ya no se acepta', [s, j]);

  console.log('Candados:');
  [s, j] = await pedir('GET', '/listas/admin', A); let L = j.editables.puestos;
  [s, j] = await pedir('PUT', '/listas/puestos', A, { version: L.version, opciones: opciones(L).map(o => o.clave === 'Supervisor' ? { ...o, nombre: 'Jefe de cuadrilla' } : o) });
  revisa(s === 400 && /checador/.test(j.error), '«Supervisor» no se renombra (lo usa el reloj checador)', [s, j]);
  [s, j] = await pedir('PUT', '/listas/puestos', A, { version: L.version, opciones: opciones(L).map(o => o.clave === 'Supervisor' ? { ...o, oculta: true } : o) });
  revisa(s === 400, '«Supervisor» tampoco se oculta', [s, j]);
  [s, j] = await pedir('PUT', '/listas/puestos', A, { version: L.version, opciones: opciones(L).filter(o => o.clave !== 'Otro') });
  revisa(s === 400 && /no se borran/.test(j.error), 'una opción no se borra (se oculta)', [s, j]);
  [s, j] = await pedir('PUT', '/listas/puestos', A, { version: L.version, opciones: [...opciones(L), { nombre: 'técnico' }] });
  revisa(s === 409, 'no se repite una opción (sin importar mayúsculas)', [s, j]);
  [s, j] = await pedir('PUT', '/listas/puestos', A, { version: L.version, opciones: [...opciones(L), { nombre: 'Ayudante' }] });
  revisa(s === 409, 'no se agrega con el nombre que tuvo antes otra opción', [s, j]);
  [s, j] = await pedir('PUT', '/listas/puestos', A, { version: L.version, opciones: [...opciones(L), { nombre: '<b>x</b>' }] });
  revisa(s === 400, 'no se aceptan < > en el nombre', [s, j]);
  [s, j] = await pedir('PUT', '/listas/puestos', A, { version: L.version, opciones: opciones(L).map(o => ({ ...o, oculta: o.clave !== 'Supervisor' ? true : false })).map(o => o.clave === 'Supervisor' ? o : o) });
  revisa(s === 200, 'puede quedar una sola visible', [s, j]);
  [s, j] = await pedir('GET', '/listas/admin', A); L = j.editables.puestos;
  [s, j] = await pedir('PUT', '/listas/puestos', A, { version: L.version - 1, opciones: opciones(L) });
  revisa(s === 409, 'si otra persona la cambió mientras tanto, avisa en vez de pisarla', [s, j]);
  [s, j] = await pedir('PUT', '/listas/no-existe', A, { opciones: [{ nombre: 'x' }] });
  revisa(s === 404, 'una lista que no es editable no se toca', s);
  [s, j] = await pedir('PUT', '/listas/puestos', A, { version: L.version, opciones: opciones(L).map(o => ({ ...o, oculta: false })) });
  revisa(s === 200, 'Dirección vuelve a mostrar todas', [s, j]);

  console.log('Agregar y ordenar en otras listas:');
  [s, j] = await pedir('GET', '/listas/admin', A);
  const TG = j.editables.tipos_gasto, CR = j.editables.tipos_credito, FM = j.editables.formatos_mk;
  [s, j] = await pedir('PUT', '/listas/tipos_gasto', A, { version: TG.version, opciones: [{ nombre: 'Quincenal' }, ...opciones(TG)] });
  revisa(s === 200, 'Dirección agrega «Quincenal» al tipo de gasto, hasta arriba', [s, j]);
  [s, j] = await pedir('GET', '/listas', A);
  revisa(j.tipos_gasto[0][1] === 'Quincenal' && j.tipos_gasto[0][2] === 'QUINCENAL', 'el tipo de gasto nuevo sale primero, y en el Excel como QUINCENAL', j.tipos_gasto[0]);
  const QUIN = j.tipos_gasto[0][0];
  [s, j] = await pedir('PUT', '/listas/tipos_credito', A, { version: CR.version, opciones: [...opciones(CR).reverse(), { nombre: 'Factoraje' }] });
  revisa(s === 200, 'Dirección invierte el orden de los tipos de crédito y agrega «Factoraje»', [s, j]);
  [s, j] = await pedir('GET', '/creditos', A);
  const tipos = Object.values(j.tipos || {});
  revisa(tipos.at(-1) === 'Factoraje' && tipos[0] === CR.opciones.at(-1).nombre, 'Créditos ofrece los tipos en el orden nuevo', tipos);
  [s, j] = await pedir('PUT', '/listas/formatos_mk', A, { version: FM.version, opciones: opciones(FM).map(o => o.clave === 'reel' ? { ...o, nombre: 'Reel (video vertical)' } : o) });
  revisa(s === 200, 'Dirección renombra el formato «Reel»', [s, j]);
  [s, j] = await pedir('GET', '/marketing', A);
  revisa(j.formatos?.reel === 'Reel (video vertical)', 'Marketing ya muestra el nombre nuevo (la clave guardada no cambia)', j.formatos);

  console.log('Bitácora y reinicio:');
  [s, j] = await pedir('GET', '/auditoria?entidad=catalogo&limite=50', A);
  const txt = JSON.stringify(j);
  revisa(/Puestos del personal/.test(txt) && /Auxiliar de campo/.test(txt), 'el cambio de puestos quedó en la bitácora', txt.slice(0, 300));
  await parar(); await arrancar();
  A = (await pedir('POST', '/login', null, { nombre: 'admin', password: ADMIN.password }))[1].token;
  [s, j] = await pedir('GET', '/listas', A);
  revisa(j.tipos_gasto[0][0] === QUIN, 'después de reiniciar sigue «Quincenal» hasta arriba', j.tipos_gasto[0]);
  [s, j] = await pedir('GET', '/personal/catalogos', A);
  revisa(j.puestos.includes('Auxiliar de campo') && !j.puestos.includes('Ayudante'), 'y los puestos siguen con el nombre nuevo', j.puestos);
  [s, j] = await pedir('GET', '/marketing', A);
  revisa(j.formatos?.reel === 'Reel (video vertical)', 'y el formato renombrado también', j.formatos?.reel);

  await parar();
  console.log(`\n${n - malos.length}/${n} correctas`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-3000)); srv?.kill(); process.exit(1); });
