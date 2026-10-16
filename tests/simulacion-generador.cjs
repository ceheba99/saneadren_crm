// Carga masiva del Generador: renglones de totales, errores, nombres por resolver, «igual que» (clientes,
// productos y canales), ciclos, cobrado / por cobrar, recarga sin duplicar y equivalencias recordadas.
// Uso: node tests/simulacion-generador.cjs   (usa una base temporal)
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-gen-')); const PUERTO = String(5800 + Math.floor(Math.random() * 150));
const ADMIN = { correo: 'marketing@saneadren.com.mx', password: 'Generador-' + Math.random().toString(36).slice(2) + '-5' };
let salida = '';
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: PUERTO, DB_PATH: path.join(dir, 'g.db'), APP_URL: 'http://localhost:' + PUERTO, ADMIN_USUARIO: 'admin', ADMIN_CORREO: ADMIN.correo, ADMIN_PASSWORD: ADMIN.password, SMTP_HOST: '' } });
srv.stdout.on('data', d => salida += d); srv.stderr.on('data', d => salida += d);
const pedir = async (m, r, t, b) => { const x = await fetch(`http://localhost:${PUERTO}/api` + r, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); return [x.status, await x.json().catch(() => ({}))]; };
const espera = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const malos = [];
const revisa = (cond, texto, extra) => { n++; if (!cond) { malos.push(texto); console.log('  ✘ ' + texto + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 500) : '')); } else console.log('  ✔ ' + texto); };
const seccion = t => console.log('\n' + t);
const fila = (id, cliente, producto, subtotal, extra = {}) => ({ fila: 'SEPTIEMBRE #' + id, fecha: '2026-09-0' + (id % 9 + 1), no_orden: String(6000 + id), factura: 'QR' + (3000 + id), producto, cantidad: 1, subtotal, iva: Math.round(subtotal * 16) / 100, total: Math.round(subtotal * 116) / 100, cliente, canal: 'CAUTIVO', unidad: 'C-22', empleado: 'BOGAR TAMAYO', ...extra });

