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
          <div class="doc-qr">
            <div class="qr-caja" id="qr"></div>
            <code>${esc(c.qr)}</code>
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

    // El XML es del emisor y de SUNAT; al comprador le corresponde la
    // representación impresa. Tampoco tiene por qué existir un enlace al panel
    // en la pantalla de un cliente.
    if (esComprador) {
      $('btn-xml').remove();
      $('btn-pdf').href = '/api/seguimiento/comprobante/pdf'
        + `?codigo=${encodeURIComponent(codigo)}&tel=${encodeURIComponent(tel)}`;
      const volver = $('btn-volver');
      volver.href = '/mi-pedido.html?codigo=' + encodeURIComponent(codigo);
      volver.textContent = '← Volver a mi pedido';
    } else {
      $('btn-xml').href = `/api/comprobantes/${encodeURIComponent(c.id)}/xml`;
      $('btn-pdf').href = `/api/comprobantes/${encodeURIComponent(c.id)}/pdf`;
    }
  }

  /**
   * El código QR de la representación impresa no se dibuja aquí.
   *
   * Codificar un QR bien (corrección Reed-Solomon, enmascarado, patrones de
   * alineación) es un módulo entero, y uno mal generado es peor que ninguno:
   * se imprime, parece correcto y no escanea. Se muestra el contenido exacto
   * que SUNAT exige, y queda anotado en el README que para el QR gráfico hay
   * que añadir una librería.
   */
  function pintarQr(contenido) {
    $('qr').innerHTML =
      `<span>QR</span><small>pendiente de librería</small>`;
    $('qr').title = contenido;
  }

  function fallar(mensaje) {
    $('doc').innerHTML = `<p class="doc-error">${esc(mensaje)}</p>`;
  }

  $('btn-imprimir').onclick = () => window.print();
  pintar();
})();
