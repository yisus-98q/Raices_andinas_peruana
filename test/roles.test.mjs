/**
 * Roles del panel: el dueño y el mostrador.
 *
 * Lo que se prueba no es "hay dos roles": es que **el costo no salga por
 * ninguna puerta** para quien atiende. Ocultar botones no es seguridad —
 * quien sepa escribir una URL veria el costo de todo el catalogo—, asi que
 * todas las pruebas van contra la API, no contra la pantalla.
 *
 * El margen es la negociacion del dueño con su proveedor. No tiene por que
 * estar en la pantalla del mostrador, donde cualquiera se asoma.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { levantarServidor, cliente } from './ayuda.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

let srv, dueno, mostrador, unProducto;

before(async () => {
  srv = await levantarServidor();

  // El acceso del mostrador se crea por la CLI, que es como se crea de verdad.
  const alta = spawnSync(process.execPath, [
    'clave.mjs', '--nuevo', 'sobrino', 'sobrino@raizandina.pe', 'El sobrino',
    'claveDelSobrino1',
  ], { cwd: RAIZ, env: { ...process.env, DB_PATH: srv.dbPath }, encoding: 'utf8' });
  assert.equal(alta.status, 0, alta.stdout + alta.stderr);
  // Sin decir el rol, nace vendedor: es mas facil subir a alguien que
  // descubrir que llevaba meses viendo los margenes.
  assert.match(alta.stdout, /rol vendedor/);

  dueno = cliente(srv.base);
  await dueno.pedir('/api/login', {
    metodo: 'POST', cuerpo: { correo: 'qa@raizandina.pe', clave: 'claveDePrueba2026' },
  });

  mostrador = cliente(srv.base);
  const r = await mostrador.pedir('/api/login', {
    metodo: 'POST', cuerpo: { correo: 'sobrino@raizandina.pe', clave: 'claveDelSobrino1' },
  });
  assert.equal(r.estado, 200, 'el mostrador tiene que poder entrar');
  assert.equal(r.json.usuario.rol, 'vendedor');

  const cat = await dueno.pedir('/api/admin/productos');
  unProducto = cat.json[0];
});

after(async () => { await srv?.parar(); });

describe('El costo no sale para el mostrador', () => {
  test('el catalogo del panel llega sin la columna costo', async () => {
    const r = await mostrador.pedir('/api/admin/productos');
    assert.equal(r.estado, 200, 'el mostrador SI puede ver el catalogo');
    assert.ok(r.json.length > 0);
    for (const p of r.json) {
      assert.ok(!('costo' in p), `${p.sku} llego con costo`);
    }
    // Lo que si necesita para trabajar sigue llegando.
    assert.ok('precio' in r.json[0]);
    assert.ok('stock' in r.json[0]);
  });

  test('al dueño si le llega el costo', async () => {
    const r = await dueno.pedir('/api/admin/productos');
    assert.ok('costo' in r.json[0]);
  });

  /**
   * Del tablero solo le llega lo suyo.
   *
   * De `/api/admin/resumen` salen dos cosas distintas: los indicadores del dia
   * —caja, ganancia, inventario— y la lista de mas vendidos. El mostrador tiene
   * «Mas vendidos» en su panel y no tiene los indicadores, asi que tampoco los
   * recibe. Antes se le mandaban y el panel no los pintaba: la caja del dia
   * quedaba a un `fetch` de distancia para cualquiera que abriera la consola.
   */
  test('el tablero no le da las cifras del negocio', async () => {
    const r = await mostrador.pedir('/api/admin/resumen');
    assert.equal(r.estado, 200);
    for (const campo of ['valor_inventario', 'ganancia_hoy', 'ventas_hoy',
      'ventas_local_hoy', 'ventas_web_hoy', 'unidades_inventario']) {
      assert.equal(r.json[campo], undefined, `le llego «${campo}», que es del negocio`);
    }
  });

  test('pero si la cola de trabajo y lo que mas sale', async () => {
    const r = await mostrador.pedir('/api/admin/resumen');
    assert.ok(Number.isInteger(r.json.pedidos_pendientes), 'necesita saber cuantos atender');
    // Solo que la lista llegue: en una base recien sembrada todavia no hay
    // ventas, asi que exigir que traiga algo probaria la semilla, no el rol.
    assert.ok(Array.isArray(r.json.top_productos), 'le falta «mas vendidos», que si es suyo');
  });

  test('al dueño si le llegan', async () => {
    const r = await dueno.pedir('/api/admin/resumen');
    assert.equal(r.estado, 200);
    assert.ok(Number.isFinite(r.json.ventas_hoy));
    assert.ok(Number.isFinite(r.json.valor_inventario));
    // Y la reposicion no cuela el costo de rebote en cada ficha.
    for (const p of r.json.bajo_stock) {
      assert.ok(!('costo' in p), `${p.sku} llego con costo en bajo_stock`);
    }
  });

  test('la bitacora de fichas es del dueño: lleva el historial de precios', async () => {
    assert.equal((await mostrador.pedir('/api/admin/cambios')).estado, 403);
    assert.equal((await dueno.pedir('/api/admin/cambios')).estado, 200);
  });
});

