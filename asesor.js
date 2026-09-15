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
  distancia,
} from './intenciones.js';
import { TIENDA } from './tienda.config.js';

const PLAZO_REPOSICION = TIENDA.politicas.mayorista.plazoReposicion;

const MODELO = 'claude-opus-5';

// Sinonimos coloquiales -> etiquetas del catalogo. Es lo que la gente escribe
// de verdad en el buscador, no el nombre tecnico del producto.
//
// Solo bienestar. Aqui habia sinonimos que llevaban a etiquetas de enfermedad
// («azucar alta» -> diabetes, «piedras» -> calculos, «presion» -> presion): el
// motor los usaba para puntuar productos, justo lo que el asesor no debe hacer.
// Esas consultas ahora las ataja DERIVAR antes de llegar aqui, y las etiquetas
// clinicas salieron del catalogo.
const SINONIMOS = {
  'no puedo dormir': 'dormir', 'no duermo': 'dormir', 'desvelo': 'dormir',
  'trasnocho': 'dormir', 'sueno': 'dormir', 'insomne': 'insomnio',
  'cansado': 'fatiga', 'cansada': 'fatiga', 'agotado': 'fatiga',
  'sin fuerzas': 'fatiga', 'decaido': 'fatiga', 'bajoneado': 'animo',
  'acidez': 'estomago', 'me cae mal': 'digestion',
  'empacho': 'digestion', 'lleno': 'gases', 'hinchado': 'hinchazon', 'hinchada': 'hinchazon',
  'me despierto': 'dormir', 'desvelad': 'dormir', 'sin ganas': 'fatiga', 'rendir': 'energia',
  'barriga revuelta': 'digestion', 'estomago revuelto': 'digestion',
  'despues de almorzar': 'digestion', 'despues de comer': 'digestion', 'despues de la comida': 'digestion',
  'barriga': 'estomago', 'panza': 'estomago',
  'gripe': 'gripe', 'resfriado': 'resfrio', 'tos': 'tos', 'garganta': 'garganta',
  'defensas bajas': 'defensas', 'me enfermo': 'defensas',
  'dolor de rodilla': 'rodilla', 'rodillas': 'rodilla', 'huesos': 'huesos',
  'bajar de peso': 'peso', 'adelgazar': 'adelgazar', 'grasa': 'grasa',
  'bajar kilos': 'peso', 'perder peso': 'peso', 'sobrepeso': 'peso',
  'estoy gordo': 'peso', 'estoy gorda': 'peso', 'panza grande': 'peso',
  'estres': 'estres', 'nervioso': 'nervios', 'ansiedad': 'ansiedad',
  'granos': 'acne', 'espinillas': 'acne', 'manchas': 'manchas',
  'cicatriz': 'cicatrices', 'arrugas': 'arrugas', 'estrias': 'estrias',
  'cabello': 'cabello', 'pelo': 'cabello', 'unas': 'unas',
  'hijo': 'ninos', 'hija': 'ninos', 'nino': 'ninos', 'chico': 'ninos',
  'memoria': 'memoria', 'resaca': 'resaca', 'chuchaqui': 'resaca',
  'soroche': 'soroche', 'altura': 'altura', 'gimnasio': 'resistencia',
  'deporte': 'resistencia',

  // Como lo dice la gente, sacado del banco de consultas reales. Cada una de
  // estas caía en «no te entendí».
  'nerviosa': 'nervios', 'nervios': 'nervios', 'relaj': 'relajante', 'tranquil': 'relajante',
  'cae pesad': 'digestion', 'comida pesada': 'digestion', 'pesadez': 'pesadez',
  'estrenid': 'estrenimiento', 'no voy al bano': 'estrenimiento',
  'fuerzas': 'energia', 'energia': 'energia', 'decaida': 'fatiga', 'desganad': 'fatiga',
  'bajonead': 'animo', 'triste': 'animo', 'desanimad': 'animo',
  'concentr': 'concentracion', 'estudi': 'estudio', 'olvido': 'memoria',
  // «entren» a secas vive dentro de «encuentren».
  'gym': 'resistencia', 'entrenar': 'resistencia', 'entreno': 'resistencia', 'entrenamiento': 'resistencia',
  'granitos': 'acne', 'barros': 'acne', 'cara': 'rostro',
  'reseca': 'seca', 'resequedad': 'seca',
  'caspa': 'caspa', 'se me cae el pelo': 'caida', 'se me cae el cabello': 'caida', 'crezca': 'crecimiento',
  'quebradiz': 'quebradizo',
  'dolor de espalda': 'espalda', 'espalda': 'espalda', 'moreton': 'moretones', 'golpe': 'golpes',
  'calambre': 'calambres', 'piernas cansadas': 'piernas', 'crujen': 'articulaciones',
  'mal aliento': 'aliento', 'aliento': 'aliento', 'encias': 'encias',
  'labios partidos': 'labios', 'labios': 'labios',
  'menopausia': 'menopausia', 'bochorno': 'sofocos',
  'dolor de cabeza': 'dolor de cabeza', 'jaqueca': 'dolor de cabeza',
};

/**
 * Palabras de envase, no de producto. «quiero propóleo en gotas» traía la
 * Esencia de Romero en gotas porque «gotas» está en su nombre. Suman para
 * desempatar dentro de lo que ya calificó, pero no hacen entrar a nadie.
 */
const PRESENTACIONES = new Set([
  'gotas', 'gotero', 'capsulas', 'capsula', 'polvo', 'filtrantes', 'sachets', 'sachet',
  'spray', 'crema', 'jarabe', 'aceite', 'extracto', 'tabletas', 'botella', 'frasco',
  'bolsa', 'hojuelas', 'harina', 'grano', 'semilla', 'caramelos', 'ampollas', 'bebible',
  // Lo que acompaña a la presentación: «hoja seca», «semilla tostada», «pack de
  // 3», «tamaño familiar». «piel seca» traía Matico · hoja seca.
  'seca', 'seco', 'tostada', 'tamano', 'familiar', 'viaje', 'pack', 'grande',
]);

