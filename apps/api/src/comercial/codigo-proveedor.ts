/**
 * Código humano del proveedor (`proveedor.codigo`, NOT NULL y único por
 * tenant). El formulario no lo pide: se asigna correlativo al registrar,
 * con el mismo formato de los proveedores ya cargados (PROV-001, PROV-002…).
 */
export const PREFIJO_PROVEEDOR = "PROV-";

/** Número del código «PROV-012» → 12; null si el código no sigue el formato. */
export function numeroCodigoProveedor(codigo: string | null | undefined): number | null {
  const m = /^PROV-(\d{1,9})$/.exec(String(codigo ?? "").trim().toUpperCase());
  return m ? Number(m[1]) : null;
}

/** Siguiente código a partir de los existentes: máximo + 1, con al menos 3 dígitos. */
export function siguienteCodigoProveedor(existentes: (string | null | undefined)[]): string {
  const max = existentes.reduce<number>((m, c) => Math.max(m, numeroCodigoProveedor(c) ?? 0), 0);
  return `${PREFIJO_PROVEEDOR}${String(max + 1).padStart(3, "0")}`;
}
