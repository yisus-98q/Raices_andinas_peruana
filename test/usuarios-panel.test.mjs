/**
 * Accesos del equipo desde el panel.
 *
 * La dueña da de alta a quien vende y a quien reparte sin abrir la consola.
 * Solo esos dos papeles: otro acceso de dueña ve costos, caja y respaldo, y eso
 * no se regala desde un formulario. Y un motorizado nuevo se lleva los pedidos
 * a domicilio que estaban esperando a alguien.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, cliente, CLIENTE_VALIDO } from './ayuda.mjs';

let srv, duena;

async function entrar(correo, clave) {
  const c = cliente(srv.base);
  const r = await c.pedir('/api/login', { metodo: 'POST', cuerpo: { correo, clave } });
  return r.estado === 200 ? c : null;
}

const crear = (quien, cuerpo) => quien.pedir('/api/admin/usuarios', { metodo: 'POST', cuerpo });

before(async () => {
  srv = await levantarServidor();
  duena = await entrar('qa@raizandina.pe', 'claveDePrueba2026');
  assert.ok(duena, 'no entró la dueña');
});

after(async () => { await srv?.parar(); });

describe('La dueña crea accesos de ventas y reparto', () => {
  let pedidoEsperando;

  before(async () => {
    // Un pedido a domicilio antes de que exista ningún motorizado: queda libre.
    const producto = (await duena.pedir('/api/admin/productos')).json
      .find((p) => p.stock > 20 && p.activo === 1);
    const r = await cliente(srv.base).pedir('/api/pedidos', {
      metodo: 'POST',
      cuerpo: { cliente: CLIENTE_VALIDO, items: [{ id: producto.id, cantidad: 1 }] },
    });
    assert.equal(r.estado, 201, JSON.stringify(r.json));
    pedidoEsperando = r.json.pedido;
    const enLista = (await duena.pedir('/api/pedidos')).json.find((x) => x.id === pedidoEsperando.id);
    assert.equal(enLista.repartidor, '');
  });

  test('crea un motorizado, que entra y se lleva lo que esperaba', async () => {
    const r = await crear(duena, {
      nombre: 'Lucho Mamani', correo: 'Lucho@RaizAndina.pe', clave: 'claveDeLucho01', rol: 'reparto',
    });
    assert.equal(r.estado, 201, JSON.stringify(r.json));
    assert.equal(r.json.usuario.usuario, 'lucho');
    assert.equal(r.json.usuario.email, 'lucho@raizandina.pe');
    assert.equal(r.json.usuario.rol, 'reparto');
    assert.equal(r.json.repartidos, 1);
    assert.ok(!('hash' in r.json.usuario) && !('salt' in r.json.usuario), 'devuelve el hash de la clave');

    const lucho = await entrar('lucho@raizandina.pe', 'claveDeLucho01');
    assert.ok(lucho, 'el acceso nuevo no puede entrar');
    const suyos = (await lucho.pedir('/api/pedidos')).json;
    assert.equal(suyos.find((p) => p.id === pedidoEsperando.id)?.repartidor, 'lucho');
  });

  test('crea un acceso de ventas; un nombre repetido lleva número', async () => {
    const r = await crear(duena, {
      nombre: 'Lucía Quispe', correo: 'lucia@raizandina.pe', clave: 'claveDeLucia1', rol: 'vendedor',
    });
    assert.equal(r.estado, 201, JSON.stringify(r.json));
    assert.equal(r.json.usuario.usuario, 'lucia');

    const otra = await crear(duena, {
      nombre: 'Lucía Flores', correo: 'lucia.f@raizandina.pe', clave: 'claveDeLucia2', rol: 'vendedor',
    });
    assert.equal(otra.estado, 201, JSON.stringify(otra.json));
    assert.equal(otra.json.usuario.usuario, 'lucia2');
  });

  test('los lista, sin claves', async () => {
    const r = await duena.pedir('/api/admin/usuarios');
    assert.equal(r.estado, 200);
    const correos = r.json.usuarios.map((u) => u.email);
    assert.ok(correos.includes('lucho@raizandina.pe') && correos.includes('lucia@raizandina.pe'));
    assert.ok(r.json.usuarios.every((u) => !('hash' in u) && !('salt' in u)));
  });

  test('no crea otra dueña ni papeles inventados', async () => {
    for (const rol of ['admin', 'jefe', '']) {
      const r = await crear(duena, { nombre: 'Alguien', correo: `x${rol}@raizandina.pe`, clave: 'claveLarga01', rol });
      assert.equal(r.estado, 400, `rol «${rol}»: ${JSON.stringify(r.json)}`);
    }
  });

  test('pide correo válido, clave de 8 y correo sin repetir', async () => {
    const base = { nombre: 'Pepe', correo: 'pepe@raizandina.pe', clave: 'claveDePepe01', rol: 'reparto' };
    assert.equal((await crear(duena, { ...base, correo: 'pepe' })).estado, 400);
    assert.equal((await crear(duena, { ...base, clave: 'corta' })).estado, 400);
    assert.equal((await crear(duena, { ...base, nombre: ' ' })).estado, 400);
    assert.equal((await crear(duena, { ...base, correo: 'lucho@raizandina.pe' })).estado, 409);
  });

  test('edita nombre, correo, papel y clave', async () => {
    const editar = (usuario, cuerpo) => duena.pedir('/api/admin/usuarios/' + usuario, { metodo: 'PATCH', cuerpo });
    const r = await editar('lucia2', { nombre: 'Lucía Flores Paz', correo: 'lflores@raizandina.pe' });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.usuario.nombre, 'Lucía Flores Paz');
    assert.equal(r.json.usuario.email, 'lflores@raizandina.pe');
    assert.equal(r.json.usuario.usuario, 'lucia2', 'el usuario corto no cambia: firma el historial');

    // Clave vacía no la toca; una nueva la cambia.
    assert.ok(await entrar('lflores@raizandina.pe', 'claveDeLucia2'));
    assert.equal((await editar('lucia2', { clave: 'claveNueva2026' })).estado, 200);
    assert.equal(await entrar('lflores@raizandina.pe', 'claveDeLucia2'), null);
    assert.ok(await entrar('lflores@raizandina.pe', 'claveNueva2026'));

    // Papel y validaciones.
    assert.equal((await editar('lucia2', { rol: 'reparto' })).json.usuario.rol, 'reparto');
    assert.equal((await editar('lucia2', { rol: 'admin' })).estado, 400);
    assert.equal((await editar('lucia2', { correo: 'lucho@raizandina.pe' })).estado, 409);
    assert.equal((await editar('lucia2', { clave: 'corta' })).estado, 400);
    assert.equal((await editar('nadie', { nombre: 'X y' })).estado, 404);
  });

  test('la dueña no se edita ni se elimina desde el panel', async () => {
    const admin = (await duena.pedir('/api/admin/usuarios')).json.usuarios.find((u) => u.rol === 'admin');
    assert.equal((await duena.pedir('/api/admin/usuarios/' + admin.usuario, { metodo: 'PATCH', cuerpo: { rol: 'vendedor' } })).estado, 403);
    assert.equal((await duena.pedir('/api/admin/usuarios/' + admin.usuario, { metodo: 'DELETE' })).estado, 403);
  });

  test('eliminar corta el acceso, reparte sus pedidos y no reutiliza su firma', async () => {
    // lucia2 ahora es de reparto: le toca un pedido y luego se elimina.
    const producto = (await duena.pedir('/api/admin/productos')).json.find((p) => p.stock > 20 && p.activo === 1);
    const lucia2 = await entrar('lflores@raizandina.pe', 'claveNueva2026');
    const pedido = (await cliente(srv.base).pedir('/api/pedidos', {
      metodo: 'POST', cuerpo: { cliente: CLIENTE_VALIDO, items: [{ id: producto.id, cantidad: 1 }] },
    })).json.pedido;
    assert.equal((await duena.pedir(`/api/pedidos/${pedido.id}/repartidor`, { metodo: 'PATCH', cuerpo: { repartidor: 'lucia2' } })).estado, 200);
    // Y deja algo firmado: lo pasa a «en preparación».
    const movido = await lucia2.pedir(`/api/pedidos/${pedido.id}/estado`, { metodo: 'PATCH', cuerpo: { estado: 'preparando' } });
    assert.equal(movido.estado, 200, JSON.stringify(movido.json));

    const r = await duena.pedir('/api/admin/usuarios/lucia2', { metodo: 'DELETE' });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.ok(r.json.repartidos >= 1);
    assert.equal((await lucia2.pedir('/api/pedidos')).estado, 401, 'su sesión sigue abierta');
    const enLista = (await duena.pedir('/api/pedidos')).json.find((x) => x.id === pedido.id);
    assert.equal(enLista.repartidor, 'lucho');

    const nueva = await crear(duena, { nombre: 'Lucía Ramos', correo: 'lramos@raizandina.pe', clave: 'claveDeLucia3', rol: 'vendedor' });
    assert.equal(nueva.estado, 201);
    assert.notEqual(nueva.json.usuario.usuario, 'lucia2', 'heredó la firma de alguien eliminado');
  });

  test('no se elimina ni se saca del reparto a quien tiene pedidos en camino', async () => {
    const r = await crear(duena, { nombre: 'Juan Soto', correo: 'juan@raizandina.pe', clave: 'claveDeJuan01', rol: 'reparto' });
    assert.equal(r.estado, 201, JSON.stringify(r.json));
    const juan = r.json.usuario.usuario;
    const producto = (await duena.pedir('/api/admin/productos')).json.find((p) => p.stock > 20 && p.activo === 1);
    const pedido = (await cliente(srv.base).pedir('/api/pedidos', {
      metodo: 'POST', cuerpo: { cliente: CLIENTE_VALIDO, items: [{ id: producto.id, cantidad: 1 }] },
    })).json.pedido;
    assert.equal((await duena.pedir(`/api/pedidos/${pedido.id}/repartidor`, { metodo: 'PATCH', cuerpo: { repartidor: juan } })).estado, 200);
    assert.equal((await duena.pedir(`/api/pedidos/${pedido.id}/estado`, { metodo: 'PATCH', cuerpo: { estado: 'enviado' } })).estado, 200);

    const borrar = await duena.pedir('/api/admin/usuarios/' + juan, { metodo: 'DELETE' });
    assert.equal(borrar.estado, 409, JSON.stringify(borrar.json));
    assert.deepEqual(borrar.json.en_camino, [pedido.codigo]);
    const aVentas = await duena.pedir('/api/admin/usuarios/' + juan, { metodo: 'PATCH', cuerpo: { rol: 'vendedor' } });
    assert.equal(aVentas.estado, 409);
    // El nombre sí se puede corregir aunque esté en ruta.
    assert.equal((await duena.pedir('/api/admin/usuarios/' + juan, { metodo: 'PATCH', cuerpo: { nombre: 'Juan Soto R.' } })).estado, 200);

    // Reasignado, ya se puede.
    assert.equal((await duena.pedir(`/api/pedidos/${pedido.id}/repartidor`, { metodo: 'PATCH', cuerpo: { repartidor: 'lucho' } })).estado, 200);
    assert.equal((await duena.pedir('/api/admin/usuarios/' + juan, { metodo: 'DELETE' })).estado, 200);
  });

  test('ventas y reparto no crean ni ven accesos', async () => {
    const lucia = await entrar('lucia@raizandina.pe', 'claveDeLucia1');
    const lucho = await entrar('lucho@raizandina.pe', 'claveDeLucho01');
    for (const quien of [lucia, lucho]) {
      assert.equal((await quien.pedir('/api/admin/usuarios')).estado, 403);
      const r = await crear(quien, { nombre: 'Colado', correo: 'colado@raizandina.pe', clave: 'claveLarga01', rol: 'reparto' });
      assert.equal(r.estado, 403);
      assert.equal((await quien.pedir('/api/admin/usuarios/lucia', { metodo: 'DELETE' })).estado, 403);
      assert.equal((await quien.pedir('/api/admin/usuarios/lucia', { metodo: 'PATCH', cuerpo: { rol: 'reparto' } })).estado, 403);
    }
    assert.equal((await cliente(srv.base).pedir('/api/admin/usuarios')).estado, 401);
  });
});
