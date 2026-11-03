/* Facturación CFDI 4.0 · carga de clientes desde el CSV de factura.com (2026-11-03). El CSV es el catálogo de clientes que se descarga de factura.com
   (columnas UID, RFC, Razon_Social, Regimen, Calle, … CP, …, Nombre, Email, Email 2, Email 3, Telefono).
   Decisiones del usuario (2026-11-03):
   · NUNCA se crean clientes del CRM: solo se cargan los datos fiscales de clientes que YA existen. Los que no se encuentran quedan en una lista aparte.
   · Un RFC que viene repetido con distinto UID lo elige Dirección (no se adivina).
   · Lo que no se puede dar por bueno se deja VACÍO y se marca como incompleto (sin régimen, CP que no es de 5 números, régimen que no está en el catálogo
     del SAT, correo genérico de Saneadren): el sistema no timbra con datos incompletos. No se inventa ninguna clave del SAT; el uso del CFDI no viene en el
     CSV y se elige al timbrar.
   · Lo capturado a mano nunca se sobrescribe: si el cliente ya tiene datos fiscales con ese RFC, solo se completan los campos vacíos y el UID.
   · El UID es de la cuenta de factura.com de donde salió el CSV (producción o pruebas): se guarda con su entorno y solo se usa en ese entorno.
   Dos pasos: «planear» (solo lee: arma qué se ligaría con quién) y «aplicar» (vuelve a planear por su cuenta con el mismo CSV y las decisiones de Dirección,
   y lo guarda todo en una transacción: nada de lo que mande el navegador se da por bueno). */
const { validarRFC, normalizarRazonSocial } = require('./facturacion-validaciones');
// Igual que normalizarTelefono de db.js (aquí no se importa ese archivo: abriría la base real al cargar este módulo; así se prueba con una base en memoria).
function normalizarTelefono(tel) {
  const d = String(tel || '').replace(/\s*(ext\.?|extensi[oó]n|x)\s*\d{1,6}\s*$/i, '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('52')) return d.slice(2);
  if (d.length === 13 && (d.startsWith('521') || d.startsWith('044') || d.startsWith('045'))) return d.slice(3);
  return d;
}

const COLUMNAS = { uid: 'UID', rfc: 'RFC', razon: 'RAZON_SOCIAL', regimen: 'REGIMEN', cp: 'CP', email: 'EMAIL', nombre: 'NOMBRE', telefono: 'TELEFONO', ciudad: 'CIUDAD_MUNICIPIO', estado: 'ESTADO', calle: 'CALLE' };
const MAX_FILAS = 5000;
const CORREO_PROPIO = /@saneadren\.com\.mx$/i; // admon@ y contabilidad@ se usaron como relleno: no son el correo del cliente

/** CSV con comillas, comillas dobles escapadas y saltos de línea dentro de un campo. Devuelve filas de arreglos. */
function leerCsv(texto) {
  const filas = []; let fila = [], campo = '', entre = false;
  const t = String(texto ?? '').replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (entre) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else entre = false; } else campo += c;
    } else if (c === '"') entre = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter(f => f.some(x => String(x).trim() !== ''));
}

