import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { rutaIlustracion } from './ilustraciones.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// `DB_PATH` permite apuntar a otra base: los tests usan una desechable en vez
// de ensuciar la de la demo, y en produccion deja mover el archivo de sitio.
const RUTA_BD = process.env.DB_PATH || join(__dirname, 'data', 'tienda.db');
export const db = new DatabaseSync(RUTA_BD);

db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS productos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sku          TEXT UNIQUE NOT NULL,
  nombre       TEXT NOT NULL,
  categoria    TEXT NOT NULL,
  origen       TEXT NOT NULL,
  presentacion TEXT NOT NULL,
  descripcion  TEXT NOT NULL,
  uso_tradicional TEXT NOT NULL,
  -- Para que sirve, en una linea y en castellano llano. Es lo que lee el
  -- cliente y lo que el asesor cita cuando alguien describe un malestar.
  beneficios   TEXT NOT NULL DEFAULT '',
  etiquetas    TEXT NOT NULL DEFAULT '',
  precio       REAL NOT NULL CHECK (precio > 0),
  costo        REAL NOT NULL CHECK (costo >= 0),
  stock        INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  stock_min    INTEGER NOT NULL DEFAULT 5 CHECK (stock_min >= 0),
  emoji        TEXT NOT NULL DEFAULT '',
  -- Ruta o URL de la foto. Vacio => la tienda usa la ilustracion /img/<SKU>.svg.
  -- Aqui va la URL de la foto real del cliente cuando la entregue.
  imagen       TEXT NOT NULL DEFAULT '',
  activo       INTEGER NOT NULL DEFAULT 1,
  -- Relleno de demostracion. Los 400 productos con que arranca la tienda
  -- salen de gen-catalogo.mjs: son inventados, estan para que el catalogo
  -- se vea lleno y el asesor tenga con que trabajar. Marcarlos es lo que
  -- permite que nunca desplacen a un producto de verdad en una recomendacion.
  -- Lo del negocio -- los curados, y todo lo que se da de alta en el panel --
  -- entra con 0 y manda. Cuando el cliente cargue su catalogo no habra
  -- ninguno marcado y el criterio se apaga solo.
  demo         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pedidos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo         TEXT UNIQUE NOT NULL,
  cliente_nombre TEXT NOT NULL,
  cliente_tel    TEXT NOT NULL,
  cliente_dir    TEXT NOT NULL,
  nota           TEXT NOT NULL DEFAULT '',
  total          REAL NOT NULL CHECK (total >= 0),
  estado         TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','preparando','enviado','entregado','anulado','devuelto')),
  canal          TEXT NOT NULL DEFAULT 'web',
  creado_en      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS pedido_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id   INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  nombre      TEXT NOT NULL,
  cantidad    INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unit REAL NOT NULL CHECK (precio_unit >= 0),
  subtotal    REAL NOT NULL CHECK (subtotal >= 0)
);

