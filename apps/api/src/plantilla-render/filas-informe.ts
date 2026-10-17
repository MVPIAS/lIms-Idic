/**
 * Contenido del informe de ensayo: filas, secciones numeradas, veredictos y
 * referencias. Funciones PURAS (sin BD ni HTML): filas-informe.spec.ts.
 *
 * Por fila el informe imprime: ensayo / característica, método, unidad,
 * requisito (Mín / Nom / Máx o texto; el de la ORDEN si se editó y si no el del
 * catálogo, marcando cuál es), resultado (número o atributo con su observación)
 * y veredicto. Antes el informe tomaba el analito y el límite del catálogo
 * ANTIGUO (`analito`, `norma_limite`) y los resultados del catálogo v2 (que
 * guardan `cat_analito_id` y su propia especificación) salían con «—» en el
 * nombre y en el límite de todas las filas.
 */
import { etiquetaVeredicto, normalizarVeredicto, type Veredicto } from "../laboratorio/veredicto";
import { esNumeroTexto, veredictoMuestra } from "../laboratorio/especificacion";
import { fmtNum } from "./html.util";
import type { ConfigInforme } from "./config-informe";

export type Modalidad = "cumplimiento" | "solo_resultados";
export const MODALIDADES: readonly Modalidad[] = ["cumplimiento", "solo_resultados"] as const;
export const NOMBRE_MODALIDAD: Record<Modalidad, string> = {
  cumplimiento: "Informe de cumplimiento (con requisito y veredicto)",
  solo_resultados: "Informe de solo resultados (sin requisito ni veredicto)",
};

/** Un resultado tal como lo necesita el informe (lo arma el servicio desde la BD). */
export interface ResultadoParaInforme {
  id: string;
  muestraId: string;
  muestraCodigo: string;
  muestraNombre?: string | null;
  /** Nombre del analito / característica (catálogo v2 o, en los antiguos, el analito legado). */
  ensayo: string | null;
  metodoNombre?: string | null;
  metodoNorma?: string | null;
  unidad?: string | null;
  limiteInf?: string | null;
  nominal?: string | null;
  limiteSup?: string | null;
  requisito?: string | null;
  /** 'orden' = especificación fijada o cambiada en esta OT; 'catalogo' = la copiada del catálogo. */
  especOrigen?: string | null;
  tipoDato?: string | null;
  valorNumerico?: number | null;
  valorTexto?: string | null;
  resultadoFinal?: number | null;
  promedio?: number | null;
  desviacion?: number | null;
  cv?: number | null;
  nReplicas?: number;
  observacion?: string | null;
  veredicto?: string | null;
  /** Estructura del informe (resultado_informe). */
  seccion?: string | null;
  componente?: string | null;
  orden?: number | null;
}

export interface FilaInforme {
  id: string;
  muestra: string;
  ensayo: string;
  metodo: string;
  unidad: string;
  requisito: string;
  requisitoOrigen: "orden" | "catalogo" | null;
  resultado: string;
  observacion: string;
  veredicto: Veredicto | null;
  veredictoTexto: string;
  desviacion: string;
  cv: string;
}

export interface ComponenteInforme {
  numero: string | null;
  titulo: string | null;
  filas: FilaInforme[];
}

export interface SeccionInforme {
  numero: string | null;
  titulo: string;
  componentes: ComponenteInforme[];
}

export interface VeredictoDeMuestra {
  codigo: string;
  nombre: string;
  veredicto: Veredicto;
  texto: string;
}

export interface Referencia {
  punto: string | null;
  titulo: string;
  ensayos: string[];
  texto: string;
}

export interface EstructuraInforme {
  modalidad: Modalidad;
  secciones: SeccionInforme[];
  veredictosMuestra: VeredictoDeMuestra[];
  veredictoOt: Veredicto;
  referencias: Referencia[];
  /** Alguna fila lleva el requisito fijado en la orden (se explica con una nota). */
  hayRequisitoDeOrden: boolean;
  mostrarEstadisticas: boolean;
  mostrarMuestra: boolean;
  /** Punto del informe de cada resultado (para el pie de las fotos). */
  puntoDe: Record<string, { punto: string | null; titulo: string }>;
}

