/**
 * Formulario de cotización · costeo del laboratorio (DCO-PG01-P01-IT02-FORM05)
 * y Programa de trabajo (FORM06). Reglas puras (form05.spec.ts). EP-00 2.5.
 *
 * Siete secciones: 1 Viáticos · 2 Horas hombre (civil / militar) · 3 Servicios
 * estándar (EN de la lista) · 4 Horas máquina · 5 Pasajes · 6 Otros gastos ·
 * 7 Insumos y reactivos (contrato 4.1.4: consumibles del inventario con su
 * costo de referencia, o escritos a mano) · 8 Condiciones técnicas y
 * restricciones. Las cotizaciones guardadas antes de la sección 7 no la traen:
 * cuenta 0 (compatibles). Montos finales con la estructura
 * oficial de la lista de precios 2026 (estructura-precio.ts): CDT, costo
 * indirecto (CI, antes «CFA»), CT, recargo, neto = precio particular sin IVA,
 * IVA y precio particular con IVA. Precio Ejército: el CT o, con el parámetro
 * `precio_ejercito` = «costo_directo» (política de precios DCO-PG01-P05-IT05),
 * el costo directo sin las horas hombre militares.
 *
 * Cuarto envío del IDIC (18-11-2026, formulario real FORM-…/003): los
 * viáticos y pasajes al EXTRANJERO pueden ir en US$ (moneda por fila; sin
 * moneda = CLP, como los guardados antes) y se convierten con el dólar del
 * formulario, que lleva su fecha (tipo de cambio «del dd-mm-aaaa»). Los montos
 * finales se muestran en $ y en US$ (US$ = $ / dólar). Se muestran los dos
 * «Precio Ejército» del formulario real: nota 3 = CT sin la H.H. militar pero
 * con su CFA; nota 4 = costo directo sin CFA (y sin la H.H. militar, como la
 * política de precios). El parámetro `precio_ejercito` sigue decidiendo cuál se
 * aplica a la cotización (`precioEjercito`, sin cambios).
 *
 * Viático = monto diario del país o zona × % del grado × días (tabla anual
 * DFZ). CI, recargo e IVA son parámetros (`circuito_cotizacion.cfa_pct`,
 * `.margen_particular_pct` e `.iva_pct`): 20 %, 30 % y 19 % según la lista de
 * precios oficial 2026 del IDIC (22-10-2026), que respondió EP-00 §10 P1.
 *
 * Quinto envío (21-11-2026, Formularios Ejército 1–4): la línea «IVA 19 %» de
 * Otros gastos = IVA % × (viáticos + H.H. civil + otros gastos en $). No la
 * llevan los servicios estándar (ya tienen IVA), la H.H. militar, los pasajes,
 * las horas máquina ni los insumos; los equipos se ingresan como «otros gastos»
 * (así entran en la base). Con `ivaGastos` el sistema la calcula y la suma a
 * «Otros gastos en pesos» (y al CDT), como en el formulario real
 * FORM-2026-14620/001: 19 % × (3.321.220 + 1.448.160 + 2.455.494) = 1.372.726.
 */
import { alPeso, desdeCostoDirecto } from "./estructura-precio";

/** Moneda de una fila: CLP (por defecto) o USD (solo viáticos y pasajes al extranjero, y otros gastos). */
export type MonedaCosteo = "CLP" | "USD";
export interface Viatico { ambito: "nacional" | "extranjero"; zona: string; grado: string; dias: number; montoDiario: number; porcentaje: number; moneda?: MonedaCosteo | null }
export interface HoraHombre { tipo: "civil" | "militar"; categoria: string; horas: number; valorHora: number }
export interface ServicioEstandar { codigo: string; descripcion?: string; cantidad: number; valorUnitario: number }
export interface HoraMaquina { equipo: string; horas: number; valorHora: number }
export interface Pasaje { ambito: "nacional" | "extranjero"; tramo: string; cantidad: number; valorUnitario: number; moneda?: MonedaCosteo | null }
export interface OtroGasto { descripcion: string; monto: number; moneda: "CLP" | "USD" }
/** Contrato 4.1.4 · insumo o reactivo: del inventario (consumibleId) o escrito a mano. Costo en CLP por unidad. */
export interface Insumo { consumibleId?: string | null; codigo?: string | null; descripcion: string; unidad?: string | null; cantidad: number; costoUnitario: number }

