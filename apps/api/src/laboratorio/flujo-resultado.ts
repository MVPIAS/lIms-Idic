/**
 * Reglas del ciclo de vida del resultado que aplican la captura y la revisión
 * por OT · LIMS IDIC. Funciones PURAS (sin BD): flujo-resultado.spec.ts.
 *
 *   pendiente ──captura──▶ capturado ──revisar──▶ revisado_n1 ──aprobar──▶ aprobado
 *                              ▲  │                    │
 *                              │  └──── devolver ──────┴──▶ devuelto
 *                              └──── corrección (nueva captura) ◀──┘
 *
 * · `pendiente`: el ensayo está pedido (lo generó el registro de la OT) pero
 *   aún no tiene valor. No cuenta como «por revisar».
 * · Capturar de nuevo un resultado `capturado`, `devuelto` o `rechazado` lo
 *   deja en `capturado` (es la corrección). Uno `revisado_n1` o `aprobado` NO
 *   se puede sobrescribir: hay que devolverlo antes (lo revisado no cambia a
 *   espaldas de quien lo revisó).
 * · Segregación de funciones (ISO/IEC 17025): quien capturó no revisa ni
 *   aprueba lo suyo.
 */

export const ESTADOS_CAPTURABLES = ["pendiente", "capturado", "devuelto", "rechazado"] as const;

/** Motivo por el que no se puede capturar sobre ese estado (null = se puede). */
export function motivoNoCapturable(estado: string | null | undefined): string | null {
  const e = estado ?? "pendiente";
  if ((ESTADOS_CAPTURABLES as readonly string[]).includes(e)) return null;
  if (e === "revisado_n1")
    return "El resultado ya fue revisado. Para corregirlo, el revisor o la jefatura debe devolverlo primero.";
  if (e === "aprobado") return "El resultado está aprobado y no se puede modificar.";
  return `El resultado está en un estado no reconocido ('${e}').`;
}

export type AccionRevision = "revisar" | "aprobar";

export interface ResultadoParaAccion {
  id: string;
  estado: string;
  analistaId: string | null;
}

export interface Omitido {
  id: string;
  motivo: string;
}

/** Estado de partida que exige cada acción. */
const ORIGEN: Record<AccionRevision, string> = { revisar: "capturado", aprobar: "revisado_n1" };

/**
 * Para la acción sobre una OT completa: qué resultados se pueden revisar /
 * aprobar y cuáles no (con el motivo, para decírselo a la persona).
 */
export function clasificarParaAccion(
  resultados: ResultadoParaAccion[],
  accion: AccionRevision,
  usuarioId: string | undefined,
): { aplicables: string[]; omitidos: Omitido[] } {
  const aplicables: string[] = [];
  const omitidos: Omitido[] = [];
  const origen = ORIGEN[accion];
  for (const r of resultados) {
    if (r.estado !== origen) continue; // no está en la etapa: ni se cuenta
    if (usuarioId && r.analistaId && r.analistaId === usuarioId) {
      omitidos.push({ id: r.id, motivo: "Lo capturó usted: debe revisarlo o aprobarlo otra persona." });
      continue;
    }
    aplicables.push(r.id);
  }
  return { aplicables, omitidos };
}
