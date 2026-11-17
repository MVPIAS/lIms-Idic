/**
 * Plazos y cierre de la OT · reglas PURAS (sin BD), probadas en plazos.spec.ts.
 * Contrato: docs/FLUJO_FIRMA_CIERRE.md.
 *
 * Semáforo de la fecha de compromiso (OT no cerrada ni anulada):
 *   vencida    · la fecha de compromiso ya pasó;
 *   por_vencer · vence hoy o en los próximos N días (parámetro
 *                avisos.dias_por_vencer; UMBRAL_POR_VENCER_DIAS si no hay valor);
 *   en_plazo   · vence más adelante;
 *   sin_fecha  · la OT no tiene fecha de compromiso.
 * COM-23 (IDIC, 17-11-2026): el cumplimiento se mide con la RECEPCIÓN EN EL DCO
 * (orden_trabajo.fecha_recep_dco). Registrada esa fecha, el plazo deja de
 * correr (semáforo «terminada»; diasRestantes = días a favor o, si es negativo,
 * de atraso). Sin recepción en el DCO, el semáforo sigue corriendo como antes.
 * La bandeja («OT vencidas / por vencer») usa exactamente estos cortes.
 */
import { estadosValidos, validarTransicion } from "../common/estados";
import { ZONA_CHILE, hoyChile, diaChile } from "../common/fecha-chile";

/** Valor por defecto de avisos.dias_por_vencer (COM-23: 3 días). */
export const UMBRAL_POR_VENCER_DIAS = 3;

/** Opciones del semáforo: umbral leído del parámetro y recepción en el DCO. */
export interface OpcionesSemaforo {
  /** avisos.dias_por_vencer (1–30). Sin valor: UMBRAL_POR_VENCER_DIAS. */
  diasPorVencer?: number | null;
  /** orden_trabajo.fecha_recep_dco: con ella el plazo ya se midió (COM-23). */
  fechaRecepDco?: Date | string | null;
}

/**
 * SQL (expresión entera) del umbral «por vencer» de la OT `o`: el parámetro
 * avisos.dias_por_vencer de su tenant (1–30) o, si no hay, UMBRAL_POR_VENCER_DIAS.
 * Lo usan las tarjetas de Mi bandeja (COM-23).
 */
export const SQL_DIAS_POR_VENCER = `COALESCE((SELECT CASE WHEN btrim(p.valor) ~ '^[0-9]{1,2}$' AND btrim(p.valor)::int BETWEEN 1 AND 30 THEN btrim(p.valor)::int END
    FROM parametro_sistema p WHERE p.tenant_id = o.tenant_id AND p.categoria = 'avisos' AND p.codigo = 'dias_por_vencer' AND p.activo LIMIT 1), ${UMBRAL_POR_VENCER_DIAS})`;

/** OT cuyo plazo sigue corriendo: sin recepción en el DCO (COM-23). */
export const SQL_PLAZO_CORRE = `o.fecha_recep_dco IS NULL`;

/** Umbral «por vencer» saneado (1–30 días; si no, el valor por defecto). */
export function umbralPorVencer(dias?: number | null): number {
  return Number.isInteger(dias) && (dias as number) >= 1 && (dias as number) <= 30 ? (dias as number) : UMBRAL_POR_VENCER_DIAS;
}
export const ZONA_HORARIA = ZONA_CHILE;
export const OT_ESTADOS_TERMINADOS = ["cerrada", "anulada"] as const;

export type Semaforo = "en_plazo" | "por_vencer" | "vencida" | "sin_fecha" | "terminada";

/** Fecha de hoy (AAAA-MM-DD) en Chile, sin depender de la zona del servidor. */
export function hoyCl(ahora: Date = new Date()): string {
  return hoyChile(ahora);
}

