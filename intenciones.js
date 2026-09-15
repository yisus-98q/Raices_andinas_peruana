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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIENDA, estaAbierto, escalonPara } from './tienda.config.js';
// La zona, el costo y el plazo salen de la misma lógica que usa /api/envio y
// el checkout: el asesor no puede cotizar un envío distinto del que se cobra.
import { validarUbigeo, zonaDe } from './ubigeo.js';

/** Distancia de edición, cortando apenas pasa el máximo. La usa también asesor.js. */
export function distancia(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previa = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const fila = [i];
    let minimo = i;
    for (let j = 1; j <= b.length; j++) {
      fila[j] = Math.min(previa[j] + 1, fila[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (fila[j] < minimo) minimo = fila[j];
    }
    if (minimo > max) return max + 1;
    previa = fila;
  }
  return previa[b.length];
}

// ------------------------------------------------------------- destinos
/**
 * A dónde quiere que le llegue, dicho en una frase libre.
 *
 * «hacen delivery a san juan de lurigancho» recibía las tres zonas de Lima
 * enteras, cuando el sistema ya sabe que ahí son S/ 14 en 24 a 48 horas. Aquí
 * solo se ENCUENTRA el destino en el texto; cuánto cuesta lo decide `zonaDe`,
 * la misma que cobra el checkout.
 *
 * Lima Metropolitana y Callao van primero y por distrito, con la tolerancia a
 * erratas de quien escribe apurado. El resto del país, por provincia o
 * departamento y sin tolerancia: «canas» o «santa» son provincias, y también
 * palabras.
 */
const RAIZ_I = dirname(fileURLToPath(import.meta.url));
const UBIGEO = JSON.parse(readFileSync(join(RAIZ_I, 'public', 'ubigeo.json'), 'utf8'));
const claveLugar = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

const DESTINOS_LIMA = [];
for (const [, [dep, provincias]] of Object.entries(UBIGEO)) {
  for (const [prov, distritos] of provincias) {
    const esLima = claveLugar(dep) === 'lima' && claveLugar(prov) === 'lima';
    const esCallao = claveLugar(dep) === 'callao';
    if (!esLima && !esCallao) continue;
    for (const distrito of distritos) {
      DESTINOS_LIMA.push({ clave: claveLugar(distrito), departamento: dep, provincia: esCallao ? 'Callao' : prov, distrito });
    }
  }
}
DESTINOS_LIMA.sort((a, b) => b.clave.length - a.clave.length);

// Como se dicen en Lima, no como los escribe el INEI.
const ALIAS_LIMA = {
  sjl: 'san juan de lurigancho', sjm: 'san juan de miraflores', smp: 'san martin de porres',
  vmt: 'villa maria del triunfo', ves: 'villa el salvador', surco: 'santiago de surco',
  magdalena: 'magdalena del mar', cercado: 'lima', 'cercado de lima': 'lima', 'la molina': 'la molina',
};

const NO_SON_LUGAR = new Set(['canas', 'santa', 'sucre', 'grau', 'la mar', 'bolivar', 'la union', 'anta',
  'moho', 'lamas', 'lampa', 'palpa', 'manu', 'luya', 'aija', 'ambo', 'lima', 'callao', 'prov const del callao']);
const DESTINOS_PROVINCIA = [];
for (const [, [dep, provincias]] of Object.entries(UBIGEO)) {
  const ponerSi = (nombre) => {
    const c = claveLugar(nombre);
    if (!NO_SON_LUGAR.has(c) && !DESTINOS_PROVINCIA.some((d) => d.clave === c)) DESTINOS_PROVINCIA.push({ clave: c, nombre });
  };
  ponerSi(dep);
  for (const [prov] of provincias) ponerSi(prov);
}
DESTINOS_PROVINCIA.sort((a, b) => b.clave.length - a.clave.length);

export function buscarDestino(textoNormalizado) {
  let t = ` ${textoNormalizado} `;
  for (const [alias, real] of Object.entries(ALIAS_LIMA)) t = t.replace(` ${alias} `, ` ${real} `);

  const exacto = DESTINOS_LIMA.find((d) => t.includes(` ${d.clave} `));
  let lima = exacto;
  if (!lima) {
    // Erratas: «lurigancio», «miraflorez». Solo nombres largos, ventana de
    // tantas palabras como tiene el nombre.
    const palabras = t.trim().split(' ');
    lima = DESTINOS_LIMA.find((d) => {
      if (d.clave.length < 6) return false;
      const n = d.clave.split(' ').length;
      const max = d.clave.length >= 12 ? 2 : 1;
      for (let i = 0; i + n <= palabras.length; i++) {
        const trozo = palabras.slice(i, i + n).join(' ');
        if (trozo[0] === d.clave[0] && distancia(trozo, d.clave, max) <= max) return true;
      }
      return false;
    });
  }
  if (lima) {
    const ubi = validarUbigeo({ departamento: lima.departamento, provincia: lima.provincia, distrito: lima.distrito });
    if (ubi.ok) return { tipo: 'lima', distrito: ubi.valor.distrito, zona: zonaDe(ubi.valor) };
  }

  const prov = DESTINOS_PROVINCIA.find((d) => t.includes(` ${d.clave} `))
    || PROVINCIAS.filter((c) => c !== 'provincia').map((c) => ({ clave: c, nombre: c.charAt(0).toUpperCase() + c.slice(1) }))
      .find((d) => t.includes(` ${d.clave} `));
  if (prov) return { tipo: 'provincia', nombre: prov.nombre };
  if (/\bprovincias?\b/.test(t)) return { tipo: 'provincia', nombre: null };
  return null;
}

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
    // El texto llega sin tildes ni «ñ» (señora -> senora): por eso esas formas.
    patron: /^(hola|holi|holis|buenas|buenos dias|buenas tardes|buenas noches|que tal|alo|hey)( buenas| tardes| dias| noches| amigo| amiga| casera| casero| senor| senora| senorita| hermano| causa| que tal)*$/,
  },
  {
    nombre: 'despedida',
    patron: /^(ok|oka|okey|ya|listo|gracias|muchas gracias|ok gracias|ya gracias|mil gracias|perfecto|de acuerdo|bueno|chau|chao|hasta luego|nos vemos|lo pensare|lo voy a pensar)( gracias| amigo| amiga| casera| casero| senora| senorita| hermano| causa| bendiciones)*$/,
  },
  {
    nombre: 'presencia',
    patron: /^(sigues ahi|estas ahi|hay alguien|me escuchas|me lees|hola\?+|\?+)$/,
  },
  {
    nombre: 'catalogo',
    // «que tienen» a secas pide el catálogo; «que tienen para el insomnio» pide
    // un producto, y se iba al catálogo entero.
    patron: /\b(catalogo|lista de precios|que (productos |cosas )?(tienen|venden|manejan)(?! para| pal| contra| de bueno)|que mas tienen|todos los productos|muestrame todo|que precios (tienen|manejan|hay)|pasame (la lista|los precios|el catalogo))\b/,
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
    patron: /\b(por mayor|al por mayor|mayorista|precio de mayorista|precio por caja|por caja|por docena|para (mi|una) (bodega|tienda|botica|restaurante|negocio)|revend\w*|para revender|vender en (mi|una) \w+|mi bodega|distribuidor\w*|proveedor)\b/,
  },
  {
    nombre: 'reclamo',
    patron: /\b(no (me )?(llegan?|llego|ha llegado|llegaron)|no llega nadie|sigue sin llegar|donde esta mi pedido|mi pedido no|hace \w+ dias? (que|y)|pasaron (\w+ )?dias|y nada$|se demoro|esta demorando|nadie me (llama|llamo|contacta|contacto|contesta|responde)|no me (llaman|responden|contestan)|estafa|reclamo)\b/,
  },
  {
    nombre: 'devolucion',
    patron: /\b(devolver\w*|devolucion|cambiar el producto|me lo cambias|no me (hizo|sirvio|funciono)|quiero mi (plata|dinero)|reembolso|vino (mal|malogrado|vencido|roto|abierto)|lleg\w* (roto|rota|abierto|abierta|derramado|malogrado|vencido|mal)|esta vencido|vencid[oa]s?)\b/,
  },
  {
    nombre: 'regateo',
    patron: /\b(me lo dejas|dejamelo|rebaj\w*|descuent\w*|mas barato|ultimo precio|precio final|hazme precio|me haces precio|haces precio|lo menos|yapa|yapita|casera|se puede menos|baja(le|me)? el precio)\b/,
  },
  {
    nombre: 'delivery',
    patron: /\b(delivery|reparto|envio|env[ií]an|mandan|llevan a|reparten|cuanto demora|en cuanto llega|llegan? (hoy |manana )?a|me lo traen|hacen entrega|a domicilio|recojo|recoger|envios?)\b/,
  },
  {
    nombre: 'horario',
    patron: /\b(hora (abren|cierran|atienden)|horario|abren|cierran|atienden (hoy|los|el)|estan abiertos|hasta que hora|a que hora)\b/,
  },
  {
    nombre: 'pago',
    // «yapeo», «yapear», «plinear»: el medio de pago se volvió verbo.
    patron: /\b(yape\w*|plin\w*|tarjeta|visa|mastercard|transferencia|como (pago|se paga)|forma de pago|medios de pago|efectivo|contra entrega|puedo pagar|factura|boleta)\b/,
  },
  {
    nombre: 'ubicacion',
    patron: /\b(donde (estan?|quedan?|los ubico|puedo ir|los encuentro)|direccion|como llego|como los ubico|en que (mercado|puesto|parte|lugar|sitio)|mercado central|tienen local|puesto)\b/,
  },
  {
    nombre: 'autenticidad',
    patron: /\b(es original|son originales|es autentico|es chino|es falso|es puro|adulterado|garantia|certificado|registro sanitario|de donde (viene|lo traen)|confio|bamba|trucho|imitacion|pirata)\b/,
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
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

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
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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
// Los textos de tienda.config.js vienen en minúscula porque se escriben para ir
// a mitad de frase; cuando abren una oración, la primera letra va arriba.
const mayuscula = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const listaZonas = () => TIENDA.delivery.zonas
  .map((z) => `${z.nombre}: ${soles(z.costo)}, ${z.horas}`)
  .join('. ');

const RESPUESTAS = {
  delivery: ({ texto = '' }) => {
    const destino = buscarDestino(texto);
    const recojo = TIENDA.delivery.recojoEnTienda ? ` o pasas por el puesto sin costo` : '';

    // Un distrito de Lima o del Callao: su zona, con su costo y su plazo.
    if (destino?.tipo === 'lima') {
      const z = destino.zona;
      const gratis = TIENDA.delivery.gratisDesde;
      return `A ${destino.distrito} sí llegamos: ${soles(z.costo)}, ${z.horas}. ` +
        (gratis > 0 ? `Si tu pedido pasa de ${soles(gratis)}, el envío va gratis. ` : '') +
        `¿Te lo mandamos${recojo}?`;
    }

    // Fuera de Lima, cotizarle tarifas de Lima es mentirle.
    if (destino?.tipo === 'provincia') {
      const pr = TIENDA.delivery.provincias;
      if (!pr.habilitado) {
        return 'Por ahora solo repartimos dentro de Lima; a provincias todavía no llegamos.';
      }
      return `${destino.nombre ? `A ${destino.nombre} s` : 'A provincia s'}í enviamos, por agencia ` +
        `(${pr.agencias.join(' o ')}), en ${pr.plazo}. ${mayuscula(pr.quienPaga)}, así que el costo depende ` +
        `del peso y de tu ciudad. ${mayuscula(pr.nota)}. Escríbenos al ${TIENDA.whatsapp} con tu pedido y te lo despachamos.`;
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
      '¿Qué estás buscando? Cuéntame y te oriento al toque.';
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
    // Las categorías y desde cuánto, sin contar productos: cuántos hay en
    // cada una es inventario, y no le suma nada a quien pregunta qué venden.
    const resumen = Object.entries(porCategoria)
      .map(([cat, ps]) => {
        const min = Math.min(...ps.map((p) => p.precio));
        return `${cat} (desde ${soles(min)})`;
      }).join(', ');
    return `Trabajamos ${resumen}. Puedes verlos todos con foto y precio en la tienda, ` +
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
      // Antes: «te paso el precio y cuántas tengo hoy». El stock no se dice.
      `Para pedidos grandes ${m.nota}, al ${TIENDA.whatsapp}. ` +
      '¿Qué producto buscas y cuántas unidades? Te paso el precio y te digo si te lo entrego todo de una vez.';
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
      // Antes decía «capaz la dosis o el momento del día no eran los
      // adecuados»: ajustar cuánto y cuándo tomar es una posología, justo lo
      // que el asesor no puede dar. La conversación va a la dueña, en persona.
      'Y si no notaste lo que esperabas, pásate por el local y lo conversamos con la dueña.';
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
 *
 * Lo importante no es el precio: es decir si se entrega todo HOY. Sin decir
 * cuantas hay: con «tengo 42» y «faltan 8» cualquiera lee el inventario
 * pidiendo una cotizacion. La cantidad exacta que sale ya se confirma por
 * WhatsApp, que es donde se cierra una venta de este tamaño.
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
    ? `Las ${c.cantidad} te las puedo entregar de inmediato.`
    : `Hoy no las tengo todas: una parte te la entrego de una vez y el resto ` +
      `llega en ${m.plazoReposicion}. Te confirmo por WhatsApp cuántas salen ya ` +
      `y lo separamos.`;

  const cierre = c.cantidad >= m.desde
    ? ` Para este volumen ${m.nota}, al ${TIENDA.whatsapp}.` +
      (TIENDA.comprobante.factura ? ' Va con factura si necesitas.' : '')
    : '';

  return `${p.nombre} (${p.presentacion}).\n\n${precio}\n\n${stock}${cierre}\n\n` +
    '¿Lo recoges en el puesto o te lo mandamos?';
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