(async () => {
  for (let i = 0; i < 100 && !/corriendo/.test(salida); i++) await espera(150);
  const A = (await pedir('POST', '/login', null, { nombre: ADMIN.correo, password: ADMIN.password }))[1].token;
  await pedir('POST', '/usuarios', A, { nombre: 'Tecnico Sim', correo: 'tecnico.sim@saneadren.com.mx', password: 'Tecnico-Sim-2026', rol: 'tecnico' });
  const Tc = (await pedir('POST', '/login', null, { nombre: 'tecnico.sim@saneadren.com.mx', password: 'Tecnico-Sim-2026' }))[1].token;
  const [, canales] = await pedir('GET', '/canales', A);
  const [, kfc] = await pedir('POST', '/contactos', A, { nombre: 'Compras KFC', telefono: '4425550001', empresa_contacto: 'KFC México S.A. de C.V.', direccion: 'Qro', canal_origen_id: canales[0].id });
  const [, servicios] = await pedir('GET', '/servicios', A);
  const servicio = servicios[0];
  let s, j;

  const filas = [
    fila(1, 'SYMRISE', 'RETIRO DE AGUA RESIDUAL', 27510), fila(2, 'SYMRISE', 'RETIRO DE AGUA RESIDUAL', 27510), fila(3, 'SYMRISE ', 'RETIRO DE AGUAS RESIDUALES', 27510),
    fila(4, 'AGUAKAN', 'RETIRO DE AGUA RESIDUAL', 10000), fila(5, 'AGUKAN CANCUN', 'RETIRO DE AGUAS REDISUALES', 5000),
    fila(6, 'K.F.C. de mexico', servicio.nombre, 3000, { canal: 'CLIENTE NEVO' }), fila(7, 'Otra Empresa', servicio.nombre, 2000, { canal: 'CLIENTE NUEVO', total: '$2.320,00', iva: '' }),
    { fila: 'SEPTIEMBRE #40', subtotal: 102530, iva: 16404.8, total: 118934.8 }, // renglón de totales del mes
  ];

  seccion('1. Revisión: totales, montos y nombres por resolver');
  [s] = await pedir('POST', '/generador/importar?simular=1', Tc, { filas }); revisa(s === 403, 'un técnico no puede cargar el generador');
  [s, j] = await pedir('POST', '/generador/importar?simular=1', A, { filas });
  revisa(s === 200 && j.servicios === 7 && j.omitidas === 1, 'el renglón de totales del mes se ignora', [j.servicios, j.omitidas]);
  revisa(j.errores.length === 0, 'montos escritos como texto ($2.320,00) se entienden', j.errores);
  revisa(Math.abs(j.importe.total - 118934.8) < 0.01, 'el total coincide con el del Excel', j.importe);
  const cli = c => j.por_resolver.clientes.find(x => x.texto.trim() === c);
  revisa(!cli('K.F.C. de mexico'), '«K.F.C. de mexico» se reconoce solo como el cliente KFC que ya existe');
  revisa(cli('SYMRISE')?.filas === 3 && j.por_resolver.clientes.filter(x => x.clave === 'SYMRISE').length === 1, 'SYMRISE (con o sin espacio) es un solo nombre por resolver');
  revisa(cli('AGUKAN CANCUN')?.del_archivo.some(o => o.texto === 'AGUAKAN'), '«AGUKAN CANCUN» sugiere «AGUAKAN» del mismo archivo');
  revisa(j.por_resolver.productos.some(p => p.texto === 'RETIRO DE AGUAS REDISUALES' && p.del_archivo.some(o => o.texto === 'RETIRO DE AGUAS RESIDUALES')), 'el producto con error de dedo sugiere el bien escrito del archivo');
  revisa(j.por_resolver.canales.some(c => c.texto === 'CLIENTE NEVO' && c.del_archivo?.some(o => o.texto === 'CLIENTE NUEVO')), '«CLIENTE NEVO» sugiere «CLIENTE NUEVO»');
  [s, j] = await pedir('POST', '/generador/importar', A, { filas, cobrado: true });
  revisa(s === 200 && j.importadas === 0, 'sin decidir los nombres no se carga nada', [s, j.importadas]);

  seccion('2. Decisiones e «igual que»');
  const eq = { clientes: { SYMRISE: 'nuevo', AGUAKAN: 'nuevo', 'AGUKAN CANCUN': 'como:AGUAKAN', 'OTRA EMPRESA': 'nuevo' },
    productos: { 'RETIRO DE AGUA RESIDUAL': 'nuevo', 'RETIRO DE AGUAS RESIDUALES': 'como:RETIRO DE AGUA RESIDUAL', 'RETIRO DE AGUAS REDISUALES': 'como:RETIRO DE AGUAS RESIDUALES' },
    canales: { CAUTIVO: 'nuevo', 'CLIENTE NUEVO': 'nuevo', 'CLIENTE NEVO': 'como:CLIENTE NUEVO' } };
  [s, j] = await pedir('POST', '/generador/importar?simular=1', A, { filas, equivalencias: { ...eq, clientes: { ...eq.clientes, AGUAKAN: 'como:AGUKAN CANCUN' } } });
  revisa(j.errores.some(e => e.errores.some(x => /apuntan uno al otro/.test(x))), 'si dos nombres apuntan uno al otro, avisa (no se queda en un ciclo)');
  [s, j] = await pedir('POST', '/generador/importar?simular=1', A, { filas, equivalencias: eq });
  revisa(j.errores.length === 0 && ['clientes', 'productos', 'canales'].every(t => j.por_resolver[t].every(x => x.decidido)), 'con las decisiones ya no falta nada', [j.errores, j.por_resolver]);
  revisa(j.por_resolver.clientes.some(c => c.texto === 'AGUKAN CANCUN' && c.decidido), 'lo decidido sigue en la lista para poder cambiarlo');
  revisa(j.clientes_nuevos === 3, 'clientes nuevos: SYMRISE, AGUAKAN (con AGUKAN CANCUN) y Otra Empresa', j.clientes_nuevos);
  [s, j] = await pedir('POST', '/generador/importar', A, { filas, equivalencias: eq });
  revisa(s === 400 && /cobrad/.test(j.error), 'hay que decir si ya se cobraron', [s, j.error]);

  seccion('3. Carga (quedan por cobrar)');
  [s, j] = await pedir('POST', '/generador/importar', A, { filas, equivalencias: eq, cobrado: false });
  revisa(s === 201 && j.importadas === 7 && j.creados.clientes === 3 && j.creados.servicios === 1 && j.creados.canales === 2, 'se cargan 7 servicios, 3 clientes, 1 servicio y 2 canales nuevos', [s, j.importadas, j.creados, j.error]);
  const [, gen] = await pedir('GET', '/generador?desde=2026-09-01&hasta=2026-09-30', A);
  revisa(gen.filas?.length === 7 && Math.abs(gen.filas.reduce((t, f) => t + f.total, 0) - 118934.8) < 0.01, 'el Generador muestra los 7 servicios con el mismo total', gen.filas?.length);
  const aguakan = gen.filas.filter(f => /AGU/.test(f.cliente));
  revisa(aguakan.length === 2 && aguakan[0].cliente_id === aguakan[1].cliente_id, 'AGUAKAN y AGUKAN CANCUN quedaron en el mismo cliente', aguakan.map(f => f.cliente));
  revisa(gen.filas.filter(f => /AGUA/.test(f.producto)).every(f => f.producto === 'RETIRO DE AGUA RESIDUAL'), 'las tres formas de escribir el producto quedaron en un solo servicio', gen.filas.map(f => f.producto));
  revisa(gen.filas.some(f => f.orden_generador === '6001' && f.factura === 'QR3001' && f.unidad === 'C-22' && f.empleado === 'BOGAR TAMAYO'), 'conserva no. de orden, factura, unidad y empleado');
  revisa(gen.filas.find(f => /KFC/i.test(f.cliente))?.cliente_id === kfc.id, 'el servicio de «K.F.C. de mexico» quedó en el cliente KFC existente');
  const [, res] = await pedir('GET', '/finanzas/resumen', A);
  revisa(Math.abs(res.por_cobrar - 118934.8) < 0.01, 'como no estaban cobrados, quedan por cobrar', res.por_cobrar);

  seccion('4. Recargar no duplica; lo decidido se recuerda');
  [s, j] = await pedir('POST', '/generador/importar?simular=1', A, { filas });
  revisa(j.errores.length === 7 && j.errores.every(e => /Ya se cargó antes/.test(e.errores.join())), 'el mismo archivo otra vez: los 7 dicen «ya se cargó»', j.errores.slice(0, 2));
  revisa(['clientes', 'productos', 'canales'].every(t => !j.por_resolver[t].length), 'y ya no pregunta nada: clientes, productos y canales se reconocen solos', j.por_resolver);
  const nuevas = [fila(11, 'AGUKAN CANCUN', 'RETIRO DE AGUAS REDISUALES', 7000, { canal: 'CLIENTE NEVO' }), fila(12, 'symrise', 'retiro de agua residual', 27510)];
  [s, j] = await pedir('POST', '/generador/importar', A, { filas: nuevas, cobrado: true });
  revisa(s === 201 && j.importadas === 2, 'un archivo nuevo con los mismos nombres mal escritos se carga sin preguntar', [s, j.importadas, j.por_resolver]);
  const [, res2] = await pedir('GET', '/finanzas/resumen', A);
  revisa(Math.abs(res2.por_cobrar - 118934.8) < 0.01, 'cargados como cobrados no suben lo por cobrar', res2.por_cobrar);

  seccion('5. Errores que se marcan');
  const malas = [fila(21, 'SYMRISE', 'RETIRO DE AGUA RESIDUAL', 1000, { fecha: 'JUNIO' }), fila(22, 's', 'RETIRO DE AGUA RESIDUAL', 1000), fila(23, 'SYMRISE', 'RETIRO DE AGUA RESIDUAL', 1000, { iva: 50 }),
    fila(24, 'SYMRISE', '', '', { iva: '', total: '' }), fila(25, 'SYMRISE', 'RETIRO DE AGUA RESIDUAL', 1000, { id_cliente: 'CLI-9999' }), fila(26, 'SYMRISE', 'RETIRO DE AGUA RESIDUAL', 1000, { fecha: '2099-01-01' })];
  [s, j] = await pedir('POST', '/generador/importar?simular=1', A, { filas: malas });
  const err = k => j.errores.find(e => e.fila === 'SEPTIEMBRE #' + k)?.errores.join(' | ') || '';
  revisa(/FECHA/.test(err(21)), 'fecha escrita como «JUNIO»', err(21));
  revisa(/corto/.test(err(22)), 'cliente «s»', err(22));
  revisa(/16 %/.test(err(23)), 'IVA que no es 16 % ni 0', err(23));
  revisa(/SUBTOTAL vacío/.test(err(24)) && /CONCEPTO vacío/.test(err(24)), 'renglón sin producto ni importe', err(24));
  revisa(/no existe/.test(err(25)), 'ID CLIENTE que no existe', err(25));
  revisa(/futuro/.test(err(26)), 'fecha en el futuro', err(26));
  [s, j] = await pedir('POST', '/generador/importar', A, { filas: [...malas, fila(27, 'SYMRISE', 'RETIRO DE AGUA RESIDUAL', 1000)], cobrado: true });
  revisa(j.importadas === 0, 'con un error no se carga ningún renglón (todo o nada)');

  { const [si, ri] = await pedir('GET', '/admin/integridad', A); const malos = (ri.resultados || []).filter(r => r.gravedad === 'error' && r.total); revisa(si === 200 && ri.errores === 0, 'al terminar, la revisión de integridad no encuentra errores en los datos', malos.map(r => r.titulo + ': ' + JSON.stringify(r.casos.slice(0, 2)))); }
  revisa(!/uncaughtException|Error en |TypeError|SqliteError|RangeError|ReferenceError/.test(salida), 'el servidor no registró errores internos', salida.split('\n').filter(l => /Error/.test(l)).slice(0, 6));
  console.log(`\n${n - malos.length}/${n} correctas`);
  if (malos.length) console.log('FALLAS:\n- ' + malos.join('\n- '));
  srv.kill(); await espera(300); fs.rmSync(dir, { recursive: true, force: true });
  process.exit(malos.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(salida.slice(-2000)); srv.kill(); process.exit(1); });
