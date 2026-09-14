/**
 * Catálogos de SUNAT usados en la facturación electrónica.
 *
 * Están aquí, juntos y con su número de catálogo, porque son códigos que no se
 * pueden adivinar ni inventar: si uno está mal, SUNAT rechaza el comprobante
 * entero y el mensaje de error no siempre dice cuál fue.
 */

/** Catálogo 01 — Tipo de documento */
export const TIPO_DOCUMENTO = {
  FACTURA: '01',
  BOLETA: '03',
  NOTA_CREDITO: '07',
  NOTA_DEBITO: '08',
};

export const NOMBRE_DOCUMENTO = {
  '01': 'FACTURA ELECTRÓNICA',
  '03': 'BOLETA DE VENTA ELECTRÓNICA',
  '07': 'NOTA DE CRÉDITO ELECTRÓNICA',
  '08': 'NOTA DE DÉBITO ELECTRÓNICA',
};

/** Catálogo 06 — Tipo de documento de identidad del adquiriente */
export const TIPO_DOC_IDENTIDAD = {
  SIN_DOCUMENTO: '0',
  DNI: '1',
  CARNET_EXTRANJERIA: '4',
  RUC: '6',
  PASAPORTE: '7',
};

/** Catálogo 02 — Moneda (ISO 4217) */
export const MONEDA = { SOLES: 'PEN', DOLARES: 'USD' };

/** Catálogo 07 — Tipo de afectación del IGV */
export const AFECTACION_IGV = {
  GRAVADO_ONEROSO: '10',
  EXONERADO: '20',
  INAFECTO: '30',
  GRATUITO: '11',
};

/** Catálogo 05 — Códigos de tributo */
export const TRIBUTO = {
  IGV: { codigo: '1000', nombre: 'IGV', tipo: 'VAT' },
  EXONERADO: { codigo: '9997', nombre: 'EXO', tipo: 'VAT' },
  INAFECTO: { codigo: '9998', nombre: 'INA', tipo: 'FRE' },
};

/** Catálogo 03 — Unidad de medida (subconjunto que usa la tienda) */
export const UNIDAD = {
  UNIDAD: 'NIU',
  GRAMO: 'GRM',
  KILOGRAMO: 'KGM',
  LITRO: 'LTR',
  SERVICIO: 'ZZ',
};

/** Catálogo 09 — Motivo de la nota de crédito */
export const MOTIVO_NOTA_CREDITO = {
  ANULACION_OPERACION: '01',
  ANULACION_ERROR_RUC: '02',
  CORRECCION_DESCRIPCION: '03',
  DESCUENTO_GLOBAL: '04',
  DESCUENTO_ITEM: '05',
  DEVOLUCION_TOTAL: '06',
  DEVOLUCION_ITEM: '07',
  BONIFICACION: '08',
  DISMINUCION_VALOR: '09',
};

export const NOMBRE_MOTIVO_NC = {
  '01': 'Anulación de la operación',
  '02': 'Anulación por error en el RUC',
  '03': 'Corrección por error en la descripción',
  '06': 'Devolución total',
  '07': 'Devolución por ítem',
};

/**
 * Serie del comprobante.
 * Factura: F + 3 caracteres. Boleta: B + 3. Nota de crédito: hereda la letra
 * del documento que modifica (FC01/BC01 son formatos frecuentes, pero SUNAT
 * solo exige la letra inicial correcta).
 */
export const SERIE_POR_TIPO = {
  '01': 'F001',
  '03': 'B001',
  '07': { '01': 'FC01', '03': 'BC01' },
};

/** El tipo de comprobante que le corresponde a un documento de identidad. */
export const comprobantePara = (tipoDocIdentidad) =>
  tipoDocIdentidad === TIPO_DOC_IDENTIDAD.RUC
    ? TIPO_DOCUMENTO.FACTURA
    : TIPO_DOCUMENTO.BOLETA;

/** Mapea el tipo que usa la tienda ('DNI' | 'RUC') al código del catálogo 06. */
export const codigoIdentidad = (tipo) =>
  String(tipo).toUpperCase() === 'RUC'
    ? TIPO_DOC_IDENTIDAD.RUC
    : TIPO_DOC_IDENTIDAD.DNI;
