// Primero: el .env tiene que estar en process.env antes que otro módulo lo lea.
import './entorno.js';
import QR from 'qrcode';
import { networkInterfaces } from 'node:os';
import { gzipSync } from 'node:zlib';
import { randomInt } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { asesorar } from './asesor.js';
import {
  iniciarSesion, cerrarSesion, sesionDe, leerCookie,
  cookieSesion, cookieBorrada, asegurarUsuarioInicial, COOKIE, esAdmin,
  esDelPuesto, esReparto,
} from './auth.js';
import { TIENDA, estaAbierto } from './tienda.config.js';
import { consumir, CUOTAS } from './limites.js';
import { validarDocumento, validarCorreo, validarTelefono } from './documentos.js';
import { validarUbigeo, zonaDe, departamentos } from './ubigeo.js';
import { rutaIlustracion } from './ilustraciones.mjs';
import { pdfDeComprobante, nombreArchivo } from './comprobante-pdf.js';
import {
  emitirPorPedido, emitirNotaCredito, detalle as detalleComprobante,
  listar as listarComprobantes, porPedido as comprobanteDePedido, numeroDe,
} from './comprobantes.js';
import { MOTIVO_NOTA_CREDITO } from './catalogos-sunat.js';
import {
  programar as programarRespaldo, respaldar, listar as listarRespaldos,
  ultimo as ultimoRespaldo, DIR as DIR_RESPALDOS, DIAS_QUE_SE_GUARDAN,
} from './respaldo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, 'public');
/**
 * Puerto y dirección.
 *
 * El 3000 lo ocupa el otro proyecto del mismo cliente, así que teniendo los dos
 * en el 3000 solo podía estar levantado uno. Con el 4000 conviven.
 *
 * `HOST` por defecto es `::`, que en Node significa «todas las interfaces»:
 * la tienda se abre desde esta máquina Y desde el celular de la misma Wi-Fi,
 * que es lo que hace falta para enseñársela a alguien. Poniendo
 * `HOST=127.0.0.1` deja de salir de esta computadora.
 */
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '::';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  // La tipografía de los títulos va servida desde aquí y no desde Google
  // Fonts: la demo tiene que verse igual con el wifi del mercado caído. Con
  // `nosniff` activo, sin su tipo el navegador la rechaza.
  '.woff2': 'font/woff2',
};

// Archivos donde se sustituye {{SITIO}} por el dominio real de tienda.config.
// Evita que la URL canonica, Open Graph y el sitemap queden escritos a mano en
// cada pagina: al mudar de dominio se cambia un valor y ya.
const CON_PLANTILLA = new Set(['.html', '.txt', '.xml']);

/**
 * Comprime si el navegador lo acepta y vale la pena.
 *
 * El catalogo de 400 productos son ~200 KB de JSON; comprimido baja a menos de
 * la decima parte. La tienda se abre desde el celular, muchas veces con datos
 * moviles en el mercado, asi que esos 180 KB de menos se notan. Por debajo de
 * 1 KB comprimir cuesta mas de lo que ahorra.
 */
const MINIMO_GZIP = 1024;

function enviar(res, code, cabeceras, cuerpo) {
  const buf = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo);
  // `res.req` evita tener que pasar la peticion por los ~40 sitios que responden.
  const acepta = String(res.req?.headers?.['accept-encoding'] || '');
  const comprimible = /^(text\/|application\/(json|xml|javascript|xhtml))/
    .test(cabeceras['Content-Type'] || '');

  if (buf.length >= MINIMO_GZIP && comprimible && /\bgzip\b/.test(acepta)) {
    const gz = gzipSync(buf);
    res.writeHead(code, {
      ...cabeceras,
      'Content-Encoding': 'gzip',
      'Content-Length': gz.length,
      Vary: 'Accept-Encoding',
    });
    return res.end(gz);
  }
  res.writeHead(code, { ...cabeceras, 'Content-Length': buf.length });
  res.end(buf);
}

const json = (res, code, data) => enviar(res, code, {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}, JSON.stringify(data));

function leerCuerpo(req, limite = 1e6) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > limite) {
        req.destroy();
        reject(new Error('Cuerpo demasiado grande'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('JSON invalido'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * El cuerpo tal cual llega, sin interpretarlo. Para una foto.
 *
 * `leerCuerpo` concatena en un string y eso destroza los bytes de una imagen:
 * el binario pasa por UTF-8 y vuelve distinto. Aqui se juntan buffers.
 *
 * El tope se comprueba mientras entra, no al final: sin eso, mandar cien
 * megabytes ocuparia cien megabytes de memoria del servidor antes de poder
 * rechazarlos, y eso lo puede hacer cualquiera con sesion.
 */
function leerBinario(req, limite) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    let total = 0;
    let excedido = false;
    req.on('data', (c) => {
      total += c.length;
      if (excedido) {
        // Pasado el tope se sigue LEYENDO, pero sin guardar nada, para que el
        // navegador termine de enviar y lea el 413. Cortar el socket con la
        // subida a medias hacía que en Windows la respuesta se perdiera: al
        // otro lado llegaba «se cayó la conexión» en vez de «pesa más de 4 MB».
        // El drenaje también tiene techo: quien mande un cuerpo sin fin no
        // retiene la conexión para siempre.
        if (total > limite * 4) req.destroy();
        return;
      }
      if (total > limite) {
        excedido = true;
        trozos.length = 0;
        return reject(Object.assign(new Error('demasiado grande'), { demasiado: true }));
      }
      trozos.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(trozos)));
    req.on('error', reject);
  });
}

/**
 * Que clase de imagen es, mirando los bytes.
 *
 * No se mira ni la extension ni el `Content-Type`: los dos los escribe quien
 * sube el archivo. Un .exe renombrado a .jpg llega con extension .jpg y con el
 * content-type que se le antoje al que lo manda; lo unico que no puede
 * falsificar sin que deje de ser lo que es son sus primeros bytes.
 */
function tipoDeImagen(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF'
    && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  // GIF y SVG quedan fuera a proposito: el GIF animado no aporta a una ficha
  // de producto, y el SVG es un documento que puede traer scripts dentro.
  return null;
}

/**
 * Manda el comprobante como archivo PDF.
 *
 * `attachment` y no `inline`: quien pide el PDF de su boleta lo quiere
 * guardado, no abierto en una pestaña que después cierra sin querer. El
 * nombre sigue la convención de SUNAT, para que en una carpeta con cien
 * comprobantes se ordenen solos.
 */
function enviarPdf(res, detalle) {
  const cuerpo = pdfDeComprobante(detalle);
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Length': cuerpo.length,
    'Content-Disposition': `attachment; filename="${nombreArchivo(detalle)}"`,
    'Cache-Control': 'no-store',
  });
  res.end(cuerpo);
}

/**
 * Codigo de pedido: `RA-AAAAMMDD-XXX`.
 *
 * Tres caracteres, no mas: el codigo se dicta por telefono y se lee en voz
 * alta en el mostrador. Eso deja 36 ** 3 = 46 656 por fecha, asi que dos
 * pedidos del mismo dia pueden salir iguales — lo resuelve el reintento de
 * `registrarPedido`, no un codigo mas largo.
 *
 * El azar sale de `node:crypto`, no de `Math.random()`: el codigo es una
 * credencial debil (abre el seguimiento junto con los ultimos cuatro digitos
 * del telefono), y el generador de Math.random es predecible a partir de unas
 * pocas salidas. Quien hiciera dos pedidos podia adivinar los ajenos.
 */
const ALFABETO = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const codigoPedido = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  let rnd = '';
  for (let i = 0; i < 3; i++) rnd += ALFABETO[randomInt(ALFABETO.length)];
  return `RA-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${rnd}`;
};

// ---------------------------------------------------------------- consultas
// Lo que ve el publico. `SELECT *` mandaba tambien `costo`: el precio de
// compra de cada producto, o sea el margen del negocio, a cualquiera que
// abriera /api/productos. Con 400 productos era la lista de costos completa.
//
// Y por la misma razon tampoco sale el stock. Cuantas unidades quedan es
// informacion del negocio —dice cuanto vende, cuanto compra y cuando le falta
// capital para reponer— y la ve solo quien lo controla, en el panel. Al
// cliente le basta saber si se puede pedir o no: `disponible`, 1 o 0.
const CAMPOS_PUBLICOS = `id, sku, nombre, categoria, origen, presentacion,
  descripcion, uso_tradicional, beneficios, etiquetas, precio,
  (stock > 0) AS disponible, emoji, imagen, unidad, presentaciones`;

/**
 * Granel: se cotiza por 100 g y se vende por gramo.
 *
 * Los 100 g son la unidad del mostrador —«la muña esta a nueve soles los cien
 * gramos»— y es el numero que la dueña mantiene. El sistema, en cambio, cuenta
 * de a un gramo: en el stock, en el carrito y en la linea del pedido.
 *
 * La conversion ocurre UNA sola vez, al vender: en `pedido_items.precio_unit`
 * se guarda ya el precio por gramo. Asi el comprobante, el kardex y los totales
 * siguen haciendo `precio x cantidad` sin saber nada de granel, y una boleta
 * vieja no cambia de importe si mañana el producto deja de venderse por peso.
 */
const BASE_GRANEL = 100;
const esGranel = (p) => p.unidad === 'gramo';
const precioPorUnidadBase = (p) => (esGranel(p) ? p.precio / BASE_GRANEL : p.precio);
const costoPorUnidadBase = (p) => (esGranel(p) ? (p.costo || 0) / BASE_GRANEL : (p.costo || 0));

/**
 * Quién hizo qué, para el resumen de la dueña.
 *
 * Hasta ahora el sistema sabía cuánto se vendió en el local y cuántos pedidos
 * se entregaron, pero no quién: una venta de mostrador no guardaba quién la
 * cobró y marcar «entregado» no guardaba quién lo marcó. Con dos o tres
 * personas en el puesto, «hoy se entregaron 5» no le dice a la dueña si el
 * motorizado salió o si los entregó ella.
 *
 * Una fila por acción: la venta en el local y cada cambio de estado de un
 * pedido. Vive aquí y no en db.js porque solo el servidor la escribe y la lee.
 */
