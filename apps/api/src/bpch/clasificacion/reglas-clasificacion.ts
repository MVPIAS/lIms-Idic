/**
 * Clasificación de sustancias · reglas PURAS (sin BD) · BPCH · LIMS IDIC.
 * Pruebas: reglas-clasificacion.spec.ts. Documento: docs/FLUJO_BPCH_PRODUCCION_PROTOTIPOS_CLASIFICACION.md §3.
 *
 * Criterios tomados LITERALMENTE de las instrucciones de trabajo del BPCH
 * (registro en SAC-PG01-FORM12 «Planilla de resultados pruebas de
 * parametrización de sustancias»):
 *
 *  · SAC-PG01-IT21 · Excitación con barrera interpuesta (Serie 1 y Serie 2 ONU, prueba tipo a).
 *      Positivo (+) si el tubo se fragmentó completamente o la placa testigo resultó perforada;
 *      en los demás casos, negativo (−). «Se deberán efectuar dos ensayos si no hay detonación
 *      en el primero» → un solo ensayo negativo no basta para concluir.
 *  · SAC-PG01-IT22 · Koenen (calentamiento en espacio limitado), Koenen Tester KT300.
 *      Placas de 12 → 5 → 1 mm (Serie 1) o 12 → 5 → 2 mm (Serie 2); la prueba termina al estallar.
 *      Efectos O–E = «no ha habido explosión»; F, G, H = «explosión».
 *      Diámetro límite = mayor orificio con explosión. Positivo si es ≥ 1,0 mm (Serie 1) o ≥ 2,0 mm (Serie 2).
 *  · SAC-PG01-IT23 · TPT (tiempo/presión, inflamación en espacio limitado). Se efectúa 3 veces.
 *      Positivo si la presión máxima alcanzada es ≥ 2.070 kPa; negativo si es inferior.
 *      Se informa el menor tiempo en pasar de 690 a 2.070 kPa.
 *
 * La DECISIÓN (¿es explosiva? · clase/división · grupo de compatibilidad · Nº ONU)
 * la toma quien clasifica. Las pruebas dan un INDICADOR: si la decisión lo
 * contradice, o no hay pruebas, se exige justificación. No se calcula la
 * división de riesgo: las IT del BPCH no la fijan (pregunta abierta al IDIC).
 */

export type ResultadoPrueba = "positivo" | "negativo" | "incompleto" | "no_aplica";

export interface EnsayoIt21 {
  tuboFragmentado: boolean;
  placaPerforada: boolean;
  observacion?: string | null;
}
export interface SerieIt21 {
  ensayos: EnsayoIt21[];
}
export interface PruebaIt21 {
  aplica: boolean;
  serie1?: SerieIt21 | null;
  serie2?: SerieIt21 | null;
}

export const EFECTOS_KOENEN = ["O", "A", "B", "C", "D", "E", "F", "G", "H"] as const;
export type EfectoKoenen = (typeof EFECTOS_KOENEN)[number];
/** Efectos que la IT22 cuenta como «explosión». */
export const EFECTOS_EXPLOSION: readonly EfectoKoenen[] = ["F", "G", "H"];

export interface EnsayoIt22 {
  orificioMm: number;
  efecto: EfectoKoenen;
  tiempoS?: number | null;
  masaFragmentosG?: number | null;
}
export interface PruebaIt22 {
  aplica: boolean;
  serie: 1 | 2;
  masaMuestraG?: number | null;
  ensayos: EnsayoIt22[];
}

export interface EnsayoIt23 {
  presionMaxKpa: number;
  /** Tiempo (ms) en pasar de 690 a 2.070 kPa, si se alcanzó. */
  tiempoMs?: number | null;
  masaG?: number | null;
}
export interface PruebaIt23 {
  aplica: boolean;
  ensayos: EnsayoIt23[];
}

export interface Pruebas {
  it21?: PruebaIt21 | null;
  it22?: PruebaIt22 | null;
  it23?: PruebaIt23 | null;
}

