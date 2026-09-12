import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { levantarServidor, cliente, CLIENTE_VALIDO } from './ayuda.mjs';

let srv, admin;
before(async () => {
  srv = await levantarServidor();
  admin = cliente(srv.base);
  await admin.pedir('/api/login', {
    metodo: 'POST',
    cuerpo: { correo: 'qa@raizandina.pe', clave: 'claveDePrueba2026' },
  });
});
after(async () => { await srv?.parar(); });

const comprar = (items, extra = {}) => cliente(srv.base).pedir('/api/pedidos', {
  metodo: 'POST',
  cuerpo: { cliente: CLIENTE_VALIDO, items, ...extra },
});

const producto = async (id) => (await cliente(srv.base).pedir('/api/productos/' + id)).json;

describe('Código de pedido repetido', () => {
  // El código tiene tres caracteres para poder dictarlo por teléfono: 36³ =
  // 46 656 por fecha. Con el índice único de `pedidos.codigo`, dos pedidos
  // del mismo día que sacaran el mismo código daban `500` y la venta se
  // perdía — con 150 pedidos en una fecha eso pasaba más de una vez de cada
  // cinco. Ahora el servidor reintenta con otro código.
  //
  // Para provocarlo sin esperar a que la suerte lo haga: se ocupa un cuarto
  // del espacio de hoy por debajo de la API. Así cada pedido choca al menos
  // una vez con probabilidad 1/4 —sobre 25 pedidos, prácticamente seguro— y
  // agotar los ocho reintentos es 1 entre 15 000 millones.
  test('con el espacio de códigos de hoy a un cuarto, las ventas siguen entrando', async () => {
    const ALFABETO = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const fecha = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;

    const base = new DatabaseSync(srv.dbPath);
    const ins = base.prepare(
      `INSERT OR IGNORE INTO pedidos (codigo, cliente_nombre, cliente_tel, cliente_dir, total)
       VALUES (?, 'ocupado', '999999999', 'ocupado', 0)`);
    base.exec('BEGIN IMMEDIATE');
    for (const a of ALFABETO) {
      for (const b of ALFABETO) {
        // 9 de las 36 terceras letras: un cuarto del espacio de la fecha.
        for (const c of ALFABETO.slice(0, 9)) ins.run(`RA-${fecha}-${a}${b}${c}`);
      }
    }
    base.exec('COMMIT');

    const codigos = new Set();
    for (let i = 0; i < 25; i++) {
      const r = await comprar([{ id: 1, cantidad: 1 }]);
      assert.equal(r.estado, 201, 'el pedido ' + i + ' se cayó: ' + r.json?.error);
      assert.match(r.json.pedido.codigo, /^RA-\d{8}-[A-Z0-9]{3}$/);
      codigos.add(r.json.pedido.codigo);
    }
    assert.equal(codigos.size, 25, 'dos pedidos salieron con el mismo código');

    // Se libera el espacio: el resto del archivo comparte esta misma base y
    // no tiene por qué correr contra una fecha llena.
    base.exec("DELETE FROM pedidos WHERE cliente_nombre = 'ocupado'");
    base.close();
  });
});

describe('Crear pedido — datos válidos', () => {
  test('un pedido correcto devuelve 201 y código', async () => {
    const r = await comprar([{ id: 1, cantidad: 2 }]);
    assert.equal(r.estado, 201);
    assert.equal(r.json.ok, true);
    assert.match(r.json.pedido.codigo, /^RA-\d{8}-[A-Z0-9]{3}$/);
    assert.equal(r.json.pedido.estado, 'pendiente');
  });

  test('el total lo calcula el SERVIDOR, no el cliente', async () => {
    const p = await producto(1);
    const r = await comprar(
      [{ id: 1, cantidad: 2, precio: 0.01, subtotal: 0.02 }],
      { total: 0.02 },
    );
    assert.equal(r.estado, 201);
    // Se compara el SUBTOTAL: el total ya incluye el envío que calcula el
    // servidor a partir del distrito.
    assert.equal(r.json.pedido.subtotal, +(p.precio * 2).toFixed(2),
      'el servidor aceptó el precio que mandó el navegador');
  });

  test('cantidades repetidas del mismo producto se consolidan', async () => {
    const antes = (await producto(9)).stock;
    const r = await comprar([{ id: 9, cantidad: 1 }, { id: 9, cantidad: 2 }]);
    assert.equal(r.estado, 201);
    const despues = (await producto(9)).stock;
    assert.equal(antes - despues, 3, 'debería descontar 3 en total');
  });
});