db.exec(`CREATE TABLE IF NOT EXISTS actividad_equipo (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario    TEXT NOT NULL,
  rol        TEXT NOT NULL,
  accion     TEXT NOT NULL,
  pedido_id  INTEGER,
  codigo     TEXT NOT NULL DEFAULT '',
  monto      REAL NOT NULL DEFAULT 0,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_actividad_fecha ON actividad_equipo(creado_en)');

const Q = {
  insActividad: db.prepare(`INSERT INTO actividad_equipo
    (usuario, rol, accion, pedido_id, codigo, monto) VALUES (?,?,?,?,?,?)`),
  productos: db.prepare(
    `SELECT ${CAMPOS_PUBLICOS} FROM productos WHERE activo = 1
     ORDER BY categoria, nombre`
  ),
  producto: db.prepare(
    `SELECT ${CAMPOS_PUBLICOS} FROM productos WHERE id = ? AND activo = 1`),
  // El asesor necesita ademas saber cual es relleno de demostracion, para no
  // recomendarlo por delante de lo que el negocio si tiene. No entra en
  // CAMPOS_PUBLICOS: la tienda no tiene por que ir etiquetando productos de
  // "demo" en una respuesta que el cliente puede abrir en el navegador.
  // El stock entra aqui porque el asesor decide con el (no ofrece lo agotado,
  // cotiza lo que alcanza), pero no sale en su respuesta: ver fichaProducto.
  paraAsesor: db.prepare(
    `SELECT ${CAMPOS_PUBLICOS}, stock, stock_min, demo FROM productos WHERE activo = 1
     ORDER BY categoria, nombre`),
  paraActualizar: db.prepare('SELECT * FROM productos WHERE id = ?'),
  // Para vender hace falta el costo, que no esta en CAMPOS_PUBLICOS: es lo que
  // congela la ganancia de la linea. Solo se usa en el servidor.
  paraVender: db.prepare('SELECT * FROM productos WHERE id = ? AND activo = 1'),
  descontar: db.prepare('UPDATE productos SET stock = stock - ? WHERE id = ?'),
  reponer: db.prepare('UPDATE productos SET stock = stock + ? WHERE id = ?'),
  insPedido: db.prepare(`INSERT INTO pedidos
    (codigo,cliente_nombre,cliente_tel,cliente_dir,nota,total,canal,
     cliente_email,tipo_doc,num_doc,razon_social,tipo_comprobante,
     departamento,provincia,distrito,ubigeo,referencia,costo_envio,
     modo_entrega)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  insItem: db.prepare(`INSERT INTO pedido_items
    (pedido_id,producto_id,nombre,cantidad,precio_unit,subtotal,costo_unit,unidad)
    VALUES (?,?,?,?,?,?,?,?)`),
  insMov: db.prepare(`INSERT INTO movimientos_stock
    (producto_id,tipo,cantidad,stock_final,motivo) VALUES (?,?,?,?,?)`),
  pedidos: db.prepare('SELECT * FROM pedidos ORDER BY id DESC LIMIT 100'),
  pedido: db.prepare('SELECT * FROM pedidos WHERE id = ?'),
  itemsDe: db.prepare('SELECT * FROM pedido_items WHERE pedido_id = ?'),
  estado: db.prepare('UPDATE pedidos SET estado = ? WHERE id = ?'),
  movimientos: db.prepare(`SELECT m.*, p.nombre, p.sku FROM movimientos_stock m
    JOIN productos p ON p.id = m.producto_id ORDER BY m.id DESC LIMIT 60`),
  bajoStock: db.prepare(`SELECT * FROM productos
    WHERE activo = 1 AND stock <= stock_min ORDER BY (stock * 1.0 / stock_min), nombre`),
  porCodigo: db.prepare('SELECT * FROM pedidos WHERE codigo = ?'),
  confirmarRecepcion: db.prepare(`UPDATE pedidos
    SET recibido_en = datetime('now','localtime'), recibido_por = ?
    WHERE id = ?`),
  // El panel necesita ver tambien los productos dados de baja, para poder
  // reactivarlos. La tienda no: por eso son dos consultas distintas.
  todosProductos: db.prepare('SELECT * FROM productos ORDER BY activo DESC, categoria, nombre'),
  insProducto: db.prepare(`INSERT INTO productos
    (sku,nombre,categoria,origen,presentacion,descripcion,uso_tradicional,
     beneficios,etiquetas,precio,costo,stock,stock_min,imagen)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  porSku: db.prepare('SELECT id FROM productos WHERE sku = ?'),
  porNombre: db.prepare('SELECT id, sku FROM productos WHERE lower(nombre) = ?'),
  ultimoSku: db.prepare(`SELECT sku FROM productos WHERE sku LIKE ?
    ORDER BY sku DESC LIMIT 1`),
  categorias: db.prepare(`SELECT categoria, COUNT(*) n FROM productos
    GROUP BY categoria ORDER BY n DESC`),
  insCambio: db.prepare(`INSERT INTO cambios_producto
    (producto_id, campo, antes, despues, usuario) VALUES (?,?,?,?,?)`),
  cambios: db.prepare(`SELECT c.*, p.nombre, p.sku FROM cambios_producto c
    JOIN productos p ON p.id = c.producto_id ORDER BY c.id DESC LIMIT 40`),

  // --- Calendario de ventas -------------------------------------------------
  // Un anulado o un devuelto NO es una venta, igual que en `resumen()`. Si
  // contaran, el calendario diria una cifra y la caja del dia otra, y el dueno
  // dejaria de creerle a las dos.
  ventasDelMes: db.prepare(`SELECT date(creado_en) dia, COUNT(*) pedidos,
      COALESCE(SUM(total),0) total
    FROM pedidos
    WHERE strftime('%Y-%m', creado_en) = ? AND estado NOT IN ('anulado','devuelto')
    GROUP BY dia ORDER BY dia`),
  // Meses con algo vendido: es lo que permite que las flechas del calendario
  // no lleven a meses vacios cuando la tienda todavia tiene poca historia.
  mesesConVentas: db.prepare(`SELECT strftime('%Y-%m', creado_en) mes
    FROM pedidos WHERE estado NOT IN ('anulado','devuelto')
    GROUP BY mes ORDER BY mes`),

  // --- Historial de cliente -------------------------------------------------
  // Se agrupa por `num_doc`, no por telefono ni por nombre: el documento es lo
  // que va en el comprobante y lo unico que no cambia. El nombre se escribe
  // distinto cada vez ("Rosa Q.", "rosa quispe") y el telefono se cambia.
  // Se muestra el ultimo nombre y telefono que dejo, que es con el que hay que
  // llamarlo hoy.
  clientes: db.prepare(`SELECT
      num_doc, tipo_doc,
      COUNT(*) pedidos,
      COALESCE(SUM(total),0) gastado,
      MIN(date(creado_en)) primera,
      MAX(date(creado_en)) ultima,
      (SELECT cliente_nombre FROM pedidos b
         WHERE b.num_doc = a.num_doc ORDER BY b.id DESC LIMIT 1) nombre,
      (SELECT cliente_tel FROM pedidos b
         WHERE b.num_doc = a.num_doc ORDER BY b.id DESC LIMIT 1) telefono,
      (SELECT razon_social FROM pedidos b
         WHERE b.num_doc = a.num_doc ORDER BY b.id DESC LIMIT 1) razon_social
    FROM pedidos a
    WHERE num_doc <> '' AND estado NOT IN ('anulado','devuelto')
    GROUP BY num_doc ORDER BY gastado DESC LIMIT 200`),
  // El historial si incluye anulados y devueltos: para atender a alguien hace
  // falta saber que devolvio, no solo lo que pago.
  historialDe: db.prepare(`SELECT id, codigo, creado_en, total, estado,
      tipo_comprobante, cliente_dir, distrito, provincia
    FROM pedidos WHERE num_doc = ? ORDER BY id DESC LIMIT 50`),
};

// ------------------------------------------------------------- alta de ficha
// Siglas para el codigo automatico. Una categoria nueva toma las tres primeras
// letras sin tildes; si tampoco sale nada usable, cae en GEN.
const SIGLA = {
  Superalimentos: 'SUP', Hierbas: 'HIE', Tónicos: 'TON', Aceites: 'ACE',
  Esencias: 'ESE', Colágeno: 'COL', Apícolas: 'API', Cremas: 'CRE',
  'Cuidado personal': 'CUI', Suplementos: 'SPL',
};

const sinTildes = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '');

const siglaDe = (categoria) => SIGLA[categoria]
  || sinTildes(categoria).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
  || 'GEN';

/** Primer numero libre de la sigla. Se llama dentro de la transaccion. */
function siguienteSku(categoria) {
  const sigla = siglaDe(categoria);
  const ultimo = Q.ultimoSku.get(sigla + '-%');
  let n = ultimo ? Number(ultimo.sku.split('-')[1]) + 1 : 1;
  while (Q.porSku.get(`${sigla}-${String(n).padStart(3, '0')}`)) n++;
  return `${sigla}-${String(n).padStart(3, '0')}`;
}

const texto = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Sin tildes, en minusculas: para comparar dos nombres escritos distinto. */
const cotejar = (t) => sinTildes(t).toLowerCase();

/**
 * Categoria nueva o la de siempre mal escrita.
 *
 * El dueño puede inventarse la categoria que quiera —es su negocio— pero
 * "hierbas", "Hierbas" y "HIERBAS" tienen que ser la misma. Si no, el filtro de
 * la tienda se parte en tres y el catalogo empieza a mentir. Si lo que escribio
 * coincide con una categoria que ya existe, se adopta la grafia que ya estaba;
 * si de verdad es nueva, se guarda con la primera letra en mayuscula.
 */
function normalizarCategoria(escrita) {
  if (!escrita) return '';
  const clave = cotejar(escrita);
  const existente = Q.categorias.all().find((c) => cotejar(c.categoria) === clave);
  if (existente) return existente.categoria;
  return escrita.charAt(0).toUpperCase() + escrita.slice(1);
}

/**
 * Valida una ficha nueva. Devuelve `{ producto }` o `{ error, campo }`.
 *
 * Es la misma comprobacion que hace el formulario, repetida aca a proposito:
 * lo del navegador es comodidad, lo que de verdad protege la base es esto.
 */
function validarAlta(c) {
  const nombre = texto(c.nombre, 90);
  if (nombre.length < 3) return { error: 'Ponle un nombre al producto.', campo: 'nombre' };
  if (Q.porNombre.get(nombre.toLowerCase())) {
    return { error: 'Ya tienes un producto con ese nombre.', campo: 'nombre' };
  }

  const categoria = normalizarCategoria(texto(c.categoria, 40));
  if (categoria.length < 3) return { error: 'Elige o escribe una categoría.', campo: 'categoria' };

  const presentacion = texto(c.presentacion, 60);
  if (presentacion.length < 2) {
    return { error: 'Falta la presentación (ej. "Bolsa 250 g").', campo: 'presentacion' };
  }

  const precio = Math.round(Number(c.precio) * 100) / 100;
  if (!Number.isFinite(precio) || precio <= 0 || precio > 99999) {
    return { error: 'El precio de venta tiene que ser un número mayor que cero.', campo: 'precio' };
  }

  const costo = c.costo === '' || c.costo == null ? 0 : Math.round(Number(c.costo) * 100) / 100;
  if (!Number.isFinite(costo) || costo < 0 || costo > 99999) {
    return { error: 'El costo tiene que ser un número.', campo: 'costo' };
  }
  // Vender por debajo del costo es justo la perdida que este sistema existe
  // para evitar. Se avisa aca, no cuando ya se vendieron cien unidades.
  if (costo > precio) {
    return {
      error: `Estarías vendiendo a pérdida: el costo (S/ ${costo.toFixed(2)}) ` +
        `es mayor que el precio (S/ ${precio.toFixed(2)}).`,
      campo: 'costo',
    };
  }

  const entero = (v, def) => {
    if (v === '' || v == null) return def;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 99999 ? n : null;
  };
  const stock = entero(c.stock, 0);
  if (stock === null) return { error: 'El stock inicial tiene que ser un número entero.', campo: 'stock' };
  const stockMin = entero(c.stock_min, 5);
  if (stockMin === null) return { error: 'El stock mínimo tiene que ser un número entero.', campo: 'stock_min' };

  // Codigo propio: opcional. Si no viene, lo pone el sistema.
  let sku = texto(c.sku, 20).toUpperCase();
  if (sku && !/^[A-Z0-9][A-Z0-9-]{2,19}$/.test(sku)) {
    return { error: 'El código solo admite letras, números y guiones.', campo: 'sku' };
  }

  // La imagen es una ruta del propio sitio o una URL https. Nada de http ni
  // de javascript:, que es lo que se cuela cuando se acepta cualquier texto.
  const imagen = texto(c.imagen, 300);
  if (imagen && !/^(\/img\/[\w./-]+|https:\/\/[\w./%-]+)$/.test(imagen)) {
    return { error: 'La imagen debe ser una ruta del sitio (/img/…) o una URL https.', campo: 'imagen' };
  }

  return {
    producto: {
      sku, nombre, categoria, presentacion, precio, costo, stock,
      stock_min: stockMin, imagen,
      origen: texto(c.origen, 80) || 'Perú',
      descripcion: texto(c.descripcion, 400) || `${nombre}. ${presentacion}.`,
      uso_tradicional: texto(c.uso_tradicional, 400),
      beneficios: texto(c.beneficios, 200),
      // Lo que usa el asesor para emparejar sintomas. Se guarda sin tildes y en
      // minusculas porque asi es como llega la consulta ya normalizada.
      etiquetas: sinTildes(texto(c.etiquetas, 400)).toLowerCase()
        .split(',').map((t) => t.trim()).filter(Boolean).join(','),
    },
  };
}

// Campos de la ficha que el panel puede tocar. El stock NO esta aca a
// proposito: se mueve solo por ventas, ingresos y devoluciones, para que el
// kardex siempre explique cada unidad.
const EDITABLES = {
  precio: {
    etiqueta: 'precio',
    // `soloDueno`: lo que toca la plata o saca un producto de la tienda. El
    // minimo de reposicion no esta marcado a proposito — ajustarlo es trabajo
    // de quien ve vaciarse el estante, no del dueño desde su casa.
    soloDueno: true,
    validar: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0 || n > 99999) return null;
      return Math.round(n * 100) / 100;
    },
  },
  stock_min: {
    etiqueta: 'stock mínimo',
    validar: (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 9999) return null;
      return n;
    },
  },
  activo: {
    etiqueta: 'estado',
    soloDueno: true,
    validar: (v) => (v === 0 || v === 1 || v === true || v === false ? (v ? 1 : 0) : null),
  },

  // --- La ficha completa ----------------------------------------------------
  // Corregir una ficha era lo unico que obligaba a tocar la base a mano: se
  // daba de alta con una errata en el nombre o con el origen equivocado y no
  // habia forma de arreglarlo desde el panel.
  //
  // Lo que NO es editable, y por que:
  //
  //  - **El SKU.** Es la identidad del producto en el kardex y en las lineas de
  //    los comprobantes ya emitidos. Cambiarlo dejaria una boleta apuntando a
  //    un codigo que no existe. Un producto mal codificado se da de baja y se
  //    crea de nuevo.
  //  - **El stock.** Se mueve por ventas, ingresos y ajustes, nunca a dedo:
  //    es lo que permite que el kardex explique cada unidad.
  nombre: {
    etiqueta: 'nombre',
    soloDueno: true,
    validar: (v, p) => {
      const t = texto(v, 90);
      if (t.length < 3) return null;
      // El nombre es unico. Si el que ya lo tiene es este mismo producto, no
      // hay choque: es el caso de corregir una tilde sin cambiar de producto.
      const otro = Q.porNombre.get(t.toLowerCase());
      if (otro && otro.id !== p.id) return null;
      return t;
    },
  },
  categoria: {
    etiqueta: 'categoría',
    soloDueno: true,
    validar: (v) => {
      const t = normalizarCategoria(texto(v, 40));
      return t.length >= 3 ? t : null;
    },
  },
  presentacion: {
    etiqueta: 'presentación',
    soloDueno: true,
    validar: (v) => {
      const t = texto(v, 60);
      return t.length >= 2 ? t : null;
    },
  },
  // El costo es del dueño por definicion: de el sale el margen.
  costo: {
    etiqueta: 'costo',
    soloDueno: true,
    validar: (v, p) => {
      const n = Math.round(Number(v) * 100) / 100;
      if (!Number.isFinite(n) || n < 0 || n > 99999) return null;
      // Un costo por encima del precio es vender a perdida, que es justo lo
      // que este sistema existe para evitar.
      if (n > p.precio) return null;
      return n;
    },
  },
  origen: { etiqueta: 'origen', soloDueno: true, validar: (v) => texto(v, 80) || 'Perú' },
  descripcion: { etiqueta: 'descripción', soloDueno: true, validar: (v) => texto(v, 400) },
  uso_tradicional: { etiqueta: 'uso tradicional', soloDueno: true, validar: (v) => texto(v, 400) },
  beneficios: { etiqueta: 'beneficios', soloDueno: true, validar: (v) => texto(v, 200) },
  etiquetas: {
    etiqueta: 'etiquetas',
    soloDueno: true,
    // Se guardan sin tildes y en minusculas porque asi llega la consulta del
    // asesor ya normalizada. Editarlas es reentrenar al asesor sobre ese
    // producto: es la palanca para que aparezca en «me duele el estomago».
    validar: (v) => sinTildes(texto(v, 400)).toLowerCase()
      .split(',').map((t) => t.trim()).filter(Boolean).join(','),
  },
  /**
   * Pasar un producto a granel cambia como se lee TODO lo suyo: el precio pasa
   * a ser por 100 g y el stock a contar gramos. Es del dueño por eso, no por
   * desconfianza: quien lo cambie tiene que entender que «30» deja de querer
   * decir treinta bolsas.
   */
  unidad: {
    etiqueta: 'unidad de venta',
    soloDueno: true,
    validar: (v) => (v === 'gramo' || v === 'unidad' ? v : null),
  },
  presentaciones: {
    etiqueta: 'presentaciones',
    soloDueno: true,
    // "100,250,500" — gramos, en orden y sin repetidos. Vacio es valido: el
    // producto usa entonces las presentaciones por defecto.
    validar: (v) => {
      const g = String(v ?? '').split(',').map((x) => Number(String(x).trim()))
        .filter((n) => Number.isInteger(n) && n > 0 && n <= 10000);
      return [...new Set(g)].sort((a, b) => a - b).join(',');
    },
  },
  imagen: {
    etiqueta: 'imagen',
    soloDueno: true,
    validar: (v) => {
      const t = texto(v, 300);
      if (!t) return '';
      return /^(\/img\/[\w./-]+|https:\/\/[\w./%-]+)$/.test(t) ? t : null;
    },
  },
};

// `anulado` = nunca salio de la tienda. `devuelto` = el cliente lo regreso.
// Los dos reponen stock, pero en el kardex tienen que distinguirse: uno es
// una venta que no ocurrio y el otro una venta que se deshizo.
const ESTADOS = ['pendiente', 'preparando', 'enviado', 'entregado', 'anulado', 'devuelto'];
const REPONEN_STOCK = new Set(['anulado', 'devuelto']);

// ------------------------------------------------------------------- sesion
const sesionDe_ = (req) => sesionDe(leerCookie(req, COOKIE));
/**
 * La IP de quien pide, que es la llave de las cuotas.
 *
 * `X-Forwarded-For` la escribe el cliente: sin un proxy delante que la pise,
 * cualquiera la rota en cada peticion y cada peticion estrena cuota — login,
 * asesor y seguimiento quedaban sin limite. Solo se cree cuando `CONFIAR_PROXY=1`
 * dice que hay un proxy propio (nginx, Caddy) que la reescribe.
 */
const ipDe = (req) => {
  if (process.env.CONFIAR_PROXY === '1' && req.headers['x-forwarded-for']) {
    return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  }
  return req.socket.remoteAddress || '';
};

/**
 * Aplica una cuota. Devuelve true si la peticion ya fue respondida con 429.
 */
function excedeCuota(req, res, grupo) {
  // Las suites que ejercitan el CRUD hacen decenas de pedidos seguidos y
  // toparían con la cuota. La suite de seguridad arranca sin esta variable,
  // justamente para comprobar que el límite existe.
  if (process.env.SIN_LIMITES === '1') return false;
  const { permitido, ventanaMs } = CUOTAS[grupo];
  const r = consumir(ipDe(req) + '|' + grupo, permitido, ventanaMs);
  if (r.ok) return false;
  res.setHeader('Retry-After', String(r.esperaS));
  json(res, 429, {
    error: `Demasiadas peticiones. Vuelve a intentar en ${r.esperaS} segundo(s).`,
  });
  return true;
}

/**
 * Cabeceras defensivas en toda respuesta.
 *
 * `script-src 'self'` sin `unsafe-inline`: por eso los scripts que estaban
 * escritos dentro del HTML se movieron a archivos propios. Es lo que convierte
 * la CSP en una defensa real contra XSS y no en un adorno.
 *
 * En estilos sí queda `unsafe-inline`: hay atributos `style` sueltos y su
 * riesgo es mucho menor. Queda anotado como deuda en el README.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

function cabecerasSeguras(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
}

/**
 * Rutas del panel. Todo lo que exponga datos del negocio o los modifique.
 * `GET /api/pedidos` entra aca porque devuelve nombre, telefono y direccion de
 * cada cliente; `POST /api/pedidos` NO, porque ese lo usa el comprador.
 */
function requiereSesion(req, res) {
  const s = sesionDe_(req);
  if (!s) {
    json(res, 401, { error: 'Necesitas iniciar sesión.' });
    return null;
  }
  return s;
}

/**
 * Lo que es del dueño y no del mostrador: el costo, el margen, el precio de
 * venta, el alta de fichas y el respaldo.
 *
 * Se comprueba **en el servidor y no ocultando botones**. Esconderlos en el
 * panel evita el error de buena fe, no la curiosidad: quien sepa escribir una
 * URL veria el costo de todo el catalogo. El 403 es lo que de verdad corta.
 *
 * El rol se lee de la tabla en cada peticion, no de la cookie, asi que
 * degradar a alguien tiene efecto en su siguiente clic sin tener que cerrarle
 * la sesion.
 */
/**
 * Lo que es del puesto y no del reparto.
 *
 * El motorizado tiene acceso al panel, pero su trabajo cabe en dos cosas: ver
 * a quién le lleva y marcar que entregó. Todo lo demás —la caja del día, el
 * inventario, el historial de quién compra qué, el catálogo con sus precios—
 * es información del negocio que va en un teléfono que sale a la calle todos
 * los días. No es desconfianza: es que un teléfono se pierde y se presta.
 *
 * Corta aquí y no escondiendo bloques del panel. Esconder evita el error de
 * buena fe; el 403 es lo que detiene a quien escriba la URL a mano.
 */
function requierePuesto(req, res) {
  const s = requiereSesion(req, res);
  if (!s) return null;
  if (!esDelPuesto(s)) {
    json(res, 403, {
      error: 'Tu acceso es el de reparto: la ruta del día y marcar entregado.',
    });
    return null;
  }
  return s;
}

function requiereAdmin(req, res) {
  const s = requiereSesion(req, res);
  if (!s) return null;
  if (!esAdmin(s)) {
    json(res, 403, {
      error: 'Esto solo lo ve el dueño de la tienda. Si lo necesitas, pídele acceso.',
    });
    return null;
  }
  return s;
}

/**
 * Lo que sale a reparto: ni la venta de mostrador —que se la llevaron puesta—
 * ni lo que el cliente pasa a recoger por el local.
 */
const salePorReparto = (p) => p.canal !== 'mostrador' && p.modo_entrega !== 'recojo';

/**
 * El pedido como lo ve el motorizado.
 *
 * Se quitan el documento, la razon social y el correo: para tocar un timbre y
 * cobrar no hacen falta, y son justo los datos con los que se suplanta a
 * alguien. El numero de boleta sigue llegando por `/api/admin/comprobantes`,
 * que es donde tiene sentido si el cliente lo pide en la puerta.
 */
function pedidoParaReparto(p) {
  const { num_doc, tipo_doc, razon_social, cliente_email, ...resto } = p;
  void num_doc; void tipo_doc; void razon_social; void cliente_email;
  return resto;
}

/**
 * Las lineas de un pedido segun quien pregunte.
 *
 * `costo_unit` viaja en la tabla para poder calcular la ganancia de una venta
 * con el costo del momento. Salia en la respuesta para todo el que tuviera
 * sesion: el panel del mostrador no lo pinta, pero abrir `/api/pedidos` en el
 * navegador mostraba el costo de cada cosa vendida. El panel no era el que
 * tenia que estar tapandolo.
 */
const itemsSegun = (pedidoId, sesion) => (esAdmin(sesion)
  ? Q.itemsDe.all(pedidoId)
  : Q.itemsDe.all(pedidoId).map(({ costo_unit, ...resto }) => {
    void costo_unit;
    return resto;
  }));

/**
 * La ficha como la puede ver cada uno. Para el mostrador se quita el costo —y
 * con el, el margen, que se calcula a partir de el.
 */
const sinCosto = (p) => {
  const { costo, ...resto } = p;
  return resto;
};
const fichasPara = (sesion, filas) =>
  (esAdmin(sesion) ? filas : filas.map(sinCosto));

// ------------------------------------------------------------------- rutas
async function api(req, res, url) {
  const ruta = url.pathname;
  const metodo = req.method;

  // ------------------------------------------------------------ sesion
  if (metodo === 'POST' && ruta === '/api/login') {
    if (excedeCuota(req, res, 'login')) return;
    // El formulario manda `correo`; se acepta `usuario` por compatibilidad.
    const cuerpo = await leerCuerpo(req);
    const r = iniciarSesion(cuerpo.correo ?? cuerpo.usuario, cuerpo.clave, ipDe(req));
    if (r.error) return json(res, 401, { error: r.error });
    res.setHeader('Set-Cookie', cookieSesion(r.token));
    return json(res, 200, { ok: true, usuario: r.usuario });
  }

  if (metodo === 'POST' && ruta === '/api/logout') {
    cerrarSesion(leerCookie(req, COOKIE));
    res.setHeader('Set-Cookie', cookieBorrada());
    return json(res, 200, { ok: true });
  }

  if (metodo === 'GET' && ruta === '/api/sesion') {
    const s = sesionDe_(req);
    return s ? json(res, 200, s) : json(res, 401, { error: 'Sin sesión.' });
  }

  /**
   * El QR, dibujado en el servidor y servido como SVG.
   *
   * Codificar un QR bien —Reed-Solomon, enmascarado, patrones de alineación—
   * es un modulo entero, y uno mal generado es peor que ninguno: se imprime,
   * parece correcto y no escanea. Hasta ahora el hueco estaba tapado con un
   * cuadrado que decia «pendiente de libreria», y asi se imprimia en cada
   * comprobante. Se resuelve con `qrcode`, que es la primera y unica
   * dependencia del proyecto.
   *
   * Va en el servidor y no en el navegador para que la tienda siga sin cargar
   * una sola libreria de terceros, y para que el SVG se pueda imprimir tal cual
   * sin depender de que un script haya corrido.
   *
   * Es publica a proposito: la usa la pagina del comprobante del comprador, que
   * se abre con su codigo y su telefono y no tiene sesion. Lo unico que hace es
   * dibujar el texto que se le pasa, acotado en largo.
   */
  if (metodo === 'GET' && ruta === '/api/qr') {
    const dato = String(url.searchParams.get('d') || '');
    if (!dato) return json(res, 400, { error: 'Falta que codificar.' });
    if (dato.length > 512) return json(res, 400, { error: 'El contenido es demasiado largo.' });

    try {
      const svg = await QR.toString(dato, {
        type: 'svg', margin: 1, errorCorrectionLevel: 'M',
        color: { dark: '#1c2a22', light: '#ffffff' },
      });
      return enviar(res, 200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        // El QR de un texto dado no cambia nunca: se puede guardar.
        'Cache-Control': 'public, max-age=86400',
      }, svg);
    } catch (e) {
      return json(res, 400, { error: 'No se pudo generar el QR: ' + e.message });
    }
  }

  /**
   * Subir la foto de un producto desde el telefono o la computadora.
   *
   * Antes habia que escribir a mano la ruta de un archivo que alguien tenia
   * que haber dejado antes en el servidor. Para una tienda que se administra
   * desde un celular en el mostrador, eso es lo mismo que no poder poner fotos.
   *
   * Lo que se acepta y por que:
   *
   *  - **Solo la dueña.** Subir archivos a un servidor es de las pocas cosas
   *    que, mal hechas, comprometen la maquina entera.
   *  - **Se mira el contenido, no el nombre.** Ver `tipoDeImagen`.
   *  - **El nombre lo pone el servidor.** El del archivo original no se usa ni
   *    para derivarlo: es la via clasica de escribir fuera de la carpeta
   *    (`../../algo`). Aqui se arma con la fecha y bytes al azar.
   *  - **Tope de 4 MB.** Una foto de celular ronda los 2-3 MB; mas que eso no
   *    mejora una ficha y si llena el disco.
   */
  if (metodo === 'POST' && ruta === '/api/fotos') {
    if (!requiereAdmin(req, res)) return;

    let bytes;
    try {
      bytes = await leerBinario(req, 4 * 1024 * 1024);
    } catch (e) {
      // `Connection: close`: lo que queda por subir se descarta (ver
      // leerBinario) y la conexión no se reusa para otra petición.
      if (e.demasiado) res.setHeader('Connection', 'close');
      return json(res, 413, { error: 'La foto pesa más de 4 MB. Usa una más liviana.' });
    }
    if (!bytes.length) return json(res, 400, { error: 'No llegó ninguna foto.' });

    const tipo = tipoDeImagen(bytes);
    if (!tipo) {
      return json(res, 400, {
        error: 'Ese archivo no es una foto JPG, PNG o WEBP.',
      });
    }

    const nombre = `p${Date.now().toString(36)}${randomInt(1e6).toString(36)}.${tipo.ext}`;
    try {
      await writeFile(join(PUBLIC, 'img', 'fotos', nombre), bytes);
    } catch (e) {
      return json(res, 500, { error: 'No se pudo guardar la foto: ' + e.message });
    }

    return json(res, 201, { ruta: '/img/fotos/' + nombre, peso: bytes.length });
  }

  // Datos públicos de la tienda para el frontend (umbral de envío gratis,
  // horario, contacto). Sale de tienda.config.js, así que cambiarlo ahí
  // actualiza la tienda sin tocar el JavaScript.
  if (metodo === 'GET' && ruta === '/api/tienda') {
    return json(res, 200, {
      nombre: TIENDA.nombre,
      telefono: TIENDA.telefono,
      whatsapp: TIENDA.whatsapp,
      pais: TIENDA.pais,
      email: TIENDA.email,
      direccion: TIENDA.direccion,
      // La referencia va junto a la direccion porque el carrito la necesita
      // cuando el cliente elige recoger: "Jr. Ayacucho 412" no alcanza para
      // encontrar un puesto dentro de un mercado.
      referencia: TIENDA.referencia,
      abierto: estaAbierto(),
      horario: TIENDA.horario.texto,
      domingo: TIENDA.horario.domingo,
      /**
       * Lo que la portada le cuenta a quien todavía no compra: zonas y costos
       * de envío, provincias, comprobantes, devoluciones y pedidos por mayor.
       * Todo es lo mismo que el asesor ya responde a cualquiera. Sale de aquí y
       * no escrito en el HTML para que la portada y el asesor no digan dos
       * cifras distintas el día que el dueño cambie una tarifa.
       */
      delivery: {
        gratisDesde: TIENDA.delivery.gratisDesde,
        recojoEnTienda: TIENDA.delivery.recojoEnTienda,
        zonas: TIENDA.delivery.zonas.map(({ nombre, costo, horas, distritos }) =>
          ({ nombre, costo, horas, distritos })),
        provincias: TIENDA.delivery.provincias.habilitado ? {
          agencias: TIENDA.delivery.provincias.agencias,
          plazo: TIENDA.delivery.provincias.plazo,
          quienPaga: TIENDA.delivery.provincias.quienPaga,
        } : null,
      },
      igv: TIENDA.igv,
      pago: { medios: TIENDA.pago.medios, tarjeta: TIENDA.pago.tarjeta },
      comprobante: {
        boleta: TIENDA.comprobante.boleta,
        factura: TIENDA.comprobante.factura,
      },
      politicas: {
        devolucion: {
          diasPlazo: TIENDA.politicas.devolucion.diasPlazo,
          nota: TIENDA.politicas.devolucion.nota,
        },
        mayorista: {
          desde: TIENDA.politicas.mayorista.desde,
          plazoReposicion: TIENDA.politicas.mayorista.plazoReposicion,
        },
        escalones: TIENDA.politicas.regateo.escalones,
        garantiaOrigen: TIENDA.politicas.garantiaOrigen,
      },
    });
  }

  // Cotiza el envio de un distrito ANTES de comprar. Es lo que permite que el
  // carrito muestre el costo real en vez de "segun tu zona".
  if (metodo === 'POST' && ruta === '/api/envio') {
    const c = await leerCuerpo(req);
    const ubi = validarUbigeo(c);
    if (!ubi.ok) return json(res, 400, { error: ubi.error });
    const zona = zonaDe(ubi.valor);
    const sub = Number(c.subtotal) || 0;
    const umbral = TIENDA.delivery.gratisDesde;
    const gratis = zona.tipo === 'lima' && umbral > 0 && sub >= umbral;
    return json(res, 200, {
      ubigeo: ubi.valor,
      zona: zona.nombre,
      tipo: zona.tipo,
      plazo: zona.horas,
      nota: zona.nota || '',
      disponible: zona.disponible,
      costo: zona.tipo === 'provincia' ? null : (gratis ? 0 : zona.costo),
      gratis,
      faltaParaGratis: gratis || zona.tipo === 'provincia'
        ? 0 : Math.max(0, +(umbral - sub).toFixed(2)),
    });
  }

  if (metodo === 'GET' && ruta === '/api/productos') {
    return json(res, 200, Q.productos.all());
  }

  if (metodo === 'GET' && ruta.startsWith('/api/productos/')) {
    const p = Q.producto.get(Number(ruta.split('/')[3]));
    return p ? json(res, 200, p) : json(res, 404, { error: 'Producto no encontrado' });
  }

  if (metodo === 'POST' && ruta === '/api/asesor') {
    if (excedeCuota(req, res, 'asesor')) return;
    const { consulta } = await leerCuerpo(req);
    if (!consulta || !consulta.trim()) {
      return json(res, 400, { error: 'Escribe tu consulta.' });
    }
    return json(res, 200, await asesorar(consulta.trim(), Q.paraAsesor.all(),
      (codigo) => Q.porCodigo.get(codigo)));
  }

  // Venta en el local. La hace quien atiende, asi que NO es requiereAdmin:
  // cobrar es el trabajo del mostrador.
  if (metodo === 'POST' && ruta === '/api/mostrador') {
    const sesion = requierePuesto(req, res);
    if (!sesion) return;
    return venderEnMostrador(res, await leerCuerpo(req), sesion);
  }

  if (metodo === 'POST' && ruta === '/api/pedidos') {
    if (excedeCuota(req, res, 'pedidos')) return;
    const body = await leerCuerpo(req);
    return crearPedido(res, body);
  }

  // ------------------------------------------------- seguimiento del cliente
  /**
   * El cliente consulta SU pedido con el código + los últimos 4 dígitos del
   * teléfono que dejó. Los dos juntos son un segundo factor de verdad: con solo
   * el código, cualquiera que lo adivinara vería el pedido de otro.
   * Nunca se devuelven teléfono ni dirección completos.
   */
  const SEGUIMIENTO = ['/api/seguimiento', '/api/seguimiento/recibido',
    '/api/seguimiento/comprobante'];

  // La descarga del PDF va por GET para que sea un enlace normal: un botón
  // que se pueda tocar, compartir y reintentar. Los datos que la abren son los
  // mismos que ya viajan en la URL de la página del comprobante.
  const pdfDelComprador = metodo === 'GET' && ruta === '/api/seguimiento/comprobante/pdf';

  if (pdfDelComprador || (metodo === 'POST' && SEGUIMIENTO.includes(ruta))) {
    if (excedeCuota(req, res, 'seguimiento')) return;
    const { codigo, telefono } = pdfDelComprador
      ? { codigo: url.searchParams.get('codigo'), telefono: url.searchParams.get('tel') }
      : await leerCuerpo(req);

    const pedido = Q.porCodigo.get(String(codigo || '').trim().toUpperCase());
    const ultimos4 = String(telefono || '').replace(/\D/g, '').slice(-4);

    // El mismo mensaje para código inexistente y teléfono equivocado: si
    // fueran distintos, se podría averiguar qué códigos existen.
    if (!pedido || ultimos4.length !== 4 || !pedido.cliente_tel.endsWith(ultimos4)) {
      return json(res, 404, {
        error: 'No encontramos ese pedido. Revisa el código y el teléfono.',
      });
    }

    /**
     * La boleta o factura del propio comprador, para verla e imprimirla.
     *
     * Es el mismo documento que ve la tienda y sale del mismo sitio, para que
     * los importes no puedan diferir. Lo que cambia es cómo se entra: aquí no
     * hay sesión, sino el mismo par código + últimos cuatro dígitos con que ya
     * consulta su pedido. Nadie tiene por qué llamar a la tienda para pedir su
     * comprobante.
     */
    if (ruta === '/api/seguimiento/comprobante' || pdfDelComprador) {
      const cmp = comprobanteDePedido(pedido.id);
      if (!cmp) {
        return json(res, 404, { error: 'Este pedido todavía no tiene comprobante emitido.' });
      }
      const d = detalleComprobante(cmp.id);
      if (!d) return json(res, 404, { error: 'No encontramos el comprobante.' });
      if (pdfDelComprador) return enviarPdf(res, d);
      // El XML es para SUNAT y para la tienda; al comprador le toca la
      // representación impresa, que es lo que la ley le exige recibir.
      const { xml, cdr, ...impreso } = d;
      void xml; void cdr;
      return json(res, 200, impreso);
    }

    if (ruta === '/api/seguimiento/recibido') {
      if (pedido.estado === 'anulado' || pedido.estado === 'devuelto') {
        return json(res, 409, { error: `Este pedido figura como ${pedido.estado}.` });
      }
      if (!pedido.recibido_en) {
        db.exec('BEGIN IMMEDIATE');
        try {
          Q.confirmarRecepcion.run(String(pedido.cliente_nombre).slice(0, 120), pedido.id);
          if (pedido.estado !== 'entregado') Q.estado.run('entregado', pedido.id);
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          return json(res, 500, { error: e.message });
        }
      }
    }

    const actual = Q.pedido.get(pedido.id);
    const cmp = comprobanteDePedido(pedido.id);

    return json(res, 200, {
      codigo: actual.codigo,
      estado: actual.estado,
      fecha: actual.creado_en,
      entrega: actual.modo_entrega === 'recojo'
        ? 'Recojo en el local'
        : [actual.distrito, actual.provincia].filter(Boolean).join(', '),
      // Dirección recortada: confirma al cliente que es la suya sin exponerla.
      direccion: String(actual.cliente_dir).slice(0, 18) + '…',
      subtotal: +(actual.total - actual.costo_envio).toFixed(2),
      envio: actual.costo_envio,
      total: actual.total,
      comprobante: cmp ? numeroDe(cmp.serie, cmp.correlativo) : null,
      tipoComprobante: actual.tipo_comprobante,
      recibidoEn: actual.recibido_en || null,
      items: Q.itemsDe.all(pedido.id).map((i) => ({
        nombre: i.nombre, cantidad: i.cantidad, subtotal: i.subtotal,
      })),
    });
  }

  // Datos personales de los clientes: solo con sesion.
  if (metodo === 'GET' && ruta === '/api/pedidos') {
    const sesion = requiereSesion(req, res);
    if (!sesion) return;
    const lista = Q.pedidos.all()
      .filter((p) => !esReparto(sesion) || salePorReparto(p))
      .map((p) => {
        const con = { ...p, items: itemsSegun(p.id, sesion) };
        return esReparto(sesion) ? pedidoParaReparto(con) : con;
      });
    return json(res, 200, lista);
  }

  if (metodo === 'PATCH' && /^\/api\/pedidos\/\d+\/estado$/.test(ruta)) {
    const sesion = requiereSesion(req, res);
    if (!sesion) return;
    const id = Number(ruta.split('/')[3]);
    const { estado } = await leerCuerpo(req);
    if (!ESTADOS.includes(estado)) {
      return json(res, 400, { error: 'Estado no valido' });
    }
    const pedido = Q.pedido.get(id);
    if (!pedido) return json(res, 404, { error: 'Pedido no encontrado' });

    /**
     * El motorizado mueve su pedido hacia adelante y nada mas.
     *
     * Puede marcarlo «preparando», «enviado» y «entregado»: los tres toques de
     * su recorrido, que son los tres que el comprador ve encenderse en su
     * pagina de seguimiento mientras espera. Lo que no puede es anular ni
     * devolver: eso repone stock y emite una nota de credito, y quien lo decide
     * tiene que ser quien responde por el inventario.
     */
    const DEL_REPARTO = new Set(['preparando', 'enviado', 'entregado']);
    if (esReparto(sesion)) {
      if (!DEL_REPARTO.has(estado)) {
        return json(res, 403, {
          error: 'Desde el reparto solo se avanza el pedido: preparando, en camino o entregado.',
        });
      }
      if (!salePorReparto(pedido)) {
        return json(res, 403, { error: 'Ese pedido no sale a reparto.' });
      }
    }
    if (REPONEN_STOCK.has(pedido.estado)) {
      return json(res, 409, { error: `El pedido ya figura como ${pedido.estado}` });
    }
    // Anular y devolver reponen la mercaderia al inventario.
    if (REPONEN_STOCK.has(estado)) {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const it of Q.itemsDe.all(id)) {
          Q.reponer.run(it.cantidad, it.producto_id);
          const p = Q.paraActualizar.get(it.producto_id);
          Q.insMov.run(it.producto_id, estado, it.cantidad, p.stock,
            (estado === 'anulado' ? 'Anulacion' : 'Devolucion') +
            ' pedido ' + pedido.codigo);
        }
        Q.estado.run(estado, id);
        db.exec('COMMIT');

        // Un comprobante emitido no se borra: se compensa con una nota de
        // credito. Por eso anular o devolver genera un documento nuevo.
        const cmp = comprobanteDePedido(id);
        if (cmp) {
          const motivo = estado === 'devuelto'
            ? MOTIVO_NOTA_CREDITO.DEVOLUCION_TOTAL
            : MOTIVO_NOTA_CREDITO.ANULACION_OPERACION;
          const desc = estado === 'devuelto'
            ? 'Devolucion total del pedido ' + pedido.codigo
            : 'Anulacion del pedido ' + pedido.codigo;
          const nc = emitirNotaCredito(cmp.id, motivo, desc);
          if (!nc.ok) console.warn('[nota de credito] ' + nc.error);
        }
      } catch (e) {
        db.exec('ROLLBACK');
        return json(res, 500, { error: e.message });
      }
    } else {
      Q.estado.run(estado, id);
    }
    Q.insActividad.run(sesion.usuario, sesion.rol, estado, id, pedido.codigo, pedido.total);
    return json(res, 200, Q.pedido.get(id));
  }

  /**
   * Mover el stock a mano: ingreso de mercadería y ajustes.
   *
   * Pasa a ser de la dueña. Era del mostrador —«el ingreso de mercadería es su
   * trabajo»— y la decisión se revisó: quien registra lo que entra es quien
   * responde por lo que falta, y en este puesto esa es ella. El mostrador sigue
   * moviendo stock todo el día, pero por la vía que no se puede falsear:
   * vendiendo.
   */
  if (metodo === 'POST' && ruta === '/api/stock') {
    const sesion = requiereAdmin(req, res);
    if (!sesion) return;
    const { producto_id, cantidad, motivo } = await leerCuerpo(req);
    const cant = Number(cantidad);
    if (!Number.isInteger(cant) || cant === 0) {
      return json(res, 400, { error: 'Cantidad invalida' });
    }
    const p = Q.paraActualizar.get(Number(producto_id));
    if (!p) return json(res, 404, { error: 'Producto no encontrado' });
    if (p.stock + cant < 0) {
      return json(res, 409, { error: 'El ajuste dejaria el stock en negativo' });
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      Q.reponer.run(cant, p.id);
      const fresco = Q.paraActualizar.get(p.id);
      // Quien lo hizo queda en el kardex: un ajuste manual sin responsable
      // es exactamente por donde se pierde mercaderia sin que nadie lo note.
      Q.insMov.run(p.id, cant > 0 ? 'ingreso' : 'ajuste', cant, fresco.stock,
        (motivo || (cant > 0 ? 'Reposicion manual' : 'Ajuste manual')) +
        ' (' + sesion.usuario + ')');
      db.exec('COMMIT');
      return json(res, 200, fresco);
    } catch (e) {
      db.exec('ROLLBACK');
      return json(res, 500, { error: e.message });
    }
  }

  // Catalogo completo, incluidos los productos dados de baja.
  if (metodo === 'GET' && ruta === '/api/admin/productos') {
    const sesion = requierePuesto(req, res);
    if (!sesion) return;
    return json(res, 200, fichasPara(sesion, Q.todosProductos.all()));
  }

  // Categorias existentes, para que el formulario de alta las sugiera y no se
  // llene el catalogo de "Hierbas", "hierbas" y "Yerbas".
  // Solo la usa el formulario de alta de fichas, que ya era de la dueña.
  if (metodo === 'GET' && ruta === '/api/admin/categorias') {
    if (!requiereAdmin(req, res)) return;
    return json(res, 200, Q.categorias.all());
  }

  // Alta de producto. Lo unico que el panel todavia no podia hacer solo: para
  // meter algo nuevo habia que tocar la base a mano.
  if (metodo === 'POST' && ruta === '/api/productos') {
    // Dar de alta una ficha es fijar un precio y un costo: del dueño.
    const sesion = requiereAdmin(req, res);
    if (!sesion) return;

    const cuerpo = await leerCuerpo(req);
    const v = validarAlta(cuerpo);
    if (v.error) return json(res, 400, { error: v.error, campo: v.campo });
    const p = v.producto;

    db.exec('BEGIN IMMEDIATE');
    try {
      // El SKU se calcula dentro de la transaccion: si dos altas entran a la
      // vez, la segunda ve el numero que acaba de tomar la primera.
      const sku = p.sku || siguienteSku(p.categoria);
      if (Q.porSku.get(sku)) throw new Error(`El código ${sku} ya está en uso.`);

      const id = Q.insProducto.run(
        sku, p.nombre, p.categoria, p.origen, p.presentacion, p.descripcion,
        p.uso_tradicional, p.beneficios, p.etiquetas, p.precio, p.costo,
        p.stock, p.stock_min, p.imagen || rutaIlustracion(p.presentacion, p.categoria),
      ).lastInsertRowid;

      // El stock inicial entra como movimiento, no como un numero puesto a
      // dedo: asi el kardex explica cada unidad desde el primer dia.
      if (p.stock > 0) {
        Q.insMov.run(id, 'ingreso', p.stock, p.stock, 'Alta del producto');
      }
      Q.insCambio.run(id, 'alta', '—', `${sku} · ${p.nombre}`, sesion.usuario);

      db.exec('COMMIT');
      return json(res, 201, { ok: true, producto: Q.paraActualizar.get(Number(id)) });
    } catch (e) {
      db.exec('ROLLBACK');
      const choque = /UNIQUE/.test(e.message);
      return json(res, choque ? 409 : 500, {
        error: choque ? 'Ya existe un producto con ese código.' : e.message,
      });
    }
  }

  if (metodo === 'GET' && ruta === '/api/admin/comprobantes') {
    const sesion = requiereSesion(req, res);
    if (!sesion) return;
    // El motorizado ve el papel de lo que el reparte, por si el cliente lo pide
    // en la puerta. Las ventas de mostrador y los recojos no son suyos.
    const suyos = esReparto(sesion)
      ? new Set(Q.pedidos.all().filter(salePorReparto).map((p) => p.id))
      : null;
    return json(res, 200, listarComprobantes(100)
      .filter((c) => !suyos || suyos.has(c.pedido_id))
      .map((c) => ({
        id: c.id, numero: numeroDe(c.serie, c.correlativo), tipo_doc: c.tipo_doc,
        fecha: c.fecha_emision, estado: c.estado, total: c.total, igv: c.igv,
        cliente: c.cliente_nombre, doc: c.cliente_num_doc,
        pedido_id: c.pedido_id,
        ref: c.ref_serie ? numeroDe(c.ref_serie, c.ref_correlativo) : '',
      })));
  }

  if (metodo === 'GET' && /^\/api\/comprobantes\/\d+$/.test(ruta)) {
    if (!requiereSesion(req, res)) return;
    const d = detalleComprobante(Number(ruta.split('/')[3]));
    return d ? json(res, 200, d) : json(res, 404, { error: 'No existe el comprobante.' });
  }

  // El comprobante como PDF, para archivar o mandar por WhatsApp.
  if (metodo === 'GET' && /^\/api\/comprobantes\/\d+\/pdf$/.test(ruta)) {
    if (!requiereSesion(req, res)) return;
    const d = detalleComprobante(Number(ruta.split('/')[3]));
    if (!d) return json(res, 404, { error: 'No existe el comprobante.' });
    return enviarPdf(res, d);
  }

  // XML listo para firmar y enviar al OSE.
  if (metodo === 'GET' && /^\/api\/comprobantes\/\d+\/xml$/.test(ruta)) {
    if (!requiereSesion(req, res)) return;
    const d = detalleComprobante(Number(ruta.split('/')[3]));
    if (!d) return json(res, 404, { error: 'No existe el comprobante.' });
    const archivo = `${TIENDA.comprobante.ruc}-${d.tipoDoc}-${d.numero}.xml`;
    res.writeHead(200, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${archivo}"`,
    });
    return res.end(d.xml);
  }

  if (metodo === 'GET' && ruta === '/api/admin/cambios') {
    // Lleva el historial de precios: quien no ve el precio tampoco su rastro.
    if (!requiereAdmin(req, res)) return;
    return json(res, 200, Q.cambios.all());
  }

  // Edicion de ficha: precio, minimo y alta/baja. Cada cambio queda firmado.
  // La ficha entera es de la dueña, incluido el mínimo de reposición: con la
  // sección de reposición fuera del panel del mostrador, ajustarlo desde ahí ya
  // no tenía dónde hacerse.
  if (metodo === 'PATCH' && /^\/api\/productos\/\d+$/.test(ruta)) {
    const sesion = requiereAdmin(req, res);
    if (!sesion) return;

    const p = Q.paraActualizar.get(Number(ruta.split('/')[3]));
    if (!p) return json(res, 404, { error: 'Producto no encontrado' });

    const cuerpo = await leerCuerpo(req);
    const cambios = [];
    for (const [campo, regla] of Object.entries(EDITABLES)) {
      if (!(campo in cuerpo)) continue;
      // El permiso se mira campo por campo y no en la puerta: el mostrador
      // tiene que poder ajustar el minimo de un producto sin poder tocar su
      // precio, y las dos cosas entran por la misma peticion.
      if (regla.soloDueno && !esAdmin(sesion)) {
        return json(res, 403, {
          error: `Cambiar el ${regla.etiqueta} solo lo hace el dueño de la tienda.`,
        });
      }
      const valor = regla.validar(cuerpo[campo], p);
      if (valor === null) {
        return json(res, 400, { error: `Valor no válido para ${regla.etiqueta}.` });
      }
      if (valor === p[campo]) continue;          // sin cambio real, sin registro
      cambios.push({ campo, antes: p[campo], despues: valor });
    }

    if (!cambios.length) return json(res, 200, { ok: true, sin_cambios: true, producto: p });

    db.exec('BEGIN IMMEDIATE');
    try {
      for (const c of cambios) {
        // El nombre de columna sale de EDITABLES, no del cuerpo de la peticion:
        // nunca se interpola algo que venga del cliente.
        db.prepare(`UPDATE productos SET ${c.campo} = ? WHERE id = ?`).run(c.despues, p.id);
        Q.insCambio.run(p.id, c.campo, String(c.antes), String(c.despues), sesion.usuario);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      return json(res, 500, { error: e.message });
    }

    return json(res, 200, {
      ok: true,
      producto: Q.paraActualizar.get(p.id),
      cambios: cambios.map((c) => EDITABLES[c.campo].etiqueta),
    });
  }

  if (metodo === 'GET' && ruta === '/api/admin/resumen') {
    const sesion = requierePuesto(req, res);
    if (!sesion) return;
    return json(res, 200, resumen(sesion));
  }

  // El kardex: cada unidad que entró o salió y por qué. Es la contabilidad
  // del inventario, no una herramienta de mostrador.
  if (metodo === 'GET' && ruta === '/api/admin/movimientos') {
    if (!requiereAdmin(req, res)) return;
    return json(res, 200, Q.movimientos.all());
  }

  // Estado del respaldo. El panel lo muestra para que nadie tenga que
  // acordarse de comprobarlo.
  if (metodo === 'GET' && ruta === '/api/admin/respaldos') {
    if (!requiereAdmin(req, res)) return;
    const lista = listarRespaldos();
    return json(res, 200, {
      carpeta: DIR_RESPALDOS,
      fuera_del_disco: Boolean(process.env.RESPALDO_DIR),
      se_guardan: DIAS_QUE_SE_GUARDAN,
      ultimo: ultimoRespaldo(),
      respaldos: lista,
    });
  }

  // Respaldar a mano: antes de cerrar, antes de cargar el catalogo, antes de
  // cualquier cosa que de miedo.
  if (metodo === 'POST' && ruta === '/api/admin/respaldos') {
    if (!requiereAdmin(req, res)) return;
    try {
      return json(res, 200, { ok: true, ...respaldar() });
    } catch (e) {
      // El motivo si sale al panel: es personal del negocio, no un cliente, y
      // "no se pudo" sin decir por que no deja arreglar un disco lleno.
      return json(res, 500, { error: e.message });
    }
  }

  // Cuanto se vendio cada dia del mes. Sin `?mes=`, el mes en curso.
  // Cuánto entró cada día del mes: la facturación del negocio.
  if (metodo === 'GET' && ruta === '/api/admin/calendario') {
    if (!requiereAdmin(req, res)) return;
    return json(res, 200, calendario(url.searchParams.get('mes')));
  }

  // Quienes compran y que compro cada uno. Con `?doc=`, el historial de ese.
  if (metodo === 'GET' && ruta === '/api/admin/clientes') {
    const sesion = requierePuesto(req, res);
    if (!sesion) return;
    const doc = url.searchParams.get('doc');
    if (doc) {
      // Las lineas pasan por el mismo filtro que `/api/pedidos`. Salian crudas,
      // con `costo_unit`: el mostrador veia el costo de todo lo que compro un
      // cliente con solo abrir su historial.
      const pedidos = Q.historialDe.all(doc).map((p) => ({
        ...p, items: itemsSegun(p.id, sesion),
      }));
      if (pedidos.length === 0) return json(res, 404, { error: 'Sin historial' });
      return json(res, 200, pedidos);
    }
    return json(res, 200, Q.clientes.all());
  }

  return json(res, 404, { error: 'Ruta no encontrada' });
}

