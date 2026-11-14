/**
 * Informe trimestral de encuestas de satisfacción · reglas PURAS
 * (informe-trimestral.spec.ts).
 *
 * Modelo: instrucción de trabajo DCO-PG01-P04-IT05 «Seguimiento de clientes»
 * del Departamento Comercial. Cada formulario (FORM01 a FORM05 e IDIC-PG03-FORM01)
 * tiene su anexo de informe (Anexos 01 a 06) con tres cuadros:
 *   1. Trimestre y año: total de encuestas contestadas, cuántas tienen índice de
 *      satisfacción sobre el umbral (85 %) y el porcentaje que representan.
 *   2. Ítemes: evaluación promedio (nota de 1 a 7) e índice promedio por pregunta.
 *   3. Laboratorio o sucursal: evaluación promedio e índice promedio.
 * La planilla de análisis del Departamento calcula, por encuesta, la suma, el
 * promedio de sus notas y el índice = promedio / nota máxima (7); por pregunta,
 * el promedio de las notas y el mismo índice. Se reproduce aquí sin redondear en
 * el cálculo: se redondea solo al mostrar (nota con un decimal, índice entero).
 *
 * El LIMS agrega, sin cambiar el anexo, el control de aplicación que pide la
 * instrucción (encuestas del trimestre, pendientes, sin respuesta, tasa de
 * respuesta, laboratorios sin ninguna encuesta contestada) y la referencia del
 * trimestre anterior.
 */
import type { RespuestaGuardada } from "./encuesta.reglas";

export type AgruparPor = "laboratorio" | "sucursal";

export interface TipoEncuesta {
  codigo: string;
  nombre: string;
  formulario: string;
  formularioRevision: string | null;
  instruccion: string;
  anexoNumero: string | null;
  anexoRevision: string | null;
  anexoEmision: string | null;
  tituloInforme: string;
  objetoInforme: string;
  agruparPor: AgruparPor;
  notaMaxima: number;
  umbralPct: number;
  distribucion: string[];
  orden: number;
}

export interface FilaEncuesta {
  id: string;
  tipo: string | null;
  estado: string;
  /** Fecha del servicio (AAAA-MM-DD): define el trimestre. */
  fecha: string;
  /** Laboratorio o sucursal (nombre). */
  grupo: string | null;
  /** OT, PIA, cotización u OT interna. */
  referencia: string | null;
  promedio: number | null;
  respuestas: RespuestaGuardada[] | null;
  comentario: string | null;
}

export const NOMBRE_TRIMESTRE = ["primer", "segundo", "tercer", "cuarto"] as const;
export const ETIQUETA_TRIMESTRE = ["1er", "2do", "3er", "4to"] as const;
export const MESES_TRIMESTRE = ["enero a marzo", "abril a junio", "julio a septiembre", "octubre a diciembre"] as const;

export function esTrimestre(t: unknown): t is 1 | 2 | 3 | 4 {
  return t === 1 || t === 2 || t === 3 || t === 4;
}

/** Trimestre (1–4) y año de una fecha AAAA-MM-DD. */
export function trimestreDe(fecha: string): { anio: number; trimestre: 1 | 2 | 3 | 4 } {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(fecha);
  if (!m) throw new Error(`Fecha inválida: ${fecha}`);
  const mes = Number(m[2]);
  return { anio: Number(m[1]), trimestre: (Math.floor((mes - 1) / 3) + 1) as 1 | 2 | 3 | 4 };
}

/** Rango [desde, hasta) del trimestre, en fechas AAAA-MM-DD. */
export function rangoTrimestre(anio: number, trimestre: number): { desde: string; hasta: string } {
  if (!esTrimestre(trimestre)) throw new Error("El trimestre debe ser 1, 2, 3 o 4.");
  const mes = (trimestre - 1) * 3 + 1;
  const desde = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const hasta = trimestre === 4 ? `${anio + 1}-01-01` : `${anio}-${String(mes + 3).padStart(2, "0")}-01`;
  return { desde, hasta };
}

export function trimestreAnterior(anio: number, trimestre: number): { anio: number; trimestre: 1 | 2 | 3 | 4 } {
  return trimestre === 1 ? { anio: anio - 1, trimestre: 4 } : { anio, trimestre: (trimestre - 1) as 1 | 2 | 3 | 4 };
}

/** Trimestre que se informa por defecto: el que acaba de cerrar (el informe se hace al inicio del siguiente). */
export function trimestrePorDefecto(hoy: string): { anio: number; trimestre: 1 | 2 | 3 | 4 } {
  const t = trimestreDe(hoy);
  return trimestreAnterior(t.anio, t.trimestre);
}

/** «tercer trimestre del año 2026». */
export function textoTrimestre(anio: number, trimestre: number): string {
  return `${NOMBRE_TRIMESTRE[trimestre - 1]} trimestre del año ${anio}`;
}

