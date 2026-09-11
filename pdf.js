/**
 * Escritor de PDF minimo, sin dependencias.
 *
 * El proyecto no instala paquetes, asi que tampoco para esto. Un PDF es un
 * formato de texto con una tabla de posiciones al final: se puede escribir a
 * mano si uno se limita a lo que hace falta —texto, lineas y rectangulos— y
 * usa las tipografias que TODO lector de PDF trae incorporadas (las catorce
 * "base 14"). Al no incrustar tipografias, un comprobante pesa unos 3 KB en
 * lugar de 300, que en una boleta que se manda por WhatsApp importa.
 *
 * Lo que NO hace, a proposito: imagenes, transparencias, tipografias propias.
 * Si algun dia hace falta un QR grafico o el logo, se agrega aqui.
 *
 * El sistema de coordenadas del PDF nace abajo a la izquierda y crece hacia
 * arriba. Como maquetar asi es una fuente constante de errores, la API de este
 * modulo trabaja desde ARRIBA a la izquierda, como una hoja de verdad, y la
 * conversion se hace en un solo sitio.
 */

// A4 en puntos tipograficos (72 por pulgada).
export const A4 = { ancho: 595.28, alto: 841.89 };

/**
 * Anchos de los glifos en milesimas de em, sacados de los AFM de Adobe.
 *
 * Hacen falta para alinear importes a la derecha y para cortar lineas: sin
 * ellos, cada columna de numeros queda desflecada. Solo se listan del espacio
 * a la tilde; los acentuados se resuelven por su letra base, que es
 * exactamente lo que hace Helvetica.
 */
const ANCHOS = {
  normal: [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  ],
  negrita: [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
  ],
};

/**
 * Del texto de JavaScript a los bytes que entiende un PDF.
 *
 * Los lectores esperan WinAnsi, que coincide con Latin-1 salvo en la franja
 * 0x80-0x9F, donde estan justo los signos tipograficos que usa este proyecto:
 * las comillas curvas, la raya y los puntos suspensivos. Lo que no tenga
 * equivalente se cambia por su version simple antes que ensuciar el documento
 * con cuadraditos.
 */
const WINANSI = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c,
  'ž': 0x9e, 'Ÿ': 0x9f,
};

/** Letra acentuada -> letra base, para medir su ancho. */
const SIN_TILDE = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n', ç: 'c',
  Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ü: 'U', Ñ: 'N', Ç: 'C',
  à: 'a', è: 'e', ì: 'i', ò: 'o', ù: 'u', â: 'a', ê: 'e', î: 'i', ô: 'o', û: 'u',
};

function bytesDe(texto) {
  const salida = [];
  for (const c of String(texto)) {
    const punto = c.codePointAt(0);
    if (WINANSI[c] !== undefined) { salida.push(WINANSI[c]); continue; }
    if (punto <= 0xff) { salida.push(punto); continue; }
    // Sin equivalente: se degrada en vez de romper el documento.
    salida.push(...[...'?'].map((x) => x.charCodeAt(0)));
  }
  return Buffer.from(salida);
}

/** Ancho de un texto, en puntos, para un cuerpo dado. */
export function anchoDe(texto, tam, fuente = 'normal') {
  const tabla = ANCHOS[fuente] || ANCHOS.normal;
  let total = 0;
  for (const c of String(texto)) {
    const base = SIN_TILDE[c] || c;
    const codigo = base.charCodeAt(0);
    if (codigo >= 32 && codigo <= 126) total += tabla[codigo - 32];
    else if (c === '¿') total += tabla[31];        // como el '?'
    else if (c === '¡') total += tabla[1];         // como el '!'
    else if (c === '«' || c === '»') total += 556;
    else if (c === '—') total += 1000;
    else if (c === '–' || c === '…') total += 556;
    else if (c === '°' || c === 'º' || c === 'ª') total += 400;
    else total += 556;
  }
  return (total * tam) / 1000;
}

/** Escapa los caracteres que en un PDF delimitan una cadena. */
const escapar = (b) => {
  const salida = [];
  for (const byte of b) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) salida.push(0x5c);
    salida.push(byte);
  }
  return Buffer.from(salida);
};

const dec = (n) => Math.round(n * 100) / 100;

/**
 * Crea un documento. `margen` solo se guarda como referencia para quien
 * maqueta; este modulo no recorta nada por su cuenta.
 */
