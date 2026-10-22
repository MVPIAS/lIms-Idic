/**
 * Planes de muestreo por atributos NCh 44 (equivalente a ISO 2859-1) y
 * selección de unidades NCh 43 · LIMS IDIC. Funciones PURAS (sin BD):
 * nch44.spec.ts.
 *
 * Fuente única de las tablas en el LIMS: la usan el «Muestreo del lote» de la
 * OT (EP-05 3.2, EP-10 10.4, EP-03 0.4) y cualquier formulario que necesite un
 * Ac/Re (inspección por atributos AQL, control de masa del LAM, HCP del SVM).
 *
 *   · Tabla 1   · tamaño de lote × nivel de inspección → letra código.
 *   · Tabla 2-A · plan simple, inspección NORMAL: letra → n, y (letra, AQL) →
 *                 Ac/Re, con las flechas resueltas (↓ = primer plan debajo,
 *                 ↑ = primer plan arriba: cambian la letra y n).
 *   · Si n ≥ tamaño de lote se inspecciona el 100 % del lote.
 *
 * Las tablas 2-B (estricta) y 2-C (reducida) NO están cargadas: con ellas el
 * sistema no propone n ni Ac/Re y quien muestrea los escribe con motivo
 * (por confirmar con el IDIC: copia de su NCh 44 vigente).
 *
 * Estructura de la tabla 2-A (verificada con los ejemplos reales del IDIC):
 * el Ac depende solo de la diagonal s = (índice de la letra) + (índice del AQL)
 * − 14. s = 0 → 0/1; s = 1 → ↑; s = 2 → ↓; s = 3 → 1/2; 4 → 2/3; 5 → 3/4;
 * 6 → 5/6; 7 → 7/8; 8 → 10/11; 9 → 14/15; 10 → 21/22; 11 → 30/31; 12 → 44/45.
 * Más allá, ↑. En las columnas de AQL ≤ 10 (porcentaje de unidades no
 * conformes) el último plan es 21/22; 30/31 y 44/45 solo existen en las
 * columnas de no conformidades por 100 unidades (AQL > 10).
 *   Ejemplos: SVM lote 70, nivel II → E, n = 13 (EP-05 §5.5); IVC LCC
 *   AQL 1,5 letra J n = 80 → 3/4; AQL 6,5 letra D n = 8 → 1/2 (EP-03 §5).
 */

export const LETRAS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R"] as const;
export type Letra = (typeof LETRAS)[number];

/** Tamaño de muestra de cada letra (tabla 2-A, inspección normal). */
export const TAMANO_LETRA: Record<Letra, number> = {
  A: 2, B: 3, C: 5, D: 8, E: 13, F: 20, G: 32, H: 50, J: 80, K: 125, L: 200, M: 315, N: 500, P: 800, Q: 1250, R: 2000,
};

export const NIVELES = ["S-1", "S-2", "S-3", "S-4", "I", "II", "III"] as const;
export type Nivel = (typeof NIVELES)[number];

export const ETIQUETA_NIVEL: Record<Nivel, string> = {
  "S-1": "Especial S-1",
  "S-2": "Especial S-2",
  "S-3": "Especial S-3",
  "S-4": "Especial S-4",
  I: "General I",
  II: "General II",
  III: "General III",
};

/** Tabla 1 · límites superiores de cada tramo de lote y letra por nivel (S-1 … S-4, I, II, III). */
const TABLA_1: { hasta: number; letras: [Letra, Letra, Letra, Letra, Letra, Letra, Letra] }[] = [
  { hasta: 8, letras: ["A", "A", "A", "A", "A", "A", "B"] },
  { hasta: 15, letras: ["A", "A", "A", "A", "A", "B", "C"] },
  { hasta: 25, letras: ["A", "A", "B", "B", "B", "C", "D"] },
  { hasta: 50, letras: ["A", "B", "B", "C", "C", "D", "E"] },
  { hasta: 90, letras: ["B", "B", "C", "C", "C", "E", "F"] },
  { hasta: 150, letras: ["B", "B", "C", "D", "D", "F", "G"] },
  { hasta: 280, letras: ["B", "C", "D", "E", "E", "G", "H"] },
  { hasta: 500, letras: ["B", "C", "D", "E", "F", "H", "J"] },
  { hasta: 1200, letras: ["C", "C", "E", "F", "G", "J", "K"] },
  { hasta: 3200, letras: ["C", "D", "E", "G", "H", "K", "L"] },
  { hasta: 10000, letras: ["C", "D", "F", "G", "J", "L", "M"] },
  { hasta: 35000, letras: ["C", "D", "F", "H", "K", "M", "N"] },
  { hasta: 150000, letras: ["D", "E", "G", "J", "L", "N", "P"] },
  { hasta: 500000, letras: ["D", "E", "G", "J", "M", "P", "Q"] },
  { hasta: Infinity, letras: ["D", "E", "H", "K", "N", "Q", "R"] },
];

