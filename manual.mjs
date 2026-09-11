/**
 * El README, vestido para imprimirse.
 *
 * El manual del sistema vivia solo como Markdown: perfecto para leerlo en el
 * editor, incomodo para mandarselo a alguien. Aqui se convierte en el mismo
 * tipo de fragmento HTML que los otros dos documentos de docs/, con su misma
 * tipografia y su misma hoja de impresion, para que los tres PDF se vean como
 * un juego y no como tres cosas sueltas.
 *
 * Son cuarenta y tantas paginas, asi que ademas se le arma un indice a partir
 * de sus propios encabezados. Un manual impreso sin indice no se consulta: se
 * hojea una vez y se archiva.
 */
import { aHtml, titulo } from './markdown.mjs';

/** Un id estable y legible para enlazar desde el indice. */
const anclaDe = (t) => t
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 60);

/**
 * Pone ancla a cada h2 y h3, y devuelve el indice ya armado.
 *
 * Solo esos dos niveles: con los h4 dentro, el indice de este README ocupaba
 * mas de una pagina y dejaba de servir para encontrar nada.
 */
function indexar(html) {
  const entradas = [];
  const conAnclas = html.replace(/<(h[23])>(.*?)<\/\1>/g, (_, etiqueta, texto) => {
    const ancla = anclaDe(texto);
    entradas.push({ nivel: etiqueta, ancla, texto });
    return `<${etiqueta} id="${ancla}">${texto}</${etiqueta}>`;
  });

  const indice = entradas.map((e) =>
    `<li class="ix-${e.nivel}"><a href="#${e.ancla}">${e.texto}</a></li>`).join('\n');

  return { html: conAnclas, indice };
}

