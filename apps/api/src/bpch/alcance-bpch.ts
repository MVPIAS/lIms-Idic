/**
 * Alcance de los procesos BPCH (Producción Nacional, Prototipos) · regla PURA.
 * Pruebas: alcance-bpch.spec.ts.
 *
 * Quién puede programar una inspección o generar la OT para una unidad X del
 * Banco de Pruebas:
 *  · quien tiene alcance global (Dirección, administración…);
 *  · quien tiene X entre sus unidades visibles (p. ej. el jefe de la Sucursal
 *    programa su propia sucursal; el jefe de BPCH, todas);
 *  · quien tiene la Sección Certificación de la Conformidad (SCC) en su alcance:
 *    según los flujos del IDIC (SUC.json S-11), la SCC «genera la OT asignada a
 *    la sucursal con lugar de inspección y panel».
 * Además X debe colgar de BPCH (sucursales, Delegación Nº 11, SCC).
 */

export const CODIGO_BPCH = "BPCH";
export const CODIGO_SCC = "SCC";

export function puedeOperarEnUnidad(
  visibles: string[] | null,
  unidadId: string,
  sccId: string | null,
): boolean {
  if (visibles === null) return true;
  if (visibles.includes(unidadId)) return true;
  return Boolean(sccId && visibles.includes(sccId));
}
