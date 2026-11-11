/* Orden de servicio en PDF: el mismo formato para el CRM (app.js) y el reloj checador (kiosco y celular, 2026-11-11).
   Se sacó de app.js sin cambiar el dibujo. Funciones globales (las usa app.js también para la cotización y el Word):
   formatoMoneda, colsCantidad, titulosCantidad, CONDICIONES_ORDEN_SERVICIO, nombreArchivoOrdenServicio, etiquetaTotalOrden,
   camposOrden, COLOR_ORDEN y generarPDFOrdenServicio. Necesita jsPDF + autotable (cdnjs) e Importes (importes.js). */
function formatoMoneda(n) {
  return '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Columnas de cantidad y precio unitario de una partida (solo si el documento las usa).
const colsCantidad = (datos, item) => datos.conCantidad ? [String(Importes.cantidadDe(item)), formatoMoneda(Importes.precioDe(item))] : [];
const titulosCantidad = datos => datos.conCantidad ? ['Cant.', 'P. unitario'] : [];
const CONDICIONES_ORDEN_SERVICIO = 'El presente documento formaliza el servicio aceptado por el cliente en los términos y el importe aquí descritos. Cualquier trabajo adicional no listado en esta orden se cotizará por separado.';


function nombreArchivoOrdenServicio(datos, extension) {
  const cliente = (datos.cliente.nombre || 'cliente').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `orden_servicio_${datos.folio}_${cliente}.${extension}`;
}

// Rótulo del recuadro del total en la orden de servicio.
const etiquetaTotalOrden = modo => modo === 'mas_iva' ? 'TOTAL CON IVA' : modo === 'incluido' ? 'TOTAL (IVA INCLUIDO)' : modo === 'sin_iva' ? 'TOTAL (SIN IVA)' : 'IMPORTE TOTAL';

// Mismo orden de conceptos que el formato impreso "ORDENES DE SERVICIO" de Saneadren:
// Empresa/Fecha, Ubicación, Equipo, Operador → Descripción → Importe → Observaciones →
// Firma del operador asignado y visto bueno del cliente. Diseño ligero: etiquetas
// pequeñas sobre cada dato y líneas finas (sin cuadrícula pesada), para que respire sobre el membrete.
function camposOrden(datos) {
  return [
    // Con empresa: Empresa + Contacto (nombre y teléfono). Sin empresa: Cliente + Teléfono (no se inventa una empresa).
    datos.cliente.empresa
      ? [['Empresa', datos.cliente.empresa], ['Contacto', [datos.cliente.nombre, datos.cliente.telefono].filter(Boolean).join(' · ') || '—']]
      : [['Cliente', datos.cliente.nombre || '—'], ['Teléfono', datos.cliente.telefono || '—']],
    [['Ubicación', datos.cliente.direccion || '—']],
    [['Equipo', datos.equipo || ''], ['Operador(es)', datos.operador || '']],
    ...(datos.proyecto ? [[['Proyecto', datos.proyecto]]] : [])
  ];
}
const COLOR_ORDEN = { oscuro: [26, 29, 35], amarillo: [246, 177, 3], gris: [107, 114, 128], linea: [214, 217, 222], fondo: [246, 247, 249] };

// opciones (reloj checador, 2026-11-11): { membrete, qr, devolver } ya cargados (fuera del CRM no existen cargarMembrete ni la
// encuesta con sesión). Sin opciones, los carga el CRM como siempre.
async function generarPDFOrdenServicio(datos, opciones = {}) {
  const membrete = opciones.membrete || await cargarMembreteOrdenServicio();
  const qr = 'qr' in opciones ? opciones.qr : await cargarQREncuesta(datos.leadId).catch(() => null);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'pt', format:[612,792]});
  const C = COLOR_ORDEN, margen = 48, derecha = 564, ancho = 516, inicio = 116, limite = 680;
  let y = inicio;
  const fondo = () => doc.addImage(membrete,'PNG',0,0,612,792,'membrete');
  const pagina = () => { doc.addPage(); fondo(); y = inicio; };
  const asegurar = alto => { if (y + alto > limite) pagina(); };
  const fuente = (tam, negrita = false, color = C.oscuro) => { doc.setFont('helvetica', negrita ? 'bold' : 'normal'); doc.setFontSize(tam); doc.setTextColor(...color); };
  const linea = (x1, y1, x2, color = C.linea, grosor = 0.6) => { doc.setDrawColor(...color); doc.setLineWidth(grosor); doc.line(x1, y1, x2, y1); };
  const seccion = titulo => {
    asegurar(40);
    doc.setFillColor(...C.amarillo); doc.rect(margen, y - 8, 3, 11, 'F');
    fuente(9, true); doc.text(titulo, margen + 9, y + 1);
    linea(margen + 9 + doc.getTextWidth(titulo) + 8, y - 2, derecha);
    y += 14;
  };
  // Campo: etiqueta pequeña en gris y el dato debajo, con una línea fina como renglón.
  const campo = (etiqueta, valor, x, w) => {
    fuente(6.8, true, C.gris); doc.text(etiqueta.toUpperCase(), x, y);
    fuente(10); const lineas = doc.splitTextToSize(String(valor || ' '), w - 4);
    doc.text(lineas, x, y + 13);
    return 13 + (lineas.length - 1) * 12;
  };
  fondo();

  // Folio y fecha
  fuente(7, true, C.gris); doc.text('FOLIO', margen, y);
  fuente(14, true); doc.text(datos.folio, margen, y + 16);
  fuente(7, true, C.gris); doc.text('FECHA DEL SERVICIO', derecha, y, { align: 'right' });
  fuente(14, true); doc.text(datos.fechaServicio, derecha, y + 16, { align: 'right' });
  y += 34;
  if (datos.folioCotizacion) { fuente(8, false, C.gris); doc.text('Cotización de referencia: ' + datos.folioCotizacion, margen, y); y += 18; }

  seccion('DATOS DEL SERVICIO');
  const gap = 20, mitad = (ancho - gap) / 2;
  for (const fila of camposOrden(datos)) {
    asegurar(34);
    const alto = Math.max(...fila.map(([e, v], i) => campo(e, v, margen + i * (mitad + gap), fila.length === 1 ? ancho : mitad)));
    fila.forEach((_, i) => linea(margen + i * (mitad + gap), y + alto + 5, margen + i * (mitad + gap) + (fila.length === 1 ? ancho : mitad)));
    y += alto + 14;
  }
  y += 4;

  seccion('DESCRIPCIÓN DEL TRABAJO');
  doc.autoTable({
    startY: y - 4, margin: { left: margen, right: margen, top: inicio, bottom: 112 }, theme: 'plain',
    head: [['Servicio', 'Descripción', ...titulosCantidad(datos), Importes.encabezadoImporte(datos.modo)]],
    body: datos.items.map(item => [item.servicio, item.leyenda || '—', ...colsCantidad(datos, item), formatoMoneda(item.importe)]),
    rowPageBreak: 'avoid',
    styles: { fontSize: 9.5, cellPadding: { top: 6, bottom: 6, left: 7, right: 7 }, textColor: C.oscuro, lineColor: C.linea, overflow: 'linebreak' },
    headStyles: { fillColor: C.oscuro, textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
    alternateRowStyles: { fillColor: C.fondo },
    columnStyles: datos.conCantidad
      ? { 0: { cellWidth: 120, fontStyle: 'bold' }, 2: { cellWidth: 38, halign: 'right' }, 3: { cellWidth: 72, halign: 'right' }, 4: { cellWidth: 82, halign: 'right' } }
      : { 0: { cellWidth: 140, fontStyle: 'bold' }, 2: { cellWidth: 90, halign: 'right' } },
    didParseCell: d => { if (d.section === 'head' && d.column.index >= 2) d.cell.styles.halign = 'right'; },
    didDrawCell: d => { if (d.section === 'body') { doc.setDrawColor(...C.linea); doc.setLineWidth(0.5); doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height); } },
    willDrawPage: () => { if (doc.internal.getCurrentPageInfo().pageNumber > 1) fondo(); }
  });
  y = doc.lastAutoTable.finalY + 10;
  // Total: recuadro a la derecha con acento amarillo, y el importe con letra a la izquierda.
  // Con IVA, encima del recuadro van Subtotal e IVA en renglones chicos.
  const desglose = datos.totales.slice(0, -1);
  asegurar(40 + desglose.length * 14);
  const anchoTotal = 210;
  desglose.forEach(([etiqueta, cent]) => {
    fuente(8, true, C.gris); doc.text(etiqueta.toUpperCase(), derecha - anchoTotal + 14, y + 9);
    fuente(9.5); doc.text(formatoMoneda(cent / 100), derecha - 10, y + 9, { align: 'right' });
    y += 14;
  });
  if (desglose.length) y += 4;
  doc.setFillColor(...C.fondo); doc.rect(derecha - anchoTotal, y, anchoTotal, 30, 'F');
  doc.setFillColor(...C.amarillo); doc.rect(derecha - anchoTotal, y, 4, 30, 'F');
  fuente(8, true, C.gris); doc.text(etiquetaTotalOrden(datos.modo), derecha - anchoTotal + 14, y + 19);
  fuente(14, true); doc.text(formatoMoneda(datos.total), derecha - 10, y + 20, { align: 'right' });
  fuente(8, false, C.gris);
  doc.text(doc.splitTextToSize('Son: ' + datos.totalLetras + (datos.leyendaIva ? ' ' + datos.leyendaIva : ''), ancho - anchoTotal - 20), margen, y + 13);
  y += 44;

  seccion('OBSERVACIONES');
  asegurar(56);
  doc.setFillColor(...C.fondo); doc.roundedRect(margen, y - 6, ancho, 42, 4, 4, 'F');
  if (datos.observaciones) { fuente(9.5); doc.text(doc.splitTextToSize(datos.observaciones, ancho - 20).slice(0, 3), margen + 10, y + 9); }
  else { [y + 12, y + 28].forEach(yy => linea(margen + 10, yy, derecha - 10, [200, 204, 210], 0.4)); } // renglones para escribir a mano
  y += 52;

  // Cierre agrupado cerca del pie: dos firmas y una franja de condiciones y encuesta.
  fuente(9.5);
  const nombres=[datos.operador,datos.cliente.nombre].map(n=>doc.splitTextToSize(n||' ',mitad-8));
  const altoNombres=Math.max(...nombres.map(n=>n.length))*12;
  const altoCierre=150+altoNombres;
  asegurar(altoCierre);
  y=Math.max(y,limite-altoCierre);
  seccion('RECEPCIÓN DEL SERVICIO');
  ['OPERADOR ASIGNADO','CLIENTE · VISTO BUENO'].forEach((etiqueta,i)=>{
    const x=margen+i*(mitad+gap);
    fuente(7.5,true,C.gris);doc.text(etiqueta,x,y+6);
    linea(x,y+49,x+mitad,C.oscuro,0.7);
    fuente(9.5);doc.text(nombres[i],x,y+64);
  });
  y+=72+altoNombres;
  doc.setFillColor(...C.fondo);doc.rect(margen,y,ancho,60,'F');
  fuente(7.5,false,C.gris);
  doc.text(doc.splitTextToSize(CONDICIONES_ORDEN_SERVICIO,qr?ancho-90:ancho-24),margen+12,y+13);
  if(qr){
    doc.addImage(qr,'PNG',derecha-54,y+7,46,46,'qr');
    fuente(7.5,true);doc.text('CALIFICA EL SERVICIO',margen+12,y+47);
    fuente(7.5,false,C.gris);doc.text('Escanea el código QR',margen+117,y+47);
  }
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) { doc.setPage(i); fuente(7.5, false, C.gris); doc.text('Orden de servicio ' + datos.folio + ' · Página ' + i + ' de ' + paginas, derecha, 694, { align: 'right' }); }
  // Reloj checador: regresa el PDF para dibujarlo e imprimirlo ahí (en la app de Android una descarga se abre en blanco).
  if (opciones.devolver) return { bytes: new Uint8Array(doc.output('arraybuffer')), nombre: nombreArchivoOrdenServicio(datos,'pdf') };
  doc.save(nombreArchivoOrdenServicio(datos,'pdf'));
}
