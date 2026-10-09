// Crea o actualiza la cuenta de administrador: nombre de usuario, correo y contraseña.
// La contraseña se escribe en la terminal sin mostrarse (no queda en el historial ni en archivos).
// Uso: npm run configurar-admin -- admin marketing@saneadren.com.mx
const readline = require('readline');
const { db } = require('../server/db');
const { migrarCuentas } = require('../server/cuentas');
const crearAlmacenSesiones = require('../server/sesiones');
const { problemaNombre, problemaPassword, correoPermitido, normalizarCorreo, hashPassword, DOMINIO } = require('../server/seguridad');

// Una sola interfaz de lectura para todas las preguntas; lo que se escribe no se muestra.
// Las líneas se encolan para no perder ninguna si llegan antes de la pregunta.
let rl;
const lineas = [], esperando = [];
function preguntarOculto(texto) {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    rl._writeToOutput = s => { if (/[\r\n]/.test(s)) rl.output.write('\n'); }; // no se muestra lo que se escribe
    rl.on('line', l => (esperando.length ? esperando.shift()(l) : lineas.push(l)));
    rl.on('close', () => esperando.splice(0).forEach(r => r(null)));
  }
  process.stdout.write(texto);
  return new Promise(resolve => (lineas.length ? resolve(lineas.shift()) : esperando.push(resolve)))
    .then(l => (l === null ? fallar('Se canceló la captura') : l));
}
const fallar = msg => { rl?.close(); console.error('\n✘ ' + msg); process.exit(1); };

(async () => {
  const nombre = (process.argv[2] || '').trim();
  const correo = normalizarCorreo(process.argv[3]);
  if (!nombre || !correo) fallar('Uso: npm run configurar-admin -- <usuario> <correo@' + DOMINIO + '>');
  const pn = problemaNombre(nombre); if (pn) fallar(pn);
  if (!correoPermitido(correo)) fallar('El correo debe ser @' + DOMINIO + ' (revisa que esté bien escrito)');

  migrarCuentas(db);
  const porCorreo = db.prepare('SELECT * FROM usuarios WHERE correo = ?').get(correo);
  const porNombre = db.prepare('SELECT * FROM usuarios WHERE lower(nombre) = lower(?)').get(nombre);
  if (porCorreo && porNombre && porCorreo.id !== porNombre.id) fallar(`El correo ya pertenece a "${porCorreo.nombre}" y el nombre a otro usuario; resuélvelo desde el panel de usuarios.`);
  const existente = porCorreo || porNombre;

  const password = await preguntarOculto('Contraseña nueva: ');
  const pp = problemaPassword(password, { nombre, correo }); if (pp) fallar(pp);
  if (password !== await preguntarOculto('Repite la contraseña: ')) fallar('Las contraseñas no coinciden');

  rl.close();
  const hash = hashPassword(password);
  let id;
  db.transaction(() => {
    if (existente) {
      db.prepare("UPDATE usuarios SET nombre = ?, correo = ?, correo_verificado = 1, password = ?, rol = 'admin', activo = 1, debe_cambiar_password = 0 WHERE id = ?")
        .run(nombre, correo, hash, existente.id);
      id = existente.id;
    } else {
      id = db.prepare("INSERT INTO usuarios (nombre, password, rol, correo, correo_verificado) VALUES (?, ?, 'admin', ?, 1)").run(nombre, hash, correo).lastInsertRowid;
    }
    crearAlmacenSesiones(db).revocarUsuario(id); // cualquier sesión anterior de esa cuenta se cierra
  })();
  console.log(`✔ Administrador ${existente ? 'actualizado' : 'creado'}: usuario "${nombre}", correo ${correo} (id ${id}).`);
  console.log('  Puede iniciar sesión con el usuario o con el correo, y recuperar la contraseña por correo.');
})();
