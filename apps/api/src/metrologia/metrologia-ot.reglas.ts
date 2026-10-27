/**
 * Metrología ligada a la OT · reglas PURAS (sin base de datos), probadas en
 * metrologia-ot.reglas.spec.ts. Especificación: EP-04 (F2 recepción y custodia,
 * F3 calibración desde el ítem, F8 entrega y devolución, F9 cierre).
 * Contrato: docs/FLUJO_METROLOGIA.md §7.
 *
 *   ítem (instrumento de la OT):
 *     por_recibir ─recibir (¿se puede calibrar? sí)─▶ recibido ─devolver─▶ devuelto
 *          │                                                     ▲
 *          ├─recibir (no se puede calibrar)─▶ no_apto ───devolver──┘
 *          └─anular (motivo) ─▶ anulado
 *
 *   - Toda calibración nace de un ítem RECIBIDO y calibrable (no hay calibración suelta).
 *   - Un ítem tiene una sola calibración vigente; la reemisión la reemplaza.
 *   - Fecha de recepción ≥ fecha de la OT (R15 L2) y nunca futura.
 *   - El certificado se entrega una vez, ya emitido, con fecha ≥ emisión.
 *   - El instrumento calibrado se devuelve con el certificado ya emitido.
 *   - Cierre (técnico y final, D04-31): todos los ítems resueltos (calibración emitida y
 *     entregada, o no apto), ningún servicio externo a medio camino y, si los parámetros
 *     lo exigen, todos devueltos y cada no calibrable con su documento.
 */

/* ------------------------------------------------------------ tipos --- */
import { anioChile, ZONA_CHILE, diaChile } from "../common/fecha-chile";
import { faltantesParaCerrar } from "../ot/plazos";

export type EstadoInstrumento = "por_recibir" | "recibido" | "no_apto" | "devuelto" | "anulado";
export const ESTADOS_FISICOS = ["bueno", "con_observaciones", "danado"] as const;
export type EstadoFisico = (typeof ESTADOS_FISICOS)[number];
// Medios de entrega: «Parámetros del sistema › medio_envio» (common/medios-envio.ts, frente f5).

export interface InstrumentoOt {
  id: string;
  numero: number;
  descripcion: string;
  estado: EstadoInstrumento | string;
  calibrable?: boolean | null;
  recibidoAt?: Date | string | null;
  devueltoAt?: Date | string | null;
}

/** Calibración (o reemisión) ligada a un ítem. */
export interface CalibracionOt {
  id: string;
  instrumentoId: string | null;
  codigo: string;
  numeroCertificado?: string | null;
  /** borrador | calculada | en_revision | en_firma | emitida | reemplazada */
  estado: string;
  emitidoAt?: Date | string | null;
  entregadoAt?: Date | string | null;
}

/* ------------------------------------------------------------ fechas --- */
const dia = (v: Date | string | null | undefined): string | null => {
  if (!v) return null;
  if (v instanceof Date) return diaChile(v);
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
};
/**
 * Instante de una fecha-hora escrita en pantalla («AAAA-MM-DDTHH:mm», sin zona) en hora
 * de Chile, sea cual sea la zona del servidor. Si trae zona (Z o ±hh:mm), se respeta.
 */
export function instanteChile(s: string): number {
  const x = String(s ?? "").trim();
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(x) && x.includes("T")) return Date.parse(x);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(x);
  if (!m) return NaN;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONA_CHILE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const desfase = (t: number) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((q) => [q.type, q.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
  };
  const t0 = utc - desfase(utc);
  return utc - desfase(t0);
}
const dmy = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
const nombreItem = (i: { numero: number; descripcion: string }) => `ítem ${i.numero} (${i.descripcion})`;

/* ------------------------------------------------------- numeración --- */
/**
 * Número del certificado según el formato del prefijo (configurable en Maestros ›
 * Numeración): {P} prefijo · {N} correlativo con ceros · {AA} año en 2 cifras · {AAAA} año.
 *   «{P}-{N}» → M-3950 · PT-0091 (relleno 4) · «{P}-{N}.{AA}» → LCPNF-011.26 (relleno 3).
 */
