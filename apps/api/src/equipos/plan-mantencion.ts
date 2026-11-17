/**
 * Plan de mantención preventiva y reportes de gestión de equipos (contrato
 * §4.4.3) · funciones PURAS, probadas en plan-mantencion.spec.ts. Las fechas
 * son días AAAA-MM-DD (hora de Chile); se suman en UTC sin horas.
 */

export const TIPOS_PLAN = ["preventiva", "verificacion", "limpieza"] as const;
export const RESULTADOS_MANTENCION = ["conforme", "conforme_con_obs", "no_conforme"] as const;
/** Etiquetas del estado del equipo (las mismas de la pantalla Equipos, apps/web/lib/equipos.ts). */
export const ETIQUETA_ESTADO_EQUIPO: Record<string, string> = {
  operativo: "Operativo",
  en_calibracion: "En calibración",
  fuera_servicio: "Fuera de servicio",
  baja: "De baja",
};
export const etiquetaEstadoEquipo = (estado: string | null | undefined) => (estado ? ETIQUETA_ESTADO_EQUIPO[estado] ?? estado : "");
/** Una mantención (preventiva o correctiva) con resultado no conforme deja el equipo fuera de servicio. */
export const dejaFueraDeServicio = (resultado: string | null | undefined) => resultado === "no_conforme";
/** Días de holgura para considerar «a tiempo» una mantención programada. */
export const TOLERANCIA_DIAS = 7;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const t = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
export const diasEntre = (a: string, b: string) => Math.round((t(b) - t(a)) / 86_400_000);
export function sumarDias(d: string, n: number): string {
  return new Date(t(d) + n * 86_400_000).toISOString().slice(0, 10);
}

export function erroresPlan(p: { equipoId?: string | null; tipo?: string | null; descripcion?: string | null; frecuenciaDias?: number | null; proximaFecha?: string | null }): string[] {
  const e: string[] = [];
  if (!p.equipoId) e.push("Elija el equipo.");
  if (!p.tipo || !(TIPOS_PLAN as readonly string[]).includes(p.tipo)) e.push("El tipo es preventiva, verificación o limpieza.");
  if (!p.descripcion || p.descripcion.trim().length < 3) e.push("Describa la tarea (mínimo 3 caracteres).");
  if (!Number.isInteger(p.frecuenciaDias) || p.frecuenciaDias! < 1 || p.frecuenciaDias! > 3650) e.push("La frecuencia va de 1 a 3650 días.");
  if (!p.proximaFecha || !FECHA.test(p.proximaFecha)) e.push("Indique la próxima fecha (AAAA-MM-DD).");
  return e;
}

export function erroresEjecucion(m: { fecha?: string | null; resultado?: string | null; costo?: number | null }, hoy: string): string[] {
  const e: string[] = [];
  if (!m.fecha || !FECHA.test(m.fecha)) e.push("Indique la fecha en que se hizo (AAAA-MM-DD).");
  else if (diasEntre(hoy, m.fecha) > 0) e.push("La fecha de la mantención no puede ser futura.");
  if (m.resultado && !(RESULTADOS_MANTENCION as readonly string[]).includes(m.resultado)) e.push("Resultado: conforme, conforme con observaciones o no conforme.");
  if (m.costo != null && !(Number.isFinite(m.costo) && m.costo >= 0)) e.push("El costo no puede ser negativo.");
  return e;
}

/** Próxima fecha tras ejecutar: desde la ejecución (no desde lo programado), como en la práctica de laboratorio. */
export const siguienteFecha = (fechaEjecucion: string, frecuenciaDias: number) => sumarDias(fechaEjecucion, frecuenciaDias);

export type EstadoPlazo = "vencido" | "por_vencer" | "al_dia" | "sin_fecha";
export function estadoPlazo(fecha: string | null | undefined, hoy: string, diasAviso = 30): EstadoPlazo {
  if (!fecha) return "sin_fecha";
  const d = diasEntre(hoy, fecha.slice(0, 10));
  if (d < 0) return "vencido";
  if (d <= diasAviso) return "por_vencer";
  return "al_dia";
}

