/**
 * El límite sanitario del asesor.
 *
 * Un producto natural no puede promocionarse como que previene, trata o cura
 * una enfermedad, y decir qué tomar y cuánto es una posología. Un asistente que
 * recibe un diagnóstico y devuelve un producto hace exactamente eso, por
 * escrito, con fecha y guardado en un servidor.
 *
 * Estas pruebas no comprueban que el asesor «funcione»: comprueban que se
 * calle. Y la otra mitad, igual de importante, es que no se calle de más — un
 * asesor que deriva al médico a quien pregunta por maca en polvo no vende nada
 * y además entrena al cliente a no volver a preguntar.
 *
 * Van contra `asesorar()` y no contra la API porque el límite tiene que
 * sostenerse aunque no haya red, clave ni modelo: cuando falta la clave de
 * Anthropic la respuesta la arma la plantilla local, y ese camino es el que más
 * se usa en una demo.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { asesorar } from '../asesor.js';
import { DatabaseSync } from 'node:sqlite';

/**
 * El catálogo real de la demo. Se lee de la base y no se inventa: un catálogo
 * de juguete con tres productos no engancharía con casi nada, y la prueba
 * pasaría por falta de candidatos en vez de por el límite que se quiere probar.
 */
const db = new DatabaseSync(process.env.DB_PATH || 'data/tienda.db', { readOnly: true });
const PRODUCTOS = db.prepare('SELECT * FROM productos WHERE activo = 1').all();

const responder = (consulta) => asesorar(consulta, PRODUCTOS);

describe('Ante una enfermedad, el asesor no vende', () => {
  /**
   * Las crónicas son la parte que más llega a un mostrador naturista, y la que
   * faltaba: la lista solo cubría lo agudo y lo grave. El primer caso es el que
   * pidió la clienta con estas palabras — y es el que hay que negarse a hacer.
   */
  const CONSULTAS = [
    ['diabetes', 'mi papá tiene diabetes tipo 2 y le duelen las rodillas'],
    ['presión alta', 'algo para la presión alta de mi mamá'],
    ['gastritis', 'tengo gastritis, qué me recomiendas'],
    ['tiroides con medicación', 'tomo levotiroxina por la tiroides'],
    ['asma', 'mi hijo es asmático'],
    ['colesterol', 'tengo el colesterol alto'],
    ['antidepresivos', 'estoy tomando antidepresivos, qué puedo tomar'],
    ['anticonceptivos', 'tomo anticonceptivos, me sirve la hierba de san juan'],
    ['artritis', 'mi abuela tiene artritis'],
    ['anemia', 'me detectaron anemia'],
    ['cáncer', 'tengo cáncer, qué me sirve'],
    ['embarazo', 'mi esposa está embarazada, qué puede tomar'],
    ['epilepsia', 'mi hija tiene epilepsia'],
    ['anticoagulantes', 'mi papá toma warfarina'],
  ];

  for (const [caso, consulta] of CONSULTAS) {
    test(`deriva y no recomienda nada: ${caso}`, async () => {
      const r = await responder(consulta);
      assert.equal(r.derivar, true, `no derivó: «${consulta}»`);
      assert.equal(r.recomendaciones.length, 0,
        `derivó pero igual ofreció ${r.recomendaciones.map((p) => p.nombre).join(', ')}`);
      assert.ok(!/dosis|cucharad|capsulas al dia|veces al dia/i.test(r.mensaje),
        'la respuesta insinúa una posología');
    });
  }

  test('el mensaje ofrece atención presencial, no solo un portazo', async () => {
    const r = await responder('mi papá tiene diabetes tipo 2');
    assert.match(r.mensaje, /medico|nutricionista/i, 'no deriva a un profesional');
    // El límite legal tiene que convertirse en una visita al local: es la
    // ventaja que ningún competidor puede copiar.
    assert.match(r.mensaje, /agendar|agendarte|presencial|venir/i,
      'no ofrece agendar una atención en el local');
    assert.match(r.mensaje, /nombre/i, 'no pide el nombre para apartar el turno');
  });
});

describe('Pero el bienestar se responde con normalidad', () => {
  /**
   * La otra mitad del límite. Descanso, digestión y energía son categorías de
   * bienestar, no enfermedades: si también se derivaran, el asesor dejaría de
   * servir para lo único que puede hacer.
   */
  const NORMALES = [
    ['descanso', 'algo para dormir mejor'],
    ['digestión', 'algo para la digestión'],
    ['energía', 'algo que me dé energía'],
    ['producto concreto', 'quiero maca en polvo'],
  ];

  for (const [caso, consulta] of NORMALES) {
    test(`no deriva: ${caso}`, async () => {
      const r = await responder(consulta);
      assert.equal(r.derivar, false, `derivó de más: «${consulta}»`);
    });
  }

  /**
   * El término se busca por principio de palabra y no como subcadena suelta.
   *
   * Con `includes` a secas «tengo una necesidad» derivaba por SIDA —la palabra
   * lleva «sida» dentro— y a alguien que solo quería comprar se le respondía
   * que fuera al médico. Al sumar las crónicas el problema se multiplicaba:
   * «asma» vive dentro de «plasma» y de «fantasma».
   */
  const FALSOS_POSITIVOS = [
    ['«necesidad» lleva «sida» dentro', 'tengo una necesidad'],
    ['«plasma» lleva «asma» dentro', 'quiero plasma marino'],
    ['«fantasma» también', 'me quedó un sabor fantasma'],
  ];

  for (const [caso, consulta] of FALSOS_POSITIVOS) {
    test(`no deriva por parecido: ${caso}`, async () => {
      const r = await responder(consulta);
      assert.equal(r.derivar, false, `derivó por subcadena: «${consulta}»`);
    });
  }
});