const media = (v: number[]): number | null => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const notas = (r: RespuestaGuardada[] | null | undefined): number[] =>
  (r ?? []).map((x) => x.valor).filter((x): x is number => typeof x === "number" && Number.isFinite(x));

/** Índice de satisfacción (%) = promedio / nota máxima × 100 (planilla del Depto. Comercial). */
export function indice(promedio: number | null, notaMaxima: number): number | null {
  if (promedio === null || !Number.isFinite(promedio) || !(notaMaxima > 0)) return null;
  return (promedio / notaMaxima) * 100;
}

/** Promedio de las notas de una encuesta (sin redondear); si no hay respuestas guardadas, el promedio registrado. */
export function promedioEncuesta(f: Pick<FilaEncuesta, "respuestas" | "promedio">): number | null {
  const n = notas(f.respuestas);
  if (n.length) return media(n);
  return f.promedio === null || f.promedio === undefined ? null : Number(f.promedio);
}

/** ¿El índice de la encuesta está sobre el umbral? Se cuenta «sobre» como mayor o igual (85 % cuenta). */
export function sobreUmbral(ind: number | null, umbralPct: number): boolean {
  return ind !== null && ind + 1e-9 >= umbralPct;
}

export interface ItemInforme {
  codigo: string;
  texto: string;
  respuestas: number;
  promedio: number | null;
  indice: number | null;
}
export interface GrupoInforme {
  grupo: string;
  contestadas: number;
  promedio: number | null;
  indice: number | null;
}
export interface DetalleEncuesta {
  id: string;
  referencia: string;
  grupo: string;
  valores: Record<string, number | null>;
  suma: number;
  promedio: number | null;
  indice: number | null;
  sobreUmbral: boolean;
}
export interface Observacion {
  referencia: string;
  grupo: string;
  texto: string;
}
export interface Resumen {
  contestadas: number;
  sobreUmbral: number;
  porcentajeSobreUmbral: number | null;
  promedio: number | null;
  indice: number | null;
}
export interface SeccionInforme {
  tipo: TipoEncuesta;
  /** Cuadro 1 del anexo. */
  resumen: Resumen;
  /** Control de aplicación (complemento del LIMS). */
  aplicacion: {
    total: number;
    contestadas: number;
    pendientes: number;
    sinRespuesta: number;
    /** contestadas / (contestadas + sin respuesta) × 100. */
    tasaRespuesta: number | null;
    /** Laboratorios o sucursales con encuestas en el trimestre y ninguna contestada. */
    gruposSinContestar: string[];
  };
  /** Cuadro 2 del anexo. */
  items: ItemInforme[];
  /** Cuadro 3 del anexo. */
  grupos: GrupoInforme[];
  /** Planilla de análisis: una columna por encuesta. */
  detalle: DetalleEncuesta[];
  observaciones: Observacion[];
  anterior: Resumen | null;
}

const SIN_GRUPO = { laboratorio: "Sin laboratorio", sucursal: "Sin sucursal" } as const;

function resumir(contestadas: FilaEncuesta[], tipo: TipoEncuesta): Resumen {
  const proms = contestadas.map(promedioEncuesta).filter((x): x is number => x !== null);
  const sobre = contestadas.filter((f) => sobreUmbral(indice(promedioEncuesta(f), tipo.notaMaxima), tipo.umbralPct)).length;
  const promedio = media(proms);
  return {
    contestadas: contestadas.length,
    sobreUmbral: sobre,
    porcentajeSobreUmbral: contestadas.length ? (sobre / contestadas.length) * 100 : null,
    promedio,
    indice: indice(promedio, tipo.notaMaxima),
  };
}