/** AAAA-MM-DD de una fecha DATE de Prisma (medianoche UTC), de un texto o, si es un instante, su día en Chile (frente f8). */
export function diaDe(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (typeof v === "string" && !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  return diaChile(v);
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
  opts: OpcionesSemaforo = {},
): { semaforo: Semaforo; diasRestantes: number | null; medidoEn?: string } {
  if (estado && (OT_ESTADOS_TERMINADOS as readonly string[]).includes(estado)) {
    return { semaforo: "terminada", diasRestantes: null };
  }
  const dia = diaDe(fechaCompromiso);
  // COM-23: con la recepción en el DCO el plazo ya se midió y deja de correr.
  const recepDco = diaDe(opts.fechaRecepDco ?? null);
  if (recepDco) return { semaforo: "terminada", diasRestantes: dia ? diasEntre(recepDco, dia) : null, medidoEn: recepDco };
  if (!dia) return { semaforo: "sin_fecha", diasRestantes: null };
  const dias = diasEntre(hoyCl(ahora), dia);
  if (dias < 0) return { semaforo: "vencida", diasRestantes: dias };
  if (dias <= umbralPorVencer(opts.diasPorVencer)) return { semaforo: "por_vencer", diasRestantes: dias };
  return { semaforo: "en_plazo", diasRestantes: dias };
}

/** Fecha de compromiso desde el plazo de la cotización: recepción + días corridos. */
export function fechaCompromisoDesdePlazo(
  fechaRecepcion: Date | string | null | undefined,
  plazoDias: number | null | undefined,
  ahora: Date = new Date(),
): string | null {
  if (!plazoDias || plazoDias <= 0) return null;
  // Frente f8: la recepción (timestamptz) cuenta desde su día en Chile, venga como Date o como ISO.
  const base = (fechaRecepcion ? diaChile(fechaRecepcion) : null) ?? hoyCl(ahora);
  return sumarDias(base, plazoDias);
}

/** Valida una fecha de compromiso fijada a mano. Devuelve el error o null. */
export function validarFechaCompromiso(fecha: string, fechaRecepcion: Date | string | null | undefined): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(`${fecha}T00:00:00Z`)))
    return "Fecha de compromiso inválida (use AAAA-MM-DD).";
  // Frente f8: el día de recepción en Chile, venga como Date o como ISO con hora.
  const recep = fechaRecepcion ? diaChile(fechaRecepcion) : null;
  if (recep && fecha < recep) return `La fecha de compromiso no puede ser anterior a la recepción de la OT (${recep}).`;
  return null;
}

/* ========================================================================== */
/* Cierre                                                                     */
/* ========================================================================== */

export interface DocumentoCierre {
  numero: string;
  estado: string; // en_firma | oficial | emitido | devuelto | anulado | borrador (calibración en elaboración)
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
  /**
   * Documentos por muestra, producto o laboratorio (frente r1b): lo que falta
   * cubrir (plantilla-render/cobertura-documento.ts › pendientesCobertura).
   */
  coberturaPendiente?: string[];
}): string[] {
  if (p.estado === "cerrada") return ["La OT ya está cerrada."];
  if (p.estado === "anulada") return ["La OT está anulada."];
  const f: string[] = [];
  if (p.resultadosNoAprobados > 0)
    f.push(`Hay ${p.resultadosNoAprobados} resultado(s) sin aprobar.`);
  const vivos = p.documentos.filter((d) => d.estado !== "anulado");
  if (!vivos.some((d) => d.estado !== "devuelto" && d.estado !== "borrador"))
    f.push("La OT no tiene informes ni certificados emitidos.");
  for (const d of vivos) {
    if (d.estado === "en_firma")
      f.push(`El documento ${d.numero} está en firma${d.pendienteDe ? ` (pendiente de ${d.pendienteDe})` : ""}.`);
    else if (d.estado === "devuelto")
      f.push(`El documento ${d.numero} fue devuelto sin firmar: reemítalo o anúlelo.`);
    else if (d.estado === "borrador")
      f.push(`El certificado ${d.numero} está en elaboración (borrador): falta enviarlo a revisión y emitirlo.`);
    else if (!d.entregadoAt) f.push(`El documento ${d.numero} es oficial pero falta registrar su entrega al cliente.`);
  }
  f.push(...(p.coberturaPendiente ?? []));
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