/** Umbrales de las IT (constantes de las fuentes, no parámetros de negocio). */
export const UMBRAL_TPT_KPA = 2070;
export const ENSAYOS_TPT = 3;
export const ENSAYOS_IT21_SI_NEGATIVO = 2;
/** Secuencia de placas de orificio de la IT22 por serie. */
export const SECUENCIA_KOENEN: Record<1 | 2, number[]> = { 1: [12, 5, 1], 2: [12, 5, 2] };
/** Diámetro límite mínimo para «positivo» por serie (IT22 §4.2). */
export const UMBRAL_KOENEN_MM: Record<1 | 2, number> = { 1: 1.0, 2: 2.0 };

/* ------------------------------------------------------------------ IT21 --- */

export function evaluarSerieIt21(serie: SerieIt21 | null | undefined): ResultadoPrueba {
  const ensayos = serie?.ensayos ?? [];
  if (!ensayos.length) return "incompleto";
  if (ensayos.some((e) => e.tuboFragmentado || e.placaPerforada)) return "positivo";
  return ensayos.length >= ENSAYOS_IT21_SI_NEGATIVO ? "negativo" : "incompleto";
}

export interface EvaluacionIt21 {
  resultado: ResultadoPrueba;
  serie1: ResultadoPrueba | null;
  serie2: ResultadoPrueba | null;
  detalle: string;
}

/**
 * IT21: cada serie se evalúa por separado. Positivo si alguna serie registrada
 * es positiva; negativo si todas las registradas son negativas concluyentes;
 * incompleto si falta algún ensayo o no hay ninguna serie.
 */
export function evaluarIt21(p: PruebaIt21 | null | undefined): EvaluacionIt21 {
  if (!p || !p.aplica) return { resultado: "no_aplica", serie1: null, serie2: null, detalle: "No aplica" };
  const s1 = p.serie1 ? evaluarSerieIt21(p.serie1) : null;
  const s2 = p.serie2 ? evaluarSerieIt21(p.serie2) : null;
  const registradas = [s1, s2].filter((x): x is ResultadoPrueba => x !== null);
  let resultado: ResultadoPrueba;
  if (!registradas.length) resultado = "incompleto";
  else if (registradas.includes("positivo")) resultado = "positivo";
  else if (registradas.every((r) => r === "negativo")) resultado = "negativo";
  else resultado = "incompleto";
  const txt = (n: number, r: ResultadoPrueba | null) => (r ? `Serie ${n}: ${r}` : `Serie ${n}: sin ensayos`);
  return { resultado, serie1: s1, serie2: s2, detalle: `${txt(1, s1)} · ${txt(2, s2)}` };
}

/* ------------------------------------------------------------------ IT22 --- */

export interface EvaluacionIt22 {
  resultado: ResultadoPrueba;
  diametroLimiteMm: number | null;
  detalle: string;
}

export function hayExplosion(efecto: string): boolean {
  return (EFECTOS_EXPLOSION as readonly string[]).includes(efecto);
}

export function evaluarIt22(p: PruebaIt22 | null | undefined): EvaluacionIt22 {
  if (!p || !p.aplica) return { resultado: "no_aplica", diametroLimiteMm: null, detalle: "No aplica" };
  const serie = p.serie === 2 ? 2 : 1;
  const ensayos = p.ensayos ?? [];
  const umbral = UMBRAL_KOENEN_MM[serie];
  const conExplosion = ensayos.filter((e) => hayExplosion(e.efecto));
  if (conExplosion.length) {
    const limite = Math.max(...conExplosion.map((e) => Number(e.orificioMm)));
    const positivo = limite >= umbral;
    return {
      resultado: positivo ? "positivo" : "negativo",
      diametroLimiteMm: limite,
      detalle: `Serie ${serie}: explosión con orificio de ${limite} mm (límite ${positivo ? "≥" : "<"} ${umbral} mm)`,
    };
  }
  // Sin explosión: negativo solo si se probaron TODAS las placas de la secuencia.
  const probados = new Set(ensayos.map((e) => Number(e.orificioMm)));
  const faltan = SECUENCIA_KOENEN[serie].filter((d) => !probados.has(d));
  if (faltan.length)
    return {
      resultado: "incompleto",
      diametroLimiteMm: null,
      detalle: `Serie ${serie}: sin explosión; faltan las placas de ${faltan.join(", ")} mm`,
    };
  return {
    resultado: "negativo",
    diametroLimiteMm: null,
    detalle: `Serie ${serie}: sin explosión con ${SECUENCIA_KOENEN[serie].join(" / ")} mm (diámetro límite < ${umbral} mm)`,
  };
}

