// Envío de correos (verificación de cuenta y restablecimiento de contraseña).
// Se configura con variables de entorno; sin SMTP_HOST el correo NO se envía y solo se
// muestra en la consola del servidor (modo desarrollo), para poder probar el flujo completo.
//
//   SMTP_HOST, SMTP_PORT (465 = TLS directo; 587 = STARTTLS), SMTP_USER, SMTP_PASS
//   CORREO_REMITENTE  p. ej. "Saneadren CRM <servicios@saneadren.com.mx>"
const nodemailer = require('nodemailer');

const configurado = !!process.env.SMTP_HOST;
const transporte = configurado ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT || 587) === 465,
  requireTLS: Number(process.env.SMTP_PORT || 587) !== 465, // nunca enviar credenciales en claro
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
}) : null;
const REMITENTE = process.env.CORREO_REMITENTE || process.env.SMTP_USER || 'no-responder@saneadren.com.mx';

const escapar = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function plantilla({ titulo, saludo, mensaje, boton, enlace, pie }) {
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif;color:#1a1d23">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:10px;overflow:hidden" cellpadding="0" cellspacing="0">
    <tr><td style="background:#1a1d23;border-bottom:4px solid #f6b103;padding:18px 24px;color:#fff;font-weight:700;letter-spacing:1px">SANEADREN · CRM</td></tr>
    <tr><td style="padding:24px">
      <h1 style="font-size:20px;margin:0 0 12px">${escapar(titulo)}</h1>
      <p style="margin:0 0 12px">${escapar(saludo)}</p>
      <p style="margin:0 0 20px;line-height:1.5">${escapar(mensaje)}</p>
      ${enlace ? `<p style="margin:0 0 20px"><a href="${escapar(enlace)}" style="display:inline-block;background:#f6b103;color:#1a1d23;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:6px">${escapar(boton)}</a></p>
      <p style="margin:0 0 12px;font-size:12px;color:#6b7280">Si el botón no funciona, copia este enlace en tu navegador:<br><span style="word-break:break-all">${escapar(enlace)}</span></p>` : ''}
      <p style="margin:16px 0 0;font-size:12px;color:#6b7280">${escapar(pie)}</p>
    </td></tr>
  </table></td></tr></table></body></html>`;
  const texto = [titulo, '', saludo, '', mensaje, enlace ? '\n' + boton + ': ' + enlace : '', '', pie].join('\n');
  return { html, texto };
}

async function enviar(para, asunto, contenido) {
  const { html, texto } = plantilla(contenido);
  if (!transporte) {
    console.log(`\n[correo · modo desarrollo, NO enviado] Para: ${para}\nAsunto: ${asunto}\n${texto}\n`);
    return;
  }
  await transporte.sendMail({ from: REMITENTE, to: para, subject: asunto, html, text: texto });
}

// Comprueba conexión y credenciales con el servidor SMTP (lanza error si fallan).
async function verificarConexion() {
  if (!transporte) throw new Error('SMTP_HOST no está configurado (revisa el archivo .env)');
  await transporte.verify();
}

module.exports = { enviar, configurado, verificarConexion };
