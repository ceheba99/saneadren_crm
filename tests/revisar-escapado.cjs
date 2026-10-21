// Revisión estática: lista interpolaciones ${...} en plantillas HTML del frontend que meten datos
// (nombres, teléfonos, notas, etc.) sin pasar por escaparHtml/escapar. Uso: node tests/revisar-escapado.cjs
// Sale con código 1 si encuentra alguna, para poder usarse como prueba.
const fs = require('fs');
const path = require('path');

// Todos los .js de la pantalla, para que ninguno nuevo se quede sin revisar.
const ARCHIVOS = fs.readdirSync(path.join(__dirname, '..', 'public')).filter(f => f.endsWith('.js')).sort()
  .map(f => path.join(__dirname, '..', 'public', f));
// Funciones que devuelven texto ya seguro (escapan o solo producen números/fechas/folios).
// input(…) de personal.js escapa su valor; campo(…) solo junta etiquetas fijas con ese input.
const SEGURAS = /^(escaparHtml|escapar|esc|Number|input\(|campo\(|formatoMoneda|fechaCorta|fechaLarga|folioCotizacion|folioOrdenServicio|encodeURIComponent|Math\.|String\(Number|diasTexto|\d)/;
// Campos con texto libre que vienen de la base o del usuario.
const CAMPOS = /\.(nombre|telefono|telefono_alterno|texto|direccion|empresa|empresa_contacto|notas|notas_iniciales|notas_generales|servicio_nombre|correo|canal|canal_nombre|responsable_nombre|lead_nombre|usuario|descripcion|leyenda|servicio|giro|rfc|persona|cargo|zona|sector|fuente|estado|creado_por|operador|equipo|observaciones|encuesta_comentario|motivo|necesidades|referencia|concepto|proveedor|proveedor_nombre|cliente_nombre|categoria|metodo|factura|ultima_fecha|fecha_sugerida|factura_folio|motivo_cancelacion|registrado_por_nombre|categoria_nombre)\w*\b/; // también sus variantes (motivo_diferencia, notas_internas…)

let hallazgos = 0;
for (const archivo of ARCHIVOS) {
  fs.readFileSync(archivo, 'utf8').split('\n').forEach((linea, i) => {
    // textContent y los diálogos (que usan textContent) no interpretan HTML: son seguros.
    // «// sin HTML» marca líneas que arman texto para textContent o toast (no se interpreta como HTML).
    if (/\.textContent\s*=|solicitarDialogo\(|mensaje\s*:|\/\/ sin HTML/.test(linea)) return;
    const re = /\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
    let m;
    while ((m = re.exec(linea))) {
      const expr = m[1].trim();
      if (SEGURAS.test(expr)) continue;
      // Quita lo que ya va escapado y las comparaciones que solo producen textos fijos.
      // En un ternario, la condición no se imprime: solo cuentan las ramas.
      // (el «?.» de acceso opcional y el «??» no son ternarios)
      const resto = expr.replace(/^(?:[^?'"`]|\?[.?])+\?(?![.?])/, '').replace(/:\s*(?:[^?'"`:]|\?[.?])+\?(?![.?])/g, ':').replace(/(escaparHtml|escapar|esc|Number|formatoMoneda|opciones\w*)\([^()]*(\([^()]*\))?[^()]*\)/g, '')
        .replace(/^[^?]*\?\s*'[^']*'\s*:\s*'[^']*'$/, '')
        .replace(/^\w+\[[^\]]+\]$/, ''); // búsqueda en un mapa de textos fijos
      if (!CAMPOS.test(resto)) continue;
      // Ternarios o || cuyo resultado se escapa más adelante no se pueden saber aquí: se reportan igual.
      hallazgos++;
      console.log(`${path.relative(path.join(__dirname, '..'), archivo)}:${i + 1}  \${${expr.slice(0, 110)}}`);
    }
  });
}
console.log(hallazgos ? `\n${hallazgos} interpolaciones sin escapar` : 'Sin interpolaciones sin escapar');
process.exitCode = hallazgos ? 1 : 0;
