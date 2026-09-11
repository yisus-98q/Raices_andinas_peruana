/**
 * Asesor natural de Raiz Andina.
 *
 * Decision de diseno clave: el MOTOR DE REGLAS elige los productos, no el modelo.
 * Asi garantizamos que jamas se recomiende algo agotado, aunque la IA no responda.
 * El modelo solo redacta la explicacion sobre la lista que ya validamos contra stock.
 *
 * Si existe ANTHROPIC_API_KEY y el SDK esta instalado, la respuesta se redacta con
 * Claude. Si no, cae al texto armado por plantilla: la demo nunca se queda muda.
 */

import {
  detectarIntencion, detectarComparacion, responderIntencion,
  responderComparacion, contextoTienda, cotizar, responderCotizacion, RE_CODIGO,
} from './intenciones.js';
import { TIENDA } from './tienda.config.js';

const PLAZO_REPOSICION = TIENDA.politicas.mayorista.plazoReposicion;

const MODELO = 'claude-opus-5';

// Sinonimos coloquiales -> etiquetas del catalogo. Es lo que la gente escribe
// de verdad en el buscador, no el nombre tecnico del producto.
const SINONIMOS = {
  'no puedo dormir': 'dormir', 'no duermo': 'dormir', 'desvelo': 'dormir',
  'trasnocho': 'dormir', 'sueno': 'dormir', 'insomne': 'insomnio',
  'cansado': 'fatiga', 'cansada': 'fatiga', 'agotado': 'fatiga',
  'sin fuerzas': 'fatiga', 'decaido': 'fatiga', 'bajoneado': 'animo',
  'gastritis': 'gastritis', 'acidez': 'estomago', 'me cae mal': 'digestion',
  'empacho': 'digestion', 'lleno': 'gases', 'hinchado': 'hinchazon',
  'barriga': 'estomago', 'panza': 'estomago',
  'gripe': 'gripe', 'resfriado': 'resfrio', 'tos': 'tos', 'garganta': 'garganta',
  'defensas bajas': 'defensas', 'me enfermo': 'defensas',
  'dolor de rodilla': 'rodilla', 'rodillas': 'rodilla', 'huesos': 'huesos',
  'reuma': 'articulaciones', 'artrosis': 'articulaciones',
  'colesterol alto': 'colesterol', 'trigliceridos': 'trigliceridos',
  'bajar de peso': 'peso', 'adelgazar': 'adelgazar', 'grasa': 'grasa',
  'bajar kilos': 'peso', 'perder peso': 'peso', 'sobrepeso': 'peso',
  'estoy gordo': 'peso', 'estoy gorda': 'peso', 'panza grande': 'peso',
  'rinon': 'rinones', 'rinones': 'rinones', 'arenilla': 'calculos',
  'piedras': 'calculos', 'orinar': 'orina',
  'estres': 'estres', 'nervioso': 'nervios', 'ansiedad': 'ansiedad',
  'granos': 'acne', 'espinillas': 'acne', 'manchas': 'manchas',
  'cicatriz': 'cicatrices', 'arrugas': 'arrugas', 'estrias': 'estrias',
  'cabello': 'cabello', 'pelo': 'cabello', 'unas': 'unas',
  'anemia': 'anemia', 'hijo': 'ninos', 'hija': 'ninos', 'nino': 'ninos',
  'bebe': 'ninos', 'chico': 'ninos', 'diabetico': 'diabetes',
  'azucar alta': 'diabetes', 'presion': 'presion', 'memoria': 'memoria',
  'higado': 'higado', 'resaca': 'resaca', 'chuchaqui': 'resaca',
  'soroche': 'soroche', 'altura': 'altura', 'gimnasio': 'resistencia',
  'deporte': 'resistencia', 'embarazada': 'embarazo',
};

// Consultas que NO debe atender un asesor comercial. Se derivan a un profesional.
const DERIVAR = [
  'embarazo', 'embarazada', 'gestando', 'lactancia', 'dando de lactar',
  'cancer', 'tumor', 'quimioterapia', 'vih', 'sida', 'covid',
  'convulsion', 'epilepsia', 'infarto', 'derrame', 'trombosis',
  'anticoagulante', 'warfarina', 'quimio', 'dialisis', 'trasplante',
  'suicid', 'bebe de', 'recien nacido', 'meses de edad',
];