/** Calcula el anexo de un formulario con las encuestas del trimestre (y, si vienen, las del anterior). */
export function calcularSeccion(tipo: TipoEncuesta, filas: FilaEncuesta[], anteriores?: FilaEncuesta[]): SeccionInforme {
  const sinGrupo = SIN_GRUPO[tipo.agruparPor] ?? "Sin laboratorio";
  const contestadas = filas.filter((f) => f.estado === "registrada");

  // Ítemes en el orden en que aparecen en las respuestas (orden del formulario).
  const items = new Map<string, { texto: string; valores: number[] }>();
  for (const f of contestadas)
    for (const r of f.respuestas ?? []) {
      const it = items.get(r.codigo) ?? { texto: r.texto, valores: [] };
      if (typeof r.valor === "number" && Number.isFinite(r.valor)) it.valores.push(r.valor);
      items.set(r.codigo, it);
    }

  const grupos = new Map<string, number[]>();
  for (const f of contestadas) {
    const k = f.grupo?.trim() || sinGrupo;
    const p = promedioEncuesta(f);
    const arr = grupos.get(k) ?? [];
    if (p !== null) arr.push(p);
    grupos.set(k, arr);
  }

  const todosGrupos = new Set(filas.map((f) => f.grupo?.trim() || sinGrupo));
  const conRespuesta = new Set(contestadas.map((f) => f.grupo?.trim() || sinGrupo));
  const sinRespuesta = filas.filter((f) => f.estado === "sin_respuesta").length;

  return {
    tipo,
    resumen: resumir(contestadas, tipo),
    aplicacion: {
      total: filas.length,
      contestadas: contestadas.length,
      pendientes: filas.filter((f) => f.estado === "pendiente").length,
      sinRespuesta,
      tasaRespuesta: contestadas.length + sinRespuesta ? (contestadas.length / (contestadas.length + sinRespuesta)) * 100 : null,
      gruposSinContestar: [...todosGrupos].filter((g) => !conRespuesta.has(g)).sort((a, b) => a.localeCompare(b, "es")),
    },
    items: [...items].map(([codigo, it]) => {
      const promedio = media(it.valores);
      return { codigo, texto: it.texto, respuestas: it.valores.length, promedio, indice: indice(promedio, tipo.notaMaxima) };
    }),
    grupos: [...grupos]
      .map(([grupo, ps]) => {
        const promedio = media(ps);
        return { grupo, contestadas: ps.length, promedio, indice: indice(promedio, tipo.notaMaxima) };
      })
      .sort((a, b) => a.grupo.localeCompare(b.grupo, "es")),
    detalle: contestadas.map((f) => {
      const promedio = promedioEncuesta(f);
      const ind = indice(promedio, tipo.notaMaxima);
      return {
        id: f.id,
        referencia: f.referencia?.trim() || "—",
        grupo: f.grupo?.trim() || sinGrupo,
        valores: Object.fromEntries((f.respuestas ?? []).map((r) => [r.codigo, typeof r.valor === "number" ? r.valor : null])),
        suma: notas(f.respuestas).reduce((a, b) => a + b, 0),
        promedio,
        indice: ind,
        sobreUmbral: sobreUmbral(ind, tipo.umbralPct),
      };
    }),
    observaciones: contestadas
      .filter((f) => f.comentario?.trim())
      .map((f) => ({ referencia: f.referencia?.trim() || "—", grupo: f.grupo?.trim() || sinGrupo, texto: f.comentario!.trim() })),
    anterior: anteriores ? resumir(anteriores.filter((f) => f.estado === "registrada"), tipo) : null,
  };
}

export interface InformeTrimestral {
  anio: number;
  trimestre: 1 | 2 | 3 | 4;
  etiqueta: string;
  texto: string;
  desde: string;
  hasta: string;
  secciones: SeccionInforme[];
  /** Encuestas del trimestre sin formulario asignado (no entran en ningún anexo). */
  sinTipo: number;
}

/**
 * Arma el informe del trimestre: un anexo por formulario (o solo el pedido).
 * `filas` puede traer encuestas de otros trimestres: se separan por la fecha del
 * servicio; las del trimestre anterior dan la referencia de comparación.
 */
export function calcularInforme(
  tipos: TipoEncuesta[],
  filas: FilaEncuesta[],
  anio: number,
  trimestre: number,
  tipoFiltro?: string | null,
): InformeTrimestral {
  if (!esTrimestre(trimestre)) throw new Error("El trimestre debe ser 1, 2, 3 o 4.");
  const { desde, hasta } = rangoTrimestre(anio, trimestre);
  const ant = trimestreAnterior(anio, trimestre);
  const rAnt = rangoTrimestre(ant.anio, ant.trimestre);
  const enRango = (f: FilaEncuesta, r: { desde: string; hasta: string }) => f.fecha >= r.desde && f.fecha < r.hasta;
  const actuales = filas.filter((f) => enRango(f, { desde, hasta }));
  const anteriores = filas.filter((f) => enRango(f, rAnt));
  const elegidos = [...tipos].filter((t) => !tipoFiltro || t.codigo === tipoFiltro).sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo));
  return {
    anio,
    trimestre,
    etiqueta: `${ETIQUETA_TRIMESTRE[trimestre - 1]} TRIMESTRE ${anio}`,
    texto: textoTrimestre(anio, trimestre),
    desde,
    hasta,
    secciones: elegidos.map((t) =>
      calcularSeccion(
        t,
        actuales.filter((f) => f.tipo === t.codigo),
        anteriores.filter((f) => f.tipo === t.codigo),
      ),
    ),
    sinTipo: actuales.filter((f) => !f.tipo || !tipos.some((t) => t.codigo === f.tipo)).length,
  };
}

/** Nota con un decimal en formato chileno («6,8»); «—» si no hay. */
export function textoNota(v: number | null): string {
  return v === null ? "—" : (Math.round(v * 10) / 10).toFixed(1).replace(".", ",");
}

/** Índice o porcentaje entero («97 %»); «—» si no hay. */
export function textoPct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v)} %`;
}
