/**
 * Pre-cotización (Sección Vehículos Militares, reunión 10 · 04-11-2026).
 *
 * Para los proyectos del Ejército el laboratorio entrega primero un VALOR
 * REFERENCIAL: sin ensayos, sin muestras y sin cierre. No genera OT; la OT nace
 * de la cotización formal cuando Comercial registra la aceptación. Puede
 * volver a cotizarse (incluso años después) con una NUEVA VERSIÓN que
 * reemplaza a la anterior (la anterior queda anulada con la referencia).
 *
 *  · Número propio, que no consume el correlativo oficial de cotizaciones:
 *    PC-AAAA-NNNN, y las versiones siguientes PC-AAAA-NNNN-v2, -v3…
 *  · Sus líneas son valores referenciales: descripción y monto, sin ensayo.
 *  · «Emitir cotización formal» crea la cotización con la misma cabecera; el
 *    laboratorio le agrega los ensayos como en la cotización compartida.
 *
 * Funciones PURAS: precotizacion.spec.ts.
 */

export const TIPO_COTIZACION = "cotizacion";
export const TIPO_PRECOTIZACION = "precotizacion";
export type TipoDocumentoCotizacion = typeof TIPO_COTIZACION | typeof TIPO_PRECOTIZACION;

export const esPrecotizacion = (c: { tipoDocumento?: string | null } | null | undefined) => c?.tipoDocumento === TIPO_PRECOTIZACION;

/** PC-2026-0007 · PC-2026-0007-v2 */
export function codigoPrecotizacion(anio: number, serie: number, version = 1): string {
  return `PC-${anio}-${String(serie).padStart(4, "0")}${version > 1 ? `-v${version}` : ""}`;
}

export interface LineaReferencial {
  descripcion?: string | null;
  cantidad?: number | null;
  precioUnitario?: number | null;
  catEnsayoId?: string | null;
  muestraN?: number | null;
}

/** Errores de las líneas de una pre-cotización (vacío = OK). */
export function erroresLineasPrecot(lineas: LineaReferencial[]): string[] {
  const e: string[] = [];
  if (!lineas.length) e.push("Indique al menos un valor referencial (descripción y monto).");
  lineas.forEach((l, i) => {
    if (l.catEnsayoId) e.push(`Línea ${i + 1}: la pre-cotización no lleva ensayos; registre un valor referencial (descripción y monto).`);
    if (l.muestraN != null) e.push(`Línea ${i + 1}: la pre-cotización no lleva muestras.`);
    if (!(l.descripcion ?? "").trim()) e.push(`Línea ${i + 1}: indique la descripción del valor referencial.`);
    if (!(Number(l.precioUnitario) > 0)) e.push(`Línea ${i + 1}: indique el monto referencial.`);
    if (l.cantidad != null && !(Number.isInteger(Number(l.cantidad)) && Number(l.cantidad) >= 1)) e.push(`Línea ${i + 1}: la cantidad debe ser un entero mayor o igual a 1.`);
  });
  return e;
}

/** Por qué una pre-cotización no se acepta (ni genera OT). */
export const MOTIVO_PRECOT_NO_ACEPTA =
  "Una pre-cotización entrega valores referenciales: no se acepta ni genera OT. Emita la cotización formal desde ella y registre la aceptación en esa cotización.";

export interface EstadoPrecot {
  tipoDocumento?: string | null;
  estado: string;
  reemplazadaPorId?: string | null;
}

/** ¿Se puede emitir una nueva versión? Devuelve el motivo si no. */
export function motivoNoNuevaVersion(p: EstadoPrecot): string | null {
  if (!esPrecotizacion(p)) return "Solo una pre-cotización tiene versiones.";
  if (p.reemplazadaPorId) return "Esta versión ya fue reemplazada: trabaje sobre la versión vigente.";
  if (p.estado === "anulada") return "La pre-cotización está anulada.";
  return null;
}

/** ¿Se puede emitir la cotización formal desde la pre-cotización? */
export function motivoNoConvertir(p: EstadoPrecot): string | null {
  if (!esPrecotizacion(p)) return "Solo se emite la cotización formal desde una pre-cotización.";
  if (p.reemplazadaPorId) return "Esta versión fue reemplazada: emita la cotización desde la versión vigente.";
  if (p.estado === "anulada") return "La pre-cotización está anulada.";
  return null;
}

/** Número de versión siguiente. */
export const siguienteVersion = (actual: number | null | undefined) => Math.max(1, Number(actual) || 1) + 1;
