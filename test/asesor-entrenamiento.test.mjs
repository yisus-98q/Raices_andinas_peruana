/**
 * El asesor entiende cómo escribe la gente, y no se desentrena.
 *
 * Muestra de un banco de 146 consultas reales —faltas, jerga, sin tildes,
 * abreviaturas de WhatsApp— más 36 de control que no se usaron para ajustar.
 * Antes del entrenamiento el asesor acertaba el 76,7 % del banco: «a q numero
 * yapeo» recibía maca, «toy embarasada» recibía maca, «uña de gat» recibía
 * maca. Cada frase de aquí es una que fallaba o una que representa a su grupo.
 *
 * Además de lo esperado, cada respuesta pasa por las reglas que no se rompen:
 * sin cifras de stock ni conteos, sin dosis y sin recomendar lo agotado.
 *
 * Va contra `asesorar()` con una base sembrada aparte, como asesor-salud: el
 * límite tiene que sostenerse sin red, clave ni modelo.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { asesorar } from '../asesor.js';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

const carpeta = mkdtempSync(join(tmpdir(), 'ra-entreno-'));
const dbPath = join(carpeta, 'prueba.db');
const semilla = spawnSync(process.execPath, ['db.js', '--reset'], {
  cwd: RAIZ, env: { ...process.env, DB_PATH: dbPath }, stdio: 'ignore',
});
assert.equal(semilla.status, 0, 'la semilla de prueba debe cargar');
const db = new DatabaseSync(dbPath, { readOnly: true });
const PRODUCTOS = db.prepare('SELECT * FROM productos WHERE activo = 1').all();
db.close();
rmSync(carpeta, { recursive: true, force: true });

const PEDIDO = { codigo: 'RA-20260914-ABC', estado: 'pendiente', creado_en: '2026-09-14 10:00:00', total: 64.5 };
const responder = (consulta) =>
  asesorar(consulta, PRODUCTOS, (c) => (c === PEDIDO.codigo ? PEDIDO : null));

const plano = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Las reglas de siempre, sobre cualquier respuesta. */
function reglasQueNoSeRompen(r, consulta) {
  assert.doesNotMatch(r.mensaje, /\b(hay|tengo|quedan|faltan|las otras)\s+\d+|en almac[eé]n|\d+\s+productos/i,
    `«${consulta}» da cifras de stock: ${r.mensaje}`);
  assert.doesNotMatch(r.mensaje,
    /\b(\d+|una|dos|tres)\s+(veces|tazas|cucharad\w*|gotas|c[aá]psulas)\s+(al|por|cada|diari)|\ben ayunas\b|\bveces al d[ií]a\b/i,
    `«${consulta}» indica una dosis: ${r.mensaje}`);
  for (const p of r.recomendaciones) {
    assert.notEqual(p.disponible, false, `«${consulta}» recomienda ${p.nombre}, que está agotado`);
  }
}

describe('Bienestar dicho como lo dice la gente', () => {
  const DESCANSO = /valeriana|manzanilla|graviola|magnesio|melatonina|lavanda|toronjil|pasiflora|cedron|hierba luisa/;
  const DIGESTION = /muna|boldo|manzanilla|cedron|probiotic|jengibre|carbon|linaza|chia|gelatinizada|plantago|yacon/;
  const ENERGIA = /maca|polen|jalea|algarrob|kiwicha|quinua|espirulina|hierro|miel|camu|vitamina/;
  const CASOS = [
    ['algo pa dormir', DESCANSO],
    ['algo q me relaje', DESCANSO],
    ['me despierto a cada rato en la noche', DESCANSO],
    ['me cae pesada la comida', DIGESTION],
    ['estoy estreñido', DIGESTION],
    ['ando cansado todo el día', ENERGIA],
    ['algo q me de fuerzas', ENERGIA],
    ['tengo granitos en la cara', /jabon|zinc|jojoba|aguaje|rosa mosqueta|copaiba/],
    ['se me cae el pelo', /romero|ortiga|ungurahui|cola de caballo|biotina|colageno|capilar/],
    ['algo pa la tos d mi hijo', /miel|propoleo|eucalipto|wira|llanten|sauco|jengibre/],
    ['me duelen las rodillas', /una de gato|colageno|curcuma|copaiba|arnica|magnesio/],
    ['piernas cansadas', /arnica|copaiba|crema de muna|cola de caballo|sales de ba|gel de/],
  ];
  for (const [consulta, esperado] of CASOS) {
    test(`«${consulta}»`, async () => {
      const r = await responder(consulta);
      reglasQueNoSeRompen(r, consulta);
      assert.equal(r.derivar, false, `derivó sin motivo: «${consulta}»`);
      assert.ok(r.recomendaciones.length, `no entendió «${consulta}»: ${r.mensaje}`);
      const nombres = r.recomendaciones.map((p) => plano(p.nombre));
      assert.ok(nombres.some((n) => esperado.test(n)), `«${consulta}» no calza: ${nombres.join(' · ')}`);
      assert.ok(nombres.filter((n) => !esperado.test(n)).length < 2,
        `«${consulta}» trae dos o más que no vienen al caso: ${nombres.join(' · ')}`);
    });
  }

  test('cierra con una pregunta útil, no con una lista suelta', async () => {
    const r = await responder('no puedo dormir');
    assert.match(r.mensaje, /¿Es para ti o para alguien de la casa\?/);
  });

  test('sin nada que calce pregunta qué busca, no empuja productos', async () => {
    const r = await responder('asdf qwerty');
    assert.equal(r.recomendaciones.length, 0, 'ofreció productos a una consulta que no entendió');
    assert.match(r.mensaje, /¿Qué estás buscando\?/);
  });
});

