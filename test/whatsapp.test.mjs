/**
 * Avisos al cliente por WhatsApp: confirmado, en camino y entregado.
 *
 * Tres partes: los textos (sin servidor), el modo manual que usa la demo —el
 * panel recibe el enlace wa.me listo— y el modo API contra un servidor falso
 * que hace de Meta, para no mandar mensajes de verdad desde los tests.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { levantarServidor, cliente, CLIENTE_VALIDO } from './ayuda.mjs';

delete process.env.WHATSAPP_TOKEN;
delete process.env.WHATSAPP_PHONE_ID;
const W = await import('../whatsapp.js');

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const PEDIDO = {
  codigo: 'RA-ABC123', cliente_nombre: 'Rosa Huamán', cliente_tel: '956 231 447',
  total: 84.5, modo_entrega: 'delivery', distrito: 'San Juan de Lurigancho', provincia: 'Lima',
};

describe('Los textos', () => {
  test('teléfono peruano con prefijo', () => {
    assert.equal(W.telefonoInternacional('956 231 447'), '51956231447');
    assert.equal(W.telefonoInternacional('+51 956231447'), '51956231447');
  });

  test('confirmado: nombre, código, total y enlace de seguimiento', () => {
    const t = W.mensaje('confirmado', PEDIDO);
    assert.match(t, /Rosa/);
    assert.ok(!t.includes('Huamán'), 'el saludo va solo con el nombre');
    assert.match(t, /RA-ABC123/);
    assert.match(t, /S\/ 84[.,]50/);
    assert.match(t, /mi-pedido\.html\?codigo=RA-ABC123/);
    assert.match(t, /San Juan de Lurigancho/);
    assert.ok(!/\{\w+\}/.test(t), 'quedó una variable sin reemplazar: ' + t);
  });

  test('en camino: dice quién lo lleva', () => {
    assert.match(W.mensaje('en_camino', PEDIDO, { repartidor: 'Lucho' }), /Lucho/);
    assert.match(W.mensaje('en_camino', PEDIDO), /nuestro repartidor/);
  });

  test('el enlace abre el chat del cliente con el texto', () => {
    const url = W.enlaceChat(PEDIDO, 'hola 🌿');
    assert.ok(url.startsWith('https://wa.me/51956231447?text='));
    assert.equal(decodeURIComponent(url.split('text=')[1]), 'hola 🌿');
  });

  test('sin credenciales, modo manual', () => {
    assert.equal(W.modo(), 'manual');
  });
});

function alta(srv, usuario, correo, nombre, clave, rol) {
  const r = spawnSync(process.execPath,
    ['clave.mjs', '--nuevo', usuario, correo, nombre, clave, rol],
    { cwd: RAIZ, env: { ...process.env, DB_PATH: srv.dbPath }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}

async function entrar(srv, correo, clave) {
  const c = cliente(srv.base);
  const r = await c.pedir('/api/login', { metodo: 'POST', cuerpo: { correo, clave } });
  assert.equal(r.estado, 200, JSON.stringify(r.json));
  return c;
}

async function nuevoPedido(srv, duena, aceptaWhatsapp = false) {
  const producto = (await duena.pedir('/api/admin/productos')).json
    .find((p) => p.stock > 10 && p.activo === 1);
  const r = await cliente(srv.base).pedir('/api/pedidos', {
    metodo: 'POST',
    cuerpo: {
      cliente: { ...CLIENTE_VALIDO, acepta_whatsapp: aceptaWhatsapp },
      items: [{ id: producto.id, cantidad: 1 }],
    },
  });
  assert.equal(r.estado, 201, JSON.stringify(r.json));
  return r.json.pedido;
}

const avisosDe = async (quien, id) =>
  (await quien.pedir('/api/pedidos')).json.find((p) => p.id === id)?.avisos;

describe('Modo manual: el panel manda con un toque', () => {
  let srv, duena, moto, pedido;

  before(async () => {
    srv = await levantarServidor();
    duena = await entrar(srv, 'qa@raizandina.pe', 'claveDePrueba2026');
    alta(srv, 'moto', 'moto@raizandina.pe', 'Lucho', 'claveDeLaMoto1', 'reparto');
    moto = await entrar(srv, 'moto@raizandina.pe', 'claveDeLaMoto1');
    pedido = await nuevoPedido(srv, duena);
  });
  after(async () => { await srv?.parar(); });

  test('el pedido nuevo deja listo el aviso de confirmación', async () => {
    const [a, ...otros] = await avisosDe(duena, pedido.id);
    assert.equal(otros.length, 0);
    assert.equal(a.evento, 'confirmado');
    assert.equal(a.estado, 'pendiente');
    assert.ok(a.enlace.startsWith('https://wa.me/51956231447?text='), a.enlace);
    assert.match(decodeURIComponent(a.enlace), new RegExp(pedido.codigo));
  });

  test('marcarlo enviado lo cierra y quita el enlace', async () => {
    const [a] = await avisosDe(duena, pedido.id);
    const r = await duena.pedir(`/api/avisos/${a.id}`, { metodo: 'PATCH' });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    const [cerrado] = await avisosDe(duena, pedido.id);
    assert.equal(cerrado.estado, 'enviado_manual');
    assert.ok(!('enlace' in cerrado));
  });

  test('en camino lleva el nombre del motorizado, una sola vez', async () => {
    await moto.pedir(`/api/pedidos/${pedido.id}/estado`, { metodo: 'PATCH', cuerpo: { estado: 'enviado' } });
    // Marcarlo otra vez no crea un segundo aviso.
    await duena.pedir(`/api/pedidos/${pedido.id}/estado`, { metodo: 'PATCH', cuerpo: { estado: 'enviado' } });
    const camino = (await avisosDe(moto, pedido.id)).filter((a) => a.evento === 'en_camino');
    assert.equal(camino.length, 1);
    assert.match(decodeURIComponent(camino[0].enlace), /Lucho/);
  });

  test('el motorizado puede mandar el suyo desde su teléfono', async () => {
    const camino = (await avisosDe(moto, pedido.id)).find((a) => a.evento === 'en_camino');
    const r = await moto.pedir(`/api/avisos/${camino.id}`, { metodo: 'PATCH' });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    assert.equal(r.json.enviado_por, 'moto');
    assert.ok(!('texto' in r.json));
  });

  test('entregado cierra la serie', async () => {
    await moto.pedir(`/api/pedidos/${pedido.id}/estado`, { metodo: 'PATCH', cuerpo: { estado: 'entregado' } });
    const eventos = (await avisosDe(duena, pedido.id)).map((a) => a.evento);
    assert.deepEqual(eventos, ['confirmado', 'en_camino', 'entregado']);
  });

  test('la venta del mostrador no genera avisos', async () => {
    const producto = (await duena.pedir('/api/admin/productos')).json
      .find((p) => p.stock > 10 && p.activo === 1);
    const r = await duena.pedir('/api/mostrador', {
      metodo: 'POST', cuerpo: { items: [{ id: producto.id, cantidad: 1 }] },
    });
    assert.ok(r.estado === 200 || r.estado === 201, JSON.stringify(r.json));
    const venta = (await duena.pedir('/api/pedidos')).json.find((p) => p.canal === 'mostrador');
    assert.ok(venta, 'no aparece la venta de mostrador');
    assert.deepEqual(venta.avisos, []);
  });

  test('sin sesión no se marca nada', async () => {
    const r = await cliente(srv.base).pedir('/api/avisos/1', { metodo: 'PATCH' });
    assert.equal(r.estado, 401);
  });
});

describe('Modo API: el servidor manda solo', () => {
  let srv, duena, falso, recibidos, pedido;

  before(async () => {
    recibidos = [];
    // Hace de la Cloud API: acepta todo menos el aviso de «en camino», para
    // probar también el camino del error.
    falso = createServer((req, res) => {
      let cuerpo = '';
      req.on('data', (b) => { cuerpo += b; });
      req.on('end', () => {
        const json = JSON.parse(cuerpo);
        recibidos.push({ url: req.url, auth: req.headers.authorization, json });
        const texto = json.text?.body || '';
        res.setHeader('Content-Type', 'application/json');
        if (texto.includes('en camino')) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: { message: 'Fuera de la ventana de 24 horas' } }));
        }
        res.end(JSON.stringify({ messages: [{ id: 'wamid.PRUEBA' + recibidos.length }] }));
      });
    });
    await new Promise((r) => falso.listen(0, '127.0.0.1', r));

    srv = await levantarServidor({
      env: {
        WHATSAPP_TOKEN: 'token-de-prueba',
        WHATSAPP_PHONE_ID: '1234567890',
        WHATSAPP_API_URL: `http://127.0.0.1:${falso.address().port}`,
        WHATSAPP_PLANTILLA_CONFIRMADO: 'pedido_confirmado',
      },
    });
    duena = await entrar(srv, 'qa@raizandina.pe', 'claveDePrueba2026');
    pedido = await nuevoPedido(srv, duena, true);
  });
  after(async () => {
    await srv?.parar();
    falso?.close();
  });

  test('sin la casilla marcada no se escribe solo: queda el botón manual', async () => {
    const antes = recibidos.length;
    const sinPermiso = await nuevoPedido(srv, duena, false);
    await espera(400);
    const [a] = await avisosDe(duena, sinPermiso.id);
    assert.equal(a.canal, 'manual');
    assert.equal(a.estado, 'pendiente');
    assert.ok(a.enlace?.startsWith('https://wa.me/'));
    const aEse = recibidos.slice(antes).filter((x) => JSON.stringify(x.json).includes(sinPermiso.codigo));
    assert.equal(aEse.length, 0, 'se le mandó un mensaje a quien no aceptó');
  });

  /** El envío va sin esperar a la respuesta del pedido: se da un margen. */
  async function hastaQue(condicion) {
    for (let i = 0; i < 40; i++) {
      const avisos = await avisosDe(duena, pedido.id);
      if (condicion(avisos)) return avisos;
      await espera(100);
    }
    return avisosDe(duena, pedido.id);
  }

  test('la confirmación sale como plantilla, con los parámetros en orden', async () => {
    const avisos = await hastaQue((l) => l[0]?.estado === 'enviado');
    assert.equal(avisos[0].estado, 'enviado');
    assert.equal(avisos[0].canal, 'api');

    const [envio] = recibidos;
    assert.equal(envio.url, '/1234567890/messages');
    assert.equal(envio.auth, 'Bearer token-de-prueba');
    assert.equal(envio.json.to, '51956231447');
    assert.equal(envio.json.type, 'template');
    assert.equal(envio.json.template.name, 'pedido_confirmado');
    const params = envio.json.template.components[0].parameters.map((p) => p.text);
    // Justo los de su plantilla: una cantidad distinta, Meta la rechaza.
    assert.equal(params.length, W.PARAMETROS_PLANTILLA.confirmado.length);
    assert.equal(params[0], 'Rosa');
    assert.equal(params[1], pedido.codigo);
    assert.match(params[2], /^S\/ /);
    assert.match(params[3], new RegExp(`codigo=${pedido.codigo}`));
  });

  test('si la API lo rechaza, queda en error y el panel ofrece el botón', async () => {
    const r = await duena.pedir(`/api/pedidos/${pedido.id}/estado`, {
      metodo: 'PATCH', cuerpo: { estado: 'enviado' },
    });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    const avisos = await hastaQue((l) => l.some((a) => a.evento === 'en_camino' && a.estado !== 'enviando'));
    const camino = avisos.find((a) => a.evento === 'en_camino');
    assert.equal(camino.estado, 'error');
    assert.ok(camino.enlace?.startsWith('https://wa.me/'), 'sin enlace para mandarlo a mano');
    // Sin plantilla configurada para este evento, fue como texto libre.
    assert.equal(recibidos.at(-1).json.type, 'text');
  });

  test('el panel sabe que está en modo API', async () => {
    const r = await duena.pedir('/api/admin/repartidores');
    assert.equal(r.json.avisos, 'api');
  });
});
