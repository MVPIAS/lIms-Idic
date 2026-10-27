/**
 * Fechas y horas del IDIC · regla ÚNICA de la API (frente f8).
 *
 * El IDIC trabaja en hora de Chile (America/Santiago, con horario de verano).
 * Pasadas las 21:00 (verano, UTC−3) o las 20:00 (invierno, UTC−4) en UTC ya es
 * el día siguiente. Regla:
 *   1. Lo que se guarda como `timestamptz` se queda en UTC (no se toca).
 *   2. Todo «hoy», todo truncado a día, todo año de numeración y toda fecha
 *      que se imprime o se muestra se calcula EXPLÍCITAMENTE en la zona del
 *      IDIC con estas funciones, sea cual sea la zona del proceso (`TZ`) o del
 *      servidor. Prohibido `toISOString().slice(0, 10)` sobre un instante,
 *      `getFullYear()`/`getDate()`/`setHours()` locales y `toLocale*String`
 *      sin `timeZone` (lo vigila fecha-chile.regla.spec.ts).
 *   3. En SQL, la sesión de la API trabaja en la misma zona (PrismaService
 *      añade `options=-c TimeZone=<zona>` a la conexión), así `current_date`,
 *      `now()::date`, `x::date` y `date_trunc` sobre `timestamptz` cortan el
 *      día en Chile. `align_zona_horaria.sql` fija además la zona por defecto
 *      de la base para psql, semillas e informes externos.
 *
 * La zona es configurable con la variable `ZONA_HORARIA` (por defecto
 * America/Santiago). Una zona no válida se ignora (se usa la de Chile).
 *
 * Recorrido MP-02, D02-27: el bloque de firmas del informe mostraba 02:09 cuando
 * en Chile eran las 05:09, porque las fechas se formateaban con la zona horaria
 * del equipo servidor (UTC en el contenedor).
 *
 * Fechas de CALENDARIO (columnas DATE: recepción, compromiso, vigencia…): Prisma
 * las entrega como «aaaa-mm-ddT00:00:00.000Z». Esas no se convierten a la hora
 * de Chile (saldrían un día antes): se muestran tal cual, como hace la web
 * (apps/web/lib/format.ts).
 */
export const ZONA_POR_DEFECTO = "America/Santiago";