describe('Recojo en el local', () => {
  /**
   * Media clientela del puesto vive a unas cuadras del mercado.
   *
   * Hasta ahora el checkout le exigía departamento, provincia, distrito y
   * dirección a esa persona, y encima le sumaba el flete de su zona por algo
   * que iba a ir a buscar. Lo que se prueba aquí es que con `entrega: 'recojo'`
   * el pedido entra sin nada de eso y sin flete, y que el 0 del envío viene del
   * recojo y no de que el servidor haya dejado de cobrar envíos.
   */
  const SIN_DIRECCION = {
    nombre: 'Rosa Huamán',
    telefono: '956231447',
    tipo_doc: 'DNI',
    num_doc: '45678912',
  };

  const recoger = (items) => cliente(srv.base).pedir('/api/pedidos', {
    metodo: 'POST',
    cuerpo: { cliente: SIN_DIRECCION, items, entrega: 'recojo' },
  });

  // El más barato con stock: garantiza quedar por debajo del umbral de envío
  // gratis, que es lo único que hace comparables el recojo y el envío.
  const masBarato = async () => {
    const aptos = (await cliente(srv.base).pedir('/api/productos')).json
      .filter((p) => p.stock > 2);
    return aptos.reduce((a, b) => (b.precio < a.precio ? b : a));
  };

  test('entra sin dirección ni distrito, y no paga envío', async () => {
    const p = await masBarato();
    const r = await recoger([{ id: p.id, cantidad: 2 }]);

    assert.equal(r.estado, 201, JSON.stringify(r.json));
    assert.equal(r.json.pedido.modoEntrega, 'recojo');
    assert.equal(r.json.pedido.envio, 0);
    assert.equal(r.json.pedido.total, +(p.precio * 2).toFixed(2),
      'el total del recojo tiene que ser el subtotal pelado');
  });

  test('el pedido queda guardado con los datos del local', async () => {
    const p = await masBarato();
    const r = await recoger([{ id: p.id, cantidad: 1 }]);
    assert.equal(r.estado, 201, JSON.stringify(r.json));

    const guardado = (await admin.pedir('/api/pedidos')).json
      .find((x) => x.id === r.json.pedido.id);

    assert.equal(guardado.modo_entrega, 'recojo');
    assert.equal(guardado.costo_envio, 0);
    // Sin ubigeo el pedido quedaría fuera de cualquier corte por zona, así que
    // se guarda el del local: es donde va a ocurrir la entrega.
    assert.ok(guardado.distrito, 'un recojo sin distrito se pierde en los cortes');
    assert.ok(guardado.cliente_dir.length > 5, 'la dirección del local tiene que estar');
  });

  test('el mismo carrito, pero con envío, sí paga flete', async () => {
    const p = await masBarato();
    assert.ok(p.precio * 2 < 120,
      'la prueba necesita quedar debajo del umbral de envío gratis');

    const r = await comprar([{ id: p.id, cantidad: 2 }]);
    assert.equal(r.estado, 201, JSON.stringify(r.json));
    assert.ok(r.json.pedido.envio > 0,
      'si el envío también sale 0, el 0 del recojo no prueba nada');
  });

  test('sin `entrega: recojo` la dirección sigue siendo obligatoria', async () => {
    const r = await cliente(srv.base).pedir('/api/pedidos', {
      metodo: 'POST',
      cuerpo: { cliente: SIN_DIRECCION, items: [{ id: 1, cantidad: 1 }] },
    });
    assert.equal(r.estado, 400, JSON.stringify(r.json));
  });
});