/* ========================================================================== */
/* Requisito y resultado                                                      */
/* ========================================================================== */

const vacio = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
const aNumero = (v: string | null | undefined): number | null =>
  !vacio(v) && esNumeroTexto(v) ? Number(String(v).trim().replace(",", ".")) : null;
const fmtCota = (v: string | null | undefined): string => {
  const n = aNumero(v);
  return n === null ? String(v ?? "").trim() : fmtNum(n);
};

/** ¿El ensayo tiene requisito (alguna cota o texto)? */
export function tieneRequisito(r: Pick<ResultadoParaInforme, "limiteInf" | "nominal" | "limiteSup" | "requisito">): boolean {
  return [r.limiteInf, r.nominal, r.limiteSup, r.requisito].some((v) => !vacio(v));
}

/**
 * Texto del requisito:
 *   · texto («Tafetán», «100 % poliamida»), y si además hay cotas, entre paréntesis;
 *   · nominal con cotas simétricas → «10,5 ± 0,3»; asimétricas → «10,5 (10,2 – 10,8)»;
 *   · Mín y Máx → «6,5 – 8,5»; solo Mín → «Mín. 2,5»; solo Máx → «Máx. 0,05»;
 *   · solo nominal → el nominal («Lo declarado», «250»).
 */
export function textoRequisito(r: Pick<ResultadoParaInforme, "limiteInf" | "nominal" | "limiteSup" | "requisito">): string {
  const inf = vacio(r.limiteInf) ? null : String(r.limiteInf).trim();
  const nom = vacio(r.nominal) ? null : String(r.nominal).trim();
  const sup = vacio(r.limiteSup) ? null : String(r.limiteSup).trim();
  let cotas = "";
  const nInf = aNumero(inf);
  const nNom = aNumero(nom);
  const nSup = aNumero(sup);
  if (nom !== null && inf !== null && sup !== null) {
    if (nInf !== null && nNom !== null && nSup !== null && Math.abs(nSup - nNom - (nNom - nInf)) < 1e-9 && nSup > nNom) {
      cotas = `${fmtNum(nNom)} ± ${fmtNum(nSup - nNom)}`;
    } else cotas = `${fmtCota(nom)} (${fmtCota(inf)} – ${fmtCota(sup)})`;
  } else if (inf !== null && sup !== null) cotas = `${fmtCota(inf)} – ${fmtCota(sup)}`;
  else if (nom !== null && inf !== null) cotas = `${fmtCota(nom)} (mín. ${fmtCota(inf)})`;
  else if (nom !== null && sup !== null) cotas = `${fmtCota(nom)} (máx. ${fmtCota(sup)})`;
  else if (inf !== null) cotas = `Mín. ${fmtCota(inf)}`;
  else if (sup !== null) cotas = `Máx. ${fmtCota(sup)}`;
  else if (nom !== null) cotas = fmtCota(nom);
  const texto = vacio(r.requisito) ? "" : String(r.requisito).trim();
  if (texto && cotas) return `${texto} (${cotas})`;
  return texto || cotas;
}

/** Valor que se informa: número (fórmula, valor o promedio) o el texto observado. */
export function textoResultado(r: ResultadoParaInforme): string {
  const esAtributo = r.tipoDato === "atributo";
  if (!esAtributo) {
    const n = r.resultadoFinal ?? r.valorNumerico ?? r.promedio;
    if (n !== null && n !== undefined && Number.isFinite(Number(n))) return fmtNum(Number(n));
  }
  if (!vacio(r.valorTexto)) return String(r.valorTexto).trim();
  if (esAtributo) {
    const v = normalizarVeredicto(r.veredicto);
    if (v === "cumple" || v === "no_cumple") return etiquetaVeredicto(v);
  }
  return "Sin resultado";
}

