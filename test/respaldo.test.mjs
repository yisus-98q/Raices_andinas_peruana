/**
 * Respaldo de la base.
 *
 * Lo que se prueba aqui no es que el archivo aparezca: es que **sirva**. Un
 * respaldo ilegible se ve igual que uno bueno hasta el dia que hace falta, y
 * ese dia ya no hay a quien preguntarle.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

let carpeta, dbPath, dirResp, respaldo;

before(async () => {
  carpeta = mkdtempSync(join(tmpdir(), 'ra-resp-'));
  dbPath = join(carpeta, 'prueba.db');
  dirResp = join(carpeta, 'respaldos');

  const semilla = spawnSync(process.execPath, ['db.js', '--reset'], {
    cwd: RAIZ, env: { ...process.env, DB_PATH: dbPath }, stdio: 'ignore',
  });
  assert.equal(semilla.status, 0, 'la semilla de prueba debe cargar');

  // El modulo lee DB_PATH y RESPALDO_DIR al importarse, asi que se fijan antes.
  process.env.DB_PATH = dbPath;
  process.env.RESPALDO_DIR = dirResp;
  respaldo = await import('../respaldo.js');
});

after(async () => {
  // En Windows no se borra una carpeta con un .db todavia abierto, y este test
  // importa db.js — que mantiene el archivo abierto mientras viva el proceso.
  try { (await import('../db.js')).db.close(); } catch { /* ya cerrada */ }
  // La limpieza no puede tumbar la suite: lo que se probaba ya se probo, y el
  // sistema vacia su propio tmp.
  try { rmSync(carpeta, { recursive: true, force: true }); } catch { /* el SO lo hara */ }
});

