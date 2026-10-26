/**
 * Precio de un ensayo según la lista de precios VIGENTE (lista oficial 2026 y
 * las que vengan). Regla de elección pura (precio-lista.spec.ts) + lectura.
 *
 *   · Cliente PARTICULAR → `precio` del ítem = neto (precio particular sin IVA;
 *     el IVA lo suma la cotización).
 *   · Cliente EJÉRCITO   → según `circuito_cotizacion.precio_ejercito` (POR
 *     CONFIRMAR, EP-00 §10 P1): «ficha» (por defecto: no usa la lista, rige la
 *     ficha de costos del catálogo), «costo_total» (CD + CI) o «neto».
 *   · Sin ítem enlazado en una lista vigente → la ficha de costos (cat_ensayo.precio).
 *
 * Lista vigente: activa, no borrada, `vigente_desde` ≤ fecha de emisión ≤
 * `vigente_hasta` (o sin fin) y en una moneda de la operación (frente f5: una
 * lista histórica en UF o EUR no da precios nuevos). Si dos listas vigentes tienen el ensayo, manda la
 * de la moneda pedida (la de la cotización) y, entre ellas, la de `vigente_desde` más reciente.
 *
 * Frente f6 · el precio CONSERVA LA MONEDA DE SU LISTA (`precioParaCotizacion`):
 *   · misma moneda que la cotización → tal cual;
 *   · lista o ficha en CLP y cotización en USD → se convierte con el dólar del
 *     día que la cotización exige y congela (`dolarValor`), como antes;
 *   · lista en USD y cotización en CLP → BLOQUEO con mensaje: no hay un tipo de
 *     cambio de la operación para pasar dólares a pesos y no se inventa
 *     (decisión del IDIC pendiente). La cotización tiene que emitirse en USD.
 * La factura sin cotización y el total estimado de «Registrar OT» van en CLP:
 * solo toman listas en CLP (`soloMoneda`).
 */
import type { PrecioEjercito } from "../cotizacion/circuito-config";
import { MONEDAS_OPERACION, monedaDe, redondearMoneda, type MonedaOperacion } from "../common/moneda";
import type { ReglaValidez } from "../cotizacion/validez";

export interface ItemListaVigente {
  catEnsayoId: string;
  itemId: string;
  itemCodigo: string;
  /** Precio de venta del ítem (neto en la lista oficial). */
  precio: number;
  costoTotal: number | null;
  listaCodigo: string;
  listaNombre: string;
  /** Moneda de la lista (frente f6): el precio está en ella. */
  moneda: MonedaOperacion;
}

export interface PrecioElegido {
  precio: number;
  /** Moneda del precio: la de su lista; la ficha de costos está en CLP. */
  moneda: MonedaOperacion;
  origen: "lista" | "ficha";
  /** Columna de la lista que se usó. */
  columna?: "neto" | "costo_total";
  lista?: { codigo: string; nombre: string; itemCodigo: string };
}

/** Precio que corresponde al ensayo para el tipo de cliente (null si no hay ni lista ni ficha con valor). */
export function elegirPrecio(
  item: ItemListaVigente | null | undefined,
  precioFicha: number | null,
  regla: ReglaValidez,
  precioEjercito: PrecioEjercito,
): PrecioElegido | null {
  const conValor = (n: number | null | undefined): n is number => n != null && Number.isFinite(Number(n)) && Number(n) > 0;
  const columna: "neto" | "costo_total" | null = regla === "PARTICULAR" ? "neto" : precioEjercito === "ficha" ? null : precioEjercito;
  if (item && columna) {
    const v = columna === "neto" ? item.precio : item.costoTotal;
    if (conValor(v)) return { precio: Number(v), moneda: item.moneda ?? "CLP", origen: "lista", columna, lista: { codigo: item.listaCodigo, nombre: item.listaNombre, itemCodigo: item.itemCodigo } };
  }
  return conValor(precioFicha) ? { precio: Number(precioFicha), moneda: "CLP", origen: "ficha" } : null;
}

/** Texto de la moneda para los mensajes. */
const nombreMoneda = (m: string) => (m === "USD" ? "USD (dólares)" : "CLP (pesos chilenos)");

/**
 * Frente f6 · precio de un ensayo en la moneda de la cotización, sin mezclar
 * monedas en silencio. CLP → USD con el dólar del día de la cotización;
 * USD → CLP se bloquea (no hay tipo de cambio de la operación: decisión del
 * IDIC). Redondeo: CLP sin decimales, USD a 2 decimales.
 */
