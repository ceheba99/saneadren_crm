// Versión DEMO (solo en el servidor de prueba): franja «DEMO · datos de ejemplo» y botones «Entrar como…»
// en la pantalla de inicio. En el sistema real /api/demo/estado responde demo:false y aquí no se muestra nada.
(async function () {
  let e;
  try { e = await (await fetch('/api/demo/estado')).json(); } catch { return; }
  if (!e || !e.demo) return;
  const franja = document.createElement('div');
  franja.className = 'demo-franja';
  franja.textContent = 'DEMO · datos de ejemplo — nada de lo que veas aquí es real';
  document.body.prepend(franja);
  document.body.classList.add('con-demo');

  const form = document.getElementById('form-login');
  if (!form) return;
  const caja = document.createElement('div');
  caja.className = 'demo-entrar';
  const titulo = document.createElement('p');
  titulo.className = 'ayuda';
  titulo.textContent = e.listo ? 'Versión de prueba: entra sin contraseña como…' : 'Preparando los datos de ejemplo…';
  caja.appendChild(titulo);
  const NOMBRES = { admin: 'Dirección', ventas: 'Ventas', costos: 'Compras / costos', tecnico: 'Técnico', atencion: 'Atención' };
  for (const u of e.usuarios || []) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-secundario';
    b.textContent = NOMBRES[u.rol] || u.nombre;
    b.title = u.nombre;
    b.addEventListener('click', async () => {
      const err = document.getElementById('login-error');
      try {
        const r = await fetch('/api/demo/entrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rol: u.rol }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'No se pudo entrar');
        guardarSesion(j);
        document.getElementById('overlay-login').classList.remove('mostrar');
        iniciarApp();
      } catch (x) { if (err) { err.textContent = x.message; err.style.display = 'block'; } }
    });
    caja.appendChild(b);
  }
  form.prepend(caja);
  if (!e.listo) setTimeout(() => location.reload(), 5000);
})();