describe('Crear pedido — datos inválidos', () => {
  const CASOS = [
    ['carrito vacío', []],
    ['cantidad negativa', [{ id: 1, cantidad: -1 }]],
    ['cantidad cero', [{ id: 1, cantidad: 0 }]],
    ['cantidad decimal', [{ id: 1, cantidad: 1.5 }]],
    ['producto inexistente', [{ id: 99999, cantidad: 1 }]],
    ['id negativo', [{ id: -1, cantidad: 1 }]],
    ['id no numérico', [{ id: 'abc', cantidad: 1 }]],
  ];
  for (const [nombre, items] of CASOS) {
    test(`rechaza: ${nombre}`, async () => {
      const r = await comprar(items);
      assert.ok(r.estado >= 400, `aceptó ${nombre} con ${r.estado}`);
    });
  }

  test('rechaza cliente sin nombre, teléfono o dirección', async () => {
    for (const c of [
      { ...CLIENTE_VALIDO, nombre: '' },
      { ...CLIENTE_VALIDO, nombre: 'Ab' },
      { ...CLIENTE_VALIDO, telefono: '' },
      { ...CLIENTE_VALIDO, telefono: 'abc' },
      { ...CLIENTE_VALIDO, direccion: '' },
    ]) {
      const r = await cliente(srv.base).pedir('/api/pedidos', {
        metodo: 'POST', cuerpo: { cliente: c, items: [{ id: 1, cantidad: 1 }] },
      });
      assert.equal(r.estado, 400, JSON.stringify(c));
    }
  });
});

describe('Stock', () => {
  test('no se puede comprar más de lo que hay', async () => {
    const p = await producto(3);
    const r = await comprar([{ id: 3, cantidad: p.stock + 1 }]);
    assert.equal(r.estado, 409);
    assert.equal(r.json.faltantes[0].disponible, p.stock);
  });

  test('el stock se descuenta exactamente', async () => {
    const antes = (await producto(5)).stock;
    await comprar([{ id: 5, cantidad: 2 }]);
    assert.equal((await producto(5)).stock, antes - 2);
  });

  test('si un ítem falla, NO se descuenta ninguno (transacción)', async () => {
    const a = (await producto(6)).stock;
    const b = (await producto(7)).stock;
    const r = await comprar([{ id: 6, cantidad: 1 }, { id: 7, cantidad: 99999 }]);
    assert.equal(r.estado, 409);
    assert.equal((await producto(6)).stock, a, 'descontó el ítem bueno pese a fallar el otro');
    assert.equal((await producto(7)).stock, b);
  });

  test('10 compras simultáneas de la última unidad venden solo una', async () => {
    // Dejamos el producto en exactamente 1.
    const p = await producto(12);
    await admin.pedir('/api/stock', {
      metodo: 'POST',
      cuerpo: { producto_id: 12, cantidad: 1 - p.stock, motivo: 'preparar test' },
    });
    assert.equal((await producto(12)).stock, 1);

    const intentos = await Promise.all(
      Array.from({ length: 10 }, () => comprar([{ id: 12, cantidad: 1 }])),
    );
    const aceptadas = intentos.filter((r) => r.estado === 201).length;
    assert.equal(aceptadas, 1, `vendió ${aceptadas} unidades habiendo 1`);
    assert.equal((await producto(12)).stock, 0);
  });
});

describe('Ciclo de vida del pedido', () => {
  test('avanza de estado y anular devuelve el stock', async () => {
    const antes = (await producto(20)).stock;
    const nuevo = await comprar([{ id: 20, cantidad: 3 }]);
    assert.equal((await producto(20)).stock, antes - 3);

    const id = nuevo.json.pedido.id;
    for (const estado of ['preparando', 'enviado']) {
      const r = await admin.pedir(`/api/pedidos/${id}/estado`, { metodo: 'PATCH', cuerpo: { estado } });
      assert.equal(r.estado, 200);
      assert.equal(r.json.estado, estado);
    }

    const anulado = await admin.pedir(`/api/pedidos/${id}/estado`, { metodo: 'PATCH', cuerpo: { estado: 'anulado' } });
    assert.equal(anulado.estado, 200);
    assert.equal((await producto(20)).stock, antes, 'anular no devolvió el stock');
  });

  test('un pedido entregado admite devolución y repone stock', async () => {
    const antes = (await producto(21)).stock;
    const nuevo = await comprar([{ id: 21, cantidad: 2 }]);
    const id = nuevo.json.pedido.id;
    await admin.pedir(`/api/pedidos/${id}/estado`, { metodo: 'PATCH', cuerpo: { estado: 'entregado' } });
    const dev = await admin.pedir(`/api/pedidos/${id}/estado`, { metodo: 'PATCH', cuerpo: { estado: 'devuelto' } });
    assert.equal(dev.estado, 200);
    assert.equal((await producto(21)).stock, antes, 'la devolución no repuso stock');
  });

  test('no se puede anular dos veces (no duplica stock)', async () => {
    const antes = (await producto(22)).stock;
    const nuevo = await comprar([{ id: 22, cantidad: 1 }]);
    const id = nuevo.json.pedido.id;
    await admin.pedir(`/api/pedidos/${id}/estado`, { metodo: 'PATCH', cuerpo: { estado: 'anulado' } });
    const otra = await admin.pedir(`/api/pedidos/${id}/estado`, { metodo: 'PATCH', cuerpo: { estado: 'anulado' } });
    assert.equal(otra.estado, 409);
    assert.equal((await producto(22)).stock, antes, 'la segunda anulación duplicó el stock');
  });

  test('estado inventado se rechaza', async () => {
    const r = await admin.pedir('/api/pedidos/1/estado', { metodo: 'PATCH', cuerpo: { estado: 'inventado' } });
    assert.equal(r.estado, 400);
  });

  test('pedido inexistente da 404', async () => {
    const r = await admin.pedir('/api/pedidos/999999/estado', { metodo: 'PATCH', cuerpo: { estado: 'preparando' } });
    assert.equal(r.estado, 404);
  });

  test('el total = suma de ítems + envío, al céntimo', async () => {
    const nuevo = await comprar([{ id: 2, cantidad: 2 }, { id: 4, cantidad: 1 }]);
    const lista = (await admin.pedir('/api/pedidos')).json;
    const p = lista.find((x) => x.id === nuevo.json.pedido.id);
    const suma = +p.items.reduce((s, i) => s + i.subtotal, 0).toFixed(2);
    assert.equal(p.total, +(suma + p.costo_envio).toFixed(2));
  });
});

