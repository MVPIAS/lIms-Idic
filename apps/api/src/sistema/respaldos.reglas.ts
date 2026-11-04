/**
 * Respaldos programados (contrato §4.8.4) · reglas PURAS de la pantalla
 * Administración › Respaldos y de los avisos, probadas en respaldos.reglas.spec.ts.
 *
 * Quién respalda: el servicio «respaldo» de docker-compose.prod.yml
 * (scripts/backup/respaldo-programado.sh) o, en on-premise, backup.sh por
 * systemd. Ambos dejan cada ejecución en `respaldo_registro` y su política en
 * `respaldo_servicio` (latido). La API solo lee, decide el color y avisa.
 */
import { hoyChile, instanteDeHoraChile, sumarDiasCalendario } from "../common/fecha-chile";

/* ------------------------------------------------------------- política --- */

export interface PoliticaRespaldo {
  /** Hora del respaldo diario en Chile, «HH:MM». */
  hora: string;
  retencionDiarios: number;
  retencionSemanales: number;
  retencionMensuales: number;
  /** Horas sin respaldo correcto para dar el estado en rojo y avisar. */
  horasAlerta: number;
  avisarFallo: boolean;
}

export const POLITICA_DEFECTO: PoliticaRespaldo = {
  hora: "02:00",
  retencionDiarios: 14,
  retencionSemanales: 8,
  retencionMensuales: 0,
  horasAlerta: 26,
  avisarFallo: true,
};

const entero = (v: unknown, d: number, min: number, max: number) => {
  const t = String(v ?? "").trim();
  if (!t) return d;
  const n = Number(t);
  return Number.isInteger(n) && n >= min && n <= max ? n : d;
};
const dos = (n: number) => String(n).padStart(2, "0");

/** «HH:MM» válido o null. */
export function horaValida(v: unknown): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h <= 23 && mi <= 59 ? `${dos(h)}:${dos(mi)}` : null;
}

/**
 * Política vigente: la que REPORTA el servicio en su latido (es la que aplica de
 * verdad) y, si no hay servicio, la de «Parámetros del sistema › Respaldos».
 */
export function politicaDe(
  filas: { codigo: string; valor: string | null; activo?: boolean }[],
  servicio?: { detalle?: Record<string, unknown> | null } | null,
): PoliticaRespaldo {
  const d = POLITICA_DEFECTO;
  const v = (c: string) => filas.find((f) => f.codigo === c && f.activo !== false)?.valor ?? null;
  const s = (servicio?.detalle ?? {}) as Record<string, unknown>;
  const horaParam = entero(v("hora"), 2, 0, 23);
  const avisar = String(v("avisar_fallo") ?? "si").trim().toLowerCase();
  return {
    hora: horaValida(s.hora) ?? `${dos(horaParam)}:00`,
    retencionDiarios: entero(s.retencion_diarios ?? v("retencion_diarios"), d.retencionDiarios, 1, 365),
    retencionSemanales: entero(s.retencion_semanales ?? v("retencion_semanales"), d.retencionSemanales, 0, 104),
    retencionMensuales: entero(s.retencion_mensuales, d.retencionMensuales, 0, 120),
    horasAlerta: entero(v("horas_alerta"), d.horasAlerta, 1, 168),
    avisarFallo: !["no", "false", "0"].includes(avisar),
  };
}

/** Próximo respaldo programado: la hora de hoy en Chile si aún no llega; si no, la de mañana. */
export function proximoRespaldo(ahora: Date, hora: string): Date {
  const [h, m] = (horaValida(hora) ?? POLITICA_DEFECTO.hora).split(":").map(Number);
  const instante = (dia: string) => {
    const [a, me, di] = dia.split("-").map(Number);
    return instanteDeHoraChile(a, me, di, h, m);
  };
  const hoy = hoyChile(ahora);
  const t = instante(hoy);
  return t.getTime() > ahora.getTime() ? t : instante(sumarDiasCalendario(hoy, 1));
}

/* -------------------------------------------------------------- estado --- */

