/**
 * Emisión de boletas, facturas y notas de crédito.
 *
 * El foco está en lo que SUNAT rechaza: totales que no cuadran, correlativos
 * repetidos y campos de catálogo mal puestos.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, cliente, CLIENTE_VALIDO } from './ayuda.mjs';
import { importeEnLetras } from '../importe-letras.js';
import { TIPO_DOCUMENTO, TIPO_DOC_IDENTIDAD } from '../catalogos-sunat.js';
import { TIENDA } from '../tienda.config.js';

let srv, admin;
before(async () => {
  srv = await levantarServidor();
  admin = cliente(srv.base);
  await admin.pedir('/api/login', {
    metodo: 'POST', cuerpo: { correo: 'qa@raizandina.pe', clave: 'claveDePrueba2026' },
  });
});
after(async () => { await srv?.parar(); });

// Por defecto, UNA unidad de un producto con mucho stock: la suite hace
// decenas de compras y con cantidades grandes se quedaba sin inventario a
// media ejecución, haciendo fallar tests que no tenían nada que ver.
const comprar = async (extra = {}, items = [{ id: 9, cantidad: 1 }]) => {
  const r = await cliente(srv.base).pedir('/api/pedidos', {
    metodo: 'POST', cuerpo: { cliente: { ...CLIENTE_VALIDO, ...extra }, items },
  });
  assert.equal(r.estado, 201, r.json?.error);
  return r.json.pedido;
};

const verComprobante = async (numero) => {
  const lista = (await admin.pedir('/api/admin/comprobantes')).json;
  const fila = lista.find((c) => c.numero === numero);
  assert.ok(fila, 'no aparece ' + numero + ' en la lista');
  return (await admin.pedir('/api/comprobantes/' + fila.id)).json;
};

describe('Importe en letras', () => {
  test('formato exigido en la representación impresa', () => {
    assert.equal(importeEnLetras(125.8), 'SON: CIENTO VEINTICINCO CON 80/100 SOLES');
    assert.equal(importeEnLetras(1), 'SON: UNO CON 00/100 SOLES');
    assert.equal(importeEnLetras(100), 'SON: CIEN CON 00/100 SOLES');
    assert.equal(importeEnLetras(0.05), 'SON: CERO CON 05/100 SOLES');
  });

  test('el "uno" se apocopa delante de mil y millones', () => {
    const t = (n) => importeEnLetras(n).replace('SON: ', '').replace(' CON 00/100 SOLES', '');
    assert.equal(t(21000), 'VEINTIÚN MIL');
    assert.equal(t(121000), 'CIENTO VEINTIÚN MIL');
    assert.equal(t(31000), 'TREINTA Y UN MIL');
    assert.equal(t(21000000), 'VEINTIÚN MILLONES');
    assert.equal(t(1000), 'MIL', '"UN MIL" no se dice');
  });

  test('redondea a céntimos sin perder el medio céntimo', () => {
    // 10.005 se guarda en binario como 10.00500000000000078: sin corregir el
    // épsilon, Math.round lo bajaba a 10.00 y el céntimo desaparecía.
    assert.equal(importeEnLetras(10.005), 'SON: DIEZ CON 01/100 SOLES');
    assert.equal(importeEnLetras(0.005), 'SON: CERO CON 01/100 SOLES');
    assert.equal(importeEnLetras(9.999), 'SON: DIEZ CON 00/100 SOLES');
  });
});

describe('Emisión automática con la venta', () => {
  test('DNI emite BOLETA con serie B001', async () => {
    const p = await comprar({ tipo_doc: 'DNI', num_doc: '45678912' });
    assert.ok(p.numeroComprobante, 'el pedido no emitió comprobante');
    assert.match(p.numeroComprobante, /^B001-\d{8}$/);

    const c = await verComprobante(p.numeroComprobante);
    assert.equal(c.tipoDoc, TIPO_DOCUMENTO.BOLETA);
    assert.equal(c.cliente.tipoDoc, TIPO_DOC_IDENTIDAD.DNI);
    assert.equal(c.estado, 'pendiente_envio');
  });

  test('RUC emite FACTURA con serie F001', async () => {
    const p = await comprar({
      tipo_doc: 'RUC', num_doc: '20512345671', razon_social: 'Bodega Los Andes S.A.C.',
    });
    assert.match(p.numeroComprobante, /^F001-\d{8}$/);

    const c = await verComprobante(p.numeroComprobante);
    assert.equal(c.tipoDoc, TIPO_DOCUMENTO.FACTURA);
    assert.equal(c.cliente.tipoDoc, TIPO_DOC_IDENTIDAD.RUC);
    assert.equal(c.cliente.nombre, 'Bodega Los Andes S.A.C.',
      'la factura debe ir a nombre de la razón social');
  });

  test('los datos del emisor salen de la configuración', async () => {
    const p = await comprar();
    const c = await verComprobante(p.numeroComprobante);
    assert.equal(c.emisor.ruc, TIENDA.comprobante.ruc);
    assert.equal(c.emisor.razonSocial, TIENDA.comprobante.razonSocial);
  });
});

describe('Aritmética — lo que SUNAT rechaza', () => {
  test('el total del comprobante = lo que se le cobró al cliente', async () => {
    const p = await comprar();
    const c = await verComprobante(p.numeroComprobante);
    assert.equal(c.totales.total, p.total,
      'el comprobante no cuadra con el cobro: SUNAT lo rechaza');
  });

  test('gravadas + IGV = total, al céntimo', async () => {
    const p = await comprar();
    const c = await verComprobante(p.numeroComprobante);
    assert.ok(Math.abs(c.totales.gravadas + c.totales.igv - c.totales.total) < 0.005,
      `${c.totales.gravadas} + ${c.totales.igv} ≠ ${c.totales.total}`);
  });

  test('la suma de las líneas = los totales', async () => {
    const p = await comprar();
    const c = await verComprobante(p.numeroComprobante);
    const suma = (f) => +c.items.reduce((a, i) => a + i[f], 0).toFixed(2);
    assert.equal(suma('importe'), c.totales.total);
    assert.equal(suma('valorVenta'), c.totales.gravadas);
    assert.equal(suma('igv'), c.totales.igv);
  });

  test('en cada línea: valorVenta + IGV = importe', async () => {
    const p = await comprar();
    const c = await verComprobante(p.numeroComprobante);
    for (const i of c.items) {
      assert.ok(Math.abs(i.valorVenta + i.igv - i.importe) < 0.005,
        `línea "${i.descripcion}" no cuadra`);
    }
  });

  test('cantidades que fuerzan el redondeo siguen cuadrando', async () => {
    // 3 × 22.00 daba 65.99 en la primera versión, por doble redondeo.
    for (const items of [
      [{ id: 11, cantidad: 3 }],                                      // 3 × 22.00
      [{ id: 5, cantidad: 3 }],                                       // 3 × 12.50
      [{ id: 9, cantidad: 7 }],                                       // 7 × 8.50
      [{ id: 1, cantidad: 1 }, { id: 11, cantidad: 1 }, { id: 5, cantidad: 1 }],
    ]) {
      const p = await comprar({}, items);
      const c = await verComprobante(p.numeroComprobante);
      assert.equal(c.totales.total, p.total, `descuadre con ${JSON.stringify(items)}`);
    }
  });

  test('el envío va como línea gravada, no como descuento', async () => {
    const p = await comprar({ distrito: 'Breña' });   // Lima Centro, con costo
    const c = await verComprobante(p.numeroComprobante);
    const envio = c.items.find((i) => i.codigo === 'ENVIO');
    assert.ok(envio, 'el envío no aparece como ítem del comprobante');
    assert.equal(envio.importe, p.envio);
  });
});

describe('Numeración', () => {
  test('los correlativos son consecutivos y sin huecos', async () => {
    const numeros = [];
    for (let i = 0; i < 4; i++) {
      const p = await comprar({ tipo_doc: 'DNI', num_doc: '45678912' });
      numeros.push(Number(p.numeroComprobante.split('-')[1]));
    }
    for (let i = 1; i < numeros.length; i++) {
      assert.equal(numeros[i], numeros[i - 1] + 1,
        'hueco en la numeración: ' + numeros.join(', '));
    }
  });

  test('boletas y facturas llevan correlativos independientes', async () => {
    const b = await comprar({ tipo_doc: 'DNI', num_doc: '45678912' });
    const f = await comprar({
      tipo_doc: 'RUC', num_doc: '20512345671', razon_social: 'Otra S.A.C.',
    });
    assert.match(b.numeroComprobante, /^B001-/);
    assert.match(f.numeroComprobante, /^F001-/);
  });

  test('no hay dos comprobantes con el mismo número', async () => {
    const lista = (await admin.pedir('/api/admin/comprobantes')).json;
    const vistos = new Set();
    for (const c of lista) {
      assert.ok(!vistos.has(c.numero), 'número repetido: ' + c.numero);
      vistos.add(c.numero);
    }
  });

  test('un pedido no genera dos comprobantes', async () => {
    const antes = (await admin.pedir('/api/admin/comprobantes')).json.length;
    const p = await comprar();
    const despues = (await admin.pedir('/api/admin/comprobantes')).json.length;
    assert.equal(despues, antes + 1, 'emitió más de un comprobante para una venta');
    assert.ok(p.numeroComprobante);
  });
});

describe('Notas de crédito', () => {
  test('anular el pedido emite nota de crédito por anulación', async () => {
    const p = await comprar();
    await admin.pedir(`/api/pedidos/${p.id}/estado`, {
      metodo: 'PATCH', cuerpo: { estado: 'anulado' },
    });
    const lista = (await admin.pedir('/api/admin/comprobantes')).json;
    const nc = lista.find((c) => c.ref === p.numeroComprobante);
    assert.ok(nc, 'no se emitió nota de crédito al anular');
    assert.equal(nc.tipo_doc, TIPO_DOCUMENTO.NOTA_CREDITO);
    assert.equal(nc.total, p.total, 'la nota debe compensar el importe completo');
  });

  test('devolver emite nota de crédito con motivo de devolución', async () => {
    const p = await comprar();
    await admin.pedir(`/api/pedidos/${p.id}/estado`, { metodo: 'PATCH', cuerpo: { estado: 'entregado' } });
    await admin.pedir(`/api/pedidos/${p.id}/estado`, { metodo: 'PATCH', cuerpo: { estado: 'devuelto' } });

    const lista = (await admin.pedir('/api/admin/comprobantes')).json;
    const nc = lista.find((c) => c.ref === p.numeroComprobante);
    assert.ok(nc, 'no se emitió nota de crédito al devolver');

    const d = (await admin.pedir('/api/comprobantes/' + nc.id)).json;
    assert.equal(d.nota.motivo, '06', 'el motivo debería ser devolución total');
    assert.equal(d.nota.referencia, p.numeroComprobante);
  });

  test('la serie de la nota hereda la letra del documento que modifica', async () => {
    const f = await comprar({
      tipo_doc: 'RUC', num_doc: '20512345671', razon_social: 'Tercera S.A.C.',
    });
    await admin.pedir(`/api/pedidos/${f.id}/estado`, { metodo: 'PATCH', cuerpo: { estado: 'anulado' } });
    const lista = (await admin.pedir('/api/admin/comprobantes')).json;
    const nc = lista.find((c) => c.ref === f.numeroComprobante);
    assert.match(nc.numero, /^FC01-/, 'una nota sobre factura debe ir en serie F');
  });
});

describe('XML UBL 2.1', () => {
  test('la estructura mínima está presente', async () => {
    const p = await comprar();
    const c = await verComprobante(p.numeroComprobante);
    const x = c.xml;

    assert.match(x, /<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(x, /<Invoice /);
    assert.match(x, /<cbc:UBLVersionID>2\.1<\/cbc:UBLVersionID>/);
    assert.match(x, /<cbc:CustomizationID>2\.0<\/cbc:CustomizationID>/);
    assert.match(x, new RegExp(`<cbc:ID>${p.numeroComprobante}</cbc:ID>`));
    assert.match(x, /<cbc:DocumentCurrencyCode>PEN<\/cbc:DocumentCurrencyCode>/);
    assert.match(x, /<cbc:InvoiceTypeCode listID="0101">03<\/cbc:InvoiceTypeCode>/);
  });

  test('lleva el RUC del emisor y el documento del cliente con su catálogo', async () => {
    const p = await comprar({
      tipo_doc: 'RUC', num_doc: '20512345671', razon_social: 'Cuarta S.A.C.',
    });
    const c = await verComprobante(p.numeroComprobante);
    assert.match(c.xml, new RegExp(`schemeID="6">${TIENDA.comprobante.ruc}`));
    assert.match(c.xml, /schemeID="6">20512345671/);
  });

  test('los importes del XML coinciden con los de la pantalla', async () => {
    const p = await comprar();
    const c = await verComprobante(p.numeroComprobante);
    const leer = (re) => Number(c.xml.match(re)?.[1]);
    assert.equal(leer(/<cbc:PayableAmount currencyID="PEN">([\d.]+)</), c.totales.total);
    assert.equal(leer(/<cbc:TaxAmount currencyID="PEN">([\d.]+)</), c.totales.igv);
    assert.equal(leer(/<cbc:LineExtensionAmount currencyID="PEN">([\d.]+)</), c.totales.gravadas);
  });

  test('el hueco de la firma existe y está vacío', async () => {
    const p = await comprar();
    const c = await verComprobante(p.numeroComprobante);
    assert.match(c.xml, /<ext:UBLExtensions>/);
    assert.match(c.xml, /<ext:ExtensionContent\/>/,
      'sin ese hueco no hay dónde meter la firma XML-DSig');
    assert.ok(!/<ds:Signature/.test(c.xml),
      'no debe simular una firma que no existe');
  });

  test('el XML se descarga con nombre según la convención de SUNAT', async () => {
    const p = await comprar();
    const lista = (await admin.pedir('/api/admin/comprobantes')).json;
    const fila = lista.find((c) => c.numero === p.numeroComprobante);
    const r = await admin.pedir(`/api/comprobantes/${fila.id}/xml`);
    assert.equal(r.estado, 200);
    assert.match(r.cabeceras.get('content-disposition'),
      new RegExp(`${TIENDA.comprobante.ruc}-03-${p.numeroComprobante}\\.xml`));
  });
});

describe('Código QR', () => {
  test('el contenido lleva los nueve campos en orden', async () => {
    const p = await comprar();
    const c = await verComprobante(p.numeroComprobante);
    const campos = c.qr.split('|');
    assert.equal(campos.length, 10, 'el QR debe tener 10 campos separados por |');
    assert.equal(campos[0], TIENDA.comprobante.ruc);
    assert.equal(campos[1], c.tipoDoc);
    assert.equal(campos[2], c.serie);
    assert.equal(campos[3], String(c.correlativo).padStart(8, '0'));
    assert.equal(Number(campos[4]), c.totales.igv);
    assert.equal(Number(campos[5]), c.totales.total);
    assert.equal(campos[6], c.fechaEmision);
    assert.equal(campos[7], c.cliente.tipoDoc);
    assert.equal(campos[8], c.cliente.numDoc);
    assert.equal(campos[9], '', 'el hash va vacío mientras no haya firma');
  });
});

describe('Acceso', () => {
  test('los comprobantes no se ven sin sesión', async () => {
    const anon = cliente(srv.base);
    for (const ruta of ['/api/admin/comprobantes', '/api/comprobantes/1', '/api/comprobantes/1/xml']) {
      const r = await anon.pedir(ruta);
      assert.equal(r.estado, 401, ruta + ' quedó abierta');
    }
  });

  /**
   * La página del comprobante dejó de ser privada cuando el comprador pasó a
   * imprimir su propia boleta desde ahí: pedirle sesión para recoger su
   * documento no tendría sentido. Lo que se cierra no es la página, que está
   * vacía, sino los datos que pide con `?id=`.
   */
  test('/comprobante.html abre sin sesión, pero no trae datos', async () => {
    const anon = cliente(srv.base);
    const r = await anon.pedir('/comprobante.html?id=1');
    assert.equal(r.estado, 200);
    assert.ok(!r.texto.includes('R.U.C.'), 'la página trae el comprobante dentro');
    assert.equal((await anon.pedir('/api/comprobantes/1')).estado, 401);
  });

  test('un comprobante inexistente da 404', async () => {
    const r = await admin.pedir('/api/comprobantes/999999');
    assert.equal(r.estado, 404);
  });
});

