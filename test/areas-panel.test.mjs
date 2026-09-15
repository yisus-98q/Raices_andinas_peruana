/**
 * Las áreas del panel.
 *
 * El panel muestra un área por vez, así que un bloque que no esté asignado a
 * ninguna queda invisible para siempre: existe en el HTML y no hay forma de
 * llegar a él. Es el fallo más fácil de introducir al agregar una sección y el
 * más difícil de notar, porque nada se rompe.
 *
 * Estas pruebas reemplazan a las del antiguo menú de hamburguesa. Ese menú
 * existía para saltar entre diez bloques apilados; con el panel repartido en
 * áreas que caben enteras en la pantalla no hay a qué saltar, y la navegación
 * pasó a ser la barra lateral. Lo que sí se conserva de aquellas pruebas es lo
 * que seguía importando: que todo bloque sea alcanzable y que cada entrada de
 * la navegación diga para qué sirve.
 *
 * Se lee el código fuente en vez de levantar un navegador: lo que se comprueba
 * es que las dos listas —la del HTML y la de `AREAS`— sigan diciendo lo mismo.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(RAIZ, 'public', 'admin.html'), 'utf8');
const js = readFileSync(join(RAIZ, 'public', 'js', 'admin.js'), 'utf8');
const css = readFileSync(join(RAIZ, 'public', 'css', 'panel.css'), 'utf8');

/** Los bloques que hay de verdad en el panel. */
const bloquesDelHtml = [...html.matchAll(/<section class="bloque"[^>]*id="([^"]+)"/g)]
  .map((m) => m[1]);

