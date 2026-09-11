/**
 * Capa de intenciones del asesor.
 *
 * Por que existe: probando la tienda como cliente real, 8 de cada 8 preguntas
 * que NO eran "recomiendame un producto" terminaban en un catalogo de productos.
 * La peor: "quiero devolver el propoleo, no me hizo nada" respondia ofreciendo
 * el mismo propoleo. Un motor de recomendacion no es un vendedor.
 *
 * Esta capa corre ANTES del motor de productos. Si detecta una intencion de
 * negocio (delivery, horario, pago, regateo, reclamo, devolucion, comparacion),
 * responde con los datos reales de tienda.config.js y corta ahi.
 */
import { TIENDA, estaAbierto, escalonPara } from './tienda.config.js';

/** Formato peruano: separador de miles, dos decimales, a prueba de NaN. */
const soles = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'S/ —';
  return 'S/ ' + v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Destinos fuera de Lima. Sin esta lista, "envian a arequipa" recibia las
// tarifas de Lima: una respuesta que suena precisa y es mentira.
const PROVINCIAS = [
  'arequipa', 'cusco', 'cuzco', 'trujillo', 'chiclayo', 'piura', 'iquitos',
  'tacna', 'puno', 'juliaca', 'huancayo', 'ayacucho', 'cajamarca', 'tarapoto',
  'pucallpa', 'chimbote', 'ica', 'huaraz', 'moquegua', 'tumbes', 'jaen',
  'huanuco', 'abancay', 'moyobamba', 'sullana', 'talara', 'provincia',
];

/** Codigo de pedido: RA-20260910-A1B */
export const RE_CODIGO = /\bRA-\d{8}-[A-Z0-9]{3}\b/i;

// Cada intencion se reconoce por expresiones regulares sobre el texto ya
// normalizado (sin tildes, en minusculas). El orden importa: la primera gana.
const INTENCIONES = [
  // Anclados con ^…$: solo disparan si el mensaje ES el saludo o la despedida.
  // "hola tienes algo pa la gastritis" tiene que seguir de largo a productos.
  {
    nombre: 'saludo',
    patron: /^(hola|holi|buenas|buenos dias|buenas tardes|buenas noches|que tal|alo|hey)( buenas| tardes| dias| noches| amigo| casera| señor| señora)*$/,
  },
  {
    nombre: 'despedida',
    patron: /^(ok|oka|ya|listo|gracias|muchas gracias|ok gracias|ya gracias|mil gracias|perfecto|de acuerdo|bueno|chau|hasta luego|nos vemos|lo pensare|lo voy a pensar)( gracias| amigo| casera)*$/,
  },
  {
    nombre: 'presencia',
    patron: /^(sigues ahi|estas ahi|hay alguien|me escuchas|me lees|hola\?+|\?+)$/,
  },
  {
    nombre: 'catalogo',
    patron: /\b(catalogo|lista de precios|que (productos |cosas )?(tienen|venden|manejan)|que mas tienen|todos los productos|muestrame todo|que precios (tienen|manejan|hay)|pasame (la lista|los precios|el catalogo))\b/,
  },
  {
    nombre: 'canal',
    patron: /\b(atienden por whatsapp|tienen whatsapp|cual es tu whatsapp|pasame tu (numero|whatsapp)|te puedo escribir|numero de contacto)\b/,
  },
  // Antes que `pago`: "hacen factura" caia en medios de pago y no respondia.
  {
    nombre: 'comprobante',
    patron: /\b(factura|boleta|comprobante|tienen ruc|con ruc|nota de credito|recibo)\b/,
  },
  {
    nombre: 'mayorista',
    patron: /\b(por mayor|al por mayor|mayorista|precio de mayorista|precio por caja|por caja|por docena|para (mi|una) (bodega|tienda|botica|restaurante|negocio)|revender|para revender|distribuidor|proveedor)\b/,
  },
  {
    nombre: 'reclamo',
    patron: /\b(no (me )?(llegan?|llego|ha llegado|llegaron)|no llega nadie|sigue sin llegar|donde esta mi pedido|mi pedido no|hace \w+ dias? (que|y)|se demoro|esta demorando|nadie me (llamo|contacto)|estafa|reclamo)\b/,
  },
  {
    nombre: 'devolucion',
    patron: /\b(devolver\w*|devolucion|cambiar el producto|me lo cambias|no me (hizo|sirvio|funciono)|quiero mi (plata|dinero)|reembolso|vino (mal|malogrado|vencido)|esta vencido)\b/,
  },
  {
    nombre: 'regateo',
    patron: /\b(me lo dejas|dejamelo|rebaja|descuento|mas barato|ultimo precio|precio final|hazme precio|yapa|casera|se puede menos|baja(le|me)? el precio)\b/,
  },
  {
    nombre: 'delivery',
    patron: /\b(delivery|reparto|envio|env[ií]an|mandan|llevan a|reparten|cuanto demora|en cuanto llega|hacen entrega|a domicilio|recojo|recoger|envios?)\b/,
  },
  {
    nombre: 'horario',
    patron: /\b(hora (abren|cierran|atienden)|horario|abren|cierran|atienden (hoy|los|el)|estan abiertos|hasta que hora|a que hora)\b/,
  },
  {
    nombre: 'pago',
    patron: /\b(yape|plin|tarjeta|visa|mastercard|transferencia|como (pago|se paga)|forma de pago|medios de pago|efectivo|contra entrega|factura|boleta)\b/,
  },
  {
    nombre: 'ubicacion',
    patron: /\b(donde (estan?|quedan?|los ubico|puedo ir|los encuentro)|direccion|como llego|como los ubico|en que (mercado|puesto)|tienen local|puesto)\b/,
  },
  {
    nombre: 'autenticidad',
    patron: /\b(es original|son originales|es autentico|es chino|es falso|es puro|adulterado|garantia|certificado|registro sanitario|de donde (viene|lo traen)|confio)\b/,
  },
];

