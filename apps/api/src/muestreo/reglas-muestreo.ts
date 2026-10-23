/**
 * Registro de muestreo de la OT · reglas PURAS (sin BD): reglas-muestreo.spec.ts.
 * Contrato: docs/FLUJO_ESPECIFICACIONES_MUESTREO.md. Tablas NCh 43/44: nch44.ts.
 *
 *   · Formulario según quién muestrea (EP-01 1.1, EP-02 1.1, EP-03 0.4, EP-05
 *     3.2, EP-10 10.4): cada tipo exige sus campos para «Registrar muestreo →
 *     entregar al laboratorio».
 *   · Plan NCh 44: se propone (letra, n, Ac/Re por clase) y n se puede cambiar
 *     con motivo; con las tablas 2-B o 2-C se escriben n y Ac/Re con motivo.
 *   · El laboratorio marca «recibido conforme» (o no conforme, con motivo).
 *   · Veredicto del lote: no conformidades por clase frente a Ac/Re.
 */
import {
  CLASES_DEFECTO,
  ETIQUETA_CLASE,
  NIVELES,
  PlanError,
  TABLAS,
  indiceAql,
  proponerPlan,
  type ClaseDefecto,
  type Nivel,
  type Tabla,
} from "./nch44";

export const TIPOS_FORMULARIO = ["extraccion", "numform", "it01_form06", "planilla_nch44"] as const;
export type TipoFormulario = (typeof TIPOS_FORMULARIO)[number];
export const ETIQUETA_FORMULARIO: Record<TipoFormulario, string> = {
  extraccion: "Formulario de selección y extracción de muestra (Sección Muestreo)",
  numform: "Registro de muestreo NUMFORM (Alimentos)",
  it01_form06: "Lista de chequeo DCO-PG01-P01-IT01-FORM06 (toma en terreno)",
  planilla_nch44: "Planilla de muestreo NCh 44 (lote)",
};

export const ESTADOS_MUESTREO = ["borrador", "registrado", "recibido", "anulado"] as const;
export type EstadoMuestreo = (typeof ESTADOS_MUESTREO)[number];