const normalizar = (t) =>
  t.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, ' ')   // fuera digitos: "bajar 10 kilos" -> "bajar kilos"
    .replace(/\s+/g, ' ')
    .trim();

const PALABRAS_VACIAS = new Set([
  'para', 'que', 'con', 'una', 'uno', 'los', 'las', 'del', 'por', 'mas',
  'muy', 'tengo', 'quiero', 'busco', 'necesito', 'algo', 'sirve', 'hay',
  'tienen', 'tiene', 'como', 'este', 'esta', 'pero', 'todo', 'bien', 'hola',
  'buenas', 'dias', 'tardes', 'noches', 'gracias', 'senor', 'senora',
  // Adjetivos y adverbios: describen la compra, no el producto. Si se cuelan,
  // "bajar de peso rapido" engancha con "cierra heridas rapido". Paso real.
  'rapido', 'rapida', 'rapidamente', 'barato', 'barata', 'baratos', 'economico',
  'economica', 'bueno', 'buena', 'buenos', 'mejor', 'fuerte', 'natural',
  'naturales', 'producto', 'productos', 'recomienda', 'recomiendas', 'recomiendan',
  'kilos', 'kilo', 'anos', 'edad', 'mama', 'papa', 'esposo', 'esposa', 'abuela',
  'abuelo', 'siempre', 'ahora', 'ayuda', 'ayude', 'efectivo', 'seguro',
]);

// Etiquetas de PUBLICO, no de sintoma. Acotan una recomendacion, pero por si
// solas no justifican ofrecer un producto: "gripe de mi hijo" no se resuelve
// con quinua solo porque la quinua sea buena para ninos.
const PUBLICO = new Set(['ninos', 'hombre', 'mujer', 'adulto', 'embarazo']);

// Lo que nos piden y no vendemos. Decirlo de frente vende mas que evadir.
const NO_TRABAJAMOS = {
  'cannabis': 'cannabis o derivados de cáñamo',
  'marihuana': 'cannabis o derivados de cáñamo',
  'cbd': 'aceites de CBD',
  'ayahuasca': 'preparados de ayahuasca',
  'san pedro': 'cactus san pedro',
  'antibiotico': 'medicamentos de farmacia',
  'pastilla': 'medicamentos de farmacia',
  'viagra': 'productos de farmacia',
  'anabolico': 'anabólicos ni esteroides',
  'esteroide': 'anabólicos ni esteroides',
};

// Cuando no hay ninguna senal, el vendedor de mostrador no se queda callado:
// ofrece los clasicos. Estos tres cubren el 60 % de las consultas del local.
const CLASICOS = ['MAC-001', 'MIE-001', 'MAN-001'];

