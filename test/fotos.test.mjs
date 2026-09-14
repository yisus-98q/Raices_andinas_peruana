/**
 * Subir la foto de un producto.
 *
 * Recibir archivos es de las pocas cosas que, mal hechas, comprometen la
 * máquina entera: se escribe fuera de la carpeta, se sube un ejecutable con
 * nombre de imagen, o se llena el disco. Así que lo que se prueba aquí no es
 * que la foto llegue —eso es lo fácil— sino todo lo que tiene que rebotar.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { levantarServidor, cliente } from './ayuda.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const FOTOS = join(RAIZ, 'public', 'img', 'fotos');

let srv, duena, mostrador;

/**
 * Lo que este archivo sube, para borrarlo al terminar.
 *
 * El servidor escribe de verdad en public/img/fotos, que es la carpeta de las
 * fotos del negocio. Sin limpiar, cada corrida dejaba seis archivos de 70 bytes
 * mezclados con las fotos reales, y git los ofrecía para versionar.
 */
const subidas = [];
const anotar = (json) => { if (json?.ruta) subidas.push(json.ruta); return json; };

/** Un JPEG mínimo pero válido: lo que importa son sus tres primeros bytes. */
const JPG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('JFIF\0'),
  Buffer.alloc(64, 0x20),
]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0x20),
]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBP'),
  Buffer.alloc(64, 0x20),
]);

/** Sube bytes crudos, como hace el navegador con el archivo elegido. */
async function subir(quien, bytes, tipo = 'image/jpeg') {
  const r = await fetch(srv.base + '/api/fotos', {
    method: 'POST',
    headers: { 'Content-Type': tipo, Cookie: quien.cookie },
    body: bytes,
  });
  let json = null;
  try { json = anotar(JSON.parse(await r.text())); } catch { /* vacío */ }
  return { estado: r.status, json };
}

before(async () => {
  srv = await levantarServidor();

  duena = cliente(srv.base);
  await duena.pedir('/api/login', {
    metodo: 'POST', cuerpo: { correo: 'qa@raizandina.pe', clave: 'claveDePrueba2026' },
  });

  const alta = spawnSync(process.execPath, [
    'clave.mjs', '--nuevo', 'caja', 'caja@raizandina.pe', 'La caja', 'claveDeLaCaja1', 'vendedor',
  ], { cwd: RAIZ, env: { ...process.env, DB_PATH: srv.dbPath }, encoding: 'utf8' });
  assert.equal(alta.status, 0, alta.stdout + alta.stderr);

  mostrador = cliente(srv.base);
  await mostrador.pedir('/api/login', {
    metodo: 'POST', cuerpo: { correo: 'caja@raizandina.pe', clave: 'claveDeLaCaja1' },
  });
});

after(async () => {
  await srv?.parar();
  for (const ruta of subidas) {
    rmSync(join(RAIZ, 'public', ruta), { force: true });
  }
});

describe('La dueña sube la foto y queda servida', () => {
  for (const [nombre, bytes, ext] of [['JPG', JPG, 'jpg'], ['PNG', PNG, 'png'], ['WEBP', WEBP, 'webp']]) {
    test(`acepta ${nombre} y la deja donde la tienda puede leerla`, async () => {
      const r = await subir(duena, bytes);
      assert.equal(r.estado, 201, JSON.stringify(r.json));
      assert.match(r.json.ruta, new RegExp(`^/img/fotos/[\\w.-]+\\.${ext}$`));

      // Y se sirve de verdad: una ruta guardada que da 404 es peor que no tener
      // foto, porque la ficha queda rota sin decir por qué.
      const web = await fetch(srv.base + r.json.ruta);
      assert.equal(web.status, 200);
      assert.equal(Number(web.headers.get('content-length')), bytes.length);
    });
  }

  test('dos fotos seguidas no se pisan', async () => {
    const a = await subir(duena, JPG);
    const b = await subir(duena, JPG);
    assert.notEqual(a.json.ruta, b.json.ruta, 'la segunda sobrescribió a la primera');
  });
});

describe('Lo que tiene que rebotar', () => {
  /**
   * El tipo se decide por los BYTES, no por el nombre ni por el
   * `Content-Type`: los dos los escribe quien sube el archivo.
   */
  test('un ejecutable disfrazado de JPEG se rechaza', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0)]);
    const r = await subir(duena, exe, 'image/jpeg');
    assert.equal(r.estado, 400, 'aceptó un binario que no es imagen');
    assert.match(r.json.error, /no es una foto/i);
  });

  test('un SVG se rechaza aunque sea una imagen', async () => {
    // Un SVG es un documento, y puede traer scripts dentro. Servido desde el
    // mismo origen que el panel, eso es ejecución en la sesión de la dueña.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const r = await subir(duena, svg, 'image/svg+xml');
    assert.equal(r.estado, 400, 'aceptó un SVG');
  });

  test('un archivo vacío se rechaza', async () => {
    const r = await subir(duena, Buffer.alloc(0));
    assert.equal(r.estado, 400);
  });

  test('más de 4 MB se corta', async () => {
    const gordo = Buffer.concat([JPG, Buffer.alloc(5 * 1024 * 1024, 0x20)]);
    const r = await subir(duena, gordo);
    assert.equal(r.estado, 413, JSON.stringify(r.json));
  });

  /**
   * El nombre lo pone el servidor y nunca se deriva del que manda el cliente:
   * es la vía clásica para escribir fuera de la carpeta.
   */
  test('el nombre del archivo lo decide el servidor', async () => {
    const antes = readdirSync(FOTOS).length;
    const r = await fetch(srv.base + '/api/fotos', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        Cookie: duena.cookie,
        // Aunque el cliente sugiera un nombre con salto de carpeta.
        'Content-Disposition': 'attachment; filename="../../../server.js"',
        'X-Filename': '../../../.env',
      },
      body: JPG,
    });
    const d = anotar(await r.json());
    assert.equal(r.status, 201, JSON.stringify(d));
    assert.ok(!d.ruta.includes('..'), 'la ruta devuelta trae saltos de carpeta');
    assert.match(d.ruta, /^\/img\/fotos\/[\w.-]+$/);
    assert.equal(readdirSync(FOTOS).length, antes + 1, 'escribió fuera de public/img/fotos');
  });
});

describe('Subir fotos es de la dueña', () => {
  test('el mostrador no puede', async () => {
    const r = await subir(mostrador, JPG);
    assert.equal(r.estado, 403, JSON.stringify(r.json));
  });

  test('sin sesión tampoco', async () => {
    const r = await fetch(srv.base + '/api/fotos', {
      method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: JPG,
    });
    assert.equal(r.status, 401);
  });
});
