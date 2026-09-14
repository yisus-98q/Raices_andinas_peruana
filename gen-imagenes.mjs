/**
 * Genera una ilustracion SVG por producto en public/img/<SKU>.svg
 *
 * Segunda version. La primera usaba curvas bezier calculadas con trigonometria
 * (petalos por angulo, hojas por interpolacion) y se veian mal: cuando no puedes
 * abrir el navegador, la geometria "inteligente" es justo lo que se rompe.
 *
 * Regla de esta version: solo circulos, rectangulos redondeados y trazos rectos.
 * Todo centrado en x=200, simetrico, dentro de un area segura. Formas que no
 * tienen como salir torcidas.
 *
 *   node gen-imagenes.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { combinaciones } from './ilustraciones.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const DESTINO = join(RAIZ, 'public', 'img');
mkdirSync(DESTINO, { recursive: true });

// El contorno es la tinta de la marca (verde casi negro), no un marrón aparte:
// es el mismo color que los titulares de la página.
const TINTA = '#1c2a22';
const GROSOR = 6;

/**
 * Paletas por familia de producto. f1 = claro (etiquetas), a = cuerpo,
 * b = detalle, c = sombra.
 *
 * Tercera versión: las siete salen de los colores de la marca. Antes cada una se
 * eligió suelta —un naranja, un amarillo miel, un rojo cochinilla— y en una
 * grilla de cuatrocientas tarjetas se veía como una caja de lápices, sin nada que
 * ver con el verde y la terracota del resto de la página.
 *
 * Ahora son tres familias con la misma saturación contenida:
 *   - verdes (verde, salvia)          ← --verde #2a6b46
 *   - tierras (terracota, cochinilla,
 *     arcilla)                        ← --terra #b4552f
 *   - dorados (ocre, miel)            ← --miel  #d99a2b
 * Los nombres se conservan porque son la clave de los archivos /img/gen y de
 * `paletaDe` en ilustraciones.mjs: cambiar el color no cambia ninguna ruta.
 */
const PALETAS = {
  verde:      { f1: '#eef4ef', a: '#4f8a63', b: '#2a6b46', c: '#1d4a31' },
  salvia:     { f1: '#f1f5ec', a: '#8fae7a', b: '#5f8a55', c: '#3f6340' },
  ocre:       { f1: '#f7f0e4', a: '#c89b5a', b: '#9c7238', c: '#6e4f26' },
  miel:       { f1: '#fbf3e1', a: '#d99a2b', b: '#b27c1c', c: '#7d5612' },
  ambar:      { f1: '#f9ede5', a: '#cf8350', b: '#b4552f', c: '#7f3a20' },
  cochinilla: { f1: '#f7e9e4', a: '#a8503a', b: '#823a28', c: '#5a281c' },
  arcilla:    { f1: '#f8f1ec', a: '#d7b49a', b: '#a98266', c: '#74584a' },
};

/**
 * Fondo: blanco de estudio y una sombra de apoyo bajo el objeto.
 *
 * Antes era un degradado del color de la paleta con dos aros. Sobre el blanco de
 * las tarjetas cada categoría quedaba como un cuadro de color distinto; ahora
 * todas comparten el mismo fondo, como las fotos de producto de un catálogo, y
 * lo único que cambia es el objeto.
 */
const fondo = () => `
  <rect width="400" height="400" fill="#ffffff"/>
  <ellipse cx="200" cy="338" rx="96" ry="12" fill="${TINTA}" opacity=".07"/>`;

const T = (d, fill) =>
  `<path d="${d}" fill="${fill}" stroke="${TINTA}" stroke-width="${GROSOR}"
     stroke-linejoin="round" stroke-linecap="round"/>`;

const L = (d, ancho = 5) =>
  `<path d="${d}" fill="none" stroke="${TINTA}" stroke-width="${ancho}"
     stroke-linecap="round" stroke-linejoin="round"/>`;

const R = (x, y, w, h, r, fill) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"
     stroke="${TINTA}" stroke-width="${GROSOR}" stroke-linejoin="round"/>`;

const C = (cx, cy, r, fill) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"
     stroke="${TINTA}" stroke-width="${GROSOR}"/>`;

