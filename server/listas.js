// «Listas desplegables» (pedido de Dirección, 2026-11-13): un solo apartado, solo para Dirección (el admin), con TODAS
// las listas del sistema (server/listas-inventario.js) y la edición de las que estaban escritas fijas en el código sin
// que ningún cálculo dependa de ellas (DEFINICIONES, abajo).
//  · Cómo funciona: cada lista editable es la MISMA constante que ya usaba su módulo (PUESTOS de personal.js, RUBROS de
//    marketing-control.js…). Aquí se cambia esa constante en su lugar, al arrancar y en cada cambio: la validación, los
//    nombres que salen en reportes y lo que reciben las pantallas se actualizan sin tocar cada módulo.
//  · Agregar, renombrar, ordenar y ocultar. Nunca se borra: «ocultar» quita la opción de las listas para capturar,
//    pero lo ya guardado con ella se sigue viendo y se puede volver a guardar (public/listas.js la esconde al abrir la lista).
//  · Listas cuya opción guardada ES el texto (puestos, contratos, licencias, carpetas): renombrar cambia también lo ya
//    guardado («migrar»), en una sola transacción, para que nada quede con el nombre viejo.
//  · «protegidas»: opciones que el código usa por su nombre; no se renombran ni se ocultan.
//  · Cada cambio queda en la bitácora (Catálogos) con lo que cambió.
const CxpExcel = require('../public/cxp-excel.js');
const { GRUPOS, INVENTARIO } = require('./listas-inventario');
const { escanear } = require('./listas-escaneo');

const MAX_OPCIONES = 100;
const llave = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const limpio = t => String(t ?? '').replace(/\s+/g, ' ').trim();
const excelDe = t => llave(t).toUpperCase();

// tipo: textos (arreglo de textos; lo guardado es el texto) · mapa (clave → nombre) · mapa_obj (clave → { nombre, … })
//       · tipos_gasto (arreglo [clave, nombre, como va en el Excel] de public/cxp-excel.js).
function definiciones() {
  const personal = require('./personal'), marketing = require('./marketing'), mkControl = require('./marketing-control');
  const creditos = require('./creditos'), expediente = require('./expediente-oc');
  return [
    { clave: 'puestos', nombre: 'Puestos del personal', tipo: 'textos', ref: personal.PUESTOS, max: 60,
      migrar: [['personal', 'puesto'], ['precios_hora_puesto', 'puesto'], ['reglas_puntualidad', 'puesto']],
      protegidas: { Supervisor: 'El reloj checador deja a quien tiene este puesto imprimir cualquier orden: el nombre debe quedarse igual.' } },
    { clave: 'contratos', nombre: 'Tipos de contrato', tipo: 'textos', ref: personal.CONTRATOS, max: 60, migrar: [['personal', 'tipo_contrato']] },
    { clave: 'licencias', nombre: 'Tipos de licencia de manejo', tipo: 'textos', ref: personal.LICENCIAS, max: 40, migrar: [['personal', 'licencia_tipo']] },
    { clave: 'documentos_personal', nombre: 'Documentos del expediente del personal', tipo: 'mapa', ref: personal.DOCUMENTOS, max: 60 },
    { clave: 'tipos_gasto', nombre: 'Tipo de gasto (cada cuánto se repite)', tipo: 'tipos_gasto', ref: CxpExcel.TIPOS_GASTO, max: 40 },
    { clave: 'tipos_credito', nombre: 'Tipos de crédito', tipo: 'mapa', ref: creditos.TIPOS, max: 60 },
    { clave: 'documentos_oc', nombre: 'Documentos de la orden de compra', tipo: 'mapa_obj', ref: expediente.TIPOS, max: 60,
      nuevo: { admite: ['pdf', 'jpg', 'png', 'xml'] } },
    { clave: 'formatos_mk', nombre: 'Formatos de publicación', tipo: 'mapa', ref: marketing.FORMATOS, max: 60 },
    { clave: 'rubros_mk', nombre: 'Rubros de gasto de marketing', tipo: 'mapa', ref: mkControl.RUBROS, max: 60 },
    { clave: 'carpetas_mk', nombre: 'Carpetas de la biblioteca de marketing', tipo: 'textos', ref: marketing.CARPETAS, max: 40,
      migrar: [['biblioteca_marketing', 'carpeta']],
      protegidas: { Otros: 'Es la carpeta donde cae un archivo que se sube sin carpeta.' } },
  ];
}

