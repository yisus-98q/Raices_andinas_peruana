/**
 * La boleta o la factura, como archivo PDF.
 *
 * En Peru el documento con valor legal es el XML; esto es la "representacion
 * impresa", que es lo que el cliente recibe y guarda. Hasta ahora solo existia
 * como pagina web: el comprador tenia que imprimirla desde el navegador, y
 * mandarla por WhatsApp significaba mandar un enlace o una captura.
 *
 * Un PDF se archiva, se adjunta a un correo, se manda por WhatsApp y se abre
 * igual en cualquier telefono dentro de cinco anios. Por eso vale la pena, y
 * por eso se escribe con `pdf.js` en lugar de instalar una libreria.
 *
 * Todas las cifras vienen ya calculadas de `comprobantes.js`. Aqui NO se
 * recalcula ni se redondea nada: si el papel dijera un total distinto del XML,
 * el comprobante seria observable.
 */
import { nuevoPdf, anchoDe, A4 } from './pdf.js';
import { TIENDA } from './tienda.config.js';

const TINTA = [26, 24, 21];
const SUAVE = [110, 102, 92];
const LINEA = [200, 190, 175];
const OCRE = [150, 95, 10];

const soles = (n) => 'S/ ' + Number(n).toLocaleString('es-PE', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const ESTADO = {
  pendiente_envio: 'Pendiente de envío a SUNAT',
  enviado: 'Enviado a SUNAT',
  aceptado: 'Aceptado por SUNAT',
  rechazado: 'Rechazado por SUNAT',
  anulado: 'Anulado',
};

/**
 * Devuelve el PDF de un comprobante ya emitido, como Buffer.
 * `c` es lo que devuelve `detalle()` de comprobantes.js.
 */
export function pdfDeComprobante(c) {
  const doc = nuevoPdf({ margen: 46 });
  const M = doc.margen;
  const DERECHA = A4.ancho - M;
  const ANCHO = DERECHA - M;

  let y = 58;

  // ─────────────────────────────────────────────────── emisor y recuadro
  doc.texto(TIENDA.comprobante.razonSocial, M, y, { tam: 15, fuente: 'negrita' });
  y += 17;
  doc.texto(TIENDA.nombre, M, y, { tam: 10, color: OCRE, fuente: 'negrita' });
  y += 14;
  doc.texto(TIENDA.direccion, M, y, { tam: 8.5, color: SUAVE });
  y += 12;
  doc.texto(`Teléfono ${TIENDA.telefono}  ·  ${TIENDA.email}`, M, y,
    { tam: 8.5, color: SUAVE });

  // El recuadro con el numero es lo primero que busca cualquiera que reciba un
  // comprobante, asi que va arriba a la derecha y con borde, como en el papel
  // preimpreso de toda la vida.
  const cajaAncho = 200;
  const cajaX = DERECHA - cajaAncho;
  doc.rect(cajaX, 52, cajaAncho, 74, { borde: TINTA, grosor: 1 });
  doc.texto(`R.U.C. ${TIENDA.comprobante.ruc}`, cajaX + cajaAncho / 2, 70,
    { tam: 10, fuente: 'negrita', alinear: 'centro' });
  doc.texto(c.tipoNombre, cajaX + cajaAncho / 2, 92,
    { tam: 10.5, fuente: 'negrita', alinear: 'centro', color: OCRE });
  doc.texto(c.numero, cajaX + cajaAncho / 2, 113,
    { tam: 15, fuente: 'negrita', alinear: 'centro' });

  y = 146;
  doc.linea(M, y, DERECHA, y, { grosor: 1, color: TINTA });

  // ─────────────────────────────────────────────────────────── cliente
  y += 20;
  const filaDato = (etiqueta, valor, x, ancho, opciones = {}) => {
    doc.texto(etiqueta.toUpperCase(), x, y, { tam: 7, color: SUAVE, espaciado: 0.6 });
    doc.texto(doc.recortar(valor || '—', ancho, 9.5, opciones.fuente || 'normal'),
      x, y + 13, { tam: 9.5, ...opciones });
  };

  const col2 = M + ANCHO * 0.58;
  filaDato('Señor(es)', c.cliente.nombre, M, ANCHO * 0.55, { fuente: 'negrita' });
  filaDato(c.cliente.tipoDocNombre, c.cliente.numDoc, col2, ANCHO * 0.4);
  y += 32;
  filaDato('Dirección', c.cliente.direccion, M, ANCHO * 0.55);
  filaDato('Fecha de emisión', String(c.fechaEmision).slice(0, 10), col2, ANCHO * 0.4);
  y += 32;

  if (c.nota) {
    filaDato('Documento que modifica',
      `${c.nota.referencia} · ${c.nota.descripcion || c.nota.motivo}`, M, ANCHO);
    y += 32;
  }

  // ───────────────────────────────────────────────────── tabla de items
  const COL = {
    cant: M + 34,
    desc: M + 44,
    unit: DERECHA - 150,
    valor: DERECHA - 78,
    importe: DERECHA,
  };
  const anchoDesc = COL.unit - COL.desc - 12;

  doc.rect(M, y, ANCHO, 22, { relleno: [244, 239, 230] });
  const cabecera = (t, x, alinear) =>
    doc.texto(t, x, y + 15, { tam: 7.5, color: SUAVE, espaciado: 0.6, alinear });
  cabecera('CANT.', COL.cant, 'der');
  cabecera('DESCRIPCIÓN', COL.desc, 'izq');
  cabecera('P. UNIT.', COL.unit, 'der');
  cabecera('IGV', COL.valor, 'der');
  cabecera('IMPORTE', COL.importe, 'der');
  y += 22;

  const ALTO_FILA = 20;
  const PIE_MINIMO = 250;   // espacio que necesitan totales y pie

  for (const item of c.items) {
    // Si ya no cabe la fila MAS el pie, se pasa de hoja: un comprobante cuyo
    // total queda solo en la pagina siguiente se ve como un error.
    if (y + ALTO_FILA + PIE_MINIMO > A4.alto) {
      doc.texto('Continúa en la página siguiente', DERECHA, y + 14,
        { tam: 8, color: SUAVE, alinear: 'der' });
      doc.nuevaPagina();
      y = 58;
      doc.texto(`${c.tipoNombre} ${c.numero} · continuación`, M, y,
        { tam: 10, fuente: 'negrita' });
      y += 24;
    }

    doc.linea(M, y, DERECHA, y, { grosor: 0.4, color: LINEA });
    const base = y + 14;
    doc.texto(String(item.cantidad), COL.cant, base, { tam: 9.5, alinear: 'der' });
    doc.texto(doc.recortar(item.descripcion, anchoDesc, 9.5), COL.desc, base, { tam: 9.5 });
    doc.texto(soles(item.precioUnitario), COL.unit, base, { tam: 9.5, alinear: 'der' });
    doc.texto(soles(item.igv), COL.valor, base, { tam: 9.5, alinear: 'der', color: SUAVE });
    doc.texto(soles(item.importe), COL.importe, base, { tam: 9.5, alinear: 'der' });
    y += ALTO_FILA;
  }

  doc.linea(M, y, DERECHA, y, { grosor: 1, color: TINTA });
  y += 18;

  // ───────────────────────────────────────────────────────────── totales
  const totales = [
    [`Op. gravadas`, soles(c.totales.gravadas), false],
    [`I.G.V. ${c.totales.porcentajeIgv}%`, soles(c.totales.igv), false],
    ['IMPORTE TOTAL', soles(c.totales.total), true],
  ];
  for (const [etiqueta, valor, fuerte] of totales) {
    doc.texto(etiqueta, COL.valor, y + 10, {
      tam: fuerte ? 11 : 9.5, alinear: 'der',
      fuente: fuerte ? 'negrita' : 'normal', color: fuerte ? TINTA : SUAVE,
    });
    doc.texto(valor, COL.importe, y + 10, {
      tam: fuerte ? 12 : 9.5, alinear: 'der',
      fuente: fuerte ? 'negrita' : 'normal',
    });
    y += fuerte ? 22 : 17;
  }

  // El importe en letras es obligatorio en la representación impresa.
  y += 4;
  doc.rect(M, y, ANCHO, 24, { relleno: [248, 245, 238] });
  doc.texto(c.totales.enLetras, M + 10, y + 16, { tam: 9, fuente: 'negrita' });
  y += 40;

  // ──────────────────────────────────────────────────────────────── pie
  doc.linea(M, y, DERECHA, y, { grosor: 0.4, color: LINEA });
  y += 16;

  doc.texto('Representación impresa del comprobante electrónico.', M, y, { tam: 8 });
  y += 12;
  doc.parrafo(
    'El documento con valor legal es el archivo XML. Puede consultarlo en ' +
    'SUNAT Virtual con el RUC del emisor, el tipo y el número de comprobante.',
    M, y, ANCHO * 0.62, { tam: 8, color: SUAVE, interlinea: 1.4 });

  doc.texto(ESTADO[c.estado] || c.estado, DERECHA, y - 12,
    { tam: 8.5, alinear: 'der', fuente: 'negrita', color: OCRE });

  // El QR grafico necesitaria una libreria; el contenido exacto que exige
  // SUNAT sí va, para que nada se pierda entre el XML y el papel.
  y += 34;
  doc.texto('CÓDIGO QR', M, y, { tam: 7, color: SUAVE, espaciado: 0.6 });
  y += 11;
  const qr = String(c.qr || '');
  const trozo = Math.max(1, Math.floor(qr.length / Math.ceil(anchoDe(qr, 7) / ANCHO)));
  for (let i = 0; i < qr.length; i += trozo) {
    doc.texto(qr.slice(i, i + trozo), M, y, { tam: 7, color: SUAVE });
    y += 9;
  }

  doc.texto(`${TIENDA.nombre} · ${TIENDA.sitio}`, DERECHA, A4.alto - 34,
    { tam: 7.5, color: SUAVE, alinear: 'der' });

  return doc.terminar();
}

/** Nombre de archivo segun la convención de SUNAT: RUC-tipo-serie-correlativo. */
export const nombreArchivo = (c) =>
  `${TIENDA.comprobante.ruc}-${c.tipoDoc}-${c.numero}.pdf`;