/** Puntua cada producto en stock contra la consulta del cliente. */
export function motorReglas(consulta, productos) {
  const texto = normalizar(consulta);

  // 1. Expande la consulta con las etiquetas del catalogo.
  const senales = new Set();
  for (const [frase, etiqueta] of Object.entries(SINONIMOS)) {
    if (texto.includes(normalizar(frase))) senales.add(etiqueta);
  }
  const palabras = texto.split(' ').filter((p) => p.length > 3 && !PALABRAS_VACIAS.has(p));
  for (const p of palabras) senales.add(p);

  // 2. Puntua. Solo entran productos con stock real.
  //    Regla dura: un producto CALIFICA solo por su etiqueta o su nombre.
  //    El texto libre (descripcion, uso tradicional) suma puntos pero jamas
  //    hace entrar a un producto por si solo; ahi es donde nacian los falsos
  //    positivos del tipo "bajar de peso rapido" -> "cierra heridas rapido".
  const puntuados = [];
  for (const prod of productos) {
    if (prod.stock <= 0) continue;
    const etiquetas = prod.etiquetas.split(',').map((e) => normalizar(e));
    const nombre = normalizar(prod.nombre);
    const cuerpo = normalizar(prod.descripcion + ' ' + prod.uso_tradicional + ' ' + prod.categoria);

    let puntos = 0;
    let califica = false;
    const razones = [];

    for (const s of senales) {
      const esPublico = PUBLICO.has(s);

      if (etiquetas.includes(s)) {
        puntos += esPublico ? 3 : 10;
        razones.push(s);
        if (!esPublico) califica = true;          // sintoma real: entra
      } else if (s.length > 4 && etiquetas.some((e) => e.includes(s))) {
        puntos += esPublico ? 2 : 6;
        razones.push(s);
        if (!esPublico) califica = true;
      }

      if (s.length > 3 && nombre.includes(s)) {
        puntos += 8;
        califica = true;                          // pidio el producto por nombre
        razones.push(s);
      } else if (s.length > 4 && cuerpo.includes(s)) {
        puntos += 2;                              // refuerzo, nunca clasificacion
      }
    }

    if (califica) puntuados.push({ prod, puntos, razones: [...new Set(razones)] });
  }

  // Los formatos de prueba y los packs existen para quien ya conoce el
  // producto; ofrecerlos como primera respuesta a "me duele la rodilla" suena
  // a que le estan dando la muestra. Pierden el desempate, no desaparecen.
  const MARGINAL = /tamaño viaje|pack de 3|tamaño familiar/i;
  const grado = (p) => (MARGINAL.test(p.nombre) ? 1 : 0);

  // El relleno de demostracion va detras de todo lo demas, empate o no.
  // Los 400 productos generados existen para que el catalogo se vea lleno;
  // poner uno inventado por delante de algo que el negocio si tiene es
  // responder mal, por muchas etiquetas que coincidan. Y desdice el
  // argumento: la tienda vende el origen, y el relleno no tiene origen que
  // contar. En el catalogo del cliente no habra ninguno marcado y este
  // criterio se apaga solo.
  const relleno = (p) => (p.demo ? 1 : 0);

  puntuados.sort((a, b) => relleno(a.prod) - relleno(b.prod)
    || b.puntos - a.puntos
    || grado(a.prod) - grado(b.prod)
    || b.prod.stock - a.prod.stock);

  // Si pidio algo economico, reordena por precio entre los que ya calificaron.
  if (/\b(barat|economic|precio|plata|presupuesto)/.test(texto)) {
    puntuados.sort((a, b) => relleno(a.prod) - relleno(b.prod)
      || a.prod.precio - b.prod.precio);
  }

  return variar(puntuados, 3);
}

/**
 * Raiz del nombre: el insumo, sin la presentacion.
 *
 * "Romero en filtrantes", "Romero · extracto" y "Romero en gotas" son el mismo
 * romero. Los nombres se construyen como "<insumo> <sufijo>", y el sufijo
 * empieza por " en ", " · " o es una palabra final conocida.
 */
const PRESENTACION_FINAL = /\s(gelatinizada|pop|bebible|efervescente|roll-on)$/;

/**
 * Presentaciones en prefijo: "Crema de Una de Gato", "Tonico de Noni",
 * "Esencia de Muna". El generador arma los nombres como "<insumo> <sufijo>",
 * asi que estas no son presentaciones suyas sino insumos aparte del catalogo
 * — pero para el cliente que pregunta que le conviene siguen siendo la misma
 * planta. Se quitan para que la raiz sea el insumo y no el envase.
 *
 * Es lista blanca a proposito. "Cola de Caballo", "Miel de Abeja", "Diente de
 * Leon", "Sangre de Grado" y "Una de Gato" empiezan igual y NO son envases:
 * recortarlas dejaria raices absurdas como "caballo" o "grado".
 */
const PRESENTACION_INICIAL =
  /^(crema|tonico|jabon|gel|balsamo|shampoo|acondicionador|desodorante|jarabe|jugo|extracto|aceite|esencia) de /;

const raizDe = (nombre) => nombre
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(' · ')[0]
  .split(/ en /)[0]
  .replace(PRESENTACION_FINAL, '')
  .trim()
  .replace(PRESENTACION_INICIAL, '')
  .trim();

/**
 * Dos raices son el mismo insumo si una contiene a la otra entera.
 *
 * Comparar por igualdad no bastaba: "Magnesio" y "Magnesio Quelado" son dos
 * entradas distintas del catalogo, igual que "Una de Gato" y "Tonico de Una
 * de Gato". Para el sistema eran cosas diferentes; para quien pregunta que
 * tomar para la rodilla son la misma planta tres veces.
 *
 * Se compara por palabras completas —de ahi el acolchado con espacios— para
 * que nunca case a media palabra: "Muna" no es la raiz de "Munacuyki", ni
 * "Te" la de "Tomillo".
 */
