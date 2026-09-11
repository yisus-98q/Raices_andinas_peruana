/**
 * Validación de documentos de identidad peruanos.
 *
 * DNI: ocho dígitos. El dígito verificador que aparece impreso en el carné no
 * forma parte del número que la gente escribe, así que aquí solo se comprueba
 * el formato — validarlo de verdad exige consultar a RENIEC.
 *
 * RUC: once dígitos CON dígito verificador comprobado por módulo 11. Esto sí
 * se puede validar sin consultar a nadie, y filtra la mayoría de las erratas
 * antes de que lleguen a un comprobante.
 */

/** Prefijos de RUC que SUNAT tiene asignados. */
const PREFIJOS_RUC = {
  10: 'persona natural con negocio',
  15: 'persona natural (régimen antiguo)',
  16: 'persona natural',
  17: 'persona jurídica (régimen antiguo)',
  20: 'persona jurídica',
};

/** Pesos del módulo 11 para los diez primeros dígitos del RUC. */
const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

const soloDigitos = (t) => String(t ?? '').replace(/\D/g, '');

/** Dígito verificador que le corresponde a los diez primeros dígitos. */
export function digitoVerificadorRuc(diezDigitos) {
  const d = soloDigitos(diezDigitos).slice(0, 10);
  if (d.length !== 10) return null;
  const suma = PESOS.reduce((s, peso, i) => s + Number(d[i]) * peso, 0);
  const resto = suma % 11;
  const dv = 11 - resto;
  return dv === 10 ? 0 : dv === 11 ? 1 : dv;
}

/**
 * @returns {{ok: true, valor: string} | {ok: false, error: string}}
 */
export function validarRuc(entrada) {
  const ruc = soloDigitos(entrada);
  if (ruc.length !== 11) {
    return { ok: false, error: 'El RUC debe tener 11 dígitos.' };
  }
  const prefijo = ruc.slice(0, 2);
  if (!PREFIJOS_RUC[prefijo]) {
    return {
      ok: false,
      error: `Un RUC no empieza en ${prefijo}. Los válidos empiezan en ` +
        Object.keys(PREFIJOS_RUC).join(', ') + '.',
    };
  }
  if (Number(ruc[10]) !== digitoVerificadorRuc(ruc)) {
    // Es el error típico: un dígito cambiado al copiar. Vale la pena decirlo
    // claro, porque el cliente cree que escribió bien.
    return { ok: false, error: 'El RUC no es válido: revisa los dígitos.' };
  }
  return { ok: true, valor: ruc, tipo: PREFIJOS_RUC[prefijo] };
}

export function validarDni(entrada) {
  const dni = soloDigitos(entrada);
  if (dni.length !== 8) return { ok: false, error: 'El DNI debe tener 8 dígitos.' };
  if (/^0{8}$/.test(dni)) return { ok: false, error: 'El DNI no es válido.' };
  return { ok: true, valor: dni };
}

/**
 * Documento + comprobante que le corresponde.
 * DNI -> boleta. RUC -> factura, y la factura exige razón social.
 */
export function validarDocumento({ tipo, numero, razonSocial }) {
  const t = String(tipo || '').toUpperCase();

  if (t === 'DNI') {
    const r = validarDni(numero);
    if (!r.ok) return r;
    return { ok: true, tipo: 'DNI', numero: r.valor, comprobante: 'boleta', razonSocial: '' };
  }

  if (t === 'RUC') {
    const r = validarRuc(numero);
    if (!r.ok) return r;
    const rs = String(razonSocial || '').trim();
    if (rs.length < 3) {
      return { ok: false, error: 'Para factura necesitamos la razón social.' };
    }
    if (rs.length > 120) {
      return { ok: false, error: 'La razón social es demasiado larga.' };
    }
    return { ok: true, tipo: 'RUC', numero: r.valor, comprobante: 'factura', razonSocial: rs };
  }

  return { ok: false, error: 'Elige DNI o RUC.' };
}

/** Correo: comprobación de forma, no de existencia del buzón. */
export function validarCorreo(entrada, obligatorio = false) {
  const c = String(entrada || '').trim().toLowerCase();
  if (!c) {
    return obligatorio
      ? { ok: false, error: 'Necesitamos tu correo para enviarte el comprobante.' }
      : { ok: true, valor: '' };
  }
  if (c.length > 120 || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(c)) {
    return { ok: false, error: 'El correo no parece válido.' };
  }
  return { ok: true, valor: c };
}

/** Celular peruano: nueve dígitos empezando en 9. Fijo de Lima: 7 u 8 dígitos. */
export function validarTelefono(entrada) {
  const t = soloDigitos(entrada).replace(/^51/, '');
  if (/^9\d{8}$/.test(t)) return { ok: true, valor: t, tipo: 'celular' };
  if (/^\d{7,8}$/.test(t)) return { ok: true, valor: t, tipo: 'fijo' };
  return { ok: false, error: 'El teléfono debe ser un celular de 9 dígitos o un fijo.' };
}