export interface Form05Entrada {
  viaticos?: Viatico[];
  horasHombre?: HoraHombre[];
  servicios?: ServicioEstandar[];
  horasMaquina?: HoraMaquina[];
  pasajes?: Pasaje[];
  otros?: OtroGasto[];
  /** Sección 7 · insumos y reactivos (contrato 4.1.4). */
  insumos?: Insumo[];
  /** Sección 8. */
  condiciones?: string | null;
  /** Tipo de cambio: valor del dólar (en pesos) para convertir los montos en US$. */
  dolar?: number | null;
  /** Fecha del tipo de cambio (AAAA-MM-DD). Exigida si hay montos en US$. */
  dolarFecha?: string | null;
  /** Agregar la línea «IVA 19 %» de otros gastos (quinto envío). Sin indicar = no (costeos guardados antes). */
  ivaGastos?: boolean | null;
}

/** Montos del formulario por concepto, en pesos (líneas de «Montos finales» del formulario real). */
export interface DetalleForm05 {
  viaticosNacionales: number;
  viaticosExtranjero: number;
  horasHombreCivil: number;
  horasHombreMilitar: number;
  servicios: number;
  horasMaquina: number;
  pasajesNacionales: number;
  pasajesExtranjero: number;
  otrosPesos: number;
  otrosDolar: number;
  insumos: number;
}

/** Montos finales en US$ (US$ = $ / dólar, 3 decimales como el formulario real). */
export interface MontosUsd {
  detalle: DetalleForm05;
  cdt: number;
  cfa: number;
  ct: number;
  precioEjercito: number;
  precioEjercitoCt: number;
  precioEjercitoCostoDirecto: number;
  recargo: number;
  precioParticular: number;
  iva: number;
  precioParticularIvaIncluido: number;
}

export interface Form05Resultado {
  secciones: { viaticos: number; horasHombre: number; servicios: number; horasMaquina: number; pasajes: number; otros: number; insumos: number };
  horasHombreTotal: number;
  cdt: number;
  cfaPct: number;
  cfa: number;
  ct: number;
  /** Precio Ejército que se aplica a la cotización (parámetro `precio_ejercito`). */
  precioEjercito: number;
  /** Cuál de los dos se aplica: «costo_directo» (nota 4) o «costo_total» (el CT). */
  precioEjercitoAplicado: "costo_directo" | "costo_total";
  /** Nota 3 del formulario real: CT sin la H.H. militar, pero con el CFA asociado a ella. */
  precioEjercitoCt: number;
  /** Nota 4 del formulario real: costo directo sin CFA (y sin la H.H. militar). */
  precioEjercitoCostoDirecto: number;
  /** H.H. militar (en pesos) que no se cobra en los precios Ejército. */
  horasHombreMilitar: number;
  margenParticularPct: number;
  recargo: number;
  /** Neto = CT + recargo: precio particular sin IVA. */
  precioParticular: number;
  ivaPct: number;
  iva: number;
  precioParticularIvaIncluido: number;
  /** Montos por concepto, en pesos. */
  detalle: DetalleForm05;
  /** Tipo de cambio usado (null si no se indicó) y su fecha. */
  dolar: number | null;
  dolarFecha: string | null;
  /** Montos finales en US$ (null sin dólar). */
  usd: MontosUsd | null;
  /** Línea «IVA 19 %» de otros gastos (0 si no se pidió) y su base (viáticos + H.H. civil + otros gastos en $). */
  ivaGastos: number;
  baseIvaGastos: number;
}

/** Línea «IVA %» de otros gastos: IVA % × (viáticos + H.H. civil + otros gastos en $), en pesos y redondeada. */
export function lineaIvaGastos(base: { viaticos: number; horasHombreCivil: number; otrosPesos: number }, ivaPct: number): { base: number; iva: number } {
  const b = Math.round(base.viaticos) + Math.round(base.horasHombreCivil) + Math.round(base.otrosPesos);
  return { base: b, iva: Math.round((b * ivaPct) / 100) };
}

const r0 = (n: number) => Math.round(n);
const suma = <T>(xs: T[] | undefined, f: (x: T) => number) => (xs ?? []).reduce((a, x) => a + f(x), 0);

/** Viático de una fila, en su moneda: monto diario × % del grado × días. */
export const montoViatico = (v: Viatico) => v.montoDiario * (v.porcentaje / 100) * v.dias;

/** ¿La fila está en dólares? (sin moneda = CLP: compatibilidad con lo guardado antes). */
export const enUsd = (x: { moneda?: string | null }) => x.moneda === "USD";