// Las opciones tal como están en la constante: [{ clave, nombre, extra }].
function leerConstante(d) {
  if (d.tipo === 'textos') return d.ref.map(t => ({ clave: t, nombre: t }));
  if (d.tipo === 'tipos_gasto') return d.ref.map(([k, t, e]) => ({ clave: k, nombre: t, excel: e }));
  if (d.tipo === 'mapa_obj') return Object.entries(d.ref).map(([k, o]) => ({ clave: k, nombre: o.nombre, obj: { ...o } }));
  return Object.entries(d.ref).map(([k, t]) => ({ clave: k, nombre: t }));
}

module.exports = function listas(app, db, h, { permisos, audit }) {
  db.exec(`CREATE TABLE IF NOT EXISTS listas_editadas (
    lista TEXT PRIMARY KEY,
    opciones_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    actualizado_por INTEGER REFERENCES usuarios(id),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);

  const DEFS = definiciones();
  const DEF = Object.fromEntries(DEFS.map(d => [d.clave, d]));
  // Las opciones de fábrica (lo escrito en el código), antes de aplicar nada.
  for (const d of DEFS) d.fabrica = leerConstante(d);

  const guardado = clave => {
    const r = db.prepare('SELECT * FROM listas_editadas WHERE lista = ?').get(clave);
    return r ? { version: r.version, opciones: JSON.parse(r.opciones_json), updated_at: r.updated_at } : null;
  };

  // Lo vigente: lo que guardó Dirección, más las opciones de fábrica que aún no conocía (las que agregue el código después).
  function vigentes(d) {
    const g = guardado(d.clave), lista = [];
    const deFabrica = new Map(d.fabrica.map(f => [f.clave, f]));
    const cubiertas = new Set();
    for (const x of g ? g.opciones : []) {
      const origen = x.nueva ? null : deFabrica.get(x.de ?? x.clave);
      if (!origen && !x.nueva) continue; // ya no existe en el código y no la agregó Dirección
      if (origen) cubiertas.add(origen.clave);
      lista.push({ clave: x.clave, nombre: x.nombre, oculta: !!x.oculta, nueva: !origen, de: origen ? origen.clave : undefined, fabrica: origen || null });
    }
    for (const f of d.fabrica) if (!cubiertas.has(f.clave)) lista.push({ clave: f.clave, nombre: f.nombre, oculta: false, nueva: false, de: f.clave, fabrica: f });
    return { version: g ? g.version : 0, opciones: lista };
  }

  // Pone las opciones vigentes en la constante del módulo (la misma referencia que usa todo el sistema).
  function aplicar(d) {
    const { opciones } = vigentes(d);
    if (d.tipo === 'textos') { d.ref.splice(0, d.ref.length, ...opciones.map(x => x.clave)); return; }
    if (d.tipo === 'tipos_gasto') { CxpExcel.ponerTiposGasto(opciones.map(x => [x.clave, x.nombre, x.fabrica?.excel || excelDe(x.nombre)])); return; }
    for (const k of Object.keys(d.ref)) delete d.ref[k];
    for (const x of opciones) d.ref[x.clave] = d.tipo === 'mapa_obj' ? { ...(x.fabrica?.obj || d.nuevo), nombre: x.nombre } : x.nombre;
  }
  for (const d of DEFS) aplicar(d);

  const SOLO_DIRECCION = { error: 'Las listas desplegables las cambia solo Dirección', codigo: 'LISTAS_SOLO_DIRECCION' };
  const claveNueva = (d, nombre, usadas) => {
    const base = 'x_' + (llave(nombre).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'opcion');
    let k = base; for (let i = 2; usadas.has(k); i++) k = base + '_' + i;
    return k;
  };

  // Para todos con sesión: qué opciones están ocultas en cada lista de captura (la pantalla las esconde al abrirla)
  // y el tipo de gasto vigente (la pantalla tiene su propia copia de public/cxp-excel.js).
  app.get('/api/listas', h((req, res) => {
    const ocultas = {};
    for (const e of INVENTARIO.filter(x => x.lista)) {
      const o = vigentes(DEF[e.lista]).opciones.filter(x => x.oculta).map(x => x.clave);
      if (o.length) for (const s of e.selects) ocultas[s] = o;
    }
    res.json({ ocultas, tipos_gasto: CxpExcel.TIPOS_GASTO });
  }));

  // Pantalla «Listas desplegables» (solo Dirección): el inventario completo y las listas editables.
  const total = (() => { try { return escanear().length; } catch { return null; } })();
  app.get('/api/listas/admin', h((req, res) => {
    if (!permisos.direccion(req)) return res.status(403).json(SOLO_DIRECCION);
    const editables = {};
    for (const d of DEFS) {
      const v = vigentes(d);
      editables[d.clave] = { nombre: d.nombre, version: v.version, max: d.max, renombrar_cambia_guardado: !!d.migrar,
        opciones: v.opciones.map(x => ({ clave: x.clave, nombre: x.nombre, oculta: x.oculta, nueva: x.nueva,
          de_fabrica: x.fabrica && x.fabrica.nombre !== x.nombre ? x.fabrica.nombre : null, protegida: d.protegidas?.[x.de] || null })) };
    }
    res.json({ total, grupos: GRUPOS, inventario: INVENTARIO.map(e => ({ ...e, cuantas: e.selects.length + (e.filtros || []).length })), editables });
  }));

  // Guardar una lista completa, en el orden en que quedó: [{ clave (vacía si es nueva), nombre, oculta }].
  app.put('/api/listas/:lista', h((req, res) => {
    if (!permisos.direccion(req)) return res.status(403).json(SOLO_DIRECCION);
    const d = DEF[req.params.lista]; if (!d) return res.status(404).json({ error: 'Esa lista no se edita aquí' });
    const { version, opciones } = req.body || {};
    const actual = vigentes(d);
    if (version !== undefined && Number(version) !== actual.version) return res.status(409).json({ error: 'Alguien más cambió esta lista mientras la editabas. Vuelve a abrirla para ver cómo quedó.', codigo: 'LISTA_CAMBIADA' });
    if (!Array.isArray(opciones) || !opciones.length) return res.status(400).json({ error: 'La lista necesita al menos una opción' });
    if (opciones.length > MAX_OPCIONES) return res.status(400).json({ error: `Una lista puede tener hasta ${MAX_OPCIONES} opciones` });
    const porClave = new Map(actual.opciones.map(x => [x.clave, x]));
    const nombresActuales = new Set(actual.opciones.map(x => x.nombre)); // las de fábrica pueden traer «/»
    const vistas = new Set(), nombres = new Set(), usadas = new Set(actual.opciones.map(x => x.clave)), nueva = [];
    for (const o of opciones) {
      const nombre = limpio(o?.nombre);
      if (!nombre) return res.status(400).json({ error: 'Hay una opción sin nombre' });
      if (nombre.length > d.max) return res.status(400).json({ error: `«${nombre.slice(0, 30)}…»: cada opción puede tener hasta ${d.max} caracteres` });
      // En las listas donde lo guardado es el texto (carpetas, puestos…) tampoco va «/».
      if (!nombresActuales.has(nombre) && (/[<>{}[\]\\]/.test(nombre) || (d.tipo === 'textos' && nombre.includes('/')))) return res.status(400).json({ error: `«${nombre}»: no uses < > { } [ ] \\${d.tipo === 'textos' ? ' ni /' : ''}` });
      if (nombres.has(llave(nombre))) return res.status(409).json({ error: `«${nombre}» está repetida en la lista` });
      nombres.add(llave(nombre));
      const oculta = !!o.oculta;
      if (o.clave === undefined || o.clave === null || o.clave === '') {
        const clave = d.tipo === 'textos' ? nombre : claveNueva(d, nombre, usadas);
        // Un texto nuevo no puede llamarse como una opción que existe o existió (se confundiría con lo ya guardado).
        if (d.tipo === 'textos' && (usadas.has(clave) || d.fabrica.some(f => f.clave === clave))) return res.status(409).json({ error: `«${nombre}» ya existe o existió en esta lista: usa otro nombre` });
        usadas.add(clave); vistas.add(clave);
        nueva.push({ clave, nombre, oculta, nueva: true });
        continue;
      }
      const x = porClave.get(String(o.clave));
      if (!x) return res.status(400).json({ error: `La opción «${nombre}» no es de esta lista` });
      if (vistas.has(x.clave)) return res.status(400).json({ error: `La opción «${x.nombre}» viene dos veces` });
      vistas.add(x.clave);
      const prot = d.protegidas?.[x.de];
      if (prot && (nombre !== x.nombre || oculta)) return res.status(400).json({ error: `«${x.nombre}» no se puede renombrar ni ocultar: ${prot}` });
      const clave = d.tipo === 'textos' ? nombre : x.clave;
      nueva.push({ clave, nombre, oculta, nueva: x.nueva, de: x.de, antes: x.clave });
    }
    const faltan = actual.opciones.filter(x => !vistas.has(x.clave));
    if (faltan.length) return res.status(400).json({ error: `Las opciones no se borran: oculta «${faltan[0].nombre}» si ya no se usa` });
    if (!nueva.some(x => !x.oculta)) return res.status(400).json({ error: 'Debe quedar al menos una opción visible' });

    // Qué cambió (para la bitácora) y los renombres que cambian lo ya guardado.
    const cambios = [], renombres = [];
    for (const x of nueva) {
      const a = x.antes !== undefined ? porClave.get(x.antes) : null;
      if (!a) { cambios.push(`agregada «${x.nombre}»${x.oculta ? ' (oculta)' : ''}`); continue; }
      if (a.nombre !== x.nombre) { cambios.push(`«${a.nombre}» → «${x.nombre}»`); if (d.tipo === 'textos') renombres.push([a.clave, x.clave]); }
      if (a.oculta !== x.oculta) cambios.push(`«${x.nombre}» ${x.oculta ? 'oculta' : 'visible otra vez'}`);
    }
    const ordenAntes = actual.opciones.map(x => x.clave).join('|');
    if (nueva.filter(x => x.antes !== undefined).map(x => x.antes).join('|') !== ordenAntes) cambios.push('cambió el orden');
    if (!cambios.length) return res.json({ ok: true, sin_cambios: true, version: actual.version });

    let migrados = 0;
    db.transaction(() => {
      for (const [antes, despues] of renombres) for (const [tabla, col] of d.migrar || [])
        migrados += db.prepare(`UPDATE main.${tabla} SET ${col} = ? WHERE ${col} = ?`).run(despues, antes).changes;
      const json = JSON.stringify(nueva.map(({ clave, nombre, oculta, nueva: n, de }) => ({ clave, nombre, oculta, nueva: n, de })));
      db.prepare(`INSERT INTO listas_editadas (lista, opciones_json, version, actualizado_por) VALUES (?, ?, 1, ?)
        ON CONFLICT(lista) DO UPDATE SET opciones_json = excluded.opciones_json, version = version + 1, actualizado_por = excluded.actualizado_por, updated_at = datetime('now','localtime')`)
        .run(d.clave, json, req.usuarioSesion.id);
    })();
    aplicar(d);
    audit.registrar(req, 'catalogo', null, 'editado', `Lista «${d.nombre}»: ${cambios.join('; ')}${migrados ? ` (se actualizaron ${migrados} registros ya guardados)` : ''}`);
    res.json({ ok: true, version: vigentes(d).version, migrados });
  }));

  return { DEFS, vigentes };
};
