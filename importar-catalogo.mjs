#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { leerCsv, aNumero } from './csv.js';
import { respaldar } from './respaldo.js';

/**
 * Carga el catalogo real desde un CSV.
 *
 *   node importar-catalogo.mjs lista.csv --probar    ver que pasaria
 *   node importar-catalogo.mjs lista.csv             cargarlo
 *   node importar-catalogo.mjs --bajar-demo          dar de baja el relleno
 *
 * Con el panel se da de alta uno por uno; 190 productos asi son tres dias.
 *
 * **Por que va por HTTP y no escribe en la base.** Las reglas de un producto
 * —nombre unico, precio mayor que cero, no vender por debajo del costo, SKU
 * automatico por categoria, etiquetas normalizadas para el asesor— ya viven en
 * `validarAlta()` dentro del servidor. Un importador que escribiera en SQLite
 * directamente tendria que repetirlas, y el dia que una cambie quedarian dos
 * catalogos con reglas distintas segun por donde entraron. Entrando por
 * `POST /api/productos` se usa la misma puerta que el panel: lo que el panel
 * rechaza, esto lo rechaza, y sin escribir la regla dos veces.
 *
 * El precio es que hace falta el servidor encendido. Vale la pena.
 */

const args = process.argv.slice(2);
const probar = args.includes('--probar');
const soloBajarDemo = args.includes('--bajar-demo');
const archivo = args.find((a) => !a.startsWith('--'));

const BASE = process.env.URL_TIENDA || 'http://localhost:3000';
const CORREO = process.env.ADMIN_EMAIL || 'hola@raizandina.pe';
const CLAVE = process.env.ADMIN_PASSWORD || 'raiz2026';

/** Columnas que tienen que venir en el CSV. El resto son opcionales. */
const OBLIGATORIAS = ['nombre', 'categoria', 'presentacion', 'precio'];

const CONOCIDAS = [
  'nombre', 'categoria', 'presentacion', 'precio', 'costo', 'stock', 'stockmin',
  'origen', 'beneficios', 'usotradicional', 'etiquetas', 'sku', 'descripcion', 'imagen',
];

function salir(mensaje, codigo = 1) {
  console.error(`\n  ${mensaje}\n`);
  process.exit(codigo);
}

// ------------------------------------------------------------------ sesion
let galleta = '';

async function pedir(ruta, opciones = {}) {
  const r = await fetch(BASE + ruta, {
    ...opciones,
    headers: {
      'Content-Type': 'application/json',
      ...(galleta ? { Cookie: galleta } : {}),
      ...opciones.headers,
    },
  });
  const guardar = r.headers.getSetCookie?.() || [];
  if (guardar.length) galleta = guardar.map((c) => c.split(';')[0]).join('; ');
  const cuerpo = await r.text();
  let json = null;
  try { json = cuerpo ? JSON.parse(cuerpo) : null; } catch { /* no era JSON */ }
  return { estado: r.status, json, texto: cuerpo };
}

async function entrar() {
  let r;
  try {
    r = await pedir('/api/login', {
      method: 'POST',
      body: JSON.stringify({ correo: CORREO, clave: CLAVE }),
    });
  } catch {
    salir(`No responde ${BASE}. Levanta el servidor con \`npm start\` y vuelve a intentar.`);
  }
  if (r.estado !== 200) {
    salir('No pude entrar al panel. Revisa ADMIN_EMAIL y ADMIN_PASSWORD, '
      + `o cambia la clave con \`node clave.mjs ${CORREO} <clave>\`.`);
  }
}

// --------------------------------------------------------------- dar de baja
/**
 * Los 376 productos de relleno se dan de **baja**, no se borran: uno que ya
 * tuvo una venta esta referenciado por el pedido y borrarlo dejaria una venta
 * sin producto. De baja desaparece de la tienda y del asesor, y el panel lo
 * sigue viendo con «ver bajas» por si hay que recuperarlo.
 */
