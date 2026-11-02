/**
 * Tabla dinámica (contrato §4.6.7) · función PURA, probada en tabla-dinamica.spec.ts.
 * Cruza las filas exportadas: un campo en filas, opcionalmente otro en columnas,
 * y un valor agregado (conteo, suma, promedio, mínimo o máximo), con totales.
 * El resultado es la hoja «Resumen» del Excel y la fuente de su gráfico.
 */
import { diaChile } from "../common/fecha-chile";
import type { Celda } from "../common/xlsx-escritura";

export const AGREGADOS = ["conteo", "suma", "promedio", "minimo", "maximo"] as const;
export type Agregado = (typeof AGREGADOS)[number];
export const GRAFICOS = ["columna", "barra", "linea", "torta", "ninguno"] as const;
export type TipoGrafico = (typeof GRAFICOS)[number];

export interface DefResumen {
  filas: string;
  columnas?: string | null;
  valor?: string | null;
  agregado?: Agregado;
  grafico?: TipoGrafico;
}

const NOMBRE_AGREGADO: Record<Agregado, string> = { conteo: "Cantidad", suma: "Suma", promedio: "Promedio", minimo: "Mínimo", maximo: "Máximo" };
const VACIO = "(vacío)";

/** Texto de una celda para agrupar (las fechas se agrupan por día de Chile). */
export function claveGrupo(v: unknown): string {
  if (v === null || v === undefined || v === "") return VACIO;
  if (v instanceof Date || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v))) return diaChile(v) ?? String(v);
  return String(v);
}

/** Número de una celda (Decimal de Prisma, bigint, texto numérico) o null. */
export function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number(v);
  const n = Number(typeof v === "object" && v && "toString" in v ? String(v) : v);
  return Number.isFinite(n) ? n : null;
}

class Acumulador {
  n = 0;
  suma = 0;
  min = Infinity;
  max = -Infinity;
  validos = 0;
  agregar(v: number | null) {
    this.n++;
    if (v === null) return;
    this.validos++;
    this.suma += v;
    if (v < this.min) this.min = v;
    if (v > this.max) this.max = v;
  }
  valor(a: Agregado): number | null {
    if (a === "conteo") return this.n;
    if (!this.validos) return null;
    if (a === "suma") return redondear(this.suma);
    if (a === "promedio") return redondear(this.suma / this.validos);
    if (a === "minimo") return this.min;
    return this.max;
  }
}
const redondear = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Matriz de la tabla dinámica: cabecera, una fila por grupo (orden alfabético)
 * y la fila «Total». Con campo de columnas, una columna por valor y «Total».
 * `series` = columnas con datos (sin la de totales), para el gráfico.
 */
export function tablaDinamica(filas: Record<string, unknown>[], def: DefResumen): { matriz: Celda[][]; grupos: number; series: number } {
  const agregado: Agregado = def.agregado ?? "conteo";
  if (agregado !== "conteo" && !def.valor) throw new Error("El agregado necesita un campo de valor.");
  const val = (f: Record<string, unknown>) => (agregado === "conteo" ? null : numero(f[def.valor as string]));
  const orden = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });

  const celdas = new Map<string, Map<string, Acumulador>>();
  const porFila = new Map<string, Acumulador>();
  const porCol = new Map<string, Acumulador>();
  const total = new Acumulador();
  for (const f of filas) {
    const g = claveGrupo(f[def.filas]);
    const c = def.columnas ? claveGrupo(f[def.columnas]) : "";
    const v = val(f);
    if (!celdas.has(g)) celdas.set(g, new Map());
    const fila = celdas.get(g)!;
    if (!fila.has(c)) fila.set(c, new Acumulador());
    fila.get(c)!.agregar(v);
    if (!porFila.has(g)) porFila.set(g, new Acumulador());
    porFila.get(g)!.agregar(v);
    if (!porCol.has(c)) porCol.set(c, new Acumulador());
    porCol.get(c)!.agregar(v);
    total.agregar(v);
  }
  const grupos = [...celdas.keys()].sort(orden);
  const titulo = agregado === "conteo" ? NOMBRE_AGREGADO.conteo : `${NOMBRE_AGREGADO[agregado]} de ${def.valor}`;

  if (!def.columnas) {
    const m: Celda[][] = [[def.filas, titulo]];
    for (const g of grupos) m.push([g, porFila.get(g)!.valor(agregado)]);
    m.push(["Total", total.valor(agregado)]);
    return { matriz: m, grupos: grupos.length, series: 1 };
  }
  const cols = [...porCol.keys()].sort(orden);
  const m: Celda[][] = [[`${def.filas} \\ ${def.columnas}`, ...cols, "Total"]];
  for (const g of grupos) m.push([g, ...cols.map((c) => celdas.get(g)!.get(c)?.valor(agregado) ?? null), porFila.get(g)!.valor(agregado)]);
  m.push(["Total", ...cols.map((c) => porCol.get(c)!.valor(agregado)), total.valor(agregado)]);
  return { matriz: m, grupos: grupos.length, series: cols.length };
}
