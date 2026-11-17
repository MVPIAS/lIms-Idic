/**
 * Certificado o informe MODIFICADO y certificado de REEMPLAZO, para todos los
 * laboratorios (sesión LNF del 03-11-2026, R9):
 *
 *   · Modificación: corregir un documento ya emitido mientras la OT sigue abierta.
 *     Conserva el número con el sufijo de versión (N° X → X-V2 → X-V3) e imprime
 *     la leyenda «Documento modificado».
 *   · Reemplazo: el documento con error se sustituye por otro con número NUEVO que
 *     imprime «Este certificado reemplaza al certificado N° X». Vale también con la
 *     OT cerrada (hallazgos posteriores, auditoría).
 *
 * Funciones PURAS (leyenda-reemision.spec.ts): las usan Metrología y la emisión de
 * informes y certificados (plantilla-render).
 */

export type ModalidadReemision = "modificacion" | "reemplazo";
export const MODALIDADES_REEMISION: ModalidadReemision[] = ["modificacion", "reemplazo"];

export const esModalidadReemision = (x: unknown): x is ModalidadReemision =>
  x === "modificacion" || x === "reemplazo";

/** Número de la versión siguiente: X → X-V2; X-V2 → X-V3. */
export function numeroModificado(numeroAnterior: string): string {
  const m = /^(.*?)-V(\d+)$/i.exec(numeroAnterior.trim());
  if (!m) return `${numeroAnterior.trim()}-V2`;
  return `${m[1]}-V${Number(m[2]) + 1}`;
}

/** Versión que indica un número («X-V3» → 3; sin sufijo → 1). */
export function versionDeNumero(numero: string): number {
  const m = /-V(\d+)$/i.exec(numero.trim());
  return m ? Number(m[1]) : 1;
}

/**
 * ¿Se puede pedir esta reemisión? null si sí; si no, el motivo para la persona.
 * La modificación solo se admite con la OT abierta (con la OT cerrada, el
 * documento con error se reemplaza por uno nuevo).
 */
export function motivoNoReemite(m: { modalidad: ModalidadReemision; otCerrada: boolean; estadoDocumento: string; tipo?: "certificado" | "documento" }): string | null {
  const doc = m.tipo === "documento" ? "documento" : "certificado";
  const emitido = ["emitida", "oficial", "emitido"].includes(m.estadoDocumento);
  if (!emitido) return `Solo se modifica o reemplaza un ${doc} emitido.`;
  if (m.modalidad === "modificacion" && m.otCerrada)
    return `La OT ya está cerrada: el ${doc} no se puede modificar. Emita un ${doc} de reemplazo (número nuevo con la leyenda «reemplaza al N°»).`;
  return null;
}

const dmy = (iso: string | null | undefined): string | null => {
  const s = String(iso ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : null;
};

/**
 * Leyenda que imprime el documento nuevo. `fechaAnterior` en AAAA-MM-DD (hora
 * de Chile). Devuelve texto plano (quien lo imprime lo escapa).
 */
export function leyendaReemision(r: {
  modalidad: ModalidadReemision;
  numeroAnterior: string;
  fechaAnterior?: string | null;
  motivo?: string | null;
  tipo?: "certificado" | "documento";
}): string {
  const doc = r.tipo === "documento" ? "documento" : "certificado";
  const fecha = dmy(r.fechaAnterior);
  const motivo = String(r.motivo ?? "").trim();
  const conMotivo = motivo ? ` Motivo: ${motivo.replace(/\.$/, "")}.` : "";
  if (r.modalidad === "modificacion") {
    return `${doc === "documento" ? "DOCUMENTO MODIFICADO" : "CERTIFICADO MODIFICADO"}: esta versión reemplaza a la emitida con el N° ${r.numeroAnterior}${fecha ? ` el ${fecha}` : ""}.${conMotivo}`;
  }
  return `ESTE ${doc.toUpperCase()} REEMPLAZA AL ${doc.toUpperCase()} N° ${r.numeroAnterior}${fecha ? ` EMITIDO EL ${fecha}` : ""}.${conMotivo}`;
}
