/**
 * Independencia en el control de calidad (QC) · LIMS IDIC. Reglas PURAS,
 * probadas en reglas-qc.spec.ts. Misma regla que en resultados (ISO/IEC 17025):
 * quien registra un control no lo aprueba.
 *
 *  · Al registrar, el sistema evalúa el control contra su criterio. Si NO lo
 *    cumple queda «rechazado»; si lo cumple queda «pendiente» de aprobación,
 *    con la evaluación automática a la vista (`evaluacion`).
 *  · Aprobar exige `resultado.revisar` y ser OTRA persona que quien lo registró.
 *  · Rechazar o volver a pendiente es un acto correctivo: basta `resultado.crear`.
 *  · Los controles anteriores a esta regla (sin `registrado_por`) los aprueba
 *    cualquiera con `resultado.revisar`.
 */

export type ResultadoQc = "aprobado" | "rechazado" | "pendiente";

/* ------------------------------------------ QC por método (BL-167) --- */

/**
 * Tipos de control: blanco, estándar, curva, duplicado y, desde el frente r4d,
 * MRC (material de referencia certificado: % de recuperación del valor
 * certificado) y patrón de verificación (% del valor del patrón).
 */
export const TIPOS_QC = ["blanco", "estandar", "curva", "duplicado", "mrc", "patron"] as const;
export type TipoQc = (typeof TIPOS_QC)[number];

/**
 * Criterio por defecto de cada tipo cuando ni el control ni el método lo traen.
 * Los criterios por ensayo los entrega el IDIC (EP-01 §10 P11): mientras tanto
 * rigen estos, y cada método puede fijar los suyos (cat_metodo.qc_criterios).
 */
export const CRITERIO_DEFECTO: Record<TipoQc, string> = {
  blanco: "",
  estandar: "80-120",
  curva: "0.995",
  duplicado: "10",
  mrc: "90-110",
  patron: "95-105",
};

/** Criterio que se aplica: el del control, el del método para ese tipo o el por defecto. */
export function criterioAplicable(tipo: string, delControl: string | null | undefined, delMetodo: Record<string, string> | null | undefined): string | null {
  if (delControl && delControl.trim()) return delControl.trim();
  const m = delMetodo?.[tipo];
  if (m && String(m).trim()) return String(m).trim().replace(/,/g, ".");
  const d = (CRITERIO_DEFECTO as Record<string, string>)[tipo];
  return d ? d : null;
}

/**
 * Lo que falta para que el QC de un método esté aprobado en la OT: con tipos
 * exigidos, un control APROBADO de cada tipo; sin tipos, uno aprobado de
 * cualquier tipo (regla anterior).
 */
export function tiposQcFaltantes(exigidos: string[] | null | undefined, aprobados: string[]): string[] {
  const t = (exigidos ?? []).filter(Boolean);
  if (!t.length) return aprobados.length ? [] : ["cualquiera"];
  return t.filter((x) => !aprobados.includes(x));
}

export function erroresConfigQc(c: { qcTipos?: string[]; qcCriterios?: Record<string, string> }): string[] {
  const e: string[] = [];
  for (const t of c.qcTipos ?? []) if (!(TIPOS_QC as readonly string[]).includes(t)) e.push(`Tipo de control desconocido: ${t}.`);
  for (const [t, v] of Object.entries(c.qcCriterios ?? {})) {
    if (!(TIPOS_QC as readonly string[]).includes(t)) e.push(`Criterio de un tipo desconocido: ${t}.`);
    else if (v && !/\d/.test(String(v))) e.push(`El criterio de ${t} debe tener un número o un rango (p. ej. 90-110).`);
  }
  return e;
}

/** Estado con el que queda un control recién registrado según su evaluación automática. */
export function resultadoAlRegistrar(evaluacion: ResultadoQc): ResultadoQc {
  return evaluacion === "aprobado" ? "pendiente" : evaluacion;
}

/** Por qué el usuario no puede dejar el control en `nuevo` (null = puede). */
export function motivoNoRevisable(
  nuevo: ResultadoQc,
  control: { registradoPor: string | null },
  usuarioId: string | undefined,
  puedeRevisar: boolean,
): { codigo: 403 | 409; mensaje: string } | null {
  if (nuevo !== "aprobado") return null;
  if (!puedeRevisar)
    return { codigo: 403, mensaje: "Aprobar un control de calidad exige el permiso «resultado.revisar» (revisor o jefatura)." };
  if (control.registradoPor && usuarioId && control.registradoPor === usuarioId)
    return {
      codigo: 409,
      mensaje:
        "Segregación de funciones (ISO/IEC 17025): quien registró el control de calidad no puede aprobarlo. Debe hacerlo otra persona.",
    };
  return null;
}
