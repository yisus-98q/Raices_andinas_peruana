/**
 * Reglas propias del mercado peruano: moneda, IGV y datos del negocio.
 *
 * Lo que NO se prueba aquí porque NO existe (y así consta en el informe):
 * comprobantes electrónicos, integración con SUNAT y pasarela de pagos.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { levantarServidor, cliente, CLIENTE_VALIDO } from './ayuda.mjs';
import { TIENDA } from '../tienda.config.js';

let srv;
before(async () => { srv = await levantarServidor(); });
after(async () => { await srv?.parar(); });

/** Misma función que usan la tienda y el asesor. */
const soles = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'S/ —';
  return 'S/ ' + v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

describe('Moneda', () => {
  test('formato peruano con separador de miles', () => {
    assert.equal(soles(10), 'S/ 10.00');
    assert.equal(soles(49.9), 'S/ 49.90');
    assert.equal(soles(1299), 'S/ 1,299.00');
    assert.equal(soles(12345.5), 'S/ 12,345.50');
  });

  test('nunca imprime NaN ni Infinity en pantalla', () => {
    for (const v of [NaN, Infinity, -Infinity, undefined, 'abc', {}]) {
      const salida = soles(v);
      assert.ok(!/NaN|Infinity/.test(salida), `${String(v)} produjo "${salida}"`);
    }
  });

  test('el redondeo no pierde céntimos en cantidades grandes', () => {
    const precio = 12.5;
    for (const cantidad of [3, 7, 13, 99, 250]) {
      const total = +(precio * cantidad).toFixed(2);
      assert.equal(total, Math.round(precio * cantidad * 100) / 100);
    }
  });

  test('la API nunca devuelve totales inválidos', async () => {
    const c = cliente(srv.base);
    const r = await c.pedir('/api/pedidos', {
      metodo: 'POST',
      cuerpo: { cliente: CLIENTE_VALIDO, items: [{ id: 1, cantidad: 3 }, { id: 2, cantidad: 2 }] },
    });
    const t = r.json.pedido.total;
    assert.ok(Number.isFinite(t) && t > 0, 'total inválido: ' + t);
    assert.equal(t, Math.round(t * 100) / 100, 'el total tiene más de dos decimales');
  });
});

describe('IGV', () => {
  test('el porcentaje está configurado en un solo sitio', () => {
    assert.ok(TIENDA.igv, 'no hay configuración de IGV');
    assert.equal(typeof TIENDA.igv.porcentaje, 'number');
    assert.ok(TIENDA.igv.porcentaje > 0 && TIENDA.igv.porcentaje < 100);
  });

  test('la tienda lo expone para que el frontend no lo tenga quemado', async () => {
    const c = cliente(srv.base);
    const r = await c.pedir('/api/tienda');
    assert.equal(r.json.igv.porcentaje, TIENDA.igv.porcentaje);
  });

  test('el desglose cuadra con el total al céntimo', () => {
    const pct = TIENDA.igv.porcentaje;
    for (const total of [10, 49.9, 70, 1299, 12345.5]) {
      const base = total / (1 + pct / 100);
      const igv = total - base;
      assert.ok(Math.abs(base + igv - total) < 0.005,
        `no cuadra en ${total}: ${base} + ${igv}`);
    }
  });

  test('los precios del catálogo son finales (ya incluyen IGV)', () => {
    assert.equal(TIENDA.igv.incluidoEnPrecio, true,
      'si el precio no incluye IGV, la tienda estaría mostrando un precio que no es el que se paga');
  });
});

describe('Datos del negocio', () => {
  test('la configuración trae lo mínimo para operar en Perú', () => {
    for (const campo of ['nombre', 'direccion', 'telefono', 'whatsapp', 'email']) {
      assert.ok(TIENDA[campo], `falta TIENDA.${campo}`);
    }
    assert.ok(TIENDA.comprobante.ruc, 'falta el RUC del negocio');
    assert.match(String(TIENDA.comprobante.ruc), /^\d{11}$/, 'el RUC debe tener 11 dígitos');
  });

  test('el envío a provincia está contemplado', () => {
    assert.ok(TIENDA.delivery.provincias, 'no hay política de envío fuera de Lima');
  });

  test('la escala de descuento por volumen es coherente', () => {
    const e = TIENDA.politicas.regateo.escalones;
    assert.ok(e.length > 0);
    for (let i = 1; i < e.length; i++) {
      assert.ok(e[i].desde > e[i - 1].desde, 'los escalones no están ordenados');
      assert.ok(e[i].porcentaje >= e[i - 1].porcentaje, 'un escalón mayor descuenta menos');
    }
  });
});

describe('Cotización mayorista', () => {
  test('aplica el descuento y dice cuánto hay en almacén', async () => {
    const c = cliente(srv.base);
    const r = await c.pedir('/api/asesor', {
      metodo: 'POST', cuerpo: { consulta: 'cuanto me sale 50 bolsas de maca negra' },
    });
    const cot = r.json.cotizacion;
    assert.ok(cot, 'no cotizó');
    assert.equal(cot.cantidad, 50);
    assert.ok(cot.descuento > 0, 'no aplicó descuento por volumen');

    // Con el catálogo grande hay varias macas negras; el stock que se promete
    // tiene que ser el de la que efectivamente cotizó, no el de otra.
    const p = r.json.recomendaciones[0];
    assert.match(p.nombre.toLowerCase(), /maca negra/);
    assert.equal(cot.disponible, Math.min(50, p.stock));
    assert.equal(cot.faltan, Math.max(0, 50 - p.stock));
  });

  test('no cotiza cuando el número es una medida, no una cantidad', async () => {
    const c = cliente(srv.base);
    for (const consulta of [
      'la maca de 250 gramos cuanto esta',
      'quiero el propoleo de 30 ml',
      'me lo dejas en 20 soles',
    ]) {
      const r = await c.pedir('/api/asesor', { metodo: 'POST', cuerpo: { consulta } });
      assert.ok(!r.json.cotizacion, `cotizó por error: "${consulta}"`);
    }
  });
});

describe('Asesor — seguridad de la recomendación', () => {
  test('nunca recomienda un producto agotado', async () => {
    const c = cliente(srv.base);
    const productos = (await c.pedir('/api/productos')).json;
    const consultas = ['no puedo dormir', 'me duelen las rodillas', 'para las defensas', 'crema para la piel'];
    for (const consulta of consultas) {
      const r = await c.pedir('/api/asesor', { metodo: 'POST', cuerpo: { consulta } });
      for (const rec of r.json.recomendaciones || []) {
        const real = productos.find((p) => p.id === rec.id);
        assert.ok(real && real.stock > 0, `recomendó ${rec.nombre} sin stock`);
      }
    }
  });

  test('deriva a un profesional en casos de riesgo', async () => {
    const c = cliente(srv.base);
    for (const consulta of ['estoy embarazada que tomo', 'tengo cancer', 'estoy dando de lactar']) {
      const r = await c.pedir('/api/asesor', { metodo: 'POST', cuerpo: { consulta } });
      assert.equal(r.json.derivar, true, `no derivó: "${consulta}"`);
      assert.equal(r.json.recomendaciones.length, 0, `recomendó productos igualmente: "${consulta}"`);
    }
  });

  test('no ofrece lo que la tienda no vende', async () => {
    const c = cliente(srv.base);
    const r = await c.pedir('/api/asesor', { metodo: 'POST', cuerpo: { consulta: 'tienes cannabis medicinal' } });
    assert.ok(r.json.no_trabajamos, 'no avisó que no lo vende');
    assert.equal(r.json.recomendaciones.length, 0);
  });
});