describe('Cada cliente y su comprobante', () => {
  test('cada pedido emite un comprobante propio, con su cliente', async () => {
    const compradores = [
      { nombre: 'Rosa Huamán', telefono: '956231447', num_doc: '45678912' },
      { nombre: 'Julio Ccahuana', telefono: '944110022', num_doc: '09876543' },
      { nombre: 'Elena Quispe', telefono: '933220011', num_doc: '71234567' },
    ];
    const emitidos = [];
    for (const c of compradores) {
      const p = await comprar({ ...c, tipo_doc: 'DNI' });
      const seg = await cliente(srv.base).pedir('/api/seguimiento/comprobante', {
        metodo: 'POST',
        cuerpo: { codigo: p.codigo, telefono: c.telefono.slice(-4) },
      });
      assert.equal(seg.estado, 200, `${c.nombre} no pudo ver su comprobante`);
      assert.equal(seg.json.cliente.nombre, c.nombre, 'el comprobante trae otro cliente');
      assert.equal(seg.json.cliente.numDoc, c.num_doc);
      emitidos.push(seg.json.numero);
    }
    assert.equal(new Set(emitidos).size, 3, 'dos clientes comparten el mismo número');
  });

  test('un cliente no alcanza el comprobante de otro', async () => {
    const mio = await comprar({ nombre: 'Rosa Huamán', telefono: '956231447' });
    const ajeno = await comprar({ nombre: 'Julio Ccahuana', telefono: '944110022' });

    const r = await cliente(srv.base).pedir('/api/seguimiento/comprobante', {
      metodo: 'POST', cuerpo: { codigo: ajeno.codigo, telefono: '1447' },
    });
    assert.equal(r.estado, 404, 'vio el comprobante de otro cliente');
    void mio;
  });

  test('el panel llega al comprobante de cada pedido', async () => {
    await comprar({ nombre: 'Elena Quispe', telefono: '933220011' });

    const pedidos = (await admin.pedir('/api/pedidos')).json;
    const comprobantes = (await admin.pedir('/api/admin/comprobantes')).json;

    // Así es como el panel arma el enlace de cada fila.
    for (const p of pedidos.filter((x) => x.estado !== 'anulado')) {
      const cmp = comprobantes.find((c) => c.pedido_id === p.id);
      assert.ok(cmp, `el pedido ${p.codigo} no tiene comprobante que enlazar`);
      const detalle = await admin.pedir(`/api/comprobantes/${cmp.id}`);
      assert.equal(detalle.estado, 200);
      assert.equal(detalle.json.totales.total, p.total,
        `el comprobante de ${p.codigo} no cuadra con el pedido`);
    }
  });
});

