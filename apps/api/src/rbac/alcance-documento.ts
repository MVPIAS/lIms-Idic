/**
 * ¿Quién abre un documento (informe, certificado) y sigue su circuito? · B-002
 * (recorrido MP-02, D02-33: el Jefe LQA no podía abrir los informes que él mismo
 * emitió para el LMB y el LES). Regla PURA, probada en alcance-documento.spec.ts.
 *
 *   · quien es responsable de un paso de su firma (como hasta ahora);
 *   · quien lo emitió;
 *   · quien tiene en su alcance el laboratorio del documento (el de su
 *     cobertura, p. ej. LMB) o el laboratorio responsable de su OT.
 */
export interface HechosDocumento {
  /** Laboratorio del documento (unidad de su cobertura o de la OT al emitir). */
  unidadId: string | null;
  /** Laboratorio responsable de la OT del documento. */
  otUnidadId: string | null;
  emitidoPor: string | null;
  responsables: string[];
}

export function puedeVerDocumento(h: HechosDocumento, usuarioId: string | null | undefined, ve: (unidad: string | null) => boolean): boolean {
  if (usuarioId && (h.responsables.includes(usuarioId) || h.emitidoPor === usuarioId)) return true;
  return ve(h.unidadId) || (!!h.otUnidadId && ve(h.otUnidadId));
}
