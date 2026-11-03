/**
 * Agenda de recursos y eventos (contrato §4.5.8, §4.5.9) · funciones PURAS,
 * probadas en recurrencia.spec.ts.
 *
 * Las fechas son días de calendario «aaaa-mm-dd» y las horas «HH:MM» en hora de
 * Chile: la recurrencia se calcula sobre el calendario, sin instantes ni zonas,
 * así un evento de las 09:00 sigue a las 09:00 tras el cambio de horario.
 */
import { sumarDiasCalendario } from "../common/fecha-chile";

export const RECURRENCIAS = ["NINGUNA", "DIARIA", "SEMANAL", "MENSUAL"] as const;
export type Recurrencia = (typeof RECURRENCIAS)[number];
export const TIPOS_RECURSO = ["VEHICULO", "EQUIPO", "SALA", "SERVICIO", "OTRO"] as const;
export type TipoRecurso = (typeof TIPOS_RECURSO)[number];
export const TIPOS_EVENTO = ["REUNION", "SALIDA_TERRENO", "MUESTREO", "MANTENCION", "CAPACITACION", "AUDITORIA", "OTRO"] as const;

/** Tope de ocurrencias de una serie y de días de una consulta. */
export const MAX_OCURRENCIAS = 500;
export const MAX_DIAS_CONSULTA = 62;

