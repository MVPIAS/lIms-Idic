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

/**
 * Un resultado sin veredicto («pendiente» o vacío) no se revisa ni se aprueba
 * (recorrido MP-02, D02-03): el informe saldría con la condición «Pendiente».
 * Lo resuelve el revisor («Decidir…»: cumple, no cumple o informativo) o se
 * devuelve al analista. null = se puede.
 */
export function motivoSinVeredicto(veredicto: string | null | undefined, accion: "revisado_n1" | "aprobado"): string | null {
  const v = String(veredicto ?? "").trim().toLowerCase();
  if (v && v !== "pendiente") return null;
  const que = accion === "revisado_n1" ? "revisarlo" : "aprobarlo";
  return (
    `El resultado no tiene veredicto (Pendiente): decida Cumple, No cumple o Informativo con «Decidir…» antes de ${que}, ` +
    "o devuélvalo al analista. Un informe no puede salir con la condición «Pendiente»."
  );
}

/* -------------------------------------------------------------------------- */
/* Reapertura de un resultado aprobado (docs/FLUJO_LABORATORIO.md §4)          */
/* -------------------------------------------------------------------------- */

export interface DocumentoDeOt {
  id: string;
  numero: string | null;
  estado: string;
  entregadoAt?: Date | string | null;
}

/** Documentos que siguen valiendo para la OT: en firma u oficiales ('emitido' = oficial previo al circuito). */
const ESTADOS_DOC_VIGENTE = new Set(["en_firma", "oficial", "emitido"]);

/**
 * Qué pasa al reabrir un resultado aprobado:
 *  · solo se reabre lo `aprobado` (lo demás se corrige devolviéndolo);
 *  · no se reabre en una OT cerrada o anulada (ya facturada / sin efecto);
 *  · todo documento vigente de la OT (en firma u oficial) se ANULA: lleva el
 *    valor que se va a corregir. Tras aprobar de nuevo se REEMITE como nueva
 *    versión (docs/FLUJO_FIRMA_CIERRE.md: anular y reemitir);
 *  · si alguno ya se entregó al cliente se avisa, para comunicarle la anulación.
 */
export function planReapertura(
  estadoResultado: string | null | undefined,
  ot: { estado: string; codigo: string } | null,
  documentos: DocumentoDeOt[],
): { error: string | null; anular: DocumentoDeOt[]; avisos: string[] } {
  if (estadoResultado !== "aprobado")
    return {
      error: "Solo se reabre un resultado aprobado. Si aún no está aprobado, devuélvalo al analista con un motivo.",
      anular: [],
      avisos: [],
    };
  if (ot && (ot.estado === "cerrada" || ot.estado === "anulada"))
    return {
      error: `La OT ${ot.codigo} está ${ot.estado}: sus resultados ya no se pueden reabrir.`,
      anular: [],
      avisos: [],
    };
  const anular = documentos.filter((d) => ESTADOS_DOC_VIGENTE.has(d.estado));
  const avisos: string[] = [];
  if (anular.length)
    avisos.push(
      `Se anula${anular.length > 1 ? "n" : ""} ${anular.map((d) => d.numero ?? d.id).join(", ")}: ` +
        "cuando el resultado se apruebe de nuevo, reemita el documento como nueva versión.",
    );
  const entregados = anular.filter((d) => d.entregadoAt);
  if (entregados.length)
    avisos.push(
      `${entregados.map((d) => d.numero ?? d.id).join(", ")} ya se entregó al cliente: comuníquele la anulación y entréguele la nueva versión.`,
    );
  return { error: null, anular, avisos };
}

/**
 * Edición manual de un resultado (PATCH /resultados/:id: veredicto, unidad).
 * Revisión de seguridad r3: no sirve para saltarse la segregación de funciones.
 *  · El analista no se cambia a mano: es quien capturó (400).
 *  · Lo aprobado no se edita: se reabre (409).
 *  · Quien capturó el ensayo no decide su veredicto (409), igual que no lo revisa ni aprueba.
 * Devuelve { status, motivo } o null si procede.
 */
export function motivoEdicionManual(
  r: { estado: string; analistaId: string | null },
  usuarioId: string | null | undefined,
  cuerpo: Record<string, unknown>,
): { status: 400 | 409; motivo: string } | null {
  if ("analistaId" in cuerpo)
    return { status: 400, motivo: "El analista de un ensayo no se cambia a mano: es quien lo capturó (segregación de funciones)." };
  if (r.estado === "aprobado")
    return { status: 409, motivo: "El resultado está aprobado: para corregirlo, reábralo con motivo." };
  if (cuerpo.veredicto !== undefined && usuarioId && r.analistaId === usuarioId)
    return { status: 409, motivo: "Quien capturó el ensayo no decide su veredicto: lo hace otra persona (segregación de funciones)." };
  return null;
}