/* ------------------------------------------------------------------ IT23 --- */

export interface EvaluacionIt23 {
  resultado: ResultadoPrueba;
  presionMaxKpa: number | null;
  /** Menor tiempo 690 → 2.070 kPa entre los ensayos que alcanzaron 2.070 kPa. */
  tiempoMinMs: number | null;
  detalle: string;
}

export function evaluarIt23(p: PruebaIt23 | null | undefined): EvaluacionIt23 {
  if (!p || !p.aplica) return { resultado: "no_aplica", presionMaxKpa: null, tiempoMinMs: null, detalle: "No aplica" };
  const ensayos = p.ensayos ?? [];
  if (!ensayos.length) return { resultado: "incompleto", presionMaxKpa: null, tiempoMinMs: null, detalle: "Sin ensayos" };
  const presionMax = Math.max(...ensayos.map((e) => Number(e.presionMaxKpa)));
  const alcanzan = ensayos.filter((e) => Number(e.presionMaxKpa) >= UMBRAL_TPT_KPA);
  const tiempos = alcanzan.map((e) => e.tiempoMs).filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  const tiempoMin = tiempos.length ? Math.min(...tiempos) : null;
  if (ensayos.length < ENSAYOS_TPT)
    return {
      resultado: "incompleto",
      presionMaxKpa: presionMax,
      tiempoMinMs: tiempoMin,
      detalle: `${ensayos.length} de ${ENSAYOS_TPT} ensayos`,
    };
  const positivo = alcanzan.length > 0;
  return {
    resultado: positivo ? "positivo" : "negativo",
    presionMaxKpa: presionMax,
    tiempoMinMs: tiempoMin,
    detalle: `Presión máxima ${presionMax} kPa (${positivo ? "≥" : "<"} ${UMBRAL_TPT_KPA} kPa)${
      tiempoMin !== null ? ` · menor tiempo 690→2.070 kPa: ${tiempoMin} ms` : ""
    }`,
  };
}

/* ------------------------------------------------------------- conjunto --- */

export interface EvaluacionPruebas {
  it21: EvaluacionIt21;
  it22: EvaluacionIt22;
  it23: EvaluacionIt23;
  /** Pruebas que aplican. */
  aplicadas: ("it21" | "it22" | "it23")[];
  /** Pruebas que aplican y aún no son concluyentes. */
  incompletas: ("it21" | "it22" | "it23")[];
  /**
   * Indicador de las pruebas: true si alguna aplicada es positiva; false si todas
   * las aplicadas son negativas concluyentes; null si no hay pruebas o falta alguna.
   */
  indicaExplosiva: boolean | null;
}

export const NOMBRE_PRUEBA: Record<"it21" | "it22" | "it23", string> = {
  it21: "SAC-PG01-IT21 (barrera interpuesta)",
  it22: "SAC-PG01-IT22 (Koenen)",
  it23: "SAC-PG01-IT23 (TPT tiempo/presión)",
};

export function evaluarPruebas(p: Pruebas | null | undefined): EvaluacionPruebas {
  const it21 = evaluarIt21(p?.it21);
  const it22 = evaluarIt22(p?.it22);
  const it23 = evaluarIt23(p?.it23);
  const todas = { it21: it21.resultado, it22: it22.resultado, it23: it23.resultado };
  const aplicadas = (Object.keys(todas) as ("it21" | "it22" | "it23")[]).filter((k) => todas[k] !== "no_aplica");
  const incompletas = aplicadas.filter((k) => todas[k] === "incompleto");
  let indicaExplosiva: boolean | null = null;
  if (aplicadas.some((k) => todas[k] === "positivo")) indicaExplosiva = true;
  else if (aplicadas.length && !incompletas.length) indicaExplosiva = false;
  return { it21, it22, it23, aplicadas, incompletas, indicaExplosiva };
}

/* --------------------------------------------------------- decisión ONU --- */

export interface DecisionClasificacion {
  explosiva: boolean | null | undefined;
  claseDivision?: string | null;
  grupoCompatibilidad?: string | null;
  numeroOnu?: string | null;
  justificacion?: string | null;
}