export function formatearNumero(formato: string | null | undefined, prefijo: string, n: number, relleno = 0, anio?: number | null): string {
  const f = formato && formato.includes("{N}") ? formato : "{P}-{N}";
  const a = anio ?? anioChile();
  return f
    .replace(/\{P\}/g, prefijo)
    .replace(/\{N\}/g, String(n).padStart(relleno, "0"))
    .replace(/\{AAAA\}/g, String(a))
    .replace(/\{AA\}/g, String(a % 100).padStart(2, "0"));
}

/** Siguiente correlativo: los anuales vuelven a 1 al cambiar de año. */
export function siguienteCorrelativo(fila: { ultimo: number; anual?: boolean | null; anio?: number | null }, anioActual: number): { n: number; anio: number | null } {
  if (fila.anual) {
    if (fila.anio !== anioActual) return { n: 1, anio: anioActual };
    return { n: fila.ultimo + 1, anio: anioActual };
  }
  return { n: fila.ultimo + 1, anio: fila.anio ?? null };
}

/** Formato válido: lleva {N} y solo usa los comodines conocidos y caracteres seguros. */
export function formatoValido(formato: string): boolean {
  if (!formato.includes("{N}") || formato.length > 40) return false;
  const sin = formato.replace(/\{(P|N|AA|AAAA)\}/g, "");
  return /^[A-Za-z0-9./_ -]*$/.test(sin);
}

/**
 * Correlativo de un número ya emitido con ese formato (null si no corresponde).
 * Si el formato lleva año, solo cuentan los del año indicado.
 */
export function correlativoDe(numero: string, formato: string | null | undefined, prefijo: string, anio?: number | null): number | null {
  const f = formato && formato.includes("{N}") ? formato : "{P}-{N}";
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const a = anio ?? null;
  let patron = "";
  for (const parte of f.split(/(\{P\}|\{N\}|\{AAAA\}|\{AA\})/)) {
    if (parte === "{P}") patron += esc(prefijo);
    else if (parte === "{N}") patron += "(\\d+)";
    else if (parte === "{AAAA}") patron += a == null ? "\\d{4}" : String(a);
    else if (parte === "{AA}") patron += a == null ? "\\d{2}" : String(a % 100).padStart(2, "0");
    else patron += esc(parte);
  }
  const m = new RegExp(`^${patron}$`).exec(numero);
  return m ? Number(m[1]) : null;
}

/* ---------------------------------------------------------- recepción --- */
export interface DatosRecepcion {
  fechaHora: string; // ISO o AAAA-MM-DDTHH:mm
  entregadoPor: string;
  estadoFisico: string;
  estadoFisicoObs?: string | null;
  ubicacion: string;
  calibrable: boolean;
  motivoNoCalibrable?: string | null;
  sentido?: string | null;
  acondicionamientoH?: number | null;
  tempAmbiente?: number | null;
}

/** Por qué no se puede registrar la recepción (null = se puede). */
export function motivoRecepcion(
  item: { estado: string; descripcion: string; numero: number },
  d: DatosRecepcion,
  ctx: { fechaOt: Date | string | null; laboratorio: string | null; ahora?: Date },
): string | null {
  if (item.estado !== "por_recibir") return `El ${nombreItem(item)} ya fue recibido (estado: ${item.estado.replace("_", " ")}).`;
  const t = instanteChile(d.fechaHora);
  if (Number.isNaN(t)) return "Indique la fecha y hora de recepción.";
  const ahora = ctx.ahora ?? new Date();
  if (t > ahora.getTime() + 5 * 60_000) return "La fecha de recepción no puede ser futura.";
  const rec = dia(new Date(t)), ot = dia(ctx.fechaOt);
  if (ot && rec && rec < ot)
    return `La recepción (${dmy(rec)}) no puede ser anterior a la fecha de la OT (${dmy(ot)}): según el laboratorio, la OT debe ser igual o anterior a la recepción del equipo.`;
  if (!d.entregadoPor?.trim()) return "Indique quién entrega el instrumento.";
  if (!(ESTADOS_FISICOS as readonly string[]).includes(d.estadoFisico)) return "Indique el estado físico del instrumento.";
  if (d.estadoFisico !== "bueno" && !d.estadoFisicoObs?.trim()) return "Describa en la observación el estado del instrumento (no está en buen estado).";
  if (!d.ubicacion?.trim()) return "Indique la ubicación de almacenamiento.";
  if (!d.calibrable && (d.motivoNoCalibrable ?? "").trim().length < 5) return "Indique por qué no se puede calibrar (mínimo 5 caracteres).";
  if (ctx.laboratorio === "LNF" && d.calibrable) {
    if (!d.sentido || !["T", "C", "T+C"].includes(d.sentido)) return "LNF: indique el sentido solicitado (tracción, compresión o ambos).";
    if (d.acondicionamientoH == null || !(d.acondicionamientoH >= 0)) return "LNF: indique el tiempo de acondicionamiento (horas).";
    if (d.tempAmbiente == null || !Number.isFinite(d.tempAmbiente)) return "LNF: indique la temperatura ambiente del acondicionamiento.";
  }
  return null;
}

