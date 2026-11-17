/**
 * Reglas del resultado por método (ensayo del catálogo) · sesiones en preproducción:
 *
 *   · Redondeo (LPN, R7: «algunos resultados, como el brillo, son enteros; hoy el
 *     sistema entrega decimales»): `cat_metodo.decimales_resultado` fija cuántos
 *     decimales tiene el resultado final. Se redondea al medio hacia afuera (0,5 → 1;
 *     −0,5 → −1), como en la planilla del laboratorio, y el veredicto se decide con
 *     el valor redondeado (el que se informa). NULL = sin redondeo.
 *   · Condiciones ambientales (LME, R8: «no aplican a todos sus ensayos»):
 *     `cat_metodo.condiciones_ambientales` = no_aplica | opcional | obligatoria.
 *   · Explicación del factor de la fórmula (LPN, R7): cuándo se aplica, cómo opera
 *     sobre el promedio de las lecturas y quién lo ajusta.
 *
 * Funciones PURAS: reglas-resultado.spec.ts.
 */
import type { Factor } from "./factor";

export const MODOS_CONDICIONES = ["no_aplica", "opcional", "obligatoria"] as const;
export type ModoCondiciones = (typeof MODOS_CONDICIONES)[number];
export const MAX_DECIMALES = 6;

export interface ReglasResultado {
  /** Decimales del resultado final (0 = entero); null = sin redondeo. */
  decimales: number | null;
  condiciones: ModoCondiciones;
}

export const REGLAS_RESULTADO_DEFECTO: ReglasResultado = { decimales: null, condiciones: "opcional" };

/** Lee las columnas del método (valores fuera de rango o desconocidos → por defecto). */
export function leerReglasResultado(f: { decimales_resultado?: unknown; condiciones_ambientales?: unknown } | null | undefined): ReglasResultado {
  const d = f?.decimales_resultado;
  const n = d == null || d === "" ? null : Number(d);
  const decimales = n != null && Number.isInteger(n) && n >= 0 && n <= MAX_DECIMALES ? n : null;
  const c = String(f?.condiciones_ambientales ?? "").trim();
  return { decimales, condiciones: (MODOS_CONDICIONES as readonly string[]).includes(c) ? (c as ModoCondiciones) : "opcional" };
}

/** Errores de lo pedido en el catálogo (lista vacía = válido). */
export function erroresReglasResultado(d: { decimales?: unknown; condiciones?: unknown }): string[] {
  const e: string[] = [];
  if (d.decimales !== undefined && d.decimales !== null) {
    const n = Number(d.decimales);
    if (!Number.isInteger(n) || n < 0 || n > MAX_DECIMALES) e.push(`Los decimales del resultado van de 0 (entero) a ${MAX_DECIMALES}; déjelo vacío para no redondear.`);
  }
  if (d.condiciones !== undefined && !(MODOS_CONDICIONES as readonly unknown[]).includes(d.condiciones))
    e.push("Las condiciones ambientales son «no aplica», «opcional» u «obligatoria».");
  return e;
}

/**
 * Redondeo al medio hacia afuera con `decimales` cifras, sin el error de coma
 * flotante (1,005 con 2 decimales → 1,01; 2,5 con 0 → 3; −2,5 → −3).
 */
export function redondear(valor: number, decimales: number | null | undefined): number {
  if (decimales == null || !Number.isFinite(valor)) return valor;
  const d = Math.max(0, Math.min(MAX_DECIMALES, Math.trunc(decimales)));
  if (Math.abs(valor) >= 1e15) return valor;
  const signo = valor < 0 ? -1 : 1;
  // Se desplaza la coma con notación exponencial (evita 1.005 * 100 = 100.49999…).
  const desplazado = Number(`${Math.abs(valor).toPrecision(15)}e${d}`);
  const r = Number(`${Math.round(desplazado)}e-${d}`);
  return r === 0 ? 0 : signo * r;
}

/** Texto del valor redondeado con sus decimales fijos («87», «12,30» → «12.30»). */
export function textoRedondeado(valor: number, decimales: number | null | undefined): string {
  if (decimales == null) return String(valor);
  return redondear(valor, decimales).toFixed(Math.max(0, Math.min(MAX_DECIMALES, Math.trunc(decimales))));
}

/**
 * Temperatura y humedad que se guardan según el método: con «no aplica» se
 * descartan; con «obligatoria» faltar alguna es un error.
 */
export function condicionesSegunMetodo(
  modo: ModoCondiciones,
  c: { temperatura?: number | null; humedad?: number | null },
): { temperatura: number | null | undefined; humedad: number | null | undefined; error: string | null } {
  if (modo === "no_aplica") return { temperatura: undefined, humedad: undefined, error: null };
  if (modo === "obligatoria" && (c.temperatura == null || c.humedad == null))
    return { ...c, temperatura: c.temperatura, humedad: c.humedad, error: "Este ensayo exige registrar la temperatura (°C) y la humedad relativa (%) del ensayo." };
  return { temperatura: c.temperatura, humedad: c.humedad, error: null };
}

/** Explicación del factor para la pantalla de captura (LPN, R7). */
export function explicacionFactor(f: Factor | null, origen?: string | null): string {
  const quien = "Lo ajusta en la OT quien tiene el permiso «resultado.factor» (la jefatura, por defecto), con motivo.";
  if (!f) return `Este ensayo no lleva factor. ${quien}`;
  const op = f.operacion === "multiplicar" ? "multiplica" : "divide";
  const v = String(Number(f.valor.toPrecision(12))).replace(".", ",");
  const de = origen === "orden" ? "ajustado en esta OT" : "del método del catálogo";
  return `Factor ${de}: ${op} por ${v} el valor calculado (el promedio de las lecturas con la fórmula, o el promedio de las réplicas). ` +
    `Sirve para corregir por dilución, concentración o un reactivo estandarizado${f.descripcion ? ` (${f.descripcion})` : ""}. ` +
    `No se aplica a un valor final escrito directamente. ${quien}`;
}