describe('Lo que el mostrador no puede cambiar', () => {
  test('no puede tocar el precio', async () => {
    const r = await mostrador.pedir(`/api/productos/${unProducto.id}`, {
      metodo: 'PATCH', cuerpo: { precio: 1 },
    });
    assert.equal(r.estado, 403);
    assert.match(r.json.error, /dueño/);

    // Y no cambio nada: el 403 tiene que ser antes de escribir.
    const despues = await dueno.pedir('/api/admin/productos');
    const mismo = despues.json.find((p) => p.id === unProducto.id);
    assert.equal(mismo.precio, unProducto.precio);
  });

  test('no puede dar de baja un producto', async () => {
    const r = await mostrador.pedir(`/api/productos/${unProducto.id}`, {
      metodo: 'PATCH', cuerpo: { activo: 0 },
    });
    assert.equal(r.estado, 403);
    const despues = await dueno.pedir('/api/admin/productos');
    assert.equal(despues.json.find((p) => p.id === unProducto.id).activo, 1);
  });

  test('no puede dar de alta una ficha', async () => {
    const r = await mostrador.pedir('/api/productos', {
      metodo: 'POST',
      cuerpo: {
        nombre: 'Producto del sobrino', categoria: 'Hierbas',
        presentacion: 'Bolsa 100 g', precio: 20, costo: 5,
      },
    });
    assert.equal(r.estado, 403);
  });

  test('no puede ver ni lanzar el respaldo', async () => {
    assert.equal((await mostrador.pedir('/api/admin/respaldos')).estado, 403);
    assert.equal((await mostrador.pedir('/api/admin/respaldos', { metodo: 'POST' })).estado, 403);
  });

  /**
   * El minimo de reposicion tambien.
   *
   * Era del mostrador —«lo ajusta quien ve vaciarse el estante»— y la decision
   * se reviso: con la seccion de reposicion fuera de su panel, no le quedaba
   * donde hacerlo. La ficha entera pasa a ser de la dueña, que es quien
   * responde por el inventario.
   */
  test('tampoco el minimo de reposicion', async () => {
    const antes = (await dueno.pedir('/api/admin/productos')).json
      .find((p) => p.id === unProducto.id);
    const r = await mostrador.pedir(`/api/productos/${unProducto.id}`, {
      metodo: 'PATCH', cuerpo: { stock_min: antes.stock_min + 3 },
    });
    assert.equal(r.estado, 403, JSON.stringify(r.json));

    const despues = (await dueno.pedir('/api/admin/productos')).json
      .find((p) => p.id === unProducto.id);
    assert.equal(despues.stock_min, antes.stock_min, 'el minimo cambio pese al 403');
  });

  test('la dueña si puede', async () => {
    const antes = (await dueno.pedir('/api/admin/productos')).json
      .find((p) => p.id === unProducto.id);
    const r = await dueno.pedir(`/api/productos/${unProducto.id}`, {
      metodo: 'PATCH', cuerpo: { stock_min: antes.stock_min + 3 },
    });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
  });

  test('un precio colado junto al minimo tumba la peticion entera', async () => {
    const antes = (await dueno.pedir('/api/admin/productos')).json
      .find((p) => p.id === unProducto.id);
    const r = await mostrador.pedir(`/api/productos/${unProducto.id}`, {
      metodo: 'PATCH', cuerpo: { stock_min: 99, precio: 1 },
    });
    assert.equal(r.estado, 403);
    const despues = (await dueno.pedir('/api/admin/productos')).json
      .find((p) => p.id === unProducto.id);
    assert.equal(despues.precio, antes.precio, 'el precio no se toco');
    assert.equal(despues.stock_min, antes.stock_min, 'y el minimo tampoco: o todo o nada');
  });
});