/** Etiqueta de custodia del instrumento: OT y número de ítem. */
export const etiquetaInstrumento = (otCodigo: string, numero: number) => `${otCodigo}-I${String(numero).padStart(2, "0")}`;

/* ------------------------------------------------- calibración del ítem --- */
/** Calibración vigente del ítem: la última que no está reemplazada. */
export function calibracionVigente<T extends CalibracionOt>(cals: T[], instrumentoId: string): T | null {
  const del = cals.filter((c) => c.instrumentoId === instrumentoId && c.estado !== "reemplazada");
  return del.length ? del[del.length - 1] : null;
}

/** Por qué no se puede abrir una calibración desde el ítem (null = se puede). */
export function motivoCalibrar(item: InstrumentoOt & { otEstado?: string }, cals: CalibracionOt[]): string | null {
  if (item.otEstado === "cerrada" || item.otEstado === "anulada") return `La OT está ${item.otEstado}.`;
  if (item.estado === "por_recibir") return `Primero registre la recepción del ${nombreItem(item)}.`;
  if (item.estado === "no_apto") return `El ${nombreItem(item)} se recibió como no calibrable.`;
  if (item.estado !== "recibido") return `El ${nombreItem(item)} está ${String(item.estado).replace("_", " ")}: no se calibra.`;
  const v = calibracionVigente(cals, item.id);
  if (v) return `El ${nombreItem(item)} ya tiene la calibración ${v.numeroCertificado ?? v.codigo}${v.estado === "emitida" ? " emitida (si hay un error, reemítala)" : ""}.`;
  return null;
}

/* ------------------------------------------------------------ entrega --- */
/** Por qué no se puede registrar la entrega del certificado (null = se puede). */
export function motivoEntrega(cal: { estado: string; codigo: string; numeroCertificado?: string | null; emitidoAt?: Date | string | null; entregadoAt?: Date | string | null }, fecha: Date, ahora = new Date()): string | null {
  const nombre = cal.numeroCertificado ?? cal.codigo;
  if (cal.estado !== "emitida") return `Solo se entrega un certificado emitido: ${nombre} está ${cal.estado === "reemplazada" ? "reemplazado" : "sin emitir"}.`;
  if (cal.entregadoAt) return `La entrega del certificado ${nombre} ya está registrada (${dmy(dia(cal.entregadoAt)!)}).`;
  if (Number.isNaN(fecha.getTime())) return "Fecha de entrega no válida.";
  if (fecha.getTime() > ahora.getTime() + 60_000) return "La fecha de entrega no puede ser futura.";
  const em = dia(cal.emitidoAt), f = dia(fecha);
  if (em && f && f < em) return `La entrega (${dmy(f)}) no puede ser anterior a la emisión del certificado (${dmy(em)}).`;
  return null;
}

/* ---------------------------------------------------------- devolución --- */
export interface DatosDevolucion {
  fechaHora: string;
  recibidoPor: string;
  estadoFisico: string;
}

/** Por qué no se puede registrar la devolución del instrumento (null = se puede). */
export function motivoDevolucion(item: InstrumentoOt, cals: CalibracionOt[], d: DatosDevolucion, ahora = new Date()): string | null {
  if (item.estado === "devuelto") return `El ${nombreItem(item)} ya fue devuelto.`;
  if (item.estado === "por_recibir" || item.estado === "anulado") return `El ${nombreItem(item)} no está en custodia del laboratorio.`;
  if (item.estado === "recibido") {
    const v = calibracionVigente(cals, item.id);
    if (!v || v.estado !== "emitida") return `El ${nombreItem(item)} se devuelve con su certificado emitido${v ? ` (${v.codigo} está ${v.estado === "calculada" ? "en borrador" : v.estado.replace("_", " ")})` : " (aún no tiene calibración)"}.`;
  }
  const t = instanteChile(d.fechaHora);
  if (Number.isNaN(t)) return "Indique la fecha y hora de la devolución.";
  if (t > ahora.getTime() + 5 * 60_000) return "La fecha de devolución no puede ser futura.";
  if (item.recibidoAt && t < new Date(item.recibidoAt).getTime() - 60_000) return "La devolución no puede ser anterior a la recepción.";
  if (!d.recibidoPor?.trim()) return "Indique quién recibe el instrumento.";
  if (!(ESTADOS_FISICOS as readonly string[]).includes(d.estadoFisico)) return "Indique el estado del instrumento al devolverlo.";
  return null;
}

