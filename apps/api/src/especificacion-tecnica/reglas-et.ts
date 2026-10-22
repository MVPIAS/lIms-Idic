/**
 * Especificaciones técnicas del cliente (E.T. / EETT) · reglas PURAS (sin BD):
 * reglas-et.spec.ts. Contrato: docs/FLUJO_ESPECIFICACIONES_MUESTREO.md.
 *
 *   · Biblioteca versionada (EP-05 5.1, EP-03 0.5): un código, varias versiones;
 *     solo una vigente. El borrador se edita; la vigente se congela y se cambia
 *     con «Nueva versión» (copia en borrador con versión + 1). Al publicar la
 *     nueva, la anterior queda «reemplazada»: las OT que la eligieron la
 *     conservan (la OT guarda la versión).
 *   · Cada punto: Punto · Componente · Característica · Ensayo (catálogo) ·
 *     Tipo [numérico · atributo · inspección · plan de clases] · Requisito
 *     (Mín/Nom/Máx o texto) · Unidad, más la segunda condición de la fila
 *     («X kgf con Y mm», EP-03 3.6) y la clase de defecto (EP-05 5.2).
 *   · La OT o la muestra eligen la E.T.; el requisito de cada ensayo sale del
 *     punto que le corresponde y queda marcado «E.T. <código> v<n> · punto <p>».
 */
import { tipoDatoDe, type TipoDato } from "../laboratorio/especificacion";
import { erroresCondicion2, erroresPlanClases, type Condicion2, type PlanClases } from "../laboratorio/requisito-compuesto";
import { CLASES_DEFECTO, type ClaseDefecto } from "../muestreo/nch44";

export const ESTADOS_ET = ["borrador", "vigente", "reemplazada", "anulada"] as const;
export type EstadoEt = (typeof ESTADOS_ET)[number];
export const ORIGENES_ET = ["cliente", "norma", "reglamento", "contrato"] as const;
export type OrigenEt = (typeof ORIGENES_ET)[number];
export const TIPOS_PUNTO = ["numerico", "atributo", "inspeccion", "clases"] as const;
export type TipoPunto = (typeof TIPOS_PUNTO)[number];

export const ETIQUETA_TIPO_PUNTO: Record<TipoPunto, string> = {
  numerico: "Numérico",
  atributo: "Atributo",
  inspeccion: "Inspección",
  clases: "Plan de clases (n, c, m, M)",
};

export interface PuntoEt {
  id?: string;
  orden?: number;
  punto: string;
  componente?: string | null;
  caracteristica: string;
  catMetodoId?: string | null;
  catAnalitoId?: string | null;
  laboratorioId?: string | null;
  tipo: TipoPunto;
  limiteInf?: string | null;
  nominal?: string | null;
  limiteSup?: string | null;
  unidad?: string | null;
  requisito?: string | null;
  cond2Etiqueta?: string | null;
  cond2Inf?: number | null;
  cond2Sup?: number | null;
  cond2Unidad?: string | null;
  planN?: number | null;
  planC?: number | null;
  planM?: number | null;
  planMM?: number | null;
  claseDefecto?: ClaseDefecto | null;
  observacion?: string | null;
}

const vacio = (v: unknown) => v == null || String(v).trim() === "";
const esNumero = (v: unknown) => /^\s*[+-]?(\d+([.,]\d+)?|[.,]\d+)\s*$/.test(String(v ?? ""));
const n = (v: unknown) => (esNumero(v) ? Number(String(v).trim().replace(",", ".")) : null);

/** Segunda condición del punto (null si no la tiene). */
export function condicion2De(p: PuntoEt): Condicion2 | null {
  if (vacio(p.cond2Etiqueta) && p.cond2Inf == null && p.cond2Sup == null) return null;
  return { etiqueta: String(p.cond2Etiqueta ?? "").trim(), inf: p.cond2Inf ?? null, sup: p.cond2Sup ?? null, unidad: p.cond2Unidad?.trim() || null };
}

/** Plan de clases del punto (null si no es de tipo «clases»). */
export function planDe(p: PuntoEt): PlanClases | null {
  if (p.tipo !== "clases") return null;
  return { n: p.planN as number, c: p.planC as number, m: p.planM as number, M: p.planMM ?? null };
}

