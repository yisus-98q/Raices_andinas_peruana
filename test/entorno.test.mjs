/**
 * El .env y la clave del primer acceso.
 *
 * Dos cosas que antes no pasaban: que copiar .env.example a .env sirviera de
 * algo, y que una instalación nueva no quedara con la misma clave de fábrica
 * que figuraba en el README.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Corre un trozo de código en un proceso aparte, con el entorno que se pida. */
function correr(codigo, env) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', codigo],
    { cwd: RAIZ, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

describe('entorno.js lee el .env', () => {
  test('carga lo que no está definido y no pisa lo que ya viene del entorno', () => {
    const carpeta = mkdtempSync(join(tmpdir(), 'ra-env-'));
    const archivo = join(carpeta, '.env');
    writeFileSync(archivo, 'RA_PRUEBA_NUEVA=desde-archivo\nRA_PRUEBA_FIJA=desde-archivo\n');
    try {
      const env = { ...process.env, RA_ENV_FILE: archivo, RA_PRUEBA_FIJA: 'desde-consola' };
      delete env.RA_PRUEBA_NUEVA;
      const leido = correr(`await import('./entorno.js');
        console.log(JSON.stringify({ nueva: process.env.RA_PRUEBA_NUEVA, fija: process.env.RA_PRUEBA_FIJA }));`, env);
      assert.equal(leido.nueva, 'desde-archivo', 'no cargó la variable del .env');
      assert.equal(leido.fija, 'desde-consola', 'el .env pisó lo que ya venía del entorno');
    } finally {
      rmSync(carpeta, { recursive: true, force: true });
    }
  });
});

describe('La clave del primer acceso', () => {
  /** Arranca un servidor con base vacía y devuelve lo que imprime al iniciar. */
  async function primerArranque(extra) {
    const carpeta = mkdtempSync(join(tmpdir(), 'ra-clave-'));
    const env = { ...process.env, DB_PATH: join(carpeta, 'c.db'), PORT: '0', HOST: '127.0.0.1',
      SIN_LIMITES: '1', RESPALDO_DIR: join(carpeta, 'resp'), ...extra };
    if (!('ADMIN_PASSWORD' in extra)) delete env.ADMIN_PASSWORD;
    const proc = spawn(process.execPath, ['server.js'], { cwd: RAIZ, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let salida = '';
    await new Promise((ok, mal) => {
      const t = setTimeout(() => mal(new Error('no arrancó:\n' + salida)), 20000);
      proc.stdout.on('data', (b) => {
        salida += b;
        // El aviso de clave generada sale en líneas posteriores, y pueden
        // llegar en otro trozo: se espera a la última línea del arranque.
        if (/contrasena:\s+\S+[\s\S]*(node clave\.mjs|\n\s*\n)|contrasena:\s+\S+\s*$/.test(salida)) {
          clearTimeout(t); setTimeout(ok, 400);
        }
      });
    });
    const puerto = Number(salida.match(/ESCUCHANDO (\d+)/)[1]);
    const clave = salida.match(/contrasena:\s+(\S+)/)[1];
    return { proc, carpeta, salida, clave, base: `http://127.0.0.1:${puerto}` };
  }

  const cerrar = async ({ proc, carpeta }) => {
    proc.kill();
    await new Promise((r) => setTimeout(r, 200));
    try { rmSync(carpeta, { recursive: true, force: true }); } catch { /* Windows */ }
  };

  const entra = async (base, correo, clave) => (await fetch(base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo, clave }),
  })).status;

  for (const [caso, extra] of [
    ['sin ADMIN_PASSWORD', { ADMIN_EMAIL: 'duena@raizandina.pe' }],
    ['con la clave de ejemplo', { ADMIN_EMAIL: 'duena@raizandina.pe', ADMIN_PASSWORD: 'cambia-esta-clave' }],
  ]) {
    test(`${caso}: genera una clave al azar, la muestra y sirve para entrar`, async () => {
      const s = await primerArranque(extra);
      try {
        assert.notEqual(s.clave, 'raiz2026', 'volvió la clave de fábrica');
        assert.notEqual(s.clave, 'cambia-esta-clave', 'dejó la clave de ejemplo');
        assert.ok(s.clave.length >= 12, `clave corta: ${s.clave}`);
        assert.match(s.salida, /se genero al azar/);
        assert.equal(await entra(s.base, 'duena@raizandina.pe', s.clave), 200, 'la clave impresa no entra');
        assert.notEqual(await entra(s.base, 'duena@raizandina.pe', 'raiz2026'), 200, 'raiz2026 todavía entra');
      } finally {
        await cerrar(s);
      }
    });
  }

  test('con ADMIN_PASSWORD propia usa esa y no avisa de clave generada', async () => {
    const s = await primerArranque({ ADMIN_EMAIL: 'duena@raizandina.pe', ADMIN_PASSWORD: 'unaClavePropia2026' });
    try {
      assert.equal(s.clave, 'unaClavePropia2026');
      assert.doesNotMatch(s.salida, /se genero al azar/);
      assert.equal(await entra(s.base, 'duena@raizandina.pe', 'unaClavePropia2026'), 200);
    } finally {
      await cerrar(s);
    }
  });
});
