/* Comportamiento de presentación. No modifica datos ni sustituye reglas del CRM. */
(() => {
  const layer = document.createElement('div');
  layer.className = 'overlay';
  layer.id = 'overlay-confirmacion';
  layer.innerHTML = `<div class="modal dialogo-confirmacion"><div class="modal-header"><h2 id="dialogo-titulo"></h2><button class="close-btn" type="button" aria-label="Cerrar ventana">✕</button></div><div class="modal-body dialogo-contenido"><p class="dialogo-mensaje" id="dialogo-mensaje"></p><div class="dialogo-acciones"><button class="btn btn-secundario" id="dialogo-cancelar">Cancelar</button><button class="btn btn-peligro" id="dialogo-aceptar"></button></div></div></div>`;
  document.body.append(layer);
  let resolver = null;
  const finish = value => { layer.classList.remove('mostrar'); const done = resolver; resolver = null; if(done) done(value); };
  layer.querySelector('.close-btn').onclick = () => finish(null);
  document.getElementById('dialogo-cancelar').onclick = () => finish(null);
  window.solicitarDialogo = ({titulo,mensaje,aceptar='Confirmar'}) => {
    if(resolver) return Promise.resolve(null);
    document.getElementById('dialogo-titulo').textContent = titulo;
    document.getElementById('dialogo-mensaje').textContent = mensaje;
    document.getElementById('dialogo-aceptar').textContent = aceptar;
    document.getElementById('dialogo-aceptar').onclick = () => finish(true);
    layer.classList.add('mostrar');
    return new Promise(resolve => { resolver = resolve; });
  };
  const overlays = [...document.querySelectorAll('.overlay')];
  let stack = [];
  const previousFocus = new Map();
  const focusable = el => [...el.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(e=>!e.disabled && !e.closest('[hidden]') && e.getClientRects().length);
  overlays.forEach((overlay,i) => {
    const modal = overlay.querySelector('.modal');
    const title = modal.querySelector('h2');
    if(!title.id) title.id = 'ventana-titulo-'+i;
    modal.setAttribute('role','dialog'); modal.setAttribute('aria-labelledby',title.id); modal.tabIndex=-1;
    overlay.querySelectorAll('.close-btn').forEach(b=>{ b.setAttribute('aria-label','Cerrar ventana'); b.type='button'; });
  });
  function sync() {
    const open = overlays.filter(o=>o.classList.contains('mostrar'));
    const removed = stack.filter(o=>!open.includes(o));
    stack = stack.filter(o=>open.includes(o));
    open.filter(o=>!stack.includes(o)).forEach(o=>{ previousFocus.set(o,document.activeElement);stack.push(o); });
    const top = stack.at(-1);
    document.body.classList.toggle('modal-abierta',!!top);
    document.querySelectorAll('body > header,body > main').forEach(e=>e.inert=!!top);
    overlays.forEach(o=>{
      const active=o===top;
      o.inert=!active;
      o.classList.toggle('modal-superior',active);
      o.setAttribute('aria-hidden',String(!active));
      o.querySelector('.modal').setAttribute('aria-modal',String(active));
    });
    if(top && !top.contains(document.activeElement)) {
      const restored = removed.length ? previousFocus.get(removed.at(-1)) : null;
      const target = restored && top.contains(restored) && restored.isConnected ? restored : (top===layer ? document.getElementById('dialogo-cancelar') : focusable(top)[0]);
      (target || top.querySelector('.modal')).focus();
    } else if(!top && removed.length) {
      const restored=previousFocus.get(removed[0]);
      if(restored?.isConnected && !restored.closest('[inert]') && restored.getClientRects().length) restored.focus();
      else document.querySelector('header.app nav button.activa')?.focus();
    }
  }
  window.abrirVentana = id => {
    const overlay = document.getElementById(id);
    previousFocus.set(overlay,document.activeElement);
    overlay.classList.add('mostrar');
    stack = stack.filter(o=>o!==overlay);
    stack.push(overlay);
    sync();
  };
  const observer=new MutationObserver(records=>{ if(records.some(r=>(r.type==='childList' && stack.at(-1) && !stack.at(-1).contains(document.activeElement)) || (r.attributeName==='class' && overlays.includes(r.target) && r.target.classList.contains('mostrar') !== (r.oldValue||'').split(/\s+/).includes('mostrar')))) sync(); });
  overlays.forEach(o=>observer.observe(o,{attributes:true,attributeFilter:['class'],attributeOldValue:true,childList:true,subtree:true}));
  document.addEventListener('keydown',e=>{
    const top=stack.at(-1);if(!top)return;
    if(e.key==='Escape') {e.preventDefault();if(top.id!=='overlay-login')top.querySelector('.close-btn')?.click();}
    if(e.key==='Tab') {
      const items=focusable(top); const first=items[0],last=items.at(-1);
      if(!first){e.preventDefault();top.querySelector('.modal').focus();return;}
      if(e.shiftKey && (document.activeElement===first || !items.includes(document.activeElement))){e.preventDefault();last.focus();}
      else if(!e.shiftKey && (document.activeElement===last || !items.includes(document.activeElement))){e.preventDefault();first.focus();}
    }
  });
  document.querySelectorAll('.campo,.campo-modal').forEach(c=>{const label=c.querySelector('label');const input=c.querySelector('input,select,textarea');if(label && input?.id)label.htmlFor=input.id;});
  document.querySelectorAll('.kpi-card,.pipeline-step').forEach(e=>{e.tabIndex=0;e.setAttribute('role','button');e.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();e.click();}});});
  sync();
})();
