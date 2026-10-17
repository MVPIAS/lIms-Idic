/**
 * Producción Nacional · reglas PURAS (sin BD) · BPCH · LIMS IDIC.
 * Pruebas: reglas-pn.spec.ts. Documento: docs/FLUJO_BPCH_PRODUCCION_PROTOTIPOS_CLASIFICACION.md §1.
 *
 * Fuente del flujo: «BPCH - DIAGRAMA DEL SUBPROCESO PRODUCCIÓN NACIONAL» (Bizagi):
 *   SCC-PN registra la Resolución DGMN (RAF) → la Subdirección elabora la O/C
 *   operativa anual → las sucursales elaboran la programación mensual, ejecutan
 *   las inspecciones y emiten el certificado de control → planilla mensual de
 *   actividades ejecutadas → SCC-PN recibe la relación de ventas, la correlaciona
 *   con las planillas → ¿conforme? Sí: informe técnico a DCO. No: solicita
 *   información técnica a la Sucursal → ¿responde al requerimiento? Sí: informe
 *   con propuesta técnica; No: solicita información técnica a la DGMN → con su
 *   respuesta, informe con propuesta técnica → la Subdirección lo remite a DCO.
 *
 * En el LIMS: cada línea del programa genera UNA OT (una visita / un lote) que
 * sigue el flujo general (muestras → resultados → revisión → aprobación →
 * documento → firma → entrega → cierre). La línea queda «ejecutada» cuando su
 * OT se cierra.
 */

export type EstadoLinea = "planificada" | "en_curso" | "ejecutada" | "ot_anulada" | "anulada";

export interface LineaPrograma {
  id?: string;
  anulada: boolean;
  otId: string | null;
  otEstado?: string | null;
  mes: number;
  ocProductoId: string;
  cantidad?: number | null;
  fechaProgramada?: string | Date | null;
}

export function estadoLinea(l: Pick<LineaPrograma, "anulada" | "otId" | "otEstado">): EstadoLinea {
  if (l.anulada) return "anulada";
  if (!l.otId) return "planificada";
  if (l.otEstado === "anulada") return "ot_anulada";
  if (l.otEstado === "cerrada") return "ejecutada";
  return "en_curso";
}

export const ETIQUETA_ESTADO_LINEA: Record<EstadoLinea, string> = {
  planificada: "Planificada (sin OT)",
  en_curso: "OT en curso",
  ejecutada: "Ejecutada (OT cerrada)",
  ot_anulada: "OT anulada · regenerar",
  anulada: "Anulada",
};

/** ¿Se puede generar la OT de esta línea? (sin OT, o con su OT anulada). */
export const puedeGenerarOt = (e: EstadoLinea) => e === "planificada" || e === "ot_anulada";

export interface ResumenPrograma {
  total: number;
  planificadas: number;
  enCurso: number;
  ejecutadas: number;
  anuladas: number;
  /** sin OT (o con la OT anulada) y con el mes ya vencido */
  atrasadas: number;
  /** pendientes = programadas que aún no se ejecutan (planificadas + en curso + OT anulada) */
  pendientes: number;
}

/** `hoy` = { anio, mes } en Chile. `anioOc` = año de la O/C (el del programa). */
export function resumenPrograma(lineas: LineaPrograma[], anioOc: number, hoy: { anio: number; mes: number }): ResumenPrograma {
  const r: ResumenPrograma = { total: 0, planificadas: 0, enCurso: 0, ejecutadas: 0, anuladas: 0, atrasadas: 0, pendientes: 0 };
  for (const l of lineas) {
    const e = estadoLinea(l);
    if (e === "anulada") {
      r.anuladas++;
      continue;
    }
    r.total++;
    if (e === "ejecutada") r.ejecutadas++;
    else {
      r.pendientes++;
      if (e === "en_curso") r.enCurso++;
      else r.planificadas++;
      if (e !== "en_curso" && mesVencido(anioOc, l.mes, hoy)) r.atrasadas++;
    }
  }
  return r;
}

export function mesVencido(anio: number, mes: number, hoy: { anio: number; mes: number }): boolean {
  return anio < hoy.anio || (anio === hoy.anio && mes < hoy.mes);
}

/* ------------------------------------------------------- consumo de la O/C --- */

export interface ProductoOc {
  id: string;
  producto: string;
  unidadMedida: string;
  cantidadAutorizada: number;
}

