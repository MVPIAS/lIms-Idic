/**
 * LRB · Registro de disparos (EP-05 4.1) y documento del lote (5.3, 7.1) ·
 * reglas PURAS, probadas en lrb.spec.ts.
 *
 *   · Cada unidad muestreada (chaleco, casco o probeta) tiene paneles y cada
 *     panel sus disparos: V1, V2, trauma, láminas, penetración y daño en el
 *     testigo. El dato primario reemplaza a la tabla del Word.
 *   · Un disparo no cumple con penetración completa, trauma sobre el máximo o
 *     daño en el testigo (UL 752). Con un disparo que no cumple **se detiene
 *     el panel**: los disparos restantes se imprimen «-.-».
 *   · El resultado del disparo es la señal de impacto (trauma) y la
 *     penetración. La velocidad es un REQUISITO del ensayo, no un resultado
 *     (IDIC 24-11-2026, checklist LRB 4): se registran e informan V1 y V2, sin
 *     que ninguna mande sobre la otra (LRB 5). Si V1 o V2 quedan fuera de la
 *     ventana de la amenaza, el disparo se marca «tiro fuera de rango»
 *     (columna de la planilla LRB-PG01-P01-IT01-FORM02) y no cambia su
 *     condición; qué hacer con él lo decide el Jefe LRB.
 *   · Regla de lote: una penetración completa (o cualquier panel que no
 *     cumple) rechaza el lote. El Informe de Ensayo de Rechazo existe solo
 *     para chalecos (LRB 1); un casco o una probeta que no cumple se informa
 *     en el Informe de Ensayo. Si cumple y es certificación de lote ⇒ Informe
 *     de Ensayos + CRB.
 *
 * La tabla de amenazas (norma, nivel, munición, masa, ventana, disparos,
 * trauma) es configuración (Parámetros de la operación, `lrb_amenazas`). Los
 * chalecos (NIJ 0101.04) siguen la tabla oficial del LRB del 24-11-2026; cascos
 * y probetas, los valores de los informes reales mientras el IDIC no entregue
 * su propia tabla (la que llegó repite la de chalecos).
 */

export type Veredicto = "cumple" | "no_cumple" | "pendiente";

/** Fila de la tabla de amenazas (configurable). */
export interface Amenaza {
  /** Clave estable de la fila (p. ej. «NIJ0101-IIIA-9MM»). */
  clave: string;
  norma: string;
  nivel: string;
  /** chaleco | casco | probeta */
  elemento: string;
  municion: string;
  masa_g: number | null;
  v_min: number;
  v_max: number;
  /** Disparos del plan por panel / casco / probeta. */
  disparos: number;
  /** Trauma máximo en mm (null = no se mide). */
  trauma_max: number | null;
  /** El trauma es obligatorio en los disparos 1..n (0 = nunca). */
  disparos_trauma: number;
  /** Se evalúa el daño en la placa testigo (UL 752, cascos). */
  testigo: boolean;
  criterio: string;
}

/**
 * Valores por defecto. Chalecos: tabla oficial del LRB (ficha del método
 * LRB-PG01-P01-IT01, bloque 3, NIJ 0101.04, 24-11-2026): ventana mín.–máx. y
 * trauma ≤ 44 mm; la masa de la bala se conserva donde venía de los informes
 * reales y el plan de disparos por panel sigue la NIJ 0101.04 (6; 1 en el
 * nivel IV). Cascos y probetas: informes reales (POR CONFIRMAR, EP-05 P3).
 */
const chaleco = (clave: string, nivel: string, municion: string, v_min: number, v_max: number, masa_g: number | null = null, disparos = 6): Amenaza => ({
  clave, norma: "NIJ 0101.04", nivel, elemento: "chaleco", municion, masa_g, v_min, v_max, disparos,
  trauma_max: 44, disparos_trauma: Math.min(3, disparos), testigo: false, criterio: "Sin penetración completa y trauma ≤ 44 mm",
});

