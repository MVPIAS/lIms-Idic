/**
 * Preparación y acondicionamiento de muestras (tema T29) · reglas PURAS,
 * probadas en preparacion.spec.ts.
 *
 * EP-01 3.1 (LQC, LPN, LME) · EP-02 3.1 (LQA, LMB, LES) · EP-03 3.1 (LCC, LTX,
 * probetas) · EP-05 3.3 (DSA: acondicionamiento y QC).
 *
 * Los campos de cada laboratorio son configuración (Parámetros de la operación,
 * categoría `preparacion_campo`, un código `<LAB>.<campo>`), con los de la
 * especificación como valores por defecto. Un campo puede «bloquear»:
 *   · casilla sin marcar (p. ej. «Resultado QC conforme», «Verificación de la
 *     balanza ± 0,001 g»): bloquea la captura de la muestra;
 *   · fecha vencida (p. ej. «Vigencia de las soluciones» del LME): bloquea;
 *   · equipo no apto (calibración vencida, en calibración, fuera de servicio).
 * Con un bloqueo, la captura de los ensayos de ese laboratorio en esa muestra
 * queda detenida hasta registrar una preparación sin bloqueos (EP-01 3.1:
 * «Solución vencida bloquea el ensayo»; EP-05 3.3: «si el QC falla se detiene
 * el ensayo»).
 */

export const TIPOS_CAMPO_PREP = ["texto", "numero", "entero", "fecha", "fechahora", "lista", "casilla", "equipo"] as const;
export type TipoCampoPrep = (typeof TIPOS_CAMPO_PREP)[number];

export interface CampoPrep {
  /** Código del campo (minúsculas). */
  campo: string;
  etiqueta: string;
  tipo: TipoCampoPrep;
  obligatorio: boolean;
  /** Casilla sin marcar, fecha vencida o equipo no apto detienen la captura. */
  bloquea: boolean;
  unidad: string | null;
  opciones: { valor: string; etiqueta: string }[];
  ayuda: string;
  orden: number;
}

type Def = Omit<CampoPrep, "orden" | "opciones" | "ayuda" | "unidad" | "obligatorio" | "bloquea"> &
  Partial<Pick<CampoPrep, "opciones" | "ayuda" | "unidad" | "obligatorio" | "bloquea">>;

const op = (...v: string[]) => v.map((x) => ({ valor: x.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), etiqueta: x }));

const ACOND_DSA: Def[] = [
  { campo: "condicion", etiqueta: "Condición", tipo: "lista", obligatorio: true, opciones: op("Normal", "Inmersión") },
  { campo: "medio", etiqueta: "Medio de acondicionamiento", tipo: "texto" },
  { campo: "tiempo_h", etiqueta: "Tiempo de acondicionamiento", tipo: "numero", unidad: "h" },
  { campo: "temperatura_medio", etiqueta: "Temperatura del medio", tipo: "numero", unidad: "°C" },
  { campo: "t_plastilina", etiqueta: "Temperatura de la plastilina", tipo: "numero", unidad: "°C" },
  { campo: "verificacion_caida", etiqueta: "Verificación de caída conforme", tipo: "casilla", bloquea: true },
  { campo: "qc_conforme", etiqueta: "Resultado QC conforme (1)", tipo: "casilla", obligatorio: true, bloquea: true, ayuda: "Si el QC falla se detiene el ensayo y los resultados quedan bloqueados (EP-05 3.3)." },
  { campo: "equipo", etiqueta: "Equipo y Nº de serie", tipo: "equipo", bloquea: true },
  { campo: "t_ambiente", etiqueta: "Temperatura ambiente", tipo: "numero", unidad: "°C" },
  { campo: "hr_ambiente", etiqueta: "Humedad relativa ambiente", tipo: "numero", unidad: "%" },
];

const PROBETAS: Def[] = [
  { campo: "n_probetas", etiqueta: "Nº de probetas", tipo: "entero", obligatorio: true, ayuda: "Cada probeta recibe un código propio trazable a la muestra." },
  { campo: "espesor_medio", etiqueta: "Espesor medio", tipo: "numero", unidad: "mm" },
  { campo: "ancho_medio", etiqueta: "Ancho medio", tipo: "numero", unidad: "mm" },
  { campo: "acond_t", etiqueta: "Acondicionamiento · temperatura", tipo: "numero", unidad: "°C", obligatorio: true },
  { campo: "acond_hr", etiqueta: "Acondicionamiento · humedad relativa", tipo: "numero", unidad: "%", obligatorio: true },
  { campo: "acond_h", etiqueta: "Acondicionamiento · tiempo", tipo: "numero", unidad: "h", obligatorio: true },
  { campo: "equipo", etiqueta: "Equipo (troqueladora, rebajadora o climatizador)", tipo: "equipo", obligatorio: true, bloquea: true },
];

