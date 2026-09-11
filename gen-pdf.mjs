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
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const DOCS = join(RAIZ, 'docs');

const DOCUMENTOS = [
  { fuente: 'raiz-andina-por-dentro.html', salida: 'raiz-andina-por-dentro.pdf' },
  { fuente: 'que-gana-su-tienda.html', salida: 'que-gana-su-tienda.pdf' },
];

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