/** Errores de un punto (para guardar el borrador o publicar). */
export function erroresPunto(p: PuntoEt, donde: string): string[] {
  const e: string[] = [];
  if (vacio(p.punto)) e.push(`${donde}: indique el punto de la E.T. (p. ej. «7.2.1»).`);
  if (vacio(p.caracteristica)) e.push(`${donde}: indique la característica.`);
  if (!(TIPOS_PUNTO as readonly string[]).includes(p.tipo)) e.push(`${donde}: tipo desconocido.`);
  if (p.claseDefecto != null && !(CLASES_DEFECTO as readonly string[]).includes(p.claseDefecto))
    e.push(`${donde}: la clase de defecto es crítico, mayor o menor.`);
  const cotas = [p.limiteInf, p.nominal, p.limiteSup];
  if (p.tipo === "numerico") {
    for (const [c, nombre] of [[p.limiteInf, "Mín"], [p.nominal, "Nom"], [p.limiteSup, "Máx"]] as const)
      if (!vacio(c) && !esNumero(c)) e.push(`${donde}: el ${nombre} de un punto numérico debe ser un número (use coma o punto decimal).`);
    const inf = n(p.limiteInf);
    const sup = n(p.limiteSup);
    if (inf != null && sup != null && inf > sup) e.push(`${donde}: el Mín no puede superar al Máx.`);
    if (cotas.every(vacio) && vacio(p.requisito)) e.push(`${donde}: indique el requisito (Mín, Nom, Máx o texto).`);
  }
  if ((p.tipo === "atributo" || p.tipo === "inspeccion") && cotas.every(vacio) && vacio(p.requisito))
    e.push(`${donde}: indique el requisito en texto (p. ej. «Sin costuras abiertas»).`);
  if (p.tipo === "clases") e.push(...erroresPlanClases(planDe(p), `${donde} · plan de clases`));
  const c2 = condicion2De(p);
  if (c2) {
    if (p.tipo !== "numerico") e.push(`${donde}: la segunda condición solo vale en un punto numérico.`);
    e.push(...erroresCondicion2(c2, `${donde} · segunda condición`));
  }
  if (!vacio(p.componente) && p.tipo === "inspeccion")
    e.push(`${donde}: una inspección es del producto, no de un componente (deje el componente vacío).`);
  if (!vacio(p.catAnalitoId) && vacio(p.catMetodoId)) e.push(`${donde}: indique el método del analito.`);
  return e;
}

/** Errores para publicar: al menos un punto, todos válidos y sin puntos repetidos. */
export function erroresPublicar(puntos: PuntoEt[]): string[] {
  const e: string[] = [];
  if (!puntos.length) e.push("La E.T. no tiene puntos: agregue al menos uno antes de publicarla.");
  puntos.forEach((p, i) => e.push(...erroresPunto(p, `Fila ${i + 1} (punto ${p.punto || "—"})`)));
  const claves = new Map<string, number>();
  puntos.forEach((p, i) => {
    if (!p.catAnalitoId && !p.catMetodoId) return;
    const k = `${(p.componente ?? "").trim().toLowerCase()}|${p.catAnalitoId ?? `m:${p.catMetodoId}`}`;
    if (claves.has(k))
      e.push(`Fila ${i + 1}: el mismo ensayo ya está en la fila ${claves.get(k)! + 1}${p.componente ? ` para el componente «${p.componente}»` : ""}; un ensayo tiene un solo requisito.`);
    else claves.set(k, i);
  });
  return e;
}

/* ------------------------------------------------------------ estados --- */

export type AccionEt = "editar" | "publicar" | "nueva_version" | "anular" | "subir_pdf";