/** Devuelve el nombre de la intencion detectada, o null. */
export function detectarIntencion(textoNormalizado) {
  for (const i of INTENCIONES) {
    if (i.patron.test(textoNormalizado)) return i.nombre;
  }
  return null;
}

/** "cual es mejor la maca negra o la gelatinizada" -> los dos productos. */
export function detectarComparacion(textoNormalizado, productos, normalizar) {
  if (!/\b(mejor|diferencia|cual (me )?(conviene|llevo|elijo)|o la|o el|compar)/.test(textoNormalizado)) {
    return null;
  }
  const mencionados = productos.filter((p) => {
    const palabras = normalizar(p.nombre).split(' ').filter((w) => w.length > 3);
    return palabras.some((w) => textoNormalizado.includes(w));
  });
  return mencionados.length >= 2 ? mencionados.slice(0, 2) : null;
}

/**
 * "cuanto me sale 50 bolsas de maca negra" -> cotizacion real.
 *
 * Esta es la pieza que sostiene el argumento de venta con un mayorista: no basta
 * con dar el precio por volumen, hay que decirle CUANTAS hay hoy. Un pedido de 50
 * sobre un stock de 42 es exactamente la perdida que el sistema promete evitar,
 * y es el pedido mas grande, donde mas duele equivocarse.
 *
 * Recibe la consulta CRUDA porque `normalizar` de asesor.js borra los digitos.
 */
