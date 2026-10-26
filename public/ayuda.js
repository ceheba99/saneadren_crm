// Ayudas para leer el sistema a la primera (decisiones del dueño, 2026-10-22):
//  · «?» junto a una cifra: abre, debajo de su grupo, qué es y un ejemplo, en palabras de todos los días. Las
//    explicaciones viven aquí (AYUDAS) para que digan lo mismo en todas las pantallas. Se pone con Ayuda.boton(clave)
//    dentro de un contenedor con data-ayuda-zona; la caja de explicación se crea justo después de él.
//  · «¿Qué significa…?»: un botón con data-leyenda="id" abre y cierra el bloque con ese id.
//  · Campos obligatorios: en el código la etiqueta dice «(obligatorio)» (así lo revisa la auditoría); en pantalla se ve
//    un * rojo. «(opcional)» se queda escrito. Lectores de pantalla y el texto al pasar el ratón siguen diciendo
//    «obligatorio».
const Ayuda = (() => {
  // [título, qué es, ejemplo]. Cada definición está revisada contra el cálculo del servidor.
  const AYUDAS = {
    // Cuentas por cobrar y estado de cuenta del cliente
    te_deben: ['Te deben', 'Lo que los clientes ya deben: servicios marcados como realizados o ya facturados que todavía no se cobran completos.', 'Una limpieza realizada de $3,000 de la que el cliente pagó $1,000: aquí suma $2,000.'],
    debe_hoy: ['Debe hoy', 'Lo que este cliente ya debe: sus servicios marcados como realizados o ya facturados que todavía no se cobran completos.', 'Le hiciste una limpieza de $3,000 y pagó $1,000: debe $2,000.'],
    vencido: ['Vencido', 'La parte de lo que se debe cuya fecha límite de pago ya pasó. La fecha límite es la de la factura (o la del servicio, si no hay factura) más los días de crédito del cliente.', 'Factura del 1 de octubre con 15 días de crédito: vence el 16; desde el 17 cuenta como vencida.'],
    por_concluir: ['Por concluir', 'Servicios cuya fecha ya pasó, pero nadie ha marcado si se hicieron y no están facturados. Todavía no se cobran: ábrelos y márcalos como realizados (pasan a lo que se debe) o como no realizados.', 'Una limpieza del 15 de octubre que nadie ha marcado.'],
    por_realizar: ['Por realizar', 'Servicios agendados para una fecha que todavía no llega. Aún no se cobran.', 'Una limpieza programada para el 30 de octubre.'],
    a_favor: ['A favor del cliente', 'Dinero que un cliente pagó por un servicio que al final no se hizo: hay que devolvérselo o aplicarlo a otro servicio.', 'Dio $1,000 de anticipo y el servicio se canceló.'],
    pagado_total: ['Pagado en total', 'Todo lo que este cliente ha pagado, sumando todos sus pagos que no se cancelaron (sin ajustes ni descuentos).', 'Tres pagos de $2,000: $6,000.'],
    cobrado_mes: ['Cobrado este mes', 'Todo lo que se registró como cobrado en el mes, incluidos los pagos que aún falta confirmar (sin ajustes ni descuentos).', 'Tres pagos de $2,000 en octubre: $6,000.'],
    por_confirmar: ['Por confirmar', 'Pagos que anotaron vendedores o técnicos y que administración todavía debe revisar (que el dinero sí llegó).', 'El técnico anotó $1,250 en efectivo; queda aquí hasta que alguien lo confirme.'],
    // Cuentas por pagar
    pagar_semana: ['Pagar esta semana', 'Facturas y gastos de proveedores que vencen de hoy al domingo, más los que ya están vencidos.', 'Una renta de pipa que vence el viernes y un diésel que venció ayer.'],
    por_pagar: ['Por pagar', 'Todo lo que se les debe a proveedores hoy, venza cuando venza.', 'Lo de esta semana más lo que vence el próximo mes.'],
    pagado_mes: ['Pagado este mes', 'Lo que se les pagó a proveedores en el mes.', 'Dos transferencias de $5,000 en octubre: $10,000.'],
    debes_vencido: ['Vencido con proveedores', 'Lo que se les debe a proveedores cuya fecha de pago ya pasó.', 'Una factura con 15 días de crédito del 1 de octubre: desde el 17 aparece aquí si no se pagó.'],
    // Resultados · Panorama general
    pg_venta: ['Venta realizada', 'Lo vendido en el periodo: las órdenes marcadas como realizadas, por la fecha en que se hicieron, sin IVA. Una orden contratada que todavía no se marca no cuenta aquí.', 'Dos limpiezas realizadas en octubre de $5,000 y $3,000 más IVA: $8,000.'],
    pg_utilidad: ['Utilidad estimada', 'La venta realizada menos los gastos del periodo, ambos sin IVA. Las compras de bienes, préstamos y traspasos no se restan. El margen dice qué porcentaje de la venta queda.', 'Venta de $100,000 y gastos de $70,000: utilidad de $30,000, margen de 30 %.'],
    pg_cobrado: ['Dinero cobrado', 'Los pagos de clientes con fecha dentro del periodo (sin ajustes ni descuentos), aunque sean de servicios de otros meses.', 'En octubre te pagaron una limpieza de septiembre y una de octubre: cuentan las dos.'],
    pg_pagado: ['Pagado a proveedores', 'Los pagos a proveedores con fecha dentro del periodo: el dinero que salió.', 'Pagaste una renta de pipa de $8,000 y diésel por $2,000: $10,000.'],
    pg_flujo: ['Flujo de efectivo', 'Dinero cobrado menos pagado a proveedores en el periodo. Si es negativo, salió más dinero del que entró.', 'Cobraste $80,000 y pagaste $95,000: flujo de −$15,000.'],
    pg_gastos: ['Gastos del periodo', 'Las facturas y gastos de proveedores con fecha de documento en el periodo, sin IVA (abajo, con IVA). No incluye compras de bienes, préstamos ni traspasos. Si una factura no trae el IVA capturado, se estima.', 'Una factura de diésel de $1,160 con IVA cuenta $1,000.'],
    pg_dias_cobro: ['Días para cobrar', 'En promedio, cuántos días pasan desde que se hace el servicio hasta que se termina de cobrar, en las órdenes que se liquidaron en el periodo.', 'Servicio del 1 de octubre y último pago el 21: 20 días.'],
    pg_servicios: ['Servicios realizados', 'Las órdenes marcadas como realizadas en el periodo. El ticket promedio es la venta realizada entre el número de servicios.', '10 servicios que suman $50,000: ticket promedio de $5,000.'],
    pg_no_realizados: ['No realizados', 'Las órdenes con fecha en el periodo que se marcaron como no realizadas, y su importe.', 'El cliente canceló una limpieza de $4,000 el mismo día.'],
    pg_sin_marcar: ['Sin marcar', 'Las órdenes con fecha pasada que nadie ha marcado como realizadas o no realizadas (también las ya facturadas). No cuentan como venta hasta marcarlas.', 'Una limpieza del 15 de octubre que nadie marcó.'],
    pg_proximos: ['Próximos 7 días', 'Las órdenes contratadas con fecha de hoy a 7 días que todavía no se marcan, y su importe: el trabajo de la semana.', 'Tres limpiezas agendadas para esta semana por $12,000.'],
    pg_cotizaciones: ['Cotizaciones', 'Las cotizaciones creadas en el periodo y su importe (no cuenta las órdenes que se registraron directo, sin cotizar).', 'Hiciste 12 cotizaciones en octubre por $180,000.'],
    pg_cierre: ['Tasa de cierre', 'De las cotizaciones del periodo que ya se decidieron, cuántas se ganaron: ganadas entre ganadas más no aceptadas. Las que siguen abiertas no cuentan.', '6 ganadas y 4 no aceptadas: 60 %.'],
    pg_abiertas: ['Propuestas abiertas', 'Las cotizaciones que siguen abiertas hoy (de cualquier fecha) y su importe: lo que está en negociación.', '8 cotizaciones sin respuesta por $95,000.'],
    pg_clientes: ['Clientes atendidos', 'Los clientes con al menos un servicio realizado en el periodo. Nuevos: su primer servicio realizado fue en el periodo. Recurrentes: ya tenían servicios antes.', '15 clientes: 4 nuevos y 11 que ya eran clientes.'],
    pg_contactos: ['Contactos nuevos', 'Los contactos que se dieron de alta en el periodo, con o sin cotización.', 'Llamaron 20 personas nuevas y se registraron.'],
    pg_satisfaccion: ['Satisfacción', 'El promedio de las encuestas que contestaron los clientes en el periodo (con el QR de su orden), del 1 pésimo al 5 excelente. El NPS es el % que nos recomendaría (9 o 10) menos el % que no (0 a 6): va de −100 a 100.', 'Dos encuestas de 5 y una de 4: 4.7 de 5. Si de 10 clientes 7 dan 9 o 10 y 1 da 5 o menos: NPS 60.'],
    // Resultados · Análisis comercial
    ac_nuevos: ['Contactos nuevos', 'Los contactos que se dieron de alta en el periodo.', '20 personas nuevas registradas en octubre.'],
    ac_clientes: ['Clientes con servicios realizados', 'Los clientes con al menos un servicio realizado en el periodo, por la fecha en que se realizó.', '15 clientes distintos atendidos en octubre.'],
    ac_vendido: ['Vendido', 'La suma sin IVA de los servicios realizados en el periodo. Lo vendido no es lo cobrado: un servicio puede seguir pendiente de pago.', 'Dos limpiezas realizadas de $5,000 y $3,000: $8,000 vendidos.'],
    ac_servicios: ['Servicios realizados', 'Cuántas órdenes se marcaron como realizadas en el periodo.', '10 limpiezas hechas en octubre.'],
    ac_por_realizar: ['Por realizar', 'Las órdenes contratadas con fecha en el periodo que todavía no se marcan como realizadas ni no realizadas: cuántas y su importe sin IVA. Cuentan como vendido cuando se marquen realizadas.', '3 limpiezas de esta semana por $12,000.'],
    ac_conversion: ['Conversión de contactos nuevos', 'De los contactos nuevos del periodo, qué porcentaje ya tiene al menos un servicio realizado (hasta hoy).', 'De 20 contactos nuevos, 5 ya contrataron y se les hizo el servicio: 25 %.'],
    ac_promedio: ['Promedio por servicio', 'Lo vendido entre el número de servicios realizados, sin IVA.', '$50,000 en 10 servicios: $5,000 por servicio.'],
    ac_recurrentes: ['Clientes recurrentes activos', 'Los clientes con servicio realizado en el periodo que ya tienen más de un servicio realizado en total.', 'Un hospital al que le haces limpieza cada mes.'],
    ac_propuestas: ['Importe en propuestas abiertas', 'La suma sin IVA de las cotizaciones creadas en el periodo que siguen abiertas.', '4 cotizaciones de octubre sin respuesta por $60,000.'],
  };
  const esc = t => escaparHtml(t == null ? '' : String(t)); // app.js se carga después; se usa al pintar
  const boton = clave => (AYUDAS[clave] ? '<button type="button" class="tarjeta-ayuda" data-ayuda="' + clave + '" aria-expanded="false" aria-label="Qué es: ' + esc(AYUDAS[clave][0]) + '">?</button>' : '');
  // Cierra la explicación de una zona (al volver a pintarla).
  const cerrar = zona => { const c = zona?.nextElementSibling; if (c?.classList.contains('ayuda-caja')) c.hidden = true; };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-ayuda]');
    if (b) {
      const zona = b.closest('[data-ayuda-zona]'); if (!zona) return;
      let caja = zona.nextElementSibling;
      if (!caja?.classList.contains('ayuda-caja')) { caja = document.createElement('div'); caja.className = 'ayuda-caja'; caja.setAttribute('role', 'status'); zona.after(caja); }
      const abierta = b.getAttribute('aria-expanded') === 'true';
      zona.querySelectorAll('[data-ayuda]').forEach(x => x.setAttribute('aria-expanded', 'false'));
      if (abierta) { caja.hidden = true; return; }
      const [titulo, texto, ejemplo] = AYUDAS[b.dataset.ayuda] || [];
      caja.innerHTML = '<b>' + esc(titulo) + '</b><p>' + esc(texto) + '</p>' + (ejemplo ? '<p class="ayuda-caja-ej">Ejemplo: ' + esc(ejemplo) + '</p>' : '');
      caja.hidden = false; b.setAttribute('aria-expanded', 'true');
      return;
    }
    const l = e.target.closest('[data-leyenda]'); if (!l) return;
    const bloque = document.getElementById(l.dataset.leyenda); if (!bloque) return;
    const abrir = l.getAttribute('aria-expanded') !== 'true';
    l.setAttribute('aria-expanded', String(abrir)); bloque.hidden = !abrir;
  });

  // ---- Campos obligatorios: «(obligatorio)» o «(MXN, obligatorio)» en la etiqueta → * rojo ----
  const ETIQUETAS = 'label, legend, .etiqueta-campo';
  const OBLIGATORIO = /\s*\(([^()]*?),?\s*obligatorio\)/;
  function marcar(raiz) {
    const lista = raiz.matches?.(ETIQUETAS) ? [raiz] : [];
    raiz.querySelectorAll?.(ETIQUETAS).forEach(el => lista.push(el));
    for (const el of lista) {
      if (el.querySelector(':scope > .req')) continue;
      for (const n of el.childNodes) {
        if (n.nodeType !== 3) continue;
        const m = n.nodeValue.match(OBLIGATORIO); if (!m) continue;
        const resto = m[1].trim();
        n.nodeValue = n.nodeValue.replace(OBLIGATORIO, resto ? ' (' + resto + ')' : '');
        const req = document.createElement('span');
        req.className = 'req'; req.title = 'Obligatorio';
        req.innerHTML = '<span aria-hidden="true">*</span><span class="sr-only"> (obligatorio)</span>';
        n.after(req);
        break;
      }
    }
  }
  const pendientes = new Set();
  let programado = false;
  new MutationObserver(cambios => {
    for (const c of cambios) if (c.target.nodeType === 1) pendientes.add(c.target);
    if (programado) return;
    programado = true;
    queueMicrotask(() => { programado = false; for (const t of pendientes) marcar(t.closest?.(ETIQUETAS) || t); pendientes.clear(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => marcar(document.body)); else marcar(document.body);

  return { boton, cerrar, AYUDAS };
})();
window.Ayuda = Ayuda;
