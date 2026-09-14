// RESPALDO_DIR se lee al importar: el .env tiene que estar cargado antes.
import './entorno.js';
import { DatabaseSync } from 'node:sqlite';
import {
  mkdirSync, readdirSync, statSync, unlinkSync, renameSync, copyFileSync, existsSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Respaldo de la base.
 *
 * Todo el negocio vive en un archivo. Si esa laptop se moja, se cae o se la
 * roban, se van las ventas, los clientes y el historial completo — y el dueño
 * tenia 27 años de cuadernos que, mojados y todo, seguian ahi. El respaldo no
 * puede ser peor que su caja de cuadernos.
 *
 * Cuatro decisiones que no son evidentes:
 *
 * 1. **Se copia con `VACUUM INTO`, no copiando el archivo.** La base corre en
 *    modo WAL: parte de lo escrito vive en `tienda.db-wal` y no en
 *    `tienda.db`. Copiar el archivo a pelo da una base a la que le faltan las
 *    ultimas ventas, y lo peor es que abre sin quejarse. `VACUUM INTO` le pide
 *    a SQLite una copia consistente estando la base en uso, sin cerrar el
 *    servidor ni bloquear una venta a medias.
 *
 * 2. **Uno por dia, con la fecha en el nombre.** No uno por hora: lo que se
 *    pierde es el dia, y catorce archivos legibles se revisan de un vistazo —
 *    trescientos con hora y minuto, no. El del dia se reescribe.
 *
 * 3. **Se escribe a un `.parcial` y se renombra al final.** Si la copia falla
 *    a medias —disco lleno, pendrive desconectado— el respaldo bueno de ese
 *    dia sigue intacto. Un respaldo a medias es peor que ninguno, porque se ve
 *    igual que uno completo.
 *
 * 4. **Este archivo NO importa `db.js`, y es deliberado.** Importarlo abre la
 *    base, y si el archivo no existe —el caso exacto en que hace falta
 *    restaurar— la **crea vacia** y se queda con ella abierta. Asi, restaurar
 *    escribia la copia buena y la conexion abierta la volvia a pisar con su
 *    estado vacio: la herramienta que debia salvar los datos los borraba, y sin
 *    decir nada. Aqui la ruta se calcula igual que en `db.js` y la conexion se
 *    abre solo para copiar, se cierra al terminar.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * `RESPALDO_DIR` es lo que de verdad protege: apuntarlo a un pendrive, a un
 * disco externo o a una carpeta que se sincronice. Una copia en el mismo disco
 * salva de un borrado por error, pero no de que se lleven la laptop. Por
 * defecto queda al lado de la base, que es mejor que nada y no pide configurar
 * nada para arrancar.
 */
export const DIR = process.env.RESPALDO_DIR || join(__dirname, 'data', 'respaldos');

/**
 * La misma ruta que calcula `db.js`, a proposito repetida: ver el punto 4 de
 * arriba. Si una cambia, la otra tambien.
 */
export const RUTA = process.env.DB_PATH || join(__dirname, 'data', 'tienda.db');

/** Catorce dias: dos semanas alcanza para notar un error y volver atras. */
export const DIAS_QUE_SE_GUARDAN = Number(process.env.RESPALDO_DIAS || 14);

const PREFIJO = 'tienda-';
const ESPERADO = /^tienda-(\d{4}-\d{2}-\d{2})\.db$/;

/** Fecha local en AAAA-MM-DD. `toISOString()` no sirve: da UTC y en Perú resta un día. */
export function hoy(d = new Date()) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

const rutaDe = (fecha) => join(DIR, `${PREFIJO}${fecha}.db`);

/** Las comillas simples se escapan doblandolas: es lo que entiende SQLite. */
const paraSql = (ruta) => ruta.split("'").join("''");

/**
 * Copia la base. Devuelve el archivo escrito, su tamaño y los que rotó.
 * `fecha` existe para las pruebas; en uso normal es hoy.
 */
export function respaldar(fecha = hoy()) {
  mkdirSync(DIR, { recursive: true });

  const destino = rutaDe(fecha);
  const parcial = `${destino}.parcial`;

  // VACUUM INTO se niega a escribir sobre un archivo que ya existe, así que el
  // parcial de un intento anterior interrumpido se limpia antes.
  if (existsSync(parcial)) unlinkSync(parcial);

  // Conexion propia y de vida corta. SQLite en modo WAL admite varios lectores
  // a la vez, asi que esto no interrumpe una venta en curso, y `VACUUM INTO`
  // arrastra lo que todavia vive en el WAL igual que lo veria el servidor.
  const origen = new DatabaseSync(RUTA, { readOnly: true });
  try {
    origen.exec(`VACUUM INTO '${paraSql(parcial)}'`);
  } finally {
    origen.close();
  }
  comprobar(parcial);

  // renameSync pisa el destino en un solo paso: nunca hay un momento en que el
  // respaldo del día no exista.
  renameSync(parcial, destino);

  return {
    archivo: basename(destino),
    ruta: destino,
    bytes: statSync(destino).size,
    fecha,
    rotados: rotar(),
  };
}

/**
 * Abre la copia y le cuenta las filas. Sin esto, un archivo truncado se
 * guardaria como respaldo valido y el dueño se enteraria el dia que lo
 * necesita, que es el peor dia posible.
 */
function comprobar(ruta) {
  let copia;
  try {
    copia = new DatabaseSync(ruta, { readOnly: true });
    const n = copia.prepare('SELECT COUNT(*) n FROM productos').get().n;
    if (!Number.isInteger(n)) throw new Error('la copia no responde');
  } catch (e) {
    try { unlinkSync(ruta); } catch { /* ya no estaba */ }
    throw new Error(`El respaldo salió ilegible y se descartó: ${e.message}`);
  } finally {
    copia?.close();
  }
}

/** Los respaldos que hay, del más nuevo al más viejo. */
export function listar() {
  let nombres;
  try {
    nombres = readdirSync(DIR);
  } catch {
    return [];   // todavía no se ha hecho ninguno
  }
  return nombres
    .filter((n) => ESPERADO.test(n))
    .sort()
    .reverse()
    .map((n) => ({
      archivo: n,
      fecha: n.match(ESPERADO)[1],
      bytes: statSync(join(DIR, n)).size,
    }));
}

export const ultimo = () => listar()[0] || null;

export const hayDeHoy = () => listar().some((r) => r.fecha === hoy());

/**
 * Borra los que pasaron de `DIAS_QUE_SE_GUARDAN`. Se cuenta por posición y no
 * por antigüedad en días: si la tienda estuvo cerrada tres semanas, lo que hay
 * que conservar son los últimos catorce respaldos que existen, no los de los
 * últimos catorce días — que serían ninguno.
 */
export function rotar() {
  const sobran = listar().slice(DIAS_QUE_SE_GUARDAN);
  for (const r of sobran) {
    try { unlinkSync(join(DIR, r.archivo)); } catch { /* alguien lo borró antes */ }
  }
  return sobran.map((r) => r.archivo);
}

/**
 * Vuelve a un respaldo. Antes de pisar nada guarda la base actual como
 * `antes-de-restaurar`: quien restaura por equivocación tiene que poder
 * deshacerlo, y es el momento en que más fácil es perder todo.
 *
 * El servidor tiene que estar parado. Con la base abierta el reemplazo puede
 * quedar a medias, y no hay forma fiable de detectarlo desde aquí — por eso lo
 * avisa la CLI y lo dice el manual.
 */
export function restaurar(archivo) {
  const origen = join(DIR, basename(archivo));
  if (!existsSync(origen)) throw new Error(`No existe el respaldo ${basename(archivo)}`);
  comprobar(origen);

  const red = join(DIR, `antes-de-restaurar-${Date.now()}.db`);
  if (existsSync(RUTA)) copyFileSync(RUTA, red);

  copyFileSync(origen, RUTA);
  // El WAL y el shm de la base vieja no valen para la nueva: si se quedan,
  // SQLite intenta aplicarlos encima y la deja incoherente.
  for (const sufijo of ['-wal', '-shm']) {
    try { unlinkSync(RUTA + sufijo); } catch { /* no siempre existen */ }
  }
  return { restaurado: basename(origen), red: basename(red) };
}

/**
 * Un respaldo por día, hecho en cuanto la laptop se enciende.
 *
 * No se programa a una hora: la laptop del puesto se apaga al cerrar, y una
 * tarea de madrugada nunca correría. Se comprueba al arrancar y cada hora,
 * así el respaldo del día se hace solo, esté abierto el local a las 7 o a las
 * 11.
 *
 * Un fallo se avisa por consola y no tumba el servidor: quedarse sin respaldo
 * es malo, pero no vender es peor.
 */
export function programar({ cadaMs = 3_600_000, avisar = console.log } = {}) {
  const intentar = () => {
    if (hayDeHoy()) return null;
    try {
      const r = respaldar();
      avisar(`[respaldo] ${r.archivo} · ${(r.bytes / 1024).toFixed(0)} KB`
        + (r.rotados.length ? ` · rotados ${r.rotados.length}` : ''));
      return r;
    } catch (e) {
      avisar(`[respaldo] FALLO: ${e.message}`);
      return null;
    }
  };

  intentar();
  const reloj = setInterval(intentar, cadaMs);
  reloj.unref();   // que un temporizador no impida cerrar el proceso
  return reloj;
}