export function cotizar(consultaCruda, productos) {
  const texto = String(consultaCruda).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Filtro 1: unidades de medida, edad y precio NUNCA son cantidad de compra.
  // Sin esto, "la maca de 250 gramos" cotizaba 250 bolsas por S/ 6900, y
  // "me lo dejas en 20 soles" cotizaba 20 macas en vez de responder al regateo.
  const MEDIDA = /^(ml|cc|mg|gr?|gramos?|kg|litros?|lt|a[nñ]os?|soles?|luca)\b/;

  // Filtro 2: tiene que haber intencion de compra. O la cifra viene pegada a un
  // envase ("50 bolsas"), o el mensaje trae un verbo de compra.
  const ENVASE = /^(unidades?|und|bolsas?|frascos?|cajas?|paquetes?|botellas?|barras?|kilos?|docenas?|sobres?|potes?|tarros?|latas?|sacos?)\b/;
  const COMPRA = /\b(quiero|dame|deme|necesito|llevo|llevar|llevare|comprar|compro|vendeme|me vendes|cotiza|cotizar|cotizacion|cuanto me sale|cuanto me cuesta|cuanto seria|por mayor|mayorista|separame|pedido de)\b/;

  let cantidad = null;
  const cifras = [...texto.matchAll(/\b(\d{1,5})\b/g)];
  for (const m of cifras) {
    const resto = texto.slice(m.index + m[0].length).trimStart();
    if (MEDIDA.test(resto)) continue;                   // "250 gramos", "20 soles"
    if (!ENVASE.test(resto) && !COMPRA.test(texto)) continue;
    cantidad = Number(m[1]);
    break;
  }
  if (cantidad === null || cantidad < 2 || cantidad > 100000) return null;

  // El envase que pidio: "50 BOLSAS de maca negra". Si lo dijo, manda — pedir
  // bolsas y que le coticen un frasco de 60 ml es la clase de detalle que en
  // una venta al por mayor hace desconfiar de todo lo demas.
  const ENVASES = {
    bolsa: /bolsa/, frasco: /frasco/, caja: /caja/, botella: /botella/,
    pote: /pote/, barra: /barra/, tubo: /tubo/, gotero: /gotero/,
    sachet: /sachet/, spray: /spray/,
  };
  const pedido = Object.entries(ENVASES)
    .find(([envase]) => new RegExp(`\\b${envase}s?\\b`).test(texto));
  const envase = pedido ? pedido[1] : null;

  // Producto mencionado por nombre. Gana el que empareje mas palabras.
  //
  // Con el catalogo grande la misma raiz aparece en varias presentaciones
  // ("Maca Negra en polvo", "en capsulas", "gelatinizada") y todas empatan a
  // dos palabras. El desempate no puede ser el orden de la consulta: primero
  // el envase que pidio, despues lo que se le puede despachar hoy (mas stock)
  // y a igual stock lo mas barato. Queda determinista.
  const encaja = (p) => (envase && envase.test(p.presentacion.toLowerCase()) ? 1 : 0);

  let mejor = null;
  let mejorPuntos = 0;
  for (const p of productos) {
    const palabras = p.nombre.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .split(/[^a-z]+/).filter((w) => w.length > 3);
    const aciertos = palabras.filter((w) => texto.includes(w)).length;
    if (aciertos === 0) continue;
    if (!mejor || aciertos > mejorPuntos
      || (aciertos === mejorPuntos
        && (encaja(p) > encaja(mejor)
          || (encaja(p) === encaja(mejor)
            && (p.stock > mejor.stock
              || (p.stock === mejor.stock && p.precio < mejor.precio)))))) {
      mejorPuntos = aciertos;
      mejor = p;
    }
  }
  if (!mejor) return null;

  const escalon = escalonPara(cantidad);
  const pct = escalon ? escalon.porcentaje : 0;
  const unitario = +(mejor.precio * (1 - pct / 100)).toFixed(2);

  return {
    producto: mejor,
    cantidad,
    porcentaje: pct,
    unitario,
    total: +(unitario * cantidad).toFixed(2),
    listaTotal: +(mejor.precio * cantidad).toFixed(2),
    disponible: Math.min(cantidad, mejor.stock),
    faltan: Math.max(0, cantidad - mejor.stock),
  };
}

// ------------------------------------------------------------------ respuestas
const listaZonas = () => TIENDA.delivery.zonas
  .map((z) => `${z.nombre}: ${soles(z.costo)}, ${z.horas}`)
  .join('. ');