describe('Edición de productos', () => {
  test('cambia el precio y queda registrado quién fue', async () => {
    const r = await admin.pedir('/api/productos/1', { metodo: 'PATCH', cuerpo: { precio: 33.3 } });
    assert.equal(r.estado, 200);
    assert.equal(r.json.producto.precio, 33.3);

    const cambios = (await admin.pedir('/api/admin/cambios')).json;
    const ultimo = cambios[0];
    assert.equal(ultimo.campo, 'precio');
    assert.equal(ultimo.despues, '33.3');
    assert.ok(ultimo.usuario, 'el cambio no quedó firmado');
  });

  const INVALIDOS = [
    ['precio cero', { precio: 0 }],
    ['precio negativo', { precio: -5 }],
    ['precio texto', { precio: 'gratis' }],
    ['precio infinito', { precio: 1e400 }],
    ['mínimo decimal', { stock_min: 3.7 }],
    ['mínimo negativo', { stock_min: -1 }],
  ];
  for (const [nombre, cuerpo] of INVALIDOS) {
    test(`rechaza ${nombre}`, async () => {
      const r = await admin.pedir('/api/productos/1', { metodo: 'PATCH', cuerpo });
      assert.equal(r.estado, 400, `aceptó ${nombre}`);
    });
  }

  /**
   * La lista blanca crecio: ahora se puede corregir la ficha entera —nombre,
   * categoria, origen, textos, costo— porque antes una errata en el nombre
   * obligaba a tocar la base a mano.
   *
   * Lo que sigue FUERA, y es lo que este test cuida:
   *
   *  - `sku`, porque es la identidad del producto en el kardex y en las lineas
   *    de los comprobantes ya emitidos: cambiarlo dejaria una boleta apuntando
   *    a un codigo que no existe.
   *  - `stock`, porque se mueve por ventas, ingresos y ajustes y nunca a dedo:
   *    es lo que permite que el kardex explique cada unidad.
   */
  test('el sku y el stock no se pueden tocar por la ficha', async () => {
    const antes = await producto(1);
    const r = await admin.pedir('/api/productos/1', {
      metodo: 'PATCH',
      cuerpo: { stock: 99999, sku: 'HACKEADO' },
    });
    assert.equal(r.estado, 200);
    assert.equal(r.json.sin_cambios, true, 'no deberia haber cambiado nada');
    const despues = await producto(1);
    assert.equal(despues.stock, antes.stock);
    assert.equal(despues.sku, antes.sku);
  });

  test('la ficha si se puede corregir: nombre, origen y textos', async () => {
    const r = await admin.pedir('/api/productos/1', {
      metodo: 'PATCH',
      cuerpo: {
        nombre: 'Maca Negra molida en piedra',
        origen: 'Junín · 4200 m',
        beneficios: 'Energía y resistencia',
      },
    });
    assert.equal(r.estado, 200, JSON.stringify(r.json));
    const p = await producto(1);
    assert.equal(p.nombre, 'Maca Negra molida en piedra');
    assert.equal(p.origen, 'Junín · 4200 m');
    // Y cada correccion queda firmada en la bitacora.
    const cambios = (await admin.pedir('/api/admin/cambios')).json;
    assert.ok(cambios.some((c) => c.campo === 'nombre'), 'el cambio debe quedar registrado');
  });

  test('el nombre sigue siendo unico, salvo consigo mismo', async () => {
    const otro = await producto(2);
    const choque = await admin.pedir('/api/productos/1', {
      metodo: 'PATCH', cuerpo: { nombre: otro.nombre },
    });
    assert.equal(choque.estado, 400, 'dos productos con el mismo nombre confunden al que despacha');

    // Volver a poner el nombre que ya tiene no es un choque: es el caso de
    // corregir una tilde sin cambiar de producto.
    const mismo = await producto(1);
    const r = await admin.pedir('/api/productos/1', {
      metodo: 'PATCH', cuerpo: { nombre: mismo.nombre },
    });
    assert.equal(r.estado, 200);
  });

  test('el costo no puede superar el precio ni por edicion', async () => {
    const p = await producto(1);
    const r = await admin.pedir('/api/productos/1', {
      metodo: 'PATCH', cuerpo: { costo: p.precio + 10 },
    });
    assert.equal(r.estado, 400, 'seria cargar un producto que se vende a pérdida');
  });

  test('la imagen solo acepta una ruta del sitio o https', async () => {
    for (const mala of ['javascript:alert(1)', 'http://sitio.pe/f.jpg', 'data:text/html,x']) {
      const r = await admin.pedir('/api/productos/1', { metodo: 'PATCH', cuerpo: { imagen: mala } });
      assert.equal(r.estado, 400, `deberia rechazar «${mala}»`);
    }
    const buena = await admin.pedir('/api/productos/1', {
      metodo: 'PATCH', cuerpo: { imagen: '/img/fotos/MAC-001.jpg' },
    });
    assert.equal(buena.estado, 200);
  });

  test('dar de baja lo saca de la tienda pero el panel lo conserva', async () => {
    await admin.pedir('/api/productos/24', { metodo: 'PATCH', cuerpo: { activo: 0 } });

    const publico = (await cliente(srv.base).pedir('/api/productos')).json;
    assert.ok(!publico.some((p) => p.id === 24), 'sigue visible en la tienda');

    const compra = await comprar([{ id: 24, cantidad: 1 }]);
    assert.equal(compra.estado, 400, 'se pudo comprar un producto dado de baja');

    const panel = (await admin.pedir('/api/admin/productos')).json;
    assert.ok(panel.some((p) => p.id === 24), 'el panel lo perdió y no se puede reactivar');

    await admin.pedir('/api/productos/24', { metodo: 'PATCH', cuerpo: { activo: 1 } });
  });
});

