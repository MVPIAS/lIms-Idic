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

/* ------------------------------------------------------- fechas y plazos --- */
/** AAAA-MM-DD + n meses (el día se ajusta al último del mes: 31-01 + 1 = 28/29-02). */
export function sumarMeses(fecha: string, meses: number): string {
  const [a, m, d] = fecha.slice(0, 10).split("-").map(Number);
  const total = (m - 1) + meses;
  const anio = a + Math.floor(total / 12), mes = ((total % 12) + 12) % 12;
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  return `${anio}-${String(mes + 1).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
}

/* ------------------------------------- equipo del laboratorio dueño (P8.4) --- */
/**
 * Lo que se escribe en Equipos al emitir (o entregar) el certificado de un equipo de otro
 * laboratorio del IDIC: última calibración = fecha de calibración, próxima = emisión +
 * intervalo (P9.5) y el número del certificado. Sin intervalo («según el cliente») la
 * próxima no se toca. El LMT no evalúa conformidad: la aptitud la decide el dueño.
 */
export function actualizacionEquipo(c: { numero: string; fechaCalibracion: string; fechaEmision: string; intervaloMeses: number | null }) {
  return {
    ultima: c.fechaCalibracion.slice(0, 10),
    proxima: c.intervaloMeses && c.intervaloMeses > 0 ? sumarMeses(c.fechaEmision, c.intervaloMeses) : null,
    certificado: c.numero,
  };
}

/* ------------------------------------------- LNF → maestro de patrones (P8.5) --- */
export interface PatronMaestro {
  clase: string | null; coeficientes: any | null; deriva: number | null; u_expandida: number | null;
  n_certificado: string | null; ultima_calibracion: string | null; vence: string | null; intervalo_meses: number | null; emisor: string | null;
}
/** Sensibilidad S = a·F + b·F² + c·F³ (mV/V) del ajuste del certificado. */
const sensibilidad = (k: { a: number; b: number; c: number }, F: number) => k.a * F + k.b * F ** 2 + k.c * F ** 3;

/**
 * Al emitir un certificado del LNF de un transductor del propio IDIC, el maestro de patrones
 * del LMT toma: clase, coeficientes t, u, v (F = t·S + u·S² + v·S³) y a, b, c, deriva frente
 * al certificado anterior (cambio relativo de la sensibilidad a la fuerza máxima, en %), U
 * (la mayor incertidumbre relativa del certificado, %), certificado, fechas y vencimiento.
 * Sin coeficientes anteriores la deriva no cambia.
 */
export function actualizacionPatronLnf(
  r: { clase: string; coef: { S3: number[]; F3: number[] }; rows: { F: number; U: number }[]; rangos?: unknown },
  c: { numero: string; fechaCalibracion: string; intervaloMeses: number | null },
  antes: PatronMaestro,
): { despues: Partial<PatronMaestro>; deriva: number | null } {
  const Fmax = Math.max(...r.rows.map((x) => x.F));
  const nuevo = { a: r.coef.S3[0], b: r.coef.S3[1], c: r.coef.S3[2] };
  const prev = antes.coeficientes;
  let deriva: number | null = null;
  if (prev && [prev.a, prev.b, prev.c].every((x: unknown) => typeof x === "number" && Number.isFinite(x))) {
    const s0 = sensibilidad(prev, Fmax), s1 = sensibilidad(nuevo, Fmax);
    if (s0) deriva = Math.abs(s1 - s0) / Math.abs(s0) * 100;
  }
  const U = Math.max(...r.rows.map((x) => x.U));
  return {
    deriva,
    despues: {
      clase: r.clase === "N/C" ? "N/C" : `Clase ${r.clase}`,
      coeficientes: {
        t: r.coef.F3[0], u: r.coef.F3[1], v: r.coef.F3[2], ...nuevo, clase: r.clase, Fmax, rangos: r.rangos ?? null,
        certificado: c.numero, fecha: c.fechaCalibracion.slice(0, 10),
      },
      deriva: deriva ?? antes.deriva,
      u_expandida: Number.isFinite(U) ? U : antes.u_expandida,
      n_certificado: c.numero,
      ultima_calibracion: c.fechaCalibracion.slice(0, 10),
      vence: c.intervaloMeses && c.intervaloMeses > 0 ? sumarMeses(c.fechaCalibracion, c.intervaloMeses) : antes.vence,
      intervalo_meses: c.intervaloMeses && c.intervaloMeses > 0 ? c.intervaloMeses : antes.intervalo_meses,
      emisor: "LCPN-F (IDIC)",
    },
  };
}

/* --------------------------------------------- aviso al emitir (P7.2) --- */
const correoValido = (x: unknown): x is string => typeof x === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.trim());

/**
 * A quién se avisa al emitir: en OT interna o interlaboratorio, al jefe del laboratorio dueño;
 * si no, al contacto principal del cliente y, sin él, al correo del cliente.
 */
export function destinatariosAviso(d: { interna: boolean; jefesDueno: (string | null)[]; contacto: string | null; cliente: string | null }): { destinatarios: string[]; motivo: string | null } {
  const lista = d.interna ? d.jefesDueno : [d.contacto, d.cliente];
  const validos = [...new Set(lista.filter(correoValido).map((x) => x.trim()))];
  const usar = d.interna ? validos : validos.slice(0, 1);
  if (usar.length) return { destinatarios: usar, motivo: null };
  return { destinatarios: [], motivo: d.interna ? "el laboratorio dueño no tiene jefe con correo" : "el cliente no tiene contacto principal ni correo" };
}

/* ------------------------------ condiciones ambientales → motor (B-027) --- */
/** Condiciones de la hoja de control: lecturas y error/U del certificado de cada auxiliar. */
export interface CondicionesHoja {
  temp?: number[];
  hum?: number[];
  pres?: number[];
  errT?: number | null; uT?: number | null;
  errH?: number | null; uH?: number | null;
  errP?: number | null; uP?: number | null;
}

/** Condiciones de la hoja a partir de los auxiliares guardados (`met_calibracion.auxiliares`). */
export function condicionesDeAuxiliares(aux: any): CondicionesHoja | null {
  if (!aux || (!aux.termohigrometro && !aux.barometro)) return null;
  const nums = (xs: unknown): number[] => (Array.isArray(xs) ? xs : []).map((x) => (x == null || x === "" ? NaN : Number(x))).filter((x) => Number.isFinite(x));
  const corr = (eq: any, k: string) => eq?.correcciones?.[k] ?? null;
  const th = aux.termohigrometro, ba = aux.barometro;
  return {
    temp: th ? nums(aux.lecturas?.temp) : [], hum: th ? nums(aux.lecturas?.hum) : [], pres: ba ? nums(aux.lecturas?.pres) : [],
    errT: corr(th, "temp")?.error ?? null, uT: corr(th, "temp")?.U ?? null,
    errH: corr(th, "hum")?.error ?? null, uH: corr(th, "hum")?.U ?? null,
    errP: corr(ba, "pres")?.error ?? null, uP: corr(ba, "pres")?.U ?? null,
  };
}

/**
 * B-027 · EP-04 P3.4: las condiciones ambientales se registran UNA vez, en la hoja de
 * control (termohigrómetro y barómetro del maestro), y alimentan al motor. Sustituye en
 * los datos del motor solo las claves que ese motor tiene: lecturas (temp/T, hum/H,
 * patm/P) y error del certificado (tcorr/et, hcorr/eh, ebar, corr[t,h,p], termohig y
 * barometro de ITM03). Lo que la hoja no trae se deja como está. Devuelve las claves cambiadas.
 */
export function condicionesAlMotor<T extends Record<string, any>>(datos: T, c: CondicionesHoja | null): { datos: T; campos: string[] } {
  if (!c || !datos || typeof datos !== "object") return { datos, campos: [] };
  const d: Record<string, any> = { ...datos };
  const campos: string[] = [];
  const poner = (k: string, v: unknown) => {
    if (!(k in d) || v === null || v === undefined || (Array.isArray(v) && !v.length)) return;
    if (JSON.stringify(d[k]) !== JSON.stringify(v)) campos.push(k);
    d[k] = v;
  };
  for (const k of ["temp", "T"]) if (Array.isArray(d[k])) poner(k, c.temp);
  for (const k of ["hum", "H"]) if (Array.isArray(d[k])) poner(k, c.hum);
  for (const k of ["patm", "P"]) if (Array.isArray(d[k])) poner(k, c.pres);
  for (const k of ["tcorr", "et"]) poner(k, c.errT);
  for (const k of ["hcorr", "eh"]) poner(k, c.errH);
  poner("ebar", c.errP);
  if (Array.isArray(d.corr) && d.corr.length === 3 && [c.errT, c.errH, c.errP].some((x) => x != null))
    poner("corr", [c.errT ?? d.corr[0], c.errH ?? d.corr[1], c.errP ?? d.corr[2]]);
  if (d.termohig && typeof d.termohig === "object" && (c.errT != null || c.errH != null))
    poner("termohig", { ...d.termohig, ...(c.errT != null ? { corrT: c.errT } : {}), ...(c.uT != null ? { uT: c.uT } : {}),
      ...(c.errH != null ? { corrH: c.errH } : {}), ...(c.uH != null ? { uH: c.uH } : {}) });
  if (d.barometro && typeof d.barometro === "object" && c.errP != null)
    poner("barometro", { ...d.barometro, corr: c.errP, ...(c.uP != null ? { u: c.uP } : {}) });
  return { datos: d as T, campos };
}

/* ------------------------------- valores del patrón del maestro (B-043) --- */
export interface ValorPatron { c: number; U: number; d: number }
export type ValoresPatron = Record<string, ValorPatron>;

/** Lee los valores del certificado guardados en el maestro (ignora piezas mal formadas). */
export function leerValoresPatron(v: unknown): ValoresPatron {
  const out: ValoresPatron = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, x] of Object.entries(v as Record<string, any>)) {
    const n = (y: unknown) => (typeof y === "number" ? y : Number(String(y ?? "").replace(",", ".")));
    const val = { c: n(x?.c), U: n(x?.U), d: n(x?.d ?? 0) };
    if (k.trim() && [val.c, val.U, val.d].every(Number.isFinite)) out[k.trim()] = val;
  }
  return out;
}

/**
 * B-043 · EP-04 P3.3 (trazabilidad enlazada): el motor toma la corrección, la U y la
 * deriva de cada pieza del patrón elegido del maestro (`datos.pat`). Las piezas que
 * faltan se cargan del maestro; si quien calibra cambió alguna, debe indicar el motivo.
 * Solo aplica a los motores que usan `pat` (ITM02) y con valores en el maestro.
 */
export function valoresPatronAlMotor<T extends Record<string, any>>(
  datos: T, maestro: ValoresPatron, motivo?: string | null,
): { datos: T; cargados: string[]; editados: string[]; error: string | null } {
  const nada = { datos, cargados: [] as string[], editados: [] as string[], error: null };
  if (!datos || typeof datos !== "object" || !("pat" in datos) || !Object.keys(maestro).length) return nada;
  const actual = datos.pat && typeof datos.pat === "object" ? (datos.pat as Record<string, any>) : {};
  const pat: Record<string, ValorPatron> = { ...actual };
  const cargados: string[] = [], editados: string[] = [];
  const igual = (a: number, b: number) => Math.abs(a - b) < 1e-12;
  for (const [k, m] of Object.entries(maestro)) {
    const x = actual[k];
    const n = (y: unknown) => (y === "" || y == null ? NaN : Number(y));
    if (!x || ![n(x.c), n(x.U)].every(Number.isFinite)) { pat[k] = m; cargados.push(k); continue; }
    if (!igual(n(x.c), m.c) || !igual(n(x.U), m.U) || !igual(Number.isFinite(n(x.d)) ? n(x.d) : 0, m.d)) editados.push(k);
  }
  const error = editados.length && !(motivo && motivo.trim().length >= 5)
    ? `Los valores del patrón de ${editados.join(", ")} difieren de los del maestro: indique el motivo del cambio (mínimo 5 caracteres) o deje los del certificado.`
    : null;
  return { datos: { ...datos, pat } as T, cargados, editados, error };
}
