/**
 * Seguimiento del pedido y constancia de recepción.
 *
 * El punto delicado es el control de acceso: el código solo no puede bastar
 * para ver el pedido de otra persona.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, cliente, CLIENTE_VALIDO } from './ayuda.mjs';

let srv, admin;
before(async () => {
  srv = await levantarServidor();
  admin = cliente(srv.base);
  await admin.pedir('/api/login', {
    metodo: 'POST', cuerpo: { correo: 'qa@raizandina.pe', clave: 'claveDePrueba2026' },
  });
});
after(async () => { await srv?.parar(); });

const comprar = async (extra = {}) => {
  const r = await cliente(srv.base).pedir('/api/pedidos', {
    metodo: 'POST',
    cuerpo: { cliente: { ...CLIENTE_VALIDO, ...extra }, items: [{ id: 9, cantidad: 1 }] },
  });
  assert.equal(r.estado, 201, r.json?.error);
  return r.json.pedido;
};

const seguir = (codigo, telefono, ruta = '/api/seguimiento') =>
  cliente(srv.base).pedir(ruta, { metodo: 'POST', cuerpo: { codigo, telefono } });

describe('Acceso al seguimiento', () => {
  test('con código y últimos 4 del teléfono, se ve el pedido', async () => {
    const p = await comprar();
    const r = await seguir(p.codigo, '1447');
    assert.equal(r.estado, 200);
    assert.equal(r.json.codigo, p.codigo);
    assert.equal(r.json.estado, 'pendiente');
  });

  test('el teléfono completo también sirve', async () => {
    const p = await comprar();
    const r = await seguir(p.codigo, '956231447');
    assert.equal(r.estado, 200);
  });

  test('con el código pero SIN el teléfono correcto, no se ve nada', async () => {
    const p = await comprar();
    for (const tel of ['9999', '0000', '', '123']) {
      const r = await seguir(p.codigo, tel);
      assert.equal(r.estado, 404, `entró con teléfono "${tel}"`);
      assert.ok(!r.texto.includes(p.codigo), 'filtró el código en el error');
    }
  });

  test('el error es idéntico para código falso y teléfono falso', async () => {
    const p = await comprar();
    const malTel = await seguir(p.codigo, '9999');
    const malCod = await seguir('RA-20260101-ZZZ', '1447');
    assert.equal(malTel.estado, malCod.estado);
    assert.equal(malTel.json.error, malCod.json.error,
      'mensajes distintos permitirían averiguar qué códigos existen');
  });

  test('nunca devuelve el teléfono ni la dirección completa', async () => {
    const p = await comprar();
    const r = await seguir(p.codigo, '1447');
    assert.ok(!r.texto.includes(CLIENTE_VALIDO.telefono), 'filtró el teléfono');
    assert.ok(!r.texto.includes(CLIENTE_VALIDO.direccion), 'filtró la dirección completa');
    assert.match(r.json.direccion, /…$/, 'la dirección debería ir recortada');
  });

  test('probar códigos en masa acaba bloqueado', async () => {
    const srv2 = await levantarServidor({ limites: true });
    try {
      const c = cliente(srv2.base);
      let bloqueado = false;
      for (let i = 0; i < 30; i++) {
        const r = await c.pedir('/api/seguimiento', {
          metodo: 'POST',
          cuerpo: { codigo: `RA-20260101-A${String(i).padStart(2, '0')}`, telefono: '1447' },
        });
        if (r.estado === 429) { bloqueado = true; break; }
      }
      assert.ok(bloqueado, 'se pueden probar códigos sin límite');
    } finally {
      await srv2.parar();
    }
  });
});

describe('Estado que ve el cliente', () => {
  test('refleja el avance que marca el panel', async () => {
    const p = await comprar();
    for (const estado of ['preparando', 'enviado', 'entregado']) {
      await admin.pedir(`/api/pedidos/${p.id}/estado`, { metodo: 'PATCH', cuerpo: { estado } });
      const r = await seguir(p.codigo, '1447');
      assert.equal(r.json.estado, estado);
    }
  });

  test('muestra el comprobante emitido', async () => {
    const p = await comprar();
    const r = await seguir(p.codigo, '1447');
    assert.equal(r.json.comprobante, p.numeroComprobante);
    assert.ok(['boleta', 'factura'].includes(r.json.tipoComprobante));
  });

  test('el desglose cuadra con lo cobrado', async () => {
    const p = await comprar();
    const r = await seguir(p.codigo, '1447');
    assert.equal(r.json.total, p.total);
    assert.equal(+(r.json.subtotal + r.json.envio).toFixed(2), r.json.total);
  });
});

describe('Constancia de recepción', () => {
  test('confirmar marca el pedido como entregado y deja fecha', async () => {
    const p = await comprar();
    await admin.pedir(`/api/pedidos/${p.id}/estado`, { metodo: 'PATCH', cuerpo: { estado: 'enviado' } });

    const r = await seguir(p.codigo, '1447', '/api/seguimiento/recibido');
    assert.equal(r.estado, 200);
    assert.equal(r.json.estado, 'entregado');
    assert.ok(r.json.recibidoEn, 'no registró cuándo se confirmó');
  });

  test('la constancia queda guardada y el panel la ve', async () => {
    const p = await comprar();
    await seguir(p.codigo, '1447', '/api/seguimiento/recibido');

    const lista = (await admin.pedir('/api/pedidos')).json;
    const enPanel = lista.find((x) => x.codigo === p.codigo);
    assert.ok(enPanel.recibido_en, 'el panel no ve la constancia');
    assert.ok(enPanel.recibido_por, 'no consta quién confirmó');
  });

  test('confirmar dos veces no cambia la fecha original', async () => {
    const p = await comprar();
    const a = await seguir(p.codigo, '1447', '/api/seguimiento/recibido');
    const b = await seguir(p.codigo, '1447', '/api/seguimiento/recibido');
    assert.equal(a.json.recibidoEn, b.json.recibidoEn);
  });

  test('un pedido anulado no se puede confirmar como recibido', async () => {
    const p = await comprar();
    await admin.pedir(`/api/pedidos/${p.id}/estado`, { metodo: 'PATCH', cuerpo: { estado: 'anulado' } });
    const r = await seguir(p.codigo, '1447', '/api/seguimiento/recibido');
    assert.equal(r.estado, 409);
  });

  test('no se puede confirmar el pedido de otro', async () => {
    const p = await comprar();
    const r = await seguir(p.codigo, '0000', '/api/seguimiento/recibido');
    assert.equal(r.estado, 404);
    const real = await seguir(p.codigo, '1447');
    assert.ok(!real.json.recibidoEn, 'lo confirmó igual');
  });
});

describe('El comprador imprime su propia boleta', () => {
  const suyo = (codigo, telefono) =>
    cliente(srv.base).pedir('/api/seguimiento/comprobante',
      { metodo: 'POST', cuerpo: { codigo, telefono } });

  test('con su código y su teléfono recibe el comprobante completo', async () => {
    const p = await comprar();
    const r = await suyo(p.codigo, '1447');
    assert.equal(r.estado, 200, r.json?.error);
    assert.equal(r.json.numero, p.numeroComprobante);
    assert.ok(r.json.emisor.ruc, 'sin RUC del emisor no sirve como comprobante');
    assert.ok(r.json.items.length, 'sin detalle de lo comprado');
    assert.equal(r.json.totales.total, p.total, 'el impreso no cuadra con lo cobrado');
  });

  test('los importes son los mismos que ve la tienda', async () => {
    const p = await comprar();
    const delCliente = (await suyo(p.codigo, '1447')).json;

    const lista = (await admin.pedir('/api/admin/comprobantes')).json;
    const enPanel = lista.find((c) => c.numero === p.numeroComprobante);
    const deLaTienda = (await admin.pedir(`/api/comprobantes/${enPanel.id}`)).json;

    assert.deepEqual(delCliente.totales, deLaTienda.totales,
      'el cliente y la tienda ven cifras distintas del mismo documento');
  });

  test('la factura con RUC lleva la razón social', async () => {
    const p = await comprar({ tipo_doc: 'RUC', num_doc: '20512345671',
      razon_social: 'Distribuidora Los Andes S.A.C.' });
    const r = await suyo(p.codigo, '1447');
    assert.equal(r.estado, 200, r.json?.error);
    assert.equal(r.json.tipoDoc, '01', 'con RUC tiene que salir factura');
    assert.match(r.json.cliente.nombre, /Distribuidora Los Andes/);
    assert.equal(r.json.cliente.numDoc, '20512345671');
  });

  test('el XML no se entrega al comprador', async () => {
    const p = await comprar();
    const r = await suyo(p.codigo, '1447');
    assert.ok(!('xml' in r.json), 'le entregó el XML, que es del emisor');
    assert.ok(!r.texto.includes('<Invoice'), 'coló el XML dentro de la respuesta');
  });

  test('sin el teléfono correcto no se llega al comprobante', async () => {
    const p = await comprar();
    for (const tel of ['9999', '', '123']) {
      const r = await suyo(p.codigo, tel);
      assert.equal(r.estado, 404, `entró con teléfono "${tel}"`);
      assert.ok(!r.texto.includes(p.numeroComprobante), 'filtró el número del comprobante');
    }
  });

  test('no se puede sacar el comprobante de otro con solo el código', async () => {
    const ajeno = await comprar({ telefono: '987654321' });
    const r = await suyo(ajeno.codigo, '1447');
    assert.equal(r.estado, 404);
  });

  test('la página del comprobante se sirve sin sesión, pero vacía', async () => {
    const anon = cliente(srv.base);
    const pagina = await anon.pedir('/comprobante.html');
    assert.equal(pagina.estado, 200, 'el cliente no puede ni abrir la página');
    assert.ok(!pagina.texto.includes('cliente_tel'), 'la página trae datos dentro');

    // El armazón es público; los datos, no.
    const sinNada = await anon.pedir('/api/comprobantes/1');
    assert.equal(sinNada.estado, 401, 'el detalle del comprobante quedó abierto');
  });

  test('probar comprobantes en masa acaba bloqueado', async () => {
    const srv2 = await levantarServidor({ limites: true });
    try {
      const c = cliente(srv2.base);
      let bloqueado = false;
      for (let i = 0; i < 30; i++) {
        const r = await c.pedir('/api/seguimiento/comprobante', {
          metodo: 'POST',
          cuerpo: { codigo: `RA-20260101-B${String(i).padStart(2, '0')}`, telefono: '1447' },
        });
        if (r.estado === 429) { bloqueado = true; break; }
      }
      assert.ok(bloqueado, 'se pueden probar códigos sin límite');
    } finally {
      await srv2.parar();
    }
  });
});
