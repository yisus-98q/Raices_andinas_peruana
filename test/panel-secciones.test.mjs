/**
 * El menu de secciones y las secciones de verdad.
 *
 * Lo que se prueba es que no se desincronicen. Un menu es un indice escrito a
 * mano en otro archivo: el dia que alguien agregue un bloque al panel o le
 * cambie el id, el menu se queda apuntando al vacio y **no falla nada** — el
 * clic simplemente no hace nada, que es el peor tipo de defecto porque nadie
 * lo reporta, solo deja de usar el menu.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(RAIZ, 'public/admin.html'), 'utf8');
const js = readFileSync(join(RAIZ, 'public/js/admin.js'), 'utf8');

/** Los `id` de los <section class="bloque"> del panel, en orden. */
const seccionesDelHtml = [...html.matchAll(/<section class="bloque"([^>]*)>/g)]
  .map((m) => (m[1].match(/id="([^"]+)"/) || [])[1]);

/** Los ids que el menu ofrece, sacados del bloque SECCIONES de admin.js. */
const bloqueSecciones = js.slice(js.indexOf('const SECCIONES = ['),
  js.indexOf('];', js.indexOf('const SECCIONES = [')));
const seccionesDelMenu = [...bloqueSecciones.matchAll(/id: '([^']+)'/g)].map((m) => m[1]);

describe('Menu de secciones del panel', () => {
  test('el menu no esta vacio', () => {
    assert.ok(seccionesDelMenu.length >= 8,
      `solo encontre ${seccionesDelMenu.length} entradas en SECCIONES`);
  });

  test('cada bloque del panel tiene id, para poder llegar a el', () => {
    const sinId = seccionesDelHtml.filter((id) => !id).length;
    assert.equal(sinId, 0,
      `${sinId} bloque(s) sin id: el menu no puede ofrecerlos`);
  });

  test('cada entrada del menu apunta a un bloque que existe', () => {
    for (const id of seccionesDelMenu) {
      assert.ok(seccionesDelHtml.includes(id),
        `el menu ofrece «${id}» y ese bloque no esta en admin.html`);
    }
  });

  test('ningun bloque se queda fuera del menu', () => {
    for (const id of seccionesDelHtml) {
      assert.ok(seccionesDelMenu.includes(id),
        `el bloque «${id}» existe y el menu no lo ofrece`);
    }
  });

  test('cada entrada dice para que sirve la seccion', () => {
    // El nombre solo no basta: quien atiende tres veces por semana no tiene
    // por que saber que «Movimientos» es el kardex.
    const haces = [...bloqueSecciones.matchAll(/hace: '([^']+)'/g)].map((m) => m[1]);
    assert.equal(haces.length, seccionesDelMenu.length,
      'a alguna seccion le falta la linea de que hace');
    for (const h of haces) {
      assert.ok(h.length > 20, `«${h}» no explica nada`);
      assert.match(h, /[.]$/, `«${h}» deberia terminar en punto`);
    }
  });

  test('el menu solo ofrece al mostrador lo que puede ver', () => {
    // Respaldo y bitacora de fichas son del dueño: el servidor responde 403.
    for (const id of ['bloque-respaldo', 'bloque-cambios']) {
      const i = bloqueSecciones.indexOf(`id: '${id}'`);
      assert.notEqual(i, -1, `falta ${id} en SECCIONES`);
      const entrada = bloqueSecciones.slice(i, bloqueSecciones.indexOf('{', i + 1));
      assert.match(entrada, /soloDueno: true/,
        `${id} tiene que estar marcado soloDueno`);
    }
  });

  test('la cabecera tiene el boton y el panel del menu', () => {
    assert.match(html, /id="menu-boton"/);
    assert.match(html, /id="menu-secciones"/);
    // Accesible: el boton dice si esta abierto y que controla.
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /aria-controls="menu-secciones"/);
  });
});