const RESPUESTAS = {
  delivery: ({ texto = '' }) => {
    // Si el destino es fuera de Lima, cotizarle tarifas de Lima es mentirle.
    const prov = PROVINCIAS.find((c) => texto.includes(c));
    if (prov) {
      const pr = TIENDA.delivery.provincias;
      if (!pr.habilitado) {
        return 'Por ahora solo repartimos dentro de Lima; a provincias todavía no llegamos.';
      }
      return `A provincia sí enviamos, por agencia (${pr.agencias.join(' o ')}), ` +
        `en ${pr.plazo}. ${pr.quienPaga}, así que el costo depende del peso y de tu ciudad. ` +
        `${pr.nota}. Escríbenos al ${TIENDA.whatsapp} con tu pedido y te lo despachamos.`;
    }
    return `Sí hacemos delivery. ${listaZonas()}. ` +
      `Desde ${soles(TIENDA.delivery.gratisDesde)} el envío va gratis` +
      (TIENDA.delivery.recojoEnTienda
        ? `, y si prefieres puedes recoger sin costo en ${TIENDA.direccion}.`
        : '.');
  },

  saludo: () => {
    const h = estaAbierto()
      ? 'Estamos atendiendo.'
      : `Ahorita estamos cerrados, pero te leo. Abrimos ${TIENDA.horario.texto}.`;
    return `¡Hola! Bienvenido a ${TIENDA.nombre}. ${h} ` +
      '¿En qué te puedo ayudar? Cuéntame qué necesitas o qué te está molestando y te oriento.';
  },

  despedida: () =>
    `Gracias a ti. Cualquier cosa nos escribes al ${TIENDA.whatsapp}. ¡Que te vaya bien!`,

  presencia: () =>
    `Acá estoy. Dime nomás qué necesitas. Si prefieres hablar con una persona, ` +
    `escríbenos al ${TIENDA.whatsapp}.`,

  canal: () =>
    `Sí, atendemos por WhatsApp al ${TIENDA.whatsapp}. ` +
    `También puedes venir al local: ${TIENDA.direccion}, ${TIENDA.horario.texto}.`,

  catalogo: ({ productos = [] }) => {
    const porCategoria = {};
    for (const p of productos) {
      if (p.stock <= 0) continue;
      (porCategoria[p.categoria] ||= []).push(p);
    }
    const resumen = Object.entries(porCategoria)
      .map(([cat, ps]) => {
        const min = Math.min(...ps.map((p) => p.precio));
        return `${cat} (${ps.length}, desde ${soles(min)})`;
      }).join(', ');
    return `Tenemos ${productos.filter((p) => p.stock > 0).length} productos disponibles hoy: ` +
      `${resumen}. Puedes verlos todos con foto y precio en la tienda, ` +
      'o dime qué buscas y te digo al toque si lo tengo.';
  },

  comprobante: () => {
    const c = TIENDA.comprobante;
    if (!c.factura && !c.boleta) return 'Por ahora no emitimos comprobante electrónico.';
    const tipos = [c.boleta && 'boleta', c.factura && 'factura'].filter(Boolean).join(' y ');
    return `Sí, damos ${tipos}. Nuestro RUC es ${c.ruc}, ${c.razonSocial}. ` +
      (c.factura ? c.nota : '');
  },

  mayorista: () => {
    const m = TIENDA.politicas.mayorista;
    const esc = TIENDA.politicas.regateo.escalones
      .map((e) => `desde ${e.desde} unidades ${e.porcentaje}%`).join(', ');
    return `Sí trabajamos al por mayor. La escala es: ${esc}, ` +
      `${TIENDA.politicas.regateo.alcance}. ` +
      (TIENDA.comprobante.factura ? 'Damos factura con tu RUC. ' : '') +
      `Dime qué producto y cuántas unidades y te paso el precio y cuántas tengo hoy. ` +
      `Para pedidos grandes ${m.nota}, al ${TIENDA.whatsapp}.`;
  },

  horario: () => {
    const abierto = estaAbierto();
    return (abierto
      ? `Sí, estamos atendiendo ahora mismo. `
      : `En este momento estamos cerrados. `) +
      `Abrimos ${TIENDA.horario.texto}; ${TIENDA.horario.domingo}. ` +
      `Si necesitas algo urgente, escríbenos al ${TIENDA.whatsapp} y lo dejamos separado.`;
  },

  pago: () => {
    const m = TIENDA.pago.medios;
    return `Aceptamos ${m.slice(0, -1).join(', ')} y ${m[m.length - 1]}.` +
      (TIENDA.pago.tarjeta ? ' También tarjeta.' : ' Todavía no tenemos POS para tarjeta.') +
      (TIENDA.pago.contraEntrega
        ? ' Si el pedido es con delivery, puedes pagar cuando te llegue.'
        : '');
  },

  ubicacion: () =>
    `Estamos en ${TIENDA.direccion}, ${TIENDA.referencia}. ` +
    `Atendemos ${TIENDA.horario.texto}. Cualquier cosa, llámanos al ${TIENDA.telefono}.`,

  regateo: () => {
    const r = TIENDA.politicas.regateo;
    const esc = r.escalones
      .map((e) => `${e.desde} o más, ${e.porcentaje}%`).join('; ');
    return 'Los precios de lista no los movemos, son los mismos para todos. ' +
      `Lo que sí tenemos es descuento por cantidad ${r.alcance}: ${esc}. ` +
      'También te puedo mostrar una presentación más chica si buscas gastar menos.';
  },

  devolucion: () => {
    const d = TIENDA.politicas.devolucion;
    return `Tienes ${d.diasPlazo} días para cambios. ` +
      (d.requiereSellado
        ? `Eso sí, el producto tiene que estar sellado: ${d.nota} `
        : '') +
      'Si el producto te llegó en mal estado o vencido, eso sí te lo cambiamos sin problema, ' +
      `escríbenos al ${TIENDA.whatsapp} con tu código de pedido y una foto. ` +
      'Y si simplemente no notaste efecto, cuéntame cómo lo tomaste: capaz la dosis o el momento del día no eran los adecuados.';
  },

  autenticidad: () => TIENDA.politicas.garantiaOrigen +
    ' Cada producto de la tienda dice de qué zona viene, no solo el nombre. ' +
    'Trabajamos directo con productores, sin intermediarios.',

  reclamo: ({ pedido }) => {
    if (!pedido) {
      return 'Lamento la demora, vamos a resolverlo. ' +
        'Pásame tu código de pedido (empieza con RA-) y te digo al toque en qué estado está. ' +
        `Si lo tienes a la mano, escríbenos también al ${TIENDA.whatsapp} y lo revisamos contigo.`;
    }
    // Ojo: el asesor NO cambia el estado del pedido. Cambiarlo desde un chat
    // sin autenticar dejaria que cualquiera con un codigo mueva el inventario.
    // Por eso informa y compromete a la tienda, pero no promete una accion
    // que el sistema no ejecuto: si el dueño mira el panel, todo cuadra.
    const estados = {
      pendiente: 'está registrado y todavía no sale del local. Hoy mismo te contactamos para coordinar la entrega',
      preparando: 'lo estamos preparando en este momento',
      enviado: 'ya salió con el repartidor, debería llegarte hoy',
      entregado: 'figura como entregado',
      anulado: 'figura como anulado',
    };
    // El codigo de pedido es una credencial debil: quien lo tiene puede
    // consultar el estado, pero NO puede sacarle datos personales al sistema.
    // Antes esta respuesta devolvia el telefono del cliente, asi que enumerar
    // codigos era una forma de cosechar telefonos. Solo estado, fecha y monto.
    return `Encontré tu pedido ${pedido.codigo}, del ${pedido.creado_en.slice(0, 10)}, ` +
      `por ${soles(pedido.total)}: ${estados[pedido.estado]}. ` +
      (pedido.estado === 'entregado'
        ? 'Si no lo recibiste, avísanos de inmediato para rastrearlo con el repartidor.'
        : `Te llamamos al número que dejaste en el pedido. Si quieres adelantarlo, ` +
          `escríbenos al ${TIENDA.whatsapp} desde ese mismo número.`);
  },
};

