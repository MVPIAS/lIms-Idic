/**
 * Cabecera de inspección de una OT del BPCH · reglas PURAS (sin BD), probadas
 * en reglas-cabecera.spec.ts. Contrato: docs/FLUJO_BPCH_CABECERA_OT.md.
 *
 * EP-10 10.3 «Programación de la inspección · SAC-PG01-IT10 · NCh 44»: lugar,
 * dirección y comuna, contacto, fecha, inspectores, procedimiento de control,
 * documento de origen, esquema, elementos, CNC-DGMN, clase y Nº UN, lote,
 * tamaños, vencimiento del producto y vigencia del informe. Se imprime en el
 * Informe de Inspección y en el documento final.
 */
import { errorFormatoCnc, erroresLote } from "../comun/reglas-bpch";

/** Procedimientos de control que propone la pantalla (lista abierta: el IDIC puede usar otros). */
export const PROCEDIMIENTOS_CONTROL = ["SAC-PG01-P01", "SAC-PG05"] as const;

/** Procesos BPCH cuya cabecera vive en otro expediente (aquí solo se agregan dirección, comuna y contacto). */
export const PROCESOS_CON_EXPEDIENTE = ["INTERNACION", "REINSPECCION"] as const;
/** Campos que se pueden registrar en la OT aunque la cabecera venga de un expediente. */
export const CAMPOS_COMPLEMENTO = ["direccion", "comuna", "contacto"] as const;

export interface CabeceraDto {
  lugarInspeccion?: string | null;
  direccion?: string | null;
  comuna?: string | null;
  contacto?: string | null;
  fechaInspeccion?: string | null;
  inspectores?: string | null;
  procedimiento?: string | null;
  documentoOrigen?: string | null;
  fechaDocumento?: string | null;
  esquema?: "LOTES" | "TIPO" | null;
  elementoGenerico?: string | null;
  elementoEspecifico?: string | null;
  cncDgmn?: string | null;
  claseDivisionUn?: string | null;
  numeroUn?: string | null;
  identificacionLote?: string | null;
  tamanoLote?: number | null;
  tamanoMuestra?: number | null;
  fechaVencimientoProducto?: string | null;
  vigenciaInforme?: string | null;
  observaciones?: string | null;
}

const vacio = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

/**
 * Errores al guardar la cabecera (lista vacía = válida). El procedimiento de
 * control es obligatorio (EP-10 10.3); lugar y fecha lo son antes de emitir
 * (ver faltantesParaEmitirInspeccion). La fecha de inspección futura se admite:
 * se programa la inspección (no futura · POR CONFIRMAR con el IDIC).
 */
export function erroresCabecera(d: CabeceraDto, opts: { soloComplemento?: boolean } = {}): string[] {
  const e: string[] = [];
  if (opts.soloComplemento) {
    const otros = Object.entries(d).filter(([k, v]) => v !== undefined && !(CAMPOS_COMPLEMENTO as readonly string[]).includes(k));
    if (otros.length)
      e.push("En una internación o una reinspección la cabecera se registra en su expediente; aquí solo dirección, comuna y contacto.");
    return e;
  }
  if (vacio(d.procedimiento)) e.push("Indique el procedimiento de control (p. ej. SAC-PG01-P01).");
  if (!vacio(d.cncDgmn)) {
    const f = errorFormatoCnc(String(d.cncDgmn));
    if (f) e.push(f);
  }
  e.push(...erroresLote({ tamanoLote: d.tamanoLote ?? null, tamanoMuestra: d.tamanoMuestra ?? null }));
  const fecha = (v: string | null | undefined, n: string) => {
    if (vacio(v)) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(new Date(`${v}T12:00:00Z`).getTime())) e.push(`${n}: fecha no válida (AAAA-MM-DD).`);
  };
  fecha(d.fechaInspeccion, "Fecha de inspección");
  fecha(d.fechaDocumento, "Fecha del documento de origen");
  fecha(d.fechaVencimientoProducto, "Vencimiento del producto");
  fecha(d.vigenciaInforme, "Vigencia del informe");
  if (!vacio(d.vigenciaInforme) && !vacio(d.fechaInspeccion) && String(d.vigenciaInforme) < String(d.fechaInspeccion))
    e.push("La vigencia del informe no puede ser anterior a la fecha de inspección.");
  return e;
}

