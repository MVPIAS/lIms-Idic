/**
 * Planilla de costos reales por OT · LIMS IDIC (DCO-PG01-P05-IT03-FORM01,
 * «Control de gastos por OT»). Reglas PURAS (sin BD): costos-reales.spec.ts.
 *
 * La completa la jefatura del laboratorio (permiso costo_real.gestionar) al
 * cerrar la parte de su laboratorio, con cuatro bloques —como la planilla en
 * papel y el LIMS antiguo (OT_COSTO: profesional/técnico, máquina, insumos,
 * otros)—: horas hombre por cargo, reactivos y consumibles, equipos (horas
 * máquina) y otros. La tarifa $/h de cada cargo y de cada equipo NO consta en
 * las fuentes recibidas: se escribe en cada línea (queda editable).
 *
 * Se compara con la estimación de la cotización: costo directo consolidado del
 * costeo por laboratorio, o lo estimado por el laboratorio, o el costo estimado
 * de la OT; y horas hombre estimadas. Las líneas cotizadas (precio) por tipo
 * se muestran como referencia por bloque.
 */

export const CATEGORIAS_COSTO = ["horas_hombre", "reactivos", "equipos", "otros", "ot_interna", "comision"] as const;
export type CategoriaCosto = (typeof CATEGORIAS_COSTO)[number];

export const ETIQUETA_CATEGORIA: Record<CategoriaCosto, string> = {
  horas_hombre: "Horas hombre",
  reactivos: "Reactivos y consumibles",
  equipos: "Equipos (horas máquina)",
  otros: "Otros",
  ot_interna: "OT internas valorizadas",
  comision: "Gastos de comisión",
};

/**
 * Gastos de comisión en terreno o en el extranjero (EP-05 2.4 y 9.1, BL-194):
 * pasajes, viáticos, traslados, arriendo de vehículo, combustible y rendición.
 */
export const TIPOS_GASTO_COMISION = ["viatico", "pasaje", "traslado", "arriendo", "combustible", "rendicion", "otro"] as const;
export const ETIQUETA_GASTO_COMISION: Record<(typeof TIPOS_GASTO_COMISION)[number], string> = {
  viatico: "Viático",
  pasaje: "Pasaje",
  traslado: "Traslado",
  arriendo: "Arriendo de vehículo",
  combustible: "Combustible",
  rendicion: "Rendición de cuentas",
  otro: "Otro gasto",
};

