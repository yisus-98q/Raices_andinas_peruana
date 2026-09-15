/**
 * El precio sigue al tamaño, y los nombres llevan sus tildes.
 *
 * El relleno de demostración mostraba un gotero de 30 ml a S/ 27.90 junto a la
 * botella de 500 ml a S/ 29.40, y la semilla escribía «Manzanilla Organica» o
 * «60 capsulas». Se revisan las tres fuentes: la regla (precio-por-tamano.mjs),
 * el catálogo generado (data/catalogo.json) y la semilla con su migración, que
 * pone al día una base ya sembrada sin tocar lo que la dueña cambió a mano ni
 * los pedidos registrados.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contenidoDe, productoBase, preciosPorTamano } from '../precio-por-tamano.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const sinTildes = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

describe('La regla: lo grande cuesta más, y no más caro por unidad', () => {
  test('lee el contenido de una presentación', () => {
    assert.deepEqual(contenidoDe('Bolsa 1 kg'), { unidad: 'g', cantidad: 1000 });
    assert.equal(contenidoDe('3 barras 100 g').cantidad, 300);
    assert.deepEqual(contenidoDe('Caja 20 sachets'), { unidad: 'filtrantes', cantidad: 20 });
    assert.deepEqual(contenidoDe('Botella 1 L'), { unidad: 'ml', cantidad: 1000 });
  });

  test('reconoce el mismo producto en otra presentación, y no confunde distintos', () => {
    assert.equal(productoBase('Aceite de Aguaje en gotas'), productoBase('Aceite de Aguaje'));
    assert.notEqual(productoBase('Maca Negra en polvo'), productoBase('Maca Gelatinizada'));
  });

  test('corrige el gotero que costaba casi como la botella, y una segunda pasada no cambia nada', () => {
    const items = [
      { nombre: 'Aceite X', categoria: 'A', origen: 'O', presentacion: 'Botella 500 ml', precio: 29.4, costo: 13 },
      { nombre: 'Aceite X en gotas', categoria: 'A', origen: 'O', presentacion: 'Gotero 30 ml', precio: 27.9, costo: 14 },
    ];
    const cambios = preciosPorTamano(items);
    assert.equal(cambios.length, 1, JSON.stringify(cambios));
    const gotero = cambios[0];
    assert.ok(gotero.precio <= 29.4 / Math.cbrt(500 / 30) + 0.01, `el gotero quedó en ${gotero.precio}`);
    assert.ok(gotero.costo < gotero.precio);

    // Idempotente: aplicado el cambio, ya no hay nada que corregir.
    const aplicados = items.map((p) => (p.presentacion === 'Gotero 30 ml' ? { ...p, precio: gotero.precio, costo: gotero.costo } : p));
    assert.equal(preciosPorTamano(aplicados).length, 0);
  });
});

describe('El catálogo generado', () => {
  const catalogo = JSON.parse(readFileSync(join(RAIZ, 'data', 'catalogo.json'), 'utf8'));
  const precio = (nombre) => catalogo.find((p) => p.nombre === nombre)?.precio;

  test('ya cumple la regla y el costo siempre queda debajo del precio', () => {
    assert.equal(preciosPorTamano(catalogo.map((p) => ({ ...p }))).length, 0);
    assert.ok(catalogo.every((p) => p.costo < p.precio));
  });

  test('el gotero de Aguaje cuesta menos de la mitad que la botella', () => {
    assert.ok(precio('Aceite de Aguaje en gotas') < precio('Aceite de Aguaje') / 2,
      `${precio('Aceite de Aguaje en gotas')} contra ${precio('Aceite de Aguaje')}`);
  });

  test('no hay dos nombres iguales al quitar tildes', () => {
    const vistos = new Map();
    const repetidos = [];
    for (const p of catalogo) {
      const clave = sinTildes(p.nombre);
      if (vistos.has(clave)) repetidos.push(`${vistos.get(clave)} / ${p.nombre}`);
      else vistos.set(clave, p.nombre);
    }
    assert.deepEqual(repetidos, []);
  });
});

/** Base desechable sembrada con `db.js --reset`. */
function sembrar() {
  const carpeta = mkdtempSync(join(tmpdir(), 'ra-tildes-'));
  const dbPath = join(carpeta, 'prueba.db');
  const r = spawnSync(process.execPath, ['db.js', '--reset'], {
    cwd: RAIZ, env: { ...process.env, DB_PATH: dbPath }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return { carpeta, dbPath };
}

/** Arranca db.js sobre la base, como lo hace el servidor al iniciar. */
const importarDb = (dbPath) => spawnSync(process.execPath, ['-e', "import('./db.js')"], {
  cwd: RAIZ, env: { ...process.env, DB_PATH: dbPath }, encoding: 'utf8',
});

describe('La semilla y la migración', () => {
  test('la semilla trae los nombres con sus tildes y sin duplicados activos', () => {
    const { carpeta, dbPath } = sembrar();
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const campo = (sku, c) => db.prepare(`SELECT ${c} v FROM productos WHERE sku = ?`).get(sku)?.v;
      assert.equal(campo('MAN-001', 'nombre'), 'Manzanilla Orgánica');
      assert.equal(campo('UNG-001', 'presentacion'), '60 cápsulas 500 mg');
      assert.equal(campo('POL-001', 'origen'), 'Cañete, Lima');
      assert.equal(campo('JAB-001', 'nombre'), 'Jabón de Aguaje y Avena');
      const nombres = db.prepare('SELECT nombre FROM productos WHERE activo = 1').all().map((p) => sinTildes(p.nombre));
      const repetidos = nombres.filter((n, i) => nombres.indexOf(n) !== i);
      db.close();
      assert.deepEqual(repetidos, []);
    } finally {
      rmSync(carpeta, { recursive: true, force: true });
    }
  });

  test('pone al día una base vieja sin pisar lo editado a mano ni los pedidos', () => {
    const { carpeta, dbPath } = sembrar();
    try {
      let db = new DatabaseSync(dbPath);
      // Lo que tenía una base sembrada antes de este cambio…
      db.prepare("UPDATE productos SET nombre = 'Manzanilla Organica' WHERE sku = 'MAN-001'").run();
      db.prepare("UPDATE productos SET nombre = 'Jabon de Aguaje y Avena' WHERE sku = 'JAB-001'").run();
      // …lo que la dueña reescribió a mano…
      db.prepare("UPDATE productos SET nombre = 'Boldo del Norte' WHERE sku = 'BOL-001'").run();
      // …un duplicado de relleno activo…
      const plantilla = db.prepare("SELECT * FROM productos WHERE sku = 'JAB-001'").get();
      db.prepare(`INSERT INTO productos (sku, nombre, categoria, origen, presentacion, descripcion,
        uso_tradicional, precio, costo, stock, demo, activo) VALUES ('CUI-999', 'Jabón de Aguaje y Avena', ?, ?, ?, ?, ?, 10, 5, 10, 1, 1)`)
        .run(plantilla.categoria, plantilla.origen, plantilla.presentacion, plantilla.descripcion, plantilla.uso_tradicional);
      // …y el precio incoherente del gotero de relleno.
      db.prepare("UPDATE productos SET precio = 27.9, costo = 14.1 WHERE nombre = 'Aceite de Aguaje en gotas' AND demo = 1").run();
      const curados = JSON.stringify(db.prepare('SELECT id, precio, costo FROM productos WHERE demo = 0 ORDER BY id').all());
      const items = JSON.stringify(db.prepare('SELECT COUNT(*) n, COALESCE(SUM(subtotal),0) s, COALESCE(SUM(costo_unit),0) c FROM pedido_items').get());
      db.close();

      const primera = importarDb(dbPath);
      assert.equal(primera.status, 0, primera.stdout + primera.stderr);

      db = new DatabaseSync(dbPath, { readOnly: true });
      const campo = (sku, c) => db.prepare(`SELECT ${c} v FROM productos WHERE sku = ?`).get(sku)?.v;
      assert.equal(campo('MAN-001', 'nombre'), 'Manzanilla Orgánica');
      assert.equal(campo('BOL-001', 'nombre'), 'Boldo del Norte', 'pisó una edición de la dueña');
      assert.equal(campo('JAB-001', 'nombre'), 'Jabón de Aguaje y Avena');
      assert.equal(campo('CUI-999', 'activo'), 0, 'el duplicado de relleno sigue a la venta');
      const gotas = db.prepare("SELECT precio, costo FROM productos WHERE nombre = 'Aceite de Aguaje en gotas' AND demo = 1").get();
      assert.ok(gotas.precio < 29.4 / 2 && gotas.costo < gotas.precio, JSON.stringify(gotas));
      assert.equal(JSON.stringify(db.prepare('SELECT id, precio, costo FROM productos WHERE demo = 0 ORDER BY id').all()), curados,
        'cambió el precio de un producto del negocio');
      assert.equal(JSON.stringify(db.prepare('SELECT COUNT(*) n, COALESCE(SUM(subtotal),0) s, COALESCE(SUM(costo_unit),0) c FROM pedido_items').get()), items);
      db.close();

      // Una segunda vez ya no hay nada que poner al día.
      const segunda = importarDb(dbPath);
      assert.equal(segunda.status, 0, segunda.stdout + segunda.stderr);
      assert.doesNotMatch(segunda.stdout, /catálogo al día/);
    } finally {
      rmSync(carpeta, { recursive: true, force: true });
    }
  });
});