/**
 * Lo que la cabecera debe tener antes de emitir el Informe de Inspección
 * (EP-10 10.11 «cabecera F1 completa»): lugar y fecha de inspección (en
 * Producción Nacional, si no se registraron, los del programa).
 */
export function faltantesParaEmitirInspeccion(vista: { lugar_inspeccion?: string | null; fecha_inspeccion?: string | null } | null): string[] {
  if (!vista)
    return ["Registre la cabecera de inspección de la OT (lugar y fecha de inspección): ficha de la OT › «Cabecera» › «Cabecera de inspección»."];
  const f: string[] = [];
  if (vacio(vista.lugar_inspeccion)) f.push("La cabecera de inspección no tiene el lugar de inspección.");
  if (vacio(vista.fecha_inspeccion)) f.push("La cabecera de inspección no tiene la fecha de inspección.");
  return f;
}

/** Cambios entre la cabecera guardada y la nueva (para el historial): campo → { antes, despues }. */
export function diferencias(antes: Record<string, unknown> | null, despues: Record<string, unknown>): Record<string, { antes: unknown; despues: unknown }> {
  const d: Record<string, { antes: unknown; despues: unknown }> = {};
  for (const [k, v] of Object.entries(despues)) {
    const a = antes?.[k] ?? null;
    const n = v ?? null;
    if (String(a ?? "") !== String(n ?? "")) d[k] = { antes: a, despues: n };
  }
  return d;
}

/** Iniciales de una persona («Rosa Riquelme» → «R. R.»): en los documentos, los inspectores van por iniciales. */
export function iniciales(nombre: string | null | undefined): string {
  // B-093: solo las palabras del nombre (sin paréntesis, signos, números ni partículas):
  // «Inspector 1 · SCC (prueba)» daba «I. ·. S..»; ahora «I. S.».
  const PARTICULAS = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "van", "von"]);
  return String(nombre ?? "")
    .replace(/\([^)]*\)/g, " ")
    .split(/[^\p{L}'’]+/u)
    .filter((p) => p && /^\p{L}/u.test(p) && !PARTICULAS.has(p.toLowerCase()))
    .slice(0, 3)
    .map((p) => `${p[0].toLocaleUpperCase("es-CL")}.`)
    .join(" ");
}

/**
 * B-019 (recorrido MP-07 D07-08, MP-08 D08-03) · lo que la cabecera de
 * inspección hereda de lo que ya se conoce: la clasificación del producto de
 * Producción Nacional (clase/división y grupo, Nº ONU), la RAF y el lote; o del
 * prototipo (solicitud DGMN, esquema «TIPO», elemento, clasificación). Solo se
 * proponen los campos que la cabecera aún tiene vacíos: lo escrito manda.
 */
export interface FuenteCabecera {
  documentoOrigen?: string | null;
  fechaDocumento?: string | null;
  esquema?: "LOTES" | "TIPO" | null;
  elemento?: string | null;
  cnc?: string | null;
  claseDivision?: string | null;
  grupoCompatibilidad?: string | null;
  numeroOnu?: string | null;
  lote?: string | null;
  lugar?: string | null;
  fechaInspeccion?: string | null;
  tamanoMuestra?: number | null;
}

export function heredarCabecera(f: FuenteCabecera | null, actual: CabeceraDto | null): Partial<CabeceraDto> {
  if (!f) return {};
  const clase = `${(f.claseDivision ?? "").trim()}${(f.grupoCompatibilidad ?? "").trim().toUpperCase()}`;
  const onu = (f.numeroOnu ?? "").replace(/^\s*UN\s*/i, "").trim();
  const propuesta: Partial<CabeceraDto> = {
    documentoOrigen: f.documentoOrigen?.trim() || null,
    fechaDocumento: f.fechaDocumento || null,
    esquema: f.esquema ?? null,
    elementoGenerico: f.elemento?.trim() || null,
    cncDgmn: f.cnc?.trim() || null,
    claseDivisionUn: clase || null,
    numeroUn: onu || null,
    identificacionLote: f.lote?.trim() || null,
    lugarInspeccion: f.lugar?.trim() || null,
    fechaInspeccion: f.fechaInspeccion || null,
    tamanoMuestra: f.tamanoMuestra ?? null,
  };
  const out: Partial<CabeceraDto> = {};
  for (const [k, v] of Object.entries(propuesta) as [keyof CabeceraDto, any][]) {
    if (v === null || v === undefined || v === "") continue;
    if (actual && !vacio(actual[k])) continue;
    (out as any)[k] = v;
  }
  return out;
}
