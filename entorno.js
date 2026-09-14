/**
 * Carga `.env` antes que cualquier otro módulo lea `process.env`.
 *
 * `.env.example` documentaba HOST, DB_PATH, RESPALDO_DIR, ADMIN_PASSWORD… pero
 * nada leía el `.env`: copiarlo y editarlo no cambiaba nada, y la clave del
 * panel caía siempre a la de fábrica. Se importa en primer lugar desde
 * server.js, db.js y los scripts de consola.
 *
 * Sin dependencias: `util.parseEnv` viene con Node desde la 21.7.
 *
 * - Lo que ya está en el entorno manda sobre el archivo: `PORT=0 npm start`
 *   tiene que poder pisar al `.env`, igual que en cualquier herramienta.
 * - Durante `node --test` no se lee. Un `.env` de la laptop con SIN_LIMITES o
 *   CONFIAR_PROXY cambiaría lo que prueban los tests sin que nadie lo note.
 * - `RA_ENV_FILE` apunta a otro archivo (lo usa su propio test).
 */
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(fileURLToPath(import.meta.url));

export function cargarEntorno(ruta = process.env.RA_ENV_FILE || join(RAIZ, '.env')) {
  if (process.env.NODE_TEST_CONTEXT && !process.env.RA_ENV_FILE) return [];
  if (!existsSync(ruta)) return [];
  const valores = parseEnv(readFileSync(ruta, 'utf8'));
  const cargadas = [];
  for (const [clave, valor] of Object.entries(valores)) {
    if (process.env[clave] !== undefined) continue;
    process.env[clave] = valor;
    cargadas.push(clave);
  }
  return cargadas;
}

cargarEntorno();
