/**
 * Validez configurable por TIPO DE CLIENTE y LABORATORIO (Comercial, reunión 2 ·
 * 28-10-2026). Respuestas del IDIC: particulares 45 días (60 en Metrología y
 * Resistencia Balística); Ejército, Fuerzas Armadas y de Orden hasta el 31-12
 * (las emitidas desde octubre, 6 meses).
 *
 * Las reglas viven en `cotizacion_validez_regla` (align_sesiones_s1.sql) y se
 * mantienen en Comercial › Validez de cotizaciones. Cada regla indica un tipo
 * de cliente, un centro de costo (laboratorio) o ambos, y dice:
 *   · DIAS n     → n días corridos desde la emisión;
 *   · FIN_ANIO   → hasta el 31-12 del año de emisión (o m meses si se emite
 *                  entre octubre y diciembre).
 *
 * Prioridad (de la más específica a la general):
 *   1. tipo de cliente + laboratorio;
 *   2. tipo de cliente;
 *   3. si el tipo de cliente sigue la regla Particular: la del laboratorio;
 *   4. lo de antes: la regla del tipo de cliente (parámetro `tipo_cliente.valor`)
 *      con los días del centro de costo o los generales.
 *
 * Función PURA: validez-config.spec.ts.
 */
import type { ReglaValidez } from "./validez";

export type TipoRegla = "DIAS" | "FIN_ANIO";

export interface ReglaValidezConfig {
  id?: string;
  tipoCliente: string | null;
  centroCostoId: string | null;
  regla: TipoRegla;
  dias?: number | null;
  mesesOctDic?: number | null;
  activo?: boolean;
}

export interface ReglaResuelta {
  regla: ReglaValidez;
  /** Días (regla Particular) que fija la configuración; null = usar los del centro de costo o los generales. */
  dias: number | null;
  /** Meses de la regla Ejército para oct–dic; null = parámetro general. */
  meses: number | null;
  /** De dónde salió: para la explicación en pantalla. */
  origen: "tipo_laboratorio" | "tipo" | "laboratorio" | "general";
}

const aRegla = (r: ReglaValidezConfig, origen: ReglaResuelta["origen"]): ReglaResuelta =>
  r.regla === "FIN_ANIO"
    ? { regla: "EJERCITO", dias: null, meses: r.mesesOctDic && r.mesesOctDic > 0 ? r.mesesOctDic : null, origen }
    : { regla: "PARTICULAR", dias: r.dias && r.dias > 0 ? r.dias : null, meses: null, origen };

export function resolverReglaValidez(
  reglas: ReglaValidezConfig[],
  q: { tipoCliente: string | null; centroCostoId: string | null; base: ReglaValidez },
): ReglaResuelta {
  const activas = reglas.filter((r) => r.activo !== false && (r.regla === "FIN_ANIO" || (r.dias ?? 0) > 0));
  const tipo = q.tipoCliente || null;
  const cc = q.centroCostoId || null;
  const exacta = tipo && cc ? activas.find((r) => r.tipoCliente === tipo && r.centroCostoId === cc) : undefined;
  if (exacta) return aRegla(exacta, "tipo_laboratorio");
  const delTipo = tipo ? activas.find((r) => r.tipoCliente === tipo && !r.centroCostoId) : undefined;
  if (delTipo) return aRegla(delTipo, "tipo");
  if (q.base === "PARTICULAR" && cc) {
    const delLab = activas.find((r) => r.centroCostoId === cc && !r.tipoCliente && r.regla === "DIAS");
    if (delLab) return aRegla(delLab, "laboratorio");
  }
  return { regla: q.base, dias: null, meses: null, origen: "general" };
}

/** Errores de una regla antes de guardarla (vacío = OK). */
export function erroresRegla(r: Partial<ReglaValidezConfig>): string[] {
  const e: string[] = [];
  if (!r.tipoCliente && !r.centroCostoId) e.push("Indique el tipo de cliente, el laboratorio o ambos.");
  if (r.regla !== "DIAS" && r.regla !== "FIN_ANIO") e.push("La regla debe ser «Días» o «Hasta el 31 de diciembre».");
  if (r.regla === "DIAS" && !(Number.isInteger(Number(r.dias)) && Number(r.dias) >= 1 && Number(r.dias) <= 730))
    e.push("Indique los días de validez (entero entre 1 y 730).");
  if (r.regla === "FIN_ANIO" && r.mesesOctDic != null && !(Number.isInteger(Number(r.mesesOctDic)) && Number(r.mesesOctDic) >= 1 && Number(r.mesesOctDic) <= 24))
    e.push("Los meses para las emitidas entre octubre y diciembre deben ser un entero entre 1 y 24.");
  return e;
}

/** Texto del origen para la explicación de la validez. */
export function textoOrigenRegla(origen: ReglaResuelta["origen"]): string | null {
  switch (origen) {
    case "tipo_laboratorio":
      return "regla configurada para este tipo de cliente y laboratorio";
    case "tipo":
      return "regla configurada para este tipo de cliente";
    case "laboratorio":
      return "validez configurada para el laboratorio";
    default:
      return null;
  }
}