/** Campos por defecto de cada laboratorio (la especificación). */
export const CAMPOS_DEFECTO: Record<string, Def[]> = {
  LQC: [
    { campo: "peso_muestra", etiqueta: "Peso de muestra", tipo: "numero", unidad: "g", obligatorio: true },
    { campo: "factor_dilucion", etiqueta: "Factor de dilución F / Fc", tipo: "numero" },
    { campo: "volumen_aforo", etiqueta: "Volumen de aforo V", tipo: "numero", unidad: "mL" },
    { campo: "viruta", etiqueta: "Extracción de viruta (aleaciones)", tipo: "casilla" },
    { campo: "fecha", etiqueta: "Fecha de preparación", tipo: "fecha", obligatorio: true },
  ],
  LPN: [
    { campo: "sustrato", etiqueta: "Sustrato / panel", tipo: "texto", obligatorio: true },
    { campo: "metodo_aplicacion", etiqueta: "Método de aplicación", tipo: "lista", obligatorio: true, opciones: op("Brocha", "Pistola", "Inmersión", "Aplicador de película") },
    { campo: "espesor_humedo", etiqueta: "Espesor húmedo", tipo: "numero", unidad: "µm" },
    { campo: "n_probetas", etiqueta: "Nº de probetas", tipo: "entero", obligatorio: true, ayuda: "La probeta es una submuestra trazable a la muestra (EP-01 3.1)." },
    { campo: "curado_t", etiqueta: "Curado · temperatura", tipo: "numero", unidad: "°C" },
    { campo: "curado_hr", etiqueta: "Curado · humedad relativa", tipo: "numero", unidad: "%" },
    { campo: "curado_inicio", etiqueta: "Inicio del curado", tipo: "fecha", obligatorio: true },
    { campo: "curado_fin", etiqueta: "Fin del curado", tipo: "fecha" },
  ],
  LME: [
    { campo: "t_sala", etiqueta: "Temperatura de sala", tipo: "numero", unidad: "°C", obligatorio: true },
    { campo: "hr_sala", etiqueta: "Humedad relativa de sala", tipo: "numero", unidad: "%", obligatorio: true },
    { campo: "verificacion_balanza", etiqueta: "Verificación de balanza ± 0,001 g conforme", tipo: "casilla", obligatorio: true, bloquea: true },
    { campo: "vigencia_soluciones", etiqueta: "Vigencia de las soluciones (≤ 6 meses)", tipo: "fecha", obligatorio: true, bloquea: true, ayuda: "Fecha de vencimiento de la solución más antigua: si está vencida, el ensayo se bloquea (LME-PG01-P02)." },
    { campo: "normalidad_naoh", etiqueta: "Estandarización NaOH 0,5 N", tipo: "numero", unidad: "N" },
    { campo: "control_horno", etiqueta: "Control del horno conforme", tipo: "casilla", bloquea: true },
  ],
  LQA: [
    { campo: "homogeneizacion", etiqueta: "Método de homogeneización", tipo: "texto", obligatorio: true },
    { campo: "porcion_analitica", etiqueta: "Porción analítica", tipo: "numero", unidad: "g", obligatorio: true },
    { campo: "fecha", etiqueta: "Fecha y hora", tipo: "fechahora", obligatorio: true },
  ],
  LMB: [
    { campo: "unidad_analitica", etiqueta: "Unidad analítica", tipo: "lista", obligatorio: true, opciones: op("25 g", "50 g", "100 g", "25 mL") },
    { campo: "diluyente", etiqueta: "Diluyente", tipo: "texto" },
    { campo: "volumen_diluyente", etiqueta: "Volumen de diluyente", tipo: "numero", unidad: "mL" },
    { campo: "homogeneizador", etiqueta: "Homogeneizador", tipo: "equipo", bloquea: true },
    { campo: "asepsia", etiqueta: "Condiciones de asepsia verificadas", tipo: "casilla", obligatorio: true, bloquea: true },
    { campo: "fecha", etiqueta: "Fecha y hora", tipo: "fechahora", obligatorio: true },
  ],
  LES: [
    { campo: "variante", etiqueta: "Variante", tipo: "lista", obligatorio: true, opciones: op("Con preparación", "Sin preparación") },
    { campo: "instructivo", etiqueta: "Instructivo del rótulo", tipo: "texto" },
    { campo: "receta", etiqueta: "Receta (agua, tiempo, temperatura)", tipo: "texto" },
    { campo: "rendimiento_obtenido", etiqueta: "Rendimiento obtenido", tipo: "numero" },
    { campo: "rendimiento_declarado", etiqueta: "Rendimiento declarado en el rótulo", tipo: "numero" },
  ],
  LCC: PROBETAS,
  LTX: PROBETAS,
  LRB: ACOND_DSA,
  LEM: [
    { campo: "equipo", etiqueta: "Equipo y Nº de serie", tipo: "equipo", obligatorio: true, bloquea: true, ayuda: "Equipo sin calibración vigente bloquea la captura (EP-05 3.3)." },
    { campo: "t_ambiente", etiqueta: "Temperatura ambiente", tipo: "numero", unidad: "°C", obligatorio: true },
    { campo: "hr_ambiente", etiqueta: "Humedad relativa ambiente", tipo: "numero", unidad: "%", obligatorio: true },
    { campo: "qc_conforme", etiqueta: "Resultado QC conforme (1)", tipo: "casilla", bloquea: true },
  ],
  LAM: ACOND_DSA.filter((c) => !["t_plastilina", "verificacion_caida", "condicion", "medio"].includes(c.campo)),
  SEO: ACOND_DSA.filter((c) => !["t_plastilina", "verificacion_caida", "condicion", "medio"].includes(c.campo)),
  SVM: ACOND_DSA.filter((c) => ["equipo", "t_ambiente", "hr_ambiente", "qc_conforme"].includes(c.campo)),
};

