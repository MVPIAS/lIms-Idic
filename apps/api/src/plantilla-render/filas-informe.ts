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
import { textoCondicion2, type Condicion2 } from "../laboratorio/requisito-compuesto";
import type { ConfigInforme } from "./config-informe";
import type { FilaInspeccion } from "./template.engine";
import { ZONA_CHILE } from "../common/fecha-chile";

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
  /** Segunda condición del requisito compuesto de la E.T. («con Alargamiento ≥ 30 %», B-025). */
  condicion2?: Condicion2 | null;
  /** Valor medido de la segunda condición. */
  valorCondicion2?: number | null;
  /** Ensayo derivado a otro laboratorio por orden interna (B-075): quién lo hizo y con qué orden. */
  derivadoA?: { laboratorio: string; ordenInterna: string | null } | null;
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
  /** Fecha y hora en que se ejecutó el ensayo (captura con equipo). */
  fechaEnsayo?: Date | string | null;
  /** Nº de sello de la muestra (columna «Sello Nº» de Dimensiones, EP-03 3.4). */
  selloNumero?: string | null;
  /** Estructura del informe (resultado_informe). */
  seccion?: string | null;
  componente?: string | null;
  orden?: number | null;
}

export interface FilaInforme {
  id: string;
  muestra: string;
  /** Cotas por separado (columnas Mínimo / Máximo); vacías si no hay. */
  minimo: string;
  maximo: string;
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
  sello: string;
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

/** Cota tal como se escribió, con coma decimal («0.00» → «0,00»); vacía si no hay. */
const textoCota = (v: string | null | undefined): string =>
  vacio(v) ? "" : String(v).trim().replace(/^([+-]?\d+)\.(\d+)$/, "$1,$2");

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
export function textoRequisito(
  r: Pick<ResultadoParaInforme, "limiteInf" | "nominal" | "limiteSup" | "requisito"> & { condicion2?: Condicion2 | null; unidad?: string | null },
): string {
  const base = textoRequisitoSimple(r);
  // B-025: el requisito compuesto de la E.T. se imprime completo («Mín. 1,5 kgf/mm² con Alargamiento ≥ 30 %»).
  if (!r.condicion2?.etiqueta) return base;
  const u = vacio(r.unidad) ? "" : ` ${String(r.unidad).trim()}`;
  return `${base}${base && !vacio(r.requisito) ? "" : u} ${textoCondicion2(r.condicion2)}`.trim();
}

function textoRequisitoSimple(r: Pick<ResultadoParaInforme, "limiteInf" | "nominal" | "limiteSup" | "requisito">): string {
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
  // B-075: si el texto ya dice las cotas («Máx. 0,5 % (…)»), no se repiten entre paréntesis.
  const yaLasDice = [inf, nom, sup].filter((x): x is string => x !== null).every((x) => contieneCota(texto, x));
  if (texto && cotas && !yaLasDice) return `${texto} (${cotas})`;
  return texto || cotas;
}

/** ¿El texto del requisito ya trae la cota (con coma o punto decimal)? */
function contieneCota(texto: string, cota: string): boolean {
  const n = aNumero(cota);
  const formas = new Set([cota, cota.replace(".", ","), cota.replace(",", "."), ...(n !== null ? [fmtNum(n), String(n), String(n).replace(".", ",")] : [])]);
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...formas].some((f) => !!f && new RegExp("(^|[^\\d,.])" + esc(f) + "($|[^\\d])").test(texto));
}

/**
 * Texto del requisito con su unidad cuando la tabla no tiene columna «Unidad»
 * (B-075, Anexo 02-02: «Mín. 97 %»). No la repite si ya figura en el texto.
 */
export function requisitoConUnidad(requisito: string, unidad: string | null | undefined): string {
  const u = vacio(unidad) ? "" : String(unidad).trim();
  if (!u || !/\d/.test(requisito) || requisito.includes(u)) return requisito;
  return `${requisito} ${u}`;
}

/**
 * Valor numérico que se informa de un ensayo: el resultado final (fórmula y
 * factor aplicados), si no el valor capturado y, solo a falta de ambos, el
 * promedio de las réplicas. Es el mismo valor con el que se calculó el
 * veredicto: el promedio crudo NUNCA va antes que el resultado final. Lo usan
 * el informe de ensayo, la tabla de inspección BPCH y el dictamen de prototipos.
 */
export function valorInformado<T>(r: { resultadoFinal?: T | null; valorNumerico?: T | null; promedio?: T | null }): T | null {
  return r.resultadoFinal ?? r.valorNumerico ?? r.promedio ?? null;
}

