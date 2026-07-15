/**
 * Generación de correlativos de OT. Extraído tal cual de `ot.controller.ts`
 * para que `CotizacionService.aceptar()` cree la OT con el MISMO formato y la
 * misma secuencia (OT-AAAA-NNNN, por tenant y año, UNIQUE(tenant_id, codigo)).
 *
 * `db` acepta tanto PrismaService como el cliente de una transacción
 * (`tx` de `$transaction`), para poder generar el código dentro de la misma
 * transacción que crea la OT.
 *
 * LIMITACIÓN CONOCIDA (heredada, fuera del alcance de este cambio): es un
 * read-then-write sin secuencia ni bloqueo, así que dos peticiones concurrentes
 * pueden calcular el mismo correlativo — el UNIQUE lo convierte en un 500 en la
 * segunda. Además `orderBy: codigo desc` es orden lexicográfico y se rompe al
 * pasar de 9999. Está documentado en `docs/AUDITORIA_FUNCIONAL.md` §5.15 y su
 * arreglo (secuencia PostgreSQL) es un trabajo aparte.
 */
export async function generarCodigoOt(db: any, tenantId: string): Promise<string> {
  const anio = new Date().getFullYear();
  const ultima = await db.ordenTrabajo.findFirst({
    where: { tenantId, codigo: { startsWith: `OT-${anio}-` } },
    orderBy: { codigo: "desc" },
    select: { codigo: true },
  });
  let n = 1;
  if (ultima) {
    const partes = ultima.codigo.split("-");
    n = parseInt(partes[2] ?? "0", 10) + 1;
  }
  return `OT-${anio}-${String(n).padStart(4, "0")}`;
}
