/**
 * Compacta el ubigeo del INEI en un archivo que la tienda pueda cargar.
 *
 *   node gen-ubigeo.mjs
 *
 * Fuente: dataset público de ubigeos del INEI 2016 (25 departamentos,
 * 196 provincias, 1 874 distritos), descargado una sola vez a `.cache/`.
 *
 * Se compacta a propósito: el JSON original repite las claves en cada una de
 * las 1 874 filas. Aquí los distritos son solo nombres dentro de su provincia,
 * y el código de ubigeo se reconstruye por posición. Pasa de ~250 KB a ~45 KB,
 * que es lo que se descarga el cliente al abrir el checkout.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const CACHE = join(RAIZ, '.cache');

for (const f of ['departamentos', 'provincias', 'distritos']) {
  if (!existsSync(join(CACHE, f + '.json'))) {
    console.error(`Falta .cache/${f}.json. Descárgalo primero (ver README).`);
    process.exit(1);
  }
}

// El dataset trae nombres con espacios al final ("Lima ", "Barranca "). Sin
// limpiarlos, la comparación contra las zonas de reparto fallaría en silencio.
const limpiar = (t) => String(t).replace(/\s+/g, ' ').trim();
const leer = (f) => JSON.parse(readFileSync(join(CACHE, f + '.json'), 'utf8'))
  .map((r) => ({ ...r, name: limpiar(r.name) }));
const departamentos = leer('departamentos');
const provincias = leer('provincias');
const distritos = leer('distritos');

// Estructura final:
//   { "01": ["Amazonas", [ ["Chachapoyas", ["Chachapoyas","Asunción",...]], ... ] ] }
// El código de provincia es dep + posición+1 con dos dígitos; el de distrito,
// prov + posición+1. Así no hace falta guardar ningún id.
const salida = {};

for (const d of departamentos) {
  const provs = provincias
    .filter((p) => p.department_id === d.id)
    .sort((a, b) => a.id.localeCompare(b.id));

  salida[d.id] = [d.name, provs.map((p) => {
    const dists = distritos
      .filter((x) => x.province_id === p.id)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((x) => x.name);
    return [p.name, dists];
  })];
}

const destino = join(RAIZ, 'public', 'ubigeo.json');
writeFileSync(destino, JSON.stringify(salida));

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
const totalDist = Object.values(salida)
  .reduce((s, [, ps]) => s + ps.reduce((t, [, ds]) => t + ds.length, 0), 0);

console.log(`  ${Object.keys(salida).length} departamentos`);
console.log(`  ${provincias.length} provincias`);
console.log(`  ${totalDist} distritos`);
console.log(`  public/ubigeo.json  ${kb(readFileSync(destino).length)}`);