// Registra el pedido y descuenta stock en una sola transaccion:
// o entra todo, o no entra nada. Es lo que evita vender lo que no hay.
function crearPedido(res, body) {
  const { cliente = {}, items = [], canal = 'web' } = body;
  const nombre = String(cliente.nombre || '').trim();

  /**
   * Recojo en el local: el cliente compra por la web y pasa por el puesto.
   *
   * Es media venta que antes se perdia. El checkout exigia departamento,
   * provincia, distrito y direccion a alguien que vive a dos cuadras del
   * mercado, y le cobraba S/ 6 de reparto por algo que iba a ir a buscar.
   *
   * Si lo ofrece o no lo dice tienda.config.js, no el navegador: de otro modo
   * bastaria mandar `entrega: 'recojo'` para saltarse el flete de una zona.
   */
  const recojo = String(body.entrega || '') === 'recojo';
  if (recojo && !TIENDA.delivery.recojoEnTienda) {
    return json(res, 400, { error: 'Por ahora no hay recojo en el local.' });
  }

  // Con recojo la direccion del pedido es la del local: es donde esta la
  // mercaderia y es lo que tiene que leer quien lo prepara.
  const dir = recojo ? TIENDA.direccion : String(cliente.direccion || '').trim();

  if (nombre.length < 3) return json(res, 400, { error: 'Falta el nombre del cliente.' });
  if (nombre.length > 120) return json(res, 400, { error: 'El nombre es demasiado largo.' });
  if (!recojo) {
    if (dir.length < 5) return json(res, 400, { error: 'Falta la direccion de entrega.' });
    if (dir.length > 200) return json(res, 400, { error: 'La direccion es demasiado larga.' });
  }

  // --- Datos peruanos. Se validan en el servidor porque son los que van a
  // terminar en un comprobante: el navegador puede mandar cualquier cosa.
  const tel = validarTelefono(cliente.telefono);
  if (!tel.ok) return json(res, 400, { error: tel.error });

  const doc = validarDocumento({
    tipo: cliente.tipo_doc,
    numero: cliente.num_doc,
    razonSocial: cliente.razon_social,
  });
  if (!doc.ok) return json(res, 400, { error: doc.error });

  // Con factura el correo es obligatorio: es donde se manda el comprobante.
  const correo = validarCorreo(cliente.email, doc.comprobante === 'factura');
  if (!correo.ok) return json(res, 400, { error: correo.error });

  // El que recoge no declara ubigeo: el pedido se guarda con el del local, que
  // es donde va a ocurrir la entrega.
  const ubi = recojo
    ? { ok: true, valor: { ...TIENDA.local } }
    : validarUbigeo({
      departamento: cliente.departamento,
      provincia: cliente.provincia,
      distrito: cliente.distrito,
    });
  if (!ubi.ok) return json(res, 400, { error: ubi.error });

  const zona = recojo ? null : zonaDe(ubi.valor);
  if (zona && !zona.disponible) {
    return json(res, 400, { error: `No repartimos a ${ubi.valor.departamento} por ahora.` });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return json(res, 400, { error: 'El carrito esta vacio.' });
  }

  // Consolida cantidades repetidas del mismo producto antes de validar.
  const pedidos = new Map();
  for (const it of items) {
    const id = Number(it.id);
    const cant = Number(it.cantidad);
    if (!Number.isInteger(id) || !Number.isInteger(cant) || cant < 1) {
      return json(res, 400, { error: 'Item invalido en el carrito.' });
    }
    pedidos.set(id, (pedidos.get(id) || 0) + cant);
  }

  const lineas = [];
  const faltantes = [];
  for (const [id, cant] of pedidos) {
    const p = Q.paraVender.get(id);
    if (!p) return json(res, 400, { error: 'Producto no disponible (id ' + id + ').' });
    if (p.stock < cant) {
      // Qué producto y cuánto pidió, pero no cuánto hay: con «quedan 4» basta
      // pedir de más una vez para leer el inventario entero. El mostrador sí
      // recibe la cifra (venderEnMostrador): quien atiende es del negocio.
      faltantes.push({ id: p.id, nombre: p.nombre, pedido: cant });
      continue;
    }
    lineas.push({ p, cant, subtotal: +(precioPorUnidadBase(p) * cant).toFixed(2) });
  }

  if (faltantes.length) {
    return json(res, 409, {
      error: 'No tenemos esa cantidad de algunos productos.',
      faltantes,
    });
  }

  const subtotal = +lineas.reduce((s, l) => s + l.subtotal, 0).toFixed(2);

  // El envío lo calcula el servidor a partir del distrito validado, nunca lo
  // que mande el navegador. Gratis por encima del umbral; en provincia el
  // flete lo paga el cliente en la agencia, así que aquí va en cero.
  // Lo que el cliente va a recoger no tiene flete: no sale a la calle.
  const umbral = TIENDA.delivery.gratisDesde;
  const envio = recojo || zona.tipo === 'provincia' || (umbral && subtotal >= umbral)
    ? 0
    : (zona.costo || 0);

  const total = +(subtotal + envio).toFixed(2);

  db.exec('BEGIN IMMEDIATE');
  try {
    /**
     * El codigo se reintenta si ya existe.
     *
     * `pedidos.codigo` es unico y el codigo tiene 46 656 valores por fecha:
     * con 150 pedidos en un mismo dia la probabilidad de que dos coincidan
     * pasa del 20 % (problema del cumpleanos). Antes ese choque salia como
     * `500 No se pudo registrar el pedido` — la venta se perdia en la caja,
     * por un codigo repetido.
     *
     * Va dentro del BEGIN a proposito: en SQLite un UNIQUE aborta la
     * sentencia, no la transaccion, asi que el reintento entra en el mismo
     * bloque sin reabrir nada. Ocho intentos sobran: con 400 pedidos ya
     * cargados en la fecha —un dia excepcional para el local— que fallen los
     * ocho es 3 entre 10 ** 17. Si aun asi fallaran, el error sube y el
     * pedido se revierte entero, que es la unica salida honesta.
     */
    let codigo, pedidoId;
    for (let intento = 1; ; intento++) {
      codigo = codigoPedido();
      try {
        const r = Q.insPedido.run(
          codigo, nombre, tel.valor, dir, String(body.nota || '').slice(0, 300),
          total, canal, correo.valor, doc.tipo, doc.numero, doc.razonSocial,
          doc.comprobante, ubi.valor.departamento, ubi.valor.provincia,
          ubi.valor.distrito, ubi.valor.codigo,
          recojo ? '' : String(cliente.referencia || '').trim().slice(0, 200),
          envio, recojo ? 'recojo' : 'envio');
        pedidoId = Number(r.lastInsertRowid);
        break;
      } catch (e) {
        if (intento >= 8 || !/UNIQUE.*pedidos\.codigo/i.test(e.message)) throw e;
      }
    }

    for (const l of lineas) {
      Q.insItem.run(pedidoId, l.p.id, l.p.nombre, l.cant,
        precioPorUnidadBase(l.p), l.subtotal, costoPorUnidadBase(l.p), l.p.unidad);
      Q.descontar.run(l.cant, l.p.id);
      const fresco = Q.paraActualizar.get(l.p.id);
      if (fresco.stock < 0) throw new Error('Stock negativo en ' + l.p.nombre);
      Q.insMov.run(l.p.id, 'venta', -l.cant, fresco.stock, 'Pedido ' + codigo);
    }
    db.exec('COMMIT');

    // El comprobante se emite junto con la venta. Si fallara, el pedido ya
    // esta hecho: se avisa pero no se tumba la compra del cliente.
    let comprobante = null;
    try {
      const r2 = emitirPorPedido(Q.pedido.get(pedidoId), Q.itemsDe.all(pedidoId));
      if (r2.ok) comprobante = r2.comprobante;
      else console.warn('[comprobante] ' + r2.error);
    } catch (e) {
      console.warn('[comprobante] ' + e.message);
    }

    // Aquí no van las alertas de reposición: esta respuesta la recibe el
    // comprador, y «quedan 2 de 10» es inventario. El panel ya las muestra en
    // Reposición urgente, y la venta de mostrador las sigue devolviendo.
    return json(res, 201, {
      ok: true,
      pedido: {
        id: pedidoId, codigo, subtotal, envio, total, estado: 'pendiente',
        comprobante: doc.comprobante,
        numeroComprobante: comprobante ? comprobante.numero : null,
        modoEntrega: recojo ? 'recojo' : 'envio',
        zona: recojo ? 'Recojo en el local' : zona.nombre,
        plazo: recojo ? TIENDA.horario.texto : zona.horas,
        entrega: recojo ? TIENDA.direccion : `${ubi.valor.distrito}, ${ubi.valor.provincia}`,
      },
    });
  } catch (e) {
    db.exec('ROLLBACK');
    return json(res, 500, { error: 'No se pudo registrar el pedido: ' + e.message });
  }
}

