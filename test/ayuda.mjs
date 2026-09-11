/**
 * Utilidades compartidas por los tests.
 *
 * Cada suite levanta su propio servidor, en su propio puerto y con su propia
 * base desechable (DB_PATH). Asi los tests no dependen del orden en que corran
 * ni ensucian la base de la demo.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function levantarServidor({ limites = false } = {}) {
  const carpeta = mkdtempSync(join(tmpdir(), 'ra-test-'));
  const dbPath = join(carpeta, 'prueba.db');

  // Semilla en la base desechable antes de arrancar.
  await new Promise((resolve, reject) => {
    const semilla = spawn(process.execPath, ['db.js', '--reset'], {
      cwd: RAIZ,
      env: { ...process.env, DB_PATH: dbPath },
      stdio: 'ignore',
    });
    semilla.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('seed falló: ' + c))));
    semilla.on('error', reject);
  });

  // PORT=0 => el sistema asigna un puerto libre. Cada archivo de test corre en
  // su propio proceso, así que un puerto fijo los hacía chocar entre sí.
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: RAIZ,
    env: {
      ...process.env,
      DB_PATH: dbPath,
      PORT: '0',
      ADMIN_EMAIL: 'qa@raizandina.pe',
      ADMIN_PASSWORD: 'claveDePrueba2026',
      // Por defecto sin cuotas: las suites de CRUD hacen decenas de peticiones.
      // La de seguridad las activa para comprobar que el limite existe.
      SIN_LIMITES: limites ? '0' : '1',
      // El respaldo automatico tambien corre en los tests, pero dentro de la
      // carpeta desechable: asi se prueba el arranque sin dejar copias de
      // bases de prueba en data/respaldos.
      RESPALDO_DIR: join(carpeta, 'respaldos'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const errores = [];
  proc.stderr.on('data', (b) => errores.push(String(b)));

  const puerto = await new Promise((resolve, reject) => {
    let salida = '';
    const temporizador = setTimeout(
      () => reject(new Error('El servidor no anunció puerto.\n' + salida + errores.join(''))),
      20000);
    proc.stdout.on('data', (b) => {
      salida += b;
      const m = salida.match(/ESCUCHANDO (\d+)/);
      if (m) { clearTimeout(temporizador); resolve(Number(m[1])); }
    });
    proc.on('error', reject);
    proc.on('exit', (c) => reject(new Error(`El servidor murió (${c}).\n` + errores.join(''))));
  });

  const base = `http://127.0.0.1:${puerto}`;
  const limite = Date.now() + 10000;
  for (;;) {
    try {
      const r = await fetch(base + '/api/tienda', { signal: AbortSignal.timeout(600) });
      if (r.ok) break;
    } catch { /* todavía no responde */ }
    if (Date.now() > limite) {
      proc.kill();
      throw new Error('El servidor no respondió. stderr:\n' + errores.join(''));
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  return {
    base,
    errores,
    // La base desechable, para las pruebas que necesitan prepararla por
    // fuera de la API (llenar el espacio de codigos de pedido, por ejemplo).
    dbPath,
    async parar() {
      proc.kill();
      await new Promise((r) => setTimeout(r, 150));
      try { rmSync(carpeta, { recursive: true, force: true }); } catch { /* Windows lo suelta tarde */ }
    },
  };
}

/** fetch con JSON y cookies, que es lo que usan todos los tests. */
export function cliente(base) {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async pedir(ruta, opciones = {}) {
      const { cuerpo, metodo = 'GET', ...resto } = opciones;
      const r = await fetch(base + ruta, {
        method: metodo,
        headers: {
          ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(resto.headers || {}),
        },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
      const set = r.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const texto = await r.text();
      let json = null;
      try { json = JSON.parse(texto); } catch { /* html o vacío */ }
      return { estado: r.status, json, texto, cabeceras: r.headers };
    },
  };
}

/** Cliente completo segun el checkout peruano: documento y ubigeo reales. */
export const CLIENTE_VALIDO = {
  nombre: 'Rosa Huamán',
  telefono: '956231447',
  email: 'rosa@correo.com',
  direccion: 'Av. Canto Grande 1120',
  referencia: 'Frente al parque',
  tipo_doc: 'DNI',
  num_doc: '45678912',
  departamento: 'Lima',
  provincia: 'Lima',
  distrito: 'San Juan de Lurigancho',
};
