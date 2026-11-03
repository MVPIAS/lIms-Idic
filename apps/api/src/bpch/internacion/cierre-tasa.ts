/**
 * Faltante propio para cerrar una OT de internación sujeta a la tasa: la tasa
 * calculada y remitida a facturación (reglas-bpch.ts · faltantesCierreTasa).
 * Función sin inyección para que la use el cierre general
 * (ot/ot-cierre.controller.ts) con la base o con su transacción. Una base sin
 * las tablas de internación BPCH no tiene faltantes.
 */
import { faltantesCierreTasa } from "../comun/reglas-bpch";

type Sql = { $queryRawUnsafe<T = unknown>(q: string, ...v: any[]): Promise<T> };

export async function faltantesTasaInternacion(db: Sql, otId: string): Promise<string[]> {
  try {
    const filas = await db.$queryRawUnsafe<{ numero: string; sujeta: boolean; calculada: boolean; remitida: boolean }[]>(
      `SELECT i.numero, i.sujeta_tasa AS sujeta, (i.remitida_dco_at IS NOT NULL) AS remitida,
              EXISTS (SELECT 1 FROM calculo_tasa_internacion t WHERE t.internacion_id = i.id) AS calculada
         FROM bpch_internacion i
        WHERE i.ot_id = $1::uuid AND i.estado <> 'anulada'`,
      otId,
    );
    return faltantesCierreTasa(filas.map((f) => ({ numero: f.numero, sujetaTasa: f.sujeta, tasaCalculada: f.calculada, remitida: f.remitida })));
  } catch {
    return [];
  }
}
