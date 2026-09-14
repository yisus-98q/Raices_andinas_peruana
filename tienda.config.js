/**
 * Datos y politicas de la tienda.
 *
 * ESTE ES EL UNICO ARCHIVO QUE HAY QUE EDITAR ANTES DE UNA DEMO REAL.
 * Todo lo de aca abajo son datos de ejemplo: reemplazalos por los del cliente
 * (direccion, horario, zonas de reparto, formas de pago, politicas) y el asesor
 * empieza a responder con la verdad de SU negocio, sin tocar una linea de codigo.
 */
export const TIENDA = {
  nombre: 'Raíz Andina',
  direccion: 'Jr. Ayacucho 412, puesto 87, Mercado Central, Lima',
  referencia: 'a media cuadra de la puerta de Andahuaylas',
  // Donde esta el local, en ubigeo. Un pedido que el cliente pasa a recoger no
  // tiene distrito de entrega, pero si tiene que tener uno guardado: sin el la
  // venta quedaria fuera de cualquier corte por zona. Es el del local.
  local: {
    departamento: 'Lima', provincia: 'Lima', distrito: 'Lima',
    // Codigo de ubigeo del INEI del distrito de arriba.
    codigo: '150101',
  },
  telefono: '910 343 930',
  whatsapp: '910 343 930',
  // Prefijo internacional, para los enlaces tel: y wa.me
  pais: '51',
  // Dominio del negocio: de aqui sale el correo del primer usuario del panel.
  email: 'hola@raizandina.pe',
  // Dominio publico. Se usa en canonical, Open Graph y sitemap: el servidor lo
  // inyecta al servir el HTML, para que no quede escrito a mano en cada pagina.
  sitio: 'https://raizandina.pe',

  horario: {
    texto: 'lunes a sábado de 8:00 a 19:00',
    domingo: 'los domingos no abrimos',
    // 0 = domingo. Hora en formato 24 h.
    abre: 8,
    cierra: 19,
    diasCerrado: [0],
  },

  delivery: {
    // Los distritos son los nombres OFICIALES del INEI: el checkout valida
    // contra esa misma lista, así que un nombre mal escrito aquí haría que la
    // zona nunca se aplique. La última zona es el resto de Lima y Callao.
    zonas: [
      {
        nombre: 'Lima Centro', costo: 6, horas: 'el mismo día',
        distritos: ['Lima', 'Breña', 'La Victoria', 'Rímac', 'San Luis', 'El Agustino'],
      },
      {
        nombre: 'Lima Moderna', costo: 9, horas: 'en 24 horas',
        distritos: ['Lince', 'Jesús María', 'San Miguel', 'Magdalena del Mar',
          'Pueblo Libre', 'San Isidro', 'Miraflores', 'Surquillo', 'Barranco',
          'San Borja', 'Santiago de Surco'],
      },
      {
        nombre: 'Lima Norte, Sur y Este', costo: 14, horas: 'en 24 a 48 horas',
        distritos: [],   // vacío = todo lo demás de Lima y Callao
      },
    ],
    gratisDesde: 120,
    recojoEnTienda: true,

    // Envio fuera de Lima. Sin esto, el asesor le cotizaba a un cliente de
    // Arequipa las tarifas de Lima: una respuesta que suena bien y es falsa.
    provincias: {
      habilitado: true,
      agencias: ['Shalom', 'Olva Courier'],
      plazo: '2 a 4 días hábiles',
      quienPaga: 'el flete se paga en la agencia de destino',
      nota: 'enviamos a agencia; necesitamos tu DNI y la ciudad',
    },
  },

  // En Perú el precio que se le muestra al consumidor YA incluye IGV: por eso
  // los precios del catálogo son finales y el desglose se calcula hacia atrás
  // (base = total / 1,18). El porcentaje vive solo aquí, sin repetirse en el
  // código, para que cambiarlo sea cambiar un número.
  igv: { porcentaje: 18, incluidoEnPrecio: true },

  pago: {
    medios: ['Yape', 'Plin', 'efectivo contra entrega', 'transferencia BCP'],
    tarjeta: false,
    contraEntrega: true,
    // NO hay pasarela: el cobro se coordina fuera del sistema. Ver README.
    pasarela: null,
  },

  // Un mayorista no compra si no hay factura. Es la primera pregunta que hace.
  comprobante: {
    boleta: true,
    factura: true,
    // Este RUC pasa la validación de módulo 11. El que había antes
    // (20512345678) NO era válido: lo detectó documentos.js.
    ruc: '20512345671',
    razonSocial: 'Raíz Andina E.I.R.L.',
    nota: 'Para factura necesitamos tu RUC y razón social al momento del pedido.',
  },

  politicas: {
    // El regateo NO se responde con un descuento improvisado: se responde con
    // una escala fija. Asi el asesor nunca regala margen del negocio.
    regateo: {
      descuentoUnitario: false,
      // Ordenados de menor a mayor. El asesor aplica el mayor que califique.
      escalones: [
        { desde: 3, porcentaje: 10 },
        { desde: 12, porcentaje: 15 },
        { desde: 24, porcentaje: 20 },
      ],
      alcance: 'del mismo producto',
    },
    mayorista: {
      desde: 12,
      // Cuanto tarda en llegar lo que no hay en stock hoy.
      plazoReposicion: '3 a 5 días hábiles',
      nota: 'coordinamos por WhatsApp y se separa con 50 % de adelanto',
    },
    devolucion: {
      diasPlazo: 7,
      requiereSellado: true,
      nota: 'Por sanidad no recibimos productos abiertos o ya consumidos.',
    },
    garantiaOrigen:
      'Compramos directo al productor y guardamos la guía de cada lote. ' +
      'Si quieres, en el local te mostramos de qué lote salió cada producto.',
  },
};

/** Si la tienda está abierta ahora mismo (hora del servidor). */
export function estaAbierto(fecha = new Date()) {
  const { abre, cierra, diasCerrado } = TIENDA.horario;
  if (diasCerrado.includes(fecha.getDay())) return false;
  const h = fecha.getHours() + fecha.getMinutes() / 60;
  return h >= abre && h < cierra;
}

/** Descuento por volumen que corresponde a una cantidad. */
export function escalonPara(cantidad) {
  const escalones = TIENDA.politicas.regateo.escalones;
  let mejor = null;
  for (const e of escalones) if (cantidad >= e.desde) mejor = e;
  return mejor; // null si no llega al primer escalon
}
