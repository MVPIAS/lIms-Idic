/**
 * Formulario de cotización · costeo del laboratorio (DCO-PG01-P01-IT02-FORM05)
 * y Programa de trabajo (FORM06). Reglas puras (form05.spec.ts). EP-00 2.5.
 *
 * Siete secciones: 1 Viáticos · 2 Horas hombre (civil / militar) · 3 Servicios
 * estándar (EN de la lista) · 4 Horas máquina · 5 Pasajes · 6 Otros gastos ·
 * 7 Condiciones técnicas y restricciones. Montos finales con la estructura
 * oficial de la lista de precios 2026 (estructura-precio.ts): CDT, costo
 * indirecto (CI, antes «CFA»), CT = precio Ejército, recargo, neto = precio
 * particular sin IVA, IVA y precio particular con IVA.
 *
 * Viático = monto diario del país o zona × % del grado × días (tabla anual
 * DFZ). CI, recargo e IVA son parámetros (`circuito_cotizacion.cfa_pct`,
 * `.margen_particular_pct` e `.iva_pct`): 20 %, 30 % y 19 % según la lista de
 * precios oficial 2026 del IDIC (22-10-2026), que respondió EP-00 §10 P1.
 */
import { desdeCostoDirecto } from "./estructura-precio";

export interface Viatico { ambito: "nacional" | "extranjero"; zona: string; grado: string; dias: number; montoDiario: number; porcentaje: number }
export interface HoraHombre { tipo: "civil" | "militar"; categoria: string; horas: number; valorHora: number }
export interface ServicioEstandar { codigo: string; descripcion?: string; cantidad: number; valorUnitario: number }
export interface HoraMaquina { equipo: string; horas: number; valorHora: number }
export interface Pasaje { ambito: "nacional" | "extranjero"; tramo: string; cantidad: number; valorUnitario: number }
export interface OtroGasto { descripcion: string; monto: number; moneda: "CLP" | "USD" }

export interface Form05Entrada {
  viaticos?: Viatico[];
  horasHombre?: HoraHombre[];
  servicios?: ServicioEstandar[];
  horasMaquina?: HoraMaquina[];
  pasajes?: Pasaje[];
  otros?: OtroGasto[];
  /** Sección 7. */
  condiciones?: string | null;
  /** Valor del dólar para convertir los otros gastos en US$. */
  dolar?: number | null;
}

export interface Form05Resultado {
  secciones: { viaticos: number; horasHombre: number; servicios: number; horasMaquina: number; pasajes: number; otros: number };
  horasHombreTotal: number;
  cdt: number;
  cfaPct: number;
  cfa: number;
  ct: number;
  precioEjercito: number;
  margenParticularPct: number;
  recargo: number;
  /** Neto = CT + recargo: precio particular sin IVA. */
  precioParticular: number;
  ivaPct: number;
  iva: number;
  precioParticularIvaIncluido: number;
}

const r0 = (n: number) => Math.round(n);
const suma = <T>(xs: T[] | undefined, f: (x: T) => number) => (xs ?? []).reduce((a, x) => a + f(x), 0);

/** Viático de una fila: monto diario × % del grado × días. */
export const montoViatico = (v: Viatico) => v.montoDiario * (v.porcentaje / 100) * v.dias;

/** Errores de contenido del formulario (lo que zod no puede ver). */
export function erroresForm05(f: Form05Entrada): string[] {
  const e: string[] = [];
  const filas =
    (f.viaticos?.length ?? 0) + (f.horasHombre?.length ?? 0) + (f.servicios?.length ?? 0) +
    (f.horasMaquina?.length ?? 0) + (f.pasajes?.length ?? 0) + (f.otros?.length ?? 0);
  if (filas === 0) e.push("El formulario de costeo necesita al menos una fila en alguna de las secciones 1 a 6.");
  if ((f.otros ?? []).some((o) => o.moneda === "USD") && !(Number(f.dolar) > 0))
    e.push("Hay otros gastos en US$: indique el valor del dólar para convertirlos.");
  return e;
}