export function precioParaCotizacion(
  elegido: Pick<PrecioElegido, "precio" | "moneda" | "origen" | "lista">,
  monedaCotizacion: string,
  dolar: number | null | undefined,
  /** Código del ensayo, para el mensaje. */
  codigo = "",
): { precio: number; error?: undefined } | { precio?: undefined; error: string } {
  const mCot = monedaDe(monedaCotizacion);
  const mPre = monedaDe(elegido.moneda);
  if (mPre === mCot) return { precio: redondearMoneda(elegido.precio, mCot) };
  if (mPre === "CLP" && mCot === "USD") {
    if (!(Number(dolar) > 0)) return { error: `Cotización en USD: indique el valor del dólar del día para convertir el precio en CLP ${codigo ? `del ensayo ${codigo}` : "del ensayo"}.` };
    return { precio: redondearMoneda(elegido.precio / Number(dolar), "USD") };
  }
  const delEnsayo = codigo ? `del ensayo ${codigo}` : "del ensayo";
  const donde = elegido.origen === "lista" && elegido.lista ? `la lista «${elegido.lista.nombre}» (${elegido.lista.itemCodigo})` : "su ficha de costos";
  return {
    error: `El precio ${delEnsayo} está en ${nombreMoneda(mPre)} en ${donde} y la cotización está en ${nombreMoneda(mCot)}: no se mezclan monedas ni se convierte sin un tipo de cambio de la operación. Emita la cotización en ${mPre}.`,
  };
}

export interface OpcionesListaVigente {
  /** Moneda preferida (la de la cotización): si el ensayo está en listas de varias monedas, manda esta. */
  preferir?: string | null;
  /** Solo listas en esta moneda (factura sin cotización y total estimado de la OT: CLP). */
  soloMoneda?: string | null;
}

/**
 * D01-23 · Precio de referencia de un ensayo en el panel de «Registrar OT» (total
 * estimado): la ficha del ensayo si tiene valor; si no, el neto del ítem enlazado
 * en la lista vigente; si tampoco, lo que diga la ficha (0 o vacío).
 */
export function precioPanel(precioFicha: unknown, item: ItemListaVigente | null | undefined): number | null {
  const ficha = precioFicha == null ? null : Number(precioFicha);
  if (ficha != null && Number.isFinite(ficha) && ficha > 0) return ficha;
  if (item && (item.moneda ?? "CLP") === "CLP" && Number.isFinite(item.precio) && item.precio > 0) return item.precio;
  return ficha;
}

/** Ítems de las listas vigentes a `fecha` (AAAA-MM-DD) enlazados con esos ensayos del catálogo. */
export async function itemsListaVigente(
  db: any,
  tenantId: string,
  catEnsayoIds: string[],
  fecha: string,
  opciones: OpcionesListaVigente = {},
): Promise<Map<string, ItemListaVigente>> {
  if (!catEnsayoIds.length) return new Map();
  const monedas = opciones.soloMoneda ? [monedaDe(opciones.soloMoneda)] : [...MONEDAS_OPERACION];
  const filas: { catEnsayoId: string; itemId: string; itemCodigo: string; precio: unknown; costoTotal: unknown; listaCodigo: string; listaNombre: string; moneda: string }[] =
    await db.$queryRawUnsafe(
      `SELECT DISTINCT ON (i.cat_ensayo_id)
              i.cat_ensayo_id::text AS "catEnsayoId", i.id::text AS "itemId", i.codigo AS "itemCodigo",
              i.precio, i.costo_total AS "costoTotal", lp.codigo AS "listaCodigo", lp.nombre AS "listaNombre",
              COALESCE(upper(lp.moneda), 'CLP') AS moneda
         FROM lista_precio_item i
         JOIN lista_precio lp ON lp.id = i.lista_precio_id
        WHERE lp.tenant_id = $1::uuid AND lp.deleted_at IS NULL AND COALESCE(lp.activa, TRUE)
          AND COALESCE(upper(lp.moneda), 'CLP') = ANY($4::text[])
          AND lp.vigente_desde <= $3::date AND (lp.vigente_hasta IS NULL OR lp.vigente_hasta >= $3::date)
          AND i.cat_ensayo_id = ANY($2::uuid[]) AND i.precio > 0
        ORDER BY i.cat_ensayo_id, (COALESCE(upper(lp.moneda), 'CLP') = $5) DESC, lp.vigente_desde DESC, lp.created_at DESC`,
      tenantId,
      catEnsayoIds,
      fecha,
      monedas,
      monedaDe(opciones.preferir ?? opciones.soloMoneda),
    );
  return new Map(
    filas.map((f) => [
      f.catEnsayoId,
      { ...f, moneda: monedaDe(f.moneda) as MonedaOperacion, precio: Number(f.precio), costoTotal: f.costoTotal == null ? null : Number(f.costoTotal) },
    ]),
  );
}
