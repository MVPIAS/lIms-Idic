/**
 * Alcance por ENSAYO dentro de una OT · LIMS IDIC (recorrido MP-02, D02-02 y D02-04).
 *
 * Una OT tiene un laboratorio responsable, pero una misma muestra puede llevar
 * ensayos que se derivan a otro laboratorio por orden interna (EP-02 §2 «cada
 * laboratorio ejecuta y aprueba su parte»; EP-01 0.6 «el laboratorio ejecutor
 * ve solo sus ensayos»). El dueño de cada ensayo lo da la función SQL
 * `lims_lab_de_resultado` (packages/db/align_r1g_recorrido.sql):
 *   · derivado por una orden interna no anulada → el laboratorio de DESTINO;
 *   · si no → el laboratorio responsable de la OT.
 *
 * Reglas (funciones PURAS; alcance-resultado.spec.ts):
 *   VER       · el responsable de la OT ve todos sus ensayos (los derivados, en
 *               solo lectura); el destino ve solo los que se le derivaron.
 *   CAPTURAR, REVISAR, APROBAR, DEVOLVER, VEREDICTO
 *             · ensayo propio de la OT: quien tiene alcance sobre el responsable;
 *             · ensayo derivado: SOLO el laboratorio de destino y SOLO mientras la
 *               orden interna está «recibida» (tal como ya capturaba la API, r1b).
 *               Al cerrarla, el destino devuelve los resultados aprobados.
 *   REABRIR   · derivado: el destino, con la orden recibida o cerrada (al
 *               reabrir, la orden vuelve a «recibida» para corregir y aprobar).
 */
export type AccionResultado = "ver" | "capturar" | "revisar" | "aprobar" | "reabrir";

export interface LabDeResultado {
  /** Laboratorio dueño del ensayo (destino si es derivado). */
  unidadId: string | null;
  /** Laboratorio responsable de la OT. */
  principalId: string | null;
  derivado: boolean;
  ordenInternaId: string | null;
  oiNumero: string | null;
  oiEstado: string | null;
  /** Código del laboratorio dueño (para los mensajes y la pantalla). */
  unidadCodigo?: string | null;
}

export interface DecisionAlcance {
  permitido: boolean;
  /** 403 = no es de su laboratorio · 409 = es suyo, pero la orden interna no está recibida. */
  status: 200 | 403 | 409;
  motivo: string | null;
}

const OK: DecisionAlcance = { permitido: true, status: 200, motivo: null };

/**
 * ¿Puede el usuario hacer `accion` sobre el ensayo?
 * `ve(unidad)` = el usuario tiene alcance sobre esa unidad con el permiso de la acción.
 */
export function decidirAccionResultado(
  lab: LabDeResultado,
  accion: AccionResultado,
  ve: (unidadId: string | null) => boolean,
  ensayo = "el ensayo",
): DecisionAlcance {
  if (!lab.derivado) {
    if (ve(lab.principalId)) return OK;
    return { permitido: false, status: 403, motivo: `Fuera de su alcance: ${ensayo} pertenece a una unidad que usted no tiene asignada` };
  }
  const destino = lab.unidadCodigo ?? "el laboratorio de destino";
  const oi = lab.oiNumero ? `la orden interna ${lab.oiNumero}` : "la orden interna";
  if (accion === "ver") {
    if (ve(lab.unidadId) || ve(lab.principalId)) return OK;
    return { permitido: false, status: 403, motivo: `Fuera de su alcance: ${ensayo} pertenece a una unidad que usted no tiene asignada` };
  }
  if (!ve(lab.unidadId))
    return {
      permitido: false,
      status: 403,
      motivo:
        `Fuera de su alcance: ${ensayo} se derivó a ${destino} por ${oi}; lo capturan, revisan y aprueban en ${destino}. ` +
        "Usted lo ve en solo lectura.",
    };
  const estado = lab.oiEstado ?? "abierta";
  if (estado === "recibida") return OK;
  if (accion === "reabrir" && estado === "cerrada") return OK;
  const como =
    estado === "abierta"
      ? "aún no se ha recibido: recíbala en «Órdenes internas» antes de trabajar sus ensayos"
      : `está ${estado}: sus ensayos ya se devolvieron al laboratorio solicitante`;
  return { permitido: false, status: 409, motivo: `${oi[0].toUpperCase()}${oi.slice(1)} ${como}.` };
}

/** Permiso con que se evalúa el alcance de cada acción. */
export const PERMISO_ACCION: Record<AccionResultado, string> = {
  ver: "resultado.ver",
  capturar: "resultado.crear",
  revisar: "resultado.revisar",
  aprobar: "resultado.aprobar",
  reabrir: "resultado.reabrir",
};

/* -------------------------------------------------------------------------- */
/* Segregación revisión ≠ aprobación (recorrido MP-06, D06-05)                 */
/* -------------------------------------------------------------------------- */

export interface ConfigSegregacion {
  /** «distintas» (por defecto) o «misma_persona». */
  modo: "distintas" | "misma_persona";
  /** Códigos de laboratorio donde la misma persona puede revisar y aprobar. */
  excepciones: string[];
}

export function configSegregacion(modo: string | null | undefined, excepciones: string | null | undefined): ConfigSegregacion {
  return {
    modo: String(modo ?? "").trim().toLowerCase() === "misma_persona" ? "misma_persona" : "distintas",
    excepciones: String(excepciones ?? "")
      .split(/[\s,;/]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  };
}

/**
 * Motivo por el que el usuario no puede APROBAR un resultado que él mismo
 * revisó (null = puede). Quien capturó ya está excluido por la otra regla.
 */
export function motivoMismoRevisor(
  r: { revisadoPor: string | null },
  usuarioId: string | null | undefined,
  cfg: ConfigSegregacion,
  laboratorio: string | null | undefined,
): string | null {
  if (!usuarioId || !r.revisadoPor || r.revisadoPor !== usuarioId) return null;
  if (cfg.modo === "misma_persona") return null;
  if (laboratorio && cfg.excepciones.includes(laboratorio.toUpperCase())) return null;
  return "Lo revisó usted: la aprobación la hace otra persona (revisión y aprobación por personas distintas).";
}