export interface LineaCostoReal {
  categoria: CategoriaCosto;
  cargo?: string | null;
  consumibleId?: string | null;
  equipoId?: string | null;
  descripcion?: string | null;
  cantidad: number;
  unidad?: string | null;
  costoUnitario: number;
  /** Orden interna valorizada (bloque «OT internas», EP-00 7.1). */
  ordenInternaId?: string | null;
  /** Tipo de gasto de comisión (bloque «Gastos de comisión», EP-05 9.1). */
  tipoGasto?: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export const totalLinea = (l: Pick<LineaCostoReal, "cantidad" | "costoUnitario">) => r2((Number(l.cantidad) || 0) * (Number(l.costoUnitario) || 0));

/** Errores de las líneas (lista vacía = se pueden guardar). */
export function erroresLineas(lineas: LineaCostoReal[], cargosValidos: Set<string>): string[] {
  const e: string[] = [];
  lineas.forEach((l, i) => {
    const n = `Línea ${i + 1}`;
    if (!CATEGORIAS_COSTO.includes(l.categoria)) e.push(`${n}: bloque desconocido.`);
    if (!Number.isFinite(l.cantidad) || l.cantidad < 0) e.push(`${n}: la cantidad no puede ser negativa.`);
    if (!Number.isFinite(l.costoUnitario) || l.costoUnitario < 0) e.push(`${n}: el costo unitario no puede ser negativo.`);
    if (l.categoria === "horas_hombre" && !l.cargo) e.push(`${n}: indique el cargo de las horas hombre.`);
    if (l.categoria === "horas_hombre" && l.cargo && !cargosValidos.has(l.cargo)) e.push(`${n}: el cargo «${l.cargo}» no está en la lista de cargos.`);
    if (l.categoria === "reactivos" && !l.consumibleId && !l.descripcion?.trim()) e.push(`${n}: indique el reactivo o consumible.`);
    if (l.categoria === "equipos" && !l.equipoId && !l.descripcion?.trim()) e.push(`${n}: indique el equipo.`);
    if (l.categoria === "otros" && !l.descripcion?.trim()) e.push(`${n}: describa el gasto.`);
    if (l.categoria === "ot_interna" && !l.ordenInternaId && !l.descripcion?.trim()) e.push(`${n}: indique la orden interna valorizada.`);
    if (l.categoria === "comision" && !(TIPOS_GASTO_COMISION as readonly string[]).includes(String(l.tipoGasto ?? "")))
      e.push(`${n}: indique el tipo de gasto de comisión (viático, pasaje, traslado, arriendo, combustible, rendición u otro).`);
  });
  const ois = lineas.filter((l) => l.categoria === "ot_interna" && l.ordenInternaId).map((l) => l.ordenInternaId);
  if (new Set(ois).size !== ois.length) e.push("Una misma orden interna figura dos veces en la planilla.");
  return e;
}

/**
 * Sugerencias para los bloques nuevos (EP-00 7.1, EP-05 9.1): una línea por
 * orden interna respondida con su costo directo (cantidad 1 × costo), y una por
 * gasto de comisión estimado por el laboratorio en el Formulario de costeo de la
 * cotización (viáticos y pasajes; los otros gastos como «otro»). Lo ya cargado
 * no se repite. El costo real se corrige a mano.
 */
export function lineasSugeridas(
  ordenes: { id: string; numero: string | null; destino: string | null; costoDirecto: number | null }[],
  costeo: { viaticos?: { zona: string; dias: number; montoDiario: number; porcentaje: number }[]; pasajes?: { tramo: string; cantidad: number; valorUnitario: number }[]; otros?: { descripcion: string; monto: number; moneda: string }[] } | null,
  yaCargadas: LineaCostoReal[],
): LineaCostoReal[] {
  const out: LineaCostoReal[] = [];
  const cargadas = new Set(yaCargadas.filter((l) => l.ordenInternaId).map((l) => l.ordenInternaId));
  for (const o of ordenes) {
    if (cargadas.has(o.id) || !(Number(o.costoDirecto) > 0)) continue;
    out.push({ categoria: "ot_interna", ordenInternaId: o.id, descripcion: `Orden interna ${o.numero ?? ""}${o.destino ? ` · ${o.destino}` : ""}`.trim(), cantidad: 1, costoUnitario: r2(Number(o.costoDirecto)) });
  }
  if (!yaCargadas.some((l) => l.categoria === "comision") && costeo) {
    for (const v of costeo.viaticos ?? [])
      out.push({ categoria: "comision", tipoGasto: "viatico", descripcion: `Viático ${v.zona}`, cantidad: Number(v.dias) || 0, unidad: "días", costoUnitario: r2((Number(v.montoDiario) || 0) * ((Number(v.porcentaje) || 0) / 100)) });
    for (const p of costeo.pasajes ?? [])
      out.push({ categoria: "comision", tipoGasto: "pasaje", descripcion: `Pasaje ${p.tramo}`, cantidad: Number(p.cantidad) || 0, costoUnitario: r2(Number(p.valorUnitario) || 0) });
    for (const o of costeo.otros ?? [])
      if (o.moneda !== "USD") out.push({ categoria: "comision", tipoGasto: "otro", descripcion: o.descripcion, cantidad: 1, costoUnitario: r2(Number(o.monto) || 0) });
  }
  return out;
}

export interface ResumenCostos {
  porCategoria: Record<CategoriaCosto, { cantidad: number; total: number; lineas: number }>;
  horasHombre: number;
  horasMaquina: number;
  total: number;
}

export function resumenCostos(lineas: LineaCostoReal[]): ResumenCostos {
  const porCategoria = Object.fromEntries(CATEGORIAS_COSTO.map((c) => [c, { cantidad: 0, total: 0, lineas: 0 }])) as ResumenCostos["porCategoria"];
  for (const l of lineas) {
    const c = porCategoria[l.categoria];
    if (!c) continue;
    c.cantidad = r2(c.cantidad + (Number(l.cantidad) || 0));
    c.total = r2(c.total + totalLinea(l));
    c.lineas++;
  }
  return {
    porCategoria,
    horasHombre: porCategoria.horas_hombre.cantidad,
    horasMaquina: porCategoria.equipos.cantidad,
    total: r2(CATEGORIAS_COSTO.reduce((s, c) => s + porCategoria[c].total, 0)),
  };
}

export interface FuentesEstimacion {
  /** cotizacion.costos_directos_total (costeo consolidado, camino b). */
  costosDirectosTotal?: number | null;
  /** solicitud_costeo de la cotización (estimación de cada laboratorio). */
  solicitudes?: { horasHombre: number; costoDirecto: number }[];
  /** orden_trabajo.horas_hombre / costo_estimado. */
  otHorasHombre?: number | null;
  otCostoEstimado?: number | null;
  /** Líneas de la cotización (precio) por tipo. */
  lineasCotizacion?: { tipo: string; cantidad: number; diasOHoras?: number | null; subtotal: number }[];
  /** Neto de la cotización aceptada. */
  neto?: number | null;
}

export interface Estimacion {
  costoDirecto: number | null;
  fuenteCosto: "costeo_consolidado" | "estimacion_laboratorio" | "costo_estimado_ot" | null;
  horasHombre: number | null;
  fuenteHoras: "estimacion_laboratorio" | "horas_ot" | "lineas_cotizacion" | null;
  /** Precio cotizado por bloque (referencia; no es costo). */
  cotizadoPorCategoria: Record<CategoriaCosto, number>;
  neto: number | null;
  /**
   * De qué es la estimación: «ot» (la OT tiene un solo laboratorio: la de la
   * cotización completa), «laboratorio» (la solicitud de costeo de ESTE
   * laboratorio) o «sin_estimacion_laboratorio» (OT con varios laboratorios y
   * ninguna estimación de este: no se compara con el total).
   */
  alcance?: "ot" | "laboratorio" | "sin_estimacion_laboratorio";
  /** Aviso para la pantalla cuando no hay con qué comparar. */
  aviso?: string | null;
}

const TIPO_A_CATEGORIA: Record<string, CategoriaCosto> = {
  hora_hombre: "horas_hombre",
  hora_hombre_civil: "horas_hombre",
  hora_hombre_militar: "horas_hombre",
  hora_maquina: "equipos",
  insumo: "reactivos",
  viatico: "otros",
  pasaje: "otros",
  otros: "otros",
  extension: "otros",
};

export function estimacionDeCotizacion(f: FuentesEstimacion): Estimacion {
  const pos = (n: unknown) => (Number(n) > 0 ? Number(n) : null);
  const sol = f.solicitudes ?? [];
  const sumaSolCosto = sol.reduce((s, x) => s + (Number(x.costoDirecto) || 0), 0);
  const sumaSolHoras = sol.reduce((s, x) => s + (Number(x.horasHombre) || 0), 0);
  const lineasHh = (f.lineasCotizacion ?? []).filter((l) => TIPO_A_CATEGORIA[l.tipo] === "horas_hombre");
  const horasLineas = lineasHh.reduce((s, l) => s + (Number(l.cantidad) || 0) * (l.diasOHoras != null ? Number(l.diasOHoras) : 1), 0);

  let costoDirecto: number | null = null;
  let fuenteCosto: Estimacion["fuenteCosto"] = null;
  if (pos(f.costosDirectosTotal)) [costoDirecto, fuenteCosto] = [Number(f.costosDirectosTotal), "costeo_consolidado"];
  else if (pos(sumaSolCosto)) [costoDirecto, fuenteCosto] = [sumaSolCosto, "estimacion_laboratorio"];
  else if (pos(f.otCostoEstimado)) [costoDirecto, fuenteCosto] = [Number(f.otCostoEstimado), "costo_estimado_ot"];

  let horasHombre: number | null = null;
  let fuenteHoras: Estimacion["fuenteHoras"] = null;
  if (pos(sumaSolHoras)) [horasHombre, fuenteHoras] = [sumaSolHoras, "estimacion_laboratorio"];
  else if (pos(f.otHorasHombre)) [horasHombre, fuenteHoras] = [Number(f.otHorasHombre), "horas_ot"];
  else if (pos(horasLineas)) [horasHombre, fuenteHoras] = [horasLineas, "lineas_cotizacion"];

  const cotizadoPorCategoria = Object.fromEntries(CATEGORIAS_COSTO.map((c) => [c, 0])) as Record<CategoriaCosto, number>;
  for (const l of f.lineasCotizacion ?? []) {
    const c = TIPO_A_CATEGORIA[l.tipo];
    if (c) cotizadoPorCategoria[c] = r2(cotizadoPorCategoria[c] + (Number(l.subtotal) || 0));
  }
  return {
    costoDirecto: costoDirecto != null ? r2(costoDirecto) : null,
    fuenteCosto,
    horasHombre: horasHombre != null ? r2(horasHombre) : null,
    fuenteHoras,
    cotizadoPorCategoria,
    neto: pos(f.neto) != null ? r2(Number(f.neto)) : null,
  };
}

/**
 * Estimación con la que se compara la planilla de UN laboratorio (revisión r3,
 * hallazgo 7). Si la OT tiene un solo laboratorio, la de la cotización. Si tiene
 * varios (responsable + órdenes internas u otros laboratorios), solo la parte de
 * ese laboratorio: sus solicitudes de costeo; si no hay, se dice que no hay
 * estimación por laboratorio en vez de comparar con el total de la OT. El neto
 * de la cotización (margen) es de la OT completa: no se usa por laboratorio.
 */
export function estimacionDelLaboratorio(
  f: FuentesEstimacion,
  lab: { multiLaboratorio: boolean; solicitudesDelLaboratorio: { horasHombre: number; costoDirecto: number }[] },
): Estimacion {
  if (!lab.multiLaboratorio) return { ...estimacionDeCotizacion(f), alcance: "ot", aviso: null };
  const vacio = Object.fromEntries(CATEGORIAS_COSTO.map((c) => [c, 0])) as Record<CategoriaCosto, number>;
  const costo = lab.solicitudesDelLaboratorio.reduce((s, x) => s + (Number(x.costoDirecto) || 0), 0);
  const horas = lab.solicitudesDelLaboratorio.reduce((s, x) => s + (Number(x.horasHombre) || 0), 0);
  if (costo <= 0 && horas <= 0)
    return {
      costoDirecto: null, fuenteCosto: null, horasHombre: null, fuenteHoras: null, cotizadoPorCategoria: vacio, neto: null,
      alcance: "sin_estimacion_laboratorio",
      aviso: "La OT tiene varios laboratorios y la cotización no trae una estimación de costos de este laboratorio (solicitud de costeo): no se compara con el total de la OT.",
    };
  return {
    costoDirecto: costo > 0 ? r2(costo) : null,
    fuenteCosto: costo > 0 ? "estimacion_laboratorio" : null,
    horasHombre: horas > 0 ? r2(horas) : null,
    fuenteHoras: horas > 0 ? "estimacion_laboratorio" : null,
    cotizadoPorCategoria: vacio,
    neto: null,
    alcance: "laboratorio",
    aviso: null,
  };
}

/**
 * Laboratorio al que pertenece un ensayo de la OT (revisión r3, hallazgos 8 y
 * 14): el del laboratorio de su método en el catálogo (cat_familia → unidad)
 * si es uno de los que trabajan en la OT —el responsable si el método es
 * suyo—; si no se puede saber, el responsable de la OT.
 */
export function laboratorioDeResultado(candidatas: string[], posibles: string[], principal: string | null): string | null {
  if (principal && candidatas.includes(principal)) return principal;
  const otro = posibles.find((u) => u !== principal && candidatas.includes(u));
  return otro ?? principal;
}

export interface Comparacion {
  costoReal: number;
  costoEstimado: number | null;
  diferencia: number | null;
  /** (real − estimado) / estimado × 100 */
  desviacionPct: number | null;
  horasReales: number;
  horasEstimadas: number | null;
  diferenciaHoras: number | null;
  /** neto cotizado − costo real */
  margen: number | null;
}

export function comparar(real: ResumenCostos, est: Estimacion): Comparacion {
  const dif = est.costoDirecto != null ? r2(real.total - est.costoDirecto) : null;
  return {
    costoReal: real.total,
    costoEstimado: est.costoDirecto,
    diferencia: dif,
    desviacionPct: dif != null && est.costoDirecto ? r2((dif / est.costoDirecto) * 100) : null,
    horasReales: real.horasHombre,
    horasEstimadas: est.horasHombre,
    diferenciaHoras: est.horasHombre != null ? r2(real.horasHombre - est.horasHombre) : null,
    margen: est.neto != null ? r2(est.neto - real.total) : null,
  };
}

/** Qué impide cerrar la planilla (lista vacía = se puede). */
export function erroresCierrePlanilla(p: { estado: string; lineas: LineaCostoReal[]; resultadosSinAprobar: number }): string[] {
  const e: string[] = [];
  if (p.estado === "cerrada") e.push("La planilla ya está cerrada.");
  if (!p.lineas.some((l) => totalLinea(l) > 0)) e.push("Registre al menos un costo (horas hombre, reactivos, equipos u otros) antes de cerrar.");
  if (!p.lineas.some((l) => l.categoria === "horas_hombre" && l.cantidad > 0)) e.push("Registre las horas hombre del laboratorio.");
  if (p.resultadosSinAprobar > 0)
    e.push(`El laboratorio aún tiene ${p.resultadosSinAprobar} ensayo(s) sin aprobar en esta OT: la planilla se cierra al terminar su parte.`);
  return e;
}
