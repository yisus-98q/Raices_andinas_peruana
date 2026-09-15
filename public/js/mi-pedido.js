/**
 * Seguimiento del pedido, del lado del cliente.
 *
 * Se entra con el código MÁS los últimos cuatro dígitos del teléfono. Los dos
 * juntos son un segundo factor: con solo el código, cualquiera que lo adivinara
 * vería el pedido de otra persona. El servidor nunca devuelve el teléfono ni la
 * dirección completa, aunque los dos datos sean correctos.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const soles = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return 'S/ —';
    return 'S/ ' + v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // La secuencia que ve el cliente. `anulado` y `devuelto` salen del carril.
  const PASOS = [
    ['pendiente', 'Recibido', 'Tenemos tu pedido y lo estamos revisando.'],
    ['preparando', 'En preparación', 'Estamos armando tu pedido en el local.'],
    ['enviado', 'En camino', 'Salió con el repartidor.'],
    ['entregado', 'Entregado', 'El pedido llegó a su destino.'],
  ];
  const FUERA = {
    anulado: ['Anulado', 'Este pedido fue anulado. Si no lo pediste tú, escríbenos.'],
    devuelto: ['Devuelto', 'Registramos la devolución de este pedido.'],
  };

  let ultimo = null;

  async function consultar(ruta = '/api/seguimiento') {
    const codigo = $('f-codigo').value.trim();
    const telefono = $('f-tel4').value.trim();
    const error = $('error');
    error.hidden = true;

    if (!codigo || telefono.replace(/\D/g, '').length < 4) {
      error.textContent = 'Escribe el código y los últimos 4 dígitos de tu teléfono.';
      error.hidden = false;
      return;
    }

    const boton = $('btn-consultar');
    boton.disabled = true;
    boton.textContent = 'Buscando…';

    try {
      const r = await fetch(ruta, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, telefono }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'No pudimos consultar tu pedido.');
      ultimo = d;
      pintar(d);
    } catch (e) {
      // Si ya se está viendo el pedido (confirmar recepción), el error se dice
      // ahí mismo: el formulario quedó fuera de la vista.
      if (enResultado) return alert(e.message);
      error.textContent = e.message;
      error.hidden = false;
    } finally {
      boton.disabled = false;
      boton.textContent = 'Ver mi pedido';
    }
  }

  /**
   * La pasarela: formulario y pedido van lado a lado, y se pasa de uno a otro
   * deslizando. El panel que no se ve se pliega al terminar el movimiento, para
   * que su alto no deje un hueco debajo del que sí se ve.
   */
  let enResultado = false;
  const reduceMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function deslizar(alResultado) {
    const pasarela = $('pasarela');
    const entra = alResultado ? $('resultado') : $('forma');
    const sale = alResultado ? $('forma') : $('resultado');
    enResultado = alResultado;
    entra.classList.remove('oculto');
    entra.removeAttribute('inert');
    sale.setAttribute('inert', '');
    void pasarela.offsetWidth; // que el navegador vea el panel antes de moverlo
    pasarela.classList.toggle('ver-resultado', alResultado);
    document.querySelector('.caja-seguimiento').classList.toggle('con-resultado', alResultado);

    const plegar = () => { if (enResultado === alResultado) sale.classList.add('oculto'); };
    if (reduceMovimiento) plegar();
    else setTimeout(plegar, 560);

    // En el celular, que el pedido quede a la vista sin buscarlo.
    const arriba = pasarela.getBoundingClientRect().top;
    if (arriba < 0 || arriba > innerHeight * .5) {
      scrollTo({ top: scrollY + arriba - 16, behavior: reduceMovimiento ? 'auto' : 'smooth' });
    }
    if (!alResultado) $('f-codigo').focus({ preventScroll: true });
  }

  /** Estado, detalle y productos: diapositivas de lado, con pestañas. */
  function prepararCarril() {
    const carril = $('carril');
    const pestanas = [...document.querySelectorAll('.p-pestanas [data-ir]')];
    const marcar = (n) => {
      pestanas.forEach((b, i) => b.setAttribute('aria-selected', String(i === n)));
      document.querySelector('.p-pestanas').style.setProperty('--tab', n);
    };
    pestanas.forEach((b, i) => {
      b.onclick = () => {
        carril.scrollTo({ left: i * carril.clientWidth, behavior: reduceMovimiento ? 'auto' : 'smooth' });
        marcar(i);
      };
    });
    let tic;
    carril.addEventListener('scroll', () => {
      clearTimeout(tic);
      tic = setTimeout(() => marcar(Math.round(carril.scrollLeft / carril.clientWidth)), 60);
    }, { passive: true });
  }

  function pintar(d) {
    const fuera = FUERA[d.estado];
    const indice = PASOS.findIndex(([e]) => e === d.estado);
    const doc = d.tipoComprobante === 'factura' ? 'Factura' : 'Boleta';

    $('resultado').innerHTML = `
      <div class="p-cabeza">
        <button type="button" class="p-volver" id="btn-volver" aria-label="Buscar otro pedido" title="Buscar otro pedido">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
        </button>
        <div class="p-cabeza-codigo">
          <span class="p-etiqueta">Pedido</span>
          <strong class="p-codigo">${esc(d.codigo)}</strong>
        </div>
        <div class="p-derecha">
          <span class="p-etiqueta">Total</span>
          <strong class="p-total">${soles(d.total)}</strong>
        </div>
      </div>

      <div class="p-pestanas" role="tablist" style="--tab:0">
        <button type="button" role="tab" data-ir="0" aria-selected="true">Estado</button>
        <button type="button" role="tab" data-ir="1" aria-selected="false">Detalle</button>
        <button type="button" role="tab" data-ir="2" aria-selected="false">Productos</button>
      </div>

      <div class="p-carril" id="carril">
      <div class="p-diapo" role="tabpanel" aria-label="Estado">
      ${fuera ? `
        <div class="p-fuera">
          <strong>${esc(fuera[0])}</strong>
          <span>${esc(fuera[1])}</span>
        </div>`
      : `
        <ol class="p-linea">
          ${PASOS.map(([, titulo, texto], i) => `
            <li class="${i < indice ? 'hecho' : i === indice ? 'actual' : ''}">
              <span class="p-punto"></span>
              <div>
                <strong>${esc(titulo)}</strong>
                <span>${PASOS[i][0] === 'enviado' && d.repartidor && i === indice
                  ? `Te lo lleva <b>${esc(d.repartidor)}</b>.` : esc(texto)}</span>
              </div>
            </li>`).join('')}
        </ol>`}
      ${pieDeAccion(d)}
      </div>

      <div class="p-diapo" role="tabpanel" aria-label="Detalle">
      <div class="p-datos">
        <div><span>Fecha</span><b>${esc(String(d.fecha).slice(0, 16))}</b></div>
        <div><span>Entrega en</span><b>${esc(d.entrega || '—')}</b></div>
        <div><span>Dirección</span><b>${esc(d.direccion)}</b></div>
        ${d.comprobante ? `<div><span>${doc}</span>
          <b>${esc(d.comprobante)}</b></div>` : ''}
      </div>

      ${d.comprobante ? (() => {
        const tel4 = $('f-tel4').value.trim().replace(/\D/g, '').slice(-4);
        const llave = `codigo=${encodeURIComponent(d.codigo)}&tel=${encodeURIComponent(tel4)}`;
        const nombre = d.tipoComprobante === 'factura' ? 'factura' : 'boleta';
        return `
        <div class="p-acciones">
          <a class="btn btn-primario" href="/comprobante.html?${llave}">
            Ver mi ${nombre}
          </a>
        </div>`;
      })() : ''}
      </div>

      <div class="p-diapo" role="tabpanel" aria-label="Productos">
      <table class="p-items">
        <tbody>
          ${d.items.map((i) => `
            <tr>
              <td>${i.cantidad} ×</td>
              <td>${esc(i.nombre)}</td>
              <td class="d">${soles(i.subtotal)}</td>
            </tr>`).join('')}
          <tr class="p-envio">
            <td></td><td>Envío</td>
            <td class="d">${d.envio > 0 ? soles(d.envio) : 'Gratis'}</td>
          </tr>
          <tr class="p-suma">
            <td></td><td>Total</td>
            <td class="d">${soles(d.total)}</td>
          </tr>
        </tbody>
      </table>
      </div>
      </div>`;

    prepararCarril();
    $('btn-volver').onclick = () => deslizar(false);
    const btn = $('btn-recibido');
    if (btn) btn.onclick = confirmarRecepcion;
    if (!enResultado) deslizar(true);
  }

  /**
   * La constancia de recepción es lo que cierra la venta contra entrega: el
   * cliente confirma que le llegó, y eso queda con fecha y hora en el sistema
   * sin depender de la palabra del repartidor.
   */
  function pieDeAccion(d) {
    if (d.recibidoEn) {
      return `<div class="p-recibido">
        <strong>Recepción confirmada</strong>
        <span>Confirmaste que recibiste este pedido el ${esc(String(d.recibidoEn).slice(0, 16))}.
              ¡Gracias por la compra!</span>
      </div>`;
    }
    if (d.estado === 'anulado' || d.estado === 'devuelto') return '';
    if (d.estado !== 'enviado' && d.estado !== 'entregado') {
      return `<p class="p-nota">Cuando el pedido salga del local vas a poder
        confirmar aquí que lo recibiste.</p>`;
    }
    return `
      <div class="p-confirmar">
        <p>¿Ya te llegó tu pedido? Confírmalo para cerrar la entrega.</p>
        <button class="btn btn-primario" id="btn-recibido">Sí, ya lo recibí</button>
      </div>`;
  }

  async function confirmarRecepcion() {
    if (!confirm('¿Confirmas que recibiste tu pedido completo y en buen estado?')) return;
    await consultar('/api/seguimiento/recibido');
  }

  $('forma').onsubmit = (e) => { e.preventDefault(); consultar(); };

  // Si llegan desde la pantalla de compra, el código ya viene en la URL.
  const codigoUrl = new URLSearchParams(location.search).get('codigo');
  if (codigoUrl) {
    $('f-codigo').value = codigoUrl;
    $('f-tel4').focus();
  }

  // Solo dígitos en el campo del teléfono.
  $('f-tel4').oninput = (e) => { e.target.value = e.target.value.replace(/\D/g, ''); };
  void ultimo;
})();