/** Columnas de AQL de la tabla 2-A, en orden. */
export const AQLS = [
  0.01, 0.015, 0.025, 0.04, 0.065, 0.1, 0.15, 0.25, 0.4, 0.65, 1, 1.5, 2.5, 4, 6.5, 10, 15, 25, 40, 65, 100, 150, 250, 400, 650, 1000,
] as const;

/** Planes de la diagonal: s = 0 … 12 (null = flecha). */
const DIAGONAL: ({ ac: number; re: number } | "arriba" | "abajo")[] = [
  { ac: 0, re: 1 },
  "arriba",
  "abajo",
  { ac: 1, re: 2 },
  { ac: 2, re: 3 },
  { ac: 3, re: 4 },
  { ac: 5, re: 6 },
  { ac: 7, re: 8 },
  { ac: 10, re: 11 },
  { ac: 14, re: 15 },
  { ac: 21, re: 22 },
  { ac: 30, re: 31 },
  { ac: 44, re: 45 },
];

export class PlanError extends Error {}

/** Letra código (tabla 1). Lote: entero > 0. */
export function letraCodigo(tamanoLote: number, nivel: Nivel): Letra {
  if (!Number.isInteger(tamanoLote) || tamanoLote < 2)
    throw new PlanError("El tamaño del lote debe ser un entero de 2 o más unidades para usar la NCh 44.");
  const col = NIVELES.indexOf(nivel);
  if (col < 0) throw new PlanError(`Nivel de inspección desconocido: ${nivel}.`);
  const fila = TABLA_1.find((f) => tamanoLote <= f.hasta)!;
  return fila.letras[col];
}

/** Índice del AQL en la tabla (acepta coma decimal en texto). -1 si no es una columna de la tabla. */
export function indiceAql(aql: number | string): number {
  const v = typeof aql === "number" ? aql : Number(String(aql).trim().replace(",", "."));
  if (!Number.isFinite(v)) return -1;
  return AQLS.findIndex((a) => Math.abs(a - v) < 1e-9);
}

export interface AcRe {
  /** Letra del plan que se aplica (cambia si hubo flecha). */
  letra: Letra;
  /** Tamaño de muestra del plan (sin recortar por el tamaño del lote). */
  n: number;
  ac: number;
  re: number;
  /** La letra cambió por una flecha de la tabla (↑ o ↓). */
  flecha: "arriba" | "abajo" | null;
}

/** Último s con plan en la columna (21/22 si AQL ≤ 10; 44/45 si es por 100 unidades). */
const tope = (j: number) => (AQLS[j] <= 10 ? 10 : 12);

/**
 * Plan simple normal (tabla 2-A) para una letra y un AQL, resolviendo las
 * flechas. Lanza PlanError si el AQL no es una columna de la tabla.
 */
export function planNormal(letra: Letra, aql: number | string): AcRe {
  const j = indiceAql(aql);
  if (j < 0) throw new PlanError(`AQL ${aql} no es una columna de la tabla 2-A (use 0,010 … 1000, p. ej. 1,5 · 2,5 · 4,0 · 6,5).`);
  const i0 = LETRAS.indexOf(letra);
  if (i0 < 0) throw new PlanError(`Letra código desconocida: ${letra}.`);
  let i = i0;
  let flecha: AcRe["flecha"] = null;
  // Como mucho 16 saltos: siempre se llega a un plan.
  for (let paso = 0; paso < 20; paso++) {
    const s = i + j - 14;
    let celda: (typeof DIAGONAL)[number];
    if (s < 0) celda = "abajo";
    else if (s > tope(j)) celda = "arriba";
    else celda = DIAGONAL[s];
    if (typeof celda === "object") {
      const l = LETRAS[i];
      return { letra: l, n: TAMANO_LETRA[l], ac: celda.ac, re: celda.re, flecha };
    }
    const ni = celda === "abajo" ? i + 1 : i - 1;
    // Sin fila más allá (A arriba o R abajo): se queda con el 0/1 de su propia fila.
    if (ni < 0 || ni >= LETRAS.length) {
      const l = LETRAS[i];
      return { letra: l, n: TAMANO_LETRA[l], ac: 0, re: 1, flecha };
    }
    flecha = flecha ?? celda;
    i = ni;
  }
  throw new PlanError("No se pudo resolver el plan en la tabla 2-A.");
}

