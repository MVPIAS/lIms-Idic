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
 *  · Entrega R1 (frente r1d): producto (matriz), cliente del maestro, sellos
 *    verificados, destino de la muestra, ubicación y campos propios del
 *    laboratorio. Los propios del laboratorio los valida
 *    recepcion/reglas-recepcion.ts con la configuración de Catálogo › Parámetros.
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
  /** Producto (matriz): elemento del catálogo. */
  catElementoId?: string | null;
  /** Cliente de la muestra (maestro de clientes); por defecto, el de la OT. */
  clienteId?: string | null;
  sellosVerificados?: boolean | null;
  claseCustodia?: string | null;
  ubicacion?: string | null;
  datos?: Record<string, string | number | boolean | null> | null;
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
  catElementoId: string | null;
  clienteId: string | null;
  sellosVerificados: boolean | null;
  claseCustodia: string | null;
  ubicacion: string | null;
  datos: Record<string, string | number | boolean | null>;
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
    catElementoId: r.catElementoId ?? null,
    clienteId: r.clienteId ?? null,
    sellosVerificados: typeof r.sellosVerificados === "boolean" ? r.sellosVerificados : null,
    claseCustodia: limpio(r.claseCustodia),
    ubicacion: limpio(r.ubicacion),
    datos: { ...(r.datos ?? {}) },
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
  if (r.sellosVerificados === true && !r.selloNumero)
    e.push(`${prefijo}indique el Nº de los sellos que verificó.`);
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

/** Quién y cuándo recibió la muestra y quién corrigió la recepción por última vez. */
export interface SelloRecepcion {
  recepcionadaAt: Date | null;
  recepcionadaPor: string | null;
  recepcionCorregidaAt: Date | null;
  recepcionCorregidaPor: string | null;
}

/**
 * Campos de quién/cuándo al guardar la recepción. La PRIMERA vez (registro o
 * una muestra que aún no tenía recepción) queda quien la registra y ahora.
 * Una CORRECCIÓN conserva quién y cuándo se recibió la muestra y anota aparte
 * quién corrigió y cuándo (revisión r3, hallazgo 13).
 */
export function selloRecepcion(previo: SelloRecepcion | null, usuarioId: string | null, ahora: Date): SelloRecepcion {
  if (!previo?.recepcionadaAt)
    return { recepcionadaAt: ahora, recepcionadaPor: usuarioId, recepcionCorregidaAt: null, recepcionCorregidaPor: null };
  return {
    recepcionadaAt: previo.recepcionadaAt,
    recepcionadaPor: previo.recepcionadaPor,
    recepcionCorregidaAt: ahora,
    recepcionCorregidaPor: usuarioId,
  };
}