export const AMENAZAS_DEFECTO: Amenaza[] = [
  chaleco("NIJ0101-I-22LR", "I", ".22 LR LRN", 320, 338),
  chaleco("NIJ0101-I-380", "I", ".380 ACP FMJ RN", 313, 331),
  chaleco("NIJ0101-IIA-9MM", "II-A", "9×19 mm FMJ", 332, 350),
  chaleco("NIJ0101-IIA-40SW", "II-A", ".40 S&W FMJ", 313, 331),
  chaleco("NIJ0101-II-9MM", "II", "9×19 mm FMJ", 358, 376),
  chaleco("NIJ0101-II-357", "II", ".357 Magnum JSP", 427, 445),
  chaleco("NIJ0101-IIIA-9MM", "III-A", "9×19 mm FMJ RN", 427, 445, 8.03),
  chaleco("NIJ0101-IIIA-44MAG", "III-A", ".44 Magnum SJHP", 427, 445, 15.6),
  chaleco("NIJ0101-III-762", "III", "7,62×51 mm NATO FMJ (M80)", 838, 856),
  chaleco("NIJ0101-IV-30AP", "IV", ".30 M2 AP", 869, 887, null, 1),
  { clave: "NIJ0106-IIA-9MM", norma: "NIJ 0106.01", nivel: "II-A", elemento: "casco", municion: "9 mm FMJ", masa_g: 8.0, v_min: 317, v_max: 347, disparos: 4, trauma_max: null, disparos_trauma: 0, testigo: true, criterio: "Sin penetración del casco ni de la placa testigo" },
  { clave: "NIJ0106-IIA-357", norma: "NIJ 0106.01", nivel: "II-A", elemento: "casco", municion: ".357 Magnum JSP", masa_g: 10.2, v_min: 366, v_max: 396, disparos: 4, trauma_max: null, disparos_trauma: 0, testigo: true, criterio: "Sin penetración del casco ni de la placa testigo" },
  { clave: "NIJ0108-IIIA", norma: "NIJ 0108.01", nivel: "IIIA", elemento: "probeta", municion: ".44 Magnum", masa_g: 15.55, v_min: 411, v_max: 441, disparos: 5, trauma_max: null, disparos_trauma: 0, testigo: false, criterio: "Sin penetración" },
  { clave: "NIJ0108-III", norma: "NIJ 0108.01", nivel: "III", elemento: "probeta", municion: "7,62×51 mm FMJ", masa_g: 9.7, v_min: 823, v_max: 853, disparos: 5, trauma_max: null, disparos_trauma: 0, testigo: false, criterio: "Sin penetración" },
  { clave: "UL752-2", norma: "UL 752", nivel: "2", elemento: "probeta", municion: ".357 Magnum", masa_g: 10.2, v_min: 381, v_max: 419, disparos: 3, trauma_max: null, disparos_trauma: 0, testigo: true, criterio: "Sin penetración ni daño en el testigo" },
  { clave: "UL752-3", norma: "UL 752", nivel: "3", elemento: "probeta", municion: ".44 Magnum", masa_g: 15.6, v_min: 411, v_max: 452, disparos: 3, trauma_max: null, disparos_trauma: 0, testigo: true, criterio: "Sin penetración ni daño en el testigo" },
  { clave: "UL752-5", norma: "UL 752", nivel: "5", elemento: "probeta", municion: "7,62 mm FMJ", masa_g: 9.7, v_min: 838, v_max: 922, disparos: 3, trauma_max: null, disparos_trauma: 0, testigo: true, criterio: "Sin penetración ni daño en el testigo" },
];

export interface Disparo {
  n: number;
  zonaImpacto?: string | null;
  v1: number | null;
  v2?: number | null;
  trauma?: number | null;
  laminasPerforadas?: number | null;
  laminasTotal?: number | null;
  penetracion: boolean | null;
  danoTestigo?: boolean | null;
  observacion?: string | null;
}

export interface Panel {
  id: string;
  /** anterior | posterior | lateral | casco | probeta */
  zona: string;
  /** Clave de la amenaza (munición) con que se dispara este panel. */
  amenaza: string;
  disparos: Disparo[];
  cerrado?: boolean;
}

export interface UnidadMuestreada {
  id: string;
  serie: string;
  talla?: string | null;
  /** Muestra de la OT a la que pertenece (opcional: si no, cuenta para todo el lote). */
  muestraId?: string | null;
  /** Serie de reposición que reemplaza a esta unidad destruida (alimenta el CRB). */
  reemplazo?: string | null;
  paneles: Panel[];
}

