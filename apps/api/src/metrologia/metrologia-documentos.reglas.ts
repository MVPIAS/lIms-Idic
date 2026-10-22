/**
 * Documentos del instrumento que NO se calibra en el laboratorio (EP-04 P2.2–P2.4) ·
 * reglas PURAS, probadas en metrologia-documentos.reglas.spec.ts.
 *
 *   Informe técnico (P2.3, no calibrable):
 *     borrador ─enviar (metrólogo)─▶ en_firma ─emitir (jefatura)─▶ emitido ─entregar─▶ (entregado)
 *        ▲                              │
 *        └──────── devolver (motivo) ───┘
 *
 *   Servicio externo (P2.4):
 *     solicitado (Jefe Lab.) ─aprobar (Jefe de Departamento)─▶ aprobado ─envío (proveedor, O/C)─▶ enviado
 *        │                                                                                      │
 *        └─rechazar (motivo)─▶ rechazado          certificado externo (PDF, N°) + validar ─▶ validado
 *
 * Solo para el ítem recibido como «no se puede calibrar» (estado no_apto). Un documento
 * vigente por ítem de cada tipo. Formatos, firmantes y cobro: POR CONFIRMAR (EP-04 §10 P5, P6).
 */

export type EstadoInforme = "borrador" | "en_firma" | "emitido" | "anulado";
export type AccionInforme = "GUARDAR" | "ENVIAR" | "EMITIR" | "DEVOLVER" | "ENTREGAR";
export type EstadoExterno = "solicitado" | "aprobado" | "enviado" | "validado" | "rechazado" | "anulado";
export type AccionExterno = "SOLICITAR" | "APROBAR" | "RECHAZAR" | "ENVIO" | "CERTIFICADO" | "VALIDAR";

export interface ItemDoc { numero: number; estado: string; otEstado: string; calibrable?: boolean | null }
export interface InformeDoc { estado: EstadoInforme; entregadoAt?: Date | string | null; elaboradoPor?: string | null }
export interface ExternoDoc { estado: EstadoExterno; certificadoNumero?: string | null; tieneCertificado?: boolean; fechaEnvio?: string | null }

const cerrada = (e: string) => e === "cerrada" || e === "anulada";
const item = (i: ItemDoc) => `ítem ${i.numero}`;

/** Por qué no se puede hacer la acción sobre el informe técnico (null = se puede). */
export function motivoInforme(accion: AccionInforme, i: ItemDoc, inf: InformeDoc | null, d: { hallazgos?: string | null; motivo?: string | null } = {}): string | null {
  if (cerrada(i.otEstado) && accion !== "ENTREGAR") return `La OT está ${i.otEstado}.`;
  if (i.estado !== "no_apto" && !(i.estado === "devuelto" && i.calibrable === false && inf)) return `El informe técnico es para el instrumento recibido como no calibrable: el ${item(i)} está ${String(i.estado).replace("_", " ")}.`;
  switch (accion) {
    case "GUARDAR":
      if (inf && inf.estado !== "borrador") return `El informe técnico del ${item(i)} ya se envió a firma: solo se corrige si lo devuelven.`;
      if (!d.hallazgos || d.hallazgos.trim().length < 5) return "Describa los hallazgos (mínimo 5 caracteres).";
      if (!d.motivo || d.motivo.trim().length < 5) return "Indique por qué no se calibra (mínimo 5 caracteres).";
      return null;
    case "ENVIAR":
      if (!inf) return "Primero guarde el informe técnico.";
      return inf.estado === "borrador" ? null : `El informe técnico ya está ${inf.estado === "en_firma" ? "en firma" : inf.estado}.`;
    case "EMITIR":
    case "DEVOLVER":
      if (!inf || inf.estado !== "en_firma") return "El informe técnico no está en firma.";
      return null;
    case "ENTREGAR":
      if (!inf || inf.estado !== "emitido") return "Solo se entrega un informe técnico emitido.";
      if (inf.entregadoAt) return "La entrega del informe técnico ya está registrada.";
      return null;
  }
}

/** Por qué no se puede hacer la acción sobre el servicio externo (null = se puede). */
export function motivoExterno(
  accion: AccionExterno, i: ItemDoc, ext: ExternoDoc | null,
  d: { justificacion?: string | null; proveedorId?: string | null; motivo?: string | null; ocNumero?: string | null; fechaEnvio?: string | null;
    certificadoNumero?: string | null; fechaRetorno?: string | null; aptitud?: string | null } = {},
): string | null {
  if (cerrada(i.otEstado)) return `La OT está ${i.otEstado}.`;
  if (i.estado !== "no_apto") return `El servicio externo es para el instrumento que el laboratorio no puede calibrar: el ${item(i)} está ${String(i.estado).replace("_", " ")}.`;
  const vivo = ext && !["rechazado", "anulado"].includes(ext.estado);
  switch (accion) {
    case "SOLICITAR":
      if (vivo) return `El ${item(i)} ya tiene un servicio externo ${ext!.estado}.`;
      if (!d.proveedorId) return "Elija el proveedor del maestro de proveedores.";
      if (!d.justificacion || d.justificacion.trim().length < 5) return "Indique la justificación (mínimo 5 caracteres).";
      return null;
    case "APROBAR":
    case "RECHAZAR":
      if (!ext || ext.estado !== "solicitado") return "No hay una solicitud de servicio externo por aprobar.";
      if (accion === "RECHAZAR" && (!d.motivo || d.motivo.trim().length < 5)) return "Indique el motivo del rechazo (mínimo 5 caracteres).";
      return null;
    case "ENVIO":
      if (!ext || ext.estado !== "aprobado") return "La contratación del servicio externo aún no está aprobada por el Jefe de Departamento.";
      if (!d.fechaEnvio) return "Indique la fecha de envío al proveedor.";
      return null;
    case "CERTIFICADO":
      if (!ext || ext.estado !== "enviado") return "El instrumento aún no se ha enviado al proveedor.";
      if (!d.certificadoNumero || !d.certificadoNumero.trim()) return "Indique el número del certificado externo.";
      if (d.fechaRetorno && ext.fechaEnvio && d.fechaRetorno < ext.fechaEnvio) return "La fecha de retorno no puede ser anterior a la de envío.";
      return null;
    case "VALIDAR":
      if (!ext || ext.estado !== "enviado") return "No hay un servicio externo enviado por validar.";
      if (!ext.tieneCertificado || !ext.certificadoNumero) return "Adjunte primero el certificado externo (PDF) y su número.";
      if (d.aptitud !== "apto" && d.aptitud !== "no_apto") return "Indique si el certificado externo es apto o no apto.";
      return null;
  }
}

/**
 * ¿Quedó resuelto el ítem no calibrable? Con el parámetro «el cierre técnico exige el
 * documento», necesita su informe técnico emitido o su servicio externo validado.
 */
export function noAptoResuelto(inf: InformeDoc | null, ext: ExternoDoc | null): boolean {
  return inf?.estado === "emitido" || ext?.estado === "validado";
}

/** ¿El PDF subido es un PDF (por sus bytes)? Máximo 10 MB. */
export const MAX_PDF_EXTERNO = 10 * 1024 * 1024;
export function revisarPdf(b: Buffer | undefined | null): { error: string } | { ok: true } {
  if (!b || !b.length) return { error: "Adjunte el certificado externo en PDF." };
  if (b.length > MAX_PDF_EXTERNO) return { error: "El PDF no puede superar 10 MB." };
  if (b.subarray(0, 5).toString("latin1") !== "%PDF-") return { error: "El archivo no es un PDF." };
  return { ok: true };
}
