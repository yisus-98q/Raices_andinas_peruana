/**
 * Gestion de accesos al panel, desde la consola.
 *
 *   node clave.mjs <correo|usuario> <nueva-clave>          cambiar la clave
 *   node clave.mjs --nuevo <usuario> <correo> "<nombre>" <clave>   crear acceso
 *   node clave.mjs --correo <usuario> <nuevo-correo>       cambiar el correo
 *   node clave.mjs --listar
 *
 * Se entra al panel con el CORREO. El `usuario` corto se conserva porque es lo
 * que firma el kardex y la bitacora: en un movimiento de stock se lee mejor
 * "rosa" que "rosa@raizandina.pe".
 *
 * Cambiar una clave cierra todas las sesiones abiertas de esa persona.
 */
import { db } from './db.js';
import { crearUsuario, cambiarClave, cambiarCorreo, correoValido, buscarUsuario } from './auth.js';

const args = process.argv.slice(2);
const MIN_CLAVE = 8;

function salir(mensaje, codigo = 1) {
  console.log(mensaje);
  process.exit(codigo);
}

if (!args.length || args[0] === '--ayuda' || args[0] === '-h') {
  salir([
    'Uso:',
    '  node clave.mjs <correo|usuario> <nueva-clave>                cambiar clave',
    '  node clave.mjs --nuevo <usuario> <correo> "<nombre>" <clave>  crear acceso',
    '  node clave.mjs --correo <usuario> <nuevo-correo>             cambiar correo',
    '  node clave.mjs --listar                                      ver accesos',
  ].join('\n'), 0);
}

if (args[0] === '--listar') {
  const filas = db.prepare(
    'SELECT usuario, email, nombre, rol, creado_en FROM usuarios ORDER BY id').all();
  if (!filas.length) {
    salir('No hay accesos. Arranca el servidor una vez para crear el inicial.', 0);
  }
  for (const u of filas) {
    console.log(`  ${(u.email || '(sin correo)').padEnd(28)} ${u.usuario.padEnd(10)} ` +
      `${u.nombre.padEnd(22)} ${u.rol}`);
  }
  process.exit(0);
}

if (args[0] === '--nuevo') {
  const [, usuario, correo, nombre, clave] = args;
  if (!usuario || !correo || !nombre || !clave) salir('Faltan datos. Usa --ayuda.');
  if (!correoValido(correo)) salir(`"${correo}" no parece un correo valido.`);
  if (clave.length < MIN_CLAVE) salir(`La clave necesita al menos ${MIN_CLAVE} caracteres.`);
  if (buscarUsuario(usuario)) salir(`El usuario "${usuario}" ya existe.`);
  if (buscarUsuario(correo)) salir(`El correo "${correo}" ya esta en uso.`);

  crearUsuario(usuario.toLowerCase(), correo, nombre, clave);
  salir(`Acceso creado: ${correo} (usuario "${usuario}")`, 0);
}

if (args[0] === '--correo') {
  const [, usuario, correo] = args;
  if (!usuario || !correo) salir('Faltan datos. Usa --ayuda.');
  if (!correoValido(correo)) salir(`"${correo}" no parece un correo valido.`);

  const otro = buscarUsuario(correo);
  if (otro && otro.usuario !== usuario.toLowerCase()) {
    salir(`El correo "${correo}" ya lo usa "${otro.usuario}".`);
  }
  if (!cambiarCorreo(usuario, correo)) salir(`No existe el usuario "${usuario}".`);
  salir(`"${usuario}" ahora entra con ${correo}`, 0);
}

// Cambio de clave: acepta indistintamente el correo o el usuario corto.
const [identificador, clave] = args;
if (!clave) salir('Falta la clave. Usa --ayuda.');
if (clave.length < MIN_CLAVE) salir(`La clave necesita al menos ${MIN_CLAVE} caracteres.`);

const u = buscarUsuario(identificador);
if (!u) salir(`No existe ningun acceso con "${identificador}". Crealo con --nuevo.`);

cambiarClave(identificador, clave);
salir(`Clave de ${u.email || u.usuario} actualizada. Sus sesiones abiertas se cerraron.`, 0);