/**
 * Venta en el local: el cliente esta delante del mostrador y se lleva la
 * mercaderia.
 *
 * Es la venta que el negocio hace todo el dia, y hasta ahora el sistema solo
 * sabia registrar la que entraba por la tienda web. Se apoya en la misma
 * maquinaria —descuento de stock, kardex, comprobante, todo en una
 * transaccion— pero se salta lo que no existe en una venta de mostrador:
 *
 * - **Sin direccion ni envio.** No hay reparto: se lo llevan. El pedido queda
 *   con la direccion del local y `costo_envio` en cero.
 * - **Nace `entregado`.** No hay nada que preparar ni despachar; pasar por
 *   «pendiente» dejaria la cola de por-atender llena de ventas ya cerradas.
 * - **El documento es opcional.** Pedirle el DNI a quien compra muña de S/ 9
 *   es perder la venta. Sin documento sale una boleta a nombre del mostrador,
 *   que es lo que se hace en el puesto.
 */
function venderEnMostrador(res, body, sesion) {
  const { items = [], cliente = {} } = body;

  if (!Array.isArray(items) || items.length === 0) {
    return json(res, 400, { error: 'No hay nada en el carrito.' });
  }

  const nombre = texto(cliente.nombre, 120) || 'Cliente de mostrador';

  // El documento solo se valida si lo dieron. Con RUC sale factura y entonces
  // si hace falta la razon social: eso lo exige SUNAT, no nosotros.
  let doc = { tipo: 'DNI', numero: '', razonSocial: '', comprobante: 'boleta' };
  if (String(cliente.num_doc || '').trim()) {
    const v = validarDocumento({
      tipo: cliente.tipo_doc, numero: cliente.num_doc, razonSocial: cliente.razon_social,
    });
    if (!v.ok) return json(res, 400, { error: v.error });
    doc = v;
  }

  // El telefono es opcional, pero si lo dan tiene que servir: es con lo que el
  // comprador consulta su comprobante despues.
  let telefono = '';
  if (String(cliente.telefono || '').trim()) {
    const t = validarTelefono(cliente.telefono);
    if (!t.ok) return json(res, 400, { error: t.error });
    telefono = t.valor;
  }

  const pedidas = new Map();
  for (const it of items) {
    const id = Number(it.id);
    const cant = Number(it.cantidad);
    if (!Number.isInteger(id) || !Number.isInteger(cant) || cant < 1) {
      return json(res, 400, { error: 'Item invalido en el carrito.' });
    }
    pedidas.set(id, (pedidas.get(id) || 0) + cant);
  }

  const lineas = [];
  const faltantes = [];
  for (const [id, cant] of pedidas) {
    const p = Q.paraVender.get(id);
    if (!p) return json(res, 400, { error: `Producto no disponible (id ${id}).` });
    if (p.stock < cant) {
      faltantes.push({ id: p.id, nombre: p.nombre, pedido: cant, disponible: p.stock });
      continue;
    }
    lineas.push({ p, cant, subtotal: +(precioPorUnidadBase(p) * cant).toFixed(2) });
  }
  // Se avisa ANTES de cobrar: en el mostrador el cliente esta delante y hay
  // que poder decirle «de ese me queda uno» sin haber emitido nada.
  if (faltantes.length) {
    return json(res, 409, { error: 'No hay stock suficiente.', faltantes });
  }

  const total = +lineas.reduce((s, l) => s + l.subtotal, 0).toFixed(2);
  const costo = +lineas.reduce((s, l) => s + costoPorUnidadBase(l.p) * l.cant, 0).toFixed(2);

  db.exec('BEGIN IMMEDIATE');
  try {
    let codigo, pedidoId;
    for (let intento = 1; ; intento++) {
      codigo = codigoPedido();
      try {
        const r = Q.insPedido.run(
          codigo, nombre, telefono, TIENDA.direccion,
          texto(body.nota, 300), total, 'mostrador', '',
          doc.tipo, doc.numero, doc.razonSocial, doc.comprobante,
          TIENDA.local.departamento, TIENDA.local.provincia,
          TIENDA.local.distrito, TIENDA.local.codigo, '', 0, 'recojo');
        pedidoId = Number(r.lastInsertRowid);
        break;
      } catch (e) {
        if (intento >= 8 || !/UNIQUE.*pedidos\.codigo/i.test(e.message)) throw e;
      }
    }

    for (const l of lineas) {
      Q.insItem.run(pedidoId, l.p.id, l.p.nombre, l.cant,
        precioPorUnidadBase(l.p), l.subtotal, costoPorUnidadBase(l.p), l.p.unidad);
      Q.descontar.run(l.cant, l.p.id);
      const fresco = Q.paraActualizar.get(l.p.id);
      if (fresco.stock < 0) throw new Error('Stock negativo en ' + l.p.nombre);
      Q.insMov.run(l.p.id, 'venta', -l.cant, fresco.stock, 'Mostrador ' + codigo);
    }
    // Se lo llevo: no hay nada que despachar.
    Q.estado.run('entregado', pedidoId);
    // Quién cobró: dentro de la misma transacción, para que no quede una venta
    // sin firma si algo falla después.
    Q.insActividad.run(sesion.usuario, sesion.rol, 'venta_local', pedidoId, codigo, total);
    db.exec('COMMIT');

    let comprobante = null;
    try {
      const r2 = emitirPorPedido(Q.pedido.get(pedidoId), Q.itemsDe.all(pedidoId));
      if (r2.ok) comprobante = r2.comprobante;
      else console.warn('[comprobante] ' + r2.error);
    } catch (e) {
      console.warn('[comprobante] ' + e.message);
    }

    const alertas = Q.bajoStock.all()
      .filter((p) => lineas.some((l) => l.p.id === p.id))
      .map((p) => ({ nombre: p.nombre, stock: p.stock, stock_min: p.stock_min }));

    return json(res, 201, {
      ok: true,
      venta: {
        id: pedidoId,
        codigo,
        total,
        estado: 'entregado',
        comprobante: doc.comprobante,
        numeroComprobante: comprobante ? comprobante.numero : null,
        cliente: nombre,
        // La ganancia se calcula del costo: es del dueño. El mostrador cobra
        // igual, solo no ve cuanto se gano.
        ...(esAdmin(sesion) ? { ganancia: +(total - costo).toFixed(2) } : {}),
      },
      alertas,
    });
  } catch (e) {
    db.exec('ROLLBACK');
    return json(res, 500, { error: 'No se pudo registrar la venta: ' + e.message });
  }
}