export function responderIntencion(nombre, ctx = {}) {
  const fn = RESPUESTAS[nombre];
  return fn ? fn(ctx) : null;
}

/**
 * Respuesta a una cotizacion por volumen.
 * Lo importante no es el precio: es decir cuantas hay HOY.
 */
export function responderCotizacion(c) {
  const p = c.producto;
  const m = TIENDA.politicas.mayorista;

  const precio = c.porcentaje
    ? `Por ${c.cantidad} unidades te aplico ${c.porcentaje}% de descuento: ` +
      `${soles(c.unitario)} cada una, ${soles(c.total)} en total ` +
      `(en lugar de ${soles(c.listaTotal)}).`
    : `${c.cantidad} × ${soles(p.precio)} son ${soles(c.total)}. ` +
      `Desde ${TIENDA.politicas.regateo.escalones[0].desde} unidades ya entra descuento.`;

  // El dato que ningun catalogo estatico te puede dar.
  const stock = c.faltan === 0
    ? `Las tengo listas: hay ${p.stock} en almacén.`
    : `Ahora mismo tengo ${p.stock} de ${p.nombre}, así que te puedo entregar ` +
      `${c.disponible} de una vez y las otras ${c.faltan} en ${m.plazoReposicion}. ` +
      `Si te sirve así, lo separamos.`;

  const cierre = c.cantidad >= m.desde
    ? ` Para este volumen ${m.nota}, al ${TIENDA.whatsapp}.` +
      (TIENDA.comprobante.factura ? ' Va con factura si necesitas.' : '')
    : '';

  return `${p.nombre} (${p.presentacion}).\n\n${precio}\n\n${stock}${cierre}`;
}

