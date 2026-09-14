/**
 * Emisión de boletas, facturas y notas de crédito.
 *
 * QUÉ HACE ESTE MÓDULO Y QUÉ NO
 *
 *   ✅ Numeración: serie + correlativo sin huecos, garantizado por la base.
 *   ✅ Cálculo: valor de venta, IGV e importe total, cuadrados al céntimo.
 *   ✅ Todos los campos que SUNAT exige, con sus códigos de catálogo.
 *   ✅ XML UBL 2.1 listo para firmar.
 *   ✅ Representación impresa con el contenido del código QR.
 *   ✅ Notas de crédito por anulación y por devolución.
 *
 *   ❌ Firma digital: necesita el certificado X.509 del emisor.
 *   ❌ Envío a SUNAT o a un OSE: necesita credenciales del contribuyente.
 *   ❌ CDR: lo devuelve SUNAT al recibir el comprobante firmado.
 *
 * Es decir: el comprobante queda EMITIDO internamente y correcto, en estado
 * `pendiente_envio`. Conectar un OSE es rellenar `enviarASunat()` — está
 * aislado a propósito para que sea un cambio de un archivo.
 */
import { db } from './db.js';
import { TIENDA } from './tienda.config.js';
import { importeEnLetras } from './importe-letras.js';
import {
  TIPO_DOCUMENTO, NOMBRE_DOCUMENTO, TIPO_DOC_IDENTIDAD, MONEDA,
  AFECTACION_IGV, TRIBUTO, UNIDAD, SERIE_POR_TIPO, MOTIVO_NOTA_CREDITO,
  codigoIdentidad,
} from './catalogos-sunat.js';

const IGV = TIENDA.igv.porcentaje / 100;

