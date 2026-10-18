/**
 * Código de verificación de los documentos emitidos · LIMS IDIC.
 * Único generador del sistema (revisión r3, hallazgo 17): informes y
 * certificados (plantilla-render), certificados de calibración (Metrología) y
 * documentos BPCH (clasificación UN, informe técnico de Producción Nacional).
 *
 * `randomInt` usa el CSPRNG del sistema (no Math.random).
 */
import { randomInt } from "crypto";

/** Formato del código: alfabeto y tamaño de cada grupo (separados por guiones). */
export interface FormatoCodigo {
  alfabeto: string;
  grupos: number[];
}

/**
 * Por defecto (informes, certificados y calibraciones): Crockford base32 sin
 * I/L/O/U —no se confunde 0/O ni 1/I al teclearlo desde el papel— en dos
 * grupos de 5 (~51 bits): «7K2QX-9MZT4».
 */
export const FORMATO_CROCKFORD: FormatoCodigo = { alfabeto: "0123456789ABCDEFGHJKMNPQRSTVWXYZ", grupos: [5, 5] };

/** Documentos BPCH (clasificación, informe técnico PN): tres grupos de 4 sin 0/1/I/O, como hasta ahora. */
export const FORMATO_BPCH: FormatoCodigo = { alfabeto: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", grupos: [4, 4, 4] };

export function nuevoCodigoVerificacion(formato: FormatoCodigo = FORMATO_CROCKFORD): string {
  return formato.grupos
    .map((n) => Array.from({ length: n }, () => formato.alfabeto[randomInt(formato.alfabeto.length)]).join(""))
    .join("-");
}

/** Formato admitido por la verificación pública por defecto (evita consultas con texto arbitrario). */
export const codigoVerificacionValido = (c: string) => /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/.test(c);
