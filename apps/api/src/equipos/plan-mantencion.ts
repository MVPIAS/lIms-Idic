/**
 * Plan de mantención preventiva y reportes de gestión de equipos (contrato
 * §4.4.3) · funciones PURAS, probadas en plan-mantencion.spec.ts. Las fechas
 * son días AAAA-MM-DD (hora de Chile); se suman en UTC sin horas.
 */

export const TIPOS_PLAN = ["preventiva", "verificacion", "limpieza"] as const;
export const RESULTADOS_MANTENCION = ["conforme", "conforme_con_obs", "no_conforme"] as const;
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