export interface RegistroDisparos {
  certificacionLote?: boolean;
  lote?: { tamano?: number | null; modelo?: string | null; reposicion?: number | null; fabricacion?: string | null; garantiaAnios?: number | null };
  /** Nómina de series del lote por talla (CRB: «S 9 · M 49 …»). */
  composicion?: { talla: string; cantidad: number; series?: string | null }[];
  unidades: UnidadMuestreada[];
}

/* ---------------------------------------------------------------- disparo --- */

export interface DisparoEvaluado extends Disparo {
  /** V1 o V2 fuera de la ventana de la amenaza: «tiro fuera de rango». */
  fueraVentana: boolean;
  /** Qué velocidades quedaron fuera («V1», «V2»). */
  fueraDeRango: ("V1" | "V2")[];
  condicion: Veredicto;
  motivos: string[];
}

const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Velocidades fuera de la ventana: V1 y V2 se comparan cada una con la ventana
 * (ninguna manda sobre la otra, IDIC 24-11-2026). Sin V2, solo cuenta V1.
 */
export function velocidadesFueraDeRango(d: Pick<Disparo, "v1" | "v2">, a: Pick<Amenaza, "v_min" | "v_max">): ("V1" | "V2")[] {
  const fuera = (v: number | null) => v != null && (v < a.v_min || v > a.v_max);
  const out: ("V1" | "V2")[] = [];
  if (fuera(numero(d.v1))) out.push("V1");
  if (fuera(numero(d.v2 ?? null))) out.push("V2");
  return out;
}

/** Errores de captura de un disparo (lo que falta o no tiene sentido). */
export function erroresDisparo(d: Disparo, a: Amenaza): string[] {
  const e: string[] = [];
  const pos = (v: unknown) => v == null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
  if (d.v1 == null || !Number.isFinite(d.v1) || d.v1 <= 0) e.push(`Disparo ${d.n}: indique V1 (m/s).`);
  if (!pos(d.v2)) e.push(`Disparo ${d.n}: V2 no es un número válido.`);
  if (d.penetracion == null) e.push(`Disparo ${d.n}: indique si hubo penetración completa (Sí/No).`);
  if (!pos(d.trauma)) e.push(`Disparo ${d.n}: el trauma es un número en mm.`);
  if (a.trauma_max != null && d.n <= a.disparos_trauma && d.penetracion === false && d.trauma == null)
    e.push(`Disparo ${d.n}: el trauma es obligatorio en los disparos 1 a ${a.disparos_trauma} (${a.norma}).`);
  if (a.testigo && d.danoTestigo == null && d.penetracion === false) e.push(`Disparo ${d.n}: indique si hubo daño en el testigo.`);
  if (d.laminasPerforadas != null && d.laminasTotal != null && d.laminasPerforadas > d.laminasTotal)
    e.push(`Disparo ${d.n}: hay más láminas perforadas que láminas.`);
  return e;
}

export function evaluarDisparo(d: Disparo, a: Amenaza): DisparoEvaluado {
  const motivos: string[] = [];
  const fueraDeRango = velocidadesFueraDeRango(d, a);
  const fueraVentana = fueraDeRango.length > 0;
  let condicion: Veredicto = "pendiente";
  if (d.penetracion === true) motivos.push("Penetración completa");
  if (a.trauma_max != null && d.trauma != null && d.trauma > a.trauma_max) motivos.push(`Trauma ${fmt(d.trauma)} mm > ${fmt(a.trauma_max)} mm`);
  if (a.testigo && d.danoTestigo === true) motivos.push("Daño en el testigo");
  if (motivos.length) condicion = "no_cumple";
  else if (d.penetracion === false && erroresDisparo(d, a).length === 0) condicion = "cumple";
  return { ...d, fueraVentana, fueraDeRango, condicion, motivos };
}

/* ------------------------------------------------------------------ panel --- */

export interface PanelEvaluado extends Omit<Panel, "disparos"> {
  amenazaFila: Amenaza | null;
  disparos: DisparoEvaluado[];
  /** Un disparo no cumplió: los restantes no se disparan («-.-»). */
  detenido: boolean;
  completo: boolean;
  veredicto: Veredicto;
  avisos: string[];
}