/** Campos por defecto con su forma completa (la siembra y las pruebas los usan). */
export function camposDefecto(lab: string): CampoPrep[] {
  return (CAMPOS_DEFECTO[lab] ?? []).map((d, i) => ({ opciones: [], ayuda: "", unidad: null, obligatorio: false, bloquea: false, ...d, orden: i + 1 }));
}

/* ------------------------------------------------------ configuración --- */

/** JSON con que se guarda la definición de un campo en `parametro_sistema.valor`. */
export function jsonCampoPrep(c: Pick<CampoPrep, "tipo" | "obligatorio" | "bloquea" | "unidad" | "opciones" | "ayuda">): string {
  const o: Record<string, unknown> = { tipo: c.tipo };
  if (c.obligatorio) o.obligatorio = true;
  if (c.bloquea) o.bloquea = true;
  if (c.unidad) o.unidad = c.unidad;
  if (c.tipo === "lista") o.opciones = c.opciones;
  if (c.ayuda) o.ayuda = c.ayuda;
  return JSON.stringify(o);
}

/** Campo desde su fila de parámetros (`LAB.campo`, etiqueta, JSON). null si no se entiende. */
export function leerCampoPrep(fila: { codigo: string; etiqueta: string; valor: string | null; activo: boolean; orden?: number }): CampoPrep | null {
  if (!fila.activo) return null;
  const campo = fila.codigo.split(".")[1];
  if (!campo) return null;
  let d: any;
  try {
    d = JSON.parse(fila.valor ?? "{}");
  } catch {
    return null;
  }
  if (!d || typeof d !== "object" || !(TIPOS_CAMPO_PREP as readonly string[]).includes(d.tipo)) return null;
  const opciones = Array.isArray(d.opciones)
    ? d.opciones.map((o: any) => ({ valor: String(o?.valor ?? o ?? "").trim(), etiqueta: String(o?.etiqueta ?? o?.valor ?? o ?? "").trim() })).filter((o: any) => o.valor)
    : [];
  if (d.tipo === "lista" && !opciones.length) return null;
  return {
    campo,
    etiqueta: fila.etiqueta,
    tipo: d.tipo,
    obligatorio: d.obligatorio === true,
    bloquea: d.bloquea === true && ["casilla", "fecha", "equipo"].includes(d.tipo),
    unidad: typeof d.unidad === "string" && d.unidad.trim() ? d.unidad.trim().slice(0, 20) : null,
    opciones,
    ayuda: typeof d.ayuda === "string" ? d.ayuda : "",
    orden: fila.orden ?? 0,
  };
}

