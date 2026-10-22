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
  /** EP-08 8.11: si la operación la exige, la parametrización debe estar validada. */
  parametrizacion?: { exige: boolean; estado: string } | null;
}): string[] {
  const f: string[] = [];
  const otViva = p.otId && p.otEstado !== "anulada";
  if (p.parametrizacion?.exige && p.parametrizacion.estado !== "validada")
    f.push("Falta la parametrización del elemento validada por la jefatura (EP-08 8.11).");
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

/* --------------------------------------------- 8.8 · ¿está codificado? --- */

/** Nombre comparable: sin tildes, mayúsculas, sin signos y con espacios simples. */
export function nombreComparable(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export interface CandidatoCodificado {
  origen: "codificacion" | "catalogo";
  nombre: string;
  detalle: string;
}

/**
 * EP-08 8.8 (BL-179): un elemento que ya está en la Codificación Única o en el
 * catálogo NO es prototipo (corresponde Internación, Producción Nacional o
 * Reinspección). Coincidencia exacta = bloquea; parecida (uno contiene al otro,
 * con al menos 4 caracteres) = aviso.
 */
export function revisarCodificado(elemento: string, candidatos: CandidatoCodificado[]) {
  const e = nombreComparable(elemento);
  const exactos: CandidatoCodificado[] = [];
  const parecidos: CandidatoCodificado[] = [];
  if (e.length < 2) return { codificado: false, exactos, parecidos };
  for (const c of candidatos) {
    const n = nombreComparable(c.nombre);
    if (!n) continue;
    if (n === e) exactos.push(c);
    else if (Math.min(n.length, e.length) >= 4 && (n.includes(e) || e.includes(n))) parecidos.push(c);
  }
  return { codificado: exactos.length > 0, exactos, parecidos: parecidos.slice(0, 10) };
}

export function mensajeCodificado(elemento: string, exactos: CandidatoCodificado[]): string {
  const donde = exactos.map((c) => (c.origen === "codificacion" ? `Codificación Única ${c.detalle}` : `catálogo ${c.detalle}`)).join("; ");
  return `«${elemento}» ya está codificado (${donde}): no es un prototipo; corresponde Internación, Producción Nacional o Reinspección.`;
}

/** EP-08 8.17 (BL-180): condiciones para inscribir el tipo aprobado en la Codificación Única. */
export function faltantesInscripcionCu(p: { estado: string; dictamen: string | null; documentoEstado: string | null; codigoCnc: string | null; yaInscrito: boolean }): string[] {
  const f: string[] = [];
  if (p.estado !== "dictaminado" || p.dictamen !== "aprobado") f.push("Solo se inscribe un prototipo con el tipo aprobado.");
  else if (p.documentoEstado !== "oficial" && p.documentoEstado !== "emitido") f.push("El certificado de aprobación de tipo aún no es oficial.");
  if (!p.codigoCnc) f.push("Falta el código único CNC-DGMN (paso 7).");
  if (p.yaInscrito) f.push("El tipo ya está inscrito en la Codificación Única.");
  return f;
}

/* ----------------------------------------- 8.11 · parametrizar el elemento --- */

export const ESTADOS_PARAMETRIZACION = ["sin_parametros", "borrador", "en_validacion", "validada", "devuelta"] as const;
export type EstadoParametrizacion = (typeof ESTADOS_PARAMETRIZACION)[number];
export const NOMBRE_ESTADO_PARAMETRIZACION: Record<EstadoParametrizacion, string> = {
  sin_parametros: "Sin parametrizar",
  borrador: "En preparación",
  en_validacion: "En validación",
  validada: "Validada",
  devuelta: "Devuelta con motivo",
};

export interface ParametroElemento {
  metodoId: string;
  ensayo: string;
  minimo?: number | null;
  nominal?: number | null;
  maximo?: number | null;
  unidad?: string | null;
  formula?: string | null;
  tipoFormula?: "general" | "especifica" | null;
}

/** Cada fila: método, ensayo y al menos Mín o Máx; Mín ≤ Nom ≤ Máx; la fórmula declara si es general o específica. */
export function erroresParametros(ps: ParametroElemento[]): string[] {
  const e: string[] = [];
  if (!ps.length) e.push("Agregue al menos un ensayo al panel del elemento.");
  ps.forEach((p, i) => {
    const n = `Fila ${i + 1}`;
    if (!p.ensayo?.trim()) e.push(`${n}: indique el ensayo.`);
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const [mi, no, ma] = [num(p.minimo), num(p.nominal), num(p.maximo)];
    if (mi === null && ma === null) e.push(`${n}: indique el Mín o el Máx de la especificación.`);
    if (mi !== null && ma !== null && mi > ma) e.push(`${n}: el Mín no puede ser mayor que el Máx.`);
    if (no !== null && ((mi !== null && no < mi) || (ma !== null && no > ma))) e.push(`${n}: el Nom debe quedar entre el Mín y el Máx.`);
    if (p.formula?.trim() && !p.tipoFormula) e.push(`${n}: indique si la fórmula es general o específica.`);
  });
  return e;
}

/** Qué falta para cada acción de la parametrización (cuatro ojos: quien envía no valida). */
export function faltantesParametrizacion(
  accion: "editar" | "enviar" | "validar" | "devolver",
  p: { prototipoEstado: string; otViva: boolean; estado: EstadoParametrizacion; filas: number; enviadaPor: string | null; usuario: string | null; motivo?: string | null },
): string[] {
  const f: string[] = [];
  if (p.prototipoEstado === "anulado" || p.prototipoEstado === "dictaminado") return [`El prototipo está ${p.prototipoEstado}.`];
  if (accion === "editar" || accion === "enviar") {
    if (p.otViva) f.push("El prototipo ya tiene OT: el panel validado no se cambia.");
    if (!["sin_parametros", "borrador", "devuelta"].includes(p.estado)) f.push(`La parametrización está ${NOMBRE_ESTADO_PARAMETRIZACION[p.estado].toLowerCase()}.`);
    if (accion === "enviar" && !p.filas) f.push("Agregue al menos un ensayo al panel.");
  } else {
    if (p.estado !== "en_validacion") f.push("La parametrización no está en validación.");
    if (accion === "validar" && p.enviadaPor && p.usuario && p.enviadaPor === p.usuario) f.push("Quien preparó la parametrización no la valida (cuatro ojos).");
    if (accion === "devolver" && (p.motivo ?? "").trim().length < 5) f.push("Indique el motivo de la devolución (al menos 5 caracteres).");
  }
  return f;
}

/** Texto de un número para la especificación del resultado (coma decimal no: el motor de la OT lee punto). */
export const textoLimite = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? String(n) : null);