describe('Ajustes de stock', () => {
  test('ingreso de mercadería suma y deja rastro con el usuario', async () => {
    const antes = (await producto(12)).stock;
    const r = await admin.pedir('/api/stock', {
      metodo: 'POST', cuerpo: { producto_id: 12, cantidad: 25, motivo: 'Compra proveedor' },
    });
    assert.equal(r.estado, 200);
    assert.equal(r.json.stock, antes + 25);

    const movs = (await admin.pedir('/api/admin/movimientos')).json;
    assert.match(movs[0].motivo, /Compra proveedor/);
    assert.match(movs[0].motivo, /\(/, 'el movimiento no dice quién lo hizo');
  });

  test('no deja el stock en negativo', async () => {
    const p = await producto(12);
    const r = await admin.pedir('/api/stock', {
      metodo: 'POST', cuerpo: { producto_id: 12, cantidad: -(p.stock + 1) },
    });
    assert.equal(r.estado, 409);
    assert.equal((await producto(12)).stock, p.stock);
  });

  test('rechaza cantidad cero o no entera', async () => {
    for (const cantidad of [0, 1.5, 'x', null]) {
      const r = await admin.pedir('/api/stock', { metodo: 'POST', cuerpo: { producto_id: 12, cantidad } });
      assert.equal(r.estado, 400, 'aceptó cantidad ' + cantidad);
    }
  });
});