/** Valor que se informa: número (fórmula, valor o promedio) o el texto observado. */
export function textoResultado(r: ResultadoParaInforme): string {
  const esAtributo = r.tipoDato === "atributo";
  if (!esAtributo) {
    const n = valorInformado(r);
    if (n !== null && n !== undefined && Number.isFinite(Number(n))) {
      const c2 = r.condicion2?.etiqueta && r.valorCondicion2 != null && Number.isFinite(Number(r.valorCondicion2))
        ? ` · ${r.condicion2.etiqueta} ${fmtNum(Number(r.valorCondicion2))}${r.condicion2.unidad ? ` ${r.condicion2.unidad}` : ""}`
        : "";
      return `${fmtNum(Number(n))}${c2}`;
    }
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
    // Las cotas por separado se imprimen como se escribieron (decimales incluidos: «0,00»).
    minimo: textoCota(r.limiteInf),
    maximo: textoCota(r.limiteSup),
    ensayo:
      (vacio(r.ensayo) ? "Ensayo sin nombre en el catálogo" : String(r.ensayo).trim()) +
      (r.derivadoA?.laboratorio
        ? ` (realizado por ${r.derivadoA.laboratorio}${r.derivadoA.ordenInterna ? `, orden interna ${r.derivadoA.ordenInterna}` : ""})`
        : ""),
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
    sello: vacio(r.selloNumero) ? "" : String(r.selloNumero).trim(),
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
  const unica = config.agrupacion === "unica";

  const secciones: { titulo: string; comps: Map<string, { titulo: string | null; rs: ResultadoParaInforme[] }> }[] = [];
  const indice = new Map<string, number>();
  for (const r of ordenados) {
    const tituloSec = unica ? "" : porSeccion && !vacio(r.seccion) ? String(r.seccion).trim() : etiquetaMuestra(r);
    const claveSec = unica ? "u" : porSeccion && !vacio(r.seccion) ? `s:${tituloSec.toLowerCase()}` : `m:${r.muestraId}`;
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
    mostrarMuestra: config.columnaMuestra || ((porSeccion || unica) && varias),
    puntoDe,
  };
}

/* ========================================================================== */
/* Normas y métodos con la fecha del análisis (IDIC-PG09 Anexo 02-02, 3.1)     */
/* ========================================================================== */

export interface FilaMetodo {
  analisis: string;
  metodo: string;
  /** Fechas y horas en que se ejecutó (desde – hasta), o «—» si no se registró. */
  fechas: string;
}

const dosDigitos = (n: number) => String(n).padStart(2, "0");
const MESES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
/** «20.AGO.25 (08:30)» en hora de Chile, como el informe del LME. */
function fechaAnalisis(d: Date): string {
  const p = new Intl.DateTimeFormat("es-CL", {
    timeZone: ZONA_CHILE, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return `${dosDigitos(v("day"))}.${MESES[v("month") - 1]}.${String(v("year")).slice(-2)} (${dosDigitos(v("hour") % 24)}:${dosDigitos(v("minute"))})`;
}

/**
 * Tabla «Análisis · Método · Fecha del análisis»: un renglón por ensayo y
 * método, con la primera y la última fecha y hora en que se ejecutó (las
 * registra la captura con equipo). Sin fecha registrada, «—».
 */
export function filasMetodos(resultados: ResultadoParaInforme[]): FilaMetodo[] {
  const grupos = new Map<string, { analisis: string; metodo: string; fechas: Date[] }>();
  for (const r of resultados) {
    const analisis = vacio(r.ensayo) ? "Ensayo sin nombre en el catálogo" : String(r.ensayo).trim();
    const metodo = textoMetodo(r);
    const clave = `${analisis.toLowerCase()}|${metodo.toLowerCase()}`;
    const g = grupos.get(clave) ?? { analisis, metodo, fechas: [] };
    if (r.fechaEnsayo) {
      const d = new Date(r.fechaEnsayo);
      if (!Number.isNaN(d.getTime())) g.fechas.push(d);
    }
    grupos.set(clave, g);
  }
  return [...grupos.values()].map((g) => {
    const orden = g.fechas.sort((a, b) => a.getTime() - b.getTime());
    const fechas = !orden.length
      ? "—"
      : orden.length === 1 || orden[0].getTime() === orden[orden.length - 1].getTime()
        ? fechaAnalisis(orden[0])
        : `${fechaAnalisis(orden[0])} – ${fechaAnalisis(orden[orden.length - 1])}`;
    return { analisis: g.analisis, metodo: g.metodo, fechas };
  });
}

/** «a», «a y b», «a, b y c». */
export function unirY(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

/** Lo que necesita una fila de {{tabla_inspeccion}} (documentos BPCH). */
export interface ResultadoInspeccion {
  catAnalito?: { nombre?: string | null } | null;
  analito?: { nombre?: string | null } | null;
  muestra?: { codigo?: string | null } | null;
  limiteInf?: unknown;
  limiteSup?: unknown;
  unidad?: string | null;
  valorTexto?: string | null;
  veredicto?: string | null;
  resultadoFinal?: unknown;
  valorNumerico?: unknown;
  promedio?: unknown;
}

/**
 * Fila de la tabla de inspección BPCH: inspección, mínimo, máximo, resultado
 * (el valor informado, el mismo con el que se calculó la condición), unidad y
 * condición. `lim` = límites del analito si el ensayo no los trae.
 */
export function filaInspeccion(r: ResultadoInspeccion, lim?: { limiteInf?: unknown; limiteSup?: unknown; unidad?: string | null } | null): FilaInspeccion {
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? "" : fmtNum(String(v)));
  const valor = valorInformado(r);
  return {
    inspeccion: r.catAnalito?.nombre ?? r.analito?.nombre ?? "",
    muestra: r.muestra?.codigo ?? "",
    minimo: num(r.limiteInf ?? lim?.limiteInf),
    maximo: num(r.limiteSup ?? lim?.limiteSup),
    resultado: valor !== null && valor !== undefined ? num(valor) : r.valorTexto ?? "",
    unidad: r.unidad ?? lim?.unidad ?? "",
    condicion: etiquetaVeredicto(r.veredicto),
  };
}
