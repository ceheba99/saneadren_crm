// Sucursales en pantalla: selector de arriba (Todas / QRO / CDMX…), sección «Sucursales» en Ajustes (solo el
// administrador general) y las sucursales de cada usuario. Lo que se ve lo decide el servidor (encabezado
// X-Sucursal); aquí solo se elige y se recuerda la vista.
const Sucursales = (() => {
  const CLAVE_VISTA = 'sucursal_vista';
  let DATOS = { sucursales: [], admin_general: false, vista: 'todas' };
  const $ = id => document.getElementById(id);
  const esc = t => escaparHtml(t == null ? '' : String(t));
  const leerVista = () => { try { return localStorage.getItem(CLAVE_VISTA) || ''; } catch { return ''; } };
  const guardarVista = v => { try { if (v) localStorage.setItem(CLAVE_VISTA, v); else localStorage.removeItem(CLAVE_VISTA); } catch { /* sin almacenamiento */ } };
  const mapa = () => Object.fromEntries(DATOS.sucursales.map(s => [s.id, s.clave]));
  const activas = () => DATOS.sucursales.filter(s => s.activo);
  const varias = () => DATOS.sucursales.length > 1;

  async function cargar() {
    try { DATOS = await api('/sucursales').then(r => r.json()); } catch { return; }
    window.SUCURSALES_MAPA = mapa();
    document.body.classList.toggle('es-general', !!DATOS.admin_general);
    document.body.classList.toggle('varias-sucursales', varias());
    pintarSelector();
    pintarAjustes();
  }
  // Selector de arriba: solo si la persona tiene más de una sucursal (o es el administrador general con varias).
  function pintarSelector() {
    let caja = $('sucursal-selector');
    const mias = DATOS.sucursales.filter(s => s.activo);
    if (mias.length < 2) { if (caja) caja.remove(); return; }
    if (!caja) {
      caja = document.createElement('label'); caja.id = 'sucursal-selector'; caja.className = 'sucursal-selector';
      const ancla = $('sesion-nombre')?.parentElement; ancla?.parentElement?.insertBefore(caja, ancla);
    }
    const v = String(DATOS.vista);
    caja.innerHTML = '<span aria-hidden="true">🏢</span><select id="sucursal-vista" aria-label="Sucursal que estás viendo">'
      + '<option value="todas"' + (v === 'todas' ? ' selected' : '') + '>' + (DATOS.admin_general ? 'Todas las sucursales' : 'Todas mis sucursales') + '</option>'
      + mias.map(s => '<option value="' + Number(s.id) + '"' + (v === String(s.id) ? ' selected' : '') + '>' + esc(s.clave + ' · ' + s.nombre) + '</option>').join('') + '</select>';
    $('sucursal-vista').addEventListener('change', e => { guardarVista(e.target.value === 'todas' ? '' : e.target.value); location.reload(); });
  }
  // Para las tablas de usuarios: casillas de sucursales.
  function casillas(prefijo, elegidas = []) {
    const lista = activas().filter(s => DATOS.admin_general || DATOS.sucursales.some(x => x.id === s.id));
    return '<div class="sucursales-casillas" data-sucursales="' + esc(prefijo) + '">' + lista.map(s => '<label class="check-linea"><input type="checkbox" value="' + Number(s.id) + '"' + (elegidas.includes(s.id) ? ' checked' : '') + '> ' + esc(s.clave) + '</label>').join('') + '</div>';
  }
  const elegidas = prefijo => [...document.querySelectorAll('[data-sucursales="' + prefijo + '"] input:checked')].map(i => Number(i.value));
  const nombreDe = id => { const s = DATOS.sucursales.find(x => x.id === id); return s ? s.clave : '#' + id; };

  // ---------- Ajustes › Sucursales (administrador general) ----------
  function pintarAjustes() {
    const cont = $('lista-sucursales'); if (!cont) return;
    cont.innerHTML = DATOS.sucursales.map((s, i) => '<div class="servicio-row fila-sucursal" data-sucursal="' + Number(s.id) + '">'
      + '<div><label>Nombre</label><input value="' + esc(s.nombre) + '" data-campo="nombre" maxlength="60"></div>'
      + '<div><label>Clave (en folios)</label><input value="' + esc(s.clave) + '" disabled title="La clave no se cambia: ya aparece en los folios"></div>'
      + '<div><label>Dirección</label><input value="' + esc(s.direccion || '') + '" data-campo="direccion" maxlength="200"></div>'
      + '<div><label>Teléfono</label><input value="' + esc(s.telefono || '') + '" data-campo="telefono" maxlength="25"></div>'
      + '<div class="acciones-catalogo"><span class="ayuda">' + Number(s.usuarios || 0) + ' usuario(s)' + (i === 0 ? ' · principal' : '') + (s.activo ? '' : ' · desactivada') + '</span>'
      + '<button type="button" class="btn btn-secundario" data-suc-guardar>Guardar</button>'
      + (i === 0 ? '' : '<button type="button" class="btn btn-outline" data-suc-activo>' + (s.activo ? 'Desactivar' : 'Activar') + '</button>') + '</div></div>').join('');
  }
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-suc-guardar],[data-suc-activo],#btn-crear-sucursal'); if (!b) return;
    b.disabled = true;
    try {
      if (b.id === 'btn-crear-sucursal') {
        const cuerpo = { nombre: $('ns-nombre').value, clave: $('ns-clave').value, direccion: $('ns-direccion').value, telefono: $('ns-telefono').value };
        const r = await api('/sucursales', { method: 'POST', body: JSON.stringify(cuerpo) });
        const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'No se pudo crear');
        ['ns-nombre', 'ns-clave', 'ns-direccion', 'ns-telefono'].forEach(id => { $(id).value = ''; });
        toast('Sucursal ' + j.nombre + ' creada. Ahora asígnale usuarios.');
      } else {
        const fila = b.closest('[data-sucursal]'), id = Number(fila.dataset.sucursal), s = DATOS.sucursales.find(x => x.id === id);
        const cuerpo = b.dataset.sucActivo !== undefined ? { activo: !s.activo } : Object.fromEntries([...fila.querySelectorAll('[data-campo]')].map(i => [i.dataset.campo, i.value]));
        const r = await api('/sucursales/' + id, { method: 'PUT', body: JSON.stringify(cuerpo) });
        const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'No se pudo guardar');
        toast('Sucursal actualizada');
      }
      await cargar();
      if (typeof cargarUsuarios === 'function') cargarUsuarios();
    } catch (err) { toast(err.message); } finally { b.disabled = false; }
  });

  return {
    cargar, casillas, elegidas, nombreDe, varias,
    vista: leerVista, olvidarVista: () => guardarVista(''),
    get datos() { return DATOS; },
  };
})();
window.Sucursales = Sucursales;