export function nuevoPdf({ ancho = A4.ancho, alto = A4.alto, margen = 42 } = {}) {
  const paginas = [];
  let actual = [];
  paginas.push(actual);

  /** De coordenada "desde arriba" a la del PDF. */
  const y = (desdeArriba) => alto - desdeArriba;

  const color = (c) => (Array.isArray(c) ? c : [0, 0, 0])
    .map((v) => dec(v / 255)).join(' ');

  const api = {
    ancho, alto, margen,

    get pagina() { return paginas.length; },

    nuevaPagina() {
      actual = [];
      paginas.push(actual);
      return api;
    },

    /**
     * Un texto en una posicion. `alinear` mueve el punto de anclaje: con
     * 'der', (x, y) es donde TERMINA el texto, que es lo que hace falta para
     * una columna de importes.
     */
    texto(contenido, x, arriba, opciones = {}) {
      const { tam = 10, fuente = 'normal', alinear = 'izq', color: c = [0, 0, 0],
        espaciado = 0 } = opciones;
      const t = String(contenido ?? '');
      if (!t) return api;

      const w = anchoDe(t, tam, fuente) + espaciado * (t.length - 1);
      const inicio = alinear === 'der' ? x - w : alinear === 'centro' ? x - w / 2 : x;

      actual.push(Buffer.from(`BT ${color(c)} rg /${fuente === 'negrita' ? 'F2' : 'F1'} ${tam} Tf`));
      if (espaciado) actual.push(Buffer.from(` ${dec(espaciado)} Tc`));
      actual.push(Buffer.from(` 1 0 0 1 ${dec(inicio)} ${dec(y(arriba))} Tm (`));
      actual.push(escapar(bytesDe(t)));
      actual.push(Buffer.from(') Tj'));
      if (espaciado) actual.push(Buffer.from(' 0 Tc'));
      actual.push(Buffer.from(' ET\n'));
      return api;
    },

    linea(x1, arriba1, x2, arriba2, opciones = {}) {
      const { grosor = 0.5, color: c = [0, 0, 0] } = opciones;
      actual.push(Buffer.from(
        `${color(c)} RG ${dec(grosor)} w ${dec(x1)} ${dec(y(arriba1))} m ` +
        `${dec(x2)} ${dec(y(arriba2))} l S\n`));
      return api;
    },

    rect(x, arriba, w, h, opciones = {}) {
      const { relleno = null, borde = null, grosor = 0.5 } = opciones;
      const caja = `${dec(x)} ${dec(y(arriba + h))} ${dec(w)} ${dec(h)} re`;
      if (relleno) actual.push(Buffer.from(`${color(relleno)} rg ${caja} f\n`));
      if (borde) {
        actual.push(Buffer.from(`${color(borde)} RG ${dec(grosor)} w ${caja} S\n`));
      }
      return api;
    },

    /**
     * Texto que se corta al llegar al ancho dado. Devuelve cuanto bajo, para
     * que quien maqueta sepa donde sigue.
     */
    parrafo(contenido, x, arriba, anchoMax, opciones = {}) {
      const { tam = 10, interlinea = 1.35, alinear = 'izq' } = opciones;
      const palabras = String(contenido ?? '').split(/\s+/).filter(Boolean);
      const salto = tam * interlinea;
      let linea = '';
      let cursor = arriba;

      const soltar = () => {
        if (!linea) return;
        api.texto(linea, x, cursor, { ...opciones, alinear });
        cursor += salto;
        linea = '';
      };

      for (const palabra of palabras) {
        const prueba = linea ? linea + ' ' + palabra : palabra;
        if (anchoDe(prueba, tam, opciones.fuente) > anchoMax && linea) soltar();
        else linea = prueba;
        if (!linea) linea = palabra;
      }
      soltar();
      return cursor - arriba;
    },

    /** Recorta un texto para que quepa, con puntos suspensivos. */
    recortar(contenido, anchoMax, tam, fuente = 'normal') {
      let t = String(contenido ?? '');
      if (anchoDe(t, tam, fuente) <= anchoMax) return t;
      while (t.length > 1 && anchoDe(t + '…', tam, fuente) > anchoMax) {
        t = t.slice(0, -1);
      }
      return t.trimEnd() + '…';
    },

    /** Arma el archivo. A partir de aqui el documento no se toca mas. */
    terminar() {
      const objetos = [];
      const empujar = (cuerpo) => { objetos.push(cuerpo); return objetos.length; };

      // 1: catalogo, 2: arbol de paginas. Se reservan para poder referenciarlos
      // antes de saber cuantas paginas hay.
      empujar(null);
      empujar(null);
      const fuenteNormal = empujar(Buffer.from(
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
      const fuenteNegrita = empujar(Buffer.from(
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));

      const idsPagina = [];
      for (const contenido of paginas) {
        const flujo = Buffer.concat(contenido);
        const idFlujo = empujar(Buffer.concat([
          Buffer.from(`<< /Length ${flujo.length} >>\nstream\n`),
          flujo,
          Buffer.from('\nendstream'),
        ]));
        idsPagina.push(empujar(Buffer.from(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${dec(ancho)} ${dec(alto)}] ` +
          `/Resources << /Font << /F1 ${fuenteNormal} 0 R /F2 ${fuenteNegrita} 0 R >> >> ` +
          `/Contents ${idFlujo} 0 R >>`)));
      }

      objetos[0] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>');
      objetos[1] = Buffer.from(
        `<< /Type /Pages /Kids [${idsPagina.map((i) => i + ' 0 R').join(' ')}] ` +
        `/Count ${idsPagina.length} >>`);

      const partes = [Buffer.from('%PDF-1.4\n')];
      let posicion = partes[0].length;
      const posiciones = [];

      objetos.forEach((cuerpo, i) => {
        posiciones.push(posicion);
        const bloque = Buffer.concat([
          Buffer.from(`${i + 1} 0 obj\n`), cuerpo, Buffer.from('\nendobj\n'),
        ]);
        partes.push(bloque);
        posicion += bloque.length;
      });

      // La tabla xref: por que un PDF se puede abrir sin leerlo entero.
      let xref = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
      for (const p of posiciones) xref += String(p).padStart(10, '0') + ' 00000 n \n';
      xref += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\n` +
        `startxref\n${posicion}\n%%EOF\n`;
      partes.push(Buffer.from(xref));

      return Buffer.concat(partes);
    },
  };

  return api;
}
