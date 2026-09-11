/**
 * Carga del catalogo real.
 *
 * Lo que se prueba no es "el CSV se lee": es que sobreviva al archivo que de
 * verdad llega — el que sale del Excel de una tienda en Peru, con punto y coma
 * por separador, coma decimal, tildes en las cabeceras y el BOM invisible
 * delante. Y que el catalogo de demostracion **deje libres los nombres
 * reales**, que es el detalle que hacia inutilizable el importador.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerCsv, aNumero } from '../csv.js';
import { levantarServidor, cliente } from './ayuda.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOM = String.fromCharCode(0xFEFF);

describe('Lectura del CSV que llega de verdad', () => {
  test('detecta el punto y coma del Excel peruano', () => {
    const { filas, separador } = leerCsv('nombre;precio\nMaca;28,50\n');
    assert.equal(separador, ';');
    assert.equal(filas[0].nombre, 'Maca');
  });

  test('se traga el BOM que escribe el Excel', () => {
    const { columnas, filas } = leerCsv(`${BOM}nombre,precio\nMaca,28.50\n`);
    assert.deepEqual(columnas, ['nombre', 'precio']);
    assert.equal(filas[0].nombre, 'Maca', 'la primera columna debe encontrarse');
  });

  test('normaliza cabeceras con tildes, mayusculas y espacios', () => {
    const { columnas } = leerCsv('Nombre , Categoría ,PRECIO,Stock min\nا,ا,1,1\n');
    assert.ok(columnas.includes('categoria'));
    assert.ok(columnas.includes('precio'));
    assert.ok(columnas.includes('stockmin'));
  });

  test('respeta el separador dentro de comillas', () => {
    const { filas } = leerCsv('nombre,etiquetas\nMaca,"energia,cansancio,fuerza"\n');
    assert.equal(filas[0].etiquetas, 'energia,cansancio,fuerza');
  });

  test('una comilla literal va doblada', () => {
    const { filas } = leerCsv('nombre\n"Maca ""negra"" en polvo"\n');
    assert.equal(filas[0].nombre, 'Maca "negra" en polvo');
  });

  test('aguanta CRLF y filas en blanco', () => {
    const { filas } = leerCsv('nombre,precio\r\nMaca,28\r\n\r\nUña,32\r\n');
    assert.equal(filas.length, 2);
    assert.equal(filas[1].nombre, 'Uña');
  });

  test('dice el numero de linea real, para poder corregir el Excel', () => {
    const { filas } = leerCsv('nombre\nA\nB\nC\n');
    assert.deepEqual(filas.map((f) => f._linea), [2, 3, 4]);
  });
});

describe('Numeros escritos por una persona', () => {
  const casos = [
    ['28.50', 28.5], ['24,90', 24.9], ['S/ 24.90', 24.9],
    ['1 234,50', 1234.5], ['1.234,50', 1234.5], ['1,234.50', 1234.5],
    ['1.234', 1234], ['150', 150], ['0', 0],
  ];
  for (const [texto, esperado] of casos) {
    test(`«${texto}» es ${esperado}`, () => assert.equal(aNumero(texto), esperado));
  }
  test('lo ilegible es null, no cero', () => {
    // Un cero silencioso seria un producto a precio cero en la tienda.
    assert.equal(aNumero(''), null);
    assert.equal(aNumero('a consultar'), null);
  });
});

describe('Vaciar el catalogo de demostracion', () => {
  let carpeta, dbPath;

  before(() => {
    carpeta = mkdtempSync(join(tmpdir(), 'ra-cat-'));
    dbPath = join(carpeta, 'prueba.db');
    const s = spawnSync(process.execPath, ['db.js', '--reset'], {
      cwd: RAIZ, env: { ...process.env, DB_PATH: dbPath }, stdio: 'ignore',
    });
    assert.equal(s.status, 0);
  });

  after(() => {
    try { rmSync(carpeta, { recursive: true, force: true }); } catch { /* Windows */ }
  });

  test('borra los productos y deja el resto de la base en pie', () => {
    const s = spawnSync(process.execPath, ['db.js', '--vacio'], {
      cwd: RAIZ, env: { ...process.env, DB_PATH: dbPath }, encoding: 'utf8',
    });
    assert.equal(s.status, 0, s.stderr);
    assert.match(s.stdout, /Catalogo vaciado/);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM productos').get().n, 0);

    // La base sigue siendo la base: se vacia el catalogo, no se tira el
    // esquema. Las tablas de usuarios y pedidos tienen que seguir ahi — si
    // `--vacio` se llevara alguna, el servidor arrancaria contra una base a
    // medias y lo descubririamos en la demo.
    const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all().map((t) => t.name);
    for (const t of ['usuarios', 'pedidos', 'comprobantes', 'movimientos_stock']) {
      assert.ok(tablas.includes(t), `falta la tabla ${t}`);
    }
    db.close();
  });
});