/** ¿Se puede hacer la acción en el estado? null = sí; texto = por qué no. */
export function motivoNoPermitido(estado: EstadoEt, accion: AccionEt, opciones: { esUltima?: boolean; tienePdf?: boolean } = {}): string | null {
  switch (accion) {
    case "editar":
    case "publicar":
      return estado === "borrador" ? null : `La E.T. está ${estado}: solo se edita o publica un borrador. Para cambiarla, cree una nueva versión.`;
    case "nueva_version":
      if (estado === "borrador") return "Este borrador aún se puede editar: no hace falta otra versión.";
      if (estado === "anulada") return "La E.T. está anulada.";
      if (opciones.esUltima === false) return "Ya existe una versión posterior de esta E.T.: créela desde la última.";
      return null;
    case "anular":
      return estado === "anulada" ? "La E.T. ya está anulada." : estado === "reemplazada" ? "Una versión reemplazada no se anula: ya no se puede elegir." : null;
    case "subir_pdf":
      if (estado === "borrador") return null;
      if (estado === "vigente" && !opciones.tienePdf) return null;
      return "El PDF de una versión publicada no se cambia: cree una nueva versión.";
  }
}

/* --------------------------------------------------------- asignación --- */

export interface EtAsignable {
  estado: EstadoEt;
  reutilizable: boolean;
  clienteId: string | null;
  laboratorios: string[];
  codigo: string;
  version: number;
}

/**
 * ¿Se puede elegir la E.T. para una OT o muestra? Solo vigentes; una no
 * reutilizable, solo para OT de su cliente; con laboratorios, solo si el de
 * la OT está entre ellos.
 */
export function erroresAsignacion(et: EtAsignable, ot: { clienteId: string | null; unidadId: string | null }): string[] {
  const e: string[] = [];
  const nom = `${et.codigo} v${et.version}`;
  if (et.estado !== "vigente") e.push(`La E.T. ${nom} está ${et.estado}: solo se elige una versión vigente.`);
  if (!et.reutilizable && et.clienteId && et.clienteId !== ot.clienteId)
    e.push(`La E.T. ${nom} es de otro cliente y no es reutilizable.`);
  if (et.laboratorios.length && ot.unidadId && !et.laboratorios.includes(ot.unidadId))
    e.push(`La E.T. ${nom} no es de un laboratorio de esta OT.`);
  return e;
}

/** ¿El usuario gestiona la E.T.? Global siempre; si no, todos sus laboratorios en su alcance (una E.T. sin laboratorios es solo global). */
export function puedeGestionar(laboratorios: string[], filtro: string[] | null): boolean {
  if (filtro === null) return true;
  if (!laboratorios.length) return false;
  return laboratorios.every((l) => filtro.includes(l));
}

/** ¿El usuario ve la E.T.? Global; las generales (sin laboratorio); o alguna de sus laboratorios. */
export function puedeVer(laboratorios: string[], filtro: string[] | null): boolean {
  if (filtro === null || !laboratorios.length) return true;
  return laboratorios.some((l) => filtro.includes(l));
}

/* ------------------------------------------------- punto → resultado --- */

/** Texto de la fuente del requisito en pantallas e informes. */
export const fuenteDe = (codigo: string, version: number, punto: string) => `E.T. ${codigo} v${version} · punto ${punto}`;

export interface EspecDePunto {
  limiteInf: string | null;
  nominal: string | null;
  limiteSup: string | null;
  unidad: string | null;
  requisito: string | null;
  tipoDato: TipoDato;
  condicion2: Condicion2 | null;
  planClases: PlanClases | null;
  claseDefecto: ClaseDefecto | null;
}

const limpio = (v: unknown) => (vacio(v) ? null : String(v).trim());

/** Especificación que el punto pone en el resultado. */
export function especDePunto(p: PuntoEt): EspecDePunto {
  const requisito = limpio(p.requisito);
  const limiteInf = limpio(p.limiteInf);
  const nominal = limpio(p.nominal);
  const limiteSup = limpio(p.limiteSup);
  const tipoDato: TipoDato =
    p.tipo === "atributo" || p.tipo === "inspeccion" ? "atributo" : p.tipo === "clases" ? "numerico" : tipoDatoDe({ limiteInf, nominal, limiteSup, requisito });
  return {
    limiteInf: p.tipo === "clases" ? null : limiteInf,
    nominal: p.tipo === "clases" ? null : nominal,
    limiteSup: p.tipo === "clases" ? null : limiteSup,
    unidad: limpio(p.unidad),
    requisito,
    tipoDato,
    condicion2: condicion2De(p),
    planClases: planDe(p),
    claseDefecto: p.claseDefecto ?? null,
  };
}

