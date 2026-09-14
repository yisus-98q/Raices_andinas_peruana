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

describe('La portada informa y la tienda es una sección del menú', () => {
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

  /**
   * La portada es informativa: ningún botón empuja a comprar.
   *
   * A la tienda se llega por su ítem del menú (y, en el celular, por el mismo
   * enlace de texto), no por llamados repartidos en el hero, las categorías o
   * el cierre.
   */
  test('ningún botón ni enlace del contenido lleva a la tienda', () => {
    const aTienda = [...portada.html.matchAll(/<a\b[^>]*href="\/tienda[^"]*"[^>]*>/g)].map((m) => m[0]);
    assert.equal(aTienda.length, 2, `enlaces a la tienda: ${aTienda.join(' | ')}`);
    assert.ok(aTienda.some((a) => /id="nav-tienda"/.test(a)), 'falta la tienda en el menú');
    assert.ok(aTienda.some((a) => /class="nav-tienda-movil"/.test(a)), 'falta el enlace del celular');
    assert.ok(!aTienda.some((a) => /class="btn/.test(a)), 'hay un botón que empuja a la tienda');
  });

  test('el hero recorre la propia página', () => {
    assert.match(portada.html, /<a class="btn btn-primario" href="#origenes" id="cta-magnetico">/);
  });

  test('las categorías de la portada no son enlaces', () => {
    const js = readFileSync(join(RAIZ, 'public/js/app.js'), 'utf8');
    const fn = js.slice(js.indexOf('function pintarCategorias'), js.indexOf('const enLista'));
    assert.doesNotMatch(fn, /<a\b|href=/, 'las tarjetas de categoría llevan a otra página');
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

  test('la tienda sigue aceptando ?cat= para abrir filtrada', () => {
    // La portada ya no lo usa, pero es el enlace que se comparte por WhatsApp
    // («mira las hierbas»): /tienda?cat=Hierbas.
    const js = readFileSync(join(RAIZ, 'public/js/app.js'), 'utf8');
    assert.match(js, /params\.get\('cat'\)/);
  });
});

/**
 * El stock y los conteos son del panel, no del cliente.
 *
 * Cuántas unidades quedan o cuántos productos tiene la tienda es información
 * del negocio. Al cliente le basta saber si algo se puede pedir. Se prueba
 * contra lo que de verdad le llega: la API pública, el asesor y el código que
 * pinta las páginas.
 */
describe('El cliente no ve stock ni conteos', () => {
  test('/api/productos no manda stock ni mínimo, solo si está disponible', async () => {
    const lista = await (await fetch(srv.base + '/api/productos')).json();
    assert.ok(lista.length > 0);
    for (const p of lista.slice(0, 50)) {
      assert.equal(p.stock, undefined, `${p.sku} trae stock`);
      assert.equal(p.stock_min, undefined, `${p.sku} trae stock_min`);
      assert.ok(p.disponible === 0 || p.disponible === 1, `${p.sku} sin disponible`);
    }
  });

  test('el asesor no manda stock en sus fichas ni cuenta productos', async () => {
    for (const consulta of ['no puedo dormir', 'que productos tienen']) {
      const r = await fetch(srv.base + '/api/asesor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consulta }),
      });
      const d = await r.json();
      assert.ok(!JSON.stringify(d).includes('"stock"'), `«${consulta}» devolvió stock`);
      assert.doesNotMatch(d.mensaje, /\d+\s+productos/i, `«${consulta}» cuenta productos: ${d.mensaje}`);
    }
  });

  test('la tienda no pinta «Últimas N», «Quedan» ni conteos de productos', () => {
    const js = readFileSync(join(RAIZ, 'public/js/app.js'), 'utf8');
    assert.doesNotMatch(js, /Últimas ['$]|'Quedan '|Solo quedan|disponibles hoy/,
      'app.js todavía muestra cantidades de stock');
    assert.doesNotMatch(js, /\$\{catalogo\.length\} productos|de \$\{lista\.length\} productos/,
      'app.js todavía cuenta productos para el cliente');
    assert.doesNotMatch(js, /\.stock\b/, 'app.js todavía lee p.stock');
  });

  test('la portada no cuenta productos', () => {
    assert.doesNotMatch(portada.html, /data-contar="\d+" id="dato-productos"|productos con origen trazado/i);
    assert.ok(!tieneId(portada.html, 'categorias-datos'), 'siguen las cifras bajo las categorías');
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