describe('Importar el catalogo real, punta a punta', () => {
  let srv, admin, csv;

  before(async () => {
    srv = await levantarServidor();
    admin = cliente(srv.base);
    await admin.pedir('/api/login', {
      metodo: 'POST', cuerpo: { correo: 'qa@raizandina.pe', clave: 'claveDePrueba2026' },
    });

    // El catalogo de demostracion se vacia primero: es el paso que libera los
    // nombres reales. Sin el, «Maca Negra en polvo» estaria ocupada.
    const s = spawnSync(process.execPath, ['db.js', '--vacio'], {
      cwd: RAIZ, env: { ...process.env, DB_PATH: srv.dbPath }, stdio: 'ignore',
    });
    assert.equal(s.status, 0);

    // Tal como sale del Excel: punto y coma, coma decimal, «S/» delante,
    // cabeceras con tilde. Y dos filas malas a proposito.
    csv = join(tmpdir(), `lista-${Date.now()}.csv`);
    writeFileSync(csv, [
      'Nombre;Categoría;Presentación;Precio;Costo;Stock;Stock min;Etiquetas',
      'Maca Negra en polvo;Superalimentos;Bolsa 250 g;S/ 28,50;17,00;24;8;"energia,fuerza"',
      'Uña de Gato en cápsulas;Hierbas;60 cápsulas;32,00;19,50;15;6;"defensas"',
      'Sin precio;Hierbas;Bolsa 100 g;;5,00;10;5;',
      'A perdida;Aceites;Frasco 100 ml;15,00;40,00;5;2;',
      '',
    ].join('\n'), 'utf8');
  });

  after(async () => {
    await srv?.parar();
    try { rmSync(csv); } catch { /* ya no estaba */ }
  });

  const importar = (extra = []) => spawnSync(
    process.execPath, ['importar-catalogo.mjs', csv, ...extra],
    {
      cwd: RAIZ,
      env: {
        ...process.env,
        DB_PATH: srv.dbPath,
        URL_TIENDA: srv.base,
        ADMIN_EMAIL: 'qa@raizandina.pe',
        ADMIN_PASSWORD: 'claveDePrueba2026',
        RESPALDO_DIR: join(dirname(srv.dbPath), 'respaldos'),
      },
      encoding: 'utf8',
    },
  );

  test('--probar no escribe nada', async () => {
    const r = importar(['--probar']);
    assert.match(r.stdout, /no se escribe nada/);
    const { json: cuerpo } = await admin.pedir('/api/admin/productos');
    assert.equal(cuerpo.length, 0, 'en seco no puede entrar ni uno');
  });

  test('carga los buenos y rechaza los malos, con el numero de linea', () => {
    const r = importar();
    assert.match(r.stdout, /Cargados: 2/);
    assert.match(r.stdout, /Rechazados: 2/);
    // El precio vacio y el costo por encima del precio los rechaza el servidor
    // con sus propias palabras: la regla vive en un solo sitio.
    assert.match(r.stdout, /linea 4 · Sin precio/);
    assert.match(r.stdout, /linea 5 · A perdida.*pérdida/s);
  });

  test('los numeros del Excel llegan bien a la base', async () => {
    const { json: cuerpo } = await admin.pedir('/api/admin/productos');
    const maca = cuerpo.find((p) => p.nombre === 'Maca Negra en polvo');
    assert.ok(maca, 'la Maca tiene que estar');
    assert.equal(maca.precio, 28.5, '«S/ 28,50» son 28.50 soles');
    assert.equal(maca.costo, 17);
    assert.equal(maca.stock, 24);
    assert.equal(maca.stock_min, 8);
  });

  test('el SKU se asigna por categoria y el producto entra como del negocio', async () => {
    const { json: cuerpo } = await admin.pedir('/api/admin/productos');
    const maca = cuerpo.find((p) => p.nombre === 'Maca Negra en polvo');
    assert.match(maca.sku, /^SUP-\d{3}$/);
    // demo = 0: manda sobre cualquier relleno en las recomendaciones.
    assert.equal(maca.demo, 0);
  });

  test('el stock inicial queda en el kardex, no aparecido de la nada', async () => {
    const { json: cuerpo } = await admin.pedir('/api/admin/movimientos');
    const alta = cuerpo.find((m) => m.nombre === 'Maca Negra en polvo');
    assert.ok(alta, 'el alta debe dejar movimiento');
    assert.equal(alta.cantidad, 24);
  });

  test('pasar el mismo archivo dos veces no duplica', () => {
    const r = importar();
    assert.match(r.stdout, /Cargados: 0/);
    assert.match(r.stdout, /ese nombre/);
  });

  test('el asesor ya recomienda el catalogo real', async () => {
    const r = await admin.pedir('/api/asesor', {
      metodo: 'POST', cuerpo: { consulta: 'ando sin energia, muy cansado' },
    });
    const nombres = r.json.recomendaciones.map((p) => p.nombre);
    assert.ok(nombres.includes('Maca Negra en polvo'),
      `esperaba la Maca entre ${JSON.stringify(nombres)}`);
  });
});