/** Sellos escritos a mano («S-001, S-002; S-003») → lista sin repetidos. */
export function normalizarSellos(v: string | string[] | null | undefined): string[] {
  const partes = Array.isArray(v) ? v : String(v ?? "").split(/[,;\n]/);
  const out: string[] = [];
  for (const p of partes) {
    const s = String(p).trim().slice(0, 60);
    if (s && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out.slice(0, 100);
}

/* ------------------------------------------------------------------ plan --- */

export interface EntradaPlan {
  nivel?: string | null;
  tabla?: string | null;
  aql?: Partial<Record<ClaseDefecto, string | number | null>>;
  /** n que se extrae (si difiere del propuesto, con motivo). */
  n?: number | null;
  motivoN?: string | null;
  /** Ac/Re escritos a mano (tablas 2-B y 2-C). */
  manual?: Partial<Record<ClaseDefecto, { ac: number; re: number }>>;
  /** Selección NCh 43. */
  seleccion?: { metodo?: string | null; inicio?: number | null; paso?: number | null } | null;
}

export interface PlanGuardado {
  norma: "NCh 44";
  nivel: Nivel;
  tabla: Tabla;
  aql: Partial<Record<ClaseDefecto, number>>;
  letra: string;
  nPropuesto: number | null;
  n: number;
  motivoN: string | null;
  clases: Partial<Record<ClaseDefecto, { letra: string; n: number; ac: number; re: number; aql: number | null; manual: boolean }>>;
  inspeccion100: boolean;
  seleccion: { metodo: "sistematica" | "aleatoria" | "manual"; inicio: number | null; paso: number | null };
  avisos: string[];
}

const entero = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/**
 * Valida y calcula el plan del lote. `tamanoLote` es el del formulario. Devuelve
 * el plan a guardar o los errores.
 */
export function normalizarPlan(e: EntradaPlan, tamanoLote: number | null | undefined): { plan?: PlanGuardado; errores: string[] } {
  const errores: string[] = [];
  if (!entero(tamanoLote) || tamanoLote < 2) return { errores: ["Indique el tamaño del lote (entero de 2 o más) para calcular el plan NCh 44."] };
  const nivel = (e.nivel ?? "II") as Nivel;
  if (!(NIVELES as readonly string[]).includes(nivel)) errores.push("Nivel de inspección desconocido (S-1…S-4, I, II, III).");
  const tabla = (e.tabla ?? "normal") as Tabla;
  if (!(TABLAS as readonly string[]).includes(tabla)) errores.push("Tabla desconocida (normal, estricta o reducida).");
  const aql: Partial<Record<ClaseDefecto, number>> = {};
  for (const c of CLASES_DEFECTO) {
    const a = e.aql?.[c];
    if (a == null || String(a).trim() === "" || String(a) === "ninguno") continue;
    const j = indiceAql(a);
    if (j < 0) errores.push(`AQL de ${ETIQUETA_CLASE[c].toLowerCase()}: «${a}» no es una columna de la tabla NCh 44.`);
    else aql[c] = Number(String(a).replace(",", "."));
  }
  if (errores.length) return { errores };
  let prop;
  try {
    prop = proponerPlan({ tamanoLote, nivel, tabla, aql });
  } catch (err) {
    if (err instanceof PlanError) return { errores: [err.message] };
    throw err;
  }
  const motivoN = e.motivoN?.trim() || null;
  const clases: PlanGuardado["clases"] = {};
  let n: number;
  if (tabla === "normal") {
    n = e.n ?? prop.nExtraer;
    if (!entero(n) || n < 1) errores.push("El tamaño de muestra debe ser un entero mayor que cero.");
    else if (n > tamanoLote) errores.push(`El tamaño de muestra (${n}) no puede superar el del lote (${tamanoLote}).`);
    else if (n !== prop.nExtraer && (!motivoN || motivoN.length < 5))
      errores.push(`El plan propone n = ${prop.nExtraer}: para extraer ${n} indique el motivo (mínimo 5 caracteres).`);
    for (const c of CLASES_DEFECTO) {
      const p = prop.clases[c];
      if (p) clases[c] = { letra: p.letra, n: p.nEfectivo, ac: p.ac, re: p.re, aql: p.aql, manual: false };
    }
  } else {
    n = e.n as number;
    if (!entero(n) || n < 1) errores.push(`Con la tabla ${tabla} escriba el tamaño de muestra de su NCh 44.`);
    else if (n > tamanoLote) errores.push(`El tamaño de muestra (${n}) no puede superar el del lote (${tamanoLote}).`);
    if (!motivoN || motivoN.length < 5) errores.push("Indique el motivo y la tabla de la que salen n, Ac y Re (mínimo 5 caracteres).");
    for (const c of CLASES_DEFECTO) {
      if (aql[c] == null) continue;
      const m = e.manual?.[c];
      if (!m || !entero(m.ac) || !entero(m.re) || m.ac < 0 || m.re <= m.ac)
        errores.push(`Escriba Ac y Re de ${ETIQUETA_CLASE[c].toLowerCase()} (enteros, Re mayor que Ac).`);
      else clases[c] = { letra: prop.letra, n: n ?? 0, ac: m.ac, re: m.re, aql: aql[c] ?? null, manual: true };
    }
  }
  const sel = e.seleccion ?? {};
  const metodo = sel.metodo === "aleatoria" || sel.metodo === "manual" ? sel.metodo : "sistematica";
  const paso = sel.paso ?? null;
  const inicio = sel.inicio ?? null;
  if (paso != null && (!entero(paso) || paso < 1)) errores.push("El paso de la selección debe ser un entero de 1 o más.");
  if (inicio != null && (!entero(inicio) || inicio < 1 || inicio > tamanoLote)) errores.push(`El punto de partida debe estar entre 1 y ${tamanoLote}.`);
  if (errores.length) return { errores };
  return {
    errores: [],
    plan: {
      norma: "NCh 44",
      nivel,
      tabla,
      aql,
      letra: prop.letra,
      nPropuesto: tabla === "normal" ? prop.nExtraer : null,
      n,
      motivoN,
      clases,
      inspeccion100: n >= tamanoLote,
      seleccion: { metodo, inicio, paso },
      avisos: prop.avisos,
    },
  };
}

/* ------------------------------------------------------------- registro --- */

export interface DatosMuestreo {
  tipoFormulario: TipoFormulario;
  numeroFormulario?: string | null;
  lugar?: string | null;
  fechaToma?: string | Date | null;
  responsable?: string | null;
  solicitadoPor?: string | null;
  producto?: string | null;
  proveedor?: string | null;
  identificacionLote?: string | null;
  tamanoLote?: number | null;
  tamanoMuestra?: number | null;
  cantidadEnvase?: string | null;
  sellos?: string[];
  registroFotoNumero?: string | null;
  devolucionExcedente?: boolean | null;
  plan?: PlanGuardado | null;
  lineaMovil?: boolean;
  lineaMovilPlan?: string | null;
}

const vacio = (v: unknown) => v == null || String(v).trim() === "";

/**
 * Qué falta para «Registrar muestreo → entregar al laboratorio», según el
 * formulario (campos obligatorios de su EP). `fotos` = fotos adjuntas.
 */
export function faltantesRegistro(d: DatosMuestreo, fotos: number, ahora = new Date()): string[] {
  const f: string[] = [];
  if (vacio(d.numeroFormulario)) f.push("Nº de formulario de muestreo");
  if (vacio(d.fechaToma)) f.push("fecha y hora de la toma");
  else if (new Date(d.fechaToma as any).getTime() > ahora.getTime() + 5 * 60_000) f.push("una fecha de toma que no sea futura");
  if (vacio(d.lugar)) f.push("lugar de muestreo");
  const loteYMuestra = () => {
    if (d.tamanoLote == null) f.push("tamaño del lote");
    if (d.tamanoMuestra == null) f.push("tamaño de la muestra");
  };
  switch (d.tipoFormulario) {
    case "extraccion":
      if (vacio(d.producto)) f.push("producto / E.T.");
      if (vacio(d.proveedor)) f.push("proveedor");
      loteYMuestra();
      if (!d.sellos?.length) f.push("Nº de los sellos");
      if (vacio(d.registroFotoNumero) && fotos === 0) f.push("registro fotográfico (Nº o fotos)");
      break;
    case "numform":
      if (vacio(d.producto)) f.push("producto");
      if (vacio(d.proveedor)) f.push("proveedor");
      if (vacio(d.cantidadEnvase)) f.push("cantidad de muestra");
      if (d.tamanoLote == null) f.push("tamaño del lote");
      if (d.devolucionExcedente == null) f.push("si se devuelve el excedente");
      if (vacio(d.solicitadoPor)) f.push("quién lo solicita");
      break;
    case "it01_form06":
      if (vacio(d.responsable)) f.push("responsable de la toma");
      if (vacio(d.cantidadEnvase)) f.push("cantidad y envase");
      break;
    case "planilla_nch44":
      if (vacio(d.identificacionLote)) f.push("identificación del lote");
      loteYMuestra();
      if (!d.plan && !d.lineaMovil) f.push("plan de muestreo NCh 44 (o marcar línea móvil con su plan)");
      break;
  }
  if (d.tamanoLote != null && d.tamanoMuestra != null && d.tamanoMuestra > d.tamanoLote)
    f.push(`un tamaño de muestra (${d.tamanoMuestra}) no mayor que el lote (${d.tamanoLote})`);
  if (d.plan && d.tamanoMuestra != null && d.tamanoMuestra !== d.plan.n)
    f.push(`que el tamaño de muestra (${d.tamanoMuestra}) coincida con el n del plan (${d.plan.n})`);
  if (d.lineaMovil && vacio(d.lineaMovilPlan)) f.push("el plan aplicado en la línea móvil (SAC-PG01-IT10 no aplica)");
  return f;
}

/** ¿Se puede editar el muestreo? null = sí. */
export function motivoNoEditable(estado: EstadoMuestreo): string | null {
  if (estado === "borrador") return null;
  if (estado === "registrado") return "El muestreo ya se entregó al laboratorio: solo se corrige anulándolo y registrando otro.";
  if (estado === "recibido") return "El laboratorio ya recibió el muestreo: no se modifica.";
  return "El muestreo está anulado.";
}

/** «Recibido conforme» por el laboratorio (EP-01 1.1): solo un muestreo entregado; no conforme exige motivo. */
export function erroresRecepcion(estado: EstadoMuestreo, conforme: boolean, observacion?: string | null): string[] {
  if (estado !== "registrado")
    return [estado === "borrador" ? "El muestreo aún no se entrega al laboratorio." : estado === "recibido" ? "El muestreo ya se recibió." : "El muestreo está anulado."];
  if (!conforme && (observacion?.trim().length ?? 0) < 5) return ["Indique qué no está conforme (mínimo 5 caracteres)."];
  return [];
}

/* -------------------------------------------------- veredicto del lote --- */

export interface ResultadoLote {
  veredicto: string | null;
  claseDefecto?: string | null;
  muestraId: string;
}

/**
 * Unidades no conformes por clase: cada muestra (unidad) cuenta una vez en
 * cada clase en que tiene una no conformidad. Una no conformidad sin clase
 * cuenta como «mayor» (por confirmar). `pendientes` = ensayos sin decidir.
 */
export function contarDefectuosas(resultados: ResultadoLote[]): Record<ClaseDefecto, number> & { pendientes: number; sinClase: number } {
  const porClase: Record<ClaseDefecto, Set<string>> = { critico: new Set(), mayor: new Set(), menor: new Set() };
  let pendientes = 0;
  let sinClase = 0;
  for (const r of resultados) {
    const v = String(r.veredicto ?? "pendiente").toLowerCase();
    if (v === "pendiente" || v === "") pendientes++;
    if (v !== "no_cumple") continue;
    const c = (CLASES_DEFECTO as readonly string[]).includes(String(r.claseDefecto)) ? (r.claseDefecto as ClaseDefecto) : "mayor";
    if (!r.claseDefecto) sinClase++;
    porClase[c].add(r.muestraId);
  }
  return { critico: porClase.critico.size, mayor: porClase.mayor.size, menor: porClase.menor.size, pendientes, sinClase };
}

/** Datos del encargo de la OT que conoce el muestreo (B-087). */
export interface EncargoParaMuestreo {
  lugarMuestreo?: string | null;
  item?: string | null;
  etTexto?: string | null;
  proveedor?: string | null;
  cantidad?: number | string | null;
  unidadCantidad?: string | null;
}

/**
 * B-087 · Precarga del formulario de muestreo con lo que ya sabe el encargo
 * (proveedor, lugar, producto y E.T., tamaño del lote): solo lo que el
 * formulario trae vacío; lo escrito manda.
 */
export function precargaMuestreo<T extends Record<string, unknown>>(dto: T, e: EncargoParaMuestreo | null | undefined): T {
  if (!e) return dto;
  const vacio = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  const txt = (v: unknown, max: number) => (vacio(v) ? null : String(v).trim().slice(0, max));
  const out: Record<string, unknown> = { ...dto };
  const producto = [txt(e.item, 240), txt(e.etTexto, 240)].filter(Boolean).join(" · ").slice(0, 240) || null;
  const lote = e.cantidad == null || e.cantidad === "" ? null : Number(String(e.cantidad).replace(",", "."));
  const prop: Record<string, unknown> = {
    lugar: txt(e.lugarMuestreo, 240),
    producto,
    proveedor: txt(e.proveedor, 240),
    tamanoLote: lote != null && Number.isInteger(lote) && lote > 0 ? lote : null,
    unidadPresentacion: txt(e.unidadCantidad, 40),
  };
  for (const [k, v] of Object.entries(prop)) if (v != null && vacio(out[k])) out[k] = v;
  return out as T;
}
