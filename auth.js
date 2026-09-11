/**
 * Autenticacion del panel interno.
 *
 * Sin dependencias: scrypt y randomBytes vienen en node:crypto.
 *
 * Lo que se protege no es "el panel" en abstracto: es GET /api/pedidos, que
 * devuelve nombre, telefono y direccion de cada cliente que compro. Eso es dato
 * personal; dejarlo abierto no es un descuido de demo, es una fuga.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';
import { TIENDA } from './tienda.config.js';

/**
 * Los dos papeles que hay en un puesto de mercado, y no mas:
 *
 * - `admin`   el dueño. Ve el costo, el margen y el valor del inventario,
 *             cambia precios, da de alta productos y maneja el respaldo.
 * - `vendedor` quien atiende y despacha. Trabaja los pedidos, mueve stock,
 *             entrega comprobantes y consulta clientes — **sin ver lo que a
 *             la tienda le cuesta cada cosa**.
 *
 * Que el sobrino no vea el costo no es desconfianza: es que el margen es la
 * negociacion del dueño con su proveedor, y no tiene por que estar en la
 * pantalla del mostrador donde cualquiera se asoma.
 */
export const ROLES = ['admin', 'vendedor'];

export const esAdmin = (sesion) => sesion?.rol === 'admin';

const HORAS_SESION = 8;          // una jornada del local
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 5 * 60 * 1000;

const Q = {
  porUsuario: db.prepare('SELECT * FROM usuarios WHERE usuario = ?'),
  // Se entra con el correo. Tambien se acepta el usuario corto: el personal
  // del mostrador lo tiene aprendido y no cuesta nada seguir admitiendolo.
  porCorreo: db.prepare("SELECT * FROM usuarios WHERE email = ? AND email != ''"),
  contar: db.prepare('SELECT COUNT(*) c FROM usuarios'),
  crear: db.prepare(`INSERT INTO usuarios (usuario, email, nombre, hash, salt, rol)
                     VALUES (?,?,?,?,?,?)`),
  actualizarCorreo: db.prepare('UPDATE usuarios SET email = ? WHERE usuario = ?'),
  actualizarClave: db.prepare('UPDATE usuarios SET hash = ?, salt = ? WHERE usuario = ?'),
  abrirSesion: db.prepare(`INSERT INTO sesiones (token, usuario_id, expira_en, ip)
                           VALUES (?,?,?,?)`),
  sesion: db.prepare(`SELECT s.token, s.expira_en, u.id, u.usuario, u.email, u.nombre, u.rol
                      FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
                      WHERE s.token = ?`),
  borrarSesion: db.prepare('DELETE FROM sesiones WHERE token = ?'),
  purgar: db.prepare("DELETE FROM sesiones WHERE expira_en < datetime('now','localtime')"),
  sesionesDe: db.prepare('DELETE FROM sesiones WHERE usuario_id = ?'),
};

// ------------------------------------------------------------------- claves
const derivar = (clave, salt) => scryptSync(clave, salt, 64).toString('hex');

/** Comparacion en tiempo constante: no filtra cuanto acerto el atacante. */
function igual(a, b) {
  const ba = Buffer.from(String(a), 'hex');
  const bb = Buffer.from(String(b), 'hex');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Validacion deliberadamente simple: no es un verificador de buzon. */
export const correoValido = (c) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(c || '').trim());

export function crearUsuario(usuario, email, nombre, clave, rol = 'admin') {
  if (!ROLES.includes(rol)) throw new Error(`Rol desconocido: ${rol}`);
  const salt = randomBytes(16).toString('hex');
  Q.crear.run(usuario, String(email || '').trim().toLowerCase(), nombre,
    derivar(clave, salt), salt, rol);
}

/** Cambia el papel de alguien. Sus sesiones abiertas siguen valiendo: el
 *  permiso se lee de la tabla en cada peticion, no de la cookie. */
export function cambiarRol(usuario, rol) {
  if (!ROLES.includes(rol)) throw new Error(`Rol desconocido: ${rol}`);
  return db.prepare('UPDATE usuarios SET rol = ? WHERE usuario = ?')
    .run(rol, String(usuario).toLowerCase()).changes > 0;
}

export function cambiarCorreo(usuario, email) {
  return Q.actualizarCorreo.run(String(email).trim().toLowerCase(),
    String(usuario).toLowerCase()).changes > 0;
}