CREATE TABLE IF NOT EXISTS movimientos_stock (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  tipo        TEXT NOT NULL,
  cantidad    INTEGER NOT NULL,
  stock_final INTEGER NOT NULL,
  motivo      TEXT NOT NULL DEFAULT '',
  creado_en   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS usuarios (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario   TEXT UNIQUE NOT NULL,
  email     TEXT NOT NULL DEFAULT '',
  nombre    TEXT NOT NULL,
  hash      TEXT NOT NULL,
  salt      TEXT NOT NULL,
  rol       TEXT NOT NULL DEFAULT 'admin',
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sesiones (
  token      TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ip         TEXT NOT NULL DEFAULT '',
  creado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expira_en  TEXT NOT NULL
);

-- Bitacora de cambios de ficha (precio, minimo, alta/baja).
-- Un precio que baja sin responsable es el mismo agujero que un ajuste de
-- stock sin responsable: el dueño necesita saber quien y cuando.
CREATE TABLE IF NOT EXISTS cambios_producto (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  campo       TEXT NOT NULL,
  antes       TEXT NOT NULL,
  despues     TEXT NOT NULL,
  usuario     TEXT NOT NULL,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Comprobantes electronicos: boletas, facturas y notas de credito.
-- El indice unico sobre (serie, correlativo) es lo que garantiza que no haya
-- dos comprobantes con el mismo numero. Un correlativo repetido es de las
-- pocas cosas que SUNAT no deja arreglar sin tramite.
CREATE TABLE IF NOT EXISTS comprobantes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  serie             TEXT NOT NULL,
  correlativo       INTEGER NOT NULL CHECK (correlativo > 0),
  tipo_doc          TEXT NOT NULL CHECK (tipo_doc IN ('01','03','07','08')),
  pedido_id         INTEGER REFERENCES pedidos(id),
  fecha_emision     TEXT NOT NULL,
  cliente_tipo_doc  TEXT NOT NULL,
  cliente_num_doc   TEXT NOT NULL,
  cliente_nombre    TEXT NOT NULL,
  cliente_direccion TEXT NOT NULL DEFAULT '',
  moneda            TEXT NOT NULL DEFAULT 'PEN',
  gravadas          REAL NOT NULL CHECK (gravadas >= 0),
  igv               REAL NOT NULL CHECK (igv >= 0),
  total             REAL NOT NULL CHECK (total >= 0),
  -- pendiente_envio: emitido y numerado, todavia sin firmar ni enviar.
  estado            TEXT NOT NULL DEFAULT 'pendiente_envio'
    CHECK (estado IN ('pendiente_envio','enviado','aceptado','rechazado','anulado')),
  motivo_nc         TEXT NOT NULL DEFAULT '',
  ref_serie         TEXT NOT NULL DEFAULT '',
  ref_correlativo   INTEGER NOT NULL DEFAULT 0,
  ref_tipo_doc      TEXT NOT NULL DEFAULT '',
  xml               TEXT NOT NULL DEFAULT '',
  cdr               TEXT NOT NULL DEFAULT '',
  creado_en         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS comprobante_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  comprobante_id INTEGER NOT NULL REFERENCES comprobantes(id) ON DELETE CASCADE,
  orden          INTEGER NOT NULL,
  codigo         TEXT NOT NULL DEFAULT '',
  descripcion    TEXT NOT NULL,
  unidad         TEXT NOT NULL DEFAULT 'NIU',
  cantidad       REAL NOT NULL CHECK (cantidad > 0),
  valor_unitario REAL NOT NULL CHECK (valor_unitario >= 0),
  precio_unitario REAL NOT NULL CHECK (precio_unitario >= 0),
  valor_venta    REAL NOT NULL CHECK (valor_venta >= 0),
  igv            REAL NOT NULL CHECK (igv >= 0),
  importe        REAL NOT NULL CHECK (importe >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comprobante_numero
  ON comprobantes(serie, correlativo);
CREATE INDEX IF NOT EXISTS idx_comprobante_pedido ON comprobantes(pedido_id);
CREATE INDEX IF NOT EXISTS idx_comprobante_items ON comprobante_items(comprobante_id);

CREATE INDEX IF NOT EXISTS idx_items_pedido ON pedido_items(pedido_id);
CREATE INDEX IF NOT EXISTS idx_cambios_prod ON cambios_producto(producto_id);
CREATE INDEX IF NOT EXISTS idx_mov_producto ON movimientos_stock(producto_id);
CREATE INDEX IF NOT EXISTS idx_sesion_expira ON sesiones(expira_en);
`);

// Migraciones. `CREATE TABLE IF NOT EXISTS` no toca una tabla que ya existe,
// asi que las columnas nuevas se agregan aparte. Es idempotente: se puede
// correr sobre una base vieja sin perder los pedidos ya registrados.
const columnas = db.prepare('PRAGMA table_info(productos)').all().map((c) => c.name);
if (!columnas.includes('imagen')) {
  db.exec("ALTER TABLE productos ADD COLUMN imagen TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE productos SET imagen = '/img/' || sku || '.svg' WHERE imagen = ''");
  console.log('[db] columna `imagen` agregada a productos');
}
if (!columnas.includes('demo')) {
  db.exec('ALTER TABLE productos ADD COLUMN demo INTEGER NOT NULL DEFAULT 0');
  // Los generados son los unicos que usan las ilustraciones de /img/gen/,
  // que es lo que devuelve `rutaIlustracion`. Los curados llevan foto propia
  // o la ilustracion por SKU, asi que el filtro no los toca.
  db.exec("UPDATE productos SET demo = 1 WHERE imagen LIKE '/img/gen/%'");
  console.log('[db] columna `demo` agregada a productos');
}
if (!columnas.includes('beneficios')) {
  db.exec("ALTER TABLE productos ADD COLUMN beneficios TEXT NOT NULL DEFAULT ''");
  // Relleno de arranque: la primera frase de la descripcion es lo mas parecido
  // a un beneficio que hay en las filas viejas. Se corrige desde el panel.
  db.exec(`UPDATE productos SET beneficios =
    rtrim(substr(descripcion, 1, instr(descripcion || '.', '.') - 1))
    WHERE beneficios = ''`);
  console.log('[db] columna `beneficios` agregada a productos');
}

// Checkout peruano: documento, comprobante y ubigeo. Antes solo se guardaba
// una direccion de texto libre, con lo que no se podia emitir comprobante ni
// cotizar el envio de verdad.
const colPedidos = db.prepare('PRAGMA table_info(pedidos)').all().map((c) => c.name);
const NUEVAS_PEDIDO = [
  ['cliente_email', "TEXT NOT NULL DEFAULT ''"],
  ['tipo_doc', "TEXT NOT NULL DEFAULT 'DNI'"],
  ['num_doc', "TEXT NOT NULL DEFAULT ''"],
  ['razon_social', "TEXT NOT NULL DEFAULT ''"],
  ['tipo_comprobante', "TEXT NOT NULL DEFAULT 'boleta'"],
  ['departamento', "TEXT NOT NULL DEFAULT ''"],
  ['provincia', "TEXT NOT NULL DEFAULT ''"],
  ['distrito', "TEXT NOT NULL DEFAULT ''"],
  ['ubigeo', "TEXT NOT NULL DEFAULT ''"],
  ['referencia', "TEXT NOT NULL DEFAULT ''"],
  ['costo_envio', 'REAL NOT NULL DEFAULT 0'],
  // Constancia de recepcion: cuando el propio cliente confirma que recibio.
  // Es lo que cierra la cobranza contra entrega sin depender de la palabra
  // del repartidor.
  ['recibido_en', "TEXT NOT NULL DEFAULT ''"],
  ['recibido_por', "TEXT NOT NULL DEFAULT ''"],
];
for (const [nombre, tipo] of NUEVAS_PEDIDO) {
  if (colPedidos.includes(nombre)) continue;
  db.exec(`ALTER TABLE pedidos ADD COLUMN ${nombre} ${tipo}`);
  console.log(`[db] columna \`${nombre}\` agregada a pedidos`);
}

// El acceso al panel pasa de usuario a correo. Se conserva la columna `usuario`
// porque sigue firmando el kardex y la bitacora: en un movimiento de stock es
// mas legible "rosa" que "rosa@raizandina.pe".
const colUsuarios = db.prepare('PRAGMA table_info(usuarios)').all().map((c) => c.name);
if (!colUsuarios.includes('email')) {
  db.exec("ALTER TABLE usuarios ADD COLUMN email TEXT NOT NULL DEFAULT ''");
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_usuario_email ON usuarios(email) WHERE email != \'\'');
  console.log('[db] columna `email` agregada a usuarios');
}

/**
 * SQLite no admite ALTER TABLE ADD CONSTRAINT: la unica forma de meter un CHECK
 * en una tabla que ya existe es reconstruirla. Se hace dentro de una
 * transaccion y comprobando el numero de filas antes y despues; si algo no
 * cuadra, se deshace y la base queda como estaba.
 *
 * Por que molestarse: hasta ahora "stock >= 0" y "estado valido" solo vivian en
 * el codigo. Un script suelto, una consulta a mano o un bug futuro podian dejar
 * la base en un estado imposible sin que nada se quejara.
 */
function asegurarRestricciones(tabla, definicion, columnas) {
  const fila = db.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?')
    .get('table', tabla);
  if (!fila || /CHECK/i.test(fila.sql)) return false;   // ya las tiene

  const antes = db.prepare(`SELECT COUNT(*) n FROM ${tabla}`).get().n;
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(definicion.replace(`CREATE TABLE IF NOT EXISTS ${tabla}`,
      `CREATE TABLE ${tabla}__nueva`));
    db.exec(`INSERT INTO ${tabla}__nueva (${columnas}) SELECT ${columnas} FROM ${tabla}`);
    const despues = db.prepare(`SELECT COUNT(*) n FROM ${tabla}__nueva`).get().n;
    if (despues !== antes) throw new Error(`se perdieron filas: ${antes} -> ${despues}`);
    db.exec(`DROP TABLE ${tabla}`);
    db.exec(`ALTER TABLE ${tabla}__nueva RENAME TO ${tabla}`);
    db.exec('COMMIT');
    console.log(`[db] restricciones CHECK aplicadas a ${tabla} (${antes} filas intactas)`);
    return true;
  } catch (e) {
    db.exec('ROLLBACK');
    console.warn(`[db] no se pudieron aplicar CHECK a ${tabla}: ${e.message}`);
    return false;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

const DEF_PRODUCTOS = `CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT UNIQUE NOT NULL, nombre TEXT NOT NULL,
  categoria TEXT NOT NULL, origen TEXT NOT NULL, presentacion TEXT NOT NULL,
  descripcion TEXT NOT NULL, uso_tradicional TEXT NOT NULL,
  beneficios TEXT NOT NULL DEFAULT '', etiquetas TEXT NOT NULL DEFAULT '',
  precio REAL NOT NULL CHECK (precio > 0), costo REAL NOT NULL CHECK (costo >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  stock_min INTEGER NOT NULL DEFAULT 5 CHECK (stock_min >= 0),
  emoji TEXT NOT NULL DEFAULT '', imagen TEXT NOT NULL DEFAULT '',
  activo INTEGER NOT NULL DEFAULT 1, demo INTEGER NOT NULL DEFAULT 0)`;

const DEF_PEDIDOS = `CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, codigo TEXT UNIQUE NOT NULL,
  cliente_nombre TEXT NOT NULL, cliente_tel TEXT NOT NULL, cliente_dir TEXT NOT NULL,
  nota TEXT NOT NULL DEFAULT '', total REAL NOT NULL CHECK (total >= 0),
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','preparando','enviado','entregado','anulado','devuelto')),
  canal TEXT NOT NULL DEFAULT 'web',
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime')))`;

asegurarRestricciones('productos', DEF_PRODUCTOS,
  'id,sku,nombre,categoria,origen,presentacion,descripcion,uso_tradicional,beneficios,etiquetas,precio,costo,stock,stock_min,emoji,imagen,activo,demo');
asegurarRestricciones('pedidos', DEF_PEDIDOS,
  'id,codigo,cliente_nombre,cliente_tel,cliente_dir,nota,total,estado,canal,creado_en');

// sku, nombre, categoria, origen, presentacion, descripcion, uso_tradicional,
// etiquetas, precio, costo, stock, stock_min, emoji
const SEED = [
  ['MAC-001', 'Maca Negra en polvo', 'Superalimentos', 'Meseta de Bombon, Junin', 'Bolsa 250 g',
    'Raiz andina cultivada sobre los 4000 m s.n.m., secada al sol y molida en piedra.',
    'Los pastores de Junin la consumian antes de las jornadas largas de altura.',
    'energia,fatiga,cansancio,animo,resistencia,fertilidad,hombre', 29.90, 16.00, 42, 10, '🌰'],
  ['MAC-002', 'Maca Gelatinizada', 'Superalimentos', 'Junin', 'Frasco 200 g',
    'Maca precocida: se digiere mas facil que la cruda, ideal para estomagos sensibles.',
    'Preparacion tradicional hervida antes de moler, para quitarle la pesadez.',
    'energia,digestion,fatiga,estomago', 34.50, 19.00, 18, 8, '🥣'],
  ['UNG-001', 'Una de Gato', 'Suplementos', 'Tarapoto, San Martin', '60 capsulas 500 mg',
    'Corteza amazonica recolectada bajo manejo sostenible, sin talar el arbol.',
    'Los ashaninka la usaban en cocimiento para dolores de articulaciones.',
    'articulaciones,dolor,rodilla,inflamacion,defensas,artritis,huesos', 24.00, 13.00, 7, 10, '🐾'],
  ['SAN-001', 'Sangre de Grado', 'Aceites y esencias', 'Pucallpa, Ucayali', 'Frasco 30 ml',
    'Latex rojo del arbol Croton lechleri, recolectado por sangrado controlado.',
    'Se aplicaba directo sobre heridas y llagas para cerrarlas rapido.',
    'heridas,cicatrizar,piel,ulcera,gastritis,llagas,boca', 18.00, 9.50, 25, 8, '🩸'],
  ['CHA-001', 'Chanca Piedra', 'Infusiones', 'Amazonia peruana', 'Bolsa 100 g hierba seca',
    'Planta entera secada a la sombra para conservar sus principios activos.',
    'Nombrada asi porque se usaba para romper calculos renales y biliares.',
    'rinones,calculos,vias urinarias,higado,orina,vesicula', 12.50, 6.00, 31, 10, '🪨'],
  ['CAM-001', 'Camu Camu en polvo', 'Superalimentos', 'Rio Ucayali, Loreto', 'Bolsa 150 g',
    'El fruto con mas vitamina C del mundo, liofilizado para no perder potencia.',
    'Fruto ribereno que se comia maduro directo del arbol en creciente.',
    'defensas,vitamina c,resfrio,gripe,inmunidad,antioxidante', 27.00, 15.00, 22, 10, '🍒'],
  ['HER-001', 'Hercampuri', 'Infusiones', 'Sierra central', 'Bolsa 80 g hierba seca',
    'Hierba amarga de altura, cosechada en floracion.',
    'Se tomaba en ayunas para limpiar la sangre y bajar la grasa.',
    'colesterol,higado,grasa,adelgazar,peso,depurativo', 10.00, 4.50, 28, 10, '🌿'],
  ['MUN-001', 'Muna', 'Infusiones', 'Cusco', 'Bolsa 60 g hierba seca',
    'Menta andina de aroma intenso, secada al aire libre.',
    'Infusion clasica contra el soroche y el malestar estomacal en altura.',
    'digestion,estomago,gastritis,acidez,gases,soroche,altura,nauseas,colicos', 9.00, 4.00, 40, 12, '🍃'],
  ['MAN-001', 'Manzanilla Organica', 'Infusiones', 'Valle del Mantaro', 'Caja 25 filtrantes',
    'Flor entera, sin tallo, cultivo sin agroquimicos.',
    'La infusion de la abuela para el dolor de barriga y el sueno.',
    'dormir,insomnio,nervios,estomago,gastritis,acidez,colicos,ansiedad,relajante', 8.50, 3.80, 55, 15, '🌼'],
  ['VAL-001', 'Valeriana + Pasiflora', 'Suplementos', 'Sierra sur', '60 capsulas',
    'Combinacion estandarizada de raiz de valeriana y hoja de pasiflora.',
    'Cocimiento de raiz que se tomaba de noche para el mal dormir.',
    'dormir,insomnio,ansiedad,estres,nervios,relajante', 26.00, 14.00, 14, 8, '😴'],
  ['MIE-001', 'Miel de Abeja Multifloral', 'Apicolas', 'Oxapampa, Pasco', 'Frasco 500 g',
    'Miel cruda sin pasteurizar, filtrada en frio. Cristaliza: es senal de pureza.',
    'Endulzante y remedio de tos en toda la sierra y selva alta.',
    'tos,garganta,resfrio,gripe,energia,endulzante,ninos', 22.00, 12.00, 36, 12, '🍯'],
  ['PRO-001', 'Propoleo en gotas', 'Apicolas', 'Oxapampa, Pasco', 'Frasco 30 ml',
    'Extracto hidroalcoholico de propoleo puro al 20 por ciento.',
    'Se echaban unas gotas en agua tibia al primer sintoma de gripe.',
    'garganta,tos,defensas,gripe,infeccion,resfrio,boca', 19.50, 10.00, 4, 10, '🐝'],
  ['POL-001', 'Polen de Abeja', 'Apicolas', 'Canete, Lima', 'Frasco 200 g',
    'Granulos deshidratados a baja temperatura, conservan sus enzimas.',
    'Cucharada en ayunas para levantar a los convalecientes.',
    'energia,defensas,anemia,fatiga,nutricion,apetito', 21.00, 11.50, 19, 8, '🌸'],
  ['SAC-001', 'Sacha Inchi en capsulas', 'Suplementos', 'Lamas, San Martin', '90 capsulas 500 mg',
    'Aceite prensado en frio del mani del inca, alto en omega 3, 6 y 9.',
    'Semilla tostada que se comia como snack en las comunidades shawi.',
    'colesterol,corazon,omega,memoria,piel,trigliceridos', 32.00, 18.00, 16, 8, '🥜'],
  ['ACE-001', 'Aceite de Copaiba', 'Aceites y esencias', 'Iquitos, Loreto', 'Frasco 30 ml',
    'Oleo-resina extraida por puncion del tronco, sin cortar el arbol.',
    'Se frotaba en golpes, torceduras y dolores musculares.',
    'dolor,muscular,golpes,inflamacion,piel,acne,articulaciones', 26.50, 14.00, 11, 6, '🛢️'],
  ['ACE-002', 'Aceite de Rosa Mosqueta', 'Cuidado personal', 'Cusco', 'Frasco 30 ml',
    'Prensado en frio de la semilla, sin refinar. Color ambar natural.',
    'Se aplicaba en cicatrices y quemaduras para suavizar la piel.',
    'piel,cicatrices,manchas,arrugas,estrias,rostro', 28.00, 15.00, 20, 8, '🌹'],
  ['JAB-001', 'Jabon de Aguaje y Avena', 'Cuidado personal', 'Loreto', 'Barra 100 g',
    'Saponificado en frio, con pulpa de aguaje y avena molida.',
    'La pulpa de aguaje se usaba para refrescar y suavizar la piel.',
    'piel,acne,exfoliante,rostro,cuerpo,seca', 12.00, 5.50, 33, 10, '🧼'],
  ['YAC-001', 'Jarabe de Yacon', 'Superalimentos', 'Cajamarca', 'Frasco 260 g',
    'Endulzante natural de bajo indice glucemico, evaporado a fuego lento.',
    'Raiz dulce que se comia cruda en la chacra, refrescante.',
    'diabetes,azucar,endulzante,digestion,peso,estrenimiento', 24.50, 13.00, 13, 6, '🍶'],
  ['QUI-001', 'Quinua Perlada Organica', 'Superalimentos', 'Puno', 'Bolsa 1 kg',
    'Grano lavado y seleccionado, libre de saponina, listo para cocinar.',
    'Grano madre del altiplano, base de la alimentacion aymara.',
    'proteina,nutricion,ninos,anemia,celiaco,sin gluten', 16.00, 9.00, 48, 15, '🌾'],
  ['KIW-001', 'Kiwicha Pop', 'Superalimentos', 'Ancash', 'Bolsa 200 g',
    'Grano expandido con aire caliente, sin aceite ni azucar anadida.',
    'Se mezclaba con miel para hacer las turronitas de las ferias.',
    'ninos,calcio,huesos,desayuno,energia,anemia', 9.50, 4.20, 29, 10, '✨'],
  ['BOL-001', 'Boldo', 'Infusiones', 'Sierra norte', 'Bolsa 60 g hoja seca',
    'Hoja entera secada a la sombra, aroma alcanforado caracteristico.',
    'Infusion despues de la comida pesada.',
    'higado,digestion,vesicula,bilis,estomago,resaca', 9.00, 4.00, 26, 10, '🍂'],
  ['COL-001', 'Cola de Caballo', 'Infusiones', 'Sierra central', 'Bolsa 80 g',
    'Tallos secos ricos en silice, cortados en trozo pequeno.',
    'Agua de tiempo para botar liquidos e hinchazon de piernas.',
    'rinones,retencion,hinchazon,orina,unas,cabello,piernas', 9.50, 4.00, 24, 10, '🐴'],
  ['NON-001', 'Jugo de Noni', 'Suplementos', 'Selva central', 'Botella 500 ml',
    'Fermentado tradicional de fruta madura, sin azucar anadida.',
    'Se tomaba en ayunas como reconstituyente general.',
    'defensas,energia,digestion,dolor,presion,antioxidante', 29.00, 16.50, 9, 6, '🥤'],
  ['GRA-001', 'Graviola en capsulas', 'Suplementos', 'Amazonia', '60 capsulas',
    'Hoja de guanabana secada y micronizada, sin excipientes.',
    'Infusion de hoja que se tomaba de noche, tranquilizante.',
    'defensas,dormir,presion,antioxidante,relajante', 23.00, 12.50, 15, 8, '🍈'],
];

/**
 * Beneficio de cada producto curado, en una linea. Los 24 de arriba se
 * escribieron antes de que existiera la columna; ponerlo aqui evita reordenar
 * las 24 filas y deja el texto donde se lee de un vistazo.
 */
const BENEFICIOS = {
  'MAC-001': 'Energia sostenida y resistencia fisica',
  'MAC-002': 'Energia sin pesadez para estomagos sensibles',
  'UNG-001': 'Articulaciones y defensas',
  'SAN-001': 'Cicatriza heridas y calma la gastritis',
  'CHA-001': 'Rinones y vias urinarias',
  'CAM-001': 'Defensas y vitamina C natural',
  'HER-001': 'Colesterol y limpieza del higado',
  'GRA-001': 'Defensas y descanso',
  'MUN-001': 'Digestion, acidez y soroche',
  'MAN-001': 'Calma los nervios y ayuda a dormir',
  'VAL-001': 'Insomnio y ansiedad',
  'MIE-001': 'Tos, garganta y energia',
  'PRO-001': 'Garganta y defensas al primer sintoma',
  'POL-001': 'Energia, anemia y apetito',
  'SAC-001': 'Colesterol y corazon',
  'ACE-001': 'Golpes, dolor muscular e inflamacion',
  'ACE-002': 'Cicatrices, manchas y arrugas',
  'JAB-001': 'Piel grasa y acne',
  'YAC-001': 'Endulzante apto para diabeticos',
  'QUI-001': 'Proteina completa, sin gluten',
  'KIW-001': 'Calcio y energia para los ninos',
  'BOL-001': 'Higado y digestion pesada',
  'COL-001': 'Retencion de liquidos e hinchazon',
  'NON-001': 'Defensas y energia general',
};

/**
 * Las categorias del catalogo curado son mas viejas que las del generado. Se
 * unifican para que el filtro de la tienda no muestre "Infusiones" y "Hierbas"
 * como si fueran cosas distintas.
 */
const CATEGORIA_UNIFICADA = {
  Infusiones: 'Hierbas',
  'Aceites y esencias': 'Aceites',
  Apicolas: 'Apícolas',
};

// Con cuantos productos arranca la tienda. El generador reparte las
// presentaciones vuelta por vuelta, asi que cortar al llegar al tope no deja
// una categoria fuera: recorta el final de todas por igual.
const TOTAL_TIENDA = 400;

/** El catalogo grande generado por `gen-catalogo.mjs`, si ya se genero. */
function catalogoGenerado() {
  try {
    return JSON.parse(readFileSync(join(__dirname, 'data', 'catalogo.json'), 'utf8'));
  } catch {
    return [];   // la demo funciona igual con los 24 curados
  }
}

export function resetSeed() {
  // El orden importa: primero lo que apunta a productos, después productos.
  // Con la bitácora de cambios poblada, borrar productos primero rompía por
  // clave foránea y el reset dejaba de funcionar.
  db.exec(`
    DELETE FROM comprobante_items;
    DELETE FROM comprobantes;
    DELETE FROM cambios_producto;
    DELETE FROM movimientos_stock;
    DELETE FROM pedido_items;
    DELETE FROM pedidos;
    DELETE FROM productos;
    DELETE FROM sqlite_sequence WHERE name IN
      ('productos','pedidos','pedido_items','movimientos_stock','cambios_producto',
       'comprobantes','comprobante_items');
  `);
  const ins = db.prepare(`INSERT INTO productos
    (sku,nombre,categoria,origen,presentacion,descripcion,uso_tradicional,
     beneficios,etiquetas,precio,costo,stock,stock_min,emoji,imagen,demo)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  // Cada producto usa su fotografia si `traer-fotos.mjs` ya la bajo; si no,
  // la ilustracion derivada del SKU. Asi reiniciar la demo no borra las fotos.
  let fotos = {};
  try {
    fotos = JSON.parse(readFileSync(
      join(__dirname, 'public', 'img', 'fotos', 'creditos.json'), 'utf8'));
  } catch { /* todavia no se han descargado */ }

  const skusUsados = new Set();
  const nombresUsados = new Set();
  let n = 0;

  // Primero los curados: son los que tienen foto real y el texto mas cuidado,
  // asi que se quedan con los primeros ids y encabezan la tienda.
  for (const p of SEED) {
    const [sku, nombre, categoria, origen, presentacion, descripcion, uso,
      etiquetas, precio, costo, stock, stockMin, emoji] = p;
    const imagen = fotos[sku]?.archivo
      ? `/img/fotos/${fotos[sku].archivo}`
      : `/img/${sku}.svg`;
    ins.run(sku, nombre, CATEGORIA_UNIFICADA[categoria] || categoria, origen,
      presentacion, descripcion, uso, BENEFICIOS[sku] || '', etiquetas,
      precio, costo, stock, stockMin, emoji, imagen, 0);
    skusUsados.add(sku);
    nombresUsados.add(nombre.toLowerCase());
    n++;
  }

  // Despues el catalogo generado. Los SKU se numeran por sigla de categoria y
  // pueden chocar con los curados (ACE-001, COL-001): se corren hasta el
  // primero libre en vez de reventar la restriccion UNIQUE.
  for (const p of catalogoGenerado()) {
    if (n >= TOTAL_TIENDA) break;
    if (nombresUsados.has(p.nombre.toLowerCase())) continue;
    let sku = p.sku;
    if (skusUsados.has(sku)) {
      const [sigla] = sku.split('-');
      let i = 1;
      do { sku = `${sigla}-${String(i++).padStart(3, '0')}`; } while (skusUsados.has(sku));
    }
    ins.run(sku, p.nombre, p.categoria, p.origen, p.presentacion, p.descripcion,
      p.uso_tradicional, p.beneficios, p.etiquetas, p.precio, p.costo,
      p.stock, p.stock_min, p.emoji || '',
      rutaIlustracion(p.presentacion, p.categoria), 1);
    skusUsados.add(sku);
    nombresUsados.add(p.nombre.toLowerCase());
    n++;
  }
  return n;
}

/**
 * Vacia el catalogo dejando el resto de la base en pie.
 *
 * Es el paso previo a cargar el catalogo real del cliente, y hace falta por una
 * razon que no se ve venir: **el nombre de un producto es unico**, asi que los
 * 376 de relleno OCUPAN los nombres de verdad. Si el dueño vende «Maca Negra en
 * polvo» y la demo ya la tiene, su producto real se rechaza — y darla de baja no
 * libera el nombre, porque la baja no borra la fila.
 *
 * Un producto con ventas no se borra: esta referenciado por el pedido y
 * borrarlo dejaria una venta sin producto. Ese se da de baja, que lo saca de la
 * tienda y del asesor pero conserva el historial. Devuelve cuantos de cada.
 */
export function vaciarCatalogo() {
  let borrados = 0;
  let dados_de_baja = 0;

  for (const p of db.prepare('SELECT id FROM productos').all()) {
    try {
      db.exec('BEGIN IMMEDIATE');
      db.prepare('DELETE FROM cambios_producto WHERE producto_id = ?').run(p.id);
      db.prepare('DELETE FROM movimientos_stock WHERE producto_id = ?').run(p.id);
      db.prepare('DELETE FROM productos WHERE id = ?').run(p.id);
      db.exec('COMMIT');
      borrados++;
    } catch {
      // Lo retiene un pedido: se conserva de baja y con el nombre marcado, para
      // que el nombre real quede libre.
      db.exec('ROLLBACK');
      db.prepare(`UPDATE productos SET activo = 0,
        nombre = nombre || ' (retirado)' WHERE id = ?`).run(p.id);
      dados_de_baja++;
    }
  }
  return { borrados, dados_de_baja };
}

if (process.argv.includes('--vacio')) {
  const r = vaciarCatalogo();
  console.log(`Catalogo vaciado: ${r.borrados} borrados`
    + (r.dados_de_baja ? `, ${r.dados_de_baja} conservados de baja por tener ventas` : '')
    + '.');
  console.log('Ahora carga el real:  node importar-catalogo.mjs lista.csv');
} else if (process.argv.includes('--reset')) {
  const n = resetSeed();
  console.log('Base de datos reiniciada con ' + n + ' productos.');
}
