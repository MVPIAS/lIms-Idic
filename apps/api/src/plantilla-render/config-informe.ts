/**
 * Formato del informe, parametrizable POR PLANTILLA (`plantilla_informe.config_informe`).
 *
 * Una plantilla decide CÓMO se presentan los resultados (no qué datos hay):
 *   · agrupación por muestra (Químicos) o por secciones numeradas
 *     (Textil y LCC: «4.1 Materiales» › «4.1.1 Tela base»);
 *   · columnas (método, unidad, estadística de réplicas) y sus títulos;
 *   · cuadro de «Referencias» con los No cumple, anexo fotográfico,
 *     conclusión con texto fijo y portada del IVC;
 *   · (LME, 20-10-2026) requisito en dos columnas Mínimo / Máximo con «-.-»
 *     donde no hay cota, la unidad junto al resultado y una tabla única con la
 *     columna Muestra (informe interno).
 *
 * El valor efectivo = valores por defecto del TIPO de plantilla + lo que la
 * plantilla guarde. Funciones PURAS: config-informe.spec.ts.
 */
import { z } from "zod";

const Etiquetas = z
  .object({
    ensayo: z.string().trim().min(1).max(40),
    metodo: z.string().trim().min(1).max(40),
    unidad: z.string().trim().min(1).max(40),
    requisito: z.string().trim().min(1).max(40),
    resultado: z.string().trim().min(1).max(40),
    veredicto: z.string().trim().min(1).max(40),
    minimo: z.string().trim().min(1).max(40),
    maximo: z.string().trim().min(1).max(40),
    muestra: z.string().trim().min(1).max(40),
  })
  .partial();

/** Lo que se puede guardar en una plantilla (todo opcional: se completa con el tipo). */
export const ConfigInformeSchema = z
  .object({
    /** muestra = una tabla por muestra; seccion = secciones y componentes numerados; unica = una sola tabla. */
    agrupacion: z.enum(["muestra", "seccion", "unica"]),
    /** Punto del informe donde empiezan los resultados («4» → 4.1, 4.1.1). Vacío = sin numerar. */
    numeracion: z
      .string()
      .trim()
      .regex(/^\d{1,2}(\.\d{1,2}){0,2}$/, "La numeración es un número de punto, p. ej. 4 o 5.2")
      .nullable(),
    columnaMetodo: z.boolean(),
    columnaUnidad: z.boolean(),
    /** auto = DE y CV solo si algún ensayo tiene réplicas. */
    estadisticas: z.enum(["auto", "siempre", "nunca"]),
    referencias: z.boolean(),
    anexoFotografico: z.boolean(),
    conclusionFija: z.string().trim().max(2000).nullable(),
    portada: z.enum(["ninguna", "ivc"]),
    etiquetas: Etiquetas,
    /** texto = una columna «Requisito»; min_max = dos columnas Mínimo / Máximo (LME). */
    columnasRequisito: z.enum(["texto", "min_max"]),
    /** La unidad va junto al valor del resultado («0,00 mg/L»). */
    unidadEnResultado: z.boolean(),
    /** Columna «Muestra» siempre (informe interno del LME). */
    columnaMuestra: z.boolean(),
    /** Texto de una cota vacía en las columnas Mínimo / Máximo (LME: «-.-»). */
    textoSinCota: z.string().max(10),
  })
  .partial()
  .strict();

export type ConfigInformeGuardada = z.infer<typeof ConfigInformeSchema>;

export interface ConfigInforme {
  agrupacion: "muestra" | "seccion" | "unica";
  numeracion: string | null;
  columnaMetodo: boolean;
  columnaUnidad: boolean;
  estadisticas: "auto" | "siempre" | "nunca";
  referencias: boolean;
  anexoFotografico: boolean;
  conclusionFija: string | null;
  portada: "ninguna" | "ivc";
  etiquetas: {
    ensayo: string;
    metodo: string;
    unidad: string;
    requisito: string;
    resultado: string;
    veredicto: string;
    minimo: string;
    maximo: string;
    muestra: string;
  };
  columnasRequisito: "texto" | "min_max";
  unidadEnResultado: boolean;
  columnaMuestra: boolean;
  textoSinCota: string;
}

/** Texto fijo de la conclusión del IVC y del informe de Textil / LCC. */
export const CONCLUSION_REGISTROS_5_ANIOS =
  "Los registros y resultados de las pruebas se encuentran disponibles para consultas, los cuales se mantendrán archivados en el laboratorio por un período de 5 años.";

const BASE: ConfigInforme = {
  agrupacion: "muestra",
  numeracion: null,
  columnaMetodo: true,
  columnaUnidad: true,
  estadisticas: "auto",
  referencias: true,
  anexoFotografico: true,
  conclusionFija: null,
  portada: "ninguna",
  etiquetas: {
    ensayo: "Ensayo / característica",
    metodo: "Método",
    unidad: "Unidad",
    requisito: "Requisito",
    resultado: "Resultado",
    veredicto: "Veredicto",
    minimo: "Mínimo",
    maximo: "Máximo",
    muestra: "Muestra",
  },
  columnasRequisito: "texto",
  unidadEnResultado: false,
  columnaMuestra: false,
  textoSinCota: "—",
};

const POR_TIPO: Record<string, Partial<ConfigInforme>> = {
  IVC: {
    agrupacion: "seccion",
    numeracion: "4",
    portada: "ivc",
    conclusionFija: CONCLUSION_REGISTROS_5_ANIOS,
    etiquetas: { ...BASE.etiquetas, ensayo: "Característica", metodo: "Método de verificación", veredicto: "Grado de cumplimiento" },
  },
};

/** Formato por defecto de un tipo de plantilla. */
export function configPorTipo(tipo: string | null | undefined): ConfigInforme {
  const t = POR_TIPO[(tipo ?? "").toUpperCase()] ?? {};
  return { ...BASE, ...t, etiquetas: { ...BASE.etiquetas, ...(t.etiquetas ?? {}) } };
}

/**
 * Formato efectivo: el del tipo con lo guardado en la plantilla encima. Un JSON
 * guardado que no valida (editado a mano en la BD) no rompe la emisión: se
 * ignora lo inválido campo a campo.
 */
export function configEfectiva(tipo: string | null | undefined, guardada: unknown): ConfigInforme {
  const base = configPorTipo(tipo);
  if (!guardada || typeof guardada !== "object" || Array.isArray(guardada)) return base;
  const limpia: Record<string, unknown> = {};
  const forma = ConfigInformeSchema.shape as Record<string, z.ZodTypeAny>;
  for (const [k, v] of Object.entries(guardada as Record<string, unknown>)) {
    const campo = forma[k];
    if (!campo) continue;
    const r = campo.safeParse(v);
    if (r.success) limpia[k] = r.data;
  }
  const etiquetas = { ...base.etiquetas, ...((limpia.etiquetas as object) ?? {}) };
  return { ...base, ...(limpia as Partial<ConfigInforme>), etiquetas };
}