export function evaluarPanel(p: Panel, amenazas: Amenaza[]): PanelEvaluado {
  const a = amenazas.find((x) => x.clave === p.amenaza) ?? null;
  if (!a) return { ...p, amenazaFila: null, disparos: [], detenido: false, completo: false, veredicto: "pendiente", avisos: [`La munición «${p.amenaza}» no está en la tabla de amenazas.`] };
  const ordenados = [...p.disparos].sort((x, y) => x.n - y.n);
  const evaluados = ordenados.map((d) => evaluarDisparo(d, a));
  const primeraFalla = evaluados.findIndex((d) => d.condicion === "no_cumple");
  const detenido = primeraFalla >= 0;
  const avisos = evaluados
    .filter((d) => d.fueraVentana)
    .map((d) => `Disparo ${d.n}: tiro fuera de rango (${d.fueraDeRango.map((k) => `${k} ${fmt((k === "V1" ? d.v1 : d.v2) as number)} m/s`).join(", ")}; ventana ${fmt(a.v_min)}–${fmt(a.v_max)} m/s). La velocidad es requisito del ensayo: decide el Jefe LRB.`);
  const completo = detenido || (evaluados.length >= a.disparos && evaluados.every((d) => d.condicion !== "pendiente"));
  const veredicto: Veredicto = detenido ? "no_cumple" : completo ? "cumple" : "pendiente";
  return { ...p, amenazaFila: a, disparos: evaluados, detenido, completo, veredicto, avisos };
}

/**
 * Valida agregar o corregir un disparo en un panel: correlativo (sin saltos ni
 * repetidos), no supera el plan y no se dispara en un panel detenido.
 */
export function erroresNuevoDisparo(p: Panel, d: Disparo, amenazas: Amenaza[]): string[] {
  const a = amenazas.find((x) => x.clave === p.amenaza);
  if (!a) return [`La munición «${p.amenaza}» no está en la tabla de amenazas.`];
  const e = erroresDisparo(d, a);
  const otros = p.disparos.filter((x) => x.n !== d.n);
  const esCorreccion = otros.length !== p.disparos.length;
  if (!Number.isInteger(d.n) || d.n < 1) e.push("El número de disparo es correlativo desde 1.");
  else if (!esCorreccion && d.n !== otros.length + 1) e.push(`El siguiente disparo de este panel es el Nº ${otros.length + 1}.`);
  if (d.n > a.disparos) e.push(`El plan de ${a.norma} ${a.nivel} es de ${a.disparos} disparos por ${a.elemento === "chaleco" ? "panel" : a.elemento}.`);
  if (!esCorreccion) {
    const previo = evaluarPanel({ ...p, disparos: otros }, amenazas);
    if (previo.detenido) e.push("El panel está detenido (un disparo no cumplió): no se registran más disparos.");
  }
  if (p.cerrado && !esCorreccion) e.push("El panel está cerrado.");
  return e;
}

/* ----------------------------------------------------------- unidad · lote --- */

export interface UnidadEvaluada extends Omit<UnidadMuestreada, "paneles"> {
  paneles: PanelEvaluado[];
  veredicto: Veredicto;
}

export interface LoteEvaluado {
  unidades: UnidadEvaluada[];
  veredicto: Veredicto;
  /** Hubo al menos una penetración completa (rechaza el lote). */
  penetracion: boolean;
  /** Primera falla: «Panel anterior M · disparo 1 · .44 Magnum». */
  falla: string | null;
  /** Documento que corresponde emitir (5.3). */
  documentos: ("INFORME_ENSAYO" | "CERTIFICADO_RESISTENCIA_BALISTICA" | "INFORME_RECHAZO")[];
  /** El lote es de chalecos (alguna munición de la tabla de chalecos): solo ellos tienen Informe de Rechazo. */
  chalecos: boolean;
  disparos: number;
  avisos: string[];
}

const peor = (vs: Veredicto[]): Veredicto => (vs.includes("no_cumple") ? "no_cumple" : vs.length && vs.every((v) => v === "cumple") ? "cumple" : "pendiente");

