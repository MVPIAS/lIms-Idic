/**
 * Datos del encargo de la OT y validación del laboratorio · reglas PURAS
 * (reglas-encargo.spec.ts). Frente r4d · T15.
 *
 *   · EP-00 5.1 (BL-159): la OT hereda de la cotización moneda, forma de pago,
 *     referencia, descripción técnica, valor inicial y paridad; se clasifica con
 *     el tipo de trabajo (Ensayos · Adquisiciones · Asesoría · Calibración ·
 *     Certificación), el nivel tecnológico y si requiere muestreo (ABREMUESTREO).
 *     El tipo de trabajo propone el documento: Adquisiciones → IVC; el resto → IE.
 *   · EP-01/02 0.5 (BL-160): OT institucional sin cobro con Nº y fecha de oficio
 *     y los laboratorios que intervienen.
 *   · EP-03 0.3, EP-05 0.3 (BL-161): contrato o lote estructurado (contrato,
 *     proyecto PICM, proveedor, fabricante y país, ítem, cantidad, E.T., lugar y
 *     fecha de muestreo, OT origen y quién paga); precarga la portada del IVC.
 *   · EP-05 0.1 (BL-162): carril DSA, lugar y país de ejecución y muestreo en
 *     instalaciones del cliente. La comisión en fábrica va en US$.
 *   · EP-05 1.2 (BL-163): el laboratorio valida la OT: alcance conforme (o la
 *     devuelve a Ventas con motivo), fechas internas (inicio, término, informe
 *     comprometido) que NO cambian el plazo con el cliente, y en el SVM la
 *     clasificación del vehículo.
 */

export const TIPOS_TRABAJO = ["ENSAYOS", "ADQUISICIONES", "ASESORIA", "CALIBRACION", "CERTIFICACION"] as const;
export const NIVELES_TECNOLOGICOS = ["AA", "AB", "BA", "BB"] as const;
export const CARRILES_DSA = ["PARTICULAR", "INSTITUCIONAL", "COMISION_FABRICA", "ORDEN_INTERNA", "REINSPECCION"] as const;
export const LUGARES_EJECUCION = ["IDIC", "FABRICA_NACIONAL", "FABRICA_EXTRANJERO", "UNIDAD_MILITAR"] as const;
export const CLASIFICACIONES_VEHICULO = ["MMU", "MUU", "PPU", "APOYO"] as const;

/**
 * Documento que propone el tipo de trabajo (EP-03 0.1): IVC para un lote de
 * adquisición, IE para el resto. Una OT del BPCH emite Informe de Inspección
 * (B-084: decía «Emite IE»).
 */
export function documentoPropuesto(tipoTrabajo: string | null | undefined, rama?: "bpch" | "d11" | null): "IVC" | "IE" | "II" | null {
  if (rama === "bpch") return "II";
  if (!tipoTrabajo) return null;
  return tipoTrabajo === "ADQUISICIONES" ? "IVC" : "IE";
}

export interface DatosEncargo {
  tipoTrabajo?: string | null;
  nivelTecnologico?: string | null;
  requiereMuestreo?: boolean | null;
  mandante?: string | null;
  moneda?: string | null;
  oficioNumero?: string | null;
  oficioFecha?: string | null;
  laboratorios?: string[];
  contrato?: string | null;
  contratoFecha?: string | null;
  proyecto?: string | null;
  proveedor?: string | null;
  fabricante?: string | null;
  paisOrigen?: string | null;
  item?: string | null;
  cantidad?: number | null;
  unidadCantidad?: string | null;
  etTexto?: string | null;
  lugarMuestreo?: string | null;
  fechaMuestreo?: string | null;
  otOrigenId?: string | null;
  paga?: string | null;
  carrilDsa?: string | null;
  lugarEjecucion?: string | null;
  paisEjecucion?: string | null;
  muestreoCliente?: boolean | null;
}

const lleno = (v: unknown) => v != null && String(v).trim() !== "";