// Brillo suave, sin contorno: da volumen sin ensuciar la silueta.
const brillo = (x, y, w, h, r = 6) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="#fff" opacity=".3"/>`;

// --------------------------------------------------------------------- formas
const FORMAS = {
  // Tuberculo: maca. Cuerpo simetrico, dos hojas iguales, tres raicillas.
  raiz: (p) => [
    L('M200 148 L200 112'),
    T('M200 130 C178 106 154 100 140 110 C152 132 178 142 200 130 Z', p.b),
    T('M200 130 C222 106 246 100 260 110 C248 132 222 142 200 130 Z', p.b),
    T('M200 146 C154 146 132 186 132 224 C132 270 162 302 200 302 ' +
      'C238 302 268 270 268 224 C268 186 246 146 200 146 Z', p.a),
    L('M200 302 L200 336'),
    L('M172 294 L152 326'),
    L('M228 294 L248 326'),
    L('M200 186 L200 268', 4),
  ],

  // Hoja unica y grande: boldo, muña.
  hoja: (p) => [
    T('M200 92 C256 136 266 232 200 316 C134 232 144 136 200 92 Z', p.a),
    L('M200 118 L200 300'),
    L('M200 168 L158 196'), L('M200 168 L242 196'),
    L('M200 218 L164 244'), L('M200 218 L236 244'),
  ],

  // Manojo atado: infusiones. Tres tallos simetricos con hojas ovaladas.
  manojo: (p) => [
    L('M200 300 L160 148'), L('M200 300 L200 138'), L('M200 300 L240 148'),
    ...[[160, 170], [168, 214], [176, 254]].flatMap(([x, y]) =>
      [`<ellipse cx="${x}" cy="${y}" rx="26" ry="14" fill="${p.a}"
          stroke="${TINTA}" stroke-width="${GROSOR}" transform="rotate(-30 ${x} ${y})"/>`]),
    ...[[240, 170], [232, 214], [224, 254]].flatMap(([x, y]) =>
      [`<ellipse cx="${x}" cy="${y}" rx="26" ry="14" fill="${p.a}"
          stroke="${TINTA}" stroke-width="${GROSOR}" transform="rotate(30 ${x} ${y})"/>`]),
    `<ellipse cx="200" cy="160" rx="26" ry="14" fill="${p.b}"
       stroke="${TINTA}" stroke-width="${GROSOR}"/>`,
    R(172, 288, 56, 26, 6, p.c),
  ],

  // Flor de manzanilla: ocho petalos circulares. Imposible que salga torcida.
  flor: (p) => [
    L('M200 236 L200 330'),
    T('M200 296 C176 286 162 268 162 250 C186 254 200 274 200 296 Z', p.b),
    ...Array.from({ length: 8 }, (_, i) => {
      const a = (i * 45 * Math.PI) / 180;
      return C(Math.round(200 + Math.cos(a) * 66), Math.round(190 + Math.sin(a) * 66), 32, '#fffdf6');
    }),
    C(200, 190, 40, p.a),
    `<circle cx="188" cy="180" r="6" fill="${p.c}" opacity=".45"/>`,
    `<circle cx="210" cy="198" r="6" fill="${p.c}" opacity=".45"/>`,
  ],

  // Racimo de tres bayas: camu camu, graviola.
  bayas: (p) => [
    L('M200 118 L200 186'),
    T('M200 146 C224 120 254 120 268 134 C252 160 222 164 200 146 Z', p.b),
    C(168, 228, 48, p.a),
    C(232, 228, 48, p.a),
    C(200, 288, 44, p.a),
    `<circle cx="152" cy="212" r="10" fill="#fff" opacity=".42"/>`,
    `<circle cx="216" cy="212" r="10" fill="#fff" opacity=".42"/>`,
    `<circle cx="186" cy="274" r="9" fill="#fff" opacity=".42"/>`,
  ],

  // Frasco de capsulas: tapa, cuello, cuerpo y etiqueta centrada.
  capsulas: (p) => [
    R(164, 92, 72, 30, 7, p.c),
    R(176, 120, 48, 30, 4, p.b),
    R(140, 148, 120, 172, 18, p.f1),
    R(140, 200, 120, 74, 4, p.a),
    brillo(158, 168, 14, 130, 7),
    `<rect x="162" y="222" width="76" height="8" rx="4" fill="#fffdf6" opacity=".85"/>`,
    `<rect x="174" y="244" width="52" height="8" rx="4" fill="#fffdf6" opacity=".6"/>`,
  ],

  // Frasco gotero: aceites y extractos.
  gotero: (p) => [
    R(180, 88, 40, 44, 7, p.c),
    R(170, 130, 60, 26, 4, p.b),
    R(154, 154, 92, 166, 16, p.a),
    R(154, 206, 92, 72, 4, p.f1),
    brillo(170, 174, 13, 126, 6),
    C(200, 242, 20, p.b),
  ],

  // Tarro ancho: miel, polen.
  tarro: (p) => [
    R(178, 96, 44, 20, 6, p.c),
    R(136, 114, 128, 36, 8, p.b),
    R(128, 148, 144, 172, 24, p.a),
    R(128, 204, 144, 76, 4, p.f1),
    brillo(148, 172, 15, 130, 7),
    T('M200 222 C186 240 178 252 178 262 C178 274 188 282 200 282 ' +
      'C212 282 222 274 222 262 C222 252 214 240 200 222 Z', p.b),
  ],

  // Bolsa de polvo con ventana.
  bolsa: (p) => [
    R(140, 112, 120, 34, 6, p.b),
    T('M150 144 L250 144 L268 320 L132 320 Z', p.f1),
    R(166, 190, 68, 84, 8, p.a),
    `<circle cx="200" cy="232" r="22" fill="${p.c}" opacity=".45"/>`,
    `<rect x="158" y="292" width="84" height="7" rx="3.5" fill="${p.c}" opacity=".3"/>`,
  ],

  // Barra de jabon, con una lamina detras que le da volumen.
  barra: (p) => [
    R(132, 156, 156, 96, 22, p.b),
    R(116, 178, 156, 96, 22, p.a),
    `<ellipse cx="194" cy="226" rx="50" ry="30" fill="${p.f1}" opacity=".8"/>`,
    C(194, 226, 16, p.b),
  ],

  // Cuenco con grano: quinua, kiwicha.
  granos: (p) => [
    T('M150 202 C160 164 176 144 200 144 C224 144 240 164 250 202 Z', p.a),
    ...[[176, 186], [200, 174], [224, 186], [188, 162], [212, 162]].map(([x, y]) =>
      `<ellipse cx="${x}" cy="${y}" rx="11" ry="8" fill="${p.b}"
         stroke="${TINTA}" stroke-width="4"/>`),
    R(112, 198, 176, 22, 11, p.c),
    T('M124 220 L276 220 C276 286 242 322 200 322 C158 322 124 286 124 220 Z', p.f1),
    brillo(150, 244, 20, 44, 10),
  ],

  // Botella alta: jugos y jarabes.
  botella: (p) => [
    R(176, 88, 48, 30, 6, p.c),
    R(184, 116, 32, 46, 4, p.b),
    R(148, 160, 104, 160, 18, p.a),
    R(148, 210, 104, 72, 4, p.f1),
    brillo(164, 180, 13, 122, 6),
    C(200, 246, 20, p.b),
  ],
};

// SKU -> [forma, paleta]
const MAPA = {
  'MAC-001': ['raiz', 'ocre'],       'MAC-002': ['bolsa', 'ocre'],
  'UNG-001': ['capsulas', 'verde'],  'SAN-001': ['gotero', 'cochinilla'],
  'CHA-001': ['manojo', 'salvia'],   'CAM-001': ['bayas', 'cochinilla'],
  'HER-001': ['manojo', 'verde'],    'MUN-001': ['hoja', 'salvia'],
  'MAN-001': ['flor', 'miel'],       'VAL-001': ['capsulas', 'salvia'],
  'MIE-001': ['tarro', 'miel'],      'PRO-001': ['gotero', 'ambar'],
  'POL-001': ['tarro', 'ocre'],      'SAC-001': ['capsulas', 'ocre'],
  'ACE-001': ['gotero', 'ambar'],    'ACE-002': ['gotero', 'arcilla'],
  'JAB-001': ['barra', 'arcilla'],   'YAC-001': ['botella', 'ambar'],
  'QUI-001': ['granos', 'ocre'],     'KIW-001': ['granos', 'miel'],
  'BOL-001': ['hoja', 'verde'],      'COL-001': ['manojo', 'salvia'],
  'NON-001': ['botella', 'verde'],   'GRA-001': ['bayas', 'salvia'],
};

let n = 0;
for (const [sku, [forma, paleta]] of Object.entries(MAPA)) {
  const p = PALETAS[paleta];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" role="img">
${fondo(p, sku.replace('-', ''))}
${FORMAS[forma](p).join('\n')}
</svg>`;
  writeFileSync(join(DESTINO, sku + '.svg'), svg);
  n++;
}
console.log(`${n} ilustraciones por SKU en public/img/`);

/**
 * Matriz forma x paleta para el catalogo grande. Un producto sin foto cae aqui
 * segun su presentacion y su categoria, en vez de repetir la misma lamina
 * generica 400 veces. Son unas pocas decenas de archivos, no 400.
 */
const GEN = join(DESTINO, 'gen');
mkdirSync(GEN, { recursive: true });

const pares = combinaciones();

let m = 0;
for (const [forma, paleta] of pares) {
  if (!FORMAS[forma] || !PALETAS[paleta]) {
    console.warn(`  combinacion desconocida: ${forma}-${paleta}`);
    continue;
  }
  const p = PALETAS[paleta];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" role="img">
${fondo(p, forma + paleta)}
${FORMAS[forma](p).join('\n')}
</svg>`;
  writeFileSync(join(GEN, `${forma}-${paleta}.svg`), svg);
  m++;
}
console.log(`${m} ilustraciones de respaldo en public/img/gen/`);