const mismoInsumo = (a, b) =>
  (' ' + a + ' ').includes(' ' + b + ' ') || (' ' + b + ' ').includes(' ' + a + ' ');

/**
 * Tres recomendaciones que sean tres cosas distintas.
 *
 * Con el catalogo grande, el mejor puntaje se lo llevaban tres presentaciones
 * del mismo insumo: el cliente pregunta que le conviene y recibe la misma
 * hierba tres veces. Se toma la mejor de cada raiz y, solo si no alcanzan,
 * se completa con las repetidas antes que devolver menos opciones.
 */
function variar(puntuados, cuantos) {
  const elegidas = [];
  const primeras = [];
  const resto = [];

  for (const p of puntuados) {
    const raiz = raizDe(p.prod.nombre);
    if (elegidas.some((r) => mismoInsumo(r, raiz))) { resto.push(p); continue; }
    elegidas.push(raiz);
    primeras.push(p);
  }
  return [...primeras, ...resto].slice(0, cuantos);
}

/** Productos que existen pero estan agotados y si calzaban con la consulta. */
function agotadosRelevantes(consulta, productos) {
  const conStock = productos.filter((p) => p.stock > 0);
  const sinStock = productos.filter((p) => p.stock <= 0);
  if (!sinStock.length) return [];
  const falsos = motorReglas(consulta, sinStock.map((p) => ({ ...p, stock: 1 })));
  void conStock;
  return falsos.map((f) => f.prod.nombre);
}

/** Formato peruano: separador de miles, dos decimales, a prueba de NaN. */
const soles = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'S/ —';
  return 'S/ ' + v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const listar = (top) => top.map((t) =>
  `· ${t.prod.nombre} (${t.prod.presentacion}) — ${soles(t.prod.precio)}. ` +
  `De ${t.prod.origen}. ${t.prod.uso_tradicional}`).join('\n');

function respuestaPlantilla(top, derivar, agotados, noTrabajamos, esClasicos) {
  if (derivar) {
    return 'Por lo que me cuentas prefiero no recomendarte nada por mi cuenta: ' +
      'eso lo debe ver un medico o un nutricionista, porque algunos naturales ' +
      'interactuan con medicamentos. Con gusto te atendemos cuando tengas su indicacion.';
  }
  if (noTrabajamos) {
    return `No trabajamos ${noTrabajamos}, asi que no te lo puedo ofrecer. ` +
      'Lo nuestro son plantas, mieles y superalimentos peruanos. ' +
      'Si me cuentas que te pasa, veo si tengo algo que te sirva.';
  }
  if (!top.length) {
    return 'No encontre algo que calce bien con lo que me pides. ' +
      'Cuentame con mas detalle que sientes o desde cuando, y te oriento mejor. ' +
      'Tambien puedes escribirnos por WhatsApp y te atiende una persona del local.';
  }
  const encabezado = esClasicos
    ? 'Cuentame que necesitas y te oriento mejor. Mientras tanto, esto es lo que mas sale del mostrador:'
    : 'Para lo que me cuentas te sugiero:';
  const nota = agotados.length
    ? `\n\nAhora mismo no tenemos ${agotados.join(' ni ')}; te aviso apenas llegue.`
    : '';
  return `${encabezado}\n\n${listar(top)}${nota}` +
    '\n\nSon productos naturales, no reemplazan un tratamiento medico.';
}

/** Forma compacta del producto que consume el frontend. */
const fichaProducto = (p, razones = []) => ({
  id: p.id, sku: p.sku, nombre: p.nombre, emoji: p.emoji, imagen: p.imagen,
  precio: p.precio, presentacion: p.presentacion, origen: p.origen, stock: p.stock,
  motivo: razones.slice(0, 3).join(', '),
});

