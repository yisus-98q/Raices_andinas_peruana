import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, cliente } from './ayuda.mjs';

let srv;
before(async () => { srv = await levantarServidor(); });
after(async () => { await srv?.parar(); });

const CORREO = 'qa@raizandina.pe';
const CLAVE = 'claveDePrueba2026';

describe('Autenticación', () => {
  test('login correcto con correo devuelve sesión', async () => {
    const c = cliente(srv.base);
    const r = await c.pedir('/api/login', { metodo: 'POST', cuerpo: { correo: CORREO, clave: CLAVE } });
    assert.equal(r.estado, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.usuario.email, CORREO);
  });

  test('login acepta el usuario corto además del correo', async () => {
    const c = cliente(srv.base);
    const r = await c.pedir('/api/login', { metodo: 'POST', cuerpo: { correo: 'admin', clave: CLAVE } });
    assert.equal(r.estado, 200);
  });

  test('login normaliza mayúsculas y espacios', async () => {
    const c = cliente(srv.base);
    const r = await c.pedir('/api/login', { metodo: 'POST', cuerpo: { correo: '  QA@RaizAndina.PE ', clave: CLAVE } });
    assert.equal(r.estado, 200);
  });

  test('contraseña incorrecta devuelve 401', async () => {
    const c = cliente(srv.base);
    const r = await c.pedir('/api/login', { metodo: 'POST', cuerpo: { correo: CORREO, clave: 'mala' } });
    assert.equal(r.estado, 401);
  });

  test('el error NO distingue entre cuenta inexistente y clave mala', async () => {
    const c = cliente(srv.base);
    const a = await c.pedir('/api/login', { metodo: 'POST', cuerpo: { correo: CORREO, clave: 'mala' } });
    const b = await c.pedir('/api/login', { metodo: 'POST', cuerpo: { correo: 'nadie@nada.com', clave: 'mala' } });
    assert.equal(a.json.error, b.json.error, 'mensajes distintos confirman qué cuentas existen');
  });

  test('campos vacíos no autentican', async () => {
    const c = cliente(srv.base);
    for (const cuerpo of [{}, { correo: '' }, { clave: '' }, { correo: '', clave: '' }]) {
      const r = await c.pedir('/api/login', { metodo: 'POST', cuerpo });
      assert.equal(r.estado, 401, JSON.stringify(cuerpo));
    }
  });

  test('la cookie es HttpOnly y SameSite=Strict', async () => {
    const r = await fetch(srv.base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo: CORREO, clave: CLAVE }),
    });
    const set = r.headers.get('set-cookie') || '';
    assert.match(set, /HttpOnly/i);
    assert.match(set, /SameSite=Strict/i);
  });

  test('token inventado no vale', async () => {
    for (const t of ['a'.repeat(64), 'abc', '', '../../etc']) {
      const r = await fetch(srv.base + '/api/sesion', { headers: { Cookie: 'ra_sesion=' + t } });
      assert.equal(r.status, 401, 'token: ' + t);
    }
  });

  test('logout invalida la cookie en el servidor', async () => {
    const c = cliente(srv.base);
    await c.pedir('/api/login', { metodo: 'POST', cuerpo: { correo: CORREO, clave: CLAVE } });
    const cookieVieja = c.cookie;
    await c.pedir('/api/logout', { metodo: 'POST' });
    const r = await fetch(srv.base + '/api/sesion', { headers: { Cookie: cookieVieja } });
    assert.equal(r.status, 401, 'la cookie vieja seguía sirviendo');
  });

  test('bloqueo por fuerza bruta tras 5 intentos, incluso con la clave buena', async () => {
    const c = cliente(srv.base);
    const usuario = 'admin';
    for (let i = 0; i < 5; i++) {
      await c.pedir('/api/login', { metodo: 'POST', cuerpo: { correo: usuario, clave: 'mala' + i } });
    }
    const r = await c.pedir('/api/login', { metodo: 'POST', cuerpo: { correo: usuario, clave: CLAVE } });
    assert.equal(r.estado, 401);
    assert.match(r.json.error, /intentos/i, 'debería avisar del bloqueo, no dar acceso');
  });
});

describe('Protección de rutas', () => {
  const PRIVADAS = [
    ['GET', '/api/pedidos'],
    ['GET', '/api/admin/resumen'],
    ['GET', '/api/admin/movimientos'],
    ['GET', '/api/admin/productos'],
    ['GET', '/api/admin/cambios'],
    ['POST', '/api/stock'],
    ['PATCH', '/api/productos/1'],
    ['PATCH', '/api/pedidos/1/estado'],
  ];

  for (const [metodo, ruta] of PRIVADAS) {
    test(`${metodo} ${ruta} exige sesión`, async () => {
      const c = cliente(srv.base);
      const r = await c.pedir(ruta, { metodo, cuerpo: metodo === 'GET' ? undefined : {} });
      assert.equal(r.estado, 401, `${metodo} ${ruta} quedó abierta`);
    });
  }

  const PUBLICAS = ['/', '/tienda', '/api/productos', '/api/tienda', '/creditos.html', '/login.html'];
  for (const ruta of PUBLICAS) {
    test(`${ruta} es pública`, async () => {
      const c = cliente(srv.base);
      const r = await c.pedir(ruta);
      assert.equal(r.estado, 200, `${ruta} dejó de ser pública`);
    });
  }

  test('/admin.html redirige al login sin sesión', async () => {
    const c = cliente(srv.base);
    const r = await c.pedir('/admin.html');
    assert.equal(r.estado, 302);
    assert.match(r.cabeceras.get('location'), /login\.html/);
  });

  test('/imagenes.html también está protegida', async () => {
    const c = cliente(srv.base);
    const r = await c.pedir('/imagenes.html');
    assert.equal(r.estado, 302);
  });
});