/** Redondeo a céntimos, evitando el error binario de coma flotante. */
const c2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const Q = {
  ultimo: db.prepare(
    'SELECT MAX(correlativo) n FROM comprobantes WHERE serie = ?'),
  insertar: db.prepare(`INSERT INTO comprobantes
    (serie, correlativo, tipo_doc, pedido_id, fecha_emision,
     cliente_tipo_doc, cliente_num_doc, cliente_nombre, cliente_direccion,
     moneda, gravadas, igv, total, estado, motivo_nc, ref_serie, ref_correlativo,
     ref_tipo_doc, xml)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  insertarItem: db.prepare(`INSERT INTO comprobante_items
    (comprobante_id, orden, codigo, descripcion, unidad, cantidad,
     valor_unitario, precio_unitario, valor_venta, igv, importe)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`),
  porId: db.prepare('SELECT * FROM comprobantes WHERE id = ?'),
  porPedido: db.prepare(
    "SELECT * FROM comprobantes WHERE pedido_id = ? AND tipo_doc IN ('01','03')"),
  itemsDe: db.prepare(
    'SELECT * FROM comprobante_items WHERE comprobante_id = ? ORDER BY orden'),
  lista: db.prepare(`SELECT * FROM comprobantes ORDER BY id DESC LIMIT ?`),
  notasDe: db.prepare(
    "SELECT * FROM comprobantes WHERE ref_serie = ? AND ref_correlativo = ?"),
};

/**
 * Siguiente correlativo de la serie.
 * Se calcula DENTRO de la transacción que inserta, y la base tiene un índice
 * único sobre (serie, correlativo): si dos ventas coinciden en el mismo
 * milisegundo, una falla en vez de duplicar número. Un correlativo repetido es
 * de las pocas cosas que SUNAT no deja arreglar sin trámite.
 */
const siguienteCorrelativo = (serie) => (Q.ultimo.get(serie).n || 0) + 1;

/** Número visible: F001-00000123 */
export const numeroDe = (serie, correlativo) =>
  `${serie}-${String(correlativo).padStart(8, '0')}`;

/**
 * Desglosa una línea. Los precios del catálogo YA incluyen IGV (así se muestran
 * en Perú), de modo que el valor de venta se obtiene hacia atrás.
 *
 * EL ORDEN DE LOS REDONDEOS IMPORTA, y no es un detalle académico.
 *
 * La primera versión hacía: valorUnitario = redondear(precio / 1,18) y luego
 * valorVenta = valorUnitario × cantidad. Ese doble redondeo perdía céntimos:
 * 3 × S/ 22,00 daba S/ 65,99 en vez de S/ 66,00, y el total del comprobante
 * salía dos céntimos por debajo de lo que el cliente pagó. Un comprobante que
 * no cuadra con el cobro lo rechaza SUNAT y descuadra la caja.
 *
 * Ahora el ancla es el IMPORTE —lo que el cliente paga— y de ahí se deriva
 * todo lo demás. El valor unitario se guarda con decimales largos, que es
 * justamente para lo que SUNAT admite hasta diez.
 */
function calcularLinea({ codigo, descripcion, cantidad, precioUnitario, unidad }) {
  const precio = Number(precioUnitario);
  const cant = Number(cantidad);

  const importe = c2(precio * cant);           // lo que se cobra: exacto
  const valorVenta = c2(importe / (1 + IGV));  // base imponible
  const igv = c2(importe - valorVenta);        // por diferencia: nunca descuadra

  return {
    codigo,
    descripcion,
    unidad: unidad || UNIDAD.UNIDAD,
    cantidad: cant,
    // Diez decimales: es el margen que da SUNAT para que el unitario no
    // arrastre el error de redondeo al total.
    valorUnitario: Number((valorVenta / cant).toFixed(10)),
    precioUnitario: c2(precio),
    valorVenta,
    igv,
    importe,
    afectacion: AFECTACION_IGV.GRAVADO_ONEROSO,
  };
}

/**
 * Suma las líneas y cuadra el total.
 *
 * Los totales se calculan sumando las líneas YA redondeadas, no redondeando la
 * suma: es la única forma de que lo impreso cuadre con lo declarado. SUNAT
 * rechaza el comprobante si el total no coincide con la suma de sus partes.
 */
function totalizar(lineas) {
  const gravadas = c2(lineas.reduce((s, l) => s + l.valorVenta, 0));
  const igv = c2(lineas.reduce((s, l) => s + l.igv, 0));
  const total = c2(lineas.reduce((s, l) => s + l.importe, 0));

  // Como en cada línea igv = importe − valorVenta, la identidad se cumple por
  // construcción. La comprobación queda porque si algún día alguien cambia el
  // orden de los redondeos, esto lo detecta al instante en vez de en SUNAT.
  if (Math.abs(gravadas + igv - total) > 0.005) {
    throw new Error(`El comprobante no cuadra: ${gravadas} + ${igv} ≠ ${total}`);
  }
  return { gravadas, igv, total };
}

/** Fecha en el formato que pide UBL (AAAA-MM-DD) y la hora local. */
function ahora() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return {
    fecha: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    hora: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
  };
}

/**
 * Emite el comprobante que le corresponde a un pedido.
 * Un pedido solo puede tener un comprobante: si ya lo tiene, se devuelve ese.
 */
export function emitirPorPedido(pedido, items) {
  const existente = Q.porPedido.get(pedido.id);
  if (existente) return { ok: true, yaExistia: true, comprobante: detalle(existente.id) };

  const tipoIdentidad = codigoIdentidad(pedido.tipo_doc);
  const tipoDoc = tipoIdentidad === TIPO_DOC_IDENTIDAD.RUC
    ? TIPO_DOCUMENTO.FACTURA
    : TIPO_DOCUMENTO.BOLETA;

  // Una factura sin RUC y razón social no es emitible: SUNAT la rechaza.
  if (tipoDoc === TIPO_DOCUMENTO.FACTURA && !pedido.razon_social) {
    return { ok: false, error: 'Una factura necesita la razón social del cliente.' };
  }

  const lineas = items.map((i) => calcularLinea({
    codigo: i.sku || String(i.producto_id),
    descripcion: i.nombre,
    cantidad: i.cantidad,
    // Ya viene por unidad base: para el granel es el precio de UN gramo, no el
    // de los cien que se cotizan en el mostrador. La conversion se hizo al
    // vender, para que una boleta emitida no dependa de como este configurado
    // el producto hoy.
    precioUnitario: i.precio_unit,
    unidad: i.unidad === 'gramo' ? UNIDAD.GRAMO : UNIDAD.UNIDAD,
  }));

  // El envío es una operación gravada más: va como línea, no como descuento.
  if (pedido.costo_envio > 0) {
    lineas.push(calcularLinea({
      codigo: 'ENVIO',
      descripcion: `Servicio de entrega a domicilio — ${pedido.distrito}`,
      cantidad: 1,
      precioUnitario: pedido.costo_envio,
      unidad: UNIDAD.SERVICIO,
    }));
  }

  return registrar({
    tipoDoc,
    pedidoId: pedido.id,
    cliente: {
      tipoDoc: tipoIdentidad,
      numDoc: pedido.num_doc,
      nombre: pedido.razon_social || pedido.cliente_nombre,
      direccion: [pedido.cliente_dir, pedido.distrito, pedido.provincia,
        pedido.departamento].filter(Boolean).join(', '),
    },
    lineas,
  });
}

/**
 * Nota de crédito sobre un comprobante ya emitido.
 * No se "borra" nada: en facturación electrónica un comprobante emitido no se
 * modifica, se compensa con otro documento. Por eso anular un pedido genera
 * una nota, no un DELETE.
 */
export function emitirNotaCredito(comprobanteId, motivo, descripcionMotivo) {
  const original = Q.porId.get(comprobanteId);
  if (!original) return { ok: false, error: 'No existe el comprobante.' };
  if (original.tipo_doc === TIPO_DOCUMENTO.NOTA_CREDITO) {
    return { ok: false, error: 'No se emite una nota de crédito sobre otra nota.' };
  }
  if (Q.notasDe.get(original.serie, original.correlativo)) {
    return { ok: false, error: 'Este comprobante ya tiene una nota de crédito.' };
  }

  const items = Q.itemsDe.all(original.id);
  const lineas = items.map((i) => ({
    codigo: i.codigo, descripcion: i.descripcion, unidad: i.unidad,
    cantidad: i.cantidad, valorUnitario: i.valor_unitario,
    precioUnitario: i.precio_unitario, valorVenta: i.valor_venta,
    igv: i.igv, importe: i.importe, afectacion: AFECTACION_IGV.GRAVADO_ONEROSO,
  }));

  return registrar({
    tipoDoc: TIPO_DOCUMENTO.NOTA_CREDITO,
    pedidoId: original.pedido_id,
    cliente: {
      tipoDoc: original.cliente_tipo_doc,
      numDoc: original.cliente_num_doc,
      nombre: original.cliente_nombre,
      direccion: original.cliente_direccion,
    },
    lineas,
    motivoNC: motivo || MOTIVO_NOTA_CREDITO.ANULACION_OPERACION,
    descripcionMotivo: descripcionMotivo || 'Anulación de la operación',
    referencia: {
      serie: original.serie,
      correlativo: original.correlativo,
      tipoDoc: original.tipo_doc,
    },
  });
}

/** Inserta el comprobante y sus líneas en una sola transacción. */
function registrar({ tipoDoc, pedidoId, cliente, lineas, motivoNC, descripcionMotivo, referencia }) {
  const serie = tipoDoc === TIPO_DOCUMENTO.NOTA_CREDITO
    ? SERIE_POR_TIPO['07'][referencia.tipoDoc]
    : SERIE_POR_TIPO[tipoDoc];

  const t = totalizar(lineas);
  const { fecha } = ahora();

  db.exec('BEGIN IMMEDIATE');
  try {
    const correlativo = siguienteCorrelativo(serie);

    const r = Q.insertar.run(
      serie, correlativo, tipoDoc, pedidoId, fecha,
      cliente.tipoDoc, cliente.numDoc, cliente.nombre, cliente.direccion,
      MONEDA.SOLES, t.gravadas, t.igv, t.total, 'pendiente_envio',
      motivoNC || '', referencia?.serie || '', referencia?.correlativo || 0,
      referencia?.tipoDoc || '', '');

    const id = Number(r.lastInsertRowid);
    lineas.forEach((l, i) => {
      Q.insertarItem.run(id, i + 1, l.codigo, l.descripcion, l.unidad,
        l.cantidad, l.valorUnitario, l.precioUnitario, l.valorVenta, l.igv, l.importe);
    });

    // El XML se guarda ya construido: es lo que después se firma y se envía.
    const doc = detalle(id, { descripcionMotivo });
    db.prepare('UPDATE comprobantes SET xml = ? WHERE id = ?').run(construirXml(doc), id);

    db.exec('COMMIT');
    return { ok: true, comprobante: detalle(id, { descripcionMotivo }) };
  } catch (e) {
    db.exec('ROLLBACK');
    return { ok: false, error: 'No se pudo emitir: ' + e.message };
  }
}

/** Comprobante completo, listo para imprimir o serializar. */
export function detalle(id, extra = {}) {
  const c = Q.porId.get(id);
  if (!c) return null;
  const items = Q.itemsDe.all(id);

  return {
    id: c.id,
    numero: numeroDe(c.serie, c.correlativo),
    serie: c.serie,
    correlativo: c.correlativo,
    tipoDoc: c.tipo_doc,
    tipoNombre: NOMBRE_DOCUMENTO[c.tipo_doc],
    fechaEmision: c.fecha_emision,
    estado: c.estado,
    moneda: c.moneda,
    emisor: {
      ruc: TIENDA.comprobante.ruc,
      razonSocial: TIENDA.comprobante.razonSocial,
      nombreComercial: TIENDA.nombre,
      direccion: TIENDA.direccion,
    },
    cliente: {
      tipoDoc: c.cliente_tipo_doc,
      tipoDocNombre: c.cliente_tipo_doc === TIPO_DOC_IDENTIDAD.RUC ? 'RUC' : 'DNI',
      numDoc: c.cliente_num_doc,
      nombre: c.cliente_nombre,
      direccion: c.cliente_direccion,
    },
    items: items.map((i) => ({
      orden: i.orden, codigo: i.codigo, descripcion: i.descripcion,
      unidad: i.unidad, cantidad: i.cantidad,
      valorUnitario: i.valor_unitario, precioUnitario: i.precio_unitario,
      valorVenta: i.valor_venta, igv: i.igv, importe: i.importe,
    })),
    totales: {
      gravadas: c.gravadas,
      igv: c.igv,
      total: c.total,
      porcentajeIgv: TIENDA.igv.porcentaje,
      enLetras: importeEnLetras(c.total),
    },
    nota: c.motivo_nc ? {
      motivo: c.motivo_nc,
      descripcion: extra.descripcionMotivo || '',
      referencia: numeroDe(c.ref_serie, c.ref_correlativo),
      referenciaTipo: c.ref_tipo_doc,
    } : null,
    qr: contenidoQr(c),
    xml: c.xml || '',
  };
}

/**
 * Contenido del código QR de la representación impresa.
 * Campos separados por `|`, en el orden que fija SUNAT. El último es el hash
 * del XML firmado: hasta que no haya firma, va vacío.
 */
export function contenidoQr(c) {
  return [
    TIENDA.comprobante.ruc,
    c.tipo_doc,
    c.serie,
    String(c.correlativo).padStart(8, '0'),
    c.igv.toFixed(2),
    c.total.toFixed(2),
    c.fecha_emision,
    c.cliente_tipo_doc,
    c.cliente_num_doc,
    '',                       // hash del XML firmado
  ].join('|');
}

// ------------------------------------------------------------------- UBL 2.1
const esc = (t) => String(t ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const n2 = (v) => Number(v).toFixed(2);

/**
 * XML UBL 2.1 del comprobante.
 *
 * Queda SIN FIRMAR: el elemento `ext:ExtensionContent` está vacío a propósito,
 * que es exactamente donde va la firma XML-DSig cuando haya certificado. Firmar
 * es rellenar ese hueco; el resto del documento ya no se toca.
 */
export function construirXml(doc) {
  const esNota = doc.tipoDoc === TIPO_DOCUMENTO.NOTA_CREDITO;
  const raiz = esNota ? 'CreditNote' : 'Invoice';
  const ns = esNota
    ? 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2'
    : 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';

  const lineas = doc.items.map((i) => `
    <cac:${esNota ? 'CreditNoteLine' : 'InvoiceLine'}>
      <cbc:ID>${i.orden}</cbc:ID>
      <cbc:${esNota ? 'CreditedQuantity' : 'InvoicedQuantity'} unitCode="${i.unidad}">${i.cantidad}</cbc:${esNota ? 'CreditedQuantity' : 'InvoicedQuantity'}>
      <cbc:LineExtensionAmount currencyID="${doc.moneda}">${n2(i.valorVenta)}</cbc:LineExtensionAmount>
      <cac:PricingReference>
        <cac:AlternativeConditionPrice>
          <cbc:PriceAmount currencyID="${doc.moneda}">${n2(i.precioUnitario)}</cbc:PriceAmount>
          <cbc:PriceTypeCode>01</cbc:PriceTypeCode>
        </cac:AlternativeConditionPrice>
      </cac:PricingReference>
      <cac:TaxTotal>
        <cbc:TaxAmount currencyID="${doc.moneda}">${n2(i.igv)}</cbc:TaxAmount>
        <cac:TaxSubtotal>
          <cbc:TaxableAmount currencyID="${doc.moneda}">${n2(i.valorVenta)}</cbc:TaxableAmount>
          <cbc:TaxAmount currencyID="${doc.moneda}">${n2(i.igv)}</cbc:TaxAmount>
          <cac:TaxCategory>
            <cbc:Percent>${doc.totales.porcentajeIgv}</cbc:Percent>
            <cbc:TaxExemptionReasonCode>${AFECTACION_IGV.GRAVADO_ONEROSO}</cbc:TaxExemptionReasonCode>
            <cac:TaxScheme>
              <cbc:ID>${TRIBUTO.IGV.codigo}</cbc:ID>
              <cbc:Name>${TRIBUTO.IGV.nombre}</cbc:Name>
              <cbc:TaxTypeCode>${TRIBUTO.IGV.tipo}</cbc:TaxTypeCode>
            </cac:TaxScheme>
          </cac:TaxCategory>
        </cac:TaxSubtotal>
      </cac:TaxTotal>
      <cac:Item>
        <cbc:Description><![CDATA[${i.descripcion}]]></cbc:Description>
        <cac:SellersItemIdentification>
          <cbc:ID>${esc(i.codigo)}</cbc:ID>
        </cac:SellersItemIdentification>
      </cac:Item>
      <cac:Price>
        <cbc:PriceAmount currencyID="${doc.moneda}">${n2(i.valorUnitario)}</cbc:PriceAmount>
      </cac:Price>
    </cac:${esNota ? 'CreditNoteLine' : 'InvoiceLine'}>`).join('');

  const referencia = esNota ? `
  <cac:DiscrepancyResponse>
    <cbc:ReferenceID>${esc(doc.nota.referencia)}</cbc:ReferenceID>
    <cbc:ResponseCode>${doc.nota.motivo}</cbc:ResponseCode>
    <cbc:Description><![CDATA[${doc.nota.descripcion}]]></cbc:Description>
  </cac:DiscrepancyResponse>
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${esc(doc.nota.referencia)}</cbc:ID>
      <cbc:DocumentTypeCode>${doc.nota.referenciaTipo}</cbc:DocumentTypeCode>
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<${raiz} xmlns="${ns}"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
  xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <!-- Aqui va la firma XML-DSig. Requiere el certificado del emisor. -->
      <ext:ExtensionContent/>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ID>${esc(doc.numero)}</cbc:ID>
  <cbc:IssueDate>${doc.fechaEmision}</cbc:IssueDate>
  ${esNota ? '' : `<cbc:InvoiceTypeCode listID="0101">${doc.tipoDoc}</cbc:InvoiceTypeCode>`}
  <cbc:Note languageLocaleID="1000"><![CDATA[${doc.totales.enLetras}]]></cbc:Note>
  <cbc:DocumentCurrencyCode>${doc.moneda}</cbc:DocumentCurrencyCode>${referencia}
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="6">${doc.emisor.ruc}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName><cbc:Name><![CDATA[${doc.emisor.nombreComercial}]]></cbc:Name></cac:PartyName>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${doc.emisor.razonSocial}]]></cbc:RegistrationName>
        <cac:RegistrationAddress>
          <cbc:AddressTypeCode>0000</cbc:AddressTypeCode>
          <cac:AddressLine><cbc:Line><![CDATA[${doc.emisor.direccion}]]></cbc:Line></cac:AddressLine>
        </cac:RegistrationAddress>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${doc.cliente.tipoDoc}">${esc(doc.cliente.numDoc)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${doc.cliente.nombre}]]></cbc:RegistrationName>
        <cac:RegistrationAddress>
          <cac:AddressLine><cbc:Line><![CDATA[${doc.cliente.direccion}]]></cbc:Line></cac:AddressLine>
        </cac:RegistrationAddress>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${doc.moneda}">${n2(doc.totales.igv)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${doc.moneda}">${n2(doc.totales.gravadas)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${doc.moneda}">${n2(doc.totales.igv)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:ID>${TRIBUTO.IGV.codigo}</cbc:ID>
          <cbc:Name>${TRIBUTO.IGV.nombre}</cbc:Name>
          <cbc:TaxTypeCode>${TRIBUTO.IGV.tipo}</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:${esNota ? 'RequestedMonetaryTotal' : 'LegalMonetaryTotal'}>
    <cbc:LineExtensionAmount currencyID="${doc.moneda}">${n2(doc.totales.gravadas)}</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount currencyID="${doc.moneda}">${n2(doc.totales.total)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${doc.moneda}">${n2(doc.totales.total)}</cbc:PayableAmount>
  </cac:${esNota ? 'RequestedMonetaryTotal' : 'LegalMonetaryTotal'}>${lineas}
</${raiz}>`;
}

/**
 * Punto de conexión con SUNAT o un OSE.
 *
 * Está vacío A PROPÓSITO. Para que funcione hacen falta tres cosas que el
 * cliente tiene que aportar, y ninguna se puede simular:
 *   1. Certificado digital vigente (.pfx) del contribuyente.
 *   2. Usuario secundario SOL con permiso de facturación electrónica.
 *   3. El endpoint del OSE contratado, o el de SUNAT si emite directo.
 *
 * Mientras no estén, el comprobante queda `pendiente_envio`: emitido y
 * numerado, pero sin CDR. Presentarlo como enviado sería mentir.
 */
export async function enviarASunat() {
  return {
    ok: false,
    error: 'No hay integración con SUNAT configurada.',
    requiere: ['certificado digital (.pfx)', 'usuario SOL secundario', 'endpoint del OSE'],
  };
}

export const listar = (limite = 100) => Q.lista.all(limite);
export const porPedido = (pedidoId) => Q.porPedido.get(pedidoId);
export const notaDe = (serie, correlativo) => Q.notasDe.get(serie, correlativo);
