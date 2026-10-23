/**
 * Lectura de los parámetros de la operación del frente r4d (Administración ›
 * Parámetros del sistema; se definen en catalogo/parametro-configurable.ts).
 * Todos tienen valor por defecto: si la fila falta o está inactiva, rige este.
 */
type Db = { $queryRawUnsafe<T = unknown>(sql: string, ...args: unknown[]): Promise<T> };

export async function valoresCategoria(db: Db, tenantId: string | null | undefined, categoria: string): Promise<Record<string, string>> {
  try {
    const filas = await db.$queryRawUnsafe<{ codigo: string; valor: string | null }[]>(
      `SELECT codigo, valor FROM parametro_sistema
        WHERE categoria = $2 AND activo AND ($1::uuid IS NULL OR tenant_id = $1::uuid)`,
      tenantId ?? null,
      categoria,
    );
    return Object.fromEntries(filas.filter((f) => f.valor != null).map((f) => [f.codigo, String(f.valor)]));
  } catch {
    return {};
  }
}

export const entero = (v: string | undefined, def: number, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
};
export const sino = (v: string | undefined, def: boolean) => (v === "si" ? true : v === "no" ? false : def);
export const lista = (v: string | undefined, def: string[]) => (v == null ? def : v.split(",").map((x) => x.trim()).filter(Boolean));

/** Difusión del informe mensual de la tasa (EP-06 6.23). */
export const DIFUSION_TASA = [
  { valor: "DIRECCION", etiqueta: "Dirección" },
  { valor: "SUBDIRECCION", etiqueta: "Subdirección" },
  { valor: "BPCH", etiqueta: "Banco de Pruebas de Chile (BPCH)" },
  { valor: "CONTRALORIA", etiqueta: "Contraloría interna" },
  { valor: "DFZ", etiqueta: "Departamento de Finanzas (DFZ)" },
  { valor: "DCO", etiqueta: "Departamento Comercial (DCO)" },
];