/** Errores de los datos del encargo (lista vacía = se guardan). `origen` = origen de la OT. */
export function erroresEncargo(d: DatosEncargo, ctx: { origen?: string | null; otId?: string; exigeOficio?: boolean }): string[] {
  const e: string[] = [];
  if (d.tipoTrabajo && !(TIPOS_TRABAJO as readonly string[]).includes(d.tipoTrabajo)) e.push(`Tipo de trabajo desconocido: ${d.tipoTrabajo}.`);
  if (d.nivelTecnologico && !(NIVELES_TECNOLOGICOS as readonly string[]).includes(d.nivelTecnologico)) e.push(`Nivel tecnológico desconocido: ${d.nivelTecnologico}.`);
  if (d.carrilDsa && !(CARRILES_DSA as readonly string[]).includes(d.carrilDsa)) e.push(`Carril DSA desconocido: ${d.carrilDsa}.`);
  if (d.lugarEjecucion && !(LUGARES_EJECUCION as readonly string[]).includes(d.lugarEjecucion)) e.push(`Lugar de ejecución desconocido: ${d.lugarEjecucion}.`);
  if (ctx.origen === "INSTITUCIONAL" && ctx.exigeOficio !== false) {
    if (!lleno(d.oficioNumero)) e.push("OT institucional: indique el Nº del oficio.");
    if (!lleno(d.oficioFecha)) e.push("OT institucional: indique la fecha del oficio.");
  }
  if (d.lugarEjecucion === "FABRICA_EXTRANJERO" && !lleno(d.paisEjecucion)) e.push("Ejecución en el extranjero: indique el país.");
  if (d.carrilDsa === "COMISION_FABRICA" && d.moneda && d.moneda !== "USD") e.push("La comisión en fábrica se cotiza y factura en US$.");
  if (d.cantidad != null && !(Number(d.cantidad) > 0)) e.push("La cantidad del lote debe ser mayor que 0.");
  if (d.paga && !["proveedor", "mandante"].includes(d.paga)) e.push("Quién paga: proveedor o mandante.");
  if (d.paga && !d.otOrigenId) e.push("Quién paga la reinspección se indica junto con la OT de origen.");
  if (d.carrilDsa === "REINSPECCION" && !d.otOrigenId) e.push("Una reinspección exige la OT de origen.");
  if (d.otOrigenId && ctx.otId && d.otOrigenId === ctx.otId) e.push("La OT de origen no puede ser la misma OT.");
  if (d.contratoFecha && d.fechaMuestreo && d.fechaMuestreo < d.contratoFecha) e.push("La fecha de muestreo es anterior a la del contrato.");
  return e;
}

export interface ValidacionLab {
  alcanceConforme: boolean;
  observacion?: string | null;
  clasificacionVehiculo?: string | null;
  subtipoVehiculo?: string | null;
  fechaInspeccion?: string | null;
  fechaInicio?: string | null;
  fechaTermino?: string | null;
  fechaInforme?: string | null;
  escalarJefeSeccion?: boolean | null;
}

/**
 * Validación del laboratorio (EP-05 1.2). Devuelve errores y avisos: un informe
 * comprometido después del plazo de la OT es un AVISO (las fechas internas no
 * cambian el plazo con el cliente; lo cambia Planificación con motivo).
 */
export function revisarValidacionLab(
  v: ValidacionLab,
  ctx: { laboratorio?: string | null; fechaCompromiso?: string | null },
): { errores: string[]; avisos: string[] } {
  const errores: string[] = [];
  const avisos: string[] = [];
  if (!v.alcanceConforme) {
    if (!lleno(v.observacion) || String(v.observacion).trim().length < 5)
      errores.push("Alcance no conforme: indique el motivo para devolver la OT a Ventas.");
    return { errores, avisos };
  }
  if (!v.fechaInicio) errores.push("Indique la fecha de inicio del ensayo.");
  if (!v.fechaInforme) errores.push("Indique la fecha comprometida del informe.");
  if (v.fechaInicio && v.fechaTermino && v.fechaTermino < v.fechaInicio) errores.push("La fecha de término es anterior a la de inicio.");
  if (v.fechaInicio && v.fechaInforme && v.fechaInforme < v.fechaInicio) errores.push("El informe no puede comprometerse antes del inicio del ensayo.");
  if ((ctx.laboratorio ?? "").toUpperCase() === "SVM") {
    if (!v.clasificacionVehiculo) errores.push("SVM: indique la clasificación del vehículo.");
    else if (!(CLASIFICACIONES_VEHICULO as readonly string[]).includes(v.clasificacionVehiculo)) errores.push(`Clasificación del vehículo desconocida: ${v.clasificacionVehiculo}.`);
  }
  if (v.fechaInforme && ctx.fechaCompromiso && v.fechaInforme > ctx.fechaCompromiso.slice(0, 10))
    avisos.push("La fecha del informe queda después del plazo comprometido con el cliente: avise a Planificación para que lo revise.");
  return { errores, avisos };
}

/** Campos de la portada del IVC que salen de los datos del encargo (BL-161). */
export function portadaDesdeEncargo(
  e: {
    contrato?: string | null;
    contratoFecha?: string | null;
    proyecto?: string | null;
    proveedor?: string | null;
    fabricante?: string | null;
    paisOrigen?: string | null;
    item?: string | null;
    cantidad?: number | string | null;
    unidadCantidad?: string | null;
  } | null,
  fmtFecha: (d: string) => string,
): Record<string, string | null> {
  if (!e) return {};
  const cant = e.cantidad != null && e.cantidad !== "" ? `${String(Number(e.cantidad)).replace(".", ",")}${e.unidadCantidad ? ` ${e.unidadCantidad}` : ""}` : null;
  const o: Record<string, string | null> = {
    contrato: e.contrato ?? null,
    fechaContrato: e.contratoFecha ? fmtFecha(e.contratoFecha) : null,
    proyecto: e.proyecto ?? null,
    proveedor: e.proveedor ?? null,
    fabricante: e.fabricante ?? null,
    paisOrigen: e.paisOrigen ?? null,
    item: e.item ?? null,
    cantidad: cant,
  };
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ""));
}