/* ------------------------------------------------------------- cierre --- */
/** Calibraciones como documentos para la regla general del cierre (plazos.faltantesParaCerrar). */
export function documentosDeCalibraciones(cals: CalibracionOt[]): { numero: string; estado: string; entregadoAt: Date | string | null }[] {
  return cals
    .filter((c) => c.estado !== "reemplazada")
    .map((c) => ({
      numero: c.numeroCertificado ?? c.codigo,
      estado: c.estado === "emitida" ? "emitido" : c.estado === "en_revision" || c.estado === "en_firma" ? "en_firma" : "borrador",
      entregadoAt: c.estado === "emitida" ? c.entregadoAt ?? null : null,
    }));
}

/**
 * Documento de un ítem no calibrable: su informe técnico (met_informe_tecnico) o el
 * certificado del servicio externo (met_servicio_externo).
 */
export interface DocumentoNoCalibrable {
  instrumentoId: string | null;
  tipo: "informe_tecnico" | "certificado_externo" | string;
  numero: string | null;
  /** Informe: borrador | en_firma | emitido | anulado. Externo: solicitado | aprobado | enviado | validado | rechazado | anulado. */
  estado: string;
  entregadoAt: Date | string | null;
  entregaMedio?: string | null;
}

/** El informe técnico emitido y el certificado externo validado son documentos entregables. */
export const esEntregableNoCalibrable = (d: Pick<DocumentoNoCalibrable, "tipo" | "estado">): boolean =>
  d.tipo === "informe_tecnico" ? d.estado === "emitido" : d.tipo === "certificado_externo" ? d.estado === "validado" : false;

/**
 * Decisión del 24-10: en Metrología, el informe técnico emitido del no calibrable y el
 * certificado externo validado cuentan como documento para el cierre de la OT, con la
 * misma regla de entrega que los demás (oficial ⇒ falta registrar su entrega).
 * Los que aún están en elaboración no son documento todavía (no bloquean ni cuentan).
 */
export function documentosDeNoCalibrables(docs: DocumentoNoCalibrable[]): { numero: string; estado: string; entregadoAt: Date | string | null }[] {
  return docs.filter(esEntregableNoCalibrable).map((d) => ({
    numero: d.numero ?? (d.tipo === "informe_tecnico" ? "informe técnico" : "certificado externo"),
    estado: "emitido",
    entregadoAt: d.entregadoAt ?? null,
  }));
}

/** Todos los documentos de Metrología que cuentan para el cierre: certificados de calibración, informes técnicos y certificados externos. */
export function documentosDeMetrologia(cals: CalibracionOt[], docsNoCalibrables: DocumentoNoCalibrable[] = []) {
  return [...documentosDeCalibraciones(cals), ...documentosDeNoCalibrables(docsNoCalibrables)];
}

/**
 * Qué falta en los instrumentos para cerrar la OT (además de la regla general de
 * documentos): todos recibidos, los calibrables con su calibración y, si se exige,
 * todos devueltos. Los mensajes de estado de cada certificado los da la regla general.
 */
export function faltantesInstrumentos(items: InstrumentoOt[], cals: CalibracionOt[], exigeDevolucion: boolean): string[] {
  const f: string[] = [];
  for (const i of items.filter((x) => x.estado !== "anulado")) {
    if (i.estado === "por_recibir") { f.push(`El ${nombreItem(i)} no se ha recibido.`); continue; }
    if (i.estado === "recibido" && !calibracionVigente(cals, i.id)) f.push(`El ${nombreItem(i)} no tiene calibración.`);
    if (exigeDevolucion && (i.estado === "recibido" || i.estado === "no_apto"))
      f.push(`El ${nombreItem(i)} sigue en custodia del laboratorio: registre su devolución.`);
  }
  return f;
}

