/**
 * Condiciones comerciales especiales de un cliente (contrato 4.1.1 / 4.1.3):
 * lista de precios propia, descuento especial (%), condiciones de texto y forma
 * de pago habitual. Se mantienen en la ficha del cliente (Comercial › Clientes)
 * y la cotización a ese cliente las precarga y aplica.
 *
 * Regla pura de vigencia de la lista propia en `estadoListaCliente`
 * (condiciones-cliente.spec.ts); lectura en `leerCondicionesCliente`.
 */
import { esMonedaOperacion } from "../common/moneda";

export interface ListaCliente {
  id: string;
  codigo: string;
  nombre: string;
  moneda: string;
  /** AAAA-MM-DD. */
  vigenteDesde: string;
  vigenteHasta: string | null;
  activa: boolean;
  borrada: boolean;
}

export interface CondicionesCliente {
  lista: (ListaCliente & { vigente: boolean; motivo: string | null }) | null;
  descuentoPct: number;
  condiciones: string | null;
  formaPagoHabitual: string | null;
  diasCredito: number | null;
}

const ddmmaaaa = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

/**
 * ¿La lista propia del cliente da precios a la fecha de emisión (AAAA-MM-DD)?
 * Si no, `motivo` explica por qué (y la cotización usa la lista general).
 */
export function estadoListaCliente(l: ListaCliente, fecha: string): { vigente: boolean; motivo: string | null } {
  const no = (motivo: string) => ({ vigente: false, motivo: `La lista propia del cliente («${l.nombre}») no se aplica: ${motivo} Se usa la lista de precios general.` });
  if (l.borrada) return no("fue eliminada.");
  if (!l.activa) return no("está inactiva.");
  if (!esMonedaOperacion(l.moneda)) return no(`está en ${l.moneda}, una moneda histórica.`);
  if (l.vigenteDesde > fecha) return no(`rige desde el ${ddmmaaaa(l.vigenteDesde)}.`);
  if (l.vigenteHasta && l.vigenteHasta < fecha) return no(`venció el ${ddmmaaaa(l.vigenteHasta)}.`);
  return { vigente: true, motivo: null };
}

/** Condiciones especiales del cliente a la fecha de emisión (AAAA-MM-DD). */
export async function leerCondicionesCliente(db: any, tenantId: string, clienteId: string, fecha: string): Promise<CondicionesCliente> {
  const filas: any[] = await db.$queryRawUnsafe(
    `SELECT c.descuento_especial_pct::float8 AS "descuentoPct", c.condiciones_especiales AS condiciones,
            c.forma_pago_habitual AS "formaPagoHabitual", c.dias_credito AS "diasCredito",
            lp.id::text AS "listaId", lp.codigo, lp.nombre, COALESCE(upper(lp.moneda), 'CLP') AS moneda,
            to_char(lp.vigente_desde, 'YYYY-MM-DD') AS "vigenteDesde", to_char(lp.vigente_hasta, 'YYYY-MM-DD') AS "vigenteHasta",
            COALESCE(lp.activa, TRUE) AS activa, (lp.deleted_at IS NOT NULL) AS borrada
       FROM cliente c
       LEFT JOIN lista_precio lp ON lp.id = c.lista_precio_id AND lp.tenant_id = c.tenant_id
      WHERE c.id = $1::uuid AND c.tenant_id = $2::uuid`,
    clienteId,
    tenantId,
  );
  const f = filas[0];
  if (!f) return { lista: null, descuentoPct: 0, condiciones: null, formaPagoHabitual: null, diasCredito: null };
  const lista: ListaCliente | null = f.listaId
    ? { id: f.listaId, codigo: f.codigo, nombre: f.nombre, moneda: f.moneda, vigenteDesde: f.vigenteDesde, vigenteHasta: f.vigenteHasta, activa: f.activa, borrada: f.borrada }
    : null;
  return {
    lista: lista ? { ...lista, ...estadoListaCliente(lista, fecha) } : null,
    descuentoPct: Number(f.descuentoPct) > 0 ? Number(f.descuentoPct) : 0,
    condiciones: f.condiciones?.trim() || null,
    formaPagoHabitual: f.formaPagoHabitual ?? null,
    diasCredito: f.diasCredito ?? null,
  };
}
