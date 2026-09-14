/**
 * Venta por peso.
 *
 * Lo que más vende una tienda naturista son hierbas sueltas por peso, y eso no
 * entra en una ficha de una sola presentación con stock en unidades enteras: se
 * pide «100 g», «un cuarto» o «para el mes».
 *
 * El modelo es: el precio de ficha va POR 100 g —que es como se cotiza en el
 * mostrador— y todo lo demás cuenta gramos. La conversión ocurre una sola vez,
 * al vender, y se congela en la línea del pedido; así el comprobante, el kardex
 * y los totales siguen haciendo `precio × cantidad` sin saber nada de granel.
 *
 * Lo que se prueba aquí es esa aritmética al céntimo y que el stock se descuente
 * en gramos. Un redondeo mal puesto en el precio por gramo no se nota en una
 * venta y sí en el corte del mes.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { levantarServidor, cliente, CLIENTE_VALIDO } from './ayuda.mjs';

let srv, duena, granel;

/** Cien gramos de muña a S/ 9.40 es exactamente el caso del mostrador. */
const PRECIO_100G = 9.4;
const STOCK_G = 5000;

before(async () => {
  srv = await levantarServidor();
  duena = cliente(srv.base);
  await duena.pedir('/api/login', {
    metodo: 'POST', cuerpo: { correo: 'qa@raizandina.pe', clave: 'claveDePrueba2026' },
  });

  const cat = (await duena.pedir('/api/admin/productos')).json;
  const elegido = cat.find((p) => p.activo === 1 && p.stock > 0);

  // Se pasa a granel por la API, que es como lo haría la dueña desde el panel.
  const r = await duena.pedir('/api/productos/' + elegido.id, {
    metodo: 'PATCH',
    cuerpo: {
      unidad: 'gramo',
      presentaciones: '50,100,250,500,1000',
      precio: PRECIO_100G,
      costo: 3,
    },
  });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  assert.equal(r.json.producto.unidad, 'gramo');

  // El stock se mueve por ingreso, nunca a dedo: es lo que hace que el kardex
  // explique cada gramo.
  const ing = await duena.pedir('/api/stock', {
    metodo: 'POST',
    cuerpo: {
      producto_id: elegido.id,
      cantidad: STOCK_G - elegido.stock,
      motivo: 'Llegó la bolsa de origen',
    },
  });
  assert.equal(ing.estado, 200, JSON.stringify(ing.json));

  granel = (await duena.pedir('/api/admin/productos')).json.find((p) => p.id === elegido.id);
  assert.equal(granel.stock, STOCK_G, 'el stock tiene que quedar en gramos');
});

after(async () => { await srv?.parar(); });

const comprar = (gramos) => cliente(srv.base).pedir('/api/pedidos', {
  metodo: 'POST',
  cuerpo: {
    cliente: CLIENTE_VALIDO,
    items: [{ id: granel.id, cantidad: gramos }],
    entrega: 'recojo',   // sin flete: así el total es solo la mercadería
  },
});

describe('La tienda cobra el peso, no la unidad', () => {
  test('la ficha pública dice que va por peso y cuántos gramos hay', async () => {
    const p = (await cliente(srv.base).pedir('/api/productos/' + granel.id)).json;
    assert.equal(p.unidad, 'gramo');
    assert.equal(p.presentaciones, '50,100,250,500,1000');
    assert.equal(p.precio, PRECIO_100G, 'el precio público es el de 100 g');
    assert.equal(p.stock, STOCK_G);
  });

  const CASOS = [
    [100, 9.4],     // justo la unidad de cotización
    [250, 23.5],    // un cuarto
    [500, 47],      // medio kilo
    [1000, 94],     // el kilo
    [50, 4.7],      // la fracción más chica
    [170, 15.98],   // cantidad libre: el cliente que pide 170 g existe
  ];

  for (const [gramos, esperado] of CASOS) {
    test(`${gramos} g a S/ ${PRECIO_100G} los 100 g = S/ ${esperado}`, async () => {
      const r = await comprar(gramos);
      assert.equal(r.estado, 201, JSON.stringify(r.json));
      assert.equal(r.json.pedido.subtotal, esperado);
      assert.equal(r.json.pedido.envio, 0);
      assert.equal(r.json.pedido.total, esperado);
    });
  }

  test('el stock se descuenta en gramos', async () => {
    const antes = (await duena.pedir('/api/admin/productos')).json
      .find((p) => p.id === granel.id).stock;

    const r = await comprar(250);
    assert.equal(r.estado, 201, JSON.stringify(r.json));

    const despues = (await duena.pedir('/api/admin/productos')).json
      .find((p) => p.id === granel.id).stock;
    assert.equal(antes - despues, 250, 'tenía que bajar 250 gramos, no 250 bolsas');
  });

  test('no se puede pedir más de lo que hay en la bolsa', async () => {
    const hay = (await duena.pedir('/api/admin/productos')).json
      .find((p) => p.id === granel.id).stock;
    const r = await comprar(hay + 1);
    assert.equal(r.estado, 409, JSON.stringify(r.json));
    assert.equal(r.json.faltantes[0].disponible, hay);
  });
});

