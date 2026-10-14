/**
 * Laboratorio responsable de la OT · reglas PURAS (sin BD) · LIMS IDIC.
 * Pruebas: laboratorio-ot.spec.ts. La parte con BD está en laboratorio-ot.service.ts.
 *
 * Toda OT nace con su laboratorio (orden_trabajo.unidad_principal); sin él
 * ningún analista, revisor ni jefe de laboratorio la ve (el alcance por unidad
 * filtra por esa columna). Orden de preferencia:
 *
 *   1. El que indica la persona (selector «Laboratorio responsable»).
 *   2. El deducido del catálogo / cotización, SOLO si todas las pistas apuntan
 *      a UNA misma unidad:
 *        · centro de costo de la cotización o laboratorio ejecutor (centro_costo.unidad_id)
 *        · familia (CODSUCDEL) de los ensayos de la cotización (cat_ensayo.familia_id)
 *        · familia de los elementos y de los métodos elegidos al registrar la OT
 *   3. Si no hay pistas o apuntan a laboratorios distintos: se EXIGE elegirlo.
 *
 * Las OT del SAEC nacen en la Delegación Nº 11 (unidad `D11`).
 */

export const CODIGO_UNIDAD_SAEC = "D11";

/** Tipos de unidad que pueden ser responsables de una OT. */
export const TIPOS_UNIDAD_OPERATIVA = ["LABORATORIO", "SECCION", "SUCURSAL", "DELEGACION"] as const;

export interface PistaLaboratorio {
  unidadId: string;
  /** de dónde sale la pista (para explicarlo en pantalla) */
  fuente: "centro_costo" | "ensayo" | "elemento" | "metodo";
}

export interface Deduccion {
  unidadId: string | null;
  /** unidades distintas encontradas (más de una = ambigua) */
  candidatos: string[];
  fuentes: string[];
  motivo: "deducido" | "sin_pistas" | "ambiguo";
}

/**
 * El centro de costo es la pista más fuerte: lo eligió Comercial al cotizar.
 * Si existe, manda sobre las familias de los ensayos (una cotización de LQC
 * puede incluir un ensayo cuyo catálogo cuelga de otro laboratorio y que LQC
 * derivará por orden interna). Sin centro de costo, las demás pistas deben
 * coincidir todas.
 */
export function deducirLaboratorio(pistas: PistaLaboratorio[]): Deduccion {
  const validas = pistas.filter((p) => Boolean(p.unidadId));
  if (!validas.length) return { unidadId: null, candidatos: [], fuentes: [], motivo: "sin_pistas" };

  const porCentro = [...new Set(validas.filter((p) => p.fuente === "centro_costo").map((p) => p.unidadId))];
  if (porCentro.length === 1) {
    return { unidadId: porCentro[0], candidatos: porCentro, fuentes: ["centro_costo"], motivo: "deducido" };
  }

  const unicas = [...new Set(validas.map((p) => p.unidadId))];
  const fuentes = [...new Set(validas.map((p) => p.fuente))];
  if (unicas.length === 1) return { unidadId: unicas[0], candidatos: unicas, fuentes, motivo: "deducido" };
  return { unidadId: null, candidatos: unicas, fuentes, motivo: "ambiguo" };
}

/** Mensaje para la persona cuando hay que elegir el laboratorio a mano. */
export function mensajeLaboratorioRequerido(d: Deduccion): string {
  if (d.motivo === "ambiguo")
    return `Los ensayos corresponden a ${d.candidatos.length} laboratorios distintos. Indique el laboratorio responsable de la OT (unidadPrincipalId).`;
  return "No se pudo deducir el laboratorio responsable desde el catálogo. Indique el laboratorio responsable de la OT (unidadPrincipalId).";
}

/** Una unidad del CODSUCDEL puede traer varios códigos («3009/3008»). */
export function codigosSucdel(codsucdel: string | null | undefined): string[] {
  return String(codsucdel ?? "")
    .split(/[\/,;\s]+/)
    .map((c) => c.trim())
    .filter(Boolean);
}
