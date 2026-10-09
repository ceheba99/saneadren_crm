// Prueba la configuración de correo del .env enviando un mensaje de prueba.
// Uso: npm run probar-correo -- destinatario@saneadren.com.mx
const correo = require('../server/correo');

(async () => {
  const para = process.argv[2];
  if (!para) { console.error('Indica el destinatario: npm run probar-correo -- nombre@saneadren.com.mx'); process.exit(1); }
  try {
    await correo.verificarConexion();
    console.log('✔ Conexión y credenciales SMTP correctas');
    await correo.enviar(para, 'Prueba de correo · Saneadren CRM', {
      titulo: 'Correo de prueba', saludo: 'Hola:',
      mensaje: 'Si recibes este mensaje, el CRM ya puede enviar los correos de confirmación de cuenta y de restablecimiento de contraseña.',
      pie: 'Mensaje generado con herramientas/probar-correo.js'
    });
    console.log('✔ Correo de prueba enviado a ' + para + ' (revisa también spam)');
  } catch (err) {
    console.error('✘ No se pudo enviar:', err.message);
    if (/Username and Password not accepted|535/.test(err.message)) console.error('  → Usa una contraseña de aplicación de Google, no la contraseña normal de la cuenta.');
    process.exit(1);
  }
})();
