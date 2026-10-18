/**
 * Recepción e identificación de la muestra · LIMS IDIC (Depto. Químico,
 * 15-10-2026; maqueta LQC «Recepción e identificación de la muestra»).
 * Reglas PURAS (sin BD), probadas en recepcion-muestra.spec.ts.
 *
 *  · Toma de muestra: una de las opciones vigentes de la lista «toma_muestra»
 *    (Catálogo › Parámetros): en terreno por el laboratorio, entregada por el
 *    cliente o tomada por la Sección Muestreo IDIC.
 *  · Condición de recepción: Cumple / No cumple; si no cumple, la observación es
 *    obligatoria (qué se encontró).
 *  · Nº de sello (si viene sellada) e identificación de la muestra dada por el
 *    cliente (su rótulo; no es el código del laboratorio).
 *  · ¿Requiere ensayos de otros laboratorios?: si se marca, hay que indicar
 *    cuál(es); queda constancia en la muestra y se enlaza con las órdenes
 *    internas de la OT hacia esos laboratorios.
 */

export interface RecepcionMuestra {
  tomaMuestra?: string | null;
  condicionRecepcion?: "cumple" | "no_cumple" | null;
  condicionObservacion?: string | null;
  selloNumero?: string | null;
  identificacionCliente?: string | null;
  requiereOtrosLabs?: boolean;
  otrosLabs?: string[];
  otrosLabsDetalle?: string | null;
}

export interface RecepcionNormalizada {
  tomaMuestra: string | null;
  condicionRecepcion: "cumple" | "no_cumple" | null;
  condicionObservacion: string | null;
  selloNumero: string | null;
  identificacionCliente: string | null;
  requiereOtrosLabs: boolean;
  otrosLabs: string[];
  otrosLabsDetalle: string | null;
}

const limpio = (s?: string | null) => {
  const t = (s ?? "").trim();
  return t ? t : null;
};

/** Normaliza: textos recortados, vacíos a NULL, sin laboratorios si no se requieren. */
export function normalizarRecepcion(r: RecepcionMuestra): RecepcionNormalizada {
  const requiere = !!r.requiereOtrosLabs;
  return {
    tomaMuestra: limpio(r.tomaMuestra),
    condicionRecepcion: r.condicionRecepcion ?? null,
    condicionObservacion: limpio(r.condicionObservacion),
    selloNumero: limpio(r.selloNumero),
    identificacionCliente: limpio(r.identificacionCliente),
    requiereOtrosLabs: requiere,
    otrosLabs: requiere ? [...new Set(r.otrosLabs ?? [])] : [],
    otrosLabsDetalle: requiere ? limpio(r.otrosLabsDetalle) : null,
  };
}

/**
 * Qué impide guardar la recepción (lista vacía = se puede).
 * @param opcionesToma códigos vigentes de la lista «toma_muestra»
 * @param labPrincipal laboratorio responsable de la OT (no es «otro laboratorio»)
 * @param prefijo «Muestra 2: » cuando se registran varias
 */
export function erroresRecepcion(r: RecepcionNormalizada, opcionesToma: string[], labPrincipal?: string | null, prefijo = ""): string[] {
  const e: string[] = [];
  if (!r.tomaMuestra) e.push(`${prefijo}indique quién tomó la muestra (toma de muestra).`);
  else if (!opcionesToma.includes(r.tomaMuestra)) e.push(`${prefijo}la toma de muestra «${r.tomaMuestra}» no está en la lista vigente.`);
  if (!r.condicionRecepcion) e.push(`${prefijo}indique la condición de recepción (Cumple / No cumple).`);
  if (r.condicionRecepcion === "no_cumple" && (r.condicionObservacion ?? "").length < 5)
    e.push(`${prefijo}la muestra no cumple la condición de recepción: describa qué se encontró (mínimo 5 caracteres).`);
  if (r.requiereOtrosLabs && !r.otrosLabs.length) e.push(`${prefijo}indique qué otro(s) laboratorio(s) deben ensayar la muestra.`);
  if (labPrincipal && r.otrosLabs.includes(labPrincipal))
    e.push(`${prefijo}el laboratorio responsable de la OT no es «otro laboratorio»: quítelo de la lista.`);
  return e;
}

/** ¿Falta algo de la recepción? (para avisar en la lista de muestras) */
export function recepcionIncompleta(m: { tomaMuestra?: string | null; condicionRecepcion?: string | null }): boolean {
  return !m.tomaMuestra || !m.condicionRecepcion;
}

/**
 * Enlace con las órdenes internas de la OT: para cada laboratorio pedido, las
 * órdenes internas vigentes hacia él (o ninguna: hay que emitirla).
 */
export function enlaceOrdenesInternas(
  otrosLabs: string[],
  ordenes: { id: string; numero: string; destinoLab: string | null; estado: string }[],
): { unidadId: string; ordenes: { id: string; numero: string; estado: string }[] }[] {
  return otrosLabs.map((u) => ({
    unidadId: u,
    ordenes: ordenes.filter((o) => o.destinoLab === u).map((o) => ({ id: o.id, numero: o.numero, estado: o.estado })),
  }));
}