/** Las áreas que declara el HTML. */
const areasDelHtml = [...html.matchAll(/<div class="area[^"]*" id="([^"]+)"/g)].map((m) => m[1]);

/** El bloque `AREAS` de admin.js, tal como lo lee el navegador. */
const fuenteAreas = js.slice(js.indexOf('const AREAS = ['),
  js.indexOf('];', js.indexOf('const AREAS = [')));
const areasDelJs = [...fuenteAreas.matchAll(/id: '(area-[^']+)'/g)].map((m) => m[1]);
const bloquesDelJs = [...fuenteAreas.matchAll(/'(bloque-[^']+)'/g)].map((m) => m[1]);

describe('Cada bloque vive en un área', () => {
  test('el panel tiene sus cinco áreas', () => {
    assert.deepEqual(areasDelHtml,
      ['area-resumen', 'area-vender', 'area-inventario', 'area-negocio', 'area-equipo']);
    assert.deepEqual(areasDelJs, areasDelHtml,
      'las áreas del HTML y las de AREAS no coinciden');
  });

  test('ningún bloque se queda sin área', () => {
    const huerfanos = bloquesDelHtml.filter((b) => !bloquesDelJs.includes(b));
    assert.deepEqual(huerfanos, [],
      `estos bloques existen pero no están en ninguna área, así que no hay forma de verlos: ${huerfanos.join(', ')}`);
  });

  test('ningún área apunta a un bloque que no existe', () => {
    const fantasmas = bloquesDelJs.filter((b) => !bloquesDelHtml.includes(b));
    assert.deepEqual(fantasmas, [], `AREAS nombra bloques inexistentes: ${fantasmas.join(', ')}`);
  });

  test('ningún bloque está en dos áreas a la vez', () => {
    const vistos = new Set();
    const repetidos = bloquesDelJs.filter((b) => (vistos.has(b) ? true : (vistos.add(b), false)));
    assert.deepEqual(repetidos, [], `repetidos: ${repetidos.join(', ')}`);
  });

  test('cada bloque tiene id: sin él no se lo puede mostrar ni esconder', () => {
    const todas = [...html.matchAll(/<section class="bloque"([^>]*)>/g)].map((m) => m[1]);
    const sinId = todas.filter((a) => !/id="/.test(a)).length;
    assert.equal(sinId, 0, `${sinId} bloque(s) sin id`);
  });

  test('solo la primera área nace visible', () => {
    // Las otras llevan `hidden` en el HTML: sin eso, el panel aparece con los
    // doce bloques encima hasta que el JavaScript termina de cargar.
    const conHidden = [...html.matchAll(/<div class="area[^"]*" id="([^"]+)"([^>]*)>/g)]
      .map(([, , resto]) => resto.includes('hidden'));
    assert.deepEqual(conHidden, [false, true, true, true, true]);
  });
});

describe('La barra lateral es la navegación', () => {
  test('el resumen es la principal y va primera', () => {
    assert.equal(areasDelJs[0], 'area-resumen');
    assert.match(js, /let areaActiva = 'area-resumen'/,
      'el panel tiene que abrir en el resumen');
  });

  test('cada área dice para qué sirve', () => {
    const haces = [...fuenteAreas.matchAll(/hace: '([^']+)'/g)].map((m) => m[1]);
    assert.equal(haces.length, areasDelJs.length,
      'a alguna área le falta la línea de qué tiene dentro');
    for (const h of haces) assert.ok(h.length > 8, `«${h}» no explica nada`);
  });

  test('el resumen del día es solo de la dueña', () => {
    // Caja del día, ganancia y valor del inventario: las tres cifras que
    // resumen el negocio. La vendedora no las tiene en su lista de bloques.
    const tabla = js.slice(js.indexOf('const BLOQUES_POR_ROL = {'),
      js.indexOf('};', js.indexOf('const BLOQUES_POR_ROL = {')));
    const vendedor = tabla.slice(tabla.indexOf('vendedor:'), tabla.indexOf(']', tabla.indexOf('vendedor:')));
    assert.ok(!vendedor.includes('bloque-resumen'),
      'la vendedora no debería ver el resumen del negocio');
    const reparto = tabla.slice(tabla.indexOf('reparto:'), tabla.indexOf(']', tabla.indexOf('reparto:')));
    assert.ok(!reparto.includes('bloque-resumen'));
  });

  test('ya no queda nada del menú de hamburguesa', () => {
    // Se quitó porque duplicaba la barra lateral. Si vuelve a aparecer una
    // referencia suelta, es que quedó código a medio borrar.
    for (const [donde, texto] of [['admin.html', html], ['admin.js', js], ['panel.css', css]]) {
      for (const resto of ['menu-boton', 'menu-secciones', 'menu-envoltura', 'menu-item']) {
        assert.ok(!texto.includes(resto), `${donde} todavía menciona «${resto}»`);
      }
    }
  });

  test('en el celular la barra se acuesta en vez de desaparecer', () => {
    // Si se escondiera sin más, en un teléfono no habría forma de cambiar de
    // sección: la hamburguesa que hacía ese papel ya no está.
    const bloquesMovil = [];
    const marca = '@media (max-width: 640px)';
    for (let i = css.indexOf(marca); i !== -1; i = css.indexOf(marca, i + 1)) {
      let prof = 0;
      let j = css.indexOf('{', i);
      const inicio = j;
      for (; j < css.length; j++) {
        if (css[j] === '{') prof++;
        else if (css[j] === '}' && --prof === 0) break;
      }
      bloquesMovil.push(css.slice(inicio, j));
    }
    assert.ok(bloquesMovil.length, 'no hay ningún bloque para móvil en panel.css');

    const conAreas = bloquesMovil.filter((b) => /\.areas\s*\{/.test(b));
    assert.ok(conAreas.length, 'la barra no tiene ajuste para el celular');
    assert.ok(!conAreas.some((b) => /\.areas\s*\{[^}]*display:\s*none/.test(b)),
      'la barra se esconde en el celular y ahí no quedaría ninguna navegación');
    assert.ok(conAreas.some((b) => /\.areas\s*\{[^}]*overflow-x:\s*auto/.test(b)),
      'en el celular la barra tiene que poder arrastrarse de lado');
  });
});