describe('Lo que el mostrador SI necesita para trabajar', () => {
  test('ve los pedidos con los datos de entrega', async () => {
    const r = await mostrador.pedir('/api/pedidos');
    assert.equal(r.estado, 200);
  });

  /**
   * Vender es como el mostrador mueve stock, y es la unica forma.
   *
   * El ingreso de mercaderia era suyo y paso a ser de la dueña: quien registra
   * lo que entra es quien responde por lo que falta. Lo que no cambia es que el
   * inventario baja con cada venta suya, por la via que no se puede falsear.
   */
  test('no puede ingresar mercaderia a mano', async () => {
    const antes = (await dueno.pedir('/api/admin/productos')).json
      .find((p) => p.id === unProducto.id).stock;

    const r = await mostrador.pedir('/api/stock', {
      metodo: 'POST',
      cuerpo: { producto_id: unProducto.id, cantidad: 5, motivo: 'Llego el proveedor' },
    });
    assert.equal(r.estado, 403, JSON.stringify(r.json));

    const despues = (await dueno.pedir('/api/admin/productos')).json
      .find((p) => p.id === unProducto.id).stock;
    assert.equal(despues, antes, 'el stock se movio pese al 403');
  });

  test('pero vendiendo si: es como mueve el inventario todo el dia', async () => {
    const antes = (await dueno.pedir('/api/admin/productos')).json
      .find((p) => p.id === unProducto.id).stock;

    const v = await mostrador.pedir('/api/mostrador', {
      metodo: 'POST', cuerpo: { items: [{ id: unProducto.id, cantidad: 1 }] },
    });
    assert.equal(v.estado, 201, JSON.stringify(v.json));

    const despues = (await dueno.pedir('/api/admin/productos')).json
      .find((p) => p.id === unProducto.id).stock;
    assert.equal(despues, antes - 1);
  });

  test('consulta el catalogo, los comprobantes y los clientes', async () => {
    // Lo que su panel pinta: vender necesita el catalogo, la ficha de cada
    // pedido necesita su comprobante, y «Clientes» es suyo.
    for (const ruta of ['/api/admin/productos', '/api/admin/comprobantes',
      '/api/admin/clientes']) {
      assert.equal((await mostrador.pedir(ruta)).estado, 200, `deberia poder con ${ruta}`);
    }
  });

  /**
   * Y lo que se le corto: el kardex y la facturacion del mes.
   *
   * Son la contabilidad del negocio, no herramientas de mostrador. Se comprueba
   * contra la API porque esconder la seccion del panel no impide escribir la
   * URL a mano.
   */
  test('no consulta el kardex ni el calendario de ventas', async () => {
    for (const ruta of ['/api/admin/movimientos', '/api/admin/calendario',
      '/api/admin/categorias']) {
      assert.equal((await mostrador.pedir(ruta)).estado, 403, `${ruta} no deberia dejarlo`);
    }
  });
});

describe('Cambiar el papel de alguien', () => {
  test('el rol se lee de la tabla, no de la cookie', async () => {
    // Sin cerrarle la sesion: al ascenderlo, su siguiente clic ya ve el costo.
    const r = spawnSync(process.execPath, ['clave.mjs', '--rol', 'sobrino', 'admin'],
      { cwd: RAIZ, env: { ...process.env, DB_PATH: srv.dbPath }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout);

    const ahora = await mostrador.pedir('/api/admin/productos');
    assert.ok('costo' in ahora.json[0], 'ascendido, ya ve el costo con la misma sesion');

    // Y al revés, que es el caso que importa.
    spawnSync(process.execPath, ['clave.mjs', '--rol', 'sobrino', 'vendedor'],
      { cwd: RAIZ, env: { ...process.env, DB_PATH: srv.dbPath }, encoding: 'utf8' });
    const otraVez = await mostrador.pedir('/api/admin/productos');
    assert.ok(!('costo' in otraVez.json[0]), 'degradado, deja de verlo al instante');
  });

  test('un rol inventado se rechaza', () => {
    const r = spawnSync(process.execPath, ['clave.mjs', '--rol', 'sobrino', 'jefazo'],
      { cwd: RAIZ, env: { ...process.env, DB_PATH: srv.dbPath }, encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /Rol desconocido/);
  });
});