/**
 * Tipos de solicitud al laboratorio (EP-00 2.4/2.3, EP-05 0.2): fechas de un
 * servicio estándar, Formulario de costeo de uno no estandarizado, o costeo de
 * una comisión en terreno o en el extranjero (SEO, LAM, SVM: horas por rol,
 * viáticos, pasajes, traslados, arriendo y tipo de cambio en el FORM05).
 */
export const TIPOS_SERVICIO = ["estandar", "no_estandar", "comision"] as const;
export type TipoServicio = (typeof TIPOS_SERVICIO)[number];
/** ¿La respuesta exige el Formulario de costeo (FORM05)? */
export const exigeCosteo = (t: string | null | undefined) => t === "no_estandar" || t === "comision";

/** Unidades de reposición que se suman al lote del LRB (EP-05 0.2): cantidad cotizada = lote + reposición. */
export function cantidadConReposicion(lote: number, reposicion: number): number {
  const l = Math.max(0, Math.round(Number(lote) || 0));
  const r = Math.max(0, Math.round(Number(reposicion) || 0));
  return l + r;
}

export function calcularForm05(f: Form05Entrada, p: { cfaPct: number; margenParticularPct: number; ivaPct?: number }): Form05Resultado {
  const dolar = Number(f.dolar) > 0 ? Number(f.dolar) : 0;
  const secciones = {
    viaticos: r0(suma(f.viaticos, montoViatico)),
    horasHombre: r0(suma(f.horasHombre, (h) => h.horas * h.valorHora)),
    servicios: r0(suma(f.servicios, (s) => s.cantidad * s.valorUnitario)),
    horasMaquina: r0(suma(f.horasMaquina, (h) => h.horas * h.valorHora)),
    pasajes: r0(suma(f.pasajes, (x) => x.cantidad * x.valorUnitario)),
    otros: r0(suma(f.otros, (o) => (o.moneda === "USD" ? o.monto * dolar : o.monto))),
  };
  const cdt = Object.values(secciones).reduce((a, b) => a + b, 0);
  const ivaPct = p.ivaPct ?? 19;
  const e = desdeCostoDirecto(cdt, { ciPct: p.cfaPct, recargoPct: p.margenParticularPct, ivaPct });
  return {
    secciones,
    horasHombreTotal: Math.round(suma(f.horasHombre, (h) => h.horas) * 100) / 100,
    cdt,
    cfaPct: p.cfaPct,
    cfa: e.costoIndirecto,
    ct: e.costoTotal,
    precioEjercito: e.costoTotal,
    margenParticularPct: p.margenParticularPct,
    recargo: e.recargo,
    precioParticular: e.neto,
    ivaPct,
    iva: e.iva,
    precioParticularIvaIncluido: e.precioIvaIncluido,
  };
}

/* ------------------------------------------------------- Programa FORM06 --- */

export interface EtapaPrograma { actividad: string; inicio?: string | null; termino?: string | null; recursos?: string | null }
export interface ProgramaTrabajo {
  etapas: EtapaPrograma[];
  fechaInicio?: string | null;
  fechaTermino?: string | null;
  /** Plazo de entrega propuesto (días corridos). Obligatorio. */
  plazoEntregaDias: number;
  /** Programa de Trabajo del LEM (EP-05 0.2): puntos de la E.T. que se ensayan y nº de ítems. */
  puntosEt?: string | null;
  numItems?: number | null;
}

export function erroresPrograma(p: ProgramaTrabajo): string[] {
  const e: string[] = [];
  if (!(Number.isInteger(p.plazoEntregaDias) && p.plazoEntregaDias >= 1 && p.plazoEntregaDias <= 730))
    e.push("Plazo de entrega propuesto: entre 1 y 730 días corridos.");
  if (p.fechaInicio && p.fechaTermino && p.fechaTermino < p.fechaInicio)
    e.push("Programa de trabajo: la fecha de término es anterior a la de inicio.");
  if (p.numItems != null && !(Number.isInteger(p.numItems) && p.numItems >= 1))
    e.push("Programa de trabajo: el número de ítems debe ser un entero de 1 o más.");
  p.etapas.forEach((x, i) => {
    if (x.inicio && x.termino && x.termino < x.inicio) e.push(`Etapa ${i + 1} («${x.actividad}»): termina antes de empezar.`);
  });
  return e;
}
