/**
 * Quién lleva cada pedido.
 *
 * Con un solo motorizado daba igual; con dos, los dos veían la misma cola y
 * salían a entregar el mismo pedido. Ahora el puesto asigna, cada motorizado ve
 * lo suyo y lo que nadie tomó, y el que marca «en camino» un pedido libre se lo
 * queda. Como en reparto.test.mjs, lo que corta es el servidor, no la pantalla.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { levantarServidor, cliente, CLIENTE_VALIDO } from './ayuda.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

let srv, duena, mostrador, lucho, pepe;
let producto;

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

async function nuevoPedido(extra = {}) {
  const r = await cliente(srv.base).pedir('/api/pedidos', {
    metodo: 'POST',
    cuerpo: { cliente: CLIENTE_VALIDO, items: [{ id: producto.id, cantidad: 1 }], ...extra },
  });
  assert.equal(r.estado, 201, JSON.stringify(r.json));
  return r.json.pedido;
}

const asignar = (quien, id, repartidor) => quien.pedir(`/api/pedidos/${id}/repartidor`, {
  metodo: 'PATCH', cuerpo: { repartidor },
});
const mover = (quien, id, estado) => quien.pedir(`/api/pedidos/${id}/estado`, {
  metodo: 'PATCH', cuerpo: { estado },
});
const codigosDe = async (quien) => (await quien.pedir('/api/pedidos')).json.map((p) => p.codigo);

before(async () => {
  srv = await levantarServidor();
  duena = await entrar('qa@raizandina.pe', 'claveDePrueba2026');
  alta('caja', 'caja@raizandina.pe', 'La caja', 'claveDeLaCaja1', 'vendedor');
  alta('lucho', 'lucho@raizandina.pe', 'Lucho', 'claveDeLucho01', 'reparto');
  alta('pepe', 'pepe@raizandina.pe', 'Pepe', 'claveDePepe001', 'reparto');
  mostrador = await entrar('caja@raizandina.pe', 'claveDeLaCaja1');
  lucho = await entrar('lucho@raizandina.pe', 'claveDeLucho01');
  pepe = await entrar('pepe@raizandina.pe', 'claveDePepe001');

  producto = (await duena.pedir('/api/admin/productos')).json
    .find((p) => p.stock > 20 && p.activo === 1);
  assert.ok(producto, 'hace falta un producto con stock');
});

after(async () => { await srv?.parar(); });

describe('El puesto reparte el trabajo', () => {
  test('lista los motorizados para el selector', async () => {
    const r = await mostrador.pedir('/api/admin/repartidores');
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.repartidores.map((x) => x.usuario).sort(), ['lucho', 'pepe']);
    assert.equal(r.json.avisos, 'manual');
    assert.equal((await lucho.pedir('/api/admin/repartidores')).estado, 403);
  });

  test('asigna, y el pedido lleva el nombre', async () => {
    const p = await nuevoPedido();
    const r = await asignar(duena, p.id, 'lucho');
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.repartidor, 'lucho');
    assert.equal(r.json.repartidor_nombre, 'Lucho');

    const enLista = (await mostrador.pedir('/api/pedidos')).json.find((x) => x.id === p.id);
    assert.equal(enLista.repartidor_nombre, 'Lucho');
  });

  test('solo a un acceso de reparto', async () => {
    const p = await nuevoPedido();
    assert.equal((await asignar(duena, p.id, 'caja')).estado, 400);
    assert.equal((await asignar(duena, p.id, 'nadie')).estado, 400);
  });

  test('un pedido que recogen en el puesto no se asigna', async () => {
    const p = await nuevoPedido({
      cliente: { nombre: 'Rosa Huamán', telefono: '956231447', tipo_doc: 'DNI', num_doc: '45678912' },
      entrega: 'recojo',
    });
    assert.equal((await asignar(duena, p.id, 'lucho')).estado, 400);
  });

  test('el motorizado no se reparte pedidos', async () => {
    const p = await nuevoPedido();
    assert.equal((await asignar(lucho, p.id, 'lucho')).estado, 403);
  });

  test('vacío lo deja sin asignar', async () => {
    const p = await nuevoPedido();
    await asignar(duena, p.id, 'pepe');
    const r = await asignar(mostrador, p.id, '');
    assert.equal(r.estado, 200);
    assert.equal(r.json.repartidor, '');
  });

  test('un pedido cerrado ya no cambia de manos', async () => {
    const p = await nuevoPedido();
    await mover(duena, p.id, 'entregado');
    assert.equal((await asignar(duena, p.id, 'pepe')).estado, 409);
  });
});

describe('Cada motorizado ve lo suyo', () => {
  let dePepe, libre;

  before(async () => {
    dePepe = await nuevoPedido();
    await asignar(duena, dePepe.id, 'pepe');
    libre = await nuevoPedido();
  });

  test('lo de otro no le aparece; lo libre sí', async () => {
    const deLucho = await codigosDe(lucho);
    assert.ok(!deLucho.includes(dePepe.codigo), 'Lucho ve un pedido asignado a Pepe');
    assert.ok(deLucho.includes(libre.codigo), 'Lucho no ve un pedido sin asignar');
    assert.ok((await codigosDe(pepe)).includes(dePepe.codigo));
  });

  test('no puede mover el pedido de otro', async () => {
    const r = await mover(lucho, dePepe.id, 'enviado');
    assert.equal(r.estado, 403, JSON.stringify(r.json));
    assert.match(r.json.error, /Pepe/);
  });

  test('al sacar a la calle uno libre, queda a su nombre', async () => {
    const r = await mover(lucho, libre.id, 'enviado');
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.repartidor, 'lucho');
    assert.ok(!(await codigosDe(pepe)).includes(libre.codigo), 'Pepe sigue viendo el pedido que tomó Lucho');
  });

  test('el cliente ve quién se lo lleva', async () => {
    const r = await cliente(srv.base).pedir('/api/seguimiento', {
      metodo: 'POST', cuerpo: { codigo: libre.codigo, telefono: CLIENTE_VALIDO.telefono },
    });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.estado, 'enviado');
    assert.equal(r.json.repartidor, 'Lucho');
  });

  test('entrega registrando cómo le pagaron', async () => {
    const r = await lucho.pedir(`/api/pedidos/${libre.id}/estado`, {
      metodo: 'PATCH', cuerpo: { estado: 'entregado', cobro: 'efectivo' },
    });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.cobro, 'efectivo');
    assert.ok(r.json.cerrado_en, 'no quedó la hora de cierre');

    // Y la dueña ve el efectivo que Lucho tiene que rendir.
    const equipo = (await duena.pedir('/api/admin/resumen')).json.equipo.personas;
    const suyo = equipo.find((p) => p.usuario === 'lucho');
    assert.equal(suyo.efectivo, libre.total);

    // Marcarlo entregado otra vez no duplica lo que tiene que rendir.
    await lucho.pedir(`/api/pedidos/${libre.id}/estado`, {
      metodo: 'PATCH', cuerpo: { estado: 'entregado', cobro: 'efectivo' },
    });
    const otra = (await duena.pedir('/api/admin/resumen')).json.equipo.personas
      .find((p) => p.usuario === 'lucho');
    assert.equal(otra.efectivo, libre.total);
  });

  test('la dueña tocando «entregado» otra vez no se queda con el efectivo', async () => {
    const r = await mover(duena, libre.id, 'entregado');
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    const personas = (await duena.pedir('/api/admin/resumen')).json.equipo.personas;
    assert.equal(personas.find((p) => p.usuario === 'lucho').efectivo, libre.total);
    assert.equal(personas.find((p) => p.rol === 'admin').efectivo, 0);
  });

  test('el motorizado no puede devolver atrás un pedido cobrado', async () => {
    const r = await mover(lucho, libre.id, 'preparando');
    assert.equal(r.estado, 409, JSON.stringify(r.json));
    const fresco = (await duena.pedir('/api/pedidos')).json.find((p) => p.id === libre.id);
    assert.equal(fresco.estado, 'entregado');
  });

  test('si el cliente confirmó antes, el cobro se registra después', async () => {
    const p = await nuevoPedido();
    await asignar(duena, p.id, 'pepe');
    await mover(pepe, p.id, 'enviado');
    const recibido = await cliente(srv.base).pedir('/api/seguimiento/recibido', {
      metodo: 'POST', cuerpo: { codigo: p.codigo, telefono: CLIENTE_VALIDO.telefono },
    });
    assert.equal(recibido.estado, 200, JSON.stringify(recibido.json));

    const r = await pepe.pedir(`/api/pedidos/${p.id}/estado`, {
      metodo: 'PATCH', cuerpo: { estado: 'entregado', cobro: 'efectivo' },
    });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.cobro, 'efectivo');
    const suyo = (await duena.pedir('/api/admin/resumen')).json.equipo.personas
      .find((x) => x.usuario === 'pepe');
    assert.equal(suyo.efectivo, p.total);
  });

  test('una devolución no borra el efectivo que el motorizado ya cobró', async () => {
    const p = await nuevoPedido();
    await asignar(duena, p.id, 'pepe');
    await mover(pepe, p.id, 'enviado');
    const efectivoDePepe = async () => (await duena.pedir('/api/admin/resumen')).json.equipo.personas
      .find((x) => x.usuario === 'pepe').efectivo;
    const antes = await efectivoDePepe();
    await pepe.pedir(`/api/pedidos/${p.id}/estado`, {
      metodo: 'PATCH', cuerpo: { estado: 'entregado', cobro: 'efectivo' },
    });
    assert.equal((await mover(duena, p.id, 'devuelto')).estado, 200);
    assert.equal(await efectivoDePepe(), +(antes + p.total).toFixed(2));
  });

  test('un cobro inventado, o fuera de la entrega, no pasa', async () => {
    const p = await nuevoPedido();
    assert.equal((await mover(duena, p.id, 'preparando')).estado, 200);
    const raro = await duena.pedir(`/api/pedidos/${p.id}/estado`, {
      metodo: 'PATCH', cuerpo: { estado: 'entregado', cobro: 'trueque' },
    });
    assert.equal(raro.estado, 400);
    const antes = await duena.pedir(`/api/pedidos/${p.id}/estado`, {
      metodo: 'PATCH', cuerpo: { estado: 'enviado', cobro: 'yape' },
    });
    assert.equal(antes.estado, 400);
  });

  test('la ruta trae lo cerrado hoy, no lo de días anteriores', async () => {
    const viejo = await nuevoPedido();
    await mover(duena, viejo.id, 'entregado');
    const db = new DatabaseSync(srv.dbPath);
    db.prepare("UPDATE pedidos SET cerrado_en = datetime('now','localtime','-1 day') WHERE id = ?").run(viejo.id);
    db.close();

    const deLucho = await codigosDe(lucho);
    assert.ok(!deLucho.includes(viejo.codigo), 'le sigue apareciendo un pedido entregado ayer');
    assert.ok(deLucho.includes(libre.codigo), 'no ve lo que entregó hoy');
    // El puesto sí conserva el historial.
    assert.ok((await codigosDe(duena)).includes(viejo.codigo));
  });

});