/** Las claves de una sola palabra, normalizadas, y las frases de más largas a
 *  más cortas: «piernas cansadas» tiene que ganarle a «cansada». */
const CLAVES_SINONIMOS = Object.keys(SINONIMOS)
  .map((k) => k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  .filter((k) => !k.includes(' ') && k.length >= 4);
const FRASES_SINONIMOS = Object.entries(SINONIMOS).sort((a, b) => b[0].length - a[0].length);

/** El nombre pedido por palabra entera, o por el comienzo si es largo. «cara»
 *  ya no entra en «Sauco en caramelos». */
const nombreTiene = (palabrasNombre, s) =>
  palabrasNombre.some((w) => w === s || (s.length >= 5 && w.startsWith(s)));

/**
 * Consultas que NO atiende un asesor comercial. Se derivan a un profesional.
 *
 * Un producto natural no puede promocionarse como que previene, trata o cura
 * una enfermedad, y decir que tomar y cuanto es una posologia. Un asistente que
 * recibe un diagnostico y devuelve un producto hace exactamente eso, por
 * escrito y guardado en un servidor.
 *
 * Las cronicas son la parte que faltaba, y es la que mas llega al mostrador.
 * No estan por prudencia legal: estan porque son justo las que se manejan con
 * medicacion diaria que interactua. Yacon a alguien que se inyecta insulina, o
 * hierba de San Juan a quien toma antidepresivos o anticonceptivos, es un dano
 * posible y no un tecnicismo.
 *
 * Lo que NO entra aqui: descanso, digestion, energia, animo, defensas. Son
 * categorias de bienestar y el asesor las responde con normalidad. La linea
 * esta en nombrar una enfermedad, un medicamento o un embarazo.
 *
 * La primera version solo reconocia la palabra tecnica, y la gente no habla
 * asi: «tengo el azucar alta» recibia Yacon, «mi bebe tiene tos» recibia miel
 * (riesgo de botulismo antes del año), «tengo dolor de pecho» recibia Copaiba
 * y «tomo sertralina» recibia Valeriana. Por eso ahora hay tres grupos mas:
 * sintomas de alarma, el medicamento dicho por su nombre comercial o generico,
 * y el embarazo o el bebe dichos con otras palabras.
 */
const DERIVAR = [
  // Embarazo y lactancia. «embaraz» es prefijo a proposito: embarazo,
  // embarazada, embarazadas. «lact» no, porque atraparia «lacteos».
  'embaraz', 'gestando', 'gestacion', 'gestante', 'encinta',
  'lactancia', 'lactando', 'lactar', 'amamant',
  'dar pecho', 'doy pecho', 'dando pecho',
  'recien nacido', 'meses de edad', 'meses de nacid', 'lactante',

  // Sintomas de alarma: no son un malestar para una infusion, son una
  // emergencia posible. Recomendar un aceite a un dolor de pecho es el peor
  // error que puede cometer el asesor.
  'dolor de pecho', 'dolor en el pecho', 'dolor al pecho', 'me duele el pecho',
  'opresion en el pecho', 'presion en el pecho', 'pecho apretado',
  'falta de aire', 'me falta el aire', 'me ahogo', 'ahogo', 'no puedo respirar',
  'dificultad para respirar', 'desmay', 'perdi el conocimiento',
  'palpitacion', 'taquicardia', 'arritmia',
  'sangra', 'con sangre', 'sangre en', 'fiebre',
  'hormigueo', 'adormecimiento', 'paralisis', 'boca torcida',
  'intoxic', 'envenen', 'sobredosis', 'reaccion alergica', 'anafilax',

  // Cuadros graves y tratamientos que interactuan.
  'cancer', 'tumor', 'quimioterapia', 'quimio', 'vih', 'sida', 'covid',
  'convulsion', 'epilepsia', 'infarto', 'derrame', 'trombosis',
  'anticoagula', 'warfarina', 'dialisis', 'trasplante', 'suicid',

  // Cronicas: se manejan con medicacion diaria. Tambien dichas como las dice
  // el cliente, no solo como las escribe el medico.
  'diabetes', 'diabetico', 'diabetica', 'insulina', 'metformina',
  'azucar alta', 'azucar en la sangre', 'glucosa', 'prediabet',
  'hipertension', 'hipertenso', 'hipotension', 'presion alta', 'presion baja',
  'presion arterial', 'problemas de presion', 'problema de presion',
  'para la presion', 'sube la presion', 'baja la presion',
  'cardiac', 'cardiopat', 'del corazon', 'el corazon', 'mi corazon', 'al corazon',
  'gastritis', 'ulcera', 'colitis', 'reflujo', 'colon irritable', 'crohn',
  'helicobacter', 'hernia',
  'artritis', 'artrosis', 'reuma', 'osteoporosis', 'fibromialgia', 'lupus',
  'acido urico', 'colesterol', 'trigliceridos',
  'tiroides', 'hipotiroidismo', 'hipertiroidismo', 'levotiroxina',
  'asma', 'bronquitis', 'neumonia', 'tuberculosis', 'sinusitis',
  'anemia', 'higado graso', 'hepat', 'cirrosis', 'vesicula',
  'rinon', 'renal', 'calculos', 'piedras en', 'arenilla', 'infeccion', 'cistitis',
  'prostata', 'hemorroid', 'varices', 'migrana',
  'quiste', 'mioma', 'endometriosis', 'poliquist', 'infertil',
  'disfuncion erectil', 'impotencia',
  'psoriasis', 'dermatitis', 'eccema', 'eczema', 'herpes',
  'alzheimer', 'parkinson', 'demencia', 'esclerosis',
  'depresion', 'antidepresivo', 'anticonceptivo', 'litio',

  // El medicamento. Ante cualquier medicacion el asesor no puede saber si hay
  // interaccion, asi que no adivina: la lista de genericos es la del
  // mostrador peruano, y lo que no este aqui lo atrapan los patrones de abajo
  // («tomo pastillas para…», «me recetaron…»).
  'medicament', 'medicacion', 'medicad', 'farmaco', 'doctor', 'medico',
  'recetad', 'recetaron', 'me receto', 'receta medica',
  'tratamiento medico', 'en tratamiento', 'pastillas para', 'pastilla para',
  'sertralina', 'fluoxetina', 'escitalopram', 'citalopram', 'paroxetina',
  'venlafaxina', 'amitriptilina', 'clonazepam', 'alprazolam', 'diazepam',
  'lorazepam', 'bromazepam', 'benzodiazep', 'ansiolitic', 'antipsicotic',
  'quetiapina', 'risperidona', 'olanzapina', 'carbamazepina', 'valproato',
  'acido valproico', 'fenitoina', 'levetiracetam', 'anticonvulsiv',
  'glibenclamida', 'losartan', 'enalapril', 'captopril', 'amlodipino',
  'nifedipino', 'atenolol', 'propranolol', 'carvedilol', 'bisoprolol',
  'hidroclorotiazida', 'furosemida', 'espironolactona', 'diuretic', 'digoxina',
  'acenocumarol', 'clopidogrel', 'aspirina', 'rivaroxaban', 'apixaban',
  'dabigatran', 'heparina', 'atorvastatina', 'simvastatina', 'rosuvastatina',
  'estatina', 'omeprazol', 'pantoprazol', 'esomeprazol', 'ranitidina',
  'prednison', 'dexametasona', 'corticoid', 'ibuprofeno', 'naproxeno',
  'diclofenaco', 'ketorolaco', 'paracetamol', 'antiinflamatori',
  'antihistamin', 'loratadina', 'cetirizina', 'tamoxifeno', 'sildenafil',
  'tadalafil',
];

/**
 * Lo que una lista de palabras no alcanza a decir.
 *
 * - El bebe, con articulo o diminutivo. «bebe» a secas no sirve: tambien es el
 *   verbo, y «como se bebe la muña» no tiene por que derivar. Tampoco sirve
 *   «para bebe…», que atrapa «para beber».
 * - La edad en meses. `normalizar` quita los digitos, asi que «mi hijo de 8
 *   meses» llega como «mi hijo de meses».
 * - El embarazo dicho como espera: «estoy esperando mi primer hijo».
 * - Tomar pastillas o antibioticos. «Antibiotico» solo, sin «tomo», sigue
 *   yendo a «no trabajamos medicamentos de farmacia».
 * - La gota, que como palabra suelta chocaria con «gotas» del propoleo.
 */
const DERIVAR_PATRONES = [
  // El lookbehind salva «se la bebe caliente» y «te la bebes de noche».
  /(?<!\b(se|te|me)\s)\b(mi|mis|el|la|los|las|un|una|su|sus|al|del|tu|tus|nuestro|nuestra)\s+beb(e|es|ito|ita|itos|itas)\b/,
  /\bbebit[oa]s?\b/,
  /\b(hij|niet|sobrin|nin|bebe)\w*\s+de\s+(un\s+|pocos\s+)?mes(es)?\b/,
  /\besper\w*\s+(a\s+)?(mi\s+|un\s+|una\s+)?(primer\s+|primera\s+|segundo\s+|segunda\s+)?(bebe|hij)/,
  /\b(tomo|toma|tomas|tomamos|toman|tomando|tomaba|tome|estoy\s+con|me\s+dieron|le\s+dieron)\b(\s+\w+){0,3}\s+(pastilla|pildora|antibiotic|comprimido|inyecc)/,
  /\b(tengo|tiene|con|de\s+la|ataque\s+de)\s+gota\b/,
  // El pecho con palabras de por medio: «me dio un dolor fuerte en el pecho»
  // no derivaba porque «fuerte» separaba «dolor» de «pecho». Encontrado con
  // frases de control que no se habían usado para ajustar la lista.
  /\b(dolor|duele|duelen|dolio|apret\w*|presion|opresion|punzada)(\s+\w+){0,4}\s+(el\s+|la\s+|al\s+|en\s+el\s+)?pecho\b/,
  /\bpecho(\s+\w+){0,3}\s+(me\s+)?(duele|dolio|aprieta|apretado|oprime)\b/,
];

/**
 * Pregunta por cantidades: «cuanta muña tomo al dia», «cada cuanto», «dosis».
 *
 * No se deriva: quien pregunta como se usa la manzanilla no esta enfermo. Pero
 * decir cuanto tomar es una posologia, asi que la respuesta lo dice de frente y
 * manda a la indicacion del envase en vez de callarse o, peor, inventar.
 */
/**
 * «¿Cuántas valerianas les quedan?», «¿hay maca?», «¿tienen stock de propóleo?».
 *
 * La pregunta se responde —sí hay, u hoy no— pero nunca con la cifra: el
 * inventario es información del negocio. Antes se contestaba con una lista de
 * productos, como si no hubiera preguntado nada.
 */
const PREGUNTA_STOCK = /\b(cuant[oa]s?(\s+\w+){0,3}\s+(quedan?|tienen|tienes|hay)|hay\s+stock|tienen\s+stock|tienes\s+stock|stock\s+de|(te|les)\s+quedan?|todavia\s+(tienen|tienes|hay|queda)|esta\s+disponible|estan\s+disponibles|tienen\s+disponible)\b|^(hay|tienen|tienes|tendran|tendras|quedan?)\s/;

/**
 * «Tienen moringa»: el cliente nombró algo concreto. Si no está en el
 * catálogo se le dice de frente, en vez de un «no te entendí» que le hace
 * pensar que escribió mal. Solo con verbo de pedido: una palabra suelta que no
 * se reconoce sigue siendo «¿qué estás buscando?».
 */
const PIDE_PRODUCTO = /^(tienen|tienes|tiene|tendran|tendras|hay|venden|vendes|manejan|busco|quiero|necesito|me vendes|consigo)\s+(.+)$/;
const NO_ES_PRODUCTO = /^(algo|nada|cosas?|productos?|stock|precio|descuento|delivery|envio|local|tienda|whatsapp|yape|factura|boleta|oferta|promocion|tiempo|ganas|dolor|problemas?)\b/;

function productoPedido(texto) {
  const m = texto.match(PIDE_PRODUCTO);
  if (!m) return null;
  const frase = m[2]
    .replace(/^(stock\s+de\s+|de\s+|el\s+|la\s+|los\s+|las\s+|un\s+|una\s+|unos\s+|unas\s+)+/, '')
    .split(/\s+(para|que|pero|porque|por favor|ahora|hoy|todavia)\b/)[0]
    .split(' ').slice(0, 3).join(' ').trim();
  if (frase.length < 3 || NO_ES_PRODUCTO.test(frase)) return null;
  return frase;
}

const PIDE_DOSIS = new RegExp([
  '\\b(dosis|posologia)\\b',
  '\\bcada\\s+cuanto\\b',
  '\\bpor\\s+cuanto\\s+tiempo\\b',
  '\\bcuant[oa]s?\\s+(capsulas|gotas|cucharad\\w*|tazas|veces|tabletas|sobres)\\b',
  '\\bcuant[oa]s?\\b(\\s+\\w+){0,3}\\s+(tomo|tomar|tomas|debo|le\\s+doy|se\\s+toma)\\b',
  '\\b(tomo|tomar)\\b(\\s+\\w+){0,3}\\s+(al|por)\\s+dia\\b',
].join('|'));

const normalizar = (t) =>
  t.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, ' ')   // fuera digitos: "bajar 10 kilos" -> "bajar kilos"
    .replace(/\s+/g, ' ')
    .trim();