/** Busca por correo primero; si no, por usuario corto. */
export const buscarUsuario = (identificador) => {
  const id = String(identificador || '').trim().toLowerCase();
  return Q.porCorreo.get(id) || Q.porUsuario.get(id) || null;
};

export function cambiarClave(identificador, clave) {
  const u = buscarUsuario(identificador);
  if (!u) return false;
  const salt = randomBytes(16).toString('hex');
  Q.actualizarClave.run(derivar(clave, salt), salt, u.usuario);
  Q.sesionesDe.run(u.id);     // cambiar la clave cierra las sesiones abiertas
  return true;
}

// --------------------------------------------------------------- intentos
// En memoria a proposito: un reinicio limpia los bloqueos y no ensucia la base.
const intentos = new Map();

function bloqueadoHasta(usuario) {
  const e = intentos.get(usuario);
  if (!e || e.fallos < MAX_INTENTOS) return 0;
  const hasta = e.ultimo + BLOQUEO_MS;
  if (Date.now() > hasta) { intentos.delete(usuario); return 0; }
  return hasta;
}

function anotarFallo(usuario) {
  const e = intentos.get(usuario) || { fallos: 0, ultimo: 0 };
  e.fallos += 1;
  e.ultimo = Date.now();
  intentos.set(usuario, e);
}

// ---------------------------------------------------------------- sesiones
/**
 * Devuelve { token, usuario } o un objeto con `error`.
 * Nunca dice si fallo el usuario o la clave: eso le confirmaria a un atacante
 * que la cuenta existe.
 */
export function iniciarSesion(identificador, clave, ip = '') {
  const nombreUsuario = String(identificador || '').trim().toLowerCase();
  const hasta = bloqueadoHasta(nombreUsuario);
  if (hasta) {
    const min = Math.ceil((hasta - Date.now()) / 60000);
    return { error: `Demasiados intentos fallidos. Vuelve a intentar en ${min} min.` };
  }

  const u = buscarUsuario(nombreUsuario);
  const credencialesOk = u && igual(derivar(String(clave || ''), u.salt), u.hash);

  if (!credencialesOk) {
    anotarFallo(nombreUsuario);
    return { error: 'Correo o contraseña incorrectos.' };
  }

  intentos.delete(nombreUsuario);
  const token = randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + HORAS_SESION * 3600e3)
    .toISOString().slice(0, 19).replace('T', ' ');
  Q.purgar.run();
  Q.abrirSesion.run(token, u.id, expira, ip);
  return { token, usuario: { usuario: u.usuario, email: u.email, nombre: u.nombre, rol: u.rol } };
}

export function sesionDe(token) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const s = Q.sesion.get(token);
  if (!s) return null;
  if (new Date(s.expira_en.replace(' ', 'T')) < new Date()) {
    Q.borrarSesion.run(token);
    return null;
  }
  return { usuario: s.usuario, email: s.email, nombre: s.nombre, rol: s.rol };
}

export const cerrarSesion = (token) => { if (token) Q.borrarSesion.run(token); };

// ------------------------------------------------------------------ cookie
export const COOKIE = 'ra_sesion';

export function leerCookie(req, nombre) {
  const crudo = req.headers.cookie;
  if (!crudo) return null;
  for (const parte of crudo.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nombre) return parte.slice(i + 1).trim();
  }
  return null;
}

/**
 * SameSite=Strict es lo que nos cubre de CSRF sin token aparte: el navegador no
 * manda la cookie en peticiones que nacen en otro sitio.
 * `Secure` falta a proposito porque la demo corre en http://localhost; al publicar
 * con HTTPS hay que agregarlo (ver README).
 */
export const cookieSesion = (token) =>
  `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${HORAS_SESION * 3600}`;

export const cookieBorrada = () =>
  `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;

// ------------------------------------------------------- usuario inicial
/** Crea el usuario del dueño la primera vez. Devuelve la clave si la genero. */
export function asegurarUsuarioInicial() {
  if (Q.contar.get().c > 0) return null;
  const clave = process.env.ADMIN_PASSWORD || 'raiz2026';
  const email = (process.env.ADMIN_EMAIL || TIENDA.email).trim().toLowerCase();
  crearUsuario('admin', email, 'Encargado de tienda', clave);
  return { usuario: 'admin', email, clave, generada: !process.env.ADMIN_PASSWORD };
}