export const TABLAS = ["normal", "estricta", "reducida"] as const;
export type Tabla = (typeof TABLAS)[number];
export const ETIQUETA_TABLA: Record<Tabla, string> = {
  normal: "2-A · normal",
  estricta: "2-B · estricta",
  reducida: "2-C · reducida",
};

export const CLASES_DEFECTO = ["critico", "mayor", "menor"] as const;
export type ClaseDefecto = (typeof CLASES_DEFECTO)[number];
export const ETIQUETA_CLASE: Record<ClaseDefecto, string> = { critico: "Crítico", mayor: "Mayor", menor: "Menor" };

export interface EntradaPlan {
  tamanoLote: number;
  nivel: Nivel;
  tabla?: Tabla;
  /** AQL por clase de defecto (sin clase = AQL único en «mayor»). Vacío = sin Ac/Re. */
  aql?: Partial<Record<ClaseDefecto, number | string | null>>;
}

export interface PlanPropuesto {
  tabla: Tabla;
  nivel: Nivel;
  /** Letra de la tabla 1 (antes de las flechas). */
  letra: Letra;
  /** n de la letra (tabla 2-A) y n efectivo: recortado al lote (100 %) si n ≥ lote. */
  nLetra: number;
  n: number;
  inspeccion100: boolean;
  /** Ac/Re por clase, con la letra y n de su plan si una flecha los cambió. */
  clases: Partial<Record<ClaseDefecto, AcRe & { aql: number; nEfectivo: number }>>;
  /** Tamaño de muestra a extraer: el mayor de los planes (todas las clases se inspeccionan en la misma muestra). */
  nExtraer: number;
  avisos: string[];
}

/**
 * Propone el plan NCh 44 de un lote. Con la tabla 2-A calcula letra, n y Ac/Re
 * por clase; con 2-B o 2-C solo la letra (n y Ac/Re los escribe quien muestrea).
 */
export function proponerPlan(e: EntradaPlan): PlanPropuesto {
  const tabla = e.tabla ?? "normal";
  const letra = letraCodigo(e.tamanoLote, e.nivel);
  const nLetra = TAMANO_LETRA[letra];
  const avisos: string[] = [];
  const clases: PlanPropuesto["clases"] = {};
  let nExtraer = Math.min(nLetra, e.tamanoLote);
  if (tabla !== "normal") {
    avisos.push(
      `La tabla ${ETIQUETA_TABLA[tabla]} no está cargada en el sistema: escriba n, Ac y Re de su NCh 44 e indique el motivo.`,
    );
  } else {
    for (const c of CLASES_DEFECTO) {
      const a = e.aql?.[c];
      if (a == null || String(a).trim() === "") continue;
      const p = planNormal(letra, a);
      const nEfectivo = Math.min(p.n, e.tamanoLote);
      const valorAql = AQLS[indiceAql(a)];
      clases[c] = { ...p, aql: valorAql, nEfectivo };
      if (p.flecha)
        avisos.push(
          `${ETIQUETA_CLASE[c]} (AQL ${String(valorAql).replace(".", ",")}): la tabla remite a la letra ${p.letra} (n = ${p.n}) por la flecha ${p.flecha === "abajo" ? "↓" : "↑"}.`,
        );
      nExtraer = Math.max(nExtraer, nEfectivo);
    }
  }
  const inspeccion100 = nExtraer >= e.tamanoLote;
  if (inspeccion100) avisos.push("El tamaño de muestra alcanza al lote: se inspecciona el 100 % de las unidades.");
  return { tabla, nivel: e.nivel, letra, nLetra, n: Math.min(nLetra, e.tamanoLote), inspeccion100, clases, nExtraer, avisos };
}

/* -------------------------------------------------------------------------- */
/* NCh 43 · selección de las unidades                                         */
/* -------------------------------------------------------------------------- */