export function evaluarLote(r: RegistroDisparos, amenazas: Amenaza[]): LoteEvaluado {
  const unidades: UnidadEvaluada[] = r.unidades.map((u) => {
    const paneles = u.paneles.map((p) => evaluarPanel(p, amenazas));
    return { ...u, paneles, veredicto: peor(paneles.map((p) => p.veredicto)) };
  });
  const paneles = unidades.flatMap((u) => u.paneles.map((p) => ({ u, p })));
  const conPenetracion = paneles.find(({ p }) => p.disparos.some((d) => d.penetracion === true));
  const primeraFalla = conPenetracion ?? paneles.find(({ p }) => p.veredicto === "no_cumple");
  let falla: string | null = null;
  if (primeraFalla) {
    const d = primeraFalla.p.disparos.find((x) => x.condicion === "no_cumple")!;
    falla = `Panel ${primeraFalla.p.zona}${primeraFalla.u.talla ? ` ${primeraFalla.u.talla}` : ""} (${primeraFalla.u.serie}) · disparo ${d.n} · ${primeraFalla.p.amenazaFila?.municion ?? ""} · ${d.motivos.join(", ")}`;
  }
  const veredicto = unidades.length ? peor(unidades.map((u) => u.veredicto)) : "pendiente";
  const chalecos = paneles.some(({ p }) => p.amenazaFila?.elemento === "chaleco");
  const documentos: LoteEvaluado["documentos"] =
    veredicto === "no_cumple"
      ? chalecos
        ? ["INFORME_RECHAZO"]
        : ["INFORME_ENSAYO"]
      : veredicto === "cumple"
        ? r.certificacionLote
          ? ["INFORME_ENSAYO", "CERTIFICADO_RESISTENCIA_BALISTICA"]
          : ["INFORME_ENSAYO"]
        : [];
  return {
    unidades,
    veredicto,
    penetracion: Boolean(conPenetracion),
    falla,
    documentos,
    chalecos,
    disparos: paneles.reduce((s, { p }) => s + p.disparos.length, 0),
    avisos: paneles.flatMap(({ p }) => p.avisos),
  };
}

/**
 * Veredicto que se lleva a un resultado de la OT: el de las unidades de su
 * muestra; si ninguna unidad está ligada a esa muestra, el del lote completo.
 */
export function veredictoParaMuestra(l: LoteEvaluado, muestraId: string): { veredicto: Veredicto; resumen: string } {
  const propias = l.unidades.filter((u) => u.muestraId === muestraId);
  const base = propias.length ? propias : l.unidades;
  const v = propias.length ? peor(propias.map((u) => u.veredicto)) : l.veredicto;
  const disparos = base.reduce((s, u) => s + u.paneles.reduce((t, p) => t + p.disparos.length, 0), 0);
  const traumas = base.flatMap((u) => u.paneles.flatMap((p) => p.disparos.map((d) => d.trauma).filter((t): t is number => typeof t === "number")));
  const partes = [`${base.length} unidad(es)`, `${disparos} disparo(s)`];
  if (traumas.length) partes.push(`trauma máx. ${fmt(Math.max(...traumas))} mm`);
  if (v === "no_cumple" && l.falla) partes.push(`falla: ${l.falla}`);
  return { veredicto: v, resumen: `Registro de disparos: ${partes.join(" · ")}` };
}

/* --------------------------------------------------------------- CRB ----- */

const UNIDADES = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const DECENAS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const CENTENAS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function hasta999(n: number): string {
  if (n < 30) return UNIDADES[n];
  if (n < 100) return DECENAS[Math.floor(n / 10)] + (n % 10 ? ` y ${UNIDADES[n % 10]}` : "");
  if (n === 100) return "cien";
  return CENTENAS[Math.floor(n / 100)] + (n % 100 ? ` ${hasta999(n % 100)}` : "");
}

/**
 * Cantidad en palabras para el CRB («trescientos treinta y seis (336)»): se
 * genera del número, así no se repite el error del CRB real «Treinta y dos (50)».
 */
export function numeroEnPalabras(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) return String(n);
  if (n < 1000) return hasta999(n);
  const miles = Math.floor(n / 1000);
  const resto = n % 1000;
  const m = miles === 1 ? "mil" : `${hasta999(miles).replace(/uno$/, "un")} mil`;
  return resto ? `${m} ${hasta999(resto)}` : m;
}

export const cantidadEnPalabras = (n: number) => {
  const p = numeroEnPalabras(n);
  return `${p.charAt(0).toUpperCase()}${p.slice(1)} (${n.toLocaleString("es-CL")})`;
};