export interface DefRecurrencia {
  fecha: string; // primera ocurrencia
  recurrencia: Recurrencia;
  intervalo?: number | null; // cada N días / semanas / meses
  diasSemana?: number[] | null; // 1 = lunes … 7 = domingo (solo SEMANAL)
  repetirHasta?: string | null; // último día posible, inclusive
  repeticiones?: number | null; // número total de ocurrencias
  excepciones?: string[] | null; // días anulados (siguen contando para «repeticiones»)
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;
export const esDia = (s: unknown): s is string => typeof s === "string" && DIA.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().startsWith(s);

/** Día de la semana ISO (1 = lunes … 7 = domingo). */
export function diaSemana(dia: string): number {
  const d = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Días entre dos fechas (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

/** Lunes de la semana del día. */
export const lunesDe = (dia: string) => sumarDiasCalendario(dia, 1 - diaSemana(dia));

/** Días de un mes (mes 1–12). */
const diasDelMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();

/**
 * Candidatos de la serie en orden, desde la primera ocurrencia. Se detiene en
 * `limite` (día) o tras MAX_OCURRENCIAS candidatos.
 */
function* candidatos(r: DefRecurrencia, limite: string): Generator<string> {
  const paso = Math.max(1, Math.min(99, Math.trunc(r.intervalo ?? 1)));
  if (r.recurrencia === "NINGUNA") {
    if (r.fecha <= limite) yield r.fecha;
    return;
  }
  let n = 0;
  if (r.recurrencia === "DIARIA") {
    for (let d = r.fecha; d <= limite && n < MAX_OCURRENCIAS; d = sumarDiasCalendario(d, paso), n++) yield d;
    return;
  }
  if (r.recurrencia === "SEMANAL") {
    const dias = [...new Set((r.diasSemana?.length ? r.diasSemana : [diaSemana(r.fecha)]).filter((x) => x >= 1 && x <= 7))].sort();
    for (let lunes = lunesDe(r.fecha); lunes <= limite && n < MAX_OCURRENCIAS; lunes = sumarDiasCalendario(lunes, 7 * paso)) {
      for (const ds of dias) {
        const d = sumarDiasCalendario(lunes, ds - 1);
        if (d < r.fecha) continue;
        if (d > limite || n >= MAX_OCURRENCIAS) return;
        n++;
        yield d;
      }
    }
    return;
  }
  // MENSUAL: el mismo día del mes; los meses que no lo tienen (31, 30, 29) se saltan.
  const [a0, m0, d0] = r.fecha.split("-").map(Number);
  for (let k = 0; n < MAX_OCURRENCIAS && k < MAX_OCURRENCIAS * 12; k += paso) {
    const total = m0 - 1 + k;
    const anio = a0 + Math.floor(total / 12);
    const mes = (total % 12) + 1;
    if (d0 > diasDelMes(anio, mes)) continue;
    const d = `${anio}-${String(mes).padStart(2, "0")}-${String(d0).padStart(2, "0")}`;
    if (d > limite) return;
    n++;
    yield d;
  }
}

/** Ocurrencias de la serie entre `desde` y `hasta` (inclusive), sin las excepciones. */
export function ocurrencias(r: DefRecurrencia, desde: string, hasta: string): string[] {
  const limite = r.repetirHasta && r.repetirHasta < hasta ? r.repetirHasta : hasta;
  const fuera = new Set(r.excepciones ?? []);
  const tope = r.recurrencia === "NINGUNA" ? 1 : r.repeticiones && r.repeticiones > 0 ? r.repeticiones : Infinity;
  const salida: string[] = [];
  let n = 0;
  for (const d of candidatos(r, limite)) {
    if (++n > tope) break;
    if (d >= desde && !fuera.has(d)) salida.push(d);
  }
  return salida;
}

/** Última ocurrencia posible de la serie (null = sin fin dentro del tope). */
export function ultimaOcurrencia(r: DefRecurrencia): string | null {
  if (r.recurrencia === "NINGUNA") return r.fecha;
  if (!r.repeticiones && !r.repetirHasta) return null;
  const todas = ocurrencias({ ...r, excepciones: [] }, r.fecha, r.repetirHasta ?? sumarDiasCalendario(r.fecha, 366 * 5));
  return todas.length ? todas[todas.length - 1] : null;
}

/* ------------------------------------------------------- horas y solapes --- */

const HORA = /^([01]\d|2[0-3]):([0-5]\d)(:\d{2})?$/;
export const esHora = (s: unknown): s is string => typeof s === "string" && HORA.test(s);
/** «HH:MM» → minutos desde medianoche. */
export const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export interface Bloque {
  dia: string;
  inicio: number; // minutos
  fin: number;
}

/** Bloque horario de una ocurrencia; un evento de día completo ocupa el horario del recurso. */
export function bloque(dia: string, ev: { todoDia: boolean; horaInicio?: string | null; horaFin?: string | null }, jornada: { desde: string; hasta: string }): Bloque {
  if (ev.todoDia || !ev.horaInicio || !ev.horaFin) return { dia, inicio: minutos(jornada.desde), fin: minutos(jornada.hasta) };
  return { dia, inicio: minutos(ev.horaInicio), fin: minutos(ev.horaFin) };
}

export const seSolapan = (a: Bloque, b: Bloque) => a.dia === b.dia && a.inicio < b.fin && b.inicio < a.fin;

/* --------------------------------------------------- disponibilidad y costo --- */

export interface Recurso {
  costoHora?: number | null;
  costoUso?: number | null;
  horaDesde: string;
  horaHasta: string;
  diasHabiles: number[];
}

/** Costo de un uso: horas × costo por hora + costo fijo por uso (redondeado a 2 decimales). */
export function costoUso(r: Pick<Recurso, "costoHora" | "costoUso">, minutosUso: number): number {
  const v = ((r.costoHora ?? 0) * minutosUso) / 60 + (r.costoUso ?? 0);
  return Math.round(v * 100) / 100;
}

/** Minutos ocupados de un día, uniendo bloques que se pisan y recortando a la jornada. */
export function minutosOcupados(bloques: Bloque[], jornada: { desde: string; hasta: string }): number {
  const a = minutos(jornada.desde);
  const z = minutos(jornada.hasta);
  const tramos = bloques.map((b) => [Math.max(a, b.inicio), Math.min(z, b.fin)] as const).filter(([i, f]) => f > i).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let fin = -1;
  for (const [i, f] of tramos) {
    if (i >= fin) {
      total += f - i;
      fin = f;
    } else if (f > fin) {
      total += f - fin;
      fin = f;
    }
  }
  return total;
}

/** Minutos disponibles del recurso en el día (0 si el día no es hábil para él). */
export function minutosJornada(r: Pick<Recurso, "horaDesde" | "horaHasta" | "diasHabiles">, dia: string): number {
  if (!r.diasHabiles.includes(diaSemana(dia))) return 0;
  return Math.max(0, minutos(r.horaHasta) - minutos(r.horaDesde));
}

/** Días de la vista: «dia» (1), «semana» (lunes a domingo) o «mes» (del 1 al último). */
export function rangoVista(vista: string, dia: string): { desde: string; hasta: string } {
  if (vista === "semana") {
    const l = lunesDe(dia);
    return { desde: l, hasta: sumarDiasCalendario(l, 6) };
  }
  if (vista === "mes") {
    const [a, m] = dia.split("-").map(Number);
    return { desde: `${dia.slice(0, 7)}-01`, hasta: `${dia.slice(0, 7)}-${String(diasDelMes(a, m)).padStart(2, "0")}` };
  }
  return { desde: dia, hasta: dia };
}

const NOMBRE_DIA = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/**
 * Ocurrencias de una reserva que caen fuera de la disponibilidad del recurso:
 * en un día que no es hábil para él o, si el evento tiene hora, fuera de su
 * horario («desde»–«hasta»). Un evento de día completo ocupa la jornada del
 * recurso, así que solo se revisa el día. Devuelve un mensaje por problema
 * distinto (el horario se informa una vez; los días, uno por fecha).
 */
export function fueraDeDisponibilidad(
  r: Pick<Recurso, "horaDesde" | "horaHasta" | "diasHabiles"> & { nombre: string },
  dias: string[],
  ev: { todoDia: boolean; horaInicio?: string | null; horaFin?: string | null },
): string[] {
  const salida: string[] = [];
  if (!ev.todoDia && ev.horaInicio && ev.horaFin && (minutos(ev.horaInicio) < minutos(r.horaDesde) || minutos(ev.horaFin) > minutos(r.horaHasta)))
    salida.push(`${r.nombre}: disponible solo de ${r.horaDesde.slice(0, 5)} a ${r.horaHasta.slice(0, 5)} (la reserva es de ${ev.horaInicio.slice(0, 5)} a ${ev.horaFin.slice(0, 5)})`);
  const habiles = r.diasHabiles?.length ? r.diasHabiles : [1, 2, 3, 4, 5, 6, 7];
  for (const d of dias)
    if (!habiles.includes(diaSemana(d)))
      salida.push(`${r.nombre}: el ${NOMBRE_DIA[diaSemana(d) - 1]} ${d} no está disponible (días: ${habiles.map((x) => NOMBRE_DIA[x - 1]).join(", ")})`);
  return salida;
}
