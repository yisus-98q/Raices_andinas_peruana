/**
 * Checkout peruano: documento, comprobante y ubigeo.
 *
 * Todo se prueba contra el SERVIDOR, no contra el formulario: lo que el
 * navegador valida es comodidad; lo que decide es el backend, porque estos
 * datos terminan en un comprobante.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, cliente } from './ayuda.mjs';
import { validarRuc, validarDni, digitoVerificadorRuc, validarTelefono, validarCorreo } from '../documentos.js';
import { validarUbigeo, zonaDe } from '../ubigeo.js';
import { TIENDA } from '../tienda.config.js';

let srv;
before(async () => { srv = await levantarServidor(); });
after(async () => { await srv?.parar(); });

const BASE = {
  nombre: 'Rosa Huamán', telefono: '956231447', email: 'rosa@correo.com',
  direccion: 'Av. Canto Grande 1120', referencia: 'Frente al parque',
  departamento: 'Lima', provincia: 'Lima', distrito: 'Breña',
  tipo_doc: 'DNI', num_doc: '45678912',
};

const comprar = (extra = {}) => cliente(srv.base).pedir('/api/pedidos', {
  metodo: 'POST',
  cuerpo: { cliente: { ...BASE, ...extra }, items: [{ id: 1, cantidad: 1 }] },
});

describe('RUC — módulo 11', () => {
  test('acepta RUCs con dígito verificador correcto', () => {
    for (const base of ['2051234567', '1043210987', '2010000000', '1712345678']) {
      const ruc = base + digitoVerificadorRuc(base);
      assert.equal(validarRuc(ruc).ok, true, ruc + ' debería ser válido');
    }
  });

  test('rechaza un RUC con un dígito cambiado', () => {
    const base = '2051234567';
    const bueno = base + digitoVerificadorRuc(base);
    const malo = base + ((digitoVerificadorRuc(base) + 1) % 10);
    assert.equal(validarRuc(bueno).ok, true);
    assert.equal(validarRuc(malo).ok, false, 'el dígito verificador no se está comprobando');
  });

  test('rechaza prefijos que SUNAT no asigna', () => {
    for (const p of ['30', '00', '99', '11']) {
      const r = validarRuc(p + '512345671');
      assert.equal(r.ok, false, 'aceptó prefijo ' + p);
      assert.match(r.error, /empieza/);
    }
  });

  test('rechaza longitudes y basura', () => {
    for (const v of ['', '2051234567', '205123456789', 'abcdefghijk', null, undefined]) {
      assert.equal(validarRuc(v).ok, false, 'aceptó ' + String(v));
    }
  });

  test('el RUC del propio negocio es válido', () => {
    assert.equal(validarRuc(TIENDA.comprobante.ruc).ok, true,
      'el RUC de tienda.config.js no pasa la validación');
  });
});

describe('DNI, teléfono y correo', () => {
  test('DNI: ocho dígitos', () => {
    assert.equal(validarDni('45678912').ok, true);
    for (const v of ['1234567', '123456789', '00000000', 'abcdefgh', '']) {
      assert.equal(validarDni(v).ok, false, 'aceptó ' + v);
    }
  });

  test('teléfono: celular de 9 o fijo, tolerando formato', () => {
    for (const v of ['956231447', '+51 956 231 447', '51956231447', '956-231-447']) {
      const r = validarTelefono(v);
      assert.equal(r.ok, true, 'rechazó ' + v);
      assert.equal(r.valor, '956231447', 'no normalizó ' + v);
    }
    for (const v of ['123', '', '12345678901234']) {
      assert.equal(validarTelefono(v).ok, false, 'aceptó ' + v);
    }
  });

  test('correo: opcional para boleta, obligatorio para factura', () => {
    assert.equal(validarCorreo('', false).ok, true);
    assert.equal(validarCorreo('', true).ok, false);
    assert.equal(validarCorreo('rosa@correo.com').ok, true);
    assert.equal(validarCorreo('no-es-correo').ok, false);
    assert.equal(validarCorreo('a@b').ok, false);
  });
});

describe('Ubigeo', () => {
  test('acepta ternas reales, sin importar tildes ni mayúsculas', () => {
    for (const u of [
      { departamento: 'Lima', provincia: 'Lima', distrito: 'Breña' },
      { departamento: 'LIMA', provincia: 'lima', distrito: 'BREÑA' },
      { departamento: 'lima', provincia: 'Lima', distrito: 'brena' },
      { departamento: 'Arequipa', provincia: 'Arequipa', distrito: 'Cayma' },
      { departamento: 'Cusco', provincia: 'Cusco', distrito: 'Wanchaq' },
      { departamento: 'Loreto', provincia: 'Maynas', distrito: 'Iquitos' },
    ]) {
      assert.equal(validarUbigeo(u).ok, true, JSON.stringify(u));
    }
  });

  test('"Callao" funciona aunque el INEI lo llame de otra forma', () => {
    const r = validarUbigeo({ departamento: 'Callao', provincia: 'Callao', distrito: 'Bellavista' });
    assert.equal(r.ok, true, 'nadie escribe "Prov. Const. del Callao"');
    assert.match(r.valor.provincia, /Callao/);
  });

  test('rechaza una terna mal anidada', () => {
    // Cayma existe, pero en Arequipa. Que los tres nombres existan no basta.
    const r = validarUbigeo({ departamento: 'Lima', provincia: 'Lima', distrito: 'Cayma' });
    assert.equal(r.ok, false);
  });

  test('rechaza lo inventado y lo vacío', () => {
    for (const u of [
      { departamento: 'Narnia', provincia: 'Lima', distrito: 'Breña' },
      { departamento: 'Lima', provincia: 'Arequipa', distrito: 'Breña' },
      { departamento: 'Lima', provincia: 'Lima', distrito: 'Inventado' },
      { departamento: '', provincia: '', distrito: '' },
      {},
    ]) {
      assert.equal(validarUbigeo(u).ok, false, JSON.stringify(u));
    }
  });

  test('devuelve el código de ubigeo de 6 dígitos', () => {
    const r = validarUbigeo({ departamento: 'Lima', provincia: 'Lima', distrito: 'Breña' });
    assert.match(r.valor.codigo, /^\d{6}$/);
  });
});

describe('Zona y costo de envío', () => {
  const zona = (dep, prov, dist) => zonaDe(validarUbigeo(
    { departamento: dep, provincia: prov, distrito: dist }).valor);

  test('cada zona de Lima cobra lo que dice la configuración', () => {
    for (const z of TIENDA.delivery.zonas) {
      for (const d of z.distritos) {
        const r = zona('Lima', 'Lima', d);
        assert.equal(r.costo, z.costo, `${d} debería costar ${z.costo}`);
      }
    }
  });

  test('un distrito de Lima fuera de las zonas cae en la tarifa general', () => {
    const r = zona('Lima', 'Lima', 'Ancón');
    assert.equal(r.tipo, 'lima');
    assert.equal(r.costo, TIENDA.delivery.zonas.at(-1).costo);
  });

  test('fuera de Lima y Callao va por agencia, sin costo en el pedido', () => {
    for (const [dep, prov, dist] of [
      ['Arequipa', 'Arequipa', 'Cayma'],
      ['Cusco', 'Cusco', 'Wanchaq'],
      ['Loreto', 'Maynas', 'Iquitos'],
    ]) {
      const r = zona(dep, prov, dist);
      assert.equal(r.tipo, 'provincia');
      assert.equal(r.costo, null, 'el flete de agencia no debe ir en el pedido');
    }
  });

  test('/api/envio cotiza y avisa cuánto falta para el envío gratis', async () => {
    const c = cliente(srv.base);
    const umbral = TIENDA.delivery.gratisDesde;

    const bajo = await c.pedir('/api/envio', {
      metodo: 'POST',
      cuerpo: { departamento: 'Lima', provincia: 'Lima', distrito: 'Breña', subtotal: umbral - 30 },
    });
    assert.equal(bajo.json.gratis, false);
    assert.equal(bajo.json.faltaParaGratis, 30);

    const alto = await c.pedir('/api/envio', {
      metodo: 'POST',
      cuerpo: { departamento: 'Lima', provincia: 'Lima', distrito: 'Breña', subtotal: umbral },
    });
    assert.equal(alto.json.gratis, true);
    assert.equal(alto.json.costo, 0);
  });

  test('/api/envio rechaza un distrito inventado', async () => {
    const c = cliente(srv.base);
    const r = await c.pedir('/api/envio', {
      metodo: 'POST',
      cuerpo: { departamento: 'Lima', provincia: 'Lima', distrito: 'Inventado' },
    });
    assert.equal(r.estado, 400);
  });
});

describe('Pedido con datos peruanos', () => {
  test('DNI genera boleta y guarda el ubigeo', async () => {
    const r = await comprar();
    assert.equal(r.estado, 201);
    assert.equal(r.json.pedido.comprobante, 'boleta');
    assert.match(r.json.pedido.entrega, /Breña/);
  });

  test('RUC genera factura', async () => {
    const r = await comprar({
      tipo_doc: 'RUC', num_doc: '20512345671', razon_social: 'Bodega Los Andes S.A.C.',
    });
    assert.equal(r.estado, 201);
    assert.equal(r.json.pedido.comprobante, 'factura');
  });

  test('el envío lo calcula el SERVIDOR desde el distrito', async () => {
    const r = await comprar({ distrito: 'Breña' });
    const zonaCentro = TIENDA.delivery.zonas.find((z) => z.distritos.includes('Breña'));
    assert.equal(r.json.pedido.envio, zonaCentro.costo);
    assert.equal(r.json.pedido.total, +(r.json.pedido.subtotal + r.json.pedido.envio).toFixed(2));
  });

  test('a provincia el pedido no lleva costo de envío', async () => {
    const r = await comprar({ departamento: 'Cusco', provincia: 'Cusco', distrito: 'Wanchaq' });
    assert.equal(r.estado, 201);
    assert.equal(r.json.pedido.envio, 0, 'el flete de agencia lo paga el cliente en destino');
  });

  const RECHAZOS = [
    ['DNI corto', { num_doc: '123' }],
    ['DNI con letras', { num_doc: 'abcdefgh' }],
    ['RUC con dígito malo', { tipo_doc: 'RUC', num_doc: '20512345678', razon_social: 'X S.A.C.' }],
    ['factura sin razón social', { tipo_doc: 'RUC', num_doc: '20512345671' }],
    ['factura sin correo', { tipo_doc: 'RUC', num_doc: '20512345671', razon_social: 'X S.A.C.', email: '' }],
    ['tipo de documento inventado', { tipo_doc: 'PASAPORTE' }],
    ['distrito de otro departamento', { distrito: 'Cayma' }],
    ['departamento inventado', { departamento: 'Narnia' }],
    ['sin ubigeo', { departamento: '', provincia: '', distrito: '' }],
    ['teléfono inválido', { telefono: '123' }],
    ['correo mal formado', { email: 'no-es-correo' }],
    ['nombre de una letra', { nombre: 'A' }],
    ['dirección demasiado corta', { direccion: 'x' }],
  ];
  for (const [nombre, extra] of RECHAZOS) {
    test(`rechaza: ${nombre}`, async () => {
      const r = await comprar(extra);
      assert.equal(r.estado, 400, `aceptó "${nombre}"`);
      assert.ok(r.json.error, 'sin mensaje de error');
    });
  }

  test('el panel ve documento, comprobante y ubigeo', async () => {
    await comprar({
      tipo_doc: 'RUC', num_doc: '20512345671', razon_social: 'Bodega Los Andes S.A.C.',
    });
    const admin = cliente(srv.base);
    await admin.pedir('/api/login', {
      metodo: 'POST', cuerpo: { correo: 'qa@raizandina.pe', clave: 'claveDePrueba2026' },
    });
    const p = (await admin.pedir('/api/pedidos')).json[0];
    for (const campo of ['tipo_doc', 'num_doc', 'tipo_comprobante', 'departamento',
      'provincia', 'distrito', 'ubigeo', 'costo_envio']) {
      assert.ok(campo in p, `al panel le falta ${campo}`);
    }
    assert.equal(p.tipo_comprobante, 'factura');
    assert.match(p.ubigeo, /^\d{6}$/);
  });
});
