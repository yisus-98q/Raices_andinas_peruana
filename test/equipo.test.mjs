/**
 * «Tu equipo hoy» en el resumen de la dueña.
 *
 * Se prueba que cada acción quede firmada por quien la hizo —la venta del
 * mostrador y la entrega del motorizado— y que ese detalle sea solo de la dueña:
 * lo que cobró cada quien es plata del negocio.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { levantarServidor, cliente, CLIENTE_VALIDO } from './ayuda.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

let srv, duena, mostrador, motorizado, producto;

function alta(usuario, correo, nombre, clave, rol) {
  const r = spawnSync(process.execPath, ['clave.mjs', '--nuevo', usuario, correo, nombre, clave, rol],
    { cwd: RAIZ, env: { ...process.env, DB_PATH: srv.dbPath }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}

async function entrar(correo, clave) {
  const c = cliente(srv.base);
  const r = await c.pedir('/api/login', { metodo: 'POST', cuerpo: { correo, clave } });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  return c;
}

const persona = (resumen, usuario) => resumen.equipo.personas.find((p) => p.usuario === usuario);

before(async () => {
  srv = await levantarServidor();
  duena = await entrar('qa@raizandina.pe', 'claveDePrueba2026');
  alta('caja', 'caja@raizandina.pe', 'Rosa Quispe', 'claveDeLaCaja1', 'vendedor');
  alta('moto', 'moto@raizandina.pe', 'Julio Mamani', 'claveDeLaMoto1', 'reparto');
  mostrador = await entrar('caja@raizandina.pe', 'claveDeLaCaja1');
  motorizado = await entrar('moto@raizandina.pe', 'claveDeLaMoto1');
  producto = (await duena.pedir('/api/admin/productos')).json
    .find((p) => p.activo === 1 && p.stock > 10 && p.unidad !== 'gramo');
  assert.ok(producto, 'hace falta un producto con stock');
});

after(async () => { await srv?.parar(); });

describe('Tu equipo hoy', () => {
  test('la dueña ve a cada persona del puesto y a la tienda web, aunque no hayan hecho nada', async () => {
    const r = (await duena.pedir('/api/admin/resumen')).json;
    assert.ok(r.equipo, 'el resumen no trae el equipo');
    for (const u of ['caja', 'moto']) assert.ok(persona(r, u), `falta ${u} en el equipo`);
    assert.equal(persona(r, 'moto').rol, 'reparto');
    assert.equal(persona(r, 'moto').ultima_actividad, null);
    assert.ok('pedidos' in r.equipo.web && 'por_repartir' in r.equipo.web);
  });

  test('la venta del mostrador queda a nombre de quien la cobró', async () => {
    const v = await mostrador.pedir('/api/mostrador', {
      metodo: 'POST', cuerpo: { items: [{ id: producto.id, cantidad: 2 }] },
    });
    assert.equal(v.estado, 201, JSON.stringify(v.json));

    const caja = persona((await duena.pedir('/api/admin/resumen')).json, 'caja');
    assert.equal(caja.ventas_local, 1);
    assert.equal(caja.ventas_local_monto, v.json.venta.total);
    assert.ok(caja.ultima_actividad, 'no registró la hora');
  });

  test('el motorizado suma sus entregas y lo que lleva en camino', async () => {
    const pedido = (await cliente(srv.base).pedir('/api/pedidos', {
      metodo: 'POST', cuerpo: { cliente: CLIENTE_VALIDO, items: [{ id: producto.id, cantidad: 1 }] },
    })).json.pedido;
    const otro = (await cliente(srv.base).pedir('/api/pedidos', {
      metodo: 'POST', cuerpo: { cliente: CLIENTE_VALIDO, items: [{ id: producto.id, cantidad: 1 }] },
    })).json.pedido;

    for (const paso of ['preparando', 'enviado', 'entregado']) {
      const r = await motorizado.pedir(`/api/pedidos/${pedido.id}/estado`, { metodo: 'PATCH', cuerpo: { estado: paso } });
      assert.equal(r.estado, 200, JSON.stringify(r.json));
    }
    await motorizado.pedir(`/api/pedidos/${otro.id}/estado`, { metodo: 'PATCH', cuerpo: { estado: 'enviado' } });

    const r = (await duena.pedir('/api/admin/resumen')).json;
    const moto = persona(r, 'moto');
    assert.equal(moto.entregados, 1);
    assert.equal(moto.en_camino, 1, 'el pedido enviado no figura en camino');
    assert.equal(moto.preparados + moto.enviados, 3);
    assert.ok(r.equipo.web.pedidos >= 2);
  });

  test('el mostrador no recibe el detalle del equipo', async () => {
    const r = await mostrador.pedir('/api/admin/resumen');
    assert.equal(r.estado, 200);
    assert.equal(r.json.equipo, undefined, 'el mostrador ve lo que cobró cada quien');
  });
});
