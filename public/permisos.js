// Permisos en pantalla: lo que puede hacer quien está conectado (lo decide Dirección en «Roles y permisos»).
// La pantalla solo ESCONDE lo que no aplica; el candado real está en el servidor.
//  · Permisos.puede('clave') para lo que se arma en código.
//  · Clases para lo que ya está en la página: «perm-<clave>» se esconde si NO tiene el permiso y «noperm-<clave>» si SÍ
//    lo tiene (la clave con guiones: cxc.ver → perm-cxc-ver). Sirve también para lo que se agrega después.
//  · «Ver como este rol» (solo Dirección): la pantalla y el servidor usan los permisos de ese rol, y no se guarda nada.
const Permisos = (() => {
  const CLAVE_VER = 'ver_como';
  let DATOS = { rol: null, rol_nombre: '', permisos: [], direccion: false, ver_como: null };
  let TODAS = [];
  const clase = c => String(c).replace(/[^a-z0-9_]+/gi, '-'); // ordenes_compra.ver → perm-ordenes_compra-ver
  const leerVerComo = () => { try { return sessionStorage.getItem(CLAVE_VER) || ''; } catch { return ''; } };
  const encabezado = () => { const v = leerVerComo(); return v ? { 'X-Ver-Como': v } : {}; };
  const puede = c => DATOS.rol === 'admin' || DATOS.permisos.includes(c);
  // Solo Dirección (lo de todas las sucursales); viendo como otro rol, no.
  const direccion = () => !!DATOS.direccion && !DATOS.ver_como;

  function pintarEstilos() {
    let st = document.getElementById('estilos-permisos');
    if (!st) { st = document.createElement('style'); st.id = 'estilos-permisos'; document.head.appendChild(st); }
    const tiene = new Set(DATOS.permisos);
    const reglas = TODAS.map(c => tiene.has(c) || DATOS.rol === 'admin' ? `.noperm-${clase(c)}{display:none!important}` : `.perm-${clase(c)}{display:none!important}`);
    st.textContent = reglas.join('\n');
    document.body.classList.add('permisos-listos');
  }
  function pintarAviso() {
    let b = document.getElementById('aviso-ver-como');
    if (!DATOS.ver_como) { if (b) b.remove(); document.body.classList.remove('viendo-como'); return; }
    if (!b) { b = document.createElement('div'); b.id = 'aviso-ver-como'; b.className = 'aviso-ver-como'; b.setAttribute('role', 'status'); document.body.prepend(b); }
    b.innerHTML = '<span>Estás viendo el sistema como <b>' + escaparHtml(DATOS.rol_nombre) + '</b>. Solo se puede mirar: nada se guarda.</span>'
      + '<button type="button" class="btn btn-outline btn-chico" id="ver-como-salir">Salir de esta vista</button>';
    b.querySelector('#ver-como-salir').addEventListener('click', () => verComo(''));
    document.body.classList.add('viendo-como');
  }
  async function cargar() {
    let r;
    try { r = await api('/permisos/mios'); } catch { return; }
    if (!r.ok) { if (leerVerComo()) { verComo(''); } return; }
    DATOS = await r.json();
    TODAS = DATOS.todas || [];
    pintarEstilos();
    pintarAviso();
  }
  function verComo(rol) {
    try { if (rol) sessionStorage.setItem(CLAVE_VER, rol); else sessionStorage.removeItem(CLAVE_VER); } catch { /* sin almacenamiento */ }
    location.reload();
  }
  return { cargar, puede, direccion, encabezado, verComo, get datos() { return DATOS; }, clase };
})();
