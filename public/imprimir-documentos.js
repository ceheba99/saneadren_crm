/* Imprimir la orden de servicio y su factura desde el reloj checador (kiosco y celular, 2026-11-11).
   La orden se dibuja aquí con el MISMO código que el CRM (orden-servicio-pdf.js); los datos y el permiso de un solo
   dispositivo los da el servidor (server/checador.js). La factura es el PDF que se guardó al timbrarla.
   2026-11-11 (prueba en la tableta): en la app instalada de Android, descargar el PDF abría una ventana EN BLANCO.
   Ahora el PDF se dibuja en la misma página con pdf.js (public/vendor/pdfjs) y se abre «Imprimir» de Android ahí
   mismo; además «Compartir PDF» lo manda a otra app (visor, Drive, WhatsApp) por si la impresora no aparece. */
window.ImprimirDocs = (() => {
  const LIBS = [
    ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk', () => window.jspdf],
    ['https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js', 'sha384-fCAW/rDWORTbQXSiB7mOg0QtQ5c+r0f544y6XoKjuVva0nMBlCpNUjiFeG5iMdS3', () => window.jspdf?.jsPDF?.API?.autoTable],
    ['https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js', 'sha384-mZT2gIty7ZDdOGkxfP6joZcYdMW1Jvj9dRlfpTmaJAKKXTqzygtB22k7FLe+KZC1', () => window.qrcode],
    ['/importes.js?v=red1', null, () => window.Importes],
    ['/orden-servicio-pdf.js?v=os2', null, () => window.generarPDFOrdenServicio],
  ];
  const PDFJS = '/vendor/pdfjs/';
  let listo = null, pdfjs = null;
  const script = (src, integridad) => new Promise((ok, mal) => {
    const s = document.createElement('script'); s.src = src;
    if (integridad) { s.integrity = integridad; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer'; }
    s.onload = ok; s.onerror = () => mal(new Error('No se pudo cargar lo necesario para imprimir (¿hay internet?)'));
    document.head.append(s);
  });
  function cargar() {
    if (!listo) {
      listo = (async () => { for (const [src, sri, ya] of LIBS) if (!ya()) await script(src, sri); })();
      listo.catch(() => { listo = null; });
    }
    return listo;
  }
  const bytes = async url => { const r = await fetch(url); if (!r.ok) throw new Error('No se pudo cargar el membrete'); return new Uint8Array(await r.arrayBuffer()); };
  // QR de la encuesta de esa orden, como en el CRM (encuestas.js).
  function qrPng(url) {
    if (!url || typeof qrcode !== 'function') return null;
    const q = qrcode(0, 'M'); q.addData(url); q.make();
    const n = q.getModuleCount(), borde = 4, px = 8, lado = (n + borde * 2) * px;
    const cv = document.createElement('canvas'); cv.width = cv.height = lado;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, lado, lado); ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect((c + borde) * px, (r + borde) * px, px, px);
    const bin = atob(cv.toDataURL('image/png').split(',')[1]), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ---------- Dibujar el PDF en la página e imprimirlo ----------
  let estilo = null, urls = [];
  function hoja() {
    if (!estilo) {
      estilo = document.createElement('style');
      estilo.textContent = `#impresion-docs{display:none}
@media print{@page{size:letter;margin:0}html,body{background:#fff!important;margin:0!important;padding:0!important;height:auto!important;overflow:visible!important}
body>*:not(#impresion-docs){display:none!important}#impresion-docs{display:block!important}
#impresion-docs img{display:block;width:100vw;height:100vh;object-fit:contain;break-after:page;page-break-after:always}
#impresion-docs img:last-child{break-after:auto;page-break-after:auto}}`;
      document.head.append(estilo);
    }
    let c = document.getElementById('impresion-docs');
    if (!c) { c = document.createElement('div'); c.id = 'impresion-docs'; c.setAttribute('aria-hidden', 'true'); document.body.append(c); }
    return c;
  }
  async function paginas(datos) {
    if (!pdfjs) {
      pdfjs = await import(PDFJS + 'pdf.min.mjs').catch(() => { throw new Error('No se pudo cargar el visor para imprimir (¿hay internet?)'); });
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
    }
    // Copia: pdf.js se queda con los bytes que recibe y aún se usan para «Compartir PDF».
    const pdf = await pdfjs.getDocument({ data: datos.slice(), isEvalSupported: false, standardFontDataUrl: PDFJS + 'standard_fonts/' }).promise;
    const imgs = [];
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        const pag = await pdf.getPage(i), vista = pag.getViewport({ scale: 2 });
        const cv = document.createElement('canvas'); cv.width = Math.ceil(vista.width); cv.height = Math.ceil(vista.height);
        const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        await pag.render({ canvasContext: ctx, viewport: vista }).promise;
        const blob = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', 0.92));
        imgs.push(URL.createObjectURL(blob));
      }
    } finally { pdf.destroy(); }
    return imgs;
  }
  async function imprimir(doc) {
    if (!doc.imagenes) doc.imagenes = await paginas(doc.bytes);
    const c = hoja();
    urls.filter(u => !doc.imagenes.includes(u)).forEach(u => URL.revokeObjectURL(u)); urls = doc.imagenes;
    c.replaceChildren(...doc.imagenes.map(src => { const im = new Image(); im.src = src; im.alt = ''; return im; }));
    await Promise.all([...c.querySelectorAll('img')].map(im => im.decode().catch(() => {})));
    window.print();
  }
  const archivo = doc => new File([doc.bytes], doc.nombre, { type: 'application/pdf' });
  const puedeCompartir = doc => { try { return !!navigator.canShare?.({ files: [archivo(doc)] }); } catch { return false; } };
  async function compartir(doc) {
    try { await navigator.share({ files: [archivo(doc)], title: doc.nombre }); }
    catch (e) { if (e?.name !== 'AbortError') throw new Error('No se pudo compartir el PDF'); }
  }

  // base: '/api/publico/kiosco/' o '/api/publico/celular/'; encabezados: el token del dispositivo.
  function crear(base, encabezados) {
    const pedir = (ruta, permiso) => fetch(base + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', ...encabezados() }, body: JSON.stringify({ permiso }), cache: 'no-store' });
    const error = async r => { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'No se pudo imprimir'); };
    const traer = {
      async orden(permiso) {
        await cargar();
        const r = await pedir('orden', permiso); if (!r.ok) await error(r);
        const datos = await r.json();
        return window.generarPDFOrdenServicio(datos, { membrete: await bytes('/membrete-orden-servicio.png?v=carta1'), qr: qrPng(datos.encuesta), devolver: true });
      },
      async factura(permiso) {
        const r = await pedir('factura', permiso); if (!r.ok) await error(r);
        const nombre = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || 'factura.pdf';
        return { bytes: new Uint8Array(await r.arrayBuffer()), nombre };
      },
    };
    // Botones de una orden: «Orden de servicio» y, si tiene factura timbrada, «Factura». Al tocarlos se prepara el
    // PDF y se abre «Imprimir»; después quedan «Imprimir otra vez» y «Compartir PDF». alTocar: reinicia la espera.
    function botones(permiso, conFactura, alTocar = () => {}) {
      const caja = document.createElement('div'); caja.className = 'acciones';
      const aviso = document.createElement('span'); aviso.className = 'mal'; aviso.setAttribute('role', 'status');
      const boton = (texto, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = texto; b.onclick = () => fn(b); return b; };
      const uno = (texto, que) => {
        let doc = null;
        const grupo = document.createElement('span'); grupo.className = 'acciones';
        grupo.append(boton(texto, async b => {
          const antes = b.textContent; b.disabled = true; b.textContent = 'Preparando…'; aviso.textContent = ''; alTocar();
          try {
            if (!doc) {
              doc = await traer[que](permiso);
              if (puedeCompartir(doc)) grupo.append(boton('📤 Compartir PDF', async () => { alTocar(); try { await compartir(doc); } catch (e) { aviso.textContent = e.message; } }));
            }
            await imprimir(doc);
            b.textContent = (que === 'orden' ? '🖨️ Orden' : '🧾 Factura') + ': imprimir otra vez';
          } catch (err) { b.textContent = antes; aviso.textContent = err.message; }
          b.disabled = false;
        }));
        return grupo;
      };
      caja.append(uno('🖨️ Orden de servicio', 'orden'));
      if (conFactura) caja.append(uno('🧾 Factura', 'factura'));
      caja.append(aviso);
      return caja;
    }
    return { botones };
  }
  return { crear };
})();
