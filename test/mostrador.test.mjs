/**
 * Venta en el local.
 *
 * El negocio vende por dos canales —la tienda web y el mostrador— y los dos
 * descuentan del MISMO stock. Lo que se prueba aqui es justo eso: que el
 * inventario cuadre despues de vender por los dos lados, que no se pueda
 * vender lo que no hay, y que la ganancia salga del costo del momento de la
 * venta y no del de hoy.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { levantarServidor, cliente, CLIENTE_VALIDO } from './ayuda.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

let srv, dueno, mostrador, prod;

const catalogo = async () => (await dueno.pedir('/api/admin/productos')).json;
const stockDe = async (id) => (await catalogo()).find((p) => p.id === id).stock;

before(async () => {
  srv = await levantarServidor();

  dueno = cliente(srv.base);
  await dueno.pedir('/api/login', {
    metodo: 'POST', cuerpo: { correo: 'qa@raizandina.pe', clave: 'claveDePrueba2026' },
  });

  const alta = spawnSync(process.execPath, [
    'clave.mjs', '--nuevo', 'caja', 'caja@raizandina.pe', 'La caja', 'claveDeLaCaja1',
  ], { cwd: RAIZ, env: { ...process.env, DB_PATH: srv.dbPath }, encoding: 'utf8' });
  assert.equal(alta.status, 0, alta.stdout + alta.stderr);

  mostrador = cliente(srv.base);
  await mostrador.pedir('/api/login', {
    metodo: 'POST', cuerpo: { correo: 'caja@raizandina.pe', clave: 'claveDeLaCaja1' },
  });

  // Un producto con stock de sobra y costo conocido, para poder verificar la
  // ganancia sin depender de la semilla.
  prod = (await catalogo()).find((p) => p.stock > 30 && p.costo > 0 && p.activo === 1);
  assert.ok(prod, 'hace falta un producto con stock y costo para la prueba');
});

after(async () => { await srv?.parar(); });

describe('Vender en el local', () => {
  test('descuenta del mismo stock que la tienda web', async () => {
    const antes = await stockDe(prod.id);

    const r = await mostrador.pedir('/api/mostrador', {
      metodo: 'POST', cuerpo: { items: [{ id: prod.id, cantidad: 3 }] },
    });
    assert.equal(r.estado, 201, JSON.stringify(r.json));
    assert.equal(await stockDe(prod.id), antes - 3);
  });

  test('nace entregado: no hay nada que despachar', async () => {
    const r = await mostrador.pedir('/api/mostrador', {
      metodo: 'POST', cuerpo: { items: [{ id: prod.id, cantidad: 1 }] },
    });
    assert.equal(r.json.venta.estado, 'entregado');

    // Y por lo tanto no engorda la cola de por-atender.
    const antes = (await dueno.pedir('/api/admin/resumen')).json.pedidos_pendientes;
    await mostrador.pedir('/api/mostrador', {
      metodo: 'POST', cuerpo: { items: [{ id: prod.id, cantidad: 1 }] },
    });
    const despues = (await dueno.pedir('/api/admin/resumen')).json.pedidos_pendientes;
    assert.equal(despues, antes, 'una venta de mostrador no queda pendiente');
  });

  test('deja el movimiento en el kardex, marcado como mostrador', async () => {
    const r = await mostrador.pedir('/api/mostrador', {
      metodo: 'POST', cuerpo: { items: [{ id: prod.id, cantidad: 2 }] },
    });
    const movs = (await dueno.pedir('/api/admin/movimientos')).json;
    const mov = movs.find((m) => m.motivo === `Mostrador ${r.json.venta.codigo}`);
    assert.ok(mov, 'cada unidad tiene que poder explicarse');
    assert.equal(mov.cantidad, -2);
  });

  test('emite comprobante sin pedir documento', async () => {
    const r = await mostrador.pedir('/api/mostrador', {
      metodo: 'POST', cuerpo: { items: [{ id: prod.id, cantidad: 1 }] },
    });
    // Pedirle el DNI a quien compra muña de S/ 9 es perder la venta.
    assert.equal(r.json.venta.comprobante, 'boleta');
    assert.ok(r.json.venta.numeroComprobante, 'la venta tiene que salir con boleta');
    assert.equal(r.json.venta.cliente, 'Cliente de mostrador');
  });

  test('con RUC sale factura, y sin razon social se rechaza', async () => {
    const sinRazon = await mostrador.pedir('/api/mostrador', {
      metodo: 'POST',
      cuerpo: {
        items: [{ id: prod.id, cantidad: 1 }],
        cliente: { num_doc: '20100070970', tipo_doc: 'RUC' },
      },
    });
    assert.equal(sinRazon.estado, 400);
    assert.match(sinRazon.json.error, /razón social/i);

    const conRazon = await mostrador.pedir('/api/mostrador', {
      metodo: 'POST',
      cuerpo: {
        items: [{ id: prod.id, cantidad: 1 }],
        cliente: {
          num_doc: '20100070970', tipo_doc: 'RUC', razon_social: 'Comercial Los Andes S.A.C.',
        },
      },
    });
    assert.equal(conRazon.estado, 201, JSON.stringify(conRazon.json));
    assert.equal(conRazon.json.venta.comprobante, 'factura');
  });

  test('un documento escrito mal se rechaza antes de cobrar', async () => {
    const r = await mostrador.pedir('/api/mostrador', {
      metodo: 'POST',
      cuerpo: {
        items: [{ id: prod.id, cantidad: 1 }],
        cliente: { num_doc: '123', tipo_doc: 'DNI' },
      },
    });
    assert.equal(r.estado, 400);
  });

  test('no vende mas de lo que hay, y dice cuanto queda', async () => {
    const hay = await stockDe(prod.id);
    const r = await mostrador.pedir('/api/mostrador', {
      metodo: 'POST', cuerpo: { items: [{ id: prod.id, cantidad: hay + 1 }] },
    });
    assert.equal(r.estado, 409);
    // En el mostrador el cliente esta delante: hay que poder decirle
    // «de ese me queda uno».
    assert.equal(r.json.faltantes[0].disponible, hay);
    assert.equal(await stockDe(prod.id), hay, 'y no se toco el stock');
  });

  test('el carrito vacio no crea una venta', async () => {
    const r = await mostrador.pedir('/api/mostrador', { metodo: 'POST', cuerpo: { items: [] } });
    assert.equal(r.estado, 400);
  });

  test('sin sesion no se puede cobrar', async () => {
    const fuera = cliente(srv.base);
    const r = await fuera.pedir('/api/mostrador', {
      metodo: 'POST', cuerpo: { items: [{ id: prod.id, cantidad: 1 }] },
    });
    assert.equal(r.estado, 401);
  });
});

describe('La ganancia sale del costo del momento', () => {
  test('la venta devuelve la ganancia al dueño', async () => {
    const r = await dueno.pedir('/api/mostrador', {
      metodo: 'POST', cuerpo: { items: [{ id: prod.id, cantidad: 2 }] },
    });
    assert.equal(r.estado, 201);
    const esperada = +((prod.precio - prod.costo) * 2).toFixed(2);
    assert.equal(r.json.venta.ganancia, esperada);
  });

  test('al mostrador NO se le dice la ganancia', async () => {
    const r = await mostrador.pedir('/api/mostrador', {
      metodo: 'POST', cuerpo: { items: [{ id: prod.id, cantidad: 1 }] },
    });
    assert.equal(r.estado, 201);
    assert.equal(r.json.venta.ganancia, undefined, 'la ganancia se calcula del costo');
  });

  /**
   * El caso que justifica guardar el costo en la linea: si la ganancia se
   * calculara con el costo de hoy, subir el precio de compra reescribiria la
   * ganancia de todo lo ya vendido — una cifra que no ocurrio nunca.
   */
  test('subir el costo no reescribe la ganancia de lo ya vendido', async () => {
    const hoy = (await dueno.pedir('/api/admin/resumen')).json.ganancia_hoy;

    const nuevo = +(prod.precio * 0.95).toFixed(2);   // casi sin margen, pero valido
    const sube = await dueno.pedir(`/api/productos/${prod.id}`, {
      metodo: 'PATCH', cuerpo: { precio: prod.precio },   // el precio no cambia
    });
    assert.ok([200, 400].includes(sube.estado));

    // Se cambia el costo por la base, que es lo unico que puede hacerlo: el
    // panel no edita costos.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(srv.dbPath);
    db.prepare('UPDATE productos SET costo = ? WHERE id = ?').run(nuevo, prod.id);
    db.close();

    const despues = (await dueno.pedir('/api/admin/resumen')).json.ganancia_hoy;
    assert.equal(despues, hoy, 'la ganancia del dia ya vendido no puede moverse');
  });
});

