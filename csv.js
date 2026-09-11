/**
 * Lector de CSV, a mano y sin dependencias, como todo lo demas.
 *
 * No es un CSV academico: es el que sale del Excel de una tienda en Peru, y
 * eso trae cuatro cosas que un `split(',')` no sobrevive.
 *
 * 1. **El separador puede ser `;`.** El Excel en configuracion regional
 *    peruana usa la coma como separador decimal, asi que al guardar como CSV
 *    separa con punto y coma. Se detecta mirando la primera linea en vez de
 *    exigirle al dueño que sepa que es un separador.
 *
 * 2. **El BOM.** El Excel escribe tres bytes invisibles al principio. Sin
 *    quitarlos, la primera columna se llama `<BOM>nombre` y no se encuentra
 *    nunca — el clasico "pero si la columna esta ahi, la estoy viendo".
 *
 * 3. **Comillas.** Un campo entre comillas puede llevar el separador dentro
 *    (las etiquetas van asi: `"tos,garganta"`), y una comilla literal se
 *    escribe doblada.
 *
 * 4. **Cabeceras escritas a mano.** `Precio`, `PRECIO ` y `precio` son la
 *    misma columna, y `categoría` con tilde tambien.
 */

/** Quita tildes para comparar. No se usa en los valores, solo en cabeceras. */
const sinTildes = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '');

const clave = (c) => sinTildes(c).toLowerCase().replace(/[\s_-]+/g, '').trim();

/**
 * El separador se decide por mayoria en la primera linea, fuera de comillas.
 * Con la tabulacion incluida porque un pegado desde Excel llega con tabs.
 */
function detectarSeparador(primeraLinea) {
  const candidatos = [',', ';', '\t'];
  let mejor = ',';
  let masVeces = -1;
  for (const sep of candidatos) {
    let veces = 0;
    let dentro = false;
    for (const ch of primeraLinea) {
      if (ch === '"') dentro = !dentro;
      else if (ch === sep && !dentro) veces++;
    }
    if (veces > masVeces) { masVeces = veces; mejor = sep; }
  }
  return mejor;
}

/** Parte el texto en filas de celdas, respetando comillas y saltos dentro. */
function trocear(texto, sep) {
  const filas = [];
  let fila = [];
  let celda = '';
  let dentro = false;

  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];

    if (dentro) {
      if (ch === '"') {
        // Dos comillas seguidas son una comilla literal.
        if (texto[i + 1] === '"') { celda += '"'; i++; } else dentro = false;
      } else celda += ch;
      continue;
    }

    if (ch === '"') { dentro = true; continue; }
    if (ch === sep) { fila.push(celda); celda = ''; continue; }
    if (ch === '\r') continue;              // CRLF de Windows
    if (ch === '\n') { fila.push(celda); filas.push(fila); fila = []; celda = ''; continue; }
    celda += ch;
  }
  if (celda !== '' || fila.length) { fila.push(celda); filas.push(fila); }
  return filas;
}

/**
 * Devuelve `{ columnas, filas }`, donde cada fila es un objeto con las
 * cabeceras normalizadas como claves y su numero de linea real en el archivo
 * — que es lo que hay que decirle a quien tiene que corregir el Excel.
 */
/** El BOM se compara por codigo y no como caracter literal: en el fuente seria
 *  invisible, y un byte que no se ve es un byte que alguien borra sin saberlo. */
const BOM = String.fromCharCode(0xFEFF);

export function leerCsv(texto) {
  const limpio = texto.startsWith(BOM) ? texto.slice(1) : texto;
  const primera = limpio.split('\n')[0] || '';
  const sep = detectarSeparador(primera);

  const bruto = trocear(limpio, sep).filter((f) => f.some((c) => c.trim() !== ''));
  if (!bruto.length) return { columnas: [], filas: [], separador: sep };

  const columnas = bruto[0].map((c) => clave(c));
  const filas = bruto.slice(1).map((celdas, i) => {
    const o = { _linea: i + 2 };   // +2: la 1 es la cabecera y se cuenta desde 1
    columnas.forEach((col, j) => { o[col] = (celdas[j] ?? '').trim(); });
    return o;
  });

  return { columnas, filas, separador: sep };
}

/**
 * Numero escrito por una persona: `S/ 24.90`, `24,90`, `1 234,50`, `28.5`.
 *
 * La regla del separador decimal: manda **el ultimo** punto o coma que
 * aparezca, porque es el que separa los centimos. `1.234,50` y `1,234.50` son
 * los dos mil doscientos treinta y cuatro con cincuenta, escritos como los
 * escribe cada uno.
 */
export function aNumero(v) {
  const t = String(v ?? '').replace(/[^\d.,-]/g, '').trim();
  if (!t) return null;

  const cuantos = (t.match(/[.,]/g) || []).length;
  const corte = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));

  let limpio;
  if (corte === -1) {
    limpio = t;
  } else {
    const decimales = t.slice(corte + 1);
    // Tres cifras detras de un unico separador son miles, no centimos: «1.234»
    // es mil doscientos treinta y cuatro. Un precio no lleva tres decimales.
    const sonMiles = cuantos === 1 && decimales.length === 3;
    limpio = sonMiles
      ? t.replace(/[.,]/g, '')
      : `${t.slice(0, corte).replace(/[.,]/g, '')}.${decimales}`;
  }

  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}