/** Período de extracción de la selección sistemática: k = ⌊lote / muestra⌋ (≥ 1). */
export function periodoExtraccion(tamanoLote: number, tamanoMuestra: number): number {
  if (!(tamanoLote > 0) || !(tamanoMuestra > 0)) throw new PlanError("Indique el tamaño del lote y de la muestra.");
  return Math.max(1, Math.floor(tamanoLote / tamanoMuestra));
}

/**
 * Unidades de la selección sistemática NCh 43: inicio, inicio + k, … hasta n
 * unidades (numeradas 1 … lote). El inicio va de 1 a k (EP-10 10.4: punto de
 * partida; SVM: «paso 5 desde la Nº 02»).
 */
export function seleccionSistematica(tamanoLote: number, tamanoMuestra: number, inicio: number, paso?: number): number[] {
  const k = paso ?? periodoExtraccion(tamanoLote, tamanoMuestra);
  if (!Number.isInteger(k) || k < 1) throw new PlanError("El paso de la selección debe ser un entero de 1 o más.");
  if (!Number.isInteger(inicio) || inicio < 1 || inicio > k)
    throw new PlanError(`El punto de partida debe estar entre 1 y ${k} (el paso).`);
  if (tamanoMuestra > tamanoLote) throw new PlanError("La muestra no puede superar el lote.");
  const u: number[] = [];
  for (let x = inicio; u.length < tamanoMuestra && x <= tamanoLote; x += k) u.push(x);
  if (u.length < tamanoMuestra)
    throw new PlanError(`Con paso ${k} desde la unidad ${inicio} solo se alcanzan ${u.length} de ${tamanoMuestra} unidades: use un paso menor.`);
  return u;
}

/* -------------------------------------------------------------------------- */
/* Veredicto del lote por clase de defecto                                     */
/* -------------------------------------------------------------------------- */

export interface ConteoClase {
  clase: ClaseDefecto;
  /** Unidades no conformes de esa clase en la muestra. */
  defectuosas: number;
  /** Ac/Re del plan; si falta, rige la regla sin plan. */
  ac?: number | null;
  re?: number | null;
}

export type ReglaSinPlan = "cualquier_nc" | "critica_o_mayor";

export interface VeredictoLote {
  veredicto: "acepta" | "rechaza" | "pendiente";
  detalle: { clase: ClaseDefecto; defectuosas: number; ac: number | null; re: number | null; decision: "acepta" | "rechaza" }[];
  regla: string;
}

/**
 * Veredicto del lote (EP-05 5.3, EP-03 3.7): por cada clase, acepta si
 * defectuosas ≤ Ac y rechaza si defectuosas ≥ Re; el lote se rechaza si alguna
 * clase rechaza. Una clase sin Ac/Re sigue la regla sin plan:
 *   · `cualquier_nc` (por defecto): una unidad no conforme rechaza;
 *   · `critica_o_mayor`: rechaza una NC crítica o mayor; las menores se informan.
 * Un defecto crítico rechaza siempre (Ac = 0), salvo que el plan diga otra cosa.
 * `pendiente` si quedan ensayos sin decidir.
 */
export function veredictoLote(conteos: ConteoClase[], opciones: { reglaSinPlan?: ReglaSinPlan; pendientes?: number } = {}): VeredictoLote {
  const regla = opciones.reglaSinPlan ?? "cualquier_nc";
  const detalle: VeredictoLote["detalle"] = [];
  for (const c of conteos) {
    let ac = c.ac ?? null;
    let re = c.re ?? null;
    if (ac == null || re == null) {
      if (c.clase === "critico" || regla === "cualquier_nc" || c.clase === "mayor") {
        ac = 0;
        re = 1;
      } else {
        ac = null;
        re = null;
      }
    }
    const decision = ac == null || re == null ? "acepta" : c.defectuosas >= re ? "rechaza" : "acepta";
    detalle.push({ clase: c.clase, defectuosas: c.defectuosas, ac, re, decision });
  }
  const rechaza = detalle.some((d) => d.decision === "rechaza");
  const veredicto = rechaza ? "rechaza" : (opciones.pendientes ?? 0) > 0 ? "pendiente" : "acepta";
  const texto =
    regla === "critica_o_mayor"
      ? "Ac/Re del plan por clase; sin plan, una NC crítica o mayor rechaza y las menores se informan."
      : "Ac/Re del plan por clase; sin plan, una unidad no conforme rechaza el lote.";
  return { veredicto, detalle, regla: texto };
}
