/**
 * Prototipos · reglas PURAS (sin BD) · BPCH · LIMS IDIC.
 * Pruebas: reglas-prototipo.spec.ts. Documento: docs/FLUJO_BPCH_PRODUCCION_PROTOTIPOS_CLASIFICACION.md §2.
 *
 * Fuentes:
 *  · BPCH.json B01 (sin resolución/solicitud DGMN no se abre expediente) y B06
 *    (clasificación UN del elemento nuevo); comparativa de los 4 caminos
 *    (Paridad_BPCH: esquema TIPO, aprobación del tipo, código único nuevo).
 *  · SAC-PG01-IT10 §3 «Para Prototipos»: la SCC pide a la SAC un pronunciamiento
 *    técnico sobre la cantidad de muestras que la sucursal debe extraer; recién
 *    entonces se genera la OT asignada a la sucursal (SUC.json S-10 → S-11).
 *  · Paridad «Prototipos»: si cumple → certificado de TIPO (aprobación); si no → rechazo.
 */

import { fmtNum } from "../../plantilla-render/html.util";
import { valorInformado } from "../../plantilla-render/filas-informe";

export type EstadoPrototipo = "ingresado" | "en_evaluacion" | "dictaminado" | "anulado";
export type Dictamen = "aprobado" | "rechazado";
export type VeredictoOt = "cumple" | "no_cumple" | "pendiente" | "sin_resultados";

/** Veredicto del tipo a partir de los resultados de la OT (vocabulario de laboratorio/veredicto). */
export function veredictoOt(resultados: { veredicto: string | null; estado: string }[]): VeredictoOt {
  if (!resultados.length) return "sin_resultados";
  if (resultados.some((r) => r.veredicto === "no_cumple")) return "no_cumple";
  if (resultados.some((r) => !r.veredicto || r.veredicto === "pendiente")) return "pendiente";
  return "cumple";
}

/** Lo que falta para generar la OT del prototipo. */
export function faltantesGenerarOt(p: {
  estado: EstadoPrototipo;
  otId: string | null;
  otEstado?: string | null;
  sacTamanoMuestra: number | null;
  unidadId: string | null;
  conCobro: boolean | null | undefined;
}): string[] {
  const f: string[] = [];
  const otViva = p.otId && p.otEstado !== "anulada";
  if (p.estado === "anulado") f.push("El prototipo está anulado.");
  else if (p.estado === "dictaminado") f.push("El prototipo ya tiene dictamen.");
  else if (otViva) f.push("El prototipo ya tiene una OT vigente.");
  if (!p.sacTamanoMuestra)
    f.push("Falta el pronunciamiento de la SAC con el tamaño de muestra (SAC-PG01-IT10, «Para prototipos»).");
  if (!p.unidadId) f.push("Indique la sucursal o sección que inspeccionará el prototipo.");
  if (p.conCobro !== true && p.conCobro !== false) f.push("Indique si la OT es con cobro o sin cobro.");
  return f;
}

/** Lo que falta para dictaminar (aprobar o rechazar el tipo). */
export function faltantesDictamen(d: {
  estado: EstadoPrototipo;
  otId: string | null;
  dictamen: string | null | undefined;
  motivo?: string | null;
  totalResultados: number;
  aprobados: number;
  veredicto: VeredictoOt;
  clasificacionEstado: string | null;
  documentoVigente: boolean;
}): string[] {
  const f: string[] = [];
  if (d.estado === "anulado") return ["El prototipo está anulado."];
  if (d.dictamen !== "aprobado" && d.dictamen !== "rechazado") return ["Indique el dictamen: aprobado o rechazado."];
  if (d.estado === "dictaminado" && d.documentoVigente)
    return ["El prototipo ya tiene un dictamen con su documento vigente. Para cambiarlo, anule ese documento."];
  if (!d.otId) f.push("El prototipo no tiene OT: genérela y registre sus resultados.");
  else if (d.totalResultados === 0) f.push("La OT del prototipo no tiene resultados.");
  else if (d.aprobados < d.totalResultados)
    f.push(`Faltan resultados por aprobar: ${d.aprobados} de ${d.totalResultados} aprobados.`);
  if (d.dictamen === "aprobado") {
    if (d.veredicto === "no_cumple") f.push("Hay ensayos que no cumplen: el tipo no se puede aprobar.");
    else if (d.veredicto !== "cumple" && d.totalResultados > 0 && d.aprobados === d.totalResultados)
      f.push("Hay ensayos sin veredicto: no se puede aprobar el tipo.");
    if (d.clasificacionEstado !== "aprobada")
      f.push("Para aprobar el tipo, el elemento nuevo debe tener una clasificación de sustancia APROBADA (Clase/División y Nº ONU).");
  } else if (!d.motivo?.trim()) f.push("El rechazo exige indicar el motivo.");
  return f;
}