/** ¿Es un identificador de zona IANA que el motor entiende? */
export function zonaValida(z: unknown): z is string {
  if (typeof z !== "string" || !/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+){0,2}$/.test(z)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

/** Zona horaria del IDIC: `ZONA_HORARIA` si es válida; si no, America/Santiago. */
export function zonaHoraria(env: Record<string, string | undefined> = process.env): string {
  const z = env.ZONA_HORARIA?.trim();
  return z && zonaValida(z) ? z : ZONA_POR_DEFECTO;
}

/** Zona efectiva de este proceso (se lee una vez al arrancar). */
export const ZONA_CHILE = zonaHoraria();

/** La zona como literal SQL ('America/Santiago'); validada, no admite comillas. */
export const SQL_ZONA = `'${ZONA_CHILE}'`;

/** «Hoy» en la zona del IDIC como expresión SQL (DATE). */
export const SQL_HOY = `(now() AT TIME ZONE ${SQL_ZONA})::date`;

/** Día (DATE) en la zona del IDIC de una expresión SQL `timestamptz`. */
export const sqlDia = (expr: string) => `((${expr}) AT TIME ZONE ${SQL_ZONA})::date`;

/**
 * URL de conexión con la zona de la sesión fijada (`options=-c TimeZone=…`).
 * Si la URL ya trae `options`, se respeta tal cual.
 */
export function urlConZona(url: string | undefined, zona: string = ZONA_CHILE): string | undefined {
  if (!url || /[?&]options=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}options=${encodeURIComponent(`-c TimeZone=${zona}`)}`;
}

const SOLO_DIA = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/;

export interface PartesFecha {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
}

const FORMATO = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONA_CHILE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const dos = (n: number) => String(n).padStart(2, "0");

/** Date desde Date, ISO o «aaaa-mm-dd»; null si no se entiende. */
function aDate(valor: unknown): Date | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const d = valor instanceof Date ? valor : new Date(String(valor));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ¿Es una fecha de calendario (sin hora)? «aaaa-mm-dd» o un DATE de Prisma (medianoche UTC exacta). */
export function esFechaCalendario(valor: unknown): boolean {
  if (typeof valor === "string") return SOLO_DIA.test(valor.trim());
  if (valor instanceof Date && !Number.isNaN(valor.getTime()))
    return valor.getUTCHours() === 0 && valor.getUTCMinutes() === 0 && valor.getUTCSeconds() === 0 && valor.getUTCMilliseconds() === 0;
  return false;
}

/** Año, mes, día, hora y minuto en Chile de un instante. */
export function partesChile(d: Date): PartesFecha {
  const p = Object.fromEntries(FORMATO.formatToParts(d).map((x) => [x.type, x.value]));
  return { anio: Number(p.year), mes: Number(p.month), dia: Number(p.day), hora: Number(p.hour) % 24, minuto: Number(p.minute) };
}

/** Partes de una fecha de calendario (sin convertir de zona). */
function partesCalendario(valor: unknown, d: Date): PartesFecha {
  const m = typeof valor === "string" ? SOLO_DIA.exec(valor.trim()) : null;
  if (m) return { anio: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]), hora: 0, minuto: 0 };
  return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(), hora: 0, minuto: 0 };
}

/** dd-mm-aaaa en Chile (las fechas de calendario, tal cual). Vacío sin valor; el texto si no es fecha. */
export function fechaChile(valor: unknown): string {
  const d = aDate(valor);
  if (!d) return valor === null || valor === undefined ? "" : String(valor);
  const p = esFechaCalendario(valor) ? partesCalendario(valor, d) : partesChile(d);
  return `${dos(p.dia)}-${dos(p.mes)}-${p.anio}`;
}

/** dd-mm-aaaa HH:MM en hora de Chile. Una fecha de calendario sale sin hora. */
export function fechaHoraChile(valor: unknown): string {
  const d = aDate(valor);
  if (!d) return valor === null || valor === undefined ? "" : String(valor);
  if (esFechaCalendario(valor)) return fechaChile(valor);
  const p = partesChile(d);
  return `${dos(p.dia)}-${dos(p.mes)}-${p.anio} ${dos(p.hora)}:${dos(p.minuto)}`;
}

/** Año en Chile (numeración de documentos: el 31-12 a las 22:00 sigue siendo el año que termina). */
export function anioChile(ahora: Date = new Date()): number {
  return partesChile(ahora).anio;
}

/** Hoy en Chile como «aaaa-mm-dd». */
export function hoyChile(ahora: Date = new Date()): string {
  const p = partesChile(ahora);
  return `${p.anio}-${dos(p.mes)}-${dos(p.dia)}`;
}

/**
 * Instante UTC de una hora de pared de Chile (horario de verano incluido).
 * `aaaa-mm-dd` + hora y minuto escritos en Chile → Date.
 */
export function instanteDeHoraChile(anio: number, mes: number, dia: number, hora = 0, minuto = 0): Date {
  const pared = Date.UTC(anio, mes - 1, dia, hora, minuto);
  const comoUtc = (t: number) => {
    const p = partesChile(new Date(t));
    return Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto);
  };
  // Dos aproximaciones bastan: el desfase de Chile es −3 o −4 horas.
  let t = pared + (pared - comoUtc(pared));
  t = t + (pared - comoUtc(t));
  return new Date(t);
}

/**
 * Instante que se guarda para una fecha de INGRESO elegida en un <input type="date">
 * (recorrido MP-04, D04-10 / B-030). La web la envía como medianoche UTC
 * («2026-10-23T00:00:00.000Z»), que en Chile es el 22-10 a las 21:00: el certificado
 * de Metrología imprimía el día anterior. Regla:
 *   · si el día es HOY en Chile → el instante actual;
 *   · otro día → ese día a las 12:00 de Chile (en cualquier zona sigue siendo ese día);
 *   · un instante con hora real se respeta tal cual.
 */
export function instanteFechaIngreso(valor: Date | string | null | undefined, ahora: Date = new Date()): Date | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const d = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(d.getTime())) return null;
  if (!esFechaCalendario(valor)) return d;
  const p = partesCalendario(valor, d);
  if (`${p.anio}-${dos(p.mes)}-${dos(p.dia)}` === hoyChile(ahora)) return ahora;
  return instanteDeHoraChile(p.anio, p.mes, p.dia, 12, 0);
}

/**
 * Día de calendario «aaaa-mm-dd» en la zona del IDIC.
 *   · una fecha de calendario (DATE de Prisma o «aaaa-mm-dd») se toma tal cual;
 *   · un instante (`timestamptz`, `new Date()`) se convierte a la hora de Chile.
 * Sustituye a `x.toISOString().slice(0, 10)`, que da el día en UTC.
 * Si el valor es SIEMPRE un instante, use `diaInstanteChile` (evita confundir un
 * instante exacto de medianoche UTC con una fecha de calendario).
 */
export function diaChile(valor: unknown): string | null {
  const d = aDate(valor);
  if (!d) return null;
  const p = esFechaCalendario(valor) ? partesCalendario(valor, d) : partesChile(d);
  return `${p.anio}-${dos(p.mes)}-${dos(p.dia)}`;
}

/** Día «aaaa-mm-dd» en Chile de un INSTANTE (siempre se convierte). */
export function diaInstanteChile(valor: Date | string | number | null | undefined): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  const p = partesChile(d);
  return `${p.anio}-${dos(p.mes)}-${dos(p.dia)}`;
}

/** Mes «aaaa-mm» en Chile (informes mensuales). */
export function mesChile(ahora: Date = new Date()): string {
  const p = partesChile(ahora);
  return `${p.anio}-${dos(p.mes)}`;
}

/** Suma días de calendario a «aaaa-mm-dd» (sin zona: aritmética de calendario). */
export function sumarDiasCalendario(dia: string, n: number): string {
  const d = new Date(`${dia.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Instante en que empieza (00:00 en Chile) el día «aaaa-mm-dd» o el día en Chile de un instante. */
export function inicioDiaChile(valor: Date | string): Date | null {
  const dia = typeof valor === "string" && SOLO_DIA.test(valor.trim()) ? valor.trim().slice(0, 10) : diaInstanteChile(valor as any);
  if (!dia) return null;
  const [a, m, d] = dia.split("-").map(Number);
  return instanteDeHoraChile(a, m, d, 0, 0);
}

/**
 * Hoy en Chile como Date a medianoche UTC: el valor que se escribe en una columna
 * DATE con Prisma (Prisma guarda la parte UTC de la fecha; `new Date()` a las 21:30
 * de Chile se guardaría como el día siguiente).
 */
export function hoyFechaChile(ahora: Date = new Date()): Date {
  return new Date(`${hoyChile(ahora)}T00:00:00Z`);
}