export interface EjecucionRespaldo {
  resultado: "SOLICITADO" | "EN_CURSO" | "OK" | "ERROR" | string;
  fin?: Date | string | null;
  inicio?: Date | string | null;
  mensaje?: string | null;
}

export interface ServicioRespaldo {
  modo: "contenedor" | "systemd" | string;
  latidoAt: Date | string;
}

export interface EstadoRespaldos {
  /** verde = último respaldo correcto y reciente, y el servicio en marcha. */
  color: "verde" | "rojo";
  titulo: string;
  /** Frases completas con cada motivo del rojo (vacío si está en verde). */
  motivos: string[];
  /** El servicio programado está en marcha (latido reciente). */
  servicioActivo: boolean;
}

/** Minutos sin latido tras los que el servicio en contenedor se da por detenido (late cada minuto). */
export const LATIDO_MAX_MIN = 5;

const ms = (v: Date | string | null | undefined) => (v ? new Date(v).getTime() : NaN);

/**
 * ¿Está en marcha el servicio? El de contenedor late cada minuto; backup.sh
 * (systemd) solo al respaldar, una vez al día: se le da el plazo de alerta.
 */
export function servicioActivo(s: ServicioRespaldo | null | undefined, ahora: Date, horasAlerta: number): boolean {
  if (!s) return false;
  const edad = ahora.getTime() - ms(s.latidoAt);
  if (Number.isNaN(edad)) return false;
  return s.modo === "contenedor" ? edad <= LATIDO_MAX_MIN * 60_000 : edad <= horasAlerta * 3_600_000;
}

/**
 * Semáforo de la pantalla. Rojo si:
 *   · el último respaldo terminado falló;
 *   · no hay respaldo correcto, o el último tiene más de `horasAlerta` horas;
 *   · el servicio programado no está en marcha.
 */
export function estadoRespaldos(p: {
  ultimoTerminado: EjecucionRespaldo | null;
  ultimoOk: EjecucionRespaldo | null;
  servicio: ServicioRespaldo | null;
  ahora: Date;
  horasAlerta: number;
}): EstadoRespaldos {
  const motivos: string[] = [];
  const activo = servicioActivo(p.servicio, p.ahora, p.horasAlerta);
  if (!p.servicio) {
    motivos.push("El servicio de respaldo programado no está instalado en este servidor: no se ha registrado ninguna ejecución.");
  } else if (!activo) {
    motivos.push(
      p.servicio.modo === "contenedor"
        ? `El servicio de respaldo no responde desde hace más de ${LATIDO_MAX_MIN} minutos: puede estar detenido.`
        : `El respaldo programado del servidor no se ha ejecutado en las últimas ${p.horasAlerta} horas.`,
    );
  }
  if (p.ultimoTerminado?.resultado === "ERROR") {
    motivos.push(`El último respaldo falló${p.ultimoTerminado.mensaje ? `: ${p.ultimoTerminado.mensaje}` : "."}`);
  }
  if (!p.ultimoOk) {
    motivos.push("Todavía no hay ningún respaldo correcto.");
  } else {
    const horas = (p.ahora.getTime() - ms(p.ultimoOk.fin ?? p.ultimoOk.inicio)) / 3_600_000;
    if (!(horas <= p.horasAlerta)) motivos.push(`El último respaldo correcto tiene más de ${p.horasAlerta} horas (${Math.floor(horas)} h).`);
  }
  return motivos.length
    ? { color: "rojo", titulo: "Respaldo con problemas", motivos, servicioActivo: activo }
    : { color: "verde", titulo: "Respaldo al día", motivos, servicioActivo: activo };
}

/** Tamaño legible con coma decimal («12,4 MB»). */
export function tamanoLegible(bytes: number | string | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes === "") return "—";
  const b = Number(bytes);
  if (!Number.isFinite(b) || b < 0) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let x = b;
  while (x >= 1024 && i < u.length - 1) {
    x /= 1024;
    i++;
  }
  return `${i === 0 ? x : x.toFixed(1).replace(".", ",")} ${u[i]}`;
}