/**
 * Ítem no calibrable: el que sigue en custodia como no apto y el que ya se
 * devolvió sin calibrar (B-004: al registrar la devolución pasa a «devuelto»,
 * pero sigue resuelto con su informe técnico o su servicio externo validado).
 */
export const esNoCalibrable = (i: Pick<InstrumentoOt, "estado" | "calibrable">): boolean =>
  i.estado === "no_apto" || (i.estado === "devuelto" && i.calibrable === false);

/** Servicio externo a medio camino: ni validado, ni rechazado ni anulado. */
export const ESTADOS_EXTERNO_EN_CURSO = ["solicitado", "aprobado", "enviado"] as const;
const TEXTO_EXTERNO_EN_CURSO: Record<string, string> = {
  solicitado: "solicitado: falta que el Departamento lo apruebe o rechace",
  aprobado: "aprobado: falta registrar su envío y validar el certificado externo",
  enviado: "enviado: falta validar el certificado externo",
};

/** Reglas configurables del cierre de una OT de Metrología (Parámetros del sistema). */
export interface ReglasCierreMetrologia {
  /** metrologia.cierre_exige_devolucion (por defecto sí). */
  exigeDevolucion: boolean;
  /** metrologia_ficha.no_apto_exige_documento (por defecto no). */
  noAptoExigeDocumento?: boolean;
}

/**
 * D04-31 · Lo que falta en los instrumentos de una OT de Metrología, además de la
 * regla general de documentos. Lo usan IGUAL el cierre técnico, el cierre final, la
 * pestaña «Instrumentos», el panel «Informe y cierre» y la Ruta de la OT:
 *   - todos recibidos y los calibrables con su calibración (faltantesInstrumentos);
 *   - devueltos, si el parámetro lo exige;
 *   - ningún servicio externo a medio camino (solicitado, aprobado o enviado);
 *   - con no_apto_exige_documento = sí, cada no calibrable con su informe técnico
 *     emitido o su certificado externo validado.
 */
export function faltantesMetrologia(
  items: InstrumentoOt[], cals: CalibracionOt[], docs: DocumentoNoCalibrable[], reglas: ReglasCierreMetrologia,
): string[] {
  const f = faltantesInstrumentos(items, cals, reglas.exigeDevolucion);
  const vivos = items.filter((x) => x.estado !== "anulado");
  const de = (id: string | null) => vivos.find((i) => i.id === id);
  for (const d of docs) {
    const i = de(d.instrumentoId);
    const del = i ? `del ${nombreItem(i)} ` : "";
    if (d.tipo === "certificado_externo" && (ESTADOS_EXTERNO_EN_CURSO as readonly string[]).includes(d.estado))
      f.push(`El servicio externo ${del}está ${TEXTO_EXTERNO_EN_CURSO[d.estado]}.`);
  }
  if (reglas.noAptoExigeDocumento) {
    const resueltos = new Set(docs.filter(esEntregableNoCalibrable).map((d) => d.instrumentoId));
    for (const i of vivos.filter((x) => esNoCalibrable(x) && !resueltos.has(x.id)))
      f.push(`Falta el informe técnico emitido o el servicio externo validado del no calibrable ${nombreItem(i)}.`);
  }
  return f;
}

/** Estados desde los que ya no se cierra técnicamente. */
export const ESTADOS_SIN_CIERRE_TECNICO = ["finalizada", "informada", "cerrada", "anulada"] as const;

/**
 * D04-31 · Cierre técnico (Jefe de Laboratorio, «Cerrar técnicamente → Comercial»): exige
 * lo mismo que el cierre final en lo técnico, para que la OT no llegue a «finalizada» (ni
 * a «Encuestas por registrar») con algo pendiente:
 *   - cada documento de Metrología (certificado de calibración, informe técnico o
 *     certificado externo validado) oficial y entregado (regla general faltantesParaCerrar);
 *   - lo de faltantesMetrologia (recepción, calibración, devolución, servicio externo y
 *     documento del no calibrable).
 * Devuelve la lista de lo que falta (vacía = se puede cerrar técnicamente).
 */
