/**
 * Veredicto decidido a mano por el revisor («Decidir…») · reglas PURAS
 * (veredicto-decidido.spec.ts). Recorrido MP-02, D02-35 / B-032.
 *
 * Cuando el sistema no puede decidir (p. ej. «< 100» frente a «Máx. 10»: el
 * límite de detección está por encima del requisito), el revisor decide. La
 * decisión debe quedar justificada y trazable (EP-02 3.5, §10.2):
 *   · el motivo es obligatorio (mínimo 5 caracteres);
 *   · queda en la bitácora del resultado (resultado_historial, con el motivo);
 *   · el informe lo anota en la observación del ensayo.
 */
export const MOTIVO_VEREDICTO_MIN = 5;

/** Error si el motivo no sirve; null si está bien. */
export function errorMotivoVeredicto(motivo: unknown): string | null {
  const t = typeof motivo === "string" ? motivo.trim() : "";
  if (t.length < MOTIVO_VEREDICTO_MIN)
    return `Indique el motivo de la decisión (mínimo ${MOTIVO_VEREDICTO_MIN} caracteres): queda en la bitácora y en el informe.`;
  if (t.length > 500) return "El motivo admite hasta 500 caracteres.";
  return null;
}

/** Nota del informe para un veredicto decidido por el revisor. */
export function notaVeredictoDecidido(motivo: string | null | undefined, revisor?: string | null): string {
  const m = String(motivo ?? "").trim();
  if (!m) return "";
  return `Veredicto decidido por el revisor${revisor?.trim() ? ` (${revisor.trim()})` : ""}: ${m.replace(/\.+$/, "")}.`;
}

/** Observación del ensayo en el informe: la del analista y, si la hay, la nota de la decisión. */
export function observacionConDecision(observacion: string | null | undefined, motivo: string | null | undefined, revisor?: string | null): string | null {
  const partes = [String(observacion ?? "").trim(), notaVeredictoDecidido(motivo, revisor)].filter(Boolean);
  return partes.length ? partes.join(" ") : null;
}