/**
 * Método que se imprime: la norma si existe (con el nombre si aporta algo), si
 * no el nombre. En el catálogo heredado el campo «norma» a veces es solo una
 * categoría («Agua», «Cueros», «Gravimetria»): sin ningún dígito no es una
 * referencia normativa (ASTM D 629, NCh 409/2, DAL-PG01-IT06…) y no se imprime.
 */
export function textoMetodo(r: Pick<ResultadoParaInforme, "metodoNombre" | "metodoNorma" | "ensayo">): string {
  const nombre = vacio(r.metodoNombre) ? "" : String(r.metodoNombre).trim();
  const normaCruda = vacio(r.metodoNorma) ? "" : String(r.metodoNorma).trim();
  const norma = /\d/.test(normaCruda) ? normaCruda : "";
  if (!norma && !nombre) return normaCruda;
  const igual = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (norma && nombre) return igual(nombre, r.ensayo ?? "") || igual(nombre, norma) ? norma : `${nombre} (${norma})`;
  return norma || nombre;
}

/** Modalidad por defecto: cumplimiento si algún ensayo tiene requisito; si ninguno, solo resultados. */
export function modalidadSugerida(resultados: Pick<ResultadoParaInforme, "limiteInf" | "nominal" | "limiteSup" | "requisito">[]): Modalidad {
  return resultados.some(tieneRequisito) ? "cumplimiento" : "solo_resultados";
}

/* ========================================================================== */
/* Estructura: secciones, componentes y numeración                            */
/* ========================================================================== */

const etiquetaMuestra = (r: ResultadoParaInforme) =>
  `Muestra ${r.muestraCodigo}${vacio(r.muestraNombre) ? "" : ` · ${String(r.muestraNombre).trim()}`}`;

function fila(r: ResultadoParaInforme, modalidad: Modalidad): FilaInforme {
  const conRequisito = tieneRequisito(r);
  const v = normalizarVeredicto(r.veredicto);
  return {
    id: r.id,
    muestra: r.muestraCodigo,
    ensayo: vacio(r.ensayo) ? "Ensayo sin nombre en el catálogo" : String(r.ensayo).trim(),
    metodo: textoMetodo(r),
    unidad: vacio(r.unidad) ? "" : String(r.unidad).trim(),
    requisito: conRequisito ? textoRequisito(r) : "No especificado",
    requisitoOrigen: conRequisito ? (r.especOrigen === "orden" ? "orden" : "catalogo") : null,
    resultado: textoResultado(r),
    observacion: vacio(r.observacion) ? "" : String(r.observacion).trim(),
    veredicto: modalidad === "cumplimiento" ? v : null,
    veredictoTexto: modalidad === "cumplimiento" ? (v ? etiquetaVeredicto(v) : "Pendiente") : "",
    desviacion: r.desviacion === null || r.desviacion === undefined ? "" : fmtNum(r.desviacion),
    cv: r.cv === null || r.cv === undefined ? "" : fmtNum(r.cv, 2),
  };
}

/**
 * Arma el informe: agrupa (por muestra o por sección › componente), numera
 * desde `config.numeracion`, calcula el veredicto de cada muestra y de la OT y
 * las referencias de los No cumple (solo en modalidad cumplimiento).
 */