/** Nº ONU: cuatro dígitos (se acepta «UN 0456» o «0456» y se normaliza). */
export function normalizarNumeroOnu(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toUpperCase().replace(/^UN\s*/, "");
  return s === "" ? null : s;
}

export const esDivisionClase1 = (c: string | null | undefined) => /^1\.[1-6]$/.test(String(c ?? "").trim());

/**
 * Errores que impiden REGISTRAR la clasificación (borrador → registrada).
 * `clasesValidas` / `gruposValidos`: listas vigentes de parámetros del sistema
 * (si vienen vacías no se valida la pertenencia, solo la forma).
 */
export function validarRegistro(
  d: DecisionClasificacion,
  ev: EvaluacionPruebas,
  listas: { clasesValidas?: string[]; gruposValidos?: string[] } = {},
): string[] {
  const errores: string[] = [];
  const clase = d.claseDivision?.trim() || null;
  const grupo = d.grupoCompatibilidad?.trim().toUpperCase() || null;
  const onu = normalizarNumeroOnu(d.numeroOnu);
  const justificacion = d.justificacion?.trim() || "";

  if (ev.incompletas.length)
    errores.push(
      `Pruebas sin concluir: ${ev.incompletas.map((k) => NOMBRE_PRUEBA[k]).join(", ")}. Complete los ensayos o márquelas «no aplica».`,
    );

  if (d.explosiva !== true && d.explosiva !== false) {
    errores.push("Indique si la sustancia es explosiva (Clase 1).");
  } else if (d.explosiva) {
    if (!clase) errores.push("Una sustancia explosiva requiere su división de riesgo (1.1 a 1.6).");
    else if (!esDivisionClase1(clase)) errores.push(`La división ${clase} no es de Clase 1: una sustancia explosiva va en 1.1 a 1.6.`);
  } else {
    if (clase && esDivisionClase1(clase)) errores.push(`La división ${clase} es de Clase 1, pero indicó que la sustancia no es explosiva.`);
    if (grupo) errores.push("El grupo de compatibilidad solo se asigna a la Clase 1.");
  }
  if (clase && listas.clasesValidas?.length && !listas.clasesValidas.includes(clase))
    errores.push(`La clase/división «${clase}» no está en la lista vigente.`);
  if (grupo && listas.gruposValidos?.length && !listas.gruposValidos.includes(grupo))
    errores.push(`El grupo de compatibilidad «${grupo}» no está en la lista vigente.`);
  if (onu !== null && !/^\d{4}$/.test(onu)) errores.push("El Nº ONU son cuatro dígitos (p. ej. 0456).");

  if (!ev.aplicadas.length && !justificacion)
    errores.push("No se registró ninguna prueba ONU: indique en «Justificación» el fundamento de la clasificación.");
  if (
    ev.indicaExplosiva !== null &&
    (d.explosiva === true || d.explosiva === false) &&
    ev.indicaExplosiva !== d.explosiva &&
    !justificacion
  )
    errores.push(
      ev.indicaExplosiva
        ? "Alguna prueba resultó positiva pero indicó que la sustancia NO es explosiva: justifique la decisión."
        : "Todas las pruebas resultaron negativas pero indicó que la sustancia ES explosiva: justifique la decisión.",
    );
  return errores;
}

/** Texto corto de la clasificación: «1.4S · UN 0456», «No explosiva · 5.1», «No explosiva». */
export function textoClasificacion(d: DecisionClasificacion): string {
  const clase = d.claseDivision?.trim() || "";
  const grupo = d.grupoCompatibilidad?.trim().toUpperCase() || "";
  const onu = normalizarNumeroOnu(d.numeroOnu);
  const partes: string[] = [];
  if (d.explosiva === true) partes.push(`${clase}${grupo}` || "Explosiva");
  else if (d.explosiva === false) partes.push(clase ? `No explosiva · ${clase}` : "No explosiva");
  if (onu) partes.push(`UN ${onu}`);
  return partes.join(" · ") || "Sin clasificar";
}

/** Estados en que la clasificación se puede editar. */
export const ESTADOS_EDITABLES = ["borrador"] as const;