/**
 * El comprobante como archivo PDF.
 *
 * Un PDF escrito a mano falla de una sola manera: no abre. Por eso lo que se
 * comprueba aquí es la estructura —la tabla de posiciones, la longitud
 * declarada del flujo, las referencias entre objetos— que es exactamente lo
 * que un lector necesita para no rendirse.
 */
describe('Comprobante en PDF', () => {
  /** Comprueba que el archivo cumpla lo que un lector de PDF exige. */
  const revisarPdf = (texto) => {
    assert.ok(texto.startsWith('%PDF-'), 'no empieza con la firma de un PDF');
    assert.ok(texto.trimEnd().endsWith('%%EOF'), 'no termina en %%EOF');

    // La tabla xref: cada posición tiene que caer sobre su objeto.
    const sx = texto.lastIndexOf('startxref');
    assert.ok(sx > 0, 'sin startxref, el lector no sabe por dónde empezar');
    const inicio = Number(texto.slice(sx + 9).trim().split(/\s/)[0]);
    assert.ok(texto.slice(inicio).startsWith('xref'),
      'startxref no apunta a la tabla');

    const cabecera = texto.slice(inicio).match(/xref\s+(\d+)\s+(\d+)/);
    const entradas = [...texto.slice(inicio + cabecera[0].length)
      .matchAll(/(\d{10}) (\d{5}) ([nf])/g)];
    assert.equal(entradas.length, Number(cabecera[2]),
      'la tabla declara más entradas de las que trae');

    entradas.forEach((e, i) => {
      if (e[3] === 'f') return;
      assert.ok(texto.slice(Number(e[1])).startsWith(`${i} 0 obj`),
        `la posición del objeto ${i} apunta a otro sitio`);
    });

    // La longitud declarada del flujo tiene que ser la real: si no, el lector
    // corta el dibujo por la mitad o se pasa de largo.
    const flujo = texto.match(/<< \/Length (\d+) >>\nstream\n/);
    assert.ok(flujo, 'no hay flujo de contenido');
    const desde = texto.indexOf(flujo[0]) + flujo[0].length;
    assert.equal(texto.indexOf('\nendstream', desde) - desde, Number(flujo[1]),
      'la longitud declarada no coincide con el contenido');

    assert.match(texto, /\/Type \/Catalog/);
    assert.match(texto, /\/Type \/Page[^s]/);
    assert.match(texto, /\/BaseFont \/Helvetica/);
  };

  test('la tienda descarga el PDF de un comprobante', async () => {
    const p = await comprar();
    const lista = (await admin.pedir('/api/admin/comprobantes')).json;
    const fila = lista.find((c) => c.numero === p.numeroComprobante);

    const r = await admin.pedir(`/api/comprobantes/${fila.id}/pdf`);
    assert.equal(r.estado, 200);
    assert.equal(r.cabeceras.get('content-type'), 'application/pdf');
    assert.match(r.cabeceras.get('content-disposition'), /attachment; filename=".*\.pdf"/);
    revisarPdf(r.texto);
  });

  test('el nombre del archivo sigue la convención de SUNAT', async () => {
    const p = await comprar();
    const lista = (await admin.pedir('/api/admin/comprobantes')).json;
    const fila = lista.find((c) => c.numero === p.numeroComprobante);
    const r = await admin.pedir(`/api/comprobantes/${fila.id}/pdf`);
    assert.match(r.cabeceras.get('content-disposition'),
      new RegExp(`${TIENDA.comprobante.ruc}-03-${p.numeroComprobante}\.pdf`));
  });

  test('el cliente descarga el suyo con su código y su teléfono', async () => {
    const p = await comprar();
    const r = await cliente(srv.base).pedir(
      `/api/seguimiento/comprobante/pdf?codigo=${p.codigo}&tel=1447`);
    assert.equal(r.estado, 200, r.json?.error);
    assert.equal(r.cabeceras.get('content-type'), 'application/pdf');
    revisarPdf(r.texto);
  });

  test('el PDF lleva el número, el cliente y el total', async () => {
    const p = await comprar({ nombre: 'Elena Quispe Mamani' });
    const r = await cliente(srv.base).pedir(
      `/api/seguimiento/comprobante/pdf?codigo=${p.codigo}&tel=1447`);

    // El texto va en claro dentro del flujo: no se comprime nada.
    assert.ok(r.texto.includes(p.numeroComprobante), 'el PDF no dice qué comprobante es');
    assert.ok(r.texto.includes('Elena Quispe Mamani'), 'no sale el nombre del cliente');
    assert.ok(r.texto.includes(TIENDA.comprobante.ruc), 'no sale el RUC del emisor');
    assert.ok(r.texto.includes(p.total.toFixed(2)), 'no sale el importe cobrado');
  });

  test('sin el teléfono correcto no se descarga el PDF de otro', async () => {
    const p = await comprar();
    for (const tel of ['9999', '', '12']) {
      const r = await cliente(srv.base).pedir(
        `/api/seguimiento/comprobante/pdf?codigo=${p.codigo}&tel=${tel}`);
      assert.equal(r.estado, 404, `entró con teléfono "${tel}"`);
      assert.ok(!r.texto.startsWith('%PDF'), 'le entregó el PDF igual');
    }
  });

  test('el PDF no se descarga sin sesión por la ruta de la tienda', async () => {
    const r = await cliente(srv.base).pedir('/api/comprobantes/1/pdf');
    assert.equal(r.estado, 401);
  });

  test('una factura con RUC sale con la razón social', async () => {
    const p = await comprar({
      tipo_doc: 'RUC', num_doc: '20512345671', razon_social: 'Comercial Andina S.A.C.',
    });
    const r = await cliente(srv.base).pedir(
      `/api/seguimiento/comprobante/pdf?codigo=${p.codigo}&tel=1447`);
    assert.equal(r.estado, 200);
    assert.ok(r.texto.includes('Comercial Andina S.A.C.'));
    assert.ok(r.texto.includes('FACTURA'), 'no dice que es una factura');
  });

  test('pesa poco: se manda por WhatsApp sin problema', async () => {
    const p = await comprar();
    const r = await cliente(srv.base).pedir(
      `/api/seguimiento/comprobante/pdf?codigo=${p.codigo}&tel=1447`);
    const kb = Buffer.byteLength(r.texto, 'latin1') / 1024;
    assert.ok(kb < 30, `${kb.toFixed(0)} KB es demasiado para una boleta`);
  });
});