/** Punto unico de entrada. Nunca lanza: la tienda no se cae si la IA falla. */
export async function asesorar(consulta, productos, buscarPedido = null) {
  const texto = normalizar(consulta);
  const derivar = DERIVAR.some((t) => texto.includes(normalizar(t)));

  // --- Capa 1: intenciones de negocio. Van ANTES que los productos.
  // Un cliente que reclama un pedido demorado no quiere un catalogo.
  if (!derivar) {
    const comparacion = detectarComparacion(texto, productos, normalizar);
    if (comparacion) {
      return {
        // Sin la lambda, map pasaria el indice como `razones`.
        recomendaciones: comparacion.map((p) => fichaProducto(p)),
        agotados: [], derivar: false, no_trabajamos: null,
        intencion: 'comparacion', fuente: 'reglas',
        mensaje: responderComparacion(comparacion),
      };
    }

    // Cotizacion por cantidad: "cuanto me sale 50 bolsas de maca negra".
    // Va antes de las intenciones porque el mensaje suele traer tambien
    // palabras de regateo ("cuanto me dejas") y ahi la cifra es lo que importa.
    const cot = cotizar(consulta, productos);
    if (cot) {
      const base = {
        recomendaciones: [fichaProducto(cot.producto, ['cotizacion'])],
        agotados: [], derivar: false, no_trabajamos: null,
        intencion: 'cotizacion',
        cotizacion: {
          cantidad: cot.cantidad, descuento: cot.porcentaje,
          unitario: cot.unitario, total: cot.total,
          disponible: cot.disponible, faltan: cot.faltan,
        },
        fuente: 'reglas',
        mensaje: responderCotizacion(cot),
      };
      const redactado = await redactarConClaude(consulta, [], false, [], null, false,
        contextoTienda('cotizacion') +
        `\nCotizacion ya calculada (usa estas cifras exactas, no las recalcules):\n` +
        `- Producto: ${cot.producto.nombre} (${cot.producto.presentacion})\n` +
        `- Pide ${cot.cantidad} unidades; descuento aplicado ${cot.porcentaje}%\n` +
        `- Precio unitario con descuento S/ ${cot.unitario}, total S/ ${cot.total}\n` +
        `- Stock hoy: ${cot.producto.stock}. Entregables ya: ${cot.disponible}. ` +
        `Faltan: ${cot.faltan} (llegan en ${PLAZO_REPOSICION}).\n` +
        `Lo mas importante del mensaje es decirle cuantas hay hoy, sin adornos.`);
      if (redactado) { base.mensaje = redactado; base.fuente = 'claude'; }
      return base;
    }

    const intencion = detectarIntencion(texto);
    if (intencion) {
      // El reclamo consulta el pedido de verdad si viene el codigo.
      let pedido = null;
      const codigo = consulta.match(RE_CODIGO);
      if (intencion === 'reclamo' && codigo && buscarPedido) {
        pedido = buscarPedido(codigo[0].toUpperCase());
      }
      const base = {
        recomendaciones: [], agotados: [], derivar: false, no_trabajamos: null,
        intencion, pedido: pedido ? pedido.codigo : null, fuente: 'reglas',
        mensaje: responderIntencion(intencion, { pedido, texto, productos }),
      };
      const redactado = await redactarConClaude(consulta, [], false, [], null, false,
        // Al modelo tampoco se le pasan datos personales del pedido: si no los
        // tiene, no puede filtrarlos por mucho que se lo pidan en la consulta.
        contextoTienda(intencion) + (pedido
          ? `\nPedido del cliente: ${pedido.codigo}, estado ${pedido.estado}, ` +
            `del ${pedido.creado_en.slice(0, 10)}, total S/ ${pedido.total}.` +
            `\nNO menciones telefono ni direccion: no los tienes y no debes inventarlos.`
          : '\nNo tenemos el codigo del pedido; pideselo.'));
      if (redactado) { base.mensaje = redactado; base.fuente = 'claude'; }
      return base;
    }
  }

  // --- Capa 2: recomendacion de productos.

  const clave = Object.keys(NO_TRABAJAMOS).find((k) => texto.includes(normalizar(k)));
  const noTrabajamos = derivar ? null : (clave ? NO_TRABAJAMOS[clave] : null);

  let top = (derivar || noTrabajamos) ? [] : motorReglas(consulta, productos);
  const agotados = (derivar || noTrabajamos) ? [] : agotadosRelevantes(consulta, productos);

  // Sin senal alguna: ofrecemos los clasicos en vez de dejar al cliente sin nada.
  let esClasicos = false;
  if (!top.length && !derivar && !noTrabajamos) {
    top = CLASICOS
      .map((sku) => productos.find((p) => p.sku === sku && p.stock > 0))
      .filter(Boolean)
      .map((prod) => ({ prod, puntos: 0, razones: ['los mas pedidos'] }));
    esClasicos = top.length > 0;
  }

  const base = {
    recomendaciones: top.map((t) => fichaProducto(t.prod, t.razones)),
    agotados,
    derivar,
    no_trabajamos: noTrabajamos,
    sugerencia_general: esClasicos,
    fuente: 'reglas',
    mensaje: respuestaPlantilla(top, derivar, agotados, noTrabajamos, esClasicos),
  };

  const redactado = await redactarConClaude(consulta, top, derivar, agotados, noTrabajamos, esClasicos);
  if (redactado) {
    base.mensaje = redactado;
    base.fuente = 'claude';
  }
  return base;
}

