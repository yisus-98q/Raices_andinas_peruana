import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, cliente, CLIENTE_VALIDO } from './ayuda.mjs';

let srv;
// Esta suite corre CON las cuotas activas: es lo que audita.
before(async () => { srv = await levantarServidor({ limites: true }); });
after(async () => { await srv?.parar(); });

describe('Datos personales de los clientes', () => {
  test('un extraño con el código de pedido NO obtiene el teléfono', async () => {
    const c = cliente(srv.base);
    const nuevo = await c.pedir('/api/pedidos', {
      metodo: 'POST',
      cuerpo: { cliente: CLIENTE_VALIDO, items: [{ id: 1, cantidad: 1 }] },
    });
    const codigo = nuevo.json.pedido.codigo;

    const extrano = cliente(srv.base);
    const r = await extrano.pedir('/api/asesor', {
      metodo: 'POST', cuerpo: { consulta: `mi pedido ${codigo} no llega` },
    });

    assert.ok(!r.texto.includes(CLIENTE_VALIDO.telefono),
      'la respuesta filtró el teléfono del cliente a quien solo tiene el código');
    assert.ok(!r.texto.includes('Canto Grande'),
      'la respuesta filtró la dirección del cliente');
  });

  test('el listado de pedidos no se filtra sin sesión', async () => {
    const c = cliente(srv.base);
    const r = await c.pedir('/api/pedidos');
    assert.equal(r.estado, 401);
    assert.ok(!r.texto.includes('956231447'));
  });

  test('probar códigos en masa acaba bloqueado', async () => {
    const c = cliente(srv.base);
    let bloqueado = false;
    for (let i = 0; i < 40; i++) {
      const r = await c.pedir('/api/asesor', {
        metodo: 'POST',
        cuerpo: { consulta: `mi pedido RA-20260101-A${String(i).padStart(2, '0')} no llega` },
      });
      if (r.estado === 429) { bloqueado = true; break; }
    }
    assert.ok(bloqueado, 'se pueden probar códigos sin límite: los pedidos son enumerables');
  });
});

describe('Cabeceras de seguridad', () => {
  test('la portada envía las cabeceras defensivas mínimas', async () => {
    const r = await fetch(srv.base + '/');
    const h = (n) => r.headers.get(n);
    assert.ok(h('content-security-policy'), 'falta Content-Security-Policy');
    assert.equal(h('x-content-type-options'), 'nosniff', 'falta X-Content-Type-Options');
    assert.ok(h('x-frame-options') || /frame-ancestors/.test(h('content-security-policy') || ''),
      'la página se puede meter en un iframe ajeno (clickjacking)');
    assert.ok(h('referrer-policy'), 'falta Referrer-Policy');
  });

  test('la API también las envía', async () => {
    const r = await fetch(srv.base + '/api/productos');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  });
});

describe('Entradas maliciosas', () => {
  test('el precio lo pone el servidor, no el navegador', async () => {
    const c = cliente(srv.base);
    const real = (await c.pedir('/api/productos/1')).json.precio;
    const r = await c.pedir('/api/pedidos', {
      metodo: 'POST',
      cuerpo: {
        cliente: CLIENTE_VALIDO,
        items: [{ id: 1, cantidad: 1, precio: 0.01 }],
        total: 0.01,
      },
    });
    // El subtotal es lo que sale del catálogo; el total suma el envío.
    assert.equal(r.json.pedido.subtotal, real);
  });

  test('no se puede salir de public/ con rutas relativas', async () => {
    for (const ruta of [
      '/../server.js', '/../../etc/passwd', '/css/../../auth.js',
      '/..%2fserver.js', '/../data/tienda.db', '/./../../package.json',
    ]) {
      const r = await fetch(srv.base + ruta, { redirect: 'manual' });
      assert.ok(r.status === 404 || r.status === 403 || r.status === 400,
        `${ruta} devolvió ${r.status}`);
      const t = await r.text();
      assert.ok(!t.includes('createServer'), `${ruta} sirvió código fuente`);
    }
  });

  test('el JSON roto no revela el interior del servidor', async () => {
    const r = await fetch(srv.base + '/api/asesor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{roto',
    });
    const t = await r.text();
    assert.ok(r.status >= 400);
    assert.ok(!/at .*\.js:\d+/.test(t), 'la respuesta trae una traza de pila');
  });

  test('el texto del cliente se guarda tal cual y se escapa al pintar', async () => {
    const c = cliente(srv.base);
    const veneno = '<img src=x onerror=alert(1)>';
    const r = await c.pedir('/api/pedidos', {
      metodo: 'POST',
      cuerpo: {
        cliente: { ...CLIENTE_VALIDO, nombre: 'Ana ' + veneno },
        items: [{ id: 2, cantidad: 1 }],
      },
    });
    assert.equal(r.estado, 201);

    const admin = cliente(srv.base);
    await admin.pedir('/api/login', {
      metodo: 'POST', cuerpo: { correo: 'qa@raizandina.pe', clave: 'claveDePrueba2026' },
    });
    const lista = (await admin.pedir('/api/pedidos')).json;
    assert.ok(lista.some((p) => p.cliente_nombre.includes(veneno)),
      'la API debe devolver el dato crudo; escapar es tarea de quien pinta');
  });

  test('el asesor no se traga una consulta gigante', async () => {
    const r = await fetch(srv.base + '/api/asesor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consulta: 'x'.repeat(2_000_000) }),
    }).catch(() => ({ status: 0 }));
    assert.ok(r.status !== 200, 'aceptó un cuerpo de 2 MB');
  });
});

describe('Abuso de endpoints públicos', () => {
  test('crear pedidos en ráfaga acaba bloqueado', async () => {
    const c = cliente(srv.base);
    let bloqueado = false;
    for (let i = 0; i < 30; i++) {
      const r = await c.pedir('/api/pedidos', {
        metodo: 'POST',
        cuerpo: { cliente: CLIENTE_VALIDO, items: [{ id: 19, cantidad: 1 }] },
      });
      if (r.estado === 429) { bloqueado = true; break; }
    }
    assert.ok(bloqueado, 'cualquiera puede llenar el panel de pedidos falsos');
  });
});