/** Plantilla y tipo de documento (matriz de firmas) de cada dictamen. */
export const DOCUMENTO_DICTAMEN: Record<Dictamen, { repid: string; tipoDocumento: string; titulo: string }> = {
  aprobado: { repid: "PROTO-APR", tipoDocumento: "CERTIFICADO_CONFORMIDAD", titulo: "Certificado de aprobación de tipo" },
  rechazado: { repid: "PROTO-REC", tipoDocumento: "INFORME_INCUMPLIMIENTO", titulo: "Informe de rechazo de prototipo" },
};
export const PLANTILLAS_PROTOTIPO = Object.values(DOCUMENTO_DICTAMEN).map((d) => d.repid);

/**
 * Código único CNC-DGMN: seis partes separadas por «/» (formato E-I/n/n/n/n/n de
 * los informes reales). Solo se valida la forma; el prefijo y la numeración los
 * asigna la DGMN.
 */
export function validarCodigoCnc(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  if (!s) return "Indique el código único CNC-DGMN.";
  const partes = s.split("/");
  if (partes.length !== 6 || partes.some((p) => !p.trim()))
    return "El código único CNC-DGMN tiene seis partes separadas por «/» (p. ej. E-I/n/n/n/n/n).";
  if (s.length > 60) return "El código único es demasiado largo.";
  return null;
}

/** Estado legible del prototipo combinando su dictamen y el estado del documento. */
export function etapaPrototipo(p: {
  estado: EstadoPrototipo;
  dictamen?: string | null;
  documentoEstado?: string | null;
  otId?: string | null;
  sacTamanoMuestra?: number | null;
}): string {
  if (p.estado === "anulado") return "Anulado";
  if (p.estado === "dictaminado") {
    const que = p.dictamen === "aprobado" ? "Aprobado" : "Rechazado";
    if (p.documentoEstado === "oficial" || p.documentoEstado === "emitido") return `${que} · documento oficial`;
    if (p.documentoEstado === "en_firma") return `${que} · documento en firma`;
    if (p.documentoEstado === "devuelto") return `${que} · documento devuelto`;
    if (p.documentoEstado === "anulado") return `${que} · documento anulado`;
    return que;
  }
  if (p.otId) return "En evaluación (OT)";
  if (!p.sacTamanoMuestra) return "Ingresado · falta pronunciamiento SAC";
  return "Ingresado · listo para generar OT";
}

/**
 * Resultado que se imprime en la tabla de ensayos del dictamen (PROTO-APR /
 * PROTO-REC): el valor informado —resultado final con fórmula y factor, si no
 * el valor capturado y solo al final el promedio— que es con el que se calculó
 * el veredicto; si no hay número, el texto observado.
 */
export function resultadoDictamen(r: { resultado_final?: unknown; valor_numerico?: unknown; promedio?: unknown; valor_texto?: string | null }): string {
  const n = valorInformado({ resultadoFinal: r.resultado_final, valorNumerico: r.valor_numerico, promedio: r.promedio });
  return n !== null && n !== undefined && n !== "" ? fmtNum(String(n)) : r.valor_texto ?? "";
}
