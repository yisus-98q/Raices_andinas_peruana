/**
 * Importa fotografías propias desde la carpeta `img/` de la raíz.
 *
 *   node importar-fotos.mjs           importa y actualiza la tienda
 *   node importar-fotos.mjs --probar  solo muestra el emparejamiento
 *
 * Cómo usarlo: se dejan las fotos en `img/` con el NOMBRE DEL PRODUCTO como
 * nombre de archivo. No hace falta que coincida exactamente — el emparejamiento
 * tolera tildes, mayúsculas, plurales y erratas ("gaviola" encuentra "Graviola").
 *
 * Estas fotos mandan sobre las descargadas de bancos libres: son las del
 * negocio. `traer-fotos.mjs` solo rellena lo que falte.
 *
 * La carpeta `img/` está FUERA de `public/`, así que no se sirve por HTTP:
 * los originales no quedan expuestos, solo la copia que entra al catálogo.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const ORIGEN = join(RAIZ, 'img');
const DESTINO = join(RAIZ, 'public', 'img', 'fotos');
const PROBAR = process.argv.includes('--probar');

if (!existsSync(ORIGEN)) {
  console.log('No existe la carpeta img/. Crea una y deja ahí las fotos.');
  process.exit(0);
}
mkdirSync(DESTINO, { recursive: true });

const normalizar = (t) => t.toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

// Palabras que no distinguen un producto de otro: si pesaran igual que el
// nombre, "sacha inchi en capsula" empataría con cualquier otra cápsula.
const VACIAS = new Set(['de', 'en', 'la', 'el', 'y', 'del', 'con', 'para']);

/**
 * Coeficiente de Dice sobre bigramas: mide parecido tolerando erratas.
 * "gaviola" y "graviola" comparten casi todos sus pares de letras.
 */
function parecido(a, b) {
  const bigramas = (s) => {
    const t = s.replace(/\s+/g, '');
    const r = new Map();
    for (let i = 0; i < t.length - 1; i++) {
      const par = t.slice(i, i + 2);
      r.set(par, (r.get(par) || 0) + 1);
    }
    return r;
  };
  const A = bigramas(a); const B = bigramas(b);
  if (!A.size || !B.size) return 0;
  let comunes = 0;
  let totalA = 0; let totalB = 0;
  for (const n of A.values()) totalA += n;
  for (const n of B.values()) totalB += n;
  for (const [par, n] of A) comunes += Math.min(n, B.get(par) || 0);
  return (2 * comunes) / (totalA + totalB);
}

/** Puntúa un nombre de archivo contra un producto. 0 a 1. */
function puntuar(archivo, producto) {
  const a = normalizar(archivo);
  const b = normalizar(producto);
  if (a === b) return 1;

  const tokensA = a.split(' ').filter((t) => t && !VACIAS.has(t));
  const tokensB = b.split(' ').filter((t) => t && !VACIAS.has(t));

  // Cuántas palabras del archivo reconoce el producto (o al revés, si una es
  // el plural o el singular de la otra).
  let aciertos = 0;
  for (const t of tokensA) {
    if (tokensB.some((u) => u === t || u.startsWith(t) || t.startsWith(u))) aciertos++;
  }
  const cobertura = tokensA.length ? aciertos / tokensA.length : 0;

  // Mezclamos cobertura de palabras con parecido de letras: la primera acierta
  // en nombres largos, el segundo salva las erratas.
  return cobertura * 0.6 + parecido(a, b) * 0.4;
}

/** Confirma que el archivo es de verdad una imagen, mire lo que mire la extensión. */
function tipoReal(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.slice(0, 4).toString('ascii') === 'RIFF'
      && bytes.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (bytes.slice(0, 5).toString('ascii').includes('<svg')
      || bytes.slice(0, 200).toString('ascii').includes('<svg')) return 'svg';
  return null;
}