/**
 * El termino tiene que empezar palabra, no aparecer en cualquier sitio.
 *
 * Se comparaba con `includes` a secas y «tengo una necesidad» derivaba por
 * SIDA: la palabra lleva «sida» dentro. A alguien que solo queria comprar se le
 * respondia que fuera al medico. Con las cronicas el problema se multiplicaba
 * —«asma» vive dentro de «plasma» y de «fantasma»—, asi que el arreglo va
 * primero.
 *
 * Se ancla solo el principio: los terminos que son prefijo a proposito siguen
 * funcionando («suicid» atrapa suicidio y suicidarse, «quimio» atrapa
 * quimioterapia, «asma» atrapa asmatico).
 */
const DERIVAR_RE = new RegExp(
  '\\b(' + DERIVAR.map((t) => normalizar(t).replace(/ /g, '\\s+')).join('|') + ')');

/**
 * La consulta como llega por WhatsApp, pasada a español de diccionario.
 *
 * «q tienen pa la tos d mi hijo x fa», «toy embarasada», «holaaa»: el motor
 * busca «que», «para», «estoy». Sin esto la mitad de lo que escribe un cliente
 * real caía en «no te entendí» — y lo peor, «toy embarazada» no derivaba.
 *
 * Solo palabras enteras. Los límites se miran con letras Unicode y no con `\b`,
 * que en JavaScript cree que «é» corta la palabra: «me dé fuerzas» se volvía
 * «me deé fuerzas». El guion también cuenta como parte de la palabra, para no
 * tocar la «X» de un código de pedido RA-…-X1B.
 */
