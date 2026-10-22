/**
 * Formularios de captura especializados · qué variante usa cada ensayo ·
 * reglas PURAS, probadas en variantes.spec.ts.
 *
 * Decisión de producto del 14-10-2026: hay UN formulario de captura estándar.
 * Los formularios especializados son VARIANTES que se activan por método (o,
 * si no, por laboratorio) desde «Parámetros de la operación»; un ensayo sin
 * variante sigue con la captura estándar como siempre. La variante captura el
 * dato primario en su propia pantalla y lleva el valor y el veredicto al
 * resultado estándar, que sigue el camino normal (revisión, aprobación,
 * informe).
 *
 *   Precedencia: método del catálogo  >  laboratorio dueño del ensayo  >  estándar.
 */

export const VARIANTES = ["estandar", "lrb_disparos", "svm_hcp", "aql", "lmb_micro", "les_panel"] as const;
export type Variante = (typeof VARIANTES)[number];

export interface DefVariante {
  variante: Variante;
  /** Nombre de la pantalla. */
  nombre: string;
  /** Paso de la especificación. */
  paso: string;
  /** Alcance del registro: toda la OT (lote), una muestra o un ensayo. */
  alcance: "ot" | "muestra" | "resultado";
  /** Ruta de la pantalla (con el id que corresponde). */
  ruta: (p: { otId: string; resultadoId?: string; muestraId?: string }) => string;
}

export const DEF_VARIANTE: Record<Exclude<Variante, "estandar">, DefVariante> = {
  lrb_disparos: {
    variante: "lrb_disparos",
    nombre: "Registro de disparos",
    paso: "EP-05 4.1",
    alcance: "ot",
    ruta: ({ otId }) => `/captura-ot/disparos?otId=${otId}`,
  },
  svm_hcp: {
    variante: "svm_hcp",
    nombre: "Hoja de Control de Pruebas por vehículo",
    paso: "EP-05 4.6",
    alcance: "muestra",
    ruta: ({ otId, muestraId }) => `/captura-ot/hcp?otId=${otId}${muestraId ? `&muestraId=${muestraId}` : ""}`,
  },
  aql: {
    variante: "aql",
    nombre: "Inspección por atributos (AQL)",
    paso: "EP-03 3.7",
    alcance: "ot",
    ruta: ({ otId }) => `/captura-ot/aql?otId=${otId}`,
  },
  lmb_micro: {
    variante: "lmb_micro",
    nombre: "Microbiología · siembra, incubación y lectura",
    paso: "EP-02 3.3–3.5",
    alcance: "resultado",
    ruta: ({ otId, resultadoId }) => `/captura-ot/micro?otId=${otId}${resultadoId ? `&resultadoId=${resultadoId}` : ""}`,
  },
  les_panel: {
    variante: "les_panel",
    nombre: "Panel sensorial",
    paso: "EP-02 3.6–3.8",
    alcance: "resultado",
    ruta: ({ otId, resultadoId }) => `/captura-ot/sensorial?otId=${otId}${resultadoId ? `&resultadoId=${resultadoId}` : ""}`,
  },
};

export const OPCIONES_VARIANTE = [
  { valor: "estandar", etiqueta: "Captura estándar" },
  { valor: "lrb_disparos", etiqueta: "LRB · Registro de disparos (EP-05 4.1)" },
  { valor: "svm_hcp", etiqueta: "SVM · Hoja de Control de Pruebas (EP-05 4.6)" },
  { valor: "aql", etiqueta: "Inspección por atributos · AQL (EP-03 3.7)" },
  { valor: "lmb_micro", etiqueta: "LMB · Siembra, incubación y lectura (EP-02 3.3–3.5)" },
  { valor: "les_panel", etiqueta: "LES · Panel sensorial (EP-02 3.6–3.8)" },
];

export const esVariante = (v: unknown): v is Variante => typeof v === "string" && (VARIANTES as readonly string[]).includes(v);

/** Fila de configuración (parámetro activo con su valor). */
export interface ActivacionVariante {
  codigo: string;
  valor: string | null;
  activo: boolean;
}

/**
 * Mapas de activación desde las filas de `parametro_sistema`:
 * `captura_variante_metodo` (código = código del método del catálogo) y
 * `captura_variante_laboratorio` (código = laboratorio). Las filas inactivas
 * o con un valor desconocido no cuentan.
 */
export function mapaActivacion(filas: ActivacionVariante[]): Map<string, Variante> {
  const m = new Map<string, Variante>();
  for (const f of filas) {
    const v = String(f.valor ?? "").trim();
    if (f.activo && esVariante(v)) m.set(f.codigo.trim().toUpperCase(), v);
  }
  return m;
}

/** Variante de un ensayo: la del método, si no la del laboratorio, si no la estándar. */
export function varianteDe(
  ensayo: { metodoCodigo?: string | null; laboratorio?: string | null },
  porMetodo: Map<string, Variante>,
  porLaboratorio: Map<string, Variante>,
): Variante {
  const m = ensayo.metodoCodigo ? porMetodo.get(ensayo.metodoCodigo.trim().toUpperCase()) : undefined;
  if (m) return m;
  const l = ensayo.laboratorio ? porLaboratorio.get(ensayo.laboratorio.trim().toUpperCase()) : undefined;
  return l ?? "estandar";
}

/**
 * Por qué la captura estándar no admite el valor de este ensayo: se registra
 * en su formulario especializado (que lleva el valor al resultado). null = sí.
 */
export function motivoCapturaEnVariante(variante: Variante, desde: Variante | null | undefined): string | null {
  if (variante === "estandar" || desde === variante) return null;
  const d = DEF_VARIANTE[variante];
  return `Este ensayo se captura en «${d.nombre}» (${d.paso}): ahí se registra el dato primario y su veredicto pasa al resultado.`;
}
