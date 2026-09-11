/**
 * Descarga una fotografía real por producto desde bancos de imágenes libres.
 *
 *   node traer-fotos.mjs            descarga las que falten
 *   node traer-fotos.mjs --forzar   vuelve a descargar todas
 *
 * Por qué Openverse y no Pixabay: Pixabay bloquea las peticiones automatizadas
 * (403), y sobre todo Openverse devuelve la LICENCIA y el AUTOR de cada imagen.
 * Eso es lo que el cliente necesita para publicar sin problemas legales.
 * Pedimos solo CC0 y dominio público: uso comercial libre, sin atribución
 * obligatoria. Aun así guardamos los créditos en fotos/creditos.json.
 *
 * Por qué se descargan y no se enlazan: enlazar deja la tienda dependiendo de
 * un CDN ajeno. Sin internet en el local del cliente, la demo se llena de
 * cuadros rotos. Descargadas, pesan una vez y funcionan siempre.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const DESTINO = join(RAIZ, 'public', 'img', 'fotos');
mkdirSync(DESTINO, { recursive: true });

const FORZAR = process.argv.includes('--forzar');
const MAX_BYTES = 1400 * 1024;          // por encima de esto, la página se arrastra
const ESPERA = 12000;

// Qué buscar para cada producto. En inglés: los bancos libres están indexados
// casi todo en inglés, y "uña de gato" en español devuelve gatos de verdad.
const BUSQUEDAS = {
  'MAC-001': 'root vegetable turnip',
  'MAC-002': 'maca powder bowl',
  'UNG-001': 'herbal capsules bottle',
  'SAN-001': 'glass dropper bottle',
  'CHA-001': 'dried medicinal herbs',
  'CAM-001': 'acerola cherry fruit',
  'HER-001': 'dried herb tea leaves',
  'MUN-001': 'fresh mint leaves',
  'MAN-001': 'chamomile flowers',
  'VAL-001': 'valerian root',
  'MIE-001': 'honey jar',
  'PRO-001': 'propolis bee',
  'POL-001': 'bee pollen granules',
  'SAC-001': 'peanut seeds nuts',
  'ACE-001': 'essential oil bottle wood',
  'ACE-002': 'rose hip fruit',
  'JAB-001': 'handmade soap bar',
  'YAC-001': 'syrup glass bottle',
  'QUI-001': 'quinoa grain',
  'KIW-001': 'amaranth grain',
  'BOL-001': 'laurel leaf plant',
  'COL-001': 'horsetail plant equisetum',
  'NON-001': 'noni fruit',
  'GRA-001': 'soursop graviola fruit',
};

const conTiempo = (url, ms = ESPERA) =>
  fetch(url, {
    signal: AbortSignal.timeout(ms),
    headers: { 'User-Agent': 'RaizAndina/1.0 (demo local)' },
  });

/** Busca en Openverse. Primero dominio público; si no hay, CC BY. */
async function buscar(consulta) {
  for (const licencia of ['cc0,pdm', 'by']) {
    const url = 'https://api.openverse.org/v1/images/'
      + `?q=${encodeURIComponent(consulta)}&license=${licencia}`
      + '&page_size=20&mature=false&aspect_ratio=square,wide';
    try {
      const r = await conTiempo(url);
      if (!r.ok) continue;
      const datos = await r.json();
      if (datos.results?.length) return datos.results;
    } catch { /* probamos la siguiente licencia */ }
  }
  return [];
}

/** Descarga la primera candidata que sea una imagen de tamaño razonable. */
async function descargar(candidatas, sku) {
  for (const c of candidatas) {
    if (!c.url) continue;
    try {
      const r = await conTiempo(c.url);
      if (!r.ok) continue;
      const tipo = r.headers.get('content-type') || '';
      if (!tipo.startsWith('image/')) continue;

      const bytes = Buffer.from(await r.arrayBuffer());
      if (bytes.length < 8 * 1024) continue;            // miniatura inservible
      if (bytes.length > MAX_BYTES) continue;           // demasiado pesada

      const ext = tipo.includes('png') ? 'png' : tipo.includes('webp') ? 'webp' : 'jpg';
      const archivo = `${sku}.${ext}`;
      writeFileSync(join(DESTINO, archivo), bytes);
      return {
        archivo,
        kb: Math.round(bytes.length / 1024),
        credito: {
          sku,
          titulo: c.title || '',
          autor: c.creator || 'Desconocido',
          licencia: (c.license || '').toUpperCase() + ' ' + (c.license_version || ''),
          fuente: c.foreign_landing_url || c.url,
          proveedor: c.provider || '',
        },
      };
    } catch { /* siguiente candidata */ }
  }
  return null;
}

// ------------------------------------------------------------------ proceso
const rutaCreditos = join(DESTINO, 'creditos.json');
const creditos = existsSync(rutaCreditos)
  ? JSON.parse(readFileSync(rutaCreditos, 'utf8'))
  : {};

const actualizar = db.prepare('UPDATE productos SET imagen = ? WHERE sku = ?');
const productos = db.prepare('SELECT sku, nombre FROM productos ORDER BY sku').all();

let bajadas = 0, saltadas = 0, fallidas = 0;

for (const p of productos) {
  const consulta = BUSQUEDAS[p.sku];
  if (!consulta) { saltadas++; continue; }

  // Una foto propia del negocio manda siempre: ni --forzar la pisa.
  if (creditos[p.sku]?.licencia === 'PROPIA') {
    actualizar.run('/img/fotos/' + creditos[p.sku].archivo, p.sku);
    saltadas++;
    continue;
  }

  const yaTengo = creditos[p.sku]?.archivo
    && existsSync(join(DESTINO, creditos[p.sku].archivo));
  if (yaTengo && !FORZAR) {
    actualizar.run('/img/fotos/' + creditos[p.sku].archivo, p.sku);
    saltadas++;
    continue;
  }

  process.stdout.write(`  ${p.sku.padEnd(9)} ${p.nombre.slice(0, 26).padEnd(28)}`);
  const candidatas = await buscar(consulta);
  const bajada = candidatas.length ? await descargar(candidatas, p.sku) : null;

  if (!bajada) {
    // Sin foto se queda la ilustración: la tarjeta nunca aparece vacía.
    console.log('sin resultado, queda la ilustración');
    fallidas++;
    continue;
  }

  creditos[p.sku] = { archivo: bajada.archivo, ...bajada.credito };
  actualizar.run('/img/fotos/' + bajada.archivo, p.sku);
  console.log(`${String(bajada.kb).padStart(4)} KB  ${bajada.credito.licencia.trim()}`);
  bajadas++;
}

writeFileSync(rutaCreditos, JSON.stringify(creditos, null, 2));

console.log(`\n  ${bajadas} descargadas · ${saltadas} ya estaban · ${fallidas} sin resultado`);
console.log(`  Créditos en public/img/fotos/creditos.json`);
