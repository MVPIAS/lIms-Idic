/**
 * Reglas puras de la ficha de calibración (entrega R4, tema T28 · EP-04): error
 * normalizado frente a la calibración anterior, condiciones ambientales corregidas
 * con el certificado del termohigrómetro y del barómetro, punto fuera del rango
 * calibrado del patrón y parámetros de la operación de Metrología. Sin BD: las
 * prueba ficha.reglas.spec.ts.
 *
 * Nada de esto cambia los motores: son datos que se muestran, avisos y bloqueos
 * alrededor del cálculo validado.
 */
import { convertir } from "./metrologia.reglas";

/* ------------------------------------------------ parámetros de la operación --- */
/** Fila de `parametro_sistema` (categoría `metrologia_ficha`). */
export interface FilaParametro { codigo: string; valor: string | null; activo: boolean }

export type CriterioEn = "<1" | "<=1";
export type ModoFueraRango = "bloquear" | "avisar";
export type MomentoEquipo = "emitir" | "entregar" | "no";

export interface ConfigFicha {
  /** Criterio del error normalizado (informativo): «< 1» o «≤ 1». POR CONFIRMAR (EP-04 §10 P13). */
  criterioEn: CriterioEn;
  /** Punto medido con un patrón fuera de su rango calibrado (R15 P6): bloquea el guardado o solo avisa. */
  fueraRango: ModoFueraRango;
  /** Al emitir, enviar el certificado por correo al contacto de la OT. POR CONFIRMAR (EP-04 §10, P7.2). */
  notificarEmision: boolean;
  /** Cuándo se actualiza el equipo del laboratorio dueño (OT interna): al emitir, al entregar o nunca. POR CONFIRMAR (P9). */
  actualizarEquipo: MomentoEquipo;
  /** El cierre técnico exige que el ítem no apto tenga su informe técnico emitido o su servicio externo validado. POR CONFIRMAR (P5, P6). */
  noAptoExigeDocumento: boolean;
}

export const CONFIG_FICHA_DEFECTO: ConfigFicha = {
  criterioEn: "<=1", fueraRango: "bloquear", notificarEmision: true, actualizarEquipo: "emitir", noAptoExigeDocumento: false,
};

const siNo = (v: string | null | undefined, def: boolean) => {
  const t = String(v ?? "").trim().toLowerCase();
  if (/^(si|sí|s|true|1)$/.test(t)) return true;
  if (/^(no|n|false|0)$/.test(t)) return false;
  return def;
};

/** Lee la configuración; una fila inactiva o con un valor que no se entiende deja el valor por defecto. */
export function configFicha(filas: FilaParametro[]): ConfigFicha {
  const v = (codigo: string) => filas.find((f) => f.codigo === codigo && f.activo)?.valor ?? null;
  const d = CONFIG_FICHA_DEFECTO;
  const en = String(v("criterio_en") ?? "").replace(/\s/g, "").replace("≤", "<=");
  const fr = String(v("patron_fuera_rango") ?? "").trim();
  const eq = String(v("actualizar_equipo") ?? "").trim();
  return {
    criterioEn: en === "<1" || en === "<=1" ? en : d.criterioEn,
    fueraRango: fr === "bloquear" || fr === "avisar" ? fr : d.fueraRango,
    notificarEmision: siNo(v("notificar_emision"), d.notificarEmision),
    actualizarEquipo: eq === "emitir" || eq === "entregar" || eq === "no" ? eq : d.actualizarEquipo,
    noAptoExigeDocumento: siNo(v("no_apto_exige_documento"), d.noAptoExigeDocumento),
  };
}

/* ------------------------------------------------------ error normalizado --- */
/** Punto del resumen guardado de una calibración (el que imprime el certificado). */
export interface PuntoCal {
  nominal: number | null;
  error: number | null;
  U?: number | null;
  Ucert?: number | null;
  uCertificado?: number | null;
  unidad?: string | null;
}
export interface FilaEn {
  nominal: number;
  unidad: string | null;
  error: number | null;
  U: number | null;
  errorAnterior: number | null;
  Uanterior: number | null;
  en: number | null;
  /** «compatible», «revisar» o el motivo por el que no se calcula. */
  criterio: "compatible" | "revisar" | "sin_punto_anterior" | "sin_datos";
}

