/**
 * La portada y la tienda, separadas.
 *
 * La portada cuenta quiénes son; /tienda es para comprar. Las dos cargan el
 * mismo app.js, que pinta cada pieza solo si su sitio existe en la página. Lo
 * que se prueba aquí es que esa división no se rompa en silencio: un id que se
 * cae de tienda.html no da error en ningún lado — el carrito simplemente deja
 * de abrirse, y eso lo descubre un cliente, no un test.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { levantarServidor } from './ayuda.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

let srv, portada, tienda;

before(async () => {
  srv = await levantarServidor();
  portada = await fetch(srv.base + '/');
  tienda = await fetch(srv.base + '/tienda');
  portada = { estado: portada.status, html: await portada.text() };
  tienda = { estado: tienda.status, html: await tienda.text() };
});

after(async () => { await srv?.parar(); });

const tieneId = (html, id) => new RegExp(`id="${id}"`).test(html);

describe('/tienda es la página para comprar', () => {
  test('se sirve en su dirección limpia, sin redirigir', () => {
    assert.equal(tienda.estado, 200);
    assert.match(tienda.html, /<link rel="canonical" href="[^"]*\/tienda">/);
  });

  /**
   * Los sitios que app.js busca para vender. Si falta uno, la función que lo
   * usa no se cablea y el botón queda muerto sin avisar.
   */
  const DE_LA_TIENDA = [
    'grilla', 'filtros', 'conteo-catalogo', 'buscar',
    'btn-carrito', 'cuenta-carrito', 'velo', 'panel-carrito',
    'cuerpo-carrito', 'pie-carrito', 'cerrar-carrito', 'toast',
    'forma-asesor', 'consulta', 'btn-asesor', 'respuesta-asesor',
    'burbuja', 'fichas-asesor', 'fuente-asesor',
  ];
  for (const id of DE_LA_TIENDA) {
    test(`tiene #${id}`, () => {
      assert.ok(tieneId(tienda.html, id), `a tienda.html le falta id="${id}"`);
    });
  }

  test('el asesor vive aquí, y antes que el catálogo', () => {
    const asesor = tienda.html.indexOf('id="asesor"');
    const catalogo = tienda.html.indexOf('id="catalogo"');
    assert.ok(asesor > 0 && catalogo > 0, 'faltan las anclas #asesor o #catalogo');
    assert.ok(asesor < catalogo, 'el asesor quedó debajo de cuatrocientas tarjetas');
  });

  test('carga el mismo script que la portada', () => {
    assert.match(tienda.html, /<script src="\/js\/app\.js"><\/script>/);
  });
});

describe('La portada cuenta y lleva a la tienda', () => {
  test('sigue siendo la raíz', () => {
    assert.equal(portada.estado, 200);
  });

  test('ya no trae ni catálogo, ni asesor, ni carrito', () => {
    for (const id of ['grilla', 'filtros', 'forma-asesor', 'panel-carrito']) {
      assert.ok(!tieneId(portada.html, id), `la portada todavía tiene id="${id}"`);
    }
  });

  test('conserva lo que es suyo: la historia', () => {
    for (const id of ['inicio', 'origenes', 'proceso', 'manifiesto']) {
      assert.ok(tieneId(portada.html, id), `a la portada le falta id="${id}"`);
    }
  });

  test('ningún enlace apunta a un ancla que se mudó', () => {
    // #catalogo y #asesor eran secciones de la portada. Un href="#catalogo"
    // que quedó aquí ahora no lleva a ningún lado.
    assert.doesNotMatch(portada.html, /href="#(catalogo|asesor)"/);
  });

  test('el llamado principal del hero lleva a la tienda', () => {
    assert.match(portada.html, /<a class="btn btn-primario" href="\/tienda" id="cta-magnetico">/);
  });

  test('la barra tiene una puerta a la tienda visible también en el celular', () => {
    // Los enlaces de la barra se esconden por debajo de 980 px: el botón de la
    // derecha es lo único que queda.
    assert.match(portada.html, /<a class="btn[^"]*" href="\/tienda" id="btn-tienda">/);
  });

  test('comprar es de la tienda: sin buscador, carrito ni «Mi pedido» en la portada', () => {
    for (const id of ['buscar', 'cuenta-carrito', 'btn-carrito']) {
      assert.ok(!tieneId(portada.html, id), `la portada todavía tiene id="${id}"`);
    }
    assert.doesNotMatch(portada.html, /href="\/mi-pedido\.html"/,
      'el seguimiento del pedido se enlaza desde la tienda');
    assert.match(tienda.html, /href="\/mi-pedido\.html"/, 'la tienda perdió «Mi pedido»');
  });

  test('informa: qué hay, cómo comprar, envíos, preguntas y dónde queda', () => {
    for (const id of ['categorias', 'lista-categorias', 'como-comprar', 'envios', 'zonas',
      'preguntas', 'visitanos', 'cierre-whatsapp']) {
      assert.ok(tieneId(portada.html, id), `a la portada le falta id="${id}"`);
    }
    const preguntas = (portada.html.match(/<details class="pregunta">/g) || []).length;
    assert.ok(preguntas >= 6, `solo ${preguntas} preguntas frecuentes`);
  });

  test('cada respuesta con cifras tiene dónde recibir el dato vigente', () => {
    for (const clave of ['medios', 'pagos', 'gratis', 'garantia', 'devolucion', 'provincias', 'mayor']) {
      assert.match(portada.html, new RegExp(`data-info="${clave}"`), `falta data-info="${clave}"`);
    }
  });

  test('las anclas a las que lleva existen en la tienda', () => {
    const destinos = [...portada.html.matchAll(/href="\/tienda#([\w-]+)"/g)].map((m) => m[1]);
    assert.ok(destinos.length >= 2, 'la portada no enlaza al asesor ni al catálogo');
    for (const ancla of new Set(destinos)) {
      assert.ok(tieneId(tienda.html, ancla), `la portada lleva a /tienda#${ancla}, que no existe`);
    }
  });
});

