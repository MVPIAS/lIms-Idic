/**
 * Cierre de la OT · lote 4 del quinto envío del IDIC (20–21-11-2026) · reglas
 * PURAS (sin BD), probadas en reglas-cierre-q4.spec.ts.
 *
 *  1 · «Cerrar por incumplimiento» (BPCH, §2 del análisis): cuando un ensayo
 *      aprobado da No cumple, el Jefe de Laboratorio cierra el flujo de la OT
 *      entera: los ensayos aún no aprobados pasan a `no_ejecutado` con motivo
 *      (no se borran), el Informe de Incumplimiento los muestra «No ejecutado»
 *      y la OT puede emitirse y cerrarse. No se cobran.
 *  2 · Cierre con la planilla de costos reales cerrada (LQC por defecto).
 *  3 · Tres cierres con fecha real (COORD-02): analista → jefe de laboratorio →
 *      jefe de departamento. `fecha_cierre` sigue siendo el cierre final.
 *  4 · IDIC-PG03: la OT terminada se cierra en N días hábiles (10) con la Hoja
 *      de Costos Reales: aviso si pasa el plazo.
 *
 * Todos los valores son PROVISIONALES y se leen de parametro_sistema, categoría
 * `ot_cierre` (align_q4_cierre_ot.sql).
 */
import { diasHabilesEntre, sumarDiasHabiles } from "../common/dias-habiles";

export const CATEGORIA_CIERRE_OT = "ot_cierre";
/** BPCH, su sección de certificación y sus sucursales (sin la Delegación Nº 11). */
export const INCUMPLIMIENTO_LABS_DEFECTO = "BPCH,SCC,SSTGO,SANTOF,SSEREN,SCALAM,SCOPIAP,SIQUIQU";
export const PLANILLA_COSTOS_LABS_DEFECTO = "LQC";
/** IDIC-PG03 Rev18: cierre de la OT en 10 días (hábiles, como los plazos de entrega). */
export const DIAS_CIERRE_DEFECTO = 10;
/** Motivo mínimo del cierre por incumplimiento. */
export const MOTIVO_MINIMO = 10;

export type ListaLaboratorios = string[] | "todos";

export interface ConfigCierreOt {
  incumplimientoLabs: ListaLaboratorios;
  planillaCostosLabs: ListaLaboratorios;
  exigeTresCierres: boolean;
  diasCierre: number;
}

