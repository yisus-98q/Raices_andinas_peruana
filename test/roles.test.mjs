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

  test('el tablero no le da el valor del inventario a costo', async () => {
    const r = await mostrador.pedir('/api/admin/resumen');
    assert.equal(r.estado, 200);
    assert.equal(r.json.valor_inventario, undefined, 'esa cifra es el costo del catalogo');
    // Las unidades si: son lo que necesita para saber si hay que reponer.
    assert.ok(Number.isInteger(r.json.unidades_inventario));
    assert.ok(Array.isArray(r.json.bajo_stock));
  });

  test('la reposicion urgente no cuela el costo de rebote', async () => {
    const r = await mostrador.pedir('/api/admin/resumen');
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
   * El permiso se mira campo por campo y no en la puerta: ajustar el minimo de
   * reposicion es trabajo de quien ve vaciarse el estante, no del dueño desde
   * su casa. Y las dos cosas entran por la misma peticion.
   */
  test('SI puede ajustar el minimo de reposicion', async () => {
    const r = await mostrador.pedir(`/api/productos/${unProducto.id}`, {
      metodo: 'PATCH', cuerpo: { stock_min: unProducto.stock_min + 3 },
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

  test('mueve stock: el ingreso de mercaderia es su trabajo', async () => {
    const r = await mostrador.pedir('/api/stock', {
      metodo: 'POST',
      cuerpo: { producto_id: unProducto.id, cantidad: 5, motivo: 'Llego el proveedor' },
    });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
  });

  test('consulta movimientos, comprobantes, clientes y el calendario', async () => {
    for (const ruta of ['/api/admin/movimientos', '/api/admin/comprobantes',
      '/api/admin/clientes', '/api/admin/calendario']) {
      assert.equal((await mostrador.pedir(ruta)).estado, 200, `deberia poder con ${ruta}`);
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
