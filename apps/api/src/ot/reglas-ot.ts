/**
 * Reglas comerciales de origen / cobro / OPI de la OT · Comercial ronda 2 (oct-2026).
 *
 * · SVT6 · documento de aceptación de la cotización (IDIC-PG03 6.3 n):
 *     OPI_RESOLUCION (Ejército) · OC · CORREO (particular) · PAGO_ADELANTADO ·
 *     DISPOSICION_DIRECTOR (IDIC-PG03 6.4 g: OT sin OPI previa).
 * · SVT7 · OT por disposición: si se crea por DISPOSICION del Director y CON
 *     cobro, la OT queda `opi_pendiente` hasta que se registre la OPI. Una OT
 *     SIN cobro no espera OPI (pero igual registra horas y costo).
 * · SPC2.2 · OT Interlaboratorio: la pide un laboratorio a otro sin OT padre
 *     (p. ej. calibración de un equipo); nunca tiene cobro; se costea por horas.
 *
 * Funciones PURAS (sin BD) → testeables directamente (reglas-ot.spec.ts).
 */

export const ORIGENES_OT = ["COTIZACION", "INTERNACION", "DISPOSICION", "INTERLABORATORIO", "OT_INTERNA", "INSTITUCIONAL"] as const;

/** Por qué «Registrar OT» ya no admite el origen Internación. */
export const MOTIVO_INTERNACION_PUERTA_UNICA =
  "La OT de internación no se registra a mano: nace sola cuando la SCC completa el análisis técnico de la resolución DGMN en Internaciones (BPCH · Comercial).";
export type OrigenOt = (typeof ORIGENES_OT)[number];

export const TIPOS_ACEPTACION = ["OPI_RESOLUCION", "OC", "CORREO", "PAGO_ADELANTADO", "DISPOSICION_DIRECTOR"] as const;
export type TipoAceptacion = (typeof TIPOS_ACEPTACION)[number];

/** Tipos de aceptación que exigen número de documento. */
export const ACEPTACION_REQUIERE_NUMERO: readonly TipoAceptacion[] = ["OPI_RESOLUCION", "OC"];

export interface EntradaOpi {
  origen?: string | null;
  aceptacionTipo?: string | null;
  conCobro: boolean;
  /** Nº de OPI ya registrado (si existe, nada queda pendiente). */
  opiNumero?: string | null;
}

/**
 * ¿La OT queda con OPI pendiente?
 * Solo si nace de una disposición del Director (origen DISPOSICION o aceptación
 * DISPOSICION_DIRECTOR), CON cobro y todavía sin OPI.
 */
export function calcularOpiPendiente(e: EntradaOpi): boolean {
  const porDisposicion = e.origen === "DISPOSICION" || e.aceptacionTipo === "DISPOSICION_DIRECTOR";
  return porDisposicion && e.conCobro === true && !(e.opiNumero && e.opiNumero.trim());
}

/** Origen de la OT que genera una cotización aceptada, según su documento de aceptación. */
export function origenDesdeAceptacion(tipo?: string | null): OrigenOt {
  return tipo === "DISPOSICION_DIRECTOR" ? "DISPOSICION" : "COTIZACION";
}

/**
 * Cobro efectivo de una OT nueva. Interlaboratorio nunca cobra: si se pide
 * explícitamente con cobro es un error de negocio (devuelve el motivo).
 */
export function resolverCobro(origen: string | null | undefined, conCobro: boolean | undefined): { conCobro: boolean; error?: string } {
  // EP-01/02 0.5 (BL-160): la OT institucional es sin cobro; el valor de los ensayos queda como costo de referencia.
  if (origen === "INSTITUCIONAL") {
    if (conCobro === true) return { conCobro: false, error: "Una OT institucional es sin cobro." };
    return { conCobro: false };
  }
  if (origen === "INTERLABORATORIO") {
    if (conCobro === true) return { conCobro: false, error: "Una OT Interlaboratorio no tiene cobro (se costea por horas)." };
    return { conCobro: false };
  }
  return { conCobro: conCobro ?? true };
}