const ESTILOS = `<style>
  :root {
    --noche:    #0d0b09;
    --carbon:   #16130e;
    --humo:     #1e1a14;
    --crema:    #f7f0e2;
    --crema-baja:#c5b9a4;
    --gris:     #8d8272;
    --ocre:     #f0a52c;
    --terra:    #d96a45;
    --verde:    #7cb488;
    --linea:      rgba(247, 240, 226, .13);
    --linea-firme: rgba(247, 240, 226, .28);

    --display: "Bricolage Grotesque", "Segoe UI", system-ui, sans-serif;
    --texto:   Newsreader, Georgia, "Times New Roman", serif;
    --mono:    "IBM Plex Mono", ui-monospace, "Cascadia Mono", monospace;
    --prosa: 68ch;
  }

  body {
    background: var(--noche);
    color: var(--crema);
    font-family: var(--texto);
    font-size: 17px;
    line-height: 1.66;
    -webkit-font-smoothing: antialiased;
  }
  .manual { max-width: 980px; margin: 0 auto; padding-block: 56px 90px; padding-inline: 24px; }

  /* ── portada ─────────────────────────────────────────────────────────── */
  .portada { border-bottom: 1px solid var(--linea-firme); padding-bottom: 34px; margin-bottom: 34px; }
  .sello {
    font-family: var(--mono); font-size: 11px; letter-spacing: .16em;
    text-transform: uppercase; color: var(--ocre); margin: 0 0 18px;
  }
  .portada h1 {
    font-family: var(--display); font-weight: 800; font-size: clamp(30px, 5vw, 46px);
    line-height: 1.08; letter-spacing: -.02em; margin: 0; text-wrap: balance;
  }
  .bajada { color: var(--crema-baja); font-size: 18px; max-width: var(--prosa); margin: 14px 0 0; }
  .pie-portada {
    display: flex; flex-wrap: wrap; gap: 10px 26px; margin-top: 22px;
    font-family: var(--mono); font-size: 11.5px; color: var(--gris);
  }
  .pie-portada b { color: var(--crema-baja); font-weight: 500; }

  /* ── indice ──────────────────────────────────────────────────────────── */
  .indice { margin-bottom: 44px; }
  .indice h2 {
    font-family: var(--mono); font-size: 11px; letter-spacing: .16em; text-transform: uppercase;
    color: var(--gris); border: 0; padding: 0; margin: 0 0 14px;
  }
  .indice ol { list-style: none; margin: 0; padding: 0; columns: 2; column-gap: 40px; }
  .indice li { break-inside: avoid; margin: 0 0 5px; font-size: 14.5px; }
  .indice a { color: var(--crema-baja); text-decoration: none; }
  .ix-h3 { padding-left: 16px; color: var(--gris); font-size: 13.5px; }
  .ix-h3 a { color: var(--gris); }

  /* ── cuerpo ──────────────────────────────────────────────────────────── */
  .cuerpo > * { max-width: var(--prosa); }
  .cuerpo > table, .cuerpo > pre, .cuerpo > hr { max-width: none; }

  h1, h2, h3, h4 { font-family: var(--display); letter-spacing: -.015em; text-wrap: balance; }
  /* El titulo del README y su primer parrafo ya son la portada; repetirlos
     aqui hace que el manual parezca empezar dos veces. La regla se lleva
     tambien la linea divisoria que viene detras. */
  .cuerpo h1,
  .cuerpo h1 + p,
  .cuerpo h1 + p + hr { display: none; }
  h2 {
    font-size: 27px; font-weight: 800; margin: 52px 0 16px;
    padding-top: 16px; border-top: 1px solid var(--linea-firme);
  }
  h3 { font-size: 20px; font-weight: 700; margin: 34px 0 12px; color: var(--crema); }
  h4 { font-size: 15.5px; font-weight: 700; margin: 26px 0 10px; color: var(--ocre); }
  p { margin: 0 0 14px; }

  a { color: var(--ocre); }
  strong { color: #fff; font-weight: 600; }
  em { color: var(--crema-baja); }

  code {
    font-family: var(--mono); font-size: .86em; color: var(--terra);
    background: var(--humo); padding: 1px 5px; border-radius: 3px;
  }
  pre {
    font-family: var(--mono); font-size: 12.5px; line-height: 1.6;
    background: var(--carbon); border: 1px solid var(--linea);
    border-left: 2px solid var(--ocre);
    padding: 14px 16px; overflow-x: auto; margin: 0 0 20px;
  }
  pre code { background: none; color: var(--crema-baja); padding: 0; font-size: inherit; }

  blockquote {
    margin: 0 0 18px; padding: 2px 0 2px 18px;
    border-left: 2px solid var(--ocre); color: var(--crema-baja);
  }
  blockquote p:last-child { margin-bottom: 0; }

  ul, ol { margin: 0 0 16px; padding-left: 22px; }
  li { margin: 0 0 7px; }
  li > p:last-child { margin-bottom: 0; }

  hr { border: 0; border-top: 1px solid var(--linea); margin: 34px 0; }

  /* Las tablas del README son casi todas de dos columnas: una decisión y su
     porqué. Se leen mejor a ancho completo que dentro de la medida del texto. */
  table {
    width: 100%; border-collapse: collapse; margin: 0 0 22px;
    font-size: 14.5px; font-variant-numeric: tabular-nums;
  }
  th, td { text-align: left; padding: 8px 12px 8px 0; border-bottom: 1px solid var(--linea); vertical-align: top; }
  th {
    font-family: var(--mono); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase;
    color: var(--gris); font-weight: 500; border-bottom-color: var(--linea-firme);
  }
  td code { font-size: .84em; }

  @media (max-width: 600px) {
    .indice ol { columns: 1; }
    table { display: block; overflow-x: auto; }
  }

  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }

  /* ── impresion: el documento nace para esto ──────────────────────────── */
  @media print {
    @page { size: A4; margin: 16mm 15mm 18mm; }

    :root {
      --noche: #ffffff; --carbon: #f7f4ed; --humo: #f2ece1;
      --crema: #14110e; --crema-baja: #3f3831; --gris: #6d6459;
      --ocre: #8f5a06; --terra: #8d3315; --verde: #2f5636;
      --linea: #ded6c7; --linea-firme: #b3a794;
    }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

    body { background: #fff; color: #14110e; font-size: 9.8pt; line-height: 1.5; }
    .manual { max-width: none; padding: 0; }
    strong { color: #000; }

    .portada { padding-bottom: 16pt; margin-bottom: 16pt; }
    .portada h1 { font-size: 26pt; }
    .bajada { font-size: 11pt; }
    .pie-portada { font-size: 8pt; }

    .indice { margin-bottom: 0; break-after: page; }
    .indice li { font-size: 9pt; }
    .ix-h3 { font-size: 8.5pt; }

    h2 { font-size: 15pt; margin: 20pt 0 8pt; padding-top: 8pt; break-after: avoid; }
    h3 { font-size: 11.5pt; margin: 14pt 0 6pt; break-after: avoid; }
    h4 { font-size: 10pt; margin: 11pt 0 5pt; break-after: avoid; }
    p, li { orphans: 3; widows: 3; }

    /* Un ejemplo o una fila partidos entre dos hojas no se entienden. */
    pre, blockquote, tr { break-inside: avoid; }
    pre { font-size: 8.4pt; padding: 8pt 10pt; }
    table { font-size: 8.8pt; }
    th, td { padding: 4pt 8pt 4pt 0; }
    code { background: var(--humo); }
    a { color: var(--ocre); text-decoration: none; }
    a[href^="#"] { color: inherit; }
  }
</style>`;

/**
 * El README convertido en fragmento listo para publicar o imprimir.
 * @param {string} md   el contenido de README.md
 * @param {object} datos  cifras para el pie de la portada
 */
export function manualHtml(md, datos = {}) {
  const nombre = titulo(md);

  // La bajada es el primer parrafo entero del README, que ya resume el
  // proyecto. Entero: quedarse con su primera linea lo cortaba a media frase.
  const lineas = md.split(/\r?\n/).slice(1);
  const desde = lineas.findIndex((l) => l.trim() && !l.startsWith('#'));
  const parrafo = [];
  for (let i = desde; i >= 0 && i < lineas.length && lineas[i].trim(); i += 1) {
    parrafo.push(lineas[i].trim());
  }
  const bajada = parrafo.join(' ').replace(/\*\*/g, '');

  const { html, indice } = indexar(aHtml(md));
  const pie = Object.entries(datos)
    .map(([k, v]) => `<span><b>${v}</b> ${k}</span>`).join('\n      ');

  return `<title>${nombre.replace(/ —.*$/, '')} · Manual del sistema</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;1,6..72,400&family=IBM+Plex+Mono:wght@400;500&display=swap">

${ESTILOS}

<div class="manual">
  <header class="portada">
    <p class="sello">Manual del sistema</p>
    <h1>${nombre}</h1>
    <p class="bajada">${bajada}</p>
    <div class="pie-portada">
      ${pie}
    </div>
  </header>

  <nav class="indice">
    <h2>Contenido</h2>
    <ol>
${indice}
    </ol>
  </nav>

  <main class="cuerpo">
${html}
  </main>
</div>`;
}
