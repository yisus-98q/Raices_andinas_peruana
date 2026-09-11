/**
 * Alta de productos desde el panel.
 *
 * Lo que se prueba no es "el formulario manda datos": es que la base no
 * acepte una ficha que despues genere una perdida — precio en cero, costo por
 * encima del precio, un nombre repetido que confunda al que despacha, o stock
 * inicial que aparezca sin quedar en el kardex.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, cliente } from './ayuda.mjs';

let srv, admin;
before(async () => {
  srv = await levantarServidor();
  admin = cliente(srv.base);
  await admin.pedir('/api/login', {
    metodo: 'POST', cuerpo: { correo: 'qa@raizandina.pe', clave: 'claveDePrueba2026' },
  });
});
after(async () => { await srv?.parar(); });

let n = 0;
const FICHA = () => ({
  nombre: `Producto de prueba ${++n}`,
  categoria: 'Hierbas',
  presentacion: 'Bolsa 100 g',
  precio: 20,
  costo: 8,
  stock: 12,
  stock_min: 4,
  beneficios: 'Sirve para probar el alta',
  etiquetas: 'prueba, digestión, NERVIOS',
});

const alta = (extra = {}) =>
  admin.pedir('/api/productos', { metodo: 'POST', cuerpo: { ...FICHA(), ...extra } });

describe('Alta de producto', () => {
  test('crea la ficha y devuelve el producto guardado', async () => {
    const r = await alta({ nombre: 'Hierba de prueba básica' });
    assert.equal(r.estado, 201, r.json?.error);
    assert.equal(r.json.producto.nombre, 'Hierba de prueba básica');
    assert.equal(r.json.producto.precio, 20);
    assert.equal(r.json.producto.activo, 1);
  });

  test('aparece en la tienda enseguida', async () => {
    const r = await alta({ nombre: 'Hierba visible en tienda' });
    const publico = (await cliente(srv.base).pedir('/api/productos')).json;
    assert.ok(publico.some((p) => p.id === r.json.producto.id), 'no salió en la tienda');
  });

  test('el código se genera solo, con la sigla de la categoría', async () => {
    const r = await alta({ categoria: 'Tónicos' });
    assert.match(r.json.producto.sku, /^TON-\d{3}$/);
  });

  test('dos altas seguidas no repiten el código', async () => {
    const a = await alta({ categoria: 'Cremas' });
    const b = await alta({ categoria: 'Cremas' });
    assert.notEqual(a.json.producto.sku, b.json.producto.sku);
  });

  test('una categoría nueva también obtiene sigla', async () => {
    const r = await alta({ categoria: 'Mascotas' });
    assert.match(r.json.producto.sku, /^MAS-\d{3}$/);
  });

  test('sin foto, queda con la ilustración que le toca', async () => {
    const r = await alta({ presentacion: '60 cápsulas 500 mg', categoria: 'Suplementos' });
    assert.equal(r.json.producto.imagen, '/img/gen/capsulas-verde.svg');
  });

  test('el stock inicial queda registrado en el kardex', async () => {
    const r = await alta({ stock: 25 });
    const movs = (await admin.pedir('/api/admin/movimientos')).json;
    const mio = movs.find((m) => m.producto_id === r.json.producto.id);
    assert.ok(mio, 'el stock apareció sin movimiento que lo explique');
    assert.equal(mio.cantidad, 25);
    assert.equal(mio.stock_final, 25);
  });

  test('el alta queda en la bitácora con el usuario que la hizo', async () => {
    const r = await alta({ nombre: 'Hierba con bitácora' });
    const cambios = (await admin.pedir('/api/admin/cambios')).json;
    const mio = cambios.find((c) => c.producto_id === r.json.producto.id);
    assert.ok(mio, 'no quedó registro de quién dio de alta el producto');
    assert.equal(mio.campo, 'alta');
    assert.ok(mio.usuario, 'no consta el usuario');
  });

  test('las etiquetas se guardan normalizadas para el asesor', async () => {
    const r = await alta({ etiquetas: 'Dolor de Cabeza, MIGRAÑA ,  cefalea' });
    assert.equal(r.json.producto.etiquetas, 'dolor de cabeza,migrana,cefalea');
  });
});

describe('Lo que el alta no debe dejar pasar', () => {
  const rechaza = async (extra, campo) => {
    const r = await alta(extra);
    assert.equal(r.estado, 400, `aceptó ${JSON.stringify(extra)}`);
    if (campo) assert.equal(r.json.campo, campo);
    return r;
  };

  test('sin nombre, sin categoría o sin presentación', async () => {
    await rechaza({ nombre: '  ' }, 'nombre');
    await rechaza({ categoria: '' }, 'categoria');
    await rechaza({ presentacion: '' }, 'presentacion');
  });

  test('precio cero, negativo o que no es número', async () => {
    for (const precio of [0, -5, 'gratis', null]) await rechaza({ precio }, 'precio');
  });

  test('costo mayor que el precio: sería vender a pérdida', async () => {
    const r = await rechaza({ precio: 10, costo: 15 }, 'costo');
    assert.match(r.json.error, /pérdida/i);
  });

  test('stock con decimales o negativo', async () => {
    await rechaza({ stock: 2.5 }, 'stock');
    await rechaza({ stock: -1 }, 'stock');
    await rechaza({ stock_min: -3 }, 'stock_min');
  });

  test('nombre repetido', async () => {
    await alta({ nombre: 'Producto único de la casa' });
    const r = await admin.pedir('/api/productos', {
      metodo: 'POST',
      cuerpo: { ...FICHA(), nombre: 'producto ÚNICO de la casa' },
    });
    assert.equal(r.estado, 400, 'dejó duplicar el nombre');
    assert.equal(r.json.campo, 'nombre');
  });

  test('imagen con esquema peligroso', async () => {
    for (const imagen of ['javascript:alert(1)', 'http://sitio.pe/f.jpg', '../../etc/passwd']) {
      await rechaza({ imagen }, 'imagen');
    }
  });

  test('un producto no se crea sin haber iniciado sesión', async () => {
    const anon = cliente(srv.base);
    const r = await anon.pedir('/api/productos', { metodo: 'POST', cuerpo: FICHA() });
    assert.equal(r.estado, 401);
  });

  test('el precio no se puede mandar como texto con formato', async () => {
    await rechaza({ precio: 'S/ 20.00' }, 'precio');
  });
});

describe('Ficha nueva y asesor', () => {
  test('un producto recién dado de alta ya sirve para emparejar síntomas', async () => {
    await alta({
      nombre: 'Hierba del dolor de cabeza',
      beneficios: 'Alivia el dolor de cabeza',
      etiquetas: 'dolor de cabeza, cefalea, migraña',
      stock: 30,
    });
    const r = await cliente(srv.base).pedir('/api/asesor', {
      metodo: 'POST', cuerpo: { consulta: 'me duele la cabeza, qué me recomiendas' },
    });
    assert.equal(r.estado, 200);
    assert.ok(r.json.recomendaciones.length, 'no recomendó nada para el dolor de cabeza');
  });
});

describe('Categorías nuevas', () => {
  test('se puede crear un tipo de producto que no existía', async () => {
    const r = await alta({ categoria: 'Mascotas', presentacion: 'Bolsa 500 g' });
    assert.equal(r.estado, 201, r.json?.error);
    assert.equal(r.json.producto.categoria, 'Mascotas');

    const cats = (await admin.pedir('/api/admin/categorias')).json;
    assert.ok(cats.some((c) => c.categoria === 'Mascotas'), 'no quedó en la lista');
  });

  test('la categoría nueva sale en la tienda como filtro propio', async () => {
    await alta({ categoria: 'Bebidas', presentacion: 'Botella 500 ml' });
    const publico = (await cliente(srv.base).pedir('/api/productos')).json;
    assert.ok(publico.some((p) => p.categoria === 'Bebidas'));
  });

  test('la categoría nueva tiene ilustración, no el marcador genérico', async () => {
    const r = await alta({ categoria: 'Velas aromáticas', presentacion: 'Barra 100 g' });
    const img = r.json.producto.imagen;
    assert.match(img, /^\/img\/gen\/.+\.svg$/);

    const archivo = await cliente(srv.base).pedir(img);
    assert.equal(archivo.estado, 200, `la lámina ${img} no existe`);
    assert.ok(archivo.texto.includes('<svg'), 'no devolvió un SVG');
  });

  test('dos categorías nuevas distintas no salen del mismo color', async () => {
    const a = await alta({ categoria: 'Mermeladas', presentacion: 'Frasco 500 g' });
    const b = await alta({ categoria: 'Utensilios', presentacion: 'Frasco 500 g' });
    assert.notEqual(a.json.producto.imagen, b.json.producto.imagen,
      'toda categoría nueva se ve igual');
  });

  test('escribir la categoría en minúscula no crea una duplicada', async () => {
    const r = await alta({ categoria: 'hierbas' });
    assert.equal(r.json.producto.categoria, 'Hierbas', 'partió el catálogo en dos');
  });

  test('una categoría nueva se guarda con mayúscula inicial', async () => {
    const r = await alta({ categoria: 'sales minerales', presentacion: 'Frasco 500 g' });
    assert.equal(r.json.producto.categoria, 'Sales minerales');
  });

  test('el mismo tipo escrito con tilde o sin ella es el mismo', async () => {
    const a = await alta({ categoria: 'Cañazo', presentacion: 'Botella 500 ml' });
    const b = await alta({ categoria: 'canazo', presentacion: 'Botella 1 L' });
    assert.equal(b.json.producto.categoria, a.json.producto.categoria);
  });
});