/** Valida una definición de campo escrita en la pantalla de parámetros. */
export function normalizarCampoPrep(entrada: unknown): { errores: string[]; def?: Omit<CampoPrep, "campo" | "etiqueta" | "orden">; activo: boolean } {
  const d = (entrada && typeof entrada === "object" && !Array.isArray(entrada) ? entrada : {}) as Record<string, unknown>;
  const e: string[] = [];
  const tipo = String(d.tipo ?? "") as TipoCampoPrep;
  if (!(TIPOS_CAMPO_PREP as readonly string[]).includes(tipo)) e.push(`Elija el tipo del campo (${TIPOS_CAMPO_PREP.join(", ")}).`);
  const bool = (v: unknown, def: boolean) => (v === undefined ? def : v === true || v === "si" ? true : v === false || v === "no" ? false : null);
  const obligatorio = bool(d.obligatorio, false);
  const bloquea = bool(d.bloquea, false);
  const activo = bool(d.activo, true);
  if (obligatorio === null || bloquea === null || activo === null) e.push("«Obligatorio», «Bloquea» y «Activo» son sí o no.");
  if (bloquea && !["casilla", "fecha", "equipo"].includes(tipo)) e.push("Solo una casilla, una fecha (vencimiento) o un equipo pueden bloquear la captura.");
  const unidad = typeof d.unidad === "string" ? d.unidad.trim() : "";
  if (unidad.length > 20) e.push("La unidad admite 20 caracteres.");
  const ayuda = typeof d.ayuda === "string" ? d.ayuda.trim() : "";
  if (ayuda.length > 300) e.push("La ayuda admite como máximo 300 caracteres.");
  let opciones: { valor: string; etiqueta: string }[] = [];
  if (tipo === "lista") {
    opciones = Array.isArray(d.opciones) ? d.opciones.map((o: any) => ({ valor: String(o?.valor ?? "").trim(), etiqueta: String(o?.etiqueta ?? o?.valor ?? "").trim() })) : [];
    if (!opciones.length) e.push("Una lista necesita al menos una opción.");
    if (opciones.length > 30) e.push("Como máximo 30 opciones.");
    if (opciones.some((o) => !o.valor || o.valor.length > 60 || o.etiqueta.length > 120)) e.push("Cada opción necesita su valor (máx. 60) y su texto (máx. 120).");
    if (new Set(opciones.map((o) => o.valor)).size !== opciones.length) e.push("Hay opciones con el mismo valor.");
  }
  if (e.length) return { errores: e, activo: activo ?? true };
  return { errores: [], def: { tipo, obligatorio: obligatorio!, bloquea: bloquea!, unidad: unidad || null, opciones, ayuda }, activo: activo! };
}

/* --------------------------------------------------------- evaluación --- */

export type ValorPrep = string | number | boolean | null;

export interface EquipoAptitud {
  id: string;
  codigo: string;
  apto: boolean;
  motivo: string | null;
}

export interface EvaluacionPreparacion {
  errores: string[];
  bloqueos: string[];
  /** Valores normalizados que se guardan. */
  datos: Record<string, ValorPrep>;
  /** Probetas generadas (si el laboratorio registra Nº de probetas). */
  probetas: string[];
}

const NUM = /^\s*[+-]?(\d+([.,]\d+)?|[.,]\d+)\s*$/;

/** Código de probeta: «<muestra>-P01» … (trazable a la muestra). */
export function probetasDe(muestraCodigo: string, n: number): string[] {
  if (!Number.isInteger(n) || n < 1) return [];
  return Array.from({ length: Math.min(n, 200) }, (_, i) => `${muestraCodigo}-P${String(i + 1).padStart(2, "0")}`);
}

/**
 * Valida lo capturado contra los campos del laboratorio y calcula los bloqueos.
 * `hoy` en AAAA-MM-DD (hora de Chile). `equipos`: aptitud de los equipos
 * elegidos (los demás se rechazan).
 */
