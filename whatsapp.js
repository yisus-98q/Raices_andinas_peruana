/**
 * Avisos al cliente por WhatsApp: pedido confirmado, en camino y entregado.
 *
 * Dos modos, según lo que haya en el .env:
 *
 * - **manual** (por defecto, el de la demo). No se manda nada solo: el panel
 *   ofrece un botón que abre el chat del cliente con el mensaje ya escrito, y
 *   quien atiende —o el motorizado desde su teléfono— lo envía con un toque.
 *   Funciona sin cuenta de empresa, sin costo y sin internet en el servidor.
 *
 * - **api**: con WHATSAPP_TOKEN y WHATSAPP_PHONE_ID el servidor lo envía por la
 *   API oficial de WhatsApp Business (Cloud API de Meta) en cuanto el pedido
 *   cambia de estado. Para escribirle a alguien que no escribió primero, Meta
 *   exige plantillas aprobadas: su nombre va en WHATSAPP_PLANTILLA_CONFIRMADO,
 *   _EN_CAMINO y _ENTREGADO. Sin plantilla se manda texto libre, que Meta solo
 *   acepta dentro de las 24 h desde el último mensaje del cliente.
 *
 * Un aviso que falla no frena nada: el pedido ya cambió de estado. Queda
 * registrado con su error y el panel vuelve a ofrecer el botón manual.
 *
 * Sin dependencias: `fetch` viene con Node.
 */
import './entorno.js';
import { TIENDA } from './tienda.config.js';

export const EVENTOS = ['confirmado', 'en_camino', 'entregado'];

export const NOMBRE_EVENTO = {
  confirmado: 'pedido confirmado',
  en_camino: 'en camino',
  entregado: 'entregado',
};

/** 956 231 447 → 51956231447. Lo que no parece un número peruano, tal cual. */
export function telefonoInternacional(tel, pais = TIENDA.pais || '51') {
  const d = String(tel || '').replace(/\D/g, '');
  if (d.length === 9) return pais + d;
  if (d.length === 11 && d.startsWith(pais)) return d;
  return d;
}

/** Dónde se ve la tienda desde fuera. En la demo local se puede apuntar a la IP. */
export const urlPublica = () => (process.env.URL_PUBLICA || TIENDA.sitio || '').replace(/\/+$/, '');

/**
 * El enlace de rastreo: la página de seguimiento con el código ya puesto.
 * Para ver el pedido pide además los últimos 4 dígitos del teléfono, así que
 * un enlace reenviado no expone el pedido de nadie.
 */
export const enlaceSeguimiento = (pedido) =>
  `${urlPublica()}/mi-pedido.html?codigo=${encodeURIComponent(pedido.codigo)}`;

const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Las variables que puede usar una plantilla. */
export function variables(pedido, { repartidor = '' } = {}) {
  const recojo = pedido.modo_entrega === 'recojo';
  return {
    nombre: String(pedido.cliente_nombre || '').split(/\s+/)[0] || 'hola',
    codigo: pedido.codigo,
    total: soles(pedido.total),
    repartidor: repartidor || 'nuestro repartidor',
    enlace: enlaceSeguimiento(pedido),
    tienda: TIENDA.nombre,
    entrega: recojo
      ? `Lo recoges en el puesto: ${TIENDA.direccion}.`
      : `Te lo llevamos a ${[pedido.distrito, pedido.provincia].filter(Boolean).join(', ') || 'tu dirección'}.`,
  };
}

/**
 * Qué variables lleva cada plantilla aprobada, en el orden de {{1}}, {{2}}…
 *
 * Por evento y no las cinco siempre: Meta rechaza el envío si la cantidad de
 * parámetros no coincide con la plantilla, y un «entregado» no necesita el
 * enlace de rastreo ni el nombre del motorizado.
 */
export const PARAMETROS_PLANTILLA = {
  confirmado: ['nombre', 'codigo', 'total', 'enlace'],
  en_camino: ['nombre', 'codigo', 'repartidor', 'enlace', 'total'],
  entregado: ['nombre', 'codigo'],
};

/** El texto del aviso, con las variables puestas. */
export function mensaje(evento, pedido, extra = {}) {
  const plantilla = TIENDA.avisos?.plantillas?.[evento];
  if (!plantilla) return '';
  const v = variables(pedido, extra);
  return plantilla.replace(/\{(\w+)\}/g, (todo, clave) => (clave in v ? v[clave] : todo));
}

/** El enlace que abre el chat del cliente con el mensaje escrito (modo manual). */
export const enlaceChat = (pedido, texto) =>
  `https://wa.me/${telefonoInternacional(pedido.cliente_tel)}?text=${encodeURIComponent(texto)}`;

export const modo = () => (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID ? 'api' : 'manual');

/**
 * Envía por la Cloud API. Devuelve { ok, detalle } y nunca lanza.
 *
 * WHATSAPP_API_URL permite apuntar a otro servidor compatible (lo usan los
 * tests con uno falso); por defecto es el de Meta, con la versión de
 * WHATSAPP_API_VERSION.
 */
export async function enviarPorApi(evento, pedido, texto, extra = {}) {
  const base = (process.env.WHATSAPP_API_URL
    || `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v21.0'}`).replace(/\/+$/, '');
  const plantilla = process.env[`WHATSAPP_PLANTILLA_${evento.toUpperCase()}`];
  const v = variables(pedido, extra);
  const destino = telefonoInternacional(pedido.cliente_tel);

  const cuerpo = plantilla
    ? {
      messaging_product: 'whatsapp', to: destino, type: 'template',
      template: {
        name: plantilla,
        language: { code: process.env.WHATSAPP_IDIOMA || 'es' },
        // Cantidad y orden según PARAMETROS_PLANTILLA: tienen que coincidir
        // con los {{1}}, {{2}}… de la plantilla aprobada.
        components: [{
          type: 'body',
          parameters: (PARAMETROS_PLANTILLA[evento] || [])
            .map((clave) => ({ type: 'text', text: String(v[clave]) })),
        }],
      },
    }
    : { messaging_product: 'whatsapp', to: destino, type: 'text', text: { body: texto, preview_url: true } };

  try {
    const r = await fetch(`${base}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(10000),
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, detalle: datos?.error?.message || `HTTP ${r.status}` };
    return { ok: true, detalle: datos?.messages?.[0]?.id || 'enviado' };
  } catch (e) {
    return { ok: false, detalle: e.message };
  }
}
