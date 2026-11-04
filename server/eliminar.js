// ELIMINAR USUARIOS Y SUCURSALES (2026-11-04, decidido con Dirección): solo Dirección.
//  · Si nunca se usó (ningún registro de ninguna tabla lo menciona), se BORRA de verdad.
//  · Si ya tiene registros (cotizaciones, cobros, bitácora, checadas…), se ARCHIVA: queda desactivado, desaparece de las
//    listas de Ajustes y su historial se conserva (borrarlo perdería quién hizo qué y el rastro del dinero).
//  · No se elimina la propia cuenta, el último Dirección ni la sucursal principal.
// Qué cuenta como «registro» se busca solo, en todas las tablas: así una tabla nueva queda cubierta sin tocar este archivo.
module.exports = function eliminar(app, db, h, { sesiones }) {
  const columnas = t => db.prepare(`PRAGMA table_info(${JSON.stringify(t)})`).all().map(c => c.name);
  const agregar = (t, col, def) => { if (!columnas(t).includes(col)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${def}`); };
  agregar('usuarios', 'archivado_at', 'TEXT');
  agregar('sucursales', 'archivado_at', 'TEXT');

  const P = app.locals.permisos, suc = app.locals.sucursales;
  const audit = (...a) => app.locals.auditoria?.registrar(...a);
  const tablas = () => db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(x => x.name);
  // Dónde aparece un id: [{ tabla, columna, n }]. «esColumna» elige qué columnas guardan ese tipo de id.
  function usos(id, esColumna, excluir) {
    const r = [];
    for (const t of tablas()) {
      if (excluir.includes(t)) continue;
      for (const c of columnas(t).filter(esColumna)) {
        const n = db.prepare(`SELECT COUNT(*) n FROM main.${JSON.stringify(t)} WHERE ${JSON.stringify(c)} = ?`).get(id).n;
        if (n) r.push({ tabla: t, columna: c, n });
      }
    }
    return r;
  }
  const resumen = lista => lista.slice(0, 6).map(u => `${u.tabla} (${u.n})`).join(', ') + (lista.length > 6 ? '…' : '');
  const soloDireccion = (req, res) => { if (P.direccion(req)) return false; res.status(403).json({ error: 'Eliminar usuarios y sucursales solo lo hace Dirección' }); return true; };

  // ---------- Usuarios ----------
  // Columnas que guardan un usuario: usuario_id, responsable_id, tecnico_id, …_por (quién registró, canceló, aprobó…).
  const DE_USUARIO = c => /^(usuario_id|responsable_id|tecnico_id|solicitante_id|responsable_default_id)$|_por$|_por_id$/.test(c);
  // Lo que es solo de su cuenta (sesiones, enlaces de correo, sucursales asignadas) se limpia al borrarla: no es historial.
  const DE_SU_CUENTA = ['usuarios', 'sesiones', 'tokens_cuenta', 'usuario_sucursales'];
  app.post('/api/usuarios/:id/eliminar', h((req, res) => {
    if (soloDireccion(req, res)) return;
    const u = db.prepare('SELECT * FROM main.usuarios WHERE id = ? AND archivado_at IS NULL').get(Number(req.params.id));
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (u.id === req.usuarioSesion.id) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    if (u.rol === 'admin' && db.prepare("SELECT COUNT(*) n FROM main.usuarios WHERE rol = 'admin' AND activo = 1 AND id <> ?").get(u.id).n === 0)
      return res.status(400).json({ error: 'No puedes eliminar al último usuario de Dirección' });
    const lista = usos(u.id, DE_USUARIO, DE_SU_CUENTA);
    if (lista.length) {
      db.transaction(() => {
        db.prepare("UPDATE main.usuarios SET activo = 0, archivado_at = datetime('now','localtime') WHERE id = ?").run(u.id);
        sesiones.revocarUsuario(u.id);
      })();
      audit(req, 'usuario', u.id, 'archivado', `${u.nombre}: tiene registros (${resumen(lista)}); se archivó para conservar su historial`);
      return res.json({ ok: true, resultado: 'archivado', mensaje: `${u.nombre} tiene registros en el sistema: se archivó (ya no entra ni aparece en las listas) y su historial se conserva.` });
    }
    db.transaction(() => {
      for (const t of ['sesiones', 'tokens_cuenta', 'usuario_sucursales']) db.prepare(`DELETE FROM main.${t} WHERE usuario_id = ?`).run(u.id);
      db.prepare('DELETE FROM main.usuarios WHERE id = ?').run(u.id);
    })();
    audit(req, 'usuario', u.id, 'eliminado', `${u.nombre} (${u.rol}${u.correo ? ' · ' + u.correo : ''}): nunca se usó; se borró`);
    res.json({ ok: true, resultado: 'eliminado', mensaje: `${u.nombre} se borró: nunca se había usado.` });
  }));

  // ---------- Sucursales ----------
  // Configuración propia de la sucursal (se limpia al borrarla): usuarios asignados, contadores de folio, series de
  // facturación y los horarios que el sistema le creó solo, si nadie los ha usado ni cambiado.
  const CONFIG = ['sucursales', 'usuario_sucursales', 'contadores_folio', 'series_factura', 'horarios'];
  const horariosEnUso = id => db.prepare(`SELECT COUNT(*) n FROM main.horarios h WHERE h.sucursal_id = ? AND (
      EXISTS (SELECT 1 FROM main.personal_horario ph WHERE ph.horario_id = h.id)
      OR EXISTS (SELECT 1 FROM main.horario_versiones v WHERE v.horario_id = h.id AND COALESCE(v.creado_por_nombre, '') <> 'Sistema'))`).get(id).n;
  app.post('/api/sucursales/:id/eliminar', h((req, res) => {
    if (soloDireccion(req, res)) return;
    const s = db.prepare('SELECT * FROM main.sucursales WHERE id = ? AND archivado_at IS NULL').get(Number(req.params.id));
    if (!s) return res.status(404).json({ error: 'Sucursal no encontrada' });
    if (s.id === db.prepare('SELECT MIN(id) id FROM main.sucursales').get().id) return res.status(400).json({ error: 'La sucursal principal no se elimina' });
    const lista = usos(s.id, c => c === 'sucursal_id', CONFIG);
    const enUso = horariosEnUso(s.id);
    if (enUso) lista.push({ tabla: 'horarios', columna: 'sucursal_id', n: enUso });
    if (lista.length) {
      db.prepare("UPDATE main.sucursales SET activo = 0, archivado_at = datetime('now','localtime') WHERE id = ?").run(s.id);
      suc.refrescar();
      audit(req, 'sucursal', s.id, 'archivada', `${s.nombre} (${s.clave}): tiene registros (${resumen(lista)}); se archivó para conservar su historial`);
      return res.json({ ok: true, resultado: 'archivado', mensaje: `${s.nombre} tiene registros: se archivó (desactivada y fuera de las listas) y su historial se conserva.` });
    }
    db.transaction(() => {
      db.prepare('DELETE FROM main.horario_versiones WHERE horario_id IN (SELECT id FROM main.horarios WHERE sucursal_id = ?)').run(s.id);
      for (const t of CONFIG.filter(t => t !== 'sucursales')) db.prepare(`DELETE FROM main.${t} WHERE sucursal_id = ?`).run(s.id);
      db.prepare('DELETE FROM main.sucursales WHERE id = ?').run(s.id);
    })();
    suc.refrescar();
    audit(req, 'sucursal', s.id, 'eliminada', `${s.nombre} (${s.clave}): nunca se usó; se borró`);
    res.json({ ok: true, resultado: 'eliminado', mensaje: `${s.nombre} se borró: nunca se había usado.` });
  }));
};
