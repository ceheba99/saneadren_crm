// Alcance por sucursal de cada petición: qué sucursales puede ver la persona y en cuál se registra lo nuevo.
// Se guarda en AsyncLocalStorage para que la base (vistas temporales con en_alcance) lo lea sin que cada ruta
// tenga que pasarlo. Sin alcance (código fuera de una petición después de activar los candados) NO se ve nada:
// lo que necesite verlo todo (revisión de integridad, tareas internas) debe pedirlo con global().
const { AsyncLocalStorage } = require('node:async_hooks');

const als = new AsyncLocalStorage();
const SIN_ACCESO = Object.freeze({ todo: false, ids: new Set(), alta: null });
const TODO = Object.freeze({ todo: true, ids: new Set(), alta: null });
let matriz = null; // sucursal por defecto (la primera / matriz)

module.exports = {
  als, SIN_ACCESO, TODO,
  actual: () => als.getStore() || SIN_ACCESO,
  correr: (alcance, fn) => als.run(alcance || SIN_ACCESO, fn),
  global: fn => als.run(TODO, fn),
  // ¿Esta fila (por su sucursal) está dentro del alcance de la petición?
  ve: sucursalId => { const a = als.getStore(); if (!a) return false; return a.todo || (sucursalId != null && a.ids.has(Number(sucursalId))); },
  // Qué ve el ROL en cada área dentro de sus sucursales (permisos.js): 0 nada, 1 lo suyo, 2 toda su sucursal.
  // Sin niveles (Dirección, tareas internas con global()) ve todo; sin alcance, nada.
  nivel: area => { const a = als.getStore(); if (!a) return 0; if (!a.niveles) return 2; return a.niveles[area] ?? 0; },
  // Quién pide (para «lo suyo»).
  usuario: () => als.getStore()?.usuarioId ?? null,
  // Sucursal donde se registra lo nuevo en esta petición.
  sucursalAlta: () => { const a = als.getStore(); if (!a) return matriz; return a.alta ?? (a.todo ? matriz : null); },
  fijarMatriz: id => { matriz = id; },
  matriz: () => matriz,
};
