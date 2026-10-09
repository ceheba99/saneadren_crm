/* Pantallas de cuenta dentro de la ventana de inicio de sesión: crear cuenta, olvidé mi
   contraseña, restablecerla desde el enlace del correo y cambio obligatorio de contraseña. */
const Cuentas = (() => {
  const $ = id => document.getElementById(id);
  const TITULOS = { login: 'Iniciar sesión', registro: 'Crear cuenta', olvide: 'Recuperar contraseña', nueva: 'Contraseña nueva' };
  let tokenRestablecer = null; // token del enlace del correo (modo restablecer)
  let modoNueva = 'restablecer'; // 'restablecer' | 'obligatorio'

  function abrir() { $('overlay-login').classList.add('mostrar'); }
  function aviso(texto, error = false) {
    const el = $('cuenta-aviso');
    el.hidden = !texto; el.textContent = texto || ''; el.classList.toggle('error', !!error);
  }
  function mostrar(vista, { titulo, mensaje, error } = {}) {
    document.querySelectorAll('#overlay-login form[data-vista]').forEach(f => { f.hidden = f.dataset.vista !== vista; });
    document.querySelectorAll('#overlay-login .diseno-login-error').forEach(e => { e.style.display = 'none'; });
    $('cuenta-titulo').textContent = titulo || TITULOS[vista];
    aviso(mensaje, error);
    abrir();
    $('overlay-login').querySelector(`form[data-vista="${vista}"] input:not([hidden])`)?.focus();
  }
  function error(id, texto) { const el = $(id); el.textContent = texto; el.style.display = 'block'; }

  async function publico(ruta, datos) {
    let res;
    try { res = await fetch('/api' + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos) }); }
    catch { throw new Error('No hay conexión con el servidor. Intenta de nuevo.'); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'No se pudo completar la solicitud');
    return j;
  }
  async function conBoton(form, fn) {
    const boton = form.querySelector('button[type="submit"]');
    if (boton.disabled) return;
    boton.disabled = true;
    try { await fn(); } finally { boton.disabled = false; }
  }

  document.addEventListener('click', e => {
    const ir = e.target.closest('#overlay-login [data-ir]');
    if (ir) mostrar(ir.dataset.ir);
  });

  $('form-registro').addEventListener('submit', e => {
    e.preventDefault();
    conBoton(e.target, async () => {
      const password = $('reg-password').value;
      if (password !== $('reg-password2').value) return error('registro-error', 'Las contraseñas no coinciden');
      try {
        const r = await publico('/registro', { nombre: $('reg-nombre').value, correo: $('reg-correo').value, password });
        e.target.reset();
        mostrar('login', { mensaje: r.mensaje });
      } catch (err) { error('registro-error', err.message); }
    });
  });

  $('form-olvide').addEventListener('submit', e => {
    e.preventDefault();
    conBoton(e.target, async () => {
      try {
        const r = await publico('/olvide-password', { correo: $('olv-correo').value });
        e.target.reset();
        mostrar('login', { mensaje: r.mensaje });
      } catch (err) { error('olvide-error', err.message); }
    });
  });

  $('form-nueva-password').addEventListener('submit', e => {
    e.preventDefault();
    conBoton(e.target, async () => {
      const nueva = $('np-password').value;
      if (nueva !== $('np-password2').value) return error('nueva-error', 'Las contraseñas no coinciden');
      try {
        if (modoNueva === 'restablecer') {
          const r = await publico('/restablecer-password', { token: tokenRestablecer, password: nueva });
          tokenRestablecer = null;
          e.target.reset();
          mostrar('login', { mensaje: r.mensaje });
        } else {
          const res = await api('/cambiar-password', { method: 'POST', body: JSON.stringify({ actual: $('np-actual').value, nueva }) });
          const r = await res.json();
          guardarSesion({ ...USUARIO_ACTUAL, token: r.token, cambiar_password: false });
          location.reload();
        }
      } catch (err) { error('nueva-error', err.message); }
    });
  });

  function prepararNueva(modo) {
    modoNueva = modo;
    $('wrap-pass-actual').hidden = modo !== 'obligatorio';
    $('np-actual').required = modo === 'obligatorio';
    $('nueva-ayuda').textContent = modo === 'obligatorio'
      ? 'Por seguridad, tu contraseña actual ya no es suficiente. Elige una nueva de mínimo 10 caracteres, con letras y números.'
      : 'Elige tu contraseña nueva: mínimo 10 caracteres, con letras y números.';
  }

  // Enlaces de los correos: /#verificar=TOKEN y /#restablecer=TOKEN. El token se quita de la
  // barra de direcciones de inmediato para que no quede en el historial.
  function atenderEnlace() {
    const m = location.hash.match(/^#(verificar|restablecer)=([\w-]{20,100})$/);
    if (!m) return false;
    history.replaceState(null, '', location.pathname + location.search);
    const [, accion, token] = m;
    if (accion === 'restablecer') {
      tokenRestablecer = token;
      prepararNueva('restablecer');
      mostrar('nueva', { titulo: 'Restablecer contraseña' });
    } else {
      mostrar('login', { mensaje: 'Confirmando tu correo…' });
      publico('/verificar-correo', { token })
        .then(r => mostrar('login', { mensaje: r.mensaje }))
        .catch(err => mostrar('login', { mensaje: err.message, error: true }));
    }
    return true;
  }

  function pedirCambioObligatorio() {
    prepararNueva('obligatorio');
    mostrar('nueva', { titulo: 'Cambia tu contraseña' });
  }

  return { atenderEnlace, pedirCambioObligatorio, mostrar };
})();
