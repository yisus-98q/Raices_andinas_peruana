/**
 * Representación impresa del comprobante.
 *
 * En Perú el documento legal es el XML; esto es la "representación impresa",
 * que es lo que el cliente ve y se lleva. Tiene que mostrar exactamente los
 * mismos importes que el XML — por eso todo sale del mismo endpoint y no se
 * recalcula nada aquí.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const s = (n) => Number(n).toLocaleString('es-PE',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /**
   * La misma página sirve a los dos lados del mostrador.
   *
   * La tienda entra con `?id=` y su sesión. El comprador entra desde el
   * seguimiento con `?codigo=` y los últimos cuatro dígitos de su teléfono: el
   * mismo par con el que ya consulta su pedido, porque obligarlo a tener
   * usuario para recoger su propia boleta no tendría sentido. El documento que
   * se pinta sale del mismo sitio en los dos casos, así que los importes no
   * pueden diferir.
   */
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const codigo = params.get('codigo');
  const tel = params.get('tel');
  const esComprador = !id && codigo && tel;

  const traer = () => (esComprador
    ? fetch('/api/seguimiento/comprobante', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo, telefono: tel }),
    })
    : fetch('/api/comprobantes/' + encodeURIComponent(id)));

  const ESTADOS = {
    pendiente_envio: ['Pendiente de envío a SUNAT', 'pendiente'],
    enviado: ['Enviado a SUNAT', 'enviado'],
    aceptado: ['Aceptado por SUNAT', 'aceptado'],
    rechazado: ['Rechazado por SUNAT', 'rechazado'],
    anulado: ['Anulado', 'rechazado'],
  };

  async function pintar() {
    if (!id && !esComprador) return fallar('Falta el número de comprobante.');

    const r = await traer();
    if (r.status === 401) {
      location.replace('/login.html?volver=' + encodeURIComponent(location.pathname + location.search));
      return;
    }
    if (!r.ok) {
      const d = await r.json().catch(() => null);
      return fallar(d?.error || 'No se encontró el comprobante.');
    }

    const c = await r.json();
    document.title = `${c.tipoNombre} ${c.numero} — Raíz Andina`;

    const [textoEstado, claseEstado] = ESTADOS[c.estado] || [c.estado, 'pendiente'];

    $('doc').innerHTML = `
      <header class="doc-cabeza">
        <div class="doc-emisor">
          <img src="/img/marca/emblema.png" alt="" width="52" height="52">
          <div>
            <strong>${esc(c.emisor.razonSocial)}</strong>
            <span>${esc(c.emisor.nombreComercial)}</span>
            <span>${esc(c.emisor.direccion)}</span>
          </div>
        </div>
        <div class="doc-numero">
          <div class="doc-ruc">R.U.C. ${esc(c.emisor.ruc)}</div>
          <div class="doc-tipo">${esc(c.tipoNombre)}</div>
          <div class="doc-serie">${esc(c.numero)}</div>
        </div>
      </header>

      <section class="doc-cliente">
        <div><b>Señor(es):</b> ${esc(c.cliente.nombre)}</div>
        <div><b>${esc(c.cliente.tipoDocNombre)}:</b> ${esc(c.cliente.numDoc)}</div>
        <div><b>Dirección:</b> ${esc(c.cliente.direccion)}</div>
        <div><b>Fecha de emisión:</b> ${esc(c.fechaEmision)}</div>
        <div><b>Moneda:</b> Soles (${esc(c.moneda)})</div>
        ${c.nota ? `<div><b>Documento que modifica:</b> ${esc(c.nota.referencia)}</div>
                    <div><b>Motivo:</b> ${esc(c.nota.descripcion || c.nota.motivo)}</div>` : ''}
      </section>

      <table class="doc-tabla">
        <thead>
          <tr>
            <th class="c">Cant.</th><th class="c">U.M.</th><th>Descripción</th>
            <th class="d">V. unitario</th><th class="d">P. unitario</th><th class="d">Importe</th>
          </tr>
        </thead>
        <tbody>
          ${c.items.map((i) => `
            <tr>
              <td class="c">${i.cantidad}</td>
              <td class="c">${esc(i.unidad)}</td>
              <td>${esc(i.descripcion)}<small>${esc(i.codigo)}</small></td>
              <td class="d">${s(i.valorUnitario)}</td>
              <td class="d">${s(i.precioUnitario)}</td>
              <td class="d">${s(i.importe)}</td>
            </tr>`).join('')}
        </tbody>
      </table>

      <section class="doc-cierre">
        <div class="doc-letras">
          <div class="doc-son">${esc(c.totales.enLetras)}</div>
          <!-- Solo la imagen: la cadena del QR (RUC|tipo|serie|…) impresa como
               texto no le dice nada a quien recibe la boleta. El dato va
               dentro del QR y en el XML. -->
          <div class="doc-qr">
            <div class="qr-caja" id="qr"></div>
          </div>
        </div>
        <div class="doc-totales">
          <div><span>Op. gravadas</span><b>S/ ${s(c.totales.gravadas)}</b></div>
          <div><span>I.G.V. ${c.totales.porcentajeIgv}%</span><b>S/ ${s(c.totales.igv)}</b></div>
          <div class="doc-total"><span>Importe total</span><b>S/ ${s(c.totales.total)}</b></div>
        </div>
      </section>

      <footer class="doc-pie">
        <span class="doc-estado ${claseEstado}">${esc(textoEstado)}</span>
        <span>Representación impresa del comprobante electrónico.
              El documento legal es el archivo XML.</span>
      </footer>`;

    $('acciones').hidden = false;
    pintarQr(c.qr);

    // Un enlace al panel no tiene por qué existir en la pantalla de un
    // cliente: desde ahí se vuelve a su pedido.
    if (esComprador) {
      const volver = $('btn-volver');
      volver.href = '/mi-pedido.html?codigo=' + encodeURIComponent(codigo);
      volver.textContent = '← Volver a mi pedido';
    }
  }

  /**
   * El código QR de la representación impresa.
   *
   * Lo dibuja el servidor y llega como SVG: así la página del comprobante no
   * carga ninguna librería y el código se imprime tal cual, sin depender de que
   * un script haya corrido en el navegador de quien imprime.
   *
   * Hasta ahora aquí había un cuadrado que decía «pendiente de librería», y eso
   * es lo que salía impreso en cada boleta. Un QR que no escanea en un
   * comprobante no es un detalle estético: es el dato que permite verificarlo.
   */
  function pintarQr(contenido) {
    const caja = $('qr');
    caja.title = contenido;
    caja.innerHTML = '';
    const img = new Image();
    img.alt = 'Código QR del comprobante';
    img.src = '/api/qr?d=' + encodeURIComponent(contenido);
    // Si el servidor no pudiera dibujarlo, se dice. Un hueco mudo en un
    // comprobante impreso no se nota hasta que alguien intenta escanearlo.
    img.onerror = () => { caja.textContent = 'QR no disponible'; };
    caja.appendChild(img);
  }

  function fallar(mensaje) {
    $('doc').innerHTML = `<p class="doc-error">${esc(mensaje)}</p>`;
  }

  $('btn-imprimir').onclick = () => window.print();
  pintar();
})();