export function evaluarPreparacion(
  campos: CampoPrep[],
  entrada: Record<string, unknown>,
  ctx: { hoy: string; equipos: Map<string, EquipoAptitud>; muestraCodigo: string },
): EvaluacionPreparacion {
  const errores: string[] = [];
  const bloqueos: string[] = [];
  const datos: Record<string, ValorPrep> = {};
  const conocidos = new Set(campos.map((c) => c.campo));
  for (const k of Object.keys(entrada)) if (!conocidos.has(k)) errores.push(`El campo «${k}» no es de la preparación de este laboratorio.`);
  for (const c of campos) {
    const v = entrada[c.campo];
    const vacio = v === undefined || v === null || (typeof v === "string" && v.trim() === "");
    if (vacio) {
      if (c.obligatorio && c.tipo !== "casilla") errores.push(`${c.etiqueta}: es obligatorio.`);
      if (c.tipo === "casilla") {
        datos[c.campo] = false;
        if (c.obligatorio && c.bloquea) bloqueos.push(`${c.etiqueta}: no está conforme.`);
      } else datos[c.campo] = null;
      continue;
    }
    switch (c.tipo) {
      case "texto":
        if (String(v).length > 500) errores.push(`${c.etiqueta}: máximo 500 caracteres.`);
        datos[c.campo] = String(v).trim();
        break;
      case "numero":
        if (typeof v === "number" ? !Number.isFinite(v) : !NUM.test(String(v))) errores.push(`${c.etiqueta}: escriba un número (coma decimal).`);
        else datos[c.campo] = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
        break;
      case "entero": {
        const n = Number(String(v).trim());
        if (!Number.isInteger(n) || n < 0 || n > 10000) errores.push(`${c.etiqueta}: escriba un número entero.`);
        else datos[c.campo] = n;
        break;
      }
      case "fecha": {
        const t = String(v).trim().slice(0, 16);
        if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(t)) errores.push(`${c.etiqueta}: fecha no válida (AAAA-MM-DD).`);
        else {
          datos[c.campo] = t;
          if (c.bloquea && t.slice(0, 10) < ctx.hoy) bloqueos.push(`${c.etiqueta}: vencida el ${t.slice(0, 10).split("-").reverse().join("-")}.`);
        }
        break;
      }
      case "fechahora": {
        // Hora de pared de Chile «AAAA-MM-DDTHH:MM» (EP-02 3.1: la preparación registra fecha Y hora).
        const t = String(v).trim().slice(0, 16);
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) errores.push(`${c.etiqueta}: indique la fecha y la hora.`);
        else datos[c.campo] = t;
        break;
      }
      case "lista":
        if (!c.opciones.some((o) => o.valor === String(v))) errores.push(`${c.etiqueta}: elija una de las opciones.`);
        else datos[c.campo] = String(v);
        break;
      case "casilla": {
        const b = v === true || v === "si" || v === "true";
        datos[c.campo] = b;
        if (c.bloquea && !b) bloqueos.push(`${c.etiqueta}: no está conforme.`);
        break;
      }
      case "equipo": {
        const eq = ctx.equipos.get(String(v));
        if (!eq) errores.push(`${c.etiqueta}: elija un equipo del laboratorio.`);
        else {
          datos[c.campo] = eq.id;
          if (c.bloquea && !eq.apto) bloqueos.push(`${c.etiqueta}: ${eq.codigo} no está apto (${eq.motivo ?? "sin calibración vigente"}).`);
        }
        break;
      }
    }
  }
  const n = typeof datos.n_probetas === "number" ? datos.n_probetas : 0;
  return { errores, bloqueos, datos, probetas: probetasDe(ctx.muestraCodigo, n) };
}

/** Motivo por el que no se captura un ensayo por la preparación de su muestra (null = se puede). */
export function motivoBloqueoPreparacion(p: { registrada: boolean; bloqueos: string[]; obligatoria: boolean; muestra: string; lab: string }): string | null {
  if (p.registrada && p.bloqueos.length)
    return `La preparación de la muestra ${p.muestra} (${p.lab}) bloquea el ensayo: ${p.bloqueos.join(" ")} Corrija la preparación antes de capturar.`;
  if (!p.registrada && p.obligatoria)
    return `Registre la preparación de la muestra ${p.muestra} (${p.lab}) antes de capturar: OT › Preparación.`;
  return null;
}
