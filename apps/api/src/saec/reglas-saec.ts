/**
 * Reglas PURAS del SAEC (EP-11 11.31 a 11.35), probadas en reglas-saec.spec.ts.
 * Las aplican los controladores de saec.module.ts.
 */

export const ESTADOS_CASO = ["abierto", "en_proceso", "cerrado", "archivado"] as const;
export type EstadoCaso = (typeof ESTADOS_CASO)[number];

/** Transiciones admitidas del caso (11.35). Reabrir un caso cerrado exige motivo; archivado es final. */
export const TRANSICIONES_CASO: Record<EstadoCaso, EstadoCaso[]> = {
  abierto: ["en_proceso", "cerrado"],
  en_proceso: ["cerrado"],
  cerrado: ["archivado", "en_proceso"],
  archivado: [],
};

export const NOMBRE_ESTADO_CASO: Record<EstadoCaso, string> = {
  abierto: "abierto",
  en_proceso: "en proceso",
  cerrado: "cerrado",
  archivado: "archivado",
};

export function erroresTransicionCaso(
  desde: string,
  hacia: string,
  ctx: { motivo?: string | null; evidenciasPrestadas: number },
): string[] {
  const d = desde as EstadoCaso;
  const h = hacia as EstadoCaso;
  if (!(ESTADOS_CASO as readonly string[]).includes(h)) return [`Estado desconocido: ${hacia}.`];
  if (d === h) return [`El caso ya está ${NOMBRE_ESTADO_CASO[d] ?? d}.`];
  if (!(TRANSICIONES_CASO[d] ?? []).includes(h))
    return [`Un caso ${NOMBRE_ESTADO_CASO[d] ?? d} no puede pasar a ${NOMBRE_ESTADO_CASO[h]}.`];
  const e: string[] = [];
  if ((h === "cerrado" || h === "archivado") && ctx.evidenciasPrestadas > 0)
    e.push(`Hay ${ctx.evidenciasPrestadas} evidencia(s) del caso prestada(s): registre su devolución antes de cerrarlo.`);
  if (d === "cerrado" && h === "en_proceso" && !ctx.motivo?.trim()) e.push("Para reabrir un caso cerrado indique el motivo.");
  return e;
}

/** RUC de la Fiscalía: 6 a 12 dígitos, guion y dígito verificador (0-9 o K). */
export const RUC_RE = /^\d{6,12}-[\dkK]$/;

/** 11.31 · datos del oficio obligatorios al registrar la evidencia. */
export function erroresIngresoEvidencia(
  d: { nue?: string | null; oficioNumero?: string | null; oficioUnidad?: string | null; oficioFecha?: string | null; rucCausa?: string | null },
  hoy: string,
): string[] {
  const e: string[] = [];
  if (!d.oficioNumero?.trim()) e.push("Indique el Nº del oficio.");
  if (!d.oficioUnidad?.trim()) e.push("Indique la unidad solicitante del oficio.");
  if (!d.nue?.trim()) e.push("Indique el NUE de la evidencia.");
  if (d.oficioFecha && d.oficioFecha > hoy) e.push("La fecha del oficio no puede ser futura.");
  if (d.rucCausa && !RUC_RE.test(d.rucCausa.trim())) e.push("El RUC de la causa tiene la forma NNNNNNNNNN-D.");
  return e;
}

/** 11.33 · la solicitud de entrega exige plazo de devolución (no anterior a hoy). */
export function erroresSolicitudPrestamo(d: { tipo?: string | null; fechaDevolucionPrevista?: string | null }, hoy: string): string[] {
  if ((d.tipo ?? "entrega") !== "entrega") return [];
  if (!d.fechaDevolucionPrevista) return ["Indique el plazo de devolución."];
  if (d.fechaDevolucionPrevista < hoy) return ["El plazo de devolución no puede ser anterior a hoy."];
  return [];
}

/** Préstamo entregado y fuera de plazo (alerta). */
export function prestamoVencido(p: { estado: string; fechaDevolucionPrevista?: string | null }, hoy: string): boolean {
  return p.estado === "entregado" && !!p.fechaDevolucionPrevista && p.fechaDevolucionPrevista < hoy;
}

/** 11.34 · tipos de peritaje (lista por confirmar con la D11, EP-11 P8). */
export const TIPOS_PERITAJE = ["balistico_comparativo", "funcionamiento", "identificacion", "explosivos", "otro"] as const;
export const NOMBRE_TIPO_PERITAJE: Record<(typeof TIPOS_PERITAJE)[number], string> = {
  balistico_comparativo: "Balístico comparativo",
  funcionamiento: "Funcionamiento del arma",
  identificacion: "Identificación del elemento",
  explosivos: "Explosivos",
  otro: "Otro",
};

/**
 * B-044 · Confirmar o descartar una coincidencia IBIS: desde «sin confirmar», con
 * motivo (mínimo 5 caracteres). Volver a «sin confirmar» también pide motivo.
 */
export function erroresEstadoHit(actual: string, nuevo: string, motivo?: string | null): string[] {
  const e: string[] = [];
  if (!["sin_confirmar", "confirmado", "descartado"].includes(nuevo)) e.push("Estado de coincidencia no válido.");
  if (actual === nuevo) e.push(`La coincidencia ya está ${nuevo.replace("_", " ")}.`);
  if (nuevo !== "sin_confirmar" && actual !== "sin_confirmar") e.push("Solo se confirma o descarta una coincidencia sin confirmar: vuélvala antes a «sin confirmar» con su motivo.");
  if (!motivo || motivo.trim().length < 5) e.push("Indique el motivo (mínimo 5 caracteres).");
  return e;
}