const SISTEMA = `Eres el asesor de Raiz Andina, una tienda naturista peruana.
Hablas como un vendedor de mostrador con experiencia: calido, directo, sin floreo.

Reglas que no puedes romper:
1. Recomienda UNICAMENTE los productos de la lista que te doy. Esa lista ya fue
   filtrada contra el inventario real. Si la lista viene vacia, dilo con honestidad
   y ofrece que la persona cuente mas detalles; no inventes productos.
2. Nunca digas que un producto cura, trata o reemplaza un medicamento. Puedes
   contar el uso tradicional y para que lo llevan los clientes.
3. Cierra siempre recordando que son productos naturales y que ante un problema
   de salud hay que consultar a un profesional.
4. Menciona el origen del producto: es lo que nos diferencia de una farmacia.
5. Maximo 90 palabras. Sin listas con vinetas, escribe corrido y natural.
6. Precios en soles, tal como te los paso.
7. Si te paso datos de la tienda (horario, delivery, pago, politicas), responde con
   ESOS datos exactos. No inventes zonas, costos, plazos ni descuentos.
8. Si el cliente reclama o quiere devolver algo, primero reconoce el problema.
   No le ofrezcas comprar nada mas en esa misma respuesta.`;

async function redactarConClaude(consulta, top, derivar, agotados, noTrabajamos, esClasicos, negocio = null) {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    return null; // SDK no instalado: seguimos con el motor de reglas.
  }

  const catalogo = top.length
    ? top.map((t) =>
        `- ${t.prod.nombre} | ${t.prod.presentacion} | S/ ${t.prod.precio.toFixed(2)} | ` +
        `origen: ${t.prod.origen} | uso tradicional: ${t.prod.uso_tradicional} | ` +
        `quedan ${t.prod.stock} unidades`).join('\n')
    : '(sin coincidencias en stock)';

  const contexto = [
    'Consulta del cliente: ' + consulta,
    '',
    // Datos duros del negocio cuando la pregunta es de negocio, no de producto.
    negocio || 'Productos disponibles que calzan:',
    negocio ? '' : catalogo,
    agotados.length ? '\nAgotados hoy (mencionalo si viene al caso): ' + agotados.join(', ') : '',
    derivar ? '\nATENCION: el caso requiere derivar a un profesional de salud. No recomiendes productos.' : '',
    noTrabajamos ? `\nATENCION: el cliente pide ${noTrabajamos} y NO lo vendemos. Dilo de frente, sin rodeos, y ofrece orientarlo si cuenta que le pasa.` : '',
    esClasicos ? '\nNOTA: la consulta fue vaga. Estos no responden a un sintoma: son los mas pedidos del mostrador. Presentalos asi y pide que cuente mas.' : '',
  ].join('\n');

  try {
    const client = new Anthropic();
    const respuesta = await client.messages.create({
      model: MODELO,
      max_tokens: 1000,
      system: [{ type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: contexto }],
    });
    if (respuesta.stop_reason === 'refusal') return null;
    return respuesta.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim() || null;
  } catch (e) {
    console.warn('[asesor] Claude no respondio, uso el motor de reglas:', e.message);
    return null;
  }
}
