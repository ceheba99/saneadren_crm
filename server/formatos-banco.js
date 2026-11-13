// FORMATOS DE BANCO (2026-11-13; hechos con los archivos reales de octubre 2026 que dio Dirección).
// Reconoce el archivo de movimientos tal como se baja del portal y lo deja listo para «Subir estado de cuenta», sin que
// la persona elija columnas:
//  · Santander «MovimientosCheque» (CSV): fecha pegada con apóstrofos ('01102026'), el importe sin signo y el signo en la
//    columna «Cargo/Abono» (+ / −); trae nombre y RFC de quien paga o cobra y la clave de rastreo.
//  · Banorte «Cuentas de Cheques» (CSV): DEPÓSITOS y RETIROS con «$» y «-» en lo vacío; el nombre, el RFC y el rastreo
//    vienen dentro de «DESCRIPCIÓN DETALLADA».
// Si el encabezado no es de ninguno, devuelve null y la pantalla pregunta qué columna es cada cosa, como antes.
// Aquí no se guarda nada ni se revisan importes: eso lo hace server/conciliacion.js con cada renglón.
const llave = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
// Los portales envuelven en apóstrofos lo que Excel no debe tomar como número ('65503952894, '01102026').
const limpio = t => String(t ?? '').replace(/^\s*'+|'+\s*$/g, '').replace(/\s+/g, ' ').trim();
const vacio = t => { const x = limpio(t); return x === '-' ? '' : x; };
const RFC = /\b([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})\b/;

const FORMATOS = [
  { banco: 'Santander', pide: ['fecha', 'cargo/abono', 'importe', 'saldo', 'descripcion', 'clave de rastreo'],
    fila(v) {
      const signo = limpio(v('cargo/abono')), cargo = signo === '-';
      if (signo !== '-' && signo !== '+') return { error: 'no dice si es cargo (−) o abono (+)' };
      // Quién está del otro lado: al pagar, el beneficiario; al cobrar, quien ordenó («DEL CLIENTE …»).
      const contraparte = cargo ? limpio(v('nombre beneficiario')) : limpio(v('nombre ordenante')).replace(/^DEL CLIENTE\s+/i, '');
      const rfc = limpio(cargo ? v('rfc beneficiario') : v('rfc ordenante')) || (limpio(v('concepto')).match(/\bRFC\s+([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})\b/) || [])[1] || '';
      return { fecha: limpio(v('fecha')), hora: limpio(v('hora')), concepto: [limpio(v('descripcion')), limpio(v('concepto'))].filter(Boolean).join(' · '), referencia: limpio(v('referencia')),
        cargo: cargo ? limpio(v('importe')) : '', abono: cargo ? '' : limpio(v('importe')), saldo: limpio(v('saldo')), contraparte, contraparte_rfc: rfc, rastreo: limpio(v('clave de rastreo')),
        detalle: [limpio(v('banco participante')), limpio(v('causa devolucion'))].filter(Boolean).join(' · ') };
    } },
  { banco: 'Banorte', pide: ['fecha de operacion', 'depositos', 'retiros', 'saldo', 'descripcion'],
    fila(v) {
      const det = vacio(v('descripcion detallada')), cargo = !!vacio(v('retiros'));
      const contraparte = ((det.match(/DEL CLIENTE\s+(.+?),?\s+DE LA CLABE/i) || det.match(/BENEF:\s*(.+?)\s*(?:\(|,)/i) || det.match(/CGO DOMICILIACION:\s*(.+?),/i) || [])[1] || '').trim();
      return { fecha: limpio(v('fecha de operacion')), hora: (det.match(/H(?:OR)?A? LIQ:\s*(\d{2}:\d{2})/i) || [])[1] || '', concepto: limpio(v('descripcion')), referencia: vacio(v('referencia')),
        cargo: vacio(v('retiros')), abono: cargo ? '' : vacio(v('depositos')), saldo: vacio(v('saldo')), contraparte, contraparte_rfc: (det.match(RFC) || [])[1] || '',
        rastreo: (det.match(/(?:CVE(?: DE)? RAST(?:REO)?|RASTREO)\s*:?,?\s*([A-Z0-9-]{6,40})/i) || [])[1] || '', detalle: det };
    } },
];

// filas: el archivo como lo lee la pantalla (arreglo de renglones, cada uno arreglo de textos).
// Devuelve { banco, cuenta, filas: [{ fecha, hora, concepto, referencia, cargo, abono, saldo, contraparte, contraparte_rfc,
// rastreo, detalle }], errores } o null si no es un formato conocido.
function reconocer(filas) {
  if (!Array.isArray(filas)) return null;
  for (let i = 0; i < Math.min(filas.length, 15); i++) {
    const enc = (Array.isArray(filas[i]) ? filas[i] : []).map(llave), f = FORMATOS.find(x => x.pide.every(p => enc.includes(p)));
    if (!f) continue;
    const col = n => enc.indexOf(n), listos = [], errores = [];
    let cuenta = '';
    filas.slice(i + 1).forEach((r, j) => {
      if (!Array.isArray(r) || !r.some(c => String(c ?? '').trim())) return;
      const v = n => (col(n) >= 0 ? r[col(n)] ?? '' : '');
      const x = f.fila(v);
      if (x.error) return errores.push(`Renglón ${i + j + 2}: ${x.error}`);
      if (!x.fecha) return; // renglones de totales o notas al pie
      cuenta ||= limpio(v('cuenta')).replace(/\D/g, '');
      listos.push(x);
    });
    return { banco: f.banco, cuenta, filas: listos, errores };
  }
  return null;
}

module.exports = { reconocer };
