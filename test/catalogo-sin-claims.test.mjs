/**
 * El catálogo no promete curar nada.
 *
 * El asesor ya no recomienda ante una enfermedad, pero la ficha de producto se
 * muestra igual en la tienda: «Cicatriza heridas y calma la gastritis», «Apto
 * para diabéticos», «Cucharada en ayunas» eran publicidad sanitaria y posología
 * a la vista de cualquiera — y además el texto que se le pasaba al modelo para
 * redactar. Aquí se revisan las dos fuentes: el catálogo generado
 * (`data/catalogo.json`) y los productos curados de `db.js`, sembrados aparte.
 *
 * Una etiqueta clínica tampoco sirve de nada: si la consulta nombra la
 * enfermedad, el asesor deriva antes de mirar etiquetas. Lo único que puede
 * hacer una etiqueta «gastritis» es volver a colar el producto por otro camino.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

const sinTildes = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Enfermedades, órganos con promesa y efectos terapéuticos. Por raíz de palabra:
 * se ancla solo el principio, para que «diabet» atrape «diabéticos» y «herida»
 * atrape «heridas». Con `\b` también al final se escapaban todos los plurales.
 */
const CLINICO = new RegExp('\\b(' + [
  'gastritis', 'diabet', 'colesterol', 'triglicer', 'presion', 'hipertens', 'anemia',
  'hemoglobin', 'artritis', 'reuma', 'osteoporosis', 'prostata', 'calculo', 'infeccion',
  'ulcera', 'tiroides', 'depresion', 'varices', 'migran', 'fiebre', 'dermatitis',
  'hongos', 'intoxicacion', 'embaraz', 'antibiotic', 'herida', 'higado', 'rinon',
  'vesicula', 'anginas', 'alergia', 'palpitacion', 'bronquio', 'pulmon', 'corazon',
  'esguince', 'zumbido', 'fertilidad', 'cura', 'curar', 'previene', 'depura',
  'depurativo', 'detox', 'remedio', 'antiinflamatori', 'cicatriza', 'tranquilizante',
  'tratamiento', 'sintoma',
].join('|') + ')');

/** Cuánto, cuándo y por cuánto tiempo: eso es una posología. */
const DOSIS = /\b(en ayunas|al dia|veces al|media hora antes|una al dia|cucharad\w* en|por \w+ dias|meses seguidos|ciclos de)\b/;

function revisar(productos, origen) {
  const hallazgos = [];
  for (const p of productos) {
    for (const campo of ['nombre', 'descripcion', 'uso_tradicional', 'beneficios', 'etiquetas']) {
      const texto = sinTildes(String(p[campo] ?? ''));
      const clinico = texto.match(CLINICO);
      const dosis = texto.match(DOSIS);
      if (clinico || dosis) {
        hallazgos.push(`${origen} ${p.sku} ${campo}: «${(clinico || dosis)[0]}» en «${p[campo]}»`);
      }
    }
  }
  return hallazgos;
}

describe('Ninguna ficha nombra una enfermedad ni indica dosis', () => {
  test('catálogo generado (data/catalogo.json)', () => {
    const productos = JSON.parse(readFileSync(join(RAIZ, 'data', 'catalogo.json'), 'utf8'));
    assert.ok(productos.length > 100, 'el catálogo generado vino vacío');
    const h = revisar(productos, 'catalogo.json');
    assert.equal(h.length, 0, `${h.length} textos con claims:\n  ${h.slice(0, 15).join('\n  ')}`);
  });

  test('productos curados y sembrados (db.js --reset)', () => {
    const carpeta = mkdtempSync(join(tmpdir(), 'ra-claims-'));
    try {
      const dbPath = join(carpeta, 'prueba.db');
      const semilla = spawnSync(process.execPath, ['db.js', '--reset'], {
        cwd: RAIZ, env: { ...process.env, DB_PATH: dbPath }, stdio: 'ignore',
      });
      assert.equal(semilla.status, 0, 'la semilla de prueba debe cargar');
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const productos = db.prepare('SELECT * FROM productos').all();
      db.close();
      const h = revisar(productos, 'semilla');
      assert.equal(h.length, 0, `${h.length} textos con claims:\n  ${h.slice(0, 15).join('\n  ')}`);
    } finally {
      rmSync(carpeta, { recursive: true, force: true });
    }
  });

  test('el detector sí caza lo que tiene que cazar', () => {
    // Sin esto, un regex roto dejaría pasar todo y los dos tests de arriba
    // saldrían verdes sin revisar nada.
    const malos = [
      { sku: 'X-1', beneficios: 'Cicatriza heridas y calma la gastritis' },
      { sku: 'X-2', beneficios: 'Endulzante apto para diabéticos' },
      { sku: 'X-3', uso_tradicional: 'Cucharada en ayunas para los convalecientes.' },
      { sku: 'X-4', uso_tradicional: 'Dos veces al día sobre la articulación.' },
      { sku: 'X-5', etiquetas: 'energia,anemia,fatiga' },
    ];
    assert.equal(revisar(malos, 'prueba').length, malos.length);
    // Y no se confunde con palabras que solo se parecen.
    const buenos = [
      { sku: 'Y-1', beneficios: 'Miel oscura para días de frío' },
      { sku: 'Y-2', beneficios: 'Cicatrices, manchas y arrugas' },
      { sku: 'Y-3', etiquetas: 'piel,sol,irritacion,hidratacion' },
    ];
    assert.equal(revisar(buenos, 'prueba').length, 0);
  });
});