describe('La portada informa con las cifras de la configuración', () => {
  /**
   * Las tarifas de envío y la escala de descuentos ya se habían desincronizado
   * una vez entre la documentación y el panel. La portada no las escribe: las
   * pide aquí, así que lo que se prueba es que salgan iguales a tienda.config.
   */
  test('/api/tienda trae zonas, provincias y políticas tal cual la configuración', async () => {
    const { TIENDA } = await import('../tienda.config.js');
    const t = await (await fetch(srv.base + '/api/tienda')).json();

    assert.deepEqual(t.delivery.zonas.map((z) => [z.nombre, z.costo, z.horas]),
      TIENDA.delivery.zonas.map((z) => [z.nombre, z.costo, z.horas]));
    assert.equal(t.delivery.gratisDesde, TIENDA.delivery.gratisDesde);
    assert.deepEqual(t.politicas.escalones, TIENDA.politicas.regateo.escalones);
    assert.equal(t.politicas.devolucion.diasPlazo, TIENDA.politicas.devolucion.diasPlazo);
    if (TIENDA.delivery.provincias.habilitado) {
      assert.deepEqual(t.delivery.provincias.agencias, TIENDA.delivery.provincias.agencias);
    }
  });

  test('y no deja salir nada que no sea para el público', async () => {
    const t = await (await fetch(srv.base + '/api/tienda')).json();
    const texto = JSON.stringify(t);
    for (const secreto of ['ruc', 'razonSocial', 'costo_unit', 'ADMIN']) {
      assert.ok(!texto.includes(`"${secreto}"`), `/api/tienda expone «${secreto}»`);
    }
  });

  test('la tienda abre filtrada por la categoría que se eligió en la portada', () => {
    const js = readFileSync(join(RAIZ, 'public/js/app.js'), 'utf8');
    assert.match(js, /href="\/tienda\?cat=\$\{encodeURIComponent\(cat\)\}#catalogo"/);
    assert.match(js, /params\.get\('cat'\)/);
  });
});

describe('Lo que se imprime y lo que se indexa', () => {
  test('el sitemap anuncia la tienda', async () => {
    const r = await fetch(srv.base + '/sitemap.xml');
    assert.match(await r.text(), /<loc>[^<]*\/tienda<\/loc>/);
  });

  test('el QR del puesto apunta a la tienda, no a la portada', () => {
    const js = readFileSync(join(RAIZ, 'public/js/admin.js'), 'utf8');
    const qr = js.slice(js.indexOf('function imprimirQr'), js.indexOf('// ------', js.indexOf('function imprimirQr')));
    assert.match(qr, /const tienda = url \+ '\/tienda'/);
    assert.match(qr, /encodeURIComponent\(tienda\)/);
  });
});