const palabraSuelta = (alternativas) =>
  new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${alternativas})(?![\\p{L}\\p{N}_-])`, 'giu');
const JERGA = [
  [palabraSuelta('x\\s?fa|xfa|xfavor|porfa|porfis'), 'por favor'],
  [palabraSuelta('q|k|ke|qe'), 'que'],
  [palabraSuelta('x'), 'por'],
  [palabraSuelta('pa|pal'), 'para'],
  [palabraSuelta('d'), 'de'],
  [palabraSuelta('toy'), 'estoy'],
  [palabraSuelta('tas'), 'estas'],
  [palabraSuelta('sta'), 'esta'],
  [palabraSuelta('stan'), 'estan'],
  [palabraSuelta('bb|bebeee?'), 'bebe'],
  [palabraSuelta('tb|tmb|tbn'), 'tambien'],
  [palabraSuelta('xq|pq|xk'), 'porque'],
  [palabraSuelta('nd'), 'nada'],
  [palabraSuelta('aki'), 'aqui'],
  [palabraSuelta('kiero|kero'), 'quiero'],
  [palabraSuelta('dnd'), 'donde'],
  [palabraSuelta('cn'), 'con'],
  [palabraSuelta('grax|grs|grcs|graci'), 'gracias'],
  [palabraSuelta('contraentrega'), 'contra entrega'],
  // Nombres de producto que se escriben de oído y ninguna distancia de
  // letras arregla: «drago» y «grado» difieren en dos, y «drago» es la palabra
  // que la mitad de Lima usa.
  [palabraSuelta('sangre\\s+de\\s+drago'), 'sangre de grado'],
];

export function expandirJerga(consulta) {
  let t = String(consulta ?? '');
  // «holaaaa» -> «hola», «noooo» -> «no». Tres o más iguales se vuelven una;
  // al final de palabra, dos vocales iguales también («holaa»). La «e» no:
  // «cree» y «lee» son palabras.
  t = t.replace(/(\p{L})\1{2,}/gu, '$1').replace(/([aiou])\1(?![\p{L}])/giu, '$1');
  for (const [re, por] of JERGA) t = t.replace(re, por);
  return t;
}

/**
 * La derivación no puede depender de la ortografía.
 *
 * «embarasada», «diabetis»: quien escribe así no está menos embarazada. Dos
 * redes, las dos sobre términos de DERIVAR y nunca sobre el catálogo:
 *
 * - Fonética de oído: v/b, z/s, ce-ci/se-si, ll/y. La «h» no se toca: «vih»
 *   sin hache queda en «bi», y eso vive dentro de «bien».
 * - Una letra de más, de menos o cambiada, solo en palabras largas y
 *   específicas: con términos cortos o prefijos («sangra») una letra de
 *   distancia ya es otra palabra («sangre» de grado).
 */
const fonetico = (t) => t.replace(/v/g, 'b').replace(/z/g, 's').replace(/c([ei])/g, 's$1').replace(/ll/g, 'y');
const DERIVAR_FON_RE = new RegExp(
  '\\b(' + DERIVAR.map((t) => fonetico(normalizar(t)).replace(/ /g, '\\s+')).join('|') + ')');

const DERIVAR_LARGAS = [
  'diabetes', 'diabetico', 'diabetica', 'gastritis', 'hipertension', 'hipertenso',
  'colesterol', 'trigliceridos', 'artritis', 'artrosis', 'osteoporosis', 'tiroides',
  'epilepsia', 'prostata', 'hepatitis', 'cirrosis', 'depresion', 'warfarina',
  'insulina', 'metformina', 'lactancia', 'embarazada', 'embarazo', 'infeccion',
  'quimioterapia', 'anticonceptivo', 'antidepresivo', 'medicamento', 'medicamentos',
];

const derivaPorErrata = (texto) => texto.split(' ').some((w) => w.length >= 6
  && DERIVAR_LARGAS.some((t) => t[0] === w[0] && distancia(w, t, t.length >= 10 ? 2 : 1) <= (t.length >= 10 ? 2 : 1)));

/** Si la consulta (ya normalizada) cae del lado de la derivacion. */
export const hayQueDerivar = (texto) =>
  DERIVAR_RE.test(texto)
  || DERIVAR_PATRONES.some((re) => re.test(texto))
  || DERIVAR_FON_RE.test(fonetico(texto))
  || derivaPorErrata(texto);

/**
 * Erratas en nombres de producto: «maka», «hercanpuri», «colageno hidrolisado».
 *
 * Se corrige contra el vocabulario del propio catálogo —palabras de nombres y
 * etiquetas—, así que nunca aparece una palabra que la tienda no tenga. Solo
 * se cambia una palabra que no existe en el catálogo y tiene UN candidato
 * claro: con dos a la misma distancia, no se adivina.
 */
const vocabularios = new WeakMap();
function vocabularioDe(productos) {
  let v = vocabularios.get(productos);
  if (!v) {
    v = new Set();
    for (const p of productos) {
      for (const w of normalizar(`${p.nombre} ${p.etiquetas}`).split(' ')) if (w.length >= 4) v.add(w);
    }
    vocabularios.set(productos, v);
  }
  return v;
}

const NO_CORREGIR = new Set([
  'tienen', 'tienes', 'quiero', 'estoy', 'tengo', 'ando', 'algo', 'para', 'cuanto', 'cuanta',
  'precio', 'donde', 'queda', 'gracias', 'hola', 'buenas', 'dolor', 'duele', 'duelen', 'mucho',
  // Palabras de todos los días que están a una letra de algo del catálogo:
  // «cada» se «corregía» a «caida» y quien se despertaba de noche recibía
  // productos para la caída del cabello.
  'cada', 'rato', 'vida', 'pelo', 'poco', 'hace', 'veces', 'luego', 'ganas', 'rendir',
  'nada', 'todo', 'cara', 'casa', 'mama', 'papa', 'hijo', 'hija', 'bebe', 'dias', 'noche',
  'noches', 'pedido', 'llega', 'envio', 'mandan', 'yape', 'plin', 'boleta', 'factura',
  'mayor', 'rebaja', 'original', 'venden', 'vendes', 'hacen', 'puedo', 'pagar', 'recoger',
]);

export function corregirErratas(consulta, productos) {
  const vocab = vocabularioDe(productos);
  const plano = String(consulta).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return plano.replace(/[a-z]{4,}/g, (w) => {
    if (vocab.has(w) || NO_CORREGIR.has(w) || PALABRAS_VACIAS.has(w)) return w;
    // Una palabra que el asesor ya entiende no es una errata: «reseca» se
    // «corregía» a «resaca» y la piel seca recibía boldo.
    if (CLAVES_SINONIMOS.some((k) => w.startsWith(k) || k.startsWith(w))) return w;
    // La «e» de adelante que se come el oído: «spirulina», «sencia». Sin esto
    // el asesor respondía «no trabajamos spirulina» teniendo Espirulina: decir
    // que no se vende algo que sí se vende es peor que no entender.
    if (/^s[bcdfgklmnpqrtv]/.test(w) && vocab.has('e' + w)) return 'e' + w;
    const variantes = /^s[bcdfgklmnpqrtv]/.test(w) ? [w, 'e' + w] : [w];
    const max = w.length >= 8 ? 2 : 1;
    let mejor = null;
    let mejorD = max + 1;
    let empate = false;
    for (const c of vocab) {
      for (const v of variantes) {
        if (c[0] !== v[0]) continue;
        const d = distancia(v, c, max);
        if (d < mejorD) { mejor = c; mejorD = d; empate = false; } else if (d === mejorD && c !== mejor) empate = true;
      }
    }
    return mejor && mejorD <= max && !empate ? mejor : w;
  });
}

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
const PUBLICO = new Set(['ninos', 'hombre', 'mujer', 'adulto']);

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


/** Puntua cada producto en stock contra la consulta del cliente. */
export function motorReglas(consulta, productos) {
  const texto = normalizar(consulta);

  // 1. Expande la consulta con las etiquetas del catalogo.
  const senales = new Set();
  // De la frase más larga a la más corta, y cada una se «come» su pedazo: en
  // «piernas cansadas» ya no queda «cansada» suelta para sumar fatiga y traer maca.
  let resto = ` ${texto} `;
  for (const [frase, etiqueta] of FRASES_SINONIMOS) {
    const f = normalizar(frase);
    if (resto.includes(f)) {
      senales.add(etiqueta);
      resto = resto.replace(f, ' ');
    }
  }
  const palabras = texto.split(' ').filter((p) => p.length > 3 && !PALABRAS_VACIAS.has(p));
  for (const p of palabras) senales.add(p);

  // Nombre a medio escribir: «uña de gat» es el comienzo de «Uña de Gato». Se
  // completa solo si la consulta entera, sin «tienen» ni «quiero», es el
  // arranque de un nombre y tiene al menos dos palabras.
  // Solo se quitan las muletillas del principio; «una» no, que es el comienzo
  // de «Uña de Gato».
  const pedido = texto.replace(/^((tienen|tienes|tiene|hay|quiero|busco|necesito|venden|vendes|dame|deme|me|das|algo|de)\s+)+/, '');
  if (pedido.includes(' ') && pedido.length >= 6) {
    for (const prod of productos) {
      const n = normalizar(prod.nombre);
      if (n.startsWith(pedido)) {
        for (const w of n.split(' ').slice(0, pedido.split(' ').length)) if (w.length > 3) senales.add(w);
      }
    }
  }

  // 2. Puntua. Solo entran productos con stock real.
  //    Regla dura: un producto CALIFICA solo por su etiqueta o su nombre.
  //    El texto libre (descripcion, uso tradicional) suma puntos pero jamas
  //    hace entrar a un producto por si solo; ahi es donde nacian los falsos
  //    positivos del tipo "bajar de peso rapido" -> "cierra heridas rapido".
  const puntuados = [];
  for (const prod of productos) {
    if (prod.stock <= 0) continue;
    const etiquetas = prod.etiquetas.split(',').map((e) => normalizar(e));
    const palabrasNombre = normalizar(prod.nombre).split(' ');
    const cuerpo = normalizar(prod.descripcion + ' ' + prod.uso_tradicional + ' ' + prod.categoria);

    let puntos = 0;
    let califica = false;
    let porNombre = false;
    const razones = [];

    for (const s of senales) {
      const esPublico = PUBLICO.has(s);
      const esEnvase = PRESENTACIONES.has(s);

      if (etiquetas.includes(s)) {
        puntos += esPublico ? 3 : 10;
        razones.push(s);
        if (!esPublico) califica = true;          // sintoma real: entra
      } else if (s.length > 4 && etiquetas.some((e) => e.includes(s))) {
        puntos += esPublico ? 2 : 6;
        razones.push(s);
        if (!esPublico) califica = true;
      }

      if (s.length > 3 && nombreTiene(palabrasNombre, s)) {
        if (esEnvase) {
          puntos += 3;                            // desempata, no clasifica
        } else {
          puntos += 8;
          califica = true;                        // pidio el producto por nombre
          porNombre = true;
          razones.push(s);
        }
      } else if (s.length > 4 && cuerpo.includes(s)) {
        puntos += 2;                              // refuerzo, nunca clasificacion
      }
    }

    if (califica) puntuados.push({ prod, puntos, porNombre, razones: [...new Set(razones)] });
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

  // Lo que se pidió por nombre va primero, y entero. «les queda miel de
  // eucalipto?» abría con la Multifloral —curada, así que ganaba al relleno—
  // cuando la que tiene las dos palabras es la Miel de Eucalipto. Solo cuentan
  // las palabras que son nombre de algún producto: en «no puedo dormir» no hay
  // ninguna y el orden queda como estaba.
  const palabrasDeNombre = palabras.filter((w) => !PRESENTACIONES.has(w)
    && productos.some((p) => nombreTiene(normalizar(p.nombre).split(' '), w)));
  const completo = (p) => (palabrasDeNombre.length
    && palabrasDeNombre.every((w) => nombreTiene(normalizar(p.nombre).split(' '), w)) ? 1 : 0);

  puntuados.sort((a, b) => completo(b.prod) - completo(a.prod)
    || relleno(a.prod) - relleno(b.prod)
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
  .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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

// «De Formulado en Lima» no es castellano: el origen de un formulado va sin «de».
const origenDe = (o) => (/^formulado/i.test(o) ? o.charAt(0).toLowerCase() + o.slice(1) : `de ${o}`);

// Corto: nombre, presentación, precio y de dónde viene. El uso tradicional ya
// está en la tarjeta del catálogo; en el chat alargaba la respuesta al triple.
const listar = (top) => top.map((t) =>
  `· ${t.prod.nombre} (${t.prod.presentacion}) — ${soles(t.prod.precio)}, ${origenDe(t.prod.origen)}.`).join('\n');

// Lo que el cliente lee va con tildes. Sin ellas «la dueña lleva años en esto»
// salia como «lleva anos en esto», en la respuesta que mas se muestra en la demo.
const AVISO_DOSIS =
  '\n\nSobre cuánto tomar: sigue la forma de uso que indica el envase del ' +
  'fabricante. Si tomas alguna medicación o tienes una condición de salud, ' +
  'consúltalo antes con un profesional.';

function respuestaPlantilla(top, derivar, agotados, noTrabajamos, esClasicos, pideDosis = false, extra = {}) {
  void esClasicos;
  const { pideStock = false, pedido = null, agotadoPedido = null } = extra;
  if (derivar) {
    // No termina en «anda al medico». Termina ofreciendo lo unico que la
    // competencia no puede copiar: que la atienda ella, en persona. El limite
    // legal se convierte asi en una visita al local en vez de una venta menos.
    return 'Por lo que me cuentas prefiero no recomendarte nada por mi cuenta: ' +
      'eso lo debe ver un médico o un nutricionista, porque algunos productos ' +
      'naturales interactúan con medicamentos.\n\n' +
      'Lo que sí puedo es agendarte con la dueña, que lleva años en esto y te ' +
      'orienta con tu indicación en la mano. Déjame tu nombre y qué día y hora ' +
      'te queda cómodo venir, y te lo aparto.';
  }
  if (noTrabajamos) {
    return `Eso no lo trabajamos: ${noTrabajamos} no vendemos. ` +
      'Lo nuestro son plantas, mieles y superalimentos del Perú. ' +
      '¿Qué es lo que buscas? Capaz tengo algo que te sirva.';
  }
  // Lo pidió por nombre y no hay ninguna presentación con stock: hoy no, y
  // cuándo llega. Sin cifra, igual que cuando sí hay.
  if (!top.length && agotadoPedido) {
    return `Hoy no tenemos ${agotadoPedido}; nos llega en ${PLAZO_REPOSICION}. ` +
      '¿Te aviso apenas llegue?';
  }
  // Nombró algo concreto que la tienda no trabaja: decirlo de frente.
  if (!top.length && pedido) {
    return `No trabajamos ${pedido}. Si me cuentas para qué lo buscas, te digo si tengo algo que te sirva.`;
  }
  // Sin nada que calce, una pregunta y no una lista. Antes salían tres
  // productos fijos «de lo que más sale»: empujar maca a quien preguntó otra
  // cosa no es orientar, y el cliente ya no vuelve a escribir.
  if (!top.length) {
    return 'Uy, no te entendí bien o eso no lo tengo. ¿Qué estás buscando? ' +
      'Por ejemplo algo para el descanso, la digestión, la energía, las defensas o el cuidado de la piel. ' +
      `Si prefieres, te atiende una persona por WhatsApp al ${TIENDA.whatsapp}.` +
      (pideDosis ? AVISO_DOSIS : '');
  }
  const nota = agotados.length
    ? `\n\n${agotados.join(' ni ')}: ahorita no lo tengo, te aviso apenas llegue.`
    : '';
  // Preguntó si hay: primero la respuesta, después las fichas. La cantidad no.
  if (pideStock && top[0].porNombre) {
    return `Sí, hay. Esto es lo que tengo:\n\n${listar(top)}${nota}\n\n` +
      'La cantidad exacta no la manejo por aquí: dime cuántas necesitas y te confirmo si te las entrego todas de una vez. ' +
      '¿Lo recoges en el puesto o te lo mandamos?' +
      '\n\nSon productos naturales, no reemplazan un tratamiento médico.';
  }
  // La pregunta de cierre depende de lo que ya se sabe. Si nombró el producto,
  // lo que falta es cómo se lo lleva; si contó un malestar, para quién es —
  // que es justo lo que deja ver si hay un niño o alguien con tratamiento.
  const cierre = top[0].porNombre
    ? '¿Te lo separo? ¿Lo recoges en el puesto o te lo mandamos?'
    : '¿Es para ti o para alguien de la casa? Así te digo cuál te conviene.';
  return `Para eso te puedo ofrecer:\n\n${listar(top)}${nota}\n\n${cierre}` +
    (pideDosis ? AVISO_DOSIS : '') +
    '\n\nSon productos naturales, no reemplazan un tratamiento médico.';
}

/** Forma compacta del producto que consume el frontend. */
const fichaProducto = (p, razones = []) => ({
  id: p.id, sku: p.sku, nombre: p.nombre, emoji: p.emoji, imagen: p.imagen,
  // `disponible` y no `stock`: esta ficha la recibe el navegador del cliente.
  precio: p.precio, presentacion: p.presentacion, origen: p.origen, disponible: p.stock > 0,
  motivo: razones.slice(0, 3).join(', '),
});

/** Punto unico de entrada. Nunca lanza: la tienda no se cae si la IA falla. */
export async function asesorar(consultaOriginal, productos, buscarPedido = null) {
  // Dos lecturas de la consulta. `consulta`, en español de diccionario, decide
  // la derivación y la intención: ahí no se corrige contra el catálogo, porque
  // una enfermedad mal escrita no puede «corregirse» a un producto. `corregida`
  // además arregla erratas de nombres de producto, y es la que busca productos.
  const consulta = expandirJerga(consultaOriginal);
  const texto = normalizar(consulta);
  const corregida = corregirErratas(consulta, productos);
  const derivar = hayQueDerivar(texto);
  const pideDosis = !derivar && PIDE_DOSIS.test(texto);

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
    const cot = cotizar(corregida, productos);
    if (cot) {
      const base = {
        recomendaciones: [fichaProducto(cot.producto, ['cotizacion'])],
        agotados: [], derivar: false, no_trabajamos: null,
        intencion: 'cotizacion',
        // `alcanza` y no «disponibles / faltan»: de esas dos cifras se despeja
        // el stock exacto con una sola pregunta. El cliente necesita saber si
        // se le entrega todo ya o si una parte llega después, no cuánto hay.
        cotizacion: {
          cantidad: cot.cantidad, descuento: cot.porcentaje,
          unitario: cot.unitario, total: cot.total,
          alcanza: cot.faltan === 0,
        },
        fuente: 'reglas',
        mensaje: responderCotizacion(cot),
      };
      const redactado = await redactarConClaude(consultaOriginal, [], false, [], null, false,
        contextoTienda('cotizacion') +
        `\nCotizacion ya calculada (usa estas cifras exactas, no las recalcules):\n` +
        `- Producto: ${cot.producto.nombre} (${cot.producto.presentacion})\n` +
        `- Pide ${cot.cantidad} unidades; descuento aplicado ${cot.porcentaje}%\n` +
        `- Precio unitario con descuento S/ ${cot.unitario}, total S/ ${cot.total}\n` +
        // Al modelo no se le pasa la cifra del stock: si no la tiene, no la
        // puede soltar por mucho que el cliente insista en preguntarla.
        (cot.faltan === 0
          ? `- Hay suficiente para entregar las ${cot.cantidad} de inmediato.\n`
          : `- Hoy no alcanza para las ${cot.cantidad}: una parte sale ya y el resto ` +
            `llega en ${PLAZO_REPOSICION}; la cantidad exacta se confirma por WhatsApp.\n`) +
        `NUNCA digas cuantas unidades hay en almacen ni cuantas faltan: el stock ` +
        `es informacion interna del negocio.`);
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
      const redactado = await redactarConClaude(consultaOriginal, [], false, [], null, false,
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

  // «venden café de altura» traía muña, porque «altura» es etiqueta del
  // soroche. Si nombró algo y NINGUNA de sus palabras es nombre de un producto
  // del catálogo —con stock o sin él—, no se busca por etiquetas: no lo
  // trabajamos, y se dice.
  const pedidoAjeno = (() => {
    if (derivar || noTrabajamos) return false;
    const frase = productoPedido(normalizar(corregida));
    if (!frase) return false;
    // «quiero bajar de peso», «necesito dormir mejor»: un verbo o un malestar
    // que el asesor ya reconoce no es el nombre de un producto de otra tienda.
    if (/^\w+(ar|er|ir)\b/.test(frase)) return false;
    // El malestar se busca FUERA de lo que nombró: en «café de altura», «altura»
    // es parte del nombre pedido, no un soroche.
    const fuera = ` ${normalizar(corregida).replace(frase, ' ')} `;
    if (FRASES_SINONIMOS.some(([f]) => fuera.includes(` ${normalizar(f)}`))) return false;
    const significativas = frase.split(' ').filter((w) => w.length > 3 && !PRESENTACIONES.has(w) && !PALABRAS_VACIAS.has(w));
    return significativas.length > 0 && !significativas.some((w) =>
      productos.some((p) => nombreTiene(normalizar(p.nombre).split(' '), w)));
  })();

  const top = (derivar || noTrabajamos || pedidoAjeno) ? [] : motorReglas(corregida, productos);
  const agotados = (derivar || noTrabajamos) ? [] : agotadosRelevantes(corregida, productos);

  // Sin señal alguna ya no se ofrecen «los clásicos»: la plantilla pregunta
  // qué busca. `sugerencia_general` se sigue mandando, siempre en false, para
  // no romper a quien la lea.
  const esClasicos = false;

  // Lo que pidió por nombre, para las dos respuestas nuevas: «hoy no» si solo
  // hay presentaciones agotadas, y «no trabajamos X» si no está en el catálogo.
  const pideStock = !derivar && !noTrabajamos && PREGUNTA_STOCK.test(texto);
  const pedido = (derivar || noTrabajamos || top.length) ? null : productoPedido(normalizar(corregida));
  let agotadoPedido = null;
  if (pedido) {
    const palabras = pedido.split(' ').filter((w) => w.length > 3 && !PRESENTACIONES.has(w));
    const sinStock = productos.find((p) => p.stock <= 0
      && palabras.length && palabras.every((w) => nombreTiene(normalizar(p.nombre).split(' '), w)));
    if (sinStock) agotadoPedido = sinStock.nombre;
  }

  const base = {
    recomendaciones: top.map((t) => fichaProducto(t.prod, t.razones)),
    agotados,
    derivar,
    no_trabajamos: noTrabajamos || (pedido && !agotadoPedido ? pedido : null),
    sugerencia_general: esClasicos,
    fuente: 'reglas',
    mensaje: respuestaPlantilla(top, derivar, agotados, noTrabajamos, esClasicos, pideDosis,
      { pideStock, pedido, agotadoPedido }),
  };

  const redactado = await redactarConClaude(consultaOriginal, top, derivar, agotados, noTrabajamos, esClasicos,
    null, pideDosis);
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
3b. Nunca indiques dosis, cantidades diarias ni por cuanto tiempo tomar algo. Si
   te lo piden, deriva: eso es una indicacion y no te corresponde darla.
3c. Nunca digas cuantas unidades hay de un producto ni cuantos productos tiene
   la tienda. Di si esta disponible o no; el stock es informacion interna.
3d. Nunca nombres una enfermedad ni digas que un producto sirve para una. Habla
   de bienestar: descanso, digestion, energia, defensas, cuidado de la piel.
   El uso tradicional es historia del producto, no una promesa de efecto.
4. Menciona el origen del producto: es lo que nos diferencia de una farmacia.
5. Maximo 90 palabras. Sin listas con vinetas, escribe corrido y natural.
6. Precios en soles, tal como te los paso.
7. Si te paso datos de la tienda (horario, delivery, pago, politicas), responde con
   ESOS datos exactos. No inventes zonas, costos, plazos ni descuentos.
8. Si el cliente reclama o quiere devolver algo, primero reconoce el problema.
   No le ofrezcas comprar nada mas en esa misma respuesta.`;