/** Series por talla («S 9 · M 49 … = 336») y su total. */
export function seriesPorTalla(c: RegistroDisparos["composicion"]): { texto: string; total: number } {
  const filas = (c ?? []).filter((x) => x.talla && Number.isFinite(x.cantidad) && x.cantidad > 0);
  const total = filas.reduce((s, x) => s + x.cantidad, 0);
  return { texto: filas.length ? `${filas.map((x) => `${x.talla} ${x.cantidad}`).join(" · ")} = ${total}` : "", total };
}

/** Unidades ensayadas (destruidas) y la serie que las reemplaza en el lote. */
export function reemplazos(r: RegistroDisparos): { serie: string; talla: string | null; reemplazo: string | null }[] {
  return r.unidades.map((u) => ({ serie: u.serie, talla: u.talla ?? null, reemplazo: u.reemplazo ?? null }));
}

/** Errores para emitir el CRB o el Informe de Rechazo con este registro. */
export function faltantesDocumentoLrb(tipo: string, l: LoteEvaluado, r: RegistroDisparos, cerrado: boolean): string[] {
  const f: string[] = [];
  if (tipo !== "CERTIFICADO_RESISTENCIA_BALISTICA" && tipo !== "INFORME_RECHAZO") return f;
  if (!r.unidades.length) return ["La OT no tiene registro de disparos: regístrelo en «Registro de disparos» antes de emitir."];
  if (!cerrado) f.push("Cierre el registro de disparos («Concluir lote → documento») antes de emitir.");
  if (tipo === "CERTIFICADO_RESISTENCIA_BALISTICA") {
    if (l.veredicto !== "cumple") f.push("El CRB solo se emite si el lote cumple (sin penetración completa y trauma dentro del máximo).");
    if (!r.certificacionLote) f.push("El CRB es para la certificación de un lote: márquelo en el registro de disparos.");
    if (!seriesPorTalla(r.composicion).total) f.push("Indique la nómina de series del lote por talla (el CRB la imprime).");
    const sinReemplazo = r.unidades.filter((u) => !u.reemplazo);
    if (sinReemplazo.length) f.push(`Indique la serie de reposición de ${sinReemplazo.map((u) => u.serie).join(", ")} (el CRB lista los reemplazos).`);
  } else {
    if (l.veredicto !== "no_cumple") f.push("El Informe de Ensayo de Rechazo solo se emite si el lote no cumple.");
    if (!l.chalecos) f.push("El Informe de Ensayo de Rechazo existe solo para chalecos antibalas: un casco o una probeta que no cumple se informa en el Informe de Ensayo.");
  }
  return f;
}

function fmt(n: number): string {
  return n.toLocaleString("es-CL", { maximumFractionDigits: 2 });
}

/* --------------------------------------------------- tabla de amenazas --- */

/** Lee la tabla configurada (JSON) y vuelve a los valores por defecto si no se entiende. */
export function leerAmenazas(json: string | null | undefined): Amenaza[] {
  if (!json) return AMENAZAS_DEFECTO;
  try {
    const filas = JSON.parse(json);
    if (!Array.isArray(filas) || !filas.length) return AMENAZAS_DEFECTO;
    const num = (v: unknown) => (v === null || v === "" || v === undefined ? null : Number(String(v).replace(",", ".")));
    const out = filas
      .map((f: any): Amenaza => ({
        clave: String(f.clave ?? "").trim(),
        norma: String(f.norma ?? "").trim(),
        nivel: String(f.nivel ?? "").trim(),
        elemento: String(f.elemento ?? "").trim().toLowerCase(),
        municion: String(f.municion ?? "").trim(),
        masa_g: num(f.masa_g),
        v_min: Number(num(f.v_min)),
        v_max: Number(num(f.v_max)),
        disparos: Number(num(f.disparos)),
        trauma_max: num(f.trauma_max),
        disparos_trauma: Number(num(f.disparos_trauma) ?? 0),
        testigo: f.testigo === true || f.testigo === "si" || f.testigo === "Sí",
        criterio: String(f.criterio ?? "").trim(),
      }))
      .filter((a) => a.clave && Number.isFinite(a.v_min) && Number.isFinite(a.v_max) && a.v_max >= a.v_min && Number.isInteger(a.disparos) && a.disparos > 0);
    return out.length ? out : AMENAZAS_DEFECTO;
  } catch {
    return AMENAZAS_DEFECTO;
  }
}