describe('Respaldo de la base', () => {
  test('la copia se puede abrir y tiene los datos', () => {
    const r = respaldo.respaldar();
    assert.ok(r.bytes > 0, 'el respaldo no puede estar vacio');

    const copia = new DatabaseSync(join(dirResp, r.archivo), { readOnly: true });
    assert.equal(copia.prepare('SELECT COUNT(*) n FROM productos').get().n, 400);
    copia.close();
  });

  test('el nombre lleva la fecha del dia', () => {
    const r = respaldo.respaldar();
    assert.match(r.archivo, /^tienda-\d{4}-\d{2}-\d{2}\.db$/);
    assert.equal(r.archivo, `tienda-${respaldo.hoy()}.db`);
  });

  /**
   * El caso que de verdad importa: una venta que entro y todavia vive en el
   * WAL. Copiando el archivo a pelo se perderia y la copia abriria sin
   * quejarse. Con VACUUM INTO tiene que estar.
   */
  test('arrastra lo que aun esta en el WAL', async () => {
    const { db } = await import('../db.js');
    db.prepare(`INSERT INTO pedidos (codigo,cliente_nombre,cliente_tel,cliente_dir,total)
      VALUES (?,?,?,?,?)`).run('RA-WAL-0001', 'Prueba WAL', '999888777', 'Calle 1', 10);

    const r = respaldo.respaldar('2026-01-02');
    const copia = new DatabaseSync(join(dirResp, r.archivo), { readOnly: true });
    const p = copia.prepare('SELECT codigo FROM pedidos WHERE codigo = ?').get('RA-WAL-0001');
    copia.close();
    assert.ok(p, 'la venta recien hecha debe estar en el respaldo');
  });

  test('respaldar dos veces el mismo dia reescribe, no acumula', () => {
    respaldo.respaldar('2026-03-04');
    respaldo.respaldar('2026-03-04');
    const delDia = readdirSync(dirResp).filter((n) => n.includes('2026-03-04'));
    assert.equal(delDia.length, 1);
  });

  test('no deja archivos .parcial detras', () => {
    respaldo.respaldar('2026-03-05');
    const sobras = readdirSync(dirResp).filter((n) => n.endsWith('.parcial'));
    assert.deepEqual(sobras, []);
  });

  test('un respaldo ilegible se descarta en vez de guardarse', () => {
    // Un .db que no es un .db: es lo que queda cuando el disco se llena a
    // medias de escribir. Se cuela por `restaurar`, que tambien comprueba.
    const basura = join(dirResp, 'tienda-2020-01-01.db');
    writeFileSync(basura, 'esto no es una base de datos');
    assert.throws(() => respaldo.restaurar('tienda-2020-01-01.db'), /ileg/i);
  });

  test('la rotacion guarda los ultimos y borra los demas', () => {
    for (let i = 1; i <= 20; i++) {
      respaldo.respaldar(`2025-06-${String(i).padStart(2, '0')}`);
    }
    const quedan = respaldo.listar();
    assert.equal(quedan.length, respaldo.DIAS_QUE_SE_GUARDAN);
    // Se quedan los mas nuevos: el 20 de junio tiene que estar y el 1 no.
    const fechas = quedan.map((r) => r.fecha);
    assert.ok(fechas.includes('2025-06-20'));
    assert.ok(!fechas.includes('2025-06-01'));
  });

  test('listar devuelve vacio si la carpeta no existe todavia', async () => {
    process.env.RESPALDO_DIR = join(carpeta, 'no-existe-aun');
    const otro = await import(`../respaldo.js?nuevo=${Date.now()}`);
    assert.deepEqual(otro.listar(), []);
    process.env.RESPALDO_DIR = dirResp;
  });

  test('restaurar deja una red antes de pisar la base', () => {
    const antes = statSync(dbPath).size;
    const r = respaldo.restaurar(respaldo.ultimo().archivo);
    assert.ok(existsSync(join(dirResp, r.red)), 'debe guardar la base anterior');
    assert.ok(statSync(join(dirResp, r.red)).size >= antes - 1);
  });

  /**
   * El que faltaba, y el que importa: que despues de restaurar los datos ESTEN.
   * La primera version de este modulo importaba db.js, que al cargarse creaba
   * la base vacia y se quedaba con ella abierta; restaurar escribia la copia
   * buena y la conexion la volvia a pisar con su estado vacio. Todos los demas
   * tests pasaban: el archivo aparecia, la red se guardaba, el tamaño cuadraba.
   * Solo contar las filas despues lo delata.
   */
  test('despues de restaurar la base tiene los datos, no un cascaron', async () => {
    const bueno = respaldo.respaldar('2027-01-01');

    // Se restaura con el servidor parado, que es la condicion real: mientras
    // algo tenga la base abierta, Windows no deja ni borrar el archivo. Aqui
    // ese algo es el db.js que importo el test del WAL.
    (await import('../db.js')).db.close();

    // Se borra la base entera, como cuando se pierde la laptop.
    for (const sufijo of ['', '-wal', '-shm']) {
      try { rmSync(dbPath + sufijo); } catch { /* no siempre existe */ }
    }
    assert.ok(!existsSync(dbPath), 'la base debe estar borrada para la prueba');

    respaldo.restaurar(bueno.archivo);

    const vuelta = new DatabaseSync(dbPath, { readOnly: true });
    const productos = vuelta.prepare('SELECT COUNT(*) n FROM productos').get().n;
    vuelta.close();
    assert.equal(productos, 400, 'los 400 productos tienen que volver');
  });

  /**
   * La prueba que de verdad guarda contra la regresion: restaurar **en su
   * propio proceso**, con la base borrada y nadie mas tocandola. Es como se
   * restaura de verdad — `node respaldo.mjs --restaurar` — y es el caso que
   * fallaba: al importar el modulo se creaba la base vacia y se quedaba
   * abierta, y la copia buena se perdia sin un solo mensaje de error.
   */
  test('la CLI restaura con la base borrada, en proceso limpio', () => {
    const bueno = respaldo.respaldar('2027-02-02');
    for (const sufijo of ['', '-wal', '-shm']) {
      try { rmSync(dbPath + sufijo); } catch { /* no siempre existe */ }
    }

    const r = spawnSync(process.execPath, ['respaldo.mjs', '--restaurar', bueno.archivo], {
      cwd: RAIZ,
      env: { ...process.env, DB_PATH: dbPath, RESPALDO_DIR: dirResp },
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, `la CLI debe terminar bien: ${r.stderr}`);

    const vuelta = new DatabaseSync(dbPath, { readOnly: true });
    const n = vuelta.prepare('SELECT COUNT(*) n FROM productos').get().n;
    vuelta.close();
    assert.equal(n, 400, 'los productos tienen que estar despues de restaurar');
  });

  test('restaurar un archivo que no existe avisa y no toca nada', () => {
    assert.throws(() => respaldo.restaurar('tienda-1999-12-31.db'), /No existe/);
    assert.ok(existsSync(dbPath), 'la base no se puede quedar sin archivo');
  });
});