/** Respuesta comparativa entre dos productos del catalogo. */
export function responderComparacion([a, b]) {
  const linea = (p) =>
    `· ${p.nombre} (${p.presentacion}, ${soles(p.precio)}): ${p.descripcion}`;
  const barato = a.precio <= b.precio ? a : b;
  return `Son distintas, no es que una sea mejor.\n\n${linea(a)}\n${linea(b)}\n\n` +
    `Si vas por precio, ${barato.nombre} te sale más a cuenta. ` +
    'Dime para qué la quieres y te digo cuál te conviene a ti. ' +
    'Son productos naturales, no reemplazan un tratamiento médico.';
}

/** Contexto en texto para que Claude redacte con los datos reales del negocio. */
export function contextoTienda(intencion) {
  return [
    `Datos de la tienda (usalos, no inventes otros):`,
    `- Nombre: ${TIENDA.nombre}`,
    `- Direccion: ${TIENDA.direccion}, ${TIENDA.referencia}`,
    `- Horario: ${TIENDA.horario.texto}; ${TIENDA.horario.domingo}`,
    `- Ahora mismo la tienda esta ${estaAbierto() ? 'ABIERTA' : 'CERRADA'}`,
    `- WhatsApp: ${TIENDA.whatsapp}`,
    `- Delivery: ${listaZonas()}. Gratis desde ${soles(TIENDA.delivery.gratisDesde)}`,
    `- Pago: ${TIENDA.pago.medios.join(', ')}`,
    `- Descuento por volumen (precio de lista fijo, ${TIENDA.politicas.regateo.alcance}): ` +
      TIENDA.politicas.regateo.escalones
        .map((e) => `${e.desde}+ unidades ${e.porcentaje}%`).join(', '),
    `- Mayorista desde ${TIENDA.politicas.mayorista.desde} unidades; ` +
      `lo que no hay en stock llega en ${TIENDA.politicas.mayorista.plazoReposicion}`,
    `- Comprobante: ${TIENDA.comprobante.factura ? 'boleta y factura' : 'solo boleta'}` +
      (TIENDA.comprobante.factura ? `, RUC ${TIENDA.comprobante.ruc}` : ''),
    `- Envio a provincia: ${TIENDA.delivery.provincias.habilitado
      ? `por agencia (${TIENDA.delivery.provincias.agencias.join(', ')}), ` +
        `${TIENDA.delivery.provincias.plazo}, ${TIENDA.delivery.provincias.quienPaga}`
      : 'no disponible'}`,
    `- Devoluciones: ${TIENDA.politicas.devolucion.diasPlazo} dias, solo sellado. ` +
      TIENDA.politicas.devolucion.nota,
    ``,
    `La intencion detectada es: ${intencion}.`,
  ].join('\n');
}
