/**
 * El catálogo grande y lo que le exige al asesor.
 *
 * Con dos docenas de productos casi cualquier cosa funcionaba. Con cientos
 * aparecen problemas que no existían: el mismo insumo en cinco presentaciones
 * copando las tres recomendaciones, el costo de compra viajando al navegador,
 * y doscientos kilobytes de JSON por una conexión de datos móviles.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { levantarServidor, cliente } from './ayuda.mjs';

let srv, c;
before(async () => { srv = await levantarServidor(); c = cliente(srv.base); });
after(async () => { await srv?.parar(); });

const consultar = async (consulta) => {
  const r = await c.pedir('/api/asesor', { metodo: 'POST', cuerpo: { consulta } });
  assert.equal(r.estado, 200, r.json?.error);
  return r.json;
};

/**
 * El insumo, sin la presentación. "Romero en gotas" y "Romero · extracto" son
 * el mismo; "Crema de Uña de Gato" y "Uña de Gato", también. La lista de
 * prefijos es blanca a propósito: "Cola de Caballo" o "Sangre de Grado"
 * empiezan igual y no son envases.
 */
const raiz = (n) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(' · ')[0].split(/ en /)[0].trim()
  .replace(/^(crema|tonico|jabon|gel|balsamo|shampoo|acondicionador|desodorante|jarabe|jugo|extracto|aceite|esencia) de /, '')
  .trim();

/** La misma planta: una raíz contiene a la otra entera, por palabras. */
const mismaPlanta = (a, b) =>
  (' ' + a + ' ').includes(' ' + b + ' ') || (' ' + b + ' ').includes(' ' + a + ' ');

