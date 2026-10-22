/**
 * Equipo usado en la captura y condiciones del ensayo · reglas PURAS (sin BD),
 * probadas en equipo-captura.spec.ts. Contrato §4.4.2 (equipo usado por
 * análisis); EP-01 §3.2, EP-03 §3.2–3.3, EP-05 §4.9 (backlog BL-037).
 *
 *  · El equipo se elige de los del laboratorio de la OT (o el equipamiento
 *    común, sin unidad). Uno con la calibración vencida, sin calibración, en
 *    calibración o fuera de servicio BLOQUEA la captura (lo decide
 *    EquiposService.verificarApto: 409).
 *  · ¿Es obligatorio informarlo? Según el parámetro captura_equipo.obligatorio:
 *      metodo   → solo en los métodos marcados «exige equipo» (por defecto);
 *      numerico → en todo ensayo numérico, y en los métodos marcados;
 *      siempre  → en todo ensayo.
 *  · Fecha y hora del ensayo (por defecto, la de la captura; no puede ser
 *    futura), temperatura (°C), humedad relativa (0–100 %) e incertidumbre.
 */

export type ModoEquipo = "metodo" | "numerico" | "siempre";
export const MODOS_EQUIPO: readonly ModoEquipo[] = ["metodo", "numerico", "siempre"];

/** Modo desde el parámetro; un valor desconocido cae al por defecto («metodo»). */
export function modoEquipo(valor: string | null | undefined): ModoEquipo {
  const v = String(valor ?? "").trim().toLowerCase();
  return (MODOS_EQUIPO as readonly string[]).includes(v) ? (v as ModoEquipo) : "metodo";
}

/** ¿Hay que informar el equipo al capturar este ensayo? */
export function equipoObligatorio(modo: ModoEquipo, metodoExige: boolean, tipoDato: string | null | undefined): boolean {
  if (metodoExige) return true;
  if (modo === "siempre") return true;
  if (modo === "numerico") return tipoDato !== "atributo";
  return false;
}

export interface CondicionesEnsayo {
  fechaEnsayo?: string | null;
  temperatura?: number | null;
  humedad?: number | null;
  incertidumbre?: string | null;
}

export interface CondicionesNormalizadas {
  fechaEnsayo: Date;
  temperatura: number | null;
  humedad: number | null;
  incertidumbre: string | null;
}

/** Margen para relojes desfasados entre el equipo del analista y el servidor. */
const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

/** Valida y normaliza las condiciones del ensayo (lista de errores vacía = se puede). */
export function condicionesEnsayo(c: CondicionesEnsayo, ahora: Date): { errores: string[]; valor: CondicionesNormalizadas } {
  const errores: string[] = [];
  let fecha = ahora;
  if (c.fechaEnsayo) {
    const d = new Date(c.fechaEnsayo);
    if (Number.isNaN(d.getTime())) errores.push("La fecha y hora del ensayo no es válida.");
    else if (d.getTime() > ahora.getTime() + TOLERANCIA_FUTURO_MS) errores.push("La fecha y hora del ensayo no puede ser futura.");
    else if (d.getFullYear() < 2000) errores.push("La fecha y hora del ensayo no es válida.");
    else fecha = d;
  }
  const t = c.temperatura ?? null;
  if (t !== null && (!Number.isFinite(t) || t < -80 || t > 1200)) errores.push("La temperatura del ensayo debe estar entre -80 y 1200 °C.");
  const h = c.humedad ?? null;
  if (h !== null && (!Number.isFinite(h) || h < 0 || h > 100)) errores.push("La humedad relativa debe estar entre 0 y 100 %.");
  const inc = (c.incertidumbre ?? "").trim();
  if (inc.length > 60) errores.push("La incertidumbre admite como máximo 60 caracteres.");
  return { errores, valor: { fechaEnsayo: fecha, temperatura: t, humedad: h, incertidumbre: inc || null } };
}

/**
 * ¿Se puede usar el equipo en este ensayo? Sin unidad = equipamiento común del
 * instituto (vale para cualquiera). Con unidad, debe ser el laboratorio DUEÑO
 * del ensayo: el responsable de la OT o, si el ensayo se derivó por orden
 * interna, el laboratorio de destino (recorrido MP-02, D02-28: el analista del
 * LMB veía también los equipos del LQA). Si el ensayo no tiene laboratorio
 * dueño (OT sin laboratorio), valen los laboratorios de quien captura
 * (`delUsuario`; null = alcance global).
 */
export function equipoUsable(
  equipoUnidad: string | null | undefined,
  labDelEnsayo: string | null | undefined,
  delUsuario: string[] | null,
): boolean {
  if (!equipoUnidad) return true;
  if (labDelEnsayo) return equipoUnidad === labDelEnsayo;
  return delUsuario === null || delUsuario.includes(equipoUnidad);
}

/**
 * Equipos que ofrece el selector de un ensayo: los de su laboratorio dueño y
 * los comunes (sin unidad). Misma regla que `equipoUsable`.
 */
export function equiposDelEnsayo<T extends { unidadId?: string | null }>(equipos: T[], labDelEnsayo: string | null | undefined, delUsuario: string[] | null): T[] {
  return equipos.filter((e) => equipoUsable(e.unidadId ?? null, labDelEnsayo, delUsuario));
}