export function armarInforme(resultados: ResultadoParaInforme[], config: ConfigInforme, modalidad: Modalidad): EstructuraInforme {
  // Orden estable: posición fijada en la estructura del informe, luego la de llegada.
  const ordenados = resultados
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const oa = a.r.orden ?? Number.MAX_SAFE_INTEGER;
      const ob = b.r.orden ?? Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      const ma = a.r.muestraCodigo.localeCompare(b.r.muestraCodigo, "es", { numeric: true });
      return ma !== 0 ? ma : a.i - b.i;
    })
    .map((x) => x.r);

  const muestras = [...new Set(ordenados.map((r) => r.muestraId))];
  const varias = muestras.length > 1;
  const porSeccion = config.agrupacion === "seccion";

  const secciones: { titulo: string; comps: Map<string, { titulo: string | null; rs: ResultadoParaInforme[] }> }[] = [];
  const indice = new Map<string, number>();
  for (const r of ordenados) {
    const tituloSec = porSeccion && !vacio(r.seccion) ? String(r.seccion).trim() : etiquetaMuestra(r);
    const claveSec = porSeccion && !vacio(r.seccion) ? `s:${tituloSec.toLowerCase()}` : `m:${r.muestraId}`;
    let i = indice.get(claveSec);
    if (i === undefined) {
      i = secciones.push({ titulo: tituloSec, comps: new Map() }) - 1;
      indice.set(claveSec, i);
    }
    const tituloComp = porSeccion && !vacio(r.componente) ? String(r.componente).trim() : null;
    const claveComp = tituloComp ? tituloComp.toLowerCase() : "";
    const comps = secciones[i].comps;
    if (!comps.has(claveComp)) comps.set(claveComp, { titulo: tituloComp, rs: [] });
    comps.get(claveComp)!.rs.push(r);
  }

  const base = config.numeracion?.trim() || null;
  const puntoDe: EstructuraInforme["puntoDe"] = {};
  const referencias: Referencia[] = [];
  const salida: SeccionInforme[] = secciones.map((s, si) => {
    const numSec = base ? `${base}.${si + 1}` : null;
    let nComp = 0;
    const componentes: ComponenteInforme[] = [...s.comps.values()].map((c) => {
      const numComp = c.titulo && numSec ? `${numSec}.${++nComp}` : c.titulo ? null : numSec;
      const filas = c.rs.map((r) => fila(r, modalidad));
      const titulo = c.titulo ?? s.titulo;
      for (const r of c.rs) puntoDe[r.id] = { punto: numComp, titulo };
      if (modalidad === "cumplimiento") {
        const noCumplen = filas.filter((f) => f.veredicto === "no_cumple").map((f) => f.ensayo);
        if (noCumplen.length) {
          const ensayos = [...new Set(noCumplen)];
          referencias.push({
            punto: numComp,
            titulo,
            ensayos,
            texto: `${numComp ? `Punto ${numComp} ` : ""}${titulo} no cumple con ${unirY(ensayos)}.`,
          });
        }
      }
      return { numero: c.titulo ? numComp : null, titulo: c.titulo, filas };
    });
    return { numero: numSec, titulo: s.titulo, componentes };
  });

  const veredictosMuestra: VeredictoDeMuestra[] = muestras.map((id) => {
    const rs = ordenados.filter((r) => r.muestraId === id);
    const v = veredictoMuestra(rs.map((r) => r.veredicto));
    return {
      codigo: rs[0].muestraCodigo,
      nombre: vacio(rs[0].muestraNombre) ? "" : String(rs[0].muestraNombre).trim(),
      veredicto: v,
      texto: etiquetaVeredicto(v),
    };
  });

  const mostrarEstadisticas =
    config.estadisticas === "siempre" ||
    (config.estadisticas === "auto" && ordenados.some((r) => (r.nReplicas ?? 0) > 1 && r.tipoDato !== "atributo"));

  return {
    modalidad,
    secciones: salida,
    veredictosMuestra,
    veredictoOt: veredictoMuestra(veredictosMuestra.map((m) => m.veredicto)),
    referencias,
    hayRequisitoDeOrden: modalidad === "cumplimiento" && ordenados.some((r) => tieneRequisito(r) && r.especOrigen === "orden"),
    mostrarEstadisticas,
    mostrarMuestra: porSeccion && varias,
    puntoDe,
  };
}

/** «a», «a y b», «a, b y c». */
export function unirY(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}
