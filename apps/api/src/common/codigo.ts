/**
 * Generación de correlativos de OT. Extraído tal cual de `ot.controller.ts`
 * para que `CotizacionService.aceptar()` cree la OT con el MISMO formato y la
 * misma secuencia (OT-AAAA-NNNN, por tenant y año, UNIQUE(tenant_id, codigo)).
 *
 * `db` acepta tanto PrismaService como el cliente de una transacción
 * (`tx` de `$transaction`), para poder generar el código dentro de la misma
 * transacción que crea la OT.
 *
 * CONCURRENCIA (arreglado): el correlativo se obtiene con un contador atómico
 * `ot_correlativo(tenant_id, anio, ultimo)` mediante
 *   INSERT ... ON CONFLICT DO UPDATE ... RETURNING
 * que PostgreSQL serializa bajo alta concurrencia: dos altas simultáneas
 * obtienen números distintos (no chocan con el UNIQUE) y la secuencia es
 * numérica (no lexicográfica), por lo que no se rompe al pasar de 9999. La
 * tabla y su siembra viven en packages/db/align_ot_correlativo.sql.
 */
export async function generarCodigoOt(db: any, tenantId: string): Promise<string> {
  const anio = new Date().getFullYear();
  // INSERT ... ON CONFLICT DO UPDATE ... RETURNING es atómico: incrementa y
  // devuelve el nuevo valor en una sola sentencia, sin ventana read-then-write.
  const filas = await db.$queryRaw<Array<{ ultimo: number }>>`
    INSERT INTO ot_correlativo (tenant_id, anio, ultimo)
    VALUES (${tenantId}::uuid, ${anio}, 1)
    ON CONFLICT (tenant_id, anio)
    DO UPDATE SET ultimo = ot_correlativo.ultimo + 1, updated_at = now()
    RETURNING ultimo
  `;
  const n = Number(filas?.[0]?.ultimo ?? 1);
  return `OT-${anio}-${String(n).padStart(4, "0")}`;
}