/** U que se informó en el certificado: la certificada (máx(U, CMC), dos cifras) o, si no hay, la del motor. */
export const uInformada = (p: PuntoCal): number | null => {
  for (const x of [p.uCertificado, p.Ucert, p.U]) if (typeof x === "number" && Number.isFinite(x)) return x;
  return null;
};
const mismoNominal = (a: PuntoCal, b: PuntoCal) =>
  a.nominal != null && b.nominal != null && Math.abs(a.nominal - b.nominal) <= 1e-9 * Math.max(1, Math.abs(a.nominal)) &&
  (!a.unidad || !b.unidad || a.unidad === b.unidad);

/**
 * Eₙ = |E − E_ant| / √(U² + U_ant²) por punto, emparejando por valor nominal (y unidad).
 * Informativo (R15 T6, P5, S6): no bloquea el envío. El criterio (< 1 o ≤ 1) es un parámetro.
 */
export function errorNormalizado(actual: PuntoCal[], anterior: PuntoCal[], criterio: CriterioEn): FilaEn[] {
  return actual.filter((p) => p.nominal != null).map((p) => {
    const a = anterior.find((x) => mismoNominal(p, x));
    const U = uInformada(p);
    const base = { nominal: p.nominal as number, unidad: p.unidad ?? null, error: p.error ?? null, U };
    if (!a) return { ...base, errorAnterior: null, Uanterior: null, en: null, criterio: "sin_punto_anterior" as const };
    const Ua = uInformada(a);
    const den = U != null && Ua != null ? Math.sqrt(U * U + Ua * Ua) : 0;
    if (p.error == null || a.error == null || !den) return { ...base, errorAnterior: a.error ?? null, Uanterior: Ua, en: null, criterio: "sin_datos" as const };
    const en = Math.abs(p.error - a.error) / den;
    const ok = criterio === "<1" ? en < 1 : en <= 1;
    return { ...base, errorAnterior: a.error, Uanterior: Ua, en, criterio: ok ? "compatible" as const : "revisar" as const };
  });
}

/* -------------------------------------------- condiciones ambientales (P3.4) --- */
/** Error del certificado del equipo auxiliar para una condición y su U (k = 2). */
export interface CorreccionAux { error: number | null; U: number | null }
export interface Auxiliar {
  id: string; codigo: string; nombre?: string | null;
  correcciones?: { temp?: CorreccionAux | null; hum?: CorreccionAux | null; pres?: CorreccionAux | null } | null;
  vence?: string | null;
}
export interface LecturasAmbiente {
  /** Lecturas del termohigrómetro y del barómetro (inicial, final; pueden ser más). */
  temp?: (number | null)[]; hum?: (number | null)[]; pres?: (number | null)[];
}
export interface CondicionCorregida { promedio: number; error: number; corregido: number; U: number | null; n: number }
export interface Condiciones { temp: CondicionCorregida | null; hum: CondicionCorregida | null; pres: CondicionCorregida | null; avisos: string[] }

const promedio = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? { m: v.reduce((s, x) => s + x, 0) / v.length, n: v.length } : null;
};
const red1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Condición corregida = promedio de las lecturas − error del certificado del equipo
 * (R15 T1: la corrección SIEMPRE se resta, definición del VIM), con la U del certificado.
 * Se redondea a un decimal, como los libros del laboratorio.
 */
