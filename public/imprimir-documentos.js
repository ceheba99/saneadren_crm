/* Imprimir la orden de servicio y su factura desde el reloj checador (kiosco y celular, 2026-11-11).
   La orden se dibuja aquí con el MISMO código que el CRM (orden-servicio-pdf.js); los datos y el permiso de un solo
   dispositivo los da el servidor (server/checador.js). La factura es el PDF que se guardó al timbrarla.
   En la tableta o el celular el PDF se descarga y se abre con el visor, que tiene «Imprimir». */
window.ImprimirDocs = (() => {
  const LIBS = [
    ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk', () => window.jspdf],
    ['https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js', 'sha384-fCAW/rDWORTbQXSiB7mOg0QtQ5c+r0f544y6XoKjuVva0nMBlCpNUjiFeG5iMdS3', () => window.jspdf?.jsPDF?.API?.autoTable],
    ['https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js', 'sha384-mZT2gIty7ZDdOGkxfP6joZcYdMW1Jvj9dRlfpTmaJAKKXTqzygtB22k7FLe+KZC1', () => window.qrcode],
    ['/importes.js?v=red1', null, () => window.Importes],
    ['/orden-servicio-pdf.js?v=os1', null, () => window.generarPDFOrdenServicio],
  ];
  let listo = null;
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
  // base: '/api/publico/kiosco/' o '/api/publico/celular/'; encabezados: el token del dispositivo.
  function crear(base, encabezados) {
    const pedir = (ruta, permiso) => fetch(base + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', ...encabezados() }, body: JSON.stringify({ permiso }), cache: 'no-store' });
    const error = async r => { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'No se pudo imprimir'); };
    return {
      async orden(permiso) {
        await cargar();
        const r = await pedir('orden', permiso); if (!r.ok) await error(r);
        const datos = await r.json();
        await window.generarPDFOrdenServicio(datos, { membrete: await bytes('/membrete-orden-servicio.png?v=carta1'), qr: qrPng(datos.encuesta) });
      },
      async factura(permiso) {
        const r = await pedir('factura', permiso); if (!r.ok) await error(r);
        const nombre = (/filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '') || [])[1] || 'factura.pdf';
        const url = URL.createObjectURL(await r.blob()), a = document.createElement('a');
        a.href = url; a.download = nombre; document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
    };
  }
  return { crear };
})();