const sinAcentos = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Llave para comparar nombres: sin acentos, sin comillas ni puntuación y SIN régimen societario (S.A. DE C.V.…). */
const llave = s => sinAcentos(normalizarRazonSocial(String(s ?? '').replace(/["':;]/g, ' ')).texto).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const PALABRAS_VACIAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'E', 'EN', 'SA', 'CV', 'RL', 'SERVICIOS', 'GRUPO', 'COMERCIALIZADORA']);
const palabras = s => new Set(llave(s).split(' ').filter(p => p.length >= 3 && !PALABRAS_VACIAS.has(p)));

/** Lo que sí se puede guardar de una fila del CSV, ya limpio, y lo que quedó incompleto (con el porqué). */
function limpiarFila(f, regimenesSat) {
  const razon = normalizarRazonSocial(String(f.razon ?? '').replace(/^[\s"':;]+|[\s"':;]+$/g, '').replace(/""/g, '"'));
  const incompleto = [];
  let regimen = String(f.regimen ?? '').trim();
  if (!regimen) { incompleto.push('sin régimen fiscal'); regimen = ''; }
  else if (!/^\d{3}$/.test(regimen) || (regimenesSat && !regimenesSat.has(regimen))) { incompleto.push(`régimen ${regimen} no válido`); regimen = ''; }
  let cp = String(f.cp ?? '').replace(/\s+/g, '');
  if (!/^\d{5}$/.test(cp) || /^0{5}$/.test(cp)) { incompleto.push('CP fiscal no válido'); cp = ''; }
  let correo = String(f.email ?? '').trim();
  if (!correo) { incompleto.push('sin correo'); } else if (CORREO_PROPIO.test(correo)) { incompleto.push('correo genérico de Saneadren: se dejó vacío'); correo = ''; }
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo) || correo.length > 254) { incompleto.push('correo no válido'); correo = ''; }
  if (!razon.texto) incompleto.push('sin razón social');
  return { razon_social: razon.texto.slice(0, 254), regimen, cp, correo, incompleto };
}

/**
 * Lee el CSV y propone qué se ligaría con quién, SIN tocar la base.
 * Devuelve { error } o { unidades, resumen, invalidos }. Una «unidad» es un RFC (con una o varias filas si viene repetido).
 */
function planear(db, csv) {
  const crudas = leerCsv(csv);
  if (!crudas.length) return { error: 'El archivo está vacío' };
  const cab = crudas[0].map(c => sinAcentos(c).trim().toUpperCase().replace(/\s+/g, '_'));
  const col = Object.fromEntries(Object.entries(COLUMNAS).map(([k, nombre]) => [k, cab.indexOf(nombre)]));
  const faltan = ['uid', 'rfc', 'razon', 'regimen', 'cp', 'email'].filter(k => col[k] < 0).map(k => COLUMNAS[k]);
  if (faltan.length) return { error: `No parece el CSV de clientes de factura.com: faltan las columnas ${faltan.join(', ')}` };
  if (crudas.length - 1 > MAX_FILAS) return { error: `El archivo tiene más de ${MAX_FILAS} clientes: divídelo en partes` };
  const regs = db.prepare("SELECT clave FROM sat_catalogos WHERE catalogo = 'RegimenFiscal'").all();
  const regimenesSat = regs.length ? new Set(regs.map(r => r.clave)) : null;
  const dato = (f, k) => (col[k] >= 0 ? String(f[col[k]] ?? '').trim() : '');

  const invalidos = [], porRfc = new Map(), vistosUid = new Set();
  crudas.slice(1).forEach((f, i) => {
    const uid = dato(f, 'uid'), v = validarRFC(dato(f, 'rfc'));
    if (!uid) return invalidos.push({ linea: i + 2, rfc: v.rfc, motivo: 'Sin UID de factura.com' });
    if (!v.ok) return invalidos.push({ linea: i + 2, rfc: v.rfc, motivo: v.mensaje });
    if (v.tipo === 'publico_general' || v.tipo === 'extranjero') return invalidos.push({ linea: i + 2, rfc: v.rfc, motivo: 'RFC genérico (público en general o extranjero): se factura sin ligarlo a un cliente' });
    if (vistosUid.has(uid)) return invalidos.push({ linea: i + 2, rfc: v.rfc, motivo: 'UID repetido en el archivo' });
    vistosUid.add(uid);
    const limpio = limpiarFila({ razon: dato(f, 'razon'), regimen: dato(f, 'regimen'), cp: dato(f, 'cp'), email: dato(f, 'email') }, regimenesSat);
    const fila = { uid, rfc: v.rfc, ...limpio, contacto: dato(f, 'nombre'), telefono: normalizarTelefono(dato(f, 'telefono')), domicilio: [dato(f, 'calle'), dato(f, 'ciudad'), dato(f, 'estado')].filter(Boolean).join(', ') };
    if (!porRfc.has(v.rfc)) porRfc.set(v.rfc, []);
    porRfc.get(v.rfc).push(fila);
  });

  // Los clientes del CRM, para ligar: por RFC capturado, por teléfono del contacto y por nombre de la empresa (sin régimen societario).
  const clientes = db.prepare('SELECT id, nombre, empresa_contacto, telefono_normalizado, rfc FROM clientes').all().map(c => ({
    ...c, rfcN: validarRFC(c.rfc).rfc, nombres: [c.empresa_contacto, c.nombre].map(llave).filter(Boolean), palabras: new Set([...palabras(c.empresa_contacto), ...palabras(c.nombre)]) }));
  const fiscalesPorRfc = new Map();
  for (const f of db.prepare('SELECT cliente_id, rfc, uid_facturacom FROM clientes_fiscales').all()) {
    if (!fiscalesPorRfc.has(f.rfc)) fiscalesPorRfc.set(f.rfc, []); fiscalesPorRfc.get(f.rfc).push(f);
  }
  const etiqueta = c => ({ id: c.id, nombre: c.nombre || '', empresa: c.empresa_contacto || '' });

  const unidades = [];
  for (const [rfc, filas] of porRfc) {
    const nombresCsv = new Set(filas.flatMap(f => [llave(f.razon_social), llave(f.contacto)].filter(Boolean)));
    const palabrasCsv = new Set(filas.flatMap(f => [...palabras(f.razon_social)]));
    const telefonos = new Set(filas.map(f => f.telefono).filter(t => t.length === 10));
    const candidatos = new Map(); // id → { c, por, puntos }
    const suma = (c, por, puntos) => { const a = candidatos.get(c.id); if (!a || puntos > a.puntos) candidatos.set(c.id, { c, por, puntos }); };
    for (const c of clientes) {
      if (c.rfcN && c.rfcN === rfc) suma(c, 'RFC', 100);
      else if (telefonos.has(c.telefono_normalizado)) suma(c, 'teléfono', 90);
      else if (c.nombres.some(n => nombresCsv.has(n) && n.length >= 4)) suma(c, 'nombre igual', 80);
      else {
        // Parecido (nunca liga solo): al menos 2 palabras en común, o 1 si uno de los dos nombres es corto y esa palabra es la mitad o más de él.
        const comunes = [...c.palabras].filter(p => palabrasCsv.has(p)).length, corto = Math.min(c.palabras.size, palabrasCsv.size);
        if (comunes >= 2 || (comunes === 1 && corto && corto <= 2)) suma(c, 'nombre parecido', Math.min(75, 40 + 10 * comunes));
      }
    }
    const lista = [...candidatos.values()].sort((a, b) => b.puntos - a.puntos);
    const seguros = lista.filter(x => x.puntos >= 80);
    // Liga sola solo con UN candidato seguro (RFC, teléfono o nombre igual); con varios, o solo parecidos, decide Dirección.
    const auto = seguros.length === 1 ? seguros[0] : null;
    const yaTiene = (fiscalesPorRfc.get(rfc) || []).some(x => auto && x.cliente_id === auto.c.id);
    unidades.push({
      rfc, filas, repetido: filas.length > 1,
      tipo: auto ? 'auto' : lista.length ? 'dudoso' : 'sin_cliente',
      cliente: auto ? { ...etiqueta(auto.c), por: auto.por } : null,
      candidatos: auto ? [] : lista.slice(0, 5).map(x => ({ ...etiqueta(x.c), por: x.por })),
      ya_cargado: yaTiene,
    });
  }
  const cuenta = f => unidades.filter(f).length;
  return { unidades, invalidos, resumen: { filas: crudas.length - 1, rfc_distintos: unidades.length, automaticos: cuenta(u => u.tipo === 'auto'), por_elegir: cuenta(u => u.tipo === 'dudoso'),
    sin_cliente: cuenta(u => u.tipo === 'sin_cliente'), repetidos: cuenta(u => u.repetido), ya_cargados: cuenta(u => u.ya_cargado), invalidos: invalidos.length,
    incompletos: cuenta(u => u.filas.every(f => f.incompleto.length)) } };
}

/** La fila que se usa de una unidad: la única, o la que Dirección eligió entre las repetidas. */
const filaElegida = (u, elegidos) => (u.filas.length === 1 ? u.filas[0] : u.filas.find(f => f.uid === String(elegidos?.[u.rfc] ?? '')) || null);

/**
 * Guarda los datos fiscales. decisiones: { entorno: 'prod'|'sandbox', ligas: { RFC: cliente_id | null }, elegidos: { RFC: uid } }.
 * Todo en una transacción; lo que no se puede (sin elegir, UID en uso, cliente que no existe) se salta y se cuenta con su motivo. Devuelve { guardados, completados, saltados }.
 */
function aplicar(db, csv, decisiones = {}, usuarioId = null) {
  const entorno = decisiones.entorno === 'sandbox' ? 'sandbox' : 'prod';
  const plan = planear(db, csv); if (plan.error) return { error: plan.error };
  const r = { guardados: 0, completados: 0, ya_estaban: 0, saltados: [] };
  const salta = (u, motivo) => r.saltados.push({ rfc: u.rfc, motivo });
  db.transaction(() => {
    for (const u of plan.unidades) {
      const fila = filaElegida(u, decisiones.elegidos);
      if (!fila) { salta(u, 'Falta elegir cuál de los clientes repetidos de factura.com usar'); continue; }
      let clienteId = null;
      if (u.tipo === 'auto') clienteId = u.cliente.id;
      else if (decisiones.ligas && Number.isInteger(Number(decisiones.ligas[u.rfc])) && Number(decisiones.ligas[u.rfc]) > 0) clienteId = Number(decisiones.ligas[u.rfc]);
      if (!clienteId) { salta(u, u.tipo === 'sin_cliente' ? 'No hay un cliente del CRM con ese nombre o RFC' : 'No se eligió a qué cliente del CRM ligarlo'); continue; }
      if (!db.prepare('SELECT 1 FROM clientes WHERE id = ?').get(clienteId)) { salta(u, 'El cliente elegido ya no existe'); continue; }
      const otro = db.prepare('SELECT cliente_id, rfc FROM clientes_fiscales WHERE uid_facturacom = ?').get(fila.uid);
      const existente = db.prepare('SELECT * FROM clientes_fiscales WHERE cliente_id = ? AND rfc = ?').get(clienteId, u.rfc);
      if (otro && !(existente && otro.cliente_id === existente.cliente_id && otro.rfc === existente.rfc)) { salta(u, 'Ese UID de factura.com ya está ligado a otros datos fiscales'); continue; }
      if (existente) {
        // Lo capturado a mano no se toca: solo se llenan los campos vacíos y el UID.
        const cambios = {};
        if (!existente.uid_facturacom) { cambios.uid_facturacom = fila.uid; cambios.uid_entorno = entorno; }
        for (const k of ['razon_social', 'regimen', 'cp', 'correo']) if (!existente[k] && fila[k]) cambios[k] = fila[k];
        if (!Object.keys(cambios).length) { r.ya_estaban++; continue; }
        db.prepare(`UPDATE main.clientes_fiscales SET ${Object.keys(cambios).map(k => k + ' = ?').join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`).run(...Object.values(cambios), existente.id);
        r.completados++; continue;
      }
      const primero = !db.prepare('SELECT 1 FROM clientes_fiscales WHERE cliente_id = ? AND activo = 1').get(clienteId);
      db.prepare('INSERT INTO main.clientes_fiscales (cliente_id, rfc, razon_social, cp, regimen, uso_cfdi, correo, uid_facturacom, uid_entorno, predeterminado, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(clienteId, u.rfc, fila.razon_social, fila.cp, fila.regimen, '', fila.correo, fila.uid, entorno, primero ? 1 : 0, usuarioId);
      r.guardados++;
    }
  })();
  return r;
}

module.exports = { leerCsv, planear, aplicar, llave, limpiarFila, filaElegida };
