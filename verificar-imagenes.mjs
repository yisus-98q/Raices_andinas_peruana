/**
 * Comprueba que las ilustraciones caben en el lienzo.
 *
 * Existe porque no siempre se puede abrir un navegador para mirarlas, y una
 * forma que se sale del viewBox aparece cortada en la tarjeta. Lee solo la
 * geometria real (rect, circle, ellipse y coordenadas de path); ignora colores,
 * el xmlns y los angulos de rotate, que no son posiciones.
 *
 *   node verificar-imagenes.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'public', 'img');
const LIENZO = 400;
const MARGEN = 4;          // tolerancia por el grosor del trazo

const num = (s) => Number(s);

/** Puntos (x,y) que ocupa cada elemento del SVG. */
function puntosDe(svg) {
  const puntos = [];

  for (const m of svg.matchAll(/<rect\b[^>]*>/g)) {
    const t = m[0];
    const g = (a) => num((t.match(new RegExp(`\\b${a}="([-\\d.]+)"`)) || [, 0])[1]);
    const x = g('x'), y = g('y'), w = g('width'), h = g('height');
    puntos.push([x, y], [x + w, y + h]);
  }

  for (const m of svg.matchAll(/<circle\b[^>]*>/g)) {
    const t = m[0];
    const g = (a) => num((t.match(new RegExp(`\\b${a}="([-\\d.]+)"`)) || [, 0])[1]);
    const cx = g('cx'), cy = g('cy'), r = g('r');
    puntos.push([cx - r, cy - r], [cx + r, cy + r]);
  }

  for (const m of svg.matchAll(/<ellipse\b[^>]*>/g)) {
    const t = m[0];
    const g = (a) => num((t.match(new RegExp(`\\b${a}="([-\\d.]+)"`)) || [, 0])[1]);
    const cx = g('cx'), cy = g('cy'), rx = g('rx'), ry = g('ry');
    // Rotada, el radio mayor puede caer en cualquier eje: usamos el mayor.
    const r = Math.max(rx, ry);
    puntos.push([cx - r, cy - r], [cx + r, cy + r]);
  }

  // Coordenadas de los path: pares x,y despues de cada comando.
  for (const m of svg.matchAll(/\sd="([^"]+)"/g)) {
    const cifras = m[1].match(/-?\d+(?:\.\d+)?/g) || [];
    for (let i = 0; i + 1 < cifras.length; i += 2) {
      puntos.push([num(cifras[i]), num(cifras[i + 1])]);
    }
  }

  return puntos;
}

let fallos = 0;
// Tambien las laminas de respaldo del catalogo grande: se dibujan con las
// mismas formas, pero si alguna se toca hay que enterarse aqui y no en la web.
const archivos = [
  ...readdirSync(DIR).filter((f) => f.endsWith('.svg')),
  ...readdirSync(join(DIR, 'gen')).filter((f) => f.endsWith('.svg')).map((f) => 'gen/' + f),
].sort();

for (const archivo of archivos) {
  const svg = readFileSync(join(DIR, archivo), 'utf8');
  const puntos = puntosDe(svg);
  if (!puntos.length) { console.log(`  ${archivo}: sin geometria`); fallos++; continue; }

  const xs = puntos.map((p) => p[0]);
  const ys = puntos.map((p) => p[1]);
  const caja = {
    x0: Math.min(...xs), x1: Math.max(...xs),
    y0: Math.min(...ys), y1: Math.max(...ys),
  };

  const problemas = [];
  if (caja.x0 < -MARGEN) problemas.push(`se sale por la izquierda (${caja.x0})`);
  if (caja.y0 < -MARGEN) problemas.push(`se sale por arriba (${caja.y0})`);
  if (caja.x1 > LIENZO + MARGEN) problemas.push(`se sale por la derecha (${caja.x1})`);
  if (caja.y1 > LIENZO + MARGEN) problemas.push(`se sale por abajo (${caja.y1})`);

  // Centrado horizontal: el dibujo debe verse equilibrado en la tarjeta.
  const centro = (caja.x0 + caja.x1) / 2;
  if (Math.abs(centro - LIENZO / 2) > 12) {
    problemas.push(`descentrado (centro en x=${centro.toFixed(0)}, deberia ser 200)`);
  }

  if (problemas.length) {
    console.log(`  ✗ ${archivo}: ${problemas.join('; ')}`);
    fallos++;
  }
}

console.log(fallos
  ? `\n${fallos} de ${archivos.length} ilustraciones con problemas.`
  : `${archivos.length} ilustraciones: todas dentro del lienzo y centradas.`);
process.exit(fallos ? 1 : 0);