describe('Catálogo', () => {
  test('la tienda tiene un catálogo grande y con varias categorías', async () => {
    const p = (await c.pedir('/api/productos')).json;
    assert.ok(p.length >= 100, `solo ${p.length} productos`);
    const cats = new Set(p.map((x) => x.categoria));
    for (const esperada of ['Hierbas', 'Tónicos', 'Aceites', 'Esencias', 'Colágeno']) {
      assert.ok(cats.has(esperada), `falta la categoría ${esperada}`);
    }
  });

  test('cada producto dice para qué sirve', async () => {
    const p = (await c.pedir('/api/productos')).json;
    const sin = p.filter((x) => !x.beneficios || x.beneficios.length < 5);
    assert.equal(sin.length, 0,
      `${sin.length} productos sin beneficios, p. ej. ${sin[0]?.nombre}`);
  });

  test('cada producto tiene una imagen asignada', async () => {
    const p = (await c.pedir('/api/productos')).json;
    assert.equal(p.filter((x) => !x.imagen).length, 0);
  });

  test('el precio de compra NO sale al público', async () => {
    const r = await c.pedir('/api/productos');
    assert.ok(!('costo' in r.json[0]), 'el catálogo público expone el costo');
    assert.ok(!r.texto.includes('"costo"'), 'el margen del negocio viaja al navegador');

    const uno = await c.pedir('/api/productos/1');
    assert.ok(!('costo' in uno.json), 'la ficha individual expone el costo');
  });

  test('el catálogo se manda comprimido', async () => {
    const r = await c.pedir('/api/productos', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(r.cabeceras.get('content-encoding'), 'gzip', 'va sin comprimir');
    assert.ok(Number(r.cabeceras.get('content-length')) < 60000,
      `${r.cabeceras.get('content-length')} bytes es demasiado para datos móviles`);
  });
});

describe('El asesor con un catálogo grande', () => {
  test('no repite el mismo producto en tres presentaciones', async () => {
    for (const consulta of [
      'me duele la cabeza',
      'no puedo dormir',
      'tengo la rodilla hinchada',
      'estoy con anemia',
      'tengo gastritis',
    ]) {
      const d = await consultar(consulta);
      const raices = d.recomendaciones.map((r) => raiz(r.nombre));
      assert.equal(new Set(raices).size, raices.length,
        `"${consulta}" devolvió el mismo producto repetido: ${raices.join(', ')}`);
    }
  });

  test('no ofrece el tamaño de prueba como primera opción', async () => {
    for (const consulta of ['tengo la rodilla hinchada', 'me duele la espalda']) {
      const d = await consultar(consulta);
      if (!d.recomendaciones.length) continue;
      assert.doesNotMatch(d.recomendaciones[0].nombre, /tamaño viaje|pack de 3/i,
        `"${consulta}" empieza ofreciendo el formato de muestra`);
    }
  });

  test('sigue acertando el malestar, no solo variando', async () => {
    const casos = [
      ['me duele la cabeza', /romero|toronjil|menta|manzanilla|cabeza/i],
      ['no puedo dormir hace dias', /manzanilla|valeriana|toronjil|magnesio|tilo/i],
      // Antes decía «estoy con anemia». La anemia es un diagnóstico —se
      // confirma con un análisis y se trata con hierro indicado—, así que ahora
      // el asesor la deriva y no recomienda nada: eso se prueba en
      // `asesor-salud.test.mjs`. Lo que aquí interesa es que el motor siga
      // acertando el malestar cuando se lo cuentan sin nombrar la enfermedad,
      // que es como llega la mayoría de las consultas.
      ['me siento debil y sin fuerzas', /hierro|beterraga|muicle|ortiga|quinua|polen|maca/i],
      ['se me cae el cabello', /cola de caballo|ortiga|ungurahui|romero|biotina|colageno/i],
    ];
    for (const [consulta, esperado] of casos) {
      const d = await consultar(consulta);
      assert.ok(d.recomendaciones.length, `"${consulta}" no recomendó nada`);
      assert.match(d.recomendaciones.map((r) => r.nombre).join(' | '), esperado,
        `"${consulta}" recomendó algo que no viene al caso`);
    }
  });

  test('no ofrece la misma planta en tres formas distintas', async () => {
    // 'Uña de Gato', 'Crema de Uña de Gato' y 'Tónico de Uña de Gato' son tres
    // entradas distintas del catálogo —cada una con su categoría, su origen y
    // su precio—, así que comparar raíces por igualdad las daba por cosas
    // diferentes. Para quien pregunta qué tomar para la rodilla son la misma
    // planta tres veces, y así salían: las tres juntas, ocupando la respuesta
    // entera. Lo mismo 'Magnesio' con 'Magnesio Quelado'.
    for (const consulta of [
      'me duelen las rodillas',
      'tengo gastritis',
      'no puedo dormir y ando con mucho estres',
      'algo para la tos',
      'necesito energia',
      'quiero algo para los nervios',
    ]) {
      const d = await consultar(consulta);
      const raices = d.recomendaciones.map((r) => raiz(r.nombre));
      for (let i = 0; i < raices.length; i++) {
        for (let j = i + 1; j < raices.length; j++) {
          assert.ok(!mismaPlanta(raices[i], raices[j]),
            '"' + consulta + '" ofreció la misma planta dos veces: ' +
            d.recomendaciones.map((r) => r.nombre).join(' / '));
        }
      }
    }
  });

  test('el relleno de demostración no desplaza a un producto del negocio', async () => {
    // Los 400 productos con que arranca la tienda son inventados: están para
    // que el catálogo se vea lleno. En 'no puedo dormir y ando con estrés'
    // empatan en señales con los curados —Valeriana, Manzanilla, Graviola— y
    // tienen más stock, así que ganaban el desempate: el asesor abría con dos
    // magnesios 'Formulado en Lima' en una tienda cuyo argumento es el origen.
    const base = new DatabaseSync(srv.dbPath, { readOnly: true });
    const fila = base.prepare('SELECT demo, origen FROM productos WHERE id = ?');

    const curados = base.prepare(
      "SELECT COUNT(*) n FROM productos WHERE activo = 1 AND demo = 0" +
      " AND stock > 0 AND etiquetas LIKE '%dormir%'").get().n;
    assert.ok(curados >= 3, 'la semilla ya no tiene curados para este malestar');

    const d = await consultar('no puedo dormir y ando con mucho estres');
    assert.ok(d.recomendaciones.length, 'no recomendó nada');
    for (const r of d.recomendaciones) {
      assert.equal(fila.get(r.id).demo, 0,
        r.nombre + ' es relleno de demostración y salió recomendado');
    }
    base.close();
  });

  test('la marca de relleno no viaja al navegador', async () => {
    // El flag ordena las recomendaciones, pero no tiene por qué salir en el
    // catálogo público: es la tienda etiquetando sus propios productos de
    // 'demostración' en una respuesta que el cliente puede abrir.
    const p = (await c.pedir('/api/productos')).json;
    assert.ok(p.length, 'el catálogo vino vacío');
    assert.ok(!('demo' in p[0]), 'el catálogo público expone la marca de relleno');
  });

  test('lo que recomienda existe y se puede comprar', async () => {
    const d = await consultar('tengo gastritis');
    for (const r of d.recomendaciones) {
      const p = await c.pedir(`/api/productos/${r.id}`);
      assert.equal(p.estado, 200, `recomendó el producto ${r.id}, que no existe`);
      assert.equal(p.json.nombre, r.nombre);
    }
  });
});

describe('Cotización al por mayor', () => {
  test('cotiza el envase que el cliente nombró', async () => {
    const casos = [
      ['cuanto me sale 50 bolsas de maca negra', /bolsa/i],
      ['necesito 40 frascos de miel de abeja', /frasco/i],
      ['quiero 30 botellas de jugo de noni', /botella/i],
    ];
    for (const [consulta, envase] of casos) {
      const d = await consultar(consulta);
      assert.ok(d.cotizacion, `"${consulta}" no cotizó`);
      const p = d.recomendaciones[0];
      assert.match(p.presentacion, envase,
        `pidió ${envase} y le cotizaron "${p.presentacion}" de ${p.nombre}`);
    }
  });

  test('sin envase nombrado, cotiza lo que más se puede despachar', async () => {
    const d = await consultar('quiero 40 unidades de manzanilla');
    assert.ok(d.cotizacion);
    assert.ok(d.cotizacion.descuento > 0, 'no aplicó descuento por volumen');
    assert.equal(d.cotizacion.cantidad, 40);
    // Si se entrega todo o no, sin «disponibles / faltan»: de esas dos cifras
    // se despeja el stock exacto.
    assert.equal(typeof d.cotizacion.alcanza, 'boolean');
    assert.equal(d.cotizacion.disponible, undefined);
    assert.equal(d.cotizacion.faltan, undefined);
  });
});
