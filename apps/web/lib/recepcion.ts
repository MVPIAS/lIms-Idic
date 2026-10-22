/**
 * recepcion.ts · tipos y utilidades de la recepción y custodia de la muestra en
 * la web (frente r1d). Las reglas valen en el servidor
 * (apps/api/src/recepcion/reglas-recepcion.ts); aquí solo se pinta y se avisa.
 */

export type TipoCampo = "texto" | "numero" | "entero" | "fecha" | "lista" | "casilla";
export type ClaseCustodia = "analisis" | "testigo" | "custodia" | "contramuestra";
export type ValorCampo = string | number | boolean | null;

export interface CampoRecepcion {
  codigo: string;
  etiqueta: string;
  tipo: TipoCampo;
  obligatorio: boolean;
  opciones: { valor: string; etiqueta: string }[];
  ayuda: string | null;
  orden: number;
}

export interface ConfigRecepcion {
  laboratorio: { id: string; codigo: string; nombre: string } | null;
  productoObligatorio: boolean;
  campos: CampoRecepcion[];
  clases: { valor: ClaseCustodia; etiqueta: string }[];
  plazos: Partial<Record<ClaseCustodia, number>>;
}

export interface ProductoLab {
  id: string;
  codigo: string;
  nombre: string;
  nombreCatalogo: string;
  metodos: number;
  delLaboratorio: boolean;
}

export const NOMBRE_CLASE: Record<ClaseCustodia, string> = {
  analisis: "Análisis",
  testigo: "Testigo",
  custodia: "En custodia",
  contramuestra: "Contramuestra",
};

/** Etiqueta de la clase según la configuración del laboratorio (p. ej. «Destrucción» en LCC). */
export function etiquetaClase(cfg: ConfigRecepcion | null | undefined, clase: string | null | undefined): string {
  if (!clase) return "";
  const campo = cfg?.campos.find((c) => c.codigo === "clase_custodia");
  return campo?.opciones.find((o) => o.valor === clase)?.etiqueta ?? NOMBRE_CLASE[clase as ClaseCustodia] ?? clase;
}

/** Valor del campo de la recepción (columnas o datos). */
export function valorCampo(c: CampoRecepcion, d: { claseCustodia: string; ubicacion: string; datos: Record<string, ValorCampo> }): ValorCampo {
  if (c.codigo === "clase_custodia") return d.claseCustodia;
  if (c.codigo === "ubicacion") return d.ubicacion;
  return d.datos[c.codigo] ?? (c.tipo === "casilla" ? false : "");
}

/** Lo obligatorio del laboratorio que falta (el servidor lo vuelve a comprobar). */
export function faltantesLaboratorio(
  cfg: ConfigRecepcion | null | undefined,
  d: { claseCustodia: string; ubicacion: string; datos: Record<string, ValorCampo> },
): string[] {
  if (!cfg) return [];
  const f: string[] = [];
  for (const c of cfg.campos) {
    if (!c.obligatorio) continue;
    const v = valorCampo(c, d);
    if (c.tipo === "casilla" ? v !== true : v === null || v === undefined || String(v).trim() === "") f.push(`indique «${c.etiqueta}»`);
  }
  return f;
}

/** Texto del valor de un campo para mostrarlo (Sí / No, opción, fecha). */
export function textoValor(c: CampoRecepcion, v: ValorCampo | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  if (c.tipo === "casilla") return v ? "Sí" : "No";
  if (c.tipo === "lista") return c.opciones.find((o) => o.valor === v)?.etiqueta ?? String(v);
  if (c.tipo === "fecha") return String(v).split("-").reverse().join("-");
  return String(v).replace(/^(-?\d+)\.(\d+)$/, "$1,$2");
}

/** Fecha AAAA-MM-DD → DD-MM-AAAA. */
export const fechaDma = (iso?: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("-") : "—");