export interface ConsumoProducto {
  ocProductoId: string;
  producto: string;
  unidadMedida: string;
  autorizado: number;
  /** cantidad de las líneas con OT en curso */
  comprometido: number;
  /** cantidad de las líneas con OT cerrada */
  ejecutado: number;
  /** cantidad de las líneas planificadas sin OT (aún no consume) */
  planificado: number;
  saldo: number;
  porcentajeEjecutado: number;
  excedido: boolean;
  /** líneas con OT (en curso o cerrada) sin cantidad registrada: no suman */
  lineasSinCantidad: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Consumo de la O/C por producto. Consume lo que tiene OT (en curso = comprometido,
 * cerrada = ejecutado); lo planificado sin OT se muestra aparte y no descuenta.
 * El exceso solo se AVISA: las fuentes no dicen que se bloquee.
 */
export function consumoOc(productos: ProductoOc[], lineas: LineaPrograma[]): ConsumoProducto[] {
  return productos.map((p) => {
    let comprometido = 0;
    let ejecutado = 0;
    let planificado = 0;
    let sinCantidad = 0;
    for (const l of lineas) {
      if (l.ocProductoId !== p.id) continue;
      const e = estadoLinea(l);
      const c = l.cantidad === null || l.cantidad === undefined ? null : Number(l.cantidad);
      if (e === "en_curso" || e === "ejecutada") {
        if (c === null) {
          sinCantidad++;
          continue;
        }
        if (e === "en_curso") comprometido += c;
        else ejecutado += c;
      } else if (e === "planificada" && c !== null) planificado += c;
    }
    const autorizado = Number(p.cantidadAutorizada);
    const saldo = r3(autorizado - comprometido - ejecutado);
    return {
      ocProductoId: p.id,
      producto: p.producto,
      unidadMedida: p.unidadMedida,
      autorizado,
      comprometido: r3(comprometido),
      ejecutado: r3(ejecutado),
      planificado: r3(planificado),
      saldo,
      porcentajeEjecutado: autorizado > 0 ? Math.round((ejecutado / autorizado) * 1000) / 10 : 0,
      excedido: saldo < 0,
      lineasSinCantidad: sinCantidad,
    };
  });
}

/* -------------------------------------------------- validaciones del programa --- */

export interface OcVigencia {
  estado: string;
  anio: number;
  vigenciaDesde: string; // AAAA-MM-DD
  vigenciaHasta: string; // AAAA-MM-DD
}

const dia = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/** Primer y último día del mes (AAAA-MM-DD). */
export function rangoMes(anio: number, mes: number): { desde: string; hasta: string } {
  const desde = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return { desde, hasta: `${anio}-${String(mes).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}` };
}

/** Errores al programar una inspección (alta o edición de la línea). */
export function validarLinea(oc: OcVigencia, l: { mes: number; fechaProgramada?: string | null }): string[] {
  const errores: string[] = [];
  if (oc.estado !== "vigente") errores.push(`La O/C está ${oc.estado}: no admite cambios en su programa.`);
  if (!Number.isInteger(l.mes) || l.mes < 1 || l.mes > 12) {
    errores.push("El mes debe estar entre 1 y 12.");
    return errores;
  }
  const { desde, hasta } = rangoMes(oc.anio, l.mes);
  if (hasta < dia(oc.vigenciaDesde) || desde > dia(oc.vigenciaHasta))
    errores.push(`El mes ${l.mes}/${oc.anio} está fuera de la vigencia de la O/C (${dia(oc.vigenciaDesde)} a ${dia(oc.vigenciaHasta)}).`);
  if (l.fechaProgramada) {
    const f = dia(l.fechaProgramada);
    if (f < desde || f > hasta) errores.push(`La fecha programada ${f} no es del mes ${l.mes}/${oc.anio}.`);
    else if (f < dia(oc.vigenciaDesde) || f > dia(oc.vigenciaHasta))
      errores.push(`La fecha programada ${f} está fuera de la vigencia de la O/C.`);
  }
  return errores;
}

export interface RafResumen {
  numero: string;
  estado: string;
  tipoLinea: "FIJA" | "MOVIL";
  vigenciaHasta?: string | null;
}

/**
 * Comprobaciones al generar la OT de una línea. `errores` impide generar;
 * `avisos` se muestran y quedan en la descripción de la OT.
 */
export function comprobarGeneracionOt(
  linea: Pick<LineaPrograma, "anulada" | "otId" | "otEstado">,
  oc: OcVigencia,
  raf: RafResumen,
  hoy: string,
): { errores: string[]; avisos: string[] } {
  const errores: string[] = [];
  const avisos: string[] = [];
  const e = estadoLinea(linea);
  if (e === "anulada") errores.push("La inspección está anulada.");
  else if (!puedeGenerarOt(e)) errores.push("La inspección ya tiene una OT vigente.");
  if (oc.estado !== "vigente") errores.push(`La O/C está ${oc.estado}.`);
  if (raf.estado !== "vigente") errores.push(`La RAF ${raf.numero} está ${raf.estado}.`);
  if (raf.vigenciaHasta && dia(raf.vigenciaHasta) < hoy)
    avisos.push(
      `La RAF ${raf.numero} venció el ${dia(raf.vigenciaHasta)}: según SAC-PG01-IT08 la vigencia de los documentos legales es un defecto crítico de la inspección.`,
    );
  if (raf.tipoLinea === "MOVIL")
    avisos.push("Línea de fabricación móvil (camión fábrica): SAC-PG01-IT10 excluye estos productos del muestreo por atributos NCh 44.");
  return { errores, avisos };
}

/* ------------------------------------------- correlación con la relación de ventas --- */

export interface FilaCorrelacion {
  ocProductoId: string;
  producto: string;
  unidadMedida: string;
  ventas: number | null;
  inspeccionado: number;
  /** ventas − inspeccionado (positivo = vendido sin inspeccionar) */
  desviacion: number | null;
}

/**
 * Correlación del período: lo declarado en la relación de ventas frente a lo
 * inspeccionado en OT CERRADAS cuya inspección cae en el período.
 */
export function correlacionar(
  productos: ProductoOc[],
  ventas: Map<string, number>,
  lineasEjecutadas: { ocProductoId: string; cantidad: number | null }[],
): FilaCorrelacion[] {
  return productos.map((p) => {
    const insp = lineasEjecutadas
      .filter((l) => l.ocProductoId === p.id && l.cantidad !== null)
      .reduce((s, l) => s + Number(l.cantidad), 0);
    const v = ventas.has(p.id) ? Number(ventas.get(p.id)) : null;
    return {
      ocProductoId: p.id,
      producto: p.producto,
      unidadMedida: p.unidadMedida,
      ventas: v,
      inspeccionado: r3(insp),
      desviacion: v === null ? null : r3(v - insp),
    };
  });
}

/** Sugerencia (no decisión): conforme si nada se vendió por sobre lo inspeccionado. */
export function sugerenciaConforme(filas: FilaCorrelacion[]): boolean | null {
  const conVentas = filas.filter((f) => f.desviacion !== null);
  if (!conVentas.length) return null;
  return conVentas.every((f) => (f.desviacion as number) <= 0);
}

/** Fecha de referencia de una línea: la programada o el día 1 de su mes. */
export function fechaReferenciaLinea(anio: number, l: { mes: number; fechaProgramada?: string | Date | null }): string {
  return l.fechaProgramada ? dia(l.fechaProgramada) : rangoMes(anio, l.mes).desde;
}

export interface DatosInforme {
  conforme: boolean | null | undefined;
  requerimientoSucursal?: string | null;
  respuestaSucursal?: string | null;
  respondeRequerimiento?: boolean | null;
  solicitudDgmn?: string | null;
  respuestaDgmn?: string | null;
  propuestaTecnica?: string | null;
  lineasConVentas: number;
}

const tiene = (s?: string | null) => Boolean(s && s.trim());

/**
 * Lo que falta para emitir el informe técnico a DCO, siguiendo el diagrama:
 * conforme → informe técnico; no conforme → requerimiento a la Sucursal y su
 * respuesta; si no responde al requerimiento → solicitud a la DGMN y su
 * respuesta; y en ambos casos, la propuesta técnica.
 */
export function faltantesInforme(d: DatosInforme): string[] {
  const f: string[] = [];
  if (d.lineasConVentas === 0) f.push("Registre la relación de ventas (al menos un producto).");
  if (d.conforme !== true && d.conforme !== false) {
    f.push("Indique si la relación de ventas es conforme con las planillas de actividades.");
    return f;
  }
  if (d.conforme) return f;
  if (!tiene(d.requerimientoSucursal)) f.push("No conforme: registre la solicitud de información técnica a la Sucursal.");
  if (!tiene(d.respuestaSucursal)) f.push("No conforme: registre el informe (respuesta) de la Sucursal.");
  if (d.respondeRequerimiento !== true && d.respondeRequerimiento !== false)
    f.push("Indique si la respuesta de la Sucursal responde al requerimiento técnico.");
  else if (d.respondeRequerimiento === false) {
    if (!tiene(d.solicitudDgmn)) f.push("La Sucursal no respondió el requerimiento: registre la solicitud de información técnica a la DGMN.");
    if (!tiene(d.respuestaDgmn)) f.push("Registre la respuesta de la DGMN.");
  }
  if (!tiene(d.propuestaTecnica)) f.push("No conforme: el informe lleva una propuesta técnica.");
  return f;
}
