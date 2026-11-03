/**
 * Unidad de consumo distinta de la de compra (contrato §4.4.4) · funciones
 * PURAS, probadas en conversion.spec.ts. El stock se lleva SIEMPRE en la
 * unidad de consumo (unidad_medida); lo que llega en envases se convierte.
 */

export class ConversionError extends Error {}

/** Cantidad en unidad de consumo. `enUnidadCompra` exige el factor del consumible. */
export function aUnidadConsumo(cantidad: number, factor: number | string | null | undefined, enUnidadCompra: boolean | null | undefined): number {
  if (!enUnidadCompra) return cantidad;
  const f = factor == null || factor === "" ? NaN : Number(factor);
  if (!(Number.isFinite(f) && f > 0))
    throw new ConversionError("Este consumible no tiene factor de conversión: indique cuántas unidades de consumo trae cada envase, o registre la cantidad en su unidad de medida.");
  return Math.round(cantidad * f * 1e6) / 1e6;
}

/** Stock expresado también en envases («2 frascos y 150 mL»), para la pantalla. */
export function enEnvases(stock: number, factor: number | string | null | undefined): { envases: number; resto: number } | null {
  const f = factor == null || factor === "" ? NaN : Number(factor);
  if (!(Number.isFinite(f) && f > 0) || !(stock >= 0)) return null;
  const envases = Math.floor((stock + 1e-9) / f);
  return { envases, resto: Math.round((stock - envases * f) * 1e6) / 1e6 };
}

/** Cantidad a descontar por una captura según la configuración del método (§4.4.5). */
export function cantidadPorCaptura(cantidad: number, por: "ensayo" | "replica" | string, determinaciones: number): number {
  const n = por === "replica" ? Math.max(1, Math.trunc(determinaciones || 1)) : 1;
  return Math.round(cantidad * n * 1e6) / 1e6;
}