async function bajarDemo() {
  const { json: productos } = await pedir('/api/admin/productos');
  const demo = (productos || []).filter((p) => p.demo === 1 && p.activo === 1);

  if (!demo.length) {
    console.log('\n  No hay productos de relleno activos. Nada que hacer.\n');
    return 0;
  }
  if (probar) {
    console.log(`\n  Se darian de baja ${demo.length} productos de relleno.`);
    console.log('  Los que tengan ventas se conservan como historial, solo dejan');
    console.log('  de verse en la tienda.\n');
    return 0;
  }

  let hechos = 0;
  for (const p of demo) {
    const r = await pedir(`/api/productos/${p.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ activo: 0 }),
    });
    if (r.estado === 200) hechos++;
    else console.error(`  no pude dar de baja ${p.sku}: ${r.json?.error || r.estado}`);
  }
  console.log(`\n  ${hechos} de ${demo.length} productos de relleno dados de baja.\n`);
  return hechos;
}

// ------------------------------------------------------------------ importar
function preparar(fila) {
  const precio = aNumero(fila.precio);
  const costo = fila.costo === '' || fila.costo == null ? '' : aNumero(fila.costo);
  const stock = fila.stock === '' || fila.stock == null ? '' : aNumero(fila.stock);
  const stockMin = fila.stockmin === '' || fila.stockmin == null ? '' : aNumero(fila.stockmin);

  return {
    nombre: fila.nombre,
    categoria: fila.categoria,
    presentacion: fila.presentacion,
    precio,
    costo: costo === null ? '' : costo,
    stock: stock === null ? '' : Math.round(stock),
    stock_min: stockMin === null ? '' : Math.round(stockMin),
    origen: fila.origen || '',
    beneficios: fila.beneficios || '',
    uso_tradicional: fila.usotradicional || '',
    etiquetas: fila.etiquetas || '',
    descripcion: fila.descripcion || '',
    sku: fila.sku || '',
    imagen: fila.imagen || '',
  };
}

async function importar() {
  let texto;
  try {
    texto = readFileSync(archivo, 'utf8');
  } catch {
    salir(`No pude leer ${archivo}. Revisa la ruta.`);
  }

  const { columnas, filas, separador } = leerCsv(texto);
  if (!filas.length) salir('El archivo no tiene ninguna fila de datos.');

  const faltan = OBLIGATORIAS.filter((c) => !columnas.includes(c));
  if (faltan.length) {
    salir(`Al CSV le faltan columnas: ${faltan.join(', ')}.\n`
      + `  Tiene: ${columnas.join(', ')}\n`
      + '  Usa plantilla-catalogo.csv como modelo.');
  }

  const desconocidas = columnas.filter((c) => !CONOCIDAS.includes(c));
  const sep = separador === '\t' ? 'tabulación' : `«${separador}»`;
  console.log(`\n  ${filas.length} filas, separadas por ${sep}.`);
  if (desconocidas.length) {
    console.log(`  Columnas que no uso y voy a ignorar: ${desconocidas.join(', ')}`);
  }

  // Nombres repetidos dentro del propio archivo: el servidor rechazaria el
  // segundo con «ya tienes un producto con ese nombre», que es cierto pero
  // desorienta — el duplicado esta en el Excel, no en la base.
  const vistos = new Map();
  const repetidos = [];
  for (const f of filas) {
    const k = (f.nombre || '').toLowerCase().trim();
    if (!k) continue;
    if (vistos.has(k)) repetidos.push({ linea: f._linea, nombre: f.nombre, antes: vistos.get(k) });
    else vistos.set(k, f._linea);
  }
  for (const r of repetidos) {
    console.log(`  linea ${r.linea}: «${r.nombre}» ya estaba en la linea ${r.antes}`);
  }

  if (probar) console.log('\n  --probar: no se escribe nada.\n');
  else {
    // Antes de tocar el catalogo, una copia. Cargar una lista mal armada es
    // reversible si hay respaldo; si no, no.
    const r = respaldar();
    console.log(`\n  Respaldo previo: ${r.archivo}\n`);
  }

  const bien = [];
  const mal = [];

  for (const fila of filas) {
    const p = preparar(fila);

    if (probar) {
      // En seco no se llama al servidor: se revisa lo que se puede sin base
      // —numeros y campos vacios— y lo demas se dice que no se comprobo.
      const problema = !p.nombre ? 'sin nombre'
        : !p.categoria ? 'sin categoría'
          : !p.presentacion ? 'sin presentación'
            : p.precio === null ? `precio ilegible: «${fila.precio}»`
              : p.precio <= 0 ? 'precio cero o negativo'
                : p.costo !== '' && p.costo > p.precio ? 'el costo supera el precio'
                  : null;
      if (problema) mal.push({ linea: fila._linea, nombre: p.nombre || '(sin nombre)', problema });
      else bien.push({ linea: fila._linea, nombre: p.nombre, precio: p.precio });
      continue;
    }

    const r = await pedir('/api/productos', { method: 'POST', body: JSON.stringify(p) });
    if (r.estado === 200 || r.estado === 201) {
      bien.push({ linea: fila._linea, nombre: p.nombre, sku: r.json?.producto?.sku || r.json?.sku });
    } else {
      mal.push({
        linea: fila._linea,
        nombre: p.nombre || '(sin nombre)',
        problema: r.json?.error || `el servidor respondió ${r.estado}`,
        choqueDeNombre: /ese nombre/i.test(r.json?.error || ''),
      });
    }
  }

  console.log(`  ${probar ? 'Pasarían' : 'Cargados'}: ${bien.length}`);
  if (bien.length && bien.length <= 15) {
    for (const b of bien) console.log(`    · ${b.nombre}${b.sku ? `  ${b.sku}` : ''}`);
  }

  if (mal.length) {
    console.log(`\n  ${probar ? 'Fallarían' : 'Rechazados'}: ${mal.length}`);
    for (const m of mal) console.log(`    linea ${m.linea} · ${m.nombre}: ${m.problema}`);
    console.log('\n  Los rechazados no entraron. Corrige esas filas y vuelve a');
    console.log('  pasar el archivo: los que ya entraron se rechazan solos por');
    console.log('  nombre repetido, asi que no se duplican.');

    // El choque que desorienta: el nombre lo tiene ocupado un producto de
    // relleno, no uno del negocio. Sin decirlo, parece que el importador esta
    // roto — y la respuesta no es corregir el Excel, es vaciar el catalogo.
    if (mal.filter((m) => m.choqueDeNombre).length >= 2) {
      console.log('\n  Ojo: varios choques de nombre. Lo normal es que los tenga');
      console.log('  ocupados el catalogo de demostracion, no tu lista. Para');
      console.log('  cargar el catalogo real hay que vaciarlo primero:');
      console.log('      node db.js --vacio');
      console.log(`      node importar-catalogo.mjs ${archivo}`);
    }
    console.log('');
  } else {
    console.log('');
  }

  if (!probar && bien.length) {
    console.log('  Ahora las fotos:  node importar-fotos.mjs');

    // El aviso del relleno solo si queda relleno: tras `db.js --vacio` no hay,
    // y sugerir un paso que no hace falta es lo que hace que nadie lea estos
    // mensajes.
    const { json: todos } = await pedir('/api/admin/productos');
    const relleno = (todos || []).filter((p) => p.demo === 1 && p.activo === 1).length;
    if (relleno) {
      console.log(`\n  Quedan ${relleno} productos de demostracion activos.`);
      console.log('  Para sacarlos de la tienda:');
      console.log('      node importar-catalogo.mjs --bajar-demo');
    }
    console.log('');
  }

  return mal.length ? 1 : 0;
}

// ---------------------------------------------------------------------- main
if (!archivo && !soloBajarDemo) {
  console.log(`
  Carga el catalogo real desde un CSV.

    node importar-catalogo.mjs lista.csv --probar   ver que pasaria, sin escribir
    node importar-catalogo.mjs lista.csv            cargarlo
    node importar-catalogo.mjs --bajar-demo         dar de baja los de relleno

  El servidor tiene que estar encendido (npm start).
  Modelo de archivo: plantilla-catalogo.csv
`);
  process.exit(0);
}

await entrar();
process.exit(soloBajarDemo ? await bajarDemo() : await importar());
