/**
 * Validación del diseño de un flujo (Diseñador de flujos) · regla PURA,
 * probada en validar-flujo.spec.ts.
 *
 *  · `errores`: lo que impide guardar (estructura imposible) o publicar/simular
 *    (un flujo que se quedaría atascado).
 *  · Guardar un borrador solo exige lo mínimo (pasos con tipo válido, un
 *    INICIO, algún FIN y transiciones entre pasos existentes): se puede guardar
 *    a medio diseñar. Publicar y simular exigen además que todo paso sea
 *    alcanzable desde el INICIO, que todo paso que no sea FIN tenga salida, que
 *    una DECISION tenga al menos dos caminos y que las condiciones estén bien
 *    escritas.
 */

export const TIPOS_PASO = ["INICIO", "ACTIVIDAD", "AUTO", "DECISION", "ESPERA", "FIN", "SUBPROCESO"] as const;

export interface PasoDiseno {
  tmpId: string;
  tipo: string;
  actividad: string;
  slaMinutos?: number | null;
}
export interface TransicionDiseno {
  origenTmp: string;
  destinoTmp: string;
  condicion?: string | null;
}

/** `variable op literal` unidas por && / || (lo que entiende evaluarCondicion). */
const COMPARACION = /^[\w.]+\s*(==|!=|>=|<=|>|<)\s*\S.*$/;
export function condicionValida(expr: string): boolean {
  return expr.split("||").every((o) => o.split("&&").every((a) => COMPARACION.test(a.trim())));
}

const nombre = (p: PasoDiseno | undefined, id: string) => `«${p?.actividad?.trim() || id}»`;

/** Errores que impiden GUARDAR el borrador. */
export function erroresParaGuardar(pasos: PasoDiseno[], trans: TransicionDiseno[]): string[] {
  const e: string[] = [];
  if (!pasos?.length) return ["El flujo no tiene pasos."];
  const ids = new Set<string>();
  for (const p of pasos) {
    if (!(TIPOS_PASO as readonly string[]).includes(p.tipo)) e.push(`Tipo de paso inválido: ${p.tipo}.`);
    if (!p.actividad?.trim()) e.push("Hay un paso sin nombre de actividad.");
    if (ids.has(p.tmpId)) e.push(`Hay dos pasos con el mismo identificador (${p.tmpId}).`);
    ids.add(p.tmpId);
    if (p.slaMinutos != null && (!Number.isInteger(p.slaMinutos) || p.slaMinutos < 0))
      e.push(`El plazo del paso ${nombre(p, p.tmpId)} debe ser un número entero de minutos, 0 o más.`);
  }
  const inicios = pasos.filter((p) => p.tipo === "INICIO").length;
  if (inicios !== 1) e.push(`El flujo debe tener exactamente un paso INICIO (tiene ${inicios}).`);
  if (!pasos.some((p) => p.tipo === "FIN")) e.push("El flujo debe tener al menos un paso FIN.");
  for (const t of trans ?? [])
    if (!ids.has(t.origenTmp) || !ids.has(t.destinoTmp)) e.push(`Hay una transición con un paso que no existe (${t.origenTmp} → ${t.destinoTmp}).`);
  return [...new Set(e)];
}

/** Errores que impiden PUBLICAR o SIMULAR (incluye los de guardar). */
export function erroresParaPublicar(pasos: PasoDiseno[], trans: TransicionDiseno[]): string[] {
  const e = erroresParaGuardar(pasos, trans);
  if (e.length) return e;
  const porId = new Map(pasos.map((p) => [p.tmpId, p]));
  const salientes = new Map<string, TransicionDiseno[]>();
  for (const t of trans) salientes.set(t.origenTmp, [...(salientes.get(t.origenTmp) ?? []), t]);
  for (const p of pasos) {
    const s = salientes.get(p.tmpId) ?? [];
    if (p.tipo === "FIN" && s.length) e.push(`El paso FIN ${nombre(p, p.tmpId)} no puede tener transiciones de salida.`);
    if (p.tipo !== "FIN" && !s.length) e.push(`El paso ${nombre(p, p.tmpId)} no tiene salida: agregue una transición.`);
    if (p.tipo === "DECISION" && s.length < 2) e.push(`La decisión ${nombre(p, p.tmpId)} necesita al menos dos caminos.`);
  }
  for (const t of trans)
    if (t.condicion?.trim() && !condicionValida(t.condicion.trim()))
      e.push(`La condición «${t.condicion.trim()}» no se entiende: use «variable == valor» (también !=, >, <, >=, <=, && y ||).`);
  const inicio = pasos.find((p) => p.tipo === "INICIO")!;
  const vistos = new Set<string>([inicio.tmpId]);
  const cola = [inicio.tmpId];
  while (cola.length) {
    const x = cola.shift()!;
    for (const t of salientes.get(x) ?? []) if (!vistos.has(t.destinoTmp)) (vistos.add(t.destinoTmp), cola.push(t.destinoTmp));
  }
  for (const p of pasos) if (!vistos.has(p.tmpId)) e.push(`El paso ${nombre(porId.get(p.tmpId), p.tmpId)} no se alcanza desde el INICIO.`);
  if (!pasos.some((p) => p.tipo === "FIN" && vistos.has(p.tmpId))) e.push("Ningún paso FIN se alcanza desde el INICIO.");
  return [...new Set(e)];
}