/**
 * Punto de la E.T. que rige un ensayo de la muestra:
 *   · el del mismo analito y el mismo componente;
 *   · si no, el del método (sin analito) y el mismo componente, solo si el
 *     método tiene un único analito en la muestra (si tiene varios, el punto
 *     debe indicar el analito: se informa como «sin punto»).
 * El componente de la muestra (submuestra) debe coincidir con el del punto;
 * la muestra del producto usa los puntos sin componente.
 */
export function puntoDeEnsayo(
  puntos: PuntoEt[],
  ensayo: { catAnalitoId: string | null; catMetodoId: string | null },
  componente: string | null,
  analitosDelMetodoEnMuestra: number,
): PuntoEt | null {
  const comp = (componente ?? "").trim().toLowerCase();
  const delComp = puntos.filter((p) => (p.componente ?? "").trim().toLowerCase() === comp);
  const porAnalito = ensayo.catAnalitoId ? delComp.find((p) => p.catAnalitoId === ensayo.catAnalitoId) : undefined;
  if (porAnalito) return porAnalito;
  if (analitosDelMetodoEnMuestra !== 1) return null;
  return delComp.find((p) => !p.catAnalitoId && p.catMetodoId && p.catMetodoId === ensayo.catMetodoId) ?? null;
}

/* ------------------------------------------- desglose en componentes --- */

export interface PlanDesglose {
  /** Componentes con sus ensayos: cada uno será una submuestra. */
  componentes: { nombre: string; puntos: PuntoEt[]; metodoIds: string[] }[];
  /** Ensayos del producto (sin componente), sin contar las inspecciones. */
  producto: { puntos: PuntoEt[]; metodoIds: string[] };
  /** Checklist de inspecciones del producto (no son muestras). */
  inspecciones: { puntos: PuntoEt[]; metodoIds: string[] };
  /** Puntos que no tienen ensayo del catálogo: no se pueden capturar hasta vincularlos. */
  sinEnsayo: PuntoEt[];
}

const unicos = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];

/** Plan de ensayos del producto: árbol producto → componentes e inspecciones (EP-03 1.3). */
export function planDesglose(puntos: PuntoEt[]): PlanDesglose {
  const conEnsayo = puntos.filter((p) => p.catMetodoId);
  const sinEnsayo = puntos.filter((p) => !p.catMetodoId);
  const porComp = new Map<string, PuntoEt[]>();
  for (const p of conEnsayo) {
    const c = (p.componente ?? "").trim();
    if (!c) continue;
    const k = c.toLowerCase();
    (porComp.get(k) ?? porComp.set(k, []).get(k)!).push(p);
  }
  const componentes = [...porComp.values()].map((ps) => ({ nombre: ps[0].componente!.trim(), puntos: ps, metodoIds: unicos(ps.map((p) => p.catMetodoId)) }));
  const delProducto = conEnsayo.filter((p) => !(p.componente ?? "").trim());
  const insp = delProducto.filter((p) => p.tipo === "inspeccion");
  const prod = delProducto.filter((p) => p.tipo !== "inspeccion");
  return {
    componentes,
    producto: { puntos: prod, metodoIds: unicos(prod.map((p) => p.catMetodoId)) },
    inspecciones: { puntos: insp, metodoIds: unicos(insp.map((p) => p.catMetodoId)) },
    sinEnsayo,
  };
}

/** Código de una submuestra de componente: «<muestra>-C<k>» (k = siguiente libre). */
export function codigoSubmuestra(codigoMuestra: string, existentes: string[]): string {
  const re = new RegExp(`^${codigoMuestra.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-C(\\d+)$`);
  const usados = existentes.map((c) => re.exec(c)?.[1]).filter(Boolean).map(Number);
  const k = usados.length ? Math.max(...usados) + 1 : 1;
  return `${codigoMuestra}-C${k}`;
}

/** Nueva versión: versión siguiente a la mayor existente del código. */
export const siguienteVersion = (versiones: number[]) => (versiones.length ? Math.max(...versiones) + 1 : 1);
