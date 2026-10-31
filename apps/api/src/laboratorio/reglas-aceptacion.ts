/**
 * Reglas de aceptación del método en la captura estándar (EP-02 §3.2 y §3.9,
 * frente ALI-D4). Se definen por método en `cat_metodo.reglas_captura` (JSON)
 * y se evalúan sobre las lecturas (C1..Cn) o las réplicas de UNA captura:
 *
 *   · duplicados: diferencia entre las determinaciones (X y X′; con más de dos,
 *     máximo − mínimo) ≤ max. «absoluto» compara en las unidades del resultado
 *     (p. ej. 0,38 % de proteína); «relativo» compara la diferencia como % del
 *     promedio. Con una sola determinación avisa que el método pide duplicado.
 *   · diferencia_campos: en cada lectura, |campoA − campoB| ≤ max (p. ej. peso
 *     constante de la materia grasa: pesada final − anterior ≤ 0,001 g).
 *
 * Qué pasa si no se cumplen lo decide el parámetro captura_reglas.modo:
 * «avisar» (por defecto: el analista confirma y se guarda con los avisos) o
 * «impedir» (no se guarda). POR CONFIRMAR con el IDIC (SAL-17).
 *
 * Función PURA: reglas-aceptacion.spec.ts.
 */

export type ReglaAceptacion =
  | {
      tipo: "duplicados";
      max: number;
      modo: "absoluto" | "relativo";
      unidad?: string | null;
      texto?: string | null;
      fuente?: string | null;
      porConfirmar?: boolean;
    }
  | {
      tipo: "diferencia_campos";
      campoA: string;
      campoB: string;
      max: number;
      unidad?: string | null;
      texto?: string | null;
      fuente?: string | null;
      porConfirmar?: boolean;
    };

export interface AvisoAceptacion {
  regla: ReglaAceptacion["tipo"];
  texto: string;
  /** diferencia observada (la mayor, si hay varias lecturas) */
  diferencia: number | null;
  max: number;
}

export type ModoReglas = "avisar" | "impedir";

/** Valor del parámetro captura_reglas.modo; cualquier otro valor = «avisar». */
export function modoReglas(valor: string | null | undefined): ModoReglas {
  return String(valor ?? "").trim().toLowerCase() === "impedir" ? "impedir" : "avisar";
}

const numero = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Lee el JSON de cat_metodo.reglas_captura; descarta lo que no se entiende. */
export function leerReglas(json: unknown): ReglaAceptacion[] {
  let datos = json;
  if (typeof datos === "string") {
    try {
      datos = JSON.parse(datos);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(datos)) return [];
  const out: ReglaAceptacion[] = [];
  for (const r of datos) {
    if (!r || typeof r !== "object") continue;
    const max = numero((r as any).max);
    if (max == null || max < 0) continue;
    const comun = {
      max,
      unidad: (r as any).unidad ?? null,
      texto: (r as any).texto ?? null,
      fuente: (r as any).fuente ?? null,
      porConfirmar: !!(r as any).porConfirmar,
    };
    if ((r as any).tipo === "duplicados") {
      out.push({ tipo: "duplicados", modo: (r as any).modo === "relativo" ? "relativo" : "absoluto", ...comun });
    } else if ((r as any).tipo === "diferencia_campos") {
      const a = String((r as any).campoA ?? "").toUpperCase();
      const b = String((r as any).campoB ?? "").toUpperCase();
      if (/^C\d+$/.test(a) && /^C\d+$/.test(b)) out.push({ tipo: "diferencia_campos", campoA: a, campoB: b, ...comun });
    }
  }
  return out;
}

/** Tolerancia de redondeo: 0,38 − 0,38 no debe avisar por coma flotante. */
const TOL = 1e-9;
const fmt = (n: number, dec = 4) => String(Number(n.toFixed(dec))).replace(".", ",");

/** Texto legible de una regla («Diferencia entre duplicados ≤ 0,38 % (absoluta)»). */
export function textoRegla(r: ReglaAceptacion): string {
  if (r.texto) return r.texto;
  if (r.tipo === "duplicados")
    return `Diferencia entre duplicados ≤ ${fmt(r.max)}${r.modo === "relativo" ? " % del promedio" : r.unidad ? ` ${r.unidad}` : ""}`;
  return `|${r.campoA} − ${r.campoB}| ≤ ${fmt(r.max)}${r.unidad ? ` ${r.unidad}` : ""}`;
}

/**
 * Evalúa las reglas sobre una captura.
 * @param valores resultado de cada determinación (lectura o réplica), antes del factor
 * @param lecturas campos C1..Cn de cada lectura (vacío si se capturaron réplicas)
 */
export function evaluarReglas(
  reglas: ReglaAceptacion[],
  valores: number[],
  lecturas: Record<string, number>[] | null,
): AvisoAceptacion[] {
  const avisos: AvisoAceptacion[] = [];
  for (const r of reglas) {
    if (r.tipo === "duplicados") {
      if (!valores.length) continue;
      if (valores.length < 2) {
        avisos.push({ regla: r.tipo, texto: `${textoRegla(r)}: hay una sola determinación y el método pide duplicado (X y X′).`, diferencia: null, max: r.max });
        continue;
      }
      const dif = Math.max(...valores) - Math.min(...valores);
      const prom = valores.reduce((a, b) => a + b, 0) / valores.length;
      const medida = r.modo === "relativo" ? (prom ? (dif / Math.abs(prom)) * 100 : Infinity) : dif;
      if (medida > r.max + TOL)
        avisos.push({
          regla: r.tipo,
          texto: `${textoRegla(r)}: la diferencia es ${Number.isFinite(medida) ? fmt(medida) : "indeterminada"}${r.modo === "relativo" ? " % del promedio" : r.unidad ? ` ${r.unidad}` : ""}.`,
          diferencia: Number.isFinite(medida) ? medida : null,
          max: r.max,
        });
    } else {
      if (!lecturas?.length) continue;
      let peor: { i: number; d: number } | null = null;
      lecturas.forEach((l, i) => {
        const a = l[r.campoA];
        const b = l[r.campoB];
        if (typeof a !== "number" || typeof b !== "number") return;
        const d = Math.abs(a - b);
        if (d > r.max + TOL && (!peor || d > peor.d)) peor = { i, d };
      });
      if (peor) {
        const p = peor as { i: number; d: number };
        avisos.push({
          regla: r.tipo,
          texto: `${textoRegla(r)}: en la lectura ${p.i + 1} la diferencia es ${fmt(p.d, 6)}${r.unidad ? ` ${r.unidad}` : ""}.`,
          diferencia: p.d,
          max: r.max,
        });
      }
    }
  }
  return avisos;
}
