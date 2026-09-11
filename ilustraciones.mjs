/**
 * Que ilustracion le toca a cada producto.
 *
 * Con 24 productos alcanzaba un SVG dibujado por SKU. Con 400 no: nadie va a
 * dibujar 400 laminas, y una sola imagen generica para todo el catalogo se ve
 * pobre. La salida es una matriz: la FORMA la manda la presentacion (una bolsa
 * se dibuja como bolsa, un gotero como gotero) y el COLOR lo manda la
 * categoria. Trece formas por siete paletas cubren el catalogo entero con
 * pocas decenas de archivos.
 *
 * Un producto con foto real siempre gana: esto es el respaldo.
 */

/** La presentacion decide la silueta. Se evalua en orden: gana la primera. */
const POR_PRESENTACION = [
  [/c[áa]psulas?|tabletas|comprimidos/i, 'capsulas'],
  [/gotero|ampollas|viales/i, 'gotero'],
  [/spray|roll-on/i, 'gotero'],
  [/bolsa .*(g|kg)|sachets?|caja \d+ filtrantes/i, 'bolsa'],
  [/botella|litro| l$/i, 'botella'],
  [/barra|pastilla/i, 'barra'],
  [/pote|tubo/i, 'tarro'],
  [/frasco/i, 'tarro'],
];

/** Si la presentacion no dice nada, lo dice la categoria. */
const POR_CATEGORIA = {
  Superalimentos: 'granos',
  Hierbas: 'manojo',
  Infusiones: 'manojo',
  'Tónicos': 'botella',
  Tonicos: 'botella',
  Aceites: 'gotero',
  'Aceites y esencias': 'gotero',
  Esencias: 'gotero',
  'Colágeno': 'bolsa',
  Colageno: 'bolsa',
  'Apícolas': 'tarro',
  Apicolas: 'tarro',
  Cremas: 'tarro',
  'Cuidado personal': 'barra',
  Suplementos: 'capsulas',
};

const PALETA_CATEGORIA = {
  Superalimentos: 'ocre',
  Hierbas: 'verde',
  Infusiones: 'salvia',
  'Tónicos': 'cochinilla',
  Tonicos: 'cochinilla',
  Aceites: 'ambar',
  'Aceites y esencias': 'ambar',
  Esencias: 'salvia',
  'Colágeno': 'arcilla',
  Colageno: 'arcilla',
  'Apícolas': 'miel',
  Apicolas: 'miel',
  Cremas: 'arcilla',
  'Cuidado personal': 'arcilla',
  Suplementos: 'verde',
};

export function formaDe(presentacion = '', categoria = '') {
  for (const [patron, forma] of POR_PRESENTACION) {
    if (patron.test(presentacion)) return forma;
  }
  return POR_CATEGORIA[categoria] || 'manojo';
}

/** Las siete paletas, en orden fijo. El orden importa: ver `paletaDe`. */
export const PALETAS = ['ocre', 'verde', 'salvia', 'ambar', 'miel', 'cochinilla', 'arcilla'];

/** Todas las siluetas que sabe dibujar `gen-imagenes.mjs`. */
export const FORMAS = [
  'raiz', 'hoja', 'manojo', 'flor', 'bayas', 'capsulas', 'gotero',
  'tarro', 'bolsa', 'barra', 'granos', 'botella',
];

/**
 * Color de una categoria.
 *
 * Las que ya existen tienen el suyo elegido a mano. Una categoria NUEVA —el
 * dueño puede inventarse "Mascotas" o "Bebidas" desde el alta— saca el color de
 * su propio nombre: si todas cayeran en el verde por defecto, cada categoria
 * nueva se veria identica a la anterior. Al depender solo del nombre, el color
 * es siempre el mismo para esa categoria, hoy y despues de reiniciar la base.
 */
export function paletaDe(categoria = '') {
  if (PALETA_CATEGORIA[categoria]) return PALETA_CATEGORIA[categoria];

  const nombre = String(categoria).toLowerCase();
  let suma = 0;
  for (let i = 0; i < nombre.length; i++) suma = (suma * 31 + nombre.charCodeAt(i)) % 100003;
  return PALETAS[suma % PALETAS.length];
}

/** Ruta del SVG de respaldo para un producto. */
export function rutaIlustracion(presentacion, categoria) {
  return `/img/gen/${formaDe(presentacion, categoria)}-${paletaDe(categoria)}.svg`;
}

/**
 * Todas las combinaciones posibles: doce siluetas por siete paletas.
 *
 * Antes se emitian solo las que usaba el catalogo del momento. En cuanto el
 * dueño daba de alta un producto de una categoria nueva, la lamina que le
 * tocaba no existia y la tarjeta caia al marcador generico. Son archivos de un
 * par de kilobytes: vale mas tenerlas todas que calcular cuales hacen falta.
 */
export function combinaciones() {
  return FORMAS.flatMap((f) => PALETAS.map((p) => [f, p]));
}