// ------------------------------------------------------------------ proceso
const productos = db.prepare('SELECT id, sku, nombre FROM productos').all();
const archivos = readdirSync(ORIGEN)
  .filter((f) => !f.startsWith('.') && extname(f))
  .sort();

if (!archivos.length) {
  console.log('La carpeta img/ está vacía.');
  process.exit(0);
}

const rutaCreditos = join(DESTINO, 'creditos.json');
const creditos = existsSync(rutaCreditos)
  ? JSON.parse(readFileSync(rutaCreditos, 'utf8'))
  : {};

const actualizar = db.prepare('UPDATE productos SET imagen = ? WHERE sku = ?');
const UMBRAL = 0.45;

const asignados = new Map();   // sku -> { archivo, puntos }
const dudosos = [];

for (const archivo of archivos) {
  const nombre = basename(archivo, extname(archivo));
  const puntuadas = productos
    .map((p) => ({ p, puntos: puntuar(nombre, p.nombre) }))
    .sort((x, y) => y.puntos - x.puntos);

  const mejor = puntuadas[0];
  const segundo = puntuadas[1];

  if (!mejor || mejor.puntos < UMBRAL) {
    dudosos.push({ archivo, motivo: 'no se parece a ningún producto' });
    continue;
  }
  // Si dos productos empatan, mejor avisar que adivinar.
  if (segundo && mejor.puntos - segundo.puntos < 0.08) {
    dudosos.push({
      archivo,
      motivo: `ambiguo entre "${mejor.p.nombre}" y "${segundo.p.nombre}"`,
    });
    continue;
  }
  // Si dos archivos apuntan al mismo producto, se queda el que puntúa más.
  const previo = asignados.get(mejor.p.sku);
  if (previo && previo.puntos >= mejor.puntos) {
    dudosos.push({ archivo, motivo: `"${previo.archivo}" ya ocupa ese producto` });
    continue;
  }
  asignados.set(mejor.p.sku, { archivo, puntos: mejor.puntos, producto: mejor.p });
}

console.log(`\n  ${archivos.length} archivo(s) en img/\n`);

let copiadas = 0;
for (const [sku, dato] of asignados) {
  const bytes = readFileSync(join(ORIGEN, dato.archivo));
  const tipo = tipoReal(bytes);
  if (!tipo) {
    dudosos.push({ archivo: dato.archivo, motivo: 'no es una imagen válida' });
    continue;
  }

  const confianza = dato.puntos >= 0.85 ? 'exacto' : dato.puntos >= 0.6 ? 'bueno' : 'aproximado';
  console.log(`  ${dato.archivo.padEnd(34).slice(0, 34)} -> ${dato.producto.nombre.padEnd(26)} ${confianza}`);

  if (PROBAR) continue;

  // El .jfif de Windows es JPEG: se guarda con la extensión que le corresponde
  // de verdad, para que el navegador no dude del tipo.
  const destino = `${sku}.${tipo}`;
  writeFileSync(join(DESTINO, destino), bytes);
  creditos[sku] = {
    archivo: destino,
    sku,
    titulo: basename(dato.archivo, extname(dato.archivo)),
    autor: 'Raíz Andina',
    licencia: 'PROPIA',
    fuente: '',
    proveedor: 'foto del negocio',
  };
  actualizar.run('/img/fotos/' + destino, sku);
  copiadas++;
}

if (dudosos.length) {
  console.log('\n  Sin importar:');
  for (const d of dudosos) console.log(`  · ${d.archivo}: ${d.motivo}`);
}

if (!PROBAR) {
  writeFileSync(rutaCreditos, JSON.stringify(creditos, null, 2));
  const propias = Object.values(creditos).filter((c) => c.licencia === 'PROPIA').length;
  const total = productos.length;
  console.log(`\n  ${copiadas} foto(s) propia(s) importada(s).`);
  console.log(`  ${propias} de ${total} productos con foto del negocio; ` +
    `los otros ${total - propias} siguen con imagen de banco libre.`);
} else {
  console.log('\n  (--probar: no se escribió nada)');
}
