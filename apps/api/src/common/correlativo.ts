/**
 * Generación del correlativo de Orden Interna (OI-AAAA-NNNN). Mismo patrón que
 * `generarCodigoOt` en `codigo.ts`: un contador atómico por (tenant_id, anio)
 * incrementado con INSERT ... ON CONFLICT DO UPDATE ... RETURNING, que PostgreSQL
 * serializa bajo concurrencia (dos altas simultáneas obtienen números distintos)
 * y es numérico (no lexicográfico, no se rompe al pasar de 9999).
 *
 * La tabla `orden_interna_correlativo(tenant_id, anio, ultimo)` la crea
 * `packages/db/align_flujo_real.sql` (D4).
 *
 * `db` acepta tanto PrismaService como el cliente de una transacción (`tx`).
 */
export async function generarNumeroOrdenInterna(db: any, tenantId: string): Promise<string> {
  const anio = new Date().getFullYear();
  const filas = await db.$queryRaw<Array<{ ultimo: number }>>`
    INSERT INTO orden_interna_correlativo (tenant_id, anio, ultimo)
    VALUES (${tenantId}::uuid, ${anio}, 1)
    ON CONFLICT (tenant_id, anio)
    DO UPDATE SET ultimo = orden_interna_correlativo.ultimo + 1, updated_at = now()
    RETURNING ultimo
  `;
  const n = Number(filas?.[0]?.ultimo ?? 1);
  return `OI-${anio}-${String(n).padStart(4, "0")}`;
}