describe('El stock cuadra entre los dos canales', () => {
  test('vender 2 en el local y 3 por la web baja 5 del inventario', async () => {
    const otro = (await catalogo()).find((p) => p.stock > 20 && p.activo === 1 && p.id !== prod.id);
    const antes = otro.stock;

    await mostrador.pedir('/api/mostrador', {
      metodo: 'POST', cuerpo: { items: [{ id: otro.id, cantidad: 2 }] },
    });
    const web = await cliente(srv.base).pedir('/api/pedidos', {
      metodo: 'POST',
      cuerpo: { cliente: CLIENTE_VALIDO, items: [{ id: otro.id, cantidad: 3 }] },
    });
    assert.equal(web.estado, 201, JSON.stringify(web.json));

    assert.equal(await stockDe(otro.id), antes - 5);
  });

  test('el tablero separa lo del local de lo de la web', async () => {
    const r = (await dueno.pedir('/api/admin/resumen')).json;
    assert.ok(r.ventas_local_hoy > 0, 'debe haber ventas de mostrador');
    assert.ok(r.ventas_web_hoy > 0, 'y ventas por la web');
    // Los dos canales suman el total del dia: si no, una venta se perdio.
    assert.equal(+(r.ventas_local_hoy + r.ventas_web_hoy).toFixed(2), r.ventas_hoy);
  });
});