async function redactarConClaude(consulta, top, derivar, agotados, noTrabajamos, esClasicos, negocio = null,
  pideDosis = false) {
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
        // Sin la cifra de stock: todos los de esta lista están disponibles, y
        // cuántos quedan no es algo que el cliente deba leer.
        `origen: ${t.prod.origen} | uso tradicional: ${t.prod.uso_tradicional}`).join('\n')
    : '(sin coincidencias en stock)';

  const contexto = [
    'Consulta del cliente: ' + consulta,
    '',
    // Datos duros del negocio cuando la pregunta es de negocio, no de producto.
    negocio || 'Productos disponibles que calzan:',
    negocio ? '' : catalogo,
    agotados.length ? '\nAgotados hoy (mencionalo si viene al caso): ' + agotados.join(', ') : '',
    derivar ? '\nATENCION: el caso menciona una enfermedad, un medicamento o un embarazo.'
      + ' NO recomiendes ningun producto y NO indiques dosis.'
      + ' Deriva a un medico o nutricionista, y despues ofrece agendar una atencion'
      + ' presencial con la dueña: pide el nombre y que dia y hora le queda comodo venir.' : '',
    noTrabajamos ? `\nATENCION: el cliente pide ${noTrabajamos} y NO lo vendemos. Dilo de frente, sin rodeos, y ofrece orientarlo si cuenta que le pasa.` : '',
    pideDosis ? '\nATENCION: pregunta cuanto tomar o cada cuanto. NO indiques cantidades ni tiempos:'
      + ' di que siga la forma de uso del envase del fabricante y que, si toma medicacion'
      + ' o tiene una condicion de salud, lo consulte antes con un profesional.' : '',
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
