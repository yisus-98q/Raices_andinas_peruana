/**
 * Genera los PDF de la documentacion.
 *
 *   node gen-pdf.mjs
 *
 * Los documentos se escriben como fragmentos HTML —igual que los artefactos
 * publicados— asi que aqui se les pone el esqueleto que un navegador necesita
 * y se imprime con Chrome o Edge en modo headless, que ya esta en cualquier
 * Windows. Sin dependencias: el navegador del sistema ES el motor de PDF.
 *
 * Las tipografias vienen de Google Fonts, o sea que ESTE paso necesita
 * internet. Sin conexion el PDF sale igual, con las tipografias de respaldo.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { manualHtml } from './manual.mjs';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const DOCS = join(RAIZ, 'docs');

const DOCUMENTOS = [
  { fuente: 'raiz-andina-por-dentro.html', salida: 'raiz-andina-por-dentro.pdf' },
  { fuente: 'que-gana-su-tienda.html', salida: 'que-gana-su-tienda.pdf' },
  { fuente: 'manual-del-sistema.html', salida: 'manual-del-sistema.pdf' },
];

/**
 * El manual se arma del README en cada corrida, nunca se edita a mano.
 *
 * Es la unica forma de que no se separen. Un manual copiado a mano envejece
 * en la primera semana, y esta documentacion ya tuvo que corregirse una vez
 * por ensenar cifras que el panel ya no daba.
 */
function armarManual() {
  const md = readFileSync(join(RAIZ, 'README.md'), 'utf8');

  // Las cifras de la portada se cuentan aqui, no se escriben. La de pruebas
  // sale del propio README: contar `test(` se queda corto con los anidados,
  // que es justo como el documento tecnico llego a declarar un total que sus
  // propias filas no sumaban.
  const modulos = readdirSync(RAIZ).filter((f) => /\.m?js$/.test(f)).length;
  const pruebas = (md.match(/test\/\s+(\d+) tests/) || [])[1] || '—';
  const productos = JSON.parse(readFileSync(join(RAIZ, 'data', 'catalogo.json'), 'utf8')).length;
  const paquete = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'));
  const dependencias = Object.keys(paquete.dependencies || {}).length;

  const salida = join(DOCS, 'manual-del-sistema.html');
  writeFileSync(salida, manualHtml(md, {
    'módulos': modulos,
    'pruebas': pruebas,
    'dependencias': dependencias,
    'productos': productos,
  }));
  console.log('  manual-del-sistema.html armado desde README.md\n');
}

/** Chrome o Edge, el que este instalado. */
function navegador() {
  const candidatos = [
    join(process.env['ProgramFiles'] || '', 'Google/Chrome/Application/chrome.exe'),
    join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    join(process.env['ProgramFiles'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ];
  const encontrado = candidatos.find((r) => r && existsSync(r));
  if (!encontrado) {
    throw new Error(
      'No encontre Chrome ni Edge. Sin uno de los dos no puedo generar el PDF;\n' +
      '  abre el .html en tu navegador y usa Imprimir > Guardar como PDF.');
  }
  return encontrado;
}

/**
 * El fragmento se envuelve en un documento completo.
 *
 * Es el mismo esqueleto que le pone el visor de artefactos: asi lo que se
 * imprime es exactamente lo que se publica, no una version distinta que puede
 * quedarse desactualizada.
 */
const envolver = (fragmento) => `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html { color-scheme: light; }
  body { margin: 0; font: 14px system-ui, sans-serif; background: #fff; }
  img { max-width: 100%; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
${fragmento}
</body>
</html>`;

const exe = navegador();
mkdirSync(DOCS, { recursive: true });
const temporal = join(tmpdir(), 'ra-pdf-' + Date.now());
mkdirSync(temporal, { recursive: true });

console.log('  navegador: ' + exe + '\n');
armarManual();

for (const doc of DOCUMENTOS) {
  const origen = join(DOCS, doc.fuente);
  if (!existsSync(origen)) {
    console.warn(`  falta ${doc.fuente}, lo salto`);
    continue;
  }

  const completo = join(temporal, doc.fuente);
  writeFileSync(completo, envolver(readFileSync(origen, 'utf8')));

  const destino = join(DOCS, doc.salida);
  execFileSync(exe, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-pdf-header-footer',        // sin la URL ni la fecha del navegador
    '--virtual-time-budget=12000',   // da tiempo a que bajen las tipografias
    `--print-to-pdf=${destino}`,
    'file:///' + completo.replace(/\\/g, '/'),
  ], { stdio: 'ignore', timeout: 120_000 });

  const kb = Math.round(readFileSync(destino).length / 1024);
  console.log(`  ${doc.salida.padEnd(32)} ${String(kb).padStart(5)} KB`);
}

rmSync(temporal, { recursive: true, force: true });
console.log('\n  Listos en docs/');
