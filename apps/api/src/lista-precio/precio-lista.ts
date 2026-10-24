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
 * de `vigente_desde` más reciente.
 */
import type { PrecioEjercito } from "../cotizacion/circuito-config";
import { MONEDAS_OPERACION } from "../common/moneda";
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
}

export interface PrecioElegido {
  precio: number;
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
    if (conValor(v)) return { precio: Number(v), origen: "lista", columna, lista: { codigo: item.listaCodigo, nombre: item.listaNombre, itemCodigo: item.itemCodigo } };
  }
  return conValor(precioFicha) ? { precio: Number(precioFicha), origen: "ficha" } : null;
}

/**
 * D01-23 · Precio de referencia de un ensayo en el panel de «Registrar OT» (total
 * estimado): la ficha del ensayo si tiene valor; si no, el neto del ítem enlazado
 * en la lista vigente; si tampoco, lo que diga la ficha (0 o vacío).
 */
export function precioPanel(precioFicha: unknown, item: ItemListaVigente | null | undefined): number | null {
  const ficha = precioFicha == null ? null : Number(precioFicha);
  if (ficha != null && Number.isFinite(ficha) && ficha > 0) return ficha;
  if (item && Number.isFinite(item.precio) && item.precio > 0) return item.precio;
  return ficha;
}

/** Ítems de las listas vigentes a `fecha` (AAAA-MM-DD) enlazados con esos ensayos del catálogo. */
export async function itemsListaVigente(db: any, tenantId: string, catEnsayoIds: string[], fecha: string): Promise<Map<string, ItemListaVigente>> {
  if (!catEnsayoIds.length) return new Map();
  const filas: { catEnsayoId: string; itemId: string; itemCodigo: string; precio: unknown; costoTotal: unknown; listaCodigo: string; listaNombre: string }[] =
    await db.$queryRawUnsafe(
      `SELECT DISTINCT ON (i.cat_ensayo_id)
              i.cat_ensayo_id::text AS "catEnsayoId", i.id::text AS "itemId", i.codigo AS "itemCodigo",
              i.precio, i.costo_total AS "costoTotal", lp.codigo AS "listaCodigo", lp.nombre AS "listaNombre"
         FROM lista_precio_item i
         JOIN lista_precio lp ON lp.id = i.lista_precio_id
        WHERE lp.tenant_id = $1::uuid AND lp.deleted_at IS NULL AND COALESCE(lp.activa, TRUE)
          AND COALESCE(upper(lp.moneda), 'CLP') = ANY($4::text[])
          AND lp.vigente_desde <= $3::date AND (lp.vigente_hasta IS NULL OR lp.vigente_hasta >= $3::date)
          AND i.cat_ensayo_id = ANY($2::uuid[]) AND i.precio > 0
        ORDER BY i.cat_ensayo_id, lp.vigente_desde DESC, lp.created_at DESC`,
      tenantId,
      catEnsayoIds,
      fecha,
      [...MONEDAS_OPERACION],
    );
  return new Map(
    filas.map((f) => [
      f.catEnsayoId,
      { ...f, precio: Number(f.precio), costoTotal: f.costoTotal == null ? null : Number(f.costoTotal) },
    ]),
  );
}