export function faltantesCierreTecnico(
  otEstado: string, items: InstrumentoOt[], cals: CalibracionOt[], docs: DocumentoNoCalibrable[], reglas: ReglasCierreMetrologia,
): string[] {
  if ((ESTADOS_SIN_CIERRE_TECNICO as readonly string[]).includes(otEstado)) return [`La OT ya está ${otEstado}.`];
  if (!items.some((x) => x.estado !== "anulado")) return ["La OT no tiene instrumentos registrados."];
  return [
    ...faltantesParaCerrar({ estado: otEstado, documentos: documentosDeMetrologia(cals, docs), resultadosNoAprobados: 0 }),
    ...faltantesMetrologia(items, cals, docs, reglas),
  ];
}

/* ---------------------------------------------------- barra de la ficha --- */
export type EstadoPaso = "hecho" | "actual" | "pendiente";
export const PASOS_FICHA = ["Recepción", "Toma de datos", "Cálculo GUM", "Revisión Jefe Lab.", "Firma y emisión", "Entrega"] as const;

/**
 * Barra de 6 pasos de la ficha de calibración (maqueta de Metrología), deducida del estado:
 * Recepción → Toma de datos → Cálculo GUM → Revisión Jefe Lab. → Firma y emisión → Entrega.
 * Devolver al metrólogo lleva la barra de vuelta a «Toma de datos».
 */
export function pasosFicha(c: { estado: string; calculada: boolean; recibido: boolean; entregado: boolean; devuelta?: boolean }): { paso: string; estado: EstadoPaso }[] {
  const e = c.estado === "calculada" ? "borrador" : c.estado;
  const emitida = e === "emitida" || e === "reemplazada";
  const hechos = [
    c.recibido,
    c.calculada && !c.devuelta || ["en_revision", "en_firma"].includes(e) || emitida,
    c.calculada && !c.devuelta || ["en_revision", "en_firma"].includes(e) || emitida,
    e === "en_firma" || emitida,
    emitida,
    emitida && c.entregado,
  ];
  // En borrador calculado, el paso actual es la revisión (falta enviarla).
  const actual = hechos.findIndex((h) => !h);
  return PASOS_FICHA.map((paso, i) => ({ paso, estado: hechos[i] && (actual < 0 || i < actual) ? "hecho" : i === actual ? "actual" : "pendiente" }));
}

/* ------------------------------------------- hoja de control desde la OT --- */
/**
 * Datos del instrumento, del cliente y de la OT que se imprimen en el certificado: los
 * de la OT y de la recepción mandan (no se escriben a mano); lo demás (clase, rango
 * calibrado, contacto, lugar, desviaciones) viene del formulario.
 */
/**
 * D04-26 / D04-27 · Solicitante que imprimen la hoja de control y el informe técnico:
 * el de la OT (persona que lo pidió); en una OT interna, el laboratorio solicitante.
 */
export function solicitanteDeOt(ot: { solicitante?: string | null; labSolicitante?: string | null }): string | null {
  const s = String(ot.solicitante ?? "").trim();
  if (s) return s;
  const l = String(ot.labSolicitante ?? "").trim();
  return l || null;
}

export function instrumentoDesdeOt(
  form: Record<string, any>,
  item: { descripcion: string; marca?: string | null; modelo?: string | null; serie?: string | null; idEspecial?: string | null; capacidad?: string | null; resolucion?: string | null; rango?: string | null; recibidoAt?: Date | string | null },
  ot: {
    codigo: string; fechaOt: string | null; cliente?: string | null; clienteDireccion?: string | null; labSolicitante?: string | null;
    /** D04-26: solicitante de la OT (heredado de la cotización) y cómo contactarlo. */
    solicitante?: string | null; contacto?: string | null;
  },
): Record<string, any> {
  const de = (v: string | null | undefined, previo: any) => (v != null && String(v).trim() !== "" ? v : previo ?? null);
  return {
    ...form,
    item: item.descripcion,
    marca: de(item.marca, form.marca),
    modelo: de(item.modelo, form.modelo),
    serie: de(item.serie, form.serie),
    idEspecial: de(item.idEspecial, form.idEspecial),
    cap: de(item.capacidad, form.cap),
    res: de(item.resolucion, form.res),
    rango: de(form.rango, item.rango),
    ot: ot.codigo,
    fechaOt: ot.fechaOt,
    fechaRecepcion: dia(item.recibidoAt ?? null),
    cliente: de(ot.cliente, form.cliente),
    solicitante: de(form.solicitante, solicitanteDeOt(ot)),
    contacto: de(form.contacto, ot.contacto),
    direccion: de(form.direccion, ot.clienteDireccion),
  };
}
