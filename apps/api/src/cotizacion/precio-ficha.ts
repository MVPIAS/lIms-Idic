/**
 * Precio de las líneas de la cotización (EP-00 2.2, BL-149) · regla PURA,
 * probada en precio-ficha.spec.ts.
 *
 *   · Una línea de ENSAYO toma su precio de la lista de precios vigente si el
 *     ensayo está en ella (lista-precio/precio-lista.ts: neto para un particular)
 *     y, si no, de la ficha de costos (cat_ensayo.precio); convertido a US$ con
 *     el dólar de la cotización. La API no acepta un precio
 *     manual distinto: antes bastaba con mandar `precioUnitario` para esquivar la
 *     ficha. Un ensayo sin valor en su ficha bloquea la cotización.
 *   · Una línea SIN ensayo solo puede ser un GASTO tipificado (viático, pasaje,
 *     traslado u otro gasto, horas de comisión): no un «producto» libre.
 *   · Al EDITAR, una línea que ya estaba en la cotización conserva su precio
 *     (era el de la ficha cuando se cotizó) aunque la ficha cambie después.
 */

export const TIPOS_GASTO = ["viatico", "pasaje", "otros", "hora_hombre", "hora_maquina"] as const;

export const ETIQUETA_GASTO: Record<string, string> = {
  viatico: "Viático",
  pasaje: "Pasaje",
  otros: "Traslado u otro gasto",
  hora_hombre: "Horas hombre de comisión",
  hora_maquina: "Horas máquina de comisión",
};

export interface LineaPrecio {
  catEnsayoId?: string | null;
  ensayoCodigo?: string | null;
  tipo?: string | null;
  descripcion?: string | null;
  precioUnitario?: number | null;
}

export interface Existentes {
  /** Precio guardado de cada ensayo ya cotizado (por catEnsayoId). */
  ensayos: Map<string, number>;
  /** Líneas libres ya guardadas: clave «tipo|descripción|precio». */
  libres: Set<string>;
}

const igual = (a: number, b: number) => Math.abs(a - b) < 0.005;
export const claveLibre = (tipo: string | null | undefined, descripcion: string | null | undefined, precio: number) =>
  `${tipo ?? ""}|${(descripcion ?? "").trim()}|${Math.round(precio * 100)}`;

/**
 * Precio que corresponde a la línea o el error que la bloquea.
 * `precioFicha` = valor de la ficha ya en la moneda de la cotización (null si el ensayo no tiene valor).
 */
export function precioDeLinea(
  l: LineaPrecio,
  precioFicha: number | null,
  n: number,
  existentes?: Existentes,
  /** De dónde sale el precio, para el mensaje (por defecto la ficha; la lista de precios vigente, lp26). */
  fuente = "su ficha de costos",
): { precio: number; error?: undefined } | { precio?: undefined; error: string } {
  const pedido = l.precioUnitario != null ? Number(l.precioUnitario) : null;
  if (l.catEnsayoId) {
    const codigo = l.ensayoCodigo ?? "del catálogo";
    const previo = existentes?.ensayos.get(l.catEnsayoId);
    if (previo != null && (pedido == null || igual(pedido, previo))) return { precio: previo };
    if (!(precioFicha != null && precioFicha > 0))
      return { error: `Línea ${n}: el ensayo ${codigo} no tiene valor en su ficha de costos. Complete la ficha en el catálogo antes de cotizarlo.` };
    if (pedido != null && !igual(pedido, precioFicha))
      return { error: `Línea ${n}: el precio del ensayo ${codigo} sale de ${fuente} (${precioFicha}); la cotización no admite un precio manual.` };
    return { precio: precioFicha };
  }
  if (!(pedido != null && pedido > 0)) return { error: `Línea ${n}: indique el valor del gasto.` };
  if (existentes?.libres.has(claveLibre(l.tipo, l.descripcion, pedido))) return { precio: pedido };
  if (!l.tipo || !(TIPOS_GASTO as readonly string[]).includes(l.tipo))
    return {
      error: `Línea ${n}: una línea sin ensayo del catálogo solo puede ser un gasto tipificado (viático, pasaje, traslado u otro gasto, horas de comisión). Los ensayos se cotizan con su código EN.`,
    };
  if (!l.descripcion?.trim()) return { error: `Línea ${n}: describa el gasto.` };
  return { precio: pedido };
}
