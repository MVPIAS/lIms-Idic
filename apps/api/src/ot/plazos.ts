/**
 * Plazos y cierre de la OT · reglas PURAS (sin BD), probadas en plazos.spec.ts.
 * Contrato: docs/FLUJO_FIRMA_CIERRE.md.
 *
 * Semáforo de la fecha de compromiso (OT no cerrada ni anulada):
 *   vencida    · la fecha de compromiso ya pasó;
 *   por_vencer · vence hoy o en los próximos UMBRAL_POR_VENCER_DIAS días;
 *   en_plazo   · vence más adelante;
 *   sin_fecha  · la OT no tiene fecha de compromiso.
 * La bandeja («OT vencidas / por vencer») usa exactamente estos cortes.
 */
import { estadosValidos, validarTransicion } from "../common/estados";

export const UMBRAL_POR_VENCER_DIAS = 3;
export const ZONA_HORARIA = "America/Santiago";
export const OT_ESTADOS_TERMINADOS = ["cerrada", "anulada"] as const;

export type Semaforo = "en_plazo" | "por_vencer" | "vencida" | "sin_fecha" | "terminada";

/** Fecha de hoy (AAAA-MM-DD) en Chile, sin depender de la zona del servidor. */
export function hoyCl(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_HORARIA, year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}

/** AAAA-MM-DD de una fecha DATE de Prisma (medianoche UTC) o de un texto. */
export function diaDe(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (typeof v === "string") return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
  return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
}

/** Días entre dos AAAA-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function sumarDias(dia: string, n: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function semaforoPlazo(
  fechaCompromiso: Date | string | null | undefined,
  estado: string | null | undefined,
  ahora: Date = new Date(),
): { semaforo: Semaforo; diasRestantes: number | null } {
  if (estado && (OT_ESTADOS_TERMINADOS as readonly string[]).includes(estado)) {
    return { semaforo: "terminada", diasRestantes: null };
  }
  const dia = diaDe(fechaCompromiso);
  if (!dia) return { semaforo: "sin_fecha", diasRestantes: null };
  const dias = diasEntre(hoyCl(ahora), dia);
  if (dias < 0) return { semaforo: "vencida", diasRestantes: dias };
  if (dias <= UMBRAL_POR_VENCER_DIAS) return { semaforo: "por_vencer", diasRestantes: dias };
  return { semaforo: "en_plazo", diasRestantes: dias };
}

/** Fecha de compromiso desde el plazo de la cotización: recepción + días corridos. */
export function fechaCompromisoDesdePlazo(
  fechaRecepcion: Date | string | null | undefined,
  plazoDias: number | null | undefined,
  ahora: Date = new Date(),
): string | null {
  if (!plazoDias || plazoDias <= 0) return null;
  const base = fechaRecepcion
    ? typeof fechaRecepcion === "string"
      ? fechaRecepcion.slice(0, 10)
      : hoyCl(fechaRecepcion)
    : hoyCl(ahora);
  return sumarDias(base, plazoDias);
}

/** Valida una fecha de compromiso fijada a mano. Devuelve el error o null. */
export function validarFechaCompromiso(fecha: string, fechaRecepcion: Date | string | null | undefined): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(`${fecha}T00:00:00Z`)))
    return "Fecha de compromiso inválida (use AAAA-MM-DD).";
  const recep = fechaRecepcion
    ? typeof fechaRecepcion === "string"
      ? fechaRecepcion.slice(0, 10)
      : hoyCl(fechaRecepcion)
    : null;
  if (recep && fecha < recep) return `La fecha de compromiso no puede ser anterior a la recepción de la OT (${recep}).`;
  return null;
}

/* ========================================================================== */
/* Cierre                                                                     */
/* ========================================================================== */

export interface DocumentoCierre {
  numero: string;
  estado: string; // en_firma | oficial | emitido | devuelto | anulado
  entregadoAt: Date | string | null;
  pendienteDe?: string | null;
}

/**
 * Qué falta para cerrar la OT. Lista vacía = se puede cerrar.
 *   · todos los resultados aprobados;
 *   · al menos un documento vigente, y todos los vigentes OFICIALES y ENTREGADOS;
 *   · ningún documento devuelto sin resolver (reemitir o anular).
 */
export function faltantesParaCerrar(p: {
  estado: string;
  documentos: DocumentoCierre[];
  resultadosNoAprobados: number;
}): string[] {
  if (p.estado === "cerrada") return ["La OT ya está cerrada."];
  if (p.estado === "anulada") return ["La OT está anulada."];
  const f: string[] = [];
  if (p.resultadosNoAprobados > 0)
    f.push(`Hay ${p.resultadosNoAprobados} resultado(s) sin aprobar.`);
  const vivos = p.documentos.filter((d) => d.estado !== "anulado");
  if (!vivos.some((d) => d.estado !== "devuelto"))
    f.push("La OT no tiene informes ni certificados emitidos.");
  for (const d of vivos) {
    if (d.estado === "en_firma")
      f.push(`El documento ${d.numero} está en firma${d.pendienteDe ? ` (pendiente de ${d.pendienteDe})` : ""}.`);
    else if (d.estado === "devuelto")
      f.push(`El documento ${d.numero} fue devuelto sin firmar: reemítalo o anúlelo.`);
    else if (!d.entregadoAt) f.push(`El documento ${d.numero} es oficial pero falta registrar su entrega al cliente.`);
  }
  return f;
}

/**
 * Camino de estados de la OT hasta `destino` respetando la máquina de estados
 * existente (common/estados.ts), sin pasar por 'anulada'. Cerrar una OT que
 * sigue en 'recepcionada' recorre recepcionada → en_analisis → validacion →
 * finalizada → cerrada: cada paso es una transición permitida. Devuelve null
 * si no hay camino (estado desconocido o final).
 */
export function caminoEstadosOt(desde: string, destino = "cerrada"): string[] | null {
  if (desde === destino) return [];
  const todos = estadosValidos("ot").filter((e) => e !== "anulada");
  const permitido = (a: string, b: string) => {
    try {
      validarTransicion("ot", a, b);
      return a !== b;
    } catch {
      return false;
    }
  };
  if (!todos.includes(desde)) return null;
  const previo = new Map<string, string>();
  const cola = [desde];
  const visto = new Set([desde]);
  while (cola.length) {
    const a = cola.shift()!;
    for (const b of todos) {
      if (visto.has(b) || !permitido(a, b)) continue;
      visto.add(b);
      previo.set(b, a);
      if (b === destino) {
        const camino = [b];
        let x = b;
        while (previo.get(x) !== desde) {
          x = previo.get(x)!;
          camino.unshift(x);
        }
        return camino;
      }
      cola.push(b);
    }
  }
  return null;
}