/** Monto de una fila llevado a pesos: si está en US$, × dólar. */
export const aPesos = (monto: number, moneda: string | null | undefined, dolar: number) => (moneda === "USD" ? monto * dolar : monto);

/** Pesos → US$ con 3 decimales (como el formulario real). */
export const aUsd = (pesos: number, dolar: number) => Math.round((pesos / dolar) * 1000) / 1000;

/** Insumo de una fila: cantidad × costo unitario (CLP). */
export const montoInsumo = (x: Pick<Insumo, "cantidad" | "costoUnitario">) => (Number(x.cantidad) || 0) * (Number(x.costoUnitario) || 0);

/** Errores de contenido del formulario (lo que zod no puede ver). */
export function erroresForm05(f: Form05Entrada): string[] {
  const e: string[] = [];
  const filas =
    (f.viaticos?.length ?? 0) + (f.horasHombre?.length ?? 0) + (f.servicios?.length ?? 0) +
    (f.horasMaquina?.length ?? 0) + (f.pasajes?.length ?? 0) + (f.otros?.length ?? 0) + (f.insumos?.length ?? 0);
  if (filas === 0) e.push("El formulario de costeo necesita al menos una fila en alguna de las secciones 1 a 7.");
  if ([...(f.viaticos ?? []), ...(f.pasajes ?? [])].some((x) => enUsd(x) && x.ambito !== "extranjero"))
    e.push("Los viáticos y pasajes nacionales van en pesos: solo los del extranjero pueden ir en US$.");
  const hayUsd = (f.otros ?? []).some(enUsd) || (f.viaticos ?? []).some(enUsd) || (f.pasajes ?? []).some(enUsd);
  if (hayUsd && !(Number(f.dolar) > 0))
    e.push("Hay montos en US$ (viáticos o pasajes al extranjero, u otros gastos): indique el valor del dólar para convertirlos.");
  if (hayUsd && !/^\d{4}-\d{2}-\d{2}$/.test(String(f.dolarFecha ?? "")))
    e.push("Indique la fecha del tipo de cambio del dólar.");
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

export function calcularForm05(f: Form05Entrada, p: { cfaPct: number; margenParticularPct: number; ivaPct?: number; precioEjercito?: string }): Form05Resultado {
  const dolar = Number(f.dolar) > 0 ? Number(f.dolar) : 0;
  const viatico = (v: Viatico) => aPesos(montoViatico(v), v.moneda, dolar);
  const pasaje = (x: Pasaje) => aPesos(x.cantidad * x.valorUnitario, x.moneda, dolar);
  const hh = (h: HoraHombre) => h.horas * h.valorHora;
  const ivaPct = p.ivaPct ?? 19;
  const hhCivil = r0(suma(f.horasHombre, (h) => (h.tipo === "militar" ? 0 : hh(h))));
  const otrosPesosFilas = r0(suma(f.otros, (o) => (enUsd(o) ? 0 : o.monto)));
  const lineaIva = f.ivaGastos
    ? lineaIvaGastos({ viaticos: r0(suma(f.viaticos, viatico)), horasHombreCivil: hhCivil, otrosPesos: otrosPesosFilas }, ivaPct)
    : { base: 0, iva: 0 };
  const secciones = {
    viaticos: r0(suma(f.viaticos, viatico)),
    horasHombre: r0(suma(f.horasHombre, hh)),
    servicios: r0(suma(f.servicios, (s) => s.cantidad * s.valorUnitario)),
    horasMaquina: r0(suma(f.horasMaquina, (h) => h.horas * h.valorHora)),
    pasajes: r0(suma(f.pasajes, pasaje)),
    otros: r0(suma(f.otros, (o) => aPesos(o.monto, o.moneda, dolar))) + lineaIva.iva,
    insumos: r0(suma(f.insumos, montoInsumo)),
  };
  const cdt = Object.values(secciones).reduce((a, b) => a + b, 0);
  const e = desdeCostoDirecto(cdt, { ciPct: p.cfaPct, recargoPct: p.margenParticularPct, ivaPct });
  const de = <T extends { ambito: string }>(xs: T[] | undefined, ambito: string, f: (x: T) => number) => r0(suma((xs ?? []).filter((x) => x.ambito === ambito), f));
  const hhMilitar = suma(f.horasHombre, (h) => (h.tipo === "militar" ? hh(h) : 0));
  const detalle: DetalleForm05 = {
    viaticosNacionales: de(f.viaticos, "nacional", viatico),
    viaticosExtranjero: de(f.viaticos, "extranjero", viatico),
    horasHombreCivil: hhCivil,
    horasHombreMilitar: r0(hhMilitar),
    servicios: secciones.servicios,
    horasMaquina: secciones.horasMaquina,
    pasajesNacionales: de(f.pasajes, "nacional", pasaje),
    pasajesExtranjero: de(f.pasajes, "extranjero", pasaje),
    otrosPesos: otrosPesosFilas + lineaIva.iva,
    otrosDolar: r0(suma(f.otros, (o) => (enUsd(o) ? o.monto * dolar : 0))),
    insumos: secciones.insumos,
  };
  // Formulario real, notas 3 y 4. La 4 es el «costo_directo» de la política de precios (sin cambios).
  const precioEjercitoCostoDirecto = r0(cdt - hhMilitar);
  const precioEjercitoCt = alPeso(e.costoTotal - hhMilitar);
  const precioEjercitoAplicado = p.precioEjercito === "costo_directo" ? "costo_directo" : "costo_total";
  const precioEjercito = precioEjercitoAplicado === "costo_directo" ? precioEjercitoCostoDirecto : e.costoTotal;
  const usd: MontosUsd | null = dolar
    ? {
        detalle: Object.fromEntries(Object.entries(detalle).map(([k, v]) => [k, aUsd(v, dolar)])) as unknown as DetalleForm05,
        cdt: aUsd(cdt, dolar),
        cfa: aUsd(e.costoIndirecto, dolar),
        ct: aUsd(e.costoTotal, dolar),
        precioEjercito: aUsd(precioEjercito, dolar),
        precioEjercitoCt: aUsd(precioEjercitoCt, dolar),
        precioEjercitoCostoDirecto: aUsd(precioEjercitoCostoDirecto, dolar),
        recargo: aUsd(e.recargo, dolar),
        precioParticular: aUsd(e.neto, dolar),
        iva: aUsd(e.iva, dolar),
        precioParticularIvaIncluido: aUsd(e.precioIvaIncluido, dolar),
      }
    : null;
  return {
    secciones,
    horasHombreTotal: Math.round(suma(f.horasHombre, (h) => h.horas) * 100) / 100,
    cdt,
    cfaPct: p.cfaPct,
    cfa: e.costoIndirecto,
    ct: e.costoTotal,
    precioEjercito,
    precioEjercitoAplicado,
    precioEjercitoCt,
    precioEjercitoCostoDirecto,
    horasHombreMilitar: r0(hhMilitar),
    margenParticularPct: p.margenParticularPct,
    recargo: e.recargo,
    precioParticular: e.neto,
    ivaPct,
    iva: e.iva,
    precioParticularIvaIncluido: e.precioIvaIncluido,
    detalle,
    dolar: dolar || null,
    dolarFecha: dolar && f.dolarFecha ? f.dolarFecha : null,
    usd,
    ivaGastos: lineaIva.iva,
    baseIvaGastos: lineaIva.base,
  };
}

/* ------------------------------------------------------- Programa FORM06 --- */

export interface EtapaPrograma { actividad: string; inicio?: string | null; termino?: string | null; recursos?: string | null }
export interface ProgramaTrabajo {
  etapas: EtapaPrograma[];
  fechaInicio?: string | null;
  fechaTermino?: string | null;
  /** Plazo de entrega propuesto (días hábiles, IDIC-PG03 Rev18). Obligatorio. */
  plazoEntregaDias: number;
  /** Programa de Trabajo del LEM (EP-05 0.2): puntos de la E.T. que se ensayan y nº de ítems. */
  puntosEt?: string | null;
  numItems?: number | null;
}

export function erroresPrograma(p: ProgramaTrabajo): string[] {
  const e: string[] = [];
  if (!(Number.isInteger(p.plazoEntregaDias) && p.plazoEntregaDias >= 1 && p.plazoEntregaDias <= 730))
    e.push("Plazo de entrega propuesto: entre 1 y 730 días hábiles.");
  if (p.fechaInicio && p.fechaTermino && p.fechaTermino < p.fechaInicio)
    e.push("Programa de trabajo: la fecha de término es anterior a la de inicio.");
  if (p.numItems != null && !(Number.isInteger(p.numItems) && p.numItems >= 1))
    e.push("Programa de trabajo: el número de ítems debe ser un entero de 1 o más.");
  p.etapas.forEach((x, i) => {
    if (x.inicio && x.termino && x.termino < x.inicio) e.push(`Etapa ${i + 1} («${x.actividad}»): termina antes de empezar.`);
  });
  return e;
}
