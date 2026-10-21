// RECORRIDO DE PANTALLAS (se ejecuta DENTRO del navegador, con la sesión de un usuario del demo): entra a cada pantalla
// que ese usuario puede abrir y pulsa cada pestaña, filtro, tarjeta o fila que abre un registro, «ver» y «+ nuevo»
// (nunca nada que guarde, pague, borre, autorice, cambie la etapa o el orden), cerrando lo que abra. Junta:
//  · errores de la página (consola, excepciones, promesas rechazadas);
//  · código trampa ejecutado (window.__xss, ver tests/sembrar-xss.cjs);
//  · elementos visibles que el rol NO debería ver (clases perm-* de permisos que no tiene);
//  · desbordes horizontales (la página más ancha que la pantalla; útil con el tamaño de celular);
//  · pantallas en blanco (el rol entra pero no se dibuja nada).
// Uso (herramienta del navegador): como la página no permite eval (bien), se inserta como <script> y se llama
// window.recorrerPantallas(); tarda varios minutos por usuario, así que se deja corriendo y se consulta después.
async function recorrerPantallas({ maxClicsPorVista = 30 } = {}) {
  const espera = ms => new Promise(r => setTimeout(r, ms));
  const errores = [], origErr = console.error;
  console.error = (...a) => { errores.push('consola: ' + a.map(x => (x && x.message) || String(x)).join(' ').slice(0, 180)); origErr.apply(console, a); };
  const alError = e => errores.push('excepción: ' + String(e.message || e.reason?.message || e.reason || e).slice(0, 180));
  window.addEventListener('error', alError); window.addEventListener('unhandledrejection', alError);
  window.__xss = window.__xss || 0;
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const mostrado = el => !!el && getComputedStyle(el).display !== 'none';
  const PROHIBIDO = /guardar|eliminar|borrar|cancelar|pagar|registrar|autorizar|aprobar|rechazar|recibir|subir|baja|quitar|enviar|confirmar|salir|exportar|descargar|imprimir|pdf|resuelta|fusionar|juntar|reactivar|desactivar|contraseña|aplicar|elegir|marcar|realizad|vincular|duplicar|restablecer|crear|agregar|alta|entrar|respaldo|revisar|cambiar|asignar|mover|liberar|ver como|copiar|reintentar|sí,|aceptar|descartar|cerrar sesión|plantilla|cargar|importar|limpiar|consultar|avanzar|ordenar/i;
  const reporte = { usuario: USUARIO_ACTUAL?.nombre, rol: Permisos?.datos?.rol, vistas: {}, clics: 0, errores, permisosVisibles: new Set(), desbordes: new Set(), xss: 0 };
  const cerrarTodo = async () => { const dlg = document.getElementById('dialogo-cancelar'); if (dlg && visible(dlg)) dlg.click(); document.querySelectorAll('.overlay.mostrar').forEach(o => o.classList.remove('mostrar')); await espera(150); };
  const revisarPermisos = donde => {
    for (const el of document.querySelectorAll('[class*="perm-"]')) {
      if (!visible(el)) continue;
      for (const c of el.classList) { const m = c.match(/^perm-([a-z_]+)-([a-z_]+)$/); if (m && !Permisos.puede(m[1] + '.' + m[2])) reporte.permisosVisibles.add(`${donde}: .${c} visible («${(el.id || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)}»)`); }
    }
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) reporte.desbordes.add(`${donde}: la página mide ${document.documentElement.scrollWidth}px en una pantalla de ${document.documentElement.clientWidth}px`);
  };
  // Se entra como lo haría la persona: por cada opción visible del menú (p. ej. «Cuentas por pagar» abre Finanzas en esa pestaña).
  const alcanzables = ['inicio', ...new Set([...document.querySelectorAll('.menu-item[data-vista]')].filter(mostrado).map(b => b.dataset.vista))];
  for (const v of alcanzables) {
    await cerrarTodo();
    try { cambiarVista(v); } catch (e) { errores.push(`cambiarVista(${v}): ${e.message}`); continue; }
    await espera(2600); revisarPermisos(v);
    const sec = document.querySelector('section.vista.activa'); const yaPulsados = new Set(); let clics = 0;
    // Pantalla en blanco: ni un botón, tabla, tarjeta, campo, párrafo o renglón visible (aparte del título).
    const contenido = [...sec.querySelectorAll('button, table, .fila-alerta, .lead-card, input, select, textarea, p, li, .inicio-lista > *')].filter(visible).length;
    if (!contenido) reporte.vacias = [...(reporte.vacias || []), v];
    for (let vuelta = 0; vuelta < 3 && clics < maxClicsPorVista; vuelta++) {
      // Botones, pestañas y lo que abre un registro (tarjetas y filas con onclick «abrir…»); nunca flechas que cambian
      // la etapa o el orden, ni nada cuyo onclick modifique datos.
      const candidatos = [...sec.querySelectorAll('button, [role="tab"], [data-pestana], summary, [onclick*="abrir"]')].filter(b => visible(b) && !b.disabled && !yaPulsados.has(b)
        && !PROHIBIDO.test([b.textContent, b.title, b.getAttribute('aria-label'), b.getAttribute('onclick')].join(' ')) && !b.closest('form[data-vista]')
        && !b.matches('.btn-avanzar') && !/^[›‹↑↓×✕]$/.test((b.textContent || '').trim()) && !/avanzar|mover|eliminar|guardar|ordenar|quitar|resolver/i.test(b.getAttribute('onclick') || ''));
      if (!candidatos.length) break;
      for (const b of candidatos.slice(0, maxClicsPorVista - clics)) {
        yaPulsados.add(b); const etiqueta = (b.textContent || b.title || '').trim().replace(/\s+/g, ' ').slice(0, 30);
        try { b.click(); } catch (e) { errores.push(`${v} › «${etiqueta}»: ${e.message}`); }
        clics++; reporte.clics++; await espera(500); revisarPermisos(`${v} › «${etiqueta}»`); await cerrarTodo();
        if (!sec.classList.contains('activa')) { try { cambiarVista(v); } catch { /* sigue */ } await espera(900); }
      }
    }
    reporte.vistas[v] = clics;
  }
  await cerrarTodo();
  console.error = origErr; window.removeEventListener('error', alError); window.removeEventListener('unhandledrejection', alError);
  reporte.xss = window.__xss || 0;
  return { ...reporte, vacias: reporte.vacias || [], errores: [...new Set(errores)], permisosVisibles: [...reporte.permisosVisibles], desbordes: [...reporte.desbordes] };
}