describe('La línea del pedido queda congelada en gramos', () => {
  /**
   * `precio_unit` guarda el precio de UN gramo, no el de los cien que se
   * cotizan. Así el comprobante multiplica cantidad por precio sin más, y una
   * boleta vieja no cambia de importe si mañana el producto deja de venderse
   * por peso o le suben el precio.
   */
  test('guarda el precio por gramo y la unidad de la venta', async () => {
    const r = await comprar(250);
    assert.equal(r.estado, 201, JSON.stringify(r.json));

    const p = (await duena.pedir('/api/pedidos')).json.find((x) => x.id === r.json.pedido.id);
    const [linea] = p.items;

    assert.equal(linea.cantidad, 250, 'la cantidad son gramos');
    assert.equal(linea.unidad, 'gramo');
    assert.equal(+linea.precio_unit.toFixed(4), +(PRECIO_100G / 100).toFixed(4));
    assert.equal(linea.subtotal, 23.5);
    // Y la cuenta cierra sola: cantidad × precio unitario = subtotal.
    assert.equal(+(linea.cantidad * linea.precio_unit).toFixed(2), linea.subtotal);
  });

  test('el costo también viaja por gramo, para que la ganancia no mienta', async () => {
    const r = await comprar(500);
    const p = (await duena.pedir('/api/pedidos')).json.find((x) => x.id === r.json.pedido.id);
    const [linea] = p.items;
    // Costo de ficha S/ 3 los 100 g -> S/ 0.03 el gramo -> S/ 15 los 500 g.
    assert.equal(+(linea.costo_unit * linea.cantidad).toFixed(2), 15);
  });
});

describe('El comprobante lo declara en gramos', () => {
  // SUNAT pide la unidad de medida de cada línea. Declarar «NIU» (unidad) una
  // venta de 250 gramos es declarar 250 bolsas.
  test('la línea sale con unidad GRM y la cantidad en gramos', async () => {
    const r = await comprar(250);
    assert.equal(r.estado, 201, JSON.stringify(r.json));
    assert.ok(r.json.pedido.numeroComprobante, 'no se emitió comprobante');

    const lista = (await duena.pedir('/api/admin/comprobantes')).json;
    const cmp = lista.find((c) => c.pedido_id === r.json.pedido.id);
    assert.ok(cmp, 'el comprobante no aparece en la lista');

    const d = (await duena.pedir('/api/comprobantes/' + cmp.id)).json;
    const linea = d.items.find((i) => i.cantidad === 250);
    assert.ok(linea, 'no encontré la línea de 250 g');
    assert.equal(linea.unidad, 'GRM');
    assert.equal(+linea.importe.toFixed(2), 23.5);
  });
});

describe('Lo que se vende por unidad no cambió', () => {
  test('un producto normal sigue cobrándose por pieza', async () => {
    const normal = (await duena.pedir('/api/admin/productos')).json
      .find((p) => p.activo === 1 && p.unidad === 'unidad' && p.stock > 5);
    assert.ok(normal, 'hace falta un producto por unidad');

    const r = await cliente(srv.base).pedir('/api/pedidos', {
      metodo: 'POST',
      cuerpo: {
        cliente: CLIENTE_VALIDO,
        items: [{ id: normal.id, cantidad: 3 }],
        entrega: 'recojo',
      },
    });
    assert.equal(r.estado, 201, JSON.stringify(r.json));
    assert.equal(r.json.pedido.subtotal, +(normal.precio * 3).toFixed(2));

    const p = (await duena.pedir('/api/pedidos')).json.find((x) => x.id === r.json.pedido.id);
    assert.equal(p.items[0].unidad, 'unidad');
    assert.equal(p.items[0].precio_unit, normal.precio);
  });
});

describe('Las presentaciones se validan', () => {
  const fijar = (valor) => duena.pedir('/api/productos/' + granel.id, {
    metodo: 'PATCH', cuerpo: { presentaciones: valor },
  });

  test('se ordenan y se quitan repetidas', async () => {
    const r = await fijar('500, 100, 100, 250');
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.producto.presentaciones, '100,250,500');
  });

  test('la basura se descarta en vez de guardarse', async () => {
    const r = await fijar('abc, -5, 0, 200, 99999');
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.producto.presentaciones, '200');
  });

  test('una unidad inventada se rechaza', async () => {
    const r = await duena.pedir('/api/productos/' + granel.id, {
      metodo: 'PATCH', cuerpo: { unidad: 'litros' },
    });
    assert.equal(r.estado, 400, JSON.stringify(r.json));
  });
});
