const BASE = 'http://localhost:3210/api';
let fallos = 0, pruebas = 0;

function assert(cond, msg, extra) {
  pruebas++;
  if (!cond) { fallos++; console.log(`❌ FALLA: ${msg}`, extra !== undefined ? JSON.stringify(extra) : ''); }
  else console.log(`✅ ${msg}`);
}
async function call(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

async function main() {
  console.log('=== 1. Catálogos ===');
  let r = await call('GET', '/servicios');
  assert(r.status === 200 && r.data.length > 0, 'GET /servicios OK');
  r = await call('GET', '/canales');
  assert(r.status === 200 && r.data.every(c => 'responsable_default_id' in c), 'GET /canales con responsable_default_id');
  r = await call('GET', '/usuarios');
  assert(r.status === 200 && r.data.length === 4, 'GET /usuarios (4 semilla)');

  console.log('\n=== 2. Validaciones de alta ===');
  r = await call('POST', '/leads', {});
  assert(r.status === 400, 'Sin teléfono → 400');
  r = await call('POST', '/leads', { telefono: '123' });
  assert(r.status === 400, 'Teléfono de 3 dígitos → 400 (rechazado en servidor)');
  r = await call('POST', '/leads', { telefono: '9511110000', canal_id: 9999, servicio_id: 9999, responsable_id: 9999 });
  assert(r.status === 400, 'IDs de catálogo inexistentes → 400 controlado, sin crash');
  r = await call('GET', '/servicios');
  assert(r.status === 200, 'El servidor sigue vivo tras el intento anterior');

  console.log('\n=== 3. Normalización de teléfono ===');
  r = await call('POST', '/leads', { telefono: '951-123-9999', nombre: 'Cliente A' });
  assert(r.status === 201, 'Alta con formato "951-123-9999"');
  const clienteA = r.data.cliente_id, leadA1 = r.data.id;

  r = await call('GET', '/leads/buscar-telefono/9511239999');
  assert(r.data.cliente && r.data.cliente.id === clienteA, 'Formato limpio encuentra al mismo cliente');
  r = await call('GET', '/leads/buscar-telefono/(951) 123-9999');
  assert(r.data.cliente && r.data.cliente.id === clienteA, 'Formato con paréntesis encuentra al mismo cliente');
  r = await call('POST', '/leads', { telefono: '  9511239999  ' });
  assert(r.status === 409, 'Mismo teléfono con espacios, solicitud abierta → 409');
  r = await call('POST', '/leads', { telefono: '+52 1 951 123 9999' });
  assert(r.status === 409, 'Teléfono con +52 delante, mismos 10 dígitos → mismo cliente (409)');

  console.log('\n=== 4. Ciclo de recontratación ===');
  r = await call('PUT', `/leads/${leadA1}`, { estatus: 'ganado' });
  assert(r.status === 200, 'Cerrar 1a compra de cliente A');
  r = await call('POST', '/leads', { telefono: '9511239999', canal_id: 1, servicio_id: 1 });
  assert(r.status === 201, 'Con la anterior cerrada, cliente A puede recomprar (2a vez)');
  const leadA2 = r.data.id;
  r = await call('GET', `/leads/${leadA2}`);
  assert(r.data.veces_contratado === 2, 'veces_contratado = 2', r.data.veces_contratado);
  assert(r.data.otras_solicitudes.length === 1, 'otras_solicitudes trae 1 registro previo');
  assert(r.data.cliente_id === clienteA, 'Mismo cliente_id en la 2a compra');

  r = await call('PUT', `/leads/${leadA2}`, { estatus: 'perdido' });
  r = await call('POST', '/leads', { telefono: '9511239999' });
  assert(r.status === 201, 'Estatus "perdido" (no solo ganado) también habilita recompra (3a vez)');
  r = await call('GET', `/leads/${r.data.id}`);
  assert(r.data.veces_contratado === 3, 'veces_contratado = 3 tras la 3a compra', r.data.veces_contratado);

  console.log('\n=== 5. Edición de lead ===');
  r = await call('PUT', '/leads/999999', { nombre: 'x' });
  assert(r.status === 404, 'PUT a lead inexistente → 404');
  r = await call('POST', '/leads', { telefono: '9515550001', nombre: 'Cliente Edit' });
  const leadEdit = r.data.id;
  r = await call('PUT', `/leads/${leadEdit}`, {});
  assert(r.status === 400, 'PUT sin campos → 400');
  r = await call('PUT', `/leads/${leadEdit}`, { etapa: 3 });
  assert(r.status === 200 && r.data.etapa === 3, 'Cambio de etapa aplicado');
  r = await call('GET', `/leads/${leadEdit}`);
  assert(!('historial' in r.data) && r.data.etapa === 3, 'Detalle sin historial conserva la etapa');
  await call('PUT', `/leads/${leadEdit}`, { etapa: 3 });
  r = await call('GET', `/leads/${leadEdit}`);
  assert(r.data.etapa === 3, 'Repetir la misma etapa conserva el estado');

  console.log('\n=== 6. Validaciones estrictas (antes crasheaban o pasaban silenciosas) ===');
  r = await call('PUT', `/leads/${leadEdit}`, { etapa: 9 });
  assert(r.status === 400, 'Etapa fuera de rango (9) → 400 explícito');
  r = await call('PUT', `/leads/${leadEdit}`, { estatus: 'lo_que_sea' });
  assert(r.status === 400, 'Estatus inválido → 400 explícito');
  r = await call('PUT', `/leads/${leadEdit}`, { canal_id: 8888 });
  assert(r.status === 400, 'canal_id inexistente en edición → 400');

  console.log('\n=== 7. Historial y alertas ===');
  r = await call('POST', `/leads/${leadEdit}/historial`, { texto: '' });
  assert(r.status === 400, 'Historial sin texto → 400');
  r = await call('POST', `/leads/${leadEdit}/historial`, { tipo: 'alerta', texto: 'Llamar mañana' });
  assert(r.status === 400, 'Alerta sin fecha_alerta → 400 (antes se guardaba sin fecha)');
  r = await call('POST', `/leads/${leadEdit}/historial`, { tipo: 'alerta', texto: 'Llamar en 2 días', fecha_alerta: '2026-09-05 10:00:00' });
  assert(r.status === 201, 'Alerta con fecha válida se crea');
  const alertaId = r.data.id;
  r = await call('PUT', `/historial/${alertaId}/resolver`);
  assert(r.status === 200, 'Resolver alerta existente → 200');
  r = await call('PUT', `/historial/999999/resolver`);
  assert(r.status === 404, 'Resolver historial inexistente → 404 (antes daba 200 falso)');

  console.log('\n=== 8. Búsquedas con entradas raras ===');
  r = await call('GET', '/leads/buscar-telefono/abc');
  assert(r.status === 200 && r.data.cliente === null, 'Teléfono no numérico no crashea');
  r = await call('GET', '/leads/buscar-telefono/12');
  assert(r.status === 200 && r.data.cliente === null, 'Teléfono muy corto no crashea');

  console.log('\n=== 9. Filtros de listado ===');
  r = await call('GET', '/leads?etapa=1');
  assert(r.data.every(l => l.etapa === 1), 'Filtro etapa=1 correcto');
  r = await call('GET', '/leads?estatus=ganado');
  assert(r.data.every(l => l.estatus === 'ganado'), 'Filtro estatus=ganado correcto');
  r = await call('GET', `/leads?q=${clienteA}`);
  assert(r.status === 200, 'Búsqueda por ID de cliente no truena');
  r = await call('GET', '/leads?responsable_id=9999');
  assert(r.status === 200 && r.data.length === 0, 'responsable_id inexistente → vacío, no error');

  console.log('\n=== 10. Concurrencia: mismo teléfono, 2 altas simultáneas ===');
  const telRace = '9517778888';
  const [ra, rb] = await Promise.all([
    call('POST', '/leads', { telefono: telRace, nombre: 'Race A' }),
    call('POST', '/leads', { telefono: telRace, nombre: 'Race B' })
  ]);
  const statusesRace = [ra.status, rb.status].sort();
  assert(JSON.stringify(statusesRace) === JSON.stringify([201, 409]), 'Una gana (201), la otra se bloquea (409) — no se crean 2 clientes', statusesRace);

  console.log('\n=== 11. Sincronización de teléfono al editar ===');
  const telNuevo = '9513332222';
  r = await call('POST', '/leads', { telefono: '9514445555', nombre: 'Sync Test' });
  const leadSync = r.data;
  r = await call('PUT', `/leads/${leadSync.id}`, { telefono: telNuevo });
  assert(r.status === 200, 'Editar teléfono responde 200');
  r = await call('GET', `/leads/buscar-telefono/${telNuevo}`);
  assert(r.data.cliente && r.data.cliente.id === leadSync.cliente_id, 'Cliente localizable por el teléfono NUEVO (tabla clientes sincronizada)');

  r = await call('POST', '/leads', { telefono: '9518889999', nombre: 'Cliente Choque' });
  r = await call('PUT', `/leads/${r.data.id}`, { telefono: telNuevo });
  assert(r.status === 409, 'Editar teléfono a uno de OTRO cliente existente → 409 (evita fusionar clientes por error)');

  console.log(`\n=== RESUMEN FINAL: ${pruebas - fallos}/${pruebas} pruebas correctas, ${fallos} fallas reales ===`);
  process.exit(fallos > 0 ? 1 : 0);
}
main().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
