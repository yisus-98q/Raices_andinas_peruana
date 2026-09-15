/**
 * El precio sigue al tamaño.
 *
 * El catálogo de demostración ponía precio con un multiplicador por forma de
 * venta, sin mirar el contenido. Salían cosas como «Aceite de Aguaje» en
 * botella de 500 ml a S/ 29.40 y «Aceite de Aguaje en gotas», 30 ml, a
 * S/ 27.90: casi lo mismo por diecisiete veces más aceite. Una clienta que ve
 * eso no piensa «oferta», piensa que el precio está mal puesto.
 *
 * El criterio, entre presentaciones DEL MISMO producto y en la misma unidad
 * (gramos, mililitros, cápsulas, filtrantes…):
 *
 *  - lo más grande cuesta más, por lo menos en proporción a la raíz cúbica
 *    del tamaño: ocho veces el contenido, al menos el doble de precio;
 *  - y nunca sale más caro por unidad: ocho veces el contenido, como mucho
 *    ocho veces el precio.
 *
 * Se ancla en la presentación más grande y se corrigen las más chicas.
 *
 * Entre esos dos límites cabe el descuento por tamaño que tiene cualquier
 * tienda, así que solo se corrige lo que queda fuera. «El mismo producto» es
 * el nombre sin lo que solo cambia el envase o el tamaño (en gotas, roll-on,
 * para difusor, tamaño viaje…): la Maca Negra en polvo y la gelatinizada son
 * productos distintos y cada una tiene su precio.
 *
 * Lo usan `gen-catalogo.mjs` al generar y `db.js` para corregir una base ya
 * sembrada. Es un punto fijo: aplicarlo dos veces da lo mismo que una.
 */

const sinTildes = (t) => String(t).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** «Bolsa 1 kg» → { unidad: 'g', cantidad: 1000 }; null si no se entiende. */
export function contenidoDe(presentacion) {
  const t = sinTildes(presentacion);
  const cuenta = t.match(/(\d+)\s+(capsulas|tabletas|filtrantes|sachets|viales|ampollas|unidades|palitos)\b/);
  if (cuenta) {
    const unidad = cuenta[2] === 'sachets' ? 'filtrantes' : cuenta[2];
    return { unidad, cantidad: Number(cuenta[1]) };
  }
  const pack = t.match(/(\d+)\s+barras?\s+(\d+(?:[.,]\d+)?)\s*g\b/);
  if (pack) return { unidad: 'g', cantidad: Number(pack[1]) * Number(pack[2].replace(',', '.')) };
  const medida = t.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/);
  if (!medida) return null;
  const n = Number(medida[1].replace(',', '.'));
  if (medida[2] === 'kg') return { unidad: 'g', cantidad: n * 1000 };
  if (medida[2] === 'l') return { unidad: 'ml', cantidad: n * 1000 };
  return { unidad: medida[2], cantidad: n };
}

// Lo que solo cambia el envase o el tamaño, no lo que hay adentro.
const SOLO_ENVASE = /\s*(·\s*tamano (familiar|viaje)|·\s*pack de \d+|en gotas|en spray|roll-on|para difusor|en sachets|en filtrantes)\s*$/;

/** «Aceite de Aguaje en gotas» y «Aceite de Aguaje» → «aceite de aguaje». */
export function productoBase(nombre) {
  let t = sinTildes(nombre).replace(/\s+/g, ' ').trim();
  for (let antes = ''; antes !== t;) { antes = t; t = t.replace(SOLO_ENVASE, '').trim(); }
  return t;
}

// Los precios de la tienda terminan en .40 o .90.
const redondeoArriba = (x) => Math.max(4.9, Math.round((Math.ceil(x * 2) / 2 - 0.1) * 10) / 10);
const redondeoAbajo = (x) => Math.max(4.9, Math.round((Math.floor(x * 2) / 2 - 0.1) * 10) / 10);

/**
 * Devuelve `[{ item, precio, costo }]` solo para los que cambian.
 *
 * `items`: objetos con `nombre`, `presentacion`, `precio` y `costo`.
 * `grupoDe(item)`, opcional: separa productos que se llaman igual pero no son
 * el mismo (por defecto, la categoría y el origen).
 */
export function preciosPorTamano(items, grupoDe = (p) => `${p.categoria}|${p.origen}`) {
  const grupos = new Map();
  for (const item of items) {
    const contenido = contenidoDe(item.presentacion);
    if (!contenido) continue;
    const clave = `${grupoDe(item)}|${productoBase(item.nombre)}|${contenido.unidad}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push({ item, cantidad: contenido.cantidad, precio: item.precio });
  }

  const cambios = [];
  for (const lista of grupos.values()) {
    if (lista.length < 2) continue;
    // Manda la presentación más grande, que es la de la góndola; se corrigen
    // las chicas. Al revés, un gotero caro arrastraba a la botella de 500 ml
    // a más de S/ 70. Del más grande al más chico; a igual tamaño, en el orden
    // en que vinieron.
    lista.sort((a, b) => b.cantidad - a.cantidad);
    for (let i = 0; i < lista.length; i++) {
      const actual = lista[i];
      let piso = 0;
      let techo = Infinity;
      for (let j = 0; j < i; j++) {
        const mayor = lista[j];
        if (mayor.cantidad <= actual.cantidad) continue;
        const veces = mayor.cantidad / actual.cantidad;
        techo = Math.min(techo, mayor.precio / Math.cbrt(veces));   // lo chico cuesta menos
        piso = Math.max(piso, mayor.precio / veces);                // pero no menos por unidad
      }
      if (techo === Infinity) continue;

      // Con margen de redondeo: un precio a medio sol del límite ya está bien.
      // Si los dos límites chocan, gana que lo chico cueste menos.
      let nuevo = actual.precio;
      if (actual.precio > techo + 0.6) nuevo = redondeoAbajo(techo);
      else if (actual.precio < piso - 0.6) nuevo = Math.min(redondeoArriba(piso), redondeoAbajo(techo));
      if (nuevo === actual.precio) continue;

      // El margen se conserva: el costo se mueve en la misma proporción.
      const proporcion = actual.item.precio > 0 ? actual.item.costo / actual.item.precio : 0.5;
      const costo = Math.round(nuevo * Math.min(proporcion, 0.9) * 10) / 10;
      actual.precio = nuevo;
      cambios.push({ item: actual.item, precio: nuevo, costo });
    }
  }
  return cambios;
}
