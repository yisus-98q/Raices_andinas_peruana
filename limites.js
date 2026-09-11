/**
 * Límite de peticiones por IP.
 *
 * Por qué existe: la auditoría encontró que `/api/asesor` acepta un código de
 * pedido y responde con sus datos. Los códigos son `RA-AAAAMMDD-XXX`, o sea
 * 36³ = 46 656 combinaciones sobre una fecha predecible. Sin límite, recorrerlos
 * todos era cuestión de minutos. Y `POST /api/pedidos` permitía llenar el panel
 * de pedidos falsos.
 *
 * Es un cubo de fichas (token bucket) en memoria: sin dependencias y suficiente
 * para un solo proceso. Detrás de un balanceador con varias instancias haría
 * falta un almacén compartido (Redis) — anotado en el README.
 */

const cubos = new Map();
let ultimaLimpieza = Date.now();

/**
 * @param {string} clave     identificador del emisor (IP + grupo de rutas)
 * @param {number} permitido peticiones permitidas en la ventana
 * @param {number} ventanaMs duración de la ventana
 * @returns {{ok: boolean, esperaS: number}}
 */
export function consumir(clave, permitido, ventanaMs) {
  const ahora = Date.now();

  // Limpieza perezosa: sin esto el Map crece sin fin con IPs de una sola visita.
  if (ahora - ultimaLimpieza > 60_000) {
    for (const [k, v] of cubos) if (ahora > v.reinicia) cubos.delete(k);
    ultimaLimpieza = ahora;
  }

  let cubo = cubos.get(clave);
  if (!cubo || ahora > cubo.reinicia) {
    cubo = { usadas: 0, reinicia: ahora + ventanaMs };
    cubos.set(clave, cubo);
  }

  cubo.usadas += 1;
  if (cubo.usadas > permitido) {
    return { ok: false, esperaS: Math.max(1, Math.ceil((cubo.reinicia - ahora) / 1000)) };
  }
  return { ok: true, esperaS: 0 };
}

/**
 * Cuotas por grupo de rutas. Generosas para un uso normal de mostrador,
 * estrechas para lo que sirve para abusar.
 */
export const CUOTAS = {
  // Consultar el asesor es barato; enumerar códigos de pedido, no.
  asesor: { permitido: 30, ventanaMs: 60_000 },
  // Un cliente real no hace diez pedidos en cinco minutos.
  pedidos: { permitido: 8, ventanaMs: 5 * 60_000 },
  // Consultar el propio pedido es legitimo; probar codigos ajenos, no.
  seguimiento: { permitido: 20, ventanaMs: 10 * 60_000 },
  // Complementa el bloqueo por usuario de auth.js: cubre el ataque distribuido
  // sobre muchas cuentas desde una misma IP.
  login: { permitido: 20, ventanaMs: 10 * 60_000 },
};

/** Solo para los tests: deja el contador a cero. */
export const reiniciar = () => cubos.clear();
