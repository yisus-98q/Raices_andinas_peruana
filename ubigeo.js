/**
 * Ubigeo del Perú: departamento, provincia y distrito.
 *
 * Datos oficiales del INEI (25 departamentos, 196 provincias, 1 874 distritos),
 * generados con `node gen-ubigeo.mjs` a `public/ubigeo.json`.
 *
 * Para qué sirve de verdad: hasta ahora la dirección era una sola caja de texto,
 * y el costo de envío se le decía al cliente "según tu zona". Con el distrito
 * validado contra la lista real, el envío se cotiza de verdad y el sistema no
 * acepta una dirección que no existe.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIENDA } from './tienda.config.js';

const RAIZ = dirname(fileURLToPath(import.meta.url));

/** { "01": ["Amazonas", [["Chachapoyas", ["Chachapoyas", ...]], ...]] } */
const DATOS = JSON.parse(readFileSync(join(RAIZ, 'public', 'ubigeo.json'), 'utf8'));

const normalizar = (t) => String(t ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

// Índices por nombre normalizado: el cliente escribe "san juan de lurigancho"
// o "San Juan de Lurigancho" y las dos deben encontrar lo mismo.
const porDepartamento = new Map();
for (const [codDep, [nomDep, provincias]] of Object.entries(DATOS)) {
  const provs = new Map();
  provincias.forEach(([nomProv, distritos], i) => {
    const dists = new Map();
    distritos.forEach((nomDist, j) => {
      dists.set(normalizar(nomDist), {
        nombre: nomDist,
        codigo: codDep + String(i + 1).padStart(2, '0') + String(j + 1).padStart(2, '0'),
      });
    });
    provs.set(normalizar(nomProv), { nombre: nomProv, distritos: dists });
  });
  porDepartamento.set(normalizar(nomDep), { nombre: nomDep, codigo: codDep, provincias: provs });
}

/**
 * Nombres alternativos que la gente sí escribe. El único caso real es el
 * Callao: el INEI lo registra como "Prov. Const. del Callao" y nadie lo llama
 * así. Rechazar "Callao" sería exigirle al cliente que sepa nomenclatura INEI.
 */
const ALIAS_PROVINCIA = {
  callao: 'prov. const. del callao',
  'provincia constitucional del callao': 'prov. const. del callao',
};

/**
 * Comprueba que la terna exista de verdad y esté bien anidada.
 * No basta con que los tres nombres existan: el distrito tiene que pertenecer
 * a esa provincia, y la provincia a ese departamento.
 *
 * @returns {{ok:true, valor:{departamento,provincia,distrito,codigo}} | {ok:false, error:string}}
 */
export function validarUbigeo({ departamento, provincia, distrito }) {
  const dep = porDepartamento.get(normalizar(departamento));
  if (!dep) return { ok: false, error: 'Elige un departamento válido.' };

  const clave = normalizar(provincia);
  const prov = dep.provincias.get(clave) || dep.provincias.get(ALIAS_PROVINCIA[clave]);
  if (!prov) {
    return { ok: false, error: `"${provincia}" no es una provincia de ${dep.nombre}.` };
  }

  const dist = prov.distritos.get(normalizar(distrito));
  if (!dist) {
    return { ok: false, error: `"${distrito}" no es un distrito de ${prov.nombre}.` };
  }

  return {
    ok: true,
    valor: {
      departamento: dep.nombre,
      provincia: prov.nombre,
      distrito: dist.nombre,
      codigo: dist.codigo,
    },
  };
}

/**
 * Zona de reparto y costo que corresponde a un ubigeo ya validado.
 * Fuera de Lima Metropolitana y Callao se despacha por agencia, y el flete lo
 * paga el cliente en destino: por eso el costo es null, no cero.
 */
export function zonaDe({ departamento, provincia, distrito }) {
  // `provincia` ya viene normalizada por validarUbigeo, así que aquí llega el
  // nombre oficial ("Prov. Const. del Callao"), no el que escribió el cliente.
  const esLimaMetro = normalizar(departamento) === 'lima' && normalizar(provincia) === 'lima';
  const esCallao = normalizar(departamento) === 'callao';

  if (!esLimaMetro && !esCallao) {
    const pr = TIENDA.delivery.provincias;
    return {
      tipo: 'provincia',
      nombre: `${provincia}, ${departamento}`,
      costo: null,
      horas: pr.plazo,
      nota: pr.habilitado ? pr.quienPaga : 'no repartimos fuera de Lima',
      disponible: pr.habilitado,
    };
  }

  const d = normalizar(distrito);
  for (const zona of TIENDA.delivery.zonas) {
    if (zona.distritos.some((x) => normalizar(x) === d)) {
      return {
        tipo: 'lima', nombre: zona.nombre, costo: zona.costo,
        horas: zona.horas, disponible: true,
      };
    }
  }

  // Lima o Callao pero fuera de las zonas nombradas: cae en la tarifa general.
  const resto = TIENDA.delivery.zonas.at(-1);
  return {
    tipo: 'lima', nombre: resto.nombre, costo: resto.costo,
    horas: resto.horas, disponible: true,
  };
}

/** Lista de departamentos, para el formulario. */
export const departamentos = () =>
  [...porDepartamento.values()].map((d) => d.nombre).sort((a, b) => a.localeCompare(b, 'es'));
