/**
 * Reglas PURAS (sin BD) de los procesos BPCH de Internación, Reinspección y
 * Codificación Única. Se prueban en reglas-bpch.spec.ts.
 * Contrato y fuentes: docs/FLUJO_BPCH_INTERNACION_REINSPECCION_CODIFICACION.md
 */

/* ========================================================================== */
/* Codificación Única · CNC-DGMN                                              */
/* ========================================================================== */

import { porcentajeChile } from "../../common/numero-chile";
export const LISTADOS_CODIFICACION = ["EXPLOSIVOS", "SUSTANCIAS_QUIMICAS"] as const;
export type ListadoCodificacion = (typeof LISTADOS_CODIFICACION)[number];
export const ESTADOS_CODIFICACION = ["VIGENTE", "EN_RECESO"] as const;
export type EstadoCodificacion = (typeof ESTADOS_CODIFICACION)[number];

/**
 * Normaliza un código CNC-DGMN para compararlo: sin espacios, en mayúsculas y
 * sin separadores de miles dentro de los números («7,357» y «7.357» → «7357»).
 * En los documentos reales el mismo código aparece como
 * «E-I / 21 / 1433 / 7,357 / 30537 / 24369» y «E-I/21/1433/7357/30537/24369».
 */
export function normalizarCnc(cnc: string): string {
  return (cnc ?? "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/(\d)[.,](?=\d{3}(\D|$))/g, "$1")
    .replace(/[–—]/g, "-");
}

/**
 * Formato observado en los documentos BPCH: prefijo de letras «E-I» y cinco
 * tramos numéricos separados por «/» (E-I/n/n/n/n/n). Un tramo puede venir sin
 * dato («-») en los listados de sustancias químicas. Devuelve el error o null.
 */
export function errorFormatoCnc(cnc: string): string | null {
  const n = normalizarCnc(cnc);
  if (!n) return "Indique el código CNC-DGMN.";
  if (!/^[A-Z]{1,3}-[A-Z]{1,3}(\/(\d{1,8}|-)){5}$/.test(n))
    return `El código CNC-DGMN «${cnc.trim()}» no tiene el formato esperado (p. ej. E-I/7/176/673/30365/3202: prefijo y cinco tramos numéricos separados por «/»).`;
  return null;
}

/** Transición de estado en la Codificación Única (solo Vigente ↔ En receso, con motivo). */
export function errorCambioEstadoCodificacion(actual: string, nuevo: string, motivo?: string | null): string | null {
  if (!(ESTADOS_CODIFICACION as readonly string[]).includes(nuevo)) return `Estado inválido: ${nuevo}.`;
  if (actual === nuevo) return nuevo === "VIGENTE" ? "El producto ya está vigente." : "El producto ya está en receso.";
  if (!motivo || motivo.trim().length < 5) return "Indique el motivo del cambio de estado (mínimo 5 caracteres).";
  return null;
}

/**
 * Datos obligatorios de una inscripción. Fuente: maqueta BPCH validada y
 * Excel de paridad (F6): fabricante, producto, código y listado; para
 * explosivos, además Clase/División UN y Nº UN («al dar de alta un explosivo,
 * División ONU y Nº ONU son obligatorios»).
 */
export function erroresInscripcion(d: {
  listado?: string | null;
  cnc?: string | null;
  fabricanteNombre?: string | null;
  producto?: string | null;
  claseDivisionUn?: string | null;
  numeroUn?: string | null;
}): string[] {
  const e: string[] = [];
  if (!d.listado || !(LISTADOS_CODIFICACION as readonly string[]).includes(d.listado))
    e.push("Indique el listado: Explosivos o Sustancias químicas.");
  const f = errorFormatoCnc(d.cnc ?? "");
  if (f) e.push(f);
  if (!d.fabricanteNombre?.trim()) e.push("Indique el fabricante o titular.");
  if (!d.producto?.trim()) e.push("Indique el producto.");
  if (d.listado === "EXPLOSIVOS") {
    if (!d.claseDivisionUn?.trim()) e.push("Para un explosivo la Clase/División UN es obligatoria.");
    if (!d.numeroUn?.trim()) e.push("Para un explosivo el Nº UN es obligatorio.");
  }
  return e;
}

/* ========================================================================== */
/* Internación · lotes                                                        */
/* ========================================================================== */

export interface ItemInternacion {
  elementoEspecifico?: string | null;
  claseDivisionUn?: string | null;
  numeroUn?: string | null;
  tamanoLote?: number | null;
  tamanoMuestra?: number | null;
  cnc?: string | null;
}

/**
 * Elementos internados: al menos uno; cada uno con elemento específico,
 * División UN y Nº UN (obligatorios en el formulario de internación) y, si se
 * indican, tamaño de muestra ≤ tamaño de lote (SAC-PG01-IT10 · NCh 44).
 */
export function erroresItems(items: ItemInternacion[], opts: { conArmas?: boolean } = {}): string[] {
  const e: string[] = [];
  // Internación de armas (EP-11 11.1): lo que se interna es el listado de armas
  // de la resolución; los elementos son opcionales y un arma no lleva Nº UN.
  if (!items.length && !opts.conArmas) e.push("Indique al menos un elemento a internar.");
  items.forEach((it, i) => {
    const n = `Elemento ${i + 1}`;
    if (!it.elementoEspecifico?.trim()) e.push(`${n}: indique el elemento específico (producto).`);
    if (!opts.conArmas && !it.claseDivisionUn?.trim()) e.push(`${n}: la Clase/División UN es obligatoria.`);
    if (!opts.conArmas && !it.numeroUn?.trim()) e.push(`${n}: el Nº UN es obligatorio.`);
    if (it.cnc?.trim()) {
      const f = errorFormatoCnc(it.cnc);
      if (f) e.push(`${n}: ${f}`);
    }
    e.push(...erroresLote(it, n));
  });
  return e;
}

/** Tamaños del lote: enteros positivos y muestra ≤ lote. */
export function erroresLote(d: { tamanoLote?: number | null; tamanoMuestra?: number | null }, n = "Lote"): string[] {
  const e: string[] = [];
  const lote = d.tamanoLote ?? null;
  const muestra = d.tamanoMuestra ?? null;
  if (lote !== null && (!Number.isInteger(lote) || lote <= 0)) e.push(`${n}: el tamaño del lote debe ser un entero mayor que cero.`);
  if (muestra !== null && (!Number.isInteger(muestra) || muestra <= 0)) e.push(`${n}: el tamaño de la muestra debe ser un entero mayor que cero.`);
  if (lote !== null && muestra !== null && muestra > lote) e.push(`${n}: el tamaño de la muestra (${muestra}) no puede superar el del lote (${lote}).`);
  return e;
}

/** Para registrar el lote como muestra de la OT hacen falta su identificación y sus tamaños. */
export function erroresLoteParaMuestra(d: { identificacionLote?: string | null; tamanoLote?: number | null; tamanoMuestra?: number | null }, n = "Lote"): string[] {
  const e: string[] = [];
  if (!d.identificacionLote?.trim()) e.push(`${n}: indique la identificación del lote.`);
  if (d.tamanoLote == null) e.push(`${n}: indique el tamaño del lote.`);
  if (d.tamanoMuestra == null) e.push(`${n}: indique el tamaño de la muestra.`);
  return [...e, ...erroresLote(d, n)];
}

/* ========================================================================== */
/* Internación · análisis técnico (IDIC-PG 24 Anexo 03)                       */
/* ========================================================================== */

export interface EntradaAnalisis {
  estado: string;
  infoCompleta: boolean;
  /** Solicitudes de antecedentes a DGMN aún sin respuesta. */
  solicitudesPendientes: number;
  /** Datos de la nueva solicitud a DGMN (obligatoria si la información está incompleta). */
  solicitud?: { destinatario?: string | null; detalle?: string | null } | null;
}

/**
 * ¿Se puede registrar el análisis técnico?
 *  · Solo en un expediente registrado o con antecedentes pendientes.
 *  · Información incompleta → hay que emitir la solicitud a DGMN (destinatario y detalle).
 *  · Información completa → no puede quedar ninguna solicitud a DGMN sin respuesta
 *    («la DGMN completa la información y el análisis se repite»).
 */
export function erroresAnalisis(e: EntradaAnalisis): string[] {
  const err: string[] = [];
  if (!["registrada", "antecedentes_pendientes"].includes(e.estado))
    err.push(e.estado === "ot_generada" ? "El análisis técnico ya se completó: la OT está generada." : `El expediente está ${e.estado}.`);
  if (!e.infoCompleta) {
    if (!e.solicitud?.destinatario?.trim()) err.push("Información incompleta: indique el destinatario en DGMN de la solicitud de antecedentes.");
    if (!e.solicitud?.detalle?.trim() || e.solicitud.detalle.trim().length < 5)
      err.push("Información incompleta: detalle qué antecedentes faltan (mínimo 5 caracteres).");
  } else if (e.solicitudesPendientes > 0) {
    err.push(
      `Hay ${e.solicitudesPendientes} solicitud(es) de antecedentes a DGMN sin respuesta: registre la respuesta antes de dar la información por completa.`,
    );
  }
  return err;
}

/* ========================================================================== */
/* Internación · documentación administrativa para la tasa                    */
/* ========================================================================== */

export const ACCIONES_DOC_ADM = ["solicitar", "recibir", "conforme", "no_conforme"] as const;
export type AccionDocAdm = (typeof ACCIONES_DOC_ADM)[number];

/**
 * Rama de la tasa del diagrama IDIC-PG 24 Anexo 03: Solicita doc. adm. →
 * Cliente remite → Recepción / análisis → ¿Conforme? (No → se vuelve a solicitar).
 * Devuelve el nuevo estado o el error.
 */
export function transicionDocAdm(actual: string, accion: string): { estado?: string; error?: string } {
  if (actual === "no_aplica") return { error: "La internación no está sujeta a la tasa: no requiere documentación administrativa." };
  const tabla: Record<string, Partial<Record<AccionDocAdm, string>>> = {
    pendiente: { solicitar: "solicitada" },
    solicitada: { recibir: "recibida", solicitar: "solicitada" },
    recibida: { conforme: "conforme", no_conforme: "no_conforme" },
    no_conforme: { solicitar: "solicitada" },
    conforme: {},
  };
  const destino = tabla[actual]?.[accion as AccionDocAdm];
  if (!destino) {
    const posibles = Object.keys(tabla[actual] ?? {});
    return {
      error:
        actual === "conforme"
          ? "La documentación administrativa ya está conforme."
          : `No se puede «${accion}» la documentación en estado «${actual}». Acciones posibles: ${posibles.join(", ") || "ninguna"}.`,
    };
  }
  return { estado: destino };
}

/* ========================================================================== */
/* Tasa de internación                                                        */
/* ========================================================================== */

export interface EntradaTasa {
  cifUsd: number;
  paridad: number;
  /** % de la base afecto a la tasa (100 si todo). */
  pctAfecto: number;
  /** % de la tasa (parámetro bpch_tasa.tasa_pct, 1,5 según lo levantado). */
  tasaPct: number;
  /** % de IVA sobre la tasa (parámetro bpch_tasa.iva_pct). */
  ivaPct: number;
}

export interface ResultadoTasa extends EntradaTasa {
  cifClp: number;
  baseAfecta: number;
  tasa: number;
  iva: number;
  total: number;
}

/**
 * Tasa = CIF US$ × paridad × % afecto × % tasa (Comunicación Breve del DCO:
 * «Base = CIF US$ × tipo de cambio × % afecto × 1,5 %»). IVA sobre la tasa
 * según parámetro. Montos en pesos, redondeados al entero.
 */
export function calcularTasa(e: EntradaTasa): ResultadoTasa {
  const cifClp = e.cifUsd * e.paridad;
  const baseAfecta = cifClp * (e.pctAfecto / 100);
  const tasa = Math.round(baseAfecta * (e.tasaPct / 100));
  const iva = Math.round(tasa * (e.ivaPct / 100));
  return { ...e, cifClp: Math.round(cifClp), baseAfecta: Math.round(baseAfecta), tasa, iva, total: tasa + iva };
}

export function erroresTasa(e: Partial<EntradaTasa>): string[] {
  const err: string[] = [];
  const pos = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (!pos(e.cifUsd)) err.push("Indique el valor CIF en US$ (mayor que cero).");
  if (!pos(e.paridad)) err.push("Indique la paridad US$ → $ (mayor que cero).");
  if (!(typeof e.pctAfecto === "number" && e.pctAfecto > 0 && e.pctAfecto <= 100)) err.push("El % afecto debe estar entre 0 y 100.");
  if (!(typeof e.tasaPct === "number" && e.tasaPct > 0 && e.tasaPct <= 100)) err.push("El % de la tasa debe estar entre 0 y 100 (parámetro bpch_tasa.tasa_pct).");
  if (!(typeof e.ivaPct === "number" && e.ivaPct >= 0 && e.ivaPct <= 100)) err.push("El % de IVA debe estar entre 0 y 100 (parámetro bpch_tasa.iva_pct).");
  return err;
}

/* ========================================================================== */
/* Veredicto y documentos                                                     */
/* ========================================================================== */

/**
 * CONDICIÓN FINAL de la OT a partir del veredicto de cada muestra (lote):
 * NO CUMPLE si algún lote no cumple; PENDIENTE si falta alguno; CUMPLE si
 * todos cumplen. Sin muestras: pendiente. (Mismo criterio que el flujo general.)
 */
export function condicionFinal(veredictos: (string | null | undefined)[]): "cumple" | "no_cumple" | "pendiente" {
  if (!veredictos.length) return "pendiente";
  if (veredictos.some((v) => v === "no_cumple")) return "no_cumple";
  if (veredictos.every((v) => v === "cumple" || v === "informativo") && veredictos.some((v) => v === "cumple")) return "cumple";
  return "pendiente";
}

export const TEXTO_CONDICION: Record<string, string> = {
  cumple: "CUMPLE",
  no_cumple: "NO CUMPLE",
  pendiente: "PENDIENTE",
};

/**
 * Reglas BPCH para emitir el documento final de una inspección (las aplica la
 * emisión general, reglas-emision.ts → condicionesEmision):
 *  · Certificado de Conformidad: solo si la CONDICIÓN FINAL es CUMPLE.
 *  · Informe de Incumplimiento: solo si es NO CUMPLE.
 *  · Ambos referencian el Informe de Inspección: debe estar oficial (firmado).
 */
export function faltantesDocumentoFinal(p: {
  tipoDocumento: string;
  condicion: "cumple" | "no_cumple" | "pendiente";
  informeInspeccionOficial: boolean;
  /**
   * ¿Exige el Informe de Inspección oficial previo? Sí en las inspecciones
   * (certificación, internación, reinspección: IDIC-PG 24). No en el dictamen
   * de un prototipo (IT10), que emite su certificado de aprobación de tipo o su
   * informe de rechazo directamente tras los ensayos aprobados. Por defecto sí.
   */
  exigeInformePrevio?: boolean;
}): string[] {
  const f: string[] = [];
  if (p.tipoDocumento !== "CERTIFICADO_CONFORMIDAD" && p.tipoDocumento !== "INFORME_INCUMPLIMIENTO") return f;
  if (p.tipoDocumento === "CERTIFICADO_CONFORMIDAD" && p.condicion !== "cumple")
    f.push(
      `El Certificado de Conformidad solo se emite si la condición final es CUMPLE (ahora: ${TEXTO_CONDICION[p.condicion]}).` +
        (p.condicion === "no_cumple" ? " Corresponde el Informe de Incumplimiento." : ""),
    );
  if (p.tipoDocumento === "INFORME_INCUMPLIMIENTO" && p.condicion !== "no_cumple")
    f.push(
      `El Informe de Incumplimiento solo se emite si la condición final es NO CUMPLE (ahora: ${TEXTO_CONDICION[p.condicion]}).` +
        (p.condicion === "cumple" ? " Corresponde el Certificado de Conformidad." : ""),
    );
  if (p.exigeInformePrevio !== false && !p.informeInspeccionOficial)
    f.push("Antes debe estar oficial (firmado) el Informe de Inspección de la OT, al que este documento hace referencia.");
  return f;
}

/**
 * Remisión de la tasa a facturación (IDIC-PG 24: «une las ramas — certificado
 * recibido + documentación de tasa conforme — y remite al Depto. Comercial»).
 */
export function faltantesRemision(p: {
  sujetaTasa: boolean;
  docAdmEstado: string;
  tasaCalculada: boolean;
  documentoFinalOficial: boolean;
  yaRemitida: boolean;
}): string[] {
  const f: string[] = [];
  if (!p.sujetaTasa) return ["La internación no está sujeta a la tasa: no hay nada que facturar."];
  if (p.yaRemitida) f.push("La tasa ya fue remitida a facturación.");
  if (p.docAdmEstado !== "conforme") f.push(`La documentación administrativa debe estar conforme (ahora: ${p.docAdmEstado}).`);
  if (!p.tasaCalculada) f.push("Calcule la tasa antes de remitirla.");
  if (!p.documentoFinalOficial)
    f.push("Falta el documento final oficial de la inspección (Certificado de Conformidad o Informe de Incumplimiento).");
  return f;
}

/* ========================================================================== */
/* Reinspección                                                               */
/* ========================================================================== */

/** Solicitud de reinspección: datos mínimos y antecedente original. */
export function erroresReinspeccion(d: {
  motivo?: string | null;
  motivosValidos: string[];
  motivoDetalle?: string | null;
  solicitadoPor?: string | null;
  fechaSolicitud?: string | null;
  origenOtId?: string | null;
  certificadoOrigenId?: string | null;
  codificacionId?: string | null;
  cnc?: string | null;
  cncEnCodificacion?: boolean;
  elementoEspecifico?: string | null;
}): string[] {
  const e: string[] = [];
  if (!d.motivo || !d.motivosValidos.includes(d.motivo)) e.push(`Indique el motivo (${d.motivosValidos.join(", ")}).`);
  if (d.motivo === "OTRO" && (!d.motivoDetalle || d.motivoDetalle.trim().length < 5)) e.push("Motivo «Otro»: describa el motivo (mínimo 5 caracteres).");
  if (!d.solicitadoPor?.trim()) e.push("Indique quién solicita la reinspección.");
  if (!d.fechaSolicitud) e.push("Indique la fecha de la solicitud.");
  if (!d.origenOtId && !d.certificadoOrigenId && !d.codificacionId)
    e.push("Una reinspección se liga a lo inspeccionado antes: indique la OT original, el certificado original o el producto de la Codificación Única.");
  if (d.cnc?.trim() && d.cncEnCodificacion === false)
    e.push(
      `El código ${d.cnc.trim()} no está en la Codificación Única: no es una reinspección (un elemento no codificado corresponde a Prototipo).`,
    );
  if (!d.elementoEspecifico?.trim()) e.push("Indique el elemento específico (producto) a reinspeccionar.");
  return e;
}

/* ------------------------------------------------- avance de la internación --- */

export type AvanceInternacion =
  | "registrada"
  | "antecedentes_pendientes"
  | "anulada"
  | "ot_generada"
  | "en_inspeccion"
  | "informe_emitido"
  | "certificado_emitido"
  | "incumplimiento_emitido"
  | "tasa_remitida"
  | "ot_cerrada"
  | "ot_anulada";

export const TEXTO_AVANCE: Record<AvanceInternacion, string> = {
  registrada: "Registrada · por analizar",
  antecedentes_pendientes: "Antecedentes pedidos a DGMN",
  anulada: "Anulada",
  ot_generada: "OT generada · lotes por registrar",
  en_inspeccion: "En inspección",
  informe_emitido: "Informe de Inspección emitido",
  certificado_emitido: "Certificado de Conformidad emitido",
  incumplimiento_emitido: "Informe de Incumplimiento emitido",
  tasa_remitida: "Tasa remitida a facturación",
  ot_cerrada: "OT cerrada",
  ot_anulada: "OT anulada",
};

/**
 * Estado que se MUESTRA de una internación: el avance real del expediente
 * (revisión r3, hallazgo 21). bpch_internacion.estado solo cambia hasta generar
 * la OT; desde ahí el avance sale de la OT, sus lotes, sus documentos y la tasa,
 * en el orden del flujo (docs/FLUJO_BPCH_INTERNACION_REINSPECCION_CODIFICACION.md §2).
 */
export function avanceInternacion(p: {
  estado: string;
  otEstado?: string | null;
  lotes?: number;
  lotesRegistrados?: number;
  informeOficial?: boolean;
  certificadoOficial?: boolean;
  incumplimientoOficial?: boolean;
  sujetaTasa?: boolean;
  tasaRemitida?: boolean;
}): AvanceInternacion {
  if (p.estado === "anulada") return "anulada";
  if (p.estado !== "ot_generada") return p.estado === "antecedentes_pendientes" ? "antecedentes_pendientes" : "registrada";
  if (p.otEstado === "anulada") return "ot_anulada";
  if (p.otEstado === "cerrada") return "ot_cerrada";
  if (p.sujetaTasa && p.tasaRemitida) return "tasa_remitida";
  if (p.incumplimientoOficial) return "incumplimiento_emitido";
  if (p.certificadoOficial) return "certificado_emitido";
  if (p.informeOficial) return "informe_emitido";
  if ((p.lotes ?? 0) > 0 && (p.lotesRegistrados ?? 0) >= (p.lotes ?? 0)) return "en_inspeccion";
  return "ot_generada";
}

/** Permiso con el que se cambian los parámetros del sistema (Administración › Parámetros). */
export const PERMISO_CONFIGURACION = "catalogo.gestionar";

/**
 * Porcentajes de la tasa que el cálculo pide distintos de los parámetros
 * vigentes (bpch_tasa: tasa_pct, iva_pct). Cambiarlos para un cálculo exige el
 * permiso de configuración (revisión de seguridad r3): quien solo calcula la
 * tasa usa los del parámetro.
 */
export function porcentajesTasaCambiados(
  pedido: { tasaPct?: number | null; ivaPct?: number | null },
  parametros: { tasaPct: number | null; ivaPct: number | null },
): string[] {
  const out: string[] = [];
  if (pedido.tasaPct != null && pedido.tasaPct !== parametros.tasaPct) out.push(`tasa ${porcentajeChile(pedido.tasaPct)} (parámetro: ${parametros.tasaPct != null ? porcentajeChile(parametros.tasaPct) : "sin fijar"})`);
  if (pedido.ivaPct != null && pedido.ivaPct !== parametros.ivaPct) out.push(`IVA ${porcentajeChile(pedido.ivaPct)} (parámetro: ${parametros.ivaPct != null ? porcentajeChile(parametros.ivaPct) : "sin fijar"})`);
  return out;
}