describe('El producto pedido por su nombre, aunque venga mal escrito', () => {
  const CASOS = [
    ['uña de gat', /una de gato/],
    ['maka negra', /maca negra/],
    ['tienes maka', /maca/],
    ['propolio en gotas', /propoleo/],
    ['sangre de drago', /sangre de grado/],
    ['hercanpuri', /hercampuri/],
    ['chanka piedra', /chanca piedra/],
    ['vendes cola d caballo', /cola de caballo/],
  ];
  for (const [consulta, esperado] of CASOS) {
    test(`«${consulta}»`, async () => {
      const r = await responder(consulta);
      reglasQueNoSeRompen(r, consulta);
      const nombres = r.recomendaciones.map((p) => plano(p.nombre));
      assert.ok(nombres.some((n) => esperado.test(n)), `«${consulta}» no trajo el producto: ${nombres.join(' · ') || r.mensaje}`);
    });
  }

  test('nombrado el producto, pregunta cómo se lo lleva', async () => {
    const r = await responder('maka negra');
    assert.match(r.mensaje, /¿Lo recoges en el puesto o te lo mandamos\?/);
  });

  test('«gotas» es el envase, no el producto', async () => {
    const r = await responder('quiero propoleo en gotas');
    for (const p of r.recomendaciones) {
      assert.match(plano(p.nombre), /propoleo/, `coló ${p.nombre} solo por decir «gotas»`);
    }
  });
});

describe('Intenciones de negocio con jerga', () => {
  const CASOS = [
    ['a q numero yapeo', 'pago'],
    ['pago contraentrega?', 'pago'],
    ['llega hoy a miraflores?', 'delivery'],
    ['hacen envíos a provincias', 'delivery'],
    ['precio por mayor', 'mayorista'],
    ['soy revendedora', 'mayorista'],
    ['no hay rebajita', 'regateo'],
    ['me llego roto el frasco', 'devolucion'],
    ['ya pasaron 3 dias y nada', 'reclamo'],
    ['no es bamba?', 'autenticidad'],
    ['holaaa', 'saludo'],
    ['q productos venden', 'catalogo'],
    ['en q parte del mercado central estan', 'ubicacion'],
  ];
  for (const [consulta, intencion] of CASOS) {
    test(`«${consulta}» → ${intencion}`, async () => {
      const r = await responder(consulta);
      reglasQueNoSeRompen(r, consulta);
      assert.equal(r.intencion, intencion, `«${consulta}» se leyó como ${r.intencion || 'productos'}`);
    });
  }

  test('«que tienen para…» pide un producto, no el catálogo entero', async () => {
    const r = await responder('q tienen pa el insomnio');
    assert.notEqual(r.intencion, 'catalogo');
    assert.ok(r.recomendaciones.length);
  });

  test('la respuesta mayorista no promete decir cuántas hay', async () => {
    const r = await responder('precio por mayor');
    assert.doesNotMatch(r.mensaje, /cu[aá]ntas (tengo|hay)/i);
  });

  test('la cotización no da la cifra y pregunta cómo se entrega', async () => {
    const r = await responder('cuanto me sale 30 frascos de miel');
    reglasQueNoSeRompen(r, 'cotización');
    assert.equal(r.intencion, 'cotizacion');
    assert.match(r.mensaje, /¿Lo recoges en el puesto o te lo mandamos\?/);
  });
});

describe('La jerga y las erratas no esquivan la derivación', () => {
  const CASOS = [
    'toy embarasada',
    'tengo diabetis',
    'mi bb tiene fiebre',
    'tomo pastillas pa la presion',
    'mi viejito toma warfarina',
    'me dio un dolor fuerte en el pecho',
    'mi nieto de 6 meses no duerme',
    'soy hipertensa',
  ];
  for (const consulta of CASOS) {
    test(`deriva: «${consulta}»`, async () => {
      const r = await responder(consulta);
      assert.equal(r.derivar, true, `no derivó: «${consulta}» → ${r.mensaje}`);
      assert.equal(r.recomendaciones.length, 0);
      assert.match(r.mensaje, /dueña/, 'no ofrece la cita con la dueña');
    });
  }

  test('corregir erratas nunca convierte una palabra común en un producto', async () => {
    // «cada» estaba a una letra de «caida» y traía productos para el cabello.
    const r = await responder('me despierto a cada rato');
    for (const p of r.recomendaciones) {
      assert.doesNotMatch(plano(p.nombre), /capilar|ungurahui|biotina/, `coló ${p.nombre}`);
    }
  });
});
