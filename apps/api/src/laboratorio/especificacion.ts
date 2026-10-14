/**
 * Especificación y veredicto en el formulario de captura estándar · LIMS IDIC.
 * Funciones PURAS (sin BD): especificacion.spec.ts.
 *
 * Regla de la casa: nada espera a que el IDIC mande datos. Lo que el catálogo
 * heredado trae (Mín / Nom / Máx, unidad, requisito, fórmula) se precarga; lo
 * que no trae queda VACÍO Y EDITABLE en la captura y se guarda en el resultado
 * de ESA orden (no en el catálogo), marcado como «especificación de la orden».
 *
 *   · Rellenar un campo que el catálogo dejó vacío: quien captura (resultado.crear).
 *   · Cambiar un valor que vino del catálogo, o la fórmula: jefatura (resultado.aprobar).
 */
import { normalizarVeredicto, type Veredicto } from "./veredicto";

export type TipoDato = "numerico" | "atributo";

/** ¿El texto es un número (admite coma decimal)? */
export function esNumeroTexto(v: string | null | undefined): boolean {
  return /^\s*[+-]?(\d+([.,]\d+)?|[.,]\d+)\s*$/.test(String(v ?? ""));
}

const vacio = (v: string | null | undefined) => v == null || String(v).trim() === "";

/**
 * Tipo de dato con el que nace un ensayo:
 *   · numérico si alguna cota (Mín / Nom / Máx) es numérica;
 *   · atributo si la especificación es de texto (requisito o cota no numérica):
 *     el analista elige Cumple / No cumple;
 *   · numérico sin límites si no hay especificación (veredicto «informativo»).
 */
export function tipoDatoDe(e: { limiteInf?: string | null; nominal?: string | null; limiteSup?: string | null; requisito?: string | null }): TipoDato {
  const cotas = [e.limiteInf, e.nominal, e.limiteSup];
  if (cotas.some((c) => !vacio(c) && esNumeroTexto(c))) return "numerico";
  if (cotas.some((c) => !vacio(c)) || !vacio(e.requisito)) return "atributo";
  return "numerico";
}

/**
 * Veredicto de la muestra (lote) a partir de los de sus ensayos:
 *   · No cumple si algún ensayo no cumple;
 *   · Pendiente si falta alguno (sin valor o sin decidir);
 *   · Cumple si todos cumplen (los «informativos» no cuentan en contra);
 *   · Informativo si todos son informativos;
 *   · Pendiente si la muestra no tiene ensayos.
 */
export function veredictoMuestra(veredictos: (string | null | undefined)[]): Veredicto {
  if (!veredictos.length) return "pendiente";
  const vs = veredictos.map((v) => normalizarVeredicto(v) ?? "pendiente");
  if (vs.includes("no_cumple")) return "no_cumple";
  if (vs.includes("pendiente")) return "pendiente";
  if (vs.every((v) => v === "informativo")) return "informativo";
  return "cumple";
}

export const CAMPOS_ESPEC = ["limiteInf", "nominal", "limiteSup", "unidad", "requisito", "tipoDato", "formula"] as const;
export type CampoEspec = (typeof CAMPOS_ESPEC)[number];
export type Especificacion = Partial<Record<CampoEspec, string | null>>;

/**
 * Qué cambia una edición de la especificación de la orden y si exige jefatura.
 * `catalogo` es la copia de lo que trajo el catálogo al generar el ensayo.
 *   · fórmula: siempre jefatura;
 *   · tipo de dato: jefatura si el catálogo traía especificación;
 *   · campo que el catálogo traía con valor y se cambia: jefatura;
 *   · campo vacío en el catálogo que se rellena (o se vuelve a corregir): quien captura.
 */
export function planEdicion(
  actual: Especificacion,
  catalogo: Especificacion,
  pedido: Especificacion,
): { cambios: Especificacion; requiereJefatura: boolean; campos: CampoEspec[] } {
  const cambios: Especificacion = {};
  const campos: CampoEspec[] = [];
  let requiereJefatura = false;
  const catalogoTraeEspec = (["limiteInf", "nominal", "limiteSup", "requisito"] as CampoEspec[]).some((k) => !vacio(catalogo[k]));
  for (const c of CAMPOS_ESPEC) {
    if (!(c in pedido)) continue;
    const nuevo = vacio(pedido[c]) ? null : String(pedido[c]).trim();
    const previo = vacio(actual[c]) ? null : String(actual[c]).trim();
    if (nuevo === previo) continue;
    cambios[c] = nuevo;
    campos.push(c);
    if (c === "formula") requiereJefatura = true;
    else if (c === "tipoDato") {
      // El tipo es solo un valor por defecto si el catálogo no traía especificación.
      if (catalogoTraeEspec) requiereJefatura = true;
    } else if (!vacio(catalogo[c])) requiereJefatura = true;
  }
  return { cambios, requiereJefatura, campos };
}