/** Códigos de unidad separados por coma, punto y coma o espacio; «TODOS» o «*» = todos. */
export function listaLaboratorios(valor: string | null | undefined, defecto: string): ListaLaboratorios {
  const texto = valor === null || valor === undefined ? defecto : String(valor);
  const codigos = texto.split(/[,;\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  if (codigos.includes("TODOS") || codigos.includes("*")) return "todos";
  return codigos;
}

/** ¿La unidad (por su código) está en la lista? */
export function laboratorioEn(lista: ListaLaboratorios, codigo: string | null | undefined): boolean {
  if (!codigo) return false;
  return lista === "todos" || lista.includes(codigo.trim().toUpperCase());
}

const siNo = (v: string | null | undefined, d: boolean) => {
  const s = String(v ?? "").trim().toLowerCase();
  if (["si", "sí", "true", "1"].includes(s)) return true;
  if (["no", "false", "0"].includes(s)) return false;
  return d;
};

/** Lee la categoría `ot_cierre` (filas inactivas o ausentes = valor por defecto). */
export function configCierreOt(filas: { codigo: string; valor: string | null; activo?: boolean }[]): ConfigCierreOt {
  const v = (c: string) => {
    const f = filas.find((x) => x.codigo === c && x.activo !== false);
    return f ? f.valor ?? "" : null;
  };
  const dias = Number.parseInt(String(v("dias_cierre") ?? ""), 10);
  return {
    incumplimientoLabs: listaLaboratorios(v("incumplimiento_labs"), INCUMPLIMIENTO_LABS_DEFECTO),
    planillaCostosLabs: listaLaboratorios(v("planilla_costos_labs"), PLANILLA_COSTOS_LABS_DEFECTO),
    exigeTresCierres: siNo(v("exige_tres_cierres"), false),
    diasCierre: Number.isInteger(dias) && dias >= 1 && dias <= 60 ? dias : DIAS_CIERRE_DEFECTO,
  };
}

/* ========================================================================== */
/* 1 · Cerrar por incumplimiento                                              */
/* ========================================================================== */

/** Estados del resultado que pasan a «No ejecutado» (todo lo que no está aprobado). */
export const ESTADOS_A_NO_EJECUTADO = ["pendiente", "capturado", "revisado_n1", "devuelto", "rechazado"] as const;

/**
 * Qué impide «Cerrar por incumplimiento» (lista vacía = se puede):
 *  · OT abierta y de un laboratorio habilitado (parámetro);
 *  · al menos un resultado APROBADO con veredicto No cumple (el negativo que cierra el flujo);
 *  · al menos un ensayo pendiente (si no, no hay nada que cerrar: se emite y se cierra normal);
 *  · motivo de al menos MOTIVO_MINIMO caracteres.
 */
export function faltantesCierreIncumplimiento(p: {
  estadoOt: string;
  laboratorio: string | null;
  habilitado: boolean;
  noCumpleAprobados: number;
  pendientes: number;
  motivo?: string | null;
}): string[] {
  if (p.estadoOt === "cerrada" || p.estadoOt === "anulada") return [`La OT está ${p.estadoOt}.`];
  const f: string[] = [];
  if (!p.habilitado)
    f.push(
      `El cierre por incumplimiento no está habilitado para ${p.laboratorio ?? "el laboratorio de la OT"} ` +
        "(Administración › Parámetros del sistema › «Cierre de la OT»).",
    );
  if (p.noCumpleAprobados < 1)
    f.push("No hay ningún resultado aprobado con veredicto «No cumple»: el cierre por incumplimiento exige un ensayo negativo aprobado.");
  if (p.pendientes < 1) f.push("No quedan ensayos pendientes: emita el documento y cierre la OT de la forma habitual.");
  if (p.motivo !== undefined && (p.motivo ?? "").trim().length < MOTIVO_MINIMO)
    f.push(`Indique el motivo del cierre por incumplimiento (mínimo ${MOTIVO_MINIMO} caracteres).`);
  return f;
}

/* ========================================================================== */
/* 2 · Planilla de costos cerrada                                             */
/* ========================================================================== */

/** Falta para el cierre si el laboratorio exige la planilla de costos reales cerrada. */
export function faltantesPlanillaCostos(p: { exige: boolean; laboratorio: string | null; estadoPlanilla: string | null }): string[] {
  if (!p.exige || p.estadoPlanilla === "cerrada") return [];
  const lab = p.laboratorio ?? "el laboratorio responsable";
  return [
    p.estadoPlanilla
      ? `La planilla de costos reales de ${lab} está en borrador: ciérrela en la pestaña «Costos» de la OT (IDIC-PG03: la OT se cierra con la Hoja de Costos Reales).`
      : `Falta la planilla de costos reales de ${lab}: complétela y ciérrela en la pestaña «Costos» de la OT (IDIC-PG03: la OT se cierra con la Hoja de Costos Reales).`,
  ];
}

/* ========================================================================== */
/* 3 · Tres cierres (COORD-02)                                                */
/* ========================================================================== */

export const ETAPAS_CIERRE = ["analista", "jefe_lab", "jefe_depto"] as const;
export type EtapaCierre = (typeof ETAPAS_CIERRE)[number];

export const NOMBRE_ETAPA: Record<EtapaCierre, string> = {
  analista: "analista",
  jefe_lab: "jefe de laboratorio",
  jefe_depto: "jefe de departamento",
};

export const PERMISO_ETAPA: Record<EtapaCierre, string> = {
  analista: "ot.cierre_analista",
  jefe_lab: "ot.cierre_jefe_lab",
  jefe_depto: "ot.cierre_jefe_depto",
};

export function esEtapaCierre(x: unknown): x is EtapaCierre {
  return typeof x === "string" && (ETAPAS_CIERRE as readonly string[]).includes(x);
}

/**
 * Qué impide registrar el cierre de una etapa (lista vacía = se puede):
 *  · analista: sin ensayos por capturar (pendiente, devuelto o rechazado);
 *  · jefe de laboratorio: con el cierre del analista y todo aprobado o «No ejecutado»;
 *  · jefe de departamento: con el cierre del jefe de laboratorio.
 * Cada etapa se registra una vez (fecha y usuario reales).
 */
export function faltantesEtapaCierre(
  etapa: EtapaCierre,
  p: { estadoOt: string; hechas: Partial<Record<EtapaCierre, boolean>>; sinCapturar: number; sinTerminar: number },
): string[] {
  if (p.estadoOt === "anulada") return ["La OT está anulada."];
  if (p.hechas[etapa]) return [`El cierre del ${NOMBRE_ETAPA[etapa]} ya está registrado.`];
  const f: string[] = [];
  if (etapa === "analista" && p.sinCapturar > 0) f.push(`Hay ${p.sinCapturar} ensayo(s) sin capturar.`);
  if (etapa === "jefe_lab") {
    if (!p.hechas.analista) f.push("Falta el cierre del analista.");
    if (p.sinTerminar > 0) f.push(`Hay ${p.sinTerminar} resultado(s) sin aprobar.`);
  }
  if (etapa === "jefe_depto" && !p.hechas.jefe_lab) f.push("Falta el cierre del jefe de laboratorio.");
  return f;
}

/** Con el parámetro exige_tres_cierres, el cierre final pide las tres etapas. */
export function faltantesTresCierres(exige: boolean, hechas: Partial<Record<EtapaCierre, boolean>>): string[] {
  if (!exige) return [];
  const faltan = ETAPAS_CIERRE.filter((e) => !hechas[e]).map((e) => NOMBRE_ETAPA[e]);
  return faltan.length ? [`Faltan los cierres con fecha real de: ${faltan.join(", ")} (COORD-02).`] : [];
}

/* ========================================================================== */
/* 4 · Plazo de cierre (IDIC-PG03)                                            */
/* ========================================================================== */

export interface PlazoCierre {
  /** Día en que la OT quedó terminada (último documento entregado o recepción en el DCO). */
  terminadaEl: string;
  /** Último día hábil para cerrarla. */
  limite: string;
  /** Días hábiles transcurridos desde que quedó terminada. */
  diasHabiles: number;
  /** Días hábiles que quedan (negativo = de atraso). */
  diasRestantes: number;
  atrasada: boolean;
}

/**
 * Plazo de cierre de una OT terminada: N días HÁBILES (lunes a viernes, sin
 * descontar feriados) desde el día en que quedó terminada. null si no está terminada.
 */
export function plazoCierre(terminadaEl: string | null | undefined, hoy: string, dias: number): PlazoCierre | null {
  if (!terminadaEl || !/^\d{4}-\d{2}-\d{2}$/.test(terminadaEl)) return null;
  const limite = sumarDiasHabiles(terminadaEl, dias);
  const transcurridos = diasHabilesEntre(terminadaEl, hoy);
  const restantes = hoy <= limite ? diasHabilesEntre(hoy, limite) : -diasHabilesEntre(limite, hoy);
  return { terminadaEl, limite, diasHabiles: transcurridos, diasRestantes: restantes, atrasada: hoy > limite };
}
