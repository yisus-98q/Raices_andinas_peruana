#!/usr/bin/env node
import {
  respaldar, listar, restaurar, ultimo, DIR, DIAS_QUE_SE_GUARDAN,
} from './respaldo.js';

/**
 * Respaldo desde la consola.
 *
 *   node respaldo.mjs                       copia la base ahora
 *   node respaldo.mjs --listar              que respaldos hay
 *   node respaldo.mjs --restaurar <archivo> vuelve a uno (servidor parado)
 *
 * El panel tiene el mismo boton, pero esto funciona aunque el servidor no
 * arranque — que es justo cuando hace falta restaurar.
 */

const kb = (b) => `${(b / 1024).toFixed(0)} KB`;
const args = process.argv.slice(2);

if (args.includes('--listar')) {
  const r = listar();
  console.log(`\n  Carpeta: ${DIR}`);
  console.log(`  Se guardan los ultimos ${DIAS_QUE_SE_GUARDAN}\n`);
  if (!r.length) {
    console.log('  Todavia no hay ningun respaldo.\n');
  } else {
    for (const x of r) console.log(`  ${x.fecha}   ${kb(x.bytes).padStart(8)}   ${x.archivo}`);
    console.log(`\n  ${r.length} respaldo(s).\n`);
  }
  process.exit(0);
}

const i = args.indexOf('--restaurar');
if (i !== -1) {
  const archivo = args[i + 1];
  if (!archivo) {
    console.error('\n  Falta el archivo. Mira cuales hay con:  node respaldo.mjs --listar\n');
    process.exit(1);
  }
  try {
    const r = restaurar(archivo);
    console.log(`\n  Base restaurada desde ${r.restaurado}.`);
    console.log(`  La anterior quedo guardada como ${r.red}, por si acaso.`);
    console.log('\n  IMPORTANTE: esto se hace con el servidor PARADO. Si estaba');
    console.log('  corriendo, cierralo y vuelve a arrancarlo ahora.\n');
    process.exit(0);
  } catch (e) {
    console.error(`\n  No se pudo restaurar: ${e.message}\n`);
    process.exit(1);
  }
}

try {
  const r = respaldar();
  const previo = listar()[1];
  console.log(`\n  Respaldo hecho: ${r.archivo}  (${kb(r.bytes)})`);
  console.log(`  En: ${r.ruta}`);
  if (r.rotados.length) console.log(`  Rotados por antiguedad: ${r.rotados.join(', ')}`);
  if (!process.env.RESPALDO_DIR) {
    console.log('\n  Ojo: esta en el mismo disco que la base. Para que el respaldo');
    console.log('  sirva ante un robo o una averia, apunta RESPALDO_DIR a un');
    console.log('  pendrive o disco externo:');
    console.log('      RESPALDO_DIR=E:\\respaldos node respaldo.mjs');
  }
  console.log(previo ? `\n  Anterior: ${previo.fecha}\n` : '\n  Es el primero.\n');
} catch (e) {
  console.error(`\n  FALLO el respaldo: ${e.message}\n`);
  process.exit(1);
}