/** Validaciones de los datos que exige cada origen. Devuelve la lista de errores (vacía = OK). */
export function validarOrigenOt(d: {
  origen?: string | null;
  cotizacionId?: string | null;
  disposicionRef?: string | null;
  labSolicitanteCcId?: string | null;
  centroCostoId?: string | null;
  resolucion?: string | null;
  oficioNumero?: string | null;
  oficioFecha?: string | null;
  /** Parámetro ot_institucional.exige_oficio (por defecto sí). */
  exigeOficio?: boolean;
}): string[] {
  const errores: string[] = [];
  switch (d.origen) {
    case "COTIZACION":
      if (!d.cotizacionId) errores.push("Origen COTIZACION requiere cotizacionId.");
      break;
    case "DISPOSICION":
      if (!d.disposicionRef?.trim()) errores.push("Origen DISPOSICION requiere la referencia de la disposición del Director (disposicionRef).");
      break;
    case "INTERLABORATORIO":
      if (d.cotizacionId) errores.push("Una OT Interlaboratorio no nace de una cotización.");
      if (!d.labSolicitanteCcId) errores.push("Origen INTERLABORATORIO requiere el laboratorio solicitante (labSolicitanteCcId).");
      if (!d.centroCostoId) errores.push("Origen INTERLABORATORIO requiere el laboratorio ejecutor (centroCostoId).");
      if (d.labSolicitanteCcId && d.centroCostoId && d.labSolicitanteCcId === d.centroCostoId)
        errores.push("El laboratorio solicitante y el ejecutor deben ser distintos.");
      break;
    case "INSTITUCIONAL":
      if (d.cotizacionId) errores.push("Una OT institucional sin cobro no nace de una cotización.");
      if (d.exigeOficio !== false && !d.oficioNumero?.trim()) errores.push("OT institucional: indique el Nº del oficio (oficioNumero).");
      if (d.exigeOficio !== false && !d.oficioFecha) errores.push("OT institucional: indique la fecha del oficio (oficioFecha).");
      break;
    case "INTERNACION":
      // Puerta única: la OT de internación nace al registrar la resolución DGMN
      // (BPCH · Comercial › Internaciones); las ya creadas con este origen se siguen mostrando.
      errores.push(MOTIVO_INTERNACION_PUERTA_UNICA);
      break;
    default:
      break;
  }
  return errores;
}

/**
 * Valor inicial de la OT que nace de una cotización (EP-00 4.2: VALORINICIAL =
 * total de la cotización; recorrido MP-02, D02-09). Las horas hombre son las que
 * el laboratorio declaró al responder el costeo (FORM05/FORM06). Sin cotización
 * o con total 0 queda en 0 (OT sin cobro: lo registra quien la crea).
 *
 * Frente f6: `orden_trabajo.costo_estimado` está en CLP (costos reales, reportes).
 * Una cotización en USD se lleva a pesos con SU dólar del día congelado
 * (`dolar_valor`, el que la cotización exige): no se inventa un tipo de cambio.
 * El valor en dólares se conserva en el encargo (`ot_encargo.valor_inicial` y `moneda`).
 * Sin ese dólar, el costo estimado queda en 0.
 */
export function valorInicialOt(
  totalCotizacion: number,
  costeos: { horas: number | null; costo: number | null }[] = [],
  cot: { moneda?: string | null; dolar?: number | null } = {},
): { costoEstimado: number; horasHombre: number } {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const enPesos = (cot.moneda ?? "CLP").trim().toUpperCase() !== "USD";
  const bruto = Number.isFinite(totalCotizacion) && totalCotizacion > 0 ? totalCotizacion : 0;
  const dolar = Number(cot.dolar);
  const total = enPesos ? bruto : Number.isFinite(dolar) && dolar > 0 ? Math.round(bruto * dolar) : 0;
  const horas = costeos.reduce((s, c) => s + (Number(c.horas) > 0 ? Number(c.horas) : 0), 0);
  return { costoEstimado: r2(total), horasHombre: r2(horas) };
}
