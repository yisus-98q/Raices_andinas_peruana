/**
 * El tercer papel del panel: el reparto.
 *
 * La separación entre la dueña y el mostrador se prueba en `roles.test.mjs`.
 * Aquí se prueba la del motorizado, que es de otra clase: al mostrador se le
 * esconde el costo, pero al reparto se le esconde el negocio entero. Su
 * teléfono sale a la calle todos los días, se presta y se pierde, y lo que
 * necesita para trabajar cabe en dos cosas: a quién le lleva y marcar que
 * entregó.
 *
 * Como en el otro archivo, cada caso pide la ruta directamente y no pasa por
 * la pantalla: esconder un bloque evita el error de buena fe, pero cualquiera
 * que escriba la URL a mano se lo salta. El 403 es lo único que corta.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { levantarServidor, cliente, CLIENTE_VALIDO } from './ayuda.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

let srv, duena, mostrador, motorizado;
let pedidoEnvio, pedidoRecojo, producto;

/** Da de alta un acceso con su papel, por fuera de la API. */
function alta(usuario, correo, nombre, clave, rol) {
  const r = spawnSync(process.execPath,
    ['clave.mjs', '--nuevo', usuario, correo, nombre, clave, rol],
    { cwd: RAIZ, env: { ...process.env, DB_PATH: srv.dbPath }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}

async function entrar(correo, clave) {
  const c = cliente(srv.base);
  const r = await c.pedir('/api/login', { metodo: 'POST', cuerpo: { correo, clave } });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  return c;
}

before(async () => {
  srv = await levantarServidor();

  duena = await entrar('qa@raizandina.pe', 'claveDePrueba2026');

  alta('caja', 'caja@raizandina.pe', 'La caja', 'claveDeLaCaja1', 'vendedor');
  alta('moto', 'moto@raizandina.pe', 'El motorizado', 'claveDeLaMoto1', 'reparto');
  mostrador = await entrar('caja@raizandina.pe', 'claveDeLaCaja1');
  motorizado = await entrar('moto@raizandina.pe', 'claveDeLaMoto1');

  producto = (await duena.pedir('/api/admin/productos')).json
    .find((p) => p.stock > 10 && p.activo === 1);
  assert.ok(producto, 'hace falta un producto con stock');

  // Uno que sale a la calle y otro que el cliente pasa a recoger.
  const envio = await cliente(srv.base).pedir('/api/pedidos', {
    metodo: 'POST',
    cuerpo: { cliente: CLIENTE_VALIDO, items: [{ id: producto.id, cantidad: 1 }] },
  });
  assert.equal(envio.estado, 201, JSON.stringify(envio.json));
  pedidoEnvio = envio.json.pedido;

  const recojo = await cliente(srv.base).pedir('/api/pedidos', {
    metodo: 'POST',
    cuerpo: {
      cliente: { nombre: 'Rosa Huamán', telefono: '956231447', tipo_doc: 'DNI', num_doc: '45678912' },
      items: [{ id: producto.id, cantidad: 1 }],
      entrega: 'recojo',
    },
  });
  assert.equal(recojo.estado, 201, JSON.stringify(recojo.json));
  pedidoRecojo = recojo.json.pedido;
});

after(async () => { await srv?.parar(); });

describe('El motorizado no ve el negocio', () => {
  // Estas son las rutas que resumen la marcha del puesto: la caja del día, lo
  // que entró y salió del inventario, el catálogo con sus precios y quién
  // compra qué. El panel se las esconde; esto comprueba que además se las
  // niegue el servidor, que es lo único que detiene a quien escriba la URL.
  const PROHIBIDAS = [
    ['GET', '/api/admin/resumen'],
    ['GET', '/api/admin/movimientos'],
    ['GET', '/api/admin/productos'],
    ['GET', '/api/admin/categorias'],
    ['GET', '/api/admin/calendario'],
    ['GET', '/api/admin/clientes'],
    ['GET', '/api/admin/cambios'],
    ['GET', '/api/admin/respaldos'],
  ];

  for (const [metodo, ruta] of PROHIBIDAS) {
    test(`403 en ${ruta}`, async () => {
      const r = await motorizado.pedir(ruta, { metodo });
      assert.equal(r.estado, 403, `${ruta} respondió ${r.estado}: ${r.texto.slice(0, 120)}`);
    });
  }

  test('no puede vender en el mostrador', async () => {
    const r = await motorizado.pedir('/api/mostrador', {
      metodo: 'POST', cuerpo: { items: [{ id: producto.id, cantidad: 1 }] },
    });
    assert.equal(r.estado, 403, JSON.stringify(r.json));
  });

  test('no puede mover el stock', async () => {
    const r = await motorizado.pedir('/api/stock', {
      metodo: 'POST',
      cuerpo: { producto_id: producto.id, cantidad: 10, motivo: 'ingreso inventado' },
    });
    assert.equal(r.estado, 403, JSON.stringify(r.json));
    // Y el inventario quedó donde estaba.
    const fresco = (await duena.pedir('/api/admin/productos')).json
      .find((p) => p.id === producto.id);
    assert.equal(fresco.stock, producto.stock - 2, 'el stock cambió pese al 403');
  });

  test('no puede tocar el precio de una ficha', async () => {
    const r = await motorizado.pedir('/api/productos/' + producto.id, {
      metodo: 'PATCH', cuerpo: { precio: 1 },
    });
    assert.equal(r.estado, 403, JSON.stringify(r.json));
  });
});

describe('El motorizado ve su ruta y nada más', () => {
  test('solo los pedidos que salen a la calle', async () => {
    const suyos = (await motorizado.pedir('/api/pedidos')).json;
    const codigos = suyos.map((p) => p.codigo);

    assert.ok(codigos.includes(pedidoEnvio.codigo), 'falta el pedido de envío');
    assert.ok(!codigos.includes(pedidoRecojo.codigo),
      'le llegó un pedido que el cliente pasa a recoger');
    assert.ok(suyos.every((p) => p.canal !== 'mostrador'),
      'le llegó una venta de mostrador');
  });

  test('sin documento ni correo del cliente', async () => {
    const [p] = (await motorizado.pedir('/api/pedidos')).json;
    for (const campo of ['num_doc', 'tipo_doc', 'razon_social', 'cliente_email']) {
      assert.ok(!(campo in p), `el pedido todavía trae "${campo}"`);
    }
    // Pero sí lo que hace falta para entregar y cobrar.
    for (const campo of ['codigo', 'cliente_nombre', 'cliente_tel', 'cliente_dir', 'total']) {
      assert.ok(campo in p, `al pedido le falta "${campo}", que sí necesita`);
    }
  });

  /**
   * Los tres toques del recorrido, y que cada uno se vea desde fuera.
   *
   * No son decorativos: son los que hacen que el comprador, mirando su página
   * de seguimiento, pase de «Recibido» a «En preparación», «En camino» y
   * «Entregado» sin tener que llamar al puesto a preguntar. Cerrar el pedido de
   * un salto se lo ahorraba todo.
   */
  test('avanza el pedido de un toque por paso, y el cliente lo ve', async () => {
    const estadoSegunElCliente = async () => {
      const r = await cliente(srv.base).pedir('/api/seguimiento', {
        metodo: 'POST',
        cuerpo: { codigo: pedidoEnvio.codigo, telefono: CLIENTE_VALIDO.telefono },
      });
      assert.equal(r.estado, 200, JSON.stringify(r.json));
      return r.json.estado;
    };

    assert.equal(await estadoSegunElCliente(), 'pendiente');

    for (const paso of ['preparando', 'enviado', 'entregado']) {
      const r = await motorizado.pedir(`/api/pedidos/${pedidoEnvio.id}/estado`, {
        metodo: 'PATCH', cuerpo: { estado: paso },
      });
      assert.equal(r.estado, 200, `no dejó marcar "${paso}": ${JSON.stringify(r.json)}`);
      assert.equal(await estadoSegunElCliente(), paso,
        `el comprador no vio el paso "${paso}"`);
    }
  });

  test('no puede anular ni registrar devolución', async () => {
    for (const estado of ['anulado', 'devuelto']) {
      const r = await motorizado.pedir(`/api/pedidos/${pedidoEnvio.id}/estado`, {
        metodo: 'PATCH', cuerpo: { estado },
      });
      assert.equal(r.estado, 403, `dejó marcar "${estado}"`);
    }
    // Y el stock no se repuso por el intento.
    const fresco = (await duena.pedir('/api/admin/productos')).json
      .find((p) => p.id === producto.id);
    assert.equal(fresco.stock, producto.stock - 2);
  });

  test('no puede tocar un pedido que no sale a reparto', async () => {
    const r = await motorizado.pedir(`/api/pedidos/${pedidoRecojo.id}/estado`, {
      metodo: 'PATCH', cuerpo: { estado: 'entregado' },
    });
    assert.equal(r.estado, 403, JSON.stringify(r.json));
  });
});

describe('El costo solo lo ve la dueña', () => {
  // `costo_unit` viaja con cada línea para poder calcular la ganancia con el
  // costo del momento. Salía en la respuesta para cualquiera con sesión: el
  // panel del mostrador no lo pinta, pero abrir /api/pedidos en el navegador
  // mostraba lo que costó cada cosa vendida.
  const items = async (c) => (await c.pedir('/api/pedidos')).json
    .flatMap((p) => p.items);

  test('la dueña sí lo recibe', async () => {
    const todos = await items(duena);
    assert.ok(todos.length > 0);
    assert.ok(todos.every((i) => 'costo_unit' in i), 'a la dueña le falta el costo');
  });

  test('el mostrador no', async () => {
    const todos = await items(mostrador);
    assert.ok(todos.length > 0);
    assert.ok(todos.every((i) => !('costo_unit' in i)), 'el mostrador recibió el costo');
  });

  test('el motorizado tampoco', async () => {
    const todos = await items(motorizado);
    assert.ok(todos.length > 0);
    assert.ok(todos.every((i) => !('costo_unit' in i)), 'el reparto recibió el costo');
  });
});