/** Fechas programadas de un plan dentro de [desde, hasta], a partir de su próxima fecha (máx. 400). */
export function ocurrencias(proxima: string, frecuenciaDias: number, desde: string, hasta: string): string[] {
  const out: string[] = [];
  if (frecuenciaDias < 1) return out;
  let d = proxima;
  if (diasEntre(d, desde) > 0) {
    const saltos = Math.floor(diasEntre(d, desde) / frecuenciaDias);
    d = sumarDias(d, saltos * frecuenciaDias);
    if (diasEntre(d, desde) > 0) d = sumarDias(d, frecuenciaDias);
  }
  while (diasEntre(d, hasta) >= 0 && out.length < 400) {
    out.push(d);
    d = sumarDias(d, frecuenciaDias);
  }
  return out;
}

export interface EjecucionPlan {
  fecha: string;
  fechaProgramada: string | null;
  costo: number | null;
}

/**
 * Cumplimiento del plan en un período: lo ejecutado con fecha programada en
 * el período, a tiempo si se hizo hasta TOLERANCIA_DIAS después; más lo que
 * venció en el período y sigue sin hacerse (atrasado).
 */
export function cumplimiento(ejecutadas: EjecucionPlan[], vencidasPendientes: number) {
  const conPrograma = ejecutadas.filter((e) => e.fechaProgramada);
  const aTiempo = conPrograma.filter((e) => diasEntre(e.fechaProgramada!, e.fecha) <= TOLERANCIA_DIAS).length;
  const programadas = conPrograma.length + vencidasPendientes;
  return {
    programadas,
    ejecutadas: conPrograma.length,
    aTiempo,
    atrasadas: conPrograma.length - aTiempo,
    pendientes: vencidasPendientes,
    porcentaje: programadas ? Math.round((aTiempo / programadas) * 1000) / 10 : null,
    costo: Math.round(ejecutadas.reduce((a, e) => a + (e.costo ?? 0), 0) * 100) / 100,
  };
}

/* ------------------------------------------- programas auditables (Químico, R5) --- */
/**
 * Programa de mantención: el registro del sistema de gestión de calidad que agrupa los
 * planes de un laboratorio en un año (p. ej. «Programa anual de mantención 2026 · LQC»).
 * Cada plan se vincula a su programa y cada mantención ejecutada guarda el programa con
 * que se hizo: el auditor ve lo programado, lo ejecutado y el cumplimiento por programa.
 *   borrador → aprobado (ya no se cambia, salvo cerrarlo) → cerrado.
 */
export const ESTADOS_PROGRAMA = ["borrador", "aprobado", "cerrado"] as const;
export type EstadoPrograma = (typeof ESTADOS_PROGRAMA)[number];
const TRANSICIONES_PROGRAMA: Record<EstadoPrograma, readonly EstadoPrograma[]> = {
  borrador: ["aprobado"],
  aprobado: ["cerrado"],
  cerrado: [],
};
export const puedeTransitarPrograma = (actual: string, nuevo: string) =>
  ((TRANSICIONES_PROGRAMA as Record<string, readonly string[]>)[actual] ?? []).includes(nuevo);

export function erroresPrograma(p: { codigo?: string | null; nombre?: string | null; anio?: number | null; documentoCodigo?: string | null }): string[] {
  const e: string[] = [];
  if (!p.codigo || p.codigo.trim().length < 2) e.push("Indique el código del programa (mínimo 2 caracteres).");
  if (!p.nombre || p.nombre.trim().length < 3) e.push("Indique el nombre del programa (mínimo 3 caracteres).");
  if (!Number.isInteger(p.anio) || p.anio! < 2000 || p.anio! > 2100) e.push("Indique el año del programa (2000 a 2100).");
  if (p.documentoCodigo != null && p.documentoCodigo.trim().length > 60) e.push("El código del documento del sistema de calidad admite hasta 60 caracteres.");
  return e;
}

/** Un programa aprobado o cerrado ya no se modifica (ni sus planes se agregan o quitan): queda como evidencia. */
export function motivoProgramaCerrado(estado: string | null | undefined): string | null {
  if (estado === "aprobado") return "El programa está aprobado: no se modifica. Ciérrelo y apruebe uno nuevo si hay cambios.";
  if (estado === "cerrado") return "El programa está cerrado: es evidencia de auditoría y no se modifica.";
  return null;
}

/** Período del programa: su año calendario. */
export const periodoPrograma = (anio: number) => ({ desde: `${anio}-01-01`, hasta: `${anio}-12-31` });
