/**
 * Importe en letras: "SON: CIENTO VEINTICINCO CON 80/100 SOLES".
 *
 * Es obligatorio en la representación impresa de boletas y facturas. No hay
 * forma de sacarlo de una librería estándar en español, y las reglas tienen
 * trampas que se ven poco: "veintiuno" va junto, "ciento" pierde la o solo
 * cuando es exactamente cien, y "un mil" no existe (es "mil").
 */

const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE',
  'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
  'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE'];

const DECENAS = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA',
  'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];

const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS',
  'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

/** 0 a 999. */
function hasta999(n) {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';           // "ciento" solo cuando lleva algo detrás

  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes = [];
  if (c) partes.push(CENTENAS[c]);

  if (resto <= 20) {
    if (resto) partes.push(UNIDADES[resto]);
  } else if (resto < 30) {
    // 21-29 se escriben en una sola palabra: VEINTIUNO, VEINTIDÓS…
    const u = resto - 20;
    const especiales = { 2: 'VEINTIDÓS', 3: 'VEINTITRÉS', 6: 'VEINTISÉIS' };
    partes.push(especiales[u] || 'VEINTI' + UNIDADES[u]);
  } else {
    const d = Math.floor(resto / 10);
    const u = resto % 10;
    partes.push(u ? `${DECENAS[d]} Y ${UNIDADES[u]}` : DECENAS[d]);
  }
  return partes.join(' ');
}

/**
 * Delante de "MIL" y "MILLONES", "uno" se apocopa: veintiún mil, treinta y un
 * mil, ciento un mil. Sin esto salía "VEINTIUNO MIL", que está mal escrito.
 */
function apocopar(texto) {
  // "VEINTIUNO" va primero: al ser una sola palabra no tiene frontera interna,
  // así que la regla general de \bUNO$ no lo alcanzaría ("CIENTO VEINTIUNO").
  if (/VEINTIUNO$/.test(texto)) return texto.replace(/VEINTIUNO$/, 'VEINTIÚN');
  return texto.replace(/\bUNO$/, 'UN');
}

/** 0 a 999 999 999. */
function enLetras(n) {
  if (n === 0) return 'CERO';

  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes = [];

  if (millones === 1) partes.push('UN MILLÓN');
  else if (millones > 1) partes.push(apocopar(hasta999(millones)) + ' MILLONES');

  // "UN MIL" no se dice: es "MIL". Pero "VEINTIÚN MIL" sí lleva el número.
  if (miles === 1) partes.push('MIL');
  else if (miles > 1) partes.push(apocopar(hasta999(miles)) + ' MIL');

  if (resto) partes.push(hasta999(resto));

  return partes.join(' ');
}

/**
 * Formato que exige la representación impresa.
 * @example importeEnLetras(125.8) // "SON: CIENTO VEINTICINCO CON 80/100 SOLES"
 */
export function importeEnLetras(monto, moneda = 'SOLES') {
  const v = Number(monto);
  if (!Number.isFinite(v) || v < 0) return '';

  // Se redondea a céntimos ANTES de partir. El EPSILON corrige el error binario:
  // 10.005 se guarda como 10.00499999…, y sin la corrección "sube" a 10.00 en
  // vez de a 10.01. En importes eso es un céntimo que desaparece.
  const centimos = Math.round((v + Number.EPSILON) * 100);
  const entero = Math.floor(centimos / 100);
  const decimal = centimos % 100;

  return `SON: ${enLetras(entero)} CON ${String(decimal).padStart(2, '0')}/100 ${moneda}`;
}
