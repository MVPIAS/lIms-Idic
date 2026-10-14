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