export function condicionesCorregidas(l: LecturasAmbiente, termohigrometro: Auxiliar | null, barometro: Auxiliar | null): Condiciones {
  const avisos: string[] = [];
  const una = (xs: (number | null)[] | undefined, aux: Auxiliar | null, clave: "temp" | "hum" | "pres", que: string): CondicionCorregida | null => {
    const p = promedio(xs ?? []);
    if (!p) return null;
    const c = aux?.correcciones?.[clave] ?? null;
    if (!aux) avisos.push(`${que}: sin equipo auxiliar elegido; se informa la lectura sin corregir.`);
    else if (c?.error == null) avisos.push(`${que}: el equipo ${aux.codigo} no tiene en el maestro el error de su certificado; se informa la lectura sin corregir.`);
    const error = c?.error ?? 0;
    return { promedio: p.m, error, corregido: red1(p.m - error), U: c?.U ?? null, n: p.n };
  };
  return {
    temp: una(l.temp, termohigrometro, "temp", "Temperatura"),
    hum: una(l.hum, termohigrometro, "hum", "Humedad relativa"),
    pres: una(l.pres, barometro, "pres", "Presión"),
    avisos,
  };
}

/* -------------------------------- patrón fuera de su rango calibrado (P4.2) --- */
/**
 * Conversión para comparar rangos: la de la CMC (masa, longitud, volumen, fuerza) más
 * presión, par y temperatura. Va aparte de `convertir` para no cambiar qué puntos
 * evalúa la CMC (eso alteraría la U certificada).
 */
const EXTRA: Record<string, Record<string, number>> = {
  presion: { Pa: 1e-6, kPa: 1e-3, MPa: 1, bar: 0.1, mbar: 1e-4, hPa: 1e-4, psi: 0.00689475729 },
  par: { "N·m": 1, Nm: 1, "N.m": 1, "lbf·ft": 1.3558179483314, "lbf·in": 0.112984829 },
  temperatura: { "°C": 1, "ºC": 1, C: 1 },
};
export function convertirRango(x: number, de: string, a: string): number | null {
  const c = convertir(x, de, a);
  if (c != null) return c;
  for (const fam of Object.values(EXTRA)) if (fam[de] != null && fam[a] != null) return (x * fam[de]) / fam[a];
  return null;
}

export interface PatronRango { id: string; codigo: string; magnitud: string | null; tipo?: string | null; rangoMin: number | null; rangoMax: number | null; unidadRango: string | null }
export interface PuntoFuera { nominal: number; unidad: string; motivo: string }

/**
 * R15 P6: «no se acepta extrapolar un patrón fuera de su rango calibrado: se cambia el
 * patrón para ese punto». Un punto está cubierto si cae dentro del rango numérico de al
 * menos uno de los patrones elegidos de la misma magnitud. Solo se controla con patrones
 * que tengan su rango numérico cargado en el maestro (los demás no se pueden comparar).
 */
export function puntosFueraDeRango(
  puntos: { nominal: number | null; unidad?: string | null }[], unidadMotor: string, magnitud: string, patrones: PatronRango[],
): { fuera: PuntoFuera[]; controlado: boolean } {
  const conRango = patrones.filter((p) => p.tipo !== "auxiliar" && (!p.magnitud || p.magnitud === magnitud) && p.rangoMin != null && p.rangoMax != null && p.unidadRango);
  if (!conRango.length) return { fuera: [], controlado: false };
  const fuera: PuntoFuera[] = [];
  for (const pt of puntos) {
    if (pt.nominal == null || !Number.isFinite(pt.nominal)) continue;
    const u = pt.unidad || unidadMotor;
    const comparables = conRango.map((p) => ({ p, x: convertirRango(pt.nominal as number, u, p.unidadRango as string) })).filter((c) => c.x != null);
    if (!comparables.length) continue; // unidad que no se sabe convertir: no se controla ese punto
    const dentro = comparables.some(({ p, x }) => (x as number) >= (p.rangoMin as number) - 1e-12 && (x as number) <= (p.rangoMax as number) + 1e-12);
    if (!dentro)
      fuera.push({
        nominal: pt.nominal, unidad: u,
        motivo: `El punto ${String(pt.nominal).replace(".", ",")} ${u} está fuera del rango calibrado de ${comparables.map(({ p }) => `${p.codigo} (${String(p.rangoMin).replace(".", ",")} a ${String(p.rangoMax).replace(".", ",")} ${p.unidadRango})`).join(", ")}: cambie el patrón para ese punto (no se acepta extrapolar).`,
      });
  }
  return { fuera, controlado: true };
}