/**
 * El tablero. `sesion` decide cuanto se ve: el valor del inventario esta
 * calculado **a costo**, asi que es el costo del catalogo entero en una sola
 * cifra. Para el mostrador se manda las unidades, que es lo que necesita para
 * saber si hay que reponer, sin la plata.
 */
function resumen(sesion) {
  const hoy = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM pedidos
    WHERE date(creado_en) = date('now','localtime')
      AND estado NOT IN ('anulado','devuelto')`).get();

  // El negocio vende por dos canales y **descuenta del mismo stock**. Verlos
  // separados es lo que permite al dueño comprobar que cuadra: si vendio 3 en
  // el local y 2 por la web, el inventario tiene que haber bajado 5.
  const porCanal = db.prepare(`SELECT canal, COUNT(*) c, COALESCE(SUM(total),0) t
    FROM pedidos
    WHERE date(creado_en) = date('now','localtime')
      AND estado NOT IN ('anulado','devuelto')
    GROUP BY canal`).all();
  const deCanal = (nombre) => porCanal.find((x) => x.canal === nombre) || { c: 0, t: 0 };
  const web = deCanal('web');
  const local = deCanal('mostrador');

  // La ganancia sale del costo congelado en cada linea, no del costo de hoy.
  const gana = db.prepare(`SELECT
      COALESCE(SUM(i.subtotal),0) venta,
      COALESCE(SUM(i.costo_unit * i.cantidad),0) costo
    FROM pedido_items i JOIN pedidos p ON p.id = i.pedido_id
    WHERE date(p.creado_en) = date('now','localtime')
      AND p.estado NOT IN ('anulado','devuelto')`).get();
  const pendientes = db.prepare(
    "SELECT COUNT(*) c FROM pedidos WHERE estado IN ('pendiente','preparando')").get();
  const inv = db.prepare(
    'SELECT COALESCE(SUM(stock * costo),0) v, COALESCE(SUM(stock),0) u FROM productos WHERE activo = 1').get();
  const top = db.prepare(`SELECT nombre, SUM(cantidad) unidades, SUM(subtotal) monto
    FROM pedido_items GROUP BY producto_id ORDER BY unidades DESC LIMIT 5`).all();
  const bajos = Q.bajoStock.all();

  /**
   * Al mostrador solo lo suyo.
   *
   * De este endpoint salen dos cosas distintas: los indicadores del día —caja,
   * ganancia, inventario— y la lista de más vendidos. La vendedora tiene «Más
   * vendidos» en su panel y no tiene los indicadores, así que tampoco los
   * recibe: mandárselos y no pintarlos dejaba la caja del día a un `fetch` de
   * distancia. Los pedidos por atender sí: son su cola de trabajo.
   */
  if (!esAdmin(sesion)) {
    return {
      pedidos_pendientes: pendientes.c,
      top_productos: top,
      bajo_stock: [],
    };
  }

  return {
    ventas_hoy: +hoy.t.toFixed(2),
    pedidos_hoy: hoy.c,
    pedidos_pendientes: pendientes.c,
    ventas_web_hoy: +web.t.toFixed(2),
    pedidos_web_hoy: web.c,
    ventas_local_hoy: +local.t.toFixed(2),
    ventas_local_cuantas: local.c,
    // La ganancia es del dueño: se calcula del costo.
    ...(esAdmin(sesion) ? { ganancia_hoy: +(gana.venta - gana.costo).toFixed(2) } : {}),
    ...(esAdmin(sesion) ? { valor_inventario: +inv.v.toFixed(2) } : {}),
    unidades_inventario: inv.u,
    agotados: bajos.filter((p) => p.stock === 0).length,
    bajo_stock: bajos.map((p) => ({
      id: p.id, nombre: p.nombre, sku: p.sku, stock: p.stock,
      stock_min: p.stock_min, emoji: p.emoji, imagen: p.imagen,
      sugerido: Math.max(p.stock_min * 2 - p.stock, p.stock_min),
    })),
    top_productos: top,
    equipo: equipoHoy(web),
  };
}

/**
 * Lo que hizo hoy cada persona del puesto, más la tienda web como un
 * integrante más: es por donde entran los pedidos que nadie cobró de frente.
 *
 * Solo para la dueña (se arma dentro de la rama admin de `resumen`): lo que
 * cobró cada quien es plata del negocio.
 */
function equipoHoy(web) {
  // En el orden del puesto: la dueña, quien atiende, quien reparte.
  const usuarios = db.prepare(`SELECT usuario, nombre, rol FROM usuarios
    ORDER BY CASE rol WHEN 'admin' THEN 0 WHEN 'vendedor' THEN 1 WHEN 'reparto' THEN 2 ELSE 3 END, nombre`).all();
  const hechos = db.prepare(`SELECT usuario, accion, COUNT(*) c, COALESCE(SUM(monto),0) t,
      MAX(creado_en) ultima
    FROM actividad_equipo
    WHERE date(creado_en) = date('now','localtime')
    GROUP BY usuario, accion`).all();
  // Lo que el motorizado tiene «en camino» ahora: pedidos que siguen en
  // `enviado` y cuyo último movimiento lo hizo él.
  const enCamino = db.prepare(`SELECT a.usuario, COUNT(*) c FROM actividad_equipo a
    JOIN pedidos p ON p.id = a.pedido_id
    WHERE p.estado = 'enviado' AND a.accion = 'enviado'
      AND a.id = (SELECT MAX(id) FROM actividad_equipo WHERE pedido_id = a.pedido_id)
    GROUP BY a.usuario`).all();
  const porRepartir = db.prepare(`SELECT COUNT(*) c FROM pedidos
    WHERE canal = 'web' AND modo_entrega != 'recojo'
      AND estado IN ('pendiente','preparando','enviado')`).get().c;

  const de = (usuario, accion) => hechos.find((h) => h.usuario === usuario && h.accion === accion) || { c: 0, t: 0 };
  const personas = usuarios.map((u) => {
    const suyos = hechos.filter((h) => h.usuario === u.usuario);
    const venta = de(u.usuario, 'venta_local');
    return {
      usuario: u.usuario,
      nombre: u.nombre,
      rol: u.rol,
      ventas_local: venta.c,
      ventas_local_monto: +venta.t.toFixed(2),
      preparados: de(u.usuario, 'preparando').c,
      enviados: de(u.usuario, 'enviado').c,
      entregados: de(u.usuario, 'entregado').c,
      anulados: de(u.usuario, 'anulado').c + de(u.usuario, 'devuelto').c,
      en_camino: enCamino.find((x) => x.usuario === u.usuario)?.c || 0,
      ultima_actividad: suyos.reduce((m, h) => (h.ultima > m ? h.ultima : m), '') || null,
    };
  });
  return {
    personas,
    web: { pedidos: web.c, monto: +web.t.toFixed(2), por_repartir: porRepartir },
  };
}

/**
 * Ventas dia por dia de un mes. Devuelve los 28-31 dias completos, tambien los
 * que no vendieron nada: un calendario con huecos se lee como un error de
 * carga, y un cero es informacion — ese martes no entro nada.
 *
 * `mes` llega del navegador, asi que se valida: cualquier cosa que no sea
 * AAAA-MM cae al mes en curso en vez de ir a la consulta.
 */
function calendario(mes) {
  const hoy = new Date();
  const enCurso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const m = /^\d{4}-(0[1-9]|1[0-2])$/.test(mes || '') ? mes : enCurso;

  const [anio, num] = m.split('-').map(Number);
  const cuantos = new Date(anio, num, 0).getDate();

  const porDia = new Map(Q.ventasDelMes.all(m).map((d) => [d.dia, d]));
  const dias = [];
  for (let i = 1; i <= cuantos; i++) {
    const fecha = `${m}-${String(i).padStart(2, '0')}`;
    const d = porDia.get(fecha);
    dias.push({
      fecha,
      dia: i,
      // getDay() con la fecha en hora local: se construye a mano para que no
      // la corra el uso horario, que en Peru restaria un dia.
      semana: new Date(anio, num - 1, i).getDay(),
      pedidos: d ? d.pedidos : 0,
      total: d ? +d.total.toFixed(2) : 0,
    });
  }

  const conVenta = dias.filter((d) => d.total > 0);
  const mejor = conVenta.reduce((a, b) => (b.total > (a?.total ?? 0) ? b : a), null);

  return {
    mes: m,
    dias,
    total_mes: +conVenta.reduce((t, d) => t + d.total, 0).toFixed(2),
    pedidos_mes: conVenta.reduce((t, d) => t + d.pedidos, 0),
    dias_con_venta: conVenta.length,
    mejor_dia: mejor && { fecha: mejor.fecha, total: mejor.total },
    meses: Q.mesesConVentas.all().map((r) => r.mes),
  };
}

// ---------------------------------------------------------------- estaticos
// Paginas que no se sirven sin sesion. Guardar solo la API bastaria para que no
// se filtren datos, pero un panel que abre y luego se vacia se ve roto: mejor
// mandar al login de frente.
//
// `imagenes.html` tambien entra: es una herramienta de control interno. Un
// cliente que la encuentra ve el andamiaje del negocio, no la tienda.
// Paginas que no se sirven sin sesion, para que un cliente curioso no llegue
// al panel ni por accidente.
//
// `comprobante.html` NO esta aqui: es la misma pagina con la que el comprador
// imprime su boleta, y no puede pedirle usuario. Lo que la protege no es la
// pagina sino los datos: sin `?id=` y sesion, o sin el par codigo + telefono,
// no se pinta nada. El armazon vacio no revela nada de nadie.
const PAGINAS_PRIVADAS = new Set(['/admin.html', '/imagenes.html']);

// Atajos para que el personal llegue al panel sin escribir el .html. La tienda
// no enlaza a ninguno: quien no sabe que existen, no entra por curiosidad.
const ATAJOS = { '/panel': '/admin.html', '/entrar': '/login.html' };

// Las páginas públicas con dirección limpia. Se sirven tal cual, sin redirigir:
// /tienda es la que se imprime en el QR del puesto y la que se dicta por
// teléfono, y tiene que quedarse así en la barra del navegador.
const PAGINAS_LIMPIAS = { '/': '/index.html', '/tienda': '/tienda.html' };

async function estatico(req, res, pathname) {
  if (ATAJOS[pathname]) {
    res.writeHead(302, { Location: ATAJOS[pathname] });
    return res.end();
  }
  if (PAGINAS_PRIVADAS.has(pathname) && !sesionDe_(req)) {
    res.writeHead(302, { Location: '/login.html?volver=' + encodeURIComponent(pathname) });
    return res.end();
  }
  const rel = PAGINAS_LIMPIAS[pathname] || pathname;
  const destino = normalize(join(PUBLIC, rel));
  if (!destino.startsWith(PUBLIC)) {
    res.writeHead(403).end('Prohibido');
    return;
  }
  try {
    const ext = extname(destino).toLowerCase();
    let contenido = await readFile(destino);

    if (CON_PLANTILLA.has(ext)) {
      contenido = Buffer.from(
        contenido.toString('utf8').replaceAll('{{SITIO}}', TIENDA.sitio), 'utf8');
    }

    enviar(res, 200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // Los estaticos con hash de contenido podrian cachearse; sin build no hay
      // hash, asi que se revalidan siempre. Anotado como mejora en el README.
      'Cache-Control': 'no-cache',
    }, contenido);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
      <title>Página no encontrada — Raíz Andina</title>
      <link rel="icon" type="image/png" sizes="16x16" href="/img/marca/favicon-16.png">
      <link rel="icon" type="image/png" sizes="32x32" href="/img/marca/favicon-32.png">
      <link rel="icon" type="image/png" sizes="64x64" href="/img/marca/favicon.png">
      <link rel="stylesheet" href="/css/panel.css"></head>
      <body style="display:grid;place-items:center;min-height:100vh;text-align:center">
        <div>
          <img src="/img/marca/emblema.png" alt="Raíz Andina" width="56" height="56"
               style="margin:0 auto 22px">
          <h1 style="font-size:52px;letter-spacing:-.04em">404</h1>
          <p style="color:var(--crema-suave);margin:12px 0 26px">
            Esta página no existe. Puede que el enlace esté viejo.</p>
          <a class="btn btn-primario" href="/tienda">Ir a la tienda</a>
        </div>
      </body></html>`);
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  cabecerasSeguras(res);
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await estatico(req, res, url.pathname);
  } catch (e) {
    if (!res.headersSent) json(res, 400, { error: e.message });
  }
}).listen(PORT, HOST, function () {
  // Con PORT=0 el sistema asigna uno libre; se informa el real para que los
  // tests puedan levantar varios servidores a la vez sin chocar de puerto.
  const puerto = this.address().port;
  const inicial = asegurarUsuarioInicial();
  console.log('ESCUCHANDO ' + puerto);
  console.log('\n  Raiz Andina  ->  http://localhost:' + puerto);
  console.log('  Panel admin  ->  http://localhost:' + puerto + '/admin.html');

  /**
   * La direccion de la red local, para abrirlo en el telefono.
   *
   * Escuchar en todas las interfaces no sirve de nada si hay que ir a buscar
   * la IP a la configuracion de Windows cada vez. Se imprime la que de verdad
   * se usa: IPv4, sin la interna del sistema ni las virtuales.
   */
  if (HOST === '::' || HOST === '0.0.0.0') {
    const enRed = Object.values(networkInterfaces()).flat()
      .filter((d) => d && d.family === 'IPv4' && !d.internal)
      .map((d) => d.address);
    for (const ip of enRed) {
      console.log('  En la red    ->  http://' + ip + ':' + puerto + '   (celular, misma Wi-Fi)');
    }
  }
  if (inicial) {
    console.log('\n  Acceso al panel creado:');
    console.log('    correo:      ' + inicial.email);
    console.log('    contrasena:  ' + inicial.clave);
    if (inicial.generada) {
      // Generada al azar: no hay otra copia en ningún lado, solo el hash.
      console.log('\n  ATENCION: esta contrasena se genero al azar y NO se vuelve a mostrar.');
      console.log('  Anotala ahora. Para poner una propia, define ADMIN_PASSWORD en .env');
      console.log('  antes del primer arranque, o cambiala cuando quieras con:');
      console.log('    node clave.mjs ' + inicial.email + ' <nueva-clave>');
    }
  }

  // El respaldo del dia, en cuanto se enciende la laptop. No se programa a una
  // hora porque el puesto apaga la maquina al cerrar y una tarea de madrugada
  // nunca correria. Los tests apuntan RESPALDO_DIR a su carpeta desechable, de
  // modo que esto tambien se prueba en vez de apagarse.
  programarRespaldo();

  console.log('');
});
