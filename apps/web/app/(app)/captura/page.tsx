import { redirect } from "next/navigation";

/**
 * /captura (pantalla suelta «Captura de resultados») ya no existe: hay UNA sola
 * captura, «Captura y revisión por OT». Los enlaces antiguos llegan aquí:
 *  · /captura                → /captura-ot
 *  · /captura?corregir=<id>  → /captura-ot?corregir=<id> (abre la OT del
 *    resultado con «Corregir réplicas…» abierto, con la regla de motivo).
 * La alta suelta de un resultado por muestra + analito (sin OT ni asignación ni
 * especificación de la orden) se retiró de la interfaz: los ensayos nacen con la
 * OT y se capturan en ella.
 */
export default function CapturaPage({ searchParams }: { searchParams?: { corregir?: string | string[] } }) {
  const id = typeof searchParams?.corregir === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(searchParams.corregir)
    ? searchParams.corregir
    : null;
  redirect(id ? `/captura-ot?corregir=${id}` : "/captura-ot");
}
