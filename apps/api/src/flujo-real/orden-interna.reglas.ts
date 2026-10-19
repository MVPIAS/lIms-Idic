/**
 * Órdenes internas · reglas PURAS (sin BD), probadas en orden-interna.reglas.spec.ts.
 *
 * Una orden interna deriva parte de una OT a OTRO laboratorio: se elige el
 * laboratorio de destino (familia del catálogo, enlazada con su unidad del
 * organigrama por CODSUCDEL) y los ensayos del catálogo que le corresponden.
 *
 *  · Ciclo: abierta → recibida → cerrada. Mientras está ABIERTA (el laboratorio
 *    de destino aún no la recibe) se edita y se puede borrar; después solo
 *    avanza de estado. Se anula con motivo en cualquier estado salvo cerrada.
 *  · El destino no puede ser el laboratorio responsable de la OT.
 *  · Los ensayos deben ser de la familia del destino (no se derivan ensayos de
 *    otro laboratorio) y no se repiten.
 *  · La OT de origen debe estar en el alcance de quien crea, edita o anula
 *    (lo impone el controlador con AlcanceService; ver orden-interna-alcance.spec.ts).
 */

export const ESTADOS_OI = ["abierta", "recibida", "cerrada", "anulada"] as const;
export type EstadoOi = (typeof ESTADOS_OI)[number];

/** Siguiente estado válido desde cada estado (sin contar anular). */
const SIGUIENTE: Record<string, string[]> = {
  abierta: ["recibida"],
  recibida: ["cerrada"],
  cerrada: [],
  anulada: [],
};

/** Campos de contenido: solo cambian mientras la orden está abierta. */
export const CAMPOS_CONTENIDO = ["tipo", "destinoLab", "origenLab", "ensayos", "detalle"] as const;

export interface CambioOi {
  tipo?: string;
  destinoLab?: string | null;
  origenLab?: string | null;
  ensayos?: string[];
  detalle?: string | null;
  estado?: string;
  otId?: string;
}

/** Normaliza la lista de ensayos: sin vacíos ni repetidos. */
export function normalizarEnsayos(ensayos?: string[] | null): string[] {
  return [...new Set((ensayos ?? []).map((e) => String(e).trim()).filter(Boolean))];
}

/**
 * Errores del contenido de la orden (lista vacía = válida).
 * @param destinoEsPrincipal el destino es el laboratorio responsable de la OT
 * @param ensayosDelDestino ids de cat_ensayo de la familia de destino (vigentes)
 */
export function erroresContenido(d: {
  destinoLab?: string | null;
  ensayos?: string[];
  destinoEsPrincipal?: boolean;
  ensayosDelDestino?: Set<string> | null;
}): string[] {
  const e: string[] = [];
  const ensayos = normalizarEnsayos(d.ensayos);
  if (d.destinoEsPrincipal) e.push("El laboratorio de destino es el responsable de la OT: una orden interna se emite a OTRO laboratorio.");
  if (ensayos.length && !d.destinoLab) e.push("Indique el laboratorio de destino de los ensayos.");
  if (ensayos.length && d.ensayosDelDestino) {
    const ajenos = ensayos.filter((x) => !d.ensayosDelDestino!.has(x));
    if (ajenos.length) e.push(`${ajenos.length} ensayo(s) no son del laboratorio de destino: elija solo ensayos de ese laboratorio.`);
  }
  if (ensayos.length > 200) e.push("Como máximo 200 ensayos por orden interna.");
  return e;
}

/**
 * ¿Se puede aplicar el cambio a una orden en `estado`? Devuelve el motivo del
 * rechazo o null. Reglas: la OT de una orden no cambia; el contenido solo
 * mientras está abierta; el estado avanza de uno en uno (abierta → recibida →
 * cerrada); anulada y cerrada no cambian; anular tiene su propia acción.
 */
export function motivoNoEditable(estado: string | null | undefined, cambio: CambioOi): string | null {
  const actual = estado ?? "abierta";
  if (cambio.otId !== undefined) return "La OT de una orden interna no se cambia: anúlela y emita otra en la OT correcta.";
  if (actual === "anulada") return "La orden interna está anulada: no admite cambios.";
  if (actual === "cerrada") return "La orden interna está cerrada: no admite cambios.";
  const tocaContenido = CAMPOS_CONTENIDO.some((c) => cambio[c] !== undefined);
  if (tocaContenido && actual !== "abierta")
    return "La orden interna ya fue recibida por el laboratorio de destino: solo se puede avanzar su estado o anularla.";
  if (cambio.estado !== undefined && cambio.estado !== actual) {
    if (cambio.estado === "anulada") return "Para anular use «Anular» e indique el motivo.";
    if (!(SIGUIENTE[actual] ?? []).includes(cambio.estado))
      return `No se puede pasar de «${actual}» a «${cambio.estado}» (abierta → recibida → cerrada).`;
  }
  return null;
}

/** ¿Se puede anular? Devuelve el motivo del rechazo o null. */
export function motivoNoAnulable(estado: string | null | undefined, motivo: string | null | undefined): string | null {
  const actual = estado ?? "abierta";
  if (actual === "anulada") return "La orden interna ya está anulada.";
  if (actual === "cerrada") return "La orden interna está cerrada: el laboratorio de destino ya terminó su trabajo.";
  if ((motivo ?? "").trim().length < 5) return "Indique el motivo de la anulación (mínimo 5 caracteres).";
  return null;
}

/** ¿Se puede borrar? Solo una orden abierta (no recibida aún); si no, se anula. */
export function motivoNoBorrable(estado: string | null | undefined): string | null {
  return (estado ?? "abierta") === "abierta" ? null : "Solo se borra una orden interna abierta; en otro estado, anúlela con motivo.";
}

/** unidad.codsucdel admite varios códigos («7003/7004»). */
export function codigosSucdel(codsucdel: string | null | undefined): string[] {
  return String(codsucdel ?? "")
    .split(/[\s,;/]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}
