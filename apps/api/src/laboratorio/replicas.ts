/**
 * Lectura de réplicas escritas a mano · LIMS IDIC.
 *
 * Problema: la pantalla separaba las réplicas por coma, de modo que «12,4»
 * (doce coma cuatro, como se escribe en Chile) se guardaba como DOS lecturas,
 * 12 y 4. Regla nueva, sin ambigüedad:
 *
 *   · La coma ENTRE dígitos es separador decimal:  12,4  → 12.4
 *   · El punto también es decimal:                 12.4  → 12.4
 *   · Separan réplicas: espacios, saltos de línea, punto y coma, y la coma
 *     SEGUIDA de espacio («12.4, 12.6» → 12.4 y 12.6).
 *   · Un número con más de un separador decimal («1,234,5», «1.2.3») o con
 *     coma y punto a la vez se RECHAZA con el texto exacto que falla: no se
 *     adivina si es un separador de miles.
 *   · No hay separador de miles.
 *
 * La misma regla está replicada en apps/web/lib/replicas.ts para la vista
 * previa; la que vale es esta (el servidor es quien guarda).
 */

export interface LecturaReplicas {
  valores: number[];
  /** Trozos que no se pudieron leer como número (vacío = todo correcto). */
  invalidos: string[];
}

const NUMERO = /^[+-]?(\d+([.,]\d+)?|[.,]\d+)$/;

export function leerReplicas(texto: string): LecturaReplicas {
  const valores: number[] = [];
  const invalidos: string[] = [];
  const trozos = String(texto ?? "")
    // la coma seguida de espacio (o al final) separa réplicas
    .replace(/,(?=\s|$)/g, " ")
    .split(/[\s;]+/)
    .map((t) => t.trim())
    .filter((t) => t !== "");
  for (const t of trozos) {
    if (!NUMERO.test(t)) {
      invalidos.push(t);
      continue;
    }
    const n = Number(t.replace(",", "."));
    if (Number.isFinite(n)) valores.push(n);
    else invalidos.push(t);
  }
  return { valores, invalidos };
}
